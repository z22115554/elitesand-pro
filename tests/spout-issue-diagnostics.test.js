'use strict';

const fs = require('fs');
const path = require('path');
const { createSpoutIssueDiagnostics } = require('../electron/spout-issue-diagnostics');
const { createRuntimeEvidence } = require('../server/services/runtime-evidence');
const feedbackReport = require('../server/services/feedback-report');

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

  test('Spout issue diagnostics are collected in release builds, not only the Spout lab', () => {
    const shell = fs.readFileSync(path.join(__dirname, '..', 'electron', 'shell.js'), 'utf8');
    ok(!/isSpoutExperiment\)\s*spoutIssueDiagnostics\.(start|stop)/.test(shell), 'diagnostics start/stop must not be gated on the lab flag: ');
    ok(!shell.includes('!isSpoutExperiment || event?.sender'), 'diagnostics IPC must answer in release builds: ');
    ok(shell.indexOf('spoutIssueDiagnostics.start(getSpoutOutputStatus)') < shell.indexOf('await spoutDisplayOutput.start()'),
      'sampling must begin before output start so startup failures are recorded: ');
  });

  test('Runtime evidence records the Spout lyrics page and playback booleans only', () => {
    let clock = 1000;
    const evidence = createRuntimeEvidence({ now: () => clock });
    eq(evidence.getSnapshot().playback, null, 'no probe means no playback claim: ');
    evidence.setPlaybackProbe(() => ({ trackLoaded: { title: 'secret song' }, playing: 0, title: 'secret song' }));
    evidence.recordSocketConnected({ socketId: 's1', clientType: 'display-spout' });
    clock += 500;
    const snapshot = evidence.getSnapshot();
    eq(snapshot.clients['display-spout'].activeConnections, 1);
    eq(snapshot.clients['display-spout'].connections, 1);
    eq(JSON.stringify(snapshot.playback), JSON.stringify({ trackLoaded: true, playing: false }));
    ok(!JSON.stringify(snapshot).includes('secret song'), 'track metadata must never enter evidence: ');
    eq(snapshot.obs.displaySeen, false, 'Spout page must not count as an OBS source: ');
    evidence.setPlaybackProbe(() => { throw new Error('boom'); });
    eq(evidence.getSnapshot().playback, null, 'a failing probe must not break the snapshot: ');
  });

  test('Problem reports state whether the Spout page was connected and a song was playing', () => {
    const base = {
      schemaVersion: 1, type: 'spout', title: 'Spout 沒有歌詞', description: '接收端看得到來源但沒有歌詞',
      steps: '開啟 Spout', actual: '空白', includeDiagnostics: true,
    };
    const evidence = createRuntimeEvidence({ now: () => 2000 });
    evidence.setPlaybackProbe(() => ({ trackLoaded: false, playing: false }));
    const idle = feedbackReport.buildReport(base, { runtimeEvidence: evidence.getSnapshot() });
    ok(idle.ok);
    ok(idle.plainText.includes('Spout 歌詞頁：目前未連線（本場連線 0 次）'), idle.plainText);
    ok(idle.plainText.includes('送出當下播放狀態：沒有載入歌曲'), idle.plainText);
    ok(idle.plainText.includes('還沒啟動過 Spout 輸出'), 'empty Spout log must explain why: ');

    evidence.recordSocketConnected({ socketId: 's1', clientType: 'display-spout' });
    evidence.setPlaybackProbe(() => ({ trackLoaded: true, playing: true }));
    const live = feedbackReport.buildReport(base, { runtimeEvidence: evidence.getSnapshot() });
    ok(live.plainText.includes('Spout 歌詞頁：目前已連線（本場連線 1 次）'), live.plainText);
    ok(live.plainText.includes('送出當下播放狀態：播放中'), live.plainText);
  });
}

module.exports = { register };
