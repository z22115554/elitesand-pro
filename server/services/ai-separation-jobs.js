'use strict';

/**
 * AI 人聲分離 job 生命週期的「黏著層」：
 * - `startJobForTrack()` 給 API 路由呼叫，記住 jobId → trackId 的對應，觸發真正的分離。
 * - 監聽 supervisor 的 progress/result/error，轉播成 Socket.io 事件（鐵則 1：新事件走
 *   SocketClient.on，不碰白名單），完成/失敗時把結果寫回 playState.playlist（鐵則 17：
 *   vocalsFile/instrumentalFile/separationStatus 會出現在 enrichedPlaylist，必須寫回
 *   playState.playlist 本身，不能只更新暫存物件），同步進媒體庫，一次 broadcastState。
 *
 * 跟 `loudness-backfill.js` 同一個「寫回 playState + currentTrack 快照 + updateLibraryMeta
 * + persistState + broadcastState」手法，差別是這裡是事件驅動（監聽 emitter），不是輪詢。
 *
 * `wireDependencies()` 只能呼叫一次（在 socket-handler.js 裡，playState/persistState/
 * broadcastState 都在那個作用域才拿得到），呼叫之前 `startJobForTrack()` 會丟錯——
 * 跟 `library-store.js` 的 `setErrorReporter()`／`lyrics-engine.js` 的 `setIo()` 同一個
 *「模組級可變依賴，啟動時注入一次」慣例。
 */
const path = require('path');
const { createLogger } = require('../utils/logger');
const { supervisor } = require('./ai-separation');
const libraryStore = require('./library-store');
const { emitToControlClients } = require('../utils/socket-broadcast');

const log = createLogger('AISeparationJobs');

let deps = null; // { io, playState, persistState, broadcastState, updateLibraryMeta }
const jobTrackMap = new Map(); // jobId -> trackId
// supervisor.py 一次只跑一個 active job（鐵則 #12 同一套理由：GPU/CPU 一次分離一份，
// 併發會 OOM/搶資源）。以前第二首分離請求會直接被 Python 端擋下回 BUSY error，UI 上
// 看起來像「按了沒反應/直接失敗」。2026-08-23 改成 Node 端排隊：目前這首完成/失敗時
// 自動接上排隊的下一首，不用使用者自己重試。
const queue = []; // { trackId, params }，等待中、還沒真的送給 supervisor 的請求
let activeTrackId = null; // 目前「真的」在跑（已送進 supervisor）的那首歌，null＝目前沒有
let wired = false;

function findTrack(playState, trackId) {
  return (playState.playlist || []).find((t) => t && String(t.id) === String(trackId));
}

function applyResult(trackId, patch) {
  if (!deps) return;
  const { playState, persistState, broadcastState, updateLibraryMeta } = deps;
  const track = findTrack(playState, trackId);
  if (track) {
    Object.assign(track, patch);
    // currentTrack 可能是同 id 的另一份快照（播放時複製），要一起補上（跟 loudness-backfill 同理）。
    if (playState.currentTrack && String(playState.currentTrack.id) === String(trackId)) {
      Object.assign(playState.currentTrack, patch);
    }
  }
  updateLibraryMeta(trackId, patch);
  persistState();
  broadcastState();
  // media-library.js 的媒體庫清單是獨立於 playState 的另一份前端快取（見
  // public/js/media-library.js 的 cache），broadcastState 不會更新到它——
  // 沿用 server/routes/handlers/library.js 既有的 library:list 廣播慣例，
  // 不然「已分離」狀態跟試聽按鈕要重新整理頁面才會出現。
  emitToControlClients(deps.io, 'library:list', libraryStore.getLibrary());
}

