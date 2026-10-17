'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Loading the audio service must never open the user's actual lyrics cache.
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-search-test-'));
for (const [name, directory] of Object.entries({
  ELITESAND_DATA_DIR: 'data', ELITESAND_LOGS_DIR: 'logs', ELITESAND_DOWNLOADS_DIR: 'downloads',
})) process.env[name] = path.join(runtime, directory);
const AudioProcessor = require('../server/services/audio-processor');

const general = { id: 'g0000000001', title: 'Search result', duration: 210 };
const music = { id: 'm0000000001', title: 'Official audio', duration: 205 };

test.beforeEach(() => AudioProcessor._clearYouTubeSearchCacheForTest());

for (const slowStage of ['ids', 'enrich']) {
  test(`ready general results do not wait for stalled Music ${slowStage}`, async (t) => {
    let stopped = false;
    const stall = (signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        stopped = true;
        reject(new Error('cancelled'));
      }, { once: true });
    });
    t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => [general]);
    t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async (_query, _limit, signal) =>
      slowStage === 'ids' ? stall(signal) : [music.id]);
    t.mock.method(AudioProcessor, '_enrichYouTubeIds', async (_ids, signal) => stall(signal));
    const requestId = `latency-${slowStage}`;
    // Under the old Promise.all, this cancels the entire search instead of
    // allowing an already available result to reach the user.
    const watchdog = setTimeout(() => AudioProcessor.cancelImport(requestId), 1800);
    try {
      const result = await AudioProcessor.searchYouTube('test song', { requestId });
      assert.equal(result.results[0].videoId, general.id);
      assert.equal(stopped, true, 'the unused subprocess must be cancelled');
    } finally {
      clearTimeout(watchdog);
      AudioProcessor.cancelImport(requestId);
    }
  });
}

test('fast Music results retain official-first ordering and de-duplication', async (t) => {
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => [general, music]);
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => [music.id]);
  t.mock.method(AudioProcessor, '_enrichYouTubeIds', async () => [music]);
  const result = await AudioProcessor.searchYouTube('test song');
  assert.deepEqual(result.results.map(item => item.videoId), [music.id, general.id]);
});

test('failed general search still falls back to Music', async (t) => {
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => { throw new Error('unavailable'); });
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => [music.id]);
  t.mock.method(AudioProcessor, '_enrichYouTubeIds', async () => [music]);
  const result = await AudioProcessor.searchYouTube('test song');
  assert.equal(result.results[0].videoId, music.id);
  assert.equal(result.hasMore, false);
});

test('empty general search still waits for usable Music results', async (t) => {
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => []);
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => [music.id]);
  t.mock.method(AudioProcessor, '_enrichYouTubeIds', async () => [music]);
  const result = await AudioProcessor.searchYouTube('test song');
  assert.equal(result.results[0].videoId, music.id);
});

test('user cancellation aborts Music without returning stale general results', async (t) => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let musicSignal;
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => [general]);
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async (_query, _limit, signal) => {
    musicSignal = signal;
    started();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  });
  const pending = AudioProcessor.searchYouTube('test song', { requestId: 'cancel-search' });
  await ready;
  assert.equal(AudioProcessor.cancelImport('cancel-search').ok, true);
  await assert.rejects(pending, { code: 'IMPORT_CANCELLED' });
  assert.equal(musicSignal.aborted, true);
});

test('load-more keeps general-search pagination and never starts Music', async (t) => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ id: `g${String(i).padStart(10, '0')}`, title: `Result ${i}` }));
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async (_query, count) => {
    assert.equal(count, 20);
    return entries;
  });
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => assert.fail('unexpected Music search'));
  const result = await AudioProcessor.searchYouTube('test song', { limit: 10, offset: 10 });
  assert.deepEqual(result.results.map(item => item.videoId), entries.slice(10).map(item => item.id));
  assert.equal(result.hasMore, true);
});

test('a repeated normalized query reuses results without exposing mutable cache data', async (t) => {
  let calls = 0;
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => { calls++; return [general]; });
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => []);
  const first = await AudioProcessor.searchYouTube('test   song');
  first.results[0].title = 'caller changed this';
  const second = await AudioProcessor.searchYouTube('  test song  ');
  assert.equal(calls, 1);
  assert.equal(second.results[0].title, general.title);
  second.results.length = 0;
  assert.equal((await AudioProcessor.searchYouTube('test song')).results.length, 1);
});

test('cached results expire without preventing fresh searches', async (t) => {
  let now = 100000;
  let calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => { calls++; return [general]; });
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => []);
  await AudioProcessor.searchYouTube('test song');
  now += 59999;
  await AudioProcessor.searchYouTube('test song');
  assert.equal(calls, 1);
  now += 1;
  await AudioProcessor.searchYouTube('test song');
  assert.equal(calls, 2);
});

test('cached queries cannot substitute another page or result limit', async (t) => {
  let calls = 0;
  const entries = Array.from({ length: 20 }, (_, i) => ({ id: `g${String(i).padStart(10, '0')}`, title: `Result ${i}` }));
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async (_query, count) => { calls++; return entries.slice(0, count); });
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => []);
  assert.equal((await AudioProcessor.searchYouTube('test song', { limit: 5 })).results.length, 5);
  assert.equal((await AudioProcessor.searchYouTube('test song', { limit: 10 })).results.length, 10);
  const more = await AudioProcessor.searchYouTube('test song', { limit: 10, offset: 10 });
  assert.equal(more.results[0].videoId, entries[10].id);
  await AudioProcessor.searchYouTube('test song', { limit: 10, offset: 10 });
  assert.equal(calls, 3);
});

test('failed or empty searches are retried instead of cached', async (t) => {
  let calls = 0;
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => {
    calls++;
    if (calls === 1) throw new Error('temporarily unavailable');
    return calls === 2 ? [] : [general];
  });
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => []);
  await assert.rejects(AudioProcessor.searchYouTube('test song'));
  assert.equal((await AudioProcessor.searchYouTube('test song')).results.length, 0);
  assert.equal((await AudioProcessor.searchYouTube('test song')).results.length, 1);
  assert.equal(calls, 3);
});

test('an already cancelled request cannot return cached results', async (t) => {
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async () => [general]);
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => []);
  await AudioProcessor.searchYouTube('test song');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(AudioProcessor.searchYouTube('test song', { signal: controller.signal }), { code: 'IMPORT_CANCELLED' });
});

test('many different queries evict old results while retaining recently reused searches', async (t) => {
  const calls = new Map();
  t.mock.method(AudioProcessor, '_runYoutubeSearch', async (query) => {
    calls.set(query, (calls.get(query) || 0) + 1);
    return [general];
  });
  t.mock.method(AudioProcessor, '_runYouTubeMusicSearchIds', async () => []);
  for (let i = 0; i < 32; i++) await AudioProcessor.searchYouTube(`test song ${i}`);
  await AudioProcessor.searchYouTube('test song 0');
  await AudioProcessor.searchYouTube('test song 32');
  await AudioProcessor.searchYouTube('test song 0');
  assert.equal(calls.get('test song 0'), 1);
  await AudioProcessor.searchYouTube('test song 1');
  assert.equal(calls.get('test song 1'), 2);
});

test('flat-search arguments do not depend on player JS runtime support', () => {
  const args = AudioProcessor._youtubeSearchArgsForTest('test song', 10);
  assert.ok(args.includes('--flat-playlist'));
  assert.ok(args.includes('--no-config'));
  assert.ok(!args.includes('--js-runtimes'));
});
