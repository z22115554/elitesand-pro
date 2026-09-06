/**
 * 風格/模板預設按鈕 + 羅馬拼音顯示模式 + OBS URL／區網配對。
 *
 * （2026-09 死碼清理：舊版「動畫微調」滑桿接線已移除——對應的 anim-speed／blur／
 *   lines／fontsize 元素早就不在任何 HTML 裡，功能已由「歌詞外觀」面板取代。）
 *
 * 跟 lyric-extras.js 的歌詞外觀（lyricSettings，字體/顏色/位置 schema）是不同的關注點：
 * 這裡管的是經典疊層的風格預設（StylePresets）與羅馬拼音顯示模式，兩者職責不重疊，
 * 不需要合併到同一個檔案。
 */
(function () {
  'use strict';

  const { dom } = AppShared;
  const t = (key, vars) => window.I18n ? window.I18n.t(key, vars) : key;
  const COMPATIBILITY_MESSAGE_KEYS = {
    '尚未驗證 YouTube 相容性': 'system.compatNotRun',
    '找不到 yt-dlp，無法驗證 YouTube 相容性。': 'system.compatMissing',
    '驗證 YouTube 相容性逾時；請檢查網路後重試。': 'system.compatTimeout',
    'yt-dlp 目前無法讀取 YouTube；請先檢查或更新 yt-dlp，再重試。': 'system.compatFailed',
    '正在驗證 YouTube 相容性（不會下載音檔）': 'system.compatRunning',
    '已確認 yt-dlp 可以讀取 YouTube（未下載任何音檔）。': 'system.compatOk',
    '無法讀取 YouTube 相容性狀態': 'system.compatReadFailed',
  };
  const compatibilityText = (message) => t(COMPATIBILITY_MESSAGE_KEYS[message] || 'system.compatNotRun');

  // ═══════════════════════════════════════════
  // 風格切換
  // ═══════════════════════════════════════════

  // 縮圖顏色直接取風格自己的 cssVars.--active-color（styles.js 單一事實來源），
  // 不在 HTML/CSS 另外寫一份顏色，換風格參數時縮圖會自動同步。
  // 注意範圍必須限定 #style-buttons：.style-thumb 這個 class 也被模板/強度/歌詞位置
  // 縮圖共用，用全域選擇器會把點擊模板按鈕誤發成 style:change undefined（實際踩過）。
  document.querySelectorAll('#style-buttons .style-thumb').forEach((btn) => {
    const preset = StylePresets.presets[btn.dataset.style];
    const charEl = btn.querySelector('.style-thumb-char');
    if (preset && charEl) charEl.style.color = preset.cssVars['--active-color'] || '#fff';
    btn.addEventListener('click', () => {
      document.querySelectorAll('#style-buttons .style-thumb').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const style = btn.dataset.style;
      StylePresets.setStyle(style);
      SocketClient.send('style:change', style);
    });
  });

  let styleCycleIndex = 0;
  const styleNames = StylePresets.getStyleNames();

  dom.btnStyle.addEventListener('click', () => {
    styleCycleIndex = (styleCycleIndex + 1) % styleNames.length;
    const style = styleNames[styleCycleIndex];
    StylePresets.setStyle(style);
    SocketClient.send('style:change', style);

    document.querySelectorAll('#style-buttons .style-thumb').forEach((b) => {
      b.classList.toggle('active', b.dataset.style === style);
    });
  });

  // ═══════════════════════════════════════════
  // 羅馬拼音
  // ═══════════════════════════════════════════

  dom.romanizationMode.addEventListener('change', () => {
    const mode = dom.romanizationMode.value;
    SocketClient.send('romanization:mode', mode);
  });

  dom.btnRomanization.addEventListener('click', () => {
    const modes = ['original', 'both', 'xieyin', 'full'];
    const currentIdx = modes.indexOf(dom.romanizationMode.value);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    dom.romanizationMode.value = nextMode;
    SocketClient.send('romanization:mode', nextMode);
  });

  // ═══════════════════════════════════════════
  // OBS URL 複製
  // ═══════════════════════════════════════════

  function markObsCopied(button) {
    if (!button) return;
    const original = button.dataset.originalText || button.textContent;
    button.dataset.originalText = original;
    button.textContent = window.I18n ? window.I18n.t('common.copied') : '已複製';
    setTimeout(() => { button.textContent = original; }, 2000);
  }

  // 網址刻意不帶 ?lang=：帶了就等於把貼進 OBS 的那一刻的語言釘死，之後在面板換語言
  // 疊加層不會跟著變（OBS 是另一個瀏覽器 profile，看不到面板的語言偏好）。改由
  // 「OBS 顯示語言」設定經 obs-locale:update 即時推給疊加層。?lang= 保留給想手動
  // 釘死語言的進階用法，obs-locale-follow.js 看到它就不理會廣播。
  function buildObsUrl({ preview = false, relative = false } = {}) {
    const url = new URL('/display', window.location.origin);
    if (preview) url.searchParams.set('preview', '1');
    if (!preview && typeof AccessAuth !== 'undefined' && AccessAuth.sourceToken()) url.searchParams.set('source', AccessAuth.sourceToken());
    return relative ? `${url.pathname}${url.search}` : url.toString();
  }

  function refreshObsUrls() {
    const url = buildObsUrl();
    if (dom.obsUrl) dom.obsUrl.textContent = url;
    if (dom.settingsPreviewObsUrl) dom.settingsPreviewObsUrl.textContent = url;
    const previewUrl = buildObsUrl({ preview: true, relative: true });
    document.querySelectorAll('iframe.obs-preview').forEach((frame) => {
      frame.dataset.previewSrc = previewUrl;
      if (frame.hasAttribute('src') && frame.getAttribute('src') !== previewUrl) frame.setAttribute('src', previewUrl);
    });
  }

  function copyObsUrl(button) {
    const url = buildObsUrl();
    navigator.clipboard.writeText(url).then(() => {
      markObsCopied(button);
    }).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markObsCopied(button);
    });
  }

  function refreshAccessStatus() {
    const request = typeof PinAuth !== 'undefined' ? PinAuth.fetchWithPin('/api/access/status', { cache: 'no-store' }) : fetch('/api/access/status', { cache: 'no-store' });
    return request.then((res) => {
      if (!res.ok) throw new Error('Unable to load local access status');
      return res.json();
    }).then((data) => {
      if (typeof AccessAuth !== 'undefined') AccessAuth.setSourceToken(data.sourceToken || '');
      refreshObsUrls();
      window.dispatchEvent(new Event('access:source-token'));
      return data;
    });
  }

  refreshObsUrls();
  refreshAccessStatus().catch(() => { /* The desktop may still be starting; URLs refresh again on reload. */ });
  window.addEventListener('i18n:change', refreshObsUrls);
  if (dom.copyObsUrlTop) dom.copyObsUrlTop.addEventListener('click', () => copyObsUrl(dom.copyObsUrlTop));
  if (dom.copyObsUrl) dom.copyObsUrl.addEventListener('click', () => copyObsUrl(dom.copyObsUrl));
  if (dom.copyObsUrlSettingsPreview) dom.copyObsUrlSettingsPreview.addEventListener('click', () => copyObsUrl(dom.copyObsUrlSettingsPreview));

  // ═══════════════════════════════════════════
  // OBS 顯示語言
  // ═══════════════════════════════════════════
  //
  // 疊加層的語言不能靠網址帶：/display 與 /setlist 在 OBS 裡是獨立的瀏覽器 profile，
  // 讀不到面板的語言偏好，也不會知道面板中途換了語言。所以語言存在伺服器 state，
  // 由 obs-locale:update 專屬事件即時推給疊加層（不能走 broadcastState，鐵則 5）。
  //
  // 面板自己的介面語言仍然是純裝置端偏好（localStorage），這裡只是把「目前是哪個語言」
  // 回報給伺服器，好讓選「跟隨面板語言」的疊加層跟得上。

  const obsLocaleSel = document.getElementById('obs-locale');
  let obsLocaleKnownPanelLocale = null;

  function reportPanelLocale() {
    if (!window.I18n) return;
    const locale = window.I18n.current();
    if (locale === obsLocaleKnownPanelLocale) return;
    obsLocaleKnownPanelLocale = locale;
    SocketClient.send('obs-locale:panel', { locale });
  }

  if (obsLocaleSel) {
    obsLocaleSel.addEventListener('change', () => {
      SocketClient.send('obs-locale:set', { mode: obsLocaleSel.value });
    });
  }

  // 伺服器在面板完成 client:type 註冊後就會送一份現況過來，所以這裡同時當作
  // 「連上線了」的訊號：把面板當下的語言回報上去，不必自己猜連線時機。
  SocketClient.on('obs-locale:update', (payload) => {
    if (!payload) return;
    if (obsLocaleSel && payload.mode && obsLocaleSel.value !== payload.mode) obsLocaleSel.value = payload.mode;
    obsLocaleKnownPanelLocale = payload.panelLocale || obsLocaleKnownPanelLocale;
    reportPanelLocale();
  });

  window.addEventListener('i18n:change', reportPanelLocale);

  // ═══════════════════════════════════════════
  // 手機遙控器：區網 IP + QR code
  // ═══════════════════════════════════════════

  function copyLanUrl(button) {
    const url = dom.lanInfoUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      markObsCopied(button);
    }).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markObsCopied(button);
    });
  }

  if (dom.lanInfoLoading) {
    fetch('/api/lan-info').then((res) => res.json()).then((data) => {
      dom.lanInfoLoading.hidden = true;
      if (!data || !data.controllerUrl) {
        dom.lanInfoError.hidden = false;
        return;
      }
      dom.lanInfoUrl.textContent = data.controllerUrl;
      dom.lanInfoBody.hidden = false;
      if (dom.copyLanUrl) dom.copyLanUrl.addEventListener('click', () => copyLanUrl(dom.copyLanUrl));
    }).catch(() => {
      dom.lanInfoLoading.hidden = true;
      dom.lanInfoError.hidden = false;
    });
  }

  const pairingButton = document.getElementById('start-controller-pairing');
  const revokeButton = document.getElementById('revoke-controller-pairings');
  const pairingStatus = document.getElementById('controller-pairing-status');
  let pairingStatusState = { kind: 'idle' };

  function pairingStatusText() {
    switch (pairingStatusState.kind) {
      case 'creating':
        return t('system.pairingCreating');
      case 'created':
        return t('system.pairingCreated', { minutes: pairingStatusState.minutes });
      case 'revoked':
        return t('system.pairingRevoked', { count: pairingStatusState.count });
      case 'createFailed':
        return pairingStatusState.message || t('system.pairingCreateFailed');
      case 'revokeFailed':
        return pairingStatusState.message || t('system.pairingRevokeFailed');
      default:
        return t('system.pairingIdle');
    }
  }

  function renderPairingStatus() {
    if (pairingStatus) pairingStatus.textContent = pairingStatusText();
  }

  if (pairingButton) {
    pairingButton.addEventListener('click', async () => {
      pairingButton.disabled = true;
      pairingStatusState = { kind: 'creating' };
      renderPairingStatus();
      try {
        const request = typeof PinAuth !== 'undefined'
          ? PinAuth.fetchWithPin('/api/access/pairing/start', { method: 'POST' })
          : fetch('/api/access/pairing/start', { method: 'POST' });
        const response = await request;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to start pairing');
        if (dom.lanInfoQr) dom.lanInfoQr.src = data.qrDataUrl;
        if (dom.lanInfoUrl) dom.lanInfoUrl.textContent = data.controllerUrl;
        pairingStatusState = {
          kind: 'created',
          minutes: Math.max(1, Math.ceil((data.expiresAt - Date.now()) / 60000)),
        };
        renderPairingStatus();
      } catch (error) {
        pairingStatusState = { kind: 'createFailed', message: error.message || '' };
        renderPairingStatus();
      } finally {
        pairingButton.disabled = false;
      }
    });
  }
  if (revokeButton) {
    revokeButton.addEventListener('click', async () => {
      const accepted = typeof PanelConfirm !== 'undefined'
        ? await PanelConfirm.request({
          title: t('system.pairingRevokeAll'),
          summary: t('system.pairingRevokeSummary'),
          impact: t('system.pairingRevokeImpact'),
          confirmLabel: t('system.pairingRevokeConfirm'),
        })
        : false;
      if (!accepted) return;
      revokeButton.disabled = true;
      try {
        const request = typeof PinAuth !== 'undefined'
          ? PinAuth.fetchWithPin('/api/access/controllers/revoke', { method: 'POST' })
          : fetch('/api/access/controllers/revoke', { method: 'POST' });
        const response = await request;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to revoke controllers');
        pairingStatusState = { kind: 'revoked', count: data.revoked };
        renderPairingStatus();
      } catch (error) {
        pairingStatusState = { kind: 'revokeFailed', message: error.message || '' };
        renderPairingStatus();
      } finally {
        revokeButton.disabled = false;
      }
    });
  }
  window.addEventListener('i18n:change', renderPairingStatus);

  // ═══════════════════════════════════════════
  // yt-dlp 版本檢查 / 更新
  // ═══════════════════════════════════════════

  if (dom.ytdlpCheckBtn) {
    const showMsg = (text) => {
      if (!dom.ytdlpMsg) return;
      dom.ytdlpMsg.textContent = text || '';
      dom.ytdlpMsg.hidden = !text;
    };

    let compatibilityRefreshTimer = null;
    // t() 的結果不會被語系層自動重繪（它只重繪 [data-i18n] 與長尾文字節點），
    // 而首次 fetch 可能在 I18n.init 之前就回來；留著原始 payload 才能重畫。
    let lastCompatibility = null;
    const renderCompatibility = (data) => {
      if (!dom.ytdlpCompatibilityStatus || !data) return;
      lastCompatibility = data;
      dom.ytdlpCompatibilityStatus.textContent = compatibilityText(data.message);
      if (compatibilityRefreshTimer) clearTimeout(compatibilityRefreshTimer);
      compatibilityRefreshTimer = null;
      if (data.state === 'running') {
        compatibilityRefreshTimer = setTimeout(() => refreshCompatibility(), 1200);
      }
    };
    const refreshCompatibility = async () => {
      try {
        const response = await fetch('/api/ytdlp/compatibility', { cache: 'no-store' });
        if (!response.ok) throw new Error('狀態讀取失敗');
        renderCompatibility(await response.json());
      } catch (_) {
        if (dom.ytdlpCompatibilityStatus) dom.ytdlpCompatibilityStatus.textContent = t('system.compatReadFailed');
      }
    };
    if (dom.ytdlpCompatibilityBtn) {
      dom.ytdlpCompatibilityBtn.addEventListener('click', async () => {
        dom.ytdlpCompatibilityBtn.disabled = true;
        if (dom.ytdlpCompatibilityStatus) dom.ytdlpCompatibilityStatus.textContent = t('system.compatRunning');
        try {
          const request = typeof PinAuth !== 'undefined'
            ? PinAuth.fetchWithPin('/api/ytdlp/compatibility', { method: 'POST' })
            : fetch('/api/ytdlp/compatibility', { method: 'POST' });
          const response = await request;
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || '驗證失敗');
          renderCompatibility(data);
        } catch (err) {
          if (dom.ytdlpCompatibilityStatus) dom.ytdlpCompatibilityStatus.textContent = `YouTube 相容性驗證失敗：${err.message}`;
        } finally {
          dom.ytdlpCompatibilityBtn.disabled = false;
        }
      });
      refreshCompatibility();
      window.addEventListener('i18n:change', () => {
        if (lastCompatibility) renderCompatibility(lastCompatibility);
      });
    }

    const applyCheck = (data) => {
      if (!data || !data.available) {
        dom.ytdlpVersion.textContent = '找不到 yt-dlp（YouTube 匯入需要它）';
        dom.ytdlpUpdateRow.hidden = true;
        return;
      }
      dom.ytdlpVersion.textContent = data.currentVersion || '未知';
      if (data.hasUpdate && data.latestVersion) {
        dom.ytdlpLatest.textContent = `最新：${data.latestVersion}`;
        dom.ytdlpUpdateRow.hidden = false;
      } else {
        dom.ytdlpUpdateRow.hidden = true;
        if (data.latestVersion) showMsg('已是最新版本。');
      }
    };

    dom.ytdlpCheckBtn.addEventListener('click', () => {
      dom.ytdlpCheckBtn.disabled = true;
      dom.ytdlpVersion.textContent = '檢查中…';
      showMsg('');
      fetch('/api/ytdlp/check?force=1').then((r) => r.json()).then(applyCheck)
        .catch(() => { dom.ytdlpVersion.textContent = '檢查失敗'; })
        .finally(() => { dom.ytdlpCheckBtn.disabled = false; });
    });

    if (dom.ytdlpUpdateBtn) {
      dom.ytdlpUpdateBtn.addEventListener('click', () => {
        dom.ytdlpUpdateBtn.disabled = true;
        showMsg('更新中…（需下載新版，可能要十幾秒）');
        // 受保護路由：用 PinAuth.fetchWithPin，PIN 啟用時才不會被自己伺服器 401
        const doFetch = (typeof PinAuth !== 'undefined')
          ? PinAuth.fetchWithPin('/api/ytdlp/update', { method: 'POST' })
          : fetch('/api/ytdlp/update', { method: 'POST' });
        doFetch.then((r) => r.json()).then((data) => {
          showMsg(data.message || (data.ok ? '更新完成' : '更新失敗'));
          if (data.ok) {
            if (data.currentVersion) dom.ytdlpVersion.textContent = data.currentVersion;
            dom.ytdlpUpdateRow.hidden = true;
            AppShared.showToast('yt-dlp 已更新', 'success');
            setTimeout(() => refreshCompatibility(), 300);
          } else {
            AppShared.showToast('yt-dlp 更新未成功', 'warning');
          }
        }).catch(() => showMsg('更新失敗：伺服器無回應。'))
          .finally(() => { dom.ytdlpUpdateBtn.disabled = false; });
      });
    }
  }
})();
