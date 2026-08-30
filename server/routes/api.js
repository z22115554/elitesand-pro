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
const announcements = require('../services/announcement-service');
const eulaStore = require('../services/eula-store');
const QRCode = require('qrcode');
const path = require('path');
const { dataDir, downloadsDir } = require('../utils/app-paths');
const stateStore = require('../services/state-store');
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
// EULA 同意閘門專用：只要「本機桌面或已配對的遙控器」，不要 PIN——首次同意先於 PIN 設定。
const { requireControlAccess } = require('../middleware/require-control-access');
const { isYouTubeUrl } = require('../utils/youtube-url');
const { classifyImportError, toImportTelemetryCode } = require('../utils/import-error');
const { decodeUploadedText } = require('../utils/decode-text');
const ytdlpCompatibility = require('../services/ytdlp-compatibility');
const systemCheck = require('../services/system-check');
const ffmpegProvider = require('../services/ffmpeg-provider');
const aiRuntimeProvider = require('../services/ai-runtime-provider');
const aiSeparationBundle = require('../services/ai-separation-bundle');
const aiSeparationJobs = require('../services/ai-separation-jobs');
const webgpuRuntimeProvider = require('../services/webgpu-runtime-provider');
const webgpuSeparationJobs = require('../services/webgpu-separation-jobs');
const webgpuSeparationSettings = require('../services/webgpu-separation-settings');
const libraryStore = require('../services/library-store');
const { createDiagnosticBundle } = require('../services/diagnostic-bundle');
const runtimeEvidence = require('../services/runtime-evidence');
const feedbackReport = require('../services/feedback-report');
const feedbackClient = require('../services/feedback-client');
const sessionMarker = require('../services/session-marker');
const usageTelemetry = require('../services/usage-telemetry');
const lyricOffsetSync = require('../services/lyric-offset-sync');

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
    const allowed = ['.lrc', '.srt', '.txt'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      const err = new Error(`不支援的歌詞格式: ${ext}，僅支援 .lrc / .srt / .txt`);
      err.status = 400;
      cb(err);
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
      const err = new Error(`不支援的圖片格式: ${ext}，僅支援 ${allowed.join(', ')}`);
      err.status = 400;
      cb(err);
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB 上限
});

// ─── 健康檢查 ───
router.get('/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION, timestamp: Date.now() });
});

router.get('/system-check', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const force = req.query?.force === '1' || req.query?.force === 'true';
  res.json(await systemCheck.getSystemCheck({ force }));
});

// ─── FFmpeg 按需下載（批次 D-1）───
// 只讀進度，不含本機路徑或敏感資料；前端下載期間輪詢它，避免 100MB+ 下載看起來像卡死。
router.get('/ffmpeg/download/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(ffmpegProvider.getDownloadStatus());
});

// 這條路由會觸發真正的網路下載＋寫入本機檔案，依鐵則 15 必須手動掛 requirePin。
router.post('/ffmpeg/download', requirePin, async (req, res) => {
  if (ffmpegProvider.isAvailable()) {
    const resolved = ffmpegProvider.resolveFfmpegPaths();
    systemCheck.clearCache();
    const refreshed = await systemCheck.getSystemCheck({ force: true });
    if (refreshed.ffmpeg?.available) {
      return res.json({
        ok: true,
        alreadyAvailable: true,
        source: resolved.source,
        version: refreshed.ffmpeg.version || null,
      });
    }
    log.warn('FFmpeg 初步檢查可用，但強制 system-check 失敗，改走重新下載修復');
  }
  try {
    const result = await ffmpegProvider.downloadFfmpeg();
    systemCheck.clearCache();
    const refreshed = await systemCheck.getSystemCheck({ force: true });
    if (!refreshed.ffmpeg?.available) {
      const err = new Error('FFmpeg 已下載，但重新驗證仍無法執行');
      err.ffmpegStage = 'system-check';
      throw err;
    }
    res.json({
      ok: true,
      alreadyAvailable: false,
      ffmpeg: result.ffmpeg,
      source: result.source || null,
      version: refreshed.ffmpeg.version || null,
    });
  } catch (err) {
    const stage = err.ffmpegStage || 'unknown';
    systemCheck.clearCache();
    log.error(`FFmpeg 下載失敗（stage=${stage}）`, err);
    res.status(502).json({ ok: false, stage, reason: err.message });
  }
});

