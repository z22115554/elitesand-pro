'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-v2-test-'));
process.env.ELITESAND_DATA_DIR = path.join(runtimeRoot, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(runtimeRoot, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(runtimeRoot, 'logs');

const updater = require('../server/services/app-updater-v2');
const runner = require('../server/services/app-updater-runner-v2');
const pkg = require('../package.json');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

function sha(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function nextPatch(version) {
  const parts = String(version).split('.').map((part) => Number.parseInt(part, 10));
  while (parts.length < 4) parts.push(0);
  parts[parts.length - 1] += 1;
  return parts.join('.');
}

function makeBaselineFiles() {
  const values = [
    ['resources/tools/updater-node.exe', Buffer.from('immutable-node')],
    ['chrome_100_percent.pak', Buffer.from('immutable-electron-runtime')],
  ];
  return values.map(([filePath, data]) => ({ path: filePath, size: data.length, sha256: sha(data) }));
}

function makeV2Zip({ fromVersion = pkg.version, version = nextPatch(pkg.version), mutateManifest } = {}) {
  const payload = new Map([
    ['Elitesand Pro.exe', Buffer.from('new-exe')],
    ['resources/app.asar', Buffer.from('new-asar')],
    ['resources/tools/yt-dlp.exe', Buffer.from('new-ytdlp')],
    ['resources/licenses/npm-license-inventory.json', Buffer.from('{}')],
  ]);
  const baselineImmutableFiles = makeBaselineFiles();
  const manifest = {
    schemaVersion: 2,
    mode: 'electron-asar-v1',
    fromVersion,
    version,
    builtAt: new Date().toISOString(),
    baselineRuntimeFingerprint: updater.canonicalBaselineFingerprint(baselineImmutableFiles),
    baselineImmutableFiles,
    files: [...payload.entries()].map(([filePath, data]) => ({ path: filePath, size: data.length, sha256: sha(data) })),
  };
  mutateManifest?.(manifest, payload);
  const zip = new AdmZip();
  for (const [filePath, data] of payload) zip.addFile(filePath, data);
  zip.addFile('update-manifest.json', Buffer.from(JSON.stringify(manifest)));
  return zip.toBuffer();
}

console.log('\n[app-updater-v2]');

test('schema-v2 accepts matched EXE + ASAR payload and verifies every file hash', () => {
  const result = updater.inspectUpdateZip(makeV2Zip(), { currentVersion: pkg.version, expectedVersion: nextPatch(pkg.version) });
  assert.equal(result.ok, true);
  assert.equal(result.fromVersion, pkg.version);
  assert(result.files.some((item) => item.path === 'Elitesand Pro.exe'));
  assert(result.files.some((item) => item.path === 'resources/app.asar'));
  assert(result.baselineImmutableFiles.some((item) => item.path === 'resources/tools/updater-node.exe'));
});

test('schema-v2 rejects a manifest payload hash mismatch before staging', () => {
  assert.throws(() => updater.inspectUpdateZip(makeV2Zip({
    mutateManifest(manifest) { manifest.files.find((item) => item.path === 'resources/app.asar').sha256 = 'f'.repeat(64); },
  }), { currentVersion: pkg.version }), /完整性驗證失敗/);
});

test('schema-v2 rejects a modified runtime baseline fingerprint', () => {
  assert.throws(() => updater.inspectUpdateZip(makeV2Zip({
    mutateManifest(manifest) { manifest.baselineImmutableFiles[0].sha256 = 'a'.repeat(64); },
  }), { currentVersion: pkg.version }), /baseline fingerprint/);
});

test('schema-v2 rejects updater-node.exe from payload but requires it in immutable baseline', () => {
  assert.equal(updater.isAllowedDesktopEntry('resources/tools/updater-node.exe'), false);
  assert.equal(updater.isImmutableBaselineEntry('resources/tools/updater-node.exe'), true);
  assert.equal(runner.validRelativeFile('resources/tools/updater-node.exe'), false);
  assert.equal(runner.validImmutableFile('resources/tools/updater-node.exe'), true);
});

test('schema-v2 rejects raw server/public source and source maps', () => {
  for (const rel of ['server/index.js', 'public/js/lyric-template-pulse.js', 'public/js/panel.bundle.js.map']) {
    assert.equal(updater.isAllowedDesktopEntry(rel), false, rel);
  }
});

test('wrong fromVersion fails closed to the full Installer', () => {
  const result = updater.inspectUpdateZip(makeV2Zip({ fromVersion: '0.0.1' }), { currentVersion: pkg.version });
  assert.equal(result.ok, false);
  assert.equal(result.needsFull, true);
});

test('installed immutable runtime is verified before handoff', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-baseline-v2-'));
  fs.mkdirSync(path.join(root, 'resources', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'resources', 'tools', 'updater-node.exe'), 'immutable-node');
  fs.writeFileSync(path.join(root, 'chrome_100_percent.pak'), 'immutable-electron-runtime');
  const files = makeBaselineFiles();
  assert.equal(updater.verifyInstalledBaseline(root, files).ok, true);
  fs.writeFileSync(path.join(root, 'chrome_100_percent.pak'), 'tampered');
  assert.equal(updater.verifyInstalledBaseline(root, files).ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('runner atomically replaces EXE/ASAR and leaves updater-node untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-runner-v2-'));
  const targetRoot = path.join(root, 'installed');
  const workRoot = path.join(root, 'work');
  const stagingRoot = path.join(workRoot, 'staging');
  const backupRoot = path.join(workRoot, 'backup');
  fs.mkdirSync(path.join(targetRoot, 'resources', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(stagingRoot, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, 'Elitesand Pro.exe'), 'old-exe');
  fs.writeFileSync(path.join(targetRoot, 'resources', 'app.asar'), 'old-asar');
  fs.writeFileSync(path.join(targetRoot, 'resources', 'tools', 'updater-node.exe'), 'immutable-node');
  fs.writeFileSync(path.join(stagingRoot, 'Elitesand Pro.exe'), 'new-exe');
  fs.writeFileSync(path.join(stagingRoot, 'resources', 'app.asar'), 'new-asar');

  const files = [
    { path: 'Elitesand Pro.exe', size: 7, sha256: sha(Buffer.from('new-exe')) },
    { path: 'resources/app.asar', size: 8, sha256: sha(Buffer.from('new-asar')) },
  ];
  const baselineImmutableFiles = [{
    path: 'resources/tools/updater-node.exe',
    size: Buffer.byteLength('immutable-node'),
    sha256: sha(Buffer.from('immutable-node')),
  }];
  const plan = {
    schemaVersion: 2,
    mode: 'electron-asar-v1',
    parentPid: 999999,
    targetRoot,
    stagingRoot,
    backupRoot,
    workRoot,
    readyFile: path.join(workRoot, 'ready'),
    logFile: path.join(workRoot, 'update.log'),
    rollbackErrorLog: path.join(workRoot, 'rollback.log'),
    files,
    baselineImmutableFiles,
    baselineRuntimeFingerprint: runner.canonicalBaselineFingerprint(baselineImmutableFiles),
    restart: { type: 'electron-app', command: path.join(targetRoot, 'Elitesand Pro.exe') },
  };
  const validated = runner.validatePlan(plan);
  assert.equal(runner.verifyImmutableRuntime(validated).ok, true);
  const result = runner.installFiles(validated);
  assert.equal(result, 2);
  assert.equal(fs.readFileSync(path.join(targetRoot, 'Elitesand Pro.exe'), 'utf8'), 'new-exe');
  assert.equal(fs.readFileSync(path.join(targetRoot, 'resources', 'app.asar'), 'utf8'), 'new-asar');
  assert.equal(fs.readFileSync(path.join(targetRoot, 'resources', 'tools', 'updater-node.exe'), 'utf8'), 'immutable-node');
  fs.rmSync(root, { recursive: true, force: true });
});

test('build-update is fail-closed and can no longer package repo server/public directly', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-update.ps1'), 'utf8');
  assert(source.includes('build-installer.ps1'));
  assert(source.includes('resources/app.asar'));
  assert(source.includes('resources/tools/updater-node.exe'));
  assert(source.includes('BaselineManifest'));
  assert(source.includes('baselineImmutableFiles'));
  assert(source.includes('Raw template/source-map material is forbidden'));
  assert(!/foreach\s*\(\$dir\s+in\s+@\("server",\s*"public"\)\)/i.test(source));
});

test('Installer build emits a hash-only incremental baseline for the following release', () => {
  const installer = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-installer.ps1'), 'utf8');
  assert(installer.includes('write-update-baseline.js'));
  assert(installer.includes('incremental-baseline.json'));
  const baselineTool = fs.readFileSync(path.join(__dirname, '..', 'tools', 'write-update-baseline.js'), 'utf8');
  assert(baselineTool.includes('immutableFingerprint'));
  assert(baselineTool.includes('updater-node.exe'));
});

test('Electron host exports physical install root/PID and reserves exit code 42 for updater handoff', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert(source.includes('ELITESAND_INSTALL_ROOT'));
  assert(source.includes('ELITESAND_HOST_PID'));
  assert(source.includes('code === 42'));
  assert(source.includes('app.exit(0)'));
});

fs.rmSync(runtimeRoot, { recursive: true, force: true });
console.log(`[app-updater-v2] ${passed} tests passed.`);
