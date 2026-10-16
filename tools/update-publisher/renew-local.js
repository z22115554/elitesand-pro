#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { main: renew, parseArgs } = require('./renew-cli');

const R2_NAMES = Object.freeze([
  'ELITESAND_R2_ENDPOINT', 'ELITESAND_R2_BUCKET',
  'ELITESAND_R2_ACCESS_KEY_ID', 'ELITESAND_R2_SECRET_ACCESS_KEY',
]);
const CHANNEL_KEYS = Object.freeze({
  stable: { file: 'update-policy-stable-2026-09.pem', id: 'elitesand-stable-policy-2026-09' },
  beta: { file: 'update-policy-beta-2026-08.pem', id: 'elitesand-beta-policy-2026-08' },
});

// Read only release-specific names; never evaluate shell code or load unrelated
// process settings from the credential file. Credentials remain outside Git.
function parseLocalR2Env(text) {
  const result = {};
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || !R2_NAMES.includes(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function loadLocalEnvironment(channel, {
  keysDir = path.join(os.homedir(), '.elitesand-pro', 'release-keys'),
  env = process.env, readFile = fs.readFileSync,
} = {}) {
  const key = CHANNEL_KEYS[channel];
  if (!key) throw new Error('Unsupported local renewal channel');
  let credentials;
  try { credentials = parseLocalR2Env(readFile(path.join(keysDir, 'r2-beta-publisher.env'), 'utf8')); }
  catch (_) { throw new Error('Local R2 release credentials are unavailable in the release-keys directory'); }
  const scoped = {};
  for (const name of R2_NAMES) scoped[name] = String(env[name] || credentials[name] || '');
  let pem;
  try { pem = readFile(path.join(keysDir, key.file), 'utf8'); }
  catch (_) { throw new Error(`Local ${channel} policy signing key is unavailable in the release-keys directory`); }
  scoped.ELITESAND_UPDATE_POLICY_KEY_ID = key.id;
  scoped.ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64 = Buffer.from(pem, 'utf8').toString('base64');
  return scoped;
}

async function main(argv = process.argv.slice(2), { runRenewal = renew, ...options } = {}) {
  const args = parseArgs(argv);
  const env = loadLocalEnvironment(args.channel, options);
  return runRenewal(argv, env);
}

if (require.main === module) main().catch(() => {
  // SDK error details can contain request metadata. Keep unattended-task logs
  // free of credentials, signing material, and environment dumps.
  process.stderr.write('Local update-plan renewal failed. Check local release credentials, channel key, and R2 access.\n');
  process.exitCode = 1;
});

module.exports = { R2_NAMES, CHANNEL_KEYS, parseLocalR2Env, loadLocalEnvironment, main };
