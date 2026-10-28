'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createPracticeGuideService, validateGuide, validTrackId } = require('../server/services/practice-guide-service');

const projectRoot = path.resolve(__dirname, '..');
const python = process.env.ELITESAND_TEST_PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
const ffmpeg = process.env.ELITESAND_TEST_FFMPEG || 'ffmpeg';

function wav(seconds, frequencies = [440]) {
  const rate = 16000; const length = Math.floor(seconds * rate); const data = Buffer.alloc(44 + length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i += 1) {
    const frequency = frequencies[Math.min(frequencies.length - 1, Math.floor(i * frequencies.length / length))];
    const value = frequency ? Math.sin(2 * Math.PI * frequency * i / rate) * 0.35 : 0;
    data.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return data;
}

async function fixture(t, overrides = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'practice-guide-test-'));
  const downloadsDir = path.join(root, 'media'); const cacheDir = path.join(root, 'pitch-guides');
  await fs.promises.mkdir(downloadsDir);
  const tracks = new Map();
  const service = createPracticeGuideService({ appPaths: { projectRoot, dataDir: root, downloadsDir }, downloadsDir, cacheDir,
    getTrack: (id) => tracks.get(id), getPython: () => python, getFfmpeg: () => ffmpeg,
    scriptDir: path.join(projectRoot, 'ai'), ...overrides });
  t.after(async () => { service.dispose(); await fs.promises.rm(root, { force: true, recursive: true }); });
  async function add(id, buffer = wav(2.4, [440, 523.251, 659.255])) {
    const vocalsFile = `${id}.wav`; await fs.promises.writeFile(path.join(downloadsDir, vocalsFile), buffer);
    tracks.set(id, { id, vocalsFile, separationStatus: 'done' });
  }
  return { root, downloadsDir, cacheDir, tracks, service, add };
}

