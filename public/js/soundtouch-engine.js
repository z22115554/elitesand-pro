/**
 * 即時變調與變速，沿用 SoundTouchEngine 的播放介面與原曲秒數時鐘。
 * 音訊在 AudioWorklet 處理，避免主執行緒卡頓爆音與離線重算整首歌的等待。
 * Signalsmith 初始化失敗時使用原 SoundTouch DSP，worklet 或解碼失敗時交給既有播放備援。
 */
const pitchWorkletModules = new WeakMap();

function getPitchWorkletModule(context) {
  if (!context?.audioWorklet) return Promise.resolve(null);
  if (!pitchWorkletModules.has(context)) {
    pitchWorkletModules.set(context, (async () => {
      try {
        await context.audioWorklet.addModule('/vendor/signalsmith-playback-worklet.js');
        return 'signalsmith';
      } catch (error) {
        console.warn('[Pitch] Signalsmith worklet unavailable:', error.message);
      }
      try {
        await context.audioWorklet.addModule('/vendor/soundtouch-worklet.js');
        return 'soundtouch';
      } catch (error) {
        console.warn('[Pitch] AudioWorklet unavailable:', error.message);
        return null;
      }
    })());
  }
  return pitchWorkletModules.get(context);
}

function preparePitchRenderer(target, signal) {
  return new Promise(resolve => {
    const finish = ready => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', fail);
      target.onprocessorerror = null;
      target.port.onmessage = null;
      resolve(ready);
    };
    const fail = () => finish(false);
    const timeout = setTimeout(fail, 1500);
    signal.addEventListener('abort', fail, { once: true });
    target.onprocessorerror = fail;
    target.port.onmessage = event => {
      if (event.data?.type === 'prepared') finish(true);
    };
    try { target.port.postMessage({ type: 'prepare' }); } catch (error) { fail(); }
  });
}

