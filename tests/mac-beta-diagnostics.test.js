'use strict';

// Mac 內測版診斷回報：只在「darwin + Mac 內測版 + 匿名統計開著 + 看過告知」時才送，
// 送出的只有白名單欄位、沒有任何自由文字或路徑；Windows／正式版完全不受影響。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fields = require('../server/services/mac-beta-diag-fields');
const {
  createMacBetaDiagnostics, classifyFfmpegDownloadError, classifyYtdlpUpdate, classifySeparationInstallError, classifyPracticeBlock,
} = require('../server/services/mac-beta-diagnostics');

const ENDPOINT = 'https://diag.example.test/api/v1/diag';

function harness(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-beta-diag-'));
  const calls = [];
  const usage = { enabled: true, eulaAccepted: true, ...(overrides.usage || {}) };
  const diag = createMacBetaDiagnostics({
    platform: 'darwin',
    arch: 'arm64',
    packageJson: { elitesandMacBeta: { build: 'beta.7' } },
    config: { macBetaDiagEndpoint: ENDPOINT },
    dataDir,
    fetch: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return { ok: true, status: 202 }; },
    usageSettings: () => usage,
    appVersion: '1.3.0',
    userAgent: 'test',
    env: { ELITESAND_YTDLP_NODE_PATH: '' },
    execFile: (command, _args, _opts, cb) => cb(null, command === 'sw_vers' ? '15.2\n' : '0\n'),
    os: { release: () => '24.2.0', cpus: () => [{ model: 'Apple M2' }], totalmem: () => 16 * 1024 ** 3 },
    setTimeout: () => ({ unref() {} }),
    ...overrides,
  });
  return { diag, calls, usage, dataDir };
}

async function ackAndFlush(h) {
  h.diag.acknowledgeNotice(new Date('2026-11-26T00:00:00Z'));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await h.diag.flush();
}

/** 遞迴檢查：所有字串值都只能是代碼樣式，不可能是訊息、路徑或歌名 */
function assertNoFreeText(value, where = 'payload') {
  if (typeof value === 'string') {
    assert.match(value, /^[A-Za-z0-9_.+-]{1,40}$/, `${where} 帶了不像代碼的字串：${value}`);
    assert.ok(!value.includes('/') && !value.includes('\\'), `${where} 帶了路徑`);
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, i) => assertNoFreeText(item, `${where}[${i}]`)); return; }
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) assertNoFreeText(item, `${where}.${key}`);
}

test('非 darwin（Windows／Linux）：不是 Mac 內測版、不送、也不包既有的統計函式', async () => {
  for (const platform of ['win32', 'linux']) {
    const h = harness({ platform });
    assert.equal(h.diag.isMacBeta(), false);
    assert.deepEqual(h.diag.getStatus(), { macBeta: false, available: false, noticeRequired: false, collecting: false });
    await ackAndFlush(h);
    assert.equal(h.diag.milestone('playback_start'), false);
    await h.diag.flush();
    assert.equal(h.calls.length, 0);
    const usageTelemetry = { recordOutcome() {}, recordFeature() {}, recordIncident() {}, recordDependency() {} };
    const before = { ...usageTelemetry };
    assert.equal(h.diag.attachToUsageTelemetry(usageTelemetry), false);
    assert.deepEqual(usageTelemetry, before, '非 Mac 內測版不可以替換任何函式');
    assert.equal(fs.existsSync(path.join(h.dataDir, 'mac-beta-diag.json')), false, '連本機狀態檔都不該建立');
  }
});

test('darwin 但不是內測版（沒有 elitesandMacBeta 旗標）：完全不動作', async () => {
  const h = harness({ packageJson: { version: '1.3.0' } });
  assert.equal(h.diag.isMacBeta(), false);
  await ackAndFlush(h);
  assert.equal(h.calls.length, 0);
});

test('端點是空值：功能停用，連告知都不顯示', async () => {
  const h = harness({ config: { macBetaDiagEndpoint: '' } });
  assert.equal(h.diag.isMacBeta(), true);
  assert.equal(h.diag.getStatus().noticeRequired, false);
  await ackAndFlush(h);
  assert.equal(h.calls.length, 0);
});

test('還沒按「知道了」：要求顯示告知，但不送任何東西', async () => {
  const h = harness();
  assert.deepEqual(h.diag.getStatus(), { macBeta: true, available: true, noticeRequired: true, collecting: false });
  assert.equal(h.diag.milestone('playback_start'), false);
  assert.deepEqual((await h.diag.start()), { skipped: true });
  await h.diag.flush();
  assert.equal(h.calls.length, 0);
});

