'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const flush = () => new Promise(setImmediate);

function loadModule(relative, overrides, globals = {}) {
  const filename = path.join(root, relative);
  const realRequire = createRequire(filename);
  const customRequire = (id) => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id);
  customRequire.resolve = realRequire.resolve;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: customRequire, module, exports: module.exports, __dirname: path.dirname(filename),
    __filename: filename, process, console, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    ...globals,
  }, { filename });
  return module.exports;
}

function shellHarness() {
  const requests = [];
  const timers = new Set();
  const windows = [];
  const handlers = new Map();
  let engineStarts = 0;
  let finishEngine;
  const engine = {
    start: () => { engineStarts++; return new Promise((resolve) => { finishEngine = resolve; }); },
    stop: async () => {},
  };
  const http = { get: (options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => request.emit('error', new Error('timeout'));
    requests.push({ options, answer(payload) {
      const response = new EventEmitter(); callback(response);
      response.emit('data', Buffer.from(JSON.stringify(payload))); response.emit('end');
    }, request });
    return request;
  } };
  const { createElectronShell } = loadModule('electron/shell.js', {
    http, './webgpu-engine-window': { createWebgpuEngineWindow: () => engine },
  }, {
    setInterval: () => { const timer = { unref() {} }; timers.add(timer); return timer; },
    clearInterval: (timer) => timers.delete(timer),
  });
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => true, whenReady: async () => {},
    getPath: () => path.join(root, '.local', 'startup-audit'), quit() {}, exit() {},
  });
  class FakeWindow extends EventEmitter {
    constructor() { super(); windows.push(this); this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} }); }
    async loadURL(url) { this.url = url; this.emit('ready-to-show'); }
    show() {} hide() {} focus() {} isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  const desktop = createElectronShell({
    app, BrowserWindow: FakeWindow, utilityProcess: { fork() { throw Error('unexpected fork'); } },
    dialog: { showErrorBox() {}, showMessageBoxSync() { return 0; } }, shell: { openExternal() {} },
    Tray: FakeTray, Menu: { buildFromTemplate: () => ({}) }, nativeImage: { createFromPath: () => ({}) },
    clipboard: { writeText() {} }, powerSaveBlocker: { start: () => 1, stop() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
    processObject: { env: {}, platform: 'win32' }, fsImpl: { mkdirSync() {} },
    probeHealthImpl: async () => ({ state: 'healthy', payload: { status: 'ok' } }),
  });
  return { desktop, app, requests, windows, timers, handlers, engineStarts: () => engineStarts, finishEngine: () => finishEngine?.() };
}

test('panel becomes usable while optional engine settings and load are pending', async () => {
  const h = shellHarness();
  const start = h.desktop.start();
  await flush();
  assert.equal(h.windows.length, 1);
  assert.match(h.windows[0].url, /\/panel\?/);
  assert.equal((await start).started, true);
  assert.equal(h.requests.length, 1);
  h.requests[0].answer({ enabled: true }); await flush();
  assert.equal(h.engineStarts(), 1);
  assert.equal(h.timers.size, 0);
  h.finishEngine(); await flush();
  assert.equal(h.timers.size, 1);
  await h.desktop.shutdown();
  assert.equal(h.timers.size, 0);
});

test('late startup settings cannot resurrect the engine after quit', async () => {
  const h = shellHarness(); await h.desktop.start();
  h.app.emit('before-quit', { preventDefault() {} });
  h.requests[0].answer({ enabled: true }); await flush();
  assert.equal(h.engineStarts(), 0);
  assert.equal(h.timers.size, 0);
});

test('late engine load cannot start a health timer after shutdown', async () => {
  const h = shellHarness(); await h.desktop.start();
  h.requests[0].answer({ enabled: true }); await flush();
  await h.desktop.shutdown(); h.finishEngine(); await flush();
  assert.equal(h.timers.size, 0);
});

test('explicit toggle supersedes a pending startup settings response', async () => {
  const h = shellHarness(); await h.desktop.start();
  const toggle = h.handlers.get('elitesand:webgpu-engine-toggle');
  await toggle({ sender: h.windows[0].webContents }, false);
  h.requests[0].answer({ enabled: true }); await flush();
  assert.equal(h.engineStarts(), 0);
  assert.equal(h.timers.size, 0);
});

test('optional settings failure does not reject successful panel startup', async () => {
  const h = shellHarness(); assert.equal((await h.desktop.start()).started, true);
  h.requests[0].request.emit('error', new Error('offline')); await flush();
  assert.equal(h.engineStarts(), 0);
});

function romanizerHarness() {
  let builds = 0;
  let complete;
  const tokenizer = { tokenize: (text) => [{ surface_form: text, reading: 'ネコ', pos: '名詞' }] };
  const romanizer = loadModule('server/services/romanizer.js', {
    kuromoji: { builder: () => ({ build: (callback) => { builds++; complete = callback; } }) },
    '../utils/logger': { createLogger: () => ({ warn() {}, info() {} }) },
  });
  return { romanizer, builds: () => builds, complete: (err) => complete(err, tokenizer), tokenizer };
}

test('loading romanizer and reading kana do not decompress the dictionary', async () => {
  const h = romanizerHarness(); assert.equal(h.builds(), 0);
  assert.equal((await h.romanizer.japaneseReadingAnalysis('ねこ')).phonetic, 'neko');
  assert.equal(h.builds(), 0);
});

test('concurrent first kanji readings share initialization and preserve readings', async () => {
  const h = romanizerHarness();
  const first = h.romanizer.japaneseReadingAnalysis('猫');
  const second = h.romanizer.japaneseReadingAnalysis('猫');
  assert.equal(h.builds(), 1); h.complete(null);
  assert.equal((await first).phonetic, 'neko');
  assert.equal((await second).phonetic, 'neko');
  assert.equal(await h.romanizer.getKuromojiTokenizer(), h.tokenizer);
  assert.equal(h.builds(), 1);
});

test('dictionary initialization retries after failure', async () => {
  const h = romanizerHarness();
  const first = h.romanizer.getKuromojiTokenizer();
  h.complete(new Error('temporary read failure'));
  await assert.rejects(first, /temporary read failure/);
  const second = h.romanizer.getKuromojiTokenizer();
  assert.equal(h.builds(), 2); h.complete(null);
  assert.equal(await second, h.tokenizer);
});
