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
// 英文關鍵字必須從詞首開始比對（允許 -er/-ist/-ing 等字尾）：舊版整條 regex 沒有詞邊界，
// 「Stop:」「Hope:」「Oops:」含 op、「Spring:」「Desperado:」含 sp，首尾的正文都會被當成
// 製作資訊砍掉。OP/SP/ISRC/A&R 這類縮寫必須是完整單字。中文關鍵字沒有詞邊界概念，維持原樣。
// 韓系／國際發行的英文名單還有「Digital Edited by」「Mixed in Dolby Atmos by」「(Sub-)Publishers」：
// 舊版只認「Mixed by」，中間夾一行沒認出來就整段停手，後面的「Bass：」「Piano：」又被合唱聲部
// 當成演唱者標籤，連正文都掛上 Piano 聲部（還痛吗 Gone (Chinese ver.)）。
const CREDIT_KEYWORDS_RE = /(作詞|作词|作曲|編曲|编曲|製作人|制作人|製作|制作|出品|出品人|發行|发行|企劃|企划|企宣|策劃|策划|推廣|推广|統籌|统筹|監製|监制|監修|监修|混音|母帶|母带|和聲|和声|和音|合聲|合声|合音|人聲|人声|配唱|配器|配樂|配乐|吉他|貝斯|贝斯|鼓|打擊樂|打击乐|鍵盤|键盘|鋼琴|钢琴|弦樂|弦乐|演唱|原唱|主唱|歌手|錄音|录音|錄音室|录音室|唱片公司|聯合出品|联合出品|改編製作|改编制作|音樂營銷|音乐营销|營銷|营销|總監|总监|設計|设计|詞|词|曲|編|编|攝影|摄影|視覺|视觉|美術|美术|鳴謝|鸣谢|特別感謝|特别感谢|琴|演奏|樂團|乐团|樂隊|乐队|指導|指导|專輯|专辑|表演|白話字|白话字|助理|工程|剪輯|剪辑|修音|後期|后期|笛|簫|箫|二胡|琵琶|古箏|古筝|烏克麗麗|乌克丽丽|插畫|插画|封面|文案|宣發|宣发|伴唱|童聲|童声|縮混|缩混|戲腔|戏腔|顧問|顾问|項目|项目|團隊|团队|嗩吶|唢呐|黑管|貝司|贝司|聲樂|声乐|音響|音响|媒介|運營|运营|資產|资产|協辦|协办|承辦|承办|主辦|主办|單位|单位|負責|负责|協作|协作|協力|协力|翻譯|翻译|行銷|行销|技術支持|技术支持|合作夥伴|合作伙伴|平台|\b(?:guitar|clarinet|suona|harmon|hormon|arrag|cello|violin|viola|ukulele|synth|harmonica|sax|trumpet|trombone|horn|flute|accordion|album|assistant|executive|supervis|coordinat|photograph|management|bass|drum|percussion|program|keyboard|pian[oi]|strings|produc(?:er|ed\s*by|tion)|compos(?:er|ed\s*by)|lyricist|lyrics\s*by|written\s*by|arrang(?:ed|er|ement)|vocal|original\s*artist|record(?:ing|ed\s*by)|mix(?:ing|ed|er)?\b|master(?:ing|ed)?\b|edit(?:ed|ing|or)?\b|publish(?:er|ers|ing)?\b|engineer|atmos\b|studio|label|chorus|backing\s*vocal|artwork|design|director|video)|\b(?:OP|SP|ISRC|PGM|A\s*&\s*R)\b)/i;
// 冒號前標籤太長就不算（避免把「今天的天氣：真好」這種一般語句誤判成製作資訊）
// 中英雙語角色名會很長，例如「數位發行 Digital Release」「錄音師 Recording Engineer」。
// 只在首尾 credit block 使用此上限，放寬到 36 仍不會掃描正文中段。
// 「Programing / Guitars / Keyboards &Sythn」這種多角色合寫會到 46 字，上限放到 50。
const CREDIT_LABEL_MAX_LEN = 50;

// 開頭常見「歌名 - 歌手」標題行；酷狗也常省略破折號兩側空白。
// compact 格式只有在下一行確定是 credit 時才移除，避免把正常歌詞中的連字號誤判成標題。
const HEADER_RE = /^.{1,80}\s*[-–—－]\s*.{1,80}$/;

