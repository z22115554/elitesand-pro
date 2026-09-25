/**
 * 中秋募資活動：data/moon-event.json
 *
 * 月亮進度條＋燈籠名牌疊加層（/moon）的資料來源。斗內金額由主播／管理員在面板手動輸入，
 * 不串任何金流。跟 bgm-playlist.js 同一套慣例：獨立檔案、debounce 寫入、不進 playState。
 *
 * 限時活動：只在伺服器啟動當下判斷一次是否已過 EVENT_END。程式開著時跨過截止時間照常運作
 * （不在直播中途把功能拔掉），下次啟動才整個關閉；斗內紀錄檔保留不刪。
 */
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');

const log = createLogger('MoonEvent');
const FILE = path.join(DATA_DIR, 'moon-event.json');

const MAX_DONATIONS = 1000;
const MAX_NAME_LENGTH = 24;
const MAX_TITLE_LENGTH = 40;
const MAX_AMOUNT = 10_000_000;

const EVENT_END = Date.parse('2026-10-01T00:00:00+08:00');
const isActiveAt = (now) => now < EVENT_END;
const ACTIVE_AT_STARTUP = isActiveAt(Date.now());

// 由便宜到貴排列；自動模式取「門檻 ≤ 金額」裡門檻最高的那一種。
const LANTERN_STYLES = Object.freeze(['paper', 'red', 'pomelo', 'palace', 'rabbit']);
const DEFAULT_TIERS = Object.freeze({ paper: 1, red: 100, pomelo: 300, palace: 500, rabbit: 1000 });

const DEFAULTS = Object.freeze({
  title: '中秋團圓夜',
  doneText: '月圓了，謝謝大家！',
  goal: 5000,
  base: 0,
  tiers: DEFAULT_TIERS,
});

let config = { ...DEFAULTS };
let donations = [];
let _saveTimer = null;

const diskStore = createJsonStore({
  file: FILE,
  label: '中秋活動',
  defaultValue: () => ({ config: { ...DEFAULTS }, donations: [] }),
  serialize: (doc) => doc,
  deserialize: (document) => document,
  validate: (document) => document && typeof document === 'object' && Array.isArray(document.donations),
  logger: log,
});

function cleanAmount(value, { min = 0 } = {}) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min) return null;
  return Math.min(n, MAX_AMOUNT);
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function cleanTiers(input, fallback) {
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_TIERS;
  const tiers = {};
  for (const style of LANTERN_STYLES) {
    tiers[style] = cleanAmount(input?.[style], { min: 1 }) ?? cleanAmount(base[style], { min: 1 }) ?? DEFAULT_TIERS[style];
  }
  return tiers;
}

function autoStyle(amount) {
  let picked = null;
  for (const style of LANTERN_STYLES) {
    const min = config.tiers[style];
    if (amount >= min && (picked === null || min >= config.tiers[picked])) picked = style;
  }
  if (picked) return picked;
  return LANTERN_STYLES.reduce((low, style) => (config.tiers[style] < config.tiers[low] ? style : low));
}

function cleanStyle(value) {
  return LANTERN_STYLES.includes(value) ? value : null;
}

function cleanConfig(input, fallback) {
  const title = cleanText(input?.title, MAX_TITLE_LENGTH);
  const doneText = cleanText(input?.doneText, MAX_TITLE_LENGTH);
  const goal = cleanAmount(input?.goal, { min: 1 });
  const base = cleanAmount(input?.base);
  return {
    title: title || fallback.title,
    doneText: doneText || fallback.doneText || DEFAULTS.doneText,
    goal: goal ?? fallback.goal,
    base: base ?? fallback.base,
    tiers: cleanTiers(input?.tiers, fallback.tiers),
  };
}

function cleanDonation(raw) {
  const name = cleanText(raw?.name, MAX_NAME_LENGTH);
  const amount = cleanAmount(raw?.amount, { min: 1 });
  if (!name || amount === null) return null;
  const id = typeof raw?.id === 'string' && /^[a-f0-9]{8,32}$/.test(raw.id) ? raw.id : crypto.randomBytes(6).toString('hex');
  const at = Number.isFinite(raw?.at) ? raw.at : Date.now();
  const style = cleanStyle(raw?.style);
  return style ? { id, name, amount, at, style } : { id, name, amount, at };
}

(function load() {
  const loaded = diskStore.load();
  config = cleanConfig(loaded?.config, DEFAULTS);
  donations = (Array.isArray(loaded?.donations) ? loaded.donations : [])
    .map(cleanDonation).filter(Boolean).slice(-MAX_DONATIONS);
  log.info(`中秋活動已載入: ${donations.length} 筆斗內`);
})();

function saveNow() {
  _saveTimer = null;
  try {
    return diskStore.save({ config, donations });
  } catch (err) {
    log.warn(`中秋活動寫入失敗: ${err.message}`);
    return false;
  }
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 800);
}

function snapshot(extra) {
  const raised = donations.reduce((sum, d) => sum + d.amount, 0);
  return {
    ...config,
    raised,
    total: config.base + raised,
    endsAt: new Date(EVENT_END).toISOString(),
    donations: donations.map((d) => ({ ...d, style: d.style || autoStyle(d.amount), styleAuto: !d.style })),
    ...extra,
  };
}

function setConfig(input) {
  config = cleanConfig(input, config);
  scheduleSave();
  return { ok: true, state: snapshot() };
}

function addDonation(input) {
  const donation = cleanDonation({ name: input?.name, amount: input?.amount, style: input?.style });
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

function clearDonations() {
  donations = [];
  scheduleSave();
  return { ok: true, state: snapshot() };
}

process.on('exit', () => { if (_saveTimer) { clearTimeout(_saveTimer); try { saveNow(); } catch (e) { /* 靜默 */ } } });

module.exports = {
  snapshot, setConfig, addDonation, removeDonation, clearDonations, saveNow,
  isActive: () => ACTIVE_AT_STARTUP, isActiveAt, EVENT_END,
  MAX_NAME_LENGTH, MAX_TITLE_LENGTH, LANTERN_STYLES, DEFAULT_TIERS,
};
