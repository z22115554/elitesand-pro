/**
 * SoundTouchEngine — 高品質變調/變速播放引擎（SoundTouch/WSOLA，AudioWorklet 即時版）
 *
 * 演進歷程（為什麼是現在這版）：
 *  1) 最初用 soundtouchjs `PitchShifter`(底層 ScriptProcessorNode)，跑在「主執行緒」即時拉取。
 *     主執行緒被 GSAP 歌詞動畫/粒子佔住時趕不上音訊 deadline → underrun → 偶發「啵啵」電流爆音；
 *     加大 buffer 反而更糟（單次運算量加倍、更易 underrun）。
 *  2) 改「離線預渲染」（整首先算成 AudioBuffer 再播）→ 爆音根治，但切移調要整首重算、主執行緒卡頓、
 *     且有等待。使用者要的是「即時 + 無爆音」。
 *  3) 本版＝AudioWorklet：把 SoundTouch 演算法搬到「音訊執行緒」即時跑（`/vendor/soundtouch-worklet.js`）。
 *     → 不受主執行緒卡頓影響＝無爆音；改 pitch/tempo 只是 postMessage＝即時生效、零重算等待。
 *
 * 對外介面與舊版相同（attach/load/play/pause/stop/seek/getTime/getDuration/isPlaying/isReady/
 * setPitch/setTempo/onTime/onEnded），時間一律以「原曲秒數」表示（worklet 回報 sourcePosition）。
 * 任一步驟失敗（worklet 不支援/decode 失敗）一律回傳 false，呼叫端降級回 <audio>+Tone。
 *
 * 2026-08-23：singleton → factory。AI 分離播放模式要讓人聲/伴奏各自獨立變調變速（兩軌各跑
 * 一份 WSOLA，共用同一個 AudioContext、各自的 AudioWorkletNode——worklet processor 本體
 * 完全不用改，AudioWorkletNode 本來就支援同一個 context 掛多個獨立 instance，只有這層 JS
 * wrapper 原本是模組級單例，需要能生第二份）。`window.SoundTouchEngine` 仍是預設那一份，
 * 一般（非分離）單軌播放的所有既有呼叫點完全不用改；分離播放模式再呼叫
 * `window.createSoundTouchEngine()` 額外生一份給人聲用。
 */
