'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWebgpuEngineWindow } = require('../electron/webgpu-engine-window');

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('lifecycle did not settle')), 500); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function fixture(t, hooks = {}) {
  const windows = [], errors = [], warnings = [];
  let attempts = 0;
  class Window extends EventEmitter {
    constructor(options) {
      super();
      attempts += 1;
      hooks.construct?.();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    loadURL(url) {
      this.url = url;
      return hooks.load?.(this) ?? Promise.resolve();
    }
    destroy() {
      hooks.destroy?.(this);
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
  }
  const engine = createWebgpuEngineWindow({
    BrowserWindow: Window, port: 39001,
    logger: { info() {}, warn(...args) { warnings.push(args); }, error(...args) { errors.push(args); } },
  });
  t.after(async () => {
    hooks.destroy = null;
    await engine.stop().catch(() => {});
    for (const window of windows) window.destroy();
  });
  return { engine, windows, errors, warnings, attempts: () => attempts, live: () => windows.filter(w => !w.destroyed) };
}

test('WebGPU: every start/stop cycle retires its own renderer', async t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i += 1) {
    await f.engine.start();
    assert.equal(f.live().length, 1);
    await f.engine.stop();
    assert.equal(f.live().length, 0);
    assert.equal(f.engine.getStatus().hasWindow, false);
  }
  assert.equal(f.windows.length, 3);
});

test('WebGPU: repeated restart always creates one fresh renderer', async t => {
  const f = fixture(t);
  await f.engine.start();
  for (let i = 0; i < 3; i += 1) {
    const old = f.windows.at(-1);
    await f.engine.restart();
    assert.equal(old.destroyed, true);
    assert.equal(f.live().length, 1);
    assert.notEqual(f.live()[0], old);
  }
  assert.equal(f.windows.length, 4);
});

test('WebGPU: an idle stop does not disable later startup', async t => {
  const f = fixture(t);
  await f.engine.stop();
  await f.engine.start();
  assert.equal(f.live().length, 1);
});

test('WebGPU: synchronous constructor failure can be retried', async t => {
  let fail = true;
  const f = fixture(t, { construct() { if (fail) throw new Error('constructor failed'); } });
  await assert.rejects(f.engine.start(), /constructor failed/);
  fail = false;
  await f.engine.start();
  assert.equal(f.attempts(), 2);
  assert.equal(f.live().length, 1);
});

test('WebGPU: rejected load is cleaned before startup retry', async t => {
  let fail = true;
  const f = fixture(t, { load() { return fail ? Promise.reject(new Error('load failed')) : Promise.resolve(); } });
  await assert.rejects(f.engine.start(), /load failed/);
  assert.equal(f.live().length, 0);
  fail = false;
  await f.engine.start();
  assert.equal(f.windows.length, 2);
  assert.equal(f.live().length, 1);
});

test('WebGPU: stop cancels a pending load and allows replacement immediately', async t => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = fixture(t, { load(w) { return f.windows.indexOf(w) === 0 ? gate.promise : Promise.resolve(); } });
  const oldStart = f.engine.start();
  oldStart.catch(() => {});
  await turn();
  await bounded(f.engine.stop());
  await bounded(f.engine.start());
  const replacement = f.windows[1];
  assert.ok(replacement);
  gate.reject(new Error('cancelled old load'));
  await oldStart.catch(() => {});
  assert.equal(replacement.destroyed, false);
  assert.deepEqual(f.live(), [replacement]);
});

test('WebGPU: restart replaces a wedged load without waiting for it', async t => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = fixture(t, { load(w) { return f.windows.indexOf(w) === 0 ? gate.promise : Promise.resolve(); } });
  const oldStart = f.engine.start();
  oldStart.catch(() => {});
  await turn();
  await bounded(f.engine.restart());
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[0].destroyed, true);
  gate.reject(new Error('old renderer exited'));
  await oldStart.catch(() => {});
  assert.deepEqual(f.live(), [f.windows[1]]);
});

