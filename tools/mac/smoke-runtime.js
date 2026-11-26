#!/usr/bin/env node
'use strict';

/**
 * macOS CI 實機檢查（在 GitHub Actions 的 macOS runner 上跑，不需要實體 Mac）：
 *
 *   node tools/mac/smoke-runtime.js "<path to Elitesand Pro.app>"
 *
 * 1. 打包進 app 的 Node 與 yt-dlp 能在這台 Mac 上執行；
 * 2. 用 app 內建的「下載 FFmpeg」程式碼路徑實際下載這個 CPU 架構的 ffmpeg/ffprobe，
 *    通過 SHA-256 與執行驗證，再實際轉一段音訊並用 ffprobe 讀回；
 * 3. 盡力而為：用 yt-dlp ＋ 隨附 Node 解析一支 YouTube 影片的資訊（CI 機房常被
 *    YouTube 擋，失敗只列警告，交給真人測試確認）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function log(message) { process.stdout.write(`[mac-smoke] ${message}\n`); }

async function main() {
  if (process.platform !== 'darwin') throw new Error('Run this on macOS.');
  const appDir = path.resolve(process.argv[2] || '');
  const tools = path.join(appDir, 'Contents', 'Resources', 'tools');
  const node = path.join(tools, 'node');
  const ytdlp = path.join(tools, 'yt-dlp');
  if (!fs.existsSync(node) || !fs.existsSync(ytdlp)) throw new Error(`Bundled tools not found under ${tools}`);

  log(`bundled node: ${execFileSync(node, ['--version'], { encoding: 'utf8' }).trim()} (${process.arch})`);
  log(`bundled yt-dlp: ${execFileSync(ytdlp, ['--version'], { encoding: 'utf8', timeout: 120000 }).trim()}`);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-mac-smoke-'));
  process.env.ELITESAND_DATA_DIR = dataDir;
  try {
    const ffmpegProvider = require('../../server/services/ffmpeg-provider');
    log(`downloading FFmpeg for ${process.arch} through the in-app provider...`);
    const result = await ffmpegProvider.downloadFfmpeg({ platform: 'darwin', arch: process.arch });
    log(`FFmpeg installed from ${result.source}: ${result.ffmpeg}`);
    log(execFileSync(result.ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0]);

    const tone = path.join(dataDir, 'tone.mp3');
    execFileSync(result.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-codec:a', 'libmp3lame', '-b:a', '192k', tone]);
    const duration = Number(execFileSync(result.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tone], { encoding: 'utf8' }).trim());
    if (!(duration > 2.5 && duration < 3.5)) throw new Error(`Unexpected transcoded duration ${duration}`);
    log(`transcode + probe OK (${duration.toFixed(2)} s)`);
    if (!ffmpegProvider.isAvailable()) throw new Error('Provider does not report the downloaded FFmpeg as available.');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  await macBetaDiagSmoke(appDir);

  try {
    const title = execFileSync(ytdlp, ['--js-runtimes', `node:${node}`, '--no-warnings', '--skip-download', '--print', 'title',
      'https://www.youtube.com/watch?v=jNQXAC9IVRw'], { encoding: 'utf8', timeout: 180000 }).trim();
    log(`YouTube metadata OK: ${title}`);
  } catch (error) {
    log(`WARNING: YouTube metadata check failed on this CI machine (often blocked for datacenter IPs): ${String(error.stderr || error.message).split('\n').slice(-3).join(' | ')}`);
  }
  log('runtime smoke passed');
}

/**
 * Mac 內測版診斷回報：打包出來的 app 帶著內測版旗標，且在真的 macOS 上偵測到的
 * 晶片／系統版本／記憶體級距會組成一份能通過白名單的 payload（送到本機的假端點，不連外）。
 */
async function macBetaDiagSmoke(appDir) {
  const asar = fs.readFileSync(path.join(appDir, 'Contents', 'Resources', 'app.asar'));
  if (!asar.includes(Buffer.from('"elitesandMacBeta"'))) throw new Error('Packaged package.json is missing the elitesandMacBeta flag.');
  const http = require('http');
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push(body); res.writeHead(202).end('{}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-mac-diag-'));
  try {
    const fields = require('../../server/services/mac-beta-diag-fields');
    const { createMacBetaDiagnostics } = require('../../server/services/mac-beta-diagnostics');
    const diag = createMacBetaDiagnostics({
      packageJson: { elitesandMacBeta: { build: 'smoke' } },
      config: { macBetaDiagEndpoint: `http://127.0.0.1:${server.address().port}/api/v1/diag` },
      dataDir,
      usageSettings: () => ({ enabled: true, eulaAccepted: true }),
      env: { ELITESAND_YTDLP_NODE_PATH: path.join(appDir, 'Contents', 'Resources', 'tools', 'node') },
    });
    diag.acknowledgeNotice();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await diag.flush();
    if (received.length !== 1) throw new Error(`Expected one diagnostics batch, got ${received.length}`);
    const payload = JSON.parse(received[0]);
    if (!fields.validPayload(payload)) throw new Error(`Diagnostics payload failed the whitelist: ${received[0]}`);
    const launch = payload.events.find((event) => event.type === 'launch');
    const node = payload.events.find((event) => event.name === 'bundled_node');
    if (!launch || !node || node.code !== 'ok') throw new Error(`Unexpected diagnostics events: ${received[0]}`);
    log(`mac beta diagnostics OK: ${JSON.stringify(payload.events)}`);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
