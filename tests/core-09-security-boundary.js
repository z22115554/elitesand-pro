'use strict';

// 核心回歸測試（security-boundary）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  readApiRoutesSource,
  path,
  os,
  vm,
  TEST_RUNTIME_DIRS,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const xieyin = require('../server/services/xieyin');
const romanizer = require('../server/services/romanizer');
const socketHandler = require('../server/routes/socket-handler');
const { selectLatestRelease } = require('../server/services/update-checker');
const releaseClient = require('../server/services/release-client');
const { TwitchService, reconnectDelay, CONNECT_WATCHDOG_MS } = require('../server/services/twitch-service');
const { assessYouTubeImport } = require('../server/utils/youtube-import-risk');
const { LOW_DISK_WARNING_BYTES, inspectDiskSpace, appendDiskSpaceWarning } = require('../server/services/disk-space');

// ═══════════════════════════════════════════
console.log('\n📦 11. 公開測試安全邊界');
// ═══════════════════════════════════════════
test('從播放清單移除歌曲後，手動歌詞與 offset 仍會保留供同 id 歌曲恢復', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [{ id: 'remembered-track', title: '保留設定的歌' }] };
  const trackOffsets = new Map([['remembered-track', 860]]);
  const manualLyricsCache = new Map([['remembered-track', {
    lyrics: '[00:00.86]保留的手動歌詞', lyricsType: 'lrc', parsedLyrics: [{ time: 860, text: '保留的手動歌詞' }],
  }]]);
  let persisted = 0;
  const ctx = {
    playState: state, trackOffsets, manualLyricsCache,
    persistState() { persisted += 1; }, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  events.get('playlist:remove')('remembered-track');
  eq(state.playlist.length, 0);
  eq(trackOffsets.get('remembered-track'), 860);
  eq(manualLyricsCache.get('remembered-track').lyrics, '[00:00.86]保留的手動歌詞');
  eq(persisted, 1, '移除後仍必須把保留的歌曲記憶寫入 state.json: ');
});

test('Release 選版與資產辨識由通知與更新器共用同一規則', () => {
  const releases = [
    { tag_name: 'v0.7.7', assets: [{ name: 'Elitesand-Pro-v0.7.7-portable.zip' }] },
    { tag_name: 'v0.8.0-rc.1', assets: [{ name: 'Elitesand-Pro-v0.8.0-rc.1-portable.zip' }] },
  ];
  eq(releaseClient.selectLatestRelease(releases).tag_name, selectLatestRelease(releases).tag_name);
  eq(releaseClient.findInstallerAsset({ assets: [{ name: 'Elitesand.Pro.Setup.0.9.9.5.exe' }] }).name, 'Elitesand.Pro.Setup.0.9.9.5.exe');
  eq(releaseClient.findInstallerAsset({ assets: [{ name: 'Elitesand Pro Setup 0.9.9.6.exe' }] }).name, 'Elitesand Pro Setup 0.9.9.6.exe');
  const checkerSource = fs.readFileSync(path.join(__dirname, '../server/services/update-checker.js'), 'utf8');
  const updaterSource = fs.readFileSync(path.join(__dirname, '../server/services/app-updater.js'), 'utf8');
  ok(checkerSource.includes("require('./release-client')"));
  ok(updaterSource.includes("require('./release-client')"));
});

test('YouTube 匯入檢查會在可用磁碟空間低於 500 MB 時追加可略過的警告', () => {
  const lowSpace = inspectDiskSpace(process.cwd(), {
    statfsSync: () => ({ bavail: 400n, bsize: 1024n * 1024n }),
  });
  eq(lowSpace.known, true);
  eq(lowSpace.low, true);
  eq(lowSpace.freeBytes, 400 * 1024 * 1024);
  eq(lowSpace.thresholdBytes, LOW_DISK_WARNING_BYTES);

  const assessment = appendDiskSpaceWarning(assessYouTubeImport({ title: 'Normal song', duration: 180, categories: ['Music'] }), lowSpace);
  eq(assessment.warning, true);
  ok(assessment.warningTypes.includes('disk-space'));
  ok(assessment.warnings.some((warning) => warning.includes('500 MB')));

  const unavailable = inspectDiskSpace(process.cwd(), { statfsSync: () => { throw new Error('unsupported'); } });
  eq(unavailable.known, false);
  const unchanged = appendDiskSpaceWarning(assessYouTubeImport({ title: 'Normal song', duration: 180, categories: ['Music'] }), unavailable);
  eq(unchanged.warning, false, '無法讀取磁碟空間時不可阻擋正常匯入');

  const audioSource = fs.readFileSync(path.join(__dirname, '../server/services/audio-processor.js'), 'utf8');
  ok(audioSource.includes('appendDiskSpaceWarning(assessment, inspectDiskSpace(outputDir))'));
});

testAsync('Twitch 解除授權會清除權杖、停止 EventSub 並保留待確認點歌', async () => {
  const { TwitchService } = require('../server/services/twitch-service');
  const auth = { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', userId: '42', userLogin: 'streamer' };
  let clearCalls = 0;
  const authStore = { load: () => auth, save: () => true, clear: () => { clearCalls += 1; return true; } };
  const pendingStore = { load: () => [], save: () => true };
  const service = new TwitchService({
    config: { twitchClientId: 'test-client', twitchRequestCommand: '!song' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => {}, onSongRequestExpired: () => {},
    authStore, pendingStore,
  });
  let socketClosed = 0;
  service.ws = { close: () => { socketClosed += 1; } };
  service.wsSessionId = 'session';
  service.pendingRequests.set('keep-request', { requestId: 'keep-request', expiresAt: Date.now() + 60000 });
  let revokedToken = null;
  const result = await service.deauthorize({ revoke: async (previousAuth) => {
    revokedToken = previousAuth.accessToken;
    return { attempted: true, revoked: true, alreadyInvalid: false };
  } });
  eq(clearCalls, 1);
  eq(socketClosed, 1);
  eq(service.auth, null);
  eq(service.ws, null);
  eq(service.connectionState, 'authorization_required');
  eq(service.pendingRequests.size, 1, '解除授權不可清掉已收到的點歌');
  eq(revokedToken, 'test-access-token');
  eq(result.remoteRevoked, true);

  const routerSource = fs.readFileSync(path.join(__dirname, '../server/routes/twitch-auth.js'), 'utf8');
  ok(routerSource.includes("router.post('/api/twitch/deauthorize', requirePin"));
  const clientSource = fs.readFileSync(path.join(__dirname, '../public/js/app-twitch.js'), 'utf8');
  ok(clientSource.includes("'/api/twitch/deauthorize'"));
  ok(clientSource.includes('DangerConfirm?.request'));
});

test('R4-3 破壞性資料操作走輸入式確認，播放清單只需簡單確認', () => {
  const root = path.join(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'public', 'js', 'app-playlist.js'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'public', 'js', 'media-library.js'), 'utf8');
  const dialog = fs.readFileSync(path.join(root, 'public', 'js', 'danger-confirm.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  ok(panel.includes('PanelConfirm?.request') && panel.includes("title: '清空本次播放清單？'") && panel.includes("tone: 'danger'"), '清空播放清單必須使用程式內一般確認: ');
  ok(panel.includes("confirmLabel: '清除全部'"), '播放清單一般確認須有明確危險操作按鈕: ');
  ok(!panel.includes("phrase: '清空播放清單'"), '清空播放清單不應再要求輸入文字: ');
  ok(library.includes("phrase: '清理音檔'"), '清理音檔必須要求輸入明確動作: ');
  ok(library.includes("phrase: '清空媒體庫'"), '清空媒體庫必須要求輸入明確動作: ');
  ok(!library.includes('清理不在目前播放清單中的已下載音檔？'), '清理音檔不得退回單鍵確認: ');
  ok(!library.includes('確定清空整個媒體庫？'), '清空媒體庫不得退回單鍵確認: ');
  ok(dialog.includes('inputMatches') && dialog.includes('submit.disabled'), '確認按鈕必須受輸入內容約束: ');
  ok(html.includes('id="danger-confirm-modal"') && html.includes('id="danger-confirm-input-field"'), '程式內確認視窗與可隱藏輸入欄必須實際掛在面板: ');
  ok(dialog.includes('config.requirePhrase !== false') && dialog.includes('inputField.hidden = !requiresPhrase'), '一般確認模式不得要求輸入文字，且必須留在程式內彈窗: ');
  const clearAllSource = panel.slice(panel.indexOf('async function clearAllTracks'), panel.indexOf('if (dom.btnPlaylistClear)'));
  ok(!clearAllSource.includes('window.confirm'), '清空播放清單不得退回瀏覽器原生確認: ');
});

testAsync('程式內一般確認可取消或確認，且不要求輸入文字', async () => {
  class FakeElement {
    constructor() {
      this.hidden = true;
      this.value = '';
      this.placeholder = '';
      this.textContent = '';
      this.disabled = true;
      this.focused = false;
      this.listeners = new Map();
      this.classList = {
        values: new Set(),
        toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); },
        remove(name) { this.values.delete(name); },
      };
    }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    focus() { this.focused = true; }
  }

  const elements = {
    'danger-confirm-modal': new FakeElement(),
    'danger-confirm-title': new FakeElement(),
    'danger-confirm-summary': new FakeElement(),
    'danger-confirm-impact': new FakeElement(),
    'danger-confirm-phrase': new FakeElement(),
    'danger-confirm-input': new FakeElement(),
    'danger-confirm-input-field': new FakeElement(),
    'danger-confirm-cancel': new FakeElement(),
    'danger-confirm-submit': new FakeElement(),
  };
  const trigger = new FakeElement();
  const context = {
    Promise,
    requestAnimationFrame(callback) { callback(); },
    document: {
      activeElement: trigger,
      getElementById(id) { return elements[id] || null; },
      contains() { return true; },
      addEventListener() {},
    },
    window: {},
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/danger-confirm.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'danger-confirm.js' });

  const cancelled = context.window.PanelConfirm.request({
    title: '清空本次播放清單？',
    summary: '即將清除 3 首歌。',
    impact: '歌曲音檔會保留。',
    confirmLabel: '清除全部',
  });
  eq(elements['danger-confirm-modal'].hidden, false, '一般確認必須顯示程式內視窗: ');
  eq(elements['danger-confirm-input-field'].hidden, true, '一般確認不應顯示輸入欄: ');
  eq(elements['danger-confirm-submit'].disabled, false, '一般確認的確認按鈕應可直接按: ');
  eq(elements['danger-confirm-submit'].textContent, '清除全部', '一般確認應顯示明確的危險操作文字: ');
  ok(elements['danger-confirm-modal'].classList.values.has('is-neutral'), '一般確認預設使用中性視覺層級: ');
  elements['danger-confirm-cancel'].listeners.get('click')();
  eq(await cancelled, false, '取消不得執行動作: ');

  const accepted = context.window.PanelConfirm.request({
    title: '清空本次播放清單？',
    confirmLabel: '清除全部',
  });
  elements['danger-confirm-submit'].listeners.get('click')();
  eq(await accepted, true, '只有程式內確認按鈕可通過確認: ');
  eq(elements['danger-confirm-input-field'].hidden, false, '關閉後必須還原輸入式確認的欄位狀態: ');
  ok(!elements['danger-confirm-modal'].classList.values.has('is-neutral'), '關閉後不得讓下一個高風險確認沿用中性外觀: ');
});

