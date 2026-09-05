'use strict';

// This is a private utility-process protocol, not a localhost API.  The
// renderer cannot reach Electron's parentPort and the server never binds an
// update action to HTTP or Socket.io.
const REQUEST_TYPE = 'elitesand:startup-update-request';
const RESPONSE_TYPE = 'elitesand:startup-update-response';
// 'progress' is a read-only passthrough of the v2 updater's progress snapshot
// (injected as getProgress by server/index.js), added so the Electron host can
// show a cold-start progress window while 'accept-incremental' blocks for the
// whole download+verify+stage. It calls no provider method, never advances the
// phase state machine, and shares the same capability the gate already bound
// with its BOOT 'check'.
const ACTIONS = new Set(['check', 'defer', 'accept-incremental', 'open-required-installer', 'progress']);
const PHASES = new Set(['BOOT', 'OPTIONAL_PROMPT', 'REQUIRED_GATE']);

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
    && PHASES.has(message.phase)
    && (message.planId == null || (typeof message.planId === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(message.planId)));
}

function createFakeStartupUpdateProvider({ plan = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    async check() {
      calls.push('check');
      if (error) throw error;
      return plan ? { kind: 'plan', plan } : { kind: 'none' };
    },
    async defer() { calls.push('defer'); return { ok: true }; },
    async acceptIncremental() { calls.push('accept-incremental'); return { ok: true }; },
    async openRequiredInstaller() { calls.push('open-required-installer'); return { ok: true }; },
  };
}

function attachStartupUpdateCoordinator({
  parentPort = process.parentPort,
  provider = createFakeStartupUpdateProvider(),
  // Injected by server/index.js from the v2 signed-incremental updater's
  // progress snapshot. Defaults to "no progress" so this file never has to
  // reference the updater directly (the cold-start gate must stay clear of
  // the legacy updater — see tests/run-tests.js).
  getProgress = () => null,
  onError = () => {},
} = {}) {
  if (!parentPort || typeof parentPort.on !== 'function' || typeof parentPort.postMessage !== 'function') {
    return Object.freeze({ attached: false, detach: () => {}, getState: () => ({ phase: 'UNAVAILABLE' }) });
  }
  if (!provider || typeof provider.check !== 'function') throw new TypeError('startup update provider must implement check');

  let capability = null;
  let phase = 'BOOT';
  let selectedPlan = null;
  const seenRequestIds = new Set();

  function reply(message, payload) {
    try {
      parentPort.postMessage({
        type: RESPONSE_TYPE,
        requestId: message.requestId,
        capability: message.capability,
        ...payload,
      });
    } catch (error) {
      onError(error);
    }
  }

  async function handle(message) {
    if (!isRequest(message)) return false;
    if (seenRequestIds.has(message.requestId)) return false;
    if (capability === null) {
      if (message.action !== 'check' || message.phase !== 'BOOT') return false;
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
      if (phase !== 'BOOT' || message.phase !== 'BOOT') return false;
      phase = 'CHECKING';
      try {
        const result = await provider.check();
        // Boot has no fallback path (there is no GitHub-check UI this early):
        // `unavailable` (provider couldn't get an answer this time) is
        // treated the same as a real `none` here, same as before this
        // coordinator's provider distinguished the two kinds.
        if (!result || result.kind === 'none' || result.kind === 'unavailable') {
          phase = 'TERMINAL';
          reply(message, { ok: true, kind: 'none' });
          return true;
        }
        if (result.kind !== 'plan' || !result.plan || typeof result.plan !== 'object') {
          phase = 'TERMINAL';
          reply(message, { ok: false, code: 'INVALID_PROVIDER_RESULT' });
          return false;
        }
        selectedPlan = result.plan;
        phase = result.plan.urgency === 'required' ? 'REQUIRED_GATE' : 'OPTIONAL_PROMPT';
        reply(message, { ok: true, kind: 'plan', plan: selectedPlan });
        return true;
      } catch (error) {
        phase = 'TERMINAL';
        onError(error);
        reply(message, { ok: false, code: 'CHECK_FAILED' });
        return false;
      }
    }

    const actionPhase = message.action === 'defer' ? 'OPTIONAL_PROMPT' : phase;
    if (message.phase !== actionPhase || !selectedPlan || message.planId !== selectedPlan.planId) return false;
    try {
      let result;
      if (message.action === 'defer') result = await provider.defer(selectedPlan);
      else if (message.action === 'accept-incremental') result = await provider.acceptIncremental(selectedPlan);
      else result = await provider.openRequiredInstaller(selectedPlan);
      if (result?.ok === false) {
        reply(message, { ok: false, code: 'ACTION_REJECTED' });
        return false;
      }
      phase = 'TERMINAL';
      reply(message, { ok: true, kind: 'accepted', plan: selectedPlan });
      return true;
    } catch (error) {
      phase = 'TERMINAL';
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
    getState: () => Object.freeze({ phase, hasCapability: capability !== null, hasPlan: selectedPlan !== null, requests: seenRequestIds.size }),
  });
}

module.exports = {
  REQUEST_TYPE,
  RESPONSE_TYPE,
  attachStartupUpdateCoordinator,
  createFakeStartupUpdateProvider,
  isRequest,
};
