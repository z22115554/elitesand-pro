'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Scoring = require('../public/js/practice/practice-scoring');
globalThis.PracticeScoring = Scoring;
globalThis.PracticeFx = require('../public/js/practice/practice-fx');
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.window = { devicePixelRatio: 1 };
require('../public/js/practice/practice-engine');
const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
function element() { return { textContent: '', hidden: false, innerHTML: '', children: [], style: { setProperty() {} },
  classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, appendChild() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, right: 100 }) }; }
globalThis.document = { createElement: element };
function fixture(notes = [{ start: 0, end: 6, midi: 60, line: 0 }], duration = 6) {
  const elements = new Map();
  const root = element();
  root.querySelector = (sel) => {
    if (sel.includes('canvas')) return { clientWidth: 0, clientHeight: 0, getContext: () => ctx };
    if (!elements.has(sel)) elements.set(sel, element());
    return elements.get(sel);
  };
  let t = 0, tempo = 1, octave = false, finishCount = 0;
  const engine = PracticeEngine.createPracticeEngine({ root, role: 'panel', clock: () => ({ t, tempo }),
    getOptions: () => ({ allowOctave: octave }), onFinish: () => finishCount++ });
  const lines = Array.from({ length: 1 + Math.max(...notes.map((n) => n.line)) }, (_, line) => {
    const ns = notes.filter((n) => n.line === line);
    return { start: Math.min(...ns.map((n) => n.start)), end: Math.max(...ns.map((n) => n.end)), text: `line ${line}`, words: [] };
  });
  engine.setGuide(Scoring.prepareGuide({ guideId: 'test-guide', trackId: 'track', duration, notes, lines }));
  engine.setPlaying(true, 0);
  const send = (at, midi = 60, key = 0, valid = true, generation) => {
    t = at;
    engine.pitch({ f0: midi ? 440 * 2 ** ((midi - 69) / 12) : 0, clarity: 0.99, rms: midi ? 0.05 : 0 }, { t, key, tempo, valid, generation });
  };
  return { engine, send, time: (v) => { t = v; }, tempo: (v) => { tempo = v; }, octave: (v) => { octave = v; }, finishCount: () => finishCount };
}
function pass(speed, pitch = 61.5, configure) {
  const f = fixture();
  f.tempo(speed);
  for (let real = 0; real <= 6 / speed + 1e-7; real += 0.01) {
    const t = Math.min(6, real * speed);
    if (configure) configure(f, t);
    f.send(t, pitch);
  }
  f.time(6);
  return f.engine.finish('mic');
}

test('source-time integration gives the same 150-cent score at 0.5x, 1x and 1.5x', () => {
  const takes = [0.5, 1, 1.5].map((speed) => pass(speed));
  assert.ok(Math.max(...takes.map((r) => r.score)) - Math.min(...takes.map((r) => r.score)) < 0.08);
  for (const take of takes) {
    assert.ok(Math.abs(take.observedSeconds - 5.85) < 0.02);
    assert.ok(Math.abs(take.lineFeedback[0].signedCents - 150) < 0.01);
  }
});

test('changing speed and key mid-song preserves score and records a mixed context', () => {
  const f = fixture();
  for (let t = 0; t <= 6; t += t < 3 ? 0.005 : 0.015) {
    const key = t < 3 ? -3 : 4;
    f.tempo(t < 3 ? 0.5 : 1.5); f.send(t, 61.5 + key, key);
  }
  f.time(6);
  const take = f.engine.finish('mic');
  assert.ok(Math.abs(take.score - pass(1).score) < 0.15);
  assert.equal(take.mixedContext, true);
  assert.equal(take.key, -3);
});

test('fixed positive and negative keys compare in the original MIDI space', () => {
  for (const key of [-5, 4]) {
    const f = fixture();
    for (let t = 0; t <= 6; t += 0.01) f.send(t, 60 + key, key);
    f.time(6);
    const take = f.engine.finish('mic');
    assert.equal(take.score, 100);
    assert.equal(take.mixedContext, false);
    assert.ok(Math.abs(take.pitchTrace[10].midi - 60) < 1e-9);
  }
});

