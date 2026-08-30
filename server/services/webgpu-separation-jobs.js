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
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { createLogger } = require('../utils/logger');
const libraryStore = require('./library-store');
const { emitToControlClients } = require('../utils/socket-broadcast');
const { downloadsDir } = require('../utils/app-paths');

const log = createLogger('WebgpuSeparationJobs');

// 分離遙測不在這一層送——三條引擎（Python CUDA／WebGPU／Python CPU）的終態統一由
// `ai-separation-jobs.js` 這個協調器記一次，才記得到「試過哪些引擎、誰成功、有沒有
// fallback」。這裡只負責把 gpuVendor／peakBufferMb 等欄位塞進 events 事件往上帶。

// hang watchdog：session.create / s.run 若整個 wedge（不丟例外、不觸發 device.lost），
// 這個 job 會永遠掛著。收不到進度心跳超過這個時間就當它逾時，送 events 'error'（code
// 'timeout'），讓協調器切到 CPU；同時最佳努力叫引擎在下個 chunk 前收手。
const PROGRESS_TIMEOUT_MS = Number(process.env.ELITESAND_WEBGPU_PROGRESS_TIMEOUT_MS) || 120000;
const WATCHDOG_TICK_MS = 15000;
let watchdogTimer = null;
let lastProgressAt = 0;

// server 跟 Electron 主程序是「兩個不同的 process」（Electron 用 child_process 跑
// server），沒有共用的 EventEmitter。所以「引擎卡死／崩了，請把隱藏視窗重開」這個
// 訊號只能靠 Electron 來輪詢：watchdog 逾時或 job 進行中斷線時記一個時間戳，塞進
// /api/webgpu-separation/runtime-status 的回應，Electron 那邊（shell.js 的健康輪詢）
// 讀到比上次新的時間戳就 restart() 那個 BrowserWindow。新的引擎一連上就清掉。
let restartRequestedAt = 0;
function requestEngineRestart(reason) {
  restartRequestedAt = Date.now();
  log.warn(`已要求重開 WebGPU 引擎視窗（原因：${reason}）`);
}
function getRestartRequestedAt() {
  return restartRequestedAt;
}

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
const events = new EventEmitter();

function findTrack(playState, trackId) {
  return (playState.playlist || []).find((t) => t && String(t.id) === String(trackId));
}

function isEngineAvailable() {
  return !!(engineSocket && engineSocket.connected);
}

/**
 * 目前 activeJob 的內部 jobId（沒有 job 時為 null）。
 *
 * 給結果上傳路由在「收下 multipart 內容之前」先比對用：finishJobWithResult() 本身也會
 * 再比對一次（那是真正的授權關卡），但那時 multer 已經把最大 2×500MB 讀進記憶體了。
 * 這個 getter 只回傳字串、不改任何狀態，讓路由能先擋掉不合法的請求。
 */
