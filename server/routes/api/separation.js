/**
 * API 路由：人聲分離（AI／WebGPU）、波形、歌曲段落分析
 * 由 server/routes/api.js 掛載在 /api 底下。
 */
const express = require('express');
const { requireControlAccess } = require('../../middleware/require-control-access');
const router = express.Router();
const { isDirectLoopback } = require('../../utils/direct-loopback');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { dataDir, downloadsDir } = require('../../utils/app-paths');
const fs = require('fs');

const { createLogger } = require('../../utils/logger');
const log = createLogger('API');
const AudioProcessor = require('../../services/audio-processor');
// PIN 存取控制（選用）：只套在會觸發下載/處理的路由，唯讀端點（cover/fonts/health）不套，
// 見 server/middleware/require-pin.js 開頭說明。
const requirePin = require('../../middleware/require-pin');
const aiRuntimeProvider = require('../../services/ai-runtime-provider');
const aiSeparationBundle = require('../../services/ai-separation-bundle');
const aiSeparationJobs = require('../../services/ai-separation-jobs');
const sectionRuntimeProvider = require('../../services/section-runtime-provider');
const sectionAnalysisJobs = require('../../services/section-analysis-jobs');
const { getCachedCudaAvailable } = require('../../services/ai-separation');
const webgpuRuntimeProvider = require('../../services/webgpu-runtime-provider');
const webgpuSeparationJobs = require('../../services/webgpu-separation-jobs');
const webgpuSeparationSettings = require('../../services/webgpu-separation-settings');
const libraryStore = require('../../services/library-store');
const waveformPeaks = require('../../services/waveform-peaks');

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

// 面板端「開啟 AI 分離」時打這支，決定要不要提早預熱 WebGPU 備援：探測到沒有 CUDA
// 就馬上預熱（反正一定要用它，不預熱只是讓使用者乾等冷啟），探測到有 CUDA 就完全
// 不預熱，等真的分離時 CUDA 用不動才臨時暖機（見 ai-separation-jobs.js 的
// requestWebgpuEngineStart）。首次查詢可能啟動 Python，只接受本機或已配對的裝置。
router.get('/ai-separation/cuda-status', requireControlAccess, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ cudaAvailable: await getCachedCudaAvailable() });
  } catch (_) {
    res.json({ cudaAvailable: false });
  }
});

router.post('/ai-separation/bundle/download', requirePin, async (req, res) => {
  try {
    const result = await aiSeparationBundle.downloadBundle();
    res.json(result);
  } catch (err) {
    // 使用者自己按取消不是錯誤，不記 error log、也不回 5xx。
    if (err.code === 'CANCELLED') return res.json({ ok: false, cancelled: true });
    log.error('AI 伴奏完整元件下載失敗', err);
    res.status(502).json({ ok: false, reason: err.message });
  }
});

// 安裝中途取消（feedback #19：pip 安裝 PyTorch 那一步可能跑十幾分鐘，以前沒有任何出口，
// 使用者只能強制關程式）。會中止下載／pip 並清半成品，依鐵則 15 手動掛 requirePin。
router.post('/ai-separation/bundle/cancel', requirePin, (req, res) => {
  const result = aiSeparationBundle.cancelBundle();
  if (!result.ok) return res.status(409).json(result);
  res.json(result);
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
    // 給 shell.js 的閒置逾時看：現在有 WebGPU 分離 job 在跑就別關隱藏視窗，不然會
    // 直接殺掉進行中的那首歌。刻意跟 getDownloadStatus() 的 active（模型下載中）分開
    // 命名，放在 spread 之後不被它蓋掉。
    jobActive: !!webgpuSeparationJobs.getActiveJobId(),
  });
});

