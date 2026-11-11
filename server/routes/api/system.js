/**
 * API 路由：系統與設定：健康檢查、FFmpeg／yt-dlp、診斷、回報、統計設定、公告、EULA、區網資訊
 * 由 server/routes/api.js 掛載在 /api 底下。
 */
const express = require('express');
const router = express.Router();
const { getLanIp } = require('../../utils/lan-info');
const ytdlpUpdater = require('../../services/ytdlp-updater');
const obsLauncher = require('../../services/obs-launcher');
const announcements = require('../../services/announcement-service');
const eulaStore = require('../../services/eula-store');
const QRCode = require('qrcode');
const stateStore = require('../../services/state-store');
const { APP_VERSION } = require('../../utils/app-version');

const { createLogger } = require('../../utils/logger');
const log = createLogger('API');
// PIN 存取控制（選用）：只套在會觸發下載/處理的路由，唯讀端點（cover/fonts/health）不套，
// 見 server/middleware/require-pin.js 開頭說明。
const requirePin = require('../../middleware/require-pin');
// EULA 同意閘門專用：只要「本機桌面或已配對的遙控器」，不要 PIN——首次同意先於 PIN 設定。
const { requireControlAccess } = require('../../middleware/require-control-access');
const ytdlpCompatibility = require('../../services/ytdlp-compatibility');
const systemCheck = require('../../services/system-check');
const ffmpegProvider = require('../../services/ffmpeg-provider');
const { createDiagnosticBundle } = require('../../services/diagnostic-bundle');
const runtimeEvidence = require('../../services/runtime-evidence');
const feedbackReport = require('../../services/feedback-report');
const feedbackClient = require('../../services/feedback-client');
const sessionMarker = require('../../services/session-marker');
const usageTelemetry = require('../../services/usage-telemetry');
const lyricOffsetSync = require('../../services/lyric-offset-sync');

// ─── 健康檢查 ───
router.get('/health', (req, res) => {
  // OBS 啟動頁（data/obs-sources/*.html）以 file:// 來源探測本機 port，瀏覽器送的 Origin 是
  // null，必須放行 CORS 才讀得到回應。health 只有狀態／版本／時間戳，沒有任何機密或副作用。
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');
  const fallbackFrom = Number.parseInt(process.env.ELITESAND_PORT_FALLBACK_FROM || '', 10);
  res.json({
    status: 'ok',
    version: APP_VERSION,
    timestamp: Date.now(),
    port: req.socket?.localPort || null,
    // 桌面殼因預設 port 被占而改用備援時才有值；面板據此提示一次。
    portFallbackFrom: Number.isInteger(fallbackFrom) && fallbackFrom > 0 ? fallbackFrom : null,
  });
});

// OBS 啟動頁的實體路徑：面板「拖到 OBS」與「複製路徑」用。只回路徑，不回內容。
router.get('/obs-launcher', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(obsLauncher.describe({ port: req.socket?.localPort }));
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
    if (result.ok) {
      const verification = await ytdlpCompatibility.probeDownload();
      result.downloadVerified = verification.ok === true;
      result.message += result.downloadVerified
        ? '；YouTube 音訊下載驗證通過'
        : '；版本已更新，但 YouTube 音訊下載驗證未通過，請查看相容性狀態';
    }
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
  res.json(await ytdlpCompatibility.probeDownload());
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

module.exports = router;
