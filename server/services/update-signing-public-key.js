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
  UPDATE_SIGNATURE_KEY_ID: 'update-ed25519-2026-08-14-02',
  UPDATE_PUBLIC_KEY_HEX: '302a300506032b65700321003c2075d0b78f34e8caa848ae1191b3f23e87cc02e45693aca5aa905fd3ec1ac9',
};
