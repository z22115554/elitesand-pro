const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../public/js', name), 'utf8');
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function display(load, check = async () => ({ resolved: false })) {
  const source = read('display.js');
  const css = new Map(), notifications = [], reports = [], timers = new Map();
  const context = {
    window: { ElitesandFontAssets: { isAssetId: Boolean, load }, ElitesandFontProbe: { check } },
    document: { documentElement: { style: { setProperty: (name, value) => css.set(name, value) } } },
    KaraokeEngine: { notifyTemplateSettings: settings => notifications.push(settings) },
    SocketClient: { send: (...args) => reports.push(args) },
    isSpoutOutput: false, isPreviewClient: false, console: { warn() {} },
    setTimeout: fn => { const id = {}; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  let fontAssetApplyVersion'), source.indexOf('  // 曲名／演出者給模板用')) +
    '\nglobalThis.apply = applyLocalFontAssets; globalThis.probe = scheduleDisplayFontProbe;', context);
  return { ...context, css, notifications, reports, timers };
}

test('delayed font notifies canvas after CSS changes and loaded binary skips OS-name warning', async () => {
  const job = defer(); let probes = 0;
  const env = display(() => job.promise, async () => { probes++; return { resolved: false }; });
  const s = { fontFamily: 'Unregistered name', fontAssetId: 'font-a' };
  const task = env.apply(s, 'serif');
  assert.equal(env.notifications.length, 0);
  job.resolve({ family: 'ElitesandLocalFont-a' });
  const applied = await task;
  assert.match(env.css.get('--display-font-family'), /ElitesandLocalFont-a/);
  assert.equal(env.notifications[0], s);
  env.probe(s, applied);
  assert.equal(env.timers.size, 0); assert.equal(probes, 0);
  env.css.set('--display-font-family', 'reset');
  const cached = env.apply(s, 'serif');
  assert.match(env.css.get('--display-font-family'), /ElitesandLocalFont-a/, 'cached stack restored synchronously');
  await cached;
});

test('old font completion cannot overwrite newer font or cleared preset', async () => {
  const job = defer(); const env = display(() => job.promise);
  const old = env.apply({ fontAssetId: 'old', fontFamily: 'Old' }, 'serif');
  await env.apply({ fontFamily: 'system-ui' }, 'system-ui');
  job.resolve({ family: 'OldInternal' });
  assert.equal(await old, undefined); assert.equal(env.notifications.length, 0);
});

test('failed Latin asset preserves successful main asset; failure can retry', async () => {
  let fail = true;
  const env = display(id => id === 'latin' && fail ? Promise.reject(new Error('offline')) : Promise.resolve({ family: id }));
  const s = { fontAssetId: 'main', fontFamilyLatinAssetId: 'latin', fontFamily: 'MainOS', fontFamilyLatin: 'LatinOS' };
  const first = await env.apply(s, 'serif');
  assert.equal(first.mainLoaded, true); assert.match(env.css.get('--display-font-family'), /'main'/);
  fail = false; await env.apply(s, 'serif');
  assert.match(env.css.get('--display-font-family'), /^'latin', 'main'/);
});

test('in-flight old diagnostic is discarded after settings change', async () => {
  const job = defer(); const env = display(() => null, () => job.promise);
  const s = { fontFamily: 'Old' }; env.probe(s, await env.apply(s, 'serif'));
  const probing = [...env.timers.values()][0]();
  await env.apply({ fontFamily: 'New' }, 'serif');
  job.resolve({ resolved: false }); await probing;
  assert.equal(env.reports.length, 0);
});

function picker(storage, fetch) {
  const context = { window: {}, localStorage: storage, fetch, console };
  vm.createContext(context); vm.runInContext(read('font-picker.js'), context);
  return context.window.ElitesandFontPicker;
}
function storage() { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; }
const data = { success: true, fonts: ['Font A'], aliases: { 'Font A': ['English alias'] }, assets: { 'Font A': { id: 'abcdefghijklmnop' } } };
const response = value => ({ ok: true, json: async () => value });

test('catalogue deduplicates requests, survives reload with aliases and IDs, and opens before refresh', async () => {
  const saved = storage(); const job = defer(); let calls = 0;
  const api = picker(saved, () => { calls++; return job.promise; });
  const a = api.get(), b = api.get(); job.resolve(response(data));
  await Promise.all([a, b]); await api.get(); assert.equal(calls, 1);
  const background = defer(); const restored = picker(saved, () => background.promise);
  const result = await restored.get();
  assert.equal(result.aliases['Font A'][0], 'English alias'); assert.equal(result.assets['Font A'].id, 'abcdefghijklmnop');
  background.resolve(response({ success: true, fonts: ['Font B'] }));
  await restored.refresh(); assert.equal((await restored.get()).fonts[0], 'Font B');
});

test('bad or blocked storage is non-fatal, failed refresh keeps saved fonts and is retryable', async () => {
  const saved = storage(); const api = picker(saved, async () => response(data)); await api.get();
  let fail = true;
  const restored = picker(saved, async () => { if (fail) throw new Error('offline'); return response({ success: true, fonts: [] }); });
  assert.equal((await restored.get()).fonts[0], 'Font A');
  await assert.rejects(restored.refresh());
  fail = false; await restored.refresh(); assert.equal((await restored.get()).fonts.length, 0);
  const blocked = picker({ getItem() { throw Error(); }, setItem() { throw Error(); } }, async () => response(data));
  assert.equal((await blocked.get()).fonts[0], 'Font A');
});
