/**
 * 波形峰值（直播頁準備區的「對時間」用，docs/UIUX-REDESIGN.md §5.1）
 *
 * - 用內建 ffmpeg 把音檔解成單聲道 8 kHz s16le，每 1/RATE 秒取一個絕對值最大值，正規化到 0–255。
 * - 快取在 dataDir/waveforms/，檔名是來源路徑的雜湊；內容記錄來源的 size＋mtime，檔案換了就重算。
 *   不寫進 downloads：那裡的檔名會被媒體庫與 /audio 路由當成音檔看待，放 sidecar 容易變成孤兒檔。
 * - 一律排進 AudioProcessor 的 ffmpeg 佇列（鐵則 12：ffmpeg 不可併發），同一個檔案同時只算一次。
 * - 純分析、不改動音檔；任何失敗都只回 null，不影響播放或匯入。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegProvider = require('./ffmpeg-provider');
const { createLogger } = require('../utils/logger');

const log = createLogger('Waveform');

const RATE = 20;              // 每秒幾個峰值：4 分鐘的歌約 4800 點，JSON 約 15 KB
const SAMPLE_RATE = 8000;     // 波形只看大輪廓，8 kHz 足夠且解碼快
const FORMAT_VERSION = 1;
const MAX_SECONDS = 20 * 60;  // 超過 20 分鐘的檔案不算（不是歌）
const TIMEOUT_MS = 60 * 1000;

const inflight = new Map();   // sourcePath -> Promise

function cachePathFor(cacheDir, sourcePath) {
  const key = crypto.createHash('sha1').update(path.resolve(sourcePath)).digest('hex');
  return path.join(cacheDir, `${key}.json`);
}

function sourceStamp(sourcePath) {
  const st = fs.statSync(sourcePath);
  return { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
}

function readCache(cacheFile, stamp) {
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (data && data.v === FORMAT_VERSION && data.size === stamp.size && data.mtimeMs === stamp.mtimeMs
      && Array.isArray(data.peaks)) return data;
  } catch (_) { /* 沒有快取或壞掉 → 重算 */ }
  return null;
}

/** 從 s16le PCM 串流算峰值；抽成純函式方便測試。 */
function createPeakAccumulator(samplesPerPeak) {
  const peaks = [];
  let current = 0;
  let count = 0;
  let carry = null; // 上一個 chunk 剩下的奇數位元組
  return {
    push(chunk) {
      let buf = chunk;
      if (carry) { buf = Buffer.concat([carry, chunk]); carry = null; }
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > current) current = v;
        if (++count >= samplesPerPeak) { peaks.push(current); current = 0; count = 0; }
      }
      if (usable < buf.length) carry = buf.subarray(usable);
    },
    finish() {
      if (count > 0) peaks.push(current);
      // 正規化到 0–255：以整首最大值為滿格，安靜的歌也看得清楚起伏
      const max = peaks.reduce((m, v) => (v > m ? v : m), 0) || 1;
      return peaks.map((v) => Math.round((v / max) * 255));
    },
  };
}

function decodePeaks(sourcePath) {
  return new Promise((resolve) => {
    const acc = createPeakAccumulator(Math.round(SAMPLE_RATE / RATE));
    let total = 0;
    const limit = MAX_SECONDS * SAMPLE_RATE * 2;
    const child = spawn(ffmpegProvider.getFfmpegPath(),
      ['-hide_banner', '-nostats', '-i', sourcePath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'],
      { env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    let aborted = false;
    child.stdout.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > limit) { aborted = true; child.kill(); return; }
      acc.push(chunk);
    });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (aborted || code !== 0) { resolve(null); return; }
      const peaks = acc.finish();
      resolve(peaks.length ? peaks : null);
    });
  });
}

/**
 * 取得某個音檔的波形。runQueued 由呼叫端注入（AudioProcessor.runFfmpegQueued），
 * 讓這支服務不用自己維護第二把 ffmpeg 鎖。
 */
async function getPeaks(sourcePath, { cacheDir, runQueued }) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  const stamp = sourceStamp(sourcePath);
  const cacheFile = cachePathFor(cacheDir, sourcePath);
  const cached = readCache(cacheFile, stamp);
  if (cached) return cached;

  if (inflight.has(sourcePath)) return inflight.get(sourcePath);
  const job = (async () => {
    const started = Date.now();
    const peaks = await runQueued(() => decodePeaks(sourcePath));
    if (!peaks) { log.warn(`波形分析失敗（不影響播放）: ${path.basename(sourcePath)}`); return null; }
    const data = { v: FORMAT_VERSION, rate: RATE, duration: peaks.length / RATE, ...stamp, peaks };
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(data));
    } catch (err) {
      log.warn(`波形快取寫入失敗: ${err.message}`);
    }
    log.perf('waveform-peaks', Date.now() - started, { points: peaks.length });
    return data;
  })().finally(() => inflight.delete(sourcePath));
  inflight.set(sourcePath, job);
  return job;
}

module.exports = { getPeaks, createPeakAccumulator, cachePathFor, RATE };
