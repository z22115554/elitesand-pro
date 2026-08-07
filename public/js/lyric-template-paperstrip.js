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

  // 白條必須先於文字完成主要動作。參考影片的速度不是標準 ease-in-out，而是
  // 「前段蓄力 → 中段快速拉開 → 後段長尾收住」；把整段拉長到 700ms，
  // 並提前 900ms 啟動，正常播放時仍會在第一個字前約 200ms 完整定位。
  const PRE_ROLL_MS = 900;
  const BAR_OPEN_MS = 700;
  // 參考影片起始不是 1px 細線，而是一小截白色短條（約完成寬度的 8～10%）。
  const MIN_BAR_OPEN = 0.08;
  // 保險閘門：就算逐字 timing 有極端誤差，白條未幾乎展開完成前，文字一律不准顯示。
  const TEXT_REVEAL_MIN_OPEN = 0.985;
  const MIN_BATCH_SIZE = 2;
  const MAX_BATCH_SIZE = 4;
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
  let safeZoneGuide = null;
  let plans = [];
  let plansForLines = null;
  // 同一時間最多保留「正在唱的上一頁」與「正在 pre-roll 的下一頁」。
  // 這讓跨頁白條可以提早進場，但不會用 replaceChildren() 把上一頁最後一句提前清掉。
  const pageViews = new Map();

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function barRevealProgress(value) {
    const t = clamp01(value);

    // 0～24%：先慢慢蓄力，只走到約 20%。
    if (t <= 0.24) {
      const u = t / 0.24;
      return 0.20 * u * u;
    }

    // 24～34%：參考影片最有辨識度的「突然拉開」段，短時間衝到約 74%。
    if (t <= 0.34) {
      const u = (t - 0.24) / 0.10;
      const kick = u * u * (3 - 2 * u);
      return 0.20 + 0.54 * kick;
    }

    // 34～100%：剩下約四分之一寬度用長尾慢慢收滿，不做彈跳或 overshoot。
    const u = (t - 0.34) / 0.66;
    return 0.74 + 0.26 * (1 - Math.pow(1 - u, 2.45));
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
    clearPageViews();
    return plans;
  }

  function clearPageViews() {
    pageViews.forEach((view) => {
      if (view?.groupEl?.parentNode) view.groupEl.parentNode.removeChild(view.groupEl);
    });
    pageViews.clear();
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
    if (!entry?.row || !entry?.plate || !entry?.groupEl) return;
    const style = window.getComputedStyle(entry.row);
    const indent = Number.parseFloat(style.marginLeft) || 0;
    const available = Math.max(1, entry.groupEl.clientWidth - indent - 2);

    // nowrap 紙帶不能靠 overflow:hidden「假裝有遵守安全框」；那會直接裁掉歌詞。
    // 反覆量測實際 scrollWidth 並縮字，直到整條紙帶（含每列縮排）真的落在可用寬度內。
    // 最低允許比舊版更小，寧可讓極端長句縮小，也不可把字切掉。
    for (let pass = 0; pass < 3; pass += 1) {
      const measured = entry.plate.scrollWidth;
      if (!Number.isFinite(measured) || measured <= available + 0.5) return;
      const currentScale = Number.parseFloat(entry.row.style.getPropertyValue('--ps-font-scale')) || 0.76;
      const nextScale = Math.max(0.22, currentScale * (available / measured) * 0.965);
      entry.row.style.setProperty('--ps-font-scale', nextScale.toFixed(3));
      // 已碰到底仍放不下時保留完整內容；CSS 不再裁切，至少不會出現半句消失。
      if (nextScale <= 0.2201) return;
    }
  }

  function resetAndConstrainRowWidth(entry) {
    if (!entry?.plan || !entry.row) return;
    entry.row.style.setProperty('--ps-font-scale', fitScale(entry.plan.text, entry.plan.sizeRole).toFixed(3));
    constrainRowWidth(entry);
  }

  function syncStageLayout() {
    if (safeZoneGuide) safeZoneGuide.sync();
    // 安全距離或左右模式改變時，先回到該句原始尺寸再依新的可用寬度縮放。
    // 這是使用者設定造成的即時重排，不會發生在正常逐句播放期間。
    pageViews.forEach((view) => {
      view.groupEl.dataset.side = currentPlacement(plans[view.batchStart]);
      view.rows.forEach(resetAndConstrainRowWidth);
    });
  }

  function renderBatch(batchStart) {
    if (!rootEl || batchStart < 0 || !plans[batchStart]) return null;
    if (pageViews.has(batchStart)) return pageViews.get(batchStart);

    const group = document.createElement('div');
    group.className = 'ps-group';
    group.dataset.side = currentPlacement(plans[batchStart]);
    group.dataset.batchStart = String(batchStart);
    const yNoise = LyricMotion.hashNoise(batchStart * 73 + 19, 11);
    group.style.setProperty('--ps-y-shift', `${((yNoise - 0.5) * 8).toFixed(2)}vh`);

    const batchCount = plans[batchStart]?.batchCount || 1;
    const rows = [];
    plans.slice(batchStart, batchStart + batchCount).forEach((plan) => {
      const entry = makeRow(plan);
      if (!entry) return;
      entry.groupEl = group;
      group.appendChild(entry.row);
      rows.push(entry);
    });

    const lastPlan = plans[batchStart + batchCount - 1] || plans[batchStart];
    const firstPlan = plans[batchStart];
    const previousPlan = plans[batchStart - 1];
    const previousBatchStart = previousPlan?.batchStart;
    let previousBatchEndMs = 0;
    if (Number.isInteger(previousBatchStart) && previousBatchStart !== batchStart) {
      const previousCount = plans[previousBatchStart]?.batchCount || 1;
      const previousLast = plans[previousBatchStart + previousCount - 1] || previousPlan;
      previousBatchEndMs = previousLast?.endMs || 0;
    }
    const view = {
      batchStart,
      batchCount,
      endMs: lastPlan?.endMs || 0,
      // 跨頁時白條可以照常 pre-roll，但下一頁文字必須等上一頁最後一句真的結束。
      // 正常沒有時間重疊時等於 firstPlan.startMs，不會額外延遲歌詞。
      textReleaseMs: Math.max(firstPlan?.startMs || 0, previousBatchEndMs),
      groupEl: group,
      rows,
    };
    rows.forEach((entry) => { entry.pageTextReleaseMs = view.textReleaseMs; });
    pageViews.set(batchStart, view);
    // 安全框 guide 使用較高 z-index；頁面本身只在 1～3 間切換層級。
    rootEl.appendChild(group);

    // 先把整頁都建好且保持不可見，再同步量測單邊寬度；第一個 paint 前就完成縮放，不會肉眼看到跳尺寸。
    rows.forEach(constrainRowWidth);
    return view;
  }

  function removeBatch(batchStart) {
    const view = pageViews.get(batchStart);
    if (!view) return;
    if (view.groupEl?.parentNode) view.groupEl.parentNode.removeChild(view.groupEl);
    pageViews.delete(batchStart);
  }

  function neededBatchStarts(timeMs) {
    const needed = new Set();
    const started = findStartedIndex(timeMs);
    const target = findTargetIndex(timeMs);

    // 正在唱的頁面必須保留到「該頁最後一句 endMs」之後，不能因下一頁 pre-roll 而消失。
    if (started >= 0) {
      const startedPlan = plans[started];
      const startedBatch = startedPlan?.batchStart;
      if (Number.isInteger(startedBatch)) {
        const count = plans[startedBatch]?.batchCount || 1;
        const lastPlan = plans[startedBatch + count - 1] || startedPlan;
        if (timeMs < (lastPlan?.endMs || 0)) needed.add(startedBatch);

        // 逐字來源偶爾會出現相鄰兩句時間重疊。即使 started 已經跳到下一頁，
        // seek／掉幀後也要把仍未到 endMs 的上一頁補回來，避免上一句尾字被截斷。
        const previousPlan = plans[startedBatch - 1];
        const previousBatch = previousPlan?.batchStart;
        if (Number.isInteger(previousBatch) && previousBatch !== startedBatch) {
          const previousCount = plans[previousBatch]?.batchCount || 1;
          const previousLast = plans[previousBatch + previousCount - 1] || previousPlan;
          if (timeMs < (previousLast?.endMs || 0)) needed.add(previousBatch);
        }
      }
    }

    // target 可以是同頁下一句，也可以是下一頁第一句的 pre-roll；後者只新增下一頁，不清上一頁。
    if (target >= 0 && Number.isInteger(plans[target]?.batchStart)) {
      needed.add(plans[target].batchStart);
    }
    return { needed, started, target };
  }

  function applyRowState(timeMs, entry) {
    if (!entry?.plan || !entry.row) return;
    const { plan, row, glyphEls } = entry;

    const preStart = plan.startMs - PRE_ROLL_MS;
    const openRaw = barRevealProgress((timeMs - preStart) / BAR_OPEN_MS);
    const open = timeMs < preStart ? 0 : MIN_BAR_OPEN + (1 - MIN_BAR_OPEN) * openRaw;
    const clampedOpen = clamp01(open);
    row.style.setProperty('--ps-open', clampedOpen.toFixed(4));
    // 左到右遮罩：左邊界固定，只逐步放開右側。0 = 完全收起、1 = 完全展開。
    // JS 直接算百分比，避免依賴 CSS 百分比乘法造成 OBS/CEF 版本差異。
    row.style.setProperty('--ps-clip-right', `${(100 - clampedOpen * 100).toFixed(3)}%`);

    let revealCount = 0;
    const pageTextReleaseMs = Number.isFinite(entry.pageTextReleaseMs) ? entry.pageTextReleaseMs : plan.startMs;
    const splitMode = (document.body.dataset.lyricPos || 'center') === 'split';
    // 左右分散時兩頁本來就落在不同側，現有雙頁共存效果良好，因此只保留白條完成度 gate；
    // 置中／偏左／偏右會疊在同一區，下一頁文字必須等上一頁最後一句結束後才放行。
    const pageHandoffReady = splitMode || timeMs >= pageTextReleaseMs;
    const textReady = clampedOpen >= TEXT_REVEAL_MIN_OPEN && pageHandoffReady;
    if (textReady) {
      for (let i = 0; i < glyphEls.length; i += 1) {
        if (glyphEls[i].startMs <= timeMs) revealCount = i + 1;
        else break;
      }
    }
    const lineActive = textReady && timeMs >= plan.startMs && timeMs < plan.endMs;
    if (revealCount === entry.revealCount && lineActive === entry.lineActive) return;

    glyphEls.forEach((glyph, index) => {
      glyph.el.classList.toggle('is-on', index < revealCount);
      glyph.el.classList.toggle('is-current', lineActive && index === revealCount - 1);
    });
    entry.revealCount = revealCount;
    entry.lineActive = lineActive;
  }

  function computeAndRender(timeMs, lines) {
    if (!rootEl) return;
    ensurePlans(lines);
    if (plans.length === 0) {
      clearPageViews();
      return;
    }

    const { needed, started } = neededBatchStarts(timeMs);
    needed.forEach((batchStart) => renderBatch(batchStart));
    Array.from(pageViews.keys()).forEach((batchStart) => {
      if (!needed.has(batchStart)) removeBatch(batchStart);
    });

    // 若兩頁歌詞時間真的重疊，較早開始、仍未唱完的上一頁優先在最上層；
    // 下一頁白條照樣在底下提前跑，上一頁結束後才自然露出。
    let foregroundBatch = null;
    Array.from(needed).sort((a, b) => a - b).some((batchStart) => {
      const view = pageViews.get(batchStart);
      const firstStart = plans[batchStart]?.startMs ?? Number.POSITIVE_INFINITY;
      if (view && firstStart <= timeMs && timeMs < view.endMs) {
        foregroundBatch = batchStart;
        return true;
      }
      return false;
    });
    if (foregroundBatch === null && started >= 0) foregroundBatch = plans[started]?.batchStart ?? null;
    pageViews.forEach((view, batchStart) => {
      // 正在唱的上一頁永遠壓在 pre-roll 下一頁上方；就算兩頁同側重疊，也不會讓新白條蓋掉舊歌詞。
      view.groupEl.style.zIndex = batchStart === foregroundBatch ? '3' : '1';
      view.rows.forEach((entry) => applyRowState(timeMs, entry));
    });
  }

  LyricTemplates.register({
    id: 'paperstrip',
    label: '紙帶逐字',

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'paperstrip-root';
      container.appendChild(rootEl);
      safeZoneGuide = LyricMotion.mountStageSafeZoneGuide(rootEl);
      plansForLines = null;
      clearPageViews();
    },

    destroy() {
      if (safeZoneGuide) { safeZoneGuide.destroy(); safeZoneGuide = null; }
      clearPageViews();
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null;
      plans = [];
      plansForLines = null;
    },

    onLyricsLoaded() {
      plansForLines = null;
      clearPageViews();
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
