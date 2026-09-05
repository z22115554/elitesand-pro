(() => {
  'use strict';

  const states = new Map();
  const subscribers = new Set();
  let ensurePromise = null;
  // WebGPU 隱藏引擎預熱一次就好：以前每個呼叫端（含每 500ms 的安裝輪詢）都各起一輪
  // 20 次的連線等待，setEnabled() 若卡住就整批堆疊、把 /api/webgpu-separation/settings
  // 打爆，安裝視窗也因為 await 卡在預熱前而永遠關不掉。
  let webgpuWarmInFlight = null;

  const t = (key, vars) => window.I18n ? window.I18n.t(key, vars) : key;

  function normalizePercent(value, stage) {
    if (stage === 'done') return 100;
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(Math.max(0, Math.min(100, number <= 1 ? number * 100 : number)));
  }

  function labelKey(stage, error) {
    if (stage === 'queued') return 'aiJob.queued';
    if (stage === 'preparing' || stage === 'load') return 'aiJob.preparing';
    if (stage === 'fallback-webgpu' || stage === 'canary') return 'aiJob.webgpuFallback';
    if (stage === 'fallback-cpu') return 'aiJob.cpuFallback';
    if (stage === 'download-model') return 'aiJob.preparingModel';
    if (stage === 'download-audio' || stage === 'decode') return 'aiJob.preparingAudio';
    if (stage === 'done') return 'aiJob.done';
    // 引擎根本起不來（例如打包版缺了 Python sidecar）跟「這首歌分離失敗」是兩件事，
    // 使用者要能分辨「重試沒有意義、該重裝」。
    if (stage === 'error') return error === 'ENGINE_UNAVAILABLE' ? 'aiJob.engineUnavailable' : 'aiJob.error';
    if (stage === 'cancelled') return 'aiJob.cancelled';
    return 'aiJob.separating';
  }

  function ingest(payload) {
    if (!payload || payload.trackId === undefined || payload.trackId === null) return null;
    const trackId = String(payload.trackId);
    // 取消：清掉即時狀態，讓按鈕翻回「製作 AI 伴奏」，並通知訂閱者重畫。
    if (payload.stage === 'cancelled') {
      states.delete(trackId);
      subscribers.forEach((subscriber) => subscriber({ trackId, stage: 'cancelled', percent: 0 }));
      return null;
    }
    const state = {
      trackId,
      jobId: payload.jobId || states.get(trackId)?.jobId || null,
      stage: payload.stage || 'preparing',
      percent: normalizePercent(payload.progress, payload.stage),
      queuePosition: Number(payload.queuePosition) || 0,
      error: payload.error || null,
      errorMessage: payload.errorMessage || null,
      updatedAt: Date.now(),
    };
    state.labelKey = labelKey(state.stage, state.error);
    states.set(trackId, state);
    subscribers.forEach((subscriber) => subscriber(state));
    return state;
  }

  SocketClient.on('separation:progress', ingest);

  function subscribe(subscriber, { replay = true } = {}) {
    subscribers.add(subscriber);
    if (replay) states.forEach((state) => subscriber(state));
    return () => subscribers.delete(subscriber);
  }

  async function getBundleStatus() {
    const response = await fetch('/api/ai-separation/bundle-status', { cache: 'no-store' });
    if (!response.ok) throw new Error(t('aiInstall.statusFailed'));
    const status = await response.json();
    (status.jobs || []).forEach(ingest);
    return status;
  }

  function enableWebgpuFallback() {
    if (webgpuWarmInFlight) return webgpuWarmInFlight;
    if (!window.ElitesandShell?.webgpuEngine) return Promise.resolve();
    webgpuWarmInFlight = (async () => {
      try {
        await PinAuth.fetchWithPin('/api/webgpu-separation/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        });
        // setEnabled() 偶爾會很久才 resolve（隱藏視窗冷啟）；給它硬性上限，別無限等。
        await Promise.race([
          window.ElitesandShell.webgpuEngine.setEnabled(true),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]);
        // Socket.io 握手可能還沒完成；短暫等 server 看見引擎（總計 ≤5s），逾時就交給
        // 協調器——它偵測到未連線會安全落到 CPU，不阻擋主要動作。
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const status = await getBundleStatus().catch(() => null);
          if (status && status.webgpuEngineConnected) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (_) {
        // WebGPU 是中間備援；啟動失敗時協調器仍會安全走最後的 CPU。
      } finally {
        webgpuWarmInFlight = null;
      }
    })();
    return webgpuWarmInFlight;
  }

  function fmtBytes(b) {
    if (b == null || !Number.isFinite(b)) return '';
    return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
  }

  // 細階段文字：phase（python / primary-model / webgpu-model）+ step + 位元組進度。
  function installStageText(status) {
    const s = status || {};
    const phase = s.phase || (String(s.stage || '').split(':')[0]) || 'preparing';
    const step = s.step || String(s.stage || '').split(':')[1] || '';
    const bytes = (s.totalBytes && s.downloadedBytes != null)
      ? `${fmtBytes(s.downloadedBytes)} / ${fmtBytes(s.totalBytes)}`
      : '';
    const detail = bytes || s.detail || '';

    if (phase === 'done') return t('aiInstall.stageDone');
    if (phase === 'error') return s.error || t('aiInstall.failed');
    if (phase === 'ffmpeg') return t('aiInstall.step.ffmpeg');
    if (phase === 'python') {
      if (step === 'pip-download') return t('aiInstall.step.pipDownload', { detail });
      if (step === 'pip-install') return t('aiInstall.step.pipInstall');
      if (step === 'pip-resolve') return t('aiInstall.step.pipResolve');
      if (step === 'download-python') return t('aiInstall.step.downloadPython', { detail });
      if (step === 'extract') return t('aiInstall.step.extract');
      if (step === 'verify-python' || step === 'verify') return t('aiInstall.step.verify');
      if (step === 'bootstrap-pip') return t('aiInstall.step.bootstrapPip');
      return t('aiInstall.step.pythonPrep');
    }
    if (phase === 'primary-model') return t('aiInstall.step.primaryModel', { detail });
    if (phase === 'webgpu-model') {
      const n = (Number(s.fileIndex) || 0) + 1;
      const c = Number(s.fileCount) || 2;
      return t('aiInstall.step.webgpuModel', { detail, n, c });
    }
    return t('aiInstall.stagePreparing');
  }

  function openInstallModal(initialStatus) {
    const modal = document.getElementById('ai-separation-install-modal');
    const cancel = document.getElementById('ai-separation-install-cancel');
    const confirm = document.getElementById('ai-separation-install-confirm');
    const progress = document.getElementById('ai-separation-install-progress');
    const stageEl = document.getElementById('ai-separation-install-stage');
    const percentEl = document.getElementById('ai-separation-install-percent');
    const fill = progress?.querySelector('.ai-install-progress-track span');
    if (!modal || !cancel || !confirm || !progress || !stageEl || !percentEl || !fill) return Promise.resolve(false);

    return new Promise((resolve) => {
      let polling = null;
      let started = !!initialStatus?.active;
      let settled = false;
      // 伺服器端這輪安裝已經跑完（成功／失敗／完成但元件不齊都算）。一旦為真，
      // 就算 started 也一定要讓使用者能關掉視窗——背景 state 不會因為關視窗而丟。
      let runSettled = false;
      // pip 解壓 torch（~2.5 GB）沒有位元組訊號，是整條流程最容易看起來「卡住」的一段。
      // 伺服器把它固定回報在 python band 的尾端；這裡讓顯示值隨時間輕微往上爬（不超過該
      // band 上限 76%），一旦下個相位真的推進就交還給真實進度。
      let pipCreepStart = 0;

      const close = (value) => {
        if (settled) return;
        settled = true;
        if (polling) clearInterval(polling);
        modal.hidden = true;
        resolve(value);
      };
      const paint = (status) => {
        const s = status || {};
        let percent = normalizePercent(s.overallPercent ?? s.percent, s.phase === 'done' ? 'done' : s.stage);
        if (s.step === 'pip-install') {
          if (!pipCreepStart) pipCreepStart = Date.now();
          percent = Math.min(76, Math.max(percent, percent + Math.floor((Date.now() - pipCreepStart) / 2500)));
        } else {
          pipCreepStart = 0;
        }
        stageEl.textContent = installStageText(s);
        percentEl.textContent = `${percent}%`;
        fill.style.setProperty('--work-progress', `${percent}%`);
      };
      const setDownloading = () => {
        started = true;
        progress.hidden = false;
        // 這輪一旦結算過（含「完成但不齊」），重試期間也保留一個出口，別再把使用者關死。
        cancel.disabled = !runSettled;
        confirm.disabled = true;
        confirm.textContent = t('aiInstall.downloading');
      };
      let pollBusy = false;
      const poll = async () => {
        if (pollBusy) return; // 輪詢每 500ms 觸發一次；上一輪還沒跑完就跳過，避免堆疊
        pollBusy = true;
        try {
          const status = await getBundleStatus();
          paint(status);
          const runOver = !status.active
            && (status.phase === 'done' || status.stage === 'done'
              || Number(status.overallPercent ?? status.percent) >= 100);
          if (status.available && !status.active) {
            // WebGPU 備援模型下載失敗不擋安裝（server 的 downloadBundle 會照常完成），
            // 但也不能悄悄帶過——使用者要知道少了哪條路、以及還能重試。
            if (status.webgpuUnavailable) window.AppShared?.showToast?.(t('aiInstall.webgpuSkipped'), 'info');
            // 先關視窗再背景預熱 WebGPU：預熱動輒十幾秒、偶爾會卡住，await 在 close 前面
            // 會讓「元件其實都好了」的視窗永遠關不掉（實測 test2 就是卡在這）。
            close(true);
            enableWebgpuFallback();
            return;
          } else if (status.stage === 'error') {
            if (polling) { clearInterval(polling); polling = null; }
            runSettled = true;
            started = false;
            cancel.disabled = false;
            confirm.disabled = false;
            confirm.textContent = t('aiInstall.retry');
            stageEl.textContent = status.error || t('aiInstall.failed');
          } else if (runOver && !status.available) {
            // 下載整條跑完了，但 isAvailable() 仍為 false（實測最常見：FFmpeg 不在
            // 這個行程的 PATH 上、也沒下載到 dataDir\bin）。不能無限輪詢把使用者關在
            // 這個視窗裡——停掉輪詢、放開取消／重試，把缺的講清楚。
            if (polling) { clearInterval(polling); polling = null; }
            runSettled = true;
            started = false;
            cancel.disabled = false;
            confirm.disabled = false;
            confirm.textContent = t('aiInstall.retry');
            stageEl.textContent = t('aiInstall.incomplete');
          }
        } catch (_) { /* 下一輪輪詢再試；真正失敗會由 POST 回應顯示 */ }
        finally { pollBusy = false; }
      };
      // FFmpeg 不在那 7.3 GB 裡，但 Python 引擎的 audio-separator 在 Separator() 建構子
      // 就會檢查它，缺了它連「只下載模型」都會失敗（server/services/ai-runtime-provider.js）。
      // 伺服器端 downloadBundle() 有硬性前置關卡；這裡在同一個流程裡先補齊，讓使用者
      // 不必中斷安裝跑去設定頁找「下載 FFmpeg」。
      const ensureFfmpeg = async () => {
        const status = await getBundleStatus().catch(() => null);
        // 只有「明確查到 ffmpeg 在」才略過。狀態讀失敗（null）或回應裡沒有 components
        // 都當成「不確定」→ 照樣跑一次下載：POST /api/ffmpeg/download 對已存在的 ffmpeg
        // 會直接回 ok（冪等），代價小；漏跑的代價是整個 bundle 裝完仍缺 ffmpeg → 卡住。
        if (status && status.components && status.components.ffmpeg === true) return;
        const paintFfmpeg = (s) => {
          const percent = Math.max(0, Math.min(100, Math.round(Number(s?.percent) || 0)));
          stageEl.textContent = installStageText({ phase: 'ffmpeg' });
          percentEl.textContent = `${percent}%`;
          fill.style.setProperty('--work-progress', `${percent}%`);
        };
        paintFfmpeg(null);
        const ffmpegPolling = setInterval(() => {
          fetch('/api/ffmpeg/download/status', { cache: 'no-store' })
            .then((r) => r.json()).then(paintFfmpeg).catch(() => {});
        }, 500);
        try {
          const response = await PinAuth.fetchWithPin('/api/ffmpeg/download', { method: 'POST' });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.ok) throw new Error(result.reason || t('aiInstall.ffmpegFailed'));
          // 設定頁／導覽列的 FFmpeg 就緒狀態立刻跟著更新（沿用既有事件）。
          window.dispatchEvent(new CustomEvent('elitesand:ffmpeg-invalidated'));
        } finally {
          clearInterval(ffmpegPolling);
        }
      };
      const start = async () => {
        if (started) return;
        setDownloading();
        paint(initialStatus || { stage: 'preparing', percent: 0 });
        try {
          // 先補 FFmpeg，再開始輪詢 bundle 進度——否則輪詢會把 FFmpeg 的階段文字蓋掉。
          await ensureFfmpeg();
          if (!polling) polling = setInterval(poll, 500);
          const response = await PinAuth.fetchWithPin('/api/ai-separation/bundle/download', { method: 'POST' });
          const result = await response.json().catch(() => ({}));
          // POST 回來就代表這輪伺服器工作已結束（無論成敗）——視窗從這一刻起一定可關。
          runSettled = true;
          if (!response.ok || !result.ok) throw new Error(result.reason || t('aiInstall.failed'));
          await poll();
        } catch (error) {
          if (polling) { clearInterval(polling); polling = null; }
          runSettled = true;
          started = false;
          cancel.disabled = false;
          confirm.disabled = false;
          confirm.textContent = t('aiInstall.retry');
          stageEl.textContent = error.message;
        }
      };
      // started 之後仍可關：伺服器這輪已結束（runSettled），或使用者就是想收掉視窗——
      // downloadBundle() 在背景會自己跑完並寫 state，關視窗不會遺失進度，下次開會接回。
      const onCancel = () => { if (!started || runSettled) close(false); };
      const onBackdrop = (event) => { if (event.target === modal && (!started || runSettled)) close(false); };
      const onKeydown = (event) => { if (event.key === 'Escape' && (!started || runSettled)) close(false); };

      cancel.onclick = onCancel;
      confirm.onclick = start;
      modal.onclick = onBackdrop;
      modal.onkeydown = onKeydown;
      modal.hidden = false;
      progress.hidden = !started;
      cancel.disabled = started;
      confirm.disabled = started;
      confirm.textContent = started ? t('aiInstall.downloading') : t('aiInstall.confirm');
      paint(initialStatus || { stage: 'preparing', percent: 0 });
      if (started) {
        setDownloading();
        polling = setInterval(poll, 500);
        poll();
      } else {
        confirm.focus();
      }
    });
  }

  async function ensureReady() {
    if (ensurePromise) return ensurePromise;
    ensurePromise = (async () => {
      const status = await getBundleStatus();
      if (status.available) {
        // WebGPU 引擎預熱「不擋」主流程：以前這裡 await，會讓「製作伴奏」按下後乾等
        // 5–10 秒（冷啟隱藏視窗要跑最多 20 次輪詢）才送出分離請求，使用者看到的是
        // 「點了沒反應」。改成背景預熱即可——就算第一首在引擎連上前就需要備援，
        // 協調器的 tryStartWebgpu 偵測到未連線也會安全落到 CPU，不會卡住。
        enableWebgpuFallback().catch(() => {});
        return true;
      }
      return openInstallModal(status);
    })();
    try {
      return await ensurePromise;
    } finally {
      ensurePromise = null;
    }
  }

  // 進行中／排隊中的分離取消。server 會廣播 stage:'cancelled'（ingest 會清狀態、
  // 通知訂閱者重畫）；這裡回傳成功與否讓呼叫端決定要不要提示。
  async function cancel(trackId) {
    const id = String(trackId);
    try {
      const res = await PinAuth.fetchWithPin(
        `/api/library/${encodeURIComponent(id)}/separate/cancel`,
        { method: 'POST' },
      );
      const body = await res.json().catch(() => ({}));
      return !!(res.ok && body.ok);
    } catch (_) {
      return false;
    }
  }

  // 初次載入即把 server 仍在跑的工作灌進同一份快取；畫面晚開或重繪時可立即回放。
  getBundleStatus().catch(() => {});

  window.AiSeparation = Object.freeze({
    ensureReady,
    getBundleStatus,
    subscribe,
    cancel,
    get: (trackId) => states.get(String(trackId)) || null,
    ingest,
    label: (state) => t(state?.labelKey || 'aiJob.preparing', { position: state?.queuePosition || 1 }),
  });
})();
