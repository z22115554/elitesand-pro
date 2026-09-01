/**
 * Elitesand Pro 排版模板：詩頁（Stanza）
 *
 * 整段歌詞一次排好貼在畫面一側，**字本身從不移動**——沒有推擠、沒有淡入、沒有重排。
 * 唱到哪句哪句上墨，唱過的留較淡的墨，還沒到的是灰的。觀眾看得到下一句，跟唱門檻最低。
 *
 * 逐字靠三件事，全部是光學變化：
 *  1. 三段墨色（未到 / 目前句未唱 / 已唱）
 *  2. 讀字頭——正在唱的那一個字最亮、暈開一圈
 *  3. 句底連續進度軌（吃字內插值，不是整數字數，所以是平滑推進）
 * 進度軌是絕對定位，翻譯行永遠佔位，所以切換時版面不會跳。
 *
 * 兩種推進方式（stanzaMode）：
 *  - scroll（預設）：所有句子排成一長條，目前句永遠停在同一高度，換句時整條走一格。
 *    不必判斷段落邊界——LRC/KRC 沒有可靠的段落標記，硬切「每 N 句」會把副歌腰斬。
 *  - page：一次只掛一段，段落唱完整塊淡出換頁。段內完全靜止，但換頁有明顯斷點。
 *
 * 完全時間驅動；只有換句才動 class 與位移，不重建 DOM（捲動模式整首只建一次）。
 */
(function () {
  if (typeof LyricTemplates === 'undefined') return;

  const PAGE_LINES = 4;          // page 模式一頁幾句
  const PAGE_FADE_MS = 340;
  const ANCHOR = 0.34;           // scroll 模式：目前句停在視窗的這個高度

  let rootEl = null, ruleEl = null, winEl = null, bodyEl = null;
  let state = null;

  function mode() {
    return document.body.dataset.stanzaMode === 'page' ? 'page' : 'scroll';
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
  function sungCount(times, t) { let n = 0; for (const c of times) { if (t >= c.t1) n++; else break; } return n; }
  function nowIndex(times, t) { return times.findIndex((c) => t >= c.t0 && t < c.t1); }
  // 連續進度：進度軌要平滑，用整數字數會一格一格跳
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

  function buildRow(line, lines, idx, ctx) {
    const ln = document.createElement('div');
    ln.className = 'st-ln';
    const main = document.createElement('div');
    main.className = 'st-main';
    const spans = [];
    for (const ch of Array.from(String(line.text || ''))) {
      const s = document.createElement('span');
      s.className = 'st-ch';
      s.textContent = ch;
      main.appendChild(s);
      spans.push(s);
    }
    const rail = document.createElement('div');
    rail.className = 'st-rail';
    main.appendChild(rail);
    const tr = document.createElement('div');
    tr.className = 'st-tr';
    // 翻譯行永遠佔位（就算沒有翻譯），切換時版面才不會跳
    tr.textContent = (ctx && ctx.showsRomaji && ctx.showsRomaji() && line.phonetic) ? line.phonetic : '';
    ln.appendChild(main);
    ln.appendChild(tr);
    return { ln, spans, rail, idx, times: charTimes(line, lines, idx, ctx && ctx.kernel), shown: -1, now: -2 };
  }

  function clearRows() {
    bodyEl.textContent = '';
    state.rows = [];
  }

  function paintRow(r, t, isCur) {
    if (!isCur) {
      if (r.shown !== 0) {
        r.spans.forEach((s) => { s.classList.remove('on'); s.classList.remove('now'); });
        r.shown = 0; r.now = -2;
      }
      return;
    }
    const n = sungCount(r.times, t);
    if (n !== r.shown) {
      for (let i = 0; i < r.spans.length; i += 1) r.spans[i].classList.toggle('on', i < n);
      r.shown = n;
    }
    const nw = nowIndex(r.times, t);
    if (nw !== r.now) {
      if (r.now >= 0 && r.spans[r.now]) r.spans[r.now].classList.remove('now');
      if (nw >= 0 && r.spans[nw]) r.spans[nw].classList.add('now');
      r.now = nw;
    }
    r.rail.style.width = (progress(r.times, t) * 100).toFixed(2) + '%';
  }

  function render(ctx, t, force) {
    if (!rootEl) return;
    const lines = visibleLines(ctx);
    if (!lines.length) { clearRows(); state.li = -1; state.page = -1; return; }
    const idx = lineIndexAt(lines, t);
    if (idx < 0) { return; }
    const md = mode();
    if (md !== state.mode) { state.mode = md; state.page = -1; state.li = -1; force = true; clearRows(); }

    if (md === 'scroll') {
      if (force || !state.rows.length || state.built !== lines.length) {
        clearRows();
        lines.forEach((L, i) => { const r = buildRow(L, lines, i, ctx); bodyEl.appendChild(r.ln); state.rows.push(r); });
        state.built = lines.length;
        bodyEl.style.opacity = '1';
      }
      const cur = state.rows[idx];
      if (cur) bodyEl.style.transform = `translateY(${(winEl.clientHeight * ANCHOR - cur.ln.offsetTop).toFixed(1)}px)`;
    } else {
      const page = Math.floor(idx / PAGE_LINES);
      if (force || page !== state.page) {
        const build = () => {
          clearRows();
          for (let i = page * PAGE_LINES; i < Math.min(lines.length, (page + 1) * PAGE_LINES); i += 1) {
            const r = buildRow(lines[i], lines, i, ctx);
            bodyEl.appendChild(r.ln);
            state.rows.push(r);
          }
          bodyEl.style.opacity = '1';
        };
        bodyEl.style.transform = 'none';
        if (state.page < 0 || force) { state.page = page; build(); }
        else {
          state.page = page;
          bodyEl.style.opacity = '0';                 // 整段換頁：這個模式唯一的動作
          clearTimeout(state.tm);
          state.tm = setTimeout(build, PAGE_FADE_MS);
        }
      }
    }
    if (!state.rows.length) return;

    state.li = idx;
    for (const r of state.rows) {
      r.ln.classList.toggle('cur', r.idx === idx);
      r.ln.classList.toggle('done', r.idx < idx);
      paintRow(r, t, r.idx === idx);
    }
    // 左側細軌標：位置算相對於 .st-root（不是 body——捲動模式的 body 會被位移）
    const cur = state.rows.find((r) => r.idx === idx);
    if (cur) {
      const b = cur.ln.getBoundingClientRect();
      const p = rootEl.getBoundingClientRect();
      ruleEl.style.top = (b.top - p.top + 2) + 'px';
      ruleEl.style.height = Math.max(0, b.height - 10) + 'px';
    }
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
      state = { rows: [], li: -1, page: -1, mode: null, built: -1, tm: 0 };
    },

    destroy() {
      if (state) clearTimeout(state.tm);
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = ruleEl = winEl = bodyEl = null;
      state = null;
    },

    onLyricsLoaded() {
      if (!state) return;
      clearTimeout(state.tm);
      clearRows();
      state.li = -1; state.page = -1; state.built = -1;
      bodyEl.style.transform = 'none';
    },

    onSettings(_settings, ctx) {
      if (!state || !ctx) return;
      if (typeof ctx.getCurrentTimeMs === 'function') render(ctx, ctx.getCurrentTimeMs(), true);
    },

    onSeek(timeMs, ctx) { render(ctx, timeMs, true); },
    onFrame(timeMs, ctx) { render(ctx, timeMs, false); },
  });
})();
