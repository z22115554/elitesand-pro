(function () {
  'use strict';

  const checkButton = document.getElementById('app-update-check-btn');
  const restartButton = document.getElementById('app-update-restart-btn');
  const currentVersionElement = document.getElementById('app-version-current');
  const statusElement = document.getElementById('app-update-status');
  if (!checkButton || !restartButton || !currentVersionElement || !statusElement) return;

  const restart = window.ElitesandShell?.restartForUpdateCheck;
  const cloudflareCheck = window.ElitesandShell?.cloudflareUpdateCheck;
  const onCloudflareProgress = window.ElitesandShell?.onCloudflareUpdateProgress;

  let currentVersion = null;
  let result = null;
  let state = 'notChecked';
  let cloudflareTargetVersion = null;
  let cloudflareProgressMessage = null;

  function translate(key, vars) {
    if (window.I18n && typeof window.I18n.t === 'function') return window.I18n.t(key, vars);
    return key;
  }

  function displayVersion(version) {
    if (!version) return translate('appUpdate.currentUnknown');
    const value = String(version).trim();
    return /^v/i.test(value) ? value : `v${value}`;
  }

  function render() {
    currentVersionElement.textContent = displayVersion(result?.currentVersion || currentVersion);
    checkButton.textContent = translate('appUpdate.check');
    checkButton.disabled = state === 'checking';

    if (state === 'checking') {
      // Once a real accept is underway, the server pushes its own progress
      // messages (downloading/verifying/staging the artifact) here — without
      // this, the whole multi-minute download looked completely frozen.
      statusElement.textContent = cloudflareProgressMessage || translate('appUpdate.checking');
    } else if (state === 'failed') {
      statusElement.textContent = translate('appUpdate.checkFailed');
    } else if (state === 'notConfigured') {
      statusElement.textContent = translate('appUpdate.notConfigured');
    } else if (state === 'notChecked') {
      statusElement.textContent = translate('appUpdate.notChecked');
    } else if (state === 'available' && result?.latestVersion) {
      statusElement.textContent = translate('appUpdate.available', {
        version: displayVersion(result.latestVersion),
      });
    } else if (state === 'restarting') {
      statusElement.textContent = translate('appUpdate.restarting');
    } else if (state === 'cfDeclined') {
      statusElement.textContent = translate('appUpdate.cfDeclined', { version: displayVersion(cloudflareTargetVersion) });
    } else if (state === 'cfAcceptFailed') {
      statusElement.textContent = translate('appUpdate.cfAcceptFailed');
    } else {
      statusElement.textContent = translate('appUpdate.latest');
    }

    restartButton.textContent = translate('appUpdate.restart');
    restartButton.hidden = typeof restart !== 'function' || state !== 'available' || !result?.hasUpdate;
  }

  async function loadCurrentVersion() {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      currentVersion = data.version || null;
      render();
    } catch (error) {
      console.warn('[AppUpdate] 無法讀取目前版本:', error);
      render();
    }
  }

  async function checkViaGitHubFallback() {
    try {
      const response = await fetch('/api/update-check?force=1', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      result = await response.json();
      currentVersion = result.currentVersion || currentVersion;
      if (result.enabled === false) state = 'notConfigured';
      else if (result.error) state = 'failed';
      else if (result.hasUpdate) state = 'available';
      else state = 'latest';
    } catch (error) {
      result = null;
      state = 'failed';
      console.warn('[AppUpdate] 檢查更新失敗:', error);
    }
    render();
  }

  async function checkForUpdate() {
    if (state === 'checking') return;
    state = 'checking';
    result = null;
    cloudflareTargetVersion = null;
    cloudflareProgressMessage = null;
    render();

    // Desktop packaged builds: this is the real, signed update channel —
    // check → (native accept/defer dialog) → on accept, restarts to apply.
    // A non-Electron panel (or dev/source-tree) reports "unavailable" and
    // this falls through to the legacy GitHub-release display-only check.
    if (typeof cloudflareCheck === 'function') {
      try {
        const cf = await cloudflareCheck();
        if (cf?.status && cf.status !== 'unavailable') {
          cloudflareTargetVersion = cf.targetVersion || null;
          if (cf.status === 'declined') state = 'cfDeclined';
          else if (cf.status === 'accept-failed') {
            state = 'cfAcceptFailed';
            // 這次真的下載/驗證/套用失敗了（不是使用者自己按延後）：問一次要不要
            // 順便回報。診斷紀錄檔（manual-update-debug.log）已經跟其他 log 存在
            // 同一個資料夾，既有的「附上診斷」流程會自動一起收進去，不用另外處理。
            window.AppFeedback?.showUpdateFailBanner?.({
              title: translate('appUpdate.failReportTitle'),
              actual: translate('appUpdate.failReportActual', { version: displayVersion(cloudflareTargetVersion) }),
            });
          }
          else if (cf.status === 'restarting') state = 'restarting';
          else if (cf.status === 'failed') state = 'failed';
          else state = 'latest'; // up-to-date
          render();
          return;
        }
      } catch (error) {
        console.warn('[AppUpdate] Cloudflare 檢查失敗，改用 GitHub Release 顯示:', error);
      }
    }

    await checkViaGitHubFallback();
  }

  async function restartForUpdate() {
    if (state !== 'available' || !result?.hasUpdate || typeof restart !== 'function') return;
    const accepted = await restart();
    if (accepted) {
      state = 'restarting';
      render();
    }
  }

  checkButton.addEventListener('click', () => { void checkForUpdate(); });
  restartButton.addEventListener('click', () => { void restartForUpdate(); });
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('i18n:change', render);
  }
  if (typeof onCloudflareProgress === 'function') {
    onCloudflareProgress((progress) => {
      if (state !== 'checking' || !progress?.message) return;
      cloudflareProgressMessage = progress.message;
      render();
    });
  }

  render();
  void loadCurrentVersion();
})();
