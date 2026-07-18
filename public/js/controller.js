/**
 * Elitesand Pro 遙控器模式主程式 v3 (Phase 5)
 * 手機優化的遠端控制介面
 * 
 * Phase 5 增強：
 * - ⏱ 時間偏移 +/- 按鈕
 * - 📝 手動歌詞補救（上傳/貼上）
 * - 📋 播放列表狀態徽章（✅ 手動匯入、offset）
 * - 🔔 Toast 通知
 */
(function () {
  'use strict';

  const { formatTime, escapeHtml, safeHttpUrl } = SharedUtils;

  // ─── 初始化 Socket ───
  SocketClient.init('remote');

  // 初始化錯誤處理系統
  if (typeof ErrorHandler !== 'undefined') {
    ErrorHandler.init();
  }

  // ─── DOM 引用 ───
  const dom = {
    connectionStatus: document.getElementById('connection-status'),
    connectionText: document.getElementById('connection-text'),
    albumArt: document.getElementById('album-art'),
    trackTitle: document.getElementById('track-title'),
    trackArtist: document.getElementById('track-artist'),
    timeCurrent: document.getElementById('time-current'),
    timeTotal: document.getElementById('time-total'),
    progressTrack: document.getElementById('progress-track'),
    progressFill: document.getElementById('progress-fill'),
    btnPrev: document.getElementById('btn-prev'),
    btnPlay: document.getElementById('btn-play'),
    playIcon: document.getElementById('play-icon'),
    btnNext: document.getElementById('btn-next'),
    btnEmergency: document.getElementById('btn-emergency'),
    playlistToggle: document.getElementById('playlist-toggle'),
    playlist: document.getElementById('playlist'),
    toggleArrow: document.getElementById('toggle-arrow'),
    // Phase 5: Offset
    offsetDisplay: document.getElementById('offset-display'),
    offsetPlus05: document.getElementById('offset-plus05'),
    offsetMinus05: document.getElementById('offset-minus05'),
    offsetPlus01: document.getElementById('offset-plus01'),
    offsetMinus01: document.getElementById('offset-minus01'),
    offsetReset: document.getElementById('offset-reset'),
    // Phase 5: Manual lyrics
    btnLyricsDrop: document.getElementById('btn-lyrics-drop'),
    btnLyricsPaste: document.getElementById('btn-lyrics-paste'),
    lyricsFileInput: document.getElementById('lyrics-file-input'),
    lyricsPasteModal: document.getElementById('lyrics-paste-modal'),
    lyricsPasteTextarea: document.getElementById('lyrics-paste-textarea'),
    lyricsPasteConfirm: document.getElementById('lyrics-paste-confirm'),
    lyricsPasteCancel: document.getElementById('lyrics-paste-cancel'),
    // Phase 7: Pitch/Speed
    pitchSlider: document.getElementById('ctrl-pitch-slider'),
    pitchValue: document.getElementById('ctrl-pitch-value'),
    pitchReset: document.getElementById('ctrl-pitch-reset'),
    pitchUp: document.getElementById('ctrl-pitch-up'),
    pitchDown: document.getElementById('ctrl-pitch-down'),
    speedSlider: document.getElementById('ctrl-speed-slider'),
    speedValue: document.getElementById('ctrl-speed-value'),
    speedReset: document.getElementById('ctrl-speed-reset'),
    speedUp: document.getElementById('ctrl-speed-up'),
    speedDown: document.getElementById('ctrl-speed-down'),
    metronomeToggle: document.getElementById('ctrl-metronome-toggle'),
    lyricPreset: document.getElementById('ctrl-lyric-preset'),
    lyricPresetApply: document.getElementById('ctrl-lyric-preset-apply'),
  };

  // ─── 狀態 ───
  let isPlaying = false;
  let isEmergencyHidden = false;
  let currentStyle = 'cute';
  let currentMode = 'original';
  let playlist = [];
  let currentTrackIndex = -1;
  let currentTrackId = null;
  let playlistVisible = false;
  let currentOffsetMs = 0;
  let currentPitchShift = 0;
  let currentPlaybackRate = 1.0;
  let lastDuration = 0; // 由 lyrics:sync 取得，供進度條與拖曳跳轉換算
  let lyricSettings = {};

  // controller 重開時只會拿到目前歌曲物件和清單摘要；索引不能沿用舊分頁的值。
  // 集中走與桌面面板相同的純函式，讓貼歌詞、上傳歌詞與 offset 都指向正確歌曲。
  function reconcileCurrentTrackIndex(track) {
    currentTrackId = track && track.id != null ? track.id : null;
    currentTrackIndex = PlaylistState.reconcilePlaylist(playlist, currentTrackId).currentTrackIndex;
    return currentTrackIndex;
  }

  const TEMPLATE_IDS = ['classic', 'pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow'];
  const COLUMNFLOW_VARIANTS = ['sen', 'fuda'];
  const COLUMNFLOW_PLACEMENTS = ['left', 'right', 'split'];
  const COLUMNFLOW_MIN_LINES = 1;
  const COLUMNFLOW_MAX_LINES = 6;
  const TEMPLATE_SETTING_KEY = 'lyricTemplateSettings';
  const PRESET_KEY = 'lyricPresets';

  function normalizeColumnflowMaxLines(value) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return 4;
    return Math.max(COLUMNFLOW_MIN_LINES, Math.min(COLUMNFLOW_MAX_LINES, parsed));
  }

  function settingSnapshot(value) {
    const out = { ...(value || {}) };
    delete out[TEMPLATE_SETTING_KEY];
    delete out[PRESET_KEY];
    return out;
  }

  function applyLyricSettings(value) {
    if (!value || typeof value !== 'object') return;
    lyricSettings = { ...value };
    const template = TEMPLATE_IDS.includes(lyricSettings.template) ? lyricSettings.template : 'classic';
    const isColumnflow = template === 'columnflow';
    document.querySelectorAll('.ctrl-template-btn').forEach((b) => b.classList.toggle('active', b.dataset.template === template));
    document.querySelectorAll('.ctrl-columnflow-variant-btn').forEach((b) => b.classList.toggle('active', b.dataset.columnflowVariant === (lyricSettings.columnflowVariant || 'sen')));
    document.querySelectorAll('.ctrl-columnflow-placement-btn').forEach((b) => b.classList.toggle('active', b.dataset.columnflowPlacement === (lyricSettings.columnflowPlacement || 'split')));
    const columnflowMaxLines = normalizeColumnflowMaxLines(lyricSettings.columnflowMaxLines);
    document.querySelectorAll('.ctrl-columnflow-max-lines-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.columnflowMaxLines) === columnflowMaxLines));
    document.querySelectorAll('.ctrl-position-btn').forEach((b) => b.classList.toggle('active', b.dataset.position === (lyricSettings.lyricPosition || 'center')));
    document.querySelectorAll('.ctrl-intensity-btn').forEach((b) => b.classList.toggle('active', b.dataset.intensity === (lyricSettings.animationIntensity || 'normal')));
    const positionGroup = document.getElementById('ctrl-lyric-position-group');
    const columnflowGroup = document.getElementById('ctrl-columnflow-variant-group');
    const columnflowPlacementGroup = document.getElementById('ctrl-columnflow-placement-group');
    const columnflowMaxLinesGroup = document.getElementById('ctrl-columnflow-max-lines-group');
    if (positionGroup) positionGroup.hidden = isColumnflow;
    if (columnflowGroup) columnflowGroup.hidden = !isColumnflow;
    if (columnflowPlacementGroup) columnflowPlacementGroup.hidden = !isColumnflow;
    if (columnflowMaxLinesGroup) columnflowMaxLinesGroup.hidden = !isColumnflow;

    if (dom.lyricPreset) {
      const selected = dom.lyricPreset.value;
      const presets = Array.isArray(lyricSettings[PRESET_KEY]) ? lyricSettings[PRESET_KEY] : [];
      dom.lyricPreset.innerHTML = '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = presets.length ? '選擇已保存預設' : '尚未保存預設';
      dom.lyricPreset.appendChild(empty);
      presets.forEach((preset) => {
        const option = document.createElement('option');
        option.value = String(preset.id || '');
        option.textContent = String(preset.name || '').slice(0, 40);
        dom.lyricPreset.appendChild(option);
      });
      if (presets.some((preset) => String(preset.id) === selected)) dom.lyricPreset.value = selected;
    }
  }

  function pushLyricPatch(patch) {
    const currentTemplate = TEMPLATE_IDS.includes(lyricSettings.template) ? lyricSettings.template : 'classic';
    const stores = { ...(lyricSettings[TEMPLATE_SETTING_KEY] || {}) };
    stores[currentTemplate] = { ...settingSnapshot(lyricSettings), ...patch, template: currentTemplate };
    const payload = { ...lyricSettings, ...patch, [TEMPLATE_SETTING_KEY]: stores };
    applyLyricSettings(payload);
    SocketClient.send('lyric-settings:update', payload);
  }

  document.querySelectorAll('.ctrl-template-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTemplate = btn.dataset.template;
      if (!TEMPLATE_IDS.includes(nextTemplate)) return;
      const currentTemplate = TEMPLATE_IDS.includes(lyricSettings.template) ? lyricSettings.template : 'classic';
      const stores = { ...(lyricSettings[TEMPLATE_SETTING_KEY] || {}) };
      stores[currentTemplate] = { ...settingSnapshot(lyricSettings), template: currentTemplate };
      const next = stores[nextTemplate]
        ? { ...settingSnapshot(stores[nextTemplate]), template: nextTemplate }
        : { ...settingSnapshot(lyricSettings), template: nextTemplate };
      if ((nextTemplate === 'classic' || nextTemplate === 'ktv') && next.lyricPosition === 'split') next.lyricPosition = 'center';
      if (nextTemplate === 'columnflow' && !COLUMNFLOW_VARIANTS.includes(next.columnflowVariant)) next.columnflowVariant = 'sen';
      if (nextTemplate === 'columnflow' && !COLUMNFLOW_PLACEMENTS.includes(next.columnflowPlacement)) next.columnflowPlacement = 'split';
      if (nextTemplate === 'columnflow') next.columnflowMaxLines = normalizeColumnflowMaxLines(next.columnflowMaxLines);
      stores[nextTemplate] = { ...next };
      const payload = { ...next, [TEMPLATE_SETTING_KEY]: stores, [PRESET_KEY]: lyricSettings[PRESET_KEY] || [] };
      applyLyricSettings(payload);
      SocketClient.send('lyric-settings:update', payload);
    });
  });

  document.querySelectorAll('.ctrl-position-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const position = btn.dataset.position;
      if (!['center', 'left', 'right', 'split'].includes(position)) return;
      if (position === 'split' && (lyricSettings.template === 'classic' || lyricSettings.template === 'ktv')) {
        showToast('這個模板不支援左右分散', 'info');
        return;
      }
      pushLyricPatch({ lyricPosition: position });
    });
  });

  document.querySelectorAll('.ctrl-intensity-btn').forEach((btn) => {
    btn.addEventListener('click', () => pushLyricPatch({ animationIntensity: btn.dataset.intensity }));
  });

  document.querySelectorAll('.ctrl-columnflow-variant-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const variant = btn.dataset.columnflowVariant;
      if (lyricSettings.template !== 'columnflow' || !COLUMNFLOW_VARIANTS.includes(variant)) return;
      pushLyricPatch({ columnflowVariant: variant });
    });
  });

  document.querySelectorAll('.ctrl-columnflow-placement-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const placement = btn.dataset.columnflowPlacement;
      if (lyricSettings.template !== 'columnflow' || !COLUMNFLOW_PLACEMENTS.includes(placement)) return;
      pushLyricPatch({ columnflowPlacement: placement });
    });
  });

  document.querySelectorAll('.ctrl-columnflow-max-lines-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const maxLines = normalizeColumnflowMaxLines(btn.dataset.columnflowMaxLines);
      if (lyricSettings.template !== 'columnflow') return;
      pushLyricPatch({ columnflowMaxLines: maxLines });
    });
  });

  if (dom.lyricPresetApply) {
    dom.lyricPresetApply.addEventListener('click', () => {
      const presets = Array.isArray(lyricSettings[PRESET_KEY]) ? lyricSettings[PRESET_KEY] : [];
      const preset = presets.find((item) => String(item.id) === dom.lyricPreset.value);
      if (!preset || !preset.settings) return showToast('請先選擇預設', 'info');
      const next = { ...settingSnapshot(preset.settings) };
      if (!TEMPLATE_IDS.includes(next.template)) next.template = 'classic';
      if (next.template === 'columnflow' && !COLUMNFLOW_VARIANTS.includes(next.columnflowVariant)) next.columnflowVariant = 'sen';
      if (next.template === 'columnflow' && !COLUMNFLOW_PLACEMENTS.includes(next.columnflowPlacement)) next.columnflowPlacement = 'split';
      if (next.template === 'columnflow') next.columnflowMaxLines = normalizeColumnflowMaxLines(next.columnflowMaxLines);
      if ((next.template === 'classic' || next.template === 'ktv') && next.lyricPosition === 'split') next.lyricPosition = 'center';
      const stores = { ...(lyricSettings[TEMPLATE_SETTING_KEY] || {}), [next.template]: { ...next } };
      const payload = { ...next, [TEMPLATE_SETTING_KEY]: stores, [PRESET_KEY]: presets };
      applyLyricSettings(payload);
      SocketClient.send('lyric-settings:update', payload);
      showToast('已套用歌詞預設', 'success');
    });
  }

  // ═══════════════════════════════════════════
  // 連線狀態
  // ═══════════════════════════════════════════

  SocketClient.on('connection-change', (connected) => {
    const banner = document.getElementById('connection-banner');
    if (connected) {
      dom.connectionStatus.className = 'status-dot connected';
      dom.connectionText.textContent = '已連線';
      if (banner) banner.classList.remove('visible');
    } else {
      dom.connectionStatus.className = 'status-dot disconnected';
      dom.connectionText.textContent = '連線中...';
      if (banner) banner.classList.add('visible');
    }
  });

  // ═══════════════════════════════════════════
  // 播放控制
  // ═══════════════════════════════════════════

  dom.btnPrev.addEventListener('click', () => {
    SocketClient.send('play:prev');
  });

  dom.btnPlay.addEventListener('click', () => {
    SocketClient.send('play:toggle');
  });

  dom.btnNext.addEventListener('click', () => {
    SocketClient.send('play:next');
  });

  // 進度條點擊跳轉（換算成秒，與面板一致）
  dom.progressTrack.addEventListener('click', (e) => {
    if (!lastDuration) return; // 尚未取得時長就不跳轉
    const rect = dom.progressTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seconds = ratio * lastDuration;
    SocketClient.send('play:seek', seconds);
    // 樂觀更新本地顯示，操作更跟手
    if (dom.progressFill) dom.progressFill.style.width = (ratio * 100) + '%';
    dom.timeCurrent.textContent = formatTime(seconds);
  });

  // ═══════════════════════════════════════════
  // Phase 5: 時間偏移控制
  // ═══════════════════════════════════════════

  function updateOffsetDisplay() {
    if (dom.offsetDisplay) {
      const sign = currentOffsetMs >= 0 ? '+' : '';
      dom.offsetDisplay.textContent = `${sign}${(currentOffsetMs / 1000).toFixed(1)}s`;
    }
  }

  if (dom.offsetPlus05) {
    dom.offsetPlus05.addEventListener('click', () => adjustOffset(500));
  }
  if (dom.offsetMinus05) {
    dom.offsetMinus05.addEventListener('click', () => adjustOffset(-500));
  }
  if (dom.offsetPlus01) {
    dom.offsetPlus01.addEventListener('click', () => adjustOffset(100));
  }
  if (dom.offsetMinus01) {
    dom.offsetMinus01.addEventListener('click', () => adjustOffset(-100));
  }
  if (dom.offsetReset) {
    dom.offsetReset.addEventListener('click', () => {
      const trackId = playlist[currentTrackIndex] ? playlist[currentTrackIndex].id : null;
      if (!trackId) return;
      currentOffsetMs = 0;
      updateOffsetDisplay();
      SocketClient.send('offset:reset', trackId);
    });
  }

  function adjustOffset(deltaMs) {
    const trackId = playlist[currentTrackIndex] ? playlist[currentTrackIndex].id : null;
    if (!trackId) {
      showToast('請先選擇歌曲', 'error');
      return;
    }
    currentOffsetMs += deltaMs;
    updateOffsetDisplay();
    SocketClient.send('offset:adjust', { trackId, delta: deltaMs });
  }

  SocketClient.on('offset:update', (data) => {
    if (playlist[currentTrackIndex] && data.trackId === playlist[currentTrackIndex].id) {
      currentOffsetMs = data.offset || 0;
      updateOffsetDisplay();
    }
    const track = playlist.find(t => t.id === data.trackId);
    if (track) {
      track.offset = data.offset || 0;
      renderPlaylist();
    }
  });

  // ═══════════════════════════════════════════
  // Phase 5: 手動歌詞補救
  // ═══════════════════════════════════════════

  if (dom.btnLyricsDrop) {
    dom.btnLyricsDrop.addEventListener('click', () => {
      if (dom.lyricsFileInput) dom.lyricsFileInput.click();
    });
  }

  if (dom.lyricsFileInput) {
    dom.lyricsFileInput.addEventListener('change', () => {
      const file = dom.lyricsFileInput.files[0];
      if (file) uploadLyricsFile(file);
      dom.lyricsFileInput.value = '';
    });
  }

  async function uploadLyricsFile(file) {
    const trackId = playlist[currentTrackIndex] ? playlist[currentTrackIndex].id : null;
    if (!trackId) {
      showToast('請先選擇歌曲', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('lyrics', file);

    try {
      showToast('上傳中...', 'info');
      const res = await PinAuth.fetchWithPin('/api/lyrics/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        SocketClient.send('lyrics:manual', {
          trackId,
          lyrics: data.lyrics,
          lyricsType: data.lyricsType,
          parsedLyrics: data.parsedLyrics,
        });
        showToast(`歌詞已載入 (${data.lineCount} 行)`, 'success');

        // 更新本地 playlist
        const track = playlist.find(t => t.id === trackId);
        if (track) {
          track.lyrics = data.lyrics;
          track.lyricsType = data.lyricsType;
          track.manualLyrics = true;
          renderPlaylist();
        }
      } else {
        showToast(data.error || '歌詞解析失敗', 'error');
      }
    } catch (err) {
      showToast('上傳失敗: ' + err.message, 'error');
    }
  }

  if (dom.btnLyricsPaste) {
    dom.btnLyricsPaste.addEventListener('click', () => {
      const trackId = playlist[currentTrackIndex] ? playlist[currentTrackIndex].id : null;
      if (!trackId) {
        showToast('請先選擇歌曲', 'error');
        return;
      }
      if (dom.lyricsPasteModal) {
        dom.lyricsPasteModal.classList.add('active');
        dom.lyricsPasteTextarea.value = '';
        dom.lyricsPasteTextarea.focus();
      }
    });
  }

  if (dom.lyricsPasteConfirm) {
    dom.lyricsPasteConfirm.addEventListener('click', async () => {
      const content = dom.lyricsPasteTextarea ? dom.lyricsPasteTextarea.value.trim() : '';
      if (!content) {
        showToast('請輸入歌詞內容', 'error');
        return;
      }

      const trackId = playlist[currentTrackIndex] ? playlist[currentTrackIndex].id : null;
      if (!trackId) return;

      try {
        const res = await PinAuth.fetchWithPin('/api/lyrics/paste', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const data = await res.json();

        if (data.success) {
          SocketClient.send('lyrics:manual', {
            trackId,
            lyrics: data.lyrics,
            lyricsType: data.lyricsType,
            parsedLyrics: data.parsedLyrics,
          });
          showToast(`歌詞已載入 (${data.lineCount} 行)`, 'success');

          const track = playlist.find(t => t.id === trackId);
          if (track) {
            track.lyrics = data.lyrics;
            track.lyricsType = data.lyricsType;
            track.manualLyrics = true;
            renderPlaylist();
          }
        } else {
          showToast(data.error || '歌詞解析失敗', 'error');
        }
      } catch (err) {
        showToast('解析失敗: ' + err.message, 'error');
      }

      dom.lyricsPasteModal.classList.remove('active');
    });
  }

  if (dom.lyricsPasteCancel) {
    dom.lyricsPasteCancel.addEventListener('click', () => {
      dom.lyricsPasteModal.classList.remove('active');
    });
  }

  // ═══════════════════════════════════════════
  // Phase 7: 變調控制
  // ═══════════════════════════════════════════

  if (dom.pitchSlider) {
    dom.pitchSlider.addEventListener('input', () => {
      currentPitchShift = parseInt(dom.pitchSlider.value, 10);
      if (dom.pitchValue) {
        const sign = currentPitchShift >= 0 ? '+' : '';
        dom.pitchValue.textContent = sign + currentPitchShift;
      }
      SocketClient.send('pitch:change', currentPitchShift);
    });
  }

  if (dom.pitchReset) {
    dom.pitchReset.addEventListener('click', () => {
      currentPitchShift = 0;
      if (dom.pitchSlider) dom.pitchSlider.value = 0;
      if (dom.pitchValue) dom.pitchValue.textContent = '0';
      SocketClient.send('pitch:change', 0);
    });
  }

  // ═══════════════════════════════════════════
  // Phase 7: 變速控制
  // ═══════════════════════════════════════════

  if (dom.speedSlider) {
    dom.speedSlider.addEventListener('input', () => {
      currentPlaybackRate = parseFloat(dom.speedSlider.value);
      if (dom.speedValue) {
        dom.speedValue.textContent = currentPlaybackRate.toFixed(2) + 'x';
      }
      SocketClient.send('speed:change', currentPlaybackRate);
    });
  }

  if (dom.speedReset) {
    dom.speedReset.addEventListener('click', () => {
      currentPlaybackRate = 1.0;
      if (dom.speedSlider) dom.speedSlider.value = 1;
      if (dom.speedValue) dom.speedValue.textContent = '1.00x';
      SocketClient.send('speed:change', 1.0);
    });
  }

  // 變調/變速 上下按鈕：調整隱藏 slider 並觸發 input
  function ctrlStep(slider, delta) {
    if (!slider) return;
    const step = parseFloat(slider.step) || 1;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    let v = parseFloat(slider.value) + delta * step;
    v = Math.round(v / step) * step;
    v = Math.max(min, Math.min(max, v));
    slider.value = v;
    slider.dispatchEvent(new Event('input'));
  }
  if (dom.pitchUp) dom.pitchUp.addEventListener('click', () => ctrlStep(dom.pitchSlider, +1));
  if (dom.pitchDown) dom.pitchDown.addEventListener('click', () => ctrlStep(dom.pitchSlider, -1));
  if (dom.speedUp) dom.speedUp.addEventListener('click', () => ctrlStep(dom.speedSlider, +1));
  if (dom.speedDown) dom.speedDown.addEventListener('click', () => ctrlStep(dom.speedSlider, -1));

  // ═══════════════════════════════════════════
  // Phase 7: 前奏倒數提示開關
  // ═══════════════════════════════════════════

  if (dom.metronomeToggle) {
    dom.metronomeToggle.addEventListener('change', () => {
      const enabled = dom.metronomeToggle.checked;
      SocketClient.send('metronome:toggle', enabled);
    });
  }

  // 視覺風格切換
  // ═══════════════════════════════════════════

  document.querySelectorAll('.ctrl-style-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.style;
      currentStyle = style;

      document.querySelectorAll('.ctrl-style-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      SocketClient.send('style:change', style);
    });
  });

  // ═══════════════════════════════════════════
  // 顯示模式切換
  // ═══════════════════════════════════════════

  document.querySelectorAll('.ctrl-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      currentMode = mode;

      document.querySelectorAll('.ctrl-mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      SocketClient.send('romanization:mode', mode);
    });
  });

  // ═══════════════════════════════════════════
  // 緊急隱藏
  // ═══════════════════════════════════════════

  dom.btnEmergency.addEventListener('click', () => {
    isEmergencyHidden = !isEmergencyHidden;
    dom.btnEmergency.classList.toggle('active', isEmergencyHidden);

    if (isEmergencyHidden) {
      SocketClient.send('emergency:hide');
    } else {
      SocketClient.send('emergency:show');
    }
  });

  // ═══════════════════════════════════════════
  // 播放列表展開/收起
  // ═══════════════════════════════════════════

  dom.playlistToggle.addEventListener('click', () => {
    playlistVisible = !playlistVisible;
    dom.playlist.classList.toggle('visible', playlistVisible);
    dom.playlistToggle.classList.toggle('open', playlistVisible);
  });

  // ═══════════════════════════════════════════
  // Socket 事件處理 - 更新 UI
  // ═══════════════════════════════════════════

  // 播放歌曲
  SocketClient.on('play:track', (track) => {
    reconcileCurrentTrackIndex(track);
    dom.trackTitle.textContent = track.title || '未知歌曲';
    dom.trackArtist.textContent = track.artist || '';

    const coverUrl = safeHttpUrl(track.cover);
    if (coverUrl) {
      dom.albumArt.style.backgroundImage = `url(${JSON.stringify(coverUrl)})`;
    } else {
      dom.albumArt.style.backgroundImage = 'none';
    }

    isPlaying = true;
    dom.playIcon.textContent = '❚❚';

    // Phase 5: Offset
    if (typeof track.offset === 'number') {
      currentOffsetMs = track.offset;
      updateOffsetDisplay();
    }
    renderPlaylist();
  });

  // 播放/暫停
  SocketClient.on('play:toggle', (playing) => {
    isPlaying = playing;
    dom.playIcon.textContent = playing ? '❚❚' : '▶';
  });

  // 歌詞時間同步（同時驅動進度條填色與總時長）
  SocketClient.on('lyrics:sync', (data) => {
    if (!data || typeof data.currentTime !== 'number') return;
    dom.timeCurrent.textContent = formatTime(data.currentTime);
    if (typeof data.duration === 'number' && data.duration > 0) {
      lastDuration = data.duration;
      dom.timeTotal.textContent = formatTime(data.duration);
      const pct = Math.max(0, Math.min(100, (data.currentTime / data.duration) * 100));
      if (dom.progressFill) dom.progressFill.style.width = pct + '%';
    }
  });

  // 風格切換同步
  SocketClient.on('style:change', (style) => {
    currentStyle = style;
    document.querySelectorAll('.ctrl-style-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.style === style);
    });
  });

  // 羅馬拼音模式同步
  SocketClient.on('romanization:mode', (mode) => {
    currentMode = mode;
    document.querySelectorAll('.ctrl-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  });

  SocketClient.on('lyric-settings:update', applyLyricSettings);

  // 緊急隱藏同步
  SocketClient.on('emergency:hide', () => {
    isEmergencyHidden = true;
    dom.btnEmergency.classList.add('active');
  });

  SocketClient.on('emergency:show', () => {
    isEmergencyHidden = false;
    dom.btnEmergency.classList.remove('active');
  });

  // 播放列表更新
  SocketClient.on('playlist:update', (newPlaylist) => {
    playlist = Array.isArray(newPlaylist) ? newPlaylist : [];
    reconcileCurrentTrackIndex(currentTrackId ? { id: currentTrackId } : null);
    renderPlaylist();
  });

  // 完整狀態同步
  SocketClient.on('state:sync', (state) => {
    const hasCurrentTrack = Object.prototype.hasOwnProperty.call(state || {}, 'currentTrack');
    const hasPlaylist = Array.isArray(state?.playlist);

    // 清單必須先更新，才能用 currentTrack.id 找到正確列。
    if (hasPlaylist) playlist = state.playlist;

    // 風格
    if (state.style) {
      currentStyle = state.style;
      document.querySelectorAll('.ctrl-style-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.style === state.style);
      });
    }

    // 羅馬模式
    if (state.romanizationMode) {
      currentMode = state.romanizationMode;
      document.querySelectorAll('.ctrl-mode-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === state.romanizationMode);
      });
    }
    if (state.lyricSettings) applyLyricSettings(state.lyricSettings);

    // 播放狀態
    if (state.isPlaying !== undefined) {
      isPlaying = state.isPlaying;
      dom.playIcon.textContent = isPlaying ? '❚❚' : '▶';
    }

    // 當前歌曲
    if (state.currentTrack) {
      const track = state.currentTrack;
      reconcileCurrentTrackIndex(track);
      dom.trackTitle.textContent = track.title || '未知歌曲';
      dom.trackArtist.textContent = track.artist || '';
      const coverUrl = safeHttpUrl(track.cover);
      if (coverUrl) {
        dom.albumArt.style.backgroundImage = `url(${JSON.stringify(coverUrl)})`;
      } else {
        dom.albumArt.style.backgroundImage = 'none';
      }
      // Phase 5: Offset
      if (typeof track.offset === 'number') {
        currentOffsetMs = track.offset;
        updateOffsetDisplay();
      }
    } else if (hasCurrentTrack) {
      reconcileCurrentTrackIndex(null);
      dom.trackTitle.textContent = '尚未播放';
      dom.trackArtist.textContent = '';
      dom.albumArt.style.backgroundImage = 'none';
    }

    // 緊急隱藏
    if (state.emergencyHide !== undefined) {
      isEmergencyHidden = state.emergencyHide;
      dom.btnEmergency.classList.toggle('active', isEmergencyHidden);
    }

    // 播放列表
    if (hasPlaylist || hasCurrentTrack) {
      if (!hasCurrentTrack) reconcileCurrentTrackIndex(currentTrackId ? { id: currentTrackId } : null);
      renderPlaylist();
    }

    // Phase 5: Offset
    if (typeof state.currentOffset === 'number') {
      currentOffsetMs = state.currentOffset;
      updateOffsetDisplay();
    }
    // Phase 7: Pitch/Speed
    if (typeof state.pitchShift === 'number') {
      currentPitchShift = state.pitchShift;
      if (dom.pitchSlider) dom.pitchSlider.value = state.pitchShift;
      if (dom.pitchValue) {
        const sign = state.pitchShift >= 0 ? '+' : '';
        dom.pitchValue.textContent = sign + state.pitchShift;
      }
    }
    if (typeof state.playbackRate === 'number') {
      currentPlaybackRate = state.playbackRate;
      if (dom.speedSlider) dom.speedSlider.value = state.playbackRate;
      if (dom.speedValue) dom.speedValue.textContent = state.playbackRate.toFixed(2) + 'x';
    }
    if (typeof state.metronomeEnabled === 'boolean') {
      if (dom.metronomeToggle) dom.metronomeToggle.checked = state.metronomeEnabled;
    }
  });

  // Phase 7: 接收遠端 pitch/speed 變更
  SocketClient.on('pitch:update', (semitones) => {
    if (typeof semitones !== 'number') return;
    currentPitchShift = semitones;
    if (dom.pitchSlider) dom.pitchSlider.value = semitones;
    if (dom.pitchValue) {
      const sign = semitones >= 0 ? '+' : '';
      dom.pitchValue.textContent = sign + semitones;
    }
  });

  SocketClient.on('speed:update', (rate) => {
    if (typeof rate !== 'number') return;
    currentPlaybackRate = rate;
    if (dom.speedSlider) dom.speedSlider.value = rate;
    if (dom.speedValue) dom.speedValue.textContent = rate.toFixed(2) + 'x';
  });

  SocketClient.on('metronome:update', (enabled) => {
    if (dom.metronomeToggle) dom.metronomeToggle.checked = !!enabled;
  });

  // Phase 5: 音訊錯誤通知
  SocketClient.on('audio:error', (data) => {
    showToast(data.message || '音訊播放錯誤', 'error');
  });

  SocketClient.on('audio:skip', () => {
    showToast('正在跳到下一首...', 'info');
  });

  // ═══════════════════════════════════════════
  // 播放列表渲染
  // ═══════════════════════════════════════════

  function renderPlaylist() {
    if (playlist.length === 0) {
      dom.playlist.innerHTML = `
        <div class="ctrl-playlist-empty">
          <p>尚無歌曲</p>
          <p class="hint">請從控制面板新增歌曲</p>
        </div>`;
      return;
    }

    dom.playlist.innerHTML = playlist.map((track, i) => {
      const isActive = i === currentTrackIndex;
      // Phase 5: Status badges
      let statusBadge = '';
      if (track.manualLyrics) {
        statusBadge = '<span class="ctrl-status-badge manual">已選</span>';
      } else if (track.lyricsType) {
        statusBadge = `<span class="ctrl-status-badge">${escapeHtml(track.lyricsType.toUpperCase())}</span>`;
      }

      const offsetMs = track.offset || 0;
      const offsetBadge = offsetMs !== 0
        ? `<span class="ctrl-status-badge offset">${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s</span>`
        : '';

      return `
        <div class="ctrl-playlist-item ${isActive ? 'active' : ''}" data-index="${i}">
          <div class="ctrl-playlist-item-cover"></div>
          <div class="ctrl-playlist-item-info">
            <div class="ctrl-playlist-item-title">${escapeHtml(track.title)}</div>
            <div class="ctrl-playlist-item-artist">${escapeHtml(track.artist || '未知歌手')}</div>
          </div>
          <div class="ctrl-playlist-item-badges">
            ${statusBadge}
            ${offsetBadge}
          </div>
        </div>`;
    }).join('');

    // 封面網址用 CSSOM 寫入，不把外部資料拼進 style HTML 屬性。
    playlist.forEach((track, i) => {
      if (!track || !track.cover) return;
      const coverUrl = safeHttpUrl(track.cover);
      if (!coverUrl) return;
      const cover = dom.playlist.querySelector(`[data-index="${i}"] .ctrl-playlist-item-cover`);
      if (cover) cover.style.backgroundImage = `url(${JSON.stringify(coverUrl)})`;
    });

    // 點擊播放
    dom.playlist.querySelectorAll('.ctrl-playlist-item').forEach((item) => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index, 10);
        currentTrackIndex = index;
        SocketClient.send('play:track', playlist[index]);
      });
    });
  }

  // ═══════════════════════════════════════════
  // Toast 通知
  // ═══════════════════════════════════════════

  function showToast(message, type = 'info') {
    if (typeof ErrorHandler !== 'undefined') {
      ErrorHandler.showToast(message, type);
    } else {
      // Fallback
      const toast = document.getElementById('ctrl-toast');
      if (!toast) return;

      toast.textContent = message;
      toast.className = `ctrl-toast ${type} visible`;

      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(() => {
        toast.classList.remove('visible');
      }, 4000);
    }
  }

})();
