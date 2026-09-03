'use strict';

/**
 * 日彙總與欄位登錄表的測試。
 *
 * 最重要的兩件事：
 * 1. 送出的 payload 只能含登錄表裡的 key——這是 EULA §7.7 對使用者的承諾，
 *    自動送出的通道沒有「送出前預覽」把關，白名單是唯一防線。
 * 2. 用戶端與接收端的白名單必須逐字一致，否則會出現「本機送得出去、
 *    接收端整包拒絕」的靜默資料遺失。
 */

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
const { createUsageTelemetry } = require('../server/services/usage-telemetry');
const fields = require('../server/services/telemetry-fields');
Module._load = originalLoad;

const DAY_MS = 86400000;

// 預設用已揭露日彙總的 EULA 版本；閘門測試會把它調低
const eulaVersion = { value: '1.8.0' };

function makeTelemetry(dir, requests, clock) {
  return createUsageTelemetry({
    config: {
      anonymousUsageEnabled: true,
      usageEndpoint: 'https://usage.example.test/api/v1/usage',
    },
    dataDir: dir,
    now: () => clock.value,
    randomBytes: () => Buffer.alloc(32, 7),
    appVersion: '1.0.0',
    eulaAccepted: () => true,
    eulaAcceptedVersion: () => eulaVersion.value,
    log: { warn() {} },
    fetch: async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) });
      return { ok: true, status: 202 };
    },
  });
}

function testRegistry() {
  // 登錄表的 key 本身絕不能含路徑、網址、空白等可夾帶資料的字元
  for (const key of fields.ALLOWED_KEYS) {
    assert.ok(/^[a-z0-9_.+-]+$/.test(key), `不合法的欄位名稱：${key}`);
  }
  assert.strictEqual(new Set(fields.ALLOWED_KEYS).size, fields.ALLOWED_KEYS.length, '欄位名稱不可重複');

  // 每個有成敗的功能族都必須同時有 attempt 與 ok，否則算不出成功率
  for (const family of fields.OUTCOME_FAMILIES) {
    assert.ok(fields.ALLOWED_KEYS.includes(`${family}.attempt`), `${family} 缺少 attempt（沒有分母）`);
    assert.ok(fields.ALLOWED_KEYS.includes(`${family}.ok`), `${family} 缺少 ok`);
    assert.ok(fields.ERROR_CODES[family].includes('other'), `${family} 缺少 other 兜底碼`);
  }

  // 錯誤碼消毒：帶路徑／網址／指令的字串一律歸 other，絕不原樣回傳
  const hostile = 'C:\\Users\\thad\\Music\\某首歌.mp3 https://youtu.be/abc $(rm -rf /)';
  assert.strictEqual(fields.mapError('import', hostile), 'other');
  assert.strictEqual(fields.mapError('import', 'YTDLP_HTTP_403'), 'ytdlp_http_403', '大小寫應正規化');
  assert.strictEqual(fields.mapError('不存在的族', 'x'), null);

  assert.strictEqual(fields.countBucket(0), '0');
  assert.strictEqual(fields.countBucket(2), '1-2');
  assert.strictEqual(fields.countBucket(11), '10+');
  assert.strictEqual(fields.vramBucket(3000), 'lt4g');
  assert.strictEqual(fields.vramBucket(8192), 'ge8g');
  assert.strictEqual(fields.vramBucket(undefined), 'unknown');
  assert.strictEqual(fields.realtimeFactorBucket(0.2), '0.1-0.3x');
  assert.strictEqual(fields.durationBucket(400), '6-10m');
}

function testWorkerWhitelistMatches() {
  // 2026-09 反灌水重構把純驗證邏輯（ALLOWED_COUNTER_KEYS／MAX_COUNTER_VALUE
  // 等）從 index.ts 拆到 validation.ts，理由是 wrangler entry module
  // （wrangler.jsonc 的 "main"）只能有 default handler 具名匯出，其餘具名
  // 匯出會讓 tsc 對著 worker-configuration.d.ts 的 ExportedHandler 型別報錯；
  // validation.ts 不是 entry module，可以自由 export 供這裡與單元測試讀取。
  // 這裡唯一改的是「去哪個檔案找常數」，白名單漂移的守衛邏輯本身不變。
  const workerPath = path.join(__dirname, '..', 'cloudflare', 'usage-worker', 'src', 'validation.ts');
  const source = fs.readFileSync(workerPath, 'utf8');
  const match = source.match(/ALLOWED_COUNTER_KEYS[^=]*=\s*new Set\(\s*(\[[\s\S]*?\])\s*\)/);
  assert.ok(match, '在 worker 找不到 ALLOWED_COUNTER_KEYS');
  const workerKeys = JSON.parse(match[1]);
  assert.deepStrictEqual(
    workerKeys.slice().sort(),
    fields.ALLOWED_KEYS.slice().sort(),
    '用戶端與接收端的欄位白名單已漂移：改了 telemetry-fields.js 就要重新產生 worker 的清單',
  );

  const maxMatch = source.match(/MAX_COUNTER_VALUE\s*=\s*(\d+)/);
  assert.ok(maxMatch, 'worker 缺少 MAX_COUNTER_VALUE');
  assert.strictEqual(Number(maxMatch[1]), fields.MAX_COUNTER_VALUE, '計數上限兩邊必須一致');
}

