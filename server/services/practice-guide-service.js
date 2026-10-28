'use strict';

// Practice assets are deliberately separate from library/state.json and all
// socket snapshots. The service never installs dependencies or records a mic.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const SCHEMA_VERSION = 2;
const ALGORITHM_VERSION = 'practice-pitch-2';
const MAX_LYRIC_LINES = 2000;
const MAX_LYRIC_BYTES = 4 * 1024 * 1024;
const MAX_DURATION_SECONDS = 20 * 60;
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_GUIDE_BYTES = 16 * 1024 * 1024;
const MAX_FRAMES = Math.ceil(MAX_DURATION_SECONDS / 0.02) + 2;
const MAX_NOTES = 40000;
const ACTIVE_STATES = new Set(['queued', 'processing', 'cancelling']);
const ALGORITHMS = new Set(['auto', 'yin', 'torchcrepe']);

class PracticeGuideError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = 'PracticeGuideError'; this.code = code; this.status = status;
  }
}

function validTrackId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value !== '.' && value !== '..' && !/[\\/\x00-\x1f]/.test(value);
}

function isInside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function publicJob(job) {
  return { jobId: job.jobId, trackId: job.trackId, status: job.status, stage: job.stage,
    progress: job.progress, createdAt: job.createdAt, startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null, error: job.error || null, code: job.code || null };
}

function validateGuide(guide, expected = {}) {
  if (!guide || guide.schemaVersion !== SCHEMA_VERSION || guide.algorithmVersion !== ALGORITHM_VERSION
      || typeof guide.guideId !== 'string' || !/^[a-f0-9]{64}$/.test(guide.guideId)
      || typeof guide.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(guide.sourceFingerprint)
      || typeof guide.lyricsKey !== 'string' || !/^[a-f0-9]{64}$/.test(guide.lyricsKey)
      || !validTrackId(guide.trackId) || !ALGORITHMS.has(guide.requestedAlgorithm)
      || typeof guide.createdAt !== 'string' || !Number.isFinite(Date.parse(guide.createdAt))
      || !Number.isFinite(guide.duration) || guide.duration <= 0 || guide.duration > MAX_DURATION_SECONDS
      || guide.hopSeconds !== 0.01 || guide.contourSeconds !== 0.02 || guide.sampleRate !== 16000
      || !Number.isFinite(guide.tuning) || Math.abs(guide.tuning) > 0.5 || !Number.isFinite(guide.lyricOffsetMs)
      || !Number.isFinite(guide.voicedSeconds) || guide.voicedSeconds < 0 || guide.voicedSeconds > guide.duration + 0.1
      || !Array.isArray(guide.contour) || guide.contour.length < 1 || guide.contour.length > MAX_FRAMES
      || !Array.isArray(guide.notes) || guide.notes.length > MAX_NOTES
      || !Array.isArray(guide.lines) || guide.lines.length > MAX_LYRIC_LINES
      || !['yin-cpu', 'torchcrepe-tiny-cpu'].includes(guide.algorithm)) return false;
  if (expected.sourceFingerprint && guide.sourceFingerprint !== expected.sourceFingerprint) return false;
  if (expected.lyricsKey && guide.lyricsKey !== expected.lyricsKey) return false;
  if (expected.trackId && guide.trackId !== expected.trackId) return false;
  if (expected.requestedAlgorithm && guide.requestedAlgorithm !== expected.requestedAlgorithm) return false;
  let previous = -1;
  for (const point of guide.contour) {
    if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || point[0] <= previous
      || point[0] < 0 || point[0] > guide.duration + 0.02 || !Number.isFinite(point[1]) || point[1] < 0 || point[1] > 140) return false;
    previous = point[0];
  }
  for (const line of guide.lines) {
    if (!line || !Number.isFinite(line.start) || !Number.isFinite(line.end) || line.end < line.start
      || typeof line.text !== 'string' || !Array.isArray(line.words) || line.words.length < 1 || line.words.length > 400) return false;
    for (const word of line.words) {
      if (!word || typeof word.text !== 'string' || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start) return false;
    }
  }
  previous = -1;
  for (const note of guide.notes) {
    // 依開始時間排序；對唱時兩句歌詞可能重疊，所以不要求前一個音已結束。
    if (!note || !Number.isFinite(note.start) || !Number.isFinite(note.end) || note.start < previous
      || note.start < 0 || note.end <= note.start || note.end > guide.duration + 0.001
      || !Number.isInteger(note.midi) || note.midi <= 0 || note.midi > 140
      || !Number.isInteger(note.line) || note.line < 0 || !Number.isInteger(note.word) || note.word < 0
      || (guide.lines.length && (note.line >= guide.lines.length || note.word >= guide.lines[note.line].words.length))) return false;
    previous = note.start;
  }
  return true;
}

