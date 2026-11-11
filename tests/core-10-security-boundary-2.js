'use strict';

// 核心回歸測試（security-boundary-2）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  vm,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const xieyin = require('../server/services/xieyin');
const romanizer = require('../server/services/romanizer');

test('play:stop 清空目前歌曲並廣播，播放清單播完最後一首才不會讓歌詞卡在畫面上', () => {
  // 使用者實測回報：唱完最後一首後，歌詞（OBS 顯示端／跟唱視圖）留在畫面上不會消失。
  // 根因：playState.currentTrack 過去沒有任何地方會被設回 null，播完清單最後一首、
  // 沒有下一首可接時完全沒有訊號通知顯示端清空。
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const events = new Map();
  const emitted = [];
  const playState = {
    currentTrack: { id: 'last-song', title: '最後一首' },
    currentTrackStarted: true,
    isPlaying: true,
    currentTime: 123,
  };
  let setlistCalls = 0;
  let broadcastCalls = 0;
  let persistCalls = 0;
  registerPlaybackHandlers(
    { emit(event, data) { emitted.push({ event, data }); } },
    { on(event, handler) { events.set(event, handler); }, emit() {} },
    {
      playState, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map(),
      persistState() { persistCalls++; },
      emitSetlist() { setlistCalls++; },
      recordSessionSong() {},
      broadcastState() { broadcastCalls++; },
      getEffectiveLyrics() { return null; },
    },
  );

  events.get('play:stop')();

  eq(playState.currentTrack, null, 'play:stop 必須清空 currentTrack，否則顯示端沒有訊號可以清空歌詞：');
  eq(playState.currentTrackStarted, false);
  eq(playState.isPlaying, false);
  eq(playState.currentTime, 0);
  ok(emitted.some((item) => item.event === 'play:stop'), '必須轉播 play:stop，顯示端/跟唱視圖才會即時清空（不能只等下一次 state:sync）：');
  eq(setlistCalls, 1, '必須廣播 setlist:update，歌單頁的「現在播放」才會跟著清空：');
  eq(broadcastCalls, 1, '必須廣播完整狀態，重連/新連線的客戶端也要看到目前沒有歌曲在播：');
  eq(persistCalls, 1, '必須持久化，重開程式後不能又冒出剛剛播完的那首：');
});

test('播放秒數只留在記憶體，暫停時只保存目前歌曲狀態', () => {
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const events = new Map();
  let persisted = 0;
  const playState = {
    currentTrack: { id: 'recovery-song', entryId: 'recovery-entry', title: '恢復測試' },
    currentTrackStarted: true,
    currentTime: 0,
    isPlaying: true,
    playedEntryIds: new Set(['recovery-entry']),
    lastPlayedEntryId: 'recovery-entry',
  };
  registerPlaybackHandlers(
    { emit() {} },
    { on(event, handler) { events.set(event, handler); }, emit() {} },
    {
      playState, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map(),
      persistState() { persisted++; }, emitSetlist() {}, recordSessionSong() {}, broadcastState() {},
      getEffectiveLyrics() { return null; }, markTrackPlayed() {},
    },
  );

  events.get('lyrics:sync')({ currentTime: 12.5, duration: 200, trackId: 'recovery-song' });
  events.get('lyrics:sync')({ currentTime: 12.8, duration: 200, trackId: 'recovery-song' });
  eq(playState.currentTime, 12.8);
  eq(persisted, 0, '高頻歌詞同步只能留在記憶體，不可排程寫磁碟：');

  events.get('lyrics:sync')(null);
  events.get('lyrics:sync')({ currentTime: Infinity, trackId: 'recovery-song' });
  eq(playState.currentTime, 12.8, '畸形 lyrics:sync 不可拋例外或污染播放時鐘：');

  events.get('play:seek')({ time: 88, trackId: 'recovery-song' });
  eq(playState.currentTime, 88);
  eq(persisted, 0, '使用者拖曳位置也不保存歌曲內秒數：');
  events.get('play:seek')({ time: 'not-a-number', trackId: 'recovery-song' });
  eq(playState.currentTime, 88, '字串 seek 必須忽略：');
  events.get('play:seek')({ time: -20, trackId: 'recovery-song' });
  eq(playState.currentTime, 0, '負數 seek 必須夾到 0：');

  events.get('play:toggle')(false);
  eq(persisted, 1, '暫停時只保存目前歌曲與已唱狀態，不保存秒數：');
});

test('單曲模式與 SoundTouch 播畢都會清空目前歌曲並送出 play:stop', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
  const endedFn = source.slice(source.indexOf('function handlePlaybackEnded()'), source.indexOf('function handlePlaybackEnded()') + 1500);
  ok(source.includes('SoundTouchEngine.onEnded(() => handlePlaybackEnded())'),
    'SoundTouch 播畢必須走和原生 audio 相同的清空流程：');
  ok(source.includes("audioPlayer.addEventListener('ended', handlePlaybackEnded)"),
    '原生 audio 播畢必須走共用流程：');
  ok(endedFn.includes('if (next) {') && endedFn.includes('return;'),
    '連續播放且仍有下一首時必須直接播放下一首：');
  ok(endedFn.includes('stopPlayback();') && endedFn.includes("SocketClient.send('play:stop',"),
    '單曲模式或清單尾端必須本地清空並廣播 play:stop：');
});

test('OBS 顯示端／跟唱視圖／遙控器都要接 play:stop 才能清空歌詞，不能只有面板自己知道', () => {
  const displaySource = fs.readFileSync(path.join(__dirname, '../public/js/display.js'), 'utf8');
  const prompterSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(__dirname, '../public/js/controller.js'), 'utf8');
  const playbackSource = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');

  ok(displaySource.includes("SocketClient.on('play:stop', () => {") && displaySource.includes('KaraokeEngine.clearDisplay({ hard: true })'),
    'OBS 顯示端必須監聽 play:stop 並 hard 清空歌詞畫面（連歌詞來源一起清、停時鐘）：');

  // hard 清空：整首播完時 clearDisplay 必須把 parsedLyrics 清空並停時鐘，
  // 否則殘留的一幀 onFrame 會用 ctx.getLyrics() 把最後一頁重畫回來（KTV／紙帶／鏡像／燈牌…）。
  const karaokeSource = fs.readFileSync(path.join(__dirname, '../public/js/karaoke.js'), 'utf8');
  const clearBody = karaokeSource.slice(karaokeSource.indexOf('function clearDisplay('), karaokeSource.indexOf('function clearDisplay(') + 900);
  ok(/function clearDisplay\(opts\)/.test(karaokeSource) && clearBody.includes('opts && opts.hard')
    && clearBody.includes('parsedLyrics = []') && clearBody.includes('isRunning = false'),
    'clearDisplay 必須支援 hard 模式：清空 parsedLyrics + 停時鐘，供「整首播完」使用：');
  ok(prompterSource.includes("SocketClient.on('play:stop', () => {") && prompterSource.includes('resetToEmpty();'),
    '跟唱視圖必須監聽 play:stop 並重置回空狀態：');
  ok(controllerSource.includes("SocketClient.on('play:stop', () => {"), '手機遙控器也要監聽 play:stop，不能只有 OBS/跟唱視圖清空、遙控器還停在最後一首：');
  ok(playbackSource.includes("SocketClient.on('play:stop', (payload) => {"),
    '面板自己也要監聽 play:stop：另一個已連線的面板分頁播完清單時，這個分頁才會跟著清空：');

  // 歌曲播完 → clearDisplay() → 每個 registry 模板的 onLyricsLoaded([]) 都必須真的把畫面清乾淨
  // （播完後 onFrame 不會再跑，模板不能靠下一幀自己清）。
  const clearFnByTpl = {
    pulse: 'clearAll', facet: 'clearAll', drift: 'clearAll',
    aura: 'retireCurrentLine(true)', ktv: 'clearSlot(slots.top)',
    columnflow: 'clearAllColumns', paperstrip: 'clearPageViews',
    mirror: 'clearPanels', typewriter: 'clearAll',
  };
  for (const [tpl, marker] of Object.entries(clearFnByTpl)) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', `lyric-template-${tpl}.js`), 'utf8');
    const body = src.slice(src.indexOf('onLyricsLoaded'), src.indexOf('onLyricsLoaded') + 320);
    ok(body.includes(marker), `${tpl} 的 onLyricsLoaded 必須實際清空畫面（歌曲播完不能留最後一句）: `);
  }
  const lbSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lyric-template-lightboard.js'), 'utf8');
  const lbBody = lbSrc.slice(lbSrc.indexOf('onLyricsLoaded'), lbSrc.indexOf('onLyricsLoaded') + 420);
  ok(lbBody.includes("textEl.textContent = ''") && lbBody.includes('idleEl.hidden = true'),
    '燈牌 onLyricsLoaded 必須把點陣文字清掉（原本只 reset state、不清 DOM，歌曲播完燈板會留字）: ');
});

test('playlist:insert-next uses canonical playback state and appends only when idle', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const first = { id: 'first', title: '第一首' };
  const current = { id: 'current', title: '目前歌曲' };
  const later = { id: 'later', title: '原本下一首' };
  const playState = { playlist: [first, current, later], currentTrack: current };
  let setlist = 0;
  let broadcast = 0;
  let persisted = 0;
  const ctx = {
    playState, trackOffsets: new Map(), manualLyricsCache: new Map(),
    emitSetlist() { setlist += 1; }, broadcastState() { broadcast += 1; }, persistState() { persisted += 1; },
    getPublicPlaylist() { return playState.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  let acknowledgement;
  events.get('playlist:insert-next')({ id: 'twitch-next', title: '插播歌曲' }, (result) => { acknowledgement = result; });
  eq(acknowledgement.ok, true);
  eq(acknowledgement.placement, 'next');
  eq(acknowledgement.insertAt, 2);
  eq(playState.playlist.map((track) => track.id).join(','), 'first,current,twitch-next,later');
  eq(setlist, 1);
  eq(broadcast, 1);
  eq(persisted, 1);

  playState.currentTrack = null;
  events.get('playlist:insert-next')({ id: 'idle-append', title: '待命歌曲' }, (result) => { acknowledgement = result; });
  eq(acknowledgement.placement, 'end');
  eq(acknowledgement.insertAt, 4);
  eq(playState.playlist[4].id, 'idle-append');
});

test('OBS 未推流只結束 OBS 或待確認的直播 Session，不會中斷 Twitch Session', () => {
  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const events = new Map();
  const session = { active: true, startedAt: Date.now() - 1000, source: null, songs: [] };
  const ctx = {
    playState: {
      isPlaying: false, currentTrack: null, setlistTheme: 'glass', setlistLayout: 'classic',
      setlistStyle: {}, setlistSceneStyles: {},
    },
    session, SETLIST_SCENE: [],
    effSetlistStore() { return {}; },
    persistState() {}, setlistPayload() { return { ...session }; }, emitSetlist() {},
    recordSessionSong() {}, broadcastState() {},
  };
  registerSetlistHandlers(
    { emit() {} },
    { on(event, handler) { events.set(event, handler); }, emit() {} },
    ctx,
  );

  events.get('session:stop')({ source: 'obs' });
  eq(session.active, false);
  eq(session.source, null);

  session.active = true;
  session.source = 'twitch';
  events.get('session:stop')({ source: 'obs' });
  eq(session.active, true);
  eq(session.source, 'twitch');

  events.get('session:stop')({ source: 'twitch' });
  eq(session.active, false);
  eq(session.source, null);
});

test('OBS 顯示語言：server 的語言清單不可跟面板的翻譯表漂掉', () => {
  // server 端刻意不 require public/js/i18n.js（那是整份翻譯表，打包時會被併進頁面
  // bundle 並刪掉原始檔；server 只需要語言代碼本身）。代價是清單有兩份，這裡比對。
  const serverLocales = require('../server/utils/obs-locale');
  const browserI18n = require('../public/js/i18n');
  eq(serverLocales.LOCALES.join(','), browserI18n.LOCALES.join(','), 'server 與面板的語言清單必須一致：');
  eq(serverLocales.DEFAULT_LOCALE, browserI18n.DEFAULT_LOCALE, '預設語言必須一致：');
  const localeUtilCode = fs.readFileSync(path.join(__dirname, '../server/utils/obs-locale.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!localeUtilCode.includes("require('../../public/js/i18n')"),
    'server 不可 require 面板的翻譯表（打包後那個檔案不存在，一啟動就 Cannot find module）：');
});

test('OBS 顯示語言：選單與面板語言各自獨立，跟隨模式才會被面板語言帶動', () => {
  // 這條線存在的理由：疊加層的語言是頁面載入當下解析一次的，OBS 又是獨立的瀏覽器
  // profile，讀不到面板的 localStorage——沒有這個廣播，直播中途換語言 OBS 不會變。
  const registerObsLocaleHandlers = require('../server/routes/handlers/obs-locale');
  const events = new Map();
  const emitted = [];
  let persisted = 0;
  const playState = { obsLocale: 'follow', panelLocale: 'zh-TW' };
  registerObsLocaleHandlers(
    { emit(event, payload) { emitted.push({ event, payload }); } },
    { on(event, handler) { events.set(event, handler); } },
    { playState, persistState() { persisted += 1; } },
  );

  // 跟隨模式：面板換英文 → 疊加層拿到英文
  events.get('obs-locale:panel')({ locale: 'en' });
  eq(playState.panelLocale, 'en');
  eq(emitted[emitted.length - 1].event, 'obs-locale:update');
  eq(emitted[emitted.length - 1].payload.locale, 'en');
  eq(persisted, 1);

  // 釘死日文：面板之後換什麼語言，疊加層都維持日文
  events.get('obs-locale:set')({ mode: 'ja' });
  eq(emitted[emitted.length - 1].payload.locale, 'ja');
  const beforePanelChange = emitted.length;
  events.get('obs-locale:panel')({ locale: 'ko' });
  eq(emitted.length, beforePanelChange, '釘死語言時面板換語言不該打擾疊加層：');
  eq(playState.panelLocale, 'ko', '但仍要記住面板語言，切回跟隨時才有正確的值：');

  // 切回跟隨 → 立刻變成剛剛記下的面板語言
  events.get('obs-locale:set')({ mode: 'follow' });
  eq(emitted[emitted.length - 1].payload.locale, 'ko');

  // 認不得的值退回 follow，不是退回中文（退回中文會蓋掉使用者的面板語言）
  events.get('obs-locale:set')({ mode: 'klingon' });
  eq(playState.obsLocale, 'follow');
  events.get('obs-locale:panel')({ locale: 'klingon' });
  eq(playState.panelLocale, 'zh-TW');
});

test('OBS 顯示語言只有控制端能改，且不走 broadcastState', () => {
  const sockSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8');
  // 唯讀端（display/setlist）送 obs-locale:* 必須被白名單擋掉——疊加層不能自己改語言。
  const readOnlyBlock = sockSource.slice(sockSource.indexOf('const READ_ONLY_EVENTS'), sockSource.indexOf('FONT_PROBE_REPORT_MIN_INTERVAL_MS'));
  ok(!readOnlyBlock.includes('obs-locale'), 'obs-locale:* 不可加進 READ_ONLY_EVENTS：');
  // handler 必須註冊在 !socket.readOnly 區塊內
  const controlBlock = sockSource.slice(sockSource.indexOf('if (!socket.readOnly) {'), sockSource.lastIndexOf('registerTwitchHandlers'));
  ok(controlBlock.includes('registerObsLocaleHandlers'), 'obs-locale handler 必須只註冊給控制端：');
  // 鐵則 5：整包 state:sync 會讓 OBS 重跑入場動畫，語言變更只能走專屬事件
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'obs-locale.js'), 'utf8');
  // 只看實際程式碼，註解裡本來就會提到 broadcastState（說明為什麼不能用）。
  const handlerCode = handlerSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!handlerCode.includes('broadcastState'), '語言變更不可觸發 broadcastState：');
  ok(handlerSource.includes("io.emit('obs-locale:update'"), '必須用專屬事件廣播：');
});

