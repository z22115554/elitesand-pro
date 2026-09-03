'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STDIO_STRESS_REQUESTS = 1000;
const STDIO_STRESS_BATCH_SIZE = 25;
const MIN_STRESS_LOG_BYTES = 65536;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, timeout: 1500 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('timeout', () => req.destroy(new Error(`Timeout: ${pathname}`)));
    req.once('error', reject);
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited early (${child.exitCode})`);
    try {
      const response = await request(port, '/api/health');
      if (response.status === 200) return JSON.parse(response.body);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Electron shell did not become healthy: ${lastError?.message || 'timeout'}`);
}

async function generateServerLogVolume(port) {
  for (let offset = 0; offset < STDIO_STRESS_REQUESTS; offset += STDIO_STRESS_BATCH_SIZE) {
    const count = Math.min(STDIO_STRESS_BATCH_SIZE, STDIO_STRESS_REQUESTS - offset);
    const responses = await Promise.all(Array.from({ length: count }, () => request(port, '/api/twitch/status')));
    responses.forEach((response) => assert(
      response.status === 200 || response.status === 304,
      `Twitch status stress request returned HTTP ${response.status}`,
    ));
  }
}

function totalLogBytes(logsDir) {
  if (!fs.existsSync(logsDir)) return 0;
  return fs.readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + fs.statSync(path.join(logsDir, entry.name)).size, 0);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-electron-smoke-'));
  const port = 39000 + Math.floor(Math.random() * 1000);
  const electronBinary = require('electron');
  let output = '';
  const userDataDir = path.join(runtimeRoot, 'user-data');
  const child = spawn(electronBinary, [`--user-data-dir=${userDataDir}`, 'electron/main.js'], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      ELITESAND_SHELL_HEADLESS: '1',
      // 只是「殼萬一卡住也會自己收掉」的保險絲，不是被測行為——這支 smoke 在檢查做完
      // 之後本來就會自己 child.kill()（見下方 exited/kill 那段）。原本設 10 秒，但同一段
      // 時間內還要跑完 1000 筆帶 log 的 /api/twitch/status 壓力請求：機器稍慢或 Electron
      // 啟動久一點，殼就會在迴圈跑到一半自己退出，表現成 `Timeout: /api/twitch/status`
      // 的假失敗（已確認在未修改的 b439e10 上同樣重現，與任何功能改動無關）。放寬保險絲
      // 不會放過任何斷言，只是不讓計時賽跑決定測試結果。
      ELITESAND_SHELL_QUIT_AFTER_READY_MS: '90000',
      ELITESAND_SHELL_PORT: String(port),
      ELITESAND_SHELL_USER_DATA_DIR: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12000); });

  try {
    const health = await waitForHealth(port, child);
    const panel = await request(port, '/panel');
    const announcements = await request(port, '/api/announcements?force=1');
    assert(health.status === 'ok', 'Electron server health response is invalid');
    assert(panel.status === 200, `Electron panel returned HTTP ${panel.status}`);
    assert(announcements.status === 200, `Electron announcements returned HTTP ${announcements.status}`);
    const announcementPayload = JSON.parse(announcements.body);
    assert(
      Array.isArray(announcementPayload.announcements) && announcementPayload.announcements.length === 0
        && Object.keys(announcementPayload.actions || {}).length === 0,
      'Source-tree Electron shell must not apply remote production announcements',
    );
    await generateServerLogVolume(port);
    const healthAfterStress = await request(port, '/api/health');
    assert(healthAfterStress.status === 200, `Electron server stopped responding after stdout stress (HTTP ${healthAfterStress.status})`);
    assert(JSON.parse(healthAfterStress.body).status === 'ok', 'Electron health payload became invalid after stdout stress');
    // The Electron shutdown contract is covered by the unit suite. End this
    // isolated stress host explicitly after its HTTP/renderer checks so the
    // smoke result is not coupled to a native-window event-loop quirk.
    const exited = new Promise((resolve) => child.once('exit', resolve));
    if (child.exitCode === null) child.kill();
    await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Electron did not exit after smoke completion')), 10000)),
    ]);
    const logBytes = totalLogBytes(path.join(userDataDir, 'logs'));
    assert(logBytes > MIN_STRESS_LOG_BYTES,
      `Electron stdout stress produced only ${logBytes} log bytes; expected more than ${MIN_STRESS_LOG_BYTES}`);
    process.stdout.write(
      `Electron shell smoke passed: port ${port}, ${STDIO_STRESS_REQUESTS} logged requests (${logBytes} bytes), `
      + 'health after stdout stress, server lifecycle, and panel route OK.\n',
    );
  } catch (error) {
    throw new Error(`${error.message}\nElectron output:\n${output}`);
  } finally {
    if (child.exitCode === null) child.kill();
    // Electron can release a renderer/profile handle one or two event-loop
    // turns after its main process exits on Windows. This is only the unique
    // temporary smoke profile, so retry its cleanup briefly before reporting
    // a false-negative smoke result.
    try {
      fs.rmSync(runtimeRoot, {
        recursive: true,
        force: true,
        maxRetries: 25,
        retryDelay: 200,
      });
    } catch (error) {
      if (error?.code !== 'EPERM') throw error;
      process.stderr.write(`Electron smoke temporary profile cleanup deferred: ${runtimeRoot}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`Electron shell smoke failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
