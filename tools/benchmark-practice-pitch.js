'use strict';
// JSON on stdout; optional first argument loads a baseline copy of the actual worklet.
const os = require('node:os');
const { detector, signal, summarize, percentile, shipped } = require('../tests/helpers/practice-worklet-harness');
const file = process.argv[2] || shipped;
const scenarios = {
  sine: {}, harmonics: { harmonics: [1, .6, .35, .2] }, weakFundamental: { harmonics: [.25, 1, .4, .2] },
  envelope: { envelope: (t) => .08 + .92 * Math.sin(Math.PI * t) ** 2 },
  noise: { noise: .18 }, bleed: { harmonics: [1, .7, .2], bleed: true },
  falsettoLike: { harmonics: [1, .12, .04], noise: .015 },
  vibrato: {}, glide: {}, short: {},
};
const rows = [], detectTimes = [], blockTimes = [];
const cpu = process.cpuUsage(), started = performance.now(), memory = process.memoryUsage();
for (const rate of [44100, 48000, 96000]) {
  for (const f of [65.406, 82.4069, 130.81, 261.63, 440, 523.25, 880, 987.77, 1046.5, 1100, 1174.66, 1318.51]) {
    for (const [scenario, options] of Object.entries(scenarios)) {
      const frequency = scenario === 'vibrato' ? (t) => f * 2 ** (.3 * Math.sin(2 * Math.PI * 6 * t) / 12)
        : scenario === 'glide' ? (t) => f * 2 ** ((t - .5) * 1.5 / 12) : f;
      const seconds = scenario === 'short' ? .25 : 1;
      const runner = detector(rate, file);
      runner.push(signal(rate, seconds, frequency, options));
      const steady = summarize(runner.frames, frequency, scenario === 'short' ? .08 : .18, seconds - .04);
      const first = runner.frames.find((x) => x.f0 && Math.abs(1200 * Math.log2(x.f0 / (typeof frequency === 'function' ? frequency(x.time) : frequency))) < 50);
      rows.push({ rate, f, scenario, ...steady, firstCorrectMs: first ? first.emittedAt * 1000 : null,
        detectMeanMs: runner.detects.reduce((a, b) => a + b, 0) / runner.detects.length });
      detectTimes.push(...runner.detects); blockTimes.push(...runner.blocks);
    }
  }
}
const cpuUsed = process.cpuUsage(cpu);
console.log(JSON.stringify({ environment: { node: process.version, cpu: os.cpus()[0].model, platform: process.platform },
  syntheticOnly: true, file, rows,
  performance: { wallMs: performance.now() - started, cpuMs: (cpuUsed.user + cpuUsed.system) / 1000,
    heapDeltaBytes: process.memoryUsage().heapUsed - memory.heapUsed,
    detectMeanMs: detectTimes.reduce((a, b) => a + b, 0) / detectTimes.length,
    detectP95Ms: percentile(detectTimes, .95), detectP99Ms: percentile(detectTimes, .99),
    blockP99Ms: percentile(blockTimes, .99) } }, null, 2));
