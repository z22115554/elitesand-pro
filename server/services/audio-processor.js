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
const { LyricsEngine, DURATION_TOLERANCE } = require('./lyrics-engine');
const { createLogger } = require('../utils/logger');
const log = createLogger('Audio');
const { isYouTubeUrl, isPlaylistUrl, extractVideoId } = require('../utils/youtube-url');
const { assessYouTubeImport } = require('../utils/youtube-import-risk');
const ffmpegProvider = require('./ffmpeg-provider');
const importTempRegistry = require('./import-temp-registry');
const { inspectDiskSpace, appendDiskSpaceWarning } = require('./disk-space');
const { downloadsDir } = require('../utils/app-paths');

const execFileAsync = promisify(execFile);

// ─── yt-dlp 命令超時設定 ───
const YTDLP_INFO_TIMEOUT = 45000;     // 取得影片資訊超時: 45s
const YTDLP_SEARCH_TIMEOUT = 15000;   // 搜尋只讀扁平 metadata，逾時要比單曲 inspect 短
const YTDLP_DOWNLOAD_TIMEOUT = 300000; // 下載音訊超時: 5min
const YTDLP_MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const YTDLP_METADATA_PRINT = 'before_dl:__ES_META__%()j';
// 下載退路的原則是「不先用 client 交換音質」：首先維持預設 client 的最佳 audio-only
// DASH/HTTPS 音訊。只有它因 HTTP 403 失敗時，才嘗試 HLS audio-only；
// HLS 格式需由 web_safari client 才會暴露（預設 client 的 m3u8 manifest 不保證有可選格式），
// 所以這是 HLS 退路專屬的 client。連 HLS audio-only 都不可用時，再將含音訊的 HLS 視訊視為救援；
// Android/iOS 的一般 audio-only client 輪替仍放在最後，不會因為一次 403 就使用。
const YTDLP_PRIMARY_DOWNLOAD_STRATEGY = {
  id: 'primary-audio',
  extractorArgs: [],
  format: 'bestaudio/best',
  concurrentFragments: 4,
};
const YTDLP_HLS_DOWNLOAD_STRATEGIES = [
  { id: 'hls-audio', extractorArgs: ['--extractor-args', 'youtube:player_client=web_safari'], format: 'bestaudio[protocol^=m3u8]', concurrentFragments: 1 },
  { id: 'hls-combined', extractorArgs: ['--extractor-args', 'youtube:player_client=web_safari'], format: 'best[protocol^=m3u8]', concurrentFragments: 1 },
];
// 若 HLS 也無法下載，最後才輪替 player client；每個 client 仍選它自己的最佳 audio-only。
const YTDLP_CLIENT_FALLBACK_STRATEGIES = [
  { id: 'android-audio', extractorArgs: ['--extractor-args', 'youtube:player_client=android'], format: 'bestaudio/best', concurrentFragments: 4 },
  { id: 'ios-audio', extractorArgs: ['--extractor-args', 'youtube:player_client=ios'], format: 'bestaudio/best', concurrentFragments: 4 },
];
const YTDLP_SOURCE_FORMAT_PRINT = 'after_move:__ES_FORMAT__%(format_id)s|%(acodec)s|%(abr)s|%(protocol)s';

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
// 所有會呼叫 yt-dlp 的工作共用這個佇列：不只實際下載，也包含 Twitch／面板
// 在下載前做的 metadata 檢查。否則直播中多人同時 !點歌，會各自啟動多個
// --dump-json 子程序，和下載競爭 CPU／記憶體而讓整台機器看似卡住。
const importQueue = [];
let activeYtDlpJobs = 0;
let ffmpegTail = Promise.resolve();
const PREFETCH_TTL_MS = 10 * 60 * 1000;

const YOUTUBE_SEARCH_LIMIT_MAX = 10;
// 「找更多」往下翻的總筆數上限（只作用在一般 ytsearch 退路；YT Music 歌曲區塊本來就短）。
const YOUTUBE_SEARCH_FETCH_MAX = 50;
// 合輯／串燒／超長 mix：真的單曲幾乎不會這麼長，也不該擠在前排。標記後在 sanitize 裡
// 穩定排序沉到最後——不丟掉，使用者仍可往下捲或用「找更多」翻到。
const COMPILATION_TITLE_RE = /串[燒烧]|合[輯辑集]|精[選选](?:[輯辑集]|\s*\d|.{0,3}[首曲])|[選选]輯|medley|megamix|non\s*-?\s*stop|mixtape|full\s+album|完整專輯|完整专辑|作品集|歌單|歌单|playlist|連續播放|连续播放|連[唱奏]|连[唱奏]/i;
function isLikelyCompilationEntry(title, durationSec) {
  const d = Number.isFinite(durationSec) ? durationSec : 0;
  if (d >= 900) return true;                                                     // ≥ 15 分：單曲幾乎不可能
  if (d >= 420 && COMPILATION_TITLE_RE.test(String(title || ''))) return true;   // ≥ 7 分 ＋ 合輯字樣
  return false;
}
const YOUTUBE_SEARCH_QUERY_MIN = 2;
const YOUTUBE_SEARCH_QUERY_MAX = 100;

function normalizeYouTubeSearchQuery(value) {
  const query = String(value || '').replace(/\s+/g, ' ').trim();
  if (query.length < YOUTUBE_SEARCH_QUERY_MIN || query.length > YOUTUBE_SEARCH_QUERY_MAX) {
    const error = new Error(`搜尋文字需為 ${YOUTUBE_SEARCH_QUERY_MIN}–${YOUTUBE_SEARCH_QUERY_MAX} 個字元`);
    error.code = 'YOUTUBE_SEARCH_INVALID_QUERY';
    throw error;
  }
  return query;
}

function normalizeYouTubeSearchLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return YOUTUBE_SEARCH_LIMIT_MAX;
  return Math.max(1, Math.min(YOUTUBE_SEARCH_LIMIT_MAX, parsed));
}

