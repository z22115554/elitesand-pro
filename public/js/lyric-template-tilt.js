/**
 * Elitesand Pro 排版模板：斜拍告白（v6，2026-07 全面重寫）
 *
 * 一行歌詞按語感切成 1–4 段、垂直居中堆疊；權重最高的一段抽成「斜體告白」樣式
 * （逐字沿平滑波形上下起伏＋節拍底線）。段落按各自時間先後浮現；
 * 唱到的字做「衝擊脈衝」——一次快速放大接指數衰減到餘光基線，不是變色。
 *
 * 2026-07-11 AGPL 稽核後重寫：段數判定（純寬度驅動）、斜體段選拔（確定性權重）、
 * 字級公式、波形位移、脈衝曲線皆為原創設計。
 *
 * 依賴：LyricMotion、gsap、LyricTemplates（不用墨字引擎，字的行為自成一格）。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined') {
    console.warn('[Tilt] 依賴未載入，模板停用');
    return;
  }

  const { clamp } = LyricMotion;

  const ENTER_EASE = 'power2.out';
  const PULSE_AMP_BASE = 0.1;    // 一般段脈衝幅度
  const PULSE_AMP_ACCENT = 0.14; // 斜體段脈衝幅度
  const PULSE_FLOOR = 0.2;       // 唱過後殘留的脈衝基線比例
  const PULSE_SPAN_MS = 700;     // 脈衝曲線的時間尺度

  let rootEl = null;
  let currentLineEl = null;
  let currentSegments = [];  // [{el, charEls:[{el,startMs,endMs,lastBucket}], startMs, visible}]
  let currentLineIndex = -1;
  let currentTempo = null;
  let colorsCache = { base: '#ffffff', active: '#ffd6a5' };

  function getCssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function refreshColors() {
    colorsCache.base = getCssVar('--lyric-color', '#ffffff');
    colorsCache.active = getCssVar('--lyric-color-active', '#ffd6a5');
  }

  // ─── 切段 ───

  /**
   * 語感切分：交給 kernel 的多層級切行（標點→括號→英文塊→CJK 空白→特殊符號→詞邊界補刀），
   * 英文單字絕不被從中切開。這裡只負責把切出的段落換算成
   * [{text（去頭尾空白）, charOffset（段首在整行的「字素」索引）}]。
   */
  function splitSegments(fullText, targetCount) {
    const parts = LyricMotion.splitSentenceSegments(fullText, targetCount);
    const segments = [];
    let offset = 0; // 字素（code point）累積
    for (const raw of parts) {
      const leading = raw.length - raw.trimStart().length;
      const trimmed = raw.trim();
      if (trimmed) {
        segments.push({ text: trimmed, charOffset: offset + Array.from(raw.slice(0, leading)).length });
      }
      offset += Array.from(raw).length;
    }
    return segments.length > 0 ? segments : [{ text: fullText, charOffset: 0 }];
  }

  // ─── 段落的字素時間（脈衝用）───

  /** 把行的詞時間映射到段落的每個字素；對不上時退化為段落時窗平均分。 */
  function buildSegmentCharTimings(segment, words, segStartMs, segEndMs) {
    const chars = Array.from(segment.text).filter((c) => !/\s/.test(c));
    if (chars.length === 0) return [];

    // 展開整行的字素時間流（詞→字素平均分），再按 charOffset 截取本段的視覺字素
    const allTimings = [];
    for (const w of words) {
      allTimings.push(...LyricMotion.buildGraphemeTimings(w).filter((t) => !/\s/.test(t.char)));
    }
    // 段前有多少個非空白字素
    const before = Array.from(segment.textBefore || '').filter((c) => !/\s/.test(c)).length;
    const slice = allTimings.slice(before, before + chars.length);
    if (slice.length === chars.length) return slice;

    // 退化：段落時窗平均分
    const total = Math.max(segEndMs - segStartMs, 300);
    const per = total / chars.length;
    return chars.map((char, i) => ({
      char,
      startMs: segStartMs + per * i,
      endMs: segStartMs + per * (i + 1),
    }));
  }

  /**
   * 衝擊脈衝：exp(-k·u)·sin(π·min(u,1)) 的乘積曲線——起手快、收手帶長尾，
   * 自然衰減到 PULSE_FLOOR 基線（不需要另外的餘光 ramp）。u = 經過時間 / 時間尺度。
   */
  function pulseAt(timeMs, startMs) {
    const u = (timeMs - startMs) / PULSE_SPAN_MS;
    if (u < 0) return 0;
    const impulse = Math.exp(-2.6 * u) * Math.sin(Math.PI * Math.min(u, 1));
    return Math.max(impulse, u > 0.5 ? PULSE_FLOOR : 0);
  }

  // ─── 行的建立 ───

  function fontPxFor(viewWidth) {
    const userScale = (parseFloat(getCssVar('--display-font-size', '42')) || 42) / 42;
    const vw = viewWidth || window.innerWidth || 1280;
    return clamp(vw * 0.058, 34, 76) * userScale;
  }

  function buildLine(ctx, lineIndex) {
    const lines = ctx.getLyrics();
    const line = lines[lineIndex];
    if (!line || !line.text) return;

    refreshColors();
    const tempo = LyricMotion.lineTempo(lines, lineIndex);
    currentTempo = tempo;

    const words = LyricMotion.ensureWordTimings(line, lines, lineIndex);
    const chars = Array.from(line.text);

    const vp = LyricMotion.layoutViewport(rootEl, lineIndex);
    let fontPx = fontPxFor(vp.width);
    const fontStack = getCssVar('--display-font-family', 'sans-serif');
    const available = Math.max(320, vp.width) * 0.85;
    const measureSeg = (text) => {
      const offs = LyricMotion.measureCharOffsets(text, `400 ${fontPx}px ${fontStack}`);
      return (offs[offs.length - 1] || 0) * 1.1; // 字距補償
    };

    // 段數：純寬度驅動——整行估寬 ÷ 可用寬的九成，上限 4（不用機率、不用對數表）
    const fullWidth = measureSeg(line.text);
    const targetCount = clamp(Math.ceil(fullWidth / (available * 0.9)), 1, 4);
    let segments = splitSegments(line.text, targetCount);

    let widest = 0;
    for (const seg of segments) widest = Math.max(widest, measureSeg(seg.text));
    // 切完仍超寬（單段本身太長切不動）→ 加段重切一次
    if (widest > available && segments.length < 4) {
      segments = splitSegments(line.text, Math.min(4, segments.length + 1));
      widest = 0;
      for (const seg of segments) widest = Math.max(widest, measureSeg(seg.text));
    }
    // 還是超寬 → 整體縮小（下限 0.55）
    if (widest > available) fontPx *= Math.max(0.55, available / widest);

    // 斜體段選拔：確定性——字素數×語言係數（拉丁 1.2）最高的段；平手取較後段（歌詞重心常在後半）
    let accentIndex = -1;
    if (segments.length >= 2) {
      let bestWeight = -1;
      segments.forEach((seg, i) => {
        const g = Array.from(seg.text).length;
        const weight = g * (/[一-鿿぀-ヿ가-힯]/.test(seg.text) ? 1 : 1.2);
        if (weight >= bestWeight) { bestWeight = weight; accentIndex = i; }
      });
    }

    // 段落時間窗：按字素占比分配行時長
    const next = lines[lineIndex + 1];
    const lineEndMs = next ? next.time : line.time + 5000;
    const totalChars = Math.max(chars.length, 1);
    let acc = line.time;
    const segTimings = segments.map((seg) => {
      const share = Array.from(seg.text).length / totalChars;
      const start = acc;
      acc += (lineEndMs - line.time) * share;
      return { startMs: start, endMs: acc };
    });

    const lineEl = document.createElement('div');
    lineEl.className = 'tilt-line-stack';
    if (vp.sideClass) lineEl.classList.add(vp.sideClass);
    gsap.set(lineEl, { opacity: 0 });
    gsap.to(lineEl, { opacity: 1, duration: 0.25 });

    const segStates = [];

    segments.forEach((seg, si) => {
      const isAccent = si === accentIndex;
      const segEl = document.createElement('div');
      segEl.className = isAccent ? 'tilt-seg tilt-seg-italic' : 'tilt-seg';
      segEl.style.fontSize = `${fontPx.toFixed(1)}px`;
      segEl.style.color = isAccent ? colorsCache.active : colorsCache.base;

      const segChars = Array.from(seg.text);
      seg.textBefore = chars.slice(0, seg.charOffset).join('');
      const timings = buildSegmentCharTimings(seg, words, segTimings[si].startMs, segTimings[si].endMs);

      const charEls = [];
      let visualIdx = 0;
      segChars.forEach((ch) => {
        const span = document.createElement('span');
        span.className = 'tilt-char';
        const isSpace = /\s/.test(ch);
        span.textContent = isSpace ? ' ' : ch;
        if (isSpace) span.style.minWidth = isAccent ? '0.35em' : '0.25em';
        segEl.appendChild(span);

        if (!isSpace) {
          // 斜體段的字沿平滑波形起伏（不是嚴格的一上一下），波幅約字級的 12%
          const wave = isAccent ? Math.sin(visualIdx * 0.9) * fontPx * 0.12 : 0;
          const t = timings[visualIdx] || { startMs: segTimings[si].startMs, endMs: segTimings[si].endMs };
          charEls.push({
            el: span, isAccent,
            baseY: wave,
            enterDelay: visualIdx * 0.035,
            startMs: t.startMs, endMs: t.endMs,
            lastBucket: -1,
          });
          gsap.set(span, { opacity: 0, y: wave + 10 });
          visualIdx += 1;
        } else {
          gsap.set(span, { opacity: 0 });
        }
      });

      let beatLine = null;
      if (isAccent) {
        beatLine = document.createElement('span');
        beatLine.className = 'tilt-beat-line';
        beatLine.setAttribute('aria-hidden', 'true');
        segEl.appendChild(beatLine);
        gsap.set(beatLine, { opacity: 0, scaleX: 0, transformOrigin: lineIndex % 2 ? 'right' : 'left' });
      }

      lineEl.appendChild(segEl);
      // 段容器起始態（浮現由 updateSegments 觸發）
      gsap.set(segEl, { opacity: 0, y: isAccent ? 22 : 18 });

      segStates.push({
        el: segEl, charEls, isAccent, beatLine,
        startMs: segTimings[si].startMs,
        visible: false,
        allSpans: Array.from(segEl.querySelectorAll('.tilt-char')),
      });
    });

    rootEl.appendChild(lineEl);
    currentLineEl = lineEl;
    currentSegments = segStates;
    currentLineIndex = lineIndex;
  }

  function revealSegment(seg, snap) {
    if (seg.visible) return;
    seg.visible = true;
    gsap.to(seg.el, {
      opacity: 1, y: 0,
      duration: snap ? 0 : (seg.isAccent ? 0.55 : 0.5), ease: ENTER_EASE,
    });
    for (const spanEl of seg.allSpans) {
      gsap.to(spanEl, { opacity: 1, duration: snap ? 0 : 0.45, ease: ENTER_EASE });
    }
    for (const c of seg.charEls) {
      gsap.to(c.el, {
        opacity: 1, y: c.baseY,
        duration: snap ? 0 : 0.45,
        delay: snap ? 0 : c.enterDelay,
        ease: ENTER_EASE,
      });
    }
    if (seg.beatLine) {
      gsap.to(seg.beatLine, {
        opacity: 0.78, scaleX: 1,
        duration: snap ? 0 : 0.7,
        delay: snap ? 0 : 0.08,
        ease: 'power3.out',
      });
    }
  }

  function updateSegments(timeMs, snap) {
    for (const seg of currentSegments) {
      if (!seg.visible && timeMs >= seg.startMs - 250) revealSegment(seg, snap);
      if (!seg.visible) continue;

      // 逐字脈衝：只掃時間窗附近的字（遠離窗口的凍結在基線，不逐幀重寫）
      for (const c of seg.charEls) {
        const windowEnd = c.startMs + PULSE_SPAN_MS * 3;
        if (timeMs < c.startMs - 200 || timeMs > windowEnd) {
          if (c.lastBucket !== 0 && timeMs > windowEnd) {
            const s = 1 + PULSE_FLOOR * (c.isAccent ? PULSE_AMP_ACCENT : PULSE_AMP_BASE);
            c.el.style.transform = c.baseY ? `translateY(${c.baseY}px) scale(${s.toFixed(3)})` : `scale(${s.toFixed(3)})`;
            c.lastBucket = 0;
          }
          continue;
        }
        const p = pulseAt(timeMs, c.startMs);
        const bucket = Math.round(p * 30);
        if (bucket !== c.lastBucket) {
          c.lastBucket = bucket;
          const s = 1 + p * (c.isAccent ? PULSE_AMP_ACCENT : PULSE_AMP_BASE);
          c.el.style.transform = c.baseY ? `translateY(${c.baseY}px) scale(${s.toFixed(3)})` : `scale(${s.toFixed(3)})`;
        }
      }
    }
  }

  function retireCurrentLine(ctx, snap) {
    if (!currentLineEl) return;
    const el = currentLineEl;
    currentLineEl = null; currentSegments = [];
    gsap.killTweensOf(el);
    gsap.killTweensOf(el.querySelectorAll('*'));
    if (snap || ctx.isFastMode() || typeof gsap === 'undefined') {
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    gsap.to(el, {
      opacity: 0, duration: 0.45, ease: 'power1.inOut',
      onComplete: () => { if (el.parentNode) el.parentNode.removeChild(el); },
    });
  }

  function clearAll(ctx) {
    retireCurrentLine(ctx, true);
    currentLineIndex = -1;
    currentTempo = null;
  }

  LyricTemplates.register({
    id: 'tilt',
    label: '斜拍告白',

    mount(container, ctx) {
      rootEl = document.createElement('div');
      rootEl.id = 'tilt-root';
      container.appendChild(rootEl);
      refreshColors();
      currentLineIndex = -1;
    },

    destroy() {
      if (currentLineEl) {
        gsap.killTweensOf(currentLineEl);
        gsap.killTweensOf(currentLineEl.querySelectorAll('*'));
      }
      if (rootEl) {
        gsap.killTweensOf(rootEl.querySelectorAll('*'));
        if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      }
      rootEl = null; currentLineEl = null; currentSegments = []; currentLineIndex = -1;
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
        updateSegments(timeMs, true);
      }
    },

    onFrame(timeMs, ctx) {
      if (currentLineIndex < 0) return;
      updateSegments(timeMs, ctx.isFastMode());
    },
  });
})();
