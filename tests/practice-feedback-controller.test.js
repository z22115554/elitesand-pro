'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Feedback = require('../public/js/practice/practice-feedback-controller');
const translate = (key, values) => values ? `${key} ${JSON.stringify(values)}` : key;
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function node() {
  const listeners = new Map();
  let content = '';
  return { children: [], value: '', checked: false, disabled: false,
    get textContent() { return content; }, set textContent(value) { content = value; this.children = []; },
    addEventListener(type, fn) { listeners.set(type, fn); }, appendChild(child) { this.children.push(child); },
    async fire(type) { const listener = listeners.get(type); if (listener) return listener({ target: this }); } };
}
function take(overrides = {}) {
  return { source: 'mic', guideId: 'guide-a', scoreVersion: 'source-time-v2', score: 81, key: 0, tempo: 1,
    allowOctave: false, mixedContext: false, scope: { type: 'full', start: 0, end: 10 }, requiredSeconds: 6,
    observedSeconds: 5, voicedSeconds: 4, lineFeedback: [], weakLines: [], pitchTrace: [], ...overrides };
}
const comparison = overrides => ({ comparable: true, previous: null, best: null, delta: null, usualKey: 0,
  improvedLines: [], isPersonalBest: true, ...overrides });
function saved(payload) { return { take: { ...payload, id: 'saved-1' }, comparison: comparison(), challengeResult: null }; }
function fixture(handler) {
  const elements = new Map();
  const doc = { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
    querySelector: () => null, createElement: node };
  let snapshot = { valid: true, playing: true, sourceTime: 5, generation: 7, pitchShift: 0, playbackRate: 1,
    track: { id: 'track-a', title: 'Song A', artist: 'Singer' } };
  let source = 'mic', settings = { allowOctave: false }, range = null, sequence = 0;
  const guide = { guideId: 'guide-a', trackId: 'track-a', duration: 10 };
  const calls = [], sent = [], seeks = [], requests = [];
  const engine = { getGuide: () => guide, getRange: () => range, setGhost: value => calls.push(['ghost', value]),
    setRange(value) { range = value && { start: value.start, end: value.end }; calls.push(['range', range]); },
    setPlaying: (...args) => calls.push(['playing', ...args]), startNewPass: () => calls.push(['start']),
    finish: value => calls.push(['finish', value]) };
  const request = async (url, opts) => {
    requests.push([url, opts]);
    if (handler) { const result = handler(url, opts); if (result !== undefined) return result; }
    if (url.startsWith('/takes?')) return { takes: [] };
    if (url.startsWith('/challenges?')) return { challenge: null };
    if (url === '/challenge-settings') return { viewerRequestsEnabled: false };
    if (url === '/takes' && opts.method === 'POST') return saved(JSON.parse(opts.body));
    throw new Error(`Unexpected request: ${url}`);
  };
  const controller = Feedback.create({ engine, document: doc, request, t: translate, seek: (...args) => { seeks.push(args); return true; },
    send: message => sent.push(message), getSnapshot: () => snapshot, getSource: () => source,
    getOptions: () => settings, makeId: () => `client-${++sequence}` });
  controller.reset('track-a');
  return { controller, engine, calls, sent, seeks, requests, el: id => doc.getElementById(`practice-${id}`),
    setSnapshot: patch => { snapshot = { ...snapshot, ...patch }; }, setSource: value => { source = value; },
    setOptions: value => { settings = value; } };
}
const weakLine = { line: 0, start: 2, end: 4, text: 'Try this phrase', score: 50, requiredSeconds: 1.7,
  observedSeconds: 1.6, voicedSeconds: 1.5, signedCents: 130, onsetMs: 140 };
async function clickWeak(f) { await f.el('weak-lines').children[0].children[0].fire('click'); }

