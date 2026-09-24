'use strict';

/**
 * 歌曲段落分析工作的協調器（SongFormer，V1）。
 *
 * 跟 ai-separation-jobs.js（AI 人聲分離）比起來大幅簡化：
 *   - 只有 CUDA 一條路，探測不到就直接失敗，沒有 WebGPU/CPU 降級鏈
 *     （SongFormer 的 CPU/WebGPU 路徑從沒驗證過，見 REPORT.md）。
 *   - 沒有跨錯誤碼的重試機制——分析一首歌只要 15~25 秒，失敗了讓使用者自己
 *     按一次「重新分析」就好，不像人聲分離要跑好幾分鐘、值得自動重試。
 *
 * 仍然沿用同一個「單一 activeJob」佇列設計，以及跟 AI 分離之間的 GPU 互斥檢查
 * （ai-separation-jobs.isGpuBusy()）——兩個功能都是重度 GPU 推論，同時跑會互相
 * OOM，鐵則 #12 的同一類風險。分離佔著 GPU 時這裡直接回絕、給清楚訊息，不把這個
 * 工作排到另一個功能的佇列後面（分離要跑好幾分鐘）；反過來分離撞上段落分析時則是
 * 等它跑完（whenGpuIdle，段落分析只要十幾秒）。
 */
const { createLogger } = require('../utils/logger');
const { supervisor } = require('./section-analysis');
const sectionRuntimeProvider = require('./section-runtime-provider');
const aiSeparationJobs = require('./ai-separation-jobs');
const libraryStore = require('./library-store');
const { emitToControlClients } = require('../utils/socket-broadcast');
const { sanitizeSections } = require('../utils/track-schema');

const log = createLogger('SectionAnalysisJobs');

// 正常一首 15～25 秒；第一次跑要從冷硬碟載入 ~2GB 權重，給很寬的上限。超過就視為
// worker／supervisor 卡死，不能讓 activeJob 永遠掛著（會連帶讓 AI 人聲分離永遠等 GPU）。
const ANALYZE_WATCHDOG_MS = 5 * 60 * 1000;
// 取消／逾時後等 Python 端真的回終局事件（worker 已停）才釋放 GPU。supervisor 的
// CANCEL_GRACE_SECONDS 是 2 秒後 terminate，正常很快就回；等不到代表 supervisor 本身卡死。
const DRAIN_TIMEOUT_MS = 15000;

let deps = null;
let wired = false;
const queue = [];
// { trackId, publicJobId, params, attemptId?, retired?, watchdog?, drainTimer? }
// retired=true：使用者已經看到取消/失敗、歌曲狀態也已寫回，但 Python worker 還沒確認
// 停下來——這段期間 activeJob 仍佔著，isGpuBusy() 仍為 true，佇列下一首不會被派出去
// 撞上 supervisor 的 BUSY（「another job is already running」）。
let activeJob = null;
let gpuIdleWaiters = [];

function findTrack(playState, trackId) {
  return (playState.playlist || []).find((track) => track && String(track.id) === String(trackId));
}

// 跟 ai-separation-jobs.js 的 applyResult() 同一套五步驟寫回：playState + libraryStore +
// persistState + broadcastState + library:list，不另外發明寫回邏輯（鐵則 #17）。
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
  emitToControlClients(deps.io, 'library:list', libraryStore.getLibrarySummary());
}

function emitProgress(job, stage, progress = 0, extra = {}) {
  job.stage = stage;
  job.progress = progress;
  deps?.io.emit('sections:progress', {
    trackId: job.trackId,
    jobId: job.publicJobId,
    stage,
    progress,
    ...extra,
  });
}

function clearJobTimers(job) {
  if (!job) return;
  if (job.watchdog) { clearTimeout(job.watchdog); job.watchdog = null; }
  if (job.drainTimer) { clearTimeout(job.drainTimer); job.drainTimer = null; }
}

function finishAndAdvance() {
  clearJobTimers(activeJob);
  activeJob = null;
  // 先通知在等 GPU 的 AI 人聲分離（見 whenGpuIdle）；它們在 microtask 才恢復執行，
  // 所以若佇列下一首段落分析在這裡同步 dispatch，它的 GPU 互斥檢查會先看到分離已佔用
  // activeJob 而收成 GPU_BUSY——分離要跑好幾分鐘，這是刻意的讓路方向。
  const waiters = gpuIdleWaiters;
  gpuIdleWaiters = [];
  waiters.forEach((resolve) => resolve());
  if (!queue.length) return;
  const next = queue.shift();
  dispatch(next.trackId, next.params, next.publicJobId).catch((error) => {
    finalizeError(activeJob && activeJob.publicJobId === next.publicJobId ? activeJob : next, { code: 'INTERNAL', message: error.message });
  });
}

