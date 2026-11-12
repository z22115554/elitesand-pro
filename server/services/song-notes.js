/**
 * 歌曲筆記：data/song-notes.json
 *
 * 主播私用的提醒（「這裡換氣」「唱完感謝○○」），只給主播端看（面板、跟唱視圖、手機遙控）。
 * 刻意不放進 track／歌曲庫 entry：播放清單與 state:sync 會送到唯讀端（OBS 歌詞／歌單），
 * 放在 track 上就會順著廣播漏出去。這裡獨立存檔，只經 control 房間的事件讀寫。
 *
 * 一首歌一份：{ songNote, lines: [{ time, text, note }], updatedAt }
 * - songNote：整首的筆記
 * - lines：逐句筆記，用「那一句的時間＋原文」錨定；換了歌詞版本對不上的，前端改列為「待核對」
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');

const log = createLogger('SongNotes');
const FILE = path.join(DATA_DIR, 'song-notes.json');

const MAX_SONGS = 10000;
const MAX_ID_LENGTH = 128;
const MAX_SONG_NOTE = 2000;
const MAX_LINE_NOTES = 300;
const MAX_LINE_NOTE = 200;
const MAX_LINE_TEXT = 300;

let notes = {}; // trackId -> { songNote, lines, updatedAt }
let _saveTimer = null;
let _errorReporter = null;

const diskStore = createJsonStore({
  file: FILE,
  label: '歌曲筆記',
  defaultValue: () => ({}),
  serialize: (items) => ({ notes: items }),
  deserialize: (document) => document.notes,
  validate: (document) => !!document.notes && typeof document.notes === 'object' && !Array.isArray(document.notes),
  logger: log,
  onError: (error) => _errorReporter?.({ area: '歌曲筆記保存', message: error.message }),
});

function cleanId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const id = String(value).trim();
  return id && id.length <= MAX_ID_LENGTH ? id : '';
}

// 純文字：去掉控制字元（保留換行），限制長度。顯示端一律 escape，這裡只負責尺寸與格式。
function cleanText(value, max, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  const pattern = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g;
  return value.replace(/\r\n?/g, '\n').replace(pattern, multiline ? '' : ' ').trim().slice(0, max);
}

function cleanLines(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const time = Number(raw.time);
    const note = cleanText(raw.note, MAX_LINE_NOTE);
    if (!Number.isFinite(time) || time < 0 || !note) continue;
    const text = cleanText(raw.text, MAX_LINE_TEXT);
    const key = `${Math.round(time)}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ time: Math.round(time), text, note });
    if (out.length >= MAX_LINE_NOTES) break;
  }
  return out.sort((a, b) => a.time - b.time);
}

function sanitize(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const songNote = cleanText(entry.songNote, MAX_SONG_NOTE, { multiline: true });
  const lines = cleanLines(entry.lines);
  if (!songNote && !lines.length) return null;
  return { songNote, lines, updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now() };
}

(function load() {
  const loaded = diskStore.load();
  notes = {};
  let count = 0;
  for (const [rawId, entry] of Object.entries(loaded && typeof loaded === 'object' ? loaded : {})) {
    const id = cleanId(rawId);
    const clean = id && sanitize(entry);
    if (!clean) continue;
    notes[id] = clean;
    if (++count >= MAX_SONGS) break;
  }
  log.info(`歌曲筆記已載入: ${count} 首`);
})();

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 1000);
}

function saveNow() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    return diskStore.save(notes);
  } catch (err) {
    log.warn(`歌曲筆記寫入失敗: ${err.message}`);
    if (_errorReporter) _errorReporter({ area: '歌曲筆記保存', message: err.message });
    return false;
  }
}

const EMPTY = Object.freeze({ songNote: '', lines: Object.freeze([]), updatedAt: 0 });

function get(trackId) {
  const id = cleanId(trackId);
  const entry = id && notes[id];
  return entry ? { songNote: entry.songNote, lines: entry.lines.map((line) => ({ ...line })), updatedAt: entry.updatedAt } : { ...EMPTY, lines: [] };
}

/**
 * 更新一首歌的筆記。partial 只帶要改的欄位（songNote 或 lines，lines 是整份取代）。
 * 回傳更新後的內容；trackId 不合法回傳 null。兩個欄位都清空＝刪掉這首的紀錄。
 */
function set(trackId, partial) {
  const id = cleanId(trackId);
  if (!id || !partial || typeof partial !== 'object') return null;
  const prev = notes[id] || { songNote: '', lines: [] };
  const next = sanitize({
    songNote: Object.prototype.hasOwnProperty.call(partial, 'songNote') ? partial.songNote : prev.songNote,
    lines: Object.prototype.hasOwnProperty.call(partial, 'lines') ? partial.lines : prev.lines,
    updatedAt: Date.now(),
  });
  if (next) {
    if (!notes[id] && Object.keys(notes).length >= MAX_SONGS) return null;
    notes[id] = next;
  } else {
    delete notes[id];
  }
  scheduleSave();
  return get(id);
}

function setErrorReporter(fn) { _errorReporter = typeof fn === 'function' ? fn : null; }

module.exports = { get, set, saveNow, setErrorReporter, MAX_SONG_NOTE, MAX_LINE_NOTE, MAX_LINE_NOTES };
