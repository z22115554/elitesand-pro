'use strict';
// 練唱 v2 共用模組：演出風格表、評分規則、引擎（面板端跳轉／結算、OBS 端接收）。
// 引擎本身在瀏覽器跑，這裡用最小的假 DOM／假畫布驅動它的邏輯，不測畫面。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const Fx = require('../public/js/practice/practice-fx');
const Scoring = require('../public/js/practice/practice-scoring');
const { FX_IDS: SERVER_FX_IDS } = require('../server/services/practice-overlay');

const { loadEngine, fakeRoot } = require('./helpers/practice-engine-harness');

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

test('a confirmed local weak voice survives a stale noise floor without inventing a pitch', () => {
  for (const localClarity of [.98, .3, undefined]) {
    const E = loadEngine(); let t = .1;
    const e = E.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, playing: true, tempo: 1 }) });
    e.setGuide(guide()); e.setPlaying(true, 0);
    const feed = frame => {
      e.pitch(frame, { valid: true, t, audioTime: t, playing: true, generation: 1, key: 0, tempo: 1 });
      t += .01;
    };
    for (let i = 0; i < 100; i++) feed({ f0: 0, clarity: 0, rms: .03 });
    for (let i = 0; i < 25; i++) feed({ f0: hz(62), clarity: .98, localClarity, rms: .0013 });
    assert.equal(e._state.pitchSample.midi, localClarity === .98 ? 62 : 0,
      'weak recovery needs local waveform evidence; it must not snap to the reference C4');
    e.destroy();
  }
});

test('local aperiodic breath cannot inherit the preceding vowel in the full pitch path', () => {
  const { detector } = require('./helpers/practice-worklet-harness');
  const rate = 48000; let seed = 17;
  const audio = Float32Array.from({ length: Math.round(rate * .6) }, (_, i) => {
    const time = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const envelope = time < .25 ? 1 : time < .29 ? (.29 - time) / .04 : 0;
    return .06 * envelope * Math.sin(2 * Math.PI * 440 * time) + (seed / 2 ** 32 * 2 - 1) * .012;
  });
  const runner = detector(rate); runner.push(audio);
  const E = loadEngine(); let t = 1, witnessed = false;
  const e = E.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, playing: true, tempo: 1 }) });
  e.setGuide(guide()); e.setPlaying(true, t);
  for (const frame of runner.frames) {
    t = 1 + frame.time;
    e.pitch(frame, { valid: true, t, audioTime: frame.time, playing: true, generation: 1, key: 0, tempo: 1 });
    if (frame.time >= .291 && frame.time < .295) {
      assert.ok(frame.f0 > 0 && frame.clarity > .7 && frame.localClarity < .55,
        'the actual long-window YIN still carries the fading vowel into this breath');
      assert.equal(e._state.pitchSample.midi, 0);
      witnessed = true;
    }
  }
  assert.ok(witnessed); e.destroy();
});

test('an isolated uncertain center scores silence without discarding the next measured soft vowel', () => {
  const E = loadEngine(); let t = 1.1;
  const e = E.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, playing: true, tempo: 1 }) });
  e.setGuide(guide()); e.setPlaying(true, t);
  const feed = (clarity, localClarity) => {
    e.pitch({ f0: hz(62), rms: .02, clarity, localClarity },
      { valid: true, t, audioTime: t, playing: true, generation: 1, key: 0, tempo: 1 });
    t += .01;
  };
  for (let i = 0; i < 8; i++) feed(.98, .98);
  feed(.7, .4);
  assert.equal(e._state.pitchSample.midi, 0);
  feed(.65, .85);
  assert.equal(e._state.pitchSample.midi, 62, 'actual D4 must not be snapped to the reference C4');
  feed(.7, .4); feed(.7, .4);
  assert.equal(e._state.pitchSample.midi, 0); assert.equal(e._state.voice.on, false);
  feed(.65, .85);
  assert.equal(e._state.pitchSample.midi, 0, 'sustained uncertainty must require a fresh onset');
  e.destroy();
});

