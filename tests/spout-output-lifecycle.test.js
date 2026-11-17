'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSpoutDisplayOutput } = require('../electron/spout-display-output');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function fixture(t, hooks = {}) {
  const windows = [], timers = [], calls = { creates: 0, sends: 0, stops: 0 };
  t.mock.method(global, 'setInterval', callback => {
    const timer = { callback, active: true, unref() {} };
    timers.push(timer);
    return timer;
  });
  t.mock.method(global, 'clearInterval', timer => { if (timer) timer.active = false; });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      hooks.construct?.();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setFrameRate = () => {};
      this.index = windows.length;
      windows.push(this);
    }
    setPosition() {}
    setContentSize() {}
    loadURL(url) { this.url = url; return hooks.load?.(this) || Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  }
  const addon = {
    create() { calls.creates++; },
    send(info) { calls.sends++; return hooks.send?.(info) || { accepted: true }; },
    stop() { calls.stops++; hooks.stop?.(); return { state: 'idle' }; },
    getStatus() {
      return hooks.status?.() || { framesSent: calls.sends, framesDropped: 0, sourceCopyCompletedSequence: 0 };
    },
  };
  const errors = [];
  const output = createSpoutDisplayOutput({
    BrowserWindow, addon, port: 3017,
    logger: { error: (...args) => errors.push(args) },
    onWindowCreated: window => hooks.created?.(window, output),
    onFrame: (...args) => hooks.frame?.(...args),
  });
  t.after(async () => {
    hooks.status = null; hooks.stop = null;
    await output.stop().catch(() => {});
    for (const window of windows) window.destroy();
  });
  return { output, addon, windows, calls, hooks, timers, errors };
}

function texture(width = 1920, height = 1080) {
  let releases = 0;
  return {
    textureInfo: { codedSize: { width, height }, pixelFormat: 'bgra', handle: { ntHandle: Buffer.alloc(8) } },
    release() { releases++; },
    get releases() { return releases; },
  };
}
function paint(window, value = texture()) {
  window.webContents.emit('paint', { texture: value });
  return value;
}

test('Spout can start and stop three times without keeping a sender or renderer alive', async t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) {
    await f.output.start();
    paint(f.windows.at(-1));
    await f.output.stop();
    assert.equal(f.output.getStatus().state, 'idle');
    assert.equal(f.output.getStatus().hasWindow, false);
  }
  assert.equal(f.calls.creates, 3);
  assert.equal(f.calls.stops, 3);
  assert(f.windows.every(window => window.destroyed));
});

test('concurrent stop calls share cleanup, and a later stop performs fresh cleanup', async t => {
  const f = fixture(t);
  await f.output.start(); paint(f.windows[0]);
  const a = f.output.stop(), b = f.output.stop(), c = f.output.stop();
  await Promise.all([a, b, c]);
  assert.equal(f.calls.stops, 1);
  await f.output.start(); paint(f.windows[1]);
  await f.output.stop();
  assert.equal(f.calls.stops, 2);
  assert(f.windows.every(window => window.destroyed));
});

test('a failed native stop retains unacknowledged textures and can be retried', async t => {
  let fail = true;
  const f = fixture(t, {
    send: () => ({ accepted: true, deferredRelease: true, sourceSequence: 1 }),
    stop: () => { if (fail) throw new Error('native cleanup failed'); },
  });
  await f.output.start();
  const pending = paint(f.windows[0]);
  assert.equal(pending.releases, 0);
  await assert.rejects(f.output.stop(), /native cleanup failed/);
  assert.equal(pending.releases, 0, 'failed stop is not permission to recycle a source');
  assert.equal(f.output.getStatus().state, 'error');
  fail = false;
  await f.output.stop();
  assert.equal(f.calls.stops, 2);
  assert.equal(pending.releases, 1);
  assert.equal(f.output.getStatus().state, 'idle');
});

