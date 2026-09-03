/**
 * Elitesand Pro 排版模板：燈牌（Lightboard）
 *
 * 一塊會發光的 LED 燈牌。唱過的燈亮、沒唱到的是熄滅的暗點——整句一直都看得見，
 * 「暗點也是資訊」，所以不需要另外做進場。機殼裝飾（螺絲、指示燈、走時讀數、
 * 壓克力反光、下緣銘牌）全是靜態結構，沒有任何一個會動的元素。
 *
 * 字型只給兩款真點陣字型（Cubic 11 內建、精品點陣體 9×9 需本機安裝），不吃一般字體：
 * 一般字體被圓點網遮罩切開後，筆畫之間的縫小於一個燈距就會糊成一團（14 畫的字尤其明顯）。
 * 點陣字型每個字都是手工排進格子的，永遠不糊。代價是字級必須是「設計格數」的整數倍
 * （Cubic 11 → 11、精品 → 9），否則像素會被壓成不等寬——見 snapSize()。
 *
 * 捲動（三段各自獨立，預設只開前兩個）：
 *  - 長句平移：整句塞不下時才平移，而且只平移到「剛好讓正在唱的字留在視窗內」。
 *    這不是裝飾是功能——字級是用最長的一句算的，一句長句會讓整首歌少 25% 字級。
 *  - 間奏跑馬：只在沒有人在唱的空檔跑曲名，讀數同時切成 INTERLUDE。
 *  - 進場滑入：動作只發生在換句的空檔；預設關（每句都動會累積成吵）。
 *
 * 完全時間驅動：onFrame／onSeek 只吃 adjustedTimeMs 自算，倒帶／大跳轉天然正確。
 * 逐幀成本：二分搜尋目前句 ＋ 單一活躍句的字元線性掃描；只有換句才重建 DOM。
 */
