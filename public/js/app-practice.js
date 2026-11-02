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
  const Calibration = window.PracticeCalibration;
  const PREFS_KEY = 'elitesand-practice-prefs';
  const WORKLET_URL = '/js/practice/pitch-detector-worklet.js';
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 只影響這台電腦的偏好 */ } };
  const latencyProfiles = Calibration.createProfiles({ data: readJson(Calibration.STORAGE_KEY, null),
    save: (data) => writeJson(Calibration.STORAGE_KEY, data) });

  // 只存這台電腦的偏好（麥克風延遲跟硬體有關；OBS 外觀則存在伺服器）
  const prefs = Object.assign({ allowOctave: true, showContour: false }, readJson(PREFS_KEY, {}));
  const ui = {
    stage: $('practice-stage'), heading: $('practice-heading'), status: $('practice-guide-status'),
    build: $('practice-build'), cancel: $('practice-cancel'), empty: $('practice-empty'), emptyText: $('practice-empty-text'),
    progress: $('practice-progress'), progressBar: $('practice-progress-bar'),
    keyDown: $('practice-key-down'), keyUp: $('practice-key-up'), keyValue: $('practice-key-value'), obsPreview: $('practice-obs-preview'),
    loop: $('practice-loop'), nextSection: $('practice-next-section'),
    score: $('practice-score'), tech: $('practice-tech'), lines: $('practice-lines'),
    source: $('practice-source'), deviceField: $('practice-device-field'), device: $('practice-device'), level: $('practice-level'),
    meter: $('practice-meter'), levelGate: $('practice-level-gate'),
    gainField: $('practice-gain-field'), echoField: $('practice-echo-field'), echo: $('practice-echo'), gain: $('practice-gain'), gainValue: $('practice-gain-value'),
    latency: $('practice-latency'), latencyValue: $('practice-latency-value'), latencyStatus: $('practice-latency-status'), calibrate: $('practice-calibrate'),
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
  const detector = { ctx: null, node: null, sink: null, stream: null, mic: null, gain: null, untapDemo: null, mode: 'off', loading: null,
    request: 0, targetCtx: null, sourceRevision: 0 };
  let calibration = null;
  let feedback = null;
  let feedbackPoll = 0;
  let calibrationAttempt = 0;
  let calibrationResult = null;
  let availableDevices = [];
  let deviceEnumeration = 0;

  // ── 引擎 ───────────────────────────────────────────────────────────────
  const engine = PracticeEngine.createPracticeEngine({
    role: 'panel', root: ui.stage, t,
    clock: currentClock,
    getOptions: () => prefs,
    onSync: sendOverlay,
    onFinish: (take) => { if (feedback) feedback.finish(take); reportScore(take); },
    onLevel: renderLevel,
    onHint: (kind) => { if (kind === 'quiet' && detector.mode === 'mic') toast(t('practice.micQuiet'), 'warning'); },
    onUpdate: (kind) => { if (kind !== 'score') renderStats(); else renderScore(); },
  });

  feedback = PracticeFeedback.create({ engine, request, t, document,
    getSnapshot: () => snapshot, getSource: () => detector.mode, getOptions: () => prefs,
    seek: (seconds, options) => window.AppShared.seekPracticeTo(seconds, options), send: sendOverlay });

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
    const previous = snapshot;
    snapshot = s;
    Promise.resolve().then(renderLoopControls);   // 跳轉出循環範圍時控制器會自己停，按鈕字跟上
    syncLatencyProfile();
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
    if (detector.ctx !== s.audioContext && detector.mode !== 'off') attachDetector().catch(detectorError);
    engine.setKey(s.pitchShift || 0);
    if (previous && previous.valid && String(previous.track.id) === nextId
      && (previous.pitchShift !== s.pitchShift || previous.playbackRate !== s.playbackRate)) feedback.contextChanged();
    renderKey();
    if (feedback.playback(s)) { lastPlaying = s.playing; return; }
    // 跳轉（拖進度、手機遙控）由引擎自己從時鐘偵測，這裡只轉播放／暫停
    if (s.playing !== lastPlaying) {
      lastPlaying = s.playing;
      const clock = currentClock();
      engine.setPlaying(s.playing && detector.mode !== 'off', clock ? clock.t : s.sourceTime);
    }
  }

  // 整首唱完的分數區間進匿名每日統計（EULA §7.9(g)）。所有結算都會經過 onFinish，
  // 但只送麥克風、整首（scope full）、有分數的那幾次；A–B 循環與中途跳過的區段不算。
  // 只送來源、分數、計分秒數三個值，收不收、記哪一格由伺服器決定。
  function reportScore(take) {
    if (!take || take.source !== 'mic' || take.score == null || !take.scope || take.scope.type !== 'full') return;
    SocketClient.send('practice:scored', { source: take.source, score: take.score, seconds: take.seconds });
  }

  function onBoundary(s) {
    if (s && s.boundary === 'ended' && detector.mode !== 'off' && engine.getGuide()) {
      if (feedback.boundary(s)) return true;
      engine.finish(detector.mode, { end: s.durationSeconds });
    }
    return false;
  }

  function changeTrack(id, s) {
    trackId = id;
    loopStart = null;
    timeline = null; lastPlaying = false;
    clearTimeout(pollTimer); guideToken++;
    engine.setGuide(null);
    feedback.reset(id);
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
      guide.trackId = id;
      feedback.reset(id);
      engine.setGuide(guide);
      engine.setKey(snapshot && snapshot.pitchShift || 0);
      if (snapshot && snapshot.playing && detector.mode !== 'off') {
        const clock = currentClock();
        engine.setPlaying(true, clock ? clock.t : snapshot.sourceTime);
      }
      guideState = { status: 'ready', progress: 100, code: '', algorithm: result.guide.algorithm };
      feedback.refresh();
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

  // 音符是照歌詞時間切的，第一次建立前先自動對時。重建（過期、失敗、取消）不再對：
  // 過期多半是使用者自己改了時間，不能蓋掉；標成「已對時」的歌也不動。
  const FIRST_BUILD = ['missing', 'vocals', 'separating', 'sepFailed'];
  async function syncLyricsFirst(id, token) {
    const track = window.AppShared && window.AppShared.state.playlist.find((item) => item && item.id === id);
    if (!window.AutoSync || !track || track.syncConfirmed) return;
    guideState = { status: 'syncing', progress: 0, code: '' };
    renderGuideState();
    await window.AutoSync.syncTrack(id);   // 結果它自己會提示；對不上也照樣建音軌
    if (token !== guideToken) throw Object.assign(new Error('superseded'), { superseded: true });
  }

  async function buildGuide() {
    if (!trackId || guideState.status === 'busy' || guideState.status === 'syncing') return;
    const id = trackId, token = ++guideToken;
    const first = FIRST_BUILD.includes(guideState.status);
    try {
      if (first) await syncLyricsFirst(id, token);
      guideState = { status: 'busy', progress: 0, code: '' };
      renderGuideState();
      const result = await startGuide(id);
      if (token === guideToken) applyGuideResult(id, token, result);
    } catch (error) {
      if (token !== guideToken || error.superseded) return;
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
      case 'syncing': return t('practice.syncing');
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
  // ── A–B 循環與下一段（循環本身交給回饋控制器：等播放器確認跳轉才開始新一輪）──
  // 一顆按鈕走三步：按一下記 A（目前位置）→ 再按一下記 B 並開始循環 → 循環中再按就停
  let loopStart = null;
  const playheadSeconds = () => { const c = currentClock(); return c ? c.t : (snapshot && snapshot.sourceTime) || 0; };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function renderLoopControls() {
    const ready = guideState.status === 'ready';
    if (!ui.loop || !ui.nextSection) return;
    const looping = !!(feedback.isLooping && feedback.isLooping());
    if (!ready && !looping) loopStart = null;
    const label = (ui.loop.querySelector && ui.loop.querySelector('span')) || ui.loop;
    label.textContent = looping ? t('practice.loop.stop') : loopStart != null ? t('practice.loop.setB', { a: mmss(loopStart) }) : t('practice.loop.start');
    ui.loop.title = t('practice.loop.hint');
    ui.loop.classList.toggle('is-active', looping || loopStart != null);
    ui.loop.disabled = !ready && !looping;
    ui.nextSection.textContent = t('practice.loop.next');
    ui.nextSection.title = t('practice.loop.nextHint');
    ui.nextSection.disabled = !ready;
  }
  function onLoopClick() {
    if (feedback.isLooping && feedback.isLooping()) { feedback.stopLoop(); loopStart = null; renderLoopControls(); return; }
    const now = playheadSeconds();
    if (loopStart == null) { loopStart = now; renderLoopControls(); return; }
    const a = Math.min(loopStart, now), b = Math.max(loopStart, now);
    if (b - a < 0.5) { toast(t('practice.loop.tooShort'), 'info'); return; }
    loopStart = null;
    feedback.loopRange(a, b, `${mmss(a)}–${mmss(b)}`);
    renderLoopControls();
  }
  // 下一段：歌詞句之間空 1 秒以上就算換段（主歌／副歌交界、前奏、間奏）；沒有歌詞時看音符空 3 秒以上。
  // 跳到下一段開頭前 2 秒
  function onNextSection() {
    const guide = engine.getGuide();
    if (!guide) return;
    const at = playheadSeconds();
    const spans = guide.lines && guide.lines.length
      ? { items: guide.lines.slice().sort((x, y) => x.start - y.start), gap: 1 }
      : { items: guide.notes.filter((n) => !n.excluded && n.midi > 0).sort((x, y) => x.start - y.start), gap: 3 };
    let prevEnd = -Infinity, target = null;
    for (const item of spans.items) {
      if (item.start - prevEnd >= spans.gap && item.start > at + 2.5) { target = item.start; break; }
      prevEnd = Math.max(prevEnd, item.end);
    }
    if (target == null) { toast(t('practice.loop.noNext'), 'info'); return; }
    if (feedback.isLooping && feedback.isLooping()) feedback.stopLoop();
    loopStart = null;
    window.AppShared.seekPracticeTo(Math.max(0, target - 2), { resume: !!(snapshot && snapshot.playing) });
    renderLoopControls();
  }

  function renderGuideState() {
    const s = guideState.status;
    renderLoopControls();
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
  async function ensureDetector(ctx, request) {
    if (detector.ctx === ctx && detector.node) return detector.node;
    releaseDetectorNode();
    await ctx.audioWorklet.addModule(WORKLET_URL);
    if (request !== detector.request) return null;
    const node = new AudioWorkletNode(ctx, 'practice-pitch-detector');
    // 接到靜音的 gain 再到輸出，確保瀏覽器會一直跑它；聲音本身不會被聽到
    const sink = ctx.createGain(); sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    node.port.onmessage = (e) => { if (detector.node === node) onPitch(e.data); };
    Object.assign(detector, { ctx, node, sink });
    return node;
  }

  function releaseDetectorNode() {
    engine.resetInput();
    if (detector.untapDemo) { detector.untapDemo(); detector.untapDemo = null; }
    if (detector.mic) { try { detector.mic.disconnect(); } catch (_) {} detector.mic = null; }
    if (detector.gain) { try { detector.gain.disconnect(); } catch (_) {} detector.gain = null; }
    if (detector.node) { detector.node.port.onmessage = null; try { detector.node.disconnect(); } catch (_) {} }
    if (detector.sink) { try { detector.sink.disconnect(); } catch (_) {} }
    Object.assign(detector, { ctx: null, node: null, sink: null });
  }

  function stopMicStream() {
    const stream = detector.stream;
    detector.stream = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }

  /** 依目前的來源把偵測器接上（換歌時播放器可能換了 AudioContext，要重接）。 */
  async function attachDetector() {
    const mode = detector.mode;
    const ctx = snapshot && snapshot.audioContext;
    if (mode === 'off' || !ctx) return;
    if (detector.loading && detector.targetCtx === ctx) return detector.loading;
    const request = ++detector.request;
    detector.targetCtx = ctx;
    const job = (async () => {
      const node = await ensureDetector(ctx, request);
      if (!node || request !== detector.request || detector.mode !== mode || snapshot.audioContext !== ctx) return;
      if (mode === 'mic') {
        if (!detector.stream || !detector.stream.active) {
          const deviceId = ui.device.value;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: !!prefs.echoCancel, noiseSuppression: false, autoGainControl: false } });
          if (request !== detector.request || detector.mode !== 'mic' || snapshot.audioContext !== ctx) { stream.getTracks().forEach((track) => track.stop()); return; }
          detector.stream = stream;
          for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
            if (detector.stream === stream && detector.mode === 'mic') setSource('mic');
          });
          refreshDevices();
        }
        if (request !== detector.request || detector.mode !== 'mic') return;
        if (detector.mic) { try { detector.mic.disconnect(); } catch (_) {} }
        if (detector.gain) { try { detector.gain.disconnect(); } catch (_) {} }
        // 麥克風增益：音高判斷本身不看音量，放大只是讓小聲的麥克風過得了「有在唱」的音量門檻
        detector.mic = ctx.createMediaStreamSource(detector.stream);
        detector.gain = ctx.createGain();
        detector.gain.gain.value = gainLinear();
        detector.mic.connect(detector.gain).connect(node);
        syncLatencyProfile();
      } else if (mode === 'demo') {
        if (!detector.untapDemo) detector.untapDemo = window.AppShared.connectPracticeVocalTap(node);
      }
    })().catch((error) => { if (request === detector.request) throw error; });
    detector.loading = job;
    try { await job; } finally { if (detector.loading === job) detector.loading = null; }
  }

  function detectorError(error) {
    if (detector.mode === 'off') return;
    detector.request++;
    releaseDetectorNode(); stopMicStream();
    detector.mode = 'off'; ui.source.value = 'off'; ui.deviceField.hidden = true;
    ui.latency.disabled = true; syncLatencyProfile(true);
    engine.setPlaying(false, engine.songTime());
    toast(t('practice.micFailed', { message: error.message || error.name }), 'error');
  }

  async function setSource(mode) {
    feedback.cancel();
    engine.startNewPass();
    const sourceRevision = ++detector.sourceRevision;
    detector.request++; detector.loading = null;
    cancelCalibration(true);
    releaseDetectorNode();
    stopMicStream();
    detector.mode = mode;
    ui.deviceField.hidden = mode !== 'mic';
    ui.gainField.hidden = mode !== 'mic';
    if (ui.echoField) ui.echoField.hidden = mode !== 'mic';
    syncLatencyProfile(true);
    ui.latency.disabled = mode !== 'mic';
    renderLatency();
    renderLevel(0, 0);
    try {
      if (mode === 'demo' && !(window.AppShared.isPracticeVocalAvailable && window.AppShared.isPracticeVocalAvailable())) {
        toast(t('practice.demoNeedsVocals'), 'warning');
      }
      await attachDetector();
    } catch (error) {
      if (sourceRevision === detector.sourceRevision) detectorError(error);
    }
    if (sourceRevision !== detector.sourceRevision) return;
    const clock = currentClock();
    engine.setPlaying(!!(snapshot && snapshot.playing) && detector.mode !== 'off', clock ? clock.t : 0);
    renderGuideState();
  }

  function onPitch(d) {
    syncLatencyProfile();
    if (calibration) { calibrationFrame(d); return; }
    if (!timeline) { engine.pitch(d, null); return; }
    const demo = detector.mode === 'demo';
    // 麥克風：喇叭播出 → 唱 → 麥克風收進來，整段回路由校準值一次扣掉；示範人聲在輸出前就接走，不用扣
    const mapped = timeline.map(d.time, demo
      ? { inputLatencySec: 0, outputLatencySec: 0, dspLatencySec: 0, calibrationMs: 0 }
      : { inputLatencySec: 0, outputLatencySec: 0, dspLatencySec: snapshot && snapshot.dspLatencySeconds || 0, calibrationMs: Number(ui.latency.value) || 0 });
    const frame = mapped.valid ? { valid: true, t: mapped.sourceTime, key: mapped.key, tempo: mapped.tempo, generation: mapped.generation, playing: mapped.playing, audioTime: d.time } : null;
    if (frame && !feedback.acceptsPitch(frame)) return;
    engine.pitch(d, frame);
  }

  async function refreshDevices() {
    const request = ++deviceEnumeration;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (request !== deviceEnumeration) return;
      availableDevices = devices;
      const selected = ui.device.value;
      ui.device.textContent = '';
      const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; ui.device.appendChild(o); };
      add('', t('practice.defaultDevice'));
      devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
        .forEach((d, i) => add(d.deviceId, d.label || `${t('practice.sourceMic')} ${i + 1}`));
      ui.device.value = [...ui.device.options].some((o) => o.value === selected) ? selected : '';
      syncLatencyProfile();
    } catch (_) {
      if (request !== deviceEnumeration) return;
      availableDevices = []; syncLatencyProfile();
    }
  }

  // ── 延遲與校準 ─────────────────────────────────────────────────────────
  function syncLatencyProfile(force) {
    let settings = {};
    const ctx = detector.ctx;
    const stream = detector.stream;
    const active = detector.mode === 'mic' && ctx && snapshot && snapshot.audioContext === ctx && stream && stream.active;
    if (active) {
      try { settings = stream.getAudioTracks()[0].getSettings(); } catch (_) { /* 無法辨識的裝置只在本次使用 */ }
    }
    const route = active ? snapshot.outputSignature : null;
    const changed = latencyProfiles.select(active ? {
      micId: settings.deviceId ? Calibration.resolveDeviceId(settings.deviceId, 'audioinput', availableDevices) : null,
      outputId: Calibration.outputIdentity(route, availableDevices),
      sampleRate: settings.sampleRate, contextSampleRate: ctx.sampleRate, route,
    } : {}, force);
    if (changed) {
      engine.resetInput();
      cancelCalibration(true);
      ui.latency.value = detector.mode === 'mic' ? latencyProfiles.state().ms : 0;
      renderLatency();
    }
    return changed;
  }
  const gainDb = () => Math.max(-12, Math.min(24, Math.round(Number(prefs.micGainDb) || 0)));
  const gainLinear = () => Math.pow(10, gainDb() / 20);
  // 音量條跟「有在唱」的門檻畫在同一把尺上（平方根刻度，小聲時也看得出差多少）
  const meterPct = (rms) => Math.min(100, Math.sqrt(Math.max(0, rms)) * 260);
  function renderLevel(rms, gate) {
    if (!ui.level) return;
    ui.level.style.width = `${meterPct(rms)}%`;
    const showGate = detector.mode === 'mic' && gate > 0;
    ui.levelGate.hidden = !showGate;
    if (showGate) ui.levelGate.style.left = `${meterPct(gate)}%`;
    ui.meter.classList.toggle('is-below', showGate && rms <= gate);
  }

  function renderGain() {
    const db = gainDb();
    ui.gain.value = String(db);
    ui.gainValue.textContent = `${db > 0 ? '+' : ''}${db} dB`;
  }

  function renderLatency() {
    ui.latencyValue.textContent = `${ui.latency.value} ms`;
    if (ui.latencyStatus) {
      const state = latencyProfiles.state();
      ui.latencyStatus.hidden = detector.mode !== 'mic';
      ui.latencyStatus.textContent = t(!state.method ? 'practice.latencyUncalibrated'
        : !state.persistent ? 'practice.latencySession' : state.method === 'acoustic' ? 'practice.latencyCalibrated' : 'practice.latencyManual');
    }
  }

  function cancelCalibration(invalidateResult = false) {
    calibrationAttempt++;
    if (invalidateResult) {
      const hadResult = calibration || calibrationResult || ui.calStart.disabled;
      calibrationResult = null; ui.calApply.hidden = true;
      delete ui.calApply.dataset.value;
      if (hadResult && ui.dialog.open) ui.calStatus.textContent = t('practice.calibrationChanged');
    }
    const c = calibration;
    ui.calStart.disabled = false;
    if (!c) return;
    clearTimeout(c.timer);
    for (const tone of c.tones) { try { tone.stop(); } catch (_) {} tone.disconnect(); }
    for (const gain of c.gains) gain.disconnect();
    calibration = null;
  }

  // 聲學回路校準：從喇叭發出 8 聲 880Hz 短音，量麥克風多久之後收到；中位數取整到 10ms
  async function runCalibration() {
    syncLatencyProfile();
    cancelCalibration(true);
    const attempt = calibrationAttempt;
    const token = latencyProfiles.token();
    ui.calApply.hidden = true; ui.calStart.disabled = true;
    ui.calStatus.textContent = t('practice.calibrationListening');
    try {
      const ctx = detector.ctx;
      if (detector.mode !== 'mic' || !ctx || !detector.stream || !detector.stream.active) throw new Error(t('practice.calibrationNeedMic'));
      await ctx.resume();
      syncLatencyProfile();
      if (!ui.dialog.open || attempt !== calibrationAttempt || !latencyProfiles.isCurrent(token)) return;
      const c = { pulses: [], tones: [], gains: [], floor: [], timer: 0, token };
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
        syncLatencyProfile();
        if (calibration !== c) return;
        const estimate = PracticeScoring.latencyEstimate(c.pulses.filter((p) => p.heard != null).map((p) => (p.heard - p.at) * 1000));
        cancelCalibration();
        if (estimate == null) { ui.calStatus.textContent = t('practice.calibrationFailed'); return; }
        calibrationResult = { token: c.token, ms: estimate };
        ui.calApply.dataset.value = estimate; ui.calApply.hidden = false;
        ui.calStatus.textContent = t('practice.calibrationResult', { ms: estimate });
      }, 7000);
    } catch (error) {
      if (attempt !== calibrationAttempt) return;
      cancelCalibration();
      ui.calStatus.textContent = error.message;
    }
  }

  function calibrationFrame(d) {
    const c = calibration;
    if (!c || !c.pulses.length) return;
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
    feedback.render();
    renderLatency();
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
    ui.loop.addEventListener('click', onLoopClick);
    setInterval(() => {
      if (!feedback.tick || !(feedback.isLooping && feedback.isLooping())) return;
      const clock = currentClock();
      if (clock && clock.playing) feedback.tick(clock.t);
    }, 50);
    // 回饋分頁的「重唱這句」「停止弱句循環」也會開關循環，按鈕字跟著換
    document.getElementById('practice-pane-review')?.addEventListener('click', () => setTimeout(renderLoopControls, 0));
    ui.nextSection.addEventListener('click', onNextSection);
    ui.obsPreview.addEventListener('click', () => {
      const on = !ui.stage.classList.contains('pstage--obs');
      ui.stage.classList.toggle('pstage--obs', on);
      ui.obsPreview.setAttribute('aria-pressed', String(on));
      engine.setStyle({});   // 重算 OBS 專屬的顯示（結算卡等）
    });
    ui.source.addEventListener('change', () => setSource(ui.source.value));
    ui.device.addEventListener('change', () => { if (detector.mode === 'mic') setSource('mic'); });
    ui.gain.addEventListener('input', () => {
      prefs.micGainDb = Number(ui.gain.value) || 0;
      renderGain();
      if (detector.gain) detector.gain.gain.setTargetAtTime(gainLinear(), detector.gain.context.currentTime, 0.02);
    });
    ui.gain.addEventListener('change', () => writeJson(PREFS_KEY, prefs));
    // 沒戴耳機時喇叭放的原唱會被麥克風收進去；瀏覽器的回音消除可以扣掉自己播出去的聲音。
    // 會多一點延遲、可能把歌聲也削弱，所以預設關、讓人自己試；切換要重開麥克風才生效
    if (ui.echo) {
      ui.echo.checked = !!prefs.echoCancel;
      ui.echo.addEventListener('change', () => {
        prefs.echoCancel = ui.echo.checked; writeJson(PREFS_KEY, prefs);
        if (detector.mode === 'mic') { stopMicStream(); setSource('mic'); }
        toast(t('practice.echoCancelChanged'), 'info');
      });
    }
    renderGain();
    ui.latency.addEventListener('input', () => {
      if (detector.mode !== 'mic') return;
      syncLatencyProfile(); cancelCalibration(true);
      latencyProfiles.remember(Number(ui.latency.value), 'manual'); renderLatency();
    });
    ui.octave.addEventListener('change', () => { prefs.allowOctave = ui.octave.checked; writeJson(PREFS_KEY, prefs); feedback.contextChanged(); });
    ui.contour.addEventListener('change', () => { prefs.showContour = ui.contour.checked; writeJson(PREFS_KEY, prefs); });
    ui.modelInstall.addEventListener('click', installModel);
    ui.obsCopy.addEventListener('click', () => {
      const url = obsUrl();
      ui.obsUrl.textContent = url;
      navigator.clipboard.writeText(url).then(() => toast(t('practice.copied'), 'success')).catch(() => toast(url, 'info'));
    });

    ui.calibrate.addEventListener('click', () => {
      syncLatencyProfile(); cancelCalibration(true);
      ui.calStatus.textContent = detector.mode === 'mic' ? '' : t('practice.calibrationNeedMic');
      ui.calApply.hidden = true;
      ui.dialog.showModal();
    });
    ui.calStart.addEventListener('click', runCalibration);
    ui.calClose.addEventListener('click', () => ui.dialog.close());
    ui.dialog.addEventListener('close', () => cancelCalibration(true));
    ui.calApply.addEventListener('click', () => {
      syncLatencyProfile();
      const result = calibrationResult;
      if (!result || !latencyProfiles.remember(result.ms, 'acoustic', result.token)) { cancelCalibration(true); return; }
      ui.latency.value = result.ms; renderLatency();
      ui.dialog.close();
    });
    window.addEventListener('pagehide', () => {
      detector.request++; detector.sourceRevision++; detector.loading = null;
      cancelCalibration(true); releaseDetectorNode(); stopMicStream();
    });
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => {
      availableDevices = []; syncLatencyProfile(true);
      refreshDevices();
      if (detector.mode === 'mic') setSource('mic');
    });

    document.addEventListener('view:change', (e) => {
      visible = e.detail && e.detail.view === 'practice';
      if (!visible) return;
      ui.obsUrl.textContent = obsUrl();
      renderKey();
      feedback.refresh();
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
        feedback.reconnect();
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
    feedbackPoll = setInterval(() => { if (visible && trackId) feedback.refresh(); }, 5000);
    window.addEventListener('pagehide', () => clearInterval(feedbackPoll));
  }

  init();
})();
