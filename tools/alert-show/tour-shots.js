'use strict';
/**
 * 觀眾點歌頁教學：用全新的瀏覽器資料（第一次使用）點進觀眾點歌頁，確認教學自動開始，逐步截圖到完成。
 *
 *   node tools/alert-show/tour-shots.js http://localhost:3562 輸出資料夾 [語言]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [base, out, lang = 'zh-TW'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1500,950'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  // 主線教學已看過（不然第一次開面板會先跳主線的歡迎畫面）；觀眾點歌頁的教學沒看過
  await context.addInitScript(() => {
    try {
      localStorage.setItem('elite-interactive-tour-v3', JSON.stringify({ version: 6, status: 'completed', currentStep: 0 }));
      localStorage.removeItem('elite-public-request-tour-v1');
    } catch (_) { /* ignore */ }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fail = [];
  const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail.push(label); };
  await page.goto(`${base}/?lang=${lang}`);
  await page.waitForTimeout(2000);
  check(await page.locator('#tour-root').isHidden(), '在別的頁面時不會自動開始');
  // 全新環境會先跳「設定 PIN」的提醒；教學會等它關掉才開始（跟真的第一次使用一樣）
  if (await page.locator('#pin-onboarding-skip').isVisible().catch(() => false)) await page.click('#pin-onboarding-skip');
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-nav="public-request"]').click());
  await page.waitForTimeout(1500);
  console.log('  畫面上的對話框：', await page.evaluate(() => JSON.stringify([...document.querySelectorAll('.modal, dialog, [role=dialog], [role=alertdialog]')].filter((e) => e.offsetWidth && !e.hidden).map((e) => e.id || e.className)) + ' 頁=' + document.querySelector('.view.is-active[data-view]')?.dataset.view + ' 教學狀態=' + localStorage.getItem('elite-public-request-tour-v1')));
  await page.waitForSelector('#tour-card', { state: 'visible', timeout: 10000 }).then(() => check(true, '第一次點進觀眾點歌頁，教學自動開始'), () => check(false, '第一次點進觀眾點歌頁，教學自動開始'));
  const steps = [];
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(900);
    if (!(await page.locator('#tour-card').isVisible())) break;
    const info = await page.evaluate(() => {
      const card = document.getElementById('tour-card').getBoundingClientRect();
      const hl = document.getElementById('tour-highlight').getBoundingClientRect();
      const overlap = !(card.right <= hl.left || card.left >= hl.right || card.bottom <= hl.top || card.top >= hl.bottom);
      const inside = card.left >= hl.left && card.right <= hl.right && card.top >= hl.top && card.bottom <= hl.bottom;
      return {
        title: document.getElementById('tour-title').textContent.trim(),
        progress: document.getElementById('tour-progress').textContent.trim(),
        inView: card.top >= 0 && card.left >= 0 && card.bottom <= innerHeight && card.right <= innerWidth,
        overlap, inside,
        hl: [Math.round(hl.width), Math.round(hl.height)],
      };
    });
    steps.push(info);
    await page.screenshot({ path: path.join(out, `tour-${lang}-${String(i + 1).padStart(2, '0')}.png`) });
    console.log(`  ${info.progress}  ${info.title}  框 ${info.hl.join('x')}${info.overlap && !info.inside ? '  （導覽卡壓到目標）' : ''}${info.inView ? '' : '  （導覽卡超出畫面）'}`);
    await page.click('#tour-next');
  }
  check(steps.length === 9, `九個步驟都走完（${steps.length}）`);
  check(steps.every((s) => s.inView), '每一步的導覽卡都在畫面內');
  check(steps.every((s) => !s.overlap || s.inside), '導覽卡沒有壓住要看的東西（放在大卡片裡面的除外）');
  check(steps.every((s) => s.hl[0] > 20 && s.hl[1] > 20), '每一步都有框到東西');
  await page.waitForTimeout(800);
  check(await page.locator('#tour-complete').isVisible(), '完成畫面出現');
  await page.screenshot({ path: path.join(out, `tour-${lang}-complete.png`) });
  await page.click('#tour-complete-use');
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-nav="karaoke"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-nav="public-request"]').click());
  await page.waitForTimeout(1500);
  check(await page.locator('#tour-root').isHidden(), '看完之後再點進來不會再自動開始');
  await page.click('#public-request-start-tour');
  await page.waitForTimeout(1200);
  check(await page.locator('#tour-card').isVisible(), '按「教學」可以再看一次');
  check(errors.length === 0, `沒有腳本錯誤${errors.length ? '：' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fail.length ? `\n${fail.length} 項失敗` : '\n全部通過');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
