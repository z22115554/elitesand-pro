/**
 * AI 分離 runtime 按需下載（docs/AI-SEPARATION-PLAN.md A2）。
 *
 * 形狀照抄 ffmpeg-provider.js（D-1 決策的同一套模式）：不預裝在 installer 裡（這次是
 * GB 級的 embeddable Python + PyTorch CUDA，比 FFmpeg 更不該塞進安裝包），使用者需要
 * AI 分離時才下載；沒下載不影響其他功能。全部先驗證雜湊才能用，雜湊不符一律拒絕。
 *
 * 下載對象分兩段：
 * 1. Python embeddable（python.org 官方）——這頁只公布 MD5，不像 FFmpeg 來源有現成的
 *    SHA-256 文字檔可先抓。做法比照 npm lockfile 的邏輯：自己下載一次驗過 MD5 相符，
 *    算出 SHA-256 釘死在 PYTHON_EMBED_SHA256，之後每次下載驗證這個值，不再信任
 *    python.org 當下回應了什麼——這樣可以繼續沿用跟 FFmpeg 一樣的 SHA-256 驗證程式碼。
 * 2. PyTorch CUDA + audio-separator——透過 pip 從官方 PyPI / download.pytorch.org 安裝，
 *    雜湊驗證交給 pip 自己（pip 對每個 wheel 都有內建的 hash 比對，這裡不重造輪子）。
 *
 * Hermetic：全部裝在 dataDir/ai-runtime/，不動 machine-wide PATH／PYTHONPATH，
 * 不偵測或重用使用者既有的 Python/Conda/ComfyUI（AI-SEPARATION-PLAN.md §5-1）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');
const { inspectDiskSpace } = require('./disk-space');
const { withFfmpegOnPath } = require('./ffmpeg-provider');

const log = createLogger('AIRuntimeProvider');

const RUNTIME_DIR = path.join(dataDir, 'ai-runtime');
const PYTHON_DIR = path.join(RUNTIME_DIR, 'python');
const PYTHON_EXE = path.join(PYTHON_DIR, 'python.exe');
const MARKER_FILE = path.join(RUNTIME_DIR, '.installed.json');
const MODEL_DIR = path.join(dataDir, 'ai-models');
const MODEL_FILENAME = 'vocals_mel_band_roformer.ckpt';
const MODEL_FILE = path.join(MODEL_DIR, MODEL_FILENAME);
const MODEL_MIN_BYTES = 850 * 1024 * 1024;

const PYTHON_EMBED_VERSION = '3.11.9';
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_EMBED_VERSION}/python-${PYTHON_EMBED_VERSION}-embed-amd64.zip`;
// 2026-08-17 自己下載驗過：MD5 6d9aa08531d48fcc261ba667e2df17c4，跟 python.org 官網公布值相符。
const PYTHON_EMBED_SHA256 = '009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b';

const PIP_PACKAGES = ['audio-separator[gpu]', 'torch==2.6.0', 'torchaudio==2.6.0'];
const PIP_EXTRA_INDEX_URL = 'https://download.pytorch.org/whl/cu124';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

// Python embeddable + 完整安裝的 site-packages（torch cu124 wheel 本身就 ~2.5GB）
// 保守估計要留 6GB 才夠，不能只算 zip 大小。
const REQUIRED_DISK_BYTES = 6 * 1024 * 1024 * 1024;

const MAX_ZIP_BYTES = 50 * 1024 * 1024; // python embeddable 只有 ~11MB，超過代表上游檔案異常
const MAX_REDIRECTS = 5;
const DOWNLOAD_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30 * 1000;

function isAvailable() {
  try {
    if (!fs.existsSync(PYTHON_EXE) || !fs.existsSync(MARKER_FILE)) return false;
    const marker = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8'));
    return marker.pythonEmbedVersion === PYTHON_EMBED_VERSION && marker.pipInstallDone === true;
  } catch (_) {
    return false;
  }
}

function isModelAvailable() {
  try {
    return fs.statSync(MODEL_FILE).size >= MODEL_MIN_BYTES;
  } catch (_) {
    return false;
  }
}

// 注意：這裡刻意不用 fs.rmSync(path, {recursive:true, force:true}) 那個組合——
// 2026-08-17 實測在這台機器（Node v24.12.0）對本專案含中文字元的路徑會卡死不回應
// （existsSync／unlinkSync 對同一路徑完全正常，問題只在 rmSync 那個 flag 組合），
// 先檢查存在與型別再呼叫對應的刪除方式可以繞開。
function safeRemove(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmdirSync(targetPath, { recursive: true });
    } else {
      fs.unlinkSync(targetPath);
    }
  } catch (_) { /* 本來就不存在或刪除失敗都當作 best effort，忽略 */ }
}

