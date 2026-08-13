'use strict';

/**
 * 問題回報 — 報告組裝與驗證。
 *
 * 為什麼存在：TA 是實況主／VTuber，絕大多數沒有 GitHub 帳號，「請去開 issue」等於收不到
 * 回報。這個模組負責把使用者填的表單 + 已清理的本機診斷，組成一份「送出前就能整份看到」
 * 的文字，再交給 feedback-client 送到中繼。設計背景見 docs/FEEDBACK-SYSTEM-PLAN.md。
 *
 * 三個刻意的決定：
 * 1. **報告內文固定繁體中文**，不跟著介面語言跑；使用者當下的語言另存 locale 欄位。
 *    五語都翻的話維護者會收到看不懂的 issue。
 * 2. **只有文字**。診斷 ZIP 維持「使用者自己下載、需要時才附」，這個模組不碰附件。
 * 3. **驗證在這裡也做一次**，即使前端已經擋過；中繼端還會再做第三次。前端驗證只是體驗。
 */

const fs = require('fs');
const { APP_VERSION } = require('../utils/app-version');
const { LOG_DIR } = require('../utils/logger');
const { redactDiagnosticText, redactValue } = require('../utils/redaction');
const { tailFile, findRecentLogs, formatEvidenceDuration } = require('./diagnostic-bundle');

const SCHEMA_VERSION = 1;

// 分類同時決定 issue 標題前綴與標籤；新增分類要一併更新面板選單與中繼的允許清單。
const REPORT_TYPES = Object.freeze({
  'app-error': { label: '程式錯誤', issueLabel: 'type:bug' },
  'import-playback': { label: '匯入或播放問題', issueLabel: 'type:bug' },
  lyrics: { label: '歌詞問題', issueLabel: 'type:lyrics' },
  obs: { label: 'OBS 顯示問題', issueLabel: 'type:obs' },
  spout: { label: 'Spout 透明輸出問題', issueLabel: 'type:spout' },
  twitch: { label: 'Twitch 點歌問題', issueLabel: 'type:twitch' },
  'ui-i18n': { label: '介面或翻譯問題', issueLabel: 'type:i18n' },
  'feature-request': { label: '功能建議', issueLabel: 'type:feature' },
  other: { label: '其他問題', issueLabel: 'type:bug' },
});

const LIMITS = Object.freeze({
  title: { min: 5, max: 120 },
  description: { min: 10, max: 5000 },
  steps: { maxItems: 20, maxLength: 500 },
  expected: { max: 2000 },
  actual: { min: 1, max: 2000 },
  contact: { max: 200 },
  // 日誌以「警告與錯誤優先」取，不是無腦取最後 N 行：實測最後 200 行有 95% 是
  // GET /js/... -> 200 的靜態檔存取記錄，除錯價值為零卻會把回報撐到 19 KB。
  logWarnings: 60,
  logRecent: 40,
  logBytes: 24 * 1024,
});

// 靜態資源與輪詢端點的成功存取記錄：量大且不帶資訊，一律排除。
const LOG_NOISE = new RegExp([
  '\\[API\\]\\s+(GET|HEAD)\\s+/(js|css|vendor|fonts|img)/',
  '\\[API\\]\\s+GET\\s+/api/(twitch/status|announcements|update-check|system-check)\\s+->\\s+(200|304)',
  '\\[API\\]\\s+GET\\s+/(display|setlist|controller)\\b[^\\s]*\\s+->\\s+(200|304)',
].join('|'));

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function safeSpoutState(value) {
  return ['idle', 'starting', 'running', 'error'].includes(value) ? value : 'unknown';
}

