'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-progressive-search-'));
for (const [key, dir] of Object.entries({ ELITESAND_DATA_DIR: 'data', ELITESAND_DOWNLOADS_DIR: 'downloads', ELITESAND_LOGS_DIR: 'logs' })) process.env[key] = path.join(runtime, dir);
// Real JSON-lines subprocess tests use Node as an isolated fixture producer.
process.env.ELITESAND_YTDLP_PATH = process.execPath;
const Audio = require('../server/services/audio-processor');
const general = { id: 'g0000000001', title: 'General song', duration: 210 };
const music = { id: 'm0000000001', title: 'Music song', duration: 200 };
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const stall = signal => new Promise((resolve, reject) => {
  if (signal.aborted) reject(new Error('aborted'));
  else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
});
test.beforeEach(() => Audio._clearYouTubeSearchCacheForTest());

test('first rows arrive immediately and Music completing after 500ms is retained', async (t) => {
  const release = defer(), first = defer(), updates = [];
  let musicSignal;
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_query, _count, _signal, onEntry) => { onEntry(general); return [general]; });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async (_query, _count, signal) => { musicSignal = signal; await release.promise; return [music.id]; });
  t.mock.method(Audio, '_enrichYouTubeIdsStream', async (_ids, _signal, onEntry) => { onEntry(music); return [music]; });
  const pending = Audio.searchYouTube('test song', { onUpdate: update => { updates.push(update); first.resolve(); } });
  await first.promise;
  assert.deepEqual(updates[0].results.map(row => row.videoId), [general.id]);
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(musicSignal.aborted, false);
  release.resolve();
  assert.deepEqual((await pending).results.map(row => row.videoId), [general.id, music.id]);
});

test('Music can publish before a stalled general source', async (t) => {
  const release = defer(), first = defer();
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, _n, _s, onEntry) => { await release.promise; onEntry(general); return [general]; });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => [music.id]);
  t.mock.method(Audio, '_enrichYouTubeIdsStream', async (_ids, _s, onEntry) => { onEntry(music); return [music]; });
  const pending = Audio.searchYouTube('test song', { onUpdate: update => first.resolve(update) });
  assert.equal((await first.promise).results[0].videoId, music.id);
  release.resolve();
  assert.deepEqual((await pending).results.map(row => row.videoId), [music.id, general.id]);
});

test('the total deadline retains partial general rows and stops outstanding sources', async (t) => {
  let signal, calls = 0;
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, _n, current, onEntry) => {
    signal = current; calls++; onEntry(general);
    if (calls === 1) return stall(current);
    return [general];
  });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => []);
  const result = await Audio.searchYouTube('test song', { timeoutMs: 50, onUpdate() {} });
  assert.equal(result.results[0].videoId, general.id);
  assert.equal(result.timedOut, true); assert.equal(result.partial, true);
  assert.equal(result.nextOffset, 1); assert.equal(result.hasMore, true);
  assert.equal(signal.aborted, true);
  await Audio.searchYouTube('test song', { onUpdate() {} });
  assert.equal(calls, 2, 'partial pages must not freeze behind the success cache');
});

test('individual Music metadata is usable even if its remaining records time out', async (t) => {
  t.mock.method(Audio, '_runYoutubeSearchStream', async () => []);
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => [music.id, general.id]);
  t.mock.method(Audio, '_enrichYouTubeIdsStream', async (_ids, signal, onEntry) => { onEntry(music); return stall(signal); });
  const result = await Audio.searchYouTube('test song', { timeoutMs: 50, onUpdate() {} });
  assert.equal(result.results[0].videoId, music.id); assert.equal(result.timedOut, true);
});

test('empty searches stop at the total deadline with a retryable timeout', async (t) => {
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, _n, signal) => stall(signal));
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async (_q, _n, signal) => stall(signal));
  await assert.rejects(Audio.searchYouTube('test song', { timeoutMs: 35, onUpdate() {} }), { code: 'YOUTUBE_SEARCH_TIMEOUT' });
});

test('cancel aborts all sources and late callbacks cannot publish stale rows', async (t) => {
  const first = defer(); let late, sourceSignal, frames = 0;
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, _n, signal, onEntry) => { late = onEntry; sourceSignal = signal; onEntry(general); return stall(signal); });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async (_q, _n, signal) => stall(signal));
  const pending = Audio.searchYouTube('test song', { requestId: 'progress-cancel', onUpdate() { frames++; first.resolve(); } });
  await first.promise; assert.equal(Audio.cancelImport('progress-cancel').ok, true);
  await assert.rejects(pending, { code: 'IMPORT_CANCELLED' });
  assert.equal(sourceSignal.aborted, true); const count = frames;
  late(music); assert.equal(frames, count);
});

test('an external abort also cancels requests with a registered request ID', async (t) => {
  const first = defer(), controller = new AbortController();
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, _n, signal) => { first.resolve(); return stall(signal); });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => []);
  const pending = Audio.searchYouTube('test song', { requestId: 'external-cancel', signal: controller.signal, onUpdate() {} });
  await first.promise; controller.abort(); await assert.rejects(pending, { code: 'IMPORT_CANCELLED' });
});

test('late metadata updates one existing row without moving it or duplicating it', async (t) => {
  const emitted = defer();
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, _n, _s, onEntry) => { onEntry(general); emitted.resolve(); return [general]; });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => { await emitted.promise; return [general.id]; });
  t.mock.method(Audio, '_enrichYouTubeIdsStream', async (_ids, _s, onEntry) => { const enriched = { ...general, title: 'Official metadata' }; onEntry(enriched); return [enriched]; });
  const updates = [];
  const result = await Audio.searchYouTube('test song', { onUpdate: update => updates.push(update) });
  assert.equal(result.results.length, 1); assert.equal(result.results[0].title, 'Official metadata');
  assert.equal(updates[0].results[0].title, 'General song', 'published snapshots must remain independent');
});

