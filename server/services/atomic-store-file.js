'use strict';

// Shared disk policy. Stores retain their schemas, debounce and conflict rules.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function flushDirectory(directory) {
  // Windows does not consistently allow opening/fsyncing a directory.
  try {
    const fd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (_) { /* best effort metadata flush */ }
}

function prepareFile(file, raw, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, raw, { encoding: 'utf8', flag: 'wx', ...(mode ? { mode } : {}) });
    const fd = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return temporary;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      try { fs.unlinkSync(temporary); } catch (_) { /* preserve original failure */ }
    }
    throw error;
  }
}

function commitFile(temporary, file, { mode } = {}) {
  fs.renameSync(temporary, file);
  if (mode) {
    try { fs.chmodSync(file, mode); } catch (_) { /* Windows may reject chmod */ }
  }
  flushDirectory(path.dirname(file));
}

function atomicWriteRaw(file, raw, options = {}) {
  const temporary = prepareFile(file, raw, options);
  try { commitFile(temporary, file, options); }
  finally {
    try { fs.unlinkSync(temporary); } catch (_) { /* already committed */ }
  }
}

function saveWithBackup(file, raw, { backupFile = `${file}.last-good`, retainPreviousBackup = true, ...options } = {}) {
  // Prepare and flush new bytes BEFORE moving the old generation. ENOSPC must
  // not remove a readable primary. Rotation does not read/re-serialize it.
  const temporary = prepareFile(file, raw, options);
  try {
    if (retainPreviousBackup && fs.existsSync(file)) {
      fs.renameSync(file, backupFile);
      flushDirectory(path.dirname(file));
    } else if (!retainPreviousBackup || !fs.existsSync(backupFile)) {
      // Privacy-sensitive histories deliberately mirror the new generation:
      // restoring an older backup must not resurrect deleted records.
      atomicWriteRaw(backupFile, raw, options);
    }
    commitFile(temporary, file, options);
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) { /* already committed */ }
  }
}

module.exports = { atomicWriteRaw, saveWithBackup, flushDirectory };
