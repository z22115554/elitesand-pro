'use strict';
// 練唱 v2 共用模組：演出風格表、評分規則、引擎（面板端跳轉／結算、OBS 端接收）。
// 引擎本身在瀏覽器跑，這裡用最小的假 DOM／假畫布驅動它的邏輯，不測畫面。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const Fx = require('../public/js/practice/practice-fx');
const Scoring = require('../public/js/practice/practice-scoring');
const { FX_IDS: SERVER_FX_IDS } = require('../server/services/practice-overlay');

function loadEngine() {
  globalThis.PracticeScoring = Scoring;
  globalThis.PracticeFx = Fx;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.document = { createElement: () => fakeElement() };
  globalThis.window = { devicePixelRatio: 1 };
  const file = path.join(__dirname, '..', 'public', 'js', 'practice', 'practice-engine.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return globalThis.PracticeEngine;
}

function fakeElement() {
  const classes = new Set();
  return {
    hidden: false, textContent: '', innerHTML: '', children: [], style: { setProperty() {} }, offsetWidth: 0,
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
    appendChild() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 50, right: 100 }),
  };
}

function fakeRoot() {
  const els = new Map();
  const canvas = { ...fakeElement(), clientWidth: 0, clientHeight: 0, getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }) };
  const root = fakeElement();
  root.style = { setProperty() {} };
  root.querySelector = (sel) => {
    const name = /data-ps="([^"]+)"/.exec(sel)[1];
    if (name === 'canvas') return canvas;
    if (!els.has(name)) els.set(name, fakeElement());
    return els.get(name);
  };
  return root;
}

// 兩句、每句兩個音；第二句在 30 秒之後
const guide = () => Scoring.prepareGuide({
  duration: 60, tuning: 0,
  lines: [
    { start: 1, end: 3, text: 'a b', words: [{ text: 'a', start: 1, end: 2 }, { text: 'b', start: 2, end: 3 }] },
    { start: 31, end: 33, text: 'c d', words: [{ text: 'c', start: 31, end: 32 }, { text: 'd', start: 32, end: 33 }] },
  ],
  notes: [
    { start: 1, end: 2, midi: 60, line: 0, word: 0 }, { start: 2, end: 3, midi: 62, line: 0, word: 1 },
    { start: 31, end: 32, midi: 64, line: 1, word: 0 }, { start: 32, end: 33, midi: 65, line: 1, word: 1 },
  ],
});
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
// 偵測器一格（10ms）；每 5 格同步一次，跟瀏覽器裡畫面更新／音訊執行緒推動的節奏相同
let frames = 0;
function sing(engine, t, midi, key) {
  engine.pitch({ f0: hz(midi), clarity: 0.95, rms: 0.05 }, { valid: true, t, key });
  if (++frames % 5 === 0) engine.syncFrame();
}

test('fx presets inherit from their parent and the server knows every id', () => {
  assert.deepEqual(Fx.fxChain('grand'), ['normal', 'warm', 'grand']);
  assert.deepEqual(Fx.fxChain('nope'), ['normal']);
  const grand = Fx.resolveFx('grand');
  assert.equal(grand.pulse, true, 'grand inherits pulse from warm');
  assert.equal(grand.sheen, true);
  assert.equal(Fx.resolveFx('quiet').particles, 0);
  assert.deepEqual(SERVER_FX_IDS, Fx.FX_IDS, 'server validates the same style ids as the menu');
  for (const id of Fx.FX_IDS) assert.match(Fx.FX_PRESETS[id].label, /^practice\.fx\./);
});

test('scoring is gentle near the target, folds octaves on request and excludes overlaps and interjections', () => {
  assert.equal(Scoring.credit(0), 1);
  assert.equal(Scoring.credit(75), 1);
  assert.equal(Scoring.credit(220), 0);
  const mid = Scoring.credit(150);
  assert.ok(mid > 0 && mid < 1, 'between the thresholds the credit falls smoothly');
  assert.equal(Scoring.centsOff(72, 60, true), 0);
  assert.equal(Scoring.centsOff(72, 60, false), 1200);
  const g = Scoring.prepareGuide({
    duration: 10, lines: [
      { start: 0, end: 4, text: 'x', words: [{ text: 'x', start: 0, end: 4 }] },
      { start: 3, end: 6, text: 'y', words: [{ text: 'y', start: 3, end: 6 }] },
    ], notes: [{ start: 0, end: 2, midi: 60, line: 0, word: 0 }, { start: 3.2, end: 3.8, midi: 62, line: 1, word: 0 }],
  });
  assert.ok(g.exclusions.some((r) => r.reasons.includes('overlap')), 'two lines sung at once are not scored');
  assert.ok(g.notes.find((n) => n.start === 3.2).excluded, 'notes inside the overlap are excluded');
  assert.equal(Scoring.latencyEstimate([100, 110, 100, 105, 100, 102]), 100);
  assert.equal(Scoring.latencyEstimate([100, 300]), null, 'too few or scattered samples give no estimate');
});