(function () {
  if (typeof LyricTemplates === 'undefined') return;

  const FONTS = {
    cubic11: { grid: 11, cls: 'lb-font-cubic11' },
    boutique9x9: { grid: 9, cls: 'lb-font-boutique9x9' },
  };
  const IDLE_MIN_GAP_MS = 2500;   // 間奏要夠長才跑馬，否則句間空檔會一直閃
  const IDLE_ENTER_MS = 900;      // 句尾過了這麼久才開始跑，避免尾音還沒收就切走
  const IDLE_SPEED_PX_MS = 0.11;
  const HEAD_RATIO = 0.42;        // 長句平移時，正在唱的字停在燈箱的這個位置

  let rootEl = null, boxEl = null, innerEl = null, slideEl = null;
  let textEl = null, idleEl = null, segEl = null, plateT = null, plateA = null;
  let state = null;
  // 間奏跑馬的位移用「真實時鐘(performance.now)」自行累加，不吃歌詞時間軸——
  // lyrics:sync 會週期性把歌詞時鐘重設到音訊回報位置，那個值會抖／偶爾倒退，
  // 直接拿它算 translateX 會變成「跑一下停一下」。真實時鐘單調遞增，跑馬才會勻速。
  let idlePhasePx = 0;
  let idleLastNow = 0;

  // 設定與曲目資訊都走 body.dataset（display.js 套設定時寫入），沿用 columnflow 那套慣例，
  // 不另外開一條 ctx 通道。逐幀讀 dataset 的成本可忽略。
  function flag(key, fallback) {
    const v = document.body.dataset[key];
    return v === undefined ? fallback : v === '1';
  }
  function fontKey() {
    const v = String(document.body.dataset.lightboardFont || 'cubic11');
    return FONTS[v] ? v : 'cubic11';
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

  // 逐字時間：有 kernel 就用真的逐字，沒有就整句線性平分
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
  // 連續進度（字內插值）：平移要平滑，用整數字數會一格一格跳
  function progress(times, t) {
    if (!times.length) return 0;
    if (t <= times[0].t0) return 0;
    for (let i = 0; i < times.length; i += 1) {
      const c = times[i];
      if (t < c.t1) return i + Math.max(0, Math.min(1, (t - c.t0) / Math.max(1, c.t1 - c.t0)));
    }
    return times.length;
  }

  /**
   * 字級：吃面板設定的字級當目標，吸附到「設計格數的整數倍」。
   * 用四捨五入不是無條件捨去——差 1px 就掉一整階（44→33 少 25%）。
   * 燈箱與所有機殼細節都是 em，所以字級一決定，整台機器就跟著等比縮放。
   */
  function snapSize(px, grid) {
    return Math.max(3, Math.round(px / grid)) * grid;
  }

  function fit(ctx) {
    if (!state || !innerEl) return false;
    const grid = FONTS[fontKey()].grid;
    const want = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--display-font-size')) || 42;
    const size = snapSize(want, grid);
    // 字級掛在機殼上、機殼所有尺寸都是 em ⇒ 調字級＝整台機器等比縮放（框跟著字級走）
    boxEl.style.fontSize = size + 'px';
    state.grid = grid;
    state.size = size;
    rootEl.style.setProperty('--lb-pitch', (size / grid) + 'px'); // 燈泡陣列的點距＝字型一個像素
    state.fitted = true;
    state.li = -1;
    return true;
  }

  function applyFontClass() {
    const fk = fontKey();
    for (const k of Object.keys(FONTS)) boxEl.classList.toggle(FONTS[k].cls, k === fk);
    return fk;
  }

  function buildLine(line, lines, idx, ctx) {
    textEl.textContent = '';
    const spans = [];
    for (const ch of Array.from(String(line.text || ''))) {
      const s = document.createElement('span');
      s.className = 'lb-ch';
      s.textContent = ch;
      textEl.appendChild(s);
      spans.push(s);
    }
    state.spans = spans;
    state.times = charTimes(line, lines, idx, ctx && ctx.kernel);
    state.shown = -1;
    state.textW = textEl.getBoundingClientRect().width;

    const boxW = innerEl.clientWidth;
    state.pan = flag('lightboardPan', true) && state.textW > boxW;
    innerEl.classList.toggle('is-pan', state.pan);
    textEl.style.transform = '';
    state.charX = state.pan ? spans.map((el) => el.offsetLeft + el.offsetWidth / 2) : [];

    if (flag('lightboardSlide', false)) {
      slideEl.classList.remove('lb-enter');
      void slideEl.offsetWidth;                 // 強制 reflow 才能重新觸發同一個動畫
      slideEl.classList.add('lb-enter');
    } else {
      slideEl.classList.remove('lb-enter');
    }
    // 燈點相位對齊文字左緣，字的像素才會落在燈格上，而不是兩層格子互相干涉
    if (state.size && state.grid) {
      const pitch = state.size / state.grid;
      const dx = textEl.getBoundingClientRect().left - innerEl.getBoundingClientRect().left;
      rootEl.style.setProperty('--lb-phase', (((dx % pitch) + pitch) % pitch).toFixed(2) + 'px');
    }
  }

  function paint(t) {
    const n = sungCount(state.times, t);
    if (n !== state.shown) {
      const from = Math.min(state.shown < 0 ? 0 : state.shown, n);
      const to = Math.max(state.shown < 0 ? state.spans.length : state.shown, n);
      for (let i = from; i < to && i < state.spans.length; i += 1) state.spans[i].classList.toggle('on', i < n);
      state.shown = n;
    }
    if (state.pan && state.charX.length) {
      const boxW = innerEl.clientWidth;
      const p = Math.max(0, Math.min(state.charX.length - 1, progress(state.times, t)));
      const i0 = Math.floor(p), i1 = Math.min(state.charX.length - 1, i0 + 1);
      const head = state.charX[i0] + (state.charX[i1] - state.charX[i0]) * (p - i0);
      const off = Math.max(0, Math.min(state.textW - boxW, head - boxW * HEAD_RATIO));
      textEl.style.transform = 'translateX(' + (-off).toFixed(1) + 'px)';
    }
  }

  function songLabel() {
    return {
      title: document.body.dataset.lbTitle || '',
      artist: document.body.dataset.lbArtist || '',
    };
  }

  function timecode(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function syncPlate() {
    if (!plateT) return;
    const song = songLabel();
    plateT.textContent = song.title || '';
    plateA.textContent = song.artist || '';
    boxEl.classList.toggle('lb-no-plate', !song.title && !song.artist);
  }

  function render(ctx, t, force) {
    if (!rootEl) return;
    const lines = visibleLines(ctx);
    if (!lines.length) {
      textEl.textContent = ''; state.spans = []; state.li = -1;
      idleEl.hidden = true; slideEl.style.visibility = '';
      segEl.textContent = '';
      idlePhasePx = 0; idleLastNow = 0;
      return;
    }
    if (!state.fitted || force) { applyFontClass(); fit(ctx); }

    const idx = lineIndexAt(lines, t);
    if (idx < 0) { segEl.textContent = timecode(t); return; }
    const L = lines[idx];
    const end = lineEnd(lines, idx);

    // 間奏跑馬：只在沒有人在唱的空檔跑
    const nextT = lines[idx + 1] ? lines[idx + 1].time : Infinity;
    const inGap = t > end + IDLE_ENTER_MS && (nextT - end) > IDLE_MIN_GAP_MS;
    if (flag('lightboardIdle', true) && inGap) {
      const song = songLabel();
      const label = song.title
        ? '♪ ' + song.title + (song.artist ? ' · ' + song.artist : '') + ' ♪'
        : '';
      if (label) {
        if (idleEl.hidden || idleEl.dataset.label !== label) {
          idleEl.hidden = false; idleEl.dataset.label = label; idleEl.textContent = label;
          slideEl.style.visibility = 'hidden';
          idlePhasePx = 0; idleLastNow = 0;         // 這段跑馬重新開始，位移歸零
        }
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (!idleLastNow) idleLastNow = now;
        // dt 夾在 100ms 內：OBS 背景節流 rAF 後追幀時不要讓跑馬瞬間跳一大段
        const dt = Math.min(100, Math.max(0, now - idleLastNow));
        idleLastNow = now;
        idlePhasePx += dt * IDLE_SPEED_PX_MS;
        const boxW = innerEl.clientWidth;
        const w = idleEl.scrollWidth || idleEl.getBoundingClientRect().width;
        const span = boxW + w;
        const x = boxW - ((idlePhasePx % span) + span) % span;
        idleEl.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
        segEl.textContent = 'INTERLUDE';
        return;
      }
    }
    if (!idleEl.hidden) { idleEl.hidden = true; slideEl.style.visibility = ''; idleLastNow = 0; }

    if (force || idx !== state.li) { state.li = idx; buildLine(L, lines, idx, ctx); }
    paint(t);
    segEl.textContent = timecode(t);
  }

  LyricTemplates.register({
    id: 'lightboard',
    label: '跑馬燈牌',

    // 專屬設定：面板 key → body.dataset（模板端 flag()/fontKey() 逐幀讀）。
    // 注意 lightboardIdleMarquee 這個面板 key 對應的 dataset 名是 lightboardIdle。
    settings: [
      { key: 'lightboardFont', type: 'enum', values: ['cubic11', 'boutique9x9'], default: 'cubic11', target: 'data:lightboardFont' },
      { key: 'lightboardPan', type: 'bool01', default: true, target: 'data:lightboardPan' },
      { key: 'lightboardIdleMarquee', type: 'bool01', default: true, target: 'data:lightboardIdle' },
      { key: 'lightboardSlideIn', type: 'bool01', default: false, target: 'data:lightboardSlide' },
    ],

    mount(container, ctx) {
      rootEl = document.createElement('div');
      rootEl.id = 'lightboard-root';
      rootEl.innerHTML =
        '<div class="lb-box">'
        + '<i class="lb-screw tl"></i><i class="lb-screw tr"></i>'
        + '<i class="lb-screw bl"></i><i class="lb-screw br"></i>'
        + '<div class="lb-top">'
        + '<div class="lb-ind"><i class="pwr"></i><i class="act"></i></div>'
        + '<div class="lb-label">NOW PLAYING</div>'
        + '<div class="lb-seg"></div>'
        + '</div>'
        + '<div class="lb-inner">'
        + '<div class="lb-grid"></div>'
        + '<div class="lb-slide"><div class="lb-text"></div></div>'
        + '<div class="lb-idle" hidden></div>'
        + '<div class="lb-scan"></div>'
        + '</div>'
        + '<div class="lb-glass"></div>'
        + '<div class="lb-plate"><span class="t"></span><span class="a"></span></div>'
        + '</div>';
      container.appendChild(rootEl);
      boxEl = rootEl.querySelector('.lb-box');
      innerEl = rootEl.querySelector('.lb-inner');
      slideEl = rootEl.querySelector('.lb-slide');
      textEl = rootEl.querySelector('.lb-text');
      idleEl = rootEl.querySelector('.lb-idle');
      segEl = rootEl.querySelector('.lb-seg');
      plateT = rootEl.querySelector('.lb-plate .t');
      plateA = rootEl.querySelector('.lb-plate .a');
      state = {
        fitted: false, li: -1, spans: [], times: [], charX: [],
        shown: -1, textW: 0, pan: false, size: 0, grid: 11,
      };
      applyFontClass();
      syncPlate();
    },

    destroy() {
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = boxEl = innerEl = slideEl = textEl = idleEl = segEl = plateT = plateA = null;
      state = null;
    },

    onLyricsLoaded(_lines, ctx) {
      if (!state) return;
      state.fitted = false;
      state.li = -1;
      // 歌曲播完／清空歌詞時 onFrame 不會再被呼叫——直接把燈板點熄，別讓最後一句留著
      if (textEl) { textEl.textContent = ''; textEl.style.transform = ''; }
      state.spans = [];
      if (idleEl) idleEl.hidden = true;
      if (slideEl) slideEl.style.visibility = '';
      if (segEl) segEl.textContent = '';
      idlePhasePx = 0; idleLastNow = 0;
      syncPlate();
    },

    onSettings(_settings, ctx) {
      if (!state) return;
      state.fitted = false;                     // 字級／字型可能變了，重算
      syncPlate();
      if (ctx && typeof ctx.getCurrentTimeMs === 'function') render(ctx, ctx.getCurrentTimeMs(), true);
    },

    onSeek(timeMs, ctx) { render(ctx, timeMs, true); },
    onFrame(timeMs, ctx) { render(ctx, timeMs, false); },
  });
})();
