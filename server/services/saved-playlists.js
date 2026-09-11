/**
 * 儲存歌單（saved playlists）：data/playlists.json
 *
 * 媒體庫拉到 10k 上限後需要組織能力。歌單是「媒體庫 id 的有序集合」，一首歌可在多個歌單：
 * - 只存 id，不複製 track；載入時走既有 library:reimport 路徑（音檔在就零下載，不在就重抓）
 * - 跟 library.json 分開存；媒體庫刪歌／清空時由 handler 呼叫 pruneTrackIds() 同步移除
 * - 純檔案、debounce 寫入，錯誤靜默降級（跟 library-store 同一套慣例）
 */
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');

const log = createLogger('SavedPlaylists');
const FILE = path.join(DATA_DIR, 'playlists.json');

const MAX_PLAYLISTS = 200;
const MAX_NAME_LENGTH = 60;
const MAX_TRACKS_PER_PLAYLIST = 2000; // 對齊 MAX_PLAYLIST_SIZE，避免「整份載入」超過播放清單上限
const MAX_ID_LENGTH = 128;

let playlists = []; // [{ id, name, trackIds: string[], createdAt, updatedAt }]
let _saveTimer = null;
let _errorReporter = null;

const diskStore = createJsonStore({
  file: FILE,
  label: '歌單',
  defaultValue: () => [],
  serialize: (items) => ({ playlists: items }),
  deserialize: (document) => document.playlists,
  validate: (document) => Array.isArray(document.playlists),
  logger: log,
  onError: (error) => _errorReporter?.({ area: '歌單保存', message: error.message }),
});

function cleanName(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

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
    if (out.length >= MAX_TRACKS_PER_PLAYLIST) break;
  }
  return out;
}

function sanitizePlaylist(item) {
  if (!item || typeof item !== 'object') return null;
  const id = typeof item.id === 'string' ? item.id.trim().slice(0, MAX_ID_LENGTH) : '';
  const name = cleanName(item.name);
  if (!id || !name) return null;
  const now = Date.now();
  return {
    id,
    name,
    trackIds: cleanTrackIds(item.trackIds),
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : now,
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : now,
  };
}

(function load() {
  const loaded = diskStore.load();
  const seen = new Set();
  playlists = (Array.isArray(loaded) ? loaded : [])
    .map(sanitizePlaylist)
    .filter((item) => item && !seen.has(item.id) && seen.add(item.id))
    .slice(0, MAX_PLAYLISTS);
  log.info(`歌單已載入: ${playlists.length} 個`);
})();

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 1500);
}

function saveNow() {
  _saveTimer = null;
  try {
    return diskStore.save(playlists);
  } catch (err) {
    log.warn(`歌單寫入失敗: ${err.message}`);
    if (_errorReporter) _errorReporter({ area: '歌單保存', message: err.message });
    return false;
  }
}

function clone(item) {
  return { ...item, trackIds: item.trackIds.slice() };
}

function list() {
  return playlists.map(clone);
}

function get(id) {
  const found = playlists.find((item) => item.id === String(id || ''));
  return found ? clone(found) : null;
}

function touch(item) {
  item.updatedAt = Date.now();
  scheduleSave();
}

/** @returns {{ok:true, playlist:object}|{ok:false, error:string}} */
function create({ name, trackIds } = {}) {
  const cleaned = cleanName(name);
  if (!cleaned) return { ok: false, error: 'name_required' };
  if (playlists.length >= MAX_PLAYLISTS) return { ok: false, error: 'too_many_playlists' };
  const now = Date.now();
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    name: cleaned,
    trackIds: cleanTrackIds(trackIds),
    createdAt: now,
    updatedAt: now,
  };
  playlists.push(item);
  scheduleSave();
  return { ok: true, playlist: clone(item) };
}

function rename(id, name) {
  const item = playlists.find((entry) => entry.id === String(id || ''));
  if (!item) return { ok: false, error: 'not_found' };
  const cleaned = cleanName(name);
  if (!cleaned) return { ok: false, error: 'name_required' };
  item.name = cleaned;
  touch(item);
  return { ok: true, playlist: clone(item) };
}

function remove(id) {
  const index = playlists.findIndex((entry) => entry.id === String(id || ''));
  if (index === -1) return { ok: false, error: 'not_found' };
  playlists.splice(index, 1);
  scheduleSave();
  return { ok: true };
}

/** 附加到末端；已在歌單裡的 id 略過（歌單內不重複）。 */
function addTracks(id, trackIds) {
  const item = playlists.find((entry) => entry.id === String(id || ''));
  if (!item) return { ok: false, error: 'not_found' };
  const incoming = cleanTrackIds(trackIds);
  const existing = new Set(item.trackIds);
  let added = 0;
  for (const trackId of incoming) {
    if (existing.has(trackId)) continue;
    if (item.trackIds.length >= MAX_TRACKS_PER_PLAYLIST) return { ok: false, error: 'playlist_full', added };
    item.trackIds.push(trackId);
    existing.add(trackId);
    added++;
  }
  if (added) touch(item);
  return { ok: true, added, playlist: clone(item) };
}

function removeTracks(id, trackIds) {
  const item = playlists.find((entry) => entry.id === String(id || ''));
  if (!item) return { ok: false, error: 'not_found' };
  const drop = new Set(cleanTrackIds(trackIds));
  const before = item.trackIds.length;
  item.trackIds = item.trackIds.filter((trackId) => !drop.has(trackId));
  const removed = before - item.trackIds.length;
  if (removed) touch(item);
  return { ok: true, removed, playlist: clone(item) };
}

/** 媒體庫刪歌／清空後同步：把不再存在的 id 從所有歌單移除。傳 null 代表全部清掉。 */
function pruneTrackIds(removedIds) {
  const drop = removedIds === null ? null : new Set(cleanTrackIds(removedIds));
  let changed = 0;
  for (const item of playlists) {
    const before = item.trackIds.length;
    item.trackIds = drop === null ? [] : item.trackIds.filter((trackId) => !drop.has(trackId));
    if (item.trackIds.length !== before) { item.updatedAt = Date.now(); changed++; }
  }
  if (changed) scheduleSave();
  return changed;
}

process.on('exit', () => { if (_saveTimer) { clearTimeout(_saveTimer); try { saveNow(); } catch (e) { /* 靜默 */ } } });

function setErrorReporter(fn) { _errorReporter = typeof fn === 'function' ? fn : null; }

module.exports = {
  list, get, create, rename, remove, addTracks, removeTracks, pruneTrackIds,
  saveNow, setErrorReporter,
  MAX_PLAYLISTS, MAX_NAME_LENGTH, MAX_TRACKS_PER_PLAYLIST,
};
