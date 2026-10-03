#!/usr/bin/env node
'use strict';
// Controlled scheduling benchmark: no YouTube, lyric provider, disk I/O or FFmpeg.
// Compare actual route/service code with a git revision using identical fake delays.
// node tools/benchmark-import-pipeline.js --baseline-ref=<pre-change commit>
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { mapConcurrent } = require('../server/utils/map-concurrent');
const root = path.resolve(__dirname, '..');
const baselineRef = process.argv.find(arg => arg.startsWith('--baseline-ref='))?.slice(15);
if (!baselineRef || baselineRef.startsWith('-')) {
  console.error('Specify --baseline-ref=<pre-change commit>. This measures controlled scheduling, not live network performance.');
  process.exit(1);
}
const delays = Object.freeze({ catalog: 80, lyrics: 100, download: 90, loudness: 60, uploadMetadata: 5, uploadLyrics: 70, uploadLoudness: 40 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = new Proxy({}, { get: () => () => {} });
function source(relative, baseline) {
  return baseline ? execFileSync('git', ['show', `${baselineRef}:${relative}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, relative), 'utf8');
}
function loadAudio(baseline) {
  const filename = path.join(root, 'server/services/audio-processor.js');
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const overrides = {
    './lyrics-engine': { DURATION_TOLERANCE: 5, LyricsEngine: {
      resolveAppleMusicMetadata: async () => { await delay(delays.catalog); return { artist: 'Artist', title: 'Song', durationSec: 120 }; },
      search: async () => { await delay(delays.lyrics); return null; },
    } },
    '../utils/logger': { createLogger: () => log },
    './ffmpeg-provider': {}, './import-temp-registry': {}, './ytdlp-updater': {},
    './library-store': { findByIdentity: () => null, rememberImport() {} },
  };
  vm.runInNewContext(source('server/services/audio-processor.js', baseline), {
    module, exports: module.exports, require: id => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id),
    __dirname: path.dirname(filename), __filename: filename, Buffer, URL, URLSearchParams, AbortController,
    process: { env: process.env, platform: process.platform }, setTimeout, clearTimeout,
  }, { filename });
  const audio = module.exports;
  audio.downloadWithMetadata = () => ({
    metadata: Promise.resolve({ id: 'benchmark123', title: 'Artist - Song', duration: 120 }),
    completed: delay(delays.download).then(() => ({ filePath: '/virtual/benchmark.m4a', outputDir: '/virtual' })),
    completeTempImport() {},
  });
  audio.resolveTrackIdentity = () => ({ artist: 'Artist', title: 'Song', confidence: 0.95 });
  audio.detectCover = () => false;
  audio.measureLoudness = async () => { await delay(delays.loudness); return -18; };
  audio.renameToReadableFilename = () => 'Artist - Song.m4a';
  audio.requireDownloadedAudio = () => {};
  return audio;
}
function loadUpload(baseline) {
  const code = source('server/routes/api.js', baseline);
  const start = code.indexOf("router.post('/upload',");
  const end = code.indexOf('\n// ─── YouTube 連結處理', start);
  const handler = code.slice(start, end).match(/async \(req, res\) => ([\s\S]*)\);\s*$/);
  if (!handler) throw new Error('Could not locate upload handler');
  let ffmpegTail = Promise.resolve();
  return vm.runInNewContext(`(async (req, res) => ${handler[1]})`, {
    Buffer, path, mapConcurrent, log,
    parseMusicFile: async () => { await delay(delays.uploadMetadata); return { common: { artist: 'Artist', title: 'Song' }, format: { duration: 120 } }; },
    AudioProcessor: {
      parseVideoTitle: title => ({ title }), isKnownArtistName: () => false,
      measureLoudnessQueued: () => {
        const job = ffmpegTail.then(async () => { await delay(delays.uploadLoudness); return -18; });
        ffmpegTail = job.catch(() => {}); return job;
      },
    },
    LyricsEngine: { search: async () => { await delay(delays.uploadLyrics); return null; } },
    sanitizeTrack: track => track, parseOffset: () => 0,
  });
}
async function timed(fn) { const start = performance.now(); await fn(); return performance.now() - start; }
function median(values) { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]; }
(async () => {
  const baselineAudio = loadAudio(true), currentAudio = loadAudio(false);
  const baselineUpload = loadUpload(true), currentUpload = loadUpload(false);
  const req = { files: Array.from({ length: 6 }, (_, i) => ({ path: `/virtual/${i}.m4a`, originalname: `${i}.m4a` })) };
  const makeResponse = () => ({ status() { return this; }, json(result) { if (!result.success) throw new Error(JSON.stringify(result)); } });
  const scenarios = [
    ['youtube-confident', () => baselineAudio._processYouTube('https://youtube.com/watch?v=benchmark123'), () => currentAudio._processYouTube('https://youtube.com/watch?v=benchmark123')],
    ['upload-six-tracks', () => baselineUpload(req, makeResponse()), () => currentUpload(req, makeResponse())],
  ];
  const results = [];
  for (const [scenario, before, after] of scenarios) {
    const oldSamples = [], newSamples = [];
    for (let i = 0; i < 5; i++) { oldSamples.push(await timed(before)); newSamples.push(await timed(after)); }
    const oldMs = median(oldSamples), newMs = median(newSamples);
    results.push({ scenario, baselineMedianMs: +oldMs.toFixed(1), currentMedianMs: +newMs.toFixed(1), reductionPercent: +((1 - newMs / oldMs) * 100).toFixed(1) });
  }
  console.log(JSON.stringify({ kind: 'controlled scheduling; not live YouTube/provider timing', baselineRef, runsPerScenario: 5, delaysMs: delays, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
