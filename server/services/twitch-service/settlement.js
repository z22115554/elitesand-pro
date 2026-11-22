'use strict';

// Methods keep their original receiver and shared dependency instances.
const { TwitchRequestSettings, TwitchRewardSettings, log, REDEMPTION_SCOPE, REQUEST_TTL_MS, CHAT_REPLY_USER_COOLDOWN_MS, managedRewardBody } = require('./shared');

module.exports = {
  setRewardSettings(settings) {
    this.rewardSettings = TwitchRewardSettings.normalizeSettings(settings);
    return this.rewardSettings;
  },

  async syncManagedReward(settings) {
    const validation = TwitchRewardSettings.validateSettings(settings);
    if (!validation.ok) throw new Error(validation.errors[0]?.message || 'Twitch 忠誠點數設定格式無效');
    let normalized = validation.settings;
    if (!normalized.enabled && !normalized.rewardId) {
      this.setRewardSettings(normalized);
      this.rewardSyncError = '';
      return normalized;
    }
    try {
      await this.requireRedemptionAuthorization();
      const query = `broadcaster_id=${encodeURIComponent(this.auth.userId)}`;
      let response = null;
      if (normalized.rewardId) {
        response = await this.helix(`/channel_points/custom_rewards?${query}&id=${encodeURIComponent(normalized.rewardId)}`, {
          method: 'PATCH',
          body: managedRewardBody(normalized, true),
        });
        if (response.status === 404) normalized = { ...normalized, rewardId: '' };
      }
      if (!normalized.rewardId) {
        response = await this.helix(`/channel_points/custom_rewards?${query}`, {
          method: 'POST',
          body: managedRewardBody(normalized, false),
        });
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) throw new Error('Twitch 忠誠點數權限不足，請重新連接 Twitch');
        if (response.status === 403) throw new Error('此頻道尚未開放忠誠點數，或這個獎勵不是由 Elitesand Pro 建立');
        throw new Error(data.message || `Twitch 獎勵同步失敗（${response.status}）`);
      }
      const reward = Array.isArray(data.data) ? data.data[0] : null;
      if (!reward?.id) throw new Error('Twitch 沒有回傳可管理的獎勵識別碼');
      const confirmed = TwitchRewardSettings.fromTwitchReward(reward, normalized);
      this.setRewardSettings(confirmed);
      this.rewardSyncError = '';
      this.rewardConfirmedAt = Date.now();
      this.rewardAvailability = {
        isInStock: typeof reward.is_in_stock === 'boolean' ? reward.is_in_stock : null,
        redemptionsRedeemedCurrentStream: Number.isSafeInteger(reward.redemptions_redeemed_current_stream) ? reward.redemptions_redeemed_current_stream : null,
        cooldownExpiresAt: typeof reward.cooldown_expires_at === 'string' && reward.cooldown_expires_at ? reward.cooldown_expires_at : null,
      };
      return confirmed;
    } catch (err) {
      this.rewardSyncError = err.message || 'Twitch 獎勵同步失敗';
      throw err;
    }
  },

  async updateRewardRedemptionStatus(redemption, status) {
    if (!redemption?.id || !redemption?.rewardId) throw new Error('忠誠點數兌換資料不完整');
    await this.requireRedemptionAuthorization();
    const query = new URLSearchParams({
      broadcaster_id: this.auth.userId,
      reward_id: redemption.rewardId,
      id: redemption.id,
    });
    const endpoint = `/channel_points/custom_rewards/redemptions?${query}`;
    const response = await this.helix(endpoint, { method: 'PATCH', body: { status } });
    if (response.ok) return { status, confirmed: true };

    const data = await response.json().catch(() => ({}));
    if (response.status !== 404) {
      throw new Error(data.message || `Twitch 兌換狀態更新失敗（${response.status}）`);
    }
    // Twitch 只允許修改 UNFULFILLED。若已由網頁、其它程式或上次執行結算，
    // PATCH 會回 404；不能每分鐘永久重試，更不能假裝已退款。
    const lookup = await this.helix(endpoint, { method: 'GET' });
    if (lookup.ok) {
      const body = await lookup.json().catch(() => ({}));
      const found = Array.isArray(body.data)
        ? body.data.find(item => String(item.id) === String(redemption.id)) : null;
      const actual = String(found?.status || '').toUpperCase();
      if (actual === 'FULFILLED' || actual === 'CANCELED') {
        log.warn(`Twitch 兌換已在外部結案（預期 ${status}，實際 ${actual}）`);
        return { status: actual, confirmed: true, alreadySettled: true };
      }
      if (actual === 'UNFULFILLED') throw new Error('Twitch 兌換仍待處理，但拒絕變更狀態，請稍後重試');
      // GET 200 但缺少指定 id，不代表已退款。
      log.warn(`Twitch 查無指定兌換（${redemption.id}），本機結案但點數狀態未確認`);
      return { status: 'UNKNOWN', confirmed: false };
    }
    if (lookup.status === 404) {
      log.warn(`Twitch 找不到兌換或獎勵（${redemption.id}），本機結案但點數狀態未確認`);
      return { status: 'UNKNOWN', confirmed: false };
    }
    const failure = await lookup.json().catch(() => ({}));
    throw new Error(failure.message || `Twitch 兌換狀態查詢失敗（${lookup.status}）`);
  },

  async cancelLatestPendingRequest(event) {
    const requests = this.pendingForUser(event);
    const request = requests.at(-1);
    if (!request) {
      await this.sendConfiguredReply(event, 'requestNotFound');
      return;
    }
    // 已匯入的歌曲不可再因觀眾自助取消而誤退款；並與主播結算、逾時互斥。
    if (request.importResult?.success || this.settlingRequests.has(request.requestId)) {
      await this.sendConfiguredReply(event, 'requestCancelFailed', { title: request.title });
      return;
    }
    this.settlingRequests.add(request.requestId);
    try {
    let canceledRedemption = null;
    try {
      if (request.rewardRedemption) {
        canceledRedemption = await this.updateRewardRedemptionStatus(request.rewardRedemption, 'CANCELED');
        // 舊版測試注入的 mock 成功時回傳 void；實際 API 一律會回傳確認結果。
        if (!canceledRedemption) canceledRedemption = { status: 'CANCELED', confirmed: true };
      }
    } catch (err) {
      log.warn(`觀眾取消忠誠點數點歌退款失敗：${err.message}`);
      this.updateRequestHistory(request, {
        result: 'pending', reason: `觀眾取消退款失敗：${err.message}`,
        reward: { status: 'refund-failed' },
      });
      await this.sendConfiguredReply(event, 'requestCancelFailed', { title: request.title });
      return;
    }
    this.pendingRequests.delete(request.requestId);
    this.clearRequestExpiry(request.requestId);
    this.persistPendingRequests();
    this.notifyPendingRequestsChanged();
    const refunded = canceledRedemption?.status === 'CANCELED';
    this.updateRequestHistory(request, {
      result: 'canceled', reason: request.rewardRedemption && !refunded
        ? '觀眾已取消本機點歌，但 Twitch 點數未確認退款，請主播核對' : '觀眾自行取消待確認點歌',
      reward: { status: request.rewardRedemption ? (canceledRedemption?.status === 'FULFILLED' ? 'fulfilled' : refunded ? 'refunded' : 'refund-failed') : 'not-applicable' },
    });
    if (typeof this.onSongRequestCanceled === 'function') this.onSongRequestCanceled(request.requestId);
    if (request.rewardRedemption && !refunded) {
      await this.sendConfiguredReply(event, 'requestCancelFailed', { title: request.title });
    } else if (request.rewardRedemption) {
      await this.sendConfiguredReply(event, 'rewardRefunded', {
        title: request.title,
        artist: request.author,
        cost: request.rewardRedemption.cost,
        reason: '觀眾自行取消待確認點歌',
      });
    } else {
      await this.sendConfiguredReply(event, 'requestCanceled', { title: request.title, artist: request.author });
    }
    } finally {
      this.settlingRequests.delete(request.requestId);
    }
  },

  // 主播或管理員在 Twitch 後台直接處理兌換時，同步收掉待確認項目。
  // 自己的 PATCH 也會觸發這個事件：結算中的交給結算流程，結算完已不在 pending，都不會往下走。
  async handleRewardRedemptionUpdate(redemptionEvent) {
    const status = String(redemptionEvent?.status || '').toUpperCase();
    if (status !== 'CANCELED' && status !== 'FULFILLED') return;
    const redemptionId = String(redemptionEvent.id || '');
    const request = redemptionId
      ? [...this.pendingRequests.values()].find((item) => item.rewardRedemption?.id === redemptionId) : null;
    if (!request || this.settlingRequests.has(request.requestId)) return;
    const { requestId } = request;
    const imported = request.importResult?.success === true;
    const refunded = status === 'CANCELED';
    this.pendingRequests.delete(requestId);
    this.clearRequestExpiry(requestId);
    this.persistPendingRequests();
    this.notifyPendingRequestsChanged();
    const reason = refunded ? '已在 Twitch 後台退款' : '已在 Twitch 後台標記完成';
    this.updateRequestHistory(request, {
      result: imported ? 'imported' : 'canceled',
      reason: imported && !refunded ? '' : reason,
      reward: { status: refunded ? 'refunded' : 'fulfilled' },
    });
    if (typeof this.onSongRequestClosedExternally === 'function') {
      this.onSongRequestClosedExternally({ requestId, status, title: request.title });
    }
    if (!refunded) return;
    try {
      await this.sendConfiguredReply(request.event, 'rewardRefunded', {
        title: request.title, artist: request.author, url: request.url,
        cost: request.rewardRedemption.cost, reason,
      });
    } catch (err) {
      log.warn(`Twitch 兌換已在後台退款，但聊天室通知失敗：${err.message}`);
    }
  },

  async handleRewardRedemption(redemptionEvent, fallbackId) {
    if (await this.runInterceptor(this.redemptionInterceptor, '兌換', redemptionEvent, fallbackId)) return;
    const settings = this.rewardSettings || TwitchRewardSettings.getDefaults();
    const reward = redemptionEvent?.reward || {};
    if (!settings.enabled || settings.paused || !settings.rewardId || String(reward.id || '') !== settings.rewardId) return;
    if (redemptionEvent.status && redemptionEvent.status !== 'unfulfilled' && redemptionEvent.status !== 'UNFULFILLED') return;
    const redemptionId = String(redemptionEvent.id || fallbackId || '');
    if (!redemptionId || this.seenRedemptions.has(redemptionId)) return;
    if ([...this.pendingRequests.values()].some((request) => request.rewardRedemption?.id === redemptionId)) return;

    this.seenRedemptions.set(redemptionId, Date.now());
    const event = {
      chatter_user_id: String(redemptionEvent.user_id || ''),
      chatter_user_login: String(redemptionEvent.user_login || ''),
      chatter_user_name: String(redemptionEvent.user_name || '觀眾'),
      broadcaster_user_id: String(this.auth?.userId || ''),
      message_id: '',
    };
    const redemption = { id: redemptionId, rewardId: settings.rewardId, cost: Number(reward.cost) || settings.cost };
    try {
      if (!this.requestSettings?.enabled) {
        await this.rejectSongRequest({
          event, key: 'requestDisabled', redemption, reason: '目前暫停接受點歌',
          history: this.historyContext({ event, source: 'channel-points', url: String(redemptionEvent.user_input || '').trim(), redemption }),
        });
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
  },

  async rejectSongRequest({ event, key, values = {}, redemption = null, reason = '不符合目前點歌規則', history = null, historyResult = 'rejected' }) {
    if (history) this.recordHistory(this.historyEntryFromContext(history, {
      result: historyResult, reason, rewardStatus: redemption ? 'pending' : 'not-applicable',
    }));
    if (!redemption) return this.sendConfiguredReply(event, key, values);
    try {
      await this.updateRewardRedemptionStatus(redemption, 'CANCELED');
      if (history) this.recordHistory(this.historyEntryFromContext(history, {
        result: historyResult, reason, rewardStatus: 'refunded',
      }));
    } catch (err) {
      if (history) this.recordHistory(this.historyEntryFromContext(history, {
        result: historyResult, reason: `${reason}；退款失敗：${err.message}`, rewardStatus: 'refund-failed',
      }));
      this.refundRetries.set(redemption.id, { redemption, reason, history, historyResult });
      this.refundStore.save([...this.refundRetries.values()]);
      this.scheduleRefundRetry();
      throw err;
    }
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
  },

  scheduleRefundRetry() {
    if (this.closed || this.refundRetryTimer || !this.refundRetries.size) return;
    this.refundRetryTimer = this.timers.setTimeout(() => {
      this.refundRetryTimer = null;
      this.retryRejectedRefunds().catch((error) => log.warn(`Twitch 退款重試失敗：${error.message}`));
    }, 60000);
    this.refundRetryTimer?.unref?.();
  },

  async retryRejectedRefunds() {
    if (this.refundRetryInFlight) return this.refundRetryInFlight;
    this.refundRetryInFlight = (async () => {
      for (const [id, item] of this.refundRetries) {
        if (this.closed) break;
        try {
          const result = await this.updateRewardRedemptionStatus(item.redemption, 'CANCELED');
          if (result?.confirmed === false || (result?.status && result.status !== 'CANCELED')) continue;
          this.refundRetries.delete(id);
          this.refundStore.save([...this.refundRetries.values()]);
          if (item.history) this.recordHistory(this.historyEntryFromContext(item.history, {
            result: item.historyResult || 'rejected', reason: item.reason, rewardStatus: 'refunded',
          }));
        } catch (error) { log.warn(`Twitch 退款將稍後重試：${error.message}`); }
      }
    })();
    try { await this.refundRetryInFlight; }
    finally { this.refundRetryInFlight = null; this.scheduleRefundRetry(); }
  },

  async reconcileRewardRedemptions() {
    if (this.redemptionReconcileInFlight) return this.redemptionReconcileInFlight;
    if (!this.auth || !this.rewardSettings?.enabled || !this.rewardSettings.rewardId || !this.hasScope(REDEMPTION_SCOPE)) return;
    this.redemptionReconcileInFlight = (async () => {
      await this.retryRejectedRefunds();
      const cursors = new Set();
      let cursor = '';
      for (let page = 0; page < 100 && !this.closed; page++) {
        const query = new URLSearchParams({ broadcaster_id: this.auth.userId, reward_id: this.rewardSettings.rewardId,
          status: 'UNFULFILLED', first: '50', sort: 'OLDEST', ...(cursor ? { after: cursor } : {}) });
        const response = await this.helix(`/channel_points/custom_rewards/redemptions?${query}`, { method: 'GET' });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.data)) throw new Error(`Twitch 兌換補查失敗（${response.status}）`);
        for (const event of body.data) {
          if (this.closed) break;
          const id = String(event.id || '');
          if (!id || this.refundRetries.has(id) || this.seenRedemptions.has(id)
            || [...this.pendingRequests.values()].some((request) => request.rewardRedemption?.id === id)) continue;
          const age = Date.now() - Date.parse(event.redeemed_at);
          if (age > REQUEST_TTL_MS) {
            const redemption = { id, rewardId: this.rewardSettings.rewardId, cost: event.reward?.cost || this.rewardSettings.cost };
            try {
              await this.rejectSongRequest({ event: { chatter_user_name: event.user_name, chatter_user_login: event.user_login },
                key: 'requestExpired', redemption, reason: '斷線期間兌換已超過 30 分鐘' });
            } catch (_) { /* refund has been persisted for retry */ }
          } else {
            await this.handleRewardRedemption(event, id);
          }
        }
        const next = body.pagination?.cursor;
        if (!next || cursors.has(next) || body.data.length === 0) break;
        cursors.add(next); cursor = next;
      }
    })();
    try { return await this.redemptionReconcileInFlight; }
    finally { this.redemptionReconcileInFlight = null; }
  },

  async setManagedRewardPaused(paused) {
    if (!this.auth || !this.rewardSettings?.enabled || !this.rewardSettings.rewardId || !this.hasScope(REDEMPTION_SCOPE)) return;
    const query = new URLSearchParams({ broadcaster_id: this.auth.userId, id: this.rewardSettings.rewardId });
    const response = await this.helix(`/channel_points/custom_rewards?${query}`, { method: 'PATCH', body: { is_paused: !!paused } });
    if (!response.ok) throw new Error(`Twitch 獎勵暫停失敗（${response.status}）`);
  },

  async completeSongRequest(payload = {}) {
    const requestId = payload?.requestId;
    if (this.settlingRequests.has(requestId)) throw new Error('這筆點歌正在同步 Twitch 狀態，請稍後重試');
    this.settlingRequests.add(requestId);
    try { return await this._completeSongRequest(payload); }
    finally { this.settlingRequests.delete(requestId); }
  },

  async _completeSongRequest({ requestId, success, title, artist, rejected, retryable, position, queue } = {}) {
    const request = this.pendingRequests.get(requestId);
    // 同步失敗後，即便面板重新啟動或傳來拒絕／下載失敗，也不可倒退為再次下載。
    if (request?.importResult?.success) {
      ({ success, title, artist, position, queue } = request.importResult);
      rejected = false;
      retryable = false;
    }
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
      this.updateRequestHistory(request, { result: 'retrying', reason: '下載或匯入暫時失敗，等待主播重試' });
      log.info(`Twitch 點歌匯入失敗，保留供重試：${requestId}`);
      return;
    }
    if (success && !rejected && !request.importResult) {
      request.importResult = { success: true, title, artist, position, queue };
      this.persistPendingRequests();
      this.notifyPendingRequestsChanged();
    }
    if (success && !rejected && request.challenge && request.source === 'chat' && !request.rewardRedemption) {
      try {
        await this.getPracticeHistoryService().createViewerChallenge({
          trackId: request.videoId,
          title: title || request.title,
          targetScore: request.challenge.targetScore,
          requester: request.requester,
          requestId: request.requestId,
        });
      } catch (err) {
        // A host may close viewer challenges while this request is pending.
        // Practice persistence must not turn an already imported song into a failure.
        log.warn(`Twitch 點歌已匯入，但練唱挑戰未建立：${err.message}`);
      }
    }
    if (request.rewardRedemption) {
      const fulfilled = !!success && !rejected;
      const reason = rejected ? '主播略過了這首歌' : '目前無法完成歌曲匯入';
      let settled;
      try {
        settled = await this.updateRewardRedemptionStatus(request.rewardRedemption, fulfilled ? 'FULFILLED' : 'CANCELED');
        if (!settled) settled = { status: fulfilled ? 'FULFILLED' : 'CANCELED', confirmed: true };
      } catch (err) {
        this.updateRequestHistory(request, {
          result: 'pending', reason: `忠誠點數狀態同步失敗：${err.message}`,
          reward: { status: fulfilled ? 'fulfillment-failed' : 'refund-failed' },
        });
        // 匯入已完成：改成自動重試 Twitch 結算，不能在逾時時退款、也不能重複下載。
        if (request.importResult?.success) {
          request.expiresAt = Date.now() + 60000;
          this.persistPendingRequests();
          this.scheduleRequestExpiry(requestId);
          this.notifyPendingRequestsChanged();
        }
        throw err;
      }
      const matchesIntent = settled.status === (fulfilled ? 'FULFILLED' : 'CANCELED');
      if (matchesIntent) {
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
      } else {
        log.warn(`Twitch 點歌本機結案但兌換狀態不一致：${requestId}；預期 ${fulfilled ? 'FULFILLED' : 'CANCELED'}，實際 ${settled.status}`);
      }
      this.updateRequestHistory(request, {
        result: fulfilled ? 'imported' : (rejected ? 'rejected' : 'failed'),
        reason: matchesIntent ? (fulfilled ? '' : reason) : `Twitch 兌換狀態無法依預期變更（${settled.status}），請主播至 Twitch 核對點數`,
        video: { title: title || request.title, artist: artist || request.author },
        reward: { status: settled.status === 'FULFILLED' ? 'fulfilled'
          : settled.status === 'CANCELED' ? 'refunded'
            : fulfilled ? 'fulfillment-failed' : 'refund-failed' },
      });
      this.pendingRequests.delete(requestId);
      this.clearRequestExpiry(requestId);
      this.persistPendingRequests();
      this.notifyPendingRequestsChanged();
      return { synced: matchesIntent, actualStatus: settled.status };
    }
    try {
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
    } catch (error) { log.warn(`Twitch 點歌已結案，但聊天室通知失敗：${error.message}`); }
    this.updateRequestHistory(request, {
      result: success && !rejected ? 'imported' : (rejected ? 'rejected' : 'failed'),
      reason: rejected ? '主播略過了這首歌' : (success ? '' : '目前無法處理這個連結'),
      video: { title: title || request.title, artist: artist || request.author },
    });
    this.pendingRequests.delete(requestId);
    this.clearRequestExpiry(requestId);
    this.persistPendingRequests();
    this.notifyPendingRequestsChanged();
  },

  pruneRequests() {
    const now = Date.now();
    const cutoff = now - REQUEST_TTL_MS;
    for (const [id, request] of this.pendingRequests) {
      if (request.createdAt < cutoff) {
        this.expireRequest(id, request)
          .catch((err) => log.warn(`Twitch 點歌逾時處理失敗：${err.message}`));
      }
    }
    const cooldownCutoff = now - TwitchRequestSettings.LIMITS.cooldownSeconds * 1000;
    for (const [key, acceptedAt] of this.commandUserCooldowns) {
      if (acceptedAt <= cooldownCutoff) this.commandUserCooldowns.delete(key);
    }
    for (const [key, acceptedAt] of this.commandGlobalCooldowns) {
      if (acceptedAt <= cooldownCutoff) this.commandGlobalCooldowns.delete(key);
    }
    for (const [key, repliedAt] of this.chatReplyUserCooldowns) {
      if (repliedAt <= now - CHAT_REPLY_USER_COOLDOWN_MS) this.chatReplyUserCooldowns.delete(key);
    }
    for (const [redemptionId, seenAt] of this.seenRedemptions) {
      if (seenAt <= now - 24 * 60 * 60 * 1000) this.seenRedemptions.delete(redemptionId);
    }
    this.persistPendingRequests();
  },

  getPendingRequests() {
    const now = Date.now();
    return this.orderedPendingRequests()
      .filter((request) => request.expiresAt > now)
      .map(({ event, ...request }) => request);
  },

  scheduleRequestExpiry(requestId) {
    this.clearRequestExpiry(requestId);
    const request = this.pendingRequests.get(requestId);
    const delay = Math.max(0, Number(request?.expiresAt || Date.now() + REQUEST_TTL_MS) - Date.now());
    const timer = setTimeout(() => this.expireRequest(requestId)
      .catch((err) => log.warn(`Twitch 點歌逾時回覆失敗：${err.message}`)), delay);
    this.requestExpiryTimers.set(requestId, timer);
  },

  clearRequestExpiry(requestId) {
    const timer = this.requestExpiryTimers.get(requestId);
    if (timer) clearTimeout(timer);
    this.requestExpiryTimers.delete(requestId);
  },

  async expireRequest(requestId, request = this.pendingRequests.get(requestId)) {
    if (!request) return;
    // 到期時撞上結算：這次計時器已用掉，要排下一次，否則結算失敗後就沒有自動重試了。
    if (this.settlingRequests.has(requestId)) {
      request.expiresAt = Date.now() + 60000;
      this.persistPendingRequests();
      this.scheduleRequestExpiry(requestId);
      return;
    }
    this.settlingRequests.add(requestId);
    try { return await this._expireRequest(requestId, request); }
    finally { this.settlingRequests.delete(requestId); }
  },

  async _expireRequest(requestId, request) {
    if (request.importResult?.success) {
      return this._completeSongRequest({ requestId, ...request.importResult });
    }
    let settled = null;
    if (request.rewardRedemption) {
      try {
        settled = await this.updateRewardRedemptionStatus(request.rewardRedemption, 'CANCELED');
        if (!settled) settled = { status: 'CANCELED', confirmed: true };
      } catch (err) {
        request.expiresAt = Date.now() + 60000;
        this.persistPendingRequests();
        this.scheduleRequestExpiry(requestId);
        this.updateRequestHistory(request, {
          result: 'pending', reason: `等待逾時退款失敗：${err.message}`,
          reward: { status: 'refund-failed' },
        });
        throw new Error(`忠誠點數逾時退款失敗，60 秒後重試：${err.message}`);
      }
    }
    if (!this.pendingRequests.delete(requestId)) return;
    this.clearRequestExpiry(requestId);
    this.persistPendingRequests();
    this.notifyPendingRequestsChanged();
    const refunded = settled?.status === 'CANCELED';
    this.updateRequestHistory(request, {
      result: 'expired', reason: settled && !refunded
        ? `等待逾時但 Twitch 點數未確認退款（${settled.status}）`
        : '等待主播確認超過 30 分鐘',
      reward: { status: request.rewardRedemption ? (settled?.status === 'FULFILLED' ? 'fulfilled' : refunded ? 'refunded' : 'refund-failed') : 'not-applicable' },
    });
    if (typeof this.onSongRequestExpired === 'function') this.onSongRequestExpired(requestId);
    try {
      await this.sendConfiguredReply(request.event, request.rewardRedemption && refunded ? 'rewardRefunded' : 'requestExpired', {
        title: request.title,
        artist: request.author,
        url: request.url,
        cost: request.rewardRedemption?.cost || '',
        reason: request.rewardRedemption && !refunded ? 'Twitch 點數未確認退款，請主播核對' : (request.rewardRedemption ? '等待主播確認超過 30 分鐘' : ''),
      });
    } catch (err) {
      log.warn(`Twitch 點歌已逾時結案，但聊天室通知失敗：${err.message}`);
    }
  },

  // 最後手段：只移除本機佇列，不宣稱 Twitch 退款成功。
  dismissSongRequestLocally(requestId) {
    if (this.settlingRequests.has(requestId)) throw new Error('點歌正在處理中，請稍後重試');
    const request = this.pendingRequests.get(requestId);
    if (!request) throw new Error('這筆點歌已不存在');
    this.pendingRequests.delete(requestId);
    this.clearRequestExpiry(requestId);
    this.persistPendingRequests();
    this.notifyPendingRequestsChanged();
    this.updateRequestHistory(request, {
      result: request.importResult?.success ? 'imported' : 'canceled',
      reason: '主播手動移除本機點歌；未修改 Twitch 點數，請自行確認兌換狀態',
      reward: { status: request.rewardRedemption ? (request.importResult?.success ? 'fulfillment-failed' : 'refund-failed') : 'not-applicable' },
    });
    if (typeof this.onSongRequestCanceled === 'function') this.onSongRequestCanceled(requestId);
    return { ok: true };
  },
};
