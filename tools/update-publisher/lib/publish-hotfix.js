'use strict';

const crypto = require('crypto');
const path = require('path');
const policy = require('../../../server/services/update-policy');
const { compareVersions } = require('../../../server/utils/version-compare');

const PLATFORM = 'win32';
const ARCH = 'x64';
const CHANNELS = new Set(['stable', 'beta']);
const VERSION_RE = /^\d+(?:\.\d+){2,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// 這兩個常數只給 CLI 輸出/文件用途，實際發版路徑一律走 policy.artifactOriginForChannel()。
// 沒有自訂網域前跟 update-policy.js 一樣共用同一個 workers.dev 來源，理由見該檔註解。
const BETA_ARTIFACT_ORIGIN = policy.BETA_UPDATE_ARTIFACT_ORIGIN;
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

function normalizeLegacySet(fromVersions, targetVersion) {
  const list = Array.isArray(fromVersions) ? fromVersions : [];
  const values = [...new Set(list.map((value) => assertVersion(String(value).trim(), 'legacy from version')))];
  if (values.length !== list.length) throw new Error('the --legacy-from list must not contain duplicate versions');
  if (values.some((value) => value === targetVersion)) throw new Error('the target version cannot be an incremental baseline');
  if (values.some((value) => compareVersions(value, targetVersion) > 0)) throw new Error('a --legacy-from version is newer than the target version');
  return values.sort(compareVersions);
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

// 已發布版本登記表：記下每個用「一版一包」發布的版本，和它的 Electron/updater runtime
// 指紋。下一版發布時，指紋相同的已登記版本全部共用同一個更新包；換了 Electron 的版本
// 指紋不同，自然不會被列進去（那些使用者改走完整安裝檔）。Worker 不讀這個檔，只有發布工具用。
function registryKey(channel) {
  return `registry/${channel}/${PLATFORM}-${ARCH}.json`;
}

function emptyRegistry() {
  return { schemaVersion: 1, releases: {} };
}

function parseRegistry(bytes) {
  let registry;
  try { registry = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch (_) { throw new Error('release registry is not valid JSON'); }
  const keys = Object.keys(registry || {}).sort();
  if (keys.length !== 2 || keys[0] !== 'releases' || keys[1] !== 'schemaVersion' || registry.schemaVersion !== 1
    || !registry.releases || typeof registry.releases !== 'object' || Array.isArray(registry.releases)) {
    throw new Error('release registry has an unsafe schema');
  }
  for (const [version, entry] of Object.entries(registry.releases)) {
    assertVersion(version, 'registered version');
    if (!entry || typeof entry !== 'object' || !/^[a-f0-9]{64}$/.test(String(entry.runtimeFingerprint || ''))) {
      throw new Error(`release registry entry is invalid for ${version}`);
    }
  }
  return registry;
}

async function readRegistry(store, channel) {
  const current = await store.get(registryKey(channel));
  if (!current) return { registry: emptyRegistry(), etag: null };
  return { registry: parseRegistry(current.body), etag: current.etag || null };
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
  if (inspection.shared === true || inspection.fromVersion !== fromVersion || inspection.version !== targetVersion) throw new Error(`incremental ZIP version mismatch for ${fromVersion}`);
  if (typeof inspection.baselineRuntimeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(inspection.baselineRuntimeFingerprint)) {
    throw new Error(`incremental ZIP has no valid immutable runtime fingerprint for ${fromVersion}`);
  }
}

function assertSharedUpdate(inspection, targetVersion) {
  if (!inspection || inspection.ok !== true || inspection.shared !== true) throw new Error('shared update ZIP inspection failed');
  if (inspection.version !== targetVersion) throw new Error('shared update ZIP version mismatch');
  if (typeof inspection.baselineRuntimeFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(inspection.baselineRuntimeFingerprint)) {
    throw new Error('shared update ZIP has no valid immutable runtime fingerprint');
  }
}

async function readPublicArtifact(readArtifact, url) {
  const bytes = await readArtifact(url);
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error('public artifact read did not return bytes');
  return Buffer.from(bytes);
}

function asZip(artifact, label) {
  const zip = Buffer.from(artifact?.zip || artifact || []);
  if (!zip.length) throw new Error(`incremental builder returned no ZIP for ${label}`);
  return zip;
}

/**
 * 發布一個版本（一版一包）。
 *
 * - 共用包只打包一次，放在 artifacts/<channel>/<目標版>/<目標版>/update.zip。
 * - 登記表裡 runtime 指紋跟新版相同、版本比較舊的每一版，各簽一份很小的計畫指向這個共用包。
 * - legacyFromVersions 只給「還不認得共用包的舊程式」（這套改法上線前發的版本）：
 *   照舊替每一版各打一包。不給就代表那些版本改走完整安裝檔。
 * - 對照表每次都整份重建成「現在能升到新版的所有版本」；沒列到的版本會拿到 404，
 *   程式改問 GitHub，提示使用者下載完整安裝檔。
 * - 新版本身一定會被寫進登記表，下一版才會把它列進共用名單；換 Electron 的版本也要跑，
 *   這時共用名單是空的，只會登記、清空對照表。
 */
async function runHotfixRelease({
  targetVersion,
  legacyFromVersions = [],
  channel = 'stable',
  privateKey,
  keyId,
  releaseNotesUrl,
  sharedBuilder,
  legacyBuilder,
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
  const legacySet = normalizeLegacySet(legacyFromVersions, targetVersion);
  if (channel === 'beta' && legacySet.length > 1) throw new Error('beta releases support at most one legacy beta baseline');
  if (!privateKey || typeof keyId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(keyId)) throw new Error('a release-only update policy signing key and key id are required');
  if (!allowTestKey && /(?:^|[-_.])test(?:$|[-_.])/i.test(keyId)) throw new Error('refusing to publish with a test update policy key');
  if (!allowTestKey && !policy.isUpdatePolicyKeyAllowedForChannel(keyId, channel)) throw new Error(`policy key ${keyId} is not allowed for the ${channel} channel`);
  if (typeof sharedBuilder !== 'function' || typeof inspectIncremental !== 'function') throw new Error('sharedBuilder and inspectIncremental are required');
  if (legacySet.length && typeof legacyBuilder !== 'function') throw new Error('legacyBuilder is required for --legacy-from versions');
  if (!/^https:\/\//.test(String(releaseNotesUrl || ''))) throw new Error('releaseNotesUrl must be HTTPS');
  if (!dryRun && (!store || typeof store.get !== 'function' || typeof store.putImmutable !== 'function' || typeof store.putControlIfMatch !== 'function')) {
    throw new Error('publish requires a conditional R2 store');
  }

  await runChecks();
  // 上限估計：共用包最多 1 個＋每個 legacy 版本 1 個。要在打包前檢查，不浪費一次打包。
  if (!dryRun && channel === 'beta') await assertBetaRetentionCapacity(store, 1 + legacySet.length);
  // 試跑沒有 R2 也能跑；有給 store（唯讀）就照實際登記表算共用名單。
  const { registry, etag: registryEtag } = store && typeof store.get === 'function'
    ? await readRegistry(store, channel)
    : { registry: emptyRegistry(), etag: null };

  const sharedZip = asZip(await sharedBuilder({ targetVersion, channel }), 'the shared package');
  const sharedInspection = await inspectIncremental(sharedZip, { fromVersion: null, targetVersion });
  assertSharedUpdate(sharedInspection, targetVersion);
  const runtimeFingerprint = sharedInspection.baselineRuntimeFingerprint;

  const registeredTarget = registry.releases[targetVersion];
  if (registeredTarget && registeredTarget.runtimeFingerprint !== runtimeFingerprint) {
    throw new Error(`v${targetVersion} is already registered with a different runtime fingerprint`);
  }
  const sharedSet = Object.entries(registry.releases)
    .filter(([version, entry]) => entry.runtimeFingerprint === runtimeFingerprint && compareVersions(version, targetVersion) < 0)
    .map(([version]) => version)
    .sort(compareVersions);
  const overlap = legacySet.filter((version) => sharedSet.includes(version));
  if (overlap.length) throw new Error(`${overlap.join(', ')} already receive the shared package; remove them from --legacy-from`);

  const issuedAt = now().toISOString();
  const expiresAt = new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const signingPublicKey = policy.publicKeyHexFromPrivateKey(privateKey);
  const sharedArtifact = { key: artifactKey(channel, targetVersion, targetVersion), zip: sharedZip };
  const legacyArtifacts = [];

  function signPlan(fromVersion, artifact) {
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
      expiresAt,
      releaseNotesUrl,
      artifact: { url: `${policy.artifactOriginForChannel(channel)}/${artifact.key}`, sha256: sha256(artifact.zip), size: artifact.zip.length },
      installer: null,
    }, privateKey, { keyId });
    const verified = policy.verifyUpdatePlan(signedPlan, {
      currentVersion: fromVersion, channel, platform: PLATFORM, arch: ARCH,
      publicKeys: { [keyId]: signingPublicKey }, nowMs: now().getTime(),
    });
    if (!verified.ok) throw new Error(`generated signed plan did not verify: ${verified.reason}`);
    return { fromVersion, shared: artifact === sharedArtifact, plan: signedPlan, artifactKey: artifact.key, planKey: planKey(channel, fromVersion, planId) };
  }

  const planned = sharedSet.map((fromVersion) => signPlan(fromVersion, sharedArtifact));
  // 舊程式只認綁定單一來源版本的包，照舊一版一包；刻意逐一打包，不同時跑兩個打包流程。
  for (const fromVersion of legacySet) {
    const zip = asZip(await legacyBuilder({ fromVersion, targetVersion, channel }), fromVersion);
    assertInnerUpdate(await inspectIncremental(zip, { fromVersion, targetVersion }), fromVersion, targetVersion);
    const artifact = { key: artifactKey(channel, fromVersion, targetVersion), zip };
    legacyArtifacts.push(artifact);
    planned.push(signPlan(fromVersion, artifact));
  }

  const summary = (entry) => ({ fromVersion: entry.fromVersion, shared: entry.shared, plan: entry.plan, artifactKey: entry.artifactKey, planKey: entry.planKey });
  if (dryRun) return Object.freeze({ dryRun: true, targetVersion, channel, runtimeFingerprint, plans: planned.map(summary) });

  // Immutable objects are written before the control pointer. A failure can
  // leave unreachable blobs, but it can never publish a partial release.
  const artifacts = [...(sharedSet.length ? [sharedArtifact] : []), ...legacyArtifacts];
  for (const artifact of artifacts) {
    await store.putImmutable(artifact.key, artifact.zip, {
      contentType: 'application/zip', cacheControl: 'public, max-age=31536000, immutable',
    });
    const url = `${policy.artifactOriginForChannel(channel)}/${artifact.key}`;
    const publicZip = await readPublicArtifact(publicArtifactRead, url);
    if (publicZip.length !== artifact.zip.length || sha256(publicZip) !== sha256(artifact.zip)) {
      throw new Error(`public artifact read-back mismatch for ${artifact.key}`);
    }
  }
  for (const entry of planned) {
    const planBytes = Buffer.from(JSON.stringify(entry.plan), 'utf8');
    await store.putImmutable(entry.planKey, planBytes, {
      contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable',
    });
    const storedPlan = await store.get(entry.planKey);
    if (!storedPlan || !equalBytes(storedPlan.body, planBytes)) throw new Error(`stored signed plan read-back mismatch for ${entry.fromVersion}`);
  }

  // 先登記新版再切對照表：就算後面切換失敗，多登記一個「還沒人裝」的版本也無害，
  // 反過來（已上線卻沒登記）才會讓下一版漏掉這一版的使用者。
  if (!registeredTarget) {
    const nextRegistry = {
      schemaVersion: 1,
      releases: { ...registry.releases, [targetVersion]: { runtimeFingerprint, recordedAt: issuedAt } },
    };
    const registryBytes = Buffer.from(JSON.stringify(nextRegistry, null, 2), 'utf8');
    const registryOptions = { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' };
    const written = registryEtag
      ? await store.putControlIfMatch(registryKey(channel), registryBytes, registryEtag, registryOptions)
      : await store.putImmutable(registryKey(channel), registryBytes, registryOptions);
    if (!written) throw new Error('release registry conditional write failed (another publish is running?)');
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

  return Object.freeze({ dryRun: false, targetVersion, channel, runtimeFingerprint, plans: planned.map(summary), controlKey: pointerKey });
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

function createPowerShellSharedBuilder({ projectRoot, outputRoot, spawnSyncImpl } = {}) {
  if (typeof spawnSyncImpl !== 'function') throw new TypeError('a spawnSync implementation is required');
  const root = path.resolve(projectRoot || path.join(__dirname, '..', '..', '..'));
  return async () => {
    const output = path.join(path.resolve(outputRoot), 'shared');
    const result = spawnSyncImpl('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools', 'build-update.ps1'),
      '-Shared', '-OutputRoot', output,
    ], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'inherit' });
    if (result?.status !== 0) throw new Error('shared incremental build failed');
    return { zip: require('fs').readFileSync(path.join(output, 'update.zip')) };
  };
}

module.exports = {
  ARCH,
  BETA_ARTIFACT_ORIGIN,
  MAX_BETA_ARTIFACTS,
  PLATFORM,
  assertBetaRetentionCapacity,
  artifactKey,
  artifactUrl,
  controlKey,
  createPowerShellArtifactBuilder,
  createPowerShellSharedBuilder,
  emptyRegistry,
  makePlanId,
  normalizeLegacySet,
  parseRegistry,
  registryKey,
  isBetaArtifactKey,
  parseControl,
  planKey,
  runHotfixRelease,
};