// 版權/授權聲明整行：常見兩種形式——用【】/［］/() 包住（例如「【本歌曲已获得原词曲版权方授权】」
// 「(未经著作权人许可，不得翻唱、翻录或使用)」），或完全不加框直接一整行（例如「本音乐作品已获得正版授权」）。
// 括號是否成對在此不苛求（寧可少量誤放行，也不要漏掉沒配對括號的真實聲明）。
const RIGHTS_NOTICE_RE = /^[【\[［(（]?.{0,70}(未經(?:著作權人|版權方)?許可|未经(?:著作权人|版权方)?许可|已獲得.{0,12}授權|已获得.{0,12}授权|正版授權|正版授权|著作權|著作权|版權所有|版权所有|保留(?:一切|所有)?權利|保留(?:一切|所有)?权利|授權|授权|版權|版权|copyright|all\s+rights\s+reserved)[^\n]{0,130}[】\]］)）]?$/i;
const COPYRIGHT_LINE_RE = /^(?:©|℗|\(c\)|\(p\)|copyright\b|all\s+rights\s+reserved\b).{0,120}$/i;

// 整行就是「純演奏 / 無歌詞」之類的提示（非歌詞）
const NO_LYRICS_RE = /^(此歌曲(為|为)?(沒|没)有填(詞|词)的(純|纯)音(樂|乐)|(純|纯)音(樂|乐)|未提供歌詞|未提供歌词|暂无歌词|暫無歌詞|no\s*lyrics|instrumental)[，,]?\s*(請您?欣賞|请您?欣赏)?\.?。?$/i;

// 整行只是純演奏 / 間奏標記（可選擇移除）
const INSTRUMENTAL_MARK_RE = /^[\(（\[【]?\s*(間奏|间奏|前奏|間奏中|间奏中|尾奏|過門|过门|интро|intro|outro|interlude|instrumental|music|solo|♪+|♫+|…+|\.{3,}|—+|-{2,})\s*[\)）\]】]?$/i;

const stripTags = (s) => String(s == null ? '' : s);

/**
 * 正規化單行文字：全形空白→半形、壓縮連續空白、去頭尾空白、去零寬字元。
 */
function normalizeText(text) {
  return stripTags(text)
    .replace(/[​﻿]/g, '') // 零寬字元
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
  // 「∶」(U+2236) 是老歌詞檔常見的假冒號（作词∶梁弘志），一併當冒號看。
  const colonIdx = t.search(/[:：∶]/);
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
  // 多人角色常拆成「和声：」下面一人一行「王禹茨@维伴音乐」——人名@工作室，沒有冒號。
  if (CREDIT_HANDLE_RE.test(t)) return true;
  // 沒有冒號、以「出品／監製／發行」收尾的短句（網易雲音樂特別企劃“回聲不息”出品）。
  if (t.length <= 40 && /(出品|出品方|監製|监制|發行|发行)$/.test(t) && !/[，。！？!?]/.test(t)) return true;
  // 名單最後常掛一行 ISRC／唱片編號（G00302102、CN-A01-23-00001）。
  if (CATALOG_CODE_RE.test(t)) return true;
  return false;
}

// 「人名@工作室」或「任何短角色：人名@工作室」（PGM：王禹茨@维伴音乐——角色是沒見過的縮寫，
// 但值是名單專用寫法）。
const CREDIT_HANDLE_RE = /^(?:[^:：∶@]{1,20}[:：∶]\s*)?[^:：∶@，。！？!?]{1,24}@[^@，。！？!?]{1,40}$/;
const CATALOG_CODE_RE = /^(?=(?:.*\d){5})[A-Z0-9][A-Z0-9-]{6,22}$/;

// 開頭的「歌名」「------歌手」這類標題行有時不在第 0 行、沒有破折號或時間晚於 2.5 秒，
// isHeaderLine 認不出來，名單就被擋在後面整段留下（默契、複寫、Power Station）。
// 只有緊接著一段確定的名單時才跳過：最多 2 行、每行夠短，且後面至少兩行名單，
// 或這幾行本身長得像標題（含破折號）——正文不會出現在名單前面。
function leadingTitleSkip(out, isCredit) {
  for (let k = 1; k <= 2 && k < out.length; k++) {
    if (!isCredit(out[k], k)) continue;
    const lead = out.slice(0, k);
    if (lead.some((l) => !l || typeof l.text !== 'string' || l.text.trim().length > 40 || isCredit(l))) return 0;
    const twoCredits = k + 1 < out.length && isCredit(out[k + 1], k + 1);
    const titleLike = lead.some((l) => /[-–—－]/.test(l.text));
    // 名單後面要接著正文（至少 3 行）。整份只有「兩句＋結尾名單」時，前兩句是正文不是標題。
    let r = k;
    while (r < out.length && (isCredit(out[r], r) || !String(out[r]?.text || '').trim())) r++;
    if (out.length - r < 3) return 0;
    // 版權聲明只會出現在名單區（不如见一面：歌名、公司、聲明、正文）
    const notice = RIGHTS_NOTICE_RE.test(String(out[k].text || '').trim());
    return twoCredits || titleLike || notice ? k : 0;
  }
  return 0;
}

