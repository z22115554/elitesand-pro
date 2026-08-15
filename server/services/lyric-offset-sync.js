'use strict';

/**
 * 歌詞偏移社群回饋 — 跟 usage-telemetry.js 是刻意分開的兩個系統，不要合併。
 *
 * usage-telemetry 對使用者的承諾是「不記錄看了什麼」；這裡的整個目的剛好相反——記住
 * 「這支 YouTube 影片需要多少毫秒的歌詞校正」，換取下次匯入同一支影片時能拿到別人
 * 已經校正過的建議值。兩者必須各自獨立的 opt-in 開關、各自的本機密鑰、各自的狀態檔，
 * 使用者關掉其中一個不該影響另一個。
 *
 * 預設關閉（opt-in，不是像 usage-telemetry 那樣預設開啟的 opt-out）：這裡送出的資料
 * 比匿名使用統計更具體（影片 ID），不能假設使用者會接受跟活躍統計一樣的預設值。
 *
 * enabled 這一個開關同時控制「送出我的校正」跟「讀取社群建議值」兩個方向——不要拆成
 * 兩個開關，那樣「關掉分享」卻仍偷偷讀取的行為，違反 install-id.js 訂下的「使用者沒
 * 主動觸發就不連外」原則。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const config = require('../utils/load-config');
const { dataDir } = require('../utils/app-paths');
const { APP_VERSION, appUserAgent } = require('../utils/app-version');
const eulaStore = require('./eula-store');
const { createLogger } = require('../utils/logger');

const log = createLogger('LyricOffsetSync');

const STATE_SCHEMA_VERSION = 1;
const TIMEOUT_MS = 3500;
// 標準 YouTube 影片 ID 形狀；同時也是「這個 trackId 值得送出去」的過濾條件——
// 本機上傳的歌曲 track.id 是檔名，幾乎不可能剛好符合這個形狀。
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function atomicWrite(fsImpl, filename, value) {
  fsImpl.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  try {
    fsImpl.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fsImpl.renameSync(temporary, filename);
  } finally {
    try { if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary); } catch (_) { /* best effort */ }
  }
}

// 跟 usage-telemetry.js 的同名函式刻意保持算法一致（同一套輪替代碼設計），但兩邊
// 各自用各自的 localSecret，衍生出的 id 不會相同、也無法互相關聯。
function utcPeriods(now) {
  const day = now.toISOString().slice(0, 10);
  const first = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const elapsedDays = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - first.getTime()) / 86400000);
  const daysBeforeFirstMonday = (first.getUTCDay() + 6) % 7;
  const weekNumber = Math.floor((elapsedDays + daysBeforeFirstMonday) / 7);
  return {
    day,
    week: `${now.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`,
    month: day.slice(0, 7),
  };
}

function deriveId(secret, scope, period) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`elitesand-lyric-offset:${scope}:${period}`, 'utf8')
    .digest('base64url');
}

function validEndpoint(endpoint) {
  if (endpoint.startsWith('https://')) return true;
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(endpoint);
}

function isSyncableVideoId(videoId) {
  return typeof videoId === 'string' && VIDEO_ID_PATTERN.test(videoId);
}

