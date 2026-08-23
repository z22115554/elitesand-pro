/**
 * 媒體庫（歷史歌曲）持久化：data/library.json
 * - 記錄唱過的歌（以 track.id 為鍵）+ 播放次數 + 最後播放時間 + YouTube 網址
 * - 用 YT 網址重匯入比保留 MP3 省空間；音檔可清理，庫保留即可重抓
 * - 純檔案、debounce 寫入，任何錯誤都靜默降級不影響主流程
 */
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const log = createLogger('Library');
const { sanitizeTrack } = require('../utils/track-schema');

const { dataDir: DATA_DIR, downloadsDir: DOWNLOADS_DIR } = require('../utils/app-paths');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const MAX_ENTRIES = 1000; // 上限保護
// state:sync 會在每次操作後重建整份播放清單。以目錄快照取代每首
// fs.existsSync，可把 500 首歌的同步 I/O 壓成短暫快取期內至多一次 readdirSync。
const AUDIO_SNAPSHOT_TTL_MS = 1000;

let library = {}; // { [id]: { id, url, title, artist, cover, duration, source, playCount, lastPlayed } }
let _saveTimer = null;
let _errorReporter = null;
let _audioSnapshot = { checkedAt: 0, files: new Set() };

const libraryDiskStore = createJsonStore({
  file: LIBRARY_FILE,
  label: '媒體庫',
  defaultValue: () => ({}),
  migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, entries: legacy })]]),
  serialize: (entries) => ({ entries }),
  deserialize: (document) => document.entries,
  validate: (document) => document.entries && typeof document.entries === 'object' && !Array.isArray(document.entries),
  logger: log,
  onError: (error) => _errorReporter?.({ area: '媒體庫保存', message: error.message }),
});

(function load() {
  library = libraryDiskStore.load() || {};
  log.info(`媒體庫已載入: ${Object.keys(library).length} 首`);
})();

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 2000);
}

function saveNow() {
  _saveTimer = null;
  try {
    // 超量時淘汰最少播放 + 最舊的
    let ids = Object.keys(library);
    if (ids.length > MAX_ENTRIES) {
      ids.sort((a, b) => (library[b].playCount - library[a].playCount) || (library[b].lastPlayed - library[a].lastPlayed));
      const keep = {};
      for (const id of ids.slice(0, MAX_ENTRIES)) keep[id] = library[id];
      library = keep;
    }
    libraryDiskStore.save(library);
  } catch (err) {
    log.warn(`媒體庫寫入失敗: ${err.message}`);
    if (_errorReporter) _errorReporter({ area: '媒體庫保存', message: err.message });
  }
}

/** 記錄一次播放（被選為當前歌曲時呼叫）。連同歌詞/拼音/諧音/檔名/變調變速一起記住，
 *  之後從媒體庫拉回來可即時還原，不必重抓歌詞、重新羅馬化、重設 key。 */
function recordPlay(track) {
  track = sanitizeTrack(track);
  if (!track || !track.id) return;
  const id = String(track.id);
  const prev = library[id];
  const pick = (a, b) => (a !== undefined && a !== null && a !== '' ? a : b);
  library[id] = {
    id,
    url: pick(track.url, prev && prev.url) || null,
    title: pick(track.title, prev && prev.title) || '未知歌曲',
    artist: pick(track.artist, prev && prev.artist) || '',
    performer: pick(track.performer, prev && prev.performer) || '',
    uploader: pick(track.uploader, prev && prev.uploader) || '',
    isCover: track.isCover === true || (prev && prev.isCover === true),
    artistConfidence: pick(track.artistConfidence, prev && prev.artistConfidence) || 0,
    needsArtistConfirmation: track.needsArtistConfirmation === true,
    artistCandidates: Array.isArray(track.artistCandidates) ? track.artistCandidates : (prev && prev.artistCandidates) || [],
    cover: pick(track.cover, prev && prev.cover) || null,
    duration: pick(track.duration, prev && prev.duration) || 0,
    source: pick(track.source, prev && prev.source) || (track.url ? 'youtube' : 'local'),
    // 還原所需：本機檔名 + 歌詞（含已羅馬化的 parsedLyrics）
    filename: pick(track.filename, prev && prev.filename) || null,
    lyrics: pick(track.lyrics, prev && prev.lyrics) || null,
    lyricsType: pick(track.lyricsType, prev && prev.lyricsType) || 'lrc',
    parsedLyrics: (Array.isArray(track.parsedLyrics) && track.parsedLyrics.length)
      ? track.parsedLyrics : (prev && prev.parsedLyrics) || null,
    // 統一音量：整曲響度（LUFS）跟著記錄走，重新從媒體庫拉回時不必重量測。
    // 不能用 pick()：LUFS 是負數但 0 判定要走 typeof，避免 falsy 陷阱。
    loudnessLufs: (typeof track.loudnessLufs === 'number') ? track.loudnessLufs
      : (prev && typeof prev.loudnessLufs === 'number') ? prev.loudnessLufs : null,
    // 每首記憶的變調/變速
    pitchShift: typeof track.pitchShift === 'number' ? track.pitchShift : (prev && prev.pitchShift) || 0,
    playbackRate: typeof track.playbackRate === 'number' ? track.playbackRate : (prev && prev.playbackRate) || 1.0,
    playCount: (prev ? prev.playCount : 0) + 1,
    lastPlayed: Date.now(),
  };
  scheduleSave();
}

