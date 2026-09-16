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
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手', filename: 'track1.mp3' } };
  const received = [];
  const service = makeService({
    libraryStore: makeFakeLibraryStore(entries),
    onSongRequest: (request) => received.push(request),
  });
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1', displayName: '觀眾A', note: '好聽' } });
  assert.equal(received.length, 1);
  assert.equal(received[0].title, '測試歌曲');
  assert.equal(received[0].displayName, '觀眾A');
  assert.equal(service.getPendingRequests().length, 1);
});

test('中繼收到的 catalogTrackId 不在目前公開目錄裡時直接忽略，即使那首歌在媒體庫裡真的存在', () => {
  // 這是防「被入侵或落後的中繼服務」的最後一道防線：只信任「現在真的公開的目錄」，
  // 不是「媒體庫裡曾經存在過的任何一首歌」。track2 存在於媒體庫，但沒被公開。
  const entries = {
    track1: { id: 'track1', title: '公開的歌', artist: '', filename: 'track1.mp3' },
    track2: { id: 'track2', title: '沒公開的歌', artist: '', filename: 'track2.mp3' },
  };
  const received = [];
  const service = makeService({
    savedPlaylists: makeFakeSavedPlaylists([{ id: 'pl1', trackIds: ['track1'] }]),
    libraryStore: makeFakeLibraryStore(entries),
    onSongRequest: (request) => received.push(request),
  });
  service.setCatalogPlaylistId('pl1');
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track2' } });
  assert.equal(received.length, 0);
  assert.equal(service.getPendingRequests().length, 0);
  // 公開目錄裡真的有的那首，行為不受影響。
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  assert.equal(received.length, 1);
});

test('approve()：從待處理清單移除並解析成完整 track，不自己寫入播放清單', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手', filename: 'track1.mp3' } };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) });
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
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
  // 請求進來當下這首歌還在公開目錄裡（否則會被新加的目錄驗證擋掉），核准前才從媒體庫消失
  // ——用同一個 entries 物件讓 libraryStore／_buildCatalog 都讀得到，之後再刪掉那個 key
  // 模擬「核准前歌被刪了」。
  const entries = { gone: { id: 'gone', title: '測試歌曲', artist: '測試歌手', filename: 'gone.mp3' } };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) });
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'gone' } });
  delete entries.gone;
  const [pending] = service.getPendingRequests();
  const result = service.approve(pending.requestId);
  assert.equal(result.ok, false);
  assert.equal(service.getPendingRequests().length, 1, '媒體庫消失時請求應保留，之後可重新整理後再處理');
});

test('approve()：核准前音檔已從本機消失時回傳錯誤，不會核准放不出聲音的歌', () => {
  // 請求進來當下音檔還在（否則會被 _buildCatalog 目錄驗證擋掉），核准前才消失
  // ——用可變的 exists() 模擬「請求送出後、主播核准前，音檔被清除未用音檔之類的動作刪掉」。
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手', filename: 'track1.mp3' } };
  let audioExists = true;
  const libraryStore = makeFakeLibraryStore(entries);
  libraryStore.getAudioExistsLookup = () => () => audioExists;
  const service = makeService({ libraryStore });
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  assert.equal(service.getPendingRequests().length, 1);
  audioExists = false;
  const [pending] = service.getPendingRequests();
  const result = service.approve(pending.requestId);
  assert.equal(result.ok, false);
  assert.equal(service.getPendingRequests().length, 1, '音檔消失時請求應保留，不能默默核准掉：');
});

test('同一首歌已有一筆待處理請求時，第二筆點歌會被忽略（不占滿待處理佇列）', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手', filename: 'track1.mp3' } };
  const received = [];
  const service = makeService({
    libraryStore: makeFakeLibraryStore(entries),
    onSongRequest: (request) => received.push(request),
  });
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  assert.equal(received.length, 1);
  assert.equal(service.getPendingRequests().length, 1);
});

test('待處理清單滿了會呼叫 onQueueFull()，讓主播在面板上看得到警告', () => {
  const entries = {};
  for (let i = 0; i < 20; i += 1) entries[`t${i}`] = { id: `t${i}`, title: `t${i}`, artist: '', filename: `t${i}.mp3` };
  let queueFullCalls = 0;
  const service = makeService({
    libraryStore: makeFakeLibraryStore(entries),
    extra: { onQueueFull: () => { queueFullCalls += 1; } },
  });
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
  for (let i = 0; i < 20; i += 1) service._handleMessage({ type: 'song-request', request: { catalogTrackId: `t${i}` } });
  assert.equal(service.getPendingRequests().length, 20);
  assert.equal(queueFullCalls, 0);
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'overflow' } });
  assert.equal(service.getPendingRequests().length, 20, '滿了之後不能再塞進去：');
  assert.equal(queueFullCalls, 1);
});

