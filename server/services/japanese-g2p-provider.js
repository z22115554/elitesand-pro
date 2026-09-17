'use strict';

/**
 * Japanese G2P sidecar 生命週期（docs/JAPANESE-XIEYIN-V2-PLAN.md Phase 2）。
 *
 * 跟 ai-separation.js 管 supervisor.py 是同一套精神（NDJSON、常駐 process、
 * 逐行配對 id），差異在於這裡的工作是毫秒級同步查表，不需要 progress 事件、
 * 不需要背景 worker，一個 sidecar process 從頭讀到尾就夠。
 *
 * 鐵則 #3：spawn 一律帶 PYTHONUTF8，避免中文/日文在管線裡變亂碼。
 *
 * Installer 會隨附獨立的 Python embeddable + Haqumei wheel（內嵌辭典），並由
 * Electron shell 以 ELITESAND_G2P_PYTHON 指定它；這支 provider 仍只負責跟
 * sidecar 講話。開發／Node 模式沒有這份發行 runtime 時，才回到環境變數或
 * PATH 上的 `python`，方便離線單元測試與本機開發。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const { projectRoot } = require('../utils/app-paths');

const log = createLogger('JapaneseG2P');

const REQUEST_TIMEOUT_MS = 5000;
const READY_TIMEOUT_MS = 10000;

function resolveScriptDir() {
  const override = process.env.ELITESAND_AI_SCRIPT_DIR;
  if (override && fs.existsSync(path.join(override, 'haqumei_sidecar.py'))) return override;
  return path.join(projectRoot, 'ai');
}

function sidecarEnv() {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}

class JapaneseG2PProvider {
  constructor(pythonExecutable = process.env.ELITESAND_G2P_PYTHON || 'python') {
    this.pythonExecutable = pythonExecutable;
    this.proc = null;
    this.stdoutBuffer = '';
    this.pendingRequests = new Map(); // id -> { resolve, reject, timeoutHandle }
    this.readyPromise = null;
    this.nextRequestId = 1;
  }

  isRunning() {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  /**
   * 啟動 sidecar 並等它送出第一行 {ready:true}。sidecar import haqumei 失敗
   * （沒裝、辭典缺失）會在這裡就抛出，呼叫端據此決定要不要 fallback 回舊版，
   * 而不是等第一筆真實請求逾時才發現。
   */
  async start() {
    if (this.isRunning()) return this.readyPromise;
    if (this.readyPromise) return this.readyPromise;

    const scriptPath = path.join(resolveScriptDir(), 'haqumei_sidecar.py');
    if (!fs.existsSync(scriptPath)) {
      throw Object.assign(new Error(`Japanese G2P sidecar 不存在：${scriptPath}`), { code: 'ENGINE_UNAVAILABLE' });
    }

    this.proc = spawn(this.pythonExecutable, [scriptPath], {
      env: sidecarEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this._onStdoutData(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => log.warn('sidecar stderr', chunk.trim()));

    this.proc.on('exit', (code, signal) => {
      log.info(`G2P sidecar exited (code=${code}, signal=${signal})`);
      this._rejectAllPending(Object.assign(new Error(`G2P sidecar exited before responding (code=${code})`), { code: 'ENGINE_CRASHED' }));
      this._failReadyIfPending(Object.assign(new Error(`G2P sidecar exited before ready (code=${code})`), { code: 'ENGINE_CRASHED' }));
      this.proc = null;
      this.readyPromise = null;
    });
    this.proc.on('error', (err) => {
      log.error('failed to spawn G2P sidecar', err);
      this._rejectAllPending(err);
      this._failReadyIfPending(Object.assign(err, { code: err.code || 'ENGINE_UNAVAILABLE' }));
      this.proc = null;
      this.readyPromise = null;
    });

    this.readyPromise = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
      this._readyTimeoutHandle = setTimeout(() => {
        reject(Object.assign(new Error('G2P sidecar 啟動逾時（沒有收到 ready）'), { code: 'ENGINE_TIMEOUT' }));
      }, READY_TIMEOUT_MS);
    });
    return this.readyPromise;
  }

  async stop() {
    if (!this.isRunning()) return;
    const proc = this.proc;
    this.proc = null;
    this.readyPromise = null;
    proc.stdin.end();
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        try { proc.kill(); } catch (_) { /* already gone */ }
        resolve();
      }, 3000);
      proc.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }

  _onStdoutData(chunk) {
    this.stdoutBuffer += chunk;
    let newlineIndex;
    // eslint-disable-next-line no-cond-assign
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this._onLine(line);
    }
  }

  _onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_) {
      log.warn('non-JSON line from G2P sidecar, ignoring', line);
      return;
    }

    if ('ready' in msg && !('id' in msg)) {
      clearTimeout(this._readyTimeoutHandle);
      if (msg.ready) this._resolveReady?.(msg);
      else this._failReadyIfPending(Object.assign(new Error(msg.error || 'G2P sidecar 回報 not ready'), { code: 'ENGINE_UNAVAILABLE' }));
      this._resolveReady = null;
      this._rejectReady = null;
      return;
    }

    const pending = this.pendingRequests.get(msg.id);
    if (!pending) {
      log.warn('G2P sidecar 回應沒有對應的 pending request', msg.id);
      return;
    }
    clearTimeout(pending.timeoutHandle);
    this.pendingRequests.delete(msg.id);
    if (msg.error) pending.reject(Object.assign(new Error(msg.error), { code: 'ENGINE_ERROR' }));
    else pending.resolve(msg.results);
  }

  /**
   * 讓「還在等 ready」的那個 promise 立刻失敗，不要放著等 READY_TIMEOUT_MS
   * 過期才失敗。少了這一步的話，python.exe 完全不存在（spawn ENOENT）或
   * process 在送出任何一行輸出之前就先死掉這兩種情況，start() 會平白卡
   * 10 秒才失敗——而且因為 provider 沒有記住「這次失敗了」，下一首歌再呼叫
   * g2pBatch() 又會重新 spawn、重新卡 10 秒，同一個壞掉的 python 路徑會讓
   * 每一首日文歌都多等 10 秒才 fallback 回舊版諧音（2026-09-18 使用者實測
   * 回報：接上正式產線後歌詞完全沒有諧音，追下來就是這裡——不是「fallback
   * 沒接上」，是「fallback要等 10 秒，而呼叫端等不到就已經把結果丟了」）。
   */
  _failReadyIfPending(err) {
    if (!this._rejectReady) return;
    clearTimeout(this._readyTimeoutHandle);
    this._rejectReady(err);
    this._resolveReady = null;
    this._rejectReady = null;
  }

  _rejectAllPending(err) {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  /**
   * 整批送一首歌（或一段）的所有句子，一次 IPC 拿回全部結果——鐵則等級的
   * 原則：不可每一字都 IPC 一次，優先整句或整首批次處理。
   *
   * `wordLengths`（可省略）：跟 `texts` 等長，每一項是該句 KRC 逐字模式每個
   * word 的字元數陣列，或 null 表示這句不需要逐字拆分。有給的話，回傳的
   * 對應項目會多一個 `words: string[][]`——整句只送一次給 Haqumei、依字元數
   * 貪婪切回逐字（見 ai/haqumei_sidecar.py 的 `_bucket_by_krc_word_lengths`
   * docstring），保留整句上下文（は／へ／を 這類助詞讀音），不是每個字各自
   * 獨立呼叫。
   *
   * @param {string[]} texts
   * @param {{timeoutMs?: number, wordLengths?: Array<number[]|null>}} [opts]
   * @returns {Promise<Array<{phonemes:string[], kana:string, words?:string[][]}>>}
   */
  async g2pBatch(texts, { timeoutMs = REQUEST_TIMEOUT_MS, wordLengths } = {}) {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    if (!this.isRunning()) await this.start();
    await this.readyPromise;

    const id = String(this.nextRequestId++);
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(Object.assign(new Error('G2P sidecar 請求逾時'), { code: 'ENGINE_TIMEOUT' }));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timeoutHandle });
      const request = { id, texts };
      if (Array.isArray(wordLengths)) request.wordLengths = wordLengths;
      this.proc.stdin.write(JSON.stringify(request) + '\n');
    });
  }
}

module.exports = { JapaneseG2PProvider, resolveScriptDir };
