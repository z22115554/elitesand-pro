'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { probeHealth } = require('../electron/shell');
const key = crypto.randomBytes(32).toString('hex');

function proof(challenge, port, secret = key) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`ElitesandPro/shell-health/v1\n${challenge}\n${port}`).digest('hex');
}

async function listener(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}

test('S-09: an unrelated listener cannot become trusted by returning status ok', async t => {
  const port = await listener(t, (req, res) => {
    assert.equal(req.url.includes(key), false);
    assert.notEqual(req.headers['x-elitesand-health-challenge'], key);
    res.end(JSON.stringify({ status: 'ok', version: '1.3.0', shellProof: req.headers['x-elitesand-health-challenge'] }));
  });
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'occupied');
});

test('S-09: a valid per-launch proof authenticates the listening port', async t => {
  let challenge;
  const port = await listener(t, (req, res) => {
    challenge = req.headers['x-elitesand-health-challenge'];
    res.end(JSON.stringify({ status: 'ok', shellProof: proof(challenge, port) }));
  });
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'healthy');
  assert.match(challenge, /^[a-f0-9]{64}$/);
  assert.notEqual(challenge, key);
});

test('S-09: a captured proof cannot be replayed for the next challenge', async t => {
  let captured;
  const challenges = [];
  const port = await listener(t, (req, res) => {
    const challenge = req.headers['x-elitesand-health-challenge']; challenges.push(challenge);
    captured ||= proof(challenge, port);
    res.end(JSON.stringify({ status: 'ok', shellProof: captured }));
  });
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'healthy');
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'occupied');
  assert.notEqual(challenges[0], challenges[1]);
});

test('S-09: another launch key or another listening port cannot authenticate', async t => {
  let mode = 'key';
  const port = await listener(t, (req, res) => {
    const challenge = req.headers['x-elitesand-health-challenge'];
    res.end(JSON.stringify({ status: 'ok', shellProof: mode === 'key'
      ? proof(challenge, port, 'ab'.repeat(32)) : proof(challenge, port === 65535 ? 65534 : port + 1) }));
  });
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'occupied');
  mode = 'port';
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'occupied');
});

test('S-09: a generic status-ok listener is never reused as Elitesand Pro', async t => {
  const port = await listener(t, (_req, res) => res.end(JSON.stringify({ status: 'ok' })));
  assert.equal((await probeHealth(port)).state, 'occupied');
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'occupied');
});

test('S-09: an existing Elitesand Pro server without this launch key is still reused', async t => {
  // npm start、上次沒關乾淨的伺服器不知道這次啟動的金鑰；重用判斷不能要求證明，否則會另開一個 port。
  const port = await listener(t, (_req, res) => res.end(JSON.stringify({ status: 'ok', app: 'elitesand-pro', version: '1.3.0', timestamp: Date.now() })));
  assert.equal((await probeHealth(port)).state, 'healthy');
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'occupied');
});

test('S-09: older Elitesand Pro servers without the app field are recognised for reuse', async t => {
  const port = await listener(t, (_req, res) => res.end(JSON.stringify({ status: 'ok', version: '1.0.0', timestamp: Date.now() })));
  assert.equal((await probeHealth(port)).state, 'healthy');
});

test('S-09: a server claiming another app identity is not reused', async t => {
  const port = await listener(t, (_req, res) => res.end(JSON.stringify({ status: 'ok', app: 'other', version: '1.0.0', timestamp: Date.now() })));
  assert.equal((await probeHealth(port)).state, 'occupied');
});

test('S-09: reuse probes do not send the launch key; only the freshly forked server is challenged', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const withKey = source.match(/probeHealthImpl\([^)]*identityKey/g) || [];
  assert.equal(withKey.length, 1, 'only waitForHealthyServer may require the launch proof');
  assert.ok(source.includes('const existing = await probeHealthImpl(port);'));
});

test('S-09: an oversized health response is rejected', async t => {
  const port = await listener(t, (_req, res) => res.end(JSON.stringify({ status: 'ok', padding: 'x'.repeat(65536) })));
  assert.equal((await probeHealth(port, { identityKey: key })).state, 'occupied');
});

