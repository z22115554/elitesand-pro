'use strict';

/**
 * Mac 內測版診斷回報的欄位白名單（唯一來源）。
 *
 * 接收端 cloudflare/mac-beta-diag-worker/src/validation.ts 有一份同樣的清單；
 * tests/mac-beta-diagnostics.test.js 會在兩份都在的時候比對它們一致。
 *
 * 原則跟 telemetry-fields.js 一樣：每個值都是封閉列舉、布林或有上下限的整數，
 * 沒有任何自由文字欄位——錯誤訊息常含路徑與歌名，所以只收類別或既有的錯誤代碼。
 */

const SCHEMA_VERSION = 1;
const MAX_EVENTS_PER_BATCH = 20;
const MAX_BODY_BYTES = 4096;
const MAX_COUNT = 100000;

const ARCHES = Object.freeze(['arm64', 'x64']);
const CHIPS = Object.freeze(['apple', 'intel']);
const MEM_TIERS = Object.freeze(['8', '16', '24', '32', '48', '64+']);
const GPU_VENDORS = Object.freeze(['apple', 'intel', 'amd', 'other', 'none']);

/** 元件檢查：name → 允許的結果代碼 */
const COMPONENTS = Object.freeze({
  ffmpeg_source: Object.freeze(['homebrew', 'downloaded', 'path', 'config', 'missing']),
  ffmpeg_download: Object.freeze(['ok', 'already', 'download_failed', 'verify_failed', 'extract_failed', 'system_check', 'unsupported_platform', 'other']),
  ytdlp_available: Object.freeze(['ok', 'missing']),
  ytdlp_update: Object.freeze(['ok', 'up_to_date', 'signature_failed', 'hash_mismatch', 'network', 'not_writable', 'other']),
  bundled_node: Object.freeze(['ok', 'missing', 'failed']),
  // AI 分離元件包（Mac）
  mac_support: Object.freeze(['ok', 'intel', 'macos_old']),
  runtime_install: Object.freeze(['ok', 'unsupported', 'disk_full', 'download_failed', 'hash_mismatch', 'extract_failed', 'pip_failed', 'cancelled', 'other']),
  primary_model: Object.freeze(['ok', 'download_failed', 'verify_failed', 'cancelled', 'other']),
  python_exec: Object.freeze(['ok', 'failed', 'missing']),
});

const IMPORT_CODES = Object.freeze([
  'ok', 'ytdlp_missing', 'ytdlp_http_403', 'ytdlp_http_404', 'ytdlp_geo_blocked',
  'ytdlp_private', 'ytdlp_auth_required', 'ytdlp_rate_limited', 'ytdlp_timeout', 'ytdlp_format_unavailable',
  'ffmpeg_missing', 'ffmpeg_failed', 'disk_full', 'network', 'other',
]);

/** 功能里程碑：name → 允許的結果代碼 */
const MILESTONES = Object.freeze({
  youtube_import: IMPORT_CODES,
  local_import: Object.freeze(['ok', 'failed']),
  playback_start: Object.freeze(['ok']),
  obs_display_loaded: Object.freeze(['ok']),
  obs_setlist_loaded: Object.freeze(['ok']),
  mic_permission: Object.freeze(['granted', 'denied', 'prompt', 'unsupported']),
  practice_blocked: Object.freeze(['vocals_required', 'vocals_missing', 'runtime_missing', 'analysis_failed', 'timeout', 'invalid_output', 'other']),
  separation_click: Object.freeze(['started', 'queued', 'install_ok', 'runtime_not_ready', 'unsupported_platform', 'ffmpeg_missing', 'disk_full', 'cancelled', 'other']),
  update_check: Object.freeze(['ok', 'failed']),
  separation_precheck: Object.freeze(['ok', 'intel', 'macos_old', 'disk_low']),
  separation_start: Object.freeze(['ok']),
});

