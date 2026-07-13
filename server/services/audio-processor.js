/**
 * 音訊處理服務
 * 
 * 功能：
 * 1. YouTube 連結處理（yt-dlp 串接）
 * 2. 音訊串流
 * 3. 智慧標題解析（Phase 3 增強：過濾更多干擾詞）
 */
const { execFile, spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { fetchWithTimeout } = require('../utils/helpers');
const { LyricsEngine } = require('./lyrics-engine');
const { createLogger } = require('../utils/logger');
const log = createLogger('Audio');
const { isYouTubeUrl, isPlaylistUrl, extractVideoId } = require('../utils/youtube-url');
const { assessYouTubeImport } = require('../utils/youtube-import-risk');

const execFileAsync = promisify(execFile);

// ─── yt-dlp 命令超時設定 ───
const YTDLP_INFO_TIMEOUT = 45000;     // 取得影片資訊超時: 45s
const YTDLP_DOWNLOAD_TIMEOUT = 300000; // 下載音訊超時: 5min
const YTDLP_MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const YTDLP_METADATA_PRINT = 'before_dl:__ES_META__%()j';

// ─── yt-dlp 執行環境：強制 UTF-8 輸出（跨機器穩定）───
// Windows 上 Python(yt-dlp) 的 stdout 被導管(pipe)時，預設用「系統 ANSI codepage」
// （繁中機器多為 cp950、簡中 cp936…）輸出，而非 UTF-8。含中文的影片標題會被
// Node 以 UTF-8 解碼成亂碼，連帶歌詞自動搜尋拿到錯字串而失敗。
// 設 PYTHONIOENCODING/PYTHONUTF8 強制 yt-dlp 一律輸出 UTF-8，朋友機器 locale 不同也不亂碼。
// （開發者自己的機器若已開「Beta: UTF-8」或 codepage 剛好，才會一直沒踩到這個坑。）
const YTDLP_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const YTDLP_BASE_OPTS = { encoding: 'utf8', env: YTDLP_ENV, windowsHide: true };
const activeImports = new Map();
const prefetchedInfo = new Map();
const requestControllers = new Map();
const importQueue = [];
let activeDownloads = 0;
let ffmpegTail = Promise.resolve();
const PREFETCH_TTL_MS = 10 * 60 * 1000;

function rememberPrefetchedInfo(url, info) {
  const videoId = extractVideoId(url) || info?.id;
  if (!videoId || !info) return;
  for (const [key, value] of prefetchedInfo) {
    if (value.expiresAt <= Date.now()) prefetchedInfo.delete(key);
  }
  if (prefetchedInfo.size >= 200) prefetchedInfo.delete(prefetchedInfo.keys().next().value);
  prefetchedInfo.set(videoId, { info, expiresAt: Date.now() + PREFETCH_TTL_MS });
}

function takePrefetchedInfo(url) {
  const videoId = extractVideoId(url);
  const cached = videoId && prefetchedInfo.get(videoId);
  if (!cached) return null;
  prefetchedInfo.delete(videoId);
  return cached.expiresAt > Date.now() ? cached.info : null;
}

class ImportCancelledError extends Error {
  constructor() {
    super('匯入已取消');
    this.name = 'ImportCancelledError';
    this.code = 'IMPORT_CANCELLED';
  }
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new ImportCancelledError();
}

function registerRequestController(requestId) {
  if (!requestId) return null;
  requestControllers.get(requestId)?.abort();
  const controller = new AbortController();
  requestControllers.set(requestId, controller);
  return controller;
}

function clearRequestController(requestId, controller) {
  if (requestId && requestControllers.get(requestId) === controller) requestControllers.delete(requestId);
}

function runQueued(job, priority, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ImportCancelledError());
    const item = { job, priority: priority === 'batch' ? 0 : 1, resolve, reject, signal, started: false };
    item.onAbort = () => {
      if (item.started) return;
      const index = importQueue.indexOf(item);
      if (index >= 0) importQueue.splice(index, 1);
      reject(new ImportCancelledError());
    };
    signal?.addEventListener('abort', item.onAbort, { once: true });
    importQueue.push(item);
    importQueue.sort((a, b) => b.priority - a.priority);
    drainQueue();
  });
}
function drainQueue() {
  while (activeDownloads < 2 && importQueue.length) {
    const item = importQueue.shift();
    if (item.signal?.aborted) { item.reject(new ImportCancelledError()); continue; }
    item.started = true;
    item.signal?.removeEventListener('abort', item.onAbort);
    activeDownloads++;
    Promise.resolve().then(() => item.job(item.signal)).then(item.resolve, item.reject).finally(() => { activeDownloads--; drainQueue(); });
  }
}
function withFfmpegLock(job) {
  const result = ffmpegTail.then(job, job);
  ffmpegTail = result.catch(() => {});
  return result;
}

function cleanupCancelledDownload(url, outputDir) {
  const videoId = extractVideoId(url);
  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return;
  try {
    for (const name of fs.readdirSync(outputDir)) {
      // mp3 也要清：取消若發生在 ffmpeg 轉碼中，會留下寫到一半的 videoId.mp3。
      // 只清「videoId.副檔名」形式的檔案；成功匯入後已改名為「歌手 - 歌名.mp3」，不受影響。
      if (!name.startsWith(`${videoId}.`) || !/\.(?:part|webm|m4a|opus|temp|mp3)$/i.test(name)) continue;
      try { fs.unlinkSync(path.join(outputDir, name)); } catch (_) { /* best effort */ }
    }
  } catch (_) { /* outputDir may not exist yet */ }
}

