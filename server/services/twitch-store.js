/**
 * Twitch OAuth 憑證的本機儲存。
 *
 * 只存 data/（已 gitignore）且不會透過 socket/API 回傳 access token 或 refresh token。
 * 原子寫入避免直播時斷電或強制重啟留下半份 JSON。
 */
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('TwitchStore');
const { dataDir: DATA_DIR } = require('../utils/data-dir');
const STORE_FILE = path.join(DATA_DIR, 'twitch-auth.json');

function load() {
  try {
    if (!fs.existsSync(STORE_FILE)) return null;
    const value = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    log.warn(`Twitch 授權資料讀取失敗：${err.message}`);
    return null;
  }
}

function save(value) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, STORE_FILE);
  } catch (err) {
    log.warn(`Twitch 授權資料寫入失敗：${err.message}`);
  }
}

function clear() {
  try {
    if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  } catch (err) {
    log.warn(`Twitch 授權資料清除失敗：${err.message}`);
  }
}

module.exports = { load, save, clear, STORE_FILE };
