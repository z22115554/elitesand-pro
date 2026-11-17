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

test('#89 歌詞檔自帶 [offset:] 時，OBS（伺服器）也要套用，重置回到這個值', () => {
  const { lrcDefaultOffset } = require('../server/utils/track-schema');
  assert.equal(lrcDefaultOffset({ lrcOffset: 500 }), 500);
  assert.equal(lrcDefaultOffset({}), 0);
  const libraryStore = require('../server/services/library-store');
  const realExists = libraryStore.audioExists;
  libraryStore.audioExists = () => true;
  try {
    const registerPlaybackHandlers = require('../server/routes/handlers/playback');
    const events = new Map();
    const emitted = [];
    const trackOffsets = new Map();
    const song = { id: 'lrc-song', entryId: 'e1', title: '有 offset 的歌', filename: 'x.mp3', lrcOffset: 500 };
    const playState = { playlist: [song], currentTrack: null, playedEntryIds: new Set() };
    const ctx = {
      playState, trackOffsets, trackPitch: new Map(), trackSpeed: new Map(), trackVolume: new Map(), trackTemplate: new Map(), manualLyricsCache: new Map(),
      persistState() {}, emitSetlist() {}, recordSessionSong() {}, broadcastState() {}, getEffectiveLyrics() { return null; }, markTrackPlayed() {},
      lyricOffsetSyncTimers: new Map(),
    };
    registerPlaybackHandlers({ emit(event, data) { emitted.push({ event, data }); }, to() { return { emit() {} }; } },
      { on(event, handler) { events.set(event, handler); }, emit() {}, id: 's1' }, ctx);
    events.get('play:track')({ id: 'lrc-song', entryId: 'e1', title: '有 offset 的歌', autoplay: false });
    assert.equal(playState.currentOffset, 500, '伺服器（OBS 用的）偏移要等於歌詞檔的 [offset:]');

    const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
    const lyricEvents = new Map();
    registerLyricsHandlers({ emit(event, data) { emitted.push({ event, data }); }, to() { return { emit() {} }; } },
      { on(event, handler) { lyricEvents.set(event, handler); }, emit() {}, id: 's1' }, ctx);
    lyricEvents.get('offset:adjust')({ trackId: 'lrc-song', delta: 100 });
    assert.equal(trackOffsets.get('lrc-song'), 600, '微調要從歌詞檔的偏移往上加，不是從 0');
    lyricEvents.get('offset:reset')('lrc-song');
    assert.equal(playState.currentOffset, 500);
    assert.equal(emitted.filter((e) => e.event === 'offset:update').pop().data.offset, 500);
  } finally {
    libraryStore.audioExists = realExists;
  }
});

test('#95 手動貼上的 LRC 自帶 [offset:]：伺服器（OBS）也要套用', () => {
  const emitted = [];
  const trackOffsets = new Map();
  const song = { id: 'paste-song', title: '貼上的歌' };
  const playState = { playlist: [song], currentTrack: song };
  const ctx = {
    playState, trackOffsets, trackPitch: new Map(), trackSpeed: new Map(), trackVolume: new Map(), trackTemplate: new Map(), manualLyricsCache: new Map(),
    trackSyncConfirmed: new Set(), lyricOffsetSyncTimers: new Map(), autoSyncUndo: new Map(),
    persistState() {}, broadcastState() {}, emitSetlist() {}, getEffectiveLyrics() { return null; },
  };
  const libraryStore = require('../server/services/library-store');
  const realUpdate = libraryStore.updateMeta;
  libraryStore.updateMeta = () => {};
  try {
    const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
    const events = new Map();
    registerLyricsHandlers({ emit(event, data) { emitted.push({ event, data }); }, to() { return { emit() {} }; } },
      { on(event, handler) { events.set(event, handler); }, emit() {}, id: 's1' }, ctx);
    events.get('lyrics:manual')({ trackId: 'paste-song', lyrics: '[offset:+700]\n[00:01.00]一\n[00:02.00]二', lyricsType: 'lrc', source: 'manual' });
    assert.equal(trackOffsets.get('paste-song'), 700);
    assert.equal(playState.currentOffset, 700);
    events.get('offset:reset')('paste-song');
    assert.equal(playState.currentOffset, 700, '重置回到歌詞檔自帶的偏移');
    // 換成沒有 [offset:] 的歌詞：舊的 700 不能再當預設
    events.get('lyrics:manual')({ trackId: 'paste-song', lyrics: '[00:01.00]三\n[00:02.00]四', lyricsType: 'lrc', source: 'manual' });
    assert.equal(song.lrcOffset, undefined);
    assert.equal(trackOffsets.get('paste-song'), 0, '自動套上的舊偏移不沿用到新歌詞');
    events.get('offset:reset')('paste-song');
    assert.equal(playState.currentOffset, 0);
  } finally {
    libraryStore.updateMeta = realUpdate;
  }
});
