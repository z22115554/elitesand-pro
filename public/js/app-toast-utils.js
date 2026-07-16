/**
 * 通用 UI 小工具 —— toast 通知、連線狀態指示、更新檢查橫幅。
 * 對外暴露 AppShared.showToast，供其他所有模組呼叫。
 */
(function () {
  'use strict';

  const { dom } = AppShared;

  // OBS 瀏覽器來源曾經連上、但控制台服務重啟後沒有回來時，OBS 可能還停在
  // 服務離線期間的透明頁面。這只能在同一個控制台工作階段確定，不能把首次
  // 尚未設定 OBS 的人誤判成故障；故只記憶本頁實際看過的正式來源連線。
  const OBS_SOURCE_RECOVERY_DELAY_MS = 5000;
  let latestClientCounts = null;
  let sourcesBeforeServerDisconnect = { display: false, setlist: false };
  let sourceRecoveryPending = false;
  let sourceRecoveryTimer = null;
  let lastSourceRecoveryWarning = null;

  function clearSourceRecoveryTimer() {
    if (sourceRecoveryTimer) clearTimeout(sourceRecoveryTimer);
    sourceRecoveryTimer = null;
  }

  function missingRecoveredSources(counts = latestClientCounts || {}) {
    const missing = [];
    if (sourcesBeforeServerDisconnect.display && !(counts.displays > 0)) missing.push('歌詞');
    if (sourcesBeforeServerDisconnect.setlist && !(counts.setlists > 0)) missing.push('歌單');
    return missing;
  }

  function settleSourceRecoveryHint() {
    clearSourceRecoveryTimer();
    if (!sourceRecoveryPending) return;
    sourceRecoveryTimer = setTimeout(() => {
      sourceRecoveryTimer = null;
      const missing = missingRecoveredSources();
      sourceRecoveryPending = false;
      if (!missing.length) {
        lastSourceRecoveryWarning = null;
        return;
      }
      const warningKey = missing.join(',');
      if (warningKey === lastSourceRecoveryWarning) return;
      lastSourceRecoveryWarning = warningKey;
      showToast(`控制台已重新連線，但 OBS ${missing.join('、')}來源沒有重新連回來。請在 OBS 對該瀏覽器來源按右鍵 → 重新整理快取。`, 'warning');
    }, OBS_SOURCE_RECOVERY_DELAY_MS);
  }

  // ═══════════════════════════════════════════
  // 連線狀態
  // ═══════════════════════════════════════════

  SocketClient.on('connection-change', (connected) => {
    const banner = document.getElementById('connection-banner');
    if (connected) {
      dom.connectionStatus.className = 'status-dot connected';
      dom.connectionText.textContent = '已連線';
      if (banner) banner.classList.remove('visible');
      settleSourceRecoveryHint();
    } else {
      // latestClientCounts 是本輪 server 的資料；先記住已被實際驗證過的來源，再等
      // 下一輪 client:counts。這不會把預覽 iframe 或第一次使用者算進來。
      sourcesBeforeServerDisconnect.display ||= Boolean(latestClientCounts?.displays > 0);
      sourcesBeforeServerDisconnect.setlist ||= Boolean(latestClientCounts?.setlists > 0);
      sourceRecoveryPending = sourcesBeforeServerDisconnect.display || sourcesBeforeServerDisconnect.setlist;
      latestClientCounts = null;
      clearSourceRecoveryTimer();
      dom.connectionStatus.className = 'status-dot disconnected';
      dom.connectionText.textContent = '連線中...';
      if (banner) banner.classList.add('visible');
    }
  });
  SocketClient.on('operation:error', (data = {}) => showToast(data.message || '操作失敗', 'error'));
  SocketClient.on('server:alert', (data = {}) => showToast(`${data.area || '伺服器'}失敗：${data.message || '請檢查 logs'}`, 'error'));

  function setSourceStatus(el, connected, label) {
    if (!el) return;
    el.classList.toggle('connected', connected);
    el.classList.toggle('disconnected', !connected);
    el.setAttribute('aria-label', `${label}${connected ? '已連線' : '未連線'}`);
    el.textContent = label + (connected ? '已連線' : '未連線');
  }

  let lastDisplayBuildWarning = null;
  function setDisplayRuntimeStatus(counts) {
    const el = dom.displaySourceStatus;
    if (!el) return;
    const connected = (counts.displays || 0) > 0;
    const runtime = counts.displayRuntime;
    if (!connected) {
      lastDisplayBuildWarning = null;
      setSourceStatus(el, false, '歌詞');
      return;
    }

    const stale = Number(runtime?.stale || 0);
    const unreported = Number(runtime?.unreported || 0);
    const pending = Number(runtime?.pending || 0);
    el.classList.remove('connected', 'disconnected', 'pending', 'stale');
    if (stale || unreported) {
      el.classList.add('stale');
      el.textContent = '歌詞可能為舊版';
      el.setAttribute('aria-label', '歌詞已連線，但 OBS 來源可能仍使用舊程式碼');
      const warningKey = `${runtime?.expectedBuild || ''}:${stale}:${unreported}`;
      if (warningKey !== lastDisplayBuildWarning) {
        lastDisplayBuildWarning = warningKey;
        showToast('偵測到 OBS 歌詞來源可能仍使用舊程式碼。請在 OBS 對「歌詞」瀏覽器來源按右鍵 → 重新整理快取；若仍無效，關閉再開啟該來源。', 'warning');
      }
      return;
    }
    lastDisplayBuildWarning = null;
    if (pending) {
      el.classList.add('pending');
      el.textContent = '歌詞驗證中';
      el.setAttribute('aria-label', '歌詞已連線，正在確認 OBS 程式版本');
      return;
    }
    setSourceStatus(el, true, '歌詞');
  }

  SocketClient.on('client:counts', (counts = {}) => {
    latestClientCounts = counts;
    setDisplayRuntimeStatus(counts);
    setSourceStatus(dom.setlistSourceStatus, (counts.setlists || 0) > 0, '歌單');
    const missing = missingRecoveredSources(counts);
    if (!missing.length) {
      lastSourceRecoveryWarning = null;
      if (sourceRecoveryPending) {
        sourceRecoveryPending = false;
        clearSourceRecoveryTimer();
      }
    }
  });

  // ═══════════════════════════════════════════
  // Toast 通知
  // ═══════════════════════════════════════════

  function showToast(message, type = 'info') {
    if (typeof ErrorHandler !== 'undefined') {
      ErrorHandler.showToast(message, type);
    } else {
      // Fallback
      let toastEl = document.getElementById('app-toast');
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'app-toast';
        toastEl.className = 'toast-notification';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = message;
      toastEl.className = `toast-notification ${type}`;
      toastEl.classList.add('visible');
      setTimeout(() => { toastEl.classList.remove('visible'); }, 4000);
    }
  }

  // ═══════════════════════════════════════════
  // 更新檢查（GitHub Releases）
  // ═══════════════════════════════════════════
  (function checkForUpdate() {
    if (!dom.updateBanner) return;

    const DISMISS_KEY = 'vk-update-dismissed-version';

    fetch('/api/update-check')
      .then((r) => r.json())
      .then((data) => {
        if (!data || !data.enabled || !data.hasUpdate || !data.latestVersion) return;

        // 使用者已手動關閉過這個版本的提示，就不再顯示
        let dismissed = null;
        try { dismissed = localStorage.getItem(DISMISS_KEY); } catch (e) { /* 靜默 */ }
        if (dismissed === data.latestVersion) return;

        const updateUrl = data.downloadUrl || data.releaseUrl;
        // 沒有有效 GitHub asset/release 時不顯示假按鈕，避免 href="#" 回到 localhost/#。
        if (!updateUrl) return;
        if (dom.updateBannerVersion) dom.updateBannerVersion.textContent = 'v' + data.latestVersion;
        if (dom.updateBannerLink) dom.updateBannerLink.href = updateUrl;
        dom.updateBanner.hidden = false;

        if (dom.updateBannerDismiss) {
          dom.updateBannerDismiss.addEventListener('click', () => {
            dom.updateBanner.hidden = true;
            try { localStorage.setItem(DISMISS_KEY, data.latestVersion); } catch (e) { /* 靜默 */ }
          });
        }
      })
      .catch(() => {
        // 離線或伺服器尚未支援此 API：靜默忽略，不影響面板使用
      });
  })();

  // 供其他所有模組呼叫
  AppShared.showToast = showToast;
})();
