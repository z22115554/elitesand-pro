/**
 * 歌曲段落分析（SongFormer）runtime 按需下載。
 *
 * 形狀照抄 ai-runtime-provider.js（AI 人聲分離的同一套模式，見該檔開頭說明）：
 * 不預裝在 installer 裡，使用者按下「分析段落」才下載；沒下載不影響其他功能。
 * 通用的下載/解壓/驗證原語（fetchToFile／safeExtractAll／enableSitePackages／
 * runPythonStep／parseToolProgress）直接重用 ai-runtime-provider.js 匯出的版本
 * ——這幾個是純函式、不吃 AI 分離的任何私有狀態，兩邊各自維護一份反而只會製造
 * 「兩份 zip-slip 防護要一起修」的風險。真正屬於這個功能自己的東西（要裝哪些
 * pip 套件、要下載哪些模型檔、裝到哪個目錄）留在這支檔案，不跟 AI 分離共用。
 *
 * V1 刻意讓這個功能有自己獨立的 Python 環境（dataDir/section-runtime/），不嘗試
 * 偵測並共用 AI 分離那份已安裝的 Python+torch（雖然版本剛好一樣，共用可以省
 * ~2.5GB 下載）——避免兩個功能的套件版本被綁死在一起、除錯時分不清是哪邊的環境
 * 出的問題。這是刻意的簡化，不是沒想到，未來如果重複下載造成使用者困擾，
 * 值得再評估共用。
 *
 * 下載對象三段：
 * 1. Python embeddable——跟 ai-runtime-provider.js 同一個版本/雜湊，直接重用它
 *    匯出的 PYTHON_EMBED_URL/PYTHON_EMBED_SHA256，不重新下載驗證一次相同的東西。
 * 2. SongFormer／MuQ／MusicFM 原始碼——不 vendor 進這個 git repo（比照 audio-separator
 *    不 vendor 進 repo、執行期 pip 裝的做法），改成從 GitHub 下載三個 pin 死 commit
 *    的原始碼壓縮檔（SongFormer 本身 + 它的兩個 git submodule MuQ/musicfm，
 *    GitHub 的 archive 端點不會遞迴打包 submodule 內容，所以拆成三個檔案各自下載）。
 *    三個壓縮檔的 SHA-256 已經自己下載驗證過一次、直接釘死在下面常數。
 * 3. 模型權重——MuQ 骨幹透過 huggingface_hub 的 MuQ.from_pretrained() 下載（沿用它
 *    自己的完整性驗證，同 ai-runtime-provider.js 對 pip wheel 雜湊的態度：不重造
 *    輪子）；MusicFM 骨幹＋SongFormer 自己的權重呼叫 SongFormer 官方
 *    utils/fetch_pretrained.py 的 download_all()（URL 已經寫在那支官方腳本裡，
 *    不需要自己在 JS 這邊維護一份），下載後對照官方 ckpts/md5sum.txt 公布的 MD5
 *    （已釘死在下面常數）逐一驗證。
 *
 * Hermetic：全部裝在 dataDir/section-runtime/，跟 ai-runtime-provider.js 一樣不動
 * machine-wide PATH／PYTHONPATH。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');
const { inspectDiskSpace } = require('./disk-space');
const { safeRemove } = require('../utils/safe-remove');
const {
  fetchToFile,
  safeExtractAll,
  enableSitePackages,
  runPythonStep,
  parseToolProgress,
  PYTHON_EMBED_URL,
  PYTHON_EMBED_SHA256,
} = require('./ai-runtime-provider');

const log = createLogger('SectionRuntimeProvider');

const RUNTIME_DIR = path.join(dataDir, 'section-runtime');
const PYTHON_DIR = path.join(RUNTIME_DIR, 'python');
const PYTHON_EXE = path.join(PYTHON_DIR, 'python.exe');
const MARKER_FILE = path.join(RUNTIME_DIR, '.installed.json');
const SONGFORMER_DIR = path.join(RUNTIME_DIR, 'SongFormer');
// section_worker.py 讀這個環境變數對應的快取位置，不用系統預設 ~/.cache
// （打包版裡那個位置不可控，uninstall 也不會清掉）。
const HF_HOME = path.join(RUNTIME_DIR, 'cache', 'huggingface');
const TORCH_HOME = path.join(RUNTIME_DIR, 'cache', 'torch');

const PYTHON_EMBED_VERSION = '3.11.9'; // 跟 ai-runtime-provider.js 用同一版，兩邊各自的 marker 各自記自己的
const PIP_PACKAGES = [
  'torch==2.6.0', 'torchaudio==2.6.0', // 跟 POC 驗證過的版本一致
  'transformers', 'omegaconf', 'ema-pytorch', 'einops', 'einx',
  'huggingface-hub', 'safetensors', 'librosa', 'jams', 'requests', 'tqdm',
];
const PIP_EXTRA_INDEX_URL = 'https://download.pytorch.org/whl/cu124';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

// Python embeddable + 完整 torch cu124 環境，比照 ai-runtime-provider.js 估計。
const REQUIRED_DISK_BYTES = 6 * 1024 * 1024 * 1024;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

// 三個原始碼壓縮檔：2026-09-21 自己下載一次驗過，SHA-256 釘死在這裡，之後每次
// 下載都驗證這個值，不再信任 GitHub 當下回應了什麼（跟 PYTHON_EMBED_SHA256 同一套邏輯）。
const SOURCE_ARCHIVES = [
  {
    name: 'SongFormer',
    commit: '139b2aa3b14bd1c6d961d0994e9fc975f1ef7fd5',
    url: 'https://github.com/ASLP-lab/SongFormer/archive/139b2aa3b14bd1c6d961d0994e9fc975f1ef7fd5.zip',
    sha256: '4ccc8bb9c742f8c8ec7730c2b20c6324927861d5677df7c9a3eb9517bdc34374',
    destRelative: '.', // 解到 RUNTIME_DIR/SongFormer 本身
  },
  {
    name: 'MuQ',
    commit: '28847ea50cd31ac4b8b6a7dacc051ad7d1c7606a',
    url: 'https://github.com/tencent-ailab/MuQ/archive/28847ea50cd31ac4b8b6a7dacc051ad7d1c7606a.zip',
    sha256: '9d8a9da8c030ae3d8be4b40853ab317fb8071dccd3cc6c183dc1bd8fdf6d0300',
    destRelative: path.join('src', 'third_party', 'MuQ'), // SongFormer 的 git submodule，archive 端點不含 submodule 內容，分開下載
  },
  {
    name: 'musicfm',
    commit: 'b83ebedb401bcef639b26b05c0c8bee1dc2dfe71',
    url: 'https://github.com/minzwon/musicfm/archive/b83ebedb401bcef639b26b05c0c8bee1dc2dfe71.zip',
    sha256: 'fdc7e914dea3faca0062c786cd55f75e51212267ec2e27116f96d68f0c22c094',
    destRelative: path.join('src', 'third_party', 'musicfm'), // 同上，另一個 submodule
  },
];

// SongFormer 官方 ckpts/md5sum.txt 公布的權重雜湊，釘死在這裡（跟壓縮檔一樣不信任
// 下載當下的回應）。下載邏輯呼叫官方 download_all()，這裡只負責驗證結果。
const WEIGHT_MD5 = {
  [path.join('ckpts', 'MusicFM', 'pretrained_msd.pt')]: 'df930aceac8209818556c4a656a0714c',
  [path.join('ckpts', 'MusicFM', 'msd_stats.json')]: '75ab2e47b093e07378f7f703bdb82c14',
  [path.join('ckpts', 'SongFormer.safetensors')]: '5a24800e12ab357744f8b47e523ba3e6',
};

function isAvailable() {
  try {
    if (!fs.existsSync(PYTHON_EXE) || !fs.existsSync(MARKER_FILE)) return false;
    const marker = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8'));
    return marker.pythonEmbedVersion === PYTHON_EMBED_VERSION
      && marker.pipInstallDone === true
      && marker.sourceReady === true;
  } catch (_) {
    return false;
  }
}

function fileMd5(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function isWeightsAvailable() {
  try {
    return Object.entries(WEIGHT_MD5).every(([rel, expected]) => {
      const full = path.join(SONGFORMER_DIR, 'src', 'SongFormer', rel);
      return fs.existsSync(full) && fileMd5(full) === expected;
    });
  } catch (_) {
    return false;
  }
}

let downloadInFlight = null;
let downloadStatus = { active: false, stage: 'idle', percent: null, error: null, updatedAt: null };

function setDownloadStatus(patch) {
  downloadStatus = { ...downloadStatus, ...patch, updatedAt: Date.now() };
}
function getDownloadStatus() {
  return { ...downloadStatus };
}

async function downloadAndExtractSource(archive, { onProgress } = {}) {
  const tmpZip = path.join(RUNTIME_DIR, `${archive.name}.download.zip`);
  safeRemove(tmpZip);
  const result = await fetchToFile(archive.url, tmpZip, {
    onProgress: (p) => onProgress?.({ ...p, detail: archive.name }),
  });
  if (result.sha256 !== archive.sha256) {
    safeRemove(tmpZip);
    throw new Error(`${archive.name} 原始碼壓縮檔 SHA-256 驗證失敗（預期 ${archive.sha256.slice(0, 12)}…，實際 ${result.sha256.slice(0, 12)}…），已拒絕使用`);
  }
  const zip = new AdmZip(tmpZip);
  const entries = zip.getEntries();
  const topDir = entries.length ? entries[0].entryName.split('/')[0] : null;
  if (!topDir || !topDir.startsWith(`${archive.name}-`)) {
    safeRemove(tmpZip);
    throw new Error(`${archive.name} 壓縮檔結構跟預期不符（找不到 ${archive.name}-<commit>/ 這個頂層資料夾）`);
  }
  const extractRoot = path.join(RUNTIME_DIR, `${archive.name}.extract`);
  safeRemove(extractRoot);
  safeExtractAll(zip, extractRoot);
  safeRemove(tmpZip);

  const dest = archive.destRelative === '.' ? SONGFORMER_DIR : path.join(SONGFORMER_DIR, archive.destRelative);
  safeRemove(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(path.join(extractRoot, topDir), dest);
  safeRemove(extractRoot);
}

/**
 * 下載並安裝歌曲段落分析 runtime：Python embeddable → SongFormer/MuQ/musicfm
 * 原始碼 → pip 套件 → MuQ 骨幹（huggingface_hub）→ MusicFM/SongFormer 權重
 * （官方 download_all()，MD5 逐一驗證）。任何一步失敗都不留半成品：Python 走
 * 「先裝到 .download、成功才 rename」，權重下載失敗時官方 download() 函式本身
 * 就是「檔案已存在就跳過」，所以我們在驗證失敗時要主動刪除半成品，不然重跑
 * 會被官方函式誤判成「已經下載過」而跳過。
 */
