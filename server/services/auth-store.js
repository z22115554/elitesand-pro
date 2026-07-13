/**
 * PIN 存取控制（選用）
 *
 * 伺服器綁 0.0.0.0，同區網任何裝置都能連進來操作。設定 PIN 後，
 * 面板／手機遙控器需要驗證過 PIN 才能執行會改動狀態的動作；
 * OBS 顯示來源（display/setlist）永遠豁免——那是唯讀疊加層，
 * 斷線或被擋住畫面直接消失在直播上，風險比「被陌生人亂改設定」還大。
 *
 * 儲存：scrypt 雜湊 + 隨機 salt，寫入 data/auth.json（不進 git，跟 state.json 同一層）。
 * 這不是高安全性場景（區網卡拉OK工具），純粹擋掉「同 Wi-Fi 路人隨手亂點」的程度，
 * 用 Node 內建 crypto 就夠，不需要 bcrypt 之類的外部依賴。
 */

const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');

const log = createLogger('Auth');

const { dataDir: DATA_DIR } = require('../utils/data-dir');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

const SALT_BYTES = 16;
const KEY_LEN = 32;

const authDiskStore = createJsonStore({
  file: AUTH_FILE,
  label: 'PIN 授權資料',
  defaultValue: null,
  mode: 0o600,
  migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, credentials: legacy })]]),
  serialize: (credentials) => ({ credentials }),
  deserialize: (document) => document.credentials,
  validate: (document) => {
    const value = document.credentials;
    return value && typeof value === 'object'
      && typeof value.hash === 'string' && typeof value.salt === 'string';
  },
  logger: log,
});

let cached = null; // { hash: hex, salt: hex } | null（null＝尚未設定 PIN，也代表「載入過但沒有」）
let loaded = false;

function loadFromDisk() {
  return authDiskStore.load();
}

function ensureLoaded() {
  if (!loaded) {
    cached = loadFromDisk();
    loaded = true;
  }
}

function hashPin(pin, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(String(pin), salt, KEY_LEN).toString('hex');
}

function hasPin() {
  ensureLoaded();
  return !!cached;
}

/**
 * 驗證 PIN 是否正確。未設定 PIN 時一律回傳 true（等同不保護）。
 */
function verifyPin(pin) {
  ensureLoaded();
  if (!cached) return true;
  if (typeof pin !== 'string' || !pin) return false;
  const candidate = hashPin(pin, cached.salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(cached.hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 設定或更改 PIN。若目前已有 PIN，呼叫端必須先驗證 currentPin 正確才能改。
 * @returns {{ok: boolean, message?: string}}
 */
function setPin(newPin, currentPin) {
  ensureLoaded();
  if (typeof newPin !== 'string' || newPin.length < 4 || newPin.length > 32) {
    return { ok: false, message: 'PIN 長度需為 4~32 字元' };
  }
  if (cached && !verifyPin(currentPin)) {
    return { ok: false, message: '目前的 PIN 不正確' };
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = hashPin(newPin, salt);
  cached = { hash, salt };
  if (!authDiskStore.save(cached)) return { ok: false, message: 'PIN 資料寫入失敗，請檢查資料夾權限或版本。' };
  log.info('PIN 已設定/更新');
  return { ok: true };
}

/**
 * 關閉 PIN 保護。需先驗證 currentPin 正確。
 */
function clearPin(currentPin) {
  ensureLoaded();
  if (!cached) return { ok: true }; // 本來就沒設定
  if (!verifyPin(currentPin)) {
    return { ok: false, message: '目前的 PIN 不正確' };
  }
  if (!authDiskStore.remove()) return { ok: false, message: 'PIN 檔案刪除失敗，請檢查資料夾權限或版本。' };
  cached = null;
  log.info('PIN 保護已關閉');
  return { ok: true };
}

module.exports = { hasPin, verifyPin, setPin, clearPin };
