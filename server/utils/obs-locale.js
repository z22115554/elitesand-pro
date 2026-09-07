/**
 * OBS 疊加層顯示語言的驗證與換算（server 是唯一強制點，鐵則 1）。
 *
 * 兩個獨立的值：
 * - mode：使用者在面板選的「OBS 顯示語言」，'follow' 或某個語言代碼。
 * - panelLocale：面板當下的介面語言。面板語言是裝置端偏好（localStorage），
 *   OBS 是另一個瀏覽器 profile 讀不到，所以由面板推上來存進 state。
 *
 * 語言清單刻意在這裡自己列一份，不 require('../../public/js/i18n')：
 * 打包時面板的 <script> 會被合併進各頁 bundle、原始檔隨即刪除，只有
 * build-production-bundles.js 的 SERVER_REQUIRED_PUBLIC_JS 白名單裡的同構模組會留下。
 * i18n.js 是一整份翻譯表（上千條字串），為了 6 個語言代碼把它整份留在安裝目錄不划算；
 * server 要的也只有代碼本身，不是譯文。兩邊的清單由 tests/run-tests.js 比對，會漂就紅。
 */

const FOLLOW = 'follow';
const LOCALES = ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'];
const DEFAULT_LOCALE = 'zh-TW';

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