function createSoundTouchEngine({ preserveFormants = false } = {}) {
  let ctx = null;
  let outNode = null;            // 呼叫端提供的接點（音量鏈入口）

  let node = null;               // 當前的 AudioWorkletNode
  let durationSec = 0;
  let sampleRate = 44100;

  let pitchSemis = 0;
  let tempoRate = 1;

  let playing = false;
  let ready = false;             // 當前歌的 buffer 是否已送進 worklet
  let lastPositionSec = 0;       // worklet 最近回報的原曲秒數
  let lastPositionWallMs = 0;    // 上一次收到 position 回報時的 wall clock（給 getProjectedTime 推算用）

  let timer = null;
  let loadToken = 0;             // 載入世代：晚到的舊載入會被作廢，避免孤兒節點繼續播放
  let loadAbort = null;
  let onTimeCb = null;
  let onEndedCb = null;
  const playbackSubscribers = new Set();
  let effectivePlayback = null;
  let playbackGeneration = 0;
  let workletGeneration = null;

  async function ensureModule() {
    return Boolean(await getPitchWorkletModule(ctx));
  }

  function createNode() {
    return new AudioWorkletNode(ctx, 'soundtouch-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
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
      if (Number.isFinite(msg.contextTime) && Number.isFinite(msg.pitchSemitones) && Number.isFinite(msg.tempo)) {
        if (workletGeneration === null || msg.generation !== workletGeneration) {
          playbackGeneration++;
          workletGeneration = msg.generation;
        }
        effectivePlayback = {
          sourceTime: lastPositionSec, effectiveContextTime: msg.contextTime,
          pitchShift: msg.pitchSemitones, playbackRate: msg.tempo,
          playing: msg.playing === true, generation: playbackGeneration,
          reason: msg.reason || 'position',
        };
        _notifyPlayback();
      }
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
    const myToken = ++loadToken; // 作廢任何更早、尚未完成的載入
    if (loadAbort) loadAbort.abort();
    const abort = new AbortController();
    loadAbort = abort;
    try {
      // 立刻停掉並銷毀現有節點，確保切歌時舊聲音馬上停、不會變孤兒繼續播放
      stop();
      _destroyNode();
      ready = false;
      effectivePlayback = null;
      workletGeneration = null;

      const backend = await getPitchWorkletModule(ctx);
      if (!backend || myToken !== loadToken) return false;
      const res = await fetch(url, { signal: abort.signal });
      if (myToken !== loadToken) return false;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      // 舊請求在送進無法取消的 decodeAudioData 前就丟棄，避免連續切歌同時解碼整首 PCM。
      if (myToken !== loadToken) return false;
      const audioBuf = await ctx.decodeAudioData(arr);
      // 解碼期間若有更新的 load 進來，這次就作廢（避免兩個節點都接上 → 舊歌停不掉）
      if (myToken !== loadToken) return false;

      durationSec = audioBuf.duration;
      sampleRate = audioBuf.sampleRate;

      node = createNode();
      if (backend === 'signalsmith') {
        // Both stems wait for initialization before they can share a start frame.
        // Keep the AudioBuffer until then so fallback never downloads or decodes again.
        const prepared = await preparePitchRenderer(node, abort.signal);
        if (myToken !== loadToken) return false;
        if (!prepared) {
          console.warn('[Pitch] Worklet preparation failed, using SoundTouch');
          _destroyNode();
          node = createNode();
        }
      }
      const newNode = node;

      // 複製出可 transfer 的 channel data（直接 transfer getChannelData 會破壞 AudioBuffer）。
      const left = audioBuf.getChannelData(0).slice();
      // Worklet 的 ArraySource 只讀來源；單聲道兩側可共用同一份 PCM，輸出仍維持雙聲道。
      const right = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1).slice() : left;

      newNode.port.onmessage = (e) => { if (node === newNode) _onNodeMessage(e.data); };
      newNode.connect(outNode);
      // 把整首資料一次送進去（transfer，零複製到 worklet）+ 帶上目前 pitch/tempo
      newNode.port.postMessage(
        { type: 'load', left, right, sampleRate, duration: durationSec, pitchSemitones: pitchSemis, tempo: tempoRate, preserveFormants },
        right === left ? [left.buffer] : [left.buffer, right.buffer]
      );
      ready = true;
      playing = false;
      lastPositionSec = 0;
      return true;
    } catch (e) {
      if (myToken !== loadToken || abort.signal.aborted) return false;
      console.warn('[SoundTouch] 載入失敗，降級:', e.message);
      if (myToken === loadToken) { _destroyNode(); ready = false; }
      return false;
    } finally {
      if (loadAbort === abort) loadAbort = null;
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
    if (effectivePlayback && effectivePlayback.playing && ctx) {
      const elapsed = Math.max(0, ctx.currentTime - effectivePlayback.effectiveContextTime);
      return Math.max(0, Math.min(durationSec, effectivePlayback.sourceTime + elapsed * effectivePlayback.playbackRate));
    }
    const dt = Math.max(0, _nowMs() - lastPositionWallMs) / 1000;
    return Math.max(0, Math.min(durationSec, lastPositionSec + dt * (tempoRate || 1)));
  }
  function projectedTimeAt(lookaheadSec) {
    return Math.max(0, Math.min(durationSec, getProjectedTime() + (lookaheadSec || 0) * (tempoRate || 1)));
  }

  function play(offsetSec, atFrame) {
    if (!ready || !node) return false;
    const sec = (offsetSec != null) ? offsetSec : lastPositionSec;
    lastPositionSec = Math.max(0, Math.min(sec, durationSec));
    lastPositionWallMs = _nowMs();
    const message = { type: 'play' };
    // Resume without re-reading an old main-thread position acknowledgement.
    // Explicit offsets still re-seed both stems at their common scheduled frame.
    if (offsetSec != null) message.position = Math.round(lastPositionSec * sampleRate);
    _post(_withFrame(message, atFrame));
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
    if (loadAbort) { loadAbort.abort(); loadAbort = null; }
    _stopTimer();
    _destroyNode();
    ready = false;
    playing = false;
    durationSec = 0;
    lastPositionSec = 0;
    effectivePlayback = null;
    workletGeneration = null;
    playbackGeneration++;
    _notifyPlayback();
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

  // Acknowledged DSP state only. contextTime is the current shared context clock;
  // sourceTime belongs to effectiveContextTime, the worklet's output anchor.
  function getPlaybackSnapshot() {
    return {
      valid: !!(ready && effectivePlayback),
      sourceTime: effectivePlayback ? effectivePlayback.sourceTime : 0,
      contextTime: ctx ? ctx.currentTime : null,
      effectiveContextTime: effectivePlayback ? effectivePlayback.effectiveContextTime : null,
      contextSampleRate: ctx ? ctx.sampleRate : sampleRate,
      audioContext: ctx,
      playing: !!(ready && effectivePlayback && effectivePlayback.playing),
      pitchShift: effectivePlayback ? effectivePlayback.pitchShift : null,
      playbackRate: effectivePlayback ? effectivePlayback.playbackRate : null,
      generation: effectivePlayback ? effectivePlayback.generation : playbackGeneration,
      reason: effectivePlayback ? effectivePlayback.reason : 'unavailable',
    };
  }
  function _notifyPlayback() {
    if (!playbackSubscribers.size) return;
    const snapshot = getPlaybackSnapshot();
    for (const callback of playbackSubscribers) { try { callback(snapshot); } catch (e) {} }
  }
  function subscribePlayback(callback) {
    if (typeof callback !== 'function') return () => {};
    playbackSubscribers.add(callback);
    return () => playbackSubscribers.delete(callback);
  }

  const api = {
    ensureModule, attach, load, play, pause, stop, dispose, seek,
    getTime, getDuration, isPlaying, isReady, setPitch, setTempo, onTime, onEnded,
    scheduleFrame, frameNow, getProjectedTime, projectedTimeAt,
    getPlaybackSnapshot, subscribePlayback,
  };
  return api;
}

try {
  window.createSoundTouchEngine = createSoundTouchEngine;
  window.SoundTouchEngine = createSoundTouchEngine();
} catch (e) { /* 靜默 */ }
