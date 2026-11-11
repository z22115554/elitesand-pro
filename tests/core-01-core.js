'use strict';

// 核心回歸測試（core）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  vm,
  test,
  eq,
  ok,
} = require('./core-harness');

test('Spout CP05/CP07 keeps the native controls Electron-only and exposes bounded performance evidence', () => {
  const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const panelScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-spout-output.js'), 'utf8');
  const feedbackScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-feedback.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const nativeAddon = fs.readFileSync(path.join(__dirname, '..', 'native', 'spout-output', 'src', 'addon.cpp'), 'utf8');
  const i18n = require('../public/js/i18n');
  ok(panelHtml.includes('id="spout-output-card"') && panelHtml.includes('hidden'), 'browser panel must begin without a visible Spout control: ');
  ok(!/<p id="spout-output-message"[^>]*data-i18n/.test(panelHtml)
    && panelHtml.includes('id="spout-output-metrics"'),
  'live Spout diagnostics must not be overwritten by static i18n markup: ');
  ok(panelScript.includes('const api = shell?.spout') && panelScript.includes('if (!api || !card) return;'), 'the card must require the Electron preload API: ');
  ok(panelScript.includes('pollStatusUntilSettled')
    && panelScript.includes('snapshot?.output?.state === \'starting\'')
    && panelScript.includes("window.setTimeout(poll, state === 'starting' ? 200 : 1000)")
    && panelScript.includes("state === 'starting' || state === 'running'")
    && panelScript.includes('lastGpuSyncMs')
    && panelScript.includes('avgGpuSyncMs'),
  'the UI must retain status polling while output is live and render the GPU synchronization metrics: ');
  ok(panelHtml.includes('id="spout-output-play-note"') && panelScript.includes('playNote.hidden = !running')
    && panelHtml.includes('data-i18n="help2.spout.play"'),
  'running Spout output without playback must explain why the receiver is blank: ');
  ['lastGpuSyncMs', 'avgGpuSyncMs', 'maxGpuSyncMs', 'gpuSyncTimeouts', 'adapterVendorId', 'adapterDeviceId', 'adapterLuid'].forEach((metric) => {
    ok(nativeAddon.includes(`\"${metric}\"`), `native status must publish ${metric}: `);
  });
  ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'].forEach((locale) => {
    ok(i18n.catalogs?.[locale]?.['spout.runningPerfHint'] && i18n.catalogs?.[locale]?.['spout.metrics']
      && i18n.catalogs?.[locale]?.['spout.fpsHint'] && i18n.catalogs?.[locale]?.['feedback.typeSpout']
      && i18n.catalogs?.[locale]?.['spout.playNote'] && i18n.catalogs?.[locale]?.['help2.spout.play'],
    `${locale} must translate the live Spout performance and issue-report diagnostics: `);
  });
  ok(preload.includes("'elitesand:spout-status'") && preload.includes("'elitesand:spout-save-settings'")
    && preload.includes("'elitesand:spout-start'") && preload.includes("'elitesand:spout-stop'")
    && preload.includes("'elitesand:spout-issue-diagnostics'")
    && !preload.includes("'elitesand:spout-recording-"), 'preload must expose only the approved fixed Spout channels: ');
  ok(!panelHtml.includes('spout-recording-') && !panelScript.includes('Recording'), 'manual Spout recording controls must not remain in the panel: ');
  ok(!preload.includes('spout: Object.freeze({\n    invoke') && !preload.includes('spout: Object.freeze({\n    send'), 'the Spout surface must not accept arbitrary IPC channels: ');
  ok(feedbackScript.includes('attachSpoutDiagnostics') && feedbackScript.includes("report.type !== 'spout'")
    && feedbackScript.includes('getIssueDiagnostics'), 'Spout diagnostics must be requested only by the user-selected report type: ');
  ok(shellSource.includes("event?.sender !== window.webContents") && shellSource.includes('await stopSpoutDisplayOutput();'), 'main must check IPC origin and release output during shutdown: ');
});

test('Spout lab launcher isolates its app identity and disables only its remote announcements', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const announcementSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'announcement-service.js'), 'utf8');
  ok(packageJson.scripts['shell:spout']?.includes('ELITESAND_SPOUT_EXPERIMENT=1')
    && packageJson.scripts['shell:spout']?.includes('ELITESAND_DISABLE_ANNOUNCEMENTS=1')
    && packageJson.scripts['shell:spout']?.includes('ELITESAND_SHELL_USER_DATA_DIR=.local\\spout-shell-user-data'),
  'the experimental launcher must have its own opt-in runtime: ');
  ok(shellSource.includes("'com.elitesand.pro.spout-lab'") && shellSource.includes("'Elitesand Pro Spout Lab'"),
    'the experimental shell must not share the production single-instance identity: ');
  ok(announcementSource.includes("process.env.ELITESAND_DISABLE_ANNOUNCEMENTS === '1'")
    && announcementSource.includes('if (announcementsDisabled) return null;'),
  'the opt-in announcement disable must not affect normal launches: ');
});

