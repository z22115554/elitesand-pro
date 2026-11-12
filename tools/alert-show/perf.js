'use strict';
/**
 * 量每一種演出即時播放的流暢度（開一個看得到的 Chrome 視窗，照實際時間播一遍）。
 *
 *   node tools/alert-show/perf.js http://localhost:3562 [等級:第幾種 ...]
 *
 * 輸出每種演出的實際 fps、超過 34ms 的格數、最長一格、draw() 的平均與 95 百分位耗時。
 * 開發機的數字只能當相對比較；真 OBS 要另外實機看。
 */
const { chromium } = require('playwright');

const COUNT = { g1: 1, g5: 5, g10: 10, g25: 25, g50: 50, g100: 100, r1: 5, r2: 20, r3: 80, r4: 500 };

(async () => {
  const base = process.argv[2] || 'http://localhost:3000';
  const only = process.argv.slice(3);
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1300,800', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}/alert-show/stage.html`);
  await page.evaluate(() => window.ready);
  const catalog = await (await fetch(`${base}/alert-show/catalog.json`)).json();
  const jobs = [];
  for (const tier of catalog.tiers) for (const v of tier.variants) {
    const key = `${tier.id}:${v.index}`;
    if (!only.length || only.includes(key)) jobs.push({ tier: tier.id, variant: v.index, name: v.name, dur: v.dur });
  }
  const rows = [];
  for (const job of jobs) {
    const result = await page.evaluate(({ tier, variant, n }) => new Promise((resolve) => {
      const ms = [];
      const orig = window.draw;
      window.draw = (t) => { const a = performance.now(); orig(t); ms.push(performance.now() - a); };
      window.__alertStagePerf = null;
      window.__alertStage.play({ id: 'perf', tier, variant, n, name: '星見ほたる', muted: true });
      const timer = setInterval(() => {
        const p = window.__alertStagePerf;
        if (!p) return;
        clearInterval(timer);
        window.draw = orig;
        ms.sort((a, b) => a - b);
        resolve({ fps: p.fps, slow: p.slowFrames, worst: p.worstGapMs, frames: p.frames, avg: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length), p95: ms[Math.floor(ms.length * 0.95)] || 0 });
      }, 100);
    }), { tier: job.tier, variant: job.variant, n: COUNT[job.tier] || 0 });
    const line = `${(job.tier + ':' + job.variant).padEnd(8)} fps ${String(result.fps).padStart(3)}  慢格 ${String(result.slow).padStart(3)}/${String(result.frames).padEnd(4)} 最長 ${String(result.worst).padStart(4)}ms  draw 平均 ${result.avg.toFixed(1).padStart(5)}ms p95 ${result.p95.toFixed(1).padStart(5)}ms  ${job.name}`;
    console.log(line);
    rows.push({ ...job, ...result });
  }
  const bad = rows.filter((r) => r.fps < 50);
  console.log(`\n共 ${rows.length} 種；低於 50fps 的 ${bad.length} 種：${bad.map((r) => `${r.tier}:${r.variant}(${r.fps})`).join(' ')}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
