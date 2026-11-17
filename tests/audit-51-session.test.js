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

test('#20 OBS 顯示端段落搭配：段落空隙／第一段之前不可跳到最後一段（尾奏）的模板', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../public/js/display.js'), 'utf8');
  const match = source.match(/function findSectionLabel\(sections, tSec\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'findSectionLabel');
  const findSectionLabel = new Function(`${match[0]}; return findSectionLabel;`)();
  const sections = [
    { start: 4, end: 20, label: 'verse' },
    { start: 25, end: 40, label: 'chorus' },
    { start: 40, end: 50, label: 'outro' },
  ];
  assert.equal(findSectionLabel(sections, 1), 'verse', '第一段之前');
  assert.equal(findSectionLabel(sections, 10), 'verse');
  assert.equal(findSectionLabel(sections, 22), 'verse', '空隙沿用前一段');
  assert.equal(findSectionLabel(sections, 30), 'chorus');
  assert.equal(findSectionLabel(sections, 55), 'outro', '最後一段之後');
  assert.equal(findSectionLabel([], 3), null);
});

test('#21 已唱歌單刪掉誤記的那首：要回到「接下來」，不可兩邊都消失', () => {
  const fs = require('fs');
  const path = require('path');
  const appStateSource = fs.readFileSync(path.join(__dirname, '../server/state/app-state.js'), 'utf8');
  const record = appStateSource.slice(appStateSource.indexOf('function recordSessionSong'));
  assert.match(record.slice(0, 1200), /playlistEntryId: playlistEntryId\(t\)/, '已唱紀錄要記住播放清單那一列的 entryId');

  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const events = new Map();
  const session = {
    active: true, startedAt: Date.now(), source: 'manual',
    songs: [
      { id: 'a', entryId: 's1', playlistEntryId: 'row-a', title: 'A' },
      { id: 'wrong', entryId: 's2', playlistEntryId: 'row-wrong', title: '點錯的歌' },
      { id: 'b', entryId: 's3', playlistEntryId: 'row-b', title: 'B' },
      { id: 'b', entryId: 's4', playlistEntryId: 'row-b', title: 'B（同一列又唱一次）' },
    ],
  };
  let broadcasts = 0;
  const playState = { playedEntryIds: new Set(['row-a', 'row-wrong', 'row-b']), currentTrack: null };
  registerSetlistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, {
    playState, session, effSetlistStore: () => ({}), persistState() {}, setlistPayload: () => ({}),
    emitSetlist() {}, recordSessionSong() {}, markTrackPlayed() {}, broadcastState() { broadcasts++; },
  });
  events.get('session:remove-song')({ entryId: 's2' });
  assert.equal(playState.playedEntryIds.has('row-wrong'), false, '刪掉後這一列回到未唱');
  assert.equal(broadcasts, 1, '面板清單的已唱標記也要更新');
  events.get('session:remove-song')({ entryId: 's3' });
  assert.equal(playState.playedEntryIds.has('row-b'), true, '同一列還有別筆已唱紀錄時保留已唱');
  assert.deepEqual([...playState.playedEntryIds].sort(), ['row-a', 'row-b']);
});

