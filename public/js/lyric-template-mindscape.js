/**
 * Elitesand Pro 排版模板：潮汐心景（v6，2026-07 全面重寫）
 *
 * 「重型排版」模式：一行歌詞先按量測寬度折行，其中一個詞被選為 hero（主角詞）
 * 放大置中，其餘詞保持閱讀順序、被 hero 徑向推離讓位——像潮水繞過礁石。
 * 動畫不是 GSAP timeline，而是逐幀對目標值做指數平滑，pending→live→done 三相：
 *   pending：透明、縮小 0.86（不可見時整個 skip 繪製）
 *   live：放大 1.18×、亮色漸染、光暈包絡
 *   done：沿自身徑向緩慢外漂、亮度回落 0.72
 *
 * 2026-07-11 AGPL 稽核後重寫：hero 選拔（時長×√字素）、佈局（閱讀序＋徑向推離，
 * 非環形採樣搜索）、字級公式、全部包絡曲線與常數皆為原創設計。
 *
 * 效能紀律（monet 卡頓教訓的全套，專案自有）：詞級 filter:blur 一律不用；
 * 所有逐幀寫入先量化再 diff（transform 1px/0.5°、染色 20 階、光暈 12 階 bucket）；
 * 不可見詞 visibility:hidden 整個跳過；唱完漂移走完的詞徹底凍結。
 *
 * 依賴：LyricMotion（kernel）、gsap（僅行退場）、LyricTemplates。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined') {
    console.warn('[Mindscape] 依賴未載入，模板停用');
    return;
  }

  const { clamp, hashNoise, hashSpread } = LyricMotion;
  const CJK_TEST = /[一-龥぀-ヿ가-힯]/;

  const HERO_EMPHASIS = 1.52;   // hero 放大倍率
  const LIVE_SCALE = 1.18;      // 唱到的詞放大倍率
  const DONE_ALPHA = 0.72;      // 唱過的詞餘暉透明度
  const DRIFT_SPAN_MS = 2400;   // 唱過後外漂的總時長

  let rootEl = null;
  let current = null;       // 目前行的完整狀態 { lineEl, words:[wordState], tempo, layout, lineIndex }
  let lastFrameNow = null;
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

  // ─── 顏色混合（逐幀用，hex 解析結果快取）───

  const hexCache = new Map();
  function parseColor(c) {
    if (hexCache.has(c)) return hexCache.get(c);
    let rgb = [255, 255, 255];
    const hex = c.trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    } else if (/^#[0-9a-f]{3}$/i.test(hex)) {
      rgb = [parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), parseInt(hex[3] + hex[3], 16)];
    } else {
      const m = hex.match(/rgba?\(([^)]+)\)/);
      if (m) rgb = m[1].split(',').slice(0, 3).map((n) => parseFloat(n));
    }
    if (hexCache.size > 64) hexCache.clear();
    hexCache.set(c, rgb);
    return rgb;
  }

  function mixColors(a, b, t) {
    if (t <= 0.005) return a;
    if (t >= 0.995) return b;
    const ca = parseColor(a); const cb = parseColor(b);
    return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(ca[1] + (cb[1] - ca[1]) * t)},${Math.round(ca[2] + (cb[2] - ca[2]) * t)})`;
  }

  function colorAlpha(c, alpha) {
    const rgb = parseColor(c);
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
  }

  // ─── 曲線 ───
  const mixNum = (a, b, t) => a + (b - a) * t;
  const easeOutQuint = (v) => 1 - Math.pow(1 - clamp(v, 0, 1), 5);
  const easeOutQuad = (v) => { const n = clamp(v, 0, 1); return n * (2 - n); };

  // ─── 字級與排版幾何 ───

  function graphemeCount(text) {
    return Array.from(text || '').length;
  }

  function fontPxFor(line, vw) {
    const userScale = (parseFloat(getCssVar('--display-font-size', '42')) || 42) / 42;
    const base = clamp(vw * 0.075, 30, 84);
    const g = graphemeCount(line.text);
    const shrink = g > 10 ? clamp(1 - (g - 10) * 0.022, 0.55, 1) : 1;
    return clamp(base * shrink * userScale, 22, 110);
  }

  function measureWidth(text, fontSpec) {
    const offs = LyricMotion.measureCharOffsets(text, fontSpec);
    return offs[offs.length - 1] || 0;
  }

  function isInterludeText(text) {
    return /^[\s.…·。]+$/.test((text || '').trim()) && (text || '').trim().length > 0;
  }

  /**
   * 佈局主體：折行 → 選 hero → 閱讀序徑向推離。
   * 全部確定性（seed=行起始毫秒），同一行的幾何永遠相同。
   */
  function buildLayout(line, displayWords, vw) {
    const seed = line.time | 0;
    const fontPx = fontPxFor(line, vw);
    const fontSpec = `700 ${fontPx}px ${getCssVar('--display-font-family', 'sans-serif')}`;
    const isCjkLine = CJK_TEST.test(line.text || '');
    const lineHeight = Math.round(fontPx * (isCjkLine ? 1.28 : 1.16));
    const interlude = isInterludeText(line.text);

    // 折行寬度：以視口的 62% 為目標（心象要「一團」而非長條）
    const availableWidth = Math.max(vw - 48, 120);
    const maxWidth = clamp(vw * 0.62, Math.min(200, availableWidth), availableWidth);

    // 貪婪折行（標準排版技術；量測用去尾空白的文字，前進距離含空白）
    const rows = [];
    let row = { items: [], width: 0 };
    for (let i = 0; i < displayWords.length; i += 1) {
      const dw = displayWords[i];
      const advance = measureWidth(dw.text, fontSpec);
      const visible = measureWidth(dw.text.replace(/\s+$/, ''), fontSpec);
      if (row.items.length > 0 && row.width + visible > maxWidth) {
        rows.push(row);
        row = { items: [], width: 0 };
      }
      row.items.push({ dw, wordIndex: i, x: row.width, width: visible });
      row.width += advance;
    }
    if (row.items.length > 0) rows.push(row);
    for (const r of rows) {
      const lastItem = r.items[r.items.length - 1];
      r.width = lastItem.x + lastItem.width;
    }

    const totalHeight = Math.max(rows.length, 1) * lineHeight;

    // hero 選拔：演唱時長 × √字素數 最高者（唱得久的重點詞）；平手取較早出現的
    let heroIndex = -1;
    if (!interlude && displayWords.length > 1) {
      let bestScore = -1;
      displayWords.forEach((dw, i) => {
        if (!dw.text.trim()) return;
        const score = Math.max(dw.endMs - dw.startMs, 40) * Math.sqrt(graphemeCount(dw.text.trim()));
        if (score > bestScore) { bestScore = score; heroIndex = i; }
      });
    }

    // 初始位置：閱讀序排版（各行水平置中、垂直堆疊）
    const placements = [];
    rows.forEach((r, rowIdx) => {
      const rowLeft = -r.width / 2;
      const baselineY = -totalHeight / 2 + fontPx + rowIdx * lineHeight;
      r.items.forEach((item) => {
        const isHero = item.wordIndex === heroIndex;
        const scale = isHero ? HERO_EMPHASIS : 1;
        placements.push({
          dw: item.dw,
          wordIndex: item.wordIndex,
          isHero,
          x: rowLeft + item.x,
          y: baselineY,
          width: item.width,
          height: fontPx,
          scale,
        });
      });
    });

    // 徑向推離：hero 放大後佔的區域把周圍的詞沿「hero→詞」向量推出去，
    // 再對後續詞間的殘餘重疊沿閱讀方向順推。兩趟即可收斂（詞數少）。
    const hero = placements.find((p) => p.isHero) || null;
    if (hero && !interlude) {
      const hx = hero.x + hero.width / 2;
      const hy = hero.y - hero.height * 0.45;
      const heroHalfW = (hero.width * HERO_EMPHASIS) / 2;
      const heroHalfH = (hero.height * HERO_EMPHASIS) / 2;

      for (const p of placements) {
        if (p.isHero) continue;
        const wx = p.x + p.width / 2;
        const wy = p.y - p.height * 0.45;
        let vx = wx - hx;
        let vy = wy - hy;
        // 正好同心（同列相鄰）：往自己的閱讀側推
        if (Math.abs(vx) < 1 && Math.abs(vy) < 1) { vx = p.wordIndex > hero.wordIndex ? 1 : -1; vy = 0; }
        // 需要的間隔：橢圓近似（水平吃 hero 半寬、垂直吃 hero 半高）
        const norm = Math.hypot(vx / (heroHalfW + p.width / 2), vy / (heroHalfH + p.height));
        if (norm < 1) {
          const push = (1 - norm) + 0.12;
          const len = Math.max(Math.hypot(vx, vy), 1);
          p.x += (vx / len) * push * heroHalfW * 0.9;
          p.y += (vy / len) * push * heroHalfH * 1.1;
        }
        // 每個詞再加一點雜湊漣漪（潮水的不齊）
        p.x += hashSpread(seed, p.wordIndex * 8 + 1) * fontPx * (intensity === 'chaotic' ? 0.22 : 0.08);
        p.y += hashSpread(seed, p.wordIndex * 8 + 2) * fontPx * (intensity === 'chaotic' ? 0.18 : 0.07);
      }

      // 詞間殘餘重疊：按閱讀序，後者向下讓位
      for (let pass = 0; pass < 2; pass += 1) {
        for (let i = 0; i < placements.length; i += 1) {
          for (let j = i + 1; j < placements.length; j += 1) {
            const a = placements[i]; const b = placements[j];
            if (a.isHero || b.isHero) continue;
            const ax2 = a.x + a.width * a.scale; const ay1 = a.y - a.height * a.scale;
            const bx2 = b.x + b.width * b.scale; const by1 = b.y - b.height * b.scale;
            const overlapX = Math.min(ax2, bx2) - Math.max(a.x, b.x);
            const overlapY = Math.min(a.y, b.y) - Math.max(ay1, by1);
            if (overlapX > 0 && overlapY > 0) {
              b.y += overlapY + fontPx * 0.1;
            }
          }
        }
      }
    }

    // 唱過後的外漂向量：沿自身相對畫面中心的方向
    for (const p of placements) {
      const cx = p.x + p.width / 2;
      const cy = p.y - p.height * 0.45;
      const len = Math.max(Math.hypot(cx, cy), 1);
      const amount = interlude ? 4
        : p.isHero ? 6 + hashNoise(seed, p.wordIndex * 8 + 3) * 5
          : (intensity === 'chaotic' ? 10 : 6) + hashNoise(seed, p.wordIndex * 8 + 3) * (intensity === 'chaotic' ? 8 : 5);
      p.driftX = (cx / len) * amount + hashSpread(seed, p.wordIndex * 8 + 4) * 2;
      p.driftY = (cy / len) * amount * 0.7 + hashSpread(seed, p.wordIndex * 8 + 5) * 2;
      p.doneSpin = hashSpread(seed, p.wordIndex * 8 + 6) * (intensity === 'chaotic' ? 9 : 4);
      p.interlude = interlude;
    }
    placements.sort((a, b) => a.wordIndex - b.wordIndex);

    return { fontPx, fontSpec, lineHeight, totalHeight, placements, interlude };
  }

  // ─── 詞的三相時間函式（原創包絡）───

  function wordPhase(timeMs, dw, tempo) {
    const liveEndMs = tempo.snapReveal ? tempo.windowEndMs : dw.endMs;
    return LyricMotion.phaseOf(timeMs, dw.startMs, liveEndMs, tempo.snapReveal ? 0 : tempo.revealLeadMs);
  }

  /** 亮色染色程度：唱到時線性走到 1，唱完後按節奏連續時長淡回 */
  function inkMix(timeMs, dw, tempo) {
    if (tempo.snapReveal) {
      return timeMs < dw.startMs ? 0 : (timeMs <= tempo.windowEndMs ? 1 : 0);
    }
    if (timeMs < dw.startMs) return 0;
    const dur = Math.max(dw.endMs - dw.startMs, 60);
    if (timeMs <= dw.endMs) return clamp((timeMs - dw.startMs) / dur, 0, 1);
    const fadeMs = 250 + 550 * tempo.pace;
    return 1 - clamp((timeMs - dw.endMs) / fadeMs, 0, 1);
  }

  /** 光暈包絡：快啟（前 22% quint 拉滿）→ 持平 → 唱完 700ms 二次衰減 */
  function glowLevel(timeMs, dw, tempo) {
    if (timeMs < dw.startMs) return 0;
    if (tempo.snapReveal) {
      if (timeMs > tempo.windowEndMs) return 0;
      return easeOutQuint(clamp((timeMs - dw.startMs) / 90, 0, 1));
    }
    const dur = Math.max(dw.endMs - dw.startMs, 80);
    if (timeMs <= dw.endMs) {
      const p = clamp((timeMs - dw.startMs) / dur, 0, 1);
      return p < 0.22 ? easeOutQuint(p / 0.22) : 1;
    }
    const rel = clamp((timeMs - dw.endMs) / 700, 0, 1);
    return (1 - rel) * (1 - rel);
  }

  /** 逐字素光帶（拉丁多字素詞）：每字素亮起後拖 4× 字素時長的殘光 */
  function charGlow(timeMs, grapheme, dw) {
    const dur = Math.max(grapheme.endMs - grapheme.startMs, 20);
    const u = (timeMs - grapheme.startMs) / (dur * 4);
    if (u <= 0 || u >= 1) return 0;
    const level = u < 0.25 ? easeOutQuint(u / 0.25) : 1 - easeOutQuad((u - 0.25) / 0.75);
    if (timeMs <= dw.endMs) return level;
    return level * (1 - clamp((timeMs - dw.endMs) / 700, 0, 1));
  }

  /** 唱過後外漂進度（0→1，easeOutQuad，走完凍結） */
  function driftProgress(timeMs, dw) {
    if (timeMs <= dw.endMs) return 0;
    return easeOutQuad(clamp((timeMs - dw.endMs) / DRIFT_SPAN_MS, 0, 1));
  }

  /** 行容器包絡：進場浮起（y-lift）＋退場上散，不用 blur */
  function lineEnvelope(timeMs, line, tempo) {
    const exitStart = Math.max(tempo.windowEndMs - tempo.exitMs, line.time);
    const enterP = easeOutQuint(clamp((timeMs - line.time + tempo.entryMs * 0.3) / Math.max(tempo.entryMs, 1), 0, 1));
    const exitP = easeOutQuad(clamp((timeMs - exitStart) / Math.max(tempo.exitMs, 1), 0, 1));
    return {
      opacity: clamp(enterP * (1 - exitP), 0, 1),
      lift: (1 - enterP) * 14 - exitP * 12,
      scale: mixNum(mixNum(0.975, 1, enterP), 1.03, exitP),
    };
  }

  // ─── DOM 建立 ───

  function buildLine(ctx, lineIndex) {
    const lines = ctx.getLyrics();
    const line = lines[lineIndex];
    if (!line || !line.text) return;

    refreshColors();
    const tempo = LyricMotion.lineTempo(lines, lineIndex);
    const words = LyricMotion.ensureWordTimings(line, lines, lineIndex);
    const displayWords = LyricMotion.buildDisplayWords(words);
    const vp = LyricMotion.layoutViewport(rootEl, lineIndex);
    const layout = buildLayout(line, displayWords, vp.width);

    const lineEl = document.createElement('div');
    lineEl.className = 'mindscape-line';
    if (vp.sideClass) lineEl.classList.add(vp.sideClass);
    // 只設字重/字級，字體名稱刻意不寫進 inline style——讓它繼承 #mindscape-root 的
    // `font-family: var(--display-font-family)`，CSS 變數改變時立刻生效（換字體即時反映）。
    lineEl.style.fontWeight = '700';
    lineEl.style.fontSize = `${layout.fontPx}px`;

    const tideRings = document.createElement('div');
    tideRings.className = 'ms-tide-rings';
    tideRings.setAttribute('aria-hidden', 'true');
    tideRings.appendChild(document.createElement('i'));
    tideRings.appendChild(document.createElement('i'));
    lineEl.appendChild(tideRings);

    const wordStates = layout.placements.map((pl) => {
      const outer = document.createElement('div');
      outer.className = 'ms-word';

      const body = document.createElement('span');
      body.className = 'ms-body';
      body.textContent = pl.dw.text.replace(/\s+$/, '');

      const glow = document.createElement('span');
      glow.className = 'ms-glow';
      // 拉丁多字素詞在從容節奏下逐字素光帶；其餘整詞單一光暈
      const text = pl.dw.text.replace(/\s+$/, '');
      const splitGlow = !tempo.snapReveal && !CJK_TEST.test(text) && graphemeCount(text) > 1;
      const glowSpans = [];
      if (splitGlow && pl.dw.graphemes) {
        for (const gt of pl.dw.graphemes) {
          if (/^\s+$/.test(gt.char)) continue;
          const span = document.createElement('span');
          span.textContent = gt.char;
          glow.appendChild(span);
          glowSpans.push({ el: span, timing: gt, lastBucket: -1 });
        }
      } else {
        const span = document.createElement('span');
        span.textContent = text;
        glow.appendChild(span);
        glowSpans.push({ el: span, timing: null, lastBucket: -1 });
      }

      outer.appendChild(body);
      outer.appendChild(glow);
      lineEl.appendChild(outer);

      return {
        pl, outer, body, glowSpans, splitGlow,
        anim: null,       // 指數平滑動畫狀態（首幀初始化為 pending 起點）
        settled: false,
        lastTransform: '', lastColor: '', lastOpacity: -1, hidden: false,
      };
    });

    rootEl.appendChild(lineEl);

    current = {
      lineEl, words: wordStates, tempo, layout, line, lineIndex,
      envCache: { opacity: -1, scale: -1, lift: -1 },
      rootH: rootEl.clientHeight || 0,
      rootW: vp.width, // 有效排版寬（split 模式為容器的 48%），frame 的 centerX 以此為準
    };
    lastFrameNow = null;
  }

  function retireCurrentLine(snap) {
    if (!current) return;
    const el = current.lineEl;
    current = null;
    if (snap || typeof gsap === 'undefined') {
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    // 舊行上散淡出、新行同時進場（各自 absolute 定位互不干擾）
    gsap.to(el, {
      opacity: 0, y: -12, scale: 1.05, duration: 0.3, ease: 'power2.out',
      onComplete: () => { if (el.parentNode) el.parentNode.removeChild(el); },
    });
  }

  // ─── 逐幀更新（指數平滑 + diff-write）───

  function frame(timeMs, ctx) {
    if (!current) return;
    const now = performance.now();
    const dt = lastFrameNow === null ? 1 / 60 : clamp((now - lastFrameNow) / 1000, 1 / 240, 0.05);
    lastFrameNow = now;
    const fast = ctx.isFastMode();

    const { tempo, line, words } = current;
    const timeSec = timeMs / 1000;
    const swayAmp = intensity === 'chaotic' ? 6 : intensity === 'calm' ? 2 : 4;

    // 行包絡＋潮汐浮動。浮動做在「行容器」單一元素上（Luminous 順的同一原則）。
    const env = lineEnvelope(timeMs, line, tempo);
    const ec = current.envCache;
    if (Math.abs(env.opacity - ec.opacity) > 0.004) {
      current.lineEl.style.opacity = env.opacity.toFixed(3);
      ec.opacity = env.opacity;
    }
    const sway = Math.round(Math.sin(timeSec * 1.7) * swayAmp * 2) / 2;
    const envScale = Math.round(env.scale * 500) / 500;
    const lift = Math.round((env.lift + sway) * 2) / 2;
    if (envScale !== ec.scale || lift !== ec.lift) {
      current.lineEl.style.transform = `translate3d(0,${lift}px,0) scale(${envScale})`;
      ec.scale = envScale;
      ec.lift = lift;
    }

    const width = current.rootW || rootEl.clientWidth || (window.innerWidth || 1280);
    const height = current.rootH || rootEl.clientHeight || 400;
    const focusY = height * 0.42;
    const centerX = width / 2;

    const kT = 1 - Math.exp(-11 * dt);  // transform 平滑
    const kV = 1 - Math.exp(-14 * dt);  // 透明/染色平滑
    const kG = 1 - Math.exp(-16 * dt);  // 光暈平滑

    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      const pl = w.pl;
      const dw = pl.dw;
      const phase = wordPhase(timeMs, dw, tempo);
      const driftP = tempo.snapReveal ? 0 : driftProgress(timeMs, dw);

      // 已唱完且外漂走完的詞徹底凍結（光暈尾巴 0.7s < 外漂 2.4s，此時必已歸零）。
      // 拖曳進度條（fast）時解凍讓詞重新落位；換行/seek 則直接重建整行。
      if (fast) w.settled = false;
      if (w.settled) continue;
      if (phase === 'done' && driftP >= 1 && w.anim) w.settled = true;

      // 唱到的詞放大後定住（不做持續脈衝——scale 每變一次就要重點陣化發光圖層，
      // OBS 軟體渲染扛不住；與墨字引擎的到位即停同一原則）
      const targetScale = phase === 'pending' ? (tempo.snapReveal ? pl.scale : pl.scale * 0.86)
        : phase === 'live' ? (tempo.snapReveal ? pl.scale : pl.scale * LIVE_SCALE)
          : pl.scale;
      const targetRot = phase === 'done' && !tempo.snapReveal ? pl.doneSpin * driftP : 0;
      const targetX = centerX + pl.x + (phase === 'done' ? pl.driftX * driftP : 0);
      const targetY = focusY + pl.y + (phase === 'done' ? pl.driftY * driftP : 0);
      const targetAlpha = phase === 'pending' ? 0 : phase === 'live' ? 1 : (tempo.snapReveal ? 0 : DONE_ALPHA);
      const targetMix = inkMix(timeMs, dw, tempo);
      const targetGlow = glowLevel(timeMs, dw, tempo);
      // 效能：詞級 blur 一律不用；pending→可見的朦朧感由 alpha 淡入＋scale 放大代替。

      let a = w.anim;
      if (!a || fast) {
        const startAtTarget = fast || (tempo.snapReveal && timeMs >= dw.startMs);
        a = w.anim = {
          x: startAtTarget ? targetX : centerX + pl.x,
          y: startAtTarget ? targetY : focusY + pl.y + 10,
          rot: startAtTarget ? targetRot : 0,
          scale: startAtTarget ? targetScale : pl.scale * 0.86,
          alpha: startAtTarget ? targetAlpha : 0,
          mix: startAtTarget ? targetMix : 0,
          glow: startAtTarget ? targetGlow : 0,
        };
      }
      a.x = mixNum(a.x, targetX, kT);
      a.y = mixNum(a.y, targetY, kT);
      a.rot = mixNum(a.rot, targetRot, kT);
      a.scale = mixNum(a.scale, targetScale, kT);
      a.alpha = mixNum(a.alpha, targetAlpha, kV);
      a.mix = mixNum(a.mix, targetMix, kV);
      a.glow = mixNum(a.glow, targetGlow, kG);

      // 不可見詞整個跳過
      const invisible = a.alpha < 0.015 && a.glow < 0.015;
      if (invisible) {
        if (!w.hidden) { w.outer.style.visibility = 'hidden'; w.hidden = true; }
        continue;
      }
      if (w.hidden) { w.outer.style.visibility = 'visible'; w.hidden = false; }

      // transform：值先量化（x/y 1px、rot 0.5°、scale 0.004）再 diff——
      // 收斂尾巴/慢速漂移的微小變化不再逐幀觸發大圖層重合成
      const qx = Math.round(a.x);
      const qy = Math.round(a.y - pl.height * 0.42);
      const qr = Math.round(a.rot * 2) / 2;
      const qs = Math.round(a.scale * 250) / 250;
      const tf = `translate3d(${qx}px,${qy}px,0) rotate(${qr}deg) scale(${qs})`;
      if (tf !== w.lastTransform) { w.outer.style.transform = tf; w.lastTransform = tf; }

      const opacityStr = a.alpha.toFixed(2);
      if (opacityStr !== w.lastOpacity) { w.body.style.opacity = opacityStr; w.lastOpacity = opacityStr; }

      // 染色：mix 量化 20 階，收斂後不再逐幀重算/重寫顏色
      const color = mixColors(colorsCache.base, colorsCache.active, Math.round(clamp(a.mix, 0, 1) * 20) / 20);
      if (color !== w.lastColor) { w.body.style.color = color; w.lastColor = color; }

      // 光暈（12 階 bucket；亮度以字級為尺度的單層影子＋外圈淡層）
      const glowBase = clamp(a.glow, 0, 1);
      const peakPx = Math.round(current.layout.fontPx * 0.5);
      for (const gs of w.glowSpans) {
        const level = (w.splitGlow && gs.timing) ? charGlow(timeMs, gs.timing, dw) * glowBase : glowBase;
        const bucket = Math.round(clamp(level, 0, 1) * 12);
        if (bucket !== gs.lastBucket) {
          gs.lastBucket = bucket;
          const v = bucket / 12;
          gs.el.style.textShadow = v <= 0.01 ? 'none'
            : `0 0 ${Math.round(peakPx * 0.5)}px ${colorAlpha(colorsCache.active, Math.min(0.95, v))}, 0 0 ${peakPx}px ${colorAlpha(colorsCache.active, Math.min(0.85, v * 0.85))}`;
        }
      }
    }
  }

  // ─── 模板註冊 ───

  LyricTemplates.register({
    id: 'mindscape',
    label: '潮汐心景',

    mount(container, ctx) {
      rootEl = document.createElement('div');
      rootEl.id = 'mindscape-root';
      container.appendChild(rootEl);
      refreshColors();
      current = null;
      lastFrameNow = null;
    },

    destroy() {
      if (current && typeof gsap !== 'undefined') gsap.killTweensOf(current.lineEl);
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null; current = null;
    },

    onLyricsLoaded(lines, ctx) {
      retireCurrentLine(true);
    },

    onLineChange(prevIndex, newIndex, ctx) {
      retireCurrentLine(ctx.isFastMode());
      if (newIndex >= 0) buildLine(ctx, newIndex);
    },

    onSeek(timeMs, ctx) {
      retireCurrentLine(true);
      const idx = ctx.getLineIndex();
      if (idx >= 0) {
        buildLine(ctx, idx);
        // 直接把動畫狀態落到目標（frame 的 fast 分支會做 snap 初始化）
        frame(timeMs, ctx);
      }
    },

    onFrame(timeMs, ctx) {
      frame(timeMs, ctx);
    },
  });
})();