test('所有面板確認都留在程式內，不得跳瀏覽器原生對話框', () => {
  const publicJs = path.join(__dirname, '../public/js');
  const files = [];
  const visit = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  });
  visit(publicJs);
  const nativeConfirm = /(?:window\.)?confirm\s*\(/;
  const nativeDialogFiles = files.filter((file) => nativeConfirm.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(path.join(__dirname, '..'), file));
  eq(nativeDialogFiles.length, 0, `原生 confirm 不得再出現在面板程式：${nativeDialogFiles.join(', ')}`);
});

test('系統字體選單不把字體名稱拼進 HTML 或 style 字串', () => {
  const lyricExtras = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
  const picker = fs.readFileSync(path.join(__dirname, '../public/js/font-picker.js'), 'utf8');
  ok(lyricExtras.includes('ElitesandFontPicker.attach'), '字體選項必須由共用虛擬清單建立: ');
  ok(picker.includes('option.textContent = family') && picker.includes('option.value = value'), '字體名稱必須走文字節點與 value: ');
  ok(picker.includes('option.style.fontFamily ='), '字體預覽必須走 CSSOM 單一屬性: ');
  ok(!lyricExtras.includes('<option value="${safe}" style="font-family'), '字體名稱不可再拼進 option HTML/style 字串: ');
  ok(!lyricExtras.includes('fontOptionsHtml('), '舊的字串式字體選項 helper 必須移除: ');
});

test('受控本機字型資產以 FontFace 載入，且只允許 loopback 讀取', () => {
  const root = path.join(__dirname, '..');
  const scanner = fs.readFileSync(path.join(root, 'server/services/font-scanner.js'), 'utf8');
  const api = readApiRoutesSource();
  const loader = fs.readFileSync(path.join(root, 'public/js/font-assets.js'), 'utf8');
  const display = fs.readFileSync(path.join(root, 'public/js/display.js'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(root, 'public/js/lyric-extras.js'), 'utf8');
  const displayHtml = fs.readFileSync(path.join(root, 'public/display.html'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const prompterHtml = fs.readFileSync(path.join(root, 'public/prompter.html'), 'utf8');
  ok(scanner.includes('resolveFontAssetFace') && scanner.includes('fsp.realpath') && scanner.includes('MAX_FONT_ASSET_BYTES'),
    '字型檔必須由掃描器以 realpath 與大小上限驗證，不能相信前端輸入路徑: ');
  ok(api.includes("router.get('/fonts/assets/:assetId'") && api.includes("router.get('/fonts/assets/:assetId/:faceId'") && api.includes('isDirectLoopback(req)'),
    '字型資源必須有 metadata／位元組兩條路由，且只接受 loopback: ');
  ok(api.includes("'Cross-Origin-Resource-Policy': 'same-origin'") && api.includes("'X-Content-Type-Options': 'nosniff'"),
    '字型資源回應必須禁止跨來源取用與 MIME 猜測: ');
  ok(loader.includes('new FontFace(asset.family') && loader.includes('document.fonts.add(font)'),
    '前端必須實際載入 FontFace 後才宣稱本機字型可用: ');
  ok(display.includes('applyLocalFontAssets')
    && display.includes("setProperty('--display-font-family', settings.fontFamily || fallbackStack)"),
    'OBS 顯示端字型載入失敗時必須退到 CSS 字型堆疊（含在地名＋英文別名）或 Noto fallback，不能輸出空白文字: ');
  ok(lyricExtras.includes('fontAssetId') && lyricExtras.includes('verifyFontAsset'),
    '歌詞設定必須先驗證本機字型資產並持久化 opaque ID: ');
  [displayHtml, panelHtml, prompterHtml].forEach((html) => ok(html.includes('/js/font-assets.js'),
    '歌詞顯示、面板與跟唱視圖都必須載入受控字型載入器: '));
  // 集合字型（.ttc/.otc，如微軟正黑體 msjh.ttc、細明體 mingliu.ttc）：抽單體 face 的舊路
  // 已移除（實測會渲染缺字/錯 face）。這類字型不送 FontFace blob，改由客戶端用系統字型
  // 名稱堆疊叫出；資源路由要 404 讓既有 CSS fallback 生效。
  ok(scanner.includes('if (face.isCollection) return null;'),
    '集合字型不得再以 FontFace blob 遞送（避免抽取後缺字/錯 face）: ');
  ok(!scanner.includes('extractSfntFromCollection') && !scanner.includes('extractCollectionFace'),
    '有問題的 .ttc 抽取實作必須整段移除，不留死碼: ');
  ok(api.includes('face.isCollection') && api.includes('此字型為集合字型'),
    'metadata 路由要濾掉集合 face，全為集合字型時 404 觸發系統字型名稱 fallback: ');
});

test('字型解析探針只做診斷提示，不參與載入決策也不改 state', () => {
  const root = path.join(__dirname, '..');
  const probe = fs.readFileSync(path.join(root, 'public/js/font-probe.js'), 'utf8');
  const lyricExtras = fs.readFileSync(path.join(root, 'public/js/lyric-extras.js'), 'utf8');
  const display = fs.readFileSync(path.join(root, 'public/js/display.js'), 'utf8');
  const sock = fs.readFileSync(path.join(root, 'server/routes/socket-handler.js'), 'utf8');
  const panelHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const displayHtml = fs.readFileSync(path.join(root, 'public/display.html'), 'utf8');

  // 探針本體：三個 generic 各測一組 + canvas ink count + fonts.ready→rAF
  ok(probe.includes('window.ElitesandFontProbe'), 'font-probe.js 必須掛 window.ElitesandFontProbe: ');
  ok(probe.includes("['serif', 'sans-serif', 'monospace']"),
    '探針必須同時比 serif／sans-serif／monospace，避免「選到剛好等於某個 generic 的字型」誤判: ');
  ok(probe.includes('document.fonts.ready') && probe.includes('requestAnimationFrame'),
    '探針量測前必須等 document.fonts.ready 再等一個 rAF: ');
  ok(probe.includes('getImageData') && /ink\s*\+=\s*1/.test(probe),
    '探針必須用 canvas alpha ink count（不只 measureText 寬度）: ');
  ok(probe.includes('measureText') && probe.includes('actualBoundingBox'),
    '探針必須併用 measureText 寬度與 bounding box: ');

  // 面板：選字後 debounce 探針，只在沒有 asset 時探；文案是「無法確認」軟提示
  ok(lyricExtras.includes('scheduleFontProbe') && /if \(!assetId\) scheduleFontProbe/.test(lyricExtras),
    '面板必須在沒有 FontFace asset（含 .ttc 走系統名稱）時才跑探針: ');
  ok(/clearTimeout\(fontProbeTimer\)/.test(lyricExtras) && lyricExtras.includes('}, 300);'),
    '面板探針必須 debounce（約 300ms）: ');
  ok(lyricExtras.includes('無法確認') && lyricExtras.includes('可能會使用備援字型'),
    '探針提示必須是「無法確認…可能使用備援字型」的軟文案，不可寫死「找不到字型」: ');
  ok(lyricExtras.includes("SocketClient.on('font-probe:warning'"),
    '面板必須接顯示端回報的 font-probe:warning 並提示操作者: ');

  // 顯示端：只送 diagnostic-only 事件，preview／spout 不送；不得改 state 或 broadcast
  ok(display.includes('scheduleDisplayFontProbe') && display.includes("SocketClient.send('font-probe:report'"),
    '顯示端探針只能送 font-probe:report 這個診斷事件: ');
  ok(/isSpoutOutput \|\| isPreviewClient/.test(display),
    '顯示端探針必須排除 Spout 輸出與面板內 preview iframe: ');
  const probeBlock = display.slice(display.indexOf('function scheduleDisplayFontProbe'),
    display.indexOf('function scheduleDisplayFontProbe') + 900);
  ok(!/broadcast|state\s*=|persist/i.test(probeBlock),
    '顯示端探針區塊不得改 state／持久化／broadcast: ');

  // Server：font-probe:report 在唯讀白名單、per-socket rate limit、只轉送不動 state
  ok(sock.includes("'font-probe:report'") && sock.includes('FONT_PROBE_REPORT_MIN_INTERVAL_MS'),
    'font-probe:report 必須進 READ_ONLY_EVENTS 並有 per-socket rate limit: ');
  const sockHandler = sock.slice(sock.indexOf("socket.on('font-probe:report'"),
    sock.indexOf("socket.on('font-probe:report'") + 800);
  ok(sockHandler.includes("socket.clientType !== 'display'") && sockHandler.includes('_fontProbeReportAt'),
    'font-probe:report handler 必須限 display 且做時間間隔節流: ');
  ok(sockHandler.includes("emitToControlClients(io, 'font-probe:warning'")
    && !/broadcastState|stateStore|persist/i.test(sockHandler),
    'font-probe:report 只能轉送給控制端，不得寫 state／持久化／broadcastState: ');

  [panelHtml, displayHtml].forEach((html) => ok(html.includes('/js/font-probe.js'),
    '面板與顯示端都必須載入 font-probe.js: '));
});

test('媒體庫連續加入採逐首佇列與伺服器確認，避免完整歌詞併發堆積', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'public', 'js', 'media-library.js'), 'utf8');
  const playlistHandler = fs.readFileSync(path.join(root, 'server', 'routes', 'handlers', 'playlist.js'), 'utf8');
  ok(library.includes('const restoreQueue = []') && library.includes('async function runRestoreQueue'), '媒體庫還原必須有逐首處理佇列: ');
  ok(library.includes("await requestSocket('library:reimport', item.id)") && library.includes('await window.VKState.addLibraryTrack(resp.track)'), '下一首必須等待前一首還原與加入完成: ');
  ok(app.includes("SocketClient.sendWithCallback('playlist:add', [track]"), '媒體庫加入必須等待伺服器確認: ');
  const addLibraryTrack = app.slice(app.indexOf('addLibraryTrack: (track)'), app.indexOf('},\n  };'));
  ok(addLibraryTrack.indexOf("if (result?.ok) {") < addLibraryTrack.indexOf('if (shouldLoadFirstTrack) AppShared.playTrack'), '第一首只能在伺服器確認加入後才載入: ');
  ok(addLibraryTrack.indexOf('if (shouldLoadFirstTrack) AppShared.playTrack') < addLibraryTrack.indexOf('resolve(result)'), '第一首載入必須在成功回覆完成前送出: ');
  ok(playlistHandler.includes("socket.on('playlist:add', (tracks, ack) =>") && playlistHandler.includes("ack({ ok: true, added: added.length, tracks: added })"), '伺服器 playlist:add 必須回傳加入確認: ');
});

