#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { APP_VERSION } = require('../../server/utils/app-version');
const updater = require('../../server/services/app-updater-v2');
const { createPowerShellArtifactBuilder, runHotfixRelease } = require('./lib/publish-hotfix');
const { createR2S3Store } = require('./lib/r2-s3-store');
const { createRequestFingerprint, controlOriginForChannel } = require('../../server/services/cloudflare-update-provider');

function parseArgs(argv) {
  const parsed = { publish: false, from: '', version: '', channel: 'stable', notesUrl: '' };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--publish') parsed.publish = true;
    else if (value === '--dry-run') parsed.publish = false;
    else if (value === '--version' || value === '--from' || value === '--channel' || value === '--notes-url') {
      const next = argv[++index];
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`);
      parsed[value === '--notes-url' ? 'notesUrl' : value.slice(2)] = next;
    } else throw new Error(`unknown argument: ${value}`);
  }
  return parsed;
}

function run(command, args, root) {
  const result = childProcess.spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function readPolicyPrivateKey() {
  const encoded = String(process.env.ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64 || '').trim();
  if (!encoded) throw new Error('ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64 is required for --publish');
  return Buffer.from(encoded, 'base64').toString('utf8');
}

async function readPublicArtifact(url) {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`public artifact read-back failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function probeWorker({ version, platform, arch, channel }) {
  const url = new URL(`${controlOriginForChannel(channel)}/v1/plan`);
  // This probe has no installed app.asar. It only verifies the Worker routing
  // contract after a publish, so it supplies a deterministic release-probe
  // runtime value; production clients always derive theirs from app.asar.
  const runtimeFingerprint = crypto.createHash('sha256').update(`elitesand-release-probe-v1\n${version}\n${platform}\n${arch}\n${channel}`, 'utf8').digest('hex');
  const fingerprint = createRequestFingerprint({ version, platform, arch, channel, runtimeFingerprint });
  if (!fingerprint) throw new Error('could not build release Worker probe fingerprint');
  url.search = new URLSearchParams({ version, platform, arch, channel, fingerprint }).toString();
  const response = await fetch(url, { redirect: 'error', headers: { Accept: 'application/json' } });
  if (response.status !== 200 || response.headers.get('cache-control') !== 'no-store') throw new Error('Worker probe did not return an uncached signed plan');
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..', '..');
  if (!args.version || !args.from) throw new Error('Usage: npm run release:hotfix -- --version <current-package-version> --from <v1> [--channel stable|beta] [--notes-url <HTTPS URL>] [--publish]');
  if (args.version !== APP_VERSION) throw new Error(`--version ${args.version} does not match package version ${APP_VERSION}`);
  const fromVersions = args.from.split(',').map((value) => value.trim()).filter(Boolean);
  if (args.channel !== 'stable' && args.channel !== 'beta') throw new Error('--channel must be stable or beta');
  const releaseNotesUrl = args.notesUrl || (args.channel === 'stable' ? `https://github.com/z22115554/elitesand-pro/releases/tag/v${args.version}` : '');
  if (!/^https:\/\//.test(releaseNotesUrl)) throw new Error('--notes-url is required for a beta release and must be HTTPS');
  if (!args.publish) {
    process.stdout.write(`Dry run accepted for ${args.channel} v${args.version} from ${fromVersions.join(', ')}. No build, credential read, R2 write, Worker call, or control switch was performed.\n`);
    return;
  }

  const policyKeyId = String(process.env.ELITESAND_UPDATE_POLICY_KEY_ID || '').trim();
  const store = createR2S3Store({
    endpoint: process.env.ELITESAND_R2_ENDPOINT,
    bucket: process.env.ELITESAND_R2_BUCKET,
    accessKeyId: process.env.ELITESAND_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.ELITESAND_R2_SECRET_ACCESS_KEY,
  });
  const builder = createPowerShellArtifactBuilder({
    projectRoot: root,
    baselineDirectory: path.join(root, 'dist', 'releases'),
    outputRoot: path.join(root, 'dist', 'releases', `v${args.version}`, 'hotfix'),
    spawnSyncImpl: childProcess.spawnSync,
  });
  await runHotfixRelease({
    targetVersion: args.version,
    fromVersions,
    channel: args.channel,
    privateKey: readPolicyPrivateKey(),
    keyId: policyKeyId,
    releaseNotesUrl,
    artifactBuilder: builder,
    inspectIncremental: async (zip, { fromVersion, targetVersion }) => updater.inspectUpdateZip(zip, { currentVersion: fromVersion, expectedVersion: targetVersion }),
    store,
    publicArtifactRead: readPublicArtifact,
    workerProbe: probeWorker,
    dryRun: false,
    runChecks: async () => {
      run('npm.cmd', ['test'], root);
      run('npm.cmd', ['run', 'smoke:electron'], root);
      run('npm.cmd', ['run', 'audit:release'], root);
    },
  });
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
