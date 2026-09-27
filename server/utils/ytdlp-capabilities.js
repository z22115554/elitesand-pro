'use strict';

/**
 * yt-dlp 參數能力偵測。
 *
 * `--js-runtimes` 與 `--remote-components` 是 yt-dlp 2025.11 之後才有的參數；舊版收到
 * 未知參數會整個呼叫失敗，連最基本的匿名匯入都無法進行。這裡不寫死版本號，而是問
 * yt-dlp 自己的 `--help` 有沒有這兩個參數，結果依執行檔 mtime 快取（nightly/手動更新
 * 換了執行檔就會重新偵測）。
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getYtdlpCommand } = require('./ytdlp-command');

const execFileAsync = promisify(execFile);
const YTDLP_COMMAND = getYtdlpCommand();
const YTDLP_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const UNSUPPORTED = Object.freeze({ jsRuntimes: false, remoteComponents: false });
const REMOTE_EJS_ARGS = Object.freeze(['--remote-components', 'ejs:github']);

let caps = UNSUPPORTED;
let capsKey = null;
let pending = null;

function resolveNodeRuntimeArg(env = process.env) {
  const explicit = String(env.ELITESAND_YTDLP_NODE_PATH || '').trim();
  if (explicit && path.isAbsolute(explicit) && fs.existsSync(explicit)) return `node:${explicit}`;
  // portable / source-tree 啟動本身就是 Node；直接給 yt-dlp 絕對路徑，不依賴 PATH。
  if (process.release?.name === 'node' && path.isAbsolute(process.execPath) && fs.existsSync(process.execPath)) {
    return `node:${process.execPath}`;
  }
  return 'node';
}

const JS_RUNTIME_ARGS = Object.freeze(['--js-runtimes', resolveNodeRuntimeArg()]);

function binaryKey() {
  if (!path.isAbsolute(YTDLP_COMMAND)) return 'path';
  try { return `mtime:${fs.statSync(YTDLP_COMMAND).mtimeMs}`; } catch (_) { return null; }
}

function parseHelp(stdout) {
  const text = String(stdout || '');
  return { jsRuntimes: text.includes('--js-runtimes'), remoteComponents: text.includes('--remote-components') };
}

/**
 * 確保已偵測目前 yt-dlp 的能力。`run` 只給測試注入；注入時結果不寫入快取。
 * 偵測失敗（找不到執行檔等）一律當作不支援，不快取，下次再試。
 */
async function ensure({ run } = {}) {
  if (run) {
    try {
      const { stdout } = await run(YTDLP_COMMAND, ['--help'], { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: YTDLP_ENV });
      return parseHelp(stdout);
    } catch (_) {
      return UNSUPPORTED;
    }
  }
  const key = binaryKey();
  if (key && capsKey === key) return caps;
  if (!pending) {
    pending = (async () => {
      try {
        const { stdout } = await execFileAsync(YTDLP_COMMAND, ['--help'], {
          encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: YTDLP_ENV,
        });
        caps = parseHelp(stdout);
        capsKey = key;
      } catch (_) {
        caps = UNSUPPORTED;
        capsKey = null;
      } finally {
        pending = null;
      }
      return caps;
    })();
  }
  return pending;
}

function current() { return caps; }
function invalidate() { capsKey = null; }

function jsRuntimeArgs(c = caps) { return c.jsRuntimes ? [...JS_RUNTIME_ARGS] : []; }
function commonArgs(c = caps) { return ['--no-config', ...jsRuntimeArgs(c)]; }
function remoteEjsArgs(c = caps) { return c.remoteComponents ? [...REMOTE_EJS_ARGS] : []; }

/** 舊版 yt-dlp 不認得 --remote-components：把這組參數拿掉，其餘原樣保留。 */
function stripUnsupported(args, c = caps) {
  const list = Array.isArray(args) ? args : [];
  if (c.remoteComponents) return [...list];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '--remote-components') { i += 1; continue; }
    out.push(list[i]);
  }
  return out;
}

function resetForTests(next = null) {
  caps = next || UNSUPPORTED;
  capsKey = next ? binaryKey() : null;
  pending = null;
}

module.exports = {
  REMOTE_EJS_ARGS,
  resolveNodeRuntimeArg,
  ensure,
  current,
  invalidate,
  jsRuntimeArgs,
  commonArgs,
  remoteEjsArgs,
  stripUnsupported,
  _parseHelpForTest: parseHelp,
  _resetForTests: resetForTests,
};
