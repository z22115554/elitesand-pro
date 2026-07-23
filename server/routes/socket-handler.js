/**
 * Socket.io 即時通訊 — 組裝器
 *
 * 實現跨裝置同步：控制面板 ↔ OBS 顯示 ↔ 手機遙控器 ↔ Setlist 疊加頁。
 *
 * 職責分工（拆分自原 1200+ 行單一 closure）：
 * - state/app-state.js          狀態容器＋持久化＋廣播/payload 輔助（單一事實來源）
 * - handlers/playback.js        播放/風格/緊急隱藏/變調變速/歌詞同步管線
 * - handlers/lyrics.js          offset/歌詞外觀設定/手動歌詞
 * - handlers/playlist.js        播放清單 CRUD＋匯出入
 * - handlers/library.js         媒體庫
 * - handlers/setlist.js         直播 session＋歌單疊加
 * - deck-commands.js            Stream Deck HTTP 指令（共用同一份 ctx）
 *
 * 這裡只負責：連線/斷線追蹤、客戶端類型識別（client:type）、狀態恢復（state:request）、
 * 以及把每個連線交給各 handler 註冊事件。
 */

const { createLogger } = require('../utils/logger');
const { createAppState } = require('../state/app-state');
const path = require('path');
const { projectRoot, downloadsDir } = require('../utils/app-paths');
const { createLoudnessBackfill } = require('../services/loudness-backfill');
const { getDisplayRuntimeBuild } = require('../services/display-runtime-build');
const { createDeckCommands } = require('./deck-commands');
const registerPlaybackHandlers = require('./handlers/playback');
const registerLyricsHandlers = require('./handlers/lyrics');
const registerPlaylistHandlers = require('./handlers/playlist');
const registerLibraryHandlers = require('./handlers/library');
const registerSetlistHandlers = require('./handlers/setlist');
const registerTwitchHandlers = require('./handlers/twitch');
const TwitchRequestSettings = require('../../public/js/twitch-request-settings');
const authStore = require('../services/auth-store');
const authRateLimiter = require('../services/auth-rate-limiter');
const stateStore = require('../services/state-store');
const defaultRuntimeEvidence = require('../services/runtime-evidence');

const log = createLogger('Socket');

// OBS 疊加層一律豁免 PIN：那是唯讀畫面，斷線＝畫面直接消失在直播上，
// 風險比「同網路的人連上控制」還大，不能因為 PIN 錯誤就把它擋在外面。
// display-preview / setlist-preview = 控制面板內嵌的預覽 iframe（?preview=1）：
// 資料照餵、豁免 PIN（iframe 拿不到面板的 PIN），但不計入「OBS 已連線」數。
const PIN_EXEMPT_CLIENT_TYPES = new Set(['display', 'setlist', 'display-preview', 'setlist-preview']);
const CLIENT_TYPES = new Set(['controller', 'remote', ...PIN_EXEMPT_CLIENT_TYPES]);
const READ_ONLY_EVENTS = new Set(['client:type', 'client:build', 'state:request', 'setlist:get']);
const DISPLAY_BUILD_REPORT_GRACE_MS = 3500;

