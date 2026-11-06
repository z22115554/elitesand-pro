#!/usr/bin/env node
'use strict';
// Run the shipped microphone Worklet and panel engine on annotated real singing.
// Usage: node --expose-gc tools/benchmark-practice-vocadito.js DATASET GUIDE_CACHE OUTPUT
// Generate GUIDE_CACHE first with the companion Python benchmark. No network I/O.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { detector, percentile } = require('../tests/helpers/practice-worklet-harness');
const { loadEngine, fakeRoot } = require('../tests/helpers/practice-engine-harness');
const Scoring = require('../public/js/practice/practice-scoring');
const Engines = { before: loadEngine(process.env.PRACTICE_BENCHMARK_ENGINE_BASELINE), after: loadEngine() };

function labelsAt(labels, time) {
  let lo = 0, hi = labels.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (labels[mid][0] < time) lo = mid + 1; else hi = mid; }
  const right = Math.min(lo, labels.length - 1), left = Math.max(0, right - 1);
  return labels[Math.abs(labels[left][0] - time) <= Math.abs(labels[right][0] - time) ? left : right][1];
}

function measure(frames, labels, frequencies) {
  const result = { frames: 0, referenceVoiced: 0, supportedVoiced: 0, referenceUnvoiced: 0,
    unsupportedVoiced: 0, missedVoiced: 0, falseVoiced: 0, within50c: 0, within75c: 0, over220c: 0, highOctave: 0, lowOctave: 0 };
  frames.forEach((frame, i) => {
    const target = labelsAt(labels, frame.time), hz = frequencies[i]; result.frames++;
    if (!target) { result.referenceUnvoiced++; if (hz > 0) result.falseVoiced++; return; }
    result.referenceVoiced++;
    if (target < 65 || target > 1400) { result.unsupportedVoiced++; return; }
    result.supportedVoiced++;
    if (!hz) { result.missedVoiced++; return; }
    const error = 1200 * Math.log2(hz / target);
    if (Math.abs(error) <= 50) result.within50c++;
    if (Math.abs(error) <= 75) result.within75c++;
    if (Math.abs(error) >= 220) result.over220c++;
    if (Math.abs(error - 1200) <= 100) result.highOctave++;
    if (Math.abs(error + 1200) <= 100) result.lowOctave++;
  });
  return result;
}

