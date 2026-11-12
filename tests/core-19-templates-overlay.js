'use strict';

// 核心回歸測試（templates-overlay）。由 tests/run-tests.js 依序載入，不要單獨執行。
const {
  fs,
  path,
  vm,
  test,
  testAsync,
  eq,
  ok,
} = require('./core-harness');
const socketHandler = require('../server/routes/socket-handler');
const { TwitchService, reconnectDelay, CONNECT_WATCHDOG_MS } = require('../server/services/twitch-service');
const TwitchRequestSettings = require('../public/js/twitch-request-settings');
const AudioProcessor = require('../server/services/audio-processor');

// ─── 直書句流：中央安全距離（使用者反映「兩邊分散仍會跑到中間」的修復） ───
{
  const columnflowSource = fs.readFileSync(path.join(__dirname, '../public/js/lyric-template-columnflow.js'), 'utf8');

  function loadColumnflowSandbox() {
    const sandbox = {
      LyricTemplates: { register(template) { this.template = template; } },
      LyricMotion: {
        hashNoise: (seed, salt) => {
          const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
          return x - Math.floor(x);
        },
        ensureWordTimings: (line) => line.words,
        buildGraphemeTimings: (word) => Array.from(word.text).map((char, i) => ({
          char, startMs: word.start + i * (word.duration / Math.max(1, word.text.length)),
        })),
      },
      document: { documentElement: {}, body: { dataset: {} } },
      window: { innerWidth: 1280, innerHeight: 720 },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      console,
    };
    // makeNode 要在 sandbox 建好、可以參照 sandbox.document.body 之後才定義
    function makeNode(options = {}) {
      const node = {
        style: {},
        classList: {
          _set: new Set(),
          add(c) { this._set.add(c); },
          remove(c) { this._set.delete(c); },
          toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
          contains(c) { return this._set.has(c); },
        },
        children: [],
        parentNode: null,
        offsetWidth: options.offsetWidth || 0,
        offsetHeight: options.offsetHeight || 0,
        clientWidth: options.clientWidth || 0,
        clientHeight: options.clientHeight || 0,
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; },
        querySelectorAll(selector) {
          const cls = selector.replace('.', '');
          const out = [];
          (function walk(n) { n.children.forEach((c) => { if (c.classList.contains(cls)) out.push(c); walk(c); }); })(this);
          return out;
        },
        querySelector(selector) {
          return this.querySelectorAll(selector)[0] || null;
        },
        getBoundingClientRect() {
          const left = parseFloat(this.style.left) || 0;
          const top = parseFloat(this.style.top) || 0;
          return { left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight };
        },
        setAttribute() {},
        set className(v) { this._className = v; this.classList._set = new Set(v.split(/\s+/).filter(Boolean)); },
        get className() { return this._className || ''; },
        set textContent(v) { this._textContent = v; },
        get textContent() { return this._textContent || ''; },
        set innerHTML(v) { this._innerHTML = v; this.children = []; },
        get innerHTML() { return this._innerHTML || ''; },
      };
      node.style.setProperty = function setProperty(name, value) { this[name] = value; };
      return node;
    }
    sandbox.document.createElement = () => makeNode();
    vm.runInNewContext(columnflowSource, sandbox, { filename: 'lyric-template-columnflow.js' });
    return { sandbox, makeNode };
  }

  // computeLanes 定義在模板 IIFE 內部（閉包私有），要在 IIFE 結束前插入匯出語句
  // 才拿得到——直接在收尾的 "})();" 前插入，不動實際檔案。
  const columnflowSourceWithExport = columnflowSource.replace(
    /\}\)\(\);\s*$/,
    ';globalThis.__computeLanesForTest = computeLanes;\n})();'
  );

  test('直書句流：computeLanes 在預設安全距離（11%）下重現原本的車道位置', () => {
    const exportSandbox = loadColumnflowSandbox().sandbox;
    vm.runInNewContext(columnflowSourceWithExport, exportSandbox, { filename: 'lyric-template-columnflow.js' });
    const { leftLanes, rightLanes } = exportSandbox.__computeLanesForTest(11);
    eq(leftLanes.map((v) => Math.round(v)).join(','), '9,19,29,39', '預設 11% 安全距離應重現原本寫死的 LEFT_LANES：');
    eq(rightLanes.map((v) => Math.round(v)).join(','), '91,81,71,61', '預設 11% 安全距離應重現原本寫死的 RIGHT_LANES：');
  });

  test('直書句流：安全距離調大，車道會整體遠離中央', () => {
    const exportSandbox = loadColumnflowSandbox().sandbox;
    vm.runInNewContext(columnflowSourceWithExport, exportSandbox, { filename: 'lyric-template-columnflow.js' });
    const wide = exportSandbox.__computeLanesForTest(25);
    ok(Math.max(...wide.leftLanes) < 39, '安全距離拉大到 25%，左側最內車道必須比預設（39%）更靠邊：');
    ok(Math.min(...wide.rightLanes) > 61, '安全距離拉大到 25%，右側最內車道必須比預設（61%）更靠邊：');
  });

  testAsync('直書句流：很長的一句（多段續接、實際寬度很寬）不會被放到跨過中央安全區', async () => {
    const { sandbox, makeNode } = loadColumnflowSandbox();
    // 模擬「一個很寬的直行」：8 個續接段，每段 40px，總寬度 320px——在 1280px 寬的畫面裡
    // 這個寬度確實有可能從左側車道（起點約 29%＝371px）一路延伸超過中央安全線（39%＝499px）。
    // 這正是使用者回報「兩邊分散仍會跑到中間」的根因：舊邏輯只用車道起點決定位置，
    // 從不檢查實際渲染寬度會不會越界。
    const container = makeNode({ clientWidth: 1280, clientHeight: 720 });
    const template = sandbox.LyricTemplates.template;
    const ctx = { getLyrics: () => lines };
    template.mount(container, ctx);
    const rootEl = container.children[0];
    rootEl.clientWidth = 1280;
    rootEl.clientHeight = 720;

    const longText = '甲'.repeat(60); // 60 字，遠超單一直行可容納的字數，強制切成多段續接
    const lines = [{
      time: 0,
      text: longText,
      words: [{ text: longText, start: 0, duration: 6000 }],
    }];

    template.onLyricsLoaded(lines, ctx);
    template.onFrame(0, ctx);

    const col = rootEl.querySelectorAll('cf-col')[0];
    ok(col, '應該建立出一個直行元素：');
    // 模擬瀏覽器量出很寬的實際渲染寬度（8 段續接 × 40px／段）。
    col.offsetWidth = 320;
    col.offsetHeight = 500;
    template.onSeek(0, ctx); // 觸發重新 placeColumn

    const rect = col.getBoundingClientRect();
    const safeMargin = 11;
    const centerLeftLimitPx = 1280 * (50 - safeMargin) / 100; // 499.2px
    const centerRightLimitPx = 1280 * (50 + safeMargin) / 100; // 780.8px
    if (rect.left < 1280 / 2) {
      ok(rect.right <= centerLeftLimitPx + 0.5, `左側直行的右邊界（${rect.right}px）不得跨過中央安全線（${centerLeftLimitPx}px）：`);
    } else {
      ok(rect.left >= centerRightLimitPx - 0.5, `右側直行的左邊界（${rect.left}px）不得跨過中央安全線（${centerRightLimitPx}px）：`);
    }
  });
}

