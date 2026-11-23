'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-eventsub-handoff-'));
process.env.ELITESAND_DATA_DIR = path.join(root, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(root, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(root, 'logs');
const { TwitchService, CONNECT_WATCHDOG_MS } = require('../server/services/twitch-service');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const welcome = (id = 'new-session', seconds = null) => JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: seconds } } });
const reconnect = (url = 'wss://eventsub.wss.twitch.tv/ws?reconnect=fixture') => JSON.stringify({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: url } } });
const notification = id => JSON.stringify({ metadata: { message_type: 'notification', message_id: id }, payload: { subscription: { type: 'channel.chat.message' }, event: { message: { text: id } } } });

function fixture(t, { addEventListener = false } = {}) {
  const original = globalThis.WebSocket, sockets = [], timers = new Set();
  class FakeSocket extends EventEmitter {
    constructor(url) { super(); this.url = url; this.closed = false; sockets.push(this); }
    close() { this.closed = true; this.emit('close'); }
  }
  if (addEventListener) FakeSocket.prototype.addEventListener = FakeSocket.prototype.on;
  globalThis.WebSocket = FakeSocket;
  const store = { load: () => [], save: () => true };
  const service = new TwitchService({
    config: { twitchClientId: 'fixture' }, pendingStore: store, historyStore: store, refundStore: store,
    sessionStore: { load: () => null, save: () => true }, authStore: { load: () => null, clear() {} },
    timers: {
      setTimeout(fn, delay) { const timer = { fn, delay }; timers.add(timer); return timer; },
      clearTimeout(timer) { timers.delete(timer); },
    },
  });
  service.auth = { accessToken: 'fixture', userId: 'broadcaster', scopes: ['channel:manage:redemptions'] };
  const subscriptions = [], events = [], retries = [];
  service.createSubscription = async type => subscriptions.push(type);
  service.refreshLiveState = async () => {};
  service.setManagedRewardPaused = async () => {};
  service.reconcileRewardRedemptions = async () => {};
  service.handleChatMessage = async (_event, id) => events.push(id);
  service.scheduleReconnect = reason => retries.push(reason);
  service.connectEventSub();
  const old = sockets[0];
  service.wsSessionId = 'old-session'; service.subscriptionState = 'ready';
  service.rewardSubscriptionReady = true; service.connectionState = 'connected';
  service.clearConnectionWatchdog(); service.armKeepaliveWatchdog(old);
  t.after(() => { service.stop(); globalThis.WebSocket = original; });
  return { service, old, sockets, subscriptions, events, retries, timers };
}

test('S-04: old connection stays open and delivers notifications until new welcome', async t => {
  const f = fixture(t);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  assert.equal(f.old.closed, false);
  assert.equal(f.service.ws, f.old);
  await f.service.handleWebSocketMessage(notification('during-handoff'), f.old);
  assert.deepEqual(f.events, ['during-handoff']);
  await f.service.handleWebSocketMessage(welcome(), f.sockets[1]);
  assert.equal(f.old.closed, true);
  assert.equal(f.service.ws, f.sockets[1]); assert.equal(f.service.wsSessionId, 'new-session');
  assert.equal(f.service.subscriptionState, 'ready'); assert.equal(f.service.rewardSubscriptionReady, true);
  assert.deepEqual(f.subscriptions, [], 'Twitch transfers existing subscriptions; do not recreate them');
  assert.equal(f.service.eventSubKeepaliveSeconds, 30, 'a null transferred keepalive preserves the prior timeout');
});

test('S-04: duplicate reconnect messages create only one candidate and notifications remain deduplicated', async t => {
  const f = fixture(t, { addEventListener: true });
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  assert.equal(f.sockets.length, 2);
  await f.service.handleWebSocketMessage(notification('same-event'), f.old);
  await f.service.handleWebSocketMessage(welcome(), f.sockets[1]);
  await f.service.handleWebSocketMessage(notification('same-event'), f.sockets[1]);
  assert.deepEqual(f.events, ['same-event']);
});

test('S-04: candidate failure keeps the existing healthy session usable', async t => {
  const f = fixture(t);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  f.sockets[1].emit('error', new Error('candidate failed'));
  assert.equal(f.old.closed, false); assert.equal(f.service.ws, f.old);
  assert.equal(f.service.wsSessionId, 'old-session'); assert.equal(f.service.rewardSubscriptionReady, true);
  await f.service.handleWebSocketMessage(notification('after-failure'), f.old);
  assert.deepEqual(f.events, ['after-failure']);
});

test('S-04: a candidate without welcome has a bounded timeout and closes only itself', async t => {
  const f = fixture(t);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  const deadline = [...f.timers].find(timer => timer.delay === CONNECT_WATCHDOG_MS);
  assert.ok(deadline); deadline.fn();
  assert.equal(f.sockets[1].closed, true); assert.equal(f.old.closed, false);
  assert.equal(f.service.ws, f.old); assert.equal(f.service.wsSessionId, 'old-session');
});

