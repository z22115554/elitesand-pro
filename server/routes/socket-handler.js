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
const { createDeckCommands } = require('./deck-commands');
const registerPlaybackHandlers = require('./handlers/playback');
const registerLyricsHandlers = require('./handlers/lyrics');
const registerPlaylistHandlers = require('./handlers/playlist');
const registerLibraryHandlers = require('./handlers/library');
const registerSetlistHandlers = require('./handlers/setlist');
const authStore = require('../services/auth-store');
const authRateLimiter = require('../services/auth-rate-limiter');

const log = createLogger('Socket');

// OBS 疊加層一律豁免 PIN：那是唯讀畫面，斷線＝畫面直接消失在直播上，
// 風險比「同網路的人連上控制」還大，不能因為 PIN 錯誤就把它擋在外面。
// display-preview / setlist-preview = 控制面板內嵌的預覽 iframe（?preview=1）：
// 資料照餵、豁免 PIN（iframe 拿不到面板的 PIN），但不計入「OBS 已連線」數。
const PIN_EXEMPT_CLIENT_TYPES = new Set(['display', 'setlist', 'display-preview', 'setlist-preview']);
const CLIENT_TYPES = new Set(['controller', 'remote', ...PIN_EXEMPT_CLIENT_TYPES]);
const READ_ONLY_EVENTS = new Set(['client:type', 'state:request', 'setlist:get']);

module.exports = function socketHandler(io) {
  // ─── 全域狀態（單一事實來源，含 state.json 還原）───
  const ctx = createAppState(io);

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
  // Twitch 整合在 index.js 建立（需要這裡的 session/控制面板 bridge），建立後再注入。
  // 保持 Twitch service 不依賴 Socket.io 的細節，方便離線時完全不啟動它。
  let twitchService = null;
  let lastTwitchStreamEventId = null;

  function getClientCounts() {
    return {
      controllers: clients.controllers.size,
      displays: clients.displays.size,
      remotes: clients.remotes.size,
      setlists: clients.setlists.size,
      total: clients.controllers.size + clients.displays.size + clients.remotes.size + clients.setlists.size,
    };
  }

  function emitClientCounts() {
    io.emit('client:counts', getClientCounts());
  }

  function startTwitchSession({ startedAt, eventId } = {}) {
    // EventSub 會重送通知；相同 message id 只能重設歌單一次。
    if (eventId && eventId === lastTwitchStreamEventId) return;
    lastTwitchStreamEventId = eventId || null;
    ctx.session.active = true;
    ctx.session.startedAt = Number.isFinite(startedAt) ? startedAt : Date.now();
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
    if (!ctx.session.active) return;
    ctx.session.active = false;
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
    }
  }

  function expireTwitchSongRequest(requestId) {
    for (const id of clients.controllers) {
      const target = io.sockets.sockets.get(id);
      if (target && target.connected) target.emit('twitch:song-request:expired', { requestId });
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
      else if (type === 'display') clients.displays.add(socket.id);
      else if (type === 'remote') clients.remotes.add(socket.id);
      else if (type === 'setlist') clients.setlists.add(socket.id);

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
      syncTwitchRequests(socket);
      const c = getClientCounts();
      emitClientCounts();
      log.info(`${socket.id} 註冊為 ${type} (controllers: ${c.controllers}, displays: ${c.displays}, remotes: ${c.remotes}, setlists: ${c.setlists})`);
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
      // 實際下載結果只能從桌面控制面板接受，避免手機遙控器或其他控制端重複回覆 Twitch。
      socket.on('twitch:song-request:result', async (result, ack) => {
        if (socket.clientType !== 'controller' || !twitchService) {
          if (typeof ack === 'function') ack({ ok: false, error: '目前無法處理 Twitch 點歌結果' });
          return;
        }
        try {
          await twitchService.completeSongRequest(result);
          if (typeof ack === 'function') ack({ ok: true });
        } catch (err) {
          log.error(`回報 Twitch 點歌結果失敗: ${err.message}`);
          if (typeof ack === 'function') ack({ ok: false, error: '無法回覆 Twitch 聊天室，請稍後重試' });
        }
      });
    } else if (socket.clientType === 'setlist' || socket.clientType === 'setlist-preview') {
      socket.on('setlist:get', (_data, ack) => {
        const data = ctx.setlistPayload();
        if (typeof ack === 'function') ack(data);
        else socket.emit('setlist:update', data);
      });
    }

    // ─── 斷線處理 ───
    socket.on('disconnect', (reason) => {
      clients.controllers.delete(socket.id);
      clients.displays.delete(socket.id);
      clients.remotes.delete(socket.id);
      clients.setlists.delete(socket.id);
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
    expireTwitchSongRequest,
    setTwitchService(service) { twitchService = service; },
  };
};
