'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EVENT_END = Date.parse('2026-11-08T00:00:00+08:00');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const parseResult = (stdout) => JSON.parse(stdout.slice(stdout.lastIndexOf('__RESULT__') + '__RESULT__'.length));

function runIsolated(script, now) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-halloween-'));
  try {
    return parseResult(execFileSync(process.execPath, ['-e', `Date.now = () => ${now};\n${script}`], {
      cwd: root, env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8',
    }));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('Halloween runs through all of 2026-11-07 and closes at 11-08 00:00 Taiwan time', () => {
  const out = runIsolated(`
    const h = require('./server/services/halloween-event');
    process.stdout.write('__RESULT__' + JSON.stringify({
      end: h.EVENT_END, before: h.isActiveAt(${EVENT_END} - 1), at: h.isActiveAt(${EVENT_END}), active: h.isActive(),
      endsAt: h.snapshot().endsAt,
    }));
  `, EVENT_END - 60000);
  assert.equal(out.end, EVENT_END);
  assert.equal(out.before, true);
  assert.equal(out.at, false);
  assert.equal(out.active, true);
  assert.equal(out.endsAt, new Date(EVENT_END).toISOString());
});

test('treat style follows amount tiers, honors manual picks, clamps sizes, and saves its own file', () => {
  const out = runIsolated(`
    const fs = require('fs');
    const path = require('path');
    const h = require('./server/services/halloween-event');
    const styleOf = (amount, style) => h.addDonation({ name: 'x', amount, style }).state.donations.at(-1);
    const r = {
      defaults: h.snapshot(),
      auto: [1, 99, 100, 300, 500, 999, 1000].map((a) => styleOf(a).style),
      manual: styleOf(10, 'witch'),
      bogus: styleOf(10, 'rabbit').style,
      tiers: h.setConfig({ tiers: { witch: 50, ghost: -5 } }).state.tiers,
      afterTier: styleOf(60).style,
      bigScale: h.setConfig({ pumpkinScale: 9 }).state.pumpkinScale,
      smallScale: h.setConfig({ treatScale: 0.1 }).state.treatScale,
      keepScale: h.setConfig({ treatScale: 'x', title: '只改標題' }).state.treatScale,
      saved: h.saveNow(),
    };
    r.file = JSON.parse(fs.readFileSync(path.join(process.env.ELITESAND_DATA_DIR, 'halloween-event.json'), 'utf8'));
    r.moonFileExists = fs.existsSync(path.join(process.env.ELITESAND_DATA_DIR, 'moon-event.json'));
    process.stdout.write('__RESULT__' + JSON.stringify(r));
  `, EVENT_END - 86400000);
  assert.equal(out.defaults.title, '萬聖節搗蛋夜');
  assert.equal(out.defaults.doneText, '南瓜燈全亮了，謝謝大家！');
  assert.deepEqual(out.defaults.tiers, { candy: 1, ghost: 100, bat: 300, pumpkin: 500, witch: 1000 });
  assert.equal(out.defaults.treatScale, 1);
  assert.equal(out.defaults.pumpkinScale, 1);
  assert.equal('lanternScale' in out.defaults, false, '萬聖節不可帶中秋的大小欄位');
  assert.deepEqual(out.auto, ['candy', 'candy', 'ghost', 'bat', 'pumpkin', 'pumpkin', 'witch']);
  assert.equal(out.manual.style, 'witch');
  assert.equal(out.manual.styleAuto, false);
  assert.equal(out.bogus, 'candy', '中秋的樣式名稱不可混進萬聖節');
  assert.equal(out.tiers.witch, 50);
  assert.equal(out.tiers.ghost, 100);
  assert.equal(out.afterTier, 'witch');
  assert.equal(out.bigScale, 2.5);
  assert.equal(out.smallScale, 0.6);
  assert.equal(out.keepScale, 0.6);
  assert.equal(out.saved, true);
  assert.equal(out.file.config.title, '只改標題');
  assert.equal(out.file.donations.length, 10);
  assert.equal(out.moonFileExists, false, '萬聖節存檔不可寫進中秋的檔案');
});

test('socket events use the halloween: prefix while active and refuse every write after the cutoff', () => {
  const script = `
    const register = require('./server/routes/handlers/halloween-event');
    const handlers = {};
    const emitted = [];
    register({ emit: (e) => emitted.push(e) }, { clientType: 'controller', on: (e, fn) => { handlers[e] = fn; } });
    register({ emit: (e) => emitted.push(e) }, { clientType: 'display', on: () => { throw new Error('display must not get write handlers'); } });
    const results = {};
    handlers['halloween:get'](null, (r) => { results.get = r; });
    handlers['halloween:donate']({ name: 'x', amount: 1 }, (r) => { results.donate = r; });
    handlers['halloween:credits'](null, (r) => { results.credits = r; });
    Promise.resolve(handlers['halloween:raffle:draw']({}, (r) => { results.raffle = r; })).then(() => {
      process.stdout.write('__RESULT__' + JSON.stringify({ events: Object.keys(handlers).sort(), results, emitted }));
    });
  `;
  const live = runIsolated(script, EVENT_END - 60000);
  assert.deepEqual(live.events, ['halloween:celebrate', 'halloween:clear', 'halloween:config', 'halloween:credits', 'halloween:donate',
    'halloween:fx:get', 'halloween:fx:reset', 'halloween:fx:settings', 'halloween:get', 'halloween:raffle:clear', 'halloween:raffle:draw', 'halloween:remove']);
  assert.equal(live.results.donate.ok, true);
  assert.deepEqual(live.emitted, ['halloween:update', 'halloween:credits']);

  const ended = runIsolated(script, EVENT_END + 1000);
  assert.deepEqual(ended.results.get, { ok: false, inactive: true });
  assert.equal(ended.results.donate.inactive, true);
  assert.equal(ended.results.credits.inactive, true);
  assert.equal(ended.results.raffle.inactive, true, '活動結束後抽獎也不能用');
  assert.deepEqual(ended.emitted, []);
});

test('the /halloween overlay connects as a read-only seasonal client and ships in the release bundle', () => {
  const socketHandler = read('server/routes/socket-handler.js');
  assert.match(socketHandler, /SEASONAL_OVERLAYS = new Map\(\[\['moon', moonEvent\], \['halloween', halloweenEvent\]\]\)/);
  assert.match(socketHandler, /PIN_EXEMPT_CLIENT_TYPES = new Set\(\[[^\]]*\.\.\.SEASONAL_OVERLAYS\.keys\(\)\]\)/);
  const readOnly = socketHandler.slice(socketHandler.indexOf('const READ_ONLY_EVENTS'), socketHandler.indexOf(']);', socketHandler.indexOf('const READ_ONLY_EVENTS')));
  assert.doesNotMatch(readOnly, /halloween:|moon:/, '疊加層不可送任何活動寫入事件');
  assert.match(read('server/index.js'), /\[\['moon', moonEvent\], \['halloween', halloweenEvent\]\]/);
  assert.match(read('tools/build-production-bundles.js'), /\{ html: 'halloween\.html', bundleName: 'halloween' \}/);
  const page = read('public/halloween.html');
  assert.ok(page.indexOf('/js/seasonal-overlay.js') < page.indexOf('/js/halloween.js'), '共用核心必須先於主題載入');
});