// This is deliberately a whitelist, not a generic renderer payload. The
// Electron bridge already excludes paths and the adapter LUID; validate again
// at the server boundary because feedback requests are still untrusted input.
function sanitizeSpoutDiagnostics(input) {
  const source = input && typeof input === 'object' ? input : null;
  if (!source || Number(source.schemaVersion) !== 1 || !Array.isArray(source.samples)) return null;
  const samples = source.samples.slice(-60).map((sample) => {
    const row = sample && typeof sample === 'object' ? sample : {};
    const gpu = row.gpuSync && typeof row.gpuSync === 'object' ? row.gpuSync : {};
    const sourceCopy = row.sourceCopySync && typeof row.sourceCopySync === 'object' ? row.sourceCopySync : {};
    const adapter = row.adapter && typeof row.adapter === 'object' ? row.adapter : {};
    return {
      elapsedMs: boundedNumber(row.elapsedMs, 0, 24 * 60 * 60 * 1000),
      state: safeSpoutState(row.state),
      width: boundedNumber(row.width, 0, 3840),
      height: boundedNumber(row.height, 0, 2160),
      configuredFps: boundedNumber(row.configuredFps, 0, 240),
      framesReceived: boundedNumber(row.framesReceived, 0, Number.MAX_SAFE_INTEGER),
      framesReleased: boundedNumber(row.framesReleased, 0, Number.MAX_SAFE_INTEGER),
      framesSent: boundedNumber(row.framesSent, 0, Number.MAX_SAFE_INTEGER),
      framesDropped: boundedNumber(row.framesDropped, 0, Number.MAX_SAFE_INTEGER),
      queueDepth: boundedNumber(row.queueDepth, 0, 16),
      maxQueueDepth: boundedNumber(row.maxQueueDepth, 0, 16),
      inFlightFrames: boundedNumber(row.inFlightFrames, 0, 16),
      gpuSync: {
        lastMs: boundedNumber(gpu.lastMs, 0, 60000), averageMs: boundedNumber(gpu.averageMs, 0, 60000),
        maxMs: boundedNumber(gpu.maxMs, 0, 60000), timeouts: boundedNumber(gpu.timeouts, 0, Number.MAX_SAFE_INTEGER),
      },
      sourceCopySync: {
        lastMs: boundedNumber(sourceCopy.lastMs, 0, 60000), averageMs: boundedNumber(sourceCopy.averageMs, 0, 60000),
        maxMs: boundedNumber(sourceCopy.maxMs, 0, 60000), timeouts: boundedNumber(sourceCopy.timeouts, 0, Number.MAX_SAFE_INTEGER),
      },
      adapter: {
        vendorId: boundedNumber(adapter.vendorId, 0, 0xFFFFFFFF), deviceId: boundedNumber(adapter.deviceId, 0, 0xFFFFFFFF),
      },
    };
  });
  return { active: !!source.active, durationMs: boundedNumber(source.durationMs, 0, 24 * 60 * 60 * 1000), samples };
}

/**
 * 只做長度與型別檢查，不改寫使用者文字（除了去頭尾空白）。
 * 回傳 { ok, errors: [{ field, code }], value } —— errors 用代碼而非句子，
 * 讓面板可以用既有 i18n 顯示，不必在伺服器端翻譯五種語言。
 */
