'use strict';

/**
 * 猜編碼讀取使用者上傳的文字檔（主要給 /api/lyrics/upload 用）。
 *
 * 原本的邏輯是「utf8 → utf-16le → shift_jis → gbk」固定順序級聯，遇到「看起來像亂碼」就換下一個，
 * 但判斷式原本寫錯（content.includes('') 對任何字串恆為 true，永遠往下掉，見 issue #9：不管上傳
 * 檔案原本是什麼編碼，一路被強制級聯改判、最後蓋成 gbk，連正常的 UTF-8 上傳都會變亂碼）。
 *
 * BOM 可直接判定；無 BOM 時先驗 UTF-8，失敗才比較 GBK／Big5／Shift-JIS／EUC-KR(CP949)。這些舊式 CJK 編碼
 * 彼此有大量重疊，因此不能只看「能不能 decode」。這裡用三層訊號排序：
 * 1. round-trip：decode 後再用同編碼 encode，位元組必須能完整還原；
 * 2. Unicode replacement/control：明顯解碼錯誤直接重罰；
 * 3. 語言腳本：日文假名強烈偏向 Shift-JIS；繁／簡常見字只作輕量 tie-break，避免 Big5/GBK
 *    在結構上都合法時永遠固定選同一邊。
 * 這不是通用 charset detector，但足以覆蓋歌詞檔最常見的 UTF-8、UTF-16LE/BE、GBK、Big5、Shift-JIS、EUC-KR/CP949。
 */
function buffersEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// 舊式中韓編碼的位元組區間高度重疊：正確的 GBK 常常也能「合法」解成一串韓文，反之亦然。
// 因此不能只看 Unicode script 數量；還要看解出的字是否像該語言常見文字。這些集合只作統計
// tie-break，不會改寫內容，也不要求每個字都命中。
const COMMON_HAN = new Set('的一是不了在人有我他這这中大來来上個个國国到說说們们為为子和你地出道也時时年得就那要下以生會会自著着去之過过家學学對对可她裡里後后小麼么心多天而能好都然沒没日於于起還还發发成事只作當当想看文無无開开手用主行方又如前所本見见經经頭头面公同已老從从動动兩两長长知民樣样現现分將将外但身些與与高意進进把法此實实回理美點点月明其種种聲声全工己話话兒儿者向情部正名定女問问力機机給给等幾几很業业最間间新打便位因重被走電电第門门相次東东政海口使教西再平真聽听世氣气信北少關关並并內内數数記记入愛爱歌詞歌词測试测试資料资料簡简體体繁臺台灣湾時間时间夢梦夜空星光幸運幸运夏春秋冬雨風风花笑哭想念相信世界未來未来勇氣气溫温柔快樂快乐悲傷伤孤獨独遇見见告白泡沫演員员童話话至少懷怀念知足強强倔戀恋球');
const COMMON_HANGUL = new Set('가나다라마바사아자차카타파하이은는을를의에로와과도만너우리그것거야여요해어한리서사랑오늘밤하늘별마음눈물꿈길시간기억목소함께다시생각잘될괜찮좋보고싶내네들게고지기수오일성음방심세대정화연공미원인간장적체제위부개현결경테스트한국꿈비바람안녕고마워');
const COMMON_KOREAN_FRAGMENTS = ['사랑', '너를', '나는', '우리', '오늘', '마음', '생각', '기억', '함께', '다시', '하늘', '별을', '보고', '싶어', '괜찮', '거야', '해요', '어요', '아요', '으로', '에서', '에게', '지만', '는데', '니까', '하면', '하고', '하는', '하지', '없어', '있어', '목소리', '한국어', '테스트'];

function normalizeLocaleHint(value) {
  const locale = String(value || '').trim().toLowerCase();
  if (locale === 'ja' || locale.startsWith('ja-')) return 'ja';
  if (locale === 'ko' || locale.startsWith('ko-')) return 'ko';
  if (locale === 'zh-cn' || locale === 'zh-sg' || locale.startsWith('zh-hans')) return 'zh-CN';
  if (locale.startsWith('zh')) return 'zh-TW';
  if (locale === 'en' || locale.startsWith('en-')) return 'en';
  return '';
}

