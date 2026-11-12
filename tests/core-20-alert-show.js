'use strict';

// 核心回歸測試（訂閱／贈訂／揪團演出）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  test,
  eq,
  ok,
} = require('./core-harness');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const overlay = require('../server/services/overlay-show');
const { toSupportEvent } = require('../server/services/twitch-service');

function makeHarness({ initial = null, random = () => 0 } = {}) {
  const events = [];
  const pending = [];
  let saved = null;
  const timers = {
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; pending.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
  };
  const service = overlay.createOverlayShow({
    emit: (event, payload) => events.push({ event, payload }),
    store: { load: () => initial, save: (value) => { saved = value; } },
    timers,
    random,
  });
  const fire = () => { const timer = pending.find((item) => !item.cleared); if (timer) { timer.cleared = true; timer.fn(); } };
  const plays = () => events.filter((item) => item.event === 'overlay-show:play').map((item) => item.payload);
  return { service, events, pending, fire, plays, getSaved: () => saved };
}

test('訂閱演出：預設全部關閉，舊版存檔（沒有 alerts）讀進來也有完整預設值', () => {
  const fresh = makeHarness().service.getSettings();
  eq(fresh.alerts.subEnabled, false);
  eq(fresh.alerts.giftEnabled, false);
  eq(fresh.raid.mode, 'card', '揪團預設維持原本的角落小卡');
  eq(JSON.stringify(fresh.alerts.giftMin), JSON.stringify({ g5: 5, g10: 10, g25: 25, g50: 50, g100: 100 }));
  eq(JSON.stringify(fresh.alerts.raidMin), JSON.stringify({ r2: 10, r3: 50, r4: 200 }));
  const legacy = makeHarness({ initial: { raid: { enabled: true, minViewers: 3, style: 'neon' }, postcard: { durationSec: 12 } } }).service.getSettings();
  eq(legacy.raid.enabled, true);
  eq(legacy.raid.style, 'neon');
  eq(legacy.raid.mode, 'card');
  eq(legacy.alerts.volume, 70);
  eq(legacy.alerts.off.length, 0);
});

test('訂閱演出：門檻填反會往上推成遞增，局部更新不影響其他欄位', () => {
  const h = makeHarness();
  const next = h.service.updateSettings({ alerts: { giftMin: { g5: 3, g10: 2 }, raidMin: { r2: 500 } } });
  eq(next.alerts.giftMin.g5, 3);
  eq(next.alerts.giftMin.g10, 4, '大量的門檻不可低於或等於中量');
  eq(next.alerts.giftMin.g25, 25);
  eq(next.alerts.raidMin.r2, 500);
  eq(next.alerts.raidMin.r3, 501);
  eq(next.alerts.raidMin.r4, 502);
  const after = h.service.updateSettings({ alerts: { volume: 250 } });
  eq(after.alerts.volume, 100, '音量夾在 0～100');
  eq(after.alerts.giftMin.g5, 3, '只改音量時門檻不變');
  eq(h.service.updateSettings({ raid: { durationSec: 9 } }).alerts.volume, 100, '只改揪團設定時 alerts 不變');
  ok(h.getSaved() && h.getSaved().alerts, '設定要存檔');
});

test('訂閱演出：停用清單只收目錄裡有的演出，而且每一級至少留一種', () => {
  const h = makeHarness();
  const next = h.service.updateSettings({ alerts: { off: ['g10:0', 'g10:0', 'nope:1', 'g5:99', 'sub:0', 'sub:1', 'sub:2', 'sub:3', 'sub:4', 42] } });
  ok(next.alerts.off.includes('g10:0'));
  ok(!next.alerts.off.some((item) => item.startsWith('nope') || item === 'g5:99'));
  eq(next.alerts.off.filter((item) => item.startsWith('sub:')).length, 4, '整級都停用時自動留下一種');
});

