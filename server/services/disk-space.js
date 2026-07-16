'use strict';

const fs = require('fs');
const path = require('path');

// This is intentionally a warning, not a block. Lossless audio conversion can
// briefly need more room than the final file, while the existing ENOSPC path
// remains the authoritative failure recovery if space runs out mid-import.
const LOW_DISK_WARNING_BYTES = 500 * 1024 * 1024;

function toPositiveBigInt(value) {
  try {
    if (typeof value === 'bigint') return value > 0n ? value : 0n;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0n;
    return BigInt(Math.floor(numeric));
  } catch (_) {
    return 0n;
  }
}

function toSafeByteNumber(value) {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maximum ? maximum : value);
}

function nearestExistingPath(directory, existsSync = fs.existsSync) {
  let current = path.resolve(directory);
  while (current && current !== path.dirname(current)) {
    if (existsSync(current)) return current;
    current = path.dirname(current);
  }
  return existsSync(current) ? current : '';
}

function inspectDiskSpace(directory, options = {}) {
  const thresholdBytes = Number.isFinite(options.thresholdBytes)
    ? Math.max(0, Math.floor(options.thresholdBytes))
    : LOW_DISK_WARNING_BYTES;
  const statfsSync = options.statfsSync || fs.statfsSync;
  const existsSync = options.existsSync || fs.existsSync;
  const result = { known: false, freeBytes: null, thresholdBytes, low: false };

  if (typeof statfsSync !== 'function') return result;
  try {
    const target = nearestExistingPath(directory, existsSync);
    if (!target) return result;
    const stats = statfsSync(target);
    const availableBlocks = toPositiveBigInt(stats?.bavail);
    const blockSize = toPositiveBigInt(stats?.bsize || stats?.frsize);
    if (!availableBlocks || !blockSize) return result;
    const freeBytes = toSafeByteNumber(availableBlocks * blockSize);
    return {
      known: true,
      freeBytes,
      thresholdBytes,
      low: freeBytes < thresholdBytes,
    };
  } catch (_) {
    // A platform that cannot report filesystem statistics must not prevent a
    // creator from importing a song. The real download still maps ENOSPC to a
    // recoverable, user-facing error.
    return result;
  }
}

function formatMegabytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
  return value < 100 ? value.toFixed(1) : String(Math.round(value));
}

function appendDiskSpaceWarning(assessment = {}, diskSpace) {
  const warningTypes = Array.isArray(assessment.warningTypes) ? [...assessment.warningTypes] : [];
  const warnings = Array.isArray(assessment.warnings) ? [...assessment.warnings] : [];
  const result = { ...assessment, warningTypes, warnings, diskSpace: diskSpace || null };

  if (!diskSpace?.known || !diskSpace.low || warningTypes.includes('disk-space')) {
    result.warning = warningTypes.length > 0;
    return result;
  }

  warningTypes.push('disk-space');
  warnings.push(`目前可用磁碟空間約 ${formatMegabytes(diskSpace.freeBytes)} MB，低於建議的 500 MB；匯入時請留意空間，避免下載中斷。`);
  result.warning = true;
  return result;
}

module.exports = {
  LOW_DISK_WARNING_BYTES,
  nearestExistingPath,
  inspectDiskSpace,
  appendDiskSpaceWarning,
};
