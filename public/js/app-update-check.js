/** 程式更新 UI：安全增量可用時直接安裝，不相容時回退完整 Windows Installer。 */
(function () {
  'use strict';

  const LOCALES = ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'];
  const CATALOGS = Object.freeze({
    'zh-TW': Object.freeze({
      intro: '有安全增量更新時可直接安裝；若目前版本或新版不相容，會改用完整 Windows Installer。',
      applyUpdate: '安裝更新',
      unknown: '未知',
      downloadInstaller: '下載 Installer',
      notificationsNotConfigured: '更新通知尚未設定。',
      useInstaller: '改用 Installer',
      availableIncremental: '有新版本 v{version}，可直接安裝。更新時程式會暫時關閉並自動重新啟動。',
      availableInstaller: '有新版本 v{version}。此版本無法安全使用增量更新，請改用完整 Installer（完整 Windows Installer）。',
      latest: '已是最新版本。',
      checking: '正在檢查更新…',
      checkUpdate: '檢查更新',
      checkFailed: '暫時無法檢查更新，請稍後再試。',
      confirmUnavailable: '無法開啟更新確認視窗。為避免誤操作，本次不會執行更新。',
      confirmTitle: '安裝 Elitesand Pro v{version}？',
      confirmSummary: '程式會暫時關閉，更新完成後自動重新啟動，通常約需 10～20 秒。',
      confirmImpact: '更新期間請勿手動重新開啟 Elitesand Pro。',
      applying: '正在下載並驗證更新。完成後 Elitesand Pro 會自動重新啟動，請勿手動重新開啟。',
      prepared: '更新已準備完成。Elitesand Pro 即將暫時關閉並自動重新啟動，請勿手動重新開啟。',
      applyFailed: '更新失敗。請重新檢查更新，或改用完整 Windows Installer。',
    }),
    en: Object.freeze({
      intro: 'Safe incremental updates can be installed directly. If either the current or new version is incompatible, use the full Windows Installer instead.',
      applyUpdate: 'Install update',
      unknown: 'Unknown',
      downloadInstaller: 'Download Installer',
      notificationsNotConfigured: 'Update notifications are not configured.',
      useInstaller: 'Use Installer instead',
      availableIncremental: 'Elitesand Pro v{version} is available and can be installed directly. The app will close briefly and restart automatically during the update.',
      availableInstaller: 'Elitesand Pro v{version} is available. This version cannot use incremental updates safely; download and run the full Windows Installer.',
      latest: 'You are up to date.',
      checking: 'Checking for updates…',
      checkUpdate: 'Check for updates',
      checkFailed: 'Unable to check for updates right now. Please try again later.',
      confirmUnavailable: 'The update confirmation dialog could not be opened. The update will not run to avoid an accidental action.',
      confirmTitle: 'Install Elitesand Pro v{version}?',
      confirmSummary: 'The app will close briefly and restart automatically when the update finishes. This usually takes about 10–20 seconds.',
      confirmImpact: 'Do not reopen Elitesand Pro manually while the update is in progress.',
      applying: 'Downloading and verifying the update. Elitesand Pro will restart automatically when it finishes. Do not reopen it manually.',
      prepared: 'The update is ready. Elitesand Pro will close briefly and restart automatically. Do not reopen it manually.',
      applyFailed: 'The update failed. Check for updates again, or use the full Windows Installer.',
    }),
    ja: Object.freeze({
      intro: '安全な差分更新が利用できる場合は、そのままインストールできます。現在のバージョンまたは新しいバージョンが差分更新に対応していない場合は、完全版の Windows インストーラーを使用します。',
      applyUpdate: '更新をインストール',
      unknown: '不明',
      downloadInstaller: 'インストーラーをダウンロード',
      notificationsNotConfigured: '更新通知が設定されていません。',
      useInstaller: 'インストーラーを使用',
      availableIncremental: '新しいバージョン v{version} を利用できます。そのままインストールできます。更新中はアプリが一時的に終了し、完了後に自動で再起動します。',
      availableInstaller: '新しいバージョン v{version} を利用できます。このバージョンでは安全に差分更新できないため、完全版の Windows インストーラーをダウンロードして実行してください。',
      latest: '最新バージョンです。',
      checking: '更新を確認しています…',
      checkUpdate: '更新を確認',
      checkFailed: '現在、更新を確認できません。しばらくしてからもう一度お試しください。',
      confirmUnavailable: '更新の確認画面を開けませんでした。誤操作を防ぐため、今回は更新を実行しません。',
      confirmTitle: 'Elitesand Pro v{version} をインストールしますか？',
      confirmSummary: 'アプリはいったん終了し、更新完了後に自動で再起動します。通常は約10～20秒かかります。',
      confirmImpact: '更新中は Elitesand Pro を手動で起動しないでください。',
      applying: '更新をダウンロードして検証しています。完了後に Elitesand Pro が自動で再起動します。手動で起動しないでください。',
      prepared: '更新の準備が完了しました。Elitesand Pro はまもなく一時終了し、自動で再起動します。手動で起動しないでください。',
      applyFailed: '更新に失敗しました。もう一度更新を確認するか、完全版の Windows インストーラーを使用してください。',
    }),
    ko: Object.freeze({
      intro: '안전한 증분 업데이트를 사용할 수 있으면 바로 설치할 수 있습니다. 현재 버전이나 새 버전이 호환되지 않으면 전체 Windows 설치 프로그램을 사용합니다.',
      applyUpdate: '업데이트 설치',
      unknown: '알 수 없음',
      downloadInstaller: '설치 프로그램 다운로드',
      notificationsNotConfigured: '업데이트 알림이 설정되어 있지 않습니다.',
      useInstaller: '설치 프로그램 사용',
      availableIncremental: '새 버전 v{version}을 사용할 수 있으며 바로 설치할 수 있습니다. 업데이트 중에는 앱이 잠시 종료되고 완료 후 자동으로 다시 실행됩니다.',
      availableInstaller: '새 버전 v{version}을 사용할 수 있습니다. 이 버전에서는 증분 업데이트를 안전하게 사용할 수 없으므로 전체 Windows 설치 프로그램을 다운로드해 실행하세요.',
      latest: '최신 버전입니다.',
      checking: '업데이트 확인 중…',
      checkUpdate: '업데이트 확인',
      checkFailed: '지금은 업데이트를 확인할 수 없습니다. 잠시 후 다시 시도하세요.',
      confirmUnavailable: '업데이트 확인 창을 열 수 없습니다. 실수로 업데이트가 실행되지 않도록 이번 업데이트는 진행하지 않습니다.',
      confirmTitle: 'Elitesand Pro v{version}을 설치할까요?',
      confirmSummary: '앱이 잠시 종료되며 업데이트가 끝나면 자동으로 다시 실행됩니다. 보통 약 10~20초가 걸립니다.',
      confirmImpact: '업데이트 중에는 Elitesand Pro를 직접 다시 실행하지 마세요.',
      applying: '업데이트를 다운로드하고 검증하는 중입니다. 완료되면 Elitesand Pro가 자동으로 다시 실행됩니다. 직접 실행하지 마세요.',
      prepared: '업데이트 준비가 완료되었습니다. Elitesand Pro가 곧 잠시 종료된 뒤 자동으로 다시 실행됩니다. 직접 실행하지 마세요.',
      applyFailed: '업데이트에 실패했습니다. 업데이트를 다시 확인하거나 전체 Windows 설치 프로그램을 사용하세요.',
    }),
    'zh-CN': Object.freeze({
      intro: '有安全的增量更新时可直接安装；如果当前版本或新版本不兼容，将改用完整 Windows 安装程序。',
      applyUpdate: '安装更新',
      unknown: '未知',
      downloadInstaller: '下载安装程序',
      notificationsNotConfigured: '尚未配置更新通知。',
      useInstaller: '改用安装程序',
      availableIncremental: '有新版本 v{version}，可直接安装。更新时程序会暂时关闭，并在完成后自动重新启动。',
      availableInstaller: '有新版本 v{version}。此版本无法安全使用增量更新，请下载并运行完整 Windows 安装程序。',
      latest: '已是最新版本。',
      checking: '正在检查更新…',
      checkUpdate: '检查更新',
      checkFailed: '暂时无法检查更新，请稍后重试。',
      confirmUnavailable: '无法打开更新确认窗口。为避免误操作，本次不会执行更新。',
      confirmTitle: '安装 Elitesand Pro v{version}？',
      confirmSummary: '程序会暂时关闭，更新完成后自动重新启动，通常约需 10～20 秒。',
      confirmImpact: '更新期间请勿手动重新打开 Elitesand Pro。',
      applying: '正在下载并验证更新。完成后 Elitesand Pro 会自动重新启动，请勿手动重新打开。',
      prepared: '更新已准备完成。Elitesand Pro 即将暂时关闭并自动重新启动，请勿手动重新打开。',
      applyFailed: '更新失败。请重新检查更新，或改用完整 Windows 安装程序。',
    }),
  });

  function currentLocale() {
    const fromI18n = window.I18n && typeof window.I18n.current === 'function'
      ? window.I18n.current()
      : null;
    if (LOCALES.includes(fromI18n)) return fromI18n;
    const htmlLocale = document.documentElement && document.documentElement.lang;
    return LOCALES.includes(htmlLocale) ? htmlLocale : 'zh-TW';
  }

  function interpolate(value, params) {
    let output = String(value == null ? '' : value);
    Object.entries(params || {}).forEach(([key, replacement]) => {
      output = output.replaceAll(`{${key}}`, String(replacement));
    });
    return output;
  }

  function text(key, params) {
    const locale = currentLocale();
    const row = CATALOGS[locale] || CATALOGS['zh-TW'];
    return interpolate(row[key] || CATALOGS['zh-TW'][key] || key, params);
  }

  window.AppUpdateI18n = Object.freeze({
    locales: Object.freeze(LOCALES.slice()),
    catalogs: CATALOGS,
    currentLocale,
    text,
  });

  const currentEl = document.getElementById('app-version-current');
  const statusEl = document.getElementById('app-update-status');
  const checkBtn = document.getElementById('app-update-check-btn');
  const linkEl = document.getElementById('app-update-link');
  const introEl = document.querySelector('#app-update-card .section-intro');
  if (!currentEl || !statusEl || !checkBtn || !linkEl) return;

  const applyBtn = document.createElement('button');
  applyBtn.id = 'app-update-apply-btn';
  applyBtn.className = 'btn btn-sm btn-primary';
  applyBtn.type = 'button';
  applyBtn.hidden = true;
  linkEl.parentElement?.insertBefore(applyBtn, linkEl);

  let latestPlan = null;
  let applying = false;
  let checking = false;
  let statusMode = 'plan';

  function renderPlan() {
    currentEl.textContent = latestPlan?.currentVersion ? `v${latestPlan.currentVersion}` : text('unknown');
    applyBtn.hidden = true;
    linkEl.hidden = true;
    linkEl.textContent = text('downloadInstaller');

    if (!latestPlan?.enabled) {
      statusEl.textContent = text('notificationsNotConfigured');
      return;
    }
    if (latestPlan.hasUpdate && latestPlan.latestVersion) {
      const updateUrl = latestPlan.downloadUrl || latestPlan.releaseUrl;
      linkEl.hidden = !updateUrl;
      if (updateUrl) linkEl.href = updateUrl;

      if (latestPlan.canIncremental) {
        applyBtn.hidden = false;
        linkEl.textContent = text('useInstaller');
        statusEl.textContent = text('availableIncremental', { version: latestPlan.latestVersion });
      } else {
        statusEl.textContent = text('availableInstaller', { version: latestPlan.latestVersion });
      }
      return;
    }
    statusEl.textContent = text('latest');
  }

  function renderLocale() {
    if (introEl) introEl.textContent = text('intro');
    applyBtn.textContent = text('applyUpdate');
    checkBtn.textContent = checking ? text('checking') : text('checkUpdate');

    if (statusMode === 'checking') {
      currentEl.textContent = latestPlan?.currentVersion ? `v${latestPlan.currentVersion}` : text('unknown');
      statusEl.textContent = text('checking');
      return;
    }
    if (statusMode === 'checkFailed') { statusEl.textContent = text('checkFailed'); return; }
    if (statusMode === 'confirmUnavailable') { statusEl.textContent = text('confirmUnavailable'); return; }
    if (statusMode === 'applying') { statusEl.textContent = text('applying'); return; }
    if (statusMode === 'prepared') { statusEl.textContent = text('prepared'); return; }
    if (statusMode === 'applyFailed') { statusEl.textContent = text('applyFailed'); return; }
    renderPlan();
  }

  async function readJson(response) {
    const raw = await response.text();
    try { return JSON.parse(raw); } catch (_) { throw new Error(raw || `HTTP ${response.status}`); }
  }

  async function check(force) {
    if (applying) return;
    checking = true;
    statusMode = 'checking';
    checkBtn.disabled = true;
    renderLocale();
    try {
      const response = await fetch(`/api/app-update/plan${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      latestPlan = data;
      statusMode = 'plan';
    } catch (err) {
      console.error('[AppUpdate] update check failed:', err);
      statusMode = 'checkFailed';
    } finally {
      checking = false;
      checkBtn.disabled = false;
      renderLocale();
    }
  }

  async function applyUpdate() {
    if (applying || !latestPlan?.hasUpdate || !latestPlan?.canIncremental) return;
    if (!window.PanelConfirm || typeof window.PanelConfirm.request !== 'function') {
      statusMode = 'confirmUnavailable';
      renderLocale();
      return;
    }

    const confirmed = await window.PanelConfirm.request({
      title: text('confirmTitle', { version: latestPlan.latestVersion }),
      summary: text('confirmSummary'),
      impact: text('confirmImpact'),
      confirmLabel: text('applyUpdate'),
      tone: 'neutral',
    });
    if (!confirmed) return;

    applying = true;
    statusMode = 'applying';
    applyBtn.disabled = true;
    checkBtn.disabled = true;
    linkEl.hidden = true;
    renderLocale();

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
        throw new Error(data.reason || data.error || `HTTP ${response.status}`);
      }
      statusMode = 'prepared';
      renderLocale();
    } catch (err) {
      console.error('[AppUpdate] update apply failed:', err);
      applying = false;
      statusMode = 'applyFailed';
      applyBtn.disabled = false;
      checkBtn.disabled = false;
      linkEl.hidden = !(latestPlan?.downloadUrl || latestPlan?.releaseUrl);
      renderLocale();
    }
  }

  checkBtn.addEventListener('click', () => check(true));
  applyBtn.addEventListener('click', applyUpdate);
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('i18n:change', renderLocale);
  }
  renderLocale();
  check(false);
})();
