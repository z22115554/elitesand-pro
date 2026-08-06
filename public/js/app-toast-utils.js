/**
 * 通用 UI 小工具 —— toast 通知、連線狀態指示、更新檢查橫幅。
 * 對外暴露 AppShared.showToast，供其他所有模組呼叫。
 */
(function () {
  'use strict';

  const { dom } = AppShared;
  const t = (key) => (
    typeof window !== 'undefined' && window.I18n ? window.I18n.t(key) : key
  );

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
      dom.connectionText.textContent = t('status.connected');
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
      dom.connectionText.textContent = t('status.connecting');
      if (banner) banner.classList.add('visible');
    }
  });
  SocketClient.on('operation:error', (data = {}) => showToast(data.message || '操作失敗', 'error'));
  SocketClient.on('server:alert', (data = {}) => showToast(`${data.area || '伺服器'}失敗：${data.message || '請檢查 logs'}`, 'error'));

  function setSourceStatus(el, connected, source) {
    if (!el) return;
    el.classList.toggle('connected', connected);
    el.classList.toggle('disconnected', !connected);
    const key = `status.${source}${connected ? 'Connected' : 'Disconnected'}`;
    el.setAttribute('aria-label', t(key));
    el.textContent = t(key);
  }

  let lastDisplayBuildWarning = null;
  function setDisplayRuntimeStatus(counts) {
    const el = dom.displaySourceStatus;
    if (!el) return;
    const connected = (counts.displays || 0) > 0;
    const runtime = counts.displayRuntime;
    if (!connected) {
      lastDisplayBuildWarning = null;
      setSourceStatus(el, false, 'lyrics');
      return;
    }

    const stale = Number(runtime?.stale || 0);
    const unreported = Number(runtime?.unreported || 0);
    const pending = Number(runtime?.pending || 0);
    el.classList.remove('connected', 'disconnected', 'pending', 'stale');
    if (stale || unreported) {
      el.classList.add('stale');
      el.textContent = t('status.lyricsStale');
      el.setAttribute('aria-label', t('status.lyricsStaleAria'));
      const warningKey = `${runtime?.expectedBuild || ''}:${stale}:${unreported}`;
      if (warningKey !== lastDisplayBuildWarning) {
        lastDisplayBuildWarning = warningKey;
        showToast(t('status.lyricsStaleWarning'), 'warning');
      }
      return;
    }
    lastDisplayBuildWarning = null;
    if (pending) {
      el.classList.add('pending');
      el.textContent = t('status.lyricsPending');
      el.setAttribute('aria-label', t('status.lyricsPendingAria'));
      return;
    }
    setSourceStatus(el, true, 'lyrics');
  }

  SocketClient.on('client:counts', (counts = {}) => {
    latestClientCounts = counts;
    setDisplayRuntimeStatus(counts);
    setSourceStatus(dom.setlistSourceStatus, (counts.setlists || 0) > 0, 'setlist');
    const missing = missingRecoveredSources(counts);
    if (!missing.length) {
      lastSourceRecoveryWarning = null;
      if (sourceRecoveryPending) {
        sourceRecoveryPending = false;
        clearSourceRecoveryTimer();
      }
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('i18n:change', () => {
      dom.connectionText.textContent = t(dom.connectionStatus.classList.contains('connected')
        ? 'status.connected' : 'status.connecting');
      if (latestClientCounts) {
        setDisplayRuntimeStatus(latestClientCounts);
        setSourceStatus(dom.setlistSourceStatus, (latestClientCounts.setlists || 0) > 0, 'setlist');
      }
    });
  }

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
  // 改讀 /api/app-update/plan（跟設定頁「檢查更新」同一支 API）而不是舊的 /api/update-check：
  // 後者只回傳「有沒有新版本」跟一個下載連結，永遠只能開新分頁去 GitHub，就算新版本其實
  // 有安全增量更新（update.zip）可以一鍵套用也一樣，使用者得自己找到設定頁才有得選。
  // 這裡改成能一鍵增量更新就直接原地套用，不必先按下載再自己解壓覆蓋。
  (function checkForUpdate() {
    if (!dom.updateBanner) return;

    const DISMISS_KEY = 'vk-update-dismissed-version';
    let remoteActions = {};
    let plan = null;

    function canApply() {
      return !!(plan && plan.canIncremental && !remoteActions.disableIncrementalUpdate && !remoteActions.showFullDownloadOnly);
    }

    function render() {
      if (!plan || !plan.hasUpdate || !plan.latestVersion) { dom.updateBanner.hidden = true; return; }

      let dismissed = null;
      try { dismissed = localStorage.getItem(DISMISS_KEY); } catch (e) { /* 靜默 */ }
      if (dismissed === plan.latestVersion) { dom.updateBanner.hidden = true; return; }

      const updateUrl = plan.downloadUrl || plan.releaseUrl;
      const applyable = canApply();
      // 兩個按鈕互斥：能安全增量更新才顯示「立即更新」；不行才退回連到 GitHub 的下載連結。
      // 兩個都沒有（沒有有效 asset/release）就不顯示假按鈕，避免 href="#" 回到 localhost/#。
      if (dom.updateBannerApply) dom.updateBannerApply.hidden = !applyable;
      if (dom.updateBannerLink) {
        dom.updateBannerLink.hidden = applyable || !updateUrl;
        if (updateUrl) dom.updateBannerLink.href = updateUrl;
      }
      if (!applyable && !updateUrl) { dom.updateBanner.hidden = true; return; }

      if (dom.updateBannerVersion) dom.updateBannerVersion.textContent = 'v' + plan.latestVersion;
      dom.updateBanner.hidden = false;
    }

    function refreshPlan() {
      fetch('/api/app-update/plan')
        .then((r) => r.json())
        .then((data) => { plan = data; render(); })
        .catch(() => {
          // 離線或伺服器尚未支援此 API：靜默忽略，不影響面板使用
        });
    }

    if (dom.updateBannerDismiss) {
      dom.updateBannerDismiss.addEventListener('click', () => {
        dom.updateBanner.hidden = true;
        if (plan?.latestVersion) {
          try { localStorage.setItem(DISMISS_KEY, plan.latestVersion); } catch (e) { /* 靜默 */ }
        }
      });
    }

    if (dom.updateBannerApply) {
      dom.updateBannerApply.addEventListener('click', async () => {
        if (!canApply()) return;
        dom.updateBannerApply.disabled = true;
        if (dom.updateBannerDismiss) dom.updateBannerDismiss.disabled = true;
        const original = dom.updateBannerApply.textContent;
        const result = await window.AppUpdateApply.applyIncrementalUpdate({
          onStatus: (message) => { dom.updateBannerApply.textContent = message; },
        });
        if (result.applied) {
          dom.updateBannerApply.textContent = '即將重新啟動…';
          AppShared.showToast('安全更新已準備完成，即將重新啟動', 'success');
          return; // 保持停用狀態：伺服器接下來就會重啟，不需要再恢復成可點擊
        }
        dom.updateBannerApply.textContent = original;
        dom.updateBannerApply.disabled = false;
        if (dom.updateBannerDismiss) dom.updateBannerDismiss.disabled = false;
        if (!result.cancelled) AppShared.showToast(`更新失敗，程式仍可繼續使用：${result.reason}`, 'error');
      });
    }

    // 安全公告可能事後停用某版本的增量更新（見 app-update-check.js 同一套機制）；
    // 橫幅要跟設定頁看到同一個結論，不能各判各的。
    window.addEventListener('announcements:actions', (event) => {
      remoteActions = event.detail || {};
      render();
    });

    refreshPlan();
  })();

  // 供其他所有模組呼叫
  AppShared.showToast = showToast;
})();
