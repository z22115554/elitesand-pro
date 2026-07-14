/**
 * 中文諧音轉換器（諧音引擎）
 *
 * 核心思路：建立在「羅馬拼音」之上，而不是原文之上。
 * 漢字 → kuromoji 讀音 → 羅馬拼音 的問題已由 romanizer.js 解決，
 * 本模組只負責把羅馬拼音字串切成音節，再逐音節查表轉成中文諧音字。
 *
 * 例：君の中にあるもの → kimi no naka ni aru mono → ki咪 諾 拿卡 尼 阿魯 摸諾
 *
 * 設計原則：
 * - 純函數、零外部依賴，可獨立單元測試
 * - 國語拼音中不存在的音節（ki、gi 等）保留羅馬拼音，符合直播主習慣
 * - 長音自動合併（kodou → ko+dou → 摳豆，不會變成 摳豆烏）
 * - 查不到的音節 fallback 回羅馬拼音，永不報錯、永不丟字
 * - 對照表集中管理，想改用字直接編輯 XIEYIN_TABLE 即可
 */

// ═══════════════════════════════════════════
// 音節 → 中文諧音對照表
// key 一律為小寫羅馬拼音音節
// 值為中文字；國語沒有的音保留羅馬字（如 ki、gi）
// ═══════════════════════════════════════════

const XIEYIN_TABLE = {
  // ─── 母音 ───
  'a': '阿', 'i': '伊', 'u': '烏', 'e': '欸', 'o': '歐',

  // ─── か行 ───
  'ka': '卡', 'ki': 'ki', 'ku': '庫', 'ke': '剋', 'ko': '摳',
  // ─── が行 ───
  'ga': '嘎', 'gi': 'gi', 'gu': '古', 'ge': '葛', 'go': '狗',
  // ─── さ行 ───
  'sa': '撒', 'shi': '西', 'su': '斯', 'se': '瑟', 'so': '搜',
  // ─── ざ行 ───
  'za': '雜', 'ji': '吉', 'zu': '茲', 'ze': '賊', 'zo': '佐',
  // ─── た行 ───
  'ta': '塔', 'chi': '七', 'tsu': '茲', 'te': '貼', 'to': '托',
  // ─── だ行 ───
  'da': '達', 'de': '爹', 'do': '豆',
  // ─── な行 ───
  'na': '拿', 'ni': '尼', 'nu': '努', 'ne': '內', 'no': '諾',
  // ─── は行 ───
  'ha': '哈', 'hi': '希', 'fu': '夫', 'he': '嘿', 'ho': '吼',
  // ─── ば行 ───
  'ba': '巴', 'bi': '比', 'bu': '布', 'be': '貝', 'bo': '波',
  // ─── ぱ行 ───
  'pa': '趴', 'pi': '皮', 'pu': '撲', 'pe': '配', 'po': '坡',
  // ─── ま行 ───
  'ma': '媽', 'mi': '咪', 'mu': '姆', 'me': '咩', 'mo': '摸',
  // ─── や行 ───
  'ya': '呀', 'yu': '尤', 'yo': '唷',
  // ─── ら行 ───
  'ra': '啦', 'ri': '理', 'ru': '魯', 're': '勒', 'ro': '羅',
  // ─── わ行 + 撥音 ───
  'wa': '哇', 'wo': '喔', 'n': '恩',

  // ─── 拗音（きゃ行：國語沒有 ky/gy 音，採 ki+小字 風格）───
  'kya': 'ki呀', 'kyu': 'ki尤', 'kyo': 'ki唷',
  'gya': 'gi呀', 'gyu': 'gi尤', 'gyo': 'gi唷',
  'sha': '夏', 'shu': '咻', 'sho': '休',
  'cha': '恰', 'chu': '啾', 'cho': '秋',
  'ja': '加', 'ju': '居', 'jo': '糾',
  'nya': '妮呀', 'nyu': '妮尤', 'nyo': '妮唷',
  'hya': '希呀', 'hyu': '希尤', 'hyo': '希唷',
  'mya': '咪呀', 'myu': '謬', 'myo': '咪唷',
  'rya': '理呀', 'ryu': '留', 'ryo': '溜',
  'bya': '比呀', 'byu': '比尤', 'byo': '比唷',
  'pya': '皮呀', 'pyu': '皮尤', 'pyo': '皮唷',

  // ─── 外來語音（片假名專用拼法）───
  'fa': '法', 'fi': '菲', 'fe': '費', 'fo': '佛',
  'va': '哇', 'vi': '威', 'vu': '屋', 've': '威', 'vo': '沃',
  'ti': '提', 'di': '迪', 'tu': '圖', 'du': '嘟',
  'wi': '威', 'we': '威', 'she': '謝', 'che': '切', 'je': '傑',
  'tsa': '擦', 'tse': '冊', 'tso': '錯',

  // ─── 韓文羅馬字補充（修訂羅馬法的母音/音節）───
  'eo': '歐', 'eu': '額', 'ae': '欸', 'oe': '威',
  'yeo': '唷', 'yae': '耶', 'ye': '耶',
  'wae': '威', 'weo': '我', 'ui': '威',
  'kk': '', 'tt': '', 'pp': '', 'ss': '', 'jj': '', // 韓文緊音前綴在切分時消化
  'r': '爾', 'l': '爾',
  // 韓文尾音（收音）
  'ng': '嗯', 'k': '克', 't': '特', 'p': '普', 'm': '姆',
};

