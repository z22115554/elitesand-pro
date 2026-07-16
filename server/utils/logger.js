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

function checkLogRotation(logFile) {
  try {
    const stats = fs.statSync(logFile);
    if (stats.size > MAX_LOG_SIZE) {
      const backupFile = logFile.replace('.log', `.${Date.now()}.log`);
      fs.renameSync(logFile, backupFile);
      console.log(`[Logger] rotated log: ${path.basename(backupFile)}`);
    }
  } catch (err) {
    // Best-effort only.
  }

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
    stream.write(`\n${'='.repeat(60)}\n`);
    stream.write(`  Elitesand Pro log - ${today}\n`);
    stream.write(`  Started: ${getTimestamp()}\n`);
    stream.write(`${'='.repeat(60)}\n\n`);
    checkLogRotation(logFile);
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
  consoleFn(formatted);

  const stream = getLogStream();
  if (stream && stream.writable) {
    try {
      stream.write(formatted + '\n');
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

function setLogLevel(level) {
  const upper = (level || '').toUpperCase();
  if (LOG_LEVELS[upper] !== undefined) {
    currentLogLevel = LOG_LEVELS[upper];
    writeLog(LOG_LEVELS.INFO, 'INFO', 'Logger', `Log level set to ${upper}`);
  }
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
  setLogLevel,
  shutdown,
  LOG_LEVELS,
  LOG_DIR,
};
