const fs = require('fs');
const path = require('path');
const { logsDir: LOG_DIR } = require('./app-paths');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MAX_LOG_SIZE = 50 * 1024 * 1024;
const MAX_LOG_FILES = 30;

let currentLogLevel = LOG_LEVELS.INFO;
let logStream = null;
let currentLogDate = '';
let fileLoggingDisabled = false;
// 目前這條串流已經寫了多少 bytes：輪替判斷改成「寫入當下即時檢查」，不能只在開新
// 串流那一刻檢查一次——同一天內持續寫入（例如失控迴圈）原本完全不會被這個上限攔住，
// 2026-08-04 就是這樣一路寫到 80GB 才把 C 槽灌滿。
let currentStreamBytes = 0;

function ensureLogDir() {
  if (fileLoggingDisabled) return false;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    return true;
  } catch (err) {
    fileLoggingDisabled = true;
    console.error('[Logger] log directory unavailable, console logging only:', err.message);
    return false;
  }
}

function getDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatMessage(level, moduleName, message, extra) {
  let line = `[${getTimestamp()}] [${level}] [${moduleName}] ${message}`;

  if (extra !== undefined && extra !== null) {
    if (extra instanceof Error) {
      line += `\n  Stack: ${extra.stack || extra.message}`;
    } else if (typeof extra === 'object') {
      try {
        line += `\n  Data: ${JSON.stringify(extra)}`;
      } catch (err) {
        line += '\n  Data: [unserializable]';
      }
    } else {
      line += `\n  Extra: ${extra}`;
    }
  }

  return line;
}

function pruneOldLogFiles() {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('elitesand-pro-') && f.endsWith('.log'))
      .sort()
      .reverse();

    for (const f of files.slice(MAX_LOG_FILES)) {
      try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch (err) { /* ignore */ }
    }
  } catch (err) {
    // Best-effort only.
  }
}

// 把目前這條串流關掉、把檔案更名成備份檔，讓下一次 writeLog() 的 getLogStream()
// 開出全新的檔案——不能只把檔案更名卻讓現有串流繼續往（已改名的）舊檔案寫下去，
// 那樣輪替形同虛設（改名瞬間之後所有內容仍流進同一個 inode，只是檔名變了）。
function rotateLogFile() {
  const stream = logStream;
  const rotatingDate = currentLogDate;
  logStream = null;
  currentStreamBytes = 0;
  if (!stream) return;
  try { stream.end(); } catch (err) { /* ignore */ }
  const logFile = path.join(LOG_DIR, `elitesand-pro-${rotatingDate}.log`);
  try {
    const backupFile = logFile.replace('.log', `.${Date.now()}.log`);
    fs.renameSync(logFile, backupFile);
    console.log(`[Logger] rotated log: ${path.basename(backupFile)}`);
  } catch (err) {
    // Best-effort only.
  }
  pruneOldLogFiles();
}

function disableFileLogging(err) {
  fileLoggingDisabled = true;
  if (logStream) {
    try { logStream.destroy(); } catch (e) { /* ignore */ }
    logStream = null;
  }
  if (err) console.error('[Logger] log file unavailable, console logging only:', err.message || err);
}

function getLogStream() {
  if (fileLoggingDisabled || !ensureLogDir()) return null;

  const today = getDateString();
  if (today === currentLogDate && logStream) return logStream;

  if (logStream) {
    try { logStream.end(); } catch (err) { /* ignore */ }
    logStream = null;
  }

  const logFile = path.join(LOG_DIR, `elitesand-pro-${today}.log`);

  try {
    const stream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf8' });
    stream.on('error', disableFileLogging);
    logStream = stream;
    currentLogDate = today;
    currentStreamBytes = 0;
    const header = `\n${'='.repeat(60)}\n  Elitesand Pro log - ${today}\n  Started: ${getTimestamp()}\n${'='.repeat(60)}\n\n`;
    stream.write(header);
    currentStreamBytes += Buffer.byteLength(header);
    // 開檔當下若已存在（附加模式，可能是同一天重啟）且已經超過上限，先輪替一次；
    // 之後的上限檢查交給 writeLog() 每次寫入即時判斷，不再只靠這裡的單次快照。
    try {
      const stats = fs.statSync(logFile);
      if (stats.size > MAX_LOG_SIZE) rotateLogFile();
    } catch (err) { /* 檔案不存在等同全新，忽略 */ }
    pruneOldLogFiles();
  } catch (err) {
    disableFileLogging(err);
  }

  return logStream;
}

