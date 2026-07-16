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
const { sanitizeTrack } = require('../utils/track-schema');
const { getLanIp } = require('../utils/lan-info');
const ytdlpUpdater = require('../services/ytdlp-updater');
const appUpdater = require('../services/app-updater');
const announcements = require('../services/announcement-service');
const QRCode = require('qrcode');
const path = require('path');
const { dataDir, downloadsDir } = require('../utils/app-paths');
const fs = require('fs');
const { APP_VERSION } = require('../utils/app-version');
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
const { classifyImportError } = require('../utils/import-error');
const ytdlpCompatibility = require('../services/ytdlp-compatibility');
const { getSystemCheck } = require('../services/system-check');
const { createDiagnosticBundle } = require('../services/diagnostic-bundle');
const runtimeEvidence = require('../services/runtime-evidence');

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
      cb(new Error(`不支援的音訊格式: ${ext}，僅支援 ${allowed.join(', ')}`));
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
    const allowed = ['.lrc', '.srt', '.txt'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支援的歌詞格式: ${ext}，僅支援 .lrc / .srt / .txt`));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB 上限
});

// ─── Multer 設定（Phase 4：OBS 顯示端自訂背景圖）───
const BACKGROUNDS_DIR = path.join(dataDir, 'backgrounds');
const bgStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(BACKGROUNDS_DIR)) fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
    cb(null, BACKGROUNDS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const bgUpload = multer({
  storage: bgStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支援的圖片格式: ${ext}，僅支援 ${allowed.join(', ')}`));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB 上限
});

// ─── 健康檢查 ───
router.get('/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION, timestamp: Date.now() });
});

router.get('/system-check', async (req, res) => {
  res.json(await getSystemCheck());
});

// Support export is deliberately opt-in and PIN-protected when a PIN exists.
// It is built in memory; no diagnostic copy is written alongside user data.
router.get('/diagnostics/export', requirePin, async (req, res) => {
  try {
    const bundle = createDiagnosticBundle({
      systemCheck: await getSystemCheck(),
      runtimeEvidence: runtimeEvidence.getSnapshot(),
    });
    res.type('application/zip');
    res.attachment(bundle.filename);
    res.send(bundle.buffer);
    log.info(`Diagnostic bundle generated (${bundle.manifest.includedLogs.length} redacted log tail(s))`);
  } catch (error) {
    log.error('Diagnostic bundle generation failed', error);
    res.status(500).json({ error: '無法建立診斷包，請稍後再試。' });
  }
});

// A broadcast can start a fresh, memory-only evidence window without clearing
// playlist data, lyrics, settings, Twitch pending requests, or any user file.
// It is protected because the resulting timing information can reveal whether a
// stream is currently in progress on this LAN device.
router.post('/diagnostics/reliability/reset', requirePin, (req, res) => {
  res.json({ ok: true, evidence: runtimeEvidence.reset() });
});

// ─── yt-dlp 版本檢查與更新 ───
// 檢查是唯讀（只讀本機版本＋打 GitHub），不套 requirePin；
// 更新會改動 yt-dlp 執行檔，屬受保護操作，掛 requirePin。
router.get('/ytdlp/check', async (req, res) => {
  try {
    const force = req.query.force === '1';
    res.json(await ytdlpUpdater.checkUpdate(force));
  } catch (err) {
    log.error('yt-dlp 檢查失敗', err);
    res.status(500).json({ error: 'yt-dlp 檢查失敗' });
  }
});

router.post('/ytdlp/update', requirePin, async (req, res) => {
  try {
    const result = await ytdlpUpdater.runUpdate();
    if (result.ok) ytdlpCompatibility.scheduleProbe(50);
    res.status(result.ok ? 200 : 422).json(result);
  } catch (err) {
    log.error('yt-dlp 更新失敗', err);
    res.status(500).json({ ok: false, message: 'yt-dlp 更新失敗' });
  }
});

router.get('/ytdlp/compatibility', (req, res) => {
  res.json(ytdlpCompatibility.getStatus());
});

router.post('/ytdlp/compatibility', requirePin, async (req, res) => {
  res.json(await ytdlpCompatibility.probe());
});

// ─── 安全程式更新 ───
// 主程序只下載、驗證、解壓 staging 並啟動外部 updater；正式覆蓋一定等主 PID 完全退出。
router.get('/app-update/plan', async (req, res) => {
  try {
    const plan = await appUpdater.getPlan();
    const remoteActions = announcements.getSnapshot().actions;
    if (remoteActions.disableIncrementalUpdate || remoteActions.showFullDownloadOnly) {
      plan.canIncremental = false;
      plan.needsFull = plan.hasUpdate;
      plan.reason = '目前版本已由安全公告停用增量更新，請下載完整 Portable 版本';
    }
    res.json(plan);
  } catch (err) {
    log.error('線上更新檢查失敗', err);
    res.status(500).json({ error: '線上更新檢查失敗' });
  }
});

