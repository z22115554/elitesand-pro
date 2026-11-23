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

test('#1 YouTube /live/ 連結（歌枠存檔常見）要能辨識影片 ID', () => {
  const { parseYouTubeUrl, isYouTubeUrl, extractVideoId } = require('../server/utils/youtube-url');
  assert.equal(extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
  assert.equal(isYouTubeUrl('https://youtube.com/live/dQw4w9WgXcQ'), true);
  assert.equal(parseYouTubeUrl('https://m.youtube.com/live/dQw4w9WgXcQ?feature=share').videoId, 'dQw4w9WgXcQ');
});

test('#1 面板的 YouTube 連結檢查不可比伺服器嚴格', () => {
  const context = loadBrowserScript('error-handler.js');
  const ErrorHandler = vm_get(context, 'ErrorHandler');
  const accepted = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?si=abc&v=dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  ];
  for (const url of accepted) assert.equal(ErrorHandler.validateYouTubeUrl(url).valid, true, url);
  for (const url of ['https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/@channel', 'not a url']) {
    assert.equal(ErrorHandler.validateYouTubeUrl(url).valid, false, url);
  }
});

test('#1 黑名單貼 /live/、/embed/ 連結時要存成影片 ID，否則永遠比對不到', () => {
  const RequestSettings = require('../public/js/twitch-request-settings');
  const settings = RequestSettings.normalizeSettings({
    blacklist: [
      { id: 'a', type: 'video', value: 'https://www.youtube.com/live/dQw4w9WgXcQ?si=x' },
      { id: 'b', type: 'video', value: 'https://www.youtube.com/embed/abcdefghijk' },
    ],
  });
  assert.deepEqual(settings.blacklist.map((rule) => rule.value), ['dQw4w9WgXcQ', 'abcdefghijk']);
  assert.equal(RequestSettings.findBlacklistMatch(settings, { videoId: 'dQw4w9WgXcQ', phase: 'pre' })?.id, 'a');
});

test('#2 LRC 沒有小數秒的時間戳 [mm:ss] 不可被當成 0 秒', () => {
  const { parseTimestampToMs } = require('../server/utils/time-utils');
  assert.equal(parseTimestampToMs('01:23'), 83000);
  assert.equal(parseTimestampToMs('01:23.4'), 83400);
  assert.equal(parseTimestampToMs('01:23.45'), 83450);
  assert.equal(parseTimestampToMs('01:23.456'), 83456);
  assert.equal(parseTimestampToMs('01:23:45'), 83450);
});

test('#2 LRC 常見變體（[mm:ss]、一位小數、一位數分鐘、冒號小數）不可整行消失', () => {
  const { parseLrc, autoParseLyrics } = require('../server/services/lrc-parser');
  const { lines } = parseLrc('[00:05]first\n[00:10.5]second\n[1:20.00]third\n[01:25:30]fourth\n[00:30.123]fifth');
  assert.deepEqual(lines.map((line) => [line.time, line.text]), [
    [5000, 'first'], [10500, 'second'], [30123, 'fifth'], [80000, 'third'], [85300, 'fourth'],
  ]);
  const auto = autoParseLyrics('[ti:x]\n[00:05]hello\n[00:10]world');
  assert.equal(auto.type, 'lrc');
  assert.deepEqual(auto.lines.map((line) => line.time), [5000, 10000]);
});

test('#3 SRT：CRLF 不可殘留在字幕文字裡，省略序號的區塊也要保留', () => {
  const { autoParseLyrics } = require('../server/services/lrc-parser');
  const srt = '1\r\n00:00:01,000 --> 00:00:03,000\r\nHello\r\nworld\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nSecond line\r\n\r\n00:00:07,000 --> 00:00:08,000\r\nNo index\r\n';
  const parsed = autoParseLyrics(srt);
  assert.equal(parsed.type, 'srt');
  assert.deepEqual(parsed.lines.map((line) => [line.time, line.text]), [
    [1000, 'Hello world'], [4000, 'Second line'], [7000, 'No index'],
  ]);
});