test('匿名統計開關關閉或 EULA 未同意：不送，並丟掉安裝代碼', async () => {
  const h = harness();
  await ackAndFlush(h);
  assert.equal(h.calls.length, 1);
  const firstId = h.calls[0].body.installId;
  h.usage.enabled = false;
  assert.equal(h.diag.milestone('playback_start'), false);
  await h.diag.flush();
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'mac-beta-diag.json'), 'utf8')).installId, null);
  assert.equal(h.diag.getStatus().noticeRequired, false);

  const h2 = harness({ usage: { enabled: true, eulaAccepted: false } });
  await ackAndFlush(h2);
  assert.equal(h2.calls.length, 0);
  assert.match(firstId, /^[a-f0-9]{32}$/);
});

test('條件全部成立：送出的 payload 只含白名單欄位，沒有自由文字或路徑', async () => {
  const h = harness();
  await ackAndFlush(h);
  h.diag.milestone('youtube_import', 'ytdlp_http_403');
  h.diag.milestone('mic_permission', 'denied');
  h.diag.gpu({ api: true, adapter: true, shaderF16: true, vendor: 'Apple M2 Pro (/Library/whatever)' });
  const err = new Error('ENOENT: no such file, open /Users/tester/Music/我的歌.mp3');
  err.code = 'ENOENT';
  err.stack = `Error: ${err.message}\n    at Object.openSync (node:fs:573:3)\n    at run (/Applications/Elitesand Pro.app/Contents/Resources/app.asar/server/services/audio-processor.js:10:5)`;
  h.diag.reportError('uncaught', err);
  // 不在白名單裡的名稱或代碼直接丟掉
  assert.equal(h.diag.milestone('youtube_import', 'Video "My Song" unavailable'), false);
  assert.equal(h.diag.component('ffmpeg_source', '/opt/homebrew/bin/ffmpeg'), false);
  await h.diag.flush();

  assert.equal(h.calls.length, 2);
  for (const call of h.calls) {
    assert.equal(call.url, ENDPOINT);
    assert.equal(call.options.method, 'POST');
    assert.ok(Buffer.byteLength(call.options.body) <= fields.MAX_BODY_BYTES);
    assert.equal(fields.validPayload(call.body), true);
    assertNoFreeText(call.body);
    assert.ok(!call.options.body.includes('Users') && !call.options.body.includes('我的歌') && !call.options.body.includes('M2 Pro'));
  }
  const events = h.calls.flatMap((call) => call.body.events);
  assert.deepEqual(events.find((e) => e.type === 'launch'),
    { type: 'launch', osMajor: 15, arch: 'arm64', chip: 'apple', memTier: '16', rosetta: false, count: 1 });
  assert.deepEqual(events.find((e) => e.type === 'gpu'), { type: 'gpu', api: true, adapter: true, shaderF16: true, vendor: 'apple' });
  assert.deepEqual(events.find((e) => e.type === 'error'), { type: 'error', kind: 'uncaught', code: 'ENOENT', module: 'audio-processor' });
  assert.ok(events.some((e) => e.type === 'component' && e.name === 'ffmpeg_source'));
  assert.ok(events.some((e) => e.type === 'component' && e.name === 'bundled_node' && e.code === 'missing'));
  assert.equal(h.calls[0].body.build, 'beta.7');
});

test('里程碑每次啟動同一種只回報一次，累計次數跨啟動保留；安裝代碼不輪替', async () => {
  const h = harness();
  await ackAndFlush(h);
  h.diag.milestone('playback_start');
  h.diag.milestone('playback_start');
  h.diag.milestone('playback_start');
  await h.diag.flush();
  const sent = h.calls.flatMap((c) => c.body.events).filter((e) => e.name === 'playback_start');
  assert.equal(sent.length, 1);

  const again = harness({ dataDir: h.dataDir });
  again.calls = h.calls;
  const next = createMacBetaDiagnostics({
    platform: 'darwin', arch: 'arm64', packageJson: { elitesandMacBeta: { build: 'beta.7' } },
    config: { macBetaDiagEndpoint: ENDPOINT }, dataDir: h.dataDir,
    fetch: async (url, options) => { h.calls.push({ body: JSON.parse(options.body) }); return { ok: true, status: 202 }; },
    usageSettings: () => ({ enabled: true, eulaAccepted: true }), appVersion: '1.3.0', userAgent: 'test', env: {},
    execFile: (c, a, o, cb) => cb(null, '15.2'), os: { release: () => '24', cpus: () => [], totalmem: () => 8 * 1024 ** 3 },
    setTimeout: () => ({ unref() {} }),
  });
  assert.equal(next.getStatus().noticeRequired, false, '告知只顯示一次');
  next.milestone('playback_start');
  await next.flush();
  const last = h.calls[h.calls.length - 1].body;
  assert.equal(last.installId, h.calls[0].body.installId);
  assert.equal(last.events.find((e) => e.name === 'playback_start').count, 4);
});

