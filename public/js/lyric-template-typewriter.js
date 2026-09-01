/**
 * Elitesand Pro 排版模板：打字機（Typewriter）
 *
 * 仿 iMessage 聊天室：每句歌詞是一顆對話泡泡，字元逐字打出、游標貼著剛打出的字閃爍。
 * 已唱的句子不消失、往上疊；最新一句大約落在畫面下方 1/4 處。刻意極簡：不吃拼音／諧音／翻譯。
 *
 * 靠邊規則：
 *  - 合唱歌曲（歌詞帶聲部標記，出現 ≥2 個聲部）→ 一邊固定代表一個聲部；「合唱／未標」句左右隨機。
 *  - 非合唱：吃面板「歌詞位置」——全左 / 全右 / 左右分散（分散＝以 1–5 句為一段隨機交替）。
 * 泡泡色（藍／灰）、左右邊距、文字色都由面板設定即時套用（走 CSS 變數）。
 *
 * 完全時間驅動：onFrame／onSeek 只吃 adjustedTimeMs 自算「目前哪一句、已打幾個字」。
 * 逐幀成本：二分搜尋目前句 ＋ 單一活躍泡泡的字元線性掃描；只有換句才 append 一顆泡泡，
 * 其餘每幀只切「已打字數」的差集 class。倒帶／大跳轉／換靠邊模式由整段重建處理。
 *
 * 依賴：LyricTemplates；LyricMotion（kernel）有就用逐字時間，沒有就退回整句線性平分。
 */
