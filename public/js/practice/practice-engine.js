/**
 * 練唱引擎：音軌畫面、評分、技巧標籤、評等演出與結算。面板與 OBS 練唱疊加層共用。
 *
 *   role 'panel'  — 收麥克風（或原唱示範）的音高，評分，並把畫面需要的資料交給 onSync 送出
 *   role 'source' — OBS 疊加層：不碰麥克風也不出聲，只把 receive() 收到的資料畫出來
 *
 * 時間一律是原曲秒數；音高一律換回原調（使用者音高減掉當下的 Key）。畫面上的音名才加回目前的 Key。
 * 只在 root 底下找自己的元素（[data-ps=…]），外觀 class 也只掛在 root 上，不碰其他頁面。
 */
(function (root, factory) {
  const api = factory(root.PracticeScoring, root.PracticeFx);
  if (root) root.PracticeEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Scoring, Fx) {
  'use strict';

  const { RULE, credit, centsOff, foldToTarget, resetNote, noteScore, tierOf, activeNote } = Scoring;
  const RENDER_DELAY = 0.08;   // OBS 晚 80ms 畫：等面板的資料先到，畫面才不會一頓一頓
  const SYNC_INTERVAL_MS = 50;
  const DIAG_MAX_ROWS = 12000; // 25 格／秒，約 8 分鐘
  const CLOCK_SNAP_SEC = 0.3;
  const CLOCK_CORRECTION_PER_FRAME = 0.06; // 60fps 一幀校正的比例，跟 /display 的歌詞時鐘同一套
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (m) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  const rgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16) || 0; return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const freshTech = () => ({ VIBRATO: 0, 'LONG TONE': 0, SLIDE: 0 });
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /**
   * OBS 端的播放時鐘。面板每 50ms 送一次時間，封包到達有快有慢；每包都直接重設基準的話，
   * 晚到的那包會把畫面往回拉（回彈）。這裡自己往前走，只用封包慢慢校正，差太多（跳轉）才直接跳。
   * 校正量按實際經過時間換算，一幀呼叫幾次、OBS 跑幾 fps 都一樣。
   */
  function createFollowClock(delay = RENDER_DELAY) {
    let t = 0, wall = null, snap = true;
    let anchor = { playing: false, t: 0, tempo: 1, at: 0 };
    return {
      sync(clock, now) { anchor = { playing: !!clock.playing, t: clock.t, tempo: clock.tempo || 1, at: now }; },
      reset() { snap = true; },
      read(now) {
        const dt = wall === null ? 0 : Math.max(0, now - wall);
        wall = now;
        if (!anchor.playing) {
          // 暫停停在原地（播放中本來就晚 delay 秒），恢復時才接得上；只有暫停中跳轉才動。
          if (snap || Math.abs(anchor.t - t) > CLOCK_SNAP_SEC) { t = anchor.t; snap = false; }
          return t;
        }
        const target = anchor.t + (now - anchor.at) * anchor.tempo - delay;
        const free = t + dt * anchor.tempo;
        const diff = target - free;
        if (snap || Math.abs(diff) > CLOCK_SNAP_SEC) { t = target; snap = false; return t; }
        t = Math.max(t, free + diff * (1 - Math.pow(1 - CLOCK_CORRECTION_PER_FRAME, dt * 60)));
        return t;
      },
    };
  }

  // notes 按 start 排序，但長音可能重疊；用既有的累積最大 end 索引，不能只搜尋 end。
  function firstAtOrAfter(items, key, time) {
    let lo = 0, hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (items[mid][key] < time) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function createPracticeEngine(options) {
    const role = options.role === 'source' ? 'source' : 'panel';
    const host = options.root;
    const t = options.t || ((key) => key);
    const el = (name) => host.querySelector(`[data-ps="${name}"]`);
    const canvas = el('canvas');
    const g2 = canvas.getContext('2d');
    const state = {
      guide: null, style: { ...Fx.STYLE_DEFAULT }, playing: false, key: 0,
      trail: [], user: null, tags: [], particles: [], rings: [], ratings: [], combo: 0, maxCombo: 0,
      techCount: freshTech(), tagLine: null, lastLineDone: -1, segmentStart: 0, view: null, x0: 0,
      voice: { on: false, floor: 0.0015, guardFloor: 0.0015, prevMidi: 0, quiet: 0, quietHinted: false,
        noise: new Float32Array(32), noiseSort: new Float32Array(32), noiseCount: 0, noisePos: 0,
        noiseAt: -Infinity, rawMidi: 0, periodicFrames: 0, localQuiet: 0 }, recent: [], euro: null,
      refTime: 0, voicedTime: 0, unscorable: false, scoreTarget: null, scoreShown: 0,
      result: null, resultKey: null, resultAnim: 0, lyricLine: -1,
      clock: { playing: false, t: 0, at: Date.now() },   // source 用：面板送來的時鐘
      lastPanelT: 0, pitchClock: null, baseGuide: null, range: null, take: null, finished: false,
      pitchSample: null, pitchTrace: [], traceStep: 0.025, ghost: [], silence: 0,
      passStart: 0, passEnd: 0, discontinuous: false, context: null, mixedContext: false, diag: [], diagTick: 0,
    };
    const sync = { lastT: -Infinity, dirty: new Set(), events: [], sentAt: 0 };
    const followClock = createFollowClock();
    let frameHandle = 0;
    let destroyed = false;
    let renderDirty = true;
    let blankPainted = false;
    let lastPaint = null;
    let attemptedThrough = -Infinity;

    const FX = () => Fx.resolveFx(state.style.fx);
    const C = () => state.style;
    const isObs = () => host.classList.contains('pstage--obs');
    const cssVar = (name, fallback) => getComputedStyle(host).getPropertyValue(name).trim() || fallback;
    const allowOctave = () => (options.getOptions ? options.getOptions().allowOctave !== false : true);
    const scoreMode = () => (options.getOptions && options.getOptions().scoreMode === 'strict' ? 'strict' : 'relaxed');
    const profile = () => Scoring.profileOf(scoreMode());

    // ── 時間 ───────────────────────────────────────────────────────────────
    function songTime() {
      if (role === 'source') return followClock.read(performance.now() / 1000);
      const clock = options.clock ? options.clock() : null;
      return clock && Number.isFinite(clock.t) ? clock.t : state.lastPanelT;
    }

    // ── 外觀 ───────────────────────────────────────────────────────────────
    function setStyle(style) {
      renderDirty = true;
      Object.assign(state.style, style || {});
      const s = state.style, cls = host.classList, rs = host.style;
      // 掛上整條繼承鏈（例：華麗 → fx-normal fx-warm fx-grand），新風格沒寫的動畫就沿用父風格
      const chain = Fx.fxChain(s.fx);
      for (const id of Fx.FX_IDS) cls.toggle('fx-' + id, chain.includes(id));
      cls.toggle('no-bg', !s.bg); cls.toggle('lane-top', s.pos === 'top'); cls.toggle('hide-score', !s.score);
      cls.toggle('hide-lyrics', !s.lyrics); cls.toggle('strong-edge', !!s.edge);
      rs.setProperty('--pf-bg-fill', rgba(s.bgColor, s.bgOpacity / 100));
      rs.setProperty('--pf-lane-h', `${s.laneH}vh`);
      rs.setProperty('--pf-lane-ratio', String(s.laneH / 100));   // 面板的 OBS 預覽框按比例縮
      rs.setProperty('--pf-fill', s.fill); rs.setProperty('--pf-voice', s.voice);
      renderResult();
    }

    // ── 歌曲 ───────────────────────────────────────────────────────────────
    /** panel：PracticeScoring.prepareGuide() 整理過的音高資料；source：面板送來、已整理好的音符。 */
    function setGuide(guide) {
      state.guide = guide;
      state.baseGuide = guide ? { ...guide, notes: guide.notes.map((n) => ({ ...n })) } : null;
      state.range = null; state.take = null; state.ghost = [];
      if (guide && role === 'source') {
        let maxEnd = -Infinity;
        guide.notes.forEach((note, i) => { maxEnd = Math.max(maxEnd, note.end); note.prefixEnd = maxEnd; note.i = i; resetNote(note); });
        const midis = guide.notes.map((n) => n.midi);
        guide.lo = (midis.length ? Math.min(...midis) : 60) - 2; guide.hi = (midis.length ? Math.max(...midis) : 72) + 2;
        guide.exclusions = guide.exclusions || [];
      }
      state.view = null; state.lyricLine = -1;
      if (!guide) clearTake();
      restart(false);
      announce();
      emit('all');
    }

    /** panel：把目前的歌曲送給 OBS（載入時、重新連線後）；不動評分。 */
    function announce() {
      const guide = state.guide;
      if (!guide || role !== 'panel' || !options.onSync) return;
      options.onSync({ type: 'song', song: { key: guide.guideId || '', trackId: guide.trackId || '', title: guide.title || '', duration: guide.duration,
        lines: guide.lines, notes: guide.notes.map((n) => ({ start: n.start, end: n.end, midi: n.midi, line: n.line, word: n.word, excluded: n.excluded })) } });
      sync.lastT = -Infinity;
      for (const n of guide.notes) if (n.fills.length || n.seen) sync.dirty.add(n.i);
      syncFrame();
    }

    /** 換歌或卸下歌曲：上一首的分數、評等、結算、歌詞都不能留在畫面上。 */
    // 整首的顯示音域：取第 2～98 百分位（一兩個偵測錯的極端音不會把整片壓扁），上下各留 3 個半音，至少 14 個半音
    function songRange(guide) {
      const pitches = guide.notes.filter((n) => !n.excluded && Number.isFinite(n.midi)).map((n) => n.midi).sort((a, b) => a - b);
      if (!pitches.length) return { lo: 54, hi: 72 };
      const at = (q) => pitches[Math.min(pitches.length - 1, Math.max(0, Math.round(q * (pitches.length - 1))))];
      let lo = Math.floor(at(0.02)) - 3, hi = Math.ceil(at(0.98)) + 3;
      if (hi - lo < 14) { const c = (lo + hi) / 2; lo = Math.floor(c - 7); hi = lo + 14; }
      return { lo, hi };
    }

    function clearTake() {
      Object.assign(state, { ratings: [], scoreTarget: null, scoreShown: 0, unscorable: false, result: null, lastLineDone: -1,
        trail: [], tags: [], particles: [], rings: [], user: null, combo: 0, maxCombo: 0, techCount: freshTech(), tagLine: null,
        refTime: 0, voicedTime: 0, playing: false, take: null, finished: false, pitchSample: null, pitchTrace: [], ghost: [] });
      Object.assign(state.voice, { quiet: 0, quietHinted: false });
      for (const name of ['ratings', 'lyricNow', 'lyricNext', 'status']) { const node = el(name); if (node) node.textContent = ''; }
      renderResult();
    }

    /** 從頭（或第一次載入）：所有音符與統計歸零。 */
    function restart(notify = true) {
      if (!state.guide) return;
      for (const n of state.guide.notes) resetNote(n);
      state.ratings = []; state.scoreTarget = null; state.scoreShown = 0; state.lastLineDone = -1;
      state.refTime = 0; state.voicedTime = 0; state.unscorable = false; state.lyricLine = -1;
      state.finished = false; state.pitchTrace = []; state.traceStep = 0.025; state.pitchSample = null;
      state.context = null; state.mixedContext = false; state.discontinuous = false; state.diag = []; state.diagTick = 0;
      state.passStart = state.range ? state.range.start : 0; state.passEnd = state.passStart;
      resetFrom(state.passStart);
      if (notify && role === 'panel') { sync.lastT = -Infinity; sync.dirty.clear(); options.onSync && options.onSync({ type: 'seek', offset: state.passStart }); }
      emit('all');
    }

    /** 跳轉：之後的音符、評等與軌跡重算，之前的保留；跳進去時唱到一半的音不計。每次開始播放都是新的一輪。 */
    function resetFrom(offset) {
      if (!state.guide) return;
      attemptedThrough = -Infinity;
      state.segmentStart = offset;
      state.pitchSample = null; state.silence = 0;
      for (const n of state.guide.notes) if (n.end > offset) { resetNote(n); n.skip = n.start < offset; }
      state.trail = []; state.tags = []; state.euro = null; state.recent = []; state.combo = 0; state.tagLine = null;
      state.maxCombo = 0; state.techCount = freshTech();
      state.result = null; state.user = null; state.particles = []; state.rings = [];
      const layer = el('ratings'); if (layer) layer.textContent = '';
      state.ratings = state.ratings.filter((r) => state.guide.lines[r.line] && state.guide.lines[r.line].end <= offset);
      state.lastLineDone = state.ratings.length ? state.ratings[state.ratings.length - 1].line : -1;
      state.refTime = state.guide.notes.reduce((sum, n) => sum + (!n.excluded && !n.skip ? n.seen : 0), 0);
      state.voicedTime = state.guide.notes.reduce((sum, n) => sum + (!n.excluded && !n.skip ? n.voiced : 0), 0);
      resetInput();
      renderResult();
    }

    /** 面板：播放器跳轉了（拖進度條、手機遙控、換段落）。 */
    function seek(offset) {
      if (!Number.isFinite(offset)) return;
      if (state.finished) { restart(false); state.passStart = offset; }
      else if (!state.pitchTrace.length && !state.guide.notes.some((n) => n.seen > 0)) state.passStart = offset;
      else if (Math.abs(offset - state.passEnd) > 0.08) state.discontinuous = true;
      state.pitchTrace = state.pitchTrace.filter((p) => p.t < offset);
      state.passEnd = offset;
      resetFrom(offset);
      if (role === 'panel') {
        sync.lastT = -Infinity; sync.dirty.clear();
        options.onSync && options.onSync({ type: 'seek', offset });
        refreshScore(); syncFrame();
      }
      emit('all');
    }

    /** 面板：暫停（先把已唱完的句子結算）；續唱不重置。 */
    function setPlaying(playing, at) {
      if (role !== 'panel') return;
      if (!!playing !== state.playing) { state.pitchSample = null; state.silence = 0; }
      if (!playing && state.playing && state.guide) { checkLines(at); refreshScore(); }
      if (playing && state.result) seek(at);   // 唱完後再播：新的一輪
      else if (playing && !state.playing && Number.isFinite(at) && Math.abs(at - state.lastPanelT) > 0.25) seek(at);   // 暫停中拖過進度
      if (state.playing !== !!playing) resetInput();
      state.playing = !!playing;
      if (Number.isFinite(at)) state.lastPanelT = at;
      syncFrame();
    }

    /** 面板播放中：時間突然跳了（拖進度、手機遙控、換段落）就當成跳轉；不必等播放器另外通知。
     *  畫面更新與同步（音訊執行緒推動，背景分頁也照跑）都會呼叫，所以分頁在背景時不會誤判。 */
    function follow(time) {
      const prev = state.lastPanelT;
      const jumped = time - prev > 0.6 || time < prev - 0.25;
      state.lastPanelT = time;
      if (!jumped) return;
      if (time > prev) checkLines(prev + 0.3);   // 跳走前剛唱完的那句先結算，不要因為跳轉而漏評
      seek(time);
    }

    function setKey(key) { state.key = Number.isFinite(key) ? key : 0; renderDirty = true; }

    // 新音訊來源、校準或播放邊界不能接上上一段的積分／平滑歷史。
    function resetInput() {
      state.pitchClock = null; state.pitchSample = null; state.silence = 0; state.recent = []; state.euro = null;
      state.voice.on = false; state.voice.prevMidi = 0;
      state.voice.noiseCount = 0; state.voice.noisePos = 0; state.voice.noiseAt = -Infinity;
      state.voice.rawMidi = 0; state.voice.periodicFrames = 0;
      state.voice.localQuiet = 0;
    }

    // ── 音高 → 評分（panel）─────────────────────────────────────────────────
    /** d：偵測器一格 {f0, clarity, rms}；mapped：播放時鐘換算 {valid, t（原曲秒數，已扣延遲）, key}。 */
    function pitch(d, mapped) {
      if (role !== 'panel' || !state.guide) return;
      options.onLevel && options.onLevel(d.rms, state.guide ? voiceGate(d) : 0);
      if (!state.playing || !mapped || !mapped.valid || mapped.playing === false || !Number.isFinite(mapped.t) || mapped.t < 0) {
        resetInput(); return;
      }
      const time = mapped.t;
      const clock = options.clock ? options.clock() : null;
      const context = { key: Number.isFinite(mapped.key) ? mapped.key : state.key,
        tempo: Number.isFinite(mapped.tempo) ? mapped.tempo : clock && clock.tempo || 1, allowOctave: allowOctave(), scoreMode: scoreMode() };
      const tempo = Number.isFinite(mapped.tempo) && mapped.tempo > 0 ? mapped.tempo : 1;
      const audioTime = Number.isFinite(mapped.audioTime) ? mapped.audioTime : null;
      const previous = state.pitchClock;
      // 重送、延遲到達的舊格不能重複給分，也不能倒退積分起點。
      if (previous && (Number.isFinite(mapped.generation) && Number.isFinite(previous.generation) && mapped.generation < previous.generation
        || audioTime != null && previous.audioTime != null && audioTime <= previous.audioTime)) return;
      const boundary = previous && mapped.generation !== previous.generation;
      if (previous && !boundary && time <= previous.t) return;
      const target = activeNote(state.guide.notes, time);
      if (target && !target.skip) {
        if (!state.context) state.context = context;
        else if (context.key !== state.context.key || Math.abs(context.tempo - state.context.tempo) > 0.0001
            || context.allowOctave !== state.context.allowOctave || context.scoreMode !== state.context.scoreMode) state.mixedContext = true;
      }
      const delta = previous && !boundary ? time - previous.t : 0;
      const elapsed = previous && audioTime != null && previous.audioTime != null ? audioTime - previous.audioTime : delta / tempo;
      const gap = elapsed > 0.03 || delta > 0.06;
      if (boundary) state.discontinuous = true;
      const sample = state.pitchSample;
      if (boundary || gap) resetInput();
      state.pitchClock = { t: time, audioTime, generation: mapped.generation };
      // 以原曲秒數積分；漏格先重建取樣邊界，不補算未觀察到的唱聲。
      const dt = gap ? 0 : delta;
      const onsetCandidate = !state.voice.on ? state.voice.prevMidi : 0;
      let midi = voicing(d, time, audioTime);
      const confirmedOnset = onsetCandidate && midi && Math.abs(midi - onsetCandidate) <= .25;
      if (midi) midi -= context.key + (state.guide.tuning || 0);   // 換回原調；原唱整體偏高／偏低時目標跟著原唱
      // 只保留實測音高；把修正後的八度餵回歷史會讓真正跳八度永遠折回舊音。
      state.recent.push(midi); if (state.recent.length > 30) state.recent.shift();
      // 中值平滑 3 格。voicing 已確認兩格的音頭不必再次等候；
      // 只有兩個不同音高時不能固定選較高者，也不能跨短暫失聲帶回舊高音。
      const last3 = state.recent.slice(-3).filter((v) => v > 0).sort((a, b) => a - b);
      const supported = last3.length === 3 || last3.length === 2 && last3[1] - last3[0] < 1
        || last3.length === 1 && confirmedOnset;
      midi = midi > 0 && supported ? last3[last3.length >> 1] : 0;
      if (sample && !boundary && !gap && dt > 0) {
        scoreInterval(sample.t, time, sample.midi);
        state.silence = sample.midi ? 0 : state.silence + delta;
        if (midi && !sample.midi && state.silence >= 0.03) {
          const candidate = state.guide.notes.find((n) => !n.excluded && !n.skip && n.onset == null
            && time >= n.start - 0.25 && time <= n.start + 0.5 && centsOff(midi, n.midi, allowOctave()) < 300);
          if (candidate) candidate.onset = time - candidate.start;
        }
      }
      state.pitchSample = { t: time, midi, generation: mapped.generation };

      const bounds = state.range || { start: 0, end: state.guide.duration };
      if (time >= bounds.start && time <= bounds.end) {
        state.passEnd = Math.max(state.passEnd, time);
        const tail = state.pitchTrace[state.pitchTrace.length - 1];
        if (!tail || time - tail.t >= state.traceStep || (!!midi !== !tail.gap)) {
          state.pitchTrace.push(midi ? { t: time, midi } : { t: time, gap: true });
          if (state.pitchTrace.length > 12000) { state.pitchTrace = state.pitchTrace.filter((_, i) => i % 2 === 0); state.traceStep *= 2; }
        }
      }
      pushTrail(time, midi, d.rms);
      recordDiagnostic(time, d, midi);
      // 同步跟著音訊執行緒的節奏送：面板在背景分頁時計時器會被限流，這條路不會
      if (performance.now() - sync.sentAt >= SYNC_INTERVAL_MS) syncFrame();
    }

    // 有聲判定：主要看清晰度（跟音量無關）；音量只用來擋掉真正的安靜。
    // 進入有聲要求嚴（清晰度高、連兩格音高接近），離開放寬，避免一句話中間閃斷。
    const VOICE_MIN_RMS = 0.0006;     // 最低可用能量；更小的收音仍需使用者調整增益
    const VOICE_FLOOR_MAX = 0.004;    // 噪音底封頂 → 門檻最高約 −43 dBFS
    const VOICE_FLOOR_RATIO = 1.8;    // 高出噪音底約 5 dB 就算有聲
    function localVoiceSupport(d) {
      return d.clarity > .95 && d.localClarity > .85 || d.clarity > .88 && d.localClarity > .95;
    }
    function voiceGate(d) {
      const floor = d && localVoiceSupport(d) ? state.voice.floor : state.voice.guardFloor;
      return Math.max(VOICE_MIN_RMS, floor * VOICE_FLOOR_RATIO);
    }
    function nearNote(time) {
      const notes = state.guide.notes;
      return !!(activeNote(notes, time) || activeNote(notes, time - 0.3) || activeNote(notes, time + 0.3));
    }
    function voicing(d, time, audioTime) {
      const v = state.voice;
      const now = Number.isFinite(audioTime) ? audioTime : time;
      const expecting = nearNote(time);
      const m = d.f0 > 0 ? 69 + 12 * Math.log2(d.f0 / 440) : 0;
      // 參考軌可能漏音；符合既有進入／保持週期性條件的唱聲，不能被反過來學成噪音。
      // 不限制前後音高差，避免快速轉音或真跳八度把下一段的小聲演唱擋掉。
      const periodic = m && (v.on ? d.clarity >= 0.55 : d.clarity > 0.75);
      // 保留原來的保守門檻；只有本格具備額外聲音證據時才採用抗瞬間干擾的背景估計。
      if (!expecting && !periodic) v.guardFloor = Math.min(VOICE_FLOOR_MAX, Math.max(VOICE_MIN_RMS / 2, v.guardFloor * .98 + d.rms * .02));
      if (!periodic && (!expecting || d.rms < v.floor) && now - v.noiseAt >= .05) {
        v.noiseAt = now;
        v.noise[v.noisePos] = d.rms;
        v.noisePos = (v.noisePos + 1) % v.noise.length;
        v.noiseCount = Math.min(v.noise.length, v.noiseCount + 1);
        if (v.noiseCount >= 8) {
          for (let i = 0; i < v.noiseCount; i++) v.noiseSort[i] = v.noise[i];
          const samples = v.noiseSort.subarray(0, v.noiseCount); samples.sort();
          const background = Math.max(VOICE_MIN_RMS / 2, Math.min(VOICE_FLOOR_MAX, samples[Math.floor((v.noiseCount - 1) * .25)]));
          v.floor += (background - v.floor) * (background < v.floor ? .2 : .02);
        }
      }
      const supportedWeak = localVoiceSupport(d);
      const localClear = d.clarity > .75 || !Number.isFinite(d.localClarity) || d.localClarity >= .55;
      v.periodicFrames = m && d.clarity > .88 && d.localClarity > .95
        ? v.rawMidi && Math.abs(m - v.rawMidi) < 1 ? v.periodicFrames + 1 : 1 : 0;
      v.rawMidi = m;
      // 連續的局部週期性限制非週期噪音的上界，不將整個母音音量學成噪音底。
      if (v.periodicFrames >= 3) v.floor = Math.min(v.floor,
        Math.max(VOICE_MIN_RMS / 2, d.rms * Math.sqrt(Math.max(.01, 1 - d.localClarity))));
      const floor = supportedWeak ? v.floor : v.guardFloor;
      const loud = d.rms > Math.max(VOICE_MIN_RMS, floor * VOICE_FLOOR_RATIO)
        || (d.clarity > 0.88 && d.rms > Math.max(VOICE_MIN_RMS * 2, floor * 1.15));
      // 該唱的地方明明有清楚的音高，只是音量沒過門檻：累計起來提示麥克風太小聲
      if (expecting && m && d.clarity > 0.8 && !loud) {
        v.quiet += 0.01;
        if (v.quiet >= 1.5 && !v.quietHinted) { v.quietHinted = true; options.onHint && options.onHint('quiet'); }
      } else if (expecting && loud && m) v.quiet = Math.max(0, v.quiet - 0.02);
      if (!v.on) {
        v.localQuiet = 0;
        const candidate = d.clarity > 0.75 && localClear && loud ? m : 0;
        const steady = candidate && ((v.prevMidi && Math.abs(candidate - v.prevMidi) < 1) || d.clarity > 0.88);
        v.prevMidi = candidate;
        if (steady) v.on = true;
        return v.on ? m : 0;
      }
      if (!m || d.clarity < 0.55 || !loud) { v.on = false; v.prevMidi = 0; v.localQuiet = 0; return 0; }
      // 局部不確定的格子不輸出音高；只保留一格進入狀態，避免下一個實測弱音重等音頭。
      if (!localClear) {
        if (++v.localQuiet >= 2) { v.on = false; v.prevMidi = 0; }
        return 0;
      }
      v.localQuiet = 0;
      v.prevMidi = m;
      return m;
    }

    // 顯示用（不影響評分）：1€ 濾波器——穩定的長音壓得很平，快速滑音時自動放寬跟得上
    function oneEuro(x, time) {
      const minCutoff = 1.2, beta = 0.35, dCutoff = 1.0;
      const alpha = (cutoff, dt) => { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); };
      const f = state.euro;
      if (!f || time - f.t > 0.08 || time <= f.t) { state.euro = { t: time, x, dx: 0 }; return x; }
      const dt = time - f.t, dx = (x - f.x) / dt;
      const edx = f.dx + alpha(dCutoff, dt) * (dx - f.dx);
      const nx = f.x + alpha(minCutoff + beta * Math.abs(edx), dt) * (x - f.x);
      state.euro = { t: time, x: nx, dx: edx };
      return nx;
    }

    // 問題回報用：每 40ms 留一格偵測中間值，只在本機；使用者送出回報才會帶上其中幾句。沒有聲音本身。
    function recordDiagnostic(time, d, midi) {
      if (++state.diagTick % 4) return;
      const n = activeNote(state.guide.notes, time);
      state.diag.push([time, d.f0 || 0, d.clarity || 0, d.localClarity || 0, d.rms || 0, state.voice.floor || 0, midi || 0, n ? Scoring.targetOf(n, profile()) : 0]);
      if (state.diag.length > DIAG_MAX_ROWS) state.diag.splice(0, 1000);
    }

    /** 最弱的兩句（各最多 6 秒）；沒有結算時給最後 12 秒。 */
    function diagnosticSnapshot() {
      if (!state.guide || !state.diag.length) return null;
      const last = state.diag[state.diag.length - 1][0];
      const weak = state.take && state.take.weakLines || [];
      const windows = weak.length ? weak.slice(0, 2).map((l) => [l.start, Math.min(l.end, l.start + 6)]) : [[last - 12, last]];
      const rows = state.diag.filter(([t]) => windows.some(([a, b]) => t >= a && t <= b)).slice(0, 300);
      if (!rows.length) return null;
      const take = state.take;
      return { rows, scoreMode: take && take.scoreMode || scoreMode(), allowOctave: allowOctave(), key: state.key, tuning: state.guide.tuning || 0,
        score: take && take.score != null ? take.score : null, algorithm: state.guide.algorithm || '', algorithmVersion: state.guide.algorithmVersion || '' };
    }

    function pushTrail(time, midi, rms) {
      if (!midi) { state.trail.push({ t: time, gap: true }); state.user = null; return; }
      const n = activeNote(state.guide.notes, time), target = n ? n.midi : null;
      const folded = foldToTarget(midi, target, allowOctave());
      const smooth = oneEuro(folded, time);
      const rule = profile();
      const err = target == null ? Infinity : Math.abs(smooth - foldToTarget(Scoring.targetOf(n, rule), target, allowOctave())) * 100;
      const ok = err <= rule.fullCents, near = err <= rule.zeroCents;
      // 吸附：唱在容許範圍內就往目標那一行拉（保留 25% 的真實起伏，看得出在唱）
      const ribbon = ok ? target + (smooth - target) * 0.25 : smooth;
      const q = Math.round(smooth), bar = target != null && Math.abs(q - target) <= 1 && ok ? target : q;
      state.trail.push({ t: time, raw: folded, ribbon, bar, ok, near, v: Math.min(1, Math.sqrt(rms) * 4) });
      state.user = { t: time, midi: ribbon };
    }

    function scoreInterval(start, end, midi) {
      // Split at note and grace boundaries. A frame crossing a note cannot credit the next note.
      const notes = state.guide.notes, rule = profile();
      for (let i = firstAtOrAfter(notes, 'prefixEnd', start); i < notes.length; i++) {
        const n = notes[i];
        if (n.start >= end) break;
        if (n.end <= start || n.skip || n.excluded) continue;
        const a = Math.max(start, n.start + n.grace), b = Math.min(end, n.end);
        if (midi && end > n.start && start < n.start + n.grace
            && centsOff(midi, Scoring.targetOf(n, rule), allowOctave()) <= rule.fullCents) addFill(n, Math.min(end, n.end));
        if (b <= a) continue;
        const dt = b - a;
        n.seen += dt; state.refTime += dt; n.attempted = true; sync.dirty.add(n.i);
        if (!midi) continue;
        state.voicedTime += dt; n.voiced += dt;
        const goal = Scoring.targetOf(n, rule);
        const signed = (foldToTarget(midi, goal, allowOctave()) - goal) * 100;
        n.signedCentsSum += signed * dt; n.absoluteCentsSum += Math.abs(signed) * dt;
        const k = credit(Math.abs(signed), rule);
        n.hit += dt * k;
        if (k >= 0.4) { addFill(n, a); addFill(n, b); }
      }
    }

    function addFill(n, time) {
      sync.dirty.add(n.i);
      const last = n.fills[n.fills.length - 1];
      if (last && time - last[1] < 0.035) last[1] = time; else n.fills.push([time, time]);
    }

    // 已經唱過去的音符總長（可評分時間）；不靠偵測器有沒有送資料，麥克風完全沒聲音也算得出來
    function isSilent(time) {
      let ref = 0;
      for (const n of state.guide.notes) {
        if (n.start > time) break;
        if (n.skip || n.excluded || n.end > time || !n.attempted) continue;
        ref += n.end - n.start - n.grace;
      }
      return ref > RULE.silentRef && state.voicedTime / ref < RULE.silentRatio;
    }

    function checkLines(time, attemptedUntil = time) {
      if (!state.guide) return;
      // 舊音符已標記過；只重看上一輪仍在音頭寬容期內的音，以及這輪新開始的音。
      // 保留最大寬容期，短音／長音交錯時也不會漏標；跳轉會重設這個游標。
      const allNotes = state.guide.notes;
      for (let i = firstAtOrAfter(allNotes, 'start', attemptedThrough - RULE.graceMax - 1e-9); i < allNotes.length; i++) {
        const n = allNotes[i];
        if (n.start > time) break;
        if (!n.skip && !n.excluded && n.start >= state.segmentStart && n.start + n.grace < attemptedUntil) n.attempted = true;
      }
      if (Number.isFinite(time) && Number.isFinite(attemptedUntil)) attemptedThrough = Math.max(attemptedThrough, Math.min(time, attemptedUntil));
      const lines = state.guide.lines;
      for (let i = state.lastLineDone + 1; i < lines.length && lines[i].end + 0.25 < time; i++) {
        const notes = state.guide.notes.filter((n) => n.line === i && !n.excluded && !n.skip);
        state.lastLineDone = i;
        if (!notes.length || lines[i].start < state.segmentStart - 0.01) continue; // 跳轉時已唱到一半的句子不評
        if (isSilent(time)) { state.unscorable = true; continue; }                 // 沒收到聲音：不給 MISS，整體顯示無法評分
        state.unscorable = false;
        const sung = notes.reduce((a, n) => a + n.voiced, 0), want = notes.reduce((a, n) => a + Math.max(0, n.end - n.start - n.grace), 0);
        if (want > 0 && sung / want < RULE.unsungLine) { state.combo = 0; continue; } // 整句幾乎沒唱：不跳評等，MISS 只給唱偏的句子
        let sum = 0, len = 0;
        for (const n of notes) { const l = n.end - n.start - n.grace; if (l > 0) { sum += noteScore(n, profile()) * l; len += l; } }
        const s = len ? sum / len : 0;
        const tag = tierOf(s);
        state.combo = tag === 'PERFECT' || tag === 'GREAT' ? state.combo + 1 : 0;
        state.maxCombo = Math.max(state.maxCombo, state.combo);
        state.ratings.push({ line: i, tag, s });
        showRating(tag, state.combo);
        sync.events.push({ k: 'rating', tag, combo: state.combo });
        emit('ratings');
      }
    }

    function refreshScore() {
      if (!state.guide) return;
      let sum = 0, len = 0;
      for (const n of state.guide.notes) {
        if ((!n.attempted && n.seen <= 0) || n.skip || n.excluded) continue;
        const l = n.end - n.start - n.grace;
        if (l > 0) { sum += noteScore(n, profile()) * l; len += l; }
      }
      state.scoreTarget = len > 2 ? 100 * sum / len : null;
      state.unscorable = isSilent(songTime());
    }

    /** 唱完（播放器到了結尾）：結算並交給 OBS。 */
    function finish(source, completion = {}) {
      if (role !== 'panel' || !state.guide) return null;
      if (state.finished) return state.take;
      const bounds = state.range || { start: 0, end: state.guide.duration };
      // The EOF event is an acknowledged source endpoint; the audible clock can still
      // lag behind it because of output/routing latency. This extends required scope only.
      const endpoint = completion && Number.isFinite(completion.end) ? completion.end : songTime();
      const end = Math.min(bounds.end, Math.max(bounds.start, state.passEnd, endpoint));
      checkLines(end + 0.3, end); refreshScore();
      state.playing = false; state.pitchSample = null; state.finished = true;
      const notes = state.guide.notes.filter((n) => !n.skip && !n.excluded && n.start < end && (n.attempted || n.seen > 0))
        .map((n) => ({ ...n, end: Math.min(n.end, end) }));
      const seconds = notes.reduce((sum, n) => sum + Math.max(0, n.end - n.start - n.grace), 0);
      const excluded = state.guide.exclusions.reduce((sum, r) => sum + Math.max(0, Math.min(r.end, bounds.end) - Math.max(r.start, bounds.start)), 0);
      const lineFeedback = Scoring.lineFeedback({ ...state.guide, notes }, profile());
      const observedSeconds = notes.reduce((sum, n) => sum + n.seen, 0);
      const voicedSeconds = notes.reduce((sum, n) => sum + n.voiced, 0);
      const finalScore = seconds > 2 && observedSeconds > 0 && voicedSeconds > 0 && !state.unscorable
        ? Math.min(100, 100 * notes.reduce((sum, n) => sum + noteScore(n, profile()) * Math.max(0, n.end - n.start - n.grace), 0) / seconds) : null;
      state.scoreTarget = finalScore;
      const context = state.context || { key: state.key, tempo: 1, allowOctave: allowOctave(), scoreMode: scoreMode() };
      const partial = state.discontinuous || state.passStart > bounds.start + 0.05 || end < bounds.end - 0.1;
      state.take = Scoring.snapshot({ score: finalScore, source: source === 'demo' ? 'demo' : 'mic',
        seconds, excluded, lines: state.ratings.length, tech: { ...state.techCount }, maxCombo: state.maxCombo, at: Date.now(),
        tiers: Object.fromEntries(Scoring.TIERS.map((k) => [k, state.ratings.filter((x) => x.tag === k).length])),
        scoreVersion: Scoring.SCORE_VERSION, guideId: state.guide.guideId || '',
        scope: { type: partial ? 'partial' : state.range ? 'range' : 'full', start: state.passStart, end },
        key: context.key, tempo: context.tempo, allowOctave: context.allowOctave, scoreMode: context.scoreMode, mixedContext: state.mixedContext,
        requiredSeconds: seconds, observedSeconds, voicedSeconds,
        lineFeedback, weakLines: Scoring.weakestLines(lineFeedback), pitchTrace: state.pitchTrace });
      state.result = state.take;
      renderResult(); syncFrame(); emit('all');
      if (options.onFinish) options.onFinish(state.take);
      return state.take;
    }

    function setRange(range) {
      if (!state.baseGuide) return;
      if (range != null && (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start)) return;
      state.range = range ? { start: Math.max(0, range.start), end: Math.min(state.baseGuide.duration, range.end) } : null;
      if (state.range && state.range.end <= state.range.start) { state.range = null; return; }
      const bounds = state.range || { start: 0, end: state.baseGuide.duration };
      state.guide = { ...state.baseGuide, notes: state.baseGuide.notes.filter((n) => n.end > bounds.start && n.start < bounds.end)
        .map((n) => ({ ...n, start: Math.max(n.start, bounds.start), end: Math.min(n.end, bounds.end) })) };
      let maxEnd = -Infinity;
      state.guide.notes.forEach((n, i) => { maxEnd = Math.max(maxEnd, n.end); n.prefixEnd = maxEnd; n.i = i; });
      restart(); announce();
    }

    function setGhost(trace) {
      renderDirty = true;
      state.ghost = (Array.isArray(trace) ? trace : []).slice(0, 12000).filter((p) => p && Number.isFinite(p.t)
        && p.t >= 0 && state.guide && p.t <= state.guide.duration && (p.gap || Number.isFinite(p.midi)))
        .map((p) => p.gap ? { t: p.t, gap: true } : { t: p.t, midi: p.midi }).sort((a, b) => a.t - b.t);
    }

    // ── 同步給 OBS（panel）─────────────────────────────────────────────────
    function syncFrame() {
      if (role !== 'panel' || !state.guide || !options.onSync) return;
      const now = songTime();
      if (state.playing) { follow(now); checkLines(now); refreshScore(); }
      sync.sentAt = performance.now();
      const pts = state.trail.filter((p) => p.t > sync.lastT);
      if (pts.length) sync.lastT = pts[pts.length - 1].t;
      const notes = [...sync.dirty].map((i) => { const n = state.guide.notes[i]; return [i, n.fills, n.hit, n.seen, n.voiced]; });
      sync.dirty.clear();
      const clock = options.clock ? options.clock() : null;
      options.onSync({ type: 'frame', clock: { playing: state.playing, t: now, tempo: clock && clock.tempo || 1 }, trail: pts, notes,
        user: state.user, score: { target: state.scoreTarget, unscorable: state.unscorable, result: state.result }, events: sync.events.splice(0) });
      trimTrail(now);
      emit('score');
    }

    // 切到其他分頁仍會收音、評分；不能把軌跡清理只綁在可見畫布的 drawTrail。
    // 先送出未同步的點，再清掉畫面不再使用的歷史。尚未判定技巧的長音保留完整音頭。
    function trimTrail(time) {
      const cutoff = time - RULE.window * RULE.playhead - 0.2;
      let keepFrom = cutoff;
      if (role === 'panel' && state.guide) {
        const notes = state.guide.notes;
        for (let i = firstAtOrAfter(notes, 'prefixEnd', cutoff); i < notes.length && notes[i].start <= time; i++) {
          const n = notes[i];
          if (!n.done && !n.skip && !n.excluded && n.end >= cutoff) keepFrom = Math.min(keepFrom, n.start - 0.25);
        }
      }
      state.trail = state.trail.filter((p) => p.t >= keepFrom);
    }

    // ── 接收（source）──────────────────────────────────────────────────────
    function receive(m) {
      if (role !== 'source' || !m) return;
      renderDirty = true;
      if (m.type === 'style') { setStyle(m.style); return; }
      if (m.type === 'song' || m.type === 'clear' || m.type === 'seek') followClock.reset();
      if (m.type === 'song') { setGuide(m.song ? { ...m.song, notes: m.song.notes.map((n) => ({ ...n })), exclusions: [] } : null); return; }
      if (m.type === 'clear') { state.guide = null; clearTake(); clearCanvas(); return; }
      if (!state.guide) return;
      if (m.type === 'seek') { resetFrom(m.offset); return; }
      if (m.type !== 'frame') return;
      if (m.clock) { state.clock = { ...m.clock, at: Date.now() }; followClock.sync(m.clock, performance.now() / 1000); }
      if (m.trail) state.trail.push(...m.trail);
      for (const [i, fills, hit, seen, voiced] of m.notes || []) {
        const n = state.guide.notes[i]; if (n) Object.assign(n, { fills, hit, seen, voiced });
      }
      if (m.user !== undefined) state.user = m.user;
      if (m.score) { state.scoreTarget = m.score.target; state.unscorable = m.score.unscorable; state.result = m.score.result || null; renderResult(); }
      for (const ev of m.events || []) {
        if (ev.k === 'rating') showRating(ev.tag, ev.combo);
        if (ev.k === 'tag') state.tags.push({ ...ev.g, born: songTime() });
      }
      trimTrail(songTime());
    }

    // ── 評等演出：DOM 文字動畫＋畫布粒子 ─────────────────────────────────────
    function showRating(tag, combo) {
      const layer = el('ratings'); if (!layer) return;
      layer.textContent = '';
      if (FX().hideLow && (tag === 'GOOD' || tag === 'MISS')) return;
      const node = document.createElement('div');
      node.className = `rating ${tag.toLowerCase()}`;
      node.style.left = `${state.x0}px`;
      node.innerHTML = `<span class="r-text">${tag}</span>` + (combo >= 2 ? `<span class="r-combo"><b>${combo}</b> COMBO</span>` : '');
      layer.appendChild(node);
      const y = 18 + (isObs() ? 15 : 11);
      if (tag === 'PERFECT') { burst(state.x0, y, 22, [C().fill, C().voice], 3.2); if (FX().ring) ring(state.x0, y, C().fill); }
      else if (tag === 'GREAT') burst(state.x0, y, 9, [cssVar('--text', '#EDEBE4'), C().fill], 2.2);
    }

    function burst(x, y, count, colors, speed) {
      count = Math.round(count * FX().particles);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.45 + Math.random() * 0.75);
        state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 0.6, life: 1, decay: 0.018 + Math.random() * 0.016,
          size: 1.5 + Math.random() * 2.2, color: colors[i % colors.length], spin: Math.random() < 0.5 });
      }
    }
    function ring(x, y, color) { state.rings.push({ x, y, r: 18, life: 1, color }); }

    // ── 結算卡 ─────────────────────────────────────────────────────────────
    function renderResult() {
      const card = el('result'); if (!card) return;
      const r = state.result;
      card.hidden = !r || (isObs() && !state.style.result);
      if (!r) { state.resultKey = null; return; }
      const label = r.source === 'demo' ? t('practice.result.demo') : t('practice.result.take');
      const meta = t('practice.result.meta', { lines: r.lines, seconds: r.seconds.toFixed(1) });
      playResult(r, label, meta);
    }

    // 同一份結算只播一次（OBS 每 50ms 會收到一次結算資料）；OBS 中途重新整理就直接顯示結果
    function playResult(r, label, meta) {
      const key = `${r.at}|${r.score}|${r.lines}`;
      if (state.resultKey === key) return;
      state.resultKey = key;
      const card = el('result'), scoreEl = el('resultScore');
      const fresh = r.at && Date.now() - r.at < 4000;
      el('resultLabel').textContent = label;
      el('resultMeta').textContent = meta;
      const tiers = r.tiers || {};
      el('resultTiers').innerHTML = [['PERFECT', 'p'], ['GREAT', 'g'], ['GOOD', 'o'], ['MISS', 'm']]
        .map(([k, c], i) => `<div class="${c}" style="--i:${i}"><b>${Number(tiers[k]) || 0}</b><small>${k}</small></div>`).join('');
      const tech = Object.entries(r.tech || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`);
      el('resultExtra').textContent = [r.maxCombo >= 2 ? t('practice.result.maxCombo', { count: r.maxCombo }) : '', ...tech].filter(Boolean).join(' · ');
      card.classList.remove('res-play', 'res-static'); scoreEl.classList.remove('land');
      cancelAnimationFrame(state.resultAnim);
      if (r.score == null) { scoreEl.textContent = t('practice.unscorable'); card.classList.add(fresh ? 'res-play' : 'res-static'); return; }
      if (!fresh) { scoreEl.textContent = r.score.toFixed(1); card.classList.add('res-static'); return; }
      void card.offsetWidth;          // 重新觸發 CSS 動畫
      card.classList.add('res-play');
      const fx = FX();
      if (!fx.countMs) { scoreEl.textContent = r.score.toFixed(1); return; }   // 低調：不滾分、不噴碎光
      scoreEl.textContent = '0.0';
      const t0 = performance.now() + 350, dur = fx.countMs;
      const step = (now) => {
        const k = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
        scoreEl.textContent = (r.score * e).toFixed(1);
        if (k < 1) { state.resultAnim = requestAnimationFrame(step); return; }
        scoreEl.classList.add('land');
        // 落定時從卡片上緣（中央＋左右角）迸出碎光：畫布在卡片底下，從中心噴會被擋掉。90 分以上更多、更遠
        const cr = card.getBoundingClientRect(), lr = canvas.getBoundingClientRect(), big = r.score >= 90;
        const top = cr.top - lr.top, cx = cr.left - lr.left + cr.width / 2, colors = [C().fill, C().voice];
        burst(cx, top, big ? 30 : 16, colors, big ? 5 : 3.5);
        burst(cr.left - lr.left + 6, top, big ? 10 : 5, colors, big ? 3.5 : 2.5);
        burst(cr.right - lr.left - 6, top, big ? 10 : 5, colors, big ? 3.5 : 2.5);
        if (big && fx.ring) ring(cx, top, C().fill);
        if (fx.wave) setTimeout(() => { burst(cx, top, big ? 24 : 12, colors, big ? 7.5 : 5); ring(cx, top, C().voice); }, 260);
      };
      state.resultAnim = requestAnimationFrame(step);
    }

    // ── 技巧偵測（panel）：每個音唱完時，用這個音範圍內的軌跡判斷；一個音最多一個標籤 ──
    function detectTechnique(n) {
      if (n.excluded) return;
      const pts = state.trail.filter((p) => !p.gap && p.t >= n.start - 0.25 && p.t <= n.end);
      const inside = pts.filter((p) => p.t >= n.start);
      const dur = n.end - n.start;
      if (inside.length < 20) return;
      let tag = null;
      // 顫音：音高繞著自己的中心擺動，每秒 4.5～8 次、幅度約 ±20～120 cents，持續 0.5 秒以上
      if (dur >= 0.6) {
        const xs = inside.map((p) => p.raw), win = 12, dev = [];
        for (let i = win; i < xs.length - win; i++) {
          let m = 0; for (let k = -win; k <= win; k++) m += xs[i + k];
          dev.push(xs[i] - m / (2 * win + 1));
        }
        let cross = 0;
        for (let i = 1; i < dev.length; i++) if ((dev[i - 1] < 0) !== (dev[i] < 0)) cross++;
        const span = dev.length * 0.01, rate = cross / 2 / Math.max(span, 0.01);
        const amp = Math.sqrt(dev.reduce((a, b) => a + b * b, 0) / Math.max(1, dev.length)) * 141;
        if (span >= 0.5 && rate >= 4.5 && rate <= 8 && amp >= 20 && amp <= 120) tag = 'VIBRATO';
      }
      // 長音：1 秒以上，且唱準的時間佔六成以上（偵測本身會漏掉一些氣音格）
      if (!tag && dur >= 1.0 && inside.filter((p) => p.ok).length / (dur / 0.01) >= 0.6) tag = 'LONG TONE';
      // 滑音：在這個音自己的音頭裡，從低 1～4 個半音一路往上滑進來；前一個音就停在那個低音上的只是旋律往上走，不算
      if (!tag && dur >= 0.3) {
        const head = pts.filter((p) => p.t >= n.start - 0.12 && p.t <= n.start + 0.3);
        if (head.length >= 10) {
          let lo = 0; for (let i = 1; i < head.length; i++) if (head[i].raw < head[lo].raw) lo = i;
          let hit = -1; for (let i = lo + 1; i < head.length; i++) if (head[i].ok) { hit = i; break; }
          const prev = state.guide.notes[n.i - 1];
          const fromPrev = prev && n.start - prev.end < 0.15 && Math.abs(prev.midi - head[lo].raw) < 0.6;
          if (hit > lo + 3 && !fromPrev) {
            let up = 0; for (let i = lo + 1; i <= hit; i++) if (head[i].raw >= head[i - 1].raw) up++;
            const rise = n.midi - head[lo].raw, time = head[hit].t - head[lo].t;
            const landed = inside.filter((p) => p.t > head[hit].t && p.t < head[hit].t + 0.25);
            if (rise >= 1 && rise <= 4 && time <= 0.3 && up / (hit - lo) >= 0.8
                && landed.length >= 10 && landed.filter((p) => p.ok).length / landed.length >= 0.7) tag = 'SLIDE';
          }
        }
      }
      if (!tag) return;
      const now = songTime();
      if (state.tags.length && now - state.tags[state.tags.length - 1].born < 0.7) return; // 太密就略過，不搶畫面
      if (state.tagLine === n.line) return;   // 一句歌詞最多一個標籤
      state.tagLine = n.line;
      state.techCount[tag]++;
      state.tags.push({ tag, t: n.end, midi: n.midi, born: now });
      sync.events.push({ k: 'tag', g: { tag, t: n.end, midi: n.midi } });
      emit('tech');
    }

    // ── 畫面 ───────────────────────────────────────────────────────────────
    function clearCanvas() { g2.setTransform(1, 0, 0, 1, 0, 0); g2.clearRect(0, 0, canvas.width, canvas.height); }
    function roundRect(x, y, w, h) { const r = Math.min(3, h / 2, w / 2); g2.beginPath(); g2.roundRect(x, y, w, h, r); }

    function updateLyrics(time) {
      const now = el('lyricNow'), next = el('lyricNext');
      const lines = state.guide.lines;
      if (!now || !lines.length) return;
      let i = lines.findIndex((l) => time < l.end + 0.3);
      if (i < 0) i = lines.length - 1;
      if (i !== state.lyricLine) {
        state.lyricLine = i;
        now.innerHTML = lines[i].words.map((w) => `<span>${escapeHtml(w.text)}</span>`).join('');
        if (next) next.textContent = lines[i + 1] ? lines[i + 1].text : '';
      }
      const spans = now.children;
      lines[i].words.forEach((w, k) => spans[k] && spans[k].classList.toggle('sung', time >= w.start));
    }

    function tweenScore() {
      const target = el('score');
      if (!target) return;
      if (state.unscorable) { setText(target, t('practice.unscorable')); return; }
      if (state.scoreTarget == null) { setText(target, '—'); state.scoreShown = 0; return; }
      if (!state.scoreShown) state.scoreShown = state.scoreTarget;
      state.scoreShown += (state.scoreTarget - state.scoreShown) * 0.12;
      setText(target, state.scoreShown.toFixed(1));
    }

    function setText(node, value) { if (node.textContent !== value) node.textContent = value; }

    function draw() {
      if (destroyed) return;
      frameHandle = requestAnimationFrame(draw);
      const guide = state.guide;
      if (!guide) {
        if (!blankPainted) { clearCanvas(); blankPainted = true; }
        return;
      }
      blankPainted = false;
      const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W || !H) return;
      const time = songTime(), styles = getComputedStyle(host);
      const mono = styles.getPropertyValue('--font-mono').trim() || 'monospace';
      const faint = styles.getPropertyValue('--text-faint').trim() || '#8C8981';
      const text = styles.getPropertyValue('--text').trim() || '#EDEBE4';
      const playing = role === 'panel' ? state.playing : state.clock.playing;
      const settling = !state.unscorable && state.scoreTarget != null && Math.abs(state.scoreTarget - state.scoreShown) > 1e-7;
      // 暫停後讓粒子和滾分自然結束；靜止時保留畫布，尺寸／主題／資料變更立即重畫。
      if (!playing && !renderDirty && !settling && !state.particles.length && !state.rings.length && lastPaint
          && time === lastPaint.time && W === lastPaint.W && H === lastPaint.H && dpr === lastPaint.dpr
          && mono === lastPaint.mono && faint === lastPaint.faint && text === lastPaint.text) return;
      renderDirty = false;
      lastPaint = { time, W, H, dpr, mono, faint, text };
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, W, H);
      const obs = isObs(), fx = FX();
      const status = el('status');
      if (status) {
        const exclusion = guide.exclusions.find((r) => time >= r.start && time < r.end);
        setText(status, exclusion ? t('practice.excludedNow') : '');
      }
      if (role === 'panel' && state.playing) { follow(time); checkLines(time); }
      if (playing || state.lyricLine < 0) updateLyrics(time);
      tweenScore();
      // 音域整首固定：上下不跟著段落跑，眼睛才記得住「這個高度＝這個音」
      if (!state.view) state.view = songRange(guide);
      const VH = state.view.hi, left = obs ? 6 : 44, padT = 14, padB = 14, rowH = (H - padT - padB) / (state.view.hi - state.view.lo + 1);
      const px = (W - left) / RULE.window, x0 = left + (W - left) * RULE.playhead;
      state.x0 = x0;
      const X = (s) => x0 + (s - time) * px, Y = (m) => padT + (VH - m) * rowH;
      const accent = C().fill;

      // 半音列：C 列加深；音名跟著目前的 Key（畫面在原調空間，只有標籤加回 Key）
      g2.font = `10px ${mono}`; g2.textBaseline = 'middle';
      for (let m = Math.floor(state.view.lo) - 1; m <= Math.ceil(state.view.hi) + 1; m++) {
        const y = Y(m), pc = ((m % 12) + 12) % 12, shown = m + Math.round(state.key);
        if ([0, 1, 3, 6, 8, 10].includes(pc)) {
          g2.fillStyle = pc === 0 ? `rgba(237,235,228,${obs ? 0.05 : 0.045})` : `rgba(237,235,228,${obs ? 0.02 : 0.018})`;
          g2.fillRect(left, y, W - left, rowH);
        }
        const spc = ((shown % 12) + 12) % 12;
        if (!obs && (spc === 0 || spc === 7)) { g2.fillStyle = faint; g2.fillText(noteName(shown), 8, y + rowH / 2); }
      }

      g2.save(); g2.beginPath(); g2.rect(left, 0, W - left, H); g2.clip();

      // 原唱音高曲線（面板選用，淡）
      if (!obs && options.getOptions && options.getOptions().showContour && guide.contour) {
        g2.strokeStyle = 'rgba(168,165,155,.35)'; g2.lineWidth = 1; g2.beginPath();
        let prev = null;
        for (let i = firstAtOrAfter(guide.contour, 0, time - RULE.window * RULE.playhead - 0.2); i < guide.contour.length; i++) {
          const [ct, cm] = guide.contour[i];
          if (ct < time - RULE.window * RULE.playhead - 0.2) continue; if (ct > time + RULE.window) break;
          if (!cm) { prev = null; continue; }
          const xx = X(ct), yy = Y(cm - (guide.tuning || 0)) + rowH / 2;
          if (prev != null && ct - prev < 0.05) g2.lineTo(xx, yy); else g2.moveTo(xx, yy);
          prev = ct;
        }
        g2.stroke();
      }

      // Previous take: source-time / original MIDI, deliberately independent of scoring.
      if (state.ghost.length) {
        g2.save(); g2.strokeStyle = rgba(C().voice, 0.38); g2.lineWidth = 1; g2.setLineDash([3, 3]); g2.beginPath();
        let prev = null;
        for (let i = firstAtOrAfter(state.ghost, 't', time - RULE.window * RULE.playhead - 0.2); i < state.ghost.length; i++) {
          const p = state.ghost[i];
          if (p.t < time - RULE.window * RULE.playhead - 0.2) continue;
          if (p.t > time + RULE.window) break;
          if (p.gap) { prev = null; continue; }
          if (prev && p.t - prev.t < 0.12 && Math.abs(p.midi - prev.midi) < 3) g2.lineTo(X(p.t), Y(p.midi) + rowH / 2);
          else g2.moveTo(X(p.t), Y(p.midi) + rowH / 2);
          prev = p;
        }
        g2.stroke(); g2.restore();
      }

      // 音符方塊：暗底；唱對的時段由左往右填色；正在填的前緣有亮點
      const blockH = Math.max(6, rowH * fx.blockH);
      for (let i = firstAtOrAfter(guide.notes, 'prefixEnd', time - RULE.window * RULE.playhead - 0.2); i < guide.notes.length; i++) {
        const n = guide.notes[i];
        if (n.end < time - RULE.window * RULE.playhead - 0.2) continue; if (n.start > time + RULE.window) break;
        const x = X(n.start), w = Math.max(3, X(n.end) - x - 2), y = Y(Math.max(state.view.lo, Math.min(state.view.hi, n.midi))) + (rowH - blockH) / 2;   // 極端音貼邊畫，不消失
        const passed = n.end < time, current = n.start <= time && time <= n.end;
        if (obs) {
          g2.fillStyle = rgba(C().note, current ? 0.9 : passed ? 0.4 : 0.7);
          roundRect(x, y, w, blockH); g2.fill();
          const breathe = current && fx.pulse ? 0.45 + 0.35 * Math.sin(time * 9) : 0;   // 熱情／華麗：目前的音外框呼吸
          g2.strokeStyle = current ? rgba(fx.pulse ? accent : '#EDEBE4', fx.pulse ? 0.4 + breathe : 0.45) : 'rgba(237,235,228,.18)';
          g2.lineWidth = current && fx.pulse ? 1.5 : 1;
          roundRect(x + 0.5, y + 0.5, w - 1, blockH - 1); g2.stroke();
        } else {
          g2.fillStyle = rgba(C().note, current ? 0.75 : passed ? 0.3 : 0.55);
          roundRect(x, y, w, blockH); g2.fill();
        }
        if (obs && C().edge) {
          g2.save(); g2.strokeStyle = 'rgba(11,11,10,.88)'; g2.lineWidth = 2;
          g2.shadowColor = '#0B0B0A'; g2.shadowBlur = 3; roundRect(x, y, w, blockH); g2.stroke(); g2.restore();
        }
        if (n.excluded) {
          g2.save(); g2.strokeStyle = obs ? C().note : faint; g2.lineWidth = 1; g2.setLineDash([3, 3]);
          roundRect(x, y, w, blockH); g2.stroke(); g2.restore();
          continue;
        }
        if (n.fills.length) {
          g2.save(); if (fx.glow) { g2.shadowColor = rgba(accent, 0.7); g2.shadowBlur = 10 * fx.glow; }
          roundRect(x, y, w, blockH); g2.clip(); g2.fillStyle = accent;
          for (const [a, b] of n.fills) g2.fillRect(X(a) - 1, y, Math.max(2, X(b) - X(a) + 3), blockH);
          if (fx.sheen) { // 華麗：填色上一道斜向流光來回掃
            const sx = x + ((time * 220) % (w + 60)) - 30, sg = g2.createLinearGradient(sx - 24, 0, sx + 24, 0);
            sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,.42)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
            g2.shadowBlur = 0; g2.fillStyle = sg; g2.fillRect(x, y, w, blockH);
          }
          g2.restore();
          const edge = n.fills[n.fills.length - 1];
          if (fx.edge && current && time - edge[1] < 0.08) {
            const ex = X(edge[1]) + 2;
            g2.fillStyle = C().voice; g2.shadowColor = accent; g2.shadowBlur = 12 * Math.max(0.5, fx.glow);
            g2.fillRect(ex - 1.5, y - 2, 3, blockH + 4); g2.shadowBlur = 0;
          }
        }
        if (passed && !n.done) {
          n.done = true;
          if (role === 'panel' && !n.skip && n.seen > 0) detectTechnique(n);
          if (fx.noteBurst && !n.skip && n.seen > 0 && noteScore(n, profile()) >= 0.85) burst(Math.min(X(n.end), x0), y + blockH / 2, 5, [accent, C().voice], 1.4);
        }
        if (fx.perfectRing && passed && !n.skip && n.seen > 0 && noteScore(n, profile()) >= 0.85) {
          g2.strokeStyle = accent; g2.lineWidth = 1; roundRect(x + 0.5, y + 0.5, w - 1, blockH - 1); g2.stroke();
        }
      }

      drawTrail(time, X, Y, rowH, blockH, left, obs);
      drawTags(time, X, Y, rowH, blockH, left, obs, mono);
      g2.restore();

      // 播放頭與目前音高游標
      const grad = g2.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(237,235,228,0)'); grad.addColorStop(0.15, 'rgba(237,235,228,.32)');
      grad.addColorStop(0.85, 'rgba(237,235,228,.32)'); grad.addColorStop(1, 'rgba(237,235,228,0)');
      g2.fillStyle = grad;
      if (fx.playheadGlow) { g2.shadowColor = accent; g2.shadowBlur = fx.playheadGlow; g2.fillRect(x0 - 0.5, 0, 2, H); g2.shadowBlur = 0; }
      else g2.fillRect(x0, 0, 1, H);
      const u = state.user;
      if (u && time - u.t < 0.15) {
        const n = activeNote(guide.notes, time), y = Y(u.midi) + rowH / 2;
        const ok = n && Math.abs(u.midi - n.midi) * 100 <= RULE.fullCents;
        g2.fillStyle = ok ? accent : text;
        if (ok && fx.glow) { g2.shadowColor = accent; g2.shadowBlur = 10 * fx.glow; }
        g2.beginPath(); g2.moveTo(x0 + 10, y); g2.lineTo(x0 + 1, y - 6); g2.lineTo(x0 + 1, y + 6); g2.closePath(); g2.fill();
        g2.shadowBlur = 0;
      }

      // 粒子與光環
      for (const r of state.rings) {
        r.r += 4.2; r.life -= 0.05;
        g2.strokeStyle = r.color; g2.globalAlpha = Math.max(0, r.life) * 0.4; g2.lineWidth = 1;
        g2.beginPath(); g2.ellipse(r.x, r.y, r.r * 1.6, r.r * 0.55, 0, 0, Math.PI * 2); g2.stroke();
      }
      state.rings = state.rings.filter((r) => r.life > 0);
      for (const p of state.particles) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.vx *= 0.985; p.life -= p.decay;
        g2.globalAlpha = Math.max(0, p.life); g2.fillStyle = p.color;
        if (p.spin) { g2.save(); g2.translate(p.x, p.y); g2.rotate(p.life * 6); g2.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); g2.restore(); }
        else { g2.beginPath(); g2.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); g2.fill(); }
      }
      g2.globalAlpha = 1;
      state.particles = state.particles.filter((p) => p.life > 0);
    }

    // 技巧標籤：在音符尾端上方浮起、停一下、淡出（低調：照算不畫）
    function drawTags(time, X, Y, rowH, blockH, left, obs, mono) {
      if (!FX().tags) return;
      state.tags = state.tags.filter((g) => time - g.born < 1.6 && time >= g.born - 0.05);
      g2.font = `600 ${obs ? 12 : 10}px ${mono}`; g2.textBaseline = 'middle';
      for (const g of state.tags) {
        const age = time - g.born, ease = 1 - Math.pow(1 - Math.min(1, age / 0.25), 3);
        const alpha = age < 1.1 ? ease : Math.max(0, 1 - (age - 1.1) / 0.5);
        const x = Math.max(left + 40, X(g.t)), y = Y(g.midi) + (rowH - blockH) / 2 - 12 - ease * 8 - age * 5;
        const w = g2.measureText(g.tag).width + 14, h = obs ? 20 : 17;
        g2.globalAlpha = alpha;
        g2.fillStyle = 'rgba(15,15,14,.8)'; roundRect(x - w / 2, y - h / 2, w, h); g2.fill();
        g2.strokeStyle = C().fill; g2.lineWidth = 1; roundRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1); g2.stroke();
        g2.fillStyle = C().fill; g2.textAlign = 'center'; g2.fillText(g.tag, x, y + 0.5); g2.textAlign = 'start';
      }
      g2.globalAlpha = 1;
    }

    // 你的聲音：三種畫法。只畫播放頭左邊已唱過的部分，越舊越淡
    function drawTrail(time, X, Y, rowH, blockH, left, obs) {
      const behind = RULE.window * RULE.playhead;
      state.trail = state.trail.filter((p) => p.t > time - behind - 0.2);
      const mode = C().trailMode, pts = state.trail, fx = FX();
      const fade = (pt) => Math.max(0, Math.min(1, (pt.t - (time - behind)) / (behind * 0.6)));
      const colorOf = (p) => (p.ok ? C().voice : p.near ? 'rgba(237,235,228,.85)' : C().off);
      if (mode === 'bars') {
        // 連續同一行的格子合成一條橫條
        let run = null;
        const flush = () => {
          if (!run) return;
          const y = Y(run.m) + rowH / 2, h = Math.max(3, blockH * 0.42), x = X(run.a), w = Math.max(2, X(run.b) - X(run.a));
          g2.globalAlpha = 0.95 * fade(run.p);
          if (obs && C().edge) { g2.save(); g2.strokeStyle = 'rgba(11,11,10,.9)'; g2.lineWidth = 3; roundRect(x, y - h / 2, w, h); g2.stroke(); g2.restore(); }
          g2.fillStyle = colorOf(run.p); roundRect(x, y - h / 2, w, h); g2.fill(); run = null;
        };
        for (const p of pts) {
          if (p.t > time) break;
          if (p.gap) { flush(); continue; }
          if (run && run.m === p.bar && run.ok === p.ok && p.t - run.b < 0.03) run.b = p.t;
          else { flush(); run = { a: p.t, b: p.t, m: p.bar, ok: p.ok, p }; }
        }
        flush(); g2.globalAlpha = 1; return;
      }
      // 緞帶／原始：連續線段，粗細跟音量，跳超過 1.5 個半音或中斷就斷開
      const key = mode === 'raw' ? 'raw' : 'ribbon';
      g2.lineCap = 'round'; g2.lineJoin = 'round';
      const segment = (i) => {
        const a = pts[i - 1], b = pts[i];
        if (b.t > time) return null;
        if (a.gap || b.gap || b.t - a.t > 0.05 || Math.abs(b[key] - a[key]) > 1.5 || X(b.t) < left) return undefined;
        return [a, b];
      };
      // 先畫完整條深色外框，再畫彩色線；逐段交錯會讓下一段外框蓋到前一段，變成一串珠子
      if (obs && C().edge) {
        g2.save(); g2.shadowBlur = 0; g2.strokeStyle = 'rgba(11,11,10,.9)';
        for (let i = 1; i < pts.length; i++) {
          const s = segment(i); if (s === null) break; if (!s) continue;
          const [a, b] = s;
          g2.globalAlpha = (mode === 'raw' ? 0.9 : 0.95) * fade(b);
          g2.lineWidth = (mode === 'raw' ? 1.5 : (1.5 + b.v * 3.5) * fx.trailW) + 3;
          g2.beginPath(); g2.moveTo(X(a.t), Y(a[key]) + rowH / 2); g2.lineTo(X(b.t), Y(b[key]) + rowH / 2); g2.stroke();
        }
        g2.restore();
      }
      for (let i = 1; i < pts.length; i++) {
        const s = segment(i); if (s === null) break; if (!s) continue;
        const [a, b] = s;
        g2.globalAlpha = (mode === 'raw' ? 0.9 : 0.95) * fade(b);
        g2.strokeStyle = mode === 'raw' ? 'rgba(237,235,228,.8)' : colorOf(b);
        g2.lineWidth = mode === 'raw' ? 1.5 : (1.5 + b.v * 3.5) * fx.trailW;
        if (b.ok && mode !== 'raw' && fx.trailGlow) { g2.shadowColor = C().fill; g2.shadowBlur = 8 * fx.trailGlow; } else g2.shadowBlur = 0;
        g2.beginPath(); g2.moveTo(X(a.t), Y(a[key]) + rowH / 2); g2.lineTo(X(b.t), Y(b[key]) + rowH / 2); g2.stroke();
      }
      g2.shadowBlur = 0; g2.globalAlpha = 1;
    }

    // ── 對外 ───────────────────────────────────────────────────────────────
    function emit(kind) { renderDirty = true; if (options.onUpdate) options.onUpdate(kind, api); }

    function destroy() {
      destroyed = true;
      cancelAnimationFrame(frameHandle);
      cancelAnimationFrame(state.resultAnim);
    }

    const api = {
      setGuide, announce, setStyle, setKey, setRange, setGhost, startNewPass: restart,
      getRange: () => state.range ? { ...state.range } : null, getTake: () => state.take, diagnosticSnapshot, setPlaying, seek, restart, pitch, finish, receive, syncFrame, destroy,
      songTime, refreshScore, resetInput, voiceGate,
      getStyle: () => ({ ...state.style }),
      getGuide: () => state.guide,
      getStats: () => ({ ratings: state.ratings.slice(), techCount: { ...state.techCount }, scoreTarget: state.scoreTarget,
        unscorable: state.unscorable, result: state.result, maxCombo: state.maxCombo, combo: state.combo,
        tiers: Object.fromEntries(Scoring.TIERS.map((k) => [k, state.ratings.filter((x) => x.tag === k).length])) }),
      // 測試用：直接觀察內部狀態
      _state: state,
      _detectTechnique: detectTechnique,
    };
    frameHandle = requestAnimationFrame(draw);
    return api;
  }

  return { createPracticeEngine, createFollowClock, RENDER_DELAY };
});
