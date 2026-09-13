'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const ffmpegProvider = require('../server/services/ffmpeg-provider');
const aiRuntimeProvider = require('../server/services/ai-runtime-provider');
const updaterRunner = require('../server/services/app-updater-runner-v2');
const registerSetlistHandlers = require('../server/routes/handlers/setlist');

test('#15 Unicode path: FFmpeg pipe fallback never passes media paths in argv', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'esp-unicode-path-'));
  const unicodeDir = path.join(root, '歌詞效果　測試');
  fs.mkdirSync(unicodeDir, { recursive: true });
  const inputPath = path.join(unicodeDir, '歌曲.webm');
  fs.writeFileSync(inputPath, Buffer.from('fake-webm'));

  let receivedArgs = null;
  const spawnImpl = (_command, args) => {
    receivedArgs = args.slice();
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.on('finish', () => {
      child.stdout.end(Buffer.from('fake-mp3'));
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };

  try {
    const outputPath = await ffmpegProvider.transcodeMp3ThroughPipes(inputPath, null, { spawnImpl, timeoutMs: 2000 });
    assert.equal(outputPath, path.join(unicodeDir, '歌曲.mp3'));
    assert.deepEqual(fs.readFileSync(outputPath), Buffer.from('fake-mp3'));
    assert.equal(fs.existsSync(inputPath), false);
    assert.equal(receivedArgs.includes(inputPath), false);
    assert.equal(receivedArgs.includes(outputPath), false);
    assert.equal(receivedArgs[receivedArgs.indexOf('-i') + 1], 'pipe:0');
    assert.equal(receivedArgs.at(-1), 'pipe:1');
    assert.equal(ffmpegProvider.isIllegalByteSequenceError(new Error('Error opening input files: Illegal byte sequence')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#17 AI model: interrupted download artifacts are removed before retry', (t) => {
  // Never let a regression test touch a developer's real downloaded model.
  if (fs.existsSync(aiRuntimeProvider.MODEL_FILE)) {
    t.skip('A real AI model already exists in this checkout.');
    return;
  }

  fs.mkdirSync(aiRuntimeProvider.MODEL_DIR, { recursive: true });
  const partial = `${aiRuntimeProvider.MODEL_FILE}.part`;
  fs.writeFileSync(partial, Buffer.from('partial-model'));
  try {
    assert.equal(aiRuntimeProvider.cleanupInvalidPrimaryModel(), true);
    assert.equal(fs.existsSync(partial), false);
  } finally {
    try { fs.unlinkSync(partial); } catch (_) {}
  }
});

test('#16 updater: handoff waits for both Electron host and launching server', async () => {
  const calls = [];
  await updaterRunner.waitForUpdateOwnersToExit(
    { parentPid: 111, waitTimeoutMs: 4321 },
    {
      launcherPid: 222,
      waitForExitImpl: async (pid, timeoutMs) => { calls.push([pid, timeoutMs]); },
    },
  );
  assert.deepEqual(calls, [[111, 4321], [222, 4321]]);

  calls.length = 0;
  await updaterRunner.waitForUpdateOwnersToExit(
    { parentPid: 111, waitTimeoutMs: 4321 },
    {
      launcherPid: 111,
      waitForExitImpl: async (pid, timeoutMs) => { calls.push([pid, timeoutMs]); },
    },
  );
  assert.deepEqual(calls, [[111, 4321]]);
  assert.equal(updaterRunner.FILE_LOCK_RETRY_MS, 30000);
});

function createSetlistHarness(playStateOverrides = {}) {
  const handlers = new Map();
  const socket = { on(name, fn) { handlers.set(name, fn); }, emit() {} };
  const ioEvents = [];
  const io = { emit(name, payload) { ioEvents.push([name, payload]); } };
  const playState = {
    playedEntryIds: new Set(['old-1', 'old-2']),
    lastPlayedEntryId: 'old-2',
    currentTrack: null,
    currentTrackStarted: false,
    isPlaying: false,
    playlist: [],
    setlistTheme: 'glass',
    setlistLayout: 'classic',
    ...playStateOverrides,
  };
  const session = { active: true, startedAt: Date.now() - 1000, source: 'manual', songs: [{ id: 'old-song' }] };
  let persisted = 0;
  let broadcasted = 0;
  let setlistEmits = 0;
  const ctx = {
    playState,
    session,
    effSetlistStore: () => ({}),
    persistState: () => { persisted += 1; },
    setlistPayload: () => ({}),
    emitSetlist: () => { setlistEmits += 1; },
    recordSessionSong: () => {},
    markTrackPlayed: (track) => {
      if (track?.entryId) {
        playState.playedEntryIds.add(track.entryId);
        playState.lastPlayedEntryId = track.entryId;
      }
    },
    broadcastState: () => { broadcasted += 1; },
  };
  registerSetlistHandlers(io, socket, ctx);
  return { handlers, playState, session, ioEvents, metrics: () => ({ persisted, broadcasted, setlistEmits }) };
}

test('#18 setlist: session reset clears persisted playedEntryIds', () => {
  const h = createSetlistHarness();
  h.handlers.get('session:reset')();
  assert.equal(h.session.active, false);
  assert.equal(h.session.startedAt, null);
  assert.equal(h.session.source, null);
  assert.deepEqual(h.session.songs, []);
  assert.equal(h.playState.playedEntryIds.size, 0);
  assert.equal(h.playState.lastPlayedEntryId, null);
  assert.deepEqual(h.metrics(), { persisted: 1, broadcasted: 1, setlistEmits: 1 });
});

test('#18 setlist: a genuinely new session clears old progress but keeps an already-started current track', () => {
  const currentTrack = { id: 'current-song', entryId: 'current-entry', title: 'Current' };
  const h = createSetlistHarness({
    currentTrack,
    currentTrackStarted: true,
    isPlaying: false,
  });
  h.handlers.get('session:start')({ source: 'manual' });
  assert.deepEqual([...h.playState.playedEntryIds], ['current-entry']);
  assert.equal(h.playState.lastPlayedEntryId, 'current-entry');
  assert.deepEqual(h.session.songs, []);
});