test('訂閱演出：贈訂依份數落到對應等級，沒開就不演，同一事件不演兩次', () => {
  const h = makeHarness();
  eq(h.service.handleSupport({ eventId: 'a', type: 'gift', name: 'x', count: 10 }).reason, 'disabled');
  h.service.updateSettings({ alerts: { giftEnabled: true } });
  const cases = [[1, 'g1'], [4, 'g1'], [5, 'g5'], [9, 'g5'], [10, 'g10'], [24, 'g10'], [25, 'g25'], [50, 'g50'], [99, 'g50'], [100, 'g100'], [5000, 'g100']];
  cases.forEach(([count, tier], index) => {
    const result = h.service.handleSupport({ eventId: `g${index}`, type: 'gift', name: 'Friend', count });
    if (result.ok) eq(result.tier, tier, `${count} 份應該是 ${tier}`);
    else eq(result.reason, 'queue-full');
    h.service.clearAll();
  });
  h.service.handleSupport({ eventId: 'dup', type: 'gift', name: 'Friend', count: 3 });
  eq(h.service.handleSupport({ eventId: 'dup', type: 'gift', name: 'Friend', count: 3 }).reason, 'duplicate');
  eq(h.service.handleSupport({ eventId: 'z', type: 'cheer', name: 'x' }).reason, 'unknown-type');
});

test('訂閱演出：自訂門檻後（小型頻道）10 份就能是特大', () => {
  const h = makeHarness();
  h.service.updateSettings({ alerts: { giftEnabled: true, giftMin: { g5: 3, g10: 5, g25: 10, g50: 20, g100: 50 } } });
  eq(h.service.handleSupport({ eventId: '1', type: 'gift', name: 'a', count: 10 }).tier, 'g25');
  h.service.clearAll();
  eq(h.service.handleSupport({ eventId: '2', type: 'gift', name: 'a', count: 50 }).tier, 'g100');
});

test('訂閱演出：送給顯示端的內容——等級、第幾種、份數、清洗過的名字、音量，秒數來自目錄', () => {
  const h = makeHarness();
  h.service.updateSettings({ alerts: { giftEnabled: true, subEnabled: true, volume: 40 } });
  h.service.handleSupport({ eventId: 'a', type: 'gift', name: '  Evil\u0000‮Name\n ', count: 12 });
  const play = h.plays()[0];
  eq(play.kind, 'alert');
  eq(play.payload.tier, 'g10');
  eq(play.payload.n, 12);
  eq(play.payload.name, 'Evil Name', '控制字元與方向覆寫字元要清掉');
  eq(play.payload.volume, 40);
  const tier = overlay.CATALOG.tiers.find((item) => item.id === 'g10');
  eq(play.durationMs, Math.round(tier.variants[play.payload.variant].dur * 1000));
  const timer = h.pending.find((item) => !item.cleared);
  ok(timer.ms > play.durationMs + 1000, '全畫面演出要多留舞台載入的時間才接下一個');
  h.fire();
  ok(h.events.some((item) => item.event === 'overlay-show:clear' && item.payload.kind === 'alert'));
  h.service.handleSupport({ eventId: 'b', type: 'sub', name: '' });
  const sub = h.plays()[1];
  eq(sub.payload.tier, 'sub');
  eq(sub.payload.n, 0, '一般訂閱沒有份數');
  eq(sub.payload.name, '', '匿名留空，畫面上顯示各語言的「觀眾」');
  h.service.clearAll();
  ok(h.service.handleSupport({ eventId: 'c', type: 'resub', name: 'Regular' }).ok, '續訂跟新訂閱用同一個開關');
});

test('訂閱演出：同一級不連續重複，停用的演出不會被挑到', () => {
  const sequence = [0, 0, 0, 0.99, 0.5, 0, 0.99, 0.2, 0.7, 0.1];
  let cursor = 0;
  const h = makeHarness({ random: () => sequence[cursor++ % sequence.length] });
  h.service.updateSettings({ alerts: { giftEnabled: true, off: ['g5:0', 'g5:3'] } });
  const picked = [];
  for (let i = 0; i < 10; i += 1) {
    h.service.handleSupport({ eventId: `p${i}`, type: 'gift', name: 'a', count: 5 });
    picked.push(h.plays().pop().payload.variant);
    h.service.clearAll();
  }
  ok(picked.every((index) => index !== 0 && index !== 3), `停用的不該出現：${picked.join(',')}`);
  ok(picked.every((index, i) => i === 0 || index !== picked[i - 1]), `不可連續重複：${picked.join(',')}`);
  h.service.updateSettings({ alerts: { off: ['g5:0', 'g5:1', 'g5:2', 'g5:3'] } });
  h.service.handleSupport({ eventId: 'only', type: 'gift', name: 'a', count: 5 });
  eq(h.plays().pop().payload.variant, 4, '只剩一種時就一直用那一種');
});

