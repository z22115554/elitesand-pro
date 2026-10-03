#!/usr/bin/env node
'use strict';
// Local CPU only: real services, pinyin-pro and kuromoji; isolated persistence.
// G2P sidecar is stubbed in BOTH versions. Time excludes disk/network/GPU/tokenizer startup.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { root, libraryFixture, romanizerFixture, plain } = require('../tests/helpers/cpu-perf-fixtures');
const ref = process.argv.find(arg => arg.startsWith('--baseline-ref='))?.slice(15);
if (!ref || ref.startsWith('-')) {
  console.error('Specify --baseline-ref=<pre-change commit>; this measures local CPU, not overall application speed.');
  process.exit(1);
}
const baseline = relative => execFileSync('git', ['show', `${ref}:${relative}`], { cwd: root, encoding: 'utf8' });
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const compare = (scenario, before, after, extra = {}) => ({ scenario, baselineMs: +before.toFixed(3), currentMs: +after.toFixed(3), reductionPercent: +((1 - after / before) * 100).toFixed(1), ...extra });
function timed(fn, count = 1) { const start = performance.now(); for (let i = 0; i < count; i++) fn(); return (performance.now() - start) / count; }
async function timedAsync(fn) { const start = performance.now(); await fn(); return performance.now() - start; }
function lyricCorpus(lang, repeated) {
  const phrases = lang === 'ja'
    ? ['明日も君に会いたい', '今日の空は青い', '風の音を聞いている', '遠い街を歩いている']
    : ['今天一起出發', '明天依然晴朗', '我們走向遠方', '沿路都有風景'];
  return Array.from({ length: 240 }, (_, i) => {
    const text = phrases[i % phrases.length] + (repeated ? '' : String(i));
    return { time: i * 1000, text, singer: i % 2 ? 'F' : 'M', words: Array.from(text, (text, j) => ({ text, time: i * 1000 + j * 50, duration: 50 })) };
  });
}
(async () => {
  const results = [];
  for (const size of [100, 2000, 10000]) {
    const entries = Object.fromEntries(Array.from({ length: size }, (_, i) => [`id${i}`, { id: `id${i}`, artist: `歌手 Ａ ${i}`, title: `歌名－${i}`, playCount: 0, lastPlayed: 0 }]));
    const oldSource = baseline('server/services/library-store.js');
    const old = libraryFixture(entries, oldSource, { instrument: false });
    const current = libraryFixture(entries, undefined, { instrument: false });
    const query = store => { assert.equal(store.findByIdentity('沒有這位歌手', '沒有這首歌'), null); assert.equal(store.findByIdentity(`歌手 A ${size - 1}`, `歌名${size - 1}`).id, `id${size - 1}`); };
    const coldBefore = timed(() => query(old.store)), coldAfter = timed(() => query(current.store));
    for (let i = 0; i < 10; i++) { query(old.store); query(current.store); }
    const a = [], b = [];
    for (let round = 0; round < 8; round++) {
      if (round % 2) { b.push(timed(() => query(current.store), 40)); a.push(timed(() => query(old.store), 40)); }
      else { a.push(timed(() => query(old.store), 40)); b.push(timed(() => query(current.store), 40)); }
    }
    // Count work on separate instances: instrumentation must not inflate timed CPU.
    const oldCounts = libraryFixture(entries, oldSource), currentCounts = libraryFixture(entries);
    query(oldCounts.store); query(currentCounts.store);
    oldCounts.normalizations.count = 0; currentCounts.normalizations.count = 0;
    query(oldCounts.store); query(currentCounts.store);
    results.push(compare(`library-${size}-tracks-two-lookups`, median(a), median(b), { coldBaselineMs: +coldBefore.toFixed(3), coldCurrentMs: +coldAfter.toFixed(3), normalizationsBefore: oldCounts.normalizations.count, normalizationsAfter: currentCounts.normalizations.count }));
  }
  const oldRomanizer = romanizerFixture({ source: baseline('server/services/romanizer.js') });
  const currentRomanizer = romanizerFixture();
  await Promise.all([oldRomanizer.getKuromojiTokenizer(), currentRomanizer.getKuromojiTokenizer()]);
  for (const lang of ['zh', 'ja']) {
    for (const repeated of [true, false]) {
      const input = lyricCorpus(lang, repeated);
      const before = plain(await oldRomanizer.addRomanization(input));
      const after = plain(await currentRomanizer.addRomanization(input));
      assert.deepEqual(after, before, `entire ${lang} result differs`);
      assert.deepEqual(plain(currentRomanizer.addRomanizationSync(input)), plain(oldRomanizer.addRomanizationSync(input)));
      const a = [], b = [];
      for (let i = 0; i < 8; i++) {
        if (i % 2) { b.push(await timedAsync(() => currentRomanizer.addRomanization(input))); a.push(await timedAsync(() => oldRomanizer.addRomanization(input))); }
        else { a.push(await timedAsync(() => oldRomanizer.addRomanization(input))); b.push(await timedAsync(() => currentRomanizer.addRomanization(input))); }
      }
      results.push(compare(`${lang}-${repeated ? 'repeated' : 'distinct-lines'}-240-krc-lines`, median(a), median(b), { outputEquivalent: true }));
    }
  }
  // Negative controls: no repeated whole lines, and no language conversion at all.
  for (const lang of ['zh', 'latin']) {
    const input = lang === 'zh'
      ? lyricCorpus('zh', false).map(({ words, ...line }) => line)
      : Array.from({ length: 240 }, (_, i) => ({ time: i * 1000, text: `Unique English line ${i}`, words: [{ text: `word${i}`, duration: 20 }] }));
    assert.deepEqual(plain(await currentRomanizer.addRomanization(input)), plain(await oldRomanizer.addRomanization(input)));
    const a = [], b = [];
    for (let i = 0; i < 8; i++) {
      a.push(await timedAsync(() => oldRomanizer.addRomanization(input)));
      b.push(await timedAsync(() => currentRomanizer.addRomanization(input)));
    }
    results.push(compare(`${lang}-distinct-lines-control`, median(a), median(b), { outputEquivalent: true }));
  }
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform }, baselineRef: ref, batchRounds: 8, scope: 'local CPU; sidecar/disk/network/GPU and tokenizer startup excluded', results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
