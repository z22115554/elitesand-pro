'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { safeRemove } = require('../server/utils/safe-remove');

const MEDIA_FOLDER_NAME = 'Elitesand Pro Media';
const MEDIA_MARKER_NAME = '.elitesand-pro-media-root';
const RECOVERY_REFERENCE_NAME = 'media-preserve.ini';

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function readIniPath(file, fsImpl = fs) {
  try {
    const raw = fsImpl.readFileSync(file, 'utf8');
    const match = raw.match(/^path=(.+)$/mi);
    const value = match?.[1]?.trim();
    return value && path.isAbsolute(value) ? path.resolve(value) : null;
  } catch (_) {
    return null;
  }
}

function readConfiguredMediaDir(userDataPath, fsImpl = fs) {
  try {
    const file = path.join(path.resolve(userDataPath), 'data', 'media-storage.json');
    const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    return typeof parsed?.mediaDir === 'string' && path.isAbsolute(parsed.mediaDir)
      ? path.resolve(parsed.mediaDir)
      : null;
  } catch (_) {
    return null;
  }
}

function readRecoveryMediaDir(userDataPath, fsImpl = fs) {
  return readIniPath(path.join(path.resolve(userDataPath), RECOVERY_REFERENCE_NAME), fsImpl);
}

function writeFileAtomic(file, contents, fsImpl = fs) {
  const temporary = `${file}.tmp`;
  fsImpl.writeFileSync(temporary, contents, 'utf8');
  fsImpl.renameSync(temporary, file);
}

function visibleEntries(directory, fsImpl = fs) {
  try {
    return fsImpl.readdirSync(directory).filter((name) => name !== MEDIA_MARKER_NAME);
  } catch (_) {
    return [];
  }
}

function ensureMarker(mediaDir, fsImpl = fs) {
  fsImpl.mkdirSync(mediaDir, { recursive: true });
  const marker = path.join(mediaDir, MEDIA_MARKER_NAME);
  if (!fsImpl.existsSync(marker)) fsImpl.writeFileSync(marker, 'Elitesand Pro managed media root\n', 'utf8');
}

function writeReferences(userDataPath, mediaDir, fsImpl = fs) {
  const root = path.resolve(userDataPath);
  const dataDir = path.join(root, 'data');
  fsImpl.mkdirSync(dataDir, { recursive: true });
  writeFileAtomic(
    path.join(dataDir, 'media-storage.json'),
    `${JSON.stringify({ version: 1, mediaDir: path.resolve(mediaDir) }, null, 2)}\n`,
    fsImpl,
  );
  writeFileAtomic(path.join(root, 'media-storage.ini'), `[media]\npath=${path.resolve(mediaDir)}\n`, fsImpl);
}

function getInstallRoot(executablePath) {
  return path.dirname(path.resolve(executablePath));
}

function getPreferredSiblingMediaDir(executablePath) {
  return path.join(path.dirname(getInstallRoot(executablePath)), MEDIA_FOLDER_NAME);
}

function getVulnerableInstallMediaDir(executablePath) {
  return path.join(getInstallRoot(executablePath), MEDIA_FOLDER_NAME);
}

function hasMarker(directory, fsImpl = fs) {
  return fsImpl.existsSync(path.join(directory, MEDIA_MARKER_NAME));
}

function numberedSiblingCandidate(preferred, index) {
  return index === 1 ? preferred : `${preferred} (${index})`;
}

function chooseDefaultSiblingMediaDir(executablePath, fsImpl = fs) {
  const preferred = getPreferredSiblingMediaDir(executablePath);
  // If an earlier install already created a managed sibling media folder, reuse
  // it rather than hiding preserved songs behind a fresh empty directory.
  if (hasMarker(preferred, fsImpl)) return preferred;
  if (!fsImpl.existsSync(preferred) || visibleEntries(preferred, fsImpl).length === 0) return preferred;

  // Never adopt a non-empty unmarked directory. Pick a collision-free sibling
  // on the same parent volume instead of overwriting unknown user files.
  for (let index = 2; index <= 99; index++) {
    const candidate = numberedSiblingCandidate(preferred, index);
    if (!fsImpl.existsSync(candidate) || visibleEntries(candidate, fsImpl).length === 0) return candidate;
  }
  throw new Error('No safe sibling media directory is available.');
}

