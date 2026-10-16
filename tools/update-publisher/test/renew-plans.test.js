'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const policy = require('../../../server/services/update-policy');
const { controlKey, planKey } = require('../lib/publish-hotfix');
const { PLAN_LIFETIME_MS, RENEW_BEFORE_MS, renewActivePlans } = require('../lib/renew-plans');
const { main, parseArgs, probeWorker } = require('../renew-cli');
const { createFakeR2Endpoint } = require('./fake-r2-endpoint');

const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/update-policy-test-private.pem'), 'utf8');
const KEY_ID = 'update-policy-test-fixture';
const PUBLIC_KEYS = { [KEY_ID]: policy.publicKeyHexFromPrivateKey(PRIVATE_KEY) };
const ISSUE_MS = Date.parse('2026-10-01T00:00:00.000Z');

function oldPlan(version = '1.0.9', channel = 'stable', overrides = {}) {
  return policy.signUpdatePlan({
    schemaVersion: 1, planId: `old-${version}`, channel, platform: 'win32', arch: 'x64',
    fromVersion: version, targetVersion: '1.1.0', delivery: 'incremental', urgency: 'optional', reasonCode: 'hotfix',
    issuedAt: new Date(ISSUE_MS).toISOString(), expiresAt: new Date(ISSUE_MS + PLAN_LIFETIME_MS).toISOString(),
    releaseNotesUrl: 'https://github.com/z22115554/elitesand-pro/releases/tag/v1.1.0',
    artifact: { url: `${policy.artifactOriginForChannel(channel)}/artifacts/${channel}/${version}/1.1.0/update.zip`, sha256: 'a'.repeat(64), size: 123 },
    installer: null, ...overrides,
  }, PRIVATE_KEY, { keyId: KEY_ID });
}

function setup({ channel = 'stable', plans = [oldPlan('1.0.9', channel)], disabled = false, nowMs = ISSUE_MS + PLAN_LIFETIME_MS + 86400000 } = {}) {
  const control = { schemaVersion: 1, disabled, plans: {} };
  const store = createFakeR2Endpoint();
  for (const plan of plans) {
    const key = planKey(channel, plan.fromVersion, plan.planId);
    control.plans[plan.fromVersion] = key;
    store.seed(key, Buffer.from(JSON.stringify(plan)));
  }
  store.seed(controlKey(channel), Buffer.from(JSON.stringify(control)));
  const probe = async ({ version }) => {
    const current = JSON.parse(store.object(controlKey(channel)).body);
    return store.object(current.plans[version]).body;
  };
  return { store, control, options: {
    channel, store, privateKey: PRIVATE_KEY, keyId: KEY_ID, allowTestKey: true,
    now: () => new Date(nowMs), dryRun: false, workerProbe: probe,
  } };
}

function active(store, version = '1.0.9', channel = 'stable') {
  const control = JSON.parse(store.object(controlKey(channel)).body);
  return JSON.parse(store.object(control.plans[version]).body);
}

test('expired active plans regain a bounded lifetime without changing legacy ZIP URLs or payloads', async () => {
  const { store, options } = setup({ plans: [oldPlan('1.0.8'), oldPlan('1.0.9')] });
  const before = active(store);
  assert.equal(policy.verifyUpdatePlan(before, { currentVersion: '1.0.9', publicKeys: PUBLIC_KEYS, nowMs: options.now().getTime() }).code, 'expired');
  const result = await renewActivePlans(options);
  assert.equal(result.renewed, 2);
  for (const version of ['1.0.8', '1.0.9']) {
    const renewed = active(store, version);
    assert.deepEqual(renewed.artifact, oldPlan(version).artifact);
    assert.equal(renewed.fromVersion, version);
    assert.equal(renewed.targetVersion, '1.1.0');
    assert.equal(Date.parse(renewed.expiresAt) - Date.parse(renewed.issuedAt), PLAN_LIFETIME_MS);
    assert.equal(policy.verifyUpdatePlan(renewed, { currentVersion: version, publicKeys: PUBLIC_KEYS, nowMs: options.now().getTime() }).ok, true);
  }
  assert.ok(!store.calls.some(([op, key]) => op === 'putImmutable' && key.startsWith('artifacts/')), 'no ZIP rebuild or upload');
});