test('OBS 來源網址不再把語言釘進網址，改由設定即時推送', () => {
  // 網址帶 ?lang= 等於把「複製當下的語言」釘死在 OBS 來源上，之後換語言不會變——
  // 這正是使用者回報的問題。?lang= 只保留給手動釘死的進階用法。
  const displaySource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-style-sync.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-setlist-panel.js'), 'utf8');
  const buildObs = displaySource.slice(displaySource.indexOf('function buildObsUrl'), displaySource.indexOf('function refreshObsUrls'));
  const buildSetlist = setlistSource.slice(setlistSource.indexOf('function buildSetlistUrl'));
  ok(!buildObs.includes('localizeUrl'), '/display 網址不可再自動附加語言：');
  ok(!buildSetlist.slice(0, buildSetlist.indexOf('}')).includes('localizeUrl'), '/setlist 網址不可再自動附加語言：');
  ok(displaySource.includes("SocketClient.send('obs-locale:set'"), '面板要能設定 OBS 顯示語言：');
  ok(displaySource.includes("SocketClient.send('obs-locale:panel'"), '面板要把自己的語言回報上去，跟隨模式才成立：');
});

test('兩個 OBS 疊加層都載入語言跟隨，且尊重網址上的 ?lang= 釘選', () => {
  const follow = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'obs-locale-follow.js'), 'utf8');
  ['display.html', 'setlist.html'].forEach((page) => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', page), 'utf8');
    ok(html.includes('/js/obs-locale-follow.js'), `${page} 必須載入語言跟隨：`);
  });
  // 實際踩過：SocketClient 是 socket-client.js 頂層的 const，不在 window 上，
  // 用 window.SocketClient 當守衛會 undefined → 整支靜默變死碼、疊加層不會換語言。
  const followCode = follow.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!followCode.includes('window.SocketClient'), 'SocketClient 不在 window 上，不可用 window.SocketClient 取：');
  ok(follow.includes("searchParams.get('lang')"), '?lang= 必須維持釘死語言（舊網址行為不變）：');
  ok(/persist:\s*false/.test(follow), '疊加層不可把語言寫進自己的 localStorage：');
  ok(/updateQuery:\s*false/.test(follow), '跟隨時不該改寫網址：');
});

test('已唱歌單可以單獨刪除一筆，用 entryId 定位，同一首唱兩次不會刪錯', () => {
  // 使用者實測回報：點錯歌被誤記進已唱、或切歌太快連點兩次，過去只能整場「清除全部」，
  // 沒辦法單獨修正。id 只是歌曲本身的 id，同一首歌在同一場唱兩次會有兩筆同 id 的記錄，
  // 不能拿來當刪除的定位鍵，必須用各自獨立的 entryId。
  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const events = new Map();
  const session = {
    active: true, startedAt: Date.now(), source: 'manual',
    songs: [
      { id: 'song-a', entryId: 'entry-1', title: '第一次唱 A', artist: '歌手' },
      { id: 'song-b', entryId: 'entry-2', title: 'B', artist: '歌手' },
      { id: 'song-a', entryId: 'entry-3', title: '第二次唱 A', artist: '歌手' },
    ],
  };
  let setlistEmitted = 0;
  let persisted = 0;
  const ctx = {
    playState: {
      isPlaying: false, currentTrack: null, setlistTheme: 'glass', setlistLayout: 'classic',
      setlistStyle: {}, setlistSceneStyles: {},
    },
    session, SETLIST_SCENE: [],
    effSetlistStore() { return {}; },
    persistState() { persisted++; },
    setlistPayload() { return { ...session }; },
    emitSetlist() { setlistEmitted++; },
    recordSessionSong() {}, broadcastState() {},
  };
  registerSetlistHandlers(
    { emit() {} },
    { on(event, handler) { events.set(event, handler); }, emit() {} },
    ctx,
  );

  // 不存在的 entryId：不動任何資料，也不廣播（避免誤刪或無謂的重繪）
  events.get('session:remove-song')({ entryId: 'not-exist' });
  eq(session.songs.length, 3, '找不到對應 entryId 時不該動任何資料：');
  eq(setlistEmitted, 0);

  // 刪中間那筆：只少一筆，兩筆同 id 的 A（entry-1／entry-3）要各自獨立、都還在
  events.get('session:remove-song')({ entryId: 'entry-2' });
  eq(session.songs.length, 2, '刪除後應該只少一筆：');
  eq(session.songs.map((s) => s.entryId).join(','), 'entry-1,entry-3', '同一首歌唱兩次的兩筆記錄必須各自獨立，刪其中一筆不能連帶刪到另一筆：');
  eq(setlistEmitted, 1, '刪除成功要廣播 setlist:update，面板才會即時更新：');
  eq(persisted, 1, '刪除成功要持久化，否則重開程式又會冒出來：');

  // 缺 entryId、型別不對：直接忽略，不能誤判成「刪第一筆」
  events.get('session:remove-song')({});
  events.get('session:remove-song')(undefined);
  events.get('session:remove-song')({ entryId: 123 });
  eq(session.songs.length, 2, '沒有合法 entryId 的請求必須被忽略，不能刪錯筆：');
  eq(setlistEmitted, 1);
});

test('recordSessionSong 每次記錄都給獨立 entryId，同一首歌唱兩次也能分別刪除', () => {
  const { createAppState } = require('../server/state/app-state');
  const appState = createAppState({ emit() {} });
  // 這個 appState 實例會載到共用測試資料夾裡殘留的舊資料，先歸零避免被其他測試的殘留污染這裡的斷言。
  appState.session.songs = [];
  appState.session.active = true;
  appState.session.startedAt = Date.now();

  appState.playState.currentTrack = { id: 'song-a', title: 'A' };
  appState.recordSessionSong();
  appState.playState.currentTrack = { id: 'song-b', title: 'B' };
  appState.recordSessionSong();
  appState.playState.currentTrack = { id: 'song-a', title: 'A' };
  appState.recordSessionSong();

  eq(appState.session.songs.length, 3);
  const entryIds = appState.session.songs.map((s) => s.entryId);
  eq(new Set(entryIds).size, 3, '三筆記錄的 entryId 必須各自不同，即使 id 重複（同一首歌唱兩次）：');
  ok(entryIds.every((id) => typeof id === 'string' && id.length > 0), 'entryId 必須是非空字串：');
});

test('舊資料（session.songs 沒有 entryId）載入時自動補齊，否則永遠刪不掉', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/state/app-state.js'), 'utf8');
  ok(source.includes("session.songs = saved.session.songs.map((s) => (s && s.entryId ? s : { ...s, entryId: crypto.randomUUID() }));"),
    '載入舊 state.json 時，沒有 entryId 的已唱歌單記錄必須補上，不能原封不動放著（否則單獨刪除功能對這些舊記錄永遠失效）：');

  // 純函式驗證補齊邏輯本身：有 entryId 的保留原樣，沒有的才補新的。
  function backfillEntryId(songs, makeId) {
    return songs.map((s) => (s && s.entryId ? s : { ...s, entryId: makeId() }));
  }
  let counter = 0;
  const result = backfillEntryId(
    [{ id: 'a', entryId: 'keep-me' }, { id: 'b' }],
    () => `generated-${++counter}`,
  );
  eq(result[0].entryId, 'keep-me', '已經有 entryId 的記錄不該被覆蓋：');
  eq(result[1].entryId, 'generated-1', '沒有 entryId 的記錄要補上新的：');
});

test('已唱歌單面板：刪除鈕用事件代理、只在有 entryId 時才渲染，且套用共用的 .pi-remove 樣式', () => {
  const panelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');

  ok(panelSource.includes("if (s.entryId) {"), '沒有 entryId 的記錄不該生出刪除鈕（理論上不會發生，但寧可不給按也不要刪錯）：');
  ok(panelSource.includes("removeBtn.className = 'pi-remove';"), '刪除鈕必須套用既有的 .pi-remove 樣式，不要另外自創一套：');
  ok(panelSource.includes("removeBtn.dataset.removeSongEntryId = s.entryId;"), '刪除鈕必須把 entryId 存在 dataset 上，點擊時才知道要刪哪一筆：');

  // 事件代理：renderSetlistPanel() 每次都整批重建 innerHTML，監聽器必須綁在不會被替換的容器上。
  ok(panelSource.includes("dom.setlistPanel.addEventListener('click', (event) => {") &&
    panelSource.includes("const btn = event.target.closest('.pi-remove');") &&
    panelSource.includes("SocketClient.send('session:remove-song', { entryId });"),
    '刪除鈕必須用事件代理綁在容器上，並送出 session:remove-song：');

  ok(panelCss.includes('.pi-remove'), '.pi-remove 的樣式必須存在（hover 才顯示、danger 色），不能是空按鈕：');
});

test('歌單固定預覽、直書句流縮圖與直播狀態重新整理入口都存在', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const obsWebsocket = fs.readFileSync(path.join(__dirname, '../public/js/obs-websocket.js'), 'utf8');
  ok(indexHtml.includes('id="session-refresh"'));
  ok(indexHtml.includes('class="setlist-preview-bar"'));
  ok(indexHtml.includes('style-thumb-columnflow'));
  ok(panelCss.includes('@keyframes tpl-columnflow'));
  ok(setlistPanel.includes('等待確認直播狀態'));
  ok(obsWebsocket.includes('refreshStreamStatus: publishStreamStatus'));
});

