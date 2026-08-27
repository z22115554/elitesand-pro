'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const policy = require('../server/services/update-policy');
const { generatePolicyKeypair, parseArgs } = require('../tools/update-policy-signing/generate-keypair');

test('policy key generator makes an Ed25519 private key once and reports the embeddable public key', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-policy-keygen-'));
  const privateKeyPath = path.join(directory, 'beta-policy.pem');
  try {
    const created = generatePolicyKeypair(privateKeyPath);
    assert.strictEqual(created.privateKeyPath, privateKeyPath);
    assert.match(created.publicKeyHex, /^[a-f0-9]{88}$/);
    assert.strictEqual(policy.publicKeyHexFromPrivateKey(fs.readFileSync(privateKeyPath, 'utf8')), created.publicKeyHex);
    assert.throws(() => generatePolicyKeypair(privateKeyPath), /Refusing to overwrite/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('policy key generator requires an explicit absolute local destination', () => {
  assert.throws(() => parseArgs(['node', 'generate-keypair.js', '--key-id', 'beta-key']), /absolute path/);
  assert.throws(() => parseArgs(['node', 'generate-keypair.js', '--key-id', 'Beta-Key', '--private-key', 'C:\\key.pem']), /lowercase release key id/);
});