async function main() {
  const [dataset, cache, output] = process.argv.slice(2);
  if (!dataset || !cache || !output) throw new Error('Expected DATASET GUIDE_CACHE OUTPUT');
  const manifest = process.env.PRACTICE_BENCHMARK_MANIFEST
    ? JSON.parse(fs.readFileSync(process.env.PRACTICE_BENCHMARK_MANIFEST)) : null;
  const ids = (process.env.PRACTICE_BENCHMARK_IDS || (manifest ? manifest.tracks.map((t) => t.id)
    : Array.from({ length: 40 }, (_, i) => i + 1)).join(',')).split(',').map(Number);
  const rates = (process.env.PRACTICE_BENCHMARK_RATES || '44100,48000,96000').split(',').map(Number);
  const methods = (process.env.PRACTICE_BENCHMARK_METHODS || 'yin,torchcrepe').split(',');
  const bleedFile = process.env.PRACTICE_BENCHMARK_BLEED_FILE;
  const bleedDb = Number(process.env.PRACTICE_BENCHMARK_BLEED_DB || -20);
  const bleed = bleedFile ? { file: path.basename(bleedFile), relativeRmsDb: bleedDb, offsetSeconds: 20,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(bleedFile)).digest('hex') } : null;
  if (bleed && !Number.isFinite(bleedDb)) throw new Error('BLEED_DB must be finite');
  const rows = [];
  for (const id of ids) {
    const track = manifest?.tracks.find((t) => t.id === id);
    const labels = fs.readFileSync(path.join(dataset, track ? track.f0 : `Annotations/F0/vocadito_${id}_f0.csv`), 'utf8')
      .trim().split(/\r?\n/).slice(track?.annotationFormat === 'vocalset-raw' ? 1 : 0)
      .map((s) => s.split(',').slice(0, 2).map(Number));
    for (const rate of rates) {
      global.gc?.(); const memory = process.memoryUsage(), cpu = process.cpuUsage();
      const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(dataset, track ? track.audio : `Audio/vocadito_${id}.wav`),
        '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
      if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
      const copy = new Uint8Array(decoded.stdout).buffer, audio = new Float32Array(copy);
      if (bleed) {
        const music = spawnSync('ffmpeg', ['-v', 'error', '-ss', '20', '-i', bleedFile, '-t', String(audio.length / rate),
          '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
        if (music.status !== 0) throw new Error(music.stderr.toString());
        const backing = new Float32Array(new Uint8Array(music.stdout).buffer);
        if (backing.length < audio.length) throw new Error('Backing segment is shorter than the lead');
        let leadEnergy = 0, musicEnergy = 0;
        for (let i = 0; i < audio.length; i++) { leadEnergy += audio[i] ** 2; musicEnergy += backing[i] ** 2; }
        if (!musicEnergy) throw new Error('Backing is silent');
        const gain = Math.sqrt(leadEnergy / musicEnergy) * 10 ** (bleedDb / 20);
        for (let i = 0; i < audio.length; i++) audio[i] += backing[i] * gain;
      }
      const mic = detector(rate); mic.push(audio);
      const usage = process.cpuUsage(cpu), after = process.memoryUsage();
      const frames = mic.frames.filter((f) => f.time >= 0 && f.time <= labels[labels.length - 1][0]);
      const row = { id, rate, rawWorklet: measure(frames, labels, frames.map((f) => f.f0)), cases: [],
        performance: { audioSeconds: audio.length / rate, cpuMs: (usage.user + usage.system) / 1000,
          detectMeanMs: mic.detects.reduce((a, b) => a + b, 0) / mic.detects.length,
          detectP95Ms: percentile(mic.detects, .95), detectP99Ms: percentile(mic.detects, .99),
          blockP99Ms: percentile(mic.blocks, .99), blockBudgetMs: 128 / rate * 1000,
          heapDeltaBytes: after.heapUsed - memory.heapUsed, rssDeltaBytes: after.rss - memory.rss } };
      for (const method of methods) for (const version of (id % 2 ? ['before', 'after'] : ['after', 'before'])) for (const allowOctave of [false, true]) {
        const guide = JSON.parse(fs.readFileSync(path.join(cache, `${id}-${method}-${version}.json`)));
        global.gc?.();
        const engineCpu = process.cpuUsage();
        let time = 0; const packets = [], frequencies = [];
        const engine = Engines[version].createPracticeEngine({ role: 'panel', root: fakeRoot(),
          getOptions: () => ({ allowOctave }), clock: () => ({ t: time, playing: true, tempo: 1 }), onSync: (m) => packets.push(m) });
        const prepared = Scoring.prepareGuide(guide);
        const requiredSeconds = prepared.notes.filter((n) => !n.excluded)
          .reduce((sum, n) => sum + Math.max(0, n.end - n.start - n.grace), 0);
        engine.setGuide(prepared); engine.setPlaying(true, 0);
        for (const frame of frames) {
          time = frame.time;
          engine.pitch(frame, { valid: true, t: time, audioTime: time, playing: true, tempo: 1, key: 0, generation: 0 });
          engine.syncFrame();
          const midi = engine._state.pitchSample?.midi || 0;
          // Undo global tuning compensation to evaluate the original observation.
          frequencies.push(midi ? 440 * 2 ** ((midi + guide.tuning - 69) / 12) : 0);
        }
        engine.finish('mic'); engine.syncFrame();
        const stats = engine.getStats(), observed = packets.filter((m) => m.score?.result).at(-1)?.score.result;
        if (observed?.score !== stats.result.score) throw new Error(`OBS score mismatch: ${id}/${method}/${version}`);
        if (requiredSeconds > 2 && !Number.isFinite(stats.result.score)) throw new Error(`No real score: ${id}/${method}/${version}`);
        if (requiredSeconds <= 2 && stats.result.score !== null) throw new Error(`Too little reference for a score: ${id}/${method}/${version}`);
        const usedCpu = process.cpuUsage(engineCpu);
        row.cases.push({ method, version, allowOctave, score: stats.result.score, requiredSeconds,
          scoreStatus: stats.result.score === null ? 'insufficient-reference' : 'scored',
          unscorable: stats.unscorable, obsScoreMatches: true, processedPitch: measure(frames, labels, frequencies), engineCpuMs: (usedCpu.user + usedCpu.system) / 1000 });
        engine.destroy();
      }
      rows.push(row);
      fs.writeFileSync(output, JSON.stringify({ scope: manifest?.scope || 'Real audio replay; human F0 truth. Node fake DOM, no device/visual verification.',
        engineSha256: Object.fromEntries(['before', 'after'].map((version) => [version, crypto.createHash('sha256')
          .update(fs.readFileSync(version === 'before' && process.env.PRACTICE_BENCHMARK_ENGINE_BASELINE
            || path.join(__dirname, '../public/js/practice/practice-engine.js'))).digest('hex')])),
        simulatedMusicBleed: bleed, rows }, null, 2) + '\n');
      console.error(`Vocadito ${id} ${rate} Hz complete`);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