module.exports = function socketHandler(io, {
  runtimeEvidence = defaultRuntimeEvidence,
  getDisplayBuild = () => getDisplayRuntimeBuild(path.join(projectRoot, 'public')).build,
} = {}) {
  // ─── 全域狀態（單一事實來源，含 state.json 還原）───
  const ctx = createAppState(io);

  // ─── 統一音量：啟動後回填既有歌曲的響度（測試的隔離 downloads 為空 → 自動 no-op）───
  const libraryStore = require('../services/library-store');
  const AudioProcessorService = require('../services/audio-processor');
  createLoudnessBackfill({
    playState: ctx.playState,
    persistState: ctx.persistState,
    broadcastState: ctx.broadcastState,
    measure: (filename) => AudioProcessorService.measureLoudnessQueued(path.join(downloadsDir, filename)),
    audioExists: libraryStore.audioExists,
    updateLibraryMeta: libraryStore.updateMeta,
  }).start();

  // ─── 讓 LyricsEngine 能主動推播（羅馬化完成等後台事件）───
  const { setIo } = require('../services/lyrics-engine');
  setIo(io);

  // ─── PIN 驗證（握手階段，client 透過 io({ auth: { clientType, pin } }) 傳入）───
  // 未設定 PIN 時完全不擋，跟加這個功能前行為一致。
  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    if (!CLIENT_TYPES.has(auth.clientType)) return next(new Error('INVALID_CLIENT_TYPE'));
    socket.clientType = auth.clientType;
    socket.readOnly = PIN_EXEMPT_CLIENT_TYPES.has(auth.clientType);
    if (socket.readOnly) return next();
    if (!authStore.hasPin()) return next();
    const key = `socket:${socket.handshake.address || 'unknown'}`;
    const limit = authRateLimiter.status(key);
    if (!limit.allowed) return next(new Error('PIN_RATE_LIMITED'));
    if (authStore.verifyPin(auth.pin)) {
      authRateLimiter.reset(key);
      return next();
    }
    authRateLimiter.recordFailure(key);
    const err = new Error('PIN_REQUIRED');
    next(err);
  });

  // ─── 連線狀態追蹤 ───
  const clients = {
    controllers: new Set(),
    displays: new Set(),
    remotes: new Set(),
    setlists: new Set(),
  };
  const displayBuildReports = new Map();
  const displayConnectedAt = new Map();
  const displayReportTimers = new Map();
  // Twitch 整合在 index.js 建立（需要這裡的 session/控制面板 bridge），建立後再注入。
  // 保持 Twitch service 不依賴 Socket.io 的細節，方便離線時完全不啟動它。
  let twitchService = null;
  let lastTwitchStreamEventId = null;

  function getClientCounts() {
    // /display 的指紋必須隨目前 public/ 內容重算；固定 server 啟動當下的值會讓
    // 已重整到新資產的 OBS 被誤判成舊快取。
    const expectedDisplayBuild = getDisplayBuild();
    const now = Date.now();
    let current = 0;
    let stale = 0;
    let pending = 0;
    let unreported = 0;
    for (const id of clients.displays) {
      const report = displayBuildReports.get(id);
      if (report) {
        if (report === expectedDisplayBuild) current++;
        else stale++;
      } else if (now - (displayConnectedAt.get(id) || now) < DISPLAY_BUILD_REPORT_GRACE_MS) {
        pending++;
      } else {
        // 舊版 display.js 尚不會回報 client:build；超過短暫連線等待後才視為需要刷新。
        unreported++;
      }
    }
    return {
      controllers: clients.controllers.size,
      displays: clients.displays.size,
      remotes: clients.remotes.size,
      setlists: clients.setlists.size,
      total: clients.controllers.size + clients.displays.size + clients.remotes.size + clients.setlists.size,
      displayRuntime: { expectedBuild: expectedDisplayBuild, current, stale, pending, unreported },
      runtimeEvidence: runtimeEvidence.getSnapshot(),
    };
  }

  function emitClientCounts() {
    io.emit('client:counts', getClientCounts());
  }

  function rememberDisplayConnection(socketId) {
    if (displayConnectedAt.has(socketId)) return;
    displayConnectedAt.set(socketId, Date.now());
    const timer = setTimeout(() => {
      displayReportTimers.delete(socketId);
      if (clients.displays.has(socketId) && !displayBuildReports.has(socketId)) emitClientCounts();
    }, DISPLAY_BUILD_REPORT_GRACE_MS);
    // 不讓單純的診斷等待計時器延後程式正常結束或自動更新重啟。
    if (typeof timer.unref === 'function') timer.unref();
    displayReportTimers.set(socketId, timer);
  }

  function forgetDisplayConnection(socketId) {
    displayBuildReports.delete(socketId);
    displayConnectedAt.delete(socketId);
    const timer = displayReportTimers.get(socketId);
    if (timer) clearTimeout(timer);
    displayReportTimers.delete(socketId);
  }

  function startTwitchSession({ startedAt, eventId } = {}) {
    // EventSub 會重送通知；相同 message id 只能重設歌單一次。
    if (eventId && eventId === lastTwitchStreamEventId) return;
    lastTwitchStreamEventId = eventId || null;
    ctx.session.active = true;
    ctx.session.startedAt = Number.isFinite(startedAt) ? startedAt : Date.now();
    ctx.session.source = 'twitch';
    ctx.session.songs = [];
    if (ctx.playState.isPlaying && ctx.playState.currentTrack) ctx.recordSessionSong();
    ctx.emitSetlist();
    ctx.broadcastState();
    ctx.persistState();
    log.info(`Twitch 開台事件：session 開始 (${new Date(ctx.session.startedAt).toISOString()})`);
  }

  function stopTwitchSession({ eventId } = {}) {
    if (eventId && eventId === lastTwitchStreamEventId) return;
    lastTwitchStreamEventId = eventId || null;
    // 使用者手動停止 session 後又收到延遲的 offline，維持原本狀態即可。
    if (!ctx.session.active || (ctx.session.source && ctx.session.source !== 'twitch')) return;
    ctx.session.active = false;
    ctx.session.source = null;
    ctx.emitSetlist();
    ctx.broadcastState();
    ctx.persistState();
    log.info('Twitch 下播事件：session 結束');
  }

  function dispatchTwitchSongRequest(request) {
    // 只交給桌面控制面板：那裡才有既有的 queueYouTubeImport()，可保證 yt-dlp 單工。
    for (const id of [...clients.controllers].reverse()) {
      const target = io.sockets.sockets.get(id);
      if (target && target.connected) {
        target.emit('twitch:song-request', request);
        return true;
      }
    }
    return false;
  }

  function syncTwitchRequests(socket) {
    if (socket && socket.clientType === 'controller' && twitchService) {
      socket.emit('twitch:requests', twitchService.getPendingRequests());
      socket.emit('twitch:history', twitchService.getRequestHistory(80));
      socket.emit('twitch:reply-settings:update', ctx.playState.twitchReplySettings);
      socket.emit('twitch:request-settings:update', ctx.playState.twitchRequestSettings);
      socket.emit('twitch:reward-settings:update', ctx.playState.twitchRewardSettings);
    }
  }

  function broadcastTwitchRequests() {
    if (!twitchService) return;
    const requests = twitchService.getPendingRequests();
    for (const id of clients.controllers) {
      const target = io.sockets.sockets.get(id);
      if (target && target.connected) target.emit('twitch:requests', requests);
    }
  }

  function broadcastTwitchHistory(entries = null) {
    if (!twitchService) return;
    const history = Array.isArray(entries) ? entries : twitchService.getRequestHistory(80);
    for (const id of clients.controllers) {
      const target = io.sockets.sockets.get(id);
      if (target && target.connected) target.emit('twitch:history', history);
    }
  }

  function dispatchTwitchAdminAction(action) {
    for (const id of [...clients.controllers].reverse()) {
      const target = io.sockets.sockets.get(id);
      if (target && target.connected) {
        target.emit('twitch:admin-action', action);
        return target.id;
      }
    }
    return null;
  }

  function persistTwitchRequestSettingsFromService(settings) {
    const validation = TwitchRequestSettings.validateSettings(settings);
    if (!validation.ok) return Promise.reject(new Error(validation.errors[0]?.message || 'Twitch 點歌設定格式無效'));
    ctx.playState.twitchRequestSettings = validation.settings;
    if (twitchService && typeof twitchService.setRequestSettings === 'function') twitchService.setRequestSettings(validation.settings);
    io.emit('twitch:request-settings:update', validation.settings);
    return new Promise((resolve, reject) => {
      ctx.persistState((result) => {
        if (result?.ok === false) reject(new Error(result.error || 'Twitch 點歌設定保存失敗'));
        else resolve(validation.settings);
      });
    });
  }

  function expireTwitchSongRequest(requestId) {
    for (const id of clients.controllers) {
      const target = io.sockets.sockets.get(id);
      if (target && target.connected) target.emit('twitch:song-request:expired', { requestId });
    }
  }

  function cancelTwitchSongRequest(requestId) {
    for (const id of clients.controllers) {
      const target = io.sockets.sockets.get(id);
      if (target && target.connected) target.emit('twitch:song-request:canceled', { requestId });
    }
  }

  io.on('connection', (socket) => {
    const counts = getClientCounts();
    log.info(`新連線: ${socket.id} (當前連線: ${counts.total})`);

    // 疊加層可匿名收資料，但永遠只讀。即使攻擊者冒充 display，也無法呼叫任何寫入事件。
    if (socket.readOnly && typeof socket.use === 'function') {
      socket.use(([event], next) => {
        if (READ_ONLY_EVENTS.has(event)) return next();
        log.warn(`拒絕唯讀客戶端事件: ${socket.clientType}/${event}`);
        next(new Error('READ_ONLY_CLIENT'));
      });
    }

    // ─── 客戶端類型識別（握手時已固定；此事件只保留相容性）──
    socket.on('client:type', (type) => {
      if (type !== socket.clientType) {
        log.warn(`拒絕連線後變更 clientType: ${socket.clientType} -> ${type}`);
        return;
      }
      // 預覽 iframe（display-preview / setlist-preview）刻意不加進任何計數集合：
      // 面板一開就內嵌 3 個歌詞預覽＋2 個歌單預覽，計進去的話連線燈永遠亮、數字永遠不準。
      if (type === 'controller') clients.controllers.add(socket.id);
      else if (type === 'display') {
        clients.displays.add(socket.id);
        rememberDisplayConnection(socket.id);
      }
      else if (type === 'remote') clients.remotes.add(socket.id);
      else if (type === 'setlist') clients.setlists.add(socket.id);
      runtimeEvidence.recordSocketConnected({ socketId: socket.id, clientType: type });

      // 顯示端發送完整恢復狀態（含歌詞），而非基本狀態；預覽 iframe 吃跟正式來源一樣的資料
      if (type === 'display' || type === 'display-preview') {
        socket.emit('state:recovery', ctx.getFullRecoveryState());
      } else if (type === 'setlist' || type === 'setlist-preview') {
        socket.emit('setlist:update', ctx.setlistPayload());
        // 歌單頁也需要 lyricSettings（簡轉繁等）：setlist:update 只有清單資料沒有這塊，
        // 過去只能等某個無關操作觸發 broadcastState() 才會補到，OBS 剛載入來源時吃不到設定。
        socket.emit('state:sync', ctx.getPublicState());
      } else {
        socket.emit('state:sync', ctx.getPublicState());
      }
      // 啟動時的 state.json 恢復發生在任何瀏覽器連線之前；延遲到第一個桌面面板完成
      // client:type 註冊後再提示，避免 io.emit 太早而靜默遺失。OBS 疊加層不顯示管理警告。
      if (type === 'controller') {
        const startupAlert = stateStore.consumeStartupAlert();
        if (startupAlert) socket.emit('server:alert', startupAlert);
      }
      syncTwitchRequests(socket);
      const c = getClientCounts();
      emitClientCounts();
      log.info(`${socket.id} 註冊為 ${type} (controllers: ${c.controllers}, displays: ${c.displays}, remotes: ${c.remotes}, setlists: ${c.setlists})`);
    });

    // 只有正式 OBS 歌詞來源納入診斷；面板內的 display-preview 不應讓連線燈或警告變化。
    socket.on('client:build', (data) => {
      if (socket.clientType !== 'display') return;
      const build = typeof data?.displayBuild === 'string' ? data.displayBuild.toLowerCase() : '';
      if (!/^[a-f0-9]{12,64}$/.test(build)) return;
      displayBuildReports.set(socket.id, build);
      const timer = displayReportTimers.get(socket.id);
      if (timer) clearTimeout(timer);
      displayReportTimers.delete(socket.id);
      emitClientCounts();
    });

    // ─── OBS 顯示頁面狀態恢復請求 ───
    socket.on('state:request', () => {
      log.info(`狀態恢復請求: ${socket.id}`);
      socket.emit('state:recovery', ctx.getFullRecoveryState());
    });

    // ─── 各領域事件：只有通過控制權限的 controller/remote 才掛寫入 handler ───
    if (!socket.readOnly) {
      registerPlaybackHandlers(io, socket, ctx);
      registerLyricsHandlers(io, socket, ctx);
      registerPlaylistHandlers(io, socket, ctx);
      registerLibraryHandlers(io, socket, ctx);
      registerSetlistHandlers(io, socket, ctx);
      registerTwitchHandlers(io, socket, ctx, { getTwitchService: () => twitchService });
    } else if (socket.clientType === 'setlist' || socket.clientType === 'setlist-preview') {
      socket.on('setlist:get', (_data, ack) => {
        const data = ctx.setlistPayload();
        if (typeof ack === 'function') ack(data);
        else socket.emit('setlist:update', data);
      });
    }

    // ─── 斷線處理 ───
    socket.on('disconnect', (reason) => {
      runtimeEvidence.recordSocketDisconnected({ socketId: socket.id });
      clients.controllers.delete(socket.id);
      clients.displays.delete(socket.id);
      clients.remotes.delete(socket.id);
      clients.setlists.delete(socket.id);
      forgetDisplayConnection(socket.id);
      const c = getClientCounts();
      emitClientCounts();
      log.info(`斷線: ${socket.id} (${socket.clientType || 'unknown'}, 原因: ${reason}) (剩餘連線: ${c.total})`);
    });
  });

  return {
    command: createDeckCommands(io, ctx),
    getState: ctx.getPublicState,
    startTwitchSession,
    stopTwitchSession,
    dispatchTwitchSongRequest,
    dispatchTwitchAdminAction,
    expireTwitchSongRequest,
    cancelTwitchSongRequest,
    broadcastTwitchRequests,
    broadcastTwitchHistory,
    persistTwitchRequestSettingsFromService,
    setTwitchService(service) {
      twitchService = service;
      if (service && typeof service.setReplySettings === 'function') service.setReplySettings(ctx.playState.twitchReplySettings);
      if (service && typeof service.setRequestSettings === 'function') service.setRequestSettings(ctx.playState.twitchRequestSettings);
      if (service && typeof service.setRewardSettings === 'function') service.setRewardSettings(ctx.playState.twitchRewardSettings);
      if (service && typeof service.status === 'function') runtimeEvidence.recordTwitchStatus(service.status());
    },
    recordTwitchStatus(status) {
      runtimeEvidence.recordTwitchStatus(status);
      emitClientCounts();
    },
  };
};
