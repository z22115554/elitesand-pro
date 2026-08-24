'use strict';

/**
 * WebGPU 人聲分離（實驗性，docs/AI-SEPARATION-PLAN.md §13 musetric 路線）的 job
 * 生命週期，跟 `ai-separation-jobs.js`（CUDA/Python 路徑）平行、但不呼叫任何 Python
 * supervisor——這裡的「引擎」是 Electron 主程序開的一個隱藏 BrowserWindow，它會像
 * 任何其他前端頁面一樣連回這台 server 的 Socket.io，自報 `client:type: 'webgpu-engine'`。
 * 伺服器端把它當一個特殊的內部 client：用私有事件（`webgpu:job:*`）派工、收結果，
 * 跟 `/display`／`/setlist` 那些既有 client 是同一套機制，只是這個 client 不是人在看，
 * 是拿來跑運算的（見規劃時的架構決策：不額外發明 Electron IPC 橋接，因為 `server/`
 * 本來就是可以脫離 Electron 單獨用 `npm start` 跑的引擎無關層，不該讓它認識
 * `electron/` 的存在——沒有 webgpu-engine client 連進來，這個功能自然就是「不可用」，
 * 天然符合 §13-1 記錄的「WebGPU 只能是 Electron 專屬功能」邊界，不用額外寫偵測）。
 *
 * 沒有排隊：同一時間只有一個隱藏視窗、一個 WebGPU context，跟 CUDA 那邊「同一時間只跑
 * 一個 job」是同一個理由（鐵則 #12），但這裡不需要佇列——WebGPU 模式是使用者主動選擇
 * 的替代引擎（見設定開關），不會跟 CUDA 佇列搶同一批工作，engine 忙碌時直接告訴呼叫端
 * 「引擎忙碌」，不用排隊等。
 */
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const libraryStore = require('./library-store');
const { emitToControlClients } = require('../utils/socket-broadcast');
const usageTelemetry = require('./usage-telemetry');
const { downloadsDir } = require('../utils/app-paths');

const log = createLogger('WebgpuSeparationJobs');

// 引擎跑在瀏覽器頁面裡，沒有檔案系統存取權——分離結果只能用 socket 送二進位資料
// 回來，實際寫檔案（決定檔名、存進 downloadsDir）要在這裡（Node 端）做，跟 CUDA
// 路徑「worker.py 自己決定輸出路徑、Node 端只取 basename」的分工不同：這裡反過來，
// 檔名由 Node 端決定，瀏覽器端只送資料。
function sanitizeStem(filename) {
  const stem = path.basename(filename || 'track', path.extname(filename || ''));
  return stem.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) || 'track';
}

function writeResultFiles(trackId, sourceFilename, result) {
  const stem = sanitizeStem(sourceFilename);
  const suffix = `webgpu-${Date.now()}`;
  const out = {};
  if (result.vocalsBuffer) {
    const name = `${stem}.${suffix}.vocals.wav`;
    fs.writeFileSync(path.join(downloadsDir, name), Buffer.from(result.vocalsBuffer));
    out.vocalsFile = name;
  }
  if (result.instrumentalBuffer) {
    const name = `${stem}.${suffix}.instrumental.wav`;
    fs.writeFileSync(path.join(downloadsDir, name), Buffer.from(result.instrumentalBuffer));
    out.instrumentalFile = name;
  }
  return out;
}

let deps = null; // { io, playState, persistState, broadcastState, updateLibraryMeta }
let wired = false;
let engineSocket = null; // 目前連線的 webgpu-engine socket；同時只認最新那一個
let activeJob = null; // { jobId, trackId, startedAt, params }

function findTrack(playState, trackId) {
  return (playState.playlist || []).find((t) => t && String(t.id) === String(trackId));
}

function isEngineAvailable() {
  return !!(engineSocket && engineSocket.connected);
}

function applyResult(trackId, patch) {
  if (!deps) return;
  const { playState, persistState, broadcastState, updateLibraryMeta } = deps;
  const track = findTrack(playState, trackId);
  if (track) {
    Object.assign(track, patch);
    // currentTrack 可能是同 id 的另一份快照（播放時複製），要一起補上
    // （跟 ai-separation-jobs.js／loudness-backfill.js 同一個理由，鐵則 #17）。
    if (playState.currentTrack && String(playState.currentTrack.id) === String(trackId)) {
      Object.assign(playState.currentTrack, patch);
    }
  }
  updateLibraryMeta(trackId, patch);
  persistState();
  broadcastState();
  // media-library.js 的媒體庫清單是獨立於 playState 的另一份前端快取，broadcastState
  // 不會更新到它——沿用 ai-separation-jobs.js／library.js 既有的 library:list 廣播慣例。
  emitToControlClients(deps.io, 'library:list', libraryStore.getLibrary());
}

