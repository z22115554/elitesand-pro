'use strict';

const crypto = require('node:crypto');
const HEX_256 = /^[a-f0-9]{64}$/;
const SHELL_HEALTH_KEY_ENV = 'ELITESAND_SHELL_HEALTH_KEY';

function consumeShellHealthKey(env = process.env) {
  const key = env[SHELL_HEALTH_KEY_ENV];
  // Do not pass the shell capability to downloaded tools or later child processes.
  delete env[SHELL_HEALTH_KEY_ENV];
  return typeof key === 'string' && HEX_256.test(key) ? key : null;
}

function createShellHealthProof(key, challenge, port) {
  if (typeof key !== 'string' || !HEX_256.test(key)
    || typeof challenge !== 'string' || !HEX_256.test(challenge)
    || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return crypto.createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`ElitesandPro/shell-health/v1\n${challenge}\n${port}`).digest('hex');
}

function verifyShellHealthProof(key, challenge, port, proof) {
  if (typeof proof !== 'string' || !HEX_256.test(proof)) return false;
  const expected = createShellHealthProof(key, challenge, port);
  return expected !== null && crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(proof, 'hex'));
}

module.exports = { SHELL_HEALTH_KEY_ENV, consumeShellHealthKey, createShellHealthProof, verifyShellHealthProof };
