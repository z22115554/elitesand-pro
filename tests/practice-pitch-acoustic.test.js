'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detector, signal, summarize, hz } = require('./helpers/practice-worklet-harness');

for (const rate of [44100, 48000, 96000]) {
  test(`shipped YIN tracks the supported range at ${rate} Hz, including high fundamentals`, () => {
    for (const f of [65.406, 82.4069, 130.81, 261.63, 440, 523.25, 880, 987.77, 1046.5, 1100, 1174.66, 1318.51]) {
      for (const harmonics of [[1], [1, .6, .35, .2], [.25, 1, .4, .2]]) {
        const runner = detector(rate);
        runner.push(signal(rate, .65, f, { harmonics }));
        const result = summarize(runner.frames, f, .15, .60);
        assert.ok(result.frames > 35);
        assert.ok(result.correct >= .95, JSON.stringify({ rate, f, harmonics, ...result }));
        assert.equal(result.lowOctave, 0); assert.equal(result.highOctave, 0);
      }
    }
  });
  test(`actual decimated rate, sample timestamps and missing input are consistent at ${rate} Hz`, () => {
    const runner = detector(rate);
    runner.push(signal(rate, .8, 880));
    const { instance, frames } = runner;
    assert.equal(instance.rate, rate / instance.factor);
    const firstSamples = instance.size * instance.factor;
    // The first moment of a symmetric, unit-gain FIR is its acoustic group delay.
    const filterDelay = instance.kernel ? instance.kernel.reduce((sum, value, i) => sum + i * value, 0) / rate : 0;
    assert.ok(Math.abs(instance.filterDelaySeconds - filterDelay) < 1e-12);
    const center = firstSamples / rate - instance.size / (2 * instance.rate) - filterDelay;
    assert.ok(Math.abs(frames[0].time - center) <= 1 / rate, `first center ${frames[0].time}, expected ${center}`);
    for (let i = 1; i < frames.length; i++) {
      assert.ok(Math.abs(frames[i].time - frames[i - 1].time - instance.hop / instance.rate) < 1e-9);
    }
    assert.ok(instance.n <= instance.buf.length);
    assert.equal(instance.process([]), true); assert.equal(instance.process([[]]), true);
  });
}

test('real acoustic octave jumps, breaths, glides, vibrato and short high notes survive the detector', () => {
  const sequences = [[60, 72, 60], [69, 81, 69], [72, 84, 72], [60, 84, 60],
    [60, 72, 60, 72, 60, 72], [60, 60, 60, 72], [84, 0, 60], [60, 0, 72, 0, 60]];
  for (const rate of [44100, 48000, 96000]) {
    for (const sequence of sequences) {
      const each = .35, runner = detector(rate);
      runner.push(signal(rate, each * sequence.length, (t) => hz(sequence[Math.floor(t / each)]) * (sequence[Math.floor(t / each)] ? 1 : 0),
        { harmonics: [1, .3, .2] }));
      sequence.forEach((note, i) => {
        const result = summarize(runner.frames, hz(note), i * each + .10, (i + 1) * each - .07);
        if (note) assert.ok(result.correct >= .95, JSON.stringify({ rate, sequence, i, ...result }));
        else assert.equal(result.unvoiced, 1);
      });
    }
    for (const frequency of [(t) => 1046.5 * 2 ** (.3 * Math.sin(2 * Math.PI * 6 * t) / 12),
      (t) => 880 * 2 ** (t * 4 / 12)]) {
      const runner = detector(rate); runner.push(signal(rate, .8, frequency));
      const result = summarize(runner.frames, frequency, .15, .70);
      assert.ok(result.correct >= .95, JSON.stringify({ rate, ...result }));
    }
    const short = detector(rate); short.push(signal(rate, .25, 1046.5));
    assert.ok(summarize(short.frames, 1046.5, .08, .20).correct >= .95);
  }
});

test('human-like synthetic groups retain high pitch under envelope, breath noise and accompaniment bleed', () => {
  for (const f of [82.4069, 220, 440, 880, 1046.5, 1318.51]) {
    for (const options of [{ harmonics: [1, .6, .25], bleed: true },
      { harmonics: [1, .12, .04], noise: .015 }, { noise: .06 },
      { envelope: (t) => .08 + .92 * Math.sin(Math.PI * t) ** 2 }]) {
      const runner = detector(48000); runner.push(signal(48000, 1, f, options));
      const result = summarize(runner.frames, f, .18, .9);
      // These specified synthetic groups have their own floor; they are not human recordings.
      assert.ok(result.correct >= .90, JSON.stringify({ f, options, ...result }));
    }
  }
});

