/**
 * 狀態持久化（data/state.json）
 *
 * 重啟伺服器後自動還原：
 * - 播放清單
 * - 顯示設定（風格、顯示模式、前奏倒數）
 * - 每首歌的時間偏移
 * - 手動貼上的歌詞
 *
 * 刻意不還原：當前歌曲 / 播放進度 / 播放中狀態
 * （重啟後音訊本來就不在播放，還原這些只會造成介面與實際狀態不一致）
 *
 * 設計原則：
 * - 延遲寫入（800ms debounce），播放中高頻事件不會造成磁碟壓力
 * - 先寫暫存檔再改名（原子寫入），中途斷電不會損毀狀態檔
 * - 任何讀寫錯誤都不打斷直播，但會通知控制台，避免使用者誤以為已保存
 *
 * 為什麼不用 services/json-store.js 基座：state.json 多了三件其他 store 沒有的事——
 * debounce 快照、多伺服器 savedAt 衝突偵測（含靜默期接管）、啟動警示延遲投遞。
 * 硬塞進基座會讓兩邊都變複雜，所以原子寫入/corrupt/pre-migration 邏輯刻意在此獨立一份；
 * 若改動備份/保全策略，記得 json-store.js 與本檔要一起看。
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const {
  CURRENT_STATE_SCHEMA_VERSION,
  UnsupportedStateSchemaError,
  migrateState,
} = require('./state-migrations');

const log = createLogger('StateStore');

const { dataDir: DATA_DIR } = require('../utils/data-dir');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const STATE_BACKUP_FILE = path.join(DATA_DIR, 'state.json.last-good');
let _lastKnownSavedAt = 0;
let _errorReporter = null;
let _startupAlert = null;
let _writeBlockReason = null;

// 手動歌詞單筆與總量保護（避免 state.json 無限膨脹）
const MAX_MANUAL_LYRICS_ENTRIES = 200;

let _saveTimer = null;
let _lastSnapshotFn = null;
let _saveCallbacks = [];

// 多伺服器衝突的「靜默期接管」：偵測到磁碟上有更新的 savedAt（另一個伺服器在寫）時
// 先拒寫保護對方；但若同一個較新值連續 TAKEOVER_QUIET_MS 沒再前進（對方已關閉/停寫），
// 就備份對方最後狀態後接管，恢復本程序的保存能力。沒有這段的話，本程序會永久拒寫
// 直到重啟（audit G-13），使用者之後的所有設定變更都靜默不落地。
const TAKEOVER_QUIET_MS = Number(process.env.ELITESAND_TAKEOVER_QUIET_MS) > 0
  ? Number(process.env.ELITESAND_TAKEOVER_QUIET_MS)
  : 15 * 1000;
let _conflict = null; // { savedAt, firstSeenAt }

function conflictBackupPathFor(filename, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const base = `${filename}.conflict-${stamp}`;
  let candidate = base;
  let suffix = 1;
  while (fs.existsSync(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function parseState(raw, filename) {
  const state = JSON.parse(raw);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`${path.basename(filename)} 內容不是有效的狀態物件`);
  }
  return state;
}

function readStateFile(filename) {
  return parseState(fs.readFileSync(filename, 'utf8'), filename);
}

function readMigratedStateFile(filename) {
  return migrateState(readStateFile(filename));
}

function atomicWrite(filename, raw) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, raw, 'utf8');
    fs.renameSync(temporary, filename);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) { /* best effort */ }
  }
}

