/**
 * 練唱分頁（桌面面板）：把練唱引擎接到播放器、麥克風與伺服器。
 *
 *   播放器 → AppShared.subscribePracticePlayback 的快照記進 PracticeClock.Timeline，
 *            麥克風每一格（AudioContext 時間）再換算回原曲秒數與當下的 Key。
 *   麥克風 → 跟播放器同一個 AudioContext 的 AudioWorklet（practice/pitch-detector-worklet.js），不錄音、不開耳返。
 *   示範   → 原唱人聲（升降 Key 後、音量前）直接接進偵測器，不必開麥克風就能看整套演出。
 *   伺服器 → 練唱音高 /api/practice/guides（PinAuth.fetchWithPin）；OBS 外觀存在伺服器（鐵則 4），
 *            畫面資料經 practice:overlay 只轉給 OBS 練唱疊加層，不碰 state:sync（鐵則 5）。
 *
 * 播放、暫停、進度一律用上方的播放列；這裡不另開第二套播放控制。
 */
(function () {
  'use strict';

  const root = document.getElementById('view-practice');
  if (!root || typeof PracticeEngine === 'undefined' || typeof PracticeScoring === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const Fx = window.PracticeFx;
  const LATENCY_KEY = 'elitesand-practice-latency';
  const PREFS_KEY = 'elitesand-practice-prefs';
  const WORKLET_URL = '/js/practice/pitch-detector-worklet.js';
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 只影響這台電腦的偏好 */ } };

  // 只存這台電腦的偏好（麥克風延遲跟硬體有關；OBS 外觀則存在伺服器）
  const prefs = Object.assign({ allowOctave: true, showContour: false }, readJson(PREFS_KEY, {}));
  const ui = {
    stage: $('practice-stage'), heading: $('practice-heading'), status: $('practice-guide-status'),
    build: $('practice-build'), cancel: $('practice-cancel'), empty: $('practice-empty'), emptyText: $('practice-empty-text'),
    progress: $('practice-progress'), progressBar: $('practice-progress-bar'),
    keyDown: $('practice-key-down'), keyUp: $('practice-key-up'), keyValue: $('practice-key-value'), obsPreview: $('practice-obs-preview'),
    score: $('practice-score'), tech: $('practice-tech'), lines: $('practice-lines'),
    source: $('practice-source'), deviceField: $('practice-device-field'), device: $('practice-device'), level: $('practice-level'),
    latency: $('practice-latency'), latencyValue: $('practice-latency-value'), calibrate: $('practice-calibrate'),
    octave: $('practice-octave'), trail: $('practice-trail'), contour: $('practice-contour'),
    model: $('practice-model'), modelInstall: $('practice-model-install'),
    obsUrl: $('practice-obs-url'), obsCopy: $('practice-obs-copy'), fx: $('practice-fx'),
    bg: $('practice-bg'), bgOpacity: $('practice-bg-opacity'), bgOpacityValue: $('practice-bg-opacity-value'),
    edge: $('practice-edge'), pos: $('practice-pos'), laneH: $('practice-lane-height'), laneHValue: $('practice-lane-height-value'),
    showScore: $('practice-show-score'), showResult: $('practice-show-result'), showLyrics: $('practice-show-lyrics'),
    styleReset: $('practice-style-reset'),
    dialog: $('practice-calibration'), calStatus: $('practice-calibration-status'),
    calStart: $('practice-calibration-start'), calApply: $('practice-calibration-apply'), calClose: $('practice-calibration-close'),
  };
  const COLORS = { bgColor: 'practice-color-bg', note: 'practice-color-note', fill: 'practice-color-fill', voice: 'practice-color-voice', off: 'practice-color-off' };
  const TIER_IDS = { PERFECT: 'practice-tier-perfect', GREAT: 'practice-tier-great', GOOD: 'practice-tier-good', MISS: 'practice-tier-miss' };

  let snapshot = null;
  let timeline = null;
  let trackId = '';
  let guideState = { status: 'none', progress: 0, code: '' };
  let guideToken = 0;
  let pollTimer = 0;
  let visible = false;
  let lastPlaying = false;
  // 偵測器跟播放器共用 AudioContext（換歌重建時也可能換新的 context）
  const detector = { ctx: null, node: null, sink: null, stream: null, mic: null, untapDemo: null, mode: 'off', loading: null };
  let calibration = null;

  // ── 引擎 ───────────────────────────────────────────────────────────────
  const engine = PracticeEngine.createPracticeEngine({
    role: 'panel', root: ui.stage, t,
    clock: currentClock,
    getOptions: () => prefs,
    onSync: sendOverlay,
    onLevel: (rms) => { if (ui.level) ui.level.style.width = `${Math.min(100, Math.sqrt(rms) * 260)}%`; },
    onUpdate: (kind) => { if (kind !== 'score') renderStats(); else renderScore(); },
  });

  /** 畫面用的時鐘：喇叭「現在」播出的原曲秒數（扣掉輸出延遲），跟 OBS 看到的同一條時間。 */
  function currentClock() {
    const ctx = snapshot && snapshot.audioContext;
    if (!timeline || !ctx || !snapshot.valid) return null;
    const mapped = timeline.map(ctx.currentTime, { inputLatencySec: 0, outputLatencySec: snapshot.outputLatencySeconds || 0,
      dspLatencySec: snapshot.dspLatencySeconds || 0, calibrationMs: 0 });
    return mapped.valid ? { t: mapped.sourceTime, tempo: mapped.tempo, playing: mapped.playing } : null;
  }

  // ── OBS 同步 ───────────────────────────────────────────────────────────
  function sendOverlay(message) {
    if (typeof SocketClient === 'undefined' || !SocketClient.connected()) return;
    SocketClient.send('practice:overlay', message);
  }

  // ── 播放器 ─────────────────────────────────────────────────────────────
  function onPlayback(s) {
    const nextId = s && s.valid && s.track ? String(s.track.id) : '';
    snapshot = s;
    // 播完、停止或載入中：播放器暫時沒有歌。只停止計分，畫面與結算留著；換成另一首歌才清掉
    if (!nextId) {
      if (lastPlaying) engine.setPlaying(false, engine.songTime());
      timeline = null; lastPlaying = false;
      return;
    }
    if (nextId !== trackId) changeTrack(nextId, s);
    if (!timeline) timeline = PracticeClock.createTimeline({ duration: s.durationSeconds || Infinity });
    if (Number.isFinite(s.effectiveContextTime ?? s.contextTime)) {
      timeline.record({ audioTime: s.effectiveContextTime ?? s.contextTime, sourceTime: s.sourceTime, key: s.pitchShift,
        tempo: s.playbackRate, playing: s.playing, generation: s.generation, reason: s.playing ? 'playback' : 'pause' });
    }
    if (detector.ctx !== s.audioContext && detector.mode !== 'off') attachDetector();
    engine.setKey(s.pitchShift || 0);
    renderKey();
    // 跳轉（拖進度、手機遙控）由引擎自己從時鐘偵測，這裡只轉播放／暫停
    if (s.playing !== lastPlaying) {
      lastPlaying = s.playing;
      const clock = currentClock();
      engine.setPlaying(s.playing && detector.mode !== 'off', clock ? clock.t : s.sourceTime);
    }
  }

  function onBoundary(s) {
    if (s && s.boundary === 'ended' && detector.mode !== 'off' && engine.getGuide()) engine.finish(detector.mode);
  }

  function changeTrack(id, s) {
    trackId = id;
    timeline = null; lastPlaying = false;
    clearTimeout(pollTimer); guideToken++;
    engine.setGuide(null);
    sendOverlay({ type: 'clear' });
    guideState = { status: id ? 'loading' : 'none', progress: 0, code: '' };
    const track = s && s.track;
    ui.heading.textContent = track ? [track.title, track.artist].filter(Boolean).join(' — ') || t('practice.noTrack') : t('practice.noTrack');
    renderGuideState();
    if (id && visible) loadGuide(id, guideToken);
  }

  // ── 練唱音高 ───────────────────────────────────────────────────────────
  async function request(path, options) {
    if (typeof PinAuth === 'undefined' || !PinAuth.fetchWithPin) throw Object.assign(new Error('auth'), { code: 'AUTH' });
    const response = await PinAuth.fetchWithPin(`/api/practice${path}`, options || {});
    let body = {};
    try { body = await response.json(); } catch (_) { /* 沒有內容 */ }
    if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { code: body.code || '', status: response.status });
    return body;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const GUIDE_ACTIVE = ['queued', 'processing', 'cancelling'];

  async function loadGuide(id, token) {
    clearTimeout(pollTimer);
    try {
      const result = await request(`/guides/${encodeURIComponent(id)}`);
      if (token !== guideToken) return;
      applyGuideResult(id, token, result);
    } catch (error) {
      if (token !== guideToken) return;
      if (error.code === 'PRACTICE_VOCALS_REQUIRED') {
        // 還沒有人聲軌；如果這首歌正在製作伴奏（匯入後處理或其他頁面按的），直接顯示進度
        const running = separationRunning(id);
        if (running) { showSeparation(running); return; }
        guideState = { status: 'vocals', progress: 0, code: error.code };
      } else {
        guideState = { status: error.status === 404 ? 'missing' : 'failed', progress: 0, code: error.code };
      }
      renderGuideState();
    }
  }

  function applyGuideResult(id, token, result) {
    if (result.status === 'ready' && result.guide) {
      const guide = PracticeScoring.prepareGuide(result.guide);
      guide.title = ui.heading.textContent;
      engine.setGuide(guide);
      engine.setKey(snapshot && snapshot.pitchShift || 0);
      if (snapshot && snapshot.playing && detector.mode !== 'off') {
        const clock = currentClock();
        engine.setPlaying(true, clock ? clock.t : snapshot.sourceTime);
      }
      guideState = { status: 'ready', progress: 100, code: '', algorithm: result.guide.algorithm };
    } else if (GUIDE_ACTIVE.includes(result.status)) {
      guideState = { status: 'busy', progress: Math.round(Number(result.job && result.job.progress) || 0), code: '' };
      pollTimer = setTimeout(() => loadGuide(id, token), 1000);
    } else if (result.status === 'stale') {
      guideState = { status: 'stale', progress: 0, code: '' };
    } else if (result.status === 'failed' || result.status === 'cancelled') {
      guideState = { status: result.status, progress: 0, code: result.job && result.job.code || '' };
    } else {
      guideState = { status: 'missing', progress: 0, code: '' };
    }
    renderGuideState();
  }

  /** 開始建立練唱音軌。人聲剛分離完時，歌曲資料可能還差一點點才寫進去，稍等重試幾次。 */
  async function startGuide(id) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request(`/guides/${encodeURIComponent(id)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ algorithm: 'auto' }) });
      } catch (error) {
        if (error.code !== 'PRACTICE_VOCALS_REQUIRED' || attempt >= 5) throw error;
        await sleep(800);
      }
    }
  }

  async function buildGuide() {
    if (!trackId || guideState.status === 'busy') return;
    const id = trackId, token = ++guideToken;
    guideState = { status: 'busy', progress: 0, code: '' };
    renderGuideState();
    try {
      const result = await startGuide(id);
      if (token === guideToken) applyGuideResult(id, token, result);
    } catch (error) {
      if (token !== guideToken) return;
      guideState = { status: error.code === 'PRACTICE_VOCALS_REQUIRED' ? 'vocals' : 'failed', progress: 0, code: error.code };
      renderGuideState();
    }
  }

  // ── 製作伴奏（人聲分離）：練唱要用原唱人聲，沒有的話就在這頁做，做完自動接著建立練唱音軌 ──
  const SEPARATION_END = ['done', 'error', 'cancelled'];
  function separationRunning(id) {
    const st = window.AiSeparation && window.AiSeparation.get(id);
    return st && !SEPARATION_END.includes(st.stage) ? st : null;
  }

  function showSeparation(st) {
    guideState = { status: 'separating', progress: Number.isFinite(st.percent) ? Math.round(st.percent) : 0, code: '',
      label: window.AiSeparation ? window.AiSeparation.label(st) : '' };
    renderGuideState();
  }

  function onSeparation(st) {
    if (!st || String(st.trackId) !== trackId) return;
    const waiting = ['vocals', 'separating', 'loading', 'sepFailed'].includes(guideState.status);
    if (!waiting) return;
    if (st.stage === 'done') { buildGuide(); return; }
    if (st.stage === 'error') {
      guideState = { status: 'sepFailed', progress: 0, code: st.error || '', message: st.errorMessage || st.error || '' };
      renderGuideState();
      return;
    }
    if (st.stage === 'cancelled') { guideState = { status: 'vocals', progress: 0, code: '' }; renderGuideState(); return; }
    showSeparation(st);
  }

  async function separateAndBuild() {
    const id = trackId;
    if (!id || !window.AiSeparation) return;
    // 沒裝分離元件會跳出原本的安裝視窗；取消就停在原地
    if (!await window.AiSeparation.ensureReady() || id !== trackId) return;
    guideState = { status: 'separating', progress: 0, code: '', label: t('practice.separationStarting') };
    renderGuideState();
    try {
      const response = await PinAuth.fetchWithPin(`/api/library/${encodeURIComponent(id)}/separate`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        if (data.error === 'ALREADY_PROCESSING') return;   // 已經在做：等進度事件就好
        throw new Error(data.error === 'AI_RUNTIME_NOT_READY' ? t('practice.separationRuntimeMissing') : (data.error || `HTTP ${response.status}`));
      }
    } catch (error) {
      if (id !== trackId) return;
      guideState = { status: 'sepFailed', progress: 0, code: '', message: error.message };
      renderGuideState();
    }
  }

  async function cancelGuide() {
    if (!trackId) return;
    const id = trackId;
    if (guideState.status === 'separating') {
      if (window.AiSeparation) await window.AiSeparation.cancel(id);
      return;   // 伺服器廣播取消後由 onSeparation 回到「需要人聲」
    }
    if (guideState.status !== 'busy') return;
    guideToken++; clearTimeout(pollTimer);
    guideState = { status: 'cancelled', progress: 0, code: '' };
    renderGuideState();
    try { await request(`/guides/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); } catch (_) { /* 伺服器那邊可能已經做完 */ }
  }

  /**
   * 匯入後處理用：建立某首歌的練唱音軌並等它做完（練唱頁有沒有開都可以）。
   * 做完回傳 true；失敗就丟出錯誤，由呼叫端決定要不要提示。
   */
  async function prepareGuideFor(id) {
    id = String(id);
    let result = await startGuide(id);
    if (id === trackId) loadGuide(id, guideToken);   // 練唱頁正開著這首：一起顯示進度
    while (GUIDE_ACTIVE.includes(result.status)) {
      await sleep(1500);
      result = await request(`/guides/${encodeURIComponent(id)}`);
    }
    if (id === trackId && guideState.status !== 'ready') loadGuide(id, guideToken);
    if (result.status !== 'ready') throw new Error((result.job && result.job.error) || t('practice.guideFailed'));
    return true;
  }
  window.PracticePrep = Object.freeze({ prepare: prepareGuideFor });

  function guideMessage() {
    const s = guideState;
    switch (s.status) {
      case 'none': return t('practice.chooseSong');
      case 'loading': return t('practice.guideLoading');
      case 'busy': return t('practice.guideBusy', { progress: s.progress });
      case 'separating': return t('practice.separating', { state: s.label || '' });
      case 'sepFailed': return t('practice.separationFailed', { message: s.message || '' });
      case 'missing': return t('practice.guideMissing');
      case 'stale': return t('practice.guideStale');
      case 'vocals': return t('practice.vocalsRequired');
      case 'cancelled': return t('practice.guideCancelled');
      case 'ready': return detector.mode === 'off' ? t('practice.readyPickSource') : t('practice.readyPlay');
      default: return s.code === 'PRACTICE_RUNTIME_MISSING' ? t('practice.runtimeMissing') : t('practice.guideFailed');
    }
  }

  // 中間那塊就是「下一步」：要做什麼、做到哪裡、能不能取消
  const BUILD_LABEL = { vocals: 'practice.separateAndBuild', sepFailed: 'practice.separateAndBuild', missing: 'practice.buildGuide' };
  function renderGuideState() {
    const s = guideState.status;
    ui.status.textContent = guideMessage();
    ui.build.hidden = !['vocals', 'sepFailed', 'missing', 'stale', 'failed', 'cancelled'].includes(s);
    ui.build.textContent = t(BUILD_LABEL[s] || 'practice.rebuildGuide');
    ui.cancel.hidden = s !== 'busy' && s !== 'separating';
    ui.progress.hidden = s !== 'busy' && s !== 'separating';
    ui.progressBar.style.width = `${Math.max(2, Math.min(100, guideState.progress || 0))}%`;
    ui.empty.hidden = s === 'ready';
    ui.emptyText.textContent = s === 'none' ? t('practice.emptyNoTrack') : guideMessage();
    ui.calibrate.disabled = detector.mode !== 'mic';
    renderStats();
  }

  function onBuildClick() {
    if (guideState.status === 'vocals' || guideState.status === 'sepFailed') separateAndBuild();
    else buildGuide();
  }

  // ── 偵測器：麥克風／示範 ────────────────────────────────────────────────
  async function ensureDetector(ctx) {
    if (detector.ctx === ctx && detector.node) return detector.node;
    releaseDetectorNode();
    await ctx.audioWorklet.addModule(WORKLET_URL);
    const node = new AudioWorkletNode(ctx, 'practice-pitch-detector');
    // 接到靜音的 gain 再到輸出，確保瀏覽器會一直跑它；聲音本身不會被聽到
    const sink = ctx.createGain(); sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    node.port.onmessage = (e) => onPitch(e.data);
    Object.assign(detector, { ctx, node, sink });
    return node;
  }

  function releaseDetectorNode() {
    if (detector.untapDemo) { detector.untapDemo(); detector.untapDemo = null; }
    if (detector.mic) { try { detector.mic.disconnect(); } catch (_) {} detector.mic = null; }
    if (detector.node) { detector.node.port.onmessage = null; try { detector.node.disconnect(); } catch (_) {} }
    if (detector.sink) { try { detector.sink.disconnect(); } catch (_) {} }
    Object.assign(detector, { ctx: null, node: null, sink: null });
  }

  function stopMicStream() {
    if (detector.stream) detector.stream.getTracks().forEach((track) => track.stop());
    detector.stream = null;
  }

  /** 依目前的來源把偵測器接上（換歌時播放器可能換了 AudioContext，要重接）。 */
  async function attachDetector() {
    const mode = detector.mode;
    const ctx = snapshot && snapshot.audioContext;
    if (mode === 'off' || !ctx) return;
    const job = (async () => {
      const node = await ensureDetector(ctx);
      if (detector.mode !== mode) return;
      if (mode === 'mic') {
        if (!detector.stream || !detector.stream.active) {
          const deviceId = ui.device.value;
          detector.stream = await navigator.mediaDevices.getUserMedia({ audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
          refreshDevices();
        }
        if (detector.mode !== 'mic') { stopMicStream(); return; }
        if (detector.mic) { try { detector.mic.disconnect(); } catch (_) {} }
        detector.mic = ctx.createMediaStreamSource(detector.stream);
        detector.mic.connect(node);
      } else if (mode === 'demo') {
        if (!detector.untapDemo) detector.untapDemo = window.AppShared.connectPracticeVocalTap(node);
      }
    })();
    detector.loading = job;
    try { await job; } finally { if (detector.loading === job) detector.loading = null; }
  }

  async function setSource(mode) {
    cancelCalibration();
    releaseDetectorNode();
    stopMicStream();
    detector.mode = mode;
    ui.deviceField.hidden = mode !== 'mic';
    ui.latency.value = mode === 'mic' ? readLatency() : 0;
    ui.latency.disabled = mode !== 'mic';
    renderLatency();
    if (ui.level) ui.level.style.width = '0%';
    try {
      if (mode === 'demo' && !(window.AppShared.isPracticeVocalAvailable && window.AppShared.isPracticeVocalAvailable())) {
        toast(t('practice.demoNeedsVocals'), 'warning');
      }
      await attachDetector();
    } catch (error) {
      detector.mode = 'off'; ui.source.value = 'off'; ui.deviceField.hidden = true;
      toast(t('practice.micFailed', { message: error.message || error.name }), 'error');
    }
    const clock = currentClock();
    engine.setPlaying(!!(snapshot && snapshot.playing) && detector.mode !== 'off', clock ? clock.t : 0);
    renderGuideState();
  }

  function onPitch(d) {
    if (calibration) { calibrationFrame(d); return; }
    if (!timeline) { engine.pitch(d, null); return; }
    const demo = detector.mode === 'demo';
    // 麥克風：喇叭播出 → 唱 → 麥克風收進來，整段回路由校準值一次扣掉；示範人聲在輸出前就接走，不用扣
    const mapped = timeline.map(d.time, demo
      ? { inputLatencySec: 0, outputLatencySec: 0, dspLatencySec: 0, calibrationMs: 0 }
      : { inputLatencySec: 0, outputLatencySec: 0, dspLatencySec: snapshot && snapshot.dspLatencySeconds || 0, calibrationMs: Number(ui.latency.value) || 0 });
    engine.pitch(d, mapped.valid ? { valid: true, t: mapped.sourceTime, key: mapped.key } : null);
  }

  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const selected = ui.device.value;
      ui.device.textContent = '';
      const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; ui.device.appendChild(o); };
      add('', t('practice.defaultDevice'));
      devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
        .forEach((d, i) => add(d.deviceId, d.label || `${t('practice.sourceMic')} ${i + 1}`));
      ui.device.value = [...ui.device.options].some((o) => o.value === selected) ? selected : '';
    } catch (_) { /* 列不出裝置就用預設 */ }
  }

  // ── 延遲與校準 ─────────────────────────────────────────────────────────
  function readLatency() {
    const saved = readJson(LATENCY_KEY, null);
    return Number.isFinite(saved) ? saved : 120;
  }
  function renderLatency() { ui.latencyValue.textContent = `${ui.latency.value} ms`; }

  function cancelCalibration() {
    const c = calibration; if (!c) return;
    clearTimeout(c.timer);
    for (const tone of c.tones) { try { tone.stop(); } catch (_) {} tone.disconnect(); }
    for (const gain of c.gains) gain.disconnect();
    calibration = null;
    ui.calStart.disabled = false;
  }

  // 聲學回路校準：從喇叭發出 8 聲 880Hz 短音，量麥克風多久之後收到；中位數取整到 10ms
  async function runCalibration() {
    cancelCalibration();
    ui.calApply.hidden = true; ui.calStart.disabled = true;
    ui.calStatus.textContent = t('practice.calibrationListening');
    try {
      const ctx = detector.ctx;
      if (detector.mode !== 'mic' || !ctx || !detector.stream || !detector.stream.active) throw new Error(t('practice.calibrationNeedMic'));
      await ctx.resume();
      if (!ui.dialog.open) { ui.calStart.disabled = false; return; }
      const c = { pulses: [], tones: [], gains: [], floor: [], timer: 0 };
      calibration = c;
      const now = ctx.currentTime;
      for (let i = 0; i < 8; i++) {
        const at = now + 0.8 + i * 0.7;
        const tone = ctx.createOscillator(), gain = ctx.createGain();
        tone.frequency.value = 880; gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.12, at + 0.004); gain.gain.setValueAtTime(0.12, at + 0.07); gain.gain.linearRampToValueAtTime(0, at + 0.08);
        tone.connect(gain).connect(ctx.destination); tone.start(at); tone.stop(at + 0.09);
        c.pulses.push({ at, heard: null }); c.tones.push(tone); c.gains.push(gain);
      }
      c.timer = setTimeout(() => {
        if (calibration !== c) return;
        const estimate = PracticeScoring.latencyEstimate(c.pulses.filter((p) => p.heard != null).map((p) => (p.heard - p.at) * 1000));
        cancelCalibration();
        if (estimate == null) { ui.calStatus.textContent = t('practice.calibrationFailed'); return; }
        ui.calApply.dataset.value = estimate; ui.calApply.hidden = false;
        ui.calStatus.textContent = t('practice.calibrationResult', { ms: estimate });
      }, 7000);
    } catch (error) {
      cancelCalibration();
      ui.calStatus.textContent = error.message;
    }
  }

  function calibrationFrame(d) {
    const c = calibration;
    if (d.time < c.pulses[0].at - 0.1) { c.floor.push(d.rms); return; }
    const noise = c.floor.length ? c.floor.reduce((a, b) => a + b, 0) / c.floor.length : 0.003;
    if (d.rms < Math.max(0.004, noise * 4) || d.clarity < 0.85 || Math.abs(d.f0 - 880) > 35) return;
    const pulse = c.pulses.find((p) => p.heard == null && d.time >= p.at && d.time <= p.at + 0.4);
    if (pulse) pulse.heard = d.time;
  }

  // ── OBS 外觀（伺服器為準）────────────────────────────────────────────────
  function applyStyle(style, { send = false } = {}) {
    engine.setStyle(style);
    const s = engine.getStyle();
    ui.fx.value = s.fx; ui.trail.value = s.trailMode;
    ui.bg.checked = !!s.bg; ui.bgOpacity.value = s.bgOpacity; ui.bgOpacityValue.textContent = `${s.bgOpacity}%`;
    ui.bgOpacity.disabled = !s.bg;
    ui.edge.checked = !!s.edge; ui.pos.value = s.pos;
    ui.laneH.value = s.laneH; ui.laneHValue.textContent = `${s.laneH}%`;
    ui.showScore.checked = !!s.score; ui.showResult.checked = !!s.result; ui.showLyrics.checked = !!s.lyrics;
    for (const [key, id] of Object.entries(COLORS)) { const input = $(id); if (input) input.value = s[key]; }
    if (send) sendOverlay({ type: 'style', style: { ...style } });
  }

  function loadStyle() {
    if (typeof SocketClient === 'undefined') return;
    SocketClient.sendWithCallback('practice:style:get', null, (result) => {
      if (result && result.ok && result.style) applyStyle(result.style);
    });
  }

  function bindStyleInputs() {
    const on = (input, event, read) => input && input.addEventListener(event, () => applyStyle(read(), { send: true }));
    on(ui.fx, 'change', () => ({ fx: ui.fx.value }));
    on(ui.trail, 'change', () => ({ trailMode: ui.trail.value }));
    on(ui.bg, 'change', () => ({ bg: ui.bg.checked }));
    on(ui.bgOpacity, 'input', () => ({ bgOpacity: Number(ui.bgOpacity.value) }));
    on(ui.edge, 'change', () => ({ edge: ui.edge.checked }));
    on(ui.pos, 'change', () => ({ pos: ui.pos.value }));
    on(ui.laneH, 'input', () => ({ laneH: Number(ui.laneH.value) }));
    on(ui.showScore, 'change', () => ({ score: ui.showScore.checked }));
    on(ui.showResult, 'change', () => ({ result: ui.showResult.checked }));
    on(ui.showLyrics, 'change', () => ({ lyrics: ui.showLyrics.checked }));
    for (const [key, id] of Object.entries(COLORS)) on($(id), 'input', () => ({ [key]: $(id).value }));
    ui.styleReset.addEventListener('click', () => applyStyle({ ...Fx.STYLE_DEFAULT }, { send: true }));
  }

  // 右欄設定分三頁（輸入／顯示／OBS 外觀），一次一頁；記住這台電腦上次停在哪一頁
  function bindTabs() {
    const tabs = [...root.querySelectorAll('.practice-tab')];
    const select = (id) => {
      if (!tabs.some((tab) => tab.dataset.tab === id)) id = 'input';
      for (const tab of tabs) {
        const on = tab.dataset.tab === id;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        const pane = root.querySelector(`[data-pane="${tab.dataset.tab}"]`);
        if (pane) pane.hidden = !on;
      }
      if (prefs.tab !== id) { prefs.tab = id; writeJson(PREFS_KEY, prefs); }
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab.dataset.tab));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        select(next.dataset.tab); next.focus(); e.preventDefault();
      });
    });
    select(prefs.tab);
    // 新手教學要指到某個設定時（ui:reveal），先切到它所在的那一頁
    document.addEventListener('ui:reveal', (e) => {
      const pane = e.detail && e.detail.target && e.detail.target.closest && e.detail.target.closest('[data-pane]');
      if (pane && root.contains(pane)) select(pane.dataset.pane);
    });
  }

  function renderFxMenu() {
    const current = ui.fx.value || engine.getStyle().fx;
    ui.fx.textContent = '';
    for (const id of Fx.FX_IDS) {
      const option = document.createElement('option');
      option.value = id; option.textContent = t(Fx.FX_PRESETS[id].label);
      ui.fx.appendChild(option);
    }
    ui.fx.value = current;
  }

  function obsUrl() {
    const path = '/practice-overlay';
    try { if (typeof AccessAuth !== 'undefined' && AccessAuth.sourceUrl) return AccessAuth.sourceUrl(path); } catch (_) { /* 用不帶權杖的網址 */ }
    return new URL(path, window.location.origin).href;
  }

  // ── 側欄：分數、評等、逐句 ──────────────────────────────────────────────
  function renderScore() {
    const st = engine.getStats();
    ui.score.textContent = st.unscorable ? t('practice.unscorable') : st.scoreTarget == null ? '—' : st.scoreTarget.toFixed(1);
  }

  function renderStats() {
    const st = engine.getStats();
    renderScore();
    for (const [tier, id] of Object.entries(TIER_IDS)) { const node = $(id); if (node) node.textContent = st.tiers[tier] || 0; }
    ui.tech.textContent = Object.entries(st.techCount).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(' · ');
    const guide = engine.getGuide();
    ui.lines.textContent = '';
    if (!guide) return;
    const byLine = new Map(st.ratings.map((r) => [r.line, r]));
    guide.lines.forEach((line, i) => {
      const r = byLine.get(i);
      const li = document.createElement('li');
      li.className = r ? `is-${r.tag.toLowerCase()}` : '';
      const text = document.createElement('span'); text.className = 'practice-line-text'; text.textContent = line.text;
      const tag = document.createElement('span'); tag.className = 'practice-line-tag mono'; tag.textContent = r ? r.tag : '';
      li.append(text, tag);
      li.addEventListener('click', () => { if (window.AppShared.seekPracticeTo) window.AppShared.seekPracticeTo(Math.max(0, line.start - 1), { resume: true }); });
      ui.lines.appendChild(li);
    });
  }

  function renderKey() {
    const key = window.AppShared.getPitchShift ? window.AppShared.getPitchShift() : 0;
    ui.keyValue.textContent = key > 0 ? `+${key}` : String(key || 0);
  }

  // ── 模型（高精度音高元件）───────────────────────────────────────────────
  async function checkModel() {
    try {
      const result = await request('/pitch-model');
      ui.model.hidden = !result.aiRuntime || result.installed;
    } catch (_) { ui.model.hidden = true; }
  }

  async function installModel() {
    ui.modelInstall.disabled = true;
    ui.modelInstall.textContent = t('practice.modelInstalling');
    try {
      await request('/pitch-model/install', { method: 'POST' });
      ui.model.hidden = true;
      toast(t('practice.modelInstalled'), 'success');
      if (guideState.status === 'ready') { guideState = { status: 'stale', progress: 0, code: '' }; renderGuideState(); }
    } catch (_) {
      toast(t('practice.modelFailed'), 'error');
    } finally {
      ui.modelInstall.disabled = false;
      ui.modelInstall.textContent = t('practice.modelInstall');
    }
  }

  function toast(message, type) {
    if (window.AppShared && window.AppShared.showToast) window.AppShared.showToast(message, type);
  }

  // ── 繫結 ───────────────────────────────────────────────────────────────
  function translate() {
    renderFxMenu();
    renderGuideState();
    if (!trackId) ui.heading.textContent = t('practice.noTrack');
    if (ui.device.options.length) refreshDevices();
  }

  function init() {
    renderFxMenu();
    applyStyle(Fx.STYLE_DEFAULT);
    ui.octave.checked = prefs.allowOctave !== false;
    ui.contour.checked = !!prefs.showContour;
    ui.latency.value = 0; ui.latency.disabled = true; renderLatency();
    ui.obsUrl.textContent = obsUrl();
    renderGuideState();
    bindStyleInputs();
    bindTabs();

    ui.build.addEventListener('click', onBuildClick);
    ui.cancel.addEventListener('click', cancelGuide);
    ui.keyDown.addEventListener('click', () => { window.AppShared.stepPitch(-1); renderKey(); });
    ui.keyUp.addEventListener('click', () => { window.AppShared.stepPitch(1); renderKey(); });
    ui.obsPreview.addEventListener('click', () => {
      const on = !ui.stage.classList.contains('pstage--obs');
      ui.stage.classList.toggle('pstage--obs', on);
      ui.obsPreview.setAttribute('aria-pressed', String(on));
      engine.setStyle({});   // 重算 OBS 專屬的顯示（結算卡等）
    });
    ui.source.addEventListener('change', () => setSource(ui.source.value));
    ui.device.addEventListener('change', () => { if (detector.mode === 'mic') { stopMicStream(); setSource('mic'); } });
    ui.latency.addEventListener('input', () => { renderLatency(); if (detector.mode === 'mic') writeJson(LATENCY_KEY, Number(ui.latency.value)); });
    ui.octave.addEventListener('change', () => { prefs.allowOctave = ui.octave.checked; writeJson(PREFS_KEY, prefs); });
    ui.contour.addEventListener('change', () => { prefs.showContour = ui.contour.checked; writeJson(PREFS_KEY, prefs); });
    ui.modelInstall.addEventListener('click', installModel);
    ui.obsCopy.addEventListener('click', () => {
      const url = obsUrl();
      ui.obsUrl.textContent = url;
      navigator.clipboard.writeText(url).then(() => toast(t('practice.copied'), 'success')).catch(() => toast(url, 'info'));
    });

    ui.calibrate.addEventListener('click', () => {
      ui.calStatus.textContent = detector.mode === 'mic' ? '' : t('practice.calibrationNeedMic');
      ui.calApply.hidden = true;
      ui.dialog.showModal();
    });
    ui.calStart.addEventListener('click', runCalibration);
    ui.calClose.addEventListener('click', () => ui.dialog.close());
    ui.dialog.addEventListener('close', cancelCalibration);
    ui.calApply.addEventListener('click', () => {
      ui.latency.value = ui.calApply.dataset.value; renderLatency();
      writeJson(LATENCY_KEY, Number(ui.latency.value));
      ui.dialog.close();
    });
    window.addEventListener('pagehide', () => { cancelCalibration(); stopMicStream(); });

    document.addEventListener('view:change', (e) => {
      visible = e.detail && e.detail.view === 'practice';
      if (!visible) return;
      ui.obsUrl.textContent = obsUrl();
      renderKey();
      checkModel();
      if (trackId && ['loading', 'none'].includes(guideState.status)) loadGuide(trackId, guideToken);
    });
    window.addEventListener('i18n:change', translate);

    if (typeof SocketClient !== 'undefined') {
      SocketClient.on('practice:style', (style) => applyStyle(style));
      SocketClient.on('connection-change', (connected) => {
        if (!connected) return;
        loadStyle();
        // 重新連線後把歌曲重送一次，OBS 那邊才接得上
        engine.announce();
      });
      if (SocketClient.connected()) loadStyle();
    }
    if (window.AiSeparation) window.AiSeparation.subscribe(onSeparation, { replay: false });
    if (window.AppShared && window.AppShared.subscribePracticePlayback) {
      window.AppShared.subscribePracticePlayback(onPlayback);
      window.AppShared.subscribePracticePlaybackBoundary(onBoundary);
    }
    visible = root.classList.contains('is-active');
    if (visible) checkModel();
  }

  init();
})();
