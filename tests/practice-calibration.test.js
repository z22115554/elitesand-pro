'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Calibration = require('../public/js/practice/practice-calibration');
const Fx = require('../public/js/practice/practice-fx');
const Scoring = require('../public/js/practice/practice-scoring');
const env = (overrides) => ({ micId: 'mic-a', outputId: 'speakers-a', sampleRate: 48000, contextSampleRate: 48000, ...overrides });

test('profiles isolate actual input, output route and both sample rates; legacy global values are not migrated', () => {
  let saved;
  const profiles = Calibration.createProfiles({ data: 380, save: (data) => { saved = data; }, now: () => 42 });
  profiles.select(env());
  assert.equal(profiles.state().ms, 120);
  assert.equal(profiles.state().method, null);
  assert.equal(profiles.remember(170, 'manual'), true);
  for (const changed of [{ micId: 'mic-b' }, { outputId: 'headphones-a' }, { sampleRate: 44100 }, { contextSampleRate: 44100 }]) {
    profiles.select(env(changed));
    assert.equal(profiles.state().ms, 120);
    assert.equal(profiles.state().method, null);
  }
  profiles.select(env());
  assert.equal(profiles.state().ms, 170);
  const restored = Calibration.createProfiles({ data: saved });
  restored.select(env());
  assert.equal(restored.state().method, 'manual');
  assert.equal(restored.state().ms, 170);
});

test('unknown identities are session-only and all changes invalidate pending results, including returning to an earlier route', () => {
  let writes = 0;
  const profiles = Calibration.createProfiles({ save: () => { writes++; } });
  profiles.select(env({ outputId: null }));
  const token = profiles.token();
  assert.equal(profiles.remember(190, 'acoustic', token), true);
  assert.equal(profiles.state().persistent, false);
  assert.equal(writes, 0);
  assert.equal(profiles.select(env({ outputId: null })), false);
  assert.equal(profiles.state().ms, 190);
  profiles.select(env({ outputId: null }), true);
  assert.equal(profiles.state().ms, 120);
  assert.equal(profiles.remember(190, 'acoustic', token), false);
  profiles.select(env());
  const knownToken = profiles.token();
  profiles.select(env({ outputId: 'other' })); profiles.select(env());
  assert.equal(profiles.isCurrent(knownToken), false);
  assert.equal(profiles.remember(180, 'acoustic', knownToken), false);
  for (const value of [-1, 401, 15, NaN, Infinity, '180']) assert.equal(profiles.remember(value, 'manual'), false);
});

test('local profiles validate schemas, deduplicate, and retain at most 32 recent hardware combinations', () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({ key: Calibration.profileKey(env({ micId: `mic-${i}` })), ms: 100, method: 'acoustic', updatedAt: i }));
  const invalid = [null, {}, { ...entries[0], ms: 999 }, { ...entries[0], method: 'server' }, { ...entries[0], key: '["default","out",48000,48000]' }, { ...entries[0], updatedAt: Infinity }];
  const clean = Calibration.sanitize({ version: 1, profiles: entries.concat(invalid, { ...entries[39], ms: 210, updatedAt: 50 }) });
  assert.equal(clean.length, 32);
  assert.equal(clean.at(-1).ms, 210);
  assert.equal(clean[0].key, entries[8].key);
  assert.deepEqual(Calibration.sanitize({ version: 2, profiles: entries }), []);
  let saved;
  const profiles = Calibration.createProfiles({ data: { version: 1, profiles: clean }, save: (data) => { saved = data; }, now: () => 60 });
  profiles.select(env({ micId: 'new' })); profiles.remember(200, 'manual');
  assert.equal(saved.profiles.length, 32);
  assert.equal(saved.profiles.at(-1).method, 'manual');
});

