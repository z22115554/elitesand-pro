'use strict';
/**
 * 五語檢查：在每種語言下打開觀眾點歌頁的「觀眾演出」卡片與「演出與門檻」視窗的每一個分頁，
 * 把畫面上的字、title、aria-label、placeholder 全部抓下來，找出沒翻到的。
 *
 *   node tools/alert-show/i18n-audit.js http://localhost:3562 輸出資料夾
 *
 * 判斷方式：
 * - en、ko：出現任何漢字（觀眾名字、範例名字除外）就算沒翻。
 * - ja、zh-CN：同一個位置的字跟繁中一模一樣、而且含漢字，就列出來給人看（日文漢字或簡繁同形可能是對的）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const LOCALES = ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'];
const TABS = ['sub', 'gift', 'raid', 'character', 'timing'];
const HAN = /[㐀-鿿]/;
const IGNORE = /^(小螢|小萤|ほたる|星見ほたる)$/; // 預覽用的範例名字是使用者可改的內容

(async () => {
  const [base, out] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1500,950'] });
  const collected = {};
  for (const locale of LOCALES) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    await page.goto(`${base}/?lang=${locale}`);
    await page.addStyleTag({ content: '#tour-welcome, .tour-welcome-layer, #tour-root { display: none !important; }' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const nav = document.querySelector('[data-nav="public-request"]'); if (nav) nav.click(); });
    await page.waitForTimeout(500);
    // 讓卡片上的等待提示也出現一次（用不會真的演出的方式：直接塞假狀態給畫面）
    const grab = (scope) => page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const items = [];
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
      const walk = (node) => {
        if (node.nodeType === 3) {
          const text = node.textContent.replace(/\s+/g, ' ').trim();
          if (text && node.parentElement && visible(node.parentElement)) items.push(['text', text]);
          return;
        }
        if (node.nodeType !== 1) return;
        if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
        for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
          const v = node.getAttribute(attr);
          if (v && visible(node)) items.push([attr, v]);
        }
        if (node.tagName === 'OPTION') { items.push(['option', node.textContent.trim()]); return; }
        node.childNodes.forEach(walk);
      };
      if (root) walk(root);
      return items;
    }, scope);
    const rows = [];
    rows.push(...(await grab('#overlay-show-card')).map((r) => ['card', ...r]));
    await page.click('#alert-show-open');
    await page.waitForTimeout(600);
    for (const tab of TABS) {
      await page.click(`#alert-show-tabs [data-group="${tab}"]`);
      await page.waitForTimeout(400);
      rows.push(...(await grab('#alert-show-modal')).map((r) => [tab, ...r]));
    }
    await page.screenshot({ path: path.join(out, `modal-timing-${locale}.png`) });
    await page.click('#alert-show-tabs [data-group="character"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `modal-character-${locale}.png`) });
    await page.keyboard.press('Escape');
    await page.locator('#overlay-show-card').screenshot({ path: path.join(out, `card-${locale}.png`) });
    collected[locale] = rows;
    await page.close();
  }
  await browser.close();

  const report = [];
  let hard = 0;
  for (const locale of LOCALES.slice(1)) {
    const rows = collected[locale];
    const zh = collected['zh-TW'];
    const flagged = [];
    rows.forEach((row, i) => {
      const text = row[2];
      if (!HAN.test(text) || IGNORE.test(text)) return;
      if (locale === 'en' || locale === 'ko') { flagged.push(`  [沒翻] ${row[0]} ${row[1]}: ${text}`); hard += 1; return; }
      const same = zh[i] && zh[i][2] === text;
      if (same) flagged.push(`  [跟繁中相同，請看] ${row[0]} ${row[1]}: ${text}`);
    });
    report.push(`== ${locale}：${rows.length} 段文字，列出 ${flagged.length} 段`, ...flagged);
  }
  const counts = LOCALES.map((l) => `${l}=${collected[l].length}`).join(' ');
  report.unshift(`各語言抓到的段數：${counts}（數量不同代表某語言少了元素）`);
  fs.writeFileSync(path.join(out, 'i18n-audit.txt'), report.join('\n') + '\n');
  console.log(report.join('\n'));
  console.log(hard ? `\nen／ko 有 ${hard} 段沒翻` : '\nen／ko 沒有漏翻');
  process.exit(hard ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
