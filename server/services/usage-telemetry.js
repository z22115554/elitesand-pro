'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const config = require('../utils/load-config');
const { dataDir } = require('../utils/app-paths');
const { APP_VERSION, appUserAgent } = require('../utils/app-version');
const eulaStore = require('./eula-store');
const fields = require('./telemetry-fields');
const { createLogger } = require('../utils/logger');

// 本機 state 的 schema 版本刻意維持 1：一旦改動，loadState() 會走 defaultState()
// 重新產生 localSecret，既有使用者的輪替代碼會整組改變、在接收端看起來像新裝置，
// DAU/MAU 連續性會斷一段。日彙總所需的欄位改用「可選欄位」向後相容地加上去。
const STATE_SCHEMA_VERSION = 1;
const TIMEOUT_MS = 3500;
// 未關帳的當日彙總最多每 30 分鐘補送一次（接收端是覆蓋寫入，重送安全）。
// 用惰性檢查而非計時器，才不必碰 Electron 生命週期。
const OPEN_BUCKET_FLUSH_MS = 30 * 60 * 1000;
const DAILY_PAYLOAD_SCHEMA_VERSION = 2;
// 日彙總的欄位要到這一版 EULA 才被揭露。使用者同意的版本低於此值時，
// record()／flushPending() 一律空轉——「還沒揭露就不可能被蒐集」因此是
// 程式層的保證，而不是靠流程紀律。改欄位登錄表時記得同步這個版本。
// 1.6.0：§7.9 首次揭露。1.8.0：§7.9(f) 增列「是否曾在同一後端重試」布林（ai.retried）。
const DAILY_DISCLOSED_EULA_VERSION = '1.8.0';

/** 只比較點分數字，非數字段落一律視為 0（EULA 版本行的格式是 x.y.z） */
function versionAtLeast(actual, required) {
  if (typeof actual !== 'string') return false;
  const left = actual.split('.');
  const right = required.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = Number.parseInt(left[i], 10) || 0;
    const b = Number.parseInt(right[i], 10) || 0;
    if (a !== b) return a > b;
  }
  return true;
}

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

function periodsForDay(day) {
  return utcPeriods(new Date(`${day}T00:00:00.000Z`));
}

function deriveId(secret, scope, period) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`elitesand-usage:${scope}:${period}`, 'utf8')
    .digest('base64url');
}


/**
 * 待送彙總的清洗。磁碟上的檔案是可被使用者或其他程式改寫的，因此載入時就要
 * 過一次白名單——不能等到送出前才驗，否則一個被竄改的 state 就能讓程式送出
 * EULA 沒有寫到的欄位。
 */
function sanitizePending(value, fieldsImpl) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const cleaned = {};
  for (const [bucketKey, bucket] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}#[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/.test(bucketKey)) continue;
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    const counters = {};
    for (const [key, amount] of Object.entries(bucket.counters || {})) {
      if (!fieldsImpl.isAllowedKey(key)) continue;
      const n = Math.floor(Number(amount));
      if (!Number.isFinite(n) || n <= 0) continue;
      counters[key] = Math.min(n, fieldsImpl.MAX_COUNTER_VALUE);
    }
    if (!Object.keys(counters).length) continue;
    cleaned[bucketKey] = {
      counters,
      sentAt: typeof bucket.sentAt === 'number' && Number.isFinite(bucket.sentAt) ? bucket.sentAt : 0,
    };
  }
  return cleaned;
}

function validEndpoint(endpoint) {
  if (endpoint.startsWith('https://')) return true;
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(endpoint);
}

