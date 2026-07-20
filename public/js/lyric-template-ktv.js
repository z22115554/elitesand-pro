/**
 * Elitesand Pro 排版模板：KTV 伴唱（台灣音圓/點將家風格，照使用者提供的實機影片＋回饋重現）
 *
 * v5.3 設計（完全時間驅動，不依賴 karaoke.js 的行索引，onFrame/onSeek 都只吃 timeMs 自算）：
 * - 邊界限制：每個「顯示單位」在目前字級下量測寬度，超過可用寬就依寬度貪婪切成多個延續單位
 *   （不是縮字，是像自然折行一樣續接到另一行——上一段唱完立刻接續下一段，同一句話跨兩行顯示）
 * - 上排永遠靠左錨定、下排永遠靠右錨定（CSS `left`/`right` 錨點各自 auto-width，
 *   不能用 text-align+固定寬度，否則掃色的像素會對錯座標——見程式內註解）
 * - 星星/圓形倒數：不是固定位置的獨立列，而是佔用「即將唱的那一行」原本的位置與字級，
 *   依行序輪替五個星星或五個圓形（不逐幀重擲），並用跟歌詞完全相同的
 *   transform 掃色手法呈現倒數（同一條管線，肉眼看起來就是「唱到哪個圖案哪個圖案就亮」）
 * - 間奏判斷：唱完一段後，若離下一段開始的間隔夠長（判定為間奏），停留一小段時間後，
 *   把已唱完那一行換成宣傳/提示文字（依序輪替），取代原本的「天韻製作」；
 *   全曲最後一段唱完後改顯示「來賓請掌聲鼓勵」
 *
 * 效能：純時間驅動 + 二分搜尋 + diff-write transform，逐幀不觸發文字重繪。
 * 依賴：LyricMotion（kernel）、LyricTemplates。不用 GSAP（換行瞬間替換，原機行為）。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof LyricMotion === 'undefined') {
    console.warn('[KTV] 依賴未載入，模板停用');
    return;
  }

  const { clamp } = LyricMotion;

  const GAP_LONG_MS = 6000;        // 唱完到下一段開始的間隔達此值才判定為「間奏」
  const PREVIEW_WINDOW_MS = 5000;  // 下一段開始前這麼久，才在「即將唱」的行位顯示東西
  const SWAP_MIN_HOLD_MS = 1200;   // 剛唱完的行至少全填色停留這麼久，才可能被間奏文字取代
  const FILLER_FULL_HOLD_MS = 2000; // 間奏文案在倒數前兩秒掃完，完整停留後才讓位
  const ENDING_DELAY_MS = 1500;    // 全曲最後一段唱完、停留多久後才換成「來賓請掌聲鼓勵」
  const FILLER_MESSAGES = [
    '《Elitesand Pro伴唱歡樂無限》',
    '《間奏請稍後》',
    '《下一段即將開始》',
  ];
  const COUNTDOWN_GLYPHS = ['★', '●'];
  const COUNTDOWN_ICON_COUNT = 5;
  const ENDING_MESSAGE = '《來賓請掌聲鼓勵》';

  let rootEl = null;
  let slots = null;   // { top: slotState, bottom: slotState }
  let colorsCache = { base: '#ffffff', fill: '#2e63f7' };

  let allUnits = [];
  let unitsBuiltForLines = null;
  let unitsBuiltForKey = '';
  let cachedCountdown = null; // { key, prep }
  // 每次 units 重建都遞增：setSlotContent 的 key 帶上這個號碼，確保「同一個 globalIndex
  // 但文字內容變了」（例如簡轉繁設定切換，lines 參照換了但單位順序沒變）會被視為新內容、
  // 強制重繪，而不是被 globalIndex 相同誤判成沒變而跳過（曾經踩過：切換簡轉繁後 KTV 畫面
  // 完全沒反應，直到換到下一句才「碰巧」用新文字重建）。
  let unitsGeneration = 0;
  function getCssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function refreshColors() {
    colorsCache.base = getCssVar('--lyric-color', '#ffffff');
    colorsCache.fill = getCssVar('--lyric-color-active', '#2e63f7');
  }

  function fontPxFromSettings() {
    const userPx = parseFloat(getCssVar('--display-font-size', '42')) || 42;
    const userScale = userPx / 42;
    const vw = (rootEl && rootEl.clientWidth) || window.innerWidth || 1280;
    return clamp(vw * 0.052 * userScale, 30, 76 * userScale);
  }

  /** 兩排共用的可用寬度（留左右各約 6% 邊界，配合 CSS 的 4% 錨點再加安全餘裕）。 */
  function slotAvailableWidth() {
    const vw = (rootEl && rootEl.clientWidth) || window.innerWidth || 1280;
    return vw * 0.88;
  }

  // ─── 顯示單位（unit）建構：整首歌詞攤平成一串「顯示單位」，
  // 每個單位是原始一行歌詞的完整內容，或超寬時依寬度切出的其中一段 ───

  function isLatinWordChar(ch) {
    return /[\p{Script=Latin}\p{Number}'’_-]/u.test(ch);
  }

  function isWhitespace(ch) {
    return /\s/u.test(ch);
  }

  function buildWrapTokens(chars) {
    const tokens = [];
    let i = 0;
    while (i < chars.length) {
      const ch = chars[i].char;
      const kind = isLatinWordChar(ch) ? 'word' : (isWhitespace(ch) ? 'space' : 'single');
      let end = i + 1;
      if (kind !== 'single') {
        while (end < chars.length) {
          const next = chars[end].char;
          if (kind === 'word' && !isLatinWordChar(next)) break;
          if (kind === 'space' && !isWhitespace(next)) break;
          end += 1;
        }
      }
      tokens.push({ start: i, end, kind });
      i = end;
    }
    return tokens;
  }

  function makeSegment(chars, offsets, start, end) {
    while (start < end && isWhitespace(chars[start].char)) start += 1;
    while (end > start && isWhitespace(chars[end - 1].char)) end -= 1;
    if (start >= end) return null;
    const segOffsets = offsets.slice(start, end + 1).map((v) => v - offsets[start]);
    return {
      chars: chars.slice(start, end),
      offsets: segOffsets,
      width: segOffsets[segOffsets.length - 1] || 0,
    };
  }

  function splitLongToken(chars, offsets, start, end, availableWidth) {
    const segments = [];
    let s = start;
    while (s < end) {
      let e = s + 1;
      while (e < end && offsets[e + 1] - offsets[s] <= availableWidth) e += 1;
      const seg = makeSegment(chars, offsets, s, e);
      if (seg) segments.push(seg);
      s = e;
    }
    return segments;
  }

  function splitLineByWidth(chars, offsets, availableWidth) {
    const tokens = buildWrapTokens(chars);
    const segments = [];
    let i = 0;
    while (i < tokens.length) {
      while (i < tokens.length && tokens[i].kind === 'space') i += 1;
      if (i >= tokens.length) break;

      const start = tokens[i].start;
      let end = tokens[i].end;
      if (offsets[end] - offsets[start] > availableWidth) {
        segments.push(...splitLongToken(chars, offsets, start, end, availableWidth));
        i += 1;
        continue;
      }

      let j = i + 1;
      while (j < tokens.length) {
        const candidateEnd = tokens[j].end;
        if (offsets[candidateEnd] - offsets[start] > availableWidth) break;
        end = candidateEnd;
        j += 1;
      }

      const seg = makeSegment(chars, offsets, start, end);
      if (seg) segments.push(seg);
      i = j;
    }
    return segments;
  }

  /**
   * 把整首歌詞攤平成顯示單位陣列，每個單位含逐字時間（沿用 kernel 的偽詞/逐字時間）。
   * 全部單位依開始時間嚴格遞增排列，globalIndex 的奇偶決定要顯示在哪一排
   * （上/下排交替；一行被切成多段時，段與段之間銜接時間幾乎為 0，
   * 交替邏輯自然讓它們連續出現在兩排，效果就是「續接到下一排」）。
   */
  function buildAllUnits(lines, fontPx, availableWidth) {
    const family = getCssVar('--display-font-family', 'sans-serif');
    const units = [];
    for (let li = 0; li < lines.length; li += 1) {
      const line = lines[li];
      if (!line || !line.text) continue;
      const words = LyricMotion.ensureWordTimings(line, lines, li);
      const chars = [];
      for (const w of words) {
        for (const g of LyricMotion.buildGraphemeTimings(w)) chars.push(g);
      }
      if (chars.length === 0) continue;

      const text = chars.map((c) => c.char).join('');
      const offsets = LyricMotion.measureCharOffsets(text, `900 ${fontPx}px ${family}`);
      const fullWidth = offsets[offsets.length - 1] || 0;

      let segments;
      if (fullWidth <= availableWidth) {
        segments = [{ chars, offsets, width: fullWidth }];
      } else {
        // 邊界限制：英文/數字先保留整個單字，只有單字本身超寬才退回字元切段。
        segments = splitLineByWidth(chars, offsets, availableWidth);
      }

      for (const seg of segments) {
        units.push({
          lineIndex: li,
          text: seg.chars.map((c) => c.char).join(''),
          chars: seg.chars,
          offsets: seg.offsets,
          scanTimes: buildScanTimes(seg.chars),
          width: seg.width,
          fontPx,
          startMs: seg.chars[0].startMs,
          endMs: seg.chars[seg.chars.length - 1].endMs,
        });
      }
    }
    units.forEach((u, i) => { u.globalIndex = i; });
    return units;
  }

  /**
   * Facet 逐字換色以每個字的來源起點為準。KTV 的掃色也以同一組節點前進：
   * 若來源在兩個字之間有空拍，延長前一字的掃色至下一字開始，而不是停在字縫後
   * 突然追趕。這讓下一字仍準時開始，同時保留一條連續、單調的掃色路徑。
   */
  function buildScanTimes(chars) {
    if (!chars || chars.length === 0) return [];
    const times = [chars[0].startMs];
    for (let i = 1; i < chars.length; i += 1) {
      const previous = chars[i - 1];
      const current = chars[i];
      times.push(Math.max(previous.endMs, current.startMs, times[times.length - 1]));
    }
    times.push(Math.max(chars[chars.length - 1].endMs, times[times.length - 1]));
    return times;
  }

  function ensureUnits(lines) {
    const fontPx = fontPxFromSettings();
    const avail = Math.round(slotAvailableWidth() / 10) * 10;
    const family = getCssVar('--display-font-family', 'sans-serif');
    const key = `${fontPx.toFixed(1)}|${avail}|${family}`;
    if (unitsBuiltForLines === lines && unitsBuiltForKey === key) return allUnits;
    allUnits = buildAllUnits(lines, fontPx, avail);
    unitsBuiltForLines = lines;
    unitsBuiltForKey = key;
    unitsGeneration += 1;
    return allUnits;
  }

  function findUnitIndexAtOrBefore(units, timeMs) {
    let lo = 0; let hi = units.length - 1; let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (units[mid].startMs <= timeMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function slotKeyForUnit(globalIndex) {
    return globalIndex % 2 === 0 ? 'top' : 'bottom';
  }

  /**
   * 目前時間對應的掃色像素位置。
   *
   * 在來源逐字節點間做線性掃色。每個字都在與 Facet 相同的來源起點開始，字間
   * 空拍則被吸收到前一字的掃色窗，避免舊版「停住再追趕」的感覺。
   */
  function fillPixels(unit, timeMs) {
    const times = unit.scanTimes;
    if (!times || times.length < 2 || timeMs <= times[0]) return 0;
    const lastIndex = times.length - 1;
    if (timeMs >= times[lastIndex]) return unit.width;

    let lo = 0;
    let hi = lastIndex - 1;
    let charIndex = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= timeMs) {
        charIndex = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const startMs = times[charIndex];
    const endMs = times[charIndex + 1];
    const progress = clamp((timeMs - startMs) / Math.max(endMs - startMs, 1), 0, 1);
    const fromPx = unit.offsets[charIndex] || 0;
    const toPx = unit.offsets[charIndex + 1] || unit.width;
    return fromPx + (toPx - fromPx) * progress;
  }

  // ─── DOM ───

  function buildSlotDom(pos) {
    const el = document.createElement('div');
    el.className = `ktv-slot ktv-slot-${pos}`;
    const base = document.createElement('div');
    base.className = 'ktv-base';
    const fillWindow = document.createElement('div');
    fillWindow.className = 'ktv-fill-window';
    const fill = document.createElement('div');
    fill.className = 'ktv-fill';
    el.appendChild(base);
    fillWindow.appendChild(fill);
    el.appendChild(fillWindow);
    rootEl.appendChild(el);
    return { el, base, fillWindow, fill, key: '', prep: null, lastFill: '', maxFillPx: 0 };
  }

  /**
   * 設定一個行位要顯示的內容（key 相同就跳過，避免不必要的 DOM 寫入）。
   * key 一律內部加上 unitsGeneration 前綴：globalIndex 相同不代表文字內容相同
   * （例如簡轉繁設定切換後 units 整批重建，同一個 globalIndex 現在可能對到不同語言版本
   * 的文字），沒有這個前綴呼叫端一律用 globalIndex 當 key 會被誤判成「沒變」而漏更新。
   */
  function setSlotContent(slot, rawKey, prep) {
    const key = `${unitsGeneration}:${rawKey}`;
    if (slot.key === key) return;
    refreshColors();
    slot.key = key;
    slot.prep = prep;
    slot.el.style.fontSize = `${prep.fontPx.toFixed(1)}px`;
    slot.base.textContent = prep.text;
    slot.fill.textContent = prep.text;
    slot.fill.style.color = colorsCache.fill;
    slot.base.style.color = colorsCache.base;
    slot.lastFill = '';
    slot.maxFillPx = 0;
  }

  function clearSlot(slot) {
    if (slot.key === '') return;
    slot.key = '';
    slot.prep = null;
    slot.base.textContent = '';
    slot.fill.textContent = '';
    slot.fillWindow.style.transform = 'scaleX(0)';
    slot.fill.style.transform = 'scaleX(1)';
    slot.lastFill = '';
    slot.maxFillPx = 0;
  }

  function applyFill(slot, px, seeking = false) {
    if (!slot.prep) return;
    const requestedPx = clamp(px, 0, slot.prep.width);
    // 播放時音訊時鐘偶爾有很小的逆向校正；所有 KTV 掃色（含間奏與倒數）都不應回彈。
    // 明確 seek 才允許回跳，讓拖曳進度仍精準。
    const stablePx = seeking ? requestedPx : Math.max(requestedPx, slot.maxFillPx || 0);
    slot.maxFillPx = stablePx;
    const ratio = clamp(stablePx / Math.max(slot.prep.width, 1), 0, 1);
    // 外層縮小可視窗口、內層用倒數縮放抵銷字形變形；兩者皆可由合成器處理。
    // 最小以一個實體像素為準，避免起唱第一幀出現無意義的超大倒數縮放。
    const visibleRatio = ratio <= 0 ? 0 : Math.max(ratio, 1 / Math.max(slot.prep.width, 1));
    const fillKey = `${visibleRatio.toFixed(6)}`;
    if (fillKey !== slot.lastFill) {
      slot.fillWindow.style.transform = `scaleX(${visibleRatio})`;
      slot.fill.style.transform = `scaleX(${visibleRatio > 0 ? 1 / visibleRatio : 1})`;
      slot.lastFill = fillKey;
    }
  }

  function buildStaticPrep(text) {
    const fontPx = fontPxFromSettings();
    const family = getCssVar('--display-font-family', 'sans-serif');
    const offsets = LyricMotion.measureCharOffsets(text, `900 ${fontPx}px ${family}`);
    return { text, offsets, width: offsets[offsets.length - 1] || 0, fontPx };
  }

  /** 倒數圖案：★/● 隨機挑（同一次出現固定組合，不逐幀重擲），字級跟歌詞一致。 */
  function getCountdownPrep(unit) {
    const fontPx = fontPxFromSettings();
    const key = `${unit.globalIndex}|${fontPx.toFixed(1)}`;
    if (cachedCountdown && cachedCountdown.key === key) return cachedCountdown.prep;
    const family = getCssVar('--display-font-family', 'sans-serif');
    const glyph = COUNTDOWN_GLYPHS[Math.abs(unit.globalIndex) % COUNTDOWN_GLYPHS.length];
    const text = Array.from({ length: COUNTDOWN_ICON_COUNT }, () => glyph).join(' ');
    const offsets = LyricMotion.measureCharOffsets(text, `900 ${fontPx}px ${family}`);
    const prep = { text, offsets, width: offsets[offsets.length - 1] || 0, fontPx };
    cachedCountdown = { key, prep };
    return prep;
  }

  // ─── 各種內容的渲染 ───

  function showActiveScan(slot, unit, timeMs, seeking) {
    setSlotContent(slot, `u${unit.globalIndex}`, unit);
    applyFill(slot, fillPixels(unit, timeMs), seeking);
  }

  function showHeldFull(slot, unit) {
    setSlotContent(slot, `u${unit.globalIndex}`, unit);
    applyFill(slot, slot.prep ? slot.prep.width : unit.width);
  }

  function showPreview(slot, unit) {
    setSlotContent(slot, `p${unit.globalIndex}`, unit);
    applyFill(slot, 0);
  }

  function showCountdown(slot, unit, frac, seeking) {
    const prep = getCountdownPrep(unit);
    setSlotContent(slot, `c${unit.globalIndex}`, prep);
    applyFill(slot, prep.width * clamp(frac, 0, 1), seeking);
  }

  function showFiller(slot, occurrenceKey, timeMs, sweepStartMs, sweepEndMs, seeking) {
    // 依歌詞中的出現順序輪替，長歌不會剛好一直抽到同一則文案。
    const messageIndex = occurrenceKey === 'intro'
      ? 0
      : Math.abs(occurrenceKey) % FILLER_MESSAGES.length;
    const text = FILLER_MESSAGES[messageIndex];
    const prep = buildStaticPrep(text);
    setSlotContent(slot, `f${occurrenceKey}`, prep);
    // 間奏文字有自己的穩定掃色，掃完後停留完整內容；倒數另起一個階段。
    const sweepMs = Math.max(sweepEndMs - sweepStartMs, 1);
    const frac = clamp((timeMs - sweepStartMs) / sweepMs, 0, 1);
    applyFill(slot, prep.width * frac, seeking);
  }

  function showEnding(slot) {
    const prep = buildStaticPrep(ENDING_MESSAGE);
    setSlotContent(slot, 'ending', prep);
    applyFill(slot, prep.width);
  }

  // ─── 逐幀主邏輯：純粹由 timeMs + units 推導，兩排各自獨立判斷 ───

  function computeAndRender(timeMs, lines, seeking = false) {
    if (!rootEl || !slots) return;
    const units = ensureUnits(lines);
    if (units.length === 0) { clearSlot(slots.top); clearSlot(slots.bottom); return; }

    const idx = findUnitIndexAtOrBefore(units, timeMs);
    const curUnit = idx >= 0 ? units[idx] : null;
    const nextIdx = idx >= 0 ? (idx + 1 < units.length ? idx + 1 : -1) : (units.length > 0 ? 0 : -1);
    const nextUnit = nextIdx >= 0 ? units[nextIdx] : null;

    const nextSlotKey = nextUnit ? slotKeyForUnit(nextIdx) : null;
    const curSlotKey = curUnit ? slotKeyForUnit(idx) : (nextSlotKey === 'top' ? 'bottom' : 'top');
    const resolvedNextSlotKey = nextSlotKey || (curSlotKey === 'top' ? 'bottom' : 'top');

    // ── 「目前/剛唱完」那一排 ──
    const curSlot = slots[curSlotKey];
    if (!curUnit) {
      // 前奏：離第一段還很久才判定為間奏，顯示提示文字
      if (nextUnit && nextUnit.startMs >= GAP_LONG_MS) {
        const countdownStart = nextUnit.startMs - PREVIEW_WINDOW_MS;
        const fillerSweepEnd = countdownStart - FILLER_FULL_HOLD_MS;
        if (fillerSweepEnd > 0 && timeMs < countdownStart) {
          showFiller(curSlot, 'intro', timeMs, 0, fillerSweepEnd, seeking);
        } else if (timeMs < nextUnit.startMs) {
          const frac = (timeMs - countdownStart) / PREVIEW_WINDOW_MS;
          showCountdown(curSlot, nextUnit, frac, seeking);
        } else clearSlot(curSlot);
      } else {
        clearSlot(curSlot);
      }
    } else if (timeMs <= curUnit.endMs) {
      showActiveScan(curSlot, curUnit, timeMs, seeking);
    } else if (!nextUnit) {
      // 全曲最後一段：唱完停留一下，之後改顯示謝幕語
      if (timeMs <= curUnit.endMs + SWAP_MIN_HOLD_MS + ENDING_DELAY_MS) {
        showHeldFull(curSlot, curUnit);
      } else {
        showEnding(curSlot);
      }
    } else if (nextUnit.startMs - curUnit.endMs >= GAP_LONG_MS) {
      // 先讓已唱行短暫停留；間奏文案沿可用時間慢掃，倒數前兩秒掃完並完整停留。
      // 若空檔放不下這三段，不硬塞間奏文字，只保留已唱行直到倒數接手。
      const countdownStart = nextUnit.startMs - PREVIEW_WINDOW_MS;
      const fillerStart = curUnit.endMs + SWAP_MIN_HOLD_MS;
      const fillerSweepEnd = countdownStart - FILLER_FULL_HOLD_MS;
      if (timeMs >= countdownStart) {
        const frac = (timeMs - countdownStart) / PREVIEW_WINDOW_MS;
        showCountdown(curSlot, nextUnit, frac, seeking);
      }
      else if (timeMs < fillerStart || fillerSweepEnd <= fillerStart) showHeldFull(curSlot, curUnit);
      else {
        showFiller(curSlot, curUnit.globalIndex, timeMs, fillerStart, fillerSweepEnd, seeking);
      }
    } else if (timeMs <= curUnit.endMs + SWAP_MIN_HOLD_MS) {
      showHeldFull(curSlot, curUnit);
    } else {
      showHeldFull(curSlot, curUnit);
    }

    // ── 「即將唱」那一排 ──
    const nextSlot = slots[resolvedNextSlotKey];
    if (!nextUnit) {
      clearSlot(nextSlot);
    } else {
      const untilStart = nextUnit.startMs - timeMs;
      if (untilStart > PREVIEW_WINDOW_MS) {
        clearSlot(nextSlot);
      } else {
        // 音圓式交棒：間奏那排切成五格倒數，下一句則在自己的行位先亮相。
        // 起唱時下一句留在原位直接開始掃色，不會延遲到第一個字才突然出現。
        showPreview(nextSlot, nextUnit);
      }
    }
  }

  // ─── 模板註冊 ───

  LyricTemplates.register({
    id: 'ktv',
    label: '霓彩伴唱',

    mount(container, ctx) {
      refreshColors();
      rootEl = document.createElement('div');
      rootEl.id = 'ktv-root';
      container.appendChild(rootEl);
      slots = { top: buildSlotDom('top'), bottom: buildSlotDom('bottom') };
      unitsBuiltForLines = null;
      cachedCountdown = null;
    },

    destroy() {
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null; slots = null; allUnits = []; unitsBuiltForLines = null; cachedCountdown = null;
    },

    onLyricsLoaded(lines, ctx) {
      unitsBuiltForLines = null; // 強制重建（新歌／字級可能不同）
      if (slots) { clearSlot(slots.top); clearSlot(slots.bottom); }
    },

    onSeek(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics(), true);
    },

    onFrame(timeMs, ctx) {
      computeAndRender(timeMs, ctx.getLyrics());
    },
  });
})();
