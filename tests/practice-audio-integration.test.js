'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('./practice-pitch-probe');
const { Timeline } = require('../public/js/practice-clock');

// 真的練唱偵測 worklet（practice/pitch-detector-worklet.js），用合成的歌聲驅動
function detectorPipeline(rate = 48000) {
  let Processor;
  const scope = vm.createContext({ Float32Array, Math, sampleRate: rate, currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => frames.push(m) }; } },
    registerProcessor(name, value) { assert.equal(name, 'practice-pitch-detector'); Processor = value; },
  });
  const frames = [];
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/practice/pitch-detector-worklet.js'), 'utf8'), scope);
  const processor = new Processor();
  return { frames, render(at, channels) {
    scope.currentTime = (at + channels[0].length) / rate;   // 跟瀏覽器一樣：currentTime 是這個區塊結束的時間
    const output = new Float32Array(channels[0].length);
    const alive = processor.process([channels], [[output]]);
    assert.ok(output.every((v) => v === 0), 'the microphone must never be monitored to the audio output');
    return alive;
  } };
}

test('pitch worklet detects stereo singing on the AudioContext clock, every 10ms, without monitoring', () => {
  const pipeline = detectorPipeline();
  for (let at = 0; at < 48000; at += 128) {
    const tone = Float32Array.from({ length: 128 }, (_, i) => .25 * Math.sin(2 * Math.PI * Core.midiToHz(64) * (at + i) / 48000));
    assert.equal(pipeline.render(at, [tone, tone]), true);
  }
  const voiced = pipeline.frames.filter((f) => f.f0 > 0);
  assert.ok(pipeline.frames.length >= 90 && pipeline.frames.length <= 100, `about one frame per 10ms (got ${pipeline.frames.length})`);
  assert.ok(voiced.length > 80);
  for (const f of voiced) assert.ok(Math.abs(69 + 12 * Math.log2(f.f0 / 440) - 64) < .1, JSON.stringify(f));
  const gaps = pipeline.frames.slice(1).map((f, i) => f.time - pipeline.frames[i].time);
  assert.ok(gaps.every((g) => Math.abs(g - .01) < .002), 'frames are stamped on the sample clock, not on arrival');
  assert.ok(pipeline.frames[0].time > 0 && pipeline.frames[0].time < .1, 'time is the window centre, not the block end');
});

test('silence gives no pitch; frames map through the playback clock to song time and the applied key', () => {
  const pipeline = detectorPipeline();
  pipeline.render(0, [new Float32Array(128)]);
  for (let at = 128; at < 9600; at += 128) pipeline.render(at, [new Float32Array(128)]);
  assert.ok(pipeline.frames.every((f) => f.f0 === 0), 'silence is unvoiced');
  const clock = new Timeline({ maxExtrapolationSeconds: 10 });
  clock.record({ audioTime: 0, sourceTime: 0, key: 0, tempo: 1, generation: 1, playing: true });
  clock.record({ audioTime: 1, sourceTime: 1, key: 3, tempo: .75, generation: 1, playing: true });
  assert.equal(clock.map(.9).key, 0);
  assert.equal(clock.map(1.5).key, 3);
  assert.equal(clock.map(1.5).sourceTime, 1.375);
  assert.ok(Math.abs(clock.map(1.5, { calibrationMs: 100 }).sourceTime - 1.3) < 1e-9, 'calibration shifts the mic frame back before mapping');
});

function playbackPipeline() {
  let Processor;
  const messages = [];
  const worklet = vm.createContext({ Float32Array, Math, currentFrame: 0, sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage(message) { messages.push(message); } }; } },
    registerProcessor(name, value) { assert.equal(name, 'soundtouch-processor'); Processor = value; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/vendor/soundtouch-worklet.js'), 'utf8'), worklet);
  const processor = new Processor();
  const source = Float32Array.from({ length: 192000 }, (_, i) => .3 * Math.sin(2 * Math.PI * 440 * i / 48000));
  const send = data => processor.port.onmessage({ data });
  send({ type: 'load', left: source, right: source, sampleRate: 48000, duration: 4 });
  send({ type: 'play', position: 0 });
  return { messages, send, render(from, until) {
    const output = new Float32Array(until - from);
    for (let frame = from; frame < until; frame += 128) {
      worklet.currentFrame = frame;
      const left = new Float32Array(128), right = new Float32Array(128);
      processor.process([], [[left, right]]);
      output.set(left.subarray(0, Math.min(128, until - frame)), frame - from);
    }
    return output;
  } };
}

test('real SoundTouch applies scheduled key to rendered samples and reports audible cursor instead of prefetch', () => {
  const playback = playbackPipeline();
  playback.send({ type: 'pitch', value: 3, applyAtFrame: 48000 });
  const audio = playback.render(0, 96000);
  const ack = playback.messages.find(message => message.reason === 'pitch');
  assert.equal(ack.contextFrame, 48000);
  assert.equal(ack.position, 48000);
  assert.equal(ack.pitchSemitones, 3);
  assert.ok(playback.messages.some(message => message.prefetchedPosition - message.position > 8192),
    'fixture must exercise the real DSP prefetch rather than an empty mock');
  const first = playback.messages.find(message => message.contextFrame === 1024);
  assert.equal(first.position, 1024);
  const before = Core.detectPitch(audio.subarray(40960, 45056), 48000);
  const after = Core.detectPitch(audio.subarray(51200, 55296), 48000);
  assert.ok(before.voiced && Math.abs(before.midi - 69) < .1, JSON.stringify(before));
  assert.ok(after.voiced && Math.abs(after.midi - 72) < .1, JSON.stringify(after));
  assert.ok(audio.every(Number.isFinite));
});

test('real SoundTouch effective tempo advances piecewise and immediate pause cancels a queued resume', () => {
  const playback = playbackPipeline();
  playback.send({ type: 'tempo', value: .5, applyAtFrame: 48000 });
  playback.render(0, 96000);
  const ack = playback.messages.find(message => message.reason === 'tempo');
  assert.equal(ack.contextFrame, 48000); assert.equal(ack.position, 48000); assert.equal(ack.tempo, .5);
  const last = playback.messages.at(-1);
  assert.ok(Math.abs(last.position - (48000 + (last.contextFrame - 48000) * .5)) < 1e-6);
  playback.send({ type: 'play', position: 0, applyAtFrame: 100096 });
  playback.send({ type: 'pause' });
  const paused = playback.render(96000, 103040);
  assert.ok(paused.every(value => value === 0), 'a queued resume must not turn playback back on after pause');
  assert.equal(playback.messages.at(-1).playing, false);
});

test('real SoundTouch flushes the final vocal phrase instead of dropping the incomplete prefetch batch', () => {
  const playback = playbackPipeline();
  const output = playback.render(0, 240000);
  const finalPhrase = Core.detectPitch(output.subarray(182400, 186496), 48000);
  assert.ok(finalPhrase.voiced && Math.abs(finalPhrase.midi - 69) < .1,
    'a 4-second source must retain its 3.8-second vocal phrase');
  const ended = playback.messages.findIndex(message => message.type === 'ended');
  assert.ok(ended >= 1, 'the finite source must end after flushing');
  const position = playback.messages[ended - 1];
  assert.equal(position.position, 192000);
  assert.ok(position.contextFrame >= 192000 && position.contextFrame <= 192256);
  assert.ok(output.subarray(192256).every(value => value === 0));
});
