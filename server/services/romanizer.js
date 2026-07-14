/**
 * 羅馬拼音轉換器 v2 (Phase 4)
 * 
 * 支援：
 * - 日文假名 → 羅馬拼音（使用 Hepburn 式）
 * - 日文漢字 → 假名（kuromoji 形態素分析）→ 羅馬拼音
 * - 韓文諺文 → 羅馬拼音（使用修訂羅馬法）
 * 
 * 每句歌詞的 phonetic 欄位供前端顯示「原文 / 羅馬拼音 / 原文+拼音」
 * KRC 逐字模式：每個 word 物件含 phonetic 欄位
 */

// kuromoji 採安全載入：套件損毀或未安裝時降級到內建漢字表，不會讓伺服器崩潰
let kuromoji = null;
try {
  kuromoji = require('kuromoji');
} catch (e) {
  // 延後到 logger 初始化後再警告
}
const { createLogger } = require('../utils/logger');
const log = createLogger('Romanizer');
const { addXieyin } = require('./xieyin');

// 中文漢語拼音（安全載入：套件缺失時降級，不讓伺服器崩潰）
let pinyinPro = null;
try {
  pinyinPro = require('pinyin-pro');
} catch (e) {
  // 延後到 logger 就緒後警告
}

if (!kuromoji) {
  log.warn('kuromoji 套件不可用，漢字讀音將使用內建詞表降級');
}
if (!pinyinPro) {
  log.warn('pinyin-pro 套件不可用，中文歌詞將不產生漢語拼音');
}

// ═══════════════════════════════════════════
// kuromoji tokenizer 單例（延遲初始化）
// ═══════════════════════════════════════════

let _tokenizer = null;
let _tokenizerReady = false;
let _tokenizerPromise = null;

/**
 * 初始化 kuromoji tokenizer（異步，僅執行一次）
 * @returns {Promise<object>} kuromoji tokenizer
 */
function getKuromojiTokenizer() {
  if (_tokenizerReady && _tokenizer) {
    return Promise.resolve(_tokenizer);
  }
  if (_tokenizerPromise) {
    return _tokenizerPromise;
  }
  if (!kuromoji) {
    return Promise.reject(new Error('kuromoji 套件不可用'));
  }

  _tokenizerPromise = new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: __dirname + '/../../node_modules/kuromoji/dict' }).build((err, tokenizer) => {
      if (err) {
        log.warn('kuromoji 初始化失敗，將使用內建漢字表降級: ' + err.message);
        _tokenizerPromise = null;
        reject(err);
        return;
      }
      _tokenizer = tokenizer;
      _tokenizerReady = true;
      log.info('✓ kuromoji 形態素分析器已就緒');
      resolve(tokenizer);
    });
  });

  return _tokenizerPromise;
}

// 啟動時預先初始化（不阻擋）
getKuromojiTokenizer().catch(() => {});

// ═══════════════════════════════════════════
// 日文假名 → 羅馬拼音對照表 (Hepburn 式)
// ═══════════════════════════════════════════

const HIRAGANA_ROMAJI = {
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
  'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
  'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
  'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
  'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
  'わ': 'wa', 'を': 'wo', 'ん': 'n',
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
  'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
  'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
  'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
  'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
  'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
  'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
  'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
  'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
  'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
  'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
  'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
  'ぱゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
  // 小假名
  'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o',
  'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo',
  'っ': '', // 促音單獨不發音，需結合下一個子音
  'ゎ': 'wa',
};

