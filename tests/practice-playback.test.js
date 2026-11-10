'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('./practice-pitch-probe');
const { loadSignalsmith } = require('./helpers/playback-worklet-harness');

function fixture({ signalsmith = true, audio: source, sampleRate = 48000 } = {}) {
  let Processor;
  const scope = vm.createContext({ Float32Array, Float64Array, Math, Number, sampleRate, currentFrame: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor(name, Type) { assert.equal(name, 'soundtouch-processor'); Processor = Type; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/vendor/soundtouch-worklet.js'), 'utf8'), scope);
  if (signalsmith) loadSignalsmith(scope);
  const nodes = [];
  const context = { sampleRate, currentTime: 0, state: 'running',
    audioWorklet: { async addModule() {} },
    async decodeAudioData() {
      const audio = source ?? Float32Array.from({ length: sampleRate * 6 }, (_, i) => .15 * Math.sin(2 * Math.PI * 440 * i / sampleRate));
      return { duration: audio.length / sampleRate, sampleRate, numberOfChannels: 1, getChannelData() { return audio; } };
    },
  };
  class Node {
    constructor() {
      this.processor = new Processor(); this.messages = [];
      this.port = {
        postMessage: data => this.processor.port.onmessage({ data }),
        close() {}, onmessage: null,
      };
      this.processor.port.postMessage = data => { this.messages.push(data); this.port.onmessage?.({ data }); };
      nodes.push(this);
    }
    connect() {} disconnect() {}
  }
  const main = vm.createContext({ window: {}, AudioWorkletNode: Node, console, performance, AbortController,
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/soundtouch-engine.js'), 'utf8'), main);
  function create(options) { const engine = main.window.createSoundTouchEngine(options); engine.attach(context, {}); return engine; }
  function render(count = 1) {
    const audio = new Map(nodes.map(n => [n, []]));
    for (let i = 0; i < count; i++) {
      scope.currentFrame = Math.round(context.currentTime * sampleRate);
      for (const node of nodes) {
        const left = new Float32Array(128), right = new Float32Array(128);
        node.processor.process([], [[left, right]]); audio.get(node).push(...left);
      }
      context.currentTime = (scope.currentFrame + 128) / sampleRate;
    }
    return nodes.map(node => Float32Array.from(audio.get(node)));
  }
  return { create, render, context, nodes };
}

test('Signalsmith playback clock reports rendered output rather than prefetch', async () => {
  const f = fixture(), engine = f.create();
  engine.setPitch(3); assert.equal(await engine.load('/tone'), true); engine.play(0);
  const output = f.render(8)[0];
  const state = engine.getPlaybackSnapshot(), report = f.nodes[0].messages.at(-1);
  assert.equal(state.valid, true);
  assert.equal(report.position, 1024);
  assert.equal(f.nodes[0].messages[0].backend, 'signalsmith');
  assert.ok(report.prefetchedPosition > report.position);
  assert.ok(Math.abs(state.sourceTime - 1024 / 48000) < 1e-9);
  assert.equal(state.effectiveContextTime, 1024 / 48000);
  assert.equal(state.audioContext, f.context);
  assert.ok(output.some(value => Math.abs(value) > .01));
});

test('scheduled DSP acknowledgements preserve historical pitch and tempo until their render frame', async () => {
  const f = fixture(), engine = f.create();
  await engine.load('/tone'); engine.play(0); f.render(80);
  const start = engine.getPlaybackSnapshot();
  const atFrame = Math.round(f.context.currentTime * 48000) + 128 * 8;
  engine.setPitch(3, atFrame); engine.setTempo(.75, atFrame);
  assert.equal(engine.getPlaybackSnapshot().pitchShift, 0, 'requested UI state cannot become effective early');
  const before = f.render(8)[0];
  assert.equal(engine.getPlaybackSnapshot().pitchShift, 0);
  const output = f.render(50)[0], state = engine.getPlaybackSnapshot();
  assert.ok(Math.abs(output[0] - before[before.length - 1]) < 1e-7, 'parameter reset de-clicks the output boundary');
  assert.equal(state.pitchShift, 3); assert.equal(state.playbackRate, .75);
  assert.equal(state.generation, start.generation, 'key and tempo changes are within the same take');
  const applied = f.nodes[0].messages.find(message => message.contextFrame === atFrame && message.pitchSemitones === 3 && message.tempo === .75);
  assert.ok(applied, 'both parameters acknowledge the same actual render quantum');
  const detected = Core.detectPitch(output.subarray(1024), 48000);
  assert.ok(detected.voiced && Math.abs(detected.midi - 72) < .15, JSON.stringify(detected));
  assert.ok(Math.abs((state.sourceTime - applied.position / 48000) - (state.effectiveContextTime - atFrame / 48000) * .75) < 1e-8);
});

test('two stems use the same scheduled quantum and output cursor after key, speed and seek', async () => {
  const f = fixture(), first = f.create(), second = f.create({ preserveFormants: true });
  await Promise.all([first.load('/tone-a'), second.load('/tone-b')]);
  const at = first.scheduleFrame(.05);
  first.play(1, at); second.play(1, at); f.render(40);
  const next = first.scheduleFrame(.05);
  first.setPitch(-2, next); second.setPitch(-2, next);
  first.setTempo(1.25, next); second.setTempo(1.25, next);
  const quanta = Math.ceil((next - Math.round(f.context.currentTime * 48000)) / 128);
  f.render(quanta);
  for (const node of f.nodes) {
    const renderer = node.processor._renderer;
    assert.equal(renderer.standby.remaining, 0, 'preroll finishes before the two stems apply the scheduled change');
    assert.equal(renderer.pitch, 0);
  }
  f.render(16);
  const seekAt = first.scheduleFrame(.05);
  first.seek(3, seekAt); second.seek(3, seekAt); f.render(40);
  const a = first.getPlaybackSnapshot(), b = second.getPlaybackSnapshot();
  assert.equal(a.sourceTime, b.sourceTime); assert.equal(a.effectiveContextTime, b.effectiveContextTime);
  assert.equal(a.pitchShift, -2); assert.equal(b.pitchShift, -2);
  assert.equal(a.playbackRate, 1.25); assert.equal(b.playbackRate, 1.25);
  assert.ok(a.generation > 1 && b.generation > 1);
});

test('ten A–B loops keep the two audible clocks aligned and render the new position after every seek', async () => {
  const f = fixture(), a = f.create(), b = f.create({ preserveFormants: true });
  await Promise.all([a.load('/instrumental'), b.load('/vocals')]);
  for (const engine of [a, b]) {
    engine.setPitch(-8);
    engine.setTempo(1.25);
    engine.play(1, a.scheduleFrame(.05));
  }
  f.render(42);
  for (let loop = 0; loop < 10; loop++) {
    const before = a.getPlaybackSnapshot().generation;
    const frame = a.scheduleFrame(.05);
    a.seek(1, frame);
    b.seek(1, frame);
    const audio = f.render(60);
    const aState = a.getPlaybackSnapshot(), bState = b.getPlaybackSnapshot();
    assert.equal(aState.generation, before + 1);
    assert.equal(aState.sourceTime, bState.sourceTime);
    assert.equal(aState.effectiveContextTime, bState.effectiveContextTime);
    assert.ok(aState.sourceTime >= 1 && aState.sourceTime < 1.15);
    for (const channel of audio) {
      const note = Core.detectPitch(channel.subarray(4096), 48000);
      assert.ok(note.voiced && Math.abs(note.midi - 61) < .2, JSON.stringify(note));
    }
  }
});

test('pause, resume, seek and disposal publish effective generations and release subscriptions', async () => {
  const f = fixture(), engine = f.create(), observed = [];
  const unsubscribe = engine.subscribePlayback(state => observed.push(state));
  await engine.load('/tone'); engine.play(0); f.render(20);
  const initial = engine.getPlaybackSnapshot();
  engine.pause(); f.render(1);
  const paused = engine.getPlaybackSnapshot();
  assert.equal(paused.playing, false);
  f.render(15); assert.equal(engine.getPlaybackSnapshot().sourceTime, paused.sourceTime);
  engine.seek(2); f.render(1);
  assert.ok(engine.getPlaybackSnapshot().generation > initial.generation);
  engine.play(); f.render(8); assert.equal(engine.getPlaybackSnapshot().playing, true);
  assert.ok(engine.getPlaybackSnapshot().sourceTime >= 2);
  const count = observed.length; unsubscribe(); engine.pause(); f.render(1);
  assert.equal(observed.length, count);
  engine.dispose(); assert.equal(engine.getPlaybackSnapshot().valid, false);
});

test('real final audio survives EOF at both extreme keys and every boundary speed', async () => {
  for (const key of [-12, 0, 12]) for (const tempo of [.5, 1, 1.5]) {
    const f = fixture(), engine = f.create();
    engine.setPitch(key); engine.setTempo(tempo);
    await engine.load('/tone'); engine.play(0);
    const output = f.render(Math.ceil((6 / tempo + .05) * 48000 / 128))[0];
    const positions = f.nodes[0].messages.filter(message => message.type === 'position');
    assert.ok(positions.every((message, i) => i === 0 || message.contextFrame >= positions[i - 1].contextFrame), 'partial final quantum cannot publish a backward clock');
    const final = positions.at(-1);
    assert.equal(final.playing, false, `key=${key},tempo=${tempo}`);
    assert.equal(final.position, 6 * 48000);
    assert.ok(Math.abs(final.contextFrame / 48000 - 6 / tempo) <= 128 / 48000);
    const nearEnd = output.subarray(Math.floor((6 / tempo - .2) * 48000), Math.floor((6 / tempo - .07) * 48000));
    const pitch = Core.detectPitch(nearEnd, 48000);
    assert.ok(pitch.voiced && Math.abs(pitch.midi - (69 + key)) < .15, `key=${key},tempo=${tempo}: ${JSON.stringify(pitch)}`);
    assert.ok(output.subarray(Math.ceil(6 / tempo * 48000)).every(value => value === 0));
  }
});

function magnitude(samples, hz, sampleRate) {
  let real = 0, imaginary = 0;
  for (let i = 0; i < samples.length; i++) {
    const phase = 2 * Math.PI * hz * i / sampleRate;
    const sample = samples[i] * (1 - Math.cos(2 * Math.PI * i / samples.length));
    real += sample * Math.cos(phase);
    imaginary += sample * Math.sin(phase);
  }
  return 2 * Math.hypot(real, imaginary) / samples.length;
}

test('large pitch shifts suppress the SoundTouch alias and imaging while retaining the low musical tone', async () => {
  const sampleRate = 48000;
  for (const [key, high, artifact, expected] of [[12, 18000, 12000, 2000], [-12, 10000, 19000, 500]]) {
    const audio = Float32Array.from({ length: sampleRate * 2 }, (_, i) => {
      const phase = 2 * Math.PI * i / sampleRate;
      return .15 * Math.sin(phase * 1000) + .35 * Math.sin(phase * high);
    });
    const render = async signalsmith => {
      const f = fixture({ audio, signalsmith, sampleRate }), engine = f.create();
      engine.setPitch(key);
      assert.equal(await engine.load('/tone'), true);
      assert.equal(f.nodes[0].messages[0].backend, signalsmith ? 'signalsmith' : 'soundtouch');
      engine.play(0);
      return f.render(570)[0].subarray(48000, 72000);
    };
    const [original, candidate] = await Promise.all([render(false), render(true)]);
    const fundamental = magnitude(candidate, expected, sampleRate);
    assert.ok(fundamental > .04, `key ${key}: musical tone amplitude ${fundamental}`);
    const baseline = magnitude(original, artifact, sampleRate);
    assert.ok(baseline > .01, 'old engine reproduces the audible alias or image');
    const residue = magnitude(candidate, artifact, sampleRate);
    assert.ok(residue < baseline / 100, `key ${key}: expected 40 dB of suppression (${baseline} → ${residue})`);
  }
});

test('original key and tempo render the source samples unchanged', async () => {
  const audio = Float32Array.from({ length: 4096 }, (_, i) => ((i * 31 % 257) - 128) / 256);
  const f = fixture({ audio }), engine = f.create();
  assert.equal(await engine.load('/dry'), true);
  engine.play(0);
  assert.deepEqual(f.render(32)[0], audio);
});
