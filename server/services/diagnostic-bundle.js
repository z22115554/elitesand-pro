'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { APP_VERSION } = require('../utils/app-version');
const { LOG_DIR } = require('../utils/logger');

const MAX_LOG_FILES = 3;
const MAX_LOG_BYTES_PER_FILE = 16 * 1024;
const R12_MINIMUM_OBSERVED_MS = 4 * 60 * 60 * 1000;

function redactDiagnosticText(value) {
  return String(value == null ? '' : value)
    .replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9._~-]+/gi, '$1 [redacted]')
    .replace(/((?:access|refresh)_?token["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/\b(client_secret|authorization|password)\s*[:=]\s*[^\s,]+/gi, '$1=[redacted]')
    .replace(/\bPIN\s*[:=]\s*\d+/gi, 'PIN: [redacted]')
    .replace(/(Twitch\s+\u5DF2\u6388\u6B0A\u983B\u9053[\uFF1A:]\s*)[^\r\n]+/g, '$1[redacted]')
    .replace(/\b[A-Za-z]:\\[^\r\n]*/g, '[local-path]');
}

function redactValue(value, depth = 0) {
  if (depth > 8) return '[omitted]';
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /(?:token|secret|authorization|password|pin)/i.test(key) ? '[redacted]' : redactValue(item, depth + 1),
    ]));
  }
  return value;
}

function tailFile(filePath, maxBytes = MAX_LOG_BYTES_PER_FILE, dependencies = fs) {
  let handle;
  try {
    const stat = dependencies.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return '';
    const bytes = Math.min(Number(stat.size), maxBytes);
    const buffer = Buffer.alloc(bytes);
    handle = dependencies.openSync(filePath, 'r');
    dependencies.readSync(handle, buffer, 0, bytes, Math.max(0, Number(stat.size) - bytes));
    return buffer.toString('utf8');
  } catch (_) {
    return '';
  } finally {
    if (handle != null) {
      try { dependencies.closeSync(handle); } catch (_) { /* best effort */ }
    }
  }
}