test('daily maintenance keeps a release available after repeated three-day snoozes and long release gaps', async () => {
  const { store, options } = setup({ nowMs: ISSUE_MS + 86400000 });
  let renewed = 0;
  const guard = policy.createInMemoryReplayGuard();
  for (let day = 1; day <= 90; day++) {
    const nowMs = ISSUE_MS + day * 86400000;
    renewed += (await renewActivePlans({ ...options, now: () => new Date(nowMs) })).renewed;
    const current = active(store);
    const verified = policy.verifyUpdatePlan(current, { currentVersion: '1.0.9', publicKeys: PUBLIC_KEYS, nowMs, replayGuard: guard });
    assert.equal(verified.ok, true, `release must remain available on day ${day}: ${verified.reason}`);
  }
  assert.ok(renewed > 1);
});

test('only near-expiry plans are switched; dry run, disabled and empty controls do not write', async () => {
  const { store, options } = setup({ nowMs: ISSUE_MS + PLAN_LIFETIME_MS - RENEW_BEFORE_MS - 1 });
  assert.equal((await renewActivePlans(options)).renewed, 0);
  assert.equal((await renewActivePlans({ ...options, now: () => new Date(ISSUE_MS + PLAN_LIFETIME_MS), dryRun: true })).renewed, 1);
  assert.ok(!store.calls.some(([op]) => op.startsWith('put')));
  for (const fixture of [setup({ disabled: true }), setup({ plans: [] })]) {
    assert.equal((await renewActivePlans({ ...fixture.options, privateKey: null, keyId: null })).renewed, 0);
    assert.ok(!fixture.store.calls.some(([op]) => op.startsWith('put')));
  }
});

test('withdrawn plans are not revived and beta renewal stays in its own channel', async () => {
  const { store, options } = setup({ channel: 'beta' });
  const withdrawn = oldPlan('1.0.5', 'beta');
  const withdrawnKey = planKey('beta', '1.0.5', withdrawn.planId);
  store.seed(withdrawnKey, Buffer.from(JSON.stringify(withdrawn)));
  await renewActivePlans(options);
  assert.equal(active(store, '1.0.9', 'beta').channel, 'beta');
  const control = JSON.parse(store.object(controlKey('beta')).body);
  assert.deepEqual(Object.keys(control.plans), ['1.0.9']);
  assert.ok(!store.calls.some(([op, key]) => op === 'get' && key === withdrawnKey));
  assert.equal(store.object(controlKey('stable')), null);
  const missing = createFakeR2Endpoint();
  assert.equal((await renewActivePlans({ ...options, store: missing })).skipped, 'not-configured');
  await assert.rejects(renewActivePlans({ ...options, store: missing, channel: 'stable' }), /existing control/);
});

test('tampered, missing, cross-channel and invalid-lifetime plans cannot be re-signed', async () => {
  const invalids = [
    { ...oldPlan(), targetVersion: '1.1.1' },
    oldPlan('1.0.9', 'beta'),
    oldPlan('1.0.9', 'stable', { expiresAt: new Date(ISSUE_MS + 32 * 86400000).toISOString() }),
  ];
  for (const plan of invalids) {
    const { store, options } = setup({ plans: [plan] });
    await assert.rejects(renewActivePlans(options), /verification/);
    assert.ok(!store.calls.some(([op]) => op.startsWith('put')));
  }
  const { store, options, control } = setup();
  store.seed(controlKey('stable'), Buffer.from(JSON.stringify({ ...control, plans: { '1.0.9': 'plans/stable/win32-x64/1.0.9/missing.json' } })));
  await assert.rejects(renewActivePlans(options), /missing/);
  store.seed(controlKey('stable'), Buffer.from(JSON.stringify({ ...control, plans: { '1.0.9': '../private-key.pem' } })));
  await assert.rejects(renewActivePlans(options), /unsafe/);
  assert.ok(!store.calls.some(([op, key]) => op === 'get' && key === '../private-key.pem'));
});

