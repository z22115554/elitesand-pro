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
 * OOM，鐵則 #12 的同一類風險。GPU 忙碌時直接回絕、給清楚訊息，不把這個工作排到
 * 另一個功能的佇列後面（使用者點了分析段落卻要等分離跑完幾分鐘才開始，體感更差）。
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { supervisor } = require('./section-analysis');
const sectionRuntimeProvider = require('./section-runtime-provider');
const aiSeparationJobs = require('./ai-separation-jobs');
const libraryStore = require('./library-store');
const { emitToControlClients } = require('../utils/socket-broadcast');

const log = createLogger('SectionAnalysisJobs');

let deps = null;
let wired = false;
const queue = [];
let activeJob = null; // { trackId, publicJobId, params }

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

function finishAndAdvance() {
  activeJob = null;
  if (!queue.length) return;
  const next = queue.shift();
  dispatch(next.trackId, next.params, next.publicJobId).catch((error) => {
    finalizeError(next, { code: 'INTERNAL', message: error.message });
  });
}

function finalizeError(job, error = {}) {
  log.warn(`段落分析失敗 track=${job.trackId} job=${job.publicJobId}: ${error.message || error.code || 'unknown'}`);
  applyResult(job.trackId, { sectionsStatus: 'failed' });
  emitProgress(job, 'error', 0, { error: error.code || 'UNKNOWN', errorMessage: error.message || null });
  finishAndAdvance();
}

function finalizeCancelled(job) {
  applyResult(job.trackId, { sectionsStatus: 'none' });
  emitProgress(job, 'cancelled', 0);
  finishAndAdvance();
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

  if (!activeJob || activeJob.publicJobId !== job.publicJobId || job.cancelled) return job.publicJobId;
  if (!cudaAvailable) {
    finalizeError(job, {
      code: engineError ? 'ENGINE_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE',
      message: engineError?.message || '這台電腦偵測不到可用的 NVIDIA CUDA 顯卡，歌曲段落分析目前只支援 CUDA',
    });
    return job.publicJobId;
  }
  if (!sectionRuntimeProvider.isAvailable() || !sectionRuntimeProvider.isWeightsAvailable()) {
    finalizeError(job, { code: 'RUNTIME_MISSING', message: '歌曲段落分析元件尚未安裝完成' });
    return job.publicJobId;
  }

  job.attemptId = supervisor.analyze({
    inputPath: params.inputPath,
    songformerDir: sectionRuntimeProvider.SONGFORMER_DIR,
  });
  return job.publicJobId;
}

function cancelJobForTrack(trackId) {
  const key = String(trackId);

  if (activeJob && String(activeJob.trackId) === key) {
    const job = activeJob;
    job.cancelled = true;
    try {
      if (job.attemptId) supervisor.cancel(job.attemptId);
    } catch (error) {
      log.warn(`supervisor.cancel 失敗（仍照樣收尾）：${error.message}`);
    }
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
    if (!activeJob || activeJob.attemptId !== message.id) return;
    emitProgress(activeJob, message.stage, message.progress || 0);
  });

  supervisor.emitter.on('result', (message) => {
    if (!activeJob || activeJob.attemptId !== message.id) return;
    const result = message.result || {};
    const sections = Array.isArray(result.sections) ? result.sections : null;
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
  if (activeJob) jobs.push({ trackId: activeJob.trackId, jobId: activeJob.publicJobId, stage: activeJob.stage || 'preparing', progress: activeJob.progress || 0 });
  queue.forEach((job, index) => jobs.push({ trackId: job.trackId, jobId: job.publicJobId, stage: 'queued', progress: 0, queuePosition: index + 1 }));
  return jobs;
}

function isGpuBusy() {
  return activeJob !== null;
}

function _resetForTests() {
  deps = null;
  wired = false;
  queue.length = 0;
  activeJob = null;
}

module.exports = { wireDependencies, startJobForTrack, cancelJobForTrack, getActiveJobs, isGpuBusy, _resetForTests };
