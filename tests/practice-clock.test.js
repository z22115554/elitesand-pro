'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Timeline } = require('../public/js/practice-clock');

test('maps effective key and piecewise speed without rewriting previous time', () => {
  const t = new Timeline({ maxExtrapolationSeconds: 10 });
  t.record({ audioTime: 10, sourceTime: 0, key: 0, tempo: 1, playing: true });
  t.record({ audioTime: 12, sourceTime: 2, key: -2, tempo: 0.5, playing: true });
  assert.equal(t.map(11).sourceTime, 1);
  assert.equal(t.map(11).key, 0);
  assert.equal(t.map(13).sourceTime, 2.5);
  assert.equal(t.map(13).key, -2);
  assert.equal(t.map(13).generation, 0);
});

test('calibration and hardware latencies map capture time back to audible reference', () => {
  const t = new Timeline({ inputLatencySec: 0.04, outputLatencySec: 0.06, dspLatencySec: 0.02, calibrationMs: 30 });
  t.record({ audioTime: 10, sourceTime: 3, playing: true, tempo: 1 });
  const result = t.map(10.35);
  assert.ok(Math.abs(result.sourceTime - 3.2) < 1e-8);
  assert.ok(Math.abs(result.correctionSeconds - 0.15) < 1e-9);
  t.setLatencies({ calibrationMs: -20 });
  assert.ok(Math.abs(t.map(10.35).sourceTime - 3.25) < 1e-8);
  assert.equal(t.map(9).valid, false);
});

test('pause freezes source time; seek creates a generation and preserves historic mapping', () => {
  const t = new Timeline({ maxExtrapolationSeconds: 10 });
  t.record({ audioTime: 0, sourceTime: 0, tempo: 1, playing: true });
  t.record({ audioTime: 1, sourceTime: 1, playing: false });
  assert.equal(t.map(2).sourceTime, 1);
  assert.equal(t.map(2).playing, false);
  t.record({ audioTime: 3, sourceTime: 40, reason: 'seek', playing: true });
  assert.equal(t.map(2).generation, 0);
  assert.equal(t.map(3).generation, 1);
  assert.equal(t.map(4).sourceTime, 41);
});

test('rejects stale acknowledgements and previous generation records', () => {
  const t = new Timeline();
  t.record({ audioTime: 4, sourceTime: 4, generation: 2, playing: true });
  assert.equal(t.record({ audioTime: 3, sourceTime: 3, generation: 1 }), false);
  assert.equal(t.record({ audioTime: 5, sourceTime: 5, generation: 1 }), false);
  assert.equal(t.getSnapshot().last.generation, 2);
  assert.equal(t.getSnapshot().droppedRecords, 2);
  assert.equal(t.map(5).reason, 'stale-clock');
});

test('bounds clock history and refuses to invent a map outside retained history', () => {
  const t = new Timeline({ maxSegments: 8 });
  for (let i = 0; i < 100; i++) t.record({ audioTime: i / 10, sourceTime: i / 10, playing: true });
  assert.equal(t.getSnapshot().segments, 8);
  assert.equal(t.map(1).valid, false);
  assert.equal(t.map(9.9).valid, true);
  assert.equal(t.map(NaN).valid, false);
  assert.equal(t.record({ audioTime: NaN, sourceTime: 0 }), false);
  assert.equal(t.record({ audioTime: 0, sourceTime: Infinity }), false);
});

test('sample frame API and duration limit', () => {
  const t = new Timeline({ duration: 4, maxExtrapolationSeconds: 10 });
  t.record({ frame: 48000, sampleRate: 48000, sourceTime: 3, tempo: 1.5, key: 99, playing: true });
  assert.equal(t.map(2).sourceTime, 4);
  assert.equal(t.map(2).key, 12);
  t.reset();
  assert.equal(t.map(2).valid, false);
});
