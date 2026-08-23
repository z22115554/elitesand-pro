'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const policy = require('../server/services/update-policy');
const { createPersistentReplayGuard } = require('../server/services/update-policy-replay-store');
const {
  BETA_UPDATE_CONTROL_ORIGIN,
  UPDATE_CONTROL_ORIGIN,
  createCloudflareUpdateProvider,
  createRequestFingerprint,
  defaultChannel,
  isEnabled,
} = require('../server/services/cloudflare-update-provider');

const TEST_PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'fixtures', 'update-policy-test-private.pem'), 'utf8');
const TEST_KEY_ID = 'update-policy-test-fixture';
const TEST_PUBLIC_KEYS = Object.freeze({ [TEST_KEY_ID]: policy.publicKeyHexFromPrivateKey(TEST_PRIVATE_KEY) });
const NOW_MS = Date.parse('2026-08-23T00:00:00.000Z');
const TEST_RUNTIME_FINGERPRINT = 'c'.repeat(64);

function signedPlan(overrides = {}) {
  return policy.signUpdatePlan({
    schemaVersion: 1,
    planId: 'stable-win32-x64-0.9.9.7-0.9.9.8-p5',
    keyId: TEST_KEY_ID,
    channel: 'stable',
    platform: 'win32',
    arch: 'x64',
    fromVersion: '0.9.9.7',
    targetVersion: '0.9.9.8',
    delivery: 'incremental',
    urgency: 'optional',
    reasonCode: 'hotfix',
    issuedAt: '2026-08-23T00:00:00.000Z',
    expiresAt: '2026-08-24T00:00:00.000Z',
    releaseNotesUrl: 'https://github.com/z22115554/elitesand-pro/releases/tag/v0.9.9.8',
    artifact: {
      url: 'https://updates.elitesand.pro/artifacts/stable/0.9.9.7/0.9.9.8/update.zip',
      sha256: 'a'.repeat(64),
      size: 1234,
    },
    installer: null,
    ...overrides,
  }, TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID });
}

function requiredInstallerPlan(overrides = {}) {
  return signedPlan({
    planId: 'stable-win32-x64-0.9.9.7-1.0.0-p8',
    targetVersion: '1.0.0',
    delivery: 'installer',
    urgency: 'required',
    reasonCode: 'major-release',
    artifact: null,
    installer: {
      url: 'https://github.com/z22115554/elitesand-pro/releases/download/v1.0.0/Elitesand.Pro.Setup.1.0.0.exe',
      sha256: 'b'.repeat(64),
      size: 123456,
    },
    ...overrides,
  });
}

function signedBetaPlan(overrides = {}) {
  return signedPlan({
    planId: 'beta-win32-x64-0.9.9.7-0.9.9.8-p5',
    channel: 'beta',
    artifact: {
      url: 'https://elitesand-update-artifacts.elitesand.workers.dev/artifacts/beta/0.9.9.7/0.9.9.8/update.zip',
      sha256: 'a'.repeat(64),
      size: 1234,
    },
    ...overrides,
  });
}

function response(body, { status = 200, contentType = 'application/json; charset=utf-8' } = {}) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return {
    status,
    headers: { get: (key) => String(key).toLowerCase() === 'content-type' ? contentType : String(key).toLowerCase() === 'content-length' ? String(bytes.length) : null },
    arrayBuffer: async () => bytes,
  };
}

function providerWith(plan, extra = {}) {
  return createCloudflareUpdateProvider({
    enabled: true,
    currentVersion: '0.9.9.7',
    channel: 'stable',
    publicKeys: TEST_PUBLIC_KEYS,
    nowMs: () => NOW_MS,
    fetchImpl: async () => response(plan),
    runtimeFingerprint: async () => TEST_RUNTIME_FINGERPRINT,
    ...extra,
  });
}

test('Cloudflare provider only makes one exact cold-start Worker request and accepts a verified signed plan', async () => {
  let calls = 0;
  let observedUrl;
  const provider = providerWith(signedPlan(), {
    fetchImpl: async (url, options) => {
      calls += 1;
      observedUrl = new URL(url);
      assert.strictEqual(options.method, 'GET');
      assert.strictEqual(options.redirect, 'error');
      return response(signedPlan());
    },
  });
  const result = await provider.check();
  assert.strictEqual(result.kind, 'plan');
  assert.strictEqual(calls, 1);
  assert.strictEqual(observedUrl.origin, UPDATE_CONTROL_ORIGIN);
  assert.strictEqual(observedUrl.pathname, '/v1/plan');
  assert.deepStrictEqual([...observedUrl.searchParams.keys()].sort(), ['arch', 'channel', 'fingerprint', 'platform', 'version']);
  assert.strictEqual(observedUrl.searchParams.get('fingerprint'), createRequestFingerprint({ version: '0.9.9.7', channel: 'stable', runtimeFingerprint: TEST_RUNTIME_FINGERPRINT }));
});

test('feature flag defaults off and an untrusted endpoint cannot trigger a fetch', async () => {
  let calls = 0;
  let runtimeCalls = 0;
  const disabled = createCloudflareUpdateProvider({ fetchImpl: async () => { calls += 1; return response({}); }, runtimeFingerprint: async () => { runtimeCalls += 1; return TEST_RUNTIME_FINGERPRINT; } });
  assert.strictEqual((await disabled.check()).kind, 'none');
  const hostile = createCloudflareUpdateProvider({ enabled: true, endpoint: 'https://evil.example/v1/plan', fetchImpl: async () => { calls += 1; return response({}); } });
  assert.strictEqual((await hostile.check()).kind, 'none');
  assert.strictEqual(calls, 0);
  assert.strictEqual(runtimeCalls, 0);
});

