'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('./practice-pitch-probe');

function fixture() {
  let Processor;
  const scope = vm.createContext({ Float32Array, Float64Array, Math, Number, sampleRate: 48000, currentFrame: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor(name, Type) { assert.equal(name, 'soundtouch-processor'); Processor = Type; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/vendor/soundtouch-worklet.js'), 'utf8'), scope);
  const nodes = [];
  const context = { sampleRate: 48000, currentTime: 0, state: 'running',
    audioWorklet: { async addModule() {} },
    async decodeAudioData() {
      const audio = Float32Array.from({ length: 48000 * 6 }, (_, i) => .15 * Math.sin(2 * Math.PI * 440 * i / 48000));
      return { duration: 6, sampleRate: 48000, numberOfChannels: 1, getChannelData() { return audio; } };
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
  const main = vm.createContext({ window: {}, AudioWorkletNode: Node, console, performance,
    fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
    setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/soundtouch-engine.js'), 'utf8'), main);
  function create() { const engine = main.window.createSoundTouchEngine(); engine.attach(context, {}); return engine; }
  function render(count = 1) {
    const audio = new Map(nodes.map(n => [n, []]));
    for (let i = 0; i < count; i++) {
      scope.currentFrame = Math.round(context.currentTime * 48000);
      for (const node of nodes) {
        const left = new Float32Array(128), right = new Float32Array(128);
        node.processor.process([], [[left, right]]); audio.get(node).push(...left);
      }
      context.currentTime = (scope.currentFrame + 128) / 48000;
    }
    return nodes.map(node => Float32Array.from(audio.get(node)));
  }
  return { create, render, context, nodes };
}

test('real engine/worklet clock reports rendered output rather than 16,384-frame prefetch', async () => {
  const f = fixture(), engine = f.create();
  await engine.load('/tone'); engine.play(0);
  const output = f.render(8)[0];
  const state = engine.getPlaybackSnapshot(), report = f.nodes[0].messages.at(-1);
  assert.equal(state.valid, true);
  assert.equal(report.position, 1024);
  assert.ok(report.prefetchedPosition >= 16384);
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
  const f = fixture(), first = f.create(), second = f.create();
  await Promise.all([first.load('/tone-a'), second.load('/tone-b')]);
  const at = first.scheduleFrame(.05);
  first.play(1, at); second.play(1, at); f.render(40);
  const next = first.scheduleFrame(.05);
  first.setPitch(-2, next); second.setPitch(-2, next);
  first.setTempo(1.25, next); second.setTempo(1.25, next);
  f.render(40);
  const seekAt = first.scheduleFrame(.05);
  first.seek(3, seekAt); second.seek(3, seekAt); f.render(40);
  const a = first.getPlaybackSnapshot(), b = second.getPlaybackSnapshot();
  assert.equal(a.sourceTime, b.sourceTime); assert.equal(a.effectiveContextTime, b.effectiveContextTime);
  assert.equal(a.pitchShift, -2); assert.equal(b.pitchShift, -2);
  assert.equal(a.playbackRate, 1.25); assert.equal(b.playbackRate, 1.25);
  assert.ok(a.generation > 1 && b.generation > 1);
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