test('output identity resolves unambiguous default groups and includes dual routing and delay', () => {
  const devices = [{ kind: 'audiooutput', deviceId: 'default', groupId: 'g' }, { kind: 'audiooutput', deviceId: 'speaker', groupId: 'g' }];
  const signature = (sink = '', dual = false, a = '', b = '', delay = 0) => JSON.stringify([sink, dual, a, b, delay]);
  assert.equal(Calibration.outputIdentity(signature(), []), null);
  assert.equal(Calibration.outputIdentity(signature(), devices), signature('speaker'));
  assert.equal(Calibration.outputIdentity(signature('speaker', true, 'headphone', 'stream', .1), []), signature('speaker', true, 'headphone', 'stream', .1));
  assert.notEqual(Calibration.outputIdentity(signature('speaker', true, 'headphone', 'stream', .1), []), Calibration.outputIdentity(signature('speaker', true, 'headphone', 'stream', .2), []));
  assert.equal(Calibration.outputIdentity(signature(), devices.concat({ kind: 'audiooutput', deviceId: 'ambiguous', groupId: 'g' })), null);
  assert.equal(Calibration.outputIdentity('bad json', []), null);
  assert.equal(Calibration.profileKey(env({ micId: 'default' })), null);
  assert.equal(Calibration.profileKey(env({ sampleRate: undefined })), null);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function element() {
  const listeners = new Map();
  const el = { value: '', hidden: false, disabled: false, dataset: {}, style: {}, children: [], options: [], open: false,
    classList: { contains: () => false, toggle() {} }, querySelectorAll: () => [], setAttribute() {},
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    fire(name) { return Promise.all((listeners.get(name) || []).map((fn) => fn({ target: el }))); },
    appendChild(child) { this.children.push(child); this.options.push(child); },
    showModal() { this.open = true; }, close() { this.open = false; this.fire('close'); },
  };
  let text = '';
  Object.defineProperty(el, 'textContent', { get: () => text, set(value) { text = value; this.options = []; this.children = []; } });
  return el;
}
function audioContext() {
  const connectable = () => ({ connect: (next) => next, disconnect() {} });
  return { sampleRate: 48000, currentTime: 0, destination: {}, audioWorklet: { addModule: async () => {} }, resume: async () => {},
    connections: [], tones: [],
    createGain: () => ({ ...connectable(), gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} } }),
    createOscillator() { const tone = { ...connectable(), frequency: {}, start(at) { this.at = at; }, stop() { this.stopped = true; } }; this.tones.push(tone); return tone; },
    createMediaStreamSource(stream) { this.connections.push(stream); return connectable(); },
  };
}
function micStream(deviceId, sampleRate = 48000) {
  const ended = [];
  const settings = { deviceId, sampleRate };
  const track = { stopped: false, getSettings: () => settings, stop() { this.stopped = true; }, addEventListener: (name, fn) => { if (name === 'ended') ended.push(fn); } };
  return { active: true, getTracks: () => [track], getAudioTracks: () => [track], track, settings, ended };
}
function panel(options = {}) {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, element()); return els.get(id); };
  const store = new Map(Object.entries(options.storage || {}));
  const media = element(), win = element();
  const requests = [], nodes = [], timers = new Map();
  let timerId = 0;
  media.enumerateDevices = async () => options.devices || [];
  media.getUserMedia = (constraints) => { const request = deferred(); requests.push({ ...request, constraints }); return request.promise; };
  const ctx = audioContext();
  let playback = { audioContext: ctx, valid: false, outputSignature: '["speaker-a",false,"","",0]', playing: false };
  let onPlayback, engineOptions;
  const sent = [];
  const engine = { style: { ...Fx.STYLE_DEFAULT }, getStyle() { return this.style; }, setStyle(s) { Object.assign(this.style, s); },
    getStats: () => ({ unscorable: false, scoreTarget: null, tiers: {}, techCount: {}, ratings: [] }), getGuide: () => null,
    setPlaying() {}, resetInput() {}, startNewPass() {}, pitch() {}, songTime: () => 0 };
  Object.assign(win, { PracticeCalibration: Calibration, PracticeFx: Fx, location: { origin: 'https://example.invalid' },
    I18n: { t: (key) => key }, AppShared: { subscribePracticePlayback(fn) { onPlayback = fn; fn(playback); }, subscribePracticePlaybackBoundary() {} } });
  const scope = { window: win, navigator: { mediaDevices: media }, document: { getElementById: get, createElement: element, addEventListener() {} },
    localStorage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
    PracticeScoring: Scoring, PracticeEngine: { createPracticeEngine: (opts) => { engineOptions = opts; return engine; } }, URL,
    SocketClient: { connected: () => true, on() {}, sendWithCallback() {}, send: (event, data) => sent.push({ event, data }) },
    PracticeFeedback: { create: () => ({ finish() {}, cancel() {}, render() {}, playback() {}, reset() {}, refresh() {}, contextChanged() {} }) },
    AudioWorkletNode: class { constructor() { this.port = {}; nodes.push(this); } connect(next) { return next; } disconnect() {} },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval: () => 0, clearInterval() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/app-practice.js'), 'utf8'), scope);
  return { get, store, requests, ctx, nodes, media, win, sent, finish: (take) => engineOptions.onFinish(take),
    async source(mode) { get('practice-source').value = mode; const p = get('practice-source').fire('change'); await flush(); return { done: p }; },
    playback(change) { playback = { ...playback, ...change }; onPlayback(playback); },
    pitch(data) { nodes.at(-1).port.onmessage({ data }); },
    finishCalibration() { const item = [...timers.values()].find((item) => item.delay === 7000); assert.ok(item); item.fn(); },
  };
}
async function startMic(p, stream = micStream('mic-a')) {
  const task = await p.source('mic');
  p.requests.at(-1).resolve(stream);
  await task.done; await flush();
  return stream;
}
async function measure(p) {
  await p.get('practice-calibrate').fire('click');
  await p.get('practice-calibration-start').fire('click');
  p.pitch({ time: .1, rms: .001, clarity: 0, f0: 0 });
  for (let i = 0; i < 8; i++) p.pitch({ time: .8 + i * .7 + .12, rms: .1, clarity: .99, f0: 880 });
  p.finishCalibration();
  assert.equal(p.get('practice-calibration-apply').hidden, false);
}

