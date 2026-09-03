/**
 * Elitesand Pro 排版模板：詩頁（Stanza）
 *
 * 安靜地讀一頁詩。逐字上墨，字本身幾乎不移動——沒有推擠、沒有翻飛。
 * 唱過的墨乾成較淡的痕，還沒到的是灰的；正在唱的那一個字是筆尖所在。
 * migiwa（極簡直排）已併進來，成為 `stanzaOrient: 'vertical'`。
 *
 * 兩種排向：
 *  - horizontal（預設）：整段左貼，目前句固定在視窗某高度，換句時整條平滑捲一格。
 *    看得到上下文與下一句，跟唱門檻最低。逐字上墨＋讀字頭＋進度軌，全是光學變化。
 *  - vertical：四相漂字。整段切成「單邊 1–4 句」的批次（句數由 hashNoise(批次序) 決定），
 *    一批＝並排的幾條直欄、右→左貼畫面外緣（靠左／靠右／左右分散＝lyricPosition）。
 *    每個字輪流從左上／右上／左下／右下帶弧度漂入定點，0.40s ease-out；入場後完全靜止、
 *    直行排整齊不錯位。下一批上場時舊批整批模糊淡出。純文字，無進度軌／拼音欄／乾墨。
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

  // ── 直排＝四相漂字（drift）：每個字輪流從四角帶弧度漂入定點，入場後完全靜止 ──
  const easeOutCubic = (v) => 1 - Math.pow(1 - clamp(v, 0, 1), 3);
  const DRIFT = {
    DIRS: [[-1.25, -1.05], [1.15, -1.0], [-1.1, 1.1], [1.2, 0.95]], // 左上→右上→左下→右下，單位＝em
    CHAR_STEP_MS: 90,     // 逐字入場間隔
    CHAR_DUR_MS: 400,     // 每字漂入時長
    LEAD_MS: 260,         // 提前多少開始鋪這一批
    BATCH_MIN: 1,
    BATCH_SPAN: 4,        // 單邊 1..4 句（隨機由 hashNoise 決定，seek 一致）
    COL_GAP_EM: 1.55,     // 相鄰直欄間距
    COL_STAGGER_EM: 0.25, // 相鄰直欄輕微上下錯開
    CH_ADV_EM: 1.18,      // 直欄內字距（長欄縮放估算用）
    EDGE_PCT: 5,          // 貼邊留白（%）
    TOP_PCT: 19,          // 直欄頂端（視窗高度 %）
    MAX_H_PCT: 72,        // 超過就整欄縮小
    MIN_SCALE: 0.56,
    RETIRE_MS: 620,       // 舊批模糊淡出時長
  };
  const BATCH_SEED = 0x5715a3;

  // 漂入動畫強度（只作用在直排四相漂字）：吃 document.body.dataset.lyricIntensity。
  // dist＝起始漂移距離倍率、arc＝弧度倍率、blur＝入場模糊倍率、rot＝旋轉倍率、durMs＝每字漂入時長。
  const DRIFT_INTENSITY = {
    calm: { dist: 0.60, arc: 0.45, blur: 0.5, rot: 0.3, durMs: 340 },
    normal: { dist: 1.0, arc: 1.0, blur: 1.0, rot: 1.0, durMs: 400 },
    chaotic: { dist: 1.55, arc: 1.8, blur: 1.5, rot: 1.9, durMs: 470 },
  };
  function driftProfile() {
    return DRIFT_INTENSITY[document.body.dataset.lyricIntensity] || DRIFT_INTENSITY.normal;
  }

  let rootEl = null, ruleEl = null, winEl = null, bodyEl = null;
  let state = null;

  function orient() {
    return document.body.dataset.stanzaOrient === 'vertical' ? 'vertical' : 'horizontal';
  }
  function lyricPos() {
    const p = document.body.dataset.lyricPos;
    return (p === 'left' || p === 'right' || p === 'split') ? p : 'left';
  }
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
      winEl.querySelectorAll('.st-ln.st-v, .st-col, .st-deco').forEach((n) => n.remove());
    }
    if (state) {
      state.rows = [];
      state.driftCols = [];
      state.driftGlyphs = [];
      state.batches = null;
      state.batchCtx = null;
      state.mounted = {};
      state.decoEl = null;
      state.driftBatchIdx = -1;
      clearTimeout(state.driftRetireTm);
    }
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

  // ─────────────── 直排＝四相漂字（drift）───────────────
  //
  // 把整段歌詞切成「單邊 1–4 句」的批次（句數由 hashNoise(批次序) 決定，seek 一致）。
  // 一批＝並排的幾條直欄，右→左相鄰堆疊、貼畫面外緣（靠左／靠右／左右分散＝lyricPosition）。
  // 每個字輪流從左上／右上／左下／右下帶弧度漂入定點，0.40s ease-out；入場後完全靜止。
  // 下一批要上場時，舊批整批模糊淡出、往外緣飄一點。

  function cssNum(name, fallback) {
    const v = parseFloat(getComputedStyle(rootEl).getPropertyValue(name)
      || getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  }
  function fontPx() {
    const v = cssNum('--display-font-size', NaN);
    if (Number.isFinite(v) && v > 0) return v;
    const fs = parseFloat(getComputedStyle(rootEl).fontSize);
    return Number.isFinite(fs) && fs > 0 ? fs : 42;
  }
  function sideForBatch(b) {
    const p = lyricPos();
    if (p === 'left') return 'left';
    if (p === 'right') return 'right';
    return (b % 2 === 0) ? 'right' : 'left'; // split：偶數批靠右，之後換邊
  }
  // 切批次：回傳 [{firstIdx, count, startMs, side}]
  function driftBatches(lines) {
    const out = [];
    let i = 0, b = 0;
    while (i < lines.length) {
      const n = DRIFT.BATCH_MIN + Math.floor(hashNoise(BATCH_SEED, b) * DRIFT.BATCH_SPAN); // 1..4
      const count = Math.max(1, Math.min(n, lines.length - i));
      out.push({ firstIdx: i, count, startMs: lines[i].time, side: sideForBatch(b) });
      i += count;
      b += 1;
    }
    return out;
  }
  function activeBatchIndex(batches, t) {
    let ans = -1;
    for (let k = 0; k < batches.length; k += 1) {
      if (batches[k].startMs - DRIFT.LEAD_MS <= t) ans = k; else break;
    }
    return ans;
  }

  function retireDriftBatch() {
    if (!state.driftCols.length && !state.decoEl) return;
    const gone = state.driftCols.slice();
    const deco = state.decoEl;
    state.driftCols = [];
    state.driftGlyphs = [];
    state.mounted = {};
    state.decoEl = null;
    gone.forEach((c) => c.el.classList.add('is-out'));
    if (deco) deco.classList.add('is-out');
    clearTimeout(state.driftRetireTm);
    state.driftRetireTm = setTimeout(() => {
      gone.forEach((c) => { if (c.el.parentNode) c.el.remove(); });
      if (deco && deco.parentNode) deco.remove();
    }, DRIFT.RETIRE_MS);
  }

  // 只算版位（哪一側、每欄的 x／top），不建 DOM。欄子在各自的句時間到才 mount。
  // 邊距／欄距吃詳細設定：--lyric-padding-x（貼邊距離）、--lyric-padding-y（頂端上下移，基準 48）、
  // --lyric-max-width（40–100 → 欄距 0.75×–1.35× 的密度旋鈕）。
  function layoutBatch(batch) {
    const fs = fontPx();
    const rw = rootEl.clientWidth || 1280;
    const winH = winEl.clientHeight || rootEl.clientHeight || 720;
    const density = clamp((cssNum('--lyric-max-width', 90) - 40) / 60, 0, 1) * 0.6 + 0.75; // 0.75..1.35
    const gap = DRIFT.COL_GAP_EM * fs * density;
    const stagger = DRIFT.COL_STAGGER_EM * fs;
    const safe = lyricPos() === 'split' ? Math.max(0, safeMarginPct()) : 0;
    const edgePx = cssNum('--lyric-padding-x', (DRIFT.EDGE_PCT / 100) * rw) + (safe / 100) * rw;
    const topPx = (DRIFT.TOP_PCT / 100) * winH + (cssNum('--lyric-padding-y', 48) - 48);
    const cols = [];
    for (let k = 0; k < batch.count; k += 1) {
      cols.push({ edge: edgePx + k * gap, top: topPx + k * stagger });
    }
    return {
      side: batch.side, fs,
      maxH: (DRIFT.MAX_H_PCT / 100) * winH,
      cols,
      gi: 0, // 批次內字序，驅動四相輪替
    };
  }

  // 一句裝飾：貼在整批「螢幕外緣」那側的細髮絲欄線 + 頂端一小截起筆橫線。
  // 外緣＝第一（最靠邊）欄再往邊緣退 0.55em。
  function mountBatchDeco(bctx) {
    const d = document.createElement('div');
    d.className = 'st-deco st-deco-' + bctx.side;
    const outer = Math.max(bctx.fs * 0.4, (bctx.cols[0] ? bctx.cols[0].edge : bctx.fs) - bctx.fs * 0.55);
    if (bctx.side === 'right') d.style.right = outer + 'px';
    else d.style.left = outer + 'px';
    d.style.top = (bctx.cols[0] ? bctx.cols[0].top - bctx.fs * 0.55 : 0) + 'px';
    d.innerHTML = '<i class="st-deco-rule"></i><i class="st-deco-tick"></i>';
    winEl.appendChild(d);
    state.decoEl = d;
  }

  function mountDriftColumn(k, idx, lines, ctx) {
    const bctx = state.batchCtx;
    const line = lines[idx];
    const chars = Array.from(String(line.text || ''));
    const col = document.createElement('div');
    col.className = 'st-col st-col-' + bctx.side;
    const slot = bctx.cols[k];
    if (bctx.side === 'right') col.style.right = slot.edge + 'px';
    else col.style.left = slot.edge + 'px';
    col.style.top = slot.top + 'px';
    // 逐字時間：優先用逐字核心（跟橫排同一套），沒有就整句線性
    const times = charTimes(line, lines, idx, ctx && ctx.kernel);
    const prof = driftProfile();
    chars.forEach((ch, ci) => {
      const g = document.createElement('span');
      g.className = 'st-g';
      g.textContent = ch;
      col.appendChild(g);
      const dir = DRIFT.DIRS[bctx.gi % 4];
      bctx.gi += 1;
      const c = times[ci] || { t0: line.time };
      state.driftGlyphs.push({
        el: g,
        t0: Number(c.t0) || line.time,
        dx: dir[0] * bctx.fs * prof.dist,
        dy: dir[1] * bctx.fs * prof.dist,
        rot: (dir[0] > 0 ? -7 : 7) * (1 + (ci % 3) * 0.14) * prof.rot,
      });
    });
    winEl.appendChild(col);
    const h = col.scrollHeight || (chars.length * bctx.fs * DRIFT.CH_ADV_EM);
    if (h > bctx.maxH && bctx.maxH > 0) {
      col.style.setProperty('--sc', Math.max(DRIFT.MIN_SCALE, bctx.maxH / h).toFixed(3));
    }
    state.driftCols.push({ el: col });
  }

  function paintDrift(t) {
    const fs = fontPx();
    const prof = driftProfile();
    const dur = prof.durMs;
    for (let i = 0; i < state.driftGlyphs.length; i += 1) {
      const g = state.driftGlyphs[i];
      const age = t - g.t0;
      if (age < 0) { g.el.style.opacity = '0'; continue; }
      if (age <= dur) {
        const p = easeOutCubic(age / dur);
        const q = 1 - p;
        const arc = Math.sin(Math.PI * clamp(age / dur, 0, 1)) * 0.16 * prof.arc;
        const dx = g.dx * q - Math.sign(g.dy || 1) * arc * fs;
        const dy = g.dy * q + Math.sign(g.dx || 1) * arc * 0.75 * fs;
        g.el.style.opacity = (0.95 * clamp(age / 180, 0, 1)).toFixed(3);
        g.el.style.transform = 'translate3d(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0) scale('
          + (0.91 + 0.09 * p).toFixed(3) + ') rotate(' + (g.rot * q).toFixed(2) + 'deg)';
        g.el.style.filter = 'blur(' + (0.12 * q * fs * prof.blur).toFixed(2) + 'px)';
      } else if (g.el.style.opacity !== '0.95') {
        g.el.style.opacity = '0.95';
        g.el.style.transform = 'none';
        g.el.style.filter = 'none';
      }
    }
  }

  function renderDrift(ctx, t, lines, force) {
    if (force || !state.batches) {
      retireDriftBatch();
      state.batches = driftBatches(lines);
      state.driftBatchIdx = -1;
      state.batchCtx = null;
      state.mounted = {};
    }
    const bi = activeBatchIndex(state.batches, t);
    if (bi < 0) {
      if (state.driftBatchIdx !== -1) { retireDriftBatch(); state.driftBatchIdx = -1; }
      ruleEl.style.opacity = '0';
      return;
    }
    if (bi !== state.driftBatchIdx) {
      retireDriftBatch();
      state.driftBatchIdx = bi;
      state.batchCtx = layoutBatch(state.batches[bi]);
      state.mounted = {};
      mountBatchDeco(state.batchCtx);
    }
    // 逐句 mount：句時間到（提前 LEAD）才把那一欄放進來，字再依逐字時間漂入
    const b = state.batches[bi];
    for (let k = 0; k < b.count; k += 1) {
      if (state.mounted[k]) continue;
      const idx = b.firstIdx + k;
      if (t >= lines[idx].time - DRIFT.LEAD_MS) {
        mountDriftColumn(k, idx, lines, ctx);
        state.mounted[k] = true;
      }
    }
    paintDrift(t);
    ruleEl.style.opacity = '0';
  }

  function render(ctx, t, force) {
    if (!rootEl) return;
    const lines = visibleLines(ctx);
    const md = orient();
    if (md !== state.mode || lyricPos() !== state.pos) {
      state.mode = md; state.pos = lyricPos();
      state.li = -1; state.built = -1; state.cur = null;
      clearTimeout(state.retireTm);
      clearRows();
      if (bodyEl) bodyEl.style.transform = '';   // 清掉橫排留下的 translateY，否則直排欄會被它推位
      rootEl.classList.toggle('st-vertical', md === 'vertical');
      force = true;
    }
    if (!lines.length) { clearRows(); state.cur = null; state.li = -1; return; }
    if (md === 'vertical') { renderDrift(ctx, t, lines, force); return; }
    const idx = lineIndexAt(lines, t);
    if (idx < 0) { state.li = -1; return; }
    renderHorizontal(ctx, t, idx, lines, force);
  }

  LyricTemplates.register({
    id: 'stanza',
    label: '逐字詩箋',

    // 排向（橫排捲動／直排四相漂字）。
    // ⚠ 已知問題（沿用重構前行為）：直排的「中央安全距離」slider 目前無效——
    // 舊 display.js 會在非舞台系模板一律 delete body.dataset.stageSafeMargin，
    // 直排 safeMarginPct() 因此永遠吃自己的 fallback 12。若要修，改成把
    // ...LyricTemplateSettings.STAGE_SAFE 併進來即可，但那會改變直排版面，需真 OBS 驗證。
    settings: [
      { key: 'stanzaOrient', type: 'enum', values: ['horizontal', 'vertical'], default: 'horizontal', target: 'data:stanzaOrient' },
    ],

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'stanza-root';
      rootEl.innerHTML = '<div class="st-rule"><i></i></div>'
        + '<div class="st-win"><div class="st-body"></div></div>';
      container.appendChild(rootEl);
      ruleEl = rootEl.querySelector('.st-rule i');
      winEl = rootEl.querySelector('.st-win');
      bodyEl = rootEl.querySelector('.st-body');
      state = {
        rows: [], li: -1, mode: null, pos: null, built: -1, cur: null, retireTm: 0,
        batches: null, batchCtx: null, mounted: {}, decoEl: null,
        driftCols: [], driftGlyphs: [], driftBatchIdx: -1, driftRetireTm: 0,
      };
    },

    destroy() {
      if (state) { clearTimeout(state.retireTm); clearTimeout(state.driftRetireTm); }
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
