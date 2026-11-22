'use strict';

const {
  store,
  requestStore,
  requestSessionStore,
  requestHistoryStore,
  refundDiskStore,
  TwitchReplySettings,
  TwitchRequestSettings,
  TwitchRewardSettings,
  reconnectDelay,
  log,
  REQUIRED_SCOPES,
  toSupportEvent,
  REDEMPTION_SCOPE,
  CONNECT_WATCHDOG_MS,
  DEFAULT_EVENTSUB_KEEPALIVE_SECONDS
} = require('./twitch-service/shared');
const installMethods = require('./twitch-service/install-methods');

class TwitchService {
  constructor({ config, onStreamOnline, onStreamOffline, onRaid, onSupport, onSongRequest, onSongRequestExpired, onSongRequestCanceled, onSongRequestClosedExternally, onStatusChange, onRequestSettingsChange, onPanelAction, onPendingRequestsChanged, onHistoryChanged, getPlaybackSnapshot, practiceHistoryService = null, getPracticeHistoryService = null, pendingStore = requestStore, sessionStore = requestSessionStore, historyStore = requestHistoryStore, authStore = store, refundStore = refundDiskStore, timers = globalThis }) {
    this.config = config;
    this.onStreamOnline = onStreamOnline;
    this.onStreamOffline = onStreamOffline;
    this.onRaid = typeof onRaid === 'function' ? onRaid : null;
    this.onSupport = typeof onSupport === 'function' ? onSupport : null;
    this.onSongRequest = onSongRequest;
    this.onSongRequestExpired = onSongRequestExpired;
    this.onSongRequestCanceled = onSongRequestCanceled;
    this.onSongRequestClosedExternally = onSongRequestClosedExternally;
    this.onStatusChange = typeof onStatusChange === 'function' ? onStatusChange : null;
    this.onRequestSettingsChange = typeof onRequestSettingsChange === 'function' ? onRequestSettingsChange : null;
    this.onPanelAction = typeof onPanelAction === 'function' ? onPanelAction : null;
    this.onPendingRequestsChanged = typeof onPendingRequestsChanged === 'function' ? onPendingRequestsChanged : null;
    this.onHistoryChanged = typeof onHistoryChanged === 'function' ? onHistoryChanged : null;
    this.getPlaybackSnapshot = typeof getPlaybackSnapshot === 'function' ? getPlaybackSnapshot : () => ({});
    // Lazy lookup keeps ordinary requests independent of practice history storage.
    this.getPracticeHistoryService = typeof getPracticeHistoryService === 'function'
      ? getPracticeHistoryService
      : () => practiceHistoryService || require('./practice-history').getPracticeHistoryService();
    this.deviceAuthorization = null;
    this.authStore = authStore;
    this.timers = (timers && typeof timers.setTimeout === 'function' && typeof timers.clearTimeout === 'function')
      ? timers : globalThis;
    this.auth = this.authStore.load();
    this.ws = null;
    this.eventSubHandoff = null;
    this.wsSessionId = null;
    this.pendingStore = pendingStore;
    this.sessionStore = sessionStore;
    this.historyStore = historyStore;
    this.pendingRequests = new Map();
    this.requestExpiryTimers = new Map();
    // 排除面板重送、逾時與退款事件同時結算同一筆兌換。
    this.settlingRequests = new Set();
    this.adminPanelActions = new Map();
    this.reconnectTimer = null;
    this.connectionWatchdogTimer = null;
    this.keepaliveWatchdogTimer = null;
    this.lastEventSubMessageAt = 0;
    this.eventSubKeepaliveSeconds = DEFAULT_EVENTSUB_KEEPALIVE_SECONDS;
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
    this.rewardSyncError = '';
    this.rewardConfirmedAt = 0;
    this.rewardAvailability = {
      isInStock: null,
      redemptionsRedeemedCurrentStream: null,
      cooldownExpiresAt: null,
    };
    this.commandUserCooldowns = new Map();
    this.commandGlobalCooldowns = new Map();
    this.chatReplyUserCooldowns = new Map();
    this.lastChatReplyAt = 0;
    this.rewardSubscriptionReady = false;
    this.seenRedemptions = new Map();
    this.requestSession = this.restoreRequestSession();
    this.streamOnline = this.requestSession.online;
    this.requestHistory = this.restoreRequestHistory();
    this.restorePendingRequests();
    this.refundStore = refundStore;
    this.refundRetries = new Map((refundStore.load() || []).map((item) => [item.redemption.id, item]));
    this.refundRetryTimer = null;
    if (this.refundRetries.size) this.scheduleRefundRetry();
  }

