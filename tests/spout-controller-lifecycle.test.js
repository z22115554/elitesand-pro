'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createSpoutOutputController } = require('../electron/spout-output-controller');

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
function turn() { return new Promise(resolve => setImmediate(resolve)); }

function fixture(hooks = {}) {
  const calls = [], statuses = [];
  const addon = {
    create(options) { calls.push('create'); return hooks.create?.(options); },
    stop() { calls.push('stop'); return hooks.stop?.(); },
    getStatus() { return { state: 'mock' }; },
  };
  const controller = createSpoutOutputController({
    loadAddon() { calls.push('load'); hooks.load?.(); return addon; },
    onStatus(status) { statuses.push(status); hooks.status?.(status); },
  });
  return { controller, calls, statuses };
}

test('Spout controller: idle stop followed by start settles without microtask starvation', () => {
  // The old defect starves timers and can exhaust memory. Bound it in a child
  // process so a regression cannot hang or exhaust the complete test runner.
  const modulePath = require.resolve('../electron/spout-output-controller');
  const code = `
    const { createSpoutOutputController } = require(${JSON.stringify(modulePath)});
    let creates = 0, stops = 0;
    const c = createSpoutOutputController({ loadAddon: () => ({
      create() { creates++; }, stop() { stops++; }, getStatus() { return {}; }
    }) });
    (async () => {
      for (let i = 0; i < 3; i++) {
        await c.stop();
        await c.start();
        if (c.getStatus().state !== 'running') throw new Error('not running');
        await c.stop();
      }
      if (creates !== 3 || stops !== 3) throw new Error('wrong lifecycle counts');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', code], {
    timeout: 1500, encoding: 'utf8', maxBuffer: 16384,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr.slice(-1200));
});

test('Spout controller: synchronous addon load failure can be retried', async () => {
  let fail = true;
  const f = fixture({ load() { if (fail) throw new Error('load failed'); } });
  await assert.rejects(f.controller.start(), /load failed/);
  fail = false;
  await f.controller.start();
  assert.deepEqual(f.calls, ['load', 'load', 'create']);
  assert.equal(f.controller.getStatus().state, 'running');
  await f.controller.stop();
});

test('Spout controller: synchronous create failure is cleaned before retry', async () => {
  let fail = true;
  const f = fixture({ create() { if (fail) throw new Error('create failed'); } });
  await assert.rejects(f.controller.start(), /create failed/);
  fail = false;
  await f.controller.start();
  assert.deepEqual(f.calls, ['load', 'create', 'stop', 'create']);
  assert.equal(f.controller.getStatus().state, 'running');
  await f.controller.stop();
});

test('Spout controller: asynchronous create failure also requires cleanup', async () => {
  let fail = true;
  const f = fixture({ create() { return fail ? Promise.reject(new Error('create rejected')) : Promise.resolve(); } });
  await assert.rejects(f.controller.start(), /create rejected/);
  fail = false;
  await f.controller.start();
  assert.deepEqual(f.calls, ['load', 'create', 'stop', 'create']);
  await f.controller.stop();
});

test('Spout controller: concurrent starts share the pending operation', async () => {
  const gate = deferred();
  const f = fixture({ create() { return gate.promise; } });
  const first = f.controller.start();
  const second = f.controller.start();
  assert.equal(first, second);
  await turn();
  assert.deepEqual(f.calls, ['load', 'create']);
  gate.resolve();
  await Promise.all([first, second]);
  await f.controller.stop();
});

test('Spout controller: concurrent stops share one native cleanup', async () => {
  const gate = deferred();
  const f = fixture({ stop() { return gate.promise; } });
  await f.controller.start();
  const first = f.controller.stop();
  const second = f.controller.stop();
  assert.equal(first, second);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(f.calls, ['load', 'create', 'stop']);
  assert.equal(f.controller.getStatus().state, 'idle');
});

test('Spout controller: stop drains pending create before queued restart', async () => {
  const gate = deferred();
  const f = fixture({ create() { return gate.promise; } });
  const first = f.controller.start();
  await turn();
  const stop = f.controller.stop();
  const restart = f.controller.start();
  gate.resolve();
  await Promise.all([first, stop, restart]);
  assert.deepEqual(f.calls, ['load', 'create', 'stop', 'create']);
  assert.equal(f.controller.getStatus().state, 'running');
  await f.controller.stop();
});

test('Spout controller: failed native stop blocks creation until cleanup succeeds', async () => {
  let fail = true;
  const f = fixture({ stop() { if (fail) throw new Error('cleanup failed'); } });
  await f.controller.start();
  await assert.rejects(f.controller.stop(), /cleanup failed/);
  await assert.rejects(f.controller.start(), /cleanup failed/);
  assert.deepEqual(f.calls, ['load', 'create', 'stop', 'stop']);
  assert.equal(f.controller.getStatus().state, 'error');
  fail = false;
  await f.controller.start();
  assert.deepEqual(f.calls, ['load', 'create', 'stop', 'stop', 'stop', 'create']);
  await f.controller.stop();
});

test('Spout controller: status callback can request stop during startup', async () => {
  let stop;
  const f = fixture({ status(status) { if (status.state === 'starting') stop = f.controller.stop(); } });
  await f.controller.start();
  await stop;
  assert.deepEqual(f.calls, ['load', 'create', 'stop']);
  assert.equal(f.controller.getStatus().state, 'idle');
});

test('Spout controller: changing output options still requires an explicit stop', async () => {
  const f = fixture();
  await f.controller.start();
  assert.throws(() => f.controller.start({ width: 1280 }), { code: 'SPOUT_ALREADY_RUNNING' });
  assert.equal(f.controller.getStatus().options.width, 1920);
  await f.controller.stop();
  await f.controller.start({ width: 1280 });
  assert.equal(f.controller.getStatus().options.width, 1280);
  await f.controller.stop();
});
