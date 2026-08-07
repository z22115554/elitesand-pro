/**
 * Elitesand Pro 排版模板：鏡像（Mirror）P0
 *
 * P0 只處理靜態構圖，不做組裝動畫：
 * - 固定左右雙側構圖，中央安全區永遠保留給人物
 * - 左側為實心原文，右側為描邊鏡像字
 * - 右側僅把平假名轉成片假名；中文／韓文／英文／漢字原樣保留
 * - 每頁依句長與播放時間穩定分成 2～4 句
 * - 每句與每個 glyph 都在頁面建立前決定大小、角度與上下錯位
 * - 所有變化由 deterministic hash 產生，同一首歌 reload / seek 構圖一致
 */
(function () {
  'use strict';

  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined') {
    console.warn('[Mirror] 依賴未載入，模板停用');
    return;
  }

  const MIN_BATCH_SIZE = 2;
  const MAX_BATCH_SIZE = 4;
  const FIRST_PAGE_PREVIEW_MS = 300;
  const LINE_PATTERNS = {
    2: [
      ['hero', 'medium'],
      ['medium', 'hero'],
      ['large', 'small'],
    ],
    3: [
      ['large', 'small', 'medium'],
      ['small', 'hero', 'medium'],
      ['medium', 'large', 'small'],
      ['small', 'medium', 'hero'],
    ],
    4: [
      ['medium', 'small', 'hero', 'medium'],
      ['small', 'large', 'medium', 'small'],
      ['large', 'small', 'medium', 'small'],
      ['small', 'medium', 'small', 'hero'],
    ],
  };

  const ROLE_SCALE = {
    hero: 1.18,
    large: 1.02,
    medium: 0.82,
    small: 0.64,
  };

  let rootEl = null;
  let primaryPanel = null;
  let echoPanel = null;
  let safeZoneGuide = null;
  let plans = [];
  let plansForLines = null;
  let renderedBatchStart = -999;
  let renderedEntries = [];

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function visibleLength(text) {
    return Math.max(1, Array.from(text || '').length);
  }

  function hasKana(text) {
    return /[\u3040-\u30ff]/.test(text || '');
  }

  function hasHan(text) {
    return /[\u3400-\u9fff]/.test(text || '');
  }

  function isHanGlyph(char) {
    return /[\u3400-\u9fff]/.test(char || '');
  }

  function isPunctuation(char) {
    return /^[\s、。！？!?…,.・:：;；「」『』（）()\[\]【】ー~～]$/.test(char || '');
  }

  function mirrorText(text) {
    const normalized = String(text || '').normalize('NFC');
    let out = '';
    for (const ch of normalized) {
      const code = ch.codePointAt(0);
      if ((code >= 0x3041 && code <= 0x3096) || (code >= 0x309d && code <= 0x309f)) {
        out += String.fromCodePoint(code + 0x60);
      } else {
        out += ch;
      }
    }
    return out;
  }

  function lineEndMs(lines, index) {
    const line = lines[index];
    if (!line) return 0;
    if (Number.isFinite(line.duration) && line.duration > 0) return line.time + line.duration;
    return lines[index + 1]?.time ?? (line.time + 5000);
  }

  function buildPlan(lines, index) {
    const line = lines[index];
    const text = String(line?.text || '').trim();
    if (!text) return null;
    return {
      index,
      text,
      mirrorText: mirrorText(text),
      startMs: Number.isFinite(line.time) ? line.time : 0,
      endMs: lineEndMs(lines, index),
    };
  }

  function planDurationMs(plan) {
    return Math.max(500, (plan?.endMs || 0) - (plan?.startMs || 0));
  }

  function batchSeed(batch, batchIndex) {
    let seed = (batchIndex + 1) * 1217;
    batch.forEach((plan, slot) => {
      Array.from(plan?.text || '').forEach((char, index) => {
        seed += ((char.codePointAt(0) || 0) % 1543) * (slot + 3) * (index + 7);
      });
    });
    return seed;
  }

  function scoreBatchCandidate(allPlans, start, count, batchIndex, previousCount) {
    const remaining = allPlans.length - start;
    if (count > remaining) return Number.POSITIVE_INFINITY;
    if (remaining - count === 1) return Number.POSITIVE_INFINITY;

    const batch = allPlans.slice(start, start + count);
    const lengths = batch.map((plan) => visibleLength(plan.text));
    const totalChars = lengths.reduce((sum, value) => sum + value, 0);
    const averageChars = totalChars / Math.max(1, count);
    const maxChars = Math.max(...lengths, 1);
    const totalDuration = batch.reduce((sum, plan) => sum + planDurationMs(plan), 0);
    let score = 0;

    score += Math.abs(totalChars - 34) / 12;
    if (totalChars > 48) score += (totalChars - 48) / 5;
    if (maxChars > 24) score += (maxChars - 24) / 4;
    score += Math.abs(totalDuration - 8500) / 6500;
    if (totalDuration > 14000) score += (totalDuration - 14000) / 4200;
    if (totalDuration < 3600) score += (3600 - totalDuration) / 2300;

    if (averageChars >= 17) score += count === 2 ? -1.05 : (count === 4 ? 1.45 : 0.2);
    else if (averageChars <= 8) score += count === 4 ? -0.85 : (count === 2 ? 0.8 : 0.08);
    else score += count === 3 ? -0.35 : 0;
    if (count === previousCount) score += 0.38;

    const seed = batchSeed(batch, batchIndex) + start * 173 + count * 613;
    score += (LyricMotion.hashNoise(seed, 29) - 0.5) * 0.72;
    return score;
  }

  function chooseBatchSize(allPlans, start, batchIndex, previousCount) {
    const remaining = allPlans.length - start;
    if (remaining <= MAX_BATCH_SIZE) return remaining === 1 ? 1 : remaining;
    let bestCount = 3;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let count = MIN_BATCH_SIZE; count <= MAX_BATCH_SIZE; count += 1) {
      const score = scoreBatchCandidate(allPlans, start, count, batchIndex, previousCount);
      if (score < bestScore) {
        bestScore = score;
        bestCount = count;
      }
    }
    return bestCount;
  }

  function assignLineRoles(batch, batchIndex) {
    const seed = batchSeed(batch, batchIndex);
    const patterns = LINE_PATTERNS[batch.length] || LINE_PATTERNS[3];
    const patternIndex = Math.floor(LyricMotion.hashNoise(seed, 37) * patterns.length) % patterns.length;
    const roles = patterns[patternIndex].slice(0, batch.length);

    // 最長句不要拿 hero；短句比較適合成為視覺焦點。
    const heroSlot = roles.indexOf('hero');
    if (heroSlot >= 0 && batch.length > 1) {
      let shortestSlot = 0;
      batch.forEach((plan, slot) => {
        if (visibleLength(plan.text) < visibleLength(batch[shortestSlot].text)) shortestSlot = slot;
      });
      if (visibleLength(batch[heroSlot].text) >= 14 && shortestSlot !== heroSlot) {
        const temp = roles[heroSlot];
        roles[heroSlot] = roles[shortestSlot];
        roles[shortestSlot] = temp;
      }
    }

    batch.forEach((plan, slot) => {
      plan.batchStart = batch[0].batchStart;
      plan.batchCount = batch.length;
      plan.batchIndex = batchIndex;
      plan.batchSlot = slot;
      plan.lineRole = roles[slot] || 'medium';
    });
  }

  function buildBatches(allPlans) {
    let start = 0;
    let previousCount = 0;
    let batchIndex = 0;
    while (start < allPlans.length) {
      let count = chooseBatchSize(allPlans, start, batchIndex, previousCount);
      if (count <= 0) count = Math.min(3, allPlans.length - start);
      const batch = allPlans.slice(start, start + count);
      batch.forEach((plan) => { plan.batchStart = start; });
      assignLineRoles(batch, batchIndex);
      previousCount = batch.length;
      start += batch.length;
      batchIndex += 1;
    }
  }

  function ensurePlans(lines) {
    if (plansForLines === lines) return plans;
    plans = lines.map((line, index) => buildPlan(lines, index)).filter(Boolean);
    buildBatches(plans);
    plansForLines = lines;
    renderedBatchStart = -999;
    return plans;
  }

  function findStartedIndex(timeMs) {
    let lo = 0;
    let hi = plans.length - 1;
    let answer = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (!plans[mid] || plans[mid].startMs > timeMs) hi = mid - 1;
      else {
        answer = mid;
        lo = mid + 1;
      }
    }
    return answer;
  }

  function targetBatchStart(timeMs) {
    const started = findStartedIndex(timeMs);
    if (started >= 0) return plans[started]?.batchStart ?? -1;
    if (plans[0] && timeMs >= plans[0].startMs - FIRST_PAGE_PREVIEW_MS) return plans[0].batchStart;
    return -1;
  }

  function pickAccentGlyphIndex(text, plan, side) {
    const chars = Array.from(text || '');
    const japanese = hasKana(plan.text);
    const pureChinese = hasHan(plan.text) && !hasKana(plan.text);
    let candidates = chars.map((char, index) => ({ char, index })).filter(({ char }) => !isPunctuation(char));
    if (japanese) {
      const hanCandidates = candidates.filter(({ char }) => isHanGlyph(char));
      if (hanCandidates.length) candidates = hanCandidates;
    }
    if (!candidates.length) return -1;
    if (pureChinese && chars.length > 7) return -1;
    if (!japanese && !pureChinese && chars.length > 10) return -1;

    const seed = (plan.batchIndex + 1) * 991 + (plan.batchSlot + 1) * 313 + (side === 'echo' ? 197 : 0);
    const index = Math.floor(LyricMotion.hashNoise(seed, 83) * candidates.length) % candidates.length;
    return candidates[index].index;
  }

  function glyphVisual(plan, char, glyphIndex, side, accentIndex) {
    const japanese = hasKana(plan.text);
    const pureChinese = hasHan(plan.text) && !hasKana(plan.text);
    const seed = (plan.batchIndex + 1) * 1777 + (plan.batchSlot + 1) * 503 + (glyphIndex + 1) * 97 + (side === 'echo' ? 311 : 0);
    const noiseA = LyricMotion.hashNoise(seed, 11);
    const noiseB = LyricMotion.hashNoise(seed, 23);
    const noiseC = LyricMotion.hashNoise(seed, 47);
    const isAccent = glyphIndex === accentIndex;
    const punctuation = isPunctuation(char);

    let scale = 0.965 + noiseA * 0.075;
    if (punctuation) scale *= 0.78;
    if (isAccent) {
      if (japanese && isHanGlyph(char)) scale *= 1.30;
      else if (pureChinese) scale *= 1.13;
      else scale *= 1.18;
    } else if (japanese && isHanGlyph(char) && visibleLength(plan.text) <= 10) {
      scale *= 1.06;
    }

    const rotationRange = isAccent ? (side === 'echo' ? 7.5 : 6.2) : (side === 'echo' ? 5.2 : 4.0);
    const rotation = (noiseB - 0.5) * rotationRange * 2;
    const y = (noiseC - 0.5) * (isAccent ? 0.24 : 0.16);
    const x = (noiseA - 0.5) * 0.045;
    return { scale, rotation, x, y };
  }

  function createLine(plan, side) {
    const line = document.createElement('div');
    line.className = `mirror-line mirror-line--${plan.lineRole} mirror-line--${side}`;
    line.dataset.slot = String(plan.batchSlot);
    line.style.setProperty('--mirror-line-scale', String(ROLE_SCALE[plan.lineRole] || ROLE_SCALE.medium));
    line.style.setProperty('--mirror-fit-scale', '1');

    const lineSeed = (plan.batchIndex + 1) * 577 + (plan.batchSlot + 1) * 139 + (side === 'echo' ? 89 : 0);
    const outwardShift = 0.35 + LyricMotion.hashNoise(lineSeed, 17) * 2.1;
    const lineRotation = (LyricMotion.hashNoise(lineSeed, 31) - 0.5) * (side === 'echo' ? 2.4 : 1.7);
    line.style.setProperty('--mirror-outward-shift', `${outwardShift.toFixed(2)}vw`);
    line.style.setProperty('--mirror-line-rotation', `${lineRotation.toFixed(2)}deg`);

    const text = side === 'echo' ? plan.mirrorText : plan.text;
    const chars = Array.from(text);
    const accentIndex = pickAccentGlyphIndex(text, plan, side);
    chars.forEach((char, glyphIndex) => {
      const glyph = document.createElement('span');
      glyph.className = 'mirror-glyph';
      glyph.textContent = char;
      const visual = glyphVisual(plan, char, glyphIndex, side, accentIndex);
      glyph.style.setProperty('--mirror-glyph-scale', visual.scale.toFixed(3));
      glyph.style.setProperty('--mirror-glyph-rotation', `${visual.rotation.toFixed(2)}deg`);
      glyph.style.setProperty('--mirror-glyph-x', `${visual.x.toFixed(3)}em`);
      glyph.style.setProperty('--mirror-glyph-y', `${visual.y.toFixed(3)}em`);
      if (glyphIndex === accentIndex) glyph.classList.add('is-accent');
      line.appendChild(glyph);
    });

    return { plan, side, line };
  }

  function constrainLine(entry) {
    if (!entry?.line) return;
    const panel = entry.side === 'echo' ? echoPanel : primaryPanel;
    if (!panel) return;
    const available = Math.max(1, panel.clientWidth - 8);
    for (let pass = 0; pass < 4; pass += 1) {
      const measured = entry.line.scrollWidth;
      if (!Number.isFinite(measured) || measured <= available * 0.96) return;
      const current = Number.parseFloat(entry.line.style.getPropertyValue('--mirror-fit-scale')) || 1;
      const next = Math.max(0.44, current * (available * 0.93 / measured));
      entry.line.style.setProperty('--mirror-fit-scale', next.toFixed(3));
      if (next <= 0.4401) return;
    }
  }

  function clearPanels() {
    if (primaryPanel) primaryPanel.replaceChildren();
    if (echoPanel) echoPanel.replaceChildren();
    renderedEntries = [];
  }

  function renderBatch(batchStart) {
    clearPanels();
    if (batchStart < 0 || !plans[batchStart]) return;
    const batchCount = plans[batchStart].batchCount || 1;
    const batch = plans.slice(batchStart, batchStart + batchCount);
    const pageSeed = (plans[batchStart].batchIndex + 1) * 719;
    const pageShift = (LyricMotion.hashNoise(pageSeed, 59) - 0.5) * 6.5;
    primaryPanel.style.setProperty('--mirror-page-y', `${pageShift.toFixed(2)}vh`);
    echoPanel.style.setProperty('--mirror-page-y', `${(pageShift * 0.72).toFixed(2)}vh`);

    batch.forEach((plan) => {
      const primary = createLine(plan, 'primary');
      const echo = createLine(plan, 'echo');
      primaryPanel.appendChild(primary.line);
      echoPanel.appendChild(echo.line);
      renderedEntries.push(primary, echo);
    });
    renderedEntries.forEach(constrainLine);
  }

  function syncLayout() {
    if (safeZoneGuide) safeZoneGuide.sync();
    renderedEntries.forEach((entry) => {
      entry.line.style.setProperty('--mirror-fit-scale', '1');
      constrainLine(entry);
    });
  }

  function computeAndRender(timeMs, lines) {
    if (!rootEl) return;
    ensurePlans(lines);
    if (!plans.length) {
      if (renderedBatchStart !== -1) {
        renderedBatchStart = -1;
        clearPanels();
      }
      return;
    }
    const batchStart = targetBatchStart(timeMs);
    if (batchStart === renderedBatchStart) return;
    renderedBatchStart = batchStart;
    renderBatch(batchStart);
  }

  LyricTemplates.register({
    id: 'mirror',
    label: '鏡像',

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'mirror-root';
      primaryPanel = document.createElement('div');
      primaryPanel.className = 'mirror-panel mirror-panel--primary';
      echoPanel = document.createElement('div');
      echoPanel.className = 'mirror-panel mirror-panel--echo';
      rootEl.appendChild(primaryPanel);
      rootEl.appendChild(echoPanel);
      container.appendChild(rootEl);
      safeZoneGuide = LyricMotion.mountStageSafeZoneGuide(rootEl);
      plansForLines = null;
      renderedBatchStart = -999;
      renderedEntries = [];
    },

    destroy() {
      if (safeZoneGuide) { safeZoneGuide.destroy(); safeZoneGuide = null; }
      if (rootEl?.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null;
      primaryPanel = null;
      echoPanel = null;
      plans = [];
      plansForLines = null;
      renderedBatchStart = -999;
      renderedEntries = [];
    },

    onLyricsLoaded() {
      plansForLines = null;
      renderedBatchStart = -999;
      clearPanels();
    },

    onSettings() {
      syncLayout();
    },

    onSeek(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },

    onFrame(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },
  });
})();
