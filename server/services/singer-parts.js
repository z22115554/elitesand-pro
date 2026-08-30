'use strict';

/**
 * 合唱聲部標記（singer-parts）
 *
 * 華語 / 日韓流行的社群逐字歌詞常把演唱者標在句首當文字：
 *   - 獨占一行：`男：`（下一行起才是實際歌詞，直到下一個標記）
 *   - 同行前綴：`女：天天都需要你愛`
 * 兩種來源（酷狗 KRC、網易雲文字、社群 LRC）都不帶結構化欄位，前綴會原封不動
 * 流進 line.text。這支把它抽出來掛成 line.singer / line.singerLabel，並把前綴從
 * 顯示文字（與逐字 words）剝掉。
 *
 * 一般歌詞（沒有這種標記）完全不動：必須通過信心門檻才啟用整組改寫，否則原樣回傳。
 *
 * 產出（僅在啟用時）：
 *   line.singer       — 正規化代號：'a' | 'b' | 'c' | 'd' | 'both'
 *   line.singerLabel  — 原始標籤字串（'男' / '女' / '合' / 人名…），供顯示
 * 未帶標記、或門檻未過時：回傳原陣列，且不新增任何欄位。
 */

// CJK 常見聲部字 → 代號。英文段落標籤（Verse/Chorus…）刻意不納入，避免誤判英文歌。
const KNOWN_TAGS = new Map([
  ['男', 'a'], ['男聲', 'a'], ['男声', 'a'], ['男生', 'a'],
  ['女', 'b'], ['女聲', 'b'], ['女声', 'b'], ['女生', 'b'],
  ['M', 'a'], ['F', 'b'],
  ['合', 'both'], ['合唱', 'both'], ['齊', 'both'], ['齐', 'both'],
  ['齊唱', 'both'], ['齐唱', 'both'], ['眾', 'both'], ['众', 'both'],
  ['全體', 'both'], ['全体', 'both'], ['重唱', 'both'], ['對唱', 'both'], ['对唱', 'both'],
  ['一起', 'both'], ['和', 'both'],
]);

// 「明確是聲部字」的集合：只要出現任一個，就算只有單一種標籤也視為聲部標記（而非敘事前綴）。
const STRONG_TAGS = new Set([
  '男', '男聲', '男声', '男生', '女', '女聲', '女声', '女生', 'M', 'F',
  '合', '合唱', '齊', '齐', '齊唱', '齐唱', '眾', '众', '全體', '全体', '重唱', '對唱', '对唱',
]);

// 英文段落標籤：出現在句首當「Chorus：」時是曲式標註，不是演唱者。命中則此行不算標記。
const SECTION_WORDS = new Set([
  'verse', 'chorus', 'bridge', 'intro', 'outro', 'hook', 'prechorus', 'pre-chorus',
  'refrain', 'interlude', 'drop', 'breakdown', 'coda', 'vamp',
]);

// 句首前綴：`<標籤><冒號>`，標籤 1~6 個非空白非括號非冒號字元。
// 分四段擷取，方便同時拿到「要剝掉的完整前綴字串」與「剩餘文字」。
const PREFIX_RE = /^(\s*)([^\s:：()（）[\]【】]{1,6})(\s*[:：]\s*)([\s\S]*)$/;

