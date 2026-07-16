/**
 * Elitesand Pro 歌詞動畫共用內核 (Motion Kernel)
 *
 * 給多個排版模板（見 lyric-template-registry.js）共用的純工具函式：
 * 臨界阻尼彈簧、平滑曲線、離線文字測量（含快取）、三態語義、renderEndTime。
 * 不依賴任何模板或 karaoke.js 的內部狀態。
 */
const LyricMotion = (() => {
  // ─── 臨界阻尼彈簧（semi-implicit Euler）───
  // 用於捲軸類模板的位置/縮放平滑追蹤：換行只需 setTarget，逐幀 step() 會自然收斂，
  // 中途換目標也會保留速度（連續切行不頓挫）。
  class Spring {
    constructor(value = 0, { stiffness = 142, damping = 28, mass = 0.82 } = {}) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.stiffness = stiffness;
      this.damping = damping;
      this.mass = mass;
    }

    setTarget(t) {
      this.target = t;
    }

    /**
     * 推進一步。dt 上限 0.05s：OBS 分頁非作用時 rAF 會被節流，
     * 若不 clamp，長 dt 會讓彈簧一步暴衝甚至數值不穩定。
     * @returns {boolean} 是否已收斂到目標（可用來判斷是否還需要繼續 step）
     */
    step(dtSec) {
      const dt = Math.min(Math.max(dtSec, 0), 0.05);
      if (dt === 0) return this._isSettled();

      const displacement = this.value - this.target;
      const springForce = -this.stiffness * displacement;
      const dampingForce = -this.damping * this.velocity;
      const accel = (springForce + dampingForce) / this.mass;

      this.velocity += accel * dt;
      this.value += this.velocity * dt;

      if (this._isSettled()) {
        this.value = this.target;
        this.velocity = 0;
        return true;
      }
      return false;
    }

    _isSettled() {
      return Math.abs(this.value - this.target) < 0.1 && Math.abs(this.velocity) < 0.1;
    }

    /** 直接跳到目標值（fastMode/拖曳進度條用，跳過物理過程）。*/
    snap(t) {
      if (t !== undefined) this.target = t;
      this.value = this.target;
      this.velocity = 0;
    }
  }

  // ─── 平滑曲線 ───
  function smoothstep(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // ─── 離線文字測量（canvas 2d，含 LRU 快取）───
  let measureCanvas = null;
  let measureCtx = null;
  const MEASURE_CACHE_LIMIT = 500;
  const measureCache = new Map();

  function getMeasureCtx() {
    if (!measureCtx) {
      measureCanvas = document.createElement('canvas');
      measureCtx = measureCanvas.getContext('2d');
    }
    return measureCtx;
  }

  /**
   * 量測一段文字，逐字累積寬度陣列：[0, w(c1), w(c1c2), ...]。
   * 用於 KTV 掃色遮罩依「字素」而非「整詞」定位邊緣。
   * @param {string} text
   * @param {string} fontSpec - 如 '600 42px "Noto Sans TC"'
   * @returns {number[]} 累積寬度陣列，長度 = 字元數 + 1
   */
  function measureCharOffsets(text, fontSpec) {
    if (!text) return [0];
    const cacheKey = fontSpec + '\u0000' + text;
    const cached = measureCache.get(cacheKey);
    if (cached) {
      // LRU：命中時移到 Map 尾端
      measureCache.delete(cacheKey);
      measureCache.set(cacheKey, cached);
      return cached;
    }

    const ctx = getMeasureCtx();
    ctx.font = fontSpec;
    const chars = Array.from(text);
    const offsets = new Array(chars.length + 1).fill(0);
    let acc = 0;
    for (let i = 0; i < chars.length; i += 1) {
      acc += ctx.measureText(chars[i]).width;
      offsets[i + 1] = acc;
    }

    measureCache.set(cacheKey, offsets);
    if (measureCache.size > MEASURE_CACHE_LIMIT) {
      const oldestKey = measureCache.keys().next().value;
      measureCache.delete(oldestKey);
    }
    return offsets;
  }

  // ─── 三相語義：pending（未唱）/ live（唱到）/ done（唱過）───
  /**
   * 依時間窗判斷一個單位（行/塊/詞）目前的相位。
   * @param {number} timeMs - 目前時間
   * @param {number} startMs - 單位起點
   * @param {number} endMs - 單位終點
   * @param {number} [leadMs=0] - 提前量（提早多少毫秒視為 live）
   * @returns {'pending'|'live'|'done'}
   */
  function phaseOf(timeMs, startMs, endMs, leadMs = 0) {
    if (timeMs > endMs) return 'done';
    if (timeMs >= startMs - leadMs) return 'live';
    return 'pending';
  }

  // 餘暉：唱完後動畫（發光/漂移）允許再駐留多久（毫秒）
  const AFTERGLOW_MS = 880;

  // ═══════════════════════════════════════════
  // 行節奏模型（lineTempo）——連續模型，不分檔位。
  // 設計：以 pace（0=一閃而過的極短行，1=從容的長行）為唯一自變數，
  // 所有時長都是 base + range × smoothstep(pace) 的連續函數；
  // 只保留兩個布林開關（snapReveal / softEntry）給「結構上做不做」的判斷。
  // 極短行的視覺目標與舊版相同（不閃爍、瞬間點亮），但推導方式完全不同。
  // ═══════════════════════════════════════════

  const PACE_FULL_MS = 1500;   // 行時長達此值即視為 pace=1（充分從容）
  const SNAP_REVEAL_MS = 140;  // 行時長低於此：逐字動畫沒有意義，瞬間點亮
  const SOFT_ENTRY_MS = 280;   // 行時長低於此：跳過完整行進場（避免進場吃掉演唱時間）

  /**
   * 一行歌詞的節奏參數。時間單位一律毫秒。
   * @param {Array<{time:number, duration?:number}>} lines
   * @param {number} i
   * @returns {{ durMs, pace, snapReveal, softEntry, entryMs, exitMs, revealLeadMs, windowEndMs }}
   */
  function lineTempo(lines, i) {
    const line = lines[i];
    const next = lines[i + 1];
    const endMs = line.duration ? line.time + line.duration : (next ? next.time : line.time + 5000);
    const durMs = Math.max(endMs - line.time, 0);
    const pace = smoothstep(durMs / PACE_FULL_MS);

    const snapReveal = durMs < SNAP_REVEAL_MS;
    const softEntry = durMs >= SOFT_ENTRY_MS;

    // 進/出場時長：短行自動變短（連續縮放，無檔位跳變）
    const entryMs = softEntry ? Math.round(150 + 260 * pace) : Math.round(40 + 50 * pace);
    const exitMs = Math.round(70 + 190 * pace);
    // 逐字提前量：行越從容，詞可以越早開始起身
    const revealLeadMs = snapReveal ? 0 : Math.round(35 + 125 * pace);

    // 這一行最晚可以佔用畫面到什麼時候（餘暉窗口；被下一行起點截斷）
    const proposedEnd = endMs + exitMs + Math.round(AFTERGLOW_MS * (0.35 + 0.65 * pace));
    const windowEndMs = next ? Math.min(proposedEnd, next.time) : proposedEnd;

    return { durMs, pace, snapReveal, softEntry, entryMs, exitMs, revealLeadMs, windowEndMs };
  }

  // ═══════════════════════════════════════════
  // v5：詞層資料準備（folia 系模板都是「詞驅動」的）
  // ═══════════════════════════════════════════

  const CJK_RE = /[一-鿿぀-ヿ가-힯]/;
  const PUNCT_RE = /^[、。，．,.!?！？；;：:…・'"「」『』()（）\s]+$/;

  /**
   * 把一段文字切成偽詞 token：CJK 逐字成詞、連續拉丁/數字聚成一詞、
   * 空白黏前一詞尾（保留原文間距，讓 Intl.Segmenter 分詞能看到英文單字邊界）、標點黏前一詞。
   */
  function tokenizeLineText(text) {
    const tokens = [];
    let latinBuf = '';
    for (const ch of Array.from(text || '')) {
      if (/\s/.test(ch)) {
        if (latinBuf) { tokens.push(latinBuf); latinBuf = ''; }
        if (tokens.length > 0) tokens[tokens.length - 1] += ch;
      } else if (CJK_RE.test(ch)) {
        if (latinBuf) { tokens.push(latinBuf); latinBuf = ''; }
        tokens.push(ch);
      } else if (PUNCT_RE.test(ch)) {
        if (latinBuf) { tokens.push(latinBuf); latinBuf = ''; }
        if (tokens.length > 0) tokens[tokens.length - 1] += ch;
        else tokens.push(ch);
      } else {
        latinBuf += ch;
      }
    }
    if (latinBuf) tokens.push(latinBuf);
    return tokens;
  }

  /** 把一段時間窗平均分給 tokens，產生偽詞時間。 */
  function distributeTokens(tokens, startMs, endMs) {
    const n = Math.max(tokens.length, 1);
    const per = Math.max(endMs - startMs, 0) / n;
    return tokens.map((text, idx) => ({
      text,
      startMs: startMs + per * idx,
      endMs: idx === n - 1 ? endMs : startMs + per * (idx + 1),
    }));
  }

  /**
   * 確保一行有可用的 word 時間資料。回傳統一格式：[{ text, startMs, endMs }]（絕對毫秒），
   * 結果快取在 line._kWords。
   * - KRC 原生 words（{text,start,duration} 相對毫秒）正規化後使用；但若某個 word 本身
   *   含多個語言單位（整句包成一個 word 的「退化 KRC」——實務上很多來源的 enhanced LRC
   *   只有行級時間卻標成逐字格式），把該 word 的時間窗再切偽詞平均分配，
   *   否則下游會把整句當成一個原子詞（不分詞、不換行、衝出畫面）。
   * - LRC/txt 無 words → 整行切偽詞、行時長平均分配。
   */
  function ensureWordTimings(line, lines, i) {
    if (line._kWords) return line._kWords;

    let words;
    if (Array.isArray(line.words) && line.words.length > 0) {
      words = [];
      for (const w of line.words) {
        const startMs = line.time + (w.start || 0);
        const endMs = startMs + (w.duration || 0);
        const tokens = tokenizeLineText(w.text);
        if (tokens.length <= 1) {
          words.push({ text: w.text, startMs, endMs });
        } else {
          words.push(...distributeTokens(tokens, startMs, endMs));
        }
      }
    } else {
      const next = lines[i + 1];
      const lineEndMs = next ? next.time : line.time + 5000;
      const totalMs = Math.max(lineEndMs - line.time, 300);
      words = distributeTokens(tokenizeLineText(line.text), line.time, line.time + totalMs);
    }

    line._kWords = words;
    return words;
  }

  /**
   * 逐字素時間：把一個詞的時長平均分給每個字素。
   * @param {{text:string,startMs:number,endMs:number}} word
   * @returns {Array<{char:string,startMs:number,endMs:number}>}
   */
  function buildGraphemeTimings(word) {
    const chars = Array.from(word.text);
    if (chars.length === 0) return [];
    const dur = Math.max(word.endMs - word.startMs, 0);
    const per = dur / chars.length;
    return chars.map((char, idx) => ({
      char,
      startMs: word.startMs + per * idx,
      endMs: idx === chars.length - 1 ? word.endMs : word.startMs + per * (idx + 1),
    }));
  }

  /**
   * 顯示詞分組（v5.1 語義分詞版）。
   * 主路徑：用 Intl.Segmenter（word granularity）對整行做語義分詞（「我們」「不會」而非
   * 固定 3 字硬湊），再把分詞邊界對回帶時間的 word 碎片；一個帶時間的碎片橫跨兩個語義段時
   * 併段（絕不切開任何有時間的碎片）；標點/空白段黏附前段。
   * 退路（無 Segmenter 環境）：舊的「相鄰 CJK 聚 2–4 字塊」湊塊法。
   * @param {Array<{text,startMs,endMs}>} words - ensureWordTimings 的輸出
   * @returns {Array<{text,startMs,endMs,graphemes:Array<{char,startMs,endMs}>}>}
   */
  function buildDisplayWords(words) {
    if (!words || words.length === 0) return [];
    const semantic = buildSemanticGroups(words);
    if (semantic) return semantic;
    return buildChunkedGroups(words);
  }

  /** 語義分詞主路徑。回傳 null 表示環境不支援，呼叫端走湊塊退路。 */
  function buildSemanticGroups(words) {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
    let segs;
    try {
      const fullText = words.map((w) => w.text).join('');
      segs = Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(fullText));
    } catch (e) { return null; }
    if (segs.length === 0) return null;

    // 每個 word 碎片在 fullText 的 [start,end) 碼元範圍
    const ranges = [];
    let cursor = 0;
    for (const w of words) {
      ranges.push({ start: cursor, end: cursor + w.text.length, word: w });
      cursor += w.text.length;
    }

    const groups = []; // 每組 = { wordIdxs:Set-like 連續範圍 [from,to] , wordLike:boolean }
    let wordCursor = 0;
    for (const seg of segs) {
      const segStart = seg.index;
      const segEnd = seg.index + seg.segment.length;
      // 收集與本語義段重疊的 word 碎片
      const covered = [];
      while (wordCursor < ranges.length && ranges[wordCursor].start < segEnd) {
        if (ranges[wordCursor].end <= segStart) { wordCursor += 1; continue; }
        covered.push(wordCursor);
        if (ranges[wordCursor].end <= segEnd) wordCursor += 1;
        else break; // 這個碎片跨進下一段：留給下一段判斷（會觸發併段）
      }
      if (covered.length === 0) continue;

      const prev = groups[groups.length - 1];
      const isAttach = !seg.isWordLike; // 空白/標點段：黏附前段
      const straddles = prev && covered[0] <= prev.to; // 首碎片已屬前段 → 該碎片橫跨兩段，併段

      if (prev && (isAttach || straddles)) {
        prev.to = Math.max(prev.to, covered[covered.length - 1]);
      } else {
        groups.push({ from: covered[0], to: covered[covered.length - 1] });
      }
    }
    if (groups.length === 0) return null;
    // 尾端未被任何段覆蓋的碎片（理論上不會發生）補進最後一組
    const lastGroup = groups[groups.length - 1];
    if (lastGroup.to < words.length - 1) lastGroup.to = words.length - 1;

    return groups.map((g) => {
      const slice = words.slice(g.from, g.to + 1);
      const graphemes = [];
      for (const w of slice) graphemes.push(...buildGraphemeTimings(w));
      return {
        text: slice.map((w) => w.text).join(''),
        startMs: slice[0].startMs,
        endMs: slice[slice.length - 1].endMs,
        graphemes,
      };
    });
  }

  /** 湊塊退路：相鄰 CJK 聚 2–4 字塊、標點黏附前塊、拉丁詞保持原樣。 */
  function buildChunkedGroups(words) {
    const groups = [];
    let current = null;
    const CHUNK_MAX = 3; // CJK 塊目標大小（2–4 之間取 3 為主）

    const flush = () => { if (current) { groups.push(current); current = null; } };
    const cjkLen = (g) => Array.from(g.text).filter((c) => CJK_RE.test(c)).length;

    for (const w of words) {
      const isPunct = PUNCT_RE.test(w.text);
      const isCjk = CJK_RE.test(w.text) && Array.from(w.text.trim()).length <= 2;

      if (isPunct && current) {
        current.text += w.text;
        current.endMs = Math.max(current.endMs, w.endMs);
        current.graphemes.push(...buildGraphemeTimings(w));
      } else if (isCjk) {
        if (current && current._cjk && cjkLen(current) < CHUNK_MAX) {
          current.text += w.text;
          current.endMs = Math.max(current.endMs, w.endMs);
          current.graphemes.push(...buildGraphemeTimings(w));
        } else {
          flush();
          current = { text: w.text, startMs: w.startMs, endMs: w.endMs, graphemes: buildGraphemeTimings(w), _cjk: true };
        }
      } else {
        flush();
        current = { text: w.text, startMs: w.startMs, endMs: w.endMs, graphemes: buildGraphemeTimings(w), _cjk: false };
      }
    }
    flush();
    return groups.map(({ _cjk, ...g }) => g);
  }

  // ═══════════════════════════════════════════
  // 多層級語感切行（Drift / Aura 共用）
  // 設計原則：由粗到細逐層切，每層都保證「所有字元原樣保留、只是分段」；
  // 英文單字絕不從中間切開——層 3 把 CJK 句中的連續英文抽成整塊，
  // 最後的補刀切點也只選 Intl.Segmenter 給的詞邊界。
  // ═══════════════════════════════════════════

  const SENT_PUNCT_RE = /[，。；！？、…·.,;!?]+/g;
  const SENT_SPECIAL_RE = /[：:／/\\|｜~～]+/;
  const BRACKET_PAIRS = [['「', '」'], ['『', '』'], ['《', '》'], ['【', '】'], ['（', '）'], ['(', ')'], ['[', ']'], ['"', '"'], ["'", "'"]];

  /** 層 1：標點後切分，標點（含其後空白）黏附前段。 */
  function splitByPunct(text) {
    const parts = [];
    let last = 0;
    SENT_PUNCT_RE.lastIndex = 0;
    let m;
    while ((m = SENT_PUNCT_RE.exec(text)) !== null) {
      let end = m.index + m[0].length;
      while (end < text.length && /\s/.test(text[end])) end += 1; // 標點後空白一起帶走
      parts.push(text.slice(last, end));
      last = end;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.filter((p) => p.length > 0);
  }

  /** 層 2：最外層成對括號/引號抽成獨立段。 */
  function splitByBrackets(text) {
    for (const [open, close] of BRACKET_PAIRS) {
      const oi = text.indexOf(open);
      if (oi < 0) continue;
      const ci = text.indexOf(close, oi + open.length);
      if (ci < 0) continue;
      const before = text.slice(0, oi);
      const inner = text.slice(oi, ci + close.length);
      const after = text.slice(ci + close.length);
      const parts = [];
      if (before) parts.push(...splitByBrackets(before));
      parts.push(inner);
      if (after) parts.push(...splitByBrackets(after));
      if (parts.length > 1) return parts;
    }
    return [text];
  }

  /** 層 3：CJK 句中的連續英文塊（2 個以上單字）抽成獨立段——英文永不被切開。 */
  function splitByWesternBlocks(text) {
    if (!CJK_RE.test(text)) return [text];
    const blockRe = /[A-Za-z0-9][A-Za-z0-9'’-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'’-]*)+[.,;:!?，。；：！？]?\s*/g;
    const parts = [];
    let last = 0;
    let m;
    while ((m = blockRe.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(m[0]);
      last = m.index + m[0].length;
    }
    if (last === 0) return [text];
    if (last < text.length) parts.push(text.slice(last));
    return parts.filter((p) => p.length > 0);
  }

  /** 層 4：CJK 文字內以空白切段（空白黏附前段尾）。 */
  function splitByCjkSpace(text) {
    if (!CJK_RE.test(text)) return [text];
    const parts = [];
    let last = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const isFullSpace = ch === '　';
      const isHalfSpaceAfterCjk = /\s/.test(ch) && i > 0 && CJK_RE.test(text[i - 1]);
      if ((isFullSpace || isHalfSpaceAfterCjk) && i + 1 < text.length) {
        parts.push(text.slice(last, i + 1));
        last = i + 1;
      }
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.filter((p) => p.length > 0);
  }

  /** 層 5：特殊分隔符（冒號/斜線/豎線/波浪）切段，符號黏附前段。 */
  function splitBySpecial(text) {
    const m = text.match(SENT_SPECIAL_RE);
    if (!m || m.index === undefined) return [text];
    const end = m.index + m[0].length;
    if (end >= text.length || m.index === 0) return [text];
    return [text.slice(0, end), ...splitBySpecial(text.slice(end))];
  }

  const SPLIT_LEVELS = [splitByPunct, splitByBrackets, splitByWesternBlocks, splitByCjkSpace, splitBySpecial];

  /** 補刀：對還不夠段的情況，用 Intl.Segmenter 找「最接近段中點的詞邊界」再切一刀。 */
  function secondaryWordBoundarySplit(parts, targetCount) {
    let segmenter = null;
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      try { segmenter = new Intl.Segmenter(undefined, { granularity: 'word' }); } catch (e) { /* 退化 */ }
    }
    let guard = 8;
    while (parts.length < targetCount && guard > 0) {
      guard -= 1;
      // 挑最長的可切段
      let bestIdx = -1;
      for (let i = 0; i < parts.length; i += 1) {
        if (parts[i].trim().length > 2 && (bestIdx < 0 || parts[i].length > parts[bestIdx].length)) bestIdx = i;
      }
      if (bestIdx < 0) break;
      const target = parts[bestIdx];
      let splitPos = -1;
      if (segmenter) {
        const mid = target.length / 2;
        let bestDist = Infinity;
        let offset = 0;
        try {
          for (const seg of segmenter.segment(target)) {
            if (seg.index > 0 && seg.isWordLike) {
              const d = Math.abs(seg.index - mid);
              if (d < bestDist) { bestDist = d; splitPos = seg.index; }
            }
            offset += seg.segment.length;
          }
        } catch (e) { splitPos = -1; }
      }
      if (splitPos <= 0 || splitPos >= target.length) break; // 找不到詞邊界就不硬切
      parts.splice(bestIdx, 1, target.slice(0, splitPos), target.slice(splitPos));
    }
    return parts;
  }

  /** 段數太多時：反覆合併「相鄰兩段合計最短」的一對，直到符合目標。 */
  function mergeToCount(parts, targetCount) {
    while (parts.length > targetCount) {
      let bestIdx = 0;
      let bestLen = Infinity;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const len = parts[i].length + parts[i + 1].length;
        if (len < bestLen) { bestLen = len; bestIdx = i; }
      }
      parts.splice(bestIdx, 2, parts[bestIdx] + parts[bestIdx + 1]);
    }
    return parts;
  }

  /**
   * 語感切行：把一行歌詞切成約 targetCount 段。
   * 保證 concat(回傳段) === 原文（含空白），呼叫端可安全用累積長度算 charOffset。
   * @param {string} text
   * @param {number} targetCount - 目標段數（1 = 不切）
   * @returns {string[]}
   */
  function splitSentenceSegments(text, targetCount) {
    if (!text || targetCount <= 1) return [text || ''];
    let parts = [text];
    for (const level of SPLIT_LEVELS) {
      if (parts.length >= targetCount) break;
      const nextParts = [];
      for (const p of parts) nextParts.push(...level(p));
      parts = nextParts;
    }
    if (parts.length < targetCount) parts = secondaryWordBoundarySplit(parts, targetCount);
    if (parts.length > targetCount) parts = mergeToCount(parts, targetCount);
    return parts.length > 0 ? parts : [text];
  }

  /**
   * 歌詞水平位置（v5.1）：模板排版前呼叫，取得「有效排版寬度」與該行的分散側 class。
   * - left/right 模式：容器本身被 CSS 收窄，模板只要以 rootEl.clientWidth 為準即可
   * - split 模式：行容器逐行交替 .pos-left/.pos-right（各佔 48% 寬），排版寬也要跟著縮
   * 註：讀 document.body.dataset 是刻意的例外（顯示端全域狀態），kernel 其餘部分保持純函式。
   */
  function layoutViewport(rootEl, lineIndex) {
    const rootW = (rootEl && rootEl.clientWidth) || window.innerWidth || 1280;
    const split = typeof document !== 'undefined' && document.body
      && document.body.dataset.lyricPos === 'split';
    return {
      width: split ? rootW * 0.48 : rootW,
      sideClass: split ? (lineIndex % 2 === 0 ? 'pos-left' : 'pos-right') : '',
    };
  }

  /**
   * 確定性雜湊噪聲：同一 (seed, salt) 永遠回傳同一值 [0,1)。
   * 整數雜湊（乘法混合＋位移擾動），佈局用它保證「同一行永遠同一幾何」，
   * 時間只改變動畫狀態、不重排版。seed 通常是行起始毫秒，salt 區分用途通道。
   */
  function hashNoise(seed, salt) {
    let h = (Math.imul(seed | 0, 0x9E3779B1) ^ Math.imul((salt | 0) + 0x85EBCA77, 0xC2B2AE3D)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0;
    h ^= h >>> 12; h = Math.imul(h, 0x297A4D63) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0; // 最後的 XOR 也要壓回無符號，否則一半的值變負數
    return h / 4294967296;
  }

  /** 便捷形：回傳 [-1, 1) 的置中噪聲（佈局偏移常用）。 */
  function hashSpread(seed, salt) {
    return hashNoise(seed, salt) * 2 - 1;
  }

  return {
    Spring,
    smoothstep,
    clamp,
    lineTempo,
    ensureWordTimings,
    buildGraphemeTimings,
    buildDisplayWords,
    splitSentenceSegments,
    layoutViewport,
    hashNoise,
    hashSpread,
    measureCharOffsets,
    phaseOf,
    AFTERGLOW_MS,
  };
})();
