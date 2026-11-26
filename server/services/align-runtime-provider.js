/**
 * 精準對時元件（中文歌）按需下載。
 *
 * 內容：一份自己的 Python embeddable（跟 AI 分離同一版、同一個雜湊）＋四個 pip 套件
 * （onnxruntime-directml／numpy／sentencepiece／kaldi-native-fbank，連相依一共 9 個 wheel，
 * 全部釘版本＋SHA-256，用 --require-hashes 安裝）＋一個語音辨識小模型。
 *
 * 模型：k2-fsa sherpa-onnx 官方發布的中文 Zipformer CTC small（Apache-2.0）。有兩個版本，
 * 而且彼此只能在一種裝置上跑（2026-11-12 實測，換裝置會直接崩潰）：
 *   - fp16（壓縮檔 90MB）：DirectML，任何支援 DX12 的顯示卡，每首約 2 秒
 *   - int8（壓縮檔 51MB）：只能跑 CPU，每首約 35 秒
 * 安裝時先裝 fp16 並在顯示卡上空跑一次（同時讓驅動把編好的顯示卡程式存起來，使用者第一次
 * 對時不用再等那一分鐘）；顯示卡跑不起來才改下載 int8。
 *
 * 獨立環境 dataDir/align-runtime/，不跟 AI 分離或段落分析共用（理由同 section-runtime-provider.js）。
 *
 * macOS（Apple Silicon＋macOS 14 以上）：Python 用跟 AI 分離同一個釘死的 python-build-standalone
 * （python-mac-runtime-trust.js），但裝在 align-runtime 自己的資料夾——沒裝 1.2GB 人聲分離元件包的人
 * 也能單獨裝。套件是 python-locks/align-mac-arm64-py312.lock（CPU 版 onnxruntime，--require-hashes
 * --no-deps --only-binary）。只用 int8 模型＋CPUExecutionProvider：fp16 只給 DirectML，Mac 不試 CoreML。
 * Intel Mac 不支援：onnxruntime 1.24 起與 sentencepiece 0.2.3 都沒有 macOS x86_64 wheel。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../utils/app-paths');
const { createLogger } = require('../utils/logger');
const { inspectDiskSpace } = require('./disk-space');
const { safeRemove } = require('../utils/safe-remove');
const {
  fetchToFile,
  fetchToBuffer,
  safeExtractAll,
  enableSitePackages,
  runPythonStep,
  parseToolProgress,
  PYTHON_EMBED_URL,
  PYTHON_EMBED_SHA256,
  fetchMacPython,
  macSupport,
  pythonExeFor,
} = require('./ai-runtime-provider');
const { MAC_ALIGN_RUNTIME_ID } = require('./python-mac-runtime-trust');
const { resolveAiScriptDir } = require('./ai-separation');
const packageTrust = require('./python-package-trust');

const log = createLogger('AlignRuntimeProvider');

const RUNTIME_DIR = path.join(dataDir, 'align-runtime');
const PYTHON_DIR = path.join(RUNTIME_DIR, 'python');
// Windows：embeddable 的 python.exe；Mac：python-build-standalone 的 bin/python3
const PYTHON_EXE = pythonExeFor(process.platform, PYTHON_DIR);
const MODEL_ROOT = path.join(RUNTIME_DIR, 'model');
const MARKER_FILE = path.join(RUNTIME_DIR, '.installed.json');
const REQUIREMENTS_FILE = path.join(RUNTIME_DIR, 'requirements.txt');
const { GET_PIP_URL, verifyGetPip } = require('./python-bootstrap-trust');
const PYTHON_EMBED_VERSION = '3.11.9';
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
// python 30MB＋套件解開約 120MB＋模型 105MB，加上下載暫存，留寬一點
const REQUIRED_DISK_BYTES = 600 * 1024 * 1024;

// 2026-11-12 以 pip download --python-version 3.11 --platform win_amd64 取得並計算雜湊。
// 改任何一行都要把 PACKAGES_REVISION +1，已安裝的人才會補裝。
const PIP_REQUIREMENTS = [
  'flatbuffers==25.12.19 --hash=sha256:7634f50c427838bb021c2d66a3d1168e9d199b0607e6329399f04846d42e20b4',
  'kaldi-native-fbank==1.23.0 --hash=sha256:b09ef7da445f855cb172995fd089649d27d9a6d4dca85cf2a492a829e0f3d754',
  'mpmath==1.3.0 --hash=sha256:a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c',
  'numpy==2.4.6 --hash=sha256:1e254a00cdf42b1e4d5b3d68d33af63268d41340d8885df2ab6470f2e1500147',
  'onnxruntime-directml==1.24.4 --hash=sha256:96642a787e5a6f33bf043521c0f06eb1eb663f6b830e5862a2026d03f9c90543',
  'packaging==26.3 --hash=sha256:d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c',
  'protobuf==7.36.2 --hash=sha256:a300819d441e078a5608c0d3c709796bb548136058fda017ae51d425b44fd353',
  'sentencepiece==0.2.3 --hash=sha256:a01e76cf49a0c1abc527c4e5fd6d3a87a3139a1d3ad2d5761567179a70805cce',
  'sympy==1.14.0 --hash=sha256:e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5',
];
const PACKAGES_REVISION = 1;

// ─── macOS（Apple Silicon）───
// 套件在 python-locks/align-mac-arm64-py312.lock；改鎖定清單時把 MAC_ALIGN_RUNTIME_ID 的 r 加一。
const MAC_PACKAGES_REVISION = 1;
// 2026-11-26 GitHub Actions macos-15 arm64 實測（beta.10）：下載 Python 25.4MB＋9 個 wheel 31.8MB
// ＋int8 模型 50.5MB＝107.7MB；安裝後 align-runtime 共 341MB（Python＋套件 277MB、模型 63MB）。
const MAC_EXPECTED_DOWNLOAD_BYTES = 108 * 1000 * 1000;
const MAC_EXPECTED_INSTALLED_BYTES = 341 * 1000 * 1000;
const MAC_REQUIRED_DISK_BYTES = 600 * 1000 * 1000; // 安裝後約 341MB＋下載暫存約 110MB，留寬一點

const MODEL_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
const MODELS = {
  dml: {
    archive: 'sherpa-onnx-zipformer-ctc-small-zh-fp16-2025-07-16.tar.bz2',
    sha256: '110ffc121bdffb906d69bf0c38f1535b3b78d481242cd9123b380aae4a8b4606',
    maxBytes: 120 * 1024 * 1024,
    dir: 'sherpa-onnx-zipformer-ctc-small-zh-fp16-2025-07-16',
    file: 'model.fp16.onnx',
  },
  cpu: {
    archive: 'sherpa-onnx-zipformer-ctc-small-zh-int8-2025-07-16.tar.bz2',
    sha256: '6a71c0cc442ba85ac1455ca23e4561e2a1ef18e55269a184a649d54e9cd0524c',
    maxBytes: 80 * 1024 * 1024,
    dir: 'sherpa-onnx-zipformer-ctc-small-zh-int8-2025-07-16',
    file: 'model.int8.onnx',
  },
};

let downloadInFlight = null;
let downloadStatus = { active: false, stage: 'idle', percent: null, error: null, updatedAt: null };

function setDownloadStatus(patch) {
  downloadStatus = { ...downloadStatus, ...patch, updatedAt: new Date().toISOString() };
}

function getDownloadStatus() {
  return { ...downloadStatus };
}

function readMarker() {
  try { return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8')); } catch (_) { return null; }
}

function modelFiles(device) {
  const m = MODELS[device];
  if (!m) return null;
  const dir = path.join(MODEL_ROOT, m.dir);
  return { model: path.join(dir, m.file), bpe: path.join(dir, 'bbpe.model'), device };
}

/** 裝好、而且是目前這版套件組合。回傳要用哪一份模型（device／檔案路徑）；沒裝好回 null。 */
function expectedMarker(platform = process.platform) {
  return platform === 'darwin'
    ? { pythonEmbedVersion: MAC_ALIGN_RUNTIME_ID, packagesRevision: MAC_PACKAGES_REVISION }
    : { pythonEmbedVersion: PYTHON_EMBED_VERSION, packagesRevision: PACKAGES_REVISION };
}

