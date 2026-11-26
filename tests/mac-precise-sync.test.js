'use strict';

// macOS（Apple Silicon）的精準對時元件：支援條件、鎖定清單與雜湊、安裝流程（只走 CPU／int8）、
// 失敗時清掉半成品、背景自動安裝只在支援的機器上試，以及 Windows 行為不變。
// 全部在 Linux 上用替身跑，不連網、不跑 Python。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-precise-sync-'));
for (const [name, dir] of Object.entries({ ELITESAND_DATA_DIR: 'data', ELITESAND_DOWNLOADS_DIR: 'downloads', ELITESAND_LOGS_DIR: 'logs' })) {
  process.env[name] = path.join(tmpRoot, dir);
}

const provider = require('../server/services/align-runtime-provider');
const trust = require('../server/services/python-package-trust');
const { MAC_PYTHON, MAC_ALIGN_RUNTIME_ID, MAC_RUNTIME_ID } = require('../server/services/python-mac-runtime-trust');
const alignJobs = require('../server/services/align-model-jobs');

const ROOT = path.join(__dirname, '..');
const LOCKS = path.join(ROOT, 'server', 'services', 'python-locks');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const SUPPORTED = () => ({ supported: true, reason: null });
const roomyDisk = () => ({ known: true, low: false, freeBytes: 100 * 1024 ** 3 });

test('支援條件：Windows 一律支援；Mac 只有 Apple Silicon＋macOS 14（Darwin 23）以上', () => {
  assert.deepEqual(provider.platformSupport({ platform: 'win32', arch: 'x64' }), { supported: true, reason: null });
  assert.deepEqual(provider.platformSupport({ platform: 'darwin', arch: 'arm64', release: '23.0.0' }), { supported: true, reason: null });
  assert.deepEqual(provider.platformSupport({ platform: 'darwin', arch: 'arm64', release: '25.2.0' }), { supported: true, reason: null });
  assert.deepEqual(provider.platformSupport({ platform: 'darwin', arch: 'arm64', release: '22.6.0' }), { supported: false, reason: 'macos_old' });
  assert.deepEqual(provider.platformSupport({ platform: 'darwin', arch: 'x64', release: '24.0.0' }), { supported: false, reason: 'intel' });
  assert.equal(provider.platformSupport({ platform: 'linux', arch: 'x64' }).supported, false);
});

test('Windows 不變：套件清單、版本號、marker、Python 路徑與 DirectML 優先的流程', () => {
  // 改 Windows 清單就要 PACKAGES_REVISION +1；這裡把目前的內容釘住，避免順手改到
  assert.equal(crypto.createHash('sha256').update(provider.PIP_REQUIREMENTS.join('\n')).digest('hex'),
    '5a555cd857ccb1e42a94460ec0fb215c3acf4e7ae3deddaf7b5fe254f0a5995f');
  assert.ok(provider.PIP_REQUIREMENTS.some((r) => r.startsWith('onnxruntime-directml==1.24.4 ')));
  assert.equal(provider.PACKAGES_REVISION, 1);
  assert.equal(provider.PYTHON_EMBED_VERSION, '3.11.9');
  // Windows（以及其他非 darwin）是 embeddable 的 python.exe；在 Mac 上跑這支測試時是 bin/python3
  assert.equal(provider.PYTHON_EXE, process.platform === 'darwin'
    ? path.join(provider.RUNTIME_DIR, 'python', 'bin', 'python3')
    : path.join(provider.RUNTIME_DIR, 'python', 'python.exe'));
  const win = provider.getStatusInfo({ platform: 'win32' });
  assert.equal(win.supported, true);
  assert.equal(win.expectedDownloadBytes, undefined, 'Windows 的 runtime-status 不多帶 Mac 的大小');
  const source = read('server', 'services', 'align-runtime-provider.js');
  const winBody = source.slice(source.indexOf('async function downloadRuntime('), source.indexOf('function cancelledError('));
  assert.ok(winBody.includes("if (platform === 'darwin') return downloadMacRuntime("));
  assert.ok(winBody.includes('PYTHON_EMBED_URL') && winBody.includes("downloadModel('dml'") && winBody.includes("downloadModel('cpu'"),
    'Windows 仍先試顯示卡（fp16），失敗才改 int8');
});

