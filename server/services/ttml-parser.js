/**
 * TTML (Timed Text Markup Language) 歌詞解析器
 * 
 * 解析來自 BetterLyrics / Paxsenix 的 TTML 格式歌詞，
 * 支援逐字同步、多聲部（對唱）、背景和聲。
 * 
 * 輸出格式：KRC 相容的逐字格式
 * [mm:ss.xx]<duration>word<start,duration>word<start,duration>...
 */

const { msToKrcTime, escapeTimedWord } = require('../utils/time-utils');
const he = require('he');

/**
 * 解析 TTML 歌詞為 KRC 逐字格式
 * @param {string} ttmlText - TTML XML 文字
 * @returns {string|null} KRC 逐字格式文字
 */
function parseTTML(ttmlText) {
  try {
    if (!ttmlText || typeof ttmlText !== 'string') return null;
    if (!ttmlText.includes('<tt') && !ttmlText.includes('xmlns')) return null;
    for (const match of ttmlText.matchAll(/\b(?:begin|end|dur)\s*=\s*["']([^"']+)["']/g)) {
      if (!Number.isFinite(parseTTMLTime(match[1]))) return null;
    }

    const lines = [];

    // 解析 global offset
    let globalOffsetMs = 0;
    const offsetMatch = ttmlText.match(/lyricOffset="(-?\d+)"/);
    if (offsetMatch) globalOffsetMs = parseInt(offsetMatch[1], 10);

    // 解析 <ttm:agent> 定義（Apple / AMLL 逐字 TTML 的對唱／合唱標記）。
    // type="person" → 個別演唱者，依出現順序給代號 a / b / c / d；
    // type="group" | "other" → 合唱/齊唱 → both。
    // <p> 上的 ttm:agent="vN" 對應到這裡的 id；下游 parseKrc 會把代號轉成 line.singer。
    const agentType = {};
    const agentDefRegex = /<ttm:agent\b([^>]*?)\/?>/g;
    let agentDefMatch;
    while ((agentDefMatch = agentDefRegex.exec(ttmlText)) !== null) {
      const a = agentDefMatch[1];
      const id = (a.match(/xml:id="([^"]+)"/) || [])[1];
      if (!id) continue;
      agentType[id] = (a.match(/\btype="([^"]+)"/) || [])[1] || 'person';
    }
    const personOrder = [];
    const singerCodeForAgent = (id) => {
      if (!id) return '';
      const type = agentType[id];
      if (type === 'group' || type === 'other') return 'both';
      // type 未定義時也當個別演唱者處理（部分來源省略 <ttm:agent> 定義）
      let i = personOrder.indexOf(id);
      if (i < 0) { i = personOrder.length; personOrder.push(id); }
      return ['a', 'b', 'c', 'd'][i] || '';
    };

    // <p> 位置 → 所屬 <div> 的 ttm:agent（Apple 常把 agent 掛在 <div> 上、<p> 繼承）。
    const divSpans = [];
    const divRegex = /<div\b([^>]*)>([\s\S]*?)<\/div>/g;
    let divMatch;
    while ((divMatch = divRegex.exec(ttmlText)) !== null) {
      divSpans.push({
        start: divMatch.index,
        end: divRegex.lastIndex,
        agent: getAttr(divMatch[1], 'ttm:agent') || getAttr(divMatch[1], 'agent'),
      });
    }
    const divAgentAt = (pos) => {
      const d = divSpans.find((s) => pos >= s.start && pos < s.end);
      return d ? d.agent : '';
    };

    // Apple 的 TTML 把翻譯放在 <head> 的 <iTunesMetadata><translations>，用 <text for="L1"> 對到
    // <p itunes:key="L1">。有多種語言時優先繁中、再來其他中文、最後第一個。
    const headTranslations = readHeadTranslations(ttmlText);

    // 找出所有 <p> 段落
    const pRegex = /<p\s+([^>]*)>([\s\S]*?)<\/p>/g;
    let pMatch;

    while ((pMatch = pRegex.exec(ttmlText)) !== null) {
      const attrs = pMatch[1];
      // 背景和聲 / 翻譯 / 羅馬拼音的整行 <p>：跳過，不混進主歌詞。
      if (/\bttm:role="x-(?:bg|translation|roman|anti)"/i.test(attrs)) continue;
      // span 級的背景和聲 / 翻譯 / 羅馬拼音：整段剝掉再解析（含一層巢狀逐字 <span>）。
      // 行內的翻譯（AMLL／Apple 的 <span ttm:role="x-translation">）：剝掉前先記下來當這一行的譯文。
      const itunesKey = getAttr(attrs, 'itunes:key');
      const translationText = extractRoleText(pMatch[2], 'x-translation')
        || (itunesKey && headTranslations[itunesKey]) || '';
      const content = stripRoleSpans(pMatch[2], 'x-bg|x-translation|x-roman|x-anti');

      // 注意：Apple/boidu 的 TTML 有些 <p> 只在子 <span> 上有 begin/end、行級不帶時間。
      // 若硬用 <p> 的 begin/end，這些行會算出 pDuration<=0 而被整行丟掉（實測 アイドル 74→49 行）。
      // 故先解析 span，<p> 缺時間時再從 span 推導（min begin / max end）。
      const beginAttr = getAttr(attrs, 'begin');
      const endAttr = getAttr(attrs, 'end');
      let pBegin = beginAttr ? parseTTMLTime(beginAttr) : -1;
      let pEnd = endAttr ? parseTTMLTime(endAttr) : -1;
      const durationAttr = getAttr(attrs, 'dur');
      if (!endAttr && pBegin >= 0 && durationAttr) pEnd = pBegin + parseTTMLTime(durationAttr);

      // 先解析逐字 <span>（連同各自的 begin/end）
      // 注意：英文逐字 TTML（Apple/BetterLyrics）真正的詞間空白是 <span> 標籤「之間」的
      // 純文字節點（如 <span>WELL,</span> <span>I</span>），不在 span 內容裡；CJK 逐字通常
      // 相鄰 span 間沒有這個空白節點。過去只擷取 span 內容，詞間空白被整段丟掉，導致英文歌詞
      // 全部黏在一起（如 IWANTYOUTOSTAY）。這裡補抓 span 之間的文字，含空白才補回一個空格——
      // 空格必須黏在「前一個詞的結尾」（trailing），不能黏下一個詞的開頭（leading）：
      // lyric-motion-kernel.js 的 tokenizeLineText／buildSemanticGroups 全專案統一約定
      // 「空白黏前一詞尾」，Intl.Segmenter 才能對齊詞邊界；黏反方向會讓 buildSemanticGroups
      // 誤判詞跨在兩個語義段之間、連環合併，整句被併成一個 displayWord（v5 模板變成整句
      // 一起彈出，逐字動畫完全失效——實測用 ilomilo「remember not to get too close to
      // stars」重現：黏反方向時 8 個詞被併成 1 個，改黏前一詞尾後正確保留 8 個獨立詞）。
      const spans = [];
      const spanRegex = /<span\s+([^>]*)>([\s\S]*?)<\/span>/g;
      let spanMatch;
      let prevSpanEnd = 0;
      while ((spanMatch = spanRegex.exec(content)) !== null) {
        const between = content.slice(prevSpanEnd, spanMatch.index);
        prevSpanEnd = spanRegex.lastIndex;
        const spanAttrs = spanMatch[1];
        const spanContent = stripTags(spanMatch[2]);
        if (!spanContent.trim()) continue;
        const needsSpace = spans.length > 0 && /\s/.test(stripTags(between));
        if (needsSpace) spans[spans.length - 1].text += ' ';
        const sb = getAttr(spanAttrs, 'begin');
        const se = getAttr(spanAttrs, 'end');
        spans.push({
          text: spanContent,
          begin: sb ? parseTTMLTime(sb) : -1,
          end: se ? parseTTMLTime(se) : -1,
        });
      }

      // <p> 缺行級時間時，從 span 推導
      const spanBegins = spans.filter(s => s.begin >= 0).map(s => s.begin);
      const spanEnds = spans.filter(s => s.end >= 0).map(s => s.end);
      if (pBegin < 0) pBegin = spanBegins.length ? Math.min(...spanBegins) : -1;
      if (pEnd < 0) pEnd = spanEnds.length ? Math.max(...spanEnds) : pBegin;

      // 真的完全無時間才放棄這行
      if (pBegin < 0) continue;
      // 一律 Math.round 成整數毫秒：純秒數 ×1000 與相減會產生浮點誤差（如 3853.0000000000146），
      // 下游 parseKrc 的正則 <(\d+)> 只吃整數，帶小數的行會匹配失敗被整行丟掉（實測 千鳥 42→36 行）。
      let pDuration = Math.round(Math.max(0, pEnd - pBegin));

      // 組逐字 words（相對 pBegin）
      const words = [];
      let fullText = '';
      for (const s of spans) {
        const wb = s.begin >= 0 ? s.begin : pBegin;
        const we = s.end >= 0 ? s.end : wb;
        fullText += s.text;
        words.push({ text: s.text, start: Math.round(Math.max(0, wb - pBegin)), duration: Math.round(Math.max(0, we - wb)) });
      }

      // 如果沒有 <span>，整行作為一個 word
      if (words.length === 0) {
        const lineText = stripTags(content).trim();
        if (lineText) {
          fullText = lineText;
          words.push({ text: lineText, start: 0, duration: pDuration });
        }
      }

      // 行 duration 至少給個正值，避免下游 KRC 解析 / 顯示用到 0
      if (pDuration <= 0) {
        const lastEnd = words.reduce((m, w) => Math.max(m, w.start + w.duration), 0);
        pDuration = lastEnd > 0 ? lastEnd : 1000;
      }

      if (fullText.trim() && words.length > 0) {
        const adjustedTime = Math.round(pBegin + globalOffsetMs);
        const timeTag = msToKrcTime(adjustedTime);

        let krcLine = `[${timeTag}]<${pDuration}>`;
        for (const word of words) {
          krcLine += `${escapeTimedWord(he.decode(word.text))}<${word.start},${word.duration}>`;
        }
        const agentId = getAttr(attrs, 'ttm:agent') || getAttr(attrs, 'agent') || divAgentAt(pMatch.index);
        lines.push({ krc: krcLine, singer: singerCodeForAgent(agentId), time: timeTag,
          // 譯文跟原文一樣（中文歌常見）就不收，免得同一句顯示兩次。
          translation: translationText && translationText !== fullText.trim() ? translationText : '' });
      }
    }

    if (lines.length === 0) return null;
    // 只有整首出現 ≥2 種聲部代號時才輸出標記（solo 歌每行都掛同一個 agent，不算對唱）。
    const distinctSingers = new Set(lines.map((l) => l.singer).filter(Boolean));
    const emitSingers = distinctSingers.size >= 2;
    const body = lines
      .map((l) => (emitSingers && l.singer
        ? l.krc.replace(/^(\[[^\]]+\]<\d+>)/, `$1${l.singer}`)
        : l.krc));
    // 譯文用「[時間]文字」純文字行接在後面（同 appendTranslationLines），parseKrc 依時間收進對應那一行。
    const translations = lines
      .filter((l) => l.translation)
      .map((l) => `[${l.time}]${l.translation.replace(/</g, '＜')}`);
    return body.concat(translations).join('\n');
  } catch (err) {
    console.error('[TTML] 解析失敗:', err.message);
    return null;
  }
}

