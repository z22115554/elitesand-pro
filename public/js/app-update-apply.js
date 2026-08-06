/**
 * 套用安全增量更新的共用流程（確認 → POST /api/app-update/apply → 輪詢進度 → 由伺服器
 * graceful shutdown 後自動重啟）。設定頁（app-update-check.js）跟首頁橫幅
 * （app-toast-utils.js）都要能一鍵套用，兩處各自重寫一份等於日後行為/錯誤處理容易兜不攏，
 * 所以抽成這裡的共用函式，兩邊都呼叫同一份。
 *
 * 必須在 app-update-check.js／app-toast-utils.js 之前載入。
 */
window.AppUpdateApply = (function () {
  'use strict';

  async function readJson(response) {
    const text = await response.text();
    try { return JSON.parse(text); } catch (_) { throw new Error(text || `伺服器回應 ${response.status}`); }
  }

  async function pollProgress(stopSignal, onStatus) {
    while (!stopSignal.done) {
      try {
        const response = await fetch('/api/app-update/status', { cache: 'no-store' });
        if (response.ok) {
          const progress = await response.json();
          if (progress?.message && typeof onStatus === 'function') onStatus(progress.message);
        }
      } catch (_) { /* 最終回應完成後伺服器會正常重啟，輪詢斷線不覆蓋成功訊息 */ }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  /**
   * @param {Object} [options]
   * @param {(message: string) => void} [options.onStatus] 更新進度訊息（下載/驗證/準備 staging）
   * @returns {Promise<{applied: boolean, cancelled?: boolean, reason?: string}>}
   */
  async function applyIncrementalUpdate(options = {}) {
    const { onStatus } = options;
    const confirmed = await window.PanelConfirm?.request({
      title: '開始安全線上更新？',
      summary: '程式會先下載、驗證 SHA-256 與準備 staging。',
      impact: '確認完成後程式會自動重新啟動；更新期間請勿關閉啟動視窗。',
      confirmLabel: '下載並更新',
    });
    if (!confirmed) return { applied: false, cancelled: true };

    const stopSignal = { done: false };
    const polling = pollProgress(stopSignal, onStatus);
    try {
      const request = typeof PinAuth !== 'undefined'
        ? PinAuth.fetchWithPin('/api/app-update/apply', { method: 'POST' })
        : fetch('/api/app-update/apply', { method: 'POST' });
      const response = await request;
      const data = await readJson(response);
      if (!response.ok || !data.prepared) return { applied: false, reason: data.reason || '更新準備失敗' };
      return { applied: true };
    } catch (err) {
      return { applied: false, reason: err.message };
    } finally {
      stopSignal.done = true;
      await polling;
    }
  }

  return { applyIncrementalUpdate };
})();
