'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const test = require('node:test');
const { PHASES, createStartupUpdateGate } = require('../electron/startup-update-gate');
const { createStartupUpdateRequester } = require('../electron/startup-update-requester');
const { attachStartupUpdateCoordinator, createFakeStartupUpdateProvider } = require('../server/services/startup-update-coordinator');

const optionalPlan = Object.freeze({ planId: 'beta-win32-x64-1.0.0-1.0.1-20260826153836839', targetVersion: '1.0.1', urgency: 'optional', delivery: 'incremental' });
const requiredPlan = Object.freeze({ planId: 'required-plan-1', targetVersion: '2.0.0', urgency: 'required', delivery: 'installer' });
const requiredIncrementalPlan = Object.freeze({ planId: 'required-incremental-plan-1', targetVersion: '1.0.1', urgency: 'required', delivery: 'incremental' });

function makeClock() {
  let tick = Date.parse('2026-08-23T00:00:00Z');
  return () => (tick += 1000);
}

function makeMemoryDeferStore() {
  const values = new Map();
  return { getDeferUntil: (key) => values.get(key) || null, setDeferUntil: (key, value) => values.set(key, value) };
}

test('每個 OS process 最多冷啟動檢查一次；running 後遠端變 required 無效', async () => {
  let calls = 0;
  let remote = { ok: true, kind: 'none' };
  const gate = createStartupUpdateGate({ request: async () => { calls++; return remote; }, now: makeClock() });
  const first = await gate.run();
  remote = { ok: true, kind: 'plan', plan: requiredPlan };
  const second = await gate.run();
  assert.strictEqual(first.phase, PHASES.RUNNING_LOCKED);
  assert.strictEqual(second.phase, PHASES.RUNNING_LOCKED);
  assert.strictEqual(calls, 1);
  assert.strictEqual(gate.getSession().decision, 'no-update');
});

test('optional 延後以 targetVersion 記錄，且 lock 後不能 accept 或重查', async () => {
  const calls = [];
  const defers = makeMemoryDeferStore();
  const gate = createStartupUpdateGate({
    request: async (message) => {
      calls.push(message.action);
      return message.action === 'check' ? { ok: true, kind: 'plan', plan: optionalPlan } : { ok: true };
    },
    promptOptional: async () => 'defer',
    deferStore: defers,
    now: makeClock(),
  });
  const result = await gate.run();
  assert.strictEqual(result.phase, PHASES.RUNNING_LOCKED);
  assert.strictEqual(result.decision, 'deferred');
  assert.deepStrictEqual(calls, ['check', 'defer']);
  assert.ok(defers.getDeferUntil('1.0.1') > Date.parse('2026-08-23T00:00:00Z'));
  await gate.run();
  assert.deepStrictEqual(calls, ['check', 'defer']);
});

test('source、Spout 或重用 server 都直接鎖定，完全不發 private request', async () => {
  let calls = 0;
  const gate = createStartupUpdateGate({ request: async () => { calls++; return { ok: true, kind: 'none' }; } });
  const result = await gate.run({ eligible: false });
  assert.strictEqual(result.phase, PHASES.RUNNING_LOCKED);
  assert.strictEqual(result.decision, 'ineligible');
  assert.strictEqual(calls, 0);
});

test('optional 接受與 required gate 的分支都只能在 cold-start 決策階段離開', async () => {
  const optionalActions = [];
  const optional = createStartupUpdateGate({
    request: async (message) => {
      optionalActions.push(message.action);
      return message.action === 'check' ? { ok: true, kind: 'plan', plan: optionalPlan } : { ok: true };
    },
    promptOptional: async () => 'accept',
  });
  const optionalResult = await optional.run();
  assert.strictEqual(optionalResult.phase, PHASES.EXIT_FOR_UPDATER);
  assert.deepStrictEqual(optionalActions, ['check', 'accept-incremental']);

  const requiredActions = [];
  const required = createStartupUpdateGate({
    request: async (message) => {
      requiredActions.push(message.action);
      return message.action === 'check' ? { ok: true, kind: 'plan', plan: requiredPlan } : { ok: true };
    },
    promptRequired: async () => 'open',
  });
  const requiredResult = await required.run();
  assert.strictEqual(requiredResult.phase, PHASES.EXIT_FOR_INSTALLER_OR_UPDATER);
  assert.strictEqual(required.getAcceptedPlan().planId, requiredPlan.planId);
  assert.deepStrictEqual(requiredActions, ['check', 'open-required-installer']);
});