testAsync('OBS WebSocket 密碼錯誤進入重連後，可立即停止並解除握手狀態', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/obs-websocket.js'), 'utf8');
  const timers = [];
  class FakeWebSocket {
    constructor() { this.closed = false; FakeWebSocket.instances.push(this); }
    close() {
      if (this.closed) return;
      this.closed = true;
      if (this.onclose) this.onclose({ code: 4009 });
    }
  }
  FakeWebSocket.instances = [];
  const sandbox = {
    window: {}, console, WebSocket: FakeWebSocket,
    document: { getElementById() { return null; } },
    setTimeout(fn) { const timer = { fn, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return {}; }, clearInterval() {},
  };
  vm.runInNewContext(`${source}\n;globalThis.__obsWsForTest = ObsWs;`, sandbox);
  const client = sandbox.__obsWsForTest;
  const attempt = client.connect({ host: '127.0.0.1', port: 4455, password: 'wrong' });
  const socket = FakeWebSocket.instances[0];
  socket.close();
  await attempt.catch(() => {});
  ok(client.isReconnecting(), '密碼錯誤後應進入可取消的重連等待：');
  client.disconnect();
  eq(client.isReconnecting(), false, '停止重連後不可殘留 connecting 或重試計時器：');
  ok(timers.some((timer) => timer.cleared), '停止重連必須清除已排定的重試計時器：');
});

test('歌單亮色背景可讀性保護與模板有效設定守衛存在', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const schema = require('../public/js/setlist-style-schema');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const field = schema.FIELD_BY_KEY.readabilityGuard;
  ok(field && field.default === true && field.dataAttr === 'data-sl-readable-off' && field.invert === true, '舊歌單設定必須預設升級為亮色背景可讀');
  eq(schema.FIELD_BY_KEY.doneOpacity.default, 54, '新歌單預設不得把已唱文字淡到亮色背景看不見：');
  eq(schema.FIELD_BY_KEY.waitOpacity.default, 72, '新歌單預設不得把未唱文字淡到亮色背景看不見：');
  ok(indexHtml.includes('id="sls-readability-guard"'), '面板必須提供亮色背景可讀性保護開關');
  ok(indexHtml.includes('可讀性襯底色') && indexHtml.includes('可讀性襯底不透明度'), '主要文字與襯底色必須在快速調整可見');
  ok(indexHtml.includes('data-sl-layout="classic cards simple timeline diagonal constellation terminal billboard signal index label glow round pager haunt minimal-board"'), '正在播放字級必須在每個有 active 歌曲的模板顯示');
  ok(indexHtml.includes('data-sl-layout="timeline diagonal constellation terminal billboard cards signal index label glow round pager haunt"'), '歌曲編號設定不得在不支援的模板顯示');
  ok(setlistPanel.includes('設定只套用並保存於這個模板；切換模板不會影響其他歌單。'), '模板說明必須明示設定會各模板獨立保存');
  ok(setlistCss.includes(':root:not([data-sl-readable-off]) .now-singing') && setlistCss.includes(':root:not([data-sl-readable-off]) .tl-now'), '經典與場景模板都必須有非全螢幕的可讀性襯底');
  ok(setlistSource.includes('const sameSideContrast = guarded') && setlistSource.includes('const readableCardColor'), '可讀性保護必須在文字與襯底同明度時自動轉成安全對比');
  ok(setlistCss.includes('.terminal { width: 300px; background: var(--sl-bg-card);') && setlistCss.includes('.billboard { width: 320px; background: var(--sl-bg-card);') && setlistCss.includes('.card { background: var(--sl-bg-card);'), '清單型模板不得繞過共用卡片底色設定');
});

test('歌單每個模板保存獨立外觀，正在播放字級也套到 active row', () => {
  const registerSetlistHandlers = require('../server/routes/handlers/setlist');
  const { SETLIST_LAYOUTS } = require('../server/state/app-state');
  const events = new Map();
  const emitted = [];
  const defaults = require('../public/js/setlist-style-schema').getDefaultStyle();
  const playState = {
    setlistLayout: 'classic',
    setlistTemplateStyles: Object.fromEntries(SETLIST_LAYOUTS.map((layout) => [layout, { ...defaults }])),
    setlistTheme: 'glass', isPlaying: false, currentTrack: null,
  };
  const ctx = {
    playState, session: { active: false, startedAt: null, source: null, songs: [] }, SETLIST_LAYOUTS,
    effSetlistStore(layout) { return playState.setlistTemplateStyles[layout]; },
    persistState(callback) { if (callback) callback({ ok: true }); },
    setlistPayload() { return {}; }, emitSetlist() {}, recordSessionSong() {}, broadcastState() {},
  };
  registerSetlistHandlers(
    { emit(event, payload) { emitted.push([event, payload]); } },
    { on(event, handler) { events.set(event, handler); } },
    ctx,
  );
  events.get('setlist:style')({ target: 'classic', sizeNow: 31 });
  eq(playState.setlistTemplateStyles.classic.sizeNow, 31, 'classic 必須只更新自己的設定');
  eq(playState.setlistTemplateStyles.cards.sizeNow, defaults.sizeNow, 'classic 不得覆寫 cards 的設定');
  events.get('setlist:style')({ target: 'cards', sizeNow: 22 });
  eq(playState.setlistTemplateStyles.classic.sizeNow, 31, 'cards 不得回寫 classic 的設定');
  eq(playState.setlistTemplateStyles.cards.sizeNow, 22, 'cards 必須保存自己的設定');
  events.get('setlist:layout')({ layout: 'cards' });
  ok(emitted.some(([event, payload]) => event === 'setlist:style' && payload.target === 'cards' && payload.style.sizeNow === 22),
    '切換模板必須只推送該模板的外觀快照');

  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const schema = require('../public/js/setlist-style-schema');
  ok(indexHtml.includes('data-sl-layout="classic cards simple timeline diagonal constellation terminal billboard signal index label glow round pager haunt minimal-board"'),
    '所有有正在播放內容的模板都必須顯示正在播放字級設定');
  ['.term-item.active .t-line { font-size: var(--sl-sz-n)', '.bb-item.active .bb-name { font-size: var(--sl-sz-n)', '.card.active .card-title { font-size: var(--sl-sz-n)', '.index-item.active .index-title { font-size: var(--sl-sz-n)']
    .forEach((rule) => ok(setlistCss.includes(rule), `active row 必須吃正在播放字級：${rule}`));
  ['showReserve', 'labelReserve', 'glowSize'].forEach((key) => ok(!schema.FIELD_BY_KEY[key], `${key} 尚未實作時不得留成假設定`));
});

test('setlist queue scrolling is limited to the intended vertical templates', () => {
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  ok(setlistSource.includes("const AUTO_SCROLL_QUEUE_LAYOUTS = new Set(['classic', 'label', 'glow', 'round', 'pager', 'haunt']);"),
    'Only classic and the four vertically queued skins should auto-scroll.');
  ok(setlistSource.includes('function applyQueueScrolls()') && setlistSource.includes("runway.appendChild(copy);"),
    'Overflowing queues should duplicate one complete track for a seamless loop.');
  // 停留秒數／捲動速度可調（使用者實測回報希望能調整），@keyframes 的百分比 offset 又只能是
  // 寫死的數字沒法用 var()/calc()，所以改成逐份清單動態產生一段 @keyframes，見 applyQueueScrolls()。
  ok(setlistCss.includes('.sl-queue-scroll .sl-queue-runway { will-change: transform; }'),
    'The queue loop needs the base runway rule (per-instance @keyframes are generated at runtime, not static CSS).');
  ok(setlistSource.includes('function ensureQueueKfStyleEl()') && setlistSource.includes("kfRules.push("),
    'Auto-scroll must generate its own @keyframes per list so the configurable hold time can be an absolute duration.');
  ok(setlistCss.includes('background: #2c3138;') && setlistCss.includes('[data-layout="glow"] .sk-row { padding: calc(4px * var(--sl-fit)) 0; border-bottom: 1px solid rgba(255, 255, 255, .1); background: transparent; }'),
    'Night Neon should use one gray panel instead of shaded individual rows.');
  ok(setlistCss.includes('top: calc(8px * var(--sl-fit));') && setlistCss.includes('padding: calc(29px * var(--sl-fit))'),
    'Paper Tag now-playing label should remain inside the card.');
});

test('自動捲動的停留秒數與速度可調，且捲動速度改動即時生效', () => {
  const schema = require('../public/js/setlist-style-schema');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8').replace(/\r\n/g, '\n');
  const delayField = schema.FIELD_BY_KEY.queueScrollDelay;
  const speedField = schema.FIELD_BY_KEY.queueScrollSpeed;
  ok(delayField && delayField.default === 2.5 && delayField.min === 0 && delayField.max === 8, '捲動前停留秒數欄位缺少或預設值跑掉：');
  ok(speedField && speedField.default === 24 && speedField.min > 0, '捲動速度欄位缺少或預設值跑掉：');
  // 兩個欄位沒有 cssVar：換算成 @keyframes 百分比只能在 render 當下讀 curStyle 計算，
  // 標 needsRerender 才會在滑桿改動時立刻重算，不必等下一次換歌才生效。
  ok(delayField.needsRerender === true && speedField.needsRerender === true, '捲動設定改動必須立刻重繪生效（needsRerender）：');
  ok(indexHtml.includes('id="sls-queue-scroll-delay"') && indexHtml.includes('id="sls-queue-scroll-speed"'), '面板必須提供捲動前停留秒數與捲動速度兩個控制項：');
  ok(setlistSource.includes('const speed = Math.max(1, Number(curStyle.queueScrollSpeed) || 24);'), '捲動速度必須讀取使用者設定，不能寫死：');
  ok(setlistSource.includes('const delaySec = Math.max(0, Number(curStyle.queueScrollDelay) || 0);'), '停留秒數必須讀取使用者設定，不能寫死：');
  ok(setlistSource.includes('const holdPct = Math.min(45, (delaySec / totalSec) * 100);'), '停留比例必須設上限，避免停留秒數設太長時動畫看起來像完全沒在動：');
});

test('圓角氣泡（round）已唱／未唱不因有沒有歌手忽大忽小', () => {
  // 使用者實測回報：圓角氣泡大小不一致看了不舒服。根因是歌手欄用條件式渲染
  // （有歌手才輸出 <span>），造成同一份清單裡有的氣泡一行、有的兩行。
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8').replace(/\r\n/g, '\n');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8').replace(/\r\n/g, '\n');
  ok(setlistSource.includes('<span class="sk-artist">${escapeHtml(s.artist || \'\')}</span>'), '歌手欄必須一律輸出（沒有歌手就留空 span），高度才會一致：');
  ok(!setlistSource.includes("${s.artist ? `<span class=\"sk-artist\">"), '不可恢復條件式渲染歌手欄，否則氣泡高度又會忽高忽低：');
  ok(setlistCss.includes('.sk-artist { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(var(--sl-sz-a, 11px) * .95); line-height: 1.3; min-height: 1.3em;'),
    '歌手欄需要 min-height 保底，沒有歌手的空 span 才會佔住跟有歌手時一樣的高度：');
  ok(setlistCss.includes('[data-layout="round"] .sk-row {\n  border-radius: 999px; padding: calc(7px * var(--sl-fit)) calc(13px * var(--sl-fit));\n  background: rgba(255, 250, 241, .92); box-shadow: 0 calc(4px * var(--sl-fit)) calc(9px * var(--sl-fit)) rgba(20, 8, 14, .12);\n  /* 已唱／未唱共用同一個 1px 邊框寬度'),
    '已唱／未唱氣泡必須共用同一個邊框寬度，否則未唱多了一圈邊框會比已唱高 2px：');
  ok(setlistCss.includes('[data-layout="round"] .sk-artist { color: rgba(88, 25, 54, .62); }'),
    '已唱（淺色氣泡）的歌手字色必須有自己的深色版本，否則沿用暗底文字色會在淺底上看不見：');
});

