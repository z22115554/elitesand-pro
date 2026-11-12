'use strict';
/**
 * 顯示卡端的掉格是哪種畫法造成的：把某一類效果關掉再播一次，比較 fps。
 *
 *   node tools/alert-show/gpuexp.js http://localhost:3562 r4:1 g50:4
 *
 * 實驗組：原樣／關 filter（模糊）／關 shadowBlur／兩個都關／關 lighter、screen、overlay 混合。
 */
const { chromium } = require('playwright');
const COUNT = { g1: 1, g5: 5, g10: 10, g25: 25, g50: 50, g100: 100, r1: 5, r2: 20, r3: 80, r4: 500 };

(async () => {
  const base = process.argv[2];
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1300,800'] });
  for (const key of process.argv.slice(3)) {
    const [tier, v] = key.split(':');
    const row = [];
    for (const mode of ['base', 'nofilter', 'noshadow', 'both', 'noblend']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`${base}/alert-show/stage.html`);
      await page.evaluate(() => window.ready);
      const fps = await page.evaluate(({ tier, v, n, mode }) => new Promise((resolve) => {
        const proto = CanvasRenderingContext2D.prototype;
        const off = (prop, value) => { const d = Object.getOwnPropertyDescriptor(proto, prop); Object.defineProperty(proto, prop, { configurable: true, get() { return d.get.call(this); }, set(x) { d.set.call(this, value(x)); } }); };
        if (mode === 'nofilter' || mode === 'both') off('filter', () => 'none');
        if (mode === 'noshadow' || mode === 'both') off('shadowBlur', () => 0);
        if (mode === 'noblend') off('globalCompositeOperation', (x) => (['lighter', 'screen', 'overlay', 'multiply', 'soft-light', 'hard-light', 'color-dodge'].includes(x) ? 'source-over' : x));
        window.__alertStagePerf = null;
        window.__alertStage.play({ id: 'exp', tier, variant: Number(v), n, name: '星見ほたる', muted: true });
        const timer = setInterval(() => { if (window.__alertStagePerf) { clearInterval(timer); resolve(window.__alertStagePerf.fps); } }, 100);
      }), { tier, v, n: COUNT[tier] || 0, mode });
      row.push(`${mode} ${fps}`);
      await page.close();
    }
    console.log(`${key}: ${row.join(' | ')}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
