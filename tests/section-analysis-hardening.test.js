'use strict';

/**
 * 段落分析（SongFormer）2026-09-23 code review A 區問題的回歸測試。
 * 執行：node --test tests/section-analysis-hardening.test.js（npm test 已串接）
 *
 * 真正的 Python sidecar／GPU 不在這裡跑：jobs 協調器的 supervisor 是 singleton，
 * 直接替換它的 probe/analyze/cancel/kill，再手動 emit supervisor 會發的事件。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 必須在載入任何 server 模組前設好隔離目錄（同 run-tests.js 的規則：絕不碰正式 data）。
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), '段落分析-測試-'));
process.env.ELITESAND_DATA_DIR = path.join(ROOT, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(ROOT, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(ROOT, 'logs');

const { safeRemove } = require('../server/utils/safe-remove');
const { SectionAnalysisSupervisor, supervisor, PROBE_TIMEOUT_MS } = require('../server/services/section-analysis');
const provider = require('../server/services/section-runtime-provider');
const jobs = require('../server/services/section-analysis-jobs');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function wireFakeJobs() {
  jobs._resetForTests();
  supervisor.emitter.removeAllListeners();
  const emitted = [];
  const playState = {
    playlist: [
      { id: 't1', title: 'one', sectionsStatus: 'none' },
      { id: 't2', title: 'two', sectionsStatus: 'none' },
    ],
    currentTrack: null,
  };
  const calls = { cancel: [], analyze: [], kill: 0 };
  let attempt = 0;
  supervisor.probe = async () => ({ cudaAvailable: true });
  supervisor.analyze = (params) => { calls.analyze.push(params); attempt += 1; return `attempt-${attempt}`; };
  supervisor.cancel = async (id) => { calls.cancel.push(id); return { cancelled: true }; };
  supervisor.kill = () => { calls.kill += 1; };
  provider.isAvailable = () => true;
  provider.verifyWeights = async () => true;
  jobs.wireDependencies({
    io: { emit: (event, payload) => emitted.push({ event, payload }), to: () => ({ emit() {} }), sockets: { sockets: new Map() } },
    playState,
    persistState: () => {},
    broadcastState: () => {},
  });
  const progress = () => emitted.filter((e) => e.event === 'sections:progress').map((e) => e.payload);
  return { playState, calls, progress };
}

test('A4：模型原始標籤 pre-chorus 寫回前正規化成 pre_chorus', async () => {
  const { playState } = wireFakeJobs();
  await jobs.startJobForTrack('t1', { inputPath: 'x.mp3' });
  supervisor.emitter.emit('result', {
    id: 'attempt-1',
    result: { sections: [{ start: 0, end: 10, label: 'Intro' }, { start: 10, end: 20, label: 'pre-chorus' }] },
  });
  const track = playState.playlist[0];
  assert.equal(track.sectionsStatus, 'done');
  assert.deepEqual(track.sections.map((s) => s.label), ['intro', 'pre_chorus']);
  assert.equal(jobs.isGpuBusy(), false);
});

test('A3：取消後 UI 立刻收尾，但 GPU 等 worker 回終局事件才釋放，佇列下一首才派出', async () => {
  const { playState, calls, progress } = wireFakeJobs();
  await jobs.startJobForTrack('t1', { inputPath: 'a.mp3' });
  assert.equal(await jobs.startJobForTrack('t2', { inputPath: 'b.mp3' }), null, '第二首應排隊');

  jobs.cancelJobForTrack('t1');
  await flush();
  assert.equal(playState.playlist[0].sectionsStatus, 'none', '取消的歌要立刻回到可再點');
  assert.ok(progress().some((p) => p.trackId === 't1' && p.stage === 'cancelled'));
  assert.deepEqual(calls.cancel, ['attempt-1']);
  assert.equal(jobs.isGpuBusy(), true, 'worker 還沒停之前 GPU 仍算佔用');
  assert.equal(calls.analyze.length, 1, '下一首不可以在 worker 停下前就派出（會撞 supervisor BUSY）');
  assert.equal(jobs.getActiveJobs().some((j) => j.trackId === 't1'), false, '已取消的不該再出現在進行中清單');

  supervisor.emitter.emit('error', { id: 'attempt-1', error: { code: 'CANCELLED' } });
  await flush();
  assert.equal(calls.analyze.length, 2, 'worker 確認停下後才派下一首');
  assert.equal(playState.playlist[0].sectionsStatus, 'none', '遲到的 CANCELLED 不可把狀態改成 failed');

  // 取消後才跑完的結果也不可以寫回
  jobs.cancelJobForTrack('t2');
  supervisor.emitter.emit('result', { id: 'attempt-2', result: { sections: [{ start: 0, end: 1, label: 'verse' }] } });
  assert.equal(playState.playlist[1].sections, undefined);
  assert.equal(jobs.isGpuBusy(), false);
});

test('A2：supervisor 當掉時替還掛著的 analyze 補發 error event，jobs 收成 failed 並釋放 GPU', async () => {
  const sup = new SectionAnalysisSupervisor('python-not-used', provider);
  const errors = [];
  sup.emitter.on('error', (msg) => errors.push(msg));
  sup.pendingRequests.set('job-1', { method: 'analyze', resolve() {}, reject() {}, timeoutHandle: null });
  let probeRejected = null;
  sup.pendingRequests.set('probe-1', { method: 'probe', resolve() {}, reject(err) { probeRejected = err; }, timeoutHandle: null });
  sup._rejectAllPending(Object.assign(new Error('boom'), { code: 'ENGINE_CRASHED' }));
  assert.equal(errors.length, 1, '只有 analyze 需要補發（probe 走 promise reject）');
  assert.equal(errors[0].id, 'job-1');
  assert.equal(errors[0].error.code, 'ENGINE_CRASHED');
  assert.ok(probeRejected);

  const { playState } = wireFakeJobs();
  await jobs.startJobForTrack('t1', { inputPath: 'a.mp3' });
  supervisor.emitter.emit('error', { id: 'attempt-1', error: { code: 'ENGINE_CRASHED', message: 'exited' } });
  assert.equal(playState.playlist[0].sectionsStatus, 'failed');
  assert.equal(jobs.isGpuBusy(), false, 'supervisor 死掉＝worker 也不在了，不必等 drain');
});

test('A2：看門狗逾時收成 failed；worker 一直不停就砍 supervisor 強制釋放 GPU', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { playState, calls } = wireFakeJobs();
  await jobs.startJobForTrack('t1', { inputPath: 'a.mp3' });
  let idle = false;
  jobs.whenGpuIdle().then(() => { idle = true; });

  t.mock.timers.tick(jobs.ANALYZE_WATCHDOG_MS);
  assert.equal(playState.playlist[0].sectionsStatus, 'failed');
  assert.equal(jobs.isGpuBusy(), true);

  t.mock.timers.tick(jobs.DRAIN_TIMEOUT_MS);
  await flush();
  assert.equal(calls.kill, 1);
  assert.equal(jobs.isGpuBusy(), false);
  assert.equal(idle, true, '等 GPU 的 AI 人聲分離要被喚醒');
});

test('A5：probe 的逾時要容得下冷啟動 import torch', () => {
  assert.ok(PROBE_TIMEOUT_MS >= 60000, `probe 逾時太短：${PROBE_TIMEOUT_MS}`);
});

test('A8：AI 人聲分離撞上段落分析是等待，不是 GPU_BUSY 失敗', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server/services/ai-separation-jobs.js'), 'utf8');
  assert.ok(src.includes('whenGpuIdle()'), '分離 dispatch 要等段落分析釋放 GPU');
  assert.ok(!/code:\s*'GPU_BUSY'/.test(src), '分離端不可再把段落分析佔用收成 GPU_BUSY 失敗（會記成失敗遙測）');
});

test('A1：權重驗證不可同步整檔讀進記憶體；沒有驗證指紋時 isWeightsAvailable 只 stat 就回 false', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server/services/section-runtime-provider.js'), 'utf8');
  assert.ok(!/readFileSync\(filePath\)/.test(src), 'fileMd5 不可 readFileSync 整個權重檔');
  assert.ok(src.includes('createReadStream'), 'MD5 要串流計算');
  assert.equal(provider.isWeightsAvailable(), false);
});

test('A6：重裝 SongFormer 原始碼時保留已下載的 ckpts', () => {
  const ckpts = path.join(provider.SONGFORMER_DIR, 'src', 'SongFormer', 'ckpts');
  fs.mkdirSync(path.join(ckpts, 'MusicFM'), { recursive: true });
  fs.writeFileSync(path.join(ckpts, 'MusicFM', 'pretrained_msd.pt'), 'weights');
  const kept = provider._preserveCkpts();
  assert.equal(kept, provider.CKPTS_KEEP_DIR);
  assert.equal(fs.existsSync(ckpts), false);

  // 模擬原始碼重新解壓：新的 ckpts 只有 md5sum.txt
  fs.mkdirSync(ckpts, { recursive: true });
  fs.writeFileSync(path.join(ckpts, 'md5sum.txt'), 'sums');
  provider._restoreCkpts(kept);
  assert.equal(fs.readFileSync(path.join(ckpts, 'MusicFM', 'pretrained_msd.pt'), 'utf8'), 'weights');
  assert.equal(fs.readFileSync(path.join(ckpts, 'md5sum.txt'), 'utf8'), 'sums');
  assert.equal(fs.existsSync(provider.CKPTS_KEEP_DIR), false);
});

// 2026-09-24 審查清單 A9 懷疑 junction 刪不掉；實測 Node 24 的 unlinkSync（libuv）本來就會刪 junction 本身，
// 原程式沒有這個 bug。留著這個測試防止之後改寫 safeRemove 時弄壞。
test('A9：safeRemove 刪得掉中文路徑上的目錄 junction，且不會刪到目標內容', { skip: process.platform !== 'win32' }, () => {
  const base = fs.mkdtempSync(path.join(ROOT, '連結-'));
  const target = path.join(base, '目標');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, '留著.txt'), 'keep');
  const link = path.join(base, '連結');
  fs.symlinkSync(target, link, 'junction');
  assert.equal(safeRemove(link), true);
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.readFileSync(path.join(target, '留著.txt'), 'utf8'), 'keep');
});

test.after(() => {
  jobs._resetForTests();
  safeRemove(ROOT);
});