test('noise observations restart after a backwards seek rather than waiting for the old song time', () => {
  const E = loadEngine(); let t = 5;
  const e = E.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, playing: true, tempo: 1 }) });
  e.setGuide(guide()); e.setPlaying(true, t);
  const feed = () => {
    e.pitch({ f0: 0, clarity: 0, rms: .0004 }, { valid: true, t, audioTime: t, playing: true, generation: 1, key: 0, tempo: 1 });
    t += .01;
  };
  for (let i = 0; i < 100; i++) feed();
  assert.ok(e._state.voice.noiseCount >= 8);
  t = .1; e.seek(t);
  assert.equal(e._state.voice.noiseCount, 0);
  for (let i = 0; i < 20; i++) feed();
  assert.ok(e._state.voice.noiseCount > 0);
  assert.ok(e._state.voice.noiseAt < 1);
  e.destroy();
});
// 偵測器一格（10ms）；每 5 格同步一次，跟瀏覽器裡畫面更新／音訊執行緒推動的節奏相同
let frames = 0;
function sing(engine, t, midi, key) {
  engine.pitch({ f0: hz(midi), clarity: 0.95, rms: 0.05 }, { valid: true, t, key });
  if (++frames % 5 === 0) engine.syncFrame();
}

test('a two-frame confirmed voice onset is not gated a second time by median warmup', () => {
  const Engine = loadEngine();
  let t = .2;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(),
    clock: () => ({ t, playing: true, tempo: 1 }), onSync() {} });
  engine.setGuide(guide()); engine.setPlaying(true, 0);
  const feed = () => engine.pitch({ f0: hz(60), clarity: .8, rms: .05 },
    { valid: true, t, audioTime: t, generation: 1, playing: true, key: 0, tempo: 1 });
  feed(); assert.equal(engine._state.pitchSample.midi, 0);
  t += .01; feed();
  assert.equal(engine._state.pitchSample.midi, 60, 'voicing already confirmed two consistent observations');
  engine.destroy();
});

test('two disagreeing observations cannot select an octave or leak an old pitch across a breath', () => {
  for (const breath of [false, true]) {
    const Engine = loadEngine();
    let t = .2;
    const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(),
      clock: () => ({ t, playing: true, tempo: 1 }), onSync() {} });
    engine.setGuide(guide()); engine.setPlaying(true, 0);
    const feed = midi => {
      engine.pitch({ f0: midi ? hz(midi) : 0, clarity: midi ? .95 : 0, rms: midi ? .05 : 0 },
        { valid: true, t, audioTime: t, generation: 1, playing: true, key: 0, tempo: 1 });
      t += .01;
    };
    if (breath) { for (let i = 0; i < 10; i++) feed(72); feed(0); feed(60); }
    else { feed(60); feed(72); }
    assert.equal(engine._state.pitchSample.midi, 0, 'an ambiguous pair is not evidence for the higher note');
    feed(60);
    assert.equal(engine._state.pitchSample.midi, 60);
    engine.destroy();
  }
});

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

// 使用者回報：自己唱時常被判定「聲音太小」。收音小的麥克風人聲約 −50 dBFS（rms 0.003），
// 以前門檻起點 0.009、被伴奏漏音墊高後可到 0.018，清楚的歌聲也判成沒唱。
function takeAt({ voiceRms, bleedRms = 0 }) {
  const Engine = loadEngine();
  let t = 0;
  const hints = [];
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, tempo: 1, playing: true }),
    onSync: () => {}, onHint: (kind) => hints.push(kind) });
  engine.setGuide(guide());
  engine.setPlaying(true, 0);
  const frame = (f0, clarity, rms) => { engine.pitch({ f0, clarity, rms }, { valid: true, t, key: 0 }); if (++frames % 5 === 0) engine.syncFrame(); };
  // 前奏：只有伴奏漏進麥克風（複音、清晰度低）
  for (t = 0; t < 0.6; t += 0.01) frame(bleedRms ? 180 : 0, 0.3, bleedRms);
  // 第一句：歌聲（清楚）＋同樣的伴奏漏音
  const mix = Math.hypot(voiceRms, bleedRms);   // 歌聲和漏音疊在一起的實際音量
  for (t = 0.9; t < 3.3; t += 0.01) frame(t < 1 || t > 3 ? 0 : hz(t < 2 ? 60 : 62), t < 1 || t > 3 ? 0.3 : 0.93, t < 1 || t > 3 ? bleedRms : mix);
  t = 30.5; engine.syncFrame();
  for (t = 30.5; t < 33.3; t += 0.01) frame(t < 31 || t > 33 ? 0 : hz(t < 32 ? 64 : 65), t < 31 || t > 33 ? 0.3 : 0.93, t < 31 || t > 33 ? bleedRms : mix);
  engine.finish('mic');
  return { stats: engine.getStats(), hints, gate: engine.voiceGate() };
}