// ─── 輔助函數 ───

/**
 * 解析 TTML 時間格式
 * 支援：HH:MM:SS.mmm, MM:SS.mmm, SS.mmm, 純毫秒
 */
function parseTTMLTime(timeStr) {
  if (!timeStr) return 0;
  timeStr = String(timeStr).trim();

  // clock-time：HH:MM:SS(.fff) 或 MM:SS(.fff)
  const hmsMatch = timeStr.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (hmsMatch) return (parseInt(hmsMatch[1], 10) * 3600 + parseInt(hmsMatch[2], 10) * 60 + parseFloat(hmsMatch[3])) * 1000;

  const msMatch = timeStr.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (msMatch) return (parseInt(msMatch[1], 10) * 60 + parseFloat(msMatch[2])) * 1000;

  // offset-time 帶單位：ms / s / m / h（TTML 規格）
  const unitMatch = timeStr.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (unitMatch) {
    const v = parseFloat(unitMatch[1]);
    switch (unitMatch[2]) {
      case 'ms': return v;
      case 's': return v * 1000;
      case 'm': return v * 60000;
      case 'h': return v * 3600000;
    }
  }

  // 純數字（無冒號、無單位）：Apple「Line」型 TTML 慣例＝「秒」（常帶小數，如 begin="9.917"）。
  // 舊版只認冒號/`s` 後綴，純秒數會回 0 → 整首每行 time=0、全擠在 0 秒、畫面跳過前段歌詞。
  const bareMatch = timeStr.match(/^(\d+(?:\.\d+)?)$/);
  if (bareMatch) return parseFloat(bareMatch[1]) * 1000;

  return NaN;
}

