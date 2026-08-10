'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const config = require('../utils/load-config');
const { dataDir } = require('../utils/app-paths');
const { APP_VERSION, appUserAgent } = require('../utils/app-version');
const eulaStore = require('./eula-store');
const { createLogger } = require('../utils/logger');

const STATE_SCHEMA_VERSION = 1;
const TIMEOUT_MS = 3500;

function atomicWrite(fsImpl, filename, value) {
  fsImpl.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  try {
    fsImpl.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fsImpl.renameSync(temporary, filename);
  } finally {
    try { if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary); } catch (_) { /* best effort */ }
  }
}

function utcPeriods(now) {
  const day = now.toISOString().slice(0, 10);
  const first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const elapsedDays = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - first.getTime()) / 86400000);
  const daysBeforeFirstMonday = (first.getUTCDay() + 6) % 7;
  const weekNumber = Math.floor((elapsedDays + daysBeforeFirstMonday) / 7);
  return {
    day,
    week: `${now.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`,
    month: day.slice(0, 7),
  };
}

function deriveId(secret, scope, period) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`elitesand-usage:${scope}:${period}`, 'utf8')
    .digest('base64url');
}

function validEndpoint(endpoint) {
  if (endpoint.startsWith('https://')) return true;
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(endpoint);
}

function createUsageTelemetry(options = {}) {
  const dependencies = {
    config: options.config || config,
    dataDir: options.dataDir || dataDir,
    fs: options.fs || fs,
    fetch: options.fetch || fetch,
    now: options.now || (() => new Date()),
    randomBytes: options.randomBytes || crypto.randomBytes,
    appVersion: options.appVersion || APP_VERSION,
    userAgent: options.userAgent || appUserAgent('anonymous-usage'),
    eulaAccepted: options.eulaAccepted || (() => !eulaStore.getStatus().required),
    log: options.log || createLogger('UsageTelemetry'),
  };
  const stateFile = path.join(dependencies.dataDir, 'usage-telemetry.json');
  let stateCache = null;
  let startupSent = false;

  function newSecret() {
    return dependencies.randomBytes(32).toString('hex');
  }

  function defaultState() {
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      enabled: dependencies.config.anonymousUsageEnabled !== false,
      localSecret: newSecret(),
      coreUseAttemptDay: null,
    };
  }

  function loadState() {
    if (stateCache) return stateCache;
    try {
      const parsed = JSON.parse(dependencies.fs.readFileSync(stateFile, 'utf8'));
      if (!parsed || parsed.schemaVersion !== STATE_SCHEMA_VERSION || typeof parsed.enabled !== 'boolean') {
        throw new Error('unsupported state');
      }
      stateCache = {
        schemaVersion: STATE_SCHEMA_VERSION,
        enabled: parsed.enabled,
        localSecret: /^[a-f0-9]{64}$/.test(parsed.localSecret || '') ? parsed.localSecret : newSecret(),
        coreUseAttemptDay: typeof parsed.coreUseAttemptDay === 'string' ? parsed.coreUseAttemptDay : null,
      };
    } catch (_) {
      stateCache = defaultState();
      atomicWrite(dependencies.fs, stateFile, stateCache);
    }
    return stateCache;
  }

  function saveState() {
    atomicWrite(dependencies.fs, stateFile, loadState());
  }

  function endpoint() {
    return String(dependencies.config.usageEndpoint || '').trim();
  }

  function isAvailable() {
    return validEndpoint(endpoint());
  }

  function getSettings() {
    const state = loadState();
    return {
      enabled: state.enabled,
      available: isAvailable(),
      eulaAccepted: dependencies.eulaAccepted(),
    };
  }

  function setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
    const state = loadState();
    state.enabled = enabled;
    state.coreUseAttemptDay = null;
    if (enabled && !/^[a-f0-9]{64}$/.test(state.localSecret || '')) state.localSecret = newSecret();
    if (!enabled) state.localSecret = null;
    startupSent = false;
    saveState();
    return getSettings();
  }

  async function send(event) {
    const state = loadState();
    if (!state.enabled || !dependencies.eulaAccepted() || !isAvailable()) return { skipped: true };
    if (!/^[a-f0-9]{64}$/.test(state.localSecret || '')) {
      state.localSecret = newSecret();
      saveState();
    }
    const periods = utcPeriods(dependencies.now());
    const body = JSON.stringify({
      schemaVersion: 1,
      event,
      appVersion: dependencies.appVersion,
      dailyId: deriveId(state.localSecret, 'day', periods.day),
      weeklyId: deriveId(state.localSecret, 'week', periods.week),
      monthlyId: deriveId(state.localSecret, 'month', periods.month),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await dependencies.fetch(endpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': dependencies.userAgent,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) dependencies.log.warn(`匿名使用統計遭拒絕（HTTP ${response.status}）`);
      return { ok: response.ok, status: response.status };
    } catch (error) {
      dependencies.log.warn(`匿名使用統計傳送失敗：${error.name === 'AbortError' ? '逾時' : error.message}`);
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  async function start() {
    const settings = getSettings();
    if (startupSent || !settings.enabled || !settings.available || !settings.eulaAccepted) return { skipped: true };
    startupSent = true;
    return send('startup');
  }

  async function markCoreUsed() {
    const state = loadState();
    if (!state.enabled || !dependencies.eulaAccepted() || !isAvailable()) return { skipped: true };
    const day = utcPeriods(dependencies.now()).day;
    if (state.coreUseAttemptDay === day) return { skipped: true };
    state.coreUseAttemptDay = day;
    saveState();
    return send('core_use');
  }

  return { getSettings, setEnabled, start, markCoreUsed, isAvailable };
}

const singleton = createUsageTelemetry();
module.exports = Object.assign(singleton, { createUsageTelemetry, utcPeriods, deriveId, validEndpoint });
