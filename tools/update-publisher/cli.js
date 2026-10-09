#!/usr/bin/env node
'use strict';

/**
 * 發布程式內更新（一版一包）。每一版都跑一次，包括換了 Electron 的版本：
 *
 *   npm run release:hotfix -- --version x.y.z --publish
 *
 * - 只打包一次共用包，上傳到 R2：artifacts/<channel>/<x.y.z>/<x.y.z>/update.zip
 *   （中間那段放目標版本本身，沿用現有 artifact worker 的路徑規則，不用重新部署）。
 * - 從 R2 的登記表 registry/<channel>/win32-x64.json 找出 Electron runtime 相同、版本比較舊的
 *   已發布版本，各簽一份小計畫指向這一包；再把這一版寫進登記表，下一版才會把它列進來。
 * - 重建對照表 control/<channel>/win32-x64.json，切換後逐一向 Worker 驗證，失敗就還原。
 * - 換了 Electron／updater-node 的版本：沒有舊版能一鍵更新，只登記、清空對照表；
 *   使用者按「檢查更新」時改問 GitHub，提示下載安裝檔。下一版起恢復一鍵更新。
 * - GitHub Release 只放 Setup .exe 與它的 .sha256，不放任何更新包。
 *
 * 一版一包上線前發的版本（1.1.0 以前）只認綁定單一來源版本的舊格式。第一次用新流程時，
 * 可以用 --legacy-from 1.1.0（逗號分隔多個）替它們各打一包舊格式；每個都要本機有
 * dist/releases/v<那一版>/installer/incremental-baseline.json，而且各要完整打包一次。
 */

const childProcess = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { APP_VERSION } = require('../../server/utils/app-version');
const updater = require('../../server/services/app-updater-v2');
const { createPowerShellArtifactBuilder, createPowerShellSharedBuilder, runHotfixRelease } = require('./lib/publish-hotfix');
const { createR2S3Store } = require('./lib/r2-s3-store');
const { createRequestFingerprint, controlOriginForChannel } = require('../../server/services/cloudflare-update-provider');

function parseArgs(argv) {
  const parsed = { publish: false, legacyFrom: '', version: '', channel: 'stable', notesUrl: '' };
  const keys = { '--version': 'version', '--legacy-from': 'legacyFrom', '--channel': 'channel', '--notes-url': 'notesUrl' };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--publish') parsed.publish = true;
    else if (value === '--dry-run') parsed.publish = false;
    else if (value === '--from') {
      throw new Error('--from is gone: every compatible installed version now gets one shared package automatically. Use --legacy-from only for versions released before the shared format.');
    } else if (keys[value]) {
      const next = argv[++index];
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`);
      parsed[keys[value]] = next;
    } else throw new Error(`unknown argument: ${value}`);
  }
  return parsed;
}

function buildProcessInvocation(command, args, { platform = process.platform, comSpec = process.env.ComSpec } = {}) {
  const isWindowsBatch = platform === 'win32' && /\.cmd$/i.test(command);
  // `run` only receives the publisher's fixed npm gate commands below.  Drive
  // a .cmd through cmd.exe explicitly instead of `shell: true`, which both
  // emits a Node security warning and obscures how the command is launched.
  return isWindowsBatch
    ? { executable: comSpec || 'cmd.exe', args: ['/d', '/s', '/c', [command, ...args].join(' ')] }
    : { executable: command, args };
}

function run(command, args, root) {
  const invocation = buildProcessInvocation(command, args);
  const result = childProcess.spawnSync(invocation.executable, invocation.args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
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
  if (!args.version) throw new Error('Usage: npm run release:hotfix -- --version <current-package-version> [--legacy-from <v1,v2>] [--channel stable|beta] [--notes-url <HTTPS URL>] [--publish]');
  if (args.version !== APP_VERSION) throw new Error(`--version ${args.version} does not match package version ${APP_VERSION}`);
  const legacyFromVersions = args.legacyFrom.split(',').map((value) => value.trim()).filter(Boolean);
  if (args.channel !== 'stable' && args.channel !== 'beta') throw new Error('--channel must be stable or beta');
  const releaseNotesUrl = args.notesUrl || (args.channel === 'stable' ? `https://github.com/z22115554/elitesand-pro/releases/tag/v${args.version}` : '');
  if (!/^https:\/\//.test(releaseNotesUrl)) throw new Error('--notes-url is required for a beta release and must be HTTPS');
  if (!args.publish) {
    const legacy = legacyFromVersions.length ? `; legacy packages for ${legacyFromVersions.join(', ')}` : '';
    process.stdout.write(`Dry run accepted for ${args.channel} v${args.version} (one shared package for every registered version with the same runtime${legacy}). No build, credential read, R2 write, Worker call, or control switch was performed.\n`);
    return;
  }

  const policyKeyId = String(process.env.ELITESAND_UPDATE_POLICY_KEY_ID || '').trim();
  const store = createR2S3Store({
    endpoint: process.env.ELITESAND_R2_ENDPOINT,
    bucket: process.env.ELITESAND_R2_BUCKET,
    accessKeyId: process.env.ELITESAND_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.ELITESAND_R2_SECRET_ACCESS_KEY,
  });
  const outputRoot = path.join(root, 'dist', 'releases', `v${args.version}`, 'hotfix');
  const sharedBuilder = createPowerShellSharedBuilder({ projectRoot: root, outputRoot, spawnSyncImpl: childProcess.spawnSync });
  const legacyBuilder = createPowerShellArtifactBuilder({
    projectRoot: root,
    baselineDirectory: path.join(root, 'dist', 'releases'),
    outputRoot,
    spawnSyncImpl: childProcess.spawnSync,
  });
  const result = await runHotfixRelease({
    targetVersion: args.version,
    legacyFromVersions,
    channel: args.channel,
    privateKey: readPolicyPrivateKey(),
    keyId: policyKeyId,
    releaseNotesUrl,
    sharedBuilder,
    legacyBuilder,
    // 共用包沒有來源版本，用 0.0.0 檢查（只要求目標版比它新）；套用前的 runtime 比對在使用者端做。
    inspectIncremental: async (zip, { fromVersion, targetVersion }) => updater.inspectUpdateZip(zip, { currentVersion: fromVersion || '0.0.0', expectedVersion: targetVersion }),
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
  process.stdout.write(`${describeRelease(result)}\n`);
}

function describeRelease(result) {
  const shared = result.plans.filter((entry) => entry.shared).map((entry) => entry.fromVersion);
  const legacy = result.plans.filter((entry) => !entry.shared).map((entry) => entry.fromVersion);
  const lines = [`v${result.targetVersion} (${result.channel}) published and registered.`];
  if (shared.length) lines.push(`  In-app update (one shared package): ${shared.join(', ')}`);
  if (legacy.length) lines.push(`  In-app update (legacy per-version packages): ${legacy.join(', ')}`);
  if (!shared.length && !legacy.length) {
    lines.push('  No installed version can update in-app to this release (first shared release, or the Electron runtime changed).');
    lines.push('  Everyone is pointed to the full Installer on GitHub Releases.');
  }
  lines.push('  GitHub Release needs only the Setup .exe and its .sha256.');
  return lines.join('\n');
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { buildProcessInvocation, describeRelease, parseArgs };