function chooseEmptyMigrationDestination(executablePath, fsImpl = fs) {
  const preferred = getPreferredSiblingMediaDir(executablePath);
  for (let index = 1; index <= 99; index++) {
    const candidate = numberedSiblingCandidate(preferred, index);
    if (!fsImpl.existsSync(candidate) || visibleEntries(candidate, fsImpl).length === 0) return candidate;
  }
  throw new Error('No empty sibling media directory is available for recovery.');
}

function sha256File(file, fsImpl = fs) {
  return crypto.createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex');
}

function verifyCopiedEntry(source, destination, fsImpl = fs) {
  const sourceStat = fsImpl.statSync(source);
  const destinationStat = fsImpl.statSync(destination);
  if (sourceStat.isDirectory()) {
    if (!destinationStat.isDirectory()) return false;
    for (const name of fsImpl.readdirSync(source)) {
      if (!verifyCopiedEntry(path.join(source, name), path.join(destination, name), fsImpl)) return false;
    }
    return true;
  }
  return destinationStat.isFile()
    && sourceStat.size === destinationStat.size
    && sha256File(source, fsImpl) === sha256File(destination, fsImpl);
}

function copyVulnerableMedia(sourceDir, destinationDir, fsImpl = fs) {
  const entries = visibleEntries(sourceDir, fsImpl);
  if (visibleEntries(destinationDir, fsImpl).length > 0) {
    return { copied: false, reason: 'destination-not-empty', entries: 0 };
  }

  ensureMarker(destinationDir, fsImpl);
  try {
    for (const name of entries) {
      fsImpl.cpSync(path.join(sourceDir, name), path.join(destinationDir, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    for (const name of entries) {
      if (!verifyCopiedEntry(path.join(sourceDir, name), path.join(destinationDir, name), fsImpl)) {
        throw new Error(`Media recovery verification failed for ${name}`);
      }
    }
  } catch (error) {
    // destination 是本函式確認為空、並由 ensureMarker() 標記後才開始寫入的專用目錄。
    // source 全程不動，因此失敗時清掉本次 partial copy 才能安全重試；否則每次重開
    // 都會再挑 (2)/(3)... 複製一份，磁碟越來越滿，最後形成「怎麼點都打不開」。
    safeRemove(destinationDir, { fsImpl });
    throw error;
  }
  return { copied: true, reason: null, entries: entries.length };
}

function isUsableRecoveryDir(directory, fsImpl = fs) {
  return !!directory && fsImpl.existsSync(directory) && hasMarker(directory, fsImpl);
}

// macOS：.app 內不可寫（會破壞程式碼簽章；從 DMG 直接開時整個磁碟區是唯讀），
// 也沒有「安裝資料夾旁邊」可用。歌曲固定放在 userData（~/Library/Application Support/
// Elitesand Pro）底下，換新版 .app 不受影響，也不會觸發「文件」「下載」資料夾的隱私權詢問。
function getMacDefaultMediaDir(userDataPath) {
  return path.join(path.resolve(userDataPath), MEDIA_FOLDER_NAME);
}

function preparePackagedMediaStorage({ userDataPath, executablePath, fsImpl = fs, onBeforeCopy = null, platform = process.platform } = {}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('preparePackagedMediaStorage requires an absolute userDataPath');
  }
  if (typeof executablePath !== 'string' || !path.isAbsolute(executablePath)) {
    throw new TypeError('preparePackagedMediaStorage requires an absolute executablePath');
  }

  if (platform === 'darwin') {
    const configured = readConfiguredMediaDir(userDataPath, fsImpl);
    // 使用者在面板自選的位置永遠優先；macOS 從來沒有「放在安裝資料夾內」的舊版本，
    // 不需要 Windows 那套搬移流程。
    if (configured) return { mediaDir: configured, action: 'kept-configured' };
    const mediaDir = getMacDefaultMediaDir(userDataPath);
    ensureMarker(mediaDir, fsImpl);
    writeReferences(userDataPath, mediaDir, fsImpl);
    return { mediaDir, action: 'initialized-mac-default' };
  }

  const vulnerableMediaDir = getVulnerableInstallMediaDir(executablePath);
  const configuredMediaDir = readConfiguredMediaDir(userDataPath, fsImpl);
  const recoveryMediaDir = readRecoveryMediaDir(userDataPath, fsImpl);

  // Fresh installs keep large, unbounded media on the same parent location as
  // the chosen application directory, but outside the directory that an
  // installer/update is allowed to replace. Example:
  //   D:\\Apps\\Elitesand Pro            (program)
  //   D:\\Apps\\Elitesand Pro Media      (user media)
  if (!configuredMediaDir) {
    const safeMediaDir = chooseDefaultSiblingMediaDir(executablePath, fsImpl);
    ensureMarker(safeMediaDir, fsImpl);
    writeReferences(userDataPath, safeMediaDir, fsImpl);
    return { mediaDir: safeMediaDir, action: 'initialized-sibling-default' };
  }

  // User-selected custom storage is authoritative. Never silently redirect it,
  // even if it is unavailable right now.
  const installRelative = path.relative(getInstallRoot(executablePath), configuredMediaDir);
  const insideInstall = installRelative === '' || (!installRelative.startsWith(`..${path.sep}`) && installRelative !== '..' && !path.isAbsolute(installRelative));
  if (!insideInstall) {
    return { mediaDir: configuredMediaDir, action: 'kept-configured' };
  }

  // v0.9.9.7 could place media inside the install directory. If the source is
  // still present (for example an incremental update), copy it to an empty
  // sibling directory, verify every file by size + SHA-256, update references,
  // and deliberately leave the original source untouched.
  if (fsImpl.existsSync(configuredMediaDir)) {
    try {
      const destination = chooseEmptyMigrationDestination(executablePath, fsImpl);
      if (typeof onBeforeCopy === 'function') {
        onBeforeCopy({
          sourceDir: configuredMediaDir,
          destinationDir: destination,
          entries: visibleEntries(configuredMediaDir, fsImpl).length,
        });
      }
      const result = copyVulnerableMedia(configuredMediaDir, destination, fsImpl);
      if (!result.copied) {
        return { mediaDir: configuredMediaDir, action: 'vulnerable-copy-deferred', reason: result.reason };
      }
      try {
        writeReferences(userDataPath, destination, fsImpl);
      } catch (error) {
        // 複製成功但「提交新路徑」失敗時，舊 source 與舊設定仍是權威。
        // 清掉這次由本程序建立的 migration destination，避免下次啟動改挑 (2)/(3)
        // 又完整複製一次。destination 在 copyVulnerableMedia 開始前已確認為空。
        safeRemove(destination, { fsImpl });
        throw error;
      }
      return { mediaDir: destination, action: 'copied-from-install-dir', copiedEntries: result.entries };
    } catch (error) {
      // 搬移是資料安全修復，不是主程式啟動的必要條件。source 還存在時，即使磁碟
      // 不足、防毒暫時鎖檔或單檔驗證失敗，也先沿用舊位置讓使用者能開程式；來源
      // 全程未刪除，之後仍可重試。這避免「歌越多→搬移越久/越容易失敗→完全打不開」。
      return {
        mediaDir: configuredMediaDir,
        action: 'vulnerable-copy-failed',
        reason: error?.message || 'unknown media migration error',
        code: error?.code || null,
      };
    }
  }

  // A full Installer upgrade may have had to run the old uninstaller before the
  // new Electron process starts. The fixed installer records exactly where it
  // copied the vulnerable media. Accept only an existing app-marked directory;
  // otherwise keep the stale reference and fail closed rather than inventing a
  // new empty library that would make preserved songs appear lost.
  if (isUsableRecoveryDir(recoveryMediaDir, fsImpl)) {
    writeReferences(userDataPath, recoveryMediaDir, fsImpl);
    return { mediaDir: recoveryMediaDir, action: 'recovered-installer-backup' };
  }

  return { mediaDir: configuredMediaDir, action: 'vulnerable-source-missing' };
}

module.exports = {
  MEDIA_FOLDER_NAME,
  MEDIA_MARKER_NAME,
  RECOVERY_REFERENCE_NAME,
  samePath,
  readConfiguredMediaDir,
  readRecoveryMediaDir,
  getPreferredSiblingMediaDir,
  getVulnerableInstallMediaDir,
  getMacDefaultMediaDir,
  chooseDefaultSiblingMediaDir,
  chooseEmptyMigrationDestination,
  copyVulnerableMedia,
  preparePackagedMediaStorage,
};