/** 匯入完成即保存 video ID 對應資料，讓尚未播放的重複匯入也能命中。 */
function rememberImport(track) {
  track = sanitizeTrack(track);
  if (!track || !track.id) return;
  const prev = library[String(track.id)] || {};
  library[String(track.id)] = { ...prev, ...track, playCount: prev.playCount || 0, lastPlayed: prev.lastPlayed || 0 };
  // 匯入流程走到這裡代表音檔已完成落地；不必等下一次目錄掃描才讓 UI 顯示可播放。
  noteAudioSnapshot(track.filename, true);
  scheduleSave();
}

/** 合併更新某筆記錄（不累加播放次數）。用於：羅馬化完成後補上 parsedLyrics、調 key 後存變調等。 */
function updateMeta(id, partial) {
  if (!id || !partial || typeof partial !== 'object') return;
  id = String(id);
  const prev = library[id];
  if (!prev) return; // 只更新已存在的記錄（避免無中生有）
  library[id] = { ...prev, ...partial };
  scheduleSave();
}

/** 取得單筆記錄（含歌詞/檔名/變調），供從媒體庫即時還原。 */
function getEntry(id) {
  if (!id) return null;
  return library[String(id)] || null;
}

/**
 * 回傳可重用的檔名存在查詢。這是播放清單同步專用的批次快照；播放
 * 前的安全檢查仍會走下方 audioExists() 的即時檔案檢查，避免快取造成誤播。
 */
function getAudioExistsLookup({ now = Date.now, readDirectory = fs.readdirSync } = {}) {
  const checkedAt = now();
  if (checkedAt - _audioSnapshot.checkedAt >= AUDIO_SNAPSHOT_TTL_MS) {
    let files = new Set();
    try {
      files = new Set(readDirectory(DOWNLOADS_DIR));
    } catch (_) {
      // downloads 尚未建立或暫時無法讀取時，安全地視為沒有可播放的本機音檔。
    }
    _audioSnapshot = { checkedAt, files };
  }
  const files = _audioSnapshot.files;
  return (filename) => typeof filename === 'string' && filename.length > 0 && files.has(filename);
}

function noteAudioSnapshot(filename, available) {
  if (!_audioSnapshot.checkedAt || !filename || typeof filename !== 'string') return;
  if (available) _audioSnapshot.files.add(filename);
  else _audioSnapshot.files.delete(filename);
}

function resetAudioStatusCache() {
  _audioSnapshot = { checkedAt: 0, files: new Set() };
}

/** 判斷某本機音檔是否仍存在於 downloads/。 */
function audioExists(filename) {
  if (!filename || typeof filename !== 'string') return false;
  try { return fs.existsSync(path.join(DOWNLOADS_DIR, filename)); } catch (e) { return false; }
}

/** 衍生播放可用性，不寫回持久化資料；exists 參數讓故障測試不必碰真 downloads/。 */
function audioStatus(track, exists = audioExists) {
  const filename = track && typeof track.filename === 'string' ? track.filename : '';
  const available = !!filename && exists(filename);
  return { audioAvailable: available, audioMissing: !available };
}

/** 取得媒體庫清單（依播放次數→最近排序） */
function getLibrary() {
  return Object.values(library).sort(
    (a, b) => (b.playCount - a.playCount) || (b.lastPlayed - a.lastPlayed)
  );
}

function remove(id) {
  if (library[id]) { delete library[id]; scheduleSave(); return true; }
  return false;
}

function clear() { library = {}; scheduleSave(); }

/**
 * 清理已下載音檔：刪除 downloads/ 內「不在目前播放清單」的音檔。
 * 媒體庫保留 YT 網址，之後可重抓，故刪音檔不會遺失歌曲記錄。
 * @param {Set<string>} keepFilenames 目前播放清單正在用的檔名集合
 * @returns {{deleted:number, freedBytes:number}}
 */
function cleanupAudio(keepFilenames = new Set()) {
  let deleted = 0, freedBytes = 0;
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) return { deleted, freedBytes };
    for (const name of fs.readdirSync(DOWNLOADS_DIR)) {
      if (keepFilenames.has(name)) continue;
      const fp = path.join(DOWNLOADS_DIR, name);
      try {
        const st = fs.statSync(fp);
        if (st.isFile()) { freedBytes += st.size; fs.unlinkSync(fp); noteAudioSnapshot(name, false); deleted++; }
      } catch (e) { /* 略過單檔錯誤 */ }
    }
    log.info(`音檔清理: 刪除 ${deleted} 個檔、釋放 ${(freedBytes / 1048576).toFixed(1)}MB`);
  } catch (err) {
    log.warn(`音檔清理失敗: ${err.message}`);
  }
  return { deleted, freedBytes };
}

process.on('exit', () => { if (_saveTimer) { clearTimeout(_saveTimer); try { saveNow(); } catch (e) { /* 靜默 */ } } });

function setErrorReporter(fn) { _errorReporter = typeof fn === 'function' ? fn : null; }
module.exports = { recordPlay, rememberImport, updateMeta, getEntry, audioExists, audioStatus, getAudioExistsLookup, resetAudioStatusCache, getLibrary, remove, clear, cleanupAudio, setErrorReporter, saveNow };
