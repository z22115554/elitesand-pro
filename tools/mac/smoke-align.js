#!/usr/bin/env node
'use strict';

/**
 * macOS 精準對時元件的 CI 實機檢查（GitHub Actions）：
 *
 *   node tools/mac/smoke-align.js <data-dir> <report.json>
 *
 * Apple Silicon（macos-15 arm64）：
 * 1. 用 app 自己的安裝流程（align-runtime-provider.downloadRuntime）在全新的資料夾裝精準對時元件——
 *    沒有先裝人聲分離元件包，確認它能單獨裝。Python 與套件照鎖定清單驗雜湊，模型驗 SHA-256，
 *    最後在 CPU 上空跑一次。下載量、安裝後大小、安裝時間寫進報告。
 * 2. 直接啟動 worker 送 ping／warmup，檢查回應結構與裝置（cpu）。
 * 3. 用 macOS 內建的 say 唸一段自己編的中文歌詞（有中文語音就用中文語音，沒有就用預設語音——
 *    這時只驗流程與輸出結構，不要求對得準），排成已知的時間軸；歌詞時間故意比聲音晚 1.5 秒。
 *    經 app 的 align-model-jobs 跑一次 global（整首偏移）與 lines（逐句對齊），檢查回傳結構、
 *    worker 沒有當掉；實際偏移與逐句誤差只記錄、不當作通過條件。
 * Intel（macos-15-intel）：確認 app 判定「不支援」，背景自動安裝不會開始、手動安裝在下載前就拒絕。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

function log(message) { process.stdout.write(`[mac-align-smoke] ${message}\n`); }

const SR = 16000;
const LEAD_SECONDS = 2;
const GAP_SECONDS = 0.8;
const TRUE_OFFSET_MS = 1500; // 歌詞時間 − 聲音時間（跟 app 的歌曲偏移同號）
// 自己編的測試歌詞（不是任何真實歌曲）
const LYRICS = [
  '春天的風吹過小小的山坡',
  '我們在河邊慢慢地走著',
  '天上的星星一顆一顆亮起來',
  '遠方的燈火照著回家的路',
  '明天的太陽還會再升起',
  '把今天的故事輕輕放在心裡',
  '城市的夜晚安靜又溫柔',
  '我們一起唱著簡單的歌',
];

function duBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  return Number(execFileSync('du', ['-sk', dir], { encoding: 'utf8' }).split(/\s/)[0]) * 1024;
}

/** 讀 afconvert 產生的 WAVE（LEF32、16kHz、單聲道） */
function readFloatWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAVE file`);
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt || fmt.channels !== 1 || fmt.rate !== SR || fmt.bits !== 32) throw new Error(`unexpected WAVE format ${JSON.stringify(fmt)}`);
      const out = new Float32Array(Math.floor(size / 4));
      for (let i = 0; i < out.length; i += 1) out[i] = buf.readFloatLE(body + i * 4);
      return out;
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${file} has no data chunk`);
}

