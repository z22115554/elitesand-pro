'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { mapConcurrent } = require('../server/utils/map-concurrent');
const silentLog = new Proxy({}, { get: () => () => {} });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function loadModule(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: id => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id),
    __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, URLSearchParams, AbortController, console,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    process: { env: process.env, platform: process.platform, cwd: () => process.cwd(), on() {} },
  }, { filename });
  return module.exports;
}
function lyricsFixture(fetch = async () => { throw new Error('unexpected network call'); }) {
  const events = [];
  const { LyricsEngine: engine } = loadModule('server/services/lyrics-engine.js', {
    '../utils/helpers': { fetchWithTimeout: fetch },
    '../utils/logger': { createLogger: () => silentLog },
    './json-store': { createJsonStore: () => ({ load: () => [], save() {} }) },
    './romanizer': { needsRomanization: () => false },
    '../utils/load-config': {},
    './usage-telemetry': { recordLyricSource: (...args) => events.push(args), recordOutcome: (...args) => events.push(args) },
  });
  for (const method of ['searchBetterLyrics', 'searchPaxsenix', 'searchKugou', 'searchQQMusic', 'searchLrclib', 'searchNetease']) {
    engine[method] = async () => null;
  }
  return { engine, events };
}
const hit = (text = 'hello') => ({ lyrics: `[00:01.00]${text}`, type: 'lrc', source: 'betterlyrics' });

test('concurrent identical lyric searches share requests, parsing and telemetry; completed hits stay cached', async () => {
  const { engine, events } = lyricsFixture();
  const gate = deferred(); let calls = 0, parses = 0;
  const parse = engine.parseLrc;
  engine.parseLrc = (...args) => { parses++; return parse.call(engine, ...args); };
  engine.searchBetterLyrics = async () => { calls++; await gate.promise; return hit(); };
  const jobs = Array.from({ length: 6 }, () => engine.search('Artist', 'Song', 120, false));
  await tick(); assert.equal(calls, 1); gate.resolve();
  const results = await Promise.all(jobs);
  assert.ok(results.every(result => result === results[0]));
  assert.equal(parses, 1); assert.equal(events.length, 2);
  assert.equal(await engine.search('Artist', 'Song', 120, false), results[0]);
  assert.equal(calls, 1);
});

test('concurrent misses run the quality-first waterfall once and retain the negative cache', async () => {
  const { engine } = lyricsFixture(); const order = [];
  for (const [method, label] of [['searchBetterLyrics','betterlyrics'], ['searchPaxsenix','paxsenix'], ['searchKugou','kugou'], ['searchQQMusic','qqmusic'], ['searchLrclib','lrclib'], ['searchNetease','netease']]) {
    engine[method] = async () => { order.push(label); return null; };
  }
  await Promise.all(Array.from({ length: 6 }, () => engine.search('Artist', 'Song', 120, false)));
  assert.deepEqual(order, ['betterlyrics', 'paxsenix', 'kugou', 'qqmusic', 'lrclib', 'netease']);
  assert.equal(await engine.search('Artist', 'Song', 120, false), null);
  assert.equal(order.length, 6);
});

test('duration and romanization options keep independent in-flight searches', async () => {
  const { engine } = lyricsFixture(); let calls = 0;
  engine.searchBetterLyrics = async () => { calls++; await tick(); return hit(); };
  await Promise.all([engine.search('A', 'S', 100, false), engine.search('A', 'S', 101, false), engine.search('A', 'S', 100, true)]);
  assert.equal(calls, 3);
});

test('transient provider errors are not negatively cached and can be retried', async () => {
  const { engine } = lyricsFixture(); let calls = 0;
  engine.searchBetterLyrics = async () => { if (++calls === 1) throw new Error('temporary'); return hit(); };
  assert.equal(await engine.search('A', 'S', 100, false), null);
  assert.ok(await engine.search('A', 'S', 100, false)); assert.equal(calls, 2);
});

