'use strict';
// 精準對時（選裝元件）的判斷邏輯：語言判斷、門檻、逐句改時間。worker 本身要 Python＋模型，不在這裡測。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ps = require('../server/services/precise-sync');
const autoSync = require('../server/services/auto-sync');
const provider = require('../server/services/align-runtime-provider');

const zhLines = (n = 12, step = 4000) => Array.from({ length: n }, (_, i) => ({ time: 10000 + i * step, duration: 3000, text: '我們一起走過的那些日子' }));

test('中文歌才用模型：日文（假名）、韓文、字太少都不算', () => {
  assert.equal(ps.isChineseLyrics(zhLines()), true);
  assert.equal(ps.isChineseLyrics([{ text: '君を泣かすから だから一緒には居れないな' }, ...zhLines(4)]), false);
  assert.equal(ps.isChineseLyrics([{ text: '사랑해요 사랑해요 사랑해요 사랑해요 사랑해요 사랑해요' }, ...zhLines(4)]), false);
  assert.equal(ps.isChineseLyrics([{ text: '我愛你' }]), false);
  assert.equal(ps.isChineseLyrics([]), false);
});

test('送給 worker 的歌詞轉簡體、保留逐字時間、索引不變', () => {
  const out = ps.toWorkerLines([{ time: 1000, duration: 2000, text: '愛過', words: [{ text: '愛', start: 0, duration: 500 }, { text: '過', start: 500, duration: 500 }] }, null]);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, '爱过');
  assert.deepEqual(out[0].words.map((w) => [w.text, w.start, w.duration]), [['爱', 0, 500], ['过', 500, 500]]);
  assert.equal(out[1].text, '');
});

test('整首門檻：z>=6 且第二峰比>=2', () => {
  assert.equal(ps.modelPasses({ offsetMs: 0, peakZ: 6, peakRatio: 2 }), true);
  assert.equal(ps.modelPasses({ offsetMs: 0, peakZ: 14.5, peakRatio: 1.5 }), false);
  assert.equal(ps.modelPasses({ offsetMs: 0, peakZ: 5.9, peakRatio: 9 }), false);
  assert.equal(ps.modelPasses({ units: 3 }), false);
  assert.equal(ps.modelPasses(null), false);
  assert.equal(ps.modelCenterMs({ offsetMs: 1000 }), 1000 - ps.MODEL_BIAS_MS);
});

test('逐句：有把握的句子改成「真正開始唱的時間＋偏移」，其他句不動，逐字跟著整句走', () => {
  const lines = zhLines(6);
  lines[3].words = [{ text: '我', start: 0, duration: 300 }];
  lines[3].endTime = lines[3].time + 3000;
  const offset = 500;
  // 第 4 句（index 3）其實晚了 2 秒才唱
  const realOnset = lines[3].time - offset + 2000 + ps.LINE_BIAS_MS;
  const r = ps.retimeLines(lines, offset, { onsets: { 3: realOnset, 4: lines[4].time - offset + ps.LINE_BIAS_MS }, conf: { 3: -0.5, 4: -0.4 } });
  assert.ok(r.lines);
  assert.equal(r.lines[3].time, lines[3].time + 2000);
  assert.equal(r.lines[3].endTime, lines[3].endTime + 2000);
  assert.deepEqual(r.lines[3].words, lines[3].words);
  assert.equal(r.lines[0], lines[0]);
  assert.equal(r.maxShiftMs, 2000);
  assert.equal(lines[3].time, 22000, '不可改到原陣列');
});

test('逐句：信心不夠的句子不改；只差 0.3 秒以內的句子不改', () => {
  const lines = zhLines(6);
  const low = ps.retimeLines(lines, 0, { onsets: { 2: lines[2].time + 3000 }, conf: { 2: ps.LINE_MIN_CONF - 0.1 } });
  assert.equal(low.lines, null);
  const small = ps.retimeLines(lines, 0, { onsets: { 2: lines[2].time + 200 + ps.LINE_BIAS_MS }, conf: { 2: -0.1 } });
  assert.equal(small.lines, null);
  assert.equal(small.moved, 0);
  // 一句差很多、另一句只差一點：只改差很多的那句
  const mixed = ps.retimeLines(lines, 0, { onsets: { 2: lines[2].time + 900 + ps.LINE_BIAS_MS, 3: lines[3].time + 250 + ps.LINE_BIAS_MS }, conf: { 2: -0.1, 3: -0.1 } });
  assert.equal(mixed.moved, 1);
  assert.equal(mixed.lines[3], lines[3]);
});

