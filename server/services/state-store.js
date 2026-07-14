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
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('StateStore');

const { dataDir: DATA_DIR } = require('../utils/data-dir');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
let _lastKnownSavedAt = 0;
let _errorReporter = null;

// 手動歌詞單筆與總量保護（避免 state.json 無限膨脹）
const MAX_MANUAL_LYRICS_ENTRIES = 200;

let _saveTimer = null;
let _lastSnapshotFn = null;

/**
 * 啟動時載入狀態
 * @returns {object|null} { playlist, style, romanizationMode, showRomanization,
 *                          metronomeEnabled, trackOffsets, manualLyrics } 或 null
 */
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object') return null;
    log.info(`已還原上次狀態: 歌單 ${Array.isArray(state.playlist) ? state.playlist.length : 0} 首、` +
             `offset ${state.trackOffsets ? Object.keys(state.trackOffsets).length : 0} 筆、` +
             `手動歌詞 ${state.manualLyrics ? Object.keys(state.manualLyrics).length : 0} 筆`);
    _lastKnownSavedAt = Number(state.savedAt) || 0;
    return state;
  } catch (err) {
    log.warn(`狀態檔載入失敗（將重新建立）: ${err.message}`);
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

function scheduleSave(snapshotFn) {
  _lastSnapshotFn = snapshotFn;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

function saveNow() {
  _saveTimer = null;
  if (!_lastSnapshotFn) return;

  try {
    const snapshot = _lastSnapshotFn();
    if (!snapshot) return;
    if (fs.existsSync(STATE_FILE)) {
      const disk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      const diskSavedAt = Number(disk && disk.savedAt) || 0;
      if (diskSavedAt > _lastKnownSavedAt) throw new Error('偵測到另一個伺服器已更新 state.json，已拒絕用舊狀態覆寫');
    }

    // 手動歌詞筆數保護：超量時保留最新的
    if (snapshot.manualLyrics) {
      const entries = Object.entries(snapshot.manualLyrics);
      if (entries.length > MAX_MANUAL_LYRICS_ENTRIES) {
        entries.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
        snapshot.manualLyrics = Object.fromEntries(entries.slice(0, MAX_MANUAL_LYRICS_ENTRIES));
      }
    }

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const tmpFile = STATE_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(snapshot), 'utf-8');
    fs.renameSync(tmpFile, STATE_FILE);
    _lastKnownSavedAt = Number(snapshot.savedAt) || Date.now();
  } catch (err) {
    log.warn(`狀態寫入失敗: ${err.message}`);
    if (_errorReporter) _errorReporter({ area: '狀態保存', message: err.message });
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
module.exports = { loadState, scheduleSave, saveNow, setErrorReporter, STATE_FILE };
