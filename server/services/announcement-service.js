'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { dataDir } = require('../utils/data-dir');
const { compareVersions } = require('../utils/version-compare');
const { createLogger } = require('../utils/logger');
const config = require('../utils/load-config');
const pkg = require('../../package.json');

const log = createLogger('Announcements');
const CACHE_FILE = path.join(dataDir, 'announcement-cache.json');
const STATE_FILE = path.join(dataDir, 'announcement-state.json');
const MAX_JSON_BYTES = 256 * 1024;
const MAX_ANNOUNCEMENTS = 100;
const LEVELS = new Set(['info', 'warning', 'critical']);
const ACTIONS = new Set(['disableIncrementalUpdate', 'showFullDownloadOnly']);

let cache = { schemaVersion: 1, fetchedAt: null, announcements: [] };
let state = { dismissed: [], shownOnce: [], read: [] };
let inFlight = null;
let lastAttemptAt = 0;

function readLocalJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (err) {
    log.warn(`本機公告資料讀取失敗（安全忽略）：${path.basename(file)}: ${err.message}`);
    return fallback;
  }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter((item) => typeof item === 'string').slice(-500))];
}

function loadLocalData() {
  const loadedCache = readLocalJson(CACHE_FILE, cache);
  if (loadedCache.schemaVersion === 1 && Array.isArray(loadedCache.announcements)) cache = loadedCache;
  const loadedState = readLocalJson(STATE_FILE, state);
  state = {
    dismissed: uniqueStrings(loadedState.dismissed),
    shownOnce: uniqueStrings(loadedState.shownOnce),
    read: uniqueStrings(loadedState.read),
  };
}

loadLocalData();

function boundedText(value, maxLength, required = false) {
  if (typeof value !== 'string') return required ? null : '';
  const text = value.trim();
  if ((required && !text) || text.length > maxLength) return null;
  return text;
}

function validDate(value, required = false) {
  if (value === undefined || value === null || value === '') return required ? null : '';
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function validHttpsUrl(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch (_) { return null; }
}

function sanitizeAnnouncement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = boundedText(input.id, 100, true);
  const title = boundedText(input.title, 160, true);
  const message = boundedText(input.message, 2000, true);
  const buttonText = boundedText(input.buttonText, 60, false);
  const publishedAt = validDate(input.publishedAt, false);
  const expiresAt = validDate(input.expiresAt, false);
  const url = validHttpsUrl(input.url);
  const minVersion = boundedText(input.minVersion, 40, false);
  const maxVersion = boundedText(input.maxVersion, 40, false);
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || !title || !message || buttonText === null
      || publishedAt === null || expiresAt === null || url === null || minVersion === null || maxVersion === null
      || (minVersion && !/^v?\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(minVersion))
      || (maxVersion && !/^v?\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(maxVersion))
      || !LEVELS.has(input.level)) return null;
  if (input.dismissible !== undefined && typeof input.dismissible !== 'boolean') return null;
  if (input.showOnce !== undefined && typeof input.showOnce !== 'boolean') return null;
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return null;
  if (publishedAt && expiresAt && Date.parse(expiresAt) <= Date.parse(publishedAt)) return null;

  const actions = {};
  if (input.actions && typeof input.actions === 'object' && !Array.isArray(input.actions)) {
    for (const key of ACTIONS) {
      if (input.actions[key] === true) actions[key] = true;
      else if (input.actions[key] === false) actions[key] = false;
    }
  }

  return {
    id,
    level: input.level,
    title,
    message,
    minVersion: minVersion || '',
    maxVersion: maxVersion || '',
    publishedAt,
    expiresAt,
    dismissible: input.dismissible !== false,
    showOnce: input.showOnce === true,
    url,
    buttonText: buttonText || '',
    enabled: input.enabled !== false,
    actions,
  };
}

function validateDocument(input) {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.announcements)) throw new Error('公告 JSON schemaVersion 或 announcements 格式無效');
  if (input.announcements.length > MAX_ANNOUNCEMENTS) throw new Error('公告數量超過上限');
  const announcements = [];
  const ids = new Set();
  for (const raw of input.announcements) {
    const announcement = sanitizeAnnouncement(raw);
    if (!announcement) throw new Error('公告含無效欄位、非 HTTPS URL 或過長內容');
    if (ids.has(announcement.id)) throw new Error(`公告 id 重複：${announcement.id}`);
    ids.add(announcement.id);
    announcements.push(announcement);
  }
  return { schemaVersion: 1, announcements };
}

function versionMatches(announcement, currentVersion = pkg.version) {
  if (announcement.minVersion && compareVersions(currentVersion, announcement.minVersion) < 0) return false;
  if (announcement.maxVersion && compareVersions(currentVersion, announcement.maxVersion) > 0) return false;
  return true;
}

