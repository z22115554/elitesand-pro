'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPracticeHistoryService, LIMITS } = require('../server/services/practice-history');
function take(overrides = {}) {
  return { clientTakeId: 'take-1', trackId: 'song', guideId: 'guide-1', scoreVersion: 'source-time-v2', title: 'Song',
    source: 'mic', completed: true, valid: true, key: 0, tempo: 1, allowOctave: true, mixedContext: false,
    scope: { type: 'full', start: 0, end: 10 }, duration: 10, score: 70, requiredSeconds: 8, observedSeconds: 7, voicedSeconds: 6,
    lineFeedback: [{ line: 0, start: 0, end: 10, text: 'line', score: 70, requiredSeconds: 8, observedSeconds: 7, voicedSeconds: 6,
      signedCents: -10, absoluteCents: 10, onsetMs: null }], pitchTrace: [{ t: 1, midi: 60 }, { t: 2, gap: true }], ...overrides };
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-history-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'takes.json'); return { file, service: createPracticeHistoryService({ file }) };
}
test('valid mic takes are sanitized, deduplicated, privately summarized and compared only under exact conditions', t => {
  const { service } = fixture(t);
  const first = service.save(take({ audio: 'NEVER_STORE', token: 'secret' }));
  assert.equal(first.comparison.isPersonalBest, true); assert.equal(first.take.audio, undefined);
  assert.equal(service.save(take()).duplicate, true); assert.equal(service.list().takes.length, 1);
  assert.equal(service.list().takes[0].pitchTrace, undefined); assert.equal(service.list().takes[0].lineFeedback, undefined);
  const improved = service.save(take({ clientTakeId: 'take-2', score: 80, lineFeedback: [{ ...take().lineFeedback[0], score: 85 }] }));
  assert.equal(improved.comparison.delta, 10); assert.equal(improved.comparison.best.id, first.take.id);
  assert.equal(improved.comparison.improvedLines[0].delta, 15);
  for (const change of [{ key: 1 }, { tempo: 1.1 }, { allowOctave: false }, { guideId: 'new-guide' }, { trackId: 'other-song' },
    { scoreVersion: 'new-version' }, { scope: { type: 'range', start: 1, end: 8 } }, { mixedContext: true }, { scope: { type: 'partial', start: 0, end: 8 } }]) {
    const result = service.save(take({ clientTakeId: `take-${service.list().takes.length + 1}`, ...change }));
    assert.equal(result.comparison.previous, null); assert.equal(result.comparison.delta, null);
  }
  assert.throws(() => service.save(take({ trackId: 'conflict' })), error => error.code === 'TAKE_ID_CONFLICT');
  const renamed = service.save(take({ clientTakeId: 'renamed', lineFeedback: [{ ...take().lineFeedback[0], text: 'new line', score: 99 }] }));
  assert.deepEqual(renamed.comparison.improvedLines, []);
});
test('invalid, silent, incomplete and unbounded client input cannot be saved', t => {
  const { service } = fixture(t);
  for (const change of [{ source: 'demo' }, { completed: false }, { valid: false }, { observedSeconds: 1 }, { voicedSeconds: 0 },
    { score: Infinity }, { requiredSeconds: 3 }, { duration: 5000 }, { pitchTrace: Array.from({ length: LIMITS.trace + 1 }, () => ({ t: 1, midi: 60 })) },
    { pitchTrace: [{ t: 5, midi: 60 }, { t: 2, midi: 60 }] }, { pitchTrace: [{ t: 1, midi: 999 }] }, { scope: { type: 'full', start: 1, end: 10 } }]) {
    assert.throws(() => service.save(take(change)));
  }
  assert.equal(service.list().takes.length, 0);
});
test('local challenges require exact challenge and song, full takes, sufficient coverage, and settle once', t => {
  const { service } = fixture(t);
  const { challenge } = service.createChallenge({ trackId: 'song', title: 'Challenge', requester: 'viewer', targetScore: 75 });
  const save = change => service.save(take({ clientTakeId: crypto.randomUUID(), challengeId: challenge.id, ...change }));
  assert.equal(save({ scope: { type: 'partial', start: 0, end: 8 } }).challengeResult.eligible, false);
  assert.equal(save({ scope: { type: 'range', start: 0, end: 8 } }).challengeResult.eligible, false);
  assert.equal(save({ mixedContext: true }).challengeResult.eligible, false);
  assert.equal(save({ observedSeconds: 3, voicedSeconds: 2 }).challengeResult.eligible, false);
  assert.equal(save({ trackId: 'other' }).challengeResult, null);
  const result = save({ clientTakeId: 'winner', score: 90 });
  assert.equal(result.challengeResult.achieved, true); assert.equal(result.challengeResult.rank, 1);
  assert.equal(service.save(take({ clientTakeId: 'winner', score: 0, challengeId: challenge.id })).duplicate, true);
  assert.equal(service.getChallenge().challenge.entries.length, 1);
  assert.equal(save({ key: 2, score: 80 }).challengeResult.rank, 1, 'keys have separate ranks');
  assert.equal(save({ score: 80 }).challengeResult.rank, 2);
  const replacement = service.createChallenge({ trackId: 'other', targetScore: 80 });
  assert.equal(save({ score: 100 }).challengeResult.challengeId, challenge.id, 'another song does not remove this challenge');
  service.clearChallenge(challenge.id); service.clearChallenge(replacement.challenge.id);
  assert.equal(service.getChallenge().challenge, null);
});
const crypto = require('node:crypto');
test('retention stays bounded, deletes do not resurrect from last-good, and future schemas refuse writes/deletes', t => {
  const { file, service } = fixture(t);
  let first;
  for (let i = 0; i < LIMITS.takes + 1; i++) { const result = service.save(take({ clientTakeId: `take-${i}` })); first ||= result.take; }
  assert.equal(service.list().takes.length, LIMITS.takes);
  assert.equal(service.save(take({ clientTakeId: 'take-0' })).duplicate, true, 'eviction retains receipt');
  const last = service.list().takes[0]; service.remove(last.id);
  assert.equal(service.save(take({ clientTakeId: last.clientTakeId })).take, null, 'deleted take is not recreated by retry');
  const backup = JSON.parse(fs.readFileSync(`${file}.last-good`, 'utf8'));
  assert.equal(backup.takes.some(item => item.id === last.id), false);
  fs.writeFileSync(file, '{broken');
  assert.equal(createPracticeHistoryService({ file }).list().takes.some(item => item.id === last.id), false);
  const future = JSON.stringify({ schemaVersion: 999, secret: 'preserved' }); fs.writeFileSync(file, future);
  const blocked = createPracticeHistoryService({ file }); assert.equal(blocked.getStatus().writeBlocked, true);
  assert.throws(() => blocked.save(take()), error => error.code === 'PRACTICE_HISTORY_READ_ONLY');
  assert.throws(() => blocked.createChallenge({ trackId: 'song', targetScore: 70 }), error => error.code === 'PRACTICE_HISTORY_READ_ONLY');
  assert.equal(fs.readFileSync(file, 'utf8'), future);
});
test('local leaderboard is capped at one hundred entries', t => {
  const { service } = fixture(t);
  const { challenge } = service.createChallenge({ trackId: 'song', targetScore: 50 });
  for (let i = 0; i < LIMITS.leaderboard; i++) service.save(take({ clientTakeId: `rank-${i}`, challengeId: challenge.id }));
  const overflow = service.save(take({ clientTakeId: 'overflow', challengeId: challenge.id }));
  assert.equal(overflow.challengeResult.reason, 'LEADERBOARD_FULL'); assert.equal(service.getChallenge().challenge.entries.length, 100);
});
test('viewer challenges default off, persist host opt-in, and deduplicate completed request IDs across active changes', t => {
  const { service, file } = fixture(t);
  const request = { trackId: 'song', title: 'Request', requester: 'viewer', requestId: 'request-1', targetScore: 80 };
  assert.deepEqual(service.getSettings(), { viewerRequestsEnabled: false });
  assert.throws(() => service.createViewerChallenge(request), error => error.code === 'VIEWER_CHALLENGES_DISABLED');
  assert.equal(service.getChallenge().challenge, null);
  assert.throws(() => service.updateSettings({ viewerRequestsEnabled: 'true' }));
  service.updateSettings({ viewerRequestsEnabled: true });
  const challenge = service.createViewerChallenge(request).challenge;
  assert.equal(service.createViewerChallenge(request).challenge.id, challenge.id);
  service.clearChallenge(challenge.id);
  assert.equal(service.createViewerChallenge(request).challenge, null);
  const reloaded = createPracticeHistoryService({ file });
  assert.deepEqual(reloaded.getSettings(), { viewerRequestsEnabled: true });
  assert.equal(reloaded.createViewerChallenge(request).duplicate, true);
  reloaded.updateSettings({ viewerRequestsEnabled: false });
  assert.throws(() => reloaded.createViewerChallenge({ ...request, requestId: 'request-2' }), error => error.code === 'VIEWER_CHALLENGES_DISABLED');
});
test('history enforces a byte budget as well as a count budget and strips trace-only extras', t => {
  const { service, file } = fixture(t);
  const lineFeedback = Array.from({ length: 250 }, (_, line) => ({ ...take().lineFeedback[0], line, text: 'x'.repeat(500) }));
  const pitchTrace = Array.from({ length: 12000 }, (_, i) => ({ t: i / 1200, midi: 60 + (i % 7) * 0.123456, audio: 'drop' }));
  for (let i = 0; i < 34; i++) service.save(take({ clientTakeId: `large-${i}`, lineFeedback, pitchTrace }));
  assert.ok(fs.statSync(file).size <= LIMITS.bytes);
  assert.ok(service.list().takes.length < 34, 'byte retention evicts before count retention');
  const last = service.get(service.list().takes[0].id).take;
  assert.equal(last.pitchTrace.length, 12000); assert.equal(last.pitchTrace[0].audio, undefined);
});
test('real HTTP accepts bounded 12000-point traces under production body limit and rejects oversized takes', async t => {
  const express = require('express');
  const { createPracticeFeedbackRouter } = require('../server/routes/practice-feedback');
  const { service } = fixture(t); const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/practice', createPracticeFeedbackRouter({ express, historyService: service, requirePin: (_req, _res, next) => next() }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.type }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/api/practice/takes`;
  const pitchTrace = Array.from({ length: 12000 }, (_, i) => ({ t: i / 1200, midi: 60 + (i % 7) * 0.123456 }));
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const normal = await post(take({ pitchTrace }));
  assert.equal(normal.status, 200); assert.equal(normal.headers.get('cache-control'), 'private, no-store');
  assert.equal((await normal.json()).take.pitchTrace.length, 12000);
  const huge = await post(take({ clientTakeId: 'too-big', pitchTrace,
    lineFeedback: Array.from({ length: 1000 }, (_, line) => ({ ...take().lineFeedback[0], line, text: 'x'.repeat(500) })) }));
  assert.equal(huge.status, 413); assert.equal((await huge.json()).code, 'TAKE_TOO_LARGE');
  assert.equal((await post(take({ audio: 'x'.repeat(2 * 1024 * 1024) }))).status, 413);
  assert.equal(service.list().takes.length, 1);
  const a = service.createChallenge({ trackId: 'song', targetScore: 80 }).challenge;
  service.createChallenge({ trackId: 'song-b', targetScore: 90 });
  const byTrack = await fetch(url.replace('/takes', '/challenges?trackId=song'));
  assert.equal((await byTrack.json()).challenge.id, a.id, 'HTTP forwards the track filter');
});
test('song A can settle after a viewer imports song B; rounds survive restart, dedup, clearing and deletion', t => {
  const { file, service } = fixture(t); service.updateSettings({ viewerRequestsEnabled: true });
  const a = service.createViewerChallenge({ trackId: 'song', targetScore: 80, requester: 'A viewer', requestId: 'request-a' }).challenge;
  const b = service.createViewerChallenge({ trackId: 'song-b', targetScore: 95, requester: 'B viewer', requestId: 'request-b' }).challenge;
  assert.equal(service.getChallenge().challenge.id, b.id);
  assert.equal(service.getChallenge('song').challenge.id, a.id);
  const replay = service.createViewerChallenge({ trackId: 'wrong-song', targetScore: 1, requestId: 'request-a' });
  assert.equal(replay.duplicate, true); assert.equal(replay.challenge.id, a.id);
  assert.equal(service.getChallenge().challenge.id, b.id, 'replay does not make old round current');
  const reloaded = createPracticeHistoryService({ file });
  const saved = reloaded.save(take({ challengeId: a.id, score: 90 }));
  assert.equal(saved.challengeResult.challengeId, a.id); assert.equal(saved.challengeResult.achieved, true);
  assert.equal(reloaded.getChallenge('song').challenge.entries.length, 1);
  assert.equal(reloaded.getChallenge('song-b').challenge.entries.length, 0);
  assert.equal(reloaded.save(take({ clientTakeId: 'wrong-binding', challengeId: a.id, trackId: 'song-b' })).challengeResult, null);
  reloaded.remove(saved.take.id);
  assert.equal(reloaded.getChallenge('song').challenge.entries.length, 0);
  reloaded.clearChallenge(a.id);
  assert.equal(reloaded.getChallenge('song').challenge, null); assert.equal(reloaded.getChallenge('song-b').challenge.id, b.id);
  assert.equal(reloaded.createViewerChallenge({ trackId: 'song', targetScore: 80, requestId: 'request-a' }).challenge, null);
  reloaded.clearChallenge(b.id); assert.equal(reloaded.getChallenge().challenge, null);
  const afterDelete = createPracticeHistoryService({ file }); assert.equal(afterDelete.getChallenge('song').challenge, null);
});
test('round retention is bounded and legacy single-challenge v1 documents load without losing the round', t => {
  const { file, service } = fixture(t);
  const legacy = service.createChallenge({ trackId: 'legacy-song', targetScore: 70 }).challenge;
  const document = JSON.parse(fs.readFileSync(file)); delete document.challenges;
  fs.writeFileSync(file, JSON.stringify(document));
  const reloaded = createPracticeHistoryService({ file });
  assert.equal(reloaded.getChallenge('legacy-song').challenge.id, legacy.id);
  for (let i = 0; i < LIMITS.challenges; i++) reloaded.createChallenge({ trackId: `song-${i}`, targetScore: 70 });
  assert.equal(reloaded.getChallenge('legacy-song').challenge, null);
  const stored = JSON.parse(fs.readFileSync(file));
  assert.equal(stored.challenges.length, LIMITS.challenges);
  assert.equal(stored.challenge.id, stored.challenges.at(-1).id);
  assert.ok(fs.statSync(file).size <= LIMITS.bytes);
});
test('retry receipts retain real previous/best score and remove references when that take is deleted', t => {
  const { file, service } = fixture(t);
  const best = service.save(take({ score: 90 }));
  const lower = take({ clientTakeId: 'lower', score: 75 }); service.save(lower);
  const retried = createPracticeHistoryService({ file }).save(lower);
  assert.equal(retried.duplicate, true); assert.deepEqual(retried.comparison.best, { id: best.take.id, score: 90 });
  assert.deepEqual(retried.comparison.previous, { id: best.take.id, score: 90 });
  assert.equal(retried.comparison.isPersonalBest, false); assert.equal(retried.comparison.delta, -15);
  service.remove(best.take.id);
  const afterDelete = createPracticeHistoryService({ file }).save(lower);
  assert.equal(afterDelete.comparison.best, null); assert.equal(afterDelete.comparison.previous, null);
});