function markerMatches(marker, platform = process.platform) {
  const expected = expectedMarker(platform);
  return !!marker && marker.pythonEmbedVersion === expected.pythonEmbedVersion && marker.packagesRevision === expected.packagesRevision;
}

/**
 * 這台電腦能不能裝精準對時：Windows 一律可以（既有行為）；Mac 只有 Apple Silicon＋macOS 14 以上
 * （條件跟 AI 分離相同，onnxruntime 1.24.4 的 wheel 是 macosx_14_0_arm64）。回傳 { supported, reason }。
 */
function platformSupport({ platform = process.platform, arch = process.arch, release } = {}) {
  if (platform === 'win32') return { supported: true, reason: null };
  if (platform !== 'darwin') return { supported: false, reason: 'not_mac' };
  return macSupport({ platform, arch, ...(release === undefined ? {} : { release }) });
}

function getInstalled() {
  const marker = readMarker();
  if (!markerMatches(marker)) return null;
  const files = modelFiles(marker.device);
  if (!files || !fs.existsSync(PYTHON_EXE) || !fs.existsSync(files.model) || !fs.existsSync(files.bpe)) return null;
  return files;
}

function isAvailable() {
  return getInstalled() !== null;
}

function workerScript() {
  return path.join(resolveAiScriptDir(), 'align_worker.py');
}