function wireDependencies({ io, playState, persistState, broadcastState, updateLibraryMeta = () => {} }) {
  if (wired) return; // 避免 socket-handler 重複建立時重複掛監聽（測試環境可能會 new 多次 ctx）
  deps = { io, playState, persistState, broadcastState, updateLibraryMeta };
  wired = true;

  supervisor.emitter.on('progress', (msg) => {
    const trackId = jobTrackMap.get(msg.id);
    if (!trackId) return; // 不是這支模組發起的 job（理論上不會發生，防呆）
    io.emit('separation:progress', { trackId, jobId: msg.id, stage: msg.stage, progress: msg.progress });
  });

  supervisor.emitter.on('result', (msg) => {
    const trackId = jobTrackMap.get(msg.id);
    jobTrackMap.delete(msg.id);
    if (!trackId) return;
    // worker.py 回傳的是絕對路徑（outputDir 拼出來的），且 outputDir 呼叫端必須傳
    // downloadsDir 本身（/audio/:filename 只認 downloadsDir 直接底下的檔名，見
    // server/index.js 的 /audio 路由），這裡只取 basename 存進 schema。
    const result = msg.result || {};
    applyResult(trackId, {
      vocalsFile: result.vocal ? path.basename(result.vocal) : null,
      instrumentalFile: result.instrumental ? path.basename(result.instrumental) : null,
      separationStatus: (result.vocal || result.instrumental) ? 'done' : 'failed',
    });
    io.emit('separation:progress', { trackId, jobId: msg.id, stage: 'done', progress: 100 });
    advanceQueue();
  });

  supervisor.emitter.on('error', (msg) => {
    const trackId = jobTrackMap.get(msg.id);
    jobTrackMap.delete(msg.id);
    if (!trackId) return;
    log.warn(`分離失敗 track=${trackId} job=${msg.id}: ${msg.error && msg.error.message}`);
    applyResult(trackId, { separationStatus: 'failed' });
    io.emit('separation:progress', {
      trackId, jobId: msg.id, stage: 'error', progress: 0,
      error: (msg.error && msg.error.code) || 'UNKNOWN',
      // 之前只傳 code，把 supervisor.py／worker.py 包起來的實際錯誤訊息吞掉了——
      // 除錯只能翻 server 終端機才看得到，太不方便，一併送給前端顯示。
      errorMessage: (msg.error && msg.error.message) || null,
    });
    advanceQueue();
  });
}

/** 真的把一個 job 送進 supervisor（不經過佇列）。 */
function dispatch(trackId, params) {
  activeTrackId = trackId;
  const jobId = supervisor.separateWithFallback(params);
  jobTrackMap.set(jobId, trackId);
  return jobId;
}

/** 目前這首分離完成／失敗後呼叫：接上排隊的下一首（沒有排隊就什麼都不做）。 */
function advanceQueue() {
  activeTrackId = null;
  if (!queue.length) return;
  const next = queue.shift();
  const jobId = dispatch(next.trackId, next.params);
  // 排隊的下一首正式開始跑了，通知前端從「排隊中」換成看得到進度的「分離中」。
  if (deps) deps.io.emit('separation:progress', { trackId: next.trackId, jobId, stage: 'load', progress: 0 });
}

/**
 * API 路由呼叫這個啟動分離。目前沒有其他 job 在跑就直接送出，回傳 jobId；
 * 已經有一首在跑就排進佇列，回傳 null（呼叫端據此判斷是否要顯示「排隊中」）。
 */
function startJobForTrack(trackId, params) {
  if (!wired) throw new Error('ai-separation-jobs not wired yet (call wireDependencies first)');
  if (activeTrackId !== null) {
    queue.push({ trackId, params });
    deps.io.emit('separation:progress', { trackId, jobId: null, stage: 'queued', progress: 0, queuePosition: queue.length });
    return null;
  }
  return dispatch(trackId, params);
}

function _resetForTests() {
  deps = null;
  wired = false;
  jobTrackMap.clear();
  queue.length = 0;
  activeTrackId = null;
}

module.exports = { wireDependencies, startJobForTrack, _resetForTests };