test('paging uses the general cursor even with additional Music songs', async (t) => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ id: `g${String(i).padStart(10, '0')}`, title: `Song ${i}` }));
  let musicCalls = 0;
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, count, _s, onEntry) => { const selected = entries.slice(0, count); selected.forEach(onEntry); return selected; });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => { musicCalls++; return [music.id]; });
  t.mock.method(Audio, '_enrichYouTubeIdsStream', async () => [music]);
  const first = await Audio.searchYouTube('test song', { onUpdate() {} });
  assert.equal(first.results.length, 11); assert.equal(first.nextOffset, 10);
  const more = await Audio.searchYouTube('test song', { offset: first.nextOffset, includeMusic: false, onUpdate() {} });
  assert.deepEqual(more.results.map(row => row.videoId), entries.slice(10).map(row => row.id));
  assert.equal(more.nextOffset, 20); assert.equal(musicCalls, 1);
});

test('a full progressive cache is isolated from mutable callers and legacy JSON results', async (t) => {
  let calls = 0;
  t.mock.method(Audio, '_runYoutubeSearch', async () => [general]);
  t.mock.method(Audio, '_runYoutubeSearchStream', async () => { calls++; return [general]; });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => []);
  await Audio.searchYouTube('test song');
  const first = await Audio.searchYouTube('test song', { onUpdate() {} });
  first.results[0].title = 'caller mutation';
  const second = await Audio.searchYouTube('test song', { onUpdate() {} });
  assert.equal(second.results[0].title, general.title); assert.equal(calls, 1);
});

test('the last page stops at the 50-general-result limit', async (t) => {
  const entries = Array.from({ length: 50 }, (_, i) => ({ id: `g${String(i).padStart(10, '0')}`, title: `Song ${i}` }));
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, count, _s, onEntry) => { assert.equal(count, 50); entries.forEach(onEntry); return entries; });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => assert.fail('later pages must not restart Music'));
  const result = await Audio.searchYouTube('test song', { offset: 40, onUpdate() {} });
  assert.equal(result.results.length, 10); assert.equal(result.nextOffset, 50); assert.equal(result.hasMore, false);
});

test('waiting for a busy shared queue is covered by the same total deadline', async (t) => {
  const started = defer(); let calls = 0;
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, _n, signal) => { if (++calls === 2) started.resolve(); return stall(signal); });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => []);
  const a = Audio.searchYouTube('queue one', { requestId: 'queue-a', onUpdate() {} });
  const b = Audio.searchYouTube('queue two', { requestId: 'queue-b', onUpdate() {} });
  await started.promise;
  await assert.rejects(Audio.searchYouTube('queue three', { timeoutMs: 35, onUpdate() {} }), { code: 'YOUTUBE_SEARCH_TIMEOUT' });
  assert.equal(calls, 2);
  Audio.cancelImport('queue-a'); Audio.cancelImport('queue-b');
  await Promise.allSettled([a, b]);
});

test('JSON-line subprocess output preserves split UTF-8 and arrives before process exit', async () => {
  const first = defer(); let finished = false;
  const script = `const a=Buffer.from(JSON.stringify({id:'unicode0001',title:'歌曲🌊'})+'\\n');const cut=a.indexOf(Buffer.from('歌'))+1;process.stdout.write(a.subarray(0,cut));setTimeout(()=>process.stdout.write(a.subarray(cut)),40);setTimeout(()=>process.stdout.write(JSON.stringify({id:'unicode0002',title:'第二首'})+'\\n'),200);`;
  const pending = Audio._readYouTubeSearchLines(['-e', script], new AbortController().signal, entry => first.resolve(entry)).then(entries => { finished = true; return entries; });
  assert.equal((await first.promise).title, '歌曲🌊'); assert.equal(finished, false);
  assert.deepEqual((await pending).map(entry => entry.title), ['歌曲🌊', '第二首']);
});

test('aborting a live JSON-lines subprocess stops it after preserving its first callback', async () => {
  const first = defer(), controller = new AbortController();
  const pending = Audio._readYouTubeSearchLines(['-e', `console.log(JSON.stringify({id:'cancel00001',title:'First'}));setInterval(()=>{},1000);`], controller.signal, entry => first.resolve(entry));
  assert.equal((await first.promise).title, 'First'); controller.abort();
  await assert.rejects(pending, { code: 'IMPORT_CANCELLED' });
});

test('a repeated partial search displays cached rows immediately and still refreshes its sources', async (t) => {
  let calls = 0;
  t.mock.method(Audio, '_runYoutubeSearchStream', async (_q, _n, signal, onEntry) => {
    calls++; if (calls === 1) onEntry(general);
    return stall(signal);
  });
  t.mock.method(Audio, '_runYouTubeMusicSearchIds', async () => []);
  await Audio.searchYouTube('test song', { timeoutMs: 35, onUpdate() {} });
  const immediate = [];
  const pending = Audio.searchYouTube('test song', { timeoutMs: 35, onUpdate: update => immediate.push(update) });
  assert.equal(immediate[0].results[0].videoId, general.id);
  const result = await pending;
  assert.equal(result.results[0].videoId, general.id); assert.equal(calls, 2);
});