test('Spout Motion 60 diagnostic is isolated and drives a visible per-frame marker', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const sharedTextureHarness = fs.readFileSync(path.join(__dirname, '..', 'tools', 'test-spout-shared-texture.js'), 'utf8');
  ok(packageJson.scripts['test:spout-motion-60:intel']?.includes('ELITESAND_SPOUT_SHARED_TEXTURE_MOTION_DIAGNOSTIC=1')
    && packageJson.scripts['test:spout-motion-60:intel']?.includes('ELITESAND_SPOUT_GPU_PREFERENCE=low-power')
    && packageJson.scripts['test:spout-motion-60:intel']?.includes('ELITESAND_SPOUT_ADDON=.local\\spout-output-build-adapterdiag')
    && packageJson.scripts['test:spout-motion-30:intel']?.includes('ELITESAND_SPOUT_SHARED_TEXTURE_FPS=30'),
  'the Intel motion diagnostic must select one isolated, matching sender path: ');
  ok(sharedTextureHarness.includes("ELITESAND_SPOUT_SHARED_TEXTURE_MOTION_DIAGNOSTIC === '1'")
    && sharedTextureHarness.includes("'MOTION ' + expectedFps + '  FRAME '")
    && sharedTextureHarness.includes('Math.floor(t * expectedFps / 1000)'),
  'the motion diagnostic must visibly change once per requested frame-rate tick: ');
});

const playlistState = require('../public/js/playlist-state');

test('跨端歌單重排後以 track.id 保持目前歌曲', () => {
  const before = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const activeId = playlistState.getTrackIdAtIndex(before, 1);
  const result = playlistState.reconcilePlaylist([{ id: 'b' }, { id: 'c' }, { id: 'a' }], activeId);
  eq(result.currentTrackIndex, 0);
  eq(result.playlist[result.currentTrackIndex].id, 'b');
});

test('跨端歌單移除目前歌曲後索引回到 -1', () => {
  const result = playlistState.reconcilePlaylist([{ id: 'a' }, { id: 'c' }], 'b');
  eq(result.currentTrackIndex, -1);
});

test('state:sync 明確沒有目前歌曲時不沿用舊索引', () => {
  const result = playlistState.reconcilePlaylist([{ id: 'a' }], null);
  eq(result.currentTrackIndex, -1);
});

test('空歌單同步會清空並重設目前歌曲', () => {
  const result = playlistState.reconcilePlaylist([], 'a');
  eq(result.playlist.length, 0);
  eq(result.currentTrackIndex, -1);
});

test('controller 重連可依目前歌曲 id 從清單重新取得索引', () => {
  const result = playlistState.reconcilePlaylist([{ id: 'first' }, { id: 'playing' }, { id: 'last' }], 'playing');
  eq(result.currentTrackIndex, 1);
});

test('P0：桌面貼上歌詞解除 hidden，controller 同步會回填目前歌曲索引', () => {
  const root = path.join(__dirname, '..');
  const desktopLyrics = fs.readFileSync(path.join(root, 'public', 'js', 'app-lyrics-timeline.js'), 'utf8');
  const controllerHtml = fs.readFileSync(path.join(root, 'public', 'controller.html'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'public', 'js', 'controller.js'), 'utf8');
  ok(desktopLyrics.includes('dom.lyricsPasteModal.hidden = false') && desktopLyrics.includes('dom.lyricsPasteModal.hidden = true'), '桌面貼上歌詞 modal 必須明確開關 hidden: ');
  ok(controllerHtml.includes('src="/js/playlist-state.js"'), 'controller 必須載入共用清單索引邏輯: ');
  ok(controller.includes('function reconcileCurrentTrackIndex(track)') && controller.includes("SocketClient.on('state:sync'") && controller.includes('reconcileCurrentTrackIndex(track)'), 'controller state:sync 必須依 currentTrack.id 回填索引: ');
});

