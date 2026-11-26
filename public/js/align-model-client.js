// 設定 › 下載工具卡的「精準對時（中文歌）」元件列：顯示安裝狀態、下載、安裝進度。
// 下載由伺服器在背景進行（server/services/align-runtime-provider.js），這裡只輪詢狀態。
(function () {
  'use strict';
  const T = (k, v) => (window.I18n ? window.I18n.t(k, v) : k);
  const statusEl = document.getElementById('align-model-status');
  const btn = document.getElementById('align-model-download-btn');
  const hintEl = document.getElementById('align-model-hint');
  if (!statusEl || !btn) return;

  function fmtBytes(b) {
    if (b == null || !Number.isFinite(b)) return '';
    return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
  }

  const isMac = (s) => s && s.platform === 'darwin';

  // Mac：說明改成 CPU 版＋照實的大小（Windows 維持 data-i18n 的原文）
  function applyMacHint(s) {
    if (!hintEl || !isMac(s) || s.supported === false) return;
    hintEl.removeAttribute('data-i18n');
    hintEl.textContent = T('alignModel.hintMac', {
      download: fmtBytes(s.expectedDownloadBytes),
      installed: fmtBytes(s.expectedInstalledBytes),
      required: fmtBytes(s.requiredFreeBytes),
    });
  }

  function unsupportedText(reason) {
    if (reason === 'intel') return T('alignModel.unsupportedIntel');
    if (reason === 'macos_old') return T('alignModel.unsupportedOs');
    return T('alignModel.unsupported');
  }

  function errorText(s) {
    if (s.errorCode === 'DISK_FULL') return T('alignModel.diskFull', { required: fmtBytes(s.requiredFreeBytes) });
    if (s.errorCode === 'MAC_UNSUPPORTED') return unsupportedText(s.unsupportedReason);
    return T('alignModel.failed', { error: s.error });
  }

  let polling = null;
  let wasActive = false;

  function stageText(s) {
    const percent = s.totalBytes > 0 && s.downloadedBytes != null
      ? ` ${Math.floor((s.downloadedBytes / s.totalBytes) * 100)}%` : '';
    if (s.stage === 'download-model' || s.stage === 'extract-model') return T('alignModel.stageModel') + percent;
    if (s.stage === 'warmup') return T(isMac(s) ? 'alignModel.stageWarmupCpu' : 'alignModel.stageWarmup');
    return T('alignModel.stageRuntime') + percent;
  }

  function render(s) {
    statusEl.classList.toggle('ok', !!s.available);
    applyMacHint(s);
    if (s.available) {
      statusEl.textContent = T(isMac(s) ? 'alignModel.installedCpuMac' : (s.device === 'cpu' ? 'alignModel.installedCpu' : 'alignModel.installedGpu'));
      btn.hidden = true;
      return;
    }
    if (s.supported === false) {
      // Windows 以外一律在伺服器判斷；Mac 上不支援的機器（Intel、macOS 14 以前）說明原因
      statusEl.textContent = isMac(s) ? unsupportedText(s.unsupportedReason) : T('alignModel.unsupported');
      btn.hidden = true;
      return;
    }
    if (s.active) {
      statusEl.textContent = stageText(s);
      btn.hidden = true;
      return;
    }
    statusEl.textContent = s.stage === 'error' && s.error ? errorText(s) : T('alignModel.notInstalled');
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
      if (!res.ok) {
        AppShared.showToast?.(body.reason === 'MAC_UNSUPPORTED'
          ? unsupportedText(body.unsupportedReason)
          : T('alignModel.failed', { error: body.reason || `HTTP ${res.status}` }), 'error');
      }
    } catch (err) {
      AppShared.showToast?.(T('alignModel.failed', { error: err.message }), 'error');
    }
    refresh();
  });

  // 狀態文字是程式填的，換語言時要重畫
  window.addEventListener('i18n:change', () => refresh());
  document.addEventListener('view:change', (event) => {
    if (event.detail?.view === 'general') refresh();
  });
  refresh();
})();