test('panel engine treats a clock jump as a seek: skipped notes are not counted as silent', () => {
  const Engine = loadEngine();
  let t = 0;
  const sent = [];
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, tempo: 1, playing: true }), onSync: (m) => sent.push(m) });
  engine.setGuide(guide());
  assert.equal(sent[0].type, 'song');
  engine.setPlaying(true, 0);
  // 唱第一句（準）
  for (t = 0.9; t < 3.3; t += 0.01) sing(engine, t, t < 2 ? 60 : 62, 0);
  // 直接跳到 30 秒（中間 27 秒都沒唱）
  t = 30.5; engine.syncFrame();
  assert.ok(sent.some((m) => m.type === 'seek' && Math.abs(m.offset - 30.5) < 1e-6), 'the jump is announced to OBS as a seek');
  for (t = 30.5; t < 33.3; t += 0.01) sing(engine, t, t < 32 ? 64 : 65, 0);
  engine.finish('mic');
  const stats = engine.getStats();
  assert.equal(stats.unscorable, false, 'the skipped stretch does not make the take look silent');
  assert.equal(stats.ratings.length, 2);
  assert.ok(stats.result.score > 80, `both lines sung on pitch score high (got ${stats.result.score})`);
  const last = sent.filter((m) => m.type === 'frame').pop();
  assert.equal(last.score.result.score, stats.result.score, 'the final frame carries the result to OBS');
});

test('panel engine applies the current key: singing transposed up still matches the original notes', () => {
  const Engine = loadEngine();
  let t = 0;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, tempo: 1, playing: true }), onSync: () => {} });
  engine.setGuide(guide());
  engine.setPlaying(true, 0);
  for (t = 0.9; t < 3.3; t += 0.01) sing(engine, t, (t < 2 ? 60 : 62) + 3, 3);
  t = 3.5; engine.syncFrame();
  assert.equal(engine.getStats().ratings[0].tag, 'PERFECT');
});

test('OBS engine only draws what it receives: style, song, frames, seek and clear', () => {
  const Engine = loadEngine();
  const root = fakeRoot();
  const engine = Engine.createPracticeEngine({ role: 'source', root });
  engine.receive({ type: 'style', style: { fx: 'grand', bg: false } });
  assert.ok(root.classList.contains('fx-warm') && root.classList.contains('fx-grand') && root.classList.contains('no-bg'));
  engine.receive({ type: 'song', song: { duration: 60, lines: guide().lines, notes: guide().notes.map(({ start, end, midi, line, word }) => ({ start, end, midi, line, word })) } });
  engine.receive({ type: 'frame', clock: { playing: true, t: 1.5, tempo: 1 }, trail: [{ t: 1.5, raw: 60, ribbon: 60, bar: 60, ok: true, near: true, v: 0.5 }],
    notes: [[0, [[1, 1.5]], 0.5, 0.5, 0.5]], user: { t: 1.5, midi: 60 }, score: { target: 90, unscorable: false, result: null }, events: [] });
  assert.deepEqual(engine.getGuide().notes[0].fills, [[1, 1.5]]);
  engine.receive({ type: 'seek', offset: 0.5 });
  assert.deepEqual(engine.getGuide().notes[0].fills, [], 'a seek clears what comes after it');
  engine.receive({ type: 'clear' });
  assert.equal(engine.getGuide(), null);
  // 面板專屬的操作在 OBS 端不做事
  engine.pitch({ f0: 440, clarity: 1, rms: 0.1 }, { valid: true, t: 1, key: 0 });
  engine.finish('mic');
  assert.equal(engine.getStats().result, null);
});

test('switching to a song without a practice track clears the previous score, ratings and result', () => {
  const Engine = loadEngine();
  let t = 0;
  const root = fakeRoot();
  const engine = Engine.createPracticeEngine({ role: 'panel', root, clock: () => ({ t, tempo: 1, playing: true }), onSync: () => {} });
  engine.setGuide(guide());
  engine.setPlaying(true, 0);
  for (t = 0.9; t < 3.3; t += 0.01) sing(engine, t, t < 2 ? 60 : 62, 0);
  t = 3.5; engine.syncFrame();
  engine.finish('mic');
  assert.ok(engine.getStats().ratings.length && engine.getStats().result);
  root.querySelector('[data-ps="lyricNow"]').textContent = 'old lyric';
  engine.setGuide(null);
  const stats = engine.getStats();
  assert.deepEqual(stats.ratings, []);
  assert.equal(stats.scoreTarget, null);
  assert.equal(stats.result, null);
  assert.equal(stats.tiers.PERFECT, 0);
  assert.equal(Object.values(stats.techCount).reduce((a, b) => a + b, 0), 0);
  assert.equal(root.querySelector('[data-ps="lyricNow"]').textContent, '', 'the old lyric line is gone');
});


