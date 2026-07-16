/**
 * Twitch OAuth 憑證的本機儲存。
 *
 * 只存 data/（已 gitignore）且不會透過 socket/API 回傳 access token 或 refresh token。
 * 原子寫入避免直播時斷電或強制重啟留下半份 JSON。
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');

const log = createLogger('TwitchStore');
const { dataDir: DATA_DIR } = require('../utils/app-paths');
const STORE_FILE = path.join(DATA_DIR, 'twitch-auth.json');

const twitchDiskStore = createJsonStore({
  file: STORE_FILE,
  label: 'Twitch 授權資料',
  defaultValue: null,
  mode: 0o600,
  migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, credentials: legacy })]]),
  serialize: (credentials) => ({ credentials }),
  deserialize: (document) => document.credentials,
  validate: (document) => document.credentials && typeof document.credentials === 'object' && !Array.isArray(document.credentials),
  logger: log,
});

function load() {
  return twitchDiskStore.load();
}

function save(value) {
  return twitchDiskStore.save(value);
}

function clear() {
  return twitchDiskStore.remove();
}

module.exports = { load, save, clear, STORE_FILE };