testAsync('媒體庫 UI 快速連點六首時逐首完成，失敗也不會卡住後續佇列', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/media-library.js'), 'utf8');

  class FakeElement {
    constructor() {
      this.children = [];
      this.listeners = new Map();
      this.lookup = new Map();
      this.dataset = {};
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.classList = { contains: () => false, add() {}, remove() {} };
      this.disabled = false;
      this.hidden = false;
      this.textContent = '';
      this._innerHTML = '';
    }
    set innerHTML(value) {
      this._innerHTML = value;
      this.children = [];
      this.lookup.clear();
      if (String(value).includes('lib-reimport')) {
        const add = new FakeElement();
        add.textContent = '加入清單';
        const remove = new FakeElement();
        this.lookup.set('.lib-reimport', add);
        this.lookup.set('.lib-remove', remove);
      }
    }
    get innerHTML() { return this._innerHTML; }
    get childNodes() { return this.children; }
    appendChild(child) { this.children.push(child); return child; }
    querySelector(selector) { return this.lookup.get(selector) || null; }
    querySelectorAll() { return []; }
    setAttribute() {}
    contains(child) { return this.children.includes(child); }
    closest() { return null; }
    getBoundingClientRect() { return { top: 0, bottom: 0, height: 0 }; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    click() { this.listeners.get('click')?.({ target: this }); }
  }

  async function runScenario({ rejectId = null, timeoutId = null } = {}) {
    const list = new FakeElement();
    const empty = new FakeElement();
    const elements = { 'library-list': list, 'library-empty': empty };
    const socketEvents = new Map();
    const timeline = [];
    const pendingRestores = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const enter = (phase, id) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      timeline.push(`${phase}:start:${id}`);
    };
    const leave = (phase, id) => {
      timeline.push(`${phase}:end:${id}`);
      inFlight -= 1;
    };
    const context = {
      setTimeout,
      clearTimeout,
      Promise,
      console,
      CSS: { escape: (value) => String(value) },
      document: {
        getElementById(id) { return elements[id] || null; },
        createElement() { return new FakeElement(); },
        querySelector() { return null; },
        addEventListener() {},
      },
      SharedUtils: { escapeHtml: (value) => String(value), safeHttpUrl: () => null, attachRowDragReorder: () => {} },
      ErrorHandler: { showToast(message, type) { timeline.push(`toast:${type}:${message}`); } },
      SocketClient: {
        sendWithCallback(event, data, callback) {
          if (event !== 'library:reimport') throw new Error(`未預期的 socket 事件：${event}`);
          enter('restore', data);
          pendingRestores.push({ id: data, callback });
        },
        on(event, handler) { socketEvents.set(event, handler); },
        connected() { return true; },
      },
      window: {
        innerHeight: 720,
        addEventListener() {},
        confirm() { return true; },
        VKState: {
          isInPlaylist() { return false; },
          addLibraryTrack(track) {
            enter('add', track.id);
            leave('add', track.id);
            return Promise.resolve(track.id === rejectId ? { ok: false, error: '測試拒絕' } : { ok: true });
          },
        },
      },
    };
    vm.runInNewContext(source, context, { filename: 'media-library.js' });
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `queue-${index + 1}`,
      title: `佇列測試 ${index + 1}`,
      artist: 'QA',
      playCount: 6 - index,
      lastPlayed: index,
    }));
    socketEvents.get('library:list')(items);
    eq(list.children.length, 6, '媒體庫清單必須渲染六個加入按鈕: ');
    const buttons = list.children.map((row) => row.querySelector('.lib-reimport'));
    const delegatedClick = list.listeners.get('click');
    buttons.forEach((button, index) => {
      const row = list.children[index];
      delegatedClick({
        target: {
          closest(selector) {
            if (selector === '.lib-row') return row;
            if (selector === '.lib-reimport') return button;
            return null;
          },
        },
      });
    });
    eq(pendingRestores.length, 1, '快速連點後只能先送出第一首還原: ');
    for (let index = 0; index < items.length; index += 1) {
      const pending = pendingRestores.shift();
      eq(pending?.id, items[index].id, '還原請求必須保持點選順序: ');
      leave('restore', pending.id);
      pending.callback(pending.id === timeoutId ? null : {
        track: { id: pending.id, title: pending.id, filename: 'fixture.mp3', parsedLyrics: [{ time: 0, text: pending.id }] },
      });
      // requestSocket、await addLibraryTrack 與 while 的下一輪均為 microtask；多輪 flush
      // 是為了驗證由實際 source 驅動的後續請求，不靠測試計時器碰巧排程。
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
      if (index < items.length - 1) eq(pendingRestores.length, 1, '每首完成後才可送下一首還原: ');
    }
    return { buttons, timeline, maxInFlight };
  }

  const success = await runScenario();
  eq(success.maxInFlight, 1, '還原與加入不可重疊併發: ');
  const successfulAdds = success.timeline.filter((entry) => entry.startsWith('add:end:'));
  eq(successfulAdds.join(','), 'add:end:queue-1,add:end:queue-2,add:end:queue-3,add:end:queue-4,add:end:queue-5,add:end:queue-6', `六首必須依點選順序完成（事件：${success.timeline.join(',')}）: `);
  success.buttons.forEach((button) => { eq(button.disabled, true, '成功的按鈕必須保持防重複加入: '); eq(button.textContent, '已加入'); });

  const rejected = await runScenario({ rejectId: 'queue-3' });
  eq(rejected.maxInFlight, 1, '單首拒絕後也不可轉為併發: ');
  ok(rejected.timeline.includes('add:end:queue-6'), '第三首被拒絕後，第六首仍必須完成: ');
  eq(rejected.buttons[2].disabled, false, '被伺服器拒絕的按鈕必須恢復可重試: ');
  eq(rejected.buttons[2].textContent, '加入清單', '被伺服器拒絕的按鈕必須恢復原標籤: ');

  const timedOut = await runScenario({ timeoutId: 'queue-2' });
  eq(timedOut.maxInFlight, 1, '逾時後也不可轉為併發: ');
  ok(timedOut.timeline.includes('add:end:queue-6'), '第二首逾時後，第六首仍必須完成: ');
  eq(timedOut.buttons[1].disabled, false, '逾時的按鈕必須恢復可重試: ');
  eq(timedOut.buttons[1].textContent, '加入清單', '逾時的按鈕必須恢復原標籤: ');
});

