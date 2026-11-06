'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadEngine, fakeRoot } = require('./helpers/practice-engine-harness');
const Scoring = require('../public/js/practice/practice-scoring');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function audioFixture({ module = Promise.resolve(), fetch, channels = 1 } = {}) {
  const requests = [], nodes = [], warnings = [];
  let modules = 0, decodes = 0;
  const context = { sampleRate: 48000, currentTime: 0,
    audioWorklet: { addModule() { modules++; return module; } },
    async decodeAudioData() {
      decodes++;
      return { duration: 4, sampleRate: 48000, numberOfChannels: channels,
        getChannelData: c => Float32Array.from([.1 + c, -.2, .3]) };
    },
  };
  const scope = vm.createContext({ window: {}, AbortController, performance,
    console: { warn: (...args) => warnings.push(args) },
    setInterval: () => 1, clearInterval() {},
    fetch: (url, options) => {
      requests.push({ url, ...options });
      return fetch ? fetch(url, options) : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    },
    AudioWorkletNode: class {
      constructor() {
        this.port = { close() {}, postMessage: (message, transfer) => {
          if (message.type !== 'load') return;
          this.bytes = transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
          this.data = structuredClone(message, { transfer });
        } };
        nodes.push(this);
      }
      connect() {} disconnect() {}
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../public/js/soundtouch-engine.js'), 'utf8'), scope);
  const engine = scope.window.createSoundTouchEngine(); engine.attach(context, {});
  return { engine, requests, nodes, warnings, get modules() { return modules; }, get decodes() { return decodes; } };
}

test('loads share module initialization and only the latest song downloads after it resolves', async () => {
  const module = deferred(), f = audioFixture({ module: module.promise });
  const old = f.engine.load('/old'), latest = f.engine.load('/latest');
  assert.equal(f.modules, 1);
  module.resolve();
  assert.deepEqual(await Promise.all([old, latest]), [false, true]);
  assert.deepEqual(f.requests.map(r => r.url), ['/latest']);
  assert.equal(f.decodes, 1);
  f.engine.dispose();
});

test('disposal during module initialization never starts a late download', async () => {
  const module = deferred(), f = audioFixture({ module: module.promise });
  const load = f.engine.load('/old'); f.engine.dispose(); module.resolve();
  assert.equal(await load, false); assert.equal(f.requests.length, 0); assert.equal(f.engine.isReady(), false);
});

test('superseded downloads are aborted and stale bodies never enter audio decoding', async () => {
  const body = deferred(), f = audioFixture({ fetch: async url => ({ ok: true,
    arrayBuffer: () => url === '/old' ? body.promise : Promise.resolve(new ArrayBuffer(0)) }) });
  const old = f.engine.load('/old');
  await new Promise(resolve => setImmediate(resolve));
  const latest = f.engine.load('/latest');
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(await latest, true);
  body.resolve(new ArrayBuffer(0));
  assert.equal(await old, false); assert.equal(f.decodes, 1); assert.equal(f.warnings.length, 0);
  f.engine.dispose();
});

test('disposal aborts an active request without a warning or fallback node', async () => {
  const f = audioFixture({ fetch: (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }) });
  const load = f.engine.load('/old'); await new Promise(resolve => setImmediate(resolve));
  f.engine.dispose();
  assert.equal(await load, false); assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.nodes.length, 0); assert.equal(f.warnings.length, 0);
});

test('mono shares read-only PCM, stereo preserves separate channels and failed HTTP does not decode', async () => {
  for (const channels of [1, 2]) {
    const f = audioFixture({ channels }); assert.equal(await f.engine.load('/song'), true);
    const { data, bytes } = f.nodes[0];
    assert.equal(bytes, 3 * 4 * channels);
    assert.equal(data.left.buffer === data.right.buffer, channels === 1);
    assert.equal(data.left[0], Math.fround(.1));
    assert.equal(data.right[0], Math.fround(channels === 1 ? .1 : 1.1));
    f.engine.dispose();
  }
  const f = audioFixture({ fetch: async () => ({ ok: false, status: 404 }) });
  assert.equal(await f.engine.load('/missing'), false); assert.equal(f.decodes, 0); assert.equal(f.engine.isReady(), false);
});

test('late-song interval search retains overlapping long notes and exact boundary behavior', () => {
  const Engine = loadEngine(); let t = 90;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(),
    clock: () => ({ t, tempo: 1 }), onSync() {} });
  const guide = Scoring.prepareGuide({ duration: 120, lines: [], notes: [
    { start: 90, end: 110, midi: 60, line: -1 },
    ...Array.from({ length: 1000 }, (_, i) => ({ start: i / 10, end: i / 10 + .08, midi: 60, line: -1 })),
  ] });
  engine.setGuide(guide); engine.setPlaying(true, t);
  for (let i = 0; i < 120; i++, t += .01) engine.pitch({ f0: 261.625565, clarity: .99, rms: .05 },
    { valid: true, t, playing: true, audioTime: t, generation: 1, key: 0, tempo: 1 });
  const long = guide.notes.find(n => n.end === 110);
  assert.ok(long.seen > .1, 'a long overlapping note must survive the indexed search');
  assert.ok(long.hit > .1);
  assert.ok(guide.notes.filter(n => n.end < 90).every(n => n.seen === 0), 'past notes get no new singing time');
  engine.destroy();
});