function validateReport(input) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = [];

  const schemaVersion = Number(source.schemaVersion);
  if (schemaVersion !== SCHEMA_VERSION) errors.push({ field: 'schemaVersion', code: 'UNSUPPORTED_SCHEMA' });

  const type = asText(source.type);
  if (!REPORT_TYPES[type]) errors.push({ field: 'type', code: 'INVALID_TYPE' });

  const title = asText(source.title);
  if (title.length < LIMITS.title.min) errors.push({ field: 'title', code: 'TOO_SHORT' });
  else if (title.length > LIMITS.title.max) errors.push({ field: 'title', code: 'TOO_LONG' });

  const description = asText(source.description);
  if (description.length < LIMITS.description.min) errors.push({ field: 'description', code: 'TOO_SHORT' });
  else if (description.length > LIMITS.description.max) errors.push({ field: 'description', code: 'TOO_LONG' });

  const steps = (Array.isArray(source.steps) ? source.steps : String(source.steps || '').split(/\r?\n/))
    .map(asText)
    .filter(Boolean);
  if (!steps.length) errors.push({ field: 'steps', code: 'TOO_SHORT' });
  else if (steps.length > LIMITS.steps.maxItems) errors.push({ field: 'steps', code: 'TOO_MANY' });
  else if (steps.some((step) => step.length > LIMITS.steps.maxLength)) errors.push({ field: 'steps', code: 'TOO_LONG' });

  const actual = asText(source.actual);
  if (!actual) errors.push({ field: 'actual', code: 'TOO_SHORT' });
  else if (actual.length > LIMITS.actual.max) errors.push({ field: 'actual', code: 'TOO_LONG' });

  const expected = asText(source.expected);
  if (expected.length > LIMITS.expected.max) errors.push({ field: 'expected', code: 'TOO_LONG' });

  const contact = asText(source.contact);
  if (contact.length > LIMITS.contact.max) errors.push({ field: 'contact', code: 'TOO_LONG' });

  return {
    ok: errors.length === 0,
    errors,
    value: {
      schemaVersion: SCHEMA_VERSION,
      type,
      title,
      description,
      steps,
      expected,
      actual,
      contact,
      includeDiagnostics: source.includeDiagnostics !== false,
      locale: asText(source.locale) || 'zh-TW',
      spoutDiagnostics: type === 'spout' && source.includeDiagnostics !== false
        ? sanitizeSpoutDiagnostics(source.spoutDiagnostics)
        : null,
    },
  };
}

function tailLogLines(options = {}) {
  const dependencies = options.fs || fs;
  const logDir = options.logDir || LOG_DIR;
  const logs = findRecentLogs(logDir, dependencies);
  if (!logs.length) return { available: false, lines: [] };
  const raw = tailFile(logs[0].filePath, LIMITS.logBytes, dependencies);
  if (!raw) return { available: false, lines: [] };
  // tailFile 從位元組位移讀起，第一行通常被切一半（"ET /js/... -> 200"）。
  // 半行既無法判讀也躲得過噪音過濾，直接丟掉。
  const all = redactDiagnosticText(raw)
    .split(/\r?\n/)
    .filter((line, index) => line.trim() && (index > 0 || line.startsWith('[')));
  const warnings = all.filter((line) => /\[(WARN|ERROR)\]/.test(line)).slice(-LIMITS.logWarnings);
  const recent = all.filter((line) => !LOG_NOISE.test(line)).slice(-LIMITS.logRecent);
  return {
    available: warnings.length > 0 || recent.length > 0,
    name: logs[0].name,
    warnings,
    recent,
  };
}

/**
 * 每一項各自 try/catch：缺 yt-dlp、日誌被鎖住、系統資訊拿不到，都不該讓整份回報送不出去。
 * 失敗的項目以 null 呈現，面板會照實顯示「這項取不到」，而不是假裝有資料。
 */
function collectDiagnostics(options = {}) {
  const diagnostics = {
    appVersion: APP_VERSION,
    distribution: process.env.ELITESAND_SHELL === '1' ? 'desktop-shell' : 'standalone',
    node: process.version,
    os: null,
    tools: null,
    runtime: null,
    logs: null,
  };

  try {
    const os = require('os');
    diagnostics.os = { platform: process.platform, release: os.release(), arch: process.arch };
  } catch (_) { diagnostics.os = null; }

  try {
    const check = options.systemCheck || null;
    diagnostics.tools = check ? redactValue({
      ytdlp: check.ytdlp || null,
      ytdlpCompatibility: check.ytdlpCompatibility || null,
      ffmpeg: check.ffmpeg || null,
    }) : null;
  } catch (_) { diagnostics.tools = null; }

  try {
    const evidence = options.runtimeEvidence || null;
    diagnostics.runtime = evidence ? redactValue({
      observedMs: evidence.observedMs || 0,
      obs: evidence.obs || null,
      twitch: evidence.twitch
        // 連線與否／次數對除錯有用，頻道名稱沒有，直接不取。
        ? {
          configured: !!evidence.twitch.configured,
          connected: !!evidence.twitch.connected,
          connections: evidence.twitch.connections || 0,
          reconnects: evidence.twitch.reconnects || 0,
          disconnects: evidence.twitch.disconnects || 0,
        }
        : null,
    }) : null;
  } catch (_) { diagnostics.runtime = null; }

  try {
    diagnostics.logs = tailLogLines(options);
  } catch (_) { diagnostics.logs = null; }

  return diagnostics;
}

