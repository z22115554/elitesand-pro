/**
 * 限時節慶募資活動的共用核心（中秋月亮、萬聖節南瓜燈……）。
 *
 * 每個活動只是一份設定：存檔名、截止時間、名牌樣式與門檻、預設文案、可調大小的欄位。
 * 斗內金額由主播／管理員在面板手動輸入，不串任何金流。跟 bgm-playlist.js 同一套慣例：
 * 獨立檔案、debounce 寫入、不進 playState。
 *
 * 限時活動：只在建立當下（伺服器啟動時）判斷一次是否已過截止時間。程式開著時跨過截止
 * 時間照常運作（不在直播中途把功能拔掉），下次啟動才整個關閉；斗內紀錄檔保留不刪。
 */
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');

const MAX_DONATIONS = 1000;
const MAX_NAME_LENGTH = 24;
const MAX_TITLE_LENGTH = 40;
const MAX_AMOUNT = 10_000_000;
const SCALE_MIN = 0.6;
const SCALE_MAX = 2.5;

function cleanAmount(value, { min = 0 } = {}) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min) return null;
  return Math.min(n, MAX_AMOUNT);
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function cleanScale(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number.isFinite(fallback) ? fallback : 1;
  return Math.round(Math.min(Math.max(n, SCALE_MIN), SCALE_MAX) * 100) / 100;
}

/**
 * @param {object} options
 * @param {string} options.fileName  data/ 底下的存檔名
 * @param {string} options.label     存檔錯誤與日誌訊息裡的活動名稱
 * @param {string} options.logTag    日誌標籤（例如 MoonEvent）
 * @param {string} options.endsAt    截止時間（ISO，含時區）
 * @param {string[]} options.styles  名牌樣式，由便宜到貴排列
 * @param {Record<string, number>} options.defaultTiers 每種樣式的預設門檻
 * @param {{ title: string, doneText: string, goal: number, base: number }} options.defaults
 * @param {string[]} options.scaleKeys 可在面板調整大小的設定欄位（預設 1，範圍 0.6～2.5）
 * @param {string[]} [options.ingredients] 選用：每筆斗內可帶一種「材料」（萬聖節大鍋）。有給時名牌樣式
 *   預設由材料決定；styleByAmount 開啟時，材料與金額分級各自計算。
 * @param {boolean} [options.styleByAmount] 材料活動的名牌仍依金額門檻判定
 * @param {string} [options.plainStyle] 沒選材料的斗內用的名牌樣式
 */
