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
const { emitToControlClients } = require('../utils/socket-broadcast');

const log = createLogger('AISeparationJobs');

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
  const attemptId = supervisor.separate({ ...job.params, forceCpu });
  pythonAttempts.set(attemptId, {
    trackId: job.trackId,
    publicJobId: job.publicJobId,
    params: job.params,
    mode: job.mode,
  });
}

function startCpu(job) {
  emitProgress(job, 'fallback-cpu', 0);
  startPython(job, { forceCpu: true });
}

function tryStartWebgpu(job) {
  if (!webgpuRuntimeProvider.isAvailable() || !webgpuJobs.isEngineAvailable()) return false;
  try {
    emitProgress(job, 'fallback-webgpu', 0);
    webgpuJobs.startJobForTrack(job.trackId, {
      sourceFilename: job.params.sourceFilename || path.basename(job.params.inputPath || ''),
    }, { deferFailure: true, publicJobId: job.publicJobId });
    job.mode = 'webgpu';
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
  };
  activeJob = job;
  emitProgress(job, 'preparing', 0);

  let cudaAvailable = false;
  try {
    const probe = await supervisor.probe();
    cudaAvailable = probe?.cudaAvailable === true;
  } catch (error) {
    log.warn(`Python GPU 探測失敗，改走備援：${error.message}`);
  }

  if (!activeJob || activeJob.publicJobId !== job.publicJobId) return job.publicJobId;
  if (cudaAvailable) {
    startPython(job, { forceCpu: false });
  } else if (!tryStartWebgpu(job)) {
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
  applyResult(job.trackId, { separationStatus: 'failed' });
  emitProgress(job, 'error', 0, {
    error: error.code || 'UNKNOWN',
    errorMessage: error.message || null,
  });
  finishAndAdvance();
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
    emitProgress(activeJob, 'done', 100);
    finishAndAdvance();
  });

  supervisor.emitter.on('error', (message) => {
    const attempt = pythonAttempts.get(message.id);
    pythonAttempts.delete(message.id);
    if (!attempt || !activeJob || activeJob.publicJobId !== attempt.publicJobId) return;
    const error = message.error || {};
    if (attempt.mode === 'python-gpu' && error.code !== 'CANCELLED' && error.code !== 'INPUT_UNREADABLE') {
      if (!tryStartWebgpu(activeJob)) startCpu(activeJob);
      return;
    }
    finalizeError(activeJob, error);
  });

  webgpuJobs.events.on('result', (message) => {
    if (!activeJob || activeJob.mode !== 'webgpu' || activeJob.publicJobId !== message.jobId) return;
    finishAndAdvance();
  });

  webgpuJobs.events.on('progress', (message) => {
    if (!activeJob || activeJob.mode !== 'webgpu' || activeJob.publicJobId !== message.jobId) return;
    activeJob.stage = message.stage;
    activeJob.progress = message.progress;
  });

  webgpuJobs.events.on('error', (message) => {
    if (!activeJob || activeJob.mode !== 'webgpu' || activeJob.publicJobId !== message.jobId) return;
    log.warn(`WebGPU 備援失敗 track=${activeJob.trackId}，切換 CPU：${message.message || message.code}`);
    startCpu(activeJob);
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

module.exports = { wireDependencies, startJobForTrack, getActiveJobs, _resetForTests };