test('two starts waiting for one stop create only one replacement renderer', async t => {
  const f = fixture(t);
  await f.output.start(); paint(f.windows[0]);
  const stop = f.output.stop();
  const a = f.output.start(), b = f.output.start();
  await Promise.all([stop, a, b]);
  assert.equal(f.windows.length, 2);
  paint(f.windows[1]);
  assert.equal(f.calls.creates, 2);
  assert.equal(f.output.getStatus().state, 'running');
});
test('followup: restarting after a size error retires the failed renderer first', async t => {
  const f = fixture(t);
  await f.output.start();
  paint(f.windows[0], texture(1280, 720));
  assert.equal(f.output.getStatus().state, 'error');
  await f.output.start();
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows.filter(window => !window.destroyed).length, 1);
  paint(f.windows[1]);
  assert.equal(f.output.getStatus().state, 'running');
});

test('followup: failed native cleanup blocks restart and retains the accepted source', async t => {
  const f = fixture(t, {
    send: () => ({ accepted: true, deferredRelease: true, sourceSequence: 1 }),
    stop: () => { throw new Error('native cleanup is not confirmed'); },
  });
  await f.output.start();
  const source = paint(f.windows[0]);
  await assert.rejects(f.output.stop(), /not confirmed/);
  await assert.rejects(f.output.start(), /not confirmed/);
  assert.equal(f.windows.length, 1, 'no replacement may use the uncleared native sender');
  assert.equal(source.releases, 0);
  assert.equal(f.calls.creates, 1);
  assert.equal(f.calls.sends, 1);
  assert.equal(f.output.getStatus().state, 'error');
});

test('followup: restart retries cleanup successfully before creating a fresh sender', async t => {
  let fail = true;
  const f = fixture(t, {
    send: () => ({ accepted: true, deferredRelease: true, sourceSequence: 1 }),
    stop: () => { if (fail) throw new Error('still busy'); },
  });
  await f.output.start();
  const oldSource = paint(f.windows[0]);
  await assert.rejects(f.output.stop(), /still busy/);
  fail = false;
  await f.output.start();
  assert.equal(oldSource.releases, 1, 'a confirmed stop must retire the previous source before restart');
  paint(f.windows[1]);
  assert.equal(f.calls.creates, 2);
  assert.equal(f.output.getStatus().state, 'running');
});

test('followup: concurrent recovery requests retire the failed window and share one replacement', async t => {
  const f = fixture(t);
  await f.output.start();
  paint(f.windows[0], texture(1280, 720));
  await Promise.all([f.output.start(), f.output.start(), f.output.start()]);
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows.filter(window => !window.destroyed).length, 1);
  paint(f.windows[1]);
  assert.equal(f.output.getStatus().state, 'running');
});

test('followup: recovery from a polling error safely drains the old source and renderer', async t => {
  let statusFails = false;
  const f = fixture(t, {
    send: () => ({ accepted: true, deferredRelease: true, sourceSequence: 1 }),
    status: () => { if (statusFails) throw new Error('poll failed'); return { sourceCopyCompletedSequence: 0 }; },
  });
  await f.output.start();
  const source = paint(f.windows[0]);
  statusFails = true;
  f.timers[0].callback();
  statusFails = false;
  await f.output.start();
  assert.equal(source.releases, 1);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows.filter(window => !window.destroyed).length, 1);
  paint(f.windows[1]);
  assert.equal(f.calls.creates, 2);
  assert.equal(f.output.getStatus().state, 'running');
});

test('an aborted old load cannot block a replacement or erase its pending start', async t => {
  const loads = [deferred(), deferred()];
  const f = fixture(t, { load: window => loads[window.index].promise });
  t.after(() => loads.forEach(load => load.resolve()));
  const old = f.output.start(); old.catch(() => {});
  await f.output.stop();
  const replacement = f.output.start(); replacement.catch(() => {});
  assert.equal(f.windows.length, 2, 'stop cancels a pending startup without awaiting its load');
  loads[0].reject(new Error('ERR_ABORTED from the old renderer'));
  await old;
  const joined = f.output.start(); joined.catch(() => {});
  assert.equal(f.windows.length, 2, 'late completion must not clear the new startup');
  loads[1].resolve();
  await Promise.all([replacement, joined]);
  paint(f.windows[1]);
  assert.equal(f.output.getStatus().state, 'running');
  assert.equal(f.calls.creates, 1);
  assert.equal(f.calls.stops, 0);
});

