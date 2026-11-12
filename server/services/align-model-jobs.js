/**
 * 精準對時 worker（ai/align_worker.py）的生命週期。
 *
 * - 有工作才啟動；做完閒置 IDLE_MS 就整個關掉。模型載入時約佔 1.1GB 顯示卡記憶體＋420MB
 *   記憶體，只釋放模型的話程序仍留著約 320MB，所以要關程序才乾淨（2026-11-12 實測）。
 *   重新載入只要約 4 秒，比常駐的代價小。
 * - 一次只送一個請求（佇列串起來），回應照 id 對回去。
 * - 音訊由這邊寫成暫存的 16kHz 單聲道 float32 檔交給 worker：伺服器已經為自動對時解碼過，
 *   不必讓 worker 再跑一次 ffmpeg（鐵則 12：ffmpeg 一律走共用佇列）。
 * - 任何失敗都回 null，呼叫端照原本（不用模型）的流程走，不讓這個選裝元件拖垮自動對時。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const provider = require('./align-runtime-provider');

const log = createLogger('AlignModel');

const IDLE_MS = 60 * 1000;
// 顯示卡驅動快取被清掉（更新驅動後）的第一次要重新編譯，約 1 分鐘，所以逾時放寬
const REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const TMP_DIR = path.join(os.tmpdir(), 'elitesand-align');

let proc = null;
let procFiles = null;
let buffer = '';
let nextId = 1;
const pending = new Map();
let chain = Promise.resolve();
let idleTimer = null;
let pcmFile = null;
let pcmKey = null;

function clearIdle() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

function stop(reason = 'idle') {
  clearIdle();
  if (proc) {
    log.info(`精準對時 worker 關閉（${reason}）`);
    try { proc.stdin.end(); } catch (_) { /* 已關 */ }
    const p = proc;
    setTimeout(() => { try { p.kill(); } catch (_) { /* 已結束 */ } }, 3000).unref?.();
  }
  proc = null;
  procFiles = null;
  buffer = '';
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('WORKER_STOPPED')); }
  pending.clear();
  if (pcmFile) { try { fs.unlinkSync(pcmFile); } catch (_) { /* 不存在 */ } }
  pcmFile = null;
  pcmKey = null;
}

function armIdle() {
  clearIdle();
  idleTimer = setTimeout(() => stop('idle'), IDLE_MS);
  idleTimer.unref?.();
}

function ensureProcess(files) {
  if (proc && proc.exitCode === null && procFiles && procFiles.model === files.model) return;
  if (proc) stop('restart');
  const script = provider.workerScript();
  if (!fs.existsSync(script)) throw new Error(`找不到 ${script}`);
  const child = spawn(provider.PYTHON_EXE, [script], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...provider.workerEnv(files) },
  });
  proc = child;
  procFiles = files;
  buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { log.warn(`worker 輸出不是 JSON：${line.slice(0, 200)}`); continue; }
      const entry = pending.get(msg.id);
      if (!entry) continue;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg);
      else entry.reject(new Error(msg.error || 'WORKER_ERROR'));
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { const text = chunk.trim(); if (text) log.info(text.slice(0, 500)); });
  child.on('exit', (code) => {
    if (proc !== child) return;
    log.warn(`精準對時 worker 結束（exit ${code}）`);
    proc = null;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(`WORKER_EXIT_${code}`)); }
    pending.clear();
  });
  child.on('error', (err) => log.warn(`精準對時 worker 啟動失敗：${err.message}`));
}

function send(request) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('WORKER_TIMEOUT'));
      stop('timeout');
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      proc.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(err);
    }
  });
}

function writePcm(samples, key) {
  if (pcmFile && pcmKey === key && fs.existsSync(pcmFile)) return pcmFile;
  fs.mkdirSync(TMP_DIR, { recursive: true });
  if (pcmFile) { try { fs.unlinkSync(pcmFile); } catch (_) { /* 不存在 */ } }
  const file = path.join(TMP_DIR, `${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}.f32`);
  fs.writeFileSync(file, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  pcmFile = file;
  pcmKey = key;
  return file;
}

// 串成一條佇列：同一時間只有一個請求，前一個失敗不影響下一個。
function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function request(op, payload, samples, cacheKey) {
  const files = provider.getInstalled();
  if (!files) return null;
  return enqueue(async () => {
    clearIdle();
    try {
      ensureProcess(files);
      const pcm = writePcm(samples, cacheKey);
      return await send({ op, pcm, cacheKey, ...payload });
    } catch (err) {
      log.warn(`精準對時 ${op} 失敗：${err.message}`);
      return null;
    } finally {
      if (proc) armIdle();
    }
  });
}

/** 每份歌詞各自的整首偏移與信心。回傳 { key: { offsetMs, peakZ, peakRatio, units } } 或 null。 */
async function analyzeGlobal(samples, cacheKey, versions) {
  const res = await request('global', { versions }, samples, cacheKey);
  return res ? res.results : null;
}

/** 以整首偏移為中心逐句強制對齊。回傳 { onsets: {line: ms}, conf: {line: x} } 或 null。 */
async function alignLines(samples, cacheKey, lines, offsetMs, bandSec = 8) {
  const res = await request('lines', { lines, offsetMs, bandSec }, samples, cacheKey);
  return res ? { onsets: res.onsets || {}, conf: res.conf || {} } : null;
}

function isRunning() {
  return !!proc;
}

module.exports = { analyzeGlobal, alignLines, stop, isRunning, IDLE_MS };