function workerEnv(files) {
  return {
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    // 不在 ai/ 底下留 __pycache__（打包版那裡是安裝目錄）
    PYTHONDONTWRITEBYTECODE: '1',
    ELITESAND_ALIGN_MODEL: files.model,
    ELITESAND_ALIGN_BPE: files.bpe,
    ELITESAND_ALIGN_DEVICE: files.device,
  };
}

async function downloadModel(device, { onProgress, abortSignal, fetchFileImpl = fetchToFile, runPythonStepImpl = runPythonStep }) {
  const m = MODELS[device];
  const tmp = path.join(RUNTIME_DIR, `${m.archive}.download`);
  safeRemove(tmp);
  const result = await fetchFileImpl(`${MODEL_RELEASE}/${m.archive}`, tmp, {
    maxBytes: m.maxBytes,
    abortSignal,
    onProgress: (p) => { setDownloadStatus({ active: true, stage: 'download-model', ...p, error: null }); onProgress?.(getDownloadStatus()); },
  });
  if (result.sha256 !== m.sha256) {
    safeRemove(tmp);
    throw new Error('精準對時模型的 SHA-256 驗證失敗，已拒絕使用此檔案');
  }
  setDownloadStatus({ active: true, stage: 'extract-model', error: null });
  onProgress?.(getDownloadStatus());
  safeRemove(path.join(MODEL_ROOT, m.dir));
  fs.mkdirSync(MODEL_ROOT, { recursive: true });
  // tar.bz2：Node 沒有內建 bzip2，交給剛裝好的 Python（tarfile 的 'data' 過濾器擋掉
  // 絕對路徑、跳出目標資料夾、裝置檔與連結）。
  await runPythonStepImpl(['-c', 'import sys, tarfile\nwith tarfile.open(sys.argv[1], "r:bz2") as t:\n    t.extractall(sys.argv[2], filter="data")',
    tmp, MODEL_ROOT], { cwd: RUNTIME_DIR, pythonExe: PYTHON_EXE, timeoutMs: 5 * 60 * 1000, abortSignal });
  safeRemove(tmp);
  const files = modelFiles(device);
  if (!fs.existsSync(files.model) || !fs.existsSync(files.bpe)) throw new Error('精準對時模型解壓後缺少檔案');
  return files;
}

// 在指定裝置上把模型載入並空跑一次。顯示卡這一步第一次要編譯（約 1 分鐘），之後驅動有快取。
function warmup(files, { abortSignal, runPythonStepImpl = runPythonStep } = {}) {
  const script = workerScript();
  const code = 'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport align_worker as w\nprint(json.dumps(w.handle({"op": "warmup"})))';
  return runPythonStepImpl(['-c', code, path.dirname(script)], {
    cwd: RUNTIME_DIR, pythonExe: PYTHON_EXE, timeoutMs: 5 * 60 * 1000, abortSignal, env: workerEnv(files),
  });
}

