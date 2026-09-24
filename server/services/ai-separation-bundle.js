'use strict';

/**
 * AI 伴奏製作的單一安裝狀態。
 *
 * 對使用者只有一個功能；Python/CUDA、WebGPU 與 CPU 是內部的依序備援，不是三個
 * 可以各自安裝的產品選項。第一次啟用會把三條路徑需要的資源一次準備好：
 * Python runtime + Kim 主模型 + WebGPU ONNX 模型。CPU 與 Python GPU 共用前兩者，
 * 不需要再下載第三份模型。
 *
 * 進度：三個 provider 各自吐細階段（下載/驗證/解壓/安裝套件/下載模型 + 位元組），
 * 這裡按實測安裝體積把它們攤平成一條 0–100 的 overallPercent，並保留 phase/step/detail
 * /位元組欄位讓前端顯示「現在在做什麼、大概多少」。
 */
const aiRuntimeProvider = require('./ai-runtime-provider');
const webgpuRuntimeProvider = require('./webgpu-runtime-provider');
const { createLogger } = require('../utils/logger');
const { inspectDiskSpace } = require('./disk-space');
const { dataDir } = require('../utils/app-paths');
const ffmpegProvider = require('./ffmpeg-provider');

const log = createLogger('AISeparationBundle');

// 依目前釘死版本在乾淨安裝實測：runtime 5.20 GiB、Kim 0.85 GiB、WebGPU 0.70 GiB，
// 合計 6.75 GiB。UI 以十進位顯示約 7.3 GB；安裝過程會同時存在下載暫存檔，保守要求 9 GB。
const EXPECTED_INSTALLED_BYTES = 7_243_705_519;
const REQUIRED_FREE_BYTES = 9 * 1024 * 1024 * 1024;

// overallPercent 的相位帶（依實測體積：python 佔絕大多數）
const BANDS = {
  python: [0, 77],
  'primary-model': [77, 90],
  'webgpu-model': [90, 100],
};

let installInFlight = null;
let installAbort = null; // 目前這輪安裝的 AbortController；cancelBundle() 用它中止
let installStatus = {
  active: false,
  phase: 'idle',
  step: 'idle',
  detail: null,
  downloadedBytes: null,
  totalBytes: null,
  overallPercent: 0,
  stage: 'idle', // 粗字串，保留給日誌／舊前端
  percent: 0, // = overallPercent，保留欄名相容
  error: null,
  webgpuUnavailable: null, // WebGPU 備援模型這次沒裝成的原因（不影響 available）
  // 目前這個 step 從什麼時候開始（伺服器時間）。pip 安裝 PyTorch 那一步沒有任何進度訊號，
  // 前端用它顯示「已經過多久」，而不是讓使用者對著不動的百分比猜是不是當機（feedback #19）。
  stepStartedAt: null,
  cancelling: false,
  updatedAt: null,
};

function components() {
  return {
    // 這裡刻意用「解析得到路徑」這種存在性檢查（跟其他三項同級），不用 isAvailable()：
    // 安裝進度每 500ms 就輪詢一次 getStatus()，而 isAvailable() 每次都會 spawn
    // ffmpeg -version + ffprobe -version。真正要求「能執行」的完整驗證留在
    // downloadBundle() 的前置關卡，那裡一輪只跑一次。
    ffmpeg: !!ffmpegProvider.resolveFfmpegPaths(),
    python: aiRuntimeProvider.isAvailable(),
    primaryModel: aiRuntimeProvider.isModelAvailable(),
    webgpu: webgpuRuntimeProvider.isAvailable(),
    cpu: aiRuntimeProvider.isAvailable() && aiRuntimeProvider.isModelAvailable(),
  };
}

function isAvailable() {
  const value = components();
  // ffmpeg 也算在內：三條引擎的 Python 端（audio-separator）在 Separator() 建構子就會
  // 檢查它，缺了它「元件齊全」是假的——會一路放行到分離途中才炸。
  // 但 WebGPU 模型刻意**不**算在內：它是備援的備援（Python GPU → WebGPU → CPU），
  // Python GPU 與 CPU 都不需要它。2026-08-30 上游把模型換掉害下載 404 時，把它列進
  // 這個條件讓「Python 引擎與 870MB 主模型都已就緒」的機器一首歌都不能分離——
  // 少一條備援路不該等於整個功能停擺。
  return value.ffmpeg && value.python && value.primaryModel;
}

