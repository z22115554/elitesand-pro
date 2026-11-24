#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getRawHeader, listPackage } = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants');
const { NtExecutable, NtExecutableResource } = require('resedit');
const { SERVER_REQUIRED_PUBLIC_JS } = require('./build-production-bundles');

const EXPECTED_FUSES = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};

const REQUIRED_NOTICE_FILES = [
  'THIRD-PARTY-NOTICES.txt',
  'public/vendor/soundtouch-LGPL-2.1.txt',
  'public/vendor/licenses/OpenPGP-LGPL-3.0.txt',
  'public/vendor/licenses/OpenPGP-GPL-3.0.txt',
  'public/vendor/licenses/Tone-MIT.txt',
  'public/vendor/licenses/Spout2-BSD-2-Clause.txt',
  'public/vendor/licenses/kuromoji-IPADIC-NOTICE.txt',
  'public/vendor/licenses/OpenCC-data-NOTICES.txt',
  'public/fonts/OFL-IBM-Plex.txt',
  'public/fonts/OFL-fraunces.txt',
  'public/fonts/OFL-jetbrains-mono.txt',
  'public/fonts/OFL-manrope.txt',
  'public/assets/fonts/kongyuan/OFL-1.1.txt',
  'public/assets/fonts/kongyuan/NOTICE.txt',
  'public/assets/fonts/cubic11/OFL.txt',
  'public/assets/fonts/cubic11/NOTICE.txt',
  'public/assets/fonts/boutique9x9/OFL.txt',
  'public/assets/fonts/boutique9x9/NOTICE.txt',
];

function verifyBundledNotices(files) {
  const included = new Set(files);
  for (const file of REQUIRED_NOTICE_FILES) {
    if (!included.has(file)) throw new Error(`Required third-party notice is missing from app.asar: ${file}`);
  }
}

function countFileIntegrity(node) {
  if (!node || typeof node !== 'object') return 0;
  if (node.files && typeof node.files === 'object') {
    return Object.values(node.files).reduce((total, child) => total + countFileIntegrity(child), 0);
  }
  return node.offset !== undefined && !node.unpacked && node.integrity?.algorithm === 'SHA256' ? 1 : 0;
}

function readWindowsAsarIntegrity(executablePath) {
  const executable = NtExecutable.from(fs.readFileSync(executablePath));
  const resources = NtExecutableResource.from(executable);
  const entry = resources.entries.find((item) => item.type === 'INTEGRITY' && item.id === 'ELECTRONASAR');
  if (!entry) throw new Error('Windows ElectronAsar integrity resource is missing.');
  return JSON.parse(Buffer.from(entry.bin).toString('utf8'));
}

async function verify(unpackedRoot) {
  const appRoot = path.resolve(unpackedRoot);
  const resources = path.join(appRoot, 'resources');
  const asarPath = path.join(resources, 'app.asar');
  const executablePath = path.join(appRoot, 'Elitesand Pro.exe');
  if (!fs.existsSync(asarPath)) throw new Error('resources/app.asar is missing.');
  if (fs.existsSync(path.join(resources, 'app'))) throw new Error('resources/app must not exist when OnlyLoadAppFromAsar is enabled.');
  if (fs.existsSync(`${asarPath}.unpacked`) && fs.readdirSync(`${asarPath}.unpacked`, { recursive: true }).length > 0) {
    throw new Error('Unpacked application code bypasses ASAR integrity.');
  }
  if (!fs.existsSync(executablePath)) throw new Error('The packaged Elitesand Pro executable is missing.');

  const header = getRawHeader(asarPath);
  const protectedFiles = countFileIntegrity(header.header);
  if (protectedFiles === 0) throw new Error('app.asar has no per-file integrity hashes.');
  const files = listPackage(asarPath).map((file) => file.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
  verifyBundledNotices(files);
  if (!files.includes('electron/packaged-resource-integrity.generated.js')) {
    throw new Error('The packaged external-resource integrity manifest is missing.');
  }
  // 同構模組（例如 lyric-template-defaults.js：server 端 require 的共用預設值）本來就要留在原路徑，不算模板原始碼
  const serverRequired = new Set(SERVER_REQUIRED_PUBLIC_JS.map((name) => `public/js/${name}`));
  const plainTemplates = files.filter((file) => /^public\/js\/lyric-template-[^/]+\.js$/i.test(file) && !serverRequired.has(file));
  if (plainTemplates.length) {
    throw new Error(`Plain lyric template source was included in app.asar: ${plainTemplates.join(', ')}`);
  }
  // The AI separation sidecar is launched by python.exe, which cannot read anything
  // inside app.asar. It ships as a real file under resources/tools/ (integrity-hashed
  // like yt-dlp), and must not also linger inside the archive as a decoy copy.
  for (const script of ['supervisor.py', 'worker.py', 'haqumei_sidecar.py']) {
    if (!fs.existsSync(path.join(resources, 'tools', 'ai', script))) {
      throw new Error(`resources/tools/ai/${script} is missing; packaged AI separation cannot start.`);
    }
  }
  for (const relative of [
    'tools/g2p/python.exe',
    'tools/g2p/python311.dll',
    'tools/g2p/python311.zip',
    'tools/g2p/python311._pth',
    'tools/g2p/LICENSE.txt',
    'tools/g2p/Lib/site-packages/haqumei/haqumei.pyd',
  ]) {
    if (!fs.existsSync(path.join(resources, ...relative.split('/')))) {
      throw new Error(`${relative} is missing; bundled Japanese G2P cannot start.`);
    }
  }
  const haqumeiNotices = path.join(resources, 'licenses', 'haqumei');
  if (!fs.existsSync(haqumeiNotices) || !fs.statSync(haqumeiNotices).isDirectory()
    || fs.readdirSync(haqumeiNotices).filter(name => name !== 'PROVENANCE.txt').length === 0) {
    throw new Error('Bundled Haqumei license material is missing.');
  }
  if (files.some((file) => file.endsWith('.py'))) {
    throw new Error('Python sidecar scripts must not live inside app.asar; python.exe cannot read them there.');
  }

  const expectedHeaderHash = crypto.createHash('sha256').update(Buffer.from(header.headerString, 'utf8')).digest('hex');
  const integrityEntries = readWindowsAsarIntegrity(executablePath);
  const integrity = integrityEntries.find((entry) => String(entry.file || '').replace(/\//g, '\\').toLowerCase() === 'resources\\app.asar');
  if (!integrity || integrity.alg !== 'sha256' || integrity.value !== expectedHeaderHash) {
    throw new Error('Windows ElectronAsar integrity resource does not match app.asar.');
  }

  const fuseWire = await getCurrentFuseWire(executablePath);
  for (const [key, expected] of Object.entries(EXPECTED_FUSES)) {
    const actual = fuseWire[key];
    const required = expected ? FuseState.ENABLE : FuseState.DISABLE;
    if (actual !== required) throw new Error(`Electron fuse ${FuseV1Options[key]} is not ${expected ? 'enabled' : 'disabled'}.`);
  }
  return { protectedFiles, asarFiles: files.length };
}

async function main() {
  const unpackedRoot = process.argv[2];
  if (!unpackedRoot) throw new Error('Usage: verify-electron-package.js <win-unpacked-directory>');
  const result = await verify(unpackedRoot);
  process.stdout.write(`Secure Electron package verified: ${result.protectedFiles} protected ASAR files, ${result.asarFiles} archive entries.\n`);
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { EXPECTED_FUSES, REQUIRED_NOTICE_FILES, verifyBundledNotices, countFileIntegrity, readWindowsAsarIntegrity, verify };
