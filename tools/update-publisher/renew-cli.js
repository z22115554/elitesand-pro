#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { createR2S3Store } = require('./lib/r2-s3-store');
const { renewActivePlans } = require('./lib/renew-plans');

const CONTROL_ORIGIN = 'https://elitesand-update-control.elitesand.workers.dev';
const REQUIRED_ENV = [
  'ELITESAND_R2_ENDPOINT', 'ELITESAND_R2_BUCKET', 'ELITESAND_R2_ACCESS_KEY_ID',
  'ELITESAND_R2_SECRET_ACCESS_KEY',
];

function parseArgs(argv) {
  const parsed = { channel: 'stable', publish: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--publish') parsed.publish = true;
    else if (argv[i] === '--dry-run') parsed.publish = false;
    else if (argv[i] === '--channel' && ['stable', 'beta'].includes(argv[i + 1])) parsed.channel = argv[++i];
    else throw new Error('Usage: renew-cli.js [--channel stable|beta] [--publish|--dry-run]');
  }
  return parsed;
}

async function probeWorker({ version, platform, arch, channel }, { fetchImpl = globalThis.fetch } = {}) {
  const url = new URL('/v1/plan', CONTROL_ORIGIN);
  // A release-side probe has no installed runtime. Like the publisher probe,
  // this verifies routing/bytes only; the Worker expects a 64-hex query value.
  const fingerprint = crypto.createHash('sha256').update(`elitesand-renewal-probe-v1\n${version}\n${platform}\n${arch}\n${channel}`).digest('hex');
  url.search = new URLSearchParams({ version, platform, arch, channel, fingerprint }).toString();
  const response = await fetchImpl(url, {
    redirect: 'error', signal: AbortSignal.timeout(4500), headers: { Accept: 'application/json' },
  });
  if (response.status !== 200 || response.headers.get('cache-control') !== 'no-store') throw new Error('renewal Worker probe did not return an uncached plan');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 64 * 1024) throw new Error('renewal Worker probe response size is invalid');
  return bytes;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const missing = REQUIRED_ENV.filter((name) => !String(env[name] || '').trim());
  if (missing.length) throw new Error(`Missing renewal secrets: ${missing.join(', ')}. Configure the private repository Actions secrets before enabling maintenance.`);
  const store = createR2S3Store({
    endpoint: env.ELITESAND_R2_ENDPOINT, bucket: env.ELITESAND_R2_BUCKET,
    accessKeyId: env.ELITESAND_R2_ACCESS_KEY_ID, secretAccessKey: env.ELITESAND_R2_SECRET_ACCESS_KEY,
  });
  const privateKey = env.ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64
    ? Buffer.from(env.ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64, 'base64').toString('utf8') : null;
  const result = await renewActivePlans({
    channel: args.channel, store, privateKey, keyId: env.ELITESAND_UPDATE_POLICY_KEY_ID,
    workerProbe: probeWorker, dryRun: !args.publish,
  });
  process.stdout.write(`${args.channel}: ${args.publish ? 'renewed' : 'would renew'} ${result.renewed} active plan(s)${result.skipped ? ` (${result.skipped})` : ''}.\n`);
  return result;
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { CONTROL_ORIGIN, REQUIRED_ENV, main, parseArgs, probeWorker };
