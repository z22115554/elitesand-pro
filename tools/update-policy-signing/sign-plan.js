'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  UPDATE_POLICY_PUBLIC_KEYS,
  getUpdatePolicyPublicKey,
  isUpdatePolicyKeyAllowedForChannel,
} = require('../../server/services/update-policy-public-keys');
const {
  publicKeyHexFromPrivateKey,
  signUpdatePlan,
} = require('../../server/services/update-policy');

// This public key belongs to tests/fixtures/update-policy-test-private.pem. It
// is intentionally only recognised by this release-only tool, and only after
// the caller explicitly opts into a non-production test signing path.
const TEST_POLICY_PUBLIC_KEY_HEX = '302a300506032b6570032100303316aa888d727916d267c1e939af885390c3065c4ff6aa4bb2cee140c93303';
const TEST_POLICY_KEY_ID = 'update-policy-test-fixture';

function parseArgs(argv) {
  const args = { planPath: null, privateKeyPath: null, keyId: null, allowTestKey: false };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!args.planPath && !value.startsWith('--')) args.planPath = value;
    else if (value === '--private-key') args.privateKeyPath = argv[++i];
    else if (value === '--key-id') args.keyId = argv[++i];
    else if (value === '--allow-test-key') args.allowTestKey = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.planPath) throw new Error('Usage: node sign-plan.js <plan.json> --key-id <keyId> [--private-key <pem>] [--allow-test-key]');
  if (!args.keyId) throw new Error('--key-id is required');
  return args;
}

function loadPrivateKey(args) {
  if (args.privateKeyPath) {
    const resolved = path.resolve(args.privateKeyPath);
    if (!fs.existsSync(resolved)) throw new Error(`Update policy private key not found: ${resolved}`);
    return fs.readFileSync(resolved, 'utf8');
  }
  const encoded = String(process.env.ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64 || '').trim();
  if (!encoded) throw new Error('Missing update policy private key. Set ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64 or pass --private-key.');
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function assertTrustedSigner(keyId, privateKey, allowTestKey) {
  const actualPublicKeyHex = publicKeyHexFromPrivateKey(privateKey);
  if (actualPublicKeyHex === TEST_POLICY_PUBLIC_KEY_HEX) {
    if (!allowTestKey || keyId !== TEST_POLICY_KEY_ID) throw new Error('Refusing to sign a release plan with the repository test policy key.');
    return;
  }
  if (allowTestKey) throw new Error('--allow-test-key only permits the repository test policy key.');
  const expectedPublicKeyHex = getUpdatePolicyPublicKey(keyId, UPDATE_POLICY_PUBLIC_KEYS);
  if (!expectedPublicKeyHex || actualPublicKeyHex !== expectedPublicKeyHex) {
    throw new Error('The supplied policy private key does not match a public key embedded in Elitesand Pro. Refusing to create an unusable release.');
  }
}

function main() {
  const args = parseArgs(process.argv);
  const planPath = path.resolve(args.planPath);
  const privateKey = crypto.createPrivateKey(loadPrivateKey(args));
  assertTrustedSigner(args.keyId, privateKey, args.allowTestKey);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (!args.allowTestKey && !isUpdatePolicyKeyAllowedForChannel(args.keyId, plan?.channel)) {
    throw new Error(`The supplied policy key is not allowed for the ${plan?.channel || 'unknown'} channel.`);
  }
  const signed = signUpdatePlan(plan, privateKey, { keyId: args.keyId });
  fs.writeFileSync(planPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
  console.log(`Signed ${path.basename(planPath)} with update-policy Ed25519 (${args.keyId}).`);
}

try {
  main();
} catch (error) {
  console.error(`[update-policy-signing] ${error.message}`);
  process.exitCode = 1;
}