function parsePrefix(text) {
  const s = String(text == null ? '' : text);
  const m = s.match(PREFIX_RE);
  if (!m) return null;
  const tag = m[2];
  if (/\d/.test(tag)) return null; // 帶數字（時間碼、軌號）不是聲部
  const lower = tag.toLowerCase();
  if (SECTION_WORDS.has(lower)) return null;
  const isCjk = /^[㐀-鿿぀-ヿｦ-ﾟ]+$/.test(tag);
  const isLatin = /^[A-Za-z][A-Za-z.'-]*$/.test(tag);
  if (!isCjk && !isLatin) return null;
  return { tag, prefix: m[1] + m[2] + m[3], rest: m[4].trim() };
}

// 丟掉開頭「累積文字 === 前綴」的 word 單位；對不上就回 null（呼叫端改為整行不附 words）。
function stripPrefixWords(words, prefix) {
  if (!Array.isArray(words) || !words.length) return [];
  const target = String(prefix).replace(/\s+/g, '');
  if (!target) return words.slice();
  let acc = '';
  for (let i = 0; i < words.length; i += 1) {
    acc += String(words[i] && words[i].text || '').replace(/\s+/g, '');
    if (acc === target) return words.slice(i + 1);
    if (!target.startsWith(acc)) return null;
  }
  return null;
}

/**
 * @param {Array} lines  [{ time, text, words?, ... }]
 * @param {Object} [opts]
 * @param {number} [opts.minMarkers=3]      至少要有幾個標記行才啟用
 * @param {number} [opts.maxDistinctTags=5] 相異標籤超過此數視為雜訊，不啟用
 * @returns {Array} 啟用時回傳改寫後的新陣列（獨占標記行已移除）；否則原樣回傳 lines
 */
function annotateSingerParts(lines, opts = {}) {
  const minMarkers = Number.isFinite(opts.minMarkers) ? opts.minMarkers : 3;
  const maxDistinctTags = Number.isFinite(opts.maxDistinctTags) ? opts.maxDistinctTags : 5;
  if (!Array.isArray(lines) || lines.length < 4) return lines;

  const parsed = lines.map((l) => ({
    line: l,
    pfx: l && typeof l.text === 'string' ? parsePrefix(l.text) : null,
  }));
  const markers = parsed.filter((x) => x.pfx);
  if (markers.length < minMarkers) return lines;

  const distinct = new Set(markers.map((x) => x.pfx.tag));
  if (distinct.size > maxDistinctTags) return lines;
  const hasStrong = [...distinct].some((t) => STRONG_TAGS.has(t));
  // 只有單一種泛用前綴（例如整首都是「他說：」）多半是敘事，不是聲部 → 不啟用。
  if (distinct.size < 2 && !hasStrong) return lines;

  const codeByName = new Map();
  const codePool = ['a', 'b', 'c', 'd'];
  let poolIndex = 0;
  const canonOf = (tag) => {
    if (KNOWN_TAGS.has(tag)) return KNOWN_TAGS.get(tag);
    const upper = tag.toUpperCase();
    if (KNOWN_TAGS.has(upper)) return KNOWN_TAGS.get(upper);
    if (!codeByName.has(tag)) codeByName.set(tag, codePool[poolIndex++] || 'x');
    return codeByName.get(tag);
  };

  const out = [];
  let current = null;
  let currentLabel = null;
  for (const { line, pfx } of parsed) {
    if (pfx) {
      const canon = canonOf(pfx.tag);
      current = canon;
      currentLabel = pfx.tag;
      if (pfx.rest === '') continue; // 獨占標記行：設定當前聲部，本行不輸出
      const next = { ...line, text: pfx.rest, singer: canon, singerLabel: pfx.tag };
      if (Array.isArray(line.words) && line.words.length) {
        const trimmed = stripPrefixWords(line.words, pfx.prefix);
        next.words = trimmed == null ? [] : trimmed;
      }
      out.push(next);
      continue;
    }
    if (current) out.push({ ...line, singer: current, singerLabel: currentLabel });
    else out.push(line);
  }

  // 剝完後有效歌詞行過少（整首幾乎都被當標記）→ 判定誤啟用，放棄改動。
  const kept = out.filter((l) => l && typeof l.text === 'string' && l.text.trim());
  if (kept.length < Math.max(4, Math.floor(lines.length * 0.5))) return lines;
  return out;
}

module.exports = {
  annotateSingerParts,
  parsePrefix,
  stripPrefixWords,
  KNOWN_TAGS,
  STRONG_TAGS,
  SECTION_WORDS,
};
