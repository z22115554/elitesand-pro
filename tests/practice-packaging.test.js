'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { PAGE_BUNDLES, TEMPLATE_IDS, assertLocalScriptReferencesExist } = require('../tools/build-production-bundles');

const repo = path.resolve(__dirname, '..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const WORKLET = 'js/practice/pitch-detector-worklet.js';
const PANEL_SCRIPTS = ['practice-clock.js', 'practice/practice-scoring.js', 'practice/practice-fx.js', 'practice/practice-engine.js', 'app-practice.js'];
const OVERLAY_SCRIPTS = ['practice/practice-scoring.js', 'practice/practice-fx.js', 'practice/practice-engine.js', 'practice-overlay.js'];
const practiceFiles = [
  ...new Set([...PANEL_SCRIPTS, ...OVERLAY_SCRIPTS].map(name => `public/js/${name}`)),
  `public/${WORKLET}`, 'public/vendor/soundtouch-worklet.js', 'server/services/practice-overlay.js',
  ...TEMPLATE_IDS.map(id => `public/js/lyric-template-${id}.js`),
];

function copySource(relative, staging) {
  const target = path.join(staging, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(repo, relative), target);
}

function pageScripts(publicDir, html) {
  const source = fs.readFileSync(path.join(publicDir, html), 'utf8');
  return [...source.matchAll(/<script[^>]+src="(\/js\/[^"]+)"[^>]*><\/script>/g)].map(match => match[1]);
}

// 打包後的 worklet 仍能在音訊執行緒的環境裡註冊、處理、不出聲
function exerciseWorklet(publicDir) {
  let Processor;
  const scope = vm.createContext({ Float32Array, Math, sampleRate: 48000, currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: m => frames.push(m) }; } },
    registerProcessor(name, value) { assert.equal(name, 'practice-pitch-detector'); Processor = value; } });
  const frames = [];
  vm.runInContext(fs.readFileSync(path.join(publicDir, WORKLET), 'utf8'), scope);
  const processor = new Processor();
  for (let at = 0; at < 9600; at += 128) {
    const tone = Float32Array.from({ length: 128 }, (_, i) => .25 * Math.sin(2 * Math.PI * 440 * (at + i) / 48000));
    const out = new Float32Array(128);
    scope.currentTime = (at + 128) / 48000;
    processor.process([[tone]], [[out]]);
    assert.ok(out.every(v => v === 0));
  }
  assert.ok(frames.some(f => Math.abs(f.f0 - 440) < 2), 'packaged worklet still detects pitch');
}

// 打包後的頁面 bundle 能執行，並把共用模組掛到 window 上
function exerciseBundle(publicDir, html) {
  const scope = vm.createContext({ document: { getElementById: () => null } }); scope.window = scope; scope.globalThis = scope;
  for (const url of pageScripts(publicDir, html)) vm.runInContext(fs.readFileSync(path.join(publicDir, url.slice(1)), 'utf8'), scope);
  assert.equal(typeof scope.PracticeEngine.createPracticeEngine, 'function', `${html}: engine`);
  assert.equal(typeof scope.PracticeScoring.prepareGuide, 'function', `${html}: scoring`);
  assert.equal(JSON.stringify(scope.PracticeFx.FX_IDS), JSON.stringify(require('../public/js/practice/practice-fx').FX_IDS), `${html}: fx presets`);
  return scope;
}

test('release build keeps the worklet URL and the server-required fx module, bundles the rest, and leaves the LGPL vendor alone', t => {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-practice-package-'));
  t.after(() => fs.rmSync(staging, { recursive: true, force: true }));
  const before = new Map(practiceFiles.map(relative => [relative, hash(path.join(repo, relative))]));
  for (const relative of practiceFiles) copySource(relative, staging);
  const publicDir = path.join(staging, 'public');
  const tags = names => names.map(name => `<script src="/js/${name}"></script>`).join('\n');
  for (const page of PAGE_BUNDLES) {
    const scripts = page.html === 'index.html' ? tags(PANEL_SCRIPTS) : page.html === 'practice-overlay.html' ? tags(OVERLAY_SCRIPTS) : '';
    fs.writeFileSync(path.join(publicDir, page.html), `<!doctype html><html><body>${scripts}</body></html>`);
  }
  const vendorHash = hash(path.join(publicDir, 'vendor/soundtouch-worklet.js'));
  const result = spawnSync(process.execPath, [path.join(repo, 'tools/build-production-bundles.js'), staging], { cwd: repo, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const [relative, digest] of before) assert.equal(hash(path.join(repo, relative)), digest, `release build must not mutate source ${relative}`);
  assert.equal(hash(path.join(publicDir, 'vendor/soundtouch-worklet.js')), vendorHash, 'LGPL vendor remains byte-for-byte separate');
  assert.ok(fs.existsSync(path.join(publicDir, WORKLET)), 'the worklet is loaded by URL (addModule) and must survive bundling');
  assert.ok(fs.existsSync(path.join(publicDir, 'js/practice/practice-fx.js')), 'server/services/practice-overlay.js requires practice-fx.js');
  for (const name of ['practice-clock.js', 'app-practice.js', 'practice-overlay.js', 'practice/practice-engine.js', 'practice/practice-scoring.js']) {
    assert.equal(fs.existsSync(path.join(publicDir, 'js', name)), false, `${name} should be consumed into its page bundle`);
  }
  assertLocalScriptReferencesExist(publicDir, path.join(publicDir, 'js'));
  const panel = exerciseBundle(publicDir, 'index.html');
  assert.equal(typeof panel.PracticeClock.Timeline, 'function');
  exerciseBundle(publicDir, 'practice-overlay.html');
  const panelBundle = pageScripts(publicDir, 'index.html').map(url => fs.readFileSync(path.join(publicDir, url.slice(1)), 'utf8')).join('\n');
  assert.ok(panelBundle.includes('/js/practice/pitch-detector-worklet.js'), 'the panel still points at the worklet URL');
  exerciseWorklet(publicDir);
});

// 指向一份完整的發行 staging，確認實際成品也是同樣狀態（不改動、不新增任何成品）。
if (process.env.ELITESAND_PRACTICE_STAGING_PATH) {
  test('complete release staging serves the practice worklet and bundles, and keeps the Python guide and LGPL vendor', () => {
    const staging = path.resolve(process.env.ELITESAND_PRACTICE_STAGING_PATH), publicDir = path.join(staging, 'public');
    assertLocalScriptReferencesExist(publicDir, path.join(publicDir, 'js'));
    exerciseWorklet(publicDir);
    for (const relative of ['ai/pitch_guide_worker.py', 'public/vendor/soundtouch-worklet.js']) {
      assert.equal(hash(path.join(staging, relative)), hash(path.join(repo, relative)), `${relative} remains present and unchanged`);
    }
  });
}
