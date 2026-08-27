'use strict';

/**
 * Secure Electron/ASAR incremental updater (schema v2).
 *
 * v2 accepts only a matched desktop payload built from the Installer pipeline:
 *   - Elitesand Pro.exe (matching ASAR integrity resource)
 *   - resources/app.asar (minified + encrypted templates + per-file hashes)
 *   - resources/tools/* except updater-node.exe
 *   - resources/licenses/*
 *
 * The dedicated updater-node.exe is part of an immutable runtime baseline. A
 * compatible update therefore proves both sides: every new payload file is
 * SHA-256 verified, and every non-replaceable Electron runtime file still
 * matches the previous Installer build before the host is allowed to exit.
 */
const crypto = require('crypto');
// Two different filesystems are needed in this module, not one:
//  - `fs` (Electron's patched, ASAR-transparent module) for anything that
//    reads a file that genuinely lives inside THIS running app's own
//    resources/app.asar — e.g. copying app-updater-runner-v2.js out to a
//    staging directory. original-fs cannot resolve a path through a real
//    archive and fails with ENOENT there.
//  - `physicalFs` (Electron's ASAR-bypassing filesystem, when available) for
//    writing/cleaning the STAGED replacement app.asar in a temp staging
//    directory — plain `fs` treats any path containing an `app.asar` segment
//    as a virtual archive mount, even when that path is a brand-new file this
//    module is about to create, and throws "Invalid package ..." trying to
//    validate it as an existing archive header. Same split as
//    update-runtime-fingerprint.js; plain Node tests/dev server fall back to
//    the normal filesystem for both.
const fs = require('fs');
let physicalFs = fs;
try { physicalFs = require('original-fs'); } catch (_) { /* Plain Node runtime. */ }
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { isNewerVersion } = require('../utils/version-compare');
const { createLogger } = require('../utils/logger');
const {
  UPDATE_ZIP_NAME,
  UPDATE_HASH_NAME,
  selectLatestRelease,
  findInstallerAsset,
  findVerifiedUpdateAssets,
} = require('./release-client');
const config = require('../utils/load-config');
const { APP_VERSION, appUserAgent, githubJsonHeaders } = require('../utils/app-version');
const { logsDir } = require('../utils/app-paths');
const { verifyUpdateManifestSignature } = require('./update-signature');
const { UPDATE_RESULT_MARKER_NAME } = require('./app-updater-runner-v2');
const usageTelemetry = require('./usage-telemetry');
const { createGitHubReleaseProvider, assertNormalizedUpdatePlan } = require('./update-provider');

const log = createLogger('AppUpdaterV2');
const UPDATE_SCHEMA_VERSION = 2;
const UPDATE_MODE = 'electron-asar-v1';
const PROTECTED_UPDATER_RUNTIME = 'resources/tools/updater-node.exe';
const MAX_ZIP_BYTES = 384 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 768 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const WORK_BASE = path.join(os.tmpdir(), 'Elitesand-Pro-updates-v2');

// Capability is fail-closed: old/source-tree installations without the
// physical install root and dedicated updater runtime still receive Installer.
const INCREMENTAL_UPDATES_DISABLED = false;

let currentProgress = {
  active: false,
  phase: 'idle',
  message: '尚未開始更新',
  startedAt: null,
  updatedAt: Date.now(),
};

// 'downloading-artifact' is set by startup-incremental-update.js *before*
// prepareUpdate() is ever called, purely so a caller polling getProgress()
// sees something during the (untracked) artifact download. prepareUpdate()'s
// own first line uses currentProgress.active as a re-entrancy guard against a
// second concurrent prepareUpdate() call — if this phase counted as active,
// that guard would trip against its own caller's download step and reject
// every real accept with "已有更新工作正在進行" before it even started.
const NOT_ACTIVE_PHASES = ['failed', 'ready', 'idle', 'downloading-artifact'];

function setProgress(phase, message, extra = {}) {
  currentProgress = {
    ...currentProgress,
    active: !NOT_ACTIVE_PHASES.includes(phase),
    phase,
    message,
    updatedAt: Date.now(),
    ...extra,
  };
}

function getProgress() { return { ...currentProgress }; }
function ghHeaders() { return githubJsonHeaders('updater-v2'); }

