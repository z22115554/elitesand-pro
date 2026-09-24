'use strict';

/**
 * 歌曲段落分析（SongFormer）sidecar 生命週期。
 *
 * 跟 ai-separation.js（AI 人聲分離）幾乎是同一份程式碼的獨立複本，不是共用一個基底
 * 類別——這是本專案既有的慣例（japanese-g2p-provider.js 也是各自獨立一份 NDJSON
 * 協定實作，不共用），每個 ML 功能各自的 supervisor 生命週期／協定細節分開維護，
 * 不因為長得像就耦合在一起。
 *
 * V1 只有 CUDA 一條路：section-analysis-jobs.js 探測不到 CUDA 就直接回錯誤，不會
 * 呼叫到這支 supervisor 的 analyze()。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const { projectRoot } = require('../utils/app-paths');

const log = createLogger('SectionAnalysis');

/**
 * sidecar 腳本（section_supervisor.py／section_worker.py）跟 AI 分離共用同一個
 * ai/ 目錄與同一套外部化機制（resolveAiScriptDir 見 ai-separation.js 的說明：
 * 這兩支 .py 不可以只存在於 app.asar 裡，外部 python.exe 讀不到）。這裡不重複定義
 * 一份新的環境變數，直接沿用 ELITESAND_AI_SCRIPT_DIR。
 */
function resolveSectionScriptDir() {
  const override = process.env.ELITESAND_AI_SCRIPT_DIR;
  if (override && fs.existsSync(path.join(override, 'section_supervisor.py'))) return override;
  return path.join(projectRoot, 'ai');
}

function supervisorEnv(sectionRuntimeProvider) {
  // HF_HOME/TORCH_HOME 指到 runtime provider 管理的快取目錄，讓 MuQ/MusicFM 的
  // huggingface_hub / torch.hub 下載落在我們自己控制、可清除的位置，不是使用者
  // 系統預設的 ~/.cache（那個位置在打包版裡不可控，也不會被 uninstall 清掉）。
  return {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    HF_HOME: sectionRuntimeProvider.HF_HOME,
    TORCH_HOME: sectionRuntimeProvider.TORCH_HOME,
    HF_HUB_DISABLE_TELEMETRY: '1',
  };
}
const REQUEST_TIMEOUT_MS = 15000; // hello/cancel 這類短命令；analyze 不套用（逾時看門狗在 section-analysis-jobs.js）
// probe 是第一個會真的 spawn Python 並 import torch＋初始化 CUDA 的請求。冷啟動（開機後第一次、
// 機械硬碟、防毒掃描 torch 的上千個 DLL）實測可以超過 15 秒，套短逾時會把「有 N 卡但還在載入」
// 誤報成「偵測不到 CUDA」。
const PROBE_TIMEOUT_MS = 120000;

class SectionAnalysisSupervisor {
  constructor(pythonExecutable, runtimeProvider) {
    this.pythonExecutable = pythonExecutable;
    this.runtimeProvider = runtimeProvider;
    this.proc = null;
    this.emitter = new EventEmitter();
    this.pendingRequests = new Map();
    this.stdoutBuffer = '';
  }