(function () {
  if (typeof LyricTemplates === 'undefined') return;

  const KEEP = 16;               // DOM 裡最多保留幾顆泡泡（更舊的移出畫面就砍）
  const FALLBACK_LINE_MS = 2600; // 沒有下一句時間可參考時的整句時長
  const RUN_MIN = 1;             // 左右分散：同一側最少連續幾句
  const RUN_SPAN = 5;            // 段長 = RUN_MIN + [0, RUN_SPAN) → 1..5
  const SINGER_CODES = ['a', 'b', 'c', 'd'];

  let rootEl = null;
  // 依 DOM 順序（idx 遞增）：{ idx, text, side, bubble, charEls, charStartMs, shown }
  let entries = [];
  let runCache = [];          // 左右分散模式：第 i 句的側（含 _side/_left 進度）
  let sideMode = 'split';     // 'split' | 'left' | 'right' | 'duet'
  let duetMap = null;         // duet 模式：{ 聲部碼 -> 'left'|'right' }
  let dirty = false;
  let lastT = 0;

  function visibleLines(ctx) {
    const list = ctx && typeof ctx.getLyrics === 'function' ? ctx.getLyrics() : [];
    return Array.isArray(list) ? list.filter((l) => l && typeof l.time === 'number' && l.text) : [];
  }

  function lineIndexAt(lines, t) {
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function hash32(n) {
    n = (n ^ 61) ^ (n >>> 16);
    n = (n + (n << 3)) | 0;
    n ^= n >>> 4;
    n = Math.imul(n, 0x27d4eb2d);
    n ^= n >>> 15;
    return n >>> 0;
  }

  // 決定這首歌整體怎麼靠邊。合唱（≥2 聲部）永遠優先，其餘吃面板「歌詞位置」。
  function computeLayout(lines) {
    const seen = [];
    for (const l of lines) {
      const s = l && l.singer;
      if (s && s !== 'both' && SINGER_CODES.includes(s) && !seen.includes(s)) seen.push(s);
    }
    if (seen.length >= 2) {
      duetMap = {};
      seen.forEach((code, i) => { duetMap[code] = i % 2 === 0 ? 'right' : 'left'; });
      return 'duet';
    }
    duetMap = null;
    const pos = (document.body && document.body.dataset && document.body.dataset.lyricPos) || 'split';
    if (pos === 'left' || pos === 'right') return pos;
    return 'split'; // center / split / 未設 → 左右分散
  }

  // 左右分散：以 1–5 句為一段交替，段長依 index 決定 → 可重現，seek 不跳動。
  function runSideForIndex(i) {
    for (let k = runCache.length; k <= i; k += 1) {
      if (k === 0) {
        runCache._side = 'right';
        runCache._left = RUN_MIN + (hash32(0) % RUN_SPAN) - 1;
      } else if (runCache._left <= 0) {
        runCache._side = runCache._side === 'right' ? 'left' : 'right';
        runCache._left = RUN_MIN + (hash32(k) % RUN_SPAN) - 1;
      } else {
        runCache._left -= 1;
      }
      runCache[k] = runCache._side;
    }
    return runCache[i];
  }

  function sideForLine(line, idx) {
    if (sideMode === 'left' || sideMode === 'right') return sideMode;
    if (sideMode === 'duet') {
      const s = line && line.singer;
      if (s && s !== 'both' && duetMap && duetMap[s]) return duetMap[s];
      return (hash32((idx + 1) * 2654435761 >>> 0) & 1) ? 'right' : 'left'; // 合唱／未標：左右隨機
    }
    return runSideForIndex(idx);
  }

  // 回傳「目前句每個字元的絕對起始毫秒」。有逐字時間就用；對不上就整句線性平分。
  function charStartsFor(line, lines, idx, kernel) {
    const chars = Array.from(String(line.text || ''));
    if (kernel && typeof kernel.ensureWordTimings === 'function') {
      const out = [];
      try {
        for (const w of kernel.ensureWordTimings(line, lines, idx)) {
          const gs = typeof kernel.buildGraphemeTimings === 'function'
            ? kernel.buildGraphemeTimings(w)
            : [{ char: w.text, startMs: w.startMs }];
          for (const g of gs) out.push(Number(g.startMs) || line.time);
        }
      } catch (_) { out.length = 0; }
      if (out.length === chars.length) return out;
    }
    const start = line.time;
    const next = lines[idx + 1] && lines[idx + 1].time > start ? lines[idx + 1].time : start + FALLBACK_LINE_MS;
    const per = (next - start) / Math.max(1, chars.length);
    return chars.map((_, i) => start + per * i);
  }

  function buildBubble(line, lines, idx, kernel, instant) {
    const side = sideForLine(line, idx);
    const bubble = document.createElement('div');
    bubble.className = `tw-bubble tw-${side}${instant ? ' tw-in' : ''}`;
    const body = document.createElement('div');
    body.className = 'tw-body';
    const charEls = [];
    for (const ch of Array.from(String(line.text || ''))) {
      const s = document.createElement('span');
      s.className = 'tw-ch';
      s.textContent = ch;
      body.appendChild(s);
      charEls.push(s);
    }
    const caret = document.createElement('span');
    caret.className = 'tw-caret';
    caret.setAttribute('aria-hidden', 'true');
    body.appendChild(caret);
    bubble.appendChild(body);
    bubble.setAttribute('aria-label', String(line.text || ''));
    rootEl.appendChild(bubble);
    if (!instant) {
      const b = bubble;
      const kick = window.requestAnimationFrame || window.setTimeout;
      kick(() => { if (b.isConnected) b.classList.add('tw-in'); });
    }
    return {
      idx,
      text: String(line.text || ''),
      side,
      bubble,
      charEls,
      charStartMs: charStartsFor(line, lines, idx, kernel),
      shown: -1,
    };
  }

  // 逐字揭露：只切「已打字數」的差集 class；打完整句標記 tw-done（收游標）。
  function paintEntry(e, t) {
    let n = 0;
    for (let i = 0; i < e.charStartMs.length; i += 1) {
      if (t >= e.charStartMs[i]) n = i + 1; else break;
    }
    if (n === e.shown) return;
    const from = Math.min(e.shown < 0 ? 0 : e.shown, n);
    const to = Math.max(e.shown < 0 ? e.charEls.length : e.shown, n);
    for (let i = from; i < to && i < e.charEls.length; i += 1) {
      e.charEls[i].classList.toggle('on', i < n);
    }
    e.bubble.classList.toggle('tw-done', n >= e.charEls.length && e.charEls.length > 0);
    e.shown = n;
  }

  function finishEntry(e) {
    for (let i = 0; i < e.charEls.length; i += 1) e.charEls[i].classList.add('on');
    e.bubble.classList.add('tw-done');
    e.shown = e.charEls.length;
  }

  function prune() {
    while (entries.length > KEEP) {
      const e = entries.shift();
      if (e.bubble && e.bubble.parentNode) e.bubble.remove();
    }
  }

  function clearAll() {
    for (const e of entries) { if (e.bubble && e.bubble.parentNode) e.bubble.remove(); }
    entries = [];
  }

  function topIdx() { return entries.length ? entries[entries.length - 1].idx : -1; }

  // 整段重建：倒帶／大跳轉／換靠邊模式／文字被改（簡繁切換）時用；只鋪目前句之前的 KEEP 顆。
  function rebuild(lines, idx, kernel, t) {
    clearAll();
    const lo = Math.max(0, idx - (KEEP - 1));
    for (let i = lo; i <= idx; i += 1) {
      const e = buildBubble(lines[i], lines, i, kernel, true);
      entries.push(e);
      if (i < idx) finishEntry(e);
    }
    if (entries.length) paintEntry(entries[entries.length - 1], t);
  }

  function render(ctx, t, force) {
    if (!rootEl) return;
    lastT = t;
    const lines = visibleLines(ctx);
    if (!lines.length) { clearAll(); return; }
    const idx = lineIndexAt(lines, t);
    if (idx < 0) { clearAll(); return; }
    const kernel = ctx && ctx.kernel;

    const mode = computeLayout(lines);
    if (mode !== sideMode) { sideMode = mode; runCache = []; force = true; }
    if (dirty) { dirty = false; force = true; }
    if (!force && entries.length) {
      const match = entries.find((e) => e.idx === idx);
      if (match && lines[idx] && match.text !== lines[idx].text) force = true;
    }

    if (force || idx < topIdx()) { rebuild(lines, idx, kernel, t); return; }

    let cur = topIdx();
    while (cur < idx) {
      cur += 1;
      // 換句：剛才那顆泡泡就地定案（整句打完、收游標），不再逐幀重繪
      if (entries.length) finishEntry(entries[entries.length - 1]);
      entries.push(buildBubble(lines[cur], lines, cur, kernel, cur !== idx));
    }
    prune();
    if (entries.length) paintEntry(entries[entries.length - 1], t);
  }

  LyricTemplates.register({
    id: 'typewriter',
    label: '打字機',

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'typewriter-root';
      container.appendChild(rootEl);
      entries = [];
      runCache = [];
      sideMode = 'split';
      duetMap = null;
      dirty = false;
    },

    destroy() {
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null;
      entries = [];
      runCache = [];
      duetMap = null;
      dirty = false;
    },

    onLyricsLoaded() {
      clearAll();
      runCache = [];
      sideMode = 'split';
      duetMap = null;
      dirty = false;
    },

    onSettings(_settings, ctx) {
      dirty = true;
      if (ctx) render(ctx, lastT, true); // 暫停時也讓「換靠邊 / 換色」立即反映
    },
    onSeek(timeMs, ctx) { render(ctx, timeMs, true); },
    onFrame(timeMs, ctx) { render(ctx, timeMs, false); },
  });
})();