test('comparison context requires the same key, tempo, octave rule and exact full/range scope', () => {
  const a = { ...take(), trackId: 'track-a' };
  assert.equal(Feedback.sameContext(a, { ...a }), true);
  for (const changes of [{ key: 1 }, { tempo: 0.9 }, { allowOctave: true }, { guideId: 'guide-b' },
    { scoreVersion: 'old' }, { trackId: 'track-b' }, { mixedContext: true },
    { scope: { type: 'range', start: 0, end: 10 } }, { scope: { type: 'full', start: 0, end: 9.99 } },
    { scope: { type: 'partial', start: 0, end: 10 } }]) {
    assert.equal(Feedback.sameContext(a, { ...a, ...changes }), false, JSON.stringify(changes));
    assert.equal(Feedback.sameContext({ ...a, ...changes }, a), false, 'comparison remains symmetric');
  }
  assert.equal(Feedback.sameContext(null, a), false);
});

test('diagnosis distinguishes signed pitch direction and observed early/late or unavailable onset', () => {
  assert.match(Feedback.diagnosis({ signedCents: 123, onsetMs: 125 }, translate), /sharp.*123.*late.*125/);
  assert.match(Feedback.diagnosis({ signedCents: -102, onsetMs: -111 }, translate), /flat.*102.*early.*111/);
  assert.match(Feedback.diagnosis({ signedCents: 5, onsetMs: 20 }, translate), /pitchStable.*onTime/);
  assert.equal(Feedback.diagnosis({ signedCents: null, onsetMs: null }, translate), 'practice.review.onsetUnknown');
});

test('completed eligible mic takes save the captured conditions then emit one OBS recap', async () => {
  const f = fixture();
  await f.controller.finish(take({ weakLines: [weakLine] }));
  const posts = f.requests.filter(([url, opts]) => url === '/takes' && opts.method === 'POST');
  assert.equal(posts.length, 1);
  const payload = JSON.parse(posts[0][1].body);
  assert.equal(payload.source, 'mic'); assert.equal(payload.completed, true); assert.equal(payload.valid, true);
  assert.equal(payload.trackId, 'track-a'); assert.equal(payload.title, 'Song A — Singer');
  assert.equal(payload.duration, 10); assert.equal(payload.clientTakeId, 'client-1');
  assert.equal(f.el('review-status').textContent, 'practice.review.saved');
  assert.equal(f.el('weak-lines').children.length, 1);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'recap'); assert.equal(f.sent[0].recap.personalBest, true);
  f.controller.reconnect(); assert.deepEqual(f.sent[1], f.sent[0]);
});

test('demo, unscorable, and insufficient observed/voiced takes never create history or recaps', async () => {
  for (const [changes, status] of [[{ source: 'demo' }, 'demo'], [{ score: null }, 'insufficient'],
    [{ observedSeconds: 1.99 }, 'insufficient'], [{ voicedSeconds: 0.49 }, 'insufficient']]) {
    const f = fixture(); await f.controller.finish(take(changes)); await flush();
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.sent, []);
    assert.equal(f.el('review-status').textContent, `practice.review.${status}`);
  }
});

test('late save response after a track change cannot show or broadcast the old result', async () => {
  const post = deferred(); const f = fixture((url, opts) => url === '/takes' && opts ? post.promise : undefined);
  const pendingSave = f.controller.finish(take()); await flush();
  f.controller.reset('track-b'); f.setSnapshot({ track: { id: 'track-b', title: 'Song B' } });
  post.resolve(saved({ ...take(), trackId: 'track-a' })); await pendingSave;
  assert.deepEqual(f.sent, []);
  assert.equal(f.el('review-status').textContent, 'practice.review.empty');
  assert.equal(f.requests.filter(([url]) => url.startsWith('/takes?')).length, 0);
});

test('starting a loop invalidates an earlier save recap while retaining its authorized save', async () => {
  const post = deferred(); const f = fixture((url, opts) => url === '/takes' && opts ? post.promise : undefined);
  const pendingSave = f.controller.finish(take({ weakLines: [weakLine] })); await flush();
  await clickWeak(f);
  assert.deepEqual(f.engine.getRange(), { start: 1.4, end: 4.3 });
  post.resolve(saved({ ...take(), trackId: 'track-a' })); await pendingSave;
  assert.deepEqual(f.sent, []);
  assert.equal(f.el('review-status').textContent, 'practice.review.saved', 'completed loop save cannot remain stuck on saving');
  assert.equal(f.requests.filter(([url, opts]) => url === '/takes' && opts.method === 'POST').length, 1);
  assert.ok(f.requests.some(([url]) => url === '/takes?trackId=track-a'), 'same-song stale success refreshes stored history');
  assert.ok(f.requests.some(([url]) => url === '/challenges?trackId=track-a'), 'pending challenges are scoped to the current song');
  f.controller.reconnect(); assert.deepEqual(f.sent, []);
});