test('panel keeps scoring available with 120 ms fallback, ignores legacy global and restores only matching profiles', async () => {
  const p = panel({ storage: { 'elitesand-practice-latency': '380' } });
  await startMic(p);
  assert.equal(Number(p.get('practice-latency').value), 120);
  assert.equal(p.get('practice-latency-status').textContent, 'practice.latencyUncalibrated');
  assert.equal(p.get('practice-latency').disabled, false);
  p.get('practice-latency').value = '200'; await p.get('practice-latency').fire('input');
  assert.equal(p.get('practice-latency-status').textContent, 'practice.latencyManual');
  p.playback({ outputSignature: '["speaker-b",false,"","",0]' });
  assert.equal(Number(p.get('practice-latency').value), 120);
  p.playback({ outputSignature: '["speaker-a",false,"","",0]' });
  assert.equal(Number(p.get('practice-latency').value), 200);
  assert.equal(JSON.parse(p.store.get(Calibration.STORAGE_KEY)).profiles.length, 1);
});

test('superseded microphone acquisition is stopped, including mode changes and stale failures', async () => {
  const p = panel();
  const first = await p.source('mic');
  p.get('practice-device').value = 'mic-b';
  const second = p.get('practice-device').fire('change'); await flush();
  const newStream = micStream('mic-b'); p.requests[1].resolve(newStream); await second;
  const stale = micStream('mic-a'); p.requests[0].resolve(stale); await first.done;
  assert.equal(stale.track.stopped, true);
  assert.deepEqual(p.ctx.connections, [newStream]);
  const third = await p.source('mic');
  await p.source('off');
  p.requests[2].reject(new Error('old denied')); await third.done;
  assert.equal(p.get('practice-source').value, 'off');
  assert.equal(newStream.track.stopped, true);
});