test('#10 歌手拆分：feat／ft 要是完整單字，FTISLAND、Featherweight 不可被拆開', () => {
  const { lyricQueryVariants } = require('../server/services/lyric-query-variants');
  assert.deepEqual(lyricQueryVariants('FTISLAND', 'Love Love Love').map((v) => v.artist), ['FTISLAND']);
  assert.deepEqual(lyricQueryVariants('Featherweight', 'Song').map((v) => v.artist), ['Featherweight']);
  assert.deepEqual(lyricQueryVariants('A feat. B', 'Song').map((v) => v.artist), ['A feat. B', 'A B', 'A']);
});

test('#17 Stream Deck 指令要跟面板的同名操作一致（互動演出通知、切換風格清掉舊微調）', () => {
  const { createDeckCommands } = require('../server/routes/deck-commands');
  const emitted = [];
  const overlayCalls = [];
  const ctx = {
    playState: { isPlaying: false, currentTrack: { id: 't1', title: 'Song' }, style: 'a', styleOverrides: { glow: 3 } },
    trackOffsets: new Map(),
    persistState() {}, broadcastState() {}, getPublicState: () => ({}), markTrackPlayed() {}, recordSessionSong() {}, emitSetlist() {},
    overlayShow: {
      onTrackPlaying: (track) => overlayCalls.push(['playing', track.id]),
      setSongState: (playing, reason) => overlayCalls.push(['songState', playing, reason]),
    },
  };
  const io = { emit: (event, payload) => emitted.push([event, payload]) };
  const run = createDeckCommands(io, ctx);
  run('play-toggle');
  assert.deepEqual(overlayCalls, [['playing', 't1'], ['songState', true, 'pause']]);
  run('play-toggle');
  assert.deepEqual(overlayCalls.at(-1), ['songState', false, 'pause']);
  run('style', { name: 'neon' });
  assert.deepEqual(ctx.playState.styleOverrides, {});
  assert.ok(emitted.some(([event, payload]) => event === 'style:override' && Object.keys(payload).length === 0));
});

test('#41 Twitch 聊天室指令：全形「！點歌」、全形空白、多個空白都要認得', () => {
  const TwitchRequestSettings = require('../public/js/twitch-request-settings');
  const rules = TwitchRequestSettings.getDefaults();
  const match = (text) => {
    const result = TwitchRequestSettings.matchCommand(text, rules);
    return result ? [result.key, result.argument] : null;
  };
  assert.deepEqual(match('！點歌 https://youtu.be/dQw4w9WgXcQ'), ['request', 'https://youtu.be/dQw4w9WgXcQ']);
  assert.deepEqual(match('!點歌　https://youtu.be/dQw4w9WgXcQ'), ['request', 'https://youtu.be/dQw4w9WgXcQ']);
  assert.deepEqual(match('!點歌  晴天   周杰倫'), ['request', '晴天 周杰倫']);
  assert.deepEqual(match('!點歌 https://youtu.be/dQw4w9WgXcQ'), ['request', 'https://youtu.be/dQw4w9WgXcQ']);
  assert.equal(match('!點歌晴天'), null, '指令後面沒有分隔不算');
  const fs = require('fs');
  const path = require('path');
  // 聊天指令在 Twitch 服務拆檔後住在 twitch-service/requests.js
  const service = fs.readFileSync(path.join(__dirname, '../server/services/twitch-service/requests.js'), 'utf8');
  assert.ok(service.includes("text.normalize('NFKC').match(/^!(?:挑戰|challenge)"), '全形！挑戰也要認得');
});

