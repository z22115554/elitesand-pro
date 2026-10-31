'use strict';

// Controller-only local measurements. They are client supplied and do not prove
// identity, prevent cheating, or establish a public/cloud leaderboard.
const path = require('path');
const crypto = require('crypto');
const { createJsonStore } = require('./json-store');
const LIMITS = Object.freeze({ takes: 200, trace: 12000, lines: 1000, bytes: 12 * 1024 * 1024,
  takeBytes: 768 * 1024, duration: 1200, leaderboard: 100, receipts: 1000, challenges: 50 });
class PracticeHistoryError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function fail(code, message, status) { throw new PracticeHistoryError(code, message, status); }
function text(value, max = 200) { return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : ''; }
function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('INVALID_TAKE', `無效的 ${label}`);
  return Math.round(value * 1000) / 1000;
}
function identifier(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\\/\x00-\x1f]/.test(value) || value === '.' || value === '..') fail('INVALID_TAKE', `無效的 ${label}`);
  return value;
}
function contextFingerprint(take) {
  return crypto.createHash('sha256').update(JSON.stringify([take.trackId, take.guideId, take.scoreVersion,
    take.key, take.tempo, take.allowOctave, take.scope.type, take.scope.start, take.scope.end])).digest('hex');
}
function sanitizeTake(raw) {
  if (!raw || raw.source !== 'mic' || raw.completed !== true || raw.valid !== true) fail('TAKE_NOT_ELIGIBLE', '只可保存已完成且有效的麥克風演唱。');
  const duration = number(raw.duration, 2, LIMITS.duration, 'duration');
  const observedSeconds = number(raw.observedSeconds ?? raw.scoredSeconds, 2, duration + 0.1, 'observedSeconds');
  const requiredSeconds = number(raw.requiredSeconds, observedSeconds - 0.001, duration + 0.1, 'requiredSeconds');
  const voicedSeconds = number(raw.voicedSeconds, 0.5, observedSeconds + 0.1, 'voicedSeconds');
  const scope = raw.scope;
  if (!scope || !['full', 'range', 'partial'].includes(scope.type)) fail('INVALID_TAKE', '無效的練唱範圍');
  const start = number(scope.start, 0, duration, 'scope.start');
  const end = number(scope.end, start + 0.001, duration + 0.1, 'scope.end');
  if (scope.type === 'full' && (start > 0.01 || Math.abs(end - duration) > 0.1)) fail('INVALID_TAKE', '全曲成績必須涵蓋完整歌曲。');
  if (typeof raw.allowOctave !== 'boolean' || typeof raw.mixedContext !== 'boolean') fail('INVALID_TAKE', '缺少練唱條件');
  const take = { clientTakeId: identifier(raw.clientTakeId, 'clientTakeId'), trackId: identifier(raw.trackId, 'trackId'),
    guideId: identifier(raw.guideId, 'guideId'), scoreVersion: identifier(raw.scoreVersion, 'scoreVersion'),
    title: text(raw.title), source: 'mic', completed: true, valid: true,
    key: number(raw.key, -24, 24, 'key'), tempo: number(raw.tempo, 0.25, 4, 'tempo'), allowOctave: raw.allowOctave,
    mixedContext: raw.mixedContext, scope: { type: scope.type, start, end }, duration,
    score: number(raw.score, 0, 100, 'score'), requiredSeconds, observedSeconds, voicedSeconds,
    seconds: number(raw.seconds ?? observedSeconds, 0, duration + 0.1, 'seconds'),
    lineFeedback: [], pitchTrace: [], challengeId: raw.challengeId ? identifier(raw.challengeId, 'challengeId') : null };
  if (!Array.isArray(raw.lineFeedback) || raw.lineFeedback.length > LIMITS.lines || !Array.isArray(raw.pitchTrace) || raw.pitchTrace.length > LIMITS.trace) fail('INVALID_TAKE', '練唱資料超出上限。');
  const seenLines = new Set();
  take.lineFeedback = raw.lineFeedback.map(line => {
    if (!line || !Number.isInteger(line.line) || line.line < 0 || line.line > 2000 || seenLines.has(line.line)) fail('INVALID_TAKE', '無效的句子');
    seenLines.add(line.line);
    const lineStart = number(line.start, 0, duration + 0.1, 'line.start');
    const result = { line: line.line, start: lineStart, end: number(line.end, lineStart, duration + 0.1, 'line.end'), text: text(line.text, 500),
      score: line.score == null ? null : number(line.score, 0, 100, 'line.score'),
      requiredSeconds: number(line.requiredSeconds, 0, duration + 0.1, 'line.requiredSeconds'),
      observedSeconds: number(line.observedSeconds, 0, duration + 0.1, 'line.observedSeconds'),
      voicedSeconds: number(line.voicedSeconds, 0, duration + 0.1, 'line.voicedSeconds') };
    for (const name of ['signedCents', 'absoluteCents', 'onsetMs']) result[name] = line[name] == null ? null : number(line[name], name === 'absoluteCents' ? 0 : -120000, 120000, name);
    return result;
  });
  let previous = -1;
  take.pitchTrace = raw.pitchTrace.map(point => {
    if (!point) fail('INVALID_TAKE', '無效的音高軌跡');
    const t = number(point.t, start, end, 'trace.t');
    if (t < previous) fail('INVALID_TAKE', '音高軌跡必須依時間排序');
    previous = t;
    return point.gap === true ? { t, gap: true } : { t, midi: number(point.midi, 0, 140, 'trace.midi') };
  });
  take.comparable = !take.mixedContext && scope.type !== 'partial';
  take.contextFingerprint = contextFingerprint(take);
  if (Buffer.byteLength(JSON.stringify(take)) > LIMITS.takeBytes) fail('TAKE_TOO_LARGE', '練唱資料超出大小上限。', 413);
  return take;
}
function summary(take) {
  const { pitchTrace, lineFeedback, ...result } = take;
  return { ...result, lineCount: lineFeedback.length, tracePoints: pitchTrace.length };
}
function comparisonFor(take, takes) {
  const sameSong = takes.filter(item => item.trackId === take.trackId);
  const keys = new Map();
  for (const item of [...sameSong, take]) keys.set(item.key, (keys.get(item.key) || 0) + 1);
  const usualKey = [...keys.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? take.key;
  const matching = take.comparable ? sameSong.filter(item => item.comparable && item.contextFingerprint === take.contextFingerprint) : [];
  const previous = matching.at(-1) || null;
  const best = matching.reduce((a, b) => !a || b.score > a.score ? b : a, null);
  const improvedLines = previous ? take.lineFeedback.flatMap(line => {
    const before = previous.lineFeedback.find(old => old.line === line.line && old.text === line.text);
    return before && before.score != null && line.score != null && line.observedSeconds >= Math.max(0.3, line.requiredSeconds * 0.35) && before.observedSeconds >= Math.max(0.3, before.requiredSeconds * 0.35) && line.score > before.score
      ? [{ line: line.line, text: line.text, previous: before.score, score: line.score, delta: Math.round((line.score - before.score) * 1000) / 1000 }] : [];
  }).sort((a, b) => b.delta - a.delta).slice(0, 10) : [];
  return { comparable: take.comparable, previous: previous ? summary(previous) : null, best: best ? summary(best) : null,
    delta: previous ? Math.round((take.score - previous.score) * 1000) / 1000 : null,
    isPersonalBest: take.comparable && (!best || take.score > best.score), improvedLines, usualKey };
}
function createPracticeHistoryService(options = {}) {
  const file = options.file || path.join(require('../utils/app-paths').dataDir, 'practice-history.json');
  const now = options.now || (() => new Date().toISOString());
  const store = createJsonStore({ file, schemaVersion: 1, mode: 0o600, logger: options.logger,
    defaultValue: () => ({ schemaVersion: 1, takes: [], receipts: [], challenge: null, challenges: [], settings: { viewerRequestsEnabled: false }, challengeRequestIds: [] }),
    deserialize: doc => ({ ...doc, takes: doc.takes.map(take => ({ ...sanitizeTake(take), id: take.id, createdAt: take.createdAt })) }),
    validate: doc => {
      try {
        if (!Array.isArray(doc.takes) || doc.takes.length > LIMITS.takes || !Array.isArray(doc.receipts) || doc.receipts.length > LIMITS.receipts || Buffer.byteLength(JSON.stringify(doc)) > LIMITS.bytes) return false;
        for (const take of doc.takes) { sanitizeTake(take); if (typeof take.id !== 'string' || !/^[a-f0-9-]{36}$/.test(take.id) || typeof take.createdAt !== 'string' || !Number.isFinite(Date.parse(take.createdAt))) return false; }
        if (doc.settings && typeof doc.settings.viewerRequestsEnabled !== 'boolean') return false;
        if (doc.challengeRequestIds && (!Array.isArray(doc.challengeRequestIds) || doc.challengeRequestIds.length > LIMITS.receipts || doc.challengeRequestIds.some(id => typeof id !== 'string' || id.length > 128))) return false;
        const challenges = doc.challenges || (doc.challenge ? [doc.challenge] : []);
        if (!Array.isArray(challenges) || challenges.length > LIMITS.challenges) return false;
        for (const challenge of [...challenges, ...(doc.challenge ? [doc.challenge] : [])]) {
          if (!challenge || typeof challenge.id !== 'string' || !Array.isArray(challenge.entries) || challenge.entries.length > LIMITS.leaderboard) return false;
          identifier(challenge.trackId, 'trackId'); number(challenge.targetScore, 0, 100, 'targetScore');
        }
        return true;
      } catch (_) { return false; }
    } });
  let state = store.load();
  state.settings ||= { viewerRequestsEnabled: false };
  state.challengeRequestIds ||= [];
  // Existing schema-v1 files with a single active challenge are promoted on the
  // next atomic write. The legacy field remains an alias for the newest round.
  state.challenges ||= state.challenge ? [state.challenge] : [];
  state.challenge = state.challenges.at(-1) || null;
  function persist(next) {
    next = { ...next, takes: next.takes.slice(), receipts: next.receipts.slice(), challenges: next.challenges.slice(-LIMITS.challenges) };
    next.challenge = next.challenges.at(-1) || null;
    while (Buffer.byteLength(JSON.stringify(next)) > LIMITS.bytes) {
      if (next.takes.length > 1) next.takes.shift();
      else if (next.receipts.length > 1) next.receipts.shift();
      else if (next.challenges.length > 1) next.challenges.shift();
      else fail('TAKE_TOO_LARGE', '練唱資料超出大小上限。', 413);
    }
    if (!store.save(next)) fail('PRACTICE_HISTORY_READ_ONLY', '無法安全保存練唱紀錄；請檢查資料版本與磁碟。', 503);
    state = next;
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  function createChallenge(raw, viewer = false) {
    if (!raw) fail('INVALID_CHALLENGE', '缺少挑戰資料。');
    if (viewer && !state.settings.viewerRequestsEnabled) fail('VIEWER_CHALLENGES_DISABLED', '主持人尚未開啟觀眾點歌挑戰。', 409);
    const requestId = raw.requestId ? identifier(raw.requestId, 'requestId') : null;
    if (viewer && !requestId) fail('INVALID_CHALLENGE', '觀眾挑戰需要點歌識別碼。');
    if (requestId && (state.challengeRequestIds.includes(requestId) || state.challenges.some(item => item.requestId === requestId))) return { challenge: clone(state.challenges.find(item => item.requestId === requestId) || null), duplicate: true, localOnly: true };
    const challenge = { id: crypto.randomUUID(), trackId: identifier(raw.trackId, 'trackId'), title: text(raw.title, 120),
      requester: text(raw.requester, 80), targetScore: number(raw.targetScore, 0, 100, 'targetScore'), createdAt: now(), entries: [], localOnly: true, requestId };
    persist({ ...state, challenges: [...state.challenges, challenge], challengeRequestIds: requestId ? [...state.challengeRequestIds, requestId].slice(-LIMITS.receipts) : state.challengeRequestIds });
    return { challenge: clone(challenge), duplicate: false, localOnly: true };
  }
  function challengeResult(take, challenge) {
    if (!challenge || take.challengeId !== challenge.id || take.trackId !== challenge.trackId) return null;
    if (take.scope.type !== 'full' || !take.comparable || take.observedSeconds < take.requiredSeconds * 0.65) return { challengeId: challenge.id, eligible: false, reason: 'FULL_TAKE_REQUIRED' };
    const settled = challenge.entries.find(entry => entry.clientTakeId === take.clientTakeId);
    if (settled) {
      const same = challenge.entries.filter(item => item.contextFingerprint === settled.contextFingerprint).sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
      return { challengeId: challenge.id, eligible: true, achieved: settled.achieved, targetScore: challenge.targetScore, score: settled.score,
        rank: same.findIndex(item => item.takeId === settled.takeId) + 1, participants: same.length, localOnly: true };
    }
    if (challenge.entries.length >= LIMITS.leaderboard) return { challengeId: challenge.id, eligible: false, reason: 'LEADERBOARD_FULL' };
    const entry = { takeId: take.id, clientTakeId: take.clientTakeId, score: take.score, createdAt: take.createdAt, contextFingerprint: take.contextFingerprint,
      key: take.key, tempo: take.tempo, allowOctave: take.allowOctave, achieved: take.score >= challenge.targetScore };
    challenge.entries.push(entry);
    const same = challenge.entries.filter(item => item.contextFingerprint === take.contextFingerprint).sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
    const rank = same.findIndex(item => item.takeId === take.id) + 1;
    return { challengeId: challenge.id, eligible: true, achieved: entry.achieved, targetScore: challenge.targetScore, score: take.score, rank, participants: same.length, localOnly: true };
  }
  return {
    list(trackId) { if (trackId != null) identifier(trackId, 'trackId'); return { takes: state.takes.filter(t => !trackId || t.trackId === trackId).slice().reverse().map(summary) }; },
    get(id) { const take = state.takes.find(t => t.id === id); if (!take) fail('TAKE_NOT_FOUND', '找不到練唱紀錄。', 404); return { take: clone(take) }; },
    save(raw) {
      const take = sanitizeTake(raw);
      const receipt = state.receipts.find(item => item.clientTakeId === take.clientTakeId);
      if (receipt) {
        if (receipt.trackId !== take.trackId || receipt.contextFingerprint !== take.contextFingerprint) fail('TAKE_ID_CONFLICT', '此演唱識別碼已用於其他練唱。', 409);
        const existing = state.takes.find(item => item.id === receipt.id);
        return { take: existing ? clone(existing) : null, duplicate: true, comparison: clone(receipt.comparison), challengeResult: clone(receipt.challengeResult) };
      }
      take.id = crypto.randomUUID(); take.createdAt = now();
      const comparison = comparisonFor(take, state.takes);
      const next = clone(state);
      const settled = challengeResult(take, next.challenges.find(item => item.id === take.challengeId && item.trackId === take.trackId));
      next.takes.push(take);
      // Receipts preserve exactly-once semantics after a take was evicted/deleted.
      next.receipts.push({ id: take.id, clientTakeId: take.clientTakeId, trackId: take.trackId, contextFingerprint: take.contextFingerprint,
        comparison: { ...comparison, previous: comparison.previous ? { id: comparison.previous.id, score: comparison.previous.score } : null,
          best: comparison.best ? { id: comparison.best.id, score: comparison.best.score } : null }, challengeResult: settled });
      next.receipts = next.receipts.slice(-LIMITS.receipts);
      while (next.takes.length > LIMITS.takes) next.takes.shift();
      persist(next);
      return { take: clone(take), duplicate: false, comparison, challengeResult: settled };
    },
    remove(id) { if (!state.takes.some(t => t.id === id)) fail('TAKE_NOT_FOUND', '找不到練唱紀錄。', 404);
      const next = clone(state); next.takes = next.takes.filter(t => t.id !== id);
      next.receipts = next.receipts.map(receipt => {
        if (receipt.id === id) return { ...receipt, comparison: null, challengeResult: null };
        if (!receipt.comparison) return receipt;
        return { ...receipt, comparison: { ...receipt.comparison,
          previous: receipt.comparison.previous?.id === id ? null : receipt.comparison.previous,
          best: receipt.comparison.best?.id === id ? null : receipt.comparison.best } };
      });
      for (const challenge of next.challenges) challenge.entries = challenge.entries.filter(entry => entry.takeId !== id);
      persist(next); return { deleted: true }; },
    getChallenge(trackId) {
      if (trackId != null) identifier(trackId, 'trackId');
      const challenge = trackId ? state.challenges.slice().reverse().find(item => item.trackId === trackId) || null : state.challenge;
      return { challenge: clone(challenge), localOnly: true };
    },
    createChallenge: raw => createChallenge(raw),
    createViewerChallenge: raw => createChallenge(raw, true),
    getSettings() { return clone(state.settings); },
    updateSettings(raw) {
      if (!raw || typeof raw.viewerRequestsEnabled !== 'boolean') fail('INVALID_CHALLENGE_SETTINGS', 'viewerRequestsEnabled 必須是布林值。');
      const settings = { viewerRequestsEnabled: raw.viewerRequestsEnabled };
      persist({ ...state, settings }); return clone(settings);
    },
    clearChallenge(id) { if (!state.challenges.some(challenge => challenge.id === id)) fail('CHALLENGE_NOT_FOUND', '找不到挑戰。', 404);
      persist({ ...state, challenges: state.challenges.filter(challenge => challenge.id !== id) }); return { deleted: true }; },
    getStatus: () => store.getStatus(),
  };
}
let singleton;
function getPracticeHistoryService() { return singleton || (singleton = createPracticeHistoryService()); }
module.exports = { createPracticeHistoryService, getPracticeHistoryService, PracticeHistoryError, sanitizeTake, contextFingerprint, LIMITS };
