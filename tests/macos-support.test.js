'use strict';

// macOS 支援：在任何平台都能跑的單元測試（下載、檔名、資料位置、打包設定）。
// 真正在 macOS 上執行 ffmpeg／yt-dlp／打包後啟動的檢查在 tools/mac/smoke-runtime.js
// 與 tools/build-mac.js，由 macOS CI 執行。

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ffmpeg-provider 在 require 時就決定 dataDir；先指到暫存資料夾，避免動到 repo 的 data/。
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-mac-test-data-'));
process.env.ELITESAND_DATA_DIR = TMP_DATA;

const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');

const binaries = require('../server/utils/platform-binaries');
const { FFMPEG_SOURCES, FFMPEG_MAC_SOURCES } = require('../server/services/ffmpeg-trust');
const ffmpegProvider = require('../server/services/ffmpeg-provider');
const { parseRelease, stageVerifiedRelease } = require('../server/services/ytdlp-verified-release');
const mediaStorage = require('../electron/packaged-media-storage');
const shell = require('../electron/shell');
const { builderConfig } = require('../tools/build-mac');

test.after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

test('packaged binary names: Windows unchanged, macOS without .exe', () => {
  assert.equal(binaries.ytdlpReleaseAssetName('win32'), 'yt-dlp.exe');
  assert.equal(binaries.ytdlpReleaseAssetName('darwin'), 'yt-dlp_macos');
  assert.equal(binaries.packagedYtdlpName('win32'), 'yt-dlp.exe');
  assert.equal(binaries.packagedYtdlpName('darwin'), 'yt-dlp');
  assert.equal(binaries.bundledNodeName('win32'), 'updater-node.exe');
  assert.equal(binaries.bundledNodeName('darwin'), 'node');
});

test('macOS FFmpeg trust roots: both architectures pinned with https URL, SHA-256 and size for ffmpeg and ffprobe', () => {
  assert.ok(FFMPEG_SOURCES.length >= 1, 'Windows sources must stay intact');
  for (const arch of ['arm64', 'x64']) {
    const sources = FFMPEG_MAC_SOURCES[arch];
    assert.ok(Array.isArray(sources) && sources.length >= 1, `${arch} needs at least one source`);
    for (const source of sources) {
      for (const part of ['ffmpeg', 'ffprobe']) {
        const artifact = source[part];
        assert.match(artifact.url, /^https:\/\/[^/]+\/.+\.zip$/);
        assert.ok(artifact.url.includes(arch === 'arm64' ? '/arm64/' : '/amd64/'), `${arch} ${part} URL must match its architecture`);
        assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
        assert.ok(Number.isSafeInteger(artifact.size) && artifact.size > 1e6);
      }
    }
  }
  assert.ok(Object.isFrozen(FFMPEG_MAC_SOURCES) && Object.isFrozen(FFMPEG_MAC_SOURCES.arm64[0].ffmpeg));
});