test('#43 從 YouTube 自動合輯（list=RD…）複製的單曲網址：匯入只抓那一首、Twitch 點歌照收，真正的播放清單照舊', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const { isSingleVideoInMix, isRadioMixId } = require('../server/utils/youtube-url');
  const MIX = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1';
  assert.equal(isRadioMixId('RDdQw4w9WgXcQ'), true);
  assert.equal(isRadioMixId('PLabc'), false);
  assert.equal(isSingleVideoInMix(MIX), true);
  assert.equal(isSingleVideoInMix('https://youtu.be/dQw4w9WgXcQ?list=RDMMdQw4w9WgXcQ'), true);
  assert.equal(isSingleVideoInMix('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890'), false);
  assert.equal(isSingleVideoInMix('https://www.youtube.com/playlist?list=RDCLAK5uy_abc'), false, '沒有影片 ID 的合輯網址不是單曲');

  // 前端匯入框：合輯單曲不可走「整份播放清單」匯入
  const importSrc = fs.readFileSync(path.join(__dirname, '../public/js/app-youtube-import.js'), 'utf8');
  const decide = new Function('url', `${importSrc.match(/const listId = [^\n]+\n[^\n]+\n[^\n]+\n/)[0]} return listId && !singleInMix;`);
  assert.equal(decide(MIX), false, '合輯單曲走單首匯入');
  assert.equal(decide('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890'), true);
  assert.equal(decide('https://www.youtube.com/playlist?list=RDCLAK5uy_abc'), true);
  assert.equal(decide('https://youtu.be/dQw4w9WgXcQ'), '');

  // Twitch !點歌：合輯單曲收下且網址只留影片本身；PL 播放清單照樣擋
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-mix-'));
  try {
    const script = [
      "const path=require('path'); const root=process.argv[1];",
      "const ap=require.resolve(path.join(root,'server/services/audio-processor'));",
      "require.cache[ap]={id:ap,filename:ap,loaded:true,exports:{}};",
      "const { TwitchService } = require(path.join(root,'server/services/twitch-service'));",
      "const RS=require(path.join(root,'public/js/twitch-request-settings'));",
      "(async()=>{ const out=[];",
      "for (const link of [process.argv[2], process.argv[3]]) {",
      "  const accepted=[], replies=[], metadata=[]; let saved=[];",
      "  const s=new TwitchService({config:{},onSongRequest:r=>{accepted.push(r);return true;},pendingStore:{load:()=>saved,save:v=>{saved=v;}},sessionStore:{load:()=>null,save:()=>true},historyStore:{load:()=>[],save:()=>true},authStore:{load:()=>null},timers:{setTimeout:()=>({unref(){}}),clearTimeout(){}}});",
      "  s.setRequestSettings(RS.getDefaults());",
      "  s.fetchYouTubeMetadata=async u=>{metadata.push(u);return {title:'Song',author:'Artist',duration:180,metadataAvailable:true,assessment:{warningTypes:[]}};};",
      "  s.sendConfiguredReply=async(_e,key)=>{replies.push(key);return {sent:true};}; s.sendCommandReply=s.sendConfiguredReply;",
      "  await s.handleChatMessage({message_id:'m'+out.length,chatter_user_id:'u',chatter_user_login:'u',chatter_user_name:'U',badges:[],message:{text:'!點歌 '+link}});",
      "  out.push({accepted:accepted.length, url:accepted[0]?.url||'', metadata, replies}); s.stop(); }",
      "process.stdout.write('__R__'+JSON.stringify(out)+'\\n'); process.exit(0); })().catch(e=>{console.error(e);process.exit(1);});",
    ].join('\n');
    const child = spawnSync(process.execPath, ['-e', script, path.join(__dirname, '..'), MIX, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890'], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr);
    const [mix, playlist] = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('__R__') + 5).trim().split(/\r?\n/, 1)[0]);
    assert.equal(mix.accepted, 1, `合輯單曲要收下（replies: ${mix.replies}）`);
    assert.equal(mix.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.deepEqual(mix.metadata, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
    assert.equal(playlist.accepted, 0);
    assert.ok(playlist.replies.includes('playlistNotAllowed'));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('#57 BGM 淡出後才暫停的計時器：淡出期間又開始播放時要取消，不可把剛恢復的 BGM 暫停掉', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../public/js/app-bgm.js'), 'utf8');
  const start = src.slice(src.indexOf('function startPlayback()'), src.indexOf('function pausePlayback()'));
  const pause = src.slice(src.indexOf('function pausePlayback()'), src.indexOf('function scheduleResume('));
  assert.match(start, /clearTimeout\(pauseAfterFadeTimer\)/, 'startPlayback 要取消尚未執行的淡出暫停');
  assert.match(pause, /pauseAfterFadeTimer = setTimeout\(/, 'pausePlayback 要記下計時器才取消得掉');
});

test('#58 BGM 正在播的那首被移出清單：要接著播下一首，不可換掉音源後就停在「播放中但沒聲音」', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../public/js/app-bgm.js'), 'utf8');
  const apply = src.slice(src.indexOf('function applyPlaylist('), src.indexOf('function requestPlaylist('));
  assert.match(apply, /localPlaying\) loadTrack\(0, true\)/);
});

test('#60 OBS 一鍵建立來源：來源已存在但在別的場景時，要加進目前場景（不是只更新設定）', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../public/js/obs-websocket.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function ensureBrowserSource('), src.indexOf('async function createBrowserSources('));
  assert.match(fn, /GetSceneItemId/);
  assert.match(fn, /CreateSceneItem/);
});

test('#65 魔法書模板：左右邊距設成 0 要真的是 0（不可被 `|| 60` 當成沒設定）', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../public/js/lyric-template-spellbook.js'), 'utf8');
  assert.ok(!src.includes('Number(cfg.paddingX) || 60'));
  const line = src.split(/\r?\n/).find((l) => l.includes('const padX = clamp('));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const run = (paddingX) => new Function('cfg', 'clamp', 'cssW', `const padValue = Number(cfg.paddingX);\n${line}\nreturn padX;`)({ paddingX }, clamp, 1920);
  assert.equal(run(0), 0);
  assert.equal(run(120), 120);
  assert.equal(run(undefined), 60);
});

test('#88 歌曲筆記的 trackId 是「constructor」「__proto__」時不能炸、也不能污染其他歌', () => {
  const store = { data: {} };
  const sn = loadAuditModule('server/services/song-notes.js', {
    './json-store': { createJsonStore: () => ({ load: () => ({}), save: (v) => { store.data = v; return true; } }) },
    '../utils/logger': { createLogger: () => new Proxy({}, { get: () => () => {} }) },
    '../utils/app-paths': { dataDir: '/tmp' },
  });
  assert.equal(sn.get('constructor').lines.length, 0);
  sn.set('__proto__', { songNote: '換氣' });
  assert.equal(sn.get('__proto__').songNote, '換氣');
  assert.equal(sn.get('別首').songNote, '');
  sn.saveNow();
});

test('#98 網址後面直接黏著標點（「…youtu.be/ID。」「…v=ID）」）也認得出影片，送去下載的是清過的網址', () => {
  const { parseYouTubeUrl, isYouTubeUrl } = require('../server/utils/youtube-url');
  assert.equal(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ。').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ）').url, 'https://youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ！').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeUrl('https://youtu.be/abc_DEF-12-').videoId, 'abc_DEF-12-', 'ID 本身的 - _ 不能剝');
  assert.equal(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ，謝謝'), false, '後面接文字仍然不算');
  // 面板的驗證要跟伺服器一致
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const sandbox = { document: { addEventListener() {} }, console, setTimeout, URL, SharedUtils: { escapeHtml: (x) => x } };
  sandbox.window = sandbox;
  const EH = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../public/js/error-handler.js'), 'utf8')}\n;ErrorHandler`, sandbox);
  const v = EH.validateYouTubeUrl('https://youtu.be/dQw4w9WgXcQ。');
  assert.equal(v.valid, true);
  assert.equal(v.url, 'https://youtu.be/dQw4w9WgXcQ');
});

test('#106 Twitch：同時好幾個地方要更新 token 時只送一次（public client 的 refresh token 是一次性的）', async () => {
  const { TwitchService } = require('../server/services/twitch-service');
  const memStore = (value = null) => ({ load: () => value, save() { return true; }, clear() {}, remove() {} });
  const service = new TwitchService({
    config: {}, pendingStore: memStore([]), sessionStore: memStore(null), historyStore: memStore([]), authStore: memStore(null),
    timers: { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} },
  });
  let calls = 0;
  let release;
  service._refreshToken = () => { calls += 1; return new Promise((resolve) => { release = resolve; }); };
  const a = service.refreshToken();
  const b = service.refreshToken();
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  const c = service.refreshToken();
  release();
  await c;
  assert.equal(calls, 2, '前一次結束後可以再更新');
});

