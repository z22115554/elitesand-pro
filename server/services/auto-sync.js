'use strict';

/**
 * 自動對時：用「AI 分離出的人聲」算整首歌詞偏移。
 *
 * 做法：人聲的「有在唱」曲線（10ms 一格的能量）＋句首起音，分別跟歌詞時間軸做互相關，
 * 取最吻合的位移。不辨識歌詞內容、不需要任何模型，分離好的人聲檔就是唯一前提。
 *
 * 2026-10-27 實驗（測試用資料夾/人聲互相關對時實驗-20261027）：100 首調參集 63 首過門檻、
 * 0 首錯超過 0.3 秒、14 首歌詞錯誤全擋；留出 30 首 19 首過門檻，使用者盲測 19/19 準。
 * 門檻（peakZ ≥ 8 且 peakRatio ≥ 1.3）是在那批資料定下的，改之前要重跑同一套驗證。
 *
 * 偏移語義與顯示端相同：adjustedTime = audioTime + offset。
 */

const { spawn } = require('child_process');
const { getFfmpegPath } = require('./ffmpeg-provider');

const SAMPLE_RATE = 16000;
const HOP_SEC = 0.01;
const MAX_LAG_SEC = 90;
const MIN_PEAK_Z = 8;
const MIN_PEAK_RATIO = 1.3;
const MIN_LINES = 8;
const MAX_DURATION_SEC = 15 * 60;
const CREDIT_LINE = /作[詞词曲]|[編编]曲|[製制]作|監製|混音|lyrics\s*by|composed|arranged|^\s*(詞|曲)\s*[:：]/i;

function decodeMono(file, { ffmpeg = getFfmpegPath(), spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-t', String(MAX_DURATION_SEC),
      '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`DECODE_FAILED`));
      const buf = Buffer.concat(chunks);
      // Buffer 的 byteOffset 不保證 4-byte 對齊，複製一份再當 Float32Array 讀。
      const aligned = new Uint8Array(buf.length - (buf.length % 4));
      aligned.set(buf.subarray(0, aligned.length));
      resolve(new Float32Array(aligned.buffer));
    });
  });
}

function energyDb(samples) {
  const hop = Math.round(SAMPLE_RATE * HOP_SEC);
  const frames = Math.floor(samples.length / hop);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) sum += samples[i] * samples[i];
    out[f] = 10 * Math.log10(sum / hop + 1e-10);
  }
  return out;
}

// numpy.percentile 預設的線性內插
function percentile(values, p) {
  const sorted = Float64Array.from(values).sort();
  const pos = (sorted.length - 1) * p / 100;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function vocalActivity(db) {
  const threshold = Math.max(percentile(db, 95) - 25, percentile(db, 10) + 10);
  return db.map((v) => 1 / (1 + Math.exp(-(v - threshold) / 2.5)));
}

function onsetStrength(db) {
  const n = db.length;
  const smooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -2; k <= 2; k++) if (i + k >= 0 && i + k < n) sum += db[i + k];
    smooth[i] = sum / 5;
  }
  const out = new Float64Array(n);
  let max = 0;
  for (let i = 1; i < n; i++) {
    out[i] = Math.max(0, smooth[i] - smooth[i - 1]);
    if (out[i] > max) max = out[i];
  }
  for (let i = 0; i < n; i++) out[i] /= max + 1e-9;
  return out;
}

/** 歌詞時間軸 → 「應該在唱」曲線＋句首脈衝（±60ms 高斯模糊）。逐字資料有的話用字的區間。 */
function lyricTracks(lines, frames) {
  const activity = new Float64Array(frames);
  const starts = new Float64Array(frames);
  const used = (lines || []).filter((l) => l && Number.isFinite(l.time) && String(l.text || '').trim() && !CREDIT_LINE.test(l.text));
  used.forEach((line, i) => {
    const t0 = line.time / 1000;
    const next = i + 1 < used.length ? used[i + 1].time / 1000 : t0 + 6;
    const words = (line.words || []).filter((w) => w && w.duration);
    const spans = words.length >= 2
      ? words.map((w) => [t0 + w.start / 1000, t0 + (w.start + w.duration) / 1000])
      : [[t0, Math.min(line.duration ? t0 + line.duration / 1000 : Math.min(next, t0 + 6), next + 0.3)]];
    for (const [a, b] of spans) {
      const ia = Math.floor(a / HOP_SEC), ib = Math.floor(b / HOP_SEC);
      if (ia >= 0 && ia < frames) activity.fill(1, ia, Math.max(ia + 1, Math.min(ib, frames)));
    }
    const i0 = Math.floor(t0 / HOP_SEC);
    if (i0 >= 0 && i0 < frames) starts[i0] = 1;
  });
  const kernel = [];
  for (let k = -15; k <= 15; k++) kernel.push(Math.exp(-0.5 * ((k * HOP_SEC) / 0.06) ** 2));
  const blurred = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    if (!starts[i]) continue;
    for (let k = -15; k <= 15; k++) if (i + k >= 0 && i + k < frames) blurred[i + k] += kernel[k + 15];
  }
  return { activity, starts: blurred, lineCount: used.length, distinctTimes: new Set(used.map((l) => l.time)).size };
}