/** 歌詞與偏移的指紋：任一改變（改歌詞、重新對時）就要重算，舊快取不再使用。 */
function lyricsKeyFor(payload) {
  return crypto.createHash('sha256').update(JSON.stringify([ALGORITHM_VERSION, payload.offsetMs, payload.lines])).digest('hex');
}

/** 只留 worker 需要的欄位並設上限：歌詞來自使用者的媒體庫，長度與型別都不保證。 */
function sanitizeLyrics(raw) {
  const lines = (Array.isArray(raw && raw.lines) ? raw.lines : []).slice(0, MAX_LYRIC_LINES).map((line) => ({
    time: Number(line && line.time) || 0,
    duration: Number(line && line.duration) || 0,
    text: String((line && line.text) || '').slice(0, 500),
    words: (Array.isArray(line && line.words) ? line.words : []).slice(0, 400).map((word) => ({
      text: String((word && word.text) || '').slice(0, 80),
      start: Number(word && word.start) || 0,
      duration: Number(word && word.duration) || 0,
    })),
  })).filter((line) => line.time >= 0);
  const offsetMs = Number(raw && raw.offsetMs);
  return { lines, offsetMs: Number.isFinite(offsetMs) ? Math.max(-60000, Math.min(60000, offsetMs)) : 0 };
}