function getAttr(attrStr, name) {
  const regex = new RegExp(`${name.replace(':', '\\:')}="([^"]*)"`);
  const match = attrStr.match(regex);
  return match ? match[1] : '';
}

/** <head> 裡 <translations> 的譯文 → { 行 key: 文字 }；沒有回 {}。 */
function readHeadTranslations(ttmlText) {
  const blocks = [];
  const blockRe = /<translation\b([^>]*)>([\s\S]*?)<\/translation>/gi;
  let m;
  while ((m = blockRe.exec(ttmlText)) !== null) {
    const lang = (getAttr(m[1], 'xml:lang') || '').toLowerCase();
    const map = {};
    const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let t;
    while ((t = textRe.exec(m[2])) !== null) {
      const key = getAttr(t[1], 'for');
      const text = stripTags(t[2]).replace(/\s+/g, ' ').trim();
      if (key && text) map[key] = text;
    }
    if (Object.keys(map).length) blocks.push({ lang, map });
  }
  if (!blocks.length) return {};
  const rank = (lang) => (/^zh-(?:hant|tw|hk|mo)/.test(lang) ? 0 : (/^zh/.test(lang) ? 1 : 2));
  blocks.sort((x, y) => rank(x.lang) - rank(y.lang));
  return blocks[0].map;
}

