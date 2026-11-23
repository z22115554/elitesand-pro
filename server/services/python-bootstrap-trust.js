'use strict';
const crypto = require('crypto');

// PyPA immutable commit; the trusted hash ships with the app.
const GET_PIP_URL = 'https://raw.githubusercontent.com/pypa/get-pip/8c427468071b5d15717839ffd76c53a96df8b703/public/get-pip.py';
const GET_PIP_SHA256 = '356e0d0de21cdc348c3394084d90939b85e4246c4d14c76aee6ca4f46646ea98';
function verifyGetPip(bytes) {
  if (!Buffer.isBuffer(bytes) || crypto.createHash('sha256').update(bytes).digest('hex') !== GET_PIP_SHA256) {
    throw new Error('get-pip.py SHA-256 verification failed; refusing to execute the bootstrap script');
  }
  return bytes;
}
module.exports = { GET_PIP_URL, GET_PIP_SHA256, verifyGetPip };
