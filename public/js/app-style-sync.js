/**
 * 風格/模板預設按鈕 + 羅馬拼音顯示模式 + 舊版動畫微調控制項。
 *
 * 跟 lyric-extras.js 的歌詞外觀（lyricSettings，字體/顏色/位置 schema）是不同的關注點：
 * 這裡管的是經典疊層的風格預設（StylePresets）與羅馬拼音顯示模式，兩者職責不重疊，
 * 不需要合併到同一個檔案。
 */
(function () {
  'use strict';

  const { dom } = AppShared;

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
  // 動畫微調（舊版控制項，新版已由「歌詞外觀」面板取代；
  // 若 HTML 中不存在這些元件就跳過，避免空參考錯誤）
  // ═══════════════════════════════════════════

  if (dom.animSpeed) {
    dom.animSpeed.addEventListener('input', () => {
      const val = parseFloat(dom.animSpeed.value);
      dom.animSpeedVal.textContent = val.toFixed(1) + 'x';
      StylePresets.setOverrides({
        animation: {
          lineEnter: { duration: 0.6 / val },
          wordActive: { duration: 0.15 / val },
        },
      });
    });
  }

  if (dom.animBlur) {
    dom.animBlur.addEventListener('input', () => {
      const val = parseInt(dom.animBlur.value, 10);
      dom.animBlurVal.textContent = val + 'px';
      StylePresets.setOverrides({
        animation: {
          lineEnter: { blurFrom: val },
        },
      });
    });
  }

  if (dom.animLines) {
    dom.animLines.addEventListener('input', () => {
      const val = parseInt(dom.animLines.value, 10);
      dom.animLinesVal.textContent = val;
    });
  }

  if (dom.animFontsize) {
    dom.animFontsize.addEventListener('input', () => {
      const val = parseInt(dom.animFontsize.value, 10);
      dom.animFontsizeVal.textContent = val + 'px';
      document.documentElement.style.setProperty('--display-font-size', val + 'px');
    });
  }

  // ═══════════════════════════════════════════
  // OBS URL 複製
  // ═══════════════════════════════════════════

  function markObsCopied(button) {
    if (!button) return;
    const original = button.dataset.originalText || button.textContent;
    button.dataset.originalText = original;
    button.textContent = '已複製';
    setTimeout(() => { button.textContent = original; }, 2000);
  }

  function copyObsUrl(button) {
    const url = dom.obsUrl.textContent;
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

  if (dom.copyObsUrlTop) dom.copyObsUrlTop.addEventListener('click', () => copyObsUrl(dom.copyObsUrlTop));
  dom.copyObsUrl.addEventListener('click', () => copyObsUrl(dom.copyObsUrl));

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
      if (data.qrDataUrl) dom.lanInfoQr.src = data.qrDataUrl;
      dom.lanInfoBody.hidden = false;
      if (dom.copyLanUrl) dom.copyLanUrl.addEventListener('click', () => copyLanUrl(dom.copyLanUrl));
    }).catch(() => {
      dom.lanInfoLoading.hidden = true;
      dom.lanInfoError.hidden = false;
    });
  }

  // ═══════════════════════════════════════════
  // yt-dlp 版本檢查 / 更新
  // ═══════════════════════════════════════════

  if (dom.ytdlpCheckBtn) {
    const showMsg = (text) => {
      if (!dom.ytdlpMsg) return;
      dom.ytdlpMsg.textContent = text || '';
      dom.ytdlpMsg.hidden = !text;
    };

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
          } else {
            AppShared.showToast('yt-dlp 更新未成功', 'warning');
          }
        }).catch(() => showMsg('更新失敗：伺服器無回應。'))
          .finally(() => { dom.ytdlpUpdateBtn.disabled = false; });
      });
    }
  }
})();