test('a loop blocks pitch until a matching generation and source-position acknowledgement, exactly once', async () => {
  const f = fixture(); await f.controller.finish(take({ source: 'demo', weakLines: [weakLine] })); await clickWeak(f);
  assert.deepEqual(f.seeks, [[1.4, { resume: true }]]);
  assert.equal(f.controller.acceptsPitch({ t: 2 }), false);
  assert.equal(f.controller.playback({ valid: true, playing: true, generation: 7, sourceTime: 1.4 }), true);
  assert.equal(f.controller.playback({ valid: true, playing: true, generation: 8, sourceTime: 5 }), true);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 0);
  assert.equal(f.controller.playback({ valid: true, playing: true, generation: 8, sourceTime: 1.4 }), true);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1);
  assert.equal(f.controller.acceptsPitch({ t: 2 }), true);
  assert.equal(f.controller.acceptsPitch({ t: 0 }), false);
  assert.equal(f.controller.playback({ valid: true, playing: true, generation: 8, sourceTime: 1.4 }), false);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1);
  f.setSnapshot({ sourceTime: 4.31, generation: 8 });
  assert.equal(f.controller.playback({ valid: true, playing: true, generation: 8, sourceTime: 4.31 }), true);
  assert.deepEqual(f.calls.filter(c => c[0] === 'finish').at(-1), ['finish', 'mic']);
  assert.equal(f.seeks.length, 2);
});

test('cancelled loop acknowledgements do not restart recording and source-off boundaries pass through', async () => {
  const f = fixture(); await f.controller.finish(take({ source: 'demo', weakLines: [weakLine] })); await clickWeak(f);
  f.controller.cancel();
  assert.equal(f.controller.playback({ valid: true, playing: true, generation: 8, sourceTime: 1.4 }), false);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 0);
  assert.equal(f.engine.getRange(), null);
  assert.equal(f.controller.boundary({ wasPlaying: true }), false);
  await f.controller.finish(take({ source: 'demo', weakLines: [weakLine] })); await clickWeak(f);
  f.setSource('off');
  assert.equal(f.controller.boundary({ wasPlaying: true }), false);
});

test('EOF looping intercepts the boundary and resumes the seek even after the snapshot stopped playing', async () => {
  const f = fixture(); await f.controller.finish(take({ source: 'demo', weakLines: [weakLine] })); await clickWeak(f);
  f.controller.playback({ valid: true, playing: true, generation: 8, sourceTime: 1.4 });
  f.setSnapshot({ sourceTime: 10, generation: 8, playing: false });
  assert.equal(f.controller.boundary({ boundary: 'ended', wasPlaying: true }), true);
  assert.deepEqual(f.seeks.at(-1), [1.4, { resume: true }]);
  assert.equal(f.controller.acceptsPitch({ t: 2 }), false);
});

test('a condition change invalidates a save response before it can show a stale recap', async () => {
  const post = deferred(); const f = fixture((url, opts) => url === '/takes' && opts ? post.promise : undefined);
  const pendingSave = f.controller.finish(take()); await flush();
  f.setSnapshot({ pitchShift: 2, playbackRate: 0.8 }); f.controller.contextChanged();
  post.resolve(saved({ ...take(), trackId: 'track-a' })); await pendingSave;
  assert.deepEqual(f.sent, []);
  f.controller.reconnect(); assert.deepEqual(f.sent, []);
});

