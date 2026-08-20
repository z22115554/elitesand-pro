'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function mockProjectDependencies(request, parent, isMain) {
  if (request === 'node-fetch') return async () => ({ ok: true, status: 202 });
  if (request === '../utils/load-config') return {};
  if (request === '../utils/app-paths') return { dataDir: os.tmpdir() };
  if (request === '../utils/app-version') return { APP_VERSION: 'test', appUserAgent: () => 'test' };
  if (request === './eula-store') return { getStatus: () => ({ required: false }), isAccepted: () => true };
  if (request === '../utils/logger') return { createLogger: () => ({ warn() {} }) };
  return originalLoad(request, parent, isMain);
};
const { createLyricOffsetSync, deriveId, utcPeriods, isSyncableVideoId } = require('../server/services/lyric-offset-sync');
Module._load = originalLoad;

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-lyric-offset-test-'));
  const fixedNow = new Date('2026-08-10T12:00:00.000Z');

  // 預設開啟（opt-out，跟 usage-telemetry 同一個極性），即使 config 完全沒提這個鍵。
  // 但單純建構/查詢設定不該立刻建立本機密鑰——密鑰只在真的要送出/已啟用時才產生。
  const freshInstall = createLyricOffsetSync({
    config: { lyricOffsetEndpoint: 'https://offset.example.test/api/v1/offset' },
    dataDir: dir,
    now: () => fixedNow,
    randomBytes: () => { throw new Error('查詢設定不該建立密鑰'); },
  });
  assert.strictEqual(freshInstall.getSettings().enabled, true, '新安裝預設應為 opt-out 開啟');
  assert.strictEqual(freshInstall.getSettings().available, true, 'endpoint 已設定時應回報可用');

  // 明確在 config 寫 false 才會預設關閉。
  const explicitlyDisabled = createLyricOffsetSync({
    config: { lyricOffsetEndpoint: 'https://offset.example.test/api/v1/offset', lyricOffsetSyncEnabled: false },
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-lyric-offset-test-')),
  });
  assert.strictEqual(explicitlyDisabled.getSettings().enabled, false, 'config 明確寫 false 才該預設關閉');

  assert.strictEqual(isSyncableVideoId('dQw4w9WgXcQ'), true);
  assert.strictEqual(isSyncableVideoId('not-a-video-id'), false);
  assert.strictEqual(isSyncableVideoId('a1b2c3d4-song.mp3'), false);

  const requests = [];
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-lyric-offset-test-'));
  const sync = createLyricOffsetSync({
    config: { lyricOffsetEndpoint: 'https://offset.example.test/api/v1/offset' },
    dataDir: dir2,
    now: () => fixedNow,
    randomBytes: () => Buffer.alloc(32, 3),
    appVersion: '0.9.9.1',
    eulaAccepted: () => true,
    log: { warn() {}, info() {} },
    fetch: async (url, options) => {
      requests.push({ url, method: (options && options.method) || 'GET' });
      if (!options || options.method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ videoId: 'dQw4w9WgXcQ', suggestedOffsetMs: 120, sampleCount: 3 }) };
      }
      return { ok: true, status: 202, json: async () => ({ accepted: true }) };
    },
  });

  assert.deepStrictEqual(utcPeriods(fixedNow), { day: '2026-08-10', week: '2026-W32', month: '2026-08' });
  assert.strictEqual(deriveId('03'.repeat(32), 'day', '2026-08-10').length, 43);

  // 非 YouTube 形狀的 id（本機上傳的檔名）一律不送出，不管開關狀態。
  await sync.submitOffset({ videoId: 'my-local-upload-file', offsetMs: 100 });
  assert.strictEqual(requests.length, 0, '不像 YouTube id 的 trackId 不該送出');

  const submitResult = await sync.submitOffset({ videoId: 'dQw4w9WgXcQ', offsetMs: 150 });
  assert.strictEqual(submitResult.ok, true);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].method, 'POST');

  const suggestion = await sync.getSuggestedOffset('dQw4w9WgXcQ');
  assert.deepStrictEqual(suggestion, { suggestedOffsetMs: 120, sampleCount: 3 });
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[1].method, 'GET');

  const persisted = JSON.parse(fs.readFileSync(path.join(dir2, 'lyric-offset-sync.json'), 'utf8'));
  assert.ok(!JSON.stringify(persisted).includes('installId'), '不可含固定安裝 ID');

  sync.setEnabled(false);
  const disabledState = JSON.parse(fs.readFileSync(path.join(dir2, 'lyric-offset-sync.json'), 'utf8'));
  assert.strictEqual(disabledState.localSecret, null, '關閉後應清除本機密鑰');

  await sync.submitOffset({ videoId: 'dQw4w9WgXcQ', offsetMs: 200 });
  const suggestionAfterDisable = await sync.getSuggestedOffset('dQw4w9WgXcQ');
  assert.strictEqual(requests.length, 2, '關閉後送出與讀取建議值都應靜默不連外');
  assert.strictEqual(suggestionAfterDisable, null, '關閉後查詢建議值應回 null，不可誤判為建議偏移 0');

  // ─── 一次性回補：功能上線前，使用者早就在本機存下的偏移記錄 ───
  const backfillRequests = [];
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-lyric-offset-test-'));
  const backfillSync = createLyricOffsetSync({
    config: { lyricOffsetEndpoint: 'https://offset.example.test/api/v1/offset' },
    dataDir: dir3,
    now: () => fixedNow,
    randomBytes: () => Buffer.alloc(32, 9),
    appVersion: '0.9.9.7',
    eulaAccepted: () => true,
    log: { warn() {}, info() {} },
    fetch: async (url, options) => {
      backfillRequests.push({ videoId: new URLSearchParams(url.split('?')[1]).get('videoId') || JSON.parse(options.body).videoId });
      return { ok: true, status: 202, json: async () => ({ accepted: true }) };
    },
  });
  const existingOffsets = {
    dQw4w9WgXcQ: 150,
    jNQXAC9IVRw: -2000,
    'not-a-video-id': 999, // 本機上傳檔名混進來的舊記錄，不該送出
    AAAAAAAAAAA: 0.5, // 非整數毫秒，不該送出
  };
  const backfillResult = await backfillSync.backfillFromExistingOffsets(existingOffsets);
  assert.strictEqual(backfillResult.total, 2, '只有像 YouTube id 且整數毫秒的項目算數');
  assert.strictEqual(backfillResult.sent, 2);
  assert.deepStrictEqual(backfillRequests.map((r) => r.videoId).sort(), ['dQw4w9WgXcQ', 'jNQXAC9IVRw']);

  // 只會真的執行一次：再呼叫一次不該重送。
  const secondCall = await backfillSync.backfillFromExistingOffsets(existingOffsets);
  assert.deepStrictEqual(secondCall, { skipped: true });
  assert.strictEqual(backfillRequests.length, 2, '回補只會真的執行一次');

  const backfillState = JSON.parse(fs.readFileSync(path.join(dir3, 'lyric-offset-sync.json'), 'utf8'));
  assert.strictEqual(backfillState.backfillDone, true);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
  fs.rmSync(dir3, { recursive: true, force: true });
  console.log('lyric-offset-sync tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
