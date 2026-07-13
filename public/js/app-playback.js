/**
 * 播放控制 —— 播放/暫停/上一首/下一首/進度條拖曳/offset 校正/變調變速/音量/SoundTouch。
 *
 * 風險最高的一批：SoundTouch/Tone.js 初始化時序、<audio> 元素狀態、迷你播放器代理呼叫
 * 全部在這裡。playlist/currentTrackIndex 仍由 app.js 持有（透過 AppShared.state 代理讀寫）；
 * currentOffsetMs/lastPlayTimeMs/currentPitchShift/currentPlaybackRate 這幾個只有播放相關
 * 程式碼會用到，改成由「這個檔案」當本體，同樣透過 AppShared.state 代理曝露。
 *
 * 對外暴露：playTrack/stopPlayback/updatePlayButton/updateMiniPlayerInfo/updateOffsetDisplay/
 * applyPitchAndSpeed（供 app.js 的 state:sync 等跨模組 dispatch 呼叫）。
 */
(function () {
  'use strict';

  const { formatTime } = SharedUtils;
  const { dom } = AppShared;
  const state = AppShared.state;

  const audioPlayer = document.getElementById('audio-player');
  let audioErrorCount = 0;

  let lastSyncTime = 0;
  const SYNC_INTERVAL = 200;
  let isSeeking = false; // 進度條拖曳中

  // Phase 7: 變調與變速狀態
  let currentPitchShift = 0;   // 半音偏移，-12 ~ +12
  let currentPlaybackRate = 1.0; // 播放速率，0.5 ~ 1.5
  let audioProcessorReady = false;

  // ── 高品質變調（SoundTouch/WSOLA）：一律啟用。舊的 <audio>+Tone 預設變調實際上不堪用
  // （使用者實測），所以不再提供開關；AudioWorklet 載入或 decode 失敗時仍會自動降級回 <audio>+Tone。──
  const useSoundTouch = true;
  // ── 連續播放：ON＝一首播完自動播下一首（player 模式）；OFF（預設）＝單曲，播完停 ──
  let continuousPlay = false;
  try { continuousPlay = localStorage.getItem('vk-continuous') === '1'; } catch (e) { /* 靜默 */ }
  let stReady = false;            // 當前歌的 buffer 是否已 decode 完成
  let stCtx = null, stGain = null;
  let isPlaying = false;
  let currentOffsetMs = 0; // Phase 5: 當前歌曲 offset
  let lastPlayTimeMs = 0;  // 最新播放位置（ms）；timeupdate 與 SoundTouch 回呼都更新，給「對齊第一句」用

  // 這幾個只有播放相關程式碼會動（原本背後變數在 app.js，現在搬到這裡當本體）。
  Object.defineProperty(state, 'currentOffsetMs', {
    get: () => currentOffsetMs, set: (v) => { currentOffsetMs = v; },
  });
  Object.defineProperty(state, 'lastPlayTimeMs', {
    get: () => lastPlayTimeMs, set: (v) => { lastPlayTimeMs = v; },
  });
  Object.defineProperty(state, 'currentPitchShift', {
    get: () => currentPitchShift, set: (v) => { currentPitchShift = v; },
  });
  Object.defineProperty(state, 'currentPlaybackRate', {
    get: () => currentPlaybackRate, set: (v) => { currentPlaybackRate = v; },
  });

  function stInitChain() {
    if (stCtx) return true;
    if (typeof SoundTouchEngine === 'undefined') return false;
    try {
      stCtx = new (window.AudioContext || window.webkitAudioContext)();
      stGain = stCtx.createGain();
      stGain.gain.value = (typeof AudioProcessor !== 'undefined' && AudioProcessor.getVolume) ? AudioProcessor.getVolume() : 0.7;
      stGain.connect(stCtx.destination);
      SoundTouchEngine.attach(stCtx, stGain);
      SoundTouchEngine.onTime((t) => stOnTime(t));
      // 與下方 <audio> 的 'ended' 處理邏輯一致：連續播放才自動播下一首，
      // 否則只載入待命（先前這裡忽略了 continuousPlay，導致開啟 SoundTouch 高品質變調時
      // 「連續播放」開關完全失效，一律表現成單曲播完就停）。
      SoundTouchEngine.onEnded(() => {
        const next = PlaybackSequence.nextAfterEnded(
          state.currentTrackIndex,
          state.playlist.length,
          continuousPlay,
        );
        if (next) playTrack(next.index, next.autoplay);
      });
      return true;
    } catch (e) { console.warn('[SoundTouch] 初始化失敗，降級:', e.message); return false; }
  }
  function stActive() { return useSoundTouch && stReady; }
  let stLoadToken = 0; // 防止快速切歌時，較舊的載入結果覆蓋較新的 stReady
  async function stLoadCurrent(filename) {
    stReady = false;
    if (!useSoundTouch || !filename) return;
    if (!stInitChain()) return;
    const myToken = ++stLoadToken;
    try { if (stCtx.state === 'suspended') await stCtx.resume(); } catch (e) { /* 靜默 */ }
    const ok = await SoundTouchEngine.load('/audio/' + encodeURIComponent(filename));
    if (myToken !== stLoadToken) return; // 已有更新的載入發生 → 丟棄這次結果
    stReady = ok;
  }
  // SoundTouch 播放時的時間回呼：更新進度條 + 廣播 lyrics:sync（取代 audioPlayer 的 timeupdate）
  function stOnTime(t) {
    const dur = SoundTouchEngine.getDuration() || 0;
    if (!dur) return;
    setTotalTime(formatTime(dur));
    if (!isSeeking) {
      setProgressFill((t / dur) * 100);
      setCurrentTime(formatTime(t));
    }
    lastPlayTimeMs = (t || 0) * 1000; // SoundTouch 播放位置（給「對齊第一句」用）
    const now = Date.now();
    if (now - lastSyncTime >= SYNC_INTERVAL) {
      lastSyncTime = now;
      SocketClient.send('lyrics:sync', { currentTime: t, duration: dur });
    }
  }

  /**
   * Phase 7: 初始化 AudioProcessor（首次播放時）
   */
  function initAudioProcessorOnce() {
    if (audioProcessorReady) return;
    if (typeof AudioProcessor === 'undefined') {
      console.warn('[App] AudioProcessor 模組未載入');
      return;
    }
    const success = AudioProcessor.init(audioPlayer);
    audioProcessorReady = success;
  }

  /**
   * Phase 7: 套用變調與變速到本地播放器
   */
  function applyPitchAndSpeed() {
    // 設定 playbackRate
    audioPlayer.playbackRate = currentPlaybackRate;

    // 設定 AudioProcessor
    if (audioProcessorReady && typeof AudioProcessor !== 'undefined') {
      AudioProcessor.setPitch(currentPitchShift);
      AudioProcessor.setRate(currentPlaybackRate);
    }
    // 高品質變調模式：同步到 SoundTouch 引擎（pitch 走 WSOLA、speed 走 tempo 時間伸縮）
    if (useSoundTouch && typeof SoundTouchEngine !== 'undefined') {
      SoundTouchEngine.setPitch(currentPitchShift);
      SoundTouchEngine.setTempo(currentPlaybackRate);
    }
  }

  /**
   * 套用某首歌記憶的變調/變速（從伺服器 enrich 的 track.pitchShift / track.playbackRate）。
   * 沒有記錄就回預設（0 / 1.0），讓每首獨立、切歌自動還原。同步更新滑桿/數字顯示。
   */
  function applyTrackPitchSpeed(track) {
    const p = (track && typeof track.pitchShift === 'number') ? track.pitchShift : 0;
    const r = (track && typeof track.playbackRate === 'number') ? track.playbackRate : 1.0;
    currentPitchShift = Math.max(-12, Math.min(12, p));
    currentPlaybackRate = Math.max(0.5, Math.min(1.5, r));
    if (dom.pitchSlider) dom.pitchSlider.value = currentPitchShift;
    if (dom.pitchValue) dom.pitchValue.textContent = (currentPitchShift >= 0 ? '+' : '') + currentPitchShift;
    if (dom.speedSlider) dom.speedSlider.value = currentPlaybackRate;
    if (dom.speedValue) dom.speedValue.textContent = currentPlaybackRate.toFixed(2) + 'x';
    applyPitchAndSpeed();
  }

  // ═══════════════════════════════════════════
  // 播放控制
  // ═══════════════════════════════════════════

  // autoplay：是否載入後立即播放。匯入新歌、自動換下一首時為 false（載入待命，由使用者按播放），
  // 使用者主動點歌 / 按上下首時為 true。
  function playTrack(index, autoplay = true) {
    const playlist = state.playlist;
    if (index < 0 || index >= playlist.length) return;

    const track = playlist[index];
    if (track.audioMissing) {
      AppShared.showToast(track.url
        ? `找不到「${track.title}」的音檔，請重新下載後再播放。`
        : `找不到「${track.title}」的音檔，且沒有可重新下載的來源。`, 'error');
      AppShared.renderPlaylist();
      return false;
    }

    state.currentTrackIndex = index;

    AppShared.setMarqueeText(dom.trackTitle, track.title);
    AppShared.setMarqueeText(dom.trackArtist, track.artist || '');
    updateMiniPlayerInfo(track.title, track.artist || '', track.cover);

    // 封面：np-art 是 div，用 background-image（先前誤設 .src 無效）
    if (track.cover) {
      dom.albumArt.style.backgroundImage = `url("${track.cover}")`;
      dom.albumArt.style.backgroundSize = 'cover';
      dom.albumArt.style.backgroundPosition = 'center';
      dom.albumArt.classList.remove('empty');
    } else {
      dom.albumArt.style.backgroundImage = '';
      dom.albumArt.classList.add('empty');
    }

    // Phase 5: 重置 offset
    currentOffsetMs = track.offset || track.lrcOffset || 0;
    updateOffsetDisplay();

    // 每首記憶的變調/變速：載入此歌時還原（沒記錄＝回預設 0 / 1.0，每首獨立）。
    // 必須在下方啟動 SoundTouch 播放「之前」設好，否則會用到上一首的 key。
    applyTrackPitchSpeed(track);

    if (track.filename) {
      audioErrorCount = 0;
      audioPlayer.src = `/audio/${encodeURIComponent(track.filename)}`;
      audioPlayer.playbackRate = currentPlaybackRate; // Phase 7: 保持當前速率
      // 切歌：先停掉並銷毀上一首的 SoundTouch 節點，避免舊節點變孤兒繼續播放、停不下來。
      // 注意：load 只在下方各分支「呼叫一次」——重複 stLoadCurrent 會讓兩個 load 競態、產生孤兒節點。
      if (useSoundTouch) { try { SoundTouchEngine.stop(); } catch (e) {} }
      if (autoplay) {
        if (useSoundTouch) {
          // SoundTouch 路徑：等 buffer 好再播；<audio> 靜音待命當備援
          audioPlayer.muted = true;
          stLoadCurrent(track.filename).then(() => {
            if (stReady) {
              SoundTouchEngine.setPitch(currentPitchShift);
              SoundTouchEngine.setTempo(currentPlaybackRate);
              SoundTouchEngine.play(0);
              isPlaying = true; updatePlayButton();
            } else {
              // decode 失敗 → 降級回 <audio>+Tone
              audioPlayer.muted = false;
              initAudioProcessorOnce();
              if (audioProcessorReady) applyPitchAndSpeed();
              audioPlayer.play().catch((err) => handleAudioError(err));
              isPlaying = true; updatePlayButton();
            }
          });
        } else {
          // 先建管線再播放，避免「原調＋變調」雙重聲音（見播放鍵說明）
          initAudioProcessorOnce();
          if (audioProcessorReady) applyPitchAndSpeed();
          audioPlayer.play().then(() => {
            isPlaying = true;
            updatePlayButton();
          }).catch((err) => {
            console.error('[Audio] 播放失敗:', err);
            handleAudioError(err);
            isPlaying = false;
            updatePlayButton();
          });
        }
      } else {
        // 載入但不播放：暫停待命，由使用者按播放鍵開始
        if (useSoundTouch) stLoadCurrent(track.filename); // 待命載入（不自動播）
        audioPlayer.load();
        isPlaying = false;
        updatePlayButton();
      }
    }

    if (track.lyrics) {
      AppShared.renderLyricsPreview(track.lyrics);
    } else {
      dom.lyricsPreview.innerHTML = '<div class="lyric-preview-empty">此歌曲無歌詞</div>';
    }

    // 帶上 autoplay：伺服器據此決定 isPlaying 與「是否記入已唱歌單」（待命載入不記錄）
    SocketClient.send('play:track', { ...track, autoplay });
    // 載入待命時明確告知顯示端「暫停」，否則顯示端會以為在播放而讓歌詞自走
    if (!autoplay) SocketClient.send('play:toggle', false);
    AppShared.renderPlaylist();
  }

  function stopPlayback() {
    audioPlayer.pause();
    audioPlayer.src = '';
    isPlaying = false;
    updatePlayButton();
    AppShared.setMarqueeText(dom.trackTitle, '尚未播放');
    AppShared.setMarqueeText(dom.trackArtist, '');
    updateMiniPlayerInfo('尚未播放', '', null);
    dom.albumArt.style.backgroundImage = '';
    dom.albumArt.classList.add('empty');
    dom.lyricsPreview.innerHTML = '<div class="lyric-preview-empty">尚無歌詞</div>';
    currentOffsetMs = 0;
    updateOffsetDisplay();
  }

  function updatePlayButton() {
    // 以 SVG 切換播放/暫停圖示
    const playIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    const pauseIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
    dom.btnPlay.innerHTML = isPlaying ? pauseIcon : playIcon;
    if (dom.miniBtnPlay) dom.miniBtnPlay.innerHTML = isPlaying ? pauseIcon : playIcon;
  }

  // 迷你播放器（切到媒體庫/設定/歌單頁時仍可切歌/播放/暫停，不必切回歌詞頁）。
  // 三顆按鈕直接代理點擊「正在播放」卡的真正按鈕，而不是重寫一份播放邏輯——
  // 這樣 SoundTouch/錯誤處理/socket 廣播等既有邏輯只有一份，兩邊永遠不會走鐘。
  function updateMiniPlayerInfo(title, artist, coverUrl) {
    if (dom.miniPlayerTitle) AppShared.setMarqueeText(dom.miniPlayerTitle, title);
    if (dom.miniPlayerArtist) AppShared.setMarqueeText(dom.miniPlayerArtist, artist || '');
    if (dom.miniPlayerArt) {
      if (coverUrl) {
        dom.miniPlayerArt.style.backgroundImage = `url("${coverUrl}")`;
        dom.miniPlayerArt.classList.remove('empty');
      } else {
        dom.miniPlayerArt.style.backgroundImage = '';
        dom.miniPlayerArt.classList.add('empty');
      }
    }
  }
  if (dom.miniBtnPrev) dom.miniBtnPrev.addEventListener('click', () => dom.btnPrev.click());
  if (dom.miniBtnPlay) dom.miniBtnPlay.addEventListener('click', () => dom.btnPlay.click());
  if (dom.miniBtnNext) dom.miniBtnNext.addEventListener('click', () => dom.btnNext.click());
  // 只在非歌詞頁顯示（歌詞頁本身就有大張的「正在播放」卡，兩個一起顯示是重複視覺）
  if (dom.miniPlayer) {
    document.addEventListener('view:change', (e) => {
      dom.miniPlayer.hidden = !e.detail || e.detail.view === 'karaoke';
    });
  }

  // 面板是唯一擁有音訊的客戶端：播放/暫停/上一首/下一首一律經過這裡才會真的動到 <audio>。
  // 不管指令來自面板自己的按鍵、手機遙控器、還是 Stream Deck，最終都走同一條路徑——
  // 修正舊版「面板只送指令、從不聽指令」的漏洞（遙控器按了 cmd 有記錄，面板卻沒反應/沒聲音）。
  function requestPlayback(shouldPlay) {
    if (state.currentTrackIndex === -1) return;
    if (shouldPlay === isPlaying) return; // 已經是這個狀態了（多半是自己剛送出指令的回音），不重複觸發
    // 立刻同步鎖定狀態，不要等 SoundTouch 非同步 decode 完才設——否則 decode 那幾百毫秒的空窗期，
    // 若又收到一次回音/重複指令，上面的提早 return 擋不住（isPlaying 當下還是舊值），
    // 會讓 SoundTouch 被啟動兩次、雪崩式狂送 play:toggle（實測會看到播放/暫停瞬間狂跳）。
    isPlaying = shouldPlay;
    if (!shouldPlay) {
      if (stActive()) SoundTouchEngine.pause(); else audioPlayer.pause();
      updatePlayButton();
      SocketClient.send('play:toggle', isPlaying);
      return;
    }
    if (useSoundTouch) {
      // 高品質變調路徑：buffer 沒好就先 decode 再播
      audioPlayer.muted = true;
      const startST = () => {
        SoundTouchEngine.setPitch(currentPitchShift);
        SoundTouchEngine.setTempo(currentPlaybackRate);
        SoundTouchEngine.play();
        updatePlayButton(); SocketClient.send('play:toggle', true);
      };
      if (stReady) startST();
      else stLoadCurrent(state.playlist[state.currentTrackIndex] && state.playlist[state.currentTrackIndex].filename).then(() => {
        if (!isPlaying) return; // decode 完成前又被暫停了（本地或遠端），放棄這次播放
        if (stReady) startST();
        else { audioPlayer.muted = false; initAudioProcessorOnce(); if (audioProcessorReady) applyPitchAndSpeed(); audioPlayer.play().catch((e) => handleAudioError(e)); updatePlayButton(); SocketClient.send('play:toggle', true); }
      });
      return;
    }
    // 關鍵：先建立 Web Audio 管線（createMediaElementSource）再 play()。
    // 否則元素會先以「預設輸出」播放(原調)，之後才被接進圖→變調，
    // 形成「原調＋變調」雙重聲音。先建管線可確保只有一條輸出。
    initAudioProcessorOnce();
    if (audioProcessorReady) applyPitchAndSpeed();
    audioPlayer.play().catch((err) => { handleAudioError(err); });
    updatePlayButton();
    SocketClient.send('play:toggle', isPlaying);
  }

  dom.btnPlay.addEventListener('click', () => requestPlayback(!isPlaying));

  // 遙控器/Stream Deck 送來的播放/暫停：伺服器 io.emit 會連寄件者自己也收到一份回音，
  // 靠上面「已經是這個狀態」的提早 return 擋掉重複動作，兩種來源共用同一段真正執行播放的邏輯。
  SocketClient.on('play:toggle', (playing) => {
    if (typeof playing === 'boolean') requestPlayback(playing);
  });

  // 上一首/下一首是「相對移動」指令，不像播放/暫停有絕對值可以拿來擋回音，
  // 所以按鍵本身只送出指令、不在本地直接換歌——一律等伺服器廣播回來才真正換歌，
  // 這樣不管指令來自面板自己、遙控器、或 Stream Deck，永遠只換一次，不會連跳兩首。
  function advanceTrack(delta) {
    const playlist = state.playlist;
    if (playlist.length === 0) return;
    const newIndex = delta > 0
      ? (state.currentTrackIndex < playlist.length - 1 ? state.currentTrackIndex + 1 : 0)
      : (state.currentTrackIndex > 0 ? state.currentTrackIndex - 1 : playlist.length - 1);
    playTrack(newIndex);
  }

  dom.btnPrev.addEventListener('click', () => SocketClient.send('play:prev'));
  dom.btnNext.addEventListener('click', () => SocketClient.send('play:next'));

  SocketClient.on('play:prev', () => advanceTrack(-1));
  SocketClient.on('play:next', () => advanceTrack(1));

  // 遙控器選一首自己清單裡的歌（play:track）：伺服器會標記來源。
  // 是自己剛送出的回音就跳過（playTrack() 已經在本地處理過一次，不要重播/跳回 0 秒）；
  // 是「另一個面板分頁」送的也跳過——不然使用者不小心開兩個面板分頁時，
  // 兩邊會互相把對方的廣播當成外部指令執行、又各自送出新廣播，形成無窮迴圈換歌。
  // 只有真正「非面板」來源（手機遙控器）才代表這是外部指令，面板才需要真的落地執行。
  SocketClient.on('play:track', (track) => {
    if (!track) return;
    if (track._originSocketId === SocketClient.getId()) return;
    if (track._originClientType === 'controller') return;
    const idx = state.playlist.findIndex((t) => t.id === track.id);
    if (idx === -1) return;
    playTrack(idx, track.autoplay !== false);
  });

  audioPlayer.addEventListener('timeupdate', () => {
    lastPlayTimeMs = (audioPlayer.currentTime || 0) * 1000; // 給「對齊第一句」用（非 SoundTouch 路徑）
    if (!audioPlayer.duration) return;
    setTotalTime(formatTime(audioPlayer.duration));
    if (isSeeking) return; // 拖曳中由拖曳邏輯控制進度條，避免互相打架
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    setProgressFill(progress);
    setCurrentTime(formatTime(audioPlayer.currentTime));

    const now = Date.now();
    if (now - lastSyncTime >= SYNC_INTERVAL) {
      lastSyncTime = now;
      SocketClient.send('lyrics:sync', { currentTime: audioPlayer.currentTime, duration: audioPlayer.duration || 0 });
    }
  });

  // 來自遙控器的拖曳跳轉（秒）→ 套用到本地播放器（面板才是音訊來源）
  SocketClient.on('play:seek', (time) => {
    if (typeof time !== 'number' || !isFinite(time)) return;
    if (stActive()) {
      const dur = SoundTouchEngine.getDuration();
      if (dur) SoundTouchEngine.seek(Math.max(0, Math.min(dur, time)));
      return;
    }
    if (!audioPlayer.duration) return;
    // 差距夠大才套用，避免與自身發出的跳轉回音互相干擾
    if (Math.abs(audioPlayer.currentTime - time) < 0.4) return;
    audioPlayer.currentTime = Math.max(0, Math.min(audioPlayer.duration, time));
  });

  audioPlayer.addEventListener('ended', () => {
    const playlist = state.playlist;
    const next = PlaybackSequence.nextAfterEnded(
      state.currentTrackIndex,
      playlist.length,
      continuousPlay,
    );
    if (next) playTrack(next.index, next.autoplay);
  });

  // Phase 5: 音訊錯誤處理
  audioPlayer.addEventListener('error', () => {
    const error = audioPlayer.error;
    if (error) {
      handleAudioError(error);
    }
  });

  function handleAudioError(error) {
    audioErrorCount++;
    const msg = SharedUtils.getAudioErrorMessage(error);
    AppShared.showToast(msg, 'error');

    // 超過 3 次錯誤自動跳到下一首
    if (audioErrorCount >= 3 && state.playlist.length > 1) {
      AppShared.showToast('音訊解碼失敗次數過多，自動跳到下一首', 'error');
      const nextIndex = (state.currentTrackIndex + 1) % state.playlist.length;
      setTimeout(() => playTrack(nextIndex), 1500);
    }

    SocketClient.send('audio:error', {
      trackId: state.playlist[state.currentTrackIndex] ? state.playlist[state.currentTrackIndex].id : null,
      message: msg,
    });
  }

  // ─── 進度 UI 更新：主播放器與迷你播放器兩條進度條/時間一起更新 ───
  function setProgressFill(pct) {
    if (dom.progressFill) dom.progressFill.style.width = `${pct}%`;
    if (dom.progressThumb) dom.progressThumb.style.left = `${pct}%`;
    if (dom.miniProgressFill) dom.miniProgressFill.style.width = `${pct}%`;
    if (dom.miniProgressThumb) dom.miniProgressThumb.style.left = `${pct}%`;
  }
  function setCurrentTime(text) {
    if (dom.timeCurrent) dom.timeCurrent.textContent = text;
    if (dom.miniTimeCurrent) dom.miniTimeCurrent.textContent = text;
  }
  function setTotalTime(text) {
    if (dom.timeTotal) dom.timeTotal.textContent = text;
    if (dom.miniTimeTotal) dom.miniTimeTotal.textContent = text;
  }

  // ─── 進度條：拖曳跳轉（跟手 + 即時推播給 OBS/遙控，暫停時也即時更新）───
  // 主播放器與迷你播放器兩條進度條共用同一套邏輯：更新時兩條一起動、拖曳時任一條都能 seek。
  function seekRatioFromEvent(e, trackEl) {
    const rect = (trackEl || dom.progressTrack).getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }
  function previewSeekUI(ratio) {
    setProgressFill(ratio * 100);
    const dur = stActive() ? SoundTouchEngine.getDuration() : audioPlayer.duration;
    if (dur) setCurrentTime(formatTime(ratio * dur));
  }
  let lastSeekBroadcast = 0;
  function applySeek(ratio, finalize) {
    const dur = stActive() ? SoundTouchEngine.getDuration() : audioPlayer.duration;
    if (!dur) return;
    const t = ratio * dur;
    if (stActive()) SoundTouchEngine.seek(t); else audioPlayer.currentTime = t;
    const now = Date.now();
    if (finalize || now - lastSeekBroadcast >= 60) {
      lastSeekBroadcast = now;
      SocketClient.send('play:seek', t);
      // 同步推播位置：讓 OBS 顯示端即時跟著移動（暫停時也是）
      SocketClient.send('lyrics:sync', { currentTime: t, duration: dur || 0 });
    }
  }
  // 把一條 track 綁上拖曳跳轉（主/迷你共用；isSeeking 是共享旗標，同時只會有一條在拖）
  function bindSeekTrack(trackEl) {
    if (!trackEl) return;
    trackEl.addEventListener('pointerdown', (e) => {
      if (!(stActive() ? SoundTouchEngine.getDuration() : audioPlayer.duration)) return;
      isSeeking = true;
      try { trackEl.setPointerCapture(e.pointerId); } catch (_) { /* 靜默 */ }
      const r = seekRatioFromEvent(e, trackEl);
      previewSeekUI(r); applySeek(r, false);
    });
    trackEl.addEventListener('pointermove', (e) => {
      if (!isSeeking) return;
      const r = seekRatioFromEvent(e, trackEl);
      previewSeekUI(r); applySeek(r, false);
    });
    const endSeek = (e) => {
      if (!isSeeking) return;
      isSeeking = false;
      try { trackEl.releasePointerCapture(e.pointerId); } catch (_) { /* 靜默 */ }
      const r = seekRatioFromEvent(e, trackEl);
      previewSeekUI(r); applySeek(r, true);
    };
    trackEl.addEventListener('pointerup', endSeek);
    trackEl.addEventListener('pointercancel', endSeek);
  }
  bindSeekTrack(dom.progressTrack);
  bindSeekTrack(dom.miniProgressTrack);

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
    dom.offsetPlus05.addEventListener('click', () => {
      adjustOffset(500);
    });
  }

  if (dom.offsetMinus05) {
    dom.offsetMinus05.addEventListener('click', () => {
      adjustOffset(-500);
    });
  }

  if (dom.offsetPlus01) {
    dom.offsetPlus01.addEventListener('click', () => {
      adjustOffset(100);
    });
  }

  if (dom.offsetMinus01) {
    dom.offsetMinus01.addEventListener('click', () => {
      adjustOffset(-100);
    });
  }

  if (dom.offsetReset) {
    dom.offsetReset.addEventListener('click', () => {
      const trackId = state.playlist[state.currentTrackIndex] ? state.playlist[state.currentTrackIndex].id : null;
      if (!trackId) return;
      currentOffsetMs = 0;
      updateOffsetDisplay();
      SocketClient.send('offset:reset', trackId);
    });
  }

  function adjustOffset(deltaMs) {
    const trackId = state.playlist[state.currentTrackIndex] ? state.playlist[state.currentTrackIndex].id : null;
    if (!trackId) return;
    currentOffsetMs += deltaMs;
    updateOffsetDisplay();
    SocketClient.send('offset:adjust', { trackId, delta: deltaMs });
  }

  // 取「第一句歌詞」的原始時間戳（ms）：優先用已解析的 parsedLyrics，退而解析原始 LRC 第一個時間標籤
  function firstLineTimeMs() {
    const tr = state.playlist[state.currentTrackIndex];
    if (!tr) return null;
    if (Array.isArray(tr.parsedLyrics) && tr.parsedLyrics.length) {
      const l = tr.parsedLyrics.find((x) => x && typeof x.time === 'number');
      if (l) return l.time;
    }
    if (typeof tr.lyrics === 'string') {
      const m = tr.lyrics.match(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/);
      if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000 + (m[3] ? Number((m[3] + '00').slice(0, 3)) : 0);
    }
    return null;
  }

  // 對齊第一句：在「第一句該唱的瞬間」按下 → 設定 offset 讓第一句此刻出現。
  // 顯示端判斷式 adjustedTime = audioTime + offset，第一句在 audioTime = tFirst − offset 出現，
  // 要它在「現在」出現 → offset = tFirst − tNow。
  function alignFirstLine() {
    const trackId = state.playlist[state.currentTrackIndex] ? state.playlist[state.currentTrackIndex].id : null;
    if (!trackId) { AppShared.showToast('沒有正在播放的歌曲'); return; }
    if (!isPlaying) { AppShared.showToast('請先播放，到第一句該唱的瞬間再按', 'error'); return; }
    const tFirst = firstLineTimeMs();
    if (tFirst == null) { AppShared.showToast('這首歌詞沒有時間軸，無法對齊', 'error'); return; }
    const desired = Math.round(tFirst - lastPlayTimeMs);
    const delta = desired - currentOffsetMs;
    currentOffsetMs = desired;
    updateOffsetDisplay();
    SocketClient.send('offset:adjust', { trackId, delta });
    AppShared.showToast(`已對齊第一句（偏移 ${desired >= 0 ? '+' : ''}${(desired / 1000).toFixed(1)}s）`);
  }
  if (dom.offsetAlign) dom.offsetAlign.addEventListener('click', alignFirstLine);

  // ═══════════════════════════════════════════
  // Phase 7: 變調控制
  // ═══════════════════════════════════════════

  if (dom.pitchSlider) {
    const debouncedPitch = typeof ErrorHandler !== 'undefined'
      ? ErrorHandler.debounce((value) => {
          SocketClient.send('pitch:change', value);
        }, 50)
      : null;

    dom.pitchSlider.addEventListener('input', () => {
      currentPitchShift = parseInt(dom.pitchSlider.value, 10);
      if (dom.pitchValue) {
        const sign = currentPitchShift >= 0 ? '+' : '';
        dom.pitchValue.textContent = sign + currentPitchShift;
      }
      applyPitchAndSpeed();
      if (debouncedPitch) {
        debouncedPitch(currentPitchShift);
      } else {
        SocketClient.send('pitch:change', currentPitchShift);
      }
    });
  }

  if (dom.pitchReset) {
    dom.pitchReset.addEventListener('click', () => {
      currentPitchShift = 0;
      if (dom.pitchSlider) dom.pitchSlider.value = 0;
      if (dom.pitchValue) dom.pitchValue.textContent = '0';
      applyPitchAndSpeed();
      SocketClient.send('pitch:change', 0);
      AppShared.showToast('變調已重置', 'info');
    });
  }

  // ═══════════════════════════════════════════
  // Phase 7: 變速控制
  // ═══════════════════════════════════════════

  if (dom.speedSlider) {
    const debouncedSpeed = typeof ErrorHandler !== 'undefined'
      ? ErrorHandler.debounce((value) => {
          SocketClient.send('speed:change', value);
        }, 50)
      : null;

    dom.speedSlider.addEventListener('input', () => {
      currentPlaybackRate = parseFloat(dom.speedSlider.value);
      if (dom.speedValue) {
        dom.speedValue.textContent = currentPlaybackRate.toFixed(2) + 'x';
      }
      applyPitchAndSpeed();
      if (debouncedSpeed) {
        debouncedSpeed(currentPlaybackRate);
      } else {
        SocketClient.send('speed:change', currentPlaybackRate);
      }
    });
  }

  if (dom.speedReset) {
    dom.speedReset.addEventListener('click', () => {
      currentPlaybackRate = 1.0;
      if (dom.speedSlider) dom.speedSlider.value = 1;
      if (dom.speedValue) dom.speedValue.textContent = '1.00x';
      applyPitchAndSpeed();
      SocketClient.send('speed:change', 1.0);
      AppShared.showToast('變速已重置', 'info');
    });
  }

  // ═══════════════════════════════════════════
  // 變調/變速 上下按鈕（stepper）
  // 調整隱藏 slider 的值並觸發其 input 事件，
  // 重用既有的 send/apply 邏輯，行為完全一致
  // ═══════════════════════════════════════════

  function stepControl(slider, delta) {
    if (!slider) return;
    const step = parseFloat(slider.step) || 1;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    let v = parseFloat(slider.value) + delta * step;
    // 修正浮點誤差（變速 0.05 步進）
    v = Math.round(v / step) * step;
    v = Math.max(min, Math.min(max, v));
    slider.value = v;
    slider.dispatchEvent(new Event('input'));
  }

  if (dom.pitchUp) dom.pitchUp.addEventListener('click', () => stepControl(dom.pitchSlider, +1));
  if (dom.pitchDown) dom.pitchDown.addEventListener('click', () => stepControl(dom.pitchSlider, -1));
  if (dom.speedUp) dom.speedUp.addEventListener('click', () => stepControl(dom.speedSlider, +1));
  if (dom.speedDown) dom.speedDown.addEventListener('click', () => stepControl(dom.speedSlider, -1));

  // ═══════════════════════════════════════════
  // 音量控制（透過 AudioProcessor 的 GainNode；
  // 走 Web Audio 後 audio.volume 失效，必須用 GainNode）
  // ═══════════════════════════════════════════

  if (dom.volumeSlider) {
    // 初始化：讀取 AudioProcessor 記住的音量（預設 70%）
    let initVol = 0.7;
    if (typeof AudioProcessor !== 'undefined' && AudioProcessor.getVolume) {
      initVol = AudioProcessor.getVolume();
    }
    dom.volumeSlider.value = Math.round(initVol * 100);
    if (dom.volumeVal) dom.volumeVal.textContent = Math.round(initVol * 100) + '%';
    // 套用初始音量到 audio 元素（AudioProcessor 尚未初始化前的後備）
    audioPlayer.volume = initVol;

    dom.volumeSlider.addEventListener('input', () => {
      const vol = parseInt(dom.volumeSlider.value, 10) / 100;
      if (dom.volumeVal) dom.volumeVal.textContent = dom.volumeSlider.value + '%';
      // AudioProcessor 已初始化 → 用 GainNode；否則退回 audio.volume
      if (audioProcessorReady && typeof AudioProcessor !== 'undefined') {
        AudioProcessor.setVolume(vol);
      } else {
        audioPlayer.volume = vol;
      }
      // 高品質變調的獨立輸出鏈也要跟著調音量
      if (stGain) { try { stGain.gain.value = vol; } catch (e) { /* 靜默 */ } }
    });
  }

  // 連續播放開關（player 模式）
  const continuousToggle = document.getElementById('continuous-toggle');
  if (continuousToggle) {
    continuousToggle.checked = continuousPlay;
    continuousToggle.addEventListener('change', () => {
      continuousPlay = continuousToggle.checked;
      try { localStorage.setItem('vk-continuous', continuousPlay ? '1' : '0'); } catch (e) { /* 靜默 */ }
      AppShared.showToast(continuousPlay ? '已開啟連續播放' : '已切換為單曲（播完即停）');
    });
  }

  if (dom.metronomeToggle) {
    dom.metronomeToggle.addEventListener('change', () => {
      const enabled = dom.metronomeToggle.checked;
      SocketClient.send('metronome:toggle', enabled);
    });
  }

  // Phase 7: 接收遠端 pitch/speed 變更
  SocketClient.on('pitch:update', (semitones) => {
    if (typeof semitones !== 'number') return;
    currentPitchShift = semitones;
    if (dom.pitchSlider) dom.pitchSlider.value = semitones;
    if (dom.pitchValue) {
      const sign = semitones >= 0 ? '+' : '';
      dom.pitchValue.textContent = sign + semitones;
    }
    applyPitchAndSpeed();
  });

  SocketClient.on('speed:update', (rate) => {
    if (typeof rate !== 'number') return;
    currentPlaybackRate = rate;
    if (dom.speedSlider) dom.speedSlider.value = rate;
    if (dom.speedValue) dom.speedValue.textContent = rate.toFixed(2) + 'x';
    applyPitchAndSpeed();
  });

  SocketClient.on('metronome:update', (enabled) => {
    if (dom.metronomeToggle) {
      dom.metronomeToggle.checked = !!enabled;
    }
  });

  // 供其他模組（app.js 的 state:sync 等跨模組 dispatch）呼叫
  AppShared.playTrack = playTrack;
  AppShared.stopPlayback = stopPlayback;
  AppShared.updatePlayButton = updatePlayButton;
  AppShared.updateMiniPlayerInfo = updateMiniPlayerInfo;
  AppShared.updateOffsetDisplay = updateOffsetDisplay;
  AppShared.applyPitchAndSpeed = applyPitchAndSpeed;
})();