// ─── 以下 fetchToBuffer/fetchToFile 跟 ffmpeg-provider.js 是同一套邏輯，
// 兩邊都是自成一體的模組（不是共用 library），照專案慣例各自持有一份 ───

function fetchToBuffer(url, { maxBytes, redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Elitesand-Pro-AIRuntime-Provider' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('重新導向次數過多')); return; }
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchToBuffer(redirectUrl, { maxBytes, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下載失敗，HTTP ${res.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (maxBytes && total > maxBytes) {
          res.destroy();
          reject(new Error('下載內容超過預期大小上限，已中止'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('下載逾時')));
  });
}

function fetchToFile(url, filePath, {
  maxBytes,
  redirectsLeft = MAX_REDIRECTS,
  deadline = Date.now() + DOWNLOAD_TOTAL_TIMEOUT_MS,
  idleTimeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS,
  onProgress,
  abortSignal,
} = {}) {
  return new Promise((resolve, reject) => {
    let response = null;
    let settled = false;
    const remainingMs = Math.max(1, deadline - Date.now());
    const totalTimer = setTimeout(() => {
      const error = new Error('下載總時間超過 10 分鐘，已中止並嘗試其他來源');
      response?.destroy(error);
      request.destroy(error);
    }, remainingMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      fn(value);
    };

    if (abortSignal) {
      const onAbort = () => finish(reject, Object.assign(new Error('下載已取消'), { code: 'CANCELLED' }));
      if (abortSignal.aborted) { onAbort(); return; }
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    const request = https.get(url, { headers: { 'User-Agent': 'Elitesand-Pro-AIRuntime-Provider' } }, async (res) => {
      response = res;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          finish(reject, new Error('重新導向次數過多'));
          return;
        }
        clearTimeout(totalTimer);
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchToFile(redirectUrl, filePath, {
          maxBytes, redirectsLeft: redirectsLeft - 1, deadline, idleTimeoutMs, onProgress, abortSignal,
        }).then(resolve, reject);
        settled = true;
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        finish(reject, new Error(`下載失敗，HTTP ${res.statusCode}: ${url}`));
        return;
      }

      const contentLength = Number.parseInt(res.headers['content-length'] || '', 10);
      const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
      if (maxBytes && totalBytes && totalBytes > maxBytes) {
        res.destroy();
        finish(reject, new Error('下載內容超過預期大小上限，已中止'));
        return;
      }

      let downloadedBytes = 0;
      const startedAt = Date.now();
      const hash = crypto.createHash('sha256');
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          downloadedBytes += chunk.length;
          if (maxBytes && downloadedBytes > maxBytes) {
            callback(new Error('下載內容超過預期大小上限，已中止'));
            return;
          }
          hash.update(chunk);
          const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
          onProgress?.({
            downloadedBytes,
            totalBytes,
            percent: totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null,
            speedBytesPerSec: downloadedBytes / elapsedSeconds,
          });
          callback(null, chunk);
        },
      });

      try {
        await pipeline(res, meter, fs.createWriteStream(filePath, { flags: 'w' }));
        finish(resolve, { downloadedBytes, totalBytes, sha256: hash.digest('hex') });
      } catch (error) {
        finish(reject, error);
      }
    });

    request.on('error', (error) => finish(reject, error));
    request.setTimeout(idleTimeoutMs, () => request.destroy(new Error('下載連線 30 秒沒有收到資料，已中止')));
  });
}

/** python311._pth 預設把 site-packages 註解掉（embeddable 版預設不吃 pip 裝的套件）；
 * 拿掉那行註解，pip 裝的東西才 import 得到。找不到就視為上游打包結構變了，直接報錯
 * 而不是靜默裝出一個 import 不到套件的半殘 runtime。 */
/**
 * 安全解壓（取代 adm-zip 的 extractAllTo）。
 *
 * GHSA-vwc7-r8mq-g2x9：adm-zip >= 0.5.9 的 extractAllTo 會跟隨目的地既有的
 * symlink，可被用來把檔案寫到目標目錄外。0.6.0（目前最新）仍在範圍內，上游還
 * 沒有修好的版本，而降版到 0.5.8 是 semver-major、會退掉八個版本的修正——
 * 更新器與 FFmpeg 供應都依賴這個套件，不值得為此冒險。
 *
 * 本專案其他用到 adm-zip 的地方（app-updater / app-updater-v2 / ffmpeg-provider）
 * 都是「讀 entry 資料再寫到程式自己決定的路徑」，zip 內的路徑不決定寫入位置，
 * 結構上就免疫；只有這裡原本用 extractAllTo。所以修這一處就夠，不必動相依。
 *
 * 這個 zip 本身有釘死的 SHA-256 驗證（PYTHON_EMBED_SHA256），所以實際上要先
 * 打破雜湊才談得上利用；以下是縱深防禦。
 */