test('clearing the cache isolates old in-flight searches without removing a newer search', async () => {
  const { engine } = lyricsFixture(); const old = deferred(), fresh = deferred(); let calls = 0;
  engine.searchBetterLyrics = async () => (++calls === 1 ? old.promise : fresh.promise);
  const first = engine.search('A', 'S', 100, false); await tick(); engine.clearCache();
  const second = engine.search('A', 'S', 100, false); await tick();
  old.resolve(hit('old')); await first;
  const third = engine.search('A', 'S', 100, false); await tick(); assert.equal(calls, 2);
  fresh.resolve(hit('fresh')); const result = await second;
  assert.equal(await third, result); assert.equal(await engine.search('A', 'S', 100, false), result);
  assert.match(result.lyrics, /fresh/);
});

function tokenFixture(fetch) {
  return loadModule('server/services/lyrics-engine.js', {
    '../utils/helpers': { fetchWithTimeout: fetch }, '../utils/logger': { createLogger: () => silentLog },
    './json-store': { createJsonStore: () => ({ load: () => [], save() {} }) },
    './romanizer': { needsRomanization: () => false }, '../utils/load-config': {},
    './usage-telemetry': { recordLyricSource() {}, recordOutcome() {} },
  }).LyricsEngine;
}
const jwt = 'eyJheader.payload.signature';
test('cold concurrent Apple token requests fetch one HTML/JS pair and reuse the token', async () => {
  let calls = 0; const gate = deferred();
  const engine = tokenFixture(async url => {
    calls++; await gate.promise;
    return { ok: true, text: async () => url.endsWith('.js') ? jwt : '<script src="/index~one.js"></script>' };
  });
  const jobs = Array.from({ length: 5 }, () => engine.getAppleMusicToken());
  await tick(); assert.equal(calls, 1); gate.resolve();
  assert.ok((await Promise.all(jobs)).every(value => value === jwt));
  assert.equal(calls, 2); assert.equal(await engine.getAppleMusicToken(), jwt); assert.equal(calls, 2);
});

test('failed Apple token refresh is shared only while pending and the next request retries', async () => {
  let calls = 0;
  const engine = tokenFixture(async url => {
    const number = ++calls; await tick();
    return { ok: number !== 1, text: async () => url.endsWith('.js') ? jwt : '<script src="/index~one.js"></script>' };
  });
  assert.deepEqual(await Promise.all([engine.getAppleMusicToken(), engine.getAppleMusicToken()]), [null, null]);
  assert.equal(calls, 1); assert.equal(await engine.getAppleMusicToken(), jwt); assert.equal(calls, 3);
});

test('LRCLIB avoids duplicate URLs while preserving fallback order and duration verification', async () => {
  const urls = [];
  const engine = tokenFixture(async url => { urls.push(url); return { ok: true, json: async () => [] }; });
  assert.equal(await engine.searchLrclib('', 'Song', 0), null);
  assert.deepEqual(urls, ['https://lrclib.net/api/search?track_name=Song', 'https://lrclib.net/api/search?q=Song']);
  urls.length = 0;
  assert.equal(await engine.searchLrclib('Artist', 'Song', 120), null); assert.equal(urls.length, 4);
  const matched = tokenFixture(async () => ({ ok: true, json: async () => [{ duration: 122, syncedLyrics: '[00:01.00]hello' }] }));
  const result = await matched.searchLrclib('Artist', 'Song', 120);
  assert.equal(result.durationVerified, true); assert.equal(result.type, 'lrc');
});

test('bounded mapping preserves input order and never exceeds two active jobs', async () => {
  const gates = [deferred(), deferred(), deferred()]; let active = 0, peak = 0; const started = [];
  const pending = mapConcurrent([0, 1, 2], 2, async i => { started.push(i); peak = Math.max(peak, ++active); await gates[i].promise; active--; return i; });
  await tick(); assert.deepEqual(started, [0, 1]); gates[1].resolve(); await tick(); assert.deepEqual(started, [0, 1, 2]);
  gates[2].resolve(); gates[0].resolve(); assert.deepEqual(await pending, [0, 1, 2]); assert.equal(peak, 2);
});

