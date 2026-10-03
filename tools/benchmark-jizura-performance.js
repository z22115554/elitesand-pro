#!/usr/bin/env node
'use strict';

// Compare the pinned engine before/after local optimizations; never update visual baselines.
// node tools/benchmark-jizura-performance.js /path/to/original/jizura-engine.js
// JIZURA_BROWSER=/path/to/chromium selects an existing browser; otherwise use Playwright's browser.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('@playwright/test');

async function prepare(browser, engine) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning' && !msg.text().startsWith('Canvas2D:')) errors.push(msg.text()); });
  await page.setContent('<title>JIZURA performance and visual equivalence</title><canvas id="frame" width="480" height="270"></canvas>');
  assert.equal(await page.title(), 'JIZURA performance and visual equivalence');
  await page.addScriptTag({ path: engine });
  return { page, errors };
}

async function measure(page) {
  return page.evaluate(() => {
    const samples = [], texts = ['我們在夜空下唱著最初那首歌', '君がくれた光を覚えている', 'Never gonna give you up', '너와 함께 노래하고 싶어'];
    const items = texts.map(text => ({ text, font: 'gothic_bold', size: 42, track: 0.06 }));
    J.setLang('zh-Hant'); J.setTypeset(true);
    for (let n = 0; n < 2000; n++) J.layoutText(items[n % items.length]);
    let queries = 0; const adv = J.metrics.adv;
    J.metrics.adv = function (...args) { queries++; return adv.apply(this, args); };
    for (let r = 0; r < 9; r++) {
      const begin = performance.now();
      for (let n = 0; n < 10000; n++) J.layoutText({ ...items[n % items.length], size: 35 + n % 20 });
      samples.push(performance.now() - begin);
    }
    J.metrics.adv = adv; samples.sort((a, b) => a - b);
    const canvas = document.querySelector('#frame'), ctx = canvas.getContext('2d'), renderer = new J.Renderer();
    let eventReads = 0;
    const events = Array.from({ length: 1000 }, (_, i) => ({ type: i % 2 ? 'chroma' : 'shake', get t() { eventReads++; return i * 0.3; }, amp: 0.3, dur: 0.1 }));
    const plan = { events, fx: {}, style: { glow: 0 }, fps: 24 };
    const post = () => renderer.post(ctx, plan, 299.8, 299.8, 0, { bg: '#000000' }, 1, { fast: true, transparent: true }, false);
    post(); eventReads = 0;
    for (let n = 0; n < 100; n++) post();
    return { layoutMedianMs: samples[4], layoutCalls: 90000, metricQueries: queries, eventTimeReadsPerFrame: eventReads / 100 };
  });
}

async function frames(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#frame'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const renderer = new J.Renderer(), results = [];
    const lyrics = '[00:01.00]我們在夜空下唱著最初那首歌\n[00:05.00]Never gonna give you up\n[00:09.00]君がくれた光を覚えている\n[00:13.00]너와 함께 노래하고 싶어';
    for (const centerFree of [false, true]) for (const layout of J.order('layout')) {
      const project = Object.assign(J.defaultProject(), { lyrics, seed: 7, extra: true, wa: true, lang: 'zh-Hant', unify: true, typeset: true, centerFree, centerDir: 'lr' });
      project.fx = Object.assign(project.fx, { hud: 'off', flash: false, bgSwitch: 0, koma: 30, onTwos: false });
      project.enabled.layout = Object.fromEntries(J.order('layout').map(k => [k, k === layout]));
      project.enabled.bg = Object.fromEntries(J.order('bg').map(k => [k, k === 'none']));
      project.enabled.trans = Object.fromEntries(J.order('trans').map(k => [k, false]));
      const plan = J.plan(project, null);
      const cuts = plan.cuts.filter(c => c.layout === layout && c.line >= 0);
      if (!cuts.length) { results.push({ layout, centerFree, skipped: true }); continue; }
      const cut = cuts[0];
      for (const fraction of [0.1, 0.5, 0.9]) {
        const t = cut.start + cut.dur * fraction;
        renderer.frame(ctx, plan, t, { scale: canvas.width / plan.W, transparent: true, noHud: true, noTrans: true, noGhost: centerFree });
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const visible = data.some((v, i) => i % 4 === 3 && v > 0);
        results.push({ layout, centerFree, fraction, visible, image: canvas.toDataURL('image/png') });
      }
    }
    return results;
  });
}

