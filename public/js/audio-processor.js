/**
 * Elitesand Pro Audio Processor Module v1 (Phase 7)
 * 獨立調 Key 與加減速功能
 *
 * 技術方案（2026-06 修正機器人聲）：
 * - 變速：audio.playbackRate + preservesPitch=true → 瀏覽器原生「保持音高時間伸縮」，
 *   音質佳、不機器人聲。純變速時完全不經過 PitchShift。
 * - 變調：Tone.js PitchShift 只套用使用者的移調量（userPitch），
 *   不再用 -12*log2(rate) 補償變速（瀏覽器已保持音高，再補償會雙重校正→金屬聲）。
 *
 * 降級方案：
 * - 若 Tone.js 未載入，變調停用；變速仍由瀏覽器 preservesPitch 保持音高
 * - 不影響基本播放功能
 */
const AudioProcessor = (() => {
  let audioContext = null;
  let mediaSource = null;
  let pitchShift = null;
  let gainNode = null;
  let trackGainNode = null;   // 統一音量：每首歌的響度校正增益（-14 LUFS 對齊）
  let compressorNode = null;  // 響度標準化壓縮器
  let makeupGain = null;      // 壓縮後補償增益
  let dryGain = null;         // 乾訊號（原調）增益：變調時設 0，杜絕原調洩漏
  let wetGain = null;         // 濕訊號（變調後）增益：不變調時設 0，避免 granular 拖影
  let initialized = false;
  let toneAvailable = false;

  // 使用者設定的音高偏移（半音），-12 ~ +12
  let userPitch = 0;
  // 當前播放速率，0.5 ~ 1.5
  let playbackRate = 1.0;
  // 音量（0 ~ 1）。預設 0.7,避免瀏覽器音訊一開啟就過大
  let volume = 0.7;
  try {
    const savedVol = localStorage.getItem('vk-volume');
    if (savedVol !== null) {
      const v = parseFloat(savedVol);
      if (isFinite(v) && v >= 0 && v <= 1) volume = v;
    }
  } catch (e) { /* localStorage 不可用時維持預設 */ }
  // 統一音量：當前歌曲的實測響度（LUFS）；null＝未量測 → 不調整
  let currentTrackLufs = null;
  // 響度標準化開關（預設開啟，可由 localStorage 記憶）
  let normalizationEnabled = true;
  try {
    const saved = localStorage.getItem('vk-normalization');
    if (saved !== null) normalizationEnabled = saved === 'true';
  } catch (e) { /* localStorage 不可用時維持預設 */ }

  // ─── 響度標準化參數 ───
  // 中等強度的「自動音量平衡」設定：
  // 把本地檔與 YT 音源之間的響度落差壓平，又不至於把動態壓死
  const NORM_ON = {
    threshold: -28, // dB，超過此值開始壓縮
    knee: 25,       // 軟拐點，壓縮介入更平滑
    ratio: 4,       // 4:1 壓縮比
    attack: 0.005,  // 5ms 快速反應避免突波
    release: 0.25,  // 250ms 釋放避免抽吸感
    makeup: 1.3,    // 約 +2.3dB 補償增益
  };
  // 「關閉」= 完全透明（ratio 1:1 不壓縮、無補償）
  const NORM_OFF = {
    threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25, makeup: 1.0,
  };

  /**
   * 套用響度標準化參數到壓縮器節點
   */
  function applyNormalizationParams() {
    if (!compressorNode || !makeupGain || !audioContext) return;
    const p = normalizationEnabled ? NORM_ON : NORM_OFF;
    const t = audioContext.currentTime;
    try {
      compressorNode.threshold.setValueAtTime(p.threshold, t);
      compressorNode.knee.setValueAtTime(p.knee, t);
      compressorNode.ratio.setValueAtTime(p.ratio, t);
      compressorNode.attack.setValueAtTime(p.attack, t);
      compressorNode.release.setValueAtTime(p.release, t);
      makeupGain.gain.setValueAtTime(p.makeup, t);
    } catch (e) {
      // 部分舊瀏覽器不支援 setValueAtTime 的 AudioParam，直接賦值
      compressorNode.threshold.value = p.threshold;
      compressorNode.knee.value = p.knee;
      compressorNode.ratio.value = p.ratio;
      compressorNode.attack.value = p.attack;
      compressorNode.release.value = p.release;
      makeupGain.gain.value = p.makeup;
    }
  }

  /**
   * 初始化音訊處理管線
   * 訊號鏈：source → trackGain（統一音量）→ gain（音量）→ compressor（響度標準化）→ makeupGain → [PitchShift] → destination
   * @param {HTMLAudioElement} audioElement - 要處理的 audio 元素
   * @returns {boolean} 是否成功初始化 Tone.js 管線
   */
  function init(audioElement) {
    if (initialized) return toneAvailable;

    // 檢查 Tone.js 是否可用
    toneAvailable = typeof Tone !== 'undefined' && Tone.PitchShift;

    try {
      if (toneAvailable) {
        // 啟動 Tone.js AudioContext（需要使用者互動）
        if (Tone.context.state === 'suspended') {
          Tone.start();
        }
        audioContext = Tone.context.rawContext || Tone.context;
      } else {
        // Tone.js 不可用：建立原生 WebAudio 降級鏈
        // 變調功能停用，但音量控制與響度標準化仍然有效
        console.warn('[AudioProcessor] Tone.js 不可用，變調停用（保留變速 + 響度標準化）');
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
          initialized = true;
          return false;
        }
        audioContext = new Ctx();
        if (audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
      }

      // 變速採用瀏覽器內建的「保持音高時間伸縮」(preservesPitch=true，現代瀏覽器預設值)，
      // 音質遠勝 granular PitchShift。如此一來：
      //   - 純變速（不變調）：完全走瀏覽器原生伸縮 → 乾淨、不機器人聲
      //   - 變調：才用 PitchShift，且只處理使用者的「移調」量，不再重複補償變速
      // 注意：原本程式假設 playbackRate 會改變音高並用 PitchShift 補償，
      // 但瀏覽器其實已保持音高，導致雙重校正 → 金屬/機器人聲。
      try {
        audioElement.preservesPitch = true;
        audioElement.mozPreservesPitch = true;
        audioElement.webkitPreservesPitch = true;
      } catch (e) { /* 部分瀏覽器無此屬性，忽略 */ }

      // 從 audio 元素建立 MediaElementAudioSourceNode
      // 注意：每個 audio 元素只能呼叫一次
      mediaSource = audioContext.createMediaElementSource(audioElement);

      // 建立 GainNode 控制音量（使用 createMediaElementSource 後，audio.volume 會失效）
      gainNode = audioContext.createGain();
      gainNode.gain.value = volume;

      // 建立響度標準化壓縮器 + 補償增益
      compressorNode = audioContext.createDynamicsCompressor();
      makeupGain = audioContext.createGain();
      applyNormalizationParams();

      // 統一音量：每首歌的響度校正（先於使用者音量，讓音量滑桿語義不變）
      trackGainNode = audioContext.createGain();
      applyTrackGain();

      // 基礎鏈：source → trackGain（統一音量）→ gain → compressor → makeup
      mediaSource.connect(trackGainNode);
      trackGainNode.connect(gainNode);
      gainNode.connect(compressorNode);
      compressorNode.connect(makeupGain);

      // ─── 乾/濕兩條輸出（恆接，靠增益交叉，不做斷線重接）───
      // 這是「雙重聲音」的根治：變調時 dryGain=0 → 原調訊號「不可能」洩漏；
      // 不變調時 wetGain=0 → PitchShift 的 granular 拖影也不會混進來。
      dryGain = audioContext.createGain();
      wetGain = audioContext.createGain();
      makeupGain.connect(dryGain);
      dryGain.connect(audioContext.destination);

      if (toneAvailable) {
        pitchShift = new Tone.PitchShift({
          pitch: 0,
          windowSize: 0.05, // 較小視窗→較少 granular 疊音/拖影
          delayTime: 0,
          feedback: 0,
          wet: 1,
        });
        try { pitchShift.wet.value = 1; } catch (e) { /* 靜默 */ }
        // makeup → pitchShift → wetGain → destination（恆接）
        try {
          if (typeof Tone.connect === 'function') Tone.connect(makeupGain, pitchShift);
          else makeupGain.connect(pitchShift.input);
          pitchShift.connect(wetGain);
        } catch (e) {
          console.warn('[AudioProcessor] PitchShift 接線失敗，變調停用:', e.message);
          toneAvailable = false;
        }
        wetGain.connect(audioContext.destination);
      }

      // 依當前 pitch 設定乾/濕增益（預設 pitch=0 → 乾=1、濕=0）
      routeChain();

      initialized = true;
      console.log(`[AudioProcessor] 初始化完成（${toneAvailable ? 'Tone.js 管線' : '原生降級管線'}，響度標準化: ${normalizationEnabled ? '開' : '關'}）`);
      return toneAvailable;
    } catch (err) {
      console.error('[AudioProcessor] 初始化失敗，降級為純 playbackRate 模式:', err.message);
      toneAvailable = false;
      initialized = true;
      return false;
    }
  }

  // 目前訊號是否正繞經 PitchShift（用來避免重複接線）
  let pitchEngaged = false;

  /**
   * 依目前是否需要變調，交叉乾/濕增益（不斷線重接）。
   * 變調時 dry=0（原調絕不洩漏）、wet=1；不變調時 dry=1、wet=0（避免 granular 拖影）。
   * 用 setTargetAtTime 做短暫淡入淡出，避免切換爆音。
   */
  function routeChain() {
    if (!dryGain || !audioContext) return;
    const needPitch = toneAvailable && pitchShift && Math.abs(getEffectivePitch()) > 0.01;
    const t = audioContext.currentTime;
    const tc = 0.015; // 時間常數，約 ~45ms 完成淡變
    try {
      dryGain.gain.setTargetAtTime(needPitch ? 0 : 1, t, tc);
      if (wetGain) wetGain.gain.setTargetAtTime(needPitch ? 1 : 0, t, tc);
    } catch (e) {
      dryGain.gain.value = needPitch ? 0 : 1;
      if (wetGain) wetGain.gain.value = needPitch ? 1 : 0;
    }
    pitchEngaged = needPitch;
  }

  /**
   * 計算實際要套用的音高（半音）。
   * 因為 audio.preservesPitch=true 時瀏覽器變速已自動保持音高，
   * 這裡只需套用使用者的「移調」量，不再做變速補償（否則會雙重校正成機器人聲）。
   */
  function getEffectivePitch() {
    return userPitch;
  }

  /**
   * 更新 PitchShift 的實際音高偏移值
   * 公式：totalPitch = userPitch - 12 * log2(playbackRate)
   */
  function updatePitchShift() {
    if (!toneAvailable) return;

    const totalPitch = getEffectivePitch();
    // 限制在合理範圍內（±24 半音以內避免嚴重失真）
    const clampedPitch = Math.max(-24, Math.min(24, totalPitch));

    if (pitchShift) {
      pitchShift.pitch = clampedPitch;
    }

    // 若「是否需要變調」的狀態改變了（跨越 0），重新路由訊號鏈
    const needPitch = pitchShift && Math.abs(clampedPitch) > 0.01;
    if (needPitch !== pitchEngaged) {
      routeChain();
    }
  }

  /**
   * 設定使用者音高偏移（變調）
   * @param {number} semitones - 半音數，-12 ~ +12
   */
  function setPitch(semitones) {
    userPitch = Math.max(-12, Math.min(12, semitones));
    updatePitchShift();
  }

  /**
   * 設定播放速率（變速）
   * 注意：呼叫端需自行設定 audio.playbackRate
   * @param {number} rate - 播放速率，0.5 ~ 1.5
   */
  function setRate(rate) {
    playbackRate = Math.max(0.5, Math.min(1.5, rate));
    updatePitchShift();
  }

  /**
   * 設定音量
   * @param {number} value - 音量 0 ~ 1
   */
  function setVolume(value) {
    volume = Math.max(0, Math.min(1, value));
    if (gainNode) {
      gainNode.gain.value = volume;
    }
    try { localStorage.setItem('vk-volume', String(volume)); } catch (e) { /* 靜默 */ }
  }

  /** 統一音量：目前這首歌要套用的增益（dB）。關閉標準化或沒有量測值＝0。 */
  function getTrackGainDb() {
    if (!normalizationEnabled || typeof LoudnessGain === 'undefined') return 0;
    return LoudnessGain.computeTrackGainDb(currentTrackLufs);
  }

  function applyTrackGain() {
    if (!trackGainNode) return;
    const db = getTrackGainDb();
    trackGainNode.gain.value = (typeof LoudnessGain !== 'undefined') ? LoudnessGain.dbToLinear(db) : 1;
  }

  /**
   * 統一音量：設定當前歌曲的實測響度（LUFS，由伺服器量測、track.loudnessLufs 帶來）。
   * @param {number|null} lufs - null＝未量測，維持原音量
   */
  function setTrackLoudness(lufs) {
    currentTrackLufs = (typeof lufs === 'number' && isFinite(lufs)) ? lufs : null;
    applyTrackGain();
  }

  /**
   * 開關響度標準化（自動音量平衡）
   * @param {boolean} enabled
   */
  function setNormalization(enabled) {
    normalizationEnabled = !!enabled;
    try { localStorage.setItem('vk-normalization', String(normalizationEnabled)); } catch (e) { /* 靜默 */ }
    applyNormalizationParams();
    applyTrackGain();
    console.log(`[AudioProcessor] 響度標準化: ${normalizationEnabled ? '開' : '關'}`);
  }

  function isNormalizationEnabled() { return normalizationEnabled; }

  /**
   * 重置所有音訊處理參數
   */
  function reset() {
    userPitch = 0;
    playbackRate = 1.0;
    if (pitchShift) {
      pitchShift.pitch = 0;
    }
    if (gainNode) {
      gainNode.gain.value = 1.0;
    }
  }

  function isInitialized() { return initialized; }
  function isToneAvailable() { return toneAvailable; }
  function getUserPitch() { return userPitch; }
  function getPlaybackRate() { return playbackRate; }
  function getVolume() { return volume; }

  // 除錯用：回報乾/濕增益實際值，用來驗證「變調時乾訊號=0、不變調時濕訊號=0」
  function getRoutingState() {
    return {
      initialized,
      toneAvailable,
      pitchEngaged,
      dry: dryGain ? Number(dryGain.gain.value.toFixed(3)) : null,
      wet: wetGain ? Number(wetGain.gain.value.toFixed(3)) : null,
      trackGainDb: Number(getTrackGainDb().toFixed(2)),
      trackLufs: currentTrackLufs,
      userPitch,
    };
  }

  const api = {
    init,
    setPitch,
    setRate,
    setVolume,
    getVolume,
    setTrackLoudness,
    getTrackGainDb,
    setNormalization,
    isNormalizationEnabled,
    reset,
    isInitialized,
    isToneAvailable,
    getUserPitch,
    getPlaybackRate,
    getRoutingState,
  };
  // 暴露到 window 供除錯/驗證（不影響既有 app.js 直接引用同名 const）
  try { window.AudioProcessor = api; } catch (e) { /* 非瀏覽器環境忽略 */ }
  return api;
})();
