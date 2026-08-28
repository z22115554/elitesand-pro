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
  updatedAt: null,
};

function components() {
  return {
    python: aiRuntimeProvider.isAvailable(),
    primaryModel: aiRuntimeProvider.isModelAvailable(),
    webgpu: webgpuRuntimeProvider.isAvailable(),
    cpu: aiRuntimeProvider.isAvailable() && aiRuntimeProvider.isModelAvailable(),
  };
}

function isAvailable() {
  const value = components();
  return value.python && value.primaryModel && value.webgpu;
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
  installStatus = { ...installStatus, ...patch, updatedAt: Date.now() };
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

  installInFlight = (async () => {
    try {
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
          onProgress: (s) => ingestProviderStatus('python', s),
        });
      }

      if (!aiRuntimeProvider.isModelAvailable()) {
        markPhase('primary-model', 'model-download', BANDS['primary-model'][0]);
        await aiRuntimeProvider.downloadPrimaryModel({
          onProgress: (s) => ingestProviderStatus('primary-model', s),
        });
      }

      if (!webgpuRuntimeProvider.isAvailable()) {
        markPhase('webgpu-model', 'model-download', BANDS['webgpu-model'][0]);
        await webgpuRuntimeProvider.downloadModel({
          onProgress: (s) => ingestProviderStatus('webgpu-model', s),
        });
      }

      setStatus({
        active: false, phase: 'done', step: 'done', detail: null,
        downloadedBytes: null, totalBytes: null,
        overallPercent: 100, percent: 100, stage: 'done', error: null,
      });
      return { ok: true, alreadyAvailable: false };
    } catch (error) {
      setStatus({ active: false, phase: 'error', step: 'error', stage: 'error', error: error.message, overallPercent: 0, percent: 0 });
      throw error;
    }
  })();

  try {
    return await installInFlight;
  } finally {
    installInFlight = null;
  }
}

function resetForTests() {
  installInFlight = null;
  installStatus = {
    active: false, phase: 'idle', step: 'idle', detail: null,
    downloadedBytes: null, totalBytes: null, overallPercent: 0,
    stage: 'idle', percent: 0, error: null, updatedAt: null,
  };
}

module.exports = {
  isAvailable,
  getStatus,
  downloadBundle,
  EXPECTED_INSTALLED_BYTES,
  REQUIRED_FREE_BYTES,
  _resetForTests: resetForTests,
};
