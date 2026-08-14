'use strict';

/**
 * Incremental updater publisher key (Ed25519, SPKI DER, hex encoded).
 *
 * This public key is intentionally shipped with the application. It can verify
 * official update manifests but cannot create a valid signature. The matching
 * private key must stay outside git (normally .local/update-signing/private-key.pem
 * or the ELITESAND_UPDATE_SIGNING_PRIVATE_KEY_B64 release secret).
 */
module.exports = {
  UPDATE_SIGNATURE_ALGORITHM: 'Ed25519',
  UPDATE_SIGNATURE_KEY_ID: 'update-ed25519-2026-08-14-01',
  UPDATE_PUBLIC_KEY_HEX: '302a300506032b6570032100eaf6a7eae18aca102b06c4a1c543e8fe306090f25a1169fe9513136c6be76c09',
};
