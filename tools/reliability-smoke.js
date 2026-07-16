'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const durationMs = Math.max(10000, Number(process.env.RELIABILITY_SMOKE_MS) || 60000);

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function assert(value, message) { if (!value) throw new Error(message); }

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, timeout: 1500 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${pathname}`)));
    req.on('error', reject);
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${child.exitCode}`);
    try { if (await request(port, '/api/health') === 200) return; } catch (_) { /* retry */ }
    await delay(200);
  }
  throw new Error('server health timeout');
}

function connectClient(port, clientType, observation) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    const timeout = setTimeout(() => reject(new Error(`${clientType} socket handshake timeout`)), 5000);
    ws.on('message', (buffer) => {
      const message = buffer.toString();
      if (message.startsWith('0')) ws.send(`40${JSON.stringify({ clientType })}`);
      else if (message === '2') ws.send('3');
      else if (message.startsWith('40')) {
        ws.send(`42${JSON.stringify(['client:type', clientType])}`);
        clearTimeout(timeout);
        resolve(ws);
      } else if (message.startsWith('42')) {
        try {
          const [event, payload] = JSON.parse(message.slice(2));
          if (event === 'client:counts') observation.lastCounts = payload;
          if (event === 'state:sync' || event === 'state:recovery') observation.stateEvents += 1;
        } catch (_) { /* malformed frames are ignored by the smoke observer */ }
      }
    });
    ws.on('error', (error) => { clearTimeout(timeout); reject(error); });
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const root = path.join(__dirname, '..');
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-reliability-'));
  const dataDir = path.join(runtimeRoot, 'data');
  const downloadsDir = path.join(runtimeRoot, 'downloads');
  const logsDir = path.join(runtimeRoot, 'logs');
  const port = 38000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      OPEN_BROWSER: '0',
      ELITESAND_DATA_DIR: dataDir,
      ELITESAND_DOWNLOADS_DIR: downloadsDir,
      ELITESAND_LOGS_DIR: logsDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-16000); });
  child.stderr.on('data', chunk => { output = (output + chunk.toString()).slice(-16000); });
  const sockets = [];
  const observation = { lastCounts: null, stateEvents: 0 };
  let probes = 0;
  let reconnects = 0;

  try {
    await waitForHealth(port, child);
    for (const type of ['controller', 'display', 'remote', 'setlist']) {
      sockets.push(await connectClient(port, type, observation));
    }
    const startedAt = Date.now();
    let displayReconnected = false;
    while (Date.now() - startedAt < durationMs) {
      assert(child.exitCode === null, `server exited during reliability smoke: ${child.exitCode}`);
      const routes = ['/api/health', '/', '/controller', '/display', '/setlist'];
      const route = routes[probes % routes.length];
      assert(await request(port, route) === 200, `${route} did not return 200`);
      probes += 1;
      if (!displayReconnected && Date.now() - startedAt >= durationMs / 2) {
        sockets[1].close();
        await delay(250);
        sockets[1] = await connectClient(port, 'display', observation);
        displayReconnected = true;
        reconnects += 1;
      }
      await delay(250);
    }
    assert(observation.stateEvents > 0, 'controller/display did not receive state recovery events');
    assert(reconnects === 1, 'display reconnect scenario did not run');
    assert(probes >= Math.floor(durationMs / 1000), `too few health/route probes: ${probes}`);
    process.stdout.write(`Reliability smoke passed: ${Math.round(durationMs / 1000)}s, ${probes} HTTP probes, 4 socket roles, display reconnect OK.\n`);
  } catch (error) {
    throw new Error(`${error.message}\nServer output:\n${output}`);
  } finally {
    for (const socket of sockets) { try { socket.close(); } catch (_) { /* best effort */ } }
    await stop(child);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Reliability smoke failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
