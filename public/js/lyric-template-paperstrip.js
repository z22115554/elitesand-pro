/**
 * Elitesand Pro 排版模板：紙帶逐字（Paper Strip）
 *
 * 視覺方向取自使用者提供的日系 PV 參考，但程式與版面規則皆為獨立實作：
 * - 新句開始前先讓白色紙帶由左往右展開
 * - 歌詞依原始逐字時間逐字浮現；只有目前字使用 activeColor
 * - 最近兩句保留成上下兩層紙帶：較舊句小、上一句大，形成 PV 式資訊層級
 * - 支援置中／偏左／偏右／左右分散；split 會依句序交替左右
 *
 * 完全時間驅動：onFrame/onSeek 都由 timeMs 重算，倒帶與大幅 seek 不依賴事件順序。
 */
(function () {
  'use strict';

  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined') {
    console.warn('[PaperStrip] 依賴未載入，模板停用');
    return;
  }

  const PRE_ROLL_MS = 520;
  const BAR_OPEN_MS = 400;
  const MIN_BAR_OPEN = 0.12;
  const EMPTY_TARGET = -999;

  let rootEl = null;
  let groupEl = null;
  let plans = [];
  let plansForLines = null;
  let targetIndex = EMPTY_TARGET;
  let liveGlyphEls = [];
  let liveRevealCount = -1;

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function smoothstep(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
  }

  function lineEndMs(lines, index) {
    const line = lines[index];
    if (!line) return 0;
    if (Number.isFinite(line.duration) && line.duration > 0) return line.time + line.duration;
    const next = lines[index + 1];
    return next ? next.time : line.time + 5000;
  }

  function buildPlan(lines, index) {
    const line = lines[index];
    if (!line || !line.text) return null;
    const words = LyricMotion.ensureWordTimings(line, lines, index);
    const glyphs = [];
    words.forEach((word) => {
      LyricMotion.buildGraphemeTimings(word).forEach((glyph) => glyphs.push(glyph));
    });
    return {
      index,
      text: line.text,
      startMs: Number.isFinite(line.time) ? line.time : 0,
      endMs: lineEndMs(lines, index),
      glyphs,
    };
  }

  function ensurePlans(lines) {
    if (plansForLines === lines) return plans;
    plans = lines.map((line, index) => buildPlan(lines, index)).filter(Boolean);
    plansForLines = lines;
    targetIndex = EMPTY_TARGET;
    liveRevealCount = -1;
    liveGlyphEls = [];
    if (groupEl) groupEl.replaceChildren();
    return plans;
  }

  function findStartedIndex(timeMs) {
    let lo = 0;
    let hi = plans.length - 1;
    let answer = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const plan = plans[mid];
      if (!plan || plan.startMs > timeMs) {
        hi = mid - 1;
      } else {
        answer = mid;
        lo = mid + 1;
      }
    }
    return answer;
  }

  function findTargetIndex(timeMs) {
    const started = findStartedIndex(timeMs);
    const next = started + 1;
    if (plans[next] && timeMs >= plans[next].startMs - PRE_ROLL_MS) return next;
    if (started >= 0) return started;
    if (plans[0] && timeMs >= plans[0].startMs - PRE_ROLL_MS) return 0;
    return -1;
  }

  function currentPlacement(index) {
    const value = document.body.dataset.lyricPos || 'center';
    if (value !== 'split') return 'center';
    return index % 2 === 0 ? 'left' : 'right';
  }

  function fitScale(text, role) {
    const length = Math.max(1, Array.from(text || '').length);
    const base = role === 'hero' ? 1.08 : (role === 'old' ? 0.52 : 0.48);
    const comfortable = role === 'hero' ? 11 : (role === 'old' ? 22 : 30);
    if (length <= comfortable) return base;
    const shrink = Math.pow(comfortable / length, 0.72);
    return Math.max(base * 0.52, base * shrink);
  }

  function makeRow(role, plan) {
    if (!plan) return null;
    const row = document.createElement('div');
    row.className = `ps-row ps-row--${role}`;
    row.style.setProperty('--ps-font-scale', fitScale(plan.text, role).toFixed(3));

    const plate = document.createElement('div');
    plate.className = 'ps-plate';
    const text = document.createElement('div');
    text.className = 'ps-text';
    plate.appendChild(text);
    row.appendChild(plate);

    if (role !== 'live') {
      row.style.setProperty('--ps-open', '1');
      text.textContent = plan.text;
      return row;
    }

    liveGlyphEls = [];
    plan.glyphs.forEach((glyph) => {
      const span = document.createElement('span');
      span.className = 'ps-glyph';
      span.textContent = glyph.char;
      text.appendChild(span);
      liveGlyphEls.push({ el: span, startMs: glyph.startMs, endMs: glyph.endMs });
    });
    liveRevealCount = -1;
    return row;
  }

  function renderTarget(index) {
    if (!groupEl) return;
    groupEl.replaceChildren();
    liveGlyphEls = [];
    liveRevealCount = -1;

    if (index < 0 || !plans[index]) {
      rootEl?.removeAttribute('data-side');
      return;
    }

    rootEl.dataset.side = currentPlacement(plans[index].index);
    const yNoise = LyricMotion.hashNoise(plans[index].index * 73 + 19, 11);
    groupEl.style.setProperty('--ps-y-shift', `${((yNoise - 0.5) * 10).toFixed(2)}vh`);

    const oldRow = makeRow('old', plans[index - 2]);
    const heroRow = makeRow('hero', plans[index - 1]);
    const liveRow = makeRow('live', plans[index]);
    if (oldRow) groupEl.appendChild(oldRow);
    if (heroRow) groupEl.appendChild(heroRow);
    if (liveRow) groupEl.appendChild(liveRow);
  }

  function applyLiveState(timeMs, plan) {
    if (!plan || !groupEl) return;
    const liveRow = groupEl.querySelector('.ps-row--live');
    if (!liveRow) return;

    const preStart = plan.startMs - PRE_ROLL_MS;
    const openRaw = smoothstep((timeMs - preStart) / BAR_OPEN_MS);
    const open = timeMs < preStart ? 0 : MIN_BAR_OPEN + (1 - MIN_BAR_OPEN) * openRaw;
    liveRow.style.setProperty('--ps-open', clamp01(open).toFixed(4));

    let revealCount = 0;
    for (let i = 0; i < liveGlyphEls.length; i += 1) {
      if (liveGlyphEls[i].startMs <= timeMs) revealCount = i + 1;
      else break;
    }
    if (revealCount === liveRevealCount) return;

    liveGlyphEls.forEach((glyph, index) => {
      glyph.el.classList.toggle('is-on', index < revealCount);
      glyph.el.classList.toggle('is-current', index === revealCount - 1);
    });
    liveRevealCount = revealCount;
  }

  function computeAndRender(timeMs, lines) {
    if (!rootEl || !groupEl) return;
    ensurePlans(lines);
    if (plans.length === 0) {
      if (targetIndex !== -1) {
        targetIndex = -1;
        renderTarget(-1);
      }
      return;
    }

    const nextTarget = findTargetIndex(timeMs);
    if (nextTarget !== targetIndex) {
      targetIndex = nextTarget;
      renderTarget(targetIndex);
    }
    if (targetIndex >= 0) {
      rootEl.dataset.side = currentPlacement(plans[targetIndex].index);
      applyLiveState(timeMs, plans[targetIndex]);
    }
  }

  LyricTemplates.register({
    id: 'paperstrip',
    label: '紙帶逐字',

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'paperstrip-root';
      groupEl = document.createElement('div');
      groupEl.className = 'ps-group';
      rootEl.appendChild(groupEl);
      container.appendChild(rootEl);
      plansForLines = null;
      targetIndex = EMPTY_TARGET;
      liveGlyphEls = [];
      liveRevealCount = -1;
    },

    destroy() {
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null;
      groupEl = null;
      plans = [];
      plansForLines = null;
      targetIndex = EMPTY_TARGET;
      liveGlyphEls = [];
      liveRevealCount = -1;
    },

    onLyricsLoaded() {
      plansForLines = null;
      targetIndex = EMPTY_TARGET;
      liveGlyphEls = [];
      liveRevealCount = -1;
      if (groupEl) groupEl.replaceChildren();
    },

    onSeek(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },

    onFrame(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },
  });
})();