test('ghost fetch respects comparison conditions and a late fetch cannot survive a key change', async () => {
  const ghost = deferred();
  const previous = { ...take(), trackId: 'track-a', id: 'previous', createdAt: '2026-10-30T00:00:00Z' };
  const f = fixture(url => url.startsWith('/takes?') ? { takes: [previous] } : url === '/takes/previous' ? ghost.promise : undefined);
  f.el('ghost').checked = true;
  await f.controller.refresh(); await flush();
  assert.equal(f.el('ghost').disabled, false);
  assert.equal(f.requests.filter(([url]) => url === '/takes/previous').length, 1);
  f.setSnapshot({ pitchShift: 3 }); f.controller.contextChanged();
  assert.equal(f.el('ghost').disabled, true);
  ghost.resolve({ take: { ...previous, pitchTrace: [{ t: 1, midi: 60 }] } }); await flush();
  assert.ok(f.calls.filter(c => c[0] === 'ghost').every(c => c[1] === null));
});

test('the new loop rejects delayed packets from the previous generation after the seek acknowledgement', async () => {
  const f = fixture(); await f.controller.finish(take({ source: 'demo', weakLines: [weakLine] })); await clickWeak(f);
  f.setSnapshot({ generation: 8, sourceTime: 1.4 });
  f.controller.playback({ valid: true, playing: true, generation: 8, sourceTime: 1.4 });
  assert.equal(f.controller.acceptsPitch({ t: 4.1, generation: 7 }), false);
  assert.equal(f.controller.acceptsPitch({ t: 1.5, generation: 8 }), true);
});

test('retry preserves the original clientTakeId and a successful retry sends exactly one recap', async () => {
  let attempts = 0;
  const f = fixture((url, opts) => {
    if (url !== '/takes' || !opts || opts.method !== 'POST') return undefined;
    attempts++;
    if (attempts === 1) return Promise.reject(new Error('Connection lost after server commit'));
    return saved(JSON.parse(opts.body));
  });
  await f.controller.finish(take());
  assert.equal(f.el('review-status').textContent, 'practice.review.saveFailed');
  assert.deepEqual(f.sent, []);
  const retry = f.el('review-status').children[0];
  assert.equal(retry.textContent, 'practice.review.retry');
  await retry.fire('click');
  const payloads = f.requests.filter(([url, opts]) => url === '/takes' && opts.method === 'POST').map(([, opts]) => JSON.parse(opts.body));
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0], payloads[1], 'retry reuses the identical payload and idempotency identity');
  assert.equal(new Set(payloads.map(payload => payload.clientTakeId)).size, 1);
  assert.equal(f.sent.filter(message => message.type === 'recap').length, 1);
  assert.equal(f.sent[0].recap.takeId, 'saved-1');
  assert.equal(f.el('review-status').textContent, 'practice.review.saved');
  assert.equal(f.el('review-status').children.length, 0, 'success removes the retry action');
});

test('balanced sharp and flat errors are described as variable pitch rather than stable pitch', () => {
  const variable = Feedback.diagnosis({ signedCents: -4, absoluteCents: 110, onsetMs: null }, translate);
  assert.match(variable, /pitchVariable/);
  assert.doesNotMatch(variable, /pitchStable/);
  assert.match(Feedback.diagnosis({ signedCents: 4, absoluteCents: 12, onsetMs: 0 }, translate), /pitchStable/);
  assert.match(Feedback.diagnosis({ signedCents: 120, absoluteCents: 120, onsetMs: null }, translate), /sharp/);
});

test('comparison context follows the server three-decimal normalization without merging distinct conditions', () => {
  const a = { ...take(), trackId: 'track-a' };
  const roundedMatch = { ...a, key: 0.00049, tempo: 1.00049, scope: { type: 'full', start: 0.00049, end: 10.00049 } };
  assert.equal(Feedback.sameContext(a, roundedMatch), true);
  assert.equal(Feedback.sameContext(roundedMatch, a), true);
  for (const changes of [{ key: 0.00051 }, { tempo: 1.00051 }, { scope: { type: 'full', start: 0.00051, end: 10 } },
    { scope: { type: 'full', start: 0, end: 10.00051 } }]) {
    assert.equal(Feedback.sameContext(a, { ...a, ...changes }), false, JSON.stringify(changes));
  }
  const range = { ...a, scope: { type: 'range', start: 1.234, end: 4.567 } };
  assert.equal(Feedback.sameContext(range, { ...range, scope: { type: 'range', start: 1.2344, end: 4.5674 } }), true);
});