/** say -v '?' 的輸出裡找中文語音（台灣優先），沒有就回 null */
function pickChineseVoice() {
  let list = '';
  try { list = execFileSync('/usr/bin/say', ['-v', '?'], { encoding: 'utf8' }); } catch (_) { return { voice: null, locale: null, voices: 0 }; }
  const voices = list.split('\n').map((line) => /^(.+?)\s+([a-z]{2,3}_[A-Z0-9]{2,3})\s+#/.exec(line)).filter(Boolean)
    .map((m) => ({ name: m[1].trim(), locale: m[2] }));
  for (const locale of ['zh_TW', 'zh_CN', 'zh_HK']) {
    const hit = voices.find((v) => v.locale === locale);
    if (hit) return { voice: hit.name, locale, voices: voices.length };
  }
  return { voice: null, locale: null, voices: voices.length };
}

function speak(text, voice, workDir, index) {
  const aiff = path.join(workDir, `line-${index}.aiff`);
  const wav = path.join(workDir, `line-${index}.wav`);
  execFileSync('/usr/bin/say', [...(voice ? ['-v', voice] : []), '-r', '170', '-o', aiff, text]);
  execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', `LEF32@${SR}`, '-c', '1', aiff, wav]);
  return readFloatWav(wav);
}

/** 排出測試音訊：開頭 2 秒安靜，每句之間 0.8 秒；回傳樣本與每句真正開口的時間（ms） */
function buildTestAudio(voice, workDir) {
  const parts = [];
  const onsets = [];
  let cursor = LEAD_SECONDS * SR;
  parts.push(new Float32Array(cursor));
  LYRICS.forEach((text, i) => {
    const clip = speak(text, voice, workDir, i);
    // 跳過語音檔開頭的靜音，讓「開口時間」貼近真的出聲的位置
    let start = 0;
    while (start < clip.length && Math.abs(clip[start]) < 0.01) start += 1;
    const voiced = clip.subarray(start);
    onsets.push(Math.round(cursor / SR * 1000));
    parts.push(voiced);
    cursor += voiced.length;
    const gap = new Float32Array(Math.round(GAP_SECONDS * SR));
    parts.push(gap);
    cursor += gap.length;
  });
  parts.push(new Float32Array(3 * SR));
  cursor += 3 * SR;
  const samples = new Float32Array(cursor);
  let at = 0;
  for (const part of parts) { samples.set(part, at); at += part.length; }
  return { samples, onsets };
}

/** 直接跑 worker 送 ping／warmup（app 平常由 align-model-jobs 管理同一支程序） */
function pingWorker(provider, files) {
  return new Promise((resolve, reject) => {
    const child = spawn(provider.PYTHON_EXE, [provider.workerScript()], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...provider.workerEnv(files) } });
    const replies = [];
    let buffer = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`worker ping/warmup timed out; stderr: ${stderr.slice(-800)}`)); }, 5 * 60 * 1000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        replies.push(JSON.parse(buffer.slice(0, i)));
        buffer = buffer.slice(i + 1);
        if (replies.length === 2) { clearTimeout(timer); child.stdin.end(); }
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (replies.length === 2) resolve({ replies, exitCode: code });
      else reject(new Error(`worker exited (${code}) after ${replies.length} replies; stderr: ${stderr.slice(-800)}`));
    });
    child.stdin.write(`${JSON.stringify({ id: 1, op: 'ping' })}\n${JSON.stringify({ id: 2, op: 'warmup' })}\n`);
  });
}

async function expectUnsupported(report) {
  const provider = require('../../server/services/align-runtime-provider');
  const info = provider.getStatusInfo();
  report.status = { supported: info.supported, unsupportedReason: info.unsupportedReason };
  if (info.supported !== false || info.unsupportedReason !== 'intel') throw new Error(`Intel Mac should be unsupported: ${JSON.stringify(info)}`);
  let started = false;
  report.autoInstallStarted = provider.autoInstall('ci-intel-check', { downloadImpl: async () => { started = true; } });
  if (report.autoInstallStarted || started) throw new Error('autoInstall must not start on an Intel Mac');
  try {
    await provider.downloadRuntime({ fetchFileImpl: async () => { throw new Error('must not download on an Intel Mac'); } });
    throw new Error('downloadRuntime should have refused');
  } catch (error) {
    if (error.code !== 'MAC_UNSUPPORTED') throw error;
    report.downloadRefused = error.code;
  }
  report.note = 'Precise sync is Apple Silicon only: onnxruntime >= 1.24 and sentencepiece 0.2.3 publish no macOS x86_64 wheels.';
}

