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

function weightPath(rel) {
  return path.join(SONGFORMER_DIR, 'src', 'SongFormer', rel);
}

// 串流算 MD5：權重檔單檔上 GB，絕不可 readFileSync 整份進記憶體、也不可同步卡住 event loop
// （以前 runtime-status 輪詢每秒一次同步讀 1GB+，OBS 歌詞會跟著頓）。
function fileMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function statFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

// 驗過 MD5 的檔案，記下 size+mtime；之後只要這兩個沒變就視為同一份已驗證的檔案。
// 記在記憶體（這個 process）＋ marker（跨重開）。
const verifiedWeights = new Map(); // rel -> { size, mtimeMs }

function readMarker() {
  try { return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8')); } catch (_) { return null; }
}

function fingerprintMatches(rel, fp) {
  if (!fp) return false;
  try {
    const now = statFingerprint(weightPath(rel));
    return now.size === fp.size && now.mtimeMs === fp.mtimeMs;
  } catch (_) {
    return false;
  }
}

/**
 * 便宜的同步判斷（只 stat，不讀內容）：每個權重檔都有「驗過 MD5 時的 size+mtime」而且
 * 目前檔案跟它一致才回 true。給輪詢／路由用。從沒驗過（例如舊版安裝沒有記指紋）回 false，
 * 由 verifyWeights() 在非同步路徑補驗一次。
 */
function isWeightsAvailable() {
  const marker = readMarker();
  const persisted = (marker && marker.weights) || {};
  return Object.keys(WEIGHT_MD5).every((rel) => fingerprintMatches(rel, verifiedWeights.get(rel) || persisted[rel]));
}

let verifyInFlight = null;

/**
 * 非同步完整驗證：指紋對得上的直接過；對不上（或從沒驗過）的串流重算 MD5，
 * 通過就把新指紋寫進記憶體與 marker。同時只跑一份。
 */
async function verifyWeights() {
  if (isWeightsAvailable()) return true;
  if (verifyInFlight) return verifyInFlight;
  verifyInFlight = (async () => {
    const fingerprints = {};
    for (const [rel, expected] of Object.entries(WEIGHT_MD5)) {
      const full = weightPath(rel);
      if (!fs.existsSync(full)) return false;
      const before = statFingerprint(full);
      if (fingerprintMatches(rel, verifiedWeights.get(rel))) { fingerprints[rel] = before; continue; }
      if ((await fileMd5(full)) !== expected) return false;
      verifiedWeights.set(rel, before);
      fingerprints[rel] = before;
    }
    const marker = readMarker();
    if (marker) {
      try {
        fs.writeFileSync(MARKER_FILE, JSON.stringify({ ...marker, weights: fingerprints }, null, 2), 'utf8');
      } catch (err) {
        log.warn(`無法把權重指紋寫進 marker（下次重開會再驗一次 MD5）：${err.message}`);
      }
    }
    return true;
  })().catch((err) => {
    log.warn(`權重驗證失敗：${err.message}`);
    return false;
  });
  try {
    return await verifyInFlight;
  } finally {
    verifyInFlight = null;
  }
}

let downloadInFlight = null;
let downloadStatus = { active: false, stage: 'idle', percent: null, error: null, updatedAt: null };

// 整體進度條：每個安裝階段在 0–100 裡佔一段，份量照實際耗時／下載量配（PyTorch 那段 pip
// 約 2.5GB 最大、MuQ 骨幹 1.3GB 次之）。有位元組訊號的階段在段內依下載比例內插；沒有訊號
// 的階段（pip 解壓、pip 裝 MuQ）停在段頭，前端改顯示經過時間。整體值只會往上走——pip 會
// 依序下載好幾個 wheel，每個 wheel 的比例都從 0 開始，不能讓進度條倒退。
const STAGE_BANDS = {
  'disk-space-check': [0, 1],
  'download-python': [1, 3],
  'extract-python': [3, 4],
  'bootstrap-pip': [4, 6],
  'install-packages': [6, 58],
  'download-source': [58, 61],
  'install-python': [61, 62],
  'install-muq-package': [62, 66],
  'download-muq-backbone': [66, 86],
  'download-weights': [86, 97],
  'verify-weights': [97, 99],
  done: [100, 100],
};
// install-packages 裡只有 torch 的位元組足以代表整段（其他 wheel 相對很小）；pip 解壓
// （pip-install）時把進度推到段尾附近，剩下的留給「完成」。
const PIP_DOWNLOAD_SHARE = 0.85;

function bandPercent(status) {
  const band = STAGE_BANDS[status.stage];
  if (!band) return null;
  const [lo, hi] = band;
  let frac = 0;
  const hasBytes = status.totalBytes > 0 && status.downloadedBytes != null;
  if (status.stage === 'install-packages') {
    if (status.step === 'pip-install') frac = PIP_DOWNLOAD_SHARE;
    else if (hasBytes && /^torch$/i.test(status.detail || '')) frac = PIP_DOWNLOAD_SHARE * (status.downloadedBytes / status.totalBytes);
  } else if (hasBytes) {
    frac = status.downloadedBytes / status.totalBytes;
  }
  return lo + (hi - lo) * Math.max(0, Math.min(1, frac));
}

function setDownloadStatus(patch) {
  const now = Date.now();
  const prev = downloadStatus;
  const next = { ...prev, ...patch, updatedAt: now };
  // 新的一輪安裝（從 idle／error／done 回到第一個階段）：歸零整體進度
  const restarted = patch.stage === 'disk-space-check' && prev.stage !== 'disk-space-check';
  if (restarted) next.overallPercent = 0;
  // 換階段時，上一階段的位元組／細步驟不可以沿用（例如 torch 的 2.5GB 會讓下一段直接跳到段尾）
  if (next.stage !== prev.stage) {
    for (const k of ['downloadedBytes', 'totalBytes', 'detail', 'step']) if (!(k in patch)) next[k] = null;
  }
  if (next.stage !== prev.stage || restarted) next.stageStartedAt = now;
  if ((next.step || null) !== (prev.step || null) || next.stage !== prev.stage) next.stepStartedAt = now;
  const p = bandPercent(next);
  if (p != null) next.overallPercent = Math.max(restarted ? 0 : (prev.overallPercent || 0), Math.round(p * 10) / 10);
  downloadStatus = next;
}
function getDownloadStatus() {
  // serverNow：讓前端用伺服器時鐘算經過時間（手機等其他裝置時鐘可能不準，同 AI 伴奏安裝）
  return { ...downloadStatus, serverNow: Date.now() };
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
  // SongFormer 本體解到 SONGFORMER_DIR 會整個覆蓋掉，裡面的 src/SongFormer/ckpts/ 是上一次
  // 已下載（可能已驗證）的權重。任何一步失敗重試都重下 ~1GB 太傷，先移到旁邊、解完搬回去；
  // 權重內容是否正確仍由之後的 verify-weights 步驟用 MD5 把關。
  const keptCkpts = archive.destRelative === '.' ? preserveCkpts() : null;
  safeRemove(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(path.join(extractRoot, topDir), dest);
  safeRemove(extractRoot);
  if (keptCkpts) restoreCkpts(keptCkpts);
}

const CKPTS_KEEP_DIR = path.join(RUNTIME_DIR, 'ckpts.keep');

function preserveCkpts() {
  const ckpts = path.join(SONGFORMER_DIR, 'src', 'SongFormer', 'ckpts');
  // 上一次在「搬走後、搬回前」中斷的話，ckpts.keep 還在、SongFormer 裡已經沒有 ckpts——沿用它。
  if (fs.existsSync(CKPTS_KEEP_DIR)) return CKPTS_KEEP_DIR;
  if (!fs.existsSync(ckpts)) return null;
  fs.renameSync(ckpts, CKPTS_KEEP_DIR);
  return CKPTS_KEEP_DIR;
}

function restoreCkpts(keptDir) {
  const ckpts = path.join(SONGFORMER_DIR, 'src', 'SongFormer', 'ckpts');
  // 原始碼壓縮檔本身可能帶一個 ckpts/（例如 md5sum.txt）；我們保留的權重優先，
  // 壓縮檔裡有、保留目錄沒有的檔案補搬進來。
  if (fs.existsSync(ckpts)) {
    mergeMissing(ckpts, keptDir);
    safeRemove(ckpts);
  }
  fs.renameSync(keptDir, ckpts);
}

function mergeMissing(fromDir, intoDir) {
  for (const name of fs.readdirSync(fromDir)) {
    const from = path.join(fromDir, name);
    const into = path.join(intoDir, name);
    if (!fs.existsSync(into)) fs.renameSync(from, into);
    else if (fs.lstatSync(from).isDirectory() && fs.lstatSync(into).isDirectory()) mergeMissing(from, into);
  }
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
    // 已安裝、只是指紋還沒記（舊版安裝）或檔案 mtime 變了：非同步補驗一次 MD5 就好，
    // 不要因為 isWeightsAvailable() 的便宜判斷回 false 就整包 2.7GB 重下。
    if (isAvailable() && await verifyWeights()) {
      setDownloadStatus({ active: false, stage: 'done', percent: 100, error: null });
      return { ok: true, pythonExe: PYTHON_EXE, songformerDir: SONGFORMER_DIR };
    }

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
      const weightFingerprints = {};
      for (const [rel, expected] of Object.entries(WEIGHT_MD5)) {
        const full = weightPath(rel);
        if (!fs.existsSync(full) || (await fileMd5(full)) !== expected) {
          safeRemove(full); // 讓官方 download() 下次重跑時真的重下，而不是誤判已存在
          throw new Error(`權重檔驗證失敗：${rel}（MD5 對不上官方公布值，已刪除半成品）`);
        }
        weightFingerprints[rel] = statFingerprint(full);
        verifiedWeights.set(rel, weightFingerprints[rel]);
      }

      fs.writeFileSync(MARKER_FILE, JSON.stringify({
        pythonEmbedVersion: PYTHON_EMBED_VERSION,
        pipInstallDone: true,
        sourceReady: true,
        weights: weightFingerprints,
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
  verifyInFlight = null;
  verifiedWeights.clear();
  downloadStatus = { active: false, stage: 'idle', percent: null, error: null, updatedAt: null };
}

module.exports = {
  isAvailable,
  isWeightsAvailable,
  verifyWeights,
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
  CKPTS_KEEP_DIR,
  _setDownloadStatus: setDownloadStatus,
  STAGE_BANDS,
  _preserveCkpts: preserveCkpts,
  _restoreCkpts: restoreCkpts,
  _resetForTests: resetForTests,
};