router.get('/ffmpeg/status', (req, res) => {
  const resolved = ffmpegProvider.resolveFfmpegPaths();
  const available = ffmpegProvider.isAvailable();
  res.json({
    available,
    source: available ? (resolved?.source || null) : null,
    downloadUrl: ffmpegProvider.DOWNLOAD_URL,
  });
});

// Support export is deliberately opt-in and PIN-protected when a PIN exists.
// It is built in memory; no diagnostic copy is written alongside user data.
router.get('/diagnostics/export', requirePin, async (req, res) => {
  try {
    const bundle = createDiagnosticBundle({
      systemCheck: await systemCheck.getSystemCheck(),
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

// ─── 匿名活躍統計 ───
// GET 只回開關狀態；POST 會寫本機偏好，依其他設定寫入端點的規則掛 requirePin。
router.get('/usage/settings', (req, res) => {
  res.json(usageTelemetry.getSettings());
});

router.post('/usage/settings', requirePin, (req, res) => {
  if (!req.body || typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ ok: false, code: 'INVALID_REQUEST' });
  }
  try {
    const settings = usageTelemetry.setEnabled(req.body.enabled);
    if (settings.enabled) {
      usageTelemetry.start().catch((error) => log.warn(`匿名使用統計啟動失敗：${error.message}`));
    }
    res.json({ ok: true, settings });
  } catch (error) {
    log.warn(`匿名使用統計設定保存失敗：${error.message}`);
    res.status(500).json({ ok: false, code: 'SAVE_FAILED' });
  }
});

// ─── 歌詞偏移社群回饋 ───
// 跟上面的匿名活躍統計是兩個獨立開關，不要共用同一組端點或狀態。
router.get('/lyric-offset-sync/settings', (req, res) => {
  res.json(lyricOffsetSync.getSettings());
});

router.post('/lyric-offset-sync/settings', requirePin, (req, res) => {
  if (!req.body || typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ ok: false, code: 'INVALID_REQUEST' });
  }
  try {
    const settings = lyricOffsetSync.setEnabled(req.body.enabled);
    res.json({ ok: true, settings });
  } catch (error) {
    log.warn(`歌詞偏移回饋設定保存失敗：${error.message}`);
    res.status(500).json({ ok: false, code: 'SAVE_FAILED' });
  }
});

// ─── 程式內問題回報 ───
// 兩個端點都手動掛 requirePin（鐵則 15）：報告內含已清理的日誌尾巴與連線觀測，
// 跟診斷包同一個等級，不能讓區網上的其他人隨手取得或代替主機送出回報。

// 唯讀：回傳「送出時會送出什麼」的完整文字。使用者一定先看到這個，才會出現送出按鈕。
router.post('/feedback/preview', requirePin, async (req, res) => {
  try {
    const built = feedbackReport.buildReport(req.body || {}, {
      systemCheck: await systemCheck.getSystemCheck(),
      runtimeEvidence: runtimeEvidence.getSnapshot(),
    });
    if (!built.ok) return res.status(400).json({ ok: false, errors: built.errors });
    res.json({
      ok: true,
      preview: built.plainText,
      byteLength: built.byteLength,
      canSubmit: feedbackClient.isEnabled(),
    });
  } catch (error) {
    log.error('問題回報預覽失敗', error);
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR' });
  }
});

// 送出：伺服器自己重新組一次報告，不接受前端傳回來的成品——否則預覽跟實際送出的
// 內容可以被改成不一樣的東西，「送出前預覽」這個承諾就不成立了。
router.post('/feedback/submit', requirePin, async (req, res) => {
  try {
    if (!feedbackClient.isEnabled()) return res.status(503).json({ ok: false, code: 'DISABLED' });
    const built = feedbackReport.buildReport(req.body || {}, {
      systemCheck: await systemCheck.getSystemCheck(),
      runtimeEvidence: runtimeEvidence.getSnapshot(),
    });
    if (!built.ok) return res.status(400).json({ ok: false, errors: built.errors });

    // 冪等鍵由前端保存：同一份報告按第二次送出時帶同一個值，中繼會回原本的編號，
    // 不會變成兩張 issue。前端沒帶就當成新報告。
    const requestId = typeof req.body.requestId === 'string' && req.body.requestId.length <= 64
      ? req.body.requestId
      : feedbackClient.newRequestId();

    const result = await feedbackClient.submitReport(built.report, requestId);
    if (result.ok) return res.json({ ok: true, reportId: result.reportId, warnings: result.warnings, requestId });
    const status = result.code === 'RATE_LIMITED' ? 429 : 502;
    res.status(status).json({ ok: false, code: result.code, requestId });
  } catch (error) {
    log.error('問題回報送出失敗', error);
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR' });
  }
});

// 面板載入時用來決定要顯示「送出回報」還是只顯示「複製全文」。
// 一併帶上「上次是否非正常結束」，面板才知道要不要跳當機提示 banner。
// 這裡只回布林與時間戳，不含任何診斷內容——真正的診斷仍要等使用者按下送出才收集。
router.get('/feedback/status', (req, res) => {
  const startup = sessionMarker.getStartupState();
  res.json({
    enabled: feedbackClient.isEnabled(),
    types: Object.keys(feedbackReport.REPORT_TYPES),
    limits: feedbackReport.LIMITS,
    lastSessionCrashed: startup.wasClean === false,
    // 給前端當「這個事件已處理過沒」的鍵，避免同一次當機每次重整都再問一遍。
    lastSessionStartedAt: startup.previousStartedAt || null,
  });
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

// ─── EULA 首次同意閘門 ───
// 不套 requirePin：首次啟動同意條款發生在 PIN 設定之前；同意紀錄由
// eula-store 寫入 data 目錄，條款版本變更時 required 會重新變 true。
router.get('/eula', (req, res) => {
  const status = eulaStore.getStatus();
  res.json({ ...status, text: status.required ? eulaStore.getText() : null });
});

// 但仍要 requireControlAccess（本機 loopback 或已配對的遙控器）。伺服器綁 0.0.0.0，
// 沒有這一關的話同網段任何裝置都能代替使用者「同意」條款：使用者從此看不到同意閘門，
// 而且會當場觸發 usageTelemetry.start() 與歌詞偏移的一次性回補（把本機存的 YouTube
// 影片 ID＋偏移送往社群 Worker）。首次啟動一定發生在本機面板，loopback 直接放行，
// 這一關不會擋到任何正常流程。同一個信任模型見 utils/pin-setup-policy.js。
router.post('/eula/accept', requireControlAccess, (req, res) => {
  try {
    // 副作用只在「這次呼叫真的把未同意翻成已同意」時觸發。重複 POST（重整、重送）
    // 不該再叫一次 start()／backfill——backfill 內部雖有 backfillDone 一次性旗標，
    // 但這裡先擋掉才是正確的因果，不依賴下游的去重。
    const wasRequired = eulaStore.getStatus().required;
    const status = eulaStore.accept(req.body && req.body.version);
    if (!wasRequired) return res.json({ success: true, ...status });
    usageTelemetry.start().catch((error) => log.warn(`匿名使用統計啟動失敗：${error.message}`));
    // 一次性回補：把這個功能上線前，使用者已經在本機存下的偏移記錄也送一次
    // （backfillFromExistingOffsets 內部自己保證只真的執行一次，見服務內註解）。
    // 這段刻意 fire-and-forget、自己吃掉所有例外——回補失敗不該讓 EULA 同意這個
    // 動作本身回傳失敗，使用者已經同意了，不能因為背景任務出錯就卡住往下走。
    try {
      const saved = stateStore.loadState();
      lyricOffsetSync.backfillFromExistingOffsets((saved && saved.trackOffsets) || {})
        .catch((error) => log.warn(`歌詞偏移回饋一次性回補失敗：${error.message}`));
    } catch (error) {
      log.warn(`歌詞偏移回饋一次性回補啟動失敗：${error.message}`);
    }
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
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
      // 統一音量：本地上傳同樣量整曲響度（失敗回 null，不中斷上傳）
      const loudnessLufs = await AudioProcessor.measureLoudnessQueued(filePath).catch(() => null);

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
        loudnessLufs,
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
  try {
    const { results, hasMore } = await AudioProcessor.searchYouTube(req.body?.query, {
      limit: req.body?.limit,
      offset: req.body?.offset,
      requestId: req.body?.requestId,
    });
    res.json({ success: true, results, hasMore: !!hasMore });
  } catch (err) {
    if (err.code === 'YOUTUBE_SEARCH_INVALID_QUERY') {
      return res.status(400).json({ success: false, code: err.code, error: err.message });
    }
    if (err.code === 'IMPORT_CANCELLED') {
      return res.status(499).json({ success: false, code: err.code, error: '搜尋已取消' });
    }
    const status = err.code === 'YOUTUBE_SEARCH_TIMEOUT' ? 504 : 502;
    log.warn(`YouTube 搜尋失敗 (${err.code || 'YOUTUBE_SEARCH_FAILED'})`);
    res.status(status).json({ success: false, code: err.code || 'YOUTUBE_SEARCH_FAILED', error: err.message });
  }
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
    // assets 是不含本機路徑的 opaque ID。顯示端用它向下面的 loopback-only 路由取字型檔，
    // 不再賭 Chromium 是否剛好把 Windows 使用者字型註冊成可用 CSS family。
    res.json({ success: true, fonts: result.fonts, aliases: result.aliases, assets: result.assets, fileCount: result.fileCount });
  } catch (err) {
    log.error('掃描系統字體失敗', err);
    res.status(500).json({ success: false, error: '掃描系統字體失敗' });
  }
});

function isDirectLoopback(req) {
  const address = req.socket && req.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requireLocalFontAsset(req, res, next) {
  // Server 本身會綁在 LAN；字型檔卻不應因而被 LAN/隧道來源下載。不要信任
  // X-Forwarded-For，只有 TCP 對端確實是 loopback 才可繼續。
  if (!isDirectLoopback(req)) return res.status(403).json({ success: false, error: '本機字型資源只限這台電腦的輸出頁使用' });
  next();
}

function safeAssetId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(value);
}

// 先給 FontFace 載入器一份已驗證的 face 描述；不暴露實體字型路徑。
router.get('/fonts/assets/:assetId', requireLocalFontAsset, async (req, res) => {
  if (!safeAssetId(req.params.assetId)) return res.status(400).json({ success: false, error: '無效的字型資源' });
  try {
    const { getFontAsset } = require('../services/font-scanner');
    const asset = await getFontAsset(req.params.assetId);
    if (!asset) return res.status(404).json({ success: false, error: '字型資源已不存在，請重新選擇' });
    res.set({
      'Cache-Control': 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    // 集合字型（.ttc/.otc）不以 FontFace 遞送（font-scanner.js 說明）；只留單體 face。
    // 全部都是集合字型時直接 404，讓客戶端走系統字型名稱堆疊 fallback。
    const deliverableFaces = asset.faces.filter((face) => !face.isCollection);
    if (!deliverableFaces.length) {
      return res.status(404).json({ success: false, error: '此字型為集合字型，將以系統字型名稱套用' });
    }
    res.json({
      success: true,
      id: asset.id,
      family: `ElitesandLocalFont-${asset.id}`,
      faces: deliverableFaces.map((face) => ({
        id: face.id,
        weight: face.weight,
        style: face.style,
        format: face.format,
        url: `/api/fonts/assets/${asset.id}/${face.id}`,
      })),
    });
  } catch (err) {
    log.error('讀取本機字型資源資訊失敗', err);
    res.status(500).json({ success: false, error: '讀取本機字型資源失敗' });
  }
});

// 實際字型位元組只由掃描器已知的 opaque ID 對應；scanner 會再 realpath 驗證其仍位於
// Windows/macOS/Linux 受管字型目錄內，避免把此 API 變成任意檔案讀取器。
router.get('/fonts/assets/:assetId/:faceId', requireLocalFontAsset, async (req, res) => {
  if (!safeAssetId(req.params.assetId) || !safeAssetId(req.params.faceId)) {
    return res.status(400).json({ success: false, error: '無效的字型資源' });
  }
  try {
    const { resolveFontAssetFace } = require('../services/font-scanner');
    const face = await resolveFontAssetFace(req.params.assetId, req.params.faceId);
    if (!face) return res.status(404).json({ success: false, error: '字型資源已不存在，請重新選擇' });
    const mime = face.format === 'opentype' ? 'font/otf' : 'font/ttf';
    res.set({
      'Cache-Control': 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(face.size),
    });
    res.type(mime);
    const stream = fs.createReadStream(face.file);
    stream.on('error', (err) => {
      log.warn(`讀取本機字型檔失敗: ${err.message}`);
      if (!res.headersSent) res.status(404).end();
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    log.error('傳送本機字型資源失敗', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: '傳送本機字型資源失敗' });
  }
});

// ─── AI 人聲分離（實驗性功能）───
// 定位見 CLAUDE.md「AI 人聲分離」：使用 Kim Mel-Band RoFormer 模型，作者書面授權確認
// （docs/AI-SEPARATION-PLAN.md §6）截至上線時仍在等待中——這是使用者知情後的決定，
// 不是遺漏，見 STATUS.md 對應記錄。

// 對前端公開的唯一安裝入口。Python/WebGPU/CPU 是內部備援順序，不再要求使用者
// 分別理解或下載；舊的個別 runtime 端點暫時保留給既有測試與維修工具。
router.get('/ai-separation/bundle-status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ...aiSeparationBundle.getStatus(),
    webgpuEngineConnected: webgpuSeparationJobs.isEngineAvailable(),
    jobs: aiSeparationJobs.getActiveJobs(),
  });
});

router.post('/ai-separation/bundle/download', requirePin, async (req, res) => {
  try {
    const result = await aiSeparationBundle.downloadBundle();
    res.json(result);
  } catch (err) {
    log.error('AI 伴奏完整元件下載失敗', err);
    res.status(502).json({ ok: false, reason: err.message });
  }
});

// 只讀進度，不含本機路徑，前端下載期間輪詢它（同 /ffmpeg/download/status 的理由）。
router.get('/ai-separation/runtime-status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ available: aiRuntimeProvider.isAvailable(), ...aiRuntimeProvider.getDownloadStatus() });
});

// 觸發真正的網路下載＋寫入本機檔案，依鐵則 15 必須手動掛 requirePin。
router.post('/ai-separation/runtime/download', requirePin, async (req, res) => {
  if (aiRuntimeProvider.isAvailable()) {
    return res.json({ ok: true, alreadyAvailable: true });
  }
  try {
    await aiRuntimeProvider.downloadRuntime({});
    res.json({ ok: true, alreadyAvailable: false });
  } catch (err) {
    log.error('AI 分離 runtime 下載失敗', err);
    res.status(502).json({ ok: false, reason: err.message });
  }
});

// ─── WebGPU 人聲分離（實驗性，§13 musetric 路線）───
// GET 只回開關狀態；POST 會寫本機偏好，依其他設定寫入端點的規則掛 requirePin。
// 跟上面的匿名活躍統計是同一種模式，但刻意是獨立的檔案/端點——這個開關關掉
// 不該影響其他任何功能。
router.get('/webgpu-separation/settings', (req, res) => {
  res.json(webgpuSeparationSettings.getSettings());
});

router.post('/webgpu-separation/settings', requirePin, (req, res) => {
  if (!req.body || typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ ok: false, code: 'INVALID_REQUEST' });
  }
  const settings = webgpuSeparationSettings.setEnabled(req.body.enabled);
  // 剛打開開關、模型還沒下載過：先開始下載，不用使用者再多按一次。跟 CUDA runtime
  // 的下載按鈕不同的地方是這裡自動觸發——模型下載失敗不影響開關本身能不能存，
  // 使用者之後可以用下面的 runtime/download 端點重試。
  if (settings.enabled && !webgpuRuntimeProvider.isAvailable()) {
    webgpuRuntimeProvider.downloadModel({}).catch((err) => log.warn(`WebGPU 模型自動下載失敗：${err.message}`));
  }
  res.json({ ok: true, settings });
});

