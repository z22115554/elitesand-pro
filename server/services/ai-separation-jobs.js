'use strict';

/**
 * AI 伴奏工作的唯一協調器。
 *
 * 使用者只啟動一次「製作伴奏」，引擎選擇固定由這裡處理：
 *   1. Python + CUDA（有可用 NVIDIA CUDA 時）
 *   2. WebGPU（Python GPU 不可用或失敗時）
 *   3. Python + CPU（最後備援）
 *
 * 三條路徑共用同一個 publicJobId、同一條 separation:progress 事件與同一個單工佇列，
 * 前端因此不需要知道目前是哪個引擎，也不會把不同階段的百分比當成不同工作。
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { supervisor } = require('./ai-separation');
const webgpuJobs = require('./webgpu-separation-jobs');
const webgpuRuntimeProvider = require('./webgpu-runtime-provider');
const libraryStore = require('./library-store');
const usageTelemetry = require('./usage-telemetry');
const { emitToControlClients } = require('../utils/socket-broadcast');

const log = createLogger('AISeparationJobs');

// Python worker 的錯誤碼 → telemetry-fields.js 的封閉 AI 錯誤分類。對不上的交給
// usage-telemetry 的 mapError() 兜底成 'other'（例如 INTERNAL、INPUT_UNREADABLE）。
const PY_AI_CODE_MAP = {
  GPU_OOM: 'oom',
  RUNTIME_MISSING: 'runtime_missing',
  MODEL_MISSING: 'runtime_missing',
  PROVIDER_UNAVAILABLE: 'unsupported_gpu',
  CANCELLED: 'cancelled',
};

// CPU 真的很慢（弱機一首要 6～60 分鐘），是最後的最後手段。所以顯卡路徑（CUDA 或
// WebGPU）失敗時，先在「同一個引擎」上重算幾次，全都不行才往下一關走。多數失敗
// （worker 崩一下、掉裝置、單一 chunk 吐壞數字、引擎剛好斷線）都是一次性的，隔幾秒
// 重跑就過。順序仍是 CUDA → WebGPU → CPU，只是每一關現在都有重試。
const CUDA_MAX_ATTEMPTS = Number(process.env.ELITESAND_CUDA_MAX_ATTEMPTS) || 3;
const CUDA_RETRY_DELAY_MS = Number(process.env.ELITESAND_CUDA_RETRY_DELAY_MS) || 5000;
// 這些 CUDA 失敗重試沒意義，直接往 WebGPU→CPU 走：runtime/模型沒裝、CUDA 本來就
// 不能用、顯存不足（同設定重跑一樣爆）。（CANCELLED / INPUT_UNREADABLE 更早就 return 了。）
const CUDA_NO_RETRY_CODES = new Set(['RUNTIME_MISSING', 'MODEL_MISSING', 'PROVIDER_UNAVAILABLE', 'GPU_OOM']);

const WEBGPU_MAX_ATTEMPTS = Number(process.env.ELITESAND_WEBGPU_MAX_ATTEMPTS) || 3; // 初次 + 最多 2 次重試
const WEBGPU_RETRY_DELAY_MS = Number(process.env.ELITESAND_WEBGPU_RETRY_DELAY_MS) || 5000;
// 這兩種重試沒意義、只會白等：硬體/前提不符（不會變），或引擎整個 wedge 住（短時間
// 不會自己解開，而且它還卡著上一輪的 s.run，重派只會被回「忙碌中」）。
const WEBGPU_NO_RETRY_CODES = new Set(['unsupported_gpu', 'timeout']);

/**
 * 分離工作的唯一遙測入口：三條引擎（Python CUDA／WebGPU／Python CPU）的終態都在
 * 這裡記「一次」，帶上試過哪些引擎、最終哪個引擎、有沒有 fallback 到 CPU。
 * 以前只有 WebGPU 那條路在送，Python 兩條路完全沒記，於是 `fellBackToCpu` 永遠是
 * false、CPU 成功會把 WebGPU 失敗蓋掉。欄位全部對齊 EULA §7.9 已揭露清單、一律分桶。
 */