test('#107 OBS WebSocket 密碼錯（或 OBS 要密碼卻沒填）時停止自動重連，不再每 15 秒用錯的密碼敲 OBS', async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const sockets = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; sockets.push(this); setImmediate(() => this.onmessage && this.onmessage({ data: JSON.stringify({ op: 0, d: { authentication: { salt: 's', challenge: 'c' } } }) })); }
    send() {}
    close() { setImmediate(() => this.onclose && this.onclose({ code: 1000 })); }
  }
  const timers = [];
  const ctx = {
    window: {}, document: { getElementById: () => null }, WebSocket: FakeWebSocket, console,
    // 逾時與重連計時器只記下來不執行，看它有沒有排重連就好
    setTimeout: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    setImmediate, crypto: require('crypto').webcrypto, TextEncoder, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };
  const src = fs.readFileSync(path.join(__dirname, '../public/js/obs-websocket.js'), 'utf8');
  const ObsWs = vm.runInNewContext(`${src}\n;ObsWs`, ctx);
  const statuses = [];
  ObsWs.on('status', (s) => statuses.push(s));
  const error = await ObsWs.connect({ host: '127.0.0.1', port: 4455, password: '' }).catch((e) => e);
  assert.equal(error.authFailed, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!statuses.some((s) => s.reconnecting), '密碼問題不排重連');
  assert.equal(sockets.length, 1);
});

