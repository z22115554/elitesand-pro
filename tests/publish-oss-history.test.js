'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const tool = path.join(__dirname, '../tools/publish-oss.js');
const { lastSyncedSha } = require(tool);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-oss-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  const target = path.join(dir, 'public');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const cwd of [source, target]) {
    fs.mkdirSync(cwd);
    git(cwd, 'init', '-b', 'main');
    git(cwd, 'config', 'user.name', 'Audit fixture');
    git(cwd, 'config', 'user.email', 'fixture@example.test');
  }
  fs.mkdirSync(path.join(source, 'tools'));
  fs.copyFileSync(tool, path.join(source, 'tools/publish-oss.js'));
  fs.writeFileSync(path.join(source, 'package.json'), '{"version":"1.0.0"}\n');
  const commit = (cwd, message) => { git(cwd, 'add', '-A'); git(cwd, 'commit', '-m', message); return git(cwd, 'rev-parse', 'HEAD'); };
  fs.writeFileSync(path.join(source, 'README.md'), 'base\n');
  const base = commit(source, 'initial');
  const run = (...extra) => spawnSync(process.execPath, [path.join(source, 'tools/publish-oss.js'), '--target', target, '--sync', ...extra], { encoding: 'utf8' });
  const seed = (marker = true) => {
    fs.writeFileSync(path.join(target, 'README.md'), 'base\n');
    commit(target, marker ? `snapshot\n\nSource: ${base}` : 'snapshot without marker');
  };
  return { source, target, git, commit, base, run, seed };
}

test('replay includes merge resolutions while omitting side branch commits', t => {
  const f = fixture(t); f.seed();
  f.git(f.source, 'checkout', '-b', 'side');
  fs.writeFileSync(path.join(f.source, 'README.md'), 'side\n');
  f.commit(f.source, 'side-only subject');
  f.git(f.source, 'checkout', 'main');
  fs.writeFileSync(path.join(f.source, 'README.md'), 'main\n');
  f.commit(f.source, 'main subject');
  assert.throws(() => f.git(f.source, 'merge', '--no-ff', 'side'));
  fs.writeFileSync(path.join(f.source, 'README.md'), 'resolved in merge\n');
  const merge = f.commit(f.source, 'merge resolution');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(f.target, 'README.md'), 'utf8'), 'resolved in merge\n');
  assert.equal(lastSyncedSha(f.target), merge);
  assert.ok(!f.git(f.target, 'log', '--format=%s').includes('side-only subject'));
  assert.equal(f.run().status, 0, 'repeat synchronization is a no-op');
});

test('public annotation commits retain the preceding Source marker', t => {
  const f = fixture(t); f.seed();
  fs.writeFileSync(path.join(f.target, 'annotation.txt'), 'public annotation');
  f.commit(f.target, 'annotation with no Source trailer');
  assert.equal(lastSyncedSha(f.target), f.base);
  fs.writeFileSync(path.join(f.source, 'README.md'), 'new version\n');
  const head = f.commit(f.source, 'new version');
  assert.equal(f.run().status, 0);
  assert.equal(lastSyncedSha(f.target), head);
});

test('populated public history without a marker requires a verified explicit cursor', t => {
  const f = fixture(t); f.seed(false);
  const oldHead = f.git(f.target, 'rev-parse', 'HEAD');
  const result = f.run('--dry-run');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--from/);
  assert.equal(f.git(f.target, 'rev-parse', 'HEAD'), oldHead);
  fs.writeFileSync(path.join(f.source, 'README.md'), 'next\n');
  f.commit(f.source, 'next');
  assert.equal(f.run('--from', f.base).status, 0);
  assert.equal(fs.readFileSync(path.join(f.target, 'README.md'), 'utf8'), 'next\n');
});

test('empty initialized public repository can bootstrap the first-parent history', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lastSyncedSha(f.target), f.base);
});

test('dirty public worktrees are rejected before overwriting any file', t => {
  const f = fixture(t); f.seed();
  fs.writeFileSync(path.join(f.target, 'README.md'), 'unsaved work\n');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /未提交/);
  assert.equal(fs.readFileSync(path.join(f.target, 'README.md'), 'utf8'), 'unsaved work\n');
});

test('cursor outside source ancestry cannot trigger replay', t => {
  const f = fixture(t); f.seed();
  f.git(f.source, 'checkout', '--orphan', 'unrelated');
  fs.writeFileSync(path.join(f.source, 'README.md'), 'unrelated\n');
  const unrelated = f.commit(f.source, 'unrelated');
  f.git(f.source, 'checkout', 'main');
  const oldHead = f.git(f.target, 'rev-parse', 'HEAD');
  assert.notEqual(f.run('--from', unrelated).status, 0);
  assert.equal(f.git(f.target, 'rev-parse', 'HEAD'), oldHead);
});

for (const initializedDirectory of [false, true]) {
  test(`dry-run can preview bootstrap into ${initializedDirectory ? 'an empty directory' : 'a missing target'}`, t => {
    const f = fixture(t);
    const target = path.join(f.source, 'nested-public');
    if (initializedDirectory) fs.mkdirSync(target);
    const result = spawnSync(process.execPath, [path.join(f.source, 'tools/publish-oss.js'), '--target', target, '--sync', '--dry-run'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--dry-run/);
    assert.equal(fs.existsSync(target), initializedDirectory);
    if (initializedDirectory) assert.deepEqual(fs.readdirSync(target), []);
  });
}

test('a Source marker on the last line without a trailing newline is still the latest sync point', t => {
  const f = fixture(t); f.seed();
  fs.writeFileSync(path.join(f.source, 'README.md'), 'next\n');
  const next = f.commit(f.source, 'next');
  fs.writeFileSync(path.join(f.target, 'README.md'), 'next\n');
  const msgFile = path.join(f.target, '..', 'msg.txt');
  fs.writeFileSync(msgFile, `snapshot v2\n\nSource: ${next}`); // 刻意不加結尾換行（v1.1.0 快照就是這樣）
  f.git(f.target, 'add', '-A');
  f.git(f.target, 'commit', '--cleanup=verbatim', '-F', msgFile);
  fs.writeFileSync(path.join(f.target, 'NOTE.txt'), 'manual fix\n');
  f.commit(f.target, 'manual fix after snapshot');
  assert.equal(lastSyncedSha(f.target), next);
});
