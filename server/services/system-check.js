'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { APP_VERSION } = require('../utils/app-version');
const ytdlpCompatibility = require('./ytdlp-compatibility');
const ffmpegProvider = require('./ffmpeg-provider');
const usageTelemetry = require('./usage-telemetry');
const { getYtdlpCommand } = require('../utils/ytdlp-command');

const execFileAsync = promisify(execFile);
const TOOL_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const CACHE_MS = 60 * 1000;
const YTDLP_COMMAND = getYtdlpCommand();
let cache = null;

async function toolStatus(command, args, options = {}) {
  const run = options.execFileImpl || execFileAsync;
  try {
    const { stdout, stderr } = await run(command, args, {
      timeout: 2500,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      env: TOOL_ENV,
    });
    const firstLine = String(stdout || stderr || '').split(/\r?\n/).find(Boolean) || '';
    return { available: true, version: firstLine.slice(0, 160) };
  } catch (_) {
    return { available: false, version: null };
  }
}

// Deliberately contains public product/tool state only: callers may show it in
// onboarding or include it in a manually requested diagnostic bundle.
async function getSystemCheck(options = {}) {
  const now = options.now || (() => Date.now());
  const compatibility = options.compatibility || ytdlpCompatibility;
  const nowMs = now();
  const cachedDownloadedPairStillExists = !cache
    || cache.ffmpegSource !== 'downloaded'
    || !cache.payload?.ffmpeg?.available
    || ffmpegProvider.hasDownloadedPair();
  if (!options.force && cache && nowMs - cache.checkedAt < CACHE_MS && cachedDownloadedPairStillExists) {
    return { ...cache.payload, ytdlpCompatibility: compatibility.getStatus() };
  }
  if (!cachedDownloadedPairStillExists) cache = null;

  const resolvedFfmpeg = ffmpegProvider.resolveFfmpegPaths();
  const [ytdlp, ffmpeg] = await Promise.all([
    toolStatus(YTDLP_COMMAND, ['--version'], options),
    toolStatus(resolvedFfmpeg?.ffmpeg || 'ffmpeg', ['-version'], options),
  ]);
  const payload = {
    appVersion: APP_VERSION,
    updateRepo: 'z22115554/elitesand-pro',
    ytdlp,
    ytdlpCompatibility: compatibility.getStatus(),
    ffmpeg: { ...ffmpeg, downloadable: !ffmpeg.available },
  };
  // 只在真的重新探測時記錄（跳過快取命中），避免 60 秒內同一個結果被記很多次；
  // 布林語意本身已經冪等，這裡只是不必要地少做幾次函式呼叫。
  usageTelemetry.recordDependency('ytdlp', ytdlp.available);
  usageTelemetry.recordDependency('ffmpeg', ffmpeg.available);
  cache = {
    checkedAt: nowMs,
    payload,
    // 只記來源類型，不保存/回傳本機路徑。若下載版 pair 在程式執行期間被刪除，
    // 下一次讀 cache 就能用便宜的 existsSync 立即讓 60 秒快取失效。
    ffmpegSource: resolvedFfmpeg?.source || null,
  };
  return payload;
}

function clearCache() { cache = null; }

module.exports = { getSystemCheck, toolStatus, clearCache, _resetForTests: clearCache };
