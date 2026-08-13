#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const MODE = 'electron-asar-v1';
const SCHEMA_VERSION = 1;
const PROTECTED_UPDATER_RUNTIME = 'resources/tools/updater-node.exe';

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

function isUpdateOwned(relativePath) {
  const rel = normalizeRelative(relativePath);
  if (rel === PROTECTED_UPDATER_RUNTIME) return false;
  if (rel === 'Elitesand Pro.exe' || rel === 'resources/app.asar') return true;
  return rel.startsWith('resources/tools/') || rel.startsWith('resources/licenses/');
}

function walk(root, relative = '') {
  const directory = path.join(root, relative);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) return walk(root, next);
    if (entry.isFile()) return [next];
    return [];
  });
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function canonicalFingerprint(files) {
  const text = files
    .map((item) => `${item.path}\t${item.size}\t${item.sha256}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readPublicVersion(appAsar) {
  const pkg = JSON.parse(asar.extractFile(appAsar, 'package.json').toString('utf8'));
  const value = String(pkg.elitesandPublicVersion || pkg.version || '').trim();
  if (!value) throw new Error('app.asar package.json has no public version.');
  return value;
}

function buildBaseline(unpackedRoot) {
  const root = path.resolve(unpackedRoot);
  const appAsar = path.join(root, 'resources', 'app.asar');
  const updaterRuntime = path.join(root, ...PROTECTED_UPDATER_RUNTIME.split('/'));
  if (!fs.existsSync(appAsar)) throw new Error('Cannot build update baseline: resources/app.asar is missing.');
  if (!fs.existsSync(updaterRuntime)) throw new Error(`Cannot build update baseline: ${PROTECTED_UPDATER_RUNTIME} is missing.`);

  const immutableFiles = walk(root)
    .map(normalizeRelative)
    .filter((relative) => !isUpdateOwned(relative))
    .sort()
    .map((relative) => {
      const file = path.join(root, ...relative.split('/'));
      const stat = fs.statSync(file);
      return Object.freeze({ path: relative, size: stat.size, sha256: hashFile(file) });
    });
  if (!immutableFiles.some((item) => item.path === PROTECTED_UPDATER_RUNTIME)) {
    throw new Error('Updater runtime must be part of the immutable baseline.');
  }
  if (!immutableFiles.length) throw new Error('Refusing to create an empty update baseline.');

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    mode: MODE,
    version: readPublicVersion(appAsar),
    immutableFingerprint: canonicalFingerprint(immutableFiles),
    immutableFiles,
  });
}

function writeBaseline(unpackedRoot, outputPath) {
  const baseline = buildBaseline(unpackedRoot);
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return baseline;
}

function main() {
  const [unpackedRoot, outputPath] = process.argv.slice(2);
  if (!unpackedRoot || !outputPath) throw new Error('Usage: write-update-baseline.js <win-unpacked-root> <output-json>');
  const baseline = writeBaseline(unpackedRoot, outputPath);
  process.stdout.write(`Incremental baseline v${baseline.version}: ${baseline.immutableFiles.length} immutable files -> ${path.resolve(outputPath)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = {
  MODE,
  SCHEMA_VERSION,
  PROTECTED_UPDATER_RUNTIME,
  isUpdateOwned,
  canonicalFingerprint,
  buildBaseline,
  writeBaseline,
};