const KATAKANA_ROMAJI = {};
const hiraKeys = Object.keys(HIRAGANA_ROMAJI);
// \u5C07\u5E73\u5047\u540D\u2192\u7F85\u99AC\u5B57\u8868\u9010\u300C\u5B57\u300D\u8F49\u6210\u7247\u5047\u540D key\u3002
// \u6CE8\u610F\uFF1A\u62D7\u97F3 key\uFF08\u5982\u300C\u306B\u3087\u300D\uFF09\u6709\u5169\u500B\u5B57\u5143\uFF0C\u5FC5\u9808\u6574\u4E32\u9010\u5B57\u8F49\uFF0C
// \u5426\u5247\u53EA\u53D6\u7B2C\u4E00\u5B57 charCodeAt(0) \u6703\u8B93\u300C\u30CB\u300D\u88AB\u300C\u306B\u3087\u300D\u8986\u5BEB\u6210 'nyo'\uFF08\u55AE\u7247\u5047\u540D\u5168\u6BC0\uFF09\u3002
for (const hira of hiraKeys) {
  let kata = '';
  let ok = true;
  for (const ch of hira) {
    const k = String.fromCharCode(ch.charCodeAt(0) + 0x60);
    if (k >= '\u30A0' && k <= '\u30FF') kata += k;
    else { ok = false; break; }
  }
  // \u55AE\u5B57\u5143\u624D\u8986\u5BEB\uFF0C\u907F\u514D\u62D7\u97F3\u6574\u4E32\u82E5\u5DF2\u5B58\u5728\u6642\u610F\u5916\u84CB\u6389\uFF1B\u591A\u5B57\u5143\u53EA\u5728\u4E0D\u5B58\u5728\u6642\u52A0\u5165
  if (ok && kata) {
    if (kata.length === 1 || KATAKANA_ROMAJI[kata] === undefined) {
      KATAKANA_ROMAJI[kata] = HIRAGANA_ROMAJI[hira];
    }
  }
}
KATAKANA_ROMAJI['ー'] = '-';
KATAKANA_ROMAJI['・'] = ' ';
KATAKANA_ROMAJI['ヴ'] = 'vu';

// ═══════════════════════════════════════════
// 日文漢字讀音對照表（歌詞常見詞彙，降級用）
// ═══════════════════════════════════════════

