'use strict';

// Keep a small, volatile Spout timeline for a user-initiated problem report.
// It is never written to disk and it is never sent unless the renderer asks
// for it while preparing a report whose type is explicitly "spout".

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_SAMPLES = 60;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function bounded(value, min, max, fallback = 0) {
  const number = finite(value, fallback);
  return Math.max(min, Math.min(max, number));
}

function sampleOutput(status, elapsedMs) {
  const output = status?.output || {};
  const native = output.native || {};
  return Object.freeze({
    elapsedMs: bounded(elapsedMs, 0, 24 * 60 * 60 * 1000),
    state: ['idle', 'starting', 'running', 'error'].includes(output.state) ? output.state : 'idle',
    width: bounded(output.width, 0, 3840),
    height: bounded(output.height, 0, 2160),
    configuredFps: bounded(output.fps, 0, 240),
    framesReceived: bounded(output.framesReceived, 0, Number.MAX_SAFE_INTEGER),
    framesReleased: bounded(output.framesReleased, 0, Number.MAX_SAFE_INTEGER),
    framesSent: bounded(native.framesSent, 0, Number.MAX_SAFE_INTEGER),
    framesDropped: bounded(native.framesDropped, 0, Number.MAX_SAFE_INTEGER),
    queueDepth: bounded(native.queueDepth, 0, 16),
    maxQueueDepth: bounded(native.maxQueueDepth, 0, 16),
    inFlightFrames: bounded(native.inFlightFrames, 0, 16),
    gpuSync: Object.freeze({
      lastMs: bounded(native.lastGpuSyncMs, 0, 60000),
      averageMs: bounded(native.avgGpuSyncMs, 0, 60000),
      maxMs: bounded(native.maxGpuSyncMs, 0, 60000),
      timeouts: bounded(native.gpuSyncTimeouts, 0, Number.MAX_SAFE_INTEGER),
    }),
    sourceCopySync: Object.freeze({
      lastMs: bounded(native.lastSourceCopySyncMs, 0, 60000),
      averageMs: bounded(native.avgSourceCopySyncMs, 0, 60000),
      maxMs: bounded(native.maxSourceCopySyncMs, 0, 60000),
      timeouts: bounded(native.sourceCopySyncTimeouts, 0, Number.MAX_SAFE_INTEGER),
    }),
    // Adapter vendor/device identify a driver family, but deliberately omit
    // the LUID: it is machine-specific and is not needed to triage Spout.
    adapter: Object.freeze({
      vendorId: bounded(native.adapterVendorId, 0, 0xFFFFFFFF),
      deviceId: bounded(native.adapterDeviceId, 0, 0xFFFFFFFF),
    }),
  });
}

function createSpoutIssueDiagnostics({
  now = () => Date.now(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxSamples = DEFAULT_MAX_SAMPLES,
} = {}) {
  let session = null;

  function capture() {
    if (!session) return null;
    const elapsedMs = now() - session.startedAt;
    const sample = sampleOutput(session.getStatus(), elapsedMs);
    session.samples.push(sample);
    if (session.samples.length > maxSamples) session.samples.splice(0, session.samples.length - maxSamples);
    return sample;
  }

  function start(getStatus) {
    if (typeof getStatus !== 'function') return null;
    if (session?.active) return getSnapshot();
    session = {
      active: true,
      startedAt: now(),
      stoppedAt: null,
      getStatus,
      samples: [],
      intervalTimer: null,
    };
    capture();
    session.intervalTimer = setIntervalImpl(capture, intervalMs);
    session.intervalTimer?.unref?.();
    return getSnapshot();
  }

  function stop() {
    if (!session?.active) return getSnapshot();
    capture();
    session.active = false;
    session.stoppedAt = now();
    clearIntervalImpl(session.intervalTimer);
    session.intervalTimer = null;
    return getSnapshot();
  }

  function getSnapshot() {
    if (!session) return Object.freeze({ schemaVersion: 1, available: false, active: false, samples: [] });
    return Object.freeze({
      schemaVersion: 1,
      available: session.samples.length > 0,
      active: session.active,
      durationMs: Math.max(0, (session.stoppedAt || now()) - session.startedAt),
      samples: session.samples.slice(),
    });
  }

  return Object.freeze({ start, stop, getSnapshot });
}

module.exports = { DEFAULT_INTERVAL_MS, DEFAULT_MAX_SAMPLES, createSpoutIssueDiagnostics, sampleOutput };
