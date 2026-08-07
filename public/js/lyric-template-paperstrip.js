/**
 * Elitesand Pro 排版模板：紙帶逐字（Paper Strip）
 *
 * 視覺方向取自使用者提供的日系 PV 參考，但程式與版面規則皆為獨立實作：
 * - 新句開始前先讓白色紙帶由左往右展開
 * - 歌詞依原始逐字時間逐字浮現；只有目前字使用 activeColor
 * - 每頁依句長、總字數、播放時間與穩定亂數選 2～4 句；滿頁後整頁清空，不做逐句滾動保留
 * - 每句在進場前就決定小／中／大尺寸，顯示期間不再因新句加入而改尺寸
 * - 尺寸排列依頁面句數從預設構圖中挑選，再用句長／節奏做有限度交換，避免長句拿到過大的尺寸
 * - 支援置中／偏左／偏右／左右分散；split 以整頁為單位交替左右
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
  const MIN_BATCH_SIZE = 2;
  const MAX_BATCH_SIZE = 4;
  const EMPTY_TARGET = -999;
  const SIZE_PATTERNS = {
    2: [
      ['large', 'small'],
      ['small', 'large'],
      ['medium', 'large'],
      ['large', 'medium'],
    ],
    3: [
      ['small', 'large', 'medium'],
      ['large', 'small', 'medium'],
      ['medium', 'large', 'small'],
      ['small', 'medium', 'large'],
      ['large', 'medium', 'small'],
      ['medium', 'small', 'large'],
    ],
    4: [
      ['small', 'large', 'medium', 'small'],
      ['medium', 'small', 'large', 'small'],
      ['small', 'medium', 'small', 'large'],
      ['large', 'small', 'medium', 'small'],
    ],
  };

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

  function planDurationMs(plan) {
    return Math.max(500, (plan?.endMs || 0) - (plan?.startMs || 0));
  }

  function batchMetrics(batch) {
    const lengths = batch.map((plan) => visibleLength(plan.text));
    const totalChars = lengths.reduce((sum, value) => sum + value, 0);
    const totalDuration = batch.reduce((sum, plan) => sum + planDurationMs(plan), 0);
    return {
      totalChars,
      totalDuration,
      averageChars: totalChars / Math.max(1, batch.length),
      maxChars: Math.max(...lengths, 1),
    };
  }

  function scoreBatchCandidate(allPlans, start, count, batchNumber, previousCount) {
    const remaining = allPlans.length - start;
    if (count > remaining) return Number.POSITIVE_INFINITY;
    // 能避免的話不要留下孤零零的一句，否則最後一頁會破壞 2～4 句的節奏。
    if (remaining - count === 1) return Number.POSITIVE_INFINITY;

    const batch = allPlans.slice(start, start + count);
    const metrics = batchMetrics(batch);
    const seed = batchSeed(batch, batchNumber) + start * 131 + count * 977;
    let score = 0;

    // 每頁約 34～46 個可見字最舒服；過密比過疏更需要被懲罰。
    const targetChars = 38;
    score += Math.abs(metrics.totalChars - targetChars) / 13;
    if (metrics.totalChars > 52) score += (metrics.totalChars - 52) / 6;
    if (metrics.maxChars > 26) score += (metrics.maxChars - 26) / 5;

    // 時間太長會讓同一頁掛太久；太短又會頻繁整頁切換。
    const targetDuration = 9000;
    score += Math.abs(metrics.totalDuration - targetDuration) / 7000;
    if (metrics.totalDuration > 14500) score += (metrics.totalDuration - 14500) / 4500;
    if (metrics.totalDuration < 4200) score += (4200 - metrics.totalDuration) / 2800;

    // 長句頁偏向 2 句、短句頁偏向 4 句；一般情況仍以 3 句為自然中心。
    if (metrics.averageChars >= 18) score += count === 2 ? -1.15 : (count === 4 ? 1.7 : 0.25);
    else if (metrics.averageChars <= 9) score += count === 4 ? -1.0 : (count === 2 ? 0.95 : 0.1);
    else score += count === 3 ? -0.42 : 0;

    // 避免每頁都固定同樣句數，但只是輕微偏好，不凌駕文字密度。
    if (count === previousCount) score += 0.52;

    // 穩定亂數只負責打破太機械的結果；同一首歌每次播放都會得到相同頁面。
    score += (LyricMotion.hashNoise(seed, 53) - 0.5) * 0.92;
    return score;
  }

  function chooseBatchSize(allPlans, start, batchNumber, previousCount) {
    const remaining = allPlans.length - start;
    if (remaining <= MAX_BATCH_SIZE) return remaining === 1 ? 1 : remaining;

    let bestCount = 3;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let count = MIN_BATCH_SIZE; count <= MAX_BATCH_SIZE; count += 1) {
      const score = scoreBatchCandidate(allPlans, start, count, batchNumber, previousCount);
      if (score < bestScore) {
        bestScore = score;
        bestCount = count;
      }
    }
    return bestCount;
  }

  function emphasisScore(plan, seed, slot) {
    const length = visibleLength(plan.text);
    const duration = planDurationMs(plan);
    const charsPerSecond = length / Math.max(0.5, duration / 1000);
    const punctuationBoost = /[!！?？…。]$/.test((plan.text || '').trim()) ? 0.28 : 0;
    // 短而有停頓的句子比較適合大字；極快長句則自然往小字靠。
    return (14 / Math.max(6, length)) + (1.4 / Math.max(1.2, charsPerSecond))
      + punctuationBoost + (LyricMotion.hashNoise(seed, 71 + slot) - 0.5) * 0.34;
  }

  function assignBatchSizes(batch, batchNumber) {
    const seed = batchSeed(batch, batchNumber);
    const patterns = SIZE_PATTERNS[batch.length] || SIZE_PATTERNS[3];
    const patternIndex = Math.floor(LyricMotion.hashNoise(seed, 41) * patterns.length) % patterns.length;
    const roles = patterns[patternIndex].slice(0, batch.length);

    const largeSlot = roles.indexOf('large');
    if (largeSlot >= 0 && batch.length > 1) {
      let bestLargeSlot = largeSlot;
      let bestScore = emphasisScore(batch[largeSlot], seed, largeSlot);
      batch.forEach((plan, slot) => {
        const score = emphasisScore(plan, seed, slot);
        if (score > bestScore) {
          bestScore = score;
          bestLargeSlot = slot;
        }
      });
      const currentLargeLength = visibleLength(batch[largeSlot].text);
      const candidateLength = visibleLength(batch[bestLargeSlot].text);
      if (bestLargeSlot !== largeSlot && (currentLargeLength >= 15 || candidateLength + 3 <= currentLargeLength)) {
        const temp = roles[largeSlot];
        roles[largeSlot] = roles[bestLargeSlot];
        roles[bestLargeSlot] = temp;
      }
    }

    // 最長句若不是 large，優先把 small 放給它；四句頁尤其能降低安全框附近的壓迫感。
    const smallSlots = roles.map((role, slot) => role === 'small' ? slot : -1).filter((slot) => slot >= 0);
    if (smallSlots.length > 0) {
      let longestSlot = 0;
      batch.forEach((plan, slot) => {
        if (visibleLength(plan.text) > visibleLength(batch[longestSlot].text)) longestSlot = slot;
      });
      if (roles[longestSlot] !== 'large' && !smallSlots.includes(longestSlot)) {
        const sourceSmallSlot = smallSlots.reduce((best, slot) => (
          visibleLength(batch[slot].text) < visibleLength(batch[best].text) ? slot : best
        ), smallSlots[0]);
        const temp = roles[longestSlot];
        roles[longestSlot] = roles[sourceSmallSlot];
        roles[sourceSmallSlot] = temp;
      }
    }

    batch.forEach((plan, slot) => {
      plan.sizeRole = roles[slot] || 'medium';
      plan.batchSlot = slot;
    });
  }

  function buildBatches(allPlans) {
    const batches = [];
    let start = 0;
    let previousCount = 0;
    while (start < allPlans.length) {
      const batchNumber = batches.length;
      let count = chooseBatchSize(allPlans, start, batchNumber, previousCount);
      // 只有整首歌本身只剩一行時才允許單句頁；一般分組會主動避開留下 1 句。
      if (count <= 0) count = Math.min(3, allPlans.length - start);
      const batch = allPlans.slice(start, start + count);
      assignBatchSizes(batch, batchNumber);
      const meta = { start, count: batch.length, index: batchNumber };
      batch.forEach((plan, slot) => {
        plan.batchStart = start;
        plan.batchCount = batch.length;
        plan.batchIndex = batchNumber;
        plan.batchSlot = slot;
      });
      batches.push(meta);
      previousCount = batch.length;
      start += batch.length;
    }
    return batches;
  }

  function ensurePlans(lines) {
    if (plansForLines === lines) return plans;
    plans = lines.map((line, index) => buildPlan(lines, index)).filter(Boolean);
    buildBatches(plans);
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

  function currentPlacement(plan) {
    const value = document.body.dataset.lyricPos || 'center';
    if (value !== 'split') return 'center';
    return (plan?.batchIndex || 0) % 2 === 0 ? 'left' : 'right';
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
      rootEl.dataset.side = currentPlacement(plans[renderedBatchStart]);
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

    rootEl.dataset.side = currentPlacement(plans[batchStart]);
    const yNoise = LyricMotion.hashNoise(batchStart * 73 + 19, 11);
    groupEl.style.setProperty('--ps-y-shift', `${((yNoise - 0.5) * 8).toFixed(2)}vh`);

    const batchCount = plans[batchStart]?.batchCount || 1;
    plans.slice(batchStart, batchStart + batchCount).forEach((plan) => {
      const entry = makeRow(plan);
      if (!entry) return;
      groupEl.appendChild(entry.row);
      batchRows.push(entry);
    });

    // 先把整頁都建好且保持不可見，再同步量測單邊寬度；第一個 paint 前就完成縮放，不會肉眼看到跳尺寸。
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
    const nextBatchStart = nextTarget >= 0 ? plans[nextTarget]?.batchStart ?? -1 : -1;
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
