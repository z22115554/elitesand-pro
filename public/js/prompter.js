/**
 * 跟唱視圖 —— 給主播自己看的整句歌詞（不逐字），左邊播放清單、右邊歌詞、下面播放器。
 * 純顯示 + 遠端遙控：跟 /controller 一樣不擁有音訊本體，播放/暫停/上下首只送 socket 指令，
 * 真正動到 <audio> 的仍是控制面板（app-playback.js）。
 *
 * 時間軸只需要「目前唱到哪一句」的精確度，不像 /display 的逐字模板要 60fps 內插，
 * 所以用簡單的輪詢時鐘（setInterval）取代 display.js 那套 smoothClock，足夠且好懂。
 */
(function () {
  'use strict';

  const { formatTime, escapeHtml, safeHttpUrl } = SharedUtils;
  const t = (key, values) => (
    typeof window !== 'undefined' && window.I18n ? window.I18n.t(key, values) : key
  );

  SocketClient.init('prompter');

  // ─── 簡轉繁（opencc-js cn→tw）：與 karaoke.js／setlist.js 同一套轉換邏輯，套用在歌詞文字上。
  // 這裡是獨立頁面，有自己的 opencc-cn2t.js 載入與轉換快取，不共用其他頁面的實例。
  let s2tEnabled = true; // 預設開啟；實際值以伺服器同步的 lyricSettings.convertTraditional 為準
  let _s2tConv = null;
  function getS2T() {
    if (_s2tConv) return _s2tConv;
    try {
      if (typeof OpenCC !== 'undefined' && OpenCC.Converter) _s2tConv = OpenCC.Converter({ from: 'cn', to: 'tw' });
    } catch (e) { _s2tConv = null; }
    return _s2tConv;
  }
  function s2t(str) {
    if (!s2tEnabled || !str) return str;
    const conv = getS2T();
    if (!conv) return str;
    try { return conv(str); } catch (e) { return str; }
  }

  const dom = {
    connectionStatus: document.getElementById('connection-status'),
    connectionText: document.getElementById('connection-text'),
    playlist: document.getElementById('pt-playlist'),
    lyrics: document.getElementById('pt-lyrics'),
    npTitle: document.getElementById('pt-np-title'),
    npArtist: document.getElementById('pt-np-artist'),
    btnPrev: document.getElementById('pt-btn-prev'),
    btnPlay: document.getElementById('pt-btn-play'),
    playIcon: document.getElementById('pt-play-icon'),
    btnNext: document.getElementById('pt-btn-next'),
    timeCurrent: document.getElementById('pt-time-current'),
    timeTotal: document.getElementById('pt-time-total'),
    progressTrack: document.getElementById('pt-progress-track'),
    progressFill: document.getElementById('pt-progress-fill'),
    progressThumb: document.querySelector('.pt-progress-thumb'),
    settingsBtn: document.getElementById('pt-settings-btn'),
    settingsModal: document.getElementById('pt-settings-modal'),
    settingsClose: document.getElementById('pt-settings-close'),
    setFont: document.getElementById('pt-set-font'),
    fontLocalGroup: document.getElementById('pt-font-local'),
    fontStatus: document.getElementById('pt-font-status'),
    setSize: document.getElementById('pt-set-size'),
    setSizeVal: document.getElementById('pt-set-size-val'),
    setColor: document.getElementById('pt-set-color'),
    setStrokeW: document.getElementById('pt-set-stroke-w'),
    setStrokeWVal: document.getElementById('pt-set-stroke-w-val'),
    setStrokeC: document.getElementById('pt-set-stroke-c'),
    setRomaji: document.getElementById('pt-set-romaji'),
    setXieyin: document.getElementById('pt-set-xieyin'),
    setFurigana: document.getElementById('pt-set-furigana'),
    setReset: document.getElementById('pt-set-reset'),
  };

  // ═══════════════════════════════════════════
  // 歌詞外觀設定（只存這台裝置的 localStorage，不是伺服器 state.json 的一部分——
  // 純粹是「這台螢幕看起來要多大多粗」的個人偏好，不影響 OBS 或其他裝置）
  // ═══════════════════════════════════════════
  const APPEARANCE_KEY = 'es-prompter-appearance';
  const FONT_STACKS = {
    default: 'var(--font)',
    serif: "'Noto Serif TC', Georgia, 'Times New Roman', serif",
    mono: "ui-monospace, 'JetBrains Mono', 'Noto Sans Mono TC', monospace",
    system: "system-ui, -apple-system, 'Noto Sans TC', sans-serif",
  };
  const LOCAL_FONT_PREFIX = 'local:';
  const FONT_FALLBACK = "'Noto Sans TC', 'Microsoft JhengHei', system-ui, sans-serif";
  const DEFAULT_APPEARANCE = {
    font: 'default', fontAssetId: '', size: 27, color: '#f2f3f5', strokeWidth: 0, strokeColor: '#000000',
    // 預設關閉：跟 OBS 顯示端的 romanizationMode 預設 'original' 一致，沒資料的歌不會顯示空行。
    showRomaji: false, showXieyin: false, showFurigana: false,
  };

  function localFontValue(family) { return `${LOCAL_FONT_PREFIX}${family}`; }
  function localFontFamily(value) {
    return typeof value === 'string' && value.startsWith(LOCAL_FONT_PREFIX)
      ? value.slice(LOCAL_FONT_PREFIX.length).trim()
      : '';
  }
  // 家族名稱 → 這款字所有可用於 CSS font-family 比對的候選名稱（含自己）。伺服器解析字型檔
  // 的 name 表時，同一款字常有一個以上「家族名稱」（nameID 1 相容家族／16 印刷家族），
  // 作業系統實際拿去比對已安裝字型的是哪一個因字型而異——只套用我們選的那一個名稱，
  // 對不上系統註冊名稱時會整組靜默 fallback 回預設字體（2026-08-24 使用者實測「辰宇落雁體
  // 2.0」踩到這個坑）。改成把整組候選都放進 font-family 堆疊，任何一個系統認得就會生效。
  let localFontAliases = {};
  let localFontAssets = {};
  function quoteFontFamily(family) {
    if (!family) return FONT_STACKS.default;
    const candidates = (Array.isArray(localFontAliases[family]) && localFontAliases[family].length)
      ? localFontAliases[family] : [family];
    const quoted = candidates
      .map((name) => `'${String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
      .join(', ');
    return `${quoted}, ${FONT_FALLBACK}`;
  }
  function resolveFontStack(value) {
    const local = localFontFamily(value);
    return local ? quoteFontFamily(local) : (FONT_STACKS[value] || FONT_STACKS.default);
  }

  function loadAppearance() {
    try {
      const raw = localStorage.getItem(APPEARANCE_KEY);
      if (!raw) return { ...DEFAULT_APPEARANCE };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_APPEARANCE, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch (e) { return { ...DEFAULT_APPEARANCE }; }
  }
  function saveAppearance(appearance) {
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); } catch (e) { /* 靜默：無痕模式等環境可能拒絕寫入 */ }
  }

  let appearance = loadAppearance();

  let fontAssetApplyVersion = 0;

  function applyAppearance() {
    const r = dom.lyrics.style;
    const fallbackStack = resolveFontStack(appearance.font);
    r.setProperty('--pt-font', fallbackStack);
    const version = ++fontAssetApplyVersion;
    const assetId = appearance.fontAssetId;
    if (window.ElitesandFontAssets?.isAssetId?.(assetId)) {
      window.ElitesandFontAssets.load(assetId).then((asset) => {
        if (version === fontAssetApplyVersion) r.setProperty('--pt-font', `'${asset.family}', ${fallbackStack}`);
      }).catch(() => {
        if (version === fontAssetApplyVersion) setFontStatus('prompter.fontUnavailable');
      });
    }
    r.setProperty('--pt-size', `${appearance.size}px`);
    r.setProperty('--pt-color', appearance.color);
    r.setProperty('--pt-stroke-w', `${appearance.strokeWidth}px`);
    r.setProperty('--pt-stroke-c', appearance.strokeColor);
  }

  function syncAppearanceInputs() {
    ensureSelectedFontOption();
    dom.setFont.value = appearance.font;
    dom.setSize.value = appearance.size;
    dom.setSizeVal.textContent = `${appearance.size}px`;
    dom.setColor.value = appearance.color;
    dom.setStrokeW.value = appearance.strokeWidth;
    dom.setStrokeWVal.textContent = `${appearance.strokeWidth}px`;
    dom.setStrokeC.value = appearance.strokeColor;
    dom.setRomaji.checked = appearance.showRomaji;
    dom.setXieyin.checked = appearance.showXieyin;
    dom.setFurigana.checked = appearance.showFurigana;
  }

  function updateAppearance(patch) {
    appearance = { ...appearance, ...patch };
    saveAppearance(appearance);
    applyAppearance();
  }

  // 拼音/諧音會改變歌詞區的 DOM 結構（多加/少一行），不只是 CSS 變數，要重繪才會生效；
  // 跟 updateAppearance() 分開是因為那個給連續拖曳的滑桿用（字級/描邊寬度），每次
  // input 事件都整批重繪歌詞會很浪費，也會讓目前這句的高亮閃一下。
  function updateLyricsDisplayOptions(patch) {
    appearance = { ...appearance, ...patch };
    saveAppearance(appearance);
    renderLyricsSkeleton();
    updateLyricsHighlight();
  }

  applyAppearance();
  syncAppearanceInputs();

  let systemFontsLoaded = false;
  let systemFontsLoading = null;
  let lastFontStatus = { key: 'prompter.fontLoading', values: undefined };

  function ensureSelectedFontOption() {
    if (!dom.setFont || !appearance.font || Array.from(dom.setFont.options).some((option) => option.value === appearance.font)) return;
    const family = localFontFamily(appearance.font);
    if (!family || !dom.fontLocalGroup) return;
    const option = document.createElement('option');
    option.value = appearance.font;
    option.textContent = family;
    option.style.fontFamily = family;
    dom.fontLocalGroup.appendChild(option);
  }

  function setFontStatus(key, values) {
    lastFontStatus = { key, values };
    if (dom.fontStatus) dom.fontStatus.textContent = t(key, values);
  }

  async function loadSystemFonts() {
    if (systemFontsLoaded) return;
    if (systemFontsLoading) return systemFontsLoading;
    systemFontsLoading = (async () => {
      setFontStatus('prompter.fontLoadingActive');
      const names = new Set();
      const aliases = {};
      try {
        const response = await fetch('/api/fonts');
        const data = await response.json();
        if (data && data.success && Array.isArray(data.fonts)) {
          data.fonts.forEach((family) => { if (typeof family === 'string' && family.trim()) names.add(family.trim()); });
          if (data.aliases && typeof data.aliases === 'object') Object.assign(aliases, data.aliases);
          if (data.assets && typeof data.assets === 'object') Object.assign(localFontAssets, data.assets);
        }
      } catch (_) { /* 伺服器掃描失敗時仍嘗試瀏覽器 Font Access API */ }
      if (typeof window.queryLocalFonts === 'function') {
        try {
          (await window.queryLocalFonts()).forEach((font) => {
            if (font && typeof font.family === 'string' && font.family.trim()) names.add(font.family.trim());
          });
        } catch (_) { /* 使用者拒絕授權時仍保留伺服器掃描結果 */ }
      }
      localFontAliases = aliases;
      const families = [...names].sort((a, b) => a.localeCompare(b, window.I18n?.current?.() || 'zh-TW'));
      if (dom.fontLocalGroup) {
        dom.fontLocalGroup.textContent = '';
        const fragment = document.createDocumentFragment();
        families.forEach((family) => {
          const option = document.createElement('option');
          option.value = localFontValue(family);
          option.textContent = family;
          option.style.fontFamily = family;
          fragment.appendChild(option);
        });
        dom.fontLocalGroup.appendChild(fragment);
      }
      systemFontsLoaded = families.length > 0;
      ensureSelectedFontOption();
      dom.setFont.value = appearance.font;
      setFontStatus(systemFontsLoaded ? 'prompter.fontLoaded' : 'prompter.fontUnavailable', { count: families.length });
    })().finally(() => { systemFontsLoading = null; });
    return systemFontsLoading;
  }

  // 小面板不是鋪滿全螢幕的 .modal，沒有背景遮罩可以點擊關閉，改成「點面板外面任何地方」
  // 跟 Escape 都能關閉（跟專案其他 modal 的 Escape 慣例一致）。
  function closeSettingsPopover() { dom.settingsModal.hidden = true; }
  dom.settingsBtn.addEventListener('click', () => {
    dom.settingsModal.hidden = false;
    loadSystemFonts();
  });
  dom.settingsClose.addEventListener('click', closeSettingsPopover);
  document.addEventListener('click', (e) => {
    if (dom.settingsModal.hidden) return;
    if (dom.settingsModal.contains(e.target) || dom.settingsBtn.contains(e.target)) return;
    closeSettingsPopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.settingsModal.hidden) { e.preventDefault(); closeSettingsPopover(); }
  });
  dom.setFont.addEventListener('change', async () => {
    const nextFont = dom.setFont.value;
    const family = localFontFamily(nextFont);
    const assetId = localFontAssets[family]?.id || '';
    if (assetId && window.ElitesandFontAssets?.isAssetId?.(assetId)) {
      try {
        await window.ElitesandFontAssets.load(assetId);
      } catch (_) {
        setFontStatus('prompter.fontUnavailable');
        syncAppearanceInputs();
        return;
      }
    }
    updateAppearance({ font: nextFont, fontAssetId: assetId });
  });
  dom.setSize.addEventListener('input', () => {
    dom.setSizeVal.textContent = `${dom.setSize.value}px`;
    updateAppearance({ size: Number(dom.setSize.value) });
  });
  dom.setColor.addEventListener('input', () => updateAppearance({ color: dom.setColor.value }));
  dom.setStrokeW.addEventListener('input', () => {
    dom.setStrokeWVal.textContent = `${dom.setStrokeW.value}px`;
    updateAppearance({ strokeWidth: Number(dom.setStrokeW.value) });
  });
  dom.setStrokeC.addEventListener('input', () => updateAppearance({ strokeColor: dom.setStrokeC.value }));
  dom.setRomaji.addEventListener('change', () => updateLyricsDisplayOptions({ showRomaji: dom.setRomaji.checked }));
  dom.setXieyin.addEventListener('change', () => updateLyricsDisplayOptions({ showXieyin: dom.setXieyin.checked }));
  dom.setFurigana.addEventListener('change', () => updateLyricsDisplayOptions({ showFurigana: dom.setFurigana.checked }));
  dom.setReset.addEventListener('click', () => {
    appearance = { ...DEFAULT_APPEARANCE };
    saveAppearance(appearance);
    applyAppearance();
    syncAppearanceInputs();
    renderLyricsSkeleton();
    updateLyricsHighlight();
  });

  // ─── 狀態 ───
  let playlist = [];
  let currentTrackIndex = -1;
  let currentTrackId = null;
  let currentEntryId = null;
  let isPlaying = false;
  let currentOffsetMs = 0;
  let currentPlaybackRate = 1.0;
  let parsedLines = []; // 目前歌曲的整句歌詞：[{time, text}]，來自 track.parsedLyrics
  let activeLineIndex = -1;
  let lastDuration = 0;
  let isScrubbing = false;
  let scrubSeconds = 0;

  // 輪詢時鐘：syncTimeMs 是「上次同步當下」的音樂時間，lastSyncTimestamp 是那一刻的
  // performance.now()；兩者相減乘上速率，推算出「現在」的音樂時間，跟 display.js 同一套算法。
  let syncTimeMs = 0;
  let lastSyncTimestamp = 0;
  function getCurrentTimeMs() {
    if (isScrubbing) return scrubSeconds * 1000;
    if (!isPlaying) return syncTimeMs;
    const elapsedReal = performance.now() - lastSyncTimestamp;
    return syncTimeMs + elapsedReal * currentPlaybackRate;
  }

  function reconcileCurrentTrackIndex(track) {
    currentTrackId = track && track.id != null ? track.id : null;
    currentEntryId = track && track.entryId != null ? track.entryId : null;
    currentTrackIndex = PlaylistState.reconcilePlaylist(playlist, currentTrackId, currentEntryId).currentTrackIndex;
    return currentTrackIndex;
  }

  // ═══════════════════════════════════════════
  // 連線狀態
  // ═══════════════════════════════════════════
  SocketClient.on('connection-change', (connected) => {
    const banner = document.getElementById('connection-banner');
    if (connected) {
      dom.connectionStatus.className = 'status-dot connected';
      dom.connectionText.textContent = t('status.connected');
      if (banner) banner.classList.remove('visible');
    } else {
      dom.connectionStatus.className = 'status-dot disconnected';
      dom.connectionText.textContent = t('status.connecting');
      if (banner) banner.classList.add('visible');
    }
  });

  // ═══════════════════════════════════════════
  // 播放清單
  // ═══════════════════════════════════════════
  function renderPlaylist() {
    if (playlist.length === 0) {
      dom.playlist.innerHTML = `<div class="pt-playlist-empty">${escapeHtml(t('prompter.playlistEmpty'))}</div>`;
      return;
    }
    dom.playlist.innerHTML = playlist.map((track, i) => `
      <div class="pt-playlist-item ${i === currentTrackIndex ? 'active' : ''}" data-index="${i}">
        <div class="pt-playlist-item-title">${escapeHtml(track.title || '')}</div>
        <div class="pt-playlist-item-artist">${escapeHtml(track.artist || '')}</div>
      </div>`).join('');
    dom.playlist.querySelectorAll('.pt-playlist-item').forEach((item) => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index, 10);
        const track = playlist[index];
        if (track) SocketClient.send('play:track', track);
      });
    });
  }

  // ═══════════════════════════════════════════
  // 歌詞（整句，不逐字）
  // ═══════════════════════════════════════════
  function renderLyricsSkeleton() {
    if (!parsedLines.length) {
      const key = currentTrackId == null ? 'player.noTrack' : 'prompter.noLyrics';
      dom.lyrics.innerHTML = `<div class="pt-lyrics-empty">${escapeHtml(t(key))}</div>`;
      activeLineIndex = -1;
      return;
    }
    // 拼音/諧音不經過 s2t()：跟 karaoke.js 同一套規則，簡轉繁只轉「原文 Han 字」，
    // 拼音/諧音是輔助發音用的獨立資料，不是原文的一部分，轉了反而可能跟實際讀音對不上。
    const renderFurigana = (line) => {
      const segments = Array.isArray(line.furigana) ? line.furigana : [];
      const source = String(line.text || '');
      const converted = s2t(source);
      // Ruby data belongs to the exact original characters. If a conversion or
      // stale async payload no longer matches, show plain text rather than put
      // a potentially wrong reading above a different character.
      if (!segments.length || converted !== source || segments.map((segment) => segment.text || '').join('') !== source) {
        return escapeHtml(converted);
      }
      return segments.map((segment) => {
        const text = escapeHtml(segment.text || '');
        const reading = escapeHtml(segment.reading || '');
        return reading ? `<ruby>${text}<rt>${reading}</rt></ruby>` : text;
      }).join('');
    };
    dom.lyrics.innerHTML = parsedLines.map((line, i) => {
      const romaji = appearance.showRomaji && line.phonetic
        ? `<div class="pt-line-romaji">${escapeHtml(line.phonetic)}</div>` : '';
      const xieyin = appearance.showXieyin && line.xieyin
        ? `<div class="pt-line-xieyin">${escapeHtml(line.xieyin)}</div>` : '';
      return `<div class="pt-line" data-index="${i}">
        <div class="pt-line-text">${appearance.showFurigana ? renderFurigana(line) : escapeHtml(s2t(line.text || ''))}</div>
        ${romaji}${xieyin}
      </div>`;
    }).join('');
    activeLineIndex = -1;
  }

  function findLineIndex(t) {
    let idx = -1;
    for (let i = 0; i < parsedLines.length; i++) {
      if (parsedLines[i].time <= t) idx = i; else break;
    }
    return idx;
  }

  function updateLyricsHighlight() {
    if (!parsedLines.length) return;
    const adjustedMs = getCurrentTimeMs() + currentOffsetMs;
    const idx = findLineIndex(adjustedMs);
    if (idx === activeLineIndex) return;
    // 拖曳/跳轉可能一次跨好幾句（不是逐句遞增），舊的 --next 標記可能停在中途某一句沒被清到，
    // 統一整批清掉重貼，比只清「前一個 active」跟「前一個 next」兩個定點更保險。
    dom.lyrics.querySelectorAll('.pt-line--active, .pt-line--next').forEach((el) => {
      el.classList.remove('pt-line--active', 'pt-line--next');
      el.classList.add('pt-line--past');
    });
    activeLineIndex = idx;
    const el = idx >= 0 ? dom.lyrics.querySelector(`[data-index="${idx}"]`) : null;
    if (el) {
      el.classList.remove('pt-line--past');
      el.classList.add('pt-line--active');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const nextEl = idx >= 0 ? dom.lyrics.querySelector(`[data-index="${idx + 1}"]`) : dom.lyrics.querySelector('[data-index="0"]');
    if (nextEl) { nextEl.classList.remove('pt-line--past'); nextEl.classList.add('pt-line--next'); }
  }

  // 點歌詞跳到那一句的起點：用事件代理綁在容器上，因為 renderLyricsSkeleton() 每次都整批
  // 重建 innerHTML，綁在個別 .pt-line 上的監聽器會跟著舊 DOM 一起被丟掉。
  // line.time 是「音訊時間 + offset」的調整後時間軸（見 updateLyricsHighlight 的 adjustedMs、
  // 跟歌詞時間軸編輯器 app-lyrics-timeline.js 寫入 line.time 時的算法一致），所以要還原成
  // 音訊本身的秒數就得先扣掉 offset，否則歌詞/音訊有偏移時，點下去反而會跳到偏移過的位置。
  dom.lyrics.addEventListener('click', (e) => {
    const lineEl = e.target.closest('.pt-line');
    if (!lineEl) return;
    const idx = parseInt(lineEl.dataset.index, 10);
    const line = parsedLines[idx];
    if (!line || typeof line.time !== 'number') return;
    const seconds = Math.max(0, (line.time - currentOffsetMs) / 1000);
    const payload = currentTrackId != null ? { time: seconds, trackId: currentTrackId } : seconds;
    SocketClient.send('play:seek', payload);
    isScrubbing = false;
    syncTimeMs = seconds * 1000;
    lastSyncTimestamp = performance.now();
    setProgressDisplay(seconds);
    updateLyricsHighlight();
  });

  // 播放中才需要輪詢（省電）；暫停時畫面已經是正確狀態，不必每 250ms 重算一次。
  let tickTimer = null;
  function ensureTicking() {
    if (tickTimer || !isPlaying) return;
    tickTimer = setInterval(() => {
      updateLyricsHighlight();
      if (!isScrubbing) setProgressDisplay(getCurrentTimeMs() / 1000);
    }, 250);
  }
  function stopTicking() {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = null;
  }

  // ═══════════════════════════════════════════
  // 播放控制（純遠端指令，這頁沒有 <audio>）
  // ═══════════════════════════════════════════
  function setPlayIcon() { dom.playIcon.textContent = isPlaying ? '❚❚' : '▶'; }

  dom.btnPrev.addEventListener('click', () => SocketClient.send('play:prev'));
  dom.btnNext.addEventListener('click', () => SocketClient.send('play:next'));
  dom.btnPlay.addEventListener('click', () => SocketClient.send('play:toggle'));

  function setProgressDisplay(seconds) {
    const safeDuration = Number.isFinite(lastDuration) && lastDuration > 0 ? lastDuration : 0;
    const safeSeconds = Math.max(0, Math.min(safeDuration || Number.MAX_SAFE_INTEGER, Number(seconds) || 0));
    const ratio = safeDuration ? safeSeconds / safeDuration : 0;
    const percent = Math.max(0, Math.min(100, ratio * 100));
    dom.timeCurrent.textContent = formatTime(safeSeconds);
    dom.timeTotal.textContent = formatTime(safeDuration);
    dom.progressFill.style.width = `${percent}%`;
    if (dom.progressThumb) dom.progressThumb.style.left = `${percent}%`;
    dom.progressTrack.setAttribute('aria-valuemax', String(Math.round(safeDuration)));
    dom.progressTrack.setAttribute('aria-valuenow', String(Math.round(safeSeconds)));
    dom.progressTrack.setAttribute('aria-valuetext', `${formatTime(safeSeconds)} / ${formatTime(safeDuration)}`);
  }

  function secondsFromPointer(clientX) {
    if (!lastDuration) return null;
    const rect = dom.progressTrack.getBoundingClientRect();
    if (!rect.width) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * lastDuration;
  }

  function previewScrub(seconds) {
    if (seconds == null) return;
    scrubSeconds = seconds;
    syncTimeMs = seconds * 1000;
    lastSyncTimestamp = performance.now();
    setProgressDisplay(seconds);
    updateLyricsHighlight();
  }

  function commitScrub() {
    if (!isScrubbing) return;
    isScrubbing = false;
    dom.progressTrack.classList.remove('is-scrubbing');
    const payload = currentTrackId != null
      ? { time: scrubSeconds, trackId: currentTrackId }
      : scrubSeconds;
    SocketClient.send('play:seek', payload);
    syncTimeMs = scrubSeconds * 1000;
    lastSyncTimestamp = performance.now();
  }

  dom.progressTrack.addEventListener('pointerdown', (event) => {
    const seconds = secondsFromPointer(event.clientX);
    if (seconds == null) return;
    event.preventDefault();
    isScrubbing = true;
    dom.progressTrack.classList.add('is-scrubbing');
    dom.progressTrack.setPointerCapture?.(event.pointerId);
    previewScrub(seconds);
  });
  dom.progressTrack.addEventListener('pointermove', (event) => {
    if (!isScrubbing) return;
    previewScrub(secondsFromPointer(event.clientX));
  });
  dom.progressTrack.addEventListener('pointerup', (event) => {
    if (!isScrubbing) return;
    previewScrub(secondsFromPointer(event.clientX));
    dom.progressTrack.releasePointerCapture?.(event.pointerId);
    commitScrub();
  });
  dom.progressTrack.addEventListener('pointercancel', () => commitScrub());
  dom.progressTrack.addEventListener('keydown', (event) => {
    if (!lastDuration) return;
    const current = Math.max(0, Math.min(lastDuration, getCurrentTimeMs() / 1000));
    const step = event.shiftKey ? 10 : 5;
    let target = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = current - step;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = current + step;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = lastDuration;
    if (target == null) return;
    event.preventDefault();
    isScrubbing = true;
    previewScrub(Math.max(0, Math.min(lastDuration, target)));
    commitScrub();
  });

  // 羅馬化是非同步的：歌曲切過來當下伺服器可能還沒跑完 kuromoji/pinyin-pro，之後才用這個
  // 事件補推。用「時間」對齊合併回 parsedLines，不能用索引——伺服器過濾製作資訊行後行數
  // 可能跟本地不同，索引對齊會把拼音/諧音貼到錯的句子（跟 karaoke.js 同一套規則，見
  // memory lyrics-romanization-pipeline）。
  SocketClient.on('lyrics:romanized', (data) => {
    if (!data || !Array.isArray(data.parsedLyrics) || !parsedLines.length) return;
    const byTime = new Map();
    for (const rl of data.parsedLyrics) {
      if (rl && typeof rl.time === 'number') byTime.set(rl.time, rl);
    }
    let changed = false;
    for (const line of parsedLines) {
      const rl = byTime.get(line.time);
      if (!rl) continue;
      if (rl.phonetic && rl.phonetic !== line.phonetic) { line.phonetic = rl.phonetic; changed = true; }
      if (rl.xieyin && rl.xieyin !== line.xieyin) { line.xieyin = rl.xieyin; changed = true; }
      if (Array.isArray(rl.furigana) && JSON.stringify(rl.furigana) !== JSON.stringify(line.furigana)) { line.furigana = rl.furigana; changed = true; }
    }
    if (changed && (appearance.showRomaji || appearance.showXieyin || appearance.showFurigana)) {
      renderLyricsSkeleton();
      updateLyricsHighlight();
    }
  });

  // 回到「尚未播放」的空狀態：state:sync 沒帶 currentTrack、以及播放清單播完最後一首
  // 沒有下一首可接時（play:stop）都要走這裡，兩處各自維護一份很容易漏改其中一邊。
  function resetToEmpty() {
    reconcileCurrentTrackIndex(null);
    dom.npTitle.textContent = t('player.noTrack');
    dom.npArtist.textContent = '';
    parsedLines = [];
    lastDuration = 0;
    isPlaying = false;
    syncTimeMs = 0;
    isScrubbing = false;
    scrubSeconds = 0;
    setProgressDisplay(0);
    setPlayIcon();
    renderLyricsSkeleton();
    stopTicking();
  }

  // 播放清單播完最後一首、沒有下一首可接：過去這裡沒有任何訊號，歌詞會永遠卡在最後一句。
  SocketClient.on('play:stop', () => {
    resetToEmpty();
    renderPlaylist();
  });

  SocketClient.on('play:track', (track) => {
    if (!track) return;
    reconcileCurrentTrackIndex(track);
    dom.npTitle.textContent = track.title || t('player.noTrack');
    dom.npArtist.textContent = track.artist || '';
    currentOffsetMs = typeof track.offset === 'number' ? track.offset : 0;
    parsedLines = Array.isArray(track.parsedLyrics) ? track.parsedLyrics.filter((l) => l && typeof l.time === 'number') : [];
    renderLyricsSkeleton();
    isPlaying = track.autoplay !== false;
    lastDuration = Number(track.duration) > 0 ? Number(track.duration) : 0;
    isScrubbing = false;
    scrubSeconds = 0;
    syncTimeMs = 0;
    lastSyncTimestamp = performance.now();
    setProgressDisplay(0);
    setPlayIcon();
    updateLyricsHighlight();
    if (isPlaying) ensureTicking(); else stopTicking();
    renderPlaylist();
  });

  SocketClient.on('play:toggle', (payload) => {
    if (!payload || typeof payload.playing !== 'boolean') return;
    isPlaying = payload.playing;
    lastSyncTimestamp = performance.now();
    setPlayIcon();
    if (isPlaying) ensureTicking(); else stopTicking();
  });

  SocketClient.on('play:seek', (time) => {
    if (typeof time !== 'number' || !isFinite(time)) return;
    if (isScrubbing) return;
    syncTimeMs = time * 1000;
    lastSyncTimestamp = performance.now();
    setProgressDisplay(time);
    updateLyricsHighlight();
  });

  // 面板每 200ms 廣播一次 lyrics:sync；網路抖動可能讓某次送到的 currentTime 比本地已經
  // 推算出的時間還早個幾十毫秒（不是真的倒轉，單純抖動）。跟 display.js 踩過的同一種時鐘
  // 抖動坑（見 memory display-clock-granularity）：不設防線，快跳到下一句的時候就會先退回
  // 上一句一下、再跳回來。那邊靠 getSmoothTimeMs() 逐幀平滑；這裡只需要整句級的精度，
  // 用最簡單的「小幅倒退就忽略、只有真的 seek（落差夠大）才接受」即可。
  const SYNC_REGRESSION_TOLERANCE_MS = 400;
  SocketClient.on('lyrics:sync', (data) => {
    if (!data || typeof data.currentTime !== 'number') return;
    if (typeof data.duration === 'number' && data.duration > 0) {
      lastDuration = data.duration;
    }
    if (isScrubbing) return;
    const proposedMs = data.currentTime * 1000;
    if (isPlaying) {
      const estimatedMs = getCurrentTimeMs();
      const regressedMs = estimatedMs - proposedMs;
      if (regressedMs > 0 && regressedMs < SYNC_REGRESSION_TOLERANCE_MS) {
        // 忽略這次抖動造成的倒退：只重新校準時間戳基準，畫面維持原本估計值繼續往前跑，
        // 不會有「跳到下一句前先退回上一句」的閃爍。
        lastSyncTimestamp = performance.now();
        setProgressDisplay(estimatedMs / 1000);
        return;
      }
    }
    syncTimeMs = proposedMs;
    lastSyncTimestamp = performance.now();
    setProgressDisplay(data.currentTime);
    // 不等下一次輪詢：面板拖曳進度條時（seeking）落點可能跨好幾句，
    // 拖到哪就該立刻反映在哪，等 250ms 的輪詢會讓歌詞明顯慢半拍。
    updateLyricsHighlight();
  });

  // 簡轉繁設定：跟歌詞顯示頁／歌單頁共用同一份 lyricSettings（同一套 lyric-settings:update
  // 事件），設定改變時重繪目前這份歌詞（不必等下一次 play:track）。
  SocketClient.on('lyric-settings:update', (settings) => {
    if (!settings || typeof settings.convertTraditional !== 'boolean') return;
    if (settings.convertTraditional === s2tEnabled) return;
    s2tEnabled = settings.convertTraditional;
    renderLyricsSkeleton();
    updateLyricsHighlight();
  });

  SocketClient.on('offset:update', (data) => {
    if (!data || !playlist[currentTrackIndex] || data.trackId !== playlist[currentTrackIndex].id) return;
    currentOffsetMs = data.offset || 0;
    updateLyricsHighlight();
  });

  SocketClient.on('speed:update', (rate) => {
    if (typeof rate === 'number') currentPlaybackRate = rate;
  });

  SocketClient.on('playlist:update', (newPlaylist) => {
    playlist = Array.isArray(newPlaylist) ? newPlaylist : [];
    reconcileCurrentTrackIndex((currentTrackId || currentEntryId) ? { id: currentTrackId, entryId: currentEntryId } : null);
    renderPlaylist();
  });

  // 完整狀態同步（連線/重連時）
  SocketClient.on('state:sync', (state) => {
    if (!state) return;
    if (state.lyricSettings && typeof state.lyricSettings.convertTraditional === 'boolean') {
      s2tEnabled = state.lyricSettings.convertTraditional;
    }
    const hasCurrentTrack = Object.prototype.hasOwnProperty.call(state, 'currentTrack');
    const hasPlaylist = Array.isArray(state.playlist);
    if (hasPlaylist) playlist = state.playlist;

    if (typeof state.isPlaying === 'boolean') { isPlaying = state.isPlaying; setPlayIcon(); }
    if (typeof state.playbackRate === 'number') currentPlaybackRate = state.playbackRate;

    if (state.currentTrack) {
      const track = state.currentTrack;
      reconcileCurrentTrackIndex(track);
      dom.npTitle.textContent = track.title || t('player.noTrack');
      dom.npArtist.textContent = track.artist || '';
      currentOffsetMs = typeof state.currentOffset === 'number' ? state.currentOffset : (track.offset || 0);
      parsedLines = Array.isArray(track.parsedLyrics) ? track.parsedLyrics.filter((l) => l && typeof l.time === 'number') : [];
      renderLyricsSkeleton();
      if (typeof state.duration === 'number' && state.duration > 0) lastDuration = state.duration;
      else if (typeof track.duration === 'number' && track.duration > 0) lastDuration = track.duration;
      if (typeof state.currentTime === 'number') {
        syncTimeMs = state.currentTime * 1000;
        lastSyncTimestamp = performance.now();
      }
      setProgressDisplay(typeof state.currentTime === 'number' ? state.currentTime : 0);
      updateLyricsHighlight();
      if (isPlaying) ensureTicking(); else stopTicking();
    } else if (hasCurrentTrack) {
      resetToEmpty();
    }

    if (hasPlaylist || hasCurrentTrack) renderPlaylist();
  });

  window.addEventListener('i18n:change', () => {
    if (currentTrackId == null) dom.npTitle.textContent = t('player.noTrack');
    dom.connectionText.textContent = dom.connectionStatus.classList.contains('connected')
      ? t('status.connected')
      : t('status.connecting');
    renderPlaylist();
    renderLyricsSkeleton();
    updateLyricsHighlight();
    setFontStatus(lastFontStatus.key, lastFontStatus.values);
  });
})();