test('beta build only selects the isolated beta Worker and beta channel can never fall back to the stable endpoint', async () => {
  assert.strictEqual(defaultChannel({}, '0.9.9.8-beta.1'), 'beta');
  assert.strictEqual(isEnabled({}, '0.9.9.8-beta.1'), true);
  assert.strictEqual(isEnabled({}, '0.9.9.8'), false);
  let observedUrl;
  const beta = createCloudflareUpdateProvider({
    currentVersion: '0.9.9.7',
    channel: 'beta',
    enabled: true,
    publicKeys: TEST_PUBLIC_KEYS,
    nowMs: () => NOW_MS,
    runtimeFingerprint: async () => TEST_RUNTIME_FINGERPRINT,
    fetchImpl: async (url) => { observedUrl = new URL(url); return response(signedBetaPlan()); },
  });
  assert.strictEqual((await beta.check()).kind, 'plan');
  assert.strictEqual(observedUrl.origin, BETA_UPDATE_CONTROL_ORIGIN);
  assert.strictEqual(observedUrl.searchParams.get('channel'), 'beta');

  let calls = 0;
  const crossChannel = createCloudflareUpdateProvider({
    currentVersion: '0.9.9.7', channel: 'beta', enabled: true,
    endpoint: `${UPDATE_CONTROL_ORIGIN}/v1/plan`,
    runtimeFingerprint: async () => TEST_RUNTIME_FINGERPRINT,
    fetchImpl: async () => { calls += 1; return response(signedBetaPlan()); },
  });
  assert.strictEqual((await crossChannel.check()).kind, 'none');
  assert.strictEqual(calls, 0);
});

test('missing installed runtime fingerprint fails closed before a Worker request', async () => {
  let calls = 0;
  const provider = providerWith(signedPlan(), {
    runtimeFingerprint: async () => null,
    fetchImpl: async () => { calls += 1; return response(signedPlan()); },
  });
  assert.strictEqual((await provider.check()).kind, 'none');
  assert.strictEqual(calls, 0);
});

test('invalid plan, missing production public key, HTTP failure and timeout all fail closed without an update', async () => {
  const tampered = signedPlan();
  tampered.targetVersion = '0.9.9.9';
  assert.strictEqual((await providerWith(tampered).check()).kind, 'none');
  assert.strictEqual((await providerWith(signedPlan(), { publicKeys: {} }).check()).kind, 'none');
  assert.strictEqual((await providerWith(signedPlan(), { fetchImpl: async () => response('', { status: 404, contentType: 'text/plain' }) }).check()).kind, 'none');
  const timeout = providerWith(signedPlan(), {
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    connectTimeoutMs: 100,
    totalTimeoutMs: 120,
  });
  assert.strictEqual((await timeout.check()).kind, 'none');
});

test('replay guard persists monotonic accepted plan state and blocks an older signed plan', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-replay-'));
  try {
    const file = path.join(directory, 'replay.json');
    const guard = createPersistentReplayGuard({ file });
    assert.strictEqual((await providerWith(signedPlan(), { replayGuard: guard }).check()).kind, 'plan');
    const older = signedPlan({
      planId: 'stable-win32-x64-0.9.9.7-0.9.9.8-older',
      issuedAt: '2026-08-22T23:59:59.000Z',
    });
    assert.strictEqual((await providerWith(older, { replayGuard: createPersistentReplayGuard({ file }) }).check()).kind, 'none');
    assert.ok(fs.existsSync(file));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('corrupt persistent replay storage fails closed before accepting a plan', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-replay-corrupt-'));
  try {
    const file = path.join(directory, 'replay.json');
    fs.writeFileSync(file, '{not-json', 'utf8');
    const guard = createPersistentReplayGuard({ file });
    assert.strictEqual(guard.isAvailable(), false);
    assert.strictEqual((await providerWith(signedPlan(), { replayGuard: guard }).check()).kind, 'none');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('accepted incremental plans can only enter the injected cold-start executor after policy check', async () => {
  const calls = [];
  const provider = providerWith(signedPlan(), {
    incrementalExecutor: { accept: async (plan) => { calls.push(plan.planId); return { ok: true }; } },
  });
  const checked = await provider.check();
  assert.strictEqual(checked.kind, 'plan');
  assert.deepStrictEqual(await provider.acceptIncremental(checked.plan), { ok: true });
  assert.deepStrictEqual(calls, [checked.plan.planId]);
  assert.deepStrictEqual(await provider.acceptIncremental({ delivery: 'installer' }), { ok: false });
});

test('required Installer handoff is reverified privately and never launches from the server', async () => {
  const provider = providerWith(requiredInstallerPlan(), { replayGuard: policy.createInMemoryReplayGuard() });
  const checked = await provider.check();
  assert.strictEqual(checked.kind, 'plan');
  assert.strictEqual(checked.plan.delivery, 'installer');
  assert.deepStrictEqual(await provider.openRequiredInstaller(checked.plan), { ok: true });
  assert.deepStrictEqual(await provider.openRequiredInstaller({ ...checked.plan, installer: null }), { ok: false });
});