test('#108 BGM：play() 還在載入時開始唱歌，載入完不能照樣淡入、疊在歌上', async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  let resolvePlay;
  const audio = { play: () => new Promise((r) => { resolvePlay = r; }), pause() { audio.paused = true; }, addEventListener() {}, style: {}, paused: false };
  const handlers = {};
  const sent = [];
  const ctx = {
    SharedUtils: { escapeHtml: (x) => x },
    document: { getElementById: () => null, createElement: () => audio, body: { appendChild() {} }, addEventListener() {}, readyState: 'complete', activeElement: null },
    window: { addEventListener() {} },
    SocketClient: { on: (e, f) => { handlers[e] = f; }, send: (e, d) => sent.push([e, d]), sendWithCallback() {} },
    AudioContext: class { constructor() { this.currentTime = 0; } createMediaElementSource() { return { connect() {} }; } createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; } get destination() { return {}; } },
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {}, console,
  };
  ctx.window.AudioContext = ctx.AudioContext;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/app-bgm.js'), 'utf8'), ctx);
  handlers['bgm:settings:update']({ enabled: true, volume: 70, pauseResumeDelayMs: 0, endResumeDelayMs: 0 });
  handlers['bgm:playlist']({ tracks: [{ id: 'a', filename: 'a.mp3' }] });
  ctx.window.AppBgm.syncWithPlayback(false, 'end'); // 開始播 BGM（play 還沒 resolve）
  ctx.window.AppBgm.syncWithPlayback(true);         // 馬上開始唱歌
  resolvePlay();
  await new Promise((r) => setImmediate(r));
  assert.equal(audio.paused, true, 'BGM 要停下來');
  assert.ok(!sent.some(([e, d]) => e === 'bgm:status' && d.playing === true), '不能回報 BGM 正在播');
});

test('#110 匯出播放清單的檔名：Windows 保留裝置名（CON、NUL…）、結尾句點、控制字元', () => {
  const { sanitizeName } = require('../server/services/playlist-export-store');
  assert.equal(sanitizeName('CON'), '_CON');
  assert.equal(sanitizeName('nul'), '_nul');
  assert.equal(sanitizeName('Com1.list'), '_Com1.list');
  assert.equal(sanitizeName('console'), 'console');
  assert.equal(sanitizeName('abc.'), 'abc');
  assert.equal(sanitizeName('a\tb\u0001c'), 'a b c');
  assert.equal(sanitizeName('歌回 11/13'), '歌回 11 13');
});
