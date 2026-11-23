'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function isEntry(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.issuedAt === 'string'
    && Number.isFinite(Date.parse(value.issuedAt))
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
    return { ok: true, exists: true, entries };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, exists: false, entries: {} };
    return { ok: false, entries: {} };
  }
}

function createPersistentReplayGuard({ file, fsImpl = fs } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError('replay guard requires an absolute file path');
  let available = true;
  let entries = {};

  function merge(other) {
    for (const [key, entry] of Object.entries(other)) {
      const old = entries[key];
      if (!old || Date.parse(entry.issuedAt) > Date.parse(old.issuedAt)) entries[key] = entry;
      else if (entry.issuedAt === old.issuedAt && entry.planId !== old.planId) {
        available = false;
      }
    }
  }

  function reload() {
    const primary = loadEntries(file, fsImpl);
    const backup = loadEntries(`${file}.last-good`, fsImpl);
    // A valid redundant high-water mark can repair a truncated primary. With
    // neither copy readable, keep installation blocked and expose recovery.
    if (!primary.ok && (!backup.ok || !backup.exists)) { available = false; return; }
    if (primary.ok) merge(primary.entries);
    if (backup.ok) merge(backup.entries);
    if (!primary.ok && available) {
      try {
        fsImpl.renameSync(file, `${file}.corrupt-${Date.now()}`);
        persist(file, entries);
      } catch (_) { available = false; }
    }
  }

  function persist(destination, values) {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}`;
    try {
      fsImpl.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries: values }, null, 2)}\n`, 'utf8');
      const fd = fsImpl.openSync(temporary, 'r+');
      try { fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
      fsImpl.renameSync(temporary, destination);
    } finally { try { fsImpl.unlinkSync(temporary); } catch (_) { /* best effort */ } }
  }
  reload();

  function ensureAvailable() {
    if (!available) {
      const error = new Error('update replay guard is unavailable; restore its last-good backup or use the official installer');
      error.code = 'UPDATE_REPLAY_UNAVAILABLE';
      throw error;
    }
  }

  return Object.freeze({
    get(key) {
      reload();
      ensureAvailable();
      const value = entries[key];
      return value ? { ...value } : null;
    },
    set(key, value) {
      reload();
      ensureAvailable();
      if (!/^(stable|beta)\/win32\/x64$/.test(String(key || '')) || !isEntry(value)) throw new Error('invalid replay guard entry');
      const old = entries[key];
      if (old && (Date.parse(value.issuedAt) < Date.parse(old.issuedAt) || (value.issuedAt === old.issuedAt && value.planId !== old.planId))) {
        throw new Error('update replay guard cannot move backwards');
      }
      const next = { ...entries, [key]: { issuedAt: value.issuedAt, planId: value.planId } };
      try {
        persist(`${file}.last-good`, next);
        persist(file, next);
        entries = next;
      } catch (error) {
        available = false;
        throw error;
      }
    },
    isAvailable: () => available,
  });
}

module.exports = { SCHEMA_VERSION, createPersistentReplayGuard };
