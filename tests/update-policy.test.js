'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const policy = require('../server/services/update-policy');

const TEST_KEY_ID = 'update-policy-test-fixture';
const TEST_PRIVATE_KEY_PATH = path.join(__dirname, 'fixtures', 'update-policy-test-private.pem');
const TEST_PRIVATE_KEY = fs.readFileSync(TEST_PRIVATE_KEY_PATH, 'utf8');
const TEST_PUBLIC_KEY_HEX = crypto.createPublicKey(TEST_PRIVATE_KEY).export({ type: 'spki', format: 'der' }).toString('hex');
const TEST_KEYS = Object.freeze({ [TEST_KEY_ID]: TEST_PUBLIC_KEY_HEX });
const BETA_POLICY_KEY_ID = 'elitesand-beta-policy-2026-08';
const NOW_MS = Date.parse('2026-08-23T00:00:00.000Z');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

function unsignedPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    planId: 'stable-win32-x64-0.9.9.7-1.0.0-20260823t000000z',
    keyId: TEST_KEY_ID,
    channel: 'stable',
    platform: 'win32',
    arch: 'x64',
    fromVersion: '0.9.9.7',
    targetVersion: '1.0.0',
    delivery: 'incremental',
    urgency: 'optional',
    reasonCode: 'hotfix',
    issuedAt: '2026-08-22T23:59:00.000Z',
    expiresAt: '2026-08-30T00:00:00.000Z',
    releaseNotesUrl: 'https://github.com/z22115554/elitesand-pro/releases/tag/v1.0.0',
    artifact: {
      url: `${policy.UPDATE_ARTIFACT_ORIGIN}/artifacts/stable/0.9.9.7/1.0.0/update.zip`,
      sha256: 'a'.repeat(64),
      size: 1024,
    },
    installer: null,
    ...overrides,
  };
}

function signedPlan(overrides = {}) {
  return policy.signUpdatePlan(unsignedPlan(overrides), TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID });
}

function verify(plan, extra = {}) {
  return policy.verifyUpdatePlan(plan, {
    currentVersion: '0.9.9.7',
    channel: 'stable',
    platform: 'win32',
    arch: 'x64',
    publicKeys: TEST_KEYS,
    nowMs: NOW_MS,
    ...extra,
  });
}

console.log('\n[update-policy]');

test('canonical bytes 遞迴排序 object key、保留 array 順序且排除 signature', () => {
  const left = { z: 1, nested: { b: 2, a: 3 }, array: [{ y: 1, x: 2 }, 'second'], signature: 'f'.repeat(128) };
  const right = { array: [{ x: 2, y: 1 }, 'second'], nested: { a: 3, b: 2 }, z: 1, signature: '0'.repeat(128) };
  assert.deepEqual(policy.canonicalPlanBytes(left), policy.canonicalPlanBytes(right));
  assert.equal(policy.canonicalize(['z', 'a']), '["z","a"]');
});

test('合法 incremental policy 使用獨立 Ed25519 key 可驗證', () => {
  const result = verify(signedPlan());
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.plan.targetVersion, '1.0.0');
});

test('任何簽章後竄改、錯 key 或未知欄位都 fail closed', () => {
  const tampered = signedPlan();
  tampered.artifact.sha256 = 'b'.repeat(64);
  assert.equal(verify(tampered).ok, false);
  assert.equal(verify(signedPlan(), { publicKeys: { [TEST_KEY_ID]: '302a300506032b6570032100b2ea5c5b1fb0c27a30c1cceb9337ad147ac32794e84ef99e2ffc12f6db56ce6b' } }).ok, false);
  const unknown = signedPlan();
  unknown.untrusted = true;
  assert.match(verify(unknown).reason, /未知欄位/);
});

