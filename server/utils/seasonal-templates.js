/**
 * 季節限定歌詞模板的總開關。
 *
 * 列在 OFF 的模板不會出現在面板／手機選單，也不會被伺服器接受或套用；
 * 程式、樣式、基準圖與每個模板自己存的設定全部保留，明年要推出時只要把 id 從這裡拿掉。
 * 已經選了該模板的舊存檔，載入時換回 FALLBACK_TEMPLATE（模板自己的設定不刪）。
 *
 * 面板與手機端的選項用 hidden 屬性藏起來（public/index.html、public/controller.html，
 * 標有 data-seasonal-off），重新開放時要一起拿掉。
 */

const SEASONAL_OFF_TEMPLATES = Object.freeze(['spellbook']);
const FALLBACK_TEMPLATE = 'classic';

function isTemplateOff(id) {
  return typeof id === 'string' && SEASONAL_OFF_TEMPLATES.includes(id);
}

function resolveTemplateId(id) {
  return isTemplateOff(id) ? FALLBACK_TEMPLATE : id;
}

module.exports = { SEASONAL_OFF_TEMPLATES, FALLBACK_TEMPLATE, isTemplateOff, resolveTemplateId };
