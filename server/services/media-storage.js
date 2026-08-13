'use strict';

// Media files are deliberately separated from state/logs in packaged Electron
// builds. The current server keeps its path constants for its whole lifetime,
// therefore a successful migration is followed by an Electron restart.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { projectRoot, dataDir, downloadsDir } = require('../utils/app-paths');

const MEDIA_FOLDER_NAME = 'Elitesand Pro Media';
const MEDIA_MARKER_NAME = '.elitesand-pro-media-root';
const CONFIG_FILE = path.join(dataDir, 'media-storage.json');
const MEDIA_REFERENCE_FILE = path.join(path.dirname(dataDir), 'media-storage.ini');

function isSubpath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function resolveDestinationMediaDir(selectedDir) {
  const selected = path.resolve(selectedDir);
  if (path.basename(selected).toLowerCase() === MEDIA_FOLDER_NAME.toLowerCase()) return selected;
  return path.join(selected, MEDIA_FOLDER_NAME);
}

function markerPath(mediaDir) {
  return path.join(mediaDir, MEDIA_MARKER_NAME);
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return typeof parsed?.mediaDir === 'string' && path.isAbsolute(parsed.mediaDir)
      ? { mediaDir: path.resolve(parsed.mediaDir) }
      : null;
  } catch (_) {
    return null;
  }
}

function writeFileAtomic(file, contents) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, contents, 'utf8');
  fs.renameSync(temporary, file);
}

function writeConfiguration(mediaDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  writeFileAtomic(CONFIG_FILE, `${JSON.stringify({ version: 1, mediaDir }, null, 2)}\n`);
  // Duplicated outside data so the Installer can identify a historical media
  // location before replacing an old application. It is only a reference; the
  // Installer and uninstaller are never allowed to delete the referenced data.
  writeFileAtomic(MEDIA_REFERENCE_FILE, `[media]\npath=${mediaDir}\n`);
}

function ensureMarker(mediaDir) {
  fs.mkdirSync(mediaDir, { recursive: true });
  const marker = markerPath(mediaDir);
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, 'Elitesand Pro managed media root\n', 'utf8');
}

function visibleEntries(directory) {
  try {
    return fs.readdirSync(directory).filter((name) => name !== MEDIA_MARKER_NAME);
  } catch (_) {
    return [];
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyCopiedEntry(source, destination) {
  const sourceStat = fs.statSync(source);
  const destinationStat = fs.statSync(destination);
  if (sourceStat.isDirectory()) {
    if (!destinationStat.isDirectory()) return false;
    const sourceNames = fs.readdirSync(source).sort();
    const destinationNames = fs.readdirSync(destination).sort();
    if (sourceNames.length !== destinationNames.length) return false;
    for (let index = 0; index < sourceNames.length; index++) {
      if (sourceNames[index] !== destinationNames[index]) return false;
      if (!verifyCopiedEntry(path.join(source, sourceNames[index]), path.join(destination, destinationNames[index]))) return false;
    }
    return true;
  }
  return destinationStat.isFile()
    && sourceStat.size === destinationStat.size
    && sha256File(source) === sha256File(destination);
}

function migrationSourceCandidates() {
  const candidates = [
    downloadsDir,
    path.join(path.dirname(dataDir), 'downloads'),
    path.join(projectRoot, 'downloads'),
  ].map((directory) => path.resolve(directory));
  return candidates.filter((directory, index) => candidates.findIndex((other) => samePath(directory, other)) === index);
}

function resolveMigrationSource(candidates = migrationSourceCandidates()) {
  for (const directory of candidates) {
    const entries = visibleEntries(directory);
    if (entries.length) return { sourceDir: directory, entries };
  }
  return { sourceDir: null, entries: [] };
}

function status() {
  const configured = readConfig();
  const mediaDirExists = fs.existsSync(downloadsDir);
  const migrationSource = resolveMigrationSource();
  return {
    mediaDir: downloadsDir,
    configured: !!configured,
    managed: fs.existsSync(markerPath(downloadsDir)),
    mediaDirExists,
    mediaEntryCount: mediaDirExists ? visibleEntries(downloadsDir).length : 0,
    migrationSourceDir: migrationSource.sourceDir,
    migrationSourceEntryCount: migrationSource.entries.length,
    legacyMigrationRequired: process.env.ELITESAND_MEDIA_STORAGE_MODE === 'legacy-migration-required',
    folderName: MEDIA_FOLDER_NAME,
  };
}

function migrateToParent(parentDir, sourceOverride = null) {
  if (typeof parentDir !== 'string' || !path.isAbsolute(parentDir)) {
    throw new Error('A valid destination folder is required.');
  }
  if (sourceOverride !== null && (typeof sourceOverride !== 'string' || !path.isAbsolute(sourceOverride))) {
    throw new Error('A valid source media folder is required.');
  }
  const migrationSource = sourceOverride
    ? { sourceDir: path.resolve(sourceOverride), entries: visibleEntries(sourceOverride) }
    : resolveMigrationSource();
  const { sourceDir, entries } = migrationSource;
  if (!entries.length) {
    throw new Error('No media files were found in the recorded media locations. The storage setting was not changed.');
  }
  const destinationDir = resolveDestinationMediaDir(parentDir);
  if (samePath(sourceDir, destinationDir)) throw new Error('The selected folder is already the current media folder.');
  if (isSubpath(sourceDir, destinationDir) || isSubpath(destinationDir, sourceDir)) {
    throw new Error('The destination cannot be inside the source media folder.');
  }
  if (visibleEntries(destinationDir).length) {
    throw new Error('The destination already contains files. Choose an empty location.');
  }

  ensureMarker(destinationDir);
  try {
    for (const name of entries) {
      fs.cpSync(path.join(sourceDir, name), path.join(destinationDir, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    for (const name of entries) {
      if (!verifyCopiedEntry(path.join(sourceDir, name), path.join(destinationDir, name))) {
        throw new Error(`verification failed for ${name}`);
      }
    }
    // Only after every file passes size + SHA-256 verification may the active
    // storage reference change. The source copy is intentionally retained: a
    // storage-location change must never destroy the user's previous library.
    writeConfiguration(destinationDir);
  } catch (error) {
    // Keep source and any partial destination intact for manual recovery.
    throw new Error(`Media copy did not complete safely: ${error.message}`);
  }

  return {
    mediaDir: destinationDir,
    sourceDir,
    movedEntries: entries.length,
    oldFilesRemoved: false,
    sourceRetained: true,
  };
}

module.exports = {
  MEDIA_FOLDER_NAME,
  MEDIA_MARKER_NAME,
  resolveDestinationMediaDir,
  resolveMigrationSource,
  readConfig,
  ensureMarker,
  writeConfiguration,
  status,
  migrateToParent,
};
