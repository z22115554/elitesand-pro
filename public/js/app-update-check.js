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
        ? `有新版本 v${data.latestVersion}。目前只確認 Release 資產存在；你確認更新後才會下載、驗證 SHA-256 與檢查相依結構，再由獨立 updater 安裝。`
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

  onlineBtn.addEventListener('click', async () => {
    if (!latestPlan?.canIncremental || remoteActions.disableIncrementalUpdate || remoteActions.showFullDownloadOnly) return;
    onlineBtn.disabled = true;
    checkBtn.disabled = true;
    const original = onlineBtn.textContent;
    onlineBtn.textContent = '準備更新中…';
    statusEl.textContent = '正在檢查更新';
    const result = await window.AppUpdateApply.applyIncrementalUpdate({
      onStatus: (message) => { statusEl.textContent = message; },
    });
    if (result.applied) {
      statusEl.textContent = '更新已準備完成，即將重新啟動。若瀏覽器短暫斷線是正常現象。';
      onlineBtn.hidden = true;
      if (typeof AppShared !== 'undefined') AppShared.showToast('安全更新已準備完成，即將重新啟動', 'success');
    } else if (result.cancelled) {
      if (latestPlan) render(latestPlan);
    } else {
      statusEl.textContent = `更新失敗，程式仍可繼續使用：${result.reason}`;
    }
    onlineBtn.textContent = original;
    if (!onlineBtn.hidden) onlineBtn.disabled = false;
    checkBtn.disabled = false;
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