test('送出失敗安靜丟棄，不重試、不寫進磁碟', async () => {
  let attempts = 0;
  const h = harness({ fetch: async () => { attempts += 1; throw new Error('offline'); } });
  await ackAndFlush(h);
  assert.equal(attempts, 1);
  assert.deepEqual(h.diag._queue(), []);
  const saved = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'mac-beta-diag.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['counts', 'installId', 'noticeAckAt', 'noticeVersion', 'schemaVersion']);
});

test('Intel／Rosetta 與記憶體級距', async () => {
  const h = harness({ arch: 'x64', execFile: (c, a, o, cb) => cb(null, c === 'sysctl' ? '1\n' : '14.6\n'),
    os: { release: () => '23.6.0', cpus: () => [{ model: 'VirtualApple' }], totalmem: () => 36 * 1024 ** 3 } });
  await ackAndFlush(h);
  const launch = h.calls[0].body.events.find((e) => e.type === 'launch');
  assert.deepEqual(launch, { type: 'launch', osMajor: 14, arch: 'x64', chip: 'apple', memTier: '48', rosetta: true, count: 1 });
  const intel = harness({ arch: 'x64', execFile: (c, a, o, cb) => cb(new Error('no')),
    os: { release: () => '22.1.0', cpus: () => [{ model: 'Intel(R) Core(TM) i7' }], totalmem: () => 8 * 1024 ** 3 } });
  await ackAndFlush(intel);
  assert.deepEqual(intel.calls[0].body.events.find((e) => e.type === 'launch'),
    { type: 'launch', osMajor: 13, arch: 'x64', chip: 'intel', memTier: '8', rosetta: false, count: 1 });
  assert.deepEqual(['8', '16', '24', '32', '48', '64+'], [4, 16, 24, 32, 48, 128].map((gb) => fields.memTier(gb * 1024 ** 3)));
});

test('Mac 內測版才包住既有統計，原本的函式照常被呼叫', async () => {
  const h = harness();
  await ackAndFlush(h);
  const seen = [];
  const usageTelemetry = {
    recordOutcome: (...args) => { seen.push(['outcome', ...args]); return 'o'; },
    recordFeature: (...args) => { seen.push(['feature', ...args]); return 'f'; },
    recordIncident: (...args) => { seen.push(['incident', ...args]); return 'i'; },
    recordDependency: (...args) => { seen.push(['dep', ...args]); return 'd'; },
  };
  assert.equal(h.diag.attachToUsageTelemetry(usageTelemetry), true);
  assert.equal(usageTelemetry.recordOutcome('import', false, 'YTDLP_HTTP_403'), 'o');
  assert.equal(usageTelemetry.recordFeature('obs_display'), 'f');
  assert.equal(usageTelemetry.recordIncident('player_error'), 'i');
  assert.equal(usageTelemetry.recordDependency('ytdlp', true), 'd');
  assert.equal(seen.length, 4);
  await h.diag.flush();
  const events = h.calls.flatMap((c) => c.body.events);
  assert.ok(events.some((e) => e.name === 'youtube_import' && e.code === 'ytdlp_http_403'));
  assert.ok(events.some((e) => e.name === 'obs_display_loaded'));
  assert.ok(events.some((e) => e.type === 'error' && e.kind === 'incident' && e.code === 'player_error'));
  assert.ok(events.some((e) => e.name === 'ytdlp_available' && e.code === 'ok'));
});

test('分類工具只輸出白名單代碼', () => {
  assert.equal(classifyFfmpegDownloadError(new Error('SHA-256 驗證失敗')), 'verify_failed');
  assert.equal(classifyFfmpegDownloadError(Object.assign(new Error('x'), { ffmpegStage: 'system-check' })), 'system_check');
  assert.equal(classifyYtdlpUpdate({ ok: true, message: '已是最新 Nightly 版本' }), 'up_to_date');
  assert.equal(classifyYtdlpUpdate({ ok: false, message: '更新失敗：Signed yt-dlp SHA-256 differs from release metadata' }), 'signature_failed');
  assert.equal(classifySeparationInstallError(new Error('目前只支援 Windows 的自動下載。')), 'unsupported_platform');
  assert.equal(classifySeparationInstallError(Object.assign(new Error('x'), { code: 'CANCELLED' })), 'cancelled');
  assert.equal(classifyPracticeBlock('PRACTICE_VOCALS_REQUIRED'), 'vocals_required');
  assert.equal(classifyPracticeBlock('SOMETHING_NEW'), 'other');
  for (const code of [classifyFfmpegDownloadError(new Error('?')), classifyYtdlpUpdate(null)]) assert.ok(/^[a-z_]+$/.test(code));
});