test('跟唱視圖（/prompter）路由與 PIN／clientType 保護到位', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const socketHandlerSource = fs.readFileSync(path.join(__dirname, '../server/routes/socket-handler.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  ok(serverSource.includes("app.get('/prompter'") && serverSource.includes("sendNoCache(res, 'prompter.html')"), '/prompter 必須用 sendNoCache 送出頁面，跟其他頁面路由一致：');
  ok(socketHandlerSource.includes("new Set(['controller', 'remote', 'prompter', ...PIN_EXEMPT_CLIENT_TYPES])"), 'prompter 必須是合法 clientType，但不可加進 PIN_EXEMPT_CLIENT_TYPES（不是唯讀 OBS 疊加層，要跟 remote 一樣受 PIN 保護）：');
  ok(!/PIN_EXEMPT_CLIENT_TYPES = new Set\(\[[^\]]*'prompter'/.test(socketHandlerSource), 'prompter 不可被加進 PIN 豁免清單：');
  ok(socketHandlerSource.includes("else if (type === 'prompter') clients.prompters.add(socket.id);") && socketHandlerSource.includes('clients.prompters.delete(socket.id);'), 'prompter 連線必須正確加入/移出計數集合，斷線才不會計數卡住：');
  ok(fs.existsSync(path.join(__dirname, '../public/prompter.html')), '缺少 public/prompter.html');
  ok(fs.existsSync(path.join(__dirname, '../public/js/prompter.js')), '缺少 public/js/prompter.js');
  ok(indexHtml.includes('id="btn-open-prompter"'), '面板頂欄必須有開啟跟唱視圖的按鈕');
  ok(appSource.includes("window.open('/prompter', '_blank', 'noopener')"), '跟唱視圖必須開新分頁，不是像歌詞/歌單網址那樣複製到剪貼簿：');
});

test('跟唱視圖整句歌詞：時間跳轉不留殘影，逐句判斷純函式正確', () => {
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8').replace(/\r\n/g, '\n');
  // 一次跨好幾句（拖曳進度條、遠端 seek）時，舊的 --next 預覽標記若只清「前一個 active」跟
  // 「前一個 next」兩個定點，中間被跳過的那句會留下沒清掉的殘影 class。
  ok(promptSource.includes("dom.lyrics.querySelectorAll('.pt-line--active, .pt-line--next').forEach((el) => {"),
    '切換目前句時必須整批清除舊的 active/next 標記，不能只清兩個定點：');
  ok(promptSource.includes('// 不等下一次輪詢：面板拖曳進度條時（seeking）落點可能跨好幾句，\n    // 拖到哪就該立刻反映在哪，等 250ms 的輪詢會讓歌詞明顯慢半拍。\n    updateLyricsHighlight();'),
    'lyrics:sync 必須立即重算目前句，不能只靠 250ms 輪詢，否則面板拖曳進度條時歌詞會慢半拍：');

  // findCurrentLine 純邏輯抽出來跑，不用真的開瀏覽器：最後一個 time<=t 的行才是目前句。
  function findLineIndex(lines, t) {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].time <= t) idx = i; else break; }
    return idx;
  }
  const lines = [{ time: 0 }, { time: 3000 }, { time: 6000 }, { time: 9000 }];
  eq(findLineIndex(lines, 0), 0, 't=0 應該落在第一句：');
  eq(findLineIndex(lines, 2999), 0, 't=2999 還沒到第二句的時間點：');
  eq(findLineIndex(lines, 8999), 2, 't=8999 應該還在第三句：');
  eq(findLineIndex(lines, 15000), 3, '超過最後一句的時間點應該停在最後一句，不是 -1：');
  eq(findLineIndex(lines, -1), -1, '歌曲一開始（時間軸之前）不該有任何句子亮起：');
});

test('跟唱視圖 lyrics:sync 時鐘抖動不會讓歌詞先退回上一句再跳回來', () => {
  // 使用者實測回報：快跳到下一句的時候，歌詞會先閃回上一句一下、再跳回來。
  // 根因跟 display.js 踩過的同一種時鐘抖動坑（見 memory display-clock-granularity）：
  // 面板每 200ms 廣播 lyrics:sync，網路抖動可能讓某次送到的 currentTime 比本地已經推算出
  // 的時間還早幾十毫秒；原本每次都硬重設 syncTimeMs，剛好卡在句子邊界時就會讓 findLineIndex
  // 算出前一句的索引，畫面因此先退後、下一輪輪詢或下一次同步才又跳回正確位置。
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(promptSource.includes('const SYNC_REGRESSION_TOLERANCE_MS = 400;'), '必須設定一個小幅倒退的容忍值，不能照單全收每一次同步：');
  ok(promptSource.includes('const regressedMs = estimatedMs - proposedMs;') &&
    promptSource.includes('if (regressedMs > 0 && regressedMs < SYNC_REGRESSION_TOLERANCE_MS) {'),
    '只有「小幅倒退」才要忽略；真的倒退很多（seek 到更早的位置）必須照樣接受，不能永遠鎖死: ');
  ok(promptSource.includes('setProgressDisplay(estimatedMs / 1000);'),
    '忽略抖動時仍要用估計值更新進度條顯示，不能整個不動（否則進度條會卡住）：');

  // 純函式驗證核心判斷邏輯本身正確，不用真的開瀏覽器跑 setInterval。
  function shouldIgnoreSync(estimatedMs, proposedMs, toleranceMs) {
    const regressedMs = estimatedMs - proposedMs;
    return regressedMs > 0 && regressedMs < toleranceMs;
  }
  eq(shouldIgnoreSync(6050, 6000, 400), true, '50ms 的小幅抖動應該被忽略：');
  eq(shouldIgnoreSync(6390, 6000, 400), true, '正好在容忍值邊界內（390ms）也該忽略：');
  eq(shouldIgnoreSync(6500, 6000, 400), false, '超過容忍值（500ms）代表是真的 seek，必須接受：');
  eq(shouldIgnoreSync(5000, 6000, 400), false, '往前跳（proposed 比 estimated 還大）本來就不是倒退，要照樣接受：');
});

test('跟唱視圖點歌詞跳到那一句的起點，並正確扣掉 offset', () => {
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');

  // 事件代理：renderLyricsSkeleton() 每次都整批重建 innerHTML，綁在個別 .pt-line 上的
  // 監聽器會跟著舊 DOM 一起被丟掉，必須綁在容器上才能持續有效。
  ok(promptSource.includes("dom.lyrics.addEventListener('click', (e) => {"), '點擊歌詞必須綁在容器上做事件代理，不能綁在個別 .pt-line（重繪後會失效）：');
  ok(promptSource.includes("const lineEl = e.target.closest('.pt-line');"), '必須用 closest 找到整句的容器，點到內層的拼音/諧音子元素也要能定位到對的句子：');

  // line.time 是「音訊時間 + offset」的調整後時間軸（跟 updateLyricsHighlight 的 adjustedMs、
  // app-lyrics-timeline.js 寫入 line.time 的算法一致），還原成音訊秒數要扣掉 offset，
  // 不能直接拿 line.time 送出去，否則歌詞/音訊有偏移時點下去會跳到偏移過的位置。
  ok(promptSource.includes('const seconds = Math.max(0, (line.time - currentOffsetMs) / 1000);'),
    '換算音訊秒數必須扣掉 currentOffsetMs，直接用 line.time 會忽略偏移：');
  ok(promptSource.includes("const payload = currentTrackId != null ? { time: seconds, trackId: currentTrackId } : seconds;") ,
    '送出的 seek payload 格式必須跟其他地方（commitScrub）一致，帶 trackId 避免快速切歌後舊 seek 晚到污染新歌：');
  ok(promptSource.includes("SocketClient.send('play:seek', payload);"), '必須真的送出 play:seek，不能只更新本地畫面：');

  // 點下去要立即反映（樂觀更新），不用等伺服器回廣播才動，體感才會跟點擊同步。
  ok(promptSource.includes('syncTimeMs = seconds * 1000;') && promptSource.includes('updateLyricsHighlight();'),
    '點擊後必須立即更新本地時鐘與高亮，不能乾等下一次 lyrics:sync 才有反應：');

  // 純函式驗證換算公式本身：offset 為正代表歌詞比音訊晚出現，adjustedMs = audioMs + offsetMs。
  function seekSecondsFromLineTime(lineTimeMs, offsetMs) {
    return Math.max(0, (lineTimeMs - offsetMs) / 1000);
  }
  eq(seekSecondsFromLineTime(5000, 0), 5, '沒有 offset 時，line.time 5000ms 應該對應音訊第 5 秒：');
  eq(seekSecondsFromLineTime(5000, 500), 4.5, 'offset +500ms（歌詞晚 0.5 秒出現）時，音訊要少跳 0.5 秒才會對上這句：');
  eq(seekSecondsFromLineTime(500, 2000), 0, '換算結果為負數時要夾在 0，不能送出負的秒數：');

  // 要有游標/hover 提示，使用者才知道這是可以點的。
  ok(promptCss.includes('cursor: pointer;'), '.pt-line 必須有 cursor:pointer 提示可點擊：');
});

test('跟唱視圖新增羅馬拼音／諧音開關，各自獨立、預設關閉、不影響 OBS', () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');

  ok(promptHtml.includes('id="pt-set-romaji"') && promptHtml.includes('id="pt-set-xieyin"'), '設定面板必須有拼音跟諧音兩個獨立的開關：');
  ok(promptSource.includes('showRomaji: false, showXieyin: false'), '兩個開關預設必須是關閉（跟 OBS 顯示端 romanizationMode 預設 original 一致），沒資料的歌不該冒出空行：');

  // 拼音/諧音會改變 DOM 結構，不是單純 CSS 變數，開關必須觸發重繪，不能只是存個旗標。
  const displayOptionsFn = promptSource.slice(
    promptSource.indexOf('function updateLyricsDisplayOptions(patch) {'),
    promptSource.indexOf('function updateLyricsDisplayOptions(patch) {') + 200,
  );
  ok(displayOptionsFn.includes('renderLyricsSkeleton()') && displayOptionsFn.includes('updateLyricsHighlight()'),
    '切換拼音/諧音開關必須重繪歌詞區，不能只存進 appearance 卻沒反映到畫面：');
  ok(promptSource.includes("dom.setRomaji.addEventListener('change', () => updateLyricsDisplayOptions({ showRomaji: dom.setRomaji.checked }))"),
    '拼音開關必須接上 updateLyricsDisplayOptions，不能誤用只存 CSS 變數的 updateAppearance：');
  ok(promptSource.includes("dom.setXieyin.addEventListener('change', () => updateLyricsDisplayOptions({ showXieyin: dom.setXieyin.checked }))"),
    '諧音開關必須接上 updateLyricsDisplayOptions，不能誤用只存 CSS 變數的 updateAppearance：');

  // 渲染邏輯：沒開開關或該行沒有資料都不該生出空的拼音/諧音行。
  ok(promptSource.includes('appearance.showRomaji && line.phonetic') && promptSource.includes('appearance.showXieyin && line.xieyin'),
    '拼音/諧音行必須同時檢查「開關有沒有開」跟「這一行有沒有資料」，兩個條件缺一都不該渲染：');
  ok(!promptSource.includes('s2t(line.phonetic') && !promptSource.includes('s2t(line.xieyin'),
    '拼音/諧音不可經過簡轉繁：跟 karaoke.js 同一套規則，簡轉繁只轉原文 Han 字，轉了拼音/諧音反而可能跟實際讀音對不上：');

  // 非同步羅馬化：歌曲切過來當下可能還沒跑完 kuromoji/pinyin-pro，之後才用這個事件補上，
  // 若沒接這個監聽，使用者開了開關卻要等下一次切歌才看得到拼音/諧音（見 memory
  // lyrics-romanization-pipeline 的「非同步」根因）。
  ok(promptSource.includes("SocketClient.on('lyrics:romanized', (data) => {"), '必須監聽 lyrics:romanized，補推的羅馬化結果才進得來：');
  ok(promptSource.includes('const byTime = new Map();') && promptSource.includes('byTime.set(rl.time, rl)'),
    '合併羅馬化結果必須用時間對齊，不能用索引（伺服器過濾製作資訊行後行數可能跟本地不同，索引對齊會貼到錯的句子）：');

  // CSS 結構：拼音/諧音是獨立於主歌詞文字的子區塊，字級/顏色狀態要能跟著 active/past/next 走。
  ok(promptCss.includes('.pt-line-romaji') && promptCss.includes('.pt-line-xieyin'), '必須有拼音跟諧音各自的樣式：');
  ok(promptCss.includes('.pt-line.pt-line--active .pt-line-text'), '主歌詞文字的 active 樣式必須套在新的 .pt-line-text 子元素上，不能還留在舊的 .pt-line 選擇器（結構改了，樣式沒跟著改就會失效）：');
});

testAsync('日文振假名保留原漢字、只標可靠讀音，跟唱視圖可獨立開關', async () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const { sanitizeParsedLyrics } = require('../server/utils/track-schema');

  ok(promptHtml.includes('id="pt-set-furigana"'), '跟唱視圖必須有獨立振假名開關：');
  ok(promptSource.includes('showFurigana: false'), '振假名預設必須關閉，不可改動 OBS 的既有預設：');
  ok(promptSource.includes('appearance.showFurigana ? renderFurigana(line)'), '振假名開關必須只改跟唱視圖的歌詞渲染：');
  ok(promptCss.includes('.pt-line-text ruby') && promptCss.includes('ruby-position: over'), '振假名必須用原生 ruby 排在漢字上方：');

  const analyzed = await romanizer.japaneseReadingAnalysis('お母さんは今日東京へ行く');
  const annotated = analyzed.furigana.filter((segment) => segment.reading);
  ok(annotated.some((segment) => segment.text === '母' && segment.reading === 'かあ'), 'お母さん的母字必須對應かあ：');
  ok(annotated.some((segment) => segment.text === '今日' && segment.reading === 'きょう'), '今日必須對應きょう：');
  ok(annotated.some((segment) => segment.text === '東京' && segment.reading === 'とうきょう'), '東京必須對應とうきょう：');
  eq(analyzed.furigana.map((segment) => segment.text).join(''), 'お母さんは今日東京へ行く', '振假名片段必須完整保留原歌詞，不能改字或丟字：');
  ok(romanizer.needsFurigana([{ text: '今日も歌う', phonetic: 'kyou mo utau' }]), '舊日文歌詞即使已有拼音，下次播放仍必須補振假名：');
  ok(!romanizer.needsFurigana([{ text: '今天唱歌', phonetic: 'jin tian chang ge' }]), '純中文歌詞不可為了振假名重複進入日文分析：');

  const sanitized = sanitizeParsedLyrics([{ time: 0, text: '今日', furigana: analyzed.furigana.filter((segment) => segment.text === '今日') }]);
  eq(sanitized[0].furigana[0].reading, 'きょう', '振假名必須能通過歌詞資料的安全清理與同步：');
});