test('P0：貼上歌詞可實際開啟，controller 重連後可對目前歌曲操作', () => {
  class FakeElement {
    constructor() {
      this.hidden = false;
      this.value = '';
      this.textContent = '';
      this.innerHTML = '';
      this.checked = false;
      this.disabled = false;
      this.style = {};
      this.listeners = new Map();
      this.classList = {
        values: new Set(),
        add: (name) => this.classList.values.add(name),
        remove: (name) => this.classList.values.delete(name),
        toggle: (name, force) => {
          if (force === undefined) { if (this.classList.values.has(name)) this.classList.values.delete(name); else this.classList.values.add(name); return; }
          if (force) this.classList.values.add(name); else this.classList.values.delete(name);
        },
        contains: (name) => this.classList.values.has(name),
      };
    }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    focus() {}
    querySelectorAll() { return []; }
    get children() { return this._children || (this._children = []); }
    get firstElementChild() { return this.children[0] || null; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; }
    get dataset() { return this._dataset || (this._dataset = {}); }
  }

  const desktopElements = {
    btnPasteLyrics: new FakeElement(),
    lyricsPasteModal: new FakeElement(),
    lyricsPasteTextarea: new FakeElement(),
    lyricsPasteConfirm: new FakeElement(),
    lyricsPasteCancel: new FakeElement(),
  };
  desktopElements.lyricsPasteModal.hidden = true;
  const desktopState = { playlist: [{ id: 'current-song' }], currentTrackIndex: 0 };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/app-lyrics-timeline.js'), 'utf8'),
    {
      SharedUtils: { escapeHtml: (value) => value },
      AppShared: { dom: desktopElements, state: desktopState, showToast() {}, renderPlaylist() {} },
      SocketClient: { send() {} },
      PinAuth: { fetchWithPin() {} },
    },
    { filename: 'app-lyrics-timeline.js' },
  );
  desktopElements.btnPasteLyrics.listeners.get('click')();
  eq(desktopElements.lyricsPasteModal.hidden, false, '桌面貼上歌詞按鈕必須實際打開 modal: ');
  desktopElements.lyricsPasteCancel.listeners.get('click')();
  eq(desktopElements.lyricsPasteModal.hidden, true, '取消必須重新隱藏 modal: ');

  const controllerElements = new Map();
  const elementFor = (id) => {
    if (!controllerElements.has(id)) controllerElements.set(id, new FakeElement());
    return controllerElements.get(id);
  };
  const controllerEvents = new Map();
  const controllerToasts = [];
  const controllerContext = {
    SharedUtils: { formatTime: (value) => String(value), escapeHtml: (value) => String(value || ''), safeHttpUrl: () => null },
    PlaylistState: playlistState,
    SocketClient: { init() {}, on(event, handler) { controllerEvents.set(event, handler); }, send() {} },
    ErrorHandler: { init() {}, showToast(message) { controllerToasts.push(message); } },
    PinAuth: { fetchWithPin() {} },
    document: {
      getElementById: elementFor,
      querySelectorAll() { return []; },
      createElement() { return new FakeElement(); },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/controller.js'), 'utf8'),
    controllerContext,
    { filename: 'controller.js' },
  );
  controllerEvents.get('state:sync')({
    currentTrack: { id: 'playing', title: '目前歌曲', artist: '測試者' },
    playlist: [{ id: 'first', title: '第一首' }, { id: 'playing', title: '目前歌曲' }, { id: 'last', title: '最後一首' }],
  });
  elementFor('btn-lyrics-paste').listeners.get('click')();
  ok(elementFor('lyrics-paste-modal').classList.contains('active'), 'controller 重連後貼歌詞必須指向目前歌曲而非誤報未選歌: ');
  ok(!controllerToasts.includes('請先選擇歌曲'), 'controller 重連後不應誤報未選歌曲: ');
  // 清單改成逐列更新（每列是獨立元素），active 標在列本身的 class 上。
  const rows = elementFor('playlist').children;
  eq(rows.length, 3, 'controller 清單要渲染出三列: ');
  const hasActive = (row) => row.className.split(' ').includes('active');
  ok(hasActive(rows[1]) && rows[1].innerHTML.includes('目前歌曲'), 'controller 清單必須標示重連後的目前歌曲: ');
  ok(!hasActive(rows[0]) && !hasActive(rows[2]), '只有目前歌曲那列標 active: ');
});

test('預覽縮放不依賴可能在嵌入式 WebView 報錯的 ResizeObserver', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/preview-scale.js'), 'utf8');
  ok(source.includes("window.addEventListener('resize', apply)"), '預覽縮放必須在視窗縮放時重新計算: ');
  ok(!source.includes('new ResizeObserver'), '預覽縮放不得建立不相容的 ResizeObserver: ');
});

