'use strict';

// macOS（Apple Silicon）的 AI 人聲分離與練唱音高：平台分支、就緒判斷、元件清單與雜湊、
// Python 路徑、預檢不過時不下載、Windows 行為不變。全部在 Linux 上用替身跑，不連網、不跑 Python。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-ai-separation-'));
for (const [name, dir] of Object.entries({ ELITESAND_DATA_DIR: 'data', ELITESAND_DOWNLOADS_DIR: 'downloads', ELITESAND_LOGS_DIR: 'logs' })) {
  process.env[name] = path.join(tmpRoot, dir);
}

const provider = require('../server/services/ai-runtime-provider');
const trust = require('../server/services/python-package-trust');
const { MAC_PYTHON, MAC_RUNTIME_ID } = require('../server/services/python-mac-runtime-trust');
const bundle = require('../server/services/ai-separation-bundle');

const LOCKS = path.join(__dirname, '..', 'server', 'services', 'python-locks');

test('Python 路徑依平台：Windows 是 python.exe，Mac 是 bin/python3', () => {
  assert.equal(provider.pythonExeFor('win32', '/r/python'), path.join('/r/python', 'python.exe'));
  assert.equal(provider.pythonExeFor('darwin', '/r/python'), path.join('/r/python', 'bin', 'python3'));
  assert.equal(provider.sitePackagesFor('darwin', '/r/python'), path.join('/r/python', 'lib', 'python3.12', 'site-packages'));
  assert.equal(provider.sitePackagesFor('win32', '/r/python'), path.join('/r/python', 'Lib', 'site-packages'));
  assert.equal(provider.practicePitchModelFile('/r/python', 'darwin'),
    path.join('/r/python', 'lib', 'python3.12', 'site-packages', 'torchcrepe', 'assets', 'tiny.pth'));
  assert.equal(provider.expectedRuntimeId('win32'), '3.11.9', 'Windows 的 marker 版本不能變（變了既有安裝會被判成要重裝）');
  assert.equal(provider.expectedRuntimeId('darwin'), MAC_RUNTIME_ID);
});

test('Mac 支援條件：只有 Apple Silicon＋macOS 14（Darwin 23）以上；Windows 一律支援', () => {
  assert.deepEqual(provider.macSupport({ platform: 'win32', arch: 'x64' }), { supported: true, reason: null });
  assert.deepEqual(provider.macSupport({ platform: 'darwin', arch: 'arm64', release: '23.0.0' }), { supported: true, reason: null });
  assert.deepEqual(provider.macSupport({ platform: 'darwin', arch: 'arm64', release: '25.1.0' }), { supported: true, reason: null });
  assert.deepEqual(provider.macSupport({ platform: 'darwin', arch: 'arm64', release: '22.6.0' }), { supported: false, reason: 'macos_old' });
  assert.deepEqual(provider.macSupport({ platform: 'darwin', arch: 'x64', release: '24.0.0' }), { supported: false, reason: 'intel' });
  assert.equal(provider.macSupport({ platform: 'linux', arch: 'x64' }).supported, false);
});

test('Mac 的 Python runtime 信任根：官方 https 來源、釘死 SHA-256 與大小、aarch64', () => {
  assert.match(MAC_PYTHON.url, /^https:\/\/github\.com\/astral-sh\/python-build-standalone\/releases\/download\/\d{8}\//);
  assert.match(MAC_PYTHON.url, /aarch64-apple-darwin-install_only\.tar\.gz$/);
  assert.match(MAC_PYTHON.sha256, /^[a-f0-9]{64}$/);
  assert.ok(MAC_PYTHON.size > 10e6 && MAC_PYTHON.size < 80e6);
  assert.equal(decodeURIComponent(MAC_PYTHON.url.split('/').pop()), MAC_PYTHON.file);
});

test('Mac 鎖定清單：受 manifest 雜湊保護、每個套件都有雜湊、不含 diffq 與 CUDA 套件', () => {
  const bytes = trust.readLock('ai-mac');
  const lock = bytes.toString('utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(LOCKS, 'manifest.json'), 'utf8'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.locks['ai-mac'].sha256);
  const packages = lock.match(/^[a-z0-9_.-]+==\S+/gim);
  assert.ok(packages.length > 40);
  for (const block of lock.split(/\n(?=[a-z0-9])/i).filter((b) => /==/.test(b))) {
    assert.match(block, /--hash=sha256:[a-f0-9]{64}/, `沒有雜湊：${block.split('\n')[0]}`);
  }
  assert.match(lock, /^audio-separator==0\.48\.0 /m);
  assert.match(lock, /^torch==2\.15\.0 /m);
  // audio-separator 0.48 直接 import audioread，但 librosa 1.0 不再帶它（CI 實測缺它會在分離時失敗）
  assert.match(lock, /^audioread==/m);
  assert.doesNotMatch(lock, /^diffq/m, 'diffq 沒有 cp312 macOS wheel，鎖進來會在 Mac 上要求編譯');
  assert.doesNotMatch(lock, /cu12|nvidia|onnxruntime-gpu/i);
});

test('Mac 的 pip 參數：--require-hashes、--no-deps、只收 wheel、只用 PyPI（不帶 CUDA index）', () => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'args-'));
  const args = trust.macInstallArgs('ai-mac', dir);
  for (const flag of ['--isolated', '--require-hashes', '--no-deps', '--only-binary=:all:']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--index-url') + 1], 'https://pypi.org/simple');
  assert.ok(!args.includes('--extra-index-url'));
  assert.ok(fs.existsSync(args[args.length - 1]));
  // Windows 的參數不受影響
  const win = trust.installArgs('ai', dir);
  assert.ok(win.includes('https://download.pytorch.org/whl/cu124'));
  assert.ok(!win.includes('--only-binary=:all:'));
});