async function downloadRuntime({ onProgress, abortSignal, platform = process.platform } = {}) {
  if (platform !== 'win32') throw new Error('目前只支援 Windows 的自動下載。');
  if (downloadInFlight) return downloadInFlight;

  downloadInFlight = (async () => {
    const tmpPythonDir = path.join(RUNTIME_DIR, 'python.download');
    let stage = 'start';
    const progress = (nextStage, extra = {}) => {
      stage = nextStage;
      setDownloadStatus({ active: nextStage !== 'done', stage: nextStage, error: null, ...extra });
      log.info(`歌曲段落分析 runtime 安裝階段：${nextStage}`);
      onProgress?.(getDownloadStatus());
    };

    try {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      fs.mkdirSync(HF_HOME, { recursive: true });
      fs.mkdirSync(TORCH_HOME, { recursive: true });
      safeRemove(tmpPythonDir);

      progress('disk-space-check');
      const disk = inspectDiskSpace(RUNTIME_DIR, { thresholdBytes: REQUIRED_DISK_BYTES });
      if (disk.known && disk.low) {
        throw new Error(`磁碟空間不足：需要約 ${Math.round(REQUIRED_DISK_BYTES / 1024 / 1024 / 1024)}GB，目前可用約 ${Math.round(disk.freeBytes / 1024 / 1024)}MB。請清出空間後再試一次。`);
      }

      progress('download-python', { downloadedBytes: 0, totalBytes: null, percent: 0 });
      const tmpZip = path.join(RUNTIME_DIR, 'python-embed.download.zip');
      safeRemove(tmpZip);
      const pyResult = await fetchToFile(PYTHON_EMBED_URL, tmpZip, {
        maxBytes: MAX_ZIP_BYTES,
        abortSignal,
        onProgress: (p) => { setDownloadStatus({ active: true, stage: 'download-python', ...p, error: null }); onProgress?.(getDownloadStatus()); },
      });
      if (pyResult.sha256 !== PYTHON_EMBED_SHA256) {
        throw new Error(`Python embeddable SHA-256 驗證失敗，已拒絕使用此檔案`);
      }
      progress('extract-python');
      const pyZip = new AdmZip(tmpZip);
      safeExtractAll(pyZip, tmpPythonDir);
      enableSitePackages(tmpPythonDir);
      safeRemove(tmpZip);

      progress('bootstrap-pip');
      const { fetchToBuffer } = require('./ai-runtime-provider');
      const getPipBuf = await fetchToBuffer(GET_PIP_URL, { maxBytes: 5 * 1024 * 1024 });
      fs.writeFileSync(path.join(tmpPythonDir, 'get-pip.py'), getPipBuf);
      const tmpPythonExe = path.join(tmpPythonDir, 'python.exe');
      await runPythonStep(['get-pip.py', '--no-warn-script-location'], { cwd: tmpPythonDir, pythonExe: tmpPythonExe });

      progress('install-packages', { step: 'pip-resolve', detail: null, downloadedBytes: 0, totalBytes: null, percent: null });
      await runPythonStep(
        ['-m', 'pip', 'install', '--progress-bar', 'on', '--no-warn-script-location', '--extra-index-url', PIP_EXTRA_INDEX_URL, ...PIP_PACKAGES],
        {
          cwd: tmpPythonDir,
          pythonExe: tmpPythonExe,
          timeoutMs: 30 * 60 * 1000,
          onOutput: (text) => {
            const p = parseToolProgress(text);
            if (Object.keys(p).length) {
              setDownloadStatus({ active: true, stage: 'install-packages', error: null, ...p });
              onProgress?.(getDownloadStatus());
            }
          },
        },
      );

      progress('download-source', { detail: null, downloadedBytes: 0, totalBytes: null, percent: null });
      for (const archive of SOURCE_ARCHIVES) {
        await downloadAndExtractSource(archive, {
          onProgress: (p) => { setDownloadStatus({ active: true, stage: 'download-source', error: null, ...p }); onProgress?.(getDownloadStatus()); },
        });
      }

      progress('install-python');
      safeRemove(PYTHON_DIR);
      fs.renameSync(tmpPythonDir, PYTHON_DIR);

      progress('install-muq-package', { step: 'pip-install', detail: 'muq', downloadedBytes: null, totalBytes: null, percent: null });
      // 2026-09-22 實機踩到的坑：`muq` 不是像 musicfm 那樣單純加 third_party 到 PYTHONPATH
      // 就能 import 的扁平模組——它自己有 setup.py（package_dir 指到 src/muq），必須真的
      // pip install 這個本機路徑才會出現在 site-packages。musicfm 沒有 setup.py，維持用
      // section_worker.py 的 PYTHONPATH 插入即可，不用在這裡另外裝。這一步順便會裝好
      // muq 自己宣告的相依（einops/librosa/nnAudio/easydict/x_clip 等），不用在
      // PIP_PACKAGES 手動重複列一份。
      await runPythonStep(
        ['-m', 'pip', 'install', '--no-warn-script-location', '--extra-index-url', PIP_EXTRA_INDEX_URL, path.join(SONGFORMER_DIR, 'src', 'third_party', 'MuQ')],
        {
          cwd: RUNTIME_DIR,
          pythonExe: PYTHON_EXE,
          timeoutMs: 15 * 60 * 1000,
          onOutput: (text) => {
            const p = parseToolProgress(text);
            if (Object.keys(p).length) {
              setDownloadStatus({ active: true, stage: 'install-muq-package', error: null, ...p });
              onProgress?.(getDownloadStatus());
            }
          },
        },
      );

      progress('download-muq-backbone');
      // MuQ.from_pretrained() 走 huggingface_hub 自己的下載+完整性驗證，這裡不重造
      // 輪子（跟 ai-runtime-provider.js 對 pip wheel 雜湊的態度一樣）。用一個小 Python
      // 步驟觸發，讓它把 1.3GB 骨幹快取進我們自己管理的 HF_HOME。
      await runPythonStep(
        ['-c', 'from muq import MuQ; MuQ.from_pretrained("OpenMuQ/MuQ-large-msd-iter")'],
        {
          cwd: path.join(SONGFORMER_DIR, 'src', 'SongFormer'),
          pythonExe: PYTHON_EXE,
          timeoutMs: 30 * 60 * 1000,
          env: { HF_HOME, TORCH_HOME, HF_HUB_DISABLE_TELEMETRY: '1', PYTHONPATH: path.join(SONGFORMER_DIR, 'src', 'third_party') },
          onOutput: (text) => {
            const p = parseToolProgress(text);
            if (Object.keys(p).length) {
              setDownloadStatus({ active: true, stage: 'download-muq-backbone', error: null, ...p });
              onProgress?.(getDownloadStatus());
            }
          },
        },
      );

      progress('download-weights', { detail: null, downloadedBytes: 0, totalBytes: null, percent: null });
      // 官方 download_all()：URL 已經寫在 SongFormer 自己的 utils/fetch_pretrained.py，
      // 不在這裡重複維護一份；它「檔案已存在就跳過」，所以驗證失敗時要主動清掉半成品
      // 檔案，下一次重跑才會真的重新下載，不會被誤判成「已經有了」。
      await runPythonStep(
        ['-c', 'import sys; sys.path.insert(0, "."); from utils.fetch_pretrained import download_all; download_all()'],
        {
          cwd: path.join(SONGFORMER_DIR, 'src', 'SongFormer'),
          pythonExe: PYTHON_EXE,
          timeoutMs: 30 * 60 * 1000,
          onOutput: (text) => {
            const p = parseToolProgress(text);
            if (Object.keys(p).length) {
              setDownloadStatus({ active: true, stage: 'download-weights', error: null, ...p });
              onProgress?.(getDownloadStatus());
            }
          },
        },
      );

      progress('verify-weights');
      for (const [rel, expected] of Object.entries(WEIGHT_MD5)) {
        const full = path.join(SONGFORMER_DIR, 'src', 'SongFormer', rel);
        if (!fs.existsSync(full) || fileMd5(full) !== expected) {
          safeRemove(full); // 讓官方 download() 下次重跑時真的重下，而不是誤判已存在
          throw new Error(`權重檔驗證失敗：${rel}（MD5 對不上官方公布值，已刪除半成品）`);
        }
      }

      fs.writeFileSync(MARKER_FILE, JSON.stringify({
        pythonEmbedVersion: PYTHON_EMBED_VERSION,
        pipInstallDone: true,
        sourceReady: true,
        installedAt: new Date().toISOString(),
      }, null, 2), 'utf8');

      progress('done', { active: false, percent: 100 });
      log.info(`歌曲段落分析 runtime 安裝完成：${RUNTIME_DIR}`);
      return { ok: true, pythonExe: PYTHON_EXE, songformerDir: SONGFORMER_DIR };
    } catch (err) {
      err.stage = err.stage || stage;
      setDownloadStatus({ active: false, stage: 'error', error: err.message });
      log.error(`歌曲段落分析 runtime 安裝失敗（stage=${err.stage}）`, err);
      throw err;
    } finally {
      safeRemove(tmpPythonDir);
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
  isWeightsAvailable,
  downloadRuntime,
  getDownloadStatus,
  RUNTIME_DIR,
  PYTHON_DIR,
  PYTHON_EXE,
  MARKER_FILE,
  SONGFORMER_DIR,
  HF_HOME,
  TORCH_HOME,
  SOURCE_ARCHIVES,
  WEIGHT_MD5,
  REQUIRED_DISK_BYTES,
  _resetForTests: resetForTests,
};
