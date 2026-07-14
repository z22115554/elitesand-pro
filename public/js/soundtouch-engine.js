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
 */
const SoundTouchEngine = (() => {
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

  function _destroyNode() {
    if (node) {
      try { node.port.onmessage = null; } catch (e) {}
      try { node.disconnect(); } catch (e) {}
      node = null;
    }
  }

  function _onNodeMessage(msg) {
    if (!msg) return;
    if (msg.type === 'position') {
      if (typeof msg.position === 'number') lastPositionSec = msg.position / sampleRate;
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
        try { newNode.disconnect(); } catch (e) {}
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

  function play(offsetSec) {
    if (!ready || !node) return false;
    const sec = (offsetSec != null) ? offsetSec : lastPositionSec;
    lastPositionSec = Math.max(0, Math.min(sec, durationSec));
    _post({ type: 'play', position: Math.round(lastPositionSec * sampleRate) });
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

  function seek(sec) {
    const target = Math.max(0, Math.min(sec, durationSec));
    lastPositionSec = target;
    _post({ type: 'seek', position: Math.round(target * sampleRate) });
  }

  function getTime() { return lastPositionSec; }
  function getDuration() { return durationSec; }
  function isPlaying() { return playing; }
  function isReady() { return ready; }

  function setPitch(semitones) {
    const v = Math.max(-12, Math.min(12, semitones));
    if (v === pitchSemis) return;
    pitchSemis = v;
    _post({ type: 'pitch', value: v });   // 即時生效，無重算等待
  }
  function setTempo(rate) {
    const v = Math.max(0.5, Math.min(1.5, rate));
    if (v === tempoRate) return;
    tempoRate = v;
    _post({ type: 'tempo', value: v });
  }
  function onTime(cb) { onTimeCb = cb; }
  function onEnded(cb) { onEndedCb = cb; }

  const api = {
    ensureModule, attach, load, play, pause, stop, seek,
    getTime, getDuration, isPlaying, isReady, setPitch, setTempo, onTime, onEnded,
  };
  try { window.SoundTouchEngine = api; } catch (e) {}
  return api;
})();
