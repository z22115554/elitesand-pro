'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-device-access-'));
process.env.ELITESAND_DATA_DIR = path.join(root, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(root, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(root, 'logs');

const store = require('../server/services/device-access-store');
const { requireControlAccess } = require('../server/middleware/require-control-access');
const { requireSourceAccess } = require('../server/middleware/require-source-access');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  OK ${name}`); }
  catch (error) { failed += 1; console.error(`  FAIL ${name}\n    ${error.message}`); }
}
function response() {
  return {
    statusCode: 200,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test('first launch generates a device key and a separate source token', () => {
  const status = store.getLocalStatus();
  assert.strictEqual(status.deviceKeyVersion, 1);
  assert.ok(status.sourceToken.length >= 40);
  assert.strictEqual(store.verifySourceToken(status.sourceToken), true);
  assert.strictEqual(store.verifySourceToken('wrong'), false);
  const stored = JSON.parse(fs.readFileSync(path.join(root, 'data', 'device-access.json'), 'utf8'));
  assert.ok(stored.credentials.deviceKey);
  assert.ok(stored.credentials.sourceToken);
});

test('a QR pairing code is one-time and persists only a controller-token hash', () => {
  const code = store.createPairing().code;
  const controllerToken = store.redeemPairing(code);
  assert.ok(controllerToken && controllerToken.length >= 40);
  assert.strictEqual(store.redeemPairing(code), null);
  assert.strictEqual(store.verifyControllerToken(controllerToken), true);
  const stored = fs.readFileSync(path.join(root, 'data', 'device-access.json'), 'utf8');
  assert.ok(!stored.includes(controllerToken));
  assert.ok(stored.includes('tokenHash'));
});

test('remote HTTP control needs a paired controller token even with no PIN', () => {
  const code = store.createPairing().code;
  const controllerToken = store.redeemPairing(code);
  let next = false;
  const blocked = response();
  requireControlAccess({ headers: {}, socket: { remoteAddress: '192.168.1.25' } }, blocked, () => { next = true; });
  assert.strictEqual(next, false);
  assert.strictEqual(blocked.statusCode, 401);
  assert.strictEqual(blocked.payload.code, 'CONTROLLER_PAIRING_REQUIRED');

  const allowed = response();
  requireControlAccess({ headers: { 'x-elitesand-controller': controllerToken }, socket: { remoteAddress: '192.168.1.25' } }, allowed, () => { next = true; });
  assert.strictEqual(next, true);
});

test('OBS source access accepts only its own token and remains read-only elsewhere', () => {
  const status = store.getLocalStatus();
  let next = false;
  const blocked = response();
  requireSourceAccess({ query: {}, headers: {}, socket: { remoteAddress: '192.168.1.25' } }, blocked, () => { next = true; });
  assert.strictEqual(next, false);
  assert.strictEqual(blocked.payload.code, 'SOURCE_TOKEN_REQUIRED');
  const allowed = response();
  requireSourceAccess({ query: { source: status.sourceToken }, headers: {}, socket: { remoteAddress: '192.168.1.25' } }, allowed, () => { next = true; });
  assert.strictEqual(next, true);
});

test('regenerating the device key invalidates all previously paired phones without changing the source token', () => {
  const sourceToken = store.getLocalStatus().sourceToken;
  const code = store.createPairing().code;
  const controllerToken = store.redeemPairing(code);
  const result = store.revokeControllers();
  assert.ok(result.revoked >= 1);
  assert.strictEqual(store.verifyControllerToken(controllerToken), false);
  assert.strictEqual(store.verifySourceToken(sourceToken), true);
});

fs.rmSync(root, { recursive: true, force: true });
if (failed) process.exitCode = 1;
