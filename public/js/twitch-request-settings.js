/**
 * Twitch 點歌指令、使用者資格與佇列規則的前後端共用契約。
 * 瀏覽器直接使用 TwitchRequestSettings；Node 端以 require 載入同一份驗證邏輯。
 */
const TwitchRequestSettings = (() => {
  'use strict';

  const PERMISSION_LEVELS = Object.freeze([
    { key: 'everyone', label: '所有觀眾' },
    { key: 'subscriber', label: '訂閱者、VIP、管理員與實況主' },
    { key: 'vip', label: 'VIP、管理員與實況主' },
    { key: 'moderator', label: '管理員與實況主' },
  ]);
  const PERMISSION_KEYS = new Set(PERMISSION_LEVELS.map((item) => item.key));
  const LIMITS = Object.freeze({
    aliases: 5,
    cooldownSeconds: 600,
    maxPending: 50,
    perUserPending: 10,
    maxDurationMinutes: 180,
    blacklistRules: 200,
    blacklistValue: 200,
    blacklistReason: 200,
    recentDuplicateHours: 168,
    perUserSessionLimit: 50,
    sessionRequestLimit: 500,
  });
  const BLACKLIST_TYPES = Object.freeze([
    { key: 'user', label: 'Twitch 使用者' },
    { key: 'video', label: 'YouTube 影片' },
    { key: 'channel', label: 'YouTube 頻道' },
    { key: 'title', label: '標題關鍵字' },
  ]);
  const BLACKLIST_TYPE_KEYS = new Set(BLACKLIST_TYPES.map((item) => item.key));
  const DUPLICATE_SCOPES = Object.freeze([
    { key: 'pending', label: '待確認區' },
    { key: 'playlist', label: '正式播放清單' },
    { key: 'session', label: '本場已唱' },
    { key: 'recent', label: '最近指定時數' },
    { key: 'allow', label: '完全允許重複' },
  ]);
  const DUPLICATE_SCOPE_KEYS = new Set(DUPLICATE_SCOPES.map((item) => item.key));
  const COMMAND_DEFINITIONS = Object.freeze([
    { key: 'request', group: 'viewer', label: '點歌', description: '送出一個 YouTube 單曲連結，等待主播確認。', command: '!點歌', userCooldownSeconds: 0, globalCooldownSeconds: 0 },
    { key: 'currentSong', group: 'viewer', label: '目前歌曲', description: '查詢現在載入或播放中的歌曲。', command: '!目前歌曲', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'nextSong', group: 'viewer', label: '下一首', description: '查詢播放清單中的下一首歌。', command: '!下一首', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'myRequests', group: 'viewer', label: '我的點歌', description: '列出自己仍在待確認區的點歌。', command: '!我的點歌', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'position', group: 'viewer', label: '順位', description: '查詢自己最新一筆待確認點歌的順位。', command: '!順位', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'cancelRequest', group: 'viewer', label: '取消點歌', description: '取消自己最新一筆尚未匯入的點歌。', command: '!取消點歌', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'rules', group: 'viewer', label: '點歌規則', description: '查看目前點歌指令、資格與主要限制。', command: '!點歌規則', userCooldownSeconds: 15, globalCooldownSeconds: 3 },
    { key: 'queueSummary', group: 'viewer', label: '歌單摘要', description: '查看目前、下一首與待確認數量，不會貼本機網址。', command: '!歌單', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'adminOpen', group: 'admin', adminOnly: true, label: '開放點歌', description: '立即開放聊天室點歌；只允許管理員與實況主。', command: '!開放點歌', enabled: false, permissionLevel: 'moderator', userCooldownSeconds: 0, globalCooldownSeconds: 0 },
    { key: 'adminPause', group: 'admin', adminOnly: true, label: '暫停點歌', description: '立即暫停聊天室點歌；只允許管理員與實況主。', command: '!暫停點歌', enabled: false, permissionLevel: 'moderator', userCooldownSeconds: 0, globalCooldownSeconds: 0 },
    { key: 'adminReject', group: 'admin', adminOnly: true, label: '拒絕點歌', description: '以待確認編號拒絕一筆點歌；忠誠點數點歌會先退款。', command: '!拒絕點歌', usage: '<編號>', enabled: false, permissionLevel: 'moderator', userCooldownSeconds: 0, globalCooldownSeconds: 0 },
    { key: 'adminRemove', group: 'admin', adminOnly: true, label: '移除點歌', description: '以待確認編號或使用者名稱移除最新一筆待確認點歌。', command: '!移除點歌', usage: '<編號或使用者>', enabled: false, permissionLevel: 'moderator', userCooldownSeconds: 0, globalCooldownSeconds: 0 },
    { key: 'adminPromote', group: 'admin', adminOnly: true, label: '提升順位', description: '把一筆待確認點歌提升至待確認區最前面，不改正式播放清單。', command: '!提升順位', usage: '<編號>', enabled: false, permissionLevel: 'moderator', userCooldownSeconds: 0, globalCooldownSeconds: 0 },
    { key: 'adminSkip', group: 'admin', adminOnly: true, label: '略過歌曲', description: '請目前擁有音訊的桌面面板略過歌曲；伺服器不直接控制播放。', command: '!略過歌曲', enabled: false, permissionLevel: 'moderator', userCooldownSeconds: 0, globalCooldownSeconds: 0 },
  ]);
  const COMMAND_KEYS = new Set(COMMAND_DEFINITIONS.map((item) => item.key));

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function defaultCommand(definition) {
    return {
      enabled: definition.enabled !== false,
      command: definition.command,
      aliases: [],
      permissionLevel: definition.permissionLevel || 'everyone',
      userCooldownSeconds: definition.userCooldownSeconds,
      globalCooldownSeconds: definition.globalCooldownSeconds,
    };
  }

  function getDefaults() {
    return {
      enabled: true,
      commands: Object.fromEntries(COMMAND_DEFINITIONS.map((definition) => [definition.key, defaultCommand(definition)])),
      maxPending: 20,
      perUserPending: 0,
      duplicateScope: 'pending',
      recentDuplicateHours: 24,
      maxDurationMinutes: 0,
      blacklist: [],
      liveOnly: false,
      perUserSessionLimit: 0,
      sessionRequestLimit: 0,
      fairnessModeratorExempt: true,
      warnConsecutiveRequests: true,
    };
  }

  function normalizeBlacklistValue(type, value) {
    const input = String(value || '').trim();
    if (type === 'user') return input.replace(/^@/u, '').toLocaleLowerCase();
    if (type === 'video') {
      const match = input.match(/(?:youtu\.be\/|[?&]v=|shorts\/|music\.youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/i);
      return (match?.[1] || input).trim();
    }
    return input.toLocaleLowerCase();
  }

  function normalizeBlacklistRule(rule) {
    const type = String(rule?.type || 'user');
    return {
      id: String(rule?.id || '').trim(),
      enabled: rule?.enabled !== false,
      type,
      value: normalizeBlacklistValue(type, rule?.value),
      reason: String(rule?.reason || '').trim(),
      expiresAt: rule?.expiresAt == null || rule.expiresAt === '' ? null : Number(rule.expiresAt),
      moderatorExempt: rule?.moderatorExempt !== false,
    };
  }

  function activeBlacklistRules(settings, now = Date.now()) {
    return normalizeSettings(settings).blacklist.filter((rule) => rule.enabled && (rule.expiresAt == null || rule.expiresAt > now));
  }

  function findBlacklistMatch(settings, { event = {}, videoId = '', metadata = null, phase = 'all', now = Date.now() } = {}) {
    const roles = rolesForEvent(event);
    const userValues = [event.chatter_user_id, event.chatter_user_login, event.chatter_user_name]
      .map((value) => normalizeBlacklistValue('user', value)).filter(Boolean);
    const title = normalizeBlacklistValue('title', metadata?.title);
    const channelValues = [metadata?.channelId, metadata?.assessment?.channelId, metadata?.author]
      .map((value) => normalizeBlacklistValue('channel', value)).filter(Boolean);
    for (const rule of activeBlacklistRules(settings, now)) {
      if (rule.moderatorExempt && roles.moderator) continue;
      if ((phase === 'pre' && !['user', 'video'].includes(rule.type)) || (phase === 'post' && !['channel', 'title'].includes(rule.type))) continue;
      if (rule.type === 'user' && userValues.includes(rule.value)) return rule;
      if (rule.type === 'video' && String(videoId || '') === rule.value) return rule;
      if (rule.type === 'channel' && channelValues.includes(rule.value)) return rule;
      if (rule.type === 'title' && rule.value && title.includes(rule.value)) return rule;
    }
    return null;
  }

  function validateCommand(value) {
    const command = typeof value === 'string' ? value.trim() : '';
    if (!command) return { valid: false, error: '指令不可空白。', command };
    if (!command.startsWith('!')) return { valid: false, error: '指令必須以 ! 開頭。', command };
    if (Array.from(command).length > 20) return { valid: false, error: '指令最多 20 個字。', command };
    if (command === '!' || /\s/u.test(command) || command.slice(1).includes('!')) {
      return { valid: false, error: '指令不可包含空白或第二個 !。', command };
    }
    return { valid: true, error: '', command };
  }

  function parseAliases(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    return String(value || '').split(/[,，\n]/u).map((item) => item.trim()).filter(Boolean);
  }

  function migrateLegacySettings(value) {
    const defaults = getDefaults();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const candidate = { ...defaults, ...value, commands: clone(defaults.commands) };
    if (value.commands && typeof value.commands === 'object' && !Array.isArray(value.commands)) {
      COMMAND_DEFINITIONS.forEach((definition) => {
        const incoming = value.commands[definition.key];
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return;
        candidate.commands[definition.key] = {
          ...candidate.commands[definition.key],
          ...incoming,
          aliases: parseAliases(incoming.aliases),
        };
      });
    }
    if (!value.commands || Object.prototype.hasOwnProperty.call(value, 'command') || Object.prototype.hasOwnProperty.call(value, 'aliases')
      || Object.prototype.hasOwnProperty.call(value, 'permissionLevel') || Object.prototype.hasOwnProperty.call(value, 'cooldownSeconds')) {
      candidate.commands.request = {
        ...candidate.commands.request,
        command: typeof value.command === 'string' ? value.command : candidate.commands.request.command,
        aliases: parseAliases(value.aliases),
        permissionLevel: typeof value.permissionLevel === 'string' ? value.permissionLevel : candidate.commands.request.permissionLevel,
        userCooldownSeconds: Number.isInteger(value.cooldownSeconds) ? value.cooldownSeconds : candidate.commands.request.userCooldownSeconds,
      };
    }
    delete candidate.command;
    delete candidate.aliases;
    delete candidate.permissionLevel;
    delete candidate.cooldownSeconds;
    if (!DUPLICATE_SCOPE_KEYS.has(value.duplicateScope)) candidate.duplicateScope = value.rejectDuplicates === false ? 'allow' : 'pending';
    delete candidate.rejectDuplicates;
    candidate.blacklist = Array.isArray(value.blacklist) ? value.blacklist.map(normalizeBlacklistRule) : [];
    return candidate;
  }

  function validateSettings(value) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: [{ field: 'settings', message: 'Twitch 點歌設定格式無效。' }], settings: null };
    }
    if (!value.commands || Object.prototype.hasOwnProperty.call(value, 'command') || Object.prototype.hasOwnProperty.call(value, 'aliases')
      || Object.prototype.hasOwnProperty.call(value, 'permissionLevel') || Object.prototype.hasOwnProperty.call(value, 'cooldownSeconds')) {
      return validateSettings(migrateLegacySettings(value));
    }
    if (typeof value.enabled !== 'boolean') errors.push({ field: 'enabled', message: '點歌總開關格式無效。' });
    if (!value.commands || typeof value.commands !== 'object' || Array.isArray(value.commands)) {
      errors.push({ field: 'commands', message: 'Twitch 指令設定格式無效。' });
    }

    const normalizedCommands = {};
    const seenNames = new Map();
    const integerRule = (object, field, label, min, max, errorField = field) => {
      if (!Number.isInteger(object?.[field]) || object[field] < min || object[field] > max) {
        errors.push({ field: errorField, message: `${label}必須是 ${min}–${max} 的整數。` });
      }
    };

    COMMAND_DEFINITIONS.forEach((definition) => {
      const commandSettings = value.commands?.[definition.key];
      const fieldPrefix = `commands.${definition.key}`;
      if (!commandSettings || typeof commandSettings !== 'object' || Array.isArray(commandSettings)) {
        errors.push({ field: fieldPrefix, message: `「${definition.label}」指令設定遺失。` });
        return;
      }
      if (typeof commandSettings.enabled !== 'boolean') errors.push({ field: `${fieldPrefix}.enabled`, message: `「${definition.label}」開關格式無效。` });
      const commandResult = validateCommand(commandSettings.command);
      if (!commandResult.valid) errors.push({ field: `${fieldPrefix}.command`, message: `「${definition.label}」：${commandResult.error}` });
      const aliases = parseAliases(commandSettings.aliases);
      if (aliases.length > LIMITS.aliases) errors.push({ field: `${fieldPrefix}.aliases`, message: `「${definition.label}」別名最多 ${LIMITS.aliases} 個。` });
      aliases.forEach((alias) => {
        const result = validateCommand(alias);
        if (!result.valid) errors.push({ field: `${fieldPrefix}.aliases`, message: `別名「${alias}」：${result.error}` });
      });
      if (!PERMISSION_KEYS.has(commandSettings.permissionLevel)) errors.push({ field: `${fieldPrefix}.permissionLevel`, message: `「${definition.label}」使用者資格格式無效。` });
      if (definition.adminOnly && commandSettings.permissionLevel !== 'moderator') {
        errors.push({ field: `${fieldPrefix}.permissionLevel`, message: `「${definition.label}」只允許管理員與實況主。` });
      }
      integerRule(commandSettings, 'userCooldownSeconds', `「${definition.label}」每人冷卻秒數`, 0, LIMITS.cooldownSeconds, `${fieldPrefix}.userCooldownSeconds`);
      integerRule(commandSettings, 'globalCooldownSeconds', `「${definition.label}」全域冷卻秒數`, 0, LIMITS.cooldownSeconds, `${fieldPrefix}.globalCooldownSeconds`);

      const names = [commandResult.command, ...aliases];
      names.forEach((name) => {
        const normalizedName = name.toLocaleLowerCase();
        if (!name) return;
        const previous = seenNames.get(normalizedName);
        if (previous) errors.push({ field: `${fieldPrefix}.aliases`, message: `指令「${name}」已被「${previous}」使用。` });
        else seenNames.set(normalizedName, definition.label);
      });
      normalizedCommands[definition.key] = {
        enabled: commandSettings.enabled,
        command: commandResult.command,
        aliases,
        permissionLevel: commandSettings.permissionLevel,
        userCooldownSeconds: commandSettings.userCooldownSeconds,
        globalCooldownSeconds: commandSettings.globalCooldownSeconds,
      };
    });

    Object.keys(value.commands || {}).forEach((key) => {
      if (!COMMAND_KEYS.has(key)) errors.push({ field: `commands.${key}`, message: `不認得的 Twitch 指令項目：${key}` });
    });
    integerRule(value, 'maxPending', '待確認總上限', 1, LIMITS.maxPending);
    integerRule(value, 'perUserPending', '每人待確認上限', 0, LIMITS.perUserPending);
    integerRule(value, 'maxDurationMinutes', '歌曲長度上限', 0, LIMITS.maxDurationMinutes);
    if (!DUPLICATE_SCOPE_KEYS.has(value.duplicateScope)) errors.push({ field: 'duplicateScope', message: '重複歌曲檢查範圍無效。' });
    integerRule(value, 'recentDuplicateHours', '最近重複檢查時數', 1, LIMITS.recentDuplicateHours);
    if (typeof value.liveOnly !== 'boolean') errors.push({ field: 'liveOnly', message: '僅直播中接受點歌格式無效。' });
    integerRule(value, 'perUserSessionLimit', '每人每場上限', 0, LIMITS.perUserSessionLimit);
    integerRule(value, 'sessionRequestLimit', '全場點歌上限', 0, LIMITS.sessionRequestLimit);
    if (typeof value.fairnessModeratorExempt !== 'boolean') errors.push({ field: 'fairnessModeratorExempt', message: '管理員公平性豁免格式無效。' });
    if (typeof value.warnConsecutiveRequests !== 'boolean') errors.push({ field: 'warnConsecutiveRequests', message: '連續點歌提醒格式無效。' });
    if (!Array.isArray(value.blacklist)) {
      errors.push({ field: 'blacklist', message: '黑名單格式無效。' });
    } else if (value.blacklist.length > LIMITS.blacklistRules) {
      errors.push({ field: 'blacklist', message: `黑名單最多 ${LIMITS.blacklistRules} 筆。` });
    }
    const normalizedBlacklist = [];
    const blacklistIds = new Set();
    (Array.isArray(value.blacklist) ? value.blacklist : []).forEach((incoming, index) => {
      const rule = normalizeBlacklistRule(incoming);
      const fieldPrefix = `blacklist.${index}`;
      if (!rule.id || !/^[A-Za-z0-9_-]{1,80}$/.test(rule.id)) errors.push({ field: `${fieldPrefix}.id`, message: `黑名單第 ${index + 1} 筆缺少有效識別碼。` });
      else if (blacklistIds.has(rule.id)) errors.push({ field: `${fieldPrefix}.id`, message: `黑名單識別碼重複：${rule.id}` });
      else blacklistIds.add(rule.id);
      if (!BLACKLIST_TYPE_KEYS.has(rule.type)) errors.push({ field: `${fieldPrefix}.type`, message: `黑名單第 ${index + 1} 筆類型無效。` });
      if (!rule.value || Array.from(rule.value).length > LIMITS.blacklistValue) errors.push({ field: `${fieldPrefix}.value`, message: `黑名單第 ${index + 1} 筆比對內容必須是 1–${LIMITS.blacklistValue} 字。` });
      if (rule.type === 'video' && !/^[A-Za-z0-9_-]{11}$/.test(rule.value)) errors.push({ field: `${fieldPrefix}.value`, message: `黑名單第 ${index + 1} 筆請填有效的 YouTube 影片 ID 或網址。` });
      if (Array.from(rule.reason).length > LIMITS.blacklistReason) errors.push({ field: `${fieldPrefix}.reason`, message: `黑名單第 ${index + 1} 筆理由最多 ${LIMITS.blacklistReason} 字。` });
      if (rule.expiresAt != null && (!Number.isFinite(rule.expiresAt) || rule.expiresAt <= 0)) errors.push({ field: `${fieldPrefix}.expiresAt`, message: `黑名單第 ${index + 1} 筆到期時間無效。` });
      if (typeof incoming?.enabled !== 'boolean') errors.push({ field: `${fieldPrefix}.enabled`, message: `黑名單第 ${index + 1} 筆啟用狀態無效。` });
      if (typeof incoming?.moderatorExempt !== 'boolean') errors.push({ field: `${fieldPrefix}.moderatorExempt`, message: `黑名單第 ${index + 1} 筆管理員豁免格式無效。` });
      normalizedBlacklist.push(rule);
    });

    if (errors.length) return { ok: false, errors, settings: null };
    return {
      ok: true,
      errors: [],
      settings: {
        enabled: value.enabled,
        commands: normalizedCommands,
        maxPending: value.maxPending,
        perUserPending: value.perUserPending,
        duplicateScope: value.duplicateScope,
        recentDuplicateHours: value.recentDuplicateHours,
        maxDurationMinutes: value.maxDurationMinutes,
        blacklist: normalizedBlacklist,
        liveOnly: value.liveOnly,
        perUserSessionLimit: value.perUserSessionLimit,
        sessionRequestLimit: value.sessionRequestLimit,
        fairnessModeratorExempt: value.fairnessModeratorExempt,
        warnConsecutiveRequests: value.warnConsecutiveRequests,
      },
    };
  }

  function normalizeSettings(value) {
    const candidate = migrateLegacySettings(value);
    const validation = validateSettings(candidate);
    return validation.ok ? validation.settings : getDefaults();
  }

  function getCommand(settings, key = 'request') {
    return normalizeSettings(settings).commands[key] || null;
  }

  function matchCommand(text, settings) {
    const normalized = normalizeSettings(settings);
    const input = String(text || '').trim();
    const candidates = [];
    COMMAND_DEFINITIONS.forEach((definition) => {
      const commandSettings = normalized.commands[definition.key];
      if (!commandSettings?.enabled) return;
      [commandSettings.command, ...commandSettings.aliases].forEach((command) => {
        candidates.push({ key: definition.key, command, settings: commandSettings, definition });
      });
    });
    candidates.sort((a, b) => b.command.length - a.command.length);
    for (const candidate of candidates) {
      if (input.toLocaleLowerCase() === candidate.command.toLocaleLowerCase()) return { ...candidate, argument: '' };
      const prefix = `${candidate.command} `;
      if (input.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
        return { ...candidate, argument: input.slice(prefix.length).trim() };
      }
    }
    return null;
  }

  function rolesForEvent(event) {
    const badges = new Set((Array.isArray(event?.badges) ? event.badges : [])
      .map((badge) => String(badge?.set_id || '').toLocaleLowerCase()));
    const broadcaster = badges.has('broadcaster')
      || (!!event?.chatter_user_id && event.chatter_user_id === event.broadcaster_user_id);
    return {
      broadcaster,
      moderator: broadcaster || badges.has('moderator'),
      vip: broadcaster || badges.has('moderator') || badges.has('vip'),
      subscriber: broadcaster || badges.has('moderator') || badges.has('vip') || badges.has('subscriber') || badges.has('founder'),
    };
  }

  function permissionAllows(event, permissionLevel) {
    if (permissionLevel === 'everyone') return true;
    const roles = rolesForEvent(event);
    return !!roles[permissionLevel];
  }

  return {
    PERMISSION_LEVELS,
    BLACKLIST_TYPES,
    DUPLICATE_SCOPES,
    LIMITS,
    COMMAND_DEFINITIONS,
    getDefaults,
    getCommand,
    validateCommand,
    parseAliases,
    validateSettings,
    normalizeSettings,
    matchCommand,
    rolesForEvent,
    permissionAllows,
    normalizeBlacklistValue,
    activeBlacklistRules,
    findBlacklistMatch,
    clone,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TwitchRequestSettings;