  // 節慶活動等外掛功能的攔截點：回傳 true 表示訊息／兌換已處理，不再進點歌流程。
  // 攔截函式出錯只記錄，一律退回原本流程，外掛壞掉不能拖垮點歌。
  setChatInterceptor(fn) {
    this.chatInterceptor = typeof fn === 'function' ? fn : null;
  }

  setRedemptionInterceptor(fn) {
    this.redemptionInterceptor = typeof fn === 'function' ? fn : null;
  }

  async runInterceptor(fn, label, ...args) {
    if (!fn) return false;
    try {
      return (await fn(...args)) === true;
    } catch (err) {
      log.warn(`Twitch ${label}攔截失敗：${err.message}`);
      return false;
    }
  }

  status() {
    return {
      configured: this.configured(),
      connected: !!this.wsSessionId,
      authorized: !!(this.auth && this.auth.accessToken && this.auth.userId),
      broadcasterLogin: this.auth && this.auth.userLogin ? this.auth.userLogin : null,
      command: TwitchRequestSettings.getCommand(this.requestSettings, 'request')?.command || this.config.twitchRequestCommand || '!點歌',
      missingScopes: REQUIRED_SCOPES.filter((scope) => !this.hasScope(scope)),
      rewardAuthorized: this.hasScope(REDEMPTION_SCOPE),
      rewardSubscriptionReady: this.rewardSubscriptionReady,
      reward: { ...this.rewardSettings },
      rewardSync: {
        state: this.rewardSyncError ? 'error' : (this.rewardSettings.rewardId ? (this.rewardConfirmedAt ? 'confirmed' : 'saved') : 'not-created'),
        error: this.rewardSyncError,
        confirmedAt: this.rewardConfirmedAt,
        ...this.rewardAvailability,
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
      streamOnline: this.streamOnline,
      requestSession: {
        startedAt: this.requestSession.session.startedAt,
        acceptedCount: this.requestSession.session.acceptedCount,
      },
    };
  }

  notifyStatusChange() {
    if (!this.onStatusChange) return;
    try { this.onStatusChange(this.status()); } catch (err) { log.warn(`Twitch 狀態觀測回報失敗：${err.message}`); }
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

  async shutdown() {
    try { await this.setManagedRewardPaused(true); }
    catch (error) { log.warn(`關閉時無法暫停 Twitch 獎勵，下次啟動將補查兌換：${error.message}`); }
    this.stop();
  }

  stop() {
    this.closed = true;
    this.cancelEventSubHandoff();
    if (this.refundRetryTimer) this.timers.clearTimeout(this.refundRetryTimer);
    this.refundRetryTimer = null;
    this.refundStore.save([...this.refundRetries.values()]);
    this.clearConnectionWatchdog();
    this.clearKeepaliveWatchdog();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const timer of this.requestExpiryTimers.values()) clearTimeout(timer);
    this.requestExpiryTimers.clear();
    for (const action of this.adminPanelActions.values()) if (action.timer) clearTimeout(action.timer);
    this.adminPanelActions.clear();
    if (this.ws && typeof this.ws.close === 'function') this.ws.close();
    this.ws = null;
    this.wsSessionId = null;
    this.rewardSubscriptionReady = false;
    this.connectionState = 'stopped';
    this.subscriptionState = 'idle';
    this.nextRetryAt = 0;
    this.notifyStatusChange();
    this.persistPendingRequests();
    this.persistRequestSession();
    this.persistRequestHistory();
  }
}

installMethods(TwitchService, require('./twitch-service/authorization'));

installMethods(TwitchService, require('./twitch-service/eventsub'));

installMethods(TwitchService, require('./twitch-service/requests'));

installMethods(TwitchService, require('./twitch-service/settlement'));

module.exports = { TwitchService, reconnectDelay, CONNECT_WATCHDOG_MS, toSupportEvent };
