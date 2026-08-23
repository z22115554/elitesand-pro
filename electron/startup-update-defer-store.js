'use strict';

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'startup-update-defers-v1.json';

function isVersion(value) {
  return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function readEntries(file, fsImpl) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    if (parsed?.schemaVersion !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) return {};
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
  return Object.freeze({
    getDeferUntil(targetVersion) {
      if (!isVersion(targetVersion)) return null;
      return readEntries(file, fsImpl)[targetVersion] || null;
    },
    setDeferUntil(targetVersion, until) {
      if (!isVersion(targetVersion) || !Number.isFinite(until) || until <= 0) return false;
      const entries = readEntries(file, fsImpl);
      entries[targetVersion] = Math.floor(until);
      try {
        fsImpl.mkdirSync(root, { recursive: true });
        fsImpl.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`, 'utf8');
        return true;
      } catch (_) {
        return false;
      }
    },
  });
}

module.exports = { FILE_NAME, createStartupUpdateDeferStore };