function corruptPathFor(filename, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const base = `${filename}.corrupt-${stamp}`;
  let candidate = base;
  let suffix = 1;
  while (fs.existsSync(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

// 每類保全檔只留最新幾份（與 json-store 同策略），避免反覆事故時無限累積。
const MAX_PRESERVED_PER_KIND = 5;
function prunePreserved(filename, kind) {
  try {
    const dir = path.dirname(filename);
    const prefix = `${path.basename(filename)}.${kind}`;
    const siblings = fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort();
    for (const name of siblings.slice(0, Math.max(0, siblings.length - MAX_PRESERVED_PER_KIND))) {
      try { fs.unlinkSync(path.join(dir, name)); } catch (_) { /* best effort */ }
    }
  } catch (_) { /* best effort */ }
}

function preserveCorruptFile(filename) {
  if (!fs.existsSync(filename)) return null;
  const preserved = corruptPathFor(filename);
  fs.renameSync(filename, preserved);
  prunePreserved(filename, 'corrupt');
  return preserved;
}

function migrationBackupPathFor(filename, fromVersion, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const base = `${filename}.pre-migration-v${fromVersion}-${stamp}`;
  let candidate = base;
  let suffix = 1;
  while (fs.existsSync(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function preservePreMigrationFile(filename, fromVersion) {
  const preserved = migrationBackupPathFor(filename, fromVersion);
  fs.copyFileSync(filename, preserved, fs.constants.COPYFILE_EXCL);
  prunePreserved(filename, 'pre-migration');
  return preserved;
}

function setStartupAlert(message, type = 'warning') {
  _startupAlert = { type, area: '狀態恢復', message };
  if (_errorReporter) _errorReporter(_startupAlert);
}

function refreshLastGood(state) {
  atomicWrite(STATE_BACKUP_FILE, JSON.stringify(state));
}

function blockWritesForFutureSchema(error, filename = STATE_FILE) {
  _writeBlockReason = `${path.basename(filename)} 由較新版本的 Elitesand Pro 建立（schemaVersion ${error.version}），目前版本只支援到 ${CURRENT_STATE_SCHEMA_VERSION}`;
  setStartupAlert(`${_writeBlockReason}。為避免降版覆蓋，檔案保持原樣且已停止狀態寫入；請改用較新版本啟動。`, 'error');
  log.warn(_writeBlockReason);
}

function migrationPersistenceError(filename, error) {
  const wrapped = new Error(`${path.basename(filename)} 遷移前無法安全保留原檔或寫入新格式：${error.message}`);
  wrapped.code = 'STATE_MIGRATION_PERSIST_FAILED';
  return wrapped;
}

function persistMigration(filename, result) {
  if (!result.migrated) return null;
  try {
    const preserved = preservePreMigrationFile(filename, result.fromVersion);
    atomicWrite(filename, JSON.stringify(result.state));
    log.info(`${path.basename(filename)} 已由 schema v${result.fromVersion} 遷移至 v${result.toVersion}；原檔保留為 ${path.basename(preserved)}`);
    return preserved;
  } catch (error) {
    throw migrationPersistenceError(filename, error);
  }
}

function blockWritesForMigrationFailure(error) {
  _writeBlockReason = error.message;
  setStartupAlert(`${error.message}。為避免資料遺失，原檔保持不變且已停止狀態寫入；請檢查磁碟空間或資料夾權限後重新啟動。`, 'error');
  log.warn(_writeBlockReason);
}

function recoverMissingPrimaryFromBackup() {
  if (!fs.existsSync(STATE_BACKUP_FILE)) return null;
  try {
    const backupResult = readMigratedStateFile(STATE_BACKUP_FILE);
    persistMigration(STATE_BACKUP_FILE, backupResult);
    const recovered = backupResult.state;
    atomicWrite(STATE_FILE, JSON.stringify(recovered));
    _lastKnownSavedAt = Number(recovered.savedAt) || 0;
    setStartupAlert('找不到 state.json，已從最近可用備份恢復。請確認歌單與設定。');
    log.info('state.json 不存在，已從 state.json.last-good 恢復狀態');
    return recovered;
  } catch (error) {
    if (error instanceof UnsupportedStateSchemaError) {
      blockWritesForFutureSchema(error, STATE_BACKUP_FILE);
      return null;
    }
    if (error.code === 'STATE_MIGRATION_PERSIST_FAILED') {
      blockWritesForMigrationFailure(error);
      return null;
    }
    let preserved = null;
    try { preserved = preserveCorruptFile(STATE_BACKUP_FILE); } catch (_) { /* 保留原位 */ }
    const note = preserved ? `，損壞備份已保留為 ${path.basename(preserved)}` : '且無法安全移動損壞備份';
    setStartupAlert(`找不到 state.json，最近可用備份也無法載入${note}。已用預設狀態啟動，請重新確認歌單與設定。`, 'error');
    log.warn(`state.json 不存在且 last-good 無法載入: ${error.message}`);
    return null;
  }
}

/**
 * 啟動時載入狀態
 * @returns {object|null} { playlist, style, romanizationMode, showRomanization,
 *                          metronomeEnabled, trackOffsets, manualLyrics } 或 null
 */
function loadState() {
  _writeBlockReason = null;
  if (!fs.existsSync(STATE_FILE)) return recoverMissingPrimaryFromBackup();
  try {
    const result = readMigratedStateFile(STATE_FILE);
    persistMigration(STATE_FILE, result);
    const state = result.state;
    log.info(`已還原上次狀態: 歌單 ${Array.isArray(state.playlist) ? state.playlist.length : 0} 首、` +
             `offset ${state.trackOffsets ? Object.keys(state.trackOffsets).length : 0} 筆、` +
             `手動歌詞 ${state.manualLyrics ? Object.keys(state.manualLyrics).length : 0} 筆`);
    _lastKnownSavedAt = Number(state.savedAt) || 0;
    try {
      refreshLastGood(state);
    } catch (backupError) {
      log.warn(`狀態已載入，但安全備份更新失敗: ${backupError.message}`);
      setStartupAlert('狀態已正常載入，但安全備份無法更新；請檢查磁碟空間或資料夾權限。');
    }
    return state;
  } catch (err) {
    if (err instanceof UnsupportedStateSchemaError) {
      blockWritesForFutureSchema(err);
      return null;
    }
    if (err.code === 'STATE_MIGRATION_PERSIST_FAILED') {
      blockWritesForMigrationFailure(err);
      return null;
    }
    let preserved = null;
    try {
      preserved = preserveCorruptFile(STATE_FILE);
      log.warn(`狀態檔損壞，已保留為 ${path.basename(preserved)}: ${err.message}`);
    } catch (preserveError) {
      log.warn(`狀態檔損壞且無法保留，拒絕覆寫: ${preserveError.message}`);
      setStartupAlert('state.json 已損壞且無法安全保留，程式不會覆寫它；請檢查資料夾權限後重新啟動。', 'error');
      return null;
    }

    if (fs.existsSync(STATE_BACKUP_FILE)) {
      try {
        const backupResult = readMigratedStateFile(STATE_BACKUP_FILE);
        persistMigration(STATE_BACKUP_FILE, backupResult);
        const recovered = backupResult.state;
        atomicWrite(STATE_FILE, JSON.stringify(recovered));
        _lastKnownSavedAt = Number(recovered.savedAt) || 0;
        setStartupAlert(`偵測到 state.json 損壞，原檔已保留為 ${path.basename(preserved)}，並已從最近可用備份恢復。請確認歌單與設定。`);
        log.info('已從 state.json.last-good 恢復狀態');
        return recovered;
      } catch (backupError) {
        if (backupError instanceof UnsupportedStateSchemaError) {
          blockWritesForFutureSchema(backupError, STATE_BACKUP_FILE);
          return null;
        }
        if (backupError.code === 'STATE_MIGRATION_PERSIST_FAILED') {
          blockWritesForMigrationFailure(backupError);
          return null;
        }
        let backupPreserved = null;
        try { backupPreserved = preserveCorruptFile(STATE_BACKUP_FILE); } catch (_) { /* 保留原位 */ }
        log.warn(`最近可用備份也無法載入: ${backupError.message}`);
        const backupNote = backupPreserved ? `；損壞備份另存為 ${path.basename(backupPreserved)}` : '';
        setStartupAlert(`偵測到 state.json 損壞，原檔已保留為 ${path.basename(preserved)}${backupNote}。沒有可用備份，已用預設狀態啟動，請重新確認歌單與設定。`, 'error');
        return null;
      }
    }

    setStartupAlert(`偵測到 state.json 損壞，原檔已保留為 ${path.basename(preserved)}。沒有可用備份，已用預設狀態啟動，請重新確認歌單與設定。`, 'error');
    return null;
  }
}

/**
 * 排程延遲寫入
 * @param {Function} snapshotFn - 回傳目前狀態快照的函數（呼叫時才取值，確保存到最新狀態）
 */
// Windows 不支援真正的 SIGTERM：關閉終端機視窗、IDE 停止按鈕、`node --watch` 偵測到檔案
// 變動要重啟伺服器，在 Windows 上都是強制終止程序，process.on('exit') 完全不會觸發。
// 舊值 3000ms 在「改設定後立刻重開測試」的開發節奏下，幾乎每次都會把還沒落地的設定弄丟。
// 縮到 800ms：仍能合併同一次拖曳滑桿/選色器的高頻事件，但把資料遺失的風險窗口縮到最小。
const SAVE_DEBOUNCE_MS = 800;

function scheduleSave(snapshotFn, callback) {
  _lastSnapshotFn = snapshotFn;
  if (typeof callback === 'function') _saveCallbacks.push(callback);
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

function saveNow() {
  _saveTimer = null;
  if (!_lastSnapshotFn) return;
  const callbacks = _saveCallbacks;
  _saveCallbacks = [];

  function report(result) {
    for (const callback of callbacks) {
      try { callback(result); } catch (_) { /* 回報失敗不可影響保存 */ }
    }
  }

  try {
    if (_writeBlockReason) throw new Error(`${_writeBlockReason}，已拒絕寫入`);
    const rawSnapshot = _lastSnapshotFn();
    if (!rawSnapshot) throw new Error('無法取得要保存的狀態快照');
    const snapshot = { ...rawSnapshot, schemaVersion: CURRENT_STATE_SCHEMA_VERSION };
    if (fs.existsSync(STATE_FILE)) {
      try {
        const diskResult = readMigratedStateFile(STATE_FILE);
        if (diskResult.migrated) {
          try {
            preservePreMigrationFile(STATE_FILE, diskResult.fromVersion);
          } catch (migrationError) {
            throw migrationPersistenceError(STATE_FILE, migrationError);
          }
        }
        const disk = diskResult.state;
        const diskSavedAt = Number(disk.savedAt) || 0;
        if (diskSavedAt > _lastKnownSavedAt) {
          const now = Date.now();
          if (_conflict && _conflict.savedAt === diskSavedAt && now - _conflict.firstSeenAt >= TAKEOVER_QUIET_MS) {
            // 對方已停止寫入：把對方最後狀態備份成 .conflict-* 再接管，不讓任何一邊的資料消失。
            const preserved = conflictBackupPathFor(STATE_FILE);
            fs.copyFileSync(STATE_FILE, preserved);
            prunePreserved(STATE_FILE, 'conflict');
            _lastKnownSavedAt = diskSavedAt;
            _conflict = null;
            const message = `另一個伺服器已停止更新 state.json，本程序已接管保存；對方最後狀態備份為 ${path.basename(preserved)}。`;
            log.warn(message);
            if (_errorReporter) _errorReporter({ type: 'warning', area: '狀態保存', message });
          } else {
            if (!_conflict || _conflict.savedAt !== diskSavedAt) _conflict = { savedAt: diskSavedAt, firstSeenAt: now };
            throw new Error('偵測到另一個伺服器已更新 state.json，已拒絕用舊狀態覆寫（若對方已關閉，稍後會自動接管恢復保存）');
          }
        } else {
          _conflict = null;
        }
      } catch (diskError) {
        if (diskError instanceof UnsupportedStateSchemaError) {
          blockWritesForFutureSchema(diskError);
          throw new Error(`${_writeBlockReason}，已拒絕寫入`);
        }
        if (diskError.code === 'STATE_MIGRATION_PERSIST_FAILED') {
          blockWritesForMigrationFailure(diskError);
          throw new Error(`${_writeBlockReason}，已拒絕寫入`);
        }
        if (/另一個伺服器/.test(diskError.message)) throw diskError;
        const preserved = preserveCorruptFile(STATE_FILE);
        const message = `寫入前發現 state.json 已損壞，原檔已保留為 ${path.basename(preserved)}；目前狀態將重新保存。`;
        log.warn(`${message} (${diskError.message})`);
        if (_errorReporter) _errorReporter({ type: 'warning', area: '狀態恢復', message });
      }
    }

    // 手動歌詞筆數保護：超量時保留最新的
    if (snapshot.manualLyrics) {
      const entries = Object.entries(snapshot.manualLyrics);
      if (entries.length > MAX_MANUAL_LYRICS_ENTRIES) {
        entries.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
        snapshot.manualLyrics = Object.fromEntries(entries.slice(0, MAX_MANUAL_LYRICS_ENTRIES));
      }
    }

    const serialized = JSON.stringify(snapshot);
    atomicWrite(STATE_FILE, serialized);
    _lastKnownSavedAt = Number(snapshot.savedAt) || Date.now();
    try {
      atomicWrite(STATE_BACKUP_FILE, serialized);
    } catch (backupError) {
      log.warn(`狀態已保存，但安全備份更新失敗: ${backupError.message}`);
      if (_errorReporter) _errorReporter({ area: '狀態備份', message: '狀態已保存，但安全備份更新失敗；請檢查磁碟空間或資料夾權限。' });
    }
    report({ ok: true, savedAt: _lastKnownSavedAt });
  } catch (err) {
    log.warn(`狀態寫入失敗: ${err.message}`);
    if (_errorReporter) _errorReporter({ area: '狀態保存', message: err.message });
    report({ ok: false, error: err.message });
  }
}

// 程式結束前把待寫入的狀態落地
process.on('exit', () => {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    try { saveNow(); } catch (e) { /* 靜默 */ }
  }
});

function setErrorReporter(fn) { _errorReporter = typeof fn === 'function' ? fn : null; }
function consumeStartupAlert() {
  const alert = _startupAlert;
  _startupAlert = null;
  return alert;
}
module.exports = {
  loadState,
  scheduleSave,
  saveNow,
  setErrorReporter,
  consumeStartupAlert,
  preserveCorruptFile,
  preservePreMigrationFile,
  STATE_FILE,
  STATE_BACKUP_FILE,
  CURRENT_STATE_SCHEMA_VERSION,
};