// 只讀進度，前端下載期間輪詢它（同 /ai-separation/runtime-status 的理由）；額外帶
// engineConnected——設定開了但 Electron 隱藏視窗還沒連上時，前端要能顯示「引擎離線」
// 而不是誤導使用者以為隨時能點分離。
router.get('/webgpu-separation/runtime-status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    available: webgpuRuntimeProvider.isAvailable(),
    engineConnected: webgpuSeparationJobs.isEngineAvailable(),
    // Electron 的健康輪詢（shell.js）讀這個：比上次新的時間戳＝引擎卡死/崩了，
    // 請把隱藏 BrowserWindow 重開一次。0＝沒有待處理的重開請求。
    engineRestartRequestedAt: webgpuSeparationJobs.getRestartRequestedAt(),
    ...webgpuRuntimeProvider.getDownloadStatus(),
  });
});

// 分離結果的 WAV 檔改用 HTTP multipart 上傳（見 webgpu-separation-jobs.js 的
// finishJobWithResult 註解：一首幾分鐘的歌兩個 WAV 加起來很容易超過 Socket.io
// 的 8MB 封包上限，真機首測就是在送結果時炸掉，誤報成分離失敗）。故意不掛
// requirePin：呼叫者是沒有 PIN 內容的隱藏引擎視窗，授權改用「jobId 對得上目前
// activeJob」這個等同於 socket 版本 payload.jobId 檢查的門檻。
const webgpuResultUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 2 },
});