const KANJI_READINGS = {
  // ─── 詞組（優先匹配）───
  '存在証明': 'sonzai shoumei',
  '一緒に': 'issho ni',
  '一生': 'isshou',
  '結局': 'kekkyoku',
  '一人': 'hitori',
  '曖昧': 'aimai',
  '勝手': 'katte',
  '大体': 'daitai',
  '自信': 'jishin',
  '味気ない': 'ajikenai',
  '人間': 'ningen',
  '最高': 'saikou',
  '存在': 'sonzai',
  '証明': 'shoumei',
  '過ごし': 'sugoshi',
  '分かり合え': 'wakariae',
  '変わり': 'kawari',
  '並べて': 'narabete',
  '離れ': 'hanare',
  '忘れ': 'wasure',
  '得られ': 'erare',
  '泣かす': 'nakasu',
  '居て': 'ite',
  '食べたい': 'tabetai',
  '頂戴': 'choudai',
  '残って': 'nokotte',
  '残る': 'nokoru',
  '教えて': 'oshiete',
  '会いたく': 'aitaku',
  '言えない': 'ienai',
  '言える': 'ieru',
  '忘れて': 'wasurete',
  '欲しい': 'hoshii',
  '離れないで': 'hanarenaide',
  // ─── 單字 ───
  '愛': 'ai', '君': 'kimi', '夜': 'yoru', '涙': 'namida',
  '傍': 'soba', '胸': 'mune', '心': 'kokoro', '夢': 'yume',
  '空': 'sora', '風': 'kaze', '雨': 'ame', '雪': 'yuki',
  '花': 'hana', '星': 'hoshi', '月': 'tsuki', '日': 'hi',
  '時': 'toki', '声': 'koe', '手': 'te', '目': 'me',
  '顔': 'kao', '足': 'ashi', '口': 'kuchi', '耳': 'mimi',
  '息': 'iki', '命': 'inochi', '魂': 'tamashii', '光': 'hikari',
  '影': 'kage', '闇': 'yami', '色': 'iro', '音': 'oto',
  '歌': 'uta', '詩': 'uta', '物': 'mono', '事': 'koto',
  '人': 'hito', '女': 'onna', '男': 'otoko', '子': 'ko',
  '友': 'tomo', '家族': 'kazoku', '世界': 'sekai', '未来': 'mirai',
  '過去': 'kako', '今日': 'kyou', '明日': 'ashita', '昨日': 'kinou',
  '春': 'haru', '夏': 'natsu', '秋': 'aki', '冬': 'fuyu',
  '朝': 'asa', '夕': 'yuu', '晩': 'ban', '晩餐': 'bansan',
  '水': 'mizu', '海': 'umi', '山': 'yama', '川': 'kawa',
  '道': 'michi', '街': 'machi', '家': 'ie', '部屋': 'heya',
  '窓': 'mado', '扉': 'tobira', '鍵': 'kagi', '橋': 'hashi',
  '痛み': 'itami', '嬉し': 'ureshi', '楽し': 'tanoshi',
  '悲し': 'kanashi', '寂し': 'sabishi', '怖い': 'kowai',
  '強い': 'tsuyoi', '弱い': 'yowai', '美しい': 'utsukushii',
  '優しい': 'yasashii', '激しい': 'hageshii', '大切': 'taisetsu',
  '一番': 'ichiban', '全部': 'zenbu', '何': 'nani', '何も': 'nanimo',
  '誰': 'dare', '誰か': 'dareka', '誰も': 'daremo',
  '私': 'watashi', '僕': 'boku', '俺': 'ore', '自分': 'jibun',
  '行く': 'iku', '来る': 'kuru', '帰る': 'kaeru',
  '見る': 'miru', '聞く': 'kiku', '話す': 'hanasu',
  '読む': 'yomu', '書く': 'kaku', '歌う': 'utau', '踊る': 'odoru',
  '泣く': 'naku', '笑う': 'warau', '叫ぶ': 'sakebu',
  '願う': 'negau', '祈る': 'inoru', '信じる': 'shinjiru',
  '知る': 'shiru', '分かる': 'wakaru', '待つ': 'matsu',
  '探す': 'sagasu', '見つける': 'mitsukeru', '失う': 'ushinau',
  '守る': 'mamoru', '壊す': 'kowasu', '作る': 'tsukuru',
  '生きる': 'ikiru', '死ぬ': 'shinu', '戦う': 'tatakau',
  '始まる': 'hajimaru', '終わる': 'owaru', '続く': 'tsuzuku',
  '変わる': 'kawaru', '消える': 'kieru', '輝く': 'kagayaku',
  '咲く': 'saku', '散る': 'chiru', '落ちる': 'ochiru',
  '流れる': 'nagareru', '抱く': 'daku', '触れる': 'fureru',
  '繋ぐ': 'tsunagu', '切る': 'kiru', '抜く': 'nuku',
  '思う': 'omou', '感じる': 'kanjiru', '考える': 'kangaeru',
  '決める': 'kimeru', '選ぶ': 'erabu', '約束': 'yakusoku',
  '感謝': 'kansha', '許す': 'yurusu', '早く': 'hayaku',
  '違う': 'chigau', '無理': 'muri', '合う': 'au',
  'スパイス': 'supaisu', 'フルコース': 'furu koosu',
  '最': 'sai', '高': 'kou', '高く': 'takaku', '高い': 'takai',
  '生': 'sei', '泣': 'naki', '泣き': 'naki', '餐': 'san',
};

// ═══════════════════════════════════════════
// 韓文諺文 → 羅馬拼音
// ═══════════════════════════════════════════