test('macOS FFmpeg download info lists the architecture-specific source', () => {
  const arm = ffmpegProvider.getDownloadInfo({ platform: 'darwin', arch: 'arm64' });
  const intel = ffmpegProvider.getDownloadInfo({ platform: 'darwin', arch: 'x64' });
  assert.match(arm.sources[0].url, /\/arm64\//);
  assert.match(intel.sources[0].url, /\/amd64\//);
  const win = ffmpegProvider.getDownloadInfo({ platform: 'win32' });
  assert.equal(win.sources[0].url, FFMPEG_SOURCES[0].url);
});

test('Homebrew FFmpeg is found at fixed paths that GUI apps do not get on PATH', () => {
  const present = new Set(['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe']);
  const found = ffmpegProvider.findMacSystemPair({ platform: 'darwin', existsSync: (p) => present.has(p) });
  assert.deepEqual(found, { source: 'system-dir', ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' });
  // 只有一半不算數；非 macOS 不做這個猜測。
  assert.equal(ffmpegProvider.findMacSystemPair({ platform: 'darwin', existsSync: (p) => p === '/usr/local/bin/ffmpeg' }), null);
  assert.equal(ffmpegProvider.findMacSystemPair({ platform: 'win32', existsSync: () => true }), null);
});

test('macOS zip entry must be the binary itself at the archive root', () => {
  const zip = new AdmZip();
  zip.addFile('nested/ffmpeg', Buffer.from('x'));
  zip.addFile('ffmpeg.txt', Buffer.from('x'));
  assert.equal(ffmpegProvider.findMacBinaryEntry(zip.getEntries(), 'ffmpeg'), null);
  zip.addFile('ffmpeg', Buffer.from('real'));
  assert.equal(ffmpegProvider.findMacBinaryEntry(zip.getEntries(), 'ffmpeg').entryName, 'ffmpeg');
});

function fakeMacSource(label, { tamperProbe = false } = {}) {
  const make = (name) => {
    const zip = new AdmZip();
    zip.addFile(name, Buffer.from(`#!/bin/sh\necho ${name}-${label}\n`));
    const bytes = zip.toBuffer();
    return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  };
  const ffmpeg = make('ffmpeg');
  const ffprobe = make('ffprobe');
  return {
    files: { [`https://example.test/${label}/ffmpeg.zip`]: ffmpeg.bytes, [`https://example.test/${label}/ffprobe.zip`]: tamperProbe ? Buffer.from('tampered') : ffprobe.bytes },
    source: {
      id: label,
      label,
      version: 'test',
      ffmpeg: { url: `https://example.test/${label}/ffmpeg.zip`, sha256: ffmpeg.sha256, size: ffmpeg.size },
      ffprobe: { url: `https://example.test/${label}/ffprobe.zip`, sha256: ffprobe.sha256, size: ffprobe.size },
    },
  };
}

function fakeFetch(files) {
  return async (url, file) => {
    const bytes = files[url];
    if (!bytes) throw new Error(`unexpected URL ${url}`);
    fs.writeFileSync(file, bytes);
    return { downloadedBytes: bytes.length, totalBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  };
}

test('macOS FFmpeg download: verifies both zips, falls back as a whole pair, installs executable files', async () => {
  ffmpegProvider._resetForTests();
  const broken = fakeMacSource('broken', { tamperProbe: true });
  const good = fakeMacSource('good');
  const ran = [];
  const result = await ffmpegProvider.downloadFfmpeg({
    platform: 'darwin',
    arch: 'arm64',
    sources: [broken.source, good.source],
    fetchFileImpl: fakeFetch({ ...broken.files, ...good.files }),
    spawnSyncImpl: (command) => { ran.push(path.basename(command)); return { status: 0, error: null }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'good', 'a half-verified source must never be mixed with another source');
  for (const file of [ffmpegProvider.FFMPEG_EXE, ffmpegProvider.FFPROBE_EXE]) {
    assert.ok(fs.existsSync(file));
    if (process.platform !== 'win32') assert.ok((fs.statSync(file).mode & 0o111) !== 0, `${file} must be executable`);
  }
  assert.match(fs.readFileSync(ffmpegProvider.FFMPEG_EXE, 'utf8'), /ffmpeg-good/);
  assert.match(fs.readFileSync(ffmpegProvider.FFPROBE_EXE, 'utf8'), /ffprobe-good/);
  assert.ok(ran.length >= 4, 'both temp and installed binaries must be executed for validation');
  assert.deepEqual(fs.readdirSync(ffmpegProvider.BIN_DIR).filter((n) => /download/.test(n)), [], 'temporary downloads are cleaned up');
});

test('macOS FFmpeg download fails closed when every source is tampered', async () => {
  ffmpegProvider._resetForTests();
  const broken = fakeMacSource('only', { tamperProbe: true });
  await assert.rejects(ffmpegProvider.downloadFfmpeg({
    platform: 'darwin',
    arch: 'x64',
    sources: [broken.source],
    fetchFileImpl: fakeFetch(broken.files),
    spawnSyncImpl: () => ({ status: 0, error: null }),
  }), /SHA-256/);
});

test('unsupported platforms still refuse automatic FFmpeg download', async () => {
  ffmpegProvider._resetForTests();
  await assert.rejects(ffmpegProvider.downloadFfmpeg({ platform: 'linux' }), /Windows 與 macOS/);
});

test('yt-dlp nightly: macOS uses the official yt-dlp_macos asset and stages an executable file', async () => {
  const version = '2026.10.26.220202';
  const binary = Buffer.from('#!/bin/sh\necho mac-yt-dlp\n');
  const digest = crypto.createHash('sha256').update(binary).digest('hex');
  const url = `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${version}/yt-dlp_macos`;
  const publishedAt = '2026-10-26T22:02:02Z';
  const release = parseRelease({
    tag_name: version,
    published_at: publishedAt,
    assets: [
      { name: 'yt-dlp.exe', browser_download_url: url.replace('yt-dlp_macos', 'yt-dlp.exe'), digest: `sha256:${'0'.repeat(64)}`, size: 200000 },
      { name: 'yt-dlp_macos', browser_download_url: url, digest: `sha256:${digest}`, size: binary.length + 200000 },
    ],
  }, { assetName: 'yt-dlp_macos' });
  assert.equal(release.url, url);
  assert.equal(release.assetName, 'yt-dlp_macos');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ytdlp-mac-'));
  try {
    const target = path.join(root, 'yt-dlp');
    const askedFor = [];
    const staging = await stageVerifiedRelease(target, { ...release, size: binary.length }, {
      platform: 'darwin',
      verifyChecksumsImpl: async (_sums, _sig, options) => { askedFor.push(options.assetName); return digest; },
      fetchImpl: async () => ({ ok: true, buffer: async () => binary }),
      execImpl: async () => ({ stdout: version }),
    });
    assert.deepEqual(askedFor, ['yt-dlp_macos'], 'the signed checksum line must be the macOS asset');
    assert.ok(!staging.endsWith('.exe'));
    if (process.platform !== 'win32') assert.ok((fs.statSync(staging).mode & 0o111) !== 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS packaged media defaults to userData, never inside the .app bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-mac-media-'));
  try {
    const userData = path.join(root, 'Application Support', 'Elitesand Pro');
    const exe = path.join(root, 'Applications', 'Elitesand Pro.app', 'Contents', 'MacOS', 'Elitesand Pro');
    const first = mediaStorage.preparePackagedMediaStorage({ userDataPath: userData, executablePath: exe, platform: 'darwin' });
    assert.equal(first.action, 'initialized-mac-default');
    assert.equal(first.mediaDir, path.join(userData, 'Elitesand Pro Media'));
    assert.ok(!first.mediaDir.includes('.app'));
    assert.ok(fs.existsSync(path.join(first.mediaDir, mediaStorage.MEDIA_MARKER_NAME)));

    const custom = path.join(root, 'Music', 'My Songs');
    fs.mkdirSync(custom, { recursive: true });
    fs.writeFileSync(path.join(userData, 'data', 'media-storage.json'), JSON.stringify({ version: 1, mediaDir: custom }));
    const second = mediaStorage.preparePackagedMediaStorage({ userDataPath: userData, executablePath: exe, platform: 'darwin' });
    assert.deepEqual(second, { mediaDir: custom, action: 'kept-configured' });

    const fresh = path.join(root, 'fresh-user-data');
    const runtime = shell.resolveMediaRuntime(fresh, { isPackaged: true, executablePath: exe, platform: 'darwin' });
    assert.equal(runtime.downloadsDir, path.join(fresh, 'Elitesand Pro Media'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS packaged yt-dlp seed is named yt-dlp and copied as an executable runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-mac-seed-'));
  try {
    const resources = path.join(root, 'Resources');
    fs.mkdirSync(path.join(resources, 'tools'), { recursive: true });
    const seed = path.join(resources, 'tools', 'yt-dlp');
    fs.writeFileSync(seed, 'mac-seed', { mode: 0o755 });
    const seedHash = crypto.createHash('sha256').update('mac-seed').digest('hex');
    const userData = path.join(root, 'user-data');
    const runtime = shell.prepareMutableYtdlp(resources, userData, {
      platform: 'darwin',
      expectedSeedHash: seedHash,
      versionResolver: () => '2026.10.26',
    });
    assert.equal(runtime.command, path.join(userData, 'tools', 'yt-dlp', 'yt-dlp'));
    assert.equal(runtime.mutable, true);
    if (process.platform !== 'win32') assert.ok((fs.statSync(runtime.command).mode & 0o111) !== 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS electron-builder config: no Windows sections, ad-hoc build, microphone usage text, icon present', () => {
  const pkg = require('../package.json');
  const config = builderConfig(pkg, 'arm64', path.join(__dirname, '..', 'dist', 'mac-test-out'));
  assert.equal(config.win, undefined);
  assert.equal(config.nsis, undefined);
  assert.equal(config.mac.identity, null);
  assert.deepEqual(config.mac.target, [{ target: 'dir', arch: ['arm64'] }]);
  assert.ok(config.mac.extendInfo.NSMicrophoneUsageDescription);
  assert.ok(fs.existsSync(path.join(__dirname, '..', config.mac.icon)));
  assert.deepEqual(config.electronFuses, pkg.build.electronFuses, 'macOS must keep the same Electron fuses as Windows');
  assert.equal(config.asar?.smartUnpack, false);
});

test('第一次開啟小工具：放進 DMG、保有執行權限、只動這一個 app、不用 sudo 或密碼', () => {
  const fsMod = require('fs');
  const pathMod = require('path');
  const root = pathMod.join(__dirname, '..');
  const helper = pathMod.join(root, 'tools', 'mac', 'first-launch.command');
  const text = fsMod.readFileSync(helper, 'utf8');
  assert.ok((fsMod.statSync(helper).mode & 0o111) !== 0, 'repo 裡的小工具要有執行權限');
  assert.match(text, /^#!\/bin\/bash\n/);
  const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(code, /\bsudo\b|with administrator privileges/);
  assert.match(text, /APP="\$\{ELITESAND_APP_PATH:-\/Applications\/Elitesand Pro\.app\}"/);
  assert.match(text, /\/usr\/bin\/xattr -dr com\.apple\.quarantine "\$APP"/);
  assert.equal((text.match(/xattr -dr/g) || []).length, 1, '只對這一個 app 移除隔離屬性');
  assert.match(text, /仍要打開/);
  assert.match(text, /Open Anyway/);
  const readme = fsMod.readFileSync(pathMod.join(root, 'tools', 'mac', 'read-me-first.txt'), 'utf8');
  assert.match(readme, /免費軟體，沒有付費給 Apple/);
  assert.match(readme, /也是從網路下載的/, '要老實說小工具本身第一次也可能被擋');
  const build = fsMod.readFileSync(pathMod.join(root, 'tools', 'build-mac.js'), 'utf8');
  assert.match(build, /DMG_EXPECTED_ENTRIES = \['Applications', 'Elitesand Pro\.app', DMG_HELPER_NAME, DMG_README_NAME\]/);
  assert.match(build, /fs\.chmodSync\(helper, 0o755\)/);
  assert.match(build, /verifyDmg\(dmgPath\);/);
});
