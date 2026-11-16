'use strict';
const fs = require('fs');
const path = require('path');

// Official yt-dlp public.key at commit 12647e03d417feaa9ea6a458bea5ebd747494a53.
// Rotation requires a reviewed app update; the download server cannot supply a key.
const SIGNING_FINGERPRINT = 'ac0cbbe6848d6a873464af4e57cf65933b5a7581';
let keyPromise;
function verificationKey() {
  const openpgp = require('openpgp');
  if (!keyPromise) keyPromise = openpgp.readKey({
    armoredKey: fs.readFileSync(path.join(__dirname, 'keys', 'yt-dlp-public.asc'), 'utf8'),
  }).then(key => {
    if (key.getFingerprint().toLowerCase() !== SIGNING_FINGERPRINT) throw new Error('yt-dlp signing key fingerprint mismatch');
    return key;
  });
  return keyPromise;
}

async function verifySignedChecksums(checksums, signatureBytes) {
  if (!Buffer.isBuffer(checksums) || checksums.length > 65536 || !Buffer.isBuffer(signatureBytes) || signatureBytes.length > 16384) {
    throw new Error('Invalid yt-dlp signed checksum size');
  }
  const openpgp = require('openpgp');
  const signature = signatureBytes.subarray(0, 30).toString().startsWith('-----BEGIN PGP SIGNATURE-----')
    ? await openpgp.readSignature({ armoredSignature: signatureBytes.toString('utf8') })
    : await openpgp.readSignature({ binarySignature: signatureBytes });
  const result = await openpgp.verify({
    message: await openpgp.createMessage({ binary: checksums }), signature,
    verificationKeys: await verificationKey(), expectSigned: true,
  });
  if (result.signatures.length !== 1) throw new Error('yt-dlp requires exactly one trusted checksum signature');
  await result.signatures[0].verified;
  const matches = checksums.toString('utf8').split(/\r?\n/)
    .map(line => /^([a-f0-9]{64})\s+\*?yt-dlp\.exe$/i.exec(line.trim())).filter(Boolean);
  if (matches.length !== 1) throw new Error('Signed yt-dlp checksum is missing or ambiguous');
  return matches[0][1].toLowerCase();
}

module.exports = { SIGNING_FINGERPRINT, verifySignedChecksums };