function isAllowedYouTubeThumbnail(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'i.ytimg.com' || url.hostname.endsWith('.ytimg.com'));
  } catch (_) {
    return false;
  }
}

function sanitizeYouTubeSearchPayload(payload, limit = YOUTUBE_SEARCH_LIMIT_MAX) {
  const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
  const results = [];
  const seen = new Set();
  for (const entry of rawEntries) {
    if (results.length >= YOUTUBE_SEARCH_FETCH_MAX) break; // 硬上限，界定排序／處理工作量
    const videoId = String(entry?.id || '').trim();
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(videoId) || seen.has(videoId)) continue;
    const title = String(entry?.title || '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    seen.add(videoId);
    const thumbnails = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
    const thumbnailCandidate = [entry.thumbnail, ...thumbnails.map((item) => item?.url)]
      .find(isAllowedYouTubeThumbnail);
    const duration = Number(entry.duration);
    const durationRounded = Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0;
    const viewCount = Number(entry.view_count);
    const liveStatus = typeof entry.live_status === 'string' ? entry.live_status : null;
    const cleanTitle = title.slice(0, 300);
    results.push({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: cleanTitle,
      channel: String(entry.channel || entry.uploader || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      duration: durationRounded,
      thumbnail: thumbnailCandidate || '',
      viewCount: Number.isFinite(viewCount) && viewCount >= 0 ? Math.round(viewCount) : null,
      liveStatus,
      unavailable: liveStatus === 'is_live' || liveStatus === 'is_upcoming',
      isShort: /\/shorts\//i.test(String(entry.webpage_url || entry.original_url || entry.url || '')),
      isCompilation: isLikelyCompilationEntry(cleanTitle, durationRounded),
    });
  }
  // 合輯沉到最後，其餘維持來源順序（穩定排序）。
  const ordered = results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.isCompilation === b.r.isCompilation ? a.i - b.i : (a.r.isCompilation ? 1 : -1)))
    .map((x) => x.r);
  const sliceTo = Math.max(1, Math.min(YOUTUBE_SEARCH_FETCH_MAX, Number.parseInt(limit, 10) || YOUTUBE_SEARCH_LIMIT_MAX));
  return ordered.slice(0, sliceTo);
}

function isYouTubeMusicPremiumError(error) {
  return /only available to music premium members/i.test(String(error?.message || error || ''));
}

function isYouTubeHttp403Error(error) {
  return /(?:http\s*error|httperror)\s*403\b|\b403\s*(?:forbidden)?\b/i.test(String(error?.message || error || ''));
}

function createYouTubeMusicPremiumError() {
  const error = new Error('這首 YouTube Music 音樂僅限 Music Premium 播放。');
  error.code = 'YOUTUBE_MUSIC_PREMIUM';
  return error;
}

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
  while (activeYtDlpJobs < 2 && importQueue.length) {
    const item = importQueue.shift();
    if (item.signal?.aborted) { item.reject(new ImportCancelledError()); continue; }
    item.started = true;
    item.signal?.removeEventListener('abort', item.onAbort);
    activeYtDlpJobs++;
    Promise.resolve().then(() => item.job(item.signal)).then(item.resolve, item.reject).finally(() => { activeYtDlpJobs--; drainQueue(); });
  }
}
function withFfmpegLock(job) {
  const result = ffmpegTail.then(job, job);
  ffmpegTail = result.catch(() => {});
  return result;
}

