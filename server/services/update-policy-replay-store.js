'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function isEntry(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.issuedAt === 'string'
    && typeof value.planId === 'string';
}

function loadEntries(file, fsImpl) {
  try {
    const raw = fsImpl.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
      throw new Error('schema');
    }
    const entries = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (!/^(stable|beta)\/win32\/x64$/.test(key) || !isEntry(value)) throw new Error('entry');
      entries[key] = { issuedAt: value.issuedAt, planId: value.planId };
    }
    return { ok: true, entries };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, entries: {} };
    return { ok: false, entries: {} };
  }
}

function createPersistentReplayGuard({ file, fsImpl = fs } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError('replay guard requires an absolute file path');
  const loaded = loadEntries(file, fsImpl);
  let available = loaded.ok;
  let entries = loaded.entries;

  function ensureAvailable() {
    if (!available) throw new Error('update replay guard is unavailable');
  }

  return Object.freeze({
    get(key) {
      ensureAvailable();
      const value = entries[key];
      return value ? { ...value } : null;
    },
    set(key, value) {
      ensureAvailable();
      if (!/^(stable|beta)\/win32\/x64$/.test(String(key || '')) || !isEntry(value)) throw new Error('invalid replay guard entry');
      const next = { ...entries, [key]: { issuedAt: value.issuedAt, planId: value.planId } };
      const directory = path.dirname(file);
      const temporary = `${file}.tmp`;
      try {
        fsImpl.mkdirSync(directory, { recursive: true });
        fsImpl.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries: next }, null, 2)}\n`, 'utf8');
        fsImpl.renameSync(temporary, file);
        entries = next;
      } catch (error) {
        try { fsImpl.unlinkSync(temporary); } catch (_) { /* best effort */ }
        available = false;
        throw error;
      }
    },
    isAvailable: () => available,
  });
}

module.exports = { SCHEMA_VERSION, createPersistentReplayGuard };
