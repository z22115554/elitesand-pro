'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { CATALOGS, format, getCatalog, resolveLocale } = require('../electron/startup-update-i18n');

const root = path.join(__dirname, '..');
const fields = ['title', 'optionalMessage', 'optionalDetail', 'updateNow', 'defer', 'requiredMessage', 'requiredDetail', 'openInstaller', 'exit', 'restartMessage', 'restartDetail', 'restart', 'cancel'];

test('native cold-start update dialogs have complete five-language catalogs', () => {
  assert.deepStrictEqual(Object.keys(CATALOGS).sort(), ['en', 'ja', 'ko', 'zh-CN', 'zh-TW']);
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    for (const field of fields) assert.ok(typeof catalog[field] === 'string' && catalog[field].trim(), `${locale}.${field}`);
    assert.ok(!/\uFFFD|Ã|Â|â€|ï¿½/u.test(Object.values(catalog).join('\n')), `${locale} UTF-8 corruption`);
  }
  assert.strictEqual(format(getCatalog('zh-TW').optionalMessage, { version: '1.0.1' }), '有可用更新：v1.0.1');
  assert.strictEqual(resolveLocale('zh_HK'), 'zh-TW');
  assert.strictEqual(resolveLocale('de-DE'), 'en');
});

test('renderer and HTTP no longer expose a running-session update trigger', () => {
  const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const toast = fs.readFileSync(path.join(root, 'public', 'js', 'app-toast-utils.js'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'public', 'js', 'app-restart-update-check.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'server', 'routes', 'api.js'), 'utf8');
  assert.ok(!fs.existsSync(path.join(root, 'public', 'js', 'app-update-check.js')));
  assert.ok(!index.includes('app-update-check.js') && !index.includes('app-update-check-btn'));
  assert.ok(index.includes('restart-update-check-btn'));
  assert.ok(!toast.includes('/api/app-update/') && !panel.includes('fetch('));
  assert.ok(!api.includes("'/app-update/plan'") && !api.includes("'/app-update/status'") && !api.includes("'/app-update/apply'"));
  const shell = fs.readFileSync(path.join(root, 'electron', 'shell.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  assert.ok(shell.includes("ipcMain.handle('elitesand:restart-for-update-check'") && shell.includes('showNativeUpdateDialog'));
  assert.ok(preload.includes('restartForUpdateCheck'));
});