/** 取出某個 ttm:role 的 span 純文字（多個就接起來）；沒有回空字串。 */
function extractRoleText(html, role) {
  const re = new RegExp(`<span\\b[^>]*\\bttm:role="${role}"[^>]*>([\\s\\S]*?)<\\/span>`, 'gi');
  const parts = [];
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const text = stripTags(m[1]).replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }
  return parts.join(' ');
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * 剝掉整段 <span ttm:role="x-bg|x-translation|x-roman|..."> ... </span>
 * （Apple 的背景和聲是「外層 role span 包一層逐字 span」的巢狀結構，用深度計數配對收尾）。
 */
function stripRoleSpans(html, rolePattern) {
  let out = String(html || '');
  const opener = new RegExp(`<span\\b[^>]*\\bttm:role="(?:${rolePattern})"[^>]*>`, 'i');
  const tag = /<\/?span\b[^>]*>/gi;
  for (let guard = 0; guard < 200; guard += 1) {
    const m = opener.exec(out);
    if (!m) return out;
    if (/\/\s*>$/.test(m[0])) { // 自閉合的 role span，直接刪
      out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
      continue;
    }
    let depth = 1;
    let cut = -1;
    tag.lastIndex = m.index + m[0].length;
    let t;
    while ((t = tag.exec(out)) !== null) {
      if (t[0][1] === '/') depth -= 1;
      else if (!/\/\s*>$/.test(t[0])) depth += 1;
      if (depth === 0) { cut = tag.lastIndex; break; }
    }
    out = cut < 0 ? out.slice(0, m.index) : out.slice(0, m.index) + out.slice(cut);
  }
  return out;
}

/**
 * 清理歌詞標題/歌手名稱，提高各來源的搜尋命中率。
 * 移除：關鍵字括號（Official／Remastered／Music Video…）、feat./ft. 之後的整段、
 * 年份後綴、全形括號與書名號內容、"|" 之後的尾段，最後壓縮空白。
 */
// 括號一層一層由內往外剝（「(여자)아이들((G)I-DLE)」這種巢狀括號，舊的單層正則會從第一個「(」
// 一路吃到第一個「)」，剩下「아이들I-DLE)」）。名字自帶的單字母括號（f(x)、(G)I-DLE）保留。
function stripBracketGroups(text) {
  let out = text;
  for (let guard = 0; guard < 5; guard += 1) {
    const next = out.replace(/[（(【\[][^（(【\[）)}】\]]*[）)}】\]]/g, (group, offset, whole) => {
      const glued = /^[([][A-Za-z0-9][)\]]$/.test(group)
        && (/[A-Za-z0-9]$/.test(whole.slice(0, offset)) || /^[A-Za-z0-9]/.test(whole.slice(offset + group.length)));
      return glued ? group : '';
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function cleanQuery(text) {
  if (!text) return '';
  // 括號要先剝：「Song (feat. X)」若先跑 feat 規則，會連右括號一起吃掉，留下「Song (」。
  // feat／ft／featuring 前後都必須是空白：舊版前面用 \s*（可為零個），「Left Behind」的
  // 「ft」、「Defeat」的「feat」都會被當成客串標記，整句砍成「Le」「De」。
  // 也不再把「with」當客串標記：「Stay With Me」會變「Stay」、「With or Without You」整句變空字串；
  // 「(with X)」這種真正的客串寫法本來就會被括號規則移除。
  const withoutNotes = String(text)
    .replace(/\((?:Official|Remastered|Deluxe|Explicit|Clean|Radio|Edit|Version|Extended|Mix|Original|Music\s*Video|HD|4K|Audio|Lyric|Lyrics|Visualizer|Animation)[^)]*\)/gi, '')
    .replace(/\s*\(\d{4}\)\s*$/g, '');
  // 名字本身就帶括號的（f(x)、(G)I-DLE、(K)NoW_NAME）：括號裡只有 1 個英數字、且直接黏著英數字，
  // 是名字的一部分，不是「(Live)」這種附註；舊版剝成「f」「I-DLE」，拿去搜歌詞對不到。
  const cleaned = stripBracketGroups(withoutNotes)
    .replace(/[「『《〈＜][^」』》〉＞]*[」』》〉＞]/g, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+/gi, '')
    .replace(/\s*\|.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned) return cleaned;
  // 整個名字都包在括號／書名號裡（[Alexandros]、「夜に駆ける」、『ドラえもん』）：照上面規則會整段剝光，
  // 歌名變空字串、搜尋只剩歌手（或什麼都沒有）。這時只拿掉括號符號、保留裡面的字。
  return String(text)
    .replace(/[（(【\[）)}】\]「『《〈＜」』》〉＞]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { parseTTML, cleanQuery };
