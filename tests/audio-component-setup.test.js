'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audio-setup-'));
for (const [name, dir] of Object.entries({ ELITESAND_DATA_DIR: 'data', ELITESAND_DOWNLOADS_DIR: 'downloads', ELITESAND_LOGS_DIR: 'logs' })) {
  process.env[name] = path.join(runtime, dir);
}
const provider = require('../server/services/ffmpeg-provider');
const checks = require('../server/services/system-check');
const compatibility = { getStatus: () => ({ state: 'ok' }) };
test.beforeEach(() => checks.clearCache());

test('system readiness rejects a working ffmpeg with a missing ffprobe', async (t) => {
  t.mock.method(provider, 'resolveFfmpegPaths', () => ({ source: 'config', ffmpeg: 'test-ffmpeg', ffprobe: 'test-ffprobe' }));
  const calls = [];
  const result = await checks.getSystemCheck({ force: true, compatibility, execFileImpl: async (command) => {
    calls.push(command);
    if (command === 'test-ffprobe') throw new Error('missing');
    return { stdout: 'version test' };
  } });
  assert.ok(calls.includes('test-ffprobe'));
  assert.equal(result.ffmpeg.available, false);
  assert.equal(result.ffmpeg.ffprobeAvailable, false);
  assert.equal(result.ffmpeg.downloadable, true);
});

test('both executable tools are required, with fresh readiness after repair', async (t) => {
  t.mock.method(provider, 'resolveFfmpegPaths', () => ({ source: 'downloaded', ffmpeg: 'test-ffmpeg', ffprobe: 'test-ffprobe' }));
  t.mock.method(provider, 'hasDownloadedPair', () => true);
  let repaired = false;
  const options = { compatibility, execFileImpl: async (command) => {
    if (!repaired && command === 'test-ffmpeg') throw new Error('broken executable');
    return { stdout: 'version test' };
  } };
  assert.equal((await checks.getSystemCheck(options)).ffmpeg.available, false);
  repaired = true;
  assert.equal((await checks.getSystemCheck({ ...options, force: true })).ffmpeg.available, true);
});

test('startup setup exposes only fixed upstream URLs and the actual download cap', async () => {
  const info = provider.getDownloadInfo();
  assert.equal(info.maxBytes, 300 * 1024 * 1024);
  assert.deepEqual(info.sources.map((s) => new URL(s.url).host), ['github.com', 'github.com', 'www.gyan.dev']);
  info.sources.pop();
  assert.equal(provider.getDownloadInfo().sources.length, 3, 'callers must not mutate subsequent setup metadata');
  assert.equal(JSON.stringify(info).includes(runtime), false);
});

test('temporary Windows executable lock retries without losing either tool', async (t) => {
  fs.mkdirSync(provider.BIN_DIR, { recursive: true });
  const tempFfmpeg = path.join(provider.BIN_DIR, 'lock-test-ffmpeg.exe');
  const tempFfprobe = path.join(provider.BIN_DIR, 'lock-test-ffprobe.exe');
  fs.writeFileSync(tempFfmpeg, 'new-ffmpeg'); fs.writeFileSync(tempFfprobe, 'new-ffprobe');
  const rename = fs.promises.rename.bind(fs.promises);
  let locks = 0;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (from === tempFfprobe && locks++ < 2) throw Object.assign(new Error('Windows image is temporarily busy'), { code: 'EBUSY' });
    return rename(from, to);
  });
  const transaction = await provider._beginPairInstall(tempFfmpeg, tempFfprobe);
  assert.equal(fs.readFileSync(provider.FFMPEG_EXE, 'utf8'), 'new-ffmpeg');
  assert.equal(fs.readFileSync(provider.FFPROBE_EXE, 'utf8'), 'new-ffprobe');
  assert.equal(locks, 3);
  await transaction.commit();
});

test('permanent second-file failure restores the original complete pair', async (t) => {
  fs.writeFileSync(provider.FFMPEG_EXE, 'old-ffmpeg'); fs.writeFileSync(provider.FFPROBE_EXE, 'old-ffprobe');
  const tempFfmpeg = path.join(provider.BIN_DIR, 'failure-test-ffmpeg.exe');
  const tempFfprobe = path.join(provider.BIN_DIR, 'failure-test-ffprobe.exe');
  fs.writeFileSync(tempFfmpeg, 'new-ffmpeg'); fs.writeFileSync(tempFfprobe, 'new-ffprobe');
  const rename = fs.promises.rename.bind(fs.promises);
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (from === tempFfprobe) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return rename(from, to);
  });
  await assert.rejects(provider._beginPairInstall(tempFfmpeg, tempFfprobe), { code: 'ENOSPC' });
  assert.equal(fs.readFileSync(provider.FFMPEG_EXE, 'utf8'), 'old-ffmpeg');
  assert.equal(fs.readFileSync(provider.FFPROBE_EXE, 'utf8'), 'old-ffprobe');
});

