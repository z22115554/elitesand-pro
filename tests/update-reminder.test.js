'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { optionalUpdateChoice, recordUpdateReminder, REMIND_THREE_DAYS, THREE_DAYS_MS } = require('../electron/update-reminder');
const { FILE_NAME, SCHEMA_VERSION, createStartupUpdateDeferStore } = require('../electron/startup-update-defer-store');

test('all three buttons and closing the native dialog have distinct reminder semantics', () => {
  assert.equal(optionalUpdateChoice(0), 'accept');
  assert.equal(optionalUpdateChoice(1), 'defer');
  assert.equal(optionalUpdateChoice(2), REMIND_THREE_DAYS);
  assert.equal(optionalUpdateChoice(undefined), 'defer');
  assert.equal(optionalUpdateChoice(-1), 'defer');
});

test('old implicit seven-day defers are discarded; explicit snoozes persist across processes and Later clears them', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-reminder-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, FILE_NAME);
  const nowMs = Date.parse('2026-10-15T07:00:00.000Z');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries: { '1.1.0': nowMs + 7 * 86400000 } }));
  const first = createStartupUpdateDeferStore(root);
  assert.equal(first.getDeferUntil('1.1.0'), null, 'upgrade must not retain an old implicit seven-day delay');
  recordUpdateReminder({ choice: REMIND_THREE_DAYS, targetVersion: '1.1.0', deferStore: first, nowMs });
  const second = createStartupUpdateDeferStore(root);
  assert.equal(second.getDeferUntil('1.1.0'), nowMs + THREE_DAYS_MS);
  assert.equal(second.getDeferUntil('1.1.1'), null);
  assert.equal(JSON.parse(fs.readFileSync(file)).schemaVersion, SCHEMA_VERSION);
  recordUpdateReminder({ choice: 'defer', targetVersion: '1.1.0', deferStore: second, nowMs });
  assert.equal(createStartupUpdateDeferStore(root).getDeferUntil('1.1.0'), null, 'manual Later cancels an earlier three-day snooze');
});

test('corrupt reminder data and write failures do not prevent normal startup', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-reminder-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, FILE_NAME), '{broken');
  const store = createStartupUpdateDeferStore(root);
  assert.equal(store.getDeferUntil('1.1.0'), null);
  const unwritable = createStartupUpdateDeferStore(root, { fsImpl: {
    readFileSync: () => { throw new Error('unreadable'); }, mkdirSync: () => { throw new Error('read-only'); },
  } });
  assert.equal(recordUpdateReminder({ choice: REMIND_THREE_DAYS, targetVersion: '1.1.0', deferStore: unwritable }), false);
  assert.equal(recordUpdateReminder({ choice: 'defer', targetVersion: '1.1.0', deferStore: unwritable }), false);
});

test('real Electron shell manual dialog wires all three buttons to update, next launch, and a persisted three-day reminder', async (t) => {
  const { EventEmitter } = require('node:events');
  const { createElectronShell } = require('../electron/shell');
  const { attachManualUpdateCheckCoordinator } = require('../server/services/manual-update-check-coordinator');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-reminder-shell-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const child = new EventEmitter();
  const parentPort = new EventEmitter();
  child.pid = 4321;
  child.postMessage = (message) => parentPort.emit('message', { data: message });
  child.kill = () => {};
  parentPort.postMessage = (message) => child.emit('message', { data: message });
  let accepts = 0;
  const coordinator = attachManualUpdateCheckCoordinator({ parentPort, provider: {
    check: async () => ({ kind: 'plan', plan: { planId: 'manual-reminder-plan', targetVersion: '1.1.1', urgency: 'optional', delivery: 'incremental' } }),
    acceptIncremental: async () => { accepts++; return { ok: false }; },
    openRequiredInstaller: async () => ({ ok: false }),
  }, getProgress: () => ({ phase: 'failed' }) });
  t.after(() => coordinator.detach());
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false, setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
    whenReady: async () => {}, getPath: () => root, getLocale: () => 'zh-TW', quit() {}, exit() {},
  });
  let window;
  class FakeWindow extends EventEmitter {
    constructor() { super(); window = this; this.webContents = { setWindowOpenHandler() {}, on() {}, isDestroyed: () => false }; }
    async loadURL() { this.emit('ready-to-show'); }
    show() {} hide() {} focus() {} isMinimized() { return false; }
  }
  class FakeTray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  const handlers = new Map();
  let response = 2;
  let prompts = 0;
  let probes = 0;
  const desktop = createElectronShell({
    app, BrowserWindow: FakeWindow, utilityProcess: { fork: () => child },
    dialog: { showErrorBox() {}, showMessageBox: async (options) => {
      assert.deepEqual(options.buttons, ['更新', '稍後', '三天後提醒我']);
      assert.equal(options.cancelId, 1);
      prompts++;
      return { response };
    } },
    shell: { openExternal() {} }, Tray: FakeTray, Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({}) }, clipboard: { writeText() {} },
    powerSaveBlocker: { start: () => 1, stop() {} },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
    processObject: { env: {}, platform: 'win32' },
    probeHealthImpl: async () => (++probes === 1 ? { state: 'free' } : { state: 'healthy', payload: { status: 'ok' } }),
    delay: async () => {},
  });
  await desktop.start();
  t.after(() => desktop.shutdown());
  // Enter the packaged manual-check branch after starting a source harness;
  // no real Electron executable, server, download or user profile is touched.
  app.isPackaged = true;
  const check = () => handlers.get('elitesand:cloudflare-update-check')({ sender: window.webContents });
  const before = Date.now();
  assert.equal((await check()).status, 'declined');
  const store = createStartupUpdateDeferStore(root);
  assert.ok(store.getDeferUntil('1.1.1') >= before + THREE_DAYS_MS);
  response = 1;
  assert.equal((await check()).status, 'declined');
  assert.equal(store.getDeferUntil('1.1.1'), null);
  response = 0;
  assert.equal((await check()).status, 'accept-failed');
  assert.equal(accepts, 1);
  assert.equal(prompts, 3);
});
