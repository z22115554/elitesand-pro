/**
 * Elitesand Pro OBS 顯示頁面控制器 v4 (Phase 7)
 * 透明背景 + 歌詞動畫，供 OBS 瀏覽器來源使用
 * 
 * Phase 7 增強：
 * - 變調與變速：Tone.js PitchShift + playbackRate
 * - 前奏倒數視覺節拍器（脈動圓點）
 * - 極細進度條（2px，OBS 專屬）
 * - 歌詞同步補償（playbackRate 感知）
 * - 狀態恢復含 pitch/speed 參數
 */
(function () {
  'use strict';

  // ─── 初始化 ───
  // 面板內嵌的預覽 iframe（?preview=1）註冊成 display-preview：伺服器餵一樣的資料，
  // 但不計入「OBS 已連線」數——否則面板一開就自帶 3 個假 display，連線燈永遠亮。
  const displayQuery = new URLSearchParams(location.search);
  const isPreviewClient = displayQuery.get('preview') === '1';
  // The Spout output window deliberately loads this same /display runtime.
  // It only receives a separate read-only socket identity; no rendering or
  // lyric-state logic is duplicated for the native output path.
  const isSpoutOutput = displayQuery.get('output') === 'spout';
  SocketClient.init(isPreviewClient ? 'display-preview' : (isSpoutOutput ? 'display-spout' : 'display'));

  // /display 由 server 注入整組本機 JS/CSS 的內容指紋。正式 OBS 來源回報它，讓面板可以
  // 直接告知「已連線但仍跑舊快取」；預覽 iframe 不納入正式 OBS 狀態，刻意不回報。
  const displayRuntimeBuild = document.documentElement.dataset.elitesandDisplayBuild || '';
  SocketClient.on('connection-change', (connected) => {
    if (connected && !isPreviewClient && displayRuntimeBuild) {
      SocketClient.send('client:build', { displayBuild: displayRuntimeBuild });
    }
  });

  // 初始化錯誤處理系統
  if (typeof ErrorHandler !== 'undefined') {
    ErrorHandler.init();
  }

  KaraokeEngine.init({
    container: document.getElementById('lyrics-container'),
    history: document.getElementById('lyrics-history'),
    active: document.getElementById('lyrics-active'),
    maxHistoryLines: 4,
  });

  const lyricsContainer = document.getElementById('lyrics-container');
  const metronomeEl = document.getElementById('intro-metronome');
  const metronomeDot = document.getElementById('metronome-dot');
  const metronomeCountdown = document.getElementById('metronome-countdown');
  const obsProgressFill = document.getElementById('obs-progress-fill');
  const obsProgressBar = document.getElementById('obs-progress-bar');
  // OBS 顯示端是「純視覺」來源：這裡完全沒有音訊元素，時間軸純粹靠面板的
  // lyrics:sync 驅動。音訊一律由控制面板輸出（面板有使用者互動才能啟動 Web Audio
  // 做變調）；顯示端若也出聲會與面板形成雙重聲音，且無法變調 → 一個原調一個變調。
  //
  // ⚠️ 想讓顯示端重新出聲的話，另外還有兩層擋著，都要一起處理否則會靜默失效：
  //   1. app-state.js 的 READ_ONLY_TRACK_FIELDS 已把 filename／url 從送給疊加層的
  //      payload 移除，所以 track.filename 永遠是 undefined。
  //   2. socket-handler.js 的唯讀 middleware 只放行 READ_ONLY_EVENTS，
  //      顯示端送的 audio:error／audio:skip 會被伺服器拒絕並記 warn。
  // （2026-09 死碼清理：原本被 USE_LOCAL_AUDIO=false 永久關閉的 audioPlayer、
  //   AudioProcessor 與音訊錯誤處理整批移除；歌詞時鐘與變速補償完全不受影響。）
  // 預覽模式（控制面板內嵌 /display?preview=1）：忽略緊急隱藏，讓主播在面板始終看得到歌詞，
  // 即使 OBS 已被緊急隱藏（避免發現歌詞錯誤、按下緊急隱藏後自己也看不到）。
  const isPreview = new URLSearchParams(location.search).get('preview') === '1';
  if (isPreview) document.body.classList.add('preview-mode');

  const t = (key, vars) => (window.I18n && typeof window.I18n.t === 'function') ? window.I18n.t(key, vars) : key;
  const SAMPLE_LINE1_WORDS_HANT = [
    { text: '這', start: 0, duration: 260 }, { text: '是', start: 340, duration: 430 },
    { text: '一', start: 830, duration: 180 }, { text: '句', start: 1060, duration: 610 },
    { text: '示', start: 1740, duration: 220 }, { text: '範', start: 2030, duration: 430 },
    { text: '用', start: 2520, duration: 180 }, { text: '的', start: 2770, duration: 340 },
    { text: '歌詞 ', start: 3180, duration: 360 }, { text: 'This ', start: 3570, duration: 220 },
    { text: 'is ', start: 3810, duration: 150 }, { text: 'an ', start: 3970, duration: 120 },
    { text: 'example ', start: 4100, duration: 80 }, { text: 'lyric.', start: 4190, duration: 10 },
  ];
  const SAMPLE_LINE1_WORDS_HANS = SAMPLE_LINE1_WORDS_HANT.map((word) => ({
    ...word,
    text: word.text.replace(/這/g, '这').replace(/範/g, '范').replace(/歌詞/g, '歌词'),
  }));

  function previewSampleLines() {
    const locale = (window.I18n && typeof window.I18n.current === 'function') ? window.I18n.current() : 'zh-TW';
    const isZh = locale === 'zh-TW' || locale === 'zh-CN';
    return [
      // Deliberately uneven word timings make the Mirror preview prove that
      // its sung-glyph pulse follows source time, rather than a fixed rhythm.
      {
        time: 0,
        text: t('preview.sampleLine1'),
        phonetic: isZh ? 'zhè shì yī jù shì fàn yòng de gē cí' : '',
        xieyin: '',
        words: locale === 'zh-CN' ? SAMPLE_LINE1_WORDS_HANS : (locale === 'zh-TW' ? SAMPLE_LINE1_WORDS_HANT : []),
      },
      {
        time: 4200,
        text: t('preview.sampleLine2'),
        phonetic: isZh ? 'zì tǐ xiào guǒ cè shì' : '',
        xieyin: '',
        words: [],
      },
    ];
  }

  // 預覽範例：只在控制台按「示範歌詞」時載入，避免一開程式就卡一行假歌詞。
  // 這走真正的 lyrics pipeline，讓經典疊層與自訂模板（KTV/Pulse/Aura...）都能測字體效果。
  function renderPreviewSample() {
    if (!isPreview) return;
    if (!document.body.className.match(/style-/)) document.body.classList.add('style-cute');
    const sampleLines = previewSampleLines();
    previewSampleActive = true;
    KaraokeEngine.loadLyrics('', 'lrc', sampleLines);
    // Mirror is the only template whose core promise is a line-entry motion.
    // Let its sample replay that entry, then park on a settled frame
    // so the normal settings preview remains useful for typography checks.
    const replayMirrorEntry = Boolean(document.getElementById('mirror-root'));
    syncTimeMs = replayMirrorEntry ? 0 : 1800;
    lastSyncTimestamp = performance.now();
    isControllerPlaying = replayMirrorEntry;
    KaraokeEngine.update(syncTimeMs);
    if (previewMotionTimer) window.clearTimeout(previewMotionTimer);
    if (replayMirrorEntry) {
      previewMotionTimer = window.setTimeout(() => {
        if (!previewSampleActive) return;
        // Let the intentionally distant second sample line become visible.
        // This proves the temporal batch split in the normal settings preview
        // instead of parking before the next group can replace the first one.
        syncTimeMs = 5100;
        lastSyncTimestamp = performance.now();
        isControllerPlaying = false;
        KaraokeEngine.update(syncTimeMs);
      }, 5100);
    }
  }

  // ─── 同步時間追蹤 ───
  let syncTimeMs = 0;
  let lastSyncTimestamp = 0;
  let isControllerPlaying = false;
  let currentTrackData = null;
  let currentOffsetMs = 0; // Phase 5: 當前歌曲的時間偏移
  let previewSampleActive = false;
  let previewMotionTimer = null;
  window.addEventListener('i18n:change', () => {
    if (previewSampleActive) renderPreviewSample();
  });

  // Phase 7: 變速狀態。顯示端沒有音訊，但 currentPlaybackRate 仍必須維護——
  // getCurrentTimeMs() 用它把「面板同步過來的時間」外推成歌詞時鐘，變速時歌詞
  // 才會跟著變快/變慢。變調（pitch）在純視覺端沒有任何效果，已於 2026-09 移除。
  let currentPlaybackRate = 1.0; // 播放速率，0.5 ~ 1.5
  let metronomeEnabled = true;   // 前奏倒數提示開關
  let audioDuration = 0;         // 當前歌曲總時長（秒），由面板 lyrics:sync 的 duration 驅動

  /**
   * Phase 7: 取得當前播放時間（毫秒）
   * 關鍵：考慮 playbackRate，當速率不為 1.0 時，時間推進速率也會改變
   */
  function getCurrentTimeMs() {
    if (!isControllerPlaying) return syncTimeMs;
    const elapsedReal = performance.now() - lastSyncTimestamp;
    // elapsedReal 是真實經過時間，乘以 playbackRate 得到音樂時間
    const elapsedMusic = elapsedReal * currentPlaybackRate;
    return syncTimeMs + elapsedMusic;
  }

  /**
   * 平滑顯示時鐘：直接吃時間值的模板（KTV 掃色、Aura 平滑）對時間顆粒極敏感。
   * 面板每 200ms 才同步一次，每次同步 syncTimeMs 硬重設會帶進網路抖動（±幾十 ms 的前後跳）。
   * 這裡維護一個「自走＋軟校正」的時鐘：每幀用 performance.now 自行推進，
   * 再以 6%/幀 的速度貼向同步目標；偏差超過 300ms（seek/切歌）直接跳過去。
   * 只給 animationLoop 用（每幀恰好呼叫一次，dt 計算才正確）。
   */
  let smoothClockMs = 0;
  let smoothClockWall = 0;
  function getSmoothTimeMs() {
    const target = getCurrentTimeMs();
    const now = performance.now();
    if (!isControllerPlaying || smoothClockWall === 0) {
      smoothClockMs = target;
      smoothClockWall = now;
      return target;
    }
    const dt = Math.min(now - smoothClockWall, 100);
    smoothClockWall = now;
    smoothClockMs += dt * currentPlaybackRate;
    const diff = target - smoothClockMs;
    if (Math.abs(diff) > 300) smoothClockMs = target;
    else smoothClockMs += diff * 0.06;
    return smoothClockMs;
  }

  // ─── 動畫更新迴圈 ───
  let animFrameId = null;

  function animationLoop() {
    try {
      lastRafWall = performance.now(); // 給 lyrics:sync 判斷 rAF 是否被 OBS 節流
      // 暫停／閒置時畫面不會變，不必讓每個 OBS 預覽每秒重算 60 次歌詞與樣式。
      // seek、設定與 state 事件都有自己的立即重繪路徑；重新播放後下一幀自然恢復。
      if (isControllerPlaying) {
        const timeMs = getSmoothTimeMs();
        // 拖曳/連續跳轉期間，重繪交給節流的同步事件處理，rAF 這幾幀不重複 render（避免雙重工作）
        if (!seekDriving) KaraokeEngine.update(timeMs);

        // Phase 7: 更新前奏倒數視覺節拍器
        updateIntroMetronome(timeMs);

        // Phase 7: 更新極細進度條
        updateProgressBar(timeMs);
      }
    } catch (e) {
      // 防止單一幀錯誤中斷整個迴圈
      console.warn('[Display] 動畫迴圈錯誤:', e.message);
    }
    animFrameId = requestAnimationFrame(animationLoop);
  }

  // ═══════════════════════════════════════════
  // Phase 7: 前奏倒數視覺節拍器
  // ═══════════════════════════════════════════

  let metronomeVisible = false;

  function updateIntroMetronome(timeMs) {
    if (!metronomeEnabled || !currentTrackData) {
      hideMetronome();
      return;
    }

    const firstLineTime = KaraokeEngine.getFirstLineTime();
    if (firstLineTime < 0) {
      hideMetronome();
      return;
    }

    // 計算距離第一句歌詞的剩餘時間（毫秒）
    const timeToFirstLine = firstLineTime - timeMs;

    // 5 秒內顯示倒數
    if (timeToFirstLine > 0 && timeToFirstLine <= 5000) {
      showMetronome(timeToFirstLine);
    } else if (timeToFirstLine <= 0 && timeToFirstLine > -500) {
      // 第一句歌詞剛出現的瞬間（500ms 內），平滑消失
      if (metronomeVisible) {
        fadeOutMetronome();
      }
    } else {
      hideMetronome();
    }
  }

  function showMetronome(timeToFirstLineMs) {
    if (!metronomeEl) return;

    const remainingSec = Math.ceil(timeToFirstLineMs / 1000);

    // 更新倒數文字
    if (metronomeCountdown) {
      metronomeCountdown.textContent = remainingSec > 0 ? remainingSec.toString() : '';
    }

    // 根據剩餘時間調整脈動速度
    metronomeEl.classList.remove('pulse-slow', 'pulse-medium', 'pulse-fast');
    if (timeToFirstLineMs <= 1500) {
      metronomeEl.classList.add('pulse-fast');
    } else if (timeToFirstLineMs <= 3000) {
      metronomeEl.classList.add('pulse-medium');
    } else {
      metronomeEl.classList.add('pulse-slow');
    }

    if (!metronomeVisible) {
      metronomeEl.classList.remove('metronome-hidden');
      metronomeEl.classList.add('metronome-visible');
      metronomeVisible = true;
    }
  }

  function fadeOutMetronome() {
    if (!metronomeEl) return;

    // 使用 GSAP 平滑消失
    if (typeof gsap !== 'undefined') {
      gsap.to(metronomeEl, {
        opacity: 0,
        duration: 0.4,
        ease: 'power2.out',
        onComplete: () => {
          metronomeEl.classList.remove('metronome-visible');
          metronomeEl.classList.add('metronome-hidden');
          metronomeEl.style.opacity = '';
          metronomeVisible = false;
        },
      });
    } else {
      hideMetronome();
    }
  }

  function hideMetronome() {
    if (!metronomeEl || !metronomeVisible) return;
    metronomeEl.classList.remove('metronome-visible', 'pulse-fast', 'pulse-medium', 'pulse-slow');
    metronomeEl.classList.add('metronome-hidden');
    metronomeVisible = false;
  }

  // ═══════════════════════════════════════════
  // Phase 7: 極細進度條更新
  // ═══════════════════════════════════════════

  function updateProgressBar(timeMs) {
    if (!obsProgressFill) return;

    // 優先使用音訊的 duration，否則使用歌詞結束時間估算
    let totalMs = audioDuration * 1000;
    if (!totalMs || totalMs <= 0) {
      totalMs = KaraokeEngine.getLyricsEndTime();
    }

    if (totalMs <= 0) {
      obsProgressFill.style.width = '0%';
      return;
    }

    const progress = Math.min(100, Math.max(0, (timeMs / totalMs) * 100));
    obsProgressFill.style.width = progress + '%';
  }

  // ─── Socket 事件處理 ───

  // 播放歌曲
  SocketClient.on('play:track', (track) => {
    console.log('[Display] 收到播放指令:', track.title);
    currentTrackData = track;
    syncTrackMetaDataset(currentTrackData);
    audioDuration = 0;

    // Phase 5: 套用 offset
    if (typeof track.offset === 'number') {
      currentOffsetMs = track.offset;
      KaraokeEngine.setOffset(currentOffsetMs);
      console.log(`[Display] 套用時間偏移: ${currentOffsetMs}ms`);
    } else {
      currentOffsetMs = 0;
      KaraokeEngine.setOffset(0);
    }

    if (track.lyrics) {
      previewSampleActive = false;
      KaraokeEngine.loadLyrics(track.lyrics, track.lyricsType || 'lrc', track.parsedLyrics);
    } else {
      previewSampleActive = false;
      KaraokeEngine.clearDisplay();
    }

    // 尊重 autoplay：載入待命（autoplay=false）時不要讓歌詞自走，等使用者按播放
    isControllerPlaying = track.autoplay !== false;
    syncTimeMs = 0;
    lastSyncTimestamp = performance.now();

    // Phase 7: 重置節拍器狀態
    hideMetronome();
  });

  // 播放/暫停
  SocketClient.on('play:toggle', ({ playing } = {}) => {
    isControllerPlaying = playing;
    if (playing) lastSyncTimestamp = performance.now();
  });

  // 播放清單播完最後一首、沒有下一首可接：清空歌詞，不能讓最後一句永遠卡在畫面上。
  SocketClient.on('play:stop', () => {
    isControllerPlaying = false;
    // hard：整首播完，連歌詞來源一起清掉並停時鐘，殘留的一幀 onFrame 也不會把最後一句畫回來
    KaraokeEngine.clearDisplay({ hard: true });
    hideMetronome();
  });

  // 跳轉
  SocketClient.on('play:seek', (time) => {
    if (typeof time !== 'number' || !isFinite(time)) return;
    syncTimeMs = Math.max(0, time) * 1000;
    lastSyncTimestamp = performance.now();
    KaraokeEngine.update(syncTimeMs); // 立即重繪到新位置（含暫停時）
    hideMetronome();
  });

  // 歌詞時間同步
  let seekExitTimer = null;
  let seekDriving = false;
  let lastRafWall = 0; // animationLoop 每幀更新；用於偵測 OBS 節流 rAF
  let seekDriveTimer = null;
  // 節流重繪：rapid 同步時最多每 ~70ms render 一次（含尾呼叫），避免渲染被淹沒卡死
  let lastRenderWall = 0;
  let pendingRender = null;
  function throttledRender() {
    const now = performance.now();
    if (now - lastRenderWall >= 70) {
      lastRenderWall = now;
      KaraokeEngine.update(syncTimeMs);
    } else if (!pendingRender) {
      pendingRender = setTimeout(() => {
        pendingRender = null;
        lastRenderWall = performance.now();
        KaraokeEngine.update(syncTimeMs);
      }, 70 - (now - lastRenderWall));
    }
  }
  SocketClient.on('lyrics:sync', (data) => {
    if (data && typeof data.currentTime === 'number') {
      const now = performance.now();
      // 分流關鍵（v5.2 修卡頓真因）：
      // 面板正常播放時每 200ms 就會發一次 lyrics:sync。過去這裡「每一次」同步都設
      // seekDriving 200ms → 播放期間旗標幾乎恆為 true → rAF 的 60fps 內插迴圈整個被跳過，
      // 畫面實際由 70ms 節流＋未內插的原始同步值驅動＝時間每 200ms 跳一格。
      // GSAP 系模板靠自己的 timeline 時鐘看不出來；直接吃時間值的模板（KTV 掃色、
      // Aura 平滑、先前的海報捲軸彈簧）就整個階梯狀——這才是「卡」的真因。
      // 只有面板明確標記的拖曳才走快速路徑；常規播放同步只更新時鐘基準，
      // 渲染完全交給 rAF 內插（60fps 平滑）。
      // 不要用封包間隔猜測拖曳：正常同步被誤判為 seek 時，rAF 會被停掉，
      // KTV 的掃色就退化成離散更新。面板拖曳時明確帶 seeking。
      const isScrubbing = data.seeking === true;
      syncTimeMs = data.currentTime * 1000;
      lastSyncTimestamp = now;
      // 純視覺顯示端沒有本地音訊 → 用面板同步來的 duration 驅動 OBS 進度條
      if (typeof data.duration === 'number' && data.duration > 0) audioDuration = data.duration;

      if (isScrubbing) {
        // 明確 seek 立刻同步平滑時鐘，避免小幅跳轉被 6% 校正拖慢。
        smoothClockMs = syncTimeMs;
        smoothClockWall = now;
        // 拖曳/連續跳轉：跳過粒子/入場動畫避免卡死；停止拖曳 280ms 後退出並完整重繪
        if (KaraokeEngine.setFastMode) {
          KaraokeEngine.setFastMode(true);
          clearTimeout(seekExitTimer);
          seekExitTimer = setTimeout(() => {
            KaraokeEngine.setFastMode(false);
            KaraokeEngine.update(syncTimeMs);
          }, 280);
        }
        seekDriving = true; // 由同步事件驅動這幾幀，rAF 不重複 render
        clearTimeout(seekDriveTimer);
        seekDriveTimer = setTimeout(() => { seekDriving = false; }, 200);
        // 直接（節流）重繪：OBS 非作用場景會節流 rAF，拖曳時不能只靠 rAF
        throttledRender();
      } else {
        // 拖曳結束後立即還給 rAF，不能留下上一個 seek 的暫停尾巴。
        if (seekDriving) {
          seekDriving = false;
          clearTimeout(seekDriveTimer);
          if (KaraokeEngine.setFastMode) KaraokeEngine.setFastMode(false);
        }
        if (performance.now() - lastRafWall > 400) {
        // 安全網：OBS 非作用中場景會節流/凍結 rAF——此時常規同步順手補一幀，
        // 切回場景瞬間畫面才不會從很舊的位置跳過來
          KaraokeEngine.update(getCurrentTimeMs());
        }
      }
    }
  });

  // 風格切換（防呆：空值不套用，避免刷「未知風格」警告）
  SocketClient.on('style:change', (style) => {
    if (typeof style === 'string' && style) StylePresets.setStyle(style);
  });

  // 動畫風格微調（覆蓋當前 preset 的動畫參數）
  SocketClient.on('style:override', (overrides) => {
    StylePresets.setOverrides(overrides || {});
  });

  // ─── 位置微調自動夾限（v5.2）───
  // 使用者滑桿調的是「意圖位移」；實際寫進 --lyric-offset-x/y 的是收緊後的值。
  // 每次內容改變（換行、切換模板、字級變動）容器的實際邊界都可能不同，靠 ResizeObserver
  // 監看 #lyrics-container 的版面框大小變化，一有變動就用同一個「意圖位移」重新收緊一次，
  // 使用者永遠調不出畫面外，也不需要每個模板各自處理。
  let lyricOffsetTargetX = 0;
  let lyricOffsetTargetY = 0;
  let lyricOffsetAppliedX = 0;
  let lyricOffsetAppliedY = 0;
  const LYRIC_OFFSET_EDGE_PAD = 12; // 留給邊界的最小可視安全距離（px）
  let lyricOffsetResizeObserver = null;

  function reclampLyricOffset() {
    const container = document.getElementById('lyrics-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // 尚未 layout，之後 resize 會再觸發
    // 減掉「目前已套用的位移」還原出容器在零位移時的自然邊界，才能算出這次能再位移多少
    const baseLeft = rect.left - lyricOffsetAppliedX;
    const baseRight = rect.right - lyricOffsetAppliedX;
    const baseTop = rect.top - lyricOffsetAppliedY;
    const baseBottom = rect.bottom - lyricOffsetAppliedY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = LYRIC_OFFSET_EDGE_PAD;

    let minX = pad - baseLeft;
    let maxX = vw - pad - baseRight;
    if (minX > maxX) { const mid = (minX + maxX) / 2; minX = mid; maxX = mid; } // 內容比畫面寬，兩難時取中間值
    let minY = pad - baseTop;
    let maxY = vh - pad - baseBottom;
    if (minY > maxY) { const mid = (minY + maxY) / 2; minY = mid; maxY = mid; }

    const effX = Math.min(Math.max(lyricOffsetTargetX, minX), maxX);
    const effY = Math.min(Math.max(lyricOffsetTargetY, minY), maxY);

    if (effX !== lyricOffsetAppliedX) {
      lyricOffsetAppliedX = effX;
      document.documentElement.style.setProperty('--lyric-offset-x', `${effX}px`);
    }
    if (effY !== lyricOffsetAppliedY) {
      lyricOffsetAppliedY = effY;
      document.documentElement.style.setProperty('--lyric-offset-y', `${effY}px`);
    }
  }

  function ensureLyricOffsetObserver() {
    if (lyricOffsetResizeObserver || typeof ResizeObserver === 'undefined') return;
    const container = document.getElementById('lyrics-container');
    if (!container) return;
    lyricOffsetResizeObserver = new ResizeObserver(() => reclampLyricOffset());
    lyricOffsetResizeObserver.observe(container);
    window.addEventListener('resize', reclampLyricOffset);
  }

  let fontAssetApplyVersion = 0;
  let appliedFontAssets = null;

  function quoteLocalFontFamily(family) {
    return `'${String(family).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  // 用 FontFace 直接載入掃描器驗證過的本機字型檔。這是 Windows 使用者字型在 Chromium/CEF
  // 沒有註冊成 CSS family 時的可靠路徑；失敗則保留原本的 CSS fallback，不讓 OBS 出現空字。
  async function applyLocalFontAssets(settings, fallbackStack) {
    const version = ++fontAssetApplyVersion;
    const loader = window.ElitesandFontAssets;
    const mainId = settings.fontAssetId;
    const latinId = settings.fontFamilyLatinAssetId;
    const canLoad = loader && typeof loader.isAssetId === 'function' && typeof loader.load === 'function';
    const key = JSON.stringify([mainId, latinId, settings.fontFamily, settings.fontFamilyLatin]);
    if (appliedFontAssets?.key === key) {
      document.documentElement.style.setProperty('--display-font-family', appliedFontAssets.stack);
      return { version, mainLoaded: appliedFontAssets.mainLoaded };
    }
    if (!canLoad || (!loader.isAssetId(mainId) && !loader.isAssetId(latinId))) {
      appliedFontAssets = null;
      return { version, mainLoaded: false };
    }
    try {
      const results = await Promise.allSettled([
        loader.isAssetId(mainId) ? loader.load(mainId) : null,
        loader.isAssetId(latinId) ? loader.load(latinId) : null,
      ]);
      if (version !== fontAssetApplyVersion) return;
      // A failed Latin face must not discard a successfully loaded CJK face (or vice versa).
      const [main, latin] = results.map(result => result.status === 'fulfilled' ? result.value : null);
      results.filter(result => result.status === 'rejected').forEach(result =>
        console.warn('[Elitesand] 本機字型載入失敗，改用 CSS 字型堆疊：', result.reason?.message || result.reason));
      const mainStack = main ? `${quoteLocalFontFamily(main.family)}, ${settings.fontFamily || fallbackStack}` : (settings.fontFamily || fallbackStack);
      const finalStack = latin
        ? `${quoteLocalFontFamily(latin.family)}, ${mainStack}`
        : (settings.fontFamilyLatin ? `${quoteLocalFontFamily(settings.fontFamilyLatin)}, ${mainStack}` : mainStack);
      document.documentElement.style.setProperty('--display-font-family', finalStack);
      // Cache only successful loads; a failed request must remain retryable.
      appliedFontAssets = results.every(result => result.status === 'fulfilled')
        ? { key, stack: finalStack, mainLoaded: !!main } : null;
      KaraokeEngine.notifyTemplateSettings?.(settings);
      return { version, mainLoaded: !!main };
    } catch (err) {
      if (version !== fontAssetApplyVersion) return;
      // display 是透明 OBS 輸出頁，不顯示錯誤遮罩；面板在選取前已會把錯誤提示給操作者。
      // 資源檔載不進來時，仍優先用 settings.fontFamily（含在地名＋英文別名的候選堆疊），
      // CEF 從 CSS 認得任何一個就照樣渲染；真的都不行才退到 Noto fallback。
      console.warn('[Elitesand] 本機字型載入失敗，改用 CSS 字型堆疊：', err?.message || err);
      document.documentElement.style.setProperty('--display-font-family', settings.fontFamily || fallbackStack);
      KaraokeEngine.notifyTemplateSettings?.(settings);
      return { version, mainLoaded: false };
    }
  }

  // 字型解析探針（診斷用，見 public/js/font-probe.js）。.ttc 等集合字型改走系統名稱
  // 解析後，名稱比不到時是「靜默用備援字」沒有錯誤訊號。這裡在顯示端量一次，探不到就
  // 送一個 diagnostic-only socket 事件給面板提示操作者——不改 state、不持久化、不 broadcast。
  let displayFontProbeTimer = null;
  function scheduleDisplayFontProbe(settings, applied) {
    clearTimeout(displayFontProbeTimer);
    // A verified binary face uses its internal family, not the original OS name.
    if (!applied || applied.version !== fontAssetApplyVersion || applied.mainLoaded) return;
    const version = applied.version;
    const probe = window.ElitesandFontProbe;
    // 只有正式 OBS display 來源回報；面板內的 preview iframe 與 Spout 輸出不回報（避免重複／洗版）。
    if (!probe || typeof probe.check !== 'function' || isSpoutOutput || isPreviewClient) return;
    const raw = (settings && typeof settings.fontFamily === 'string') ? settings.fontFamily : '';
    const names = raw.split(',').map((n) => n.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    if (!names.length) return;
    clearTimeout(displayFontProbeTimer);
    displayFontProbeTimer = setTimeout(async () => {
      let result;
      if (version !== fontAssetApplyVersion) return;
      try { result = await probe.check(names); } catch (_) { return; }
      if (version !== fontAssetApplyVersion) return;
      if (!result || result.resolved !== false || result.reason === 'no-candidates') return;
      try {
        SocketClient.send('font-probe:report', {
          name: String(names[0] || '').slice(0, 80),
          ts: Date.now(),
        });
      } catch (_) { /* 診斷用，送不出去就算了 */ }
    }, 450);
  }

  // 曲名／演出者給模板用（燈牌的下緣銘牌、間奏跑馬）。走 body.dataset 沿用既有慣例，
  // 模板不必自己去接 socket；沒有曲目時清掉，銘牌會整條隱藏。
  function syncTrackMetaDataset(track) {
    const title = track && typeof track.title === 'string' ? track.title.slice(0, 80) : '';
    const artist = track && typeof track.artist === 'string' ? track.artist.slice(0, 60) : '';
    if (title) document.body.dataset.lbTitle = title; else delete document.body.dataset.lbTitle;
    if (artist) document.body.dataset.lbArtist = artist; else delete document.body.dataset.lbArtist;
  }

  // ─── 歌詞外觀/位置設定（從控制面板即時推送，寫入 CSS 變數）───
  function applyLyricSettings(s) {
    if (!s || typeof s !== 'object') return;
    const root = document.documentElement.style;
    const map = {
      fontSize: ['--display-font-size', v => `${v}px`],
      fontFamily: ['--display-font-family', v => v],
      fontWeight: ['--display-font-weight', v => String(v)],
      color: ['--lyric-color', v => v],
      activeColor: ['--lyric-color-active', v => v],
      // 打字機模板：左右對話泡泡底色（其他模板不吃這兩個變數）
      twBubbleRight: ['--tw-bubble-right', v => v],
      twBubbleLeft: ['--tw-bubble-left', v => v],
      // 紙帶逐字：紙條顏色（其他模板不吃）
      paperstripColor: ['--ps-strip-color', v => v],
      strokeWidth: ['--lyric-stroke-width', v => `${v}px`],
      strokeColor: ['--lyric-stroke-color', v => v],
      shadow: ['--lyric-shadow', v => v],
      historyOpacity: ['--lyric-history-opacity', v => String(v)],
      // 歷史歌詞字級：0 = 自動（CSS 內以主字級 58% 計算），>0 = 固定像素。
      // 回傳空字串時 setProperty 會移除該變數 → CSS 的 calc() fallback 生效。
      historyFontSize: ['--lyric-history-font-size', v => (Number(v) > 0 ? `${v}px` : '')],
      verticalPosition: ['--lyric-justify', v => v],   // flex-start/center/flex-end
      horizontalAlign: ['--lyric-align', v => v],
      textAlign: ['--lyric-text-align', v => v],
      paddingX: ['--lyric-padding-x', v => `${v}px`],
      paddingY: ['--lyric-padding-y', v => `${v}px`],
      maxWidth: ['--lyric-max-width', v => `${v}%`],
      // offsetX/offsetY 不走這裡直接寫 CSS 變數——見下方 reclampLyricOffset，
      // 使用者調的是「意圖位移」，實際套用值會依當下內容自動收緊，不會把歌詞推出畫面。
      // 文字排版細項
      lineHeight: ['--lyric-line-height', v => String(v)],
      letterSpacing: ['--lyric-letter-spacing', v => `${v}px`],
      activeScale: ['--lyric-active-scale', v => String(v)],
      // 合成字串（面板端組好）：發光與背景框。glow='none' 時退化成無視覺的合法 shadow，
      // 確保 active 行 text-shadow 的逗號列表永遠合法（base + glow 兩層）。
      glow: ['--lyric-active-glow', v => (v && v !== 'none') ? v : '0 0 0 transparent'],
      textBg: ['--lyric-text-bg', v => v],
      textBgPad: ['--lyric-text-bg-pad', v => v],
      // 羅馬字（拼音）與諧音外觀
      romajiColor: ['--lyric-romaji-color', v => v],
      romajiSize: ['--lyric-romaji-size', v => `${v}em`],
      xieyinColor: ['--lyric-xieyin-color', v => v],
      xieyinSize: ['--lyric-xieyin-size', v => `${v}em`],
    };
    for (const [key, [cssVar, fmt]] of Object.entries(map)) {
      if (s[key] !== undefined && s[key] !== null && s[key] !== '') {
        root.setProperty(cssVar, fmt(s[key]));
      }
    }
    if (typeof s.offsetX === 'number') lyricOffsetTargetX = s.offsetX;
    if (typeof s.offsetY === 'number') lyricOffsetTargetY = s.offsetY;
    // 底部極細進度條開關（預設開；OBS 不想要可在面板「歌詞顯示模式」關掉）
    if (obsProgressBar) obsProgressBar.style.display = (s.showProgressBar === false) ? 'none' : '';
    ensureLyricOffsetObserver();
    reclampLyricOffset();
    // KTV 伴唱是底部雙行絕對定位，原本 paddingY 的 0..300px 幅度對「上下位置」
    // 太小；把同一個「上下邊距」控制轉成較大的 KTV 專用位移，避免主設定區再多一條 Y 控制。
    if (typeof s.paddingY === 'number') {
      root.setProperty('--ktv-padding-y-offset', `${(s.paddingY - 48) * 3}px`);
    }
    // 中英文分離字體：把英文字體排在主字體「前面」——拉丁字母/數字先被英文字體吃掉，
    // 中日韓字元英文字體沒有字形、自動落到後面的主字體，兩套字體就分開了。
    // fontFamilyLatin 為空＝不指定（英文跟著主字體；上面的 map 已還原成純 fontFamily）。
    let fallbackFontStack = (typeof s.fontFamily === 'string' && s.fontFamily) ? s.fontFamily : root.getPropertyValue('--display-font-family');
    if (typeof s.fontFamilyLatin === 'string' && s.fontFamilyLatin.trim() && typeof s.fontFamily === 'string' && s.fontFamily) {
      const latin = s.fontFamilyLatin.trim();
      const quoted = /[,'"]/.test(latin) ? latin : `'${latin}'`;
      fallbackFontStack = `${quoted}, ${s.fontFamily}`;
      root.setProperty('--display-font-family', fallbackFontStack);
    }
    clearTimeout(displayFontProbeTimer);
    applyLocalFontAssets(s, fallbackFontStack).then(applied => {
      if (applied?.version === fontAssetApplyVersion) scheduleDisplayFontProbe(s, applied);
    });
    // 保留句數
    if (typeof s.historyLines === 'number') {
      KaraokeEngine.setMaxHistoryLines(s.historyLines);
    }
    // 逐字 KTV 模式已移除：經典疊層一律逐句（karaoke.js 的 wordByWord 保持預設 false）；
    // 逐字效果改用獨立的 KTV 伴唱模板。
    // 簡轉繁（setTraditional 內部已對未變更早退，不會多餘重渲染）
    if (typeof s.convertTraditional === 'boolean' && KaraokeEngine.setTraditional) {
      KaraokeEngine.setTraditional(s.convertTraditional);
    }
    // 動畫強度（folia 系模板讀 body dataset；先設好再切模板，mount 時才讀得到正確值）
    if (typeof s.animationIntensity === 'string') {
      document.body.dataset.lyricIntensity = s.animationIntensity;
    }
    // 排版模板專屬設定（直書句流的排向、燈牌的燈色/字型、KTV 間奏字樣、舞台系中央安全距離…）：
    // 由各模板在 register({ settings:[...] }) 自行宣告，LyricTemplateSettings 統一寫進
    // body.dataset / body.style / class，並清掉切走的模板殘留的同類 key。
    // 先於 setTemplate() 呼叫，dataset 才會在模板 mount 前就位。
    if (window.LyricTemplateSettings) window.LyricTemplateSettings.apply(s);
    // 歌詞水平位置：CSS 靠 body class 縮排容器；split 的逐行交替由各模板讀 dataset 處理。
    // 經典疊層完全不支援這個機制（面板已改用九宮格當它的位置控制、對應的四鍵整批隱藏），
    // 但 settings.lyricPosition 的值本身仍會保留使用者在動畫模板下的偏好（不強制清空），
    // 只是套用 class 時要看目前模板：經典疊層永遠不套用，避免使用者切回動畫時設過
    // 偏左/偏右，再切回經典疊層時 body 還留著 .lyric-pos-left/right，
    // 把 #lyrics-container 卡死在半邊、九宮格看起來像被鎖住只剩上中下能調。
    if (typeof s.lyricPosition === 'string') {
      document.body.dataset.lyricPos = s.lyricPosition;
      document.body.classList.remove('lyric-pos-left', 'lyric-pos-right', 'lyric-pos-split');
      const isClassic = s.template === 'classic' || s.template === 'columnflow';
      if (!isClassic && s.lyricPosition !== 'center') document.body.classList.add(`lyric-pos-${s.lyricPosition}`);
    }
    // 排版模板（v4）：setTemplate 內部已對同值早退，高頻重送設定不會反覆重建畫面
    if (typeof s.template === 'string' && KaraokeEngine.setTemplate) {
      KaraokeEngine.setTemplate(s.template);
    }
    // 通知目前模板「設定更新了」，讓純設定驅動、跟播放進度無關的畫面（例如直書句流的
    // 中央安全距離引導線）不必等下一次 onFrame／onSeek 就能即時反映——暫停或還沒開始播放時
    // 根本不會再有下一次。
    if (KaraokeEngine.notifyTemplateSettings) {
      KaraokeEngine.notifyTemplateSettings(s);
    }
    // 自訂背景（Phase 4）
    applyBackgroundSettings(s);
  }

  // ─── 自訂背景（Phase 4）───
  // 搭 lyric-settings:update 便車，不新增 socket 事件。預設 displayBgImage='' = 完全透明，行為不變。
  // 注意：鍵名刻意加 display 前綴，避免與既有「歌詞文字背景框」的 bgColor/bgOpacity 撞名。
  const backgroundEl = document.getElementById('display-background');
  let lastDisplayBgOpacity = 1; // 記住使用者設定值，緊急隱藏解除時用它還原（而非硬回 1）
  function applyBackgroundSettings(s) {
    if (!backgroundEl) return;
    if (typeof s.displayBgImage === 'string') {
      backgroundEl.style.backgroundImage = s.displayBgImage
        ? `url('/background/${encodeURIComponent(s.displayBgImage)}')`
        : 'none';
    }
    if (typeof s.displayBgOpacity === 'number') {
      lastDisplayBgOpacity = Math.max(0, Math.min(1, s.displayBgOpacity));
      backgroundEl.style.opacity = String(lastDisplayBgOpacity);
    }
    if (typeof s.displayBgFit === 'string') {
      const sizeMap = { cover: 'cover', contain: 'contain', fill: '100% 100%' };
      backgroundEl.style.backgroundSize = sizeMap[s.displayBgFit] || 'cover';
    }
  }

  SocketClient.on('lyric-settings:update', applyLyricSettings);

  // 面板即時預覽：控制面板內嵌的 /display?preview=1 iframe 會收到 postMessage，
  // 不必等 socket 往返即可即時套用設定（拖滑桿所見即所得）。正式 OBS 來源是頂層視窗，
  // 沒有人對它 postMessage，故此監聽對 OBS 無副作用。
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'lyric-settings:preview' && d.settings) {
      applyLyricSettings(d.settings);
    } else if (d && d.type === 'lyrics-preview:sample') {
      renderPreviewSample();
      // The interactive tour must unlock only after the real preview handled the sample.
      // Reply to the exact source window; no playback or server state is changed.
      if (e.source && typeof e.source.postMessage === 'function') {
        e.source.postMessage(
          { type: 'lyrics-preview:sample-ready' },
          e.origin && e.origin !== 'null' ? e.origin : '*',
        );
      }
    }
  });

  // 羅馬拼音模式
  SocketClient.on('romanization:mode', (mode) => {
    KaraokeEngine.setRomanizationMode(mode);
  });

  // ─── 緊急隱藏（最高優先權，即時回應，不可有動畫延遲）───

  // 緊急隱藏＝只隱藏「自家的」疊加元素（歌詞/節拍器/進度條）。
  // 絕對不能用全黑遮罩蓋畫面——OBS 疊加層是透明的，黑幕會把使用者的整個場景蓋掉（實機回報）。
  function applyEmergencyHide() {
    lyricsContainer.style.opacity = '0';
    lyricsContainer.style.pointerEvents = 'none';
    hideMetronome();
    if (obsProgressFill) obsProgressFill.style.opacity = '0';
    if (backgroundEl) backgroundEl.style.opacity = '0';
  }
  function clearEmergencyHide() {
    lyricsContainer.style.opacity = '1';
    lyricsContainer.style.pointerEvents = '';
    if (obsProgressFill) obsProgressFill.style.opacity = '';
    if (backgroundEl) applyBackgroundSettings({ displayBgOpacity: lastDisplayBgOpacity });
  }

  SocketClient.on('emergency:hide', () => {
    if (isPreview) { document.body.classList.add('emergency-active'); return; } // 預覽不隱藏，只標記
    applyEmergencyHide();
  });

  SocketClient.on('emergency:show', () => {
    if (isPreview) { document.body.classList.remove('emergency-active'); return; }
    clearEmergencyHide();
  });

  // ─── 羅馬化完成推播 ───

  SocketClient.on('lyrics:romanized', (data) => {
    console.log('[Display] 收到羅馬化更新');
    if (data && data.parsedLyrics) {
      KaraokeEngine.updateRomanization(data.parsedLyrics);
    }
  });

  // ═══════════════════════════════════════════
  // Phase 5: 歌詞即時更新（手動覆蓋後）
  // ═══════════════════════════════════════════

  SocketClient.on('lyrics:updated', (data) => {
    console.log('[Display] 收到歌詞更新:', data.source);
    if (data && data.lyrics) {
      KaraokeEngine.loadLyrics(data.lyrics, data.lyricsType || 'lrc', data.parsedLyrics);
    }
  });

  // ═══════════════════════════════════════════
  // Phase 5: 時間偏移更新
  // ═══════════════════════════════════════════

  SocketClient.on('offset:update', (data) => {
    if (data && currentTrackData && data.trackId === currentTrackData.id) {
      currentOffsetMs = data.offset || 0;
      KaraokeEngine.setOffset(currentOffsetMs);
      console.log(`[Display] 時間偏移更新: ${currentOffsetMs}ms`);
    }
  });

  // ═══════════════════════════════════════════
  // Phase 7: 變速更新
  //
  // 這裡刻意沒有 pitch:update 的監聽器：顯示端不出聲，變調在純視覺端沒有任何
  // 效果（2026-09 死碼清理移除）。變速則相反——必須收，因為歌詞時鐘要跟著變。
  // ═══════════════════════════════════════════

  SocketClient.on('speed:update', (rate) => {
    if (typeof rate !== 'number') return;
    const oldRate = currentPlaybackRate;
    currentPlaybackRate = Math.max(0.5, Math.min(1.5, rate));

    // 關鍵：速率變更時，必須重新校準 syncTimeMs
    // 因為 getCurrentTimeMs() 依賴 playbackRate 計算已過時間
    // 切換速率的瞬間，要將目前計算出的時間固定為新的 syncTimeMs
    if (oldRate !== currentPlaybackRate) {
      syncTimeMs = getCurrentTimeMs();
      lastSyncTimestamp = performance.now();
    }
  });

  // ═══════════════════════════════════════════
  // Phase 7: 前奏倒數提示開關
  // ═══════════════════════════════════════════

  SocketClient.on('metronome:update', (enabled) => {
    metronomeEnabled = !!enabled;
    if (!metronomeEnabled) {
      hideMetronome();
    }
    console.log(`[Display] 前奏倒數提示: ${metronomeEnabled ? '啟用' : '停用'}`);
  });

  // ═══════════════════════════════════════════
  // Phase 5: OBS 斷線重連狀態恢復
  // ═══════════════════════════════════════════

  SocketClient.on('state:recovery', (state) => {
    console.log('[Display] 收到完整狀態恢復');
    applyRecoveryState(state);
  });

  SocketClient.on('state:sync', (state) => {
    // 基本狀態同步（不含歌詞恢復）
    if (state.style) StylePresets.setStyle(state.style);
    if (state.styleOverrides) StylePresets.setOverrides(state.styleOverrides);
    if (state.romanizationMode) KaraokeEngine.setRomanizationMode(state.romanizationMode);
    if (state.emergencyHide && !isPreview) {
      applyEmergencyHide();
    } else {
      clearEmergencyHide();
    }

    // Phase 5: 套用 offset
    if (typeof state.currentOffset === 'number') {
      currentOffsetMs = state.currentOffset;
      KaraokeEngine.setOffset(currentOffsetMs);
    }

    // Phase 7: 套用 speed（pitch 在純視覺端沒有效果，不還原）
    if (typeof state.playbackRate === 'number') {
      currentPlaybackRate = state.playbackRate;
    }
    if (typeof state.metronomeEnabled === 'boolean') {
      metronomeEnabled = state.metronomeEnabled;
    }
    // 套用持久化的歌詞外觀/位置設定（重連時還原）
    if (state.lyricSettings && typeof state.lyricSettings === 'object') {
      applyLyricSettings(state.lyricSettings);
    }

    // 同步當前歌曲（僅在沒有歌詞時恢復）
    if (state.currentTrack) {
      currentTrackData = state.currentTrack;
      syncTrackMetaDataset(currentTrackData);

      if (typeof state.currentTrack.offset === 'number') {
        currentOffsetMs = state.currentTrack.offset;
        KaraokeEngine.setOffset(currentOffsetMs);
      }

      if (state.currentTrack.lyrics && (!KaraokeEngine.getLyrics().length || previewSampleActive)) {
        previewSampleActive = false;
        KaraokeEngine.loadLyrics(state.currentTrack.lyrics, state.currentTrack.lyricsType || 'lrc', state.currentTrack.parsedLyrics);
      }
    }

    if (state.isPlaying !== undefined) {
      isControllerPlaying = state.isPlaying;
    }

    // Phase 5: 恢復 currentTime（考慮頁面重載延遲）
    if (typeof state.currentTime === 'number' && state.serverTimestamp) {
      const elapsedSinceUpdate = (Date.now() - state.serverTimestamp) / 1000;
      // Phase 7: 補償需考慮 playbackRate
      const compensatedTime = state.isPlaying
        ? state.currentTime + (elapsedSinceUpdate * currentPlaybackRate)
        : state.currentTime;
      syncTimeMs = compensatedTime * 1000;
      lastSyncTimestamp = performance.now();

      console.log(`[Display] 狀態恢復: currentTime=${compensatedTime.toFixed(1)}s, offset=${currentOffsetMs}ms, speed=${currentPlaybackRate}x`);
    }
  });

  /**
   * 套用完整恢復狀態（OBS 重載時使用）
   */
  function applyRecoveryState(state) {
    if (!state) return;

    // 風格
    if (state.style) StylePresets.setStyle(state.style);
    if (state.styleOverrides) StylePresets.setOverrides(state.styleOverrides);

    // 羅馬模式
    if (state.romanizationMode) KaraokeEngine.setRomanizationMode(state.romanizationMode);

    // 緊急隱藏
    if (state.emergencyHide && !isPreview) {
      applyEmergencyHide();
    }

    // Offset
    if (typeof state.currentOffset === 'number') {
      currentOffsetMs = state.currentOffset;
      KaraokeEngine.setOffset(currentOffsetMs);
    }

    // Phase 7: 恢復 speed（pitch 在純視覺端沒有效果，不還原）
    if (typeof state.playbackRate === 'number') {
      currentPlaybackRate = state.playbackRate;
    }
    if (typeof state.metronomeEnabled === 'boolean') {
      metronomeEnabled = state.metronomeEnabled;
    }

    // 套用持久化的歌詞外觀/位置設定（OBS 重載 / 重開程式時還原，否則會退回預設）
    if (state.lyricSettings && typeof state.lyricSettings === 'object') {
      applyLyricSettings(state.lyricSettings);
    }

    // 當前歌曲 + 歌詞
    if (state.currentTrack) {
      currentTrackData = state.currentTrack;
      syncTrackMetaDataset(currentTrackData);

      if (typeof state.currentTrack.offset === 'number') {
        currentOffsetMs = state.currentTrack.offset;
        KaraokeEngine.setOffset(currentOffsetMs);
      }

      // 載入歌詞
      if (state.currentTrack.lyrics) {
        previewSampleActive = false;
        KaraokeEngine.loadLyrics(
          state.currentTrack.lyrics,
          state.currentTrack.lyricsType || 'lrc',
          state.currentTrack.parsedLyrics
        );
      }

    }

    // 播放狀態 + currentTime 補償
    if (typeof state.isPlaying === 'boolean') {
      isControllerPlaying = state.isPlaying;
    }

    if (typeof state.currentTime === 'number' && state.serverTimestamp) {
      // 計算補償後的 currentTime
      const pageLoadDelay = (Date.now() - state.serverTimestamp) / 1000;
      // Phase 7: 補償需考慮 playbackRate
      const compensatedTime = state.isPlaying
        ? state.currentTime + (pageLoadDelay * currentPlaybackRate)
        : state.currentTime;

      syncTimeMs = compensatedTime * 1000;
      lastSyncTimestamp = performance.now();

      console.log(`[Display] 完整狀態恢復: time=${compensatedTime.toFixed(1)}s, playing=${state.isPlaying}, offset=${currentOffsetMs}ms, speed=${currentPlaybackRate}x`);
    }
  }

  // ─── 啟動動畫迴圈 ───
  animFrameId = requestAnimationFrame(animationLoop);

  // ═══════════════════════════════════════════
  // 連線狀態橫幅
  // ═══════════════════════════════════════════

  SocketClient.on('connection-change', (connected) => {
    const banner = document.getElementById('connection-banner');
    if (!connected && banner) {
      banner.classList.add('visible');
    } else if (banner) {
      banner.classList.remove('visible');
    }
  });

  // ─── Phase 5: 頁面載入時主動請求狀態恢復 ───
  // 延遲 500ms 確保 Socket 連線已建立
  setTimeout(() => {
    if (SocketClient.connected()) {
      console.log('[Display] 主動請求狀態恢復');
      SocketClient.send('state:request');
    }
  }, 500);

  // ─── 清理 ───
  window.addEventListener('beforeunload', () => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
  });
})();