function createLyricOffsetSync(options = {}) {
  const dependencies = {
    config: options.config || config,
    dataDir: options.dataDir || dataDir,
    fs: options.fs || fs,
    fetch: options.fetch || fetch,
    now: options.now || (() => new Date()),
    randomBytes: options.randomBytes || crypto.randomBytes,
    appVersion: options.appVersion || APP_VERSION,
    userAgent: options.userAgent || appUserAgent('lyric-offset-sync'),
    eulaAccepted: options.eulaAccepted || (() => !eulaStore.getStatus().required),
    log: options.log || createLogger('LyricOffsetSync'),
  };
  const stateFile = path.join(dependencies.dataDir, 'lyric-offset-sync.json');
  let stateCache = null;

  function newSecret() {
    return dependencies.randomBytes(32).toString('hex');
  }

  function defaultState() {
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      // 明確要求 === true 才算開啟；跟 usage-telemetry 的 `!== false`（預設開）相反，
      // 這裡要的是預設關（opt-in）。
      enabled: dependencies.config.lyricOffsetSyncEnabled === true,
      localSecret: null,
    };
  }

  function loadState() {
    if (stateCache) return stateCache;
    try {
      const parsed = JSON.parse(dependencies.fs.readFileSync(stateFile, 'utf8'));
      if (!parsed || parsed.schemaVersion !== STATE_SCHEMA_VERSION || typeof parsed.enabled !== 'boolean') {
        throw new Error('unsupported state');
      }
      stateCache = {
        schemaVersion: STATE_SCHEMA_VERSION,
        enabled: parsed.enabled,
        localSecret: parsed.enabled
          ? (/^[a-f0-9]{64}$/.test(parsed.localSecret || '') ? parsed.localSecret : newSecret())
          : null,
      };
    } catch (_) {
      stateCache = defaultState();
      atomicWrite(dependencies.fs, stateFile, stateCache);
    }
    return stateCache;
  }

  function saveState() {
    atomicWrite(dependencies.fs, stateFile, loadState());
  }

  function endpoint() {
    return String(dependencies.config.lyricOffsetEndpoint || '').trim();
  }

  function isAvailable() {
    return validEndpoint(endpoint());
  }

  function getSettings() {
    const state = loadState();
    return {
      enabled: state.enabled,
      available: isAvailable(),
      eulaAccepted: dependencies.eulaAccepted(),
    };
  }

  function setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
    const state = loadState();
    state.enabled = enabled;
    if (enabled && !/^[a-f0-9]{64}$/.test(state.localSecret || '')) state.localSecret = newSecret();
    if (!enabled) state.localSecret = null;
    saveState();
    return getSettings();
  }

  function ensureSecret(state) {
    if (!/^[a-f0-9]{64}$/.test(state.localSecret || '')) {
      state.localSecret = newSecret();
      saveState();
    }
    return state.localSecret;
  }

  /** 開關關閉、EULA 未同意、端點未設定，任一條件不滿足就整個功能靜默不連外。 */
  function canUseNetwork() {
    const state = loadState();
    return state.enabled && dependencies.eulaAccepted() && isAvailable();
  }

  async function submitOffset({ videoId, offsetMs }) {
    if (!isSyncableVideoId(videoId)) return { skipped: true };
    if (typeof offsetMs !== 'number' || !Number.isInteger(offsetMs)) return { skipped: true };
    if (!canUseNetwork()) return { skipped: true };
    const state = loadState();
    const secret = ensureSecret(state);
    const periods = utcPeriods(dependencies.now());
    const body = JSON.stringify({
      schemaVersion: 1,
      videoId,
      offsetMs,
      appVersion: dependencies.appVersion,
      dailyId: deriveId(secret, 'day', periods.day),
      monthlyId: deriveId(secret, 'month', periods.month),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await dependencies.fetch(endpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': dependencies.userAgent,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) dependencies.log.warn(`歌詞偏移回饋遭拒絕（HTTP ${response.status}）`);
      return { ok: response.ok, status: response.status };
    } catch (error) {
      dependencies.log.warn(`歌詞偏移回饋傳送失敗：${error.name === 'AbortError' ? '逾時' : error.message}`);
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  /** @returns {Promise<{ suggestedOffsetMs: number|null, sampleCount: number }|null>} 失敗或未啟用時回 null，呼叫端不應把 null 當「建議值為 0」。 */
  async function getSuggestedOffset(videoId) {
    if (!isSyncableVideoId(videoId)) return null;
    if (!canUseNetwork()) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await dependencies.fetch(`${endpoint()}?videoId=${encodeURIComponent(videoId)}`, {
        method: 'GET',
        headers: { 'User-Agent': dependencies.userAgent },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      if (!data || typeof data.sampleCount !== 'number') return null;
      const suggestedOffsetMs = typeof data.suggestedOffsetMs === 'number' && Number.isFinite(data.suggestedOffsetMs)
        ? data.suggestedOffsetMs
        : null;
      return { suggestedOffsetMs, sampleCount: data.sampleCount };
    } catch (error) {
      dependencies.log.warn(`歌詞偏移建議值查詢失敗：${error.name === 'AbortError' ? '逾時' : error.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return { getSettings, setEnabled, submitOffset, getSuggestedOffset, isSyncableVideoId };
}

const singleton = createLyricOffsetSync();
module.exports = Object.assign(singleton, {
  createLyricOffsetSync, utcPeriods, deriveId, validEndpoint, isSyncableVideoId,
});
