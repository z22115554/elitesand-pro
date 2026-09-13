'use strict';

/**
 * 公開點歌頁中繼客戶端。
 *
 * 本機 Elitesand Pro 只建立「向外」的 WebSocket 連線到 Cloudflare Worker + Durable Object
 * （docs/PUBLIC-SONG-REQUEST-PLAN.md）；本機從不開放任何入站 port 給公開觀眾。連線後：
 * - 推送目前公開的歌單快照（只含 id/title/artist/duration，不含檔名、路徑或 YouTube 網址）。
 * - 接收觀眾送出的點歌請求，放進本機 pendingRequests，交給控制面板人工核准。
 * - 核准／拒絕都只是本機決定；不會把結果回報給觀眾（比照 Twitch 聊天室單向確認模型，
 *   觀眾頁面只會看到「已送出，等待主播確認」）。
 *
 * 未啟用（config.songRequestRelayEnabled === false 或面板沒開啟）時完全零外連，
 * 比照 twitch-service.js「未填 clientId 時閒置」的既有精神。
 */
const crypto = require('crypto');
const fetch = require('node-fetch');
const QRCode = require('qrcode');
const { createLogger } = require('../utils/logger');
const defaultStore = require('./song-request-relay-store');
const defaultSavedPlaylists = require('./saved-playlists');
const defaultLibraryStore = require('./library-store');

const log = createLogger('SongRequestRelay');

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;
const CONNECT_WATCHDOG_MS = 15000;
const MAX_PENDING_REQUESTS = 20;
const MAX_CATALOG_TRACKS = 2000; // 對齊 MAX_PLAYLIST_SIZE / saved-playlists 的既有上限
const CATALOG_PUSH_DEBOUNCE_MS = 2000;
const ALL_CATALOG_PLAYLIST_ID = '__all-library__';

function reconnectDelay(attempt, random = Math.random) {
  // 跟 twitch-service.js 的 reconnectDelay() 同一條公式：指數退避＋±20% 抖動。
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  return Math.round(base * (0.8 + random() * 0.4));
}

function websocketCtor() {
  // 跟 twitch-service.js 同一套退路：Node 22+ 原生 WebSocket，較舊版本用 socket.io
  // 已安裝的 ws 相依套件；不對外開放，也不會把 ws 暴露給瀏覽器。
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  // eslint-disable-next-line global-require
  return require('ws');
}

function wsUrlFromHttp(httpUrl) {
  return String(httpUrl || '').replace(/^http/i, 'ws').replace(/\/+$/, '');
}

function relayEnabledByConfig(config) {
  return config?.songRequestRelayEnabled === true
    && typeof config?.songRequestRelayUrl === 'string'
    && /^https:\/\//i.test(config.songRequestRelayUrl);
}

function relayConfigError(config) {
  if (!config || typeof config.songRequestRelayUrl !== 'string' || !/^https:\/\//i.test(config.songRequestRelayUrl)) {
    return '公開點歌頁尚未設定中繼網址（server/config.js 的 songRequestRelayUrl）';
  }
  if (config.songRequestRelayEnabled !== true) {
    return '公開點歌頁已在 server/config.js 中停用（songRequestRelayEnabled）';
  }
  return '';
}

function sanitizeCatalogTrack(entry) {
  return {
    id: String(entry.id),
    title: String(entry.title || '').slice(0, 200),
    artist: String(entry.artist || '').slice(0, 200),
    duration: Number.isFinite(entry.duration) ? Math.max(0, Math.round(entry.duration)) : 0,
  };
}

function newRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

class SongRequestRelayService {
  constructor({
    config,
    store = defaultStore,
    savedPlaylists = defaultSavedPlaylists,
    libraryStore = defaultLibraryStore,
    buildTrackFromEntry,
    fetchImpl = fetch,
    onSongRequest = () => {},
    onStatusChange = () => {},
    onPendingRequestsChanged = () => {},
    timers = globalThis,
    random = Math.random,
    createWebSocket = websocketCtor,
  } = {}) {
    this.config = config;
    this.store = store;
    this.savedPlaylists = savedPlaylists;
    this.libraryStore = libraryStore;
    this.buildTrackFromEntry = buildTrackFromEntry;
    this.fetchImpl = fetchImpl;
    this.onSongRequest = onSongRequest;
    this.onStatusChange = onStatusChange;
    this.onPendingRequestsChanged = onPendingRequestsChanged;
    this.timers = timers;
    this.random = random;
    this.createWebSocket = createWebSocket;

    this.state = store.load();
    this.pendingRequests = [];
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempt = 0;
    this.reconnectSuppressed = false;
    this.reconnectTimer = null;
    this.connectWatchdog = null;
    this.catalogPushTimer = null;
    this.started = false;
    this.stopped = true;
    this._qrDataUrl = '';
    this._qrForSlug = '';
  }