test('bounded mapping stops scheduling on failure and drains already started jobs before rejecting', async () => {
  const gate = deferred(), failure = new Error('bad metadata'); const started = []; let settled = false;
  const pending = mapConcurrent([0, 1, 2, 3], 2, async i => { started.push(i); if (i === 0) throw failure; await gate.promise; });
  const checked = assert.rejects(pending, error => error === failure).then(() => { settled = true; });
  await tick(); assert.deepEqual(started, [0, 1]); assert.equal(settled, false);
  gate.resolve(); await checked; assert.deepEqual(started, [0, 1]);
});

function audioFixture(identity = { artist: 'Artist', title: 'Song', confidence: 0.95 }, cover = false) {
  const catalog = deferred(), lyric = deferred(), download = deferred(), loudness = deferred();
  const calls = [], saved = [];
  const lyrics = {
    resolveAppleMusicMetadata: async () => { calls.push('catalog'); return catalog.promise; },
    search: async (artist, title) => { calls.push(['lyrics', artist, title]); return lyric.promise; },
    resolveOriginalArtist: async () => ({ artist: 'Original', confidence: 0.9, candidates: [] }),
  };
  const audio = loadModule('server/services/audio-processor.js', {
    './lyrics-engine': { LyricsEngine: lyrics, DURATION_TOLERANCE: 5 },
    '../utils/logger': { createLogger: () => silentLog }, './ffmpeg-provider': {}, './import-temp-registry': {}, './ytdlp-updater': {},
    './library-store': { findByIdentity: () => null, rememberImport: track => saved.push(track) },
  });
  audio.downloadWithMetadata = () => ({ metadata: Promise.resolve({ id: 'video123456', title: 'Artist - Song', duration: 120 }), completed: download.promise, completeTempImport: () => calls.push('complete') });
  audio.resolveTrackIdentity = () => ({ ...identity }); audio.detectCover = () => cover;
  audio.shouldResolveAppleMetadata = () => !cover;
  const measureLoudnessQueued = audio.measureLoudnessQueued;
  audio.measureLoudnessQueued = async (filePath, signal) => { calls.push(['loudness', filePath, signal]); return loudness.promise; };
  audio.renameToReadableFilename = () => { calls.push('rename'); return 'Artist - Song.m4a'; };
  audio.requireDownloadedAudio = () => {};
  return { audio, catalog, lyric, download, loudness, calls, saved, measureLoudnessQueued };
}
const downloaded = { filePath: '/tmp/video123456.m4a', outputDir: '/tmp' };

test('confident YouTube imports overlap catalog/lyrics/loudness and rename only after FFmpeg exits', async () => {
  const f = audioFixture(); const pending = f.audio._processYouTube('https://youtube.com/watch?v=video123456');
  await tick(); assert.ok(f.calls.includes('catalog')); assert.ok(f.calls.some(c => c[0] === 'lyrics'));
  f.download.resolve(downloaded); await tick(); assert.ok(f.calls.some(c => c[0] === 'loudness')); assert.ok(!f.calls.includes('rename'));
  f.catalog.resolve({ artist: 'Other', title: 'Other', durationSec: 130 }); f.lyric.resolve(hit()); await tick();
  assert.ok(!f.calls.includes('rename')); f.loudness.resolve(-18);
  const track = await pending; assert.equal(track.artist, 'Artist'); assert.equal(track.title, 'Song'); assert.equal(track.loudnessLufs, -18);
  assert.equal(track.lyricsDurationVerified, false); assert.equal(f.saved.length, 1);
  assert.ok(f.calls.indexOf('rename') < f.calls.indexOf('complete'));
});