test('a quiet but clear voice (about -50 dBFS) still scores, with or without accompaniment bleed', () => {
  const quiet = takeAt({ voiceRms: 0.003 });
  assert.equal(quiet.stats.unscorable, false);
  assert.ok(quiet.stats.result.score > 80, `quiet clean take scores high (got ${quiet.stats.result.score})`);
  // 沒戴耳機：伴奏漏音跟歌聲一樣大，噪音底不能因此被墊到蓋過歌聲
  const bleed = takeAt({ voiceRms: 0.004, bleedRms: 0.004 });
  assert.ok(bleed.stats.result.score > 80, `voice at the bleed level still scores (got ${bleed.stats.result.score})`);
  assert.ok(bleed.gate <= 0.0073, `gate stays capped (got ${bleed.gate})`);
  assert.deepEqual(quiet.hints, [], 'no "mic too quiet" hint when the voice registers');
});

test('missing reference phrases cannot teach sustained or rapidly changing singing as background noise', () => {
  const detected = [];
  for (const includeFirstPhrase of [true, false]) for (const clarity of [.8, .95]) for (const rapid of [false, true]) {
    const Engine = loadEngine();
    let t = 0, voiced = 0;
    const notes = [{ start: 3, end: 5, midi: 60, line: -1, word: -1 }];
    if (includeFirstPhrase) notes.unshift({ start: 0, end: 3, midi: 60, line: -1, word: -1 });
    const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(),
      clock: () => ({ t, playing: true, tempo: 1 }), onSync() {} });
    engine.setGuide(Scoring.prepareGuide({ duration: 5, lines: [], notes }));
    engine.setPlaying(true, 0);
    for (let i = 0; i < 500; i++) {
      t = i * .01;
      const midi = t < 3 && rapid ? 60 + 12 * (Math.floor(i / 10) % 2) : 60;
      engine.pitch({ f0: hz(midi), clarity, rms: t < 3 ? .008 : .003 },
        { valid: true, t, audioTime: t, playing: true, tempo: 1, key: 0, generation: 1 });
      if (t >= 3.2 && engine._state.pitchSample.midi) voiced++;
    }
    detected.push(voiced);
    engine.destroy();
  }
  assert.ok(detected.every(count => count >= 175), `same later phrase must survive either reference: ${detected}`);
});

test('clear pitch that never clears the gate raises a single "mic too quiet" hint', () => {
  const tooQuiet = takeAt({ voiceRms: 0.0004 });
  assert.deepEqual(tooQuiet.hints, ['quiet']);
});

test('a lower gate still ignores room noise and accompaniment bleed when nobody sings', () => {
  const Engine = loadEngine();
  let t = 0;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, tempo: 1, playing: true }), onSync: () => {} });
  engine.setGuide(guide());
  engine.setPlaying(true, 0);
  // 只有噪音與伴奏：有時抓得到音高，但清晰度低（複音）
  for (t = 0; t < 3.3; t += 0.01) { engine.pitch({ f0: 180 + (t * 37 % 40), clarity: 0.5 + (t * 13 % 0.2), rms: 0.004 }, { valid: true, t, key: 0 }); if (++frames % 5 === 0) engine.syncFrame(); }
  engine.finish('mic');
  const stats = engine.getStats();
  assert.ok(stats.unscorable || stats.result.score < 10, `noise alone must not score (got ${stats.result && stats.result.score})`);
});

