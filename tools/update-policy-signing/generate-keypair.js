#!/usr/bin/env node
'use strict';

// This utility creates the release-machine half of the independent outer
// policy trust domain. It deliberately refuses an overwrite: replacing an
// existing private key would strand already-packaged clients permanently.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { publicKeyHexFromPrivateKey } = require('../../server/services/update-policy');

const KEY_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function parseArgs(argv) {
  const result = { keyId: '', privateKeyPath: '' };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--key-id') result.keyId = argv[++index] || '';
    else if (value === '--private-key') result.privateKeyPath = argv[++index] || '';
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!KEY_ID_RE.test(result.keyId)) throw new Error('--key-id must be a lowercase release key id');
  if (!result.privateKeyPath || !path.isAbsolute(result.privateKeyPath)) throw new Error('--private-key must be an absolute path outside version control');
  return result;
}

function generatePolicyKeypair(privateKeyPath, fsImpl = fs) {
  const target = path.resolve(privateKeyPath);
  if (fsImpl.existsSync(target)) throw new Error(`Refusing to overwrite existing update policy private key: ${target}`);
  const pair = crypto.generateKeyPairSync('ed25519');
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyHex = publicKeyHexFromPrivateKey(privatePem);
  fsImpl.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fsImpl.writeFileSync(target, privatePem, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return Object.freeze({ privateKeyPath: target, publicKeyHex });
}

function main() {
  const args = parseArgs(process.argv);
  const created = generatePolicyKeypair(args.privateKeyPath);
  process.stdout.write(`Created Ed25519 policy key ${args.keyId}.\nPrivate key: ${created.privateKeyPath}\nPublic key (embed in app): ${created.publicKeyHex}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`[update-policy-keygen] ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { generatePolicyKeypair, parseArgs };
