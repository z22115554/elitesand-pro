'use strict';

const crypto = require('crypto');
const { REQUEST_TYPE, RESPONSE_TYPE } = require('../server/services/manual-update-check-coordinator');

const ACTIONS = new Set(['check', 'accept', 'progress']);

// "check" is a single metadata round trip and stays fast-timeout. "accept"
// only replies once the server has finished downloading and SHA-256-verifying
// the whole signed artifact (real update.zip payloads run to the hundreds of
// MB) and staged/spawned the updater — that can genuinely take minutes on a
// slow connection. Reusing the fast timeout here silently turned every real
// accept into a timeout: no error, no download, just a plain "failed" back to
// the panel with nothing in any server log to explain why.
const LONG_RUNNING_ACTIONS = new Set(['accept']);

function makeToken(randomBytes, bytes) {
  return Buffer.from(randomBytes(bytes)).toString('hex');
}

function createManualUpdateRequester({ child, randomBytes = crypto.randomBytes, timeoutMs = 4500, acceptTimeoutMs = 10 * 60 * 1000 } = {}) {
  if (!child || typeof child.on !== 'function' || typeof child.postMessage !== 'function') {
    throw new TypeError('manual update requester requires an Electron utility process');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    throw new TypeError('manual update requester timeout must be between 100 and 10000ms');
  }
  if (!Number.isInteger(acceptTimeoutMs) || acceptTimeoutMs < timeoutMs || acceptTimeoutMs > 15 * 60 * 1000) {
    throw new TypeError('manual update accept timeout must be between the base timeout and 15 minutes');
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

  function request({ action, planId = null } = {}) {
    if (!ACTIONS.has(action)) return Promise.reject(new TypeError('invalid manual update action'));
    const requestId = makeToken(randomBytes, 16);
    const effectiveTimeoutMs = LONG_RUNNING_ACTIONS.has(action) ? acceptTimeoutMs : timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('manual update request timed out'));
      }, effectiveTimeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try {
        child.postMessage({ type: REQUEST_TYPE, requestId, capability, action, planId });
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
      entry.reject(new Error('manual update requester closed'));
    }
  }

  return Object.freeze({ request, close });
}

module.exports = { createManualUpdateRequester };
