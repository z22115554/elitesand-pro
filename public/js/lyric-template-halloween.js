/**
 * Elitesand Pro 排版模板：萬聖燭光（Halloween Candlelight）
 *
 * 沒唱到的字像刻在南瓜上、還沒點燈的暗字；唱到的字從裡面亮起燭光，偶爾迸出一顆往上飄的
 * 火星。唱完的句子像煙一樣往上散掉，長間奏時一隻小幽靈飄出來陪著等。
 *
 * 完全時間驅動：onFrame／onSeek 只吃 adjustedTimeMs 自算目前句與已唱字數，倒帶／大跳轉
 * 天然正確。逐幀成本＝二分搜尋目前句＋只處理「這一幀新亮的字」；換句才重建 DOM。
 * 動畫只用 opacity／transform（火星與退場），閃爍是整句一個 CSS 動畫，不是每個字各一個。
 *
 * 美術素材插槽：public/assets/halloween/lyric-ghost.webp（間奏小幽靈），沒有就用 CSS 畫的版本。
 */
(function () {
  if (typeof LyricTemplates === 'undefined') return;

  const INTERLUDE_MIN_GAP_MS = 4500;  // 兩句之間空這麼久才算長間奏
  const INTERLUDE_ENTER_MS = 900;     // 句尾過了這麼久才讓小幽靈飄出來
  const MAX_EMBERS = 18;
  const EMBER_CHANCE = 0.45;
  const LEAVE_MS = 900;

  let rootEl = null, stageEl = null, ghostEl = null;
  let state = null;
  let embers = 0;

  function flag(key, fallback) {
    const v = document.body.dataset[key];
    return v === undefined ? fallback : v === '1';
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

  // 沒有逐字時間的句子：用字數估這句唱多久，最多到下一句開頭。
  // 不直接攤平到下一句（kernel 的做法），否則長間奏前那句會一路慢慢亮到下一句才亮完，
  // 小幽靈出來時字還沒唱完。
  function estimatedEnd(lines, i) {
    const L = lines[i];
    if (typeof L.endTime === 'number' && L.endTime > L.time) return L.endTime;
    if (typeof L.duration === 'number' && L.duration > 0) return L.time + L.duration;
    const chars = Array.from(String(L.text || '')).length || 1;
    const est = L.time + Math.max(700, chars * 300);
    const next = lines[i + 1];
    return next && next.time > L.time ? Math.min(next.time, est) : est;
  }

  // 每個字開始亮的時間＋整句唱完的時間：有真的逐字時間（line.words）就照 kernel 算，
  // 沒有就在估出來的句長內平分。
  function lineTimings(line, lines, idx, kernel) {
    const cs = Array.from(String(line.text || ''));
    if (Array.isArray(line.words) && line.words.length && kernel && typeof kernel.ensureWordTimings === 'function'
      && typeof kernel.buildGraphemeTimings === 'function') {
      const starts = [];
      let end = line.time;
      try {
        for (const w of kernel.ensureWordTimings(line, lines, idx)) {
          for (const g of kernel.buildGraphemeTimings(w)) {
            starts.push(Number(g.startMs) || line.time);
            end = Math.max(end, Number(g.endMs) || 0);
          }
        }
      } catch (_) { starts.length = 0; }
      if (starts.length === cs.length) return { starts, end };
    }
    const end = estimatedEnd(lines, idx);
    const per = (end - line.time) / Math.max(1, cs.length);
    return { starts: cs.map((_, i) => line.time + per * i), end };
  }

  function litCount(starts, t) {
    let n = 0;
    for (const s of starts) { if (t >= s) n++; else break; }
    return n;
  }

  function spawnEmber(span) {
    if (embers >= MAX_EMBERS || !stageEl || !flag('halloweenEmbers', true)) return;
    if (Math.random() > EMBER_CHANCE) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = span.getBoundingClientRect();
    const host = stageEl.getBoundingClientRect();
    const ember = document.createElement('i');
    ember.className = 'hw-ember';
    ember.style.left = `${box.left - host.left + box.width * (0.3 + Math.random() * 0.4)}px`;
    ember.style.top = `${box.top - host.top + box.height * 0.25}px`;
    stageEl.appendChild(ember);
    embers += 1;
    const dx = (Math.random() - 0.5) * 30;
    const rise = 50 + Math.random() * 50;
    ember.animate(
      [
        { transform: 'translate(-50%, 0) scale(1)', opacity: 0.95 },
        { transform: `translate(calc(-50% + ${dx}px), ${-rise}px) scale(0.3)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' },
    ).onfinish = () => { ember.remove(); embers -= 1; };
  }

  // 舊句往上散成煙；最多留兩句在退場，避免快歌堆一大疊。
  function retire(lineEl, instant) {
    if (!lineEl) return;
    if (instant) { lineEl.remove(); return; }
    lineEl.classList.add('is-leaving');
    lineEl.style.animationDuration = `${LEAVE_MS}ms`;
    setTimeout(() => lineEl.remove(), LEAVE_MS + 50);
    const leaving = stageEl.querySelectorAll('.hw-line.is-leaving');
    for (let i = 0; i < leaving.length - 2; i += 1) leaving[i].remove();
  }

  function buildLine(line, lines, idx, ctx, instant) {
    retire(state.lineEl, instant);
    const el = document.createElement('div');
    el.className = 'hw-line' + (instant ? '' : ' is-entering');
    el.classList.toggle('is-flicker', flag('halloweenFlicker', true));
    const spans = [];
    Array.from(String(line.text || '')).forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'hw-ch';
      s.textContent = ch === ' ' ? ' ' : ch;
      if (!instant) s.style.animationDelay = `${Math.min(i * 22, 400)}ms`;
      el.appendChild(s);
      spans.push(s);
    });
    stageEl.appendChild(el);
    state.li = idx;
    state.lineEl = el;
    state.spans = spans;
    const timing = lineTimings(line, lines, idx, ctx && ctx.kernel);
    state.starts = timing.starts;
    state.end = timing.end;
    state.lit = 0;
  }

  function paint(t, instant) {
    const target = litCount(state.starts, t);
    if (target === state.lit) return;
    if (target < state.lit) {
      for (let i = target; i < state.lit; i += 1) state.spans[i].classList.remove('is-lit');
    } else {
      for (let i = state.lit; i < target; i += 1) {
        state.spans[i].classList.add('is-lit');
        if (!instant) spawnEmber(state.spans[i]);
      }
    }
    state.lit = target;
  }

  function setGhost(show) {
    if (!ghostEl) return;
    const want = show && flag('halloweenInterlude', true);
    if (ghostEl.classList.contains('is-shown') !== want) ghostEl.classList.toggle('is-shown', want);
  }

  function render(ctx, t, force) {
    if (!state) return;
    const lines = visibleLines(ctx);
    if (!lines.length) {
      if (state.lineEl) { retire(state.lineEl, true); state.lineEl = null; state.li = -1; }
      setGhost(false);
      return;
    }
    const idx = lineIndexAt(lines, t);
    const fast = force || (ctx && typeof ctx.isFastMode === 'function' && ctx.isFastMode());

    if (idx < 0) {
      if (state.lineEl) { retire(state.lineEl, fast); state.lineEl = null; state.li = -1; }
    } else if (force || idx !== state.li) {
      buildLine(lines[idx], lines, idx, ctx, fast);
    }

    // 長間奏（含第一句之前）：目前句唱完一陣子、下一句還很遠 → 小幽靈飄出來，目前句淡下去。
    const next = lines[idx + 1];
    const gapStart = idx >= 0 ? state.end : 0;
    const resting = !!next && next.time - gapStart >= INTERLUDE_MIN_GAP_MS
      && t >= gapStart + (idx >= 0 ? INTERLUDE_ENTER_MS : 0);
    setGhost(resting);

    if (idx < 0) return;
    if (state.lineEl) state.lineEl.classList.toggle('is-resting', resting);
    paint(t, fast);
  }

  LyricTemplates.register({
    id: 'halloween',
    label: '萬聖燭光',

    settings: [
      { key: 'halloweenPosition', type: 'enum', values: ['bottom', 'middle', 'top'], default: 'bottom', target: 'data:halloweenPosition' },
      { key: 'halloweenFlicker', type: 'bool01', default: true, target: 'data:halloweenFlicker' },
      { key: 'halloweenEmbers', type: 'bool01', default: true, target: 'data:halloweenEmbers' },
      { key: 'halloweenInterlude', type: 'bool01', default: true, target: 'data:halloweenInterlude' },
    ],

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'halloween-root';
      rootEl.innerHTML = '<div class="hw-stage"></div><div class="hw-ghost" aria-hidden="true"><i></i></div>';
      container.appendChild(rootEl);
      stageEl = rootEl.querySelector('.hw-stage');
      ghostEl = rootEl.querySelector('.hw-ghost');
      state = { li: -1, lineEl: null, spans: [], starts: [], end: 0, lit: 0 };
      embers = 0;
      if (window.HalloweenArt) window.HalloweenArt.probe('lyric-ghost');
    },

    destroy() {
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = stageEl = ghostEl = null;
      state = null;
      embers = 0;
    },

    onLyricsLoaded() {
      if (!state || !stageEl) return;
      stageEl.textContent = '';
      state.li = -1;
      state.lineEl = null;
      state.spans = [];
      state.end = 0;
      state.lit = 0;
      embers = 0;
      setGhost(false);
    },

    onSettings(_settings, ctx) {
      if (!state) return;
      if (state.lineEl) state.lineEl.classList.toggle('is-flicker', flag('halloweenFlicker', true));
      if (ctx && typeof ctx.getCurrentTimeMs === 'function') render(ctx, ctx.getCurrentTimeMs(), true);
    },

    onSeek(timeMs, ctx) { render(ctx, timeMs, true); },
    onFrame(timeMs, ctx) { render(ctx, timeMs, false); },
  });
})();
