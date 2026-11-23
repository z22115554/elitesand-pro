'use strict';

// Methods keep their original receiver and shared dependency instances.
const { reconnectDelay, websocketCtor, log, EVENTSUB_WS, toSupportEvent, REDEMPTION_SCOPE, CONNECT_WATCHDOG_MS, KEEPALIVE_WATCHDOG_GRACE_MS, DEFAULT_EVENTSUB_KEEPALIVE_SECONDS, MAX_EVENTSUB_KEEPALIVE_SECONDS, toTimestamp } = require('./shared');

module.exports = {
  cancelEventSubHandoff() {
    const handoff = this.eventSubHandoff;
    this.eventSubHandoff = null;
    if (!handoff) return;
    this.timers.clearTimeout(handoff.timer);
    try { handoff.ws.close(); } catch (_) { /* best effort */ }
  },

  failEventSubHandoff(ws, reason) {
    if (this.eventSubHandoff?.ws !== ws) return;
    this.cancelEventSubHandoff();
    if (this.closed) return;
    this.lastConnectionError = reason;
    if (this.ws && this.wsSessionId) {
      this.connectionState = 'connected';
      this.notifyStatusChange();
    } else {
      this.scheduleReconnect(reason);
    }
  },

  beginEventSubHandoff(url, from) {
    if (this.closed || this.eventSubHandoff || this.ws !== from || !this.wsSessionId
      || typeof url !== 'string' || !url) return;
    let ws;
    try { const WebSocket = websocketCtor(); ws = new WebSocket(url); }
    catch (_) {
      this.lastConnectionError = 'EventSub 交接連線無法建立，原連線繼續接收事件';
      this.notifyStatusChange();
      return;
    }
    const handoff = {
      ws, from, rewardSubscriptionReady: this.rewardSubscriptionReady,
      subscriptionState: this.subscriptionState, timer: null,
    };
    this.eventSubHandoff = handoff;
    handoff.timer = this.timers.setTimeout(() => {
      this.failEventSubHandoff(ws, 'EventSub 交接逾時，未收到新的 session welcome');
    }, CONNECT_WATCHDOG_MS);
    this.bindEventSubSocket(ws);
    this.connectionState = 'reconnecting';
    this.notifyStatusChange();
  },

  completeEventSubHandoff(message, ws) {
    const handoff = this.eventSubHandoff;
    if (handoff?.ws !== ws || this.closed) return;
    const session = message.payload?.session;
    if (typeof session?.id !== 'string' || !session.id) {
      this.failEventSubHandoff(ws, 'EventSub 交接未提供有效的 session');
      return;
    }
    this.timers.clearTimeout(handoff.timer);
    this.eventSubHandoff = null;
    this.clearConnectionWatchdog();
    this.clearKeepaliveWatchdog();
    if (this.ws !== handoff.from) {
      this.rewardSubscriptionReady = handoff.rewardSubscriptionReady;
      this.subscriptionState = handoff.subscriptionState;
    }
    this.ws = ws;
    this.wsSessionId = session.id;
    const advertisedKeepalive = Number(session.keepalive_timeout_seconds);
    if (Number.isFinite(advertisedKeepalive) && advertisedKeepalive >= 10) {
      this.eventSubKeepaliveSeconds = Math.min(MAX_EVENTSUB_KEEPALIVE_SECONDS, advertisedKeepalive);
    }
    this.lastEventSubMessageAt = Date.now();
    this.lastConnectedAt = Date.now();
    this.connectionState = 'connected';
    this.lastConnectionError = '';
    this.reconnectAttempt = 0;
    this.nextRetryAt = 0;
    this.armKeepaliveWatchdog(ws);
    // Twitch transfers the subscriptions. Closing the old socket only after
    // this welcome avoids a gap and must not resubscribe the transferred session.
    try { handoff.from.close(); } catch (_) { /* best effort */ }
    this.notifyStatusChange();
  },

  clearConnectionWatchdog() {
    if (this.connectionWatchdogTimer) this.timers.clearTimeout(this.connectionWatchdogTimer);
    this.connectionWatchdogTimer = null;
  },

  clearKeepaliveWatchdog() {
    if (this.keepaliveWatchdogTimer) this.timers.clearTimeout(this.keepaliveWatchdogTimer);
    this.keepaliveWatchdogTimer = null;
  },

  handleStalledEventSubSocket(ws, reason) {
    if (this.closed || this.ws !== ws) return;
    this.clearConnectionWatchdog();
    this.clearKeepaliveWatchdog();
    this.ws = null;
    this.wsSessionId = null;
    this.rewardSubscriptionReady = false;
    this.subscriptionState = 'idle';
    this.lastDisconnectedAt = Date.now();
    this.lastConnectionError = reason;
    this.notifyStatusChange();
    try { if (typeof ws.close === 'function') ws.close(); } catch (_) { /* best effort */ }
    if (!this.eventSubHandoff) this.scheduleReconnect(reason);
  },

  armConnectionWatchdog(ws) {
    this.clearConnectionWatchdog();
    this.connectionWatchdogTimer = this.timers.setTimeout(() => {
      this.connectionWatchdogTimer = null;
      // A welcome message clears the watchdog. Ignore stale timers belonging to
      // a replaced socket so a normal EventSub reconnect cannot be interrupted.
      if (this.wsSessionId) return;
      this.handleStalledEventSubSocket(ws, 'EventSub 連線逾時，未收到 session welcome');
    }, CONNECT_WATCHDOG_MS);
  },

  armKeepaliveWatchdog(ws) {
    this.clearKeepaliveWatchdog();
    if (this.closed || this.ws !== ws || !this.wsSessionId) return;
    const delay = Math.max(10000, Math.min(
      MAX_EVENTSUB_KEEPALIVE_SECONDS * 1000 + KEEPALIVE_WATCHDOG_GRACE_MS,
      this.eventSubKeepaliveSeconds * 1000 + KEEPALIVE_WATCHDOG_GRACE_MS,
    ));
    this.keepaliveWatchdogTimer = this.timers.setTimeout(() => {
      this.keepaliveWatchdogTimer = null;
      this.handleStalledEventSubSocket(ws, 'EventSub keepalive 逾時，連線已重新建立');
    }, delay);
  },

  handleEventSubRevocation(message, ws) {
    if (this.ws !== ws) return;
    this.cancelEventSubHandoff();
    const status = String(message?.payload?.subscription?.status || 'revoked').slice(0, 80);
    this.clearConnectionWatchdog();
    this.clearKeepaliveWatchdog();
    this.ws = null;
    this.wsSessionId = null;
    this.rewardSubscriptionReady = false;
    this.subscriptionState = 'revoked';
    this.lastDisconnectedAt = Date.now();
    this.lastConnectionError = `EventSub 訂閱已撤銷（${status}），請重新連接 Twitch`;
    this.auth = null;
    try { this.authStore.clear(); } catch (err) { log.warn(`清除已撤銷 Twitch 授權失敗：${err.message}`); }
    this.connectionState = this.configured() ? 'authorization_required' : 'disabled';
    this.notifyStatusChange();
    try { if (typeof ws.close === 'function') ws.close(); } catch (_) { /* best effort */ }
  },

  disconnectEventSub() {
    this.cancelEventSubHandoff();
    this.clearConnectionWatchdog();
    this.clearKeepaliveWatchdog();
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
  },

  connectEventSub(url = EVENTSUB_WS) {
    if (this.closed || !this.auth || this.ws || this.eventSubHandoff) return;
    this.connectionState = this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
    this.nextRetryAt = 0;
    this.notifyStatusChange();
    const WebSocket = websocketCtor();
    const ws = new WebSocket(url);
    this.ws = ws;
    this.armConnectionWatchdog(ws);
    this.bindEventSubSocket(ws);
  },

  bindEventSubSocket(ws) {
    const onMessage = (event) => this.handleWebSocketMessage(event && event.data !== undefined ? event.data : event, ws)
      .catch((err) => log.warn(`Twitch 訊息處理失敗：${err.message}`));
    const onOpen = () => log.info('正在連線 Twitch EventSub WebSocket');
    const onClose = () => {
      if (this.eventSubHandoff?.ws === ws) {
        this.failEventSubHandoff(ws, 'EventSub 交接連線中斷');
        return;
      }
      if (this.ws !== ws) return;
      if (this.eventSubHandoff?.from === ws) {
        this.eventSubHandoff.rewardSubscriptionReady = this.rewardSubscriptionReady;
        this.eventSubHandoff.subscriptionState = this.subscriptionState;
      }
      this.clearConnectionWatchdog();
      this.clearKeepaliveWatchdog();
      this.ws = null;
      this.wsSessionId = null;
      this.rewardSubscriptionReady = false;
      this.subscriptionState = 'idle';
      this.lastDisconnectedAt = Date.now();
      this.notifyStatusChange();
      if (!this.closed && !this.eventSubHandoff) this.scheduleReconnect('EventSub 連線中斷');
    };
    const onError = (err) => {
      if (this.eventSubHandoff?.ws === ws) {
        this.failEventSubHandoff(ws, 'EventSub 交接連線失敗');
        return;
      }
      if (this.closed || this.ws !== ws) return;
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
  },

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
  },

  async handleWebSocketMessage(raw, ws = this.ws) {
    // Production callbacks pass their source socket. Direct parser calls (used by
    // local recovery tooling and unit tests) have no socket and remain valid.
    if (this.closed || (ws && ws !== this.ws && ws !== this.eventSubHandoff?.ws)) return;
    let message;
    try { message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch (_) { return; }
    const type = message && message.metadata && message.metadata.message_type;
    if (ws && ws === this.eventSubHandoff?.ws) {
      if (type === 'session_welcome') this.completeEventSubHandoff(message, ws);
      return;
    }
    if (this.wsSessionId) {
      this.lastEventSubMessageAt = Date.now();
      this.armKeepaliveWatchdog(ws);
    }
    if (type === 'session_welcome') {
      if (this.wsSessionId) return; // Ignore a duplicate welcome on an established socket.
      this.clearConnectionWatchdog();
      this.wsSessionId = message.payload.session.id;
      const advertisedKeepalive = Number(message.payload?.session?.keepalive_timeout_seconds);
      this.eventSubKeepaliveSeconds = Number.isFinite(advertisedKeepalive) && advertisedKeepalive >= 10
        ? Math.min(MAX_EVENTSUB_KEEPALIVE_SECONDS, advertisedKeepalive)
        : DEFAULT_EVENTSUB_KEEPALIVE_SECONDS;
      this.lastEventSubMessageAt = Date.now();
      this.armKeepaliveWatchdog(ws);
      this.connectionState = 'connected';
      this.subscriptionState = 'subscribing';
      this.lastConnectedAt = Date.now();
      this.lastConnectionError = '';
      this.reconnectAttempt = 0;
      this.nextRetryAt = 0;
      this.notifyStatusChange();
      log.info('Twitch EventSub 已連線，正在建立訂閱');
      const stillCurrent = () => !this.closed && (!ws || this.ws === ws);
      try {
        await Promise.all([
          this.createSubscription('stream.online', { broadcaster_user_id: this.auth.userId }),
          this.createSubscription('stream.offline', { broadcaster_user_id: this.auth.userId }),
          this.createSubscription('channel.chat.message', { broadcaster_user_id: this.auth.userId, user_id: this.auth.userId }),
        ]);
        if (!stillCurrent()) return;
        try {
          // 入站揪團：官方不需要額外授權範圍；失敗只代表看不到揪團感謝，不影響點歌與開台判斷。
          await this.createSubscription('channel.raid', { to_broadcaster_user_id: this.auth.userId });
        } catch (err) {
          log.warn(`Twitch 揪團事件訂閱未啟用：${err.message}`);
        }
        if (!stillCurrent()) return;
        try {
          // 聊天室通知（訂閱、續訂、贈訂）：跟聊天訊息用同一個授權範圍 user:read:chat，不需要重新連接。
          // 失敗只代表沒有訂閱演出，不影響點歌與開台判斷。
          await this.createSubscription('channel.chat.notification', { broadcaster_user_id: this.auth.userId, user_id: this.auth.userId });
        } catch (err) {
          log.warn(`Twitch 訂閱通知未啟用：${err.message}`);
        }
        if (!stillCurrent()) return;
        if (this.hasScope(REDEMPTION_SCOPE)) {
          try {
            await this.createSubscription('channel.channel_points_custom_reward_redemption.add', { broadcaster_user_id: this.auth.userId });
            if (!stillCurrent()) return;
            this.rewardSubscriptionReady = true;
          } catch (err) {
            if (!stillCurrent()) return;
            this.rewardSubscriptionReady = false;
            log.warn(`Twitch 忠誠點數兌換訂閱未啟用：${err.message}`);
          }
          try {
            await this.createSubscription('channel.channel_points_custom_reward_redemption.update', { broadcaster_user_id: this.auth.userId });
          } catch (err) {
            // 沒有這個訂閱時，後台處理過的兌換仍會在下次操作或到期時由狀態核對收掉。
            log.warn(`Twitch 忠誠點數狀態更新訂閱未啟用：${err.message}`);
          }
          if (!stillCurrent()) return;
        }
        this.subscriptionState = 'ready';
        if (this.rewardSubscriptionReady) {
          try { await this.setManagedRewardPaused(this.rewardSettings.paused === true); }
          catch (error) { log.warn(`Twitch 獎勵暫停狀態同步失敗：${error.message}`); }
          if (!stillCurrent()) return;
          try { await this.reconcileRewardRedemptions(); }
          catch (error) { log.warn(`Twitch 兌換補查失敗：${error.message}`); }
          if (!stillCurrent()) return;
        }
        try {
          await this.refreshLiveState();
        } catch (err) {
          log.warn(`Twitch 開台狀態確認失敗，暫沿用上次狀態：${err.message}`);
        }
        if (!stillCurrent()) return;
        log.info(`Twitch EventSub 訂閱完成：開台、下播、聊天室訊息${this.rewardSubscriptionReady ? '、忠誠點數兌換' : ''}`);
        this.notifyStatusChange();
      } catch (err) {
        if (this.closed || (ws && this.ws !== ws)) return;
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
      this.beginEventSubHandoff(reconnectUrl, ws);
      return;
    }
    if (type === 'revocation') {
      this.handleEventSubRevocation(message, ws);
      return;
    }
    if (type !== 'notification') return;
    const messageId = message.metadata?.message_id;
    if (messageId) {
      if (!this.seenNotifications) this.seenNotifications = new Map();
      const now = Date.now();
      for (const [id, at] of this.seenNotifications) if (now - at > 10 * 60 * 1000) this.seenNotifications.delete(id);
      if (this.seenNotifications.has(messageId)) return;
      this.seenNotifications.set(messageId, now);
      if (this.seenNotifications.size > 5000) this.seenNotifications.delete(this.seenNotifications.keys().next().value);
    }
    const subscription = message.payload && message.payload.subscription;
    const event = message.payload && message.payload.event;
    if (!subscription || !event) return;
    if (subscription.type === 'stream.online') {
      this.startRequestSession(toTimestamp(event.started_at));
      this.onStreamOnline({ startedAt: toTimestamp(event.started_at), eventId: message.metadata.message_id });
    } else if (subscription.type === 'stream.offline') {
      this.stopRequestSession();
      this.onStreamOffline({ eventId: message.metadata.message_id });
    } else if (subscription.type === 'channel.raid') {
      try {
        this.onRaid?.({
          eventId: String(message.metadata.message_id || ''),
          fromName: String(event.from_broadcaster_user_name || event.from_broadcaster_user_login || ''),
          viewers: Number(event.viewers) || 0,
        });
      } catch (err) {
        log.warn(`Twitch 揪團事件處理失敗：${err.message}`);
      }
    } else if (subscription.type === 'channel.chat.notification') {
      try {
        const support = toSupportEvent(event, message.metadata.message_id);
        if (support) this.onSupport?.(support);
      } catch (err) {
        log.warn(`Twitch 訂閱通知處理失敗：${err.message}`);
      }
    } else if (subscription.type === 'channel.chat.message') {
      await this.handleChatMessage(event, message.metadata.message_id);
    } else if (subscription.type === 'channel.channel_points_custom_reward_redemption.add') {
      await this.handleRewardRedemption(event, message.metadata.message_id);
    } else if (subscription.type === 'channel.channel_points_custom_reward_redemption.update') {
      await this.handleRewardRedemptionUpdate(event);
    }
  },

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
  },
};
