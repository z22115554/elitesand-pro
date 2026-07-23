/**
 * Elitesand Pro 後端伺服器
 * Node.js + Express + Socket.io
 *
 * 路由：
 * /            → 桌面瀏覽器＝控制面板；手機（UA 判斷）自動導向 /controller
 * /panel       → 桌面控制面板（固定入口，書籤/教學文件用）
 * /controller  → 手機遙控器（大按鈕優化）
 * /display     → OBS 歌詞疊加（透明底）
 * /setlist     → OBS 直播歌單疊加（透明底）
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { projectRoot, dataDir, downloadsDir } = require('./utils/app-paths');
const { createLogger, shutdown: shutdownLogger } = require('./utils/logger');
const { attachParentShutdown } = require('./utils/parent-shutdown');
const log = createLogger('Server');
const config = require('./utils/load-config');
const { isAllowedSocketRequest, isAllowedCorsOrigin } = require('./utils/socket-origin');
const { renderDisplayRuntimePage } = require('./services/display-runtime-build');
const ytdlpCompatibility = require('./services/ytdlp-compatibility');
const PORT = process.env.PORT || config.port || 3000;

// ─── Process 級安全網 ───
// 放在伺服器進入點（而非藏在 logger 模組裡），之後的人才找得到。
// 直播工具的原則：能繼續跑就繼續跑，但要留下完整紀錄。
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception（伺服器繼續運行，請檢查日誌）', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      callback(isAllowedCorsOrigin(origin) ? null : new Error('ORIGIN_NOT_ALLOWED'), !!isAllowedCorsOrigin(origin));
    },
    methods: ['GET', 'POST'],
  },
  allowRequest(req, callback) {
    callback(null, isAllowedSocketRequest(req));
  },
  // 8MB：面板拖曳排序/改歌名會把整份播放清單（含歌詞＋parsedLyrics）走 socket 送回，
  // 一場 20-30 首的歌單就可能超過 1MB；超過上限 Socket.io 會直接斷線、操作靜默丟失。
  maxHttpBufferSize: 8 * 1024 * 1024,
  pingTimeout: 30000,
  pingInterval: 10000,
});
require('./services/audio-processor').setProgressEmitter((data) => io.emit('youtube:progress', data));
// Only files recorded by an interrupted Elitesand Pro import are eligible here.
// An untracked .webm in downloads/ may be a user file and is left untouched.
const staleImportCleanup = require('./services/import-temp-registry').cleanupOrphans(downloadsDir);
if (staleImportCleanup.removedFiles.length) {
  log.info(`已清除 ${staleImportCleanup.removedFiles.length} 個上次未完成下載的暫存檔`);
}
if (staleImportCleanup.skippedActive) {
  log.info(`保留 ${staleImportCleanup.skippedActive} 個其他執行中匯入的暫存檔`);
}
const reportStorageError = (data) => io.emit('server:alert', { type: 'error', ...data });
require('./services/state-store').setErrorReporter(reportStorageError);
require('./services/library-store').setErrorReporter(reportStorageError);

// ─── Middleware ───
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // style/font 放行 Google Fonts：display.html / setlist.html 從 fonts.googleapis.com 載入
    // Noto Sans / Fraunces 等網頁字體，不放行的話 OBS 歌詞/歌單畫面會掉回系統字體。
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-src 'self'",
  });
  next();
});

// 2mb 足夠涵蓋 1MB 歌詞貼上與 JSON 包裝；Socket.io 另限制單一事件為 1MB。
// 伺服器綁 0.0.0.0 對區網開放，limit 開太大等於留一個記憶體轟炸面。
// 音訊檔上傳不受此限制（multer 走 multipart，另有 200MB 上限）。
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 200 }));

// 防跨站網站偷偷控制 localhost/LAN：瀏覽器跨站請求一律拒絕；OBS/CLI/Stream Deck
// 沒有 Sec-Fetch-Site/Origin，仍維持相容。GET Deck 也是寫入操作，納入保護。
app.use((req, res, next) => {
  const protectedRequest = req.path.startsWith('/api/') && (req.method !== 'GET' || req.path.startsWith('/api/deck/'));
  if (!protectedRequest) return next();
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return res.status(403).json({ error: '已拒絕跨網站操作', code: 'CROSS_SITE_REQUEST' });
  const origin = req.headers.origin;
  if (origin) {
    try {
      const expected = `${req.protocol}://${req.get('host')}`;
      if (new URL(origin).origin !== expected) return res.status(403).json({ error: '操作來源不符', code: 'INVALID_ORIGIN' });
    } catch (_) { return res.status(403).json({ error: '操作來源無效', code: 'INVALID_ORIGIN' }); }
  }
  next();
});

// ─── Request Logging Middleware ───
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const safeUrl = req.originalUrl.replace(/([?&]pin=)[^&]*/i, '$1[REDACTED]');
    log.request(req.method, safeUrl, res.statusCode, duration);
  });
  next();
});

