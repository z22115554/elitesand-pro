'use strict';

// Media files are deliberately separated from state/logs in packaged Electron
// builds. The current server keeps its path constants for its whole lifetime,
// therefore a successful migration is followed by an Electron restart.
const fs = require('fs');
const path = require('path');
const { projectRoot, dataDir, downloadsDir } = require('../utils/app-paths');

const MEDIA_FOLDER_NAME = 'Elitesand Pro Media';
const MEDIA_MARKER_NAME = '.elitesand-pro-media-root';
const CONFIG_FILE = path.join(dataDir, 'media-storage.json');
const UNINSTALL_REFERENCE_FILE = path.join(path.dirname(dataDir), 'media-storage.ini');

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
  // The picker is allowed to select the final media folder itself. This avoids
  // creating "Elitesand Pro Media\\Elitesand Pro Media" on a retry.
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
  // This small INI is intentionally duplicated outside `data`: NSIS can read
  // it before deleting userData during an explicitly opted-in uninstall.
  writeFileAtomic(UNINSTALL_REFERENCE_FILE, `[media]\npath=${mediaDir}\n`);
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

function migrationSourceCandidates() {
  // Keep recovery automatic: a failed earlier migration can leave the current
  // configured directory missing, while the actual legacy media is still in
  // Electron userData or, during development, the project downloads folder.
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
  if (samePath(sourceDir, destinationDir)) {
    throw new Error('The selected folder is already the current media folder.');
  }
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
    writeConfiguration(destinationDir);
  } catch (error) {
    // The destination is owned by this operation only when its marker exists;
    // leave copied files intact for recovery rather than deleting unknown data.
    throw new Error(`Media copy did not complete: ${error.message}`);
  }

  let oldFilesRemoved = true;
  try {
    for (const name of entries) fs.rmSync(path.join(sourceDir, name), { recursive: true, force: false });
    // A prior managed external folder contains only our marker after a
    // zero-file/custom relocation. Remove that empty app-owned root as well.
    if (fs.existsSync(markerPath(sourceDir)) && visibleEntries(sourceDir).length === 0) {
      fs.rmSync(sourceDir, { recursive: true, force: false });
    }
  } catch (_) {
    oldFilesRemoved = false;
  }
  return { mediaDir: destinationDir, sourceDir, movedEntries: entries.length, oldFilesRemoved };
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
