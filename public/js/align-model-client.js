// 設定 › 下載工具卡的「精準對時（中文歌）」元件列：顯示安裝狀態、下載、安裝進度。
// 下載由伺服器在背景進行（server/services/align-runtime-provider.js），這裡只輪詢狀態。
(function () {
  'use strict';
  const T = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
  const statusEl = document.getElementById('align-model-status');
  const btn = document.getElementById('align-model-download-btn');
  if (!statusEl || !btn) return;

  let polling = null;
  let wasActive = false;

  function stageText(s) {
    const percent = s.totalBytes > 0 && s.downloadedBytes != null
      ? ` ${Math.floor((s.downloadedBytes / s.totalBytes) * 100)}%` : '';
    if (s.stage === 'download-model' || s.stage === 'extract-model') return T('alignModel.stageModel') + percent;
    if (s.stage === 'warmup') return T('alignModel.stageWarmup');
    return T('alignModel.stageRuntime') + percent;
  }

  function render(s) {
    statusEl.classList.toggle('ok', !!s.available);
    if (s.available) {
      statusEl.textContent = T(s.device === 'cpu' ? 'alignModel.installedCpu' : 'alignModel.installedGpu');
      btn.hidden = true;
      return;
    }
    if (s.supported === false) {
      statusEl.textContent = T('alignModel.unsupported');
      btn.hidden = true;
      return;
    }
    if (s.active) {
      statusEl.textContent = stageText(s);
      btn.hidden = true;
      return;
    }
    statusEl.textContent = s.stage === 'error' && s.error ? T('alignModel.failed', { error: s.error }) : T('alignModel.notInstalled');
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = T(s.stage === 'error' ? 'alignModel.retry' : 'alignModel.download');
  }

  async function refresh() {
    try {
      const res = await fetch('/api/align-model/runtime-status', { cache: 'no-store' });
      const s = await res.json();
      render(s);
      if (wasActive && !s.active && s.available) AppShared.showToast?.(T('alignModel.installedToast'), 'success');
      wasActive = !!s.active;
      if (s.active && !polling) polling = setInterval(refresh, 1500);
      if (!s.active && polling) { clearInterval(polling); polling = null; }
    } catch (_) { /* 伺服器暫時沒回應：下次再試 */ }
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await PinAuth.fetchWithPin('/api/align-model/runtime/download', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) AppShared.showToast?.(T('alignModel.failed', { error: body.reason || `HTTP ${res.status}` }), 'error');
    } catch (err) {
      AppShared.showToast?.(T('alignModel.failed', { error: err.message }), 'error');
    }
    refresh();
  });

  document.addEventListener('view:change', (event) => {
    if (event.detail?.view === 'general') refresh();
  });
  refresh();
})();