// ─── Static Files ───
// index:false → 不讓 static 自動把 public/index.html 當成 "/" 的目錄首頁，
// 交由下方 app.get('/') 依裝置決定回面板或導向遙控器。
//
// no-cache：OBS 的瀏覽器來源（CEF）會非常頑強地快取 JS/CSS，導致改了程式碼後
// OBS 仍跑舊版（典型症狀：字級/陰影/動畫改了卻「沒變」、要手動刷新來源才生效）。
// 對自家的 js/css/html 一律回 no-cache，讓 OBS 每次載入都拿到最新碼。
// 第三方 vendor（Tone.js 等）與字體仍可長快取以維持效能。
app.use((req, res, next) => {
  if (/\.(?:js|css|html)$/i.test(req.path) && !req.path.startsWith('/vendor/')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(projectRoot, 'public'), { index: false }));

// ─── Routes ───
// PIN 登入/管理端點：刻意在這裡掛（而非套用保護 middleware），因為這本身就是
// 「輸入 PIN 換取存取權」的流程。見 server/routes/auth.js。
app.use('/api/auth', require('./routes/auth'));

const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// ─── Page Routes ───

// 頁面路由的 HTML 也禁快取（這些路徑沒有 .html 副檔名，靜態中介層抓不到）
function sendNoCache(res, file) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(projectRoot, 'public', file));
}

// 預設路由：桌面瀏覽器直接進控制面板；手機導向遙控器。
// UA 判斷只影響 "/" 這一條，/panel 與 /controller 永遠是固定入口，
// 判斷錯誤（平板、特殊瀏覽器）時使用者仍可自行輸入固定路徑。
const MOBILE_UA = /Mobi|Android|iPhone|iPod/i;
app.get('/', (req, res) => {
  if (MOBILE_UA.test(req.headers['user-agent'] || '')) {
    return res.redirect('/controller');
  }
  sendNoCache(res, 'index.html');
});

// 手機遙控器（大按鈕優化）
app.get('/controller', (req, res) => {
  sendNoCache(res, 'controller.html');
});

// 桌面控制面板（固定入口）
app.get('/panel', (req, res) => {
  sendNoCache(res, 'index.html');
});

// OBS 顯示頁面（透明背景 + 歌詞動畫）
app.get('/display', (req, res) => {
  // 除了 no-cache 標頭，也把本機 display 資產加上內容指紋。這對容易固執快取的 OBS CEF
  // 是實際強制刷新，而非只要求它「請不要快取」。指紋同時由 display.js 回報給面板診斷。
  const page = renderDisplayRuntimePage(path.join(projectRoot, 'public'));
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.type('html').send(page.html);
});

// Setlist 疊加頁（透明背景 + 直播歌單）
app.get('/setlist', (req, res) => {
  sendNoCache(res, 'setlist.html');
});

// ─── Audio Streaming ───
app.get('/audio/:filename', (req, res) => {
  // 安全修正：防止路徑穿越（例如 ..%2F..%2F 讀取 downloads 以外的檔案）
  const safeName = path.basename(req.params.filename);
  const resolvedDownloadsDir = path.resolve(downloadsDir);
  const audioPath = path.resolve(resolvedDownloadsDir, safeName);
  if (!audioPath.startsWith(resolvedDownloadsDir + path.sep)) {
    return res.status(400).json({ error: '無效的檔案名稱' });
  }
  res.sendFile(audioPath, (err) => {
    if (err) {
      log.error('音訊檔案傳送失敗: ' + safeName, err);
      if (!res.headersSent) res.status(404).json({ error: '音訊檔案不存在' });
    }
  });
});

// ─── OBS 顯示端自訂背景圖（唯讀，不掛 PIN：<img>/CSS background 帶不了自訂 header，
// 與 /audio、/api/cover 同一先例）───
app.get('/background/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  const backgroundsDir = path.join(dataDir, 'backgrounds');
  const bgPath = path.resolve(backgroundsDir, safeName);
  if (!bgPath.startsWith(backgroundsDir + path.sep)) {
    return res.status(400).json({ error: '無效的檔案名稱' });
  }
  res.sendFile(bgPath, (err) => {
    if (err) {
      if (!res.headersSent) res.status(404).json({ error: '背景圖不存在' });
    }
  });
});

// ─── Socket.io 即時通訊 ───
const socketHandler = require('./routes/socket-handler');
const socketApi = socketHandler(io);