/**
 * 使用者端已經收尾（狀態寫回、進度事件發出），這裡只負責「GPU 什麼時候真的空下來」：
 * 還沒派 worker 的直接釋放；派了的送 cancel，等 supervisor 回這個 attempt 的
 * 'result'/'error'（handler 看到 job.retired 就只釋放）；DRAIN_TIMEOUT_MS 內等不到
 * 就砍掉整個 supervisor 強制釋放（下次分析會自動重新 spawn）。
 */
function retire(job) {
  job.retired = true;
  if (job.watchdog) { clearTimeout(job.watchdog); job.watchdog = null; }
  if (activeJob !== job) return;
  if (!job.attemptId || job.workerEnded) { finishAndAdvance(); return; }
  Promise.resolve()
    .then(() => supervisor.cancel(job.attemptId))
    .catch((error) => log.warn(`supervisor.cancel 失敗（等逾時後強制釋放）：${error.message}`));
  job.drainTimer = setTimeout(() => {
    job.drainTimer = null;
    if (activeJob !== job) return;
    log.warn(`段落分析 worker ${DRAIN_TIMEOUT_MS / 1000} 秒內沒有停下來，重啟 supervisor 並釋放 GPU track=${job.trackId}`);
    supervisor.kill();
    finishAndAdvance();
  }, DRAIN_TIMEOUT_MS);
}

function finalizeError(job, error = {}) {
  if (job.retired) return;
  log.warn(`段落分析失敗 track=${job.trackId} job=${job.publicJobId}: ${error.message || error.code || 'unknown'}`);
  applyResult(job.trackId, { sectionsStatus: 'failed' });
  emitProgress(job, 'error', 0, { error: error.code || 'UNKNOWN', errorMessage: error.message || null });
  retire(job);
}

function finalizeCancelled(job) {
  if (job.retired) return;
  applyResult(job.trackId, { sectionsStatus: 'none' });
  emitProgress(job, 'cancelled', 0);
  retire(job);
}

async function dispatch(trackId, params, publicJobId) {
  const job = { trackId, params, publicJobId, stage: 'preparing', progress: 0 };
  activeJob = job;
  emitProgress(job, 'preparing', 0);

  if (aiSeparationJobs.isGpuBusy()) {
    finalizeError(job, { code: 'GPU_BUSY', message: 'AI 人聲分離正在使用 GPU，請等它跑完再分析段落' });
    return job.publicJobId;
  }

  let cudaAvailable = false;
  let engineError = null;
  try {
    const probe = await supervisor.probe();
    cudaAvailable = probe?.cudaAvailable === true;
    if (!cudaAvailable) log.warn(`歌曲段落分析：偵測不到 CUDA${probe?.error ? `（${probe.error}）` : ''}`);
  } catch (error) {
    engineError = error;
    log.warn(`歌曲段落分析引擎無法啟動或無回應：${error.message}`);
  }

  if (activeJob !== job || job.retired) return job.publicJobId;
  if (!cudaAvailable) {
    finalizeError(job, {
      code: engineError ? 'ENGINE_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE',
      message: engineError?.message || '這台電腦偵測不到可用的 NVIDIA CUDA 顯卡，歌曲段落分析目前只支援 CUDA',
    });
    return job.publicJobId;
  }
  const weightsOk = sectionRuntimeProvider.isAvailable() && await sectionRuntimeProvider.verifyWeights();
  if (activeJob !== job || job.retired) return job.publicJobId;
  if (!weightsOk) {
    finalizeError(job, { code: 'RUNTIME_MISSING', message: '歌曲段落分析元件尚未安裝完成' });
    return job.publicJobId;
  }

  job.attemptId = supervisor.analyze({
    inputPath: params.inputPath,
    songformerDir: sectionRuntimeProvider.SONGFORMER_DIR,
  });
  job.watchdog = setTimeout(() => {
    job.watchdog = null;
    if (activeJob !== job || job.retired) return;
    finalizeError(job, { code: 'TIMEOUT', message: `段落分析超過 ${ANALYZE_WATCHDOG_MS / 60000} 分鐘沒有完成，已中止` });
  }, ANALYZE_WATCHDOG_MS);
  return job.publicJobId;
}

function cancelJobForTrack(trackId) {
  const key = String(trackId);

  if (activeJob && !activeJob.retired && String(activeJob.trackId) === key) {
    const job = activeJob;
    job.cancelled = true;
    log.info(`段落分析已取消 track=${key}`);
    finalizeCancelled(job);
    return { ok: true, state: 'active' };
  }

  const idx = queue.findIndex((q) => String(q.trackId) === key);
  if (idx !== -1) {
    const [removed] = queue.splice(idx, 1);
    applyResult(removed.trackId, { sectionsStatus: 'none' });
    deps?.io.emit('sections:progress', { trackId: removed.trackId, jobId: removed.publicJobId, stage: 'cancelled', progress: 0 });
    return { ok: true, state: 'queued' };
  }

  return { ok: false, state: 'not-found' };
}

