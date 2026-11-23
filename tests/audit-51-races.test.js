'use strict';

// 2026-11-13 全面抓蟲稽核的回歸測試。每一個 test 對應 PR 說明裡的一個問題編號。
const test = require('node:test');
const assert = require('node:assert/strict');

function vm_get(context, name) { return require('vm').runInContext(name, context); }

function loadBrowserScript(file, extraGlobals = {}) {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const context = {
    SharedUtils: { escapeHtml: (value) => String(value) },
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({}) },
    localStorage: { getItem: () => null, setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    URL,
    setTimeout,
    clearTimeout,
    ...extraGlobals,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8'), context);
  return context;
}

function loadAuditModule(relative, overrides = {}) {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const { createRequire } = require('module');
  const filename = path.resolve(__dirname, '..', relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: (id) => (Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id)),
    __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, URLSearchParams, AbortController, console,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    process: { env: process.env, platform: process.platform, cwd: () => process.cwd(), on() {} },
  }, { filename });
  return module.exports;
}

function auditImportFixture({ previous = null, lyricsResult } = {}) {
  const silent = new Proxy({}, { get: () => () => {} });
  const saved = [];
  const audio = loadAuditModule('server/services/audio-processor.js', {
    './lyrics-engine': {
      LyricsEngine: {
        resolveAppleMusicMetadata: async () => null,
        search: async () => lyricsResult,
        resolveOriginalArtist: async () => null,
      },
      DURATION_TOLERANCE: 5,
    },
    '../utils/logger': { createLogger: () => silent }, './ffmpeg-provider': {}, './import-temp-registry': {}, './ytdlp-updater': {},
    './library-store': {
      findByIdentity: () => null,
      getEntry: (id) => (previous && id === previous.id ? previous : null),
      rememberImport: (track) => saved.push(track),
    },
  });
  audio.downloadWithMetadata = () => ({
    metadata: Promise.resolve({ id: 'video123456', title: 'Artist - Song', duration: 120 }),
    completed: Promise.resolve({ filePath: '/tmp/video123456.m4a', outputDir: '/tmp' }),
    completeTempImport: () => {},
  });
  audio.resolveTrackIdentity = () => ({ artist: 'Artist', title: 'Song', confidence: 0.95 });
  audio.detectCover = () => false;
  audio.shouldResolveAppleMetadata = () => false;
  audio.measureLoudnessQueued = async () => -14;
  audio.renameToReadableFilename = () => 'Artist - Song.m4a';
  audio.requireDownloadedAudio = () => {};
  return { audio, saved };
}

test('#23 歌詞選擇器連續換來源：舊來源晚到的羅馬化結果不可蓋掉新選的歌詞', async () => {
  const romanizerPath = require.resolve('../server/services/romanizer');
  const lyricsHandlerPath = require.resolve('../server/routes/handlers/lyrics');
  const playbackHandlerPath = require.resolve('../server/routes/handlers/playback');
  const realRomanizer = require(romanizerPath);
  const pending = [];
  const fakeRomanizer = {
    ...realRomanizer,
    needsRomanization: () => true,
    needsFurigana: () => false,
    addRomanization: (lines) => new Promise((resolve) => {
      pending.push(() => resolve(lines.map((line) => ({ ...line, phonetic: `romaji:${line.text}` }))));
    }),
  };
  const savedLyrics = require.cache[lyricsHandlerPath];
  const savedPlayback = require.cache[playbackHandlerPath];
  require.cache[romanizerPath].exports = fakeRomanizer;
  delete require.cache[lyricsHandlerPath];
  delete require.cache[playbackHandlerPath];
  const libraryStore = require('../server/services/library-store');
  const realAudioExists = libraryStore.audioExists;
  const realRecordPlay = libraryStore.recordPlay;
  const realUpdateMeta = libraryStore.updateMeta;
  const libraryWrites = [];
  try {
    libraryStore.audioExists = () => true;
    libraryStore.recordPlay = () => {};
    libraryStore.updateMeta = (id, patch) => libraryWrites.push([id, patch]);
    const registerLyricsHandlers = require(lyricsHandlerPath);
    const registerPlaybackHandlers = require(playbackHandlerPath);
    const emitted = [];
    const io = { emit: (event, payload) => emitted.push([event, payload]), to: () => io };
    const events = new Map();
    const socket = { id: 's1', clientType: 'controller', on: (event, handler) => events.set(event, handler), emit() {} };
    const manualLyricsCache = new Map();
    const row = { id: 'audit-t1', entryId: 'row-1', title: '歌', filename: 'x.mp3', lyrics: '[00:01.00]舊', lyricsType: 'lrc', parsedLyrics: [{ time: 1000, text: '舊', words: [] }] };
    const ctx = {
      playState: { currentTrack: null, playlist: [row] },
      trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache,
      lyricOffsetSyncTimers: new Map(), trackSyncConfirmed: new Set(),
      persistState() {}, broadcastState() {}, emitSetlist() {}, recordSessionSong() {}, markTrackPlayed() {},
      getEffectiveLyrics: (id) => manualLyricsCache.get(id) || null,
    };
    registerLyricsHandlers(io, socket, ctx);
    registerPlaybackHandlers(io, socket, ctx);

    // 播放：開始補羅馬化（舊歌詞）
    events.get('play:track')({ id: 'audit-t1', entryId: 'row-1', title: '歌' });
    assert.equal(pending.length, 1);
    // 羅馬化還沒完成就換成來源 A，再換成來源 B
    events.get('lyrics:manual')({ trackId: 'audit-t1', lyrics: '[00:01.00]A', lyricsType: 'lrc', source: 'lrclib' });
    events.get('lyrics:manual')({ trackId: 'audit-t1', lyrics: '[00:01.00]B', lyricsType: 'lrc', source: 'netease' });
    assert.equal(pending.length, 3);
    const writesBefore = libraryWrites.length;
    const romanizedBefore = emitted.filter(([event]) => event === 'lyrics:romanized').length;
    // 舊歌詞、來源 A 的結果晚到
    pending[0]();
    pending[1]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manualLyricsCache.get('audit-t1').parsedLyrics[0].text, 'B', '快取仍是 B 的歌詞');
    assert.equal(emitted.filter(([event]) => event === 'lyrics:romanized').length, romanizedBefore, '過期結果不可推播');
    assert.equal(libraryWrites.length, writesBefore, '過期結果不可寫回歌曲庫');
    // B 的結果照常套用
    pending[2]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manualLyricsCache.get('audit-t1').parsedLyrics[0].phonetic, 'romaji:B');
    const lastRomanized = emitted.filter(([event]) => event === 'lyrics:romanized').at(-1);
    assert.equal(lastRomanized[1].parsedLyrics[0].text, 'B');
  } finally {
    libraryStore.audioExists = realAudioExists;
    libraryStore.recordPlay = realRecordPlay;
    libraryStore.updateMeta = realUpdateMeta;
    require.cache[romanizerPath].exports = realRomanizer;
    if (savedLyrics) require.cache[lyricsHandlerPath] = savedLyrics; else delete require.cache[lyricsHandlerPath];
    if (savedPlayback) require.cache[playbackHandlerPath] = savedPlayback; else delete require.cache[playbackHandlerPath];
  }
});

