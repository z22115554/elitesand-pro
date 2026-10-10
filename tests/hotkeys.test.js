'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const H = require('../public/js/hotkeys');
const desktop = require('../electron/global-hotkeys');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const key = (code, mods = {}) => ({ code, key: '', ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta });

test('defaults follow Spotify: space plays, Ctrl+arrows skip and change volume, Shift+arrows seek, media keys work globally', () => {
  const d = H.defaults();
  assert.equal(d.inApp['play-toggle'], 'Space');
  assert.equal(d.inApp.next, 'Ctrl+ArrowRight');
  assert.equal(d.inApp.prev, 'Ctrl+ArrowLeft');
  assert.equal(d.inApp['seek-forward'], 'Shift+ArrowRight');
  assert.equal(d.inApp['volume-up'], 'Ctrl+ArrowUp');
  assert.equal(d.inApp['mute-toggle'], 'Ctrl+Shift+ArrowDown');
  assert.equal(d.global['play-toggle'], 'MediaPlayPause');
  assert.deepEqual(H.globalAccelerators(d), { 'play-toggle': 'MediaPlayPause', next: 'MediaNextTrack', prev: 'MediaPreviousTrack' });
  for (const scope of H.SCOPES) {
    const used = Object.values(d[scope]).filter(Boolean);
    assert.equal(new Set(used).size, used.length, `${scope} 預設不可重複`);
    for (const combo of used) assert.equal(H.validate(combo, scope), null, `${scope} 預設 ${combo} 必須合法`);
  }
});

test('key events become stable combo strings by physical key, ignoring bare modifiers', () => {
  assert.equal(H.fromEvent(key('Space')), 'Space');
  assert.equal(H.fromEvent(key('KeyP', { meta: true, shift: true, alt: true, ctrl: true })), 'Ctrl+Alt+Shift+Meta+KeyP');
  assert.equal(H.fromEvent(key('ShiftLeft', { shift: true })), null, '只按修飾鍵還不算');
  assert.equal(H.fromEvent({ code: '', key: 'MediaPlayPause' }), 'MediaPlayPause', '媒體鍵 code 為空時看 key');
  assert.equal(H.parse('Shift+Ctrl+KeyA'), null, '修飾鍵順序錯就不合法');
  assert.equal(H.label('Ctrl+Shift+ArrowDown'), 'Ctrl + Shift + ↓');
  assert.equal(H.label('Meta+BracketRight'), 'Win + ]');
  assert.equal(H.label(''), '');
});

test('global shortcuts convert to Electron accelerators and must not steal normal typing', () => {
  assert.equal(H.toAccelerator('Ctrl+Alt+KeyP'), 'Ctrl+Alt+P');
  assert.equal(H.toAccelerator('Shift+Meta+Digit1'), 'Shift+Super+1');
  assert.equal(H.toAccelerator('MediaTrackNext'), 'MediaNextTrack');
  assert.equal(H.validate('Ctrl+Alt+KeyP', 'global'), null);
  assert.equal(H.validate('MediaPlayPause', 'global'), null);
  assert.equal(H.validate('F13', 'global'), null);
  assert.equal(H.validate('Space', 'global'), 'needsModifier');
  assert.equal(H.validate('Shift+KeyA', 'global'), 'needsModifier', 'Shift 不算，打大寫字母就會觸發');
  assert.equal(H.validate('F5', 'global'), 'needsModifier', 'F1–F12 常被遊戲使用');
  assert.equal(H.validate('Ctrl+IntlRo', 'global'), 'unsupported');
  assert.equal(H.validate('Escape', 'inApp'), 'reserved');
  assert.equal(H.validate('Ctrl+Escape', 'inApp'), null);
});

test('stored settings are repaired: unknown actions dropped, bad or duplicate keys unset, missing actions get defaults', () => {
  const fixed = H.normalize({
    inApp: { next: 'KeyN', prev: 'KeyN', 'play-toggle': 'Shift+Ctrl+X', bogus: 'KeyB' },
    global: { next: 'Space', prev: 'Ctrl+Alt+KeyP' },
  });
  assert.equal(fixed.inApp.next, 'KeyN');
  assert.equal(fixed.inApp.prev, '', '重複的組合只留第一個');
  assert.equal(fixed.inApp['play-toggle'], '', '格式壞掉改成未設定');
  assert.equal(fixed.inApp['seek-forward'], 'Shift+ArrowRight', '沒存的動作用預設');
  assert.equal('bogus' in fixed.inApp, false);
  assert.equal(fixed.global.next, '', '全域不能用單獨的空白鍵');
  assert.equal(fixed.global.prev, 'Ctrl+Alt+KeyP');
  assert.equal(H.conflict(fixed, 'inApp', 'KeyN', 'prev'), 'next');
  assert.equal(H.conflict(fixed, 'inApp', 'KeyN', 'next'), null);
});

