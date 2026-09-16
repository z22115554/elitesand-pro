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
    isCustomSlug: false,
    customSlugAttempts: 0,
  };
}

function sanitize(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled === true,
    publicSlug: typeof source.publicSlug === 'string' ? source.publicSlug.slice(0, 128) : '',
    secret: typeof source.secret === 'string' ? source.secret.slice(0, 256) : '',
    publishedPlaylistId: typeof source.publishedPlaylistId === 'string' ? source.publishedPlaylistId.slice(0, 128) : '',
    // 2026-09-17：目前 slug 是不是使用者自己選的（vanity slug），以及一共用掉幾次自訂
    // 機會——上限見 song-request-relay-service.js 的 MAX_CUSTOM_SLUG_ATTEMPTS，避免使用者
    // 手滑反覆改字串，永久佔用一堆沒人用的網址（沒有帳號系統，佔用了就收不回來）。
    isCustomSlug: source.isCustomSlug === true,
    customSlugAttempts: Number.isFinite(source.customSlugAttempts) ? Math.max(0, Math.floor(source.customSlugAttempts)) : 0,
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

// code review 2026-09-15：待處理的觀眾點歌請求原本只存在記憶體，程式重開（更新、
// 當機、手動重啟）就整批消失、主播跟觀眾都不會知道。跟 twitch-requests.json
// （twitch-request-store.js）同一個模式，獨立一份檔案、只存陣列。
const PENDING_STORE_FILE = path.join(DATA_DIR, 'song-request-relay-pending.json');
const MAX_PERSISTED_PENDING = 50; // 遠高於服務層自己的 MAX_PENDING_REQUESTS（20），純防呆

function sanitizePendingRequest(item) {
  if (!item || typeof item !== 'object') return null;
  const requestId = typeof item.requestId === 'string' ? item.requestId.slice(0, 64) : '';
  const catalogTrackId = typeof item.catalogTrackId === 'string' ? item.catalogTrackId.slice(0, 128) : '';
  if (!requestId || !catalogTrackId) return null;
  return {
    requestId,
    catalogTrackId,
    title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
    artist: typeof item.artist === 'string' ? item.artist.slice(0, 200) : '',
    displayName: typeof item.displayName === 'string' ? item.displayName.slice(0, 60) : '',
    note: typeof item.note === 'string' ? item.note.slice(0, 140) : '',
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
  };
}

const pendingDiskStore = createJsonStore({
  file: PENDING_STORE_FILE,
  label: '公開點歌頁待處理請求',
  defaultValue: () => [],
  mode: 0o600,
  migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, requests: Array.isArray(legacy) ? legacy : [] })]]),
  serialize: (requests) => ({ requests: requests.map(sanitizePendingRequest).filter(Boolean).slice(0, MAX_PERSISTED_PENDING) }),
  deserialize: (document) => document.requests.map(sanitizePendingRequest).filter(Boolean),
  validate: (document) => Array.isArray(document.requests),
  logger: log,
});

function loadPending() {
  return pendingDiskStore.load();
}

function savePending(requests) {
  return pendingDiskStore.save(requests);
}

module.exports = {
  load, save, emptyState, STORE_FILE, loadPending, savePending, PENDING_STORE_FILE,
};