function createSoundTouchEngine() {
  let ctx = null;
  let outNode = null;            // 呼叫端提供的接點（音量鏈入口）
  let moduleAdded = false;
  let moduleFailed = false;

  let node = null;               // 當前的 AudioWorkletNode
  let durationSec = 0;
  let sampleRate = 44100;

  let pitchSemis = 0;
  let tempoRate = 1;

  let playing = false;
  let ready = false;             // 當前歌的 buffer 是否已送進 worklet
  let lastPositionSec = 0;       // worklet 最近回報的原曲秒數
  let lastPositionWallMs = 0;    // 上一次收到 position 回報時的 wall clock（給 getProjectedTime 推算用）
  let lastPositionFrame = 0;     // SYNCDIAG：該次回報時的 AudioContext currentFrame
  let stallCount = 0, stallMaxGap = 0; // SYNCDIAG：worklet 累計的音訊執行緒卡頓

  let timer = null;
  let loadToken = 0;             // 載入世代：晚到的舊載入會被作廢，避免孤兒節點繼續播放
  let onTimeCb = null;
  let onEndedCb = null;

  async function ensureModule() {
    if (moduleAdded) return true;
    if (moduleFailed || !ctx || !ctx.audioWorklet) { moduleFailed = true; return false; }
    try {
      await ctx.audioWorklet.addModule('/vendor/soundtouch-worklet.js');
      moduleAdded = true;
      return true;
    } catch (e) {
      console.warn('[SoundTouch] AudioWorklet 模組載入失敗，降級:', e.message);
      moduleFailed = true;
      return false;
    }
  }

  /** 用呼叫端的 AudioContext 與輸出接點初始化 */
  function attach(audioContext, outputNode) {
    ctx = audioContext;
    outNode = outputNode;
    sampleRate = audioContext.sampleRate || 44100;
  }

  function _stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function _startTimer() {
    if (timer) return;
    timer = setInterval(() => { if (onTimeCb) onTimeCb(getTime()); }, 60);
  }

  // AudioWorklet 會持有整首已解碼的 PCM buffer。單純 disconnect 不保證處理器會立刻
  // 釋放它；切歌與完全停止時都必須明確通知、關閉舊 MessagePort，避免長時間播放把每首歌
  // 的 raw audio 留在 renderer/worklet 記憶體裡。
  function _releaseNode(target) {
    if (!target) return;
    try { target.port.postMessage({ type: 'dispose' }); } catch (e) {}
    try { target.port.onmessage = null; } catch (e) {}
    try { target.port.close(); } catch (e) {}
    try { target.disconnect(); } catch (e) {}
  }

  function _destroyNode() {
    if (!node) return;
    _releaseNode(node);
    node = null;
  }

  function _nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function _onNodeMessage(msg) {
    if (!msg) return;
    if (msg.type === 'position') {
      if (typeof msg.position === 'number') { lastPositionSec = msg.position / sampleRate; lastPositionWallMs = _nowMs(); }
      if (typeof msg.frame === 'number') lastPositionFrame = msg.frame;            // SYNCDIAG
      if (typeof msg.stallCount === 'number') { stallCount = msg.stallCount; stallMaxGap = msg.stallMaxGap || 0; } // SYNCDIAG
    } else if (msg.type === 'ended') {
      playing = false;
      lastPositionSec = durationSec;
      _stopTimer();
      if (onEndedCb) onEndedCb();
    }
  }

  /**
   * 載入並 decode 音檔，把整首 channel data transfer 進 worklet。回傳是否成功。
   */
  async function load(url) {
    if (!ctx || !outNode) return false;
    if (!(await ensureModule())) return false;
    const myToken = ++loadToken; // 作廢任何更早、尚未完成的載入
    try {
      // 立刻停掉並銷毀現有節點，確保切歌時舊聲音馬上停、不會變孤兒繼續播放
      stop();
      _destroyNode();
      ready = false;

      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arr);
      // 解碼期間若有更新的 load 進來，這次就作廢（避免兩個節點都接上 → 舊歌停不掉）
      if (myToken !== loadToken) return false;

      durationSec = audioBuf.duration;
      sampleRate = audioBuf.sampleRate;

      // 複製出可 transfer 的 channel data（直接 transfer getChannelData 會破壞 AudioBuffer）。
      const left = audioBuf.getChannelData(0).slice();
      const right = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1).slice() : left.slice();

      const newNode = new AudioWorkletNode(ctx, 'soundtouch-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      // 建立節點後再次確認仍是最新載入；否則銷毀剛建的節點、不要接上輸出
      if (myToken !== loadToken) {
        _releaseNode(newNode);
        return false;
      }
      newNode.port.onmessage = (e) => _onNodeMessage(e.data);
      newNode.connect(outNode);
      // 把整首資料一次送進去（transfer，零複製到 worklet）+ 帶上目前 pitch/tempo
      newNode.port.postMessage(
        { type: 'load', left, right, sampleRate, duration: durationSec, pitchSemitones: pitchSemis, tempo: tempoRate },
        [left.buffer, right.buffer]
      );
      node = newNode;
      ready = true;
      playing = false;
      lastPositionSec = 0;
      return true;
    } catch (e) {
      console.warn('[SoundTouch] 載入失敗，降級:', e.message);
      if (myToken === loadToken) { _destroyNode(); ready = false; }
      return false;
    }
  }

  function _post(msg) { if (node) { try { node.port.postMessage(msg); } catch (e) {} } }
  function _withFrame(msg, atFrame) { if (Number.isFinite(atFrame)) msg.applyAtFrame = atFrame; return msg; }

  // 目前 AudioContext 時間換算成 sample frame。分離播放時，主執行緒用「主引擎算出的
  // 一個 frame」同時發給伴奏/人聲兩個引擎（見 app-playback.js sepSharedFrame），
  // 兩軌的 play/seek/pitch/tempo 就會在同一個 render quantum 生效。
  function scheduleFrame(lookaheadSec) {
    if (!ctx) return NaN;
    return Math.ceil((ctx.currentTime + (lookaheadSec || 0)) * sampleRate);
  }
  function frameNow() { return ctx ? Math.round(ctx.currentTime * sampleRate) : 0; }

  // worklet 每 ~23ms 才回報一次位置；播放中要「現在到底播到哪」時用線性推算補足。
  // 位置以原曲秒數計，播放中每 wall 秒前進約 tempoRate（變調不影響原曲時間軸推進速率）。
  function getProjectedTime() {
    if (!playing || !lastPositionWallMs) return lastPositionSec;
    const dt = Math.max(0, _nowMs() - lastPositionWallMs) / 1000;
    return Math.max(0, Math.min(durationSec, lastPositionSec + dt * (tempoRate || 1)));
  }
  function projectedTimeAt(lookaheadSec) {
    return Math.max(0, Math.min(durationSec, getProjectedTime() + (lookaheadSec || 0) * (tempoRate || 1)));
  }

  // SYNCDIAG：給主執行緒算「兩軌 sample 級真 Δ」用。position/frame 皆以 sample 計；
  // 兩引擎同 context ⇒ frame 同步遞增，(position − frame×rate) 在 rate 不變時每軌為常數、
  // 同步時兩軌相等。免受 23ms 回報抖動影響。
  function getSyncSample() {
    return { position: Math.round(lastPositionSec * sampleRate), frame: lastPositionFrame, rate: tempoRate || 1 };
  }
  function getStallStats() { return { count: stallCount, maxGapFrames: stallMaxGap }; }

  function play(offsetSec, atFrame) {
    if (!ready || !node) return false;
    const sec = (offsetSec != null) ? offsetSec : lastPositionSec;
    lastPositionSec = Math.max(0, Math.min(sec, durationSec));
    lastPositionWallMs = _nowMs();
    _post(_withFrame({ type: 'play', position: Math.round(lastPositionSec * sampleRate) }, atFrame));
    playing = true;
    _startTimer();
    return true;
  }

  function pause() {
    _post({ type: 'pause' });
    playing = false;
    _stopTimer();
  }

  function stop() {
    _post({ type: 'pause' });
    _post({ type: 'seek', position: 0 });
    playing = false;
    lastPositionSec = 0;
    _stopTimer();
  }

  // 和 stop 的差別是：stop 保留當前歌供使用者立即重播；dispose 只在真正卸載歌曲時使用，
  // 釋放 worklet 內保存的完整 PCM buffer。
  function dispose() {
    ++loadToken;
    _stopTimer();
    _destroyNode();
    ready = false;
    playing = false;
    durationSec = 0;
    lastPositionSec = 0;
  }

  function seek(sec, atFrame) {
    const target = Math.max(0, Math.min(sec, durationSec));
    lastPositionSec = target;
    lastPositionWallMs = _nowMs();
    _post(_withFrame({ type: 'seek', position: Math.round(target * sampleRate) }, atFrame));
  }

  function getTime() { return lastPositionSec; }
  function getDuration() { return durationSec; }
  function isPlaying() { return playing; }
  function isReady() { return ready; }

  function setPitch(semitones, atFrame) {
    const v = Math.max(-12, Math.min(12, semitones));
    if (v === pitchSemis) return;
    pitchSemis = v;
    _post(_withFrame({ type: 'pitch', value: v }, atFrame));   // 即時生效，無重算等待
  }
  function setTempo(rate, atFrame) {
    const v = Math.max(0.5, Math.min(1.5, rate));
    if (v === tempoRate) return;
    tempoRate = v;
    _post(_withFrame({ type: 'tempo', value: v }, atFrame));
  }
  function onTime(cb) { onTimeCb = cb; }
  function onEnded(cb) { onEndedCb = cb; }

  const api = {
    ensureModule, attach, load, play, pause, stop, dispose, seek,
    getTime, getDuration, isPlaying, isReady, setPitch, setTempo, onTime, onEnded,
    scheduleFrame, frameNow, getProjectedTime, projectedTimeAt,
    getSyncSample, getStallStats,
  };
  return api;
}

try {
  window.createSoundTouchEngine = createSoundTouchEngine;
  window.SoundTouchEngine = createSoundTouchEngine();
} catch (e) { /* 靜默 */ }