test('面板只載入目前可見的 OBS 預覽，避免隱藏 iframe 持續耗用 CPU/GPU', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const lifecycle = fs.readFileSync(path.join(__dirname, '../public/js/preview-scale.js'), 'utf8');
  const previewFrames = page.match(/<iframe[^>]+(?:obs-preview|setlist-preview)[^>]*>/g) || [];
  // 首頁重構後不再內嵌 OBS 預覽 iframe（改用 Live Bar 的目前句文字視圖）；剩下的預覽 iframe
  // 都在「歌詞設定」「直播歌單」頁。數量變動時請同步檢查 preview-scale.js 的生命週期管理。
  // 2026-11-10 起直播頁多一份可收合的歌詞預覽：收起時不載入（details 沒開就不給 src）。
  eq(previewFrames.length, 5, '面板預覽數量基準已改變，請同步檢查生命週期管理: ');
  ok(lifecycle.includes("if (frame.closest('details:not([open])')) return false;"), '收起的預覽不可載入: ');
  ok(lifecycle.includes("details.addEventListener('toggle', () => setTimeout(refresh, 0));"), '展開／收起要重新判斷載入: ');
  previewFrames.forEach((frame) => {
    ok(frame.includes('data-preview-src='), '預覽 iframe 必須保存延遲載入來源: ');
    ok(!/\ssrc=/.test(frame), '預覽 iframe 不可在 HTML 解析時直接載入: ');
  });
  ok(lifecycle.includes("frame.removeAttribute('src')"), '不可見預覽必須卸載子頁面與動畫迴圈: ');
  ok(lifecycle.includes("document.addEventListener('view:change'"), '切換面板頁面時必須同步預覽生命週期: ');
  ok(lifecycle.includes('window.PreviewLifecycle = { refresh, setSource }'), '詳細設定 modal 必須能要求重新判斷預覽可見性: ');
});

test('顯示端暫停時不持續逐幀重算歌詞', () => {
  // 跨行比對：CRLF 取出的檔案會誤判成失敗，先正規化行尾（同下方 KTV 掃色那題的作法）。
  const source = fs.readFileSync(path.join(__dirname, '../public/js/display.js'), 'utf8').replace(/\r\n/g, '\n');
  ok(source.includes('if (isControllerPlaying) {\n        const timeMs = getSmoothTimeMs();'), 'rAF 的高成本渲染必須只在播放時執行: ');
});

test('對齊第一句維持純文字按鈕，不加入 emoji', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const autoRows = fs.readFileSync(path.join(__dirname, '../public/js/i18n-auto.js'), 'utf8');
  const targetEmoji = String.fromCodePoint(0x1F3AF);
  ok(page.includes('id="offset-align"') && page.includes('>對齊第一句</button>'), '對齊第一句按鈕必須保留純文字標籤: ');
  ok(!page.includes(targetEmoji) && !autoRows.includes(targetEmoji), '對齊第一句的五語字串不可帶 emoji: ');
});

test('清單摘要只把完整歌詞合回目前歌曲', () => {
  const summaries = [
    { id: 'a', title: '目前歌曲', hasLyrics: true, lyricsType: 'lrc' },
    { id: 'b', title: '下一首', hasLyrics: true, lyricsType: 'lrc' },
  ];
  const currentTrack = {
    id: 'a', lyrics: '[00:01.00]目前歌曲', parsedLyrics: [{ time: 1000, text: '目前歌曲' }],
    lyricsType: 'lrc', hasLyrics: true,
  };
  const merged = playlistState.mergeCurrentTrackDetails(summaries, currentTrack);
  eq(merged[0].lyrics, '[00:01.00]目前歌曲');
  eq(merged[0].parsedLyrics[0].text, '目前歌曲');
  eq(merged[1].lyrics, undefined, '非目前歌曲不應保留完整歌詞: ');
});

test('Windows PowerShell 建置腳本使用 UTF-8 BOM', () => {
  const fsForEncoding = require('fs');
  const toolsDir = require('path').join(__dirname, '..', 'tools');
  const scripts = fsForEncoding.readdirSync(toolsDir).filter((name) => name.endsWith('.ps1'));
  ok(scripts.length >= 3, `tools/ 應至少有三支 ps1（portable/update/installer），實際 ${scripts.length}: `);
  for (const filename of scripts) {
    const bytes = fsForEncoding.readFileSync(require('path').join(toolsDir, filename));
    ok(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, `${filename} 必須讓 Windows PowerShell 5.1 正確辨識 UTF-8: `);
  }
});

const staticContracts = require('./static-contracts');

