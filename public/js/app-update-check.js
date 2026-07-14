/** 安全程式更新 UI：顯示後端真實 phase，不在瀏覽器端猜測資產是否安全。 */
(function () {
  'use strict';

  const currentEl = document.getElementById('app-version-current');
  const statusEl = document.getElementById('app-update-status');
  const checkBtn = document.getElementById('app-update-check-btn');
  const linkEl = document.getElementById('app-update-link');
  const onlineBtn = document.getElementById('app-update-online-btn');
  if (!currentEl || !statusEl || !checkBtn || !linkEl || !onlineBtn) return;

  let latestPlan = null;
  let remoteActions = {};

  function render(data) {
    latestPlan = data;
    currentEl.textContent = data?.currentVersion ? `v${data.currentVersion}` : '未知';
    linkEl.hidden = true;
    onlineBtn.hidden = true;

    if (!data?.enabled) {
      statusEl.textContent = '更新通知尚未設定。';
      return;
    }
    if (data.hasUpdate && data.latestVersion) {
      const forcedFull = remoteActions.disableIncrementalUpdate || remoteActions.showFullDownloadOnly;
      const canIncremental = data.canIncremental && !forcedFull;
      const updateUrl = data.downloadUrl || data.releaseUrl;
      linkEl.hidden = !updateUrl;
      if (updateUrl) linkEl.href = updateUrl;
      onlineBtn.hidden = !canIncremental;
      statusEl.textContent = canIncremental
        ? `有新版本 v${data.latestVersion}。Release 已提供固定名稱的更新包與 SHA-256；安裝會在主程式完全退出後由獨立 updater 執行。`
        : `有新版本 v${data.latestVersion}，但無法安全增量更新：${forcedFull ? '安全公告要求下載完整版' : (data.reason || '缺少完整增量資產')}。`;
      return;
    }
    statusEl.textContent = data.reason && !/最新版本/.test(data.reason)
      ? `暫時無法檢查更新：${data.reason}`
      : '已是最新版本。';
  }

  async function readJson(response) {
    const text = await response.text();
    try { return JSON.parse(text); } catch (_) { throw new Error(text || `伺服器回應 ${response.status}`); }
  }

  async function pollProgress(stopSignal) {
    while (!stopSignal.done) {
      try {
        const response = await fetch('/api/app-update/status', { cache: 'no-store' });
        if (response.ok) {
          const progress = await response.json();
          if (progress?.message) statusEl.textContent = progress.message;
        }
      } catch (_) { /* 最終回應完成後伺服器會正常重啟，輪詢斷線不覆蓋成功訊息 */ }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  onlineBtn.addEventListener('click', async () => {
    if (!latestPlan?.canIncremental || remoteActions.disableIncrementalUpdate || remoteActions.showFullDownloadOnly) return;
    if (!window.confirm('安全線上更新會先下載、驗證並準備 staging；確認完成後程式會自動重新啟動。更新期間請勿關閉啟動視窗。要繼續嗎？')) return;
    onlineBtn.disabled = true;
    checkBtn.disabled = true;
    const original = onlineBtn.textContent;
    onlineBtn.textContent = '準備更新中…';
    statusEl.textContent = '正在檢查更新';
    const stopSignal = { done: false };
    const polling = pollProgress(stopSignal);
    try {
      const request = typeof PinAuth !== 'undefined'
        ? PinAuth.fetchWithPin('/api/app-update/apply', { method: 'POST' })
        : fetch('/api/app-update/apply', { method: 'POST' });
      const response = await request;
      const data = await readJson(response);
      if (!response.ok || !data.prepared) throw new Error(data.reason || '更新準備失敗');
      statusEl.textContent = '更新已準備完成，即將重新啟動。若瀏覽器短暫斷線是正常現象。';
      onlineBtn.hidden = true;
      if (typeof AppShared !== 'undefined') AppShared.showToast('安全更新已準備完成，即將重新啟動', 'success');
    } catch (err) {
      statusEl.textContent = `更新失敗，程式仍可繼續使用：${err.message}`;
      onlineBtn.disabled = false;
      checkBtn.disabled = false;
    } finally {
      stopSignal.done = true;
      await polling;
      onlineBtn.textContent = original;
      if (!onlineBtn.hidden) onlineBtn.disabled = false;
      checkBtn.disabled = false;
    }
  });

  async function check(force) {
    checkBtn.disabled = true;
    checkBtn.textContent = '檢查中…';
    statusEl.textContent = '正在檢查更新';
    try {
      const response = await fetch(`/api/app-update/plan${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || '伺服器沒有回應');
      render(data);
    } catch (err) {
      currentEl.textContent = '未知';
      statusEl.textContent = `暫時無法檢查更新：${err.message}`;
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = '檢查更新';
    }
  }

  window.addEventListener('announcements:actions', (event) => {
    remoteActions = event.detail || {};
    if (latestPlan) render(latestPlan);
  });
  checkBtn.addEventListener('click', () => check(true));
  check(false);
})();