function wireDependencies({ io, playState, persistState, broadcastState, updateLibraryMeta = () => {} }) {
  if (wired) return;
  deps = { io, playState, persistState, broadcastState, updateLibraryMeta };
  wired = true;

  supervisor.emitter.on('progress', (message) => {
    if (!activeJob || activeJob.retired || activeJob.attemptId !== message.id) return;
    emitProgress(activeJob, message.stage, message.progress || 0);
  });

  supervisor.emitter.on('result', (message) => {
    if (!activeJob || activeJob.attemptId !== message.id) return;
    activeJob.workerEnded = true;
    // 已取消／逾時的 job：worker 停了（或剛好跑完），只釋放 GPU，不寫回結果——
    // 使用者已經看到取消，不能事後又冒出一份段落資料。
    if (activeJob.retired) { finishAndAdvance(); return; }
    const result = message.result || {};
    // 模型原始標籤是 pre-chorus（連字號），段落搭配頁／display.js 用 pre_chorus；
    // 一定要經過 sanitizeSections 才寫回，不然 playState 裡的原始值到重開前都套不到模板。
    const sections = Array.isArray(result.sections) ? sanitizeSections(result.sections) : null;
    if (!sections) {
      finalizeError(activeJob, { code: 'NO_OUTPUT', message: 'section analysis produced no sections' });
      return;
    }
    applyResult(activeJob.trackId, { sections, sectionsStatus: 'done' });
    emitProgress(activeJob, 'done', 100);
    finishAndAdvance();
  });

  supervisor.emitter.on('error', (message) => {
    if (!activeJob || activeJob.attemptId !== message.id) return;
    // attempt 的終局 error＝worker 已經結束（supervisor 的 reader thread 在 worker 結束後才發），
    // 或 supervisor 整個死掉（section-analysis.js 的 _rejectAllPending 補發）——兩種都不必再等 drain。
    activeJob.workerEnded = true;
    if (activeJob.retired) { finishAndAdvance(); return; }
    finalizeError(activeJob, message.error || {});
  });

  reconcileOrphanedProcessing();
}

// 重開後協調器一定是空的，任何還掛在 sectionsStatus:'processing' 的都是上一個
// server process 留下的孤兒（跟 ai-separation-jobs.js 的 reconcileOrphanedProcessing 同一個坑）。
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
  (deps.playState.playlist || []).forEach((track) => track && consider(track.id, track.sectionsStatus));
  try {
    const lib = libraryStore.getLibrary();
    const list = Array.isArray(lib) ? lib : Object.values((lib && lib.entries) || {});
    list.forEach((entry) => entry && consider(entry.id, entry.sectionsStatus));
  } catch (_) { /* libraryStore 還沒就緒就算了 */ }
  if (!orphans.length) return;
  log.warn(`重開後清掉 ${orphans.length} 個孤兒 sectionsStatus:'processing' → 'failed'`);
  orphans.forEach((id) => applyResult(id, { sectionsStatus: 'failed' }));
}

async function startJobForTrack(trackId, params) {
  if (!wired) throw new Error('section-analysis-jobs not wired yet (call wireDependencies first)');
  const publicJobId = `section-${trackId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  applyResult(trackId, { sectionsStatus: 'processing' });
  if (activeJob !== null) {
    queue.push({ trackId, params, publicJobId });
    deps.io.emit('sections:progress', { trackId, jobId: publicJobId, stage: 'queued', progress: 0, queuePosition: queue.length });
    return null;
  }
  return dispatch(trackId, params, publicJobId);
}

function getActiveJobs() {
  const jobs = [];
  if (activeJob && !activeJob.retired) jobs.push({ trackId: activeJob.trackId, jobId: activeJob.publicJobId, stage: activeJob.stage || 'preparing', progress: activeJob.progress || 0 });
  queue.forEach((job, index) => jobs.push({ trackId: job.trackId, jobId: job.publicJobId, stage: 'queued', progress: 0, queuePosition: index + 1 }));
  return jobs;
}

// 包含 retired（已對使用者收尾、但 worker 還沒確認停下）的 job：那段期間 GPU 仍被佔用。
function isGpuBusy() {
  return activeJob !== null;
}

/**
 * GPU 空下來時 resolve。給 AI 人聲分離用：段落分析一首只要十幾秒，分離撞上它時
 * 等一下就好，不該直接失敗（也不該記成一次分離失敗遙測）。看門狗＋drain 逾時保證
 * 這個等待有上限。
 */
function whenGpuIdle() {
  if (activeJob === null) return Promise.resolve();
  return new Promise((resolve) => gpuIdleWaiters.push(resolve));
}

function _resetForTests() {
  clearJobTimers(activeJob);
  deps = null;
  wired = false;
  queue.length = 0;
  activeJob = null;
  gpuIdleWaiters = [];
}

module.exports = {
  wireDependencies, startJobForTrack, cancelJobForTrack, getActiveJobs, isGpuBusy, whenGpuIdle, _resetForTests,
  ANALYZE_WATCHDOG_MS, DRAIN_TIMEOUT_MS,
};