test('10k 媒體庫前端使用有界 virtual window，不再建立 10000 個常駐 row/listener', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/media-library.js'), 'utf8');
  ok(source.includes('const VIRTUAL_MAX_ROWS = 100'), 'virtual window 必須有明確 DOM row 上限: ');
  ok(source.includes('const VIRTUAL_OVERSCAN_ROWS = 20'), 'virtual window 必須保留 overscan 降低捲動換頁抖動: ');
  ok(source.includes('for (let i = virtualStart; i < virtualEnd; i += 1)'), '只能渲染目前 virtual window，不可遍歷整份 view 建 DOM: ');
  ok(source.includes("listEl.addEventListener('click', (event) =>"), '媒體庫列操作必須事件代理，listener 數不可隨 10k rows 成長: ');
  ok(source.includes("document.addEventListener('scroll', () => scheduleVirtualRender(), true)"), 'scroll 更新必須走共用排程器: ');
  ok(source.includes('virtualScrollRaf = requestAnimationFrame'), 'scroll 必須 RAF coalesce: ');
  ok(!source.includes('for (const item of view) {'), '不可退回對完整搜尋結果逐列建立 DOM: ');
});

test('playlist:add 會逐次確認加入並拒絕超過上限，供媒體庫佇列安全回滾', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const { MAX_PLAYLIST_SIZE } = require('../server/utils/track-schema');
  const events = new Map();
  const state = { playlist: [] };
  let persisted = 0;
  const ctx = {
    playState: state, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() { persisted += 1; }, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  let firstAck;
  events.get('playlist:add')([{ id: 'library-one', title: '媒體庫歌曲一' }], (result) => { firstAck = result; });
  eq(firstAck.ok, true);
  eq(firstAck.added, 1);
  eq(state.playlist.map((track) => track.id).join(','), 'library-one');
  eq(persisted, 1);

  state.playlist = Array.from({ length: MAX_PLAYLIST_SIZE }, (_, i) => ({ id: `full-${i}`, title: `已滿 ${i}` }));
  let fullAck;
  events.get('playlist:add')([{ id: 'over-limit', title: '不得加入' }], (result) => { fullAck = result; });
  eq(fullAck.ok, false);
  ok(fullAck.error.includes(String(MAX_PLAYLIST_SIZE)));
  eq(state.playlist.length, MAX_PLAYLIST_SIZE);
});

test('playlist:import 的 style／romanizationMode 驗證必須與 socket 事件一致', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [], style: 'cute', romanizationMode: 'original', playedEntryIds: new Set() };
  const ctx = {
    playState: state, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() {}, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  // 匯入檔是使用者可自行編輯的 JSON：非法值不可寫進 playState 再廣播給顯示端。
  events.get('playlist:import')({
    playlist: [{ id: 'a', title: 'A' }], style: { evil: true }, romanizationMode: 'bogus',
  }, () => {});
  eq(state.style, 'cute', '非字串 style 不可落地: ');
  eq(state.romanizationMode, 'original', '白名單外的 romanizationMode 不可落地: ');

  events.get('playlist:import')({
    playlist: [{ id: 'b', title: 'B' }], style: 'rock', romanizationMode: 'xieyin',
  }, () => {});
  eq(state.style, 'rock', '合法 style 仍要正常套用: ');
  eq(state.romanizationMode, 'xieyin', '合法 romanizationMode 仍要正常套用: ');
});

test('playlist:remove 可用 entryId 精準刪一列，不會連同重複歌曲一起刪掉', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [] };
  const ctx = {
    playState: state, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() {}, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  events.get('playlist:add')([{ id: 'twice', title: '唱兩次' }], () => {});
  events.get('playlist:add')([{ id: 'twice', title: '唱兩次' }], () => {});
  eq(state.playlist.length, 2);

  const firstEntryId = state.playlist[0].entryId;
  events.get('playlist:remove')({ entryId: firstEntryId });
  eq(state.playlist.length, 1, '帶 entryId 時只能刪掉那一列: ');
  ok(state.playlist[0].entryId !== firstEntryId, '留下的必須是另一列: ');

  // 舊語意（純字串 trackId）維持相容：刪掉同 id 的全部。
  events.get('playlist:add')([{ id: 'twice', title: '唱兩次' }], () => {});
  eq(state.playlist.length, 2);
  events.get('playlist:remove')('twice');
  eq(state.playlist.length, 0, '純字串 trackId 仍維持既有的「刪掉同 id 全部」語意: ');
});

test('重複歌曲加入清單時各自拿到獨立 entryId，不會共用同一個識別碼', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [] };
  const ctx = {
    playState: state, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() {}, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  events.get('playlist:add')([{ id: 'same-song', title: 'Superwoman' }], () => {});
  events.get('playlist:add')([{ id: 'same-song', title: 'Superwoman' }], () => {});

  eq(state.playlist.length, 2);
  ok(state.playlist[0].entryId, '第一次加入應有 entryId: ');
  ok(state.playlist[1].entryId, '第二次加入應有 entryId: ');
  ok(state.playlist[0].entryId !== state.playlist[1].entryId, '同一首歌重複加入的 entryId 不可相同: ');
  eq(state.playlist[0].id, state.playlist[1].id); // 歌曲 id 仍然相同（同一首歌）
});

test('播放重複歌曲的最後一列時，伺服器以 entryId 精準定位，不會誤判成第一列', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playback');
  const playlistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const playbackEvents = new Map();
  const state = { playlist: [], isPlaying: false, currentTrack: null };
  const ctx = {
    playState: state, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(),
    manualLyricsCache: new Map(), persistState() {}, emitSetlist() {}, recordSessionSong() {},
    broadcastState() {}, getEffectiveLyrics() { return null }, getPublicPlaylist() { return state.playlist; },
  };
  playlistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  registerPlaylistHandlers({ emit() {} }, { id: 'panel-1', clientType: 'controller', emit() {}, on(event, handler) { playbackEvents.set(event, handler); } }, ctx);

  // play:track 播放前會檢查音檔是否存在於隔離的 downloads/；建立假音檔讓這個測試
  // 專注在 entryId 定位邏輯，而不是（已由其他測試涵蓋的）音檔遺失分支。
  fs.mkdirSync(TEST_RUNTIME_DIRS.downloads, { recursive: true });
  fs.writeFileSync(path.join(TEST_RUNTIME_DIRS.downloads, 'sw.mp3'), '');
  fs.writeFileSync(path.join(TEST_RUNTIME_DIRS.downloads, 'f.mp3'), '');

  events.get('playlist:add')([{ id: 'superwoman', title: 'Superwoman', filename: 'sw.mp3' }], () => {});
  for (let i = 0; i < 100; i++) events.get('playlist:add')([{ id: `filler-${i}`, title: `Filler ${i}`, filename: 'f.mp3' }], () => {});
  events.get('playlist:add')([{ id: 'superwoman', title: 'Superwoman', filename: 'sw.mp3' }], () => {});

  const first = state.playlist[0];
  const last = state.playlist[state.playlist.length - 1];
  eq(first.id, 'superwoman');
  eq(last.id, 'superwoman');
  ok(first.entryId !== last.entryId, '首尾兩個 Superwoman 的 entryId 必須不同: ');

  playbackEvents.get('play:track')({ ...last, autoplay: true });
  eq(state.currentTrack.entryId, last.entryId, '播放最後一首 Superwoman 後，目前歌曲的 entryId 必須是最後那一列: ');
  ok(state.currentTrack.entryId !== first.entryId, '不可誤判成第一列的 Superwoman: ');
});

test('PlaylistState：重複歌曲以 entryId 定位目前播放列，避免永遠命中第一個相符 id', () => {
  const PlaylistState = require('../public/js/playlist-state.js');
  const playlist = [
    { id: 'superwoman', entryId: 'entry-1', title: 'Superwoman' },
    { id: 'other', entryId: 'entry-2', title: 'Other' },
    { id: 'superwoman', entryId: 'entry-3', title: 'Superwoman' },
  ];
  // 沒有 entryId（舊資料/舊客戶端）：退回用 id 找，會命中第一個 —— 這是已知、可接受的向下相容限制。
  eq(PlaylistState.reconcilePlaylist(playlist, 'superwoman', null).currentTrackIndex, 0);
  // 有 entryId：精準命中最後一列，不會被 id 相符的第一列誤導。
  eq(PlaylistState.reconcilePlaylist(playlist, 'superwoman', 'entry-3').currentTrackIndex, 2);
  eq(PlaylistState.reconcilePlaylist(playlist, 'superwoman', 'entry-1').currentTrackIndex, 0);

  // mergeCurrentTrackDetails 也要用 entryId 分辨，只合併到正確那一列，不會兩列都被蓋成同一份歌詞。
  const currentTrack = { id: 'superwoman', entryId: 'entry-3', lyrics: '[00:00]最後一列的歌詞', hasLyrics: true };
  const merged = PlaylistState.mergeCurrentTrackDetails(playlist, currentTrack, null);
  eq(merged[0].lyrics, undefined, '第一列（entry-1）不應被目前歌曲的歌詞覆蓋: ');
  eq(merged[2].lyrics, '[00:00]最後一列的歌詞', '第三列（entry-3）才是真正在播放、該被合併歌詞的那一列: ');
});

