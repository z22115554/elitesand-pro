/**
 * 歌詞清洗（lyrics-cleaner）
 *
 * 把分散的清洗邏輯集中成一個 cleanLyrics(lines, opts)，供 lyrics-engine 的
 * parseLrc / parseKrc 共用。各來源（lrclib / netease / qqmusic / kugou …）格式
 * 不一，常夾雜製作資訊、純演奏標記、重複行、全形空白等雜訊；這裡統一處理。
 *
 * 設計原則：
 *  - 只清「幾乎可確定是雜訊」的東西，寧可少清也不誤砍正文。
 *  - 製作資訊只在首尾各 EDGE 行內過濾（正文中間出現「作曲」字樣不砍）。
 *  - 所有清洗步驟可用 opts 個別關閉，方便測試與特例。
 *
 * lines 為 [{ time:<ms>, text, words?, phonetic?, duration? }, ...]
 */

// ─── 製作資訊關鍵字 ───
// 真實的製作人員名單常把兩個角色用「/」合寫在冒號前（例如「混音/母带：」「吉他编写/吉他：」），
// 不是單一關鍵字後面緊接冒號，所以不能用「^關鍵字\s*[:：]」硬性錨定——改成「冒號前的短標籤
// 內含任一關鍵字」（見 isCreditLine），這裡只需要關鍵字本身的清單，不含冒號錨點。
const CREDIT_KEYWORDS_RE = /(作詞|作词|作曲|編曲|编曲|製作人|制作人|製作|制作|出品|出品人|發行|发行|企劃|企划|企宣|統籌|统筹|監製|监制|監修|监修|混音|母帶|母带|和聲|和声|和音|合聲|合声|配唱|配器|配樂|配乐|吉他|guitar|貝斯|贝斯|bass|鼓|drums?|鍵盤|键盘|piano|鋼琴|钢琴|弦樂|弦乐|strings|producer|produced\s*by|composer|composed\s*by|lyricist|written\s*by|arrang(?:ed|er|ement)|arranged\s*by|vocals?|演唱|原唱|主唱|歌手|original\s*artist|錄音|录音|recording|mix(?:ing|ed\s*by)?|master(?:ing|ed\s*by)?|錄音室|录音室|studio|label|唱片公司|聯合出品|联合出品|改編製作|改编制作|音樂營銷|音乐营销|營銷|营销|詞|词|曲|編|编|chorus|backing\s*vocals?|A\s*&\s*R|artwork|design|director|video|攝影|摄影|視覺|视觉|美術|美术|鳴謝|鸣谢|特別感謝|特别感谢|OP|SP|ISRC)/i;
// 冒號前標籤太長就不算（避免把「今天的天氣：真好」這種一般語句誤判成製作資訊）
// 中英雙語角色名會很長，例如「數位發行 Digital Release」「錄音師 Recording Engineer」。
// 只在首尾 credit block 使用此上限，放寬到 36 仍不會掃描正文中段。
const CREDIT_LABEL_MAX_LEN = 36;

// 開頭常見「歌名 - 歌手」標題行；酷狗也常省略破折號兩側空白。
// compact 格式只有在下一行確定是 credit 時才移除，避免把正常歌詞中的連字號誤判成標題。
const HEADER_RE = /^.{1,80}\s*[-–—－]\s*.{1,80}$/;

// 版權/授權聲明整行（通常用【】或［］包住，不一定有冒號，例如「【本歌曲已获得原词曲版权方授权】」）
const RIGHTS_NOTICE_RE = /^[【\[［].{0,60}(授權|授权|版權|版权|copyright|保留一切權利|保留一切权利)[^】\]］]{0,20}[】\]］]$/i;
const COPYRIGHT_LINE_RE = /^(?:©|℗|\(c\)|\(p\)|copyright\b|all\s+rights\s+reserved\b).{0,120}$/i;

// 整行就是「純演奏 / 無歌詞」之類的提示（非歌詞）
const NO_LYRICS_RE = /^(此歌曲(為|为)?(沒|没)有填(詞|词)的(純|纯)音(樂|乐)|(純|纯)音(樂|乐)|未提供歌詞|未提供歌词|暂无歌词|暫無歌詞|no\s*lyrics|instrumental)[，,]?\s*(請欣賞|请欣赏)?\.?。?$/i;

// 整行只是純演奏 / 間奏標記（可選擇移除）
const INSTRUMENTAL_MARK_RE = /^[\(（\[【]?\s*(間奏|间奏|前奏|間奏中|间奏中|尾奏|過門|过门|интро|intro|outro|interlude|instrumental|music|solo|♪+|♫+|…+|\.{3,}|—+|-{2,})\s*[\)）\]】]?$/i;

const stripTags = (s) => String(s == null ? '' : s);

/**
 * 正規化單行文字：全形空白→半形、壓縮連續空白、去頭尾空白、去零寬字元。
 */
function normalizeText(text) {
  return stripTags(text)
    .replace(/[​-‍﻿]/g, '') // 零寬字元
    .replace(/　/g, ' ')                // 全形空白
    .replace(/[ \t]+/g, ' ')                // 連續空白
    .trim();
}

/**
 * 判斷某行是否為製作資訊 / 標題（用於首尾過濾）。
 */
