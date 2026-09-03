'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const test = require('node:test');
const { attachManualUpdateCheckCoordinator } = require('../server/services/manual-update-check-coordinator');
const { createManualUpdateRequester } = require('../electron/manual-update-requester');

const optionalPlan = Object.freeze({ planId: 'beta-win32-x64-1.0.0-1.0.1-p1', targetVersion: '1.0.1', urgency: 'optional', delivery: 'incremental' });
const requiredInstallerPlan = Object.freeze({ planId: 'required-installer-p1', targetVersion: '2.0.0', urgency: 'required', delivery: 'installer' });

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

function createFakeProvider({ plan = null, acceptOk = true, checkKind = 'none' } = {}) {
  const calls = [];
  return {
    calls,
    async check() {
      calls.push('check');
      return plan ? { kind: 'plan', plan } : { kind: checkKind };
    },
    async acceptIncremental(p) { calls.push(`accept-incremental:${p.planId}`); return { ok: acceptOk }; },
    async openRequiredInstaller(p) { calls.push(`open-required-installer:${p.planId}`); return { ok: acceptOk }; },
  };
}

test('manual check can run repeatedly and accept succeeds for an incremental plan', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeProvider({ plan: optionalPlan });
  const coordinator = attachManualUpdateCheckCoordinator({ parentPort, provider });
  let nonce = 0;
  const requester = createManualUpdateRequester({ child, randomBytes: (size) => Buffer.alloc(size, ++nonce) });

  const first = await requester.request({ action: 'check' });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.kind, 'plan');
  const second = await requester.request({ action: 'check' });
  assert.strictEqual(second.ok, true);
  assert.deepStrictEqual(provider.calls, ['check', 'check']);

  const accepted = await requester.request({ action: 'accept', planId: optionalPlan.planId });
  assert.strictEqual(accepted.ok, true);
  assert.deepStrictEqual(provider.calls, ['check', 'check', 'accept-incremental:beta-win32-x64-1.0.0-1.0.1-p1']);

  requester.close();
  coordinator.detach();
});

test('accept is rejected for a stale or unrelated planId, and never calls the provider', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeProvider({ plan: optionalPlan });
  attachManualUpdateCheckCoordinator({ parentPort, provider });
  const requester = createManualUpdateRequester({ child });

  await requester.request({ action: 'check' });
  const stale = await requester.request({ action: 'accept', planId: 'some-other-plan-id' });
  assert.strictEqual(stale.ok, false);
  assert.deepStrictEqual(provider.calls, ['check']);
});

test('a required+installer plan routes accept through openRequiredInstaller', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeProvider({ plan: requiredInstallerPlan });
  attachManualUpdateCheckCoordinator({ parentPort, provider });
  const requester = createManualUpdateRequester({ child });

  await requester.request({ action: 'check' });
  const accepted = await requester.request({ action: 'accept', planId: requiredInstallerPlan.planId });
  assert.strictEqual(accepted.ok, true);
  assert.deepStrictEqual(provider.calls, ['check', `open-required-installer:${requiredInstallerPlan.planId}`]);
});

test('a rejected provider result is reported without crashing the coordinator', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeProvider({ plan: optionalPlan, acceptOk: false });
  attachManualUpdateCheckCoordinator({ parentPort, provider });
  const requester = createManualUpdateRequester({ child });

  await requester.request({ action: 'check' });
  const accepted = await requester.request({ action: 'accept', planId: optionalPlan.planId });
  assert.strictEqual(accepted.ok, false);
});

test('a second requester with a different capability cannot hijack the channel', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeProvider({ plan: optionalPlan });
  attachManualUpdateCheckCoordinator({ parentPort, provider });
  const requester = createManualUpdateRequester({ child });
  await requester.request({ action: 'check' });

  parentPort.emit('message', { data: {
    type: 'elitesand:manual-update-request', requestId: 'a'.repeat(32), capability: '0'.repeat(64),
    action: 'accept', planId: optionalPlan.planId,
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(provider.calls, ['check']);
});

test('progress is a read-only passthrough of getProgress(), independent of check/accept plumbing', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeProvider({ plan: optionalPlan });
  let progressCalls = 0;
  attachManualUpdateCheckCoordinator({
    parentPort,
    provider,
    getProgress: () => { progressCalls += 1; return { active: true, phase: 'downloading-artifact', message: '正在下載更新套件' }; },
  });
  const requester = createManualUpdateRequester({ child });

  await requester.request({ action: 'check' });
  const progress = await requester.request({ action: 'progress' });
  assert.strictEqual(progress.ok, true);
  assert.deepStrictEqual(progress.progress, { active: true, phase: 'downloading-artifact', message: '正在下載更新套件' });
  assert.strictEqual(progressCalls, 1);
  assert.deepStrictEqual(provider.calls, ['check']); // progress never touches the provider itself
});

test('accept uses a long timeout while check stays fast, so a real multi-hundred-MB download is never mistaken for a rejection', async () => {
  // A child that never replies at all: both requests must eventually time
  // out, but "check" (a fast metadata round trip) should do so quickly while
  // "accept" (download + verify + stage + spawn the updater) gets a much
  // longer budget before the gate reads silence as "rejected".
  const silentChild = new EventEmitter();
  silentChild.postMessage = () => {};
  const requester = createManualUpdateRequester({ child: silentChild, timeoutMs: 100, acceptTimeoutMs: 500 });

  const checkStarted = Date.now();
  await assert.rejects(requester.request({ action: 'check' }), /timed out/);
  assert.ok(Date.now() - checkStarted < 350, 'check should time out close to the short timeoutMs');

  const acceptStarted = Date.now();
  await assert.rejects(requester.request({ action: 'accept', planId: 'x'.repeat(8) }), /timed out/);
  assert.ok(Date.now() - acceptStarted >= 450, 'accept should honor the long acceptTimeoutMs, not the short one');
});

test('acceptTimeoutMs below the base timeoutMs is rejected at construction', () => {
  const silentChild = new EventEmitter();
  silentChild.postMessage = () => {};
  assert.throws(() => createManualUpdateRequester({ child: silentChild, timeoutMs: 1000, acceptTimeoutMs: 500 }), /between the base timeout/);
});

test('a provider "unavailable" result is passed through as-is, not folded into "none"', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeProvider({ checkKind: 'unavailable' });
  attachManualUpdateCheckCoordinator({ parentPort, provider });
  const requester = createManualUpdateRequester({ child });

  const result = await requester.request({ action: 'check' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.kind, 'unavailable');
});

test('a real provider "none" result (server explicitly said no update) still reports "none"', async () => {
  const { child, parentPort } = createLinkedPorts();
  const provider = createFakeProvider({ checkKind: 'none' });
  attachManualUpdateCheckCoordinator({ parentPort, provider });
  const requester = createManualUpdateRequester({ child });

  const result = await requester.request({ action: 'check' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.kind, 'none');
});

test('no parentPort: coordinator does not attach or touch the provider', () => {
  const provider = createFakeProvider({ plan: optionalPlan });
  const coordinator = attachManualUpdateCheckCoordinator({ parentPort: null, provider });
  assert.strictEqual(coordinator.attached, false);
  assert.deepStrictEqual(provider.calls, []);
});