test('OBS follow clock never moves backwards when frames arrive late', () => {
  const clock = loadEngine().createFollowClock(0.08);
  const frames = [];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // 面板每 50ms 送一次，到達延遲 0–30ms，每秒一次 120ms 卡頓
  for (let i = 0; i < 200; i++) frames.push({ arrive: i * 0.05 + random() * 0.03 + (i % 20 === 19 ? 0.12 : 0), t: 10 + i * 0.05 });
  frames.sort((a, b) => a.arrive - b.arrive);
  clock.sync({ playing: true, t: 10, tempo: 1 }, 0);
  let previous = clock.read(0), next = 0, sent = 0;
  for (let now = 1 / 30; now < 10; now += 1 / 30) { // OBS 30fps
    while (next < frames.length && frames[next].arrive <= now) {
      clock.sync({ playing: true, t: frames[next].t, tempo: 1 }, frames[next].arrive); next++; sent++;
    }
    const value = clock.read(now);
    assert.ok(value >= previous, `time went back at ${now}: ${previous} -> ${value}`);
    previous = value;
  }
  assert.ok(sent > 100);
  assert.ok(Math.abs(previous - (10 + 10 - 0.08)) < 0.06, `stays on the panel clock: ${previous}`);
});

test('OBS follow clock holds on pause, resumes without a jump and follows seeks', () => {
  const clock = loadEngine().createFollowClock(0.08);
  clock.sync({ playing: true, t: 20, tempo: 1 }, 0);
  clock.read(0);
  for (let now = 0.1; now <= 1; now += 0.1) { clock.sync({ playing: true, t: 20 + now, tempo: 1 }, now); clock.read(now); }
  const before = clock.read(1);
  clock.sync({ playing: false, t: 21, tempo: 1 }, 1.01);
  assert.equal(clock.read(1.02), before, 'pause must not jump forward by the render delay');
  clock.sync({ playing: true, t: 21, tempo: 1 }, 2);
  const resumed = clock.read(2.02);
  assert.ok(resumed >= before && resumed - before < 0.05, `resume: ${before} -> ${resumed}`);
  clock.sync({ playing: true, t: 50, tempo: 1 }, 2.05);
  assert.ok(clock.read(2.06) > 49.9, 'large jumps snap');
  clock.reset();
  clock.sync({ playing: true, t: 49.9, tempo: 1 }, 2.07);
  assert.ok(clock.read(2.08) < 49.9, 'seek back snaps even when the jump is small');
});

test('settings lists the practice overlay browser source', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-practice.js'), 'utf8');
  assert.match(html, /id="practice-url-general"/);
  assert.match(html, /id="copy-practice-url-general"/);
  assert.match(app, /\$\('practice-url-general'\)/);
  assert.match(app, /\$\('copy-practice-url-general'\)/);
});