// ═══════════════════════════════════════════
// 韓文諺文 → 中文諧音（直接分解 Hangul）
//
// 為何不沿用「羅馬字再用正則切」：韓文音節結構是 初聲+中聲(+終聲)，
// 羅馬字化後再切，開頭子音（如 너 neo 的 n）會被誤判成尾音而整詞被拒→保留羅馬字。
// 直接分解諺文音節可精準取得 (初聲, 中聲, 終聲)，每音節穩定產出中文、永不留羅馬字。
// ═══════════════════════════════════════════

const HANGUL_BASE = 0xAC00;
const HANGUL_LAST = 0xD7A3;

// 19 初聲 → Mandarin onset 群組（ㄱㄲㅋ→g；ㄷㄸㅌ→d；ㅂㅃㅍ→b；ㅈㅉ→j；ㅊ→c；ㅇ→0 無聲母）
//                       ㄱ  ㄲ  ㄴ  ㄷ  ㄸ  ㄹ  ㅁ  ㅂ  ㅃ  ㅅ  ㅆ  ㅇ  ㅈ  ㅉ  ㅊ  ㅋ  ㅌ  ㅍ  ㅎ
const KR_CHO_GROUP = ['g','g','n','d','d','l','m','b','b','s','s','0','j','j','c','g','d','b','h'];
// 21 中聲 → 母音 key
const KR_JUNG_KEY = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
// 28 終聲（收音）→ 中文小尾音字（index 0 = 無收音）
const KR_JONG_CN = ['', '克','克','克','恩','恩','恩','特','爾','克','姆','爾','爾','爾','普','爾','姆','普','普','特','特','嗯','特','特','克','特','普','特'];

// (母音 → (onset群組 → 中文字))。純母音 a/ae/e/eo/o/u/eu/i 全 onset 覆蓋；
// 介音(y/w 系)以基準字為主（onset 細節從略，但仍為中文、不留羅馬字）。
const KR_CN = {
  a:  { '0':'阿','g':'嘎','n':'拿','d':'搭','l':'拉','m':'媽','b':'八','s':'撒','j':'扎','c':'擦','h':'哈' },
  ae: { '0':'欸','g':'給','n':'餒','d':'得','l':'勒','m':'梅','b':'貝','s':'塞','j':'賊','c':'冊','h':'黑' },
  e:  { '0':'欸','g':'給','n':'餒','d':'得','l':'勒','m':'梅','b':'貝','s':'塞','j':'賊','c':'冊','h':'黑' },
  eo: { '0':'歐','g':'狗','n':'挪','d':'多','l':'囉','m':'摸','b':'撥','s':'瘦','j':'走','c':'湊','h':'齁' },
  o:  { '0':'歐','g':'狗','n':'諾','d':'多','l':'羅','m':'摸','b':'波','s':'搜','j':'左','c':'錯','h':'吼' },
  u:  { '0':'烏','g':'孤','n':'努','d':'嘟','l':'魯','m':'姆','b':'布','s':'蘇','j':'阻','c':'粗','h':'呼' },
  eu: { '0':'額','g':'格','n':'呢','d':'的','l':'勒','m':'麼','b':'不','s':'絲','j':'資','c':'疵','h':'喝' },
  i:  { '0':'伊','g':'幾','n':'妮','d':'迪','l':'里','m':'米','b':'比','s':'西','j':'吉','c':'七','h':'希' },
  // 介音（基準字）
  ya:'呀', yae:'耶', yeo:'唷', ye:'耶', yo:'唷', yu:'尤',
  wa:'哇', wae:'威', oe:'威', wo:'我', we:'威', wi:'威', ui:'威',
};

function isKoreanText(text) {
  return /[가-힯]/.test(text || '');
}

/**
 * 韓文諺文字串 → 中文諧音（逐字分解，非諺文字元原樣保留）
 * @param {string} text - 含諺文的原文
 * @returns {string}
 */