/** 遙測欄位完全對齊 EULA §7.9 已揭露的清單，不多送任何欄位（不用動 EULA 版本）。 */
function recordTelemetry({ ok, code, gpuVendor, vramMb, realtimeFactor, audioSeconds, fellBackToCpu }) {
  try {
    usageTelemetry.recordAiSeparation({
      backend: 'webgpu',
      gpuVendor: gpuVendor || 'unknown',
      vramMb: vramMb === undefined ? 'unknown' : vramMb,
      realtimeFactor,
      audioSeconds,
      fellBackToCpu: !!fellBackToCpu,
      ok,
      code,
    });
  } catch (e) {
    log.warn(`遙測記錄失敗（不影響分離本身）：${e.message}`);
  }
}

function wireDependencies({ io, playState, persistState, broadcastState, updateLibraryMeta = () => {} }) {
  if (wired) return; // 避免 socket-handler 重複建立時重複掛監聽（測試環境可能會 new 多次 ctx）
  deps = { io, playState, persistState, broadcastState, updateLibraryMeta };
  wired = true;
}

/** socket-handler.js 在 webgpu-engine client 連線時呼叫。 */
function handleEngineConnected(socket) {
  engineSocket = socket;
  log.info(`WebGPU engine 已連線: ${socket.id}`);
}

/** socket-handler.js 在任何 socket 斷線時呼叫；只有斷的剛好是目前認定的那個 engine 才處理。 */
function handleEngineDisconnected(socketId) {
  if (!engineSocket || engineSocket.id !== socketId) return;
  log.info(`WebGPU engine 已斷線: ${socketId}`);
  engineSocket = null;
  if (activeJob) {
    // 引擎斷線時若有進行中的工作，視為失敗，不留一個永遠卡在 processing 的假狀態。
    const job = activeJob;
    activeJob = null;
    applyResult(job.trackId, { separationStatus: 'failed' });
    deps?.io.emit('separation:progress', {
      trackId: job.trackId, jobId: job.jobId, stage: 'error', progress: 0,
      error: 'ENGINE_DISCONNECTED', errorMessage: null,
    });
    recordTelemetry({ ok: false, code: 'engine_disconnected' });
  }
}

/**
 * 給 API 路由呼叫（介面跟 ai-separation-jobs.js 的 startJobForTrack 對齊：回傳 jobId，
 * 呼叫端據此判斷有沒有成功送出）。engine 離線或忙碌時直接丟錯，不進佇列——
 * 呼叫端（api.js）要把這個錯誤轉成使用者看得懂的訊息。
 *
 * @param {object} params
 * @param {string} params.sourceFilename - downloadsDir 底下的原始音檔檔名（引擎會拿去
 *   組 `/audio/<filename>` 的 URL 自己 fetch；跟 CUDA 路徑不同，這裡不傳絕對路徑，
 *   因為引擎是瀏覽器頁面，只能透過 HTTP URL 拿音檔，沒有檔案系統存取權）。
 */
function startJobForTrack(trackId, params) {
  if (!wired) throw new Error('webgpu-separation-jobs not wired yet (call wireDependencies first)');
  if (!isEngineAvailable()) {
    throw Object.assign(new Error('WebGPU engine 目前離線'), { code: 'WEBGPU_ENGINE_OFFLINE' });
  }
  if (activeJob) {
    throw Object.assign(new Error('WebGPU engine 目前忙碌中'), { code: 'WEBGPU_ENGINE_BUSY' });
  }
  const jobId = `webgpu-${trackId}-${Date.now()}`;
  activeJob = { jobId, trackId, startedAt: Date.now(), params };
  engineSocket.emit('webgpu:job:start', {
    jobId, trackId,
    audioUrl: `/audio/${encodeURIComponent(params.sourceFilename)}`,
  });
  return jobId;
}

// ─── engine 送回的私有事件，由 socket-handler.js 註冊在該 socket 上並轉呼叫這裡 ───
// 每個 handler 都先確認事件真的來自目前認定的那個 engine socket、且 jobId 對得上，
// 避免任何其他 client（就算冒充 clientType）能偽造分離結果寫回媒體庫。