async function adapterFrames(browser, engine) {
  const { page, errors } = await prepare(browser, engine);
  await page.evaluate(() => {
    document.head.insertAdjacentHTML('beforeend', '<style>body{margin:0}#host,#jizura-root{position:absolute;inset:0}.jizura-canvas{position:absolute}</style>');
    document.body.innerHTML = '<div id="host"></div>';
    window.LyricTemplates = { register(t) { window.tpl = t; } };
    J.ensureFonts = () => Promise.resolve();
  });
  await page.addScriptTag({ path: path.join(__dirname, '../public/js/lyric-template-jizura.js') });
  const results = await page.evaluate(async () => {
    const texts = ['我們在夜空下唱著最初那首歌', '君がくれた光を覚えている', 'Never gonna give you up', '너와 함께 노래하고 싶어'];
    const lines = Array.from({ length: 200 }, (_, i) => ({ time: 1000 + i * 3000, text: texts[i % texts.length] }));
    const meta = { id: 'jizura-perf', title: 'JIZURA', sections: [{ start: 0, end: 20, label: 'verse' }, { start: 20, end: 600, label: 'chorus' }] };
    const tctx = { getLyrics: () => lines, getTrackMeta: () => meta, getCurrentTimeMs: () => 0 };
    const out = [];
    for (const placement of ['sides', 'full', 'left', 'right']) for (const motion of ['smooth', 'koma']) {
      document.body.dataset.jizuraPlacement = placement; document.body.dataset.jizuraMotion = motion;
      tpl.mount(document.querySelector('#host'), tctx); await Promise.resolve();
      for (const time of [1350, 6800, 22350, 301400, 0, 6800]) {
        tpl.onSeek(time, tctx);
        const c = document.querySelector('.jizura-canvas'), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const visible = data.some((v, i) => i % 4 === 3 && v > 0);
        out.push({ placement, motion, time, visible, image: c.toDataURL('image/png'), cut: tpl.debugLastDrawn() });
      }
      tpl.destroy();
    }
    return out;
  });
  await page.close(); assert.deepEqual(errors, []);
  return results;
}

(async () => {
  assert(process.argv[2], 'Provide the baseline engine path.');
  const baselinePath = path.resolve(process.argv[2]), candidatePath = path.join(__dirname, '../public/vendor/jizura/jizura-engine.js');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JIZURA_BROWSER || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const baseline = await prepare(browser, baselinePath), candidate = await prepare(browser, candidatePath);
    const before = await measure(baseline.page), after = await measure(candidate.page);
    const beforeFrames = await frames(baseline.page), afterFrames = await frames(candidate.page);
    assert(beforeFrames.some(f => f.layout === 'center' && f.fraction === 0.5 && f.visible), 'blank engine frames');
    assert.deepEqual(afterFrames, beforeFrames, 'engine frames changed');
    const beforeAdapter = await adapterFrames(browser, baselinePath), afterAdapter = await adapterFrames(browser, candidatePath);
    assert(beforeAdapter.some(f => f.visible), 'blank adapter frames');
    assert.deepEqual(afterAdapter, beforeAdapter, 'adapter frames/seek behavior changed');
    assert.deepEqual(baseline.errors, []); assert.deepEqual(candidate.errors, []);
    assert(after.metricQueries < before.metricQueries, 'no metric query reduction');
    assert(after.eventTimeReadsPerFrame < before.eventTimeReadsPerFrame, 'no event scan reduction');
    console.log(JSON.stringify({ browser: await browser.version(), softwareRendering: true, before, after, layoutCpuReductionPercent: +(100 * (1 - after.layoutMedianMs / before.layoutMedianMs)).toFixed(1), identicalEngineFrames: afterFrames.filter(f => !f.skipped).length, skippedLayoutCases: afterFrames.filter(f => f.skipped).length, identicalAdapterFrames: afterAdapter.length, consoleErrors: 0, note: 'Microbenchmarks and pixel equivalence; not an OBS FPS benchmark. Fonts use the local browser fallback.' }, null, 2));
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