const KOR_INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const KOR_VOWELS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// 28 個終聲（收音）對應修訂羅馬法的發音值。舊版陣列只有 27 個且中段錯位，
// 導致 ㅁ→k、ㅂ→m、ㅍ→t 等尾音全錯（사람→sarak、함께→hakkke）。以下為正確 28 項。
//                    ∅   ㄱ   ㄲ   ㄳ   ㄴ   ㄵ   ㄶ   ㄷ   ㄹ   ㄺ   ㄻ   ㄼ   ㄽ   ㄾ   ㄿ   ㅀ   ㅁ   ㅂ   ㅄ   ㅅ   ㅆ   ㅇ    ㅈ   ㅊ   ㅋ   ㅌ   ㅍ   ㅎ
const KOR_FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

/**
 * 判斷文字是否包含日文假名或漢字
 */
function isJapanese(text) {
  return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text);
}

/**
 * 判斷文字是否包含韓文諺文
 */
function isKorean(text) {
  return /[\uAC00-\uD7AF]/.test(text);
}

/**
 * \u5224\u65B7\u6587\u5B57\u662F\u5426\u542B\u5047\u540D\uFF08\u5340\u5206\u4E2D\u6587 vs \u65E5\u6587\uFF09
 */
function hasKana(text) {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
}

/**
 * \u5224\u65B7\u6587\u5B57\u662F\u5426\u70BA\u4E2D\u6587\uFF08\u542B\u6F22\u5B57\u3001\u4F46\u4E0D\u542B\u5047\u540D\uFF09
 */
function isChinese(text) {
  return /[\u4E00-\u9FFF]/.test(text) && !hasKana(text);
}

/**
 * \u6F22\u5B57 \u2192 \u6F22\u8A9E\u62FC\u97F3\uFF08\u5E36\u8072\u8ABF\u7B26\u865F\uFF09\u3002pinyin-pro \u4E0D\u53EF\u7528\u6642\u539F\u6A23\u56DE\u50B3\u3002
 */
function chineseToPinyin(text) {
  if (!text) return '';
  if (!pinyinPro || typeof pinyinPro.pinyin !== 'function') return text;
  try {
    return pinyinPro.pinyin(text, { toneType: 'symbol', nonZh: 'consecutive' }).trim();
  } catch (e) {
    return text;
  }
}

/**
 * \u6574\u9996\u6B4C\u8A9E\u8A00\u5224\u5B9A\uFF1A\u6709\u5047\u540D\u2192ja\uFF1B\u5426\u5247\u6709\u8AFA\u6587\u2192ko\uFF1B\u5426\u5247\u6709\u6F22\u5B57\u2192zh\uFF1B\u90FD\u6C92\u6709\u2192null\u3002
 * \u5728\u6B4C\u8A5E\u300C\u6574\u9996\u300D\u5C64\u7D1A\u5224\u65B7\uFF0C\u907F\u514D\u55AE\u4E00\u6F22\u5B57\u8A5E\u88AB\u8AA4\u5224\uFF08\u65E5\u6587\u6F22\u5B57 vs \u4E2D\u6587\uFF09\u3002
 */
function detectSongLang(lines) {
  if (!Array.isArray(lines)) return null;
  let kana = false, hangul = false, hanzi = false;
  for (const l of lines) {
    const t = (l && l.text) || '';
    if (hasKana(t)) kana = true;
    if (/[\uAC00-\uD7AF]/.test(t)) hangul = true;
    if (/[\u4E00-\u9FFF]/.test(t)) hanzi = true;
  }
  if (kana) return 'ja';
  if (hangul) return 'ko';
  if (hanzi) return 'zh';
  return null;
}

/**
 * \u4F9D\u6307\u5B9A\u8A9E\u8A00\u628A\u4E00\u6BB5\u6587\u5B57\u8F49\u6210\u7F85\u99AC\u62FC\u97F3/\u6F22\u8A9E\u62FC\u97F3\uFF08\u65E5\u6587\u8D70 kuromoji \u975E\u540C\u6B65\u8DEF\u5F91\uFF09
 */