function koreanToXieyin(text) {
  if (!text) return '';
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const s = code - HANGUL_BASE;
      const cho = Math.floor(s / 588);
      const jung = Math.floor((s % 588) / 28);
      const jong = s % 28;
      const vowel = KR_JUNG_KEY[jung];
      const onset = KR_CHO_GROUP[cho];
      const cell = KR_CN[vowel];
      let cn;
      if (typeof cell === 'string') cn = cell;                 // 介音基準字
      else if (cell) cn = cell[onset] || cell['0'];            // CV 表
      else cn = ch;                                            // 理論上不會發生
      out += cn + (KR_JONG_CN[jong] || '');
    } else {
      out += ch; // 空格 / 標點 / 英文：原樣
    }
  }
  return out.trim();
}

// ═══════════════════════════════════════════
// 羅馬拼音音節切分
// ═══════════════════════════════════════════

/**
 * 音節切分正則：依長度優先匹配
 * 1. 三字母拗音/特殊音 (kya, sha, chu, tsu...)
 * 2. 雙字母 CV (ka, mi, eo, ae...)
 * 3. 單母音 / 單獨子音 (n, k, m...)
 */
const SYLLABLE_REGEX = new RegExp(
  '(' +
  // 拗音與三字母組合（最長優先）
  'kya|kyu|kyo|gya|gyu|gyo|sha|shu|sho|she|cha|chu|cho|che|chi|shi|tsu|tsa|tse|tso|' +
  'nya|nyu|nyo|hya|hyu|hyo|mya|myu|myo|rya|ryu|ryo|bya|byu|byo|pya|pyu|pyo|' +
  'yeo|yae|wae|weo|' +
  // 雙字母音節
  'ja|ju|jo|je|ji|fa|fi|fu|fe|fo|va|vi|vu|ve|vo|' +
  'ka|ki|ku|ke|ko|ga|gi|gu|ge|go|sa|su|se|so|za|zu|ze|zo|' +
  'ta|ti|tu|te|to|da|di|du|de|do|na|ni|nu|ne|no|' +
  'ha|hi|he|ho|ba|bi|bu|be|bo|pa|pi|pu|pe|po|' +
  'ma|mi|mu|me|mo|ya|yu|yo|ye|ra|ri|ru|re|ro|wa|wi|wo|we|' +
  'eo|eu|ae|oe|ui|' +
  // 單母音與獨立子音（n 為撥音；k/t/p/m/ng/r/l 為韓文尾音）
  // ng 加負向預查：後面接母音時應切成 n + g母音（如 ningen → ni-n-ge-n）
  'ng(?![aiueo])|[aiueo]|[nktpmrl]' +
  ')',
  'g'
);

// 長音合併規則：前一音節的尾母音 → 可吸收的後續單母音
const LONG_VOWEL_MERGE = {
  'a': new Set(['a']),
  'i': new Set(['i']),
  'u': new Set(['u']),
  'e': new Set(['e', 'i']),  // ei 長音 (sensei)
  'o': new Set(['o', 'u']),  // ou 長音 (kodou)
};

// ─── 語言驗證（防止英文單字被誤轉，如 love → 爾歐威）───

// 日文合法音節集合（含撥音 n，不含其他獨立子音）
const JP_SYLLABLES = new Set(Object.keys(XIEYIN_TABLE).filter(k =>
  /[aiueo]$/.test(k) || k === 'n'
));

// 韓文特徵音節：英文裡幾乎不會以這種形式被切分出來
const KR_MARKERS = new Set(['eo', 'eu', 'ae', 'oe', 'ui', 'yeo', 'yae', 'wae', 'weo', 'ng']);

// 韓文尾音（收音）：只能出現在母音結尾的音節之後
const KR_FINALS = new Set(['k', 't', 'p', 'm', 'n', 'ng', 'l', 'r']);

/**
 * 驗證切分出的音節序列是否真的是日文/韓文羅馬拼音
 * （而不是恰好能被切開的英文單字）
 */
function isValidRomaji(tokens) {
  // 規則 A：純日文 — 所有音節都在日文音節表中
  if (tokens.every(t => JP_SYLLABLES.has(t))) return true;

  // 規則 B：韓文 — 必須含至少一個韓文特徵音節，
  // 且獨立子音只能作為收音（前一音節須以母音結尾）
  const hasKrMarker = tokens.some(t => KR_MARKERS.has(t));
  if (!hasKrMarker) return false;

  return tokens.every((t, i) => {
    if (/[aiueo]$/.test(t)) return true;          // 母音結尾的音節
    if (t === 'n' || KR_FINALS.has(t) || KR_MARKERS.has(t)) {
      if (t === 'ng' || t === 'n') {
        return i > 0; // 收音不能開頭
      }
      return i > 0 && /[aiueo]$/.test(tokens[i - 1]);
    }
    return false;
  });
}