/**
 * 結果上傳的前置關卡。必須排在 multer 之前——這是重點，不是順手加的。
 *
 * 這條路由原本只靠 finishJobWithResult() 內部的 jobId 比對當授權，但那已經是
 * multer 把最大 2×500MB 讀進記憶體之後的事：同網段任何裝置（非瀏覽器的 client
 * 不帶 Sec-Fetch-Site，index.js 的跨站防護擋不到）連續丟大檔就能把行程灌爆，
 * 直播中的歌詞疊加層會直接消失。實測過：從區網 IP 打這條回 409（已進 handler），
 * 同條件打有保護的路由回 401。
 *
 * 兩道檢查：
 * 1. 只收 loopback。引擎視窗永遠是 electron/webgpu-engine-window.js 用
 *    `http://127.0.0.1:<port>/webgpu-separation-worker.html` 載入的，所以這道
 *    限制對正常流程零影響（跟 requireLocalFontAsset 同一個先例與同一個理由：
 *    不信任 X-Forwarded-For，只認 TCP 對端）。
 * 2. jobId 先比對一次。finishJobWithResult() 仍會再比對（那才是真正的授權關卡，
 *    也是唯一會消費掉 activeJob 的地方），這裡只是不讓不合法的請求先耗掉記憶體。
 */