test('R4-2 播放清單可搜尋篩選並安全批次選取，不會選到目前歌曲', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const shared = fs.readFileSync(path.join(root, 'public', 'js', 'app-shared.js'), 'utf8');
  const playlist = fs.readFileSync(path.join(root, 'public', 'js', 'app-playlist.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'panel.css'), 'utf8');
  ok(html.includes('id="playlist-filter"') && html.includes('id="playlist-filter-mode"'), '面板必須有搜尋與狀態篩選入口: ');
  ok(html.includes('value="upcoming"') && html.includes('value="played"') && html.includes('value="no-lyrics"') && html.includes('value="missing-audio"'), '篩選必須涵蓋待唱、已唱、無歌詞與音檔遺失: ');
  ok(html.includes('id="btn-playlist-selection-remove"'), '批次移除入口必須存在: ');
  ok(shared.includes('playlistFilter: document.getElementById') && shared.includes('btnPlaylistSelectionRemove: document.getElementById'), '跨模組 DOM 表必須接上篩選與批次操作: ');
  ok(playlist.includes('function trackMatchesFilter') && playlist.includes('function toggleVisibleTrackSelection'), '篩選與可見項目選取必須有獨立邏輯: ');
  ok(playlist.includes('const selectedTrackKeys = new Set()') && playlist.includes('const selectionKeyByTrack = new WeakMap()'), '批次選取必須以每筆清單物件區分，不能把重複曲目混在一起: ');
  ok(playlist.includes('index !== currentTrackIndex && selectedTrackKeys.has(key)'), '目前播放歌曲必須排除在可批次移除的選取集合外: ');
  ok(playlist.includes('正在播放的歌曲不能批次選取') && playlist.includes("SocketClient.sendWithCallback('playlist:update'"), '批次移除必須保護目前歌曲並沿用可回滾的完整清單同步: ');
  ok(playlist.includes('DangerConfirm?.request') && playlist.includes('移除已選歌曲'), '批次移除必須先取得明確確認: ');
  ok(css.includes('.playlist.is-selecting .pi-select') && css.includes('.playlist.is-selecting .pi-extras'), '選取模式必須顯示核取框並收起列內其他動作: ');
  ok(css.includes('.playlist-head-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));') && css.includes('.playlist-head > .eyebrow { flex: 1 1 100%;'), '播放清單標題與四個管理操作必須分列，避免窄欄孤立換行: ');
  ok(css.includes('@container (max-width: 460px)') && css.includes('.playlist-filter-row #playlist-filter { grid-column: 1 / -1; }'), '窄播放清單欄的搜尋列必須先顯示完整搜尋框，再顯示篩選與清除: ');
});

test('R6-2 display runtime 指紋會涵蓋本機資產並強制更新網址', () => {
  const { renderDisplayRuntimePage } = require('../server/services/display-runtime-build');
  const page = renderDisplayRuntimePage(path.join(__dirname, '..', 'public'));
  ok(/^[a-f0-9]{16}$/.test(page.build), 'display 指紋必須是固定長度的十六進位值: ');
  ok(page.html.includes(`data-elitesand-display-build="${page.build}"`), 'display HTML 必須攜帶自身指紋: ');
  ok(page.html.includes(`/js/display.js?v=${page.build}`), 'display 主程式必須使用指紋網址: ');
  ok(page.html.includes(`/css/display.css?v=${page.build}`), 'display CSS 必須使用指紋網址: ');
  ok(!page.html.includes('fonts.googleapis.com/css2?family=Noto+Sans+SC?v='), '外部字體網址不可被錯誤改寫: ');
});

// 稽核修正：getClientCounts() 在每次 socket 連線／斷線都會叫 getDisplayRuntimeBuild()，
// 過去每次都同步重讀＋雜湊約 535KB 的 display 資產，卡在跟 lyrics:sync 同一條事件迴圈上。
test('R6-2 display 指紋只在來源真的改動時重算（面板重整不得反覆全量雜湊）', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const buildModule = require('../server/services/display-runtime-build');
  const templateDelivery = require('../server/services/template-delivery');
  buildModule.resetDisplayRuntimeBuildCache();
  templateDelivery.resetTemplateFingerprintCache();

  const originalReadFileSync = fs.readFileSync;
  const reads = [];
  fs.readFileSync = function countingReadFileSync(target, ...rest) {
    const normalized = typeof target === 'string' ? target.split(path.sep).join('/') : '';
    if (normalized.includes('/public/js/') || normalized.includes('/public/css/')) reads.push(target);
    return originalReadFileSync.call(this, target, ...rest);
  };
  let first;
  let second;
  let firstReads;
  let secondReads;
  try {
    first = buildModule.getDisplayRuntimeBuild(publicDir).build;
    firstReads = reads.length;
    reads.length = 0;
    second = buildModule.getDisplayRuntimeBuild(publicDir).build;
    secondReads = reads.length;
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  eq(first, second, '同樣的來源必須得到同樣的指紋: ');
  ok(firstReads > 0, '第一次必須真的讀過資產: ');
  eq(secondReads, 0, `快取命中不得重讀任何資產，實際讀了 ${secondReads} 個: `);
});

test('R6-2 display 指紋快取用 mtime 鍵控：改檔後必須立刻變（不可退回 TTL 或全域快取）', () => {
  // 用最小的假 public 樹，不複製真 public/（那裡有字體與 vendor，複製昂貴且沒必要）。
  const buildModule = require('../server/services/display-runtime-build');
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-display-build-'));
  const stagePublic = path.join(stageRoot, 'public');
  fs.mkdirSync(path.join(stagePublic, 'js'), { recursive: true });
  fs.mkdirSync(path.join(stagePublic, 'css'), { recursive: true });
  fs.writeFileSync(path.join(stagePublic, 'display.html'),
    '<html><head><link href="/css/display.css" rel="stylesheet"></head><body><script src="/js/display.js"></script></body></html>');
  fs.writeFileSync(path.join(stagePublic, 'css', 'display.css'), 'body { background: transparent; }');
  const targetJs = path.join(stagePublic, 'js', 'display.js');
  fs.writeFileSync(targetJs, 'console.log(1);');
  try {
    buildModule.resetDisplayRuntimeBuildCache();
    const before = buildModule.getDisplayRuntimeBuild(stagePublic).build;
    const cached = buildModule.getDisplayRuntimeBuild(stagePublic).build;
    eq(cached, before, '來源沒變時必須回同一個指紋: ');

    fs.writeFileSync(targetJs, 'console.log(2);');
    // 同一秒內寫入時 mtimeMs 有可能不變，明確推進一秒讓意圖不依賴檔案系統精度。
    const bumped = new Date(Date.now() + 1000);
    fs.utimesSync(targetJs, bumped, bumped);
    const after = buildModule.getDisplayRuntimeBuild(stagePublic).build;
    ok(after !== before, '改動 display.js 後指紋必須改變（否則 OBS 會繼續跑舊碼）: ');
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    buildModule.resetDisplayRuntimeBuildCache();
  }
});

test('R6-2 display 快取診斷必須保留唯讀權限並提供面板提示', () => {
  const root = path.join(__dirname, '..');
  const socketSource = fs.readFileSync(path.join(root, 'server', 'routes', 'socket-handler.js'), 'utf8');
  const displaySource = fs.readFileSync(path.join(root, 'public', 'js', 'display.js'), 'utf8');
  const panelSource = fs.readFileSync(path.join(root, 'public', 'js', 'app-toast-utils.js'), 'utf8');
  ok(socketSource.includes("'client:build'"), 'display 指紋回報必須在唯讀白名單中: ');
  ok(socketSource.includes('displayRuntime:'), 'client:counts 必須回傳顯示端版本狀態: ');
  ok(displaySource.includes("SocketClient.send('client:build'"), 'display 必須主動回報版本指紋: ');
  ok(panelSource.includes("t('status.lyricsStale')") && panelSource.includes("t('status.lyricsStaleWarning')"), '面板必須以可翻譯字串顯示 OBS 快取修復指引: ');
});

test('R6-2 display 版本回報會區分待驗證、正確與舊快取', () => {
  const makeIo = () => ({
    emitted: [], authMiddleware: null, connectionHandler: null, sockets: { sockets: new Map() },
    use(fn) { this.authMiddleware = fn; },
    on(event, fn) { if (event === 'connection') this.connectionHandler = fn; },
    emit(event, data) { this.emitted.push({ event, data }); },
  });
  const socket = {
    id: 'display-build-test', handshake: { auth: { clientType: 'display', pin: '' }, address: '127.0.0.1' },
    events: new Map(), emitted: [], connected: true,
    on(event, fn) { this.events.set(event, fn); },
    emit(event, data) { this.emitted.push({ event, data }); },
    use(fn) { this.packetMiddleware = fn; },
  };
  let expectedBuild = 'b'.repeat(16);
  const io = makeIo();
  socketHandler(io, { getDisplayBuild: () => expectedBuild });
  io.authMiddleware(socket, (err) => { if (err) throw err; });
  io.sockets.sockets.set(socket.id, socket);
  io.connectionHandler(socket);
  socket.events.get('client:type')('display');
  const waiting = io.emitted.at(-1).data.displayRuntime;
  eq(waiting.pending, 1, 'display 剛連線時應短暫等待版本回報: ');
  socket.events.get('client:build')({ displayBuild: waiting.expectedBuild });
  const current = io.emitted.at(-1).data.displayRuntime;
  eq(current.current, 1, '回報目前指紋後應標示為正確: ');
  expectedBuild = 'c'.repeat(16);
  socket.events.get('client:build')({ displayBuild: expectedBuild });
  const refreshed = io.emitted.at(-1).data.displayRuntime;
  eq(refreshed.expectedBuild, expectedBuild, 'display build must be refreshed for every client count');
  eq(refreshed.current, 1, 'a refreshed OBS display must be current');
  socket.events.get('client:build')({ displayBuild: 'a'.repeat(16) });
  const stale = io.emitted.at(-1).data.displayRuntime;
  eq(stale.stale, 1, '不同指紋必須標示為舊快取: ');
});

test('OBS display/setlist 意外斷線才記事故；正常關閉、面板/預覽 iframe 都不算', () => {
  const usageTelemetry = require('../server/services/usage-telemetry');
  const makeIo = () => ({
    emitted: [], authMiddleware: null, connectionHandler: null, sockets: { sockets: new Map() },
    use(fn) { this.authMiddleware = fn; },
    on(event, fn) { if (event === 'connection') this.connectionHandler = fn; },
    emit(event, data) { this.emitted.push({ event, data }); },
  });
  const makeSocket = (id, clientType) => ({
    id, handshake: { auth: { clientType, pin: '' }, address: '127.0.0.1' },
    events: new Map(), emitted: [], connected: true,
    on(event, fn) { this.events.set(event, fn); },
    emit(event, data) { this.emitted.push({ event, data }); },
    use(fn) { this.packetMiddleware = fn; },
  });

  const incidents = [];
  const originalRecordIncident = usageTelemetry.recordIncident;
  usageTelemetry.recordIncident = (name) => { incidents.push(name); return true; };
  try {
    const io = makeIo();
    socketHandler(io, { getDisplayBuild: () => 'a'.repeat(16) });

    const cases = [
      ['display', 'transport close', true, 'obs_display_disconnect'],
      ['display', 'ping timeout', true, 'obs_display_disconnect'],
      ['display', 'transport error', true, 'obs_display_disconnect'],
      ['display', 'client namespace disconnect', false, null],
      ['display', 'server namespace disconnect', false, null],
      ['display', 'server shutting down', false, null],
      ['setlist', 'transport close', true, 'obs_setlist_disconnect'],
      ['setlist', 'client namespace disconnect', false, null],
      ['display-preview', 'transport close', false, null],
      ['setlist-preview', 'transport close', false, null],
      ['display-spout', 'transport close', false, null],
      ['controller', 'transport close', false, null],
    ];
    for (const [clientType, reason, shouldRecord, expectedIncident] of cases) {
      incidents.length = 0;
      const socket = makeSocket(`${clientType}-${reason}`, clientType);
      io.authMiddleware(socket, (err) => { if (err) throw err; });
      io.sockets.sockets.set(socket.id, socket);
      io.connectionHandler(socket);
      socket.events.get('client:type')(clientType);
      socket.events.get('disconnect')(reason);
      if (shouldRecord) {
        eq(incidents.length, 1, `${clientType} / ${reason} 應該記一次事故: `);
        eq(incidents[0], expectedIncident, `${clientType} / ${reason} 記錯了事故類型: `);
      } else {
        eq(incidents.length, 0, `${clientType} / ${reason} 不該被記為事故: `);
      }
    }
  } finally {
    usageTelemetry.recordIncident = originalRecordIncident;
  }
});

test('playlist:reorder 死 handler 已移除：不再註冊，排序只走 playlist:update', () => {
  // 4d8d8e7 把 preserveLyricsFromExisting 改名成 mergePlaylistSummaryWithExisting 時漏改這個
  // handler，送出就 ReferenceError；而面板／遙控器排序早就改走 playlist:update，沒有任何人送它。
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [] };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, {
    playState: state, trackOffsets: new Map(), manualLyricsCache: new Map(),
    persistState() {}, emitSetlist() {}, broadcastState() {}, getPublicPlaylist() { return state.playlist; },
  });
  ok(!events.has('playlist:reorder'), 'playlist:reorder 不可再註冊（原本的實作會直接 ReferenceError）: ');
  ok(events.has('playlist:update'), '排序仍要能透過 playlist:update 完成: ');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'playlist.js'), 'utf8');
  ok(!handlerSource.includes('preserveLyricsFromExisting'), '不可再呼叫已不存在的 preserveLyricsFromExisting: ');
  const socketHandlerSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8');
  ok(!socketHandlerSource.includes("'playlist:reorder'"), '使用統計事件清單也不可再列出不存在的事件: ');
});

