/**
 * 通用 UI 小工具 —— toast 通知、連線狀態指示、更新檢查橫幅。
 * 對外暴露 AppShared.showToast，供其他所有模組呼叫。
 */
(function () {
  'use strict';

  const { dom } = AppShared;

  // ═══════════════════════════════════════════
  // 連線狀態
  // ═══════════════════════════════════════════

  SocketClient.on('connection-change', (connected) => {
    const banner = document.getElementById('connection-banner');
    if (connected) {
      dom.connectionStatus.className = 'status-dot connected';
      dom.connectionText.textContent = '已連線';
      if (banner) banner.classList.remove('visible');
    } else {
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

  SocketClient.on('client:counts', (counts = {}) => {
    setSourceStatus(dom.displaySourceStatus, (counts.displays || 0) > 0, '歌詞');
    setSourceStatus(dom.setlistSourceStatus, (counts.setlists || 0) > 0, '歌單');
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
