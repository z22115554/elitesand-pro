'use strict';

const path = require('path');

const MAX_PLAYLIST_SIZE = 500;
const MAX_LYRIC_LINES = 5000;
const MAX_WORDS_PER_LINE = 1000;
const MAX_LYRICS_LENGTH = 1024 * 1024;

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
    title,
    artist: text(value.artist, 500),
    performer: text(value.performer, 500),
    uploader: text(value.uploader, 500),
    isCover: value.isCover === true,
    artistConfidence: finite(value.artistConfidence, 0, 0, 1),
    needsArtistConfirmation: value.needsArtistConfirmation === true,
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
    pitchShift: finite(value.pitchShift, 0, -12, 12),
    playbackRate: finite(value.playbackRate, 1, 0.5, 1.5),
    offset: finite(value.offset, 0, -10000, 10000),
    lrcOffset: finite(value.lrcOffset, 0, -10000, 10000),
    autoplay: value.autoplay !== false,
    manualLyrics: sanitizeManualLyrics(value.manualLyrics),
  };
  return out;
}

function sanitizePlaylist(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, MAX_PLAYLIST_SIZE).map(sanitizeTrack).filter(Boolean);
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
  MAX_PLAYLIST_SIZE,
  MAX_LYRICS_LENGTH,
};
