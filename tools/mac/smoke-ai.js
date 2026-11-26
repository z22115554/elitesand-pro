#!/usr/bin/env node
'use strict';

/**
 * macOS（Apple Silicon）AI 人聲分離＋練唱音高線的 CI 實機檢查（GitHub Actions 的 macos-15 arm64）：
 *
 *   node tools/mac/smoke-ai.js <data-dir> <report.json>
 *
 * 1. 用 app 自己的安裝流程（ai-separation-bundle.downloadBundle）裝 Mac 元件包：
 *    python-build-standalone＋鎖定清單（--require-hashes）＋ Kim 主模型；FFmpeg 也用 app 的下載流程。
 * 2. 合成一段 15 秒的測試音訊（正弦波旋律加泛音當「人聲」、低音和弦＋大鼓＋沙沙聲當「伴奏」，
 *    沒有任何有版權的素材），交給 app 的 Python supervisor 真的分離一次：先走 GPU（MPS），
 *    MPS 不可用或失敗就跟 app 一樣改用 CPU。檢查人聲、伴奏兩個檔都在、長度正確、不是靜音。
 * 3. 對分離出的人聲跑 app 的練唱音高線服務（YIN），檢查有音高資料而且音高接近合成的旋律。
 * 實際用的裝置、各段耗時寫進 report.json（建置流程再附到 BUILD-INFO.txt）。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function log(message) { process.stdout.write(`[mac-ai-smoke] ${message}\n`); }

const SAMPLE_RATE = 44100;
const SECONDS = 15;
const NOTE_SECONDS = 1.5;
const MELODY = [69, 71, 72, 74, 76, 74, 72, 71, 69, 67]; // A4 B4 C5 D5 E5 D5 C5 B4 A4 G4

const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** 寫一個 16-bit PCM WAV；channels 是 Float32Array 陣列 */
function writeWav(file, channels) {
  const frames = channels[0].length;
  const data = Buffer.alloc(frames * channels.length * 2);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels.length; c += 1) {
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), (i * channels.length + c) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels.length, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * channels.length * 2, 28);
  header.writeUInt16LE(channels.length * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

function synthesize(file, { voiceOnly = false } = {}) {
  const frames = SAMPLE_RATE * SECONDS;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let phase = 0;
  let seed = 12345;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 1073741824 - 1; };
  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    const noteIndex = Math.min(MELODY.length - 1, Math.floor(t / NOTE_SECONDS));
    const inNote = t - noteIndex * NOTE_SECONDS;
    // 「人聲」：旋律＋5.5Hz 顫音＋幾個泛音，每個音頭尾淡入淡出
    const f0 = midiHz(MELODY[noteIndex]) * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t));
    phase += 2 * Math.PI * f0 / SAMPLE_RATE;
    const envelope = Math.min(1, inNote / 0.06, (NOTE_SECONDS - inNote) / 0.08);
    const voice = envelope * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase) + 0.15 * Math.sin(4 * phase)) / 1.95;
    // 「伴奏」：A 小調低音和弦（每 3 秒換一次）、每拍一下大鼓、反拍的沙沙聲
    const chordRoot = [45, 41, 43, 40, 45][Math.floor(t / 3) % 5];
    const pad = [0, 7, 12].reduce((sum, interval) => sum + Math.sin(2 * Math.PI * midiHz(chordRoot + interval) * t), 0) / 3;
    const beat = t % 0.5;
    const kick = Math.exp(-beat * 18) * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-beat * 30)) * beat);
    const offBeat = (t + 0.25) % 0.5;
    const hat = Math.exp(-offBeat * 60) * noise() * 0.5;
    const accompaniment = 0.45 * pad + 0.6 * kick + 0.25 * hat;
    const acc = voiceOnly ? 0 : accompaniment;
    left[i] = 0.45 * voice + 0.4 * acc;
    right[i] = 0.45 * voice + 0.4 * acc * 0.9;
  }
  writeWav(file, [left, right]);
}