router.get('/app-update/status', (req, res) => {
  res.json(appUpdater.getProgress());
});

router.post('/app-update/apply', requirePin, async (req, res) => {
  try {
    const gracefulShutdown = req.app.get('gracefulShutdown');
    if (typeof gracefulShutdown !== 'function') {
      return res.status(503).json({ prepared: false, reason: '伺服器未建立安全關閉協調器，已拒絕更新' });
    }
    const remoteActions = announcements.getSnapshot().actions;
    if (remoteActions.disableIncrementalUpdate || remoteActions.showFullDownloadOnly) {
      return res.status(423).json({ prepared: false, needsFull: true, reason: '安全公告已停用此版本的增量更新，請下載完整 Portable 版本' });
    }
    const result = await appUpdater.prepareAndLaunchUpdate();
    if (!result.prepared) return res.status(result.needsFull ? 409 : 422).json(result);

    // 只有 updater 啟動握手成功後才回成功；只有 response 的 finish 事件發生後才開始關閉。
    // 若瀏覽器中途斷線而沒有 finish，主程序不退出，外部 updater 最終會逾時離開。
    res.once('finish', () => {
      setImmediate(() => gracefulShutdown({ reason: 'app-update', exitCode: 42 }));
    });
    return res.status(202).json(result);
  } catch (err) {
    log.error('線上更新失敗', err);
    return res.status(500).json({ prepared: false, reason: `線上更新失敗，程式仍可繼續使用：${err.message}` });
  }
});

// ─── 遠端公告（固定 HTTPS JSON；本機快取與已讀狀態在 data/）───
router.get('/announcements', async (req, res) => {
  if (req.query.force === '1') await announcements.refresh({ force: true });
  res.json(announcements.getSnapshot());
});

router.post('/announcements/:id/seen', requirePin, (req, res) => {
  const result = announcements.markSeen(req.params.id);
  res.status(result.ok ? 200 : 404).json(result);
});

router.post('/announcements/:id/dismiss', requirePin, (req, res) => {
  const result = announcements.dismiss(req.params.id);
  res.status(result.ok ? 200 : 422).json(result);
});

// ─── 區網資訊（手機遙控器連線用）───
// 唯讀、單純告知「手機要連哪個網址」，不涉及任何操作，不套 requirePin
// （手機第一次連線前根本還沒輸入過 PIN，總要有個地方讓它先查到網址）。
router.get('/lan-info', async (req, res) => {
  try {
    const ip = getLanIp();
    const port = req.socket.localPort;
    const controllerUrl = ip ? `http://${ip}:${port}/controller` : null;
    let qrDataUrl = null;
    if (controllerUrl) {
      try {
        qrDataUrl = await QRCode.toDataURL(controllerUrl, { margin: 1, width: 240 });
      } catch (e) {
        log.warn(`產生遙控器 QR code 失敗: ${e.message}`);
      }
    }
    res.json({ ip, port, controllerUrl, qrDataUrl });
  } catch (err) {
    log.error('取得區網資訊失敗', err);
    res.status(500).json({ error: '取得區網資訊失敗' });
  }
});

// ─── 本地檔案上傳 ───
router.post('/upload', requirePin, upload.array('files', 50), async (req, res) => {
  const start = Date.now();
  try {
    if (!req.files || req.files.length === 0) {
      log.warn('上傳請求未包含任何檔案');
      return res.status(400).json({ error: '請上傳至少一個音訊檔案' });
    }

    log.info(`開始處理 ${req.files.length} 個上傳檔案`);
    const results = [];
    const warnings = [];
    for (const file of req.files) {
      const filePath = file.path;
      const metadata = await parseMusicFile(filePath);

      const track = {
        id: path.basename(filePath, path.extname(filePath)),
        filename: path.basename(filePath),
        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        title: metadata.common.title || path.basename(file.originalname, path.extname(file.originalname)),
        artist: metadata.common.artist || '',
        album: metadata.common.album || '',
        duration: metadata.format.duration || 0,
        cover: null,
        lyrics: null,
        lyricsType: null,
      };

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
        }
      } catch (e) {
        log.warn(`歌詞搜尋失敗 (${track.artist} - ${track.title}): ${e.message}`);
        warnings.push(`${track.title}：音訊已匯入，但自動歌詞搜尋失敗`);
      }

      const safeTrack = sanitizeTrack(track);
      if (safeTrack) results.push(safeTrack);
    }

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
    const result = await AudioProcessor.processYouTube(url, { priority: 'interactive', requestId: req.body.requestId });
    const duration = Date.now() - start;
    log.info(`YouTube 處理完成: ${result.title || result.id} (${duration}ms)`);
    log.perf('youtube', duration, { title: result.title });
    const safeTrack = sanitizeTrack(result);
    if (!safeTrack) return res.status(422).json({ error: '音訊處理結果格式無效' });
    res.json({ success: true, track: safeTrack });
  } catch (err) {
    const duration = Date.now() - start;
    log.error(`YouTube 處理失敗 (${duration}ms)`, err);
    const classified = classifyImportError(err);
    res.status(classified.status).json({
      error: classified.message,
      code: classified.code,
      recovery: classified.recovery,
      retryable: classified.retryable,
      details: classified.technical,
    });
  }
});

