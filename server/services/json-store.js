'use strict';

/**
 * 小型 JSON store 基座：schemaVersion、逐版遷移、原子寫入、last-good、
 * corrupt/pre-migration 保全與未來版本拒寫。
 *
 * 業務模組仍負責資料語義、淘汰與 debounce；這裡只統一磁碟可靠性。
 */

const fs = require('fs');
const path = require('path');

class JsonStoreSchemaError extends Error {
  constructor(message, code = 'INVALID_JSON_STORE_SCHEMA') {
    super(message);
    this.name = 'JsonStoreSchemaError';
    this.code = code;
  }
}

class JsonStoreFutureSchemaError extends JsonStoreSchemaError {
  constructor(version, currentVersion) {
    super(`schemaVersion ${version} 高於目前支援的 ${currentVersion}`, 'JSON_STORE_SCHEMA_TOO_NEW');
    this.name = 'JsonStoreFutureSchemaError';
    this.version = version;
    this.currentVersion = currentVersion;
  }
}

class JsonStoreMigrationPersistError extends Error {
  constructor(candidate, cause) {
    super(`Failed to persist migrated JSON store ${path.basename(candidate)}: ${cause.message}`);
    this.name = 'JsonStoreMigrationPersistError';
    this.code = 'JSON_STORE_MIGRATION_PERSIST_FAILED';
    this.candidate = candidate;
    this.cause = cause;
  }
}

