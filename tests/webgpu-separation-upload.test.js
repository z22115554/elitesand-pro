'use strict';

// WebGPU 分離結果上傳端點（POST /api/webgpu-separation/result/:jobId）的回歸測試。
// 涵蓋 2026-09 把 multer memoryStorage + fs.writeFileSync 改成 disk-backed 暫存 +
// async 落地（見 server/routes/api.js ~1311 行起、server/services/webgpu-separation-jobs.js
// ~68-79、261 行起的改動）之後最容易破的幾件事：
//   - requireLocalEngineJob 仍排在 multer 之前（LAN DoS 防線）
//   - 所有結束路徑（成功／寫檔失敗／job 已被取消或逾時）都清得掉 downloads/.tmp 暫存檔
//   - 最終檔案落在 downloadsDir 根層，不留在 .tmp 子目錄
//   - 寫檔失敗時既有 applyResult(...separationStatus:'failed') / separation:progress
//     error 事件、deferFailure 分支都還在
//   - 超大檔案仍被 multer 的 fileSize 限制擋下
//
// 必須在載入任何 server 模組前隔離資料夾，測試不可寫進正式 data/downloads/logs。
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-webgpu-upload-'));
process.env.ELITESAND_DATA_DIR = path.join(TEST_ROOT, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(TEST_ROOT, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(TEST_ROOT, 'logs');

const express = require('express');
const multer = require('multer');
const { downloadsDir } = require('../server/utils/app-paths');
const apiRouter = require('../server/routes/api');
const webgpuSeparationJobs = require('../server/services/webgpu-separation-jobs');

const webgpuTmpDir = path.join(downloadsDir, '.tmp');

// 正式環境裡是 ai-separation-jobs.js（協調器）訂閱 webgpuSeparationJobs.events 的
// 'error'／'result'／'progress'，我們的測試不需要那層協調邏輯，但 Node 的
// EventEmitter 對沒有監聽者的 'error' event 預設會直接 throw，所以要接一個
// no-op listener，不然 finishJobWithResult 內部 events.emit('error', ...) 會讓
// 整支測試崩潰（這不是我們要測的行為，只是 EventEmitter 的內建保護）。
webgpuSeparationJobs.events.on('error', () => {});

// 直接從 router 內部撈出這條路由的三個 middleware（跟 tests/pin-first-setup.test.js
// 找 auth router handler 的手法一樣）：requireLocalEngineJob 必須在 multer 之前，
// 若有人把順序調換，這裡撈出來的 layer 名稱/位置就會變，測試會直接告訴我們。
const routeLayer = apiRouter.stack.find(
  (l) => l.route && l.route.path === '/webgpu-separation/result/:jobId' && l.route.methods.post
);
assert.ok(routeLayer, '找不到 POST /webgpu-separation/result/:jobId route');
assert.strictEqual(routeLayer.route.stack.length, 3, '預期正好是 requireLocalEngineJob → multer → handler 三層');
const [requireLocalEngineJobHandler, multerMiddleware, resultHandler] = routeLayer.route.stack.map((l) => l.handle);
assert.strictEqual(requireLocalEngineJobHandler.name, 'requireLocalEngineJob', 'requireLocalEngineJob 必須是第一層（multer 之前）');
assert.strictEqual(multerMiddleware.name, 'multerMiddleware', 'multer 必須是第二層');

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  OK ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}\n    ${error.stack || error.message}`);
  }
}

function fakeRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function makeCtx(track) {
  const playState = { playlist: track ? [track] : [], currentTrack: null };
  return {
    io: { emit() {} },
    playState,
    persistState() {},
    broadcastState() {},
  };
}

// 每次都先 _resetForTests() 再 wireDependencies + 接一個假的 engine socket，
// 這樣每個測試案例可以用自己獨立的 playState，互不干擾（webgpu-separation-jobs
// 是模組層級的 singleton，wireDependencies 第二次呼叫預設會被擋掉）。
function startJob(ctx, trackId, sourceFilename) {
  webgpuSeparationJobs._resetForTests();
  webgpuSeparationJobs.wireDependencies(ctx);
  webgpuSeparationJobs.handleEngineConnected({ connected: true, id: 'engine-1', emit() {} });
  return webgpuSeparationJobs.startJobForTrack(trackId, { sourceFilename });
}

function writeMinimalWav(filePath) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(44100, 24);
  header.writeUInt32LE(44100 * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(0, 40);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, header);
}

function tmpFilePath(name) {
  return path.join(webgpuTmpDir, name);
}

// ─── 真的起一個 http server 跑完整鏈（requireLocalEngineJob → multer diskStorage →
// handler），用來驗證 multipart 上傳全流程真的接得起來，不是只驗證各段邏輯。───
let server;
let baseUrl;
async function startServer() {
  const app = express();
  app.use('/api', apiRouter);
  // 對齊 server/index.js 的全域錯誤處理（LIMIT_FILE_SIZE → 413）。
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT')) {
      return res.status(413).json({ error: '請求內容超過允許大小' });
    }
    res.status(500).json({ error: err.message });
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

function buildMultipart(fields) {
  const boundary = '----elitesandtest' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  for (const [name, buf] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.wav"\r\nContent-Type: audio/wav\r\n\r\n`
    ));
    parts.push(buf);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

