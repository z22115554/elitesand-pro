/**
 * Elitesand Pro 控制面板主程式 v4 (Phase 7)
 * 負責檔案上傳、YouTube 處理、播放控制、UI 互動
 * 
 * Phase 7 增強：
 * - 🎹 變調 Slider（-12 ~ +12 半音）
 * - 🏃 變速 Slider（0.5x ~ 1.5x）
 * - Tone.js AudioProcessor 即時音訊處理
 * - 前奏倒數提示開關
 * - playbackRate 歌詞同步補償
 */
(function () {
  'use strict';

  const { formatTime, escapeHtml } = SharedUtils;
  const { dom } = AppShared;

  // ─── 初始化 Socket ───
  SocketClient.init('controller');

  // 初始化錯誤處理系統
  if (typeof ErrorHandler !== 'undefined') {
    ErrorHandler.init();
  }

  // ─── 狀態 ───
  let playlist = [];
  let currentTrackIndex = -1;

  function applySyncedPlaylist(nextPlaylist, currentTrackId) {
    const reconciled = PlaylistState.reconcilePlaylist(nextPlaylist, currentTrackId);
    playlist = reconciled.playlist;
    currentTrackIndex = reconciled.currentTrackIndex;
    AppShared.renderPlaylist();
  }

  // 對外暴露當前歌曲，供歌詞選擇器（lyric-extras.js）使用
  window.VKState = {
    getCurrentTrack: () => (currentTrackIndex >= 0 && playlist[currentTrackIndex]) ? playlist[currentTrackIndex] : null,
    // 供媒體庫（media-library.js）以 YouTube 網址重新匯入並加入播放清單。
    // 走同一個匯入佇列：快速連點多首也只會一次下載一首，不會併發把記憶體吃爆（OOM 實機回報）。
    importYouTubeUrl: (url) => AppShared.queueYouTubeImport(url),
    // 媒體庫即時還原：直接把伺服器組好的 track（含本機檔名/歌詞/變調）加入清單，零下載。
    // 一律附加到清單末端（允許重複，由呼叫端先確認）；重複曲沿用同一 id＝共享該首的變調/歌詞記憶。
    addLibraryTrack: (track) => {
      if (!track || !track.id) return null;
      playlist.push(track);
      AppShared.renderPlaylist();
      SocketClient.send('playlist:add', [track]);
      if (currentTrackIndex === -1) AppShared.playTrack(playlist.length - 1, false);
      return track;
    },
    // 媒體庫用來判斷是否要跳「重複加入」確認
    isInPlaylist: (id) => playlist.some((t) => t.id === id),
    // 目前播放清單正在使用的本機檔名（給音檔清理參考；伺服器端亦自行計算）
    getPlaylistFilenames: () => playlist.map((t) => t.filename).filter(Boolean),
    // 供歌詞選擇器（lyric-extras.js）套用候選歌詞給任一首歌（不限當前播放中的那首）：
    // 更新本地清單顯示（歌詞狀態 dot 立即翻色）＋通知伺服器暫存，函式本身已處理兩者。
    applyManualLyrics: (trackId, lyrics, lyricsType, parsedLyrics) =>
      AppShared.applyManualLyrics(trackId, lyrics, lyricsType, parsedLyrics),
  };
  let isEmergencyHidden = false;

  // ─── 核心狀態代理到 AppShared.state（供之後拆出去的其他模組讀寫）───
  // 用 getter/setter 代理到上面這幾個區域變數本體，不是複製一份快照。
  // app.js 內部繼續用原本的裸變數名稱（playlist/currentTrackIndex/...），完全不用改
  // 既有的呼叫點；其他模組（例如 app-youtube-import.js）透過 AppShared.state.playlist
  // 讀寫時，動的就是這裡的同一份變數。currentOffsetMs/lastPlayTimeMs/currentPitchShift/
  // currentPlaybackRate 這幾個只有播放相關程式碼會用到，改由 app-playback.js 當本體
  // （見該檔案開頭的 Object.defineProperty）。
  Object.defineProperty(AppShared.state, 'playlist', {
    get: () => playlist, set: (v) => { playlist = v; },
  });
  Object.defineProperty(AppShared.state, 'currentTrackIndex', {
    get: () => currentTrackIndex, set: (v) => { currentTrackIndex = v; },
  });
  // 跨模組會呼叫到的核心函式（函式本體現在還在 app.js 裡，之後批次搬到各自的檔案時
  // 只要把函式定義搬過去、這裡的曝露方式不用變）。
  AppShared.renderLyricsPreview = (...args) => renderLyricsPreview(...args);


  // ═══════════════════════════════════════════
  // 分頁切換
  // ═══════════════════════════════════════════

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = `tab-${btn.dataset.tab}`;
      document.getElementById(tabId).classList.add('active');
    });
  });

  // 歌詞詳細設定 modal 開關（設定頁進階區）
  (function initDisplayAdvancedModal() {
    const btn = document.getElementById('btn-display-advanced');
    const modal = document.getElementById('display-advanced-modal');
    const close = document.getElementById('display-advanced-close');
    if (!btn || !modal) return;
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    btn.addEventListener('click', () => { modal.hidden = false; });
    if (close) close.addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  })();

  // 預覽底色黑/白切換：在每個預覽 wrap 注入小鈕，全部一起切換並記憶
  (function initPreviewBgToggle() {
    const KEY = 'vk-preview-bg';
    const SEL = '.obs-preview-wrap, .setlist-preview-wrap';
    const wraps = document.querySelectorAll(SEL);
    if (!wraps.length) return;
    // 關鍵：預覽是 <iframe>（/display?preview=1、/setlist），iframe 的「畫布底色」由
    // color-scheme 決定，預設 normal＝白底——即使 iframe 內文件 html/body 設了背景透明，
    // 瀏覽器仍會用白色畫布把它畫出來，蓋掉後面 wrap 的黑底。這正是「深色模式下切黑沒反應、
    // 永遠一片白」的真正原因。
    // 注意：color-scheme 必須設在 iframe「裡面那份文件自己的 <html>」上才有效——設在父層
    // <iframe> 標籤本身完全沒用（試過，iframe 內文件的 computed color-scheme 還是
    // normal，白底沒變；這是兩個獨立的 browsing context，父層的 color-scheme 不會傳進去）。
    // 所以一定要透過 contentDocument 直接改內部文件的 <html> style。
    // 另外 iframe 的 src 是非同步載入，若 applyBg 執行時內部文件還沒載完（例如剛設完
    // src 那一刻 contentDocument 還是 about:blank），之後真正的頁面載入完成會整份換掉
    // <html>，把我們設的 color-scheme 沖掉——所以要在 iframe 的 load 事件也重新套用一次。
    const setIframeColorScheme = (iframe, light) => {
      try {
        const idoc = iframe.contentDocument;
        if (idoc && idoc.documentElement) idoc.documentElement.style.colorScheme = light ? 'light' : 'dark';
      } catch (e) { /* 跨網域等例外情況靜默忽略 */ }
    };
    const applyBg = (wrap, light) => {
      wrap.classList.toggle('bg-light', light);
      wrap.style.backgroundColor = light ? '#ffffff' : '';
      wrap.querySelectorAll('iframe').forEach((f) => {
        setIframeColorScheme(f, light);
        f.dataset.previewLight = light ? '1' : '0'; // 給 load 事件重新套用時查目前狀態
      });
    };
    const startLight = localStorage.getItem(KEY) === 'light';
    wraps.forEach((wrap) => {
      applyBg(wrap, startLight);
      wrap.querySelectorAll('iframe').forEach((f) => {
        f.addEventListener('load', () => setIframeColorScheme(f, f.dataset.previewLight === '1'));
      });
      if (wrap.querySelector('.preview-bg-toggle')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preview-bg-toggle';
      btn.title = '切換預覽底色（黑／白）';
      btn.setAttribute('aria-label', '切換預覽底色');
      btn.textContent = '◐';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const makeLight = !wrap.classList.contains('bg-light');
        document.querySelectorAll(SEL).forEach((w) => applyBg(w, makeLight));
        localStorage.setItem(KEY, makeLight ? 'light' : 'dark');
      });
      wrap.appendChild(btn);
    });
  })();

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

  // Socket offset 更新
  SocketClient.on('offset:update', (data) => {
    if (playlist[currentTrackIndex] && data.trackId === playlist[currentTrackIndex].id) {
      AppShared.state.currentOffsetMs = data.offset || 0;
      AppShared.updateOffsetDisplay();
    }
    // 更新 playlist 中的 offset
    const track = playlist.find(t => t.id === data.trackId);
    if (track) {
      track.offset = data.offset || 0;
      AppShared.renderPlaylist();
    }
  });



  // ═══════════════════════════════════════════
  // 歌詞預覽渲染
  // ═══════════════════════════════════════════

  function renderLyricsPreview(lrcText) {
    if (!lrcText) {
      dom.lyricsPreview.innerHTML = '<div class="lyric-preview-empty">此歌曲無歌詞</div>';
      return;
    }

    const lines = lrcText.split('\n');
    let html = '';

    for (const line of lines) {
      const text = line
        .replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '')
        .replace(/\[offset:-?\d+\]/gi, '')
        .replace(/<\d+(?:,\d+)?>/g, '')
        .trim();
      if (text) {
        html += `<div class="lyrics-line">${escapeHtml(text)}</div>`;
      }
    }

    dom.lyricsPreview.innerHTML = html || '<div class="lyric-preview-empty">無法解析歌詞</div>';
  }


  // ═══════════════════════════════════════════
  // Socket 狀態同步
  // ═══════════════════════════════════════════

  SocketClient.on('state:sync', (state) => {
    if (state.style) {
      StylePresets.setStyle(state.style);
      document.querySelectorAll('#style-buttons .style-thumb').forEach((b) => {
        b.classList.toggle('active', b.dataset.style === state.style);
      });
    }
    if (state.romanizationMode) {
      // 「單獨羅馬拼音」選項已移除；殘留的 'romanized' 自動遷移成「原文+拼音」並回寫伺服器
      let mode = state.romanizationMode;
      if (mode === 'romanized') {
        mode = 'both';
        SocketClient.send('romanization:mode', mode);
      }
      dom.romanizationMode.value = mode;
    }
    if (state.emergencyHide !== isEmergencyHidden) {
      isEmergencyHidden = state.emergencyHide;
      dom.btnEmergency.classList.toggle('active', isEmergencyHidden);
    }
    if (Array.isArray(state.playlist)) {
      applySyncedPlaylist(state.playlist, state.currentTrack && state.currentTrack.id);
    }
    // Phase 5: offset 恢復
    if (typeof state.currentOffset === 'number') {
      AppShared.state.currentOffsetMs = state.currentOffset;
      AppShared.updateOffsetDisplay();
    }
    // Phase 7: pitch/speed 恢復
    if (typeof state.pitchShift === 'number') {
      AppShared.state.currentPitchShift = state.pitchShift;
      if (dom.pitchSlider) dom.pitchSlider.value = state.pitchShift;
      if (dom.pitchValue) {
        const sign = state.pitchShift >= 0 ? '+' : '';
        dom.pitchValue.textContent = sign + state.pitchShift;
      }
    }
    if (typeof state.playbackRate === 'number') {
      AppShared.state.currentPlaybackRate = state.playbackRate;
      if (dom.speedSlider) dom.speedSlider.value = state.playbackRate;
      if (dom.speedValue) dom.speedValue.textContent = state.playbackRate.toFixed(2) + 'x';
      // audioPlayer.playbackRate 的設定已由下面的 applyPitchAndSpeed() 一併處理，不用重複設
    }
    if (typeof state.metronomeEnabled === 'boolean') {
      if (dom.metronomeToggle) dom.metronomeToggle.checked = state.metronomeEnabled;
    }
    AppShared.applyPitchAndSpeed();
  });

  SocketClient.on('playlist:update', (newPlaylist) => {
    const currentTrackId = PlaylistState.getTrackIdAtIndex(playlist, currentTrackIndex);
    applySyncedPlaylist(newPlaylist, currentTrackId);
  });

  // Phase 5: 歌詞更新（手動覆蓋後）
  SocketClient.on('lyrics:updated', (data) => {
    const track = playlist.find(t => t.id === data.trackId);
    if (track) {
      track.lyrics = data.lyrics;
      track.lyricsType = data.lyricsType;
      track.parsedLyrics = data.parsedLyrics;
      track.manualLyrics = true;
      if (playlist[currentTrackIndex] && playlist[currentTrackIndex].id === data.trackId) {
        renderLyricsPreview(data.lyrics);
      }
      AppShared.renderPlaylist();
    }
  });

  // Phase 5: 音訊錯誤通知
  SocketClient.on('audio:error', (data) => {
    AppShared.showToast(data.message || '音訊播放錯誤', 'error');
  });

  SocketClient.on('audio:skip', (data) => {
    AppShared.showToast('正在跳到下一首...', 'info');
  });

  // 羅馬化完成通知
  SocketClient.on('lyrics:romanized', (data) => {
    if (data && data.query) {
      console.log('[App] 羅馬化完成:', data.query);
    }
  });


})();
