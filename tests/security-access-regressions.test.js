'use strict';

// Exercise the real HTTP/Socket.IO entry points in a disposable process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.env.ELITESAND_ACCESS_FIXTURE === '1') {
  const { server, io } = require('../server/index');
  const access = require('../server/services/device-access-store');
  // Keep transport on loopback in CI while exercising the LAN authorization path.
  io.of('/')._fns.unshift((socket, next) => {
    if (socket.handshake.auth.fixtureRemote) socket.handshake.address = '192.168.1.25';
    next();
  });
  server.on('listening', () => process.send({
    port: server.address().port,
    controllerToken: access.redeemPairing(access.createPairing().code),
    sourceToken: access.getLocalStatus().sourceToken,
  }));
} else {
  const test = require('node:test');
  const { fork } = require('node:child_process');
  const { once } = require('node:events');
  const { io: connect } = require(path.resolve(require.resolve('socket.io'), '../../client-dist/socket.io.js'));
  let child, root, base, credentials, output = '';
  const clients = [];

  test.before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-access-audit-'));
    child = fork(__filename, [], {
      env: {
        ...process.env, PORT: '0', ELITESAND_ACCESS_FIXTURE: '1',
        ELITESAND_DATA_DIR: path.join(root, 'data'),
        ELITESAND_DOWNLOADS_DIR: path.join(root, 'downloads'),
        ELITESAND_LOGS_DIR: path.join(root, 'logs'),
        ELITESAND_DISABLE_ANNOUNCEMENTS: '1',
      },
      silent: true, windowsHide: true,
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    credentials = await Promise.race([
      once(child, 'message').then(([value]) => value),
      once(child, 'exit').then(() => { throw new Error(output); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(output || 'Fixture startup timeout')), 15000); timer.unref(); }),
    ]);
    base = `http://127.0.0.1:${credentials.port}`;
  });

  test.after(async () => {
    for (const client of clients) client.disconnect();
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function client(auth) {
    const socket = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false, auth });
    clients.push(socket);
    await Promise.race([
      once(socket, 'connect'),
      once(socket, 'connect_error').then(([error]) => { throw error; }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Socket timeout')), 5000); timer.unref(); }),
    ]);
    socket.emit('client:type', auth.clientType);
    return socket;
  }

  test('rebinding-shaped DNS names are rejected before any API executes', async () => {
    for (const host of ['fc-attacker.example', '10.attacker.example', '192.168.attacker.example', 'fe80.attacker.example']) {
      // http.request preserves a custom Host; fetch implementations may replace it.
      const status = await new Promise((resolve, reject) => {
        const req = require('node:http').get(`${base}/api/health`, { headers: { Host: `${host}:${credentials.port}` } }, res => {
          res.resume(); res.on('end', () => resolve(res.statusCode));
        });
        req.once('error', reject);
      });
      assert.equal(status, 421, host);
    }
  });

  test('cross-site writes are rejected for every Express route casing', async () => {
    for (const route of ['/api/eula/accept', '/API/eula/accept', '/Api/EULA/accept']) {
      const res = await fetch(`${base}${route}`, {
        method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'accepted=true',
      });
      assert.equal(res.status, 403, route);
      assert.equal((await res.json()).code, 'INVALID_ORIGIN', route);
    }
  });

  test('HEAD and mixed-case expensive GET routes retain cross-site protection', async () => {
    for (const [method, route] of [['GET', '/API/system-check?force=1'], ['GET', '/api/SYSTEM-CHECK?force=1'], ['HEAD', '/api/system-check?force=1']]) {
      const res = await fetch(`${base}${route}`, { method, headers: { Origin: 'https://evil.example' } });
      assert.equal(res.status, 403, `${method} ${route}`);
    }
  });

  test('paired LAN clients cannot claim desktop filesystem capabilities', async () => {
    const remote = await client({ clientType: 'controller', controllerToken: credentials.controllerToken, fixtureRemote: true });
    const result = await remote.timeout(3000).emitWithAck('library:storage:get', null);
    assert.equal(result.error, 'desktop_only');
    const migration = await remote.timeout(3000).emitWithAck('library:storage:migrate', { parentDir: root });
    assert.equal(migration.error, 'desktop_only');
    remote.disconnect();
  });

  test('expensive GET cooldown cannot be bypassed through HEAD or route casing', async () => {
    const first = await fetch(`${base}/api/system-check?force=1`, { method: 'HEAD' });
    assert.equal(first.status, 200);
    const second = await fetch(`${base}/API/SYSTEM-CHECK/?force=1`);
    assert.equal(second.status, 429);
    assert.equal((await second.json()).code, 'RATE_LIMITED');
  });

  test('revocation disconnects active LAN controllers but preserves desktop and OBS', async () => {
    const remote = await client({ clientType: 'remote', controllerToken: credentials.controllerToken, fixtureRemote: true });
    const desktop = await client({ clientType: 'controller' });
    const source = await client({ clientType: 'display', sourceToken: credentials.sourceToken, fixtureRemote: true });
    let reason = null; remote.once('disconnect', value => { reason = value; });
    const res = await fetch(`${base}/api/access/controllers/revoke`, { method: 'POST' });
    assert.equal(res.status, 200);
    await res.json();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(remote.connected, false, 'revoked phone must lose its existing session');
    assert.equal(reason, 'io server disconnect');
    assert.equal(desktop.connected, true);
    assert.equal(source.connected, true);
    const status = await desktop.timeout(3000).emitWithAck('library:storage:get', null);
    assert.equal(status.ok, true);
    const invalid = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false,
      auth: { clientType: 'remote', controllerToken: credentials.controllerToken, fixtureRemote: true } });
    clients.push(invalid);
    const [error] = await once(invalid, 'connect_error');
    assert.equal(error.message, 'CONTROLLER_PAIRING_REQUIRED');
  });
}
