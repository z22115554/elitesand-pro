'use strict';

const crypto = require('crypto');
const { REQUEST_TYPE, RESPONSE_TYPE } = require('../server/services/startup-update-coordinator');

const ACTIONS = new Set(['check', 'defer', 'accept-incremental', 'open-required-installer']);
const PHASES = new Set(['BOOT', 'OPTIONAL_PROMPT', 'REQUIRED_GATE']);

function makeToken(randomBytes, bytes) {
  return Buffer.from(randomBytes(bytes)).toString('hex');
}

function createStartupUpdateRequester({ child, randomBytes = crypto.randomBytes, timeoutMs = 4500 } = {}) {
  if (!child || typeof child.on !== 'function' || typeof child.postMessage !== 'function') {
    throw new TypeError('startup update requester requires an Electron utility process');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    throw new TypeError('startup update requester timeout must be between 100 and 10000ms');
  }
  const capability = makeToken(randomBytes, 32);
  const pending = new Map();

  const onMessage = (event) => {
    const message = event?.data || event;
    if (!message || typeof message !== 'object' || message.type !== RESPONSE_TYPE || message.capability !== capability) return;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    clearTimeout(entry.timer);
    entry.resolve(message);
  };
  child.on('message', onMessage);

  function request({ action, phase, planId = null } = {}) {
    if (!ACTIONS.has(action) || !PHASES.has(phase)) return Promise.reject(new TypeError('invalid startup update action'));
    const requestId = makeToken(randomBytes, 16);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('startup update request timed out'));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try {
        child.postMessage({ type: REQUEST_TYPE, requestId, capability, action, phase, planId });
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function close() {
    child.removeListener?.('message', onMessage);
    for (const [requestId, entry] of pending.entries()) {
      pending.delete(requestId);
      clearTimeout(entry.timer);
      entry.reject(new Error('startup update requester closed'));
    }
  }

  return Object.freeze({ request, close });
}

module.exports = { createStartupUpdateRequester };
