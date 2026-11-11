/**
 * API 路由 v3 (Phase 5)
 * 負責歌詞搜尋、音訊處理、YouTube 下載、播放清單匯出匯入等 HTTP 端點
 * 
 * Phase 5 增強：
 * - 歌詞檔案上傳（.lrc / .srt）
 * - 歌詞貼上解析
 * - 播放清單 JSON 匯出匯入
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const { sanitizeTrack } = require('../utils/track-schema');
const { mapConcurrent } = require('../utils/map-concurrent');
const path = require('path');
const { dataDir, downloadsDir } = require('../utils/app-paths');
const fs = require('fs');
let musicMetadataPromise = null;
function parseMusicFile(filePath) {
  if (!musicMetadataPromise) musicMetadataPromise = import('music-metadata');
  return musicMetadataPromise.then((mod) => mod.parseFile(filePath));
}

const { createLogger } = require('../utils/logger');
const log = createLogger('API');

const { LyricsEngine } = require('../services/lyrics-engine');
const AudioProcessor = require('../services/audio-processor');
const { autoParseLyrics, parseOffset } = require('../services/lrc-parser');
// PIN 存取控制（選用）：只套在會觸發下載/處理的路由，唯讀端點（cover/fonts/health）不套，
// 見 server/middleware/require-pin.js 開頭說明。
const requirePin = require('../middleware/require-pin');
const { isYouTubeUrl } = require('../utils/youtube-url');
const { getClientAddress, isLoopbackAddress } = require('../utils/pin-setup-policy');
const { classifyImportError, toImportTelemetryCode } = require('../utils/import-error');
const { decodeUploadedText } = require('../utils/decode-text');
const libraryStore = require('../services/library-store');
const usageTelemetry = require('../services/usage-telemetry');

// ─── Multer 設定（本地檔案上傳）───
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = downloadsDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // path.basename 防止 originalname 帶路徑穿越（如 "../../evil.mp3"）逃出 downloads 目錄
    const safeName = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.wma'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      const err = new Error(`不支援的音訊格式: ${ext}，僅支援 ${allowed.join(', ')}`);
      err.status = 400;
      cb(err);
    }
  },
  limits: { fileSize: 200 * 1024 * 1024, files: 20 }, // 單檔 200MB、單次最多 20 檔
});

// ─── Multer 設定（歌詞檔案上傳）───
const lyricsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(downloadsDir, 'lyrics');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // path.basename 防止 originalname 帶路徑穿越（如 "../../evil.lrc"）逃出 downloads/lyrics 目錄
    const safeName = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const lyricsUpload = multer({
  storage: lyricsStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.lrc', '.srt', '.vtt', '.txt'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      const err = new Error(`不支援的歌詞格式: ${ext}，僅支援 .lrc / .srt / .vtt / .txt`);
      err.status = 400;
      cb(err);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB 上限
});

// ─── 依功能分檔的子路由（server/routes/api/）───
router.use(require('./api/system'));
router.use(require('./api/display-assets'));
router.use(require('./api/fonts'));
router.use(require('./api/separation'));

// ─── 本地檔案上傳 ───
router.post('/upload', requirePin, upload.array('files', 50), async (req, res) => {
  const start = Date.now();
  try {
    if (!req.files || req.files.length === 0) {
      log.warn('上傳請求未包含任何檔案');
      return res.status(400).json({ error: '請上傳至少一個音訊檔案' });
    }

    log.info(`開始處理 ${req.files.length} 個上傳檔案`);
    // At most two tracks hold metadata/cover buffers and search providers at once.
    // FFmpeg retains its existing global single-job lock.
    const processed = await mapConcurrent(req.files, 2, async file => {
      const warnings = [];
      const filePath = file.path;
      const metadata = await parseMusicFile(filePath);

      // file.originalname 由 busboy 以 latin1 解碼（把 UTF-8 位元組逐一當字元），中日文檔名會亂碼；
      // 落盤檔名（multer storage）已各自還原，這裡同樣先還原成 UTF-8 再用於歌名/歌手。
      const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const nameWithoutExt = path.basename(decodedName, path.extname(decodedName));
      // 沒有內嵌 ID3 標籤時，比照 YouTube 匯入從檔名自動拆歌手/歌名（如「周杰倫 - 稻香」）。
      const parsedName = AudioProcessor.parseVideoTitle(nameWithoutExt);

      const track = {
        id: path.basename(filePath, path.extname(filePath)),
        filename: path.basename(filePath),
        originalName: decodedName,
        title: metadata.common.title || parsedName.title || nameWithoutExt,
        artist: metadata.common.artist || parsedName.artist || '',
        album: metadata.common.album || '',
        duration: metadata.format.duration || 0,
        cover: null,
        lyrics: null,
        lyricsType: null,
        loudnessLufs: null,
      };

      // 檔案內嵌 ID3 標籤本身可能把歌手/歌名寫反（常見於歌詞網站下載的盜版聚合檔，
      // ID3 是來源端寫錯，不是我們解析錯）。跟 YouTube 匯入一樣，用已知歌手名單做
      // 一次校正：歌名欄位命中已知歌手、歌手欄位卻沒命中，代表兩欄位互換了。
      if (track.title && track.artist &&
          AudioProcessor.isKnownArtistName(track.title) && !AudioProcessor.isKnownArtistName(track.artist)) {
        const swapped = track.artist; track.artist = track.title; track.title = swapped;
      }

      // 提取封面
      if (metadata.common.picture && metadata.common.picture.length > 0) {
        const pic = metadata.common.picture[0];
        const coverExtByMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
        const coverExt = coverExtByMime[String(pic.format || '').toLowerCase()] || 'jpg';
        const coverFilename = `${track.id}-cover.${coverExt}`;
        const coverPath = path.join(downloadsDir, coverFilename);
        fs.writeFileSync(coverPath, pic.data);
        track.cover = `/api/cover/${coverFilename}`;
      }

      // 本地上傳同樣量整曲響度（失敗回 null），與網路歌詞搜尋重疊等待時間。
      const loudness = AudioProcessor.measureLoudnessQueued(filePath).catch(() => null);
      // 背景搜尋歌詞
      try {
        const lyricsResult = await LyricsEngine.search(track.artist, track.title, track.duration);
        if (lyricsResult) {
          track.lyrics = lyricsResult.lyrics;
          track.lyricsType = lyricsResult.type;

          // Phase 5: 解析 LRC offset 標籤
          if (lyricsResult.type === 'lrc' && lyricsResult.lyrics) {
            const lrcOffset = parseOffset(lyricsResult.lyrics);
            if (lrcOffset !== 0) {
              track.lrcOffset = lrcOffset;
            }
          }

          if (lyricsResult.parsedLyrics) {
            track.parsedLyrics = lyricsResult.parsedLyrics;
          }
          if (lyricsResult.source) track.lyricsSource = lyricsResult.source;
        }
      } catch (e) {
        log.warn(`歌詞搜尋失敗 (${track.artist} - ${track.title}): ${e.message}`);
        warnings.push(`${track.title}：音訊已匯入，但自動歌詞搜尋失敗`);
      }

      track.loudnessLufs = await loudness;
      return { track: sanitizeTrack(track), warnings };
    });
    const results = processed.map(result => result.track).filter(Boolean);
    const warnings = processed.flatMap(result => result.warnings);

    // Library-only and BGM uploads never enter the main playlist or playback.
    // Remember completed imports here so every upload entry point can use them.
    results.forEach(track => libraryStore.rememberImport(track));

    const duration = Date.now() - start;
    log.info(`上傳處理完成: ${results.length} 首歌曲 (${duration}ms)`);
    log.perf('upload', duration, { trackCount: results.length });
    res.json({ success: true, tracks: results, warnings });
  } catch (err) {
    const duration = Date.now() - start;
    log.error(`上傳處理失敗 (${duration}ms)`, err);
    res.status(500).json({ error: '檔案處理失敗', details: err.message });
  }
});

// ─── YouTube 連結處理 ───
router.post('/youtube', requirePin, async (req, res) => {
  const start = Date.now();
  try {
    const { url } = req.body;
    const requestedCookieBrowser = String(req.body?.cookieBrowser || '').trim();
    const cookieBrowser = AudioProcessor.normalizeCookieBrowser(requestedCookieBrowser);
    if (requestedCookieBrowser && !cookieBrowser) {
      return res.status(400).json({ error: '不支援的瀏覽器 Cookie 來源', code: 'INVALID_COOKIE_BROWSER' });
    }
    if (cookieBrowser && !isLoopbackAddress(getClientAddress(req))) {
      return res.status(403).json({
        error: '瀏覽器登入狀態只能由這台電腦上的 Elitesand Pro 面板使用。',
        code: 'COOKIE_BROWSER_LOCAL_ONLY',
      });
    }
    if (!url) {
      log.warn('YouTube 請求缺少 URL');
      return res.status(400).json({ error: '請提供 YouTube 連結' });
    }

    // 驗證 YouTube URL 格式
    if (!isYouTubeUrl(url)) {
      log.warn(`無效的 YouTube URL 格式: ${url.substring(0, 100)}`);
      return res.status(400).json({ error: '請提供有效的 YouTube 連結（支援 youtube.com/watch?v=, youtu.be/, youtube.com/shorts/ 等格式）' });
    }

    log.info(`處理 YouTube 連結: ${url}`);
    const result = await AudioProcessor.processYouTube(url, {
      priority: 'interactive',
      requestId: req.body.requestId,
      isBatch: req.body.isBatch === true,
      forceReplace: req.body.forceReplace === true,
      cookieBrowser,
    });
    // 落地前去重：伺服器發現這是「歌手+歌名」已存在的另一個 YouTube 上傳，交回客戶端問
    // 使用者要取代還是略過（批次匯入不會走到這裡，見 audio-processor.js 的 findByIdentity）。
    // 這不是失敗，用 200 回，不要走 classifyImportError 那條錯誤分類與遙測路徑。
    if (result && result.duplicate) {
      return res.json({ success: false, code: 'DUPLICATE_SONG', existing: result.existing });
    }
    const duration = Date.now() - start;
    log.info(`YouTube 處理完成: ${result.title || result.id} (${duration}ms)`);
    log.perf('youtube', duration, { title: result.title });
    const safeTrack = sanitizeTrack(result);
    if (!safeTrack) {
      // 下載本身成功但輸出格式不合預期——仍是一次匯入失敗，只是不在
      // classifyImportError 的分類範圍內，歸給 usage-telemetry 的 'other' 兜底碼。
      usageTelemetry.recordOutcome('import', false, 'other');
      return res.status(422).json({ error: '音訊處理結果格式無效' });
    }
    usageTelemetry.recordOutcome('import', true);
    res.json({ success: true, track: safeTrack });
  } catch (err) {
    const duration = Date.now() - start;
    log.error(`YouTube 處理失敗 (${duration}ms)`, err);
    const classified = classifyImportError(err);
    // 使用者主動取消不是管線失敗，toImportTelemetryCode() 回傳 null 時完全不記錄
    // ——連 attempt 都不計，避免取消把「匯入到底穩不穩」的分母灌水。
    const telemetryCode = toImportTelemetryCode(classified.code);
    if (telemetryCode !== null) usageTelemetry.recordOutcome('import', false, telemetryCode);
    res.status(classified.status).json({
      error: classified.message,
      code: classified.code,
      recovery: classified.recovery,
      retryable: classified.retryable,
      browserCookieFallback: classified.browserCookieFallback === true && isLoopbackAddress(getClientAddress(req)),
      details: classified.technical,
    });
  }
});

router.post('/youtube/cancel', requirePin, (req, res) => {
  const result = AudioProcessor.cancelImport(req.body?.requestId);
  res.status(result.ok ? 202 : 404).json(result);
});

// ─── YouTube 關鍵字搜尋：只讀扁平 metadata，不下載音訊 ───
router.post('/youtube/search', requirePin, async (req, res) => {
  const streaming = req.body?.stream === true;
  const requestId = typeof req.body?.requestId === 'string' && req.body.requestId.length > 0 && req.body.requestId.length <= 64
    ? req.body.requestId : `yt-search-${crypto.randomUUID()}`;
  const send = (message) => {
    if (res.destroyed || res.writableEnded) return;
    if (!res.headersSent) {
      res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
    }
    res.write(JSON.stringify(message) + '\n');
  };
  const disconnected = () => {
    if (!res.writableEnded) AudioProcessor.cancelImport(requestId);
  };
  if (streaming) res.on('close', disconnected);
  try {
    const result = await AudioProcessor.searchYouTube(req.body?.query, {
      limit: req.body?.limit,
      offset: req.body?.offset,
      requestId,
      includeMusic: req.body?.more !== true,
      ...(streaming ? { onUpdate: (update) => send({ type: 'update', success: true, ...update }) } : {}),
    });
    if (streaming) {
      send({ type: 'done', success: true, ...result });
      res.end();
    } else res.json({ success: true, results: result.results, hasMore: !!result.hasMore });
  } catch (err) {
    if (res.destroyed) return;
    if (streaming && res.headersSent) {
      send({ type: 'error', success: false, code: err.code || 'YOUTUBE_SEARCH_FAILED', error: err.message });
      res.end();
      return;
    }
    if (err.code === 'YOUTUBE_SEARCH_INVALID_QUERY') {
      return res.status(400).json({ success: false, code: err.code, error: err.message });
    }
    if (err.code === 'IMPORT_CANCELLED') {
      return res.status(499).json({ success: false, code: err.code, error: '搜尋已取消' });
    }
    const status = err.code === 'YOUTUBE_SEARCH_TIMEOUT' ? 504 : 502;
    log.warn(`YouTube 搜尋失敗 (${err.code || 'YOUTUBE_SEARCH_FAILED'})`);
    res.status(status).json({ success: false, code: err.code || 'YOUTUBE_SEARCH_FAILED', error: err.message });
  } finally { if (streaming) res.off('close', disconnected); }
});

// ─── YouTube 影片下載前檢查：只讀 metadata，不開始下載 ───
router.post('/youtube/inspect', requirePin, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !isYouTubeUrl(url)) return res.status(400).json({ error: '請提供有效的 YouTube 連結' });
    const requestedCookieBrowser = String(req.body?.cookieBrowser || '').trim();
    const cookieBrowser = AudioProcessor.normalizeCookieBrowser(requestedCookieBrowser);
    if (requestedCookieBrowser && !cookieBrowser) {
      return res.status(400).json({ error: '不支援的瀏覽器 Cookie 來源', code: 'INVALID_COOKIE_BROWSER' });
    }
    if (cookieBrowser && !isLoopbackAddress(getClientAddress(req))) {
      return res.status(403).json({
        error: '瀏覽器登入狀態只能由這台電腦上的 Elitesand Pro 面板使用。',
        code: 'COOKIE_BROWSER_LOCAL_ONLY',
      });
    }
    const assessment = await AudioProcessor.inspectYouTube(url, { requestId: req.body.requestId, cookieBrowser });
    res.json({ success: true, assessment });
  } catch (err) {
    const classified = classifyImportError(err);
    res.status(classified.status).json({
      error: classified.message,
      code: classified.code,
      recovery: classified.recovery,
      retryable: classified.retryable,
      browserCookieFallback: classified.browserCookieFallback === true && isLoopbackAddress(getClientAddress(req)),
    });
  }
});

// ─── YouTube 播放清單掃描：只回條目，下載仍由前端單工佇列逐首執行 ───
router.post('/youtube/playlist', requirePin, async (req, res) => {
  const start = Date.now();
  try {
    const { url } = req.body || {};
    const CONFIRM_THRESHOLD = 20;
    if (!url || !AudioProcessor.isPlaylistUrl(url)) {
      return res.status(400).json({ error: '請提供有效的 YouTube 播放清單連結（含 list= 參數）' });
    }

    const entries = await AudioProcessor.getPlaylistEntries(url);
    const total = entries.length;
    if (total === 0) return res.status(404).json({ error: '播放清單是空的或無法讀取' });

    log.info(`播放清單掃描完成: ${total} 首 (${Date.now() - start}ms)`);
    res.json({ success: true, entries, total, needsConfirm: total > CONFIRM_THRESHOLD, confirmThreshold: CONFIRM_THRESHOLD });
  } catch (err) {
    log.error(`播放清單匯入失敗 (${Date.now() - start}ms)`, err);
    res.status(500).json({ error: '播放清單匯入失敗', details: err.message });
  }
});

// ─── 歌詞搜尋 ───
router.post('/lyrics/search', requirePin, async (req, res) => {
  const start = Date.now();
  try {
    const { artist, title, duration } = req.body;

    // 驗證 title 為字串
    if (!title || typeof title !== 'string') {
      log.warn('歌詞搜尋缺少有效的歌名');
      return res.status(400).json({ error: '請提供有效的歌名（字串）' });
    }

    // 驗證 artist 為字串（如果提供）
    if (artist !== undefined && typeof artist !== 'string') {
      log.warn('歌詞搜尋 artist 參數非字串');
      return res.status(400).json({ error: '歌手名稱必須為字串' });
    }

    // 驗證 duration 為非負數（如果提供）
    if (duration !== undefined && (typeof duration !== 'number' || duration < 0)) {
      log.warn(`歌詞搜尋 duration 參數無效: ${duration}`);
      return res.status(400).json({ error: '時長必須為非負數字' });
    }

    log.info(`歌詞搜尋: ${artist || ''} - ${title} (時長: ${duration || 0}s)`);
    const result = await LyricsEngine.search(artist || '', title, duration || 0);
    const searchDuration = Date.now() - start;

    if (result) {
      log.info(`歌詞搜尋成功: ${title} (來源: ${result.source}, 耗時: ${searchDuration}ms)`);
      log.perf('lyrics-search', searchDuration, { title, source: result.source });
      res.json({ success: true, ...result, providerHealth: LyricsEngine.getProviderHealth() });
    } else {
      log.info(`歌詞搜尋未找到結果: ${title} (耗時: ${searchDuration}ms)`);
      res.json({ success: false, message: '找不到歌詞', providerHealth: LyricsEngine.getProviderHealth() });
    }
  } catch (err) {
    const duration = Date.now() - start;
    log.error(`歌詞搜尋失敗 (${duration}ms)`, err);
    res.status(500).json({ error: '歌詞搜尋失敗' });
  }
});

// ═══════════════════════════════════════════
// 歌詞選擇器：列出所有來源的候選歌詞供使用者挑選
// ═══════════════════════════════════════════

router.post('/lyrics/candidates', requirePin, async (req, res) => {
  const start = Date.now();
  try {
    const { artist, title, duration } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: '請提供有效的歌名（字串）' });
    }
    if (artist !== undefined && typeof artist !== 'string') {
      return res.status(400).json({ error: '歌手名稱必須為字串' });
    }
    if (duration !== undefined && (typeof duration !== 'number' || duration < 0)) {
      return res.status(400).json({ error: '時長必須為非負數字' });
    }

    log.info(`歌詞選擇器查詢: ${artist || ''} - ${title}`);
    const candidates = await LyricsEngine.searchAllSources(artist || '', title, duration || 0);
    log.info(`歌詞選擇器：回傳 ${candidates.length} 個候選 (耗時: ${Date.now() - start}ms)`);

    res.json({ success: true, candidates, providerHealth: LyricsEngine.getProviderHealth() });
  } catch (err) {
    log.error(`歌詞選擇器查詢失敗 (${Date.now() - start}ms)`, err);
    res.status(500).json({ error: '歌詞選擇器查詢失敗' });
  }
});

// ═══════════════════════════════════════════
// Phase 5: 歌詞檔案上傳（.lrc / .srt）
// ═══════════════════════════════════════════

router.post('/lyrics/upload', requirePin, lyricsUpload.single('lyrics'), (req, res) => {
  const start = Date.now();
  try {
    if (!req.file) {
      log.warn('歌詞上傳請求未包含檔案');
      return res.status(400).json({ error: '請上傳歌詞檔案' });
    }

    log.info(`處理歌詞上傳: ${req.file.originalname}`);
    const filePath = req.file.path;

    // 猜編碼讀取；UI locale 只用於無 BOM 純 CJK UTF-16 的保守 fallback，不影響 legacy 編碼判定。
    const content = decodeUploadedText(fs.readFileSync(filePath), req.body?.locale);

    if (!content.trim()) {
      // 清理上傳的檔案
      try { fs.unlinkSync(filePath); } catch (_) {}
      log.warn('上傳的歌詞檔案為空');
      return res.status(400).json({ error: '歌詞檔案為空' });
    }

    // 自動解析
    const parsed = autoParseLyrics(content);

    if (parsed.lines.length === 0) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      log.warn(`歌詞檔案解析無結果: ${req.file.originalname}`);
      return res.status(400).json({ error: '無法解析歌詞內容，請確認格式正確' });
    }

    // 清理上傳的檔案（不需要保留）
    try { fs.unlinkSync(filePath); } catch (_) {}

    const duration = Date.now() - start;
    log.info(`歌詞上傳解析完成: ${parsed.lines.length} 行, 類型: ${parsed.type} (${duration}ms)`);
    log.perf('lyrics-upload', duration, { lineCount: parsed.lines.length, type: parsed.type });

    res.json({
      success: true,
      lyrics: content,
      lyricsType: parsed.type,
      offset: parsed.offset,
      lineCount: parsed.lines.length,
      parsedLyrics: parsed.lines,
    });
  } catch (err) {
    log.error('歌詞上傳解析失敗', err);
    res.status(500).json({ error: '歌詞檔案解析失敗' });
  }
});

// ═══════════════════════════════════════════
// Phase 5: 歌詞貼上解析
// ═══════════════════════════════════════════

router.post('/lyrics/paste', requirePin, (req, res) => {
  const start = Date.now();
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      log.warn('歌詞貼上請求內容為空');
      return res.status(400).json({ error: '請提供歌詞內容' });
    }

    // 驗證歌詞內容長度（最大 1MB）
    const MAX_LYRICS_PASTE_SIZE = 1024 * 1024; // 1MB
    if (typeof content === 'string' && content.length > MAX_LYRICS_PASTE_SIZE) {
      log.warn(`歌詞貼上內容過大: ${content.length} bytes (上限 1MB)`);
      return res.status(400).json({ error: '歌詞內容過大，請控制在 1MB 以內' });
    }

    if (typeof content !== 'string') {
      log.warn('歌詞貼上內容非字串');
      return res.status(400).json({ error: '歌詞內容必須為字串' });
    }

    log.info(`處理歌詞貼上: ${content.length} 字元`);
    const parsed = autoParseLyrics(content);

    if (parsed.lines.length === 0) {
      log.warn('歌詞貼上解析無結果');
      return res.status(400).json({ error: '無法解析歌詞內容，請確認格式正確（支援 LRC / SRT / 純文字）' });
    }

    const duration = Date.now() - start;
    log.info(`歌詞貼上解析完成: ${parsed.lines.length} 行, 類型: ${parsed.type} (${duration}ms)`);

    res.json({
      success: true,
      lyrics: content,
      lyricsType: parsed.type,
      offset: parsed.offset,
      lineCount: parsed.lines.length,
      parsedLyrics: parsed.lines,
    });
  } catch (err) {
    log.error('歌詞貼上解析失敗', err);
    res.status(500).json({ error: '歌詞解析失敗' });
  }
});

// ─── 封面圖片服務 ───
router.get('/cover/:filename', (req, res) => {
  // 安全修正：防止路徑穿越（例如 ..%2F..%2F 讀取 downloads 以外的檔案），同 /audio/:filename 的作法
  const safeName = path.basename(req.params.filename);
  const resolvedDownloadsDir = path.resolve(downloadsDir);
  const coverPath = path.resolve(resolvedDownloadsDir, safeName);
  if (!coverPath.startsWith(resolvedDownloadsDir + path.sep)) {
    return res.status(400).json({ error: '無效的檔案名稱' });
  }
  if (fs.existsSync(coverPath)) {
    res.sendFile(coverPath);
  } else {
    log.warn(`封面不存在: ${safeName}`);
    res.status(404).json({ error: '封面不存在' });
  }
});

// ─── 播放列表管理 ───
router.get('/playlist', (req, res) => {
  res.json({ success: true, playlist: [] });
});

module.exports = router;