async function romanizeWithLang(text, lang) {
  if (!text) return '';
  if (lang === 'ko') return koreanToRomaja(text);
  if (lang === 'zh') return chineseToPinyin(text);
  if (lang === 'ja') return japaneseToRomajiWithKuromoji(text);
  return text;
}

/**
 * 判斷文字是否包含日文漢字（不含假名也可能需要羅馬化）
 */
function hasKanji(text) {
  return /[\u4E00-\u9FFF]/.test(text);
}

// ═══════════════════════════════════════════
// kuromoji 形態素分析 → 羅馬拼音
// ═══════════════════════════════════════════

/**
 * 使用 kuromoji 將含漢字的文字轉為羅馬拼音
 * @param {string} text - 包含漢字/假名的文字
 * @returns {Promise<string>} 羅馬拼音
 */
async function japaneseToRomajiWithKuromoji(text) {
  if (!hasKanji(text)) {
    // 無漢字，直接用假名表轉換
    return japaneseToRomaji(text);
  }

  try {
    const tokenizer = await getKuromojiTokenizer();
    const tokens = tokenizer.tokenize(text);

    let result = '';
    let prevPos = 1; // 1 = 名詞, 2 = 動詞, etc.

    for (const token of tokens) {
      const pos = token.pos;
      const reading = token.reading || '';
      const surface = token.surface_form;

      // 用 reading（片假名）轉羅馬拼音
      if (reading && /[\u30A0-\u30FF]/.test(reading)) {
        const romaji = katakanaToRomaji(reading);
        // 詞性邊界加空格
        if (result.length > 0 && shouldAddSpace(prevPos, pos)) {
          result += ' ';
        }
        result += romaji;
      } else {
        // 沒有 reading（可能是標點、數字等），嘗試用假名表或保留
        const romaji = japaneseToRomaji(surface);
        if (romaji && romaji.trim()) {
          result += romaji;
        }
      }

      prevPos = pos;
    }

    return result.replace(/\s+/g, ' ').trim();
  } catch (e) {
    // kuromoji 失敗，降級到內建漢字表
    log.warn('kuromoji 處理失敗，降級到內建漢字表: ' + e.message);
    return japaneseToRomaji(text);
  }
}

/**
 * 片假名轉羅馬拼音
 */
function katakanaToRomaji(text) {
  let result = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1] || '';

    // 促音
    if (char === 'ッ') {
      const nextRomaji = KATAKANA_ROMAJI[next] || '';
      if (nextRomaji.length > 0) {
        result += nextRomaji[0];
      }
      i++;
      continue;
    }

    // 拗音
    const twoChar = char + next;
    if (KATAKANA_ROMAJI[twoChar]) {
      result += KATAKANA_ROMAJI[twoChar];
      i += 2;
      continue;
    }

    // 單字元
    if (KATAKANA_ROMAJI[char]) {
      result += KATAKANA_ROMAJI[char];
      i++;
      continue;
    }

    // 非片假名字元
    result += char;
    i++;
  }

  return result;
}

/**
 * 根據詞性判斷是否需要加空格
 */
function shouldAddSpace(prevPos, currentPos) {
  // 「附著型」詞性接在前一個詞後面，前面不加空格：助詞(に/を/は)、助動詞(た/ない)、接尾詞、記号
  if (currentPos === '助詞' || currentPos === '助動詞' || currentPos === '接尾詞' || currentPos === '記号') {
    return false;
  }
  // 接頭詞(お/ご…)附著到「後面」的詞，所以它後面那個詞不加空格
  if (prevPos === '接頭詞') return false;
  // 其餘（名詞/動詞/形容詞/副詞…）視為新的詞，前面加空格
  return true;
}

// ═══════════════════════════════════════════
// 日文假名 → 羅馬拼音（內建漢字表，降級用）
// ═══════════════════════════════════════════

