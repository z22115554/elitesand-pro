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
  if (addonPath && !isPackaged) {
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
  if (nativeAdapterPreference !== '' && nativeAdapterPreference !== 'low-power' && nativeAdapterPreference !== 'high-performance'
    && !/^luid:[0-9a-f]{1,8}:[0-9a-f]{1,8}$/i.test(nativeAdapterPreference)) {
    throw createError('INVALID_SPOUT_ADAPTER_PREFERENCE', 'nativeAdapterPreference must be low-power, high-performance, luid:HIGH:LOW, or omitted.');
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
  let generation = 0;
  let pendingTextures = [];
  let releaseTimer = null;
  let lastNativeSent = null;
  let lastNativeProgressAt = 0;
  // 上次有進展時的累計掉幀數。只看「之後新增的掉幀」，開播初期或過去偶發的掉幀
  // 不能讓一段單純沒新畫面送達的時間被誤判成卡住、把直播中的輸出關掉。
  let droppedAtProgress = 0;

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
    releaseTimer = setInterval(() => {
      try {
        releasePendingTextures();
      } catch (error) {
        clearInterval(releaseTimer);
        releaseTimer = null;
        // A failed status read is not evidence that the GPU finished its copy.
        // Retain the source textures until a later successful native stop.
        setFailure(error);
      }
    }, 8);
    releaseTimer.unref?.();
  }

  function handlePaint(event, owner, ownerGeneration) {
    const texture = event?.texture;
    if (!texture) return;
    received += 1;
    let deferRelease = false;
    try {
      if (owner !== window || ownerGeneration !== generation || stopping || state === 'error') return;
      releasePendingTextures();
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
      // Ownership transfers as soon as send() accepts the frame, before status
      // reads or observers can throw. Never release a texture the GPU still uses.
      if (result.deferredRelease === true) {
        const validSequence = Number.isSafeInteger(result.sourceSequence) && result.sourceSequence > 0;
        pendingTextures.push({ texture, sequence: validSequence ? result.sourceSequence : Infinity });
        deferRelease = true;
        schedulePendingRelease();
        if (!validSequence) throw createError('INVALID_SPOUT_SOURCE_SEQUENCE', 'Spout did not provide a valid source-copy sequence.');
      }
      const nativeStatus = addon.getStatus?.();
      if (Number.isFinite(nativeStatus?.framesSent)) {
        const dropped = Number(nativeStatus.framesDropped) || 0;
        if (lastNativeSent === null || nativeStatus.framesSent !== lastNativeSent) {
          lastNativeSent = nativeStatus.framesSent;
          lastNativeProgressAt = Date.now();
          droppedAtProgress = dropped;
        } else if (dropped > droppedAtProgress && Date.now() - lastNativeProgressAt > 5000) {
          throw createError('SPOUT_OUTPUT_STALLED', 'Spout stopped delivering frames. Restart the output and check the selected GPU.');
        }
      }
      onFrame?.(status(), result);
    } catch (error) {
      setFailure(error);
      try {
        addon.stop();
        releasePendingTextures(true);
        senderStarted = false;
      } catch (_) { /* Preserve the output error and retain unacknowledged textures. */ }
    } finally {
      if (!deferRelease) releaseTexture(texture);
    }
  }

  async function start() {
    // Re-enter after stop: two callers waiting for the same stop must still
    // share one new renderer, and must not reuse a cancelled startup promise.
    if (stopPromise) {
      await stopPromise;
      return start();
    }
    // Error recovery must confirm native cleanup and retire the old renderer
    // before a new generation can use the sender or accept more textures.
    if (state === 'error') {
      await stop();
      return start();
    }
    if (startPromise) return startPromise;
    if (state === 'running' || state === 'starting') return status();
    const currentGeneration = ++generation;
    state = 'starting';
    lastError = null;
    lastNativeSent = null;
    lastNativeProgressAt = 0;
    droppedAtProgress = 0;
    let nextWindow = null;
    const pending = (async () => {
      try {
        nextWindow = new BrowserWindow({
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
        nextWindow.webContents.on('paint', event => handlePaint(event, nextWindow, currentGeneration));
        nextWindow.webContents.on('render-process-gone', (_event, details) => {
          if (window !== nextWindow || generation !== currentGeneration || stopping) return;
          setFailure(createError('SPOUT_RENDERER_GONE', 'Spout display renderer exited: ' + (details?.reason || 'unknown')));
          window = null;
          generation += 1;
          startPromise = null;
          try {
            addon.stop();
            releasePendingTextures(true);
            senderStarted = false;
          } catch (_) { /* Preserve renderer failure and retain unacknowledged textures. */ }
          if (!nextWindow.isDestroyed?.()) nextWindow.destroy?.();
        });
        nextWindow.on?.('closed', () => {
          // Old windows can deliver queued events after a replacement starts.
          if (window !== nextWindow || generation !== currentGeneration) return;
          window = null;
          generation += 1;
          startPromise = null;
          if (!stopping) {
            if (senderStarted) {
              try {
                addon.stop();
                releasePendingTextures(true);
                senderStarted = false;
              } catch (error) {
                setFailure(error);
                return;
              }
            }
            state = 'idle';
          }
        });
        if (generation !== currentGeneration || window !== nextWindow) return status();
        await nextWindow.loadURL('http://127.0.0.1:' + port + displayPath);
        return status();
      } catch (error) {
        // A cancelled load may reject after a replacement is already running.
        if (generation !== currentGeneration) return status();
        setFailure(error);
        if (window === nextWindow) window = null;
        if (nextWindow && !nextWindow.isDestroyed?.()) nextWindow.destroy?.();
        try {
          addon.stop();
          releasePendingTextures(true);
          senderStarted = false;
        } catch (_) { /* Preserve startup error and retain unacknowledged textures. */ }
        throw lastError;
      }
    })();
    // Construction hooks can synchronously cancel this generation.
    if (generation === currentGeneration) startPromise = pending;
    const clear = () => { if (startPromise === pending) startPromise = null; };
    pending.then(clear, clear);
    return pending;
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    generation += 1;
    startPromise = null;
    // Register the operation before any window/native cleanup can re-enter.
    const operation = Promise.resolve().then(() => {
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
      } catch (error) {
        setFailure(error);
        throw error;
      }
    });
    const pending = operation.finally(() => {
      if (stopPromise === pending) {
        stopping = false;
        stopPromise = null;
      }
    });
    stopPromise = pending;
    return pending;
  }

  return Object.freeze({ start, stop, getStatus: status, options });
}

module.exports = { createSpoutDisplayOutput, loadSpoutAddon };