test('歌詞安全清理：lyricsSource 與 lyricsOffsetsBySource 通過、範圍/型別把關', () => {
  const { sanitizeTrack, sanitizeOffsetsBySource } = require('../server/utils/track-schema');
  const t = sanitizeTrack({
    id: 't1', title: 'x',
    lyricsSource: 'kugou',
    lyricsOffsetsBySource: { kugou: 0, betterlyrics: 3000, qqmusic: '-500', bad: 'nope', evil: 9e9 },
  });
  eq(t.lyricsSource, 'kugou');
  eq(t.lyricsOffsetsBySource.kugou, 0);
  eq(t.lyricsOffsetsBySource.betterlyrics, 3000);
  eq(t.lyricsOffsetsBySource.qqmusic, -500, '數字字串會轉回數字');
  ok(!('bad' in t.lyricsOffsetsBySource), '非數字值剔除');
  eq(t.lyricsOffsetsBySource.evil, 300000, '超範圍夾到 ±MAX_OFFSET_MS');
  eq(sanitizeOffsetsBySource({}), null, '空物件回 null');
  eq(sanitizeOffsetsBySource('nope'), null);
});

test('歌詞安全清理：合唱聲部 singer / singerLabel 必須通過（自動套用不會弄丟紅藍）', () => {
  const { sanitizeParsedLyrics } = require('../server/utils/track-schema');
  const out = sanitizeParsedLyrics([
    { time: 0, text: 'A', singer: 'a', singerLabel: '男' },
    { time: 1000, text: 'B', singer: 'b' },
    { time: 2000, text: 'C', singer: 'both', singerLabel: '合' },
    { time: 3000, text: 'D', singer: 'x', singerLabel: '亂碼' },
  ]);
  eq(out[0].singer, 'a'); eq(out[0].singerLabel, '男');
  eq(out[1].singer, 'b'); ok(!('singerLabel' in out[1]), 'label 沒給就不憑空生');
  eq(out[2].singer, 'both'); eq(out[2].singerLabel, '合');
  ok(!('singer' in out[3]) && !('singerLabel' in out[3]), '未知代號整組不放行');
});

test('跟唱視圖歌詞套用簡轉繁設定，跟歌詞顯示頁／歌單頁同一套規則', () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptSource = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(promptHtml.includes('/vendor/opencc-cn2t.js'), '跟唱視圖必須載入 opencc-cn2t.js，否則簡轉繁函式永遠拿不到轉換器：');
  const openccIdx = promptHtml.indexOf('/vendor/opencc-cn2t.js');
  const prompterJsIdx = promptHtml.indexOf('/js/prompter.js');
  ok(openccIdx > -1 && prompterJsIdx > openccIdx, 'opencc-cn2t.js 必須在 prompter.js 之前載入，不然 OpenCC 還沒定義：');

  ok(promptSource.includes("OpenCC.Converter({ from: 'cn', to: 'tw' })"), '轉換方向必須是簡轉繁（cn→tw），跟 karaoke.js／setlist.js 一致：');
  ok(promptSource.includes('function s2t(str) {') && promptSource.includes('if (!s2tEnabled || !str) return str;'),
    's2t() 必須尊重 s2tEnabled 開關：關閉時原樣輸出，不能永遠轉換：');
  ok(promptSource.includes('const converted = s2t(source);') && promptSource.includes('return escapeHtml(converted);')
    && promptSource.includes('escapeHtml(s2t(line.text || \'\'))'),
  '歌詞逐句渲染必須先過 s2t() 再 escapeHtml；振假名資料不匹配時也必須安全回退原文：');

  // 面板的簡轉繁開關就是同一個 lyricSettings.convertTraditional：勾選＝轉繁體，取消勾選＝維持原文。
  ok(promptSource.includes("SocketClient.on('lyric-settings:update', (settings) => {") &&
    promptSource.includes("if (!settings || typeof settings.convertTraditional !== 'boolean') return;") &&
    promptSource.includes('s2tEnabled = settings.convertTraditional;'),
    '必須監聽 lyric-settings:update 並即時套用開關切換，不能只在切歌時讀一次：');
  ok(promptSource.includes("state.lyricSettings && typeof state.lyricSettings.convertTraditional === 'boolean'") &&
    promptSource.includes('s2tEnabled = state.lyricSettings.convertTraditional;'),
    '連線／重連的 state:sync 也必須帶出目前的簡轉繁設定，不能只靠之後的 lyric-settings:update 事件：');
});

test('跟唱視圖歌詞外觀設定：齒輪鈕不可誤套 theme-toggle class', () => {
  // 實測踩過：齒輪鈕如果共用 .theme-toggle（跟真正的主題切換鈕同一個 class），
  // theme.js 的 querySelectorAll('.theme-toggle') 會把它一起接管——點下去圖示被換成
  // 太陽/月亮、還會連帶把主題切掉，變成「打開設定」跟「切主題」兩個動作黏在一起。
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(promptHtml.includes('id="pt-settings-btn" class="pt-icon-btn"'), '齒輪鈕必須用獨立的 class，不可跟主題切換鈕共用 .theme-toggle：');
  ok(promptHtml.includes('id="pt-theme-toggle" class="theme-toggle"'), '主題切換鈕本身仍要保留 .theme-toggle，theme.js 才找得到它：');
  ok(promptCss.includes('.pt-icon-btn {'), 'prompter.css 必須有獨立的齒輪鈕樣式：');
  ok(promptJs.includes("settingsBtn: document.getElementById('pt-settings-btn')") && promptJs.includes('dom.settingsBtn.addEventListener'), '齒輪鈕必須自己接開啟設定的事件，不能靠共用 class 順便觸發：');
});

test('跟唱視圖歌詞外觀設定：面板是錨定齒輪鈕的小面板，不是鋪滿全螢幕的 .modal', () => {
  // 使用者實測回報：共用的 .modal（全螢幕深色遮罩＋置中卡片）會擋住畫面中央，
  // 調字體/字級時完全看不到歌詞跟著變化，加背景模糊也無法兩全。改成錨定在齒輪鈕
  // 旁邊的小面板，不鋪遮罩，歌詞區永遠完整可見。
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(promptHtml.includes('id="pt-settings-modal" class="pt-settings-popover"'), '設定面板不可用共用的 .modal class（會鋪滿全螢幕深色遮罩）：');
  ok(!/class="pt-settings-popover[^"]*\bmodal\b/.test(promptHtml), 'pt-settings-popover 不可同時混用 modal class：');
  ok(promptCss.includes('.pt-settings-popover {') && promptCss.includes('position: fixed;') && promptCss.includes('background: transparent;'),
    '面板必須是絕對定位的小面板、背景透明，不能鋪整個畫面：');
  ok(promptCss.includes('.pt-settings-popover[hidden] { display: none; }'), '面板隱藏時必須真的從版面移除，不能只是視覺上蓋住：');

  // 沒有全螢幕遮罩可以點擊關閉了，必須改成「點面板外任何地方」+ Escape 都能關閉。
  ok(promptJs.includes("document.addEventListener('click', (e) => {") &&
    promptJs.includes('if (dom.settingsModal.contains(e.target) || dom.settingsBtn.contains(e.target)) return;') &&
    promptJs.includes('closeSettingsPopover();'),
    '必須有「點面板外面關閉」的邏輯，且不能誤判成點了面板內部的控制項：');
  ok(promptJs.includes("if (e.key === 'Escape' && !dom.settingsModal.hidden)"), '必須支援 Escape 關閉，跟其他 modal 的慣例一致：');
});

test('跟唱視圖歌詞外觀設定：字體/字級/顏色/描邊只存本機，套到正確的 CSS 變數', () => {
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8').replace(/\r\n/g, '\n');
  ok(promptJs.includes("const APPEARANCE_KEY = 'es-prompter-appearance';"), '外觀設定必須有自己的 localStorage key：');
  ok(promptJs.includes('localStorage.setItem(APPEARANCE_KEY') && promptJs.includes('localStorage.getItem(APPEARANCE_KEY'),
    '外觀設定必須讀寫 localStorage，不能只存在記憶體裡（重新整理就消失）：');
  ok(!promptJs.includes("SocketClient.send('lyric-settings"), '外觀設定是這台裝置的個人偏好，不可誤送到伺服器影響 OBS 或其他裝置：');
  [
    "r.setProperty('--pt-font'",
    "r.setProperty('--pt-size'",
    "r.setProperty('--pt-color'",
    "r.setProperty('--pt-stroke-w'",
    "r.setProperty('--pt-stroke-c'",
  ].forEach((required) => ok(promptJs.includes(required), `外觀設定缺少 ${required}`));
  ok(promptCss.includes('font-family: var(--pt-font);') && promptCss.includes('font-size: var(--pt-size);'),
    '.pt-line 必須實際套用字體/字級變數，不能設定了卻沒接上：');
  ok(promptCss.includes('color: var(--pt-color);') && promptCss.includes('-webkit-text-stroke: var(--pt-stroke-w) var(--pt-stroke-c);'),
    '.pt-line--active 必須套用顏色與描邊變數：');
});

test('跟唱視圖進度條支援滑鼠／觸控拖曳與鍵盤跳轉', () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const promptCss = fs.readFileSync(path.join(__dirname, '../public/css/prompter.css'), 'utf8');
  ok(promptHtml.includes('id="pt-progress-track"') && promptHtml.includes('role="slider"') && promptHtml.includes('tabindex="0"'),
    '進度條必須具備可聚焦 slider 語意，才能用鍵盤操作：');
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown'].forEach((eventName) => {
    ok(promptJs.includes(`addEventListener('${eventName}'`), `進度條缺少 ${eventName} 操作：`);
  });
  ok(promptJs.includes('setPointerCapture?.(event.pointerId)') && promptCss.includes('touch-action: none;'),
    '拖曳必須持續捕捉指標並停用瀏覽器原生觸控捲動：');
  ok(promptJs.includes("? { time: scrubSeconds, trackId: currentTrackId }") && promptJs.includes("SocketClient.send('play:seek', payload)"),
    '拖曳放開後必須帶目前 trackId 送出 seek，避免快速切歌時舊 seek 汙染新歌：');
  ok(promptJs.includes("if (event.key === 'Home') target = 0;") && promptJs.includes("if (event.key === 'End') target = lastDuration;"),
    '鍵盤必須支援方向鍵與 Home／End：');
});

test('跟唱視圖可載入使用者電腦字體，並保留五語介面', () => {
  const promptHtml = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  const promptJs = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  const i18n = require('../public/js/i18n');
  ok(promptJs.includes("fetch('/api/fonts')") && promptJs.includes("typeof window.queryLocalFonts === 'function'"),
    '本機字體必須以伺服器完整掃描為主、Font Access API 為補充：');
  ok(promptJs.includes("const LOCAL_FONT_PREFIX = 'local:';") && promptJs.includes('option.style.fontFamily = family;'),
    '本機字體選項需要獨立值前綴，並以實際字體預覽名稱：');
  ok(promptHtml.includes('id="pt-font-local"') && promptHtml.includes('data-i18n-locale') && promptHtml.includes('/js/i18n.js'),
    '跟唱視圖必須有本機字體選單與五語切換入口：');
  ['app.prompterTitle', 'prompter.open', 'prompter.progress', 'prompter.fontLoaded', 'prompter.resetAppearance'].forEach((key) => {
    i18n.LOCALES.forEach((locale) => ok(String(i18n.catalogs[locale][key] || '').trim(), `${locale}.${key} 不得為空：`));
  });
  ok(promptJs.includes("window.addEventListener('i18n:change'"), '切換語言後必須重繪動態播放清單、空狀態與字體載入狀態：');
});