// ─── Twitch：本機 Device Code Flow + EventSub WebSocket ───
// 未填 twitchClientId 時 service 保持閒置，零外連；設定後才會在登入成功後建立 EventSub。
const { TwitchService } = require('./services/twitch-service');
const twitch = new TwitchService({
  config,
  onStreamOnline: (event) => socketApi.startTwitchSession(event),
  onStreamOffline: (event) => socketApi.stopTwitchSession(event),
  onSongRequest: (request) => socketApi.dispatchTwitchSongRequest(request),
  onSongRequestExpired: (requestId) => socketApi.expireTwitchSongRequest(requestId),
  onSongRequestCanceled: (requestId) => socketApi.cancelTwitchSongRequest(requestId),
  onRequestSettingsChange: (settings) => socketApi.persistTwitchRequestSettingsFromService(settings),
  onPanelAction: (action) => socketApi.dispatchTwitchAdminAction(action),
  onPendingRequestsChanged: () => socketApi.broadcastTwitchRequests(),
  onHistoryChanged: (entries) => socketApi.broadcastTwitchHistory(entries),
  onStatusChange: (status) => socketApi.recordTwitchStatus(status),
  getPlaybackSnapshot: () => socketApi.getState(),
});
socketApi.setTwitchService(twitch);
app.use(require('./routes/twitch-auth')(twitch));
twitch.start();
process.on('exit', () => twitch.stop());

// 公告抓取延後到伺服器啟動後背景執行；離線、逾時或格式錯誤都只記錄並沿用快取。
require('./services/announcement-service').startBackgroundRefresh();

// ─── 統一優雅關閉（安全更新與 Ctrl+C 共用）───
let shutdownPromise = null;
async function gracefulShutdown({ reason = 'signal', exitCode = 0 } = {}) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    log.info(`開始優雅關閉：${reason}`);
    try { require('./services/state-store').saveNow(); } catch (err) { log.warn(`狀態 flush 失敗：${err.message}`); }
    try { require('./services/library-store').saveNow(); } catch (err) { log.warn(`媒體庫 flush 失敗：${err.message}`); }
    try { twitch.stop(); } catch (err) { log.warn(`Twitch 關閉失敗：${err.message}`); }

    const forceTimer = setTimeout(() => {
      log.warn('優雅關閉逾時，強制關閉剩餘連線');
      // io.close() 的 callback 在殘留 socket 卡住時可能永不回呼；先強制中斷所有
      // socket，再關 HTTP 連線，讓下面兩個 await 都能解開。
      try { io.disconnectSockets?.(true); } catch (_) { /* best effort */ }
      try { server.closeAllConnections?.(); } catch (_) { /* best effort */ }
    }, 5000);
    forceTimer.unref?.();

    // 絕對保底：即使 io.close/server.close 的 callback 永遠不回呼，也必須讓行程退出。
    // 否則桌面殼 kill 子行程失敗時會留下仍在 listening 的孤兒 server——下次啟動被
    // 當成健康實例重用（ownsServer=false），使用者就再也關不掉程式。狀態在上面已同步
    // flush，這裡硬退不會遺失資料。
    const hardExitTimer = setTimeout(() => {
      try { log.warn('優雅關閉未於時限內完成，強制結束行程'); } catch (_) { /* logger 可能已關 */ }
      process.exit(exitCode);
    }, 8000);
    hardExitTimer.unref?.();

    await new Promise((resolve) => {
      try { io.close(() => resolve()); } catch (_) { resolve(); }
    });
    if (server.listening) {
      await new Promise((resolve) => {
        try { server.close(() => resolve()); } catch (_) { resolve(); }
      });
    }
    clearTimeout(forceTimer);
    clearTimeout(hardExitTimer);
    await shutdownLogger();
    process.exit(exitCode);
  })();
  return shutdownPromise;
}

app.set('gracefulShutdown', gracefulShutdown);
process.on('SIGINT', () => { gracefulShutdown({ reason: 'SIGINT', exitCode: 0 }); });
process.on('SIGTERM', () => { gracefulShutdown({ reason: 'SIGTERM', exitCode: 0 }); });
attachParentShutdown({
  onShutdown: () => gracefulShutdown({ reason: 'parent-message', exitCode: 0 }),
  onError: (err) => log.error(`Parent shutdown failed: ${err.message}`, err),
});