test('面板以 playlist:update 移除歌曲時，同樣不會清掉歌曲記憶', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = { playlist: [{ id: 'remembered-update', title: '面板移除的歌' }] };
  const trackOffsets = new Map([['remembered-update', 510]]);
  const manualLyricsCache = new Map([['remembered-update', { lyrics: '[00:00.51]保留', lyricsType: 'lrc' }]]);
  let persisted = 0;
  const ctx = {
    playState: state, trackOffsets, manualLyricsCache,
    persistState() { persisted += 1; }, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  let acknowledgement;
  events.get('playlist:update')([], (result) => { acknowledgement = result; });
  eq(acknowledgement.ok, true);
  eq(state.playlist.length, 0);
  eq(trackOffsets.get('remembered-update'), 510);
  eq(manualLyricsCache.get('remembered-update').lyrics, '[00:00.51]保留');
  eq(persisted, 1);
});

test('R4-2 批次移除部分歌曲後，留下的清單與所有歌曲記憶都正確保留', () => {
  const registerPlaylistHandlers = require('../server/routes/handlers/playlist');
  const events = new Map();
  const state = {
    playlist: [
      { id: 'batch-current', title: '目前播放歌曲' },
      { id: 'batch-remove-a', title: '待移除 A' },
      { id: 'batch-keep', title: '保留歌曲' },
      { id: 'batch-remove-b', title: '待移除 B' },
    ],
  };
  const trackOffsets = new Map([
    ['batch-current', 100], ['batch-remove-a', 200], ['batch-keep', 300], ['batch-remove-b', 400],
  ]);
  const manualLyricsCache = new Map([
    ['batch-remove-a', { lyrics: '[00:00.20]A', lyricsType: 'lrc' }],
    ['batch-keep', { lyrics: '[00:00.30]保留', lyricsType: 'lrc' }],
    ['batch-remove-b', { lyrics: '[00:00.40]B', lyricsType: 'lrc' }],
  ]);
  const ctx = {
    playState: state, trackOffsets, manualLyricsCache,
    persistState() {}, emitSetlist() {}, broadcastState() {},
    getPublicPlaylist() { return state.playlist; },
  };
  registerPlaylistHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  let acknowledgement;
  events.get('playlist:update')([
    { id: 'batch-current', title: '目前播放歌曲' },
    { id: 'batch-keep', title: '保留歌曲' },
  ], (result) => { acknowledgement = result; });
  eq(acknowledgement.ok, true);
  eq(state.playlist.map((track) => track.id).join(','), 'batch-current,batch-keep');
  eq(trackOffsets.get('batch-remove-a'), 200);
  eq(trackOffsets.get('batch-remove-b'), 400);
  eq(manualLyricsCache.get('batch-remove-a').lyrics, '[00:00.20]A');
  eq(manualLyricsCache.get('batch-keep').lyrics, '[00:00.30]保留');
  eq(manualLyricsCache.get('batch-remove-b').lyrics, '[00:00.40]B');
});

test('高頻播放控制只送細粒度事件，不重複廣播完整 state:sync', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const lyricEvents = new Map();
  const playbackEvents = new Map();
  const emitted = [];
  const io = { emit(event, data) { emitted.push({ event, data }); } };
  const noFullState = () => { throw new Error('高頻控制不可廣播 state:sync'); };
  const playState = {
    currentTrack: { id: 'hot-track', title: 'Hot track' }, currentOffset: 0,
    pitchShift: 0, playbackRate: 1, metronomeEnabled: true,
    style: 'cute', styleOverrides: {}, romanizationMode: 'original',
  };
  registerLyricsHandlers(io, { on(event, handler) { lyricEvents.set(event, handler); } }, {
    playState, trackOffsets: new Map(), manualLyricsCache: new Map(), lyricOffsetSyncTimers: new Map(),
    persistState() {}, broadcastState: noFullState,
  });
  registerPlaybackHandlers(io, { on(event, handler) { playbackEvents.set(event, handler); }, id: 'fixture', clientType: 'controller' }, {
    playState, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map(),
    persistState() {}, emitSetlist() {}, recordSessionSong() {}, broadcastState: noFullState, getEffectiveLyrics() { return null; },
  });
  lyricEvents.get('offset:adjust')({ trackId: 'hot-track', delta: 100 });
  playbackEvents.get('style:override')({ intensity: 2 });
  playbackEvents.get('pitch:change')(1);
  playbackEvents.get('speed:change')(1.1);
  playbackEvents.get('metronome:toggle')(false);
  ok(['offset:update', 'style:override', 'pitch:update', 'speed:update', 'metronome:update'].every((event) => emitted.some((item) => item.event === event)));
});

test('lyric-settings:update 清空本機字型資源 ID：切回內建字體必須真的寫掉舊 ID，不能被 delete 掉保留舊值', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const events = new Map();
  const ctx = {
    playState: {
      // 使用者先前選過一個本機字型，state 裡留著它的 opaque ID
      lyricSettings: { fontFamily: "'標楷體', sans-serif", fontAssetId: 'AbC123_dEf456-GhIj', fontFamilyLatinAssetId: 'ZZZ999_aaa111-bbb2' },
    },
    trackOffsets: new Map(), manualLyricsCache: new Map(), lyricOffsetSyncTimers: new Map(),
    persistState() {}, broadcastState() {},
  };
  registerLyricsHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  // 切回內建 Noto：前端送 fontAssetId:'' 表示「清除」
  events.get('lyric-settings:update')({ fontFamily: "'Noto Sans SC', sans-serif", fontAssetId: '', fontFamilyLatinAssetId: '' });
  eq(ctx.playState.lyricSettings.fontAssetId, '', '空字串必須被當成明確清除、寫回 state（否則顯示端每次重連都把舊字型疊回最前面）: ');
  eq(ctx.playState.lyricSettings.fontFamilyLatinAssetId, '', '英文字型資源 ID 同樣要能被清空: ');

  // 但格式不對的垃圾值仍要忽略（保留原值，不落地）
  ctx.playState.lyricSettings.fontAssetId = 'GoodId_1234567890ab';
  events.get('lyric-settings:update')({ fontAssetId: '../../etc/passwd' });
  eq(ctx.playState.lyricSettings.fontAssetId, 'GoodId_1234567890ab', '非法格式的 ID 必須被忽略、不覆寫既有值: ');
});

