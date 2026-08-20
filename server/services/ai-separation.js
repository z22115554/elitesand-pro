'use strict';

/**
 * AI 人聲分離 sidecar 生命週期（docs/AI-SEPARATION-PLAN.md A1）。
 *
 * 管的是 supervisor 這一個常駐 process；每個 job 由 supervisor 自己再 spawn 一個
 * worker（見 ai/supervisor.py）。這裡只做：啟動/關閉 supervisor、NDJSON request/response
 * 配對、把 progress 事件轉成 EventEmitter。不含真正的模型（A3）、不含 runtime 下載（A2）。
 *
 * 鐵則 #3：spawn 一律帶 PYTHONUTF8，避免中文路徑/歌名在管線裡變亂碼。
 */
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { projectRoot } = require('../utils/app-paths');

const log = createLogger('AISeparation');

const SUPERVISOR_PATH = path.join(projectRoot, 'ai', 'supervisor.py');
const SUPERVISOR_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const REQUEST_TIMEOUT_MS = 15000; // hello/probe/cancel 這類短命令的逾時；separate 不套用（有自己的 progress 心跳）

class AISeparationSupervisor {
  constructor(pythonExecutable = process.env.ELITESAND_AI_PYTHON || 'python') {
    this.pythonExecutable = pythonExecutable;
    this.proc = null;
    this.emitter = new EventEmitter();
    this.pendingRequests = new Map(); // id -> { resolve, reject, timeoutHandle }
    this.stdoutBuffer = '';
  }

  isRunning() {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  start() {
    if (this.isRunning()) return;

    this.proc = spawn(this.pythonExecutable, [SUPERVISOR_PATH], {
      env: SUPERVISOR_ENV,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this._onStdoutData(chunk));

    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      log.warn('supervisor stderr', chunk.trim());
    });

    this.proc.on('exit', (code, signal) => {
      log.info(`supervisor exited (code=${code}, signal=${signal})`);
      this._rejectAllPending(new Error(`supervisor exited before responding (code=${code})`));
      this.proc = null;
    });

    this.proc.on('error', (err) => {
      log.error('failed to spawn supervisor', err);
      this._rejectAllPending(err);
      this.proc = null;
    });

    log.info(`supervisor started (pid=${this.proc.pid})`);
  }

  // 只收 logger 自身資源的收尾模式一致：這裡只管把子行程關掉，
  // 不在這支模組裡掛 process-level exit handler（那是 index.js/electron 的責任）。
  async stop() {
    if (!this.isRunning()) return;
    const proc = this.proc;
    this.proc = null;
    proc.stdin.end();
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        try { proc.kill(); } catch (err) { /* already gone */ }
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
      if (!line) continue;
      this._onLine(line);
    }
  }

  _onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      log.warn('non-JSON line from supervisor, ignoring', line);
      return;
    }

    if (msg.event === 'progress') {
      this.emitter.emit('progress', msg);
      return;
    }

    const pending = this.pendingRequests.get(msg.id);
    if ('result' in msg) {
      if (pending) {
        clearTimeout(pending.timeoutHandle);
        this.pendingRequests.delete(msg.id);
        pending.resolve(msg.result);
      }
      this.emitter.emit('result', msg);
      return;
    }

    if ('error' in msg) {
      if (pending) {
        clearTimeout(pending.timeoutHandle);
        this.pendingRequests.delete(msg.id);
        pending.reject(Object.assign(new Error(msg.error.message || msg.error.code), { code: msg.error.code, retryable: !!msg.error.retryable }));
      }
      this.emitter.emit('error', msg);
      return;
    }
  }

  _rejectAllPending(err) {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  _send(method, params, { id, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!this.isRunning()) this.start();
    const requestId = id || `${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request = { id: requestId, method, params };

    return new Promise((resolve, reject) => {
      const timeoutHandle = timeoutMs
        ? setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(Object.assign(new Error('supervisor request timed out'), { code: 'TIMEOUT', retryable: true }));
        }, timeoutMs)
        : null;
      this.pendingRequests.set(requestId, { resolve, reject, timeoutHandle });
      this.proc.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  hello() {
    return this._send('hello', {});
  }

  probe() {
    return this._send('probe', {});
  }

  // separate() 不設逾時——真正跑分離時間長，靠 'progress' 事件證明活著；
  // 呼叫端要自己訂閱 supervisor.emitter 的 'progress'/'result'/'error' 事件，
  // 用回傳的 jobId 篩出屬於自己這個 job 的訊息。
  separate(params) {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._send('separate', params, { id: jobId, timeoutMs: null }).catch(() => {
      /* 終局事件（result/error）一律走 'result'/'error' event，這裡吞掉是避免
         unhandled rejection——呼叫端該監聽 event，不是等這個 promise。 */
    });
    return jobId;
  }

  cancel(jobId) {
    return this._send('cancel', { jobId });
  }

  // A4 降級鏈：GPU_OOM 就整個 job 換一個全新 worker、強制 CPU 重跑一次
  // （CUDA_VISIBLE_DEVICES 只有在 torch 建立 CUDA context「之前」設定才有效，
  // 同一個 process 裡沒辦法半路把 GPU 拔掉，所以是全新 process 重試，不是同一個
  // worker 內部降級）。不縮小 chunk 換取低顯存——§7-3 已經盲聽證實那樣會傷音質，
  // 這裡只有「GPU（預設設定）→ CPU（預設設定）」兩級，沒有中間檔位。
  // 呼叫端只看得到一個 publicJobId，重試對它是透明的；'progress' 事件會多一個
  // stage:'fallback-cpu' 讓 UI 可以告訴使用者「正在切換到 CPU，這首歌會比較久」。
  separateWithFallback(params) {
    const publicJobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._attemptSeparate(publicJobId, params, { allowCpuFallback: true });
    return publicJobId;
  }

  _attemptSeparate(publicJobId, params, { allowCpuFallback }) {
    const attemptId = this.separate(params);

    const onProgress = (msg) => {
      if (msg.id !== attemptId) return;
      this.emitter.emit('progress', { ...msg, id: publicJobId });
    };
    const onResult = (msg) => {
      if (msg.id !== attemptId) return;
      cleanup();
      this.emitter.emit('result', { ...msg, id: publicJobId });
    };
    const onError = (msg) => {
      if (msg.id !== attemptId) return;
      cleanup();
      if (allowCpuFallback && msg.error?.code === 'GPU_OOM') {
        log.warn(`job ${publicJobId} hit GPU_OOM, retrying on CPU (forceCpu)`);
        this.emitter.emit('progress', { id: publicJobId, event: 'progress', stage: 'fallback-cpu', progress: 0 });
        this._attemptSeparate(publicJobId, { ...params, forceCpu: true }, { allowCpuFallback: false });
        return;
      }
      this.emitter.emit('error', { ...msg, id: publicJobId });
    };
    const cleanup = () => {
      this.emitter.off('progress', onProgress);
      this.emitter.off('result', onResult);
      this.emitter.off('error', onError);
    };

    this.emitter.on('progress', onProgress);
    this.emitter.on('result', onResult);
    this.emitter.on('error', onError);
  }
}

module.exports = { AISeparationSupervisor };
