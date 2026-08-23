'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const policy = require('../../../server/services/update-policy');
const { controlKey, runHotfixRelease } = require('../lib/publish-hotfix');
const { createFakeR2Endpoint } = require('./fake-r2-endpoint');

const TEST_PRIVATE_KEY = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'update-policy-test-private.pem'), 'utf8');
const TEST_KEY_ID = 'update-policy-test-fixture';
const TEST_PUBLIC_KEYS = { [TEST_KEY_ID]: policy.publicKeyHexFromPrivateKey(TEST_PRIVATE_KEY) };
const now = () => new Date('2026-08-23T00:00:00.000Z');

function inspector(_zip, { fromVersion, targetVersion }) {
  return {
    ok: true,
    fromVersion,
    version: targetVersion,
    baselineRuntimeFingerprint: 'b'.repeat(64),
  };
}

function builder({ fromVersion }) {
  return Buffer.from(`zip-from-${fromVersion}`, 'utf8');
}

function baseOptions(extra = {}) {
  return {
    targetVersion: '0.9.9.8',
    fromVersions: ['0.9.9.6', '0.9.9.7'],
    privateKey: TEST_PRIVATE_KEY,
    keyId: TEST_KEY_ID,
    allowTestKey: true,
    releaseNotesUrl: 'https://github.com/z22115554/elitesand-pro/releases/tag/v0.9.9.8',
    artifactBuilder: builder,
    inspectIncremental: inspector,
    now,
    ...extra,
  };
}

function createWorkerProbe(store) {
  return async ({ version }) => {
    const control = JSON.parse(store.object(controlKey('stable')).body.toString('utf8'));
    const plan = store.object(control.plans[version]);
    return plan?.body || Buffer.alloc(0);
  };
}

test('dry-run builds and verifies exact support-set plans without writing a fake R2 endpoint', async () => {
  let checks = 0;
  const result = await runHotfixRelease(baseOptions({ dryRun: true, runChecks: async () => { checks += 1; } }));
  assert.strictEqual(result.dryRun, true);
  assert.strictEqual(checks, 1);
  assert.deepStrictEqual(result.plans.map((entry) => entry.fromVersion), ['0.9.9.6', '0.9.9.7']);
  for (const entry of result.plans) {
    const verified = policy.verifyUpdatePlan(entry.plan, {
      currentVersion: entry.fromVersion, channel: 'stable', platform: 'win32', arch: 'x64',
      publicKeys: TEST_PUBLIC_KEYS, nowMs: now().getTime(),
    });
    assert.strictEqual(verified.ok, true);
  }
});

test('release tooling refuses a test policy key unless a local test explicitly opts in', async () => {
  const options = baseOptions({ allowTestKey: false, dryRun: true });
  await assert.rejects(() => runHotfixRelease(options), /test update policy key/);
});

test('fake R2 transaction uploads immutable artifacts/plans, verifies read-back, then conditionally switches only the supported pointers', async () => {
  const pointer = controlKey('stable');
  const store = createFakeR2Endpoint({ pointer, controlKey: pointer, control: { schemaVersion: 1, disabled: false, plans: { '0.9.9.5': 'plans/stable/win32-x64/0.9.9.5/old.json' } } });
  const result = await runHotfixRelease(baseOptions({
    dryRun: false,
    store,
    publicArtifactRead: async (url) => {
      const key = new URL(url).pathname.slice(1);
      return store.object(key).body;
    },
    workerProbe: createWorkerProbe(store),
  }));
  assert.strictEqual(result.dryRun, false);
  const control = JSON.parse(store.object(pointer).body.toString('utf8'));
  assert.deepStrictEqual(Object.keys(control.plans).sort(), ['0.9.9.6', '0.9.9.7']);
  assert.ok(store.calls.some(([operation, key]) => operation === 'putImmutable' && key.startsWith('artifacts/stable/0.9.9.6/')));
  assert.strictEqual(store.calls.filter(([operation]) => operation === 'putControlIfMatch').length, 1);
});

test('any pre-pointer upload failure leaves the old control untouched', async () => {
  const pointer = controlKey('stable');
  const oldControl = { schemaVersion: 1, disabled: false, plans: { '0.9.9.5': 'plans/stable/win32-x64/0.9.9.5/old.json' } };
  const store = createFakeR2Endpoint({
    controlKey: pointer,
    control: oldControl,
    fail: (operation, key) => { if (operation === 'putImmutable' && key.startsWith('plans/')) throw new Error('injected plan write failure'); },
  });
  await assert.rejects(() => runHotfixRelease(baseOptions({
    dryRun: false,
    store,
    publicArtifactRead: async (url) => store.object(new URL(url).pathname.slice(1)).body,
    workerProbe: createWorkerProbe(store),
  })), /injected plan write failure/);
  assert.deepStrictEqual(JSON.parse(store.object(pointer).body.toString('utf8')), oldControl);
  assert.strictEqual(store.calls.filter(([operation]) => operation === 'putControlIfMatch').length, 0);
});

test('a Worker verification failure rolls control back with the new ETag and never guesses a pointer', async () => {
  const pointer = controlKey('stable');
  const oldControl = { schemaVersion: 1, disabled: false, plans: { '0.9.9.5': 'plans/stable/win32-x64/0.9.9.5/old.json' } };
  const store = createFakeR2Endpoint({ controlKey: pointer, control: oldControl });
  await assert.rejects(() => runHotfixRelease(baseOptions({
    dryRun: false,
    store,
    publicArtifactRead: async (url) => store.object(new URL(url).pathname.slice(1)).body,
    workerProbe: async () => Buffer.from('wrong plan', 'utf8'),
  })), /Worker plan bytes mismatch/);
  assert.deepStrictEqual(JSON.parse(store.object(pointer).body.toString('utf8')), oldControl);
  assert.strictEqual(store.calls.filter(([operation]) => operation === 'putControlIfMatch').length, 2);
});

test('a conditional control conflict fails without retrying or overwriting a concurrent pointer', async () => {
  const pointer = controlKey('stable');
  const store = createFakeR2Endpoint({
    controlKey: pointer,
    control: { schemaVersion: 1, disabled: false, plans: {} },
    fail: (operation, key) => {
      if (operation === 'putControlIfMatch' && key === pointer) {
        // Mutate through an immutable insertion to change revision safely.
        // The test store sees the stale ETag and returns null rather than retrying.
      }
    },
  });
  const originalPut = store.putControlIfMatch;
  let writes = 0;
  store.putControlIfMatch = (...args) => { writes += 1; return null; };
  await assert.rejects(() => runHotfixRelease(baseOptions({
    dryRun: false,
    store,
    publicArtifactRead: async (url) => store.object(new URL(url).pathname.slice(1)).body,
    workerProbe: createWorkerProbe(store),
  })), /conditional write failed/);
  assert.strictEqual(writes, 1);
  store.putControlIfMatch = originalPut;
});