test('offset:set 會立即持久化，歌曲移出清單後重開程式仍可恢復', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const events = new Map();
  const trackOffsets = new Map();
  let persisted = 0;
  const ctx = {
    playState: { currentTrack: null }, trackOffsets, manualLyricsCache: new Map(), lyricOffsetSyncTimers: new Map(),
    persistState() { persisted += 1; }, broadcastState() {},
  };
  registerLyricsHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);
  events.get('offset:set')({ trackId: 'remembered-track', offset: -420 });
  eq(trackOffsets.get('remembered-track'), -420);
  eq(persisted, 1, 'offset:set 不可只留在記憶體: ');
});

test('sync:confirm「已對時」標記：寫入、持久化、只發給控制端；畸形 payload 不寫入', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const events = new Map();
  const emitted = [];
  const io = { emit() { emitted.push({ room: '*' }); }, to(room) { return { emit(event, payload) { emitted.push({ room, event, payload }); } }; } };
  const trackSyncConfirmed = new Set();
  let persisted = 0;
  const ctx = {
    playState: { currentTrack: null, playlist: [] }, trackOffsets: new Map(), trackSyncConfirmed,
    manualLyricsCache: new Map(), lyricOffsetSyncTimers: new Map(),
    persistState() { persisted += 1; }, broadcastState() {},
  };
  registerLyricsHandlers(io, { on(event, handler) { events.set(event, handler); } }, ctx);

  events.get('sync:confirm')(null);
  events.get('sync:confirm')({ trackId: 'a', confirmed: 'yes' });
  events.get('sync:confirm')({ trackId: 42, confirmed: true });
  eq(trackSyncConfirmed.size, 0, '畸形 sync:confirm 不可寫入：');
  eq(persisted, 0);

  events.get('sync:confirm')({ trackId: 'song-1', confirmed: true });
  ok(trackSyncConfirmed.has('song-1'), '確認後要記住：');
  eq(persisted, 1, 'sync:confirm 要落地 state.json：');
  const last = emitted[emitted.length - 1];
  eq(last.room, 'access:control', '已對時只是面板的準備標記，不可廣播給 OBS 疊加層：');
  eq(last.event, 'sync:confirmed');

  events.get('sync:confirm')({ trackId: 'song-1', confirmed: false });
  ok(!trackSyncConfirmed.has('song-1'), '取消要真的移除：');
});

test('已對時：存進 state.json、重開還在，並跟著清單摘要送到面板', () => {
  const { createAppState } = require('../server/state/app-state');
  const appState = createAppState({ emit() {} });
  ok(appState.trackSyncConfirmed instanceof Set, 'app-state 必須提供 trackSyncConfirmed：');
  const track = { id: 'confirmed-track', title: '對好了', artist: 'x', duration: 100 };
  const other = { id: 'other-track', title: '還沒', artist: 'y', duration: 100 };
  appState.playState.playlist = [track, other];
  appState.trackSyncConfirmed.add('confirmed-track');
  const summary = appState.getPublicPlaylist(() => true);
  eq(summary.find((t) => t.id === 'confirmed-track').syncConfirmed, true, '清單摘要要帶 syncConfirmed：');
  eq(summary.find((t) => t.id === 'other-track').syncConfirmed, undefined, '沒確認的歌不帶欄位（清單最多 2000 列，省流量）：');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  ok(/trackSyncConfirmed:\s*\[\.\.\.trackSyncConfirmed\]/.test(source), '已對時要寫進持久化快照：');
  ok(/saved\.trackSyncConfirmed/.test(source), '啟動時要從 state.json 讀回已對時：');
});

test('已對時：換歌詞來源時清除，不可沿用舊歌詞的確認', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  const manual = source.slice(source.indexOf("socket.on('lyrics:manual'"));
  ok(/trackSyncConfirmed\.delete\(trackId\)/.test(manual), 'lyrics:manual 套用新歌詞時要清掉已對時：');
  const sockSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8');
  const readOnlyBlock = sockSource.slice(sockSource.indexOf('const READ_ONLY_EVENTS'), sockSource.indexOf('FONT_PROBE_REPORT_MIN_INTERVAL_MS'));
  ok(!readOnlyBlock.includes('sync:confirm'), 'OBS 唯讀端不可送 sync:confirm：');
});

test('offset:adjust 一次到位的大偏移，跟分好幾次小幅微調的累積結果一致（都不再被單次 delta 誤夾在 10s）', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const { MAX_OFFSET_MS } = require('../server/utils/track-schema');
  const events = new Map();
  const trackOffsets = new Map();
  const ctx = {
    playState: { currentTrack: null }, trackOffsets, manualLyricsCache: new Map(), lyricOffsetSyncTimers: new Map(),
    persistState() {}, broadcastState() {},
  };
  registerLyricsHandlers({ emit() {} }, { on(event, handler) { events.set(event, handler); } }, ctx);

  events.get('offset:adjust')(null);
  events.get('offset:set')(null);
  eq(trackOffsets.size, 0, '畸形 offset payload 不可拋例外或寫入狀態：');

  // 模擬「對齊第一句」：MV 前奏 33 秒，一次送出 -33000ms 的 delta。
  events.get('offset:adjust')({ trackId: 'mv-long-intro', delta: -33000 });
  eq(trackOffsets.get('mv-long-intro'), -33000, '單次大偏移不該被砍到只剩 10s: ');

  // 模擬使用者連點 -0.5s 66 次達到一樣的總量，兩種方式的最終結果必須相同。
  for (let i = 0; i < 66; i++) events.get('offset:adjust')({ trackId: 'mv-nudged', delta: -500 });
  eq(trackOffsets.get('mv-nudged'), -33000);

  // 總偏移仍有上限（防呆，不是拿掉限制），且 adjust／set 用同一個常數，超過會被夾住而不是任意暴衝。
  events.get('offset:adjust')({ trackId: 'mv-extreme', delta: -(MAX_OFFSET_MS + 999999) });
  eq(trackOffsets.get('mv-extreme'), -MAX_OFFSET_MS);
  events.get('offset:set')({ trackId: 'mv-extreme-2', offset: MAX_OFFSET_MS + 999999 });
  eq(trackOffsets.get('mv-extreme-2'), MAX_OFFSET_MS);
});

testAsync('lyrics:manual（切換歌詞來源）不能因為 ctx 少帶一個欄位就整個 handler 崩潰', async () => {
  // 2026-09 使用者實機回報：切換歌詞來源後羅馬拼音/諧音永遠不出現，要切歌
  // 才會補回來。追到底是 registerLyricsHandlers 忘記把 broadcastState 從
  // ctx 解構出來，導致 socket handler 真的呼叫 broadcastState() 時直接
  // ReferenceError，把整個事件處理器中斷在羅馬化判斷式之前——不是羅馬化邏輯
  // 本身有問題。既有測試全部只組出 mock ctx 卻沒有一個真的觸發
  // lyrics:manual，這個洞才會一直沒被抓到。這裡直接呼叫它，鎖住「不會
  // 拋例外、broadcastState 真的被呼叫到」。
  // Keep this regression deterministic: the real Japanese G2P sidecar can take
  // longer than the CI timeout under parallel package jobs. Load only this
  // handler with a resolved romanizer, then restore the shared module cache.
  const romanizer = require('../server/services/romanizer');
  const handlerPath = require.resolve('../server/routes/handlers/lyrics');
  const originalHandler = require.cache[handlerPath];
  const originalAddRomanization = romanizer.addRomanization;
  let romanizationCalls = 0;
  let registerLyricsHandlers;
  try {
    romanizer.addRomanization = async (lines) => {
      romanizationCalls += 1;
      return lines.map((line) => ({ ...line, phonetic: 'kyou wa hare desu' }));
    };
    delete require.cache[handlerPath];
    registerLyricsHandlers = require(handlerPath);
  } finally {
    romanizer.addRomanization = originalAddRomanization;
    if (originalHandler) require.cache[handlerPath] = originalHandler;
    else delete require.cache[handlerPath];
  }
  const events = new Map();
  const emitted = [];
  let broadcastCalls = 0;
  const ctx = {
    playState: { currentTrack: { id: 'switch-source-track', title: '切換來源測試' }, playlist: [] },
    trackOffsets: new Map(), manualLyricsCache: new Map(), lyricOffsetSyncTimers: new Map(),
    persistState() {}, broadcastState() { broadcastCalls += 1; },
  };
  registerLyricsHandlers({ emit(event, data) { emitted.push({ event, data }); } }, { on(event, handler) { events.set(event, handler); } }, ctx);

  let threw = null;
  try {
    events.get('lyrics:manual')({
      trackId: 'switch-source-track',
      lyrics: '[00:01.00]今日は晴れです',
      lyricsType: 'lrc',
      parsedLyrics: [{ time: 1000, text: '今日は晴れです' }],
      source: 'qqmusic',
    });
  } catch (e) {
    threw = e;
  }
  eq(threw, null, 'lyrics:manual 不可同步拋出例外（曾經是 broadcastState is not defined）: ');
  eq(broadcastCalls, 1, '切換來源必須真的走到 broadcastState()，不能在那之前就中斷: ');

  eq(romanizationCalls, 1, '切換來源後必須啟動羅馬化：');
  await Promise.resolve();
  ok(emitted.some((item) => item.event === 'lyrics:romanized'), '崩潰修好後，羅馬化完成應該要能正常推播 lyrics:romanized: ');
});

