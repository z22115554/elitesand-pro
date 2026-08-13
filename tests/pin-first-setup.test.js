'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 必須在載入 auth store 前隔離資料夾，避免測試碰到實際使用者的 PIN 資料。
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pin-setup-'));
process.env.ELITESAND_DATA_DIR = path.join(TEST_ROOT, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(TEST_ROOT, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(TEST_ROOT, 'logs');

const { canSetFirstPin, isLoopbackAddress } = require('../server/utils/pin-setup-policy');
const { isAllowedHttpHost, isAllowedSocketRequest } = require('../server/utils/socket-origin');
const { hostGuard } = require('../server/middleware/host-guard');
const requirePin = require('../server/middleware/require-pin');
const authStore = require('../server/services/auth-store');
const authRouter = require('../server/routes/auth');

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n    → ${error.message}`);
  }
}

function setHandler() {
  const layer = authRouter.stack.find((item) => item.route?.path === '/set' && item.route.methods.post);
  if (!layer) throw new Error('找不到 POST /api/auth/set route');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function invokeHostGuard(host) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  let calledNext = false;
  hostGuard({ headers: { host } }, response, () => { calledNext = true; });
  return { response, calledNext };
}

function invokeSet({ address, newPin, currentPin = '' }) {
  const response = {
    statusCode: 200,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  setHandler()({
    body: { newPin, currentPin },
    socket: { remoteAddress: address },
    connection: { remoteAddress: address },
  }, response);
  return response;
}

function invokeRequirePin(pin = '') {
  const response = {
    statusCode: 200,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  let calledNext = false;
  requirePin({ headers: pin ? { 'x-pin': pin } : {}, query: {}, body: {}, socket: { remoteAddress: '127.0.0.1' } }, response, () => { calledNext = true; });
  return { response, calledNext };
}


test('HTTP 與 Socket Host 白名單會拒絕 DNS rebinding 網域', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', '192.168.1.9:3000']) {
    assert.strictEqual(isAllowedHttpHost(host), true, host);
  }
  for (const host of ['', 'attacker.example', 'attacker.example:3000', 'attacker.example@127.0.0.1', '127.0.0.1/path', '127.0.0.1\\tattacker']) {
    assert.strictEqual(isAllowedHttpHost(host), false, host || 'empty');
    assert.strictEqual(isAllowedSocketRequest({ headers: { host } }), false, `socket: ${host || 'empty'}`);
  }
  assert.strictEqual(isAllowedSocketRequest({ headers: { host: '127.0.0.1:3000' } }), true);
});

test('HTTP host guard 在路由前阻擋不可信 Host', () => {
  const allowed = invokeHostGuard('localhost:3000');
  assert.strictEqual(allowed.calledNext, true);
  assert.strictEqual(allowed.response.payload, undefined);

  const blocked = invokeHostGuard('attacker.example:3000');
  assert.strictEqual(blocked.calledNext, false);
  assert.strictEqual(blocked.response.statusCode, 421);
  assert.deepStrictEqual(blocked.response.payload, {
    error: '要求的 Host 不受信任',
    code: 'HOST_NOT_ALLOWED',
  });
});

test('loopback address 判定不會把私人網段誤認為本機', () => {
  for (const address of ['127.0.0.1', '127.255.255.255', '::1', '::ffff:127.0.0.1']) {
    assert.strictEqual(isLoopbackAddress(address), true, address);
  }
  for (const address of ['', '192.168.1.9', '10.0.0.5', '172.16.0.2', '::ffff:192.168.1.9']) {
    assert.strictEqual(isLoopbackAddress(address), false, address || 'empty');
  }
  assert.strictEqual(canSetFirstPin({ hasPin: false, address: '192.168.1.9' }), false);
  assert.strictEqual(canSetFirstPin({ hasPin: true, address: '192.168.1.9' }), true);
});

test('未啟用 PIN 時，受保護操作維持可用', () => {
  assert.strictEqual(authStore.hasPin(), false);
  const result = invokeRequirePin();
  assert.strictEqual(result.calledNext, true);
  assert.strictEqual(result.response.payload, undefined);
});

test('第一組 PIN 只能由本機設定，既有 PIN 可由已授權遠端更新', () => {
  assert.strictEqual(authStore.hasPin(), false);

  const blocked = invokeSet({ address: '192.168.1.9', newPin: '1234' });
  assert.strictEqual(blocked.statusCode, 403);
  assert.deepStrictEqual(blocked.payload, {
    ok: false,
    code: 'LOCAL_SETUP_REQUIRED',
    message: '請在執行 Elitesand Pro 的本機控制面板設定第一組 PIN',
  });
  assert.strictEqual(authStore.hasPin(), false);

  const firstSet = invokeSet({ address: '127.0.0.1', newPin: '1234' });
  assert.strictEqual(firstSet.statusCode, 200);
  assert.strictEqual(firstSet.payload.ok, true);
  assert.strictEqual(authStore.verifyPin('1234'), true);
  const allowed = invokeRequirePin('1234');
  assert.strictEqual(allowed.calledNext, true);

  const remoteChange = invokeSet({ address: '192.168.1.9', currentPin: '1234', newPin: '5678' });
  assert.strictEqual(remoteChange.statusCode, 200);
  assert.strictEqual(remoteChange.payload.ok, true);
  assert.strictEqual(authStore.verifyPin('5678'), true);
  assert.strictEqual(authStore.clearPin('5678').ok, true);
});

fs.rmSync(TEST_ROOT, { recursive: true, force: true });
if (failed) process.exitCode = 1;