test('訂閱演出：揪團設成全畫面演出時走舞台並依人數分級；設成小卡時維持原本行為', () => {
  const h = makeHarness();
  h.service.updateSettings({ raid: { enabled: true, minViewers: 3, mode: 'show' } });
  eq(h.service.handleRaid({ eventId: 'a', fromName: 'Tiny', viewers: 2 }).reason, 'below-min', '最低人數照舊');
  const mid = h.service.handleRaid({ eventId: 'b', fromName: 'Friend', viewers: 60 });
  eq(mid.tier, 'r3');
  const play = h.plays()[0];
  eq(play.kind, 'alert');
  eq(play.payload.n, 60);
  eq(play.payload.name, 'Friend');
  h.service.clearAll();
  eq(h.service.handleRaid({ eventId: 'c', fromName: 'Big', viewers: 900 }).tier, 'r4');
  h.service.clearAll();
  h.service.updateSettings({ raid: { mode: 'card' } });
  h.service.handleRaid({ eventId: 'd', fromName: 'Friend', viewers: 60 });
  eq(h.plays().pop().kind, 'raid');
});

test('訂閱演出：試播只接受目錄裡的等級；沒指定第幾種就自己挑；揪團試播跟著演出方式走', () => {
  const h = makeHarness();
  eq(h.service.test('alert', { tier: 'nope' }), null);
  eq(h.service.test('alert', { tier: '__proto__' }), null);
  ok(h.service.test('alert', { tier: 'g50', variant: 2, count: 77, name: '小螢' }));
  let play = h.plays().pop();
  eq(play.payload.variant, 2);
  eq(play.payload.n, 77);
  eq(play.payload.name, '小螢');
  h.service.clearAll();
  ok(h.service.test('alert', { tier: 'g25', variant: 99 }));
  play = h.plays().pop();
  ok(play.payload.variant >= 0 && play.payload.variant < 5, '超出範圍的編號改用自動挑選');
  eq(play.payload.n, 25, '沒給份數就用那一級的門檻');
  h.service.clearAll();
  h.service.updateSettings({ raid: { mode: 'show' } });
  ok(h.service.test('raid'));
  eq(h.plays().pop().kind, 'alert');
});

test('訂閱演出：Twitch 聊天室通知的對應——一次送多份只算一次、聯合聊天室別台的不算', () => {
  eq(JSON.stringify(toSupportEvent({ notice_type: 'sub', chatter_user_name: 'A' }, 'm1')), JSON.stringify({ eventId: 'm1', type: 'sub', name: 'A', count: 1 }));
  eq(toSupportEvent({ notice_type: 'resub', chatter_user_login: 'b' }, 'm2').name, 'b');
  eq(toSupportEvent({ notice_type: 'community_sub_gift', chatter_user_name: 'A', community_sub_gift: { total: 10 } }, 'm3').count, 10);
  eq(toSupportEvent({ notice_type: 'sub_gift', chatter_user_name: 'A', sub_gift: { community_gift_id: 'bundle' } }, 'm4'), null, '十連贈訂的逐筆通知要略過');
  const single = toSupportEvent({ notice_type: 'sub_gift', chatter_user_name: 'A', sub_gift: { recipient_user_name: 'B' } }, 'm5');
  eq(single.type, 'gift');
  eq(single.count, 1);
  eq(toSupportEvent({ notice_type: 'sub_gift', chatter_is_anonymous: true, chatter_user_name: 'AnAnonymousGifter', sub_gift: {} }, 'm6').name, '', '匿名贈訂不顯示帳號名');
  for (const type of ['shared_chat_sub', 'shared_chat_community_sub_gift', 'raid', 'announcement', 'bits_badge_tier', undefined]) {
    eq(toSupportEvent({ notice_type: type, chatter_user_name: 'X' }, 'm7'), null, `${type} 不演`);
  }
  eq(toSupportEvent(null, 'm8'), null);
});