function fakeDisk(free = 100 * 1024 ** 3) {
  return () => ({ known: true, low: free < 4 * 1024 ** 3, freeBytes: free });
}

test('Mac runtime 安裝：SHA-256 不符就中止、不解壓、清掉暫存', async () => {
  provider._resetForTests();
  let extracted = false;
  await assert.rejects(provider.downloadMacRuntime({
    supportImpl: () => ({ supported: true, reason: null }),
    inspectDiskSpaceImpl: fakeDisk(),
    fetchFileImpl: async (url, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); return { sha256: '0'.repeat(64) }; },
    extractImpl: async () => { extracted = true; },
  }), (error) => error.code === 'HASH_MISMATCH');
  assert.equal(extracted, false);
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, 'python-mac.download.tar.gz')), false);
  assert.equal(fs.existsSync(path.join(provider.RUNTIME_DIR, 'python.download')), false);
});

test('Mac runtime 安裝：Intel／舊系統直接拒絕，連下載都不開始', async () => {
  provider._resetForTests();
  let fetched = false;
  for (const reason of ['intel', 'macos_old']) {
    await assert.rejects(provider.downloadMacRuntime({
      supportImpl: () => ({ supported: false, reason }),
      fetchFileImpl: async () => { fetched = true; return {}; },
    }), (error) => error.code === 'MAC_UNSUPPORTED' && error.reason === reason);
  }
  assert.equal(fetched, false);
});

test('Mac runtime 安裝：磁碟空間不足時不下載', async () => {
  provider._resetForTests();
  let fetched = false;
  await assert.rejects(provider.downloadMacRuntime({
    supportImpl: () => ({ supported: true, reason: null }),
    inspectDiskSpaceImpl: fakeDisk(1024 ** 3),
    fetchFileImpl: async () => { fetched = true; return {}; },
  }), (error) => error.code === 'DISK_FULL');
  assert.equal(fetched, false);
});

test('Mac runtime 安裝：驗過雜湊→解壓→pip 用 Mac 鎖定清單→搬進正式路徑並寫 marker', async () => {
  provider._resetForTests();
  const pipCalls = [];
  const result = await provider.downloadMacRuntime({
    supportImpl: () => ({ supported: true, reason: null }),
    inspectDiskSpaceImpl: fakeDisk(),
    fetchFileImpl: async (url, file) => {
      assert.equal(url, MAC_PYTHON.url);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'tar');
      return { sha256: MAC_PYTHON.sha256 };
    },
    extractImpl: async (file, dir) => {
      const exe = path.join(dir, 'python', 'bin', 'python3');
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.writeFileSync(exe, '#!/bin/sh\n'); fs.chmodSync(exe, 0o755);
    },
    stripQuarantineImpl: async () => {},
    runPythonStepImpl: async (args, options) => { pipCalls.push({ args, pythonExe: options.pythonExe }); },
  });
  assert.equal(result.ok, true);
  assert.equal(pipCalls.length, 2);
  assert.ok(pipCalls[0].pythonExe.endsWith(path.join('python.download', 'python', 'bin', 'python3')));
  assert.ok(pipCalls[0].args.some((a) => a.endsWith('requirements-ai-mac.txt')));
  assert.ok(pipCalls[1].args.some((a) => a.endsWith('requirements-practice-pitch.txt')));
  const marker = JSON.parse(fs.readFileSync(provider.MARKER_FILE, 'utf8'));
  assert.equal(marker.pythonEmbedVersion, MAC_RUNTIME_ID);
  assert.ok(fs.existsSync(path.join(provider.PYTHON_DIR, 'bin', 'python3')));
  fs.rmSync(provider.RUNTIME_DIR, { recursive: true, force: true });
});

