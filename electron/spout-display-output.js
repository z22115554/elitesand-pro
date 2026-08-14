'use strict';

const path = require('path');
const { validateOptions } = require('./spout-output-controller');

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function loadSpoutAddon(projectRoot, addonPath = '', { isPackaged = false, resourcesPath = '' } = {}) {
  // '.local/spout-output-build' is a gitignored dev build output; it never
  // ships. A packaged app's projectRoot points inside app.asar, and native
  // .node addons cannot dlopen from within an asar archive anyway — the
  // packaged build stages the compiled addon as an extraResource instead
  // (resources/tools/spout), same as yt-dlp.exe.
  let resolved;
  if (addonPath) {
    resolved = path.resolve(addonPath);
  } else if (isPackaged) {
    resolved = path.join(resourcesPath, 'tools', 'spout', 'elitesand_spout_output.node');
  } else {
    resolved = path.join(projectRoot, '.local', 'spout-output-build', 'elitesand_spout_output.node');
  }
  try {
    return require(resolved);
  } catch (error) {
    const wrapped = createError(
      'SPOUT_ADDON_LOAD_FAILED',
      isPackaged
        ? 'This build does not include the Spout native addon yet (alpha feature, not bundled in every release).'
        : `Could not load the Spout native addon: ${resolved}`,
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

function createSpoutDisplayOutput({
  BrowserWindow,
  addon,
  port,
  senderName = 'Elitesand Pro Lyrics Dev',
  width = 1920,
  height = 1080,
  fps = 30,
  nativeAdapterPreference = '',
  logger = console,
  // Test-only hooks let the CP06 visual matrix drive this exact shared
  // /display bridge. Production callers use the defaults and never receive
  // a second renderer or an alternate URL.
  displayPath = '/display?output=spout',
  onWindowCreated = null,
  onFrame = null,
} = {}) {
  if (typeof BrowserWindow !== 'function') throw new TypeError('createSpoutDisplayOutput requires BrowserWindow.');
  if (!addon || typeof addon.create !== 'function' || typeof addon.send !== 'function' || typeof addon.stop !== 'function') {
    throw new TypeError('createSpoutDisplayOutput requires a Spout addon with create(), send(), and stop().');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw createError('INVALID_SPOUT_PORT', 'port must be a valid TCP port.');

  const options = validateOptions({ senderName, width, height, fps });
  if (nativeAdapterPreference !== '' && nativeAdapterPreference !== 'low-power' && nativeAdapterPreference !== 'high-performance') {
    throw createError('INVALID_SPOUT_ADAPTER_PREFERENCE', 'nativeAdapterPreference must be low-power, high-performance, or omitted.');
  }
  let window = null;
  let state = 'idle';
  let lastError = null;
  let senderStarted = false;
  let received = 0;
  let released = 0;
  let sent = 0;
  let stopping = false;
  let startPromise = null;
  let stopPromise = null;
  let pendingTextures = [];
  let releaseTimer = null;

  function status() {
    return Object.freeze({
      state,
      senderName: options.senderName,
      width: options.width,
      height: options.height,
      fps: options.fps,
      framesReceived: received,
      framesReleased: released,
      framesSent: sent,
      lastError: lastError ? { code: lastError.code || 'SPOUT_DISPLAY_ERROR', message: lastError.message } : null,
      native: typeof addon.getStatus === 'function' ? addon.getStatus() : null,
      hasWindow: !!window && !window.isDestroyed?.(),
    });
  }

  function setFailure(error) {
    lastError = error instanceof Error ? error : new Error(String(error));
    state = 'error';
    logger.error?.('[Elitesand Pro Spout] display output failed:', lastError.message);
  }

  function releaseTexture(texture) {
    try { texture?.release?.(); } finally { released += 1; }
  }

  function releasePendingTextures(force = false) {
    const completed = force
      ? Number.POSITIVE_INFINITY
      : Number(addon.getStatus?.()?.sourceCopyCompletedSequence || 0);
    while (pendingTextures.length && pendingTextures[0].sequence <= completed) {
      releaseTexture(pendingTextures.shift().texture);
    }
    if (!pendingTextures.length && releaseTimer) {
      clearInterval(releaseTimer);
      releaseTimer = null;
    }
  }

  function schedulePendingRelease() {
    if (releaseTimer) return;
    // Keep the original Electron texture alive only until the native worker
    // has completed its first owned copy. This removes the GPU fence from the
    // paint callback without allowing Electron to recycle the source early.
    releaseTimer = setInterval(() => releasePendingTextures(), 8);
    releaseTimer.unref?.();
  }

  function handlePaint(event) {
    const texture = event?.texture;
    if (!texture) return;
    received += 1;
    let deferRelease = false;
    try {
      releasePendingTextures();
      if (stopping || state === 'error') return;
      const textureInfo = texture.textureInfo;
      const codedSize = textureInfo?.codedSize;
      if (!senderStarted) {
        if (!Number.isInteger(codedSize?.width) || !Number.isInteger(codedSize?.height)) {
          throw createError('INVALID_SHARED_TEXTURE', 'Electron did not provide shared-texture dimensions.');
        }
        if (codedSize.width !== options.width || codedSize.height !== options.height) {
          throw createError('SPOUT_TEXTURE_SIZE_MISMATCH', `Expected ${options.width}x${options.height}, received ${codedSize.width}x${codedSize.height}.`);
        }
        addon.create({ ...options, adapterPreference: nativeAdapterPreference });
        senderStarted = true;
        state = 'running';
      }
      const result = addon.send(textureInfo);
      if (result?.accepted !== true) throw createError('SPOUT_FRAME_REJECTED', 'Spout rejected an Electron shared texture frame.');
      sent += 1;
      if (result.deferredRelease === true && Number.isSafeInteger(result.sourceSequence)) {
        pendingTextures.push({ texture, sequence: result.sourceSequence });
        schedulePendingRelease();
        deferRelease = true;
      }
      onFrame?.(status(), result);
    } catch (error) {
      setFailure(error);
      try { addon.stop(); } catch (_) { /* Preserve the original output error. */ }
      releasePendingTextures(true);
      senderStarted = false;
    } finally {
      if (!deferRelease) releaseTexture(texture);
    }
  }

  async function start() {
    if (startPromise) return startPromise;
    if (state === 'running' || state === 'starting') return status();
    if (stopPromise) await stopPromise;
    state = 'starting';
    lastError = null;
    startPromise = (async () => {
      try {
        const nextWindow = new BrowserWindow({
          width: options.width,
          height: options.height,
          useContentSize: true,
          enableLargerThanScreen: true,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          webPreferences: {
            offscreen: { useSharedTexture: true },
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        window = nextWindow;
        onWindowCreated?.(nextWindow);
        // A hidden native window can otherwise be clamped to the work area on Windows.
        nextWindow.setPosition?.(0, -40);
        nextWindow.setContentSize?.(options.width, options.height);
        nextWindow.webContents.setFrameRate?.(options.fps);
        nextWindow.webContents.on('paint', handlePaint);
        nextWindow.on?.('closed', () => {
          if (window === nextWindow) window = null;
          if (!stopping && senderStarted) {
            try { addon.stop(); } catch (_) { /* Window teardown must not crash Electron. */ }
            releasePendingTextures(true);
            senderStarted = false;
            state = 'idle';
          }
        });
        await nextWindow.loadURL(`http://127.0.0.1:${port}${displayPath}`);
        return status();
      } catch (error) {
        setFailure(error);
        if (window && !window.isDestroyed?.()) window.destroy?.();
        window = null;
        try { addon.stop(); } catch (_) { /* Preserve startup error. */ }
        releasePendingTextures(true);
        senderStarted = false;
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
      stopping = true;
      try {
        const activeWindow = window;
        window = null;
        if (activeWindow && !activeWindow.isDestroyed?.()) activeWindow.destroy?.();
        if (senderStarted || state === 'error') addon.stop();
        releasePendingTextures(true);
        senderStarted = false;
        state = 'idle';
        lastError = null;
        return status();
      } finally {
        stopping = false;
        stopPromise = null;
      }
    })();
    return stopPromise;
  }

  return Object.freeze({ start, stop, getStatus: status, options });
}

module.exports = { createSpoutDisplayOutput, loadSpoutAddon };
