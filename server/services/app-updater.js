'use strict';

/**
 * 安全增量更新的主程序端。
 *
 * 這個模組只做「準備」：精確挑選 Release asset、下載、SHA-256、ZIP 路徑與
 * 白名單檢查、相依相容性檢查、解壓到 staging，最後啟動獨立 updater。
 * 正式安裝一定由複製到暫存區的 app-updater-runner.js 在主 PID 完全結束後執行。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { isNewerVersion } = require('../utils/version-compare');
const { createLogger } = require('../utils/logger');
const config = require('../utils/load-config');
const pkg = require('../../package.json');
const currentLock = require('../../package-lock.json');

const log = createLogger('AppUpdater');
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const UPDATE_ZIP_NAME = 'update.zip';
const UPDATE_HASH_NAME = 'update.zip.sha256';
const MIN_SAFE_UPDATER_VERSION = '0.7.3';
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 4000;
const ALLOWED_DIRS = new Set(['server', 'public']);
const ALLOWED_FILES = new Set(['package.json', 'package-lock.json', 'update-manifest.json']);
const PROTECTED_PREFIXES = ['data/', 'downloads/', 'logs/', 'node_modules/', '.git/'];
const WORK_BASE = path.join(os.tmpdir(), 'Elitesand-Pro-updates');

let currentProgress = {
  active: false,
  phase: 'idle',
  message: '尚未開始更新',
  startedAt: null,
  updatedAt: Date.now(),
};
let verifiedDownloadCache = null;

function setProgress(phase, message, extra = {}) {
  currentProgress = {
    ...currentProgress,
    active: !['failed', 'ready', 'idle'].includes(phase),
    phase,
    message,
    updatedAt: Date.now(),
    ...extra,
  };
}

function getProgress() {
  return { ...currentProgress };
}

function ghHeaders() {
  return { Accept: 'application/vnd.github+json', 'User-Agent': 'Elitesand-Pro' };
}

function selectLatestRelease(releases) {
  if (!Array.isArray(releases)) return null;
  return releases
    .filter((release) => release && !release.draft && release.tag_name)
    .reduce((latest, release) => (
      !latest || isNewerVersion(String(release.tag_name), String(latest.tag_name)) ? release : latest
    ), null);
}

function findVerifiedUpdateAssets(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const zip = assets.find((asset) => asset?.name === UPDATE_ZIP_NAME);
  const checksum = assets.find((asset) => asset?.name === UPDATE_HASH_NAME);
  return zip && checksum ? { zip, checksum } : null;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableObject(value))).digest('hex');
}

function depsSignature(packageJson) {
  return hashJson({
    dependencies: packageJson?.dependencies || {},
    optionalDependencies: packageJson?.optionalDependencies || {},
    bundledDependencies: packageJson?.bundledDependencies || [],
  });
}

function lockStructureSignature(lockJson) {
  const packages = lockJson?.packages && typeof lockJson.packages === 'object'
    ? Object.fromEntries(Object.entries(lockJson.packages).map(([name, meta]) => [name, {
      // packages[""] 是專案本身；版本每次 Release 都會變，不能誤判成 node_modules 結構變動。
      version: name ? (meta?.version || null) : null,
      dependencies: meta?.dependencies || {},
      optionalDependencies: meta?.optionalDependencies || {},
      peerDependencies: meta?.peerDependencies || {},
      optional: meta?.optional === true,
    }]))
    : { dependencies: lockJson?.dependencies || {} };
  return hashJson({ lockfileVersion: lockJson?.lockfileVersion || null, packages });
}

function isSafeRelativePath(entryName) {
  if (typeof entryName !== 'string' || !entryName || entryName.includes('\0') || entryName.includes('\\')) return false;
  if (entryName.startsWith('/') || entryName.startsWith('//') || /^[a-zA-Z]:/.test(entryName)) return false;
  const parts = entryName.split('/');
  if (parts.some((part) => part === '..' || part === '.')) return false;
  const normalized = path.posix.normalize(entryName);
  return normalized === entryName.replace(/\/$/, '') || `${normalized}/` === entryName;
}

function isAllowedEntry(entryName) {
  const isDirectory = entryName.endsWith('/');
  const rel = entryName.replace(/\/$/, '');
  if (!rel) return false;
  const lower = rel.toLowerCase();
  if (PROTECTED_PREFIXES.some((prefix) => lower === prefix.slice(0, -1) || lower.startsWith(prefix))) return false;
  if (ALLOWED_FILES.has(rel)) return true;
  const top = rel.split('/')[0];
  if (isDirectory && rel === top) return ALLOWED_DIRS.has(top);
  return ALLOWED_DIRS.has(top) && rel.includes('/');
}

function isSymlinkEntry(entry) {
  const attr = Number(entry?.header?.attr || 0);
  const unixMode = (attr >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function parseStrictHash(text) {
  const value = String(text || '').trim();
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function readJsonEntry(entry, label) {
  try {
    return JSON.parse(entry.getData().toString('utf8'));
  } catch (_) {
    throw new Error(`${label} 格式無效`);
  }
}

function inspectUpdateZip(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('更新包是空的');
  if (buffer.length > MAX_ZIP_BYTES) throw new Error('更新包超過允許大小');

  let zip;
  try { zip = new AdmZip(buffer); } catch (_) { throw new Error('更新包不是有效的 ZIP'); }
  const entries = zip.getEntries();
  if (!entries.length || entries.length > MAX_ENTRIES) throw new Error('更新包檔案數量異常');

  let unpackedBytes = 0;
  const names = new Set();
  for (const entry of entries) {
    const name = entry.entryName;
    if (!isSafeRelativePath(name)) throw new Error(`更新包含不安全路徑：${name}`);
    if (!isAllowedEntry(name)) throw new Error(`更新包含未允許的檔案：${name}`);
    if (isSymlinkEntry(entry)) throw new Error(`更新包不可包含符號連結：${name}`);
    if (!entry.isDirectory) {
      if (names.has(name)) throw new Error(`更新包含重複檔案：${name}`);
      names.add(name);
      unpackedBytes += Number(entry.header?.size || 0);
      if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error('更新包解壓後超過允許大小');
    }
  }

  const find = (name) => entries.find((entry) => !entry.isDirectory && entry.entryName === name);
  const packageEntry = find('package.json');
  const lockEntry = find('package-lock.json');
  const manifestEntry = find('update-manifest.json');
  if (!packageEntry || !lockEntry || !manifestEntry) throw new Error('更新包缺少 package.json、package-lock.json 或 update-manifest.json');

  const nextPackage = readJsonEntry(packageEntry, 'package.json');
  const nextLock = readJsonEntry(lockEntry, 'package-lock.json');
  const manifest = readJsonEntry(manifestEntry, 'update-manifest.json');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('更新 manifest 版本或格式無效');
  if (String(manifest.version || '') !== String(nextPackage.version || '')) throw new Error('更新 manifest 與 package.json 版本不一致');
  if (options.expectedVersion && String(nextPackage.version) !== String(options.expectedVersion)) throw new Error('更新包版本與 GitHub Release 不一致');

  const payloadFiles = [...names].filter((name) => name !== 'update-manifest.json').sort();
  const declaredFiles = [...new Set(manifest.files.map(String))].sort();
  if (JSON.stringify(payloadFiles) !== JSON.stringify(declaredFiles)) throw new Error('更新 manifest 檔案清單與 ZIP 內容不一致');

  const currentPackage = options.currentPackage || pkg;
  const currentLockJson = options.currentLock || currentLock;
  const dependencyChanged = depsSignature(nextPackage) !== depsSignature(currentPackage)
    || lockStructureSignature(nextLock) !== lockStructureSignature(currentLockJson);
  if (dependencyChanged) {
    return {
      ok: false,
      needsFull: true,
      reason: '新版的 dependencies 或 lockfile 相依結構有變動，必須下載完整 Portable 版本。',
      version: nextPackage.version,
    };
  }

  return { ok: true, zip, entries, files: payloadFiles, version: nextPackage.version, manifest };
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
      if (total > maxBytes) {
        controller.abort();
        throw new Error('下載內容超過允許大小');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('下載逾時');
    throw err;
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

function findPortableAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => /^Elitesand-Pro-v?[0-9][^/]*-portable\.zip$/i.test(asset?.name || '')) || null;
}

async function getPlan() {
  const repo = config.updateCheckRepo;
  const base = {
    enabled: !!repo,
    repo: repo || null,
    currentVersion: pkg.version,
    latestVersion: null,
    hasUpdate: false,
    canIncremental: false,
    needsFull: false,
    reason: null,
    releaseUrl: null,
    downloadUrl: null,
  };
  if (!repo) { base.reason = '未設定更新來源'; return base; }
  try {
    const release = await fetchLatestRelease(repo);
    base.latestVersion = String(release.tag_name).replace(/^[vV]/, '');
    base.releaseUrl = typeof release.html_url === 'string' ? release.html_url : null;
    const portable = findPortableAsset(release);
    base.downloadUrl = portable?.browser_download_url || base.releaseUrl;
    base.hasUpdate = isNewerVersion(base.latestVersion, pkg.version);
    const updaterSupported = !isNewerVersion(MIN_SAFE_UPDATER_VERSION, pkg.version);
    base.canIncremental = base.hasUpdate && updaterSupported && !!findVerifiedUpdateAssets(release);
    base.needsFull = base.hasUpdate && !base.canIncremental;
    if (!base.hasUpdate) base.reason = '已是最新版本';
    else if (!updaterSupported) base.reason = '此版本尚未具備安全 updater，只能下載完整 Portable 版本';
    else if (!base.canIncremental) base.reason = '新版未同時提供固定名稱 update.zip 與 update.zip.sha256，請使用完整下載';
    else {
      // 更新按鈕出現前就完成 SHA、ZIP 與 dependency/lock 結構檢查；不能等使用者按下後
      // 才發現需要完整版。驗證過的幾 MB 更新包會短暫留在記憶體，正式套用時不重抓。
      try {
        const downloaded = await downloadReleaseUpdate(release, { reportProgress: false });
        const inspection = inspectUpdateZip(downloaded.buffer, { expectedVersion: base.latestVersion });
        if (!inspection.ok) {
          base.canIncremental = false;
          base.needsFull = true;
          base.reason = inspection.reason;
        } else {
          verifiedDownloadCache = { version: base.latestVersion, buffer: downloaded.buffer, timestamp: Date.now() };
        }
      } catch (err) {
        base.canIncremental = false;
        base.needsFull = true;
        base.reason = `增量更新包驗證失敗：${err.message}`;
      }
    }
    return base;
  } catch (err) {
    base.reason = err.status === 404 ? '更新來源尚未公開或尚未發布 Release' : `檢查失敗：${err.message}`;
    return base;
  }
}

function ensureInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function unlinkIfExists(target) {
  try {
    fs.unlinkSync(target);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function removeTreeInside(target, parent) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (!ensureInside(resolvedTarget, resolvedParent)) throw new Error(`拒絕清理更新暫存目錄外的路徑：${resolvedTarget}`);

  let stat;
  try {
    stat = fs.lstatSync(resolvedTarget);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    unlinkIfExists(resolvedTarget);
    return;
  }
  for (const name of fs.readdirSync(resolvedTarget)) {
    removeTreeInside(path.join(resolvedTarget, name), resolvedTarget);
  }
  fs.rmdirSync(resolvedTarget);
}

function cleanupOldWorkDirs(now = Date.now()) {
  try {
    fs.mkdirSync(WORK_BASE, { recursive: true });
    for (const name of fs.readdirSync(WORK_BASE)) {
      const full = path.join(WORK_BASE, name);
      try {
        if (now - fs.statSync(full).mtimeMs > 24 * 60 * 60 * 1000) removeTreeInside(full, WORK_BASE);
      } catch (_) { /* best effort */ }
    }
  } catch (err) {
    log.warn(`清理舊更新暫存失敗：${err.message}`);
  }
}