test('待處理請求會落地到 song-request-relay-store，重開服務（模擬程式重啟）後還在', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手', filename: 'track1.mp3' } };
  const first = makeService({ libraryStore: makeFakeLibraryStore(entries), store: relayStore });
  first.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
  first._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1', displayName: '觀眾A' } });
  assert.equal(first.getPendingRequests().length, 1);

  // 模擬程式重啟：重新 new 一份 service，讀同一個（真的落地過的）store。
  const restarted = makeService({ libraryStore: makeFakeLibraryStore(entries), store: relayStore });
  assert.equal(restarted.getPendingRequests().length, 1, '重開程式後，待處理請求不應該消失：');
  assert.equal(restarted.getPendingRequests()[0].displayName, '觀眾A');

  assert.equal(restarted.reject(restarted.getPendingRequests()[0].requestId).ok, true);
  const third = makeService({ libraryStore: makeFakeLibraryStore(entries), store: relayStore });
  assert.equal(third.getPendingRequests().length, 0, 'reject() 之後也要落地，不能重開又復活：');
});

test('假 store 只實作 load/save（沒有 loadPending/savePending）時，待處理請求正常運作但不落地', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '', filename: 'track1.mp3' } };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) }); // makeService 預設的假 store 沒有 loadPending/savePending
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  assert.equal(service.getPendingRequests().length, 1, '缺少持久化方法時仍要能正常運作，不能拋例外：');
});

test('enable()：兩個幾乎同時的呼叫在尚未註冊過時只會真的註冊一次', async () => {
  let registerCalls = 0;
  const fetchImpl = async () => {
    registerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, json: async () => ({ publicSlug: `slug-${registerCalls}`, secret: `secret-${registerCalls}` }) };
  };
  const saved = [];
  const service = makeService({
    store: { load: () => relayStore.emptyState(), save: (state) => { saved.push({ ...state }); return true; } },
    fetchImpl,
    createWebSocket: () => class { constructor() {} close() {} },
  });
  const [first, second] = await Promise.all([service.enable(), service.enable()]);
  assert.equal(registerCalls, 1, '併發 enable() 應該共用同一個進行中的 _register()，不能各自各發一次：');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.publicSlug, second.publicSlug);
  service.stop();
});

test('restorePendingRequest()：最後一步加入播放清單失敗時可把請求放回佇列', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '測試歌手', filename: 'track1.mp3' } };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) });
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
  service._handleMessage({ type: 'song-request', request: { catalogTrackId: 'track1' } });
  const [pending] = service.getPendingRequests();
  const approved = service.approve(pending.requestId);
  assert.equal(approved.ok, true);
  assert.equal(service.getPendingRequests().length, 0);
  assert.equal(service.restorePendingRequest(approved.request), true);
  assert.deepEqual(service.getPendingRequests()[0], pending);
});

test('reject()：從待處理清單移除', () => {
  const entries = { track1: { id: 'track1', title: '測試歌曲', artist: '', filename: 'track1.mp3' } };
  const service = makeService({ libraryStore: makeFakeLibraryStore(entries) });
  service.setCatalogPlaylistId(ALL_CATALOG_PLAYLIST_ID);
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

test('WebSocket URL 不帶 secret，首包認證成功後才推送歌單快照', async () => {
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
  assert.equal(service.ws.url, 'wss://relay.example.com/api/relay-v2/slug1');
  assert.ok(!service.ws.url.includes('secret'), '長效密鑰不可出現在 URL/query string');
  assert.deepEqual(sent, [{ type: 'auth', secret: 'sec1' }]);
  assert.equal(service.getStatus().connected, false, 'Worker 尚未確認認證前不可提早顯示已連線');

  service.ws.onmessage({ data: JSON.stringify({ type: 'auth-ok' }) });
  assert.equal(service.getStatus().connected, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 'catalog');
  assert.deepEqual(sent[1].tracks, [{ id: 'a', title: '歌A', artist: '手A', duration: 60 }]);
  assert.ok(!JSON.stringify(sent[1]).includes('a.mp3'), '快照不可外洩本機檔名');
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
  service.ws.onmessage({ data: JSON.stringify({ type: 'auth-ok' }) });
  service.ws.onclose({ code: 4001, reason: 'replaced by new connection' });
  assert.equal(service.getStatus().reconnectSuppressed, true);
  assert.equal(service.reconnectTimer, null);
  service.stop();
});

test('Worker v2 只在首包驗證成功後標記桌面連線，並隔離舊版 query 認證路徑', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloud/song-request-relay/src/room-do.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(__dirname, '../cloud/song-request-relay/src/worker.js'), 'utf8');
  assert.ok(workerSource.includes("protocolVersion === 2 ? '/relay-v2' : `/relay${url.search}`"),
    'v2 轉送路徑不可帶 query；舊版 query 相容只能留在 v1 路徑');
  assert.ok(source.includes('_handleLegacyRelayUpgrade(request, url)')
    && source.includes("url.pathname === '/relay-v2'"),
  '舊版 query 認證與新版首包認證必須使用不同路徑，才能平滑部署');
  assert.ok(source.includes("payload?.type === 'auth'")
    && source.includes('timingSafeEqualHex(providedHash, this.secretHash)')
    && source.includes("ws.serializeAttachment({ authenticated: true })")
    && source.includes("type: 'auth-ok'"),
  'Worker 必須以首個 frame 驗證 secret，成功後才標記 authenticated 並回覆 auth-ok');
  const verifyAt = source.indexOf('timingSafeEqualHex(providedHash, this.secretHash)');
  const replaceCallAt = source.indexOf('this._replaceAuthenticatedDesktop(ws)', verifyAt);
  assert.ok(verifyAt >= 0 && replaceCallAt > verifyAt, '未認證 socket 不可先踢掉目前桌面連線');
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