function lerp(band, fraction) {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return Math.round(band[0] + (band[1] - band[0]) * f);
}

// 把某個 provider 的細狀態換算成 0–1 的「相位內完成度」
function phaseFraction(phase, s) {
  const bytesFrac = (s.totalBytes && s.downloadedBytes != null)
    ? s.downloadedBytes / s.totalBytes
    : null;

  if (phase === 'python') {
    switch (s.stage) {
      case 'disk-space-check': return 0.005;
      case 'download-python': case 'verify-python': return 0.01;
      case 'extract': case 'bootstrap-pip': return 0.03;
      case 'install-packages':
        if (s.step === 'pip-resolve') return 0.04;
        if (s.step === 'pip-download') return 0.05 + 0.72 * (bytesFrac ?? 0);
        if (s.step === 'pip-install') return 0.8; // 解壓無位元組訊號，前端會在此段做輕微 creep
        return 0.05;
      case 'install': return 0.97;
      case 'done': return 1;
      default: return 0.01;
    }
  }
  if (phase === 'primary-model') {
    if (s.stage === 'done') return 1;
    return bytesFrac ?? 0.05;
  }
  if (phase === 'webgpu-model') {
    if (s.stage === 'done') return 1;
    const count = Number(s.fileCount) || 1;
    const idx = Number(s.fileIndex) || 0;
    return (idx + (bytesFrac ?? 0)) / count;
  }
  return 0;
}

function setStatus(patch) {
  const now = Date.now();
  const stepChanged = Object.prototype.hasOwnProperty.call(patch, 'step') && patch.step !== installStatus.step;
  installStatus = {
    ...installStatus,
    ...patch,
    stepStartedAt: stepChanged ? now : installStatus.stepStartedAt,
    updatedAt: now,
  };
}

// provider 每次 onProgress 回來就重算一次面向前端的狀態
function ingestProviderStatus(phase, s) {
  const frac = phaseFraction(phase, s);
  const overall = lerp(BANDS[phase] || [0, 100], frac);
  setStatus({
    active: s.stage !== 'done',
    phase,
    step: s.step || s.stage || phase,
    detail: s.detail || null,
    downloadedBytes: s.step === 'pip-install' ? null : (s.downloadedBytes ?? null),
    totalBytes: s.step === 'pip-install' ? null : (s.totalBytes ?? null),
    fileIndex: Number.isFinite(s.fileIndex) ? s.fileIndex : null,
    fileCount: Number.isFinite(s.fileCount) ? s.fileCount : null,
    overallPercent: overall,
    percent: overall,
    stage: `${phase}:${s.step || s.stage || ''}`,
    error: null,
  });
}

function getStatus() {
  return {
    available: isAvailable(),
    components: components(),
    expectedInstalledBytes: EXPECTED_INSTALLED_BYTES,
    requiredFreeBytes: REQUIRED_FREE_BYTES,
    ...installStatus,
    // 前端用伺服器自己的時鐘算經過時間，不受瀏覽器（例如手機）時鐘誤差影響。
    serverNow: Date.now(),
  };
}

function markPhase(phase, step, overall) {
  setStatus({
    active: true, phase, step, detail: null,
    downloadedBytes: null, totalBytes: null,
    overallPercent: overall, percent: overall,
    stage: `${phase}:${step}`, error: null,
  });
  log.info(`AI 伴奏元件安裝：${phase}/${step} (${overall}%)`);
}