test('single-key shortcuts never fire while typing in a field', () => {
  assert.equal(H.isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(H.isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(H.isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(H.isTypingTarget({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(H.isTypingTarget({ tagName: 'BUTTON' }), false);
});

test('the desktop side only registers known actions with safe accelerators, reports keys taken by other apps, and persists', () => {
  assert.deepEqual([...desktop.ACTION_IDS], [...H.ACTION_IDS], '主程序的動作清單必須跟面板一致');
  for (const accelerator of Object.values(H.globalAccelerators(H.defaults()))) assert.equal(desktop.isSafeAccelerator(accelerator), true);
  assert.equal(desktop.isSafeAccelerator('Ctrl+Alt+P'), true);
  assert.equal(desktop.isSafeAccelerator('A'), false, '單獨字母會搶走打字');
  assert.equal(desktop.isSafeAccelerator('Shift+A'), false);
  assert.equal(desktop.isSafeAccelerator('Ctrl+Ctrl+A'), false);
  assert.equal(desktop.isSafeAccelerator('CommandOrControl+Q; rm -rf'), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-hotkeys-'));
  try {
    const registered = new Map();
    const fired = [];
    const globalShortcut = {
      register(accelerator, fn) { if (accelerator === 'MediaNextTrack') return false; registered.set(accelerator, fn); return true; },
      unregisterAll() { registered.clear(); },
    };
    const hotkeys = desktop.createGlobalHotkeys({ globalShortcut, userDataPath: dir, onTrigger: (id) => fired.push(id) });
    hotkeys.start();
    const config = H.defaults();
    const state = hotkeys.set({ config, accelerators: { ...H.globalAccelerators(config), 'lyrics-hide': 'H', bogus: 'Ctrl+Alt+B' } });
    assert.deepEqual(state.results, { 'play-toggle': 'ok', next: 'taken', prev: 'ok' }, '不安全的、未知的動作不註冊；被佔用的回報 taken');
    registered.get('MediaPlayPause')();
    assert.deepEqual(fired, ['play-toggle']);

    const reloaded = desktop.createGlobalHotkeys({ globalShortcut, userDataPath: dir, onTrigger: () => {} });
    reloaded.start();
    assert.equal(reloaded.get().config.inApp.next, 'Ctrl+ArrowRight', '重開後讀回設定');
    assert.ok(registered.has('MediaPlayPause'), '啟動時就註冊，不用等面板');
    reloaded.stop();
    assert.equal(registered.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every action has a five-language name, and the panel can run every action', () => {
  const i18n = require('../public/js/i18n');
  for (const id of H.ACTION_IDS) {
    for (const locale of i18n.LOCALES) assert.ok(String(i18n.catalogs[locale][`hotkeys.action.${id}`] || '').trim(), `${locale} 缺少 hotkeys.action.${id}`);
  }
  for (const code of ['invalid', 'reserved', 'needsModifier', 'unsupported', 'conflict']) {
    for (const locale of i18n.LOCALES) assert.ok(i18n.catalogs[locale][`hotkeys.error.${code}`], `${locale} 缺少 hotkeys.error.${code}`);
  }
  const panel = read('public/js/app-hotkeys.js');
  const runBlock = panel.slice(panel.indexOf('const RUN = {'), panel.indexOf('};', panel.indexOf('const RUN = {')));
  for (const id of H.ACTION_IDS) assert.ok(runBlock.includes(`'${id}':`) || runBlock.includes(`${id}:`), `面板沒有實作 ${id}`);
});

test('the panel loads the card and scripts in order, and the desktop bridge is fixed and sender-checked', () => {
  const html = read('public/index.html');
  for (const id of ['hotkeys-card', 'hotkeys-table', 'hotkeys-reset', 'hotkeys-global-note', 'hotkeys-error']) assert.ok(html.includes(`id="${id}"`), `缺少 #${id}`);
  const order = ['/js/app-playback.js', '/js/app.js', '/js/hotkeys.js', '/js/app-hotkeys.js'].map((src) => html.indexOf(`<script src="${src}">`));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), `腳本順序不對：${order}`);

  const preload = read('electron/preload.js');
  assert.ok(preload.includes("ipcRenderer.invoke('elitesand:hotkeys-get')") && preload.includes("ipcRenderer.invoke('elitesand:hotkeys-set', payload)"));
  assert.ok(preload.includes("ipcRenderer.on('elitesand:hotkey', listener)"));
  const shell = read('electron/shell.js');
  for (const channel of ['elitesand:hotkeys-get', 'elitesand:hotkeys-set']) {
    const handler = shell.slice(shell.indexOf(`ipcMain.handle('${channel}'`));
    assert.ok(handler.slice(0, 200).includes('event?.sender !== window.webContents'), `${channel} 必須檢查 IPC 來源`);
  }
  assert.ok(shell.includes('globalHotkeys?.stop();'), '結束時要釋放全域快捷鍵');
  assert.ok(read('electron/main.js').includes('globalShortcut,'), 'main.js 要把 globalShortcut 交給 shell');
});

test('live-singing extras: align first line, pitch, restart, vocals and the shortcut list', () => {
  const d = H.defaults();
  assert.equal(d.inApp['align-first'], 'Period', '對齊第一句要能在聽到第一個字的瞬間按');
  assert.equal(d.inApp['pitch-up'], 'Alt+ArrowUp');
  assert.equal(d.inApp['pitch-down'], 'Alt+ArrowDown');
  assert.equal(d.inApp['pitch-reset'], 'Alt+Digit0');
  assert.equal(d.inApp['show-help'], 'Shift+Slash');
  assert.equal(d.inApp['vocals-toggle'], '', '只對分離人聲的歌有用，預設不綁');
  assert.equal(d.inApp['restart-track'], '');
  assert.equal(H.isInAppOnly('show-help'), true);
  assert.equal(H.normalize({ global: { 'show-help': 'Ctrl+Alt+KeyK' } }).global['show-help'], '', '快捷鍵一覽不能設成全域');
  assert.equal('show-help' in H.globalAccelerators({ global: { 'show-help': 'Ctrl+Alt+KeyK' } }), false);
  assert.deepEqual(desktop.sanitizeAccelerators({ 'show-help': 'Ctrl+Alt+K', 'align-first': 'Ctrl+Alt+A' }), { 'align-first': 'Ctrl+Alt+A' });
  const html = read('public/index.html');
  for (const id of ['offset-align', 'pitch-up', 'pitch-down', 'pitch-reset', 'separation-vocals-volume', 'separation-vocals-row']) {
    assert.ok(html.includes(`id="${id}"`), `快捷鍵要按的 #${id} 不見了`);
  }
});