test('非 Windows／Mac：安裝直接拒絕', async () => {
  provider._resetForTests();
  await assert.rejects(provider.downloadRuntime({ platform: 'linux' }), /只支援 Windows/);
});

test('背景自動安裝：Windows 照舊；Mac 只在支援的機器上試；每次啟動最多一次', () => {
  const calls = [];
  const downloadImpl = (opts) => { calls.push(opts.platform); return Promise.resolve(); };
  for (const reason of ['intel', 'macos_old']) {
    provider._resetForTests();
    assert.equal(provider.autoInstall('test', { platform: 'darwin', supportImpl: () => ({ supported: false, reason }), downloadImpl }), false);
  }
  provider._resetForTests();
  assert.equal(provider.autoInstall('test', { platform: 'linux', downloadImpl }), false);
  assert.deepEqual(calls, [], '不支援的機器連下載都不開始');

  provider._resetForTests();
  assert.equal(provider.autoInstall('test', { platform: 'darwin', supportImpl: SUPPORTED, downloadImpl }), true);
  assert.equal(provider.autoInstall('test', { platform: 'darwin', supportImpl: SUPPORTED, downloadImpl }), false);
  provider._resetForTests();
  assert.equal(provider.autoInstall('test', { platform: 'win32', downloadImpl }), true);
  assert.equal(provider.autoInstall('test', { platform: 'win32', downloadImpl }), false);
  assert.deepEqual(calls, ['darwin', 'win32']);
  provider._resetForTests();
});

test('Mac 鎖定清單：受 manifest 雜湊保護、每個套件都有雜湊、CPU 版 onnxruntime、版本跟 Windows 一致', () => {
  const bytes = trust.readLock('align-mac');
  const lock = bytes.toString('utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(LOCKS, 'manifest.json'), 'utf8'));
  assert.equal(manifest.locks['align-mac'].file, 'align-mac-arm64-py312.lock');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.locks['align-mac'].sha256);
  const pins = Object.fromEntries((lock.match(/^[a-z0-9_.-]+==\S+/gim) || []).map((p) => p.split('==')));
  assert.deepEqual(Object.keys(pins).sort(),
    ['flatbuffers', 'kaldi-native-fbank', 'mpmath', 'numpy', 'onnxruntime', 'packaging', 'protobuf', 'sentencepiece', 'sympy']);
  for (const block of lock.split(/\n(?=[a-z0-9])/i).filter((b) => /==/.test(b))) {
    assert.match(block, /--hash=sha256:[a-f0-9]{64}/, `沒有雜湊：${block.split('\n')[0]}`);
  }
  const winPins = Object.fromEntries(provider.PIP_REQUIREMENTS.map((r) => r.split(' ')[0].split('==')));
  for (const name of ['numpy', 'sentencepiece', 'kaldi-native-fbank', 'flatbuffers', 'protobuf', 'sympy', 'mpmath']) {
    assert.equal(pins[name], winPins[name], `${name} 的版本要跟 Windows 一樣`);
  }
  assert.equal(pins.onnxruntime, winPins['onnxruntime-directml']);
  assert.doesNotMatch(lock, /onnxruntime-(?:directml|gpu)|torch/i);
  const args = trust.macInstallArgs('align-mac', fs.mkdtempSync(path.join(tmpRoot, 'args-')));
  for (const flag of ['--isolated', '--require-hashes', '--no-deps', '--only-binary=:all:']) assert.ok(args.includes(flag), flag);
});

test('Mac marker 跟 AI 分離分開：同一個釘死的 Python，不同的 runtime 版本字串與資料夾', () => {
  assert.notEqual(MAC_ALIGN_RUNTIME_ID, MAC_RUNTIME_ID);
  assert.ok(MAC_ALIGN_RUNTIME_ID.startsWith(`pbs-${MAC_PYTHON.version}+${MAC_PYTHON.release}/`));
  assert.equal(path.basename(provider.RUNTIME_DIR), 'align-runtime');
  assert.notEqual(provider.RUNTIME_DIR, require('../server/services/ai-runtime-provider').RUNTIME_DIR);
});

