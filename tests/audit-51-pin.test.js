'use strict';

// 2026-11-13 全面抓蟲稽核的回歸測試。每一個 test 對應 PR 說明裡的一個問題編號。
const test = require('node:test');
const assert = require('node:assert/strict');

function vm_get(context, name) { return require('vm').runInContext(name, context); }

function loadBrowserScript(file, extraGlobals = {}) {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const context = {
    SharedUtils: { escapeHtml: (value) => String(value) },
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({}) },
    localStorage: { getItem: () => null, setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    URL,
    setTimeout,
    clearTimeout,
    ...extraGlobals,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8'), context);
  return context;
}

function loadAuditModule(relative, overrides = {}) {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const { createRequire } = require('module');
  const filename = path.resolve(__dirname, '..', relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: (id) => (Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id)),
    __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, URLSearchParams, AbortController, console,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    process: { env: process.env, platform: process.platform, cwd: () => process.cwd(), on() {} },
  }, { filename });
  return module.exports;
}

function auditImportFixture({ previous = null, lyricsResult } = {}) {
  const silent = new Proxy({}, { get: () => () => {} });
  const saved = [];
  const audio = loadAuditModule('server/services/audio-processor.js', {
    './lyrics-engine': {
      LyricsEngine: {
        resolveAppleMusicMetadata: async () => null,
        search: async () => lyricsResult,
        resolveOriginalArtist: async () => null,
      },
      DURATION_TOLERANCE: 5,
    },
    '../utils/logger': { createLogger: () => silent }, './ffmpeg-provider': {}, './import-temp-registry': {}, './ytdlp-updater': {},
    './library-store': {
      findByIdentity: () => null,
      getEntry: (id) => (previous && id === previous.id ? previous : null),
      rememberImport: (track) => saved.push(track),
    },
  });
  audio.downloadWithMetadata = () => ({
    metadata: Promise.resolve({ id: 'video123456', title: 'Artist - Song', duration: 120 }),
    completed: Promise.resolve({ filePath: '/tmp/video123456.m4a', outputDir: '/tmp' }),
    completeTempImport: () => {},
  });
  audio.resolveTrackIdentity = () => ({ artist: 'Artist', title: 'Song', confidence: 0.95 });
  audio.detectCover = () => false;
  audio.shouldResolveAppleMetadata = () => false;
  audio.measureLoudnessQueued = async () => -14;
  audio.renameToReadableFilename = () => 'Artist - Song.m4a';
  audio.requireDownloadedAudio = () => {};
  return { audio, saved };
}

test('#102 PIN：三個入口共用同一組失敗次數；改 PIN 後通知踢掉遠端控制端', () => {
  const limiter = require('../server/services/auth-rate-limiter');
  limiter.resetAll();
  assert.equal(limiter.keyForAddress('::ffff:192.168.1.5'), limiter.keyForAddress('192.168.1.5'));
  for (let i = 0; i < limiter.MAX_FAILURES; i += 1) limiter.recordFailure(limiter.keyForAddress('192.168.1.5'));
  assert.equal(limiter.status(limiter.keyForAddress('::ffff:192.168.1.5')).allowed, false, '換入口不能重新計次');
  limiter.resetAll();
  const fs = require('fs');
  const path = require('path');
  for (const file of ['server/routes/auth.js', 'server/middleware/require-pin.js', 'server/routes/socket-handler.js']) {
    assert.ok(fs.readFileSync(path.join(__dirname, '..', file), 'utf8').includes('keyForAddress('), `${file} 要用共用的 key`);
  }

  let saved = null;
  const store = loadAuditModule('server/services/auth-store.js', {
    './json-store': { createJsonStore: () => ({ load: () => saved, save: (v) => { saved = v; return true; }, remove: () => { saved = null; return true; }, getStatus: () => ({ writeBlocked: false }) }) },
    '../utils/logger': { createLogger: () => new Proxy({}, { get: () => () => {} }) },
    '../utils/app-paths': { dataDir: '/tmp' },
  });
  const events = [];
  store.onPinChanged((kind) => events.push(kind));
  assert.equal(store.setPin('1234', '').ok, true);
  assert.equal(store.setPin('5678', '0000').ok, false);
  assert.equal(store.setPin('5678', '1234').ok, true);
  assert.equal(store.clearPin('5678').ok, true);
  assert.deepEqual(events, ['set', 'set', 'clear']);
  assert.ok(fs.readFileSync(path.join(__dirname, '../server/routes/socket-handler.js'), 'utf8').includes('authStore.onPinChanged('));
});