test('WebGPU: explicit stop cancels a queued restart', async t => {
  const f = fixture(t);
  await f.engine.start();
  const restart = f.engine.restart();
  await f.engine.stop();
  await restart;
  assert.equal(f.live().length, 0);
  assert.equal(f.windows.length, 1);
});

test('WebGPU: concurrent starts queued behind stop share one replacement', async t => {
  const f = fixture(t);
  await f.engine.start();
  const stop = f.engine.stop();
  const starts = [f.engine.start(), f.engine.start(), f.engine.start()];
  await Promise.all([stop, ...starts]);
  assert.equal(f.windows.length, 2);
  assert.deepEqual(f.live(), [f.windows[1]]);
});

test('WebGPU: old completion cannot clear a newer pending startup', async t => {
  const gates = [deferred(), deferred()];
  t.after(() => gates.forEach(g => g.resolve()));
  const f = fixture(t, { load(w) { return gates[f.windows.indexOf(w)]?.promise ?? Promise.resolve(); } });
  const oldStart = f.engine.start();
  await turn();
  await f.engine.stop();
  const nextStart = f.engine.start();
  await turn();
  assert.equal(f.windows.length, 2);
  gates[0].resolve();
  await oldStart;
  let joined = false;
  const thirdStart = f.engine.start().then(() => { joined = true; });
  await turn();
  assert.equal(joined, false);
  assert.equal(f.windows.length, 2);
  gates[1].resolve();
  await Promise.all([nextStart, thirdStart]);
});

test('WebGPU: self-heal remains enabled after manual stop/start', async t => {
  const f = fixture(t);
  await f.engine.start();
  await f.engine.stop();
  await f.engine.start();
  const old = f.windows.at(-1);
  old.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await turn();
  assert.equal(f.windows.length, 3);
  assert.equal(old.destroyed, true);
  assert.equal(f.live().length, 1);
});

test('WebGPU: duplicate crash notifications share one recovery', async t => {
  const f = fixture(t);
  await f.engine.start();
  const old = f.windows[0];
  old.emit('unresponsive');
  old.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await turn();
  assert.equal(f.windows.length, 2);
  assert.equal(f.warnings.length, 1);
});

test('WebGPU: automatic recovery budget resets after five minutes', async t => {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  await f.engine.start();
  for (let i = 0; i < 3; i += 1) {
    f.windows.at(-1).emit('unresponsive');
    await turn();
  }
  assert.equal(f.windows.length, 4);
  f.windows.at(-1).emit('unresponsive');
  await turn();
  assert.equal(f.windows.length, 4);
  assert.equal(f.errors.length, 1);
  now += 5 * 60 * 1000 + 1;
  f.windows.at(-1).emit('unresponsive');
  await turn();
  assert.equal(f.windows.length, 5);
});

test('WebGPU: stale window events cannot stop or restart its replacement', async t => {
  const f = fixture(t);
  await f.engine.start();
  const old = f.windows[0];
  await f.engine.restart();
  old.emit('closed');
  old.emit('unresponsive');
  old.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await turn();
  assert.equal(f.windows.length, 2);
  assert.deepEqual(f.live(), [f.windows[1]]);
  assert.equal(f.engine.getStatus().hasWindow, true);
});

test('WebGPU: failed destruction blocks new windows until cleanup succeeds', async t => {
  let fail = true;
  const f = fixture(t, { destroy() { if (fail) throw new Error('destroy failed'); } });
  await f.engine.start();
  await assert.rejects(f.engine.stop(), /destroy failed/);
  await assert.rejects(f.engine.start(), /destroy failed/);
  assert.equal(f.windows.length, 1);
  fail = false;
  await f.engine.start();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[0].destroyed, true);
  assert.deepEqual(f.live(), [f.windows[1]]);
});

test('WebGPU: newest explicit restart wins over a cancelled restart', async t => {
  const f = fixture(t);
  await f.engine.start();
  const first = f.engine.restart();
  const stop = f.engine.stop();
  const last = f.engine.restart();
  await Promise.all([first, stop, last]);
  assert.equal(f.windows.length, 2);
  assert.deepEqual(f.live(), [f.windows[1]]);
});
