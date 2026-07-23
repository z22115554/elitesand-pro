'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(1500, () => req.destroy(new Error(`Timeout: ${pathname}`)));
    req.on('error', reject);
    req.end();
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged server exited early with code ${child.exitCode}`);
    try {
      const response = await request(port, '/api/health');
      if (response.status === 200) return response;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged server did not become healthy: ${lastError?.message || 'timeout'}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const stage = path.resolve(process.argv[2] || '');
  assert(process.argv[2], 'Usage: node tools/smoke-portable.js <portable-folder>');
  const appRoot = path.join(stage, 'app');
  const runtime = path.join(stage, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  const launcher = path.join(stage, 'Start Elitesand Pro.cmd');
  for (const required of [
    appRoot, runtime, launcher, path.join(stage, 'README-FIRST.txt'), path.join(stage, 'LICENSE'),
    path.join(stage, 'EULA.txt'),
    path.join(stage, 'THIRD-PARTY-NOTICES.txt'), path.join(stage, 'portable-manifest.json'),
    path.join(appRoot, 'server', 'index.js'), path.join(appRoot, 'public', 'index.html'),
    path.join(appRoot, 'node_modules'), path.join(stage, 'tools', 'yt-dlp.exe'),
  ]) assert(fs.existsSync(required), `Portable package is missing: ${path.relative(stage, required)}`);

  // GPLv3 合規：包內有 ffmpeg.exe 就必須同時附 GPL 全文與對應 commit 的源碼快照
  if (fs.existsSync(path.join(stage, 'tools', 'ffmpeg.exe'))) {
    const ffmpegLicenseDir = path.join(stage, 'licenses', 'ffmpeg');
    assert(fs.existsSync(path.join(ffmpegLicenseDir, 'COPYING.GPLv3')), 'Bundled FFmpeg requires licenses/ffmpeg/COPYING.GPLv3');
    assert(fs.existsSync(ffmpegLicenseDir) && fs.readdirSync(ffmpegLicenseDir).some((name) => /^ffmpeg-source-.+\.zip$/.test(name)),
      'Bundled FFmpeg requires the matching source snapshot zip in licenses/ffmpeg');
  }

  assert(!fs.existsSync(path.join(appRoot, 'server', 'config.js')), 'Portable package must not contain server/config.js');
  const launcherBytes = fs.readFileSync(launcher);
  assert(!(launcherBytes[0] === 0xef && launcherBytes[1] === 0xbb && launcherBytes[2] === 0xbf), 'Launcher must be BOM-free ASCII');
  const launcherText = launcherBytes.toString('ascii');
  assert(!/powershell|invoke-webrequest/i.test(launcherText), 'Launcher must stay pure cmd without PowerShell/network polling');

  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'portable-manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  assert(manifest.version === packageJson.version, 'Portable manifest and app package versions differ');

  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-portable-smoke-'));
  const dataDir = path.join(runtimeRoot, 'data');
  const downloadsDir = path.join(runtimeRoot, 'downloads');
  const logsDir = path.join(runtimeRoot, 'logs');
  const port = 36000 + Math.floor(Math.random() * 2000);
  let output = '';
  const child = spawn(runtime, ['server/index.js'], {
    cwd: appRoot,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      OPEN_BROWSER: '0',
      ELITESAND_DATA_DIR: dataDir,
      ELITESAND_DOWNLOADS_DIR: downloadsDir,
      ELITESAND_LOGS_DIR: logsDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12000); });

  try {
    const health = await waitForHealth(port, child);
    const healthJson = JSON.parse(health.body);
    assert(healthJson.version === packageJson.version, 'Running packaged server reports the wrong version');
    for (const route of ['/', '/controller', '/display', '/setlist']) {
      const response = await request(port, route, { 'user-agent': 'ElitesandPortableSmoke/1.0' });
      assert(response.status === 200, `${route} returned HTTP ${response.status}`);
    }
    const mobile = await request(port, '/', { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile' });
    assert(mobile.status === 302 && mobile.headers.location === '/controller', `Mobile route expected 302 /controller, got ${mobile.status} ${mobile.headers.location || ''}`);
    // 全新 data 目錄 = 首次啟動：EULA 同意閘門必須是待同意狀態且附上條款全文
    const eula = await request(port, '/api/eula');
    assert(eula.status === 200, `/api/eula returned HTTP ${eula.status}`);
    const eulaJson = JSON.parse(eula.body);
    assert(eulaJson.required === true && typeof eulaJson.version === 'string' && typeof eulaJson.text === 'string' && eulaJson.text.length > 1000,
      `Fresh install must require EULA acceptance with full text, got ${JSON.stringify({ required: eulaJson.required, version: eulaJson.version, textLength: (eulaJson.text || '').length })}`);
    process.stdout.write(`Portable smoke passed: v${packageJson.version}, port ${port}, four routes, mobile redirect and EULA gate OK.\n`);
  } catch (error) {
    throw new Error(`${error.message}\nPackaged server output:\n${output}`);
  } finally {
    await stopChild(child);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Portable smoke failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