function createSeasonalEvent({ fileName, label, logTag, endsAt, styles, defaultTiers, defaults, scaleKeys = [], ingredients = null, plainStyle = null, styleByAmount = false }) {
  const log = createLogger(logTag);
  const FILE = path.join(DATA_DIR, fileName);
  const EVENT_END = Date.parse(endsAt);
  if (!Number.isFinite(EVENT_END)) throw new Error(`${label} 截止時間無效：${endsAt}`);
  const isActiveAt = (now) => now < EVENT_END;
  const ACTIVE_AT_STARTUP = isActiveAt(Date.now());

  const STYLES = Object.freeze([...styles]);
  const amountStyles = styleByAmount ? STYLES.filter((style) => style !== plainStyle) : STYLES;
  const DEFAULT_TIERS = Object.freeze({ ...defaultTiers });
  const DEFAULTS = Object.freeze({
    ...defaults,
    tiers: DEFAULT_TIERS,
    ...Object.fromEntries(scaleKeys.map((key) => [key, 1])),
  });

  const INGREDIENTS = Array.isArray(ingredients) ? Object.freeze([...ingredients]) : null;

  let config = { ...DEFAULTS };
  let donations = [];
  let saveTimer = null;
  // 選用：外掛模組（萬聖節大鍋）在快照上加自己的欄位；不設就是原樣。
  let decorate = null;

  const diskStore = createJsonStore({
    file: FILE,
    label,
    defaultValue: () => ({ config: { ...DEFAULTS }, donations: [] }),
    serialize: (doc) => doc,
    deserialize: (document) => document,
    validate: (document) => document && typeof document === 'object' && Array.isArray(document.donations),
    logger: log,
  });

  function cleanTiers(input, fallback) {
    const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_TIERS;
    const tiers = {};
    for (const style of STYLES) {
      tiers[style] = cleanAmount(input?.[style], { min: 1 }) ?? cleanAmount(base[style], { min: 1 }) ?? DEFAULT_TIERS[style];
    }
    return tiers;
  }

  // 自動模式取「門檻 ≤ 金額」裡門檻最高的那一種；都不到就用門檻最低的。
  function autoStyle(amount) {
    let picked = null;
    for (const style of amountStyles) {
      const min = config.tiers[style];
      if (amount >= min && (picked === null || min >= config.tiers[picked])) picked = style;
    }
    if (picked) return picked;
    return amountStyles.reduce((low, style) => (config.tiers[style] < config.tiers[low] ? style : low));
  }

  function cleanStyle(value) {
    return STYLES.includes(value) ? value : null;
  }

  function cleanConfig(input, fallback) {
    const title = cleanText(input?.title, MAX_TITLE_LENGTH);
    const doneText = cleanText(input?.doneText, MAX_TITLE_LENGTH);
    const goal = cleanAmount(input?.goal, { min: 1 });
    const base = cleanAmount(input?.base);
    const next = {
      title: title || fallback.title,
      doneText: doneText || fallback.doneText || DEFAULTS.doneText,
      goal: goal ?? fallback.goal,
      base: base ?? fallback.base,
      tiers: cleanTiers(input?.tiers, fallback.tiers),
      ...(styleByAmount ? { tagTiersVersion: 1 } : {}),
    };
    for (const key of scaleKeys) next[key] = cleanScale(input?.[key], fallback[key]);
    return next;
  }

  function cleanDonation(raw) {
    const name = cleanText(raw?.name, MAX_NAME_LENGTH);
    const amount = cleanAmount(raw?.amount, { min: 1 });
    if (!name || amount === null) return null;
    const id = typeof raw?.id === 'string' && /^[a-f0-9]{8,32}$/.test(raw.id) ? raw.id : crypto.randomBytes(6).toString('hex');
    const at = Number.isFinite(raw?.at) ? raw.at : Date.now();
    if (INGREDIENTS) {
      const ingredient = cleanIngredient(raw?.ingredient);
      return ingredient ? { id, name, amount, at, ingredient } : { id, name, amount, at };
    }
    const style = cleanStyle(raw?.style);
    return style ? { id, name, amount, at, style } : { id, name, amount, at };
  }

  function cleanIngredient(value) {
    return INGREDIENTS && INGREDIENTS.includes(value) ? value : null;
  }

  // 金額分級與材料獨立：改材料不會改掉贊助等級。
  function styleOf(d) {
    if (styleByAmount) return { style: autoStyle(d.amount), styleAuto: true };
    if (INGREDIENTS) return { style: d.ingredient || plainStyle, styleAuto: false };
    return { style: d.style || autoStyle(d.amount), styleAuto: !d.style };
  }

  (function load() {
    const loaded = diskStore.load();
    config = cleanConfig(loaded?.config, DEFAULTS);
    // 大鍋舊版把所有門檻固定成 1；只在第一次恢復金額分級時換回預設。
    // 已有自訂門檻保留；新版刻意設成全部 1 的設定也可正常重載。
    if (styleByAmount && loaded?.config && loaded.config.tagTiersVersion !== 1
      && amountStyles.every((style) => loaded.config.tiers?.[style] === 1)) {
      config.tiers = { ...DEFAULT_TIERS };
    }
    donations = (Array.isArray(loaded?.donations) ? loaded.donations : [])
      .map(cleanDonation).filter(Boolean).slice(-MAX_DONATIONS);
    log.info(`${label}已載入: ${donations.length} 筆斗內`);
  })();

  function saveNow() {
    saveTimer = null;
    try {
      return diskStore.save({ config, donations });
    } catch (err) {
      log.warn(`${label}寫入失敗: ${err.message}`);
      return false;
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  function snapshot(extra) {
    const raised = donations.reduce((sum, d) => sum + d.amount, 0);
    const base = {
      ...config,
      raised,
      total: config.base + raised,
      endsAt: new Date(EVENT_END).toISOString(),
      donations: donations.map((d) => ({ ...d, ...styleOf(d) })),
      ...extra,
    };
    return decorate ? decorate(base) : base;
  }

  function setDecorator(fn) {
    decorate = typeof fn === 'function' ? fn : null;
  }

  function setConfig(input) {
    config = cleanConfig(input, config);
    scheduleSave();
    return { ok: true, state: snapshot() };
  }

  function addDonation(input) {
    const donation = cleanDonation({ name: input?.name, amount: input?.amount, style: input?.style, ingredient: input?.ingredient });
    if (!donation) return { ok: false, error: '請填寫名字與大於 0 的金額' };
    donations.push(donation);
    if (donations.length > MAX_DONATIONS) donations = donations.slice(-MAX_DONATIONS);
    scheduleSave();
    return { ok: true, state: snapshot({ latestId: donation.id }) };
  }

  function removeDonation(id) {
    const before = donations.length;
    donations = donations.filter((d) => d.id !== id);
    if (donations.length === before) return { ok: false, error: '找不到這筆斗內' };
    scheduleSave();
    return { ok: true, state: snapshot() };
  }

  // 事後改材料（記帳時忘了選）。只開放材料欄位；名字與金額改錯就刪掉重記。
  function updateDonation(input) {
    if (!INGREDIENTS) return { ok: false, error: '這個活動沒有材料可以改' };
    const donation = donations.find((d) => d.id === String(input?.id || ''));
    if (!donation) return { ok: false, error: '找不到這筆斗內' };
    const ingredient = cleanIngredient(input?.ingredient);
    if (ingredient) donation.ingredient = ingredient;
    else delete donation.ingredient;
    scheduleSave();
    return { ok: true, state: snapshot() };
  }

  function clearDonations() {
    donations = [];
    scheduleSave();
    return { ok: true, state: snapshot() };
  }

  process.on('exit', () => { if (saveTimer) { clearTimeout(saveTimer); try { saveNow(); } catch (e) { /* 靜默 */ } } });

  return {
    snapshot, setConfig, addDonation, updateDonation, removeDonation, clearDonations, saveNow, setDecorator,
    isActive: () => ACTIVE_AT_STARTUP, isActiveAt, EVENT_END,
    MAX_NAME_LENGTH, MAX_TITLE_LENGTH, STYLES, DEFAULT_TIERS, INGREDIENTS,
  };
}

module.exports = { createSeasonalEvent, MAX_NAME_LENGTH, MAX_TITLE_LENGTH };
