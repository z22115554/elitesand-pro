'use strict';

// electron-builder writes the Windows resource that authenticates the ASAR
// header. Its stream packer does not add per-file ASAR hashes, however, so
// this post-pack hook adds them before it refreshes the resource. The hook
// runs before electron-builder flips fuses and before code signing.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getRawHeader } = require('@electron/asar');
const { Pickle } = require('@electron/asar/lib/pickle');
const { NtExecutable, NtExecutableResource } = require('resedit');

const BLOCK_SIZE = 1024 * 1024;

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function visitPackedFiles(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (node.files && typeof node.files === 'object') {
    Object.values(node.files).forEach((child) => visitPackedFiles(child, callback));
    return;
  }
  if (Object.prototype.hasOwnProperty.call(node, 'offset') && !node.unpacked) callback(node);
}

function buildFileIntegrity(archive, bodyOffset, node) {
  const offset = Number(node.offset);
  const size = Number(node.size);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('ASAR contains an unsafe file offset or size.');
  }
  const start = bodyOffset + offset;
  const end = start + size;
  if (end > archive.length) throw new Error('ASAR file entry extends beyond the archive body.');
  const contents = archive.subarray(start, end);
  const blocks = [];
  for (let cursor = 0; cursor < contents.length; cursor += BLOCK_SIZE) {
    blocks.push(hashBuffer(contents.subarray(cursor, Math.min(cursor + BLOCK_SIZE, contents.length))));
  }
  return { algorithm: 'SHA256', hash: hashBuffer(contents), blockSize: BLOCK_SIZE, blocks };
}

function pickleHeader(header) {
  const headerPickle = Pickle.createEmpty();
  headerPickle.writeString(JSON.stringify(header));
  const headerBuffer = headerPickle.toBuffer();
  const sizePickle = Pickle.createEmpty();
  sizePickle.writeUInt32(headerBuffer.length);
  return Buffer.concat([sizePickle.toBuffer(), headerBuffer]);
}

function addAsarFileIntegrity(asarPath) {
  const raw = getRawHeader(asarPath);
  const archive = fs.readFileSync(asarPath);
  const bodyOffset = 8 + raw.headerSize;
  let protectedFiles = 0;
  visitPackedFiles(raw.header, (node) => {
    node.integrity = buildFileIntegrity(archive, bodyOffset, node);
    protectedFiles++;
  });
  if (protectedFiles === 0) throw new Error('ASAR has no packed files to protect.');
  const prefix = pickleHeader(raw.header);
  fs.writeFileSync(asarPath, Buffer.concat([prefix, archive.subarray(bodyOffset)]));
  return { protectedFiles, header: getRawHeader(asarPath) };
}

function updateWindowsAsarIntegrityResource(executablePath, appAsarPath) {
  const executable = NtExecutable.from(fs.readFileSync(executablePath));
  const resources = NtExecutableResource.from(executable);
  const entry = resources.entries.find((item) => item.type === 'INTEGRITY' && item.id === 'ELECTRONASAR');
  if (!entry) throw new Error('electron-builder did not create the Windows ElectronAsar integrity resource.');
  const rawHeader = getRawHeader(appAsarPath);
  entry.bin = Buffer.from(JSON.stringify([{
    file: 'resources\\app.asar',
    alg: 'sha256',
    value: hashBuffer(Buffer.from(rawHeader.headerString, 'utf8')),
  }]));
  resources.outputResource(executable);
  fs.writeFileSync(executablePath, Buffer.from(executable.generate()));
}

function assertNoUnpackedApplicationCode(appAsarPath) {
  const unpacked = `${appAsarPath}.unpacked`;
  if (!fs.existsSync(unpacked)) return;
  const entries = fs.readdirSync(unpacked, { recursive: true });
  if (entries.length > 0) throw new Error(`Refusing an Installer with unpacked application code: ${unpacked}`);
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const resourcesDir = path.join(context.appOutDir, 'resources');
  const appAsarPath = path.join(resourcesDir, 'app.asar');
  const executablePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(appAsarPath) || !fs.existsSync(executablePath)) {
    throw new Error('Secure Electron post-pack hook could not find app.asar or the application executable.');
  }
  assertNoUnpackedApplicationCode(appAsarPath);
  const result = addAsarFileIntegrity(appAsarPath);
  updateWindowsAsarIntegrityResource(executablePath, appAsarPath);
  console.log(`[electron-security] protected ${result.protectedFiles} ASAR files and refreshed Windows integrity metadata.`);
}

module.exports = afterPack;
module.exports.BLOCK_SIZE = BLOCK_SIZE;
module.exports.addAsarFileIntegrity = addAsarFileIntegrity;
module.exports.assertNoUnpackedApplicationCode = assertNoUnpackedApplicationCode;
module.exports.updateWindowsAsarIntegrityResource = updateWindowsAsarIntegrityResource;