test('rejected detector packets cannot change comparison conditions or bridge an input reset', () => {
  const f = fixture();
  f.send(0.2, 60, 0, true, 2); f.send(0.21, 60, 0, true, 2);
  const before = f.engine.getGuide().notes[0].seen;
  f.send(0.22, 65, 5, true, 1);
  f.send(0.21, 65, 5, true, 2);
  assert.equal(f.engine._state.mixedContext, false);
  assert.equal(f.engine.getGuide().notes[0].seen, before);
  f.engine.resetInput();
  f.send(1, 60, 0, true, 2);
  assert.equal(f.engine.getGuide().notes[0].seen, before);
  f.send(1.01, 60, 0, true, 2);
  assert.ok(Math.abs(f.engine.getGuide().notes[0].seen - before - 0.01) < 1e-9);
});

test('pauses, invalid mapping, backwards timestamps and dropped frames do not credit missing time', () => {
  const f = fixture();
  f.send(0); f.send(0.01); f.send(1); // gap: no held note credited
  assert.equal(f.engine.getGuide().notes[0].seen, 0);
  f.send(1.01);
  assert.ok(f.engine.getGuide().notes[0].seen < 0.011);
  f.engine.setPlaying(false, 1.01); f.send(2);
  f.engine.setPlaying(true, 1.01); f.send(2.1);
  const before = f.engine.getGuide().notes[0].seen;
  f.send(2.11, 60, 0, false); f.send(3);
  assert.equal(f.engine.getGuide().notes[0].seen, before);
  f.send(2.9);
  assert.equal(f.engine.getGuide().notes[0].seen, before);
});

test('strict mode preserves real reference octave jumps in both directions', () => {
  const f = fixture([{ start: 0, end: 2, midi: 60, line: 0 }, { start: 2, end: 4, midi: 72, line: 0 },
    { start: 4, end: 6, midi: 60, line: 0 }]);
  for (let t = 0; t <= 6; t += 0.01) f.send(t, t >= 2 && t < 4 ? 72 : 60);
  f.time(6);
  assert.equal(f.engine.finish('mic').score, 100);
});

test('occasional detector octave errors recover, while sustained wrong octaves are not locked to history', () => {
  const f = fixture();
  for (let t = 0; t <= 6; t += 0.01) f.send(t, t > 2 && t < 2.03 ? 72 : 60);
  f.time(6);
  assert.equal(f.engine.finish('mic').score, 100);
  const wrong = fixture();
  for (let t = 0; t <= 6; t += 0.01) wrong.send(t, t < 1 ? 60 : 72);
  wrong.time(6);
  assert.ok(wrong.engine.finish('mic').score < 35);
});

test('feedback ranks supported weak lines and keeps signed sharp/flat and observed onset', () => {
  const f = fixture([{ start: 0, end: 2, midi: 60, line: 0 }, { start: 2, end: 4, midi: 60, line: 1 },
    { start: 4, end: 6, midi: 60, line: 2 }, { start: 6, end: 8, midi: 60, line: 3 }], 8);
  for (let t = 0; t < 6; t += 0.01) f.send(t, t < 0.12 ? 0 : t < 2 ? 61.7 : t < 4 ? 58.5 : 60);
  f.time(8);
  const take = f.engine.finish('mic');
  assert.deepEqual(take.weakLines.map((r) => r.line), [0, 1, 2]);
  assert.ok(take.lineFeedback[0].signedCents > 160);
  assert.ok(take.lineFeedback[1].signedCents < -140);
  assert.ok(take.lineFeedback[0].onsetMs >= 100 && take.lineFeedback[0].onsetMs <= 140);
  assert.equal(take.lineFeedback[1].onsetMs, null, 'continuous voicing cannot establish a fresh onset');
  assert.equal(take.lineFeedback[3].score, null, 'no detector data cannot imply poor singing');
});

test('range clips note boundaries and finish excludes all remaining full-song notes', () => {
  const f = fixture([{ start: 0, end: 6, midi: 60, line: 0 }, { start: 8, end: 12, midi: 60, line: 1 }], 12);
  f.engine.setRange({ start: 1, end: 4 }); f.time(1); f.engine.setPlaying(true, 1);
  for (let t = 1; t <= 4; t += 0.01) f.send(t, 60);
  f.time(4);
  const take = f.engine.finish('mic');
  assert.equal(take.scope.type, 'range');
  assert.ok(take.requiredSeconds < 3);
  assert.equal(take.lineFeedback.length, 1);
  assert.equal(take.lineFeedback[0].start, 1);
  assert.equal(take.lineFeedback[0].end, 4);
  assert.equal(take.score, 100);
  f.engine.setRange(null);
  assert.equal(f.engine.getGuide().notes[0].start, 0);
  assert.equal(f.engine.getGuide().notes.length, 2);
});

