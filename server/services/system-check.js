'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { APP_VERSION } = require('../utils/app-version');
const ytdlpCompatibility = require('./ytdlp-compatibility');

const execFileAsync = promisify(execFile);
const TOOL_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const CACHE_MS = 60 * 1000;
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
  if (!options.force && cache && nowMs - cache.checkedAt < CACHE_MS) {
    return { ...cache.payload, ytdlpCompatibility: compatibility.getStatus() };
  }
  const [ytdlp, ffmpeg] = await Promise.all([
    toolStatus('yt-dlp', ['--version'], options),
    toolStatus('ffmpeg', ['-version'], options),
  ]);
  const payload = {
    appVersion: APP_VERSION,
    updateRepo: 'z22115554/elitesand-pro',
    ytdlp,
    ytdlpCompatibility: compatibility.getStatus(),
    ffmpeg,
  };
  cache = { checkedAt: nowMs, payload };
  return payload;
}

function resetForTests() { cache = null; }

module.exports = { getSystemCheck, toolStatus, _resetForTests: resetForTests };