// 分離結果的 WAV 檔改用 HTTP multipart 上傳（見 webgpu-separation-jobs.js 的
// finishJobWithResult 註解：一首幾分鐘的歌兩個 WAV 加起來很容易超過 Socket.io
// 的 8MB 封包上限，真機首測就是在送結果時炸掉，誤報成分離失敗）。故意不掛
// requirePin：呼叫者是沒有 PIN 內容的隱藏引擎視窗，授權改用「jobId 對得上目前
// activeJob」這個等同於 socket 版本 payload.jobId 檢查的門檻。
// disk-backed，不用 memoryStorage：合法引擎跑完一首長歌時兩個 WAV 加起來很容易上看
// 1GB，整包讀進記憶體 + 同步寫檔會卡住 event loop（Express/Socket.io/面板/OBS state
// sync 全部一起停），直播中會表現成歌詞疊加層卡死。落在 downloadsDir 底下的 .tmp
// 子目錄（不是系統 temp）——同一個磁碟分割，finishJobWithResult() 才能用 rename
// （原子操作）搬到正式檔名，不用跨磁碟複製。這個子目錄只是暫存區，最終檔案一定會被
// rename 回 downloadsDir 根層（/audio/:filename 只認根層檔名，見下面的路由註解）。
const webgpuTmpDir = path.join(downloadsDir, '.tmp');
function ensureWebgpuTmpDir(cb) {
  fs.mkdir(webgpuTmpDir, { recursive: true }, cb);
}

const webgpuResultStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureWebgpuTmpDir((err) => cb(err, webgpuTmpDir));
  },
  filename: (req, file, cb) => {
    // 這只是暫存識別碼，不是最終檔名——最終檔名由 writeResultFiles() 依 sanitizeStem()
    // 決定（歌名 + jobId 尾碼），瀏覽器端送資料、Node 端決定檔名的分工見該檔開頭註解。
    cb(null, `${req.params.jobId}-${file.fieldname}-${crypto.randomUUID()}.tmp`);
  },
});

const webgpuResultUpload = multer({
  storage: webgpuResultStorage,
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
]), async (req, res) => {
  // finishJobWithResult() 成功時會把這些暫存檔 rename 到 downloadsDir 根層（rename
  // 之後原路徑就不存在了）；不管成功、驗證失敗、還是 activeJob 在上傳期間被 watchdog
  // 逾時／引擎斷線／使用者取消清掉（此時 jobId 對不上、finishJobWithResult 直接回
  // UNKNOWN_JOB、完全不碰檔案），這裡都要補刪暫存檔，才不會在 downloads/.tmp 留孤兒
  // 檔案。unlink 對已經被 rename 走的路徑會是 ENOENT，用 catch 吞掉即可。
  const tempPaths = [req.files?.vocals?.[0]?.path, req.files?.instrumental?.[0]?.path].filter(Boolean);
  try {
    const result = await webgpuSeparationJobs.finishJobWithResult(req.params.jobId, {
      vocalsPath: req.files?.vocals?.[0]?.path,
      instrumentalPath: req.files?.instrumental?.[0]?.path,
      gpuVendor: req.body?.gpuVendor,
      peakBufferMb: req.body?.peakBufferMb ? Number(req.body.peakBufferMb) : undefined,
      realtimeFactor: req.body?.realtimeFactor ? Number(req.body.realtimeFactor) : undefined,
      audioSeconds: req.body?.audioSeconds ? Number(req.body.audioSeconds) : undefined,
    });
    if (!result.ok) return res.status(409).json({ ok: false, error: result.code });
    res.json({ ok: true });
  } finally {
    await Promise.all(tempPaths.map((p) => fs.promises.unlink(p).catch(() => {})));
  }
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

// 直播頁準備區的波形（docs/UIUX-REDESIGN.md §5.1）。第一次會跑 ffmpeg 解碼並寫快取，
// 屬於「會處理檔案」的路由，依鐵則 15 手動掛 requirePin；之後同一個檔案直接讀快取。
router.get('/library/:id/waveform', requirePin, async (req, res) => {
  const entry = libraryStore.getEntry(req.params.id);
  if (!entry || !entry.filename) {
    return res.status(404).json({ ok: false, error: 'NO_AUDIO' });
  }
  try {
    const data = await waveformPeaks.getPeaks(path.join(downloadsDir, path.basename(entry.filename)), {
      cacheDir: path.join(dataDir, 'waveforms'),
      runQueued: (job) => AudioProcessor.runFfmpegQueued(job),
    });
    if (!data) return res.status(422).json({ ok: false, error: 'WAVEFORM_FAILED' });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, rate: data.rate, duration: data.duration, peaks: data.peaks });
  } catch (err) {
    log.warn(`波形讀取失敗 track=${req.params.id}: ${err.message}`);
    res.status(500).json({ ok: false, error: 'WAVEFORM_FAILED' });
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

// ─── 歌曲段落分析（SongFormer，實驗性功能）───
// 定位見 song-section-songformer-primary 這份決策記錄：18 首人工回聽驗證後選定
// SongFormer 為 pre-chorus 分類的主要模型。V1 只有 CUDA、沒有 WebGPU/CPU 降級鏈。

// 只讀進度，前端下載期間輪詢它（同 /ai-separation/runtime-status 的理由）。
router.get('/section-analysis/runtime-status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    available: sectionRuntimeProvider.isAvailable() && sectionRuntimeProvider.isWeightsAvailable(),
    ...sectionRuntimeProvider.getDownloadStatus(),
  });
});

