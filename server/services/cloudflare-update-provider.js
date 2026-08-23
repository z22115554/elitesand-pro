'use strict';

const crypto = require('crypto');
const path = require('path');
const { APP_VERSION, appUserAgent } = require('../utils/app-version');
const { dataDir } = require('../utils/app-paths');
const { verifyUpdatePlan } = require('./update-policy');
const { createPersistentReplayGuard } = require('./update-policy-replay-store');
const { createStartupIncrementalUpdateExecutor } = require('./startup-incremental-update');
const { getInstalledRuntimeFingerprint } = require('./update-runtime-fingerprint');

const UPDATE_CONTROL_ORIGIN = 'https://updates.elitesand.pro';
const BETA_UPDATE_CONTROL_ORIGIN = 'https://elitesand-update-control.elitesand.workers.dev';
const UPDATE_CONTROL_PATH = '/v1/plan';
const CONNECT_TIMEOUT_MS = 1500;
const TOTAL_TIMEOUT_MS = 4500;
const MAX_PLAN_BYTES = 64 * 1024;
const DEFAULT_CHANNEL = 'stable';

function isBetaBuildVersion(version = APP_VERSION) {
  return typeof version === 'string' && /-beta(?:[.-]|$)/i.test(version);
}

function defaultChannel(env = process.env, version = APP_VERSION) {
  if (env.ELITESAND_UPDATE_CHANNEL === 'beta') return 'beta';
  if (env.ELITESAND_UPDATE_CHANNEL === 'stable') return 'stable';
  return isBetaBuildVersion(version) ? 'beta' : DEFAULT_CHANNEL;
}

function isEnabled(env = process.env, version = APP_VERSION) {
  if (env.ELITESAND_ENABLE_CLOUDFLARE_UPDATES === '0') return false;
  return env.ELITESAND_ENABLE_CLOUDFLARE_UPDATES === '1' || isBetaBuildVersion(version);
}

function normalizeChannel(value) {
  return value === 'beta' ? 'beta' : DEFAULT_CHANNEL;
}

function createRequestFingerprint({ version = APP_VERSION, platform = 'win32', arch = 'x64', channel = DEFAULT_CHANNEL, runtimeFingerprint } = {}) {
  // The input is a content hash of app.asar, never an install ID, hostname, or
  // hardware value. Hash it again with the public selector so the Worker sees
  // a fixed-length opaque request value rather than raw application metadata.
  if (!/^[a-f0-9]{64}$/i.test(String(runtimeFingerprint || ''))) return null;
  return crypto.createHash('sha256').update(`elitesand-update-request-v2\n${version}\n${platform}\n${arch}\n${channel}\n${String(runtimeFingerprint).toLowerCase()}`, 'utf8').digest('hex');
}

function controlOriginForChannel(channel) {
  return normalizeChannel(channel) === 'beta' ? BETA_UPDATE_CONTROL_ORIGIN : UPDATE_CONTROL_ORIGIN;
}

function controlEndpoint(endpoint, { channel = DEFAULT_CHANNEL, allowTestEndpoint = false } = {}) {
  const expected = `${controlOriginForChannel(channel)}${UPDATE_CONTROL_PATH}`;
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
  currentVersion = APP_VERSION,
  enabled = isEnabled(process.env, currentVersion),
  endpoint,
  allowTestEndpoint = false,
  fetchImpl = globalThis.fetch,
  channel = defaultChannel(process.env, currentVersion),
  platform = 'win32',
  arch = 'x64',
  replayGuard = createPersistentReplayGuard({ file: path.join(dataDir, 'update-policy-replay-v1.json') }),
  publicKeys,
  nowMs = () => Date.now(),
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  totalTimeoutMs = TOTAL_TIMEOUT_MS,
  incrementalExecutor,
  runtimeFingerprint = getInstalledRuntimeFingerprint,
} = {}) {
  const selectedChannel = normalizeChannel(channel);
  const base = controlEndpoint(endpoint, { channel: selectedChannel, allowTestEndpoint });
  const canCheck = enabled === true && base !== null && platform === 'win32' && arch === 'x64' && (selectedChannel === 'stable' || selectedChannel === 'beta');
  const executor = incrementalExecutor || createStartupIncrementalUpdateExecutor({
    currentVersion, channel: selectedChannel, platform, arch, publicKeys, replayGuard, nowMs,
  });

  async function check() {
    if (!canCheck) return { kind: 'none' };
    let installedRuntimeFingerprint;
    try {
      installedRuntimeFingerprint = await runtimeFingerprint({ version: currentVersion, platform, arch, channel: selectedChannel });
    } catch (_) {
      return { kind: 'none' };
    }
    const fingerprint = createRequestFingerprint({ version: currentVersion, platform, arch, channel: selectedChannel, runtimeFingerprint: installedRuntimeFingerprint });
    if (!fingerprint) return { kind: 'none' };
    const url = new URL(base.href);
    url.search = new URLSearchParams({
      version: currentVersion,
      platform,
      arch,
      channel: selectedChannel,
      fingerprint,
    }).toString();
    try {
      const result = await fetchPlanJson(url, { fetchImpl, connectTimeoutMs, totalTimeoutMs });
      if (result.kind !== 'plan') return { kind: 'none' };
      const verified = verifyUpdatePlan(result.plan, {
        currentVersion,
        channel: selectedChannel,
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

  function verifyRequiredInstaller(plan) {
    if (!canCheck || plan?.delivery !== 'installer' || plan?.urgency !== 'required') return false;
    const verified = verifyUpdatePlan(plan, {
      currentVersion,
      channel: selectedChannel,
      platform,
      arch,
      publicKeys,
      replayGuard,
      nowMs: nowMs(),
    });
    return verified.ok;
  }

  return Object.freeze({
    enabled: canCheck,
    check,
    defer: async () => ({ ok: true }),
    acceptIncremental: async (plan) => {
      if (!canCheck || plan?.delivery !== 'incremental') return { ok: false };
      return executor.accept(plan);
    },
    openRequiredInstaller: async (plan) => ({ ok: verifyRequiredInstaller(plan) }),
  });
}

module.exports = {
  CONNECT_TIMEOUT_MS,
  DEFAULT_CHANNEL,
  MAX_PLAN_BYTES,
  TOTAL_TIMEOUT_MS,
  UPDATE_CONTROL_ORIGIN,
  BETA_UPDATE_CONTROL_ORIGIN,
  UPDATE_CONTROL_PATH,
  controlEndpoint,
  controlOriginForChannel,
  createCloudflareUpdateProvider,
  createRequestFingerprint,
  fetchPlanJson,
  defaultChannel,
  isBetaBuildVersion,
  isEnabled,
  normalizeChannel,
};
