/**
 * Twitch Device Code Flow + EventSub WebSocket。
 *
 * 此整合以「本機安裝的聊天工具」為模型：授權的是直播主本人，EventSub 走 WebSocket，
 * 因此不需要公開 HTTPS webhook，也不需要 Client Secret。Twitch 對公開用戶端只允許
 * Device Code Flow；聊天室點歌只接受 YouTube URL，
 * 並轉交控制面板的既有單一下載佇列；面板回報真正成功後才送出 Twitch 成功訊息。
 */
const crypto = require('crypto');
const { parseYouTubeUrl } = require('../utils/youtube-url');
const AudioProcessor = require('./audio-processor');
const MAX_PENDING_REQUESTS = 20;
const fetch = require('node-fetch');
const store = require('./twitch-store');
const requestStore = require('./twitch-request-store');
const { createLogger } = require('../utils/logger');

const log = createLogger('Twitch');
const OAUTH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const OAUTH_DEVICE = 'https://id.twitch.tv/oauth2/device';
const OAUTH_VALIDATE = 'https://id.twitch.tv/oauth2/validate';
const OAUTH_REVOKE = 'https://id.twitch.tv/oauth2/revoke';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
const REQUEST_TTL_MS = 30 * 60 * 1000;
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;

function reconnectDelay(attempt, random = Math.random) {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  return Math.round(base * (0.8 + random() * 0.4));
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function toTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function websocketCtor() {
  // Node 22+ 原生支援 WebSocket；Node 18/20 則使用 Socket.io 已安裝的 ws 相依套件退路。
  // 這裡不需要把 ws 暴露給瀏覽器，也不會開放外部 socket 入口。
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  // eslint-disable-next-line global-require
  return require('ws');
}

class TwitchService {
  constructor({ config, onStreamOnline, onStreamOffline, onSongRequest, onSongRequestExpired, onStatusChange, pendingStore = requestStore, authStore = store }) {
    this.config = config;
    this.onStreamOnline = onStreamOnline;
    this.onStreamOffline = onStreamOffline;
    this.onSongRequest = onSongRequest;
    this.onSongRequestExpired = onSongRequestExpired;
    this.onStatusChange = typeof onStatusChange === 'function' ? onStatusChange : null;
    this.deviceAuthorization = null;
    this.authStore = authStore;
    this.auth = this.authStore.load();
    this.ws = null;
    this.wsSessionId = null;
    this.pendingStore = pendingStore;
    this.pendingRequests = new Map();
    this.requestExpiryTimers = new Map();
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.nextRetryAt = 0;
    this.connectionState = 'idle';
    this.subscriptionState = 'idle';
    this.lastConnectionError = '';
    this.lastConnectedAt = 0;
    this.lastDisconnectedAt = 0;
    this.closed = false;
    this.restorePendingRequests();
  }

  configured() {
    return !!this.config.twitchClientId;
  }

  status() {
    return {
      configured: this.configured(),
      connected: !!this.wsSessionId,
      authorized: !!(this.auth && this.auth.accessToken && this.auth.userId),
      broadcasterLogin: this.auth && this.auth.userLogin ? this.auth.userLogin : null,
      command: this.config.twitchRequestCommand || '!點歌',
      deviceAuthorization: this.deviceAuthorization ? {
        userCode: this.deviceAuthorization.userCode,
        verificationUri: this.deviceAuthorization.verificationUri,
      } : null,
      connectionState: this.connectionState,
      subscriptionState: this.subscriptionState,
      reconnectAttempt: this.reconnectAttempt,
      nextRetryAt: this.nextRetryAt,
      lastConnectionError: this.lastConnectionError,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      pendingRequestCount: this.getPendingRequests().length,
    };
  }

  serializePendingRequest(request) {
    return {
      requestId: String(request.requestId || ''),
      url: String(request.url || ''),
      requester: String(request.requester || '觀眾'),
      title: String(request.title || ''),
      author: String(request.author || ''),
      thumbnail: String(request.thumbnail || ''),
      metadataAvailable: !!request.metadataAvailable,
      videoId: String(request.videoId || ''),
      duration: Number(request.duration) || 0,
      durationWarning: !!request.durationWarning,
      assessment: request.assessment && typeof request.assessment === 'object' ? {
        warning: !!request.assessment.warning,
        warningTypes: Array.isArray(request.assessment.warningTypes) ? request.assessment.warningTypes.map(String).slice(0, 3) : [],
        warnings: Array.isArray(request.assessment.warnings) ? request.assessment.warnings.map(value => String(value).slice(0, 300)).slice(0, 3) : [],
        duration: Number(request.assessment.duration) || 0,
        title: String(request.assessment.title || '').slice(0, 300),
        author: String(request.assessment.author || '').slice(0, 200),
        thumbnail: String(request.assessment.thumbnail || '').slice(0, 500),
        categories: Array.isArray(request.assessment.categories) ? request.assessment.categories.map(value => String(value).slice(0, 100)).slice(0, 5) : [],
      } : null,
      createdAt: Number(request.createdAt) || Date.now(),
      expiresAt: Number(request.expiresAt) || Date.now() + REQUEST_TTL_MS,
      event: {
        chatter_user_name: String(request.event?.chatter_user_name || ''),
        chatter_user_login: String(request.event?.chatter_user_login || ''),
      },
    };
  }

  persistPendingRequests() {
    try {
      this.pendingStore.save([...this.pendingRequests.values()].map(request => this.serializePendingRequest(request)));
    } catch (err) {
      log.warn(`Twitch 待確認點歌保存失敗：${err.message}`);
    }
  }

  restorePendingRequests() {
    let restored = [];
    try { restored = this.pendingStore.load() || []; } catch (err) {
      log.warn(`Twitch 待確認點歌還原失敗：${err.message}`);
    }
    const now = Date.now();
    for (const raw of restored) {
      const request = this.serializePendingRequest(raw || {});
      if (!request.requestId || !request.videoId || request.expiresAt <= now) continue;
      this.pendingRequests.set(request.requestId, request);
      this.scheduleRequestExpiry(request.requestId);
    }
    this.persistPendingRequests();
    if (this.pendingRequests.size) log.info(`已還原 ${this.pendingRequests.size} 筆 Twitch 待確認點歌`);
  }

  async beginAuthorization() {
    if (!this.configured()) throw new Error('尚未設定 Twitch Client ID');
    if (this.deviceAuthorization) return this.publicDeviceAuthorization();
    const body = new URLSearchParams({
      client_id: this.config.twitchClientId,
      scopes: 'user:read:chat user:write:chat',
    });
    const response = await fetch(OAUTH_DEVICE, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const data = await response.json();
    if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
      throw new Error(`無法開始 Twitch 授權：${data.message || response.status}`);
    }
    this.deviceAuthorization = {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
      intervalMs: Math.max(5, Number(data.interval || 5)) * 1000,
    };
    this.pollDeviceAuthorization();
    return this.publicDeviceAuthorization();
  }

  publicDeviceAuthorization() {
    if (!this.deviceAuthorization) return null;
    return {
      userCode: this.deviceAuthorization.userCode,
      verificationUri: this.deviceAuthorization.verificationUri,
    };
  }

  async pollDeviceAuthorization() {
    const pending = this.deviceAuthorization;
    if (!pending || this.closed) return;
    if (Date.now() >= pending.expiresAt) {
      this.deviceAuthorization = null;
      log.warn('Twitch Device Code 已過期，請從面板重新開始授權');
      return;
    }
    const body = new URLSearchParams({
      client_id: this.config.twitchClientId,
      scope: 'user:read:chat user:write:chat',
      device_code: pending.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    try {
      const response = await fetch(OAUTH_TOKEN, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      const data = await response.json();
      if (response.ok && data.access_token) {
        this.deviceAuthorization = null;
        await this.saveValidatedToken(data);
        this.connectEventSub();
        return;
      }
      if (data.message === 'slow_down') pending.intervalMs += 5000;
      if (!['authorization_pending', 'slow_down'].includes(data.message)) {
        this.deviceAuthorization = null;
        log.warn(`Twitch Device Code 授權失敗：${data.message || response.status}`);
        return;
      }
    } catch (err) {
      log.warn(`Twitch Device Code 輪詢失敗：${err.message}`);
    }
    setTimeout(() => this.pollDeviceAuthorization(), pending.intervalMs);
  }

  async refreshToken() {
    if (!this.auth || !this.auth.refreshToken) throw new Error('沒有可更新的 Twitch 授權，請重新連線');
    const body = new URLSearchParams({
      client_id: this.config.twitchClientId,
      grant_type: 'refresh_token',
      refresh_token: this.auth.refreshToken,
    });
    const response = await fetch(OAUTH_TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new Error(`Twitch 授權更新失敗：${data.message || response.status}`);
    await this.saveValidatedToken(data);
  }

  async saveValidatedToken(token) {
    const response = await fetch(OAUTH_VALIDATE, { headers: { Authorization: `OAuth ${token.access_token}` } });
    const user = await response.json();
    if (!response.ok || !user.user_id) throw new Error('Twitch 授權驗證失敗');
    this.auth = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 0) * 1000,
      scopes: Array.isArray(token.scope) ? token.scope : [],
      userId: user.user_id,
      userLogin: user.login || '',
    };
    this.authStore.save(this.auth);
    log.info(`Twitch 已授權頻道：${this.auth.userLogin || this.auth.userId}`);
  }

  async ensureToken() {
    if (!this.configured() || !this.auth) return false;
    // 預留 2 分鐘，避免訂閱/回覆聊天時剛好過期。
    if (!this.auth.expiresAt || this.auth.expiresAt - Date.now() < 2 * 60 * 1000) {
      try { await this.refreshToken(); } catch (err) {
        log.warn(err.message);
        return false;
      }
    }
    return true;
  }

  disconnectEventSub() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.wsSessionId = null;
    this.reconnectAttempt = 0;
    this.nextRetryAt = 0;
    this.subscriptionState = 'idle';
    this.lastConnectionError = '';
    this.connectionState = this.configured() ? 'authorization_required' : 'disabled';
    this.notifyStatusChange();
    if (ws && typeof ws.close === 'function') ws.close();
  }

  notifyStatusChange() {
    if (!this.onStatusChange) return;
    try { this.onStatusChange(this.status()); } catch (err) { log.warn(`Twitch 狀態觀測回報失敗：${err.message}`); }
  }

  async revokeAccessToken(auth) {
    if (!auth?.accessToken || !this.configured()) return { attempted: false, revoked: false, alreadyInvalid: false };
    const body = new URLSearchParams({ client_id: this.config.twitchClientId, token: auth.accessToken });
    const response = await fetch(OAUTH_REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      timeout: 5000,
    });
    if (response.ok) return { attempted: true, revoked: true, alreadyInvalid: false };
    if (response.status === 400) return { attempted: true, revoked: false, alreadyInvalid: true };
    throw new Error(`Twitch 解除遠端授權失敗（${response.status}）`);
  }

  async deauthorize({ revoke = (auth) => this.revokeAccessToken(auth) } = {}) {
    const previousAuth = this.auth;
    if (!this.authStore.clear()) {
      throw new Error('無法清除本機 Twitch 授權資料；請確認資料夾權限後再試一次。');
    }
    this.deviceAuthorization = null;
    this.disconnectEventSub();
    this.auth = null;
    this.notifyStatusChange();

    let remote = { attempted: false, revoked: false, alreadyInvalid: false };
    let remoteError = '';
    try {
      remote = await revoke(previousAuth);
    } catch (err) {
      remoteError = String(err?.message || '無法連線 Twitch 取消遠端授權');
      log.warn(`本機 Twitch 授權已清除，但遠端撤銷失敗：${remoteError}`);
    }

    return {
      localCleared: true,
      remoteRevoked: !!remote?.revoked,
      remoteAlreadyInvalid: !!remote?.alreadyInvalid,
      remoteError,
      pendingRequestsPreserved: this.pendingRequests.size,
    };
  }

  start() {
    if (!this.configured() || !this.auth) {
      this.connectionState = this.configured() ? 'authorization_required' : 'disabled';
      this.notifyStatusChange();
      return;
    }
    this.connectionState = 'connecting';
    this.notifyStatusChange();
    this.ensureToken().then((ready) => {
      if (ready) this.connectEventSub();
      else this.scheduleReconnect('Twitch 授權暫時無法更新');
    }).catch((err) => this.scheduleReconnect(err.message));
  }

  connectEventSub(url = EVENTSUB_WS) {
    if (this.closed || !this.auth || this.ws) return;
    this.connectionState = this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
    this.nextRetryAt = 0;
    this.notifyStatusChange();
    const WebSocket = websocketCtor();
    const ws = new WebSocket(url);
    this.ws = ws;
    const onMessage = (event) => this.handleWebSocketMessage(event && event.data !== undefined ? event.data : event)
      .catch((err) => log.warn(`Twitch 訊息處理失敗：${err.message}`));
    const onOpen = () => log.info('正在連線 Twitch EventSub WebSocket');
    const onClose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.wsSessionId = null;
      this.subscriptionState = 'idle';
      this.lastDisconnectedAt = Date.now();
      this.notifyStatusChange();
      if (!this.closed) this.scheduleReconnect('EventSub 連線中斷');
    };
    const onError = (err) => {
      this.lastConnectionError = err && err.message ? err.message : '連線失敗';
      log.warn(`Twitch EventSub WebSocket 錯誤：${this.lastConnectionError}`);
      this.notifyStatusChange();
    };
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('open', onOpen); ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose); ws.addEventListener('error', onError);
    } else {
      ws.on('open', onOpen); ws.on('message', onMessage); ws.on('close', onClose); ws.on('error', onError);
    }
  }

  scheduleReconnect(reason = '等待重新連線') {
    if (this.reconnectTimer || this.closed) return;
    this.reconnectAttempt += 1;
    const delay = reconnectDelay(this.reconnectAttempt);
    this.connectionState = 'reconnecting';
    this.lastConnectionError = String(reason || '').slice(0, 240);
    this.nextRetryAt = Date.now() + delay;
    this.notifyStatusChange();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.nextRetryAt = 0;
      this.ensureToken().then((ready) => {
        if (ready) this.connectEventSub();
        else this.scheduleReconnect('Twitch 授權暫時無法更新');
      }).catch((err) => this.scheduleReconnect(err.message));
    }, delay);
  }

  async handleWebSocketMessage(raw) {
    let message;
    try { message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch (_) { return; }
    const type = message && message.metadata && message.metadata.message_type;
    if (type === 'session_welcome') {
      this.wsSessionId = message.payload.session.id;
      this.connectionState = 'connected';
      this.subscriptionState = 'subscribing';
      this.lastConnectedAt = Date.now();
      this.lastConnectionError = '';
      this.reconnectAttempt = 0;
      this.nextRetryAt = 0;
      this.notifyStatusChange();
      log.info('Twitch EventSub 已連線，正在建立訂閱');
      try {
        await Promise.all([
          this.createSubscription('stream.online', { broadcaster_user_id: this.auth.userId }),
          this.createSubscription('stream.offline', { broadcaster_user_id: this.auth.userId }),
          this.createSubscription('channel.chat.message', { broadcaster_user_id: this.auth.userId, user_id: this.auth.userId }),
        ]);
        this.subscriptionState = 'ready';
        log.info('Twitch EventSub 訂閱完成：開台、下播、聊天室訊息');
        this.notifyStatusChange();
      } catch (err) {
        this.subscriptionState = 'error';
        this.lastConnectionError = err.message;
        log.error(`Twitch EventSub 訂閱失敗：${err.message}`);
        this.notifyStatusChange();
        if (this.ws && typeof this.ws.close === 'function') this.ws.close();
      }
      return;
    }
    if (type === 'session_reconnect') {
      const reconnectUrl = message.payload && message.payload.session && message.payload.session.reconnect_url;
      const old = this.ws; this.ws = null; this.wsSessionId = null;
      this.subscriptionState = 'idle';
      this.connectionState = 'reconnecting';
      this.lastDisconnectedAt = Date.now();
      this.notifyStatusChange();
      if (old && typeof old.close === 'function') old.close();
      if (reconnectUrl) this.connectEventSub(reconnectUrl);
      return;
    }
    if (type !== 'notification') return;
    const subscription = message.payload && message.payload.subscription;
    const event = message.payload && message.payload.event;
    if (!subscription || !event) return;
    if (subscription.type === 'stream.online') {
      this.onStreamOnline({ startedAt: toTimestamp(event.started_at), eventId: message.metadata.message_id });
    } else if (subscription.type === 'stream.offline') {
      this.onStreamOffline({ eventId: message.metadata.message_id });
    } else if (subscription.type === 'channel.chat.message') {
      await this.handleChatMessage(event, message.metadata.message_id);
    }
  }

  async createSubscription(type, condition) {
    if (!this.wsSessionId) throw new Error('Twitch EventSub WebSocket 尚未建立 session');
    const response = await this.helix('/eventsub/subscriptions', {
      method: 'POST',
      body: { type, version: '1', condition, transport: { method: 'websocket', session_id: this.wsSessionId } },
    });
    if (!response.ok && response.status !== 409) {
      const data = await response.json().catch(() => ({}));
      throw new Error(`${type}：${data.message || response.status}`);
    }
  }

  async helix(path, options = {}) {
    const headers = {
      'Client-Id': this.config.twitchClientId,
      Authorization: `Bearer ${this.auth.accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    };
    return fetch(`${HELIX}${path}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  }

  async fetchYouTubeMetadata(url) {
    const fallback = {
      title: '無法取得影片標題',
      author: '',
      thumbnail: '',
      metadataAvailable: false,
    };
    try {
      const assessment = await AudioProcessor.inspectYouTube(url);
      return {
        title: String(assessment.title || fallback.title).slice(0, 300),
        author: String(assessment.author || '').slice(0, 200),
        thumbnail: assessment.thumbnail || '',
        duration: Number(assessment.duration) || 0,
        metadataAvailable: !!assessment.title,
        assessment,
      };
    } catch (err) {
      log.warn(`YouTube 點歌資訊讀取失敗：${err.message}`);
      return fallback;
    }
  }

  async handleChatMessage(event, fallbackId) {
    const text = String(event.message && event.message.text || '').trim();
    const command = String(this.config.twitchRequestCommand || '!點歌').trim();
    const match = new RegExp(`^${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+(.+))?$`, 'i').exec(text);
    if (!match) return;
    const url = String(match[1] || '').trim();
    const requestId = event.message_id || fallbackId || crypto.randomUUID();
    const parsedUrl = parseYouTubeUrl(url);
    if (!parsedUrl?.videoId) {
      await this.sendChatReply(event, '請在 !點歌 後附上 YouTube 連結，例如：!點歌 https://youtu.be/…');
      return;
    }
    if (parsedUrl.playlistId) { await this.sendChatReply(event, '點歌只接受單曲連結，不接受播放清單。'); return; }
    if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) { await this.sendChatReply(event, '待確認點歌已滿，請稍後再試。'); return; }
    if ([...this.pendingRequests.values()].some(r => r.videoId === parsedUrl.videoId)) { await this.sendChatReply(event, '這首歌已在待確認清單中，不需重複點歌。'); return; }
    const metadata = await this.fetchYouTubeMetadata(url);
    const request = {
      requestId,
      url,
      requester: event.chatter_user_name || event.chatter_user_login || '觀眾',
      title: metadata.title,
      author: metadata.author,
      thumbnail: metadata.thumbnail,
      metadataAvailable: metadata.metadataAvailable,
      videoId: parsedUrl.videoId,
      duration: metadata.duration || 0,
      durationWarning: !!metadata.assessment?.warningTypes?.includes('too-long'),
      assessment: metadata.assessment || null,
    };
    const accepted = this.onSongRequest(request);
    if (!accepted) {
      await this.sendChatReply(event, '目前控制面板未開啟，暫時無法接收點歌。');
      return;
    }
    const createdAt = Date.now();
    this.pendingRequests.set(requestId, { ...request, event, createdAt, expiresAt: createdAt + REQUEST_TTL_MS });
    this.scheduleRequestExpiry(requestId);
    this.persistPendingRequests();
    // 確認制：不自動下載，先送到主播面板等待確認。
    await this.sendChatReply(event, '收到你的點歌，已送給主播確認，通過後才會加入歌單。');
    this.pruneRequests();
  }

  async completeSongRequest({ requestId, success, title, error, rejected, retryable } = {}) {
    const request = this.pendingRequests.get(requestId);
    if (!request) throw new Error('這筆 Twitch 點歌已不存在或已逾時');
    // 匯入短暫失敗時讓面板保留「再試一次」；不可在此刪除 pending，否則重試成功無法回覆聊天室。
    if (retryable) {
      log.info(`Twitch 點歌匯入失敗，保留供重試：${requestId}`);
      return;
    }
    if (rejected) {
      await this.sendChatReply(request.event, '主播暫時略過了這首點歌，可以換一首再點點看～');
    } else if (success) {
      await this.sendChatReply(request.event, `點歌成功：${title || '已加入播放清單'}`);
    } else {
      await this.sendChatReply(request.event, `點歌失敗：${error || '無法處理這個連結'}`);
    }
    this.pendingRequests.delete(requestId);
    this.clearRequestExpiry(requestId);
    this.persistPendingRequests();
  }

  async sendChatReply(event, text) {
    if (!await this.ensureToken()) throw new Error('Twitch 授權已失效');
    const options = {
      method: 'POST',
      body: { broadcaster_id: this.auth.userId, sender_id: this.auth.userId, message: `@${event.chatter_user_name || event.chatter_user_login || '觀眾'} ${text}`.slice(0, 500) },
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.helix('/chat/messages', options);
      if (response.ok) return;
      if (response.status === 401 && attempt === 0) {
        await this.refreshToken();
        continue;
      }
      const data = await response.json().catch(() => ({}));
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) throw new Error(data.message || `Twitch API ${response.status}`);
      const retryAfter = Number(response.headers?.get?.('retry-after'));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** attempt));
    }
  }

  pruneRequests() {
    const cutoff = Date.now() - REQUEST_TTL_MS;
    for (const [id, request] of this.pendingRequests) {
      if (request.createdAt < cutoff) this.expireRequest(id, request);
    }
    this.persistPendingRequests();
  }

  getPendingRequests() {
    const now = Date.now();
    return [...this.pendingRequests.values()]
      .filter((request) => request.expiresAt > now)
      .map(({ event, ...request }) => request);
  }

  scheduleRequestExpiry(requestId) {
    this.clearRequestExpiry(requestId);
    const request = this.pendingRequests.get(requestId);
    const delay = Math.max(0, Number(request?.expiresAt || Date.now() + REQUEST_TTL_MS) - Date.now());
    const timer = setTimeout(() => this.expireRequest(requestId)
      .catch((err) => log.warn(`Twitch 點歌逾時回覆失敗：${err.message}`)), delay);
    this.requestExpiryTimers.set(requestId, timer);
  }

  clearRequestExpiry(requestId) {
    const timer = this.requestExpiryTimers.get(requestId);
    if (timer) clearTimeout(timer);
    this.requestExpiryTimers.delete(requestId);
  }

  async expireRequest(requestId, request = this.pendingRequests.get(requestId)) {
    if (!request || !this.pendingRequests.delete(requestId)) return;
    this.clearRequestExpiry(requestId);
    this.persistPendingRequests();
    if (typeof this.onSongRequestExpired === 'function') this.onSongRequestExpired(requestId);
    await this.sendChatReply(request.event, '這筆點歌等待確認逾時，已自動取消；歡迎重新點歌。');
  }

  stop() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const timer of this.requestExpiryTimers.values()) clearTimeout(timer);
    this.requestExpiryTimers.clear();
    if (this.ws && typeof this.ws.close === 'function') this.ws.close();
    this.ws = null;
    this.wsSessionId = null;
    this.connectionState = 'stopped';
    this.subscriptionState = 'idle';
    this.nextRetryAt = 0;
    this.notifyStatusChange();
    this.persistPendingRequests();
  }
}

module.exports = { TwitchService, reconnectDelay };
