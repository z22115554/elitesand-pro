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
  });
  const COMMAND_DEFINITIONS = Object.freeze([
    { key: 'request', label: '點歌', description: '送出一個 YouTube 單曲連結，等待主播確認。', command: '!點歌', userCooldownSeconds: 0, globalCooldownSeconds: 0 },
    { key: 'currentSong', label: '目前歌曲', description: '查詢現在載入或播放中的歌曲。', command: '!目前歌曲', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'nextSong', label: '下一首', description: '查詢播放清單中的下一首歌。', command: '!下一首', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'myRequests', label: '我的點歌', description: '列出自己仍在待確認區的點歌。', command: '!我的點歌', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'position', label: '順位', description: '查詢自己最新一筆待確認點歌的順位。', command: '!順位', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'cancelRequest', label: '取消點歌', description: '取消自己最新一筆尚未匯入的點歌。', command: '!取消點歌', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
    { key: 'rules', label: '點歌規則', description: '查看目前點歌指令、資格與主要限制。', command: '!點歌規則', userCooldownSeconds: 15, globalCooldownSeconds: 3 },
    { key: 'queueSummary', label: '歌單摘要', description: '查看目前、下一首與待確認數量，不會貼本機網址。', command: '!歌單', userCooldownSeconds: 10, globalCooldownSeconds: 2 },
  ]);
  const COMMAND_KEYS = new Set(COMMAND_DEFINITIONS.map((item) => item.key));

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function defaultCommand(definition) {
    return {
      enabled: true,
      command: definition.command,
      aliases: [],
      permissionLevel: 'everyone',
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
      rejectDuplicates: true,
      maxDurationMinutes: 0,
    };
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
    if (typeof value.rejectDuplicates !== 'boolean') errors.push({ field: 'rejectDuplicates', message: '重複歌曲規則格式無效。' });

    if (errors.length) return { ok: false, errors, settings: null };
    return {
      ok: true,
      errors: [],
      settings: {
        enabled: value.enabled,
        commands: normalizedCommands,
        maxPending: value.maxPending,
        perUserPending: value.perUserPending,
        rejectDuplicates: value.rejectDuplicates,
        maxDurationMinutes: value.maxDurationMinutes,
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
        candidates.push({ key: definition.key, command, settings: commandSettings });
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
    clone,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TwitchRequestSettings;
