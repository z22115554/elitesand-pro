'use strict';

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'startup-update-defers-v1.json';
// v1 persisted an implicit seven-day delay for Later. Those deadlines must
// not suppress the first prompt after upgrading to the explicit choices.
const SCHEMA_VERSION = 2;

function isVersion(value) {
  return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function readEntries(file, fsImpl) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    if (parsed?.schemaVersion !== SCHEMA_VERSION || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) return {};
    return Object.fromEntries(Object.entries(parsed.entries)
      .filter(([version, value]) => isVersion(version) && Number.isFinite(value) && value > 0));
  } catch (_) {
    return {};
  }
}

function createStartupUpdateDeferStore(userDataPath, { fsImpl = fs } = {}) {
  const rawPath = String(userDataPath || '').trim();
  if (!rawPath) throw new TypeError('a scoped Electron userData path is required');
  const root = path.resolve(rawPath);
  if (root === path.parse(root).root) throw new TypeError('a scoped Electron userData path is required');
  const file = path.join(root, FILE_NAME);
  function writeEntries(entries) {
    try {
      fsImpl.mkdirSync(root, { recursive: true });
      fsImpl.writeFileSync(file, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries }, null, 2)}\n`, 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }
  return Object.freeze({
    getDeferUntil(targetVersion) {
      if (!isVersion(targetVersion)) return null;
      return readEntries(file, fsImpl)[targetVersion] || null;
    },
    setDeferUntil(targetVersion, until) {
      if (!isVersion(targetVersion) || !Number.isFinite(until) || until <= 0) return false;
      const entries = readEntries(file, fsImpl);
      entries[targetVersion] = Math.floor(until);
      return writeEntries(entries);
    },
    clearDefer(targetVersion) {
      if (!isVersion(targetVersion)) return false;
      const entries = readEntries(file, fsImpl);
      delete entries[targetVersion];
      return writeEntries(entries);
    },
  });
}

module.exports = { FILE_NAME, SCHEMA_VERSION, createStartupUpdateDeferStore };