test('S-09: a trickling response cannot extend the total probe deadline', { timeout: 1500 }, async t => {
  const timers = [];
  const port = await listener(t, (_req, res) => {
    res.writeHead(200); res.write('{');
    const timer = setInterval(() => res.write(' '), 10); timers.push(timer);
    res.on('close', () => clearInterval(timer));
  });
  t.after(() => timers.forEach(clearInterval));
  const started = Date.now();
  const result = await Promise.race([
    probeHealth(port, { identityKey: key, timeoutMs: 100 }),
    new Promise(resolve => { const timer = setTimeout(() => resolve({ state: 'hung' }), 500); timer.unref(); }),
  ]);
  assert.equal(result.state, 'occupied');
  assert.ok(Date.now() - started < 450);
});

test('S-09: an aborted response completes the probe', { timeout: 1500 }, async t => {
  const port = await listener(t, (_req, res) => { res.writeHead(200); res.write('{'); setImmediate(() => res.destroy()); });
  const result = await Promise.race([
    probeHealth(port, { identityKey: key, timeoutMs: 100 }),
    new Promise(resolve => { const timer = setTimeout(() => resolve({ state: 'hung' }), 500); timer.unref(); }),
  ]);
  assert.equal(result.state, 'occupied');
});

test('S-09: the real server consumes the launch key and signs only valid challenges', { timeout: 15000 }, async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { fork } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-shell-identity-'));
  const child = fork(path.join(__dirname, 'fixtures/shell-health-server.js'), [], {
    env: {
      ...process.env, PORT: '0', OPEN_BROWSER: '0', ELITESAND_DISABLE_ANNOUNCEMENTS: '1',
      ELITESAND_DATA_DIR: path.join(root, 'data'), ELITESAND_LOGS_DIR: path.join(root, 'logs'),
      ELITESAND_DOWNLOADS_DIR: path.join(root, 'downloads'), ELITESAND_SHELL_HEALTH_KEY: key,
    },
    silent: true, windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(() => { throw new Error(output || 'Identity fixture exited'); }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(output || 'Identity fixture timed out')), 10000); timer.unref(); }),
  ]);
  assert.equal(ready.retainedShellKey, false);
  assert.equal((await probeHealth(ready.port, { identityKey: key })).state, 'healthy');
  assert.equal((await probeHealth(ready.port, { identityKey: 'ab'.repeat(32) })).state, 'occupied');
  const generic = await fetch(`http://127.0.0.1:${ready.port}/api/health`).then(res => res.json());
  assert.equal(generic.status, 'ok'); assert.equal(Object.hasOwn(generic, 'shellProof'), false);
  const invalid = await fetch(`http://127.0.0.1:${ready.port}/api/health`, {
    headers: { 'X-Elitesand-Health-Challenge': 'not-a-valid-challenge' },
  }).then(res => res.json());
  assert.equal(Object.hasOwn(invalid, 'shellProof'), false);
});

test('S-09: malformed keys and proofs fail closed, and consuming a key erases its environment entry', () => {
  const { consumeShellHealthKey, createShellHealthProof, verifyShellHealthProof } = require('../server/utils/shell-health-proof');
  const env = { ELITESAND_SHELL_HEALTH_KEY: key };
  assert.equal(consumeShellHealthKey(env), key); assert.deepEqual(env, {});
  const invalid = { ELITESAND_SHELL_HEALTH_KEY: 'invalid' };
  assert.equal(consumeShellHealthKey(invalid), null); assert.deepEqual(invalid, {});
  for (const bad of [null, '', 'x'.repeat(64), 'AB'.repeat(32), ['ab'.repeat(32)]]) {
    assert.equal(createShellHealthProof(bad, key, 3000), null);
    assert.equal(verifyShellHealthProof(key, key, 3000, bad), false);
  }
  assert.equal(verifyShellHealthProof(key, key, 3000, proof(key, 3000)), true);
  assert.equal(createShellHealthProof(key, key, 0), null);
});
