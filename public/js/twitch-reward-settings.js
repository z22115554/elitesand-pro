/**
 * Twitch 忠誠點數點歌獎勵的前後端共用契約。
 * rewardId 只保存由本 Twitch Client ID 建立、可完成與退款的專用獎勵。
 */
const TwitchRewardSettings = (() => {
  'use strict';

  const TITLE_MAX_LENGTH = 45;
  const PROMPT_MAX_LENGTH = 200;

  function getDefaults() {
    return {
      enabled: false,
      rewardId: '',
      title: '用忠誠點數點歌',
      prompt: '請貼上單一 YouTube 歌曲連結。主播確認匯入後才會完成兌換；拒絕或失敗會退還點數。',
      cost: 1000,
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

    if (errors.length) return { ok: false, errors, settings: null };
    return { ok: true, errors: [], settings: { enabled: value.enabled, rewardId, title, prompt, cost: value.cost } };
  }

  function normalizeSettings(value) {
    const defaults = getDefaults();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const validation = validateSettings({ ...defaults, ...value });
    return validation.ok ? validation.settings : defaults;
  }

  return { TITLE_MAX_LENGTH, PROMPT_MAX_LENGTH, getDefaults, validateSettings, normalizeSettings };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TwitchRewardSettings;
