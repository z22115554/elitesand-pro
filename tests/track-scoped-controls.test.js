'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function node() {
  const handlers = {};
  return { value: '0', textContent: '', addEventListener(event, fn) { handlers[event] = fn; },
    fire(event) { handlers[event]?.(); } };
}

function panel() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
  const start = source.indexOf('// Phase 7: 變調控制');
  const end = source.indexOf('// 變調/變速 上下按鈕', start);
  assert.ok(start > 0 && end > start);
  const pending = new Map(), sent = [];
  let timerId = 0;
  const dom = Object.fromEntries(['pitchSlider','pitchValue','pitchReset','speedSlider','speedValue','speedReset'].map(k => [k,node()]));
  const state = { playlist: [{ id: 'a', entryId: 'entry-a' }, { id: 'b', entryId: 'entry-b' }], currentTrackIndex: 0 };
  const scope = vm.createContext({ dom, state, stLoadToken: 1, currentPitchShift: 0, currentPlaybackRate: 1,
    AppShared: { showToast() {} }, applyPitchAndSpeed() {},
    SocketClient: { send(event, payload) { sent.push([event, JSON.parse(JSON.stringify(payload))]); } },
    ErrorHandler: { debounce(fn) { let last; return (...args) => {
      pending.delete(last); last = ++timerId; pending.set(last, () => fn(...args));
    }; } },
  });
  vm.runInContext(source.slice(start, end), scope, { filename: 'app-playback-controls.js' });
  return { dom, state, scope, sent, flush() { const jobs = [...pending.values()]; pending.clear(); jobs.forEach(fn => fn()); } };
}

test('S-07: a debounced pitch from A cannot change newly selected B', () => {
  const f = panel(); f.dom.pitchSlider.value = '3'; f.dom.pitchSlider.fire('input');
  f.state.currentTrackIndex = 1; f.scope.stLoadToken++; f.flush();
  assert.deepEqual(f.sent, []);
});

test('S-07: a debounced speed from A cannot survive A to B to A or a full stop', () => {
  for (const stop of [false,true]) {
    const f = panel(); f.dom.speedSlider.value = '1.25'; f.dom.speedSlider.fire('input');
    f.scope.stLoadToken += 2;
    if (stop) f.state.currentTrackIndex = -1;
    f.flush(); assert.deepEqual(f.sent, []);
  }
});

test('reset supersedes an already pending slider value for the same track', () => {
  const f = panel(); f.dom.pitchSlider.value = '5'; f.dom.pitchSlider.fire('input');
  f.dom.pitchReset.fire('click'); f.flush();
  assert.deepEqual(f.sent, [['pitch:change', { value: 0, trackId: 'a', entryId: 'entry-a' }]]);
  f.sent.length = 0; f.dom.speedSlider.value = '.75'; f.dom.speedSlider.fire('input');
  f.dom.speedReset.fire('click'); f.flush();
  assert.deepEqual(f.sent, [['speed:change', { value: 1, trackId: 'a', entryId: 'entry-a' }]]);
});

test('a stable track keeps the latest debounced value and its song identity', () => {
  const f = panel(); f.dom.pitchSlider.value = '2'; f.dom.pitchSlider.fire('input');
  f.dom.pitchSlider.value = '4'; f.dom.pitchSlider.fire('input'); f.flush();
  assert.deepEqual(f.sent, [['pitch:change', { value: 4, trackId: 'a', entryId: 'entry-a' }]]);
});

function server(current = { id: 'b', entryId: 'entry-b' }) {
  const handlers = {}, emitted = [], updates = [];
  const silent = { info() {}, warn() {}, error() {} };
  const module = { exports: {} };
  const ctx = { playState: { currentTrack: current, pitchShift: 0, playbackRate: 1 },
    trackOffsets: new Map(), trackPitch: new Map(), trackSpeed: new Map(), manualLyricsCache: new Map(),
    persistState() { updates.push('persist'); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/routes/handlers/playback.js'), 'utf8'), {
    module, exports: module.exports, console, Date, Number, Map, isFinite,
    require(id) {
      if (id === '../../utils/logger') return { createLogger: () => silent };
      if (id === '../../utils/socket-broadcast') return {};
      if (id === '../../services/library-store') return { updateMeta: (...args) => updates.push(args) };
      if (id === '../../services/romanizer') return {};
      if (id === '../../utils/track-schema') return {};
      if (id === '../../services/usage-telemetry') return {};
      if (id === './lyrics') return { LYRIC_TEMPLATES: [] };
      if (id === '../../../public/js/playback-sequence') return require('../public/js/playback-sequence');
      throw new Error('Unexpected import: '+id);
    },
  }, { filename: 'playback.js' });
  module.exports({ emit: (...args) => emitted.push(args) }, { on: (event, fn) => { handlers[event] = fn; } }, ctx);
  return { ctx, emitted, updates, send: (event,payload) => handlers[event](payload) };
}

test('server rejects a scoped transform for a previous song or playlist occurrence', () => {
  for (const current of [{ id: 'b', entryId: 'entry-b' }, { id: 'a', entryId: 'entry-a-again' }]) {
    const f = server(current);
    f.send('pitch:change', { value: 3, trackId: 'a', entryId: 'entry-a' });
    f.send('speed:change', { value: .75, trackId: 'a', entryId: 'entry-a' });
    assert.equal(f.ctx.playState.pitchShift, 0); assert.equal(f.ctx.playState.playbackRate, 1);
    assert.deepEqual(f.emitted, []); assert.deepEqual(f.updates, []);
  }
});

test('server accepts valid scoped values but preserves numeric legacy clients', () => {
  const f = server();
  f.send('pitch:change', { value: 3, trackId: 'b', entryId: 'entry-b' });
  f.send('speed:change', { value: .75, trackId: 'b', entryId: 'entry-b' });
  assert.equal(f.ctx.playState.pitchShift, 3); assert.equal(f.ctx.playState.playbackRate, .75);
  assert.equal(f.ctx.trackPitch.get('b'), 3); assert.equal(f.ctx.trackSpeed.get('b'), .75);
  f.send('pitch:change', 0); f.send('speed:change', 1);
  assert.equal(f.ctx.trackPitch.has('b'), false); assert.equal(f.ctx.trackSpeed.has('b'), false);
});

test('malformed or out of range transform packets never mutate or persist', () => {
  const f = server();
  for (const payload of [null, {}, [], {value:3}, {value:'3',trackId:'b',entryId:'entry-b'},
    {value:Infinity,trackId:'b',entryId:'entry-b'}, {value:100,trackId:'b',entryId:'entry-b'}]) {
    f.send('pitch:change', payload); f.send('speed:change', payload);
  }
  assert.deepEqual(f.emitted, []); assert.deepEqual(f.updates, []);
});