test('production renewal rejects unknown signers and missing keys rather than silently doing nothing', async () => {
  const { options } = setup();
  await assert.rejects(renewActivePlans({ ...options, allowTestKey: false }), /production key/);
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  await assert.rejects(renewActivePlans({ ...options, allowTestKey: false, keyId: 'elitesand-stable-policy-2026-09', privateKey: other }), /production key/);
  await assert.rejects(renewActivePlans({ ...options, privateKey: null }), /signing secrets/);
});

test('a concurrent publish cannot be overwritten by renewal or its rollback', async () => {
  const { store, options } = setup();
  const latest = Buffer.from(JSON.stringify({ schemaVersion: 1, disabled: true, plans: {} }));
  const originalPut = store.putControlIfMatch;
  store.putControlIfMatch = (...args) => {
    store.seed(controlKey('stable'), latest);
    return originalPut(...args);
  };
  await assert.rejects(renewActivePlans(options), /concurrently/);
  assert.deepEqual(store.object(controlKey('stable')).body, latest);

  const second = setup();
  second.options.workerProbe = async () => {
    second.store.seed(controlKey('stable'), latest);
    return Buffer.from('unexpected');
  };
  await assert.rejects(renewActivePlans(second.options), /not overwritten/);
  assert.deepEqual(second.store.object(controlKey('stable')).body, latest);
});

test('failed uploads/read-back/probes keep or restore the previous control pointer', async () => {
  const failedUpload = setup();
  const before = failedUpload.store.object(controlKey('stable')).body;
  failedUpload.store.putImmutable = () => { throw new Error('upload failed'); };
  await assert.rejects(renewActivePlans(failedUpload.options), /upload failed/);
  assert.deepEqual(failedUpload.store.object(controlKey('stable')).body, before);
  const failedRead = setup();
  const beforeRead = failedRead.store.object(controlKey('stable')).body;
  const realGet = failedRead.store.get;
  failedRead.store.get = (key) => key.includes('/stable-win32-x64-')
    ? { body: Buffer.from('corrupt-readback'), etag: 'wrong' } : realGet(key);
  await assert.rejects(renewActivePlans(failedRead.options), /read-back mismatch/);
  assert.deepEqual(failedRead.store.object(controlKey('stable')).body, beforeRead);
  const failedProbe = setup();
  const original = failedProbe.store.object(controlKey('stable')).body;
  failedProbe.options.workerProbe = async () => Buffer.from('wrong-plan');
  await assert.rejects(renewActivePlans(failedProbe.options), /read-back mismatch/);
  assert.deepEqual(failedProbe.store.object(controlKey('stable')).body, original);
});

test('maintenance CLI defaults to dry run and does not leak supplied secrets in configuration errors', async () => {
  assert.deepEqual(parseArgs([]), { channel: 'stable', publish: false });
  assert.deepEqual(parseArgs(['--channel', 'beta', '--publish']), { channel: 'beta', publish: true });
  assert.throws(() => parseArgs(['--channel', 'unknown']), /Usage/);
  await assert.rejects(main([], { ELITESAND_R2_SECRET_ACCESS_KEY: 'never-print-this' }), (error) => /Missing renewal secrets/.test(error.message) && !error.message.includes('never-print-this'));
});

test('Worker probe requires uncached exact bytes and never follows redirects', async () => {
  const expected = Buffer.from('{"signed":"plan"}');
  const result = await probeWorker({ version: '1.0.9', platform: 'win32', arch: 'x64', channel: 'stable' }, { fetchImpl: async (url, options) => {
    assert.equal(url.hostname, 'elitesand-update-control.elitesand.workers.dev');
    assert.equal(url.searchParams.get('version'), '1.0.9');
    assert.equal(options.redirect, 'error');
    return { status: 200, headers: { get: () => 'no-store' }, arrayBuffer: async () => expected };
  } });
  assert.deepEqual(result, expected);
  await assert.rejects(probeWorker({}, { fetchImpl: async () => ({ status: 302, headers: { get: () => '' } }) }), /uncached/);
});
