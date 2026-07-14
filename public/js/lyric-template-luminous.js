/**
 * Elitesand Pro 排版模板：星砂流光（v6，2026-07 全面重寫）
 *
 * 一次只顯示當前行；詞沿一條微傾的「砂河」波形帶排列（正弦起伏＋雜湊抖動），
 * 每個詞走墨字引擎（LyricWordEngine）的 pending→live→done 生命週期，
 * 逐字素光帶掃過形成「流光」。同一行的幾何永遠相同（seed=行起始毫秒），
 * 時間只推進動畫狀態、不重排版。
 *
 * 2026-07-11 AGPL 稽核後重寫：佈局演算法（波形帶）、字級公式、間距計算、
 * 所有常數皆為原創設計。
 *
 * 依賴：LyricMotion（kernel）、LyricWordEngine、gsap、LyricTemplates。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined'
    || typeof LyricWordEngine === 'undefined') {
    console.warn('[Luminous] 依賴未載入，模板停用');
    return;
  }

  const { hashNoise, hashSpread, clamp } = LyricMotion;

  let rootEl = null;        // 主容器（呼吸浮動作用對象）
  let breathTl = null;
  let currentLineEl = null; // 目前行容器
  let currentWordStates = [];
  let currentLineIndex = -1;
  let currentTempo = null;
  let colorsCache = { base: '#ffffff', active: '#ffd6a5' };
  let intensity = 'normal';

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

  function isInterludeText(text) {
    return /^[\s.…·。]+$/.test((text || '').trim()) && (text || '').trim().length > 0;
  }

  // ─── 字級：以視口寬為基準，按整行字素數收縮 ───

  function fontPxFor(line, viewWidth) {
    const userScale = (parseFloat(getCssVar('--display-font-size', '42')) || 42) / 42;
    const vw = viewWidth || window.innerWidth || 1280;
    const base = clamp(vw * 0.052, 30, 64) * userScale;
    const g = Array.from(line.text || '').length;
    const shrink = g > 14 ? clamp(1 - (g - 14) * 0.014, 0.68, 1) : 1;
    return base * shrink;
  }

  // ─── 砂河佈局 ───
  // 詞沿水平方向依真實量測寬度排開（整體置中），縱向落在一條正弦波上，
  // 外加每詞的雜湊抖動與微傾。最長的詞被輕微放大成為視覺錨點。

  // 容器收窄後歌詞會折成多列（往上下發展成菱形），列內波幅相應收斂避免上下列相撞。
  const WAVE_AMP = { calm: 0, normal: 10, chaotic: 20 };   // 波幅（px）
  const JITTER = { calm: 0, normal: 5, chaotic: 11 };      // 抖動（px）
  const TILT_MAX = { calm: 0, normal: 2.4, chaotic: 6.5 }; // 微傾（deg）

  function buildLayout(line, displayWords, fontPx) {
    const seed = line.time | 0;
    const interlude = isInterludeText(line.text);
    const amp = WAVE_AMP[intensity];
    const jit = JITTER[intensity];
    const tiltMax = TILT_MAX[intensity];

    // 波形參數：每行自己的相位與波長（1.6~2.6 個詞一個週期）
    const phase = hashNoise(seed, 11) * Math.PI * 2;
    const waveStep = (Math.PI * 2) / (1.6 + hashNoise(seed, 12) * 1.0 + Math.max(displayWords.length * 0.18, 0));

    const fontSpec = `700 ${fontPx}px ${getCssVar('--display-font-family', 'sans-serif')}`;
    const widths = displayWords.map((w) => {
      const offs = LyricMotion.measureCharOffsets(w.text, fontSpec);
      return offs[offs.length - 1] || 0;
    });

    // 視覺錨點：最長（量測寬）的詞
    let anchorIdx = 0;
    widths.forEach((w, i) => { if (w > widths[anchorIdx]) anchorIdx = i; });

    return displayWords.map((dw, i) => {
      if (interlude) {
        return {
          dx: 0, dy: hashSpread(seed, i * 8 + 1) * 8, tiltDeg: 0, scaleBase: 1.35,
          gapPx: fontPx * 1.1, riseFrom: 10,
          drift: { x: 0, y: -4, spinDeg: 0 },
        };
      }

      const isAnchor = i === anchorIdx && displayWords.length > 2;
      const scaleBase = (intensity === 'calm' ? 1 : 1 + hashNoise(seed, i * 8 + 2) * 0.1)
        * (isAnchor ? 1.14 : 1);

      // 縱向：波形＋抖動
      const dy = amp * Math.sin(i * waveStep + phase) + hashSpread(seed, i * 8 + 3) * jit;
      // 橫向：不做位移（水平間距交給 gap），僅 chaotic 給一點錯動
      const dx = intensity === 'chaotic' ? hashSpread(seed, i * 8 + 4) * 10 : 0;

      // 間距：字級比例的基礎間隙＋鄰詞放大溢出補償（自算，避免視覺重疊）
      const overhang = (widths[i] * (scaleBase - 1)) / 2;
      const nextScale = i + 1 < displayWords.length
        ? ((intensity === 'calm' ? 1 : 1 + hashNoise(seed, (i + 1) * 8 + 2) * 0.1) * ((i + 1) === anchorIdx ? 1.14 : 1))
        : 1;
      const nextOverhang = i + 1 < displayWords.length ? (widths[i + 1] * (nextScale - 1)) / 2 : 0;
      const gapPx = Math.max(fontPx * 0.14, overhang + nextOverhang + fontPx * 0.1);

      return {
        dx, dy,
        tiltDeg: hashSpread(seed, i * 8 + 5) * tiltMax,
        scaleBase,
        gapPx,
        riseFrom: 14 + hashNoise(seed, i * 8 + 6) * 8,
        // 唱過後的漂移終點：沿波形法線方向散開一小段
        drift: {
          x: hashSpread(seed, i * 8 + 7) * (intensity === 'chaotic' ? 14 : 6),
          y: (dy >= 0 ? 1 : -1) * (4 + hashNoise(seed, i * 8 + 8) * (intensity === 'chaotic' ? 12 : 5)),
          spinDeg: hashSpread(seed, i * 8 + 9) * (intensity === 'chaotic' ? 10 : 4),
        },
      };
    });
  }

  // ─── 行的建立與切換 ───

  function buildLine(ctx, lineIndex) {
    const lines = ctx.getLyrics();
    const line = lines[lineIndex];
    if (!line) return;

    refreshColors();
    const tempo = LyricMotion.lineTempo(lines, lineIndex);
    currentTempo = tempo;

    const words = LyricMotion.ensureWordTimings(line, lines, lineIndex);
    const displayWords = LyricMotion.buildDisplayWords(words);
    const vp = LyricMotion.layoutViewport(rootEl, lineIndex);
    const fontPx = fontPxFor(line, vp.width);
    const wordCfgs = buildLayout(line, displayWords, fontPx);

    const lineEl = document.createElement('div');
    lineEl.className = 'luminous-line';
    if (vp.sideClass) lineEl.classList.add(vp.sideClass);
    lineEl.style.fontSize = `${fontPx}px`;

    // Elitesand 簽名裝飾：星砂軌跡（純裝飾，不進時間模型）
    const sandRail = document.createElement('div');
    sandRail.className = 'luminous-sand-rail';
    sandRail.setAttribute('aria-hidden', 'true');
    lineEl.appendChild(sandRail);

    const wordStates = displayWords.map((dw, i) => {
      const ws = LyricWordEngine.createWord(dw, wordCfgs[i], {
        baseColor: colorsCache.base,
        activeColor: colorsCache.active,
        tempo,
      });
      lineEl.appendChild(ws.el);
      return ws;
    });

    rootEl.appendChild(lineEl);
    if (!ctx.isFastMode()) {
      LyricWordEngine.animateLineEnter(lineEl, tempo);
      gsap.fromTo(sandRail, { autoAlpha: 0 }, { autoAlpha: 0.72, duration: 0.8, ease: 'power2.out' });
    } else {
      gsap.set(lineEl, { opacity: 1, scale: 1, y: 0 });
      gsap.set(sandRail, { autoAlpha: 0.72 });
    }

    currentLineEl = lineEl;
    currentWordStates = wordStates;
    currentLineIndex = lineIndex;
  }

  function retireCurrentLine(ctx, snap) {
    if (!currentLineEl) return;
    const el = currentLineEl;
    const states = currentWordStates;
    const tempo = currentTempo;
    currentLineEl = null;
    currentWordStates = [];

    if (snap || ctx.isFastMode() || typeof gsap === 'undefined') {
      LyricWordEngine.destroyWords(states);
      gsap.killTweensOf(el);
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    // 舊行退場與新行進場同時進行：先停掉詞層 tween 再讓容器整體退場
    for (const s of states) { for (const t of s.tweens) t.kill(); s.tweens = []; }
    LyricWordEngine.animateLineExit(el, tempo);
  }

  function clearAll(ctx) {
    retireCurrentLine(ctx, true);
    currentLineIndex = -1;
    currentTempo = null;
  }

  // ─── 模板註冊 ───

  LyricTemplates.register({
    id: 'luminous',
    label: '星砂流光',

    mount(container, ctx) {
      rootEl = document.createElement('div');
      rootEl.id = 'luminous-root';
      container.appendChild(rootEl);
      refreshColors();
      breathTl = LyricWordEngine.startBreathing(rootEl, intensity);
      currentLineIndex = -1;
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
      rootEl = null; currentLineEl = null; currentWordStates = []; currentLineIndex = -1;
    },

    onLyricsLoaded(lines, ctx) {
      clearAll(ctx);
    },

    onLineChange(prevIndex, newIndex, ctx) {
      retireCurrentLine(ctx, false);
      if (newIndex >= 0) buildLine(ctx, newIndex);
    },

    onSeek(timeMs, ctx) {
      clearAll(ctx);
      const idx = ctx.getLineIndex();
      if (idx >= 0) {
        buildLine(ctx, idx);
        // 跳轉落地：詞直接落到目標相位
        LyricWordEngine.snapWordStates(currentWordStates, timeMs);
      }
    },

    onFrame(timeMs, ctx) {
      if (currentLineIndex < 0 || currentWordStates.length === 0 || !currentTempo) return;
      if (ctx.isFastMode()) {
        LyricWordEngine.snapWordStates(currentWordStates, timeMs);
      } else {
        LyricWordEngine.updateWordStates(currentWordStates, timeMs, currentTempo.windowEndMs);
      }
    },
  });
})();
