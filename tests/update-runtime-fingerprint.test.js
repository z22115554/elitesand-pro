'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  getInstalledRuntimeFingerprint,
  runtimeFingerprintFromAsarHash,
  _resetForTests,
} = require('../server/services/update-runtime-fingerprint');

test('installed runtime fingerprint is deterministic for the shared app.asar bytes and never needs a machine identifier', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-runtime-fingerprint-'));
  const appAsar = path.join(root, 'resources', 'app.asar');
  try {
    fs.mkdirSync(path.dirname(appAsar), { recursive: true });
    fs.writeFileSync(appAsar, 'same packaged app bytes', 'utf8');
    _resetForTests();
    const first = await getInstalledRuntimeFingerprint({ installRoot: root, version: '1.0.0' });
    const second = await getInstalledRuntimeFingerprint({ installRoot: root, version: '1.0.0' });
    const nextVersion = await getInstalledRuntimeFingerprint({ installRoot: root, version: '1.0.1' });
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.strictEqual(first, second);
    assert.notStrictEqual(first, nextVersion);

    fs.writeFileSync(appAsar, 'different packaged app bytes with a different length', 'utf8');
    const changed = await getInstalledRuntimeFingerprint({ installRoot: root, version: '1.0.0' });
    assert.notStrictEqual(changed, first);
  } finally {
    _resetForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing or invalid packaged runtime fails closed without producing a request fingerprint', async () => {
  _resetForTests();
  assert.strictEqual(await getInstalledRuntimeFingerprint({ installRoot: path.join(os.tmpdir(), 'missing-elitesand-runtime') }), null);
  assert.strictEqual(runtimeFingerprintFromAsarHash({ version: '1.0.0', asarSha256: 'not-a-hash' }), null);
});

test('Electron utility process can hash the physical app.asar archive', { skip: !fs.existsSync(path.join(__dirname, '..', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')) }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-runtime-fingerprint-electron-'));
  const appAsar = path.join(root, 'resources', 'app.asar');
  const child = path.join(root, 'child.js');
  const main = path.join(root, 'main.js');
  const electron = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  try {
    fs.mkdirSync(path.dirname(appAsar), { recursive: true });
    fs.writeFileSync(appAsar, 'real physical app.asar bytes for Electron test', 'utf8');
    fs.writeFileSync(child, `'use strict';
const { getInstalledRuntimeFingerprint } = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'services', 'update-runtime-fingerprint.js'))});
getInstalledRuntimeFingerprint({ installRoot: process.env.ELITESAND_TEST_INSTALL_ROOT, version: '1.0.0' })
  .then((fingerprint) => process.parentPort.postMessage({ fingerprint }))
  .catch((error) => process.parentPort.postMessage({ error: error?.stack || String(error) }));
`, 'utf8');
    fs.writeFileSync(main, `'use strict';
const { app, utilityProcess } = require('electron');
app.whenReady().then(() => {
  const child = utilityProcess.fork(${JSON.stringify(child)}, [], {
    env: { ...process.env, ELITESAND_TEST_INSTALL_ROOT: ${JSON.stringify(root)} },
    stdio: 'ignore',
  });
  child.on('message', (message) => {
    process.stdout.write(JSON.stringify(message) + '\\n');
    child.kill();
    app.exit(message?.fingerprint ? 0 : 1);
  });
  setTimeout(() => app.exit(2), 10000).unref();
});
`, 'utf8');
    const result = childProcess.spawnSync(electron, [main], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const message = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.match(message.fingerprint, /^[a-f0-9]{64}$/);
    assert.strictEqual(message.error, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