async function downloadRuntime({ onProgress, abortSignal, platform = process.platform, forceCpu = false, ...macOptions } = {}) {
  if (platform === 'darwin') return downloadMacRuntime({ onProgress, abortSignal, ...macOptions });
  if (platform !== 'win32') throw new Error('目前只支援 Windows 的自動下載。');
  if (downloadInFlight) return downloadInFlight;
  downloadInFlight = (async () => {
    if (isAvailable()) {
      setDownloadStatus({ active: false, stage: 'done', percent: 100, error: null });
      return { ok: true, ...getInstalled() };
    }
    const tmpPythonDir = path.join(RUNTIME_DIR, 'python.download');
    let stage = 'start';
    const progress = (nextStage, extra = {}) => {
      stage = nextStage;
      setDownloadStatus({ active: nextStage !== 'done', stage: nextStage, error: null, ...extra });
      log.info(`精準對時元件安裝階段：${nextStage}`);
      onProgress?.(getDownloadStatus());
    };
    try {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      safeRemove(tmpPythonDir);
      progress('disk-space-check');
      const disk = inspectDiskSpace(RUNTIME_DIR, { thresholdBytes: REQUIRED_DISK_BYTES });
      if (disk.known && disk.low) {
        throw new Error(`磁碟空間不足：需要約 ${Math.round(REQUIRED_DISK_BYTES / 1024 / 1024)}MB，目前可用約 ${Math.round(disk.freeBytes / 1024 / 1024)}MB。`);
      }

      const marker = readMarker();
      const pythonReady = marker && marker.pythonEmbedVersion === PYTHON_EMBED_VERSION
        && marker.packagesRevision === PACKAGES_REVISION && fs.existsSync(PYTHON_EXE);
      if (!pythonReady) {
        progress('download-python', { downloadedBytes: 0, totalBytes: null, percent: 0 });
        const tmpZip = path.join(RUNTIME_DIR, 'python-embed.download.zip');
        safeRemove(tmpZip);
        const pyResult = await fetchToFile(PYTHON_EMBED_URL, tmpZip, {
          maxBytes: MAX_ZIP_BYTES,
          abortSignal,
          onProgress: (p) => { setDownloadStatus({ active: true, stage: 'download-python', ...p, error: null }); onProgress?.(getDownloadStatus()); },
        });
        if (pyResult.sha256 !== PYTHON_EMBED_SHA256) throw new Error('Python embeddable SHA-256 驗證失敗，已拒絕使用此檔案');
        progress('extract-python');
        const AdmZip = require('adm-zip');
        safeExtractAll(new AdmZip(tmpZip), tmpPythonDir);
        enableSitePackages(tmpPythonDir);
        safeRemove(tmpZip);

        progress('bootstrap-pip');
        fs.writeFileSync(path.join(tmpPythonDir, 'get-pip.py'), verifyGetPip(await fetchToBuffer(GET_PIP_URL, { maxBytes: 5 * 1024 * 1024 })));
        const tmpPythonExe = path.join(tmpPythonDir, 'python.exe');
        await packageTrust.bootstrapPackages(tmpPythonDir, fetchToBuffer,
          args => runPythonStep(args, { cwd: tmpPythonDir, pythonExe: tmpPythonExe, abortSignal }), { abortSignal });

        progress('install-packages', { step: 'pip-resolve', detail: null, downloadedBytes: 0, totalBytes: null, percent: null });
        fs.writeFileSync(REQUIREMENTS_FILE, `${PIP_REQUIREMENTS.join('\n')}\n`, 'utf8');
        await runPythonStep(['-m', 'pip', 'install', '--no-warn-script-location', '--progress-bar', 'on', '--only-binary', ':all:',
          '--no-deps', '--require-hashes', '-r', REQUIREMENTS_FILE], {
          cwd: tmpPythonDir,
          pythonExe: tmpPythonExe,
          abortSignal,
          onOutput: (text) => {
            const p = parseToolProgress(text);
            if (Object.keys(p).length) { setDownloadStatus({ active: true, stage: 'install-packages', error: null, ...p }); onProgress?.(getDownloadStatus()); }
          },
        });
        progress('install-python');
        safeRemove(PYTHON_DIR);
        fs.renameSync(tmpPythonDir, PYTHON_DIR);
        fs.writeFileSync(MARKER_FILE, JSON.stringify({ pythonEmbedVersion: PYTHON_EMBED_VERSION, packagesRevision: PACKAGES_REVISION }, null, 2), 'utf8');
      }

      let files = null;
      if (!forceCpu) {
        progress('download-model', { downloadedBytes: 0, totalBytes: null, percent: 0 });
        files = await downloadModel('dml', { onProgress, abortSignal });
        progress('warmup', { detail: 'gpu' });
        try {
          await warmup(files, { abortSignal });
        } catch (err) {
          if (abortSignal?.aborted) throw err;
          log.warn(`精準對時：顯示卡跑不起來，改用 CPU 版模型（${String(err.message).split('\n')[0]}）`);
          safeRemove(path.join(MODEL_ROOT, MODELS.dml.dir));
          files = null;
        }
      }
      if (!files) {
        progress('download-model', { detail: 'cpu', downloadedBytes: 0, totalBytes: null, percent: 0 });
        files = await downloadModel('cpu', { onProgress, abortSignal });
        progress('warmup', { detail: 'cpu' });
        await warmup(files, { abortSignal });
      }

      fs.writeFileSync(MARKER_FILE, JSON.stringify({
        pythonEmbedVersion: PYTHON_EMBED_VERSION,
        packagesRevision: PACKAGES_REVISION,
        device: files.device,
        installedAt: new Date().toISOString(),
      }, null, 2), 'utf8');
      progress('done', { active: false, percent: 100, detail: files.device });
      log.info(`精準對時元件安裝完成（${files.device === 'dml' ? '顯示卡' : 'CPU'}）：${RUNTIME_DIR}`);
      return { ok: true, ...files };
    } catch (err) {
      err.stage = err.stage || stage;
      setDownloadStatus({ active: false, stage: 'error', error: err.message.split('\n')[0] });
      log.error(`精準對時元件安裝失敗（stage=${err.stage}）`, err);
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

function cancelledError() {
  return Object.assign(new Error('安裝已取消'), { code: 'CANCELLED' });
}

/** Mac 內測版診斷（只有類別）；Windows 與非內測版在 mac-beta-diagnostics 裡就不動作 */
function reportMacInstall(code) {
  try { require('./mac-beta-diagnostics').component('align_install', code); } catch (_) { /* 診斷不影響安裝 */ }
}

/** 安裝失敗 → 診斷白名單代碼（只看錯誤代碼與失敗的階段，不看訊息內容） */
function classifyMacInstallError(err) {
  const code = err && err.code;
  if (code === 'CANCELLED') return 'cancelled';
  if (code === 'MAC_UNSUPPORTED') return 'unsupported';
  if (code === 'DISK_FULL') return 'disk_full';
  if (code === 'HASH_MISMATCH') return 'hash_mismatch';
  if (code === 'EXTRACT_FAILED') return 'extract_failed';
  switch (err && err.stage) {
    case 'download-python': return 'download_failed';
    case 'verify-python': return 'hash_mismatch';
    case 'extract': return 'extract_failed';
    case 'install-packages': return 'pip_failed';
    case 'download-model': case 'extract-model': return 'model_failed';
    case 'warmup': return 'warmup_failed';
    default: return 'other';
  }
}

/**
 * macOS（Apple Silicon）：python-build-standalone＋align-mac 鎖定清單＋int8 模型，只走 CPU。
 * 跟 Windows 同一套原則：Python 與套件先裝在 python.download，全部成功才 rename 進正式路徑；
 * 模型驗 SHA-256；最後在 CPU 上空跑一次才寫入 device。任何一步失敗或取消都清掉半成品
 * （已經完整裝好的 Python 保留，下次重試只補模型）。
 */
async function downloadMacRuntime({
  onProgress, abortSignal, fetchFileImpl = fetchToFile, runPythonStepImpl = runPythonStep,
  inspectDiskSpaceImpl = inspectDiskSpace, extractImpl, stripQuarantineImpl, supportImpl = platformSupport, warmupImpl = warmup,
} = {}) {
  const support = supportImpl({ platform: 'darwin' });
  if (!support.supported) {
    const err = Object.assign(new Error(support.reason === 'intel'
      ? '這台 Mac 不支援精準對時：需要 Apple Silicon（M 系列）晶片。'
      : '這台 Mac 不支援精準對時：需要 macOS 14 以上。'), { code: 'MAC_UNSUPPORTED', reason: support.reason });
    setDownloadStatus({ active: false, stage: 'error', error: err.message, errorCode: err.code });
    reportMacInstall('unsupported');
    throw err;
  }
  if (downloadInFlight) return downloadInFlight;
  downloadInFlight = (async () => {
    if (isAvailable()) {
      setDownloadStatus({ active: false, stage: 'done', percent: 100, error: null, errorCode: null });
      return { ok: true, ...getInstalled() };
    }
    const tmpTar = path.join(RUNTIME_DIR, 'python-mac.download.tar.gz');
    const tmpRoot = path.join(RUNTIME_DIR, 'python.download');
    const model = MODELS.cpu;
    let stage = 'start';
    const progress = (nextStage, extra = {}) => {
      if (abortSignal?.aborted && nextStage !== 'done') throw cancelledError();
      stage = nextStage;
      setDownloadStatus({ active: nextStage !== 'done', stage: nextStage, error: null, errorCode: null, ...extra });
      log.info(`精準對時元件（Mac）安裝階段：${nextStage}`);
      onProgress?.(getDownloadStatus());
    };
    try {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      safeRemove(tmpTar);
      safeRemove(tmpRoot);
      progress('disk-space-check');
      const disk = inspectDiskSpaceImpl(RUNTIME_DIR, { thresholdBytes: MAC_REQUIRED_DISK_BYTES });
      if (disk.known && disk.low) {
        throw Object.assign(new Error(`磁碟空間不足：需要約 ${Math.round(MAC_REQUIRED_DISK_BYTES / 1e6)}MB，目前可用約 ${Math.round(disk.freeBytes / 1024 / 1024)}MB。`), { code: 'DISK_FULL' });
      }

      const pythonReady = markerMatches(readMarker(), 'darwin') && fs.existsSync(PYTHON_EXE);
      if (!pythonReady) {
        const { tmpPythonDir, tmpPythonExe } = await fetchMacPython({
          tmpTar, tmpRoot, progress, fetchFileImpl, extractImpl, stripQuarantineImpl, abortSignal,
          onDownloadProgress: (p) => { setDownloadStatus({ active: true, stage: 'download-python', ...p, error: null }); onProgress?.(getDownloadStatus()); },
        });
        progress('install-packages', { step: 'pip-resolve', detail: null, downloadedBytes: 0, totalBytes: null, percent: null });
        await runPythonStepImpl(packageTrust.macInstallArgs('align-mac', tmpRoot), {
          cwd: tmpRoot,
          pythonExe: tmpPythonExe,
          timeoutMs: 15 * 60 * 1000,
          abortSignal,
          onOutput: (text) => {
            const p = parseToolProgress(text);
            if (Object.keys(p).length) { setDownloadStatus({ active: true, stage: 'install-packages', error: null, ...p }); onProgress?.(getDownloadStatus()); }
          },
        });
        progress('install-python');
        safeRemove(PYTHON_DIR);
        fs.renameSync(tmpPythonDir, PYTHON_DIR);
        fs.writeFileSync(MARKER_FILE, JSON.stringify(expectedMarker('darwin'), null, 2), 'utf8');
      }

      progress('download-model', { detail: 'cpu', downloadedBytes: 0, totalBytes: null, percent: 0 });
      const files = await downloadModel('cpu', { onProgress, abortSignal, fetchFileImpl, runPythonStepImpl });
      progress('warmup', { detail: 'cpu' });
      await warmupImpl(files, { abortSignal, runPythonStepImpl });

      fs.writeFileSync(MARKER_FILE, JSON.stringify({
        ...expectedMarker('darwin'),
        device: files.device,
        installedAt: new Date().toISOString(),
      }, null, 2), 'utf8');
      progress('done', { active: false, percent: 100, detail: files.device });
      log.info(`精準對時元件（Mac，CPU）安裝完成：${RUNTIME_DIR}`);
      reportMacInstall('ok');
      return { ok: true, ...files };
    } catch (err) {
      err.stage = err.stage || stage;
      // 模型或空跑沒完成：模型資料夾與下載暫存都不留（Python 若已完整裝好就保留）
      safeRemove(path.join(RUNTIME_DIR, `${model.archive}.download`));
      safeRemove(path.join(MODEL_ROOT, model.dir));
      if (err.code === 'CANCELLED') {
        setDownloadStatus({ active: false, stage: 'cancelled', error: null, errorCode: 'CANCELLED' });
      } else {
        setDownloadStatus({ active: false, stage: 'error', error: err.message.split('\n')[0], errorCode: err.code || null });
        log.error(`精準對時元件（Mac）安裝失敗（stage=${err.stage}）`, err);
      }
      reportMacInstall(classifyMacInstallError(err));
      throw err;
    } finally {
      safeRemove(tmpTar);
      safeRemove(tmpRoot);
    }
  })();
  try {
    return await downloadInFlight;
  } finally {
    downloadInFlight = null;
  }
}

let autoInstallAttempted = false;

function isInstalling() {
  return !!downloadInFlight;
}

/**
 * 不用使用者按的背景安裝：AI 伴奏元件裝完時、或已經裝好人聲分離的人第一次對中文歌自動對時時。
 * Mac 跟 Windows 同一套時機（都是使用者已經裝了人聲分離之後），只是裝的是 CPU 版。
 * 不在程式啟動時自動下載：最後一步要在顯示卡上編譯約 1 分鐘，直播中可能讓 OBS 掉幀。
 * 每次啟動程式最多自動試一次，失敗就等使用者在設定頁按重試。回傳是否正在安裝。
 */
function autoInstall(reason, { platform = process.platform, supportImpl = platformSupport, downloadImpl = downloadRuntime } = {}) {
  // Windows 照舊；Mac 只在 Apple Silicon＋macOS 14 以上才試（Intel、舊版 macOS 一律不下載）
  if (platform !== 'win32' && !(platform === 'darwin' && supportImpl({ platform }).supported)) return false;
  if (isAvailable()) return false;
  if (downloadInFlight) return true;
  if (autoInstallAttempted) return false;
  autoInstallAttempted = true;
  log.info(`背景安裝精準對時元件（${reason}）`);
  downloadImpl({ platform }).catch((err) => log.warn(`精準對時元件背景安裝失敗：${String(err.message).split('\n')[0]}`));
  return true;
}

/** 顯示卡版用到一半壞掉（例如換了顯示卡）時，改成 CPU 版：只換模型，Python 環境沿用。 */
async function switchToCpu(opts = {}) {
  const marker = readMarker();
  if (marker) fs.writeFileSync(MARKER_FILE, JSON.stringify({ ...marker, device: null }, null, 2), 'utf8');
  return downloadRuntime({ ...opts, forceCpu: true });
}

/**
 * 設定頁與 runtime-status 用：是否支援、原因、平台與（Mac 上）照實的大小。
 * Windows 回傳的欄位跟以前一樣是 supported:true，前端顯示不變。
 */
function getStatusInfo({ platform = process.platform, supportImpl = platformSupport } = {}) {
  const support = supportImpl({ platform });
  const info = { platform, supported: support.supported, unsupportedReason: support.reason };
  if (platform === 'darwin') {
    Object.assign(info, {
      expectedDownloadBytes: MAC_EXPECTED_DOWNLOAD_BYTES,
      expectedInstalledBytes: MAC_EXPECTED_INSTALLED_BYTES,
      requiredFreeBytes: MAC_REQUIRED_DISK_BYTES,
    });
  }
  return info;
}

function resetForTests() {
  downloadInFlight = null;
  autoInstallAttempted = false;
  downloadStatus = { active: false, stage: 'idle', percent: null, error: null, updatedAt: null };
}

module.exports = {
  isAvailable,
  getInstalled,
  downloadRuntime,
  switchToCpu,
  autoInstall,
  isInstalling,
  getDownloadStatus,
  getStatusInfo,
  platformSupport,
  classifyMacInstallError,
  workerScript,
  workerEnv,
  RUNTIME_DIR,
  PYTHON_EXE,
  MARKER_FILE,
  MODELS,
  PIP_REQUIREMENTS,
  PACKAGES_REVISION,
  PYTHON_EMBED_VERSION,
  MAC_PACKAGES_REVISION,
  MAC_EXPECTED_DOWNLOAD_BYTES,
  MAC_EXPECTED_INSTALLED_BYTES,
  MAC_REQUIRED_DISK_BYTES,
  _resetForTests: resetForTests,
};
