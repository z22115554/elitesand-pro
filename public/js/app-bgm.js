/**
 * BGM 待機音樂（仿「歌回救星」雙軌切換）。
 *
 * 播放引擎完全在這個檔案、完全獨立於主播放鏈（app-playback.js）：自己的 <audio>、
 * 自己的 AudioContext/GainNode。BGM 清單本身是伺服器端一份旁路清單（server/services/
 * bgm-playlist.js），只存媒體庫 id，不進 playState.playlist、不進 setlist——這是待機
 * 音樂，不是要唱的歌。
 *
 * 對外只曝露 AppBgm.syncWithPlayback(isSongPlaying, reason)，由 app-playback.js 在
 * 「使用者按下播放/暫停」與「播放清單播完」兩個時機呼叫：唱歌開始→BGM 立刻淡出暫停；
 * 唱歌暫停/結束→BGM 淡入恢復，但不是立刻——使用者實測回報立刻接回來太突兀（可能還在
 * 調整麥克風、準備下一首），所以恢復前有一段可調的等待時間，「暫停」跟「播完」各自
 * 一個延遲值（reason: 'pause' | 'end'）。不清楚競品（歌回救星）怎麼算這段空白，所以
 * 做成使用者自己可調的參數，不是我們猜一個數字硬編碼。
 *
 * 開關（bgm:enable/disable）與播放狀態回報（bgm:status）走 socket 同步，讓手機遙控器
 * 也能看到並操作，跟一般播放控制同一個待遇（不像 Twitch/公開點歌限桌面）。音量／延遲
 * 調整與清單管理（含本機上傳、YouTube 匯入）只在桌面面板——實際播放引擎只在這裡。
 */
