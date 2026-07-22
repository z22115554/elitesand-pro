/**
 * Twitch 聊天室回覆設定的共用契約。
 *
 * 同一份定義同時供瀏覽器設定 UI 與 Node Twitch service 使用，避免兩端的預設文案、
 * 可用變數或驗證規則分岔。瀏覽器直接使用 TwitchReplySettings；Node 透過 require 載入。
 */
const TwitchReplySettings = (() => {
  'use strict';

  const MAX_MESSAGE_LENGTH = 500;
  const REPLY_MODES = Object.freeze(['reply', 'mention', 'plain']);
  const VARIABLE_DEFINITIONS = Object.freeze([
    { key: 'user', label: '點歌者', sample: 'viewer123' },
    { key: 'title', label: '歌曲名稱', sample: '測試歌曲' },
    { key: 'artist', label: '歌手／頻道', sample: '測試歌手' },
    { key: 'command', label: '點歌指令', sample: '!點歌' },
    { key: 'reason', label: '安全原因', sample: '目前無法處理這個連結' },
    { key: 'position', label: '加入位置', sample: '歌單尾端' },
    { key: 'queue', label: '歌單順位', sample: '5' },
    { key: 'url', label: 'YouTube 連結', sample: 'https://youtu.be/example' },
    { key: 'seconds', label: '剩餘秒數', sample: '12' },
    { key: 'limit', label: '規則上限', sample: '3' },
    { key: 'duration', label: '歌曲長度', sample: '18:30' },
    { key: 'cost', label: '兌換點數', sample: '1000' },
    { key: 'currentTitle', label: '目前歌曲名稱', sample: '目前歌曲' },
    { key: 'currentArtist', label: '目前歌手', sample: '目前歌手' },
    { key: 'nextTitle', label: '下一首歌曲名稱', sample: '下一首歌曲' },
    { key: 'nextArtist', label: '下一首歌手', sample: '下一首歌手' },
    { key: 'requestCount', label: '待確認數量', sample: '2' },
  ]);
  const ALLOWED_VARIABLES = new Set(VARIABLE_DEFINITIONS.map((item) => item.key));
  const REPLY_GROUPS = Object.freeze([
    { key: 'received', label: '收到、成功與查詢' },
    { key: 'restrictions', label: '限制與拒絕' },
    { key: 'failures', label: '失敗、取消與逾時' },
    { key: 'rewards', label: '忠誠點數' },
  ]);

  const REPLY_DEFINITIONS = Object.freeze([
    { key: 'received', group: 'received', label: '收到點歌、等待確認', defaultEnabled: true, defaultTemplate: '已收到你的點歌，等待主播確認：{title}' },
    { key: 'importSuccess', group: 'received', label: '成功匯入', defaultEnabled: true, defaultTemplate: '點歌成功：{title}（{position}）' },
    { key: 'currentSong', group: 'received', label: '目前歌曲', defaultEnabled: true, defaultTemplate: '目前播放：{currentTitle} — {currentArtist}' },
    { key: 'noCurrentSong', group: 'received', label: '目前沒有歌曲', defaultEnabled: true, defaultTemplate: '目前沒有載入或播放中的歌曲。' },
    { key: 'nextSong', group: 'received', label: '下一首歌曲', defaultEnabled: true, defaultTemplate: '下一首：{nextTitle} — {nextArtist}' },
    { key: 'noNextSong', group: 'received', label: '目前沒有下一首', defaultEnabled: true, defaultTemplate: '目前播放清單沒有下一首歌曲。' },
    { key: 'myRequests', group: 'received', label: '我的待確認點歌', defaultEnabled: true, defaultTemplate: '你有 {requestCount} 首待確認：{title}' },
    { key: 'noMyRequests', group: 'received', label: '沒有自己的待確認點歌', defaultEnabled: true, defaultTemplate: '你目前沒有待確認的點歌。' },
    { key: 'requestPosition', group: 'received', label: '待確認順位', defaultEnabled: true, defaultTemplate: '你最新一首待確認點歌目前是第 {position} 位：{title}' },
    { key: 'requestNotFound', group: 'received', label: '找不到可查詢的點歌', defaultEnabled: true, defaultTemplate: '你目前沒有可查詢或取消的待確認點歌。' },
    { key: 'requestCanceled', group: 'received', label: '觀眾取消點歌成功', defaultEnabled: true, defaultTemplate: '已取消待確認點歌：{title}' },
    { key: 'requestRules', group: 'received', label: '點歌規則摘要', defaultEnabled: true, defaultTemplate: '點歌指令：{command}；{reason}' },
    { key: 'queueSummary', group: 'received', label: '歌單摘要', defaultEnabled: true, defaultTemplate: '目前：{currentTitle}；下一首：{nextTitle}；待播 {queue} 首。' },
    { key: 'requestDisabled', group: 'restrictions', label: '點歌功能暫停', defaultEnabled: true, defaultTemplate: '目前暫停接受聊天室點歌，請稍後再試。' },
    { key: 'permissionDenied', group: 'restrictions', label: '使用者資格不符', defaultEnabled: true, defaultTemplate: '目前的指令資格有限制，這次無法使用。' },
    { key: 'cooldownActive', group: 'restrictions', label: '指令冷卻中', defaultEnabled: true, defaultTemplate: '操作太快了，請再等 {seconds} 秒。' },
    { key: 'userLimitReached', group: 'restrictions', label: '每人待確認已達上限', defaultEnabled: true, defaultTemplate: '你已有 {limit} 首歌等待確認，請等主播處理後再點。' },
    { key: 'durationExceeded', group: 'restrictions', label: '歌曲超過長度限制', defaultEnabled: true, defaultTemplate: '這首歌長度 {duration}，超過目前 {limit} 分鐘的限制。' },
    { key: 'invalidLink', group: 'restrictions', label: '沒有附有效的 YouTube 連結', defaultEnabled: true, defaultTemplate: '請在 {command} 後附上 YouTube 連結，例如：{command} https://youtu.be/…' },
    { key: 'playlistNotAllowed', group: 'restrictions', label: '貼了播放清單連結', defaultEnabled: true, defaultTemplate: '點歌只接受單曲連結，不接受播放清單。' },
    { key: 'duplicatePending', group: 'restrictions', label: '重複點同一首歌', defaultEnabled: true, defaultTemplate: '這首歌已在待確認清單中，不需重複點歌。' },
    { key: 'blockedRequest', group: 'restrictions', label: '命中黑名單規則', defaultEnabled: true, defaultTemplate: '這次點歌不符合目前規則：{reason}' },
    { key: 'queueFull', group: 'restrictions', label: '待確認清單已滿', defaultEnabled: true, defaultTemplate: '待確認點歌已滿，請稍後再試。' },
    { key: 'panelUnavailable', group: 'restrictions', label: '控制面板沒有開啟', defaultEnabled: true, defaultTemplate: '目前控制面板未開啟，暫時無法接收點歌。' },
    { key: 'hostRejected', group: 'failures', label: '主播拒絕歌曲', defaultEnabled: true, defaultTemplate: '主播暫時略過了這首點歌，可以換一首再試～' },
    { key: 'importFailure', group: 'failures', label: '永久匯入失敗', defaultEnabled: true, defaultTemplate: '點歌失敗：{reason}' },
    { key: 'retryableFailure', group: 'failures', label: '暫時匯入失敗、等待重試', defaultEnabled: false, defaultTemplate: '這首歌暫時匯入失敗，主播可以重新嘗試。' },
    { key: 'requestExpired', group: 'failures', label: '等待確認超過 30 分鐘', defaultEnabled: true, defaultTemplate: '點歌等待確認逾時，已自動取消；歡迎重新點歌。' },
    { key: 'requestCancelFailed', group: 'failures', label: '觀眾取消暫時失敗', defaultEnabled: true, defaultTemplate: '這筆點歌目前無法取消，請稍後再試。' },
    { key: 'rewardReceived', group: 'rewards', label: '忠誠點數點歌已收到', defaultEnabled: true, defaultTemplate: '已收到 {user} 的忠誠點數點歌，等待主播確認：{title}' },
    { key: 'rewardFulfilled', group: 'rewards', label: '忠誠點數兌換完成', defaultEnabled: true, defaultTemplate: '忠誠點數點歌成功：{title}（{position}）' },
    { key: 'rewardRefunded', group: 'rewards', label: '忠誠點數兌換退款', defaultEnabled: true, defaultTemplate: '這次忠誠點數點歌未完成，已退還 {cost} 點：{reason}' },
  ]);

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function getDefaults() {
    return {
      enabled: true,
      replyMode: 'reply',
      replies: Object.fromEntries(REPLY_DEFINITIONS.map((definition) => [definition.key, {
        enabled: definition.defaultEnabled,
        template: definition.defaultTemplate,
      }])),
    };
  }

  function validateTemplate(value) {
    const template = typeof value === 'string' ? value : '';
    const errors = [];
    const variables = [];
    const unknownVariables = [];
    if (!template.trim()) errors.push('回覆文字不能留空；若不想回覆，請關閉這個項目。');
    if (Array.from(template).length > MAX_MESSAGE_LENGTH) errors.push(`回覆文字不可超過 ${MAX_MESSAGE_LENGTH} 字。`);
    if (/[｛｝]/.test(template)) errors.push('變數請使用半形大括號，例如 {title}。');

    const matchedRanges = [];
    const tokenPattern = /\{([^{}]*)\}/g;
    let match;
    while ((match = tokenPattern.exec(template))) {
      const key = match[1].trim();
      matchedRanges.push([match.index, tokenPattern.lastIndex]);
      if (!key || !/^[a-z][a-z0-9_]*$/i.test(key)) {
        errors.push(`變數格式錯誤：{${match[1]}}`);
      } else if (!ALLOWED_VARIABLES.has(key)) {
        unknownVariables.push(key);
      } else if (!variables.includes(key)) {
        variables.push(key);
      }
    }

    let remainder = '';
    let cursor = 0;
    matchedRanges.forEach(([start, end]) => {
      remainder += template.slice(cursor, start);
      cursor = end;
    });
    remainder += template.slice(cursor);
    if (/[{}]/.test(remainder)) errors.push('大括號沒有成對，請從下方按鈕插入變數。');
    if (unknownVariables.length) errors.push(`不認得的變數：${unknownVariables.map((key) => `{${key}}`).join('、')}`);

    return { valid: errors.length === 0, errors, variables, unknownVariables };
  }

  function normalizeSettings(value) {
    const defaults = getDefaults();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    if (typeof value.enabled === 'boolean') defaults.enabled = value.enabled;
    if (REPLY_MODES.includes(value.replyMode)) defaults.replyMode = value.replyMode;
    if (!value.replies || typeof value.replies !== 'object' || Array.isArray(value.replies)) return defaults;
    REPLY_DEFINITIONS.forEach((definition) => {
      const incoming = value.replies[definition.key];
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return;
      if (typeof incoming.enabled === 'boolean') defaults.replies[definition.key].enabled = incoming.enabled;
      if (typeof incoming.template === 'string' && validateTemplate(incoming.template).valid) {
        defaults.replies[definition.key].template = incoming.template;
      }
    });
    return defaults;
  }

  function validateSettings(value) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: [{ field: 'settings', message: 'Twitch 回覆設定格式無效。' }], settings: null };
    }
    if (typeof value.enabled !== 'boolean') errors.push({ field: 'enabled', message: '總開關格式無效。' });
    if (!REPLY_MODES.includes(value.replyMode)) errors.push({ field: 'replyMode', message: '回覆方式無效。' });
    if (!value.replies || typeof value.replies !== 'object' || Array.isArray(value.replies)) {
      errors.push({ field: 'replies', message: '分項回覆設定格式無效。' });
    } else {
      REPLY_DEFINITIONS.forEach((definition) => {
        const reply = value.replies[definition.key];
        if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
          errors.push({ field: definition.key, message: `${definition.label}設定遺失。` });
          return;
        }
        if (typeof reply.enabled !== 'boolean') errors.push({ field: definition.key, message: `${definition.label}開關格式無效。` });
        const validation = validateTemplate(reply.template);
        validation.errors.forEach((message) => errors.push({ field: definition.key, message }));
      });
    }
    return { ok: errors.length === 0, errors, settings: errors.length ? null : normalizeSettings(value) };
  }

  function renderTemplate(template, values = {}) {
    const validation = validateTemplate(template);
    if (!validation.valid) throw new Error(validation.errors[0]);
    const rendered = template.replace(/\{([a-z][a-z0-9_]*)\}/gi, (_token, key) => String(values[key] ?? ''))
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    return Array.from(rendered).slice(0, MAX_MESSAGE_LENGTH).join('');
  }

  function sampleValues() {
    return Object.fromEntries(VARIABLE_DEFINITIONS.map((definition) => [definition.key, definition.sample]));
  }

  return {
    MAX_MESSAGE_LENGTH,
    REPLY_MODES,
    VARIABLE_DEFINITIONS,
    REPLY_GROUPS,
    REPLY_DEFINITIONS,
    getDefaults,
    normalizeSettings,
    validateTemplate,
    validateSettings,
    renderTemplate,
    sampleValues,
    clone,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TwitchReplySettings;
