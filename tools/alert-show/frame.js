'use strict';
/**
 * 截某一種演出在某個時間點的單格（含模擬直播背景），看版面用。
 *
 *   node tools/alert-show/frame.js http://localhost:3562 輸出.png g25:1 5.5 [語言] [份數] [名字]
 */
const { chromium } = require('playwright');

(async () => {
  const [base, out, key, t, lang = 'zh-TW', n = '25', name = '星見ほたる'] = process.argv.slice(2);
  const [tier, v] = key.split(':');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${base}/alert-show/stage.html`);
  await page.evaluate(() => window.ready);
  for (let pass = 0; pass < 3; pass++) {   // 多畫幾次：快取要同一個內容出現第二次才建，字型也可能晚一點到
    await page.evaluate(({ tier, v, n, lang, name, t }) => { P.n = Number(n); P.bg = '1'; setTier(tier, Number(v)); setLang(lang); setName(name); draw(Number(t)); }, { tier, v, n, lang, name, t });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: out });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
