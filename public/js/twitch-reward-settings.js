/**
 * Twitch 忠誠點數點歌獎勵的前後端共用契約。
 * rewardId 只保存由本 Twitch Client ID 建立、可完成與退款的專用獎勵。
 */
const TwitchRewardSettings = (() => {
  'use strict';

  const TITLE_MAX_LENGTH = 45;
  const PROMPT_MAX_LENGTH = 200;
  const GLOBAL_COOLDOWN_MIN_SECONDS = 60;
  const GLOBAL_COOLDOWN_MAX_SECONDS = 604800;

  function getDefaults() {
    return {
      enabled: false,
      rewardId: '',
      title: '用忠誠點數點歌',
      prompt: '請貼上單一 YouTube 歌曲連結。主播確認匯入後才會完成兌換；拒絕或失敗會退還點數。',
      cost: 1000,
      paused: false,
      maxPerStream: 0,
      maxPerUserPerStream: 0,
      globalCooldownSeconds: 0,
    };
  }

  function validateSettings(value) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: [{ field: 'settings', message: 'Twitch 忠誠點數設定格式無效。' }], settings: null };
    }
    if (typeof value.enabled !== 'boolean') errors.push({ field: 'enabled', message: '忠誠點數點歌開關格式無效。' });
    const rewardId = typeof value.rewardId === 'string' ? value.rewardId.trim() : '';
    if (rewardId && !/^[a-z0-9-]{8,80}$/i.test(rewardId)) errors.push({ field: 'rewardId', message: 'Twitch 獎勵識別碼格式無效。' });
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    if (!title) errors.push({ field: 'title', message: '獎勵名稱不可空白。' });
    if (Array.from(title).length > TITLE_MAX_LENGTH) errors.push({ field: 'title', message: `獎勵名稱最多 ${TITLE_MAX_LENGTH} 個字。` });
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    if (!prompt) errors.push({ field: 'prompt', message: '兌換說明不可空白。' });
    if (Array.from(prompt).length > PROMPT_MAX_LENGTH) errors.push({ field: 'prompt', message: `兌換說明最多 ${PROMPT_MAX_LENGTH} 個字。` });
    if (!Number.isSafeInteger(value.cost) || value.cost < 1) errors.push({ field: 'cost', message: '兌換點數必須是至少 1 的整數。' });
    if (typeof value.paused !== 'boolean') errors.push({ field: 'paused', message: '暫停兌換開關格式無效。' });
    if (!Number.isSafeInteger(value.maxPerStream) || value.maxPerStream < 0) errors.push({ field: 'maxPerStream', message: '每場兌換上限必須是 0 或正整數。' });
    if (!Number.isSafeInteger(value.maxPerUserPerStream) || value.maxPerUserPerStream < 0) errors.push({ field: 'maxPerUserPerStream', message: '每人每場上限必須是 0 或正整數。' });
    if (!Number.isSafeInteger(value.globalCooldownSeconds)
      || value.globalCooldownSeconds < 0
      || (value.globalCooldownSeconds > 0 && value.globalCooldownSeconds < GLOBAL_COOLDOWN_MIN_SECONDS)
      || value.globalCooldownSeconds > GLOBAL_COOLDOWN_MAX_SECONDS) {
      errors.push({ field: 'globalCooldownSeconds', message: `全域冷卻必須是 0，或 ${GLOBAL_COOLDOWN_MIN_SECONDS}～${GLOBAL_COOLDOWN_MAX_SECONDS} 秒的整數。` });
    }

    if (errors.length) return { ok: false, errors, settings: null };
    return {
      ok: true,
      errors: [],
      settings: {
        enabled: value.enabled,
        rewardId,
        title,
        prompt,
        cost: value.cost,
        paused: value.paused,
        maxPerStream: value.maxPerStream,
        maxPerUserPerStream: value.maxPerUserPerStream,
        globalCooldownSeconds: value.globalCooldownSeconds,
      },
    };
  }

  function normalizeSettings(value) {
    const defaults = getDefaults();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const validation = validateSettings({ ...defaults, ...value });
    return validation.ok ? validation.settings : defaults;
  }

  function fromTwitchReward(reward, fallback) {
    const base = normalizeSettings(fallback);
    if (!reward || typeof reward !== 'object' || Array.isArray(reward)) return base;
    const perStream = reward.max_per_stream_setting;
    const perUser = reward.max_per_user_per_stream_setting;
    const cooldown = reward.global_cooldown_setting;
    return normalizeSettings({
      ...base,
      rewardId: typeof reward.id === 'string' ? reward.id : base.rewardId,
      enabled: typeof reward.is_enabled === 'boolean' ? reward.is_enabled : base.enabled,
      title: typeof reward.title === 'string' ? reward.title : base.title,
      prompt: typeof reward.prompt === 'string' ? reward.prompt : base.prompt,
      cost: Number.isSafeInteger(reward.cost) ? reward.cost : base.cost,
      paused: typeof reward.is_paused === 'boolean' ? reward.is_paused : base.paused,
      maxPerStream: perStream?.is_enabled && Number.isSafeInteger(perStream.max_per_stream) ? perStream.max_per_stream : (perStream?.is_enabled === false ? 0 : base.maxPerStream),
      maxPerUserPerStream: perUser?.is_enabled && Number.isSafeInteger(perUser.max_per_user_per_stream) ? perUser.max_per_user_per_stream : (perUser?.is_enabled === false ? 0 : base.maxPerUserPerStream),
      globalCooldownSeconds: cooldown?.is_enabled && Number.isSafeInteger(cooldown.global_cooldown_seconds) ? cooldown.global_cooldown_seconds : (cooldown?.is_enabled === false ? 0 : base.globalCooldownSeconds),
    });
  }

  return {
    TITLE_MAX_LENGTH,
    PROMPT_MAX_LENGTH,
    GLOBAL_COOLDOWN_MIN_SECONDS,
    GLOBAL_COOLDOWN_MAX_SECONDS,
    getDefaults,
    validateSettings,
    normalizeSettings,
    fromTwitchReward,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TwitchRewardSettings;