test('offline guide → Signalsmith playback → mic worklet → clock → strict/folded score → OBS result', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const { spawnSync } = require('node:child_process');
  const { detector, signal } = require('./helpers/practice-worklet-harness');
  const { loadSignalsmith, preparePlayback } = require('./helpers/playback-worklet-harness');
  const { Timeline } = require('../public/js/practice-clock');
  const python = process.env.ELITESAND_TEST_PYTHON || process.env.ELITESAND_AI_PYTHON
    || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const notes = [60, 72, 84, 72, 60], each = .6, lead = .2, duration = notes.length * each + lead * 2;
  const result = spawnSync(python, ['-c', `
import json, numpy as np
from ai.pitch_guide_worker import make_guide, SAMPLE_RATE
notes = [60, 72, 84, 72, 60]
def tone(note):
    t = np.arange(round(.6 * SAMPLE_RATE)) / SAMPLE_RATE
    return (.18 * np.sin(2 * np.pi * 440 * 2 ** ((note - 69) / 12) * t)).astype(np.float32)
audio = np.concatenate([np.zeros(3200), *[tone(n) for n in notes], np.zeros(3200)])
print(json.dumps(make_guide(audio, 'yin', progress=False)))
`], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const extracted = JSON.parse(result.stdout);
  assert.deepEqual(extracted.notes.map((n) => n.midi), notes, 'offline extraction must preserve the actual high reference notes');
  const Engine = loadEngine();
  const cases = [{ tempo: .5, key: -3 }, { tempo: 1, key: 0 }, { tempo: 1.5, key: 3 },
    { tempo: 1, key: 0, octave: -12 }, { tempo: 1, key: 0, octave: -12, allowOctave: true },
    { tempo: 1.5, key: 0, latency: .1 }];
  const scores = [];
  for (const setup of cases) {
    const { tempo, key, octave = 0, allowOctave = false, latency = 0 } = setup;
    const rate = 48000, sent = [];
    let t = 0;
    const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(),
      getOptions: () => ({ allowOctave }), clock: () => ({ t, playing: true, tempo }), onSync: (m) => sent.push(m) });
    engine.setGuide(Scoring.prepareGuide(extracted)); engine.setPlaying(true, 0);
    const source = signal(rate, duration, (at) => {
      const i = Math.floor((at - lead) / each);
      return i >= 0 && i < notes.length ? hz(notes[i] + octave) : 0;
    });
    const timeline = new Timeline({ duration, maxExtrapolationSeconds: 10, calibrationMs: latency * 1000 });
    let Processor;
    const scope = vm.createContext({ sampleRate: rate, currentFrame: 0,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => {
        if (m.type === 'position') timeline.record({ audioTime: m.contextTime, sourceTime: m.position / rate,
          playing: m.playing, tempo: m.tempo, key: m.pitchSemitones, generation: m.generation });
      } }; } }, registerProcessor: (_, cls) => { Processor = cls; } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/vendor/soundtouch-worklet.js'), 'utf8'), scope);
    loadSignalsmith(scope);
    const playback = new Processor();
    assert.equal(await preparePlayback(playback), 'signalsmith');
    playback.port.onmessage({ data: { type: 'load', left: source, right: source, sampleRate: rate, pitchSemitones: key, tempo } });
    playback.port.onmessage({ data: { type: 'play', position: 0 } });
    const mic = detector(rate);
    // Render actual pitch/tempo DSP, not a substituted frequency formula.
    const rendered = new Float32Array(Math.ceil((duration / tempo + .3) * rate / 128) * 128);
    for (let at = 0; at < rendered.length; at += 128) {
      scope.currentFrame = at;
      const left = new Float32Array(128), right = new Float32Array(128);
      playback.process([], [[left, right]]); rendered.set(left, at);
    }
    const delay = Math.round(latency * rate), delayed = new Float32Array(rendered.length + delay);
    delayed.set(rendered, delay); mic.push(delayed);
    for (const frame of mic.frames) {
      const mapped = timeline.map(frame.time); t = mapped.sourceTime;
      engine.pitch(frame, { ...mapped, t }); engine.syncFrame();
    }
    engine.finish('mic');
    const stats = engine.getStats(), score = stats.result.score;
    scores.push({ ...setup, score });
    assert.equal(stats.unscorable, false);
    if (octave && !allowOctave) assert.ok(score < 5, JSON.stringify({ setup, score }));
    else assert.ok(score >= 95, JSON.stringify({ setup, score }));
    const final = sent.filter((m) => m.type === 'frame').at(-1);
    assert.equal(final.score.result.score, score);
    const obs = Engine.createPracticeEngine({ role: 'source', root: fakeRoot() });
    for (const message of sent) obs.receive(message);
    assert.equal(obs.getStats().result.score, score, 'OBS receives the exact panel result');
  }
  console.log('Acoustic integration scores:', JSON.stringify(scores));
});

