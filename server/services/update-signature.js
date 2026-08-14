'use strict';

const crypto = require('crypto');
const {
  UPDATE_SIGNATURE_ALGORITHM,
  UPDATE_SIGNATURE_KEY_ID,
  UPDATE_PUBLIC_KEY_HEX,
} = require('./update-signing-public-key');

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalManifestBytes(manifest) {
  const { signature, ...rest } = manifest || {};
  return Buffer.from(canonicalize(rest), 'utf8');
}

function normalizePrivateKey(key) {
  if (key instanceof crypto.KeyObject) {
    if (key.type !== 'private') throw new Error('update signing key must be a private key');
    return key;
  }
  return crypto.createPrivateKey(key);
}

function publicKeyHexFromKey(key) {
  return crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('hex');
}

function loadPublicKey(publicKeyHex = UPDATE_PUBLIC_KEY_HEX) {
  if (typeof publicKeyHex !== 'string' || !/^[a-f0-9]+$/i.test(publicKeyHex)) {
    throw new Error('update signing public key is invalid');
  }
  return crypto.createPublicKey({
    key: Buffer.from(publicKeyHex, 'hex'),
    format: 'der',
    type: 'spki',
  });
}

function signUpdateManifest(manifest, privateKey) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('update manifest must be an object');
  }
  if (!privateKey) throw new Error('update signing private key is required');

  const unsigned = {
    ...manifest,
    signatureAlgorithm: UPDATE_SIGNATURE_ALGORITHM,
    signatureKeyId: UPDATE_SIGNATURE_KEY_ID,
  };
  delete unsigned.signature;
  const key = normalizePrivateKey(privateKey);
  const signature = crypto.sign(null, canonicalManifestBytes(unsigned), key).toString('hex');
  return { ...unsigned, signature };
}

function verifyUpdateManifestSignature(manifest, { publicKeyHex = UPDATE_PUBLIC_KEY_HEX } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, reason: 'manifest 不是物件' };
  }
  if (manifest.signatureAlgorithm !== UPDATE_SIGNATURE_ALGORITHM) {
    return { ok: false, reason: `signatureAlgorithm 必須是 ${UPDATE_SIGNATURE_ALGORITHM}` };
  }
  if (manifest.signatureKeyId !== UPDATE_SIGNATURE_KEY_ID) {
    return { ok: false, reason: `signatureKeyId 不受信任：${manifest.signatureKeyId || 'missing'}` };
  }
  if (typeof manifest.signature !== 'string' || !/^[a-f0-9]{128}$/i.test(manifest.signature)) {
    return { ok: false, reason: 'signature 缺少或格式無效' };
  }

  try {
    const valid = crypto.verify(
      null,
      canonicalManifestBytes(manifest),
      loadPublicKey(publicKeyHex),
      Buffer.from(manifest.signature, 'hex'),
    );
    return valid ? { ok: true } : { ok: false, reason: 'Ed25519 驗章失敗' };
  } catch (error) {
    return { ok: false, reason: `Ed25519 驗章失敗：${error.message}` };
  }
}

module.exports = {
  canonicalize,
  canonicalManifestBytes,
  normalizePrivateKey,
  publicKeyHexFromKey,
  loadPublicKey,
  signUpdateManifest,
  verifyUpdateManifestSignature,
};