function createUsageTelemetry(options = {}) {
  const dependencies = {
    config: options.config || config,
    dataDir: options.dataDir || dataDir,
    fs: options.fs || fs,
    fetch: options.fetch || fetch,
    now: options.now || (() => new Date()),
    randomBytes: options.randomBytes || crypto.randomBytes,
    appVersion: options.appVersion || APP_VERSION,
    userAgent: options.userAgent || appUserAgent('anonymous-usage'),
    // fail-closed：讀不到 EULA.txt 時 getStatus().required 也是 false，用 `!required`
    // 會把「缺檔」當成「已同意」，在使用者從未看過條款的情況下開始連外。
    eulaAccepted: options.eulaAccepted || (() => eulaStore.isAccepted()),
    eulaAcceptedVersion: options.eulaAcceptedVersion || (() => eulaStore.getStatus().acceptedVersion),
    log: options.log || createLogger('UsageTelemetry'),
  };
  const stateFile = path.join(dependencies.dataDir, 'usage-telemetry.json');
  let stateCache = null;
  let startupSent = false;

  function newSecret() {
    return dependencies.randomBytes(32).toString('hex');
  }

  function defaultState() {
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      enabled: dependencies.config.anonymousUsageEnabled !== false,
      localSecret: newSecret(),
      coreUseAttemptDay: null,
      pending: {},
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
        coreUseAttemptDay: typeof parsed.coreUseAttemptDay === 'string' ? parsed.coreUseAttemptDay : null,
        // 舊版 state 沒有這個欄位，缺少時視為空，不觸發 schema 不符
        pending: sanitizePending(parsed.pending, fields),
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
    return String(dependencies.config.usageEndpoint || '').trim();
  }

  /** 日彙總是否已被使用者同意的 EULA 版本涵蓋 */
  function dailyDisclosed() {
    return versionAtLeast(dependencies.eulaAcceptedVersion(), DAILY_DISCLOSED_EULA_VERSION);
  }

  function dailyEndpoint() {
    const configured = String(dependencies.config.usageDailyEndpoint || '').trim();
    if (configured) return configured;
    const base = endpoint();
    return base ? base.replace(/\/+$/, '') + '/daily' : '';
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
    state.coreUseAttemptDay = null;
    if (enabled && !/^[a-f0-9]{64}$/.test(state.localSecret || '')) state.localSecret = newSecret();
    if (!enabled) state.localSecret = null;
    // 關閉統計＝連同尚未送出的當日彙總一起丟棄，不可留在磁碟等下次開啟才送
    state.pending = {};
    startupSent = false;
    saveState();
    return getSettings();
  }

  async function send(event) {
    const state = loadState();
    if (!state.enabled || !dependencies.eulaAccepted() || !isAvailable()) return { skipped: true };
    if (!/^[a-f0-9]{64}$/.test(state.localSecret || '')) {
      state.localSecret = newSecret();
      saveState();
    }
    const periods = utcPeriods(dependencies.now());
    const body = JSON.stringify({
      schemaVersion: 1,
      event,
      appVersion: dependencies.appVersion,
      dailyId: deriveId(state.localSecret, 'day', periods.day),
      weeklyId: deriveId(state.localSecret, 'week', periods.week),
      monthlyId: deriveId(state.localSecret, 'month', periods.month),
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
      if (!response.ok) dependencies.log.warn(`匿名使用統計遭拒絕（HTTP ${response.status}）`);
      return { ok: response.ok, status: response.status };
    } catch (error) {
      dependencies.log.warn(`匿名使用統計傳送失敗：${error.name === 'AbortError' ? '逾時' : error.message}`);
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  async function start() {
    const settings = getSettings();
    if (startupSent || !settings.enabled || !settings.available || !settings.eulaAccepted) return { skipped: true };
    startupSent = true;
    const result = await send('startup');
    // 上次工作階段沒送出去的彙總（含當機遺留）在這裡補送
    try { await flushPending({ force: true }); } catch (_) { /* 不影響啟動 */ }
    return result;
  }

  async function markCoreUsed() {
    const state = loadState();
    if (!state.enabled || !dependencies.eulaAccepted() || !isAvailable()) return { skipped: true };
    const day = utcPeriods(dependencies.now()).day;
    if (state.coreUseAttemptDay === day) return { skipped: true };
    state.coreUseAttemptDay = day;
    saveState();
    return send('core_use');
  }

  // ── 日彙總 ──────────────────────────────────────────────────────────────
  // 逐事件上傳等於交出「幾點在做什麼」，對直播工具而言那近似直播時段表。
  // 因此改為本機累積、以「日 x 版本」為單位彙總後送出。

  let flushing = false;
  let lastPersistAt = 0;

  function bucketKeyFor(day) {
    return day + '#' + dependencies.appVersion;
  }

  function persistSoon(force) {
    const nowMs = dependencies.now().getTime();
    if (!force && nowMs - lastPersistAt < 5000) return;
    lastPersistAt = nowMs;
    saveState();
  }

  /**
   * 唯一的計數入口。不在白名單內的 key 直接丟棄，不記錄、不回報。
   *
   * deferFlush：一次要記多個計數時（例如 attempt + fail 一組）必須設 true，
   * 否則第一筆觸發的送出仍在進行中，後面幾筆會被 flushing 擋掉而滯留在本機，
   * 要等下一次觸發才送得出去。由呼叫端在記完整組後自行 flush 一次。
   */
  function record(key, amount, deferFlush) {
    const step = Math.floor(Number(amount === undefined ? 1 : amount));
    const state = loadState();
    if (!state.enabled || !dependencies.eulaAccepted() || !isAvailable()) return false;
    if (!dailyDisclosed()) return false;
    if (!fields.isAllowedKey(key)) return false;
    if (!Number.isFinite(step) || step <= 0) return false;

    const today = utcPeriods(dependencies.now()).day;
    const bucketKey = bucketKeyFor(today);
    if (!state.pending[bucketKey]) state.pending[bucketKey] = { counters: {}, sentAt: 0 };
    const bucket = state.pending[bucketKey];
    // 「當天是否發生」的欄位只能是 0 或 1：EULA §7.9 明講這類欄位「不含使用
    // 次數」，用跟其他欄位一樣的累加邏輯會讓文件承諾變假的。已經是 1 就不用
    // 再寫一次、也不用觸發 persist／flush。
    if (fields.isDailyBooleanKey(key)) {
      if (bucket.counters[key] === 1) return true;
      bucket.counters[key] = 1;
    } else {
      bucket.counters[key] = Math.min((bucket.counters[key] || 0) + step, fields.MAX_COUNTER_VALUE);
    }
    persistSoon(false);
    if (!deferFlush) flushPending().catch(function () { /* 送不出去不影響程式運作 */ });
    return true;
  }

  function flushSoon() {
    flushPending().catch(function () { /* 送不出去不影響程式運作 */ });
  }

  async function sendDaily(day, appVersion, counters) {
    const state = loadState();
    if (!/^[a-f0-9]{64}$/.test(state.localSecret || '')) return { ok: false, status: 0 };
    const periods = periodsForDay(day);
    const body = JSON.stringify({
      schemaVersion: DAILY_PAYLOAD_SCHEMA_VERSION,
      day,
      appVersion,
      dailyId: deriveId(state.localSecret, 'day', periods.day),
      weeklyId: deriveId(state.localSecret, 'week', periods.week),
      monthlyId: deriveId(state.localSecret, 'month', periods.month),
      counters,
    });
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    try {
      const response = await dependencies.fetch(dailyEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': dependencies.userAgent },
        body,
        signal: controller.signal,
      });
      if (!response.ok) dependencies.log.warn('日彙總遭拒絕（HTTP ' + response.status + '）');
      return { ok: response.ok, status: response.status };
    } catch (error) {
      dependencies.log.warn('日彙總傳送失敗：' + (error.name === 'AbortError' ? '逾時' : error.message));
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 已關帳（日期或版本已不是當前那一格）的彙總立刻送；當日那一格最多每
   * OPEN_BUCKET_FLUSH_MS 補送一次。接收端是覆蓋寫入，所以重送不會重複計數，
   * 也讓「開一次就沒再開」的使用者不至於整天資料歸零。
   */
  async function flushPending(options) {
    const force = !!(options && options.force);
    const state = loadState();
    if (!state.enabled || !dependencies.eulaAccepted() || !isAvailable()) return { skipped: true };
    if (!dailyDisclosed()) return { skipped: true };
    if (flushing) return { skipped: true };

    const nowMs = dependencies.now().getTime();
    const openKey = bucketKeyFor(utcPeriods(dependencies.now()).day);
    const due = Object.entries(state.pending).filter(function (entry) {
      if (entry[0] !== openKey) return true;
      return force || nowMs - entry[1].sentAt >= OPEN_BUCKET_FLUSH_MS;
    });
    if (!due.length) return { skipped: true };

    flushing = true;
    let sent = 0;
    try {
      for (const entry of due) {
        const key = entry[0];
        const bucket = entry[1];
        const separator = key.indexOf('#');
        const result = await sendDaily(key.slice(0, separator), key.slice(separator + 1), bucket.counters);
        if (!result.ok) continue;
        sent += 1;
        // 已關帳的送成功就移除；當日那格保留（之後還會累加），只記下送出時間
        if (key === openKey) bucket.sentAt = nowMs;
        else delete state.pending[key];
      }
      if (sent) persistSoon(true);
    } finally {
      flushing = false;
    }
    return { sent };
  }

  // ── 對外記錄 API（呼叫端不得自行拼 key）──────────────────────────────────

  function recordFeature(name) {
    return fields.FEATURES.includes(name) ? record('feature.' + name) : false;
  }

  function recordOutcome(family, ok, code, deferFlush) {
    if (!fields.OUTCOME_FAMILIES.includes(family)) return false;
    // attempt 是分母、ok/fail 是分子，兩者必須同一批送出才算得出正確的成功率
    record(family + '.attempt', 1, true);
    const recorded = ok
      ? record(family + '.ok', 1, true)
      : record(family + '.fail.' + fields.mapError(family, code), 1, true);
    if (!deferFlush) flushSoon();
    return recorded;
  }

  function recordIncident(name) {
    return fields.INCIDENTS.includes(name) ? record('incident.' + name) : false;
  }

  /**
   * count 是「今天到目前為止累計的重連次數」，不是這次事件的增量——呼叫端
   * 每次重連都要傳當天累計總數，這裡只重算它落在哪一桶。
   *
   * 不能直接用 record()：那是單一 key 累加，但這裡的語意是「今天只能有一個
   * 桶是真的」，累計數跨過門檻時要把舊桶清掉、換成新桶，不是兩個桶都留著
   * 各自加 1（那樣會讓同一天看起來有兩種不同的重連量級，無法解讀）。
   */
  function recordSocketReconnects(count) {
    const state = loadState();
    if (!state.enabled || !dependencies.eulaAccepted() || !isAvailable()) return false;
    if (!dailyDisclosed()) return false;
    const bucket = fields.countBucket(count);
    const key = 'incident.socket_reconnect.' + bucket;
    if (!fields.isAllowedKey(key)) return false;

    const today = utcPeriods(dependencies.now()).day;
    const bucketKey = bucketKeyFor(today);
    if (!state.pending[bucketKey]) state.pending[bucketKey] = { counters: {}, sentAt: 0 };
    const counters = state.pending[bucketKey].counters;
    for (const b of fields.COUNT_BUCKETS) {
      const siblingKey = 'incident.socket_reconnect.' + b;
      if (siblingKey !== key) delete counters[siblingKey];
    }
    if (counters[key] === 1) return true;
    counters[key] = 1;
    persistSoon(false);
    flushSoon();
    return true;
  }

  function recordLyricSource(source, hit, deferFlush) {
    if (!fields.LYRIC_SOURCES.includes(source)) return false;
    const recorded = record('lyrics.source.' + source + '.' + (hit ? 'hit' : 'miss'), 1, true);
    if (!deferFlush) flushSoon();
    return recorded;
  }

  function recordAutoResultEdited() {
    return record('lyrics.auto_result_edited');
  }

  function recordDependency(name, ok) {
    if (!fields.DEPENDENCIES.includes(name)) return false;
    return record('dep.' + name + '_' + (ok ? 'ok' : 'missing'));
  }

  function recordUpdateResult(ok) {
    return record(ok ? 'update.ok' : 'update.failed');
  }

  /** AI 分離：硬體資訊一律分桶，絕不送精確型號或秒數 */
  function recordAiSeparation(info) {
    const data = info || {};
    // 一次分離可能試過多個引擎（Python CUDA → WebGPU → CPU）。每個試過的後端都記一個
    // 當日布林，這樣「WebGPU 有沒有被嘗試過、成功還是退回 CPU」在彙總層看得出來。
    // 不影響 attempt/ok/fail 計數（那個只在下方 recordOutcome 記一次）。
    const backends = Array.isArray(data.attemptedBackends) && data.attemptedBackends.length
      ? data.attemptedBackends
      : (data.backend ? [data.backend] : []);
    for (const b of backends) {
      if (fields.AI_BACKENDS.includes(b)) record('ai.backend.' + b, 1, true);
    }
    if (fields.GPU_VENDORS.includes(data.gpuVendor)) record('ai.gpu.' + data.gpuVendor, 1, true);
    if (data.vramMb !== undefined) record('ai.vram.' + fields.vramBucket(data.vramMb), 1, true);
    if (data.realtimeFactor !== undefined) record('ai.rtf.' + fields.realtimeFactorBucket(data.realtimeFactor), 1, true);
    if (data.audioSeconds !== undefined) record('ai.duration.' + fields.durationBucket(data.audioSeconds), 1, true);
    if (data.fellBackToCpu) record('ai.fallback_to_cpu', 1, true);
    // 「曾在同一後端重試後才完成」——EULA §7.9(f) 從 1.8.0 起揭露；只送布林、不送次數。
    if (data.retried) record('ai.retried', 1, true);
    const recorded = recordOutcome('ai', data.ok, data.code, true);
    flushSoon();
    return recorded;
  }

  return {
    getSettings, setEnabled, start, markCoreUsed, isAvailable,
    flushPending, dailyDisclosed,
    recordFeature, recordOutcome, recordIncident, recordSocketReconnects,
    recordLyricSource, recordAutoResultEdited, recordDependency,
    recordUpdateResult, recordAiSeparation,
  };
}

const singleton = createUsageTelemetry();
module.exports = Object.assign(singleton, {
  createUsageTelemetry, utcPeriods, deriveId, validEndpoint, versionAtLeast,
  DAILY_DISCLOSED_EULA_VERSION,
});
