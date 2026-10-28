'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPracticeOverlay, sanitizeStyle, sanitizeFrame, STYLE_DEFAULT, ROOM, EVENT } = require('../server/services/practice-overlay');

function fakeIo() {
  const sent = [];
  return { sent, to(room) { return { emit: (event, payload) => sent.push({ room, event, payload }) }; } };
}
function fakeSocket(id, clientType = 'controller') {
  const emitted = []; const joined = []; const relayed = [];
  return { id, clientType, emitted, joined, relayed,
    emit: (event, payload) => emitted.push({ event, payload }), join: (room) => joined.push(room),
    to: (room) => ({ emit: (event, payload) => relayed.push({ room, event, payload }) }) };
}
function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-overlay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'practice-overlay.json');
}
const song = { key: 'k', title: '情歌', duration: 260, lines: [{ start: 1, end: 3, text: 'la', words: [{ text: 'la', start: 1, end: 3 }] }],
  notes: [{ start: 1, end: 2, midi: 69, line: 0, word: 0 }], contour: [[0, 69]] };
const frame = (t, playing = true) => ({ type: 'frame', clock: { playing, t }, trail: [{ t, raw: 69, ribbon: 69, bar: 69, ok: true, near: true, v: 0.5 }],
  notes: [[0, [[1, 1.2]], 0.2, 0.2, 0.2]], user: { t, midi: 69 }, score: { target: 90, unscorable: false }, events: [{ k: 'rating', tag: 'PERFECT', combo: 2 }] });

test('only the desktop controller may drive the overlay; read-only and remote clients are ignored', (t) => {
  const overlay = createPracticeOverlay({ file: tmpFile(t) }); const io = fakeIo();
  for (const type of ['practice-overlay', 'display', 'remote', 'prompter']) {
    assert.equal(overlay.handle(io, fakeSocket('x', type), { type: 'song', song }), null, type);
  }
  assert.equal(io.sent.length, 0);
  assert.ok(overlay.handle(io, fakeSocket('a'), { type: 'song', song }));
  assert.deepEqual(io.sent.map((m) => [m.room, m.event, m.payload.type]), [[ROOM, EVENT, 'song']]);
});

test('song payload sent to OBS is bounded and drops the private pitch contour', (t) => {
  const overlay = createPracticeOverlay({ file: tmpFile(t) }); const io = fakeIo();
  overlay.handle(io, fakeSocket('a'), { type: 'song', song: { ...song, notes: [...song.notes, { start: 'x' }, { start: 5, end: 4, midi: 60 }] } });
  const sent = io.sent[0].payload.song;
  assert.equal(sent.contour, undefined, 'contour is panel-only data');
  assert.equal(sent.notes.length, 1); assert.equal(sent.lines[0].words[0].text, 'la');
  assert.equal(overlay.handle(io, fakeSocket('a'), { type: 'song', song: { duration: 0 } }), null);
});

test('an idle second panel cannot pull the overlay back; a playing or seeking one takes over', async (t) => {
  const overlay = createPracticeOverlay({ file: tmpFile(t) }); const io = fakeIo();
  const a = fakeSocket('a'); const b = fakeSocket('b');
  overlay.handle(io, a, { type: 'song', song });
  assert.ok(overlay.handle(io, a, frame(10)));
  // b 閒置（沒在播）：被擋
  assert.equal(overlay.handle(io, b, frame(0, false)), null);
  assert.equal(overlay.getSnapshot().activeSocketId, 'a');
  // b 開始播：接手（等過每個面板 20ms 一包的頻率限制）
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(overlay.handle(io, b, frame(3)));
  assert.equal(overlay.getSnapshot().activeSocketId, 'b');
  // a 跳轉：搶回來
  overlay.handle(io, a, { type: 'seek', offset: 40 });
  assert.equal(overlay.getSnapshot().activeSocketId, 'a');
});

