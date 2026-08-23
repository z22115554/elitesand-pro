'use strict';

const assert = require('assert');
const crypto = require('crypto');
const test = require('node:test');
const { createStartupIncrementalUpdateExecutor } = require('../server/services/startup-incremental-update');
const updater = require('../server/services/app-updater-v2');

const plan = Object.freeze({
  planId: 'stable-0.9.9.7-0.9.9.8-p7',
  delivery: 'incremental',
  targetVersion: '0.9.9.8',
  artifact: { sha256: crypto.createHash('sha256').update('verified zip').digest('hex'), size: 12 },
});

test('only a reverified signed cold-start plan can hand exact bytes to the v2 updater', async () => {
  const calls = [];
  const executor = createStartupIncrementalUpdateExecutor({
    verifyPlan: (candidate) => candidate === plan ? { ok: true, plan: candidate } : { ok: false },
    downloadArtifact: async () => ({ buffer: Buffer.from('verified zip'), sha256: plan.artifact.sha256, size: plan.artifact.size }),
    updater: {
      prepareAndLaunchUpdate: async (options) => {
        calls.push(options);
        return { launched: true };
      },
    },
  });
  const result = await executor.accept(plan);
  assert.deepStrictEqual(result, { ok: true, planId: plan.planId, targetVersion: plan.targetVersion });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].authorizedColdStart, true);
  assert.strictEqual(calls[0].outerPlanId, plan.planId);
  assert.strictEqual(calls[0].latestVersion, plan.targetVersion);
  assert.strictEqual(calls[0].expectedHash, plan.artifact.sha256);
});

test('execution rejects an unverified policy before downloading or staging', async () => {
  let downloaded = 0;
  let staged = 0;
  const executor = createStartupIncrementalUpdateExecutor({
    verifyPlan: () => ({ ok: false }),
    downloadArtifact: async () => { downloaded += 1; },
    updater: { prepareAndLaunchUpdate: async () => { staged += 1; } },
  });
  const result = await executor.accept(plan);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(downloaded, 0);
  assert.strictEqual(staged, 0);
});

test('a failed updater handoff reports false so the cold-start gate keeps the current session running', async () => {
  const executor = createStartupIncrementalUpdateExecutor({
    verifyPlan: () => ({ ok: true, plan }),
    downloadArtifact: async () => ({ buffer: Buffer.from('verified zip'), sha256: plan.artifact.sha256, size: plan.artifact.size }),
    updater: { prepareAndLaunchUpdate: async () => ({ launched: false, reason: 'runner handshake failed' }) },
  });
  const result = await executor.accept(plan);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /runner handshake failed/);
});

test('v2 updater refuses missing cold-start capability and has no metadata-download fallback in prepareUpdate', async () => {
  const result = await updater.prepareUpdate({
    zipBuffer: Buffer.from('never inspected'),
    expectedHash: crypto.createHash('sha256').update('never inspected').digest('hex'),
    latestVersion: '0.9.9.8',
  });
  assert.strictEqual(result.prepared, false);
  assert.match(result.reason, /冷啟動簽章政策/);
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'services', 'app-updater-v2.js'), 'utf8');
  const prepareBody = source.slice(source.indexOf('async function prepareUpdate'), source.indexOf('async function launchUpdater'));
  assert.ok(!prepareBody.includes('downloadLatestUpdate('), 'prepareUpdate must never select or download a GitHub release');
});