test('S-04: early old close waits for the candidate, whose welcome preserves moved subscriptions', async t => {
  const f = fixture(t);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  f.old.close(); assert.deepEqual(f.retries, []);
  await f.service.handleWebSocketMessage(welcome(), f.sockets[1]);
  assert.equal(f.service.ws, f.sockets[1]); assert.equal(f.service.subscriptionState, 'ready');
  assert.equal(f.service.rewardSubscriptionReady, true); assert.deepEqual(f.subscriptions, []);
});

test('S-04: if both sockets fail, the normal reconnect path runs once', async t => {
  const f = fixture(t);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  f.old.close(); f.sockets[1].close();
  assert.equal(f.service.ws, null); assert.equal(f.service.wsSessionId, null);
  assert.equal(f.retries.length, 1);
});

test('S-04: stop, explicit disconnect and revocation clean up both sockets and pending deadlines', async t => {
  for (const action of ['stop', 'disconnect', 'revoke']) {
    const f = fixture(t);
    await f.service.handleWebSocketMessage(reconnect(), f.old);
    if (action === 'stop') f.service.stop();
    else if (action === 'disconnect') f.service.disconnectEventSub();
    else f.service.handleEventSubRevocation({ payload: { subscription: { status: 'authorization_revoked' } } }, f.old);
    assert.ok(f.sockets.every(socket => socket.closed), action);
    assert.equal(f.timers.size, 0, action); assert.deepEqual(f.retries, [], action);
    await f.service.handleWebSocketMessage(welcome(), f.sockets[1]);
    assert.equal(f.service.wsSessionId, null, 'a late welcome cannot resurrect a stopped session');
  }
});

test('S-04: old socket errors and messages cannot corrupt a completed handoff', async t => {
  const f = fixture(t);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  await f.service.handleWebSocketMessage(welcome(), f.sockets[1]);
  const before = f.service.lastConnectionError;
  f.old.emit('error', new Error('stale error')); f.old.emit('close');
  await f.service.handleWebSocketMessage(notification('stale-event'), f.old);
  assert.equal(f.service.lastConnectionError, before); assert.equal(f.service.ws, f.sockets[1]);
  assert.deepEqual(f.events, []); assert.deepEqual(f.retries, []);
});

test('S-04: failed or malformed candidate welcome cannot replace the healthy old session', async t => {
  const f = fixture(t);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  await f.service.handleWebSocketMessage(welcome(''), f.sockets[1]);
  assert.equal(f.service.ws, f.old); assert.equal(f.old.closed, false);
  assert.equal(f.sockets[1].closed, true); assert.equal(f.service.wsSessionId, 'old-session');
});

test('S-04: late subscription failures from an old session cannot close the new session', async t => {
  const f = fixture(t);
  f.service.wsSessionId = null;
  let rejectSubscriptions;
  f.service.createSubscription = () => new Promise((_resolve, reject) => { rejectSubscriptions ||= reject; });
  const pending = f.service.handleWebSocketMessage(welcome('initial'), f.old);
  await f.service.handleWebSocketMessage(reconnect(), f.old);
  await f.service.handleWebSocketMessage(welcome(), f.sockets[1]);
  rejectSubscriptions(new Error('late failed subscription'));
  await pending;
  assert.equal(f.service.ws, f.sockets[1]); assert.equal(f.sockets[1].closed, false);
  assert.equal(f.service.lastConnectionError, '');
});

test('S-04: real local WebSockets deliver across handoff without re-creating subscriptions', { timeout: 10000 }, async t => {
  const { WebSocket, WebSocketServer } = require('ws');
  const { once } = require('node:events');
  const f = fixture(t);
  f.service.disconnectEventSub();
  globalThis.WebSocket = WebSocket;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const connections = [];
  server.on('connection', (socket, request) => {
    connections.push({ socket, url: request.url });
    if (request.url === '/old') socket.send(welcome('transport-old', 30));
  });
  t.after(async () => {
    f.service.stop();
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  async function until(predicate) {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Local EventSub transport timed out');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  const base = `ws://127.0.0.1:${server.address().port}`;
  f.service.connectEventSub(`${base}/old`);
  await until(() => f.service.subscriptionState === 'ready');
  const initialSubscriptions = f.subscriptions.length;
  assert.equal(initialSubscriptions, 7);
  const old = connections[0].socket;
  let oldClosed = false; old.on('close', () => { oldClosed = true; });
  old.send(reconnect(`${base}/new?opaque=keep-exact`));
  await until(() => connections.length === 2);
  assert.equal(connections[1].url, '/new?opaque=keep-exact'); assert.equal(oldClosed, false);
  old.send(notification('real-during-handoff'));
  await until(() => f.events.length === 1);
  connections[1].socket.send(welcome('transport-new'));
  await until(() => f.service.wsSessionId === 'transport-new' && oldClosed);
  connections[1].socket.send(notification('real-during-handoff'));
  connections[1].socket.send(notification('real-after-handoff'));
  await until(() => f.events.length === 2);
  assert.deepEqual(f.events, ['real-during-handoff', 'real-after-handoff']);
  assert.equal(f.subscriptions.length, initialSubscriptions);
  assert.equal(f.service.rewardSubscriptionReady, true);
});
