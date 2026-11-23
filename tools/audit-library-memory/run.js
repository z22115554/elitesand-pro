#!/usr/bin/env node
'use strict';

// Run the user-supplied audit's unchanged corpus and benchmark in fresh child
// processes. Only synthetic temporary data is created; no application profile
// or network service is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const projectRoot = path.resolve(__dirname, '../..');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const rounds = Number(option('rounds') || 3);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('rounds must be between 1 and 10');
const baselineRoot = option('baseline-root') ? path.resolve(option('baseline-root')) : null;
const originals = {
  'gen-library.js': '754e57153edd1171cccccaf9bdad9ef208bf09554e8b0617079bf7ebda4a86d4',
  'bench-library.js': 'cb8ba17a10a9ab665978c251c8f3b0bcdda4440717d980108facb916188db2a2',
};
for (const [file, expected] of Object.entries(originals)) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex');
  assert.equal(hash, expected, `Original audit script changed: ${file}`);
}
const sourceHashes = root => Object.fromEntries([
  'server/services/library-store.js', 'server/state/app-state.js',
  'server/routes/handlers/playlist.js', 'server/utils/track-schema.js',
].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));

function child(args) {
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Benchmark child exited ${result.status}`);
  const match = result.stdout.match(/(?:^|\n)(\{[\s\S]*\})\s*$/);
  if (!match) throw new Error('Benchmark child did not produce complete JSON');
  return JSON.parse(match[1]);
}

function measure(root, round) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-library-memory-'));
  try {
    const data = path.join(temp, 'data'), media = path.join(temp, 'downloads'), logs = path.join(temp, 'logs');
    const corpus = child([path.join(__dirname, 'gen-library.js'), data, media, '10000', '2000']);
    const metrics = child(['--expose-gc', path.join(__dirname, 'bench-library.js'), root, data, media, logs]);
    assert.equal(corpus.N, 10000); assert.equal(corpus.PLAYLIST, 2000);
    assert.equal(metrics.entries, 10000); assert.equal(metrics.playlistLen, 2000);
    const restoreHeapMiB = metrics.heapAfterStateRestoreMB;
    const readRetainedDeltaMiB = metrics.heapAfterGetEntryAllMB - metrics.heapBeforeGetEntryAllMB;
    if (![restoreHeapMiB, readRetainedDeltaMiB].every(Number.isFinite)) throw new Error('Missing memory measurements');
    return { round, corpus, restoreHeapMiB, readRetainedDeltaMiB, metrics };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

const results = [], baseline = [];
for (let round = 1; round <= rounds; round++) {
  if (baselineRoot) baseline.push(measure(baselineRoot, round));
  results.push(measure(projectRoot, round));
}
const gates = {
  restoreHeapLimitMiB: 60, readRetainedDeltaLimitMiB: 30,
  maxRestoreHeapMiB: Math.max(...results.map(r => r.restoreHeapMiB)),
  maxReadRetainedDeltaMiB: Math.max(...results.map(r => r.readRetainedDeltaMiB)),
};
gates.passed = gates.maxRestoreHeapMiB < gates.restoreHeapLimitMiB && gates.maxReadRetainedDeltaMiB < gates.readRetainedDeltaLimitMiB;
console.log(JSON.stringify({
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  originals, sourceHashes: sourceHashes(projectRoot),
  baselineSourceHashes: baselineRoot ? sourceHashes(baselineRoot) : null,
  scope: 'Original audit corpus: 10000 tracks, 2000 playlist entries, 30 word-timed lines per track. Real store/app-state/handlers; fresh child and explicit GC. Heap figures are rounded MiB as in the original audit. Not Windows/OBS/GPU acceptance.',
  gates, results, baseline,
}, null, 2));
if (!gates.passed) process.exitCode = 1;