test('版本、時間、枚舉、hash、size 與 host 全部有明確拒絕條件', () => {
  assert.match(verify(signedPlan({
    fromVersion: '0.9.9.6',
    artifact: {
      url: `${policy.UPDATE_ARTIFACT_ORIGIN}/artifacts/stable/0.9.9.6/1.0.0/update.zip`,
      sha256: 'a'.repeat(64),
      size: 1024,
    },
  })).reason, /fromVersion/);
  assert.match(verify(signedPlan({ issuedAt: '2026-09-01T00:00:00.000Z' })).reason, /未來/);
  assert.match(verify(signedPlan({ expiresAt: '2026-08-22T00:00:00.000Z' })).reason, /過期/);
  assert.throws(() => policy.signUpdatePlan(unsignedPlan({
    delivery: 'installer',
    artifact: null,
    installer: {
      url: 'https://github.com/z22115554/elitesand-pro/releases/download/v1.0.0/Elitesand Pro Setup 1.0.0.exe',
      sha256: 'a'.repeat(64),
      size: 1024,
    },
  }), TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /optional plan 只能使用 incremental delivery/);
  const badHost = unsignedPlan();
  badHost.artifact.url = 'https://evil.example/artifacts/stable/0.9.9.7/1.0.0/update.zip';
  assert.throws(() => policy.signUpdatePlan(badHost, TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /artifact URL/);
  const badHash = unsignedPlan();
  badHash.artifact.sha256 = 'A'.repeat(64);
  assert.throws(() => policy.signUpdatePlan(badHash, TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /sha256/);
  const badSize = unsignedPlan();
  badSize.artifact.size = policy.MAX_UPDATE_ZIP_BYTES + 1;
  assert.throws(() => policy.signUpdatePlan(badSize, TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /size/);
});

test('stable 與 beta artifact 是雙向隔離：2026-09-05 起沒有自訂網域，兩個頻道共用同一個 workers.dev 來源，隔離改成靠 URL path 一定要含 plan.channel，不是靠不同 host', () => {
  assert.equal(policy.UPDATE_ARTIFACT_ORIGIN, policy.BETA_UPDATE_ARTIFACT_ORIGIN,
    '這個測試的前提：兩個頻道現在確實共用同一個 origin（等之後真的申請到網域、兩者分開，這條斷言會先炸，提醒回來把下面的隔離斷言換回 host 版本）');

  const beta = unsignedPlan({
    planId: 'beta-win32-x64-0.9.9.7-1.0.0-20260823t000000z',
    channel: 'beta',
    artifact: {
      url: `${policy.BETA_UPDATE_ARTIFACT_ORIGIN}/artifacts/beta/0.9.9.7/1.0.0/update.zip`,
      sha256: 'a'.repeat(64),
      size: 1024,
    },
  });
  const signedBeta = policy.signUpdatePlan(beta, TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID });
  assert.equal(policy.verifyUpdatePlan(signedBeta, {
    currentVersion: '0.9.9.7', channel: 'beta', platform: 'win32', arch: 'x64', publicKeys: TEST_KEYS, nowMs: NOW_MS,
  }).ok, true);

  // channel: 'beta' 的 plan，artifact URL 的 path 卻寫 /artifacts/stable/...（host 對、path 跟
  // plan.channel 不符）→ 簽章階段就要擋下來。
  assert.throws(() => policy.signUpdatePlan({
    ...beta,
    artifact: { ...beta.artifact, url: beta.artifact.url.replace('/artifacts/beta/', '/artifacts/stable/') },
  }, TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /artifact URL/);

  // channel: 'stable' 的 plan，artifact URL 卻指到 /artifacts/beta/...（path 跟 plan.channel
  // 不符，即使 host 是合法的共用 origin）→ 一樣要擋下來。
  assert.throws(() => policy.signUpdatePlan(unsignedPlan({
    artifact: { url: `${policy.UPDATE_ARTIFACT_ORIGIN}/artifacts/beta/0.9.9.7/1.0.0/update.zip`, sha256: 'a'.repeat(64), size: 1024 },
  }), TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /artifact URL/);

  // 完全不受信任的 host，不管 path 寫什麼一律拒絕。
  assert.throws(() => policy.signUpdatePlan(unsignedPlan({
    artifact: { url: 'https://evil.example/artifacts/stable/0.9.9.7/1.0.0/update.zip', sha256: 'a'.repeat(64), size: 1024 },
  }), TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /artifact URL/);

  // 真正的頻道隔離邊界：即使 host/path 都合法指向一個 beta artifact，一個
  // channel:'stable' 的 plan 拿它來驗證仍必須用 stable 的 context 驗證失敗
  // （這裡直接驗證跨頻道的 verify，而不是簽章期）。
  assert.equal(policy.verifyUpdatePlan(signedBeta, {
    currentVersion: '0.9.9.7', channel: 'stable', platform: 'win32', arch: 'x64', publicKeys: TEST_KEYS, nowMs: NOW_MS,
  }).ok, false);
});

test('required delivery 只允許簽署的 major-release Installer 或 owner-forced，且舊版本 policy 不會套到新版', () => {
  const ownerForcedIncremental = signedPlan({ urgency: 'required', reasonCode: 'owner-forced' });
  assert.equal(verify(ownerForcedIncremental).ok, true);

  const majorInstaller = signedPlan({
    delivery: 'installer',
    urgency: 'required',
    reasonCode: 'major-release',
    artifact: null,
    installer: {
      url: 'https://github.com/z22115554/elitesand-pro/releases/download/v1.0.0/Elitesand.Pro.Setup.1.0.0.exe',
      sha256: 'b'.repeat(64),
      size: 123456,
    },
  });
  assert.equal(verify(majorInstaller).ok, true);

  assert.throws(() => policy.signUpdatePlan(unsignedPlan({ urgency: 'required', reasonCode: 'major-release' }), TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /major-release 必須使用 Installer/);
  assert.throws(() => policy.signUpdatePlan(unsignedPlan({ urgency: 'optional', reasonCode: 'owner-forced' }), TEST_PRIVATE_KEY, { keyId: TEST_KEY_ID }), /owner-forced 必須是 required/);
  assert.match(policy.verifyUpdatePlan(ownerForcedIncremental, {
    currentVersion: '1.0.0', channel: 'stable', platform: 'win32', arch: 'x64', publicKeys: TEST_KEYS, nowMs: NOW_MS,
  }).reason, /fromVersion/);
});

test('replay guard 僅接受遞增 issuedAt，拒絕舊 policy 或同時間不同 plan', () => {
  const guard = policy.createInMemoryReplayGuard();
  assert.equal(verify(signedPlan(), { replayGuard: guard }).ok, true);
  assert.match(verify(signedPlan({ issuedAt: '2026-08-22T23:58:00.000Z', planId: 'stable-win32-x64-older' }), { replayGuard: guard }).reason, /replay/);
  assert.match(verify(signedPlan({ planId: 'stable-win32-x64-same-time' }), { replayGuard: guard }).reason, /replay/);
  assert.equal(verify(signedPlan({ issuedAt: '2026-08-23T00:00:00.000Z', planId: 'stable-win32-x64-newer' }), { replayGuard: guard }).ok, true);
});

test('production trust store 拒絕未知的 repository fixture key', () => {
  const result = policy.verifyUpdatePlan(signedPlan(), {
    currentVersion: '0.9.9.7', channel: 'stable', platform: 'win32', arch: 'x64', nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /keyId 不受信任/);
});

test('embedded beta policy key cannot authorize a stable plan', () => {
  assert.equal(policy.isUpdatePolicyKeyAllowedForChannel(BETA_POLICY_KEY_ID, 'beta'), true);
  assert.equal(policy.isUpdatePolicyKeyAllowedForChannel(BETA_POLICY_KEY_ID, 'stable'), false);
});

test('production signer 拒絕 repository test policy key，只有明確 test opt-in 可用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-policy-sign-'));
  try {
    const planPath = path.join(dir, 'plan.json');
    fs.writeFileSync(planPath, JSON.stringify(unsignedPlan(), null, 2));
    const script = path.join(__dirname, '..', 'tools', 'update-policy-signing', 'sign-plan.js');
    const rejected = spawnSync(process.execPath, [script, planPath, '--key-id', TEST_KEY_ID, '--private-key', TEST_PRIVATE_KEY_PATH], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Refusing to sign/);
    const allowed = spawnSync(process.execPath, [script, planPath, '--key-id', TEST_KEY_ID, '--private-key', TEST_PRIVATE_KEY_PATH, '--allow-test-key'], { encoding: 'utf8' });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(JSON.parse(fs.readFileSync(planPath, 'utf8')).signature, /^[a-f0-9]{128}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`[update-policy] ${passed} tests passed.`);
