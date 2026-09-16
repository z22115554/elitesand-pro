/**
 * BGM 待機清單：data/bgm-playlist.json
 *
 * 仿「歌回救星」的雙軌切換——唱歌時自動暫停 BGM，暫停/唱完自動恢復。BGM 只有一份清單
 * （不像收藏歌單可以建很多份），一樣只存媒體庫 id、不複製 track，音檔還在就零下載：
 * - 跟 library.json 分開存；媒體庫刪歌／清空時由 handler 呼叫 pruneTrackIds() 同步移除
 * - 純檔案、debounce 寫入，錯誤靜默降級（跟 saved-playlists.js 同一套慣例）
 * - 完全不寫入 playState.playlist：BGM 是旁路播放，不進主播放清單/setlist，比照
 *   setlist:demo 純轉播不寫 playState 的既有慣例
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');

const log = createLogger('BgmPlaylist');
const FILE = path.join(DATA_DIR, 'bgm-playlist.json');

const MAX_TRACKS = 500; // BGM 是待機用的固定清單，不需要跟收藏歌單一樣到 2000
const MAX_ID_LENGTH = 128;

let trackIds = [];
let updatedAt = Date.now();
let _saveTimer = null;
let _errorReporter = null;

const diskStore = createJsonStore({
  file: FILE,
  label: 'BGM 清單',
  defaultValue: () => ({ trackIds: [], updatedAt: Date.now() }),
  serialize: (doc) => doc,
  deserialize: (document) => document,
  validate: (document) => document && Array.isArray(document.trackIds),
  logger: log,
  onError: (error) => _errorReporter?.({ area: 'BGM 清單保存', message: error.message }),
});

function cleanTrackIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (raw === undefined || raw === null) continue;
    const id = String(raw).trim();
    if (!id || id.length > MAX_ID_LENGTH || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_TRACKS) break;
  }
  return out;
}

(function load() {
  const loaded = diskStore.load();
  trackIds = cleanTrackIds(loaded?.trackIds);
  updatedAt = Number.isFinite(loaded?.updatedAt) ? loaded.updatedAt : Date.now();
  log.info(`BGM 清單已載入: ${trackIds.length} 首`);
})();

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 1500);
}

function saveNow() {
  _saveTimer = null;
  try {
    return diskStore.save({ trackIds, updatedAt });
  } catch (err) {
    log.warn(`BGM 清單寫入失敗: ${err.message}`);
    if (_errorReporter) _errorReporter({ area: 'BGM 清單保存', message: err.message });
    return false;
  }
}

function touch() {
  updatedAt = Date.now();
  scheduleSave();
}

function list() {
  return trackIds.slice();
}

/** 附加到末端；已在清單裡的 id 略過（清單內不重複）。 */
function addTracks(incomingIds) {
  const incoming = cleanTrackIds(incomingIds);
  const existing = new Set(trackIds);
  let added = 0;
  for (const trackId of incoming) {
    if (existing.has(trackId)) continue;
    if (trackIds.length >= MAX_TRACKS) break;
    trackIds.push(trackId);
    existing.add(trackId);
    added++;
  }
  if (added) touch();
  return { ok: true, added, trackIds: list() };
}

function removeTracks(removeIds) {
  const drop = new Set(cleanTrackIds(removeIds));
  const before = trackIds.length;
  trackIds = trackIds.filter((trackId) => !drop.has(trackId));
  const removed = before - trackIds.length;
  if (removed) touch();
  return { ok: true, removed, trackIds: list() };
}

/**
 * 整份重排：只接受既有 id 的排列；不認識的 id 丟掉、漏掉的既有 id 依原順序補在末端。
 * 面板拖曳時只看得到「還在媒體庫」的那些，已不在庫的 id 會經由這條補回去不遺失。
 */
function setOrder(newOrder) {
  const existing = new Set(trackIds);
  const ordered = cleanTrackIds(newOrder).filter((trackId) => existing.has(trackId));
  const placed = new Set(ordered);
  for (const trackId of trackIds) if (!placed.has(trackId)) ordered.push(trackId);
  const changed = ordered.some((trackId, index) => trackIds[index] !== trackId);
  if (changed) { trackIds = ordered; touch(); }
  return { ok: true, changed, trackIds: list() };
}

/** 媒體庫刪歌／清空後同步：把不再存在的 id 從 BGM 清單移除。傳 null 代表全部清掉。 */
function pruneTrackIds(removedIds) {
  const drop = removedIds === null ? null : new Set(cleanTrackIds(removedIds));
  const before = trackIds.length;
  trackIds = drop === null ? [] : trackIds.filter((trackId) => !drop.has(trackId));
  const changed = trackIds.length !== before;
  if (changed) touch();
  return changed;
}

process.on('exit', () => { if (_saveTimer) { clearTimeout(_saveTimer); try { saveNow(); } catch (e) { /* 靜默 */ } } });

function setErrorReporter(fn) { _errorReporter = typeof fn === 'function' ? fn : null; }

module.exports = {
  list, addTracks, removeTracks, setOrder, pruneTrackIds,
  saveNow, setErrorReporter,
  MAX_TRACKS,
};
