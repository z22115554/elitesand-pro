'use strict';

/**
 * 遙測欄位登錄表 —— 這份檔案是「日彙總到底會送出哪些欄位」的單一事實來源。
 *
 * 為什麼要有這個檔案：
 * 自動送出的日彙總沒有「送出前預覽」把關（那是問題回報 §7.6 才有的），
 * 所以唯一的防線就是**封閉白名單**。任何不在本表內的 key 會在本機被丟棄，
 * 接收端也會再擋一次。這樣才能保證程式不會偷偷多送一個 EULA 沒寫到的欄位。
 *
 * 鐵則（違反就等於打破 EULA §7.7 對使用者的承諾）：
 * 1. 絕不可送 error.message、堆疊、檔名、路徑、網址、歌名、歌詞、播放清單。
 *    yt-dlp 與 ffmpeg 的錯誤訊息慣性內嵌網址與路徑，路徑會帶出 Windows 使用者名稱。
 *    → 一律先 mapError() 轉成本表的封閉錯誤碼，對不上就歸 'other'。
 * 2. 絕不可在本通道送 YouTube 影片 ID。§7.8 偏移回饋另有獨立同意與獨立用途，
 *    兩邊都送會讓「失敗事件」與「特定影片」可被對應，破壞各自的目的限制。
 * 3. 硬體資訊一律分桶（GPU 只到廠牌＋世代、VRAM 只到區間）。
 *    精確型號字串在小樣本裡近乎唯一值；需要精確值時走 §7.6 問題回報。
 * 4. 不送時間戳。是哪一天就夠了——逐事件時間等於交出直播時段表。
 *
 * 改這裡 = 改 EULA。改動前先看 docs/EULA-FUTURE-COLLECTION.md。
 */

/** 當日是否用過某功能（只送用過／沒用過，不送次數與時間） */
const FEATURES = Object.freeze([
  'remote_control',
  'twitch_request',
  'obs_setlist',
  'obs_display',
  'pitch_shift',
  'tempo_shift',
  'media_library',
  'ai_separation',
  'lyrics_offset_edit',
]);

/** 有成功／失敗率的功能族。每族都必須同時有 attempt 與 ok，否則算不出率。 */
const OUTCOME_FAMILIES = Object.freeze(['import', 'lyrics', 'twitch', 'ai']);

/** 封閉錯誤碼。對不上的一律 'other'，不可夾帶原文。 */
const ERROR_CODES = Object.freeze({
  import: Object.freeze([
    'ytdlp_missing', 'ytdlp_http_403', 'ytdlp_http_404', 'ytdlp_geo_blocked',
    'ytdlp_private', 'ytdlp_auth_required', 'ytdlp_timeout', 'ytdlp_format_unavailable',
    'ffmpeg_missing', 'ffmpeg_failed', 'disk_full', 'network', 'other',
  ]),
  lyrics: Object.freeze(['no_match', 'source_error', 'timeout', 'network', 'other']),
  twitch: Object.freeze(['auth_expired', 'auth_denied', 'rate_limited', 'api_error', 'network', 'other']),
  ai: Object.freeze([
    'runtime_missing', 'oom', 'device_lost', 'unsupported_gpu',
    'timeout', 'cancelled', 'other',
  ]),
});

/**
 * 歌詞來源命中率。來源名稱是我方常數，不是使用者資料。
 * 必須與 lyrics-engine.js 的 LYRICS_SOURCE_PRIORITY 逐字一致——
 * 這份清單原本是憑空寫的（曾誤含不存在的 'musixmatch'／'local'／'manual'，
 * 且把 'qqmusic' 誤寫成 'qq'），接上呼叫端時才對照原始碼改正。
 */
const LYRIC_SOURCES = Object.freeze(['betterlyrics', 'paxsenix', 'kugou', 'qqmusic', 'lrclib', 'netease']);

/** 直播期間高風險事件——對直播主傷害最大的那些 */
const INCIDENTS = Object.freeze([
  'player_error',
  'media_missing',
  'obs_display_disconnect',
  'obs_setlist_disconnect',
  'playback_aborted',
  'ai_resource_exhausted',
]);

/** 必要依賴初始化狀態 */
const DEPENDENCIES = Object.freeze(['ytdlp', 'ffmpeg']);

/** 次數分桶：精確次數不改變決策，卻增加指紋面 */
const COUNT_BUCKETS = Object.freeze(['0', '1-2', '3-10', '10+']);

/** AI 分離效能，全部分桶 */
const AI_BACKENDS = Object.freeze(['cuda', 'webgpu', 'directml', 'cpu']);
const GPU_VENDORS = Object.freeze(['nvidia', 'amd', 'intel', 'apple', 'unknown']);
const VRAM_BUCKETS = Object.freeze(['lt4g', '4-6g', '6-8g', 'ge8g', 'unknown']);
const RTF_BUCKETS = Object.freeze(['lt0.1x', '0.1-0.3x', '0.3-1x', 'ge1x']);
const DURATION_BUCKETS = Object.freeze(['lt3m', '3-6m', '6-10m', 'ge10m']);

function countBucket(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n <= 2) return '1-2';
  if (n <= 10) return '3-10';
  return '10+';
}

