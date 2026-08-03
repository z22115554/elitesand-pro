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
  const DEFAULT_APPEARANCE = { font: 'default', size: 27, color: '#f2f3f5', strokeWidth: 0, strokeColor: '#000000' };

  function localFontValue(family) { return `${LOCAL_FONT_PREFIX}${family}`; }
  function localFontFamily(value) {
    return typeof value === 'string' && value.startsWith(LOCAL_FONT_PREFIX)
      ? value.slice(LOCAL_FONT_PREFIX.length).trim()
      : '';
  }
  function quoteFontFamily(family) {
    const escaped = String(family || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return escaped ? `'${escaped}', ${FONT_FALLBACK}` : FONT_STACKS.default;
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

  function applyAppearance() {
    const r = dom.lyrics.style;
    r.setProperty('--pt-font', resolveFontStack(appearance.font));
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
  }

  function updateAppearance(patch) {
    appearance = { ...appearance, ...patch };
    saveAppearance(appearance);
    applyAppearance();
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
      try {
        const response = await fetch('/api/fonts');
        const data = await response.json();
        if (data && data.success && Array.isArray(data.fonts)) {
          data.fonts.forEach((family) => { if (typeof family === 'string' && family.trim()) names.add(family.trim()); });
        }
      } catch (_) { /* 伺服器掃描失敗時仍嘗試瀏覽器 Font Access API */ }
      if (typeof window.queryLocalFonts === 'function') {
        try {
          (await window.queryLocalFonts()).forEach((font) => {
            if (font && typeof font.family === 'string' && font.family.trim()) names.add(font.family.trim());
          });
        } catch (_) { /* 使用者拒絕授權時仍保留伺服器掃描結果 */ }
      }
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

  dom.settingsBtn.addEventListener('click', () => {
    dom.settingsModal.hidden = false;
    loadSystemFonts();
  });
  dom.settingsClose.addEventListener('click', () => { dom.settingsModal.hidden = true; });
  dom.settingsModal.addEventListener('click', (e) => { if (e.target === dom.settingsModal) dom.settingsModal.hidden = true; });
  dom.setFont.addEventListener('change', () => updateAppearance({ font: dom.setFont.value }));
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
  dom.setReset.addEventListener('click', () => {
    appearance = { ...DEFAULT_APPEARANCE };
    saveAppearance(appearance);
    applyAppearance();
    syncAppearanceInputs();
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
    dom.lyrics.innerHTML = parsedLines.map((line, i) =>
      `<div class="pt-line" data-index="${i}">${escapeHtml(line.text || '')}</div>`).join('');
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

  SocketClient.on('lyrics:sync', (data) => {
    if (!data || typeof data.currentTime !== 'number') return;
    if (typeof data.duration === 'number' && data.duration > 0) {
      lastDuration = data.duration;
    }
    if (isScrubbing) return;
    syncTimeMs = data.currentTime * 1000;
    lastSyncTimestamp = performance.now();
    setProgressDisplay(data.currentTime);
    // 不等下一次輪詢：面板拖曳進度條時（seeking）落點可能跨好幾句，
    // 拖到哪就該立刻反映在哪，等 250ms 的輪詢會讓歌詞明顯慢半拍。
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
      reconcileCurrentTrackIndex(null);
      dom.npTitle.textContent = t('player.noTrack');
      dom.npArtist.textContent = '';
      parsedLines = [];
      lastDuration = 0;
      syncTimeMs = 0;
      setProgressDisplay(0);
      renderLyricsSkeleton();
      stopTicking();
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
