#!/usr/bin/env node
'use strict';

/**
 * macOS 打包（對應 Windows 的 build-portable.ps1 ＋ build-installer.ps1）。
 *
 *   node tools/build-mac.js --arch arm64|x64 [--skip-boot-check]
 *
 * 必須在 macOS 上跑（GitHub Actions 的 macos runner 即可，不需要實體 Mac）：
 * codesign、hdiutil、plutil 都是 macOS 內建工具。產物：
 *   dist/releases/v<version>/mac/Elitesand-Pro-<version>-mac-<arch>.dmg（＋ .sha256）
 *
 * 與 Windows 版刻意保持相同的安全性質：
 * - app 從 lockfile 重新 `npm ci --omit=dev`，不拿開發機的 node_modules；
 * - server／前端做 production bundle，server/config.js 絕不打包；
 * - yt-dlp 取官方 nightly 的 yt-dlp_macos，驗 GitHub digest ＋ 官方 GPG 簽章的
 *   SHA2-256SUMS ＋ `--version` 必須等於 tag；
 * - 給 yt-dlp EJS 用的獨立 Node 取 nodejs.org 官方 darwin 版，驗 SHASUMS256；
 * - resources/tools 全部進完整性 manifest（打包在 app.asar 內）；
 * - Electron fuses 與 Windows 相同，ASAR 完整性寫在 Info.plist；
 * - 打包後在 repo 外實際啟動一次，確認 /api/health 正常、yt-dlp runtime 有正確 seed。
 *
 * 這一版沒有 Apple Developer ID：整個 .app 只做 ad-hoc 簽章（Apple Silicon 必須
 * 至少有 ad-hoc 簽章才能執行）。使用者第一次開啟需要在「隱私權與安全性」按
 * 「強制打開」，或移除隔離屬性；之後有開發者帳號再改成正式簽章＋公證。
 *
 * 不含的 Windows 專用元件：Spout（DirectX）、AI 分離／精準對時／段落分析／日文
 * 諧音 v2 的 Python runtime、增量更新器。這些功能在 macOS 會顯示「只支援 Windows」
 * 或走既有的 fallback。
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RESOURCES = path.join(ROOT, 'dist', '.electron-builder-resources');
const APP_STAGE = path.join(RESOURCES, 'app');
const TOOLS_STAGE = path.join(RESOURCES, 'tools');
const LICENSES_STAGE = path.join(RESOURCES, 'licenses');
const MAC_ICON = path.join(ROOT, 'tools', 'mac', 'icon.png');
const YTDLP_NIGHTLY_LATEST = 'https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest';
const YTDLP_ASSET = 'yt-dlp_macos';

function log(message) { process.stdout.write(`[build-mac] ${message}\n`); }

function parseArgs(argv) {
  const args = { arch: process.arch === 'arm64' ? 'arm64' : 'x64', bootCheck: true };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--arch') args.arch = argv[++i];
    else if (value === '--skip-boot-check') args.bootCheck = false;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!['arm64', 'x64'].includes(args.arch)) throw new Error('--arch must be arm64 or x64');
  return args;
}

function assertInside(target, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Refusing to write outside ${parent}: ${target}`);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`);
  return execFileSync(command, args, { stdio: 'inherit', ...options });
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

function copyDir(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Missing required directory: ${source}`);
  fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
}

function githubHeaders() {
  const headers = { 'User-Agent': 'elitesand-pro-mac-build', Accept: 'application/vnd.github+json' };
  // GitHub Actions 內用工作流程自己的 token 提高 API 額度；不讀其他任何憑證。
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function download(url, { headers = {}, maxBytes = 300 * 1024 * 1024, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'elitesand-pro-mac-build', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error(`Too many redirects: ${url}`));
        // 跟著重新導向到 CDN 時不帶 Authorization。
        const next = new URL(res.headers.location, url).toString();
        const nextHeaders = new URL(next).host === new URL(url).host ? headers : {};
        return download(next, { headers: nextHeaders, maxBytes, redirects: redirects - 1 }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) { res.destroy(new Error(`Download exceeds ${maxBytes} bytes: ${url}`)); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(120000, () => request.destroy(new Error(`Timeout: ${url}`)));
  });
}

// ─── 1. App staging ─────────────────────────────────────────────────────────

function stageApp(pkg) {
  for (const dir of ['server', 'public']) copyDir(path.join(ROOT, dir), path.join(APP_STAGE, dir));
  for (const file of ['package.json', 'package-lock.json', 'LICENSE', 'EULA.txt', 'THIRD-PARTY-NOTICES.txt']) {
    const source = path.join(ROOT, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(APP_STAGE, file));
  }
  const sourceMaps = path.join(ROOT, 'dist', '.source-maps', `v${pkg.version}-mac`);
  fs.rmSync(sourceMaps, { recursive: true, force: true });
  fs.mkdirSync(sourceMaps, { recursive: true });
  run(process.execPath, [path.join(ROOT, 'tools', 'build-production-bundles.js'), APP_STAGE, '--sourcemap-out', sourceMaps]);
  // 開發機的本機設定可能含 API key，絕不打包。
  fs.rmSync(path.join(APP_STAGE, 'server', 'config.js'), { force: true });

  log('Installing production dependencies from the lockfile...');
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: APP_STAGE });
  for (const dir of ['data', 'downloads', 'logs']) fs.rmSync(path.join(APP_STAGE, dir), { recursive: true, force: true });

  copyDir(path.join(ROOT, 'electron'), path.join(APP_STAGE, 'electron'));
  // assets/ 只有 Windows 的 .ico；公開倉沒有這個資料夾，macOS 圖示另由 tools/mac/icon.png 提供。
  if (fs.existsSync(path.join(ROOT, 'assets'))) copyDir(path.join(ROOT, 'assets'), path.join(APP_STAGE, 'assets'));
  if (!fs.existsSync(path.join(APP_STAGE, 'node_modules', 'express', 'package.json'))) {
    throw new Error('Staged app is missing node_modules/express; refusing to build a broken app.');
  }

  const stagedPackagePath = path.join(APP_STAGE, 'package.json');
  const staged = JSON.parse(fs.readFileSync(stagedPackagePath, 'utf8'));
  delete staged.build;
  staged.elitesandPublicVersion = pkg.version;
  fs.writeFileSync(stagedPackagePath, `${JSON.stringify(staged, null, 2)}\n`);
  run(process.execPath, [path.join(ROOT, 'tools', 'build-production-bundles.js'), APP_STAGE, '--electron-only', '--sourcemap-out', sourceMaps]);
}

function writeNpmLicenseInventory() {
  const nodeModules = path.join(APP_STAGE, 'node_modules');
  const inventory = [];
  const candidates = [];
  for (const name of fs.readdirSync(nodeModules)) {
    const full = path.join(nodeModules, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (name.startsWith('@')) {
      for (const child of fs.readdirSync(full)) candidates.push(path.join(full, child));
    } else {
      candidates.push(full);
    }
  }
  for (const dir of candidates) {
    const manifestPath = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { continue; }
    let license = null;
    let source = null;
    if (meta.license) {
      license = typeof meta.license === 'string' ? meta.license : meta.license.type;
      source = 'license-field';
    } else if (Array.isArray(meta.licenses) && meta.licenses.length) {
      license = meta.licenses.map((item) => item.type).join(' OR ');
      source = 'legacy-licenses-array';
    } else {
      const file = fs.readdirSync(dir).find((entry) => /^(LICEN[SC]E|COPYING)(\..*)?$/i.test(entry));
      if (file) { license = `SEE ${file}`; source = 'license-file-present'; }
    }
    inventory.push({ name: meta.name, version: meta.version, license, source });
  }
  const unknown = inventory.filter((item) => !item.license);
  if (unknown.length) {
    throw new Error(`Release audit failed: packages with no discoverable license: ${unknown.map((i) => `${i.name}@${i.version}`).join(', ')}`);
  }
  inventory.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  fs.writeFileSync(path.join(LICENSES_STAGE, 'npm-license-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  log(`npm license inventory: ${inventory.length} packages, 0 unknown`);
  for (const legal of ['LICENSE', 'EULA.txt', 'THIRD-PARTY-NOTICES.txt']) {
    const source = path.join(ROOT, legal);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(LICENSES_STAGE, legal));
  }
}

// ─── 2. Verified external tools ─────────────────────────────────────────────

async function stageYtdlp() {
  const { verifySignedChecksums } = require('../server/services/ytdlp-signature-trust');
  const release = JSON.parse((await download(YTDLP_NIGHTLY_LATEST, { headers: githubHeaders(), maxBytes: 2 * 1024 * 1024 })).toString('utf8'));
  const version = String(release.tag_name || '');
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(version)) throw new Error(`Invalid latest yt-dlp nightly version: ${version}`);
  const base = `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${version}/`;
  const asset = (release.assets || []).find((item) => item.name === YTDLP_ASSET);
  const digest = String(asset?.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
  if (!asset || asset.browser_download_url !== `${base}${YTDLP_ASSET}` || !digest) {
    throw new Error('Official yt-dlp nightly macOS asset is missing or has no SHA-256 digest.');
  }
  const [checksums, signature] = await Promise.all([
    download(`${base}SHA2-256SUMS`, { maxBytes: 65536 }),
    download(`${base}SHA2-256SUMS.sig`, { maxBytes: 16384 }),
  ]);
  const signed = await verifySignedChecksums(checksums, signature, { assetName: YTDLP_ASSET });
  if (signed !== digest[1].toLowerCase()) throw new Error('Signed yt-dlp checksum differs from the GitHub asset digest.');
  const binary = await download(`${base}${YTDLP_ASSET}`, { maxBytes: 120 * 1024 * 1024 });
  const actual = crypto.createHash('sha256').update(binary).digest('hex');
  if (actual !== signed) throw new Error('yt-dlp_macos SHA-256 mismatch.');
  const target = path.join(TOOLS_STAGE, 'yt-dlp');
  fs.writeFileSync(target, binary, { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  const reported = capture(target, ['--version'], { timeout: 60000 }).trim().split(/\r?\n/)[0];
  if (reported !== version) throw new Error(`Bundled yt-dlp reports ${reported}, expected ${version}.`);

  // 授權文件：nightly tag 不存在於主 repo，從 release 說明裡標明的上游 commit 取。
  const commit = String(release.body || '').match(/yt-dlp\/yt-dlp\/commit\/([0-9a-f]{40})/);
  if (!commit) throw new Error(`Cannot find the upstream commit for nightly yt-dlp ${version}`);
  const licenseDir = path.join(LICENSES_STAGE, 'yt-dlp');
  fs.mkdirSync(licenseDir, { recursive: true });
  for (const [remote, local] of [['LICENSE', 'LICENSE.txt'], ['THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_LICENSES.txt']]) {
    const bytes = await download(`https://raw.githubusercontent.com/yt-dlp/yt-dlp/${commit[1]}/${remote}`, { maxBytes: 4 * 1024 * 1024 });
    if (!bytes.length) throw new Error(`Empty yt-dlp legal file: ${remote}`);
    fs.writeFileSync(path.join(licenseDir, local), bytes);
  }
  fs.writeFileSync(path.join(licenseDir, 'PROVENANCE.txt'), [
    'yt-dlp binary provenance',
    `Release: https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/tag/${version} (built from yt-dlp/yt-dlp@${commit[1]})`,
    `Asset: ${YTDLP_ASSET} (Universal macOS 10.15+), stored as tools/yt-dlp`,
    `SHA-256: ${actual}`,
    'Verified against the GPG-signed SHA2-256SUMS published with the release.',
    'The PyInstaller-bundled executable includes GPLv3+ code; see LICENSE.txt and THIRD_PARTY_LICENSES.txt.',
    '',
  ].join('\n'));
  log(`yt-dlp ${version} staged (sha256 ${actual})`);
  return { version, sha256: actual };
}

async function stageNode(arch) {
  const version = process.versions.node;
  if (Number(version.split('.')[0]) < 22) throw new Error(`Node.js 22+ is required for yt-dlp EJS support; found ${version}`);
  const name = `node-v${version}-darwin-${arch}.tar.gz`;
  const base = `https://nodejs.org/dist/v${version}/`;
  const sums = (await download(`${base}SHASUMS256.txt`, { maxBytes: 256 * 1024 })).toString('utf8');
  const line = sums.split(/\r?\n/).find((entry) => entry.trim().endsWith(`  ${name}`));
  const expected = line && line.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error(`SHASUMS256.txt has no entry for ${name}`);
  const archive = await download(`${base}${name}`, { maxBytes: 200 * 1024 * 1024 });
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`${name} SHA-256 mismatch`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-node-'));
  try {
    const tarball = path.join(work, name);
    fs.writeFileSync(tarball, archive);
    const member = `node-v${version}-darwin-${arch}/bin/node`;
    run('tar', ['-xzf', tarball, '-C', work, member]);
    const target = path.join(TOOLS_STAGE, 'node');
    fs.copyFileSync(path.join(work, member), target);
    fs.chmodSync(target, 0o755);
    const licenseDir = path.join(LICENSES_STAGE, 'node');
    fs.mkdirSync(licenseDir, { recursive: true });
    run('tar', ['-xzf', tarball, '-C', work, `node-v${version}-darwin-${arch}/LICENSE`]);
    fs.copyFileSync(path.join(work, `node-v${version}-darwin-${arch}`, 'LICENSE'), path.join(licenseDir, 'LICENSE.txt'));
    fs.writeFileSync(path.join(licenseDir, 'PROVENANCE.txt'), `Node.js v${version} (${name}) from ${base}\nArchive SHA-256: ${actual} (matches SHASUMS256.txt)\n`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (arch === process.arch) {
    const reported = capture(path.join(TOOLS_STAGE, 'node'), ['--version']).trim();
    if (reported !== `v${version}`) throw new Error(`Bundled node reports ${reported}`);
  }
  log(`node v${version} (${arch}) staged`);
  return { version };
}

// ─── 3. electron-builder → .app ─────────────────────────────────────────────

function builderConfig(pkg, arch, outputDir) {
  const base = { ...pkg.build };
  delete base.win;
  delete base.nsis;
  return {
    ...base,
    directories: { app: path.relative(ROOT, APP_STAGE), output: path.relative(ROOT, outputDir) },
    extraMetadata: { version: pkg.version },
    mac: {
      target: [{ target: 'dir', arch: [arch] }],
      icon: path.relative(ROOT, MAC_ICON),
      category: 'public.app-category.music',
      // 沒有 Developer ID：electron-builder 先不簽，之後整包統一 ad-hoc 簽章（見 adHocSign）。
      identity: null,
      hardenedRuntime: false,
      gatekeeperAssess: false,
      minimumSystemVersion: '12.0',
      extendInfo: {
        // 練習模式會用麥克風；沒有這行，macOS 會直接拒絕並可能讓 renderer 當掉。
        NSMicrophoneUsageDescription: 'Elitesand Pro 的練習模式需要使用麥克風來分析你的歌聲音準。',
        LSApplicationCategoryType: 'public.app-category.music',
      },
    },
  };
}

function buildApp(pkg, arch, outputDir) {
  const configPath = path.join(RESOURCES, 'electron-builder.mac.json');
  fs.writeFileSync(configPath, `${JSON.stringify(builderConfig(pkg, arch, outputDir), null, 2)}\n`);
  const cli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
  run(process.execPath, [cli, '--mac', 'dir', `--${arch}`, '--publish', 'never', '--config', configPath], {
    cwd: ROOT,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });
  const appDir = fs.readdirSync(outputDir)
    .map((entry) => path.join(outputDir, entry, 'Elitesand Pro.app'))
    .find((candidate) => fs.existsSync(candidate));
  if (!appDir) throw new Error(`electron-builder did not produce Elitesand Pro.app under ${outputDir}`);
  return appDir;
}

function adHocSign(appDir) {
  // 整包 ad-hoc 重簽：electron-builder 改過 Info.plist、翻過 fuses，原本的簽章已失效；
  // Apple Silicon 上沒有有效簽章的程式會被系統直接結束。
  run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appDir]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appDir]);
}

async function verifyApp(appDir, arch) {
  const { getRawHeader, listPackage } = require('@electron/asar');
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const { FuseState } = require('@electron/fuses/dist/constants');
  const { EXPECTED_FUSES, verifyBundledNotices, countFileIntegrity } = require('./verify-electron-package');

  const resources = path.join(appDir, 'Contents', 'Resources');
  const asarPath = path.join(resources, 'app.asar');
  if (!fs.existsSync(asarPath)) throw new Error('Contents/Resources/app.asar is missing.');
  if (fs.existsSync(path.join(resources, 'app'))) throw new Error('Contents/Resources/app must not exist when OnlyLoadAppFromAsar is enabled.');
  if (fs.existsSync(`${asarPath}.unpacked`) && fs.readdirSync(`${asarPath}.unpacked`, { recursive: true }).length > 0) {
    throw new Error('Unpacked application code bypasses ASAR integrity.');
  }
  const header = getRawHeader(asarPath);
  if (countFileIntegrity(header.header) === 0) throw new Error('app.asar has no per-file integrity hashes.');
  const files = listPackage(asarPath).map((file) => file.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
  verifyBundledNotices(files);
  if (!files.includes('electron/packaged-resource-integrity.generated.js')) throw new Error('Packaged resource integrity manifest is missing.');
  if (files.includes('server/config.js')) throw new Error('server/config.js must never be packaged.');

  for (const tool of ['yt-dlp', 'node']) {
    const file = path.join(resources, 'tools', tool);
    if (!fs.existsSync(file) || (fs.statSync(file).mode & 0o111) === 0) throw new Error(`Contents/Resources/tools/${tool} is missing or not executable.`);
  }

  const plist = JSON.parse(capture('plutil', ['-convert', 'json', '-o', '-', path.join(appDir, 'Contents', 'Info.plist')]));
  const integrity = plist.ElectronAsarIntegrity?.['Resources/app.asar'];
  const expectedHeaderHash = crypto.createHash('sha256').update(Buffer.from(header.headerString, 'utf8')).digest('hex');
  if (!integrity || String(integrity.algorithm).toUpperCase() !== 'SHA256' || integrity.hash !== expectedHeaderHash) {
    throw new Error('Info.plist ElectronAsarIntegrity does not match app.asar.');
  }
  if (!plist.NSMicrophoneUsageDescription) throw new Error('Info.plist is missing NSMicrophoneUsageDescription.');

  const fuseWire = await getCurrentFuseWire(appDir);
  for (const [key, expected] of Object.entries(EXPECTED_FUSES)) {
    const required = expected ? FuseState.ENABLE : FuseState.DISABLE;
    if (fuseWire[key] !== required) throw new Error(`Electron fuse ${FuseV1Options[key]} is not ${expected ? 'enabled' : 'disabled'}.`);
  }
  const archInfo = capture('lipo', ['-archs', path.join(appDir, 'Contents', 'MacOS', 'Elitesand Pro')]).trim();
  const expectedArch = arch === 'arm64' ? 'arm64' : 'x86_64';
  if (!archInfo.split(/\s+/).includes(expectedArch)) throw new Error(`Main executable architecture is ${archInfo}, expected ${expectedArch}.`);
  log(`Package verified: ${files.length} ASAR entries, fuses OK, ASAR integrity OK, arch ${archInfo}.`);
}

// ─── 4. Boot check outside the repo ─────────────────────────────────────────

function waitForHealth(port, child, timeoutMs) {
  const http = require('http');
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) return reject(new Error(`App exited early with code ${child.exitCode}`));
      if (Date.now() > deadline) return reject(new Error(`App did not become healthy on port ${port}`));
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(); else setTimeout(attempt, 500);
      });
      req.on('error', () => setTimeout(attempt, 500));
      req.on('timeout', () => req.destroy());
    };
    attempt();
  });
}

async function bootCheck(appDir) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-mac-boot-'));
  const userData = path.join(root, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  const port = 39000 + Math.floor(Math.random() * 700);
  const executable = path.join(appDir, 'Contents', 'MacOS', 'Elitesand Pro');
  const env = {
    ...process.env,
    PORT: String(port),
    ELITESAND_SHELL_PORT: String(port),
    ELITESAND_SHELL_HEADLESS: '1',
    ELITESAND_SHELL_USER_DATA_DIR: userData,
    ELITESAND_SHELL_QUIT_AFTER_READY_MS: '4000',
  };
  log(`Boot check: launching packaged app on port ${port}...`);
  const child = spawn(executable, [`--user-data-dir=${userData}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  try {
    await waitForHealth(port, child, 90000);
    log('Boot check: /api/health OK');
    const code = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('timeout'), 30000))]);
    if (code !== 0) throw new Error(`Packaged app did not exit cleanly (exit ${code}).`);
    const runtime = path.join(userData, 'tools', 'yt-dlp', 'yt-dlp');
    const state = path.join(userData, 'tools', 'yt-dlp', 'runtime-state.json');
    if (!fs.existsSync(runtime) || !fs.existsSync(state)) throw new Error('Packaged boot did not seed the writable yt-dlp runtime.');
    const seedHash = sha256File(path.join(appDir, 'Contents', 'Resources', 'tools', 'yt-dlp'));
    const trust = JSON.parse(fs.readFileSync(state, 'utf8'));
    if (sha256File(runtime) !== seedHash || trust.seedHash !== seedHash || trust.provenance !== 'seed') {
      throw new Error('Seeded yt-dlp runtime is not anchored to the packaged seed.');
    }
    capture(runtime, ['--version'], { timeout: 60000 });
    const media = path.join(userData, 'Elitesand Pro Media');
    if (!fs.existsSync(media)) throw new Error('macOS media folder was not created under userData.');
    log('Boot check passed: healthy start, clean exit, yt-dlp runtime seeded and runnable, media folder in userData.');
  } catch (error) {
    process.stderr.write(`----- packaged app output -----\n${output.slice(-20000)}\n`);
    throw error;
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ─── 5. DMG ─────────────────────────────────────────────────────────────────

function makeDmg(appDir, dmgPath) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-dmg-'));
  try {
    run('ditto', [appDir, path.join(staging, 'Elitesand Pro.app')]);
    fs.symlinkSync('/Applications', path.join(staging, 'Applications'));
    fs.rmSync(dmgPath, { force: true });
    run('hdiutil', ['create', '-volname', 'Elitesand Pro', '-srcfolder', staging, '-ov', '-format', 'UDZO', dmgPath]);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const hash = sha256File(dmgPath);
  fs.writeFileSync(`${dmgPath}.sha256`, hash);
  return hash;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('build-mac.js must run on macOS (codesign/hdiutil/plutil are required).');
  const args = parseArgs(process.argv);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const outputDir = path.join(ROOT, 'dist', 'releases', `v${pkg.version}`, `mac-${args.arch}`);
  assertInside(RESOURCES, ROOT);
  assertInside(outputDir, ROOT);
  fs.rmSync(RESOURCES, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  for (const dir of [APP_STAGE, TOOLS_STAGE, LICENSES_STAGE, outputDir]) fs.mkdirSync(dir, { recursive: true });

  try {
    stageApp(pkg);
    writeNpmLicenseInventory();
    const ytdlp = await stageYtdlp();
    const node = await stageNode(args.arch);
    run(process.execPath, [path.join(ROOT, 'tools', 'write-packaged-resource-integrity.js'), APP_STAGE, TOOLS_STAGE]);

    const builderOut = path.join(outputDir, 'builder');
    const appDir = buildApp(pkg, args.arch, builderOut);
    adHocSign(appDir);
    await verifyApp(appDir, args.arch);
    if (args.bootCheck) {
      if (args.arch === process.arch) await bootCheck(appDir);
      else log(`Boot check skipped: building ${args.arch} on a ${process.arch} runner.`);
    }
    // CI 會帶 ELITESAND_BUILD_LABEL（例如 beta.12），讓測試回報能對得上是哪一次建置。
    const label = /^[A-Za-z0-9.]{1,32}$/.test(process.env.ELITESAND_BUILD_LABEL || '') ? `-${process.env.ELITESAND_BUILD_LABEL}` : '';
    const dmgPath = path.join(outputDir, `Elitesand-Pro-${pkg.version}${label}-mac-${args.arch}.dmg`);
    const dmgHash = makeDmg(appDir, dmgPath);
    fs.writeFileSync(path.join(outputDir, 'BUILD-INFO.txt'), [
      `Elitesand Pro ${pkg.version}${label} for macOS (${args.arch})`,
      `Built: ${new Date().toISOString()}`,
      `Source commit: ${process.env.GITHUB_SHA || capture('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).trim()}`,
      `DMG SHA-256: ${dmgHash}`,
      `Bundled yt-dlp: ${ytdlp.version} (sha256 ${ytdlp.sha256})`,
      `Bundled Node.js for yt-dlp: v${node.version}`,
      'Signing: ad-hoc only (no Apple Developer ID, not notarized).',
      '',
    ].join('\n'));
    log(`DMG: ${dmgPath}`);
    log(`SHA-256: ${dmgHash}`);
  } finally {
    fs.rmSync(RESOURCES, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { parseArgs, builderConfig };