  // ─── 生命週期 ───

  start() {
    this.started = true;
    this.stopped = false;
    this.reconnectSuppressed = false;
    // 公開點歌是直播主每次開台前的明確選擇，不把上次的啟用狀態帶進新程序。
    // 分享網址、密鑰與公開歌單仍保留，直播主只需要手動重新打開開關即可。
    if (this.state.enabled) {
      this.state.enabled = false;
      this._persist();
    }
    this._emitStatus();
  }

  stop() {
    this.stopped = true;
    this.started = false;
    this._clearReconnectTimer();
    this._clearConnectWatchdog();
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* best effort */ }
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
    this._emitStatus();
  }

  // ─── 面板操作 ───

  async enable() {
    if (!relayEnabledByConfig(this.config)) {
      return { ok: false, error: relayConfigError(this.config) };
    }
    if (!this.state.publicSlug || !this.state.secret) {
      const registered = await this._register();
      if (!registered.ok) return registered;
    }
    this.state.enabled = true;
    this.reconnectSuppressed = false;
    this._persist();
    this._connect();
    await this._refreshQr();
    return { ok: true, ...this.getStatus() };
  }

  disable() {
    this.state.enabled = false;
    this.reconnectSuppressed = false;
    this._persist();
    this._clearReconnectTimer();
    this._clearConnectWatchdog();
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* best effort */ }
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
    this._emitStatus();
    return { ok: true, ...this.getStatus() };
  }

  async rotateLink() {
    if (!relayEnabledByConfig(this.config)) {
      return { ok: false, error: relayConfigError(this.config) };
    }
    const wasEnabled = this.state.enabled;
    this.reconnectSuppressed = false;
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* best effort */ }
      this.ws = null;
    }
    this.connected = false;
    this._clearReconnectTimer();
    const registered = await this._register();
    if (!registered.ok) return registered;
    this.state.enabled = wasEnabled;
    this._persist();
    if (wasEnabled) this._connect();
    await this._refreshQr();
    return { ok: true, ...this.getStatus() };
  }

  /** slug 變動時（enable/rotateLink 之後）重算 QR；沿用既有 qrcode 依賴，跟 device-access.js 同一套。 */
  async _refreshQr() {
    const status = this.getStatus();
    if (!status.shareUrl) { this._qrDataUrl = ''; this._qrForSlug = ''; return; }
    if (this._qrForSlug === status.shareUrl && this._qrDataUrl) return;
    try {
      this._qrDataUrl = await QRCode.toDataURL(status.shareUrl, { margin: 1, width: 240 });
      this._qrForSlug = status.shareUrl;
      this._emitStatus();
    } catch (err) {
      log.warn(`公開點歌頁 QR Code 產生失敗：${err.message}`);
    }
  }

  setCatalogPlaylistId(playlistId) {
    const id = String(playlistId || '');
    if (id && id !== ALL_CATALOG_PLAYLIST_ID && !this.savedPlaylists.get(id)) {
      return { ok: false, error: '找不到這份歌單' };
    }
    this.state.publishedPlaylistId = id;
    this._persist();
    this._scheduleCatalogPush();
    this._emitStatus();
    return { ok: true, ...this.getStatus() };
  }

  /** 歌單／媒體庫內容變動時呼叫，debounce 後重推快照。 */
  notifyCatalogMayHaveChanged() {
    if (this.state.publishedPlaylistId) this._scheduleCatalogPush();
  }

  getStatus() {
    const base = this.config?.songRequestRelayUrl ? String(this.config.songRequestRelayUrl).replace(/\/+$/, '') : '';
    return {
      configured: relayEnabledByConfig(this.config),
      enabled: this.state.enabled,
      connected: this.connected,
      connecting: this.connecting,
      reconnectSuppressed: this.reconnectSuppressed,
      publicSlug: this.state.publicSlug,
      shareUrl: this.state.publicSlug && base ? `${base}/r/${this.state.publicSlug}` : '',
      publishedPlaylistId: this.state.publishedPlaylistId,
      qrDataUrl: this._qrDataUrl || '',
    };
  }

  getPendingRequests() {
    return this.pendingRequests.map((item) => ({ ...item }));
  }

  /**
   * 核准一筆待處理請求：只負責把它從佇列移除、解析回本機媒體庫的完整 track；
   * 真正寫入 playState.playlist 的動作留給呼叫端（public-request.js），用既有的
   * playlist:add／playlist:insert-next 語義（見 handlers/playlist.js 的
   * insertTracksIntoPlaylist），這裡不建立第二條播放清單寫入路徑。
   */
  approve(requestId) {
    const index = this.pendingRequests.findIndex((item) => item.requestId === requestId);
    if (index === -1) return { ok: false, error: '這筆點歌請求已不存在（可能已逾時或被處理過）' };
    const request = this.pendingRequests[index];
    const entry = this.libraryStore.getEntry(request.catalogTrackId);
    if (!entry) return { ok: false, error: '這首歌已不在媒體庫裡，無法加入播放清單' };
    const track = this.buildTrackFromEntry(entry);
    this.pendingRequests.splice(index, 1);
    this.onPendingRequestsChanged();
    return { ok: true, track, request };
  }

  /** 播放清單容量或其他最後一步驗證失敗時，把核准中的請求安全放回佇列。 */
  restorePendingRequest(request) {
    if (!request || typeof request.requestId !== 'string' || !request.requestId) return false;
    if (this.pendingRequests.some((item) => item.requestId === request.requestId)) return true;
    if (this.pendingRequests.length >= MAX_PENDING_REQUESTS) return false;
    this.pendingRequests.push({ ...request });
    this.onPendingRequestsChanged();
    return true;
  }

  reject(requestId) {
    const index = this.pendingRequests.findIndex((item) => item.requestId === requestId);
    if (index === -1) return { ok: false, error: '這筆點歌請求已不存在' };
    this.pendingRequests.splice(index, 1);
    this.onPendingRequestsChanged();
    return { ok: true };
  }

  // ─── 內部：註冊 ───

  async _register() {
    try {
      const response = await this.fetchImpl(`${String(this.config.songRequestRelayUrl).replace(/\/+$/, '')}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) return { ok: false, error: `中繼註冊失敗（HTTP ${response.status}）` };
      const data = await response.json();
      if (!data || typeof data.publicSlug !== 'string' || typeof data.secret !== 'string' || !data.publicSlug || !data.secret) {
        return { ok: false, error: '中繼回應格式無效' };
      }
      this.state.publicSlug = data.publicSlug;
      this.state.secret = data.secret;
      this._persist();
      return { ok: true };
    } catch (err) {
      log.warn(`公開點歌頁註冊失敗：${err.message}`);
      return { ok: false, error: '無法連線到公開點歌頁中繼服務' };
    }
  }

  _persist() {
    try { this.store.save(this.state); } catch (err) { log.warn(`公開點歌頁設定寫入失敗：${err.message}`); }
  }

  // ─── 內部：連線 ───

  _connect() {
    if (this.stopped || !this.state.enabled || !relayEnabledByConfig(this.config)) return;
    if (!this.state.publicSlug || !this.state.secret) return;
    if (this.connecting || this.connected) return;
    this.connecting = true;
    this._emitStatus();

    let socket;
    try {
      const WebSocketCtor = this.createWebSocket();
      const url = `${wsUrlFromHttp(this.config.songRequestRelayUrl)}/api/relay/${this.state.publicSlug}?secret=${encodeURIComponent(this.state.secret)}`;
      socket = new WebSocketCtor(url);
    } catch (err) {
      log.warn(`公開點歌頁連線建立失敗：${err.message}`);
      this.connecting = false;
      this._scheduleReconnect();
      return;
    }
    this.ws = socket;

    this.connectWatchdog = this.timers.setTimeout(() => {
      log.warn('公開點歌頁連線逾時，改用退避重試');
      this._teardownSocket();
      this._scheduleReconnect();
    }, CONNECT_WATCHDOG_MS);
    if (typeof this.connectWatchdog.unref === 'function') this.connectWatchdog.unref();

    socket.onopen = () => {
      this._clearConnectWatchdog();
      this.connecting = false;
      this.connected = true;
      this.reconnectAttempt = 0;
      this._emitStatus();
      this._pushCatalogNow();
      log.info(`公開點歌頁中繼已連線（${this.state.publicSlug}）`);
    };

    socket.onmessage = (event) => {
      let payload;
      try { payload = JSON.parse(String(event?.data ?? '')); } catch (_) { return; }
      this._handleMessage(payload);
    };

    socket.onerror = () => { /* onclose 會接著觸發，統一在那裡處理重連 */ };

    socket.onclose = (event) => {
      this._clearConnectWatchdog();
      const wasConnected = this.connected;
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      this._emitStatus();
      const code = Number.isFinite(event?.code) ? event.code : 0;
      const reason = String(event?.reason || '').replace(/[\r\n]/g, ' ').slice(0, 120);
      if (wasConnected) log.info(`公開點歌頁中繼連線已中斷（${code}${reason ? `，${reason}` : ''}）`);
      if (code === 4001 || reason === 'replaced by new connection') {
        // 同一房間只允許一個桌面端；另一個程序接手時停止互踢重連，
        // 直到直播主手動重新開啟此程序的公開點歌開關。
        this.reconnectSuppressed = true;
        log.warn('公開點歌頁中繼已被另一個桌面端接手，停止自動重連');
        this._emitStatus();
        return;
      }
      this._scheduleReconnect();
    };
  }

  _teardownSocket() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* best effort */ }
      this.ws = null;
    }
    this.connecting = false;
    this.connected = false;
  }

  _scheduleReconnect() {
    if (this.stopped || !this.state.enabled || this.reconnectSuppressed) return;
    this._clearReconnectTimer();
    this.reconnectAttempt += 1;
    const delay = reconnectDelay(this.reconnectAttempt, this.random);
    this.reconnectTimer = this.timers.setTimeout(() => { this.reconnectTimer = null; this._connect(); }, delay);
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) { this.timers.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  _clearConnectWatchdog() {
    if (this.connectWatchdog) { this.timers.clearTimeout(this.connectWatchdog); this.connectWatchdog = null; }
  }

  _emitStatus() {
    try { this.onStatusChange(this.getStatus()); } catch (err) { log.warn(`狀態回報失敗：${err.message}`); }
  }

  // ─── 內部：訊息處理 ───

  _handleMessage(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'song-request') this._acceptIncomingRequest(payload.request);
  }

  _acceptIncomingRequest(raw) {
    const catalogTrackId = typeof raw?.catalogTrackId === 'string' ? raw.catalogTrackId.slice(0, 128) : '';
    if (!catalogTrackId) return;
    if (this.pendingRequests.length >= MAX_PENDING_REQUESTS) {
      log.warn('公開點歌頁待處理請求已達上限，忽略新請求');
      return;
    }
    const entry = this.libraryStore.getEntry(catalogTrackId);
    const request = {
      requestId: newRequestId(),
      catalogTrackId,
      title: entry?.title || String(raw?.title || '').slice(0, 200) || '（未知曲目）',
      artist: entry?.artist || String(raw?.artist || '').slice(0, 200) || '',
      displayName: String(raw?.displayName || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60),
      note: String(raw?.note || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140),
      createdAt: Date.now(),
    };
    this.pendingRequests.push(request);
    this.onPendingRequestsChanged();
    this.onSongRequest(request);
  }

  // ─── 內部：歌單快照 ───

  _buildCatalog() {
    const allLibrary = this.state.publishedPlaylistId === ALL_CATALOG_PLAYLIST_ID;
    const playlist = !allLibrary && this.state.publishedPlaylistId
      ? this.savedPlaylists.get(this.state.publishedPlaylistId)
      : null;
    const source = allLibrary
      ? (typeof this.libraryStore.getLibrary === 'function' ? this.libraryStore.getLibrary() : [])
      : (playlist ? playlist.trackIds : []);
    if (!Array.isArray(source)) return [];
    const exists = this.libraryStore.getAudioExistsLookup ? this.libraryStore.getAudioExistsLookup() : () => true;
    const tracks = [];
    for (const item of source) {
      if (tracks.length >= MAX_CATALOG_TRACKS) break;
      const entry = allLibrary ? item : this.libraryStore.getEntry(item);
      if (!entry) continue;
      // 只公開音檔還在本機、真的能立即排進佇列的歌，避免觀眾點到還要重新下載的項目。
      if (!entry.filename || !exists(entry.filename)) continue;
      tracks.push(sanitizeCatalogTrack(entry));
    }
    return tracks;
  }

  _scheduleCatalogPush() {
    if (this.catalogPushTimer) return;
    this.catalogPushTimer = this.timers.setTimeout(() => {
      this.catalogPushTimer = null;
      this._pushCatalogNow();
    }, CATALOG_PUSH_DEBOUNCE_MS);
    if (typeof this.catalogPushTimer.unref === 'function') this.catalogPushTimer.unref();
  }

  _pushCatalogNow() {
    if (!this.connected || !this.ws) return;
    const tracks = this._buildCatalog();
    try {
      this.ws.send(JSON.stringify({ type: 'catalog', tracks, updatedAt: Date.now() }));
    } catch (err) {
      log.warn(`歌單快照推送失敗：${err.message}`);
    }
  }
}

module.exports = {
  SongRequestRelayService,
  reconnectDelay,
  websocketCtor,
  relayEnabledByConfig,
  ALL_CATALOG_PLAYLIST_ID,
};
