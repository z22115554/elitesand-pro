'use strict';

// This is the only production bridge from a signed cold-start policy to the
// v2 updater.  It deliberately accepts no renderer/HTTP data and supplies
// the updater with a fully downloaded, policy-bound byte buffer.
const { APP_VERSION } = require('../utils/app-version');
const appUpdater = require('./app-updater-v2');
const { verifyUpdatePlan } = require('./update-policy');
const { downloadSignedIncrementalArtifact } = require('./signed-update-artifact');

function createStartupIncrementalUpdateExecutor({
  currentVersion = APP_VERSION,
  channel = 'stable',
  platform = 'win32',
  arch = 'x64',
  publicKeys,
  replayGuard,
  nowMs = () => Date.now(),
  verifyPlan = verifyUpdatePlan,
  downloadArtifact = downloadSignedIncrementalArtifact,
  updater = appUpdater,
} = {}) {
  if (typeof verifyPlan !== 'function' || typeof downloadArtifact !== 'function' || !updater || typeof updater.prepareAndLaunchUpdate !== 'function') {
    throw new TypeError('startup incremental update executor dependencies are invalid');
  }

  async function accept(plan) {
    // Verify again at the execution boundary. The coordinator only transfers a
    // private selected plan, but this guards future refactors from turning the
    // outer verification into a mere display-time check.
    const verified = verifyPlan(plan, {
      currentVersion,
      channel,
      platform,
      arch,
      publicKeys,
      replayGuard,
      nowMs: nowMs(),
    });
    if (!verified?.ok || verified.plan.delivery !== 'incremental') {
      updater.setProgress?.('failed', '更新方案驗證失敗，程式仍可正常使用', { error: verified?.reason || 'plan-rejected' });
      return { ok: false, reason: 'signed policy was rejected at execution' };
    }

    try {
      // The download itself (real artifacts run to the hundreds of MB) has no
      // byte-level progress today, but at minimum surface that it has started
      // so a caller polling getProgress() never sees stale/idle state for the
      // whole download — this used to be the single longest silent stretch of
      // the whole accept flow.
      updater.setProgress?.('downloading-artifact', '正在下載更新套件（依網路速度可能需要數分鐘，請勿關閉程式）');
      const artifact = await downloadArtifact(verified.plan);
      if (!artifact || !Buffer.isBuffer(artifact.buffer) || artifact.size !== verified.plan.artifact.size || artifact.sha256 !== verified.plan.artifact.sha256) {
        updater.setProgress?.('failed', '更新套件下載驗證失敗，程式仍可正常使用', { error: 'artifact-mismatch' });
        return { ok: false, reason: 'signed artifact verification did not produce the expected bytes' };
      }
      const result = await updater.prepareAndLaunchUpdate({
        authorizedColdStart: true,
        outerPlanId: verified.plan.planId,
        zipBuffer: artifact.buffer,
        expectedHash: verified.plan.artifact.sha256,
        latestVersion: verified.plan.targetVersion,
        currentVersion,
      });
      if (!result?.launched) return { ok: false, reason: result?.reason || 'updater handoff was rejected' };
      return { ok: true, planId: verified.plan.planId, targetVersion: verified.plan.targetVersion };
    } catch (error) {
      // Do not expose remote/installation details to the Electron gate (the
      // returned `reason` stays generic). The real message still goes into
      // getProgress()'s error field, which is local-only diagnostic state a
      // caller has to actively poll for — nothing new is exposed remotely.
      updater.setProgress?.('failed', '更新準備失敗，程式仍可正常使用', { error: error?.message || String(error) });
      return { ok: false, reason: 'signed incremental update preparation failed' };
    }
  }

  return Object.freeze({ accept });
}

module.exports = { createStartupIncrementalUpdateExecutor };
