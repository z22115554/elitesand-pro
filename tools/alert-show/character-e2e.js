'use strict';
/**
 * 自訂角色圖的端到端檢查：面板上傳 → 伺服器存檔 → 設定 → OBS 顯示端的舞台換成新圖 → 還原。
 *
 *   node tools/alert-show/character-e2e.js http://localhost:3562 測試圖資料夾 輸出資料夾
 *
 * 測試圖資料夾要有 char.png（去背角色）、mascot.png（去背吉祥物）、opaque.png（沒有透明背景）、fake.png（不是圖）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [base, imgDir, out] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1500,950', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  const fail = [];
  const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail.push(label); };
  const errors = [];

  const panel = await context.newPage();
  panel.on('pageerror', (e) => errors.push('panel: ' + e.message));
  await panel.goto(`${base}/`);
  await panel.addStyleTag({ content: '#tour-welcome, .tour-welcome-layer { display: none !important; }' });
  await panel.waitForTimeout(1500);
  const send = (event, payload) => panel.evaluate(({ event, payload }) => new Promise((r) => SocketClient.sendWithCallback(event, payload, r)), { event, payload });
  const settings = async () => (await send('overlay-show:settings:get', {})).settings.alerts.character;
  // 記下面板跳出的提示（提示會被下一則蓋掉，直接讀畫面讀不到）
  await panel.evaluate(() => { window.__toasts = []; const orig = window.AppShared.showToast; window.AppShared.showToast = (m, type) => { window.__toasts.push(String(m)); return orig(m, type); }; });
  const toasts = () => panel.evaluate(() => window.__toasts.join(' | '));

  // 從乾淨狀態開始
  await panel.evaluate(() => Promise.all(['girl', 'mascot'].map((k) => PinAuth.fetchWithPin(`/api/alert-show/character/${k}`, { method: 'DELETE' }))));
  await send('overlay-show:settings:update', { alerts: { giftEnabled: true, character: { girl: 'default', mascot: 'default', face: { x: 0.49, y: 0.15, s: 0.12 } } } });

  // OBS 顯示端
  const display = await context.newPage();
  display.on('pageerror', (e) => errors.push('display: ' + e.message));
  await display.goto(`${base}/display`);
  await display.waitForFunction(() => { const f = document.getElementById('overlay-show-stage'); return f && f.contentWindow && f.contentWindow.VARS; }, null, { timeout: 15000 });
  const stage = () => display.frames().find((f) => f.url().includes('/alert-show/stage.html'));
  await stage().evaluate(() => window.ready);
  await display.waitForTimeout(800);
  const builtinSize = await stage().evaluate(() => [GIRL.width, GIRL.height]);

  // 面板：打開角色分頁
  await panel.evaluate(() => { const nav = document.querySelector('[data-nav="public-request"]'); if (nav) nav.click(); });
  await panel.click('#alert-show-open');
  await panel.click('#alert-show-tabs [data-group="character"]');
  await panel.waitForTimeout(600);
  check(await panel.locator('#alert-show-character').isVisible(), '角色分頁顯示');
  check(await panel.locator('#alert-show-tiers').isHidden(), '角色分頁時演出清單收起來');
  check(await panel.locator('#alert-show-girl-reset').isHidden(), '內建角色時不顯示「用內建角色」');
  await panel.screenshot({ path: path.join(out, 'char-tab-default.png') });

  // 失敗路徑：沒有透明背景、不是圖
  const upload = async (file, button) => {
    const chooser = panel.waitForEvent('filechooser');
    await panel.click(button);
    await (await chooser).setFiles(path.join(imgDir, file));
    await panel.waitForTimeout(1500);
  };
  await upload('opaque.png', '#alert-show-girl-upload');
  check((await settings()).girl === 'default', '沒有透明背景的圖被擋下（設定沒變）');
  check(/透明背景/.test(await toasts()), `有說明為什麼不行（${await toasts()}）`);
  await upload('fake.png', '#alert-show-girl-upload');
  check((await settings()).girl === 'default', '不是圖片的檔案被擋下');
  const direct = await panel.evaluate(async () => {
    const form = new FormData(); form.append('image', new Blob(['hello world, definitely not a png file at all'], { type: 'image/png' }), 'x.png');
    const r = await PinAuth.fetchWithPin('/api/alert-show/character/girl', { method: 'POST', body: form }); return r.status;
  });
  check(direct === 400, `繞過面板直接送假圖，伺服器也會擋（HTTP ${direct}）`);
  const badKind = await panel.evaluate(async () => (await PinAuth.fetchWithPin('/api/alert-show/character/..%2Fstate', { method: 'DELETE' })).status);
  check(badKind === 400 || badKind === 404, `不認得的種類被拒絕（HTTP ${badKind}）`);

  // 上傳角色
  await upload('char.png', '#alert-show-girl-upload');
  await panel.waitForTimeout(800);
  const c1 = await settings();
  check(c1.girl === 'custom' && c1.rev > 0, `上傳後設定改成自訂（rev ${c1.rev}）`);
  check(c1.face.y < 0.2, `直長的全身圖，臉的預設位置在上面（y=${c1.face.y}）`);
  const served = await panel.evaluate(async (rev) => { const r = await fetch(`/alert-show/custom/girl?rev=${rev}`); const b = await r.blob(); return [r.status, b.type, b.size]; }, c1.rev);
  check(served[0] === 200 && served[1] === 'image/webp', `讀圖路由回 WebP（${served.join(' ')}）`);
  check(!(await panel.locator('#alert-show-girl-reset').isHidden()), '自訂後顯示「用內建角色」');

  // 點臉的位置
  const box = await panel.locator('#alert-show-face-canvas').boundingBox();
  await panel.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await panel.keyboard.press('ArrowDown');
  await panel.waitForTimeout(900);
  const c2 = await settings();
  check(Math.abs(c2.face.x - 0.5) < 0.08 && c2.face.y > 0.1, `點擊＋方向鍵改了臉的位置並存進伺服器（${JSON.stringify(c2.face)}）`);
  await panel.screenshot({ path: path.join(out, 'char-tab-custom.png') });

  // OBS 顯示端的舞台換成新圖
  await display.waitForTimeout(1500);
  const stageState = await stage().evaluate(() => ({ size: [GIRL.width, GIRL.height], face: { ...FACE } }));
  check(stageState.size.join() !== builtinSize.join(), `OBS 舞台的角色換成上傳的圖（${builtinSize.join('x')} → ${stageState.size.join('x')}）`);
  check(Math.abs(stageState.face.y - c2.face.y) < 0.001, 'OBS 舞台的臉部位置跟面板一致');

  // 吉祥物：不使用 → 自訂上傳
  await panel.click('#alert-show-mascot-mode [data-mascot="none"]');
  await panel.waitForTimeout(800);
  check((await settings()).mascot === 'none', '吉祥物可以選不使用');
  await display.waitForTimeout(800);
  check(await stage().evaluate(() => MASCOT === null), 'OBS 舞台的吉祥物拿掉了');
  const chooser = panel.waitForEvent('filechooser');
  await panel.click('#alert-show-mascot-mode [data-mascot="custom"]');
  await (await chooser).setFiles(path.join(imgDir, 'mascot.png'));
  await panel.waitForTimeout(1800);
  check((await settings()).mascot === 'custom', '沒上傳過自訂吉祥物時，選「自訂」會請你選圖，上傳後改成自訂');
  await display.waitForTimeout(1200);
  check(await stage().evaluate(() => !!MASCOT && Math.abs(MASCOT.width - MASCOT.height) < 40), 'OBS 舞台換成自訂吉祥物（正方形的星星）');

  // 在 OBS 播一次，截圖看臉部特寫
  await send('overlay-show:test', { kind: 'alert', tier: 'g10', variant: 3, count: 10, name: '測試角色' });
  await display.waitForTimeout(5000);
  await display.screenshot({ path: path.join(out, 'display-custom-vs.png') });
  await send('overlay-show:skip', {});
  await panel.screenshot({ path: path.join(out, 'char-tab-mascot.png') });

  // 還原
  await panel.click('#alert-show-girl-reset');
  await panel.click('#alert-show-mascot-mode [data-mascot="default"]');
  await panel.waitForTimeout(1200);
  const c3 = await settings();
  check(c3.girl === 'default' && c3.mascot === 'default' && c3.face.y === 0.15, '還原成內建角色、臉的位置也回預設');
  const gone = await panel.evaluate(async () => (await fetch('/alert-show/custom/girl?rev=1')).status);
  check(gone === 404, '還原後自訂角色圖檔案刪掉了');
  await display.waitForTimeout(1500);
  check((await stage().evaluate(() => [GIRL.width, GIRL.height])).join() === builtinSize.join(), 'OBS 舞台換回內建角色');

  await send('overlay-show:settings:update', { alerts: { giftEnabled: false } });
  check(errors.length === 0, `沒有腳本錯誤${errors.length ? '：' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fail.length ? `\n${fail.length} 項失敗` : '\n全部通過');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