// ─── 舞台模板（Pulse/Facet/Drift/Aura）共用的中央安全距離 ───
{
  const kernelSourceRaw = fs.readFileSync(path.join(__dirname, '../public/js/lyric-motion-kernel.js'), 'utf8');
  // LyricMotion 是頂層 const，不會自動掛到 sandbox 物件上（跟模組系統無關的 JS 語意），
  // 附加一行匯出語句才能從 sandbox 外部拿到它——跟既有 KTV sandbox 測試同一招。
  const kernelSource = `${kernelSourceRaw}\n;globalThis.LyricMotion = LyricMotion;`;

  function loadKernelSandbox(bodyDataset) {
    const sandbox = {
      document: { body: { dataset: bodyDataset }, documentElement: {} },
      window: { innerWidth: 1280 },
      console,
    };
    vm.runInNewContext(kernelSource, sandbox, { filename: 'lyric-motion-kernel.js' });
    return sandbox.LyricMotion;
  }

  test('舞台安全距離：預設 2% 對應原本寫死的 48/52% 分界（向下相容）', () => {
    const motion = loadKernelSandbox({});
    eq(motion.stageSafeMarginPercent(), 2, '沒設定時預設應該是 2：');
    const rootEl = { clientWidth: 1000 };
    const vp = (() => {
      const sandbox = { document: { body: { dataset: { lyricPos: 'split' } } }, window: { innerWidth: 1280 }, console };
      vm.runInNewContext(kernelSource, sandbox, { filename: 'lyric-motion-kernel.js' });
      return sandbox.LyricMotion.layoutViewport(rootEl, 0);
    })();
    eq(vp.width, 480, '預設安全距離下，split 模式的排版寬度應該是容器的 48%（跟原本寫死的值一致）：');
    eq(vp.sideClass, 'pos-left', '偶數行應該是 pos-left：');
  });

  test('舞台安全距離：使用者調大安全距離，排版可用寬度會跟著縮小', () => {
    const sandbox = { document: { body: { dataset: { lyricPos: 'split', stageSafeMargin: '20' } } }, window: { innerWidth: 1280 }, console };
    vm.runInNewContext(kernelSource, sandbox, { filename: 'lyric-motion-kernel.js' });
    const vp = sandbox.LyricMotion.layoutViewport({ clientWidth: 1000 }, 0);
    eq(vp.width, 300, '安全距離拉到 20%，可用寬度應該是容器的 (50-20)%=30%：');
  });

  test('舞台安全距離：數值會被限制在 2–25 的範圍內，不合法輸入退回預設', () => {
    const tooSmall = loadKernelSandbox({ stageSafeMargin: '0' });
    eq(tooSmall.stageSafeMarginPercent(), 2, '小於下限應該被夾到 2：');
    const tooBig = loadKernelSandbox({ stageSafeMargin: '99' });
    eq(tooBig.stageSafeMarginPercent(), 25, '大於上限應該被夾到 25：');
    const garbage = loadKernelSandbox({ stageSafeMargin: 'not-a-number' });
    eq(garbage.stageSafeMarginPercent(), 2, '無法解析的值應該退回預設 2：');
  });

  test('舞台安全距離：mountStageSafeZoneGuide 會建立引導元件並可重複同步／銷毀', () => {
    const nodes = [];
    function makeNode() {
      const node = {
        style: { setProperty(name, value) { this[name] = value; } },
        children: [], parentNode: null,
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; },
        set innerHTML(v) { this._innerHTML = v; },
        get innerHTML() { return this._innerHTML || ''; },
      };
      nodes.push(node);
      return node;
    }
    const sandbox = {
      document: { body: { dataset: { stageSafeMargin: '9' } }, documentElement: {}, createElement: makeNode },
      window: { innerWidth: 1280 },
      console,
    };
    vm.runInNewContext(kernelSource, sandbox, { filename: 'lyric-motion-kernel.js' });
    const rootEl = makeNode();
    const guide = sandbox.LyricMotion.mountStageSafeZoneGuide(rootEl);
    eq(rootEl.children.length, 1, 'mount 時應該立刻建立一個引導元件：');
    const guideEl = rootEl.children[0];
    eq(guideEl.style['--stage-safe-left'], '41%', '9% 安全距離應該對應 --stage-safe-left=41%：');
    eq(guideEl.style['--stage-safe-right'], '59%', '9% 安全距離應該對應 --stage-safe-right=59%：');

    sandbox.document.body.dataset.stageSafeMargin = '15';
    guide.sync();
    eq(rootEl.children.length, 1, '調整安全距離不應該重建元件，只更新既有的：');
    eq(guideEl.style['--stage-safe-left'], '35%', 'sync 後應該反映新的安全距離：');

    guide.destroy();
    eq(rootEl.children.length, 0, 'destroy 應該把引導元件從畫面移除：');
  });
}

