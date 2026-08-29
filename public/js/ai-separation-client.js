(() => {
  'use strict';

  const states = new Map();
  const subscribers = new Set();
  let ensurePromise = null;

  const t = (key, vars) => window.I18n ? window.I18n.t(key, vars) : key;

  function normalizePercent(value, stage) {
    if (stage === 'done') return 100;
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(Math.max(0, Math.min(100, number <= 1 ? number * 100 : number)));
  }

  function labelKey(stage) {
    if (stage === 'queued') return 'aiJob.queued';
    if (stage === 'preparing' || stage === 'load') return 'aiJob.preparing';
    if (stage === 'fallback-webgpu' || stage === 'canary') return 'aiJob.webgpuFallback';
    if (stage === 'fallback-cpu') return 'aiJob.cpuFallback';
    if (stage === 'download-model') return 'aiJob.preparingModel';
    if (stage === 'download-audio' || stage === 'decode') return 'aiJob.preparingAudio';
    if (stage === 'done') return 'aiJob.done';
    if (stage === 'error') return 'aiJob.error';
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
    state.labelKey = labelKey(state.stage);
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

  async function enableWebgpuFallback() {
    if (!window.ElitesandShell?.webgpuEngine) return;
    try {
      await PinAuth.fetchWithPin('/api/webgpu-separation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      await window.ElitesandShell.webgpuEngine.setEnabled(true);
      // BrowserWindow.loadURL() 完成不代表 Socket.io 握手也已完成；短暫等到 server
      // 看見引擎，避免使用者確認後立刻開始第一首時直接略過 WebGPU 備援。
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const status = await getBundleStatus();
        if (status.webgpuEngineConnected) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (_) {
      // WebGPU 是中間備援；啟動失敗時協調器仍會安全走最後的 CPU，不阻擋主要動作。
    }
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
        cancel.disabled = true;
        confirm.disabled = true;
        confirm.textContent = t('aiInstall.downloading');
      };
      const poll = async () => {
        try {
          const status = await getBundleStatus();
          paint(status);
          if (status.available && !status.active) {
            await enableWebgpuFallback();
            close(true);
          } else if (status.stage === 'error') {
            if (polling) { clearInterval(polling); polling = null; }
            started = false;
            cancel.disabled = false;
            confirm.disabled = false;
            confirm.textContent = t('aiInstall.retry');
            stageEl.textContent = status.error || t('aiInstall.failed');
          }
        } catch (_) { /* 下一輪輪詢再試；真正失敗會由 POST 回應顯示 */ }
      };
      const start = async () => {
        if (started) return;
        setDownloading();
        paint(initialStatus || { stage: 'preparing', percent: 0 });
        if (!polling) polling = setInterval(poll, 500);
        try {
          const response = await PinAuth.fetchWithPin('/api/ai-separation/bundle/download', { method: 'POST' });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.ok) throw new Error(result.reason || t('aiInstall.failed'));
          await poll();
        } catch (error) {
          if (polling) { clearInterval(polling); polling = null; }
          started = false;
          cancel.disabled = false;
          confirm.disabled = false;
          confirm.textContent = t('aiInstall.retry');
          stageEl.textContent = error.message;
        }
      };
      const onCancel = () => { if (!started) close(false); };
      const onBackdrop = (event) => { if (event.target === modal && !started) close(false); };
      const onKeydown = (event) => { if (event.key === 'Escape' && !started) close(false); };

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
