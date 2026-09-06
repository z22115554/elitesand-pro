/**
 * OBS 疊加層顯示語言的驗證與換算（server 是唯一強制點，鐵則 1）。
 *
 * 兩個獨立的值：
 * - mode：使用者在面板選的「OBS 顯示語言」，'follow' 或某個語言代碼。
 * - panelLocale：面板當下的介面語言。面板語言是裝置端偏好（localStorage），
 *   OBS 是另一個瀏覽器 profile 讀不到，所以由面板推上來存進 state。
 *
 * 語言清單直接取自 public/js/i18n.js，不在這裡再抄一份（抄了就會漂）。
 */

const i18n = require('../../public/js/i18n');

const FOLLOW = 'follow';
const LOCALES = i18n.LOCALES.slice();
const DEFAULT_LOCALE = i18n.DEFAULT_LOCALE;

/** 使用者選的模式；認不得的一律退回 follow（不是退回中文——退回中文會蓋掉面板語言）。 */
function normalizeMode(value) {
  if (value === FOLLOW) return FOLLOW;
  return LOCALES.includes(value) ? value : FOLLOW;
}

/** 面板推上來的介面語言；認不得就用預設語言。 */
function normalizeLocale(value) {
  return LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

/** OBS 端實際該用的語言。 */
function effectiveLocale(mode, panelLocale) {
  const m = normalizeMode(mode);
  return m === FOLLOW ? normalizeLocale(panelLocale) : m;
}

module.exports = { FOLLOW, LOCALES, DEFAULT_LOCALE, normalizeMode, normalizeLocale, effectiveLocale };