function isStandaloneHeader(line) {
  if (!line || typeof line.text !== 'string' || typeof line.time !== 'number' || line.time > 2500) return false;
  const t = line.text.trim();
  if (t.length > 120) return false;
  if (/\S\s[-–—－]\s\S/.test(t)) return true;
  // 緊湊寫法（逐字來源把空白吃掉了：岁月神偷(Demo)-金玟岐(Vanessa)）：0 秒、整行沒空白、帶括號
  return line.time <= 1000 && !/\s/.test(t) && /[(（]/.test(t) && /^.{2,60}[-–—－].{2,60}$/.test(t);
}

const INTERJECTION_RE = /^(?:oh|ah|yeah|hey|la|na|woo|uh|ooh|hmm|啦|啊|哦|嗯|喔|呀)/i;
function isShortTimedLine(line, maxDuration = 1500) {
  if (!line || typeof line.text !== 'string') return false;
  const t = line.text.trim();
  const chars = [...t].length;
  const d = Number(line.duration);
  return chars > 0 && chars <= 80 && d > 0 && d < maxDuration && d / chars < 230
    && !INTERJECTION_RE.test(t) && !/^[^:：∶]{1,8}[:：∶]/.test(t); // 「女：你还好吗」是對唱，不是人名
}

/**
 * 從 start 起連續的「名單或快速閃過的短行」。要有佐證才算：前面已確認有標題或名單、
 * 區塊裡有至少一行確定的名單，或連續三行以上；區塊後面要接著真的在唱的歌詞（至少 3 行）。
 * 只看逐字歌詞（有 duration）；LRC 沒有可靠的單行長度，不套用。
 */
function timedCreditBlock(out, start, anchored, needCredit = false) {
  const scan = (maxDuration) => {
    let i = start;
    let credits = 0;
    while (i < out.length && i - start < 25) {
      const l = out[i];
      if (isCreditLine(l, i)) { credits++; i++; continue; }
      if (isShortTimedLine(l, maxDuration)) { i++; continue; }
      break;
    }
    return { end: i, credits };
  };
  // 區塊裡夾著確定的名單：每行 1.5 秒內都算。沒有名單、只靠前面的標題撐著：每行要短於 1 秒，
  // 否則名單後第一句唱得快的歌詞（復刻回憶「你还好吗」1.1 秒、扛轎「是啥时有咚咚猜」1.4 秒）會被吃掉。
  let { end, credits } = scan(1500);
  if (credits === 0) ({ end, credits } = scan(1000));
  const size = end - start;
  if (size === 0 || out.length - end < 3) return start;
  if (needCredit && credits === 0) return start;
  // 一定要有佐證：前面確認過標題／名單，或區塊裡有名單。光是「連續幾行很快」不算（饒舌、口白）。
  if (!anchored && credits === 0) return start;
  return end;
}

// 「短標籤：值」的形狀（標籤不是人稱開頭的句子）。單獨不算名單，只在兩側都是名單時才算。
function isLabeledLine(line) {
  if (!line || typeof line.text !== 'string') return false;
  const m = line.text.trim().match(/^([^:：∶]{2,12})[:：∶]\s*\S/);
  return !!m && !/^(?:我|你|他|她|它)/.test(m[1]);
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
    // 大編制製作（弦樂/管樂/多位樂手各自掛名）名單可以輕鬆超過 20 行——實測「為愛癡狂」
    // 單首就有 21 行——20 太容易被砍到一半就停手，改成 40；紀錄片主題曲（光亮）整份名單超過 50 行，
    // 再放到 80。每一行仍要符合名單條件才會被砍，這只是防呆上限。
    edge: 80,
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
    const isBlank = (l) => l && typeof l.text === 'string' && l.text.trim() === '';
    let start = 0;
    // 酷狗常先放「歌名-歌手」，下一行才開始 credit。只有兩者連續出現才把標題一起清掉。
    let headerSeen = false;
    if (isHeaderLine(out[0], 0) && isCreditLine(out[1], 1)) { start = 1; headerSeen = true; }
    // 0 秒就出現、破折號兩側有空白的「歌名 (…主題曲) - 歌手」：後面沒有名單也是標題
    else if (isStandaloneHeader(out[0]) && out.length > 4) { start = 1; headerSeen = true; }
    else start = leadingTitleSkip(out, isCreditLine);
    // 開頭只有歌名（或被截一半的標題）、後面接著一段含名單的快速人名：連第 0 行一起跳過
    if (start === 0 && out.length > 4 && String(out[0]?.text || '').trim().length <= 60) {
      const zeroHeader = typeof out[0]?.time === 'number' && out[0].time <= 1000 && HEADER_RE.test(String(out[0].text || '').trim());
      // 「我曾-隔壁老樊」：0 秒的緊湊標題本身就是佐證，後面的快速人名可以沒有角色名
      const after = timedCreditBlock(out, 1, zeroHeader, !zeroHeader);
      if (after > 1) { start = after; headerSeen = true; }
    }
    // 真實名單常用空白行分隔每個角色（「作曲：X」空一行「編曲：Y」），空白行本身
    // 不算 credit，但不該讓它中止「連續符合」——否則名單稍長、夾了空行就會在
    // 半途停手，漏砍後段（見踩坑：弦樂/和聲/混音/母帶/製作團隊被擋在空行後面）。
    // 做法：掃描時跳過空白行，但只有在空白之後仍接得上 credit 行才一併吃掉；
    // 一旦遇到非空白且非 credit 的正文，立刻停止（含期間跳過的空白不倒退）。
    for (let guard = 0; guard < 3; guard++) {
      while (start < out.length && start < maxRun) {
        if (isBlank(out[start])) { start++; continue; }
        if (isCreditLine(out[start], start)) { start++; continue; }
        // 夾在兩行名單中間的「沒見過的角色：值」（合唱：一寸光年團隊、工作室負責人：…）
        if (start > 0 && isCreditLine(out[start - 1], start - 1) && isLabeledLine(out[start]) && isCreditLine(out[start + 1], start + 1)) { start++; continue; }
        // 名單剛結束緊接一行標題（LRC 依時間排序後變成「詞、曲、歌名 - 歌手」）
        if (start > 0 && start <= 3 && isStandaloneHeader(out[start])) { start++; continue; }
        // 名單中間夾一行「歌名 - 歌手」（網易雲常見：作詞作曲、標題、再一次詞曲）
        if (start > 0 && HEADER_RE.test(out[start].text.trim()) && /\s[-–—－]\s/.test(out[start].text)
          && isCreditLine(out[start + 1], start + 1)) { start++; continue; }
        break;
      }
      // Apple Music 系的名單常只剩人名（「利伟明」「蜂鸟音乐」），角色名被來源拿掉了，靠時間軸認：
      // 擠在前奏、每行不到 1.5 秒、每字不到 0.23 秒；唱出來的歌詞每行 2～8 秒、每字 0.25 秒以上。
      const block = timedCreditBlock(out, start, headerSeen || start > 0);
      if (block <= start) break;
      start = block;
    }
    let end = out.length;
    while (end > start && (out.length - end) < maxRun) {
      if (isBlank(out[end - 1])) { end--; continue; }
      if (isCreditLine(out[end - 1], end - 1)) { end--; continue; }
      if (end < out.length && end >= 2 && isLabeledLine(out[end - 1]) && isCreditLine(out[end - 2], end - 2)) { end--; continue; }
      break;
    }
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
    // LRC 用「只有時間、沒有字」的空行標出上一句在哪裡結束（間奏前最常見）。直接刪掉的話上一句
    // 會一路掛到下一句才換（間奏 30 秒都停在畫面上）；先把它換算成上一句的 duration 再刪。
    const isEmpty = (l) => l && typeof l.text === 'string' && l.text.trim() === '';
    const noEmpty = [];
    for (const l of out) {
      if (!isEmpty(l)) { noEmpty.push(l); continue; }
      const prev = noEmpty[noEmpty.length - 1];
      if (prev && typeof l.time === 'number' && typeof prev.time === 'number' && l.time > prev.time
        && !(Number(prev.duration) > 0)) {
        noEmpty[noEmpty.length - 1] = { ...prev, duration: l.time - prev.time };
      }
    }
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
