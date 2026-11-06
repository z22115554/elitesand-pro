'use strict';

// Issue #21: Twitch reward redemption may be externally completed, canceled or deleted.
// Exercise the real TwitchService with isolated storage and fake Helix responses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-twitch-redemption-'));
process.env.ELITESAND_DATA_DIR = path.join(root, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(root, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(root, 'logs');

const audioPath = require.resolve('../server/services/audio-processor');
const oldAudio = require.cache[audioPath];
require.cache[audioPath] = { id: audioPath, filename: audioPath, loaded: true, exports: {} };
const { TwitchService } = require('../server/services/twitch-service');
if (oldAudio) require.cache[audioPath] = oldAudio;
else delete require.cache[audioPath];

const services = [];
test.after(() => {
  for (const service of services) service.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

function response(status, body = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function fixture() {
  let saved = [];
  const calls = [], replies = [];
  const pendingStore = {
    load: () => structuredClone(saved),
    save: value => { saved = structuredClone(value); return true; },
  };
  const options = {
    config: {},
    pendingStore,
    sessionStore: { load: () => null, save: () => true },
    historyStore: { load: () => [], save: () => true },
    authStore: { load: () => ({ userId: 'broadcaster', accessToken: 'fake-token' }) },
    onPendingRequestsChanged: () => {},
    onHistoryChanged: () => {},
  };
  function make() {
    const service = new TwitchService(options);
    services.push(service);
    service.requireRedemptionAuthorization = async () => {};
    service.sendConfiguredReply = async (_event, key) => {
      replies.push(key);
      return { sent: true };
    };
    return service;
  }
  const service = make();
  const id = 'reward:test-redemption';
  service.pendingRequests.set(id, {
    requestId: id, shortId: 'abc123', historyId: 'history-1',
    url: 'https://youtu.be/dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ',
    title: 'Test Song', author: 'Test Artist', requester: 'viewer', requesterId: 'viewer',
    source: 'channel-points',
    rewardRedemption: { id: 'test-redemption', rewardId: 'test-reward', cost: 500 },
    event: { chatter_user_name: 'viewer', chatter_user_login: 'viewer' },
    createdAt: Date.now(), expiresAt: Date.now() + 600000,
  });
  service.persistPendingRequests();
  service.scheduleRequestExpiry(id);
  return { service, make, id, calls, replies, saved: () => structuredClone(saved) };
}

test('404 PATCH + GET CANCELED settles rejected request without refund retry', async () => {
  const f = fixture();
  f.service.helix = async (_endpoint, options) => {
    f.calls.push(options.method);
    return options.method === 'PATCH' ? response(404, { message: 'not UNFULFILLED' })
      : response(200, { data: [{ id: 'test-redemption', status: 'CANCELED' }] });
  };
  await f.service.completeSongRequest({ requestId: f.id, rejected: true });
  assert.deepEqual(f.calls, ['PATCH', 'GET']);
  assert.equal(f.service.pendingRequests.size, 0);
  assert.equal(f.service.getRequestHistory(1)[0].reward.status, 'refunded');
  assert.deepEqual(f.replies, ['rewardRefunded']);
});

test('already FULFILLED must never be reported as refunded', async () => {
  const f = fixture();
  f.service.helix = async (_endpoint, options) => options.method === 'PATCH'
    ? response(404) : response(200, { data: [{ id: 'test-redemption', status: 'FULFILLED' }] });
  await f.service.completeSongRequest({ requestId: f.id, rejected: true });
  assert.equal(f.service.pendingRequests.size, 0);
  assert.equal(f.service.getRequestHistory(1)[0].reward.status, 'fulfilled');
  assert.equal(f.replies.includes('rewardRefunded'), false);
});

test('deleted/unknown redemption closes local orphan without a false refund claim', async () => {
  const f = fixture();
  f.service.helix = async () => response(404);
  await f.service.completeSongRequest({ requestId: f.id, rejected: true });
  const last = f.service.getRequestHistory(1)[0];
  assert.equal(f.service.pendingRequests.size, 0);
  assert.equal(last.reward.status, 'refund-failed');
  assert.match(last.reason, /核對點數/);
  assert.equal(f.replies.includes('rewardRefunded'), false);
});

test('temporary Helix failures preserve pending request; explicit dismissal is local only', async () => {
  const f = fixture();
  f.service.helix = async () => { f.calls.push('PATCH'); return response(429, { message: 'rate limited' }); };
  await assert.rejects(() => f.service.completeSongRequest({ requestId: f.id, rejected: true }), /rate limited/);
  assert.equal(f.service.pendingRequests.size, 1);
  assert.deepEqual(f.service.dismissSongRequestLocally(f.id), { ok: true });
  assert.equal(f.service.pendingRequests.size, 0);
  assert.deepEqual(f.calls, ['PATCH'], 'dismissal must not issue any Twitch API calls');
  assert.equal(f.service.getRequestHistory(1)[0].reward.status, 'refund-failed');
});

test('successful import is durable across restart and expiry retries FULFILLED, never CANCELED', async () => {
  const f = fixture();
  f.service.helix = async () => response(503, { message: 'temporary outage' });
  await assert.rejects(() => f.service.completeSongRequest({
    requestId: f.id, success: true, title: 'Imported Song', position: '下一首', queue: 1,
  }), /temporary outage/);
  assert.equal(f.saved()[0].importResult.success, true);
  assert.equal(f.saved()[0].importResult.title, 'Imported Song');
  const restarted = f.make();
  assert.equal(restarted.getPendingRequests()[0].importResult.success, true);
  restarted.helix = async (_endpoint, opts) => {
    f.calls.push(opts.body?.status);
    return response(200);
  };
  const request = restarted.pendingRequests.get(f.id);
  await restarted.expireRequest(f.id, request);
  assert.deepEqual(f.calls, ['FULFILLED']);
  assert.equal(restarted.pendingRequests.size, 0);
  assert.equal(restarted.getRequestHistory(1)[0].reward.status, 'fulfilled');
});

test('imported redemption cannot be changed to rejection by stale UI payload', async () => {
  const f = fixture();
  const request = f.service.pendingRequests.get(f.id);
  request.importResult = { success: true, title: 'Saved Song', position: '歌單', queue: '2' };
  f.service.persistPendingRequests();
  f.service.helix = async (_endpoint, opts) => {
    assert.equal(opts.body.status, 'FULFILLED');
    return response(200);
  };
  await f.service.completeSongRequest({ requestId: f.id, rejected: true, success: false });
  assert.equal(f.service.pendingRequests.size, 0);
  assert.equal(f.service.getRequestHistory(1)[0].result, 'imported');
});

test('viewer cancellation cannot refund a request whose import already completed', async () => {
  const f = fixture();
  const request = f.service.pendingRequests.get(f.id);
  request.importResult = { success: true, title: 'Already Imported' };
  f.service.pendingForUser = () => [request];
  f.service.helix = async () => { f.calls.push('unexpected'); return response(200); };
  await f.service.cancelLatestPendingRequest({ chatter_user_name: 'viewer' });
  assert.equal(f.service.pendingRequests.has(f.id), true);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.replies, ['requestCancelFailed']);
});

test('duplicate simultaneous settlements are blocked per request', async () => {
  const f = fixture();
  let resume;
  f.service.helix = () => new Promise(resolve => { resume = () => resolve(response(200)); });
  const first = f.service.completeSongRequest({ requestId: f.id, rejected: true });
  await assert.rejects(() => f.service.completeSongRequest({ requestId: f.id, rejected: true }), /正在同步/);
  // Wait for async permission check to reach the mocked PATCH.
  for (let i = 0; i < 8 && !resume; i++) await Promise.resolve();
  assert.equal(typeof resume, 'function');
  resume();
  await first;
  assert.equal(f.service.pendingRequests.size, 0);
});

test('expiry colliding with a settlement keeps automatic retry after that settlement fails', async () => {
  const f = fixture();
  let resume;
  f.service.helix = () => new Promise(resolve => { resume = () => resolve(response(503, { message: 'temporary outage' })); });
  const settling = f.service.completeSongRequest({ requestId: f.id, rejected: true });
  for (let i = 0; i < 8 && !resume; i++) await Promise.resolve();
  f.service.clearRequestExpiry(f.id); // 模擬計時器已觸發
  await f.service.expireRequest(f.id);
  resume();
  await assert.rejects(() => settling, /temporary outage/);
  assert.equal(f.service.pendingRequests.has(f.id), true);
  assert.equal(f.service.requestExpiryTimers.has(f.id), true);
  const retryIn = f.service.pendingRequests.get(f.id).expiresAt - Date.now();
  assert.ok(retryIn > 0 && retryIn <= 60000);
});

test('recovery strings are translated in every language', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-twitch.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
  const keys = ['syncRetry', 'retrySettlement', 'settlementDone', 'settlementFailed', 'settledMismatch', 'refundUnconfirmed',
    'dismissLocal', 'dismissTitle', 'dismissSummary', 'dismissImpact', 'dismissConfirm', 'dismissFailed', 'dismissed'];
  for (const key of keys) {
    assert.ok(ui.includes(`t('twitch.request.${key}')`), key);
    const row = i18n.match(new RegExp(`'twitch\\.request\\.${key}': \\[(.*)\\],`));
    assert.ok(row, key);
    assert.equal(row[1].split(/', '/).length, 5, key);
  }
  assert.doesNotMatch(ui, /本機移除|點數結算|未確認退款/);
});

test('control panel preserves import outcome when Twitch acknowledgement fails', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-twitch.js'), 'utf8');
  const socket = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'twitch.js'), 'utf8');
  assert.match(ui, /req\.importResult\?\.success/);
  assert.match(ui, /if \(!reportPayload\)/);
  assert.match(ui, /if \(!imported\)/);
  assert.match(ui, /twitch:song-request:dismiss/);
  assert.match(socket, /dismissSongRequestLocally/);
});
