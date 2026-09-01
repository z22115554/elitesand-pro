/**
 * Elitesand Pro 排版模板：Migiwa（極簡直排）
 *
 * 一句一側，直排釘在畫面外緣，下一句換到對側；同時只有一句（換句時短暫交疊）。
 * 逐字沿欄落定：淡入 + 可選 3px 微移，無 overshoot、無殘影、無裝飾——
 * 跟讀交給外緣那條進度軌，不靠字本身耍花招。中央永遠留給主播。
 *
 * 刻意的取捨：**一句只用一欄**。直排的換欄方向（vertical-rl 是由右往左）跟
 * 「左側那一句要往內換欄」天生衝突，硬做會讓左右兩側的閱讀順序不一致；
 * 所以長句改成整體縮字（有下限），寧可小一點也不要兩側行為不一樣。
 *
 * 完全時間驅動：onFrame／onSeek 只吃 adjustedTimeMs 自算，倒帶／大跳轉天然正確。
 * 只有換句才建立 DOM；其餘每幀只切已落字的差集 class 與一條軌的高度。
 */
(function () {
  if (typeof LyricTemplates === 'undefined') return;

  const GONE_MS = 460;           // 略大於 CSS 的淡出時間
  const MIN_SCALE = 0.55;        // 長句縮字下限；再長就讓它溢出也不要小到看不見

  let rootEl = null;
  let cur = null;                // { el, spans, times, shown, idx }
  let prev = null;
  let goneTimer = 0;

  function flag(key, fallback) {
    const v = document.body.dataset[key];
    return v === undefined ? fallback : v === '1';
  }
  function safeMargin() {
    const v = Math.round(Number(document.body.dataset.stageSafeMargin));
    return Number.isFinite(v) ? Math.max(2, Math.min(25, v)) : 11;
  }
  function visibleLines(ctx) {
    const list = ctx && typeof ctx.getLyrics === 'function' ? ctx.getLyrics() : [];
    return Array.isArray(list) ? list.filter((l) => l && typeof l.time === 'number' && l.text) : [];
  }
  function lineIndexAt(lines, t) {
    let lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  // 這一句「唱到什麼時候」。沒有明確 endTime/duration 時，用字數估（約 3.3 字/秒）而不是
  // 直接用下一句的開始——不然一句後面接七秒間奏，這句的字會被攤平在整段間奏上慢慢亮，
  // 而且間奏偵測也會失準（把還在唱的時間算成空檔）。
  function lineEnd(lines, i) {
    const L = lines[i];
    if (typeof L.endTime === 'number' && L.endTime > L.time) return L.endTime;
    if (typeof L.duration === 'number' && L.duration > 0) return L.time + L.duration;
    const chars = Array.from(String(L.text || '')).length || 1;
    const est = L.time + Math.max(700, chars * 300);
    const next = lines[i + 1];
    return next && next.time > L.time ? Math.min(next.time, est) : est;
  }
  function charTimes(line, lines, idx, kernel) {
    const cs = Array.from(String(line.text || ''));
    if (kernel && typeof kernel.ensureWordTimings === 'function') {
      const out = [];
      try {
        for (const w of kernel.ensureWordTimings(line, lines, idx)) {
          const gs = typeof kernel.buildGraphemeTimings === 'function'
            ? kernel.buildGraphemeTimings(w)
            : [{ char: w.text, startMs: w.startMs, endMs: w.endMs }];
          for (const g of gs) out.push({ t0: Number(g.startMs) || line.time, t1: Number(g.endMs) || line.time });
        }
      } catch (_) { out.length = 0; }
      if (out.length === cs.length) return out;
    }
    const start = line.time, end = lineEnd(lines, idx);
    const per = (end - start) / Math.max(1, cs.length);
    return cs.map((_, i) => ({ t0: start + per * i, t1: start + per * (i + 1) }));
  }
  function sungCount(times, t) { let n = 0; for (const c of times) { if (t >= c.t0) n++; else break; } return n; }
  function progress(times, t) {
    if (!times.length) return 0;
    if (t <= times[0].t0) return 0;
    if (t >= times[times.length - 1].t1) return 1;
    for (let i = 0; i < times.length; i += 1) {
      const c = times[i];
      if (t < c.t1) return (i + Math.max(0, (t - c.t0) / Math.max(1, c.t1 - c.t0))) / times.length;
    }
    return 1;
  }

  function retire(el) {
    if (!el) return;
    el.classList.add('is-gone');
    clearTimeout(goneTimer);
    goneTimer = setTimeout(() => { if (el && el.parentNode) el.remove(); }, GONE_MS);
  }

  function build(line, lines, idx, ctx) {
    if (prev && prev.parentNode) prev.remove();
    prev = cur ? cur.el : null;
    retire(prev);

    const side = idx % 2 === 0 ? 'right' : 'left';   // 一句一側，下一句換到對側
    const g = document.createElement('div');
    g.className = `mg-g mg-${side}`;
    g.style.setProperty('--mg-safe', safeMargin() + '%');

    const col = document.createElement('div');
    col.className = 'mg-col';
    const spans = [];
    for (const ch of Array.from(String(line.text || ''))) {
      const s = document.createElement('span');
      s.className = 'mg-ch';
      s.textContent = ch;
      col.appendChild(s);
      spans.push(s);
    }
    const rail = document.createElement('div');
    rail.className = 'mg-rail';
    const railFill = document.createElement('i');
    rail.appendChild(railFill);

    // 次要行（拼音）：外側一條細瘦欄，與主行同步；沒開拼音就完全不建。
    // 掛載順序＝外→內：次要行 → 進度軌 → 主行（靠右那側由 CSS 反轉 flex 方向）
    let sub = null;
    if (ctx && typeof ctx.showsRomaji === 'function' && ctx.showsRomaji() && line.phonetic) {
      sub = document.createElement('div');
      sub.className = 'mg-sub';
      sub.textContent = String(line.phonetic);
      g.appendChild(sub);
    }
    g.appendChild(rail);
    g.appendChild(col);
    g.classList.toggle('mg-shift', flag('migiwaShift', true));
    rootEl.appendChild(g);

    // 長句：一欄放不下就整體縮字（有下限），不換欄——見檔頭的取捨說明
    const maxH = rootEl.clientHeight * 0.62;
    const h = col.scrollHeight;
    if (h > maxH && maxH > 0) {
      g.style.setProperty('--mg-scale', Math.max(MIN_SCALE, maxH / h).toFixed(3));
    }

    cur = { el: g, spans, rail: railFill, times: charTimes(line, lines, idx, ctx && ctx.kernel), shown: -1, idx, sub };
  }

  function paint(t) {
    if (!cur) return;
    const n = sungCount(cur.times, t);
    if (n !== cur.shown) {
      const from = Math.min(cur.shown < 0 ? 0 : cur.shown, n);
      const to = Math.max(cur.shown < 0 ? cur.spans.length : cur.shown, n);
      for (let i = from; i < to && i < cur.spans.length; i += 1) cur.spans[i].classList.toggle('on', i < n);
      cur.shown = n;
    }
    cur.rail.style.height = (progress(cur.times, t) * 100).toFixed(2) + '%';
  }

  function render(ctx, t, force) {
    if (!rootEl) return;
    const lines = visibleLines(ctx);
    if (!lines.length) {
      if (cur && cur.el.parentNode) cur.el.remove();
      cur = null;
      return;
    }
    const idx = lineIndexAt(lines, t);
    if (idx < 0) {
      if (cur && cur.el.parentNode) { cur.el.remove(); cur = null; }
      return;
    }
    if (force || !cur || cur.idx !== idx) build(lines[idx], lines, idx, ctx);
    paint(t);
  }

  LyricTemplates.register({
    id: 'migiwa',
    label: 'Migiwa 直排',

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'migiwa-root';
      container.appendChild(rootEl);
      cur = null;
      prev = null;
    },

    destroy() {
      clearTimeout(goneTimer);
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null;
      cur = null;
      prev = null;
    },

    onLyricsLoaded() {
      clearTimeout(goneTimer);
      if (rootEl) rootEl.textContent = '';
      cur = null;
      prev = null;
    },

    onSettings(_settings, ctx) {
      if (ctx && typeof ctx.getCurrentTimeMs === 'function') render(ctx, ctx.getCurrentTimeMs(), true);
    },

    onSeek(timeMs, ctx) { render(ctx, timeMs, true); },
    onFrame(timeMs, ctx) { render(ctx, timeMs, false); },
  });
})();
