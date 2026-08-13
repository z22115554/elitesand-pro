/** 程式更新 UI：安全增量可用時直接安裝，不相容時回退完整 Windows Installer。 */
(function () {
  'use strict';

  const currentEl = document.getElementById('app-version-current');
  const statusEl = document.getElementById('app-update-status');
  const checkBtn = document.getElementById('app-update-check-btn');
  const linkEl = document.getElementById('app-update-link');
  const introEl = document.querySelector('#app-update-card .section-intro');
  if (!currentEl || !statusEl || !checkBtn || !linkEl) return;

  const defaultIntro = '有安全增量更新時可直接安裝；若目前版本或新版不相容，會改用完整 Windows Installer。';
  if (introEl) introEl.textContent = defaultIntro;

  const applyBtn = document.createElement('button');
  applyBtn.id = 'app-update-apply-btn';
  applyBtn.className = 'btn btn-sm btn-primary';
  applyBtn.type = 'button';
  applyBtn.textContent = '安裝更新';
  applyBtn.hidden = true;
  linkEl.parentElement?.insertBefore(applyBtn, linkEl);

  let latestPlan = null;
  let applying = false;

  function render(data) {
    latestPlan = data || null;
    currentEl.textContent = data?.currentVersion ? `v${data.currentVersion}` : '未知';
    applyBtn.hidden = true;
    linkEl.hidden = true;
    linkEl.textContent = '下載 Installer';

    if (!data?.enabled) {
      statusEl.textContent = '更新通知尚未設定。';
      return;
    }
    if (data.hasUpdate && data.latestVersion) {
      const updateUrl = data.downloadUrl || data.releaseUrl;
      linkEl.hidden = !updateUrl;
      if (updateUrl) linkEl.href = updateUrl;

      if (data.canIncremental) {
        applyBtn.hidden = false;
        linkEl.textContent = '改用 Installer';
        statusEl.textContent = `有新版本 v${data.latestVersion}，可直接安裝。更新時程式會暫時關閉並自動重新啟動。`;
      } else {
        statusEl.textContent = `有新版本 v${data.latestVersion}。${data.reason || '請下載並執行完整 Windows Installer。'}`;
      }
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
    if (applying) return;
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

  async function applyUpdate() {
    if (applying || !latestPlan?.hasUpdate || !latestPlan?.canIncremental) return;
    if (!window.PanelConfirm || typeof window.PanelConfirm.request !== 'function') {
      statusEl.textContent = '無法開啟更新確認視窗，為避免誤操作，本次不會執行更新。';
      return;
    }

    const confirmed = await window.PanelConfirm.request({
      title: `安裝 Elitesand Pro v${latestPlan.latestVersion}？`,
      summary: '程式會暫時關閉，更新完成後自動重新啟動，通常約需 10～20 秒。',
      impact: '更新期間請勿手動重新開啟 Elitesand Pro。',
      confirmLabel: '安裝更新',
      tone: 'neutral',
    });
    if (!confirmed) return;

    applying = true;
    applyBtn.disabled = true;
    checkBtn.disabled = true;
    linkEl.hidden = true;
    statusEl.textContent = '正在下載並驗證更新。完成後程式會自動重新啟動，請勿手動重新開啟。';

    try {
      const request = (typeof PinAuth !== 'undefined' && typeof PinAuth.fetchWithPin === 'function')
        ? (url, opts) => PinAuth.fetchWithPin(url, opts)
        : (url, opts) => fetch(url, opts);
      const response = await request('/api/app-update/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await readJson(response);
      if (!response.ok || !data.prepared) {
        throw new Error(data.reason || data.error || `更新失敗 (${response.status})`);
      }
      statusEl.textContent = '更新已準備完成。程式即將暫時關閉並自動重新啟動，請勿手動重新開啟。';
    } catch (err) {
      applying = false;
      applyBtn.disabled = false;
      checkBtn.disabled = false;
      linkEl.hidden = !(latestPlan?.downloadUrl || latestPlan?.releaseUrl);
      statusEl.textContent = `更新失敗：${err.message}`;
    }
  }

  checkBtn.addEventListener('click', () => check(true));
  applyBtn.addEventListener('click', applyUpdate);
  check(false);
})();
