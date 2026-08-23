'use strict';

const assert = require('assert');
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