// ─── Stream Deck / 全域快捷鍵 HTTP API ───
// 支援 GET 與 POST，方便 Stream Deck「開啟網址」動作與 curl 腳本直接呼叫
// 範例：
//   http://localhost:3000/api/deck/play-toggle   播放/暫停
//   http://localhost:3000/api/deck/next          下一首
//   http://localhost:3000/api/deck/prev          上一首
//   http://localhost:3000/api/deck/hide-toggle   緊急隱藏歌詞（切換）
//   http://localhost:3000/api/deck/offset-plus?ms=100   歌詞提前 0.1s
//   http://localhost:3000/api/deck/offset-minus?ms=500  歌詞延後 0.5s
//   http://localhost:3000/api/deck/offset-reset  重置偏移
//   http://localhost:3000/api/deck/metronome-toggle     前奏倒數開關
//   http://localhost:3000/api/deck/style?name=rock      切換風格
//   http://localhost:3000/api/deck/state          查詢目前狀態（JSON）
//
// 設定 PIN 後，Deck 指令也需要驗證（同網段誰都能打這些網址，等於繞過面板的 PIN 保護）。
// Stream Deck 的「開啟網址」動作通常無法自訂 Header，所以除了 X-Pin header，
// 也接受 URL 上直接帶 ?pin=1234（見 require-pin.js）。
const requirePin = require('./middleware/require-pin');
const handleDeckCommand = (req, res) => {
  const action = req.params.action;
  const params = { ...req.query, ...(req.body || {}) };
  if (params.ms !== undefined) params.ms = Number(params.ms);
  try {
    const result = socketApi.command(action, params);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    log.error(`Deck 指令錯誤: ${action}`, err);
    res.status(500).json({ ok: false, message: err.message });
  }
};
app.get('/api/deck/:action', requirePin, handleDeckCommand);
app.post('/api/deck/:action', requirePin, handleDeckCommand);

// ─── 更新檢查（GitHub Releases）───
// 未在 server/config.js 設定 updateCheckRepo 時，永遠回傳 enabled:false，零網路請求
const { checkForUpdate } = require('./services/update-checker');
app.get('/api/update-check', async (req, res) => {
  try {
    const result = await checkForUpdate({ force: req.query.force === '1' });
    res.json(result);
  } catch (err) {
    // 理論上 checkForUpdate 內部已處理所有錯誤，這裡是最後防線
    log.warn(`更新檢查路由錯誤: ${err.message}`);
    res.json({ enabled: false, hasUpdate: false, error: err.message });
  }
});

// ─── Error Handling Middleware ───
app.use((err, req, res, next) => {
  const safeUrl = req.originalUrl.replace(/([?&]pin=)[^&]*/i, '$1[REDACTED]');
  log.error(`未處理的錯誤: ${req.method} ${safeUrl}`, err);
  if (err && (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT')) {
    return res.status(413).json({ error: '請求內容超過允許大小' });
  }
  // multer fileFilter 拒絕不支援的副檔名時會標 err.status = 400；訊息只回顯副檔名
  // 字串（無 HTML/腳本注入面），可安全直接回傳給前端顯示。
  if (err && err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: '伺服器內部錯誤' });
});

// ─── Start Server ───
server.listen(PORT, '0.0.0.0', () => {
  log.info(`Elitesand Pro 伺服器已啟動 (port: ${PORT})`);
  log.info('╔══════════════════════════════════════════╗');
  log.info('║            🎤 Elitesand Pro              ║');
  log.info('╠══════════════════════════════════════════╣');
  log.info(`║  控制面板: http://localhost:${PORT}            ║`);
  log.info(`║  手機遙控: http://localhost:${PORT}/controller ║`);
  log.info(`║  OBS 歌詞: http://localhost:${PORT}/display    ║`);
  log.info(`║  OBS 歌單: http://localhost:${PORT}/setlist    ║`);
  ytdlpCompatibility.scheduleProbe();
  log.info('╚══════════════════════════════════════════╝');

  // 可攜版啟動器會設 OPEN_BROWSER=1：伺服器就緒後自動以預設瀏覽器開啟控制面板。
  // 由 Node 端開啟（而非啟動器用 PowerShell 輪詢）有兩個好處：
  //   1. 時機精準——此處保證伺服器已在聽，瀏覽器一開就連得上，不會出現「無法連線」。
  //   2. 啟動器維持「純 cmd、不含 PowerShell/網路請求」→ 不會被防毒誤判刪除（實測會）。
  // 僅在明確設了 OPEN_BROWSER 時才開，正常 npm start / 開發模式不受影響。
  if (process.env.OPEN_BROWSER === '1') {
    const url = `http://localhost:${PORT}/panel`;
    require('child_process').exec(`start "" "${url}"`, (err) => {
      if (err) log.warn(`自動開啟瀏覽器失敗，請手動開啟 ${url}（${err.message}）`);
    });
  }
});

module.exports = { app, server, io, gracefulShutdown };
