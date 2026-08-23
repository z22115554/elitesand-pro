'use strict';

const crypto = require('crypto');
const { compareVersions } = require('../utils/version-compare');
const {
  UPDATE_POLICY_SIGNATURE_ALGORITHM,
  UPDATE_POLICY_PUBLIC_KEYS,
  getUpdatePolicyPublicKey,
  isUpdatePolicyKeyAllowedForChannel,
} = require('./update-policy-public-keys');

const UPDATE_POLICY_SCHEMA_VERSION = 1;
const MAX_UPDATE_ZIP_BYTES = 384 * 1024 * 1024;
const MAX_CLOCK_FUTURE_MS = 5 * 60 * 1000;
const MAX_PLAN_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const PLAN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,159}$/;
const KEY_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const VERSION_RE = /^v?\d+(?:\.\d+){2,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SIGNATURE_RE = /^[a-f0-9]{128}$/;
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion', 'planId', 'keyId', 'channel', 'platform', 'arch',
  'fromVersion', 'targetVersion', 'delivery', 'urgency', 'reasonCode',
  'issuedAt', 'expiresAt', 'releaseNotesUrl', 'artifact', 'installer',
  'signatureAlgorithm', 'signature',
]);
const ARTIFACT_KEYS = Object.freeze(['url', 'sha256', 'size']);
const INSTALLER_KEYS = Object.freeze(['url', 'sha256', 'size']);
const ALLOWED_CHANNELS = new Set(['stable', 'beta']);
const ALLOWED_DELIVERIES = new Set(['incremental', 'installer']);
const ALLOWED_URGENCIES = new Set(['optional', 'required']);
const ALLOWED_REASON_CODES = new Set(['hotfix', 'major-release', 'owner-forced', 'security']);
const UPDATE_ARTIFACT_ORIGIN = 'https://updates.elitesand.pro';
const BETA_UPDATE_ARTIFACT_ORIGIN = 'https://elitesand-update-artifacts.elitesand.workers.dev';
const OFFICIAL_GITHUB_OWNER = 'z22115554';
const OFFICIAL_GITHUB_REPOSITORY = 'elitesand-pro';
const INSTALLER_NAME_RE = /^Elitesand[ .]Pro[ .]Setup[ .]\d+(?:\.\d+){2,3}(?:[-.][^/]+)?\.exe$/i;

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalPlanBytes(plan) {
  const { signature, ...unsigned } = plan || {};
  return Buffer.from(canonicalize(unsigned), 'utf8');
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isNonEmptyString(value, maxLength = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isVersion(value) {
  return typeof value === 'string' && value.length <= 64 && VERSION_RE.test(value);
}

function parseIsoTime(value) {
  if (typeof value !== 'string' || !ISO_TIME_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function parseHttpsUrl(value) {
  if (!isNonEmptyString(value, 2048)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function artifactOriginForChannel(channel) {
  return channel === 'beta' ? BETA_UPDATE_ARTIFACT_ORIGIN : UPDATE_ARTIFACT_ORIGIN;
}

function isExactIncrementalArtifactUrl(value, plan) {
  const url = parseHttpsUrl(value);
  if (!url || url.origin !== artifactOriginForChannel(plan?.channel) || url.search) return false;
  const expectedPath = `/artifacts/${plan.channel}/${plan.fromVersion}/${plan.targetVersion}/update.zip`;
  return url.pathname === expectedPath;
}

function isExactInstallerUrl(value, plan) {
  const url = parseHttpsUrl(value);
  if (!url || url.hostname !== 'github.com' || url.search) return false;
  const expectedPrefix = `/${OFFICIAL_GITHUB_OWNER}/${OFFICIAL_GITHUB_REPOSITORY}/releases/download/v${plan.targetVersion}/`;
  if (!url.pathname.startsWith(expectedPrefix)) return false;
  const encodedFilename = url.pathname.slice(expectedPrefix.length);
  if (!encodedFilename || encodedFilename.includes('/') || /%2f|%5c/i.test(encodedFilename)) return false;
  let filename;
  try { filename = decodeURIComponent(encodedFilename); } catch (_) { return false; }
  if (filename.includes('/') || filename.includes('\\')) return false;
  return INSTALLER_NAME_RE.test(filename);
}

function validateArtifactShape(artifact, plan) {
  if (!hasExactKeys(artifact, ARTIFACT_KEYS)) return 'artifact 欄位不合法';
  if (!isExactIncrementalArtifactUrl(artifact.url, plan)) return 'incremental artifact URL 不受信任';
  if (typeof artifact.sha256 !== 'string' || !SHA256_RE.test(artifact.sha256)) return 'artifact sha256 格式不合法';
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_UPDATE_ZIP_BYTES) return 'artifact size 超出限制';
  return null;
}

function validateInstallerShape(installer, plan) {
  if (!hasExactKeys(installer, INSTALLER_KEYS)) return 'installer 欄位不合法';
  if (!isExactInstallerUrl(installer.url, plan)) return 'installer URL 不受信任';
  if (typeof installer.sha256 !== 'string' || !SHA256_RE.test(installer.sha256)) return 'installer sha256 格式不合法';
  if (!Number.isSafeInteger(installer.size) || installer.size <= 0 || installer.size > MAX_UPDATE_ZIP_BYTES * 4) return 'installer size 超出限制';
  return null;
}

function validateUpdatePlanShape(plan) {
  if (!hasExactKeys(plan, TOP_LEVEL_KEYS)) return 'update plan 欄位不合法或含未知欄位';
  if (plan.schemaVersion !== UPDATE_POLICY_SCHEMA_VERSION) return `不支援的 update plan schemaVersion: ${plan.schemaVersion}`;
  if (!isNonEmptyString(plan.planId, 160) || !PLAN_ID_RE.test(plan.planId)) return 'planId 格式不合法';
  if (!isNonEmptyString(plan.keyId, 128) || !KEY_ID_RE.test(plan.keyId)) return 'keyId 格式不合法';
  if (!ALLOWED_CHANNELS.has(plan.channel)) return 'channel 不受支援';
  if (plan.platform !== 'win32' || plan.arch !== 'x64') return 'platform 或 arch 不受支援';
  if (!isVersion(plan.fromVersion) || !isVersion(plan.targetVersion)) return '版本格式不合法';
  if (!ALLOWED_DELIVERIES.has(plan.delivery)) return 'delivery 不受支援';
  if (!ALLOWED_URGENCIES.has(plan.urgency)) return 'urgency 不受支援';
  if (!ALLOWED_REASON_CODES.has(plan.reasonCode)) return 'reasonCode 不受支援';
  if (parseIsoTime(plan.issuedAt) === null || parseIsoTime(plan.expiresAt) === null) return 'issuedAt 或 expiresAt 格式不合法';
  if (!parseHttpsUrl(plan.releaseNotesUrl)) return 'releaseNotesUrl 必須是 HTTPS URL';
  if (plan.signatureAlgorithm !== UPDATE_POLICY_SIGNATURE_ALGORITHM) return `signatureAlgorithm 必須是 ${UPDATE_POLICY_SIGNATURE_ALGORITHM}`;
  if (typeof plan.signature !== 'string' || !SIGNATURE_RE.test(plan.signature)) return 'signature 缺少或格式不合法';

  if (plan.delivery === 'incremental') {
    if (plan.installer !== null) return 'incremental plan 不得包含 installer';
    const artifactError = validateArtifactShape(plan.artifact, plan);
    if (artifactError) return artifactError;
  } else {
    if (plan.artifact !== null) return 'installer plan 不得包含 artifact';
    const installerError = validateInstallerShape(plan.installer, plan);
    if (installerError) return installerError;
  }

  if (plan.urgency === 'required' && !['major-release', 'owner-forced'].includes(plan.reasonCode)) return 'required plan 必須是 major-release 或 owner-forced';
  if (plan.urgency === 'optional' && plan.delivery !== 'incremental') return 'optional plan 只能使用 incremental delivery';
  if (plan.delivery === 'installer' && plan.urgency !== 'required') return 'installer plan 必須是 required';
  if (plan.reasonCode === 'major-release' && plan.delivery !== 'installer') return 'major-release 必須使用 Installer';
  if (plan.reasonCode === 'owner-forced' && plan.urgency !== 'required') return 'owner-forced 必須是 required';
  if (plan.reasonCode === 'security' && plan.urgency === 'required') return 'security 必須由發版者明確簽成 owner-forced 才可阻擋';
  return null;
}

function loadEd25519PublicKey(publicKeyHex) {
  if (typeof publicKeyHex !== 'string' || !/^[a-f0-9]{88}$/i.test(publicKeyHex)) throw new Error('update policy public key 格式不合法');
  const key = crypto.createPublicKey({ key: Buffer.from(publicKeyHex, 'hex'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('update policy public key 必須是 Ed25519');
  return key;
}

function normalizePrivateKey(privateKey) {
  const key = privateKey instanceof crypto.KeyObject ? privateKey : crypto.createPrivateKey(privateKey);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw new Error('update policy private key 必須是 Ed25519 private key');
  return key;
}

function publicKeyHexFromPrivateKey(privateKey) {
  return crypto.createPublicKey(normalizePrivateKey(privateKey)).export({ format: 'der', type: 'spki' }).toString('hex');
}

function signUpdatePlan(plan, privateKey, { keyId } = {}) {
  const unsigned = {
    ...plan,
    keyId: keyId || plan?.keyId,
    signatureAlgorithm: UPDATE_POLICY_SIGNATURE_ALGORITHM,
    signature: '0'.repeat(128),
  };
  const shapeError = validateUpdatePlanShape(unsigned);
  if (shapeError) throw new Error(`無法簽署 update plan：${shapeError}`);
  const signature = crypto.sign(null, canonicalPlanBytes(unsigned), normalizePrivateKey(privateKey)).toString('hex');
  return { ...unsigned, signature };
}

function replayKey(plan) {
  return `${plan.channel}/${plan.platform}/${plan.arch}`;
}

function createInMemoryReplayGuard() {
  const values = new Map();
  return {
    get(key) { return values.get(key) || null; },
    set(key, value) { values.set(key, { issuedAt: value.issuedAt, planId: value.planId }); },
  };
}

function checkReplay(plan, replayGuard) {
  if (!replayGuard) return null;
  if (typeof replayGuard.get !== 'function' || typeof replayGuard.set !== 'function') return 'replay guard 介面不合法';
  const key = replayKey(plan);
  const previous = replayGuard.get(key);
  const issuedAt = parseIsoTime(plan.issuedAt);
  if (previous) {
    const previousIssuedAt = parseIsoTime(previous.issuedAt);
    if (previousIssuedAt === null || typeof previous.planId !== 'string') return '本機 replay guard 資料不合法';
    if (issuedAt < previousIssuedAt) return 'update plan 比已接受的政策舊（replay）';
    if (issuedAt === previousIssuedAt && plan.planId !== previous.planId) return '同一 issuedAt 的不同 update plan 被拒絕（replay）';
  }
  replayGuard.set(key, { issuedAt: plan.issuedAt, planId: plan.planId });
  return null;
}

function verifyUpdatePlan(plan, options = {}) {
  const shapeError = validateUpdatePlanShape(plan);
  if (shapeError) return { ok: false, reason: shapeError };

  const currentVersion = options.currentVersion;
  if (!isVersion(currentVersion) || plan.fromVersion !== currentVersion) return { ok: false, reason: 'update plan fromVersion 與目前版本不一致' };
  if (compareVersions(plan.targetVersion, currentVersion) <= 0) return { ok: false, reason: 'update plan 目標版本沒有比目前版本新' };
  if (options.channel && plan.channel !== options.channel) return { ok: false, reason: 'update plan channel 不一致' };
  if (options.platform && plan.platform !== options.platform) return { ok: false, reason: 'update plan platform 不一致' };
  if (options.arch && plan.arch !== options.arch) return { ok: false, reason: 'update plan arch 不一致' };

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const issuedAtMs = parseIsoTime(plan.issuedAt);
  const expiresAtMs = parseIsoTime(plan.expiresAt);
  const maxFutureMs = Number.isSafeInteger(options.maxFutureMs) ? options.maxFutureMs : MAX_CLOCK_FUTURE_MS;
  const maxLifetimeMs = Number.isSafeInteger(options.maxLifetimeMs) ? options.maxLifetimeMs : MAX_PLAN_LIFETIME_MS;
  if (issuedAtMs > nowMs + maxFutureMs) return { ok: false, reason: 'update plan issuedAt 過於未來' };
  if (expiresAtMs <= nowMs) return { ok: false, reason: 'update plan 已過期' };
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > maxLifetimeMs) return { ok: false, reason: 'update plan 有效期限不合法' };

  const publicKeys = options.publicKeys || UPDATE_POLICY_PUBLIC_KEYS;
  const publicKeyHex = getUpdatePolicyPublicKey(plan.keyId, publicKeys);
  if (!publicKeyHex) return { ok: false, reason: `update plan keyId 不受信任：${plan.keyId}` };
  if (!options.publicKeys && !isUpdatePolicyKeyAllowedForChannel(plan.keyId, plan.channel)) {
    return { ok: false, reason: `update plan keyId 不允許用於 ${plan.channel} channel：${plan.keyId}` };
  }
  try {
    const valid = crypto.verify(null, canonicalPlanBytes(plan), loadEd25519PublicKey(publicKeyHex), Buffer.from(plan.signature, 'hex'));
    if (!valid) return { ok: false, reason: 'update plan Ed25519 驗章失敗' };
  } catch (error) {
    return { ok: false, reason: `update plan Ed25519 驗章失敗：${error.message}` };
  }

  const replayError = checkReplay(plan, options.replayGuard);
  if (replayError) return { ok: false, reason: replayError };
  return { ok: true, plan: { ...plan } };
}

module.exports = {
  UPDATE_POLICY_SCHEMA_VERSION,
  UPDATE_POLICY_SIGNATURE_ALGORITHM,
  UPDATE_POLICY_PUBLIC_KEYS,
  UPDATE_ARTIFACT_ORIGIN,
  BETA_UPDATE_ARTIFACT_ORIGIN,
  MAX_UPDATE_ZIP_BYTES,
  MAX_CLOCK_FUTURE_MS,
  MAX_PLAN_LIFETIME_MS,
  canonicalize,
  canonicalPlanBytes,
  artifactOriginForChannel,
  validateUpdatePlanShape,
  isUpdatePolicyKeyAllowedForChannel,
  isExactIncrementalArtifactUrl,
  isExactInstallerUrl,
  loadEd25519PublicKey,
  normalizePrivateKey,
  publicKeyHexFromPrivateKey,
  signUpdatePlan,
  createInMemoryReplayGuard,
  verifyUpdatePlan,
};
