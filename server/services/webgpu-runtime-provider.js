/**
 * WebGPU 人聲分離模型按需下載（docs/AI-SEPARATION-PLAN.md §13，musetric 路線）。
 *
 * 形狀照抄 ai-runtime-provider.js（同一套 chunked download／SHA-256 驗證／atomic
 * install／磁碟空間檢查模式）。跟 CUDA 路徑（Python + PyTorch）不同的地方：這裡只有
 * 兩個靜態檔案要下載（ONNX 圖 + 外部權重），沒有 pip 安裝步驟，也不需要解壓縮。
 *
 * 模型來源：`musetric/vocal-separation-roformer-onnx`（MIT），SHA-256 已在
 * §13-2 W0 探針階段驗證過與 model card 公布值一致，這裡直接 pin 死。
 * 不使用 windowed-roformer／wagiri 那組模型——已確認依賴不可控的第三方
 * onnxruntime-web fork，這裡只走已驗證過完整可行性/端到端/壓力測試的 musetric 模型。
 *
 * Hermetic：全部裝在 dataDir/ai-models/webgpu/，跟 CUDA runtime 的
 * dataDir/ai-runtime/ 是同一層原則（Electron 環境下 dataDir 自動指向 userData）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');
const { inspectDiskSpace } = require('./disk-space');
const { fetchToFile } = require('./ai-runtime-provider');

const log = createLogger('WebgpuRuntimeProvider');

const MODEL_DIR = path.join(dataDir, 'ai-models', 'webgpu');
const MARKER_FILE = path.join(MODEL_DIR, '.installed.json');

const GRAPH_FILE = 'syhft_core_folded_fp16_webgpu.onnx';
const WEIGHTS_FILE = 'syhft_core_folded_fp16_webgpu.onnx.data';
// 釘死上游 commit，不可用 `main`：2026-08-29 作者把 core 換成 T=1100 的 query-blocked
// export，順手改了檔名（`syhft_core_t1100.onnx`），`main` 上的舊檔直接消失 → 使用者安裝
// 到最後一步吃 HTTP 404（實機回報）。而且就算檔名沒變也不能跟著 main 走：
// webgpu-separation-worker.mjs 的 FRAMES／輸入張量是 [1, 2050, 1101, 2]，T=1100 的新圖
// 形狀對不上。要升級新模型是一次獨立、要重測的工作，不是讓上游隨時替換我們的模型。
// 這個 revision 的兩個檔案 2026-08-30 重新對過：size 與 X-Linked-ETag 都跟下面 pin 的值一致。
const MODEL_REVISION = '7272c4abd85495c110d161df1083631e8bcd9cdb'; // "Re-tree Split/Concat to <=8-wide"（2026-07-17）
const BASE_URL = `https://huggingface.co/musetric/vocal-separation-roformer-onnx/resolve/${MODEL_REVISION}`;

// 2026-08-18 W0 探針階段下載驗證過：跟 musetric model card 公布值完全一致（檔案大小
// 5,312,568 / 741,190,540 bytes）。SHA-256 是 HuggingFace LFS 的 X-Linked-ETag，
// 2026-08-24 與 2026-08-30 各重新對過一次（8-30 是對釘死的 revision，確認上游換 core 之後舊檔仍在）。
const FILES = [
  { name: GRAPH_FILE, url: `${BASE_URL}/${GRAPH_FILE}`, sha256: 'e22f33a2895f8cc244e28494197a7c77d7a65101d0aa00dbafc626ed16a0cbdb', size: 5312568 },
  { name: WEIGHTS_FILE, url: `${BASE_URL}/${WEIGHTS_FILE}`, sha256: 'b08cfc80905e3560a4dd5d30f641299a47dd96d309ebbe9524d9d6c9d2a0356f', size: 741190540 },
];

// 兩個檔案合計 ~746MB，保守抓 1.5GB 餘裕（下載到暫存檔＋正式檔一度並存）。
const REQUIRED_DISK_BYTES = 1.5 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 900 * 1024 * 1024; // 上游檔案若變得比 model card 大很多，視為異常直接拒絕

function isAvailable() {
  try {
    if (!fs.existsSync(MARKER_FILE)) return false;
    if (!FILES.every((f) => fs.existsSync(path.join(MODEL_DIR, f.name)))) return false;
    const marker = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8'));
    return marker.installDone === true;
  } catch (_) {
    return false;
  }
}

function modelPaths() {
  return {
    graphPath: path.join(MODEL_DIR, GRAPH_FILE),
    weightsPath: path.join(MODEL_DIR, WEIGHTS_FILE),
  };
}

// 同款「rmSync 對含中文字元路徑會卡死」的既有踩坑（見 ai-runtime-provider.js），
// 這裡沿用同一個安全刪除寫法。
function safeRemove(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) fs.rmdirSync(targetPath, { recursive: true });
    else fs.unlinkSync(targetPath);
  } catch (_) { /* 本來就不存在或刪除失敗都當作 best effort，忽略 */ }
}