test('逐句：改完順序顛倒的那句還原，不可讓歌詞倒著跳', () => {
  const lines = zhLines(5);
  // 第 2 句被移到第 3 句之後
  const r = ps.retimeLines(lines, 0, { onsets: { 1: lines[3].time + 500 + ps.LINE_BIAS_MS, 4: lines[4].time + 1000 + ps.LINE_BIAS_MS }, conf: { 1: -0.2, 4: -0.2 } });
  assert.ok(r.lines);
  assert.equal(r.lines[1].time, lines[1].time);
  assert.equal(r.lines[4].time, lines[4].time + 1000);
  for (let i = 1; i < r.lines.length; i++) assert.ok(r.lines[i].time > r.lines[i - 1].time);
});

test('逐句：多數句子的原時間比較接近人聲起唱點時，整首不校正', () => {
  const lines = zhLines(6);
  const onsets = { 1: lines[1].time + 400 + ps.LINE_BIAS_MS, 2: lines[2].time + 400 + ps.LINE_BIAS_MS, 3: lines[3].time + 400 + ps.LINE_BIAS_MS };
  const conf = { 1: -0.2, 2: -0.2, 3: -0.2 };
  const oldIsRight = ps.retimeLines(lines, 0, { onsets, conf }, { onsetNear: (t) => Math.round(t - 200) });
  assert.equal(oldIsRight.lines, null);
  assert.equal(oldIsRight.vetoed, true);
  const newIsRight = ps.retimeLines(lines, 0, { onsets, conf }, { onsetNear: (t) => Math.round(t + 200) });
  assert.ok(newIsRight.lines);
  const unknown = ps.retimeLines(lines, 0, { onsets, conf }, { onsetNear: () => null });
  assert.ok(unknown.lines, '找不到起唱點時照模型');
});

test('人聲起唱點：安靜後開口的位置', () => {
  const sr = autoSync.SAMPLE_RATE;
  const samples = new Float32Array(sr * 10);
  for (let k = Math.round(4.2 * sr); k < 6 * sr; k++) samples[k] = Math.sin(k / 5) * 0.5;
  const find = autoSync.vocalOnsetFinder(samples);
  assert.ok(Math.abs(find(4000) - 4200) <= 20, String(find(4000)));
  assert.equal(find(9000), null);
});

test('已知中心時只在附近找：句首脈衝對得上的位置', () => {
  const sr = autoSync.SAMPLE_RATE;
  const lines = Array.from({ length: 10 }, (_, i) => ({ time: 5000 + i * 3000, duration: 1500, text: '測試' }));
  const trueOffset = -1200; // 歌詞時間 - 實際唱的時間
  const samples = new Float32Array(sr * 40);
  for (const l of lines) {
    const start = Math.round(((l.time - trueOffset) / 1000) * sr);
    for (let k = 0; k < sr * 1.2; k++) if (start + k < samples.length) samples[start + k] = Math.sin(k / 7) * 0.5;
  }
  const got = autoSync.refineOffsetNear(samples, lines, trueOffset + 400, 700);
  assert.ok(Math.abs(got - trueOffset) <= 30, `got ${got}`);
});

test('背景自動安裝：只在 Windows、沒裝好時；每次啟動最多自動試一次', () => {
  provider._resetForTests();
  assert.equal(provider.autoInstall('test', { platform: 'linux' }), false);
  assert.equal(provider.isInstalling(), false);
});

test('人聲分離元件裝完會接著裝精準對時元件', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'ai-separation-bundle.js'), 'utf8');
  assert.ok(bundle.includes("require('./align-runtime-provider').autoInstall("));
  const handler = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'handlers', 'lyrics.js'), 'utf8');
  assert.ok(handler.includes('alignRuntime.autoInstall('), '已裝好人聲分離的人第一次對中文歌自動對時時補裝');
});

test('元件：套件全部釘版本＋雜湊、模型釘雜湊；worker 不自己跑 ffmpeg', () => {
  for (const r of provider.PIP_REQUIREMENTS) assert.match(r, /^[a-z0-9-]+==[\w.]+ --hash=sha256:[0-9a-f]{64}$/);
  for (const m of Object.values(provider.MODELS)) assert.match(m.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(provider.MODELS).sort(), ['cpu', 'dml']);
  const worker = fs.readFileSync(path.join(__dirname, '..', 'ai', 'align_worker.py'), 'utf8');
  assert.ok(!/subprocess|ffmpeg -/.test(worker.replace(/""".*?"""/s, '')), 'worker 讀伺服器解碼好的音訊，不另外呼叫 ffmpeg（鐵則 12）');
});