test('required incremental 不提供 defer，僅能在冷啟動接受或結束', async () => {
  const actions = [];
  const gate = createStartupUpdateGate({
    request: async (message) => {
      actions.push(message.action);
      return message.action === 'check' ? { ok: true, kind: 'plan', plan: requiredIncrementalPlan } : { ok: true };
    },
    promptRequired: async () => 'open',
  });
  const result = await gate.run();
  assert.strictEqual(result.phase, PHASES.EXIT_FOR_INSTALLER_OR_UPDATER);
  assert.strictEqual(result.decision, 'accepted-required');
  assert.deepStrictEqual(actions, ['check', 'accept-incremental']);
});

test('incremental staging 或 runner 失敗時鎖回正常啟動，絕不在使用中途再試', async () => {
  const actions = [];
  const gate = createStartupUpdateGate({
    request: async (message) => {
      actions.push(message.action);
      return message.action === 'check' ? { ok: true, kind: 'plan', plan: optionalPlan } : { ok: false };
    },
    promptOptional: async () => 'accept',
  });
  const result = await gate.run();
  assert.strictEqual(result.phase, PHASES.RUNNING_LOCKED);
  assert.strictEqual(result.decision, 'accept-rejected');
  assert.deepStrictEqual(actions, ['check', 'accept-incremental']);
  await gate.run();
  assert.deepStrictEqual(actions, ['check', 'accept-incremental']);
});

function createLinkedPorts() {
  const child = new EventEmitter();
  const parentPort = new EventEmitter();
  child.sent = [];
  child.postMessage = (message) => {
    child.sent.push(message);
    parentPort.emit('message', { data: message });
  };
  parentPort.postMessage = (message) => child.emit('message', { data: message });
  return { child, parentPort };
}

