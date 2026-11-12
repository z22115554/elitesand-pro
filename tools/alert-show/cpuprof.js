'use strict';
/**
 * 看某一種演出的某段時間，JavaScript 時間花在哪些函式上。
 *
 *   node tools/alert-show/cpuprof.js http://localhost:3562 r4:1 5.0 9.0
 */
const { chromium } = require('playwright');
const COUNT = { g1: 1, g5: 5, g10: 10, g25: 25, g50: 50, g100: 100, r1: 5, r2: 20, r3: 80, r4: 500 };

(async () => {
  const [base, key, t0, t1] = process.argv.slice(2);
  const [tier, v] = key.split(':');
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1300,800'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/alert-show/stage.html`);
  await page.evaluate(() => window.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await page.evaluate(({ tier, v, n }) => { P.n = n; setTier(tier, Number(v)); setName('星見ほたる'); draw(1); }, { tier, v, n: COUNT[tier] || 0 });
  await cdp.send('Profiler.start');
  await page.evaluate(({ a, b }) => { for (let t = a; t < b; t += 1 / 30) draw(t); }, { a: Number(t0), b: Number(t1) });
  const { profile } = await cdp.send('Profiler.stop');
  const dt = profile.timeDeltas; const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n)));
  const name = (n) => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`;
  /* 內建函式（drawImage 等）記在呼叫它的那個函式名下，才看得出是誰在貼圖 */
  profile.samples.forEach((id, i) => { const n = byId.get(id); const p = parent.get(id); const k = n.callFrame.url ? name(n) : `${name(n).split(':')[0]} <- ${p ? name(p) : '?'}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`== ${key} ${t0}-${t1}s  總計 ${(total / 1000).toFixed(0)}ms`);
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, us]) => console.log(`${(us / total * 100).toFixed(1).padStart(5)}%  ${k}`));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