function cleanupOwnedTemporaryDownload(videoId, outputDir) {
  if (!importTempRegistry.isValidVideoId(videoId)) return;
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
  // 括號內混雜多個宣傳詞（例如「(官方完整版MV)」＝官方＋完整版＋MV 疊在一起）時，
  // 下面逐一比對的規則只咬得到其中一個詞，另一個詞跟落單的括號會殘留變成尾綴垃圾
  // （見踩坑：「月亮惹的禍 Troubled By The Moon )」多出一個沒配對的右括號）。
  // 先把整個「含宣傳詞的括號」整組吃掉，後面逐一比對的規則才不會咬到只剩半個括號。
  /[（(][^（）()]{0,24}(?:官方|完整版|精華版|精华版|首播|MV|音樂錄影帶|音乐录影带)[^（）()]{0,24}[）)]/gi,
  // 官方相關（中英日）
  /\(?\s*Official\s*(Music\s*)?Video\s*\)?/gi,
  /\(?\s*Official\s*(Audio|Lyric|Visualizer)\s*Video?\s*\)?/gi,
  /\(?\s*官方(?:MV|音樂錄影帶|Music\s*Video)?\s*\)?/gi,
  /\(?\s*Official\s*\)?/gi,
  /\bMV\b/gi,
  // 'M/V'（含上傳者用來繞過 YouTube 檔名限制的 ⧸ ∕ ⁄，正規化後都是 '/'）。要在這裡吃掉，
  // 否則後面的 '/' 分隔規則會把 'Aimer - 花の唄 M/V' 切成歌手『…M』、歌名『V』。
  /\(?\s*M\s*[/.]\s*V\s*\)?/gi,
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
  // 音質/格式行銷字樣：轉貼/合輯頻道常見（例：「張宇 傘下 無損音樂FLAC 純享」），不屬於正式
  // 歌名，混進去會同時污染顯示的歌名跟歌詞搜尋 query（見 issue #9：歌詞比對成另一首歌）。
  /\(?\s*(?:無損|无损)(?:音樂|音乐|音質|音质)?\s*\)?/gi,
  /\bFLAC\b/gi,
  /\(?\s*(?:純享|纯享|精享|臻享)(?:版)?\s*\)?/gi,
  /\(?\s*(?:高音質|高音质|極致音質|极致音质|母帶|母带)\s*\)?/gi,
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
const NOISE_TAG_TEXT = /(?:^|\b)(?:mv|pv|official|lyrics?|audio|video|ktv|karaoke)(?:\b|$)|動態歌詞|动态歌词|歌回剪輯|歌回剪辑|歌雜剪輯|歌杂剪辑|伴奏|純音樂|纯音乐|女版|男版|完整版|官方版|原版|\bch\.?\s*[-–—]/i;
const PROMO_TAIL = /(?:全球網路大首播|全球网络大首播|網路大首播|网络大首播|首播|完整版|完整版本|官方版)+/gi;
const PUBLISHER_TAIL = /\s*[-–—]\s*(?:華納|华纳|索尼|Sony|滾石|滚石|相信音樂|相信音乐|環球|环球|ForwardMusic|avex)[^\n]*$/i;

// ─── 廠牌／搬運頻道 ───
// 2026-08-30 清庫的第 1 類指紋：唱片公司與搬運頻道被當成歌手寫進歌庫（`ForwardMusic 添翼`、
// `滾石唱片 ROCK RECORDS`）。它們不是原唱，寧可讓歌手留空、面板顯示「原唱待確認」，
// 也不要塞一個錯的名字進去——錯的名字還會污染歌詞搜尋的 query。
const LABEL_NAME = /(?:華納|华纳|索尼|Sony\s*Music|滾石|滚石|相信音樂|相信音乐|環球|环球|ForwardMusic|添翼|福茂|種子音樂|种子音乐|杰威爾|杰威尔|avex|EMI|BMG|VEVO|Universal\s*Music|Warner\s*Music|唱片(?:公司)?|Records\b|Recordings\b|Entertainment\s*(?:Group|Inc)?\b)/i;
// 標題開頭的「廠牌 - 」：`滾石唱片 ROCK RECORDS - 五月天 - 志明與春嬌` 這種三段式，
// 不先把廠牌那段剝掉，切割器就會把廠牌當歌手、把「五月天 - 志明與春嬌」整串當歌名。
const PUBLISHER_HEAD = /^\s*[^-–—|｜]{0,40}?(?:華納|华纳|索尼|Sony\s*Music|滾石|滚石|相信音樂|相信音乐|環球|环球|ForwardMusic|添翼|福茂|種子音樂|种子音乐|avex|VEVO|Universal\s*Music|Warner\s*Music|唱片|RECORDS\b)[^-–—]{0,40}?\s*[-–—]\s*/i;

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
  // 本地上傳的 MP3 常是從歌詞網站/盜版聚合站下載，檔案自帶的 ID3 標籤本身就可能把
  // 歌手/歌名寫反（來源端的錯，不是我們解析錯）。上傳路由直接信任 ID3，完全沒有
  // 交叉檢查；曝露這個方法讓呼叫端能比照 parseVideoTitle 內部同款的已知歌手校正。
  static isKnownArtistName(name) { return isKnownArtist(name); }
  static _runQueuedForTest(job, priority = 'batch', signal = null) { return runQueued(job, priority, signal); }
  static _metadataPrintTemplateForTest() { return YTDLP_METADATA_PRINT; }
  static _downloadStrategyPlanForTest() {
    return {
      primary: { ...YTDLP_PRIMARY_DOWNLOAD_STRATEGY },
      hls: YTDLP_HLS_DOWNLOAD_STRATEGIES.map((strategy) => ({ ...strategy })),
      clientFallbacks: YTDLP_CLIENT_FALLBACK_STRATEGIES.map((strategy) => ({ ...strategy })),
    };
  }
  static _normalizeYouTubeSearchQueryForTest(value) { return normalizeYouTubeSearchQuery(value); }
  static _sanitizeYouTubeSearchPayloadForTest(payload, limit) { return sanitizeYouTubeSearchPayload(payload, limit); }
  // 一般 ytsearch 的 yt-dlp 參數（metadata-only）。YT Music 偏好排序另走
  // _runYouTubeMusicSearchIds（music.youtube.com/search URL）。
  static _youtubeSearchArgs(normalizedQuery, normalizedLimit) {
    return [
      '--no-config', '--js-runtimes', 'node', '--flat-playlist', '--dump-single-json',
      '--skip-download', '--no-warnings', '--playlist-end', String(normalizedLimit),
      `ytsearch${normalizedLimit}:${normalizedQuery}`,
    ];
  }
  static _youtubeSearchArgsForTest(query, limit) {
    return this._youtubeSearchArgs(normalizeYouTubeSearchQuery(query), normalizeYouTubeSearchLimit(limit));
  }
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
  // 不再只在信心低時才查：影片夠長就一律查一次 Apple Music 官方目錄，拿官方時長當「事前」
  // 驗證基準（唱片公司頻道歌名抓得再準，影片本身還是可能剪進額外片段）。是否要拿查詢結果
  // 覆寫歌手/歌名，仍由呼叫端另外用信心分數把關，這裡只決定要不要發查詢。
  static shouldResolveAppleMetadata(info, identity, cover) {
    return !cover && Number(info?.duration) >= 60;
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
        downloadTask = {
          metadata: Promise.resolve(info),
          completed: downloadTask.completed,
          completeTempImport: downloadTask.completeTempImport,
        };
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
    // 官方時長：拿 Apple Music 目錄裡這首歌的官方時長，跟下載的影片時長比對，在搜歌詞之前
    // 就先抓出「影片可能剪了額外片段」的情況（唱片公司頻道歌名抓得再準也可能踩到）。
    // resolveAppleMusicMetadata 內部走斷路器，Apple 端被打爆時會自動跳過查詢直接回 null，
    // 不拋錯、不重試，確保匯入與歌詞照常完成。
    let officialDurationSec = null;
    if (this.shouldResolveAppleMetadata(info, identity, cover)) {
      try {
        const catalogResult = await LyricsEngine.resolveAppleMusicMetadata({
          artist: identity.artist,
          title: identity.title,
          rawTitle: info.title,
          duration: info.duration || 0,
        });
        if (catalogResult) {
          officialDurationSec = typeof catalogResult.durationSec === 'number' ? catalogResult.durationSec : null;
          // 只有原本信心不足時才拿目錄結果覆寫歌手/歌名，避免已經抓對的標題被目錄裡同名曲蓋掉。
          if (Number(identity.confidence) < 0.8) {
            const { durationSec, ...catalogIdentity } = catalogResult;
            identity = { ...identity, ...catalogIdentity, reason: 'apple-catalog' };
          }
        }
      } catch (e) {
        log.warn('Apple Music 官方時長查詢失敗，沿用本機解析: ' + e.message);
      }
    }
    const officialDurationVerified = officialDurationSec != null && info.duration
      ? Math.abs(officialDurationSec - info.duration) <= DURATION_TOLERANCE
      : null;
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
    // Once the file has a readable library filename it is no longer temporary.
    // Until then, a crash leaves a registry entry for the next startup to recover.
    downloadTask.completeTempImport?.();

    // 統一音量：量出整曲響度讓播放端拉齊到 -14 LUFS。失敗回 null（僅取消會拋出）。
    const loudnessLufs = await this.measureLoudnessQueued(path.join(downloaded.outputDir, filename), options.signal);
    throwIfCancelled(options.signal);

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
      // 優先採用 Apple Music 官方目錄時長比對（跟哪個歌詞來源命中無關，覆蓋率更完整）；
      // 查不到官方時長（斷路器暫停/歌曲不在目錄/API 失敗）才退回歌詞來源自己回報的比對結果。
      lyricsDurationVerified: typeof officialDurationVerified === 'boolean'
        ? officialDurationVerified
        : (typeof lyricsResult?.durationVerified === 'boolean' ? lyricsResult.durationVerified : null),
      album: info.album || '',
      duration: info.duration || 0,
      cover: info.thumbnail || null,
      lyrics: lyricsResult ? lyricsResult.lyrics : null,
      lyricsType: lyricsResult ? lyricsResult.type : null,
      // 關鍵：帶上「已解析(且會被非同步羅馬化就地填入 phonetic/xieyin)」的 parsedLyrics，
      // 否則顯示端只拿到原始歌詞字串、自己重解析→沒有拼音/諧音；逐字(KRC)尤其明顯。
      // play:track 也會用這份在播放當下補做羅馬化並廣播。
      parsedLyrics: lyricsResult ? (lyricsResult.parsedLyrics || null) : null,
      loudnessLufs,
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
  /**
   * yt-dlp 對合唱曲常常同時給 `artists: ['A','B']` 與 `artist: 'A, B'`（YouTube Music 來源
   * 尤其明顯）。舊版逐字串比對去重，兩者字面不同都被留下 → 面板顯示「A & B & A, B」。
   *
   * 這裡改成「拆成單一藝人名只為了判斷重複」：某個值拆出來的每個名字都已經出現過，
   * 整個值就是重複的、丟掉；否則整串原樣保留、不重排。刻意不把拆開後的名字重新
   * 組合輸出——名字裡本來就可能有逗號（Tyler, The Creator）或 &（Simon & Garfunkel），
   * 拆了再拼會把一個人拆成兩個。
   */
  static splitArtistNames(value) {
    return String(value || '')
      .split(/\s*(?:[,，、&＆/／×]|\b(?:feat|ft)\b\.?)\s*/i)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  static getMetadataArtist(info = {}) {
    const values = [];
    if (Array.isArray(info.artists)) values.push(...info.artists);
    if (info.artist) values.push(info.artist);
    if (info.albumArtist) values.push(info.albumArtist);
    const seen = new Set();
    const key = (text) => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const kept = [];
    for (const value of values) {
      const cleaned = this.cleanArtistName(value);
      if (!cleaned || seen.has(key(cleaned))) continue;
      const names = this.splitArtistNames(cleaned);
      // 拆出來的名字全都收過了 ⇒ 這個值只是同一組人的另一種寫法，不再重複列一次。
      if (names.length && names.every((name) => seen.has(key(name)))) continue;
      kept.push(cleaned);
      seen.add(key(cleaned));
      names.forEach((name) => seen.add(key(name)));
    }
    return kept.join(' & ');
  }

  static cleanTrackTitle(title) {
    if (!title || typeof title !== 'string') return '';
    let cleaned = stripNoiseBracketGroups(normalizeVideoText(title));
    for (const pattern of NOISE_PATTERNS) cleaned = cleaned.replace(pattern, '');
    return cleanIdentityPart(repairBrackets(cleaned).replace(/\s+/g, ' ').trim(), 'title');
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
    let title = metadataTitle || parsed.title || this.cleanTrackTitle(info.title) || info.title || '';

    if (!artist) {
      const channel = this.cleanArtistName(info.channel || info.uploader || '');
      const normalizedRaw = normalizeVideoText(info.title).toLowerCase().replace(/\s+/g, '');
      const normalizedChannel = normalizeVideoText(channel).toLowerCase().replace(/\s+/g, '');
      // 頻道名出現在標題裡也不代表它是原唱——搬運／廠牌頻道本來就會把自己的名字寫進標題。
      if (normalizedChannel.length >= 2 && normalizedRaw.includes(normalizedChannel) && !isLabelArtist(channel)) artist = channel;
    }

    // yt-dlp 的 track/artist 結構化欄位一樣是別人（唱片公司/上傳者）填的中繼資料，一樣可能填反
    // （例如樂團名「珂拉琪 Collage」被填進 track，歌名被填進 artist）。parseVideoTitle 的規則
    // 路徑已有這個兜底，這裡把它也套用到結構化欄位路徑，兩邊命中已知歌手清單時都會調正方向。
    // 廠牌／搬運頻道則是相反：它不是原唱，寧可留空讓面板顯示「原唱待確認」，也不要塞一個
    // 錯的名字——錯的歌手名會一路污染歌詞搜尋的 query。
    if (isLabelArtist(artist)) artist = '';
    if (artist && title && isKnownArtist(title) && !isKnownArtist(artist)) {
      const swap = artist; artist = title; title = swap;
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

  // ─── YouTube 搜尋（只讀 metadata，不下載）───
  // 優先 YouTube Music 來源：yt-dlp 沒有 ytmsearch: 前綴，改用 music.youtube.com/search
  // URL（youtube:music:search_url extractor）取「歌曲」區塊——那是官方音檔（多為
  // 「- Topic」自動頻道），少 Shorts／MV／翻唱／KTV／歌詞影片轉載。flat 的 YT Music
  // 結果只有 id/title，所以再用一次 batched `--dump-json` 補齊卡片要的 channel／
  // duration／縮圖／觀看數。最後接上一般 ytsearch 結果填滿剩餘名額並當總退路。
  // 回傳 { results, hasMore }。offset > 0＝使用者按「找更多」往下翻，只深挖一般
  // ytsearch（YT Music 歌曲區塊本來就短），不再打 YT Music／enrich。
  static async searchYouTube(query, options = {}) {
    const normalizedQuery = normalizeYouTubeSearchQuery(query);
    const pageSize = normalizeYouTubeSearchLimit(options.limit);
    const offset = Math.max(0, Math.min(YOUTUBE_SEARCH_FETCH_MAX - 1, Number.parseInt(options.offset, 10) || 0));
    const fetchCount = Math.min(YOUTUBE_SEARCH_FETCH_MAX, offset + pageSize);
    const requestId = options.requestId ? String(options.requestId) : '';
    const controller = registerRequestController(requestId);
    const signal = controller?.signal || options.signal;
    try {
      return await runQueued(async () => {
        if (offset > 0) {
          let generalEntries = [];
          try {
            generalEntries = await this._runYoutubeSearch(normalizedQuery, fetchCount, signal);
          } catch (error) {
            if (signal?.aborted) throw new ImportCancelledError();
            throw error;
          }
          const page = sanitizeYouTubeSearchPayload({ entries: generalEntries }, fetchCount)
            .slice(offset, offset + pageSize);
          return {
            results: page,
            hasMore: generalEntries.length >= fetchCount && fetchCount < YOUTUBE_SEARCH_FETCH_MAX,
          };
        }
        // 第一頁：YT Music 偏好排序（取 id → 補 metadata）與一般 ytsearch 退路是各自獨立
        // 的 yt-dlp 呼叫，並行跑——兩者都是 --skip-download 的 metadata-only 輕量呼叫，
        // 併發兩支不踩鐵則 12（那是講會動媒體的下載工作）。感知時間從「三支相加」降到
        // 「max(music+enrich, ytsearch)」。enrich 只補前 4 筆（卡片首屏就這麼多），
        // --dump-json 逐筆做完整抽取是最慢的一段，少幾筆差很多。
        const [musicEntries, generalOutcome] = await Promise.all([
          (async () => {
            try {
              const musicIds = await this._runYouTubeMusicSearchIds(normalizedQuery, pageSize, signal);
              if (!musicIds.length) return [];
              return await this._enrichYouTubeIds(musicIds.slice(0, Math.min(pageSize, 4)), signal);
            } catch (error) {
              if (signal?.aborted) throw new ImportCancelledError();
              return []; // YT Music 這條失敗不擋主流程，退回純 ytsearch。
            }
          })(),
          (async () => {
            try {
              return { entries: await this._runYoutubeSearch(normalizedQuery, pageSize, signal) };
            } catch (error) {
              if (signal?.aborted) throw new ImportCancelledError();
              return { error };
            }
          })(),
        ]);
        if (generalOutcome.error && !musicEntries.length) throw generalOutcome.error; // 兩條都拿不到才報錯
        const generalEntries = generalOutcome.entries || [];
        // YT Music 官方音檔在前；sanitize 會依 videoId 去重、把合輯沉底、截到 pageSize。
        return {
          results: sanitizeYouTubeSearchPayload({ entries: musicEntries.concat(generalEntries) }, pageSize),
          hasMore: generalEntries.length >= pageSize,
        };
      }, 'batch', signal);
    } finally {
      clearRequestController(requestId, controller);
    }
  }

  // music.youtube.com/search 的「歌曲」區塊 → 依序的 videoId 陣列（只留真的單曲，且
  // 標題要對得上查詢——YT Music 對「歌手＋歌名」常回整個歌手熱門清單，不加濾會把
  // 「青花瓷／晴天」塞進「周杰倫 稻香」的前排）。
  static async _runYouTubeMusicSearchIds(normalizedQuery, limit, signal) {
    throwIfCancelled(signal);
    const url = `https://music.youtube.com/search?q=${encodeURIComponent(normalizedQuery)}#songs`;
    const args = [
      '--no-config', '--js-runtimes', 'node', '--flat-playlist', '--dump-single-json',
      '--skip-download', '--no-warnings', '--playlist-end', String(limit), url,
    ];
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('yt-dlp', args, {
        ...YTDLP_BASE_OPTS, timeout: YTDLP_SEARCH_TIMEOUT, maxBuffer: YTDLP_MAX_BUFFER, signal,
      }));
    } catch (error) {
      if (signal?.aborted) throw new ImportCancelledError();
      stdout = typeof error?.stdout === 'string' ? error.stdout : '';
      if (!stdout) return [];
    }
    let payload;
    try { payload = JSON.parse(String(stdout).trim()); } catch (_) { return []; }
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    // 查詢 token：長度 >= 2 的片段（涵蓋中日單詞與英文），比對時忽略大小寫。
    const queryTokens = normalizedQuery.toLowerCase().split(/\s+/).filter((tok) => tok.length >= 2);
    const matched = [];
    const unmatched = [];
    for (const entry of entries) {
      if (entry?.ie_key && entry.ie_key !== 'Youtube') continue; // 略過 artist/browse 之類
      const videoId = String(entry?.id || '').trim();
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
      if (matched.includes(videoId) || unmatched.includes(videoId)) continue;
      const title = String(entry?.title || '').toLowerCase();
      if (!queryTokens.length || queryTokens.some((tok) => title.includes(tok))) matched.push(videoId);
      else unmatched.push(videoId);
    }
    // 有對上的就只用對上的；一個都沒對上（例如查詢用了別名）才退回全部，交給後面 ytsearch 兜底。
    return matched.length ? matched : unmatched;
  }

  // 一次 yt-dlp 呼叫補齊多個已知 videoId 的卡片 metadata（--dump-json，逐行 JSON）。
  static async _enrichYouTubeIds(videoIds, signal) {
    throwIfCancelled(signal);
    if (!videoIds.length) return [];
    const urls = videoIds.map((id) => `https://www.youtube.com/watch?v=${id}`);
    const args = ['--no-config', '--js-runtimes', 'node', '--dump-json', '--skip-download', '--no-warnings', ...urls];
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('yt-dlp', args, {
        ...YTDLP_BASE_OPTS, timeout: 9000, maxBuffer: YTDLP_MAX_BUFFER, signal,
      }));
    } catch (error) {
      if (signal?.aborted) throw new ImportCancelledError();
      stdout = typeof error?.stdout === 'string' ? error.stdout : ''; // 逾時仍可能吐出前幾筆
    }
    const byId = new Map();
    for (const line of String(stdout).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        if (entry && entry.id) byId.set(String(entry.id), entry);
      } catch (_) { /* 跳過非 JSON 行 */ }
    }
    // 保留 YT Music 的原始順序
    return videoIds.map((id) => byId.get(String(id))).filter(Boolean);
  }

  // 單次一般 ytsearch：只回原始 entries 陣列（含卡片需要的 metadata）。
  static async _runYoutubeSearch(normalizedQuery, limit, signal) {
    throwIfCancelled(signal);
    const args = this._youtubeSearchArgs(normalizedQuery, limit);
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('yt-dlp', args, {
        ...YTDLP_BASE_OPTS,
        timeout: YTDLP_SEARCH_TIMEOUT,
        maxBuffer: YTDLP_MAX_BUFFER,
        signal,
      }));
    } catch (error) {
      if (signal?.aborted) throw new ImportCancelledError();
      stdout = typeof error?.stdout === 'string' ? error.stdout : '';
      if (!stdout) {
        const isTimeout = error?.killed || error?.code === 'ETIMEDOUT';
        const isMissingRuntime = error?.code === 'ENOENT';
        const wrapped = new Error(isTimeout
          ? 'YouTube 搜尋逾時'
          : isMissingRuntime
            ? '找不到 YouTube 搜尋元件'
            : 'YouTube 搜尋服務暫時無法使用');
        wrapped.code = isTimeout
          ? 'YOUTUBE_SEARCH_TIMEOUT'
          : isMissingRuntime
            ? 'YOUTUBE_SEARCH_RUNTIME_MISSING'
            : 'YOUTUBE_SEARCH_FAILED';
        throw wrapped;
      }
    }
    let payload;
    try {
      payload = JSON.parse(String(stdout).trim());
    } catch (_) {
      const error = new Error('YouTube 搜尋回傳格式無法解析');
      error.code = 'YOUTUBE_SEARCH_INVALID_RESPONSE';
      throw error;
    }
    return Array.isArray(payload?.entries) ? payload.entries : [];
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
          channelId: data.channel_id || data.uploader_id || '',
          uploader: data.uploader || '',
          description: data.description || '',
          categories: Array.isArray(data.categories) ? data.categories : [],
        };
      } catch (err) {
        if (signal?.aborted) throw new ImportCancelledError();
        if (isYouTubeMusicPremiumError(err)) throw createYouTubeMusicPremiumError();
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
        channelId: '',
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
      const signal = controller?.signal || options.signal;
      // 必須與 processYouTube 共用 runQueued：Twitch 點歌不經過瀏覽器的
      // queueYouTubeImport()，若直接查 metadata 便會繞過全域 yt-dlp 併發上限。
      // runQueued 也會在尚未開始時正確移除已取消的 /youtube/inspect 工作。
      const info = await runQueued(() => this.getVideoInfo(url, signal), options.priority, signal);
      if (!info) throw new Error('無法取得影片資訊');
      rememberPrefetchedInfo(url, info);
      const assessment = assessYouTubeImport(info);
      const outputDir = downloadsDir;
      return appendDiskSpaceWarning(assessment, inspectDiskSpace(outputDir));
    } finally {
      clearRequestController(requestId, controller);
    }
  }

  static downloadWithMetadata(url, onProgress, fallbackInfo = null, signal = null) {
    throwIfCancelled(signal);
    const outputDir = downloadsDir;
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const tempImport = importTempRegistry.begin(extractVideoId(url));
    const cleanupTempImport = () => {
      cleanupOwnedTemporaryDownload(tempImport?.videoId, outputDir);
      importTempRegistry.finish(tempImport);
    };
    const outputTemplate = path.join(outputDir, '%(id)s.%(ext)s');
    let resolveMeta, rejectMeta;
    const metadata = new Promise((resolve, reject) => { resolveMeta = resolve; rejectMeta = reject; });
    let metaDone = !!fallbackInfo;
    if (fallbackInfo) resolveMeta(fallbackInfo);
    const rejectMetadata = (message) => {
      if (metaDone) return;
      metaDone = true;
      const err = new Error(message);
      err.code = 'YTDLP_METADATA';
      rejectMeta(err);
    };

    // 單次 yt-dlp 下載嘗試；策略決定格式與 client。metadata 是跨嘗試共用狀態
    // （resolveMeta/rejectMeta/metaDone 皆在外層閉包），只要任一次嘗試印出 __ES_META__
    // 就會定案，之後的嘗試不會再改動它。
    const runAttempt = (strategy) => new Promise((resolve, reject) => {
      const args = ['--js-runtimes', 'node', ...strategy.extractorArgs, '-f', strategy.format,
        '--concurrent-fragments', String(strategy.concurrentFragments), '--no-playlist',
        '-o', outputTemplate, '--print', YTDLP_METADATA_PRINT, '--print', 'after_move:__ES_FILE__%(filepath)s',
        '--print', YTDLP_SOURCE_FORMAT_PRINT,
        '--progress', '--newline', '--progress-template', 'download:__ES_PROGRESS__%(progress._percent_str)s', url];
      const started = Date.now();
      const child = spawn('yt-dlp', args, { env: YTDLP_ENV, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '', rawPath = '', sourceFormat = '', timedOut = false;
      const onAbort = () => child.kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      const metadataTimer = metaDone ? null : setTimeout(() => rejectMetadata('yt-dlp 未在 15 秒內提供影片 metadata'), 15000);
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
          else if (line.startsWith('__ES_FORMAT__')) sourceFormat = line.slice(13).trim();
          else if (line.startsWith('__ES_PROGRESS__')) {
            const percent = Number.parseFloat(line.slice(15)); onProgress('正在下載', Number.isFinite(percent) ? percent : undefined);
          }
        }
      };
      child.stdout.on('data', c => consume(c, false)); child.stderr.on('data', c => consume(c, true));
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, YTDLP_DOWNLOAD_TIMEOUT);
      child.on('error', err => {
        clearTimeout(timer); if (metadataTimer) clearTimeout(metadataTimer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.aborted ? new ImportCancelledError() : err);
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (metadataTimer) clearTimeout(metadataTimer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new ImportCancelledError());
        if (code !== 0 || !rawPath) {
          return reject(new Error(timedOut ? 'yt-dlp 下載逾時' : (stderr.trim().split('\n').pop() || `yt-dlp exit ${code}`)));
        }
        const downloadMs = Date.now() - started;
        // yt-dlp 在 Windows 印出的 filepath 目錄段（含中文的專案路徑）是經 mbcs/surrogateescape
        // 產生的非法 UTF-8，任何解碼都還原不了（PYTHONUTF8 也無效）；直接拿去餵 ffmpeg -i 會找不到
        // 檔案而卡住。但輸出模板是 %(id)s.%(ext)s，basename 永遠是 ASCII video id，於是用我們自己
        // 掌握、完全正確的 outputDir 重組路徑，徹底繞開 yt-dlp 的壞路徑。
        const cleanPath = path.join(outputDir, path.basename(rawPath));
        log.info(`yt-dlp 下載成功 (${strategy.id}): ${sourceFormat || '未取得來源格式'}`);
        log.perf('youtube-download', downloadMs, { path: cleanPath, strategy: strategy.id, sourceFormat });
        resolve({ cleanPath, downloadMs, strategy: strategy.id, sourceFormat });
      });
    });

    const completed = (async () => {
      let lastError;
      let downloaded = null;
      const tryStrategy = async (strategy, message) => {
        throwIfCancelled(signal);
        try {
          downloaded = await runAttempt(strategy);
          return true;
        } catch (err) {
          if (signal?.aborted || err instanceof ImportCancelledError) { cleanupTempImport(); rejectMetadata('匯入已取消'); throw new ImportCancelledError(); }
          lastError = err;
          if (isYouTubeMusicPremiumError(err)) return false;
          log.warn(`yt-dlp ${strategy.id} 失敗，${message}: ${err.message}`);
          // 每次重試前清掉留下的半套檔案（.part/.webm…），避免和下一策略混淆。
          cleanupOwnedTemporaryDownload(tempImport?.videoId, outputDir);
          return false;
        }
      };

      const primarySucceeded = await tryStrategy(YTDLP_PRIMARY_DOWNLOAD_STRATEGY, '保留高品質格式結束此次匯入');
      if (!primarySucceeded && isYouTubeHttp403Error(lastError)) {
        // HTTP 403 才改走 HLS。格式 selector 的 / 只會處理「格式不存在」，不會在實際下載取得 403 後自動重選，因此必須是獨立嘗試。
        for (const strategy of YTDLP_HLS_DOWNLOAD_STRATEGIES) {
          if (await tryStrategy(strategy, '改用下一個 HLS 退路')) break;
        }
      }

      // 只有原本高品質路徑與 HLS 退路都沒成功，才改用其他 player client。
      if (!downloaded && !isYouTubeMusicPremiumError(lastError)) {
        for (const strategy of YTDLP_CLIENT_FALLBACK_STRATEGIES) {
          if (await tryStrategy(strategy, '改用下一個 player client 重試')) break;
        }
      }
      if (!downloaded) {
        cleanupTempImport();
        rejectMetadata('yt-dlp 下載失敗且未提供影片 metadata');
        throw lastError;
      }
      rejectMetadata('yt-dlp 下載完成但未提供影片 metadata');
      try {
        onProgress('正在轉換音訊');
        const filePath = await withFfmpegLock(() => this.convertToMp3(downloaded.cleanPath, signal));
        return { filePath, outputDir, downloadMs: downloaded.downloadMs };
      } catch (err) {
        // 取消發生在轉碼中：yt-dlp 已正常結束（上面的 aborted 分支沒走到），
        // 這裡才是唯一能清掉 videoId.webm 原檔＋寫到一半 videoId.mp3 的地方。
        cleanupTempImport();
        throw err;
      }
    })();
    return { metadata, completed, completeTempImport: () => importTempRegistry.finish(tempImport) };
  }

  static normalizeInfo(data = {}) {
    return { id: data.id, title: data.title || '', duration: data.duration || 0, thumbnail: data.thumbnail || null,
      album: data.album || '', track: data.track || '', artist: data.artist || '', artists: Array.isArray(data.artists) ? data.artists : [],
      albumArtist: data.album_artist || '', channel: data.channel || '', uploader: data.uploader || '', description: data.description || '',
      categories: Array.isArray(data.categories) ? data.categories : [] };
  }

  /**
   * 從 ffmpeg ebur128 的 stderr 摘要取出 integrated loudness（LUFS）。
   * Summary 區塊在輸出最後，取「最後一個」I: 值即為整曲結果；範圍外視為量測異常回 null。
   */
  static parseEbur128Loudness(stderrText) {
    const matches = String(stderrText || '').match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
    if (!matches || !matches.length) return null;
    const last = matches[matches.length - 1].match(/(-?\d+(?:\.\d+)?)/);
    const lufs = last ? Number.parseFloat(last[1]) : NaN;
    return (Number.isFinite(lufs) && lufs >= -70 && lufs < 0) ? lufs : null;
  }

  /**
   * 量測整曲響度（EBU R128 integrated LUFS）。純分析、不改動音檔。
   * 量測是「統一音量」的加值功能：除了取消之外任何失敗都回 null，絕不讓匯入因此中斷。
   */
  static measureLoudness(filePath, signal = null) {
    throwIfCancelled(signal);
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegProvider.getFfmpegPath(), ['-hide_banner', '-nostats', '-i', filePath, '-vn', '-af', 'ebur128', '-f', 'null', '-'],
        { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const onAbort = () => child.kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      let stderr = ''; const timer = setTimeout(() => child.kill(), YTDLP_DOWNLOAD_TIMEOUT);
      child.stderr.on('data', c => { stderr = (stderr + c.toString()).slice(-YTDLP_MAX_BUFFER); });
      child.on('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); signal?.aborted ? reject(new ImportCancelledError()) : resolve(null); });
      child.on('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new ImportCancelledError());
        const lufs = code === 0 ? this.parseEbur128Loudness(stderr) : null;
        if (lufs === null) log.warn(`響度量測失敗（不影響匯入）: ${path.basename(filePath)}`);
        else log.perf('loudness-measure', Date.now() - started, { lufs });
        resolve(lufs);
      });
    });
  }

  /** 排進共用 ffmpeg 佇列的響度量測（鐵則 12：絕不與轉碼併發跑 ffmpeg）。 */
  static measureLoudnessQueued(filePath, signal = null) {
    return withFfmpegLock(() => this.measureLoudness(filePath, signal));
  }

  static convertToMp3(inputPath, signal = null) {
    throwIfCancelled(signal);
    const started = Date.now();
    const outputPath = path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}.mp3`);
    if (path.resolve(inputPath) === path.resolve(outputPath)) return Promise.resolve(outputPath);
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegProvider.getFfmpegPath(), ['-y', '-i', inputPath, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', outputPath],
        { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const onAbort = () => child.kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      let stderr = ''; const timer = setTimeout(() => child.kill(), YTDLP_DOWNLOAD_TIMEOUT);
      child.stderr.on('data', c => { stderr = (stderr + c.toString()).slice(-YTDLP_MAX_BUFFER); });
      child.on('error', (error) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new ImportCancelledError());
        if (error.code === 'ENOENT') {
          return reject(new Error('找不到 FFmpeg，YouTube 轉 MP3 需要它。請到控制面板的系統檢查點「下載 FFmpeg」，或在 config.js 指定 ffmpegPath。'));
        }
        reject(error);
      });
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
    let cleaned = stripNoiseBracketGroups(stripLeadingNoiseTags(normalizeVideoText(rawTitle)));
    for (const pattern of NOISE_PATTERNS) cleaned = cleaned.replace(pattern, '');
    cleaned = compactSpaces(repairBrackets(cleaned).replace(PUBLISHER_TAIL, '').replace(PROMO_TAIL, ''));
    // 廠牌那段剝掉之後如果什麼都不剩，代表整串就是廠牌名，那就別剝——寧可讓後面的規則
    // 照常處理，也不要把標題清成空字串。
    const withoutPublisherHead = compactSpaces(cleaned.replace(PUBLISHER_HEAD, ''));
    if (withoutPublisherHead) cleaned = withoutPublisherHead;
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

    // Title by Artist——但英文歌名本身常常就含有介系詞 by（例如「Troubled By The Moon」），
    // 這時「by」右邊接的是歌名的一部分而不是真正的歌手，必須先確認右邊看起來像歌手名
    // （已知歌手 / feat. 等）才採信，否則整個「歌手 - 歌名 By XXX」都會被這條規則吃掉、
    // 蓋掉後面本來能靠連字號正確辨識的 dashMatch。
    if (!title) {
      const byMatch = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
      if (byMatch && looksLikeArtist(byMatch[2].trim())) {
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

    // 三段以上的連字號（'如願 - 楊丞琳 - 而我將 愛你所愛的人間'）：上面的規則只切第一個
    // 連字號，等於在猜第一段是歌手還是歌名，猜錯就把「歌手 - 附註」整串當成歌名。
    // 這裡改用唯一的高信度訊號：剛好只有一段整段就是已知歌手，那一段才是歌手，
    // 剩下的第一段是歌名，其餘（宣傳詞、歌詞引言、劇名）丟掉。
    // 刻意用「完全相等」而不是 isKnownArtist() 的寬鬆子字串比對——寬鬆比對會讓好幾段
    // 同時命中，就沒有「唯一」可言了。
    if (!title) {
      const segments = cleaned.split(/\s*-\s+/).map((part) => part.trim()).filter(Boolean);
      if (segments.length >= 3) {
        const hits = segments.filter((part) => KNOWN_ARTISTS.has(artistKey(part)));
        if (hits.length === 1) {
          const index = segments.indexOf(hits[0]);
          artist = hits[0];
          title = index === 0 ? segments[1] : segments[0];
          confidence = 0.86;
          reason = 'multi-dash-known-artist';
        }
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
      // 名字後面必須接空白才算邊界完整（避免「周杰倫」誤吃到「周杰倫粉絲團」）。
      const matchBoundaryPrefix = (text) => {
        const m = matchLeadingKnownArtist(text);
        return m && /^\s/.test(text.slice(m.length)) ? m : null;
      };
      const knownPrefix = matchBoundaryPrefix(cleaned);
      if (knownPrefix) {
        const artists = [cleaned.slice(0, knownPrefix.length).trim()];
        let remainder = cleaned.slice(knownPrefix.length).trim();
        // 無分隔符的多人伴奏：「周杰倫 張惠妹 不該」。連續剝離已知歌手，最後才是歌名。
        while (remainder) {
          const next = matchBoundaryPrefix(remainder);
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
