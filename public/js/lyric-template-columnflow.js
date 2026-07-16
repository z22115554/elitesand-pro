/**
 * Elitesand Pro 排版模板：直書句流（2026-07，逐格分析使用者提供的兩支參考 MV 後設計）
 *
 * 機制（視覺重現，零程式碼取自參考）：
 * - 每句歌詞是一個直排（vertical-rl）直行，唱到哪個字哪個字浮現（逐字素時間）
 * - 直行以固定種子的隨機欄位錯落散佈，像把字寫滿一頁紙
 * - 唱過的直行留在原地，依「距今幾句」逐級模糊＋減淡（殘影保留軌跡又不干擾當前行）
 * - 固定保留最近四句；新句補上時，最舊的一句才淡出，落點由亂數種子決定
 * - 超長句子依可用高度切成多個延續直行，往左自然續接（傳統直書換行方向）
 *
 * 兩種外觀（同一模板、同一機制）：
 * - sen（素筆）：細明朝素字，逐字浮現＋輕微下沉入定
 * - fuda（字札）：每字一格白色字札，歪斜掉入再擺正（傾角由亂數種子決定）
 * 外觀由 body.dataset.columnflowVariant 驅動（display.js 套設定時寫入），逐幀比對字串成本可忽略。
 *
 * 完全時間驅動（同 KTV 模板）：onFrame/onSeek 都只吃 timeMs 自算，不依賴行索引事件，
 * 倒帶/大跳轉天然正確。逐幀成本：二分搜尋＋單一活躍行的字素線性掃描（<40 字）。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined') {
    console.warn('[Columnflow] 依賴未載入，模板停用');
    return;
  }

  const { hashNoise } = LyricMotion;

  const PAGE_SIZE = 4;        // 同時最多可見：1 活躍 + 3 殘影
  const GHOST_BLUR = [0, 1.2, 2.4, 3.8];   // 依 age 的模糊 px
  const GHOST_OPACITY = [1, 0.6, 0.38, 0.2];
  const GHOST_RISE_PX = 6;    // sen 外觀殘影每級上飄量（fuda 不飄）
  const TOP_BASE_PCT = 6;
  const JITTER_Y_PCT = 8;
  const DEAD_REMOVE_MS = 750; // 淡出後移除 DOM 的延遲（略大於 CSS transition）

  let rootEl = null;
  let cols = new Map();       // planOrdinal -> { el, glyphs: [{el, startMs}], age, onCount }
  let plans = [];
  let plansForLines = null;
  let plansKey = '';
  let variantApplied = '';

  function getCssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function fontPxFromSettings() {
    const px = parseFloat(getCssVar('--display-font-size', '34'));
    return Number.isFinite(px) && px > 0 ? Math.min(px, 96) : 34;
  }

  /** 直行可用高度（root 高度的 84%，上下各留邊）。 */
  function availableColumnHeight() {
    const vh = (rootEl && rootEl.clientHeight) || window.innerHeight || 720;
    return vh * 0.84;
  }

  function currentVariant() {
    const value = document.body.dataset.columnflowVariant;
    return ['sen', 'fuda'].includes(value) ? value : 'sen';
  }

  function currentPlacement() {
    const value = document.body.dataset.columnflowPlacement;
    return ['left', 'right', 'split'].includes(value) ? value : 'split';
  }

  // ─── 佈局計畫：整首歌攤平成「直行計畫」陣列（只含有文字的行）───

  function buildPlans(lines, fontPx) {
    const out = [];
    const perCol = Math.max(4, Math.floor(availableColumnHeight() / (fontPx * 1.34)));
    for (let li = 0; li < lines.length; li += 1) {
      const line = lines[li];
      if (!line || !line.text) continue;
      const words = LyricMotion.ensureWordTimings(line, lines, li);
      const glyphs = [];
      for (const w of words) {
        for (const g of LyricMotion.buildGraphemeTimings(w)) {
          if (!/\s/u.test(g.char)) glyphs.push(g);
        }
      }
      if (glyphs.length === 0) continue;

      const ord = out.length;
      const page = Math.floor(ord / PAGE_SIZE);
      const slot = ord % PAGE_SIZE;
      // seed 讓相鄰句的左右落點穩定但不固定。
      const seed = li * 131 + page * 977;
      // 直書只落在左右保留區；split 交錯側別，避免所有句子擠在同一側。
      const placement = currentPlacement();
      const side = placement === 'split'
        ? ((slot + Math.floor(hashNoise(page, 5) * 2)) % 2 === 0 ? 'left' : 'right')
        : placement;
      const sideLanes = side === 'left' ? [12, 22, 32] : [68, 78, 88];
      const lane = (Math.floor(hashNoise(seed, 1) * sideLanes.length) + Math.floor(ord / 2)) % sideLanes.length;
      const leftPct = sideLanes[lane] + (hashNoise(seed, 6) - 0.5) * 4;
      const topPct = TOP_BASE_PCT + hashNoise(seed, 2) * (JITTER_Y_PCT + 10);

      // 超長句：依可用高度切段，段與段在直書流裡自然往左續接
      const segments = [];
      for (let s = 0; s < glyphs.length; s += perCol) {
        segments.push(glyphs.slice(s, s + perCol));
      }

      out.push({
        ord,
        lineIndex: li,
        page,
        leftPct,
        topPct,
        segments,
        startMs: glyphs[0].startMs,
      });
    }
    return out;
  }

  function ensurePlans(lines) {
    const fontPx = fontPxFromSettings();
    const key = `${currentVariant()}|${currentPlacement()}|${fontPx.toFixed(1)}|${Math.round(availableColumnHeight())}`;
    if (plansForLines === lines && plansKey === key) return plans;
    plans = buildPlans(lines, fontPx);
    plansForLines = lines;
    plansKey = key;
    clearAllColumns(true);
    return plans;
  }

  function findPlanAtOrBefore(timeMs) {
    let lo = 0; let hi = plans.length - 1; let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (plans[mid].startMs <= timeMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // ─── DOM ───

  function createColumn(plan, fontPx) {
    const el = document.createElement('div');
    el.className = 'cf-col';
    el.style.left = `${plan.leftPct}%`;
    el.style.top = `${plan.topPct}%`;
    el.style.fontSize = `${fontPx}px`;

    const glyphEls = [];
    plan.segments.forEach((segment) => {
      const sub = document.createElement('div');
      sub.className = 'cf-sub';
      segment.forEach((g, gi) => {
        const span = document.createElement('span');
        span.className = 'cf-g';
        span.textContent = g.char;
        // 字札外觀的傾角（素筆外觀不讀這兩個變數，共存無害）
        const gSeed = plan.lineIndex * 97 + gi * 31;
        const direction = hashNoise(gSeed, 3) > 0.5 ? 1 : -1;
        const startRotation = direction * (18 + hashNoise(gSeed, 4) * 18);
        const restRotation = direction * hashNoise(gSeed, 5) * 2.6;
        span.style.setProperty('--cf-rotate-start', `${startRotation.toFixed(1)}deg`);
        span.style.setProperty('--cf-rotate-rest', `${restRotation.toFixed(1)}deg`);
        span.style.setProperty('--cf-entry-x', `${(0.12 + hashNoise(gSeed, 6) * 0.16).toFixed(2)}em`);
        span.style.setProperty('--cf-entry-y', `${(0.05 + hashNoise(gSeed, 7) * 0.14).toFixed(2)}em`);
        sub.appendChild(span);
        glyphEls.push({ el: span, startMs: g.startMs });
      });
      el.appendChild(sub);
    });

    rootEl.appendChild(el);
    return { el, glyphs: glyphEls, age: -1, onCount: -1 };
  }

  function fadeRemoveColumn(item) {
    item.el.classList.add('cf-dead');
    const dead = item.el;
    setTimeout(() => { if (dead.parentNode) dead.parentNode.removeChild(dead); }, DEAD_REMOVE_MS);
  }

  function clearAllColumns(immediate) {
    cols.forEach((item) => {
      if (immediate) {
        if (item.el.parentNode) item.el.parentNode.removeChild(item.el);
      } else {
        fadeRemoveColumn(item);
      }
    });
    cols.clear();
  }

  function applyAge(item, age) {
    if (item.age === age) return;
    item.age = age;
    const isSen = variantApplied !== 'fuda';
    const rise = isSen ? -(age * GHOST_RISE_PX) : 0;
    item.el.style.transform = `translateY(${rise}px)`;
    item.el.style.filter = `blur(${GHOST_BLUR[age] || 0}px)`;
    item.el.style.opacity = String(GHOST_OPACITY[age] != null ? GHOST_OPACITY[age] : 0.2);
  }

  /** 活躍行逐字顯影；殘影行全亮。倒帶時同一迴圈自然把未來的字關回去。 */
  function applyGlyphStates(item, timeMs, isActive) {
    if (!isActive) {
      if (item.onCount === item.glyphs.length && !item.el.querySelector('.cf-cur')) return;
      item.glyphs.forEach((g) => { g.el.classList.add('cf-on'); g.el.classList.remove('cf-cur'); });
      item.onCount = item.glyphs.length;
      return;
    }
    let on = 0;
    for (let i = 0; i < item.glyphs.length; i += 1) {
      if (item.glyphs[i].startMs <= timeMs) on = i + 1; else break;
    }
    if (on === item.onCount) return;
    item.glyphs.forEach((g, i) => {
      g.el.classList.toggle('cf-on', i < on);
      g.el.classList.toggle('cf-cur', i === on - 1);
    });
    item.onCount = on;
  }

  function syncVariant() {
    const v = currentVariant();
    if (v === variantApplied || !rootEl) return;
    variantApplied = v;
    rootEl.classList.toggle('cf-sen', v === 'sen');
    rootEl.classList.toggle('cf-fuda', v === 'fuda');
    // 外觀切換影響殘影位移公式，強制下一幀重套
    cols.forEach((item) => { item.age = -1; });
  }

  // ─── 逐幀主邏輯 ───

  function computeAndRender(timeMs, lines) {
    if (!rootEl) return;
    syncVariant();
    ensurePlans(lines);
    if (plans.length === 0) { clearAllColumns(true); return; }

    const idx = findPlanAtOrBefore(timeMs);
    if (idx < 0) {
      // 前奏：畫面留白（同參考的空頁）
      if (cols.size > 0) clearAllColumns(false);
      return;
    }

    const firstVisibleOrd = Math.max(0, idx - (PAGE_SIZE - 1));
    const fontPx = fontPxFromSettings();

    // 移除：超出最近四句視窗，或在目前時間之後（倒帶）。
    cols.forEach((item, ord) => {
      const plan = plans[ord];
      if (!plan || ord < firstVisibleOrd || ord > idx) {
        fadeRemoveColumn(item);
        cols.delete(ord);
      }
    });

    // 補齊並套用滾動視窗內的直行。
    for (let ord = firstVisibleOrd; ord <= idx; ord += 1) {
      const plan = plans[ord];
      if (!plan) break;
      let item = cols.get(ord);
      if (!item) {
        item = createColumn(plan, fontPx);
        cols.set(ord, item);
      }
      applyAge(item, Math.min(idx - ord, GHOST_BLUR.length - 1));
      applyGlyphStates(item, timeMs, ord === idx);
    }
  }

  // ─── 模板註冊 ───

  LyricTemplates.register({
    id: 'columnflow',
    label: '直書句流',

    mount(container, ctx) {
      rootEl = document.createElement('div');
      rootEl.id = 'columnflow-root';
      container.appendChild(rootEl);
      cols = new Map();
      plansForLines = null;
      variantApplied = '';
      syncVariant();
    },

    destroy() {
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null;
      cols = new Map();
      plans = [];
      plansForLines = null;
    },

    onLyricsLoaded(lines, ctx) {
      plansForLines = null; // 新歌強制重建佈局
      clearAllColumns(true);
    },

    onSeek(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },

    onFrame(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },
  });
})();