testAsync('Twitch rejected requests create cooldown and suppress repeat chat replies', async () => {
  const replies = [];
  const service = new TwitchService({
    config: { twitchClientId: '' },
    onStreamOnline: () => {}, onStreamOffline: () => {}, onSongRequest: () => true,
    onSongRequestExpired: () => {}, pendingStore: { load: () => [], save: () => true },
    authStore: { load: () => null, save: () => true, clear: () => true },
  });
  service.setRequestSettings({ ...TwitchRequestSettings.getDefaults(), enabled: false, cooldownSeconds: 60 });
  service.sendConfiguredReply = async (_event, key, values = {}) => { replies.push({ key, values }); return { sent: true }; };
  const event = { chatter_user_id: 'spam-viewer', chatter_user_name: 'spam-viewer', message: { text: '!點歌 https://youtu.be/dQw4w9WgXcQ' } };
  await service.handleChatMessage(event);
  eq(replies.at(-1).key, 'requestDisabled');
  await service.handleChatMessage(event);
  eq(replies.length, 1, 'cooldown repeat must not keep posting to chat');
  ok(service.commandUserCooldowns.has('request:spam-viewer'));
  service.stop();
});

// ─── 觀眾演出（點歌明信片、揪團感謝）───
function makeOverlayShowHarness(initial) {
  const { createOverlayShow } = require('../server/services/overlay-show');
  const events = [];
  const pending = [];
  let saved = null;
  const timers = {
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; pending.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
  };
  const service = createOverlayShow({
    emit: (event, payload) => events.push({ event, payload }),
    store: { load: () => initial || null, save: (value) => { saved = value; } },
    timers,
  });
  const fire = () => { const timer = pending.find((item) => !item.cleared); if (timer) { timer.cleared = true; timer.fn(); } };
  return { service, events, fire, getSaved: () => saved };
}

test('觀眾演出：揪團預設關閉，開啟後依人數門檻與事件 id 去重', () => {
  const h = makeOverlayShowHarness();
  eq(h.service.getSettings().raid.enabled, false);
  eq(h.service.handleRaid({ eventId: 'a', fromName: 'Friend', viewers: 10 }).reason, 'disabled');
  h.service.updateSettings({ raid: { enabled: true, minViewers: 5 } });
  eq(h.service.handleRaid({ eventId: 'b', fromName: 'Tiny', viewers: 3 }).reason, 'below-min');
  ok(h.service.handleRaid({ eventId: 'c', fromName: 'Friend', viewers: 23 }).ok);
  eq(h.service.handleRaid({ eventId: 'c', fromName: 'Friend', viewers: 23 }).reason, 'duplicate', '同一個 Twitch 事件 id 不可演兩次');
  const play = h.events.find((e) => e.event === 'overlay-show:play');
  eq(play.payload.kind, 'raid');
  eq(play.payload.payload.name, 'Friend');
  eq(play.payload.payload.viewers, 23);
  eq(play.payload.payload.style, 'gold', '揪團演出要帶外觀');
});

test('觀眾演出：一次只演一個，前一個收場才輪到下一個，佇列有上限', () => {
  const h = makeOverlayShowHarness();
  h.service.updateSettings({ raid: { enabled: true } });
  h.service.handleRaid({ eventId: '1', fromName: 'A', viewers: 5 });
  h.service.handleRaid({ eventId: '2', fromName: 'B', viewers: 6 });
  eq(h.events.filter((e) => e.event === 'overlay-show:play').length, 1);
  h.fire();
  const plays = h.events.filter((e) => e.event === 'overlay-show:play');
  eq(plays.length, 2);
  eq(plays[1].payload.payload.name, 'B');
  const { MAX_QUEUE } = require('../server/services/overlay-show');
  const h2 = makeOverlayShowHarness();
  h2.service.updateSettings({ raid: { enabled: true } });
  let rejected = 0;
  for (let i = 0; i < MAX_QUEUE + 4; i += 1) {
    if (h2.service.handleRaid({ eventId: `x${i}`, fromName: `N${i}`, viewers: 5 }).reason === 'queue-full') rejected += 1;
  }
  ok(rejected > 0, '佇列滿了要拒收而不是無限堆積');
});

test('觀眾演出：明信片只有登記過的歌開始播放才演，只演一次，換歌立即收掉', () => {
  const h = makeOverlayShowHarness();
  eq(h.service.onTrackPlaying({ entryId: 'e1', title: 'S' }), null, '沒登記的歌不演');
  ok(h.service.armPostcard('e1', { title: 'Song', artist: 'Artist', name: 'Viewer', message: 'hello' }));
  ok(h.service.onTrackPlaying({ entryId: 'e1' }));
  const play = h.events.find((e) => e.event === 'overlay-show:play');
  eq(play.payload.kind, 'postcard');
  eq(play.payload.payload.message, 'hello');
  eq(play.payload.payload.style, 'paper', '明信片演出要帶外觀');
  eq(h.service.onTrackPlaying({ entryId: 'e1' }), null, '暫停再播不會重演');
  h.service.onTrackChanged();
  ok(h.events.some((e) => e.event === 'overlay-show:clear'), '換歌要送出 clear');
  eq(h.service.snapshot().active, null);
});

test('觀眾演出：換歌時佇列裡等待中的明信片也一併清掉，揪團不受影響', () => {
  const h = makeOverlayShowHarness();
  h.service.updateSettings({ raid: { enabled: true } });
  h.service.handleRaid({ eventId: 'r1', fromName: 'Raider', viewers: 9 });
  h.service.armPostcard('e2', { message: 'queued card' });
  h.service.onTrackPlaying({ entryId: 'e2' });
  eq(h.service.snapshot().queued, 1);
  h.service.onTrackChanged();
  eq(h.service.snapshot().queued, 0);
  eq(h.service.snapshot().active.kind, 'raid', '揪團感謝不該被換歌打斷');
});