test('frames are rate limited per panel without losing data, and every field is clamped', async (t) => {
  const overlay = createPracticeOverlay({ file: tmpFile(t) }); const io = fakeIo(); const a = fakeSocket('a');
  overlay.handle(io, a, { type: 'song', song });
  assert.ok(overlay.handle(io, a, frame(1)));
  assert.equal(overlay.handle(io, a, frame(1.01)), null, 'second frame within 20ms is held back');
  // 唱完的最後一格常常緊接在前一格後面：要併進下一包送出，不能丟
  const last = { ...frame(1.02, false), score: { target: 88, unscorable: false, result: { score: 88, lines: 3, tiers: { PERFECT: 3 }, at: 1 } } };
  assert.equal(overlay.handle(io, a, last), null);
  const before = io.sent.filter((m) => m.payload.type === 'frame').length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  const frames = io.sent.filter((m) => m.payload.type === 'frame');
  assert.equal(frames.length, before + 1, 'held frames go out together once');
  const merged = frames[frames.length - 1].payload;
  assert.deepEqual(merged.trail.map((p) => p.t), [1.01, 1.02], 'trail points from both frames are kept in order');
  assert.equal(merged.events.length, 2, 'rating events from both frames are kept');
  assert.equal(merged.clock.playing, false, 'latest clock wins');
  assert.equal(merged.score.result.score, 88, 'the final result survives');
  assert.equal(overlay.getSnapshot().score.result.score, 88, 'and is kept for an OBS refresh');
  const evil = sanitizeFrame({ clock: { playing: true, t: 1e9 }, trail: Array.from({ length: 500 }, (_, i) => ({ t: i, raw: 1e6, ok: 'yes' })),
    notes: Array.from({ length: 999 }, () => [1e9, [[0, 1]], 1e9, 1, 1]), events: [{ k: 'rating', tag: '<script>' }, { k: 'tag', g: { tag: 'VIBRATO', t: 1, midi: 69 } }],
    score: { target: 1e9 } });
  assert.equal(evil.clock.t, 1200); assert.equal(evil.trail.length, 120); assert.equal(evil.trail[0].raw, 140); assert.equal(evil.trail[0].ok, true);
  assert.equal(evil.notes.length, 64); assert.equal(evil.score.target, 100);
  assert.deepEqual(evil.events.map((e) => e.k), ['tag'], 'unknown rating tags are dropped');
});

test('style is sanitized, persisted on the server, fanned out to other panels and survives a restart', async (t) => {
  const file = tmpFile(t);
  const overlay = createPracticeOverlay({ file }); const io = fakeIo(); const a = fakeSocket('a');
  overlay.handle(io, a, { type: 'style', style: { fx: 'grand', fill: '#5ec8ff', laneH: 999, bgOpacity: -5, pos: 'left', evil: 'x' } });
  const style = overlay.getStyle();
  assert.equal(style.fx, 'grand'); assert.equal(style.fill, '#5EC8FF'); assert.equal(style.laneH, 60); assert.equal(style.bgOpacity, 0);
  assert.equal(style.pos, 'bottom'); assert.equal(style.evil, undefined);
  assert.deepEqual(a.relayed.map((m) => m.event), ['practice:style'], 'other panels are told, the sender is not echoed');
  overlay.flush();
  const reloaded = createPracticeOverlay({ file });
  assert.equal(reloaded.getStyle().fx, 'grand');
  assert.deepEqual(sanitizeStyle({}), { ...STYLE_DEFAULT });
});

test('a newly connected OBS source gets style, song and clock; panel disconnect freezes the clock', (t) => {
  const overlay = createPracticeOverlay({ file: tmpFile(t) }); const io = fakeIo(); const a = fakeSocket('a');
  overlay.handle(io, a, { type: 'song', song }); overlay.handle(io, a, frame(10));
  const obs = fakeSocket('obs', 'practice-overlay');
  overlay.greet(obs);
  assert.deepEqual(obs.joined, [ROOM]);
  assert.deepEqual(obs.emitted.map((m) => m.payload.type), ['style', 'song', 'frame']);
  assert.equal(obs.emitted[2].payload.clock.playing, true);
  io.sent.length = 0;
  overlay.disconnect(io, 'a');
  assert.equal(io.sent.length, 1);
  assert.equal(io.sent[0].payload.clock.playing, false, 'OBS stops instead of extrapolating forever');
  assert.ok(io.sent[0].payload.clock.t >= 10);
  assert.equal(overlay.getSnapshot().activeSocketId, null);
});

test('socket handler wires the overlay: PIN-exempt read-only type, controller-only events, disconnect hook', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'socket-handler.js'), 'utf8');
  assert.match(source, /PIN_EXEMPT_CLIENT_TYPES = new Set\(\[[^\]]*'practice-overlay'/, 'rule 14: overlay must not need a PIN');
  assert.match(source, /if \(socket\.clientType === 'controller'\) \{\s*socket\.on\('practice:overlay'/);
  assert.match(source, /practiceOverlay\.disconnect\(io, socket\.id\)/);
  assert.match(source, /type === 'practice-overlay'\) \{[\s\S]{0,200}practiceOverlay\.greet\(socket\)/);
  // 疊加層是唯讀客戶端：它送出的 practice:* 事件會被 READ_ONLY_EVENTS 擋下
  const readOnly = source.match(/const READ_ONLY_EVENTS = new Set\(\[([\s\S]*?)\]\);/)[1];
  assert.doesNotMatch(readOnly, /practice:/);
});
