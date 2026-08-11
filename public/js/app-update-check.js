/** 程式更新 UI：只通知並導向完整 Windows Installer。 */
(function () {
  'use strict';

  const currentEl = document.getElementById('app-version-current');
  const statusEl = document.getElementById('app-update-status');
  const checkBtn = document.getElementById('app-update-check-btn');
  const linkEl = document.getElementById('app-update-link');
  if (!currentEl || !statusEl || !checkBtn || !linkEl) return;

  function render(data) {
    currentEl.textContent = data?.currentVersion ? `v${data.currentVersion}` : '未知';
    linkEl.hidden = true;

    if (!data?.enabled) {
      statusEl.textContent = '更新通知尚未設定。';
      return;
    }
    if (data.hasUpdate && data.latestVersion) {
      const updateUrl = data.downloadUrl || data.releaseUrl;
      linkEl.hidden = !updateUrl;
      if (updateUrl) linkEl.href = updateUrl;
      statusEl.textContent = `有新版本 v${data.latestVersion}。程式內增量更新已停用；請下載並執行完整 Windows Installer。`;
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

  checkBtn.addEventListener('click', () => check(true));
  check(false);
})();