function japaneseToRomaji(text) {
  let result = '';
  let i = 0;

  const maxKanjiLen = Object.keys(KANJI_READINGS).reduce((max, k) => Math.max(max, k.length), 0);

  const particles = new Set(['は', 'が', 'を', 'に', 'で', 'の', 'と', 'も', 'か', 'よ', 'ね', 'な', 'さ', 'や', 'へ', 'まで', 'から', 'けど', 'より', 'しか', 'だけ', 'ほど', 'など', 'つつ', 'ながら']);

  function addSpace() {
    if (result.length > 0 && result[result.length - 1] !== ' ') {
      result += ' ';
    }
  }

  function lastIsSpace() {
    return result.length === 0 || result[result.length - 1] === ' ';
  }

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1] || '';

    // 助詞前加空格
    const twoCharParticle = char + next;
    if (particles.has(twoCharParticle)) {
      addSpace();
      result += HIRAGANA_ROMAJI[twoCharParticle] || (HIRAGANA_ROMAJI[char] + HIRAGANA_ROMAJI[next]);
      i += 2;
      continue;
    }
    if (particles.has(char) && HIRAGANA_ROMAJI[char]) {
      addSpace();
      result += HIRAGANA_ROMAJI[char];
      i++;
      continue;
    }

    // 漢字詞組最長匹配
    let kanjiMatched = false;
    for (let len = Math.min(maxKanjiLen, text.length - i); len >= 1; len--) {
      const substr = text.substring(i, i + len);
      if (KANJI_READINGS[substr]) {
        if (!lastIsSpace()) addSpace();
        result += KANJI_READINGS[substr];
        i += len;
        kanjiMatched = true;
        break;
      }
    }
    if (kanjiMatched) continue;

    // 促音
    if (char === 'っ' || char === 'ッ') {
      const nextRomaji = HIRAGANA_ROMAJI[next] || KATAKANA_ROMAJI[next] || '';
      if (nextRomaji.length > 0) {
        result += nextRomaji[0];
      }
      i++;
      continue;
    }

    // 拗音
    const twoChar = char + next;
    if (HIRAGANA_ROMAJI[twoChar]) {
      result += HIRAGANA_ROMAJI[twoChar];
      i += 2;
      continue;
    }
    if (KATAKANA_ROMAJI[twoChar]) {
      result += KATAKANA_ROMAJI[twoChar];
      i += 2;
      continue;
    }

    // 單字元假名
    if (HIRAGANA_ROMAJI[char]) {
      result += HIRAGANA_ROMAJI[char];
      i++;
      continue;
    }
    if (KATAKANA_ROMAJI[char]) {
      result += KATAKANA_ROMAJI[char];
      i++;
      continue;
    }

    // 標點符號替換為空格
    if (/[、。！？,.!?〜~　]/.test(char)) {
      addSpace();
      i++;
      continue;
    }

    // 非假名字元保留原樣（漢字不在對照表中）
    result += char;
    i++;
  }

  return result.replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════
// 韓文諺文 → 羅馬拼音
// ═══════════════════════════════════════════

function koreanToRomaja(text) {
  let result = '';

  for (const char of text) {
    const code = char.charCodeAt(0);

    if (code >= 0xAC00 && code <= 0xD7AF) {
      const syllableIndex = code - 0xAC00;
      const initialIndex = Math.floor(syllableIndex / 588);
      const vowelIndex = Math.floor((syllableIndex % 588) / 28);
      const finalIndex = syllableIndex % 28;

      const initial = KOR_INITIALS[initialIndex] || '';
      const vowel = KOR_VOWELS[vowelIndex] || '';
      const final_ = KOR_FINALS[finalIndex] || '';

      result += initial + vowel + final_;
    } else {
      result += char;
    }
  }

  return result;
}

// ═══════════════════════════════════════════
// 主羅馬化函數
// ═══════════════════════════════════════════

