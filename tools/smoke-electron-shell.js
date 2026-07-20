'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, timeout: 1500 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('timeout', () => req.destroy(new Error(`Timeout: ${pathname}`)));
    req.once('error', reject);
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited early (${child.exitCode})`);
    try {
      const response = await request(port, '/api/health');
      if (response.status === 200) return JSON.parse(response.body);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Electron shell did not become healthy: ${lastError?.message || 'timeout'}`);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-electron-smoke-'));
  const port = 39000 + Math.floor(Math.random() * 1000);
  const electronBinary = require('electron');
  let output = '';
  const userDataDir = path.join(runtimeRoot, 'user-data');
  const child = spawn(electronBinary, [`--user-data-dir=${userDataDir}`, 'electron/main.js'], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      ELITESAND_SHELL_HEADLESS: '1',
      ELITESAND_SHELL_QUIT_AFTER_READY_MS: '1000',
      ELITESAND_SHELL_PORT: String(port),
      ELITESAND_SHELL_USER_DATA_DIR: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12000); });

  try {
    const health = await waitForHealth(port, child);
    const panel = await request(port, '/panel');
    assert(health.status === 'ok', 'Electron server health response is invalid');
    assert(panel.status === 200, `Electron panel returned HTTP ${panel.status}`);
    await new Promise((resolve) => child.once('exit', resolve));
    assert(child.exitCode === 0, `Electron did not exit cleanly (${child.exitCode})`);
    process.stdout.write(`Electron shell smoke passed: port ${port}, server lifecycle, health, and panel route OK.\n`);
  } catch (error) {
    throw new Error(`${error.message}\nElectron output:\n${output}`);
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Electron shell smoke failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
