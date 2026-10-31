'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// The import/download adapter is outside this mock-only chat/approval test.
const audioProcessorPath = require.resolve('../server/services/audio-processor');
const cachedAudioProcessor = require.cache[audioProcessorPath];
require.cache[audioProcessorPath] = { id: audioProcessorPath, filename: audioProcessorPath, loaded: true, exports: {} };
const { TwitchService } = require('../server/services/twitch-service');
if (cachedAudioProcessor) require.cache[audioProcessorPath] = cachedAudioProcessor;
else delete require.cache[audioProcessorPath];
const RequestSettings = require('../public/js/twitch-request-settings');

const VIDEO = 'dQw4w9WgXcQ';
const OTHER = '9bZkp7q19f0';
const url = id => `https://youtu.be/${id}`;
let messageId = 0;
const services = [];
test.after(() => services.forEach(service => service.stop()));
function event(text, user = 'viewer', badges = []) {
  return { message_id: `challenge-msg-${++messageId}`, chatter_user_id: user,
    chatter_user_login: user, chatter_user_name: `Name ${user}`, badges, message: { text } };
}
function fixture({ enabled = true, rules = {}, requestRules = {}, pendingStore, practiceHistoryService } = {}) {
  let saved = [];
  const accepted = [], replies = [], challenges = [], metadata = [];
  const settings = { viewerRequestsEnabled: enabled };
  const practice = practiceHistoryService || {
    getSettings: () => settings,
    createViewerChallenge: raw => {
      if (!settings.viewerRequestsEnabled) throw Object.assign(new Error('closed'), { code: 'VIEWER_CHALLENGES_DISABLED' });
      challenges.push(raw);
      return { challenge: raw, localOnly: true };
    },
  };
  const options = {
    config: {}, practiceHistoryService: practice,
    onSongRequest: request => { accepted.push(request); return true; },
    pendingStore: pendingStore || { load: () => saved, save: value => { saved = structuredClone(value); } },
    sessionStore: { load: () => null, save: () => true },
    historyStore: { load: () => [], save: () => true },
    authStore: { load: () => null },
    timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} },
  };
  function make() {
    const service = new TwitchService(options);
    services.push(service);
    const defaults = RequestSettings.getDefaults();
    service.setRequestSettings({ ...defaults, ...rules,
      commands: { ...defaults.commands, request: { ...defaults.commands.request, ...requestRules } } });
    service.fetchYouTubeMetadata = async input => {
      metadata.push(input);
      return { title: 'Song', author: 'Artist', duration: 180, metadataAvailable: true, assessment: { warningTypes: [] } };
    };
    service.sendConfiguredReply = async (_event, key, values) => { replies.push({ key, values }); return { sent: true }; };
    service.sendCommandReply = service.sendConfiguredReply;
    return service;
  }
  return { service: make(), make, settings, accepted, replies, challenges, metadata, saved: () => saved };
}

test('viewer challenges require explicit opt-in and ordinary requests remain available', async () => {
  const f = fixture({ enabled: false });
  await f.service.handleChatMessage(event(`!挑戰 90 ${url(VIDEO)}`));
  await f.service.handleChatMessage(event(`!challenge 90 ${url(VIDEO)}`));
  assert.equal(f.accepted.length, 0);
  assert.equal(f.replies.length, 0);
  await f.service.handleChatMessage(event(`!點歌 ${url(VIDEO)}`));
  assert.equal(f.accepted.length, 1);
  assert.equal(f.accepted[0].challenge, null);
  await f.service.completeSongRequest({ requestId: f.accepted[0].requestId, success: true });
  assert.deepEqual(f.challenges, []);
});

test('challenge aliases share configured request permission, command enable and global enable', async () => {
  const f = fixture({ requestRules: { command: '!sing', permissionLevel: 'subscriber' } });
  await f.service.handleChatMessage(event(`!挑戰 90 ${url(VIDEO)}`));
  assert.equal(f.replies.at(-1).key, 'permissionDenied');
  assert.equal(f.accepted.length, 0);
  await f.service.handleChatMessage(event(`!CHALLENGE 90 ${url(VIDEO)}`, 'sub', [{ set_id: 'subscriber' }]));
  assert.equal(f.accepted.length, 1);
  assert.deepEqual(f.accepted[0].challenge, { targetScore: 90 });
  const disabled = fixture({ requestRules: { enabled: false } });
  await disabled.service.handleChatMessage(event(`!挑戰 90 ${url(VIDEO)}`));
  assert.equal(disabled.accepted.length, 0);
  const paused = fixture({ rules: { enabled: false } });
  await paused.service.handleChatMessage(event(`!challenge 90 ${url(VIDEO)}`));
  assert.equal(paused.replies.at(-1).key, 'requestDisabled');
});