async function main() {
  const dataDir = path.resolve(process.argv[2] || '');
  const reportFile = path.resolve(process.argv[3] || 'align-smoke.json');
  if (process.platform !== 'darwin' || !process.argv[2]) throw new Error('usage (macOS): smoke-align.js <data-dir> <report.json>');
  process.env.ELITESAND_DATA_DIR = dataDir;
  process.env.ELITESAND_DOWNLOADS_DIR = path.join(dataDir, 'downloads');
  process.env.ELITESAND_LOGS_DIR = path.join(dataDir, 'logs');
  for (const dir of ['downloads', 'logs', 'work']) fs.mkdirSync(path.join(dataDir, dir), { recursive: true });
  const report = { arch: process.arch, timings: {}, bytes: {} };
  const startedAll = Date.now();
  try {
    if (process.arch !== 'arm64') {
      await expectUnsupported(report);
      report.ok = true;
      return;
    }
    const provider = require('../../server/services/align-runtime-provider');
    const aiRuntime = require('../../server/services/ai-runtime-provider');
    const alignModel = require('../../server/services/align-model-jobs');
    const preciseSync = require('../../server/services/precise-sync');
    const info = provider.getStatusInfo();
    report.estimate = { downloadBytes: info.expectedDownloadBytes, installedBytes: info.expectedInstalledBytes, requiredFreeBytes: info.requiredFreeBytes };
    if (!info.supported) throw new Error(`Apple Silicon runner reported unsupported: ${JSON.stringify(info)}`);
    if (fs.existsSync(aiRuntime.RUNTIME_DIR)) throw new Error('AI separation runtime already exists; this check must install precise sync on its own.');

    // ── 1. 安裝（app 的流程；包一層只為了記錄下載量與 pip 選到的 wheel）──
    const fetched = {};
    const wheels = [];
    let wheelBytes = 0;
    const fetchFileImpl = async (url, file, opts) => {
      const result = await aiRuntime.fetchToFile(url, file, opts);
      fetched[url.endsWith('.tar.bz2') ? 'model' : 'python'] = fs.statSync(file).size;
      return result;
    };
    const runPythonStepImpl = (args, opts = {}) => aiRuntime.runPythonStep(args, {
      ...opts,
      onOutput: (text) => {
        for (const m of String(text).matchAll(/Downloading (\S+\.whl) \(([\d.]+) (kB|MB)\)/g)) {
          wheels.push(m[1]);
          wheelBytes += Number(m[2]) * (m[3] === 'MB' ? 1e6 : 1e3);
        }
        opts.onOutput?.(text);
      },
    });
    let t = Date.now();
    const installed = await provider.downloadRuntime({ fetchFileImpl, runPythonStepImpl });
    report.timings.installSeconds = Math.round((Date.now() - t) / 100) / 10;
    const files = provider.getInstalled();
    if (!installed.ok || !files || files.device !== 'cpu') throw new Error(`Not installed after downloadRuntime: ${JSON.stringify({ installed, files })}`);
    for (const leftover of ['python.download', 'python-mac.download.tar.gz']) {
      if (fs.existsSync(path.join(provider.RUNTIME_DIR, leftover))) throw new Error(`Leftover after install: ${leftover}`);
    }
    report.wheels = wheels.sort();
    if (wheels.some((w) => /x86_64|win_amd64|linux/.test(w))) throw new Error(`Unexpected wheel platform: ${wheels.join(', ')}`);
    report.bytes = {
      pythonDownload: fetched.python || 0,
      wheelsDownload: Math.round(wheelBytes),
      modelDownload: fetched.model || 0,
      installed: duBytes(provider.RUNTIME_DIR),
      pythonDir: duBytes(path.join(provider.RUNTIME_DIR, 'python')),
      modelDir: duBytes(path.join(provider.RUNTIME_DIR, 'model')),
    };
    report.bytes.downloadTotal = report.bytes.pythonDownload + report.bytes.wheelsDownload + report.bytes.modelDownload;
    report.onnxruntime = execFileSync(provider.PYTHON_EXE, ['-I', '-c', 'import json, platform, onnxruntime as o, numpy, sentencepiece, kaldi_native_fbank\nprint(json.dumps({"version": o.__version__, "providers": o.get_available_providers(), "machine": platform.machine(), "numpy": numpy.__version__}))'], { encoding: 'utf8' }).trim();
    log(`installed in ${report.timings.installSeconds}s, ${(report.bytes.installed / 1e6).toFixed(0)} MB on disk, downloaded ${(report.bytes.downloadTotal / 1e6).toFixed(0)} MB; ${report.onnxruntime}`);

    // ── 2. ping／warmup ──
    t = Date.now();
    const { replies } = await pingWorker(provider, files);
    report.timings.pingWarmupSeconds = Math.round((Date.now() - t) / 100) / 10;
    const [ping, warm] = replies;
    report.ping = ping;
    report.warmup = warm;
    if (!(ping.ok === true && ping.id === 1 && ping.pong === true && ping.device === 'cpu')) throw new Error(`Bad ping reply: ${JSON.stringify(ping)}`);
    if (!(warm.ok === true && warm.id === 2 && warm.device === 'cpu' && Number.isFinite(warm.seconds))) throw new Error(`Bad warmup reply: ${JSON.stringify(warm)}`);

    // ── 3. 測試音訊＋自編歌詞，經 app 的 align-model-jobs 跑 global 與 lines ──
    const voice = pickChineseVoice();
    report.voice = { name: voice.voice, locale: voice.locale, chinese: !!voice.voice, installedVoices: voice.voices };
    log(`say voices: ${voice.voices}; using ${voice.voice ? `${voice.voice} (${voice.locale})` : 'the default voice (no Chinese voice on this runner)'}`);
    const { samples, onsets } = buildTestAudio(voice.voice, path.join(dataDir, 'work'));
    report.audioSeconds = Math.round(samples.length / SR * 10) / 10;
    const lines = LYRICS.map((text, i) => ({
      time: onsets[i] + TRUE_OFFSET_MS,
      duration: (i + 1 < onsets.length ? onsets[i + 1] - onsets[i] : 3000) - Math.round(GAP_SECONDS * 1000),
      text,
    }));
    const workerLines = preciseSync.toWorkerLines(lines);
    const cacheKey = `smoke|${samples.length}`;

    t = Date.now();
    const results = await alignModel.analyzeGlobal(samples, cacheKey, [{ key: 'current', lines: workerLines }]);
    report.timings.globalSeconds = Math.round((Date.now() - t) / 100) / 10;
    const g = results && results.current;
    if (!g || !Number.isInteger(g.offsetMs) || !Number.isFinite(g.peakZ) || !Number.isFinite(g.peakRatio) || !(g.units >= 20)) {
      throw new Error(`Bad global result: ${JSON.stringify(results)}`);
    }
    report.global = {
      offsetMs: g.offsetMs, centerMs: preciseSync.modelCenterMs(g), trueOffsetMs: TRUE_OFFSET_MS,
      peakZ: Math.round(g.peakZ * 100) / 100, peakRatio: Math.round(g.peakRatio * 100) / 100, units: g.units, passes: preciseSync.modelPasses(g),
    };
    log(`global in ${report.timings.globalSeconds}s: ${JSON.stringify(report.global)}`);

    t = Date.now();
    const alignment = await alignModel.alignLines(samples, cacheKey, workerLines, TRUE_OFFSET_MS, 8);
    report.timings.linesSeconds = Math.round((Date.now() - t) / 100) / 10;
    if (!alignment || typeof alignment.onsets !== 'object' || typeof alignment.conf !== 'object') throw new Error(`Bad lines result: ${JSON.stringify(alignment)}`);
    const keys = Object.keys(alignment.onsets);
    for (const key of keys) {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i >= LYRICS.length || !Number.isFinite(alignment.onsets[key]) || !Number.isFinite(alignment.conf[key])) {
        throw new Error(`Bad lines entry ${key}: ${JSON.stringify(alignment)}`);
      }
    }
    const errors = keys.map((key) => Math.abs(alignment.onsets[key] - preciseSync.LINE_BIAS_MS - onsets[Number(key)])).sort((a, b) => a - b);
    const retimed = preciseSync.retimeLines(lines, TRUE_OFFSET_MS, alignment);
    report.lines = {
      aligned: keys.length, total: LYRICS.length,
      medianAbsErrorMs: errors.length ? errors[Math.floor(errors.length / 2)] : null,
      minConf: keys.length ? Math.min(...keys.map((k) => alignment.conf[k])) : null,
      appWouldMove: retimed.moved,
    };
    log(`lines in ${report.timings.linesSeconds}s: ${JSON.stringify(report.lines)}`);
    if (!alignModel.isRunning()) throw new Error('align worker is no longer running after the requests (crashed?)');
    alignModel.stop('smoke done');
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String(error && error.message || error).slice(0, 1500);
    throw error;
  } finally {
    report.timings.totalSeconds = Math.round((Date.now() - startedAll) / 1000);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  log('precise sync smoke passed');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
}

module.exports = { readFloatWav, LYRICS, TRUE_OFFSET_MS };