async function terminal(service, id, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await service.get(id);
    if (!['queued', 'processing', 'cancelling'].includes(result.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${id}`);
}

test('actual FFmpeg and Python extract original-key melody, cache and invalidate', async (t) => {
  const { service, add, downloadsDir, cacheDir } = await fixture(t);
  await add('melody');
  assert.equal((await service.get('melody')).status, 'missing');
  const started = await service.start('melody', { algorithm: 'yin' });
  assert.ok(started.job.jobId);
  const result = await terminal(service, 'melody');
  assert.equal(result.status, 'ready', JSON.stringify(result));
  const guide = result.guide;
  assert.ok(validateGuide(guide)); assert.equal(guide.algorithm, 'yin-cpu');
  assert.equal(guide.duration, 2.4); assert.equal(guide.contour.length, 120);
  assert.ok(guide.voicedSeconds > 2);
  for (const [time, expected] of [[0.3, 69], [1.1, 72], [1.9, 76]]) {
    const point = guide.contour.find(([at]) => Math.abs(at - time) < 0.001);
    assert.ok(Math.abs(point[1] - expected) < 0.15, JSON.stringify(point));
  }
  // 沒有歌詞：每段連續人聲就是一個範圍，靠音高切成三個音
  assert.deepEqual(guide.notes.map((note) => note.midi), [69, 72, 76]);
  assert.ok(guide.limitations.includes('no-lyrics'));
  const cached = await service.start('melody', { algorithm: 'yin' });
  assert.equal(cached.cacheHit, true); assert.equal(cached.guide.guideId, guide.guideId);
  assert.equal((await fs.promises.readdir(cacheDir)).length, 1);
  await fs.promises.writeFile(path.join(downloadsDir, 'melody.wav'), wav(2.4, [220]));
  assert.equal((await service.get('melody')).status, 'missing');
  await service.start('melody', { algorithm: 'yin' });
  const updated = await terminal(service, 'melody');
  assert.equal(updated.status, 'ready', JSON.stringify(updated));
  assert.notEqual(updated.guide.sourceFingerprint, guide.sourceFingerprint);
  assert.ok(Math.abs(updated.guide.contour[20][1] - 57) < 0.15);
  const changedAlgorithm = await service.start('melody', { algorithm: 'auto' });
  assert.ok(changedAlgorithm.job, 'settings changes must invalidate cache');
  assert.equal((await terminal(service, 'melody')).guide.requestedAlgorithm, 'auto');
});

test('silence is honestly unvoiced and produces no notes', async (t) => {
  const { service, add } = await fixture(t); await add('silence', wav(2.1, [0]));
  await service.start('silence'); const result = await terminal(service, 'silence');
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(result.guide.voicedSeconds, 0); assert.deepEqual(result.guide.notes, []);
  assert.ok(result.guide.contour.every(([, midi]) => midi === 0));
});

test('word-level lyrics cut one block per sung word, honour the lyric offset, and go stale when lyrics change', async (t) => {
  // 三個字各唱一個音；歌詞偏移 +200ms（app 規則：歌詞時間＝音訊時間＋偏移），所以字的時間要往前 0.2 秒
  let lyrics = { offsetMs: 200, lines: [{ time: 200, text: 'la la la', words: [
    { text: 'la', start: 0, duration: 800 }, { text: 'la', start: 800, duration: 800 }, { text: 'la', start: 1600, duration: 800 }] }] };
  const { service, add } = await fixture(t, { getLyrics: async () => lyrics });
  await add('words');
  await service.start('words', { algorithm: 'yin' });
  const result = await terminal(service, 'words');
  assert.equal(result.status, 'ready', JSON.stringify(result));
  const guide = result.guide;
  assert.equal(guide.lines.length, 1); assert.equal(guide.lines[0].words.length, 3);
  assert.deepEqual(guide.notes.map((note) => [note.midi, note.word]), [[69, 0], [72, 1], [76, 2]]);
  assert.ok(Math.abs(guide.lines[0].words[1].start - 0.8) < 0.001, 'offset must be removed from lyric times');
  assert.equal(guide.lyricOffsetMs, 200);
  // 改了偏移：舊音符位置不對，回報 stale（不刪舊檔），重建後換成新指紋
  lyrics = { ...lyrics, offsetMs: 0 };
  assert.equal((await service.get('words')).status, 'stale');
  await service.start('words', { algorithm: 'yin' });
  const rebuilt = await terminal(service, 'words');
  assert.equal(rebuilt.status, 'ready'); assert.notEqual(rebuilt.guide.lyricsKey, guide.lyricsKey);
});

test('line-level lyrics (no word timing) still produce notes cut by pitch inside the line', async (t) => {
  const { service, add } = await fixture(t, { getLyrics: async () => ({ offsetMs: 0, lines: [{ time: 0, duration: 2400, text: 'one line', words: [] }] }) });
  await add('lrc');
  await service.start('lrc', { algorithm: 'yin' });
  const guide = (await terminal(service, 'lrc')).guide;
  assert.deepEqual(guide.notes.map((note) => note.midi), [69, 72, 76]);
  assert.ok(guide.notes.every((note) => note.line === 0 && note.word === 0));
});

test('lyric payload is bounded and sanitized before reaching the worker', () => {
  const { sanitizeLyrics } = require('../server/services/practice-guide-service');
  const out = sanitizeLyrics({ offsetMs: 1e9, lines: [{ time: 10, text: 'x'.repeat(9000), words: [{ text: 'y'.repeat(500), start: 0, duration: 5, evil: true }] }, { time: -5 }] });
  assert.equal(out.offsetMs, 60000); assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].text.length, 500); assert.equal(out.lines[0].words[0].text.length, 80);
  assert.equal(out.lines[0].words[0].evil, undefined);
});

test('requires separated vocals and rejects IDs, traversal and symlinks', async (t) => {
  const { service, tracks, downloadsDir, root } = await fixture(t);
  tracks.set('mix', { file: 'mix.mp3', separationStatus: 'none' });
  await assert.rejects(service.start('mix'), { code: 'PRACTICE_VOCALS_REQUIRED', status: 409 });
  for (const id of ['../outside', '..', 'a/b', 'a\\b', '\0']) {
    assert.equal(validTrackId(id), false);
    await assert.rejects(service.start(id), { code: 'INVALID_TRACK_ID' });
  }
  tracks.set('bad', { vocalsFile: '../outside.wav', separationStatus: 'done' });
  await assert.rejects(service.start('bad'), { code: 'INVALID_VOCAL_PATH' });
  await fs.promises.writeFile(path.join(root, 'outside.wav'), wav(1));
  // Windows 沒有開發人員模式／管理員時不能建符號連結：那台機器上這個檢查無法執行，明確略過而不是假裝通過
  let linked = true;
  try { await fs.promises.symlink(path.join(root, 'outside.wav'), path.join(downloadsDir, 'link.wav')); }
  catch (error) { if (error.code !== 'EPERM') throw error; linked = false; t.diagnostic('symlink check skipped: EPERM'); }
  if (linked) {
    tracks.set('link', { vocalsFile: 'link.wav', separationStatus: 'done' });
    await assert.rejects(service.start('link'), { code: 'INVALID_VOCAL_PATH' });
  }
  tracks.set('gone', { vocalsFile: 'gone.wav', separationStatus: 'done' });
  await assert.rejects(service.start('gone'), { code: 'VOCALS_MISSING' });
});

test('failed decode is terminal, does not replace cache, retry works', async (t) => {
  const { service, add, downloadsDir } = await fixture(t); await add('broken', Buffer.from('not audio'));
  await service.start('broken'); const failed = await terminal(service, 'broken');
  assert.equal(failed.status, 'failed'); assert.equal(failed.job.code, 'GUIDE_DECODE_FAILED');
  await fs.promises.writeFile(path.join(downloadsDir, 'broken.wav'), wav(1.5));
  await service.start('broken'); assert.equal((await terminal(service, 'broken')).status, 'ready');
});

test('CPU queue stays serialized until cancelled child actually closes', async (t) => {
  let activeChildren = 0; let maxChildren = 0; let first = true;
  const { service, add } = await fixture(t, { spawn: (command, args, options) => {
    const child = first ? spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),180));setInterval(()=>{},1000)"], options)
      : spawn(command, args, options);
    first = false; activeChildren += 1; maxChildren = Math.max(maxChildren, activeChildren);
    child.once('close', () => { activeChildren -= 1; }); return child;
  } });
  await add('first'); await add('second');
  await service.start('first');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = await service.start('second'); assert.equal(second.status, 'queued');
  const cancelled = service.cancel('first'); assert.equal(cancelled.job.status, 'cancelling');
  assert.equal((await service.get('second')).status, 'queued');
  assert.equal((await terminal(service, 'first')).status, 'cancelled');
  assert.equal((await terminal(service, 'second')).status, 'ready');
  assert.equal(maxChildren, 1);
});

test('queued cancel and timeout leave no partial guide and release queue', async (t) => {
  const { service, add, cacheDir } = await fixture(t, { timeoutMs: 100, spawn: (_command, _args, options) =>
    spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options) });
  await add('slow'); await add('queued'); await service.start('slow'); await service.start('queued');
  assert.equal(service.cancel('queued').job.status, 'cancelled');
  assert.equal((await terminal(service, 'slow')).job.code, 'GUIDE_TIMEOUT');
  assert.equal((await terminal(service, 'queued')).status, 'cancelled');
  assert.equal(service.getActiveJobs().length, 0);
  assert.deepEqual(await fs.promises.readdir(cacheDir), []);
});

test('cancel force-stops a child that ignores graceful termination', async (t) => {
  const { service, add } = await fixture(t, { spawn: (_command, _args, options) =>
    spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"], options) });
  await add('stubborn'); await service.start('stubborn');
  await new Promise((resolve) => setTimeout(resolve, 150));
  service.cancel('stubborn');
  const result = await terminal(service, 'stubborn', 5000);
  assert.equal(result.status, 'cancelled'); assert.equal(service.getActiveJobs().length, 0);
});

test('schema validator rejects corrupted frames and non-finite values', () => {
  assert.equal(validateGuide({ schemaVersion: 1, frames: [] }), false);
});

test('worker rejects source over the duration limit instead of silently truncating', async (t) => {
  const { service, add, cacheDir } = await fixture(t);
  await add('long', wav(1200.04, [0]));
  await service.start('long'); const result = await terminal(service, 'long');
  assert.equal(result.status, 'failed'); assert.equal(result.job.code, 'GUIDE_TOO_LONG');
  assert.deepEqual(await fs.promises.readdir(cacheDir), []);
});

test('missing runtime reports failure and releases the CPU slot', async (t) => {
  const { service, add } = await fixture(t, { getPython: () => path.join(os.tmpdir(), 'elitesand-nonexistent-python') });
  await add('runtime'); await service.start('runtime');
  const result = await terminal(service, 'runtime');
  assert.equal(result.status, 'failed'); assert.equal(result.job.code, 'PRACTICE_RUNTIME_MISSING');
  assert.equal(service.getActiveJobs().length, 0);
});

test('failed forced rebuild reports its failure while keeping the complete old cache', async (t) => {
  let runtime = python;
  const { service, add } = await fixture(t, { getPython: () => runtime });
  await add('preserved'); await service.start('preserved', { algorithm: 'yin' });
  const original = await terminal(service, 'preserved'); assert.equal(original.status, 'ready');
  runtime = path.join(os.tmpdir(), 'elitesand-nonexistent-python');
  await service.start('preserved', { force: true, algorithm: 'yin' });
  const result = await terminal(service, 'preserved');
  assert.equal(result.status, 'failed'); assert.equal(result.cachedGuideAvailable, true);
  const existing = await service.start('preserved', { algorithm: 'yin' });
  assert.equal(existing.cacheHit, true); assert.equal(existing.guide.guideId, original.guide.guideId);
  assert.equal((await service.get('preserved')).status, 'ready');
});

test('all guide routes use controller/PIN middleware, with injectable service and response contract', async () => {
  const { createPracticeRouter } = require('../server/routes/practice');
  const routes = []; const protect = (_req, _res, next) => next();
  const router = { use(middleware) { routes.push({ method: 'use', handler: middleware }); },
    get(url, guard, handler) { routes.push({ method: 'get', url, guard, handler }); },
    post(url, guard, handler) { routes.push({ method: 'post', url, guard, handler }); } };
  const service = { get: async () => ({ status: 'ready', guide: { trackId: 'test' } }),
    start: async () => ({ status: 'queued', job: { jobId: 'job' } }), cancel: () => ({ cancelled: true }) };
  let installs = 0;
  const runtime = { isAvailable: () => true, isPracticePitchModelAvailable: () => installs > 0,
    installPracticePitchModel: async () => { installs += 1; return { ok: true } } };
  const built = createPracticeRouter({ express: { Router: () => router }, requirePin: protect, service, runtime });
  assert.equal(built.practiceService, service);
  const headers = {};
  routes[0].handler({}, { set: (key, value) => { headers[key] = value; } }, () => {});
  assert.equal(headers['Cache-Control'], 'private, no-store');
  const endpoints = routes.filter((route) => route.method !== 'use');
  // 每一條都要手動掛 PIN（鐵則 15），包括會下載套件的音高元件安裝
  assert.ok(endpoints.every((route) => route.guard === protect));
  assert.deepEqual(endpoints.map((route) => [route.method, route.url]), [
    ['get', '/guides/:trackId'], ['post', '/guides/:trackId'], ['post', '/guides/:trackId/cancel'],
    ['get', '/pitch-model'], ['post', '/pitch-model/install'],
  ]);
  async function response(route) {
    const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await route.handler({ params: { trackId: 'test' }, body: {} }, res); return res;
  }
  assert.equal((await response(endpoints[0])).statusCode, 200);
  assert.equal((await response(endpoints[1])).statusCode, 202);
  assert.equal((await response(endpoints[2])).body.cancelled, true);
  const statusBefore = {}; endpoints[3].handler({}, { json(value) { Object.assign(statusBefore, value); } });
  assert.equal(statusBefore.installed, false);
  assert.equal((await response(endpoints[4])).body.installed, true);
  assert.equal(installs, 1);
});

test('packaged runtime resolves external AI script directory with spaces and Unicode', async (t) => {
  const invocations = [];
  const { service, add, root } = await fixture(t, { scriptDir: undefined, spawn: (command, args, options) => {
    invocations.push({ command, args, options }); return spawn(command, args, options);
  } });
  const packagedAi = path.join(root, 'resources', 'tools', 'AI 練唱');
  await fs.promises.mkdir(packagedAi, { recursive: true });
  await fs.promises.writeFile(path.join(packagedAi, 'supervisor.py'), '# packaged resolver marker\n');
  await fs.promises.copyFile(path.join(projectRoot, 'ai', 'pitch_guide_worker.py'), path.join(packagedAi, 'pitch_guide_worker.py'));
  const previous = process.env.ELITESAND_AI_SCRIPT_DIR;
  process.env.ELITESAND_AI_SCRIPT_DIR = packagedAi;
  t.after(() => { if (previous === undefined) delete process.env.ELITESAND_AI_SCRIPT_DIR; else process.env.ELITESAND_AI_SCRIPT_DIR = previous; });
  await add('packaged'); await service.start('packaged', { algorithm: 'yin' });
  const result = await terminal(service, 'packaged');
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(invocations[1].args[0], path.join(packagedAi, 'pitch_guide_worker.py'));
  assert.equal(invocations[1].options.env.OMP_NUM_THREADS, '1');
  assert.equal(invocations[1].options.env.CUDA_VISIBLE_DEVICES, '');
  assert.ok(invocations[0].args.includes('-filter_threads'));
});
