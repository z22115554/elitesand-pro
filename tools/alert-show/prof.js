'use strict';
/**
 * 找出某一種演出「哪一段時間」掉格：照實際時間播一遍，統計每 0.5 秒畫出幾格。
 *
 *   node tools/alert-show/prof.js http://localhost:3562 g50:2 [g100:3 ...]
 *
 * 每個數字是那 0.5 秒內畫出的格數（滿格 30）；後面括號是那段 draw() 的平均毫秒數。
 * 格數少但 draw() 很快，代表慢在顯示卡那一端（模糊濾鏡、大面積混合），不是 JavaScript。
 * 注意：不要用 getImageData 逐格讀回來量，Chrome 會把畫布切成軟體繪製，整個數字失真。
 */
const { chromium } = require('playwright');
const COUNT = { g1: 1, g5: 5, g10: 10, g25: 25, g50: 50, g100: 100, r1: 5, r2: 20, r3: 80, r4: 500 };

(async () => {
  const base = process.argv[2];
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1300,800'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}/alert-show/stage.html`);
  await page.evaluate(() => window.ready);
  for (const key of process.argv.slice(3)) {
    const [tier, v] = key.split(':');
    const out = await page.evaluate(({ tier, v, n }) => new Promise((resolve) => {
      const buckets = [];
      const orig = window.draw;
      window.draw = (t) => {
        const a = performance.now(); orig(t); const d = performance.now() - a;
        const b = Math.floor(t / 0.5);
        (buckets[b] = buckets[b] || { n: 0, ms: 0 }); buckets[b].n += 1; buckets[b].ms += d;
      };
      window.__alertStagePerf = null;
      window.__alertStage.play({ id: 'prof', tier, variant: Number(v), n, name: '星見ほたる', muted: true });
      const timer = setInterval(() => {
        if (!window.__alertStagePerf) return;
        clearInterval(timer); window.draw = orig;
        resolve({ fps: window.__alertStagePerf.fps, buckets: Array.from(buckets, (b) => (b ? [b.n, Math.round(b.ms / b.n)] : [0, 0])) });
      }, 100);
    }), { tier, v, n: COUNT[tier] || 0 });
    console.log(`== ${key} fps ${out.fps}  ` + out.buckets.map(([n, ms], i) => `${(i * 0.5).toFixed(1)}:${n}(${ms})`).join(' '));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