test('ordinary and challenge requests share per-user and global request cooldowns', async () => {
  for (const cooldown of [{ userCooldownSeconds: 60 }, { globalCooldownSeconds: 60 }]) {
    const f = fixture({ requestRules: cooldown });
    await f.service.handleChatMessage(event(`!點歌 ${url(VIDEO)}`));
    await f.service.handleChatMessage(event(`!challenge 90 ${url(OTHER)}`));
    assert.equal(f.accepted.length, 1);
    assert.equal(f.replies.at(-1).key, 'cooldownActive');
    const g = fixture({ requestRules: cooldown });
    await g.service.handleChatMessage(event(`!挑戰 90 ${url(VIDEO)}`));
    await g.service.handleChatMessage(event(`!點歌 ${url(OTHER)}`));
    assert.equal(g.accepted.length, 1);
    assert.equal(g.replies.at(-1).key, 'cooldownActive');
  }
});

test('invalid target and missing/surplus URL never reach metadata/import pipeline', async () => {
  for (const argument of ['-1', '101', 'NaN', 'Infinity', '0x5a', '90oops', '', '90', `90 ${url(VIDEO)} extra`]) {
    const f = fixture();
    const input = argument.includes(' ') || argument === '90' || !argument ? argument : `${argument} ${url(VIDEO)}`;
    await f.service.handleChatMessage(event(`!挑戰 ${input}`));
    assert.equal(f.accepted.length, 0, input);
    assert.equal(f.metadata.length, 0, input);
    assert.equal(f.replies.at(-1).key, 'invalidLink');
  }
  for (const score of [0, 89.5, 100]) {
    const f = fixture();
    await f.service.handleChatMessage(event(`!challenge ${score} ${url(VIDEO)}`));
    assert.equal(f.accepted[0].challenge.targetScore, score);
  }
});

test('playlist and invalid URL use existing rejection path', async () => {
  for (const [input, key] of [[`${url(VIDEO)}?list=PLtest`, 'playlistNotAllowed'], ['https://example.com/song', 'invalidLink']]) {
    const f = fixture();
    await f.service.handleChatMessage(event(`!挑戰 90 ${input}`));
    assert.equal(f.replies.at(-1).key, key);
    assert.equal(f.accepted.length, 0);
    assert.equal(f.metadata.length, 0);
  }
});

test('challenges share pending, per-user, session, live-only, duplicate and blacklist rules', async () => {
  const cases = [
    [{ maxPending: 1, duplicateScope: 'allow' }, 'other', VIDEO, 'queueFull'],
    [{ perUserPending: 1, duplicateScope: 'allow' }, 'viewer', OTHER, 'userLimitReached'],
    [{ perUserSessionLimit: 1, duplicateScope: 'allow' }, 'viewer', OTHER, 'sessionUserLimit'],
    [{ sessionRequestLimit: 1, duplicateScope: 'allow' }, 'other', OTHER, 'sessionLimit'],
    [{}, 'other', VIDEO, 'duplicatePending'],
  ];
  for (const [rules, user, video, key] of cases) {
    const f = fixture({ rules });
    await f.service.handleChatMessage(event(`!點歌 ${url(VIDEO)}`));
    await f.service.handleChatMessage(event(`!挑戰 90 ${url(video)}`, user));
    assert.equal(f.accepted.length, 1, key);
    assert.equal(f.replies.at(-1).key, key);
  }
  for (const [rules, key] of [
    [{ liveOnly: true }, 'streamOffline'],
    [{ blacklist: [{ id: 'blocked', type: 'video', value: VIDEO }] }, 'blockedRequest'],
    [{ blacklist: [{ id: 'blocked', type: 'title', value: 'song' }] }, 'blockedRequest'],
    [{ maxDurationMinutes: 1 }, 'durationExceeded'],
  ]) {
    const f = fixture({ rules });
    await f.service.handleChatMessage(event(`!challenge 90 ${url(VIDEO)}`));
    assert.equal(f.accepted.length, 0, key);
    assert.equal(f.replies.at(-1).key, key);
    assert.equal(f.challenges.length, 0);
  }
});