test('logger 對 console 寫入失敗有防護，不會觸發無限迴圈把硬碟寫爆', () => {
  // 2026-08-04 真實事故：孤兒 node 行程的 stdout 管道斷了，console.error 丟出 EPIPE，
  // 這個丟出被 uncaughtException 接到、再呼叫 log.error() 想記錄它、又再丟一次 EPIPE，
  // 無限迴圈全速跑了 5 小時，單一 log 檔寫到 80GB 把整顆系統碟灌滿。
  // 這裡直接模擬「console.error 本身會丟出」的情境，驗證 log.error() 不會把這個丟出
  // 傳給呼叫端——傳出去的話，server/index.js 的 uncaughtException handler 接到後
  // 再呼叫一次 log.error()，就是當時真的發生過的那個迴圈。
  const { createLogger } = require('../server/utils/logger');
  const testLog = createLogger('LoggerSafetyTest');
  const originalConsoleError = console.error;
  let consoleErrorCalls = 0;
  console.error = () => { consoleErrorCalls++; throw new Error('EPIPE: broken pipe, write'); };
  let threw = false;
  try {
    testLog.error('模擬管道斷掉時的寫入', new Error('boom'));
  } catch (e) {
    threw = true;
  } finally {
    console.error = originalConsoleError;
  }
  eq(threw, false, 'console 寫入失敗絕不能傳出 log.error()，否則呼叫端（uncaughtException handler）會被牽連一起炸：');
  eq(consoleErrorCalls, 1, 'console.error 應該只被呼叫一次（這裡驗證的是「丟出不會外洩」，不是重試機制）：');

  // 第二層防線：server/index.js 的 uncaughtException/unhandledRejection handler
  // 必須有重入旗標，就算未來出現其他「記錄錯誤本身又拋錯」的狀況，也不能無限重入。
  const serverSource = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  ok(serverSource.includes('let handlingFatalError = false;'), 'uncaughtException handler 必須有重入旗標：');
  ok(serverSource.includes('if (handlingFatalError) return;'), '重入時必須直接放棄，不能再嘗試記錄一次：');
  ok(serverSource.includes('function logFatalSafely(') && serverSource.includes("process.on('uncaughtException'") && serverSource.includes("process.on('unhandledRejection'"),
    'uncaughtException 與 unhandledRejection 都必須走同一個有防護的記錄函式：');

  const loggerSource = fs.readFileSync(path.join(__dirname, '../server/utils/logger.js'), 'utf8');
  ok(loggerSource.includes('try { consoleFn(formatted); } catch (err) {'), 'console 寫入本身必須包 try/catch：');
});

test('logger 同一天內寫超過大小上限會主動輪替，不必等隔天開新檔案才檢查', () => {
  // 2026-08-04 事故的第二個破口：原本的輪替檢查只在「開新串流那一刻」（開機/跨天）
  // 執行一次，同一天內持續寫入完全不會再重新檢查——搭配上面那個無限迴圈，
  // 這就是為什麼「MAX_LOG_SIZE = 50MB」的上限形同虛設，能一路寫到 80GB。
  const loggerSource = fs.readFileSync(path.join(__dirname, '../server/utils/logger.js'), 'utf8');
  ok(loggerSource.includes('let currentStreamBytes = 0;'), '必須有即時位元組計數，不能只在開新串流時看一次檔案大小：');
  ok(loggerSource.includes('if (currentStreamBytes > MAX_LOG_SIZE) rotateLogFile();') && loggerSource.includes('currentStreamBytes += Buffer.byteLength(line);'),
    'writeLog() 每次寫入都要即時累加並檢查上限，不能只在 getLogStream() 開新串流時檢查：');
  ok(loggerSource.includes('function rotateLogFile()'), '輪替必須是獨立函式：關掉目前串流、更名、讓下一次寫入重新開一個全新檔案：');
});

test('歌單暫停時仍將目前歌曲保留在正在播放', () => {
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  ok(setlistSource.includes('const lastIsCurrent = !!(data.current && last && last.id != null && last.id === data.current.id);'), '目前歌曲必須以 current track 的 id 判斷');
  ok(setlistSource.includes('if (lastIsCurrent) { current = last; past = songs.slice(0, -1); }'), '目前歌曲在 session songs 尾端時不可落入已唱');
  ok(!setlistSource.includes('data.current && data.current.playing'), '歌單分組不可用播放／暫停狀態判定目前歌曲');
});

test('暫停的歌單場景模板不再能新選，但既有 OBS 設定仍可安全保留', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistHandler = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/setlist.js'), 'utf8');
  ['diagonal', 'timeline', 'constellation'].forEach((layout) => {
    ok(indexHtml.includes(`<option value="${layout}" hidden>`), `${layout} 必須保留隱藏 option，讓舊設定可被讀回`);
    ok(!indexHtml.includes(`data-setlist-layout="${layout}"`), `${layout} 不得再出現在新模板選擇入口`);
    ok(setlistSource.includes(layout), `${layout} renderer 必須保留，避免已使用中的 OBS 畫面被改掉`);
    ok(setlistHandler.includes('SETLIST_LAYOUTS.includes'), `${layout} 必須由共用 server allowlist 接受，避免讀取舊設定時被回退`);
  });
  ok(setlistPanel.includes("const SETLIST_HIDDEN_LAYOUTS = ['diagonal', 'timeline', 'constellation']"), '面板必須集中管理暫停模板清單');
  ok(setlistPanel.includes('setlist-legacy-layout-notice') && setlistPanel.includes('appearance.hidden = isHiddenLayout'), '暫停模板必須顯示保留說明並收起無法再調整的設定');
});

test('歌單經典資訊重排與兩個原創模板都走共用樣式，既有場景模板不受影響', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const setlistHandler = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/setlist.js'), 'utf8');
  ['signal', 'index'].forEach((layout) => {
    ok(indexHtml.includes(`<option value="${layout}">`), `${layout} 必須可由歌單面板選取`);
    ok(indexHtml.includes(`data-setlist-layout="${layout}"`), `${layout} 必須有可見模板卡片`);
    ok(setlistPanel.includes(`${layout}: { name:`), `${layout} 必須有面板名稱與說明`);
    ok(setlistSource.includes(`const ${layout} = {`), `${layout} 必須有獨立 renderer`);
    ok(setlistHandler.includes('SETLIST_LAYOUTS.includes'), `${layout} 必須被共用 server allowlist 接受`);
  });
  ok(setlistSource.includes('classic-shell') && setlistCss.includes('[data-layout="classic"] .classic-shell'), '經典資訊必須使用新的局部資訊容器，而非逐列厚底');
  // 襯底必須純色：漸層淡出在很寬或很扁的來源會讓右側文字懸在半透明上，反而更難讀。
  const classicShellRules = setlistCss.split(/\n(?=[^\s}])/).filter((block) => /\.classic-shell\s*\{/.test(block));
  ok(classicShellRules.length >= 2, '經典襯底規則必須同時涵蓋一般與可讀性保護兩種狀態');
  classicShellRules.forEach((block) => {
    ok(!/background:[^;]*gradient/.test(block), '經典襯底不可使用漸層淡出，必須純色填滿');
  });
  ok(setlistCss.includes('.signal-strip') && setlistCss.includes('.index-sheet'), '兩個新模板必須有隔離的原創樣式');
  // film（底片邊條）跟這三個一樣是 position:fixed 全幅疊層，2026-09-07 補進同一份
  // sceneStyles 相容清單（否則面板會把它歸成 list 類，顯示對它無效的「整體大小倍率」）。
  ok(setlistSource.includes("const SCENE = ['timeline', 'diagonal', 'constellation', 'film'];"), '新模板必須共用既有樣式資料，不得改成獨立場景資料');
});

test('三個新歌單版型 flap／note／film 完整接進 registry（2026-09-03 進 1.0 邊界）', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const { SETLIST_LAYOUTS } = require('../server/state/app-state');
  ['flap', 'note', 'film'].forEach((layout) => {
    ok(SETLIST_LAYOUTS.includes(layout), `${layout} 必須在 server 端 SETLIST_LAYOUTS allowlist`);
    ok(indexHtml.includes(`<option value="${layout}">`), `${layout} 必須可由歌單面板選取`);
    ok(indexHtml.includes(`data-setlist-layout="${layout}"`), `${layout} 必須有可見模板卡片`);
    ok(setlistPanel.includes(`${layout}: { name:`), `${layout} 必須有面板名稱與說明`);
    ok(setlistSource.includes(`const ${layout} = {`), `${layout} 必須有獨立 renderer`);
    ok(new RegExp(`const LAYOUTS = \\{[^}]*\\b${layout}\\b`).test(setlistSource), `${layout} 必須註冊進 LAYOUTS`);
    ok(setlistCss.includes(`[data-layout="${layout}"]`) || setlistCss.includes(`.${layout}-`), `${layout} 必須有隔離樣式`);
  });
  // flap／note 是填滿型：各自要有填滿版面規則
  ['flap', 'note'].forEach((layout) => {
    ok(setlistCss.includes(`html[data-sl-fit="fill"][data-layout="${layout}"]`), `${layout} 必須有自己的填滿版面規則`);
  });
  // film 是全幅場景：跟 timeline 等一樣走 fixed inset:0
  ok(setlistCss.includes('[data-layout="film"] #setlist-root'), 'film 必須以全幅場景掛載');
  // flap 路線條、note 清單都必須以「正在播放」為中心保留可見：flap 取視窗、note 給 active 讓 trimToFit 保護
  ok(setlistSource.includes('const FLAP_WIN') && setlistSource.includes('anchor - (FLAP_WIN >> 1)'), 'flap 路線條必須以正在播放為中心取視窗，不可整場擠在一起');
  ok(setlistSource.includes("note-it--${st}${st === 'now' ? ' active' : ''}"), 'note 正在播放列必須加 active，讓 trimToFit 保護不被裁掉');
  // 移除舊 vinyl 版型後不得殘留
  ok(!SETLIST_LAYOUTS.includes('vinyl') && !setlistSource.includes('const vinyl = {') && !indexHtml.includes('data-setlist-layout="vinyl"'), 'vinyl 版型已移除，不得殘留');
});

