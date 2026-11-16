'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Exercises the production import pipeline and both panel cleanup handlers.
// Only download/metadata/lyrics/loudness I/O is stubbed. All files, registry,
// library state, rename, cleanup decisions and missing-audio checks are real.
for (const registered of [true, false]) {
  test(`S-06: cleanup during a suspended lyrics lookup (${registered ? 'active import protected' : 'negative control'})`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-cleanup-race-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const script = `
      const assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
      const audio = require('./server/services/audio-processor');
      const { LyricsEngine: lyrics } = require('./server/services/lyrics-engine');
      const registry = require('./server/services/import-temp-registry');
      const library = require('./server/services/library-store');
      const wireLibrary = require('./server/routes/handlers/library');
      const media = process.env.ELITESAND_DOWNLOADS_DIR;
      const id = 'AAAAAAAAAAA', url = 'https://youtu.be/' + id, original = id + '.mp3';
      fs.mkdirSync(media, { recursive: true });
      // A previous library-only import points at missing audio, so reimport is
      // needed and cleanup really considers this filename eligible for deletion.
      library.rememberImport({ id, title: '稻香', artist: '周杰倫', filename: original, url });
      let releaseLyrics, startedLyrics;
      const started = new Promise(resolve => { startedLyrics = resolve; });
      lyrics.search = () => { startedLyrics(); return new Promise(resolve => { releaseLyrics = resolve; }); };
      lyrics.resolveAppleMusicMetadata = async () => null;
      lyrics.resolveOriginalArtist = async () => null;
      audio.measureLoudnessQueued = async () => -12;
      let token = null;
      audio.downloadWithMetadata = () => {
        if (${registered}) token = registry.begin(id);
        const filePath = path.join(media, original);
        fs.writeFileSync(filePath, Buffer.alloc(4096, 7));
        return { metadata: Promise.resolve({ id, title: '周杰倫 - 稻香', track: '稻香', artist: '周杰倫',
          artists: ['周杰倫'], duration: 223, channel: 'fixture', description: '' }),
          completed: Promise.resolve({ filePath, outputDir: media, downloadMs: 1 }),
          completeTempImport: () => { if (token) registry.finish(token); } };
      };
      const handlers = {}, socket = { on: (event, fn) => { handlers[event] = fn; },
        handshake: { address: '127.0.0.1' }, emit() {} };
      const io = { to: () => ({ emit() {} }), emit() {} };
      wireLibrary(io, socket, { playState: { playlist: [], currentTrack: null },
        onLibraryChanged() {}, getLibrary: () => library.getLibrary() });
      const request = event => new Promise(resolve => handlers[event]({}, resolve));
      (async () => {
        const importing = audio.processYouTube(url, { requestId: 'cleanup-race' });
        importing.catch(() => {});
        await started;
        assert.equal(fs.existsSync(path.join(media, original)), true);
        const preview = await request('library:cleanupAudioPreview');
        assert.equal(fs.existsSync(path.join(media, original)), true, 'preview is read-only');
        const cleanup = await request('library:cleanupAudio');
        const existsDuringLookup = fs.existsSync(path.join(media, original));
        releaseLyrics({ type: 'lrc', lyrics: '[00:01]test', parsedLyrics: [{ time: 1000, text: 'test' }] });
        let imported = null, error = null;
        try { imported = await importing; } catch (failure) { error = failure.message; }
        const existsAtSuccess = imported ? fs.existsSync(path.join(media, imported.filename)) : false;
        console.log('RESULT:' + JSON.stringify({ preview, cleanup, existsDuringLookup, existsAtSuccess,
          imported: !!imported, error, entries: Object.keys(registry.getEntries()) }));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 15000,
      env: { ...process.env, ELITESAND_DATA_DIR: path.join(root, 'data'),
        ELITESAND_DOWNLOADS_DIR: path.join(root, 'media'), ELITESAND_LOGS_DIR: path.join(root, 'logs') },
    });
    const value = JSON.parse(output.split('RESULT:')[1].split('\n')[0]);
    assert.equal(value.preview.ok, true);
    assert.equal(value.cleanup.ok, true);
    if (registered) {
      assert.equal(value.preview.deleted, 0);
      assert.equal(value.cleanup.deleted, 0);
      assert.equal(value.existsDuringLookup, true);
      assert.equal(value.imported, true);
      assert.equal(value.existsAtSuccess, true);
      assert.equal(value.error, null);
      assert.deepEqual(value.entries, [], 'success releases its active-import protection');
    } else {
      assert.equal(value.preview.deleted, 1, 'the race fixture actually reaches an eligible file');
      assert.equal(value.cleanup.deleted, 1);
      assert.equal(value.existsDuringLookup, false);
      assert.equal(value.imported, false, 'missing audio must never be reported as successful');
      assert.ok(value.error);
      assert.deepEqual(value.entries, []);
    }
  });
}

test('download completion requires a nonempty regular file in the actual output directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audio-validation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = `
    const assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
    const audio = require('./server/services/audio-processor'), output = process.env.ELITESAND_DOWNLOADS_DIR;
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'valid.mp3'), Buffer.alloc(32, 1));
    fs.writeFileSync(path.join(output, 'empty.mp3'), '');
    fs.mkdirSync(path.join(output, 'directory.mp3'));
    for (const name of [null, 'missing.mp3', 'empty.mp3', 'directory.mp3', '../outside.mp3']) {
      assert.throws(() => audio.requireDownloadedAudio(name, output));
    }
    assert.equal(audio.requireDownloadedAudio('valid.mp3', output), 'valid.mp3');
    console.log('validated actual files');
  `;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, ELITESAND_DATA_DIR: path.join(root, 'data'),
      ELITESAND_DOWNLOADS_DIR: path.join(root, 'media'), ELITESAND_LOGS_DIR: path.join(root, 'logs') } });
  assert.match(output, /validated actual files/);
});
