/**
 * Elitesand Pro 排版模板：折光階梯（v6，2026-07 全面重寫）
 *
 * 一行歌詞切成 1–4 個「階」垂直堆疊、左右交錯錯位，階旁有虛線導軌與切角節點，
 * 詞在階內走墨字引擎（LyricWordEngine）的生命週期。
 * 「層層階梯又不失可讀性」是構圖原則：階的位置在建行時一次算好（確定性 seed），
 * 之後只有詞的相位在動。
 *
 * 2026-07-11 AGPL 稽核後重寫：分階演算法（字素配額均衡切分）、錯位/縮放常數、
 * 導軌配色與幾何皆為原創設計。
 *
 * 依賴：LyricMotion、LyricWordEngine、gsap、LyricTemplates。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined'
    || typeof LyricWordEngine === 'undefined') {
    console.warn('[Partita] 依賴未載入，模板停用');
    return;
  }

  const { hashNoise, hashSpread, clamp } = LyricMotion;

  const STEP_SHIFT_MIN = 30;    // 階左右交錯的最小位移（px）
  const STEP_SHIFT_MAX = 78;    // 最大位移
  const GRAPHEMES_PER_STEP = 9; // 每階目標字素數（決定階數的基準）
  const PREHEAT_MIN_MS = 180;   // 下一行預熱窗口
  const PREHEAT_MAX_MS = 1200;
  const LAYOUT_CACHE_LIMIT = 48;

  let rootEl = null;
  let breathTl = null;
  let currentLineEl = null;
  let currentWordStates = [];
  let currentSteps = [];    // [{el, guideEls, startMs, endMs, phase}]
  let currentLineIndex = -1;
  let currentTempo = null;
  let colorsCache = { base: '#ffffff', active: '#ffd6a5' };
  let intensity = 'normal';
  const layoutCache = new Map();

  function getCssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function refreshColors() {
    colorsCache.base = getCssVar('--lyric-color', '#ffffff');
    colorsCache.active = getCssVar('--lyric-color-active', '#ffd6a5');
    intensity = (document.body.dataset.lyricIntensity === 'calm' || document.body.dataset.lyricIntensity === 'chaotic')
      ? document.body.dataset.lyricIntensity : 'normal';
  }

  // ─── 分階佈局（確定性、有快取、可預熱）───

  const graphemesOf = (dw) => (dw.graphemes ? dw.graphemes.length : Array.from(dw.text).length);

  /**
   * 把 display words 切成階：階數由整行字素數決定（每階約 GRAPHEMES_PER_STEP 字素，上限 4），
   * 切點用「累積字素配額」找最近的詞邊界——每階份量均衡但不機械等分。
   */
  function buildStepLayout(line, displayWords) {
    const cacheKey = `${line.time}|${displayWords.length}|${intensity}`;
    const cached = layoutCache.get(cacheKey);
    if (cached) return cached;

    const seed = line.time | 0;
    const isChaotic = intensity === 'chaotic';
    const isCalm = intensity === 'calm';

    const totalG = displayWords.reduce((n, w) => n + graphemesOf(w), 0);
    const stepCount = clamp(Math.ceil(totalG / GRAPHEMES_PER_STEP), 1, Math.min(4, displayWords.length));

    // 累積配額切分：第 k 個切點放在「累積字素最接近 totalG*k/stepCount 的詞邊界」
    const steps = [];
    if (stepCount === 1) {
      steps.push(displayWords);
    } else {
      const cuts = [];
      let acc = 0;
      let nextQuota = totalG / stepCount;
      for (let i = 0; i < displayWords.length - 1 && cuts.length < stepCount - 1; i += 1) {
        acc += graphemesOf(displayWords[i]);
        if (acc >= nextQuota) {
          cuts.push(i + 1);
          nextQuota = (totalG * (cuts.length + 1)) / stepCount;
        }
      }
      let from = 0;
      for (const cut of cuts) { steps.push(displayWords.slice(from, cut)); from = cut; }
      steps.push(displayWords.slice(from));
    }

    // 每階的配置：左右交錯（首階方向由 seed 決定）＋輕縮放
    const firstLeft = hashNoise(seed, 21) < 0.5;
    const rows = steps.filter((w) => w.length > 0).map((words, rowIndex) => {
      const isLeft = rowIndex % 2 === 0 ? firstLeft : !firstLeft;
      const shift = STEP_SHIFT_MIN + hashNoise(seed, 22 + rowIndex) * (STEP_SHIFT_MAX - STEP_SHIFT_MIN);
      return {
        words,
        rowIndex,
        isLeft,
        x: isLeft ? -shift : shift,
        y: 0,
        rotate: isChaotic ? (isLeft ? -2.2 : 2.2) : 0,
        scale: isCalm ? 1 : 0.92 + hashNoise(seed, 26 + rowIndex) * 0.22,
        startMs: words[0].startMs,
        endMs: words[words.length - 1].endMs,
      };
    });

    const layout = { rows, totalGraphemes: totalG };
    layoutCache.set(cacheKey, layout);
    if (layoutCache.size > LAYOUT_CACHE_LIMIT) {
      layoutCache.delete(layoutCache.keys().next().value);
    }
    return layout;
  }

  /** 供預熱：只建佈局進快取，不建 DOM。 */
  function preheatLine(ctx, lineIndex) {
    const lines = ctx.getLyrics();
    const line = lines[lineIndex];
    if (!line) return;
    const words = LyricMotion.ensureWordTimings(line, lines, lineIndex);
    buildStepLayout(line, LyricMotion.buildDisplayWords(words));
  }

  // ─── 虛線導軌 ───

  function createGuides(stepEl, isLeft) {
    const v = document.createElement('span');
    v.className = `partita-guide-v ${isLeft ? 'left' : 'right'}`;
    const h = document.createElement('span');
    h.className = `partita-guide-h ${isLeft ? 'left' : 'right'}`;
    stepEl.appendChild(v);
    stepEl.appendChild(h);
    gsap.set(v, { scaleY: 0, opacity: 0, transformOrigin: 'bottom' });
    gsap.set(h, { scaleX: 0, opacity: 0, transformOrigin: isLeft ? 'left' : 'right' });
    return [v, h];
  }

  // 導軌配色：以使用者的亮色做透明度階（不寫死任何 rgba 常數），
  // live=全亮、done=30%、pending=12%。
  function setGuidePhase(step, phase) {
    const active = colorsCache.active;
    const pct = phase === 'live' ? 100 : phase === 'done' ? 30 : 12;
    const color = pct === 100 ? active : `color-mix(in srgb, ${active} ${pct}%, transparent)`;
    const glow = phase === 'live' ? `0 0 8px color-mix(in srgb, ${active} 40%, transparent)` : 'none';
    for (const g of step.guideEls) {
      g.style.setProperty('--guide-color', color);
      g.style.boxShadow = glow;
      if (phase !== 'pending') {
        gsap.to(g, { scaleX: 1, scaleY: 1, opacity: 1, duration: 0.4, ease: 'power2.out' });
      }
    }
  }

  // ─── 行的建立與切換 ───

  function fontPxFor(totalGraphemes, viewWidth) {
    const userScale = (parseFloat(getCssVar('--display-font-size', '42')) || 42) / 42;
    const vw = viewWidth || window.innerWidth || 1280;
    const dense = totalGraphemes > 36 ? 0.82 : 1;
    return clamp(vw * 0.05, 36, 68) * userScale * dense;
  }

  // 詞層抖動幅度表（px / deg）
  const WORD_SPREAD = { calm: 0, normal: 5, chaotic: 12 };
  const WORD_TILT = { calm: 0, normal: 2.4, chaotic: 6 };

  function buildLine(ctx, lineIndex) {
    const lines = ctx.getLyrics();
    const line = lines[lineIndex];
    if (!line) return;

    refreshColors();
    const tempo = LyricMotion.lineTempo(lines, lineIndex);
    currentTempo = tempo;

    const words = LyricMotion.ensureWordTimings(line, lines, lineIndex);
    const displayWords = LyricMotion.buildDisplayWords(words);
    const layout = buildStepLayout(line, displayWords);
    const vp = LyricMotion.layoutViewport(rootEl, lineIndex);
    const fontPx = fontPxFor(layout.totalGraphemes, vp.width);

    const lineEl = document.createElement('div');
    lineEl.className = 'partita-line';
    if (vp.sideClass) lineEl.classList.add(vp.sideClass);
    lineEl.style.fontSize = `${fontPx}px`;

    const seed = line.time | 0;
    const spread = WORD_SPREAD[intensity];
    const tiltMax = WORD_TILT[intensity];

    const wordStates = [];
    const stepStates = [];

    layout.rows.forEach((row) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'partita-chunk';
      // pending 起始態：隱形、微縮、往交錯同方向縮回 28px（進場時像從側邊滑上臺階）
      gsap.set(stepEl, {
        opacity: 0, scale: 0.9,
        x: row.x + (row.isLeft ? -28 : 28), y: row.y, rotation: row.rotate,
      });

      const guideEls = createGuides(stepEl, row.isLeft);

      row.words.forEach((dw, wi) => {
        const salt = row.rowIndex * 64 + wi * 8;
        const cfg = {
          dx: hashSpread(seed, salt + 1) * spread,
          dy: hashSpread(seed, salt + 2) * spread * 0.6,
          tiltDeg: hashSpread(seed, salt + 3) * tiltMax,
          scaleBase: row.scale,
          gapPx: fontPx * 0.2,
          riseFrom: 12 + hashNoise(seed, salt + 4) * 8,
          drift: {
            x: 0,
            y: hashSpread(seed, salt + 5) * 3,
            spinDeg: hashSpread(seed, salt + 6) * (intensity === 'chaotic' ? 8 : 3.5),
          },
        };
        const ws = LyricWordEngine.createWord(dw, cfg, {
          baseColor: colorsCache.base,
          activeColor: colorsCache.active,
          tempo,
        });
        stepEl.appendChild(ws.el);
        wordStates.push(ws);
      });

      lineEl.appendChild(stepEl);
      stepStates.push({
        el: stepEl, guideEls,
        row,
        startMs: row.startMs, endMs: row.endMs,
        phase: 'pending',
      });
    });

    rootEl.appendChild(lineEl);
    if (!ctx.isFastMode()) {
      LyricWordEngine.animateLineEnter(lineEl, tempo);
    } else {
      gsap.set(lineEl, { opacity: 1, scale: 1, y: 0 });
    }

    currentLineEl = lineEl;
    currentWordStates = wordStates;
    currentSteps = stepStates;
    currentLineIndex = lineIndex;
  }

  function updateStepPhases(timeMs, snap) {
    if (!currentTempo) return;
    for (const step of currentSteps) {
      const next = LyricMotion.phaseOf(timeMs, step.startMs, step.endMs, currentTempo.revealLeadMs);
      if (next === step.phase) continue;
      step.phase = next;

      const { row } = step;
      if (next === 'pending') {
        gsap.to(step.el, {
          opacity: 0, scale: 0.9,
          x: row.x + (row.isLeft ? -28 : 28), y: row.y,
          duration: snap ? 0 : 0.35, ease: 'power2.out',
        });
      } else {
        // live 滑入定位；done 保持定位
        gsap.to(step.el, {
          opacity: 1, scale: 1,
          x: row.x, y: row.y, rotation: row.rotate,
          duration: snap ? 0 : 0.4,
          ease: next === 'live' ? 'expo.out' : 'power2.out',
        });
      }
      setGuidePhase(step, next);
    }
  }

  function retireCurrentLine(ctx, snap) {
    if (!currentLineEl) return;
    const el = currentLineEl;
    const states = currentWordStates;
    const tempo = currentTempo;
    currentLineEl = null; currentWordStates = []; currentSteps = [];

    if (snap || ctx.isFastMode() || typeof gsap === 'undefined') {
      LyricWordEngine.destroyWords(states);
      gsap.killTweensOf(el);
      gsap.killTweensOf(el.querySelectorAll('*'));
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    for (const s of states) { for (const t of s.tweens) t.kill(); s.tweens = []; }
    LyricWordEngine.animateLineExit(el, tempo);
  }

  function clearAll(ctx) {
    retireCurrentLine(ctx, true);
    currentLineIndex = -1;
    currentTempo = null;
  }

  LyricTemplates.register({
    id: 'partita',
    label: '折光階梯',

    mount(container, ctx) {
      rootEl = document.createElement('div');
      rootEl.id = 'partita-root';
      container.appendChild(rootEl);
      refreshColors();
      breathTl = LyricWordEngine.startBreathing(rootEl, intensity);
      currentLineIndex = -1;
      layoutCache.clear();
    },

    destroy() {
      if (breathTl) { breathTl.kill(); breathTl = null; }
      if (currentLineEl) {
        LyricWordEngine.destroyWords(currentWordStates);
        gsap.killTweensOf(currentLineEl);
      }
      if (rootEl) {
        gsap.killTweensOf(rootEl.querySelectorAll('*'));
        if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      }
      rootEl = null; currentLineEl = null; currentWordStates = []; currentSteps = [];
      currentLineIndex = -1; layoutCache.clear();
    },

    onLyricsLoaded(lines, ctx) { clearAll(ctx); },

    onLineChange(prevIndex, newIndex, ctx) {
      retireCurrentLine(ctx, false);
      if (newIndex >= 0) buildLine(ctx, newIndex);
    },

    onSeek(timeMs, ctx) {
      clearAll(ctx);
      const idx = ctx.getLineIndex();
      if (idx >= 0) {
        buildLine(ctx, idx);
        updateStepPhases(timeMs, true);
        LyricWordEngine.snapWordStates(currentWordStates, timeMs);
      }
    },

    onFrame(timeMs, ctx) {
      if (currentLineIndex < 0 || !currentTempo) return;
      if (ctx.isFastMode()) {
        updateStepPhases(timeMs, true);
        LyricWordEngine.snapWordStates(currentWordStates, timeMs);
      } else {
        updateStepPhases(timeMs, false);
        LyricWordEngine.updateWordStates(currentWordStates, timeMs, currentTempo.windowEndMs);
        // 下一行預熱：提前把佈局算好進快取，切行瞬間不做重活
        const lines = ctx.getLyrics();
        const next = lines[currentLineIndex + 1];
        if (next) {
          const lead = next.time - timeMs;
          if (lead >= PREHEAT_MIN_MS && lead <= PREHEAT_MAX_MS) preheatLine(ctx, currentLineIndex + 1);
        }
      }
    },
  });
})();
