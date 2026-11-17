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

test('#25 從歌曲庫加入清單／BGM／公開點歌的歌，不可掉響度、段落、歌詞來源等欄位', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const { buildTrackFromEntry } = require('../server/routes/handlers/library');
  const { sanitizeTrack } = require('../server/utils/track-schema');
  const entry = {
    id: 'yt1', title: '歌', artist: '手', filename: 'yt1.m4a', duration: 200,
    album: '專輯', originalName: 'orig.mp3', lyricsSource: 'kugou', lyricsDurationVerified: false, lrcOffset: 350,
    loudnessLufs: -9.5, sections: [{ start: 0, end: 30, label: 'intro' }], sectionsStatus: 'done',
    lyrics: '[00:01.00]a', lyricsType: 'lrc',
  };
  const track = sanitizeTrack(buildTrackFromEntry(entry));
  assert.equal(track.loudnessLufs, -9.5, '統一音量要用得到');
  assert.deepEqual(track.sections, [{ start: 0, end: 30, label: 'intro' }]);
  assert.equal(track.sectionsStatus, 'done');
  assert.equal(track.lyricsSource, 'kugou');
  assert.equal(track.lrcOffset, 350);
  assert.equal(track.lyricsDurationVerified, false);
  assert.equal(track.album, '專輯');

  // recordPlay 重建紀錄時不可把匯入時存的欄位洗掉
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-25-'));
  try {
    const script = `
      const store = require(${JSON.stringify(path.join(__dirname, '../server/services/library-store'))});
      store.rememberImport(${JSON.stringify({ ...entry, lyrics: '[00:01.00]a' })});
      store.recordPlay({ id: 'yt1', title: '歌', artist: '手', filename: 'yt1.m4a' });
      const after = store.getEntry('yt1');
      store.recordPlay({ id: 'yt1', title: '歌', artist: '手', filename: 'yt1.m4a', lyrics: '[00:02.00]new', lyricsType: 'lrc' });
      const changed = store.getEntry('yt1');
      process.stdout.write(JSON.stringify({ after, changed }));
    `;
    const run = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    const { after, changed } = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.equal(after.album, '專輯');
    assert.equal(after.originalName, 'orig.mp3');
    assert.equal(after.lrcOffset, 350);
    assert.equal(after.lyricsDurationVerified, false);
    assert.equal(changed.lrcOffset, 0, '換了歌詞，舊歌詞的 LRC offset 不再適用');
    assert.equal(changed.lyricsDurationVerified, null);
    assert.equal(changed.album, '專輯');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('#47 歌曲庫改歌名／歌手：這場已唱歌單裡的那幾筆也要跟著改（OBS 歌單、YouTube 章節不再是舊名）', () => {
  const registerLibraryHandlers = require('../server/routes/handlers/library');
  const libraryStore = require('../server/services/library-store');
  const original = { peekEntry: libraryStore.peekEntry, updateMeta: libraryStore.updateMeta };
  const events = new Map();
  const io = { to() { return { emit() {} }; }, emit() {} };
  const socket = { id: 'ctl', clientType: 'controller', on(event, handler) { events.set(event, handler); }, emit() {} };
  const playState = { playlist: [], currentTrack: null };
  const session = { active: true, startedAt: 1, songs: [
    { id: 'song-1', entryId: 'a', title: '晴天版', artist: '', offset: 0 },
    { id: 'other', entryId: 'b', title: 'Other', artist: 'X', offset: 1000 },
    { id: 'song-1', entryId: 'c', title: '晴天版', artist: '', offset: 2000 },
  ] };
  const calls = { setlist: 0, persist: 0 };
  try {
    libraryStore.peekEntry = (id) => (id === 'song-1' ? { id, title: '晴天版' } : null);
    libraryStore.updateMeta = () => {};
    registerLibraryHandlers(io, socket, {
      playState, session,
      persistState: () => calls.persist++, emitSetlist: () => calls.setlist++, broadcastState: () => {},
    });
    let ack = null;
    events.get('library:update-meta')({ id: 'song-1', title: '晴天', artist: '周杰倫' }, (r) => { ack = r; });
    assert.equal(ack.ok, true);
    assert.deepEqual(session.songs.map((s) => [s.title, s.artist]), [['晴天', '周杰倫'], ['Other', 'X'], ['晴天', '周杰倫']]);
    assert.deepEqual(session.songs.map((s) => s.entryId), ['a', 'b', 'c'], '其他欄位不動');
    assert.equal(calls.setlist, 1, 'OBS 歌單要重送');
    assert.equal(calls.persist, 1, '要存檔');
  } finally {
    Object.assign(libraryStore, original);
  }
});

test('#54 YouTube 匯入要記下歌詞來源（社群偏移分來源記票、換來源時的偏移記憶都靠它）', async () => {
  const { audio } = auditImportFixture({ lyricsResult: { lyrics: '[offset:+300]\n[00:01.00]hello', type: 'lrc', source: 'lrclib', lrcOffset: 300 } });
  const track = await audio._processYouTube('https://youtube.com/watch?v=video123456');
  assert.equal(track.lyricsSource, 'lrclib');
  assert.equal(track.lrcOffset, 300);
});

test('#55 媒體庫的歌音檔被清掉後重新下載：使用者改過的歌名／歌手、選過的歌詞不可被重新解析的結果蓋掉', async () => {
  const previous = {
    id: 'video123456', title: '晴天', artist: '周杰倫', performer: '',
    lyrics: '[00:01.00]故事的小黃花', lyricsType: 'lrc', lyricsSource: 'manual',
    parsedLyrics: [{ time: 1000, text: '故事的小黃花', xieyin: '自己改的' }],
  };
  const { audio, saved } = auditImportFixture({ previous, lyricsResult: { lyrics: '[00:01.00]別的歌詞', type: 'lrc', source: 'lrclib' } });
  const track = await audio._processYouTube('https://youtube.com/watch?v=video123456');
  assert.deepEqual([track.artist, track.title], ['周杰倫', '晴天']);
  assert.equal(track.lyrics, previous.lyrics);
  assert.equal(track.lyricsSource, 'manual');
  assert.equal(track.parsedLyrics[0].xieyin, '自己改的');
  assert.equal(saved[0].lyrics, previous.lyrics, '寫回媒體庫的也是原本的歌詞');
  // 全新匯入照舊用這次的結果
  const fresh = auditImportFixture({ lyricsResult: { lyrics: '[00:01.00]hello', type: 'lrc', source: 'lrclib' } });
  const freshTrack = await fresh.audio._processYouTube('https://youtube.com/watch?v=video123456');
  assert.deepEqual([freshTrack.artist, freshTrack.title, freshTrack.lyrics], ['Artist', 'Song', '[00:01.00]hello']);
});

test('#56 在播放清單改歌名：這場已唱歌單裡的那幾筆也要跟著改（同 #47，另一個改名入口）', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const libraryStore = require('../server/services/library-store');
  const original = { peekEntry: libraryStore.peekEntry };
  const events = new Map();
  const io = { to() { return { emit() {} }; }, emit() {} };
  const socket = { id: 'ctl', clientType: 'controller', on(event, handler) { events.set(event, handler); }, emit() {} };
  const playState = { playlist: [{ id: 'song-1', entryId: 'e1', title: '晴天版', artist: '' }], currentTrack: null, playedEntryIds: new Set() };
  const session = { active: true, startedAt: 1, songs: [{ id: 'song-1', entryId: 'a', title: '晴天版', artist: '', offset: 0 }] };
  try {
    libraryStore.peekEntry = () => null;
    registerPlaylistHandlers(io, socket, {
      playState, session, persistState() {}, emitSetlist() {}, broadcastState() {},
      getPublicPlaylist: () => playState.playlist, getReadOnlyPlaylist: () => [], reconcilePlaybackProgress() {},
    });
    let ack = null;
    events.get('playlist:update')([{ id: 'song-1', entryId: 'e1', title: '晴天', artist: '周杰倫' }], (r) => { ack = r; });
    assert.equal(ack && ack.ok, true);
    assert.deepEqual(session.songs.map((s) => [s.title, s.artist]), [['晴天', '周杰倫']]);
  } finally {
    Object.assign(libraryStore, original);
  }
});
