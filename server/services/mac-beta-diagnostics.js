'use strict';

/**
 * Mac 內測版的自動診斷回報。
 *
 * 只在下面四件事全部成立時才會連外，任何一件不成立就完全不動作（不排隊、不寫檔以外的事）：
 *   1. process.platform === 'darwin'
 *   2. 這是 Mac 內測版：tools/build-mac.js 打包時才會在 package.json 寫入 elitesandMacBeta
 *      （Windows 安裝版、開發環境、正式版都沒有這個欄位）
 *   3. 既有的「匿名統計」開關是開的、EULA 已同意（跟 usage-telemetry.js 同一個開關）
 *   4. 使用者已在面板按過一次性告知的「知道了」
 * 另外端點（config.macBetaDiagEndpoint）是空值或不是 https 時整個功能停用，也不顯示告知。
 *
 * 送出的內容全部是 mac-beta-diag-fields.js 白名單裡的類別、布林、級距或代碼；
 * 不送錯誤訊息、堆疊、路徑、歌名、歌詞、帳號或任何自由文字。
 *
 * 送不出去就丟掉：不重試、不寫進磁碟待送，只在記憶體排一小批。
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const fields = require('./mac-beta-diag-fields');

const STATE_SCHEMA_VERSION = 1;
// 告知內容改版就加一：之前按過舊版的人要再看一次
// （2：多了分離與練唱音高線的結果與耗時級距；3：多了精準對時元件的安裝結果與每次精準對時的結果）
const NOTICE_VERSION = 3;
const TIMEOUT_MS = 3500;
const FLUSH_DELAY_MS = 5000;
const MAX_QUEUE = 40;
const MAX_EVENTS_PER_LAUNCH = 120;
const MAX_ERRORS_PER_LAUNCH = 10;

function validEndpoint(endpoint) {
  if (endpoint.startsWith('https://')) return true;
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(endpoint);
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

function execText(execFileImpl, command, args) {
  return new Promise((resolve) => {
    try {
      execFileImpl(command, args, { timeout: 3000, windowsHide: true }, (error, stdout) => {
        resolve(error ? null : String(stdout || '').trim());
      });
    } catch (_) { resolve(null); }
  });
}

function createMacBetaDiagnostics(options = {}) {
  const deps = {
    platform: options.platform || process.platform,
    arch: options.arch || process.arch,
    packageJson: options.packageJson || (() => { try { return require('../../package.json'); } catch (_) { return {}; } })(),
    config: options.config || require('../utils/load-config'),
    dataDir: options.dataDir || require('../utils/app-paths').dataDir,
    fs: options.fs || fs,
    fetch: options.fetch || require('node-fetch'),
    randomBytes: options.randomBytes || crypto.randomBytes,
    usageSettings: options.usageSettings || (() => require('./usage-telemetry').getSettings()),
    appVersion: options.appVersion || require('../utils/app-version').APP_VERSION,
    userAgent: options.userAgent || require('../utils/app-version').appUserAgent('mac-beta-diag'),
    execFile: options.execFile || execFile,
    os: options.os || os,
    env: options.env || process.env,
    setTimeout: options.setTimeout || setTimeout,
    flushDelayMs: options.flushDelayMs === undefined ? FLUSH_DELAY_MS : options.flushDelayMs,
  };
  const stateFile = path.join(deps.dataDir, 'mac-beta-diag.json');
  let stateCache = null;
  let queue = [];
  let flushTimer = null;
  let started = false;
  let sentThisLaunch = 0;
  let errorsThisLaunch = 0;
  const reportedThisLaunch = new Set();

  function buildLabel() {
    const meta = deps.packageJson && deps.packageJson.elitesandMacBeta;
    const build = meta && typeof meta.build === 'string' ? meta.build : '';
    return /^[A-Za-z0-9.]{1,32}$/.test(build) ? build : '';
  }

  function isMacBeta() {
    return deps.platform === 'darwin' && buildLabel() !== '';
  }

  function endpoint() {
    return String((deps.config && deps.config.macBetaDiagEndpoint) || '').trim();
  }

  function available() {
    return isMacBeta() && validEndpoint(endpoint());
  }

  function loadState() {
    if (stateCache) return stateCache;
    try {
      const parsed = JSON.parse(deps.fs.readFileSync(stateFile, 'utf8'));
      if (!parsed || parsed.schemaVersion !== STATE_SCHEMA_VERSION) throw new Error('unsupported state');
      const counts = {};
      for (const [key, value] of Object.entries(parsed.counts || {})) {
        if (/^[a-z_]{1,40}\.[A-Za-z0-9_]{1,40}$/.test(key) && Number.isInteger(value) && value > 0) {
          counts[key] = Math.min(value, fields.MAX_COUNT);
        }
      }
      stateCache = {
        schemaVersion: STATE_SCHEMA_VERSION,
        installId: /^[a-f0-9]{32}$/.test(parsed.installId || '') ? parsed.installId : null,
        noticeAckAt: typeof parsed.noticeAckAt === 'string' && parsed.noticeVersion === NOTICE_VERSION ? parsed.noticeAckAt : null,
        noticeVersion: parsed.noticeVersion === NOTICE_VERSION ? NOTICE_VERSION : null,
        counts,
      };
    } catch (_) {
      stateCache = { schemaVersion: STATE_SCHEMA_VERSION, installId: null, noticeAckAt: null, noticeVersion: null, counts: {} };
    }
    return stateCache;
  }

  function saveState() {
    try { atomicWrite(deps.fs, stateFile, loadState()); } catch (_) { /* 診斷用的本機檔寫不進去不影響程式 */ }
  }

  function usageAllowed() {
    try {
      const settings = deps.usageSettings() || {};
      return settings.enabled === true && settings.eulaAccepted === true;
    } catch (_) {
      return false;
    }
  }

  /** 四個條件 + 端點全部成立才算「正在蒐集」 */
  function collecting() {
    if (!available()) return false;
    if (!usageAllowed()) {
      // 跟 usage-telemetry.js 的慣例一致：關掉統計＝丟掉安裝代碼與還沒送的事件，重新打開會換新代碼
      const state = loadState();
      queue = [];
      if (state.installId) { state.installId = null; saveState(); }
      return false;
    }
    return !!loadState().noticeAckAt;
  }

  function getStatus() {
    const macBeta = isMacBeta();
    const ready = available();
    return {
      macBeta,
      available: ready,
      noticeRequired: ready && usageAllowed() && !loadState().noticeAckAt,
      collecting: collecting(),
    };
  }

  function installId() {
    const state = loadState();
    if (!state.installId) {
      state.installId = deps.randomBytes(16).toString('hex');
      saveState();
    }
    return state.installId;
  }

  function bumpCount(key) {
    const state = loadState();
    state.counts[key] = Math.min((state.counts[key] || 0) + 1, fields.MAX_COUNT);
    saveState();
    return state.counts[key];
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = deps.setTimeout(() => {
      flushTimer = null;
      flush().catch(() => { /* 送不出去不影響程式運作 */ });
    }, deps.flushDelayMs);
    if (flushTimer && typeof flushTimer.unref === 'function') flushTimer.unref();
  }

  function enqueue(event) {
    if (!fields.validEvent(event)) return false;
    if (sentThisLaunch + queue.length >= MAX_EVENTS_PER_LAUNCH || queue.length >= MAX_QUEUE) return false;
    queue.push(event);
    scheduleFlush();
    return true;
  }

  async function flush() {
    if (!collecting() || !queue.length) { if (!collecting()) queue = []; return { skipped: true }; }
    const batch = queue.splice(0, fields.MAX_EVENTS_PER_BATCH);
    const payload = {
      schemaVersion: fields.SCHEMA_VERSION,
      installId: installId(),
      appVersion: /^[0-9A-Za-z.+-]{1,32}$/.test(deps.appVersion) ? deps.appVersion : '0.0.0',
      build: buildLabel(),
      events: batch,
    };
    let body = JSON.stringify(payload);
    while (Buffer.byteLength(body) > fields.MAX_BODY_BYTES - 256 && payload.events.length > 1) {
      queue.unshift(payload.events.pop());
      body = JSON.stringify(payload);
    }
    if (!fields.validPayload(payload)) return { ok: false, status: 0 };
    sentThisLaunch += payload.events.length;
    if (queue.length) scheduleFlush();
    const controller = new AbortController();
    const timer = deps.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await deps.fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': deps.userAgent },
        body,
        signal: controller.signal,
      });
      return { ok: !!response.ok, status: response.status };
    } catch (_) {
      return { ok: false, status: 0 }; // 離線或逾時：這批直接丟棄
    } finally {
      clearTimeout(timer);
    }
  }

  function onceKey(key) {
    if (reportedThisLaunch.has(key)) return false;
    reportedThisLaunch.add(key);
    return true;
  }

  function component(name, code) {
    if (!collecting()) return false;
    if (!fields.COMPONENTS[name] || !fields.COMPONENTS[name].includes(code)) return false;
    if (!onceKey(`component.${name}.${code}`)) return false;
    return enqueue({ type: 'component', name, code });
  }

  function milestone(name, code = 'ok') {
    if (!collecting()) return false;
    if (!fields.MILESTONES[name] || !fields.MILESTONES[name].includes(code)) return false;
    const count = bumpCount(`${name}.${code}`);
    if (!onceKey(`milestone.${name}.${code}`)) return false;
    return enqueue({ type: 'milestone', name, code, count });
  }

  function reportError(kind, error) {
    if (!collecting() || !fields.ERROR_KINDS.includes(kind)) return false;
    if (errorsThisLaunch >= MAX_ERRORS_PER_LAUNCH) return false;
    const code = kind === 'incident' ? String(error || 'other') : fields.errorCode(error);
    const module = kind === 'incident' ? 'incident' : fields.errorModule(error);
    const event = { type: 'error', kind, code, module };
    if (!fields.validEvent(event) || !onceKey(`error.${kind}.${code}.${module}`)) return false;
    errorsThisLaunch += 1;
    return enqueue(event);
  }

  /** 渲染程序探測到的顯示卡能力（只收布林與廠商類別） */
  function gpu(info) {
    if (!collecting()) return false;
    const data = info && typeof info === 'object' ? info : {};
    const event = {
      type: 'gpu',
      api: data.api === true,
      adapter: data.api === true && data.adapter === true,
      shaderF16: data.api === true && data.adapter === true && data.shaderF16 === true,
      vendor: data.api === true && data.adapter === true ? fields.gpuVendor(data.vendor) : 'none',
    };
    if (!onceKey('gpu')) return false;
    return enqueue(event);
  }

  /**
   * 一次分離的結果。info：{ ok, code, finalBackend, attempts, startedAt, audioSeconds, deviceLost }
   * 只轉成類別與級距；歌曲長度用 audioSeconds（呼叫端從音檔標頭讀到的），不送檔名。
   * 每首都回報（不做每次啟動一次的去重），但仍受每次啟動的總量上限保護。
   */
  function separation(info) {
    if (!collecting()) return false;
    const data = info && typeof info === 'object' ? info : {};
    const attempts = Array.isArray(data.attempts) ? data.attempts : [];
    const device = fields.SEPARATION_DEVICES.includes(data.finalBackend) ? data.finalBackend : 'none';
    const code = String(data.code || '').toLowerCase();
    const result = data.ok ? 'ok'
      : code === 'oom' || code === 'gpu_oom' ? 'oom'
      : fields.SEPARATION_RESULTS.includes(code) ? code
      : code === 'engine_unavailable' ? 'engine_unavailable'
      : 'other';
    const elapsed = Number.isFinite(data.startedAt) ? Date.now() - data.startedAt : NaN;
    return enqueue({
      type: 'separation',
      result,
      device,
      cpuFallback: device === 'cpu' && attempts.some((b) => b && b !== 'cpu'),
      lengthTier: fields.lengthTier(data.audioSeconds),
      speedTier: data.ok ? fields.speedTier(elapsed, data.audioSeconds) : 'unknown',
      deviceLost: data.deviceLost === true || code === 'device_lost',
    });
  }

  /** 練唱音高線一次分析的結果。info：{ ok, code, algorithm, elapsedMs } */
  function pitchGuide(info) {
    if (!collecting()) return false;
    const data = info && typeof info === 'object' ? info : {};
    const code = String(data.code || '');
    const result = data.ok ? 'ok'
      : code === 'PRACTICE_VOCALS_REQUIRED' ? 'vocals_required'
      : code === 'PRACTICE_RUNTIME_MISSING' || code === 'ENOENT' ? 'python_missing'
      : code === 'GUIDE_TIMEOUT' ? 'timeout'
      : code === 'GUIDE_INVALID_OUTPUT' ? 'invalid_output'
      : code === 'GUIDE_ANALYSIS_FAILED' ? 'analysis_failed'
      : 'other';
    const algorithm = /^torchcrepe/.test(String(data.algorithm || '')) ? 'torchcrepe' : /^yin/.test(String(data.algorithm || '')) ? 'yin' : 'none';
    return enqueue({ type: 'pitch_guide', result, algorithm, timeTier: fields.timeTier(data.elapsedMs) });
  }

  /**
   * 精準對時一次請求的結果。info：{ op, ok, code, verdict, device, audioSeconds, elapsedMs }
   * 只轉成類別與級距；不送歌名、歌詞或路徑（呼叫端也只傳這幾個欄位）。
   */
  function preciseSync(info) {
    if (!collecting()) return false;
    const data = info && typeof info === 'object' ? info : {};
    if (!fields.PRECISE_OPS.includes(data.op)) return false;
    const code = String(data.code || '');
    const result = data.ok ? 'ok'
      : code === 'WORKER_TIMEOUT' ? 'timeout'
      : code === 'WORKER_STOPPED' || /^WORKER_EXIT_/.test(code) ? 'worker_exit'
      : code === 'ENOENT' ? 'python_missing'
      : code === 'WORKER_ERROR' ? 'worker_error'
      : 'other';
    return enqueue({
      type: 'precise_sync',
      op: data.op,
      result,
      verdict: data.ok && fields.PRECISE_VERDICTS.includes(data.verdict) ? data.verdict : 'none',
      device: fields.PRECISE_DEVICES.includes(data.device) ? data.device : 'none',
      lengthTier: fields.lengthTier(data.audioSeconds),
      speedTier: data.ok ? fields.speedTier(data.elapsedMs, data.audioSeconds) : 'unknown',
    });
  }

  async function pythonExecCode() {
    let runtime;
    try { runtime = require('./ai-runtime-provider'); } catch (_) { return null; }
    if (!runtime.isAvailable()) return null; // 還沒裝元件包：不回報
    const version = await execText(deps.execFile, runtime.PYTHON_EXE, ['--version']);
    return version && /^Python 3\./.test(version) ? 'ok' : 'failed';
  }

  async function launchInfo() {
    const translated = deps.arch === 'x64'
      ? (await execText(deps.execFile, 'sysctl', ['-in', 'sysctl.proc_translated'])) === '1'
      : false;
    const productVersion = await execText(deps.execFile, 'sw_vers', ['-productVersion']);
    let osMajor = Number.parseInt(String(productVersion || '').split('.')[0], 10);
    if (!Number.isInteger(osMajor)) {
      // 退而求其次：Darwin 20–24 對應 macOS 11–15，Darwin 25 起對應 macOS 26 起
      const darwin = Number.parseInt(String(deps.os.release()).split('.')[0], 10);
      osMajor = darwin >= 25 ? darwin + 1 : darwin - 9;
    }
    const cpuModel = String(((deps.os.cpus() || [])[0] || {}).model || '');
    const chip = deps.arch === 'arm64' || translated || /apple/i.test(cpuModel) ? 'apple' : 'intel';
    return {
      type: 'launch',
      osMajor: Number.isInteger(osMajor) && osMajor >= 10 && osMajor <= 99 ? osMajor : 10,
      arch: deps.arch === 'arm64' ? 'arm64' : 'x64',
      chip,
      memTier: fields.memTier(deps.os.totalmem()),
      rosetta: translated,
      count: bumpCount('launch.ok'),
    };
  }

  function ffmpegSourceCode() {
    try {
      const resolved = require('./ffmpeg-provider').resolveFfmpegPaths();
      if (!resolved) return 'missing';
      if (resolved.source === 'system-dir') return 'homebrew';
      if (resolved.source === 'system') return 'path';
      if (resolved.source === 'downloaded' || resolved.source === 'config') return resolved.source;
      return 'missing';
    } catch (_) {
      return 'missing';
    }
  }

  async function bundledNodeCode() {
    const nodePath = deps.env.ELITESAND_YTDLP_NODE_PATH;
    if (!nodePath || !deps.fs.existsSync(nodePath)) return 'missing';
    const version = await execText(deps.execFile, nodePath, ['--version']);
    return version && /^v\d+\./.test(version) ? 'ok' : 'failed';
  }

  /** 伺服器開始監聽後呼叫一次；使用者稍後才按「知道了」時由 acknowledgeNotice() 補呼叫。 */
  async function start() {
    if (started || !collecting()) return { skipped: true };
    started = true;
    try { enqueue(await launchInfo()); } catch (_) { /* 取不到就不送這筆 */ }
    component('ffmpeg_source', ffmpegSourceCode());
    try { component('bundled_node', await bundledNodeCode()); } catch (_) { /* 同上 */ }
    try {
      const support = require('./ai-runtime-provider').macSupport({ platform: deps.platform, arch: deps.arch });
      component('mac_support', support.supported ? 'ok' : (support.reason === 'intel' ? 'intel' : 'macos_old'));
      const python = await pythonExecCode();
      if (python) component('python_exec', python);
    } catch (_) { /* 同上 */ }
    return { started: true };
  }

  function acknowledgeNotice(now = new Date()) {
    if (!available()) return getStatus();
    const state = loadState();
    if (!state.noticeAckAt) {
      state.noticeAckAt = now.toISOString();
      state.noticeVersion = NOTICE_VERSION;
      saveState();
    }
    start().catch(() => { /* 不影響回應 */ });
    return getStatus();
  }

  /**
   * 借用既有匿名統計已經埋好的點（匯入結果、OBS 頁連上、依賴檢查、事故），
   * 只在 Mac 內測版才包一層——其他平台根本不會進到這裡，原本的函式原封不動。
   */
  function attachToUsageTelemetry(usageTelemetry) {
    if (!isMacBeta() || !usageTelemetry || usageTelemetry.__macBetaDiagAttached) return false;
    const original = {
      recordOutcome: usageTelemetry.recordOutcome,
      recordFeature: usageTelemetry.recordFeature,
      recordIncident: usageTelemetry.recordIncident,
      recordDependency: usageTelemetry.recordDependency,
    };
    usageTelemetry.recordOutcome = function (family, ok, code, deferFlush) {
      try {
        if (family === 'import') {
          const mapped = ok ? 'ok' : (fields.MILESTONES.youtube_import.includes(String(code || '').toLowerCase()) ? String(code).toLowerCase() : 'other');
          milestone('youtube_import', mapped);
        }
      } catch (_) { /* 診斷不能影響原本的統計 */ }
      return original.recordOutcome.call(this, family, ok, code, deferFlush);
    };
    usageTelemetry.recordFeature = function (name) {
      try {
        if (name === 'obs_display') milestone('obs_display_loaded');
        if (name === 'obs_setlist') milestone('obs_setlist_loaded');
      } catch (_) { /* 同上 */ }
      return original.recordFeature.call(this, name);
    };
    usageTelemetry.recordIncident = function (name) {
      try { if (/^[a-z_]{1,40}$/.test(String(name || ''))) reportError('incident', name); } catch (_) { /* 同上 */ }
      return original.recordIncident.call(this, name);
    };
    usageTelemetry.recordDependency = function (name, ok) {
      try { if (name === 'ytdlp') component('ytdlp_available', ok ? 'ok' : 'missing'); } catch (_) { /* 同上 */ }
      return original.recordDependency.call(this, name, ok);
    };
    Object.defineProperty(usageTelemetry, '__macBetaDiagAttached', { value: true });
    return true;
  }

  function resetForTests() {
    queue = []; started = false; sentThisLaunch = 0; errorsThisLaunch = 0; reportedThisLaunch.clear();
    stateCache = null;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }

  return {
    isMacBeta, available, collecting, getStatus, acknowledgeNotice, start, flush,
    component, milestone, reportError, gpu, separation, pitchGuide, preciseSync, attachToUsageTelemetry,
    _queue: () => queue.slice(), _resetForTests: resetForTests,
  };
}