test('元件包：Windows 的大小與條件不變；Mac 只算 Python＋主模型＋FFmpeg，不裝 WebGPU', () => {
  bundle._setPlatformForTests('win32', 'x64');
  const win = bundle.getStatus();
  assert.equal(win.supported, true);
  assert.equal(win.expectedInstalledBytes, 7_243_705_519);
  assert.equal(win.requiredFreeBytes, 9 * 1024 * 1024 * 1024);

  bundle._setPlatformForTests('darwin', 'arm64', '24.1.0');
  const mac = bundle.getStatus();
  assert.equal(mac.platform, 'darwin');
  assert.equal(mac.supported, true);
  assert.equal(mac.expectedInstalledBytes, bundle.MAC_EXPECTED_INSTALLED_BYTES);
  assert.ok(mac.expectedInstalledBytes < 3e9, 'Mac 不含 CUDA，不能再顯示 7.3GB');
  assert.equal(mac.components.webgpu, false);

  bundle._setPlatformForTests('darwin', 'x64', '24.1.0');
  assert.deepEqual([bundle.getStatus().supported, bundle.getStatus().unsupportedReason], [false, 'intel']);
  bundle._setPlatformForTests();
});

test('元件包：不支援的 Mac 按下安裝時直接拒絕，不檢查也不下載任何東西', async () => {
  bundle._resetForTests();
  bundle._setPlatformForTests('darwin', 'x64', '24.1.0');
  const original = provider.downloadRuntime;
  let called = false;
  provider.downloadRuntime = async () => { called = true; };
  try {
    await assert.rejects(bundle.downloadBundle(), (error) => error.code === 'MAC_UNSUPPORTED' && error.reason === 'intel');
    assert.equal(called, false);
  } finally {
    provider.downloadRuntime = original;
    bundle._setPlatformForTests();
  }
});

test('Python sidecar：Mac 用 MPS、CPU 備援關掉 MPS、精度用 fp32；Windows 的 CUDA 路徑不變', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'ai', 'worker.py'), 'utf8');
  const supervisor = fs.readFileSync(path.join(__dirname, '..', 'ai', 'supervisor.py'), 'utf8');
  assert.match(supervisor, /mpsAvailable/);
  assert.match(worker, /torch\.backends\.mps\.is_available = lambda: False/);
  assert.match(worker, /if _IS_MAC:\n\s+# [^\n]*\n\s+use_autocast = False/);
  assert.match(worker, /os\.environ\["CUDA_VISIBLE_DEVICES"\] = "-1"/);
  assert.match(worker, /MPS backend out of memory/);
  const jobs = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'ai-separation-jobs.js'), 'utf8');
  assert.match(jobs, /probe\?\.cudaAvailable === true \|\| probe\?\.mpsAvailable === true/);
});

test('預檢：不支援的 Mac 或空間不足時，在打開安裝視窗前就擋下；Windows 不經過這段', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ai-separation-client.js'), 'utf8');
  const ensure = client.slice(client.indexOf('async function ensureReady()'));
  assert.ok(ensure.indexOf('macPrecheckMessage(status)') < ensure.indexOf('openInstallModal(status)'));
  assert.match(client, /if \(!status \|\| status\.platform !== 'darwin'\) return '';/);
  assert.match(client, /if \(status\.platform === 'darwin'\) return true;/, 'Mac 不預熱 WebGPU（不然會自動下載 WebGPU 模型）');
});

test('五語訊息：Mac 不支援、空間不足、Mac 安裝說明、段落分析與精準對時的暫不支援', () => {
  const I18n = require('../public/js/i18n.js');
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
  for (const key of ['aiInstall.summaryMac', 'aiInstall.pythonMac', 'aiInstall.sharedMac', 'aiInstall.macUnsupportedIntel',
    'aiInstall.macUnsupportedOs', 'aiInstall.diskFull', 'aiInstall.diskFullMac', 'alignModel.unsupported', 'sections.unsupportedMac']) {
    const line = source.split('\n').find((l) => l.startsWith(`    '${key}': [`));
    assert.ok(line, key);
    assert.equal(JSON.parse(line.slice(line.indexOf('['), line.lastIndexOf(']') + 1)).length, 5, key);
    assert.notEqual(I18n.t(key), key);
  }
  assert.doesNotMatch(I18n.t('aiInstall.summaryMac'), /7\.3/);
});

test('段落分析在非 Windows 直接回 UNSUPPORTED_PLATFORM，不會觸發 Windows 專用的下載', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'api', 'separation.js'), 'utf8');
  const handler = route.slice(route.indexOf("router.post('/library/:id/analyze-sections'"));
  assert.ok(handler.indexOf("error: 'UNSUPPORTED_PLATFORM'") < handler.indexOf('sectionRuntimeProvider'));
});
