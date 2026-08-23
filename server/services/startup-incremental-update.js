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
    if (!verified?.ok || verified.plan.delivery !== 'incremental') return { ok: false, reason: 'signed policy was rejected at execution' };

    try {
      const artifact = await downloadArtifact(verified.plan);
      if (!artifact || !Buffer.isBuffer(artifact.buffer) || artifact.size !== verified.plan.artifact.size || artifact.sha256 !== verified.plan.artifact.sha256) {
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
    } catch (_) {
      // Do not expose remote/installation details to the Electron gate.  The
      // current session remains usable and a later cold start can try again.
      return { ok: false, reason: 'signed incremental update preparation failed' };
    }
  }

  return Object.freeze({ accept });
}

module.exports = { createStartupIncrementalUpdateExecutor };