test('用戶端白名單與 Worker 的驗證一致（Worker 原始碼只在私有倉）', async (t) => {
  const workerValidation = path.join(__dirname, '..', 'cloudflare', 'mac-beta-diag-worker', 'src', 'validation.ts');
  if (!fs.existsSync(workerValidation)) { t.skip('公開倉沒有 cloudflare/'); return; }
  const worker = await import(require('url').pathToFileURL(workerValidation).href);
  assert.equal(worker.SCHEMA_VERSION, fields.SCHEMA_VERSION);
  assert.equal(worker.MAX_EVENTS_PER_BATCH, fields.MAX_EVENTS_PER_BATCH);
  assert.equal(worker.MAX_BODY_BYTES, fields.MAX_BODY_BYTES);
  for (const name of ['ARCHES', 'CHIPS', 'MEM_TIERS', 'GPU_VENDORS', 'ERROR_KINDS']) assert.deepEqual([...worker[name]], [...fields[name]], name);
  for (const name of ['COMPONENTS', 'MILESTONES', 'EVENT_KEYS']) {
    assert.deepEqual(JSON.parse(JSON.stringify(worker[name])), JSON.parse(JSON.stringify(fields[name])), name);
  }
  const h = harness();
  await ackAndFlush(h);
  h.diag.gpu({ api: false });
  for (const [name, codes] of Object.entries(fields.MILESTONES)) for (const code of codes) h.diag.milestone(name, code);
  for (let i = 0; i < 8; i += 1) await h.diag.flush();
  assert.ok(h.calls.length >= 2);
  for (const call of h.calls) assert.equal(worker.validatePayload(call.body).ok, true);
});

test('分離與練唱音高線的診斷：只送類別與級距，並通過白名單', async () => {
  const h = harness();
  await ackAndFlush(h);
  h.diag.milestone('separation_precheck', 'ok');
  h.diag.milestone('separation_start');
  h.diag.component('runtime_install', 'hash_mismatch');
  h.diag.component('python_exec', 'ok');
  h.diag.separation({ ok: true, finalBackend: 'cpu', attempts: ['mps', 'cpu'], startedAt: Date.now() - 90000, audioSeconds: 200 });
  h.diag.separation({ ok: false, code: 'GPU_OOM', finalBackend: 'mps', attempts: ['mps'], startedAt: Date.now(), audioSeconds: 30 });
  h.diag.pitchGuide({ ok: true, algorithm: 'yin-cpu', elapsedMs: 12000 });
  h.diag.pitchGuide({ ok: false, code: 'PRACTICE_RUNTIME_MISSING', elapsedMs: 100 });
  await h.diag.flush();
  const events = h.calls.flatMap((c) => c.body.events);
  for (const call of h.calls) { assert.equal(fields.validPayload(call.body), true); assertNoFreeText(call.body); }
  assert.deepEqual(events.filter((e) => e.type === 'separation'), [
    { type: 'separation', result: 'ok', device: 'cpu', cpuFallback: true, lengthTier: '3-5m', speedTier: '0.25-0.5', deviceLost: false },
    { type: 'separation', result: 'oom', device: 'mps', cpuFallback: false, lengthTier: 'lt1m', speedTier: 'unknown', deviceLost: false },
  ]);
  assert.deepEqual(events.filter((e) => e.type === 'pitch_guide'), [
    { type: 'pitch_guide', result: 'ok', algorithm: 'yin', timeTier: '10-30s' },
    { type: 'pitch_guide', result: 'python_missing', algorithm: 'none', timeTier: 'lt10s' },
  ]);
  assert.ok(events.some((e) => e.name === 'runtime_install' && e.code === 'hash_mismatch'));
});

test('告知改版後，按過舊版的人要再看一次', () => {
  const h = harness();
  fs.writeFileSync(path.join(h.dataDir, 'mac-beta-diag.json'), JSON.stringify({ schemaVersion: 1, installId: 'a'.repeat(32), noticeAckAt: '2026-11-01T00:00:00Z', counts: {} }));
  assert.equal(h.diag.getStatus().noticeRequired, true);
});