test('real acoustic rests create no score target, while omitting a required phrase still loses credit', () => {
  const { spawnSync } = require('node:child_process');
  const { detector, signal } = require('./helpers/practice-worklet-harness');
  const python = process.env.ELITESAND_TEST_PYTHON || process.env.ELITESAND_AI_PYTHON
    || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, ['-c', `
import json, numpy as np
from ai.pitch_guide_worker import make_guide, SAMPLE_RATE
t = np.arange(24000) / SAMPLE_RATE
tone = (.18 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
audio = np.concatenate([np.zeros(3200), tone, np.zeros(12800), tone, np.zeros(3200)])
lyrics = [{"time": 0, "duration": 4200, "text": "one phrase"}]
print(json.dumps(make_guide(audio, 'yin', lyrics, progress=False)))
`], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const guide = JSON.parse(result.stdout);
  assert.equal(guide.notes.length, 2, 'the same note on both sides of a breath remains two separate targets');
  const prepared = Scoring.prepareGuide(guide);
  assert.equal(Scoring.activeNote(prepared.notes, 2.1), null, 'a real breath has no grey note and no required score time');
  const Engine = loadEngine(), scores = [];
  for (const omitSecond of [false, true]) {
    let time = 0; const packets = [];
    const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(),
      getOptions: () => ({ allowOctave: false }), clock: () => ({ t: time, playing: true, tempo: 1 }),
      onSync: (message) => packets.push(message) });
    engine.setGuide(Scoring.prepareGuide(guide)); engine.setPlaying(true, 0);
    const mic = detector(48000);
    mic.push(signal(48000, 4.4, (t) => (t >= .2 && t < 1.7) || (!omitSecond && t >= 2.5 && t < 4) ? 440 : 0));
    for (const frame of mic.frames) {
      if (frame.time < 0) continue;
      time = frame.time;
      engine.pitch(frame, { valid: true, t: time, audioTime: time, generation: 0, key: 0, tempo: 1 });
      engine.syncFrame();
    }
    engine.finish('mic'); engine.syncFrame();
    const stats = engine.getStats(); scores.push(stats.result.score);
    assert.ok(Number.isFinite(stats.result.score));
    assert.equal(stats.unscorable, false);
    assert.equal(packets.filter((m) => m.score?.result).at(-1).score.result.score, stats.result.score);
    engine.destroy();
  }
  assert.ok(scores[0] >= 95, `Correct singing with a real breath: ${scores[0]}`);
  assert.ok(scores[1] <= 60, `An omitted phrase must still lose credit: ${scores[1]}`);
});

test('strict mode targets the original pitch and punishes a semitone; relaxed is unchanged', () => {
  const { PROFILES, credit, noteScore, targetOf, profileOf } = Scoring;
  assert.equal(profileOf('anything'), PROFILES.relaxed);
  assert.equal(credit(75), 1);
  assert.ok(credit(75, PROFILES.strict) < 0.3);
  assert.equal(credit(100, PROFILES.strict), 0);
  assert.equal(credit(20, PROFILES.strict), 1);
  const note = { start: 0, end: 1, midi: 60, raw: 60.4, grace: 0.1, hit: 0.5 };
  assert.equal(targetOf(note), 60, 'relaxed compares with the nearest semitone');
  assert.equal(targetOf(note, PROFILES.strict), 60.4, 'strict compares with the original vocal');
  assert.equal(targetOf({ ...note, raw: undefined }, PROFILES.strict), 60, 'older guides fall back');
  assert.ok(noteScore(note, PROFILES.strict) < noteScore(note), 'strict needs more of the note');
});

test('a take records its scoring mode and diagnostics stay local until asked for', () => {
  const Engine = loadEngine();
  let t = 0;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, playing: true, tempo: 1 }),
    getOptions: () => ({ allowOctave: true, scoreMode: 'strict' }), onSync: () => {} });
  engine.setGuide(Scoring.prepareGuide({ duration: 8, lines: [{ start: 0, end: 7, text: 'x' }], notes: [{ start: 0, end: 7, midi: 69, raw: 69, line: 0, word: 0 }] }));
  engine.setPlaying(true, 0);
  assert.equal(engine.diagnosticSnapshot(), null);
  for (let i = 0; i < 700; i++) {
    t = i / 100;
    engine.pitch({ time: t, f0: 440, clarity: 0.99, rms: 0.1, localClarity: 0.99 }, { valid: true, t, audioTime: t, playing: true, tempo: 1, key: 0, generation: 1 });
  }
  const take = engine.finish('mic', { end: 7 });
  assert.equal(take.scoreMode, 'strict');
  const data = engine.diagnosticSnapshot();
  assert.equal(data.scoreMode, 'strict');
  assert.ok(data.rows.length > 0 && data.rows.length <= 300);
  assert.equal(data.rows[0].length, 8);
  assert.equal(data.rows[0][7], 69);
  assert.deepEqual(Object.keys(data).filter((k) => /title|track|lyric|audio/i.test(k)), []);
});

