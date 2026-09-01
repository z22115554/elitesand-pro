/**
 * Elitesand Pro 排版模板：詩頁（Stanza）
 *
 * 安靜地讀一頁詩。逐字上墨，字本身幾乎不移動——沒有推擠、沒有翻飛。
 * 唱過的墨乾成較淡的痕，還沒到的是灰的；正在唱的那一個字是筆尖所在。
 * migiwa（極簡直排）已併進來，成為 `stanzaOrient: 'vertical'`。
 *
 * 兩種排向：
 *  - horizontal（預設）：整段左貼，目前句固定在視窗某高度，換句時整條平滑捲一格。
 *    看得到上下文與下一句，跟唱門檻最低。
 *  - vertical：一句一直欄，貼畫面外緣，中央留給主播；下一句可換到對側（stanzaAltSides）。
 *    同時只有一句（換句時舊欄短暫淡出）。長句整體縮欄，不換欄。
 *
 * 工藝（對齊 aura／mirror 的作法，而不是「能動就好」）：
 *  1. 逐字上墨是**連續狀態**：每個字持一個 ink∈[0,1]，每幀用 easeOutQuint 逼近目標，
 *     不是 class 硬切。ink 驅動 顏色濃度、極輕的墨暈、以及 1–3px 的落定位移。
 *  2. 每個字的落定距離、上墨微延遲、呼吸相位都由 hashNoise(行, 字) 決定 —— 同一行永遠
 *     同一組抖動，時間只改狀態不重排。整段字因此不會像試算表一樣同拍淡入。
 *  3. 靜止時目前句仍在**極輕的呼吸**（每字相位錯開的 sine，振幅 < 0.5px）。乾掉的句與
 *     未來的句不呼吸——它們是上下文，應該往後退。
 *  4. 筆尖（now 字）是很緊的高光，不是大光斑；它比墨領先一個字，緊接其後的一個字有
 *     極淡的預備墨，讓上墨有「即將寫到」的預期感。
 *
 * 完全時間驅動：onFrame／onSeek 只吃 adjustedTimeMs 自算；換句只切狀態，不重建 DOM
 * （橫排整首只建一次）。倒帶／大跳轉天然正確。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined') return;

  const { hashNoise, hashSpread, clamp } = LyricMotion;
  const easeOutQuint = (v) => 1 - Math.pow(1 - clamp(v, 0, 1), 5);
  const easeOutQuad = (v) => { const n = clamp(v, 0, 1); return n * (2 - n); };

  const INK_LERP = 0.24;         // 每幀 ink 逼近目標的比例（60fps 下約 90ms 落定）
  const SETTLE_MIN = 1.1;        // 上墨時的落定位移下限（px）
  const SETTLE_SPAN = 1.9;       // …上限＝MIN+SPAN
  const REVEAL_LEAD_MS = 40;     // 字在自己的時間窗前 40ms 就開始沁墨，收掉「硬切」感
  const ANTICIPATE = 0.14;       // 筆尖後一個字的預備墨
  const BREATHE_HZ = 1.15;
  const BREATHE_PX = 0.42;
  const DRY_MS = 900;            // 句唱完後墨「乾掉」的時間
  const V_MIN_SCALE = 0.56;      // 直排長句整體縮欄下限
  const V_RETIRE_MS = 460;

  let rootEl = null, ruleEl = null, winEl = null, bodyEl = null;
  let state = null;

  function orient() {
    return document.body.dataset.stanzaOrient === 'vertical' ? 'vertical' : 'horizontal';
  }
  function altSides() { return document.body.dataset.stanzaAltSides === '1'; }
  function safeMarginPct() {
    const v = Math.round(Number(document.body.dataset.stageSafeMargin));
    return Number.isFinite(v) ? Math.max(2, Math.min(25, v)) : 12;
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
  // 這一句「唱到什麼時候」。沒有明確 endTime／duration 時用字數估（約 3.3 字/秒），
  // 不是直接接下一句的開始——不然一句後面接一段間奏，字會被攤平在整段間奏上慢慢亮。
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
  function nowIndex(times, t) {
    for (let i = 0; i < times.length; i += 1) if (t >= times[i].t0 && t < times[i].t1) return i;
    return t >= (times[times.length - 1] || {}).t1 ? times.length : -1;
  }
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

  // ── 一個 row／column：主體 + 進度軌 + 翻譯行，字元逐字 ink ──
  function buildRow(line, lines, idx, ctx, vertical) {
    const ln = document.createElement('div');
    ln.className = 'st-ln';
    const main = document.createElement('div');
    main.className = 'st-main';
    const seed = (line.time | 0) || (idx * 9973);
    const chars = Array.from(String(line.text || ''));
    const cells = [];
    chars.forEach((ch, ci) => {
      const s = document.createElement('span');
      s.className = 'st-ch';
      s.textContent = ch;
      // 每個字自己的落定距離、上墨微延遲、呼吸相位——同一行永遠同一組
      const settle = SETTLE_MIN + hashNoise(seed, ci * 7 + 1) * SETTLE_SPAN;
      s.style.setProperty('--st-settle', settle.toFixed(2) + 'px');
      s.style.setProperty('--st-bph', (hashNoise(seed, ci * 7 + 3) * 6.283).toFixed(3));
      s.style.setProperty('--ink', '0');
      main.appendChild(s);
      cells.push({ el: s, ink: 0, offset: hashSpread(seed, ci * 7 + 5) * REVEAL_LEAD_MS });
    });
    const rail = document.createElement('div');
    rail.className = 'st-rail';
    main.appendChild(rail);
    const tr = document.createElement('div');
    tr.className = 'st-tr';
    tr.textContent = (ctx && ctx.showsRomaji && ctx.showsRomaji() && line.phonetic) ? String(line.phonetic) : '';

    if (vertical) {
      // 直排：進度軌從主欄拿出來、放進一個獨立的軌欄，才能貼在外緣。
      // DOM 外→內：翻譯欄 → 軌欄 → 主欄（靠右那側由 CSS 反轉 flex 方向）。
      main.removeChild(rail);
      const railWrap = document.createElement('div');
      railWrap.className = 'st-railwrap';
      railWrap.appendChild(rail);
      ln.appendChild(tr);
      ln.appendChild(railWrap);
      ln.appendChild(main);
    } else {
      ln.appendChild(main);
      ln.appendChild(tr);
    }
    return {
      ln, main, rail, tr, cells, idx,
      times: charTimes(line, lines, idx, ctx && ctx.kernel),
      lastNow: -2, doneAt: -1,
    };
  }

  function clearRows() {
    if (state && bodyEl) bodyEl.textContent = '';
    if (state && winEl) {
      winEl.querySelectorAll('.st-ln.st-v').forEach((n) => n.remove());
    }
    if (state) state.rows = [];
  }

  // ink 目標：字在自己的時間窗內從 0→1 沁滿；筆尖後一個字給一點預備墨
  function inkTarget(row, ci, t, nowI) {
    const c = row.times[ci];
    if (!c) return 0;
    if (t >= c.t1) return 1;
    if (t >= c.t0 - REVEAL_LEAD_MS + row.cells[ci].offset) {
      return easeOutQuint((t - c.t0) / Math.max(1, c.t1 - c.t0) + 0.12);
    }
    return ci === nowI + 1 ? ANTICIPATE : 0;
  }

  function paintRow(row, t, roleIsCur, timeSec) {
    const isDone = !roleIsCur && row.idx < state.li;
    const nowI = roleIsCur ? nowIndex(row.times, t) : -1;
    // 乾墨：句唱完後 DRY_MS 內把墨色從飽和退成「乾掉的痕」（easeOutQuad）
    if (isDone) {
      if (row.doneAt < 0) row.doneAt = t;
      row.ln.style.setProperty('--dry', easeOutQuad((t - row.doneAt) / DRY_MS).toFixed(3));
    } else if (row.doneAt >= 0) {
      row.doneAt = -1;
      row.ln.style.setProperty('--dry', '0');
    }
    for (let i = 0; i < row.cells.length; i += 1) {
      const cell = row.cells[i];
      const target = roleIsCur ? inkTarget(row, i, t, nowI)
        : (isDone ? 1 : 0);
      // 每幀逼近目標——上墨因此有重量，不是瞬間切
      cell.ink += (target - cell.ink) * INK_LERP;
      if (Math.abs(cell.ink - target) < 0.004) cell.ink = target;
      cell.el.style.setProperty('--ink', cell.ink.toFixed(3));
      // 呼吸只加在目前句（上下文的句子應該往後退、不動）。用 JS sine，背景分頁也不會凍。
      if (roleIsCur) {
        const ph = Number(cell.el.style.getPropertyValue('--st-bph')) || 0;
        const br = Math.sin(timeSec * BREATHE_HZ + ph) * BREATHE_PX * clamp(cell.ink * 1.4, 0, 1);
        cell.el.style.setProperty('--breathe', br.toFixed(3) + 'px');
      } else if (cell.el.style.getPropertyValue('--breathe') !== '') {
        cell.el.style.setProperty('--breathe', '0px');
      }
    }
    if (roleIsCur) {
      if (nowI !== row.lastNow) {
        if (row.lastNow >= 0 && row.cells[row.lastNow]) row.cells[row.lastNow].el.classList.remove('now');
        if (nowI >= 0 && row.cells[nowI]) row.cells[nowI].el.classList.add('now');
        row.lastNow = nowI;
      }
      row.rail.style.setProperty('--p', (progress(row.times, t) * 100).toFixed(2) + '%');
    } else if (row.lastNow >= 0) {
      if (row.cells[row.lastNow]) row.cells[row.lastNow].el.classList.remove('now');
      row.lastNow = -2;
    }
  }

  function renderHorizontal(ctx, t, idx, lines, force) {
    if (force || !state.rows.length || state.built !== lines.length) {
      clearRows();
      lines.forEach((L, i) => {
        const r = buildRow(L, lines, i, ctx, false);
        bodyEl.appendChild(r.ln);
        state.rows.push(r);
      });
      state.built = lines.length;
    }
    state.li = idx;
    const timeSec = t / 1000;
    const anchor = winEl.clientHeight * 0.34;
    for (const r of state.rows) {
      const role = r.idx === idx ? 'cur' : (r.idx < idx ? 'done' : 'future');
      r.ln.classList.toggle('cur', role === 'cur');
      r.ln.classList.toggle('done', role === 'done');
      r.ln.classList.toggle('future', role === 'future');
      paintRow(r, t, role === 'cur', timeSec);
    }
    const cur = state.rows[idx];
    if (cur) {
      bodyEl.style.transform = `translateY(${(anchor - cur.ln.offsetTop).toFixed(1)}px)`;
      const b = cur.ln.getBoundingClientRect();
      const p = rootEl.getBoundingClientRect();
      ruleEl.style.top = (b.top - p.top + 2) + 'px';
      ruleEl.style.height = Math.max(0, b.height - 10) + 'px';
      ruleEl.style.opacity = '1';
    } else {
      ruleEl.style.opacity = '0';
    }
  }

  function renderVertical(ctx, t, idx, lines, force) {
    const timeSec = t / 1000;
    if (force || !state.cur || state.cur.idx !== idx) {
      // 舊欄退場：淡出＋往外緣微飄
      if (state.cur) {
        const gone = state.cur.ln;
        gone.classList.add('is-gone');
        clearTimeout(state.retireTm);
        state.retireTm = setTimeout(() => { if (gone.parentNode) gone.remove(); }, V_RETIRE_MS);
      }
      const r = buildRow(lines[idx], lines, idx, ctx, true);
      const side = altSides() ? (idx % 2 === 0 ? 'right' : 'left') : 'right';
      r.ln.classList.add('st-v', 'st-v-' + side);
      r.ln.style.setProperty('--st-safe', safeMarginPct() + '%');
      // 直排欄貼畫面外緣：掛在滿高的 .st-win 上，不掛會被子項塌成 0 高的 .st-body（top:% 會解析成 0）
      winEl.appendChild(r.ln);
      state.cur = r;
      state.li = idx;
      // 長句整體縮欄（不換欄）
      const maxH = winEl.clientHeight * 0.66;
      const h = r.main.scrollHeight;
      if (h > maxH && maxH > 0) r.ln.style.setProperty('--st-vscale', Math.max(V_MIN_SCALE, maxH / h).toFixed(3));
    }
    if (state.cur) paintRow(state.cur, t, true, timeSec);
    ruleEl.style.opacity = '0';   // 直排不用左側細軌
  }

  function render(ctx, t, force) {
    if (!rootEl) return;
    const lines = visibleLines(ctx);
    const md = orient();
    if (md !== state.mode) {
      state.mode = md; state.li = -1; state.built = -1; state.cur = null;
      clearTimeout(state.retireTm);
      clearRows();
      if (bodyEl) bodyEl.style.transform = '';   // 清掉橫排留下的 translateY，否則直排欄會被它推位
      rootEl.classList.toggle('st-vertical', md === 'vertical');
      force = true;
    }
    if (!lines.length) { clearRows(); state.cur = null; state.li = -1; return; }
    const idx = lineIndexAt(lines, t);
    if (idx < 0) {
      if (md === 'vertical' && state.cur) { state.cur.ln.remove(); state.cur = null; }
      state.li = -1;
      return;
    }
    if (md === 'vertical') renderVertical(ctx, t, idx, lines, force);
    else renderHorizontal(ctx, t, idx, lines, force);
  }

  LyricTemplates.register({
    id: 'stanza',
    label: '詩頁',

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'stanza-root';
      rootEl.innerHTML = '<div class="st-rule"><i></i></div>'
        + '<div class="st-win"><div class="st-body"></div></div>';
      container.appendChild(rootEl);
      ruleEl = rootEl.querySelector('.st-rule i');
      winEl = rootEl.querySelector('.st-win');
      bodyEl = rootEl.querySelector('.st-body');
      state = { rows: [], li: -1, mode: null, built: -1, cur: null, retireTm: 0 };
    },

    destroy() {
      if (state) clearTimeout(state.retireTm);
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = ruleEl = winEl = bodyEl = null;
      state = null;
    },

    onLyricsLoaded() {
      if (!state) return;
      clearTimeout(state.retireTm);
      clearRows();
      state.li = -1; state.built = -1; state.cur = null;
      if (bodyEl) bodyEl.style.transform = 'none';
    },

    onSettings(_settings, ctx) {
      if (!state || !ctx) return;
      if (typeof ctx.getCurrentTimeMs === 'function') render(ctx, ctx.getCurrentTimeMs(), true);
    },

    onSeek(timeMs, ctx) { render(ctx, timeMs, true); },
    onFrame(timeMs, ctx) { render(ctx, timeMs, false); },
  });
})();