test('a late closed event from an old window cannot stop a replacement', async t => {
  const f = fixture(t);
  await f.output.start(); paint(f.windows[0]);
  await f.output.stop();
  await f.output.start(); paint(f.windows[1]);
  const before = f.calls.stops;
  f.windows[0].emit('closed');
  assert.equal(f.calls.stops, before);
  assert.equal(f.output.getStatus().state, 'running');
  assert.equal(f.output.getStatus().hasWindow, true);
});

test('late paint from an old window is released without submitting it to the new sender', async t => {
  const f = fixture(t);
  await f.output.start(); paint(f.windows[0]);
  await f.output.stop();
  await f.output.start(); paint(f.windows[1]);
  const before = { ...f.calls };
  const stale = paint(f.windows[0], texture(1280, 720));
  assert.equal(stale.releases, 1);
  assert.deepEqual(f.calls, before);
  assert.equal(f.output.getStatus().state, 'running');
});

test('an accepted source is retained if status fails before observers run and stop also fails', async t => {
  let statusFailed = false, stopFailed = true;
  const f = fixture(t, {
    send: () => { statusFailed = true; return { accepted: true, deferredRelease: true, sourceSequence: 1 }; },
    status: () => { if (statusFailed) throw new Error('status read failed'); return { sourceCopyCompletedSequence: 0 }; },
    stop: () => { if (stopFailed) throw new Error('stop failed'); },
  });
  await f.output.start();
  const source = paint(f.windows[0]);
  assert.equal(source.releases, 0);
  statusFailed = false; stopFailed = false;
  await f.output.stop();
  assert.equal(source.releases, 1);
});

test('an observer failure cannot force-release a texture while native stop is failing', async t => {
  let fail = true;
  const f = fixture(t, {
    send: () => ({ accepted: true, deferredRelease: true, sourceSequence: 1 }),
    frame: () => { throw new Error('observer failed'); },
    stop: () => { if (fail) throw new Error('still using the source'); },
  });
  await f.output.start();
  const source = paint(f.windows[0]);
  assert.equal(source.releases, 0);
  assert.equal(f.output.getStatus().lastError.message, 'observer failed');
  fail = false;
  await f.output.stop();
  assert.equal(source.releases, 1);
});

test('background status errors are contained and leave source textures retained for safe cleanup', async t => {
  let fail = false;
  const f = fixture(t, {
    send: () => ({ accepted: true, deferredRelease: true, sourceSequence: 1 }),
    status: () => { if (fail) throw new Error('poll failed'); return { sourceCopyCompletedSequence: 0 }; },
  });
  await f.output.start();
  const source = paint(f.windows[0]);
  assert.equal(f.timers.length, 1);
  fail = true;
  assert.doesNotThrow(() => f.timers[0].callback());
  assert.equal(f.timers[0].active, false);
  assert.equal(source.releases, 0);
  fail = false;
  assert.equal(f.output.getStatus().lastError.message, 'poll failed');
  await f.output.stop();
  assert.equal(source.releases, 1);
});

test('synchronous startup failure clears its promise so the output can be started again', async t => {
  let fail = true;
  const f = fixture(t, { construct: () => { if (fail) throw new Error('window construction failed'); } });
  await assert.rejects(f.output.start(), /window construction failed/);
  fail = false;
  await f.output.start();
  paint(f.windows[0]);
  assert.equal(f.output.getStatus().state, 'running');
  assert.equal(f.calls.creates, 1);
});

test('closing a window before its load finishes cancels that generation and allows a fresh start', async t => {
  const load = deferred();
  const f = fixture(t, { load: window => window.index === 0 ? load.promise : Promise.resolve() });
  t.after(() => load.resolve());
  const old = f.output.start(); old.catch(() => {});
  f.windows[0].destroy();
  assert.equal(f.output.getStatus().state, 'idle');
  await f.output.start();
  paint(f.windows[1]);
  load.reject(new Error('closed before load completed'));
  await old;
  assert.equal(f.output.getStatus().state, 'running');
});

test('a synchronous creation hook may cancel startup without leaving its promise cached', async t => {
  let cancel = true, stopping;
  const f = fixture(t, { created: (_window, output) => { if (cancel) stopping = output.stop(); } });
  await f.output.start(); await stopping;
  assert.equal(f.output.getStatus().state, 'idle');
  cancel = false;
  await f.output.start();
  paint(f.windows.at(-1));
  assert.equal(f.output.getStatus().state, 'running');
});
