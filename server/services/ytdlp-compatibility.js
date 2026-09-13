'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { createLogger } = require('../utils/logger');

const execFileAsync = promisify(execFile);
const log = createLogger('YtdlpCompatibility');
const YTDLP_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };

// A public, short video used only to read metadata. It is never downloaded.
// The environment override lets a future maintenance release swap the probe
// without changing the product flow if YouTube retires this particular video.
const PROBE_VIDEO_ID = 'dQw4w9WgXcQ';
const DEFAULT_PROBE_URL = `https://www.youtube.com/watch?v=${PROBE_VIDEO_ID}`;
const PROBE_URL = process.env.ELITESAND_YTDLP_PROBE_URL || DEFAULT_PROBE_URL;
// The bundled probe verifies the exact public video's metadata. A maintenance
// override may intentionally point at another healthy public video, so only
// require a non-empty id in that case.
const EXPECTED_PROBE_VIDEO_ID = PROBE_URL === DEFAULT_PROBE_URL ? PROBE_VIDEO_ID : null;
const PROBE_ARGS = ['--skip-download', '--no-playlist', '--no-warnings', '--socket-timeout', '8', '--print', '%(id)s', PROBE_URL];

let status = { state: 'not-run', ok: null, checkedAt: 0, durationMs: 0, message: '尚未驗證 YouTube 相容性' };
let inFlight = null;

function getStatus() {
  return { ...status };
}

function failureMessage(error) {
  if (error?.code === 'ENOENT') return '找不到 yt-dlp，無法驗證 YouTube 相容性。';
  if (/timeout|timed out|ETIMEDOUT/i.test(String(error?.message || ''))) return '驗證 YouTube 相容性逾時；請檢查網路後重試。';
  return 'yt-dlp 目前無法讀取 YouTube；請先檢查或更新 yt-dlp，再重試。';
}

async function probe(options = {}) {
  if (inFlight) return inFlight;
  const run = options.execFileImpl || execFileAsync;
  const now = options.now || (() => Date.now());
  const startedAt = now();
  status = { state: 'running', ok: null, checkedAt: startedAt, durationMs: 0, message: '正在驗證 YouTube 相容性（不會下載音檔）' };

  inFlight = (async () => {
    try {
      const { stdout } = await run('yt-dlp', PROBE_ARGS, {
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 64 * 1024,
        env: YTDLP_ENV,
      });
      const ids = String(stdout || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (!ids.length || (EXPECTED_PROBE_VIDEO_ID && !ids.includes(EXPECTED_PROBE_VIDEO_ID))) {
        throw new Error('probe metadata did not contain a usable video id');
      }
      status = {
        state: 'ok', ok: true, checkedAt: now(), durationMs: Math.max(0, now() - startedAt),
        message: '已確認 yt-dlp 可以讀取 YouTube（未下載任何音檔）。',
      };
    } catch (error) {
      status = {
        state: 'failed', ok: false, checkedAt: now(), durationMs: Math.max(0, now() - startedAt),
        message: failureMessage(error),
      };
      log.warn(`YouTube 相容性驗證失敗：${status.message}`);
    } finally {
      inFlight = null;
    }
    return getStatus();
  })();
  return inFlight;
}

function scheduleProbe(delayMs = 250) {
  const timer = setTimeout(() => { probe().catch(() => {}); }, Math.max(0, Number(delayMs) || 0));
  timer.unref?.();
  return timer;
}

function resetForTests() {
  status = { state: 'not-run', ok: null, checkedAt: 0, durationMs: 0, message: '尚未驗證 YouTube 相容性' };
  inFlight = null;
}

module.exports = {
  PROBE_VIDEO_ID,
  PROBE_URL,
  EXPECTED_PROBE_VIDEO_ID,
  PROBE_ARGS,
  getStatus,
  probe,
  scheduleProbe,
  _resetForTests: resetForTests,
};
