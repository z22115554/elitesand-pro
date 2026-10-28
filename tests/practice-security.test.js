'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createPracticeRouter } = require('../server/routes/practice');

// Execute the production authentication middleware with isolated credential
// dependencies. No test may initialize or mutate the user's credential files.
function middleware(relative, overrides) {
  const filename = path.resolve(__dirname, '..', relative);
  const exports = { exports: {} };
  const requireActual = createRequire(filename);
  const context = { module: exports, exports: exports.exports,
    require(name) { return Object.hasOwn(overrides, name) ? overrides[name] : requireActual(name); },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return exports.exports;
}

function authorities() {
  const credentials = {
    verifyControllerToken: token => token === 'controller-secret',
    verifySourceToken: token => token === 'source-secret',
  };
  const control = middleware('server/middleware/require-control-access.js', { '../services/device-access-store': credentials });
  const source = middleware('server/middleware/require-source-access.js', { '../services/device-access-store': credentials });
  const pin = middleware('server/middleware/require-pin.js', {
    './require-control-access': control,
    '../services/auth-store': { hasPin: () => true, verifyPin: pin => pin === '2468' },
    '../services/auth-rate-limiter': { status: () => ({ allowed: true }), reset() {}, recordFailure() {} },
  });
  // HTTP connects to loopback for portability, while the application sees the
  // same TCP identity as a LAN request. Forwarded headers remain untrusted.
  const lan = handler => (req, res, next) => {
    const request = Object.create(req);
    Object.defineProperty(request, 'socket', { value: { remoteAddress: '192.0.2.40' } });
    return handler(request, res, next);
  };
  return { pin: lan(pin), source: lan(source.requireSourceAccess), sourcePolicy: source, controlPolicy: control };
}

test('real source and controller policies keep credentials separate and ignore spoofed loopback headers', () => {
  const { sourcePolicy, controlPolicy } = authorities();
  const req = { socket: { remoteAddress: '192.0.2.40' }, query: { source: 'source-secret' }, headers: { 'x-forwarded-for': '127.0.0.1' } };
  assert.equal(controlPolicy.hasControlAccess(req), false);
  assert.equal(sourcePolicy.isLocalPreview(req), false);
  req.headers.authorization = 'Bearer controller-secret';
  assert.equal(controlPolicy.hasControlAccess(req), true);
  req.query.source = 'controller-secret';
  let rejected = false;
  const response = { set() { return this; }, status(value) { assert.equal(value, 401); return this; }, json(body) { assert.equal(body.code, 'SOURCE_TOKEN_REQUIRED'); rejected = true; } };
  sourcePolicy.requireSourceAccess(req, response, () => assert.fail('control token must not grant read-only source access'));
  assert.equal(rejected, true);
});

test('real HTTP guide and pitch-model routes require controller pairing and PIN; source tokens cannot reach them', async t => {
  let express;
  try { express = require('express'); } catch (_) { t.skip('express is not installed in this checkout'); return; }
  const auth = authorities(), app = express(), calls = [];
  app.use(express.json({ limit: '8kb' }));
  const guide = { trackId: 'song', guideId: 'guide', frames: [{ time: 0, midi: 69 }] };
  const service = {
    async get(id) { calls.push(['get', id]); return { status: 'ready', guide }; },
    async start(id) { calls.push(['start', id]); return { status: 'processing', job: { jobId: 'job' } }; },
    cancel(id) { calls.push(['cancel', id]); return { cancelled: true }; },
  };
  const runtime = { isAvailable: () => true, isPracticePitchModelAvailable: () => false,
    async installPracticePitchModel() { calls.push(['install']); return { ok: true }; } };
  app.use('/api/practice', createPracticeRouter({ express, service, runtime, requirePin: auth.pin }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/practice`;
  const controller = { 'x-elitesand-controller': 'controller-secret', 'x-pin': '2468' };
  const request = (url, method = 'GET', headers = {}, body) => fetch(base + url, { method,
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const [route, method] of [['/guides/song', 'GET'], ['/guides/song', 'POST'], ['/guides/song/cancel', 'POST'], ['/pitch-model', 'GET'], ['/pitch-model/install', 'POST']]) {
    const sourceOnly = await request(route + '?source=source-secret', method, { 'x-pin': '2468', 'x-forwarded-for': '127.0.0.1' });
    assert.equal(sourceOnly.status, 401); assert.equal((await sourceOnly.json()).code, 'CONTROLLER_PAIRING_REQUIRED');
    const noPin = await request(route, method, { 'x-elitesand-controller': 'controller-secret' });
    assert.equal(noPin.status, 401); assert.equal((await noPin.json()).code, 'PIN_REQUIRED');
  }
  assert.deepEqual(calls, [], 'failed authorization must not inspect source-derived data or start CPU work');
  const protectedGuide = await request('/guides/song', 'GET', controller);
  assert.equal(protectedGuide.status, 200);
  assert.equal(protectedGuide.headers.get('cache-control'), 'private, no-store');
  assert.equal((await request('/guides/song', 'POST', controller, {})).status, 202);
  assert.equal((await request('/guides/song/cancel', 'POST', controller, {})).status, 200);
  assert.equal((await request('/pitch-model', 'GET', controller)).status, 200);
});