test('static practice canvas stops repainting and resumes for playback, style, resize and new data', () => {
  const Engine = loadEngine(), root = fakeRoot(), canvas = root.querySelector('[data-ps="canvas"]');
  canvas.clientWidth = 960; canvas.clientHeight = 320;
  let draw, paints = 0, t = 0;
  const context = canvas.getContext();
  canvas.getContext = () => new Proxy(context, { get: (target, key) => key === 'clearRect' ? () => paints++ : target[key] });
  globalThis.requestAnimationFrame = fn => { draw = fn; return 1; };
  const engine = Engine.createPracticeEngine({ role: 'panel', root, clock: () => ({ t }) });
  draw(); draw(); assert.equal(paints, 1, 'blank canvas clears once');
  engine.setGuide(Scoring.prepareGuide({ duration: 10, lines: [], notes: [{ start: 0, end: 5, midi: 60, line: -1 }] }));
  draw(); const first = paints; draw(); draw(); assert.equal(paints, first, 'paused canvas keeps its pixels');
  engine.setStyle({ fx: 'quiet' }); draw(); assert.equal(paints, first + 1);
  canvas.clientWidth = 800; draw(); assert.equal(paints, first + 2);
  engine.setKey(3); draw(); assert.equal(paints, first + 3);
  engine.setGhost([{ t: 0, midi: 60 }]); draw(); assert.equal(paints, first + 4);
  engine.setPlaying(true, 0); draw(); t = .01; draw(); assert.equal(paints, first + 6, 'playing still draws every frame');
  engine.destroy();
});

test('hidden practice retains a bounded display trail, sends every new sample and preserves long-note technique input', () => {
  const Engine = loadEngine(); let t = 0, delivered = 0;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(),
    clock: () => ({ t, tempo: 1 }), onSync: m => { if (m.type === 'frame') delivered += m.trail.length; } });
  engine.setGuide(Scoring.prepareGuide({ duration: 30, lines: [], notes: [
    { start: 2, end: 8, midi: 60, line: -1 },
    ...Array.from({ length: 40 }, (_, i) => ({ start: 10 + i * .3, end: 10.2 + i * .3, midi: 60, line: -1 })),
  ] }));
  engine.setPlaying(true, 0);
  for (let i = 0; i < 3000; i++) {
    t = i * .01;
    engine.pitch({ f0: 261.625565, clarity: .99, rms: .05 },
      { valid: true, t, audioTime: t, generation: 1, playing: true, key: 0, tempo: 1 });
    if (i % 5 === 0) engine.syncFrame();
    if (i === 790) {
      assert.ok(engine._state.trail.some(p => p.t < 2), 'long-note onset remains available until it can be judged');
      engine._detectTechnique(engine.getGuide().notes[0]);
      assert.equal(engine._state.techCount['LONG TONE'], 1);
    }
  }
  engine.syncFrame();
  assert.equal(delivered, 3000, 'pruning only follows successful delivery of the new samples');
  assert.ok(engine._state.trail.length < 250, 'hidden canvas cannot accumulate the entire song');
  assert.ok(engine._state.pitchTrace.length > 500, 'saved take history remains independent of the display trail');
  engine.destroy();
});

test('attempt marking survives mixed grace periods, small clock reversals and a backward seek without detector data', () => {
  const Engine = loadEngine(); let t = 0;
  const engine = Engine.createPracticeEngine({ role: 'panel', root: fakeRoot(), clock: () => ({ t }), onSync() {} });
  engine.setGuide(Scoring.prepareGuide({ duration: 4, lines: [], notes: [
    { start: 0, end: 2, midi: 60, line: -1 }, { start: .03, end: .07, midi: 60, line: -1 },
    { start: .12, end: .3, midi: 60, line: -1 }, { start: .18, end: 1, midi: 60, line: -1 },
  ] }));
  engine.setPlaying(true, 0);
  const notes = engine.getGuide().notes;
  let expected = notes.map(() => false);
  for (t of [.001, .041, .14, .151, .19, .17, .3, .34]) {
    expected = expected.map((value, i) => value || notes[i].start <= t && notes[i].start + notes[i].grace < t);
    engine.syncFrame(); assert.deepEqual(notes.map(n => n.attempted), expected);
  }
  t = 0; engine.seek(0); t = .05; engine.syncFrame();
  assert.deepEqual(notes.map(n => n.attempted), [false, true, false, false]);
  engine.destroy();
});