function requireLocalEngineJob(req, res, next) {
  if (!isDirectLoopback(req)) {
    return res.status(403).json({ ok: false, error: '分離結果只接受本機引擎視窗回傳' });
  }
  const activeJobId = webgpuSeparationJobs.getActiveJobId();
  if (!activeJobId || activeJobId !== req.params.jobId) {
    return res.status(409).json({ ok: false, error: 'STALE_JOB' });
  }
  next();
}

router.post('/webgpu-separation/result/:jobId', requireLocalEngineJob, webgpuResultUpload.fields([
  { name: 'vocals', maxCount: 1 },
  { name: 'instrumental', maxCount: 1 },
]), (req, res) => {
  const result = webgpuSeparationJobs.finishJobWithResult(req.params.jobId, {
    vocalsBuffer: req.files?.vocals?.[0]?.buffer,
    instrumentalBuffer: req.files?.instrumental?.[0]?.buffer,
    gpuVendor: req.body?.gpuVendor,
    peakBufferMb: req.body?.peakBufferMb ? Number(req.body.peakBufferMb) : undefined,
    realtimeFactor: req.body?.realtimeFactor ? Number(req.body.realtimeFactor) : undefined,
    audioSeconds: req.body?.audioSeconds ? Number(req.body.audioSeconds) : undefined,
  });
  if (!result.ok) return res.status(409).json({ ok: false, error: result.code });
  res.json({ ok: true });
});

