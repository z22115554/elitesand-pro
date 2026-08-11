#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getRawHeader, listPackage } = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants');
const { NtExecutable, NtExecutableResource } = require('resedit');

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
  if (!files.includes('electron/packaged-resource-integrity.generated.js')) {
    throw new Error('The packaged external-resource integrity manifest is missing.');
  }
  if (files.some((file) => /^public\/js\/lyric-template-[^/]+\.js$/i.test(file))) {
    throw new Error('Plain lyric template source was included in app.asar.');
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

module.exports = { EXPECTED_FUSES, countFileIntegrity, readWindowsAsarIntegrity, verify };
