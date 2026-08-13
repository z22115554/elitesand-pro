'use strict';

const fs = require('fs');
const path = require('path');

const MEDIA_FOLDER_NAME = 'Elitesand Pro Media';
const MEDIA_MARKER_NAME = '.elitesand-pro-media-root';
const SAFE_MEDIA_FOLDER_NAME = 'downloads';

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
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

function getSafeMediaDir(userDataPath) {
  return path.join(path.resolve(userDataPath), SAFE_MEDIA_FOLDER_NAME);
}

function getVulnerableInstallMediaDir(executablePath) {
  return path.join(path.dirname(path.resolve(executablePath)), MEDIA_FOLDER_NAME);
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
  return destinationStat.isFile() && sourceStat.size === destinationStat.size;
}

function copyVulnerableMedia(sourceDir, destinationDir, fsImpl = fs) {
  const entries = visibleEntries(sourceDir, fsImpl);
  const destinationEntries = visibleEntries(destinationDir, fsImpl);
  if (destinationEntries.length > 0) {
    return { copied: false, reason: 'destination-not-empty', entries: 0 };
  }

  ensureMarker(destinationDir, fsImpl);
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
  return { copied: true, reason: null, entries: entries.length };
}

function preparePackagedMediaStorage({ userDataPath, executablePath, fsImpl = fs } = {}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('preparePackagedMediaStorage requires an absolute userDataPath');
  }
  if (typeof executablePath !== 'string' || !path.isAbsolute(executablePath)) {
    throw new TypeError('preparePackagedMediaStorage requires an absolute executablePath');
  }

  const safeMediaDir = getSafeMediaDir(userDataPath);
  const vulnerableMediaDir = getVulnerableInstallMediaDir(executablePath);
  const configuredMediaDir = readConfiguredMediaDir(userDataPath, fsImpl);

  // New installs and legacy installs without an explicit media setting both use
  // userData/downloads. That directory survives a normal per-user uninstall and
  // is never replaced by electron-builder when the application itself updates.
  if (!configuredMediaDir) {
    ensureMarker(safeMediaDir, fsImpl);
    writeReferences(userDataPath, safeMediaDir, fsImpl);
    return { mediaDir: safeMediaDir, action: 'initialized-safe-default' };
  }

  // Custom storage locations, including migrated external folders, are user
  // choices and must never be silently redirected.
  if (!samePath(configuredMediaDir, vulnerableMediaDir)) {
    return { mediaDir: configuredMediaDir, action: 'kept-configured' };
  }

  // v0.9.9.7 could place media inside the install directory. If that directory
  // still exists, copy (never move/delete) it into the persistent userData area,
  // verify the copy, then switch the configuration. Leaving the source intact
  // keeps rollback/cancel scenarios recoverable.
  if (fsImpl.existsSync(configuredMediaDir)) {
    const result = copyVulnerableMedia(configuredMediaDir, safeMediaDir, fsImpl);
    if (result.copied) {
      writeReferences(userDataPath, safeMediaDir, fsImpl);
      return { mediaDir: safeMediaDir, action: 'copied-from-install-dir', copiedEntries: result.entries };
    }
    return {
      mediaDir: configuredMediaDir,
      action: 'vulnerable-copy-deferred',
      reason: result.reason,
    };
  }

  // The fixed installer performs a pre-uninstall backup of the vulnerable
  // install-root folder. After the old uninstaller removes the source, recover
  // the stale JSON reference only when the persistent destination is clearly
  // app-managed. Never reinterpret an arbitrary missing custom path.
  const safeMarker = path.join(safeMediaDir, MEDIA_MARKER_NAME);
  if (fsImpl.existsSync(safeMarker)) {
    writeReferences(userDataPath, safeMediaDir, fsImpl);
    return { mediaDir: safeMediaDir, action: 'recovered-installer-backup' };
  }

  return { mediaDir: configuredMediaDir, action: 'vulnerable-source-missing' };
}

module.exports = {
  MEDIA_FOLDER_NAME,
  MEDIA_MARKER_NAME,
  SAFE_MEDIA_FOLDER_NAME,
  samePath,
  readConfiguredMediaDir,
  getSafeMediaDir,
  getVulnerableInstallMediaDir,
  copyVulnerableMedia,
  preparePackagedMediaStorage,
};