test('880 Hz calibration applies a local profile and rejects stale results on output or sample-rate changes', async () => {
  const p = panel(); const stream = await startMic(p);
  await measure(p);
  assert.equal(p.ctx.tones.length, 8);
  assert.ok(p.ctx.tones.every((tone) => tone.frequency.value === 880));
  await p.get('practice-calibration-apply').fire('click');
  const saved = JSON.parse(p.store.get(Calibration.STORAGE_KEY));
  assert.equal(saved.profiles[0].ms, 120);
  assert.equal(saved.profiles[0].method, 'acoustic');
  await measure(p);
  stream.settings.sampleRate = 44100;
  await p.get('practice-calibration-apply').fire('click');
  assert.equal(p.get('practice-calibration-apply').hidden, true);
  assert.equal(JSON.parse(p.store.get(Calibration.STORAGE_KEY)).profiles.length, 1);
  stream.settings.sampleRate = 48000; p.playback({});
  await measure(p);
  p.playback({ outputSignature: '["speaker-b",false,"","",0]' });
  assert.equal(p.get('practice-calibration-apply').hidden, true);
  assert.equal(p.get('practice-calibration-status').textContent, 'practice.calibrationChanged');
  await p.get('practice-calibration-apply').fire('click');
  assert.equal(JSON.parse(p.store.get(Calibration.STORAGE_KEY)).profiles.length, 1);
});

test('devicechange and closing while resume is pending cancel measurement and stop stale mic streams', async () => {
  const p = panel(); const stream = await startMic(p);
  const resume = deferred(); p.ctx.resume = () => resume.promise;
  await p.get('practice-calibrate').fire('click');
  const start = p.get('practice-calibration-start').fire('click');
  p.get('practice-calibration').close(); resume.resolve(); await start;
  assert.equal(p.ctx.tones.length, 0);
  assert.equal(p.get('practice-calibration-start').disabled, false);
  p.ctx.resume = async () => {};
  await p.get('practice-calibrate').fire('click'); await p.get('practice-calibration-start').fire('click');
  await p.media.fire('devicechange'); await flush();
  assert.equal(stream.track.stopped, true);
  assert.equal(p.get('practice-calibration-apply').hidden, true);
  assert.ok(p.ctx.tones.every((tone) => tone.stopped));
  await p.win.fire('pagehide');
  const stale = micStream('mic-b'); p.requests.at(-1).resolve(stale); await flush();
  assert.equal(stale.track.stopped, true);
});

test('only a finished full mic take asks whether the judging was accurate, and only once', async () => {
  const p = panel();
  const verdict = p.get('practice-verdict');
  verdict.hidden = true;
  const take = { source: 'mic', score: 90, seconds: 60, scoreMode: 'strict', scope: { type: 'full' } };
  p.finish({ ...take, source: 'demo' });
  assert.equal(verdict.hidden, true, 'the demo is the original vocal');
  p.finish({ ...take, scope: { type: 'partial' } });
  assert.equal(verdict.hidden, true, 'partial takes are not counted');
  p.finish(take);
  assert.equal(verdict.hidden, false);
  assert.equal(JSON.stringify(p.sent.at(-1)), JSON.stringify({ event: 'practice:scored', data: { source: 'mic', score: 90, seconds: 60, scoreMode: 'strict' } }));
  verdict.closest = () => ({ dataset: { verdict: 'inaccurate' } });
  await verdict.fire('click');
  assert.equal(JSON.stringify(p.sent.at(-1)), JSON.stringify({ event: 'practice:verdict', data: { verdict: 'inaccurate', scoreMode: 'strict' } }));
  assert.equal(p.get('practice-verdict-ask').hidden, true);
  assert.equal(p.get('practice-verdict-report').hidden, false, 'not accurate offers a report');
  const count = p.sent.length;
  await verdict.fire('click');
  assert.equal(p.sent.length, count, 'one answer per take');
  const panelSource = fs.readFileSync(path.join(__dirname, '../public/js/app-practice.js'), 'utf8');
  assert.ok(panelSource.includes('if (s.playing) hideVerdict()'), 'singing again clears the question');
});