function isCreditLine(line, index) {
  if (!line || typeof line.text !== 'string') return false;
  const t = line.text.trim();
  if (!t) return false;
  const colonIdx = t.search(/[:：]/);
  if (colonIdx > -1 && colonIdx <= CREDIT_LABEL_MAX_LEN) {
    const label = t.slice(0, colonIdx).trim();
    // 「我寫的曲：...」較可能是正文；只排除以人稱開頭的句子，不能排除內含「他」的「吉他」。
    if (CREDIT_KEYWORDS_RE.test(label) && !/^(?:我|你|他|她|它)(?:寫|写|做|唱|說|说|的|是|有|在)/.test(label)) return true;
  }
  if (RIGHTS_NOTICE_RE.test(t)) return true;
  if (COPYRIGHT_LINE_RE.test(t)) return true;
  // 有些來源把 credit 整行包在括號內而不寫冒號，例如「【錄音室：XX Studio】」。
  const bracketed = t.match(/^[【\[［(（]\s*(.{1,80}?)\s*[】\]］)）]$/);
  if (bracketed && CREDIT_KEYWORDS_RE.test(bracketed[1])) return true;
  return false;
}

function isHeaderLine(line, index) {
  if (!line || typeof line.text !== 'string' || index > 0) return false;
  const t = line.text.trim();
  return (typeof line.time !== 'number' || line.time < 2500) && HEADER_RE.test(t);
}

/**
 * 主清洗函式。
 * @param {Array} lines
 * @param {Object} [opts]
 * @param {boolean} [opts.normalizeWhitespace=true] 正規化空白/全形
 * @param {boolean} [opts.stripCredits=true]        首尾製作資訊行
 * @param {boolean} [opts.stripNoLyrics=true]       「純音樂/無歌詞」提示行
 * @param {boolean} [opts.stripInstrumental=false]  純間奏/演奏標記行（預設保留）
 * @param {boolean} [opts.dedupe=true]              相鄰完全重複行（同字、時間相近）
 * @param {boolean} [opts.removeEmpty=true]         空白行
 * @param {number}  [opts.edge=20]                  製作資訊只砍首尾「連續符合」的行，最多各掃 edge 行
 * @returns {Array} 清洗後的新陣列（不變更輸入元素）
 */
function cleanLyrics(lines, opts = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return Array.isArray(lines) ? lines : [];
  const o = {
    normalizeWhitespace: true,
    stripCredits: true,
    stripNoLyrics: true,
    stripInstrumental: false,
    dedupe: true,
    removeEmpty: true,
    edge: 20,
    ...opts,
  };

  let out = lines.map((l) => (l && typeof l === 'object' ? { ...l } : l));

  // 1) 正規化文字
  if (o.normalizeWhitespace) {
    out = out.map((l) => (l && typeof l.text === 'string' ? { ...l, text: normalizeText(l.text) } : l));
  }

  // 2) 純音樂 / 無歌詞提示行
  if (o.stripNoLyrics) {
    out = out.filter((l) => !(l && typeof l.text === 'string' && NO_LYRICS_RE.test(l.text.trim())));
  }

  // 3) 純間奏 / 演奏標記行（預設保留，主播可能想看「間奏」）
  if (o.stripInstrumental) {
    out = out.filter((l) => !(l && typeof l.text === 'string' && INSTRUMENTAL_MARK_RE.test(l.text.trim())));
  }

  // 4) 製作資訊：從開頭與結尾各自「連續符合」的行數才砍（不是固定行數窗口）。
  // 真實的製作人員名單長度不一（常見 3~10 行以上，如「制作人/混音/吉他/和声/监制/
  // 企划/统筹/改编制作/音乐营销」9 行），固定小窗口（例如舊版的前後各 8 行）在名單
  // 剛好比窗口長時，會漏掉窗口外那幾行。改成「從邊界往內，只要連續符合就一直砍」，
  // 只要中間出現一行不符合就停止，不會誤砍到中段的正文；edge 只當防呆上限，避免整份
  // 內容被誤判成連續製作資訊而砍過頭。
  if (o.stripCredits && out.length >= 2) {
    const maxRun = o.edge;
    let start = 0;
    // 酷狗常先放「歌名-歌手」，下一行才開始 credit。只有兩者連續出現才把標題一起清掉。
    if (isHeaderLine(out[0], 0) && isCreditLine(out[1], 1)) start = 1;
    while (start < out.length && start < maxRun && isCreditLine(out[start], start)) start++;
    let end = out.length;
    while (end > start && (out.length - end) < maxRun && isCreditLine(out[end - 1], end - 1)) end--;
    if (start > 0 || end < out.length) {
      const filtered = out.slice(start, end);
      if (filtered.length > 0) out = filtered; // 保險：整首被砍光則維持原樣
    }
  }

  // 5) 相鄰完全重複行（同文字且時間相近 <1.2s，多為來源重複殘留；不砍正常副歌重複）
  if (o.dedupe) {
    const deduped = [];
    for (const l of out) {
      const prev = deduped[deduped.length - 1];
      if (
        prev && l && typeof l.text === 'string' && typeof prev.text === 'string' &&
        l.text === prev.text && l.text.trim() !== '' &&
        typeof l.time === 'number' && typeof prev.time === 'number' &&
        Math.abs(l.time - prev.time) < 1200
      ) {
        continue;
      }
      deduped.push(l);
    }
    out = deduped;
  }

  // 6) 空白行
  if (o.removeEmpty) {
    const noEmpty = out.filter((l) => !(l && typeof l.text === 'string' && l.text.trim() === ''));
    if (noEmpty.length > 0) out = noEmpty;
  }

  return out;
}

module.exports = {
  cleanLyrics,
  normalizeText,
  isCreditLine,
  isHeaderLine,
  CREDIT_KEYWORDS_RE,
  HEADER_RE,
  RIGHTS_NOTICE_RE,
  COPYRIGHT_LINE_RE,
  NO_LYRICS_RE,
  INSTRUMENTAL_MARK_RE,
};
