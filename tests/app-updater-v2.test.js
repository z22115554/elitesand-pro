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
const { signUpdateManifest } = require('../server/services/update-signature');
const pkg = require('../package.json');

const TEST_PRIVATE_KEY_PEM = fs.readFileSync(path.join(__dirname, 'fixtures', 'update-signing-test-private.pem'), 'utf8');
const TEST_PUBLIC_KEY_HEX = crypto.createPublicKey(TEST_PRIVATE_KEY_PEM)
  .export({ format: 'der', type: 'spki' })
  .toString('hex');

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

// 這個檔案本來全部是同步 test()：applyStagedUpdate() 是 async function，
// 需要真的 await 才能量到結果，不能沿用同步版本（同步版本會在 promise
// resolve 前就回報「通過」）。只加這一個最小的非同步佇列，其餘同步測試
// 完全不受影響——它們照樣立刻執行，佇列只在檔案最後才被 await。
const pendingAsync = [];
function testAsync(name, fn) {
  pendingAsync.push((async () => {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.error(`  ✗ ${name}`);
      throw error;
    }
  })());
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

function inspectTestZip(buffer, options = {}) {
  return updater.inspectUpdateZip(buffer, { publicKeyHex: TEST_PUBLIC_KEY_HEX, ...options });
}

function makeV2Zip({
  fromVersion = pkg.version,
  version = nextPatch(pkg.version),
  mutateManifest,
  tamperAfterSign,
  skipSignature = false,
} = {}) {
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
  const finalManifest = skipSignature ? manifest : signUpdateManifest(manifest, TEST_PRIVATE_KEY_PEM);
  tamperAfterSign?.(finalManifest, payload);

  const zip = new AdmZip();
  for (const [filePath, data] of payload) zip.addFile(filePath, data);
  zip.addFile('update-manifest.json', Buffer.from(JSON.stringify(finalManifest)));
  return zip.toBuffer();
}

console.log('\n[app-updater-v2]');

test('release signing helper accepts the pre-parsed PrivateKeyObject used by sign-manifest.js', () => {
  const privateKey = crypto.createPrivateKey(TEST_PRIVATE_KEY_PEM);
  const signed = signUpdateManifest({ schemaVersion: 2, mode: 'electron-asar-v1', marker: 'key-object-path' }, privateKey);
  assert.equal(signed.signatureAlgorithm, 'Ed25519');
  assert.match(signed.signature, /^[a-f0-9]{128}$/);
});

test('schema-v2 accepts matched EXE + ASAR payload only when the manifest has a valid Ed25519 signature', () => {
  const result = inspectTestZip(makeV2Zip(), { currentVersion: pkg.version, expectedVersion: nextPatch(pkg.version) });
  assert.equal(result.ok, true);
  assert.equal(result.fromVersion, pkg.version);
  assert.equal(result.manifest.signatureAlgorithm, 'Ed25519');
  assert.equal(result.manifest.signature.length, 128);
  assert(result.files.some((item) => item.path === 'Elitesand Pro.exe'));
  assert(result.files.some((item) => item.path === 'resources/app.asar'));
  assert(result.baselineImmutableFiles.some((item) => item.path === 'resources/tools/updater-node.exe'));
});

test('schema-v2 rejects an unsigned manifest before trusting payload hashes', () => {
  assert.throws(
    () => inspectTestZip(makeV2Zip({ skipSignature: true }), { currentVersion: pkg.version }),
    /官方簽章驗證失敗/,
  );
});

test('schema-v2 rejects a manifest changed after signing', () => {
  assert.throws(() => inspectTestZip(makeV2Zip({
    tamperAfterSign(manifest) { manifest.files[0].sha256 = 'b'.repeat(64); },
  }), { currentVersion: pkg.version }), /官方簽章驗證失敗/);
});

test('schema-v2 rejects a valid signature made by a different publisher key', () => {
  const other = crypto.generateKeyPairSync('ed25519').publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('hex');
  assert.throws(
    () => updater.inspectUpdateZip(makeV2Zip(), { currentVersion: pkg.version, publicKeyHex: other }),
    /官方簽章驗證失敗/,
  );
});

test('schema-v2 rejects a manifest payload hash mismatch before staging', () => {
  assert.throws(() => inspectTestZip(makeV2Zip({
    mutateManifest(manifest) { manifest.files.find((item) => item.path === 'resources/app.asar').sha256 = 'f'.repeat(64); },
  }), { currentVersion: pkg.version }), /完整性驗證失敗/);
});