function vramBucket(megabytes) {
  const mb = Number(megabytes);
  if (!Number.isFinite(mb) || mb <= 0) return 'unknown';
  if (mb < 4096) return 'lt4g';
  if (mb < 6144) return '4-6g';
  if (mb < 8192) return '6-8g';
  return 'ge8g';
}

function realtimeFactorBucket(factor) {
  const f = Number(factor);
  if (!Number.isFinite(f) || f < 0) return 'ge1x';
  if (f < 0.1) return 'lt0.1x';
  if (f < 0.3) return '0.1-0.3x';
  if (f < 1) return '0.3-1x';
  return 'ge1x';
}

function durationBucket(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 180) return 'lt3m';
  if (s < 360) return '3-6m';
  if (s < 600) return '6-10m';
  return 'ge10m';
}

/**
 * 把任意錯誤轉成封閉錯誤碼。**唯一允許的錯誤入口**。
 * 只讀 code 這種結構化欄位；絕不把 message 原文放進回傳值。
 */
function mapError(family, code) {
  const allowed = ERROR_CODES[family];
  if (!allowed) return null;
  const candidate = typeof code === 'string' ? code.trim().toLowerCase() : '';
  return allowed.includes(candidate) ? candidate : 'other';
}

/** 組出完整的合法 key 集合。本機與接收端都用這一份。 */
function buildAllowedKeys() {
  const keys = [];
  for (const name of FEATURES) keys.push(`feature.${name}`);
  for (const family of OUTCOME_FAMILIES) {
    keys.push(`${family}.attempt`, `${family}.ok`);
    for (const code of ERROR_CODES[family]) keys.push(`${family}.fail.${code}`);
  }
  for (const source of LYRIC_SOURCES) keys.push(`lyrics.source.${source}.hit`, `lyrics.source.${source}.miss`);
  keys.push('lyrics.auto_result_edited');
  for (const name of INCIDENTS) keys.push(`incident.${name}`);
  for (const bucket of COUNT_BUCKETS) keys.push(`incident.socket_reconnect.${bucket}`);
  for (const name of DEPENDENCIES) keys.push(`dep.${name}_ok`, `dep.${name}_missing`);
  keys.push('update.ok', 'update.failed');
  for (const backend of AI_BACKENDS) keys.push(`ai.backend.${backend}`);
  for (const vendor of GPU_VENDORS) keys.push(`ai.gpu.${vendor}`);
  for (const bucket of VRAM_BUCKETS) keys.push(`ai.vram.${bucket}`);
  for (const bucket of RTF_BUCKETS) keys.push(`ai.rtf.${bucket}`);
  for (const bucket of DURATION_BUCKETS) keys.push(`ai.duration.${bucket}`);
  keys.push('ai.fallback_to_cpu');
  keys.push('ai.retried'); // EULA §7.9(f)（1.8.0 起）：曾在同一後端重試後才完成
  return Object.freeze(keys.slice().sort());
}

const ALLOWED_KEYS = buildAllowedKeys();
const ALLOWED_KEY_SET = new Set(ALLOWED_KEYS);

/**
 * 「當天是否發生」（布林）vs「當天發生了幾次」（累加計數）——這兩種語意的
 * 欄位在 EULA §7.9 的措辭本來就不同（「僅記錄當天用過／沒用過，不含使用
 * 次數」vs「嘗試與成功／失敗『次數』」），record() 必須真的照這個語意存，
 * 不能全部用同一套累加邏輯，不然文件承諾「不含次數」會是假的。
 *
 * 屬於布林語意：功能旗標、單純事故（不含 socket 重連——那個是分桶計數，
 * 邏輯在 recordSocketReconnects 另外處理）、依賴狀態、更新結果、自動配對
 * 是否被改過、AI 分離的後端／硬體／耗時分類（每一類都是「今天是不是這一種」，
 * 不是次數）。
 * 屬於累加計數：各 family 的 attempt/ok/fail（EULA 明講是「次數」）、
 * 歌詞來源命中／未命中（EULA 明講是「次數」）。
 */
function isDailyBooleanKey(key) {
  if (key.startsWith('feature.')) return true;
  if (key.startsWith('incident.') && !key.startsWith('incident.socket_reconnect.')) return true;
  if (key.startsWith('dep.')) return true;
  if (key === 'update.ok' || key === 'update.failed') return true;
  if (key === 'lyrics.auto_result_edited') return true;
  if (/^ai\.(backend|gpu|vram|rtf|duration)\./.test(key)) return true;
  if (key === 'ai.fallback_to_cpu' || key === 'ai.retried') return true;
  return false;
}

/** 單一計數上限：極端離群值本身就是識別特徵，而且對決策沒有幫助 */
const MAX_COUNTER_VALUE = 10000;

function isAllowedKey(key) {
  return ALLOWED_KEY_SET.has(key);
}

module.exports = {
  FEATURES,
  OUTCOME_FAMILIES,
  ERROR_CODES,
  LYRIC_SOURCES,
  INCIDENTS,
  DEPENDENCIES,
  COUNT_BUCKETS,
  AI_BACKENDS,
  GPU_VENDORS,
  VRAM_BUCKETS,
  RTF_BUCKETS,
  DURATION_BUCKETS,
  ALLOWED_KEYS,
  MAX_COUNTER_VALUE,
  isAllowedKey,
  isDailyBooleanKey,
  mapError,
  countBucket,
  vramBucket,
  realtimeFactorBucket,
  durationBucket,
};