router.post('/youtube/cancel', requirePin, (req, res) => {
  const result = AudioProcessor.cancelImport(req.body?.requestId);
  res.status(result.ok ? 202 : 404).json(result);
});

// ─── YouTube 影片下載前檢查：只讀 metadata，不開始下載 ───
router.post('/youtube/inspect', requirePin, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !isYouTubeUrl(url)) return res.status(400).json({ error: '請提供有效的 YouTube 連結' });
    const assessment = await AudioProcessor.inspectYouTube(url, { requestId: req.body.requestId });
    res.json({ success: true, assessment });
  } catch (err) {
    const classified = classifyImportError(err);
    res.status(classified.status).json({
      error: classified.message,
      code: classified.code,
      recovery: classified.recovery,
      retryable: classified.retryable,
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
    const ext = path.extname(req.file.originalname).toLowerCase();

    // 嘗試多種編碼讀取
    let content = '';
    const encodings = ['utf8', 'utf-8'];

    // 嘗試用 iconv-lite 讀取其他編碼
    try {
      const iconv = require('iconv-lite');
      const rawBuffer = fs.readFileSync(filePath);
      content = iconv.decode(rawBuffer, 'utf8');

      // 如果出現亂碼特徵，嘗試其他編碼
      if (content.includes('') || content.includes('ÿþ')) {
        content = iconv.decode(rawBuffer, 'utf-16le');
      }
      if (content.includes('') || content.includes('ÿþ')) {
        content = iconv.decode(rawBuffer, 'shift_jis');
      }
      if (content.includes('') || content.includes('ÿþ')) {
        content = iconv.decode(rawBuffer, 'gbk');
      }
    } catch (e) {
      content = fs.readFileSync(filePath, 'utf8');
    }

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

// ─── OBS 顯示端自訂背景（Phase 4）───
// 單一背景：上傳新圖前先清掉舊檔，避免 data/backgrounds/ 累積垃圾。
router.post('/background', requirePin, bgUpload.single('background'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未收到圖片檔案' });
  }
  try {
    const keepName = req.file.filename;
    const existing = fs.readdirSync(BACKGROUNDS_DIR);
    for (const name of existing) {
      if (name !== keepName) {
        try { fs.unlinkSync(path.join(BACKGROUNDS_DIR, name)); } catch (e) { /* 靜默 */ }
      }
    }
    res.json({ success: true, filename: keepName });
  } catch (err) {
    log.error('背景圖清理舊檔失敗', err);
    res.status(500).json({ error: '背景圖處理失敗' });
  }
});

router.delete('/background', requirePin, (req, res) => {
  try {
    if (fs.existsSync(BACKGROUNDS_DIR)) {
      for (const name of fs.readdirSync(BACKGROUNDS_DIR)) {
        try { fs.unlinkSync(path.join(BACKGROUNDS_DIR, name)); } catch (e) { /* 靜默 */ }
      }
    }
    res.json({ success: true });
  } catch (err) {
    log.error('背景圖刪除失敗', err);
    res.status(500).json({ error: '背景圖刪除失敗' });
  }
});

// ─── 播放列表管理 ───
router.get('/playlist', (req, res) => {
  res.json({ success: true, playlist: [] });
});

// ─── 系統字體清單 ───
// 由伺服器直接掃描字體目錄（含使用者專屬字體），不受瀏覽器 Font Access API 的
// 權限/數量限制；?refresh=1 可重掃（新安裝字體後使用）。
router.get('/fonts', async (req, res) => {
  try {
    const { listSystemFonts } = require('../services/font-scanner');
    const result = await listSystemFonts(req.query.refresh === '1');
    res.json({ success: true, fonts: result.fonts, fileCount: result.fileCount });
  } catch (err) {
    log.error('掃描系統字體失敗', err);
    res.status(500).json({ success: false, error: '掃描系統字體失敗' });
  }
});

module.exports = router;