test('uncertain YouTube identities are corrected before lyrics, with loudness still overlapping catalog', async () => {
  const f = audioFixture({ artist: 'Unknown', title: 'Maybe', confidence: 0.5 });
  const pending = f.audio._processYouTube('https://youtube.com/watch?v=video123456'); await tick();
  assert.ok(!f.calls.some(c => c[0] === 'lyrics')); f.download.resolve(downloaded); await tick();
  assert.ok(f.calls.some(c => c[0] === 'loudness'));
  f.catalog.resolve({ artist: 'Correct', title: 'Correct Song', confidence: 0.9, durationSec: 120 }); await tick();
  assert.ok(f.calls.some(c => c[0] === 'lyrics' && c[1] === 'Correct' && c[2] === 'Correct Song'));
  f.lyric.resolve(hit()); f.loudness.resolve(null); const track = await pending;
  assert.equal(track.artist, 'Correct'); assert.equal(track.lyricsDurationVerified, true); assert.equal(track.loudnessLufs, null);
});

test('cover imports retain performer and search the song without treating the performer as original artist', async () => {
  const f = audioFixture(undefined, true); const pending = f.audio._processYouTube('https://youtube.com/watch?v=video123456'); await tick();
  assert.ok(!f.calls.includes('catalog')); assert.ok(f.calls.some(c => c[0] === 'lyrics' && c[1] === ''));
  f.download.resolve(downloaded); f.lyric.resolve(null); f.loudness.resolve(-20);
  const track = await pending; assert.equal(track.artist, 'Original'); assert.equal(track.performer, 'Artist'); assert.equal(track.isCover, true);
});

test('cancelling while loudness runs never renames or saves a track', async () => {
  const f = audioFixture(); const controller = new AbortController();
  const pending = f.audio._processYouTube('https://youtube.com/watch?v=video123456', { signal: controller.signal });
  const checked = assert.rejects(pending, /取消/); await tick(); f.download.resolve(downloaded); await tick();
  controller.abort(); f.catalog.resolve(null); f.lyric.resolve(null); f.loudness.resolve(-20); await checked;
  assert.ok(!f.calls.includes('rename')); assert.equal(f.saved.length, 0);
});

test('early download rejection is consumed and propagates without renaming', async () => {
  const f = audioFixture(); const pending = f.audio._processYouTube('https://youtube.com/watch?v=video123456');
  const checked = assert.rejects(pending, /download failed/); await tick();
  f.download.reject(new Error('download failed')); await tick(); f.catalog.resolve(null); f.lyric.resolve(null); await checked;
  assert.ok(!f.calls.includes('rename')); assert.equal(f.saved.length, 0);
});

test('early loudness rejection is consumed while catalog runs and never finalizes the audio file', async () => {
  const f = audioFixture(); const pending = f.audio._processYouTube('https://youtube.com/watch?v=video123456');
  const checked = assert.rejects(pending, /cancelled scan/); await tick(); f.download.resolve(downloaded); await tick();
  f.loudness.reject(new Error('cancelled scan')); await tick();
  f.catalog.resolve(null); f.lyric.resolve(null); await checked;
  assert.ok(!f.calls.includes('rename')); assert.ok(!f.calls.includes('complete')); assert.equal(f.saved.length, 0);
});

test('overlapping imports retain the global single FFmpeg scan lock', async () => {
  const f = audioFixture(); const gates = [deferred(), deferred()]; let active = 0, peak = 0; const started = [];
  f.audio.measureLoudness = async filename => {
    const i = Number(filename); started.push(i); peak = Math.max(peak, ++active);
    await gates[i].promise; active--; return -18 - i;
  };
  const first = f.measureLoudnessQueued.call(f.audio, '0');
  const second = f.measureLoudnessQueued.call(f.audio, '1');
  await tick(); assert.deepEqual(started, [0]); gates[0].resolve(); await tick(); assert.deepEqual(started, [0, 1]);
  gates[1].resolve(); assert.deepEqual(await Promise.all([first, second]), [-18, -19]); assert.equal(peak, 1);
});