// 觸發真正的網路下載（Python+torch、SongFormer/MuQ/MusicFM 原始碼與權重，約 2.7GB）
// ＋寫入本機檔案，依鐵則 15 必須手動掛 requirePin。
router.post('/section-analysis/runtime/download', requirePin, async (req, res) => {
  // verifyWeights 是非同步串流驗證（只有指紋對不上時才真的算 MD5），不會卡 event loop。
  if (sectionRuntimeProvider.isAvailable() && await sectionRuntimeProvider.verifyWeights()) {
    return res.json({ ok: true, alreadyAvailable: true });
  }
  try {
    await sectionRuntimeProvider.downloadRuntime({});
    res.json({ ok: true, alreadyAvailable: false });
  } catch (err) {
    log.error('歌曲段落分析 runtime 下載失敗', err);
    res.status(502).json({ ok: false, reason: err.message });
  }
});

// 啟動一次段落分析 job。會觸發真正的 GPU 運算，依鐵則 15 必須手動掛 requirePin。
// 只回傳 jobId；實際進度/完成走 Socket.io 的 sections:progress 事件。
router.post('/library/:id/analyze-sections', requirePin, async (req, res) => {
  const trackId = req.params.id;
  const entry = libraryStore.getEntry(trackId);
  if (!entry || !entry.filename) {
    return res.status(404).json({ ok: false, error: '找不到這首歌的音檔' });
  }
  if (entry.sectionsStatus === 'processing') {
    return res.status(409).json({ ok: false, error: 'ALREADY_PROCESSING' });
  }
  if (!sectionRuntimeProvider.isAvailable() || !(await sectionRuntimeProvider.verifyWeights())) {
    return res.status(409).json({ ok: false, error: 'RUNTIME_NOT_READY' });
  }
  try {
    const jobId = await sectionAnalysisJobs.startJobForTrack(trackId, {
      inputPath: path.join(downloadsDir, entry.filename),
    });
    // jobId 為 null 代表已經有另一首在跑，這首排進佇列了（見 section-analysis-jobs.js）
    // ——不是失敗，前端靠 sections:progress 的 stage:'queued' 顯示排隊中。
    res.json({ ok: true, jobId, queued: jobId === null });
  } catch (err) {
    log.error(`啟動歌曲段落分析失敗 track=${trackId}`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 使用者在分析進行中／排隊中按「取消」。掛 requirePin（鐵則 #15）。
router.post('/library/:id/analyze-sections/cancel', requirePin, (req, res) => {
  const result = sectionAnalysisJobs.cancelJobForTrack(req.params.id);
  if (!result.ok) return res.status(404).json({ ok: false, error: 'NO_ACTIVE_ANALYSIS' });
  res.json({ ok: true, state: result.state });
});

module.exports = router;