test('觀眾演出：沒有留言就不登記，文字清掉控制字元並截長度，不信任 HTML', () => {
  const { cleanText } = require('../server/services/overlay-show');
  const h = makeOverlayShowHarness();
  eq(h.service.armPostcard('e3', { message: '   ' }), false);
  eq(cleanText('a\u0000b\nc‮d', 50), 'a b c d');
  eq(cleanText('x'.repeat(500), 140).length, 140);
  h.service.armPostcard('e4', { message: '<img src=x onerror=alert(1)>', name: '<b>n</b>' });
  h.service.onTrackPlaying({ entryId: 'e4' });
  const sent = h.events.find((e) => e.event === 'overlay-show:play').payload.payload;
  eq(sent.message, '<img src=x onerror=alert(1)>', '伺服器不改寫內容，顯示端一律 textContent');
  const display = fs.readFileSync(path.join(__dirname, '../public/js/overlay-show.js'), 'utf8');
  ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(display), '顯示端不得用 innerHTML 類 API');
});

test('觀眾演出：設定夾在合法範圍、存檔，測試演出不看開關', () => {
  const { normalizeSettings: normalizeOverlaySettings } = require('../server/services/overlay-show');
  const h = makeOverlayShowHarness();
  const next = h.service.updateSettings({ raid: { enabled: true, minViewers: -5, durationSec: 999, anchor: 'nowhere' }, postcard: { durationSec: 1 } });
  eq(next.raid.anchor, 'top-right', '不認得的位置退回預設');
  const split = h.service.updateSettings({ raid: { anchor: 'top-left' }, postcard: { anchor: 'bottom-right' } });
  eq(split.raid.anchor, 'top-left');
  eq(split.postcard.anchor, 'bottom-right', '兩種演出的位置要各自獨立');
  h.service.test('postcard');
  eq(h.events.filter((e) => e.event === 'overlay-show:play').pop().payload.anchor, 'bottom-right', '明信片用自己的位置');
  h.service.skip();
  h.service.test('raid');
  eq(h.events.filter((e) => e.event === 'overlay-show:play').pop().payload.anchor, 'top-left', '揪團感謝用自己的位置');
  h.service.skip();
  const legacy = normalizeOverlaySettings({ anchor: 'bottom-left' });
  eq(legacy.raid.anchor, 'bottom-left', '舊版共用位置要帶給兩邊');
  eq(legacy.postcard.anchor, 'bottom-left');
  eq(next.raid.minViewers, 1);
  eq(next.raid.durationSec, 15);
  eq(next.raid.style, 'gold', '不認得的外觀要退回預設');
  eq(h.service.updateSettings({ raid: { style: 'neon' } }).raid.style, 'neon');
  eq(h.service.updateSettings({ raid: { style: 'nope' } }).raid.style, 'neon', '無效外觀保留原值');
  eq(next.postcard.durationSec, 6);
  eq(next.postcard.style, 'paper', '不認得的明信片外觀要退回預設');
  eq(h.service.updateSettings({ postcard: { style: 'polaroid' } }).postcard.style, 'polaroid');
  eq(h.service.updateSettings({ postcard: { style: 'nope' } }).postcard.style, 'polaroid', '無效外觀保留原值');
  eq(h.getSaved().raid.durationSec, 15);
  const h2 = makeOverlayShowHarness();
  eq(h2.service.getSettings().raid.enabled, false);
  ok(h2.service.test('raid'), '關閉狀態下試播仍要能演');
  eq(h2.service.test('bogus'), null);
});

test('觀眾演出：Twitch 訂閱 channel.raid、事件交給 onRaid，且失敗不影響點歌訂閱', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/services/twitch-service.js'), 'utf8');
  ok(source.includes("createSubscription('channel.raid', { to_broadcaster_user_id: this.auth.userId })"));
  ok(/subscription\.type === 'channel\.raid'[\s\S]{0,400}this\.onRaid\?\.\(/.test(source));
  ok(/channel\.raid[\s\S]{0,300}catch \(err\)[\s\S]{0,200}揪團事件訂閱未啟用/.test(source), '揪團訂閱失敗要被吞掉並記錄');
  const index = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  ok(index.includes('onRaid: (event) => overlayShow.handleRaid(event)'));
  ok(index.includes('socketApi.setOverlayShow(overlayShow)'));
});

test('觀眾演出：只有桌面面板能改設定／試播，OBS 只收轉播，明信片要核准時明確勾選', () => {
  const handler = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/overlay-show.js'), 'utf8');
  ok(handler.includes("if (socket.clientType !== 'controller') return;"));
  const publicRequest = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/public-request.js'), 'utf8');
  ok(publicRequest.includes('payload?.postcard === true'), '預設不上畫面，必須明確傳 postcard:true');
  const playback = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/playback.js'), 'utf8');
  ok(playback.includes('ctx.overlayShow?.onTrackChanged()') && playback.includes('ctx.overlayShow?.onTrackPlaying('));
  const display = fs.readFileSync(path.join(__dirname, '../public/display.html'), 'utf8');
  ok(display.includes('/js/overlay-show.js') && display.includes('/css/overlay-show.css'));
  const panel = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok(/id="overlay-show-card"[^>]*data-new-feature="overlay-show"/.test(panel));
  ok(/id="overlay-show-title"[^>]*>[^\n]{0,120}data-new-badge-slot/.test(panel), '卡片的 NEW 要放在標題旁，不是卡片最底下');
  const badges = fs.readFileSync(path.join(__dirname, '../public/js/new-badges.js'), 'utf8');
  ok(badges.includes("'overlay-show':") && badges.includes("'overlay-show-nav':"));
  ok(/data-nav="public-request"[^>]*data-new-feature="alert-show-nav"/.test(panel), '入口導覽項目也要標 NEW，不然沒點進去看不到');
  ok(panel.includes('id="overlay-show-raid-anchor"') && panel.includes('id="overlay-show-postcard-anchor"'), '揪團與明信片位置各自設定');
  ok(badges.includes("addEventListener('change', seenNow)") && badges.includes(".closest('label')?.control"), '改了設定或用了 label 對應的選單，NEW 也要消失');
});