function uploadHandler(dependencies) {
  const filename = path.resolve(__dirname, '../server/routes/api.js');
  const source = fs.readFileSync(filename, 'utf8');
  const start = source.indexOf("router.post('/upload',");
  const end = source.indexOf('\n// ─── YouTube 連結處理', start);
  const handler = source.slice(start, end).match(/async \(req, res\) => ([\s\S]*)\);\s*$/);
  assert.ok(handler, 'upload route handler is available');
  return vm.runInNewContext(`(async (req, res) => ${handler[1]})`, { ...dependencies, Buffer, path, mapConcurrent, log: silentLog }, { filename });
}
function responseFixture() {
  return { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
}

test('actual upload route overlaps loudness/lyrics for two tracks and returns ordered warnings and metadata', async () => {
  const lyricGates = [deferred(), deferred(), deferred()], loudnessGates = [deferred(), deferred(), deferred()];
  const calls = [], covers = [], remembered = [];
  const handler = uploadHandler({
    parseMusicFile: async file => { const i = Number(path.basename(file, '.m4a')); calls.push(['metadata', i]); return { common: { title: `Song${i}`, artist: 'Artist', picture: [{ format: 'image/png', data: Buffer.from('cover') }] }, format: { duration: 120 } }; },
    AudioProcessor: { measureLoudnessQueued: file => { const i = Number(path.basename(file, '.m4a')); calls.push(['loudness', i]); return loudnessGates[i].promise; }, parseVideoTitle: name => ({ title: name }), isKnownArtistName: () => false },
    LyricsEngine: { search: (artist, title) => { const i = Number(title.slice(4)); calls.push(['lyrics', i]); return lyricGates[i].promise; } },
    libraryStore: { rememberImport: track => remembered.push(track) },
    fs: { writeFileSync: file => covers.push(file) }, downloadsDir: '/tmp', parseOffset: () => 75, sanitizeTrack: track => track,
  });
  const files = [0, 1, 2].map(i => ({ path: `/tmp/${i}.m4a`, originalname: Buffer.from(`歌曲${i}.m4a`).toString('latin1') }));
  const res = responseFixture(); const pending = handler({ files }, res); await tick();
  assert.deepEqual(calls.map(c => c.join(':')).sort(), ['metadata:0', 'metadata:1', 'loudness:0', 'loudness:1', 'lyrics:0', 'lyrics:1'].sort());
  lyricGates[1].reject(new Error('offline')); loudnessGates[1].resolve(-19); await tick();
  assert.ok(calls.some(c => c[0] === 'metadata' && c[1] === 2));
  lyricGates[2].resolve({ ...hit(), parsedLyrics: [{ time: 1, text: 'hello' }] }); loudnessGates[2].resolve(-18);
  lyricGates[0].reject(new Error('offline')); loudnessGates[0].reject(new Error('ffmpeg unavailable')); await pending;
  assert.equal(res.code, 200); assert.deepEqual(Array.from(res.body.tracks, t => t.title), ['Song0', 'Song1', 'Song2']);
  assert.deepEqual(Array.from(res.body.warnings), ['Song0：音訊已匯入，但自動歌詞搜尋失敗', 'Song1：音訊已匯入，但自動歌詞搜尋失敗']);
  assert.deepEqual(remembered, Array.from(res.body.tracks), 'all uploads are available to library/BGM without being played');
  assert.equal(res.body.tracks[0].loudnessLufs, null); assert.equal(res.body.tracks[1].loudnessLufs, -19);
  assert.equal(res.body.tracks[2].lrcOffset, 75); assert.equal(res.body.tracks[2].lyricsSource, 'betterlyrics');
  assert.equal(res.body.tracks[2].originalName, '歌曲2.m4a'); assert.equal(covers.length, 3); assert.ok(covers.every(p => p.endsWith('.png')));
});