/**
 * 將一個「詞」的羅馬拼音轉成諧音
 * @param {string} word - 單一詞的羅馬拼音（不含空格），如 "kodou"
 * @returns {string} 諧音字串，如 "摳豆"
 */
function wordToXieyin(word) {
  if (!word) return '';

  let w = word.toLowerCase();

  // 促音（雙子音）簡化：katte → kate、ippai → ipai
  w = w.replace(/([kgsztdnhbpmrwfjv])\1/g, '$1');
  // tch 促音特例：matcha → macha
  w = w.replace(/tch/g, 'ch');
  // 長音符號（katakanaToRomaji 將 ー 轉為 '-'）：直接移除，併入前音節
  w = w.replace(/-/g, '');

  const matches = w.match(SYLLABLE_REGEX);
  if (!matches) return word; // 完全無法切分（純英文單字等）→ 保留原樣

  // 切分覆蓋率檢查：若切出的音節拼回去不等於原字串，
  // 代表這不是羅馬拼音（例如英文歌詞 "love"），保留原樣
  if (matches.join('') !== w) return word;

  // 語言驗證：拼得回去 ≠ 真的是羅馬拼音（"heart" 也能被切開）
  if (!isValidRomaji(matches)) return word;

  // 長音合併：後一個單母音若是前一音節的長音延伸，則吸收
  const merged = [];
  for (const syl of matches) {
    const prev = merged[merged.length - 1];
    if (prev && syl.length === 1 && 'aiueo'.includes(syl)) {
      const prevLast = prev[prev.length - 1];
      if (LONG_VOWEL_MERGE[prevLast] && LONG_VOWEL_MERGE[prevLast].has(syl)) {
        continue; // 吸收長音，不產生新字
      }
    }
    merged.push(syl);
  }

  let result = '';
  for (const syl of merged) {
    const mapped = XIEYIN_TABLE[syl];
    result += (mapped !== undefined) ? mapped : syl; // 查不到 → 保留羅馬字
  }
  return result;
}

/**
 * 將整行羅馬拼音轉成中文諧音
 * @param {string} romaji - 羅馬拼音字串（以空格分詞），如 "kimi no naka ni aru mono"
 * @returns {string} 諧音字串，如 "ki咪 諾 拿卡 尼 阿魯 摸諾"
 */
function romajiToXieyin(romaji) {
  if (!romaji || typeof romaji !== 'string') return '';

  return romaji
    .split(/\s+/)
    .map(wordToXieyin)
    .join(' ')
    .trim();
}

/**
 * 判斷一行是否值得產生諧音
 * （已有羅馬拼音、且原文不是純中文/英文）
 */
function shouldXieyin(line) {
  if (!line || !line.phonetic) return false;
  // 原文含日文假名或韓文 → 需要諧音
  return /[\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(line.text || '') ||
         // 原文含漢字且 phonetic 與原文不同（日文漢字已被羅馬化）
         (/[\u4E00-\u9FFF]/.test(line.text || '') && line.phonetic !== line.text);
}

/**
 * 批量為歌詞行加上 xieyin 欄位（就地修改並回傳）
 * 必須在 addRomanization 之後呼叫（依賴 phonetic 欄位）
 * @param {Array} lyricsLines - 歌詞行陣列
 * @returns {Array} 加上 xieyin 欄位的歌詞行
 */
function addXieyin(lyricsLines) {
  if (!lyricsLines || !Array.isArray(lyricsLines)) return [];

  for (const line of lyricsLines) {
    if (shouldXieyin(line)) {
      // 韓文：直接分解諺文原文（不經羅馬字再切，避免開頭子音被誤判→保留羅馬字）
      line.xieyin = isKoreanText(line.text) ? koreanToXieyin(line.text) : romajiToXieyin(line.phonetic);
    }
    // KRC 逐字模式：每個 word 也加上 xieyin
    if (line.words && Array.isArray(line.words)) {
      for (const word of line.words) {
        if (word.text && /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(word.text)) {
          word.xieyin = isKoreanText(word.text)
            ? koreanToXieyin(word.text)
            : (word.phonetic ? romajiToXieyin(word.phonetic) : '');
        }
      }
    }
  }
  return lyricsLines;
}

module.exports = {
  romajiToXieyin,
  wordToXieyin,
  koreanToXieyin,
  addXieyin,
  shouldXieyin,
  XIEYIN_TABLE,
};
