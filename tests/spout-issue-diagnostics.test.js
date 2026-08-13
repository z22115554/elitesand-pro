'use strict';

const { createSpoutIssueDiagnostics } = require('../electron/spout-issue-diagnostics');

function register({ test, eq, ok }) {
  test('Spout issue diagnostics keep a bounded in-memory timeline without a machine LUID', () => {
    let clock = Date.parse('2026-08-14T00:00:00.000Z');
    let interval = null;
    const diagnostics = createSpoutIssueDiagnostics({
      now: () => clock,
      maxSamples: 2,
      setIntervalImpl(callback) { interval = callback; return { unref() {} }; },
      clearIntervalImpl() { interval = null; },
    });
    let sent = 8;
    diagnostics.start(() => ({
      output: {
        state: 'running', width: 1920, height: 1080, fps: 60, framesReceived: sent, framesReleased: sent,
        native: {
          framesSent: sent, framesDropped: 1, queueDepth: 2, maxQueueDepth: 3, inFlightFrames: 1,
          lastGpuSyncMs: 10.5, avgGpuSyncMs: 9.25, maxGpuSyncMs: 15, gpuSyncTimeouts: 2,
          lastSourceCopySyncMs: 5, avgSourceCopySyncMs: 4, maxSourceCopySyncMs: 6, sourceCopySyncTimeouts: 1,
          adapterVendorId: 4318, adapterDeviceId: 9476, adapterLuid: 999999,
        },
      },
    }));
    clock += 5000;
    sent += 10;
    interval();
    clock += 5000;
    sent += 10;
    interval();
    const snapshot = diagnostics.stop();
    eq(snapshot.active, false);
    eq(snapshot.samples.length, 2, 'timeline must stay bounded: ');
    eq(snapshot.samples.at(-1).framesSent, 28);
    eq(snapshot.samples.at(-1).gpuSync.averageMs, 9.25);
    eq(snapshot.samples.at(-1).adapter.vendorId, 4318);
    ok(!Object.hasOwn(snapshot.samples.at(-1).adapter, 'luid'), 'machine-specific LUID must not enter issue diagnostics: ');
    eq(interval, null, 'sampling timer must release on output stop: ');
  });
}

module.exports = { register };