// ── 給各模組用的分類小工具：輸入是內部的錯誤物件或訊息，輸出只會是白名單代碼 ──

function classifyFfmpegDownloadError(error) {
  if (error && error.ffmpegStage === 'system-check') return 'system_check';
  const message = String((error && error.message) || '');
  if (/只支援 Windows 與 macOS/.test(message)) return 'unsupported_platform';
  if (/SHA-256|雜湊|大小/.test(message)) return 'verify_failed';
  if (/解壓|zip|extract/i.test(message)) return 'extract_failed';
  if (/HTTP|下載|ENOTFOUND|ECONN|ETIMEDOUT|逾時|timeout/i.test(message)) return 'download_failed';
  return 'other';
}

function classifyYtdlpUpdate(result) {
  if (result && result.ok) return /已是最新|未進行降級/.test(String(result.message || '')) ? 'up_to_date' : 'ok';
  const message = String((result && result.message) || '');
  if (/Signed|signature|簽章|GPG/i.test(message)) return 'signature_failed';
  if (/SHA-256|size mismatch|version differs|version mismatch/i.test(message)) return 'hash_mismatch';
  if (/可寫入|writable|protected/i.test(message)) return 'not_writable';
  if (/HTTP|ENOTFOUND|ECONN|ETIMEDOUT|timeout|fetch/i.test(message)) return 'network';
  return 'other';
}