// ─── 檔名清理：讓下載檔案在硬碟裡一眼看出是哪首歌（歌手 - 歌名.ext）───
// Windows 保留字元 \/:*?"<>| 與控制字元都會讓寫檔失敗，一律代換成空白後收攏；
// 長度裁切避免加上聲音品質等長標題時超過路徑長度限制。
function sanitizeForFilename(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function buildTrackFilename(artist, title, ext) {
  const cleanTitle = sanitizeForFilename(title) || '未知歌曲';
  const cleanArtist = sanitizeForFilename(artist);
  const base = cleanArtist ? `${cleanArtist} - ${cleanTitle}` : cleanTitle;
  return `${base}${ext}`;
}

// ─── 標題解析干擾詞過濾表 ───
const NOISE_PATTERNS = [
  // 官方相關（中英日）
  /\(?\s*Official\s*(Music\s*)?Video\s*\)?/gi,
  /\(?\s*Official\s*(Audio|Lyric|Visualizer)\s*Video?\s*\)?/gi,
  /\(?\s*官方(?:MV|音樂錄影帶|Music\s*Video)?\s*\)?/gi,
  /\(?\s*Official\s*\)?/gi,
  /\bMV\b/gi,
  /\bPV\b/gi,
  // 畫質相關
  /\(?\s*(HD|4K|8K|UHD|HDR)\s*\)?/gi,
  /\(?\s*(?:\d+K\s*)?(?:re)?master(?:ed)?(?:\s+\d{4})?\s*\)?/gi,
  /\(?\s*\d{3,4}p\s*(?:HD)?\s*\)?/gi,
  // 版本相關
  /\(?\s*Full\s*Ver(?:sion)?\s*\)?/gi,
  /\(?\s*Short\s*Ver(?:sion)?\s*\)?/gi,
  /\(?\s*Lyric\s*Video\s*\)?/gi,
  /\(?\s*Music\s*Video\s*\)?/gi,
  // 語言/字幕相關
  /\(?\s*(中文字幕|中文歌詞|日文字幕|英文字幕|繁體中文|简体中文|CC|Subtitle)\s*\)?/gi,
  // 發行相關
  /\(?\s*(新曲|New\s*Release|Latest)\s*\)?/gi,
  // 特殊標記
  /\(?\s*(Promo|Teaser|Preview|Clip|Edit)\s*\)?/gi,
  /[【「『《〈][^】」』》〉]*(?:伴奏|動態|动态|字幕|歌詞|歌词)[^】」』》〉]*[】」』》〉]/gi,
  // 歌詞影片／頻道常見標記
  /\(?\s*(?:動態歌詞|动态歌词|歌詞Lyrics|歌词Lyrics|歌詞字幕|歌词字幕|歌詞拼音|歌词拼音|歌詞|歌词|Lyrics?|歌回剪輯|歌回剪辑|歌雜剪輯|歌杂剪辑)\s*\)?/gi,
  // 伴奏版本不屬於正式歌名；原字串仍保留在 originalName
  /\(?\s*(?:(?:原版|女版|男版|純|纯)?伴奏(?:歌詞|歌词)?(?:版)?|KTV(?:伴奏)?(?:歌詞|歌词)?(?:版)?|卡拉\s*OK|卡拉OK|純音樂|纯音乐|去人聲|去人声|無人聲|无人声|消音(?:版)?|導唱(?:版)?|导唱(?:版)?|吉他伴奏|鋼琴(?:和弦)?|钢琴(?:和弦)?|Live\s*Band原創伴奏改編|Karaoke(?:\s*Version)?|Instrumental(?:\s*Version)?|Off\s*Vocal|Backing\s*Track|with\s*backing\s*vocals)\s*\)?/gi,
  /\(?\s*(?:原調|原调)(?:伴奏)?\s*\)?/gi,
  /\(?\s*(?:(?:男|女|升|降)\s*Key|Key)\s*(?:[+#-]?\s*\d+|[A-G](?:b|#)?)?\s*\)?/gi,
  /\(?\s*(?:男調|女調|男调|女调)\s*\)?/gi,
  /\(?\s*[+#-]?\s*[A-G](?:b|#)?\s*調\s*\)?/gi,
  /\(?\s*(?:女版|男版|女生版|男生版)\s*\)?/gi,
  /\(?\s*(?:Female|Male)\s*Version\s*\)?/gi,
  // 翻唱/版本標記（放在標題末尾的）
  /\s+(Cover|翻唱|covered\s+by|arrangement|arr\.)\s*$/gi,
  // 翻唱在詞中（不限末尾）
  /\s+(?:Cover|翻唱)\s*/gi,
  // 高頻出現的括號後綴
  /\(\d{4}\)/g,
  // 清理殘留的空括號
  /\(\s*\)/g,
];

const LEADING_NOISE_TAG = /^\s*(?:【\s*([^】]+)\s*】|\[\s*([^\]]+)\s*\]|「\s*([^」]+)\s*」|『\s*([^』]+)\s*』|《\s*([^》]+)\s*》|〈\s*([^〉]+)\s*〉)\s*/;
const NOISE_TAG_TEXT = /(?:^|\b)(?:mv|pv|official|lyrics?|audio|video|ktv|karaoke)(?:\b|$)|動態歌詞|动态歌词|歌回剪輯|歌回剪辑|歌雜剪輯|歌杂剪辑|伴奏|純音樂|纯音乐|女版|男版|完整版|官方版|原版|\bch\.?\s*[-–—]/i;
const PROMO_TAIL = /(?:全球網路大首播|全球网络大首播|網路大首播|网络大首播|首播|完整版|完整版本|官方版)+/gi;
const PUBLISHER_TAIL = /\s*[-–—]\s*(?:華納|华纳|索尼|Sony|滾石|滚石|相信音樂|相信音乐|環球|环球|ForwardMusic|avex)[^\n]*$/i;

function compactSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeVideoText(value) {
  return compactSpaces(String(value || '')
    .normalize('NFKC')
    .replace(/[|｜]/g, '|')
    .replace(/／/g, '/')
    .replace(/[–—−]/g, '-'));
}

function stripLeadingNoiseTags(value) {
  let text = value;
  let match = text.match(LEADING_NOISE_TAG);
  while (match && NOISE_TAG_TEXT.test(match.slice(1).find(Boolean) || '')) {
    text = text.slice(match[0].length).trim();
    match = text.match(LEADING_NOISE_TAG);
  }
  return text;
}

function cleanIdentityPart(value, kind = 'title') {
  let text = compactSpaces(value)
    .replace(PROMO_TAIL, '')
    .replace(/^[\s:：|/\-]+|[\s:：|/\-]+$/g, '')
    .replace(/\s*-\s*(?:版|歌詞版|歌词版)\s*$/i, '')
    .trim();
  if (kind === 'title') {
    text = text
      .replace(/\s*[（(](?:電影|电影|電視劇|电视剧|戲劇|戏剧|動畫|动画|日劇|日剧|韓劇|韩剧)[^）)]*[）)]\s*$/i, '')
      .replace(/\s*(?:電影|电影|電視劇|电视剧|戲劇|戏剧|動畫|动画)[「『《【].*$/i, '')
      .replace(/\s*(?:主題曲|主题曲|片頭曲|片头曲|片尾曲|插曲)\s*$/i, '')
      .trim();
  } else {
    const knownPrefix = KNOWN_ARTISTS_RAW
      .filter((name) => text.toLowerCase().startsWith(name.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
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
  '孫燕姿', '鄧紫棋', '徐佳瑩', '盧廣仲', '陶喆', '伍佰', '楊宗緯', '張惠妹', '莫文蔚',
  '劉若英', '動力火車', 'A-Lin', '理想混蛋', '張碧晨', '周興哲', '艾薇', '陳壹千',
  '黃小琥', '王艷薇', '阿冗', '蘇打綠', '曾瑋中', '張遠',
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
];
const KNOWN_ARTISTS = new Set(KNOWN_ARTISTS_RAW.map(s => s.toLowerCase().replace(/\s+/g, '')));
function isKnownArtist(name) {
  if (!name) return false;
  const k = String(name).toLowerCase().replace(/\s+/g, '');
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

function looksLikeArtist(value) {
  const text = compactSpaces(value);
  if (!text) return false;
  if (isKnownArtist(text)) return true;
  if (/\b(?:feat\.?|ft\.?|with|and|x|vs\.?)\b|[&×]|樂團|乐团|合唱團|合唱团| orchestra\b/i.test(text)) return true;
  // 中英並列藝名（例如「林俊傑 JJ Lin」）比一般歌名更像歌手欄位。
  if (/\p{Script=Han}.*\b[A-Za-z][A-Za-z .'-]{2,}\b/u.test(text)) return true;
  return false;
}

class AudioProcessor {
  static setProgressEmitter(emitter) { this._progressEmitter = emitter; }
  static _runQueuedForTest(job, priority = 'batch', signal = null) { return runQueued(job, priority, signal); }
  static _metadataPrintTemplateForTest() { return YTDLP_METADATA_PRINT; }
  static _registerCancellationForTest(requestId) {
    const controller = registerRequestController(requestId);
    return { signal: controller.signal, cleanup: () => clearRequestController(requestId, controller) };
  }
  static cancelImport(requestId) {
    const controller = requestControllers.get(String(requestId || ''));
    if (!controller) return { ok: false, code: 'NOT_FOUND', message: '找不到可取消的匯入工作，可能已經完成。' };
    if (!controller.signal.aborted) controller.abort();
    return { ok: true, code: 'CANCEL_REQUESTED', message: '已要求取消匯入。' };
  }
  static shouldResolveAppleMetadata(info, identity, cover) {
    return !cover && Number(info?.duration) >= 60 && Number(identity?.confidence) < 0.8;
  }
  /**
   * 處理 YouTube 連結
   */
  static async processYouTube(url, options = {}) {
    if (!isYouTubeUrl(url)) throw new Error('無效的 YouTube URL 格式，請提供有效的 YouTube 連結');
    const requestId = options.requestId ? String(options.requestId) : '';
    const controller = registerRequestController(requestId);
    options = { ...options, signal: controller?.signal || options.signal };
    const videoId = extractVideoId(url);
    const libraryStore = require('./library-store');
    const cached = videoId && libraryStore.getEntry(videoId);
    if (cached?.filename && libraryStore.audioExists(cached.filename)) {
      log.info(`本機快取命中: ${videoId}`);
      log.perf('youtube-cache', 0, { videoId, hit: true });
      clearRequestController(requestId, controller);
      return { ...cached, id: videoId, cacheHit: true };
    }
    if (videoId && activeImports.has(videoId)) {
      log.info(`合併同影片進行中請求: ${videoId}`);
      clearRequestController(requestId, controller);
      return activeImports.get(videoId);
    }
    const promise = runQueued(() => this._processYouTube(url, options), options.priority, options.signal);
    if (videoId) activeImports.set(videoId, promise);
    try { return await promise; } catch (err) {
      if (typeof this._progressEmitter === 'function') this._progressEmitter({ requestId: options.requestId, stage: '失敗', error: err.message });
      throw err;
    } finally {
      if (videoId && activeImports.get(videoId) === promise) activeImports.delete(videoId);
      clearRequestController(requestId, controller);
    }
  }

  static async _processYouTube(url, options = {}) {
    throwIfCancelled(options.signal);
    const processStart = Date.now();
    log.info(`開始處理: ${url}`);
    const progress = (stage, percent) => {
      log.info(`匯入階段: ${stage}${Number.isFinite(percent) ? ` ${percent}%` : ''}`);
      if (typeof this._progressEmitter === 'function') this._progressEmitter({ requestId: options.requestId, stage, percent });
      if (typeof options.onProgress === 'function') options.onProgress({ requestId: options.requestId, stage, percent });
    };
    progress('正在取得影片資訊');
    const infoStart = Date.now();
    const prefetched = takePrefetchedInfo(url);
    let downloadTask = this.downloadWithMetadata(url, progress, prefetched, options.signal);
    // completed 是即時建立、稍後才被 Promise.all await 的 promise；在 metadata → 歌詞校正
    // 之間若下載/轉碼先失敗，會在「還沒有 handler」的空窗觸發 unhandledRejection，前端也就
    // 收不到失敗通知而卡在「正在轉換音訊」。掛個 no-op 守衛，真正的錯誤仍由後面的 await 消費。
    downloadTask.completed.catch(() => {});
    let info;
    try { info = await downloadTask.metadata; }
    catch (primaryError) {
      throwIfCancelled(options.signal);
      log.warn(`單次流程在 metadata 前失敗，啟用 client/oEmbed 降級: ${primaryError.message}`);
      info = await this.getVideoInfo(url);
      if (!info) throw primaryError;
      // metadata 輸出格式不相容／解析失敗時，原本的 yt-dlp 下載仍在正常進行；沿用它可避免
      // 為同一支影片再跑一次 extractor。只有 yt-dlp 子程序本身失敗才重啟下載。
      if (primaryError.code === 'YTDLP_METADATA') {
        downloadTask = { metadata: Promise.resolve(info), completed: downloadTask.completed };
      } else {
        downloadTask = this.downloadWithMetadata(url, progress, info, options.signal);
        downloadTask.completed.catch(() => {});
      }
    }
    const infoDuration = Date.now() - infoStart;
    throwIfCancelled(options.signal);
    log.perf('youtube-info', infoDuration, { url });

    if (!info) throw new Error('無法取得影片資訊。可能需要 cookies 認證，請參考 yt-dlp 文件設定 cookies。');

    // YouTube 的 channel/uploader 經常是唱片公司；優先採用 yt-dlp 已拆出的
    // track / artist(s)，沒有才回退到影片標題規則。
    let identity = this.resolveTrackIdentity(info);
    const cover = this.detectCover(info);
    if (this.shouldResolveAppleMetadata(info, identity, cover)) {
      try {
        const catalogIdentity = await LyricsEngine.resolveAppleMusicMetadata({
          artist: identity.artist,
          title: identity.title,
          rawTitle: info.title,
          duration: info.duration || 0,
        });
        if (catalogIdentity) identity = { ...identity, ...catalogIdentity, reason: 'apple-catalog' };
      } catch (e) {
        log.warn('Apple Music 歌名校正失敗，沿用本機解析: ' + e.message);
      }
    }
    const performer = cover ? (identity.artist || info.channel || info.uploader || '') : '';
    if (cover) identity = { ...identity, artist: '', confidence: 0, reason: 'cover-original-unknown' };
    let artist = identity.artist;
    const title = identity.title;

    log.info(`影片標題解析: "${info.title}" → 歌手: "${artist}", 歌名: "${title}"`);

    // 並行執行歌詞搜尋和音訊下載
    progress('正在搜尋歌詞');
    const lyricsStart = Date.now();
    const artistLookup = (cover || !artist)
      ? LyricsEngine.resolveOriginalArtist(title, info.duration || 0).catch(() => null)
      : Promise.resolve(null);
    const lyricsPromise = LyricsEngine.search(artist, title, info.duration || 0)
      .catch(e => { log.warn('歌詞搜尋失敗: ' + e.message); return null; });
    const [lyricsResult, downloaded, originalArtist] = await Promise.all([lyricsPromise, downloadTask.completed, artistLookup]);
    throwIfCancelled(options.signal);
    log.perf('lyrics-search', Date.now() - lyricsStart, { title });
    if (originalArtist?.artist) artist = originalArtist.artist;
    const filename = this.renameToReadableFilename(downloaded.filePath, downloaded.outputDir, artist, title);

    this.requireDownloadedAudio(filename);

    const totalDuration = Date.now() - processStart;
    log.info(`YouTube 處理完成: ${title} (${totalDuration}ms)`);
    log.perf('youtube-process', totalDuration, { title, hasAudio: !!filename, hasLyrics: !!lyricsResult, cacheHit: false });
    progress('已完成', 100);

    const track = {
      id: info.id || path.basename(filename, path.extname(filename)),
      filename,
      originalName: info.title,
      title: title || info.title,
      artist: artist || '',
      performer,
      uploader: info.uploader || info.channel || '',
      isCover: cover,
      artistConfidence: originalArtist?.confidence || identity.confidence || 0,
      needsArtistConfirmation: !artist,
      artistCandidates: originalArtist?.candidates || [],
      album: info.album || '',
      duration: info.duration || 0,
      cover: info.thumbnail || null,
      lyrics: lyricsResult ? lyricsResult.lyrics : null,
      lyricsType: lyricsResult ? lyricsResult.type : null,
      // 關鍵：帶上「已解析(且會被非同步羅馬化就地填入 phonetic/xieyin)」的 parsedLyrics，
      // 否則顯示端只拿到原始歌詞字串、自己重解析→沒有拼音/諧音；逐字(KRC)尤其明顯。
      // play:track 也會用這份在播放當下補做羅馬化並廣播。
      parsedLyrics: lyricsResult ? (lyricsResult.parsedLyrics || null) : null,
      source: 'youtube',
      url,
    };
    require('./library-store').rememberImport(track);
    return track;
  }

  // 翻唱偵測：命中即會清空 artist 改標「原唱待確認」，故寧可漏判也要避免誤判。
  // 強訊號（標題或描述皆可）＝明確的「翻唱演出」用語；單獨的 "cover" 只看標題，
  // 且排除 album cover／cover art／cover photo 等「封面／圖片」語意的非翻唱用法。
  static detectCover(info = {}) {
    const title = String(info.title || '');
    const haystack = `${title}\n${info.description || ''}`;
    const strong = /歌ってみた|弾き語り|翻唱|カバー曲|cover(?:ed)?\s+by|[（(\[【]\s*cover\s*[)）\]】]|(?:vocal|acoustic|piano|guitar|band|live|female|male|english|acappella|a[\s.]*cappella)\s+covers?\b/i;
    if (strong.test(haystack)) return true;
    // 標題中單獨出現的 "cover"（如「Song (Cover)」被打成「Song Cover」）
    const bareCover = /\bcovers?\b/i.test(title);
    const nonPerformance = /\balbum\s+covers?\b|\bcovers?\s+(?:art|artwork|photo|image|images|design|reveal|page)\b/i.test(title);
    return bareCover && !nonPerformance;
  }

  static cleanArtistName(name) {
    if (!name) return '';
    return name.replace(/\(\d+\)$/g, '').trim();
  }

  /** yt-dlp 的 artist(s) 是音樂中繼資料；channel/uploader 只作最後退路。 */
  static getMetadataArtist(info = {}) {
    const values = [];
    if (Array.isArray(info.artists)) values.push(...info.artists);
    if (info.artist) values.push(info.artist);
    if (info.albumArtist) values.push(info.albumArtist);
    const seen = new Set();
    return values
      .map((value) => this.cleanArtistName(value))
      .filter((value) => value && !seen.has(value.toLowerCase()) && seen.add(value.toLowerCase()))
      .join(' & ');
  }

  static cleanTrackTitle(title) {
    if (!title || typeof title !== 'string') return '';
    let cleaned = title;
    for (const pattern of NOISE_PATTERNS) cleaned = cleaned.replace(pattern, '');
    return cleanIdentityPart(cleaned.replace(/\s+/g, ' ').trim(), 'title');
  }

  /**
   * 解析層級：yt-dlp 結構化音樂欄位 > 影片標題規則 > 可信的頻道名稱。
   * 頻道只有真的出現在標題中才可當歌手，避免 ForwardMusic／唱片公司污染資料庫。
   */
  static resolveTrackIdentity(info = {}) {
    const parsed = this.parseVideoTitle(info.title || '');
    const metadataArtist = this.getMetadataArtist(info);
    const metadataTitle = this.cleanTrackTitle(info.track);
    let artist = metadataArtist || parsed.artist || '';
    const title = metadataTitle || parsed.title || this.cleanTrackTitle(info.title) || info.title || '';

    if (!artist) {
      const channel = this.cleanArtistName(info.channel || info.uploader || '');
      const normalizedRaw = normalizeVideoText(info.title).toLowerCase().replace(/\s+/g, '');
      const normalizedChannel = normalizeVideoText(channel).toLowerCase().replace(/\s+/g, '');
      if (normalizedChannel.length >= 2 && normalizedRaw.includes(normalizedChannel)) artist = channel;
    }

    return {
      artist: cleanIdentityPart(artist, 'artist'),
      title: cleanIdentityPart(title, 'title'),
      confidence: metadataTitle || metadataArtist ? 1 : parsed.confidence,
      reason: metadataTitle || metadataArtist ? 'structured-metadata' : parsed.reason,
    };
  }

  // 這是播放器，不是純歌詞匯入器：沒有音檔不能回傳 success。
  // 否則前端會加入 filename=null 的項目，表面匯入成功卻永遠播不了。
  static requireDownloadedAudio(filename) {
    if (!filename) {
      throw new Error('音訊下載失敗，歌曲未加入播放清單；請稍後重試或檢查 yt-dlp／cookies 設定。');
    }
    return filename;
  }

  // ─── YouTube 播放清單 ───
  /** 是否為播放清單連結（含 list= 參數）。 */
  static isPlaylistUrl(url) { return isPlaylistUrl(url); }

  /**
   * 取得播放清單的條目（扁平、不下載音訊，僅 id/title/duration）。
   * 用於先列出清單、再分批逐一 processYouTube。
   * @param {string} url
   * @param {number} limit 最多取幾首（保護用，預設 300）
   * @returns {Promise<Array<{id,title,url,duration}>>}
   */
  static async getPlaylistEntries(url, limit = 300) {
    const args = ['--flat-playlist', '--dump-json', '--no-warnings', '--playlist-end', String(limit), url];
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('yt-dlp', args, { ...YTDLP_BASE_OPTS, timeout: YTDLP_INFO_TIMEOUT, maxBuffer: YTDLP_MAX_BUFFER }));
    } catch (e) {
      // yt-dlp 對部分私人/失效項目會非零退出但仍有 stdout，盡量解析
      stdout = (e && e.stdout) ? e.stdout : '';
      if (!stdout) throw new Error('無法取得播放清單內容：' + (e.message || 'yt-dlp 失敗'));
    }
    const entries = [];
    const seen = new Set();
    for (const line of String(stdout).split('\n')) {
      const t = line.trim();
      if (!t || t[0] !== '{') continue;
      try {
        const j = JSON.parse(t);
        if (!j.id || seen.has(j.id)) continue;
        seen.add(j.id);
        entries.push({
          id: j.id,
          title: j.title || j.id,
          url: j.url || `https://www.youtube.com/watch?v=${j.id}`,
          duration: j.duration || 0,
        });
      } catch (e) { /* 跳過非 JSON 行 */ }
    }
    return entries;
  }

  static async getVideoInfo(url, signal = null) {
    const strategies = [
      ['--js-runtimes', 'node', '--dump-json', '--no-download', '--no-playlist'],
      ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=android', '--dump-json', '--no-download', '--no-playlist'],
      ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=ios', '--dump-json', '--no-download', '--no-playlist'],
      ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=tv', '--dump-json', '--no-download', '--no-playlist'],
      ['--js-runtimes', 'node', '--extractor-args', 'youtube:player_client=mweb', '--dump-json', '--no-download', '--no-playlist'],
    ];

    for (let i = 0; i < strategies.length; i++) {
      const args = strategies[i];
      const strategyStart = Date.now();
      try {
        const { stdout } = await execFileAsync('yt-dlp', [...args, url], {
          ...YTDLP_BASE_OPTS,
          timeout: YTDLP_INFO_TIMEOUT,
          maxBuffer: YTDLP_MAX_BUFFER,
          signal,
        });

        const data = JSON.parse(stdout);
        const strategyDuration = Date.now() - strategyStart;
        log.info(`yt-dlp 取得影片資訊成功 (策略 ${i + 1}, ${strategyDuration}ms)`);
        log.perf('ytdlp-info', strategyDuration, { strategy: i + 1 });

        return {
          id: data.id,
          title: data.title,
          duration: data.duration,
          thumbnail: data.thumbnail,
          album: data.album,
          track: data.track || '',
          artist: data.artist || '',
          artists: Array.isArray(data.artists) ? data.artists : [],
          albumArtist: data.album_artist || '',
          channel: data.channel || '',
          uploader: data.uploader || '',
          description: data.description || '',
          categories: Array.isArray(data.categories) ? data.categories : [],
        };
      } catch (err) {
        if (signal?.aborted) throw new ImportCancelledError();
        const errMsg = err.message || '';
        const strategyDuration = Date.now() - strategyStart;
        if (errMsg.includes('Sign in to confirm')) {
          log.info(`yt-dlp 策略 ${i + 1} 需要登入驗證，嘗試下一策略 (${strategyDuration}ms)`);
          continue;
        }
        log.error('取得影片資訊失敗 (策略 ' + (i + 1) + ', ' + strategyDuration + 'ms): ' + errMsg.substring(0, 200));
        continue;
      }
    }

    log.info('yt-dlp 全部策略失敗，嘗試 oEmbed API 降級...');
    return await this.getVideoInfoOembed(url, signal);
  }

  static async getVideoInfoOembed(url, signal = null) {
    const oembedStart = Date.now();
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetchWithTimeout(oembedUrl, { signal }, 10000);
      if (!res.ok) return null;

      const data = await res.json();
      const videoId = this.extractVideoId(url);
      const oembedDuration = Date.now() - oembedStart;
      log.info(`oEmbed API 降級成功 (${oembedDuration}ms)`);
      log.perf('youtube-oembed', oembedDuration);

      return {
        id: videoId,
        title: data.title || '',
        duration: 0,
        thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        album: '',
        artist: '',
        artists: [],
        track: '',
        channel: data.author_name || '',
        uploader: data.author_name || '',
      };
    } catch (e) {
      if (signal?.aborted) throw new ImportCancelledError();
      const oembedDuration = Date.now() - oembedStart;
      log.error('oEmbed API 也失敗 (' + oembedDuration + 'ms): ' + e.message);
      return null;
    }
  }

  static extractVideoId(url) { return extractVideoId(url); }

  static async inspectYouTube(url, options = {}) {
    if (!isYouTubeUrl(url)) throw new Error('無效的 YouTube URL 格式');
    const requestId = options.requestId ? String(options.requestId) : '';
    const controller = registerRequestController(requestId);
    try {
      const info = await this.getVideoInfo(url, controller?.signal || options.signal);
      if (!info) throw new Error('無法取得影片資訊');
      rememberPrefetchedInfo(url, info);
      return assessYouTubeImport(info);
    } finally {
      clearRequestController(requestId, controller);
    }
  }

  static downloadWithMetadata(url, onProgress, fallbackInfo = null, signal = null) {
    throwIfCancelled(signal);
    const outputDir = path.join(__dirname, '..', '..', 'downloads');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outputTemplate = path.join(outputDir, '%(id)s.%(ext)s');
    let resolveMeta, rejectMeta;
    const metadata = new Promise((resolve, reject) => { resolveMeta = resolve; rejectMeta = reject; });
    if (fallbackInfo) resolveMeta(fallbackInfo);
    const completed = new Promise((resolve, reject) => {
      const args = ['--js-runtimes', 'node', '-f', 'bestaudio/best', '--concurrent-fragments', '4', '--no-playlist',
        '-o', outputTemplate, '--print', YTDLP_METADATA_PRINT, '--print', 'after_move:__ES_FILE__%(filepath)s',
        '--progress', '--newline', '--progress-template', 'download:__ES_PROGRESS__%(progress._percent_str)s', url];
      const started = Date.now();
      const child = spawn('yt-dlp', args, { env: YTDLP_ENV, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '', rawPath = '', metaDone = !!fallbackInfo, timedOut = false;
      const onAbort = () => child.kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      const rejectMetadata = (message) => {
        if (metaDone) return;
        metaDone = true;
        const err = new Error(message);
        err.code = 'YTDLP_METADATA';
        rejectMeta(err);
      };
      const metadataTimer = fallbackInfo ? null : setTimeout(() => rejectMetadata('yt-dlp 未在 15 秒內提供影片 metadata'), 15000);
      const lineBuffers = { stdout: '', stderr: '' };
      // 逐流 StringDecoder：yt-dlp 輸出的中文路徑（歌詞動畫專案…）多位元組字元可能被切在
      // chunk 邊界，若每個 chunk 各自 toString('utf8') 會產生 U+FFFD 亂碼，導致後續 ffmpeg
      // 拿到壞掉的路徑找不到檔案。StringDecoder 會跨 chunk 保留不完整的位元組序列。
      const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
      const consume = (chunk, isError) => {
        const value = decoders[isError ? 'stderr' : 'stdout'].write(chunk);
        if (isError) stderr = (stderr + value).slice(-YTDLP_MAX_BUFFER);
        const key = isError ? 'stderr' : 'stdout';
        const lines = (lineBuffers[key] + value).split(/\r?\n/);
        lineBuffers[key] = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('__ES_META__') && !metaDone) {
            try {
              const d = JSON.parse(line.slice(11));
              metaDone = true;
              if (metadataTimer) clearTimeout(metadataTimer);
              resolveMeta(this.normalizeInfo(d));
              onProgress('正在下載', 0);
            } catch (err) {
              if (metadataTimer) clearTimeout(metadataTimer);
              log.warn(`yt-dlp metadata 解析失敗: ${err.message}`);
              rejectMetadata('yt-dlp metadata 格式無法解析');
            }
          } else if (line.startsWith('__ES_FILE__')) rawPath = line.slice(11).trim();
          else if (line.startsWith('__ES_PROGRESS__')) {
            const percent = Number.parseFloat(line.slice(15)); onProgress('正在下載', Number.isFinite(percent) ? percent : undefined);
          }
        }
      };
      child.stdout.on('data', c => consume(c, false)); child.stderr.on('data', c => consume(c, true));
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, YTDLP_DOWNLOAD_TIMEOUT);
      child.on('error', err => { clearTimeout(timer); if (metadataTimer) clearTimeout(metadataTimer); signal?.removeEventListener('abort', onAbort); if (!metaDone) rejectMeta(signal?.aborted ? new ImportCancelledError() : err); reject(signal?.aborted ? new ImportCancelledError() : err); });
      child.on('close', async code => {
        clearTimeout(timer);
        if (metadataTimer) clearTimeout(metadataTimer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) {
          cleanupCancelledDownload(url, outputDir);
          const err = new ImportCancelledError();
          if (!metaDone) rejectMeta(err);
          reject(err);
          return;
        }
        if (code !== 0 || !rawPath) {
          const err = new Error(timedOut ? 'yt-dlp 下載逾時' : (stderr.trim().split('\n').pop() || `yt-dlp exit ${code}`));
          if (!metaDone) rejectMeta(err); reject(err); return;
        }
        if (!metaDone) rejectMetadata('yt-dlp 下載完成但未提供影片 metadata');
        const downloadMs = Date.now() - started;
        // yt-dlp 在 Windows 印出的 filepath 目錄段（含中文的專案路徑）是經 mbcs/surrogateescape
        // 產生的非法 UTF-8，任何解碼都還原不了（PYTHONUTF8 也無效）；直接拿去餵 ffmpeg -i 會找不到
        // 檔案而卡住。但輸出模板是 %(id)s.%(ext)s，basename 永遠是 ASCII video id，於是用我們自己
        // 掌握、完全正確的 outputDir 重組路徑，徹底繞開 yt-dlp 的壞路徑。
        const cleanPath = path.join(outputDir, path.basename(rawPath));
        log.perf('youtube-download', downloadMs, { path: cleanPath });
        try {
          onProgress('正在轉換音訊');
          const filePath = await withFfmpegLock(() => this.convertToMp3(cleanPath, signal));
          resolve({ filePath, outputDir, downloadMs });
        } catch (err) {
          // 取消發生在轉碼中：yt-dlp 已正常結束（上面的 aborted 分支沒走到），
          // 這裡才是唯一能清掉 videoId.webm 原檔＋寫到一半 videoId.mp3 的地方。
          if (signal?.aborted) cleanupCancelledDownload(url, outputDir);
          reject(err);
        }
      });
    });
    return { metadata, completed };
  }

  static normalizeInfo(data = {}) {
    return { id: data.id, title: data.title || '', duration: data.duration || 0, thumbnail: data.thumbnail || null,
      album: data.album || '', track: data.track || '', artist: data.artist || '', artists: Array.isArray(data.artists) ? data.artists : [],
      albumArtist: data.album_artist || '', channel: data.channel || '', uploader: data.uploader || '', description: data.description || '',
      categories: Array.isArray(data.categories) ? data.categories : [] };
  }

  static convertToMp3(inputPath, signal = null) {
    throwIfCancelled(signal);
    const started = Date.now();
    const outputPath = path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}.mp3`);
    if (path.resolve(inputPath) === path.resolve(outputPath)) return Promise.resolve(outputPath);
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', ['-y', '-i', inputPath, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', outputPath],
        { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const onAbort = () => child.kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      let stderr = ''; const timer = setTimeout(() => child.kill(), YTDLP_DOWNLOAD_TIMEOUT);
      child.stderr.on('data', c => { stderr = (stderr + c.toString()).slice(-YTDLP_MAX_BUFFER); });
      child.on('error', (error) => { signal?.removeEventListener('abort', onAbort); reject(signal?.aborted ? new ImportCancelledError() : error); });
      child.on('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new ImportCancelledError());
        if (code !== 0 || !fs.existsSync(outputPath)) return reject(new Error(`FFmpeg 轉碼失敗: ${stderr.trim().split('\n').pop() || code}`));
        try { fs.unlinkSync(inputPath); } catch (_) { /* 轉碼已成功，不因清理失敗中斷 */ }
        log.perf('ffmpeg-convert', Date.now() - started, { outputPath }); resolve(outputPath);
      });
    });
  }

  /**
   * 把 yt-dlp 存成 videoId.mp3 的下載檔重新命名為「歌手 - 歌名.mp3」，
   * 讓使用者在檔案總管裡不用逐一打開來聽就知道是哪首歌。
   *
   * 檔名（去副檔名）同時就是這首歌的 track id。為避免「同名不同曲」互相覆蓋，
   * 碰撞判定同時看兩處：
   *   1. 硬碟上是否已有同名檔（同一首重新匯入時 originalFilename 相同不算碰撞）。
   *   2. 媒體庫是否已有同 id 的記錄（音檔可能已被清理刪除、但記錄仍在，
   *      若只看硬碟，另一首同名歌會拿到相同 id → recordPlay 覆蓋掉別人的記錄）。
   * 碰撞時在後面加一段短隨機碼（而非遞增序號），確保跨程序/跨刪檔都不重複。
   * 任何一步失敗（權限/佔用）都退回原始檔名，不讓匯入流程中斷。
   */
  static renameToReadableFilename(filePath, outputDir, artist, title) {
    const originalFilename = path.basename(filePath);
    if (!title) return originalFilename;

    // 延遲載入避免啟動期循環相依；library-store 不依賴本模組。
    let libraryStore = null;
    try { libraryStore = require('./library-store'); } catch (e) { /* 靜默：拿不到就只看硬碟 */ }

    const ext = path.extname(filePath);
    const desiredBase = buildTrackFilename(artist, title, '');
    const idTaken = (base) => {
      // 同一首歌重新匯入（原檔名就等於候選）不算碰撞，讓它就地更新同一筆。
      if (`${base}${ext}` === originalFilename) return false;
      if (fs.existsSync(path.join(outputDir, `${base}${ext}`))) return true;
      if (libraryStore && libraryStore.getEntry && libraryStore.getEntry(base)) return true;
      return false;
    };

    let finalBase = desiredBase;
    let guard = 0;
    while (idTaken(finalBase) && guard < 20) {
      finalBase = `${desiredBase} ${crypto.randomBytes(2).toString('hex')}`;
      guard += 1;
    }
    const candidate = `${finalBase}${ext}`;

    if (candidate === originalFilename) return originalFilename;

    try {
      fs.renameSync(path.join(outputDir, originalFilename), path.join(outputDir, candidate));
      return candidate;
    } catch (e) {
      log.warn(`重新命名下載檔失敗，沿用原始檔名 ${originalFilename}: ${e.message}`);
      return originalFilename;
    }
  }

  /**
   * 智慧解析影片標題為歌手 + 歌名
   * Phase 3 增強：過濾更多干擾詞，支援翻唱/原唱偵測
   * 
   * 支援格式：
   * - "Artist - Title"
   * - "Artist『Title』"
   * - "Artist「Title」"
   * - "【Artist】Title"
   * - "Title / Artist"
   * - "Title by Artist"
   * - "【初音未來】千本櫻 官方MV" → { artist: '初音未來', title: '千本櫻' }
   */
  static parseVideoTitle(rawTitle) {
    if (!rawTitle) return { artist: '', title: '', confidence: 0, reason: 'empty' };

    const isLyricRepost = /動態歌詞|动态歌词|歌詞Lyrics|歌词Lyrics|歌詞拼音|歌词拼音|歌回剪輯|歌回剪辑/i.test(rawTitle);
    let cleaned = stripLeadingNoiseTags(normalizeVideoText(rawTitle));
    for (const pattern of NOISE_PATTERNS) cleaned = cleaned.replace(pattern, '');
    cleaned = compactSpaces(cleaned.replace(PUBLISHER_TAIL, '').replace(PROMO_TAIL, ''));
    cleaned = cleaned
      .replace(/(?:【\s*】|《\s*》|〈\s*〉|「\s*」|『\s*』)/g, '')
      .replace(/^\s*[+#-]?\s*\d+\s*\b/i, '')
      .replace(/[（(]\s*[,、+\s-]*[）)]/g, '')
      .replace(/\s*[-+]+\s*(?:歌詞|歌词)?\s*$/i, '')
      .trim();

    let pipeArtist = '';
    let pipeTitle = '';
    // 歌回剪輯也常用「歌名｜原唱｜字幕」；第二段像歌手時先保留，其他 pipe 仍視為宣傳尾註。
    if (cleaned.includes('|')) {
      const parts = cleaned.split('|').map((part) => part.trim()).filter(Boolean);
      const head = parts[0] || '';
      if (parts[1] && !/^cover(?:ed)?\s+by\b/i.test(parts[1]) && looksLikeArtist(parts[1])) {
        pipeTitle = head
          .replace(/^【[^】]+】\s*(?=.)/, '')
          .replace(/^[《〈「『【]\s*|\s*[》〉」』】]$/g, '');
        pipeArtist = parts[1].replace(/^原唱\s*[:：]\s*/i, '');
      }
      if (head.length >= 2) cleaned = head;
    }

    let artist = pipeArtist;
    let title = pipeTitle;
    let confidence = pipeTitle ? 0.9 : 0.35;
    let reason = pipeTitle ? 'pipe-title-artist' : 'whole-title';

    const highlightTitle = cleaned.match(/^【[^】]+】.*(?:歌回精華|直播精華)\s*-\s*([^|｜]+?)(?:\s*\||$)/i);
    if (highlightTitle) {
      title = highlightTitle[1].trim();
      confidence = 0.78;
      reason = 'stream-highlight-title';
    }

    // 歌回剪輯常把「歌名 / 原唱」整組放在開頭標籤內。
    const descriptorTag = !title && cleaned.match(/^【\s*([^/】]+?)\s*\/\s*([^】(（]+)(?:[（(][^）)]*[）)])?\s*】/);
    if (descriptorTag) {
      title = descriptorTag[1].trim();
      artist = descriptorTag[2].trim();
      confidence = 0.94;
      reason = 'tag-title-artist';
    }

    // 頻道 tag 後才是「歌名 / 原唱」：例如【煦Hiyori】雨愛 / 楊丞琳【中文字幕】。
    const channelSlash = !title && cleaned.match(/^【[^】]+】\s*([^/]+?)\s*\/\s*([^【]+?)(?=\s*【|$)/);
    if (channelSlash) {
      title = channelSlash[1].trim();
      artist = channelSlash[2].trim();
      confidence = 0.9;
      reason = 'channel-tag-title-artist';
    }

    // 轉載歌詞常為「歌名 - 原唱『歌詞摘錄』」，方向與官方 MV 相反。
    if (!title && isLyricRepost) {
      const lyricDash = cleaned.match(/^(.+?)\s*-\s*([^『「《【]+?)(?=\s*[『「《【]|$)/);
      if (lyricDash) {
        title = lyricDash[1].trim();
        artist = lyricDash[2].trim();
        confidence = 0.9;
        reason = 'lyric-repost-title-artist';
      }
    }

    // 新式企劃 MV：「《歌名》歌手 with Orchestra」。
    if (!title) {
      const leadingTitle = cleaned.match(/^\s*[《〈]\s*([^》〉]+?)\s*[》〉]\s*(.*)$/);
      if (leadingTitle) {
        title = leadingTitle[1].trim();
        artist = leadingTitle[2].replace(/^[\s:：-]+/, '').split(/[（(【《〈「『|]/)[0].trim();
        if (!artist) {
          const originalSinger = normalizeVideoText(rawTitle).match(/[|｜]\s*原唱\s*[:：]\s*([^|｜]+)/i);
          if (originalSinger) artist = originalSinger[1].trim();
        }
        confidence = 0.94;
        reason = 'leading-decorated-title';
      }
    }

    // 官方 MV：「歌手《歌名》」或「歌手【歌名】」。第一個裝飾框比後面的影視作品框可信。
    if (!title) {
      const promoDash = cleaned.match(/^(.+?)\s*-\s*(.+?)\s+(?:電視劇|电视剧|電影|电影|華劇|华剧)\s*[《【]/i);
      if (promoDash) {
        artist = promoDash[1].trim();
        title = promoDash[2].trim();
        confidence = 0.88;
        reason = 'artist-title-before-promo';
      }
    }

    if (!title) {
      const decorated = cleaned.match(/^(.+?)\s*[《〈【「『]\s*([^》〉】」』]+?)\s*[》〉】」』]/);
      if (decorated) {
        artist = decorated[1].trim();
        title = decorated[2].trim();
        confidence = 0.96;
        reason = 'artist-decorated-title';
      }
    }

    // 「【歌手】歌名」；功能／頻道 tag 已在前面先移除。
    if (!title) {
      const bracketMatch = cleaned.match(/^【([^】]+)】\s*(.+)$/);
      if (bracketMatch) {
        artist = bracketMatch[1].trim();
        title = bracketMatch[2].trim();
        confidence = 0.86;
        reason = 'bracket-artist-title';
      }
    }

    // Title by Artist
    if (!title) {
      const byMatch = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
      if (byMatch) {
        title = byMatch[1].trim();
        artist = byMatch[2].trim();
        confidence = 0.9;
        reason = 'title-by-artist';
      }
    }

    // 斜線在日系官方 MV 中多為「歌名 / 歌手」。
    if (!title) {
      const slashMatch = cleaned.match(/^(.+?)\s*\/\s*(.+)$/);
      if (slashMatch) {
        title = slashMatch[1].trim();
        artist = slashMatch[2].replace(/\s*:\s*.*$/, '').trim();
        confidence = 0.78;
        reason = 'title-artist-slash';
      }
    }

    // 連字號方向有歧義：中英並列藝名、feat./with 與已知歌手可提高判斷可信度。
    if (!title) {
      const dashMatch = cleaned.match(/^(.+?)\s*-\s+(.+)$/);
      if (dashMatch) {
        const left = dashMatch[1].trim();
        const right = dashMatch[2].trim();
        if (/歌回|歌枠|singing\s*stream/i.test(left)) {
          title = right;
          artist = '';
          reason = 'stream-label-title';
        } else if (isLyricRepost || (looksLikeArtist(right) && !looksLikeArtist(left))) {
          title = left;
          artist = right;
          reason = 'title-artist-dash';
        } else {
          artist = left;
          title = right;
          reason = 'artist-title-dash';
        }
        confidence = looksLikeArtist(artist) ? 0.86 : 0.68;
      }
    }

    if (!title) {
      // 少數官方頻道省略所有分隔符：「蕭煌奇 只能勇敢」。僅在命中完整歌手名時拆分。
      const normalized = cleaned.toLowerCase();
      const knownPrefix = KNOWN_ARTISTS_RAW
        .filter((name) => normalized.startsWith(name.toLowerCase() + ' '))
        .sort((a, b) => b.length - a.length)[0];
      if (knownPrefix) {
        const artists = [cleaned.slice(0, knownPrefix.length).trim()];
        let remainder = cleaned.slice(knownPrefix.length).trim();
        // 無分隔符的多人伴奏：「周杰倫 張惠妹 不該」。連續剝離已知歌手，最後才是歌名。
        while (remainder) {
          const next = KNOWN_ARTISTS_RAW
            .filter((name) => remainder.toLowerCase().startsWith(name.toLowerCase() + ' '))
            .sort((a, b) => b.length - a.length)[0];
          if (!next) break;
          artists.push(remainder.slice(0, next.length).trim());
          remainder = remainder.slice(next.length).trim();
        }
        artist = artists.join(' & ');
        title = remainder;
        confidence = 0.84;
        reason = 'known-artist-prefix';
      } else {
        title = cleaned;
      }
    }

    title = cleanIdentityPart(title.replace(/\[.*?\]/g, '').replace(/【.*?】/g, ''), 'title');
    artist = cleanIdentityPart(artist.replace(/\[.*?\]/g, '').replace(/【.*?】/g, ''), 'artist');

    const collaborator = title.match(/^(.+?)\s+with(?:\s+|(?=\p{Script=Han}))(.+)$/iu);
    if (collaborator && artist) {
      title = collaborator[1].trim();
      artist = `${artist} with ${collaborator[2].trim()}`;
    }

    if (artist && title && isKnownArtist(title) && !isKnownArtist(artist)) {
      const swap = artist; artist = title; title = swap;
    }

    // 括號內若是版本名稱需保留；只有明確的影視／動畫說明才移除。
    const stripped = title.replace(/\s*[（(](?:電影|电影|電視劇|电视剧|動畫|动画|日劇|日剧|韓劇|韩剧)[^（）()]*[)）]\s*$/i, '').trim();
    if (stripped.length >= 2) title = stripped;

    return { artist, title, confidence, reason };
  }

  static parseFilename(filename) {
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    return this.parseVideoTitle(nameWithoutExt);
  }
}

module.exports = AudioProcessor;
