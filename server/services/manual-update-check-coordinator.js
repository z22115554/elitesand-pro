'use strict';

// A second, independent private parentPort protocol, deliberately separate
// from startup-update-coordinator.js. That one is a boot-only, one-shot gate
// (its capability locks to the very first "check" and never accepts another
// requester for the life of the process). This one exists so the running
// panel can ask "is there an update right now?" on demand, any number of
// times, without ever touching the startup defer-cooldown store — a manual
// click is the user explicitly asking right now, so there is nothing to
// silently rate-limit.
//
// Same invariant as the boot coordinator: no HTTP/Socket.io surface, only a
// private parentPort message exchange that only Electron's manual-update
// requester (electron/manual-update-requester.js) can reach.
const REQUEST_TYPE = 'elitesand:manual-update-request';
const RESPONSE_TYPE = 'elitesand:manual-update-response';
const ACTIONS = new Set(['check', 'accept', 'progress']);

function isToken(value, bytes) {
  return typeof value === 'string' && new RegExp(`^[a-f0-9]{${bytes * 2}}$`, 'i').test(value);
}

function isRequest(message) {
  return !!message
    && typeof message === 'object'
    && message.type === REQUEST_TYPE
    && isToken(message.requestId, 16)
    && isToken(message.capability, 32)
    && ACTIONS.has(message.action)
    && (message.planId == null || (typeof message.planId === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(message.planId)));
}

function attachManualUpdateCheckCoordinator({
  parentPort = process.parentPort,
  provider,
  // Read-only progress passthrough for a long-running "accept" the Electron
  // side is currently awaiting (e.g. downloading a hundreds-of-MB artifact,
  // which has no byte-level tracking of its own): the panel used to show no
  // feedback at all until the whole thing finished or timed out.
  getProgress = () => { try { return require('./app-updater-v2').getProgress(); } catch (_) { return null; } },
  onError = () => {},
} = {}) {
  if (!parentPort || typeof parentPort.on !== 'function' || typeof parentPort.postMessage !== 'function') {
    return Object.freeze({ attached: false, detach: () => {} });
  }
  if (!provider || typeof provider.check !== 'function' || typeof provider.acceptIncremental !== 'function' || typeof provider.openRequiredInstaller !== 'function') {
    throw new TypeError('manual update coordinator requires a provider with check/acceptIncremental/openRequiredInstaller');
  }
  if (typeof getProgress !== 'function') throw new TypeError('manual update coordinator requires a getProgress function');

  // Locks to the first capability that ever sends a "check", exactly like the
  // boot coordinator, so a second, unrelated requester on the same parentPort
  // could never hijack this channel either.
  let capability = null;
  let pendingPlan = null; // single-use: only the most recently checked plan can be accepted
  const seenRequestIds = new Set();

  function reply(message, payload) {
    try {
      parentPort.postMessage({ type: RESPONSE_TYPE, requestId: message.requestId, capability: message.capability, ...payload });
    } catch (error) {
      onError(error);
    }
  }

  async function handle(message) {
    if (!isRequest(message)) return false;
    if (seenRequestIds.has(message.requestId)) return false;
    if (capability === null) {
      if (message.action !== 'check') return false;
      capability = message.capability;
    } else if (message.capability !== capability) {
      return false;
    }
    seenRequestIds.add(message.requestId);

    if (message.action === 'progress') {
      try { reply(message, { ok: true, progress: getProgress() }); }
      catch (error) { onError(error); reply(message, { ok: false, code: 'PROGRESS_FAILED' }); }
      return true;
    }

    if (message.action === 'check') {
      try {
        const result = await provider.check();
        if (!result || result.kind !== 'plan' || !result.plan || typeof result.plan !== 'object') {
          pendingPlan = null;
          // `unavailable` (provider couldn't get an answer) is passed through
          // as-is rather than folded into `none` (a real "no update" answer)
          // — the Electron side needs to tell them apart to fall back to the
          // GitHub release check instead of reporting "up to date".
          reply(message, { ok: true, kind: result && result.kind === 'unavailable' ? 'unavailable' : 'none' });
          return true;
        }
        pendingPlan = result.plan;
        reply(message, { ok: true, kind: 'plan', plan: pendingPlan });
        return true;
      } catch (error) {
        onError(error);
        reply(message, { ok: false, code: 'CHECK_FAILED' });
        return false;
      }
    }

    // action === 'accept': only ever consumes the plan this same requester
    // just saw via "check" — never a stale or unrelated planId.
    if (!pendingPlan || message.planId !== pendingPlan.planId) {
      reply(message, { ok: false, code: 'STALE_PLAN' });
      return false;
    }
    const plan = pendingPlan;
    pendingPlan = null;
    try {
      const result = plan.delivery === 'installer'
        ? await provider.openRequiredInstaller(plan)
        : await provider.acceptIncremental(plan);
      if (result?.ok === false) {
        // `reason` here is the same class of local diagnostic detail already
        // surfaced through getProgress().error — never raw remote/filesystem
        // detail, just which named step in the accept flow rejected it.
        reply(message, { ok: false, code: 'ACTION_REJECTED', reason: typeof result?.reason === 'string' ? result.reason : null });
        return false;
      }
      reply(message, { ok: true, kind: 'accepted', plan });
      return true;
    } catch (error) {
      onError(error);
      reply(message, { ok: false, code: 'ACTION_FAILED' });
      return false;
    }
  }

  const onMessage = (event) => { void handle(event?.data); };
  parentPort.on('message', onMessage);
  return Object.freeze({
    attached: true,
    detach: () => parentPort.removeListener?.('message', onMessage),
  });
}

module.exports = { REQUEST_TYPE, RESPONSE_TYPE, attachManualUpdateCheckCoordinator, isRequest };