test('每首記憶的音量：存進 state、清單摘要帶 volume、清除後回預設', () => {
  const { createAppState } = require('../server/state/app-state');
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const appState = createAppState({ emit() {} });
  ok(appState.trackVolume instanceof Map, 'app-state 要提供 trackVolume');
  appState.playState.playlist = [{ id: 'loud', title: 'Loud', duration: 100 }, { id: 'quiet', title: 'Quiet', duration: 100 }];
  appState.playState.currentTrack = { id: 'loud', title: 'Loud' };
  const events = new Map();
  const emitted = [];
  const io = { emit() {}, to() { return { emit(event, data) { emitted.push({ event, data }); } }; } };
  let persisted = 0;
  registerPlaybackHandlers(io, { on(event, handler) { events.set(event, handler); }, id: 'fixture', clientType: 'controller' }, {
    ...appState, persistState() { persisted += 1; }, emitSetlist() {}, recordSessionSong() {}, broadcastState() {}, getEffectiveLyrics() { return null; },
  });
  let reply = null;
  events.get('track-volume:set')({ trackId: 'loud', volume: 142.6 }, (r) => { reply = r; });
  eq(reply.volume, 100, '音量夾在 0~100');
  events.get('track-volume:set')({ trackId: 'loud', volume: 45 }, (r) => { reply = r; });
  eq(appState.trackVolume.get('loud'), 45);
  eq(appState.playState.playlist[0].volume, 45, '鐵則 17：清單裡的同一首要回寫');
  eq(appState.playState.currentTrack.volume, 45);
  ok(persisted >= 2, '要寫進 state.json');
  ok(emitted.some((e) => e.event === 'track-volume:update' && e.data.volume === 45), '通知其他面板');
  const summary = appState.getPublicPlaylist(() => true);
  eq(summary.find((t) => t.id === 'loud').volume, 45, '清單摘要帶記憶音量');
  eq(summary.find((t) => t.id === 'quiet').volume, undefined, '沒調過的歌不帶欄位');
  events.get('track-volume:set')({ trackId: 'loud', volume: 'x' }, (r) => { reply = r; });
  eq(reply.ok, false, '無效值不接受');
  events.get('track-volume:set')({ trackId: 'loud', volume: null }, (r) => { reply = r; });
  eq(appState.trackVolume.has('loud'), false, 'null＝清除記憶');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  ok(source.includes('trackVolume: Object.fromEntries(trackVolume)') && source.includes('saved.trackVolume'), '重開後要讀回');
});

