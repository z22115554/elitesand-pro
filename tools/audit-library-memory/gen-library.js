'use strict';
// Generates a synthetic v2 library (library.json + library-lyrics/*) in the
// scratch data dir, in exactly the on-disk shape library-store.js writes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = process.argv[2];
const downloadsDir = process.argv[3];
const N = Number(process.argv[4] || 10000);
const PLAYLIST = Number(process.argv[5] || 2000);
fs.mkdirSync(path.join(dataDir, 'library-lyrics'), { recursive: true });
fs.mkdirSync(downloadsDir, { recursive: true });

function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const r = rnd(12345);
const CJK = '夜空星光夢想風雨花雪月海心愛歌聲時間世界微笑眼淚未來昨日約定奇蹟永遠瞬間';
function word(n) { let s = ''; for (let i = 0; i < n; i++) s += CJK[Math.floor(r() * CJK.length)]; return s; }
function videoId(i) {
  return crypto.createHash('sha1').update('vid' + i).digest('base64').replace(/[+/=]/g, 'A').slice(0, 11);
}
function lyricsFileFor(id) {
  return path.join(dataDir, 'library-lyrics', `${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 40)}.json`);
}
function makeLyrics() {
  const lines = [];
  let t = 15000;
  let lrc = '';
  for (let i = 0; i < 30; i++) {
    const n = 5 + Math.floor(r() * 6);
    const text = word(n);
    const words = [];
    for (let k = 0; k < n; k++) words.push({ text: text[k], start: t + k * 300, duration: 300, phonetic: 'xing', xieyin: '' });
    lines.push({ time: t, endTime: t + n * 300, duration: n * 300, text, phonetic: Array(n).fill('xing').join(' '), xieyin: '', words });
    const mm = String(Math.floor(t / 60000)).padStart(2, '0');
    const ss = (t % 60000 / 1000).toFixed(2).padStart(5, '0');
    lrc += `[${mm}:${ss}]${text}\n`;
    t += n * 300 + 1500;
  }
  return { lyrics: lrc, parsedLyrics: lines, manualLyrics: null };
}

const entries = {};
let lyricBytes = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const id = videoId(i);
  const artist = word(3);
  const title = word(4 + (i % 4)) + ' ' + i;
  const filename = `${artist} - ${title}.mp3`;
  entries[id] = {
    id, entryId: null, title, artist, performer: '', uploader: artist + 'VEVO', isCover: false,
    artistConfidence: 1, needsArtistConfirmation: false, lyricsDurationVerified: true, artistCandidates: [],
    album: '', duration: 180 + (i % 120), cover: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    filename, originalName: `${artist} - ${title} (Official MV)`, url: `https://www.youtube.com/watch?v=${id}`,
    source: 'youtube', lyricsType: 'krc', lyricsSource: 'kugou', lyricsOffsetsBySource: null,
    loudnessLufs: -9.5 - (i % 10), pitchShift: 0, playbackRate: 1, offset: 0, lrcOffset: 0, autoplay: true,
    vocalsFile: null, instrumentalFile: null, separationStatus: 'none', sections: null, sectionsStatus: 'none',
    playCount: i % 17, lastPlayed: 1760000000000 + i * 1000,
  };
  const blob = makeLyrics();
  const raw = JSON.stringify({ id, ...blob });
  lyricBytes += raw.length;
  fs.writeFileSync(lyricsFileFor(id), raw);
  // zero-byte audio placeholder so audioExists()/snapshot behave like a real library
  if (i < PLAYLIST + 50) fs.writeFileSync(path.join(downloadsDir, filename), '');
}
const doc = { entries, schemaVersion: 2 };
const libRaw = JSON.stringify(doc);
fs.writeFileSync(path.join(dataDir, 'library.json'), libRaw);

// state.json with a compact (library-backed) 2000-item playlist, as persistedPlaylistSnapshot() writes it
const ids = Object.keys(entries).slice(0, PLAYLIST);
const playlist = ids.map((id) => {
  const e = entries[id];
  const { playCount, lastPlayed, ...track } = e;
  return { ...track, entryId: crypto.randomUUID() };
});
const state = { schemaVersion: null, savedAt: Date.now(), playlist };
fs.writeFileSync(path.join(dataDir, 'state.playlist.seed.json'), JSON.stringify(playlist));
console.log(JSON.stringify({ N, PLAYLIST, genMs: Date.now() - t0, libraryJsonBytes: libRaw.length, avgLyricBytes: Math.round(lyricBytes / N), totalLyricBytes: lyricBytes }));