test('interrupted cleanup after commit never rolls back a verified new pair', async (t) => {
  const tempFfmpeg = path.join(provider.BIN_DIR, 'commit-test-ffmpeg.exe');
  const tempFfprobe = path.join(provider.BIN_DIR, 'commit-test-ffprobe.exe');
  fs.writeFileSync(tempFfmpeg, 'verified-ffmpeg'); fs.writeFileSync(tempFfprobe, 'verified-ffprobe');
  const transaction = await provider._beginPairInstall(tempFfmpeg, tempFfprobe);
  const unlink = fs.promises.unlink.bind(fs.promises);
  let locked = true;
  t.mock.method(fs.promises, 'unlink', async (file) => {
    if (locked && file === provider.FFPROBE_EXE + '.previous') throw Object.assign(new Error('locked backup'), { code: 'EPERM' });
    return unlink(file);
  });
  await transaction.commit();
  await transaction.rollback();
  assert.equal(fs.readFileSync(provider.FFMPEG_EXE, 'utf8'), 'verified-ffmpeg');
  assert.equal(fs.readFileSync(provider.FFPROBE_EXE, 'utf8'), 'verified-ffprobe');
  locked = false;
  fs.writeFileSync(tempFfmpeg, 'next-ffmpeg'); fs.writeFileSync(tempFfprobe, 'next-ffprobe');
  const next = await provider._beginPairInstall(tempFfmpeg, tempFfprobe);
  await next.rollback();
  assert.equal(fs.readFileSync(provider.FFMPEG_EXE, 'utf8'), 'verified-ffmpeg');
  assert.equal(fs.readFileSync(provider.FFPROBE_EXE, 'utf8'), 'verified-ffprobe');
});

  test('FFmpeg 供應：替換交易可回滾，避免只換成功一半就破壞原本 pair', async () => {
    const backupFfmpeg = `${provider.FFMPEG_EXE}.previous`;
    const backupFfprobe = `${provider.FFPROBE_EXE}.previous`;
    const tmpFfmpeg = path.join(provider.BIN_DIR, 'ffmpeg.transaction-test.exe');
    const tmpFfprobe = path.join(provider.BIN_DIR, 'ffprobe.transaction-test.exe');
    fs.mkdirSync(provider.BIN_DIR, { recursive: true });
    fs.rmSync(backupFfmpeg, { force: true });
    fs.rmSync(backupFfprobe, { force: true });
    fs.writeFileSync(provider.FFMPEG_EXE, 'old-ffmpeg');
    fs.writeFileSync(provider.FFPROBE_EXE, 'old-ffprobe');
    fs.writeFileSync(tmpFfmpeg, 'new-ffmpeg');
    fs.writeFileSync(tmpFfprobe, 'new-ffprobe');

    const transaction = await provider._beginPairInstall(tmpFfmpeg, tmpFfprobe);
    assert.equal(fs.readFileSync(provider.FFMPEG_EXE, 'utf8'), 'new-ffmpeg');
    assert.equal(fs.readFileSync(provider.FFPROBE_EXE, 'utf8'), 'new-ffprobe');
    await transaction.rollback();
    assert.equal(fs.readFileSync(provider.FFMPEG_EXE, 'utf8'), 'old-ffmpeg', 'rollback 要恢復舊 ffmpeg：');
    assert.equal(fs.readFileSync(provider.FFPROBE_EXE, 'utf8'), 'old-ffprobe', 'rollback 要恢復舊 ffprobe：');
    fs.rmSync(provider.FFMPEG_EXE, { force: true });
    fs.rmSync(provider.FFPROBE_EXE, { force: true });
    fs.rmSync(backupFfmpeg, { force: true });
    fs.rmSync(backupFfprobe, { force: true });
  });

  test('FFmpeg 供應：上次若死在半套替換，下一次交易會先整組恢復舊版', async () => {
    const backupFfmpeg = `${provider.FFMPEG_EXE}.previous`;
    const backupFfprobe = `${provider.FFPROBE_EXE}.previous`;
    const tmpFfmpeg = path.join(provider.BIN_DIR, 'ffmpeg.recovery-test.exe');
    const tmpFfprobe = path.join(provider.BIN_DIR, 'ffprobe.recovery-test.exe');
    fs.mkdirSync(provider.BIN_DIR, { recursive: true });
    fs.writeFileSync(backupFfmpeg, 'old-ffmpeg');
    fs.writeFileSync(backupFfprobe, 'old-ffprobe');
    fs.writeFileSync(provider.FFMPEG_EXE, 'half-installed-new-ffmpeg');
    fs.rmSync(provider.FFPROBE_EXE, { force: true });
    fs.writeFileSync(tmpFfmpeg, 'newer-ffmpeg');
    fs.writeFileSync(tmpFfprobe, 'newer-ffprobe');

    const transaction = await provider._beginPairInstall(tmpFfmpeg, tmpFfprobe);
    await transaction.rollback();
    assert.equal(fs.readFileSync(provider.FFMPEG_EXE, 'utf8'), 'old-ffmpeg', '半套交易要先恢復舊 ffmpeg：');
    assert.equal(fs.readFileSync(provider.FFPROBE_EXE, 'utf8'), 'old-ffprobe', '半套交易要先恢復舊 ffprobe：');
    fs.rmSync(provider.FFMPEG_EXE, { force: true });
    fs.rmSync(provider.FFPROBE_EXE, { force: true });
    fs.rmSync(backupFfmpeg, { force: true });
    fs.rmSync(backupFfprobe, { force: true });
  });
