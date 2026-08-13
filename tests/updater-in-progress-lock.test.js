'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  UPDATE_MODE,
  UPDATE_WORK_DIR,
  UPDATE_LOCK_MAX_AGE_MS,
  inspectUpdateLock,
} = require('../electron/update-in-progress-lock');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-update-guard-test-'));
const installRoot = path.join(root, 'install');
const exe = path.join(installRoot, 'Elitesand Pro.exe');
const workBase = path.join(root, UPDATE_WORK_DIR);
const nowMs = Date.now();

fs.mkdirSync(installRoot, { recursive: true });
fs.mkdirSync(workBase, { recursive: true });

function makeWorkspace(name, overrides = {}) {
  const workRoot = path.join(workBase, name);
  fs.mkdirSync(workRoot, { recursive: true });
  const readyFile = path.join(workRoot, 'updater.ready');
  const planFile = path.join(workRoot, 'update-plan.json');
  fs.writeFileSync(readyFile, String(overrides.updaterPid ?? 4242), 'ascii');
  fs.writeFileSync(planFile, JSON.stringify({
    schemaVersion: overrides.schemaVersion ?? 2,
    mode: overrides.mode ?? UPDATE_MODE,
    targetRoot: overrides.targetRoot ?? installRoot,
    fromVersion: '0.9.9.60',
    toVersion: '0.9.9.61',
  }), 'utf8');
  const ageMs = overrides.ageMs ?? 1000;
  const stamp = new Date(nowMs - ageMs);
  fs.utimesSync(readyFile, stamp, stamp);
  return { workRoot, readyFile, planFile };
}

try {
  assert.strictEqual(
    inspectUpdateLock(exe, { tempDir: path.join(root, 'missing'), now: () => nowMs }).active,
    false,
    'missing updater workspace must not block startup'
  );

  makeWorkspace('active');
  const active = inspectUpdateLock(exe, { tempDir: root, now: () => nowMs });
  assert.strictEqual(active.active, true, 'fresh matching updater handshake must block manual startup');
  assert.strictEqual(active.updaterPid, 4242);
  assert.strictEqual(active.toVersion, '0.9.9.61');

  const bypass = inspectUpdateLock(exe, {
    tempDir: root,
    now: () => nowMs,
    env: { ELITESAND_UPDATE_CHILD: '1' },
  });
  assert.strictEqual(bypass.active, false, 'updater-spawned restart must bypass the guard');
  assert.strictEqual(bypass.bypass, true);

  fs.rmSync(path.join(workBase, 'active'), { recursive: true, force: true });
  makeWorkspace('wrong-target', { targetRoot: path.join(root, 'other-install') });
  assert.strictEqual(
    inspectUpdateLock(exe, { tempDir: root, now: () => nowMs }).active,
    false,
    'handshake for another install root must not block startup'
  );

  fs.rmSync(path.join(workBase, 'wrong-target'), { recursive: true, force: true });
  makeWorkspace('stale', { ageMs: UPDATE_LOCK_MAX_AGE_MS + 1000 });
  assert.strictEqual(
    inspectUpdateLock(exe, { tempDir: root, now: () => nowMs }).active,
    false,
    'stale handshake must not permanently block startup'
  );

  fs.rmSync(path.join(workBase, 'stale'), { recursive: true, force: true });
  makeWorkspace('invalid-pid', { updaterPid: 0 });
  assert.strictEqual(
    inspectUpdateLock(exe, { tempDir: root, now: () => nowMs }).active,
    false,
    'invalid ready marker must not block startup'
  );

  fs.rmSync(path.join(workBase, 'invalid-pid'), { recursive: true, force: true });
  const malformed = makeWorkspace('malformed');
  fs.writeFileSync(malformed.planFile, '{broken', 'utf8');
  assert.strictEqual(
    inspectUpdateLock(exe, { tempDir: root, now: () => nowMs }).active,
    false,
    'malformed update plan must fail open rather than brick startup'
  );

  console.log('updater-in-progress-lock: all tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