async function downloadBundle() {
  if (installInFlight) return installInFlight;
  if (isAvailable()) return { ok: true, alreadyAvailable: true };

  installAbort = new AbortController();
  const abortSignal = installAbort.signal;
  setStatus({ cancelling: false });

  installInFlight = (async () => {
    try {
      // FFmpeg 先擋在門口：Python 引擎的 audio-separator 在 Separator() 建構子就會檢查
      // ffmpeg，沒有的話連「只下載模型」都會失敗。與其讓使用者跑完 5GB 下載才吃一段
      // Python traceback，不如一秒內講清楚要先做什麼。
      if (!ffmpegProvider.isAvailable()) {
        throw new Error('AI 伴奏製作需要 FFmpeg。請先到設定裡下載 FFmpeg，再回來啟用這個功能。');
      }

      setStatus({ webgpuUnavailable: null });
      const before = components();
      const requiredNow = !before.python
        ? REQUIRED_FREE_BYTES
        : (!before.primaryModel && !before.webgpu ? 3 * 1024 * 1024 * 1024
          : (!before.primaryModel ? 2 * 1024 * 1024 * 1024 : 1.5 * 1024 * 1024 * 1024));
      const disk = inspectDiskSpace(dataDir, { thresholdBytes: requiredNow });
      if (disk.known && disk.low) {
        throw new Error(`磁碟空間不足：目前安裝階段需要至少 ${Math.ceil(requiredNow / 1024 / 1024 / 1024)} GB 可用空間。`);
      }

      if (!aiRuntimeProvider.isAvailable()) {
        markPhase('python', 'disk-check', 0);
        await aiRuntimeProvider.downloadRuntime({
          abortSignal,
          onProgress: (s) => ingestProviderStatus('python', s),
        });
      }

      if (!aiRuntimeProvider.isModelAvailable()) {
        markPhase('primary-model', 'model-download', BANDS['primary-model'][0]);
        await aiRuntimeProvider.downloadPrimaryModel({
          abortSignal,
          onProgress: (s) => ingestProviderStatus('primary-model', s),
        });
      }

      let webgpuUnavailable = null;
      if (!webgpuRuntimeProvider.isAvailable()) {
        markPhase('webgpu-model', 'model-download', BANDS['webgpu-model'][0]);
        try {
          await webgpuRuntimeProvider.downloadModel({
            abortSignal,
            onProgress: (s) => ingestProviderStatus('webgpu-model', s),
          });
        } catch (error) {
          // 使用者取消不是「備援模型下載失敗」，要讓整輪安裝以取消收尾。
          if (error.code === 'CANCELLED' || abortSignal.aborted) throw error;
          // 這一段失敗不擋安裝（見 isAvailable 的說明）。使用者之後可以用
          // /api/webgpu-separation/runtime/download 重試，或下次打開開關時自動補。
          webgpuUnavailable = error.message;
          log.warn(`WebGPU 備援模型未能下載，其餘元件照常完成：${error.message}`);
        }
      }

      setStatus({
        active: false, phase: 'done', step: 'done', detail: null,
        downloadedBytes: null, totalBytes: null,
        overallPercent: 100, percent: 100, stage: 'done', error: null,
        webgpuUnavailable,
      });
      return { ok: true, alreadyAvailable: false };
    } catch (error) {
      if (error.code === 'CANCELLED' || abortSignal.aborted) {
        // 已完成的元件（例如 Python 已裝好、只有模型被取消）會保留，下次從缺的那一段繼續；
        // 被中斷的那一段由各 provider 自己清掉半成品。
        setStatus({
          active: false, phase: 'cancelled', step: 'cancelled', stage: 'cancelled', error: null,
          detail: null, downloadedBytes: null, totalBytes: null, overallPercent: 0, percent: 0, cancelling: false,
        });
        log.info('AI 伴奏元件安裝已由使用者取消');
        throw Object.assign(error, { code: 'CANCELLED' });
      }
      setStatus({ active: false, phase: 'error', step: 'error', stage: 'error', error: error.message, overallPercent: 0, percent: 0, cancelling: false });
      throw error;
    }
  })();

  try {
    return await installInFlight;
  } finally {
    installInFlight = null;
    installAbort = null;
  }
}

/**
 * 使用者在安裝視窗按「取消安裝」。只送出中止訊號，實際收尾（殺掉 pip、清暫存檔、狀態改成
 * cancelled）由 downloadBundle() 的 catch 完成；前端輪詢看到 stage:'cancelled' 就收掉視窗。
 */
function cancelBundle() {
  if (!installInFlight || !installAbort) return { ok: false, reason: 'not-running' };
  if (!installAbort.signal.aborted) {
    log.info('收到取消 AI 伴奏元件安裝的要求');
    setStatus({ cancelling: true });
    installAbort.abort();
  }
  return { ok: true };
}

function resetForTests() {
  installInFlight = null;
  installStatus = {
    active: false, phase: 'idle', step: 'idle', detail: null,
    downloadedBytes: null, totalBytes: null, overallPercent: 0,
    stage: 'idle', percent: 0, error: null, webgpuUnavailable: null, stepStartedAt: null, cancelling: false, updatedAt: null,
  };
  installAbort = null;
}

module.exports = {
  isAvailable,
  getStatus,
  downloadBundle,
  cancelBundle,
  EXPECTED_INSTALLED_BYTES,
  REQUIRED_FREE_BYTES,
  _resetForTests: resetForTests,
};
