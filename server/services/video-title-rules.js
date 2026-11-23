'use strict';

/**
 * YouTube 影片標題清理用的資料與小工具：干擾詞表、括號雜訊、廠牌／搬運頻道、已知歌手清單。
 * 歌手／歌名怎麼從標題拆出來的主流程在 audio-processor.js 的 parseVideoTitle；
 * 要新增干擾詞或歌手，改這個檔案就好。
 */

// ─── 標題解析干擾詞過濾表 ───
const NOISE_PATTERNS = [
  // 結尾的 hashtag（「晴天 - 周杰倫 #shorts #jaychou」）：要帶字母才算，「We Are #1」的 #1 不動。
  // 前面一定要有一個不是 hashtag 的字，整串都是 hashtag（「#周杰倫 #晴天」）時不剝。
  /(?<=(?:^|\s)[^#\s]\S*)(?:\s+#[^\s#]*\p{L}[^\s#]*)+\s*$/gu,
  // 一小時循環版：括號包住的「(1小時版)」「【一小時循環】」「[1 hour]」，或沒括號但帶著 loop／版／循環的
  // 「Loop 1 hour」「1 hour loop」。光是「一小時」不剝——那可能就是歌名。
  /[（(【\[]\s*(?<!\d)[1一]\s*(?:小時|小时|hours?|hr)\s*(?:版|循環|循环|loop|ver(?:sion)?\.?)?\s*[）)】\]]/gi,
  /\s*(?:(?<!\d)[1一]\s*(?:小時|小时|hours?|hr)\s*(?:版|循環|循环|loop)|\bloop\s*[1一]\s*(?:hours?|hr|小時|小时))/gi,
  // 括號內混雜多個宣傳詞（例如「(官方完整版MV)」＝官方＋完整版＋MV 疊在一起）時，
  // 下面逐一比對的規則只咬得到其中一個詞，另一個詞跟落單的括號會殘留變成尾綴垃圾
  // （見踩坑：「月亮惹的禍 Troubled By The Moon )」多出一個沒配對的右括號）。
  // 先把整個「含宣傳詞的括號」整組吃掉，後面逐一比對的規則才不會咬到只剩半個括號。
  /[（(][^（）()]{0,24}(?:官方|完整版|精華版|精华版|首播|MV|音樂錄影帶|音乐录影带)[^（）()]{0,24}[）)]/gi,
  // 官方相關（中英日）
  /\(?\s*Official\s*(Music\s*)?Video\s*\)?/gi,
  /\(?\s*Official\s*(Audio|Lyric|Visualizer)\s*Video?\s*\)?/gi,
  /\(?\s*官方(?:MV|音樂錄影帶|Music\s*Video)?\s*\)?/gi,
  // 後面直接接文字（中日文不會有 \b）就是名字的一部分：Official髭男dism 不能被砍成「髭男dism」。
  /\(?\s*\bOfficial(?![\p{L}\p{N}])\s*\)?/giu,
  /\bMV\b/gi,
  // 'M/V'（含上傳者用來繞過 YouTube 檔名限制的 ⧸ ∕ ⁄，正規化後都是 '/'）。要在這裡吃掉，
  // 否則後面的 '/' 分隔規則會把 'Aimer - 花の唄 M/V' 切成歌手『…M』、歌名『V』。
  /\(?\s*M\s*[/.]\s*V\s*\)?/gi,
  /\bPV\b/gi,
  // 畫質相關
  /\(?\s*\b(HD|4K|8K|UHD|HDR)\b\s*\)?/gi,
  // 只認 Remaster(ed)／Mastered：舊版連單獨的 master 都吃，Mastermind 變 mind、Master of Puppets 被拆爛。
  /\(?\s*(?:\d{4}\s+)?(?:\d+K\s*)?\b(?:re-?master(?:ed)?|mastered)\b(?:\s+\d{4})?\s*\)?/gi,
  /\(?\s*\d{3,4}p\s*(?:HD)?\s*\)?/gi,
  // 版本相關
  /\(?\s*Full\s*Ver(?:sion)?\s*\)?/gi,
  /\(?\s*Short\s*Ver(?:sion)?\s*\)?/gi,
  /\(?\s*Lyric\s*Video\s*\)?/gi,
  /\(?\s*Music\s*Video\s*\)?/gi,
  // 語言/字幕相關
  // CC／Subtitle 必須是完整單字：舊版 Accept 會被砍成 Aept、Success 變 Suess。
  /\(?\s*(中文字幕|中文歌詞|日文字幕|英文字幕|繁體中文|简体中文|\bCC\b|\bSubtitles?\b)\s*\)?/gi,
  // 發行相關
  /\(?\s*(新曲|\bNew\s*Release\b|\bLatest\b)\s*\)?/gi,
  // 音質/格式行銷字樣：轉貼/合輯頻道常見（例：「張宇 傘下 無損音樂FLAC 純享」），不屬於正式
  // 歌名，混進去會同時污染顯示的歌名跟歌詞搜尋 query（見 issue #9：歌詞比對成另一首歌）。
  /\(?\s*(?:無損|无损)(?:音樂|音乐|音質|音质)?\s*\)?/gi,
  /\bFLAC\b/gi,
  /\(?\s*(?:純享|纯享|精享|臻享)(?:版)?\s*\)?/gi,
  /\(?\s*(?:高音質|高音质|極致音質|极致音质|母帶|母带)\s*\)?/gi,
  // 特殊標記
  // 必須是完整單字：舊版 Eclipse 會被砍成 Ese（含 clip）、Credit 變 Cr（含 edit）。
  // 「Radio Edit」整組拿掉（電台剪輯版歌詞相同）；只拿掉 Edit 會留下一個「Radio」被當成歌手。
  /\s*[-–—]?\s*\(?\s*\bRadio\s+Edit\b\s*\)?/gi,
  /\(?\s*\b(Promo|Teaser|Preview|Clip|Edit)\b\s*\)?/gi,
  /[【「『《〈][^】」』》〉]*(?:伴奏|動態|动态|字幕|歌詞|歌词|中[日英韓韩]?字|[日英韓韩]中字|雙語|双语)[^】」』》〉]*[】」』》〉]/gi,
  // 歌詞影片／頻道常見標記
  /\(?\s*(?:動態歌詞|动态歌词|歌詞Lyrics|歌词Lyrics|歌詞字幕|歌词字幕|歌詞拼音|歌词拼音|歌詞|歌词|\bLyrics?\b|歌回剪輯|歌回剪辑|歌雜剪輯|歌杂剪辑)\s*\)?/gi,
  // 伴奏版本不屬於正式歌名；原字串仍保留在 originalName
  /\(?\s*(?:(?:原版|女版|男版|純|纯)?伴奏(?:歌詞|歌词)?(?:版)?|KTV(?:伴奏)?(?:歌詞|歌词)?(?:版)?|卡拉\s*OK|卡拉OK|純音樂|纯音乐|去人聲|去人声|無人聲|无人声|消音(?:版)?|導唱(?:版)?|导唱(?:版)?|吉他伴奏(?:版)?|[鋼钢]琴(?:和弦|伴奏)?版|[鋼钢]琴(?:和弦|伴奏)|(?<![^\s(（【\[])[鋼钢]琴(?![^\s)）】\]])|Live\s*Band原創伴奏改編|Karaoke(?:\s*Version)?|Instrumental(?:\s*Version)?|Off\s*Vocal|Backing\s*Track|with\s*backing\s*vocals)\s*\)?/gi,
  /\(?\s*(?:原調|原调)(?:伴奏)?\s*\)?/gi,
  // 單獨的 Key 必須後面接調號（Key+2、Key C、(Key)）才算噪音：舊版沒有詞邊界，
  // Arctic Monkeys 變 Arctic Mons、Alicia Keys 變 Alicias、Whiskey 變 Whis。
  /\(?\s*(?:男|女|升|降)\s*Key\s*(?:[+#-]?\s*\d+|[A-G](?:b|#)?(?![A-Za-z]))?\s*\)?/gi,
  /\(?\s*\bKey\s*(?:[+#-]?\s*\d+|[A-G](?:b|#)?(?![A-Za-z]))\s*\)?/gi,
  /\(\s*Key\s*\)/gi,
  // 調號寫在 Key 前面（KTV 伴奏常見：「-2Key」「+1key」「降2Key」「升3key」）。
  /\(?\s*(?:[+-]|升|降)\s*\d+\s*key\b\s*\)?/gi,
  /\(?\s*(?:男調|女調|男调|女调)\s*\)?/gi,
  /\(?\s*[+#-]?\s*[A-G](?:b|#)?\s*調\s*\)?/gi,
  /\(?\s*(?:女版|男版|女生版|男生版)\s*\)?/gi,
  /\(?\s*(?:Female|Male)\s*Version\s*\)?/gi,
  // 翻唱/版本標記（放在標題末尾的）
  /\s+(Cover|翻唱|covered\s+by|arrangement|arr\.)\s*$/gi,
  // 翻唱在詞中（不限末尾）。Cover 要是完整單字：舊版連 covered 的 cover 都吃掉，
  // 「ヒバナ / DECO*27 covered by 星街すいせい」的歌手變成「DECO*27ed by 星街すいせい」。
  // 兩邊都是英文單字時是歌名的一部分（Under Cover of Darkness），不動；cover by 留給後面的規則拆翻唱者。
  // 只吃掉字本身、留一個空白，「晴天 Cover 某某」才不會黏成「晴天某某」。
  /\s+(?:(?<=[^\sA-Za-z]\s+)Cover|Cover(?=\s+[^\sA-Za-z]|\s*$))(?![A-Za-z])(?!\s+by\b)|\s+翻唱(?=\s|$|[^\p{L}\p{N}])/giu,
  // 高頻出現的括號後綴
  /\(\d{4}\)/g,
  // 清理殘留的空括號
  /\(\s*\)/g,
];

// 括號組整組清除／修復：NOISE_PATTERNS 是「逐個詞」比對，一個括號裡塞兩個以上宣傳詞時
// 只會咬掉其中一個，剩下半組括號就變成尾綴垃圾（'I miss you more 版)'、'(Eng/Rom/Han'
// 都是 2026-08-30 清庫時實際撿到的指紋）。所以先把「整組都是噪音」的括號吃掉，最後再修
// 不成對的括號。刻意不含 Ver／Version：'K歌之王 AIR (Day Version)' 的括號是歌名的一部分。
const BRACKET_NOISE_WORD = /官方|完整版|精華版|精华版|首播|音樂錄影帶|音乐录影带|動態歌詞|动态歌词|歌詞|歌词|字幕|拼音|\bMV\b|\bPV\b|\bM\/V\b|Official|Lyrics?|Audio|Karaoke|卡拉\s*OK|伴奏|純音樂|纯音乐|去人聲|去人声|Live|\bHD\b|\b[48]K\b|\bUHD\b|\bHDR\b|Remaster(?:ed)?|中文|英文|日文|韓文|韩文|\bEng\b|\bRom\b|\bHan\b|國語|国语|粵語|粤语|台語|台语/i;
// 只有「整組就是這幾個字」才算噪音（'(國)'、'(粵語版)'）；出現在別的字裡不算。
const BRACKET_NOISE_EXACT = /^(?:版|(?:國|国|粵|粤|台|日|韓|英|中)(?:語|语)?版?)$/;

function stripNoiseBracketGroups(value) {
  const source = String(value || '');
  return source.replace(/[（(]([^（）()]{0,24})[）)]/g, (whole, inner, offset) => {
    const content = inner.trim();
    const isNoise = !content || BRACKET_NOISE_EXACT.test(content) || BRACKET_NOISE_WORD.test(content);
    if (!isNoise) return whole;
    // 兩側都直接貼著字時，這組括號本身就是唯一的分隔（'周杰倫（KTV、伴奏）LukeForSong'
    // ——上傳者把頻道署名黏在歌手後面）。刪成空字串會黏成一個詞，換成空白又會讓署名變成
    // 歌手名的一部分；換成頓號才會走到 cleanIdentityPart() 既有的「已知歌手 + 頓號後截斷」。
    const before = source[offset - 1];
    const after = source[offset + whole.length];
    const glued = before && after && !/\s/.test(before) && !/\s/.test(after);
    return glued ? '、' : ' ';
  });
}

/** 清完噪音後可能留下沒有配對的括號；成對的一律不動（歌名本來就可能帶括號）。 */
function repairBrackets(value) {
  const text = String(value || '');
  const drop = new Set();
  const stack = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '（') stack.push(i);
    else if (ch === ')' || ch === '）') { if (stack.length) stack.pop(); else drop.add(i); }
  }
  stack.forEach((index) => drop.add(index));
  if (!drop.size) return text;
  return text.split('').filter((ch, index) => !drop.has(index)).join('');
}

const LEADING_NOISE_TAG = /^\s*(?:【\s*([^】]+)\s*】|\[\s*([^\]]+)\s*\]|「\s*([^」]+)\s*」|『\s*([^』]+)\s*』|《\s*([^》]+)\s*》|〈\s*([^〉]+)\s*〉)\s*/;
// 翻唱類標籤（【翻唱】【Cover】【歌ってみた】【歌回精華】）也是噪音：留著的話「【翻唱】周杰倫 - 晴天」
// 的歌手會變成「翻唱」、「ロキ / みきとP【歌ってみた】」的歌名會變成「歌ってみた」。
const NOISE_TAG_TEXT = /(?:^|\b)(?:mv|pv|official|lyrics?|audio|video|ktv|karaoke|cover(?:ed)?|vtuber|vsinger)(?:\b|$)|動態歌詞|动态歌词|歌回剪輯|歌回剪辑|歌雜剪輯|歌杂剪辑|伴奏|純音樂|纯音乐|女版|男版|完整版|官方版|原版|翻唱|歌ってみた|歌回精華|歌回精华|直播精華|直播精华|字幕|中[日英韓韩]?字|[日英韓韩]中字|雙語|双语|\bch\.?\s*[-–—]/i;
const PROMO_TAIL = /(?:全球網路大首播|全球网络大首播|網路大首播|网络大首播|首播|完整版|完整版本|官方版)+/gi;
// 括號裡的影視宣傳註記：「(電影「我的少女時代」插曲)」「（電視劇《夢華錄》片尾曲）」「(OST)」。
// 裡面常帶著「」《》，若留著，「歌手 [歌名] (電影「劇名」插曲)」會被『歌手「歌名」』規則
// 誤抓成歌手＝「歌手 (電影」、歌名＝劇名。
const PROMO_PAREN = /\s*[（(][^（()）]*?(?:電影|电影|電視劇|电视剧|劇集|剧集|網劇|网剧|動畫|动画|主題曲|主题曲|片頭曲|片头曲|片尾曲|插曲|推廣曲|推广曲|宣傳曲|宣传曲|廣告曲|广告曲|\bOST\b)[^（()）]*[）)]/gi;
const PUBLISHER_TAIL = /\s*[-–—]\s*(?:華納|华纳|索尼|Sony\b|滾石|滚石|相信音樂|相信音乐|環球|环球|ForwardMusic\b|avex\b)[^\n]*$/i;

// ─── 廠牌／搬運頻道 ───
// 2026-08-30 清庫的第 1 類指紋：唱片公司與搬運頻道被當成歌手寫進歌庫（`ForwardMusic 添翼`、
// `滾石唱片 ROCK RECORDS`）。它們不是原唱，寧可讓歌手留空、面板顯示「原唱待確認」，
// 也不要塞一個錯的名字進去——錯的名字還會污染歌詞搜尋的 query。
// 英文廠牌名要有詞邊界：舊版 EMI 沒有邊界，Eminem、Demi Lovato、Remi Wolf、Emily…
// 全被當成唱片公司、歌手欄被清空。VEVO 刻意只要求右邊界——官方頻道名常黏在歌手後面（AdeleVEVO）。
const LABEL_NAME = /(?:華納|华纳|索尼|\bSony\s*Music\b|滾石|滚石|相信音樂|相信音乐|環球|环球|\bForwardMusic\b|添翼|福茂|種子音樂|种子音乐|杰威爾|杰威尔|\bavex\b|\bEMI\b|\bBMG\b|VEVO\b|\bUniversal\s*Music\b|\bWarner\s*Music\b|唱片(?:公司)?|\bRecords\b|\bRecordings\b|\bEntertainment\s*(?:Group|Inc)?\b)/i;
// 標題開頭的「廠牌 - 」：`滾石唱片 ROCK RECORDS - 五月天 - 志明與春嬌` 這種三段式，
// 不先把廠牌那段剝掉，切割器就會把廠牌當歌手、把「五月天 - 志明與春嬌」整串當歌名。
const PUBLISHER_HEAD = /^\s*[^-–—|｜]{0,40}?(?:華納|华纳|索尼|\bSony\s*Music\b|滾石|滚石|相信音樂|相信音乐|環球|环球|\bForwardMusic\b|添翼|福茂|種子音樂|种子音乐|\bavex\b|VEVO\b|\bUniversal\s*Music\b|\bWarner\s*Music\b|唱片|\bRECORDS\b)[^-–—]{0,40}?\s*[-–—]\s*/i;

/** 這個名字是唱片公司／搬運頻道，不是原唱。 */
function isLabelArtist(value) {
  const text = compactSpaces(value);
  if (!text) return false;
  return LABEL_NAME.test(text);
}

function compactSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeVideoText(value) {
  return compactSpaces(String(value || '')
    .normalize('NFKC')
    .replace(/[|｜]/g, '|')
    // YouTube 標題不能有真的 '/'，上傳者改用長得很像的字元（⧸ U+29F8、∕ U+2215、⁄ U+2044）。
    // NFKC 不會把它們併成 '/'，不先換掉的話 ' M⧸V'、'(Eng⧸Rom⧸Han Lyrics)' 這種噪音會躲過
    // 所有規則、原封不動留在歌名裡（2026-08-30 清庫指紋之一）。
    .replace(/[⧸∕⁄]/g, '/')
    .replace(/／/g, '/')
    .replace(/[–—−]/g, '-'));
}

const TRAILING_NOISE_TAG = /\s*(?:【\s*([^】]+)\s*】|\[\s*([^\]]+)\s*\])\s*$/;

// 夾在標題中間、整組只有翻唱標記的括號（「祝福 / YOASOBI【歌ってみた】ver.某某」）：頭尾規則碰不到，
// 留著會被『歌手【歌名】』規則抓成歌名「歌ってみた」。只認整組就是這幾個字，不碰其他括號。
const MID_COVER_TAG = /\s*(?:【\s*|\[\s*)(?:歌ってみた|翻唱|cover(?:ed)?|歌回精華|歌回精华|弾き語り)(?:\s*】|\s*\])\s*/gi;

const NOISE_TAG_TEXT_ALL = new RegExp(NOISE_TAG_TEXT.source, 'gi');
function isPureNoiseTag(content) {
  const text = String(content || '');
  if (!NOISE_TAG_TEXT.test(text)) return false;
  return !text.replace(NOISE_TAG_TEXT_ALL, ' ')
    .replace(/\b(?:music|full|short|ver\.?|version|hd|4k|m\/v)\b/gi, ' ')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function stripLeadingNoiseTags(value) {
  let text = value;
  let match = text.match(LEADING_NOISE_TAG);
  while (match && NOISE_TAG_TEXT.test(match.slice(1).find(Boolean) || '')) {
    text = text.slice(match[0].length).trim();
    match = text.match(LEADING_NOISE_TAG);
  }
  // 結尾的同類標籤（「ロキ / みきとP【歌ってみた】」）也拿掉；整串只剩標籤時保留原樣。
  // 結尾那組要「整組都是噪音字」才剝：「The Buggles【Video Killed the Radio Star】」的 Video 是歌名的一部分。
  match = text.match(TRAILING_NOISE_TAG);
  while (match && match.index > 0 && isPureNoiseTag(match.slice(1).find(Boolean) || '')) {
    text = text.slice(0, match.index).trim();
    match = text.match(TRAILING_NOISE_TAG);
  }
  const withoutMidTags = text.replace(MID_COVER_TAG, ' ').replace(/\s+/g, ' ').trim();
  return withoutMidTags || text;
}

function cleanIdentityPart(value, kind = 'title') {
  let text = compactSpaces(value)
    .replace(PROMO_TAIL, '')
    // 噪音字被剝掉後留下的空括號（「⌜高音質⌟」→「⌜ ⌟」）與頭尾的音符裝飾（「晴天 ♪」）。
    .replace(/(?:⌜\s*⌟|﹁\s*﹂|〔\s*〕|［\s*］|\[\s*\]|〖\s*〗|｢\s*｣|【\s*】|「\s*」|『\s*』|《\s*》|〈\s*〉|[（(]\s*[）)])/g, ' ')
    .replace(/^[\s♪♫♬🎵🎶]+|[\s♪♫♬🎵🎶]+$/gu, '')
    // 頭尾的表情符號裝飾（「晴天 🔥🔥」）
    .replace(/^[\s\p{Extended_Pictographic}\uFE0F\u200D]+|[\s\p{Extended_Pictographic}\uFE0F\u200D]+$/gu, '')
    .replace(/^[\s:：|/\-]+|[\s:：|/\-]+$/g, '')
    .replace(/\s*-\s*(?:版|歌詞版|歌词版)\s*$/i, '')
    .trim();
  if (kind === 'title') {
    // 整個歌名被引號包住（K-pop 官方常見 ‘뚜두뚜두’、'Ditto'，也有 "死ぬのがいいわ"）：引號不是歌名的一部分，
    // 留著會跟著存進歌曲庫、也讓歌詞搜尋多一層雜訊。只拆「成對且整段包住」的那一層。
    const quoted = text.match(/^(?:‘([^‘’]+)’|“([^“”]+)”|'([^']+)'|"([^"]+)"|＂([^＂]+)＂)$/);
    if (quoted) {
      const inner = (quoted[1] || quoted[2] || quoted[3] || quoted[4] || quoted[5] || '').trim();
      if (inner.length >= 1) text = inner;
    }
    text = text
      .replace(/\s*[（(](?:電影|电影|電視劇|电视剧|戲劇|戏剧|動畫|动画|日劇|日剧|韓劇|韩剧)[^）)]*[）)]\s*$/i, '')
      .replace(/\s*(?:電影|电影|電視劇|电视剧|戲劇|戏剧|動畫|动画)[「『《【].*$/i, '')
      .replace(/\s*(?:主題曲|主题曲|片頭曲|片头曲|片尾曲|插曲)\s*$/i, '')
      .trim();
  } else {
    // 「Ado (cover)」：翻唱標記不是歌手名的一部分。
    text = text.replace(/\s*[(（\[【]\s*cover(?:ed)?\s*[)）\]】]\s*$/i, '').trim();
    const knownPrefix = matchLeadingKnownArtist(text);
    if (knownPrefix && /^[、,，]/.test(text.slice(knownPrefix.length))) text = knownPrefix;
  }
  return compactSpaces(text);
}

// ─── 已知歌手清單（兜底用，可持續擴充）───
// YouTube 標題格式混亂，解析出的「歌手/歌名」常對調。若其中一側命中此清單，
// 就以它為歌手，避免把歌名當人名。涵蓋常見日系/動漫/VTuber 歌手與團體。
const KNOWN_ARTISTS_RAW = [
  // 華語歌回高頻歌手；也用於辨識沒有標點的「歌手 歌名」官方標題。
  '周華健', '李宗盛', '品冠', '范逸臣', '林憶蓮', '任賢齊', '王力宏', '陳奕迅', '縱貫線',
  '林俊傑', '楊丞琳', '蕭煌奇', '梁靜茹', '葉倩文', '藍又時', '韋禮安', '周杰倫', '張學友',
  '蔡依林', '五月天', '告五人', '茄子蛋', '頑童MJ116', 'RPG', '芒果醬', '蘇打綠', '田馥甄',
  '珂拉琪 Collage', '珂拉琪',
  '孫燕姿', '鄧紫棋', '徐佳瑩', '盧廣仲', '陶喆', '伍佰', '楊宗緯', '張惠妹', '莫文蔚',
  '劉若英', '動力火車', 'A-Lin', '理想混蛋', '張碧晨', '周興哲', '艾薇', '陳壹千', '張宇',
  '黃小琥', '王艷薇', '阿冗', '蘇打綠', '曾瑋中', '張遠', '王菲', '王靖雯', '蘇慧倫',
  // 華語／粵語經典歌回歌手（2026-08 對照實際曲庫補齊；缺這批時「歌名 - 歌手」顛倒校正對中文歌等於失效）。
  '畢書盡', 'Bii', '吳宗憲', 'Jacky Wu', '周傳雄', 'Steve Chou', '周蕙', 'Where Chou',
  '坣娜', '娃娃', '金智娟', 'WaWa', '康康', '張信哲', 'Jeff Chang', '張洪量', 'Chang Hung-Liang',
  '張雨生', 'Tom Chang', '彭佳慧', 'Julia Peng', '彭羚', 'Cass Phang', '方大同', 'Khalil Fong',
  '朱俐靜', '李玟', 'CoCo Lee', '林志炫', 'Terry Lin', '洪佩瑜', '游鴻明', 'Chris Yu',
  '王傑', 'Dave Wong', '羅志祥', '范曉萱', 'Mavis Fan', '萬芳', 'Wan Fang', '蕭亞軒', 'Elva Hsiao',
  '謝和弦', 'R-chord', '辛曉琪', 'Winnie Hsin', '那英', '鄭秀文', 'Sammi Cheng', '陳昇', 'Bobby Chen',
  '陳淑樺', 'Sarah Chen', '黃品源', '黃大煒', 'David Huang', '李佳薇', 'Jess Lee', '蔡健雅', 'Tanya Chua',
  '陶晶瑩', '陶子', '張學友', 'Jacky Cheung', '譚詠麟', 'Alan Tam', '張國榮', 'Leslie Cheung',
  '陳綺貞', 'Cheer Chen', '陳珊妮', '楊乃文', '順子', 'Shino', '許茹芸', 'Valen Hsu',
  '許美靜', '游玄德', '任賢齊', 'Richie Jen', '周華健', 'Wakin Chau', '李宗盛', 'Jonathan Lee',
  '林憶蓮', 'Sandy Lam', '莫文蔚', 'Karen Mok', '張惠妹', 'A-Mei', '陶喆', 'David Tao',
  '林俊傑', 'JJ Lin', '周杰倫', 'Jay Chou', '盧廣仲', 'Crowd Lu', '芒果醬', 'Mango Jump',
  'VH', 'Vast & Hazy', '理想混蛋', 'Skippy Blue',
  // K-pop（同樣拿來擋顛倒；團名比歌名更像「歌手」欄位）。
  'BTS', '방탄소년단', 'BIGBANG', 'G-DRAGON', 'TAEYANG', 'DAESUNG', 'BLACKPINK', 'ROSÉ', 'JISOO',
  'JENNIE', 'LISA', 'TWICE', 'aespa', 'NewJeans', 'LE SSERAFIM', 'IVE', 'BABYMONSTER', '(G)I-DLE',
  'Red Velvet', 'IU', '아이유', 'TAEYEON', 'AKMU', '악뮤', 'Ailee', '에일리', 'LEE HI', '이하이',
  'BoA', 'DAY6', 'SEVENTEEN', 'Stray Kids', 'EXO', 'NCT', 'ITZY', 'MAMAMOO', 'Zico', 'HyunA',
  // 歐美（轉貼/官方頻道混雜時的顛倒防呆）。
  'Adele', 'Beyoncé', 'Bruno Mars', 'Ariana Grande', 'Christina Aguilera', 'Ed Sheeran',
  'Coldplay', 'Taylor Swift', 'Billie Eilish', 'Lady Gaga', 'Sam Smith', 'Charlie Puth',
  'Maroon 5', 'Sia', 'Rihanna', 'Katy Perry', 'John Legend', 'OneRepublic', 'Imagine Dragons',
  // 歐美（第二批 2026-08-30）
  'The Weeknd', 'Dua Lipa', 'Justin Bieber', 'Shawn Mendes', 'Harry Styles', 'Olivia Rodrigo',
  'Sabrina Carpenter', 'Doja Cat', 'SZA', 'Miley Cyrus', 'Selena Gomez', 'Camila Cabello',
  'Halsey', 'Lorde', 'Lana Del Rey', 'P!nk', 'Pink', 'Kesha', 'Meghan Trainor', 'Anne-Marie',
  'Bebe Rexha', 'Zara Larsson', 'Tate McRae', 'Gracie Abrams', 'Chappell Roan', 'Benson Boone',
  'Teddy Swims', 'Twenty One Pilots', 'Panic! at the Disco', 'Fall Out Boy', 'Paramore',
  'The Killers', 'Arctic Monkeys', 'Radiohead', 'Muse', 'Foo Fighters', 'Green Day',
  'Linkin Park', 'Nirvana', 'Red Hot Chili Peppers', 'U2', 'The 1975', 'Hozier',
  'Lewis Capaldi', 'James Arthur', 'George Ezra', 'Passenger', 'OneRepublic',
  'Drake', 'Kendrick Lamar', 'Post Malone', 'Travis Scott', 'Frank Ocean', 'Khalid',
  'Daniel Caesar', 'H.E.R.', 'Giveon', 'Bryson Tiller', 'Summer Walker', 'Cardi B',
  'Nicki Minaj', 'Megan Thee Stallion', 'Eminem', 'Kanye West', 'Ye', 'JAY-Z',
  'Childish Gambino', 'Tyler, the Creator', 'Mac Miller', 'J. Cole',
  'Michael Jackson', 'Whitney Houston', 'Mariah Carey', 'Céline Dion', 'Celine Dion',
  'Elton John', 'Queen', 'The Beatles', 'ABBA', 'Fleetwood Mac', 'Stevie Wonder',
  'Aretha Franklin', 'Frank Sinatra', 'Amy Winehouse', 'Norah Jones', 'John Mayer',
  'Jason Mraz', 'Jack Johnson', 'Kacey Musgraves', 'Morgan Wallen', 'Zach Bryan',
  'Noah Kahan', 'Luke Combs', 'Bad Bunny', 'Shakira', 'KAROL G', 'Rosalía',
  'Enrique Iglesias', 'J Balvin', 'Luis Fonsi', 'Maluma',
  // K-pop（第二批 2026-08-30）
  'ATEEZ', 'ENHYPEN', 'TOMORROW X TOGETHER', 'TXT', 'MONSTA X', 'GOT7', 'iKON', 'WINNER',
  'SHINee', 'Super Junior', 'BTOB', 'Highlight', 'VIXX', 'Pentagon', 'TREASURE', 'RIIZE',
  'ZEROBASEONE', 'BOYNEXTDOOR', 'NCT DREAM', 'NCT 127', 'WayV', '2PM', '2AM', 'Block B',
  'ASTRO', 'B.A.P', 'Girls\' Generation', 'SNSD', '소녀시대', 'KARA', '2NE1', 'f(x)',
  'Wonder Girls', 'SISTAR', 'Apink', 'GFRIEND', 'OH MY GIRL', 'Lovelyz', 'WJSN', 'EVERGLOW',
  'STAYC', 'NMIXX', 'Kep1er', 'fromis_9', 'ILLIT', 'KISS OF LIFE', 'tripleS', 'T-ara',
  'Girl\'s Day', 'EXID', '4Minute', 'Brown Eyed Girls', 'miss A', 'Sunmi', 'CHUNG HA',
  'Jessi', 'HWASA', 'Heize', 'DEAN', 'Crush', 'Zion.T', 'BIBI', 'Lee Mujin', 'Baekhyun',
  'KAI', 'TAEMIN', 'Jonghyun', 'Jung Kook', 'Jimin', 'Agust D', 'RM', 'j-hope', 'Jin',
  'JEON SOMI', 'Paul Kim', '10cm', 'YOUNHA', 'Baek Yerin', 'Colde', 'Jay Park', '박재범',
  'Epik High', 'Tablo', 'Dynamic Duo', 'Beenzino', 'Loco', 'GRAY', 'pH-1', 'BE\'O', 'Lee Hi',
  // J-pop / J-rock（第二批 2026-08-30）
  '藤井風', 'Fujii Kaze', '秦基博', 'Motohiro Hata', '菅田将暉', 'Masaki Suda', '優里', 'Yuuri',
  'あいみょん', 'クリープハイプ', 'Creepy Nuts', 'SUPER BEAVER', 'THE ORAL CIGARETTES',
  '[Alexandros]', 'ヒトリエ', 'フレデリック', 'frederic', 'KANA-BOON', 'BLUE ENCOUNT',
  '04 Limited Sazabys', 'WANIMA', 'Nulbarich', 'Chilli Beans.', 'Omoinotake', '神山羊',
  'Yorushika', 'ハルカミライ', '緑黄色社会', 'マカロニえんぴつ', 'sumika', 'Saucy Dog',
  '西野カナ', 'Kana Nishino', '家入レオ', 'Leo Ieiri', '絢香', 'Ayaka', '大塚愛', 'Ai Otsuka',
  '加藤ミリヤ', 'スキマスイッチ', 'ゆず', 'YUZU', 'コブクロ', 'Kobukuro', '平井堅', 'Ken Hirai',
  '福山雅治', 'Masaharu Fukuyama', 'Superfly', 'JUJU', 'MISIA', '倖田來未', 'Koda Kumi',
  '浜崎あゆみ', 'Ayumi Hamasaki', 'EXILE', '三代目 J SOUL BROTHERS', 'GReeeeN', 'GRe4N BOYZ',
  '高橋優', 'ClariS', 'ヨルシカ', 'MAISONdes', 'Lamp', 'ずっと真夜中でいいのに。',
  'カンザキイオリ', 'Kanzaki Iori', '煮ル果実', 'ツミキ', 'MARETU', '40mP', 'HoneyWorks',
  'れるりり', 'kemu', 'Last Note.', 'Mitchie M', 'buzzG', 'Guiano', 'MIMI', '傘村トータ',
  'YOASOBI', 'ヨルシカ', 'ずっと真夜中でいいのに。', 'ZUTOMAYO', 'ヒグチアイ', 'Ado', 'Aimer', 'LiSA',
  '米津玄師', 'Kenshi Yonezu', 'King Gnu', 'Eve', 'Reol', 'れをる', 'majiko', 'みきとP', 'DECO*27',
  'sasakure.UK', 'Vaundy', 'tuki.', 'imase', 'yama', 'ヨアソビ', 'Official髭男dism', 'ヒゲダン',
  'back number', 'RADWIMPS', 'ONE OK ROCK', 'Mrs. GREEN APPLE', 'あいみょん', 'Aimyon',
  'YUI', 'Perfume', 'BABYMETAL', 'きゃりーぱみゅぱみゅ', 'Kyary Pamyu Pamyu', 'supercell',
  'ryo', '初音ミク', '初音未來', 'Hatsune Miku', 'GUMI', '鏡音リン', '鏡音レン', '巡音ルカ',
  'wowaka', 'ハチ', 'n-buna', 'Orangestar', 'Eve', 'kanaria', 'ぬゆり', 'バルーン', 'Balloon',
  'syudou', 'Chinozo', 'なきそ', 'john', 'ジョン', 'TOOBOE', 'Neru', 'すりぃ', '柊キライ',
  'Kanaria', 'いよわ', 'Ayase', 'wotaku', 'Giga', 'PinocchioP', 'ピノキオピー', 'cosMo',
  'Mili', 'Sou', 'まふまふ', 'そらる', 'After the Rain', 'いれいす', 'すとぷり', 'ばぁう',
  '星街すいせい', 'Hoshimachi Suisei', '宝鐘マリン', '兎田ぺこら', '湊あくあ', '森カリオペ',
  'Mori Calliope', 'がうるぐら', 'Gawr Gura', 'AZKi', '常闇トワ', '天音かなた', 'IA',
  '緑黄色社会', 'リョクシャカ', 'sumika', 'SEKAI NO OWARI', 'セカオワ', 'Saucy Dog',
  'Vivid BAD SQUAD', 'Leo/need', 'MORE MORE JUMP!', 'ワンダーランズ×ショウタイム', '25時、ナイトコードで。',
  'Aqua Timez', 'スピッツ', 'Spitz', 'BUMP OF CHICKEN', 'ASIAN KUNG-FU GENERATION', 'aiko',
  '中島みゆき', '宇多田ヒカル', 'Hikaru Utada', '椎名林檎', '東京事変', 'YUKI', 'JUDY AND MARY',
  'L\'Arc～en～Ciel', 'GLAY', 'X JAPAN', 'flumpool', 'いきものがかり', 'ポルノグラフィティ',
  'Vaundy', 'Saucy Dog', 'マカロニえんぴつ', 'optical_frame', 'r-906', 'Misumi', 'koresawa',
  // 華語老歌／經典對唱歌手（2026-09-08 對照實際曲庫補齊；這批多是 80-90 年代國語金曲，
  // 標題常見「歌手A 歌手B 歌名」或「歌手A&歌手B-歌名」完全沒有分隔符，兩位歌手若都不在
  // 清單裡，matchLeadingKnownArtist 從頭比對不到任何一個，直接整句落回 whole-title，
  // 歌手就會是空的——見 memory `import-parse-failure-fingerprints`）。
  '蔡琴', '潘安邦', '姜育恆', '李翊君', '徐若瑄', 'Vivian Hsu', '曹格', 'Gary Chaw',
  '張克帆', '胡蓓蔚', '林凡', 'Freya Lim', '鄭仲基', '郭書瑤', '井柏然', 'Darren Wang',
  '楊培安', '劉虹翎', '江美琪', 'Valen Chiang', '張智成', 'Tarcy Su', '王心凌', 'Cyndi Wang',
  '呉克群', '吳克群', 'Kenji Wu', '信', 'Shin', '黃立行', 'Van Ness Wu', '羅美玲', 'Race Wong',
  'ELLA', '陳嘉樺', 'Ella Chen', 'TANK', '郭采潔', 'Amber Kuo', 'Della', '丁噹', 'Della Ding',
  '鼓鼓', 'Yang Chin Kang', 'Selina', '任家萱', 'Selina Jen', '田馥甄', 'Hebe Tien',
  'melody', '范逸臣', '巫啟賢', 'Eric Moo', '方麗儀', '孫協志', 'Sunny Sun', '陳子鴻',
  '許慧欣', 'Michelle Pan', '田中千繪', 'Chie Tanaka', '飛輪海', 'Fahrenheit', '劉力揚',
  '炎亞綸', 'Aaron Yan', '朱俐靜', 'Miu Chu', '陳勢安', 'Andrew Tan', '陳彥允', 'Ian Chen',
  '畢書盡', '陳曉東', 'Kelvin Chen', '林佳儀', 'Ella Lin', '于台煙', '梁弘志', '周秉鈞',
  '楊海薇', '林淑容', '羅時豐', '劉家昌', '尤雅', '陳潔儀', '蘇永康', '孫耀威', 'Eric Suen',
  '酒井法子', 'Noriko Sakai', '馬毓芬', '關正傑', '關菊英', '黃露儀', '李碧華', '羅吉鎮',
  '陳淑樺', '羅大佑', '許茹芸', '孙楠', '竇智孔', 'Bobby Dou', '戴愛玲', 'Ailing Tai',
  '张信哲', '范文芳', 'Fann Wong', 'Humming Urban Stereo', 'Risso', '徐若瑄', '李玖哲',
];
// 連字號/空白視為同義字元：真實標題常把「A-Lin」寫成「A Lin」，反之亦然，
// 一律歸一化掉才比對，否則名單裡明明有這個歌手卻因為標點不同而比對不到。
const ARTIST_KEY_NOISE_RE = /[\s\-–—]+/g;
const artistKey = (s) => String(s || '').toLowerCase().replace(ARTIST_KEY_NOISE_RE, '');
const KNOWN_ARTISTS = new Set(KNOWN_ARTISTS_RAW.map(artistKey));
function isKnownArtist(name) {
  if (!name) return false;
  const k = artistKey(name);
  if (KNOWN_ARTISTS.has(k)) return true;
  // 寬鬆比對：清單名稱是否為輸入的子字串（處理「歌手 feat. X」等）
  for (const a of KNOWN_ARTISTS) {
    // 三、四字母藝名（Eve/Ado/YUI…）不能做任意子字串：例如歌曲 Never 會誤中 Eve，
    // 直接把「歌名 - 歌手」方向顛倒。短藝名的 feat/with 情境由 looksLikeArtist 另行辨識。
    if (a.length >= 5 && k.includes(a)) return true;
    if (k.length >= 5 && a.includes(k)) return true;
  }
  return false;
}

// 找出文字開頭是否為已知歌手名（連字號／空白同義，例如「A-Lin」也要吃得到「A Lin」），
// 回傳原文字中對應的實際長度，方便呼叫端用 text.slice(len) 取得剩餘部分。
const ARTIST_PREFIX_REGEX_CACHE = new Map();
function artistPrefixRegex(rawName) {
  let re = ARTIST_PREFIX_REGEX_CACHE.get(rawName);
  if (!re) {
    const escaped = rawName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\-–—]+/g, '[\\s\\-–—]+');
    re = new RegExp('^' + escaped);
    ARTIST_PREFIX_REGEX_CACHE.set(rawName, re);
  }
  return re;
}
function matchLeadingKnownArtist(text) {
  const lower = String(text || '').toLowerCase();
  let best = null;
  for (const rawName of KNOWN_ARTISTS_RAW) {
    const m = lower.match(artistPrefixRegex(rawName));
    if (m && (!best || m[0].length > best.length)) best = m[0];
  }
  return best ? text.slice(0, best.length) : null;
}

function looksLikeArtist(value, { strict = false } = {}) {
  const text = compactSpaces(value);
  if (!text) return false;
  if (isKnownArtist(text)) return true;
  // with／and／x／vs 也常出現在一般英文歌名裡（Stay With Me、Me and You、Dancing With Your Ghost）。
  // strict 模式只認比較明確的合作標記，給「要不要把連字號左右對調」這種會整個顛倒結果的判斷用。
  const collaboration = strict
    ? /\b(?:feat\.?|ft\.?)(?=\s|$)|[&×]|樂團|乐团|合唱團|合唱团| orchestra\b/i
    : /\b(?:feat\.?|ft\.?|with|and|x|vs\.?)\b|[&×]|樂團|乐团|合唱團|合唱团| orchestra\b/i;
  if (collaboration.test(text)) return true;
  // 中英並列藝名（例如「林俊傑 JJ Lin」）比一般歌名更像歌手欄位。
  if (/\p{Script=Han}.*\b[A-Za-z][A-Za-z .'-]{2,}\b/u.test(text)) return true;
  return false;
}

module.exports = {
  NOISE_PATTERNS,
  stripNoiseBracketGroups,
  repairBrackets,
  PROMO_TAIL,
  PROMO_PAREN,
  PUBLISHER_TAIL,
  PUBLISHER_HEAD,
  isLabelArtist,
  compactSpaces,
  normalizeVideoText,
  stripLeadingNoiseTags,
  cleanIdentityPart,
  artistKey,
  KNOWN_ARTISTS,
  isKnownArtist,
  matchLeadingKnownArtist,
  looksLikeArtist,
};
