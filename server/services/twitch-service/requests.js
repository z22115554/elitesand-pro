'use strict';

// Methods keep their original receiver and shared dependency instances.
const { crypto, parseYouTubeUrl, isSingleVideoInMix, AudioProcessor, TwitchReplySettings, TwitchRequestSettings, log, REQUEST_TTL_MS, ADMIN_ACTION_TIMEOUT_MS, CHAT_REPLY_USER_COOLDOWN_MS, CHAT_REPLY_GLOBAL_COOLDOWN_MS, HISTORY_MAX_ENTRIES, HISTORY_MAX_AGE_MS, normalizeShortRequestId, safeHistoryText, safeHistoryUrl, wait, toTimestamp, formatDuration, requesterKey, normalizeRequestSessionState } = require('./shared');

module.exports = {
  setReplySettings(settings) {
    this.replySettings = TwitchReplySettings.normalizeSettings(settings);
    return this.replySettings;
  },

  setRequestSettings(settings) {
    this.requestSettings = TwitchRequestSettings.normalizeSettings(settings);
    this.commandUserCooldowns.clear();
    this.commandGlobalCooldowns.clear();
    return this.requestSettings;
  },

  async persistAdminRequestSettings(settings) {
    const validation = TwitchRequestSettings.validateSettings(settings);
    if (!validation.ok) throw new Error(validation.errors[0]?.message || 'Twitch 點歌設定格式無效');
    if (!this.onRequestSettingsChange) throw new Error('目前無法保存管理員變更');
    const previous = this.requestSettings;
    this.setRequestSettings(validation.settings);
    try {
      await this.onRequestSettingsChange(validation.settings);
      this.notifyStatusChange();
      return validation.settings;
    } catch (err) {
      this.setRequestSettings(previous);
      try { await this.onRequestSettingsChange(previous); } catch (_) { /* 原設定已留在記憶體，寫回失敗只記錄原始錯誤 */ }
      throw err;
    }
  },

  notifyPendingRequestsChanged() {
    if (!this.onPendingRequestsChanged) return;
    try { this.onPendingRequestsChanged(this.getPendingRequests()); } catch (err) { log.warn(`Twitch 待確認同步失敗：${err.message}`); }
  },

  notifyHistoryChanged() {
    if (!this.onHistoryChanged) return;
    try { this.onHistoryChanged(this.getRequestHistory(80)); } catch (err) { log.warn(`Twitch 歷史同步失敗：${err.message}`); }
  },

  createShortRequestId() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = crypto.randomBytes(4).toString('hex').slice(0, 6).toLocaleUpperCase();
      if (![...this.pendingRequests.values()].some((request) => request.shortId === candidate)) return candidate;
    }
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toLocaleUpperCase();
  },

  orderedPendingRequests() {
    return [...this.pendingRequests.values()].sort((a, b) => {
      const aPriority = Number.isFinite(Number(a.priority)) ? Number(a.priority) : Number(a.createdAt) || 0;
      const bPriority = Number.isFinite(Number(b.priority)) ? Number(b.priority) : Number(b.createdAt) || 0;
      return aPriority - bPriority || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
  },

  findPendingRequest(target) {
    const query = String(target || '').trim();
    if (!query) return null;
    const shortId = normalizeShortRequestId(query);
    const byId = this.pendingRequests.get(query) || this.orderedPendingRequests()
      .find((request) => normalizeShortRequestId(request.shortId) === shortId);
    if (byId) return byId;
    const user = query.replace(/^@/u, '').toLocaleLowerCase();
    return this.orderedPendingRequests().filter((request) => [
      request.requesterId,
      request.requester,
      request.event?.chatter_user_login,
      request.event?.chatter_user_name,
    ].some((value) => String(value || '').toLocaleLowerCase() === user)).at(-1) || null;
  },

  restoreRequestSession() {
    try { return normalizeRequestSessionState(this.sessionStore.load()); } catch (err) {
      log.warn(`Twitch 點歌場次還原失敗：${err.message}`);
      return normalizeRequestSessionState(null);
    }
  },

  persistRequestSession() {
    const cutoff = Date.now() - TwitchRequestSettings.LIMITS.recentDuplicateHours * 60 * 60 * 1000;
    this.requestSession.recent = this.requestSession.recent.filter((item) => item.acceptedAt > cutoff).slice(-5000);
    this.requestSession.online = this.streamOnline;
    try { this.sessionStore.save(this.requestSession); } catch (err) { log.warn(`Twitch 點歌場次保存失敗：${err.message}`); }
  },

  normalizeHistoryEntry(value) {
    const now = Date.now();
    const createdAt = Number.isFinite(Number(value?.createdAt)) ? Number(value.createdAt) : now;
    const updatedAt = Number.isFinite(Number(value?.updatedAt)) ? Number(value.updatedAt) : createdAt;
    const source = value?.source === 'channel-points' ? 'channel-points' : 'chat';
    const result = ['pending', 'retrying', 'imported', 'rejected', 'failed', 'canceled', 'expired'].includes(value?.result)
      ? value.result : 'failed';
    const rewardStatus = ['not-applicable', 'pending', 'fulfilled', 'refunded', 'refund-failed', 'fulfillment-failed'].includes(value?.reward?.status)
      ? value.reward.status : 'not-applicable';
    return {
      id: /^[A-Za-z0-9_-]{1,80}$/.test(String(value?.id || '')) ? String(value.id) : crypto.randomUUID(),
      requestCode: normalizeShortRequestId(value?.requestCode).slice(0, 8),
      source,
      requester: {
        id: safeHistoryText(value?.requester?.id, 120),
        name: safeHistoryText(value?.requester?.name, 120) || '觀眾',
      },
      video: {
        id: safeHistoryText(value?.video?.id, 120),
        title: safeHistoryText(value?.video?.title, 300),
        artist: safeHistoryText(value?.video?.artist, 200),
        url: safeHistoryUrl(value?.video?.url),
      },
      createdAt,
      updatedAt,
      result,
      reason: safeHistoryText(value?.reason, 300),
      reward: {
        status: rewardStatus,
        cost: Math.max(0, Number(value?.reward?.cost) || 0),
      },
    };
  },

  restoreRequestHistory() {
    try {
      const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
      const loaded = this.historyStore?.load?.();
      const restored = Array.isArray(loaded) ? loaded : [];
      return restored.map((entry) => this.normalizeHistoryEntry(entry))
        .filter((entry) => entry.createdAt >= cutoff)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-HISTORY_MAX_ENTRIES);
    } catch (err) {
      log.warn(`Twitch 點歌歷史還原失敗：${err.message}`);
      return [];
    }
  },

  persistRequestHistory() {
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    this.requestHistory = this.requestHistory.filter((entry) => entry.createdAt >= cutoff).slice(-HISTORY_MAX_ENTRIES);
    try {
      if (this.historyStore?.save?.(this.requestHistory) === false) log.warn('Twitch 點歌歷史保存失敗：資料庫拒絕寫入');
    } catch (err) {
      log.warn(`Twitch 點歌歷史保存失敗：${err.message}`);
    }
  },

  historyContext({ event, source, url, videoId = '', metadata = null, redemption = null, requestCode = '', createdAt = Date.now() } = {}) {
    return {
      id: crypto.randomUUID(), event, source, url, videoId, metadata, redemption, requestCode, createdAt,
    };
  },

  historyEntryFromContext(context, patch = {}) {
    const metadata = context?.metadata || {};
    const redemption = context?.redemption || null;
    return this.normalizeHistoryEntry({
      id: context?.id,
      requestCode: context?.requestCode || '',
      source: context?.source,
      requester: {
        id: context?.event?.chatter_user_id || context?.event?.chatter_user_login || '',
        name: context?.event?.chatter_user_name || context?.event?.chatter_user_login || '觀眾',
      },
      video: {
        id: context?.videoId || '',
        title: metadata.title || '',
        artist: metadata.author || '',
        url: context?.videoId ? `https://youtu.be/${context.videoId}` : '',
      },
      createdAt: context?.createdAt,
      updatedAt: Date.now(),
      result: patch.result || 'pending',
      reason: patch.reason || '',
      reward: { status: patch.rewardStatus || (redemption ? 'pending' : 'not-applicable'), cost: redemption?.cost || 0 },
    });
  },

  historyEntryFromRequest(request, patch = {}) {
    return this.historyEntryFromContext({
      id: request?.historyId,
      event: request?.event,
      source: request?.source,
      url: request?.url,
      videoId: request?.videoId,
      metadata: { title: request?.title, author: request?.author },
      redemption: request?.rewardRedemption,
      requestCode: request?.shortId,
      createdAt: request?.createdAt,
    }, patch);
  },

  recordHistory(entry) {
    const normalized = this.normalizeHistoryEntry(entry);
    const index = this.requestHistory.findIndex((item) => item.id === normalized.id);
    if (index >= 0) this.requestHistory[index] = normalized;
    else this.requestHistory.push(normalized);
    this.persistRequestHistory();
    this.notifyHistoryChanged();
    return normalized;
  },

  updateRequestHistory(request, patch) {
    if (!request?.historyId) return null;
    const existing = this.requestHistory.find((entry) => entry.id === request.historyId);
    const base = existing || this.historyEntryFromRequest(request);
    return this.recordHistory({
      ...base,
      ...patch,
      video: { ...base.video, ...(patch?.video || {}) },
      requester: { ...base.requester, ...(patch?.requester || {}) },
      reward: { ...base.reward, ...(patch?.reward || {}) },
      updatedAt: Date.now(),
    });
  },

  getRequestHistory(limit = 80) {
    const max = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 80));
    return this.requestHistory.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max)
      .map((entry) => this.normalizeHistoryEntry(entry));
  },

  startRequestSession(startedAt = Date.now()) {
    const timestamp = Number(startedAt) || Date.now();
    if (!this.requestSession.session.startedAt || Math.abs(this.requestSession.session.startedAt - timestamp) > 5000) {
      this.requestSession.session = {
        startedAt: timestamp, acceptedCount: 0, byUser: {}, lastRequesterId: '', lastRequesterName: '',
      };
    }
    this.streamOnline = true;
    this.persistRequestSession();
  },

  stopRequestSession() {
    this.streamOnline = false;
    this.persistRequestSession();
  },

  ensureRequestSession() {
    if (!this.requestSession.session.startedAt) this.startRequestSession(Date.now());
  },

  requestFairnessExempt(event) {
    return !!this.requestSettings?.fairnessModeratorExempt && TwitchRequestSettings.rolesForEvent(event).moderator;
  },

  duplicateScopeMatch(videoId) {
    const rules = this.requestSettings || TwitchRequestSettings.getDefaults();
    if (rules.duplicateScope === 'allow') return null;
    if ([...this.pendingRequests.values()].some((request) => request.videoId === videoId)) return '待確認區';
    const snapshot = this.getPlaybackSnapshot() || {};
    const playlist = Array.isArray(snapshot.playlist) ? snapshot.playlist : [];
    if (['playlist', 'session', 'recent'].includes(rules.duplicateScope) && playlist.some((track) => track?.id === videoId)) return '正式播放清單';
    const songs = Array.isArray(snapshot.session?.songs) ? snapshot.session.songs : [];
    if (rules.duplicateScope === 'session' && songs.some((track) => track?.id === videoId)) return '本場已唱';
    if (rules.duplicateScope === 'recent') {
      const cutoff = Date.now() - rules.recentDuplicateHours * 60 * 60 * 1000;
      if (this.requestSession.recent.some((item) => item.videoId === videoId && item.acceptedAt > cutoff)) return `最近 ${rules.recentDuplicateHours} 小時`;
    }
    return null;
  },

  recordAcceptedRequest(event, videoId) {
    this.ensureRequestSession();
    const userKey = requesterKey(event);
    const consecutive = !!userKey && this.requestSession.session.lastRequesterId === userKey;
    this.requestSession.session.acceptedCount += 1;
    if (userKey) this.requestSession.session.byUser[userKey] = (this.requestSession.session.byUser[userKey] || 0) + 1;
    this.requestSession.session.lastRequesterId = userKey;
    this.requestSession.session.lastRequesterName = String(event?.chatter_user_name || event?.chatter_user_login || '觀眾');
    this.requestSession.recent.push({
      videoId,
      requesterId: userKey,
      requesterName: this.requestSession.session.lastRequesterName,
      acceptedAt: Date.now(),
      sessionStartedAt: this.requestSession.session.startedAt,
    });
    this.persistRequestSession();
    return consecutive;
  },

  async refreshLiveState() {
    if (!this.auth?.userId) return this.streamOnline;
    const response = await this.helix(`/streams?user_id=${encodeURIComponent(this.auth.userId)}`);
    if (!response.ok) throw new Error(`Twitch 開台狀態確認失敗（${response.status}）`);
    const data = await response.json().catch(() => ({}));
    const stream = Array.isArray(data.data) ? data.data[0] : null;
    // 這是「權威對帳」：EventSub 期間漏收的 stream.online / stream.offline
    // （下播時 app 沒開、EventSub 斷線重連、token 過期）都要在這裡把歌單 session
    //  拉回跟 Twitch 實際狀態一致，否則「開台中」會永久卡住、把面板的
    // 「清除歌單 / 開始新場次」鎖死。startTwitchSession 對同一場是 idempotent，
    //  不會清空已唱歌單；沒有 message id 傳 eventId:null 讓它照常執行。
    if (stream) {
      const startedAt = toTimestamp(stream.started_at);
      this.startRequestSession(startedAt);
      try { this.onStreamOnline?.({ startedAt, eventId: null }); } catch (err) {
        log.warn(`refreshLiveState 同步開台狀態到歌單 session 失敗：${err.message}`);
      }
    } else {
      this.stopRequestSession();
      try { this.onStreamOffline?.({ eventId: null }); } catch (err) {
        log.warn(`refreshLiveState 同步下播狀態到歌單 session 失敗：${err.message}`);
      }
    }
    return this.streamOnline;
  },

  serializePendingRequest(request) {
    return {
      requestId: String(request.requestId || ''),
      shortId: normalizeShortRequestId(request.shortId),
      historyId: /^[A-Za-z0-9_-]{1,80}$/.test(String(request.historyId || '')) ? String(request.historyId) : '',
      url: String(request.url || ''),
      requester: String(request.requester || '觀眾'),
      requesterId: String(request.requesterId || ''),
      source: request.source === 'channel-points' ? 'channel-points' : 'chat',
      challenge: request.source !== 'channel-points' && typeof request.challenge?.targetScore === 'number'
        && Number.isFinite(request.challenge.targetScore) && request.challenge.targetScore >= 0 && request.challenge.targetScore <= 100
        ? { targetScore: request.challenge.targetScore } : null,
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
        channelId: String(request.assessment.channelId || '').slice(0, 120),
        thumbnail: String(request.assessment.thumbnail || '').slice(0, 500),
        categories: Array.isArray(request.assessment.categories) ? request.assessment.categories.map(value => String(value).slice(0, 100)).slice(0, 5) : [],
      } : null,
      createdAt: Number(request.createdAt) || Date.now(),
      priority: Number.isFinite(Number(request.priority)) ? Number(request.priority) : (Number(request.createdAt) || Date.now()),
      expiresAt: Number(request.expiresAt) || Date.now() + REQUEST_TTL_MS,
      event: {
        chatter_user_name: String(request.event?.chatter_user_name || ''),
        chatter_user_login: String(request.event?.chatter_user_login || ''),
        message_id: String(request.event?.message_id || ''),
      },
      retryableReplySent: !!request.retryableReplySent,
      // 歌曲已匯入時先落盤：Twitch API 失敗或重開後只能重試結算，不可再下載歌曲。
      importResult: request.importResult?.success === true ? {
        success: true,
        title: String(request.importResult.title || '').slice(0, 300),
        artist: String(request.importResult.artist || '').slice(0, 200),
        position: String(request.importResult.position || '').slice(0, 80),
        queue: String(request.importResult.queue || '').slice(0, 80),
      } : null,
    };
  },

  persistPendingRequests() {
    try {
      this.pendingStore.save([...this.pendingRequests.values()].map(request => this.serializePendingRequest(request)));
    } catch (err) {
      log.warn(`Twitch 待確認點歌保存失敗：${err.message}`);
    }
  },

  restorePendingRequests() {
    let restored = [];
    try { restored = this.pendingStore.load() || []; } catch (err) {
      log.warn(`Twitch 待確認點歌還原失敗：${err.message}`);
    }
    for (const raw of restored) {
      const request = this.serializePendingRequest(raw || {});
      if (!request.requestId || !request.videoId) continue;
      if (!request.shortId) request.shortId = this.createShortRequestId();
      if (!request.historyId) request.historyId = crypto.randomUUID();
      this.pendingRequests.set(request.requestId, request);
      if (request.rewardRedemption?.id) this.seenRedemptions.set(request.rewardRedemption.id, request.createdAt);
      this.scheduleRequestExpiry(request.requestId);
    }
    const missingHistory = [...this.pendingRequests.values()]
      .filter((request) => !this.requestHistory.some((entry) => entry.id === request.historyId))
      .map((request) => this.historyEntryFromRequest(request, {
        result: 'pending',
        rewardStatus: request.rewardRedemption ? 'pending' : 'not-applicable',
      }));
    if (missingHistory.length) {
      this.requestHistory.push(...missingHistory);
      this.persistRequestHistory();
    }
    this.persistPendingRequests();
    if (this.pendingRequests.size) log.info(`已還原 ${this.pendingRequests.size} 筆 Twitch 待確認點歌`);
  },

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
        channelId: String(assessment.channelId || '').slice(0, 120),
        thumbnail: assessment.thumbnail || '',
        duration: Number(assessment.duration) || 0,
        metadataAvailable: !!assessment.title,
        assessment,
      };
    } catch (err) {
      log.warn(`YouTube 點歌資訊讀取失敗：${err.message}`);
      return fallback;
    }
  },

  commandCooldown(commandKey, commandSettings, event) {
    const now = Date.now();
    const globalAcceptedAt = this.commandGlobalCooldowns.get(commandKey) || 0;
    const globalRemaining = Math.ceil(((commandSettings.globalCooldownSeconds * 1000) - (now - globalAcceptedAt)) / 1000);
    if (commandSettings.globalCooldownSeconds > 0 && globalRemaining > 0) return globalRemaining;
    const userKey = requesterKey(event);
    const userAcceptedAt = this.commandUserCooldowns.get(`${commandKey}:${userKey}`) || 0;
    const userRemaining = Math.ceil(((commandSettings.userCooldownSeconds * 1000) - (now - userAcceptedAt)) / 1000);
    if (userKey && commandSettings.userCooldownSeconds > 0 && userRemaining > 0) return userRemaining;
    return 0;
  },

  recordCommandCooldown(commandKey, commandSettings, event) {
    const now = Date.now();
    if (commandSettings.globalCooldownSeconds > 0) this.commandGlobalCooldowns.set(commandKey, now);
    const userKey = requesterKey(event);
    if (userKey && commandSettings.userCooldownSeconds > 0) this.commandUserCooldowns.set(`${commandKey}:${userKey}`, now);
  },

  async sendCommandReply(event, replyKey, values = {}) {
    const now = Date.now();
    const userKey = requesterKey(event);
    if (!userKey) return this.sendConfiguredReply(event, replyKey, values);
    const lastForUser = userKey ? this.chatReplyUserCooldowns.get(userKey) || 0 : 0;
    if (now - this.lastChatReplyAt < CHAT_REPLY_GLOBAL_COOLDOWN_MS
      || (userKey && now - lastForUser < CHAT_REPLY_USER_COOLDOWN_MS)) {
      return { sent: false, skipped: true, throttled: true };
    }
    this.lastChatReplyAt = now;
    if (userKey) this.chatReplyUserCooldowns.set(userKey, now);
    return this.sendConfiguredReply(event, replyKey, values);
  },

  playbackSummary() {
    const snapshot = this.getPlaybackSnapshot() || {};
    const playlist = Array.isArray(snapshot.playlist) ? snapshot.playlist.filter(Boolean) : [];
    const current = snapshot.currentTrack || null;
    // 用清單那一列的 entryId 找位置：同一首歌在清單裡出現兩次（觀眾重複點）時，用歌曲 id 只會
    // 找到第一次出現的那列，「下一首」就回錯。單曲模式唱完後目前歌曲會清空，這時面板按「下一首」
    // 是從剛唱完的那列往後（lastPlayedEntryId），不是清單第一首（那首多半早就唱過了）。
    const indexOfEntry = (entryId) => (entryId ? playlist.findIndex((track) => track?.entryId === entryId) : -1);
    let currentIndex = current ? indexOfEntry(current.entryId) : -1;
    if (currentIndex < 0 && current?.id) currentIndex = playlist.findIndex((track) => track?.id === current.id);
    const cursor = currentIndex >= 0 ? currentIndex : (current ? -1 : indexOfEntry(snapshot.lastPlayedEntryId));
    const next = cursor >= 0 ? (playlist[cursor + 1] || null) : (playlist[0] || null);
    const queuedCount = cursor >= 0 ? Math.max(0, playlist.length - cursor - 1) : playlist.length;
    return { current, next, playlist, queuedCount };
  },

  pendingForUser(event) {
    const userKey = requesterKey(event);
    if (!userKey) return [];
    return this.orderedPendingRequests()
      .filter((request) => request.requesterId === userKey && request.expiresAt > Date.now());
  },

  requestRulesSummary() {
    const rules = this.requestSettings || TwitchRequestSettings.getDefaults();
    const requestCommand = rules.commands.request;
    const permission = TwitchRequestSettings.PERMISSION_LEVELS.find((level) => level.key === requestCommand.permissionLevel)?.label || '所有觀眾';
    const details = [
      rules.enabled ? '目前開放' : '目前暫停',
      permission,
      rules.perUserPending > 0 ? `每人最多 ${rules.perUserPending} 首待確認` : '每人待確認不限首數',
      rules.maxDurationMinutes > 0 ? `最長 ${rules.maxDurationMinutes} 分鐘` : '歌曲長度不限',
      rules.duplicateScope === 'allow'
        ? '允許重複歌曲'
        : `重複檢查：${TwitchRequestSettings.DUPLICATE_SCOPES.find((item) => item.key === rules.duplicateScope)?.label || '待確認區'}`,
      rules.liveOnly ? '只在直播中接受' : '離線時也接受',
      rules.perUserSessionLimit > 0 ? `每人每場最多 ${rules.perUserSessionLimit} 首` : '每人每場不限首數',
      rules.sessionRequestLimit > 0 ? `全場最多 ${rules.sessionRequestLimit} 首` : '全場不限首數',
    ];
    return details.join('；');
  },

  async handleSelfServiceCommand(commandKey, event) {
    const { current, next, queuedCount } = this.playbackSummary();
    if (commandKey === 'currentSong') {
      await this.sendConfiguredReply(event, current ? 'currentSong' : 'noCurrentSong', {
        currentTitle: current?.title || '', currentArtist: current?.artist || '',
      });
    } else if (commandKey === 'nextSong') {
      await this.sendConfiguredReply(event, next ? 'nextSong' : 'noNextSong', {
        nextTitle: next?.title || '', nextArtist: next?.artist || '',
      });
    } else if (commandKey === 'myRequests') {
      const requests = this.pendingForUser(event);
      await this.sendConfiguredReply(event, requests.length ? 'myRequests' : 'noMyRequests', {
        requestCount: requests.length,
        title: requests.slice(0, 3).map((request, index) => `${index + 1}. ${request.title || '未命名歌曲'}`).join('；'),
      });
    } else if (commandKey === 'position') {
      const own = this.pendingForUser(event).at(-1);
      const ordered = this.orderedPendingRequests().filter((request) => request.expiresAt > Date.now());
      await this.sendConfiguredReply(event, own ? 'requestPosition' : 'requestNotFound', {
        title: own?.title || '', position: own ? ordered.findIndex((request) => request.requestId === own.requestId) + 1 : '',
      });
    } else if (commandKey === 'cancelRequest') {
      await this.cancelLatestPendingRequest(event);
    } else if (commandKey === 'rules') {
      await this.sendConfiguredReply(event, 'requestRules', {
        command: TwitchRequestSettings.getCommand(this.requestSettings, 'request')?.command || '!點歌',
        reason: this.requestRulesSummary(),
      });
    } else if (commandKey === 'queueSummary') {
      await this.sendConfiguredReply(event, 'queueSummary', {
        currentTitle: current?.title || '無', currentArtist: current?.artist || '',
        nextTitle: next?.title || '無', nextArtist: next?.artist || '',
        queue: queuedCount,
      });
    }
  },

  async promotePendingRequest(request) {
    const first = this.orderedPendingRequests()[0];
    const firstPriority = Number.isFinite(Number(first?.priority)) ? Number(first.priority) : Number(first?.createdAt) || Date.now();
    request.priority = first && first.requestId !== request.requestId ? firstPriority - 1 : firstPriority;
    this.persistPendingRequests();
    this.notifyPendingRequestsChanged();
    return request;
  },

  async requestPanelSkip(event) {
    if (!this.onPanelAction) {
      await this.sendConfiguredReply(event, 'adminPanelUnavailable');
      return;
    }
    const actionId = crypto.randomUUID();
    const targetSocketId = this.onPanelAction({ actionId, type: 'skip' });
    if (!targetSocketId) {
      await this.sendConfiguredReply(event, 'adminPanelUnavailable');
      return;
    }
    const timer = setTimeout(() => {
      this.completeAdminPanelAction({ actionId, ok: false, error: '桌面面板沒有回報操作結果' })
        .catch((err) => log.warn(`Twitch 管理員略過歌曲逾時回覆失敗：${err.message}`));
    }, ADMIN_ACTION_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    this.adminPanelActions.set(actionId, { event, timer, targetSocketId });
  },

  async completeAdminPanelAction({ actionId, ok, error, socketId } = {}) {
    const action = this.adminPanelActions.get(String(actionId || ''));
    if (!action) return false;
    if (action.targetSocketId && action.targetSocketId !== socketId) return false;
    this.adminPanelActions.delete(String(actionId || ''));
    if (action.timer) clearTimeout(action.timer);
    if (ok) {
      await this.sendConfiguredReply(action.event, 'adminSkipped');
    } else {
      await this.sendConfiguredReply(action.event, 'adminActionFailed', {
        reason: String(error || '桌面面板沒有完成操作').slice(0, 240),
      });
    }
    return true;
  },

  async handleAdminCommand(commandKey, event, argument) {
    const target = String(argument || '').trim();
    if (commandKey === 'adminOpen') {
      await this.persistAdminRequestSettings({ ...this.requestSettings, enabled: true });
      await this.sendConfiguredReply(event, 'adminRequestOpened');
      return;
    }
    if (commandKey === 'adminPause') {
      await this.persistAdminRequestSettings({ ...this.requestSettings, enabled: false });
      await this.sendConfiguredReply(event, 'adminRequestPaused');
      return;
    }
    if (commandKey === 'adminSkip') {
      await this.requestPanelSkip(event);
      return;
    }
    const request = this.findPendingRequest(target);
    if (!request) {
      await this.sendConfiguredReply(event, 'adminTargetNotFound', { requestId: normalizeShortRequestId(target) || '—' });
      return;
    }
    if (commandKey === 'adminPromote') {
      await this.promotePendingRequest(request);
      await this.sendConfiguredReply(event, 'adminRequestPromoted', {
        requestId: request.shortId, title: request.title, artist: request.author,
      });
      return;
    }
    const replyKey = commandKey === 'adminReject' ? 'adminRequestRejected' : 'adminRequestRemoved';
    await this.completeSongRequest({ requestId: request.requestId, success: false, rejected: true });
    await this.sendConfiguredReply(event, replyKey, {
      requestId: request.shortId, title: request.title, artist: request.author,
    });
  },

  customCommandValues(event, command) {
    const playback = this.playbackSummary();
    return {
      user: event?.chatter_user_name || event?.chatter_user_login || '觀眾',
      currentTitle: playback.current?.title || '目前沒有歌曲',
      currentArtist: playback.current?.artist || '',
      nextTitle: playback.next?.title || '目前沒有下一首',
      queue: String(playback.queuedCount || 0),
      requestCount: String(this.getPendingRequests().length),
      command: command || '',
    };
  },

  async handleCustomCommand(match, event) {
    const replySettings = this.replySettings || TwitchReplySettings.getDefaults();
    if (!replySettings.enabled) return { sent: false, skipped: true };
    const text = TwitchReplySettings.renderTemplate(match.customCommand.template, this.customCommandValues(event, match.command));
    if (!text) return { sent: false, skipped: true };
    await this.sendChatReply(event, text, { mode: replySettings.replyMode });
    return { sent: true, skipped: false, text };
  },

  async sendCustomCommandTest(requestSettings, customCommandId) {
    const validation = TwitchRequestSettings.validateSettings(requestSettings);
    if (!validation.ok) throw new Error(validation.errors[0]?.message || '自訂指令設定格式無效');
    const command = validation.settings.customCommands.find((item) => item.id === String(customCommandId || ''));
    if (!command) throw new Error('找不到要測試的自訂指令');
    const text = TwitchReplySettings.renderTemplate(command.template, {
      ...this.customCommandValues({}, command.command),
      ...TwitchReplySettings.sampleValues(),
      command: command.command,
    });
    const message = `【自訂指令測試】${text}`;
    await this.sendChatReply({}, message, { mode: 'plain' });
    return { commandId: command.id, text: message };
  },

  simulateSongRequest(input = {}) {
    const rules = this.requestSettings || TwitchRequestSettings.getDefaults();
    const role = ['viewer', 'subscriber', 'vip', 'moderator', 'broadcaster'].includes(input.viewerRole) ? input.viewerRole : 'viewer';
    const viewerName = safeHistoryText(input.user || '測試觀眾', 40) || '測試觀眾';
    const badges = role === 'subscriber' ? [{ set_id: 'subscriber' }]
      : role === 'vip' ? [{ set_id: 'vip' }]
        : role === 'moderator' ? [{ set_id: 'moderator' }]
          : role === 'broadcaster' ? [{ set_id: 'broadcaster' }] : [];
    const event = {
      chatter_user_id: role === 'broadcaster' ? 'sim-broadcaster' : `sim-${role}`,
      chatter_user_login: viewerName.toLocaleLowerCase().replace(/\s+/g, '-'),
      chatter_user_name: viewerName,
      broadcaster_user_id: role === 'broadcaster' ? 'sim-broadcaster' : 'sim-broadcaster',
      badges,
    };
    const checks = [];
    const reject = (replyKey, reason) => ({
      accepted: false,
      replyKey,
      reason,
      checks,
    });
    const check = (label, passed, detail) => checks.push({ label, passed: !!passed, detail: safeHistoryText(detail, 180) });
    const command = rules.commands.request;
    const url = safeHistoryText(input.url, 600);
    const parsedUrl = parseYouTubeUrl(url);
    const metadata = {
      title: safeHistoryText(input.title || '模擬歌曲', 300),
      author: safeHistoryText(input.artist || '模擬歌手', 200),
      channelId: safeHistoryText(input.channelId || '', 120),
      duration: Math.max(0, Number(input.durationSeconds) || 0),
    };
    const baseValues = {
      user: viewerName,
      command: command.command,
      title: metadata.title,
      artist: metadata.author,
      url,
      limit: '',
      duration: metadata.duration ? formatDuration(metadata.duration) : '',
      reason: '',
      currentTitle: this.playbackSummary().current?.title || '',
      currentArtist: this.playbackSummary().current?.artist || '',
      nextTitle: this.playbackSummary().next?.title || '',
      queue: String(this.playbackSummary().queuedCount || 0),
      requestCount: String(Number(input.pendingCount) || 0),
    };
    const withReply = (outcome) => {
      const reply = (this.replySettings || TwitchReplySettings.getDefaults()).replies?.[outcome.replyKey];
      const repliesEnabled = !!(this.replySettings || TwitchReplySettings.getDefaults()).enabled && !!reply?.enabled;
      const text = repliesEnabled ? TwitchReplySettings.renderTemplate(reply.template, { ...baseValues, reason: outcome.reason, limit: outcome.limit || '' }) : '';
      return {
        ...outcome,
        finalReply: text || '（自動回覆目前關閉）',
        willReply: !!text,
      };
    };
    const permission = TwitchRequestSettings.permissionAllows(event, command.permissionLevel);
    check('使用者資格', permission, permission ? '符合點歌資格' : '不符合目前點歌資格');
    if (!permission) return withReply(reject('permissionDenied', '使用者資格不符'));
    check('點歌總開關', rules.enabled, rules.enabled ? '目前開放' : '目前暫停');
    if (!rules.enabled) return withReply(reject('requestDisabled', '目前暫停接受點歌'));
    // 從 YouTube 自動合輯（list=RD…）點進來的單曲網址仍是單曲，不算播放清單。
    const playlistLink = !!parsedUrl?.playlistId && !isSingleVideoInMix(parsedUrl);
    check('YouTube 單曲網址', !!parsedUrl?.videoId && !playlistLink, playlistLink ? '偵測到播放清單網址' : (parsedUrl?.videoId ? '影片 ID 有效' : '網址無效'));
    if (!parsedUrl?.videoId) return withReply(reject('invalidLink', '沒有提供有效的 YouTube 單曲連結'));
    if (playlistLink) return withReply(reject('playlistNotAllowed', '播放清單連結不屬於單曲點歌'));
    const preBlock = TwitchRequestSettings.findBlacklistMatch(rules, { event, videoId: parsedUrl.videoId, phase: 'pre' });
    check('前置黑名單', !preBlock, preBlock?.reason || (preBlock ? '命中黑名單' : '未命中'));
    if (preBlock) return withReply(reject('blockedRequest', preBlock.reason || '這位使用者或影片已被點歌規則封鎖'));
    const simulatedOnline = typeof input.streamOnline === 'boolean' ? input.streamOnline : this.streamOnline;
    check('直播狀態', !rules.liveOnly || simulatedOnline, rules.liveOnly ? (simulatedOnline ? '模擬直播中' : '模擬未開台') : '規則不限制直播狀態');
    if (rules.liveOnly && !simulatedOnline) return withReply(reject('streamOffline', '目前只在直播期間接受點歌'));
    const fairnessExempt = rules.fairnessModeratorExempt && TwitchRequestSettings.rolesForEvent(event).moderator;
    const sessionUserCount = Math.max(0, Number(input.sessionUserCount) || 0);
    const sessionCount = Math.max(0, Number(input.sessionCount) || 0);
    check('每人每場上限', fairnessExempt || rules.perUserSessionLimit === 0 || sessionUserCount < rules.perUserSessionLimit, fairnessExempt ? '管理員豁免' : (rules.perUserSessionLimit ? `${sessionUserCount}/${rules.perUserSessionLimit}` : '不限'));
    if (!fairnessExempt && rules.perUserSessionLimit > 0 && sessionUserCount >= rules.perUserSessionLimit) return withReply({ ...reject('sessionUserLimit', '本場個人點歌已達上限'), limit: String(rules.perUserSessionLimit) });
    check('全場點歌上限', fairnessExempt || rules.sessionRequestLimit === 0 || sessionCount < rules.sessionRequestLimit, fairnessExempt ? '管理員豁免' : (rules.sessionRequestLimit ? `${sessionCount}/${rules.sessionRequestLimit}` : '不限'));
    if (!fairnessExempt && rules.sessionRequestLimit > 0 && sessionCount >= rules.sessionRequestLimit) return withReply({ ...reject('sessionLimit', '本場點歌已達總上限'), limit: String(rules.sessionRequestLimit) });
    const duplicateFlags = {
      pending: !!input.pendingDuplicate,
      playlist: !!input.playlistDuplicate,
      session: !!input.sessionDuplicate,
      recent: !!input.recentDuplicate,
    };
    const duplicate = rules.duplicateScope !== 'allow' && duplicateFlags[rules.duplicateScope];
    check('重複歌曲範圍', !duplicate, rules.duplicateScope === 'allow' ? '規則允許重複' : (duplicate ? '模擬來源已有同一首歌' : '模擬來源沒有同一首歌'));
    if (duplicate) return withReply(reject('duplicatePending', '同一首歌已在模擬的重複檢查範圍內'));
    const pendingCount = Math.max(0, Number(input.pendingCount) || 0);
    const userPendingCount = Math.max(0, Number(input.userPendingCount) || 0);
    check('待確認總上限', pendingCount < rules.maxPending, `${pendingCount}/${rules.maxPending}`);
    if (pendingCount >= rules.maxPending) return withReply({ ...reject('queueFull', '待確認點歌已達總上限'), limit: String(rules.maxPending) });
    check('每人待確認上限', rules.perUserPending === 0 || userPendingCount < rules.perUserPending, rules.perUserPending ? `${userPendingCount}/${rules.perUserPending}` : '不限');
    if (rules.perUserPending > 0 && userPendingCount >= rules.perUserPending) return withReply({ ...reject('userLimitReached', '你目前的待確認點歌已達上限'), limit: String(rules.perUserPending) });
    const postBlock = TwitchRequestSettings.findBlacklistMatch(rules, { event, videoId: parsedUrl.videoId, metadata, phase: 'post' });
    check('影片資料黑名單', !postBlock, postBlock?.reason || (postBlock ? '命中黑名單' : '未命中'));
    if (postBlock) return withReply(reject('blockedRequest', postBlock.reason || '這個 YouTube 頻道或影片標題已被點歌規則封鎖'));
    check('歌曲長度', rules.maxDurationMinutes === 0 || metadata.duration <= rules.maxDurationMinutes * 60, rules.maxDurationMinutes ? `${formatDuration(metadata.duration)}/${rules.maxDurationMinutes}:00` : '不限');
    if (rules.maxDurationMinutes > 0 && metadata.duration > rules.maxDurationMinutes * 60) return withReply({ ...reject('durationExceeded', `歌曲超過 ${rules.maxDurationMinutes} 分鐘限制`), limit: String(rules.maxDurationMinutes) });
    return withReply({ accepted: true, replyKey: 'received', reason: '', checks });
  },

  async handleChatMessage(event, fallbackId) {
    if (await this.runInterceptor(this.chatInterceptor, '聊天', event)) return;
    const text = String(event.message && event.message.text || '').trim();
    const rules = this.requestSettings || TwitchRequestSettings.getDefaults();
    // 全形「！挑戰」同樣要認得（指令比對在 matchCommand 裡做 NFKC，這裡也一致）
    const challengeCommand = text.normalize('NFKC').match(/^!(?:挑戰|challenge)(?:\s+([\s\S]*))?$/iu);
    let input = text;
    if (challengeCommand) {
      try {
        if (this.getPracticeHistoryService().getSettings().viewerRequestsEnabled !== true) return;
      } catch (err) {
        log.warn(`Twitch 練唱挑戰設定讀取失敗：${err.message}`);
        return;
      }
      // Resolve the configured request command so enabled/permissions/cooldowns
      // and every existing request rule remain shared with ordinary song requests.
      const requestCommand = TwitchRequestSettings.getCommand(rules, 'request');
      if (!requestCommand?.enabled) return;
      input = `${requestCommand.command} ${challengeCommand[1] || ''}`.trim();
    }
    const match = TwitchRequestSettings.matchCommand(input, rules);
    if (!match || (challengeCommand && match.key !== 'request')) return;
    const command = match.command;
    const commandSettings = match.settings;
    const cooldownKey = match.kind === 'custom' ? `custom:${match.key}` : match.key;
    const fairnessExempt = match.key === 'request' && this.requestFairnessExempt(event);
    const earlyCooldown = fairnessExempt ? 0 : this.commandCooldown(cooldownKey, commandSettings, event);
    if (earlyCooldown > 0) {
      await this.sendCommandReply(event, 'cooldownActive', { command, seconds: earlyCooldown });
      return;
    }
    if (!TwitchRequestSettings.permissionAllows(event, commandSettings.permissionLevel)
      || (match.definition?.adminOnly && !TwitchRequestSettings.rolesForEvent(event).moderator)) {
      if (!fairnessExempt) this.recordCommandCooldown(cooldownKey, commandSettings, event);
      await this.sendCommandReply(event, 'permissionDenied', { command });
      return;
    }
    if (match.definition?.adminOnly) {
      const remainingSeconds = this.commandCooldown(match.key, commandSettings, event);
      if (remainingSeconds > 0) {
        await this.sendConfiguredReply(event, 'cooldownActive', { command, seconds: remainingSeconds });
        return;
      }
      try {
        await this.handleAdminCommand(match.key, event, match.argument);
        this.recordCommandCooldown(match.key, commandSettings, event);
      } catch (err) {
        log.warn(`Twitch 管理員指令失敗（${match.key}）：${err.message}`);
        await this.sendConfiguredReply(event, 'adminActionFailed', { reason: String(err.message || '未知錯誤').slice(0, 240) });
      }
      return;
    }
    if (match.kind === 'custom') {
      const remainingSeconds = this.commandCooldown(`custom:${match.key}`, commandSettings, event);
      if (remainingSeconds > 0) {
        await this.sendConfiguredReply(event, 'cooldownActive', { command, seconds: remainingSeconds });
        return;
      }
      try {
        await this.handleCustomCommand(match, event);
        this.recordCommandCooldown(`custom:${match.key}`, commandSettings, event);
      } catch (err) {
        log.warn(`Twitch 自訂指令失敗（${match.key}）：${err.message}`);
      }
      return;
    }
    if (match.key !== 'request') {
      await this.handleSelfServiceCommand(match.key, event);
      this.recordCommandCooldown(match.key, commandSettings, event);
      return;
    }
    if (!rules.enabled) {
      if (!fairnessExempt) this.recordCommandCooldown(match.key, commandSettings, event);
      await this.sendCommandReply(event, 'requestDisabled', { command });
      return;
    }
    const requestId = event.message_id || fallbackId || crypto.randomUUID();
    let url = String(match.argument || '').trim();
    let challenge = null;
    if (challengeCommand) {
      const argument = url.match(/^(\d+(?:\.\d+)?)\s+(\S+)$/u);
      const targetScore = argument ? Number(argument[1]) : NaN;
      if (!Number.isFinite(targetScore) || targetScore < 0 || targetScore > 100) {
        if (!fairnessExempt) this.recordCommandCooldown(match.key, commandSettings, event);
        await this.rejectSongRequest({ event, key: 'invalidLink', values: { command },
          reason: '挑戰格式：!挑戰 0～100 的目標分數 YouTube 單曲連結' });
        return;
      }
      url = argument[2];
      challenge = { targetScore };
    }
    await this.handleSongRequestInput({ event, requestId, url, command, source: 'chat', challenge });
    if (!fairnessExempt) this.recordCommandCooldown(match.key, commandSettings, event);
  },

  async handleSongRequestInput({ event, requestId, url, command, source, redemption = null, challenge = null }) {
    const rules = this.requestSettings || TwitchRequestSettings.getDefaults();
    const history = this.historyContext({ event, source, url, redemption });
    const parsedUrl = parseYouTubeUrl(url);
    history.videoId = parsedUrl?.videoId || '';
    if (!parsedUrl?.videoId) {
      await this.rejectSongRequest({ event, key: 'invalidLink', values: { command }, redemption, reason: '沒有提供有效的 YouTube 單曲連結', history });
      return false;
    }
    if (parsedUrl.playlistId && !isSingleVideoInMix(parsedUrl)) {
      await this.rejectSongRequest({ event, key: 'playlistNotAllowed', values: { url }, redemption, reason: '播放清單連結不屬於單曲點歌', history });
      return false;
    }
    // 觀眾從 YouTube 自動合輯（list=RD…&start_radio=1）複製的單曲網址：只留影片本身，
    // 後面查資料、記錄、匯入都不帶那串合輯參數。
    if (parsedUrl.playlistId) url = `https://www.youtube.com/watch?v=${parsedUrl.videoId}`;
    const preMetadataBlock = TwitchRequestSettings.findBlacklistMatch(rules, {
      event, videoId: parsedUrl.videoId, phase: 'pre',
    });
    if (preMetadataBlock) {
      const reason = preMetadataBlock.reason || '這位使用者或影片已被點歌規則封鎖';
      await this.rejectSongRequest({ event, key: 'blockedRequest', values: { url, reason }, redemption, reason, history });
      return false;
    }
    const fairnessExempt = this.requestFairnessExempt(event);
    if (!fairnessExempt && rules.liveOnly && !this.streamOnline) {
      await this.rejectSongRequest({ event, key: 'streamOffline', values: { url }, redemption, reason: '目前只在直播期間接受點歌', history });
      return false;
    }
    const userKey = requesterKey(event);
    if (!fairnessExempt && rules.perUserSessionLimit > 0 && (this.requestSession.session.byUser[userKey] || 0) >= rules.perUserSessionLimit) {
      await this.rejectSongRequest({ event, key: 'sessionUserLimit', values: { url, limit: rules.perUserSessionLimit }, redemption, reason: '本場個人點歌已達上限', history });
      return false;
    }
    if (!fairnessExempt && rules.sessionRequestLimit > 0 && this.requestSession.session.acceptedCount >= rules.sessionRequestLimit) {
      await this.rejectSongRequest({ event, key: 'sessionLimit', values: { url, limit: rules.sessionRequestLimit }, redemption, reason: '本場點歌已達總上限', history });
      return false;
    }
    if (!fairnessExempt) {
      const duplicateAt = this.duplicateScopeMatch(parsedUrl.videoId);
      if (duplicateAt) {
        await this.rejectSongRequest({ event, key: 'duplicatePending', values: { url, reason: duplicateAt }, redemption, reason: `同一首歌已在${duplicateAt}`, history });
        return false;
      }
    }
    if (this.pendingRequests.size >= rules.maxPending) {
      await this.rejectSongRequest({ event, key: 'queueFull', values: { url, limit: rules.maxPending }, redemption, reason: '待確認點歌已達總上限', history });
      return false;
    }
    if (userKey && rules.perUserPending > 0) {
      const userPending = [...this.pendingRequests.values()].filter((request) => request.requesterId === userKey).length;
      if (userPending >= rules.perUserPending) {
        await this.rejectSongRequest({ event, key: 'userLimitReached', values: { url, limit: rules.perUserPending }, redemption, reason: '你目前的待確認點歌已達上限', history });
        return false;
      }
    }
    let metadata;
    try {
      metadata = await this.fetchYouTubeMetadata(url);
    } catch (err) {
      log.warn('Twitch 點歌影片資料讀取失敗：' + err.message);
      await this.rejectSongRequest({
        event,
        key: 'importFailure',
        redemption,
        reason: '無法讀取這個 YouTube 連結的影片資料',
        values: { url },
        history,
        historyResult: 'failed',
      });
      return false;
    }
    history.metadata = metadata;
    const postMetadataBlock = TwitchRequestSettings.findBlacklistMatch(rules, {
      event, videoId: parsedUrl.videoId, metadata, phase: 'post',
    });
    if (postMetadataBlock) {
      const reason = postMetadataBlock.reason || '這個 YouTube 頻道或影片標題已被點歌規則封鎖';
      await this.rejectSongRequest({
        event, key: 'blockedRequest', redemption, reason,
        values: { title: metadata.title, artist: metadata.author, url, reason }, history,
      });
      return false;
    }
    if (rules.maxDurationMinutes > 0 && metadata.duration > rules.maxDurationMinutes * 60) {
      await this.rejectSongRequest({
        event, key: 'durationExceeded', redemption, reason: `歌曲超過 ${rules.maxDurationMinutes} 分鐘限制`,
        values: { title: metadata.title, artist: metadata.author, url, duration: formatDuration(metadata.duration), limit: rules.maxDurationMinutes }, history,
      });
      return false;
    }
    const request = {
      requestId,
      url,
      requester: event.chatter_user_name || event.chatter_user_login || '觀眾',
      requesterId: userKey,
      challenge: source === 'chat' && !redemption ? challenge : null,
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
    const createdAt = Date.now();
    const pendingRequest = {
      ...request,
      shortId: this.createShortRequestId(),
      historyId: history.id,
      event,
      createdAt,
      priority: createdAt,
      expiresAt: createdAt + REQUEST_TTL_MS,
    };
    const accepted = typeof this.onSongRequest === 'function' && this.onSongRequest(this.serializePendingRequest(pendingRequest));
    if (!accepted) {
      await this.rejectSongRequest({
        event, key: 'panelUnavailable', redemption, reason: '控制面板目前無法接收點歌',
        values: { title: request.title, artist: request.author, url }, history,
      });
      return false;
    }
    const consecutiveRequester = this.recordAcceptedRequest(event, parsedUrl.videoId);
    this.pendingRequests.set(requestId, pendingRequest);
    this.scheduleRequestExpiry(requestId);
    this.persistPendingRequests();
    this.notifyPendingRequestsChanged();
    this.recordHistory(this.historyEntryFromRequest(pendingRequest, {
      result: 'pending', rewardStatus: redemption ? 'pending' : 'not-applicable',
    }));
    // 確認制：不自動下載，先送到主播面板等待確認。
    await this.sendConfiguredReply(event, source === 'channel-points' ? 'rewardReceived' : 'received', {
      title: request.title, artist: request.author, url, cost: redemption?.cost || '', requestId: pendingRequest.shortId,
    });
    if (consecutiveRequester && rules.warnConsecutiveRequests) {
      await this.sendConfiguredReply(event, 'consecutiveRequesterWarning', {
        title: request.title, artist: request.author, url,
      });
    }
    this.pruneRequests();
    return true;
  },

  async sendConfiguredReply(event, replyKey, values = {}) {
    const settings = this.replySettings || TwitchReplySettings.getDefaults();
    const reply = settings.replies && settings.replies[replyKey];
    if (!settings.enabled || !reply || !reply.enabled) return { sent: false, skipped: true };
    const text = TwitchReplySettings.renderTemplate(reply.template, {
      user: event?.chatter_user_name || event?.chatter_user_login || '觀眾',
      command: TwitchRequestSettings.getCommand(this.requestSettings, 'request')?.command || this.config.twitchRequestCommand || '!點歌',
      title: '', artist: '', reason: '', position: '', queue: '', url: '',
      seconds: '', limit: '', duration: '', cost: '',
      currentTitle: '', currentArtist: '', nextTitle: '', nextArtist: '', requestCount: '',
      ...values,
    });
    if (!text) return { sent: false, skipped: true };
    try { await this.sendChatReply(event, text, { mode: settings.replyMode }); }
    catch (error) {
      if (settings.replyMode !== 'reply' || !event?.message_id) throw error;
      await this.sendChatReply(event, text, { mode: 'mention' });
    }
    return { sent: true, skipped: false };
  },

  async sendReplyTest(settings, replyKey) {
    const validation = TwitchReplySettings.validateSettings(settings);
    if (!validation.ok) throw new Error(validation.errors[0]?.message || 'Twitch 回覆設定格式無效');
    const definition = TwitchReplySettings.REPLY_DEFINITIONS.find((item) => item.key === replyKey);
    if (!definition) throw new Error('找不到要測試的 Twitch 回覆項目');
    const reply = validation.settings.replies[replyKey];
    const text = TwitchReplySettings.renderTemplate(reply.template, {
      ...TwitchReplySettings.sampleValues(),
      command: TwitchRequestSettings.getCommand(this.requestSettings, 'request')?.command || this.config.twitchRequestCommand || '!點歌',
    });
    const message = `【回覆測試】${text}`;
    await this.sendChatReply({}, message, { mode: 'plain' });
    return { replyKey, text: message };
  },

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
  },
};
