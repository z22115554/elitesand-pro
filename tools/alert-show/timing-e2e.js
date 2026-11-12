'use strict';
/**
 * 演出時機的端到端檢查：模擬 Twitch 事件、唱歌時等待、暫停／唱完後的延遲、現在演／清掉、演出時 BGM 讓路。
 *
 *   node tools/alert-show/timing-e2e.js http://localhost:3562 BGM測試音檔.mp3 輸出資料夾
 *
 * 用隔離的資料夾跑（會上傳一首 BGM、改觀眾演出設定）。「正在唱歌」是直接送 play:track 給伺服器，不需要真的歌。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [base, bgmFile, out] = process.argv.slice(2);
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
  const fire = (event, payload) => panel.evaluate(({ event, payload }) => SocketClient.send(event, payload), { event, payload });
  const status = async () => (await send('overlay-show:status:get', {})).status;
  const plays = [];
  await panel.exposeFunction('__recordPlay', (m) => plays.push(m));
  await panel.evaluate(() => SocketClient.on('overlay-show:play', (m) => window.__recordPlay({ kind: m.kind, tier: m.payload && m.payload.tier, at: Date.now() })));

  // 先上傳一首測試音（伺服器播放前會確認音檔存在），拿它當「正在唱的歌」
  const bgmBytes = fs.readFileSync(bgmFile).toString('base64');
  const song = await panel.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData(); form.append('files', new Blob([bytes], { type: 'audio/mpeg' }), 'alert-timing-test.mp3');
    const res = await PinAuth.fetchWithPin('/api/upload', { method: 'POST', body: form });
    const text = await res.text();
    const found = []; JSON.parse(text, (k, v) => { if (v && typeof v === 'object' && v.filename && v.id) found.push(v); return v; });
    return found[0] || null;
  }, bgmBytes);
  check(!!song, '測試歌上傳成功');
  const songTrack = { id: song.id, title: song.title || 'Test Song', artist: song.artist || '', filename: song.filename, autoplay: true };
  await send('overlay-show:waiting:clear', {});
  await send('overlay-show:settings:update', { alerts: { subEnabled: true, giftEnabled: false, timing: { singing: 'wait', pauseDelaySec: 1, endDelaySec: 2, bgm: 'duck', bgmDuck: 20 } }, raid: { enabled: true, minViewers: 3, mode: 'show' } });
  await fire('play:stop', { reason: 'test' });
  await panel.waitForTimeout(300);

  // 1. 模擬事件照規則：贈訂沒開 → 不演；揪團人數不夠 → 不演
  let r = await send('overlay-show:simulate', { type: 'gift', count: 12, name: 'Gifter' });
  check(r.ok === false && r.reason === 'disabled', `贈訂開關關著時模擬事件不演（${r.reason}）`);
  r = await send('overlay-show:simulate', { type: 'raid', count: 2, name: 'Tiny' });
  check(r.ok === false && r.reason === 'below-min', `揪團低於最低人數不演（${r.reason}）`);
  await send('overlay-show:settings:update', { alerts: { giftEnabled: true } });
  r = await send('overlay-show:simulate', { type: 'gift', count: 12, name: 'Gifter' });
  check(r.ok && r.tier === 'g10' && !r.waiting, `沒在唱歌：12 份贈訂馬上演大量（${r.tier}）`);
  await panel.waitForTimeout(400);
  check(plays.some((p) => p.tier === 'g10'), 'OBS 收到演出');
  r = await send('overlay-show:simulate', { type: 'gift-anon', count: 1 });
  check(r.ok && r.tier === 'g1', '匿名單份贈訂 → 少量');
  await send('overlay-show:skip', {}); await send('overlay-show:skip', {});

  // 2. 開始唱歌：進來的演出先等
  fire('play:track', songTrack);
  await panel.waitForTimeout(500);
  check((await status()).songPlaying === true, '伺服器知道正在唱歌');
  plays.length = 0;
  r = await send('overlay-show:simulate', { type: 'sub', name: 'NewSub' });
  check(r.ok && r.waiting === true, '唱歌中的新訂閱排進等待');
  r = await send('overlay-show:simulate', { type: 'raid', count: 80, name: 'Raider' });
  check(r.ok && r.waiting === true && r.tier === 'r3', '唱歌中的揪團（80 人＝大）排進等待');
  await panel.waitForTimeout(600);
  check(plays.length === 0, '唱歌中 OBS 沒有收到任何演出');
  check((await status()).waiting === 2, '等待中有 2 個');

  // 卡片上的等待提示
  await panel.evaluate(() => { const nav = document.querySelector('[data-nav="public-request"]'); if (nav) nav.click(); });
  await panel.waitForTimeout(400);
  await panel.locator('#alert-show-group').scrollIntoViewIfNeeded();
  check(await panel.locator('#alert-show-waiting').isVisible(), '卡片顯示「等待中」');
  const waitText = await panel.locator('#alert-show-waiting-text').textContent();
  check(/2/.test(waitText), `等待文字有數量（${waitText}）`);
  await panel.locator('#overlay-show-card').screenshot({ path: path.join(out, 'card-waiting.png') });

  // 3. 暫停 → 1 秒後開始；暫停不到 1 秒又繼續唱 → 繼續等
  fire('play:toggle', false);
  await panel.waitForTimeout(400);
  fire('play:toggle', true);
  await panel.waitForTimeout(1200);
  check(plays.length === 0 && (await status()).waiting === 2, '暫停不到設定秒數又繼續唱：演出繼續等');
  fire('play:toggle', false);
  const t0 = Date.now();
  await panel.waitForTimeout(400);
  const st = await status();
  check(st.releaseAt && st.releaseAt - st.serverNow > 300 && st.releaseAt - st.serverNow <= 1000, `暫停後照「暫停後 1 秒」倒數（剩 ${st.releaseAt - st.serverNow}ms）`);
  await panel.waitForTimeout(1200);
  check(plays.length >= 1 && plays[0].tier === 'sub', `暫停約 1 秒後開始演第一個（${plays.map((p) => p.tier).join(',')}，${plays[0] ? plays[0].at - t0 : '-'}ms）`);
  await panel.screenshot({ path: path.join(out, 'panel-after-release.png') });
  await send('overlay-show:waiting:clear', {}); await send('overlay-show:skip', {}); await send('overlay-show:skip', {});

  // 4. 唱完 → 2 秒；現在演；清掉
  fire('play:toggle', true);
  await panel.waitForTimeout(300);
  plays.length = 0;
  await send('overlay-show:simulate', { type: 'resub', name: 'Again' });
  fire('play:stop', { reason: 'ended' });
  await panel.waitForTimeout(1500);
  check(plays.length === 0, '唱完 1.5 秒還沒演（設定唱完後 2 秒）');
  await panel.waitForTimeout(900);
  check(plays.length === 1, '唱完 2 秒後開始演');
  await send('overlay-show:skip', {});
  fire('play:track', songTrack);
  await panel.waitForTimeout(300);
  plays.length = 0;
  await send('overlay-show:simulate', { type: 'gift', count: 60, name: 'Whale' });
  await panel.click('#alert-show-release');
  await panel.waitForTimeout(500);
  check(plays.length === 1 && plays[0].tier === 'g50', '按「現在演」唱歌中也馬上演');
  await send('overlay-show:skip', {});
  await send('overlay-show:simulate', { type: 'sub', name: 'Later' });
  await panel.waitForTimeout(300);
  await panel.click('#alert-show-clear-waiting');
  await panel.waitForTimeout(300);
  check((await status()).waiting === 0 && await panel.locator('#alert-show-waiting').isHidden(), '按「清掉」等待清空、提示收起');

  // 5. 試播不等
  plays.length = 0;
  await send('overlay-show:test', { kind: 'alert', tier: 'g5', variant: 1 });
  await panel.waitForTimeout(300);
  check(plays.length === 1, '唱歌中試播照樣馬上演');
  await send('overlay-show:skip', {});
  fire('play:stop', { reason: 'test' });
  await panel.waitForTimeout(300);

  // 6. BGM：上傳一首、開啟，演出時壓低、結束後恢復；暫停模式
  await panel.evaluate(() => { const nav = document.querySelector('[data-nav="bgm"]'); if (nav) nav.click(); });
  await panel.waitForTimeout(400);
  const chooser = panel.waitForEvent('filechooser');
  await panel.click('#bgm-upload-button');
  await (await chooser).setFiles(bgmFile);
  await panel.waitForFunction(() => document.querySelectorAll('#bgm-track-list li, #bgm-track-list .bgm-track').length > 0, null, { timeout: 30000 }).catch(() => {});
  const toggle = panel.locator('#bgm-enable-toggle');
  if (!(await toggle.isChecked())) await panel.locator('#bgm-enable-toggle + .track').click();
  await panel.waitForTimeout(800);
  if (!(await panel.evaluate(() => window.AppBgm.alertDebug().localPlaying))) await panel.click('#bgm-transport-play').catch(() => {});
  await panel.waitForTimeout(1200);
  let dbg = await panel.evaluate(() => window.AppBgm.alertDebug());
  check(dbg.localPlaying, 'BGM 在播（測試前提）');
  await send('overlay-show:test', { kind: 'alert', tier: 'g5', variant: 1 });
  await panel.waitForTimeout(700);
  dbg = await panel.evaluate(() => window.AppBgm.alertDebug());
  check(dbg.alertActive && Math.abs(dbg.duck - 0.2) < 0.03, `演出時 BGM 壓到 20%（${dbg.duck}）`);
  await send('overlay-show:skip', {});
  await panel.waitForTimeout(1200);
  dbg = await panel.evaluate(() => window.AppBgm.alertDebug());
  check(!dbg.alertActive && dbg.duck > 0.97 && dbg.localPlaying, `演出結束 BGM 恢復（${dbg.duck}）`);
  await send('overlay-show:settings:update', { alerts: { timing: { bgm: 'pause' } } });
  await panel.waitForTimeout(300);
  await send('overlay-show:test', { kind: 'alert', tier: 'g5', variant: 1 });
  await panel.waitForTimeout(700);
  dbg = await panel.evaluate(() => window.AppBgm.alertDebug());
  check(!dbg.localPlaying && dbg.pausedForAlert, 'BGM 設成暫停：演出時 BGM 停下');
  await send('overlay-show:skip', {});
  await panel.waitForTimeout(1600);
  dbg = await panel.evaluate(() => window.AppBgm.alertDebug());
  check(dbg.localPlaying && !dbg.pausedForAlert, '演出結束 BGM 接回來');
  await send('overlay-show:settings:update', { alerts: { timing: { bgm: 'none' } } });
  await panel.waitForTimeout(300);
  await send('overlay-show:test', { kind: 'alert', tier: 'g5', variant: 1 });
  await panel.waitForTimeout(700);
  dbg = await panel.evaluate(() => window.AppBgm.alertDebug());
  check(dbg.localPlaying && dbg.duck > 0.97, 'BGM 設成不變：演出時 BGM 照常');
  await send('overlay-show:skip', {});

  // 7. 時機分頁截圖
  await panel.evaluate(() => { const nav = document.querySelector('[data-nav="public-request"]'); if (nav) nav.click(); });
  await panel.click('#alert-show-open');
  await panel.click('#alert-show-tabs [data-group="timing"]');
  await panel.waitForTimeout(500);
  await panel.selectOption('#alert-show-sim-type', 'gift');
  await panel.click('#alert-show-sim-send');
  await panel.waitForTimeout(500);
  const simText = await panel.locator('#alert-show-sim-result').textContent();
  check(simText.length > 2, `時機分頁的模擬按鈕有回報結果（${simText}）`);
  await panel.screenshot({ path: path.join(out, 'timing-tab.png') });
  await send('overlay-show:skip', {});

  await send('overlay-show:settings:update', { alerts: { subEnabled: false, giftEnabled: false, timing: { singing: 'wait', pauseDelaySec: 3, endDelaySec: 5, bgm: 'duck', bgmDuck: 25 } }, raid: { enabled: false, mode: 'card' } });
  check(errors.length === 0, `沒有腳本錯誤${errors.length ? '：' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fail.length ? `\n${fail.length} 項失敗` : '\n全部通過');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
