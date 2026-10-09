'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const policy = require('../../../server/services/update-policy');
const { buildProcessInvocation, describeRelease, parseArgs } = require('../cli');
const {
  BETA_ARTIFACT_ORIGIN, MAX_BETA_ARTIFACTS, artifactKey, controlKey, registryKey, runHotfixRelease,
} = require('../lib/publish-hotfix');
const { createFakeR2Endpoint } = require('./fake-r2-endpoint');

const TEST_PRIVATE_KEY = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'update-policy-test-private.pem'), 'utf8');
const TEST_KEY_ID = 'update-policy-test-fixture';
const TEST_PUBLIC_KEYS = { [TEST_KEY_ID]: policy.publicKeyHexFromPrivateKey(TEST_PRIVATE_KEY) };
const RUNTIME = 'b'.repeat(64);
const OTHER_RUNTIME = 'c'.repeat(64);
const now = () => new Date('2026-08-23T00:00:00.000Z');

test('Windows release gates run npm.cmd through cmd.exe without shell mode', () => {
  assert.deepStrictEqual(
    buildProcessInvocation('npm.cmd', ['run', 'smoke:electron'], { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' }),
    { executable: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd run smoke:electron'] },
  );
  assert.deepStrictEqual(
    buildProcessInvocation('npm', ['test'], { platform: 'linux' }),
    { executable: 'npm', args: ['test'] },
  );
});

test('the CLI no longer takes a hand-written --from list; --legacy-from is the only per-version option', () => {
  assert.throws(() => parseArgs(['--version', '1.2.0', '--from', '1.1.0']), /--from is gone/);
  assert.deepStrictEqual(parseArgs(['--version', '1.2.0', '--legacy-from', '1.0.9,1.1.0', '--publish']),
    { publish: true, legacyFrom: '1.0.9,1.1.0', version: '1.2.0', channel: 'stable', notesUrl: '' });
});

function inspector(_zip, { fromVersion, targetVersion }) {
  return {
    ok: true,
    shared: fromVersion === null,
    fromVersion: fromVersion === null ? '0.0.0' : fromVersion,
    version: targetVersion,
    baselineRuntimeFingerprint: RUNTIME,
  };
}

function counting() {
  const builds = { shared: 0, legacy: [] };
  return {
    builds,
    sharedBuilder: async () => { builds.shared += 1; return Buffer.from('shared-zip', 'utf8'); },
    legacyBuilder: async ({ fromVersion }) => { builds.legacy.push(fromVersion); return Buffer.from(`zip-from-${fromVersion}`, 'utf8'); },
  };
}

function registryOf(releases) {
  return {
    schemaVersion: 1,
    releases: Object.fromEntries(Object.entries(releases).map(([version, runtimeFingerprint]) => [version, { runtimeFingerprint, recordedAt: '2026-08-01T00:00:00.000Z' }])),
  };
}

function createStore({ channel = 'stable', control = { schemaVersion: 1, disabled: false, plans: {} }, registry = null, fail = null } = {}) {
  const store = createFakeR2Endpoint({ controlKey: controlKey(channel), control, fail });
  if (registry) store.seed(registryKey(channel), Buffer.from(JSON.stringify(registry), 'utf8'));
  return store;
}

function baseOptions(extra = {}) {
  const { builds, sharedBuilder, legacyBuilder } = counting();
  return {
    builds,
    options: {
      targetVersion: '1.3.0',
      privateKey: TEST_PRIVATE_KEY,
      keyId: TEST_KEY_ID,
      allowTestKey: true,
      releaseNotesUrl: 'https://github.com/z22115554/elitesand-pro/releases/tag/v1.3.0',
      sharedBuilder,
      legacyBuilder,
      inspectIncremental: inspector,
      now,
      ...extra,
    },
  };
}

function createWorkerProbe(store) {
  return async ({ version, channel = 'stable' }) => {
    const control = JSON.parse(store.object(controlKey(channel)).body.toString('utf8'));
    const plan = store.object(control.plans[version]);
    return plan?.body || Buffer.alloc(0);
  };
}

function publishOptions(store, extra = {}) {
  return {
    dryRun: false,
    store,
    publicArtifactRead: async (url) => store.object(new URL(url).pathname.slice(1)).body,
    workerProbe: createWorkerProbe(store),
    ...extra,
  };
}

function readJson(store, key) {
  return JSON.parse(store.object(key).body.toString('utf8'));
}

test('one build serves every registered version with the same runtime; older runtimes and newer versions are left out', async () => {
  const store = createStore({ registry: registryOf({ '1.1.0': OTHER_RUNTIME, '1.2.0': RUNTIME, '1.2.1': RUNTIME, '1.4.0': RUNTIME }) });
  const { builds, options } = baseOptions(publishOptions(store));
  const result = await runHotfixRelease(options);

  assert.strictEqual(builds.shared, 1, '整個發布只打包一次');
  assert.deepStrictEqual(builds.legacy, []);
  assert.deepStrictEqual(result.plans.map((entry) => entry.fromVersion), ['1.2.0', '1.2.1']);
  const sharedUrl = `${policy.artifactOriginForChannel('stable')}/artifacts/stable/1.3.0/1.3.0/update.zip`;
  for (const entry of result.plans) {
    assert.strictEqual(entry.shared, true);
    assert.strictEqual(entry.plan.artifact.url, sharedUrl, '每份計畫都指向同一個共用包');
    const verified = policy.verifyUpdatePlan(entry.plan, {
      currentVersion: entry.fromVersion, channel: 'stable', platform: 'win32', arch: 'x64',
      publicKeys: TEST_PUBLIC_KEYS, nowMs: now().getTime(),
    });
    assert.strictEqual(verified.ok, true, verified.reason);
  }
  const zipUploads = store.calls.filter(([operation, key]) => operation === 'putImmutable' && key.startsWith('artifacts/'));
  assert.deepStrictEqual(zipUploads.map(([, key]) => key), [artifactKey('stable', '1.3.0', '1.3.0')], 'R2 上只多一個更新包');

  const control = readJson(store, controlKey('stable'));
  assert.deepStrictEqual(Object.keys(control.plans).sort(), ['1.2.0', '1.2.1']);
  const registry = readJson(store, registryKey('stable'));
  assert.strictEqual(registry.releases['1.3.0'].runtimeFingerprint, RUNTIME, '新版要登記，下一版才會把它列進共用名單');
  assert.strictEqual(registry.releases['1.1.0'].runtimeFingerprint, OTHER_RUNTIME, '既有登記不可被動到');
  assert.match(describeRelease(result), /one shared package\): 1\.2\.0, 1\.2\.1/);
});

test('when the runtime changed (or nothing is registered yet) the release only registers itself and clears stale plans', async () => {
  const store = createStore({
    control: { schemaVersion: 1, disabled: false, plans: { '1.2.0': 'plans/stable/win32-x64/1.2.0/old.json' } },
    registry: registryOf({ '1.2.0': OTHER_RUNTIME }),
  });
  const { options } = baseOptions(publishOptions(store));
  const result = await runHotfixRelease(options);
  assert.deepStrictEqual(result.plans, []);
  assert.ok(!store.calls.some(([operation, key]) => operation === 'putImmutable' && key.startsWith('artifacts/')), '沒人能用就不上傳更新包');
  assert.deepStrictEqual(readJson(store, controlKey('stable')).plans, {}, '舊計畫要清掉，使用者改由 GitHub 提示下載安裝檔');
  assert.strictEqual(readJson(store, registryKey('stable')).releases['1.3.0'].runtimeFingerprint, RUNTIME);
  assert.match(describeRelease(result), /full Installer/);

  const first = createStore();
  await runHotfixRelease(baseOptions(publishOptions(first)).options);
  assert.ok(first.calls.some(([operation, key]) => operation === 'putImmutable' && key === registryKey('stable')), '第一次發布要建立登記表');
});

test('legacy versions (released before the shared format) still get their own package next to the shared one', async () => {
  const store = createStore({ registry: registryOf({ '1.2.0': RUNTIME }) });
  const { builds, options } = baseOptions(publishOptions(store, { legacyFromVersions: ['1.1.0', '1.0.9'] }));
  const result = await runHotfixRelease(options);
  assert.strictEqual(builds.shared, 1);
  assert.deepStrictEqual(builds.legacy, ['1.0.9', '1.1.0']);
  const byFrom = Object.fromEntries(result.plans.map((entry) => [entry.fromVersion, entry]));
  assert.strictEqual(byFrom['1.2.0'].shared, true);
  assert.strictEqual(byFrom['1.1.0'].plan.artifact.url, `${policy.artifactOriginForChannel('stable')}/artifacts/stable/1.1.0/1.3.0/update.zip`);
  assert.deepStrictEqual(Object.keys(readJson(store, controlKey('stable')).plans).sort(), ['1.0.9', '1.1.0', '1.2.0']);

  const overlap = createStore({ registry: registryOf({ '1.2.0': RUNTIME }) });
  await assert.rejects(() => runHotfixRelease(baseOptions(publishOptions(overlap, { legacyFromVersions: ['1.2.0'] })).options), /already receive the shared package/);
  await assert.rejects(() => runHotfixRelease(baseOptions({ legacyFromVersions: ['1.4.0'] }).options), /newer than the target/);
});

test('a target already registered with a different runtime is refused before anything is uploaded', async () => {
  const store = createStore({ registry: registryOf({ '1.3.0': OTHER_RUNTIME }) });
  await assert.rejects(() => runHotfixRelease(baseOptions(publishOptions(store)).options), /different runtime fingerprint/);
  assert.ok(!store.calls.some(([operation]) => operation === 'putImmutable' || operation === 'putControlIfMatch'));
});

test('dry-run signs and verifies the plans it would publish, reading the registry but writing nothing', async () => {
  const store = createStore({ registry: registryOf({ '1.2.0': RUNTIME }) });
  let checks = 0;
  const result = await runHotfixRelease(baseOptions({ dryRun: true, store, runChecks: async () => { checks += 1; } }).options);
  assert.strictEqual(result.dryRun, true);
  assert.strictEqual(checks, 1);
  assert.deepStrictEqual(result.plans.map((entry) => entry.fromVersion), ['1.2.0']);
  assert.ok(!store.calls.some(([operation]) => operation !== 'get'), '試跑只能讀');
  const offline = await runHotfixRelease(baseOptions({ dryRun: true }).options);
  assert.deepStrictEqual(offline.plans, [], '沒有 R2 時當作登記表是空的');
});

test('beta uses its own artifact origin, control pointer and registry, with at most one legacy baseline', async () => {
  await assert.rejects(() => runHotfixRelease(baseOptions({ channel: 'beta', dryRun: true, legacyFromVersions: ['1.0.0', '1.1.0'] }).options), /at most one legacy beta baseline/);
  const store = createStore({ channel: 'beta', control: { schemaVersion: 1, disabled: true, plans: {} }, registry: registryOf({ '1.2.0': RUNTIME }) });
  const result = await runHotfixRelease(baseOptions(publishOptions(store, { channel: 'beta' })).options);
  assert.strictEqual(result.controlKey, controlKey('beta'));
  assert.strictEqual(result.plans[0].plan.artifact.url, `${BETA_ARTIFACT_ORIGIN}/artifacts/beta/1.3.0/1.3.0/update.zip`);
  assert.ok(store.calls.some(([operation, key]) => operation === 'listPrefix' && key === 'artifacts/beta/'));
  assert.ok(store.object(registryKey('beta')), 'beta 有自己的登記表');
});

test('beta publisher refuses a ninth retained ZIP before it starts another package build', async () => {
  const store = createStore({ channel: 'beta', control: { schemaVersion: 1, disabled: true, plans: {} } });
  for (let index = 0; index < MAX_BETA_ARTIFACTS; index += 1) {
    store.putImmutable(artifactKey('beta', `0.9.9.${index}`, `0.9.10.${index}`), Buffer.from(`old-${index}`));
  }
  const { builds, options } = baseOptions(publishOptions(store, { channel: 'beta' }));
  await assert.rejects(() => runHotfixRelease(options), /retention limit reached/);
  assert.strictEqual(builds.shared, 0);
});

test('release tooling refuses a test policy key unless a local test explicitly opts in', async () => {
  await assert.rejects(() => runHotfixRelease(baseOptions({ allowTestKey: false, dryRun: true }).options), /test update policy key/);
});

test('a channel-scoped production policy key cannot be used to generate a stable release', async () => {
  await assert.rejects(() => runHotfixRelease(baseOptions({
    keyId: 'elitesand-beta-policy-2026-08',
    allowTestKey: false,
  }).options), /not allowed for the stable channel/);
});

test('any pre-pointer upload failure leaves the old control and registry untouched', async () => {
  const oldControl = { schemaVersion: 1, disabled: false, plans: { '1.1.0': 'plans/stable/win32-x64/1.1.0/old.json' } };
  const store = createStore({
    control: oldControl,
    registry: registryOf({ '1.2.0': RUNTIME }),
    fail: (operation, key) => { if (operation === 'putImmutable' && key.startsWith('plans/')) throw new Error('injected plan write failure'); },
  });
  await assert.rejects(() => runHotfixRelease(baseOptions(publishOptions(store)).options), /injected plan write failure/);
  assert.deepStrictEqual(readJson(store, controlKey('stable')), oldControl);
  assert.strictEqual(readJson(store, registryKey('stable')).releases['1.3.0'], undefined);
  assert.strictEqual(store.calls.filter(([operation]) => operation === 'putControlIfMatch').length, 0);
});

test('a Worker verification failure rolls control back with the new ETag and never guesses a pointer', async () => {
  const oldControl = { schemaVersion: 1, disabled: false, plans: { '1.1.0': 'plans/stable/win32-x64/1.1.0/old.json' } };
  const store = createStore({ control: oldControl, registry: registryOf({ '1.2.0': RUNTIME }) });
  await assert.rejects(() => runHotfixRelease(baseOptions(publishOptions(store, {
    workerProbe: async () => Buffer.from('wrong plan', 'utf8'),
  })).options), /Worker plan bytes mismatch/);
  assert.deepStrictEqual(readJson(store, controlKey('stable')), oldControl);
  const controlWrites = store.calls.filter(([operation, key]) => operation === 'putControlIfMatch' && key === controlKey('stable'));
  assert.strictEqual(controlWrites.length, 2);
});

test('a conditional control conflict fails without retrying or overwriting a concurrent pointer', async () => {
  const store = createStore({ registry: registryOf({ '1.2.0': RUNTIME }) });
  const originalPut = store.putControlIfMatch;
  let controlWrites = 0;
  store.putControlIfMatch = (key, ...rest) => {
    if (key === controlKey('stable')) { controlWrites += 1; return null; }
    return originalPut(key, ...rest);
  };
  await assert.rejects(() => runHotfixRelease(baseOptions(publishOptions(store)).options), /control pointer conditional write failed/);
  assert.strictEqual(controlWrites, 1);
});

test('a concurrent registry change is refused instead of being overwritten', async () => {
  const store = createStore({ registry: registryOf({ '1.2.0': RUNTIME }) });
  const originalPut = store.putControlIfMatch;
  store.putControlIfMatch = (key, ...rest) => (key === registryKey('stable') ? null : originalPut(key, ...rest));
  await assert.rejects(() => runHotfixRelease(baseOptions(publishOptions(store)).options), /registry conditional write failed/);
  assert.deepStrictEqual(Object.keys(readJson(store, controlKey('stable')).plans), [], '登記表寫不進去就不能切換對照表');
});