test('Mac 的大小照實：下載量涵蓋 Python＋套件＋int8 模型，需要的空間大於安裝後大小＋下載暫存', () => {
  const info = provider.getStatusInfo({ platform: 'darwin', supportImpl: SUPPORTED });
  assert.equal(info.platform, 'darwin');
  assert.equal(info.supported, true);
  assert.ok(info.expectedDownloadBytes > MAC_PYTHON.size + 50e6, '至少要含 Python 與 int8 模型（壓縮檔約 51MB）');
  assert.ok(info.expectedDownloadBytes < 200e6);
  assert.ok(info.requiredFreeBytes >= info.expectedInstalledBytes + info.expectedDownloadBytes);
  const unsupported = provider.getStatusInfo({ platform: 'darwin', supportImpl: () => ({ supported: false, reason: 'intel' }) });
  assert.deepEqual([unsupported.supported, unsupported.unsupportedReason], [false, 'intel']);
});

/** 安裝流程的替身：記下下載過哪些網址、pip 參數，並在對的時機建立對的檔案 */
function fakeInstall({ failAt = null } = {}) {
  const fetched = [];
  const steps = [];
  return {
    fetched,
    steps,
    opts: {
      supportImpl: SUPPORTED,
      inspectDiskSpaceImpl: roomyDisk,
      fetchFileImpl: async (url, file) => {
        fetched.push(url);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'x');
        if (failAt === 'download-model' && url.endsWith('.tar.bz2')) throw new Error('HTTP 503');
        return { sha256: url === MAC_PYTHON.url ? MAC_PYTHON.sha256 : provider.MODELS.cpu.sha256 };
      },
      extractImpl: async (_file, dir) => {
        fs.mkdirSync(path.join(dir, 'python', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'python', 'bin', 'python3'), '#!/bin/sh\n', { mode: 0o755 });
      },
      stripQuarantineImpl: async () => {},
      runPythonStepImpl: async (args, options) => {
        steps.push({ args, pythonExe: options.pythonExe });
        if (args.includes('pip')) {
          if (failAt === 'install-packages') throw new Error('指令失敗（exit 1）');
          return;
        }
        // 模型解壓（tarfile，data 過濾器）
        const target = args[args.length - 1];
        const dir = path.join(target, provider.MODELS.cpu.dir);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, provider.MODELS.cpu.file), 'onnx');
        fs.writeFileSync(path.join(dir, 'bbpe.model'), 'bpe');
      },
      warmupImpl: async (files) => {
        steps.push({ warmup: files.device });
        if (failAt === 'warmup') throw new Error('onnxruntime crashed');
      },
    },
  };
}

function cleanRuntime() {
  provider._resetForTests();
  fs.rmSync(provider.RUNTIME_DIR, { recursive: true, force: true });
}

test('Mac 安裝：Python＋align-mac 鎖定清單＋只下載 int8 模型，CPU 空跑一次後才算裝好', async () => {
  cleanRuntime();
  const fake = fakeInstall();
  const result = await provider.downloadRuntime({ platform: 'darwin', ...fake.opts });
  assert.equal(result.ok, true);
  assert.equal(result.device, 'cpu');
  assert.deepEqual(fake.fetched, [MAC_PYTHON.url, `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${provider.MODELS.cpu.archive}`],
    '不下載 fp16（DirectML）模型');
  const pip = fake.steps.find((s) => s.args && s.args.includes('pip'));
  assert.ok(pip.args.includes('--require-hashes') && pip.args.includes('--no-deps') && pip.args.includes('--only-binary=:all:'));
  assert.match(pip.args[pip.args.length - 1], /align-mac/);
  assert.match(pip.pythonExe, /python\.download[\\/]python[\\/]bin[\\/]python3$/, 'pip 在暫存目錄裡的 Python 上跑，成功才搬進正式路徑');
  assert.ok(fake.steps.some((s) => s.warmup === 'cpu'));
  const marker = JSON.parse(fs.readFileSync(provider.MARKER_FILE, 'utf8'));
  assert.equal(marker.pythonEmbedVersion, MAC_ALIGN_RUNTIME_ID);
  assert.equal(marker.packagesRevision, provider.MAC_PACKAGES_REVISION);
  assert.equal(marker.device, 'cpu');
  assert.ok(fs.existsSync(path.join(provider.RUNTIME_DIR, 'python', 'bin', 'python3')));
  for (const leftover of ['python.download', 'python-mac.download.tar.gz', `${provider.MODELS.cpu.archive}.download`]) {
    assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, leftover)), false, leftover);
  }
  assert.equal(provider.getDownloadStatus().stage, 'done');
});