  isRunning() {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  start() {
    if (this.isRunning()) return;

    const supervisorPath = path.join(resolveSectionScriptDir(), 'section_supervisor.py');
    if (!fs.existsSync(supervisorPath)) {
      throw Object.assign(new Error(`歌曲段落分析的 Python sidecar 不存在：${supervisorPath}`), { code: 'ENGINE_UNAVAILABLE' });
    }

    const proc = spawn(this.pythonExecutable, [supervisorPath], {
      env: supervisorEnv(this.runtimeProvider),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.stdoutBuffer = '';

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this._onStdoutData(chunk));

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      log.warn('section_supervisor stderr', chunk.trim());
    });

    // 只收拾「自己這一代」的 process：kill()/stop() 之後可能已經 start() 出新的一代，
    // 舊 process 遲到的 exit 不可以把新一代的 proc 清掉、或把新一代的請求一起 reject。
    const onGone = (err) => {
      if (this.proc === proc) this.proc = null;
      if (this.proc === null) this._rejectAllPending(err);
    };
    proc.on('exit', (code, signal) => {
      log.info(`section_supervisor exited (code=${code}, signal=${signal})`);
      onGone(Object.assign(new Error(`section_supervisor exited before responding (code=${code})`), { code: 'ENGINE_CRASHED', retryable: true }));
    });

    proc.on('error', (err) => {
      log.error('failed to spawn section_supervisor', err);
      onGone(Object.assign(err, { code: 'ENGINE_UNAVAILABLE' }));
    });

    log.info(`section_supervisor started (pid=${proc.pid})`);
  }

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
      log.warn('non-JSON line from section_supervisor, ignoring', line);
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
      } else {
        log.warn(`section_supervisor error without a matching request: ${msg.error?.code || 'UNKNOWN'} ${msg.error?.message || ''}`.trim());
      }
      this.emitter.emit('error', msg);
      return;
    }
  }

  // supervisor 死掉時，analyze 的 promise 被 analyze() 自己吞掉了（終局事件本來走 'error'
  // event）——所以這裡要替每個還掛著的 analyze 補發一次 'error' event，不然 jobs 層的
  // activeJob 永遠等不到終局事件，歌曲卡在 processing、AI 人聲分離也永遠被 GPU 互斥擋住。
  _rejectAllPending(err) {
    const pendings = [...this.pendingRequests];
    this.pendingRequests.clear();
    for (const [requestId, pending] of pendings) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(err);
      if (pending.method === 'analyze') {
        this.emitter.emit('error', {
          id: requestId,
          error: { code: err.code || 'ENGINE_CRASHED', retryable: true, message: err.message },
        });
      }
    }
  }

  _send(method, params, { id, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!this.isRunning()) this.start();
    const requestId = id || `${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request = { id: requestId, method, params };

    return new Promise((resolve, reject) => {
      const timeoutHandle = timeoutMs
        ? setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(Object.assign(new Error('section_supervisor request timed out'), { code: 'TIMEOUT', retryable: true }));
        }, timeoutMs)
        : null;
      this.pendingRequests.set(requestId, { method, resolve, reject, timeoutHandle });
      this.proc.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  hello() {
    return this._send('hello', {});
  }

  probe() {
    return this._send('probe', {}, { timeoutMs: PROBE_TIMEOUT_MS });
  }

  // analyze() 不設逾時——模型載入＋推論總共約 15～25 秒，靠 'progress' 事件（load→
  // inference 兩個 stage）證明活著；呼叫端訂閱 emitter 的 progress/result/error，
  // 用回傳的 jobId 篩出屬於自己這個 job 的訊息（跟 ai-separation.js 的 separate() 同款）。
  analyze(params) {
    const jobId = `section-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._send('analyze', params, { id: jobId, timeoutMs: null }).catch(() => {
      /* 終局事件走 'result'/'error' event，這裡吞掉避免 unhandled rejection。 */
    });
    return jobId;
  }

  cancel(jobId) {
    return this._send('cancel', { jobId });
  }

  // 看門狗的最後手段：supervisor 本身卡死（連 cancel 都不回）時整個砍掉重來。
  // 砍掉後 'exit' handler 會替還掛著的 analyze 補發 error event（見 _rejectAllPending）。
  kill() {
    if (!this.proc) return;
    try { this.proc.kill(); } catch (_) { /* already gone */ }
  }
}

const sectionRuntimeProvider = require('./section-runtime-provider');
const supervisor = new SectionAnalysisSupervisor(sectionRuntimeProvider.PYTHON_EXE, sectionRuntimeProvider);

module.exports = { SectionAnalysisSupervisor, supervisor, resolveSectionScriptDir, PROBE_TIMEOUT_MS };