// 同一段原曲在不同實際播放速度下，應有相同得分；使用真實的 10ms 音訊格。
function longTake({ tempo = () => 1, key = () => 0, pitch = () => 61.5, notes } = {}) {
  const Engine = loadEngine();
  let t = 0, audioTime = 0;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(),
    clock: () => ({ t, tempo: tempo(t), playing: true }), getOptions: () => ({ allowOctave: false }), onSync() {} });
  engine.setGuide(Scoring.prepareGuide({ duration: 11, tuning: 0,
    lines: [{ start: 0, end: 10, text: 'song', words: [{ start: 0, end: 10, text: 'song' }] }],
    notes: notes || [{ start: 0, end: 10, midi: 60, line: 0, word: 0 }] }));
  engine.setPlaying(true, 0);
  let frame = 0;
  while (t < 10) {
    const speed = tempo(t), shift = key(t);
    engine.pitch({ f0: hz(pitch(t) + shift), clarity: .95, rms: .05 },
      { valid: true, playing: true, t, key: shift, tempo: speed, audioTime, generation: 1 });
    if (++frame % 5 === 0) engine.syncFrame();
    audioTime += .01; t += .01 * speed;
  }
  engine.finish('mic');
  return engine;
}

test('partial pitch credit stays equal from 0.5x to 1.5x, including mid-song tempo and key changes', () => {
  const scores = [.5, .75, 1, 1.25, 1.5].map((speed) => longTake({ tempo: () => speed }).getStats().result.score);
  assert.ok(scores.every((s) => s > 78 && s < 81), `lenient partial credit preserved: ${scores}`);
  assert.ok(Math.max(...scores) - Math.min(...scores) < .25, `tempo cannot inflate or deflate credit: ${scores}`);
  const changed = longTake({ tempo: (t) => t < 5 ? .5 : 1.5, key: (t) => t < 3 ? -5 : t < 7 ? 3 : 0 });
  assert.ok(Math.abs(changed.getStats().result.score - scores[2]) < .25);
  for (const shift of [-12, -5, 0, 3, 12]) assert.equal(longTake({ key: () => shift, pitch: () => 60 }).getStats().result.score, 100);
});

test('strict octave scoring follows sustained octave leaps and suppresses isolated octave glitches', () => {
  const notes = [60, 72, 60].map((midi, i) => ({ start: i * 3, end: (i + 1) * 3, midi, line: 0, word: 0 }));
  const leap = longTake({ notes, pitch: (t) => t < 3 ? 60 : t < 6 ? 72 : 60 });
  assert.equal(leap.getStats().result.score, 100, 'a real leap must not be permanently folded to the old note');
  const glitch = longTake({ pitch: (t) => Math.round(t * 100) % 40 === 20 ? 72 : 60 });
  assert.equal(glitch.getStats().result.score, 100, 'three-frame median still removes isolated detector errors');
});

test('duplicate, stale, paused and missing detector frames cannot earn extra singing time', () => {
  const engine = longTake();
  engine.restart(); engine.setPlaying(true, 0);
  const send = (t, audioTime = t, generation = 1, playing = true, f0 = hz(60)) => engine.pitch(
    { f0, clarity: .95, rms: .05 }, { valid: true, t, audioTime, generation, playing, tempo: 1, key: 0 });
  send(.2); send(.21); send(.22);
  const note = engine.getGuide().notes[0];
  const before = note.hit;
  for (let i = 0; i < 100; i++) { send(.22); send(.21); }
  assert.equal(note.hit, before, 'no repeated credit for old frames');
  send(5); send(5.01);
  assert.ok(note.hit - before <= .021, 'a gap cannot be filled with unobserved singing');
  const afterGap = note.hit;
  send(5.02, 5.02, 1, false); send(5.03); // first resumed frame establishes a new interval
  assert.equal(note.hit, afterGap);
  send(5.04); send(5.05, 5.05, 2);
  const newGeneration = note.hit;
  send(5.06, 5.06, 1);
  assert.equal(note.hit, newGeneration, 'an old generation cannot overwrite the new one');
  send(5.07, 5.07, 2, true, 0); send(5.08, 5.08, 2, true, 0);
  assert.equal(note.hit, newGeneration, 'silent frames never earn credit');
  engine.setPlaying(false, 5.08); engine.setPlaying(true, 5.08);
  const beforeResume = note.hit;
  send(5.09, 6, 2); assert.equal(note.hit, beforeResume, 'pause resets the integration interval');
  assert.ok(note.seen <= 10 - note.grace, 'credit is bounded by scorable note time');
});