test('xieyin:override：使用者手動修正單行諧音，標記 xieyinManual、廣播並寫回媒體庫', () => {
  const registerLyricsHandlers = require('../server/routes/handlers/lyrics');
  const libraryStore = require('../server/services/library-store');
  const originalUpdateMeta = libraryStore.updateMeta;
  const libraryWrites = [];
  libraryStore.updateMeta = (id, partial) => libraryWrites.push({ id, partial });

  const events = new Map();
  const emitted = [];
  let broadcastCalls = 0;
  let persisted = 0;
  const line0 = { time: 0, text: '君の中にあるもの', phonetic: 'kimi no naka ni aru mono', xieyin: '舊的自動諧音' };
  const line1 = { time: 1000, text: '第二行', phonetic: 'daini gyou', xieyin: '第二行舊諧音' };
  const track = { id: 'xieyin-override-track', title: '測試曲', parsedLyrics: [line0, line1] };
  const ctx = {
    playState: { currentTrack: track, playlist: [] },
    trackOffsets: new Map(), manualLyricsCache: new Map(), lyricOffsetSyncTimers: new Map(),
    persistState() { persisted += 1; }, broadcastState() { broadcastCalls += 1; },
  };
  try {
    registerLyricsHandlers({ emit(event, data) { emitted.push({ event, data }); } }, { on(event, handler) { events.set(event, handler); } }, ctx);

    events.get('xieyin:override')({ trackId: 'xieyin-override-track', lineTime: 0, xieyin: '使用者自己改過的諧音' });

    eq(line0.xieyin, '使用者自己改過的諧音', '對應行的 xieyin 必須被改成使用者送來的值: ');
    eq(line0.xieyinManual, true, '改過的行必須標記 xieyinManual，之後重新羅馬化才不會被蓋掉: ');
    eq(line1.xieyin, '第二行舊諧音', '沒被指定的其他行不可被動到: ');
    ok(!line1.xieyinManual, '沒被改的行不可被誤標記 xieyinManual: ');
    eq(broadcastCalls, 1, '改完必須廣播讓其他端（跟唱視圖／經典疊層）同步: ');
    eq(persisted, 1, '改完必須落地，重開程式不能遺失使用者的修正: ');
    ok(emitted.some((item) => item.event === 'xieyin:overridden' && item.data.trackId === 'xieyin-override-track' && item.data.lineTime === 0 && item.data.xieyin === '使用者自己改過的諧音'), '必須推播 xieyin:overridden 讓所有端即時更新: ');
    eq(libraryWrites.length, 1, '必須寫回媒體庫，不能只活在這次播放 session: ');
    eq(libraryWrites[0].id, 'xieyin-override-track');

    // 找不到對應時間戳的行：安全忽略，不拋例外、不誤觸廣播。
    broadcastCalls = 0;
    let threw = null;
    try {
      events.get('xieyin:override')({ trackId: 'xieyin-override-track', lineTime: 99999, xieyin: '不存在的行' });
    } catch (e) { threw = e; }
    eq(threw, null, '找不到對應行時不可拋出例外: ');
    eq(broadcastCalls, 0, '找不到對應行時不可誤觸廣播: ');
  } finally {
    libraryStore.updateMeta = originalUpdateMeta;
  }
});

test('同 id 歌曲重新加入後播放時，會套回保留的手動歌詞與 offset', () => {
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const libraryStore = require('../server/services/library-store');
  const originalAudioExists = libraryStore.audioExists;
  const originalRecordPlay = libraryStore.recordPlay;
  const events = new Map();
  const emitted = [];
  const stored = {
    id: 'remembered-readd', title: '重新加入的歌', filename: 'fixture-ready.mp3',
    lyrics: '[00:01.00]自動歌詞', lyricsType: 'lrc', parsedLyrics: [{ time: 1000, text: '自動歌詞' }],
  };
  const manual = {
    lyrics: '[00:02.50]手動修正後的歌詞', lyricsType: 'lrc', parsedLyrics: [{ time: 2500, text: '手動修正後的歌詞' }],
  };
  const playState = { playlist: [stored], currentTrack: null };
  try {
    libraryStore.audioExists = () => true;
    libraryStore.recordPlay = () => {};
    registerPlaybackHandlers(
      { emit(event, data) { emitted.push({ event, data }); } },
      { id: 'fixture-controller', clientType: 'controller', on(event, handler) { events.set(event, handler); }, emit() {} },
      {
        playState,
        trackOffsets: new Map([['remembered-readd', 2500]]),
        trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map([['remembered-readd', manual]]),
        getEffectiveLyrics(id) { return id === 'remembered-readd' ? manual : null; },
        persistState() {}, emitSetlist() {}, recordSessionSong() {}, broadcastState() {},
      },
    );
    events.get('play:track')({ id: stored.id, title: stored.title, filename: stored.filename, autoplay: false });
    eq(playState.currentTrackStarted, false, '待命載入不可誤標成已開始播放: ');
    eq(playState.currentOffset, 2500);
    eq(playState.currentTrack.lyrics, manual.lyrics);
    eq(playState.currentTrack.parsedLyrics[0].text, '手動修正後的歌詞');
    const sent = emitted.find((item) => item.event === 'play:track').data;
    eq(sent.offset, 2500);
    eq(sent.lyrics, manual.lyrics);
    events.get('play:toggle')(true);
    eq(playState.currentTrackStarted, true, '首次開始播放後必須留下已開始標記: ');
    events.get('play:toggle')(false);
    eq(playState.currentTrackStarted, true, '暫停不可清掉已開始標記: ');
  } finally {
    libraryStore.audioExists = originalAudioExists;
    libraryStore.recordPlay = originalRecordPlay;
  }
});

test('play:track 找不到音檔會記 media_missing 事故，既有的 audio:error 回應不受影響', () => {
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const libraryStore = require('../server/services/library-store');
  const usageTelemetry = require('../server/services/usage-telemetry');
  const originalAudioExists = libraryStore.audioExists;
  const originalRecordIncident = usageTelemetry.recordIncident;
  const events = new Map();
  const emitted = [];
  const incidents = [];
  const playState = { playlist: [{ id: 'missing-track', title: '找不到的歌', filename: 'gone.mp3', url: null }], currentTrack: null };
  try {
    libraryStore.audioExists = () => false;
    usageTelemetry.recordIncident = (name) => { incidents.push(name); return true; };
    registerPlaybackHandlers(
      { emit(event, data) { emitted.push({ event, data }); } },
      { id: 'fixture-missing', clientType: 'controller', on(event, handler) { events.set(event, handler); }, emit(event, data) { emitted.push({ event, data }); } },
      {
        playState, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map(),
        getEffectiveLyrics() { return null; }, persistState() {}, emitSetlist() {}, recordSessionSong() {}, broadcastState() {},
      },
    );
    events.get('play:track')({ id: 'missing-track', title: '找不到的歌', filename: 'gone.mp3' });
    eq(incidents.length, 1);
    eq(incidents[0], 'media_missing');
    const errorSent = emitted.find((item) => item.event === 'audio:error');
    ok(errorSent, '既有的音檔找不到通知必須照樣送出: ');
    eq(errorSent.data.code, 'AUDIO_FILE_MISSING');
  } finally {
    libraryStore.audioExists = originalAudioExists;
    usageTelemetry.recordIncident = originalRecordIncident;
  }
});

test('audio:error／audio:skip 轉播：解碼錯誤記 player_error，只有解碼失敗導致的跳過才記 playback_aborted', () => {
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const libraryStore = require('../server/services/library-store');
  const usageTelemetry = require('../server/services/usage-telemetry');
  const originalAudioExists = libraryStore.audioExists;
  const originalRecordIncident = usageTelemetry.recordIncident;
  const events = new Map();
  const emitted = [];
  const incidents = [];
  try {
    libraryStore.audioExists = () => true;
    usageTelemetry.recordIncident = (name) => { incidents.push(name); return true; };
    registerPlaybackHandlers(
      { emit(event, data) { emitted.push({ event, data }); } },
      { id: 'fixture-relay', clientType: 'display', on(event, handler) { events.set(event, handler); }, emit() {} },
      {
        playState: { playlist: [], currentTrack: null }, trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(),
        manualLyricsCache: new Map(), getEffectiveLyrics() { return null; }, persistState() {}, emitSetlist() {}, recordSessionSong() {}, broadcastState() {},
      },
    );

    // 面板/OBS 端回報的真實播放錯誤——一定要記
    events.get('audio:error')({ trackId: 'decode-fail', message: '解碼失敗' });
    eq(incidents.join(','), 'player_error');
    ok(emitted.some((item) => item.event === 'audio:error'), '既有的轉播行為必須照樣保留: ');

    // 解碼失敗導致的自動跳過——算事故
    incidents.length = 0;
    events.get('audio:skip')({ trackId: 'decode-fail', reason: 'audio_decode_failed' });
    eq(incidents.join(','), 'playback_aborted');

    // 其他原因（或沒帶 reason）的跳過——目前唯一來源就是解碼失敗，
    // 但防呆：不是這個原因就不該記，避免將來新增別的跳過理由時被誤算成事故。
    incidents.length = 0;
    events.get('audio:skip')({ trackId: 'user-skip' });
    eq(incidents.length, 0, '沒有 reason 的跳過不該被記為事故: ');
    events.get('audio:skip')({ trackId: 'user-skip-2', reason: 'user_requested' });
    eq(incidents.length, 0, '非解碼失敗的跳過原因不該被記為事故: ');
  } finally {
    libraryStore.audioExists = originalAudioExists;
    usageTelemetry.recordIncident = originalRecordIncident;
  }
});
