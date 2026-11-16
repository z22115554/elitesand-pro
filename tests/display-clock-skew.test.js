'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadState, loadDisplay } = require('./helpers/runtime-audit-fixtures');

for (const event of ['state:sync', 'state:recovery']) {
  for (const skew of [-86400000, 0, 86400000]) {
    test(`${event}: recovery uses server age with client clock skew ${skew}ms`, () => {
      const display = loadDisplay(undefined, { wallTime: 100000 + skew });
      display.emit(event, { currentTime: 10, isPlaying: true, playbackRate: 1.5,
        serverTimestamp: 99200, playbackAgeMs: 800 });
      assert.equal(display.clock(), 11200);
      display.setWallTime(-90000000);
      display.advance(200);
      assert.equal(display.clock(), 11500, 'wall-clock changes must not change the running slope');
      display.emit('speed:update', 0.5);
      assert.equal(display.clock(), 11500);
      display.advance(200);
      assert.equal(display.clock(), 11600);
    });
  }

  test(`${event}: paused and older-server snapshots never use client wall time`, () => {
    const display = loadDisplay(undefined, { wallTime: 999999999 });
    display.emit(event, { currentTime: 10, isPlaying: false, playbackRate: 1.5,
      serverTimestamp: 1, playbackAgeMs: 800 });
    display.advance(200);
    assert.equal(display.clock(), 10000);
    display.emit(event, { currentTime: 20, isPlaying: true, serverTimestamp: 1 });
    assert.equal(display.clock(), 20000, 'older servers safely recover at the supplied position');
  });

  test(`${event}: invalid values cannot poison the recovered clock`, () => {
    const display = loadDisplay();
    for (const age of [NaN, Infinity, -1, 30001, '800', null]) {
      display.emit(event, { currentTime: 10, isPlaying: true, serverTimestamp: 1,
        playbackAgeMs: age, playbackRate: NaN });
      assert.equal(display.clock(), 10000);
    }
    for (const time of [NaN, Infinity, Number.MAX_VALUE, -1, '10']) {
      display.emit(event, { currentTime: time, isPlaying: true, playbackAgeMs: 0 });
      assert.equal(display.clock(), 10000);
    }
    display.emit(event, { currentTime: 10, isPlaying: true, playbackAgeMs: 800, playbackRate: 99 });
    assert.equal(display.clock(), 11200, 'recovery uses the same bounded rate as speed updates');
  });
}

test('server snapshots provide bounded age for control, read-only and recovery paths', () => {
  const { state } = loadState();
  state.playState.currentTime = 10;
  state.playState.lastStateUpdateTimestamp = 99200;
  for (const method of ['getPublicState', 'getReadOnlyState', 'getFullRecoveryState']) {
    assert.equal(state[method]().playbackAgeMs, 800, method);
    assert.equal(state[method]().serverTimestamp, 99200, 'old clients retain their existing field');
  }
  for (const timestamp of [NaN, Infinity, 100001, -1000000, '99200']) {
    state.playState.lastStateUpdateTimestamp = timestamp;
    assert.equal(state.getPublicState().playbackAgeMs, 0, `unusable timestamp ${timestamp}`);
  }
});

test('one real server snapshot restores identically in clients one day apart', () => {
  const { state } = loadState();
  state.playState.currentTime = 45;
  state.playState.isPlaying = true;
  state.playState.playbackRate = 0.5;
  state.playState.lastStateUpdateTimestamp = 99000;
  const snapshot = JSON.parse(JSON.stringify(state.getReadOnlyState()));
  const displays = [loadDisplay(undefined, { wallTime: 1 }), loadDisplay(undefined, { wallTime: 86400001 })];
  displays.forEach(display => display.emit('state:recovery', snapshot));
  assert.deepEqual(displays.map(display => display.clock()), [45500, 45500]);
  displays.forEach(display => display.advance(200));
  assert.deepEqual(displays.map(display => display.clock()), [45600, 45600]);
});
