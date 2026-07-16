'use strict';

// Tracks only temporary files created by an active Elitesand Pro import. Startup
// cleanup deliberately ignores untracked files so user-owned downloads survive.
const fs = require('fs');
const path = require('path');
const { createJsonStore } = require('./json-store');
const { dataDir: defaultDataDir } = require('../utils/app-paths');

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const ORPHAN_TEMP_EXTENSIONS = new Set(['.part', '.webm', '.m4a', '.opus', '.temp']);

function isValidVideoId(value) {
  return typeof value === 'string' && VIDEO_ID_RE.test(value);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but this account cannot inspect it. Keep it.
    return error?.code === 'EPERM';
  }
}

function isValidEntry(videoId, entry) {
  return !!entry
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && entry.videoId === videoId
    && isValidVideoId(videoId)
    && Number.isInteger(entry.ownerPid)
    && entry.ownerPid > 0
    && Number.isFinite(entry.startedAt)
    && typeof entry.token === 'string'
    && entry.token.length >= 8;
}

function createImportTempRegistry({
  dataDir = defaultDataDir,
  pid = process.pid,
  now = () => Date.now(),
  processAlive = isProcessAlive,
} = {}) {
  const store = createJsonStore({
    file: path.join(dataDir, 'import-temp-registry.json'),
    label: 'import temporary registry',
    defaultValue: () => ({}),
    migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, entries: legacy?.entries || legacy || {} })]]),
    serialize: (entries) => ({ entries }),
    deserialize: (document) => document.entries,
    validate: (document) => document.entries
      && typeof document.entries === 'object'
      && !Array.isArray(document.entries)
      && Object.entries(document.entries).every(([videoId, entry]) => isValidEntry(videoId, entry)),
  });
  let entries = store.load() || {};

  function save() {
    return store.save(entries);
  }

  function begin(videoId) {
    if (!isValidVideoId(videoId) || !Number.isInteger(pid) || pid <= 0) return null;
    const entry = {
      videoId,
      ownerPid: pid,
      startedAt: now(),
      token: `${pid}-${now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
    entries[videoId] = entry;
    save();
    return entry;
  }

  // A retry can replace an earlier attempt for the same video. Only the owner of
  // the current token may clear its entry.
  function finish(entry) {
    if (!entry || !isValidEntry(entry.videoId, entry)) return false;
    if (entries[entry.videoId]?.token !== entry.token) return false;
    delete entries[entry.videoId];
    return save();
  }

  function cleanupOrphans(downloadsDir) {
    const result = { removedFiles: [], clearedEntries: 0, skippedActive: 0 };
    let fileNames = [];
    try { fileNames = fs.readdirSync(downloadsDir); } catch (_) { /* no directory is already clean */ }

    let changed = false;
    for (const [videoId, entry] of Object.entries(entries)) {
      if (!isValidEntry(videoId, entry)) {
        delete entries[videoId];
        changed = true;
        result.clearedEntries++;
        continue;
      }
      if (processAlive(entry.ownerPid)) {
        result.skippedActive++;
        continue;
      }

      const prefix = `${videoId}.`;
      for (const name of fileNames) {
        if (!name.startsWith(prefix) || !ORPHAN_TEMP_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
        const candidate = path.join(downloadsDir, name);
        try {
          // Do not follow symlinks or remove a directory that happens to match.
          if (!fs.lstatSync(candidate).isFile()) continue;
          fs.unlinkSync(candidate);
          result.removedFiles.push(name);
        } catch (_) { /* best effort, with no destructive fallback */ }
      }
      delete entries[videoId];
      changed = true;
      result.clearedEntries++;
    }
    if (changed) save();
    return result;
  }

  return { begin, finish, cleanupOrphans, getEntries: () => ({ ...entries }), store };
}

const registry = createImportTempRegistry();

module.exports = {
  ...registry,
  createImportTempRegistry,
  isProcessAlive,
  isValidVideoId,
  ORPHAN_TEMP_EXTENSIONS,
};