test('手帳頁有自己的三顆狀態顏色，通用顏色欄位不再對它空轉', () => {
  // 使用者回報「手帳頁的顏色設定很怪、改了沒反應」。根因：這個模板是米色紙上的深色墨，
  // 整套配色寫死在 CSS，面板通用的主色/主要文字色/可讀性/淡化對它全都是死的；唯一會漏
  // 進來的是主要文字色，它透過共用的 .setlist-title 套到未唱那行，預設值又是給深色疊層
  // 用的米白 —— 等於在米色紙上寫米色字，只靠可讀性陰影勉強看得見。
  const schema = require('../public/js/setlist-style-schema');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');

  const NOTE_COLORS = {
    noteWaitColor: { css: '--sl-note-wait', domId: 'sls-note-wait-color', default: '#26303a' },
    noteNowColor: { css: '--sl-note-now', domId: 'sls-note-now-color', default: '#c24d3a' },
    noteDoneColor: { css: '--sl-note-done', domId: 'sls-note-done-color', default: '#9aa6b0' },
  };
  Object.entries(NOTE_COLORS).forEach(([key, spec]) => {
    const f = schema.FIELD_BY_KEY[key];
    ok(f && f.type === 'color' && f.cssVar === spec.css && f.domId === spec.domId && f.default === spec.default,
      `${key} 必須是綁到 ${spec.css} 的顏色欄位，預設維持原設計色：`);
    ok(indexHtml.includes(`id="${spec.domId}"`), `${key} 必須有面板控制項：`);
  });
  // 三顆控制項只在手帳頁出現
  const noteColorBlock = /<div class="field" data-sl-layout="note">[\s\S]*?<\/div>\s*<\/div>/.exec(indexHtml)?.[0] || '';
  Object.values(NOTE_COLORS).forEach((spec) => {
    ok(noteColorBlock.includes(`id="${spec.domId}"`), `${spec.domId} 必須放在 data-sl-layout="note" 的區塊裡：`);
  });

  // 三個狀態都要真的吃到變數（未唱那條權重必須壓過共用的 .setlist-title，否則又會變米色字）
  ok(/\.note-it \.note-nm \{ color: var\(--sl-note-wait/.test(setlistCss),
    '未唱歌名要用 .note-it 這一層（0,2,0）才蓋得過 .setlist-title：');
  ok(/\.note-it--done \.note-nm \{ color: var\(--sl-note-done/.test(setlistCss), '已唱歌名要吃已唱色：');
  ok(/\.note-it--now \.note-nm \{ color: var\(--sl-note-now/.test(setlistCss), '正在唱歌名要吃正在唱色：');
  ok(/\.note-it--done \.note-bx \{ background: var\(--sl-note-done/.test(setlistCss), '打勾要跟著已唱色：');
  // 蓋章的紅印泥跟紙張／膠帶／螢光筆一樣是刻意固定的文具元素（使用者要求保留這個特色），
  // 面板的說明文字也必須跟著這麼寫，才不會又變成「以為改得動卻沒反應」。
  ok(/\.note-stamp \{[\s\S]*?border: 2px solid #c24d3a/.test(setlistCss), '蓋章維持紅印泥，不跟著已唱色：');
  ok(/'setlist\.noteColorHint':\s*\['[^']*蓋章的紅印泥[^']*固定文具元素/.test(fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8')),
    '說明文字必須講明蓋章的紅色不跟著換：');
  // 「正在唱」的螢光筆底色是 z-index:-1 的 ::before，紙張必須自己是一個堆疊環境，
  // 它才會畫在紙上、文字下面；少了這行整條螢光筆會被紙張底色蓋掉（等於裝飾看不見）。
  ok(/\.note-sheet \{[\s\S]*?position: relative; z-index: 0;/.test(setlistCss),
    '手帳紙必須是堆疊環境，否則「正在唱」的螢光筆畫了也看不見：');
  ok(/\.note-it--now::before \{[\s\S]*?z-index: -1;/.test(setlistCss), '螢光筆必須留在文字底下：');
  ok(/\.note-title \{[^}]*color: var\(--sl-note-now/.test(setlistCss), '頁首標題沿用正在唱色，換色時整張紙才一致：');
  // 可讀性文字陰影是給深色疊層用的，淺底深字加上去只會糊掉（那條規則自己的註解也這麼寫）
  ok(setlistCss.includes(':root[data-layout="note"]:not([data-sl-readable-off]) .note-nm { text-shadow: none; }'),
    '手帳頁的歌名不可套可讀性文字陰影，且權重要壓得過那條 (0,3,0) 規則：');

  // 對手帳頁沒有作用的通用欄位要藏起來，留著只會讓人以為改了會動
  ['data-sl-scope="classic list scene" data-sl-layout-not="note"',
    'data-sl-scope="classic list scene skin" data-sl-layout-not="note"',
    'data-sl-scope="classic list" data-sl-layout-not="note"',
    'class="field" data-sl-layout-not="note"'].forEach((marker) => {
    ok(indexHtml.includes(marker), `面板必須用 ${marker} 對手帳頁隱藏無效控制項：`);
  });

  // 可見性必須一次算完：分成好幾輪互相覆蓋的話，只有 data-sl-layout-not 的元素被藏起來
  // 之後沒有任何一輪會把它放回來（實際踩過：切到手帳頁藏掉「淡化程度」，切回經典版
  // 它就再也不出現了）。
  const syncFn = /function syncSetlistControlsForLayout\(\) \{([\s\S]*?)\n  \}/.exec(setlistPanel)?.[1] || '';
  ok(syncFn.includes("querySelectorAll('[data-sl-scope],[data-sl-layout],[data-sl-layout-not]')"),
    '三個屬性必須在同一輪算出最終可見性：');
  ok((syncFn.match(/querySelectorAll/g) || []).length === 1, '不可再拆成多輪互相覆蓋：');
  ok(/if \(not && not\.split\(\/\\s\+\/\)\.includes\(layout\)\) visible = false;/.test(syncFn),
    'data-sl-layout-not 只做排除：');
});

test('底片邊條歸類為場景版，「整體大小倍率」不再是死控制項', () => {
  // 使用者實機回報：底片邊條的「整體大小倍率」滑桿調了沒反應。根因是 film 的 CSS
  // 早就跟 timeline/diagonal/constellation 共用 position:fixed 全幅掛載＋
  // .lay-stage { transform: ... scale(var(--sl-scene-scale,1)) }（setlist.css），
  // 但 SETLIST_SCENE 這份「場景類」清單三處各自維護的複本都漏了 film，導致面板把它
  // 歸類成 list 類、顯示的是對它完全無效的 --sl-scale（該值被非 classic 版型的
  // #setlist-root { transform: none } 重置規則清空）。
  const appStateSource = fs.readFileSync(path.join(__dirname, '../server/state/app-state.js'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');

  ok(appStateSource.includes("const SETLIST_SCENE = ['timeline', 'diagonal', 'constellation', 'film'];"),
    'server 端場景清單必須含 film，否則 sceneStyles 相容快照漏掉這個版型');
  ok(setlistPanel.includes("const SETLIST_SCENE = ['timeline', 'diagonal', 'constellation', 'film'];"),
    '面板端場景清單必須含 film，否則 setlistCategory() 把它誤判成 list 類');
  ok(setlistSource.includes("const SCENE = ['timeline', 'diagonal', 'constellation', 'film'];"),
    'OBS 頁面端的舊版相容清單也必須含 film');

  // 歸進場景類之後，面板「場景版設定」的位置/縮放才是真正能動 film 的控制項：
  // 位置沿用共用的 --sl-stage-x/y，縮放則轉成 film 自己的排版倍率（見下面那段）。
  const filmStageRules = [...setlistCss.matchAll(/\[data-layout="film"\]\s*\.lay-stage\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  ok(filmStageRules.some((body) => body.includes('--sl-stage-x') && body.includes('--sl-stage-y')),
    'film 的 .lay-stage 必須吃場景位置變數');
  ok(filmStageRules.some((body) => /--film-s:\s*var\(--sl-scene-scale, 1\)/.test(body)),
    'film 的整體縮放必須接到面板的 sceneScale 欄位');
  // film 完全沒有把 --sl-scale 或任何 classic/list 通用尺寸變數（--sl-fit 除外）接進
  // 自己的 CSS——歸進 list 類顯示的那些控制項本來就對它沒有作用。
  const filmBlockStart = setlistCss.indexOf('film：35mm 底片邊條');
  const filmBlock = filmBlockStart >= 0 ? setlistCss.slice(filmBlockStart, setlistCss.indexOf('/* Keep the OBS setlist independent', filmBlockStart)) : '';
  ok(filmBlock && !filmBlock.includes('--sl-scale') && !/--sl-scene-artist-size/.test(filmBlock),
    'film 自己的樣式區塊不吃 --sl-scale 或 --sl-scene-artist-size，這兩顆控制項對它本來就沒作用');

  // 「正在播放」歌手名字級只有 timeline/diagonal/constellation 真的接了 --sl-scene-artist-size，
  // 面板必須額外用 data-sl-layout 排除 film，避免它跟著場景分類一起冒出一顆新的死控制項。
  const artistSizeField = indexHtml.slice(indexHtml.indexOf('id="sls-scene-artist-size"') - 400, indexHtml.indexOf('id="sls-scene-artist-size"'));
  ok(/data-sl-layout="timeline diagonal constellation"/.test(artistSizeField),
    '「正在播放」歌手名字級必須排除 film（它的 CSS 沒有接這顆變數）：');
  // 大小（sceneScale）必須跟清單版那顆並排放在快速調整的「大小」區，不能只躲在詳細設定
  // 視窗裡：切到場景版時「大小」這個群組底下會一顆控制項都沒有（標題空懸），而真正能調
  // 大小的滑桿要開兩層才找得到。只靠 data-sl-scope="scene" 過濾，不能再被 data-sl-layout
  // 排除掉 film。
  const quickSizeGroup = indexHtml.slice(indexHtml.indexOf('<div class="field-group-title">大小</div>'), indexHtml.indexOf('data-sl-scope="classic list scene">顏色'));
  ok(quickSizeGroup.includes('id="sls-scene-scale"'), '場景版的大小控制項必須放在快速調整的「大小」區：');
  ok(quickSizeGroup.includes('id="sls-scale"'), '清單版的大小控制項必須留在同一區：');
  const sceneScaleField = /<div class="field" data-sl-scope="scene">[\s\S]*?id="sls-scene-scale"/.exec(quickSizeGroup)?.[0] || '';
  ok(sceneScaleField, '場景版大小控制項必須用 data-sl-scope="scene" 過濾：');
  ok(!/data-sl-layout=/.test(sceneScaleField), '大小（sceneScale）不可額外被 data-sl-layout 排除，film 也要吃得到：');
  ok(!/id="sls-scene-scale"/.test(indexHtml.slice(indexHtml.indexOf('data-sl-scope="scene" open'))),
    '搬走之後不可在詳細設定視窗裡留下第二顆同 id 的控制項：');

  // film 的「整體縮放」必須是自適應排版，不能用 transform 等比拉：這條是貼齊來源上下緣、
  // 靠右站的直條，transform 會連同它的邊界一起拉——放大整條溢出被裁、縮小離開邊緣留白
  // （兩種實機都拉過）。倍率只能乘進自己的尺寸，條子永遠貼滿整個高度。
  const filmStageOverride = /\[data-layout="film"\]\s*\.lay-stage\s*\{([\s\S]*?)\n\}/g;
  const overrides = [...setlistCss.matchAll(filmStageOverride)].map((m) => m[1]);
  const filmOnlyRule = overrides.find((body) => body.includes('--film-s'));
  ok(filmOnlyRule, 'film 必須有自己的 .lay-stage 規則來定義 --film-s（整體縮放倍率）：');
  ok(!/scale\(/.test(filmOnlyRule), 'film 的 transform 不可再用 scale()，倍率要走排版：');
  ok(/--film-fh:\s*calc\(96px \* var\(--film-s\)\)/.test(filmOnlyRule),
    '格高必須是「基準 96px × 倍率」，且是 CSS 這邊的單一事實來源：');

  // 條寬/格高/片門/字級都要吃倍率；條子本身維持 top:0 bottom:0 right:0（貼滿高度、貼齊右緣）。
  ok(/\.film-strip\s*\{[\s\S]*?top: 0; bottom: 0; right: 0;[\s\S]*?width: calc\(clamp\(120px, 12cqw, 168px\) \* var\(--film-s, 1\)\)/.test(setlistCss),
    '底片條必須貼滿來源高度並靠右，寬度隨倍率變（不是被 transform 拉走）：');
  ok(/\.film-frame\s*\{[\s\S]*?height: var\(--film-fh, 96px\)/.test(setlistCss), '每一格的高度必須跟著倍率：');
  ok(/\.film-gate\s*\{[\s\S]*?height: var\(--film-fh, 96px\)/.test(setlistCss), '片門高度必須跟每一格一致，否則對不準：');
  ok(/\.film-t\s*\{\s*font-size: calc\(12\.5px \* var\(--film-s, 1\)\)/.test(setlistCss), '格內字級必須跟著倍率：');

  // 捲動距離的乘法留在 CSS：JS 只送「往上捲幾格」，拉倍率時才不會停在用舊格高算出的位置。
  ok(/transform: translateY\(calc\(-1 \* var\(--film-fh, 96px\) \* var\(--film-shift, 0\)\)\)/.test(setlistCss),
    '捲動位置必須由 CSS 用當下的格高算出來：');
  ok(setlistSource.includes("frames.style.setProperty('--film-shift', String(center + 0.5))"),
    'setlist.js 只能送格數，不可自己換算像素：');
  ok(!/const FH = 96/.test(setlistSource), 'JS 不可再寫死格高 96px（會跟 CSS 的倍率脫鉤）：');

  // 其他三個場景版仍然走 transform 等比縮放（它們的內容站在畫面中央，那樣才對）。
  const sharedStageRule = /\[data-layout="timeline"\][\s\S]*?\[data-layout="film"\]\s*\.lay-stage\s*\{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  ok(sharedStageRule.includes('scale(var(--sl-scene-scale, 1))') && sharedStageRule.includes('transform-origin: center center;'),
    'timeline/diagonal/constellation 的等比縮放不可被 film 這次的改動動到：');
});

test('清單型歌單模板以 OBS 來源尺寸排版，場景版維持原本行為', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const schema = require('../public/js/setlist-style-schema');
  const fillLayouts = ['classic', 'cards', 'simple', 'terminal', 'billboard', 'signal', 'index', 'label', 'glow', 'round', 'pager', 'haunt', 'flap', 'note'];
  const sceneLayouts = ['timeline', 'diagonal', 'constellation'];

  // 只能有一種輸出：不可再回到「小元件 / 全畫布」兩種模式或 URL 開關。
  ok(!setlistSource.includes("q.get('mode')") && !setlistCss.includes('data-setlist-output') && !indexHtml.includes('data-setlist-output'),
    '歌單不可再有第二種輸出模式或 mode= 網址開關');
  ok(setlistPanel.includes("const url = new URL('/setlist', window.location.origin);") && !setlistPanel.includes("set('mode'"),
    'OBS 網址必須固定，尺寸改由 OBS Browser Source 決定');

  ok(setlistSource.includes("const FILL_LAYOUTS = new Set(['classic', 'cards', 'simple', 'terminal', 'billboard', 'signal', 'index', 'label', 'glow', 'round', 'pager', 'haunt', 'flap', 'note', 'minimal-board']);"),
    '十五個清單型模板（含 2026-11-10 的極簡歌單）必須集中列在同一份填滿白名單');
  ok(setlistSource.includes('const FIT_REF_W = 460, FIT_REF_H = 320, FIT_MIN = 0.85, FIT_MAX = 3.2;') && setlistSource.includes('Math.min(w / FIT_REF_W, h / FIT_REF_H)'),
    '縮放係數必須同時依來源寬與高計算，且基準要維持實機校準過的可讀字級');
  ok(setlistSource.includes("dataset.slFit = isFillLayout() ? 'fill' : 'scene'"), 'CSS 必須能分辨填滿與場景兩種語意');
  ok(setlistSource.includes('new ResizeObserver(scheduleFit)') && setlistSource.includes("window.addEventListener('resize', scheduleFit)"),
    '使用者在 OBS 拉動來源大小時必須重新排版');
  ok(setlistSource.includes('function trimToFit(') && setlistSource.includes('box.scrollHeight - box.clientHeight > 0.5'),
    '顯示首數必須依實際高度決定，不可再固定 6 首');
  ok(!setlistSource.includes('model.upcoming.slice(0, UP_LIMIT)') && setlistSource.includes('model.upcoming.slice(0, upCap())'),
    '列數上限必須跟著輸出模式切換');

  // 字級／間距跟著來源走：schema 標 fitScale，setlist.js 才會乘上 --sl-fit。
  ['sizeNow', 'sizeList', 'sizeArtist', 'sizeMeta', 'borderRadius', 'paddingV', 'paddingH', 'itemGap'].forEach((key) => {
    ok(schema.FIELD_BY_KEY[key] && schema.FIELD_BY_KEY[key].fitScale === true, `${key} 必須跟著來源尺寸等比縮放`);
  });
  ok(setlistSource.includes('if (f.fitScale && fill)'), 'fitScale 欄位必須實際乘上目前的 fit');
  ok(!schema.FIELD_BY_KEY.cardWidth.fitScale, '固定像素寬度不得再參與填滿版面的計算');
  ok(!indexHtml.includes('id="sls-card-width"') && !!schema.FIELD_BY_KEY.cardWidth,
    '面板不得再顯示固定像素寬度，但 schema 欄位要保留讓舊設定讀得回來');

  // 版面：每個模板都要有自己的填滿規則，且根節點不得殘留固定寬度或 transform 放大。
  // 四款皮膚（label/glow/round/pager）結構共用 sk-shell，
  // 用同一條 [data-layout] 通用規則撐開，不必每個 id 各寫一份。
  const fillRootRule = /html\[data-sl-fit="fill"\]\[data-layout\] #setlist-root \{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  ok(fillRootRule.includes('inset: 0') && fillRootRule.includes('max-width: none') && fillRootRule.includes('transform: none'),
    '填滿模式的根節點必須貼齊來源、不留固定寬度、不用 transform 放大點陣');
  const skinLayouts = ['label', 'glow', 'round', 'pager', 'haunt'];
  ok(setlistCss.includes('html[data-sl-fit="fill"][data-layout] .sk-shell'), '四款皮膚共用的填滿版面規則必須存在');
  fillLayouts.filter((layout) => !skinLayouts.includes(layout)).forEach((layout) => {
    ok(setlistCss.includes(`html[data-sl-fit="fill"][data-layout="${layout}"]`), `${layout} 必須有自己的填滿版面規則`);
  });
  sceneLayouts.forEach((layout) => {
    ok(!setlistCss.includes(`html[data-sl-fit="fill"][data-layout="${layout}"]`), `${layout} 是場景版，不可被改成填滿版面`);
  });
  ok(setlistCss.includes('html[data-sl-fit="fill"] .setlist-row,'), '清單列必須維持自然高度，否則會被壓扁而不是少顯示一首');

  // 面板：說明與預覽尺寸切換（沒有尺寸切換就看不出「跟著來源變化」）。
  ok(indexHtml.includes('id="setlist-sizing-hint"') && setlistPanel.includes('跟著你在 OBS 拉的 Browser Source 寬高變化'),
    '面板必須說明歌單大小由 OBS 來源決定');
  ['16x9', 'portrait', 'strip', 'small'].forEach((size) => {
    ok(indexHtml.includes(`data-setlist-preview-size="${size}"`), `預覽必須能模擬 ${size} 來源尺寸`);
  });
  ok(setlistPanel.includes('window.PreviewScale?.apply();'), '預覽縮放必須共用 preview-scale.js，不可各算一份');
});

test('清單型歌單有已唱／未唱區塊與勾選，單點式模板不吃這組設定', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const setlistSource = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const schema = require('../public/js/setlist-style-schema');

  // 設定欄位：改成兩個獨立 checkbox，但 key 名稱不准變（改名＝所有人既有設定失效）。
  const up = schema.FIELD_BY_KEY.classicShowUpcoming;
  const done = schema.FIELD_BY_KEY.classicShowDone;
  ok(up && up.domId === 'sls-show-upcoming' && up.default === true && !up.special, '未唱區塊必須是一般布林欄位並綁到 checkbox');
  ok(done && done.domId === 'sls-show-done' && done.default === true && !done.special, '已唱區塊必須是一般布林欄位並綁到 checkbox');
  ok(indexHtml.includes('id="sls-show-upcoming"') && indexHtml.includes('id="sls-show-done"'), '面板必須提供兩個獨立勾選');
  ok(!indexHtml.includes('sls-classic-sections') && !setlistPanel.includes('sls-classic-sections'), '舊的三態下拉與其特例程式碼必須整組移除');
  ok(indexHtml.includes('data-sl-layout="classic cards terminal billboard index label glow round pager haunt"'), '勾選只對十個清單型模板顯示');

  // renderer：九個清單型模板才吃這組設定；八個非經典模板要有區塊標籤。
  ok(setlistSource.includes("const SECTIONED_LAYOUTS = new Set(['classic', 'cards', 'terminal', 'billboard', 'index', 'label', 'glow', 'round', 'pager', 'haunt']);"),
    '清單型模板必須集中列在同一份白名單');
  ok(setlistSource.includes('function showDone()') && setlistSource.includes('function showWait()')
    && setlistSource.includes('const done = showDone() ?') && setlistSource.includes('const wait = showWait()'),
    'windowList 必須依勾選過濾已唱／未唱');
  ok(setlistSource.includes('items.start = showDone() ?'), '關掉已唱時曲序起點必須跟著調整，不可跳號');
  ok(setlistSource.includes('function groupedHtml('), '四個清單型模板必須共用同一份分群輸出');
  ['term-group', 'bb-group', 'card-group', 'index-group'].forEach((cls) => {
    ok(setlistSource.includes(`class="${cls}" data-group-label`), `${cls} 必須是可辨識的區塊標籤`);
    ok(setlistCss.includes(`.${cls}`), `${cls} 必須有樣式`);
  });
  ok(setlistSource.includes('function pruneOrphanLabels(') && setlistSource.includes('isGroupLabel(el)'),
    '裁列後不可留下沒有內容的孤兒標籤');
  ok(setlistSource.includes("document.querySelectorAll('[data-group-label]')"), '自訂已唱／未唱文字必須即時套到區塊標籤');

  // 經典只留一側時要收成單欄（兩欄 grid 會讓可見那欄只佔一半寬）。
  // data-layout 與 data-cl-hide-* 都在 <html> 上，必須是連續屬性選擇器而不是後代選擇器。
  ok(setlistCss.includes('html[data-sl-fit="fill"][data-layout="classic"][data-cl-hide-up] .cl-cols')
    && setlistCss.includes('html[data-sl-fit="fill"][data-layout="classic"][data-cl-hide-done] .cl-cols'),
    '經典只顯示一側時必須收成單欄');

  // 「整體背板」曾因經典重排把 root 背景寫死而失效；填滿模式必須讓它回到 root 上。
  const fillRoot = /html\[data-sl-fit="fill"\]\[data-layout\] #setlist-root \{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  ok(fillRoot.includes('background: var(--sl-user-bg, transparent)'), '整體背板設定必須在填滿模式實際生效');
});

test('歌單面板：模板分群與快速調整四區塊', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  const setlistPanel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');

  ok(indexHtml.includes('清單型 — 跟著來源尺寸重排') && indexHtml.includes('固定版位 — 只呈現現在播放'),
    '模板選擇器必須把清單型與固定版位分開');
  // UI 清理（2026-07-25）：七個模板攤平常駐、不再有「其他模板」展開鈕與推薦/新徽章；
  // 提示文字統一為一種淡色純文字樣式，不得回到多種灰底方框混用。
  ok(!indexHtml.includes('btn-setlist-more-layouts') && !indexHtml.includes('setlist-layout-badge'),
    '模板選擇器必須攤平顯示，不得恢復展開鈕或徽章');
  ok(!panelCss.includes('.setlist-sizing-hint { margin:10px 0 0; padding') && !panelCss.includes('.setlist-style-scope { margin:0 0 12px; padding'),
    '提示不得回到灰底方框樣式');
  ok(indexHtml.includes('class="check-box"') && panelCss.includes('.check-inline input { position:absolute; opacity:0;'),
    '勾選必須用自繪勾選框，不得露出原生 checkbox');
  ok(panelCss.includes('#setlist-style-collapse > .field-group-title'), '快速調整四區必須有一致的分隔線節奏');
  ok(setlistPanel.includes("const SETLIST_SECTIONED_LAYOUTS = ['classic', 'cards', 'terminal', 'billboard', 'index', ...SETLIST_SKIN_LAYOUTS];"),
    '面板必須用同一組清單型白名單給說明文案');
  ok(panelCss.includes('.setlist-layout-group-title') && panelCss.includes('.check-inline'), '分群標題與勾選樣式必須存在');

  ['版面', '大小', '顏色', '可讀性'].forEach((title) => {
    ok(indexHtml.includes(`>${title}</div>`), `快速調整必須有「${title}」區塊`);
  });
  // 襯底色與襯底不透明度必須相鄰（先前中間被字級滑桿隔開，使用者找不到）。
  const cardColorAt = indexHtml.indexOf('id="sls-card-color"');
  const cardOpacityAt = indexHtml.indexOf('id="sls-card-opacity"');
  ok(cardColorAt > 0 && cardOpacityAt > cardColorAt && indexHtml.slice(cardColorAt, cardOpacityAt).indexOf('type="range"') === -1,
    '可讀性襯底色與襯底不透明度之間不可再插入其他控制項');
  // 整體大小倍率搬到第一屏，且只能有一份。
  eq(indexHtml.split('id="sls-scale"').length - 1, 1, '整體大小倍率是搬移不是複製：');
  const scaleAt = indexHtml.indexOf('id="sls-scale"');
  const modalAt = indexHtml.indexOf('id="setlist-advanced-modal"');
  ok(scaleAt > 0 && modalAt > 0 && scaleAt < modalAt, '整體大小倍率必須在快速調整，不能留在詳細設定 modal 裡');
  // 會鋪滿整塊來源的整體背板改放詳細設定。
  ok(indexHtml.indexOf('id="sls-bg-opacity"') > modalAt, '整體背板屬於低頻且影響大的設定，必須移進詳細設定');
});

test('OBS 經典歌單以歌名為第一優先，長歌手名不可擠壓歌名', () => {
  const setlistCss = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const titleRule = /\.setlist-title\s*\{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  const artistRule = /\.setlist-artist\s*\{([\s\S]*?)\n\}/.exec(setlistCss)?.[1] || '';
  ok(titleRule.includes('flex: 1 1 0'), '歌名必須取得可伸縮的主要欄位');
  ok(titleRule.includes('min-width: 50%'), '狹窄列也必須保留至少半列給歌名');
  ok(artistRule.includes('flex: 0 1 38%'), '歌手欄必須是次要且可縮小的欄位');
  ok(artistRule.includes('max-width: 38%'), '歌手欄不可占用超過既定配額');
  ok(artistRule.includes('text-overflow: ellipsis'), '過長歌手名必須省略而非擠壓歌名');
});

test('首頁重構後歌詞預覽只在設定頁完整呈現；首頁 Live Bar 只留目前句視圖與示範歌詞入口', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const styleSync = fs.readFileSync(path.join(__dirname, '../public/js/app-style-sync.js'), 'utf8');
  const panelCss = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  // 首頁不再內嵌 OBS 預覽卡與 OBS 網址（頂部已有歌詞/歌單網址按鈕；完整預覽在歌詞設定頁）
  ok(!indexHtml.includes('id="lyrics-preview-obs-url"'), '首頁不應再內嵌 OBS 網址：');
  ok(!indexHtml.includes('id="obs-preview"'), '首頁不應再內嵌 OBS 預覽 iframe：');
  // 首頁 Live Bar 的歌詞迷你對時站
  ok(indexHtml.includes('id="lyric-now-line"') && indexHtml.includes('id="lyric-next-line"'), '首頁 Live Bar 必須有目前句/下一句視圖：');
  ok(indexHtml.includes('id="btn-preview-sample-lyrics"'), '首頁必須保留示範歌詞入口：');
  ok(indexHtml.includes('id="countdown-align-box"'), '首頁必須有倒數對齊：');
  // 設定頁保留完整所見即所得預覽
  ok(indexHtml.includes('class="settings-preview-head"'));
  ok(indexHtml.includes('id="settings-preview-obs-url"'));
  ok(indexHtml.includes('id="copy-obs-url-settings-preview"'));
  ok(indexHtml.includes('id="btn-settings-preview-sample-lyrics"'));
  ok(styleSync.includes('refreshObsUrls()'));
  ok(styleSync.includes("buildObsUrl({ preview: true, relative: true })"));
  ok(styleSync.includes("document.querySelectorAll('iframe.obs-preview')"));
  ok(styleSync.includes('copyObsUrlSettingsPreview.addEventListener'));
  ok(panelCss.includes('.settings-preview-head'));
  ok(panelCss.includes('.settings-preview-controls'));
});