(function () {
  'use strict';

  const { escapeHtml } = SharedUtils;
  const el = (id) => document.getElementById(id);
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);

  let enabled = false;
  let tracks = [];          // 可播放清單（伺服器端已過濾出音檔還在的）
  let currentIndex = -1;
  let localPlaying = false; // BGM 引擎目前實際是不是在播
  let songIsPlaying = false; // 目前是不是正在唱歌（由 app-playback.js 回報）
  let manualPause = false;  // 使用者在 BGM 頁自己按暫停（跟「唱歌中被自動暫停」分開）
  let pendingResumeTimer = null;
  let volume = 70;               // 0-100
  let pauseResumeDelayMs = 3000;
  let endResumeDelayMs = 5000;

  const audioEl = document.createElement('audio');
  audioEl.id = 'bgm-audio-player';
  audioEl.preload = 'auto';
  audioEl.style.display = 'none';
  document.body.appendChild(audioEl);

  let actx = null, sourceNode = null, trackGainNode = null, volumeGainNode = null, fadeGainNode = null;
  function ensureAudioGraph() {
    if (actx) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    actx = new Ctor();
    sourceNode = actx.createMediaElementSource(audioEl);
    trackGainNode = actx.createGain();  // 每首歌的響度校正（跟主播放鏈同一套 -14 LUFS 對齊）
    volumeGainNode = actx.createGain(); // 使用者自訂 BGM 音量
    volumeGainNode.gain.value = volume / 100;
    fadeGainNode = actx.createGain();   // 淡入/淡出的音量包絡
    fadeGainNode.gain.value = 0;
    sourceNode.connect(trackGainNode);
    trackGainNode.connect(volumeGainNode);
    volumeGainNode.connect(fadeGainNode);
    fadeGainNode.connect(actx.destination);
  }

  const FADE_SECONDS = 0.25; // 人耳可接受、不會喀一聲，也不會拖太久顯得反應遲鈍
  function fadeTo(target, seconds = FADE_SECONDS) {
    ensureAudioGraph();
    if (!actx) return;
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    const now = actx.currentTime;
    fadeGainNode.gain.cancelScheduledValues(now);
    fadeGainNode.gain.setValueAtTime(fadeGainNode.gain.value, now);
    fadeGainNode.gain.linearRampToValueAtTime(target, now + seconds);
  }

  function applyTrackLoudness(track) {
    ensureAudioGraph();
    if (!trackGainNode) return;
    const lufs = typeof track?.loudnessLufs === 'number' ? track.loudnessLufs : null;
    const db = (window.LoudnessGain && lufs !== null) ? LoudnessGain.computeTrackGainDb(lufs) : 0;
    trackGainNode.gain.value = window.LoudnessGain ? LoudnessGain.dbToLinear(db) : 1;
  }

  function applyVolume() {
    if (volumeGainNode) volumeGainNode.gain.value = volume / 100;
  }

  function clearPendingResume() {
    if (pendingResumeTimer) { clearTimeout(pendingResumeTimer); pendingResumeTimer = null; }
    renderStatus();
  }

  function reportStatus(playing) {
    if (localPlaying === playing) return;
    localPlaying = playing;
    SocketClient.send('bgm:status', { playing });
    renderStatus();
  }

  function loadTrack(index, autoplay) {
    const track = tracks[index];
    if (!track || !track.filename) return false;
    currentIndex = index;
    applyTrackLoudness(track);
    audioEl.src = `/audio/${encodeURIComponent(track.filename)}`;
    renderTrackList();
    if (autoplay) startPlayback();
    return true;
  }

  function startPlayback() {
    clearPendingResume();
    if (!enabled || !tracks.length || songIsPlaying) return;
    ensureAudioGraph();
    if (currentIndex === -1 || !audioEl.src) loadTrack(0, false);
    audioEl.play().then(() => {
      fadeTo(1);
      reportStatus(true);
    }).catch(() => { /* 需要使用者互動過才能自動播放；下次手動操作時會再重試 */ });
  }

  function pausePlayback() {
    if (!localPlaying) return;
    fadeTo(0);
    setTimeout(() => { try { audioEl.pause(); } catch (e) { /* 靜默 */ } }, FADE_SECONDS * 1000 + 30);
    reportStatus(false);
  }

  function scheduleResume(reason) {
    clearPendingResume();
    if (!enabled || manualPause || songIsPlaying || !tracks.length) { renderStatus(); return; }
    const delay = reason === 'end' ? endResumeDelayMs : pauseResumeDelayMs;
    pendingResumeTimer = setTimeout(() => { pendingResumeTimer = null; startPlayback(); }, delay);
    renderStatus();
  }

  audioEl.addEventListener('ended', () => {
    if (!tracks.length) return;
    const next = (currentIndex + 1) % tracks.length;
    loadTrack(next, true);
  });

  /** 由 app-playback.js 呼叫：isSongPlaying=true 表示正在唱歌，BGM 該讓路；
   *  reason 只在 isSongPlaying=false 時有意義：'pause'=使用者暫停歌曲、'end'=播放清單自然播完。 */
  function syncWithPlayback(isSongPlaying, reason) {
    songIsPlaying = isSongPlaying;
    renderTransportState();
    if (!enabled) return;
    if (isSongPlaying) {
      clearPendingResume();
      if (localPlaying) pausePlayback();
    } else {
      scheduleResume(reason);
    }
  }

  // ─── 手動播放/暫停/下一首（BGM 頁自己的傳輸控制，跟自動跟隨唱歌狀態分開） ───
  function manualTogglePlay() {
    if (songIsPlaying) return; // 唱歌中不可手動搶播，傳輸鍵本來就會被停用
    if (localPlaying) {
      manualPause = true;
      clearPendingResume();
      pausePlayback();
    } else {
      manualPause = false;
      startPlayback();
    }
  }

  function manualNext() {
    if (!tracks.length) return;
    const next = (currentIndex + 1) % tracks.length;
    loadTrack(next, localPlaying || (!songIsPlaying && !manualPause && enabled));
  }

  // ─── UI ───
  function renderStatus() {
    const toggle = el('bgm-enable-toggle');
    if (toggle) toggle.checked = enabled;
    const chip = el('bgm-status-chip');
    if (chip) {
      if (!enabled) { chip.textContent = t('bgm.statusDisabled'); chip.dataset.state = 'off'; }
      else if (localPlaying) { chip.textContent = t('bgm.statusPlaying'); chip.dataset.state = 'on'; }
      else if (pendingResumeTimer) { chip.textContent = t('bgm.statusWaiting'); chip.dataset.state = 'warn'; }
      else { chip.textContent = t('bgm.statusPaused'); chip.dataset.state = 'muted'; }
    }
    renderTransportState();
  }

  function renderTransportState() {
    const playBtn = el('bgm-transport-play');
    const nextBtn = el('bgm-transport-next');
    const disabled = !enabled || !tracks.length || songIsPlaying;
    if (playBtn) {
      playBtn.disabled = disabled;
      playBtn.textContent = localPlaying ? t('bgm.transportPause') : t('bgm.transportPlay');
    }
    if (nextBtn) nextBtn.disabled = disabled;
    const nowPlaying = el('bgm-now-playing');
    if (nowPlaying) nowPlaying.textContent = tracks[currentIndex]?.title || t('bgm.nowPlayingEmpty');
  }

  function renderTrackList() {
    const list = el('bgm-track-list');
    if (!list) return;
    if (!tracks.length) {
      list.innerHTML = `<li class="bgm-track-empty">${escapeHtml(t('bgm.listEmpty'))}</li>`;
      return;
    }
    list.innerHTML = tracks.map((track, index) => `
      <li class="bgm-track-item${index === currentIndex ? ' active' : ''}" data-id="${escapeHtml(track.id)}">
        <span class="bgm-track-title">${escapeHtml(track.title || track.id)}</span>
        <button type="button" class="btn btn-sm btn-ghost bgm-track-remove" data-id="${escapeHtml(track.id)}" aria-label="${escapeHtml(t('common.delete'))}">✕</button>
      </li>
    `).join('');
  }

  function renderSettingsUi() {
    const volumeSlider = el('bgm-volume-slider');
    const volumeVal = el('bgm-volume-val');
    if (volumeSlider && document.activeElement !== volumeSlider) volumeSlider.value = String(volume);
    if (volumeVal) volumeVal.textContent = `${volume}%`;
    const pauseSlider = el('bgm-pause-delay-slider');
    const pauseVal = el('bgm-pause-delay-val');
    if (pauseSlider && document.activeElement !== pauseSlider) pauseSlider.value = String(Math.round(pauseResumeDelayMs / 1000 * 10) / 10);
    if (pauseVal) pauseVal.textContent = t('bgm.delaySeconds', { seconds: (pauseResumeDelayMs / 1000).toFixed(1) });
    const endSlider = el('bgm-end-delay-slider');
    const endVal = el('bgm-end-delay-val');
    if (endSlider && document.activeElement !== endSlider) endSlider.value = String(Math.round(endResumeDelayMs / 1000 * 10) / 10);
    if (endVal) endVal.textContent = t('bgm.delaySeconds', { seconds: (endResumeDelayMs / 1000).toFixed(1) });
  }

  function applyPlaylist(payload) {
    const previousId = tracks[currentIndex]?.id || null;
    tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
    currentIndex = previousId ? tracks.findIndex((track) => track.id === previousId) : -1;
    if (currentIndex === -1 && tracks.length && localPlaying) loadTrack(0, false);
    renderTrackList();
    renderTransportState();
  }

  function requestPlaylist() {
    SocketClient.sendWithCallback('bgm:list', null, (result) => applyPlaylist(result));
  }

  function pushSettings(patch) {
    SocketClient.sendWithCallback('bgm:settings:set', patch, (result) => {
      if (!result?.ok) return;
      volume = result.settings.volume;
      pauseResumeDelayMs = result.settings.pauseResumeDelayMs;
      endResumeDelayMs = result.settings.endResumeDelayMs;
      applyVolume();
      renderSettingsUi();
    });
  }

  function importYouTubeUrl(url) {
    if (typeof AppShared.queueYouTubeImport !== 'function') return;
    AppShared.queueYouTubeImport(url, {
      source: 'BGM',
      sourceKey: 'bgm.importSource',
      skipPlaylistInsert: true,
    }).then((track) => {
      if (!track?.id) return;
      SocketClient.sendWithCallback('bgm:addTracks', { trackIds: [track.id] }, (result) => {
        if (result?.ok) requestPlaylist();
      });
    }).catch((error) => {
      if (error?.code === 'IMPORT_CANCELLED' || error?.code === 'IMPORT_SKIPPED') return;
      AppShared.showToast?.(t('bgm.importFailed', { message: error?.message || '' }), 'error');
    });
  }

  async function uploadLocalFiles(files) {
    if (!files || !files.length) return;
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));
    try {
      const res = await PinAuth.fetchWithPin('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success || !Array.isArray(data.tracks)) throw new Error(data.error || 'upload failed');
      const ids = data.tracks.map((track) => track.id).filter(Boolean);
      if (!ids.length) return;
      SocketClient.sendWithCallback('bgm:addTracks', { trackIds: ids }, (result) => {
        if (result?.ok) requestPlaylist();
      });
    } catch (error) {
      AppShared.showToast?.(t('bgm.uploadFailed', { message: error?.message || '' }), 'error');
    }
  }

  function wireUi() {
    const toggle = el('bgm-enable-toggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        const event = toggle.checked ? 'bgm:enable' : 'bgm:disable';
        toggle.disabled = true;
        SocketClient.sendWithCallback(event, null, (result) => {
          toggle.disabled = false;
          if (!result?.ok) { toggle.checked = enabled; return; }
        });
      });
    }
    el('bgm-transport-play')?.addEventListener('click', manualTogglePlay);
    el('bgm-transport-next')?.addEventListener('click', manualNext);

    const volumeSlider = el('bgm-volume-slider');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', () => {
        volume = Number(volumeSlider.value) || 0;
        applyVolume();
        const volumeVal = el('bgm-volume-val');
        if (volumeVal) volumeVal.textContent = `${volume}%`;
      });
      volumeSlider.addEventListener('change', () => pushSettings({ volume }));
    }
    const pauseSlider = el('bgm-pause-delay-slider');
    if (pauseSlider) {
      pauseSlider.addEventListener('change', () => pushSettings({ pauseResumeDelayMs: Math.round(Number(pauseSlider.value) * 1000) }));
    }
    const endSlider = el('bgm-end-delay-slider');
    if (endSlider) {
      endSlider.addEventListener('change', () => pushSettings({ endResumeDelayMs: Math.round(Number(endSlider.value) * 1000) }));
    }

    const importButton = el('bgm-import-button');
    const importInput = el('bgm-import-url');
    if (importButton && importInput) {
      importButton.addEventListener('click', () => {
        const url = importInput.value.trim();
        if (!url) return;
        importInput.value = '';
        importYouTubeUrl(url);
      });
      importInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') importButton.click();
      });
    }
    const uploadButton = el('bgm-upload-button');
    const uploadInput = el('bgm-upload-input');
    if (uploadButton && uploadInput) {
      uploadButton.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', () => {
        uploadLocalFiles(uploadInput.files);
        uploadInput.value = '';
      });
    }
    const list = el('bgm-track-list');
    if (list) {
      list.addEventListener('click', (event) => {
        const button = event.target.closest('.bgm-track-remove');
        if (!button) return;
        const id = button.dataset.id;
        SocketClient.sendWithCallback('bgm:removeTracks', { trackIds: [id] }, (result) => {
          if (result?.ok) requestPlaylist();
        });
      });
    }
  }

  SocketClient.on('bgm:settings:update', (settings) => {
    if (!settings) return;
    const wasEnabled = enabled;
    enabled = settings.enabled === true;
    if (typeof settings.volume === 'number') volume = settings.volume;
    if (typeof settings.pauseResumeDelayMs === 'number') pauseResumeDelayMs = settings.pauseResumeDelayMs;
    if (typeof settings.endResumeDelayMs === 'number') endResumeDelayMs = settings.endResumeDelayMs;
    applyVolume();
    renderSettingsUi();
    renderStatus();
    if (wasEnabled && !enabled) { manualPause = false; clearPendingResume(); pausePlayback(); }
    if (!wasEnabled && enabled) requestPlaylist();
  });
  SocketClient.on('bgm:playlist', applyPlaylist);
  SocketClient.on('bgm:playlist:pruned', requestPlaylist);
  SocketClient.on('connection-change', (connected) => { if (connected && enabled) requestPlaylist(); });

  document.addEventListener('DOMContentLoaded', wireUi);
  if (document.readyState !== 'loading') wireUi();
  window.addEventListener('i18n:change', () => { renderStatus(); renderTrackList(); renderSettingsUi(); });

  window.AppBgm = { syncWithPlayback };
})();