function parseStrictHash(text) {
  const value = String(text || '').trim();
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function isSafeRelativePath(entryName) {
  if (typeof entryName !== 'string' || !entryName || entryName.includes('\0') || entryName.includes('\\')) return false;
  if (entryName.startsWith('/') || entryName.startsWith('//') || /^[a-zA-Z]:/.test(entryName)) return false;
  const parts = entryName.replace(/\/$/, '').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return false;
  const normalized = path.posix.normalize(entryName.replace(/\/$/, ''));
  return normalized === entryName.replace(/\/$/, '');
}

function isUpdateOwnedPath(entryName) {
  const rel = String(entryName || '').replace(/\/$/, '');
  if (!isSafeRelativePath(rel)) return false;
  if (rel === PROTECTED_UPDATER_RUNTIME) return false;
  if (rel === 'Elitesand Pro.exe' || rel === 'resources/app.asar') return true;
  return rel.startsWith('resources/tools/') || rel.startsWith('resources/licenses/');
}

function isAllowedDesktopEntry(entryName) {
  const rel = String(entryName || '').replace(/\/$/, '');
  return rel === 'update-manifest.json' || isUpdateOwnedPath(rel);
}

function isImmutableBaselineEntry(entryName) {
  const rel = String(entryName || '').replace(/\/$/, '');
  return isSafeRelativePath(rel) && rel !== 'update-manifest.json' && !isUpdateOwnedPath(rel);
}

// Compatibility-only helper retained for pre-v2 regression tests/diagnostics.
// Production prepareUpdate() never routes schema-1 through this allowlist.
function isAllowedEntry(entryName) {
  const rel = String(entryName || '').replace(/\/$/, '');
  if (!isSafeRelativePath(rel)) return false;
  if (['package.json', 'package-lock.json', 'update-manifest.json', 'EULA.txt'].includes(rel)) return true;
  if (rel === 'server/config.js') return false;
  return rel.startsWith('server/') || rel.startsWith('public/');
}

function isSymlinkEntry(entry) {
  const attr = Number(entry?.header?.attr || 0);
  const unixMode = (attr >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function sha256File(file) { return sha256Buffer(fs.readFileSync(file)); }

function canonicalBaselineFingerprint(files) {
  const text = files
    .map((item) => `${item.path}\t${item.size}\t${item.sha256}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readJsonEntry(entry, label) {
  try { return JSON.parse(entry.getData().toString('utf8')); }
  catch (_) { throw new Error(`${label} 格式無效`); }
}

function normalizeBaselineFiles(manifest) {
  if (!Array.isArray(manifest.baselineImmutableFiles) || manifest.baselineImmutableFiles.length === 0) {
    throw new Error('更新 manifest 缺少不可變 runtime baseline');
  }
  const seen = new Set();
  const files = manifest.baselineImmutableFiles.map((item) => {
    const rel = item?.path;
    if (!isImmutableBaselineEntry(rel)) throw new Error(`runtime baseline 包含不安全或可更新路徑：${rel}`);
    if (seen.has(rel)) throw new Error(`runtime baseline 包含重複路徑：${rel}`);
    seen.add(rel);
    if (!Number.isSafeInteger(item.size) || item.size < 0) throw new Error(`runtime baseline 檔案大小無效：${rel}`);
    const hash = parseStrictHash(item.sha256);
    if (!hash) throw new Error(`runtime baseline SHA-256 無效：${rel}`);
    return { path: rel, size: item.size, sha256: hash };
  });
  if (!seen.has(PROTECTED_UPDATER_RUNTIME)) throw new Error('runtime baseline 未保護 updater-node.exe');
  const expectedFingerprint = parseStrictHash(manifest.baselineRuntimeFingerprint);
  if (!expectedFingerprint || canonicalBaselineFingerprint(files) !== expectedFingerprint) {
    throw new Error('runtime baseline fingerprint 驗證失敗');
  }
  return files;
}

function verifyInstalledBaseline(targetRoot, files) {
  const root = path.resolve(targetRoot);
  for (const item of files) {
    if (!isImmutableBaselineEntry(item.path)) return { ok: false, reason: `baseline 路徑無效：${item.path}` };
    const target = path.join(root, ...item.path.split('/'));
    const rel = path.relative(root, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, reason: `baseline 路徑逸出安裝目錄：${item.path}` };
    let stat;
    try { stat = fs.statSync(target); } catch (_) { return { ok: false, reason: `安裝 runtime 缺少 ${item.path}` }; }
    if (!stat.isFile() || stat.size !== item.size) return { ok: false, reason: `安裝 runtime 大小不符：${item.path}` };
    if (sha256File(target) !== item.sha256) return { ok: false, reason: `安裝 runtime 雜湊不符：${item.path}` };
  }
  return { ok: true };
}

function inspectUpdateZip(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('更新包是空的');
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('更新包超過允許大小');

  let zip;
  try { zip = new AdmZip(buffer); } catch (_) { throw new Error('更新包不是有效的 ZIP'); }
  const entries = zip.getEntries();
  if (!entries.length || entries.length > MAX_ENTRIES) throw new Error('更新包檔案數量異常');

  const fileEntries = new Map();
  let unpackedBytes = 0;
  for (const entry of entries) {
    const name = entry.entryName.replace(/\/$/, '');
    if (!isSafeRelativePath(name)) throw new Error(`更新包含不安全路徑：${entry.entryName}`);
    if (isSymlinkEntry(entry)) throw new Error(`更新包不可包含符號連結：${entry.entryName}`);
    if (entry.isDirectory) continue;
    if (!isAllowedDesktopEntry(name)) throw new Error(`更新包含未允許的桌面檔案：${name}`);
    if (fileEntries.has(name)) throw new Error(`更新包含重複檔案：${name}`);
    unpackedBytes += Number(entry.header?.size || 0);
    if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error('更新包解壓後超過允許大小');
    fileEntries.set(name, entry);
  }

  const manifestEntry = fileEntries.get('update-manifest.json');
  if (!manifestEntry) throw new Error('更新包缺少 update-manifest.json');
  const manifest = readJsonEntry(manifestEntry, 'update-manifest.json');
  if (manifest.schemaVersion !== UPDATE_SCHEMA_VERSION || manifest.mode !== UPDATE_MODE || !Array.isArray(manifest.files)) {
    return { ok: false, needsFull: true, reason: '此更新包屬於舊版增量格式，請改用完整 Windows Installer。' };
  }

  const signatureCheck = verifyUpdateManifestSignature(manifest, { publicKeyHex: options.publicKeyHex });
  if (!signatureCheck.ok) {
    throw new Error(`更新 manifest 官方簽章驗證失敗：${signatureCheck.reason}`);
  }

  if (!manifest.fromVersion || !manifest.version) throw new Error('更新 manifest 缺少版本資訊');
  if (options.expectedVersion && String(manifest.version) !== String(options.expectedVersion)) {
    throw new Error('更新包版本與 GitHub Release 不一致');
  }
  const currentVersion = String(options.currentVersion || APP_VERSION);
  if (String(manifest.fromVersion) !== currentVersion) {
    return {
      ok: false,
      needsFull: true,
      reason: `此增量更新只適用於 v${manifest.fromVersion}，目前是 v${currentVersion}，請使用完整 Windows Installer。`,
      version: manifest.version,
    };
  }
  if (!isNewerVersion(String(manifest.version), currentVersion)) throw new Error('更新包目標版本沒有比目前版本新');

  const baselineImmutableFiles = normalizeBaselineFiles(manifest);
  const baselineRuntimeFingerprint = parseStrictHash(manifest.baselineRuntimeFingerprint);

  const declared = new Map();
  let hasExe = false;
  let hasAsar = false;
  for (const item of manifest.files) {
    const rel = item?.path;
    if (!isUpdateOwnedPath(rel)) throw new Error(`manifest 包含未允許路徑：${rel}`);
    if (declared.has(rel)) throw new Error(`manifest 包含重複路徑：${rel}`);
    if (!Number.isSafeInteger(item.size) || item.size < 0) throw new Error(`manifest 檔案大小無效：${rel}`);
    const expectedHash = parseStrictHash(item.sha256);
    if (!expectedHash) throw new Error(`manifest SHA-256 無效：${rel}`);
    const entry = fileEntries.get(rel);
    if (!entry) throw new Error(`manifest 宣告的檔案不存在：${rel}`);
    const data = entry.getData();
    if (data.length !== item.size || sha256Buffer(data) !== expectedHash) throw new Error(`更新檔完整性驗證失敗：${rel}`);
    declared.set(rel, { path: rel, size: item.size, sha256: expectedHash });
    if (rel === 'Elitesand Pro.exe') hasExe = true;
    if (rel === 'resources/app.asar') hasAsar = true;
  }
  if (!hasExe || !hasAsar) throw new Error('更新包必須同時包含 Elitesand Pro.exe 與 resources/app.asar');

  const actualPayload = [...fileEntries.keys()].filter((name) => name !== 'update-manifest.json').sort();
  const declaredPayload = [...declared.keys()].sort();
  if (JSON.stringify(actualPayload) !== JSON.stringify(declaredPayload)) throw new Error('更新 manifest 與 ZIP 內容不一致');

  return {
    ok: true,
    zip,
    entries,
    manifest,
    files: [...declared.values()],
    baselineImmutableFiles,
    baselineRuntimeFingerprint,
    version: String(manifest.version),
    fromVersion: String(manifest.fromVersion),
  };
}

async function fetchBuffer(url, { headers = {}, timeoutMs = 10000, maxBytes = MAX_ZIP_BYTES } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('下載內容超過允許大小');
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) { controller.abort(); throw new Error('下載內容超過允許大小'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('下載逾時');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLatestRelease(repo) {
  const body = await fetchBuffer(`https://api.github.com/repos/${repo}/releases?per_page=15`, {
    headers: ghHeaders(), timeoutMs: 8000, maxBytes: 2 * 1024 * 1024,
  });
  let releases;
  try { releases = JSON.parse(body.toString('utf8')); } catch (_) { throw new Error('GitHub Release 回應格式無效'); }
  const release = selectLatestRelease(releases);
  if (!release) throw new Error('尚未發布任何 Release');
  return release;
}

function resolveInstallRoot(options = {}) {
  const value = options.targetRoot || process.env.ELITESAND_INSTALL_ROOT || '';
  return value && path.isAbsolute(value) ? path.resolve(value) : null;
}

/**
 * 消費上一輪更新（若有）留在安裝目錄的結果標記檔：讀取、回報遙測、刪除。
 * 讀到就當場刪掉，不管布林值合不合法、不管遙測有沒有送出去——標記檔只負責
 * 「有沒有東西可讀」，不負責重試；重送邏輯本來就是 usage-telemetry 自己的事
 * （送不出去不補傳，是既有設計，跟這裡一致）。
 *
 * 呼叫時機是程式啟動：可攜版／開發環境沒有 ELITESAND_INSTALL_ROOT，
 * resolveInstallRoot() 回傳 null 就直接跳過，不強求每個執行形態都要有這個。
 */
function consumeUpdateResultMarker(options = {}) {
  const installRoot = resolveInstallRoot(options);
  if (!installRoot) return null;
  const markerPath = path.join(installRoot, UPDATE_RESULT_MARKER_NAME);
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (_) {
    return null; // 沒有標記檔、或壞掉讀不出來，都當作沒有可回報的結果
  } finally {
    try { fs.unlinkSync(markerPath); } catch (_) { /* 刪不掉不影響回報本身 */ }
  }
  if (typeof marker?.ok !== 'boolean') return null;
  (options.usageTelemetry || usageTelemetry).recordUpdateResult(marker.ok);
  return marker;
}

function resolveUpdaterRuntime(installRoot, options = {}) {
  return path.resolve(options.updaterRuntime || path.join(installRoot, ...PROTECTED_UPDATER_RUNTIME.split('/')));
}

function hostCanIncremental(options = {}) {
  const installRoot = resolveInstallRoot(options);
  if (!installRoot) return false;
  const runtime = resolveUpdaterRuntime(installRoot, options);
  return fs.existsSync(path.join(installRoot, 'Elitesand Pro.exe'))
    && fs.existsSync(path.join(installRoot, 'resources', 'app.asar'))
    && fs.existsSync(runtime);
}

async function getPlan(options = {}) {
  const repo = options.repo || config.updateCheckRepo;
  const fetchLatestReleaseImpl = options.fetchLatestRelease || fetchLatestRelease;
  const provider = options.provider || createGitHubReleaseProvider({
    repo,
    currentVersion: APP_VERSION,
    fetchLatestRelease: fetchLatestReleaseImpl,
    canIncremental: () => !INCREMENTAL_UPDATES_DISABLED && hostCanIncremental(options),
  });
  if (!provider || typeof provider.getPlan !== 'function') throw new TypeError('update provider 必須提供 getPlan()');
  return assertNormalizedUpdatePlan(await provider.getPlan());
}

async function downloadReleaseUpdate(release, { reportProgress = true } = {}) {
  const latestVersion = String(release.tag_name).replace(/^[vV]/, '');
  const assets = findVerifiedUpdateAssets(release);
  if (!assets) throw new Error('新版未同時提供 update.zip 與 update.zip.sha256');
  if (reportProgress) setProgress('downloading-hash', '正在下載驗證檔');
  const hashBody = await fetchBuffer(assets.checksum.browser_download_url, {
    headers: { 'User-Agent': appUserAgent('updater-v2') }, timeoutMs: 10000, maxBytes: 1024,
  });
  const expectedHash = parseStrictHash(hashBody.toString('utf8'));
  if (!expectedHash) throw new Error('SHA-256 驗證檔必須只包含 64 字元十六進位雜湊');
  if (reportProgress) setProgress('downloading-zip', '正在下載安全更新包');
  const buffer = await fetchBuffer(assets.zip.browser_download_url, {
    headers: { 'User-Agent': appUserAgent('updater-v2') }, timeoutMs: 120000, maxBytes: MAX_ZIP_BYTES,
  });
  if (reportProgress) setProgress('verifying-hash', '正在驗證 SHA-256');
  if (sha256Buffer(buffer) !== expectedHash) throw new Error('更新檔 SHA-256 驗證失敗，正式目錄未變更');
  return { buffer, latestVersion };
}

async function downloadLatestUpdate(repo, options = {}) {
  const fetchLatestReleaseImpl = options.fetchLatestRelease || fetchLatestRelease;
  const release = await fetchLatestReleaseImpl(repo);
  const latestVersion = String(release.tag_name).replace(/^[vV]/, '');
  if (!isNewerVersion(latestVersion, APP_VERSION)) throw new Error('已是最新版本');
  return downloadReleaseUpdate(release);
}

function ensureInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function removeTreeInside(target, parent) {
  // Only ever called on our own staging/backup temp directories, which may
  // contain a staged replacement app.asar — always the ASAR-bypassing fs.
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (!ensureInside(resolvedTarget, resolvedParent)) throw new Error(`拒絕清理更新暫存目錄外的路徑：${resolvedTarget}`);
  let stat;
  try { stat = physicalFs.lstatSync(resolvedTarget); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) { physicalFs.unlinkSync(resolvedTarget); return; }
  for (const name of physicalFs.readdirSync(resolvedTarget)) removeTreeInside(path.join(resolvedTarget, name), resolvedTarget);
  physicalFs.rmdirSync(resolvedTarget);
}

function extractToStaging(inspection, stagingRoot) {
  // Writing a brand-new file named resources/app.asar into staging: use the
  // ASAR-bypassing fs so Electron never tries to validate the destination as
  // an existing archive header before the write has even happened.
  physicalFs.mkdirSync(stagingRoot, { recursive: true });
  const wanted = new Set(inspection.files.map((item) => item.path));
  for (const entry of inspection.entries) {
    const rel = entry.entryName.replace(/\/$/, '');
    if (entry.isDirectory || !wanted.has(rel)) continue;
    const destination = path.join(stagingRoot, ...rel.split('/'));
    if (!ensureInside(destination, stagingRoot)) throw new Error(`拒絕寫入 staging 外：${rel}`);
    physicalFs.mkdirSync(path.dirname(destination), { recursive: true });
    physicalFs.writeFileSync(destination, entry.getData());
  }
}

async function prepareUpdate(options = {}) {
  if (INCREMENTAL_UPDATES_DISABLED) return { prepared: false, needsFull: true, reason: '程式內增量更新已停用，請使用完整 Windows Installer。' };
  if (currentProgress.active) return { prepared: false, busy: true, reason: '已有更新工作正在進行' };

  // P7 capability boundary: this updater is never a metadata client.  Only
  // the private cold-start coordinator may provide already authenticated
  // bytes, binding the outer signed policy to this inner signed ZIP check.
  if (options.authorizedColdStart !== true) {
    return { prepared: false, needsFull: false, reason: '增量更新只允許由冷啟動簽章政策啟動。' };
  }
  if (!Buffer.isBuffer(options.zipBuffer) || options.zipBuffer.length === 0) {
    return { prepared: false, needsFull: false, reason: '冷啟動簽章政策未提供更新檔案。' };
  }
  if (!parseStrictHash(options.expectedHash)) {
    return { prepared: false, needsFull: false, reason: '冷啟動簽章政策未提供有效 SHA-256。' };
  }
  if (typeof options.latestVersion !== 'string' || !options.latestVersion.trim() ||
      typeof options.outerPlanId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(options.outerPlanId)) {
    return { prepared: false, needsFull: false, reason: '冷啟動簽章政策缺少版本或計畫識別。' };
  }

  const targetRoot = resolveInstallRoot(options);
  if (!targetRoot || !hostCanIncremental({ ...options, targetRoot })) {
    return { prepared: false, needsFull: true, reason: '目前安裝版本缺少安全 updater runtime，請先使用完整 Windows Installer 升級。' };
  }

  currentProgress = { active: true, phase: 'checking', message: '正在檢查更新', startedAt: Date.now(), updatedAt: Date.now() };
  let workRoot = null;
  try {
    const buffer = options.zipBuffer;
    const latestVersion = options.latestVersion;
    setProgress('verifying-hash', '正在驗證 SHA-256');
    const expected = parseStrictHash(options.expectedHash);
    if (sha256Buffer(buffer) !== expected) throw new Error('更新檔 SHA-256 驗證失敗，正式目錄未變更');

    setProgress('inspecting-zip', '正在檢查 ASAR 更新包');
    const inspection = inspectUpdateZip(buffer, { expectedVersion: latestVersion, currentVersion: options.currentVersion || APP_VERSION });
    if (!inspection.ok) {
      setProgress('failed', inspection.reason, { error: inspection.reason });
      return { prepared: false, needsFull: inspection.needsFull, reason: inspection.reason };
    }

    setProgress('verifying-runtime', '正在驗證目前 Electron runtime');
    const runtimeCheck = verifyInstalledBaseline(targetRoot, inspection.baselineImmutableFiles);
    if (!runtimeCheck.ok) {
      const reason = `${runtimeCheck.reason}；為避免破壞安裝，請使用完整 Windows Installer。`;
      setProgress('failed', reason, { error: reason });
      return { prepared: false, needsFull: true, reason };
    }

    fs.mkdirSync(WORK_BASE, { recursive: true });
    workRoot = options.workRoot ? path.resolve(options.workRoot) : fs.mkdtempSync(path.join(WORK_BASE, 'update-'));
    const stagingRoot = path.join(workRoot, 'staging');
    const backupRoot = path.join(workRoot, 'backup');
    const readyFile = path.join(workRoot, 'updater.ready');
    const planPath = path.join(workRoot, 'update-plan.json');
    const runnerPath = path.join(workRoot, 'app-updater-runner-v2.js');
    setProgress('staging', '正在準備安全更新');
    extractToStaging(inspection, stagingRoot);
    fs.copyFileSync(path.join(__dirname, 'app-updater-runner-v2.js'), runnerPath);

    const hostPid = Number(options.parentPid || process.env.ELITESAND_HOST_PID || 0);
    if (!Number.isInteger(hostPid) || hostPid <= 0) throw new Error('無法取得 Electron 主程序 PID，拒絕更新');
    const restartCommand = path.join(targetRoot, 'Elitesand Pro.exe');
    const plan = {
      schemaVersion: UPDATE_SCHEMA_VERSION,
      mode: UPDATE_MODE,
      parentPid: hostPid,
      targetRoot,
      stagingRoot,
      backupRoot,
      workRoot,
      readyFile,
      logFile: path.join(logsDir, `update-v2-${new Date().toISOString().replace(/[:.]/g, '-')}.log`),
      rollbackErrorLog: path.join(logsDir, `update-v2-rollback-error-${Date.now()}.log`),
      files: inspection.files,
      baselineRuntimeFingerprint: inspection.baselineRuntimeFingerprint,
      baselineImmutableFiles: inspection.baselineImmutableFiles,
      fromVersion: inspection.fromVersion,
      toVersion: inspection.version,
      restart: { type: 'electron-app', command: restartCommand },
      waitTimeoutMs: options.waitTimeoutMs || 10 * 60 * 1000,
    };
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
    setProgress('prepared', '更新已準備完成', { version: inspection.version });
    return {
      prepared: true,
      planPath,
      runnerPath,
      readyFile,
      plan,
      workRoot,
      updaterRuntime: resolveUpdaterRuntime(targetRoot, options),
      latestVersion: inspection.version,
    };
  } catch (error) {
    if (workRoot && !options.workRoot) {
      try { removeTreeInside(workRoot, WORK_BASE); } catch (_) {}
    }
    setProgress('failed', `更新失敗，程式仍可繼續使用：${error.message}`, { error: error.message });
    log.warn(`更新準備失敗：${error.message}`);
    return { prepared: false, needsFull: false, reason: error.message };
  }
}

async function launchUpdater(prepared, options = {}) {
  if (!prepared?.prepared) return { launched: false, reason: '更新尚未準備完成' };
  const spawnImpl = options.spawnImpl || spawn;
  let child;
  try {
    child = spawnImpl(prepared.updaterRuntime, [prepared.runnerPath, prepared.planPath], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      cwd: prepared.workRoot,
      env: { ...process.env },
    });
    if (!child || typeof child.once !== 'function') throw new Error('無法建立 updater-v2 程序');
    child.unref?.();
  } catch (error) {
    setProgress('failed', `updater-v2 啟動失敗：${error.message}`, { error: error.message });
    return { launched: false, reason: `updater-v2 啟動失敗：${error.message}` };
  }

  const timeoutMs = options.readyTimeoutMs || 5000;
  const ready = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearInterval(poll); clearTimeout(timer); resolve(value); } };
    const poll = setInterval(() => { if (fs.existsSync(prepared.readyFile)) finish(true); }, 40);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('error', () => finish(false));
    child.once('exit', () => { if (!fs.existsSync(prepared.readyFile)) finish(false); });
  });
  if (!ready) {
    try { child.kill(); } catch (_) {}
    setProgress('failed', 'updater-v2 未能完成啟動握手', { error: 'UPDATER_V2_NOT_READY' });
    return { launched: false, reason: 'updater-v2 未能完成啟動握手' };
  }
  setProgress('ready', '安全更新已準備完成，即將重新啟動', { version: prepared.latestVersion });
  return { launched: true, updaterPid: child.pid };
}