// 每次分離的結果（只有類別與級距）
const SEPARATION_RESULTS = Object.freeze(['ok', 'oom', 'timeout', 'device_lost', 'engine_unavailable', 'input_unreadable', 'no_output', 'runtime_missing', 'model_missing', 'other']);
const SEPARATION_DEVICES = Object.freeze(['mps', 'cpu', 'webgpu', 'cuda', 'none']);
const LENGTH_TIERS = Object.freeze(['lt1m', '1-3m', '3-5m', '5-8m', '8m+', 'unknown']);
// 耗時 ÷ 歌曲長度
const SPEED_TIERS = Object.freeze(['lt0.25', '0.25-0.5', '0.5-1', '1-2', '2-4', '4+', 'unknown']);
// 練唱音高線
const PITCH_RESULTS = Object.freeze(['ok', 'vocals_required', 'python_missing', 'analysis_failed', 'timeout', 'invalid_output', 'other']);
const PITCH_ALGORITHMS = Object.freeze(['yin', 'torchcrepe', 'none']);
const TIME_TIERS = Object.freeze(['lt10s', '10-30s', '30-60s', '1-3m', '3m+']);

const ERROR_KINDS = Object.freeze(['uncaught', 'unhandled_rejection', 'incident']);
const ERROR_CODE_RE = /^[A-Za-z0-9_]{1,40}$/;
const MODULE_RE = /^[a-z0-9-]{1,40}$/;
const INSTALL_ID_RE = /^[a-f0-9]{32}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const BUILD_RE = /^[A-Za-z0-9.]{1,32}$/;

const EVENT_KEYS = Object.freeze({
  launch: Object.freeze(['type', 'osMajor', 'arch', 'chip', 'memTier', 'rosetta', 'count']),
  gpu: Object.freeze(['type', 'api', 'adapter', 'shaderF16', 'vendor']),
  component: Object.freeze(['type', 'name', 'code']),
  milestone: Object.freeze(['type', 'name', 'code', 'count']),
  error: Object.freeze(['type', 'kind', 'code', 'module']),
  separation: Object.freeze(['type', 'result', 'device', 'cpuFallback', 'lengthTier', 'speedTier', 'deviceLost']),
  pitch_guide: Object.freeze(['type', 'result', 'algorithm', 'timeTier']),
});

function isInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function hasOnlyKeys(object, keys) {
  return Object.keys(object).every((key) => keys.includes(key)) && keys.every((key) => key in object);
}

/** 單一事件是否完全符合白名單（多一個欄位、少一個欄位、型別不對都算不合格） */
function validEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const keys = EVENT_KEYS[event.type];
  if (!keys || !hasOnlyKeys(event, keys)) return false;
  switch (event.type) {
    case 'launch':
      return isInt(event.osMajor, 10, 99) && ARCHES.includes(event.arch) && CHIPS.includes(event.chip)
        && MEM_TIERS.includes(event.memTier) && typeof event.rosetta === 'boolean' && isInt(event.count, 1, MAX_COUNT);
    case 'gpu':
      return typeof event.api === 'boolean' && typeof event.adapter === 'boolean'
        && typeof event.shaderF16 === 'boolean' && GPU_VENDORS.includes(event.vendor);
    case 'component':
      return Object.prototype.hasOwnProperty.call(COMPONENTS, event.name) && COMPONENTS[event.name].includes(event.code);
    case 'milestone':
      return Object.prototype.hasOwnProperty.call(MILESTONES, event.name) && MILESTONES[event.name].includes(event.code)
        && isInt(event.count, 1, MAX_COUNT);
    case 'separation':
      return SEPARATION_RESULTS.includes(event.result) && SEPARATION_DEVICES.includes(event.device)
        && typeof event.cpuFallback === 'boolean' && LENGTH_TIERS.includes(event.lengthTier)
        && SPEED_TIERS.includes(event.speedTier) && typeof event.deviceLost === 'boolean';
    case 'pitch_guide':
      return PITCH_RESULTS.includes(event.result) && PITCH_ALGORITHMS.includes(event.algorithm) && TIME_TIERS.includes(event.timeTier);
    case 'error':
      return ERROR_KINDS.includes(event.kind) && typeof event.code === 'string' && ERROR_CODE_RE.test(event.code)
        && typeof event.module === 'string' && MODULE_RE.test(event.module);
    default:
      return false;
  }
}

function validPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (!hasOnlyKeys(payload, ['schemaVersion', 'installId', 'appVersion', 'build', 'events'])) return false;
  return payload.schemaVersion === SCHEMA_VERSION
    && typeof payload.installId === 'string' && INSTALL_ID_RE.test(payload.installId)
    && typeof payload.appVersion === 'string' && VERSION_RE.test(payload.appVersion)
    && typeof payload.build === 'string' && BUILD_RE.test(payload.build)
    && Array.isArray(payload.events) && payload.events.length >= 1 && payload.events.length <= MAX_EVENTS_PER_BATCH
    && payload.events.every(validEvent);
}

/** 記憶體級距：往上取到最近的一級（例如 36GB → 48） */
function memTier(totalBytes) {
  const gb = Number(totalBytes) / (1024 ** 3);
  if (!Number.isFinite(gb) || gb <= 8.5) return '8';
  if (gb <= 16.5) return '16';
  if (gb <= 24.5) return '24';
  if (gb <= 32.5) return '32';
  if (gb <= 48.5) return '48';
  return '64+';
}

function lengthTier(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 'unknown';
  if (s < 60) return 'lt1m';
  if (s < 180) return '1-3m';
  if (s < 300) return '3-5m';
  if (s < 480) return '5-8m';
  return '8m+';
}

function speedTier(elapsedMs, audioSeconds) {
  const ratio = Number(elapsedMs) / 1000 / Number(audioSeconds);
  if (!Number.isFinite(ratio) || ratio <= 0) return 'unknown';
  if (ratio < 0.25) return 'lt0.25';
  if (ratio < 0.5) return '0.25-0.5';
  if (ratio < 1) return '0.5-1';
  if (ratio < 2) return '1-2';
  if (ratio < 4) return '2-4';
  return '4+';
}

function timeTier(elapsedMs) {
  const s = Number(elapsedMs) / 1000;
  if (!Number.isFinite(s) || s < 10) return 'lt10s';
  if (s < 30) return '10-30s';
  if (s < 60) return '30-60s';
  if (s < 180) return '1-3m';
  return '3m+';
}

function gpuVendor(raw) {
  const value = String(raw || '').toLowerCase();
  if (!value) return 'other';
  if (value.includes('apple')) return 'apple';
  if (value.includes('intel')) return 'intel';
  if (value.includes('amd') || value.includes('ati')) return 'amd';
  return 'other';
}

/** 未預期錯誤只留「代碼」：既有的 err.code（例如 ENOENT）或內建錯誤類別名稱，其餘一律 other */
const BUILTIN_ERROR_NAMES = Object.freeze(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'AbortError']);
function errorCode(error) {
  if (error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(error.code)) return error.code;
  if (error && BUILTIN_ERROR_NAMES.includes(error.name)) return error.name;
  return 'other';
}

/** 模組名：堆疊第一個 app 內的檔案的「主檔名」，不含任何資料夾 */
function errorModule(error) {
  const stack = error && typeof error.stack === 'string' ? error.stack : '';
  for (const line of stack.split('\n').slice(1, 12)) {
    const match = /[\\/](server|electron|public)[\\/](?:[^\\/():\s]+[\\/])*([A-Za-z0-9_-]{1,40})\.(?:m?js|cjs)\b/.exec(line);
    if (match && !line.includes('node_modules')) return match[2].toLowerCase().replace(/_/g, '-');
  }
  return 'unknown';
}

module.exports = {
  SCHEMA_VERSION, MAX_EVENTS_PER_BATCH, MAX_BODY_BYTES, MAX_COUNT,
  ARCHES, CHIPS, MEM_TIERS, GPU_VENDORS, COMPONENTS, MILESTONES, ERROR_KINDS, EVENT_KEYS,
  SEPARATION_RESULTS, SEPARATION_DEVICES, LENGTH_TIERS, SPEED_TIERS, PITCH_RESULTS, PITCH_ALGORITHMS, TIME_TIERS,
  validEvent, validPayload, memTier, gpuVendor, errorCode, errorModule, lengthTier, speedTier, timeTier,
};