function safeExtractAll(zip, targetDir) {
  const root = path.resolve(targetDir);
  for (const entry of zip.getEntries()) {
    const name = String(entry.entryName || '');
    if (!name || name.includes('\0')) throw new Error('壓縮檔含非法的項目名稱');

    // zip 內一律以 / 分隔；正規化後必須仍落在 root 之內（擋絕對路徑與 .. 逃逸）
    const dest = path.resolve(root, name.replace(/\\/g, '/'));
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`壓縮檔項目逃出目標目錄：${name}`);
    }

    if (entry.isDirectory) { fs.mkdirSync(dest, { recursive: true }); continue; }

    // Unix symlink 在 zip 裡是 external attributes 高 16 位的 S_IFLNK(0xA000)
    const unixMode = ((entry.header && entry.header.attr) || 0) >>> 16;
    if ((unixMode & 0xF000) === 0xA000) throw new Error(`壓縮檔含符號連結：${name}`);

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // 目的地若已是 symlink 就先移除，避免經由既有連結寫到別處（這正是該 CVE 的手法）
    try {
      if (fs.lstatSync(dest).isSymbolicLink()) fs.unlinkSync(dest);
    } catch (_) { /* 不存在就直接寫 */ }
    fs.writeFileSync(dest, entry.getData());
  }
}

function enableSitePackages(pythonDir) {
  const pthFiles = fs.readdirSync(pythonDir).filter((f) => /^python3\d+\._pth$/.test(f));
  if (pthFiles.length !== 1) {
    throw new Error(`找不到唯一的 python3xx._pth（找到 ${pthFiles.length} 個），embeddable 套件打包結構可能變了`);
  }
  const pthPath = path.join(pythonDir, pthFiles[0]);
  const content = fs.readFileSync(pthPath, 'utf8');
  const patched = content.replace(/^#\s*import site/m, 'import site');
  if (patched === content && !/^import site/m.test(content)) {
    throw new Error(`${pthFiles[0]} 裡找不到 "#import site" 可以取消註解`);
  }
  fs.writeFileSync(pthPath, patched, 'utf8');
}

function runPythonStep(args, { cwd, pythonExe = PYTHON_EXE, onOutput, spawnImpl = spawn, timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawnImpl(pythonExe, args, {
      cwd,
      windowsHide: true,
      // withFfmpegOnPath：audio-separator 的 Separator.__init__ 無條件用裸指令檢查 ffmpeg，
      // 只認 PATH。少了這層，連 --download_model_only 這種根本不用 ffmpeg 的步驟也會被
      // FileNotFoundError 擋掉（使用者用程式內按鈕下載的 ffmpeg 在 dataDir/bin，不在 PATH 上）。
      env: withFfmpegOnPath({ ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }),
    });
    let stderrTail = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`指令逾時（${Math.round(timeoutMs / 1000)}s）：python ${args.join(' ')}`));
    }, timeoutMs);
    proc.stdout?.on('data', (chunk) => onOutput?.(chunk.toString('utf8')));
    proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrTail = (stderrTail + text).slice(-4000);
      onOutput?.(text);
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`指令失敗（exit ${code}）：python ${args.join(' ')}\n${stderrTail}`));
    });
  });
}