test('private parentPort protocol handles one request sequence and rejects wrong capability, replay, phase, and non-parentPort input without provider calls', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeStartupUpdateProvider({ plan: optionalPlan });
  const coordinator = attachStartupUpdateCoordinator({ parentPort, provider });
  let nonce = 0;
  const requester = createStartupUpdateRequester({ child, randomBytes: (size) => Buffer.alloc(size, ++nonce) });

  const checked = await requester.request({ action: 'check', phase: 'BOOT' });
  assert.strictEqual(checked.ok, true);
  assert.strictEqual(checked.kind, 'plan');
  assert.deepStrictEqual(provider.calls, ['check']);
  const firstRequest = child.sent[0];

  // Direct, malformed replay attempts arrive at the server port only. They do
  // not use the requester's capability and must not invoke a provider method.
  parentPort.emit('message', { data: {
    type: 'elitesand:startup-update-request', requestId: '1'.repeat(32), capability: '0'.repeat(64),
    action: 'accept-incremental', phase: 'OPTIONAL_PROMPT', planId: optionalPlan.planId,
  } });
  parentPort.emit('message', { data: firstRequest });
  parentPort.emit('message', { data: {
    type: 'elitesand:startup-update-request', requestId: '2'.repeat(32), capability: firstRequest.capability,
    action: 'defer', phase: 'REQUIRED_GATE', planId: optionalPlan.planId,
  } });
  parentPort.emit('message', { data: { type: 'elitesand:startup-update-request' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(provider.calls, ['check']);
  assert.strictEqual(coordinator.getState().phase, 'OPTIONAL_PROMPT');

  const deferred = await requester.request({ action: 'defer', phase: 'OPTIONAL_PROMPT', planId: optionalPlan.planId });
  assert.strictEqual(deferred.ok, true);
  assert.deepStrictEqual(provider.calls, ['check', 'defer']);
  requester.close();
  coordinator.detach();
});

test('progress is a read-only passthrough that shares the bound capability and never calls the provider', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeStartupUpdateProvider({ plan: optionalPlan });
  const snapshot = { active: true, phase: 'downloading-artifact', message: '正在下載更新套件', percent: 42, loadedBytes: 8, totalBytes: 19 };
  const coordinator = attachStartupUpdateCoordinator({ parentPort, provider, getProgress: () => snapshot });
  let nonce = 0;
  const requester = createStartupUpdateRequester({ child, randomBytes: (size) => Buffer.alloc(size, ++nonce) });

  // A progress request before any check has no bound capability yet: it must
  // be ignored (no reply, so the requester times out) and must not bind one.
  await assert.rejects(
    createStartupUpdateRequester({ child, randomBytes: (size) => Buffer.alloc(size, 200 + (++nonce)), timeoutMs: 150 })
      .request({ action: 'progress', phase: 'OPTIONAL_PROMPT' }),
    /timed out/,
  );

  const checked = await requester.request({ action: 'check', phase: 'BOOT' });
  assert.strictEqual(checked.kind, 'plan');

  const progress = await requester.request({ action: 'progress', phase: 'OPTIONAL_PROMPT' });
  assert.strictEqual(progress.ok, true);
  assert.deepStrictEqual(progress.progress, snapshot);
  // Provider was only ever asked to check; progress touches nothing.
  assert.deepStrictEqual(provider.calls, ['check']);
  assert.strictEqual(coordinator.getState().phase, 'OPTIONAL_PROMPT');

  requester.close();
  coordinator.detach();
});

test('accept-incremental/open-required-installer use a long timeout; check/defer stay fast', async () => {
  // The server only replies to an accept once it has fully downloaded and
  // verified the real signed artifact (hundreds of MB) and staged/spawned the
  // updater — a short fixed timeout used to silently read that as a plain
  // rejection: no error, no download, the app just kept running on the old
  // version. Never regress this back onto one shared short timeout.
  const silentChild = new EventEmitter();
  silentChild.postMessage = () => {};
  const requester = createStartupUpdateRequester({ child: silentChild, timeoutMs: 100, acceptTimeoutMs: 500 });

  const checkStarted = Date.now();
  await assert.rejects(requester.request({ action: 'check', phase: 'BOOT' }), /timed out/);
  assert.ok(Date.now() - checkStarted < 350, 'check should time out close to the short timeoutMs');

  const acceptStarted = Date.now();
  await assert.rejects(requester.request({ action: 'accept-incremental', phase: 'OPTIONAL_PROMPT', planId: optionalPlan.planId }), /timed out/);
  assert.ok(Date.now() - acceptStarted >= 450, 'accept-incremental should honor the long acceptTimeoutMs');
});

test('沒有 parentPort 時 coordinator 不會綁 process message 或啟動 provider', async () => {
  const provider = createFakeStartupUpdateProvider({ plan: optionalPlan });
  const coordinator = attachStartupUpdateCoordinator({ parentPort: null, provider });
  assert.strictEqual(coordinator.attached, false);
  assert.deepStrictEqual(provider.calls, []);
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'services', 'startup-update-coordinator.js'), 'utf8');
  assert.ok(!source.includes("process.on('message'"));
});

test('Electron shell only evaluates the gate after a new packaged server is healthy and before any UI exists', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
  const serverAt = source.indexOf('const server = await startServerOrReuseExisting();');
  const gateAt = source.indexOf('const updateSession = await runStartupUpdateGate();');
  const trayAt = source.indexOf('createTray();', gateAt);
  const windowAt = source.indexOf('await createWindow();', gateAt);
  assert.ok(serverAt >= 0 && gateAt > serverAt && trayAt > gateAt && windowAt > gateAt);
  assert.ok(source.includes('const eligible = app.isPackaged && ownsServer && !isSpoutExperiment;'));
  assert.ok(source.includes("return startupUpdateGate.lock(ownsServer ? 'non-production-shell' : 'reused-server');"));
});