test('only successful import creates challenge; pending and retry leave it inactive', async () => {
  const f = fixture();
  await f.service.handleChatMessage(event(`!挑戰 90 ${url(VIDEO)}`));
  const requestId = f.accepted[0].requestId;
  assert.equal(f.challenges.length, 0);
  await f.service.completeSongRequest({ requestId, success: false, retryable: true });
  assert.equal(f.challenges.length, 0);
  await f.service.completeSongRequest({ requestId, success: true, title: 'Imported title' });
  assert.deepEqual(f.challenges, [{ requestId, targetScore: 90, trackId: VIDEO, title: 'Imported title', requester: 'Name viewer' }]);
  await assert.rejects(() => f.service.completeSongRequest({ requestId, success: true }), /不存在/);
  assert.equal(f.challenges.length, 1);
});

test('rejected, failed, canceled, expired and panel-unavailable requests never create challenge', async () => {
  for (const action of ['reject', 'fail', 'cancel', 'expire', 'unavailable']) {
    const f = fixture();
    if (action === 'unavailable') f.service.onSongRequest = () => false;
    await f.service.handleChatMessage(event(`!挑戰 90 ${url(VIDEO)}`));
    const request = f.service.pendingRequests.values().next().value;
    if (action === 'reject') await f.service.completeSongRequest({ requestId: request.requestId, rejected: true });
    if (action === 'fail') await f.service.completeSongRequest({ requestId: request.requestId, success: false });
    if (action === 'cancel') await f.service.handleChatMessage(event('!取消點歌'));
    if (action === 'expire') await f.service.expireRequest(request.requestId, request);
    assert.equal(f.challenges.length, 0, action);
    assert.equal(f.service.pendingRequests.size, 0, action);
  }
});

test('pending challenge metadata survives save/restore and approval', async () => {
  const f = fixture();
  await f.service.handleChatMessage(event(`!challenge 88.5 ${url(VIDEO)}`));
  assert.deepEqual(f.saved()[0].challenge, { targetScore: 88.5 });
  const restored = f.make();
  const request = restored.getPendingRequests()[0];
  assert.deepEqual(request.challenge, { targetScore: 88.5 });
  assert.equal(f.challenges.length, 0);
  await restored.completeSongRequest({ requestId: request.requestId, success: true });
  assert.equal(f.challenges.length, 1);
  assert.equal(f.challenges[0].targetScore, 88.5);
});

test('closing viewer challenges before approval preserves imported song without challenge', async () => {
  const f = fixture();
  await f.service.handleChatMessage(event(`!挑戰 90 ${url(VIDEO)}`));
  f.settings.viewerRequestsEnabled = false;
  await f.service.completeSongRequest({ requestId: f.accepted[0].requestId, success: true });
  assert.equal(f.service.pendingRequests.size, 0);
  assert.equal(f.challenges.length, 0);
  assert.equal(f.replies.at(-1).key, 'importSuccess');
});

test('history service requestId receipts prevent restored approved request replacing newer challenge', async () => {
  const processed = new Set();
  let current = null;
  const practice = {
    getSettings: () => ({ viewerRequestsEnabled: true }),
    getChallenge: () => ({ challenge: current }),
    createViewerChallenge: raw => {
      if (processed.has(raw.requestId)) return { duplicate: true };
      processed.add(raw.requestId);
      current = { ...raw, id: `mock-challenge-${processed.size}` };
      return { challenge: current };
    },
  };
  const f = fixture({ practiceHistoryService: practice });
  await f.service.handleChatMessage(event(`!挑戰 90 ${url(VIDEO)}`));
  const pending = structuredClone(f.saved());
  await f.service.completeSongRequest({ requestId: pending[0].requestId, success: true });
  const first = practice.getChallenge().challenge;
  practice.createViewerChallenge({ trackId: OTHER, targetScore: 95, title: 'New', requester: 'Another', requestId: 'newer' });
  const newer = practice.getChallenge().challenge;
  const restored = fixture({ practiceHistoryService: practice, pendingStore: { load: () => pending, save: () => true } });
  await restored.service.completeSongRequest({ requestId: pending[0].requestId, success: true });
  assert.notEqual(first.id, newer.id);
  assert.equal(practice.getChallenge().challenge.id, newer.id);
});

test('injected getter stays lazy for ordinary requests and channel-points metadata is ignored', async () => {
  const f = fixture();
  let calls = 0;
  f.service.getPracticeHistoryService = () => { calls++; throw new Error('must not load'); };
  await f.service.handleChatMessage(event(`!點歌 ${url(VIDEO)}`));
  await f.service.completeSongRequest({ requestId: f.accepted[0].requestId, success: true });
  assert.equal(calls, 0);
  assert.equal(f.service.serializePendingRequest({ source: 'channel-points', challenge: { targetScore: 90 } }).challenge, null);
  for (const targetScore of [-1, 101, NaN, '90']) {
    assert.equal(f.service.serializePendingRequest({ source: 'chat', challenge: { targetScore } }).challenge, null);
  }
});
