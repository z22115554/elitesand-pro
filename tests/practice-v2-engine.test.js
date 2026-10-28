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
