'use strict';

const crypto = require('crypto');
const path = require('path');
const { APP_VERSION, appUserAgent } = require('../utils/app-version');
const { dataDir } = require('../utils/app-paths');
const { verifyUpdatePlan } = require('./update-policy');
const { createPersistentReplayGuard } = require('./update-policy-replay-store');
const { createStartupIncrementalUpdateExecutor } = require('./startup-incremental-update');
const { getInstalledRuntimeFingerprint } = require('./update-runtime-fingerprint');

// 2026-09-05：使用者目前沒有自訂網域，stable 沒有真正網域可綁，之前指向
// updates.elitesand.pro 等於指向一個沒人接聽的網址（DNS 直接 NXDOMAIN，已用
// nslookup/curl 實測確認）。Worker 本身早就是 channel-aware（依 query 的
// channel 決定要讀 R2 的 control/stable/... 還是 control/beta/...），所以
// stable/beta 先共用同一個已部署的 workers.dev 來源即可，不必等網域。
// 之後真的申請到網域，只要把這個常數換成 https://updates.elitesand.pro，
// 其他程式碼、測試都不用動。
const WORKERS_DEV_UPDATE_CONTROL_ORIGIN = 'https://elitesand-update-control.elitesand.workers.dev';
const UPDATE_CONTROL_ORIGIN = WORKERS_DEV_UPDATE_CONTROL_ORIGIN;
const BETA_UPDATE_CONTROL_ORIGIN = WORKERS_DEV_UPDATE_CONTROL_ORIGIN;
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
  // Stable defaults to enabled: the only explicit off-switch is the '0' env
  // flag. `version` is accepted for backward-compatible call signatures and
  // beta-vs-stable channel selection continues to use isBetaBuildVersion()
  // separately in defaultChannel() — it is intentionally not consulted here.
  void version;
  return env.ELITESAND_ENABLE_CLOUDFLARE_UPDATES !== '0';
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
    // 204 is the server explicitly saying "no update" — a real answer, so it
    // maps to `none`. Everything else abnormal here (bad status, wrong
    // content-type, malformed length, unparsable body) means we never got a
    // usable answer at all, so it maps to `unavailable` and lets the caller
    // fall back (e.g. to the GitHub release check) instead of being told
    // "you're up to date" on what was actually a failure to ask.
    if (response.status === 204) return { kind: 'none' };
    if (response.status !== 200) return { kind: 'unavailable' };
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!contentType.startsWith('application/json')) return { kind: 'unavailable' };
    const length = Number.parseInt(response.headers?.get?.('content-length') || '', 10);
    if (Number.isInteger(length) && (length < 1 || length > MAX_PLAN_BYTES)) return { kind: 'unavailable' };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PLAN_BYTES) return { kind: 'unavailable' };
    let plan;
    try { plan = JSON.parse(bytes.toString('utf8')); } catch (_) { return { kind: 'unavailable' }; }
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
    // `unavailable` = the provider could not get an answer at all this time
    // (disabled/misconfigured, fingerprinting failed, network/HTTP failure,
    // malformed response) — the caller should fall back to another source.
    // `none` = we got a real answer and it was "no update" (204, or a
    // response that fails plan verification, including a security rejection
    // like a bad signature/replay/fingerprint mismatch — those must never be
    // softened into `unavailable`, they stay a hard "no").
    if (!canCheck) return { kind: 'unavailable' };
    let installedRuntimeFingerprint;
    try {
      installedRuntimeFingerprint = await runtimeFingerprint({ version: currentVersion, platform, arch, channel: selectedChannel });
    } catch (_) {
      return { kind: 'unavailable' };
    }
    const fingerprint = createRequestFingerprint({ version: currentVersion, platform, arch, channel: selectedChannel, runtimeFingerprint: installedRuntimeFingerprint });
    if (!fingerprint) return { kind: 'unavailable' };
    const url = new URL(base.href);
    url.search = new URLSearchParams({
      version: currentVersion,
      platform,
      arch,
      channel: selectedChannel,
      fingerprint,
    }).toString();
    let result;
    try {
      result = await fetchPlanJson(url, { fetchImpl, connectTimeoutMs, totalTimeoutMs });
    } catch (_) {
      // Network/transport failure: we never got a response to evaluate.
      return { kind: 'unavailable' };
    }
    if (result.kind === 'unavailable') return result;
    if (result.kind !== 'plan') return { kind: 'none' };
    try {
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
      // verifyUpdatePlan/replayGuard threw (e.g. a corrupt local replay
      // store) — this is a fail-closed security rejection, same family as a
      // bad signature or a blocked replay, so it must stay `none` and never
      // relax into `unavailable`'s GitHub-fallback path.
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
      if (!canCheck) return { ok: false, reason: 'update checking is disabled for this build/channel' };
      if (plan?.delivery !== 'incremental') return { ok: false, reason: 'plan delivery is not incremental' };
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