test('completed immutable snapshots survive restart, finish callback is once, song switch clears identity', () => {
  const f = fixture();
  for (let t = 0; t <= 6; t += 0.01) f.send(t, 60);
  f.time(6);
  const take = f.engine.finish('demo');
  assert.strictEqual(f.engine.finish('mic'), take);
  assert.equal(f.finishCount(), 1);
  assert.equal(take.source, 'demo');
  assert.throws(() => { take.lineFeedback[0].score = 1; }, TypeError);
  const serialized = JSON.stringify(take);
  f.engine.startNewPass();
  assert.strictEqual(f.engine.getTake(), take);
  f.engine.setPlaying(true, 0); f.send(0); f.send(0.01, 65);
  assert.equal(JSON.stringify(take), serialized);
  f.engine.setGuide(null);
  assert.equal(f.engine.getTake(), null);
});

test('ghost data is copied, bounded, and cannot affect the new take score', () => {
  const f = fixture();
  const trace = [{ t: 1, midi: 83 }, { t: 2, gap: true }, { t: 99, midi: 60 }];
  f.engine.setGhost(trace); trace[0].midi = 12;
  assert.equal(f.engine._state.ghost[0].midi, 83);
  assert.equal(f.engine._state.ghost.length, 2);
  for (let t = 0; t <= 6; t += 0.01) f.send(t, 60);
  f.time(6);
  const take = f.engine.finish('mic');
  assert.equal(take.score, 100);
  assert.ok(take.pitchTrace.every((p) => p.gap || Math.abs(p.midi - 60) < 1e-9));
});

test('early finish and seek are partial and never count the rest of an unfinished note', () => {
  const f = fixture();
  for (let t = 0; t <= 3; t += 0.01) f.send(t);
  f.time(3);
  const take = f.engine.finish('mic');
  assert.equal(take.scope.type, 'partial');
  assert.equal(take.requiredSeconds, 2.85);
  assert.equal(take.score, 100);
  const skipped = fixture(); skipped.engine.seek(2); skipped.time(6);
  assert.equal(skipped.engine.finish('mic').scope.type, 'partial');
});

test('frame intervals are split exactly at grace and reference-note boundaries', () => {
  const f = fixture([{ start: 0, end: 1, midi: 60, line: 0 }, { start: 1, end: 2, midi: 72, line: 0 }], 2);
  f.send(0.1); f.send(0.14); f.send(0.16); f.send(0.18);
  assert.ok(Math.abs(f.engine.getGuide().notes[0].seen - 0.03) < 1e-9);
  f.send(0.99); f.send(1.01, 72); f.send(1.03, 72);
  assert.ok(Math.abs(f.engine.getGuide().notes[0].seen - 0.04) < 1e-9);
  assert.equal(f.engine.getGuide().notes[1].seen, 0, 'next note grace is never scored by the old pitch');
  // Warm the three-frame median inside the grace window after the detector gap.
  f.send(1.10, 72); f.send(1.12, 72); f.send(1.14, 72); f.send(1.16, 72); f.send(1.17, 72);
  assert.ok(Math.abs(f.engine.getGuide().notes[1].seen - 0.02) < 1e-9);
  assert.ok(Math.abs(f.engine.getGuide().notes[1].hit - 0.02) < 1e-9);
});

test('no observed voice gives neither a score nor weak-phrase advice', () => {
  const f = fixture();
  for (let t = 0; t <= 6; t += 0.01) f.send(t, 0);
  f.time(6);
  const take = f.engine.finish('mic');
  assert.equal(take.score, null);
  assert.deepEqual(take.weakLines, []);
  assert.equal(take.lineFeedback[0].signedCents, null);
});