// ─── pip / tqdm 即時輸出解析：把「安裝套件」「下載主模型」這兩個原本靜默的長步驟
// 拆成可讀的子階段與位元組進度。帶 \r 的進度列也吃。 ───
function parseByteSize(str) {
  const m = String(str).match(/([\d.]+)\s*(K|M|G|T)?i?B?/i);
  if (!m) return null;
  const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

function parseToolProgress(text) {
  const out = {};
  for (const raw of String(text).split(/[\r\n]+/)) {
    const line = raw.trim();
    if (!line) continue;

    // pip：正在下載某個 wheel（`Downloading torch-2.6.0+cu124-...whl (2.5 GB)`）
    let m = line.match(/^Downloading\s+([A-Za-z0-9._+-]+?)-\d[\w.+]*\.(?:whl|tar\.gz|zip)\b/i);
    if (m) out.step = 'pip-download', out.detail = m[1];
    m = line.match(/^Downloading\s+\S+\s+\(([\d.]+\s*[KMGT]?i?B)\)/i);
    if (m) { const t = parseByteSize(m[1]); if (t != null) out.totalBytes = t; }

    // pip：解析相依
    m = line.match(/^Collecting\s+([A-Za-z0-9._[\]-]+)/i);
    if (m && !out.step) out.step = 'pip-resolve', out.detail = m[1].replace(/[<>=!~[].*/, '');

    // pip：開始安裝（解壓，無位元組訊號）
    if (/^Installing collected packages/i.test(line) || /^Successfully installed/i.test(line)) {
      out.step = 'pip-install';
      out.downloadedBytes = null;
      out.totalBytes = null;
    }

    // tqdm（audio-separator 主模型）：`name:  45%|████▌     | 410M/913M [00:32<00:38, 12.8MB/s]`
    m = line.match(/\|\s*([\d.]+\s*[KMGT]?i?B?)\s*\/\s*([\d.]+\s*[KMGT]?i?B?)\s*[[\]]/i);
    if (m) {
      const cur = parseByteSize(m[1]); const tot = parseByteSize(m[2]);
      if (cur != null) out.downloadedBytes = cur;
      if (tot != null) out.totalBytes = tot;
      if (!out.step) out.step = 'model-download';
    }

    // pip Rich 進度列：`1.5/2.5 GB 42.1 MB/s`
    m = line.match(/(?:^|\s)([\d.]+)\s*\/\s*([\d.]+)\s*(K|M|G|T)i?B(?:\s|$)/i);
    if (m) {
      const mult = { K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[3].toUpperCase()] || 1;
      out.downloadedBytes = Math.round(parseFloat(m[1]) * mult);
      out.totalBytes = Math.round(parseFloat(m[2]) * mult);
      if (!out.step) out.step = 'pip-download';
    }
  }
  return out;
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
 * 下載並安裝 AI runtime。四條失敗路徑（斷網／雜湊竄改／磁碟不足／中途取消）
 * 都在這裡處理，全部丟出可讀訊息、不留半成品目錄。
 */
async function downloadRuntime({
  onProgress,
  fetchFileImpl = fetchToFile,
  runPythonStepImpl = runPythonStep,
  inspectDiskSpaceImpl = inspectDiskSpace,
  abortSignal,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') {
    throw new Error('目前只支援 Windows 的自動下載。');
  }
  if (downloadInFlight) return downloadInFlight;

  downloadInFlight = (async () => {
    const tmpZip = path.join(RUNTIME_DIR, 'python-embed.download.zip');
    const tmpPythonDir = path.join(RUNTIME_DIR, 'python.download');
    let stage = 'start';

    const progress = (nextStage, extra = {}) => {
      stage = nextStage;
      setDownloadStatus({ active: nextStage !== 'done', stage: nextStage, error: null, ...extra });
      log.info(`AI runtime 安裝階段：${nextStage}`);
      onProgress?.(getDownloadStatus());
    };

    try {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      safeRemove(tmpZip);
      safeRemove(tmpPythonDir);

      progress('disk-space-check');
      const disk = inspectDiskSpaceImpl(RUNTIME_DIR, { thresholdBytes: REQUIRED_DISK_BYTES });
      if (disk.known && disk.low) {
        throw new Error(`磁碟空間不足：需要約 ${Math.round(REQUIRED_DISK_BYTES / 1024 / 1024 / 1024)}GB，目前可用約 ${Math.round(disk.freeBytes / 1024 / 1024)}MB。請清出空間後再試一次。`);
      }

      progress('download-python', { downloadedBytes: 0, totalBytes: null, percent: 0 });
      const result = await fetchFileImpl(PYTHON_EMBED_URL, tmpZip, {
        maxBytes: MAX_ZIP_BYTES,
        abortSignal,
        onProgress: (p) => { setDownloadStatus({ active: true, stage: 'download-python', ...p, error: null }); onProgress?.(getDownloadStatus()); },
      });

      progress('verify-python');
      if (result.sha256 !== PYTHON_EMBED_SHA256) {
        throw new Error(`SHA-256 驗證失敗（預期 ${PYTHON_EMBED_SHA256.slice(0, 12)}…，實際 ${result.sha256.slice(0, 12)}…），已拒絕使用此檔案`);
      }

      progress('extract');
      const zip = new AdmZip(tmpZip);
      safeExtractAll(zip, tmpPythonDir);
      enableSitePackages(tmpPythonDir);

      progress('bootstrap-pip');
      const getPipPath = path.join(tmpPythonDir, 'get-pip.py');
      const getPipBuf = await fetchToBuffer(GET_PIP_URL, { maxBytes: 5 * 1024 * 1024 });
      fs.writeFileSync(getPipPath, getPipBuf);
      const tmpPythonExe = path.join(tmpPythonDir, 'python.exe');
      await runPythonStepImpl(['get-pip.py', '--no-warn-script-location'], { cwd: tmpPythonDir, pythonExe: tmpPythonExe });

      progress('install-packages', { step: 'pip-resolve', detail: null, downloadedBytes: 0, totalBytes: null, percent: null });
      await runPythonStepImpl(
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

      progress('install');
      // 安裝路徑用「先裝到 .download、成功才 rename 進正式路徑」而不是直接解壓到
      // PYTHON_DIR：避免任何一步失敗時留下一個「檔案存在但半殘」的 runtime，讓
      // isAvailable() 誤判成可用。
      safeRemove(PYTHON_DIR);
      fs.renameSync(tmpPythonDir, PYTHON_DIR);
      fs.writeFileSync(MARKER_FILE, JSON.stringify({
        pythonEmbedVersion: PYTHON_EMBED_VERSION,
        pipInstallDone: true,
        installedAt: new Date().toISOString(),
      }, null, 2), 'utf8');

      progress('done', { active: false, percent: 100 });
      log.info(`AI runtime 安裝完成：${PYTHON_DIR}`);
      return { ok: true, pythonExe: PYTHON_EXE };
    } catch (err) {
      err.stage = err.stage || stage;
      setDownloadStatus({ active: false, stage: 'error', error: err.message });
      log.error(`AI runtime 安裝失敗（stage=${err.stage}）`, err);
      throw err;
    } finally {
      safeRemove(tmpZip);
      safeRemove(tmpPythonDir);
    }
  })();

  try {
    return await downloadInFlight;
  } finally {
    downloadInFlight = null;
  }
}

/**
 * 把 Python 主引擎實際會用到的 Kim 模型先下載完成。以前由第一首歌在 load_model()
 * 階段臨時下載，會讓「安裝完成」與「真的可以開始分離」變成兩種狀態；統一安裝流程
 * 改用 audio-separator 自己提供的 download_model_only 入口，沿用它的模型清單與驗證。
 */
async function downloadPrimaryModel({ runPythonStepImpl = runPythonStep, onOutput, onProgress } = {}) {
  if (!isAvailable()) throw new Error('AI 分離 Python 元件尚未安裝。');
  if (isModelAvailable()) return { ok: true, alreadyAvailable: true, modelFile: MODEL_FILE };
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  setDownloadStatus({ active: true, stage: 'primary-model', step: 'model-download', detail: MODEL_FILENAME, downloadedBytes: 0, totalBytes: MODEL_MIN_BYTES, error: null });
  onProgress?.(getDownloadStatus());
  await runPythonStepImpl([
    '-c', 'from audio_separator.utils.cli import main; main()',
    '--model_file_dir', MODEL_DIR,
    '--download_model_only',
    '-m', MODEL_FILENAME,
  ], {
    cwd: RUNTIME_DIR,
    pythonExe: PYTHON_EXE,
    timeoutMs: 30 * 60 * 1000,
    onOutput: (text) => {
      onOutput?.(text);
      const p = parseToolProgress(text);
      if (Object.keys(p).length) {
        setDownloadStatus({ active: true, stage: 'primary-model', step: 'model-download', detail: MODEL_FILENAME, error: null, ...p });
        onProgress?.(getDownloadStatus());
      }
    },
  });
  if (!isModelAvailable()) throw new Error('主分離模型下載完成後仍找不到有效檔案。');
  return { ok: true, alreadyAvailable: false, modelFile: MODEL_FILE };
}

function resetForTests() {
  downloadInFlight = null;
  downloadStatus = { active: false, stage: 'idle', percent: null, error: null, updatedAt: null };
}

module.exports = {
  isAvailable,
  isModelAvailable,
  downloadRuntime,
  downloadPrimaryModel,
  getDownloadStatus,
  parseToolProgress,
  enableSitePackages,
  safeExtractAll, // 匯出供測試：audit:release 對 GHSA-vwc7-r8mq-g2x9 的豁免以它成立為前提
  fetchToFile,
  fetchToBuffer,
  RUNTIME_DIR,
  PYTHON_DIR,
  PYTHON_EXE,
  MARKER_FILE,
  MODEL_DIR,
  MODEL_FILENAME,
  MODEL_FILE,
  PYTHON_EMBED_URL,
  PYTHON_EMBED_SHA256,
  REQUIRED_DISK_BYTES,
  _resetForTests: resetForTests,
};