/**
 * 同步版本（降級用，不含 kuromoji）
 */
function romanize(text) {
  if (!text) return '';

  if (isKorean(text)) {
    return koreanToRomaja(text);
  }

  // 中文（漢字無假名）→ 漢語拼音；需在 isJapanese 之前判斷（isJapanese 也含漢字範圍）
  if (isChinese(text)) {
    return chineseToPinyin(text);
  }

  if (isJapanese(text)) {
    return japaneseToRomaji(text);
  }

  return text;
}

/**
 * 異步版本（含 kuromoji 形態素分析）
 * @param {string} text - 原文
 * @returns {Promise<string>} 羅馬拼音
 */
async function romanizeAsync(text) {
  if (!text) return '';

  if (isKorean(text)) {
    return koreanToRomaja(text);
  }

  if (isChinese(text)) {
    return chineseToPinyin(text);
  }

  if (isJapanese(text)) {
    return japaneseToRomajiWithKuromoji(text);
  }

  return text;
}

// ═══════════════════════════════════════════
// 歌詞羅馬化（批量處理）
// ═══════════════════════════════════════════

/**
 * 為歌詞行生成羅馬拼音（異步，含 kuromoji）
 * @param {Array} lyricsLines - 解析後的歌詞行 [{ time, text, words?, phonetic }]
 * @returns {Promise<Array>} 帶有 phonetic 欄位的歌詞行
 */
async function addRomanization(lyricsLines) {
  if (!lyricsLines || !Array.isArray(lyricsLines)) return [];

  // 整首一次判定語言，避免單一漢字詞被誤判（日文漢字 vs 中文）
  const lang = detectSongLang(lyricsLines);

  const results = [];

  for (const line of lyricsLines) {
    const phonetic = await romanizeWithLang(line.text, lang);

    const result = {
      ...line,
      phonetic,
    };

    // KRC 逐字模式：為每個 word 也加上 phonetic
    if (line.words && Array.isArray(line.words)) {
      result.words = [];
      for (const word of line.words) {
        const wordPhonetic = await romanizeWithLang(word.text, lang);
        result.words.push({
          ...word,
          phonetic: wordPhonetic,
        });
      }
    }

    results.push(result);
  }

  // 諧音只對日文/韓文做（中文用拼音、不需諧音）
  if (lang === 'ja' || lang === 'ko') addXieyin(results);

  return results;
}

/**
 * 同步版本（降級用）
 */
function addRomanizationSync(lyricsLines) {
  if (!lyricsLines || !Array.isArray(lyricsLines)) return [];

  const lang = detectSongLang(lyricsLines);
  const romanizeSync = (text) => {
    if (!text) return '';
    if (lang === 'ko') return koreanToRomaja(text);
    if (lang === 'zh') return chineseToPinyin(text);
    if (lang === 'ja') return japaneseToRomaji(text);
    return text;
  };

  const results = lyricsLines.map((line) => {
    const result = {
      ...line,
      phonetic: romanizeSync(line.text),
    };

    if (line.words && Array.isArray(line.words)) {
      result.words = line.words.map(word => ({
        ...word,
        phonetic: romanizeSync(word.text),
      }));
    }

    return result;
  });

  // 諧音只對日文/韓文做
  if (lang === 'ja' || lang === 'ko') addXieyin(results);

  return results;
}

/**
 * 檢查歌詞是否需要羅馬化（含日文或韓文）
 */
function needsRomanization(lyricsLines) {
  if (!lyricsLines || !Array.isArray(lyricsLines)) return false;
  return lyricsLines.some(line => isJapanese(line.text) || isKorean(line.text));
}

module.exports = {
  romanize,
  romanizeAsync,
  addRomanization,
  addRomanizationSync,
  needsRomanization,
  isJapanese,
  isKorean,
  japaneseToRomaji,
  koreanToRomaja,
  getKuromojiTokenizer,
};
