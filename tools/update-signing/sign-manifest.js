'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  signUpdateManifest,
  publicKeyHexFromKey,
} = require('../../server/services/update-signature');
const { UPDATE_PUBLIC_KEY_HEX } = require('../../server/services/update-signing-public-key');

function parseArgs(argv) {
  const args = { manifestPath: null, privateKeyPath: null, allowNonproductionKey: false };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!args.manifestPath && !value.startsWith('--')) {
      args.manifestPath = value;
    } else if (value === '--private-key') {
      args.privateKeyPath = argv[++i];
    } else if (value === '--allow-nonproduction-key') {
      args.allowNonproductionKey = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!args.manifestPath) throw new Error('Usage: node sign-manifest.js <update-manifest.json> [--private-key <pem>] [--allow-nonproduction-key]');
  return args;
}

function loadPrivateKey(args) {
  if (args.privateKeyPath) {
    const resolved = path.resolve(args.privateKeyPath);
    if (!fs.existsSync(resolved)) throw new Error(`Update signing private key not found: ${resolved}`);
    return fs.readFileSync(resolved, 'utf8');
  }

  const encoded = String(process.env.ELITESAND_UPDATE_SIGNING_PRIVATE_KEY_B64 || '').trim();
  if (!encoded) {
    throw new Error('Missing update signing private key. Set ELITESAND_UPDATE_SIGNING_PRIVATE_KEY_B64 or pass --private-key.');
  }
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const manifestPath = path.resolve(args.manifestPath);
  const privateKeyPem = loadPrivateKey(args);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const actualPublicKeyHex = publicKeyHexFromKey(privateKey);

  if (!args.allowNonproductionKey && actualPublicKeyHex !== UPDATE_PUBLIC_KEY_HEX) {
    throw new Error('The supplied update signing private key does not match the public key embedded in Elitesand Pro. Refusing to create an unusable release.');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const signed = signUpdateManifest(manifest, privateKey);
  fs.writeFileSync(manifestPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
  console.log(`Signed ${path.basename(manifestPath)} with ${signed.signatureAlgorithm} (${signed.signatureKeyId}).`);
}

try {
  main();
} catch (error) {
  console.error(`[update-signing] ${error.message}`);
  process.exitCode = 1;
}
