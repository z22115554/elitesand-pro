'use strict';

/**
 * 公開點歌頁中繼服務單元測試（docs/PUBLIC-SONG-REQUEST-PLAN.md Phase 1）。
 *
 * 全部用注入的假依賴（fake store／savedPlaylists／libraryStore／WebSocket），
 * 不碰真正的網路或磁碟，只有 song-request-relay-store 的持久化測試會寫進
 * 隔離過的 ELITESAND_DATA_DIR 暫存目錄。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-song-request-relay-test-'));
process.env.ELITESAND_DATA_DIR = TEST_DATA_DIR;

const {
  SongRequestRelayService,
  reconnectDelay,
  relayEnabledByConfig,
  ALL_CATALOG_PLAYLIST_ID,
} = require('../server/services/song-request-relay-service');
const relayStore = require('../server/services/song-request-relay-store');
const { checkEdgeRateLimit, getEdgeRateLimitKeys } = require('../cloud/song-request-relay/src/edge-rate-limit');

test('reconnectDelay：跟 twitch-service.js 同一條指數退避＋抖動公式', () => {
  assert.equal(reconnectDelay(1, () => 0.5), 3000);
  assert.equal(reconnectDelay(2, () => 0.5), 6000);
  assert.equal(reconnectDelay(10, () => 0.5), 60000); // 封頂 60s
  assert.equal(reconnectDelay(1, () => 0), Math.round(3000 * 0.8));
  assert.equal(reconnectDelay(1, () => 1), Math.round(3000 * 1.2));
});

test('relayEnabledByConfig：需同時打開上層開關且使用 https，空字串／http 都算未設定', () => {
  assert.equal(relayEnabledByConfig({ songRequestRelayEnabled: true, songRequestRelayUrl: 'https://relay.example.com' }), true);
  assert.equal(relayEnabledByConfig({ songRequestRelayEnabled: false, songRequestRelayUrl: 'https://relay.example.com' }), false);
  assert.equal(relayEnabledByConfig({ songRequestRelayUrl: 'https://relay.example.com' }), false);
  assert.equal(relayEnabledByConfig({ songRequestRelayEnabled: true, songRequestRelayUrl: '' }), false);
  assert.equal(relayEnabledByConfig({ songRequestRelayEnabled: true, songRequestRelayUrl: 'http://relay.example.com' }), false);
  assert.equal(relayEnabledByConfig({}), false);
});

test('song-request-relay-store：save/load 往返，未知欄位不會混進來', () => {
  relayStore.save({ enabled: true, publicSlug: 'abc123', secret: 's3cr3t', publishedPlaylistId: 'pl1', extra: 'nope' });
  const loaded = relayStore.load();
  assert.deepEqual(loaded, { enabled: true, publicSlug: 'abc123', secret: 's3cr3t', publishedPlaylistId: 'pl1' });
});

function makeFakeSavedPlaylists(playlists) {
  return { get: (id) => playlists.find((p) => p.id === id) || null };
}

function makeFakeLibraryStore(entries) {
  return {
    getEntry: (id) => entries[id] || null,
    getLibrary: () => Object.values(entries),
    getAudioExistsLookup: () => () => true,
  };
}

function fakeBuildTrackFromEntry(entry) {
  return { id: entry.id, title: entry.title, artist: entry.artist || '' };
}

function makeService(overrides = {}) {
  const store = overrides.store || { load: () => relayStore.emptyState(), save: () => true };
  return new SongRequestRelayService({
    config: { songRequestRelayUrl: 'https://relay.example.com', songRequestRelayEnabled: true },
    store,
    savedPlaylists: overrides.savedPlaylists || makeFakeSavedPlaylists([]),
    libraryStore: overrides.libraryStore || makeFakeLibraryStore({}),
    buildTrackFromEntry: fakeBuildTrackFromEntry,
    fetchImpl: overrides.fetchImpl,
    onSongRequest: overrides.onSongRequest || (() => {}),
    onStatusChange: overrides.onStatusChange || (() => {}),
    onPendingRequestsChanged: overrides.onPendingRequestsChanged || (() => {}),
    createWebSocket: overrides.createWebSocket,
    timers: overrides.timers || globalThis,
    ...overrides.extra,
  });
}

test('未啟用時 start() 完全不建立連線（零外連）', () => {
  let created = false;
  const service = makeService({
    store: { load: () => ({ ...relayStore.emptyState(), enabled: false }), save: () => true },
    createWebSocket: () => { created = true; return class {}; },
  });
  service.start();
  assert.equal(created, false);
  assert.equal(service.getStatus().connected, false);
  service.stop();
});

test('已啟用但缺 publicSlug/secret（尚未註冊過）時 start() 也不建立連線', () => {
  let created = false;
  const service = makeService({
    store: { load: () => ({ ...relayStore.emptyState(), enabled: true }), save: () => true },
    createWebSocket: () => { created = true; return class {}; },
  });
  service.start();
  assert.equal(created, false);
  service.stop();
});

test('start()：不沿用上次的啟用狀態，重開後必須手動重新開啟', () => {
  const saved = [];
  const service = makeService({
    store: {
      load: () => ({ enabled: true, publicSlug: 'slug1', secret: 'secret1', publishedPlaylistId: '' }),
      save: (state) => { saved.push({ ...state }); return true; },
    },
  });
  service.start();
  assert.equal(service.getStatus().enabled, false);
  assert.equal(saved.at(-1).enabled, false);
  service.stop();
});

test('收到 song-request 訊息會進入 pendingRequests 並觸發 onSongRequest', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手' } };
  const received = [];
  const service = makeService({
    libraryStore: makeFakeLibraryStore(entries),
    onSongRequest: (request) => received.push(request),
  });
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1', displayName: '觀眾A', note: '好聽' } });
  assert.equal(received.length, 1);
  assert.equal(received[0].title, '測試歌曲');
  assert.equal(received[0].displayName, '觀眾A');
  assert.equal(service.getPendingRequests().length, 1);
});

test('approve()：從待處理清單移除並解析成完整 track，不自己寫入播放清單', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手' } };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) });
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  const [pending] = service.getPendingRequests();
  const result = service.approve(pending.requestId);
  assert.equal(result.ok, true);
  assert.deepEqual(result.track, { id: 'track1', title: '測試歌曲', artist: '測試歌手' });
  assert.equal(service.getPendingRequests().length, 0);
});

test('approve()：找不到請求時回傳錯誤，不丟例外', () => {
  const service = makeService();
  const result = service.approve('does-not-exist');
  assert.equal(result.ok, false);
});

test('approve()：媒體庫裡歌已不在時回傳錯誤，不會回傳假 track', () => {
  const service = makeService({ libraryStore: makeFakeLibraryStore({}) });
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'gone' } });
  const [pending] = service.getPendingRequests();
  const result = service.approve(pending.requestId);
  assert.equal(result.ok, false);
  assert.equal(service.getPendingRequests().length, 1, '媒體庫消失時請求應保留，之後可重新整理後再處理');
});

test('restorePendingRequest()：最後一步加入播放清單失敗時可把請求放回佇列', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手' } };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) });
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  const [pending] = service.getPendingRequests();
  const approved = service.approve(pending.requestId);
  assert.equal(approved.ok, true);
  assert.equal(service.getPendingRequests().length, 0);
  assert.equal(service.restorePendingRequest(approved.request), true);
  assert.deepEqual(service.getPendingRequests()[0], pending);
});

test('reject()：從待處理清單移除', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '' } };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) });
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  const [pending] = service.getPendingRequests();
  assert.equal(service.reject(pending.requestId).ok, true);
  assert.equal(service.getPendingRequests().length, 0);
});

test('setCatalogPlaylistId()：找不到歌單時拒絕，不會靜默清空已發佈設定', () => {
  const service = makeService({ savedPlaylists: makeFakeSavedPlaylists([{ id: 'pl1', trackIds: [] }]) });
  assert.equal(service.setCatalogPlaylistId('pl1').ok, true);
  assert.equal(service.setCatalogPlaylistId('not-real').ok, false);
});

test('_buildCatalog()：只公開音檔還在本機的歌，且不外洩檔名/網址等私有欄位', () => {
  const entries = {
    a: { id: 'a', title: '歌A', artist: '手A', duration: 120, filename: 'a.mp3', url: 'https://youtu.be/a' },
    b: { id: 'b', title: '歌B', artist: '手B', duration: 90, filename: 'missing.mp3', url: 'https://youtu.be/b' },
  };
  const libraryStore = {
    getEntry: (id) => entries[id] || null,
    getAudioExistsLookup: () => (filename) => filename === 'a.mp3',
  };
  const service = makeService({
    savedPlaylists: makeFakeSavedPlaylists([{ id: 'pl1', trackIds: ['a', 'b', 'missing-entry'] }]),
    libraryStore,
  });
  service.setCatalogPlaylistId('pl1');
  const catalog = service._buildCatalog();
  assert.deepEqual(catalog, [{ id: 'a', title: '歌A', artist: '手A', duration: 120 }]);
});

test('_buildCatalog()：公開全部歌曲時讀取整個媒體庫，而非要求先建立收藏歌單', () => {
  const entries = {
    a: { id: 'a', title: '歌A', artist: '手A', duration: 120, filename: 'a.mp3' },
    b: { id: 'b', title: '歌B', artist: '手B', duration: 90, filename: 'b.mp3' },
  };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) });
  assert.equal(service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID).ok, true);
  assert.deepEqual(service._buildCatalog(), [
    { id: 'a', title: '歌A', artist: '手A', duration: 120 },
    { id: 'b', title: '歌B', artist: '手B', duration: 90 },
  ]);
});

test('連線成功後立即推送歌單快照，訊息裡不含檔名或網址', async () => {
  const entries = { a: { id: 'a', title: '歌A', artist: '手A', duration: 60, filename: 'a.mp3' } };
  const sent = [];
  class FakeSocket {
    constructor(url) { this.url = url; }
    send(data) { sent.push(JSON.parse(data)); }
    close() {}
  }
  const service = makeService({
    store: { load: () => ({ enabled: true, publicSlug: 'slug1', secret: 'sec1', publishedPlaylistId: 'pl1' }), save: () => true },
    savedPlaylists: makeFakeSavedPlaylists([{ id: 'pl1', trackIds: ['a'] }]),
    libraryStore: makeFakeLibraryStore(entries),
    createWebSocket: () => FakeSocket,
  });
  service.start();
  await service.enable();
  service.ws.onopen();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'catalog');
  assert.deepEqual(sent[0].tracks, [{ id: 'a', title: '歌A', artist: '手A', duration: 60 }]);
  assert.ok(!JSON.stringify(sent[0]).includes('a.mp3'), '快照不可外洩本機檔名');
  service.stop();
});

test('連線被另一個桌面端接手時停止自動重連，避免兩個程序互踢', async () => {
  class FakeSocket {
    constructor() {}
    send() {}
    close() {}
  }
  const service = makeService({
    store: { load: () => ({ enabled: false, publicSlug: 'slug1', secret: 'secret1', publishedPlaylistId: '' }), save: () => true },
    createWebSocket: () => FakeSocket,
  });
  service.start();
  await service.enable();
  service.ws.onopen();
  service.ws.onclose({ code: 4001, reason: 'replaced by new connection' });
  assert.equal(service.getStatus().reconnectSuppressed, true);
  assert.equal(service.reconnectTimer, null);
  service.stop();
});

test('rotateLink()：重新註冊拿到新 slug/secret，沿用啟用狀態', async () => {
  let registerCalls = 0;
  const saved = [];
  const fetchImpl = async () => {
    registerCalls++;
    return {
      ok: true,
      json: async () => ({ publicSlug: `slug-${registerCalls}`, secret: `secret-${registerCalls}` }),
    };
  };
  const service = makeService({
    store: {
      load: () => ({ enabled: true, publicSlug: 'old-slug', secret: 'old-secret', publishedPlaylistId: '' }),
      save: (state) => { saved.push({ ...state }); return true; },
    },
    fetchImpl,
    createWebSocket: () => class { constructor() {} close() {} },
  });
  const result = await service.rotateLink();
  assert.equal(result.ok, true);
  assert.equal(registerCalls, 1);
  assert.equal(result.publicSlug, 'slug-1');
  assert.equal(saved[saved.length - 1].publicSlug, 'slug-1');
  assert.equal(saved[saved.length - 1].enabled, true);
});

test('入口防刷：有 Cloudflare IP 與 visitor cookie 時，同時使用兩層限流 key', async () => {
  const calls = [];
  const env = {
    REQUEST_IP_RATE_LIMITER: { limit: async (input) => { calls.push(['ip', input.key]); return { success: true }; } },
    REQUEST_VISITOR_RATE_LIMITER: { limit: async (input) => { calls.push(['visitor', input.key]); return { success: true }; } },
  };
  const request = {
    headers: {
      get(name) {
        if (name.toLowerCase() === 'cf-connecting-ip') return '203.0.113.8';
        if (name.toLowerCase() === 'cookie') return 'es_sr_visitor=0123456789abcdef0123456789abcdef0123';
        return '';
      },
    },
  };
  assert.deepEqual(getEdgeRateLimitKeys(request, 'room1234'), {
    ipKey: 'song-request:ip:203.0.113.8',
    visitorKey: 'song-request:visitor:room1234:0123456789abcdef0123456789abcdef0123',
  });
  assert.deepEqual(await checkEdgeRateLimit(env, request, 'room1234'), { ok: true });
  assert.equal(calls.length, 2);
});

test('入口防刷：IP 閘門拒絕時不會再呼叫 visitor 閘門', async () => {
  let visitorCalls = 0;
  const env = {
    REQUEST_IP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    REQUEST_VISITOR_RATE_LIMITER: { limit: async () => { visitorCalls++; return { success: true }; } },
  };
  const request = {
    headers: {
      get(name) {
        if (name.toLowerCase() === 'cf-connecting-ip') return '203.0.113.9';
        if (name.toLowerCase() === 'cookie') return 'es_sr_visitor=0123456789abcdef0123456789abcdef0123';
        return '';
      },
    },
  };
  assert.deepEqual(await checkEdgeRateLimit(env, request, 'room1234'), { ok: false, reason: 'ip' });
  assert.equal(visitorCalls, 0);
});

test('入口防刷：本機測試沒有 CF-Connecting-IP 時不誤擋，仍交給後端限流', async () => {
  let calls = 0;
  const env = { REQUEST_IP_RATE_LIMITER: { limit: async () => { calls++; return { success: false }; } } };
  const request = { headers: { get: () => '' } };
  assert.deepEqual(await checkEdgeRateLimit(env, request, 'room1234'), { ok: true });
  assert.equal(calls, 0);
});
