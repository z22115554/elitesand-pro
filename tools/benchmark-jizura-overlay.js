#!/usr/bin/env node
'use strict';

/**
 * 文字PV 疊加層端到端基準：同一台機器上比較「升級前／升級後」的引擎＋模板。
 *
 *   node tools/benchmark-jizura-overlay.js --a 舊引擎.js[,舊模板.js] --b 新引擎.js[,新模板.js] [--rounds 3] [--parts extended] [--out 結果.json]
 *
 * 每一輪、每一組在全新的 Chromium 分頁裡：
 *   1. 量引擎＋模板 script 載入（解析＋執行＝註冊所有部件）的耗時與 JS heap 增量；
 *   2. 用模板自己的 buildPlan 規劃一首 3 分鐘、有段落分析的歌（中日英韓混合）；
 *   3. 在透明模式 1920×1080 下沿整首歌的時間軸畫 900 幀（每幀後讀 1px，強迫 GPU 做完），
 *      記錄 p50／p95／p99／最大 frame time，以及 >33.3ms（30fps 預算）的幀數；
 *   4. 反覆換歌／重新規劃 20 次後量 heap，檢查資源有沒有持續累積。
 * 預設測兩側＋標準強度，可用 --placement／--intensity 換。
 * 結果是同機相對比較：沙盒沒有實體 GPU 時是軟體繪製，數字會比 Windows 實機慢很多，
 * 不能當成 OBS 端到端 FPS 的保證。
 * JIZURA_BROWSER=/path/to/chrome 指定瀏覽器；否則用 Playwright 內建的 Chromium。
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const pair = (spec) => {
  const [engine, template] = spec.split(',');
  return { engine: path.resolve(engine), template: path.resolve(template || path.join(ROOT, 'public/js/lyric-template-jizura.js')) };
};
const A = pair(arg('--a', path.join(ROOT, 'public/vendor/jizura/jizura-engine.js')));
const B = pair(arg('--b', path.join(ROOT, 'public/vendor/jizura/jizura-engine.js')));
const rounds = Number(arg('--rounds', 3));
const placement = arg('--placement', 'sides');
const intensity = arg('--intensity', 'normal');
const parts = arg('--parts', '');
const outFile = arg('--out', null);

const TEXTS = ['我們在夜空下唱著最初那首歌', '一起唱歌', '當我們穿過城市夜空看見那些燈火', '君がくれた光を覚えている', '「またね」って笑った',
  'We sing together under the stars tonight', 'and go, "Yeah, I know"', '너와 함께 노래하고 싶어'];
const LINES = Array.from({ length: 48 }, (_, i) => ({ time: 2000 + i * 3600, text: TEXTS[i % TEXTS.length] }));
const SECTIONS = [{ start: 0, end: 40, label: 'verse' }, { start: 40, end: 60, label: 'pre_chorus' }, { start: 60, end: 100, label: 'chorus' },
  { start: 100, end: 140, label: 'verse' }, { start: 140, end: 200, label: 'chorus' }];

async function runOne(browser, setup) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent"></body>');
  await page.evaluate(({ placement, intensity, parts }) => {
    window.LyricTemplates = { register(def) { window.__tpl = def; } };
    document.body.dataset.jizuraPlacement = placement;
    document.body.dataset.lyricIntensity = intensity;
    if (parts) document.body.dataset.jizuraParts = parts;
  }, { placement, intensity, parts });
  const heap0 = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);
  const src = fs.readFileSync(setup.engine, 'utf8');
  // 把 buildPlan 暴露出來（跟 tests/jizura-composition.test.js 一樣的手法）
  const tpl = fs.readFileSync(setup.template, 'utf8').replace('  LyricTemplates.register({', '  window.__audit = { buildPlan };\n  LyricTemplates.register({');
  const bootMs = await page.evaluate(({ src, tpl }) => {
    const t0 = performance.now();
    (0, eval)(src);
    (0, eval)(tpl);
    return performance.now() - t0;
  }, { src, tpl });
  const result = await page.evaluate(async ({ lines, sections, heap0 }) => {
    const heap = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
    const afterBoot = heap();
    const t0 = performance.now();
    const plan = window.__audit.buildPlan(lines, { id: 'bench-song', sections });
    const planMs = performance.now() - t0;
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const renderer = new J.Renderer();
    const opts = { scale: 1920 / plan.W, transparent: true, noHud: true, noTrans: true, noGhost: !!plan.centerFree };
    const end = lines[lines.length - 1].time / 1000 + 4;
    const times = [];
    for (let f = -10; f < 900; f++) {
      const t = 1 + (end - 1) * (Math.max(0, f) / 900);
      const cut = J.cutAt(plan, t); if (cut && cut.fx) plan.fx = cut.fx;
      const a = performance.now();
      ctx.clearRect(0, 0, 1920, 1080);
      renderer.frame(ctx, plan, t, opts);
      ctx.getImageData(0, 0, 1, 1);
      if (f >= 0) times.push(performance.now() - a);
      if (f % 60 === 0) await new Promise(r => setTimeout(r, 0));
    }
    times.sort((x, y) => x - y);
    const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
    // 反覆重新規劃（模擬換歌）
    const replan = [];
    for (let i = 0; i < 20; i++) {
      const a = performance.now();
      window.__audit.buildPlan(lines.map(l => ({ ...l, text: l.text + (i % 3) })), { id: 'bench-' + i, sections });
      replan.push(performance.now() - a);
    }
    if (window.gc) window.gc();
    await new Promise(r => setTimeout(r, 50));
    return {
      heapBootMB: (afterBoot - heap0) / 1048576, planMs, cuts: plan.cuts.length,
      p50: q(0.5), p95: q(0.95), p99: q(0.99), max: times[times.length - 1], over33: times.filter(x => x > 33.3).length,
      replanMedianMs: replan.sort((x, y) => x - y)[10], heapAfterReplanMB: (heap() - heap0) / 1048576,
      layouts: [...new Set(plan.cuts.map(c => c.layout))].length,
    };
  }, { lines: LINES, sections: SECTIONS, heap0 });
  await page.close();
  return { bootMs, ...result, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.JIZURA_BROWSER || undefined,
    args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
  const rows = { a: [], b: [] };
  for (let r = 0; r < rounds; r++) {
    for (const [k, setup] of [['a', A], ['b', B]]) rows[k].push(await runOne(browser, setup));
  }
  await browser.close();
  const med = (list, key) => { const v = list.map(x => x[key]).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  const keys = ['bootMs', 'heapBootMB', 'planMs', 'p50', 'p95', 'p99', 'max', 'over33', 'replanMedianMs', 'heapAfterReplanMB', 'cuts', 'layouts'];
  const summary = Object.fromEntries(['a', 'b'].map(k => [k, Object.fromEntries(keys.map(key => [key, +med(rows[k], key).toFixed(2)]))]));
  const report = { placement, intensity, parts: parts || 'base', rounds, a: A, b: B, summary, errors: { a: rows.a.flatMap(x => x.errors), b: rows.b.flatMap(x => x.errors) }, rows };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`placement=${placement} intensity=${intensity} parts=${parts || 'base'} rounds=${rounds}（中位數）`);
  for (const key of keys) console.log(key.padEnd(18), String(summary.a[key]).padStart(9), '→', String(summary.b[key]).padStart(9));
  if (report.errors.a.length || report.errors.b.length) console.log('錯誤：', JSON.stringify(report.errors).slice(0, 500));
})().catch((e) => { console.error(e); process.exit(1); });