function writeLog(level, levelName, moduleName, message, extra) {
  if (level < currentLogLevel) return;

  const formatted = formatMessage(levelName, moduleName, message, extra);
  const consoleFn = level >= LOG_LEVELS.ERROR ? console.error
    : level >= LOG_LEVELS.WARN ? console.warn
    : console.log;
  // 曾經在正式環境把 80GB 空間吃光：stdout/stderr 管道斷掉時（父行程/終端機已關閉，
  // 子行程還活著）console.error 本身會丟出 EPIPE，若不包住，這個丟出會被 server/index.js
  // 的 uncaughtException 安全網接到、再呼叫這裡想記錄它、又再丟一次 EPIPE——無限迴圈，
  // 每一輪都把完整 stack trace 寫進 log，全速跑到硬碟見底。這裡吞掉寫入失敗就好，
  // 檔案那邊的寫入已經有獨立的 try/catch（見下方 stream.write），沒有理由 console 這邊沒有。
  try { consoleFn(formatted); } catch (err) { /* 靜默：console 本身寫壞不該讓伺服器跟著炸 */ }

  const stream = getLogStream();
  if (stream && stream.writable) {
    try {
      const line = formatted + '\n';
      stream.write(line);
      currentStreamBytes += Buffer.byteLength(line);
      // 即時檢查，不等下一次開新串流才輪替——見檔案開頭的說明，這是這次 80GB
      // 事故的第二個破口（原本只在開新串流那一刻檢查一次，同一天內完全不會再重算）。
      if (currentStreamBytes > MAX_LOG_SIZE) rotateLogFile();
    } catch (err) {
      disableFileLogging(err);
    }
  }
}

function createLogger(moduleName) {
  return {
    info(message, extra) {
      writeLog(LOG_LEVELS.INFO, 'INFO', moduleName, message, extra);
    },
    warn(message, extra) {
      writeLog(LOG_LEVELS.WARN, 'WARN', moduleName, message, extra);
    },
    error(message, extra) {
      writeLog(LOG_LEVELS.ERROR, 'ERROR', moduleName, message, extra);
    },
    debug(message, extra) {
      writeLog(LOG_LEVELS.DEBUG, 'DEBUG', moduleName, message, extra);
    },
    request(method, url, statusCode, durationMs, extra) {
      const msg = `${method} ${url} -> ${statusCode} (${durationMs}ms)`;
      const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
      writeLog(LOG_LEVELS[level] || LOG_LEVELS.INFO, level, 'API', msg, extra);
    },
    socket(event, socketId, data) {
      writeLog(LOG_LEVELS.DEBUG, 'DEBUG', 'Socket', `Socket[${socketId}] ${event}`, data);
    },
    perf(operation, durationMs, extra) {
      writeLog(LOG_LEVELS.INFO, 'INFO', 'Perf', `PERF ${operation}: ${durationMs.toFixed(1)}ms`, extra);
    },
  };
}

function shutdown() {
  writeLog(LOG_LEVELS.INFO, 'INFO', 'Logger', 'Logger shutting down');
  return new Promise((resolve) => {
    if (!logStream) return resolve();
    const stream = logStream;
    logStream = null;
    try { stream.end(resolve); } catch (err) { resolve(); }
  });
}

// 只保留「logger 自身資源」的收尾（關閉檔案串流）。
// uncaughtException / unhandledRejection 等 process 級 handler 屬於應用層決策，
// 定義在 server/index.js 進入點，不藏在這個工具模組裡。
process.on('exit', () => {
  if (logStream) {
    try { logStream.end(); } catch (err) { /* ignore */ }
  }
});

module.exports = {
  createLogger,
  shutdown,
  LOG_LEVELS,
  LOG_DIR,
};
