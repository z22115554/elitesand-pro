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
const fetch = require('node-fetch');
const store = require('./twitch-store');
const requestStore = require('./twitch-request-store');
const TwitchReplySettings = require('../../public/js/twitch-reply-settings');
const TwitchRequestSettings = require('../../public/js/twitch-request-settings');
const TwitchRewardSettings = require('../../public/js/twitch-reward-settings');
const { createLogger } = require('../utils/logger');

const log = createLogger('Twitch');
const OAUTH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const OAUTH_DEVICE = 'https://id.twitch.tv/oauth2/device';
const OAUTH_VALIDATE = 'https://id.twitch.tv/oauth2/validate';
const OAUTH_REVOKE = 'https://id.twitch.tv/oauth2/revoke';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
const REQUIRED_SCOPES = Object.freeze(['user:read:chat', 'user:write:chat', 'channel:manage:redemptions']);
const REDEMPTION_SCOPE = 'channel:manage:redemptions';
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

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function requesterKey(event) {
  return String(event?.chatter_user_id || event?.chatter_user_login || event?.chatter_user_name || '').trim().toLocaleLowerCase();
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
    this.replySettings = TwitchReplySettings.getDefaults();
    this.requestSettings = TwitchRequestSettings.getDefaults();
    this.rewardSettings = TwitchRewardSettings.getDefaults();
    this.requestCooldowns = new Map();
    this.rewardSubscriptionReady = false;
    this.seenRedemptions = new Map();
    this.restorePendingRequests();
  }

  setReplySettings(settings) {
    this.replySettings = TwitchReplySettings.normalizeSettings(settings);
    return this.replySettings;
  }

  setRequestSettings(settings) {
    this.requestSettings = TwitchRequestSettings.normalizeSettings(settings);
    if (this.requestSettings.cooldownSeconds === 0) this.requestCooldowns.clear();
    return this.requestSettings;
  }

  setRewardSettings(settings) {
    this.rewardSettings = TwitchRewardSettings.normalizeSettings(settings);
    return this.rewardSettings;
  }

  hasScope(scope) {
    return Array.isArray(this.auth?.scopes) && this.auth.scopes.includes(scope);
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
      command: this.requestSettings?.command || this.config.twitchRequestCommand || '!點歌',
      missingScopes: REQUIRED_SCOPES.filter((scope) => !this.hasScope(scope)),
      rewardAuthorized: this.hasScope(REDEMPTION_SCOPE),
      rewardSubscriptionReady: this.rewardSubscriptionReady,
      reward: {
        enabled: this.rewardSettings.enabled,
        rewardId: this.rewardSettings.rewardId,
        title: this.rewardSettings.title,
        cost: this.rewardSettings.cost,
      },
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
      requesterId: String(request.requesterId || ''),
      source: request.source === 'channel-points' ? 'channel-points' : 'chat',
      rewardRedemption: request.rewardRedemption && typeof request.rewardRedemption === 'object' ? {
        id: String(request.rewardRedemption.id || ''),
        rewardId: String(request.rewardRedemption.rewardId || ''),
        cost: Number(request.rewardRedemption.cost) || 0,
      } : null,
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
        message_id: String(request.event?.message_id || ''),
      },
      retryableReplySent: !!request.retryableReplySent,
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
    for (const raw of restored) {
      const request = this.serializePendingRequest(raw || {});
      if (!request.requestId || !request.videoId) continue;
      this.pendingRequests.set(request.requestId, request);
      if (request.rewardRedemption?.id) this.seenRedemptions.set(request.rewardRedemption.id, request.createdAt);
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
      scopes: REQUIRED_SCOPES.join(' '),
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
      scope: REQUIRED_SCOPES.join(' '),
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
        this.disconnectEventSub();
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
      scopes: Array.isArray(token.scope) ? token.scope
        : Array.isArray(user.scopes) ? user.scopes
          : Array.isArray(this.auth?.scopes) ? this.auth.scopes : [],
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
    this.rewardSubscriptionReady = false;
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
      this.rewardSubscriptionReady = false;
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
        if (this.hasScope(REDEMPTION_SCOPE)) {
          try {
            await this.createSubscription('channel.channel_points_custom_reward_redemption.add', { broadcaster_user_id: this.auth.userId });
            this.rewardSubscriptionReady = true;
          } catch (err) {
            this.rewardSubscriptionReady = false;
            log.warn(`Twitch 忠誠點數兌換訂閱未啟用：${err.message}`);
          }
        }
        this.subscriptionState = 'ready';
        log.info(`Twitch EventSub 訂閱完成：開台、下播、聊天室訊息${this.rewardSubscriptionReady ? '、忠誠點數兌換' : ''}`);
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
      this.rewardSubscriptionReady = false;
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
    } else if (subscription.type === 'channel.channel_points_custom_reward_redemption.add') {
      await this.handleRewardRedemption(event, message.metadata.message_id);
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

  async requireRedemptionAuthorization() {
    if (!await this.ensureToken()) throw new Error('Twitch 授權已失效，請重新連接 Twitch');
    if (!this.hasScope(REDEMPTION_SCOPE)) throw new Error('需要重新連接 Twitch，授權忠誠點數管理權限');
  }

  async syncManagedReward(settings) {
    const validation = TwitchRewardSettings.validateSettings(settings);
    if (!validation.ok) throw new Error(validation.errors[0]?.message || 'Twitch 忠誠點數設定格式無效');
    let normalized = validation.settings;
    if (!normalized.enabled && !normalized.rewardId) return normalized;
    await this.requireRedemptionAuthorization();
    const query = `broadcaster_id=${encodeURIComponent(this.auth.userId)}`;
    const body = {
      title: normalized.title,
      prompt: normalized.prompt,
      cost: normalized.cost,
      is_enabled: normalized.enabled,
      is_user_input_required: true,
      should_redemptions_skip_request_queue: false,
    };

    let response = null;
    if (normalized.rewardId) {
      response = await this.helix(`/channel_points/custom_rewards?${query}&id=${encodeURIComponent(normalized.rewardId)}`, { method: 'PATCH', body });
      if (response.status === 404) normalized = { ...normalized, rewardId: '' };
    }
    if (!normalized.rewardId) {
      response = await this.helix(`/channel_points/custom_rewards?${query}`, { method: 'POST', body });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('Twitch 忠誠點數權限不足，請重新連接 Twitch');
      if (response.status === 403) throw new Error('此頻道尚未開放忠誠點數，或這個獎勵不是由 Elitesand Pro 建立');
      throw new Error(data.message || `Twitch 獎勵同步失敗（${response.status}）`);
    }
    const reward = Array.isArray(data.data) ? data.data[0] : null;
    if (!reward?.id) throw new Error('Twitch 沒有回傳可管理的獎勵識別碼');
    normalized = { ...normalized, rewardId: String(reward.id) };
    this.setRewardSettings(normalized);
    return normalized;
  }

  async updateRewardRedemptionStatus(redemption, status) {
    if (!redemption?.id || !redemption?.rewardId) throw new Error('忠誠點數兌換資料不完整');
    await this.requireRedemptionAuthorization();
    const query = new URLSearchParams({
      broadcaster_id: this.auth.userId,
      reward_id: redemption.rewardId,
      id: redemption.id,
    });
    const response = await this.helix(`/channel_points/custom_rewards/redemptions?${query}`, {
      method: 'PATCH', body: { status },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Twitch 兌換狀態更新失敗（${response.status}）`);
    }
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
    const rules = this.requestSettings || TwitchRequestSettings.getDefaults();
    const match = TwitchRequestSettings.matchCommand(text, rules);
    if (!match) return;
    const command = match.command;
    const url = String(match.argument || '').trim();

    if (!rules.enabled) {
      await this.sendConfiguredReply(event, 'requestDisabled', { command });
      return;
    }
    if (!TwitchRequestSettings.permissionAllows(event, rules.permissionLevel)) {
      await this.sendConfiguredReply(event, 'permissionDenied', { command });
      return;
    }
    const userKey = requesterKey(event);
    const now = Date.now();
    const lastAcceptedAt = this.requestCooldowns.get(userKey) || 0;
    const remainingSeconds = Math.ceil(((rules.cooldownSeconds * 1000) - (now - lastAcceptedAt)) / 1000);
    if (userKey && rules.cooldownSeconds > 0 && remainingSeconds > 0) {
      await this.sendConfiguredReply(event, 'cooldownActive', { command, seconds: remainingSeconds });
      return;
    }

    const requestId = event.message_id || fallbackId || crypto.randomUUID();
    await this.handleSongRequestInput({ event, requestId, url, command, source: 'chat' });
  }

  async handleRewardRedemption(redemptionEvent, fallbackId) {
    const settings = this.rewardSettings || TwitchRewardSettings.getDefaults();
    const reward = redemptionEvent?.reward || {};
    if (!settings.enabled || !settings.rewardId || String(reward.id || '') !== settings.rewardId) return;
    if (redemptionEvent.status && redemptionEvent.status !== 'unfulfilled' && redemptionEvent.status !== 'UNFULFILLED') return;
    const redemptionId = String(redemptionEvent.id || fallbackId || '');
    if (!redemptionId || this.seenRedemptions.has(redemptionId)) return;
    if ([...this.pendingRequests.values()].some((request) => request.rewardRedemption?.id === redemptionId)) return;

    this.seenRedemptions.set(redemptionId, Date.now());
    const event = {
      chatter_user_id: String(redemptionEvent.user_id || ''),
      chatter_user_login: String(redemptionEvent.user_login || ''),
      chatter_user_name: String(redemptionEvent.user_name || '觀眾'),
      message_id: '',
    };
    const redemption = { id: redemptionId, rewardId: settings.rewardId, cost: Number(reward.cost) || settings.cost };
    try {
      if (!this.requestSettings?.enabled) {
        await this.rejectSongRequest({ event, key: 'requestDisabled', redemption, reason: '目前暫停接受點歌' });
        return;
      }
      await this.handleSongRequestInput({
        event,
        requestId: `reward:${redemptionId}`,
        url: String(redemptionEvent.user_input || '').trim(),
        command: settings.title,
        source: 'channel-points',
        redemption,
      });
    } catch (err) {
      const pending = [...this.pendingRequests.values()].some((request) => request.rewardRedemption?.id === redemptionId);
      if (!pending) this.seenRedemptions.delete(redemptionId);
      throw err;
    }
  }

  async rejectSongRequest({ event, key, values = {}, redemption = null, reason = '不符合目前點歌規則' }) {
    if (!redemption) return this.sendConfiguredReply(event, key, values);
    await this.updateRewardRedemptionStatus(redemption, 'CANCELED');
    try {
      return await this.sendConfiguredReply(event, 'rewardRefunded', {
        ...values,
        reason,
        cost: redemption.cost,
      });
    } catch (err) {
      log.warn(`忠誠點數已退款，但聊天室通知失敗：${err.message}`);
      return { sent: false, skipped: false };
    }
  }

  async handleSongRequestInput({ event, requestId, url, command, source, redemption = null }) {
    const rules = this.requestSettings || TwitchRequestSettings.getDefaults();
    const parsedUrl = parseYouTubeUrl(url);
    if (!parsedUrl?.videoId) {
      await this.rejectSongRequest({ event, key: 'invalidLink', values: { command }, redemption, reason: '沒有提供有效的 YouTube 單曲連結' });
      return;
    }
    if (parsedUrl.playlistId) {
      await this.rejectSongRequest({ event, key: 'playlistNotAllowed', values: { url }, redemption, reason: '播放清單連結不屬於單曲點歌' });
      return;
    }
    if (this.pendingRequests.size >= rules.maxPending) {
      await this.rejectSongRequest({ event, key: 'queueFull', values: { url, limit: rules.maxPending }, redemption, reason: '待確認點歌已達總上限' });
      return;
    }
    const userKey = requesterKey(event);
    if (userKey && rules.perUserPending > 0) {
      const userPending = [...this.pendingRequests.values()].filter((request) => request.requesterId === userKey).length;
      if (userPending >= rules.perUserPending) {
        await this.rejectSongRequest({ event, key: 'userLimitReached', values: { url, limit: rules.perUserPending }, redemption, reason: '你目前的待確認點歌已達上限' });
        return;
      }
    }
    if (rules.rejectDuplicates && [...this.pendingRequests.values()].some((request) => request.videoId === parsedUrl.videoId)) {
      await this.rejectSongRequest({ event, key: 'duplicatePending', values: { url }, redemption, reason: '同一首歌已在待確認清單中' });
      return;
    }
    const metadata = await this.fetchYouTubeMetadata(url);
    if (rules.maxDurationMinutes > 0 && metadata.duration > rules.maxDurationMinutes * 60) {
      await this.rejectSongRequest({
        event, key: 'durationExceeded', redemption, reason: `歌曲超過 ${rules.maxDurationMinutes} 分鐘限制`,
        values: { title: metadata.title, artist: metadata.author, url, duration: formatDuration(metadata.duration), limit: rules.maxDurationMinutes },
      });
      return;
    }
    const request = {
      requestId,
      url,
      requester: event.chatter_user_name || event.chatter_user_login || '觀眾',
      requesterId: userKey,
      source,
      rewardRedemption: redemption,
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
      await this.rejectSongRequest({
        event, key: 'panelUnavailable', redemption, reason: '控制面板目前無法接收點歌',
        values: { title: request.title, artist: request.author, url },
      });
      return;
    }
    const createdAt = Date.now();
    this.pendingRequests.set(requestId, { ...request, event, createdAt, expiresAt: createdAt + REQUEST_TTL_MS });
    if (source === 'chat' && userKey && rules.cooldownSeconds > 0) this.requestCooldowns.set(userKey, createdAt);
    this.scheduleRequestExpiry(requestId);
    this.persistPendingRequests();
    // 確認制：不自動下載，先送到主播面板等待確認。
    await this.sendConfiguredReply(event, source === 'channel-points' ? 'rewardReceived' : 'received', {
      title: request.title, artist: request.author, url, cost: redemption?.cost || '',
    });
    this.pruneRequests();
  }

  async completeSongRequest({ requestId, success, title, artist, rejected, retryable, position, queue } = {}) {
    const request = this.pendingRequests.get(requestId);
    if (!request) throw new Error('這筆 Twitch 點歌已不存在或已逾時');
    // 匯入短暫失敗時讓面板保留「再試一次」；不可在此刪除 pending，否則重試成功無法回覆聊天室。
    if (retryable) {
      if (!request.retryableReplySent) {
        const reply = await this.sendConfiguredReply(request.event, 'retryableFailure', {
          title: request.title,
          artist: request.author,
          url: request.url,
          reason: '下載或匯入暫時失敗',
        });
        if (reply.sent) request.retryableReplySent = true;
      }
      this.persistPendingRequests();
      log.info(`Twitch 點歌匯入失敗，保留供重試：${requestId}`);
      return;
    }
    if (request.rewardRedemption) {
      const fulfilled = !!success && !rejected;
      const reason = rejected ? '主播略過了這首歌' : '目前無法完成歌曲匯入';
      await this.updateRewardRedemptionStatus(request.rewardRedemption, fulfilled ? 'FULFILLED' : 'CANCELED');
      try {
        await this.sendConfiguredReply(request.event, fulfilled ? 'rewardFulfilled' : 'rewardRefunded', {
          title: title || request.title || '已加入播放清單',
          artist: artist || request.author,
          url: request.url,
          position: position || '播放清單',
          queue: queue || '',
          cost: request.rewardRedemption.cost,
          reason,
        });
      } catch (err) {
        log.warn(`忠誠點數兌換已${fulfilled ? '完成' : '退款'}，但聊天室通知失敗：${err.message}`);
      }
      this.pendingRequests.delete(requestId);
      this.clearRequestExpiry(requestId);
      this.persistPendingRequests();
      return;
    }
    if (rejected) {
      await this.sendConfiguredReply(request.event, 'hostRejected', {
        title: request.title, artist: request.author, url: request.url, reason: '主播略過了這首歌',
      });
    } else if (success) {
      await this.sendConfiguredReply(request.event, 'importSuccess', {
        title: title || request.title || '已加入播放清單',
        artist: artist || request.author,
        url: request.url,
        position: position || '播放清單',
        queue: queue || '',
      });
    } else {
      await this.sendConfiguredReply(request.event, 'importFailure', {
        title: request.title,
        artist: request.author,
        url: request.url,
        reason: '目前無法處理這個連結',
      });
    }
    this.pendingRequests.delete(requestId);
    this.clearRequestExpiry(requestId);
    this.persistPendingRequests();
  }

  async sendConfiguredReply(event, replyKey, values = {}) {
    const settings = this.replySettings || TwitchReplySettings.getDefaults();
    const reply = settings.replies && settings.replies[replyKey];
    if (!settings.enabled || !reply || !reply.enabled) return { sent: false, skipped: true };
    const text = TwitchReplySettings.renderTemplate(reply.template, {
      user: event?.chatter_user_name || event?.chatter_user_login || '觀眾',
      command: this.requestSettings?.command || this.config.twitchRequestCommand || '!點歌',
      title: '', artist: '', reason: '', position: '', queue: '', url: '',
      seconds: '', limit: '', duration: '', cost: '',
      ...values,
    });
    if (!text) return { sent: false, skipped: true };
    await this.sendChatReply(event, text, { mode: settings.replyMode });
    return { sent: true, skipped: false };
  }

  async sendReplyTest(settings, replyKey) {
    const validation = TwitchReplySettings.validateSettings(settings);
    if (!validation.ok) throw new Error(validation.errors[0]?.message || 'Twitch 回覆設定格式無效');
    const definition = TwitchReplySettings.REPLY_DEFINITIONS.find((item) => item.key === replyKey);
    if (!definition) throw new Error('找不到要測試的 Twitch 回覆項目');
    const reply = validation.settings.replies[replyKey];
    const text = TwitchReplySettings.renderTemplate(reply.template, {
      ...TwitchReplySettings.sampleValues(),
      command: this.requestSettings?.command || this.config.twitchRequestCommand || '!點歌',
    });
    const message = `【回覆測試】${text}`;
    await this.sendChatReply({}, message, { mode: 'plain' });
    return { replyKey, text: message };
  }

  async sendChatReply(event, text, { mode = 'mention' } = {}) {
    if (!await this.ensureToken()) throw new Error('Twitch 授權已失效');
    const userName = event.chatter_user_name || event.chatter_user_login || '觀眾';
    const messageId = String(event.message_id || '');
    const useThreadReply = mode === 'reply' && !!messageId;
    const message = mode === 'plain' || useThreadReply ? text : `@${userName} ${text}`;
    const options = {
      method: 'POST',
      body: {
        broadcaster_id: this.auth.userId,
        sender_id: this.auth.userId,
        message: Array.from(message).slice(0, TwitchReplySettings.MAX_MESSAGE_LENGTH).join(''),
        ...(useThreadReply ? { reply_parent_message_id: messageId } : {}),
      },
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.helix('/chat/messages', options);
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const result = Array.isArray(data.data) ? data.data[0] : null;
        if (!result || result.is_sent === true) return;
        throw new Error(result.drop_reason?.message || 'Twitch 未送出聊天室回覆');
      }
      if (response.status === 401 && attempt === 0) {
        await this.refreshToken();
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) throw new Error(data.message || `Twitch API ${response.status}`);
      const retryAfter = Number(response.headers?.get?.('retry-after'));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** attempt));
    }
  }

  pruneRequests() {
    const now = Date.now();
    const cutoff = now - REQUEST_TTL_MS;
    for (const [id, request] of this.pendingRequests) {
      if (request.createdAt < cutoff) {
        this.expireRequest(id, request)
          .catch((err) => log.warn(`Twitch 點歌逾時處理失敗：${err.message}`));
      }
    }
    const cooldownMs = (this.requestSettings?.cooldownSeconds || 0) * 1000;
    if (cooldownMs === 0) this.requestCooldowns.clear();
    else {
      for (const [userKey, acceptedAt] of this.requestCooldowns) {
        if (acceptedAt <= now - cooldownMs) this.requestCooldowns.delete(userKey);
      }
    }
    for (const [redemptionId, seenAt] of this.seenRedemptions) {
      if (seenAt <= now - 24 * 60 * 60 * 1000) this.seenRedemptions.delete(redemptionId);
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
    if (!request) return;
    if (request.rewardRedemption) {
      try {
        await this.updateRewardRedemptionStatus(request.rewardRedemption, 'CANCELED');
      } catch (err) {
        request.expiresAt = Date.now() + 60000;
        this.persistPendingRequests();
        this.scheduleRequestExpiry(requestId);
        throw new Error(`忠誠點數逾時退款失敗，60 秒後重試：${err.message}`);
      }
    }
    if (!this.pendingRequests.delete(requestId)) return;
    this.clearRequestExpiry(requestId);
    this.persistPendingRequests();
    if (typeof this.onSongRequestExpired === 'function') this.onSongRequestExpired(requestId);
    try {
      await this.sendConfiguredReply(request.event, request.rewardRedemption ? 'rewardRefunded' : 'requestExpired', {
        title: request.title,
        artist: request.author,
        url: request.url,
        cost: request.rewardRedemption?.cost || '',
        reason: request.rewardRedemption ? '等待主播確認超過 30 分鐘' : '',
      });
    } catch (err) {
      log.warn(`Twitch 點歌已逾時結案，但聊天室通知失敗：${err.message}`);
    }
  }

  stop() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const timer of this.requestExpiryTimers.values()) clearTimeout(timer);
    this.requestExpiryTimers.clear();
    if (this.ws && typeof this.ws.close === 'function') this.ws.close();
    this.ws = null;
    this.wsSessionId = null;
    this.rewardSubscriptionReady = false;
    this.connectionState = 'stopped';
    this.subscriptionState = 'idle';
    this.nextRetryAt = 0;
    this.notifyStatusChange();
    this.persistPendingRequests();
  }
}

module.exports = { TwitchService, reconnectDelay };