test('rising and falling pitch describe the reported acoustic time, including under changing level', () => {
  for (const rate of [44100, 48000, 96000]) {
    for (const semitonesPerSecond of [-12, 12]) {
      const frequency = (t) => 220 * 2 ** (semitonesPerSecond * (t - .5) / 12);
      for (const envelope of [() => 1, (t) => .1 + .9 * t]) {
        const runner = detector(rate);
        runner.push(signal(rate, 1, frequency, { harmonics: [1, .3, .2], envelope }));
        const frames = runner.frames.filter(f => f.time >= .15 && f.time < .85);
        assert.ok(frames.length > 60);
        assert.ok(frames.every(f => f.f0 > 0), 'a continuous sweep must not acquire gaps');
        const errors = frames.map(f => Math.abs(1200 * Math.log2(f.f0 / frequency(f.time))));
        errors.sort((a, b) => a - b);
        assert.ok(errors[Math.floor(errors.length * .95)] < 3,
          `sweep follows its acoustic timestamp: ${rate} Hz, ${semitonesPerSecond} st/s`);
      }
    }
  }
});

test('silence and seeded white noise never become a stable sung note', () => {
  for (const options of [{}, { noise: .08 }]) {
    const runner = detector(48000); runner.push(signal(48000, .5, 0, options));
    assert.ok(runner.frames.every((f) => f.f0 === 0));
    assert.equal(summarize(runner.frames, 440, .15, .45).cents, null,
      'unvoiced observations have no cents estimate, not a fabricated zero-cent error');
  }
});

test('a quiet short vowel uses its local periodicity and still leaves the surrounding breath unpitched', () => {
  for (const duration of [.06, .1, .15]) {
    const runner = detector(48000);
    runner.push(signal(48000, .8, t => t >= .3 && t < .3 + duration ? 440 : 0,
      { noise: .0007, envelope: () => .011 }));
    const head = runner.frames.filter(f => f.time >= .31 && f.time < .32);
    assert.ok(head.some(f => f.f0 > 0 && Math.abs(1200 * Math.log2(f.f0 / 440)) < 50 && f.localClarity > .8));
    const breath = runner.frames.filter(f => f.time >= .1 && f.time < .24 || f.time >= .3 + duration + .06 && f.time < .7);
    assert.ok(breath.every(f => f.f0 === 0));
  }
});

test('an already tracked dominant voice can retain a supported octave candidate under bass and noise', () => {
  const audio = signal(48000, 1, 440, { harmonics: [1, .3, .2] });
  let seed = 29;
  for (let i = 19200; i < audio.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    audio[i] += .03 * Math.sin(2 * Math.PI * 220 * i / 48000) + .15 * (seed / 2147483648 - 1);
  }
  const runner = detector(48000); runner.push(audio);
  const result = summarize(runner.frames, 440, .5, .9);
  assert.ok(result.correct >= .95);
  assert.equal(result.lowOctave, 0);
});

for (const rate of [44100, 48000, 96000]) {
  test(`quiet periodic audio reaches the voicing layer while quiet noise stays unpitched at ${rate} Hz`, () => {
    const runner = detector(rate);
    runner.push(signal(rate, .7, 261.6256, { envelope: () => Math.SQRT2 * .0018 / .18 }));
    assert.ok(summarize(runner.frames, 261.6256, .2, .6).correct >= .95);
    const noise = detector(rate);
    noise.push(signal(rate, .7, 0, { noise: Math.sqrt(3) * .0018 }));
    assert.ok(noise.frames.every(frame => frame.f0 === 0));
  });

  test(`out-of-band high frequencies cannot alias into a supported sung note at ${rate} Hz`, () => {
    const runner = detector(rate);
    const decimatedRate = rate / Math.max(1, Math.round(rate / 16000));
    runner.push(signal(rate, .7, decimatedRate - 880));
    const frames = runner.frames.filter(frame => frame.time >= .2 && frame.time < .6);
    assert.ok(frames.length > 30);
    assert.ok(frames.every(frame => frame.f0 === 0), 'a high-frequency interferer must not become A5');
  });
}