function extractToStaging(inspection, stagingRoot) {
  fs.mkdirSync(stagingRoot, { recursive: true });
  for (const entry of inspection.entries) {
    if (entry.isDirectory) continue;
    const destination = path.join(stagingRoot, ...entry.entryName.split('/'));
    if (!ensureInside(destination, stagingRoot)) throw new Error(`拒絕寫入 staging 外：${entry.entryName}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.getData());
  }
}

async function downloadReleaseUpdate(release, { reportProgress = true } = {}) {
  const latestVersion = String(release.tag_name).replace(/^[vV]/, '');
  const assets = findVerifiedUpdateAssets(release);
  if (!assets) throw new Error('新版未同時提供固定名稱 update.zip 與 update.zip.sha256');

  if (reportProgress) setProgress('downloading-hash', '正在下載驗證檔');
  const hashBody = await fetchBuffer(assets.checksum.browser_download_url, {
    headers: { 'User-Agent': 'Elitesand-Pro' }, timeoutMs: 10000, maxBytes: 1024,
  });
  const expectedHash = parseStrictHash(hashBody.toString('utf8'));
  if (!expectedHash) throw new Error('SHA-256 驗證檔必須只包含 64 字元十六進位雜湊');

  if (reportProgress) setProgress('downloading-zip', '正在下載更新包');
  const buffer = await fetchBuffer(assets.zip.browser_download_url, {
    headers: { 'User-Agent': 'Elitesand-Pro' }, timeoutMs: 60000, maxBytes: MAX_ZIP_BYTES,
  });
  if (reportProgress) setProgress('verifying-hash', '正在驗證 SHA-256');
  const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== expectedHash) throw new Error('更新檔 SHA-256 驗證失敗，正式目錄未變更');
  return { buffer, latestVersion };
}

async function downloadLatestUpdate(repo) {
  const release = await fetchLatestRelease(repo);
  const latestVersion = String(release.tag_name).replace(/^[vV]/, '');
  if (!isNewerVersion(latestVersion, pkg.version)) throw new Error('已是最新版本');
  if (verifiedDownloadCache && verifiedDownloadCache.version === latestVersion
      && Date.now() - verifiedDownloadCache.timestamp < 10 * 60 * 1000) {
    setProgress('verifying-hash', '正在使用已驗證的更新包');
    return { buffer: verifiedDownloadCache.buffer, latestVersion };
  }
  return downloadReleaseUpdate(release);
}

async function prepareUpdate(options = {}) {
  if (currentProgress.active) return { prepared: false, busy: true, reason: '已有更新工作正在進行' };
  currentProgress = { active: true, phase: 'checking', message: '正在檢查更新', startedAt: Date.now(), updatedAt: Date.now() };
  let workRoot = null;
  try {
    cleanupOldWorkDirs();
    const targetRoot = path.resolve(options.targetRoot || PROJECT_ROOT);
    let buffer = options.zipBuffer;
    let latestVersion = options.latestVersion || null;
    if (!buffer) {
      if (!config.updateCheckRepo) throw new Error('未設定更新來源');
      ({ buffer, latestVersion } = await downloadLatestUpdate(config.updateCheckRepo));
    } else if (options.expectedHash) {
      setProgress('verifying-hash', '正在驗證 SHA-256');
      const actual = crypto.createHash('sha256').update(buffer).digest('hex');
      if (actual !== parseStrictHash(options.expectedHash)) throw new Error('更新檔 SHA-256 驗證失敗，正式目錄未變更');
    }

    setProgress('inspecting-zip', '正在檢查更新包');
    const inspection = inspectUpdateZip(buffer, {
      expectedVersion: latestVersion,
      currentPackage: options.currentPackage || pkg,
      currentLock: options.currentLock || currentLock,
    });
    if (!inspection.ok) {
      setProgress('failed', inspection.reason, { error: inspection.reason });
      return { prepared: false, needsFull: inspection.needsFull, reason: inspection.reason };
    }

    setProgress('staging', '正在準備更新');
    fs.mkdirSync(WORK_BASE, { recursive: true });
    workRoot = options.workRoot
      ? path.resolve(options.workRoot)
      : fs.mkdtempSync(path.join(WORK_BASE, 'update-'));
    const stagingRoot = path.join(workRoot, 'staging');
    const backupRoot = path.join(workRoot, 'backup');
    const readyFile = path.join(workRoot, 'updater.ready');
    const planPath = path.join(workRoot, 'update-plan.json');
    const runnerPath = path.join(workRoot, 'app-updater-runner.js');
    extractToStaging(inspection, stagingRoot);
    fs.copyFileSync(path.join(__dirname, 'app-updater-runner.js'), runnerPath);

    const portableLauncher = path.join(path.dirname(targetRoot), 'Start Elitesand Pro.cmd');
    const restart = fs.existsSync(portableLauncher)
      ? { type: 'launcher', launcher: portableLauncher }
      : { type: 'node', command: process.execPath, args: [path.join(targetRoot, 'server', 'index.js')], cwd: targetRoot };
    const logDir = path.join(targetRoot, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const plan = {
      schemaVersion: 1,
      parentPid: options.parentPid || process.pid,
      targetRoot,
      stagingRoot,
      backupRoot,
      workRoot,
      readyFile,
      logFile: path.join(logDir, `update-${new Date().toISOString().replace(/[:.]/g, '-')}.log`),
      rollbackErrorLog: path.join(logDir, `update-rollback-error-${Date.now()}.log`),
      files: inspection.files,
      fromVersion: pkg.version,
      toVersion: inspection.version,
      restart,
      waitTimeoutMs: options.waitTimeoutMs || 10 * 60 * 1000,
    };
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
    setProgress('prepared', '更新已準備完成', { version: inspection.version });
    return { prepared: true, planPath, runnerPath, readyFile, plan, workRoot, latestVersion: inspection.version };
  } catch (err) {
    if (workRoot && !options.workRoot) {
      try { removeTreeInside(workRoot, WORK_BASE); } catch (_) { /* keep evidence if locked */ }
    }
    setProgress('failed', `更新失敗，程式仍可繼續使用：${err.message}`, { error: err.message });
    log.warn(`更新準備失敗（主程序繼續運作）：${err.message}`);
    return { prepared: false, needsFull: false, reason: err.message };
  }
}

async function launchUpdater(prepared, options = {}) {
  if (!prepared?.prepared) return { launched: false, reason: '更新尚未準備完成' };
  const spawnImpl = options.spawnImpl || spawn;
  let child;
  try {
    child = spawnImpl(process.execPath, [prepared.runnerPath, prepared.planPath], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      cwd: prepared.workRoot,
    });
    if (!child || typeof child.once !== 'function') throw new Error('無法建立 updater 程序');
    child.unref?.();
  } catch (err) {
    setProgress('failed', `updater 啟動失敗，程式仍可繼續使用：${err.message}`, { error: err.message });
    return { launched: false, reason: `updater 啟動失敗：${err.message}` };
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
    try { child.kill(); } catch (_) { /* best effort */ }
    setProgress('failed', 'updater 未能完成啟動握手，程式仍可繼續使用', { error: 'UPDATER_NOT_READY' });
    return { launched: false, reason: 'updater 未能完成啟動握手' };
  }
  setProgress('ready', '更新已準備完成，即將重新啟動', { version: prepared.latestVersion });
  return { launched: true, updaterPid: child.pid };
}

async function prepareAndLaunchUpdate(options = {}) {
  const prepared = await prepareUpdate(options);
  if (!prepared.prepared) return prepared;
  const launched = await launchUpdater(prepared, options);
  if (!launched.launched) return { prepared: false, reason: launched.reason };
  return {
    prepared: true,
    restartPending: true,
    latestVersion: prepared.latestVersion,
    message: '更新已準備完成，即將重新啟動',
  };
}

module.exports = {
  UPDATE_ZIP_NAME,
  UPDATE_HASH_NAME,
  MIN_SAFE_UPDATER_VERSION,
  getPlan,
  getProgress,
  prepareUpdate,
  launchUpdater,
  prepareAndLaunchUpdate,
  inspectUpdateZip,
  parseStrictHash,
  isSafeRelativePath,
  isAllowedEntry,
  depsSignature,
  lockStructureSignature,
  unlinkIfExists,
  removeTreeInside,
  selectLatestRelease,
  findVerifiedUpdateAssets,
  _resetForTests() {
    currentProgress = { active: false, phase: 'idle', message: '尚未開始更新', startedAt: null, updatedAt: Date.now() };
    verifiedDownloadCache = null;
  },
};
