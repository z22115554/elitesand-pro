'use strict';
/**
 * 端到端檢查：面板送出試播 → 伺服器排佇列 → /display 的內嵌舞台真的演出 → 演完清空。
 *
 *   node tools/alert-show/e2e.js http://localhost:3562 [輸出資料夾]
 *
 * 要先啟動伺服器（用隔離的資料夾）。會開一個看得到的 Chrome 視窗，跑完自動關。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const base = process.argv[2] || 'http://localhost:3000';
  const outDir = process.argv[3] || path.join(__dirname, '..', '..', '.local', 'alert-show-e2e');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1320,820', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const fail = [];
  const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) fail.push(label); };

  const panel = await context.newPage();
  panel.on('pageerror', (e) => console.log('[panel error]', e.message));
  await panel.goto(`${base}/`);
  await panel.waitForFunction(() => typeof SocketClient !== 'undefined' && SocketClient.isConnected && SocketClient.isConnected(), null, { timeout: 15000 }).catch(() => {});
  const send = (event, payload) => panel.evaluate(({ event, payload }) => new Promise((resolve) => SocketClient.sendWithCallback(event, payload, resolve)), { event, payload });

  const display = await context.newPage();
  const errors = [];
  display.on('pageerror', (e) => errors.push(e.message));
  await display.goto(`${base}/display`);
  await display.waitForTimeout(1500);

  // 1. 沒開演出時不載入舞台
  await send('overlay-show:settings:update', { alerts: { subEnabled: false, giftEnabled: false }, raid: { enabled: false, mode: 'card' } });
  await display.reload(); await display.waitForTimeout(1500);
  check(await display.locator('#overlay-show-stage').count() === 0, '沒開演出：/display 不載入舞台');

  // 2. 開了以後 /display 會先把舞台載好
  const saved = await send('overlay-show:settings:update', { alerts: { subEnabled: true, giftEnabled: true, volume: 40 } });
  check(saved && saved.ok && saved.settings.alerts.giftEnabled === true, '面板可以存設定');
  await display.waitForSelector('#overlay-show-stage', { state: 'attached', timeout: 8000 }).then(() => check(true, '開了演出：/display 預先載入舞台'), () => check(false, '開了演出：/display 預先載入舞台'));
  const frame = () => display.frames().find((f) => f.url().includes('/alert-show/stage.html'));
  await display.waitForFunction(() => { const f = document.getElementById('overlay-show-stage'); return f && f.contentWindow && f.contentWindow.VARS; }, null, { timeout: 15000 });
  await frame().evaluate(() => window.ready);

  // 3. 試播一支全畫面演出：畫布真的有東西、演完清空
  const alpha = () => frame().evaluate(() => { const c = document.getElementById('c'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) n += 1; return n; });
  check(await alpha() === 0, '演出前畫布是空的（透明）');
  const tested = await send('overlay-show:test', { kind: 'alert', tier: 'g25', variant: 1, count: 30, name: '星見ほたる' });
  check(tested && tested.ok, '面板試播指令被接受');
  await display.waitForTimeout(4200);
  const mid = await alpha();
  check(mid > 500, `演出中畫布有畫面（取樣到 ${mid} 個不透明點）`);
  await display.screenshot({ path: path.join(outDir, 'display-g25-1.png') });
  await display.waitForTimeout(4500);
  check(await alpha() === 0, '演完畫布清空，不留殘影');

  // 4. 略過：演到一半按「收掉目前演出」要馬上清空
  await send('overlay-show:test', { kind: 'alert', tier: 'g100', variant: 2, count: 100, name: 'LongNameViewer_1234567890' });
  await display.waitForTimeout(3000);
  check(await alpha() > 500, '第二支演出開始');
  await send('overlay-show:skip', {});
  await display.waitForTimeout(600);
  check(await alpha() === 0, '按略過後畫布馬上清空');

  // 5. 不認得的等級要被拒絕；手機遙控器／顯示端不能觸發
  const bad = await send('overlay-show:test', { kind: 'alert', tier: 'nope', variant: 0 });
  check(bad && bad.ok === false, '不認得的等級被拒絕');

  // 6. 訂閱小卡＋揪團全畫面
  await send('overlay-show:settings:update', { raid: { enabled: true, mode: 'show' } });
  await send('overlay-show:test', { kind: 'alert', tier: 'sub', variant: 2, name: 'ひなた' });
  await display.waitForTimeout(1800);
  await display.screenshot({ path: path.join(outDir, 'display-sub-2.png') });
  check(await alpha() > 50, '訂閱小卡有畫面');
  await display.waitForTimeout(3200);
  await send('overlay-show:test', { kind: 'raid' });
  await display.waitForTimeout(3000);
  await display.screenshot({ path: path.join(outDir, 'display-raid-show.png') });
  check(await alpha() > 200, '揪團設成全畫面演出時，試播走舞台');
  await send('overlay-show:skip', {});
  await send('overlay-show:settings:update', { raid: { enabled: false, mode: 'card' }, alerts: { subEnabled: false, giftEnabled: false, volume: 70 } });

  check(errors.length === 0, `/display 沒有腳本錯誤${errors.length ? '：' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fail.length ? `\n${fail.length} 項失敗` : '\n全部通過');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