// 原地 radix-2 FFT（re/im 長度必須是 2 的冪）
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** 正規化互相關：vals[k] 對應 lag = k - maxLag，意思是 audio(t) ≈ lyric(t - lag)。 */
function crossCorrelate(audio, lyric, maxLag) {
  const center = (arr) => { let m = 0; for (const v of arr) m += v; m /= arr.length; return Float64Array.from(arr, (v) => v - m); };
  const a = center(audio), b = center(lyric);
  let n = 1;
  while (n < a.length + b.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(a); br.set(b);
  fft(ar, ai, false); fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    // a × conj(b)
    const r = ar[i] * br[i] + ai[i] * bi[i];
    const im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r; ai[i] = im;
  }
  fft(ar, ai, true);
  const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0)) + 1e-9;
  const vals = new Float64Array(2 * maxLag + 1);
  for (let k = -maxLag; k <= maxLag; k++) vals[k + maxLag] = ar[((k % n) + n) % n] / norm;
  return vals;
}

function zScore(vals) {
  let mean = 0;
  for (const v of vals) mean += v;
  mean /= vals.length;
  let variance = 0;
  for (const v of vals) variance += (v - mean) ** 2;
  const sd = Math.sqrt(variance / vals.length) + 1e-9;
  return Float64Array.from(vals, (v) => (v - mean) / sd);
}

/** 純運算：人聲樣本＋歌詞行 → 偏移與信心。拆出來方便測試，不碰檔案。 */
function estimateOffset(samples, lines) {
  const db = energyDb(samples);
  const frames = db.length;
  const lyric = lyricTracks(lines, frames);
  if (lyric.lineCount < MIN_LINES || lyric.distinctTimes < 2) {
    return { accepted: false, reason: 'NOT_ENOUGH_LYRICS', lineCount: lyric.lineCount };
  }
  const maxLag = Math.round(MAX_LAG_SEC / HOP_SEC);
  const activityCorr = crossCorrelate(vocalActivity(db), lyric.activity, maxLag);
  const onsetCorr = crossCorrelate(onsetStrength(db), lyric.starts, maxLag);
  const za = zScore(activityCorr), zo = zScore(onsetCorr);
  const combined = Float64Array.from(za, (v, i) => v + 0.5 * zo[i]);
  let best = 0;
  for (let i = 1; i < combined.length; i++) if (combined[i] > combined[best]) best = i;
  // 第二高峰：離最高峰 1.5 秒以外的最大值
  const exclude = Math.round(1.5 / HOP_SEC);
  let second = -Infinity;
  for (let i = 0; i < combined.length; i++) if (Math.abs(i - best) > exclude && combined[i] > second) second = combined[i];
  // 細修：最高峰 ±0.5 秒內取句首相關最大的位置
  const fine = Math.round(0.5 / HOP_SEC);
  let fineIdx = best;
  for (let i = Math.max(0, best - fine); i <= Math.min(combined.length - 1, best + fine); i++) {
    if (onsetCorr[i] > onsetCorr[fineIdx]) fineIdx = i;
  }
  const peakZ = combined[best];
  const peakRatio = peakZ / Math.max(second, 1e-6);
  const offsetMs = Math.round(-(fineIdx - maxLag) * HOP_SEC * 1000);
  const accepted = peakZ >= MIN_PEAK_Z && peakRatio >= MIN_PEAK_RATIO;
  return { accepted, reason: accepted ? null : 'LOW_CONFIDENCE', offsetMs, peakZ, peakRatio, lineCount: lyric.lineCount };
}

async function analyzeVocals(vocalsPath, lines, options) {
  const samples = await decodeMono(vocalsPath, options);
  if (samples.length < SAMPLE_RATE * 10) return { accepted: false, reason: 'AUDIO_TOO_SHORT' };
  return estimateOffset(samples, lines);
}

module.exports = { analyzeVocals, estimateOffset, decodeMono, MIN_PEAK_Z, MIN_PEAK_RATIO, SAMPLE_RATE };
