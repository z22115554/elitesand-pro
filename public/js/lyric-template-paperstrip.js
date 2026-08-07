/**
 * Elitesand Pro 排版模板：紙帶逐字（Paper Strip）
 *
 * 視覺方向取自使用者提供的日系 PV 參考，但程式與版面規則皆為獨立實作：
 * - 新句開始前先讓白色紙帶由左往右展開
 * - 歌詞依原始逐字時間逐字浮現；只有目前字使用 activeColor
 * - 每三句固定為一頁；滿三句後整頁清空，不做逐句滾動保留
 * - 每句在進場前就決定小／中／大尺寸，顯示期間不再因新句加入而改尺寸
 * - 尺寸排列以「小大中 → 大小中 → 中大小」為主循環，混入少量穩定亂數，並避免長句拿到過大的尺寸
 * - 支援置中／偏左／偏右／左右分散；split 以三句一頁為單位交替左右
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
  const BATCH_SIZE = 3;
  const EMPTY_TARGET = -999;
  const PRIMARY_SIZE_PATTERNS = [
    ['small', 'large', 'medium'],
    ['large', 'small', 'medium'],
    ['medium', 'large', 'small'],
  ];
  const ALT_SIZE_PATTERNS = [
    ['small', 'medium', 'large'],
    ['large', 'medium', 'small'],
    ['medium', 'small', 'large'],
  ];

  let rootEl = null;
  let groupEl = null;
  let safeZoneGuide = null;
  let plans = [];
  let plansForLines = null;
  let renderedBatchStart = EMPTY_TARGET;
  let batchRows = [];

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

  function visibleLength(text) {
    return Math.max(1, Array.from(text || '').length);
  }

  function batchSeed(batchPlans, batchNumber) {
    let seed = (batchNumber + 1) * 911;
    batchPlans.forEach((plan, slot) => {
      Array.from(plan?.text || '').forEach((char, charIndex) => {
        seed += ((char.codePointAt(0) || 0) % 997) * (slot + 3) * (charIndex + 5);
      });
    });
    return seed;
  }

  function assignBatchSizes(allPlans) {
    for (let batchStart = 0; batchStart < allPlans.length; batchStart += BATCH_SIZE) {
      const batch = allPlans.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNumber = Math.floor(batchStart / BATCH_SIZE);
      const seed = batchSeed(batch, batchNumber);
      const useAlt = LyricMotion.hashNoise(seed, 41) > 0.78;
      const sourcePatterns = useAlt ? ALT_SIZE_PATTERNS : PRIMARY_SIZE_PATTERNS;
      const roles = sourcePatterns[batchNumber % sourcePatterns.length].slice(0, batch.length);

      // 長句若剛好抽到 large，跟同頁最短句交換尺寸。尺寸仍在進場前一次決定，不會播放途中跳動。
      const largeSlot = roles.indexOf('large');
      if (largeSlot >= 0 && batch[largeSlot]) {
        let shortestSlot = largeSlot;
        batch.forEach((plan, slot) => {
          if (visibleLength(plan.text) < visibleLength(batch[shortestSlot].text)) shortestSlot = slot;
        });
        const largeLength = visibleLength(batch[largeSlot].text);
        const shortestLength = visibleLength(batch[shortestSlot].text);
        if (largeLength >= 16 && shortestSlot !== largeSlot && shortestLength + 4 <= largeLength) {
          const temp = roles[largeSlot];
          roles[largeSlot] = roles[shortestSlot];
          roles[shortestSlot] = temp;
        }
      }

      batch.forEach((plan, slot) => {
        plan.sizeRole = roles[slot] || 'medium';
        plan.batchStart = batchStart;
        plan.batchSlot = slot;
      });
    }
  }

  function ensurePlans(lines) {
    if (plansForLines === lines) return plans;
    plans = lines.map((line, index) => buildPlan(lines, index)).filter(Boolean);
    assignBatchSizes(plans);
    plansForLines = lines;
    renderedBatchStart = EMPTY_TARGET;
    batchRows = [];
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
    return Math.floor(index / BATCH_SIZE) % 2 === 0 ? 'left' : 'right';
  }

  function fitScale(text, sizeRole) {
    const length = visibleLength(text);
    const base = sizeRole === 'large' ? 1.06 : (sizeRole === 'small' ? 0.52 : 0.76);
    const comfortable = sizeRole === 'large' ? 12 : (sizeRole === 'small' ? 24 : 17);
    if (length <= comfortable) return base;
    const shrink = Math.pow(comfortable / length, 0.72);
    return Math.max(base * 0.58, base * shrink);
  }

  function makeRow(plan) {
    if (!plan) return null;
    const row = document.createElement('div');
    row.className = `ps-row ps-row--${plan.sizeRole} ps-row--slot-${plan.batchSlot}`;
    row.style.setProperty('--ps-font-scale', fitScale(plan.text, plan.sizeRole).toFixed(3));
    row.style.setProperty('--ps-open', '0');

    const plate = document.createElement('div');
    plate.className = 'ps-plate';
    const text = document.createElement('div');
    text.className = 'ps-text';
    plate.appendChild(text);
    row.appendChild(plate);

    const glyphEls = [];
    plan.glyphs.forEach((glyph) => {
      const span = document.createElement('span');
      span.className = 'ps-glyph';
      span.textContent = glyph.char;
      text.appendChild(span);
      glyphEls.push({ el: span, startMs: glyph.startMs, endMs: glyph.endMs });
    });
    return {
      plan,
      row,
      plate,
      glyphEls,
      revealCount: -1,
      lineActive: false,
    };
  }

  function constrainRowWidth(entry) {
    if (!entry?.row || !entry?.plate || !groupEl) return;
    const available = Math.max(1, groupEl.clientWidth);
    const measured = entry.plate.scrollWidth;
    if (!Number.isFinite(measured) || measured <= available) return;
    const currentScale = Number.parseFloat(entry.row.style.getPropertyValue('--ps-font-scale')) || 0.76;
    const nextScale = Math.max(0.34, currentScale * (available / measured) * 0.97);
    entry.row.style.setProperty('--ps-font-scale', nextScale.toFixed(3));
  }

  function resetAndConstrainRowWidth(entry) {
    if (!entry?.plan || !entry.row) return;
    entry.row.style.setProperty('--ps-font-scale', fitScale(entry.plan.text, entry.plan.sizeRole).toFixed(3));
    constrainRowWidth(entry);
  }

  function syncStageLayout() {
    if (safeZoneGuide) safeZoneGuide.sync();
    if (renderedBatchStart >= 0 && plans[renderedBatchStart] && rootEl) {
      rootEl.dataset.side = currentPlacement(plans[renderedBatchStart].index);
    }
    // 安全距離或左右模式改變時，先回到該句原始尺寸再依新的可用寬度縮放。
    // 這是使用者設定造成的即時重排，不會發生在正常逐句播放期間。
    batchRows.forEach(resetAndConstrainRowWidth);
  }

  function renderBatch(batchStart) {
    if (!groupEl) return;
    groupEl.replaceChildren();
    batchRows = [];

    if (batchStart < 0 || !plans[batchStart]) {
      rootEl?.removeAttribute('data-side');
      return;
    }

    rootEl.dataset.side = currentPlacement(plans[batchStart].index);
    const yNoise = LyricMotion.hashNoise(batchStart * 73 + 19, 11);
    groupEl.style.setProperty('--ps-y-shift', `${((yNoise - 0.5) * 8).toFixed(2)}vh`);

    plans.slice(batchStart, batchStart + BATCH_SIZE).forEach((plan) => {
      const entry = makeRow(plan);
      if (!entry) return;
      groupEl.appendChild(entry.row);
      batchRows.push(entry);
    });

    // 先把三句都建好且保持不可見，再同步量測單邊寬度；第一個 paint 前就完成縮放，不會肉眼看到跳尺寸。
    batchRows.forEach(constrainRowWidth);
  }

  function applyRowState(timeMs, entry) {
    if (!entry?.plan || !entry.row) return;
    const { plan, row, glyphEls } = entry;

    const preStart = plan.startMs - PRE_ROLL_MS;
    const openRaw = smoothstep((timeMs - preStart) / BAR_OPEN_MS);
    const open = timeMs < preStart ? 0 : MIN_BAR_OPEN + (1 - MIN_BAR_OPEN) * openRaw;
    row.style.setProperty('--ps-open', clamp01(open).toFixed(4));

    let revealCount = 0;
    for (let i = 0; i < glyphEls.length; i += 1) {
      if (glyphEls[i].startMs <= timeMs) revealCount = i + 1;
      else break;
    }
    const lineActive = timeMs >= plan.startMs && timeMs < plan.endMs;
    if (revealCount === entry.revealCount && lineActive === entry.lineActive) return;

    glyphEls.forEach((glyph, index) => {
      glyph.el.classList.toggle('is-on', index < revealCount);
      glyph.el.classList.toggle('is-current', lineActive && index === revealCount - 1);
    });
    entry.revealCount = revealCount;
    entry.lineActive = lineActive;
  }

  function computeAndRender(timeMs, lines) {
    if (!rootEl || !groupEl) return;
    ensurePlans(lines);
    if (plans.length === 0) {
      if (renderedBatchStart !== -1) {
        renderedBatchStart = -1;
        renderBatch(-1);
      }
      return;
    }

    const nextTarget = findTargetIndex(timeMs);
    const nextBatchStart = nextTarget >= 0 ? Math.floor(nextTarget / BATCH_SIZE) * BATCH_SIZE : -1;
    if (nextBatchStart !== renderedBatchStart) {
      renderedBatchStart = nextBatchStart;
      renderBatch(renderedBatchStart);
    }
    batchRows.forEach((entry) => applyRowState(timeMs, entry));
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
      safeZoneGuide = LyricMotion.mountStageSafeZoneGuide(rootEl);
      plansForLines = null;
      renderedBatchStart = EMPTY_TARGET;
      batchRows = [];
    },

    destroy() {
      if (safeZoneGuide) { safeZoneGuide.destroy(); safeZoneGuide = null; }
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null;
      groupEl = null;
      plans = [];
      plansForLines = null;
      renderedBatchStart = EMPTY_TARGET;
      batchRows = [];
    },

    onLyricsLoaded() {
      plansForLines = null;
      renderedBatchStart = EMPTY_TARGET;
      batchRows = [];
      if (groupEl) groupEl.replaceChildren();
    },

    onSettings() {
      syncStageLayout();
    },

    onSeek(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },

    onFrame(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },
  });
})();