function getActiveJobId() {
  return activeJob ? activeJob.jobId : null;
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

function armWatchdog() {
  lastProgressAt = Date.now();
  if (watchdogTimer) return;
  watchdogTimer = setInterval(checkWatchdog, WATCHDOG_TICK_MS);
  watchdogTimer.unref?.(); // 別讓這個計時器擋住 process 結束
}

function disarmWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function checkWatchdog() {
  if (!activeJob) {
    disarmWatchdog();
    return;
  }
  if (Date.now() - lastProgressAt <= PROGRESS_TIMEOUT_MS) return;
  const job = activeJob;
  activeJob = null;
  disarmWatchdog();
  log.warn(`WebGPU 分離逾時無進度（>${PROGRESS_TIMEOUT_MS}ms）track=${job.trackId}，視為失敗、切 CPU`);
  try { engineSocket?.emit('webgpu:job:cancel', { jobId: job.jobId }); } catch (_) { /* 最佳努力 */ }
  // 逾時＝引擎很可能整個 wedge 在 s.run 裡，光靠 job:cancel 收不回來——請 Electron 重開視窗。
  requestEngineRestart('watchdog-timeout');
  if (!job.deferFailure) {
    applyResult(job.trackId, { separationStatus: 'failed' });
    deps?.io.emit('separation:progress', {
      trackId: job.trackId, jobId: job.publicJobId || job.jobId, stage: 'error', progress: 0,
      error: 'TIMEOUT', errorMessage: null,
    });
  }
  events.emit('error', { trackId: job.trackId, jobId: job.publicJobId || job.jobId, code: 'timeout' });
}

function wireDependencies({ io, playState, persistState, broadcastState, updateLibraryMeta = () => {} }) {
  if (wired) return; // 避免 socket-handler 重複建立時重複掛監聽（測試環境可能會 new 多次 ctx）
  deps = { io, playState, persistState, broadcastState, updateLibraryMeta };
  wired = true;
}

/** socket-handler.js 在 webgpu-engine client 連線時呼叫。 */
function handleEngineConnected(socket) {
  engineSocket = socket;
  restartRequestedAt = 0; // 新引擎連上了，撤銷先前的重開請求
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
    disarmWatchdog();
    // job 進行中斷線＝視窗多半崩了（不是使用者關設定——那條走 stop()，不會有 activeJob）。
    requestEngineRestart('disconnect-mid-job');
    if (!job.deferFailure) {
      applyResult(job.trackId, { separationStatus: 'failed' });
      deps?.io.emit('separation:progress', {
        trackId: job.trackId, jobId: job.publicJobId || job.jobId, stage: 'error', progress: 0,
        error: 'ENGINE_DISCONNECTED', errorMessage: null,
      });
    }
    events.emit('error', { trackId: job.trackId, jobId: job.publicJobId || job.jobId, code: 'engine_disconnected' });
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
function startJobForTrack(trackId, params, { deferFailure = false, publicJobId = null } = {}) {
  if (!wired) throw new Error('webgpu-separation-jobs not wired yet (call wireDependencies first)');
  if (!isEngineAvailable()) {
    throw Object.assign(new Error('WebGPU engine 目前離線'), { code: 'WEBGPU_ENGINE_OFFLINE' });
  }
  if (activeJob) {
    throw Object.assign(new Error('WebGPU engine 目前忙碌中'), { code: 'WEBGPU_ENGINE_BUSY' });
  }
  // jobId 同時是結果回傳端點（POST /webgpu-separation/result/:jobId）的授權憑證，
  // 所以不能是猜得到的值。舊格式 `webgpu-<trackId>-<Date.now()>` 的兩段都可推得：
  // trackId 從沒掛保護的 GET /api/playlist 就讀得到，毫秒數在 job 進行中只有幾秒窗口，
  // 猜中即可用自己的音檔頂替分離結果、直接播上直播。改用隨機值杜絕這條路。
  const jobId = `webgpu-${crypto.randomUUID()}`;
  activeJob = { jobId, publicJobId, trackId, startedAt: Date.now(), params, deferFailure };
  engineSocket.emit('webgpu:job:start', {
    jobId, trackId,
    audioUrl: `/audio/${encodeURIComponent(params.sourceFilename)}`,
  });
  armWatchdog();
  return jobId;
}

// ─── engine 送回的私有事件，由 socket-handler.js 註冊在該 socket 上並轉呼叫這裡 ───
// 每個 handler 都先確認事件真的來自目前認定的那個 engine socket、且 jobId 對得上，
// 避免任何其他 client（就算冒充 clientType）能偽造分離結果寫回媒體庫。

function handleProgress(socket, payload) {
  if (!engineSocket || socket.id !== engineSocket.id || !activeJob) return;
  if (!payload || payload.jobId !== activeJob.jobId) return;
  lastProgressAt = Date.now(); // 心跳，餵飽 watchdog
  deps?.io.emit('separation:progress', {
    trackId: activeJob.trackId, jobId: activeJob.publicJobId || activeJob.jobId, stage: payload.stage, progress: payload.progress,
  });
  events.emit('progress', {
    trackId: activeJob.trackId, jobId: activeJob.publicJobId || activeJob.jobId,
    stage: payload.stage, progress: payload.progress,
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
  disarmWatchdog();
  const hw = { gpuVendor, peakBufferMb, realtimeFactor, audioSeconds };
  let written;
  try {
    written = writeResultFiles(job.trackId, job.params?.sourceFilename, { vocalsBuffer, instrumentalBuffer });
  } catch (err) {
    log.error(`寫入 WebGPU 分離結果檔案失敗 track=${job.trackId}`, err);
    if (!job.deferFailure) {
      applyResult(job.trackId, { separationStatus: 'failed' });
      deps?.io.emit('separation:progress', {
        trackId: job.trackId, jobId: job.publicJobId || job.jobId, stage: 'error', progress: 0,
        error: 'WRITE_FAILED', errorMessage: err.message,
      });
    }
    events.emit('error', {
      trackId: job.trackId, jobId: job.publicJobId || job.jobId,
      code: 'write_failed', message: err.message, ...hw,
    });
    return { ok: false, code: 'WRITE_FAILED' };
  }
  const ok = !!(written.vocalsFile || written.instrumentalFile);
  if (!ok) {
    if (!job.deferFailure) {
      applyResult(job.trackId, { separationStatus: 'failed' });
      deps?.io.emit('separation:progress', {
        trackId: job.trackId, jobId: job.publicJobId || job.jobId, stage: 'error', progress: 0,
        error: 'NO_OUTPUT', errorMessage: null,
      });
    }
    events.emit('error', { trackId: job.trackId, jobId: job.publicJobId || job.jobId, code: 'no_output', ...hw });
    return { ok: false, code: 'NO_OUTPUT' };
  }
  applyResult(job.trackId, {
    vocalsFile: written.vocalsFile || null,
    instrumentalFile: written.instrumentalFile || null,
    separationStatus: 'done',
  });
  deps?.io.emit('separation:progress', { trackId: job.trackId, jobId: job.publicJobId || job.jobId, stage: 'done', progress: 100 });
  // 遙測由協調器（ai-separation-jobs.js）記——這裡只把硬體/效能欄位往上帶。
  events.emit('result', { trackId: job.trackId, jobId: job.publicJobId || job.jobId, ...hw });
  return { ok: true };
}

function handleError(socket, payload) {
  if (!engineSocket || socket.id !== engineSocket.id || !activeJob) return;
  if (!payload || payload.jobId !== activeJob.jobId) return;
  const job = activeJob;
  activeJob = null;
  disarmWatchdog();
  log.warn(`WebGPU 分離失敗 track=${job.trackId}: ${payload.message || payload.code}`);
  if (!job.deferFailure) {
    applyResult(job.trackId, { separationStatus: 'failed' });
    deps?.io.emit('separation:progress', {
      trackId: job.trackId, jobId: job.publicJobId || job.jobId, stage: 'error', progress: 0,
      error: payload.code || 'UNKNOWN', errorMessage: payload.message || null,
    });
  }
  events.emit('error', {
    trackId: job.trackId, jobId: job.publicJobId || job.jobId,
    code: payload.code || 'unknown', message: payload.message || null,
    gpuVendor: payload.gpuVendor, audioSeconds: payload.audioSeconds,
  });
}

/** device lost 是已知、獨立記錄的失敗代碼（見規劃：canary 探測 + 全程監聽 device.lost）。 */
function handleDeviceLost(socket, payload) {
  handleError(socket, { ...payload, code: 'device_lost' });
}

/**
 * 協調器（ai-separation-jobs.js）發起的取消：讓引擎在下個 chunk 前收手、清掉自己的
 * activeJob 與 watchdog。**不**發 events 'error'／'result'——收尾（狀態、進度事件、
 * 佇列推進）全由協調器做，這裡只負責讓 WebGPU 這條路停下來。
 */
function cancelJob(publicJobId) {
  if (!activeJob || (activeJob.publicJobId || activeJob.jobId) !== publicJobId) return { ok: false };
  const job = activeJob;
  activeJob = null;
  disarmWatchdog();
  try { engineSocket?.emit('webgpu:job:cancel', { jobId: job.jobId }); } catch (_) { /* 最佳努力 */ }
  log.info(`WebGPU 分離已被取消 track=${job.trackId}`);
  return { ok: true };
}

function _resetForTests() {
  deps = null;
  wired = false;
  engineSocket = null;
  activeJob = null;
  restartRequestedAt = 0;
  disarmWatchdog();
}

module.exports = {
  wireDependencies,
  startJobForTrack,
  getActiveJobId,
  events,
  isEngineAvailable,
  getRestartRequestedAt,
  handleEngineConnected,
  handleEngineDisconnected,
  handleProgress,
  finishJobWithResult,
  handleError,
  handleDeviceLost,
  cancelJob,
  _resetForTests,
};