test('the panel tab has every element the controller needs and every string it shows', () => {
  const html = read('public/index.html');
  const i18n = read('public/js/i18n.js');
  for (const id of ['end-notice', 'add-form', 'add-name', 'add-amount', 'add-style', 'summary-total', 'summary-goal',
    'summary-percent', 'summary-fill', 'preview-iframe', 'preview-mode', 'config-form', 'config-title-input',
    'config-done-text', 'config-goal', 'config-base', 'donation-list', 'clear', 'play-celebrate', 'play-credits',
    'treat-scale', 'treat-scale-val', 'pumpkin-scale', 'pumpkin-scale-val']) {
    assert.ok(html.includes(`id="halloween-${id}"`), `index.html 缺少 #halloween-${id}`);
  }
  for (const style of ['candy', 'ghost', 'bat', 'pumpkin', 'witch']) {
    assert.ok(html.includes(`data-tier="${style}"`), `缺少 ${style} 門檻輸入`);
    assert.ok(i18n.includes(`'halloween.style.${style}':`), `缺少 ${style} 的翻譯`);
  }
  const used = new Set([...html.matchAll(/data-i18n(?:-[a-z-]+)?="((?:halloween\.|nav\.halloween)[\w.]+)"/g)].map((m) => m[1]));
  for (const key of ['halloween.overlay.thanks', 'halloween.credits.heading', 'halloween.credits.closing', 'halloween.credits.summary',
    'halloween.endNotice', 'halloween.empty', 'halloween.toast.ended', 'halloween.style.fallback']) used.add(key);
  for (const key of used) assert.ok(i18n.includes(`'${key}':`), `i18n.js 缺少 ${key}`);
  const row = i18n.match(/'halloween\.overlay\.thanks': (\[[^\n]+\]),/);
  assert.equal(JSON.parse(row[1]).length, 5, '每個字串都要有五種語言');
});

test('every art slot the code uses is documented, and missing art is skipped through the manifest instead of 404-probing', () => {
  const sources = ['public/js/halloween.js', 'public/js/app-halloween-fx.js', 'public/js/setlist.js', 'public/js/lyric-template-halloween.js',
    'public/css/halloween.css', 'public/css/setlist.css', 'public/css/display.css', 'public/css/panel.css'].map(read).join('\n');
  const slots = new Set([...sources.matchAll(/--art-([a-z0-9-]+)/g)].map((m) => m[1]));
  for (const m of sources.matchAll(/HalloweenArt\.(?:load|probe)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/'([a-z0-9-]+)'/g)) slots.add(s[1]);
  }
  for (const style of ['candy', 'ghost', 'bat', 'pumpkin', 'witch']) slots.add(`tag-${style}`);
  slots.delete('tag-');
  const readme = read('public/assets/halloween/README.txt');
  const documented = new Set([...readme.matchAll(/^ {2}([a-z0-9-]+) +\d+×\d+/gm)].map((m) => m[1]));
  assert.ok(slots.size >= 17, `應該找得到全部插槽（解析壞了？）：${[...slots]}`);
  for (const slot of slots) assert.ok(documented.has(slot), `README.txt 缺少插槽 ${slot} 的尺寸說明`);
  for (const slot of documented) assert.ok(slots.has(slot), `README.txt 列了程式沒用到的插槽 ${slot}`);

  const art = read('public/js/halloween-art.js');
  assert.ok(art.indexOf('manifest.json') < art.indexOf('new Image()'), '必須先看清單再載圖');
  assert.match(art, /slots\.has\(slot\) \? loadImage\(slot\) : null/, '清單上沒有的插槽不可去載圖');
  const server = read('server/index.js');
  assert.ok(server.indexOf("app.get('/assets/halloween/manifest.json'") < server.indexOf("app.use(express.static(path.join(projectRoot, 'public')"),
    '清單路由必須掛在靜態檔之前');
});