function handleProgress(socket, payload) {
  if (!engineSocket || socket.id !== engineSocket.id || !activeJob) return;
  if (!payload || payload.jobId !== activeJob.jobId) return;
  deps?.io.emit('separation:progress', {
    trackId: activeJob.trackId, jobId: activeJob.jobId, stage: payload.stage, progress: payload.progress,
  });
}

/**
 * 分離結果的 WAV 資料改由 HTTP multipart 上傳（見 api.js 的
 * POST /webgpu-separation/result/:jobId），不再走 Socket.io——一首幾分鐘的歌，人聲＋
 * 伴奏兩個 WAV 加起來輕鬆超過 Socket.io 的 8MB 封包上限（`server/index.js` 的
 * `maxHttpBufferSize`），真機首測就是在這裡爆掉：算完 100% 卻在送結果時斷線，
 * 誤報成分離失敗。這裡不用 socket 身分驗證（HTTP 請求沒有對應的 socket.id），
 * 改用「jobId 對得上目前的 activeJob」當授權門檻——跟 socket 版本「payload.jobId
 * 對得上 activeJob.jobId」是同一等級的信任模型，只是換了傳輸層。這支端點也刻意不掛
 * requirePin：呼叫者是沒有 PIN 內容的隱藏視窗頁面，跟 `webgpu-engine` clientType
 * 在 PIN_EXEMPT_CLIENT_TYPES 裡被豁免的理由完全一樣（鐵則 14 的 HTTP 版本）。
 */
function finishJobWithResult(jobId, { vocalsBuffer, instrumentalBuffer, gpuVendor, peakBufferMb, realtimeFactor, audioSeconds }) {
  if (!activeJob || activeJob.jobId !== jobId) {
    return { ok: false, code: 'UNKNOWN_JOB' };
  }
  const job = activeJob;
  activeJob = null;
  let written;
  try {
    written = writeResultFiles(job.trackId, job.params?.sourceFilename, { vocalsBuffer, instrumentalBuffer });
  } catch (err) {
    log.error(`寫入 WebGPU 分離結果檔案失敗 track=${job.trackId}`, err);
    applyResult(job.trackId, { separationStatus: 'failed' });
    deps?.io.emit('separation:progress', {
      trackId: job.trackId, jobId: job.jobId, stage: 'error', progress: 0,
      error: 'WRITE_FAILED', errorMessage: err.message,
    });
    recordTelemetry({ ok: false, code: 'write_failed', gpuVendor, audioSeconds });
    return { ok: false, code: 'WRITE_FAILED' };
  }
  const ok = !!(written.vocalsFile || written.instrumentalFile);
  applyResult(job.trackId, {
    vocalsFile: written.vocalsFile || null,
    instrumentalFile: written.instrumentalFile || null,
    separationStatus: ok ? 'done' : 'failed',
  });
  deps?.io.emit('separation:progress', { trackId: job.trackId, jobId: job.jobId, stage: 'done', progress: 100 });
  recordTelemetry({
    ok, code: ok ? null : 'no_output',
    gpuVendor, vramMb: peakBufferMb,
    realtimeFactor, audioSeconds,
    fellBackToCpu: false,
  });
  return { ok: true };
}

function handleError(socket, payload) {
  if (!engineSocket || socket.id !== engineSocket.id || !activeJob) return;
  if (!payload || payload.jobId !== activeJob.jobId) return;
  const job = activeJob;
  activeJob = null;
  log.warn(`WebGPU 分離失敗 track=${job.trackId}: ${payload.message || payload.code}`);
  applyResult(job.trackId, { separationStatus: 'failed' });
  deps?.io.emit('separation:progress', {
    trackId: job.trackId, jobId: job.jobId, stage: 'error', progress: 0,
    error: payload.code || 'UNKNOWN', errorMessage: payload.message || null,
  });
  recordTelemetry({
    ok: false, code: payload.code || 'unknown',
    gpuVendor: payload.gpuVendor, audioSeconds: payload.audioSeconds,
  });
}

/** device lost 是已知、獨立記錄的失敗代碼（見規劃：canary 探測 + 全程監聽 device.lost）。 */
function handleDeviceLost(socket, payload) {
  handleError(socket, { ...payload, code: 'device_lost' });
}

function _resetForTests() {
  deps = null;
  wired = false;
  engineSocket = null;
  activeJob = null;
}

module.exports = {
  wireDependencies,
  startJobForTrack,
  isEngineAvailable,
  handleEngineConnected,
  handleEngineDisconnected,
  handleProgress,
  finishJobWithResult,
  handleError,
  handleDeviceLost,
  _resetForTests,
};