/**
 * fields.LYRIC_SOURCES 曾經是憑空寫的清單，跟 lyrics-engine.js 實際的來源優先序
 * 不同步（誤含不存在的 'musixmatch'／'local'／'manual'，把 'qqmusic' 誤寫成
 * 'qq'）——接呼叫端時才發現。這裡把兩邊釘在一起，同類錯誤之後會直接紅燈，
 * 不必等到真的接呼叫端才發現欄位送不出去。
 */
function testLyricSourcesMatchEngine() {
  const { LYRICS_SOURCE_PRIORITY } = require('../server/services/lyrics-engine');
  assert.deepStrictEqual(
    fields.LYRIC_SOURCES.slice().sort(),
    LYRICS_SOURCE_PRIORITY.slice().sort(),
    'telemetry-fields.js 的 LYRIC_SOURCES 必須與 lyrics-engine.js 的 LYRICS_SOURCE_PRIORITY 逐字一致',
  );
}

async function testAggregation() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-daily-'));
  const requests = [];
  const clock = { value: new Date('2026-08-19T12:00:00.000Z') };
  const telemetry = makeTelemetry(dir, requests, clock);

  // 啟動：只送 startup，pending 是空的不應多送任何東西
  await telemetry.start();
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].payload.event, 'startup');

  // 當日第一筆計數會立刻送出（避免「開一次就沒再開」的使用者整天資料歸零）
  telemetry.recordIncident('obs_display_disconnect');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(requests.length, 2, '當日第一筆計數應立刻送出');

  const daily = requests[1].payload;
  assert.deepStrictEqual(
    Object.keys(daily).sort(),
    ['appVersion', 'counters', 'dailyId', 'day', 'monthlyId', 'schemaVersion', 'weeklyId'],
    'payload 只能有這七個欄位',
  );
  assert.strictEqual(daily.schemaVersion, 2);
  assert.strictEqual(daily.day, '2026-08-19');
  assert.strictEqual(requests[1].url, 'https://usage.example.test/api/v1/usage/daily');
  assert.deepStrictEqual(daily.counters, { 'incident.obs_display_disconnect': 1 });

  // 30 分鐘內的後續計數只累積在本機，不再重送。同一支「事故」旗標在同一天
  // 重複發生只該維持 1（布林語意，EULA §7.9(d) 講的是「是否發生」不是次數）；
  // 用 recordOutcome 測真正該累加的計數（family attempt/ok，EULA 講的是「次數」）
  // 才不會兩種語意混在一起測。
  //
  // 呼叫之間刻意插 await：record() 觸發的 flush 是「非同步函式同步跑到第一個
  // await 前」，若兩個不同 record 呼叫緊接在同一個 tick，前一個呼叫觸發的
  // flush 可能會在後一個呼叫寫入 pending 之前，就已經把 payload 組好送出——
  // 這在真實情境下（不同事件通常來自不同 tick）不構成問題，但寫測試時兩行
  // 緊鄰確實會踩到，這裡用 await 還原成真實情境的時間間隔。
  clock.value = new Date('2026-08-19T12:05:00.000Z');
  telemetry.recordIncident('obs_display_disconnect');
  await new Promise((resolve) => setImmediate(resolve));
  telemetry.recordFeature('twitch_request');
  await new Promise((resolve) => setImmediate(resolve));
  telemetry.recordOutcome('import', true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(requests.length, 2, '未關帳的當日彙總在節流視窗內不應重送');

  // 超過節流視窗後補送
  clock.value = new Date('2026-08-19T12:40:00.000Z');
  telemetry.recordFeature('media_library');
  await new Promise((resolve) => setImmediate(resolve));
  telemetry.recordOutcome('import', true);
  // 最後強制 flush 一次，確保這裡量到的是所有呼叫都真正落地後的最終快照，
  // 不受個別呼叫各自觸發之 flush 的時間點影響。
  await telemetry.flushPending({ force: true });
  const finalSent = requests.at(-1).payload.counters;
  assert.deepStrictEqual(finalSent, {
    'incident.obs_display_disconnect': 1, // 布林：重複發生不累加
    'feature.twitch_request': 1,
    'feature.media_library': 1,
    'import.attempt': 2, // 計數：兩次 recordOutcome 真的累加
    'import.ok': 2,
  }, '布林旗標保持 1、真正的計數欄位才累加，送出的都是當日累計值（接收端是覆蓋寫入）');

  // 跨日：舊的那一格關帳、送出後從 pending 移除
  const beforeCrossDay = requests.length;
  clock.value = new Date('2026-08-20T09:00:00.000Z');
  telemetry.recordFeature('obs_setlist');
  await new Promise((resolve) => setImmediate(resolve));
  const days = requests.slice(beforeCrossDay).map((entry) => entry.payload.day);
  assert.ok(days.includes('2026-08-19'), '跨日後應補送前一天的彙總');
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'usage-telemetry.json'), 'utf8'));
  assert.ok(!Object.keys(persisted.pending).some((key) => key.startsWith('2026-08-19')),
    '已送出的關帳彙總應從 pending 移除');

  // 未登錄的東西一律拒絕，不記錄也不送出
  assert.strictEqual(telemetry.recordFeature('不存在的功能'), false);
  assert.strictEqual(telemetry.recordIncident('../../etc/passwd'), false);
  assert.strictEqual(telemetry.recordLyricSource('mystery_source', true), false);
  assert.strictEqual(telemetry.recordDependency('python', true), false);

  // 錯誤碼消毒的端到端驗證：夾帶路徑與網址的錯誤只會變成 other
  requests.length = 0;
  clock.value = new Date('2026-08-20T10:00:00.000Z');
  telemetry.recordOutcome('import', false, 'C:\\Users\\thad\\歌.mp3 https://youtu.be/xyz');
  await new Promise((resolve) => setImmediate(resolve));
  const serialised = JSON.stringify(requests);
  assert.ok(serialised.includes('import.fail.other'));
  assert.ok(!serialised.includes('youtu.be'), '絕不可送出網址');
  assert.ok(!serialised.includes('Users'), '絕不可送出檔案路徑');
  assert.ok(!/\.mp3/.test(serialised), '絕不可送出檔名');

  // AI 分離：硬體只送分桶，精確型號與秒數不得外流
  requests.length = 0;
  clock.value = new Date('2026-08-20T11:00:00.000Z');
  telemetry.recordAiSeparation({
    backend: 'webgpu',
    gpuVendor: 'amd',
    vramMb: 8192,
    realtimeFactor: 0.22,
    audioSeconds: 253,
    ok: false,
    code: 'oom',
    fellBackToCpu: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const aiCounters = requests[requests.length - 1].payload.counters;
  assert.strictEqual(aiCounters['ai.backend.webgpu'], 1);
  assert.strictEqual(aiCounters['ai.gpu.amd'], 1);
  assert.strictEqual(aiCounters['ai.vram.ge8g'], 1);
  assert.strictEqual(aiCounters['ai.rtf.0.1-0.3x'], 1);
  assert.strictEqual(aiCounters['ai.duration.3-6m'], 1);
  assert.strictEqual(aiCounters['ai.fallback_to_cpu'], 1);
  assert.strictEqual(aiCounters['ai.fail.oom'], 1);
  const aiSerialised = JSON.stringify(requests);
  assert.ok(!aiSerialised.includes('8192'), 'VRAM 只能送區間');
  assert.ok(!aiSerialised.includes('253'), '音訊長度只能送區間');

  // 關閉統計：連同尚未送出的彙總一併丟棄，不可留在磁碟等下次開啟才送
  telemetry.recordFeature('pitch_shift');
  telemetry.setEnabled(false);
  const afterDisable = JSON.parse(fs.readFileSync(path.join(dir, 'usage-telemetry.json'), 'utf8'));
  assert.strictEqual(afterDisable.localSecret, null);
  assert.deepStrictEqual(afterDisable.pending, {}, '關閉時必須清空待送彙總');
  requests.length = 0;
  telemetry.recordIncident('player_error');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(requests.length, 0, '關閉後不得再送出任何東西');

  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * AI 分離的 fallback 鏈遙測必須連貫：一次分離試過 Python CUDA → WebGPU → CPU，
 * 最後在 CPU 成功，接收端要看得到「三個後端都試過、有 fallback、整體成功」，
 * 而且 attempt 只加一次（不是三次，否則成功率分母會被灌水）。
 * 迴歸的是修好前的 bug：只有 WebGPU 那條路在送遙測、`fellBackToCpu` 永遠是 false。
 */
async function testAiSeparationFallbackTrace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-daily-ai-trace-'));
  const requests = [];
  const clock = { value: new Date('2026-08-27T09:00:00.000Z') };
  const telemetry = makeTelemetry(dir, requests, clock);

  // 情境 A：CUDA 失敗 → WebGPU 失敗 → CPU 成功（協調器 recordJobTelemetry 的一次呼叫）
  telemetry.recordAiSeparation({
    attemptedBackends: ['cuda', 'webgpu', 'cpu'],
    backend: 'cpu',
    gpuVendor: 'unknown',
    ok: true,
    fellBackToCpu: true,
    retried: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await telemetry.flushPending({ force: true });
  let counters = requests[requests.length - 1].payload.counters;
  assert.strictEqual(counters['ai.backend.cuda'], 1, 'CUDA 有被嘗試過');
  assert.strictEqual(counters['ai.backend.webgpu'], 1, 'WebGPU 有被嘗試過');
  assert.strictEqual(counters['ai.backend.cpu'], 1, 'CPU 有被嘗試過');
  assert.strictEqual(counters['ai.fallback_to_cpu'], 1, '有 fallback 到 CPU');
  assert.strictEqual(counters['ai.retried'], 1, '曾在同一後端重試（EULA §7.9(f) 1.8.0）');
  assert.strictEqual(counters['ai.ok'], 1, '整體算成功');
  assert.strictEqual(counters['ai.attempt'], 1, '一次分離只加一次 attempt，不是三次');
  assert.ok(!Object.keys(counters).some((k) => k.startsWith('ai.fail.')), '成功的分離不得留下任何 ai.fail.*');

  // 情境 B（同一天）：WebGPU 單獨終態失敗——attempt 累加到 2、多一筆 device_lost 失敗
  clock.value = new Date('2026-08-27T09:20:00.000Z');
  telemetry.recordAiSeparation({
    attemptedBackends: ['webgpu'],
    backend: 'webgpu',
    gpuVendor: 'amd',
    ok: false,
    code: 'device_lost',
  });
  await new Promise((resolve) => setImmediate(resolve));
  await telemetry.flushPending({ force: true });
  counters = requests[requests.length - 1].payload.counters;
  assert.strictEqual(counters['ai.attempt'], 2, '第二次分離讓 attempt 變 2');
  assert.strictEqual(counters['ai.fail.device_lost'], 1, 'device lost 記進封閉錯誤分類');
  assert.strictEqual(counters['ai.gpu.amd'], 1, 'GPU 廠牌照分桶記');
  assert.strictEqual(counters['ai.backend.webgpu'], 1, '當日布林維持 1，不因再次記錄而累加');
  // 這次沒帶 retried，且 ai.retried 是當日布林——維持在情境 A 設下的 1，不會再累加
  assert.strictEqual(counters['ai.retried'], 1, 'ai.retried 是當日布林，維持 1');

  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * socket 重連次數的語意是「今天累計到目前為止落在哪一桶」，不是「這個桶
 * 發生了幾次」——累計數跨過門檻時，舊桶必須被清掉，同一天不能有兩個桶
 * 同時是真的（那樣會無法判讀「今天到底重連了多嚴重」）。
 */
async function testSocketReconnectBucketSwitching() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-daily-reconnect-'));
  const requests = [];
  const clock = { value: new Date('2026-08-19T12:00:00.000Z') };
  const telemetry = makeTelemetry(dir, requests, clock);

  // persistSoon() 有 5 秒防抖：同一個 clock 值連續呼叫，第二次以後不會真的
  // 寫檔。每步都把時鐘往前推一點，才量得到「這次呼叫之後」磁碟上的真實狀態。
  telemetry.recordSocketReconnects(1); // 1 次 → 桶 '1-2'
  await new Promise((resolve) => setImmediate(resolve));
  let persisted = JSON.parse(fs.readFileSync(path.join(dir, 'usage-telemetry.json'), 'utf8'));
  let counters = persisted.pending['2026-08-19#1.0.0'].counters;
  assert.deepStrictEqual(counters, { 'incident.socket_reconnect.1-2': 1 });

  clock.value = new Date(clock.value.getTime() + 6000);
  telemetry.recordSocketReconnects(7); // 累計到 7 次 → 換桶 '3-10'，'1-2' 要被清掉
  await new Promise((resolve) => setImmediate(resolve));
  persisted = JSON.parse(fs.readFileSync(path.join(dir, 'usage-telemetry.json'), 'utf8'));
  counters = persisted.pending['2026-08-19#1.0.0'].counters;
  assert.deepStrictEqual(counters, { 'incident.socket_reconnect.3-10': 1 },
    '跨桶時舊桶必須被清掉，不能同時有兩個桶都是 1: ');

  clock.value = new Date(clock.value.getTime() + 6000);
  telemetry.recordSocketReconnects(9); // 還在同一桶，重複呼叫不該產生變化
  await new Promise((resolve) => setImmediate(resolve));
  persisted = JSON.parse(fs.readFileSync(path.join(dir, 'usage-telemetry.json'), 'utf8'));
  counters = persisted.pending['2026-08-19#1.0.0'].counters;
  assert.deepStrictEqual(counters, { 'incident.socket_reconnect.3-10': 1 });

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testTamperedStateIsSanitised() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-daily-tamper-'));
  const requests = [];
  const clock = { value: new Date('2026-08-21T08:00:00.000Z') };

  // 磁碟上的 state 是可被竄改的。載入時就要過白名單，不能等送出前才驗。
  fs.writeFileSync(path.join(dir, 'usage-telemetry.json'), JSON.stringify({
    schemaVersion: 1,
    enabled: true,
    localSecret: '07'.repeat(32),
    coreUseAttemptDay: null,
    pending: {
      '2026-08-20#1.0.0': {
        counters: {
          'incident.player_error': 3,
          'evil.exfiltrate': 9,
          'feature.media_library': -5,
          'import.fail.other': 999999999,
        },
        sentAt: 0,
      },
      'not-a-bucket-key': { counters: { 'incident.player_error': 1 } },
      '2026-08-20#../../evil': { counters: { 'incident.player_error': 1 } },
    },
  }), 'utf8');

  const telemetry = makeTelemetry(dir, requests, clock);
  await telemetry.flushPending({ force: true });

  assert.strictEqual(requests.length, 1, '只有合法的那一格會被送出');
  const counters = requests[0].payload.counters;
  assert.deepStrictEqual(Object.keys(counters).sort(), ['import.fail.other', 'incident.player_error']);
  assert.strictEqual(counters['incident.player_error'], 3);
  assert.strictEqual(counters['import.fail.other'], fields.MAX_COUNTER_VALUE, '超出上限應被夾到上限');
  assert.ok(!JSON.stringify(requests).includes('evil'), '未登錄的 key 必須被丟棄');

  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * 未揭露就不可能被蒐集——這是程式層保證，不是流程紀律。
 * 使用者同意的 EULA 版本低於揭露版本時，一個位元組都不該送出。
 */
async function testUndisclosedEulaCollectsNothing() {
  const clock = { value: new Date('2026-08-19T12:00:00.000Z') };
  // 1.7.0：§7.10 更新服務已揭露，但 §7.9 日彙總的 (f) 欄位在 1.8.0 才擴充，
  // 所以整個日彙總在 1.7.0 仍一律空轉——「還沒揭露就不可能被蒐集」是程式層保證。
  for (const undisclosed of ['1.5.0', '1.7.0']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-daily-gate-'));
    const requests = [];
    eulaVersion.value = undisclosed;
    try {
      const telemetry = makeTelemetry(dir, requests, clock);
      assert.strictEqual(telemetry.dailyDisclosed(), false, `${undisclosed} 不得視為已揭露`);
      assert.strictEqual(telemetry.recordIncident('player_error'), false);
      assert.strictEqual(telemetry.recordFeature('media_library'), false);
      telemetry.recordAiSeparation({ backend: 'cuda', ok: true, retried: true });
      await telemetry.flushPending({ force: true });
      await new Promise((resolve) => setImmediate(resolve));
      assert.strictEqual(requests.length, 0, `EULA ${undisclosed} 時不得送出任何日彙總`);
      const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'usage-telemetry.json'), 'utf8'));
      assert.deepStrictEqual(persisted.pending, {}, '也不該把資料累積在本機等日後補送');
    } finally {
      eulaVersion.value = '1.8.0';
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function run() {
  testRegistry();
  await testUndisclosedEulaCollectsNothing();
  testWorkerWhitelistMatches();
  testLyricSourcesMatchEngine();
  await testAggregation();
  await testAiSeparationFallbackTrace();
  await testSocketReconnectBucketSwitching();
  await testTamperedStateIsSanitised();
  console.log('telemetry-daily tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