test('每首記憶的音量：面板調音量只記給這首、不改預設；靜音與換歌套用不寫記憶', () => {
  const playback = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
  ok(playback.includes('applyTrackVolume(track);'), '載入歌曲時要套用這首的記憶音量');
  ok(playback.includes("AudioProcessor.setVolume(vol, { remember: !transientVolumeChange && !perSong })"), '每首調整不可改預設音量');
  ok(/volumeBeforeMute = current;\s*return setVolumeTransient\(0\);/.test(playback), '靜音不可被記成這首的音量');
  const processor = fs.readFileSync(path.join(__dirname, '../public/js/audio-processor.js'), 'utf8');
  ok(processor.includes("if (options.remember === false) return;") && processor.includes('getDefaultVolume'));
  const panel = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok(panel.includes('id="track-volume-reset"') && panel.includes('id="per-song-volume-toggle"') && panel.includes('id="default-volume-slider"'));
  ok(panel.includes('data-new-feature="per-song-volume"'));
  const handlers = fs.readFileSync(path.join(__dirname, '../server/routes/handlers/playback.js'), 'utf8');
  ok(/socket\.on\('track-volume:set'/.test(handlers));
  const socketHandler = fs.readFileSync(path.join(__dirname, '../server/routes/socket-handler.js'), 'utf8');
  const readOnly = socketHandler.slice(socketHandler.indexOf('const READ_ONLY_EVENTS'), socketHandler.indexOf(']);', socketHandler.indexOf('const READ_ONLY_EVENTS')));
  ok(!readOnly.includes('track-volume:set'), 'OBS／唯讀端不可改記憶音量');
});

test('快捷歌詞模板：最多 20 個快捷鍵動作，1～9 面板內預設 Ctrl+Alt+數字、全域不預綁，且不搶使用者既有的按鍵', () => {
  const H = require('../public/js/hotkeys.js');
  const ids = Array.from({ length: 20 }, (_, i) => `template-${i + 1}`);
  ok(ids.every((id) => H.ACTION_IDS.includes(id)), '二十個動作都要登記');
  ok(!H.ACTION_IDS.includes('template-21'), '上限 20');
  const fresh = H.defaults();
  eq(fresh.inApp['template-1'], 'Ctrl+Alt+Digit1');
  eq(fresh.inApp['template-9'], 'Ctrl+Alt+Digit9');
  eq(fresh.inApp['template-10'], '', '10 以上預設不綁');
  ok(ids.every((id) => fresh.global[id] === ''), '全域預設不綁，避免搶走 OBS／遊戲的按鍵');
  // 舊版設定沒有這些動作：補上預設，其他設定不動
  const upgraded = H.normalize({ inApp: { 'play-toggle': 'KeyP' }, global: { 'lyrics-hide': 'Ctrl+Alt+KeyH' } });
  eq(upgraded.inApp['play-toggle'], 'KeyP');
  eq(upgraded.global['lyrics-hide'], 'Ctrl+Alt+KeyH');
  eq(upgraded.inApp['template-2'], 'Ctrl+Alt+Digit2');
  // 使用者早就把 Ctrl+Alt+1 給了別的動作：保留使用者的，模板槽位留空
  const taken = H.normalize({ inApp: { 'lyrics-hide': 'Ctrl+Alt+Digit1' }, global: {} });
  eq(taken.inApp['lyrics-hide'], 'Ctrl+Alt+Digit1');
  eq(taken.inApp['template-1'], '', '撞鍵時不可搶走既有綁定');
  const shell = require('../electron/global-hotkeys.js');
  ok(ids.every((id) => shell.ACTION_IDS.includes(id)), '桌面版全域快捷鍵白名單要同步');
});

test('快捷歌詞模板：只走 LyricTemplates.select 這個單一入口，空槽位不自動挑模板，下架模板不能被叫出來，可新增到 20 個、可移除', () => {
  const quick = fs.readFileSync(path.join(__dirname, '../public/js/quick-templates.js'), 'utf8');
  const code = quick.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(code.includes('window.LyricTemplates.select(id)'), '切換要跟模板畫廊走同一條路');
  ok(!code.includes('lyric-settings:update'), '不可自己送歌詞設定，避免繞過驗證與快照');
  ok(/if \(!id\) \{ toast\(t\('quickTemplates\.toast\.empty'/.test(quick), '空槽位只提示，不自動選');
  ok(quick.includes("const STORAGE_KEY = 'elitesand.quickTemplates.v1'") && quick.includes('version: 1'), '槽位設定要帶版本');
  ok(quick.includes('const MAX_SLOTS = 20;') && /if \(slots\.length >= MAX_SLOTS\) return false;/.test(quick), '上限 20 個');
  ok(/slots\.splice\(index, 1\);[\s\S]{0,80}changed\(\{ removedNumber \}\)/.test(quick), '移除要讓後面的往前補，並告知哪個號碼消失');
  const extras = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
  ok(extras.includes('window.LyricTemplates = Object.freeze({'));
  ok(/select\(id, options\) \{\s*if \(!visibleTemplateIds\(\)\.includes\(id\)\) return 'unknown';/.test(extras), '看不到的模板（下架的季節模板）不能用快捷入口叫出來');
  ok(/if \(nextTemplate === settings\.template\) \{ announce\(\); return 'same'; \}/.test(extras), '重複切到同一個模板不可重送設定');
  ok(extras.includes("new CustomEvent('lyric-template:change'"), '模板變了要通知直播頁更新選取狀態');
  const panel = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok(panel.includes('data-prep-panel="templates"') && panel.includes('id="quick-template-list"'));
  ok(panel.includes('data-new-feature="quick-templates"') && panel.includes('data-new-feature="template-memory"'));
  ok(panel.indexOf('/js/quick-templates.js') < panel.indexOf('/js/app-hotkeys.js'), '快捷鍵設定表要讀得到槽位');
  const hotkeys = fs.readFileSync(path.join(__dirname, '../public/js/app-hotkeys.js'), 'utf8');
  ok(/if \(!id \|\| !templateSlotExists\(id\)\) return null;/.test(hotkeys), '不存在的槽位號碼不可攔下按鍵');
  ok(/detail\.removedNumber[\s\S]{0,160}config\.global\[id\] = ''/.test(hotkeys), '移除後消失的號碼要放掉全域快捷鍵');
});

test('記住每首歌的模板：伺服器只存合法模板 ID、清單摘要帶 lyricTemplate、可清除；切歌自動套用不會被反過來記住', () => {
  const { createAppState } = require('../server/state/app-state');
  const registerPlaybackHandlers = require('../server/routes/handlers/playback');
  const appState = createAppState({ emit() {} });
  ok(appState.trackTemplate instanceof Map, 'app-state 要提供 trackTemplate');
  appState.playState.playlist = [{ id: 'song-a', title: 'A', duration: 100 }, { id: 'song-b', title: 'B', duration: 100 }];
  appState.playState.currentTrack = { id: 'song-a', title: 'A' };
  const events = new Map();
  const emitted = [];
  const io = { emit() {}, to() { return { emit(event, data) { emitted.push({ event, data }); } }; } };
  registerPlaybackHandlers(io, { on(event, handler) { events.set(event, handler); }, id: 'fixture', clientType: 'controller' }, {
    ...appState, persistState() {}, emitSetlist() {}, recordSessionSong() {}, broadcastState() {}, getEffectiveLyrics() { return null; },
  });
  let reply = null;
  events.get('track-template:set')({ trackId: 'song-a', template: 'not-a-template' }, (r) => { reply = r; });
  eq(reply.ok, false, '不認得的模板不接受');
  events.get('track-template:set')({ trackId: 'song-a', template: 'pulse' }, (r) => { reply = r; });
  eq(reply.template, 'pulse');
  eq(appState.playState.playlist[0].lyricTemplate, 'pulse', '鐵則 17：清單裡的同一首要回寫');
  eq(appState.playState.currentTrack.lyricTemplate, 'pulse');
  ok(emitted.some((e) => e.event === 'track-template:update' && e.data.template === 'pulse'));
  const summary = appState.getPublicPlaylist(() => true);
  eq(summary.find((t) => t.id === 'song-a').lyricTemplate, 'pulse');
  eq(summary.find((t) => t.id === 'song-b').lyricTemplate, undefined, '沒記住的歌不帶欄位');
  events.get('track-template:set')({ trackId: 'song-a', template: null }, (r) => { reply = r; });
  eq(appState.trackTemplate.has('song-a'), false, 'null＝清除');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'state', 'app-state.js'), 'utf8');
  ok(source.includes('trackTemplate: Object.fromEntries(trackTemplate)') && source.includes('saved.trackTemplate'), '重開後要讀回');
  const quick = fs.readFileSync(path.join(__dirname, '../public/js/quick-templates.js'), 'utf8');
  ok(/window\.LyricTemplates\.select\(id, \{ user: false \}\)/.test(quick), '切歌時自動套用要標成非使用者操作');
  ok(/addEventListener\('lyric-template:selected'/.test(quick) && /if \(!memory\.enabled\) return;/.test(quick), '只有開啟記憶時，使用者自己切的模板才記給這首');
  ok(/enabled: !!\(stored && stored\.enabled === true\)/.test(quick), '預設關閉，舊使用者升級後行為不變');
  const extras = fs.readFileSync(path.join(__dirname, '../public/js/lyric-extras.js'), 'utf8');
  ok(/if \(options\.user === false\) return;/.test(extras), '自動套用不發 lyric-template:selected');
  const playback = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');
  ok(playback.includes("new CustomEvent('track:loaded', { detail: { track } })"));
});

test('跟唱視窗置頂：專用 preload 只開放置頂、IPC 只認主程序開的跟唱視窗、偏好記在 userData、瀏覽器開的不顯示按鈕', () => {
  const electronShell = require('../electron/shell.js');
  const files = new Map();
  const memFs = {
    readFileSync: (file) => { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); },
    writeFileSync: (file, data) => files.set(file, data),
    mkdirSync: () => {},
  };
  eq(electronShell.readPrompterPin('/ud', memFs), false, '沒記錄＝不置頂');
  electronShell.writePrompterPin('/ud', true, memFs);
  eq(electronShell.readPrompterPin('/ud', memFs), true, '置頂偏好要記住');
  electronShell.writePrompterPin('/ud', false, memFs);
  eq(electronShell.readPrompterPin('/ud', memFs), false);
  const preload = fs.readFileSync(path.join(__dirname, '../electron/prompter-preload.js'), 'utf8');
  ok(preload.includes("exposeInMainWorld('ElitesandPrompter'"), '跟唱視窗用自己的 API 名稱');
  ok((preload.match(/ipcRenderer\.invoke\(/g) || []).length === 2, '只開放讀取與設定置頂兩件事');
  ok(!/ipcRenderer\.(send|on)\(/.test(preload));
  const shell = fs.readFileSync(path.join(__dirname, '../electron/shell.js'), 'utf8');
  ok(shell.includes("preload: path.join(shellRoot, 'electron', 'prompter-preload.js')"), '跟唱視窗要掛專用 preload，不是主視窗那份');
  for (const channel of ['elitesand:prompter-pin-get', 'elitesand:prompter-pin-set']) {
    const handler = shell.slice(shell.indexOf(`ipcMain.handle('${channel}'`));
    ok(/const child = prompterWindowOf\(event\);\s*if \(!child\) return null;/.test(handler.slice(0, 200)), `${channel} 必須確認呼叫的是跟唱視窗`);
  }
  ok(/if \(isPrompterUrl\(details\?\.url, port\)\) \{\s*prompterWindows\.add\(childWindow\);/.test(shell), '只有 /prompter 子視窗能登記成跟唱視窗');
  ok(shell.includes("prompterWindows.delete(childWindow)"), '關閉後要移除，不留殘留狀態');
  const html = fs.readFileSync(path.join(__dirname, '../public/prompter.html'), 'utf8');
  ok(/id="pt-pin-btn"[^>]*hidden/.test(html), '預設隱藏，瀏覽器開的跟唱視圖不能假裝能置頂');
  const prompter = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8');
  ok(/const api = window\.ElitesandPrompter;[\s\S]{0,120}if \(!api \|\| !button\) return;/.test(prompter));
  ok(/if \(!state\) return;[\s\S]{0,60}button\.hidden = false;/.test(prompter), '主程序不認這個視窗時維持隱藏');
});

test('搜歌時播放清單不被擠出左欄：有結果時加歌區設上限、結果在框內捲，平常排版不變', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/panel.css'), 'utf8');
  const sel = '.live-queue #music-source-card:has(#youtube-search-panel:not([hidden]) > .youtube-search-results:not(:empty))';
  const rule = css.slice(css.indexOf(sel + ' {'), css.indexOf('}', css.indexOf(sel + ' {')));
  ok(rule.includes('max-height: min(60%, calc(100% - 200px))'), '加歌區最多六成，且至少留 200px 給播放清單');
  ok(rule.includes('flex: 0 0 auto'), '不可參與 flex 縮放（清單很長時會把加歌區擠扁）');
  ok(rule.includes('overflow-y: auto'), '左欄太矮時加歌區自己捲，按鈕不被裁掉');
  ok(css.includes('.live-queue #youtube-search-panel > .youtube-search-results:not(:empty) { flex: 1 1 auto; min-height: 96px; max-height: none; }'));
  ok(css.includes('.live-queue #music-source-card { flex: none; }'), '沒有搜尋結果時維持原本的加歌區');
});

test('OBS 極簡歌單：伺服器／面板／顯示端三份版型清單同步，背景透明、只放已唱、放不下才捲、量不到寬度會重量', () => {
  const appStateSource = fs.readFileSync(path.join(__dirname, '../server/state/app-state.js'), 'utf8');
  const panel = fs.readFileSync(path.join(__dirname, '../public/js/app-setlist-panel.js'), 'utf8');
  const setlist = fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8');
  for (const [name, src] of [['server', appStateSource], ['panel', panel], ['display', setlist]]) {
    ok(/const SETLIST_LAYOUTS = \[[^\]]*'minimal-board'\]/.test(src), `${name} 的版型清單要有 minimal-board`);
  }
  const schema = require('../public/js/setlist-style-schema');
  eq(schema.FIELD_BY_KEY.minimalSkin.default, 'editorial');
  ok(schema.FIELD_BY_KEY.minimalSkin.values.join() === 'editorial,framed,dreamy,vinyl', '一個版型、四款外觀');
  const target = schema.getDefaultStyle();
  schema.validateAndApply({ minimalSkin: 'evil', minimalTickerSpeed: 999 }, target);
  eq(target.minimalSkin, 'editorial', '不認得的外觀不接受');
  eq(target.minimalTickerSpeed, 60, '速度夾在範圍內');
  const block = setlist.slice(setlist.indexOf('const minimalBoard = {'), setlist.indexOf("const LAYOUTS = {"));
  ok(block.includes('const past = model.past;') && block.includes('foot.hidden = past.length === 0;'), '底部只放真正唱過的歌，一首都沒有就隱藏');
  ok(block.includes('if (one.scrollWidth <= ticker.clientWidth + 2) return;'), '放得下就靜止');
  ok(/if \(ticker\.clientWidth === 0\) \{\s*if \(tries\+\+ < 20\) setTimeout\(measure, 500\);/.test(block), '來源被藏起來時量到 0 要晚點重量');
  ok(!block.replace(/\/\/.*$/gm, '').includes('requestAnimationFrame'), 'OBS 節流背景來源時 rAF 不會觸發，不能靠它量寬度');
  ok(block.includes('textContent') && !/innerHTML\s*=\s*[^'"]*title/.test(block), '歌名一律純文字輸出');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/setlist.css'), 'utf8');
  const mb = css.slice(css.indexOf('/* ══ 極簡歌單（minimal-board）══'));
  ok(!/\.mb-(stage|board)\s*\{[^}]*background:\s*(?!linear)/.test(mb), '版型本身不鋪底色');
  ok(mb.includes('@media (prefers-reduced-motion: reduce)'), '尊重減少動態效果');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok(html.includes('data-setlist-layout="minimal-board"') && html.includes('data-new-feature="setlist-minimal"'));
  // 常駐小動畫與播放狀態：裝飾只在 mount 建一次，render 不重建（換歌、暫停都不會讓動畫重來）
  ok(setlist.includes('playing: !!current && isPlayingFlag(data),'), '歌單要知道正在播放還是暫停（只給裝飾用，不參與分組）');
  ok(setlist.includes("document.documentElement.dataset.slPlaying = model.current && model.playing ? '1' : '0';"));
  const mount = block.slice(block.indexOf('mount(root)'), block.indexOf('render(root)'));
  const render = block.slice(block.indexOf('render(root)'));
  ok(['mb-star', 'mb-glint', 'mb-wave', 'mb-disc'].every((c) => mount.includes(c)) && !['mb-star', 'mb-glint', 'mb-wave', 'mb-disc'].some((c) => render.includes(c)), '裝飾元素只在 mount 建立');
  ok(mb.includes(':root[data-sl-playing="1"] .mb-wave i { animation: mb-wave'), '音波只在播放時跳動');
  ok(mb.includes(':root[data-mb-skin="vinyl"][data-sl-playing="1"] .mb-disc { animation-play-state: running; }'), '唱片播放時轉、暫停停在當下角度');
  const slim = fs.readFileSync(path.join(__dirname, '../public/js/output-slim.js'), 'utf8');
  ok(slim.includes("fieldOf('sls-minimal-skin')"), '改版後的設定面板要放得到這組設定，不然會被藏起來');
});

test('Apple Music 歌詞：paxsenix 塞車時改用 LyricsPlus，逐字轉成 KRC、和聲不併進主行、來源仍記為 Apple Music 那一格', () => {
  const engineModule = require('../server/services/lyrics-engine.js');
  const L = engineModule.LyricsEngine || engineModule;
  const lines = [
    { time: 1440, duration: 1964, text: '満員電車触んなって', syllabus: [
      { time: 1440, duration: 699, text: '満員電' }, { time: 2139, duration: 384, text: '車' },
      { time: 2523, duration: 482, text: '触んなっ' }, { time: 3005, duration: 399, text: 'て' },
      { time: 3100, duration: 300, text: '(oh)', isBackground: true },
    ] },
    { time: 5000, duration: 1000, text: '只有整行', syllabus: [] },
  ];
  const out = L.lyricsPlusToLyrics(lines);
  eq(out.type, 'krc');
  const krc = out.lyrics.split('\n');
  eq(krc[0], '[00:01.44]<1964>満員電<0,699>車<699,384>触んなっ<1083,482>て<1565,399>', '逐字時間要換成相對行首');
  ok(!out.lyrics.includes('(oh)'), '和聲不併進主行');
  eq(krc[1], '[00:05.00]<1000>只有整行<0,1000>', '沒有逐字的行退成整行一個字');
  const lineOnly = L.lyricsPlusToLyrics([{ time: 2000, duration: 1500, text: 'line only' }]);
  eq(lineOnly.type, 'lrc');
  eq(lineOnly.lyrics, '[00:02.00]line only');
  eq(L.lyricsPlusToLyrics([]), null);
  const source = fs.readFileSync(path.join(__dirname, '../server/services/lyrics-engine.js'), 'utf8');
  ok(/const relay = Date\.now\(\) < paxsenixDownUntil \? null : await this\.searchPaxsenixRelay\(artist, title, duration\);\s*if \(relay\) return relay;\s*return this\.searchLyricsPlus\(artist, title, duration\);/.test(source), 'paxsenix 拿不到就改問 LyricsPlus');
  ok(/if \(lyricsRes\.status >= 500\) \{\s*paxsenixDownUntil = Date\.now\(\) \+ PAXSENIX_COOLDOWN_MS;/.test(source), '5xx 後暫時略過 paxsenix');
  ok(source.includes('if (atRelay) paxsenixDownUntil = Date.now() + PAXSENIX_COOLDOWN_MS;'), '向中繼拿歌詞逾時也要略過');
  ok(source.includes("return { ...converted, source: 'paxsenix' };"), '來源記成同一格，偏移、統計欄位都不必改');
  const telemetry = require('../server/services/telemetry-fields.js');
  ok(telemetry.ALLOWED_KEYS.includes('lyrics.source.paxsenix.hit'), '沿用既有統計欄位，不需要新的白名單');
});