test('schema-v2 rejects a modified runtime baseline fingerprint', () => {
  assert.throws(() => inspectTestZip(makeV2Zip({
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

test('wrong fromVersion fails closed to the full Installer after signature verification', () => {
  const result = inspectTestZip(makeV2Zip({ fromVersion: '0.0.1' }), { currentVersion: pkg.version });
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

/**
 * 建立一組跟上面那個測試相同結構的合法 plan fixture，供下面兩個更新結果
 * 標記檔測試共用，避免重複整組 90 行的 fixture 建置。
 */
function buildRunnerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-runner-v2-marker-'));
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
  const plan = runner.validatePlan({
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
  });
  return { root, targetRoot, plan };
}

function readMarker(targetRoot) {
  return JSON.parse(fs.readFileSync(path.join(targetRoot, runner.UPDATE_RESULT_MARKER_NAME), 'utf8'));
}

testAsync('applyStagedUpdate 成功時寫下 ok:true 的更新結果標記檔，不影響既有安裝行為', async () => {
  const { root, targetRoot, plan } = buildRunnerFixture();
  try {
    const result = await runner.applyStagedUpdate(plan, { skipRestart: true });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(targetRoot, 'Elitesand Pro.exe'), 'utf8'), 'new-exe',
      '標記檔是純附加，不該改變既有的安裝結果: ');
    const marker = readMarker(targetRoot);
    assert.equal(marker.ok, true);
    assert.equal(typeof marker.appliedAt, 'string');
    assert.ok(!('error' in marker), '成功時標記檔不該帶任何錯誤細節: ');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

testAsync('applyStagedUpdate 安裝失敗觸發回滾時，標記檔記 ok:false 且不外流錯誤路徑細節', async () => {
  const { root, targetRoot, plan } = buildRunnerFixture();
  try {
    const result = await runner.applyStagedUpdate(plan, { skipRestart: true, failAfter: 0 });
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(path.join(targetRoot, 'Elitesand Pro.exe'), 'utf8'), 'old-exe',
      '回滾後應還原成安裝前的檔案: ');
    const marker = readMarker(targetRoot);
    assert.equal(marker.ok, false);
    assert.equal(typeof marker.appliedAt, 'string');
    // 標記檔的欄位表只有 ok/appliedAt——telemetry-fields.js 目前只定義
    // update.ok／update.failed 兩個布林旗標，故意不含技術性錯誤內容。
    assert.deepEqual(Object.keys(marker).sort(), ['appliedAt', 'ok']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('immutable runtime 驗證失敗（handoff 後基準被動過）的分支也會寫失敗標記', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'app-updater-runner-v2.js'), 'utf8');
  const block = source.slice(source.indexOf('if (!runtimeCheck.ok)'), source.indexOf('appendLog(plan.logFile, \'Immutable runtime baseline verified'));
  assert.ok(block.includes('writeUpdateResultMarker(plan.targetRoot, false)'),
    'runtime baseline 被拒的分支必須也寫失敗標記，否則這條路徑的更新結果永遠不會被回報: ');
});

test('consumeUpdateResultMarker：沒有安裝根目錄時直接跳過，可攜版／開發環境不受影響', () => {
  const savedInstallRoot = process.env.ELITESAND_INSTALL_ROOT;
  delete process.env.ELITESAND_INSTALL_ROOT; // 模擬可攜版/開發環境，不受目前執行環境的實際值影響
  try {
    const calls = [];
    const result = updater.consumeUpdateResultMarker({
      usageTelemetry: { recordUpdateResult: (ok) => calls.push(ok) },
    });
    assert.equal(result, null);
    assert.equal(calls.length, 0, '沒有安裝根目錄時不該呼叫遙測: ');
  } finally {
    if (savedInstallRoot === undefined) delete process.env.ELITESAND_INSTALL_ROOT;
    else process.env.ELITESAND_INSTALL_ROOT = savedInstallRoot;
  }
});

test('consumeUpdateResultMarker：讀到成功標記會回報 true 並刪除標記檔', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-consume-marker-'));
  try {
    fs.writeFileSync(path.join(root, runner.UPDATE_RESULT_MARKER_NAME), JSON.stringify({ ok: true, appliedAt: '2026-01-01T00:00:00.000Z' }));
    const calls = [];
    const result = updater.consumeUpdateResultMarker({
      targetRoot: root,
      usageTelemetry: { recordUpdateResult: (ok) => calls.push(ok) },
    });
    assert.deepEqual(calls, [true]);
    assert.equal(result.ok, true);
    assert.ok(!fs.existsSync(path.join(root, runner.UPDATE_RESULT_MARKER_NAME)), '讀過的標記檔必須被刪除，避免下次啟動重複回報: ');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('consumeUpdateResultMarker：讀到失敗標記會回報 false', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-consume-marker-'));
  try {
    fs.writeFileSync(path.join(root, runner.UPDATE_RESULT_MARKER_NAME), JSON.stringify({ ok: false, appliedAt: '2026-01-01T00:00:00.000Z' }));
    const calls = [];
    updater.consumeUpdateResultMarker({
      targetRoot: root,
      usageTelemetry: { recordUpdateResult: (ok) => calls.push(ok) },
    });
    assert.deepEqual(calls, [false]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('consumeUpdateResultMarker：沒有標記檔時安靜跳過，不噴例外', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-consume-marker-empty-'));
  try {
    const calls = [];
    const result = updater.consumeUpdateResultMarker({
      targetRoot: root,
      usageTelemetry: { recordUpdateResult: (ok) => calls.push(ok) },
    });
    assert.equal(result, null);
    assert.equal(calls.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('consumeUpdateResultMarker：標記檔壞掉（非合法 JSON／缺 ok）不回報也不崩潰，且仍清掉壞檔', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-consume-marker-corrupt-'));
  try {
    fs.writeFileSync(path.join(root, runner.UPDATE_RESULT_MARKER_NAME), '{ not valid json');
    const calls = [];
    const result = updater.consumeUpdateResultMarker({
      targetRoot: root,
      usageTelemetry: { recordUpdateResult: (ok) => calls.push(ok) },
    });
    assert.equal(result, null);
    assert.equal(calls.length, 0);
    assert.ok(!fs.existsSync(path.join(root, runner.UPDATE_RESULT_MARKER_NAME)), '壞掉的標記檔也該被清掉，否則會卡住每次啟動: ');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

testAsync('applyStagedUpdate 標記檔寫入失敗不影響更新本身的成敗（唯讀 targetRoot 時仍完成安裝）', async () => {
  const { root, targetRoot, plan } = buildRunnerFixture();
  const readonlyMarkerPath = path.join(targetRoot, runner.UPDATE_RESULT_MARKER_NAME);
  fs.mkdirSync(readonlyMarkerPath); // 讓標記檔路徑被目錄佔用，寫入必定拋錯
  try {
    const result = await runner.applyStagedUpdate(plan, { skipRestart: true });
    assert.equal(result.ok, true, '標記檔寫不出去不該讓已經成功的更新被回報成失敗: ');
    assert.equal(fs.readFileSync(path.join(targetRoot, 'Elitesand Pro.exe'), 'utf8'), 'new-exe');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('build-update is fail-closed, signs the manifest, and can no longer package repo server/public directly', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-update.ps1'), 'utf8');
  assert(source.includes('build-installer.ps1'));
  assert(source.includes('resources/app.asar'));
  assert(source.includes('resources/tools/updater-node.exe'));
  assert(source.includes('BaselineManifest'));
  assert(source.includes('baselineImmutableFiles'));
  assert(source.includes('Raw template/source-map material is forbidden'));
  assert(source.includes('sign-manifest.js'));
  assert(source.includes('ELITESAND_UPDATE_SIGNING_PRIVATE_KEY_B64'));
  assert(source.includes('Refusing to publish with the repository test signing key'));
  assert(!/foreach\s*\(\$dir\s+in\s+@\("server",\s*"public"\)\)/i.test(source));
});

test('sign-manifest refuses a non-production private key unless explicitly used by smoke tests', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'update-signing', 'sign-manifest.js'), 'utf8');
  assert(source.includes('UPDATE_PUBLIC_KEY_HEX'));
  assert(source.includes('--allow-nonproduction-key'));
  assert(source.includes('does not match the public key embedded in Elitesand Pro'));
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

test('reporting the pre-download "downloading-artifact" phase never trips prepareUpdate()\'s own busy re-entrancy guard', () => {
  // Regression: startup-incremental-update.js reports this phase *before*
  // calling prepareAndLaunchUpdate(), purely so a caller polling
  // getProgress() sees something during the untracked artifact download. If
  // it counted as "active", prepareUpdate()'s first-line guard would reject
  // its own caller's very next step with "已有更新工作正在進行" — every real
  // accept would silently fail before it even started downloading anything.
  updater._resetForTests();
  updater.setProgress('downloading-artifact', '正在下載更新套件');
  assert.strictEqual(updater.getProgress().active, false);
  updater._resetForTests();
});

Promise.all(pendingAsync)
  .then(() => {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    console.log(`[app-updater-v2] ${passed} tests passed.`);
  })
  .catch((error) => {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    console.error(error);
    process.exitCode = 1;
  });
