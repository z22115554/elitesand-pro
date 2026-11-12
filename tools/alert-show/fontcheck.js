'use strict';
/**
 * 字型打包檢查：把外部網路整個擋掉（模擬離線），確認演出仍用對的字型，而且舞台不會卡住。
 *
 *   node tools/alert-show/fontcheck.js http://localhost:3562 輸出資料夾
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const base = process.argv[2];
  const out = process.argv[3];
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1320,820'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let blocked = 0;
  await context.route((url) => !url.href.startsWith(base), (route) => { blocked += 1; route.abort(); });
  const page = await context.newPage();
  const fail = [];
  const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail.push(label); };
  const t0 = Date.now();
  await page.goto(`${base}/alert-show/stage.html`);
  await page.evaluate(() => window.ready);
  const ms = Date.now() - t0;
  check(ms < 6000, `離線時舞台 ${ms}ms 內就緒（沒被線上字型卡住；擋掉 ${blocked} 個外部請求）`);
  const fonts = await page.evaluate(async () => {
    const want = [["200px 'Dela Gothic One'", '大物降臨!!'], ["900 46px 'Noto Sans TC'", '送出了份訂閱揪團'], ["200px 'Black Han Sans'", '레이드'], ["900 200px 'Noto Sans SC'", '大佬降临'], ["900 46px 'Noto Sans JP'", 'さんが'], ["900 46px 'Noto Sans KR'", '님이'], ["700 76px 'LXGW WenKai TC'", '謝謝你的訂閱'], ["700 60px 'Gaegu'", '감사']];
    const res = [];
    for (const [font, text] of want) { await document.fonts.load(font, text); res.push([font, document.fonts.check(font, text)]); }
    return res;
  });
  for (const [font, ok] of fonts) check(ok, `本機字型可用：${font}`);
  for (const [lang, tier, v, n, t] of [['zh-TW', 'g50', 3, 50, 5.6], ['ja', 'g100', 1, 100, 7.0], ['ko', 'r3', 0, 80, 5.6], ['zh-CN', 'g25', 3, 25, 5.2], ['en', 'sub', 1, 0, 2.0], ['zh-TW', 'g1', 4, 1, 2.6]]) {
    await page.evaluate(({ lang, tier, v, n, t }) => { P.n = n; P.bg = '1'; setTier(tier, v); setLang(lang); setName(lang === 'en' ? 'Hotaru' : '星見ほたる'); draw(t); }, { lang, tier, v, n, t });
    await page.waitForTimeout(250);
    await page.evaluate((t) => draw(t), t);
    await page.screenshot({ path: path.join(out, `offline-${lang}-${tier}-${v}.png`) });
  }
  await browser.close();
  console.log(fail.length ? `\n${fail.length} 項失敗` : '\n全部通過');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
