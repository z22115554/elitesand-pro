/**
 * TTML (Timed Text Markup Language) 歌詞解析器
 * 
 * 解析來自 BetterLyrics / Paxsenix 的 TTML 格式歌詞，
 * 支援逐字同步、多聲部（對唱）、背景和聲。
 * 
 * 輸出格式：KRC 相容的逐字格式
 * [mm:ss.xx]<duration>word<start,duration>word<start,duration>...
 */

const { msToKrcTime, parseTimestampToMs } = require('../utils/time-utils');

/**
 * 解析 TTML 歌詞為 KRC 逐字格式
 * @param {string} ttmlText - TTML XML 文字
 * @returns {string|null} KRC 逐字格式文字
 */
function parseTTML(ttmlText) {
  try {
    if (!ttmlText || typeof ttmlText !== 'string') return null;
    if (!ttmlText.includes('<tt') && !ttmlText.includes('xmlns')) return null;

    const lines = [];

    // 解析 global offset
    let globalOffsetMs = 0;
    const offsetMatch = ttmlText.match(/lyricOffset="(-?\d+)"/);
    if (offsetMatch) globalOffsetMs = parseInt(offsetMatch[1], 10);

    // 解析 agent 映射（對唱標記）
    const agentMap = {};
    const agentRegex = /<ttm:agent\s+type="[^"]*"\s+xml:id="([^"]+)"/g;
    let agentMatch;
    while ((agentMatch = agentRegex.exec(ttmlText)) !== null) {
      agentMap[agentMatch[1]] = true;
    }

    // 找出所有 <p> 段落
    const pRegex = /<p\s+([^>]*)>([\s\S]*?)<\/p>/g;
    let pMatch;

    while ((pMatch = pRegex.exec(ttmlText)) !== null) {
      const attrs = pMatch[1];
      const content = pMatch[2];

      // 注意：Apple/boidu 的 TTML 有些 <p> 只在子 <span> 上有 begin/end、行級不帶時間。
      // 若硬用 <p> 的 begin/end，這些行會算出 pDuration<=0 而被整行丟掉（實測 アイドル 74→49 行）。
      // 故先解析 span，<p> 缺時間時再從 span 推導（min begin / max end）。
      const beginAttr = getAttr(attrs, 'begin');
      const endAttr = getAttr(attrs, 'end');
      let pBegin = beginAttr ? parseTTMLTime(beginAttr) : -1;
      let pEnd = endAttr ? parseTTMLTime(endAttr) : -1;

      // 先解析逐字 <span>（連同各自的 begin/end）
      const spans = [];
      const spanRegex = /<span\s+([^>]*)>([\s\S]*?)<\/span>/g;
      let spanMatch;
      while ((spanMatch = spanRegex.exec(content)) !== null) {
        const spanAttrs = spanMatch[1];
        const spanContent = stripTags(spanMatch[2]);
        if (!spanContent.trim()) continue;
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
          krcLine += `${word.text}<${word.start},${word.duration}>`;
        }
        lines.push(krcLine);
      }
    }

    return lines.length > 0 ? lines.join('\n') : null;
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

  return 0;
}

function getAttr(attrStr, name) {
  const regex = new RegExp(`${name.replace(':', '\\:')}="([^"]*)"`);
  const match = attrStr.match(regex);
  return match ? match[1] : '';
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * 清理歌詞標題/歌手名稱（參考 Metrolist/LRCLIB 的清理邏輯）
 * 移除 "(Official)", "(Remix)", "feat.", "ft.", 年份後綴等
 */
function cleanQuery(text) {
  if (!text) return '';
  return text
    .replace(/\((?:Official|Remastered|Deluxe|Explicit|Clean|Radio|Edit|Version|Extended|Mix|Original|Music\s*Video|HD|4K|Audio|Lyric|Lyrics|Visualizer|Animation)[^)]*\)/gi, '')
    .replace(/\s*(?:feat\.?|ft\.?|featuring|with)\s+.+/gi, '')
    .replace(/\s*\(\d{4}\)\s*$/g, '')
    .replace(/[（(【\[][^）)}】\]]*[）)}】\]]/g, '')
    .replace(/[「『《〈＜][^」』》〉＞]*[」』》〉＞]/g, '')
    .replace(/\s*\|.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { parseTTML, cleanQuery };
