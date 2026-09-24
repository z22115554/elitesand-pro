/**
 * 歌曲段落分析（SongFormer，實驗性）面板端控制。
 *
 * V1 範圍刻意很窄：一顆按鈕分析「目前載入的歌」、顯示進度、完成後列出原始段落
 * JSON（不做人工校正 UI，見 velvet-snuggling-pancake 規劃）。這個 view 目前還被
 * index.html 的 `hidden` nav-item 藏著，不是正式對外功能。
 *
 * 跟 ai-separation-client.js 同樣的 socket 進度事件模式，但簡化很多——沒有
 * WebGPU 預熱、沒有 ffmpeg 前置檢查、沒有安裝彈窗，只有一條 inline 的下載進度列。
 */
(() => {
  'use strict';

  if (typeof SocketClient === 'undefined') return;

  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);

  const dom = {};
  function bindDom() {
    dom.trackLabel = document.getElementById('section-analysis-current-track');
    dom.runBtn = document.getElementById('section-analysis-run-btn');
    dom.cancelBtn = document.getElementById('section-analysis-cancel-btn');
    dom.progress = document.getElementById('section-analysis-progress');
    dom.stage = document.getElementById('section-analysis-stage');
    dom.percent = document.getElementById('section-analysis-percent');
    dom.fill = dom.progress ? dom.progress.querySelector('.ai-install-progress-track span') : null;
    dom.result = document.getElementById('section-analysis-result');
    return !!(dom.trackLabel && dom.runBtn && dom.cancelBtn && dom.progress && dom.result);
  }

  let currentJob = null; // { trackId, stage, percent } — 目前這台面板自己觸發的那個 job

  function normalizePercent(value, stage) {
    if (stage === 'done') return 100;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(100, n <= 1 ? n * 100 : n))) : 0;
  }

  function stageText(stage) {
    if (stage === 'queued') return t('aiJob.queued');
    if (stage === 'preparing') return t('sections.preparing');
    if (stage === 'load') return t('aiJob.preparing');
    if (stage === 'inference') return t('sections.runButton');
    return t('sections.preparing');
  }

  function getCurrentTrack() {
    // 注意：目前歌曲是 window.VKState.getCurrentTrack()，不是 AppShared——VKState 是
    // app.js 對外暴露當前歌曲用的舊代號全域（給 lyric-extras.js 這類消費端用），
    // 2026-09-22 這裡原本寫錯成 AppShared，導致這個按鈕永遠讀不到目前歌曲。
    return (window.VKState && typeof window.VKState.getCurrentTrack === 'function')
      ? window.VKState.getCurrentTrack() : null;
  }

  // preserveResult=true：只重置按鈕/進度條狀態，不動 dom.result 的文字——用在「呼叫端
  // 剛塞了一則明確的錯誤訊息進去，不想被這裡的預設邏輯蓋掉」的情境（見 runAnalysis()）。
  function renderIdle(preserveResult) {
    const track = getCurrentTrack();
    dom.progress.hidden = true;
    dom.cancelBtn.hidden = true;
    dom.runBtn.hidden = false;
    if (!track) {
      dom.trackLabel.textContent = t('sections.noCurrentTrack');
      dom.runBtn.disabled = true;
      if (!preserveResult) dom.result.textContent = '';
      return;
    }
    dom.trackLabel.textContent = t('sections.currentTrackLabel', { title: track.title || track.id });
    dom.runBtn.disabled = false;
    const status = track.sectionsStatus;
    dom.runBtn.textContent = (status === 'done' || status === 'failed') ? t('sections.reanalyzeButton') : t('sections.runButton');
    if (preserveResult) return;
    if (status === 'done' && Array.isArray(track.sections)) {
      dom.result.textContent = t('sections.doneCount', { count: track.sections.length });
    } else if (status === 'failed') {
      dom.result.textContent = t('aiJob.error');
    } else {
      dom.result.textContent = '';
    }
  }

  function renderProgress(state) {
    dom.progress.hidden = false;
    dom.runBtn.hidden = true;
    dom.cancelBtn.hidden = false;
    dom.cancelBtn.disabled = false;
    dom.stage.textContent = stageText(state.stage);
    dom.percent.textContent = `${state.percent}%`;
    if (dom.fill) dom.fill.style.setProperty('--work-progress', `${state.percent}%`);
  }

  function ingest(payload) {
    if (!payload || payload.trackId === undefined || payload.trackId === null) return;
    const trackId = String(payload.trackId);
    if (!currentJob || currentJob.trackId !== trackId) {
      // 不是這台面板剛觸發的那個 job（例如另一台面板、或重連後補的孤兒事件）——
      // 只要目前顯示的正是這首歌就更新畫面，不然忽略。
      const track = getCurrentTrack();
      if (!track || String(track.id) !== trackId) return;
    }
    if (payload.stage === 'cancelled' || payload.stage === 'error') {
      currentJob = null;
      if (payload.stage === 'error') {
        const code = payload.error;
        dom.result.textContent = code === 'PROVIDER_UNAVAILABLE' || code === 'ENGINE_UNAVAILABLE'
          ? t('sections.needsCuda')
          : code === 'GPU_BUSY' ? t('sections.gpuBusy') : (payload.errorMessage || t('aiJob.error'));
      }
      renderIdle();
      return;
    }
    if (payload.stage === 'done') {
      currentJob = null;
      renderIdle();
      return;
    }
    currentJob = { trackId, stage: payload.stage, percent: normalizePercent(payload.progress, payload.stage) };
    renderProgress(currentJob);
  }

  SocketClient.on('sections:progress', ingest);

  // runtime 下載期間（實測約 2.7GB，可能要好幾分鐘）在背景輪詢真正的階段/百分比，
  // 不然畫面只會停在「準備中…」看起來像當機——這是使用者第一次實機測試就踩到的體感問題。
  function pollRuntimeDownload() {
    let timer = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const poll = async () => {
      try {
        const res = await fetch('/api/section-analysis/runtime-status', { cache: 'no-store' });
        const status = await res.json().catch(() => ({}));
        if (status.error) { dom.result.textContent = status.error; return; }
        const step = status.step || status.stage || '';
        const bytes = (status.totalBytes && status.downloadedBytes != null)
          ? ` ${Math.round(status.downloadedBytes / 1e6)}MB / ${Math.round(status.totalBytes / 1e6)}MB` : '';
        dom.result.textContent = `${t('sections.preparing')}${step ? ' — ' + step : ''}${bytes}`;
      } catch (_) { /* 下一輪再試 */ }
    };
    timer = setInterval(poll, 1000);
    poll();
    return stop;
  }

  async function runAnalysis() {
    const track = getCurrentTrack();
    if (!track) return;
    dom.runBtn.disabled = true;
    try {
      const res = await PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(track.id)}/analyze-sections`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        if (body.error === 'RUNTIME_NOT_READY') {
          dom.result.textContent = t('sections.preparing');
          const stopPolling = pollRuntimeDownload();
          let downloadRes;
          let downloadBody;
          try {
            downloadRes = await PinAuth.fetchWithPin('/api/section-analysis/runtime/download', { method: 'POST' });
            downloadBody = await downloadRes.json().catch(() => ({}));
          } finally {
            stopPolling();
          }
          if (downloadRes.ok && downloadBody.ok) {
            return runAnalysis(); // runtime 裝好了，重新觸發一次分析
          }
          // 下載本身失敗：顯示真正的原因（server 端 reason），不要留著上一輪的
          // RUNTIME_NOT_READY 字樣——那只是「還沒裝」，不是「裝失敗的原因」。
          dom.result.textContent = downloadBody?.reason || t('aiJob.error');
          renderIdle(true);
          return;
        }
        dom.result.textContent = body.error || t('aiJob.error');
        renderIdle(true);
        return;
      }
      currentJob = { trackId: String(track.id), stage: 'preparing', percent: 0 };
      renderProgress(currentJob);
    } catch (_) {
      dom.result.textContent = t('aiJob.error');
      renderIdle(true);
    }
  }

  async function cancelAnalysis() {
    const track = getCurrentTrack();
    if (!track) return;
    dom.cancelBtn.disabled = true;
    try {
      await PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(track.id)}/analyze-sections/cancel`, { method: 'POST' });
    } catch (_) { /* server 廣播 cancelled 時 ingest() 會收尾，這裡失敗也不用額外處理 */ }
  }

  function init() {
    if (!bindDom()) return;
    dom.runBtn.addEventListener('click', runAnalysis);
    dom.cancelBtn.addEventListener('click', cancelAnalysis);
    document.addEventListener('view:change', (event) => {
      if (event.detail?.view === 'sections' && !currentJob) renderIdle();
    });
    // 原本只在切到「段落設計」分頁時重畫一次——如果使用者先切過去（那時還沒載入歌），
    // 之後才在別的分頁載入/切歌，這裡的按鈕會停留在舊的 disabled 狀態，按了沒反應
    // （2026-09-22 使用者實測回報）。state:sync 幾乎在每次播放狀態變化都會廣播，
    // 包含換歌，訂閱它才能讓按鈕狀態跟著目前歌曲即時更新。
    if (typeof SocketClient !== 'undefined' && SocketClient.on) {
      // setTimeout(…,0)：這支腳本比 app.js 早載入，若 state:sync 的訂閱順序剛好排在
      // app.js 前面，這裡會在 app.js 真正更新 playlist/currentTrackIndex 之前就先讀到
      // 舊值。延後一個 tick，保證同一輪 state:sync 的所有同步訂閱者（含 app.js）都跑完
      // 才讀 VKState.getCurrentTrack()。
      SocketClient.on('state:sync', () => { if (!currentJob) setTimeout(renderIdle, 0); });
    }
    if (!currentJob) renderIdle();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