test('訂閱演出：Twitch 用聊天室通知（不需要新的授權範圍），訂閱失敗不影響點歌', () => {
  const source = read('server/services/twitch-service.js');
  ok(source.includes("createSubscription('channel.chat.notification', { broadcaster_user_id: this.auth.userId, user_id: this.auth.userId })"));
  ok(/channel\.chat\.notification[\s\S]{0,200}catch \(err\)[\s\S]{0,120}訂閱通知未啟用/.test(source), '訂閱通知建立失敗要被吞掉並記錄');
  ok(source.includes("const REQUIRED_SCOPES = Object.freeze(['user:read:chat', 'user:write:chat', 'channel:manage:redemptions']);"), '不可為了訂閱演出多要授權範圍（舊使用者會被要求重新連接）');
  ok(/subscription\.type === 'channel\.chat\.notification'[\s\S]{0,300}this\.onSupport\?\.\(/.test(source));
  ok(read('server/index.js').includes('onSupport: (event) => overlayShow.handleSupport(event)'));
});

test('訂閱演出：只有桌面面板能改設定與試播；顯示端只收到設定內容', () => {
  const handler = read('server/routes/handlers/overlay-show.js');
  const displayBlock = handler.slice(handler.indexOf('function sendSettingsToDisplay'), handler.indexOf('function registerOverlayShowHandlers'));
  ok(displayBlock.includes("socket.emit('overlay-show:settings'"), '顯示端連上就收到設定');
  ok(!displayBlock.includes('socket.on('), '顯示端不可註冊修改或觸發的事件');
  const socketHandler = read('server/routes/socket-handler.js');
  const call = socketHandler.indexOf('registerOverlayShowHandlers.sendSettingsToDisplay(socket, overlayShow)');
  ok(call > 0 && call < socketHandler.indexOf('registerPlaybackHandlers(io, socket, ctx);'), '顯示端是唯讀連線：送設定要在唯讀檢查之外，不然永遠送不到');
  ok(!/if \(!socket\.readOnly\) \{[^}]*sendSettingsToDisplay/.test(socketHandler), '不可放進 !socket.readOnly 區塊');
  const { sendSettingsToDisplay } = require('../server/routes/handlers/overlay-show');
  const sent = [];
  const fake = (clientType) => ({ clientType, emit: (event, payload) => sent.push([clientType, event, !!payload]) });
  const service = makeHarness().service;
  ['display', 'display-preview', 'display-spout', 'setlist', 'remote', 'controller'].forEach((type) => sendSettingsToDisplay(fake(type), service));
  eq(sent.map((item) => item[0]).join(','), 'display,display-preview,display-spout', '只送給歌詞顯示端');
  ok(handler.indexOf("if (socket.clientType !== 'controller') return;") < handler.indexOf("socket.on('overlay-show:test'"));
  ok(handler.includes("kind !== 'postcard' && kind !== 'raid' && kind !== 'alert'"));
});

test('訂閱演出：舞台與外層頁面之間只收同源、而且只收彼此的訊息；演完一定清空畫布', () => {
  const stage = read('public/alert-show/stage.js');
  ok(stage.includes('event.origin !== location.origin || event.source !== window.parent'), '舞台只收直接外層、同源的指令');
  ok(stage.includes("message.target !== 'alert-show-stage'"));
  ok(/t >= duration[\s\S]{0,120}clearCanvas\(\)/.test(stage), '演完要清空畫布，不可在直播畫面留下殘影（鐵則 11）');
  ok(/function stop\([\s\S]{0,260}clearCanvas\(\)/.test(stage), '被收掉時也要清空');
  const display = read('public/js/overlay-show.js');
  ok(display.includes('event.origin !== window.location.origin || event.source !== stage.frame.contentWindow'));
  ok(display.includes("if (kind === 'alert') { playAlert(message, payload); return; }"));
  ok(display.includes("SocketClient.on('overlay-show:settings', prepareStage)"), '有開演出才預先載入舞台');
  ok(/connection-change[\s\S]{0,160}stopAlert\(''\)/.test(display), '斷線時收掉演出');
  const css = read('public/css/overlay-show.css');
  ok(/#overlay-show-stage \{[^}]*pointer-events: none;[^}]*\}/.test(css) && /#overlay-show-stage \{[^}]*background: transparent;/.test(css), '舞台透明、不吃滑鼠事件');
  ok(read('public/alert-show/stage.css').includes('background: transparent'));
  const boot = read('public/alert-show/stage-boot.js');
  ok(boot.includes("out.set('dither', '0')"), '即時播放不做抖色（會掉格）');
  ok(boot.includes("out.set('bg', '0')"), '不畫模擬直播背景');
  ok(/\^\\\/alert-show\\\//.test(boot), '自訂角色圖只收同源的 /alert-show/ 路徑');
  ok(boot.includes("link.media = 'print'"), '線上字型不可擋住舞台載入');
});

test('訂閱演出：public/alert-show 的引擎與目錄是從 tools/alert-show/src 建出來的最新版', () => {
  const { buildEngine, readCatalog } = require('../tools/alert-show/build');
  const engine = buildEngine();
  eq(read('public/alert-show/engine.js') === engine, true, '請執行 node tools/alert-show/build.js');
  eq(read('public/alert-show/catalog.json'), `${JSON.stringify(readCatalog(engine), null, 2)}\n`, '請執行 node tools/alert-show/build.js');
});

test('訂閱演出：每一種演出都有音效檔，引擎用到的道具圖都在，字型子集涵蓋畫面上的字', () => {
  const dir = path.join(ROOT, 'public/alert-show');
  const catalog = overlay.CATALOG;
  eq(catalog.tiers.map((tier) => tier.id).join(','), 'sub,g1,g5,g10,g25,g50,g100,r1,r2,r3,r4');
  let count = 0;
  for (const tier of catalog.tiers) for (const variant of tier.variants) {
    count += 1;
    ok(fs.existsSync(path.join(dir, 'sfx', `${tier.id}_${variant.index}.ogg`)), `缺音效 ${tier.id}_${variant.index}.ogg`);
    ok(variant.dur >= 2 && variant.dur <= 15, `${tier.id}:${variant.index} 的秒數不合理`);
  }
  eq(count, 43);
  const engine = read('public/alert-show/engine.js');
  const images = new Set(['girl', 'mascot']);
  for (const match of engine.matchAll(/'(?:\.\.\/assets\/)?([a-z_0-9]+)\.png'/g)) images.add(match[1]);
  ok(images.size >= 28, `應找得到引擎用到的道具圖（找到 ${images.size} 張）`);
  for (const name of images) ok(fs.existsSync(path.join(dir, 'assets', `${name}.webp`)), `缺道具圖 ${name}.webp`);

  const text = JSON.parse(engine.match(/^window\.__V2_TEXT = (".*");/m)[1]);
  const css = read('public/alert-show/fonts.css');
  const covered = new Set();
  const faces = [...css.matchAll(/url\('fonts\/([^']+)'\)[^;]*; unicode-range: ([^;]+);/g)];
  eq(faces.length, 9);
  for (const [, file, range] of faces) {
    ok(fs.existsSync(path.join(dir, 'fonts', file)), `缺字型檔 ${file}`);
    for (const part of range.split(',')) {
      const [a, b] = part.trim().slice(2).split('-');
      for (let cp = parseInt(a, 16); cp <= parseInt(b || a, 16); cp += 1) covered.add(cp);
    }
  }
  // 這兩個是引擎裡正規表示式的範圍端點（぀、힯），不是畫面上的字。
  const missing = [...text].filter((ch) => !covered.has(ch.codePointAt(0)) && ch !== '぀' && ch !== '힯');
  eq(missing.join(''), '', '引擎加了新的畫面文字：請重跑 tools/alert-show/build-fonts.py');
  ok(fs.existsSync(path.join(dir, 'fonts', 'OFL.txt')), '字型授權文字要一起放');
  const stageHtml = read('public/alert-show/stage.html');
  ok(stageHtml.includes('href="fonts.css"') && !stageHtml.includes('fonts.googleapis.com'), '舞台用本機字型，線上字型只由 stage-boot.js 非阻塞補字');
  ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(stageHtml), '舞台頁不可有行內 script（CSP）');
});

test('訂閱演出：面板入口標 NEW、設定不存 localStorage、每一種演出與等級都有五語名稱', () => {
  const panel = read('public/index.html');
  ok(/id="alert-show-group"[^>]*data-new-feature="alert-show"/.test(panel));
  ok(/class="label alert-show-label">[^\n]{0,120}data-new-badge-slot/.test(panel), 'NEW 放在這一組的標題旁');
  ok(/data-nav="public-request"[^>]*data-new-feature="alert-show-nav"/.test(panel), '入口導覽項目也要標 NEW');
  ok(panel.includes('<script src="/js/app-alert-show.js"></script>'));
  ok(panel.includes('id="overlay-show-raid-mode"') && panel.includes('data-raid-card-only'));
  const badges = read('public/js/new-badges.js');
  ok(badges.includes("'alert-show':") && badges.includes("'alert-show-nav':"));
  const script = read('public/js/app-alert-show.js');
  ok(!script.includes('localStorage'), '設定以伺服器為準（鐵則 4）');
  ok(script.includes('event.origin !== window.location.origin || event.source !== ui.frame.contentWindow'));
  const i18n = read('public/js/i18n.js');
  const has = (key) => new RegExp(`'${key.replace(/\./g, '\\.')}': \\[('(?:[^'\\\\]|\\\\.)*', ){4}'(?:[^'\\\\]|\\\\.)*'\\],`).test(i18n);
  for (const tier of overlay.CATALOG.tiers) {
    ok(has(`alertShow.tier.${tier.id}`), `缺等級名稱 alertShow.tier.${tier.id}`);
    for (const variant of tier.variants) ok(has(`alertShow.v.${tier.id}.${variant.index}`), `缺演出名稱 alertShow.v.${tier.id}.${variant.index}`);
  }
  for (const match of script.matchAll(/t\('(alertShow\.[A-Za-z.]+)'/g)) ok(has(match[1]), `缺翻譯 ${match[1]}`);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  ok(!emoji.test(script) && !emoji.test(panel.slice(panel.indexOf('id="alert-show-modal"'), panel.indexOf('id="electron-close-modal"'))), '介面文字不加 emoji');
});

test('角色圖：上傳與刪除都掛 requirePin，讀圖路由只收 girl／mascot、不吃網址裡的檔名', () => {
  const routes = read('server/routes/api/alert-show-assets.js');
  ok(routes.includes("router.post('/alert-show/character/:kind', requirePin,"), '上傳要掛 requirePin（鐵則 15）');
  ok(routes.includes("router.delete('/alert-show/character/:kind', requirePin,"), '刪除要掛 requirePin（鐵則 15）');
  ok(read('server/routes/api.js').includes("router.use(require('./api/alert-show-assets'));"));
  const index = read('server/index.js');
  ok(index.includes("app.get('/alert-show/custom/:kind'"), 'OBS 讀圖是唯讀路由（同 /background 先例不掛 PIN）');
  const { findCharacterFile, CHARACTER_KINDS } = require('../server/routes/api/alert-show-assets');
  eq(CHARACTER_KINDS.join(','), 'girl,mascot');
  for (const bad of ['../state', '..\state', 'state.json', 'girl/../../x', '', '__proto__']) eq(findCharacterFile(bad), null, `不可讀到 ${bad}`);
  const panel = read('public/js/app-alert-show.js');
  ok(panel.includes("PinAuth.fetchWithPin(`/api/alert-show/character/${kind}`, { method: 'POST', body: form })"), '面板上傳要用 fetchWithPin（鐵則 16）');
  ok(panel.includes("PinAuth.fetchWithPin('/api/alert-show/character/girl', { method: 'DELETE' })"));
});

test('角色圖：用檔頭認格式與長寬，副檔名騙不過；只收 PNG／WebP', () => {
  const { sniffImage } = require('../server/routes/api/alert-show-assets');
  const png = Buffer.alloc(40);
  png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4); png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(933, 16); png.writeUInt32BE(1400, 20);
  eq(JSON.stringify(sniffImage(png)), JSON.stringify({ ext: '.png', width: 933, height: 1400 }));
  const vp8x = Buffer.alloc(40);
  vp8x.write('RIFF', 0, 'ascii'); vp8x.write('WEBP', 8, 'ascii'); vp8x.write('VP8X', 12, 'ascii');
  vp8x.writeUIntLE(1599, 24, 3); vp8x.writeUIntLE(2399, 27, 3);
  eq(JSON.stringify(sniffImage(vp8x)), JSON.stringify({ ext: '.webp', width: 1600, height: 2400 }));
  const real = fs.readFileSync(path.join(ROOT, 'public/alert-show/assets/girl.webp'));
  const info = sniffImage(real);
  ok(info && info.ext === '.webp' && info.width === 933 && info.height === 1400, `內建角色圖應讀得出 933x1400（實際 ${JSON.stringify(info)}）`);
  eq(sniffImage(Buffer.from('GIF89a' + 'x'.repeat(40))), null, 'GIF 不收（可能沒有透明背景、也可能是動圖）');
  eq(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(64))), null, 'SVG 不收');
  eq(sniffImage(Buffer.alloc(8)), null);
  eq(sniffImage('not a buffer'), null);
});

test('角色圖：設定裡的角色欄位夾範圍；舊存檔沒有 character 時用內建', () => {
  const h = makeHarness({ initial: { alerts: { giftEnabled: true } } });
  const c = h.service.getSettings().alerts.character;
  eq(JSON.stringify(c), JSON.stringify({ girl: 'default', mascot: 'default', face: { x: 0.49, y: 0.15, s: 0.12 }, rev: 0 }));
  const next = h.service.updateSettings({ alerts: { character: { girl: 'http://evil', mascot: 'none', face: { x: 9, y: -3, s: 1 }, rev: -5 } } }).alerts.character;
  eq(next.girl, 'default', '只收 default／custom');
  eq(next.mascot, 'none');
  eq(JSON.stringify(next.face), JSON.stringify({ x: 1, y: 0, s: 0.35 }));
  eq(next.rev, 0);
  const keep = h.service.updateSettings({ alerts: { character: { face: { x: 0.4 } } } }).alerts.character;
  eq(keep.mascot, 'none', '只改臉的位置時其他欄位不變');
  eq(keep.face.y, 0);
  eq(h.service.updateSettings({ alerts: { volume: 50 } }).alerts.character.face.x, 0.4, '改別的設定不影響角色');
});

test('角色圖：舞台與顯示端——自訂圖讀不到就退回內建、開演前等換圖完成、只收同源路徑', () => {
  const stage = read('public/alert-show/stage.js');
  ok(stage.includes("return img || (girl === 'custom' ? loadImage(DEFAULT_GIRL) : null);"), '自訂角色圖不見了要退回內建，畫面不能少一個人');
  ok(stage.includes("window.ready.then(function () { return characterJob; })"), '開演前要等換圖完成');
  ok(stage.includes("'/alert-show/custom/' + kind + '?rev=' + rev"), '圖的網址由舞台自己組，不吃外層傳來的網址');
  ok(stage.includes("if (key !== characterKey) return;"), '連續換兩次圖時以最後一次為準');
  const display = read('public/js/overlay-show.js');
  ok(/data\.type === 'ready'[\s\S]{0,120}type: 'character'/.test(display), '舞台每次載好都要再給一次角色設定');
  const panel = read('public/js/app-alert-show.js');
  ok(panel.includes("if (!trimmed.transparent) throw new Error(t('alertShow.charNoAlpha'));"), '沒有透明背景的圖要擋下（直播畫面會出現方框）');
  ok(/accept="image\/png,image\/webp"/.test(read('public/index.html')));
});
