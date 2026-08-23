'use strict';

// The update decision belongs to one Electron main-process lifetime.  It is
// deliberately not a renderer feature, timer, or HTTP API: once the panel is
// reachable, this gate has already locked and cannot be opened again.
const PHASES = Object.freeze({
  BOOT: 'BOOT',
  CHECKING: 'CHECKING',
  OPTIONAL_PROMPT: 'OPTIONAL_PROMPT',
  REQUIRED_GATE: 'REQUIRED_GATE',
  PREPARING: 'PREPARING',
  EXIT_FOR_UPDATER: 'EXIT_FOR_UPDATER',
  EXIT_FOR_INSTALLER_OR_UPDATER: 'EXIT_FOR_INSTALLER_OR_UPDATER',
  RUNNING_LOCKED: 'RUNNING_LOCKED',
});

const ACTIONS = Object.freeze({
  CHECK: 'check',
  DEFER: 'defer',
  ACCEPT_INCREMENTAL: 'accept-incremental',
  OPEN_REQUIRED_INSTALLER: 'open-required-installer',
});

const DEFER_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function cloneSession(session) {
  return Object.freeze({
    phase: session.phase,
    checkedAt: session.checkedAt,
    planId: session.planId,
    decision: session.decision,
    lockedAt: session.lockedAt,
  });
}

function isPlan(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.planId === 'string'
    && /^[a-zA-Z0-9_-]{8,128}$/.test(value.planId)
    && typeof value.targetVersion === 'string'
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value.targetVersion)
    && (value.urgency === 'optional' || value.urgency === 'required')
    && (value.delivery === 'incremental' || value.delivery === 'installer');
}

function isDeferred(deferStore, targetVersion, nowMs) {
  if (!deferStore || typeof deferStore.getDeferUntil !== 'function') return false;
  const until = deferStore.getDeferUntil(targetVersion);
  return Number.isFinite(until) && until > nowMs;
}

function createStartupUpdateGate({
  request,
  promptOptional = async () => 'defer',
  promptRequired = async () => 'exit',
  deferStore = null,
  now = () => Date.now(),
  deferDurationMs = DEFER_DURATION_MS,
} = {}) {
  if (typeof request !== 'function') throw new TypeError('createStartupUpdateGate requires a private request function');
  if (typeof promptOptional !== 'function' || typeof promptRequired !== 'function') {
    throw new TypeError('startup update prompts must be functions');
  }
  if (!Number.isFinite(deferDurationMs) || deferDurationMs <= 0) throw new TypeError('deferDurationMs must be positive');

  const session = {
    phase: PHASES.BOOT,
    checkedAt: null,
    planId: null,
    decision: null,
    lockedAt: null,
  };

  function snapshot() {
    return cloneSession(session);
  }

  function lock(decision) {
    if (session.phase === PHASES.RUNNING_LOCKED) return snapshot();
    if (session.phase === PHASES.EXIT_FOR_UPDATER || session.phase === PHASES.EXIT_FOR_INSTALLER_OR_UPDATER) {
      return snapshot();
    }
    session.phase = PHASES.RUNNING_LOCKED;
    session.decision = decision;
    session.lockedAt = new Date(now()).toISOString();
    return snapshot();
  }

  async function requestAction(action, phase, planId = null) {
    return request({ action, phase, planId });
  }

  async function defer(plan, decision = 'deferred') {
    try {
      const response = await requestAction(ACTIONS.DEFER, PHASES.OPTIONAL_PROMPT, plan.planId);
      if (!response?.ok) return lock('defer-rejected');
    } catch (_) {
      return lock('defer-failed');
    }
    if (deferStore && typeof deferStore.setDeferUntil === 'function') {
      deferStore.setDeferUntil(plan.targetVersion, now() + deferDurationMs);
    }
    return lock(decision);
  }

  async function decideOptional(plan) {
    const nowMs = now();
    if (plan.delivery !== 'incremental') return lock('optional-delivery-rejected');
    if (isDeferred(deferStore, plan.targetVersion, nowMs)) return lock('deferred-target');

    session.phase = PHASES.OPTIONAL_PROMPT;
    let choice = 'defer';
    try { choice = await promptOptional(plan); } catch (_) { choice = 'defer'; }
    if (choice !== 'accept') return defer(plan);

    session.phase = PHASES.PREPARING;
    try {
      const response = await requestAction(ACTIONS.ACCEPT_INCREMENTAL, PHASES.OPTIONAL_PROMPT, plan.planId);
      if (!response?.ok) return lock('accept-rejected');
      session.phase = PHASES.EXIT_FOR_UPDATER;
      session.decision = 'accepted-optional';
      return snapshot();
    } catch (_) {
      return lock('accept-failed');
    }
  }

  async function decideRequired(plan) {
    session.phase = PHASES.REQUIRED_GATE;
    let choice = 'exit';
    try { choice = await promptRequired(plan); } catch (_) { choice = 'exit'; }
    if (choice !== 'open') {
      session.phase = PHASES.EXIT_FOR_INSTALLER_OR_UPDATER;
      session.decision = 'required-exit';
      return snapshot();
    }
    const action = plan.delivery === 'installer' ? ACTIONS.OPEN_REQUIRED_INSTALLER : ACTIONS.ACCEPT_INCREMENTAL;
    try {
      const response = await requestAction(action, PHASES.REQUIRED_GATE, plan.planId);
      if (!response?.ok) return lock('required-action-rejected');
      session.phase = PHASES.EXIT_FOR_INSTALLER_OR_UPDATER;
      session.decision = plan.delivery === 'installer' ? 'required-installer-opened' : 'accepted-required';
      return snapshot();
    } catch (_) {
      return lock('required-action-failed');
    }
  }

  async function run({ eligible = true } = {}) {
    if (session.phase !== PHASES.BOOT) return snapshot();
    if (!eligible) return lock('ineligible');

    session.phase = PHASES.CHECKING;
    let response;
    try {
      response = await requestAction(ACTIONS.CHECK, PHASES.BOOT);
    } catch (_) {
      return lock('check-failed');
    }
    session.checkedAt = new Date(now()).toISOString();
    if (!response?.ok || response.kind === 'none') return lock(response?.ok ? 'no-update' : 'check-rejected');
    if (response.kind !== 'plan' || !isPlan(response.plan)) return lock('invalid-plan');

    const plan = response.plan;
    session.planId = plan.planId;
    return plan.urgency === 'optional' ? decideOptional(plan) : decideRequired(plan);
  }

  return Object.freeze({ run, lock, getSession: snapshot });
}

module.exports = { ACTIONS, DEFER_DURATION_MS, PHASES, createStartupUpdateGate, isPlan };
