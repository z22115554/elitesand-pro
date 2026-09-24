/**
 * 中秋募資活動：data/moon-event.json
 *
 * 月亮進度條＋燈籠名牌疊加層（/moon）的資料來源。斗內金額由主播／管理員在面板手動輸入，
 * 不串任何金流。跟 bgm-playlist.js 同一套慣例：獨立檔案、debounce 寫入、不進 playState。
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

const DEFAULTS = Object.freeze({
  title: '中秋團圓夜',
  doneText: '月圓了，謝謝大家！',
  goal: 5000,
  base: 0,
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
  };
}

function cleanDonation(raw) {
  const name = cleanText(raw?.name, MAX_NAME_LENGTH);
  const amount = cleanAmount(raw?.amount, { min: 1 });
  if (!name || amount === null) return null;
  const id = typeof raw?.id === 'string' && /^[a-f0-9]{8,32}$/.test(raw.id) ? raw.id : crypto.randomBytes(6).toString('hex');
  const at = Number.isFinite(raw?.at) ? raw.at : Date.now();
  return { id, name, amount, at };
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
    donations: donations.slice(),
    ...extra,
  };
}

function setConfig(input) {
  config = cleanConfig(input, config);
  scheduleSave();
  return { ok: true, state: snapshot() };
}

function addDonation(input) {
  const donation = cleanDonation({ name: input?.name, amount: input?.amount });
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
  MAX_NAME_LENGTH, MAX_TITLE_LENGTH,
};
