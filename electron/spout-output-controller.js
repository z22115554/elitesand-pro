'use strict';

const DEFAULTS = Object.freeze({
  senderName: 'Elitesand Pro Lyrics',
  width: 1920,
  height: 1080,
  // 30 FPS is the portable baseline validated on the integrated GPU. 60 FPS
  // remains an opt-in output setting; no GPU preference is persisted here.
  fps: 30,
});

const LIMITS = Object.freeze({
  minWidth: 640,
  maxWidth: 3840,
  minHeight: 360,
  maxHeight: 2160,
  minFps: 15,
  maxFps: 60,
  maxSenderNameLength: 64,
});

function createInputError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function validateOptions(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw createInputError('INVALID_SPOUT_OPTIONS', 'Spout options must be an object.');
  }

  const value = { ...DEFAULTS, ...options };
  for (const [key, min, max] of [
    ['width', LIMITS.minWidth, LIMITS.maxWidth],
    ['height', LIMITS.minHeight, LIMITS.maxHeight],
    ['fps', LIMITS.minFps, LIMITS.maxFps],
  ]) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) {
      throw createInputError('INVALID_SPOUT_DIMENSIONS', `${key} must be an integer between ${min} and ${max}.`);
    }
  }

  if (typeof value.senderName !== 'string' || !value.senderName || value.senderName.length > LIMITS.maxSenderNameLength) {
    throw createInputError('INVALID_SPOUT_SENDER_NAME', `senderName must be 1-${LIMITS.maxSenderNameLength} characters.`);
  }
  if (!/^[\x20-\x7E]+$/.test(value.senderName)) {
    throw createInputError('INVALID_SPOUT_SENDER_NAME', 'senderName must contain printable ASCII only in the MVP.');
  }
  return Object.freeze(value);
}

function createSpoutOutputController({ loadAddon, onStatus = () => {} } = {}) {
  if (typeof loadAddon !== 'function') throw new TypeError('createSpoutOutputController requires loadAddon().');

  let addon = null;
  let state = 'idle';
  let options = null;
  let lastError = null;
  let startPromise = null;
  let stopPromise = null;

  function snapshot() {
    const nativeStatus = addon && typeof addon.getStatus === 'function' ? addon.getStatus() : null;
    return Object.freeze({
      state,
      options,
      lastError: lastError ? { code: lastError.code || 'SPOUT_NATIVE_ERROR', message: lastError.message } : null,
      native: nativeStatus,
    });
  }

  function publish() {
    const status = snapshot();
    onStatus(status);
    return status;
  }

  function getAddon() {
    if (addon) return addon;
    const candidate = loadAddon();
    if (!candidate || typeof candidate.create !== 'function' || typeof candidate.stop !== 'function' || typeof candidate.getStatus !== 'function') {
      throw createInputError('INVALID_SPOUT_ADDON', 'Spout native addon is missing create(), stop(), or getStatus().');
    }
    addon = candidate;
    return addon;
  }

  function start(nextOptions = {}) {
    const validated = validateOptions(nextOptions);
    if (startPromise) return startPromise;
    if (state === 'running') {
      if (JSON.stringify(validated) !== JSON.stringify(options)) {
        throw createInputError('SPOUT_ALREADY_RUNNING', 'Stop the current Spout sender before changing output settings.');
      }
      return snapshot();
    }
    if (stopPromise) return stopPromise.then(() => start(validated));

    state = 'starting';
    lastError = null;
    options = validated;
    publish();
    startPromise = (async () => {
      try {
        await Promise.resolve(getAddon().create(validated));
        state = 'running';
        return publish();
      } catch (error) {
        state = 'error';
        lastError = error instanceof Error ? error : new Error(String(error));
        options = null;
        publish();
        throw lastError;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (startPromise) {
        try { await startPromise; } catch (_) { /* The failed start is already reflected in status. */ }
      }
      if (state === 'idle' || (state === 'error' && !addon)) return snapshot();
      state = 'stopping';
      publish();
      try {
        if (addon) await Promise.resolve(addon.stop());
        state = 'idle';
        options = null;
        lastError = null;
        return publish();
      } catch (error) {
        state = 'error';
        lastError = error instanceof Error ? error : new Error(String(error));
        publish();
        throw lastError;
      } finally {
        stopPromise = null;
      }
    })();
    return stopPromise;
  }

  return Object.freeze({
    start,
    stop,
    getStatus: snapshot,
    defaults: DEFAULTS,
    limits: LIMITS,
  });
}

module.exports = {
  DEFAULTS,
  LIMITS,
  validateOptions,
  createSpoutOutputController,
};
