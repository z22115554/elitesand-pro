'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

function isUsableRecoveryDir(directory, fsImpl = fs) {
  return !!directory && fsImpl.existsSync(directory) && hasMarker(directory, fsImpl);
}

function preparePackagedMediaStorage({ userDataPath, executablePath, fsImpl = fs } = {}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('preparePackagedMediaStorage requires an absolute userDataPath');
  }
  if (typeof executablePath !== 'string' || !path.isAbsolute(executablePath)) {
    throw new TypeError('preparePackagedMediaStorage requires an absolute executablePath');
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
  if (!samePath(configuredMediaDir, vulnerableMediaDir)) {
    return { mediaDir: configuredMediaDir, action: 'kept-configured' };
  }

  // v0.9.9.7 could place media inside the install directory. If the source is
  // still present (for example an incremental update), copy it to an empty
  // sibling directory, verify every file by size + SHA-256, update references,
  // and deliberately leave the original source untouched.
  if (fsImpl.existsSync(configuredMediaDir)) {
    const destination = chooseEmptyMigrationDestination(executablePath, fsImpl);
    const result = copyVulnerableMedia(configuredMediaDir, destination, fsImpl);
    if (!result.copied) {
      return { mediaDir: configuredMediaDir, action: 'vulnerable-copy-deferred', reason: result.reason };
    }
    writeReferences(userDataPath, destination, fsImpl);
    return { mediaDir: destination, action: 'copied-from-install-dir', copiedEntries: result.entries };
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
  chooseDefaultSiblingMediaDir,
  chooseEmptyMigrationDestination,
  copyVulnerableMedia,
  preparePackagedMediaStorage,
};