test('out-of-order detector packets cannot replay time and generations cannot bridge a seek', () => {
  const f = fixture();
  f.send(0.2); f.send(0.21); f.send(0.22); f.send(0.205); f.send(0.23);
  assert.ok(Math.abs(f.engine.getGuide().notes[0].seen - 0.03) < 1e-9);
  const g = fixture();
  g.send(0.2, 60, 0, true, 1); g.send(0.21, 60, 0, true, 1);
  g.send(0.22, 60, 0, true, 2); g.send(0.23, 60, 0, true, 2);
  assert.ok(Math.abs(g.engine.getGuide().notes[0].seen - 0.02) < 1e-9);
  g.time(6);
  assert.equal(g.engine.finish('mic').scope.type, 'partial');
});

test('long source-time traces stay bounded while retaining the take timeline', () => {
  const f = fixture([{ start: 0, end: 400, midi: 60, line: 0 }], 400);
  for (let i = 0; i <= 40000; i++) f.send(i / 100);
  f.time(400);
  const take = f.engine.finish('mic');
  assert.ok(take.pitchTrace.length <= 12000);
  assert.equal(take.pitchTrace[0].t, 0);
  assert.ok(take.pitchTrace.at(-1).t > 399.9);
  assert.ok(take.pitchTrace.every((p, i, all) => i === 0 || p.t >= all[i - 1].t));
});

test('a completed clipped range passes the real history API duration and scope validation', () => {
  const { sanitizeTake } = require('../server/services/practice-history');
  const f = fixture();
  f.engine.setRange({ start: 0.5, end: 4.5 }); f.time(0.5); f.engine.setPlaying(true, 0.5);
  for (let i = 50; i <= 450; i++) f.send(i / 100);
  f.time(4.5);
  const take = f.engine.finish('mic');
  const stored = sanitizeTake({ ...take, clientTakeId: 'core-range', trackId: 'track', title: 'Range', duration: 6, completed: true, valid: true });
  assert.deepEqual(stored.scope, { type: 'range', start: 0.5, end: 4.5 });
  assert.equal(stored.requiredSeconds, 3.85);
  assert.equal(stored.observedSeconds, 3.85);
  assert.equal(stored.score, 100);
  assert.equal(stored.comparable, true);
});

test('explicit EOF completes the full scope despite audible-clock latency without inventing observed sound', () => {
  const f = fixture();
  for (let i = 0; i <= 570; i++) f.send(i / 100, 61.5);
  f.time(5.7);
  const before = f.engine.getGuide().notes[0];
  const observed = before.seen, voiced = before.voiced, hit = before.hit;
  const take = f.engine.finish('mic', { end: 6 });
  assert.deepEqual(take.scope, { type: 'full', start: 0, end: 6 });
  assert.equal(take.requiredSeconds, 5.85);
  assert.equal(take.observedSeconds, observed);
  assert.equal(take.voicedSeconds, voiced);
  assert.equal(f.engine.getGuide().notes[0].hit, hit);
  assert.ok(take.score < 100 * Scoring.credit(150) / Scoring.RULE.coverage, 'unobserved tail creates no credit');
  assert.strictEqual(f.engine.finish('mic', { end: 6 }), take);
  assert.equal(f.finishCount(), 1);
  const manual = fixture();
  for (let i = 0; i <= 570; i++) manual.send(i / 100, 61.5);
  manual.time(5.7);
  assert.equal(manual.engine.finish('mic').scope.type, 'partial', 'manual finish still follows the observed/current endpoint');
});

test('an explicit EOF is clamped to the selected range without crediting the rest of the song', () => {
  const f = fixture();
  f.engine.setRange({ start: 1, end: 4 }); f.time(1); f.engine.setPlaying(true, 1);
  for (let i = 100; i <= 370; i++) f.send(i / 100, 60);
  f.time(3.7);
  const observed = f.engine.getGuide().notes[0].seen;
  const take = f.engine.finish('mic', { end: 6 });
  assert.deepEqual(take.scope, { type: 'range', start: 1, end: 4 });
  assert.equal(take.requiredSeconds, 2.85);
  assert.equal(take.observedSeconds, observed);
  assert.equal(take.voicedSeconds, observed);
  assert.equal(take.lineFeedback[0].end, 4);
  assert.ok(take.pitchTrace.every(point => point.t <= 3.7));
});
