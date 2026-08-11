#!/usr/bin/env node
'use strict';

// Generates a manifest that is packaged inside app.asar. The manifest covers
// executable helper files which cannot live in app.asar (yt-dlp in particular),
// so a signed ASAR root also authenticates the external resources it launches.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function walkFiles(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) return walkFiles(root, next);
    if (entry.isFile()) return [next];
    return [];
  });
}

function buildManifest(toolsRoot) {
  if (!fs.existsSync(toolsRoot)) throw new Error(`Missing packaged tools directory: ${toolsRoot}`);
  const files = Object.fromEntries(walkFiles(toolsRoot)
    .sort((a, b) => a.localeCompare(b))
    .map((relative) => {
      const contents = fs.readFileSync(path.join(toolsRoot, relative));
      return [`tools/${relative.split(path.sep).join('/')}`, crypto.createHash('sha256').update(contents).digest('hex')];
    }));
  if (Object.keys(files).length === 0) throw new Error('Refusing to generate an empty packaged tools integrity manifest.');
  return Object.freeze({ schemaVersion: 1, files: Object.freeze(files) });
}

function writeManifest(appRoot, toolsRoot) {
  const manifest = buildManifest(toolsRoot);
  const target = path.join(appRoot, 'electron', 'packaged-resource-integrity.generated.js');
  const source = `// Generated during Installer staging. Do not edit.\nmodule.exports = Object.freeze(${JSON.stringify(manifest, null, 2)});\n`;
  fs.writeFileSync(target, source, 'utf8');
  return { target, count: Object.keys(manifest.files).length };
}

function main() {
  const [appRoot, toolsRoot] = process.argv.slice(2);
  if (!appRoot || !toolsRoot) throw new Error('Usage: write-packaged-resource-integrity.js <app-root> <tools-root>');
  const result = writeManifest(path.resolve(appRoot), path.resolve(toolsRoot));
  process.stdout.write(`Packaged resource integrity manifest: ${result.count} files -> ${result.target}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { walkFiles, buildManifest, writeManifest };