function classifySeparationInstallError(error) {
  if (error && error.code === 'CANCELLED') return 'cancelled';
  const message = String((error && error.message) || '');
  if (/只支援 Windows/.test(message)) return 'unsupported_platform';
  if (/FFmpeg/.test(message)) return 'ffmpeg_missing';
  if (/磁碟空間不足/.test(message)) return 'disk_full';
  return 'other';
}

/** 元件包安裝失敗 → 白名單代碼（phase：python／primary-model） */
function classifyBundleError(phase, error) {
  const code = error && error.code;
  if (code === 'CANCELLED') return 'cancelled';
  if (phase === 'primary-model') {
    if (/SHA-256|雜湊|有效檔案/.test(String(error && error.message))) return 'verify_failed';
    return error ? 'download_failed' : 'other';
  }
  if (code === 'MAC_UNSUPPORTED') return 'unsupported';
  if (code === 'DISK_FULL') return 'disk_full';
  if (code === 'HASH_MISMATCH') return 'hash_mismatch';
  if (code === 'EXTRACT_FAILED') return 'extract_failed';
  const stage = error && error.stage;
  if (stage === 'download-python') return 'download_failed';
  if (stage === 'extract') return 'extract_failed';
  if (stage === 'install-packages') return 'pip_failed';
  return 'other';
}

const PRACTICE_BLOCK_CODES = Object.freeze({
  PRACTICE_VOCALS_REQUIRED: 'vocals_required',
  VOCALS_MISSING: 'vocals_missing',
  PRACTICE_RUNTIME_MISSING: 'runtime_missing',
  GUIDE_ANALYSIS_FAILED: 'analysis_failed',
  GUIDE_TIMEOUT: 'timeout',
  GUIDE_INVALID_OUTPUT: 'invalid_output',
});
function classifyPracticeBlock(code) {
  return PRACTICE_BLOCK_CODES[code] || 'other';
}

const singleton = createMacBetaDiagnostics();
module.exports = Object.assign(singleton, {
  createMacBetaDiagnostics, validEndpoint, classifyBundleError,
  classifyFfmpegDownloadError, classifyYtdlpUpdate, classifySeparationInstallError, classifyPracticeBlock,
});
