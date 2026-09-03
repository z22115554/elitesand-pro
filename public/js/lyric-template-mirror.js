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

  // A time break is allowed to make a one-line group.  Forcing a distant
  // neighbour into a two-line composition makes the stage look ahead.
  const MIN_BATCH_SIZE = 1;
  const MAX_BATCH_SIZE = 4;
  const FIRST_PAGE_PREVIEW_MS = 300;
  // Group by the actual pause between lyric lines, never by the distance
  // between their starts: two sustained lines can have distant starts while
  // still being one continuous phrase.
  const MAX_INTERLINE_GAP_MS = 750;
  // The reference builds one newly sung line at a time.  A page merely caps
  // how many completed lines remain visible; it is never an animation unit.
  const LINE_ASSEMBLY_STEP_MS = 52;
  const LINE_ASSEMBLY_MIN_DURATION_MS = 246;
  const LINE_ASSEMBLY_DURATION_RANGE_MS = 92;
  const ECHO_ASSEMBLY_DELAY_MS = 76;
  // A landed glyph remains alive.  These values stay deliberately tiny so the
  // layout reads as stable, while every glyph keeps its own subtle pulse.
  const IDLE_FADE_IN_MS = 160;
  // Singing emphasis is driven by the source glyph timing.  Ordinary LRC has
  // no word timing, so LyricMotion gives it an explicit, line-level fallback.
  const SING_PULSE_MIN_DURATION_MS = 110;
  const SING_PULSE_MAX_DURATION_MS = 360;
  // The three profiles never change lyric timing, page grouping, or the
  // centre safe zone.  Pulse is deliberately tuned separately from the
  // arrival and idle layers: a singer's current glyph needs to read first.
  const MIRROR_MOTION_PROFILES = {
    calm: {
      travel: 0.56, spin: 0.52, entryScale: 0.62, assemblyStep: 0.88,
      echoDelay: 0.72, moveOvershoot: 0.68, rotationOvershoot: 0.92,
      scaleOvershoot: 0.78, idle: 0.52, pulse: 0.62,
    },
    normal: {
      travel: 1, spin: 1, entryScale: 1, assemblyStep: 1,
      echoDelay: 1, moveOvershoot: 1.32, rotationOvershoot: 1.86,
      scaleOvershoot: 1.52, idle: 1, pulse: 1.28,
    },
    chaotic: {
      travel: 1.38, spin: 1.55, entryScale: 1.34, assemblyStep: 1.14,
      echoDelay: 1.22, moveOvershoot: 1.92, rotationOvershoot: 2.72,
      scaleOvershoot: 2.18, idle: 1.56, pulse: 2.35,
    },
  };
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
  let renderedLineSlots = new Set();
  let motionIntensity = 'normal';

  function syncMotionIntensity() {
    const requested = document.body?.dataset?.lyricIntensity;
    const next = Object.prototype.hasOwnProperty.call(MIRROR_MOTION_PROFILES, requested)
      ? requested : 'normal';
    const changed = next !== motionIntensity;
    motionIntensity = next;
    return changed;
  }

  function motionProfile() {
    return MIRROR_MOTION_PROFILES[motionIntensity] || MIRROR_MOTION_PROFILES.normal;
  }

  function enableKongyuanFont() {
    if (!rootEl || !document.fonts?.load) return;
    document.fonts.load('32px "Kongyuan Sans L"', '\u93e1\u50cf').then((faces) => {
      if (!rootEl || !Array.isArray(faces) || faces.length === 0) return;
      rootEl.classList.add('mirror-kongyuan-ready');
      syncLayout();
    }).catch(() => {});
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function easeOutBack(progress, overshoot) {
    if (progress >= 1) return 1;
    const p = clamp01(progress) - 1;
    return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
  }

  function easeSingingPulse(progress) {
    const p = clamp01(progress);
    // Fast upward punch, then a slightly longer return to the original size.
    return p < 0.36
      ? Math.sin((p / 0.36) * Math.PI * 0.5)
      : Math.cos(((p - 0.36) / 0.64) * Math.PI * 0.5);
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
    const textChars = Array.from(text);
    const sourceWords = LyricMotion.ensureWordTimings(line, lines, index);
    const sourceGlyphs = [];
    sourceWords.forEach((word) => {
      LyricMotion.buildGraphemeTimings(word).forEach((glyph) => sourceGlyphs.push(glyph));
    });
    // Keep the timing map only when it still matches the rendered line exactly.
    // A malformed provider payload must degrade safely rather than make a glyph
    // pulse under a different character.
    const timingMatchesText = sourceGlyphs.length === textChars.length
      && sourceGlyphs.every((glyph, glyphIndex) => glyph.char === textChars[glyphIndex]);
    const hasNativeWordTimings = Array.isArray(line.words)
      && line.words.some((word) => Number.isFinite(word?.duration) && word.duration > 0);
    const lineStartMs = Number.isFinite(line.time) ? line.time : 0;
    const lineEnd = lineEndMs(lines, index);
    const fallbackGlyphs = LyricMotion.buildGraphemeTimings({
      text,
      startMs: lineStartMs,
      endMs: lineEnd,
    });
    return {
      index,
      text,
      mirrorText: mirrorText(text),
      startMs: lineStartMs,
      endMs: lineEnd,
      glyphTimings: timingMatchesText ? sourceGlyphs : fallbackGlyphs,
      timingSource: hasNativeWordTimings && timingMatchesText ? 'source' : 'fallback',
    };
  }

  function planDurationMs(plan) {
    return Math.max(500, (plan?.endMs || 0) - (plan?.startMs || 0));
  }

  function areLinesTemporallyClose(previousPlan, nextPlan) {
    if (!previousPlan || !nextPlan) return false;
    const interlineGap = Math.max(0, nextPlan.startMs - previousPlan.endMs);
    return interlineGap <= MAX_INTERLINE_GAP_MS;
  }

  function temporalBatchLimit(allPlans, start) {
    let count = 1;
    while (count < MAX_BATCH_SIZE && start + count < allPlans.length
      && areLinesTemporallyClose(allPlans[start + count - 1], allPlans[start + count])) {
      count += 1;
    }
    return count;
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
    // Preserve the previous preference not to strand one close line, but a
    // real timing break is explicitly allowed to become its own group.
    if (remaining - count === 1 && areLinesTemporallyClose(allPlans[start + count - 1], allPlans[start + count])) {
      return Number.POSITIVE_INFINITY;
    }

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

    if (averageChars >= 17) score += count === 2 ? -1.05 : (count === 4 ? 1.45 : (count === 1 ? 0.7 : 0.2));
    else if (averageChars <= 8) score += count === 4 ? -0.85 : (count === 2 ? 0.8 : 0.08);
    else score += count === 3 ? -0.35 : 0;
    if (count === 1 && temporalBatchLimit(allPlans, start) > 1) score += 3.4;
    if (count === previousCount) score += 0.38;

    const seed = batchSeed(batch, batchIndex) + start * 173 + count * 613;
    score += (LyricMotion.hashNoise(seed, 29) - 0.5) * 0.72;
    return score;
  }

  function chooseBatchSize(allPlans, start, batchIndex, previousCount) {
    const remaining = allPlans.length - start;
    const maxCount = Math.min(remaining, temporalBatchLimit(allPlans, start));
    if (maxCount === 1) return 1;
    let bestCount = Math.min(3, maxCount);
    let bestScore = Number.POSITIVE_INFINITY;
    for (let count = MIN_BATCH_SIZE; count <= maxCount; count += 1) {
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
      // A Japanese line's lead kanji must read as the visual focal point even
      // in a still frame.  Keep this deliberately well above the surrounding
      // Han scale; constrainLine() only scales the complete line, so it cannot
      // erase this relative hierarchy.
      if (japanese && isHanGlyph(char)) scale *= 1.56;
      else if (pureChinese) scale *= 1.13;
      else scale *= 1.18;
    } else if (japanese && isHanGlyph(char) && visibleLength(plan.text) <= 10) {
      // Supporting kanji are noticeable without competing with the focal one.
      scale *= 1.19;
    }

    const rotationRange = isAccent ? (side === 'echo' ? 7.5 : 6.2) : (side === 'echo' ? 5.2 : 4.0);
    const rotation = (noiseB - 0.5) * rotationRange * 2;
    const y = (noiseC - 0.5) * (isAccent ? 0.24 : 0.16);
    const x = (noiseA - 0.5) * 0.045;
    return { scale, rotation, x, y };
  }

  // Keep broad left-to-right assembly, while allowing a deterministic swap inside
  // each tiny local window. This makes a seek or OBS reload replay the same page.
  function buildAssemblyRanks(count, plan) {
    const ranks = new Array(count);
    const seed = (plan.batchIndex + 1) * 1409 + (plan.batchSlot + 1) * 431;
    for (let start = 0; start < count; start += 3) {
      const windowSize = Math.min(3, count - start);
      const order = Array.from({ length: windowSize }, (_, index) => index);
      const choice = LyricMotion.hashNoise(seed + start * 37, 71);
      if (windowSize === 2 && choice > 0.48) {
        [order[0], order[1]] = [order[1], order[0]];
      } else if (windowSize === 3) {
        if (choice < 0.34) [order[0], order[1]] = [order[1], order[0]];
        else if (choice < 0.68) [order[1], order[2]] = [order[2], order[1]];
      }
      order.forEach((rank, visualIndex) => {
        ranks[start + visualIndex] = start + rank;
      });
    }
    return ranks;
  }

  function glyphSingingPulsePlan(plan, side, glyphIndex, char) {
    if (isPunctuation(char)) return null;
    const glyphTiming = plan.glyphTimings?.[glyphIndex];
    if (!glyphTiming) return null;
    const timingStart = Math.max(plan.startMs, glyphTiming.startMs);
    const timingEnd = Math.max(timingStart, Math.min(plan.endMs, glyphTiming.endMs));
    const glyphDuration = timingEnd - timingStart;
    // The jump starts at the actual character timestamp, peaks quickly, and
    // returns before that character's highlight window has ended.
    const pulseDuration = Math.min(
      SING_PULSE_MAX_DURATION_MS,
      Math.max(SING_PULSE_MIN_DURATION_MS, glyphDuration * 0.72),
    );
    const profile = motionProfile();
    return {
      // The echo says the same lyric, so it uses precisely the same source
      // timestamp as the primary side.
      startOffset: timingStart - plan.startMs,
      duration: pulseDuration,
      amplitude: (side === 'echo' ? 0.14 : 0.17) * profile.pulse,
    };
  }

  function glyphAssemblyPlan(plan, side, glyphIndex, assemblyRank) {
    const isEcho = side === 'echo';
    const profile = motionProfile();
    const seed = (plan.batchIndex + 1) * 2081 + (plan.batchSlot + 1) * 613 + (glyphIndex + 1) * 131 + (isEcho ? 997 : 0);
    const noiseA = LyricMotion.hashNoise(seed, 13);
    const noiseB = LyricMotion.hashNoise(seed, 29);
    const noiseC = LyricMotion.hashNoise(seed, 43);
    const noiseD = LyricMotion.hashNoise(seed, 61);
    const noiseE = LyricMotion.hashNoise(seed, 79);
    const noiseF = LyricMotion.hashNoise(seed, 97);
    const noiseG = LyricMotion.hashNoise(seed, 109);
    const xSign = noiseA < 0.5 ? -1 : 1;
    const ySign = noiseB < 0.5 ? -1 : 1;
    const baseFromScale = (isEcho ? 0.80 : 0.84) + noiseA * (isEcho ? 0.30 : 0.22);
    return {
      fromX: xSign * ((isEcho ? 0.32 : 0.22) + noiseC * (isEcho ? 0.68 : 0.58)) * profile.travel,
      fromY: ySign * ((isEcho ? 0.20 : 0.14) + noiseD * (isEcho ? 0.46 : 0.34)) * profile.travel,
      // The reference rotates *into* position.  This must be strong enough to
      // read as a turn, not merely as the permanent handwritten tilt.
      fromRotation: (noiseE - 0.5) * (isEcho ? 58 : 42) * profile.spin,
      fromScale: 1 + (baseFromScale - 1) * profile.entryScale,
      startOffset: assemblyRank * LINE_ASSEMBLY_STEP_MS * profile.assemblyStep + noiseB * 12 + (isEcho ? ECHO_ASSEMBLY_DELAY_MS * profile.echoDelay : 0),
      duration: LINE_ASSEMBLY_MIN_DURATION_MS + noiseD * LINE_ASSEMBLY_DURATION_RANGE_MS,
      idle: {
        phase: noiseF * Math.PI * 2,
        periodMs: 1680 + noiseG * 1320,
        bobAmplitude: ((isEcho ? 0.018 : 0.024) + noiseC * (isEcho ? 0.016 : 0.022)) * profile.idle,
        swayAmplitude: (0.004 + noiseD * 0.009) * profile.idle,
        rotationAmplitude: ((isEcho ? 0.62 : 0.78) + noiseE * (isEcho ? 0.96 : 1.18)) * profile.idle,
        scaleAmplitude: (0.004 + noiseA * 0.011) * profile.idle,
      },
    };
  }

  function applyAssemblyFrame(entry, timeMs) {
    if (!entry) return;
    const profile = motionProfile();
    entry.assembly.forEach(({ glyph, motion }) => {
      const startMs = entry.lineStartMs + motion.startOffset;
      const progress = clamp01((timeMs - startMs) / motion.duration);
      // Arrival has independent position, rotation and scale curves.  The
      // overshoot is what makes a glyph land, rebound, then settle.
      const moveProgress = easeOutBack(progress, profile.moveOvershoot);
      const rotationProgress = easeOutBack(progress, profile.rotationOvershoot);
      const scaleProgress = easeOutBack(progress, profile.scaleOvershoot);
      const visibleProgress = clamp01(progress * 1.65);
      glyph.style.setProperty('--mirror-assembly-x', `${(motion.fromX * (1 - moveProgress)).toFixed(3)}em`);
      glyph.style.setProperty('--mirror-assembly-y', `${(motion.fromY * (1 - moveProgress)).toFixed(3)}em`);
      glyph.style.setProperty('--mirror-assembly-rotation', `${(motion.fromRotation * (1 - rotationProgress)).toFixed(2)}deg`);
      glyph.style.setProperty('--mirror-assembly-scale', (1 + (motion.fromScale - 1) * (1 - scaleProgress)).toFixed(3));
      glyph.style.setProperty('--mirror-assembly-opacity', (0.04 + visibleProgress * 0.96).toFixed(3));

      // This is a separate, permanent post-landing motion layer.  It starts
      // only after the back-out arrival is almost complete and is calculated
      // from absolute playback time, so it never drifts after a seek.
      const idleStartMs = startMs + motion.duration * 0.78;
      const idleStrength = clamp01((timeMs - idleStartMs) / IDLE_FADE_IN_MS);
      const phase = ((Math.max(0, timeMs - idleStartMs) % motion.idle.periodMs) / motion.idle.periodMs) * Math.PI * 2 + motion.idle.phase;
      const bob = Math.sin(phase) + 0.30 * Math.sin(phase * 2.17 + 0.65);
      const sway = Math.sin(phase * 0.83 + 1.1);
      const roll = Math.sin(phase * 0.71 - 0.45) + 0.22 * Math.sin(phase * 2.31);
      const breathe = Math.sin(phase * 1.19 + 0.25);
      glyph.style.setProperty('--mirror-idle-x', `${(sway * motion.idle.swayAmplitude * idleStrength).toFixed(3)}em`);
      glyph.style.setProperty('--mirror-idle-y', `${(bob * motion.idle.bobAmplitude * idleStrength).toFixed(3)}em`);
      glyph.style.setProperty('--mirror-idle-rotation', `${(roll * motion.idle.rotationAmplitude * idleStrength).toFixed(2)}deg`);
      glyph.style.setProperty('--mirror-idle-scale', (1 + breathe * motion.idle.scaleAmplitude * idleStrength).toFixed(3));

      const singingPulse = motion.singingPulse;
      if (!singingPulse) {
        glyph.style.setProperty('--mirror-sung-scale', '1');
        return;
      }
      // This uses the source lyric's glyph timestamp.  It deliberately does
      // not wait for entrance animation or serialize the line: KRC timing is
      // the authority for which character is currently being sung.
      const singingStartMs = entry.lineStartMs + singingPulse.startOffset;
      const singingProgress = (timeMs - singingStartMs) / singingPulse.duration;
      const singingScale = 1 + easeSingingPulse(singingProgress) * singingPulse.amplitude;
      glyph.style.setProperty('--mirror-sung-scale', singingScale.toFixed(3));
    });
  }

  function updateAssembly(timeMs) {
    renderedEntries.forEach((entry) => applyAssemblyFrame(entry, timeMs));
  }

  function createLine(plan, side, lineStartMs) {
    const line = document.createElement('div');
    line.className = `mirror-line mirror-line--${plan.lineRole} mirror-line--${side}`;
    line.dataset.slot = String(plan.batchSlot);
    line.style.setProperty('--mirror-line-scale', String(ROLE_SCALE[plan.lineRole] || ROLE_SCALE.medium));
    line.style.setProperty('--mirror-fit-scale', '1');
    line.style.setProperty('--mirror-compress-x', '1');

    const lineSeed = (plan.batchIndex + 1) * 577 + (plan.batchSlot + 1) * 139 + (side === 'echo' ? 89 : 0);
    const outwardShift = 0.35 + LyricMotion.hashNoise(lineSeed, 17) * 2.1;
    const lineRotation = (LyricMotion.hashNoise(lineSeed, 31) - 0.5) * (side === 'echo' ? 2.4 : 1.7);
    line.style.setProperty('--mirror-outward-shift', `${outwardShift.toFixed(2)}vw`);
    line.style.setProperty('--mirror-line-rotation', `${lineRotation.toFixed(2)}deg`);

    // line 本身維持 100% 寬只負責左右錨定；真正文字用自然寬度 wrapper 承載。
    // 不可旋轉整條 100% line，否則 1～2deg 就會把視覺外框甩出畫面／中央安全區。
    const content = document.createElement('span');
    content.className = 'mirror-line-content';
    line.appendChild(content);

    const text = side === 'echo' ? plan.mirrorText : plan.text;
    const chars = Array.from(text);
    const accentIndex = pickAccentGlyphIndex(text, plan, side);
    const assemblyRanks = buildAssemblyRanks(chars.length, plan);
    const assembly = [];
    chars.forEach((char, glyphIndex) => {
      const glyph = document.createElement('span');
      glyph.className = 'mirror-glyph';
      glyph.textContent = char;
      const visual = glyphVisual(plan, char, glyphIndex, side, accentIndex);
      glyph.style.setProperty('--mirror-glyph-scale', visual.scale.toFixed(3));
      glyph.style.setProperty('--mirror-glyph-rotation', `${visual.rotation.toFixed(2)}deg`);
      glyph.style.setProperty('--mirror-glyph-x', `${visual.x.toFixed(3)}em`);
      glyph.style.setProperty('--mirror-glyph-y', `${visual.y.toFixed(3)}em`);
      const motion = glyphAssemblyPlan(plan, side, glyphIndex, assemblyRanks[glyphIndex]);
      motion.singingPulse = glyphSingingPulsePlan(plan, side, glyphIndex, char);
      assembly.push({ glyph, motion });
      glyph.style.setProperty('--mirror-assembly-x', `${motion.fromX.toFixed(3)}em`);
      glyph.style.setProperty('--mirror-assembly-y', `${motion.fromY.toFixed(3)}em`);
      glyph.style.setProperty('--mirror-assembly-rotation', `${motion.fromRotation.toFixed(2)}deg`);
      glyph.style.setProperty('--mirror-assembly-scale', motion.fromScale.toFixed(3));
      glyph.style.setProperty('--mirror-assembly-opacity', '0.04');
      glyph.style.setProperty('--mirror-idle-x', '0em');
      glyph.style.setProperty('--mirror-idle-y', '0em');
      glyph.style.setProperty('--mirror-idle-rotation', '0deg');
      glyph.style.setProperty('--mirror-idle-scale', '1');
      glyph.style.setProperty('--mirror-sung-scale', '1');
      if (glyphIndex === accentIndex) glyph.classList.add('is-accent');
      content.appendChild(glyph);
    });

    line.dataset.mirrorTiming = plan.timingSource;

    return { plan, side, line, content, assembly, lineStartMs };
  }

  function contentBounds(entry) {
    if (!entry?.content) return null;
    const glyphs = Array.from(entry.content.children);
    if (!glyphs.length) return entry.content.getBoundingClientRect();
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    glyphs.forEach((glyph) => {
      const rect = glyph.getBoundingClientRect();
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    });
    if (![left, right, top, bottom].every(Number.isFinite)) return null;
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  function constrainLine(entry) {
    if (!entry?.line || !entry?.content) return;
    const panel = entry.side === 'echo' ? echoPanel : primaryPanel;
    if (!panel) return;

    const panelRect = panel.getBoundingClientRect();
    const panelStyle = window.getComputedStyle(panel);
    const paddingLeft = Number.parseFloat(panelStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(panelStyle.paddingRight) || 0;
    // 描邊、旋轉和字級放大都需要真實安全餘裕，不能剛好貼著 viewport / safe-zone 邊界。
    const edgeGuard = 8;
    const allowedLeft = panelRect.left + paddingLeft + edgeGuard;
    const allowedRight = panelRect.right - paddingRight - edgeGuard;
    const available = Math.max(1, allowedRight - allowedLeft);

    entry.line.style.setProperty('--mirror-fit-scale', '1');
    entry.line.style.setProperty('--mirror-compress-x', '1');
    for (let pass = 0; pass < 6; pass += 1) {
      const bounds = contentBounds(entry);
      if (!bounds || !Number.isFinite(bounds.width)) return;
      const fitsWidth = bounds.width <= available;
      const fitsLeft = bounds.left >= allowedLeft;
      const fitsRight = bounds.right <= allowedRight;
      if (fitsWidth && fitsLeft && fitsRight) return;

      const current = Number.parseFloat(entry.line.style.getPropertyValue('--mirror-fit-scale')) || 1;
      // 除了總寬，也把實際越界量算進縮放；這會涵蓋 glyph scale / rotation 後的真實 bbox。
      const overflowWidth = Math.max(bounds.width, bounds.right - allowedLeft, allowedRight - bounds.left);
      const ratio = Math.min(0.94, available / Math.max(1, overflowWidth));
      const next = Math.max(0.20, current * ratio * 0.975);
      entry.line.style.setProperty('--mirror-fit-scale', next.toFixed(3));
      if (next <= 0.2001) break;
    }

    // 極端長句 + 大安全框的最後保底：字級已經縮到底仍超寬時，只壓水平比例。
    // 不使用 overflow:hidden，也不把中央安全區當剪裁線。
    const finalBounds = contentBounds(entry);
    if (finalBounds && finalBounds.width > available) {
      const compress = Math.max(0.55, Math.min(1, available * 0.96 / finalBounds.width));
      entry.line.style.setProperty('--mirror-compress-x', compress.toFixed(3));
    }
  }

  function clearPanels() {
    if (primaryPanel) primaryPanel.replaceChildren();
    if (echoPanel) echoPanel.replaceChildren();
    renderedEntries = [];
    renderedLineSlots = new Set();
  }

  function mountLine(plan) {
    if (!plan || renderedLineSlots.has(plan.batchSlot)) return;
    const primary = createLine(plan, 'primary', plan.startMs);
    const echo = createLine(plan, 'echo', plan.startMs);
    primaryPanel.appendChild(primary.line);
    echoPanel.appendChild(echo.line);
    renderedEntries.push(primary, echo);
    renderedLineSlots.add(plan.batchSlot);
    constrainLine(primary);
    constrainLine(echo);
  }

  function mountStartedLines(batch, timeMs) {
    batch.forEach((plan) => {
      if (timeMs >= plan.startMs) mountLine(plan);
    });
  }

  function renderBatch(batchStart, timeMs) {
    clearPanels();
    if (batchStart < 0 || !plans[batchStart]) return;
    const batchCount = plans[batchStart].batchCount || 1;
    const batch = plans.slice(batchStart, batchStart + batchCount);
    const pageSeed = (plans[batchStart].batchIndex + 1) * 719;
    const pageShift = (LyricMotion.hashNoise(pageSeed, 59) - 0.5) * 6.5;
    primaryPanel.style.setProperty('--mirror-page-y', `${pageShift.toFixed(2)}vh`);
    echoPanel.style.setProperty('--mirror-page-y', `${(pageShift * 0.72).toFixed(2)}vh`);

    // Do not mount future lines.  Their glyphs must not exist until the line
    // starts, otherwise a lyric page reads as a permanently scattered draft.
    mountStartedLines(batch, timeMs);
    renderedEntries.forEach(constrainLine);
    updateAssembly(timeMs);
  }

  function syncLayout() {
    if (safeZoneGuide) safeZoneGuide.sync();
    renderedEntries.forEach((entry) => {
      entry.line.style.setProperty('--mirror-fit-scale', '1');
      entry.line.style.setProperty('--mirror-compress-x', '1');
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
    if (batchStart !== renderedBatchStart) {
      renderedBatchStart = batchStart;
      renderBatch(batchStart, timeMs);
      return;
    }
    const batchCount = plans[batchStart]?.batchCount || 1;
    mountStartedLines(plans.slice(batchStart, batchStart + batchCount), timeMs);
    updateAssembly(timeMs);
  }

  LyricTemplates.register({
    id: 'mirror',
    label: '虛實鏡書',

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
      syncMotionIntensity();
      enableKongyuanFont();
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
      if (syncMotionIntensity()) {
        plansForLines = null;
        renderedBatchStart = -999;
        clearPanels();
      }
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
