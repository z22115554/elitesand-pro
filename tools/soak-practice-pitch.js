'use strict';
// CPU benchmark of the real processor in Node. This is not a browser deadline guarantee.
// Usage: node --expose-gc tools/soak-practice-pitch.js [baseline-worklet.js] [seconds=600]
const { spawn } = require('node:child_process');
const os = require('node:os');
const { detector, signal, shipped } = require('../tests/helpers/practice-worklet-harness');
const baseline = process.argv[2], seconds = Number(process.argv[3] || 600);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 1200) throw new Error('seconds must be 10–1200');
function histogram() {
  const bins = new Uint32Array(20001); let count = 0, sum = 0, max = 0;
  return { add(value) { bins[Math.min(bins.length - 1, Math.floor(value * 1000))]++; count++; sum += value; max = Math.max(max, value); },
    result() {
      const quantile = (q) => { let total = 0; for (let i = 0; i < bins.length; i++) { total += bins[i]; if (total >= count * q) return (i + 1) / 1000; } return 0; };
      return { count, meanMs: sum / count, p95Ms: quantile(.95), p99Ms: quantile(.99), maxMs: max };
    } };
}
function run(file, rate, length) {
  const runner = detector(rate, file, false);
  const audio = signal(rate, 1, (t) => 1046.5 * 2 ** (.2 * Math.sin(2 * Math.PI * 6 * t) / 12), { harmonics: [1, .35, .15] });
  for (let i = 0; i < 3; i++) runner.push(audio);
  runner.blocks.length = 0; runner.detects.length = 0;
  if (global.gc) global.gc();
  const memory = process.memoryUsage(), cpu = process.cpuUsage(), start = performance.now(), before = runner.count();
  const detects = histogram(), blocks = histogram(); let overBudget = 0;
  for (let i = 0; i < length; i++) {
    runner.push(audio);
    for (const time of runner.detects) detects.add(time);
    for (const time of runner.blocks) { blocks.add(time); if (time > 128000 / rate) overBudget++; }
    runner.blocks.length = 0; runner.detects.length = 0;
  }
  const wallMs = performance.now() - start, cpuUsed = process.cpuUsage(cpu);
  if (global.gc) global.gc();
  const after = process.memoryUsage(), count = runner.count() - before;
  const expected = Math.floor(length * rate / runner.instance.factor / runner.instance.hop);
  if (Math.abs(count - expected) > 1 || runner.instance.n > runner.instance.buf.length) throw new Error('Dropped frames or unbounded buffer');
  return { file, rate, audioSeconds: length, frames: count, expectedFrames: expected,
    wallMs, cpuMs: (cpuUsed.user + cpuUsed.system) / 1000,
    cpuPercentOfOneCoreAtRealtime: (cpuUsed.user + cpuUsed.system) / 10000 / length,
    detect: detects.result(), block: blocks.result(), blockBudgetMs: 128000 / rate, blocksOverBudget: overBudget,
    heapDeltaBytes: after.heapUsed - memory.heapUsed, externalDeltaBytes: after.external - memory.external,
    rssDeltaBytes: after.rss - memory.rss, bufferCapacity: runner.instance.buf.length, retainedFrames: runner.frames.length };
}
async function main() {
  const comparisons = [];
  if (baseline) for (let round = 0; round < 3; round++) {
    // Alternate order to avoid consistently favouring either implementation during JIT/thermal changes.
    const order = round % 2 ? [shipped, baseline] : [baseline, shipped];
    for (const file of order) comparisons.push({ round, ...run(file, 48000, 60) });
  }
  const soak = [run(shipped, 48000, seconds), run(shipped, 96000, seconds)];
  const python = process.env.ELITESAND_TEST_PYTHON || process.env.ELITESAND_AI_PYTHON
    || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(python, ['-c', `
import numpy as np
from ai.pitch_guide_worker import make_guide, SAMPLE_RATE
t = np.arange(120 * SAMPLE_RATE) / SAMPLE_RATE
audio = (.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
guide = make_guide(audio, 'yin', progress=False)
assert guide['notes'] and guide['notes'][0]['midi'] == 69
print(guide['analysisSeconds'])
`], { cwd: require('node:path').resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stdout.on('data', (s) => { output += s; }); child.stderr.on('data', (s) => { error += s; });
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error || `worker exit ${code}`)));
  });
  // Yield once so the analysis child starts, then exercise the real mic processor concurrently.
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = run(shipped, 48000, seconds);
  await finished;
  console.log(JSON.stringify({ environment: { node: process.version, cpu: os.cpus()[0].model, platform: process.platform },
    gcEnabled: Boolean(global.gc), comparisons, soak, concurrent,
    concurrentGuide: { audioSeconds: 120, analysisSeconds: Number(output.trim()), status: 'passed' } }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
