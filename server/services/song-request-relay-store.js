'use strict';

/**
 * 公開點歌頁中繼的本機設定：房間身分、密鑰與目前公開哪一份歌單。
 *
 * 只存 data/（已 gitignore），密鑰是重連中繼用的憑證，跟 twitch-store.js 的
 * 授權憑證一樣不透過 socket/API 回傳給前端。原子寫入避免直播時斷電留下半份 JSON。
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir: DATA_DIR } = require('../utils/app-paths');

const log = createLogger('SongRequestRelayStore');
const STORE_FILE = path.join(DATA_DIR, 'song-request-relay.json');

// publicSlug 同時是觀眾點歌頁的網址片段，也是 Cloudflare Durable Object 的識別名稱
// （Worker 端用 idFromName(publicSlug) 定位房間）——不需要另外維護一組內部 roomId，
// 知道 slug 不代表能建立中繼連線，連線仍要靠 secret 驗證。
function emptyState() {
  return {
    enabled: false,
    publicSlug: '',
    secret: '',
    publishedPlaylistId: '',
  };
}

function sanitize(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled === true,
    publicSlug: typeof source.publicSlug === 'string' ? source.publicSlug.slice(0, 128) : '',
    secret: typeof source.secret === 'string' ? source.secret.slice(0, 256) : '',
    publishedPlaylistId: typeof source.publishedPlaylistId === 'string' ? source.publishedPlaylistId.slice(0, 128) : '',
  };
}

const diskStore = createJsonStore({
  file: STORE_FILE,
  label: '公開點歌頁設定',
  defaultValue: emptyState,
  mode: 0o600,
  serialize: (state) => ({ state: sanitize(state) }),
  deserialize: (document) => sanitize(document.state),
  validate: (document) => document.state && typeof document.state === 'object' && !Array.isArray(document.state),
  logger: log,
});

function load() {
  return diskStore.load() || emptyState();
}

function save(state) {
  return diskStore.save(state);
}

module.exports = { load, save, emptyState, STORE_FILE };