function versionOf(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return 0;
  if (!Object.prototype.hasOwnProperty.call(document, 'schemaVersion')) return 0;
  if (!Number.isInteger(document.schemaVersion) || document.schemaVersion < 0) {
    throw new JsonStoreSchemaError('schemaVersion 必須是非負整數');
  }
  return document.schemaVersion;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function uniquePath(base) {
  let candidate = base;
  let suffix = 1;
  while (fs.existsSync(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function atomicWrite(file, value, { pretty = false, mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  const raw = JSON.stringify(value, null, pretty ? 2 : 0);
  try {
    fs.writeFileSync(temporary, raw, { encoding: 'utf8', ...(mode ? { mode } : {}) });
    fs.renameSync(temporary, file);
    if (mode) {
      try { fs.chmodSync(file, mode); } catch (_) { /* Windows 可忽略 */ }
    }
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) { /* best effort */ }
  }
}

function createJsonStore(options) {
  const {
    file,
    label = path.basename(file),
    schemaVersion = 1,
    migrations = new Map(),
    serialize = (value) => value,
    deserialize = (document) => document,
    validate = () => true,
    defaultValue = null,
    pretty = false,
    mode,
    logger,
    onError,
  } = options;
  if (!file) throw new Error('json-store 需要 file');

  const lastGoodFile = `${file}.last-good`;
  let writeBlockReason = null;

  function fallback() {
    const value = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function report(message, type = 'warning') {
    logger?.warn?.(message);
    onError?.({ area: label, message, type });
  }

  function migrate(document) {
    const fromVersion = versionOf(document);
    if (fromVersion > schemaVersion) throw new JsonStoreFutureSchemaError(fromVersion, schemaVersion);
    let current = document;
    let version = fromVersion;
    while (version < schemaVersion) {
      const migration = migrations.get(version);
      if (typeof migration !== 'function') throw new JsonStoreSchemaError(`缺少 v${version}→v${version + 1} 遷移`);
      current = migration(current);
      const nextVersion = versionOf(current);
      if (nextVersion !== version + 1) throw new JsonStoreSchemaError(`v${version} 遷移沒有產生 v${version + 1}`);
      version = nextVersion;
    }
    if (!current || typeof current !== 'object' || Array.isArray(current) || validate(current) !== true) {
      throw new JsonStoreSchemaError('資料結構驗證失敗');
    }
    return { document: current, fromVersion, migrated: fromVersion !== version };
  }

  function preserve(fileToPreserve, kind, fromVersion = null) {
    if (!fs.existsSync(fileToPreserve)) return null;
    const versionPart = fromVersion === null ? '' : `-v${fromVersion}`;
    const destination = uniquePath(`${fileToPreserve}.${kind}${versionPart}-${timestamp()}`);
    if (kind === 'pre-migration') fs.copyFileSync(fileToPreserve, destination, fs.constants.COPYFILE_EXCL);
    else fs.renameSync(fileToPreserve, destination);
    return destination;
  }

  function readCandidate(candidate) {
    const raw = fs.readFileSync(candidate, 'utf8');
    const result = migrate(JSON.parse(raw));
    if (result.migrated) {
      let preserved;
      try {
        preserved = preserve(candidate, 'pre-migration', result.fromVersion);
        atomicWrite(candidate, result.document, { pretty, mode });
      } catch (error) {
        throw new JsonStoreMigrationPersistError(candidate, error);
      }
      logger?.info?.(`${path.basename(candidate)} 已遷移至 schema v${schemaVersion}；原檔保留為 ${path.basename(preserved)}`);
    }
    return result.document;
  }

  function blockFuture(error, candidate) {
    writeBlockReason = `${path.basename(candidate)} 由較新版本建立（schemaVersion ${error.version}），目前只支援到 ${schemaVersion}`;
    report(`${writeBlockReason}；已保持原檔並停止寫入，請改用較新版本。`, 'error');
  }

  function recoverFromLastGood(reason) {
    if (!fs.existsSync(lastGoodFile)) return fallback();
    try {
      const document = readCandidate(lastGoodFile);
      atomicWrite(file, document, { pretty, mode });
      report(`${reason}，已從最近可用備份恢復。`);
      return deserialize(document);
    } catch (error) {
      if (error instanceof JsonStoreFutureSchemaError) {
        blockFuture(error, lastGoodFile);
        return fallback();
      }
      if (error instanceof JsonStoreMigrationPersistError) {
        writeBlockReason = error.message;
        report(`${writeBlockReason}; writes are disabled to preserve the original data.`, 'error');
        return fallback();
      }
      let preserved = null;
      try { preserved = preserve(lastGoodFile, 'corrupt'); } catch (_) { /* 保留原位 */ }
      report(`${reason}，最近可用備份也無法載入${preserved ? `；已保留為 ${path.basename(preserved)}` : ''}。`, 'error');
      return fallback();
    }
  }

  function load() {
    writeBlockReason = null;
    if (!fs.existsSync(file)) return recoverFromLastGood(`${label} 主檔不存在`);
    try {
      const document = readCandidate(file);
      atomicWrite(lastGoodFile, document, { pretty, mode });
      return deserialize(document);
    } catch (error) {
      if (error instanceof JsonStoreFutureSchemaError) {
        blockFuture(error, file);
        return fallback();
      }
      if (error instanceof JsonStoreMigrationPersistError) {
        writeBlockReason = error.message;
        report(`${writeBlockReason}; writes are disabled to preserve the original data.`, 'error');
        return fallback();
      }
      let preserved = null;
      try { preserved = preserve(file, 'corrupt'); } catch (preserveError) {
        writeBlockReason = `${label} 無法安全保留損壞檔：${preserveError.message}`;
        report(`${writeBlockReason}；已停止寫入。`, 'error');
        return fallback();
      }
      return recoverFromLastGood(`${label} 無法載入${preserved ? `；原檔已保留為 ${path.basename(preserved)}` : ''}`);
    }
  }

  function save(value) {
    if (writeBlockReason) {
      report(`${writeBlockReason}；已拒絕寫入。`, 'error');
      return false;
    }
    try {
      let document = serialize(value);
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new JsonStoreSchemaError('serialize 必須回傳物件');
      }
      document = { ...document, schemaVersion };
      if (validate(document) !== true) throw new JsonStoreSchemaError('寫入資料結構驗證失敗');
      atomicWrite(file, document, { pretty, mode });
      atomicWrite(lastGoodFile, document, { pretty, mode });
      return true;
    } catch (error) {
      report(`${label} 寫入失敗：${error.message}`, 'error');
      return false;
    }
  }

  function remove() {
    if (writeBlockReason) {
      report(`${writeBlockReason}；已拒絕刪除。`, 'error');
      return false;
    }
    try {
      for (const candidate of [file, lastGoodFile]) if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
      return true;
    } catch (error) {
      report(`${label} 刪除失敗：${error.message}`, 'error');
      return false;
    }
  }

  return {
    file,
    lastGoodFile,
    load,
    save,
    remove,
    getStatus: () => ({ writeBlocked: !!writeBlockReason, reason: writeBlockReason, schemaVersion }),
  };
}

module.exports = {
  JsonStoreSchemaError,
  JsonStoreFutureSchemaError,
  JsonStoreMigrationPersistError,
  atomicWrite,
  createJsonStore,
  versionOf,
};