router.post('/webgpu-separation/runtime/download', requirePin, async (req, res) => {
  if (webgpuRuntimeProvider.isAvailable()) {
    return res.json({ ok: true, alreadyAvailable: true });
  }
  try {
    await webgpuRuntimeProvider.downloadModel({});
    res.json({ ok: true, alreadyAvailable: false });
  } catch (err) {
    log.error('WebGPU 分離模型下載失敗', err);
    res.status(502).json({ ok: false, reason: err.message });
  }
});

// 啟動一次分離 job。這是一支會觸發真正 GPU/CPU 運算＋寫入本機檔案的路由，依鐵則 15
// 必須手動掛 requirePin。只回傳 jobId；實際進度/完成走 Socket.io 的 separation:progress
// 事件（見 server/services/ai-separation-jobs.js／webgpu-separation-jobs.js），不是這個
// HTTP response。引擎選擇由 ai-separation-jobs 統一協調：Python GPU → WebGPU → CPU。
router.post('/library/:id/separate', requirePin, async (req, res) => {
  const trackId = req.params.id;
  const entry = libraryStore.getEntry(trackId);
  if (!entry || !entry.filename) {
    return res.status(404).json({ ok: false, error: '找不到這首歌的音檔' });
  }
  if (entry.separationStatus === 'processing') {
    return res.status(409).json({ ok: false, error: 'ALREADY_PROCESSING' });
  }

  if (!aiSeparationBundle.isAvailable()) {
    return res.status(409).json({ ok: false, error: 'AI_RUNTIME_NOT_READY' });
  }
  try {
    const jobId = await aiSeparationJobs.startJobForTrack(trackId, {
      inputPath: path.join(downloadsDir, entry.filename),
      // /audio/:filename 只認 downloadsDir 直接底下的檔名（server/index.js），輸出必須
      // 直接落在這裡，分離出來的兩個檔案才能透過既有的 /audio 端點播放，不用另開路由。
      outputDir: downloadsDir,
      modelFileDir: path.join(dataDir, 'ai-models'),
      sourceFilename: entry.filename,
    });
    // separationStatus:'processing' 現在由 aiSeparationJobs.startJobForTrack 統一寫入
    // （playState + libraryStore 兩邊，鐵則 #17）；這裡不再單寫 libraryStore，避免重開後不一致。
    // jobId 為 null 代表已經有另一首在跑，這首排進佇列了（見 ai-separation-jobs.js 的
    // startJobForTrack）——不是失敗，前端靠 separation:progress 的 stage:'queued' 顯示排隊中。
    res.json({ ok: true, jobId, queued: jobId === null });
  } catch (err) {
    log.error(`啟動 AI 分離失敗 track=${trackId}`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 使用者在分離進行中／排隊中按「取消」。掛 requirePin（鐵則 #15，會動到正在跑的
// GPU/CPU 工作）。收尾（狀態回 'none'、廣播 stage:'cancelled'、佇列推進）都在
// aiSeparationJobs.cancelJobForTrack 裡做，這裡只轉呼叫。
router.post('/library/:id/separate/cancel', requirePin, (req, res) => {
  const result = aiSeparationJobs.cancelJobForTrack(req.params.id);
  if (!result.ok) return res.status(404).json({ ok: false, error: 'NO_ACTIVE_SEPARATION' });
  res.json({ ok: true, state: result.state });
});

module.exports = router;