function formatDiagnosticsBlock(diagnostics) {
  if (!diagnostics) return ['（使用者選擇不附加診斷資訊）'];
  const lines = [];
  lines.push(`- Elitesand Pro：${diagnostics.appVersion}`);
  lines.push(`- 發行形式：${diagnostics.distribution === 'desktop-shell' ? '桌面版（Electron）' : '直接執行 server'}`);
  lines.push(`- Node：${diagnostics.node}`);
  lines.push(diagnostics.os
    ? `- 系統：${diagnostics.os.platform} ${diagnostics.os.release} ${diagnostics.os.arch}`
    : '- 系統：取不到');
  if (diagnostics.tools) {
    const ytdlp = diagnostics.tools.ytdlp || {};
    const ffmpeg = diagnostics.tools.ffmpeg || {};
    lines.push(`- yt-dlp：${ytdlp.available ? (ytdlp.version || '可用') : '找不到'}`);
    lines.push(`- FFmpeg：${ffmpeg.available ? (ffmpeg.version || '可用') : '找不到'}`);
    const compatibility = diagnostics.tools.ytdlpCompatibility;
    if (compatibility && compatibility.state) lines.push(`- yt-dlp 相容性：${compatibility.state}`);
  } else {
    lines.push('- 工具健康狀態：取不到');
  }
  if (diagnostics.runtime) {
    const obs = diagnostics.runtime.obs || {};
    const twitch = diagnostics.runtime.twitch || {};
    lines.push(`- 本場記錄時長：${formatEvidenceDuration(diagnostics.runtime.observedMs)}`);
    lines.push(`- OBS 兩來源曾同時連線：${obs.bothSourcesSeen ? '是' : '否'}（中斷 ${obs.interruptions || 0} 次）`);
    lines.push(`- Twitch：${twitch.configured ? (twitch.connected ? '已連線' : '已啟用但未連線') : '未啟用'}`);
  } else {
    lines.push('- 連線觀測：取不到');
  }
  return lines;
}

function formatLogBlock(diagnostics) {
  const logs = diagnostics && diagnostics.logs;
  if (!logs || !logs.available) return ['（沒有可用的日誌，或使用者選擇不附加）'];
  const block = [];
  if (logs.warnings && logs.warnings.length) {
    block.push(`最近 ${logs.warnings.length} 筆警告與錯誤：`, '', '```', ...logs.warnings, '```', '');
  } else {
    block.push('最近的日誌中沒有警告或錯誤。', '');
  }
  if (logs.recent && logs.recent.length) {
    block.push(`最後 ${logs.recent.length} 行（已濾除靜態檔存取記錄）：`, '', '```', ...logs.recent, '```');
  }
  return block;
}

/**
 * 組出最終要送出的內容。issueTitle／issueBody 給中繼建立 GitHub issue，
 * plainText 給面板預覽與「複製全文」降級路徑 —— 兩者內容一致，
 * 使用者預覽到的就是實際送出的，不會有隱藏欄位。
 */
