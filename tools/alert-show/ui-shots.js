'use strict';
/**
 * 面板「訂閱與贈訂演出」介面的操作檢查＋截圖（給人看版面用）。
 *
 *   node tools/alert-show/ui-shots.js http://localhost:3562 輸出資料夾 [語言] [light|dark]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const base = process.argv[2];
  const out = process.argv[3];
  const lang = process.argv[4] || 'zh-TW';
  const theme = process.argv[5] || 'dark';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1500,950', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fail = [];
  const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail.push(label); };
  const tag = `${lang}-${theme}`;

  await page.goto(`${base}/?lang=${lang}`);
  await page.addStyleTag({ content: '#tour-welcome, .tour-welcome-layer { display: none !important; }' }); /* 首次使用導覽出現的時間不固定，直接用樣式藏掉 */
  await page.waitForTimeout(1500);
  await page.evaluate((theme) => { document.documentElement.setAttribute('data-theme', theme); document.querySelectorAll('#tour-welcome, .tour-welcome-layer').forEach((n) => n.remove()); /* 首次使用導覽會擋住點擊，測試環境直接拿掉 */ }, theme);
  await page.evaluate(() => { const nav = document.querySelector('[data-nav="public-request"]'); if (nav) nav.click(); });
  await page.waitForTimeout(600);
  const group = page.locator('#alert-show-group');
  await group.scrollIntoViewIfNeeded();
  check(await group.isVisible(), '卡片上看得到「訂閱與贈訂演出」');
  await page.locator('#overlay-show-card').screenshot({ path: path.join(out, `card-${tag}.png`) });

  // 開關與音量會存到伺服器
  await page.locator('#alert-show-gift-enabled').evaluate((el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#alert-show-volume').evaluate((el) => { el.value = '45'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => new Promise((r) => SocketClient.sendWithCallback('overlay-show:settings:get', {}, r)));
  check(saved.settings.alerts.giftEnabled === true && saved.settings.alerts.volume === 45, '開關與音量有存到伺服器');
  check((await page.locator('#alert-show-volume-value').textContent()) === '45', '音量數字跟著變');

  // 揪團改成全畫面演出：小卡的三個欄位收起來
  await page.selectOption('#overlay-show-raid-mode', 'show');
  await page.waitForTimeout(300);
  check(await page.locator('#overlay-show-raid-style').isHidden(), '選全畫面演出後，小卡外觀欄位收起來');
  await page.locator('#overlay-show-card').screenshot({ path: path.join(out, `card-raidshow-${tag}.png`) });

  // 視窗
  await page.click('#alert-show-open');
  await page.waitForSelector('#alert-show-tiers .alert-tier');
  check(await page.locator('#alert-show-tiers .alert-tier').count() === 6, '贈訂分頁列出 6 級');
  check(await page.locator('#alert-show-tiers .alert-variant').count() === 30, '贈訂分頁列出 30 種演出');
  await page.screenshot({ path: path.join(out, `modal-gift-${tag}.png`) });

  // 門檻：填反會被往上推
  const g10 = page.locator('[data-focus-key="min-g10"]');
  await g10.fill('3'); await g10.dispatchEvent('change');
  await page.waitForTimeout(400);
  const v = await page.locator('[data-focus-key="min-g10"]').inputValue();
  check(Number(v) >= 6, `門檻填得比上一級低會自動修正（g10 變成 ${v}）`);
  await page.click('#alert-show-preset-small'); await page.waitForTimeout(400);
  check(await page.locator('[data-focus-key="min-g100"]').inputValue() === '50', '小型頻道預設：頂級門檻 50');
  await page.click('#alert-show-preset-std'); await page.waitForTimeout(400);
  check(await page.locator('[data-focus-key="min-g100"]').inputValue() === '100', '一般頻道預設：頂級門檻 100');

  // 勾選：全部取消會被擋下
  for (let i = 0; i < 5; i++) { await page.locator(`[data-focus-key="v-g5-${i}"]`).uncheck().catch(() => {}); await page.waitForTimeout(250); }
  const left = await page.evaluate(() => [...document.querySelectorAll('[data-focus-key^="v-g5-"]')].filter((b) => b.checked).length);
  check(left === 1, `同一級全部取消時會留下一種（剩 ${left} 種勾著）`);
  for (let i = 0; i < 5; i++) { await page.locator(`[data-focus-key="v-g5-${i}"]`).check().catch(() => {}); await page.waitForTimeout(200); }

  // 預覽
  await page.click('[data-focus-key="p-g25-1"]');
  await page.waitForTimeout(4600);
  const frame = page.frames().find((f) => f.url().includes('/alert-show/stage.html'));
  const painted = frame ? await frame.evaluate(() => { const c = document.getElementById('c'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 388) if (d[i] > 8) n++; return n; }) : 0;
  check(painted > 500, '按預覽後，預覽框真的有畫面');
  await page.screenshot({ path: path.join(out, `modal-preview-${tag}.png`) });
  check(!(await page.locator('#alert-show-obs-test').isDisabled()), '選了演出後「在 OBS 試播」可以按');

  await page.click('#alert-show-tabs [data-group="sub"]'); await page.waitForTimeout(300);
  check(await page.locator('#alert-show-presets').isHidden(), '訂閱分頁沒有門檻預設');
  await page.screenshot({ path: path.join(out, `modal-sub-${tag}.png`) });
  await page.click('#alert-show-tabs [data-group="raid"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `modal-raid-${tag}.png`) });

  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check(await page.locator('#alert-show-modal').isHidden(), '按 Esc 關閉視窗');

  // 窄視窗
  await page.setViewportSize({ width: 760, height: 900 });
  await page.click('#alert-show-open'); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `modal-narrow-${tag}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, '窄視窗沒有水平捲軸');
  await page.keyboard.press('Escape');

  // 還原
  await page.evaluate(() => new Promise((r) => SocketClient.sendWithCallback('overlay-show:settings:update', { raid: { mode: 'card', enabled: false }, alerts: { subEnabled: false, giftEnabled: false, volume: 70, off: [] } }, r)));
  check(errors.length === 0, `面板沒有腳本錯誤${errors.length ? '：' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fail.length ? `\n${fail.length} 項失敗` : '\n全部通過');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