let downloadInFlight = null;
let downloadStatus = { active: false, stage: 'idle', percent: null, error: null, updatedAt: null };

function setDownloadStatus(patch) {
  downloadStatus = { ...downloadStatus, ...patch, updatedAt: Date.now() };
}
function getDownloadStatus() {
  return { ...downloadStatus };
}

/**
 * 下載並安裝 WebGPU 分離模型。SHA-256 不符、磁碟不足、斷網、中途取消都在這裡處理，
 * 全部丟出可讀訊息、不留半成品目錄。
 */
async function downloadModel({
  onProgress,
  fetchFileImpl = fetchToFile,
  inspectDiskSpaceImpl = inspectDiskSpace,
  abortSignal,
} = {}) {
  if (downloadInFlight) return downloadInFlight;

  downloadInFlight = (async () => {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    let stage = 'start';
    const progress = (nextStage, extra = {}) => {
      stage = nextStage;
      setDownloadStatus({ active: nextStage !== 'done', stage: nextStage, error: null, ...extra });
      log.info(`WebGPU 模型安裝階段：${nextStage}`);
      onProgress?.(getDownloadStatus());
    };

    try {
      progress('disk-space-check');
      const disk = inspectDiskSpaceImpl(MODEL_DIR, { thresholdBytes: REQUIRED_DISK_BYTES });
      if (disk.known && disk.low) {
        throw new Error(`磁碟空間不足：需要約 ${Math.round(REQUIRED_DISK_BYTES / 1024 / 1024 / 1024 * 10) / 10}GB，目前可用約 ${Math.round(disk.freeBytes / 1024 / 1024)}MB。請清出空間後再試一次。`);
      }

      for (let i = 0; i < FILES.length; i++) {
        const file = FILES[i];
        const tmpPath = path.join(MODEL_DIR, `${file.name}.download`);
        const finalPath = path.join(MODEL_DIR, file.name);
        safeRemove(tmpPath);

        progress('download-model', { fileIndex: i, fileCount: FILES.length, downloadedBytes: 0, totalBytes: file.size, percent: 0 });
        const result = await fetchFileImpl(file.url, tmpPath, {
          maxBytes: MAX_FILE_BYTES,
          abortSignal,
          onProgress: (p) => {
            setDownloadStatus({ active: true, stage: 'download-model', fileIndex: i, fileCount: FILES.length, ...p, error: null });
            onProgress?.(getDownloadStatus());
          },
        });

        progress('verify-model', { fileIndex: i, fileCount: FILES.length });
        if (file.sha256 && result.sha256 !== file.sha256) {
          throw new Error(`${file.name} 的 SHA-256 驗證失敗（預期 ${file.sha256.slice(0, 12)}…，實際 ${result.sha256.slice(0, 12)}…），已拒絕使用此檔案`);
        }

        safeRemove(finalPath);
        fs.renameSync(tmpPath, finalPath);
      }

      fs.writeFileSync(MARKER_FILE, JSON.stringify({
        installDone: true,
        installedAt: new Date().toISOString(),
      }, null, 2), 'utf8');

      progress('done', { active: false, percent: 100 });
      log.info(`WebGPU 模型安裝完成：${MODEL_DIR}`);
      return { ok: true, ...modelPaths() };
    } catch (err) {
      err.stage = err.stage || stage;
      setDownloadStatus({ active: false, stage: 'error', error: err.message });
      log.error(`WebGPU 模型安裝失敗（stage=${err.stage}）`, err);
      throw err;
    }
  })();

  try {
    return await downloadInFlight;
  } finally {
    downloadInFlight = null;
  }
}

function resetForTests() {
  downloadInFlight = null;
  downloadStatus = { active: false, stage: 'idle', percent: null, error: null, updatedAt: null };
}

module.exports = {
  isAvailable,
  downloadModel,
  getDownloadStatus,
  modelPaths,
  MODEL_DIR,
  MARKER_FILE,
  FILES,
  MODEL_REVISION,
  REQUIRED_DISK_BYTES,
  _resetForTests: resetForTests,
};
