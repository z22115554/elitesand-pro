'use strict';

const path = require('path');
const crypto = require('crypto');

const MAX_PLAYLIST_SIZE = 500;
const MAX_LYRIC_LINES = 5000;
const MAX_WORDS_PER_LINE = 1000;
const MAX_LYRICS_LENGTH = 1024 * 1024;
// 官方 MV 常見的大段片頭（跳舞畫面、口白、企劃卡）可以輕鬆超過 10 秒；±10s 對真實內容太緊，
// 只是防呆用的上限，不是「合理的歌曲偏移」上限，所以放寬到 ±5 分鐘。offset:adjust／offset:set
// （server/routes/handlers/lyrics.js）與 deck-commands.js 都要 import 同一個值，不要各自硬寫常數。
const MAX_OFFSET_MS = 300000;

function text(value, max = 500, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

function finite(value, fallback = 0, min = -Infinity, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeUrl(value, max = 2048) {
  const raw = text(value, max, '');
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? raw : null;
  } catch (_) {
    return null;
  }
}

function sanitizeWord(word) {
  if (!word || typeof word !== 'object') return null;
  return {
    text: text(word.text, 1000),
    start: finite(word.start, 0, 0, 24 * 60 * 60 * 1000),
    duration: finite(word.duration, 0, 0, 60 * 60 * 1000),
    phonetic: text(word.phonetic, 2000),
    xieyin: text(word.xieyin, 2000),
  };
}

function sanitizeParsedLyrics(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, MAX_LYRIC_LINES).map((line) => {
    if (!line || typeof line !== 'object') return null;
    const out = {
      time: finite(line.time, 0, 0, 24 * 60 * 60 * 1000),
      endTime: finite(line.endTime, 0, 0, 24 * 60 * 60 * 1000),
      duration: finite(line.duration, 0, 0, 60 * 60 * 1000),
      text: text(line.text, 10000),
      phonetic: text(line.phonetic, 20000),
      xieyin: text(line.xieyin, 20000),
    };
    if (Array.isArray(line.words)) {
      out.words = line.words.slice(0, MAX_WORDS_PER_LINE).map(sanitizeWord).filter(Boolean);
    }
    return out;
  }).filter(Boolean);
}

function sanitizeManualLyrics(value) {
  if (!value || typeof value !== 'object') return null;
  const lyrics = text(value.lyrics, MAX_LYRICS_LENGTH);
  if (!lyrics) return null;
  return {
    lyrics,
    lyricsType: ['lrc', 'krc', 'srt', 'txt'].includes(value.lyricsType) ? value.lyricsType : 'lrc',
    parsedLyrics: sanitizeParsedLyrics(value.parsedLyrics),
    source: text(value.source, 40, 'manual'),
    timestamp: finite(value.timestamp, Date.now(), 0, Number.MAX_SAFE_INTEGER),
  };
}

function sanitizeTrack(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = text(value.id, 200).trim();
  const title = text(value.title, 500).trim();
  if (!id || !title) return null;
  const filename = value.filename ? path.basename(text(value.filename, 500)) : null;
  const lyricsType = ['lrc', 'krc', 'srt', 'txt'].includes(value.lyricsType) ? value.lyricsType : null;
  const out = {
    id,
    // 清單裡「這一列」的專屬識別碼，跟歌曲 id 分開：同一首歌重複加入會拿到不同的 entryId。
    // 只在真正加入清單時由伺服器產生（見 assignFreshEntryIds），這裡單純原樣通過既有值，
    // 避免每次 sanitize 都洗掉既有識別碼。
    entryId: text(value.entryId, 100, null),
    title,
    artist: text(value.artist, 500),
    performer: text(value.performer, 500),
    uploader: text(value.uploader, 500),
    isCover: value.isCover === true,
    artistConfidence: finite(value.artistConfidence, 0, 0, 1),
    needsArtistConfirmation: value.needsArtistConfirmation === true,
    // true＝有來源驗到官方時長吻合；false＝有查到候選但時長對不上（可能需手動校正字幕起始點）；
    // null＝沒有可驗證的資料（來源不支援本機時長比對，或影片本身沒有時長）。
    lyricsDurationVerified: typeof value.lyricsDurationVerified === 'boolean' ? value.lyricsDurationVerified : null,
    artistCandidates: Array.isArray(value.artistCandidates) ? value.artistCandidates.slice(0, 10).map(v => text(v, 500)).filter(Boolean) : [],
    album: text(value.album, 500),
    duration: finite(value.duration, 0, 0, 24 * 60 * 60),
    cover: safeUrl(value.cover),
    filename,
    originalName: text(value.originalName, 500),
    url: safeUrl(value.url),
    source: text(value.source, 40),
    lyrics: typeof value.lyrics === 'string' ? text(value.lyrics, MAX_LYRICS_LENGTH) : null,
    lyricsType,
    parsedLyrics: sanitizeParsedLyrics(value.parsedLyrics),
    // 匯入/回填時由 ffmpeg ebur128 量出的整曲響度（LUFS），null＝尚未量測。
    // 只接受合理範圍內的數字；null 不可落進 finite()（Number(null)=0 會被誤當有效值）。
    loudnessLufs: (typeof value.loudnessLufs === 'number' && Number.isFinite(value.loudnessLufs))
      ? Math.max(-70, Math.min(0, value.loudnessLufs))
      : null,
    pitchShift: finite(value.pitchShift, 0, -12, 12),
    playbackRate: finite(value.playbackRate, 1, 0.5, 1.5),
    offset: finite(value.offset, 0, -MAX_OFFSET_MS, MAX_OFFSET_MS),
    lrcOffset: finite(value.lrcOffset, 0, -MAX_OFFSET_MS, MAX_OFFSET_MS),
    autoplay: value.autoplay !== false,
    manualLyrics: sanitizeManualLyrics(value.manualLyrics),
  };
  return out;
}

function sanitizePlaylist(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, MAX_PLAYLIST_SIZE).map(sanitizeTrack).filter(Boolean);
}

/**
 * 真正「加入清單」的操作（add／insert-next／import）一律呼叫這個，無條件蓋掉任何
 * 客戶端送來的 entryId——加入永遠代表全新的一列，就算是同一首歌重複加入也一樣。
 */
function assignFreshEntryIds(tracks) {
  return tracks.map((track) => ({ ...track, entryId: crypto.randomUUID() }));
}

/**
 * playlist:update／playlist:reorder 這類「回寫既有清單」的操作用這個：保留客戶端
 * 帶回來的 entryId（本來就是從伺服器廣播拿到的），只在真的缺漏時（例如舊版客戶端
 * 還沒帶這個欄位）才補一個新的，避免清單裡出現沒有 entryId 的列。
 */
function ensureEntryIds(tracks) {
  return tracks.map((track) => (track.entryId ? track : { ...track, entryId: crypto.randomUUID() }));
}

function sanitizeJsonObject(value, depth = 0) {
  if (depth > 5) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return text(value, 20000);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeJsonObject(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const key of Object.keys(value).slice(0, 250)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    const clean = sanitizeJsonObject(value[key], depth + 1);
    if (clean !== undefined) out[text(key, 100)] = clean;
  }
  return out;
}

module.exports = {
  sanitizeTrack,
  sanitizePlaylist,
  sanitizeParsedLyrics,
  sanitizeManualLyrics,
  safeUrl,
  sanitizeJsonObject,
  assignFreshEntryIds,
  ensureEntryIds,
  MAX_OFFSET_MS,
  MAX_PLAYLIST_SIZE,
  MAX_LYRICS_LENGTH,
};