function findRecentLogs(logDir = LOG_DIR, dependencies = fs) {
  try {
    return dependencies.readdirSync(logDir)
      .filter((name) => path.extname(name).toLowerCase() === '.log' && path.basename(name) === name)
      .map((name) => {
        const filePath = path.join(logDir, name);
        const lstat = dependencies.lstatSync(filePath);
        if (!lstat.isFile() || lstat.isSymbolicLink()) return null;
        return { name, filePath, mtimeMs: Number(lstat.mtimeMs) || 0 };
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
      .slice(0, MAX_LOG_FILES);
  } catch (_) {
    return [];
  }
}

function formatFileTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatEvidenceDuration(value) {
  const milliseconds = Number(value);
  const totalMinutes = Math.max(0, Math.floor((Number.isFinite(milliseconds) ? milliseconds : 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} 小時 ${minutes} 分`;
  if (totalMinutes > 0) return `${totalMinutes} 分`;
  return '未滿 1 分';
}

function yesNo(value) {
  return value ? '是' : '否';
}

// Keep this deliberately human-readable and derived only from the already-redacted,
// memory-only snapshot. It helps an operator inspect a real R12 run without
// requiring them to infer the meaning of the JSON fields or share the whole ZIP.
function createRuntimeEvidenceSummary(evidence = {}) {
  const snapshot = evidence && typeof evidence === 'object' ? evidence : {};
  const obs = snapshot.obs && typeof snapshot.obs === 'object' ? snapshot.obs : {};
  const twitch = snapshot.twitch && typeof snapshot.twitch === 'object' ? snapshot.twitch : {};
  const observedMs = Math.max(0, Number(snapshot.observedMs) || 0);
  const bothSourcesMs = Math.max(0, Number(obs.bothSourcesConnectedMs) || 0);
  const targetReached = observedMs >= R12_MINIMUM_OBSERVED_MS;

  return [
    'Elitesand Pro 直播穩定性核對摘要',
    '',
    `本場記錄時長：${formatEvidenceDuration(observedMs)}`,
    `四小時時長門檻：${targetReached ? '已達成' : '尚未達成'}`,
    '',
    'OBS 正式來源（歌詞 + 歌單）：',
    `- 歌詞來源曾連線：${yesNo(obs.displaySeen)}`,
    `- 歌單來源曾連線：${yesNo(obs.setlistSeen)}`,
    `- 兩來源曾同時連線：${yesNo(obs.bothSourcesSeen)}`,
    `- 兩來源同時連線時長：${formatEvidenceDuration(bothSourcesMs)}`,
    `- 兩來源中斷次數：${Math.max(0, Number(obs.interruptions) || 0)}`,
    '',
    'Twitch：',
    `- 已啟用：${yesNo(twitch.configured)}`,
    `- 曾納入觀測：${yesNo(twitch.observed)}`,
    `- 目前已連線：${yesNo(twitch.connected)}`,
    `- 連線次數：${Math.max(0, Number(twitch.connections) || 0)}`,
    `- 重連次數：${Math.max(0, Number(twitch.reconnects) || 0)}`,
    `- 斷線次數：${Math.max(0, Number(twitch.disconnects) || 0)}`,
    `- 累計連線時長：${formatEvidenceDuration(twitch.connectedMs)}`,
    '',
    '判讀提醒：此摘要只呈現本機記憶體中的連線時間與計數，不含歌單、歌詞、聊天室、位址或憑證。',
    '「四小時時長門檻」只核對記錄長度；是否為正式直播仍須由操作者依 OBS 與 Twitch 實際流程確認。',
    'OBS 中斷次數會在兩個正式來源曾同時連線後，兩者不再同時連線時增加。詳細欄位請看 runtime-evidence.json。',
    '',
  ].join('\n');
}

function createDiagnosticBundle(options = {}) {
  const dependencies = options.fs || fs;
  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date(options.generatedAt || Date.now());
  const logDir = options.logDir || LOG_DIR;
  const systemCheck = redactValue(options.systemCheck || {});
  const runtimeEvidence = redactValue(options.runtimeEvidence || {});
  const runtimeEvidenceSummary = createRuntimeEvidenceSummary(runtimeEvidence);
  const logs = findRecentLogs(logDir, dependencies);
  const zip = new AdmZip();
  const includedLogs = [];

  zip.addFile('README.txt', Buffer.from([
    'Elitesand Pro diagnostic bundle',
    '',
    'This bundle is created only after the user requests it.',
    'Included: app version, public tool health, a human-readable live-reliability summary, memory-only connection timing/count evidence, and short redacted server-log tails.',
    'Excluded: playlist, lyrics, audio files, media-library data, PIN, Twitch credentials, and full logs.',
    'Short operational log tails may still mention song or video titles; inspect the bundle before sharing.',
    'Please inspect the bundle before sharing it with support.',
    '',
  ].join('\n'), 'utf8'));
  zip.addFile('system-check.json', Buffer.from(`${JSON.stringify(systemCheck, null, 2)}\n`, 'utf8'));
  zip.addFile('runtime-evidence.json', Buffer.from(`${JSON.stringify(runtimeEvidence, null, 2)}\n`, 'utf8'));
  zip.addFile('runtime-evidence-summary.txt', Buffer.from(runtimeEvidenceSummary, 'utf8'));

  for (const logFile of logs) {
    const content = redactDiagnosticText(tailFile(logFile.filePath, MAX_LOG_BYTES_PER_FILE, dependencies));
    if (!content) continue;
    const safeName = path.basename(logFile.name).replace(/[^A-Za-z0-9._-]/g, '_');
    zip.addFile(`logs/${safeName}.txt`, Buffer.from(content, 'utf8'));
    includedLogs.push(safeName);
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    appVersion: options.appVersion || APP_VERSION,
    includedLogs,
    includesRuntimeEvidence: true,
    includesRuntimeEvidenceSummary: true,
    logTailBytesPerFile: MAX_LOG_BYTES_PER_FILE,
    redaction: ['access tokens', 'refresh tokens', 'authorization values', 'PIN values', 'password values', 'Windows paths'],
  };
  zip.addFile('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));

  return {
    buffer: zip.toBuffer(),
    filename: `elitesand-pro-diagnostic-${formatFileTimestamp(generatedAt)}.zip`,
    manifest,
  };
}

module.exports = {
  MAX_LOG_FILES,
  MAX_LOG_BYTES_PER_FILE,
  R12_MINIMUM_OBSERVED_MS,
  redactDiagnosticText,
  redactValue,
  formatEvidenceDuration,
  createRuntimeEvidenceSummary,
  tailFile,
  findRecentLogs,
  createDiagnosticBundle,
};