function textStats(text) {
  const chars = [...text];
  return {
    chars,
    kanaCount: (text.match(/[\u3040-\u30ff]/g) || []).length,
    hangulCount: (text.match(/[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/g) || []).length,
    hanCount: (text.match(/\p{Script=Han}/gu) || []).length,
    latinCount: (text.match(/[A-Za-z]/g) || []).length,
    numberCount: (text.match(/[0-9]/g) || []).length,
    whitespaceCount: (text.match(/\s/g) || []).length,
    replacementCount: (text.match(/�/g) || []).length,
    nulCount: (text.match(/\u0000/g) || []).length,
    controlCount: (text.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length,
    unusualUnicodeCount: (text.match(/[\p{Cs}\p{Co}\p{Cn}]/gu) || []).length,
    commonHanCount: chars.filter((ch) => COMMON_HAN.has(ch)).length,
    commonHangulCount: chars.filter((ch) => COMMON_HANGUL.has(ch)).length,
  };
}

function localeLanguageScore(stats, locale) {
  if (locale === 'zh-TW' || locale === 'zh-CN') {
    return stats.hanCount * 5 + stats.commonHanCount * 6
      - stats.kanaCount * 6 - stats.hangulCount * 9;
  }
  if (locale === 'ja') {
    return stats.kanaCount * 9 + stats.hanCount * 2 + stats.commonHanCount * 6
      - stats.hangulCount * 9;
  }
  if (locale === 'ko') {
    return stats.hangulCount * 8 + stats.commonHangulCount * 7
      - stats.hanCount * 4 - stats.kanaCount * 7;
  }
  if (locale === 'en') {
    return stats.latinCount * 5 - stats.hanCount * 3
      - stats.kanaCount * 4 - stats.hangulCount * 4;
  }
  return 0;
}

function strongLocaleMatch(stats, locale) {
  if (locale === 'zh-TW' || locale === 'zh-CN') {
    return stats.hanCount >= 2
      && stats.kanaCount === 0
      && stats.hangulCount === 0
      && stats.commonHanCount / stats.hanCount >= 0.75;
  }
  if (locale === 'ja') {
    if (stats.kanaCount >= 2 && stats.hangulCount === 0) return true;
    return stats.hanCount >= 2
      && stats.hangulCount === 0
      && stats.commonHanCount / stats.hanCount >= 0.75;
  }
  if (locale === 'ko') {
    return stats.hangulCount >= 2
      && stats.hanCount === 0
      && stats.kanaCount === 0
      && stats.commonHangulCount / stats.hangulCount >= 0.75;
  }
  return locale === 'en' && stats.latinCount >= 4
    && stats.hanCount === 0
    && stats.kanaCount === 0
    && stats.hangulCount === 0;
}

function strongSupportedLanguage(stats) {
  if (stats.replacementCount || stats.nulCount || stats.controlCount || stats.unusualUnicodeCount) return false;
  if (stats.kanaCount >= 2 && stats.hangulCount === 0) return true;
  if (stats.hangulCount >= 2
    && stats.hanCount === 0
    && stats.kanaCount === 0
    && stats.commonHangulCount / stats.hangulCount >= 0.75) return true;
  if (stats.hanCount >= 2
    && stats.hangulCount === 0
    && stats.kanaCount === 0
    && stats.commonHanCount / stats.hanCount >= 0.75) return true;
  return stats.latinCount >= 4
    && stats.hanCount === 0
    && stats.kanaCount === 0
    && stats.hangulCount === 0;
}

function detectBomlessUtf16(rawBuffer) {
  if (!rawBuffer || rawBuffer.length < 8 || rawBuffer.length % 2 !== 0) return null;
  let evenZero = 0;
  let oddZero = 0;
  const pairs = rawBuffer.length / 2;
  for (let i = 0; i < rawBuffer.length; i += 2) {
    if (rawBuffer[i] === 0) evenZero += 1;
    if (rawBuffer[i + 1] === 0) oddZero += 1;
  }
  // LRC/SRT/一般文字裡的 ASCII 時間碼、標籤、英文會在 UTF-16 的高位元組形成規律 NUL。
  // 至少 20% pair 命中且左右差距夠大才判，避免把舊式 CJK 雙位元組編碼誤當 UTF-16。
  const threshold = Math.max(3, Math.ceil(pairs * 0.2));
  if (oddZero >= threshold && oddZero >= evenZero * 3 + 2) return 'utf-16le';
  if (evenZero >= threshold && evenZero >= oddZero * 3 + 2) return 'utf16-be';
  return null;
}

function hasSingleByteLyricSyntax(rawBuffer) {
  const rawLatin1 = Buffer.from(rawBuffer || []).toString('latin1');
  return /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(rawLatin1)
    || /\[(?:ar|ti|al|by|offset):/i.test(rawLatin1)
    || /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(rawLatin1);
}

function legacyDecodeScore(rawBuffer, encoding, iconv) {
  const text = iconv.decode(rawBuffer, encoding);
  let score = 0;

  // 能完整 round-trip 是最重要的結構證據；不能還原通常代表這個編碼只是「勉強解得出字」。
  const reencoded = iconv.encode(text, encoding);
  score += buffersEqual(rawBuffer, reencoded) ? 100 : -100;

  const stats = textStats(text);
  const { kanaCount, hangulCount, hanCount, latinCount } = stats;
  score -= stats.replacementCount * 60 + stats.nulCount * 30
    + stats.controlCount * 20 + stats.unusualUnicodeCount * 30;
  if (encoding === 'shift_jis') score += kanaCount * 6;
  else if (kanaCount > 0) score -= kanaCount * 4;

  const { commonHanCount, commonHangulCount } = stats;
  if (encoding === 'euc-kr') {
    score += commonHangulCount * 4;
    score -= Math.max(0, hangulCount - commonHangulCount) * 2;
    score -= hanCount * 2;
    for (const fragment of COMMON_KOREAN_FRAGMENTS) if (text.includes(fragment)) score += 10;
  } else if (encoding === 'gbk' || encoding === 'big5') {
    score += commonHanCount * 3;
    score -= Math.max(0, hanCount - commonHanCount);
    if (hangulCount > 0) score -= hangulCount * 5;
  } else if (hangulCount > 0) {
    score -= hangulCount * 5;
  }

  // 僅作 Big5 / GBK 的輕量 tie-break，不把個別用字當成硬規則。
  const traditionalHints = (text.match(/[臺灣體國學樂詞與為這個來時會開裡後說還過無麼]/g) || []).length;
  const simplifiedHints = (text.match(/[台湾体国学乐词与为这个来时会开里后说还过无么]/g) || []).length;
  if (encoding === 'big5') score += traditionalHints * 2 - simplifiedHints;
  if (encoding === 'gbk') score += simplifiedHints * 2 - traditionalHints;

  // 正常歌詞通常至少會包含文字；全是奇怪符號的候選降權。
  score += Math.min(20, hanCount + kanaCount + hangulCount + Math.floor(latinCount / 2));
  return { text, score };
}

function utf16DecodeScore(rawBuffer, encoding, iconv, locale) {
  if (!rawBuffer || rawBuffer.length < 2 || rawBuffer.length % 2 !== 0) {
    return { text: '', score: Number.NEGATIVE_INFINITY };
  }
  const text = iconv.decode(rawBuffer, encoding);
  const stats = textStats(text);
  let score = 100;
  score -= stats.replacementCount * 100 + stats.nulCount * 40
    + stats.controlCount * 60 + stats.unusualUnicodeCount * 80;
  score += Math.min(30,
    stats.hanCount + stats.kanaCount + stats.hangulCount
    + stats.latinCount + stats.numberCount + stats.whitespaceCount);
  // 只有「無 BOM、純 CJK TXT」這個本來就高度模糊的 fallback 才參考 UI locale。
  // 正常 UTF-8 / BOM / LRC / SRT / Big5 / GBK / Shift-JIS / EUC-KR 的判定完全不靠 UI 語言。
  score += localeLanguageScore(stats, locale);

  // 正常 UTF-16 文字的高位元組有明顯分布：ASCII=00、日文/漢字大多 30~9F、韓文 AC~D7。
  // 這不是單獨的判定條件，只是跟語言統計一起用來拉開「舊式雙位元組剛好也能 decode」的候選。
  let structuredPairs = 0;
  let oddPairs = 0;
  for (let i = 0; i < rawBuffer.length; i += 2) {
    const high = encoding === 'utf-16le' ? rawBuffer[i + 1] : rawBuffer[i];
    if (high === 0
      || (high >= 0x20 && high <= 0x9f)
      || (high >= 0xac && high <= 0xd7)
      || (high >= 0xd8 && high <= 0xdf)) structuredPairs += 1;
    else oddPairs += 1;
  }
  score += structuredPairs * 2 - oddPairs * 4;
  return { text, score, strongLocaleMatch: strongLocaleMatch(stats, locale) };
}

function decodeUploadedText(rawBuffer, localeHint = '') {
  try {
    const iconv = require('iconv-lite');
    const locale = normalizeLocaleHint(localeHint);

    if (rawBuffer.length >= 2 && rawBuffer[0] === 0xff && rawBuffer[1] === 0xfe) {
      return iconv.decode(rawBuffer, 'utf-16le');
    }
    if (rawBuffer.length >= 2 && rawBuffer[0] === 0xfe && rawBuffer[1] === 0xff) {
      return iconv.decode(rawBuffer, 'utf16-be');
    }
    if (rawBuffer.length >= 3 && rawBuffer[0] === 0xef && rawBuffer[1] === 0xbb && rawBuffer[2] === 0xbf) {
      return iconv.decode(rawBuffer, 'utf8');
    }

    const bomlessUtf16 = detectBomlessUtf16(rawBuffer);
    if (bomlessUtf16) return iconv.decode(rawBuffer, bomlessUtf16);

    const utf8Decoded = iconv.decode(rawBuffer, 'utf8');
    if (!utf8Decoded.includes('�')) return utf8Decoded;

    const candidates = ['gbk', 'big5', 'shift_jis', 'euc-kr']
      .map((encoding) => legacyDecodeScore(rawBuffer, encoding, iconv))
      .sort((a, b) => b.score - a.score);
    const bestLegacy = candidates[0];

    // UI 會把目前五語介面 locale 一起送上來。只有拿得到語言提示時，才嘗試辨識「無 BOM、
    // 又沒有 ASCII/NUL 特徵」的純 CJK UTF-16 TXT；沒有提示時維持舊式編碼優先，避免亂猜。
    // 如果 legacy 最佳候選本身已經是乾淨、合理的中日韓/英文文字，就直接相信內容判定，
    // 不能因為 UI 語言不同而讓 UTF-16 fallback 搶走正常 Big5/GBK/Shift-JIS/EUC-KR/CP949。
    const legacyLooksStrong = bestLegacy?.text
      ? strongSupportedLanguage(textStats(bestLegacy.text))
      : false;
    if (locale && !legacyLooksStrong && rawBuffer.length % 2 === 0 && !hasSingleByteLyricSyntax(rawBuffer)) {
      const utf16Candidates = ['utf-16le', 'utf16-be']
        .map((encoding) => utf16DecodeScore(rawBuffer, encoding, iconv, locale))
        .sort((a, b) => b.score - a.score);
      // 無 BOM 純 CJK UTF-16 與 Big5/GBK/Shift-JIS/EUC-KR 有少數位元組序列天生模糊；
      // 必須明顯勝出才採 UTF-16，避免短歌詞 + [ar]/[ti] 標籤被語系提示反向誤判。
      const bestUtf16 = utf16Candidates[0];
      const legacyScore = bestLegacy?.score ?? Number.NEGATIVE_INFINITY;
      if (bestUtf16?.score >= legacyScore + 30
        || (bestUtf16?.strongLocaleMatch && bestUtf16.score >= legacyScore)) {
        return bestUtf16.text;
      }
    }

    return bestLegacy?.text || utf8Decoded;
  } catch (e) {
    return rawBuffer.toString('utf8');
  }
}

module.exports = { decodeUploadedText };