function formatSpoutDiagnosticsBlock(diagnostics) {
  if (!diagnostics || !diagnostics.samples.length) {
    return ['## Spout 透明輸出紀錄', '', '沒有可附加的本機 Spout 紀錄；請重現問題後，從 Elitesand Pro 送出回報。', ''];
  }
  const latest = diagnostics.samples.at(-1);
  const lines = diagnostics.samples.map((sample) => [
    `+${Math.round(sample.elapsedMs)}ms`, sample.state, `${sample.width}x${sample.height}@${sample.configuredFps}`,
    `sent=${sample.framesSent}`, `received=${sample.framesReceived}`, `dropped=${sample.framesDropped}`,
    `gpu=${sample.gpuSync.lastMs.toFixed(2)}/${sample.gpuSync.averageMs.toFixed(2)}ms`,
    `gpuTimeout=${sample.gpuSync.timeouts}`, `copyTimeout=${sample.sourceCopySync.timeouts}`,
    `queue=${sample.queueDepth}/${sample.maxQueueDepth}`, `adapter=${sample.adapter.vendorId}:${sample.adapter.deviceId}`,
  ].join(' | '));
  return [
    '## Spout 透明輸出紀錄',
    '',
    `- 取樣：${diagnostics.samples.length} 筆；範圍：${Math.round(diagnostics.durationMs)} ms；送出當下：${diagnostics.active ? '仍在輸出' : '已停止'}`,
    `- 最後狀態：${latest.state}；送出 ${latest.framesSent}／收到 ${latest.framesReceived}／丟棄 ${latest.framesDropped}`,
    '- 僅包含近期效能數值；不包含 Sender 名稱、檔案路徑或裝置 LUID。',
    '',
    '```text',
    ...lines,
    '```',
    '',
  ];
}

function buildReport(input, options = {}) {
  const validation = validateReport(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const value = validation.value;
  const typeInfo = REPORT_TYPES[value.type];
  const diagnostics = value.includeDiagnostics ? collectDiagnostics(options) : null;

  const bodyLines = [
    `## 問題類型`,
    '',
    typeInfo.label,
    '',
    '## 問題說明',
    '',
    value.description,
    '',
    '## 重現步驟',
    '',
    ...value.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## 實際結果',
    '',
    value.actual,
    '',
    '## 預期結果',
    '',
    value.expected || '（未填寫）',
    '',
    '## 環境',
    '',
    ...formatDiagnosticsBlock(diagnostics),
    `- 介面語言：${value.locale}`,
    '',
    '## 最近日誌（已清理）',
    '',
    ...formatLogBlock(diagnostics),
    '',
    ...(value.type === 'spout' && value.includeDiagnostics ? formatSpoutDiagnosticsBlock(value.spoutDiagnostics) : []),
    '## 聯絡方式',
    '',
    value.contact || '（未留；此回報無法回覆）',
    '',
  ];

  // 使用者填的文字也過一次清理：他們很可能直接把含 token 的錯誤訊息貼進說明欄。
  const issueBody = redactDiagnosticText(bodyLines.join('\n'));
  const issueTitle = redactDiagnosticText(`[${typeInfo.label}][${APP_VERSION}] ${value.title}`).slice(0, 200);

  return {
    ok: true,
    report: {
      schemaVersion: SCHEMA_VERSION,
      type: value.type,
      title: value.title,
      locale: value.locale,
      appVersion: APP_VERSION,
      includeDiagnostics: value.includeDiagnostics,
      issueTitle,
      issueBody,
      issueLabels: ['source:in-app', 'status:needs-triage', typeInfo.issueLabel],
    },
    plainText: `${issueTitle}\n\n${issueBody}`,
    byteLength: Buffer.byteLength(issueBody, 'utf8'),
  };
}

module.exports = {
  SCHEMA_VERSION,
  REPORT_TYPES,
  LIMITS,
  validateReport,
  collectDiagnostics,
  sanitizeSpoutDiagnostics,
  buildReport,
};