function isCurrentlyActive(announcement, now = Date.now(), currentVersion = pkg.version) {
  if (!announcement.enabled || !versionMatches(announcement, currentVersion)) return false;
  if (announcement.publishedAt && Date.parse(announcement.publishedAt) > now) return false;
  if (announcement.expiresAt && Date.parse(announcement.expiresAt) <= now) return false;
  return true;
}

async function fetchJsonDocument(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Elitesand-Pro-Announcements' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_JSON_BYTES) throw new Error('公告 JSON 超過大小上限');
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > MAX_JSON_BYTES) { controller.abort(); throw new Error('公告 JSON 超過大小上限'); }
      chunks.push(chunk);
    }
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { throw new Error('公告 JSON 解析失敗'); }
    return validateDocument(parsed);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('公告請求逾時');
    throw err;
  } finally { clearTimeout(timer); }
}

async function refresh({ force = false } = {}) {
  const url = config.announcementUrl;
  if (!url) return { ok: false, error: '未設定公告來源', fromCache: true };
  if (validHttpsUrl(url) === null) return { ok: false, error: '公告來源必須使用 HTTPS', fromCache: true };
  const interval = Number(config.announcementCheckIntervalMs) || 30 * 60 * 1000;
  if (!force && Date.now() - lastAttemptAt < interval) return { ok: true, fromCache: true };
  if (inFlight) return inFlight;
  lastAttemptAt = Date.now();
  inFlight = (async () => {
    try {
      const document = await fetchJsonDocument(url);
      cache = { ...document, fetchedAt: new Date().toISOString() };
      atomicWrite(CACHE_FILE, cache);
      log.info(`遠端公告更新完成：${cache.announcements.length} 則`);
      return { ok: true, fromCache: false };
    } catch (err) {
      log.warn(`遠端公告取得失敗（沿用安全快取，不影響啟動）：${err.message}`);
      return { ok: false, error: err.message, fromCache: true };
    } finally { inFlight = null; }
  })();
  return inFlight;
}

function getSnapshot({ now = Date.now(), currentVersion = pkg.version } = {}) {
  const dismissed = new Set(state.dismissed);
  const shownOnce = new Set(state.shownOnce);
  const read = new Set(state.read);
  const recent = cache.announcements
    .filter((announcement) => isCurrentlyActive(announcement, now, currentVersion))
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
    .map((announcement) => ({
      ...announcement,
      read: read.has(announcement.id),
      dismissed: dismissed.has(announcement.id),
      shouldPresent: !dismissed.has(announcement.id) && !(announcement.showOnce && shownOnce.has(announcement.id)),
    }));
  const actions = {};
  for (const announcement of recent) {
    if (announcement.level !== 'critical') continue;
    for (const key of ACTIONS) if (announcement.actions[key] === true) actions[key] = true;
  }
  return {
    enabled: !!config.announcementUrl,
    currentVersion,
    fetchedAt: cache.fetchedAt,
    announcements: recent,
    actions,
  };
}

function findActive(id) {
  return getSnapshot().announcements.find((announcement) => announcement.id === id) || null;
}

function persistState() {
  state = {
    dismissed: uniqueStrings(state.dismissed),
    shownOnce: uniqueStrings(state.shownOnce),
    read: uniqueStrings(state.read),
  };
  atomicWrite(STATE_FILE, state);
}

function markSeen(id) {
  const announcement = findActive(id);
  if (!announcement) return { ok: false, reason: '公告不存在或已失效' };
  state.read.push(id);
  if (announcement.showOnce) state.shownOnce.push(id);
  persistState();
  return { ok: true };
}

function dismiss(id) {
  const announcement = findActive(id);
  if (!announcement) return { ok: false, reason: '公告不存在或已失效' };
  if (!announcement.dismissible) return { ok: false, reason: '此公告不可關閉' };
  state.dismissed.push(id);
  state.read.push(id);
  persistState();
  return { ok: true };
}

function startBackgroundRefresh(delayMs = 3500) {
  const timer = setTimeout(() => { refresh().catch(() => {}); }, delayMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  CACHE_FILE,
  STATE_FILE,
  MAX_JSON_BYTES,
  sanitizeAnnouncement,
  validateDocument,
  versionMatches,
  isCurrentlyActive,
  fetchJsonDocument,
  refresh,
  getSnapshot,
  markSeen,
  dismiss,
  startBackgroundRefresh,
  _resetForTests({ cache: nextCache, state: nextState } = {}) {
    if (nextCache) cache = nextCache;
    if (nextState) state = nextState;
  },
};
