'use strict';

const crypto = require('crypto');
const path = require('path');
const policy = require('../../../server/services/update-policy');

const PLATFORM = 'win32';
const ARCH = 'x64';
const CHANNELS = new Set(['stable', 'beta']);
const VERSION_RE = /^\d+(?:\.\d+){2,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ARTIFACT_ORIGIN = 'https://updates.elitesand.pro';
const BETA_ARTIFACT_ORIGIN = 'https://elitesand-update-artifacts.elitesand.workers.dev';
const MAX_BETA_ARTIFACTS = 8;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function equalBytes(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertVersion(value, name) {
  if (typeof value !== 'string' || !VERSION_RE.test(value)) throw new Error(`${name} is not a supported version`);
  return value;
}

function normalizeSupportSet(fromVersions, targetVersion) {
  if (!Array.isArray(fromVersions) || fromVersions.length === 0) throw new Error('an explicit non-empty --from support set is required');
  const values = [...new Set(fromVersions.map((value) => assertVersion(String(value).trim(), 'from version')))];
  if (values.length !== fromVersions.length) throw new Error('the --from support set must not contain duplicate versions');
  if (values.some((value) => value === targetVersion)) throw new Error('the target version cannot be an incremental baseline');
  return values.sort();
}

function artifactKey(channel, fromVersion, targetVersion) {
  return `artifacts/${channel}/${fromVersion}/${targetVersion}/update.zip`;
}

function artifactUrl(channel, fromVersion, targetVersion) {
  return `${policy.artifactOriginForChannel(channel)}/${artifactKey(channel, fromVersion, targetVersion)}`;
}

function isBetaArtifactKey(key) {
  return typeof key === 'string' && /^artifacts\/beta\/[^/]+\/[^/]+\/update\.zip$/.test(key);
}

async function assertBetaRetentionCapacity(store, incomingCount) {
  if (!store || typeof store.listPrefix !== 'function') throw new Error('beta publish requires an R2 store that can list the beta artifact prefix');
  const existing = (await store.listPrefix('artifacts/beta/')).filter(isBetaArtifactKey);
  if (existing.length + incomingCount > MAX_BETA_ARTIFACTS) {
    throw new Error(`beta artifact retention limit reached (${existing.length}/${MAX_BETA_ARTIFACTS}); explicitly retire expired beta artifacts before publishing`);
  }
  return existing;
}

function controlKey(channel) {
  return `control/${channel}/${PLATFORM}-${ARCH}.json`;
}

function planKey(channel, fromVersion, planId) {
  return `plans/${channel}/${PLATFORM}-${ARCH}/${fromVersion}/${planId}.json`;
}

function parseControl(bytes) {
  let control;
  try { control = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch (_) { throw new Error('current update control is not valid JSON'); }
  const keys = Object.keys(control || {}).sort();
  if (keys.length !== 3 || keys[0] !== 'disabled' || keys[1] !== 'plans' || keys[2] !== 'schemaVersion' || control.schemaVersion !== 1 || typeof control.disabled !== 'boolean' || !control.plans || typeof control.plans !== 'object' || Array.isArray(control.plans)) {
    throw new Error('current update control has an unsafe schema');
  }
  return control;
}

function makePlanId(channel, fromVersion, targetVersion, issuedAt) {
  const timestamp = issuedAt.replace(/[-:.TZ]/g, '').toLowerCase();
  return `${channel}-${PLATFORM}-${ARCH}-${fromVersion}-${targetVersion}-${timestamp}`.toLowerCase();
}

function assertInnerUpdate(inspection, fromVersion, targetVersion) {
  if (!inspection || inspection.ok !== true) throw new Error(`incremental ZIP inspection failed for ${fromVersion}`);
  if (inspection.fromVersion !== fromVersion || inspection.version !== targetVersion) throw new Error(`incremental ZIP version mismatch for ${fromVersion}`);
  if (typeof inspection.baselineRuntimeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(inspection.baselineRuntimeFingerprint)) {
    throw new Error(`incremental ZIP has no valid immutable runtime fingerprint for ${fromVersion}`);
  }
}

async function readPublicArtifact(readArtifact, url) {
  const bytes = await readArtifact(url);
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error('public artifact read did not return bytes');
  return Buffer.from(bytes);
}

async function runHotfixRelease({
  targetVersion,
  fromVersions,
  channel = 'stable',
  privateKey,
  keyId,
  releaseNotesUrl,
  artifactBuilder,
  inspectIncremental,
  store,
  publicArtifactRead,
  workerProbe,
  now = () => new Date(),
  dryRun = true,
  runChecks = async () => {},
  allowTestKey = false,
} = {}) {
  assertVersion(targetVersion, 'target version');
  if (!CHANNELS.has(channel)) throw new Error('unsupported release channel');
  const supportSet = normalizeSupportSet(fromVersions, targetVersion);
  if (channel === 'beta' && supportSet.length !== 1) throw new Error('beta releases support exactly one installed beta baseline');
  if (!privateKey || typeof keyId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(keyId)) throw new Error('a release-only update policy signing key and key id are required');
  if (!allowTestKey && /(?:^|[-_.])test(?:$|[-_.])/i.test(keyId)) throw new Error('refusing to publish with a test update policy key');
  if (!allowTestKey && !policy.isUpdatePolicyKeyAllowedForChannel(keyId, channel)) throw new Error(`policy key ${keyId} is not allowed for the ${channel} channel`);
  if (typeof artifactBuilder !== 'function' || typeof inspectIncremental !== 'function') throw new Error('artifactBuilder and inspectIncremental are required');
  if (!/^https:\/\//.test(String(releaseNotesUrl || ''))) throw new Error('releaseNotesUrl must be HTTPS');
  if (!dryRun && (!store || typeof store.get !== 'function' || typeof store.putImmutable !== 'function' || typeof store.putControlIfMatch !== 'function')) {
    throw new Error('publish requires a conditional R2 store');
  }

  await runChecks();
  if (!dryRun && channel === 'beta') await assertBetaRetentionCapacity(store, supportSet.length);
  const issuedAt = now().toISOString();
  const signingPublicKey = policy.publicKeyHexFromPrivateKey(privateKey);
  const planned = [];

  // This loop is intentionally serial: a release never launches two packaging
  // builds at once, and every source version has an exact ZIP.
  for (const fromVersion of supportSet) {
    const artifact = await artifactBuilder({ fromVersion, targetVersion, channel });
    const zip = Buffer.from(artifact?.zip || artifact);
    if (!zip.length) throw new Error(`incremental builder returned no ZIP for ${fromVersion}`);
    const inspection = await inspectIncremental(zip, { fromVersion, targetVersion });
    assertInnerUpdate(inspection, fromVersion, targetVersion);
    const planId = makePlanId(channel, fromVersion, targetVersion, issuedAt);
    const signedPlan = policy.signUpdatePlan({
      schemaVersion: 1,
      planId,
      keyId,
      channel,
      platform: PLATFORM,
      arch: ARCH,
      fromVersion,
      targetVersion,
      delivery: 'incremental',
      urgency: 'optional',
      reasonCode: 'hotfix',
      issuedAt,
      expiresAt: new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      releaseNotesUrl,
      artifact: { url: artifactUrl(channel, fromVersion, targetVersion), sha256: sha256(zip), size: zip.length },
      installer: null,
    }, privateKey, { keyId });
    const verified = policy.verifyUpdatePlan(signedPlan, {
      currentVersion: fromVersion, channel, platform: PLATFORM, arch: ARCH,
      publicKeys: { [keyId]: signingPublicKey }, nowMs: now().getTime(),
    });
    if (!verified.ok) throw new Error(`generated signed plan did not verify: ${verified.reason}`);
    planned.push({ fromVersion, zip, inspection, plan: signedPlan, artifactKey: artifactKey(channel, fromVersion, targetVersion), planKey: planKey(channel, fromVersion, planId) });
  }

  if (dryRun) return Object.freeze({ dryRun: true, targetVersion, channel, plans: planned.map(({ zip, ...entry }) => entry) });

  // Immutable objects are written before the control pointer. A failure can
  // leave unreachable blobs, but it can never publish a partial release.
  for (const entry of planned) {
    await store.putImmutable(entry.artifactKey, entry.zip, {
      contentType: 'application/zip', cacheControl: 'public, max-age=31536000, immutable',
    });
    const publicZip = await readPublicArtifact(publicArtifactRead, entry.plan.artifact.url);
    if (publicZip.length !== entry.zip.length || sha256(publicZip) !== entry.plan.artifact.sha256) {
      throw new Error(`public artifact read-back mismatch for ${entry.fromVersion}`);
    }
    const planBytes = Buffer.from(JSON.stringify(entry.plan), 'utf8');
    await store.putImmutable(entry.planKey, planBytes, {
      contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable',
    });
    const storedPlan = await store.get(entry.planKey);
    if (!storedPlan || !equalBytes(storedPlan.body, planBytes)) throw new Error(`stored signed plan read-back mismatch for ${entry.fromVersion}`);
  }

  const pointerKey = controlKey(channel);
  const previous = await store.get(pointerKey);
  if (!previous?.etag) throw new Error('control pointer must already exist and include an ETag');
  parseControl(previous.body);
  const nextControl = {
    schemaVersion: 1,
    disabled: false,
    plans: Object.fromEntries(planned.map((entry) => [entry.fromVersion, entry.planKey])),
  };
  const nextBytes = Buffer.from(JSON.stringify(nextControl), 'utf8');
  const switched = await store.putControlIfMatch(pointerKey, nextBytes, previous.etag, {
    contentType: 'application/json; charset=utf-8', cacheControl: 'no-store',
  });
  if (!switched?.etag) throw new Error('control pointer conditional write failed');

  try {
    if (typeof workerProbe !== 'function') throw new Error('workerProbe is required after a control switch');
    for (const entry of planned) {
      const workerBytes = await workerProbe({ version: entry.fromVersion, platform: PLATFORM, arch: ARCH, channel });
      const expected = Buffer.from(JSON.stringify(entry.plan), 'utf8');
      if (!equalBytes(workerBytes, expected)) throw new Error(`Worker plan bytes mismatch for ${entry.fromVersion}`);
    }
  } catch (error) {
    const rolledBack = await store.putControlIfMatch(pointerKey, previous.body, switched.etag, {
      contentType: 'application/json; charset=utf-8', cacheControl: 'no-store',
    });
    if (!rolledBack?.etag) throw new Error(`Worker verification failed and control rollback could not be confirmed: ${error.message}`);
    throw error;
  }

  return Object.freeze({ dryRun: false, targetVersion, channel, plans: planned.map(({ zip, ...entry }) => entry), controlKey: pointerKey });
}

function createPowerShellArtifactBuilder({ projectRoot, baselineDirectory, outputRoot, spawnSyncImpl } = {}) {
  if (typeof spawnSyncImpl !== 'function') throw new TypeError('a spawnSync implementation is required');
  const root = path.resolve(projectRoot || path.join(__dirname, '..', '..', '..'));
  return async ({ fromVersion }) => {
    const baseline = path.join(path.resolve(baselineDirectory), `v${fromVersion}`, 'installer', 'incremental-baseline.json');
    const output = path.join(path.resolve(outputRoot), `from-${fromVersion}`);
    const result = spawnSyncImpl('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools', 'build-update.ps1'),
      '-BaselineManifest', baseline, '-OutputRoot', output,
    ], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'inherit' });
    if (result?.status !== 0) throw new Error(`incremental build failed for ${fromVersion}`);
    const zipPath = path.join(output, 'update.zip');
    return { zip: require('fs').readFileSync(zipPath) };
  };
}

module.exports = {
  ARCH,
  ARTIFACT_ORIGIN,
  BETA_ARTIFACT_ORIGIN,
  MAX_BETA_ARTIFACTS,
  PLATFORM,
  assertBetaRetentionCapacity,
  artifactKey,
  artifactUrl,
  controlKey,
  createPowerShellArtifactBuilder,
  makePlanId,
  normalizeSupportSet,
  isBetaArtifactKey,
  parseControl,
  planKey,
  runHotfixRelease,
};
