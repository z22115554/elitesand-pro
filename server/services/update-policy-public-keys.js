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
  // 2026-09-06：1.0.0 尚未公開發布，還沒有已安裝的使用者在信任任何 stable key，這時候
  // 生第一把 stable key 沒有「換 key 讓舊用戶端失聯」的風險——之後只要有一版真的公開發布
  // 過，這把 key 就不可再換，私鑰只留在發版機（見 tools/update-policy-signing 的說明）。
  'elitesand-stable-policy-2026-09': '302a300506032b6570032100a9d6006d77f4818b0de9521a3f9ca31ea13f424195123134de82012a43992061',
});
const UPDATE_POLICY_KEY_CHANNELS = Object.freeze({
  'elitesand-beta-policy-2026-08': Object.freeze(['beta']),
  'elitesand-stable-policy-2026-09': Object.freeze(['stable']),
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
