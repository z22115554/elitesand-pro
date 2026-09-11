'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TRUST_SCHEMA_VERSION = 1;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/;

function normalizeHash(value) {
  const text = String(value || '').trim().toLowerCase();
  return SHA256_RE.test(text) ? text : null;
}

function normalizeVersion(value) {
  const match = String(value || '').trim().match(/\d{4}\.\d{2}\.\d{2}(?:\.\d+)?/);
  return match && VERSION_RE.test(match[0]) ? match[0] : null;
}

function compareVersions(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  if (!left || !right) return null;
  const pa = left.split('.').map((part) => Number.parseInt(part, 10));
  const pb = right.split('.').map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function hashFileSync(file, fsImpl = fs) {
  return crypto.createHash('sha256').update(fsImpl.readFileSync(file)).digest('hex');
}

function readTrustState(file, fsImpl = fs) {
  try {
    const value = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    if (!value || value.schemaVersion !== TRUST_SCHEMA_VERSION) return null;
    const runtimeHash = normalizeHash(value.runtimeHash);
    const seedHash = normalizeHash(value.seedHash);
    if (!runtimeHash || !seedHash) return null;
    const runtimeVersion = value.runtimeVersion == null ? null : normalizeVersion(value.runtimeVersion);
    const seedVersion = value.seedVersion == null ? null : normalizeVersion(value.seedVersion);
    if (value.runtimeVersion != null && !runtimeVersion) return null;
    if (value.seedVersion != null && !seedVersion) return null;
    if (!['seed', 'official-update'].includes(value.provenance)) return null;
    return {
      schemaVersion: TRUST_SCHEMA_VERSION,
      runtimeHash,
      runtimeVersion,
      seedHash,
      seedVersion,
      provenance: value.provenance,
      updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    };
  } catch (_) {
    return null;
  }
}

function writeTrustStateAtomic(file, value, fsImpl = fs) {
  const directory = path.dirname(file);
  const temporary = `${file}.tmp`;
  const payload = {
    schemaVersion: TRUST_SCHEMA_VERSION,
    runtimeHash: normalizeHash(value.runtimeHash),
    runtimeVersion: value.runtimeVersion == null ? null : normalizeVersion(value.runtimeVersion),
    seedHash: normalizeHash(value.seedHash),
    seedVersion: value.seedVersion == null ? null : normalizeVersion(value.seedVersion),
    provenance: value.provenance === 'official-update' ? 'official-update' : 'seed',
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
  if (!payload.runtimeHash || !payload.seedHash) throw new Error('yt-dlp trust state requires valid SHA-256 hashes');
  if (value.runtimeVersion != null && !payload.runtimeVersion) throw new Error('yt-dlp runtime version is invalid');
  if (value.seedVersion != null && !payload.seedVersion) throw new Error('yt-dlp seed version is invalid');
  fsImpl.mkdirSync(directory, { recursive: true });
  try { fsImpl.unlinkSync(temporary); } catch (_) { /* stale temp is app-owned */ }
  fsImpl.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fsImpl.renameSync(temporary, file);
  return payload;
}

module.exports = {
  TRUST_SCHEMA_VERSION,
  normalizeHash,
  normalizeVersion,
  compareVersions,
  hashFileSync,
  readTrustState,
  writeTrustStateAtomic,
};