function recordJobTelemetry(job, { ok, code, finalBackend }) {
  try {
    const attempts = Array.from(new Set(job && Array.isArray(job.attempts) ? job.attempts : []));
    const info = (job && job.webgpuInfo) || {};
    const fellBackToCpu = finalBackend === 'cpu' && attempts.some((b) => b && b !== 'cpu');
    // 「曾在同一後端重試」＝任一顯卡後端試超過一次（EULA §7.9(f) 1.8.0；只送布林）。
    const retried = ((job && job.cudaAttempts) || 0) > 1 || ((job && job.webgpuAttempts) || 0) > 1;
    // 匿名遙測只送「有沒有重試過」這個布林（ai.retried，EULA §7.9(f) 1.8.0 起揭露）。
    // 精確的 CUDA×n / WebGPU×n 次數只進本機 log（→ 診斷包 / 問題回報），EULA 明講不送次數。
    log[ok ? 'info' : 'warn'](
      `分離結束 track=${job && job.trackId} finalBackend=${finalBackend} ok=${ok}`
      + `${code ? ' code=' + code : ''} 嘗試次數: CUDA×${(job && job.cudaAttempts) || 0} `
      + `WebGPU×${(job && job.webgpuAttempts) || 0}${fellBackToCpu ? ' (退回CPU)' : ''}`,
    );
    usageTelemetry.recordAiSeparation({
      attemptedBackends: attempts.length ? attempts : (finalBackend ? [finalBackend] : []),
      backend: finalBackend,
      gpuVendor: finalBackend === 'webgpu' ? (info.gpuVendor || 'unknown')
        : finalBackend === 'cuda' ? 'nvidia'
        : 'unknown',
      vramMb: finalBackend === 'webgpu' && info.peakBufferMb !== undefined ? info.peakBufferMb : undefined,
      realtimeFactor: finalBackend === 'webgpu' ? info.realtimeFactor : undefined,
      audioSeconds: info.audioSeconds,
      fellBackToCpu,
      retried,
      ok,
      code,
    });
  } catch (error) {
    log.warn(`分離遙測記錄失敗（不影響分離本身）：${error.message}`);
  }
}

let deps = null;
let wired = false;
const queue = [];
const pythonAttempts = new Map(); // attemptId -> { trackId, publicJobId, params, mode }
let activeJob = null; // { trackId, publicJobId, params, mode }

function findTrack(playState, trackId) {
  return (playState.playlist || []).find((track) => track && String(track.id) === String(trackId));
}

function applyResult(trackId, patch) {
  if (!deps) return;
  const { playState, persistState, broadcastState, updateLibraryMeta } = deps;
  const track = findTrack(playState, trackId);
  if (track) {
    Object.assign(track, patch);
    if (playState.currentTrack && String(playState.currentTrack.id) === String(trackId)) {
      Object.assign(playState.currentTrack, patch);
    }
  }
  updateLibraryMeta(trackId, patch);
  persistState();
  broadcastState();
  emitToControlClients(deps.io, 'library:list', libraryStore.getLibrary());
}

function emitProgress(job, stage, progress = 0, extra = {}) {
  job.stage = stage;
  job.progress = progress;
  deps?.io.emit('separation:progress', {
    trackId: job.trackId,
    jobId: job.publicJobId,
    stage,
    progress,
    ...extra,
  });
}

function startPython(job, { forceCpu }) {
  job.mode = forceCpu ? 'cpu' : 'python-gpu';
  const backend = forceCpu ? 'cpu' : 'cuda';
  if (!job.attempts.includes(backend)) job.attempts.push(backend);
  if (!forceCpu) job.cudaAttempts = (job.cudaAttempts || 0) + 1;
  const attemptId = supervisor.separate({ ...job.params, forceCpu });
  job.currentAttemptId = attemptId; // 給 cancelJobForTrack 用來 supervisor.cancel()
  pythonAttempts.set(attemptId, {
    trackId: job.trackId,
    publicJobId: job.publicJobId,
    params: job.params,
    mode: job.mode,
  });
}