function createPracticeGuideService(options = {}) {
  const appPaths = options.appPaths || require('../utils/app-paths');
  const downloadsDir = path.resolve(options.downloadsDir || appPaths.downloadsDir);
  const cacheDir = path.resolve(options.cacheDir || path.join(appPaths.dataDir, 'pitch-guides'));
  const getTrack = options.getTrack || ((id) => require('./library-store').peekEntry(id));
  // 逐字歌詞＋這首歌的歌詞偏移（app 的 trackOffsets：歌詞時間＝音訊時間＋偏移）。沒有歌詞也能分析，只是改用音高切音符。
  const getLyrics = options.getLyrics || (async () => ({ lines: [], offsetMs: 0 }));
  const getPython = options.getPython || (() => process.env.ELITESAND_AI_PYTHON || require('./ai-runtime-provider').PYTHON_EXE);
  const getFfmpeg = options.getFfmpeg || (() => require('./ffmpeg-provider').getFfmpegPath());
  // Resolve at dispatch time, using the same external resource path as the
  // separation supervisor. Importing/constructing this service starts no work.
  const getWorkerPath = () => path.resolve(options.scriptDir
    || require('./ai-separation').resolveAiScriptDir(), 'pitch_guide_worker.py');
  const spawnImpl = options.spawn || spawn;
  const timeoutMs = options.timeoutMs || 10 * 60 * 1000;
  const maxQueue = options.maxQueue || 12;
  const events = new EventEmitter();
  const jobs = new Map();
  const queue = [];
  const fingerprints = new Map();
  const starting = new Map();
  let active = null;
  let disposed = false;

  function emitJob(job) { events.emit('progress', publicJob(job)); }
  function checkCancelled(job) {
    if (job.timedOut) throw new PracticeGuideError('GUIDE_TIMEOUT', '音高分析逾時，已停止工作。', 504);
    if (job.controller.signal.aborted || disposed) throw new PracticeGuideError('GUIDE_CANCELLED', '音高分析已取消。', 409);
  }

  async function sourceFor(trackId) {
    if (!validTrackId(trackId)) throw new PracticeGuideError('INVALID_TRACK_ID', '歌曲識別碼無效。');
    const track = await getTrack(trackId);
    if (!track) throw new PracticeGuideError('TRACK_NOT_FOUND', '找不到這首歌。', 404);
    if (!track.vocalsFile || track.separationStatus !== 'done') {
      throw new PracticeGuideError('PRACTICE_VOCALS_REQUIRED', '請先完成這首歌的人聲分離，再建立練唱音高。', 409);
    }
    const filename = track.vocalsFile;
    if (typeof filename !== 'string' || filename !== path.basename(filename) || /[\\/:\x00]/.test(filename)) {
      throw new PracticeGuideError('INVALID_VOCAL_PATH', '人聲檔案路徑無效。');
    }
    const filenamePath = path.resolve(downloadsDir, filename);
    if (!isInside(downloadsDir, filenamePath)) throw new PracticeGuideError('INVALID_VOCAL_PATH', '人聲檔案路徑無效。');
    let stat; let realRoot; let realFile;
    try {
      stat = await fs.promises.lstat(filenamePath);
      realRoot = await fs.promises.realpath(downloadsDir);
      realFile = await fs.promises.realpath(filenamePath);
    } catch (_) {
      throw new PracticeGuideError('VOCALS_MISSING', '已分離的人聲檔案不存在，請重新製作伴奏。', 409);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || !isInside(realRoot, realFile)) {
      throw new PracticeGuideError('INVALID_VOCAL_PATH', '人聲來源必須是媒體資料夾內的正常檔案。');
    }
    if (stat.size <= 0 || stat.size > MAX_SOURCE_BYTES) {
      throw new PracticeGuideError('VOCALS_SIZE_LIMIT', '人聲來源為空或超過練唱分析的 512 MB 上限。', 413);
    }
    return { trackId, filename: realFile, stat, statKey: `${realFile}|${stat.dev}|${stat.ino}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}` };
  }

  async function fingerprint(source, signal) {
    const memo = fingerprints.get(source.filename);
    if (memo && memo.statKey === source.statKey) return memo.sha256;
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(source.filename, { signal });
    for await (const chunk of input) hash.update(chunk);
    const after = await fs.promises.stat(source.filename);
    if (after.size !== source.stat.size || after.mtimeMs !== source.stat.mtimeMs || after.ctimeMs !== source.stat.ctimeMs) {
      throw new PracticeGuideError('VOCALS_CHANGED', '分析期間人聲檔案已改變，請重新建立音高。', 409);
    }
    const sha256 = hash.digest('hex');
    fingerprints.set(source.filename, { statKey: source.statKey, sha256 });
    if (fingerprints.size > 128) fingerprints.delete(fingerprints.keys().next().value);
    return sha256;
  }

  function cacheFile(trackId) {
    return path.join(cacheDir, `${crypto.createHash('sha256').update(trackId).digest('hex')}.json`);
  }

  async function lyricsFor(trackId) {
    const payload = sanitizeLyrics(await getLyrics(trackId));
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_LYRIC_BYTES) throw new PracticeGuideError('LYRICS_TOO_LARGE', '歌詞資料過大，無法建立練唱音高。', 413);
    return { payload, key: lyricsKeyFor(payload) };
  }

  async function readCache(source, algorithm, lyricsKey) {
    const filename = cacheFile(source.trackId);
    try {
      const stat = await fs.promises.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_GUIDE_BYTES) return null;
      const guide = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
      const sourceFingerprint = await fingerprint(source);
      if (!validateGuide(guide, { trackId: source.trackId, sourceFingerprint, requestedAlgorithm: algorithm })) return null;
      // 歌詞或偏移改過：舊音符位置已經不對，回報需要重建（不刪檔，重建成功才覆蓋）。
      if (lyricsKey && guide.lyricsKey !== lyricsKey) return { stale: true, guide };
      return guide;
    } catch (error) {
      if (error instanceof PracticeGuideError) throw error;
      return null;
    }
  }

  async function get(trackId) {
    const job = jobs.get(trackId);
    if (job && ACTIVE_STATES.has(job.status)) return { status: job.status, job: publicJob(job) };
    const source = await sourceFor(trackId);
    const { key } = await lyricsFor(trackId);
    const cached = await readCache(source, undefined, key);
    const guide = cached && !cached.stale ? cached : null;
    if (job && job.status !== 'completed') {
      return { status: job.status, job: publicJob(job), cachedGuideAvailable: Boolean(guide) };
    }
    if (cached && cached.stale) return { status: 'stale', reason: 'lyrics-changed' };
    if (guide) return { status: 'ready', guide };
    return { status: 'missing' };
  }

  function runProcess(command, args, job, stage, collectProgress = false) {
    return new Promise((resolve, reject) => {
      checkCancelled(job);
      let child; let stderr = ''; let stdout = ''; let failure = null; let settled = false; let killTimer;
      const controller = job.controller;
      const terminate = (error) => {
        failure = failure || error;
        try { child?.kill(); } catch (_) { /* close/error is still authoritative */ }
        if (!killTimer) {
          killTimer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch (_) { /* await close */ } }, 2000);
          killTimer.unref?.();
        }
      };
      const abort = () => terminate(new PracticeGuideError(job.timedOut ? 'GUIDE_TIMEOUT' : 'GUIDE_CANCELLED',
        job.timedOut ? '音高分析逾時，已停止工作。' : '音高分析已取消。', job.timedOut ? 504 : 409));
      const complete = (error) => {
        if (settled) return;
        settled = true; clearTimeout(killTimer); controller.signal.removeEventListener('abort', abort);
        job.child = null;
        if (error) reject(error); else resolve();
      };
      try {
        child = spawnImpl(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', OMP_NUM_THREADS: '1',
            MKL_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', NUMEXPR_NUM_THREADS: '1', CUDA_VISIBLE_DEVICES: '' } });
        job.child = child;
        controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) abort();
        child.stderr.on('data', (data) => { stderr = (stderr + data.toString('utf8')).slice(-4096); });
        child.stdout.on('data', (data) => {
          if (!collectProgress) return;
          stdout += data.toString('utf8');
          if (stdout.length > 65536) { terminate(new PracticeGuideError('GUIDE_INVALID_WORKER', '音高分析程序回傳過多資料。', 500)); stdout = ''; return; }
          let newline;
          while ((newline = stdout.indexOf('\n')) >= 0) {
            const line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1);
            try {
              const message = JSON.parse(line);
              if (message.type === 'progress' && !failure && !controller.signal.aborted) {
                job.progress = Math.max(12, Math.min(94, 12 + (Number(message.progress) || 0) * 0.9)); emitJob(job);
              } else if (message.type === 'error') {
                const known = ['GUIDE_TOO_LONG', 'PITCH_MODEL_UNAVAILABLE', 'GUIDE_ANALYSIS_FAILED'];
                failure = new PracticeGuideError(known.includes(message.code) ? message.code : 'GUIDE_ANALYSIS_FAILED',
                  message.code === 'PITCH_MODEL_UNAVAILABLE' ? '尚未安裝 torchcrepe tiny；請使用自動或 YIN 分析。' : '無法分析這份人聲音訊。', 422);
              }
            } catch (_) { /* dependency logs are bounded and not protocol events */ }
          }
        });
        child.once('error', (error) => {
          failure = failure || new PracticeGuideError(error.code === 'ENOENT' ? 'PRACTICE_RUNTIME_MISSING' : 'GUIDE_PROCESS_FAILED',
            stage === 'decode' ? '無法啟動 FFmpeg，請先檢查音訊元件。' : '無法啟動音高分析，請先安裝 AI 分離元件。', 503);
          // Node emits close after error too; don't dispatch another CPU child
          // before all handles of this child have closed.
        });
        child.once('close', (code) => {
          if (failure) return complete(failure);
          if (code !== 0) return complete(new PracticeGuideError(stage === 'decode' ? 'GUIDE_DECODE_FAILED' : 'GUIDE_ANALYSIS_FAILED',
            stage === 'decode' ? '無法讀取這份人聲音訊，請重新製作伴奏。' : '音高分析失敗，請檢查 AI 元件。', 422));
          complete();
        });
      } catch (error) { complete(error); }
    });
  }

  async function execute(job) {
    let stageDir;
    let outcome = { status: 'failed', stage: 'failed', code: 'GUIDE_ANALYSIS_FAILED', error: '音高分析失敗，請重新嘗試。' };
    const deadline = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, timeoutMs);
    deadline.unref?.();
    try {
      job.status = 'processing'; job.stage = 'hashing'; job.progress = 1; job.startedAt = new Date().toISOString(); emitJob(job);
      checkCancelled(job);
      const source = await sourceFor(job.trackId);
      const sourceFingerprint = await fingerprint(source, job.controller.signal);
      const lyrics = await lyricsFor(job.trackId);
      checkCancelled(job);
      await fs.promises.mkdir(cacheDir, { recursive: true });
      stageDir = await fs.promises.mkdtemp(path.join(cacheDir, '.job-'));
      const decodedPath = path.join(stageDir, 'vocal.wav');
      const outputPath = path.join(stageDir, 'guide.json');
      const lyricsPath = path.join(stageDir, 'lyrics.json');
      await fs.promises.writeFile(lyricsPath, JSON.stringify(lyrics.payload));
      job.stage = 'decoding'; job.progress = 5; emitJob(job);
      await runProcess(getFfmpeg(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', '-i', source.filename,
        '-map', '0:a:0', '-t', String(MAX_DURATION_SECONDS + 0.25), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', decodedPath], job, 'decode');
      checkCancelled(job);
      job.stage = 'analyzing'; job.progress = 12; emitJob(job);
      const workerPath = getWorkerPath();
      if (!fs.existsSync(workerPath)) throw new PracticeGuideError('PRACTICE_RUNTIME_MISSING', '音高分析元件尚未安裝，請更新程式。', 503);
      await runProcess(getPython(), [workerPath, '--input', decodedPath, '--output', outputPath, '--algorithm', job.algorithm, '--lyrics', lyricsPath], job, 'analysis', true);
      checkCancelled(job);
      const stat = await fs.promises.stat(outputPath);
      if (stat.size <= 0 || stat.size > MAX_GUIDE_BYTES) throw new PracticeGuideError('GUIDE_INVALID_OUTPUT', '音高資料超過大小限制。', 422);
      const guide = JSON.parse(await fs.promises.readFile(outputPath, 'utf8'));
      guide.trackId = job.trackId; guide.sourceFingerprint = sourceFingerprint; guide.requestedAlgorithm = job.algorithm;
      guide.createdAt = new Date().toISOString(); guide.lyricsKey = lyrics.key;
      guide.guideId = crypto.createHash('sha256').update([sourceFingerprint, job.algorithm, ALGORITHM_VERSION, lyrics.key].join('|')).digest('hex');
      if (!validateGuide(guide, { trackId: job.trackId, sourceFingerprint, lyricsKey: lyrics.key })) throw new PracticeGuideError('GUIDE_INVALID_OUTPUT', '音高資料不完整，沒有取代原有快取。', 422);
      const current = await sourceFor(job.trackId);
      if (current.statKey !== source.statKey || await fingerprint(current, job.controller.signal) !== sourceFingerprint) {
        throw new PracticeGuideError('VOCALS_CHANGED', '分析期間人聲檔案已更新，請重新建立音高。', 409);
      }
      checkCancelled(job);
      job.stage = 'saving'; job.progress = 96; emitJob(job);
      const tempFile = path.join(stageDir, 'validated.json');
      const file = await fs.promises.open(tempFile, 'wx');
      try { await file.writeFile(JSON.stringify(guide)); await file.sync(); } finally { await file.close(); }
      checkCancelled(job);
      await fs.promises.rename(tempFile, cacheFile(job.trackId));
      outcome = { status: 'completed', stage: 'done', progress: 100, guideId: guide.guideId };
    } catch (error) {
      const cancelled = !job.timedOut && (job.controller.signal.aborted || error.code === 'GUIDE_CANCELLED' || error.name === 'AbortError');
      const status = cancelled ? 'cancelled' : 'failed';
      outcome = { status, stage: status,
        code: job.timedOut ? 'GUIDE_TIMEOUT' : cancelled ? 'GUIDE_CANCELLED' : (error.code || 'GUIDE_ANALYSIS_FAILED'),
        error: job.timedOut ? '音高分析逾時，已停止工作。' : cancelled ? '音高分析已取消。' : (error instanceof PracticeGuideError ? error.message : '音高分析失敗，請重新嘗試。') };
    } finally {
      clearTimeout(deadline);
      // 暫存資料夾清完才公布最終狀態：否則外面一看到「失敗」立刻重試，會跟還沒刪完的暫存撞在一起。
      if (stageDir) await fs.promises.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      Object.assign(job, outcome);
      job.finishedAt = new Date().toISOString();
      emitJob(job);
    }
  }

  async function drain() {
    if (active || disposed) return;
    const next = queue.shift();
    if (!next) return;
    active = next;
    try { await execute(next); } finally { active = null; void drain(); }
  }

  async function startInternal(trackId, settings) {
    if (disposed) throw new PracticeGuideError('PRACTICE_CLOSED', '練唱分析已關閉。', 503);
    const algorithm = settings.algorithm || 'auto';
    if (!ALGORITHMS.has(algorithm)) throw new PracticeGuideError('INVALID_ALGORITHM', '不支援的音高分析方式。');
    const existing = jobs.get(trackId);
    if (existing && ACTIVE_STATES.has(existing.status)) return { status: existing.status, job: publicJob(existing) };
    const source = await sourceFor(trackId);
    if (settings.force !== true) {
      const { key } = await lyricsFor(trackId);
      const cached = await readCache(source, algorithm, key);
      const guide = cached && !cached.stale ? cached : null;
      if (guide) {
        jobs.delete(trackId);
        return { status: 'ready', guide, cacheHit: true };
      }
    }
    if (queue.length >= maxQueue) throw new PracticeGuideError('GUIDE_QUEUE_FULL', '練唱分析佇列已滿，請稍後再試。', 429);
    const job = { jobId: crypto.randomUUID(), trackId, algorithm, controller: new AbortController(), status: 'queued', stage: 'queued',
      progress: 0, createdAt: new Date().toISOString() };
    jobs.set(trackId, job);
    for (const [id, item] of jobs) {
      if (jobs.size <= 50) break;
      if (!ACTIVE_STATES.has(item.status)) jobs.delete(id);
    }
    queue.push(job); emitJob(job); void drain();
    return { status: job.status, job: publicJob(job) };
  }

  function start(trackId, settings = {}) {
    if (starting.has(trackId)) return starting.get(trackId);
    const promise = startInternal(trackId, settings).finally(() => starting.delete(trackId));
    starting.set(trackId, promise);
    return promise;
  }

  function cancel(trackId) {
    if (!validTrackId(trackId)) throw new PracticeGuideError('INVALID_TRACK_ID', '歌曲識別碼無效。');
    const job = jobs.get(trackId);
    if (!job || !ACTIVE_STATES.has(job.status)) return { cancelled: false };
    if (job === active) {
      job.status = 'cancelling'; job.stage = 'cancelling'; job.controller.abort(); emitJob(job);
    } else {
      const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
      job.controller.abort(); job.status = 'cancelled'; job.stage = 'cancelled'; job.code = 'GUIDE_CANCELLED';
      job.finishedAt = new Date().toISOString(); emitJob(job);
    }
    return { cancelled: true, job: publicJob(job) };
  }

  function dispose() {
    disposed = true;
    for (const job of jobs.values()) if (ACTIVE_STATES.has(job.status)) cancel(job.trackId);
    fingerprints.clear();
  }

  return { get, start, cancel, dispose, events, getActiveJobs: () => [...jobs.values()].filter((job) => ACTIVE_STATES.has(job.status)).map(publicJob) };
}

module.exports = { createPracticeGuideService, PracticeGuideError, validateGuide, validTrackId, lyricsKeyFor, sanitizeLyrics,
  SCHEMA_VERSION, ALGORITHM_VERSION, MAX_DURATION_SECONDS };
