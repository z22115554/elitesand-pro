'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseRelease, stageVerifiedRelease, installStagedRelease } = require('../server/services/ytdlp-verified-release');
const compatibility = require('../server/services/ytdlp-compatibility');

const version = '2026.10.26.220202';
const url = `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${version}/yt-dlp.exe`;
const binary = Buffer.from('unit-test-approved-executable');
const digest = crypto.createHash('sha256').update(binary).digest('hex');
const release = { version, digest, size: binary.length, url };

test('Nightly release only accepts official URL, valid tag and SHA-256 metadata', () => {
  const valid = { tag_name: version, assets: [{ name: 'yt-dlp.exe', browser_download_url: url, digest: `sha256:${digest}`, size: 200000 }] };
  assert.equal(parseRelease(valid).digest, digest);
  assert.throws(() => parseRelease({ ...valid, tag_name: '2026.10.26' }), /invalid/i);
  assert.throws(() => parseRelease({ ...valid, assets: [{ ...valid.assets[0], browser_download_url: 'https://evil.example/download.exe' }] }), /invalid/i);
  assert.throws(() => parseRelease({ ...valid, assets: [{ ...valid.assets[0], digest: null }] }), /invalid/i);
});

test('A tampered download never stages or replaces the existing trusted binary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ytdlp-hash-test-'));
  try {
    const target = path.join(root, 'yt-dlp.exe');
    fs.writeFileSync(target, 'trusted-old');
    await assert.rejects(stageVerifiedRelease(target, release, {
      fetchImpl: async () => ({ ok: true, buffer: async () => Buffer.from('tampered-content-with-same-size') }),
      execImpl: async () => ({ stdout: version }),
    }), /size mismatch|SHA-256 mismatch/i);
    assert.equal(fs.readFileSync(target, 'utf8'), 'trusted-old');
    assert.deepEqual(fs.readdirSync(root), ['yt-dlp.exe']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('A verified staged binary is installed only after its embedded version is checked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ytdlp-stage-test-'));
  try {
    const target = path.join(root, 'yt-dlp.exe');
    fs.writeFileSync(target, 'trusted-old');
    const stage = await stageVerifiedRelease(target, release, {
      fetchImpl: async () => ({ ok: true, buffer: async () => binary }),
      execImpl: async () => ({ stdout: `${version}\n` }),
    });
    assert.equal(fs.readFileSync(target, 'utf8'), 'trusted-old');
    installStagedRelease(target, stage, () => assert.equal(fs.readFileSync(target).toString(), binary.toString()));
    assert.deepEqual(fs.readdirSync(root), ['yt-dlp.exe']);
    assert.deepEqual(fs.readFileSync(target), binary);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('A trust-record validation failure rolls the binary back', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ytdlp-rollback-test-'));
  try {
    const target = path.join(root, 'yt-dlp.exe');
    const stage = path.join(root, 'yt-dlp.next.exe');
    fs.writeFileSync(target, 'trusted-old');
    fs.writeFileSync(stage, 'verified-new');
    assert.throws(() => installStagedRelease(target, stage, () => { throw new Error('trust write failed'); }), /trust write failed/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'trusted-old');
    assert.deepEqual(fs.readdirSync(root), ['yt-dlp.exe']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Manual YouTube compatibility check tests real audio bytes instead of metadata only', async () => {
  let argsSeen = null;
  const run = async (_command, args) => {
    if (args.includes('--help')) return { stdout: '--js-runtimes\n--remote-components' };
    argsSeen = args;
    return { stdout: Buffer.alloc(10241) };
  };
  const result = await compatibility.probeDownload({ execFileImpl: run });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'ok');
  assert.ok(argsSeen.includes('--test'));
  assert.ok(argsSeen.includes('-f'));
  assert.equal(argsSeen[argsSeen.indexOf('-o') + 1], '-');
  assert.ok(!argsSeen.includes('--cookies-from-browser'));
  assert.ok(!argsSeen.includes('--skip-download'));
});

test('A 403 during real audio verification is reported as a failure', async () => {
  const run = async (_command, args) => {
    if (args.includes('--help')) return { stdout: '--js-runtimes\n--remote-components' };
    throw Object.assign(new Error('download failed'), { stderr: 'HTTP Error 403: Forbidden' });
  };
  const result = await compatibility.probeDownload({ execFileImpl: run });
  assert.equal(result.ok, false);
  assert.match(result.message, /403/);
});