test('#24 lyrics:romanized 是全體廣播：別首歌的羅馬化結果不可貼到目前歌詞同一時間戳的行', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const source = fs.readFileSync(path.join(__dirname, '../public/js/karaoke.js'), 'utf8');
  const start = source.indexOf('  function updateRomanization(romanizedLines) {');
  const bodyEnd = source.indexOf('    // 如果當前正在顯示某行', start);
  assert.ok(start > 0 && bodyEnd > start);
  const fn = `${source.slice(start, bodyEnd)}\n  }`;
  const context = { parsedLyrics: [
    { time: 1000, text: '君の名は', phonetic: '', words: [] },
    { time: 5000, text: '夜に駆ける', phonetic: '', words: [] },
  ] };
  vm.createContext(context);
  vm.runInContext(`${fn}; this.updateRomanization = updateRomanization;`, context);
  // 另一首歌（匯入中）的結果：時間剛好跟第一行一樣
  context.updateRomanization([{ time: 1000, text: '別首的歌詞', phonetic: 'betsu no uta', xieyin: '別' }]);
  assert.equal(context.parsedLyrics[0].phonetic, '', '別首歌詞的拼音不可貼上來');
  // 同一份歌詞（空白差異不影響）照常合併
  context.updateRomanization([{ time: 5000, text: '夜に 駆ける', phonetic: 'yoru ni kakeru' }]);
  assert.equal(context.parsedLyrics[1].phonetic, 'yoru ni kakeru');
  const prompter = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  assert.ok(prompter.includes('byTime.get(romanizationKey(line.time, line.text))'), '跟唱視圖也要用時間＋原文對齊');
});

test('#27 歌詞選擇器：上一首歌晚到的搜尋結果不可畫到現在這首（點下去會套到錯的歌）', async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const source = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
  const start = source.indexOf('  let pickerCurrentTrack = null;');
  const end = source.indexOf('  function renderProviderHealth(');
  assert.ok(start > 0 && end > start);
  const elements = {
    'lyrics-picker-body': { innerHTML: '' },
    'picker-artist': { value: '' },
    'picker-title': { value: '' },
  };
  const pending = [];
  const context = {
    document: { getElementById: (id) => elements[id] || null, addEventListener() {}, body: { appendChild() {} } },
    requestAnimationFrame() {},
    escapeHtml: (value) => String(value),
    renderCandidates: (body, candidates) => { body.innerHTML = `CANDIDATES:${candidates[0].lyrics}`; },
    renderProviderHealth() {},
    showToast() {},
    PinAuth: {
      fetchWithPin: (url, options) => new Promise((resolve) => {
        const payload = JSON.parse(options.body);
        pending.push(() => resolve({ json: async () => ({ success: true, candidates: [{ lyrics: `${payload.title}-lyrics` }] }) }));
      }),
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}
    this.runPickerSearch = runPickerSearch;
    this.setTrack = (track) => { pickerCurrentTrack = track; };`, context);
  context.setTrack({ id: 'A', duration: 200 });
  elements['picker-title'].value = 'SongA';
  context.runPickerSearch();
  context.setTrack({ id: 'B', duration: 180 });
  elements['picker-title'].value = 'SongB';
  context.runPickerSearch();
  pending[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(!elements['lyrics-picker-body'].innerHTML.includes('SongA'), '上一首的候選不可出現在現在的選擇器');
  pending[1]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements['lyrics-picker-body'].innerHTML, 'CANDIDATES:SongB-lyrics');
});
