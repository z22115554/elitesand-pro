'use strict';

/**
 * Trusted public keys for the *outer* update policy (Ed25519 SPKI DER, hex).
 *
 * This trust domain is deliberately independent from update-manifest signing.
 * A private policy key must never be committed, injected into a Worker, or
 * reused from the update payload signer.  This beta key's private half is
 * held only on the release machine; it signs optional beta policy documents
 * and cannot authorize any payload by itself.
 */
const UPDATE_POLICY_SIGNATURE_ALGORITHM = 'Ed25519';
const UPDATE_POLICY_PUBLIC_KEYS = Object.freeze({
  'elitesand-beta-policy-2026-08': '302a300506032b65700321005e57400a7d0567b909fd0aecccd6817862bbcd52ebedaeedcb48111341c1b837',
});
const UPDATE_POLICY_KEY_CHANNELS = Object.freeze({
  'elitesand-beta-policy-2026-08': Object.freeze(['beta']),
});

function getUpdatePolicyPublicKey(keyId, publicKeys = UPDATE_POLICY_PUBLIC_KEYS) {
  if (!publicKeys || typeof publicKeys !== 'object' || Array.isArray(publicKeys)) return null;
  const key = publicKeys[String(keyId || '')];
  return typeof key === 'string' ? key : null;
}

function isUpdatePolicyKeyAllowedForChannel(keyId, channel, keyChannels = UPDATE_POLICY_KEY_CHANNELS) {
  const channels = keyChannels?.[String(keyId || '')];
  return Array.isArray(channels) && channels.includes(channel);
}

module.exports = {
  UPDATE_POLICY_SIGNATURE_ALGORITHM,
  UPDATE_POLICY_PUBLIC_KEYS,
  UPDATE_POLICY_KEY_CHANNELS,
  getUpdatePolicyPublicKey,
  isUpdatePolicyKeyAllowedForChannel,
};
