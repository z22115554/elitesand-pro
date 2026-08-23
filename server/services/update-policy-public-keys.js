'use strict';

/**
 * Trusted public keys for the *outer* update policy (Ed25519 SPKI DER, hex).
 *
 * This trust domain is deliberately independent from update-manifest signing.
 * A private policy key must never be committed, injected into a Worker, or
 * reused from the update payload signer.  The first real key is added only
 * during the explicitly approved deployment/key-ceremony phase; until then
 * the empty production map makes all remote plans fail closed.
 */
const UPDATE_POLICY_SIGNATURE_ALGORITHM = 'Ed25519';
const UPDATE_POLICY_PUBLIC_KEYS = Object.freeze({});

function getUpdatePolicyPublicKey(keyId, publicKeys = UPDATE_POLICY_PUBLIC_KEYS) {
  if (!publicKeys || typeof publicKeys !== 'object' || Array.isArray(publicKeys)) return null;
  const key = publicKeys[String(keyId || '')];
  return typeof key === 'string' ? key : null;
}

module.exports = {
  UPDATE_POLICY_SIGNATURE_ALGORITHM,
  UPDATE_POLICY_PUBLIC_KEYS,
  getUpdatePolicyPublicKey,
};