function probeDuration(ffprobe, file) {
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
}

/** 用 ffmpeg 解成 16k 單聲道 float，算 RMS（dBFS） */
function rmsDb(ffmpeg, file) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  let sum = 0;
  for (const value of samples) sum += value * value;
  return 10 * Math.log10(sum / Math.max(1, samples.length) + 1e-12);
}

function separateOnce(supervisor, params) {
  return new Promise((resolve) => {
    const jobId = supervisor.separate(params);
    const done = (value) => {
      supervisor.emitter.off('result', onResult);
      supervisor.emitter.off('error', onError);
      resolve(value);
    };
    const onResult = (msg) => { if (msg.id === jobId) done({ ok: true, result: msg.result || {} }); };
    const onError = (msg) => { if (msg.id === jobId) done({ ok: false, error: msg.error || {} }); };
    supervisor.emitter.on('result', onResult);
    supervisor.emitter.on('error', onError);
  });
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Run this on Apple Silicon macOS.');
  const dataDir = path.resolve(process.argv[2] || '');
  const reportFile = path.resolve(process.argv[3] || 'ai-smoke.json');
  if (!process.argv[2]) throw new Error('usage: smoke-ai.js <data-dir> <report.json>');
  process.env.ELITESAND_DATA_DIR = dataDir;
  process.env.ELITESAND_DOWNLOADS_DIR = path.join(dataDir, 'downloads');
  process.env.ELITESAND_LOGS_DIR = path.join(dataDir, 'logs');
  for (const dir of ['downloads', 'logs']) fs.mkdirSync(path.join(dataDir, dir), { recursive: true });
  const report = { device: null, cpuFallback: false, timings: {}, checks: {} };
  const startedAll = Date.now();
  try {
    const ffmpegProvider = require('../../server/services/ffmpeg-provider');
    if (!ffmpegProvider.isAvailable()) await ffmpegProvider.downloadFfmpeg({ platform: 'darwin', arch: process.arch });
    const { ffmpeg, ffprobe } = ffmpegProvider.resolveFfmpegPaths();

    const bundle = require('../../server/services/ai-separation-bundle');
    const runtime = require('../../server/services/ai-runtime-provider');
    log(`bundle status before install: ${JSON.stringify(bundle.getStatus().components)}`);
    let t = Date.now();
    await bundle.downloadBundle();
    report.timings.installSeconds = Math.round((Date.now() - t) / 1000);
    if (!bundle.isAvailable()) throw new Error(`Bundle not available after install: ${JSON.stringify(bundle.getStatus())}`);
    report.python = execFileSync(runtime.PYTHON_EXE, ['--version'], { encoding: 'utf8' }).trim();
    report.torch = execFileSync(runtime.PYTHON_EXE, ['-c', 'import torch,sys; print(torch.__version__, torch.backends.mps.is_available())'], { encoding: 'utf8' }).trim();
    report.runtimeBytes = Number(execFileSync('du', ['-sk', runtime.RUNTIME_DIR], { encoding: 'utf8' }).split(/\s/)[0]) * 1024;
    log(`installed in ${report.timings.installSeconds}s: ${report.python}, torch ${report.torch}, runtime ${(report.runtimeBytes / 1e9).toFixed(2)} GB`);

    const downloads = process.env.ELITESAND_DOWNLOADS_DIR;
    const input = path.join(downloads, 'smoke-mix.wav');
    synthesize(input);
    log(`synthesized ${SECONDS}s test mix (${probeDuration(ffprobe, input).toFixed(2)} s)`);

    const { supervisor } = require('../../server/services/ai-separation');
    const probe = await supervisor.probe();
    report.probe = { mpsAvailable: probe.mpsAvailable === true, cudaAvailable: probe.cudaAvailable === true, error: probe.error || null };
    log(`probe: ${JSON.stringify(report.probe)}`);
    const params = { inputPath: input, outputDir: downloads, modelFileDir: runtime.MODEL_DIR, sourceFilename: 'smoke-mix.wav' };
    t = Date.now();
    let outcome = probe.mpsAvailable ? await separateOnce(supervisor, { ...params, forceCpu: false }) : null;
    if (outcome && !outcome.ok) log(`MPS attempt failed (${outcome.error.code}): ${String(outcome.error.message || '').slice(0, 300)}`);
    if (!outcome || !outcome.ok) {
      report.cpuFallback = !!outcome;
      outcome = await separateOnce(supervisor, { ...params, forceCpu: true });
    }
    report.timings.separationSeconds = Math.round((Date.now() - t) / 100) / 10;
    await supervisor.stop().catch(() => {});
    if (!outcome.ok) throw new Error(`Separation failed: ${JSON.stringify(outcome.error).slice(0, 800)}`);
    report.device = outcome.result.device || (report.cpuFallback || !probe.mpsAvailable ? 'cpu' : 'mps');
    log(`separated on ${report.device} in ${report.timings.separationSeconds}s`);

    const { vocal, instrumental } = outcome.result;
    if (!vocal || !instrumental || !fs.existsSync(vocal) || !fs.existsSync(instrumental)) throw new Error(`Missing outputs: ${JSON.stringify(outcome.result)}`);
    for (const [name, file] of [['vocal', vocal], ['instrumental', instrumental]]) {
      const duration = probeDuration(ffprobe, file);
      const level = rmsDb(ffmpeg, file);
      report.checks[name] = { durationSeconds: Math.round(duration * 100) / 100, rmsDb: Math.round(level * 10) / 10 };
      if (Math.abs(duration - SECONDS) > 0.6) throw new Error(`${name} duration ${duration}s, expected about ${SECONDS}s`);
      if (!(level > -45)) throw new Error(`${name} is (nearly) silent: ${level.toFixed(1)} dBFS`);
    }
    log(`outputs OK: ${JSON.stringify(report.checks)}`);

    const { createPracticeGuideService } = require('../../server/services/practice-guide-service');
    const service = createPracticeGuideService({
      downloadsDir: downloads,
      cacheDir: path.join(dataDir, 'pitch-guides'),
      getTrack: async () => ({ vocalsFile: path.basename(vocal), separationStatus: 'done' }),
      getLyrics: async () => ({ lines: [], offsetMs: 0 }),
      macBetaDiag: { pitchGuide() { return false; } },
    });
    t = Date.now();
    let state = await service.start('smoke-track', { algorithm: 'yin' });
    while (['queued', 'processing', 'cancelling'].includes(state.status)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await service.get('smoke-track');
    }
    report.timings.pitchSeconds = Math.round((Date.now() - t) / 100) / 10;
    if (state.status !== 'ready' || !state.guide) throw new Error(`Pitch guide failed: ${JSON.stringify(state).slice(0, 600)}`);
    const notes = state.guide.notes || [];
    const near = notes.filter((note) => MELODY.some((midi) => Math.abs(note.midi - midi) <= 1));
    report.checks.pitch = { algorithm: state.guide.algorithm, notes: notes.length, nearMelody: near.length };
    log(`pitch guide: ${JSON.stringify(report.checks.pitch)} in ${report.timings.pitchSeconds}s`);
    if (notes.length < 4) throw new Error(`Pitch guide has too few notes (${notes.length}).`);
    if (near.length / notes.length < 0.6) throw new Error(`Pitch guide notes do not follow the synthetic melody (${near.length}/${notes.length}).`);
    service.dispose();
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String(error && error.message || error).slice(0, 1000);
    throw error;
  } finally {
    report.timings.totalSeconds = Math.round((Date.now() - startedAll) / 1000);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  log('AI smoke passed');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
}

module.exports = { synthesize, MELODY, SECONDS };