function postMultipart(reqPath, fields) {
  return new Promise((resolve, reject) => {
    const { boundary, body } = buildMultipart(fields);
    const req = http.request(`${baseUrl}${reqPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let payload = null;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* ignore */ }
        resolve({ statusCode: res.statusCode, payload });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function main() {
  await startServer();

  // ── (1) jobId 不符時，在 multipart parser 之前就被擋下 ──
  await test('jobId 對不上 activeJob 時，requireLocalEngineJob 在 multer 之前回 409 STALE_JOB', async () => {
    const ctx = makeCtx({ id: 't-stale', title: 'X' });
    startJob(ctx, 't-stale', 'x.mp3');
    let nextCalled = false;
    const res = fakeRes();
    await requireLocalEngineJobHandler(
      { socket: { remoteAddress: '127.0.0.1' }, params: { jobId: 'not-the-real-job-id' } },
      res,
      () => { nextCalled = true; }
    );
    assert.strictEqual(nextCalled, false, 'multer 不該被呼叫到');
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.payload.error, 'STALE_JOB');
  });

  // ── (1b) runtime-status 帶 jobActive 給 shell.js 的閒置逾時判斷 ──
  // shell.js runWebgpuHealthCheck() 讀這個欄位：有 job 在跑就把閒置時鐘撥回現在、
  // 不關隱藏視窗。少了它 → 恆 false → 視窗會在分離跑到一半被閒置逾時關掉。
  // 刻意跟 getDownloadStatus() 的 active（模型下載中）分開命名，且放在 spread 之後
  // 不被它蓋掉——這正是這條回歸測試要鎖住的兩件事。
  await test('GET /webgpu-separation/runtime-status 的 jobActive 反映目前有沒有 WebGPU 分離 job', async () => {
    const statusLayer = apiRouter.stack.find(
      (l) => l.route && l.route.path === '/webgpu-separation/runtime-status' && l.route.methods.get
    );
    assert.ok(statusLayer, '找不到 GET /webgpu-separation/runtime-status route');
    const statusHandler = statusLayer.route.stack[statusLayer.route.stack.length - 1].handle;
    const callStatus = () => new Promise((resolve) => {
      statusHandler({}, { set() { return this; }, json(payload) { resolve(payload); return this; } });
    });

    webgpuSeparationJobs._resetForTests();
    const idle = await callStatus();
    assert.strictEqual(idle.jobActive, false, '沒有 job 時 jobActive 應為 false');
    assert.notStrictEqual(idle.jobActive, undefined, 'jobActive 欄位必須存在（shell.js 讀它）');
    assert.ok('engineConnected' in idle && 'engineRestartRequestedAt' in idle, '既有欄位不可回歸');
    assert.ok('active' in idle, 'getDownloadStatus() 的 active（模型下載中）仍要在，不能被覆蓋掉');

    const ctx = makeCtx({ id: 't-active', title: 'X' });
    startJob(ctx, 't-active', 'x.mp3');
    const running = await callStatus();
    assert.strictEqual(running.jobActive, true, '有 activeJob 時 jobActive 應為 true');

    webgpuSeparationJobs._resetForTests();
  });

  // ── (2) 非 loopback 來源被擋下 ──
  await test('非 loopback 來源（LAN IP）被 requireLocalEngineJob 擋下，回 403，且先於 jobId 檢查', async () => {
    const ctx = makeCtx({ id: 't-lan', title: 'X' });
    const jobId = startJob(ctx, 't-lan', 'x.mp3');
    let nextCalled = false;
    const res = fakeRes();
    await requireLocalEngineJobHandler(
      { socket: { remoteAddress: '192.168.1.50' }, params: { jobId } }, // jobId 是對的，但來源不是 loopback
      res,
      () => { nextCalled = true; }
    );
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
  });

  // ── (3) 端到端：合法上傳成功，檔案落在 downloadsDir 根層，.tmp 不留孤兒 ──
  await test('端到端：合法 multipart 上傳成功落地在 downloadsDir 根層，.tmp 暫存區清空', async () => {
    const track = { id: 't-ok', title: 'Song A', separationStatus: 'processing' };
    const ctx = makeCtx(track);
    const jobId = startJob(ctx, 't-ok', 'Song A.mp3');

    const vocals = Buffer.alloc(44 + 100);
    Buffer.from('RIFFxxxxWAVEfmt ').copy(vocals); // 用真的 header 蓋掉，下面重寫正確版本
    const vocalsPath = tmpFilePath('vocals-src.wav');
    const instrumentalPath = tmpFilePath('instrumental-src.wav');
    writeMinimalWav(vocalsPath);
    writeMinimalWav(instrumentalPath);

    const { statusCode, payload } = await postMultipart(`/api/webgpu-separation/result/${jobId}`, {
      vocals: fs.readFileSync(vocalsPath),
      instrumental: fs.readFileSync(instrumentalPath),
    });

    assert.strictEqual(statusCode, 200, `預期 200，實際 ${statusCode} (${JSON.stringify(payload)})`);
    assert.deepStrictEqual(payload, { ok: true });

    const rootFiles = fs.existsSync(downloadsDir) ? fs.readdirSync(downloadsDir).filter((f) => f !== '.tmp') : [];
    const vocalsFile = rootFiles.find((f) => /^Song A\.webgpu-\d+\.vocals\.wav$/.test(f));
    const instrumentalFile = rootFiles.find((f) => /^Song A\.webgpu-\d+\.instrumental\.wav$/.test(f));
    assert.ok(vocalsFile, `根層找不到 vocals 檔案，實際有: ${rootFiles.join(',')}`);
    assert.ok(instrumentalFile, `根層找不到 instrumental 檔案，實際有: ${rootFiles.join(',')}`);

    // .tmp 子目錄裡不該留下任何跟這次上傳有關的孤兒檔（multer 自己的暫存檔已被
    // rename 走；handler finally 的 unlink 對已 rename 的路徑是 ENOENT，靜默吞掉）。
    const tmpFiles = fs.existsSync(webgpuTmpDir) ? fs.readdirSync(webgpuTmpDir) : [];
    const orphans = tmpFiles.filter((f) => f !== path.basename(vocalsPath) && f !== path.basename(instrumentalPath));
    // vocals-src.wav / instrumental-src.wav 是我們自己準備的來源檔，不是 multer 產物，
    // 保留無妨；真正要確認的是 multer 自己命名的 `<jobId>-<field>-<uuid>.tmp` 沒有殘留。
    assert.ok(orphans.every((f) => !f.startsWith(`${jobId}-`)), `.tmp 裡還留著這個 job 的暫存檔: ${orphans.join(',')}`);

    assert.strictEqual(track.separationStatus, 'done');
    assert.strictEqual(track.vocalsFile, vocalsFile);
    assert.strictEqual(track.instrumentalFile, instrumentalFile);
  });

  // ── (4) job 已被取消（等同逾時／引擎斷線，三者在 finishJobWithResult 眼中都是
  //        activeJob 已被清空 → UNKNOWN_JOB，路徑相同）之後，temp 檔仍被 router 的
  //        finally 清掉，不留孤兒 ──
  await test('job 取消後（activeJob 已清空）上傳仍走到 handler，finally 清掉暫存檔，不留孤兒', async () => {
    const ctx = makeCtx({ id: 't-cancel', title: 'X' });
    const jobId = startJob(ctx, 't-cancel', 'x.mp3');
    const cancelResult = webgpuSeparationJobs.cancelJob(jobId);
    assert.strictEqual(cancelResult.ok, true);
    assert.strictEqual(webgpuSeparationJobs.getActiveJobId(), null, 'cancelJob 後 activeJob 應為 null（跟 watchdog 逾時／引擎斷線同一個效果）');

    const vocalsPath = tmpFilePath(`${jobId}-vocals-orphan-test.tmp`);
    writeMinimalWav(vocalsPath);
    assert.ok(fs.existsSync(vocalsPath));

    const res = fakeRes();
    await resultHandler({ params: { jobId }, files: { vocals: [{ path: vocalsPath }] }, body: {} }, res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.payload.error, 'UNKNOWN_JOB');
    assert.strictEqual(fs.existsSync(vocalsPath), false, '取消後殘留的暫存檔應被 finally 清掉');
  });

  // ── (5) 寫檔失敗（收到的內容不是合法 WAV）不會破壞既有 library 狀態，
  //        既有的 applyResult(failed) / separation:progress error 行為還在 ──
  await test('寫檔失敗（非法 WAV）：不動既有欄位、只把 separationStatus 標成 failed，暫存檔仍被清掉', async () => {
    const track = { id: 't-fail', title: '既有標題', someOtherField: 'keep-me', separationStatus: 'processing' };
    const ctx = makeCtx(track);
    let progressErrorEvent = null;
    ctx.io.emit = (event, payload) => { if (event === 'separation:progress') progressErrorEvent = payload; };
    const jobId = startJob(ctx, 't-fail', 'x.mp3');

    const badPath = tmpFilePath(`${jobId}-vocals-bad.tmp`);
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, Buffer.from('這不是 WAV 檔案的內容'));

    const res = fakeRes();
    await resultHandler({ params: { jobId }, files: { vocals: [{ path: badPath }] }, body: {} }, res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.payload.error, 'WRITE_FAILED');
    assert.strictEqual(fs.existsSync(badPath), false, '寫檔失敗後暫存檔也該被 finally 清掉，不留孤兒');

    // 既有欄位完全不受影響（鐵則 #17 的反向驗證：失敗時不能連原本沒問題的欄位都動到）。
    assert.strictEqual(track.title, '既有標題');
    assert.strictEqual(track.someOtherField, 'keep-me');
    assert.strictEqual(track.separationStatus, 'failed');
    assert.strictEqual(track.vocalsFile, undefined);

    assert.ok(progressErrorEvent, 'deferFailure 為 false 時應該有送 separation:progress error 事件');
    assert.strictEqual(progressErrorEvent.stage, 'error');
    assert.strictEqual(progressErrorEvent.error, 'WRITE_FAILED');
  });

  // ── (5b) deferFailure:true 時，寫檔失敗不該推 applyResult / separation:progress ──
  await test('deferFailure=true 時，寫檔失敗不觸發 applyResult(failed) 也不送 separation:progress', async () => {
    const track = { id: 't-defer', title: '不該被動', separationStatus: 'processing' };
    const ctx = makeCtx(track);
    let progressEventFired = false;
    ctx.io.emit = () => { progressEventFired = true; };
    webgpuSeparationJobs._resetForTests();
    webgpuSeparationJobs.wireDependencies(ctx);
    webgpuSeparationJobs.handleEngineConnected({ connected: true, id: 'engine-1', emit() {} });
    const jobId = webgpuSeparationJobs.startJobForTrack('t-defer', { sourceFilename: 'x.mp3' }, { deferFailure: true });

    const badPath = tmpFilePath(`${jobId}-vocals-bad-defer.tmp`);
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, Buffer.from('not a wav'));

    const res = fakeRes();
    await resultHandler({ params: { jobId }, files: { vocals: [{ path: badPath }] }, body: {} }, res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.payload.error, 'WRITE_FAILED');
    assert.strictEqual(fs.existsSync(badPath), false);
    assert.strictEqual(track.separationStatus, 'processing', 'deferFailure 時協調器自己收尾，這裡不該動 separationStatus');
    assert.strictEqual(progressEventFired, false, 'deferFailure 時不該送 separation:progress');
  });

  // ── (6) 超大檔案被拒：驗證 api.js 確實把 webgpuResultUpload 設成 500MB 上限，
  //        並用一個小上限的等價 multer 設定驗證同一套 fileSize 超限錯誤處理契約
  //        （跟 server/index.js 全域錯誤 middleware 對 LIMIT_FILE_SIZE 的處理一致）──
  //        不在測試裡真的搬 500MB+ 資料，避免拖垮測試時間與磁碟。
  await test('api.js 的 webgpuResultUpload 確實設了 500MB 檔案大小上限', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'api.js'), 'utf8');
    assert.ok(
      /webgpuResultUpload\s*=\s*multer\(\{\s*storage:\s*webgpuResultStorage,\s*limits:\s*\{\s*fileSize:\s*500\s*\*\s*1024\s*\*\s*1024,\s*files:\s*2\s*\}/.test(src),
      '找不到預期的 webgpuResultUpload 500MB / 2 檔案上限設定'
    );
  });

  await test('超過 fileSize 上限的欄位會被 multer 擋下，經全域錯誤 middleware 回 413（同一套錯誤處理契約）', async () => {
    const smallApp = express();
    const smallUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024, files: 2 } });
    smallApp.post('/upload', smallUpload.fields([{ name: 'vocals', maxCount: 1 }, { name: 'instrumental', maxCount: 1 }]), (req, res) => {
      res.json({ ok: true });
    });
    smallApp.use((err, req, res, next) => {
      if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT')) {
        return res.status(413).json({ error: '請求內容超過允許大小' });
      }
      res.status(500).json({ error: err.message });
    });
    const smallServer = http.createServer(smallApp);
    await new Promise((resolve) => smallServer.listen(0, '127.0.0.1', resolve));
    const smallPort = smallServer.address().port;
    try {
      const boundary = '----elitesandsmall' + crypto.randomBytes(8).toString('hex');
      const oversized = Buffer.alloc(5000, 1); // 5000 bytes > 1024 bytes 限制
      const parts = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="vocals"; filename="vocals.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
        oversized,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ];
      const body = Buffer.concat(parts);
      const { statusCode, payload } = await new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${smallPort}/upload`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let p = null;
            try { p = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* ignore */ }
            resolve({ statusCode: res.statusCode, payload: p });
          });
        });
        req.on('error', reject);
        req.end(body);
      });
      assert.strictEqual(statusCode, 413, `預期 413，實際 ${statusCode} (${JSON.stringify(payload)})`);
    } finally {
      await new Promise((resolve) => smallServer.close(resolve));
    }
  });

  await new Promise((resolve) => server.close(resolve));
  webgpuSeparationJobs._resetForTests();

  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('測試執行時發生未預期的錯誤', err);
  process.exitCode = 1;
});
