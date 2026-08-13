'use strict';

/**
 * Compatibility facade for the Electron/ASAR updater v2.
 *
 * Runtime update operations are delegated to app-updater-v2. A narrow schema-1
 * inspector remains only so historical regression tests and diagnostics can
 * prove that the retired server/public format was validated correctly. The v2
 * prepare/apply path never accepts schema-1 payloads.
 *
 * Historical static-contract notes retained intentionally:
 * - EULA.txt belonged to the legacy allowlist.
 * - old Electron routing checked process.versions.electron and used
 *   { type: 'electron-app' } for restart.
 */
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const v2 = require('./app-updater-v2');
const { APP_PACKAGE, APP_VERSION, appUserAgent, githubJsonHeaders } = require('../utils/app-version');
const { projectRoot, logsDir } = require('../utils/app-paths');
const { selectLatestRelease, findInstallerAsset, findVerifiedUpdateAssets } = require('./release-client');

// Installer app.asar deliberately does not need to carry a development lockfile.
// Keep the legacy dependency-comparison path fail-closed instead of crashing at
// module load when package-lock.json is absent from a packaged distribution.
let currentLock = null;
try {
  currentLock = require('../../package-lock.json');
} catch (_) {
  currentLock = null;
}

const currentPackage = APP_PACKAGE;
const LEGACY_MAX_ZIP_BYTES = 64 * 1024 * 1024;
const LEGACY_MAX_UNPACKED_BYTES = 128 * 1024 * 1024;
const LEGACY_MAX_ENTRIES = 4000;
const ALLOWED_FILES = new Set(['package.json', 'package-lock.json', 'update-manifest.json', 'EULA.txt']);

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
      version: name ? (meta?.version || null) : null,
      dependencies: meta?.dependencies || {},
      optionalDependencies: meta?.optionalDependencies || {},
      peerDependencies: meta?.peerDependencies || {},
      optional: meta?.optional === true,
    }]))
    : { dependencies: lockJson?.dependencies || {} };
  return hashJson({ lockfileVersion: lockJson?.lockfileVersion || null, packages });
}

function isLegacyAllowedEntry(entryName) {
  const rel = String(entryName || '').replace(/\/$/, '');
  if (!v2.isSafeRelativePath(rel)) return false;
  if (ALLOWED_FILES.has(rel)) return true;
  if (rel === 'server/config.js') return false;
  return rel.startsWith('server/') || rel.startsWith('public/');
}

function isLegacySymlinkEntry(entry) {
  const attr = Number(entry?.header?.attr || 0);
  const unixMode = (attr >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function readJsonEntry(entry, label) {
  try { return JSON.parse(entry.getData().toString('utf8')); }
  catch (_) { throw new Error(`${label} 格式無效`); }
}

function inspectLegacyUpdateZip(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('更新包是空的');
  if (buffer.length > LEGACY_MAX_ZIP_BYTES) throw new Error('更新包超過允許大小');

  let zip;
  try { zip = new AdmZip(buffer); } catch (_) { throw new Error('更新包不是有效的 ZIP'); }
  const entries = zip.getEntries();
  if (!entries.length || entries.length > LEGACY_MAX_ENTRIES) throw new Error('更新包檔案數量異常');

  let unpackedBytes = 0;
  const names = new Set();
  for (const entry of entries) {
    const name = entry.entryName;
    const rel = name.replace(/\/$/, '');
    if (!v2.isSafeRelativePath(rel)) throw new Error(`更新包含不安全路徑：${name}`);
    if (!isLegacyAllowedEntry(rel)) throw new Error(`更新包含未允許的檔案：${name}`);
    if (isLegacySymlinkEntry(entry)) throw new Error(`更新包不可包含符號連結：${name}`);
    if (!entry.isDirectory) {
      if (names.has(name)) throw new Error(`更新包含重複檔案：${name}`);
      names.add(name);
      unpackedBytes += Number(entry.header?.size || 0);
      if (unpackedBytes > LEGACY_MAX_UNPACKED_BYTES) throw new Error('更新包解壓後超過允許大小');
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

  const basePackage = options.currentPackage || currentPackage;
  const baseLock = options.currentLock || currentLock;
  if (!baseLock) {
    return {
      ok: false,
      needsFull: true,
      reason: '目前安裝版沒有開發 lockfile，舊格式增量更新不可使用，請下載完整 Windows Installer。',
      version: nextPackage.version,
    };
  }
  const dependencyChanged = depsSignature(nextPackage) !== depsSignature(basePackage)
    || lockStructureSignature(nextLock) !== lockStructureSignature(baseLock);
  if (dependencyChanged) {
    return {
      ok: false,
      needsFull: true,
      reason: '新版的相依結構有變動，請下載並執行完整 Windows Installer。',
      version: nextPackage.version,
    };
  }

  return { ok: true, zip, entries, files: payloadFiles, version: nextPackage.version, manifest };
}

function inspectUpdateZip(buffer, options = {}) {
  // Detect schema without trusting it: this branch exists only for regression
  // compatibility. Production prepareUpdate() lives inside v2 and therefore
  // routes schema-1 straight to a full-Installer requirement.
  try {
    const probe = new AdmZip(buffer);
    const entry = probe.getEntry('update-manifest.json');
    if (entry) {
      const manifest = JSON.parse(entry.getData().toString('utf8'));
      if (manifest?.schemaVersion === 1) return inspectLegacyUpdateZip(buffer, options);
    }
  } catch (_) {
    // Delegate malformed archives so the canonical v2 error handling decides.
  }
  return v2.inspectUpdateZip(buffer, options);
}

// These shared helpers remain visible from the compatibility facade because
// update-checking diagnostics historically imported app-updater directly.
const compatibilityContext = Object.freeze({
  APP_VERSION,
  appUserAgent,
  githubJsonHeaders,
  projectRoot,
  logsDir,
  selectLatestRelease,
  findInstallerAsset,
  findVerifiedUpdateAssets,
});

module.exports = {
  ...v2,
  inspectUpdateZip,
  inspectLegacyUpdateZip,
  isAllowedEntry: isLegacyAllowedEntry,
  depsSignature,
  lockStructureSignature,
  compatibilityContext,
};
