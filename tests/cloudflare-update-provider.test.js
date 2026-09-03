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

test('stable builds default to enabled; an explicit "0" disable flag and an untrusted endpoint both fail closed as "unavailable"', async () => {
  let calls = 0;
  let runtimeCalls = 0;
  // Stable version, no override passed: relies on isEnabled()'s new default.
  assert.strictEqual(isEnabled({}, '0.9.9.8'), true);
  const disabled = createCloudflareUpdateProvider({
    currentVersion: '0.9.9.8',
    enabled: isEnabled({ ELITESAND_ENABLE_CLOUDFLARE_UPDATES: '0' }, '0.9.9.8'),
    fetchImpl: async () => { calls += 1; return response({}); },
    runtimeFingerprint: async () => { runtimeCalls += 1; return TEST_RUNTIME_FINGERPRINT; },
  });
  assert.strictEqual((await disabled.check()).kind, 'unavailable');
  const hostile = createCloudflareUpdateProvider({ currentVersion: '0.9.9.8', enabled: true, endpoint: 'https://evil.example/v1/plan', fetchImpl: async () => { calls += 1; return response({}); } });
  assert.strictEqual((await hostile.check()).kind, 'unavailable');
  assert.strictEqual(calls, 0);
  assert.strictEqual(runtimeCalls, 0);
});

test('stable build defaults to enabled and actually issues the Worker request; a real 1.0.0 -> 1.0.1 signed plan is accepted', async () => {
  let calls = 0;
  const provider = createCloudflareUpdateProvider({
    currentVersion: '1.0.0',
    enabled: isEnabled({}, '1.0.0'),
    channel: 'stable',
    publicKeys: TEST_PUBLIC_KEYS,
    nowMs: () => NOW_MS,
    runtimeFingerprint: async () => TEST_RUNTIME_FINGERPRINT,
    // Isolated in-memory replay guard: the provider's default replay store
    // persists to the real userData file, which other tests in this file
    // also write "stable/win32/x64" entries into — sharing it here would
    // make this test's outcome depend on run order.
    replayGuard: policy.createInMemoryReplayGuard(),
    fetchImpl: async () => {
      calls += 1;
      return response(signedPlan({
        planId: 'stable-win32-x64-1.0.0-1.0.1-p1',
        fromVersion: '1.0.0',
        targetVersion: '1.0.1',
        artifact: {
          url: 'https://updates.elitesand.pro/artifacts/stable/1.0.0/1.0.1/update.zip',
          sha256: 'a'.repeat(64),
          size: 1234,
        },
      }));
    },
  });
  const result = await provider.check();
  assert.strictEqual(result.kind, 'plan');
  assert.strictEqual(result.plan.targetVersion, '1.0.1');
  assert.strictEqual(calls, 1);
});

test('server explicitly saying "no update" (HTTP 204) reports kind: none, not unavailable', async () => {
  const provider = providerWith(null, { fetchImpl: async () => ({ status: 204, headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) }) });
  assert.strictEqual((await provider.check()).kind, 'none');
});

test('beta build only selects the isolated beta Worker and beta channel can never fall back to the stable endpoint', async () => {
  assert.strictEqual(defaultChannel({}, '0.9.9.8-beta.1'), 'beta');
  assert.strictEqual(isEnabled({}, '0.9.9.8-beta.1'), true);
  assert.strictEqual(isEnabled({}, '0.9.9.8'), true);
  assert.strictEqual(isEnabled({ ELITESAND_ENABLE_CLOUDFLARE_UPDATES: '0' }, '0.9.9.8-beta.1'), false);
  assert.strictEqual(isEnabled({ ELITESAND_ENABLE_CLOUDFLARE_UPDATES: '0' }, '0.9.9.8'), false);
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
  // An endpoint mismatched to the requested channel makes controlEndpoint()
  // refuse to resolve a base URL at all, so canCheck is false before any
  // fetch — that is a "couldn't get an answer" case, i.e. unavailable, not a
  // real "no update" answer from the (never contacted) stable endpoint.
  assert.strictEqual((await crossChannel.check()).kind, 'unavailable');
  assert.strictEqual(calls, 0);
});

test('missing installed runtime fingerprint fails closed as unavailable before a Worker request', async () => {
  let calls = 0;
  const provider = providerWith(signedPlan(), {
    runtimeFingerprint: async () => null,
    fetchImpl: async () => { calls += 1; return response(signedPlan()); },
  });
  assert.strictEqual((await provider.check()).kind, 'unavailable');
  assert.strictEqual(calls, 0);
});

test('a tampered plan or missing production public key is a security rejection: it stays "none", never softened to "unavailable"', async () => {
  const tampered = signedPlan();
  tampered.targetVersion = '0.9.9.9';
  assert.strictEqual((await providerWith(tampered).check()).kind, 'none');
  assert.strictEqual((await providerWith(signedPlan(), { publicKeys: {} }).check()).kind, 'none');
});

test('HTTP failure and timeout could not get an answer, so they report "unavailable" (letting the caller fall back to GitHub)', async () => {
  assert.strictEqual((await providerWith(signedPlan(), { fetchImpl: async () => response('', { status: 404, contentType: 'text/plain' }) }).check()).kind, 'unavailable');
  const timeout = providerWith(signedPlan(), {
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    connectTimeoutMs: 100,
    totalTimeoutMs: 120,
  });
  assert.strictEqual((await timeout.check()).kind, 'unavailable');
});

test('an explicit ELITESAND_ENABLE_CLOUDFLARE_UPDATES=0 disables checking and reports "unavailable", not "none"', async () => {
  let calls = 0;
  const provider = createCloudflareUpdateProvider({
    currentVersion: '1.0.0',
    enabled: isEnabled({ ELITESAND_ENABLE_CLOUDFLARE_UPDATES: '0' }, '1.0.0'),
    channel: 'stable',
    publicKeys: TEST_PUBLIC_KEYS,
    fetchImpl: async () => { calls += 1; return response(signedPlan()); },
    runtimeFingerprint: async () => TEST_RUNTIME_FINGERPRINT,
  });
  assert.strictEqual((await provider.check()).kind, 'unavailable');
  assert.strictEqual(calls, 0);
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
  assert.deepStrictEqual(await provider.acceptIncremental({ delivery: 'installer' }), { ok: false, reason: 'plan delivery is not incremental' });
});

test('required Installer handoff is reverified privately and never launches from the server', async () => {
  const provider = providerWith(requiredInstallerPlan(), { replayGuard: policy.createInMemoryReplayGuard() });
  const checked = await provider.check();
  assert.strictEqual(checked.kind, 'plan');
  assert.strictEqual(checked.plan.delivery, 'installer');
  assert.deepStrictEqual(await provider.openRequiredInstaller(checked.plan), { ok: true });
  assert.deepStrictEqual(await provider.openRequiredInstaller({ ...checked.plan, installer: null }), { ok: false });
});
