'use strict';
/**
 * 找出某段時間內是哪個繪圖函式拖慢顯示卡：一次把一個函式換成空函式，量那段時間的 fps。
 *
 *   node tools/alert-show/stubexp.js http://localhost:3562 r4:1 5.0 8.5 rainbowBG2 title3D confetti ...
 *
 * 第一行是原樣（基準）。某個函式關掉後 fps 明顯上升，它就是兇手。
 */
const { chromium } = require('playwright');
const COUNT = { g1: 1, g5: 5, g10: 10, g25: 25, g50: 50, g100: 100, r1: 5, r2: 20, r3: 80, r4: 500 };

(async () => {
  const [base, key, t0, t1, ...stubs] = process.argv.slice(2);
  const [tier, v] = key.split(':');
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1300,800'] });
  for (const stub of ['(原樣)', ...stubs]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${base}/alert-show/stage.html`);
    await page.evaluate(() => window.ready);
    const out = await page.evaluate(({ tier, v, n, t0, t1, stub }) => new Promise((resolve) => {
      let note = '';
      for (const name of stub.split('+')) {
        if (name.startsWith('(')) continue;
        if (typeof window[name] === 'function') window[name] = function () {}; else note += ` [${name} 不是全域函式]`;
      }
      let frames = 0;
      const orig = window.draw;
      window.draw = (t) => { orig(t); if (t >= t0 && t < t1) frames += 1; };
      window.__alertStagePerf = null;
      window.__alertStage.play({ id: 'stub', tier, variant: Number(v), n, name: '星見ほたる', muted: true });
      const timer = setInterval(() => { if (window.__alertStagePerf) { clearInterval(timer); resolve(`${Math.round(frames / (t1 - t0))} fps${note}`); } }, 100);
    }), { tier, v, n: COUNT[tier] || 0, t0: Number(t0), t1: Number(t1), stub });
    console.log(`${stub.padEnd(24)} ${out}`);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