test('#22 收藏歌單加到一半滿了：已加入的那幾首要存檔、要回報，不能只留在記憶體', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-22-'));
  try {
    const script = `
      const saved = require(${JSON.stringify(path.join(__dirname, '../server/services/saved-playlists'))});
      const max = saved.MAX_TRACKS_PER_PLAYLIST;
      const created = saved.create({ name: 'full', trackIds: Array.from({ length: max - 2 }, (_, i) => 'old' + i) });
      const result = saved.addTracks(created.playlist.id, ['n1', 'n2', 'n3', 'n4']);
      saved.saveNow();
      process.stdout.write(JSON.stringify({ ok: result.ok, error: result.error, added: result.added, length: result.playlist && result.playlist.trackIds.length, max }));
    `;
    const run = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    const out = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.equal(out.ok, false);
    assert.equal(out.error, 'playlist_full');
    assert.equal(out.added, 2);
    assert.equal(out.length, out.max, '回報要帶目前歌單內容，面板才能同步');
    const handler = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/library.js'), 'utf8');
    assert.match(handler, /if \(result\.added\) broadcastSavedPlaylists\(\);/, '部分加入也要廣播');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('#30 刪除歌曲的確認視窗開著時清單被同步換掉：要刪對那一列，也不可用舊清單蓋掉新加的歌', async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app-playlist.js'), 'utf8');
  const start = source.indexOf('  async function removeTrack(index) {');
  const end = source.indexOf('\n  }\n', start) + 4;
  assert.ok(start > 0 && end > start);
  let resolveConfirm;
  const sent = [];
  const state = {
    currentTrackIndex: 0,
    playlist: [
      { id: 'a', entryId: 'e-a', title: 'A' },
      { id: 'b', entryId: 'e-b', title: 'B' },
      { id: 'c', entryId: 'e-c', title: 'C' },
    ],
  };
  const context = {
    state,
    window: { PanelConfirm: { request: () => new Promise((resolve) => { resolveConfirm = resolve; }) } },
    AppShared: { playTrack() {}, stopPlayback() {}, showToast() {} },
    renderPlaylist() {},
    SocketClient: { sendWithCallback: (event, payload) => sent.push([event, payload.map((t) => t.entryId)]) },
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}; this.removeTrack = removeTrack;`, context);
  const pending = context.removeTrack(2); // 要刪 C
  // 視窗開著時：Twitch 點歌插播了 X，伺服器同步換成新陣列（新物件）
  state.playlist = [
    { id: 'a', entryId: 'e-a', title: 'A' },
    { id: 'x', entryId: 'e-x', title: 'X' },
    { id: 'b', entryId: 'e-b', title: 'B' },
    { id: 'c', entryId: 'e-c', title: 'C' },
  ];
  resolveConfirm(true);
  await pending;
  assert.deepEqual(sent, [['playlist:update', ['e-a', 'e-x', 'e-b']]]);
});

test('#32 YouTube 章節：開台前就在播、點錯秒切、收台後又播，都不可讓整份章節失效', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const fmt = source.match(/function fmtSessionOffset\(ms\) \{[\s\S]*?\n  \}/)[0];
  const start = source.indexOf('  const MIN_CHAPTER_MS = 10000;');
  const end = source.indexOf('  function copyYoutubeChapters()');
  const build = new Function(`${fmt}\n${source.slice(start, end)}\nreturn buildYoutubeChapterLines;`)();
  // 開台前已在播 → 第一首當 00:00，不另外放「開台」
  assert.deepEqual(build([
    { title: 'A', offset: 120 }, { title: 'B', offset: 300000 }, { title: 'C', offset: 305000 }, { title: 'D', offset: 600000 },
    { title: 'E', offset: 0 },
  ], '00:00 開台'), ['00:00 A', '05:05 C', '10:00 D']);
  // 一般情況維持原樣
  assert.deepEqual(build([{ title: 'A', artist: 'X', offset: 60000 }, { title: 'B', offset: 3725000 }], '00:00 開台'),
    ['00:00 開台', '01:00 A - X', '1:02:05 B']);
});

test('#33 OBS 推流狀態查不到時不可收台；同一場直播被誤收台後再回報推流要接回、不清空已唱歌單', () => {
  const fs = require('fs');
  const path = require('path');
  const obs = fs.readFileSync(path.join(__dirname, '../public/js/obs-websocket.js'), 'utf8');
  assert.match(obs, /catch \(e\) \{ return \{ active: null, timecode: null \}; \}/, '查詢失敗要回報「不明」而不是「沒推流」');
  assert.match(obs, /if \(stream\.active !== true && stream\.active !== false\) return;/, '狀態不明時不動 Session');

  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const events = new Map();
  const startedAt = Date.now() - 3600000;
  const session = { active: true, startedAt, source: 'obs', songs: [{ id: 'a', entryId: 's1', title: 'A', offset: 60000 }] };
  const ctx = {
    playState: { isPlaying: false, currentTrack: null, playedEntryIds: new Set(), playlist: [] },
    session, effSetlistStore: () => ({}), persistState() {}, setlistPayload: () => ({}),
    emitSetlist() {}, recordSessionSong() {}, markTrackPlayed() {}, broadcastState() {},
  };
  registerSetlistHandlers({ emit() {} }, { on: (event, handler) => events.set(event, handler) }, ctx);
  events.get('session:stop')({ source: 'obs' });
  assert.equal(session.active, false);
  events.get('session:start')({ source: 'obs', startedAt: startedAt + 2000 });
  assert.equal(session.active, true);
  assert.equal(session.songs.length, 1, '已唱歌單要保留');
  assert.equal(session.startedAt, startedAt);
  // 真的是新的一場（開台時間差很多）才重來
  events.get('session:stop')({ source: 'obs' });
  events.get('session:start')({ source: 'obs', startedAt: Date.now() });
  assert.equal(session.songs.length, 0);
});

test('#34 同時連 OBS 與 Twitch：同一場直播兩邊輪流回報開台，不可互相清空已唱歌單', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-34-'));
  try {
    // Twitch 端用 socket-handler 的公開 API（隔離資料夾的子程序），OBS 端在下面用 setlist handler 驗
    const twitchScript = `
      const socketHandler = require(${JSON.stringify(path.join(__dirname, '../server/routes/socket-handler'))});
      const io = { on() {}, use() {}, emit() {} };
      const api = socketHandler(io);
      const started = Date.now() - 30 * 60 * 1000;
      api.startTwitchSession({ startedAt: started, eventId: 'online-1' });
      const s1 = api.getState().session;
      api.stopTwitchSession({ eventId: null });
      api.startTwitchSession({ startedAt: started + 3000, eventId: null });
      const s2 = api.getState().session;
      process.stdout.write(JSON.stringify({ s1: { active: s1.active, startedAt: s1.startedAt }, s2: { active: s2.active, startedAt: s2.startedAt, source: s2.source } , started }));
    `;
    const env = { ...process.env, ELITESAND_DATA_DIR: path.join(root, 'data'), ELITESAND_DOWNLOADS_DIR: path.join(root, 'dl'), ELITESAND_LOGS_DIR: path.join(root, 'logs') };
    const run = spawnSync(process.execPath, ['-e', twitchScript], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    const result = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.equal(result.s2.active, true, '同一場直播被收台後再開台要接回');
    assert.equal(result.s2.startedAt, result.started, '開台時間沿用原本那場');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // OBS 端：Session 是 Twitch 開的（source=twitch），OBS 重連回報同一場推流中不可清空
  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const events = new Map();
  const startedAt = Date.now() - 3600000;
  const session = { active: true, startedAt, source: 'twitch', songs: [{ id: 'a', entryId: 's1', title: 'A', offset: 60000 }] };
  registerSetlistHandlers({ emit() {} }, { on: (event, handler) => events.set(event, handler) }, {
    playState: { isPlaying: false, currentTrack: null, playedEntryIds: new Set(), playlist: [] },
    session, effSetlistStore: () => ({}), persistState() {}, setlistPayload: () => ({}),
    emitSetlist() {}, recordSessionSong() {}, markTrackPlayed() {}, broadcastState() {},
  });
  events.get('session:start')({ source: 'obs', startedAt: startedAt - 8000 });
  assert.equal(session.songs.length, 1, 'OBS 與 Twitch 開台時間差幾秒仍是同一場');
  assert.equal(session.source, 'twitch');
});

test('#35 直播中途才手動開台、之後才連上 OBS：沿用同一場、時間點往後挪，不清空已唱歌單', () => {
  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const events = new Map();
  const manualStart = Date.now() - 20 * 60 * 1000;
  const obsStart = manualStart - 40 * 60 * 1000; // OBS 其實 1 小時前就開始推流
  const session = { active: true, startedAt: manualStart, source: 'manual', songs: [{ id: 'a', entryId: 's1', title: 'A', offset: 5 * 60 * 1000 }] };
  registerSetlistHandlers({ emit() {} }, { on: (event, handler) => events.set(event, handler) }, {
    playState: { isPlaying: false, currentTrack: null, playedEntryIds: new Set(['row-a']), playlist: [] },
    session, effSetlistStore: () => ({}), persistState() {}, setlistPayload: () => ({}),
    emitSetlist() {}, recordSessionSong() {}, markTrackPlayed() {}, broadcastState() {},
  });
  events.get('session:start')({ source: 'obs', startedAt: obsStart });
  assert.equal(session.songs.length, 1);
  assert.equal(session.startedAt, obsStart);
  assert.equal(session.songs[0].offset, 45 * 60 * 1000, '時間點改成相對 OBS 開台時間');
  // 推流比 Session 晚開始＝真的新一場，照舊重來
  events.get('session:start')({ source: 'obs', startedAt: Date.now() });
  assert.equal(session.songs.length, 0);
});

test('#50 Twitch「!下一首」：同一首歌在清單出現兩次、或單曲模式唱完清空目前歌曲時，回的下一首要對', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-next-'));
  try {
    const script = [
      "const path=require('path'); const root=process.argv[1];",
      "const ap=require.resolve(path.join(root,'server/services/audio-processor'));",
      "require.cache[ap]={id:ap,filename:ap,loaded:true,exports:{}};",
      "const { TwitchService } = require(path.join(root,'server/services/twitch-service'));",
      "const playlist=[{id:'A',entryId:'e1',title:'A1'},{id:'B',entryId:'e2',title:'B'},{id:'A',entryId:'e3',title:'A2'},{id:'C',entryId:'e4',title:'C'}];",
      "let snap={};",
      "const s=new TwitchService({config:{},getPlaybackSnapshot:()=>snap,pendingStore:{load:()=>[],save:()=>{}},sessionStore:{load:()=>null,save:()=>true},historyStore:{load:()=>[],save:()=>true},authStore:{load:()=>null},timers:{setTimeout:()=>({unref(){}}),clearTimeout(){}}});",
      "const out={};",
      "snap={playlist,currentTrack:{...playlist[2]}}; out.dup=s.playbackSummary().next?.title; out.dupQueued=s.playbackSummary().queuedCount;",
      "snap={playlist,currentTrack:null,lastPlayedEntryId:'e2'}; out.afterEnd=s.playbackSummary().next?.title;",
      "snap={playlist,currentTrack:null}; out.fresh=s.playbackSummary().next?.title;",
      "s.stop(); process.stdout.write('__R__'+JSON.stringify(out)+'\\n'); process.exit(0);",
    ].join('\n');
    const child = spawnSync(process.execPath, ['-e', script, path.join(__dirname, '..')], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr);
    const out = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('__R__') + 5).trim().split(/\r?\n/, 1)[0]);
    assert.equal(out.dup, 'C', '正在唱第二次出現的 A，下一首是 C（不是 B）');
    assert.equal(out.dupQueued, 1);
    assert.equal(out.afterEnd, 'A2', '剛唱完 B（目前歌曲已清空），下一首是 B 後面那首');
    assert.equal(out.fresh, 'A1', '還沒唱過任何歌：清單第一首');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('#51 單曲模式唱完一首（目前歌曲已清空）時核准點歌選「下一首」：插在剛唱完那首後面，不是清單最後', () => {
  const { insertTracksIntoPlaylist } = require('../server/routes/handlers/playlist');
  const io = { to() { return { emit() {} }; }, emit() {} };
  const make = (overrides) => {
    const playState = { playlist: [
      { id: 'a1', entryId: 'e1', title: 'A' }, { id: 'b1', entryId: 'e2', title: 'B' }, { id: 'c1', entryId: 'e3', title: 'C' },
    ], currentTrack: null, lastPlayedEntryId: 'e1', ...overrides };
    const ctx = { playState, persistState() {}, emitSetlist() {}, broadcastState() {}, getPublicPlaylist: () => playState.playlist, trackOffsets: new Map() };
    return { playState, ctx };
  };
  const { playState, ctx } = make();
  const result = insertTracksIntoPlaylist(ctx, io, [{ id: 'req1', title: 'Request' }], { mode: 'insert-next' });
  assert.equal(result.ok, true);
  assert.equal(result.placement, 'next');
  assert.deepEqual(playState.playlist.map((t) => t.title), ['A', 'Request', 'B', 'C']);
  // 從來沒唱過任何歌：照舊加到最後
  const fresh = make({ lastPlayedEntryId: null });
  const r2 = insertTracksIntoPlaylist(fresh.ctx, io, [{ id: 'req1', title: 'Request' }], { mode: 'insert-next' });
  assert.equal(r2.placement, 'end');
  assert.deepEqual(fresh.playState.playlist.map((t) => t.title), ['A', 'B', 'C', 'Request']);
});

test('#111 已唱歌單：清單排了兩次同一首、連著唱，第二次也要記；同一列重播不重複記', () => {
  const { createAppState } = require('../server/state/app-state');
  const app = createAppState({ emit() {}, to() { return { emit() {} }; } });
  app.session.songs.length = 0;
  app.playState.currentTrack = { id: 'encore', entryId: 'row-1', title: '安可曲' };
  app.recordSessionSong();
  app.recordSessionSong(); // 同一列從頭再唱
  app.playState.currentTrack = { id: 'encore', entryId: 'row-2', title: '安可曲' };
  app.recordSessionSong(); // 清單第二列的同一首
  assert.equal(app.session.songs.length, 2);
  app.session.songs.length = 0;
});
