'use strict';
// Runs the shipped AudioWorklet unchanged, including decimation, buffering and timestamps.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const shipped = path.join(__dirname, '../../public/js/practice/pitch-detector-worklet.js');
const midi = (hz) => hz > 0 ? 69 + 12 * Math.log2(hz / 440) : 0;
const hz = (note) => 440 * 2 ** ((note - 69) / 12);

function detector(rate, filename = shipped, collect = true) {
  const frames = [], blocks = [], detects = [];
  let Processor, emittedAt = 0, count = 0;
  const context = vm.createContext({ sampleRate: rate, currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (data) => {
      count++; if (collect) frames.push({ ...data, emittedAt });
    } }; } }, registerProcessor: (_, cls) => { Processor = cls; } });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const instance = new Processor();
  const detect = instance.detect;
  instance.detect = function (...args) {
    const start = performance.now(); const result = detect.apply(this, args);
    detects.push(performance.now() - start); return result;
  };
  let consumed = 0;
  function push(audio) {
    for (let offset = 0; offset < audio.length; offset += 128) {
      const chunk = audio.subarray(offset, Math.min(offset + 128, audio.length));
      context.currentTime = consumed / rate;
      emittedAt = (consumed + chunk.length) / rate;
      const start = performance.now(); instance.process([[chunk]]); blocks.push(performance.now() - start);
      consumed += chunk.length;
    }
  }
  return { instance, frames, blocks, detects, push, context, count: () => count };
}

function signal(rate, seconds, frequency, options = {}) {
  const out = new Float32Array(Math.round(rate * seconds));
  let phase = 0, seed = 123456789;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate, f = typeof frequency === 'function' ? frequency(t) : frequency;
    phase += 2 * Math.PI * f / rate;
    const harmonics = options.harmonics || [1];
    let value = 0;
    for (let k = 0; k < harmonics.length; k++) value += harmonics[k] * Math.sin((k + 1) * phase);
    const envelope = options.envelope ? options.envelope(t) : 1;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 2147483648 - 1) * (options.noise || 0);
    const bleed = options.bleed ? .035 * (Math.sin(2 * Math.PI * 196 * t) + .5 * Math.sin(2 * Math.PI * 293.66 * t)) : 0;
    out[i] = (f ? .18 * value * envelope : 0) + noise + bleed;
  }
  return out;
}

function summarize(frames, expected, start, end) {
  const selected = frames.filter((f) => f.time >= start && f.time < end);
  const errors = selected.map((f) => f.f0 > 0 ? 1200 * Math.log2(f.f0 / (typeof expected === 'function' ? expected(f.time) : expected)) : null);
  const voiced = errors.filter((e) => e !== null);
  const fraction = (fn) => errors.filter(fn).length / Math.max(1, errors.length);
  return { frames: selected.length, hz: percentile(selected.filter((f) => f.f0).map((f) => f.f0), .5),
    midi: midi(percentile(selected.filter((f) => f.f0).map((f) => f.f0), .5)),
    cents: voiced.length ? percentile(voiced, .5) : null, correct: fraction((e) => e !== null && Math.abs(e) <= 50),
    voiced: voiced.length / Math.max(1, errors.length),
    highOctave: fraction((e) => e !== null && Math.abs(e - 1200) <= 100),
    lowOctave: fraction((e) => e !== null && Math.abs(e + 1200) <= 100),
    unvoiced: fraction((e) => e === null) };
}
function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}
module.exports = { detector, signal, summarize, percentile, midi, hz, shipped };
