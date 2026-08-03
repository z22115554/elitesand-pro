'use strict';

// Media files are deliberately separated from state/logs in packaged Electron
// builds. The current server keeps its path constants for its whole lifetime,
// therefore a successful migration is followed by an Electron restart.
const fs = require('fs');
const path = require('path');
const { dataDir, downloadsDir } = require('../utils/app-paths');

const MEDIA_FOLDER_NAME = 'Elitesand Pro Media';
const MEDIA_MARKER_NAME = '.elitesand-pro-media-root';
const CONFIG_FILE = path.join(dataDir, 'media-storage.json');
const UNINSTALL_REFERENCE_FILE = path.join(path.dirname(dataDir), 'media-storage.ini');

function isSubpath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

function status() {
  const configured = readConfig();
  return {
    mediaDir: downloadsDir,
    configured: !!configured,
    managed: fs.existsSync(markerPath(downloadsDir)),
    legacyMigrationRequired: process.env.ELITESAND_MEDIA_STORAGE_MODE === 'legacy-migration-required',
    folderName: MEDIA_FOLDER_NAME,
  };
}

function migrateToParent(parentDir) {
  if (typeof parentDir !== 'string' || !path.isAbsolute(parentDir)) {
    throw new Error('A valid destination folder is required.');
  }
  const sourceDir = path.resolve(downloadsDir);
  const destinationParent = path.resolve(parentDir);
  const destinationDir = path.join(destinationParent, MEDIA_FOLDER_NAME);
  if (isSubpath(sourceDir, destinationDir) || isSubpath(destinationDir, sourceDir)) {
    throw new Error('The destination cannot be inside the current media folder.');
  }
  if (visibleEntries(destinationDir).length) {
    throw new Error('The destination already contains files. Choose an empty location.');
  }

  fs.mkdirSync(destinationParent, { recursive: true });
  ensureMarker(destinationDir);
  const entries = visibleEntries(sourceDir);
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
  return { mediaDir: destinationDir, movedEntries: entries.length, oldFilesRemoved };
}

module.exports = {
  MEDIA_FOLDER_NAME,
  MEDIA_MARKER_NAME,
  readConfig,
  ensureMarker,
  writeConfiguration,
  status,
  migrateToParent,
};