test('Mac 安裝：CPU 空跑失敗時模型與暫存都清掉、marker 不寫 device，狀態帶錯誤', async () => {
  cleanRuntime();
  const fake = fakeInstall({ failAt: 'warmup' });
  await assert.rejects(provider.downloadRuntime({ platform: 'darwin', ...fake.opts }), (err) => err.stage === 'warmup');
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, 'model', provider.MODELS.cpu.dir)), false);
  assert.equal(JSON.parse(fs.readFileSync(provider.MARKER_FILE, 'utf8')).device, undefined);
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, 'python.download')), false);
  const status = provider.getDownloadStatus();
  assert.equal(status.stage, 'error');
  assert.equal(status.active, false);
  assert.equal(provider.classifyMacInstallError({ stage: 'warmup' }), 'warmup_failed');
});

test('Mac 安裝：pip 失敗時正式路徑沒有半套 Python，暫存清掉', async () => {
  cleanRuntime();
  const fake = fakeInstall({ failAt: 'install-packages' });
  await assert.rejects(provider.downloadRuntime({ platform: 'darwin', ...fake.opts }), (err) => err.stage === 'install-packages');
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, 'python')), false);
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, 'python.download')), false);
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, 'python-mac.download.tar.gz')), false);
  assert.equal(fs.existsSync(provider.MARKER_FILE), false);
  assert.equal(fake.fetched.length, 1, '套件沒裝好就不下載模型');
});

test('Mac 安裝：模型下載失敗時清掉下載暫存', async () => {
  cleanRuntime();
  const fake = fakeInstall({ failAt: 'download-model' });
  await assert.rejects(provider.downloadRuntime({ platform: 'darwin', ...fake.opts }), (err) => err.stage === 'download-model');
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, `${provider.MODELS.cpu.archive}.download`)), false);
  assert.equal(provider.classifyMacInstallError({ stage: 'download-model' }), 'model_failed');
});

test('Mac 安裝：Intel／舊系統、磁碟空間不足、Python 雜湊不符都在動手前停下', async () => {
  for (const reason of ['intel', 'macos_old']) {
    cleanRuntime();
    const fake = fakeInstall();
    await assert.rejects(provider.downloadRuntime({ platform: 'darwin', ...fake.opts, supportImpl: () => ({ supported: false, reason }) }),
      (err) => err.code === 'MAC_UNSUPPORTED' && err.reason === reason);
    assert.deepEqual(fake.fetched, []);
    assert.equal(provider.getDownloadStatus().errorCode, 'MAC_UNSUPPORTED');
  }
  cleanRuntime();
  let fake = fakeInstall();
  await assert.rejects(provider.downloadRuntime({ platform: 'darwin', ...fake.opts, inspectDiskSpaceImpl: () => ({ known: true, low: true, freeBytes: 100e6 }) }),
    (err) => err.code === 'DISK_FULL');
  assert.deepEqual(fake.fetched, []);
  assert.equal(provider.getDownloadStatus().errorCode, 'DISK_FULL');
  cleanRuntime();
  fake = fakeInstall();
  let extracted = false;
  await assert.rejects(provider.downloadRuntime({
    platform: 'darwin', ...fake.opts,
    fetchFileImpl: async (url, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); return { sha256: '0'.repeat(64) }; },
    extractImpl: async () => { extracted = true; },
  }), (err) => err.code === 'HASH_MISMATCH');
  assert.equal(extracted, false);
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, 'python-mac.download.tar.gz')), false);
  cleanRuntime();
});

