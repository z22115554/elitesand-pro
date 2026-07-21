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
  const LIMITS = Object.freeze({ aliases: 5, cooldownSeconds: 600, maxPending: 50, perUserPending: 10, maxDurationMinutes: 180 });

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function getDefaults() {
    return {
      enabled: true,
      command: '!點歌',
      aliases: [],
      permissionLevel: 'everyone',
      cooldownSeconds: 0,
      maxPending: 20,
      perUserPending: 0,
      rejectDuplicates: true,
      maxDurationMinutes: 0,
    };
  }

  function validateCommand(value) {
    const command = typeof value === 'string' ? value.trim() : '';
    if (!command) return { valid: false, error: '點歌指令不可空白。', command };
    if (!command.startsWith('!')) return { valid: false, error: '點歌指令必須以 ! 開頭。', command };
    if (Array.from(command).length > 20) return { valid: false, error: '點歌指令最多 20 個字。', command };
    if (command === '!' || /\s/u.test(command) || command.slice(1).includes('!')) {
      return { valid: false, error: '點歌指令不可包含空白或第二個 !。', command };
    }
    return { valid: true, error: '', command };
  }

  function parseAliases(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    return String(value || '').split(/[,，\n]/u).map((item) => item.trim()).filter(Boolean);
  }

  function validateSettings(value) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: [{ field: 'settings', message: 'Twitch 點歌設定格式無效。' }], settings: null };
    }
    if (typeof value.enabled !== 'boolean') errors.push({ field: 'enabled', message: '點歌總開關格式無效。' });
    const commandResult = validateCommand(value.command);
    if (!commandResult.valid) errors.push({ field: 'command', message: commandResult.error });
    const aliases = parseAliases(value.aliases);
    if (aliases.length > LIMITS.aliases) errors.push({ field: 'aliases', message: `別名最多 ${LIMITS.aliases} 個。` });
    const normalizedNames = [commandResult.command, ...aliases].map((item) => item.toLocaleLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) errors.push({ field: 'aliases', message: '主指令與別名不可重複。' });
    aliases.forEach((alias) => {
      const result = validateCommand(alias);
      if (!result.valid) errors.push({ field: 'aliases', message: `別名「${alias}」：${result.error}` });
    });
    if (!PERMISSION_KEYS.has(value.permissionLevel)) errors.push({ field: 'permissionLevel', message: '使用者資格格式無效。' });

    const integerRule = (field, label, min, max) => {
      if (!Number.isInteger(value[field]) || value[field] < min || value[field] > max) {
        errors.push({ field, message: `${label}必須是 ${min}–${max} 的整數。` });
      }
    };
    integerRule('cooldownSeconds', '每人冷卻秒數', 0, LIMITS.cooldownSeconds);
    integerRule('maxPending', '待確認總上限', 1, LIMITS.maxPending);
    integerRule('perUserPending', '每人待確認上限', 0, LIMITS.perUserPending);
    integerRule('maxDurationMinutes', '歌曲長度上限', 0, LIMITS.maxDurationMinutes);
    if (typeof value.rejectDuplicates !== 'boolean') errors.push({ field: 'rejectDuplicates', message: '重複歌曲規則格式無效。' });

    if (errors.length) return { ok: false, errors, settings: null };
    return {
      ok: true,
      errors: [],
      settings: {
        enabled: value.enabled,
        command: commandResult.command,
        aliases,
        permissionLevel: value.permissionLevel,
        cooldownSeconds: value.cooldownSeconds,
        maxPending: value.maxPending,
        perUserPending: value.perUserPending,
        rejectDuplicates: value.rejectDuplicates,
        maxDurationMinutes: value.maxDurationMinutes,
      },
    };
  }

  function normalizeSettings(value) {
    const defaults = getDefaults();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const candidate = {
      ...defaults,
      ...value,
      aliases: parseAliases(value.aliases),
    };
    const validation = validateSettings(candidate);
    return validation.ok ? validation.settings : defaults;
  }

  function matchCommand(text, settings) {
    const normalized = normalizeSettings(settings);
    const input = String(text || '').trim();
    const commands = [normalized.command, ...normalized.aliases].sort((a, b) => b.length - a.length);
    for (const command of commands) {
      if (input.toLocaleLowerCase() === command.toLocaleLowerCase()) return { command, argument: '' };
      const prefix = `${command} `;
      if (input.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
        return { command, argument: input.slice(prefix.length).trim() };
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
    getDefaults,
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