test('lyric display text follows the setting without touching timing, and OBS gets only the text', () => {
  const guide = { lines: [{ start: 1, end: 2, text: '后来', words: [{ text: '后', start: 1, end: 1.5 }, { text: '来', start: 1.5, end: 2 }] }] };
  const toTraditional = (text) => text.replace('后', '後').replace('来', '來');
  assert.equal(Scoring.applyLyricText(guide, toTraditional), true);
  assert.equal(guide.lines[0].text, '後來');
  assert.equal(guide.lines[0].words[1].text, '來');
  assert.equal(guide.lines[0].words[0].start, 1);
  assert.equal(Scoring.applyLyricText(guide, toTraditional), false, 'nothing changes the second time');
  assert.equal(Scoring.applyLyricText(guide, (text) => text), true, 'turning it off restores the original');
  assert.equal(guide.lines[0].text, '后来');

  const Engine = loadEngine();
  const sent = [];
  const panel = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(), onSync: (m) => sent.push(m) });
  panel.setGuide(Scoring.prepareGuide({ duration: 8, lines: guide.lines, notes: [{ start: 1, end: 2, midi: 69, line: 0, word: 0 }] }));
  Scoring.applyLyricText(panel.getGuide(), toTraditional);
  sent.length = 0;
  panel.refreshLyrics();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'lyrics');
  assert.equal(sent[0].lines[0].text, '後來');
  assert.equal(sent[0].lines[0].words[0], '後');

  const obs = Engine.createPracticeEngine({ role: 'source', root: fakeRoot() });
  obs.receive({ type: 'song', song: { duration: 8, lines: [{ start: 1, end: 2, text: '后来', words: [{ text: '后', start: 1, end: 2 }] }], notes: [{ start: 1, end: 2, midi: 69, line: 0, word: 0 }] } });
  obs.receive({ type: 'lyrics', lines: [{ text: '後來', words: ['後'] }] });
  assert.equal(obs.getGuide().lines[0].text, '後來');
  assert.equal(obs.getGuide().lines[0].words[0].text, '後');
});

test('voice without a lyric is drawn but never scored', () => {
  const guide = Scoring.prepareGuide({ duration: 10, lines: [{ start: 4, end: 8, text: 'x' }], notes: [
    { start: 1, end: 3, midi: 60, line: 0, word: 0, excluded: 'no-lyric' }, { start: 4, end: 8, midi: 62, line: 0, word: 0 }] });
  assert.equal(guide.notes[0].excluded, 'no-lyric');
  assert.equal(guide.notes[1].excluded, null);
  const Engine = loadEngine();
  let t = 0;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t, playing: true, tempo: 1 }), getOptions: () => ({ allowOctave: false }), onSync: () => {} });
  engine.setGuide(guide); engine.setPlaying(true, 0);
  for (let i = 0; i < 800; i++) {
    t = i / 100;
    const f0 = 440 * 2 ** ((62 - 69) / 12);
    if (t < 4) engine.pitch({ time: t, f0: 0, clarity: 0, rms: 0.00005, localClarity: 0 }, { valid: true, t, audioTime: t, playing: true, tempo: 1, key: 0, generation: 1 });
    else engine.pitch({ time: t, f0, clarity: 0.99, rms: 0.1, localClarity: 0.99 }, { valid: true, t, audioTime: t, playing: true, tempo: 1, key: 0, generation: 1 });
  }
  const take = engine.finish('mic', { end: 8 });
  assert.ok(take.score > 90, 'silence during a hum costs nothing: ' + take.score);
  assert.ok(Math.abs(take.seconds - 3.85) < 0.2, 'only the lyric counts: ' + take.seconds);
});
