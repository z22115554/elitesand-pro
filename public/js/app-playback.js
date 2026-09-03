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

  const { formatTime, safeHttpUrl } = SharedUtils;
  const { dom } = AppShared;
  const state = AppShared.state;

  const audioPlayer = document.getElementById('audio-player');
  let audioErrorCount = 0;
  // stopPlayback() 主動把 src 清空收尾（例如播完清單最後一首）時，瀏覽器仍會非同步吐出一次
  // MEDIA_ERR_SRC_NOT_SUPPORTED 的 'error' 事件——這不是真的播放失敗，靠這個旗標讓下一次
  // error 事件略過，不要跳出「音訊格式不支援」的錯誤 toast。
  let suppressNextAudioError = false;

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
  let stTrackGain = null;         // 統一音量：每首歌的響度校正增益（-14 LUFS 對齊）
  let stLimiter = null;           // 統一音量提升小聲歌時的防爆音保險（高門檻，平常完全透明）
  let isPlaying = false;

  // ── AI 分離播放模式（實驗性）：伴奏＝主 SoundTouchEngine（跟一般單軌播放共用同一份，
  // 只是把它載入的檔案換成伴奏檔）；人聲＝第二份獨立的 SoundTouchEngine（同一個
  // AudioContext、各自的 AudioWorkletNode），跟著伴奏同步 play/pause/seek/pitch/tempo。
  // 2026-08-23 研究過 soundtouch-worklet.js 的實際演算法：WSOLA 的相關性搜尋只影響混音
  // 品質，不影響每次迭代吃掉/吐出幾個 sample（那由 tempo/pitch 參數決定，跟音檔內容無關）；
  // 兩份 instance 只要同一個 AudioContext、同樣起始位置、同樣 tempo/pitch，理論上不會飄。
  // 這是這輪從「plain <audio> 影子軌、強制原速原調」升級成「雙引擎、支援變調變速」的取代
  // 設計，變調/變速滑桿在分離播放模式下不再停用。──
  let separationModeEnabled = false;
  try { separationModeEnabled = localStorage.getItem('vk-separation-mode') === '1'; } catch (e) { /* 靜默 */ }
  let separationActive = false; // 目前這首歌是否「實際」在用分離播放（toggle 開但這首沒分離過時仍是 false）
  let vocalsSTEngine = null, vocalsGain = null, vocalsDelay = null;
  // A1：伴奏鏈上有 stLimiter（DynamicsCompressor，Chromium 有 lookahead 前視延遲），人聲鏈
  // 沒有，導致分離播放時伴奏固定慢人聲幾 ms。人聲鏈補一個等長 DelayNode 補回來。
  // 實測基準約 6ms；留 localStorage 覆寫（vk-separation-comp-latency-ms）方便實機微調。
  let separationCompLatencySec = 0.006;
  try {
    const savedComp = parseFloat(localStorage.getItem('vk-separation-comp-latency-ms'));
    if (Number.isFinite(savedComp)) separationCompLatencySec = Math.max(0, Math.min(50, savedComp)) / 1000;
  } catch (e) { /* 靜默 */ }
  // 「載入待命」與「按播放」是兩個獨立時機（點清單只載入不播放，稍後才按播放鍵）。
  // 伴奏／人聲平行解碼，誰先好誰不一定；若使用者在人聲還沒解完前就按播放，伴奏
  // 這邊可能已經 ready 而直接開播，此時必須知道「人聲還在飛」才能等它、而不是
  // 誤判成「這首沒有人聲」直接放棄（見 requestPlayback 的 startST）。
  let vocalsLoadPromise = null;
  let vocalsVolume = 1.0;
  try {
    const saved = parseFloat(localStorage.getItem('vk-separation-vocals-volume'));
    if (Number.isFinite(saved)) vocalsVolume = Math.max(0, Math.min(1.5, saved));
  } catch (e) { /* 靜默 */ }

  function trackSupportsSeparation(track) {
    return !!(track && track.separationStatus === 'done' && track.vocalsFile && track.instrumentalFile);
  }

  function ensureVocalsChain() {
    if (vocalsSTEngine) return;
    stInitChain(); // 確保 stCtx 存在（人聲共用同一個 AudioContext；idempotent，可安全重複呼叫）
    if (!stCtx || typeof window.createSoundTouchEngine !== 'function') return; // 極罕見：SoundTouch 完全不可用，人聲留空、伴奏正常播放
    vocalsSTEngine = window.createSoundTouchEngine();
    vocalsGain = stCtx.createGain();
    vocalsGain.gain.value = vocalsVolume;
    // 人聲鏈：vocalsGain → vocalsDelay →（下游由 wireDualRouting 決定：直接到 destination
    // 或改接雙路耳機節點）。vocalsDelay 補的是「伴奏鏈那顆 limiter 的前視延遲」，人聲仍
    // 不經過 stTrackGain/limiter（不套響度標準化，維持既有決定）。
    vocalsDelay = stCtx.createDelay(1);
    vocalsDelay.delayTime.value = separationCompLatencySec;
    vocalsGain.connect(vocalsDelay);
    vocalsDelay.connect(stCtx.destination);
    vocalsSTEngine.attach(stCtx, vocalsGain);
  }

  /** 載入這首歌的人聲，並把 promise 記在模組層——requestPlayback 按播放鍵時若伴奏已經
   * ready、人聲卻還沒解完，要能拿到這個 promise 等它，而不是直接放棄人聲。 */
  function loadVocalsFor(track) {
    vocalsLoadPromise = vocalsSTEngine
      ? vocalsSTEngine.load('/audio/' + encodeURIComponent(track.vocalsFile))
      : Promise.resolve(false);
    return vocalsLoadPromise;
  }

  // 分離播放模式下的 UI 狀態（人聲音量滑桿顯示/隱藏、狀態提示文字）
  function updateSeparationUiForTrack() {
    if (dom.separationVocalsRow) dom.separationVocalsRow.hidden = !separationActive;
    if (dom.separationStatusHint) {
      if (!separationModeEnabled) {
        dom.separationStatusHint.textContent = '只對已分離人聲的歌曲生效，其餘歌曲仍播放原始音軌';
      } else if (separationActive) {
        dom.separationStatusHint.textContent = '目前歌曲：使用分離音軌播放（人聲/伴奏獨立音量）';
      } else {
        dom.separationStatusHint.textContent = '目前歌曲尚未分離人聲，播放原始音軌';
      }
    }
  }

  if (dom.separationModeToggle) {
    dom.separationModeToggle.checked = separationModeEnabled;
    dom.separationModeToggle.addEventListener('change', () => {
      separationModeEnabled = dom.separationModeToggle.checked;
      try { localStorage.setItem('vk-separation-mode', separationModeEnabled ? '1' : '0'); } catch (e) { /* 靜默 */ }
      if (state.currentTrackIndex !== -1) {
        // 立刻用目前播放位置重新載入這首歌，讓新模式馬上生效（沿用 restorePlaybackState 的
        // 「重新載入到指定位置」寫法，不另外發明一套換源邏輯）。
        playTrack(state.currentTrackIndex, isPlaying, { notifyServer: false, startTime: lastPlayTimeMs / 1000 });
      } else {
        updateSeparationUiForTrack();
      }
    });
  }

  if (dom.separationVocalsVolume) {
    dom.separationVocalsVolume.value = Math.round(vocalsVolume * 100);
    if (dom.separationVocalsVolumeVal) dom.separationVocalsVolumeVal.textContent = Math.round(vocalsVolume * 100) + '%';
    updateRangeFill(dom.separationVocalsVolume);
    dom.separationVocalsVolume.addEventListener('input', () => {
      vocalsVolume = parseInt(dom.separationVocalsVolume.value, 10) / 100;
      if (dom.separationVocalsVolumeVal) dom.separationVocalsVolumeVal.textContent = dom.separationVocalsVolume.value + '%';
      updateRangeFill(dom.separationVocalsVolume);
      if (vocalsGain) { try { vocalsGain.gain.value = vocalsVolume; } catch (e) { /* 靜默 */ } }
      try { localStorage.setItem('vk-separation-vocals-volume', String(vocalsVolume)); } catch (e) { /* 靜默 */ }
    });
  }

  // ── 雙路音訊路由（實驗性，docs/AI-SEPARATION-PLAN.md §14 路線 A）：本地監聽（耳機）
  // 與對外（OBS 擷取）分別送到兩個實體裝置、各自獨立音量，對所有歌曲生效；額外疊加的
  // 導唱（觀眾只聽伴奏、主播耳機多聽原唱）才需要這首歌已分離人聲。刻意不搬探索分支的
  // 獨立 DualAudioEngine 模組——這裡要的只是把「已經同步好的伴奏/人聲雙 SoundTouchEngine
  // 輸出」分別送到兩個實體裝置，是下游的路由/扇出問題，不是要不要疊加變調的問題，直接在
  // stGain/vocalsGain（兩個引擎各自的最終輸出節點，平常直接接 stCtx.destination）後面
  // 插入 DelayNode+GainNode 路由層即可，完全複用已驗證的雙 SoundTouch 架構，不必重做
  // pause/seek/變調。
  let dualAudioModeEnabled = false;
  try { dualAudioModeEnabled = localStorage.getItem('vk-dual-audio-mode') === '1'; } catch (e) { /* 靜默 */ }
  let dualAudioActive = false; // 目前這首歌是否「實際」在用雙路路由（等同 dualAudioModeEnabled，獨立追蹤方便其他地方判斷）
  let dualStreamDeviceId = '', dualHeadphoneDeviceId = '';
  try { dualStreamDeviceId = localStorage.getItem('vk-dual-audio-stream-device') || ''; } catch (e) { /* 靜默 */ }
  try { dualHeadphoneDeviceId = localStorage.getItem('vk-dual-audio-headphone-device') || ''; } catch (e) { /* 靜默 */ }
  let dualSyncOffsetMs = 0;
  try {
    const savedOffset = parseFloat(localStorage.getItem('vk-dual-audio-sync-offset-ms'));
    if (Number.isFinite(savedOffset)) dualSyncOffsetMs = Math.max(-1000, Math.min(1000, savedOffset));
  } catch (e) { /* 靜默 */ }
  // 本地監聽／對外各自的音量，疊加在主音量（stGain）之上；一次設定好、很少再動，
  // 所以跟裝置選擇/同步偏移一樣存 localStorage，重開面板不用重調。
  let dualHeadphoneVolume = 1.0, dualStreamVolume = 1.0;
  try {
    const savedHp = parseFloat(localStorage.getItem('vk-dual-audio-headphone-volume'));
    if (Number.isFinite(savedHp)) dualHeadphoneVolume = Math.max(0, Math.min(3.0, savedHp));
  } catch (e) { /* 靜默 */ }
  try {
    const savedStream = parseFloat(localStorage.getItem('vk-dual-audio-stream-volume'));
    if (Number.isFinite(savedStream)) dualStreamVolume = Math.max(0, Math.min(3.0, savedStream));
  } catch (e) { /* 靜默 */ }
  let dualStreamDelay = null, dualHeadphoneDelay = null, dualStreamGain = null, dualHeadphoneGain = null;
  let dualStreamMediaDest = null, dualStreamAudioEl = null;
  let dualRoutingWired = false; // stGain/vocalsGain 目前是接到雙路節點還是直接接 stCtx.destination

  function ensureDualAudioRouting() {
    if (dualStreamDelay) return;
    stInitChain(); // 確保 stCtx 存在（idempotent，可安全重複呼叫）
    if (!stCtx) return;
    dualStreamDelay = stCtx.createDelay(1); // 上限 1000ms，跟文件量到的基準偏移（150-180ms 等級）留足餘裕
    dualHeadphoneDelay = stCtx.createDelay(1);
    dualStreamGain = stCtx.createGain();
    dualStreamGain.gain.value = dualStreamVolume;
    dualHeadphoneGain = stCtx.createGain();
    dualHeadphoneGain.gain.value = dualHeadphoneVolume;
    dualStreamDelay.connect(dualStreamGain);
    dualStreamMediaDest = stCtx.createMediaStreamDestination();
    dualStreamGain.connect(dualStreamMediaDest);
    dualStreamAudioEl = new Audio();
    dualStreamAudioEl.srcObject = dualStreamMediaDest.stream;
    dualHeadphoneDelay.connect(dualHeadphoneGain);
    dualHeadphoneGain.connect(stCtx.destination);
    applyDualSyncOffset(dualSyncOffsetMs);
  }

  /** 套用觀眾/耳機兩個裝置的 setSinkId；裝置可能已拔除或使用者還沒選，一律靜默失敗。 */
  async function applyDualDeviceSinks() {
    if (!stCtx) return;
    if (dualHeadphoneDeviceId && typeof stCtx.setSinkId === 'function') {
      try { await stCtx.setSinkId(dualHeadphoneDeviceId); } catch (e) { /* 靜默 */ }
    }
    if (dualStreamAudioEl) {
      if (dualStreamDeviceId && dualStreamAudioEl.setSinkId) {
        try { await dualStreamAudioEl.setSinkId(dualStreamDeviceId); } catch (e) { /* 靜默 */ }
      }
      try { await dualStreamAudioEl.play(); } catch (e) { /* 靜默：可能撞上 autoplay 限制 */ }
    }
  }

  /** 切換 stGain/vocalsGain 的下游接線：雙路路由節點 vs 直接接 stCtx.destination。 */
  function wireDualRouting(active) {
    if (active === dualRoutingWired) return;
    if (active) {
      ensureDualAudioRouting();
      if (!dualStreamDelay) return; // 極罕見：SoundTouch 完全不可用，放棄雙路路由，伴奏/人聲仍正常播放
      dualRoutingWired = true;
      try { stGain.disconnect(stCtx.destination); } catch (e) { /* 靜默 */ }
      stGain.connect(dualHeadphoneDelay);
      stGain.connect(dualStreamDelay); // 伴奏兩路都要
      if (vocalsDelay) {
        // 人聲鏈尾端是 vocalsDelay（A1 補償節點），改接的是它、不是 vocalsGain
        try { vocalsDelay.disconnect(stCtx.destination); } catch (e) { /* 靜默 */ }
        vocalsDelay.connect(dualHeadphoneDelay); // 人聲只接主播路，觀眾/串流路收不到
      }
      applyDualDeviceSinks();
    } else {
      dualRoutingWired = false;
      stopDualAudioClickTest(); // 雙路拆線後 click 只會到預設裝置，沒意義，一併停掉
      if (dualStreamDelay) {
        try { stGain.disconnect(dualHeadphoneDelay); } catch (e) { /* 靜默 */ }
        try { stGain.disconnect(dualStreamDelay); } catch (e) { /* 靜默 */ }
        if (vocalsDelay) { try { vocalsDelay.disconnect(dualHeadphoneDelay); } catch (e) { /* 靜默 */ } }
      }
      if (stGain && stCtx) { try { stGain.connect(stCtx.destination); } catch (e) { /* 靜默 */ } }
      if (vocalsDelay && stCtx) { try { vocalsDelay.connect(stCtx.destination); } catch (e) { /* 靜默 */ } }
      if (stCtx && typeof stCtx.setSinkId === 'function') { stCtx.setSinkId('').catch(() => { /* 靜默 */ }); }
    }
  }

  /** 手動同步偏移（毫秒）。正值延遲主播路、負值延遲觀眾路，跟文件校正 UI 的正負號慣例
   * 一致；setTargetAtTime 平滑過渡，播放中就能調，不用停止重播。 */
  function applyDualSyncOffset(ms) {
    dualSyncOffsetMs = Math.max(-1000, Math.min(1000, Number(ms) || 0));
    if (!dualStreamDelay || !stCtx) return;
    const sec = Math.abs(dualSyncOffsetMs) / 1000;
    const now = stCtx.currentTime;
    dualStreamDelay.delayTime.setTargetAtTime(dualSyncOffsetMs < 0 ? sec : 0, now, 0.05);
    dualHeadphoneDelay.delayTime.setTargetAtTime(dualSyncOffsetMs > 0 ? sec : 0, now, 0.05);
  }

  // ─── 點擊對時測試（test7）───
  // 對「主播耳機」與「觀眾／OBS」兩路同時送每秒一下的短促方波「嗒」聲，讓使用者邊聽邊調
  // 「同步偏移」滑桿把兩下對齊；讓它持續跑就能聽出長時間漂移。click 餵進 stGain，走既有扇出
  // （dualRoutingWired 時 stGain 同時接 dualHeadphoneDelay / dualStreamDelay），不另外接線。
  let dualClickTimer = null;
  let dualClickGain = null;
  function isDualAudioClickTestRunning() { return dualClickTimer != null; }
  function _emitDualClick() {
    if (!stCtx || !dualClickGain) return;
    try {
      const t = stCtx.currentTime;
      const osc = stCtx.createOscillator();
      const env = stCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1400;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.42, t + 0.001);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(env); env.connect(dualClickGain);
      osc.start(t);
      osc.stop(t + 0.06);
      osc.onended = () => { try { osc.disconnect(); env.disconnect(); } catch (e) { /* 靜默 */ } };
    } catch (e) { /* 靜默 */ }
  }
  function startDualAudioClickTest() {
    stInitChain();
    if (!stCtx || !stGain) return false;
    if (!dualRoutingWired) return false; // 雙路沒接上時 stGain 只到預設裝置，測不了兩路
    if (dualClickTimer) return true;
    if (!dualClickGain) { dualClickGain = stCtx.createGain(); dualClickGain.gain.value = 1; }
    try { dualClickGain.disconnect(); } catch (e) { /* 靜默 */ }
    try { dualClickGain.connect(stGain); } catch (e) { /* 靜默 */ }
    _emitDualClick();
    dualClickTimer = setInterval(_emitDualClick, 1000);
    return true;
  }
  function stopDualAudioClickTest() {
    if (dualClickTimer) { clearInterval(dualClickTimer); dualClickTimer = null; }
    if (dualClickGain) { try { dualClickGain.disconnect(); } catch (e) { /* 靜默 */ } }
  }

  // 對外入口（UI 接線在 public/js/nav.js，「連線與系統」頁的裝置選擇/校正卡片，不在這裡
  // 直接綁 DOM——那組控制項是獨立的一張卡片，不是 app-shared.js 的 dom 表既有成員）。
  function setDualAudioMode(enabled) {
    dualAudioModeEnabled = !!enabled;
    try { localStorage.setItem('vk-dual-audio-mode', dualAudioModeEnabled ? '1' : '0'); } catch (e) { /* 靜默 */ }
    if (state.currentTrackIndex !== -1) {
      // 沿用既有「重新載入到目前位置」的換模式寫法（跟分離播放模式的 toggle 同一招）。
      playTrack(state.currentTrackIndex, isPlaying, { notifyServer: false, startTime: lastPlayTimeMs / 1000 });
    } else {
      wireDualRouting(false);
      dualAudioActive = false;
    }
  }
  function setDualAudioDevices({ streamDeviceId, headphoneDeviceId } = {}) {
    if (typeof streamDeviceId === 'string') {
      dualStreamDeviceId = streamDeviceId;
      try { localStorage.setItem('vk-dual-audio-stream-device', dualStreamDeviceId); } catch (e) { /* 靜默 */ }
    }
    if (typeof headphoneDeviceId === 'string') {
      dualHeadphoneDeviceId = headphoneDeviceId;
      try { localStorage.setItem('vk-dual-audio-headphone-device', dualHeadphoneDeviceId); } catch (e) { /* 靜默 */ }
    }
    if (dualRoutingWired) applyDualDeviceSinks(); // 播放中換裝置，立刻套用
  }
  function setDualAudioSyncOffset(ms) {
    applyDualSyncOffset(ms);
    try { localStorage.setItem('vk-dual-audio-sync-offset-ms', String(dualSyncOffsetMs)); } catch (e) { /* 靜默 */ }
  }
  /** 本地監聽音量（耳機路）；疊加在主音量之上，不影響對外那路。 */
  function setDualAudioHeadphoneVolume(vol) {
    dualHeadphoneVolume = Math.max(0, Math.min(3.0, Number(vol) || 0));
    if (dualHeadphoneGain) { try { dualHeadphoneGain.gain.value = dualHeadphoneVolume; } catch (e) { /* 靜默 */ } }
    try { localStorage.setItem('vk-dual-audio-headphone-volume', String(dualHeadphoneVolume)); } catch (e) { /* 靜默 */ }
  }
  /** 對外音量（OBS 擷取那路）；疊加在主音量之上，不影響本地監聽那路。 */
  function setDualAudioStreamVolume(vol) {
    dualStreamVolume = Math.max(0, Math.min(3.0, Number(vol) || 0));
    if (dualStreamGain) { try { dualStreamGain.gain.value = dualStreamVolume; } catch (e) { /* 靜默 */ } }
    try { localStorage.setItem('vk-dual-audio-stream-volume', String(dualStreamVolume)); } catch (e) { /* 靜默 */ }
  }
  function getDualAudioState() {
    return {
      enabled: dualAudioModeEnabled, active: dualAudioActive,
      streamDeviceId: dualStreamDeviceId, headphoneDeviceId: dualHeadphoneDeviceId,
      syncOffsetMs: dualSyncOffsetMs,
      headphoneVolume: dualHeadphoneVolume, streamVolume: dualStreamVolume,
    };
  }

  let currentOffsetMs = 0; // Phase 5: 當前歌曲 offset
  let lastPlayTimeMs = 0;  // 最新播放位置（ms）；timeupdate 與 SoundTouch 回呼都更新，給「對齊第一句」用
  let loadedTrackEntryId = null;
  let lastRecoverySignature = null;

  function markLocalTrackPlayed(track) {
    if (!track || !track.entryId) return;
    if (!(state.playedEntryIds instanceof Set)) state.playedEntryIds = new Set();
    state.playedEntryIds.add(track.entryId);
    state.lastPlayedEntryId = track.entryId;
  }

  function seekLoadedTrack(seconds) {
    const target = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
    lastPlayTimeMs = target * 1000;
    setCurrentTime(formatTime(target));
    if (stReady && typeof SoundTouchEngine !== 'undefined') {
      const wf = (separationActive && vocalsSTEngine) ? sepSharedFrame(0.05) : undefined;
      SoundTouchEngine.seek(target, wf);
      if (separationActive && vocalsSTEngine) { vocalsSTEngine.seek(target, wf); setTimeout(() => _syncDiagMark('跳轉後'), 200); }
    }
    const applyAudioSeek = () => {
      if (!Number.isFinite(audioPlayer.duration) || audioPlayer.duration <= 0) return;
      audioPlayer.currentTime = Math.max(0, Math.min(audioPlayer.duration, target));
      setTotalTime(formatTime(audioPlayer.duration));
      setProgressFill((audioPlayer.currentTime / audioPlayer.duration) * 100);
    };
    if (audioPlayer.readyState >= 1) applyAudioSeek();
    else audioPlayer.addEventListener('loadedmetadata', applyAudioSeek, { once: true });
  }

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
      // 統一音量鏈：worklet → stTrackGain（每首響度校正）→ stLimiter（防爆音保險）→ stGain（音量）→ 輸出。
      // limiter 門檻 -1.5dB、硬拐點：只有增益提升後的峰值才會觸發，平常完全透明。
      stTrackGain = stCtx.createGain();
      stLimiter = stCtx.createDynamicsCompressor();
      stLimiter.threshold.value = -1.5;
      stLimiter.knee.value = 0;
      stLimiter.ratio.value = 20;
      stLimiter.attack.value = 0.001;
      stLimiter.release.value = 0.1;
      stTrackGain.connect(stLimiter);
      stLimiter.connect(stGain);
      stGain.connect(stCtx.destination);
      SoundTouchEngine.attach(stCtx, stTrackGain);
      SoundTouchEngine.onTime((t) => stOnTime(t));
      // 與下方 <audio> 的 'ended' 處理邏輯一致：連續播放才自動播下一首，
      // 否則只載入待命（先前這裡忽略了 continuousPlay，導致開啟 SoundTouch 高品質變調時
      // 「連續播放」開關完全失效，一律表現成單曲播完就停）。
      SoundTouchEngine.onEnded(() => handlePlaybackEnded());
      return true;
    } catch (e) { console.warn('[SoundTouch] 初始化失敗，降級:', e.message); return false; }
  }
  function stActive() { return useSoundTouch && stReady; }
  let stLoadToken = 0; // 防止快速切歌時，較舊的載入結果覆蓋較新的 stReady
  // 回傳 'stale' 代表這次載入已被更新的載入取代——呼叫端必須直接放棄，什麼都不做。
  // 少了這個回報，舊的 .then() 會拿「當下的 stReady」（還在 decode 新歌時是 false）誤判成
  // 「SoundTouch 解碼失敗」而降級去 audioPlayer.play()，於是 <audio> 與 SoundTouch 兩條鏈
  // 同時出聲、進度各走各的（實測：連點下一首會聽到兩個不同進度的音訊，且暫停後進度條照跑）。
  async function stLoadCurrent(filename) {
    stReady = false;
    if (!useSoundTouch || !filename) return 'skip';
    if (!stInitChain()) return 'skip';
    applyStLoudnessGain(); // 首次載歌才建鏈：建好後補套當前歌曲的響度校正
    const myToken = ++stLoadToken;
    try { if (stCtx.state === 'suspended') await stCtx.resume(); } catch (e) { /* 靜默 */ }
    const ok = await SoundTouchEngine.load('/audio/' + encodeURIComponent(filename));
    if (myToken !== stLoadToken) return 'stale'; // 已有更新的載入發生 → 丟棄這次結果
    stReady = ok;
    return 'ok';
  }
  // 快速切歌時，拖曳/timeupdate 殘留的舊訊息可能晚到；帶上 trackId 讓伺服器可以擋掉對不上目前歌曲的舊值
  // （見 play:seek、lyrics:sync 的伺服器端過濾，同一套道理已用在播放時補羅馬化的推播判斷上）。
  function currentTrackId() {
    const track = state.playlist[state.currentTrackIndex];
    return track ? track.id : null;
  }

  // A4：分離播放時，把「一個共用的排程 frame」同時發給伴奏／人聲兩個引擎，讓它們的
  // play/seek/pitch/tempo 在同一個 render quantum 生效。非分離（單引擎）時回 undefined，
  // 各引擎維持「立即套用」的既有行為，完全不變。lookaheadSec 要大於主執行緒→worklet 的
  // 訊息延遲（含 OBS 編碼把音訊執行緒餓到時的尖峰），取 50–80ms。
  function sepSharedFrame(lookaheadSec) {
    if (typeof SoundTouchEngine === 'undefined' || !SoundTouchEngine.scheduleFrame) return undefined;
    const f = SoundTouchEngine.scheduleFrame(lookaheadSec == null ? 0.06 : lookaheadSec);
    return Number.isFinite(f) ? f : undefined;
  }

  // ─── SYNCDIAG（暫時性，2026-09-03；確認問題後連同 sync-diag.js 一起整批移除）───
  // 追一個「開發機重現不出、只在使用者直播時出現」的分離播放人聲/伴奏延遲。
  //   trueΔ = 兩軌 sample 級真差（getSyncSample 的 position−frame×rate）；>0 = 人聲超前
  //   舊 Δ（getTime 相減）含 ±23ms 量化抖動，一併留著對照。
  //   [mark] 標使用者動作、stall 是 worklet 累計的音訊執行緒卡頓。
  // 詳細環境蒐集在 window.SyncDiag（sync-diag.js）。
  let _syncDiagLastLogMs = 0, _syncDiagTrackStartMs = 0;
  let _syncDiagFirstTrue = null, _syncDiagMinTrue = Infinity, _syncDiagMaxTrue = -Infinity;
  function _syncDiagAvailable() {
    return separationActive && vocalsSTEngine && typeof SoundTouchEngine !== 'undefined';
  }
  // sample 級真 Δ（ms）：不受 23ms 回報抖動影響。取不到時回 null。
  function _trueDeltaMs() {
    try {
      if (!vocalsSTEngine || typeof SoundTouchEngine === 'undefined' || !SoundTouchEngine.getSyncSample) return null;
      const a = SoundTouchEngine.getSyncSample();
      const v = vocalsSTEngine.getSyncSample();
      const sr = (stCtx && stCtx.sampleRate) ? stCtx.sampleRate : 48000;
      const d = (v.position - v.frame * v.rate) - (a.position - a.frame * a.rate);
      return d / sr * 1000;
    } catch (e) { return null; }
  }
  function _syncDiagStalls() {
    try {
      const a = SoundTouchEngine.getStallStats ? SoundTouchEngine.getStallStats() : { count: 0, maxGapFrames: 0 };
      const v = (vocalsSTEngine && vocalsSTEngine.getStallStats) ? vocalsSTEngine.getStallStats() : { count: 0, maxGapFrames: 0 };
      return `stall 伴=${a.count}/${a.maxGapFrames} 人=${v.count}/${v.maxGapFrames}`;
    } catch (e) { return 'stall ?'; }
  }
  function _syncDiagReset(tag) {
    _syncDiagLastLogMs = 0;
    _syncDiagTrackStartMs = Date.now();
    _syncDiagFirstTrue = null; _syncDiagMinTrue = Infinity; _syncDiagMaxTrue = -Infinity;
    if (typeof SyncDiag === 'undefined') return;
    try { SyncDiag.start(stCtx); } catch (e) { /* 靜默 */ }
    if (!tag) return;
    const dm = (typeof SoundTouchEngine !== 'undefined') ? SoundTouchEngine.getDuration() : 0;
    const dv = vocalsSTEngine ? vocalsSTEngine.getDuration() : 0;
    SyncDiag.line(`[SyncDiag] ══ ${tag} ══ 伴奏長度=${dm.toFixed(3)}s 人聲長度=${dv.toFixed(3)}s 檔案差=${((dv - dm) * 1000).toFixed(0)}ms`);
    const cur = state.playlist[state.currentTrackIndex] || {};
    try { SyncDiag.trackProbe(cur.instrumentalFile, cur.vocalsFile, cur.filename, tag); } catch (e) { /* 靜默 */ }
  }
  function _syncDiagMark(label) {
    if (!_syncDiagAvailable() || typeof SyncDiag === 'undefined') return;
    const td = _trueDeltaMs();
    const dv = (vocalsSTEngine.getTime() - SoundTouchEngine.getTime()) * 1000;
    const el = (Date.now() - _syncDiagTrackStartMs) / 1000;
    SyncDiag.event(label, `t=${el.toFixed(0)}s trueΔ=${td == null ? '?' : (td >= 0 ? '+' : '') + td.toFixed(1)}ms Δ=${dv >= 0 ? '+' : ''}${dv.toFixed(0)}ms ${_syncDiagStalls()}`);
  }
  function _syncDiagTick(masterT) {
    if (!_syncDiagAvailable() || typeof SyncDiag === 'undefined') return;
    const now = Date.now();
    if (now - _syncDiagLastLogMs < 3000) return;
    _syncDiagLastLogMs = now;
    const vt = vocalsSTEngine.getTime();
    const vp = vocalsSTEngine.isPlaying();
    const delta = (vt - masterT) * 1000;                 // 舊：getTime 相減（抖）
    const td = _trueDeltaMs();                            // 新：sample 級真差
    if (vp && td != null) {
      if (_syncDiagFirstTrue === null) _syncDiagFirstTrue = td;
      if (td < _syncDiagMinTrue) _syncDiagMinTrue = td;
      if (td > _syncDiagMaxTrue) _syncDiagMaxTrue = td;
    }
    const el = (now - _syncDiagTrackStartMs) / 1000;
    const since = (_syncDiagFirstTrue === null || td == null) ? 0 : td - _syncDiagFirstTrue;
    const range = (_syncDiagMinTrue === Infinity) ? '—' : `[${_syncDiagMinTrue.toFixed(1)},${_syncDiagMaxTrue.toFixed(1)}]`;
    SyncDiag.tick(
      `[SyncDiag] t=${el.toFixed(0)}s 伴奏=${masterT.toFixed(2)}s trueΔ=${td == null ? '?' : (td >= 0 ? '+' : '') + td.toFixed(1)}ms ` +
      `起點以來=${since >= 0 ? '+' : ''}${since.toFixed(1)}ms 區間=${range}ms Δ舊=${delta >= 0 ? '+' : ''}${delta.toFixed(0)}ms ${_syncDiagStalls()}` +
      (vp ? '' : ' ⚠人聲引擎沒在播'),
      stCtx
    );
  }

  // SoundTouch 播放時的時間回呼：更新進度條 + 廣播 lyrics:sync（取代 audioPlayer 的 timeupdate）
  function stOnTime(t) {
    _syncDiagTick(t);
    const dur = SoundTouchEngine.getDuration() || 0;
    if (!dur) return;
    setTotalTime(formatTime(dur));
    if (!isSeeking) {
      setProgressFill((t / dur) * 100);
      setCurrentTime(formatTime(t));
    }
    lastPlayTimeMs = (t || 0) * 1000; // SoundTouch 播放位置（給「對齊第一句」用）
    renderHomeLyricNow();
    const now = Date.now();
    if (now - lastSyncTime >= SYNC_INTERVAL) {
      lastSyncTime = now;
      SocketClient.send('lyrics:sync', { currentTime: t, duration: dur, trackId: currentTrackId() });
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
    // 高品質變調模式：同步到 SoundTouch 引擎（pitch 走 WSOLA、speed 走 tempo 時間伸縮）。
    // A2/A4：分離播放時伴奏與人聲兩個引擎用「同一個排程 frame」一起套用，兩軌才會在同一個
    // render quantum 生效、不因訊息時機差而走鐘。人聲引擎只要存在就無條件跟著套——不再用
    // separationActive 當條件（狀態轉換的縫隙曾讓兩邊 pitch/tempo 快取分岔，造成兩軌長期
    // 用不同 rate、隨時間愈拉愈開；對已停的殘留引擎多送一次無害）。
    if (useSoundTouch && typeof SoundTouchEngine !== 'undefined') {
      const wf = (separationActive && vocalsSTEngine && SoundTouchEngine.scheduleFrame)
        ? SoundTouchEngine.scheduleFrame(0.05) : undefined;
      SoundTouchEngine.setPitch(currentPitchShift, wf);
      SoundTouchEngine.setTempo(currentPlaybackRate, wf);
      if (vocalsSTEngine) {
        vocalsSTEngine.setPitch(currentPitchShift, wf);
        vocalsSTEngine.setTempo(currentPlaybackRate, wf);
        setTimeout(() => _syncDiagMark(`變調${currentPitchShift}/變速${currentPlaybackRate.toFixed(2)}`), 200);
      }
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

  // 統一音量：當前歌曲的實測響度（LUFS）。存在模組層，因為 SoundTouch 鏈是
  // 首次載歌才建立的——建鏈完成後要能補套（見 stLoadCurrent）。
  let currentTrackLufs = null;

  /** 把當前歌曲的響度校正套到 SoundTouch 主鏈（鏈還沒建立時安全跳過，建鏈後補套）。 */
  function applyStLoudnessGain() {
    if (!stTrackGain || typeof LoudnessGain === 'undefined') return;
    const enabled = (typeof AudioProcessor === 'undefined' || !AudioProcessor.isNormalizationEnabled)
      ? true : AudioProcessor.isNormalizationEnabled();
    const db = enabled ? LoudnessGain.computeTrackGainDb(currentTrackLufs) : 0;
    stTrackGain.gain.value = LoudnessGain.dbToLinear(db);
  }

  /**
   * 統一音量：套用這首歌的響度校正（track.loudnessLufs 由伺服器量測）。
   * SoundTouch 與 <audio>+Tone 兩條播放鏈都要套；沒量測值或標準化關閉＝增益 1（原音量）。
   */
  function applyTrackLoudness(track) {
    currentTrackLufs = (track && typeof track.loudnessLufs === 'number') ? track.loudnessLufs : null;
    // <audio>+Tone 降級鏈：AudioProcessor 內部自行處理開關與換算
    if (typeof AudioProcessor !== 'undefined' && AudioProcessor.setTrackLoudness) {
      AudioProcessor.setTrackLoudness(currentTrackLufs);
    }
    applyStLoudnessGain();
  }

  // 統一音量開關即時重套目前歌曲，不能只更新 <audio>+Tone 降級鏈。
  function reapplyTrackLoudness() {
    const track = state.playlist[state.currentTrackIndex] || null;
    applyTrackLoudness(track);
    // 對外入口同時回傳 SoundTouch 實際節點值，供開關切換後的診斷確認。
    return stTrackGain ? stTrackGain.gain.value : null;
  }

  // ═══════════════════════════════════════════
  // 播放控制
  // ═══════════════════════════════════════════

  // autoplay：是否載入後立即播放。匯入新歌、自動換下一首時為 false（載入待命，由使用者按播放），
  // 使用者主動點歌 / 按上下首時為 true。
  function playTrack(index, autoplay = true, options = {}) {
    const playlist = state.playlist;
    if (index < 0 || index >= playlist.length) return;

    const notifyServer = options.notifyServer !== false;
    const startTime = Number.isFinite(Number(options.startTime)) ? Math.max(0, Number(options.startTime)) : 0;

    const track = playlist[index];
    if (track.audioMissing) {
      AppShared.showToast(track.url
        ? `找不到「${track.title}」的音檔，請重新下載後再播放。`
        : `找不到「${track.title}」的音檔，且沒有可重新下載的來源。`, 'error');
      AppShared.renderPlaylist();
      return false;
    }

    state.currentTrackIndex = index;
    loadedTrackEntryId = track.entryId || track.id || null;
    if (autoplay) markLocalTrackPlayed(track);

    AppShared.setMarqueeText(dom.trackTitle, track.title);
    AppShared.setMarqueeText(dom.trackArtist, track.artist || '');
    updateMiniPlayerInfo(track.title, track.artist || '', track.cover);

    // 封面：np-art 是 div，用 background-image（先前誤設 .src 無效）
    const coverUrl = safeHttpUrl(track.cover);
    if (coverUrl) {
      dom.albumArt.style.backgroundImage = `url(${JSON.stringify(coverUrl)})`;
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
    // 統一音量：同樣要在啟動播放前套好這首的響度校正
    applyTrackLoudness(track);

    // AI 分離播放模式：toggle 開著且這首歌真的分離過，才實際生效——toggle 開但這首沒分離時
    // 仍走原始音軌（不是硬性要求，是刻意的自動降級，見計畫書）。
    // 雙路路由（兩個裝置＋各自音量）不要求分離：toggle 開就對所有歌曲生效。分離過的歌
    // 額外自動連帶載入雙 stem，讓耳機那路多疊一份原唱當導唱（不用使用者再另外開一次
    // 「分離播放模式」）；wantSeparation 因此仍需要 trackSupportsSeparation()。
    const wantDualAudio = dualAudioModeEnabled;
    const wantSeparation = (separationModeEnabled || wantDualAudio) && trackSupportsSeparation(track);
    separationActive = wantSeparation;
    dualAudioActive = wantDualAudio;
    if (wantSeparation) ensureVocalsChain();
    wireDualRouting(wantDualAudio);
    updateSeparationUiForTrack();
    // toggle 開著但這首「還沒」分離完成時，原本是靜默降級回原始音軌——使用者實測回報
    // 「切到下一首突然沒分離」，體感像是壞掉，其實常是分離工作還在跑（CPU 分離可能要
    // 好幾分鐘，比一首歌的播放時間還長）。這裡補一個提示，讓使用者知道原因、不用去猜。
    if ((separationModeEnabled || dualAudioModeEnabled) && !wantSeparation && track.separationStatus === 'processing') {
      AppShared.showToast(`「${track.title}」的人聲分離還在處理中，先播放原始音軌`, 'info');
    }

    const masterFilename = wantSeparation ? track.instrumentalFile : track.filename;
    if (masterFilename) {
      audioErrorCount = 0;
      audioPlayer.src = `/audio/${encodeURIComponent(masterFilename)}`;
      audioPlayer.playbackRate = currentPlaybackRate;
      // 切歌：先停掉並銷毀上一首的 SoundTouch 節點，避免舊節點變孤兒繼續播放、停不下來。
      // 注意：load 只在下方各分支「呼叫一次」——重複 stLoadCurrent 會讓兩個 load 競態、產生孤兒節點。
      if (useSoundTouch) { try { SoundTouchEngine.stop(); } catch (e) {} }
      // 上一首的人聲引擎「無條件」停：從分離歌手動切到非分離歌時 wantSeparation 為 false，
      // 若在這裡加 wantSeparation 判斷，舊人聲軌會變孤兒繼續唱、下一首又照播（實測事故）。
      if (vocalsSTEngine) { try { vocalsSTEngine.stop(); } catch (e) {} }
      if (autoplay) {
        if (useSoundTouch) {
          // SoundTouch 路徑：等 buffer 好再播；<audio> 靜音待命當備援
          audioPlayer.muted = true;
          audioPlayer.pause(); // 走 SoundTouch 就不該有 <audio> 在跑：靜音的 <audio> 仍會發 timeupdate 搶進度條
          // 分離播放模式：伴奏＋人聲要平行載入（不能先播伴奏、等它 ready 才去載人聲，
          // 那樣人聲會晚個幾百 ms 才進來），載入完成才一起 play()，起頭才會對齊。
          const loadPromises = [stLoadCurrent(masterFilename)];
          if (wantSeparation) {
            loadPromises.push(loadVocalsFor(track));
          }
          Promise.all(loadPromises).then(([result, vocalsOk]) => {
            if (result === 'stale') return; // 已被更新的切歌取代，交給那一次處理
            if (stReady) {
              // A4：伴奏與人聲用同一個排程 frame 一起起播（wf；非分離時 undefined → 立即，行為不變）
              const wf = (wantSeparation && vocalsOk) ? sepSharedFrame(0.09) : undefined;
              SoundTouchEngine.setPitch(currentPitchShift);
              SoundTouchEngine.setTempo(currentPlaybackRate);
              SoundTouchEngine.play(startTime, wf);
              if (wantSeparation && vocalsOk) {
                vocalsSTEngine.setPitch(currentPitchShift);
                vocalsSTEngine.setTempo(currentPlaybackRate);
                vocalsSTEngine.play(startTime, wf);
                _syncDiagReset(`新歌 ${track.title || ''}`);
              }
              isPlaying = true; updatePlayButton();
            } else {
              // decode 失敗 → 降級回 <audio>+Tone（分離的人聲這時放棄，只播伴奏原檔——
              // decode 失敗本來就是罕見的損壞檔案邊界情況，不值得為它另外設計一套
              // 「伴奏降級、人聲還撐著」的混合狀態）
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
        if (useSoundTouch) {
          const loadPromises = [stLoadCurrent(masterFilename)];
          if (wantSeparation) {
            loadPromises.push(loadVocalsFor(track));
          }
          Promise.all(loadPromises).then(([result]) => {
            if (result === 'stale') return;
            seekLoadedTrack(startTime);
          });
        }
        audioPlayer.load();
        seekLoadedTrack(startTime);
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
    if (notifyServer) SocketClient.send('play:track', { ...track, autoplay });
    // 載入待命時明確告知顯示端「暫停」，否則顯示端會以為在播放而讓歌詞自走
    if (notifyServer && !autoplay) SocketClient.send('play:toggle', false);
    AppShared.renderPlaylist();
  }

  function stopPlayback() {
    audioPlayer.pause();
    suppressNextAudioError = true;
    audioPlayer.src = '';
    loadedTrackEntryId = null;
    lastRecoverySignature = null;
    // 使用者完整停止/清空播放時，不需要保留 SoundTouch 的整首 PCM buffer 供續播。
    // 暫停仍只走 pause，維持立即續播；這裡才真正釋放記憶體。
    if (useSoundTouch) {
      try { SoundTouchEngine.dispose(); } catch (e) {}
      stReady = false;
    }
    if (vocalsSTEngine) { try { vocalsSTEngine.dispose(); } catch (e) {} }
    if (vocalsDelay) { try { vocalsDelay.disconnect(); } catch (e) {} }
    vocalsSTEngine = null; vocalsGain = null; vocalsDelay = null; vocalsLoadPromise = null; // 銷毀後要歸零，否則 ensureVocalsChain() 會早退、下一首分離歌拿到死引擎
    if (typeof SyncDiag !== 'undefined') { try { SyncDiag.stopEnvPoll(); } catch (e) { /* 靜默 */ } } // SYNCDIAG
    stopDualAudioClickTest();
    wireDualRouting(false);
    dualAudioActive = false;
    separationActive = false;
    updateSeparationUiForTrack();
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

  function restorePlaybackState(track, currentTime, currentTrackStarted) {
    if (!track) return;
    const key = track.entryId || track.id || null;
    const seconds = Number.isFinite(Number(currentTime)) ? Math.max(0, Number(currentTime)) : 0;
    const signature = `${key || ''}:${Math.round(seconds * 10)}:${currentTrackStarted ? 1 : 0}`;
    const index = track.entryId
      ? state.playlist.findIndex((item) => item && item.entryId === track.entryId)
      : state.playlist.findIndex((item) => item && item.id === track.id);
    if (index < 0) return;

    if (loadedTrackEntryId === key) {
      // 正常播放中的 state:sync 不可反覆 seek；只有本地已暫停／待命時才套用伺服器保存位置。
      if (!isPlaying && lastRecoverySignature !== signature) seekLoadedTrack(seconds);
      lastRecoverySignature = signature;
      return;
    }

    // 程式重開後只在本地載入並定位，不回送 play:track，否則會把伺服器剛還原的
    // currentTime 重設成 0，也會把「意外關閉前的歌曲」重複記入已唱紀錄。
    playTrack(index, false, { notifyServer: false, startTime: seconds });
    lastRecoverySignature = signature;
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
      const safeCoverUrl = safeHttpUrl(coverUrl);
      if (safeCoverUrl) {
        dom.miniPlayerArt.style.backgroundImage = `url(${JSON.stringify(safeCoverUrl)})`;
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
    if (shouldPlay) markLocalTrackPlayed(state.playlist[state.currentTrackIndex]);
    if (!shouldPlay) {
      // 兩條鏈都停。只停「當前那條」的話，另一條若因載入競態還在跑，
      // 暫停後 <audio> 的 timeupdate 會讓進度條繼續走、還繼續送 lyrics:sync。
      _syncDiagMark('暫停前');
      if (useSoundTouch) { try { SoundTouchEngine.pause(); } catch (e) { /* 靜默 */ } }
      if (separationActive && vocalsSTEngine) { try { vocalsSTEngine.pause(); } catch (e) { /* 靜默 */ } }
      audioPlayer.pause();
      updatePlayButton();
      SocketClient.send('play:toggle', isPlaying);
      return;
    }
    if (useSoundTouch) {
      // 高品質變調路徑：buffer 沒好就先 decode 再播
      audioPlayer.muted = true;
      audioPlayer.pause();
      // 人聲跟伴奏是平行解碼，誰先好誰不一定：點清單載入待命、幾秒內就按播放，常會撞上
      // 伴奏已經 ready、人聲還在飛的窗口。原本這裡只在「當下」isReady() 才播人聲，錯過
      // 這個瞬間就直接放棄，變成整首歌都聽不到人聲、要重新切一次歌才會恢復（使用者實測
      // 抓到：3 秒內按播放會觸發，3 秒後按或連續播放自動接歌都不會——後者走 playTrack()
      // 自己的 Promise.all，本來就會等兩邊一起好）。改成人聲沒好就等 loadVocalsFor() 記下
      // 的 promise，好了才補播，並用伴奏「當下」位置對齊，不是從頭開始。
      const startVocalsWhenReady = (sharedWf, sharedPos) => {
        if (!separationActive || !vocalsSTEngine) return;
        const startVocals = () => {
          if (!isPlaying || !vocalsSTEngine.isReady()) return; // 等待期間可能又被暫停或切了歌
          vocalsSTEngine.setPitch(currentPitchShift);
          vocalsSTEngine.setTempo(currentPlaybackRate);
          // A3/A4：人聲跟伴奏幾乎同時 ready → 沿用 startST 排的同一組 frame/位置，兩軌對齊起播。
          // 人聲晚解碼、那個 frame 已過 → 用「伴奏當下推算位置 + 一個新的近未來 frame」補播，
          // 起點才不會落在伴奏後面（舊碼用原始 getTime() 會落後約 20–40ms）。
          const now = SoundTouchEngine.frameNow ? SoundTouchEngine.frameNow() : NaN;
          const canReuse = Number.isFinite(sharedWf) && Number.isFinite(now) && sharedWf > now + 128;
          const wf = canReuse ? sharedWf : sepSharedFrame(0.06);
          const pos = canReuse
            ? sharedPos
            : (SoundTouchEngine.projectedTimeAt ? SoundTouchEngine.projectedTimeAt(0.06) : SoundTouchEngine.getTime());
          vocalsSTEngine.play(pos, wf);
          setTimeout(() => _syncDiagMark('續播後'), 200);
        };
        if (vocalsSTEngine.isReady()) { startVocals(); return; }
        if (vocalsLoadPromise) vocalsLoadPromise.then(startVocals);
      };
      const startST = () => {
        const sep = separationActive && !!vocalsSTEngine;
        // 續播時主引擎是暫停狀態，getProjectedTime() 回凍結的位置；分離時把「同一個位置 +
        // 同一個排程 frame」給伴奏/人聲兩軌，起點才 sample 對齊。非分離時 pos/wf 皆 undefined
        // → 等同舊的 SoundTouchEngine.play()（從自己凍結位置立即續播），行為不變。
        const wf = sep ? sepSharedFrame(0.09) : undefined;
        const pos = (sep && SoundTouchEngine.getProjectedTime) ? SoundTouchEngine.getProjectedTime() : undefined;
        SoundTouchEngine.setPitch(currentPitchShift);
        SoundTouchEngine.setTempo(currentPlaybackRate);
        SoundTouchEngine.play(pos, wf);
        startVocalsWhenReady(wf, pos);
        updatePlayButton(); SocketClient.send('play:toggle', true);
      };
      if (stReady) startST();
      else {
        const curTrack = state.playlist[state.currentTrackIndex];
        // 分離播放模式下伴奏軌是 instrumentalFile，不是原始 filename——這裡跟 playTrack()
        // 的 masterFilename 算法保持一致，否則重新載入時會播回帶人聲的原始混音，
        // 疊在獨立播放的人聲軌上面變成雙重人聲。
        const reloadFilename = curTrack && (separationActive ? curTrack.instrumentalFile : curTrack.filename);
        stLoadCurrent(reloadFilename).then((result) => {
          if (result === 'stale') return; // 已被更新的載入取代（多半是又切了歌），放棄這次播放
          if (!isPlaying) return; // decode 完成前又被暫停了（本地或遠端），放棄這次播放
          if (stReady) startST();
          else { audioPlayer.muted = false; initAudioProcessorOnce(); if (audioProcessorReady) applyPitchAndSpeed(); audioPlayer.play().catch((e) => handleAudioError(e)); updatePlayButton(); SocketClient.send('play:toggle', true); }
        });
      }
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
  // 同 play:track 的道理：忽略「另一個面板分頁」的廣播，否則兩個面板本地播放狀態
  // 一旦不同步（例如清單被清空重建），會無窮迴圈互送 play:toggle（實測會看到播放/暫停瞬間狂跳）。
  SocketClient.on('play:toggle', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload._originSocketId === SocketClient.getId()) return;
    if (payload._originClientType === 'controller') return;
    if (typeof payload.playing === 'boolean') requestPlayback(payload.playing);
  });

  // 上一首/下一首是「相對移動」指令，不像播放/暫停有絕對值可以拿來擋回音，
  // 所以按鍵本身只送出指令、不在本地直接換歌——一律等伺服器廣播回來才真正換歌，
  // 這樣不管指令來自面板自己、遙控器、或 Stream Deck，永遠只換一次，不會連跳兩首。
  function advanceTrack(delta) {
    const playlist = state.playlist;
    if (playlist.length === 0) return false;
    const cursorIndex = state.lastPlayedEntryId
      ? playlist.findIndex((track) => track && track.entryId === state.lastPlayedEntryId)
      : -1;
    // 單曲模式自然播畢後目前歌曲已清空：下一首從剛播完的位置往後，
    // 上一首則重播剛播完的歌曲；找不到游標時退回清單首／尾。
    const newIndex = PlaybackSequence.manualAdvance(
      state.currentTrackIndex,
      playlist.length,
      cursorIndex,
      delta,
    );
    playTrack(newIndex);
    return true;
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
    // 優先用 entryId 定位，避免同一首歌在清單裡出現不只一次時，換到後面那個重複的
    // 反而找到第一個相符的位置去播（那樣清單高亮跟實際播放的位置就對不上）。
    const idx = track.entryId != null
      ? state.playlist.findIndex((t) => t.entryId === track.entryId)
      : state.playlist.findIndex((t) => t.id === track.id);
    if (idx === -1) return;
    playTrack(idx, track.autoplay !== false);
  });

  // 另一個已連線的面板分頁播完清單最後一首：本地也要跟著清空，不能只有原分頁自己知道。
  SocketClient.on('play:stop', (payload) => {
    if (payload && Array.isArray(payload.playedEntryIds)) {
      state.playedEntryIds = new Set(payload.playedEntryIds.filter((entryId) => typeof entryId === 'string' && entryId));
    }
    if (payload && typeof payload.lastPlayedEntryId === 'string') {
      state.lastPlayedEntryId = payload.lastPlayedEntryId;
    }
    stopPlayback();
    state.currentTrackIndex = -1;
    AppShared.renderPlaylist();
  });

  audioPlayer.addEventListener('timeupdate', () => {
    // SoundTouch 生效時，時間一律以 stOnTime 為準。<audio> 在切歌/載入時仍可能吐幾次
    // timeupdate，讓兩個時間源同時寫進度條與 lyrics:sync，OBS 端就會看到歌詞來回跳。
    if (stActive()) return;
    lastPlayTimeMs = (audioPlayer.currentTime || 0) * 1000; // 給「對齊第一句」用（非 SoundTouch 路徑）
    renderHomeLyricNow();
    if (!audioPlayer.duration) return;
    setTotalTime(formatTime(audioPlayer.duration));
    if (isSeeking) return; // 拖曳中由拖曳邏輯控制進度條，避免互相打架
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    setProgressFill(progress);
    setCurrentTime(formatTime(audioPlayer.currentTime));

    const now = Date.now();
    if (now - lastSyncTime >= SYNC_INTERVAL) {
      lastSyncTime = now;
      SocketClient.send('lyrics:sync', { currentTime: audioPlayer.currentTime, duration: audioPlayer.duration || 0, trackId: currentTrackId() });
    }
  });

  // 來自遙控器的拖曳跳轉（秒）→ 套用到本地播放器（面板才是音訊來源）
  SocketClient.on('play:seek', (time) => {
    if (typeof time !== 'number' || !isFinite(time)) return;
    if (stActive()) {
      const dur = SoundTouchEngine.getDuration();
      if (dur) {
        const target = Math.max(0, Math.min(dur, time));
        {
          const wf = (separationActive && vocalsSTEngine) ? sepSharedFrame(0.05) : undefined;
          SoundTouchEngine.seek(target, wf);
          if (separationActive && vocalsSTEngine) { vocalsSTEngine.seek(target, wf); setTimeout(() => _syncDiagMark('遙控跳轉後'), 200); }
        }
      }
      return;
    }
    if (!audioPlayer.duration) return;
    // 差距夠大才套用，避免與自身發出的跳轉回音互相干擾
    if (Math.abs(audioPlayer.currentTime - time) < 0.4) return;
    audioPlayer.currentTime = Math.max(0, Math.min(audioPlayer.duration, time));
  });

  function handlePlaybackEnded() {
    const playlist = state.playlist;
    const endedTrack = playlist[state.currentTrackIndex] || null;
    const next = PlaybackSequence.nextAfterEnded(
      state.currentTrackIndex,
      playlist.length,
      continuousPlay,
    );
    if (next) {
      playTrack(next.index, next.autoplay);
      return;
    }
    // 單曲模式不論後面還有沒有歌，都要清空「正在播放」與歌詞，等待使用者主動按下一首。
    // 連續模式只有播到最後一首時會走到這裡。SoundTouch 與原生 audio 共用同一段，
    // 避免高品質變調路徑播完後漏送 play:stop，讓最後一句歌詞留在畫面上。
    markLocalTrackPlayed(endedTrack);
    stopPlayback();
    state.currentTrackIndex = -1;
    AppShared.renderPlaylist();
    SocketClient.send('play:stop', {
      reason: 'ended',
      endedEntryId: endedTrack && endedTrack.entryId ? endedTrack.entryId : null,
    });
  }

  audioPlayer.addEventListener('ended', handlePlaybackEnded);

  // Phase 5: 音訊錯誤處理
  audioPlayer.addEventListener('error', () => {
    if (suppressNextAudioError) {
      suppressNextAudioError = false;
      return;
    }
    const error = audioPlayer.error;
    if (error) {
      handleAudioError(error);
    }
  });

  function handleAudioError(error) {
    if (separationActive && vocalsSTEngine) { try { vocalsSTEngine.pause(); } catch (e) { /* 靜默 */ } } // 伴奏出錯下線時，避免人聲引擎孤兒繼續播放
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
    if (stActive()) {
      const wf = (separationActive && vocalsSTEngine) ? sepSharedFrame(0.05) : undefined;
      SoundTouchEngine.seek(t, wf);
      if (separationActive && vocalsSTEngine) {
        vocalsSTEngine.seek(t, wf);
        if (finalize) setTimeout(() => _syncDiagMark('拖曳跳轉後'), 200);
      }
    } else {
      audioPlayer.currentTime = t;
    }
    const now = Date.now();
    if (finalize || now - lastSeekBroadcast >= 60) {
      lastSeekBroadcast = now;
      SocketClient.send('play:seek', { time: t, trackId: currentTrackId() });
      // 同步推播位置：讓 OBS 顯示端即時跟著移動（暫停時也是）
      SocketClient.send('lyrics:sync', { currentTime: t, duration: dur || 0, seeking: !finalize, trackId: currentTrackId() });
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
    if (typeof renderHomeLyricNow === 'function') renderHomeLyricNow(true);
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

  // Live Bar「目前歌詞」對時視圖：顯示端判斷式 adjustedTime = audioTime + offset，
  // 某行在 adjustedTime >= line.time 時出現 → 目前句 = 最後一個 time <= lastPlayTimeMs + currentOffsetMs 的行。
  let lastLyricNowPaint = 0;
  let s2tKicked = false;
  function renderHomeLyricNow(force) {
    if (!dom.lyricNowLine) return;
    // 簡轉繁字典懶載：第一次要顯示歌詞時載入，載好重繪一次（之後同步轉換）。
    if (!s2tKicked && AppShared.lyricS2T && AppShared.lyricS2T.enabled()) {
      s2tKicked = true;
      AppShared.lyricS2T.ensure().then(() => renderHomeLyricNow(true));
    }
    const now = Date.now();
    if (!force && now - lastLyricNowPaint < 150) return;
    lastLyricNowPaint = now;
    const tr = state.playlist[state.currentTrackIndex];
    const lines = tr && Array.isArray(tr.parsedLyrics)
      ? tr.parsedLyrics.filter((l) => l && typeof l.time === 'number' && l.text)
      : [];
    if (!lines.length) {
      dom.lyricNowLine.textContent = tr ? '這首歌詞沒有時間軸' : '尚無歌詞';
      dom.lyricNowLine.classList.remove('has-word-marks');
      if (dom.lyricNextLine) dom.lyricNextLine.textContent = '';
      nowLineKey = '';
      nowLineWordEls = [];
      return;
    }
    const adjusted = lastPlayTimeMs + currentOffsetMs;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].time <= adjusted) idx = i; else break; }
    const line = idx >= 0 ? lines[idx] : lines[0];
    renderNowLineWithMarks(tr, line, idx >= 0 ? idx : 0, adjusted, idx >= 0 ? '' : '♪ ');
    if (dom.lyricNextLine) {
      dom.lyricNextLine.textContent = lines[idx + 1] ? AppShared.lyricS2T.convert(lines[idx + 1].text) : '';
    }
  }
  AppShared.renderHomeLyricNow = renderHomeLyricNow;

  // 逐字對時：目前這行「每個字下面」放一個對時點，只有真的帶時間戳的字（word 的起點字）
  // 才有點，其餘的字底下留空位對齊——照實反映歌詞的逐字顆粒度：
  //   真逐字 → 每個字都有點；以詞為單位 → 只有每個詞的第一個字有點；沒有逐字 → 純文字沒有點。
  // word.start 是相對行首的毫秒（見 karaoke.js updateWords）。整行重建只在換行時做，不是每 tick。
  let nowLineKey = '';
  let nowLineWordEls = []; // wi -> 該詞第一個字底下的點元素

  // 把 words 依序對到 line.text 的字元位置，回傳長度 = text.length 的陣列，
  // anchors[i] = 對應的 word index（該字是某個 word 的起點），沒有則 -1。
  function buildCharAnchors(text, words) {
    const anchors = new Array(text.length).fill(-1);
    let cursor = 0;
    for (let wi = 0; wi < words.length; wi++) {
      const wt = String(words[wi].text || '');
      if (!wt) continue;
      let p = text.indexOf(wt, cursor);
      if (p < 0) { // 文字對不上（KRC 偶有），退而求其次錨在游標處、跳過前導空白
        p = cursor;
        while (p < text.length && /\s/.test(text[p])) p += 1;
      }
      if (p >= 0 && p < text.length && anchors[p] === -1) anchors[p] = wi;
      cursor = Math.min(text.length, Math.max(cursor, (p < 0 ? cursor : p) + wt.length));
    }
    return anchors;
  }

  function renderNowLineWithMarks(tr, line, lineIndex, adjusted, prefix) {
    const host = dom.lyricNowLine;
    if (!host) return;
    // 簡轉繁只轉顯示；opencc cn→tw 逐字 1:1、不改長度，所以逐字對時點的位置不受影響。
    const text = AppShared.lyricS2T.convert(String(line.text || ''));
    const s2tTag = AppShared.lyricS2T.ready() && AppShared.lyricS2T.enabled() ? 't' : 's';
    const rawWords = (tr && tr.lyricsType === 'krc' && Array.isArray(line.words))
      ? line.words.filter((w) => w && typeof w.start === 'number' && String(w.text || '').trim())
      : [];
    const words = rawWords.map((w) => ({ ...w, text: AppShared.lyricS2T.convert(String(w.text || '')) }));
    if (!words.length || !text) {
      host.classList.remove('has-word-marks');
      host.textContent = prefix + text;
      nowLineKey = '';
      nowLineWordEls = [];
      return;
    }
    const key = `${currentTrackId() || ''}|${lineIndex}|${text.length}|${words.length}|${prefix}|${s2tTag}`;
    if (key !== nowLineKey) {
      nowLineKey = key;
      nowLineWordEls = new Array(words.length).fill(null);
      const anchors = buildCharAnchors(text, words);
      const frag = document.createDocumentFragment();
      if (prefix) {
        const pre = document.createElement('span');
        pre.className = 'lb-ch is-prefix';
        pre.textContent = prefix;
        frag.appendChild(pre);
      }
      for (let i = 0; i < text.length; i++) {
        const cell = document.createElement('span');
        cell.className = 'lb-ch';
        const t = document.createElement('span');
        t.className = 'lb-ch-t';
        t.textContent = text[i];
        const d = document.createElement('span');
        d.className = 'lb-ch-d';
        const wi = anchors[i];
        if (wi >= 0) {
          d.classList.add('is-anchor');
          d.dataset.wi = String(wi);
          d.setAttribute('role', 'button');
          d.title = `跳到「${String(words[wi].text).trim()}」`;
          nowLineWordEls[wi] = d;
        }
        cell.appendChild(t);
        cell.appendChild(d);
        frag.appendChild(cell);
      }
      host.textContent = '';
      host.appendChild(frag);
      host.classList.add('has-word-marks');
    }
    const base = line.time;
    let activeIdx = -1;
    for (let i = 0; i < words.length; i++) { if (adjusted >= base + words[i].start) activeIdx = i; else break; }
    for (let wi = 0; wi < nowLineWordEls.length; wi++) {
      const el = nowLineWordEls[wi];
      if (!el) continue;
      el.classList.toggle('is-sung', wi < activeIdx);
      el.classList.toggle('is-active', wi === activeIdx);
    }
  }

  // 點某個字底下的點 → seek 到那個字該出現的音訊位置（顯示端：word 出現於 audioTime + offset
  // >= line.time + word.start，所以 audioTime = line.time + word.start - offset），方便逐字細調。
  if (dom.lyricNowLine) {
    dom.lyricNowLine.addEventListener('click', (event) => {
      const dot = event.target.closest?.('.lb-ch-d.is-anchor');
      if (!dot) return;
      const wi = Number(dot.dataset.wi);
      const tr = state.playlist[state.currentTrackIndex];
      const lines = tr && Array.isArray(tr.parsedLyrics)
        ? tr.parsedLyrics.filter((l) => l && typeof l.time === 'number' && l.text)
        : [];
      if (!lines.length) return;
      const adjusted = lastPlayTimeMs + currentOffsetMs;
      let idx = -1;
      for (let i = 0; i < lines.length; i++) { if (lines[i].time <= adjusted) idx = i; else break; }
      const line = lines[idx >= 0 ? idx : 0];
      const w = line && Array.isArray(line.words) ? line.words[wi] : null;
      if (!w || typeof w.start !== 'number') return;
      seekLoadedTrack(Math.max(0, (line.time + w.start - currentOffsetMs) / 1000));
      renderHomeLyricNow(true);
    });
  }

  // 倒數對齊：從第一句前約 5 秒開始播放並倒數，把「聽到第一個字」這一刻交回給使用者手動按
  // 「對齊第一句」——不自動改 offset，因為解析出來的時間軸常常本來就是歪的。
  const COUNTDOWN_LEAD_S = 10;
  let countdownTimer = null;
  function resetCountdownBox() {
    if (!dom.countdownAlignBox) return;
    dom.countdownAlignBox.classList.remove('is-running');
    if (dom.countdownNumber) dom.countdownNumber.textContent = String(COUNTDOWN_LEAD_S);
  }
  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    resetCountdownBox();
    if (dom.offsetAlign) dom.offsetAlign.classList.remove('is-cue');
  }
  function countdownAlign() {
    const tr = state.playlist[state.currentTrackIndex];
    if (!tr) { AppShared.showToast('沒有正在播放的歌曲'); return; }
    const tFirstRaw = firstLineTimeMs();
    if (tFirstRaw == null) { AppShared.showToast('這首歌詞沒有時間軸，無法倒數對齊', 'error'); return; }
    // 用「已套用偏移後」的實際出現時間當基準：顯示端 adjustedTime = audioTime + offset，
    // 第一句在 audioTime = tFirst − offset 出現。若用原始 tFirst，對已校準過的歌，倒數 0
    // 就整整差一個 offset，複查偏移毫無意義。
    const tFirst = tFirstRaw - currentOffsetMs;
    stopCountdown();
    seekLoadedTrack(Math.max(0, tFirst / 1000 - COUNTDOWN_LEAD_S));
    if (!isPlaying) requestPlayback(true);
    if (dom.countdownAlignBox) dom.countdownAlignBox.classList.add('is-running');
    if (dom.countdownNumber) dom.countdownNumber.textContent = String(COUNTDOWN_LEAD_S);
    countdownTimer = setInterval(() => {
      const remain = (tFirst - lastPlayTimeMs) / 1000;
      if (remain > 0.05) {
        if (dom.countdownNumber) dom.countdownNumber.textContent = String(Math.min(COUNTDOWN_LEAD_S, Math.ceil(remain)));
      } else {
        clearInterval(countdownTimer); countdownTimer = null;
        if (dom.countdownNumber) dom.countdownNumber.textContent = '▶';
        if (dom.offsetAlign) dom.offsetAlign.classList.add('is-cue');
        setTimeout(resetCountdownBox, 800);
        setTimeout(() => { if (dom.offsetAlign) dom.offsetAlign.classList.remove('is-cue'); }, 6000);
      }
    }, 100);
  }
  if (dom.countdownAlignBox) dom.countdownAlignBox.addEventListener('click', countdownAlign);
  if (dom.offsetAlign) dom.offsetAlign.addEventListener('click', stopCountdown);

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

  // 滑桿本身的填色軌道（--range-fill，CSS 見 panel.css）＋伴奏音量圖示的音波狀態
  // （靜音/低/高，像 Windows 音量混音器）：使用者實測回報純色軌道「看不出音量高低，
  // 只能看數字」，圖示原本又只有喇叭外殼、沒有音波，永遠看起來像沒聲音。
  function updateRangeFill(el) {
    if (!el) return;
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 100;
    const pct = max > min ? ((parseFloat(el.value) - min) / (max - min)) * 100 : 0;
    el.style.setProperty('--range-fill', `${Math.max(0, Math.min(100, pct))}%`);
  }
  function updateVolumeIconLevel(pct) {
    if (!dom.volumeRow) return;
    dom.volumeRow.dataset.level = pct <= 0 ? 'muted' : pct < 50 ? 'low' : 'high';
  }

  if (dom.volumeSlider) {
    // 初始化：讀取 AudioProcessor 記住的音量（預設 70%）
    let initVol = 0.7;
    if (typeof AudioProcessor !== 'undefined' && AudioProcessor.getVolume) {
      initVol = AudioProcessor.getVolume();
    }
    dom.volumeSlider.value = Math.round(initVol * 100);
    if (dom.volumeVal) dom.volumeVal.textContent = Math.round(initVol * 100) + '%';
    updateRangeFill(dom.volumeSlider);
    updateVolumeIconLevel(Math.round(initVol * 100));
    // 套用初始音量到 audio 元素（AudioProcessor 尚未初始化前的後備）
    audioPlayer.volume = initVol;

    dom.volumeSlider.addEventListener('input', () => {
      const vol = parseInt(dom.volumeSlider.value, 10) / 100;
      if (dom.volumeVal) dom.volumeVal.textContent = dom.volumeSlider.value + '%';
      updateRangeFill(dom.volumeSlider);
      updateVolumeIconLevel(parseInt(dom.volumeSlider.value, 10));
      // 不論降級鏈是否已初始化，都交給 AudioProcessor 記住音量；SoundTouch 常在
      // 它之前就可播放，若只在 ready 後呼叫會造成「這次聽得到、重開又回 70%」。
      if (typeof AudioProcessor !== 'undefined' && AudioProcessor.setVolume) {
        AudioProcessor.setVolume(vol);
      }
      // AudioProcessor 尚未接管 audio 元素時，保留原生音量作為立即可用的後備。
      if (!audioProcessorReady) {
        audioPlayer.volume = vol;
      }
      // 高品質變調的獨立輸出鏈也要跟著調音量
      if (stGain) { try { stGain.gain.value = vol; } catch (e) { /* 靜默 */ } }
    });
  }

  if (dom.normalizationToggle) {
    if (typeof AudioProcessor !== 'undefined' && AudioProcessor.isNormalizationEnabled) {
      dom.normalizationToggle.checked = AudioProcessor.isNormalizationEnabled();
    }
    dom.normalizationToggle.addEventListener('change', () => {
      if (typeof AudioProcessor !== 'undefined' && AudioProcessor.setNormalization) {
        AudioProcessor.setNormalization(dom.normalizationToggle.checked);
      }
      reapplyTrackLoudness();
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
  AppShared.reapplyTrackLoudness = reapplyTrackLoudness;
  AppShared.advanceTrack = advanceTrack;
  AppShared.restorePlaybackState = restorePlaybackState;
  AppShared.setDualAudioMode = setDualAudioMode;
  AppShared.setDualAudioDevices = setDualAudioDevices;
  AppShared.setDualAudioSyncOffset = setDualAudioSyncOffset;
  AppShared.setDualAudioHeadphoneVolume = setDualAudioHeadphoneVolume;
  AppShared.setDualAudioStreamVolume = setDualAudioStreamVolume;
  AppShared.getDualAudioState = getDualAudioState;
  AppShared.startDualAudioClickTest = startDualAudioClickTest;   // test7：點擊對時
  AppShared.stopDualAudioClickTest = stopDualAudioClickTest;
  AppShared.isDualAudioClickTestRunning = isDualAudioClickTestRunning;
})();