test('安裝失敗的診斷代碼只有白名單裡的類別', () => {
  const fields = require('../server/services/mac-beta-diag-fields');
  const cases = [
    [{ code: 'CANCELLED' }, 'cancelled'], [{ code: 'MAC_UNSUPPORTED' }, 'unsupported'], [{ code: 'DISK_FULL' }, 'disk_full'],
    [{ code: 'HASH_MISMATCH' }, 'hash_mismatch'], [{ stage: 'download-python' }, 'download_failed'], [{ stage: 'extract' }, 'extract_failed'],
    [{ stage: 'install-packages' }, 'pip_failed'], [{ stage: 'extract-model' }, 'model_failed'], [{ message: '/Users/a/x' }, 'other'],
  ];
  for (const [err, code] of cases) {
    assert.equal(provider.classifyMacInstallError(err), code);
    assert.ok(fields.COMPONENTS.align_install.includes(code), code);
  }
});

test('精準對時結果的分類：整首看信心門檻、逐句看有沒有對到', () => {
  assert.equal(alignJobs._verdictOf('global', { results: { current: { peakZ: 8, peakRatio: 3, offsetMs: 0, units: 40 } } }), 'confident');
  assert.equal(alignJobs._verdictOf('global', { results: { current: { peakZ: 3, peakRatio: 1.1, offsetMs: 0, units: 40 } } }), 'low_confidence');
  assert.equal(alignJobs._verdictOf('global', { results: { current: { units: 5 } } }), 'too_few_units');
  assert.equal(alignJobs._verdictOf('lines', { onsets: { 0: 1200 }, conf: { 0: -1 } }), 'aligned');
  assert.equal(alignJobs._verdictOf('lines', { onsets: {}, conf: {} }), 'none');
  assert.equal(alignJobs._verdictOf('global', null), 'none');
});

test('路由、打包與介面：Mac 依支援條件開放下載，align_worker.py 打包進 Resources/tools/ai，五語文字齊全', () => {
  const routes = read('server', 'routes', 'api', 'separation.js');
  assert.ok(routes.includes('alignRuntimeProvider.getStatusInfo()'));
  assert.ok(routes.includes('alignRuntimeProvider.platformSupport()'));
  assert.ok(!routes.includes("supported: process.platform === 'win32',\n    ...alignRuntimeProvider"), '精準對時的 supported 不再寫死只有 Windows');
  assert.match(read('tools', 'build-mac.js'), /AI_SIDECAR_SCRIPTS = \[[^\]]*'align_worker\.py'/);
  global.window = global.window || {};
  const i18nSource = read('public', 'js', 'i18n.js');
  for (const key of ['alignModel.hintMac', 'alignModel.installedCpuMac', 'alignModel.stageWarmupCpu', 'alignModel.unsupportedIntel', 'alignModel.unsupportedOs', 'alignModel.diskFull', 'alignModel.unsupported']) {
    const line = i18nSource.split('\n').find((l) => l.includes(`'${key}':`));
    assert.ok(line, key);
    const values = JSON.parse(line.slice(line.indexOf('['), line.lastIndexOf(']') + 1));
    assert.equal(values.length, 5, key);
    for (const value of values) assert.ok(value.trim(), key);
  }
  assert.match(i18nSource, /'alignModel\.unsupportedOs': \["[^"]*macOS 14/, '提示的最低版本要跟預檢（Darwin 23＝macOS 14）一致');
  const client = read('public', 'js', 'align-model-client.js');
  for (const key of ['alignModel.hintMac', 'alignModel.installedCpuMac', 'alignModel.unsupportedIntel', 'alignModel.unsupportedOs', 'alignModel.diskFull']) assert.ok(client.includes(key), key);
  // 段落分析這輪仍是「Mac 版暫不支援」
  assert.ok(routes.includes("if (process.platform !== 'win32') return res.status(409).json({ ok: false, error: 'UNSUPPORTED_PLATFORM' });"));
});
