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
  // runtime（~2.7GB）下載中。這段期間 state:sync／切分頁都不可以 renderIdle()——以前會把
  // 「分析段落」按鈕重新啟用，使用者再按一次就多開一條輪詢、第二次請求還回 409。
  let downloading = false;
  const canRenderIdle = () => !currentJob && !downloading;

  function normalizePercent(value, stage) {
    if (stage === 'done') return 100;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(100, n <= 1 ? n * 100 : n))) : 0;
  }

  function stageText(stage) {
    if (stage === 'queued') return t('aiJob.queued');
    if (stage === 'preparing') return t('sections.preparing');
    if (stage === 'load') return t('sections.stage.load');
    if (stage === 'inference') return t('sections.stage.inference');
    return t('sections.preparing');
  }

  // 分析本身（載入模型→推論）Python 端只回報「換階段」，沒有百分比。為了不讓進度條停在 0%，
  // 各階段依經過時間緩慢往上爬（指數趨近、不會碰到上限），真的換階段時跳到下一段的起點。
  // 實測（RTX 3060）：第一次載入模型約 30 秒、之後推論約 10 秒。
  const JOB_BANDS = { queued: [0, 0, 1], preparing: [2, 8, 6], load: [8, 48, 20], inference: [50, 96, 10] };
  function jobPercent(job) {
    const band = JOB_BANDS[job.stage];
    if (!band) return job.percent || 0;
    const [lo, hi, tau] = band;
    const elapsed = (performance.now() - job.stageAt) / 1000;
    return Math.round(lo + (hi - lo) * (1 - Math.exp(-elapsed / tau)));
  }
  let creepTimer = null;
  function syncCreep() {
    const need = !!currentJob && !!JOB_BANDS[currentJob.stage];
    if (need && !creepTimer) creepTimer = setInterval(() => { if (currentJob) renderProgress(currentJob); }, 500);
    if (!need && creepTimer) { clearInterval(creepTimer); creepTimer = null; }
  }

  // ─── runtime 下載進度（約 2.7GB，只需一次）───

  function fmtBytes(b) {
    if (b == null || !Number.isFinite(b)) return '';
    return b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
  }
  function fmtElapsed(ms) {
    const total = Math.floor(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }
  // 用伺服器時鐘算經過時間（手機等其他裝置的時鐘可能不準）
  function stepElapsedMs(status) {
    const startedAt = Number(status.stepStartedAt);
    const now = Number(status.serverNow);
    return Number.isFinite(startedAt) && Number.isFinite(now) && startedAt > 0 ? Math.max(0, now - startedAt) : 0;
  }
  // 沒有進度訊號的步驟超過這個時間就明講「可能很久、不是當機」（Win11＋防毒即時掃描時
  // 解壓 PyTorch 可達十幾分鐘，AI 伴奏安裝的實機回報）
  const SLOW_STEP_MS = 8 * 60 * 1000;

  function downloadStageText(status) {
    const s = status || {};
    const bytes = (s.totalBytes > 0 && s.downloadedBytes != null)
      ? `${fmtBytes(s.downloadedBytes)} / ${fmtBytes(s.totalBytes)}` : '';
    const elapsedMs = stepElapsedMs(s);
    const elapsed = fmtElapsed(elapsedMs);
    switch (s.stage) {
      case 'disk-space-check': return t('sections.install.diskCheck');
      case 'download-python': return t('sections.install.downloadPython', { detail: bytes });
      case 'extract-python': return t('sections.install.extractPython');
      case 'bootstrap-pip': return t('sections.install.bootstrapPip');
      case 'install-packages':
        if (s.step === 'pip-download') return t('sections.install.pipDownload', { name: s.detail || '', detail: bytes });
        if (s.step === 'pip-install') {
          return t(elapsedMs >= SLOW_STEP_MS ? 'sections.install.pipInstallSlow' : 'sections.install.pipInstall', { elapsed });
        }
        return t('sections.install.pipResolve', { name: s.detail || '' });
      case 'download-source': return t('sections.install.downloadSource', { name: s.detail || '', detail: bytes });
      case 'install-python': return t('sections.install.installPython');
      case 'install-muq-package': return t('sections.install.installMuq', { elapsed });
      case 'download-muq-backbone': return t('sections.install.downloadBackbone', { detail: bytes || elapsed });
      case 'download-weights': return t('sections.install.downloadWeights', { detail: bytes || elapsed });
      case 'verify-weights': return t('sections.install.verifyWeights');
      case 'done': return t('sections.install.done');
      default: return t('sections.preparing');
    }
  }

  function renderDownload(status) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(status && status.overallPercent) || 0)));
    dom.progress.hidden = false;
    dom.runBtn.hidden = true;
    dom.cancelBtn.hidden = true; // 下載中沒有取消（伺服器端不支援中途停止這條安裝）
    dom.stage.textContent = downloadStageText(status);
    dom.percent.textContent = `${pct}%`;
    if (dom.fill) dom.fill.style.setProperty('--work-progress', `${pct}%`);
    dom.result.textContent = t('sections.install.note');
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
    const pct = jobPercent(state);
    dom.progress.hidden = false;
    dom.runBtn.hidden = true;
    dom.cancelBtn.hidden = false;
    dom.stage.textContent = stageText(state.stage);
    dom.percent.textContent = `${pct}%`;
    if (dom.fill) dom.fill.style.setProperty('--work-progress', `${pct}%`);
  }

  function ingest(payload) {
    if (!payload || payload.trackId === undefined || payload.trackId === null) return;
    const trackId = String(payload.trackId);
    if (downloading) return;
    if (!currentJob || currentJob.trackId !== trackId) {
      // 不是這台面板剛觸發的那個 job（例如另一台面板、或重連後補的孤兒事件）——
      // 只要目前顯示的正是這首歌就更新畫面，不然忽略。
      const track = getCurrentTrack();
      if (!track || String(track.id) !== trackId) return;
    }
    if (payload.stage === 'cancelled' || payload.stage === 'error') {
      currentJob = null;
      syncCreep();
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
      syncCreep();
      renderIdle();
      return;
    }
    const sameStage = currentJob && currentJob.trackId === trackId && currentJob.stage === payload.stage;
    currentJob = {
      trackId,
      stage: payload.stage,
      percent: normalizePercent(payload.progress, payload.stage),
      stageAt: sameStage ? currentJob.stageAt : performance.now(),
    };
    dom.cancelBtn.disabled = false;
    renderProgress(currentJob);
    syncCreep();
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
        // 失敗訊息交給 runAnalysis() 在下載請求回來時顯示；輪詢只負責畫進度
        if (status.stage === 'error') return;
        renderDownload(status);
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
          downloading = true;
          renderDownload({ stage: 'disk-space-check', overallPercent: 0 });
          const stopPolling = pollRuntimeDownload();
          let downloadRes;
          let downloadBody;
          try {
            downloadRes = await PinAuth.fetchWithPin('/api/section-analysis/runtime/download', { method: 'POST' });
            downloadBody = await downloadRes.json().catch(() => ({}));
          } finally {
            stopPolling();
            downloading = false;
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
      if (event.detail?.view === 'sections' && canRenderIdle()) renderIdle();
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
      SocketClient.on('state:sync', () => { setTimeout(() => { if (canRenderIdle()) renderIdle(); }, 0); });
    }
    if (canRenderIdle()) renderIdle();
    resumeRuntimeDownloadWatch();
  }

  // 重新整理頁面／另一台面板觸發的下載還在背景跑：接回進度顯示，並把按鈕鎖住直到下載結束，
  // 不然使用者看到可按的按鈕、按下去又觸發一次（server 端雖然會併進同一個下載，但畫面會亂）。
  async function resumeRuntimeDownloadWatch() {
    let status;
    try {
      const res = await fetch('/api/section-analysis/runtime-status', { cache: 'no-store' });
      status = await res.json();
    } catch (_) { return; }
    if (!status || !status.active || downloading) return;
    downloading = true;
    dom.runBtn.disabled = true;
    const stopPolling = pollRuntimeDownload();
    const waitDone = setInterval(async () => {
      try {
        const res = await fetch('/api/section-analysis/runtime-status', { cache: 'no-store' });
        const next = await res.json();
        if (next.active) return;
      } catch (_) { return; }
      clearInterval(waitDone);
      stopPolling();
      downloading = false;
      renderIdle();
    }, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