test('靜態守衛：server 發出的 socket 事件都會由前端泛用 relay 轉接', () => {
  const root = path.join(__dirname, '..');
  const report = staticContracts.socketContractReport(
    staticContracts.loadRepositorySources(root),
    fs.readFileSync(path.join(root, 'public', 'js', 'socket-client.js'), 'utf8')
  );
  ok(report.forwardsAllServerEvents, 'socket-client 必須使用 socket.onAny 泛用 relay: ');
  eq(report.forwarded.length, 0, '泛用 relay 不應保留手動 server 事件轉接: ');
  eq(report.missing.join(','), '', `漏接事件 ${report.missing.join(', ')}: `);
});

test('靜態守衛：沒有泛用 relay 的舊式轉接仍會偵測漏接事件', () => {
  const serverSources = [{ file: 'server/example.js', source: "io.emit('fixture:event', {});" }];
  const report = staticContracts.socketContractReport(serverSources, "socket.on('other:event', () => {});");
  eq(report.missing.join(','), 'fixture:event');
});

test('SocketClient 泛用 relay 保留未知事件與多參數，不重複既有事件', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'socket-client.js'), 'utf8');
  const directHandlers = new Map();
  const anyHandlers = [];
  const fakeSocket = {
    id: 'socket-client-test',
    auth: {},
    on(event, callback) { directHandlers.set(event, callback); return this; },
    onAny(callback) { anyHandlers.push(callback); return this; },
    emit() {},
    disconnect() {},
    connect() {},
    receive(event, ...args) {
      anyHandlers.forEach((callback) => callback(event, ...args));
      directHandlers.get(event)?.(...args);
    },
  };
  const context = {
    io: () => fakeSocket,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(`${source}\n;globalThis.__socketClientForTest = SocketClient;`, context);
  const client = context.__socketClientForTest;
  client.init('controller');

  const received = [];
  client.on('future:server-event', (...args) => received.push(args));
  fakeSocket.receive('future:server-event', { ok: true }, 'second-argument');
  eq(JSON.stringify(received), JSON.stringify([[{ ok: true }, 'second-argument']]));

  let knownCount = 0;
  client.on('play:next', () => { knownCount++; });
  fakeSocket.receive('play:next');
  eq(knownCount, 1);
});

test('靜態守衛：所有寫入型 HTTP 路由都有 requirePin 或具理由的例外', () => {
  const report = staticContracts.routeContractReport(staticContracts.loadRepositorySources(path.join(__dirname, '..')));
  eq(report.unprotected.map((item) => item.key).join(','), '', `未保護路由 ${report.unprotected.map((item) => item.key).join(', ')}: `);
  eq(report.staleAllowlist.join(','), '', `過期例外 ${report.staleAllowlist.join(', ')}: `);
});

test('靜態守衛：受 requireControlAccess 保護的 fetch 必須走 PinAuth.fetchWithPin（鐵則 16）', () => {
  const pinAuth = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pin-auth.js'), 'utf8');
  for (const route of ['/api/auth/verify', '/api/auth/set', '/api/auth/clear']) {
    // " fetch('" 只會命中裸呼叫；fetchWithPin(' 的 fetch 後面接的是 W，不會誤判。
    ok(!pinAuth.includes(` fetch('${route}'`),
      `${route} 不可用裸 fetch（會漏掉 X-Elitesand-Controller，已配對裝置被自己伺服器 401）: `);
    ok(pinAuth.includes(`fetchWithPin('${route}'`), `${route} 必須用 fetchWithPin: `);
  }
  // 401/403 只回 { error, code }；只讀 message 會讓可行動的原因變成無訊息的泛用失敗。
  ok(pinAuth.includes("data.message || data.error || '設定失敗'"), 'PIN 設定錯誤需顯示伺服器回的 error: ');
  ok(pinAuth.includes("data.message || data.error || '停用失敗'"), 'PIN 停用錯誤需顯示伺服器回的 error: ');

  // /api/eula/accept 現在也掛 requireControlAccess：條款改版後，已配對的手機／平板
  // 仍必須能同意，否則等於把遠端裝置永久鎖在同意閘門外。
  const eulaGate = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'eula-gate.js'), 'utf8');
  ok(eulaGate.includes("PinAuth.fetchWithPin('/api/eula/accept'"),
    'EULA 同意必須帶 AccessAuth 憑證，否則已配對裝置在條款改版後會被 401: ');
});

test('靜態守衛：故意漏掛 requirePin 時會偵測失敗', () => {
  const sources = [{ file: 'server/routes/fixture.js', source: "router.post('/danger', async (req, res) => {});" }];
  const report = staticContracts.routeContractReport(sources, new Map());
  eq(report.unprotected[0].key, 'server/routes/fixture.js:POST:/danger');
});
