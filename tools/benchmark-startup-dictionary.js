'use strict';
// node tools/benchmark-startup-dictionary.js /path/to/baseline-checkout
// Five interleaved fresh processes. Uses real kuromoji, no network/G2P sidecar.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

async function child(root) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-startup-bench-'));
  process.env.ELITESAND_DATA_DIR = path.join(directory, 'data');
  process.env.ELITESAND_LOGS_DIR = path.join(directory, 'logs');
  const requireAt = createRequire(path.join(root, 'package.json'));
  const kuromoji = requireAt('kuromoji');
  const originalBuilder = kuromoji.builder;
  const pending = [];
  let builds = 0;
  kuromoji.builder = function (...args) {
    const builder = originalBuilder.apply(this, args);
    const originalBuild = builder.build;
    builder.build = function (callback) {
      builds++;
      let done; pending.push(new Promise((resolve) => { done = resolve; }));
      return originalBuild.call(this, (error, tokenizer) => { callback(error, tokenizer); done(); });
    };
    return builder;
  };
  global.gc?.();
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  const romanizer = requireAt('./server/services/romanizer');
  await Promise.all(pending);
  const startupMs = performance.now() - start;
  const startupCpu = process.cpuUsage(cpuStart);
  const startupBuilds = builds;
  global.gc?.();
  const rssMiB = process.memoryUsage().rss / (1024 * 1024);
  const firstReadStart = performance.now();
  const readings = await Promise.all(['猫が好きです', '君の声を聞かせて', '夢を見ている', 'ねこ'].map((text) => romanizer.japaneseReadingAnalysis(text)));
  const firstReadingMs = performance.now() - firstReadStart;
  console.log('RESULT ' + JSON.stringify({ startupMs, startupCpuMs: (startupCpu.user + startupCpu.system) / 1000, startupBuilds, rssMiB, firstReadingMs, totalBuilds: builds, readings }));
  await requireAt('./server/utils/logger').shutdown();
  fs.rmSync(directory, { recursive: true, force: true });
}

if (process.argv[2] === '--child') {
  child(path.resolve(process.argv[3])).catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  if (!process.argv[2]) throw new Error('Provide a baseline checkout path.');
  const roots = [path.resolve(process.argv[2]), path.resolve(__dirname, '..')];
  const samples = [[], []];
  for (let i = 0; i < 5; i++) for (const index of i % 2 ? [1, 0] : [0, 1]) {
    const result = spawnSync(process.execPath, ['--expose-gc', __filename, '--child', roots[index]], { encoding: 'utf8', timeout: 30000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith('RESULT '));
    if (!line) throw new Error(`Missing benchmark result: ${result.stdout} ${result.stderr}`);
    samples[index].push(JSON.parse(line.slice(7)));
  }
  for (const sample of samples.flat()) assert.deepEqual(sample.readings, samples[0][0].readings);
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({ node: process.version, platform: process.platform, samplesPerVersion: 5, readingsEqual: true, results: samples.map((group, index) => ({
    version: index ? 'patched' : 'baseline',
    ...Object.fromEntries(['startupMs', 'startupCpuMs', 'startupBuilds', 'rssMiB', 'firstReadingMs', 'totalBuilds'].map((key) => [key, Math.round(median(group.map((sample) => sample[key])) * 100) / 100])),
  })) }, null, 2));
}