function startCpu(job) {
  emitProgress(job, 'fallback-cpu', 0);
  try {
    startPython(job, { forceCpu: true });
  } catch (error) {
    // CPU 備援跟 Python GPU 是同一個 supervisor：它起不來的話這裡也起不來。
    finalizeError(job, { code: error.code || 'ENGINE_UNAVAILABLE', message: error.message });
  }
}

function tryStartWebgpu(job) {
  if (!webgpuRuntimeProvider.isAvailable() || !webgpuJobs.isEngineAvailable()) return false;
  try {
    emitProgress(job, 'fallback-webgpu', 0);
    webgpuJobs.startJobForTrack(job.trackId, {
      sourceFilename: job.params.sourceFilename || path.basename(job.params.inputPath || ''),
    }, { deferFailure: true, publicJobId: job.publicJobId });
    job.mode = 'webgpu';
    job.webgpuAttempts = (job.webgpuAttempts || 0) + 1;
    if (!job.attempts.includes('webgpu')) job.attempts.push('webgpu');
    return true;
  } catch (error) {
    log.warn(`WebGPU 備援無法啟動 track=${job.trackId}: ${error.message}`);
    return false;
  }
}

async function dispatch(trackId, params, publicJobId = null) {
  const job = {
    trackId,
    params,
    publicJobId: publicJobId || `separation-${trackId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    mode: 'probing',
    attempts: [], // 記錄試過的引擎（'cuda' / 'webgpu' / 'cpu'），供終態遙測用
    webgpuInfo: null, // WebGPU 那條路帶回來的 gpuVendor / peakBufferMb / realtimeFactor / audioSeconds
    cudaAttempts: 0, // CUDA 已經試了幾次（含重試），到 CUDA_MAX_ATTEMPTS 才換 WebGPU
    webgpuAttempts: 0, // WebGPU 已經試了幾次（含重試），到 WEBGPU_MAX_ATTEMPTS 才退 CPU
  };
  activeJob = job;
  emitProgress(job, 'preparing', 0);

  let cudaAvailable = false;
  let engineUp = true;
  let engineError = null;
  try {
    const probe = await supervisor.probe();
    cudaAvailable = probe?.cudaAvailable === true;
    // python 端探測不到 CUDA 時回的是 {cudaAvailable:false, error}，不是丟例外。那個
    // error 字串以前被整包吞掉，畫面上「這台沒有 GPU」與「torch 裝壞了」長得一模一樣。
    if (cudaAvailable) log.info(`Python GPU 可用：${probe?.deviceName || 'unknown device'}`);
    else log.warn(`Python GPU 不可用${probe?.error ? `：${probe.error}` : '（torch 回報沒有可用的 CUDA 裝置）'}`);
  } catch (error) {
    // supervisor 完全沒回應＝Python 引擎整條不可用，CPU 備援走的也是它。
    engineUp = false;
    engineError = error;
    log.warn(`Python 引擎無法啟動或無回應：${error.message}`);
  }

  if (!activeJob || activeJob.publicJobId !== job.publicJobId || job.cancelled) return job.publicJobId;
  if (cudaAvailable) {
    startPython(job, { forceCpu: false });
  } else if (!tryStartWebgpu(job)) {
    if (!engineUp) {
      // 引擎起不來時絕不能顯示「正在改用 CPU」——CPU 是同一個 supervisor，工作只會
      // 永遠停在 0%。直接收成明確的失敗（2026-08-30 打包版少了 sidecar 腳本時的實況）。
      finalizeError(job, {
        code: 'ENGINE_UNAVAILABLE',
        message: engineError?.message || 'AI 引擎無法啟動',
      });
      return job.publicJobId;
    }
    startCpu(job);
  }
  return job.publicJobId;
}

function finishAndAdvance() {
  activeJob = null;
  if (!queue.length) return;
  const next = queue.shift();
  dispatch(next.trackId, next.params, next.publicJobId).catch((error) => {
    finalizeError(next, { code: 'INTERNAL', message: error.message });
  });
}

function finalizeError(job, error = {}) {
  log.warn(`分離失敗 track=${job.trackId} job=${job.publicJobId}: ${error.message || error.code || 'unknown'}`);
  // 使用者主動取消不計入失敗率（會灌水分母），其餘終態失敗都記一次。
  if (error.code !== 'CANCELLED') {
    const finalBackend = job.mode === 'python-gpu' ? 'cuda'
      : job.mode === 'webgpu' ? 'webgpu'
      : job.mode === 'cpu' ? 'cpu'
      : 'unknown';
    const code = PY_AI_CODE_MAP[error.code]
      || (typeof error.code === 'string' && error.code ? error.code.toLowerCase() : null)
      || (job && job.webgpuError)
      || 'other';
    recordJobTelemetry(job, { ok: false, code, finalBackend });
  }
  applyResult(job.trackId, { separationStatus: 'failed' });
  emitProgress(job, 'error', 0, {
    error: error.code || 'UNKNOWN',
    errorMessage: error.message || null,
  });
  finishAndAdvance();
}

/** 使用者取消：狀態回到可再點的 'none'（不是 'failed'），不記遙測，讓佇列下一首接上。 */
function finalizeCancelled(job) {
  if (job.currentAttemptId) pythonAttempts.delete(job.currentAttemptId);
  applyResult(job.trackId, { separationStatus: 'none' });
  emitProgress(job, 'cancelled', 0);
  finishAndAdvance();
}

/**
 * 使用者按「取消」。針對某一首歌：
 *  - 正在跑的 → 依目前引擎砍 Python worker / 中止 WebGPU、清掉待重試計時器，直接收尾。
 *    （之後 supervisor/engine 遲到的 result/error 會因 activeJob 已換而被既有守衛忽略。）
 *  - 排隊中的 → 從佇列移除。
 * @returns {{ok:boolean, state:'active'|'queued'|'not-found'}}
 */
function cancelJobForTrack(trackId) {
  const key = String(trackId);

  if (activeJob && String(activeJob.trackId) === key) {
    const job = activeJob;
    job.cancelled = true;
    if (job.retryTimer) { clearTimeout(job.retryTimer); job.retryTimer = null; }
    if (job.mode === 'python-gpu' || job.mode === 'cpu') {
      try {
        if (job.currentAttemptId) supervisor.cancel(job.currentAttemptId);
      } catch (error) {
        log.warn(`supervisor.cancel 失敗（仍照樣收尾）：${error.message}`);
      }
    } else if (job.mode === 'webgpu') {
      webgpuJobs.cancelJob(job.publicJobId);
    }
    // mode === 'probing'：還沒 spawn 任何 worker，dispatch() 過了 probe 會看到 job.cancelled 而中止。
    log.info(`分離已取消 track=${key}（mode=${job.mode}）`);
    finalizeCancelled(job);
    return { ok: true, state: 'active' };
  }

  const idx = queue.findIndex((q) => String(q.trackId) === key);
  if (idx !== -1) {
    const [removed] = queue.splice(idx, 1);
    applyResult(removed.trackId, { separationStatus: 'none' });
    deps?.io.emit('separation:progress', {
      trackId: removed.trackId, jobId: removed.publicJobId, stage: 'cancelled', progress: 0,
    });
    log.info(`已從佇列移除分離工作 track=${key}`);
    return { ok: true, state: 'queued' };
  }

  return { ok: false, state: 'not-found' };
}

function wireDependencies({ io, playState, persistState, broadcastState, updateLibraryMeta = () => {} }) {
  if (wired) return;
  deps = { io, playState, persistState, broadcastState, updateLibraryMeta };
  wired = true;

  supervisor.emitter.on('progress', (message) => {
    const attempt = pythonAttempts.get(message.id);
    if (!attempt) return;
    if (activeJob && activeJob.publicJobId === attempt.publicJobId) {
      activeJob.stage = message.stage;
      activeJob.progress = message.progress;
    }
    io.emit('separation:progress', {
      trackId: attempt.trackId,
      jobId: attempt.publicJobId,
      stage: message.stage,
      progress: message.progress,
    });
  });

  supervisor.emitter.on('result', (message) => {
    const attempt = pythonAttempts.get(message.id);
    pythonAttempts.delete(message.id);
    if (!attempt || !activeJob || activeJob.publicJobId !== attempt.publicJobId) return;
    const result = message.result || {};
    const ok = !!(result.vocal || result.instrumental);
    if (!ok) {
      finalizeError(activeJob, { code: 'NO_OUTPUT', message: 'separation produced no output files' });
      return;
    }
    applyResult(attempt.trackId, {
      vocalsFile: result.vocal ? path.basename(result.vocal) : null,
      instrumentalFile: result.instrumental ? path.basename(result.instrumental) : null,
      separationStatus: 'done',
    });
    recordJobTelemetry(activeJob, {
      ok: true, code: null,
      finalBackend: attempt.mode === 'cpu' ? 'cpu' : 'cuda',
    });
    emitProgress(activeJob, 'done', 100);
    finishAndAdvance();
  });

  supervisor.emitter.on('error', (message) => {
    const attempt = pythonAttempts.get(message.id);
    pythonAttempts.delete(message.id);
    if (!attempt || !activeJob || activeJob.publicJobId !== attempt.publicJobId) return;
    const error = message.error || {};
    const job = activeJob;

    // 使用者取消、輸入檔讀不到——任何引擎重試都沒用，直接收尾。
    if (error.code === 'CANCELLED' || error.code === 'INPUT_UNREADABLE') {
      finalizeError(job, error);
      return;
    }

    if (attempt.mode === 'python-gpu') {
      const retryable = !CUDA_NO_RETRY_CODES.has(error.code) && (job.cudaAttempts || 0) < CUDA_MAX_ATTEMPTS;
      if (retryable) {
        log.warn(`CUDA 失敗（${error.code || 'unknown'}）track=${job.trackId}，${CUDA_RETRY_DELAY_MS}ms 後重試 CUDA（第 ${(job.cudaAttempts || 0) + 1}/${CUDA_MAX_ATTEMPTS} 次）`);
        emitProgress(job, 'preparing', 0);
        job.retryTimer = setTimeout(() => {
          job.retryTimer = null;
          if (job.cancelled || !activeJob || activeJob.publicJobId !== job.publicJobId) return; // 已取消或被取代
          startPython(job, { forceCpu: false });
        }, CUDA_RETRY_DELAY_MS);
        job.retryTimer.unref?.();
        return;
      }
      // CUDA 這關結束（重試用完或不值得重試）→ 換 WebGPU，撐不住才 CPU
      if (!tryStartWebgpu(job)) startCpu(job);
      return;
    }

    finalizeError(job, error);
  });

  webgpuJobs.events.on('result', (message) => {
    if (!activeJob || activeJob.mode !== 'webgpu' || activeJob.publicJobId !== message.jobId) return;
    activeJob.webgpuInfo = {
      gpuVendor: message.gpuVendor,
      peakBufferMb: message.peakBufferMb,
      realtimeFactor: message.realtimeFactor,
      audioSeconds: message.audioSeconds,
    };
    recordJobTelemetry(activeJob, { ok: true, code: null, finalBackend: 'webgpu' });
    finishAndAdvance();
  });

  webgpuJobs.events.on('progress', (message) => {
    if (!activeJob || activeJob.mode !== 'webgpu' || activeJob.publicJobId !== message.jobId) return;
    activeJob.stage = message.stage;
    activeJob.progress = message.progress;
  });

  webgpuJobs.events.on('error', (message) => {
    if (!activeJob || activeJob.mode !== 'webgpu' || activeJob.publicJobId !== message.jobId) return;
    const job = activeJob;
    // 記下 WebGPU 這次為什麼失敗、以及它帶回來的音長——之後 CPU 成功時仍要知道
    // 「WebGPU 試過而且失敗了」，CPU 失敗時錯誤碼也沿用它。
    job.webgpuInfo = { gpuVendor: message.gpuVendor, audioSeconds: message.audioSeconds };
    job.webgpuError = message.code || 'other';

    const retryable = !WEBGPU_NO_RETRY_CODES.has(job.webgpuError)
      && (job.webgpuAttempts || 0) < WEBGPU_MAX_ATTEMPTS;
    if (retryable) {
      log.warn(`WebGPU 失敗（${job.webgpuError}）track=${job.trackId}，${WEBGPU_RETRY_DELAY_MS}ms 後重試 WebGPU（第 ${(job.webgpuAttempts || 0) + 1}/${WEBGPU_MAX_ATTEMPTS} 次）`);
      emitProgress(job, 'fallback-webgpu', 0);
      job.retryTimer = setTimeout(() => {
        job.retryTimer = null;
        // 這段等待期間 job 可能已被取消或被佇列裡的下一首取代
        if (job.cancelled || !activeJob || activeJob.publicJobId !== job.publicJobId) return;
        if (!tryStartWebgpu(job)) startCpu(job); // 引擎這時剛好不在（視窗還沒重連）就只好退 CPU
      }, WEBGPU_RETRY_DELAY_MS);
      job.retryTimer.unref?.();
      return;
    }
    log.warn(`WebGPU 失敗（${job.webgpuError}）track=${job.trackId}，改用 CPU`);
    startCpu(job);
  });

  reconcileOrphanedProcessing();
}

// 重開後協調器一定是空的（activeJob=null、queue=[]）。任何在 playlist／媒體庫還掛在
// separationStatus:'processing' 的都是上一個 server process 留下的孤兒——不會再有工作
// 推進它，前端卻會畫成不能點的「製作伴奏中…」，形同永久卡死。開機時一次掃掉，改標
// 'failed'（前端顯示可點的「重試」）。
function reconcileOrphanedProcessing() {
  if (!deps) return;
  const seen = new Set();
  const orphans = [];
  const consider = (id, status) => {
    if (status === 'processing' && id != null && !seen.has(String(id))) {
      seen.add(String(id));
      orphans.push(id);
    }
  };
  (deps.playState.playlist || []).forEach((track) => track && consider(track.id, track.separationStatus));
  try {
    const lib = libraryStore.getLibrary();
    const list = Array.isArray(lib) ? lib : Object.values((lib && lib.entries) || {});
    list.forEach((entry) => entry && consider(entry.id, entry.separationStatus));
  } catch (_) { /* libraryStore 還沒就緒就算了，playlist 掃過即可 */ }
  if (!orphans.length) return;
  log.warn(`重開後清掉 ${orphans.length} 個孤兒 separationStatus:'processing' → 'failed'`);
  orphans.forEach((id) => applyResult(id, { separationStatus: 'failed' }));
}

async function startJobForTrack(trackId, params) {
  if (!wired) throw new Error('ai-separation-jobs not wired yet (call wireDependencies first)');
  const publicJobId = `separation-${trackId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // separationStatus:'processing' 由這裡「一處」寫入，且同時寫 playState 與 libraryStore
  // （applyResult 兩邊都動，鐵則 #17）。api.js 之前只寫 libraryStore，重開後兩份會不一致。
  applyResult(trackId, { separationStatus: 'processing' });
  if (activeJob !== null) {
    queue.push({ trackId, params, publicJobId });
    deps.io.emit('separation:progress', {
      trackId, jobId: publicJobId, stage: 'queued', progress: 0, queuePosition: queue.length,
    });
    return null;
  }
  return dispatch(trackId, params, publicJobId);
}

function getActiveJobs() {
  const jobs = [];
  if (activeJob) jobs.push({
    trackId: activeJob.trackId, jobId: activeJob.publicJobId,
    stage: activeJob.stage || (activeJob.mode === 'probing' ? 'preparing' : activeJob.mode),
    progress: activeJob.progress || 0,
  });
  queue.forEach((job, index) => jobs.push({
    trackId: job.trackId, jobId: job.publicJobId, stage: 'queued', progress: 0, queuePosition: index + 1,
  }));
  return jobs;
}

function _resetForTests() {
  deps = null;
  wired = false;
  pythonAttempts.clear();
  queue.length = 0;
  activeJob = null;
}

module.exports = { wireDependencies, startJobForTrack, cancelJobForTrack, getActiveJobs, _resetForTests };
