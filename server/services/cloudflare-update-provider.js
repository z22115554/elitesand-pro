'use strict';

const crypto = require('crypto');
const path = require('path');
const { APP_VERSION, appUserAgent } = require('../utils/app-version');
const { dataDir } = require('../utils/app-paths');
const { verifyUpdatePlan } = require('./update-policy');
const { createPersistentReplayGuard } = require('./update-policy-replay-store');

const UPDATE_CONTROL_ORIGIN = 'https://updates.elitesand.pro';
const UPDATE_CONTROL_PATH = '/v1/plan';
const CONNECT_TIMEOUT_MS = 1500;
const TOTAL_TIMEOUT_MS = 4500;
const MAX_PLAN_BYTES = 64 * 1024;
const DEFAULT_CHANNEL = 'stable';

function isEnabled(env = process.env) {
  return env.ELITESAND_ENABLE_CLOUDFLARE_UPDATES === '1';
}

function normalizeChannel(value) {
  return value === 'beta' ? 'beta' : DEFAULT_CHANNEL;
}

function createRequestFingerprint({ version = APP_VERSION, platform = 'win32', arch = 'x64', channel = DEFAULT_CHANNEL } = {}) {
  // This is a coarse release/runtime selector, never an installation ID or a
  // hardware fingerprint. Identical app versions send identical values.
  return crypto.createHash('sha256').update(`elitesand-update-v1\n${version}\n${platform}\n${arch}\n${channel}`, 'utf8').digest('hex');
}

function controlEndpoint(endpoint, { allowTestEndpoint = false } = {}) {
  const expected = `${UPDATE_CONTROL_ORIGIN}${UPDATE_CONTROL_PATH}`;
  const raw = endpoint == null ? expected : String(endpoint);
  try {
    const url = new URL(raw);
    if (!allowTestEndpoint && url.href !== expected) return null;
    if (allowTestEndpoint && !['https:', 'http:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== UPDATE_CONTROL_PATH) return null;
    return url;
  } catch (_) {
    return null;
  }
}

async function fetchPlanJson(url, { fetchImpl = globalThis.fetch, connectTimeoutMs = CONNECT_TIMEOUT_MS, totalTimeoutMs = TOTAL_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (!Number.isInteger(connectTimeoutMs) || !Number.isInteger(totalTimeoutMs) || connectTimeoutMs < 100 || totalTimeoutMs < connectTimeoutMs || totalTimeoutMs > 10000) {
    throw new TypeError('invalid update fetch timeout');
  }
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(new Error('update total timeout')), totalTimeoutMs);
  const connectTimer = setTimeout(() => controller.abort(new Error('update connect timeout')), connectTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': appUserAgent('update-policy') },
    });
    clearTimeout(connectTimer);
    if (response.status === 204) return { kind: 'none' };
    if (response.status !== 200) return { kind: 'none' };
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!contentType.startsWith('application/json')) return { kind: 'none' };
    const length = Number.parseInt(response.headers?.get?.('content-length') || '', 10);
    if (Number.isInteger(length) && (length < 1 || length > MAX_PLAN_BYTES)) return { kind: 'none' };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PLAN_BYTES) return { kind: 'none' };
    let plan;
    try { plan = JSON.parse(bytes.toString('utf8')); } catch (_) { return { kind: 'none' }; }
    return { kind: 'plan', plan };
  } finally {
    clearTimeout(connectTimer);
    clearTimeout(totalTimer);
  }
}

function createCloudflareUpdateProvider({
  enabled = isEnabled(),
  endpoint,
  allowTestEndpoint = false,
  fetchImpl = globalThis.fetch,
  currentVersion = APP_VERSION,
  channel = normalizeChannel(process.env.ELITESAND_UPDATE_CHANNEL),
  platform = 'win32',
  arch = 'x64',
  replayGuard = createPersistentReplayGuard({ file: path.join(dataDir, 'update-policy-replay-v1.json') }),
  publicKeys,
  nowMs = () => Date.now(),
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  totalTimeoutMs = TOTAL_TIMEOUT_MS,
} = {}) {
  const base = controlEndpoint(endpoint, { allowTestEndpoint });
  const canCheck = enabled === true && base !== null && platform === 'win32' && arch === 'x64' && (channel === 'stable' || channel === 'beta');

  async function check() {
    if (!canCheck) return { kind: 'none' };
    const url = new URL(base.href);
    url.search = new URLSearchParams({
      version: currentVersion,
      platform,
      arch,
      channel,
      fingerprint: createRequestFingerprint({ version: currentVersion, platform, arch, channel }),
    }).toString();
    try {
      const result = await fetchPlanJson(url, { fetchImpl, connectTimeoutMs, totalTimeoutMs });
      if (result.kind !== 'plan') return { kind: 'none' };
      const verified = verifyUpdatePlan(result.plan, {
        currentVersion,
        channel,
        platform,
        arch,
        publicKeys,
        replayGuard,
        nowMs: nowMs(),
      });
      return verified.ok ? { kind: 'plan', plan: verified.plan } : { kind: 'none' };
    } catch (_) {
      return { kind: 'none' };
    }
  }

  // P5 is read-only. These are private-protocol acknowledgements only; P7/P8
  // replace their work paths after an outer signed plan has been accepted.
  return Object.freeze({
    enabled: canCheck,
    check,
    defer: async () => ({ ok: true }),
    acceptIncremental: async () => ({ ok: true }),
    openRequiredInstaller: async () => ({ ok: true }),
  });
}

module.exports = {
  CONNECT_TIMEOUT_MS,
  DEFAULT_CHANNEL,
  MAX_PLAN_BYTES,
  TOTAL_TIMEOUT_MS,
  UPDATE_CONTROL_ORIGIN,
  UPDATE_CONTROL_PATH,
  controlEndpoint,
  createCloudflareUpdateProvider,
  createRequestFingerprint,
  fetchPlanJson,
  isEnabled,
  normalizeChannel,
};