async function prepareAndLaunchUpdate(options = {}) {
  const prepared = await prepareUpdate(options);
  if (!prepared.prepared) return prepared;
  const launched = await launchUpdater(prepared, options);
  if (!launched.launched) return { prepared: false, needsFull: false, reason: launched.reason };
  return { ...prepared, ...launched };
}

function _resetForTests() {
  currentProgress = { active: false, phase: 'idle', message: '尚未開始更新', startedAt: null, updatedAt: Date.now() };
}

module.exports = {
  UPDATE_ZIP_NAME,
  UPDATE_HASH_NAME,
  UPDATE_SCHEMA_VERSION,
  UPDATE_MODE,
  PROTECTED_UPDATER_RUNTIME,
  INCREMENTAL_UPDATES_DISABLED,
  MAX_ZIP_BYTES,
  MAX_UNPACKED_BYTES,
  parseStrictHash,
  isSafeRelativePath,
  isAllowedEntry,
  isAllowedDesktopEntry,
  isUpdateOwnedPath,
  isImmutableBaselineEntry,
  canonicalBaselineFingerprint,
  verifyInstalledBaseline,
  inspectUpdateZip,
  findVerifiedUpdateAssets,
  fetchLatestRelease,
  getPlan,
  downloadReleaseUpdate,
  downloadLatestUpdate,
  prepareUpdate,
  launchUpdater,
  prepareAndLaunchUpdate,
  getProgress,
  setProgress,
  hostCanIncremental,
  resolveInstallRoot,
  consumeUpdateResultMarker,
  _resetForTests,
};
