'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-update-check.js'), 'utf8');
const LOCALES = ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'];
const MOJIBAKE = /\uFFFD|Ã|Â|â€|ðŸ|ï¿½|æ–|å­|ì—|ë‹|ê°|ìž|ë¶/u;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function el(id) {
  return { id, hidden: false, disabled: false, textContent: '', href: '', parentElement: null, listeners: {}, addEventListener(k, fn) { this.listeners[k] = fn; } };
}
const wait = () => new Promise((r) => setTimeout(r, 25));
const interpolate = (s, version = '1.0.1') => String(s).replaceAll('{version}', version);
const tokens = (s) => [...String(s).matchAll(/\{([\w]+)\}/g)].map((m) => m[1]).sort();

function clean(s, label) {
  s = String(s);
  assert.strictEqual(Buffer.from(s, 'utf8').toString('utf8'), s, `${label}: UTF-8 round-trip failed`);
  assert.ok(!MOJIBAKE.test(s), `${label}: mojibake detected: ${s}`);
  assert.ok(!CONTROL.test(s), `${label}: control character detected`);
}

async function scenario(locale, plan, apply = null, confirmResult = true) {
  let activeLocale = locale;
  const created = [];
  const listeners = {};
  const calls = [];
  const confirmations = [];
  const row = { insertBefore(node) { created.push(node); } };
  const elements = {
    'app-version-current': el('current'),
    'app-update-status': el('status'),
    'app-update-check-btn': el('check'),
    'app-update-link': el('link'),
  };
  elements['app-update-link'].parentElement = row;
  const intro = el('intro');
  const queue = [plan, ...(apply == null ? [] : [apply])];
  const document = {
    documentElement: { lang: locale },
    getElementById(id) { return elements[id] || null; },
    querySelector() { return intro; },
    createElement() { return el('dynamic'); },
  };
  async function request(url, opts = {}) {
    calls.push({ url, opts });
    const body = queue.shift();
    if (body == null) throw new Error(`unexpected request ${url}`);
    return { ok: true, status: 200, async text() { return JSON.stringify(body); } };
  }
  const window = {
    I18n: { current: () => activeLocale },
    PanelConfirm: { async request(options) { confirmations.push(options); return confirmResult; } },
    addEventListener(name, fn) { listeners[name] = fn; },
  };
  const ctx = { document, window, fetch: request, PinAuth: { fetchWithPin: request }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  await wait();
  return {
    ctx, created, elements, intro, calls, confirmations,
    setLocale(next) { activeLocale = next; document.documentElement.lang = next; listeners['i18n:change']?.({ detail: { locale: next } }); },
  };
}

(async () => {
  const base = await scenario('zh-TW', { enabled: true, currentVersion: '1.0.0', hasUpdate: false });
  const api = base.ctx.window.AppUpdateI18n;
  assert.deepStrictEqual(Array.from(api.locales), LOCALES);

  const refKeys = Object.keys(api.catalogs['zh-TW']).sort();
  assert.ok(refKeys.length >= 19);
  for (const locale of LOCALES) {
    const catalog = api.catalogs[locale];
    assert.deepStrictEqual(Object.keys(catalog).sort(), refKeys, `${locale}: missing/extra translation key`);
    for (const key of refKeys) {
      assert.ok(catalog[key].trim(), `${locale}.${key}: empty`);
      clean(catalog[key], `${locale}.${key}`);
      assert.deepStrictEqual(tokens(catalog[key]), tokens(api.catalogs['zh-TW'][key]), `${locale}.${key}: placeholder mismatch`);
    }
  }
  console.log('app-update i18n round 1/3 passed: complete five-locale catalogs; UTF-8/mojibake clean');

  const locks = {
    'zh-TW': ['安裝更新', '增量更新', '更新期間請勿手動重新開啟 Elitesand Pro。', '完整 Windows Installer'],
    en: ['Install update', 'incremental updates', 'Do not reopen Elitesand Pro manually while the update is in progress.', 'full Windows Installer'],
    ja: ['更新をインストール', '差分更新', '更新中は Elitesand Pro を手動で起動しないでください。', '完全版の Windows インストーラー'],
    ko: ['업데이트 설치', '증분 업데이트', '업데이트 중에는 Elitesand Pro를 직접 다시 실행하지 마세요.', '전체 Windows 설치 프로그램'],
    'zh-CN': ['安装更新', '增量更新', '更新期间请勿手动重新打开 Elitesand Pro。', '完整 Windows 安装程序'],
  };
  for (const locale of LOCALES) {
    const c = api.catalogs[locale];
    const [action, term, impact, installer] = locks[locale];
    assert.strictEqual(c.applyUpdate, action, `${locale}: action wording`);
    assert.ok(c.intro.includes(term), `${locale}: incremental-update terminology`);
    assert.strictEqual(c.confirmImpact, impact, `${locale}: warning semantics`);
    assert.ok(c.availableInstaller.includes(installer), `${locale}: Installer terminology`);
    const duration = locale === 'ko' ? '10~20' : locale === 'en' ? '10–20' : '10～20';
    assert.ok(c.confirmSummary.includes(duration), `${locale}: duration wording`);
  }
  assert.ok(!/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(Object.values(api.catalogs.en).join('\n')), 'English contains CJK/Hangul');
  assert.ok(!/[\uac00-\ud7af]/u.test(Object.values(api.catalogs.ja).join('\n')), 'Japanese contains Hangul');
  assert.ok(!/[\u3040-\u30ff\u3400-\u9fff]/u.test(Object.values(api.catalogs.ko).join('\n')), 'Korean contains Japanese/Chinese script');
  assert.ok(!/[会时启闭请无与档这为误开载]/u.test(Object.values(api.catalogs['zh-TW']).join('\n')), 'zh-TW contains Simplified forms');
  assert.ok(!/[會時啟閉請無與檔這為誤開載]/u.test(Object.values(api.catalogs['zh-CN']).join('\n')), 'zh-CN contains Traditional forms');
  console.log('app-update i18n round 2/3 passed: terminology and human-reviewed semantics locked');

  const plan = { enabled: true, currentVersion: '1.0.0', hasUpdate: true, latestVersion: '1.0.1', canIncremental: true, downloadUrl: 'https://example.invalid/installer' };
  for (const locale of LOCALES) {
    const s = await scenario(locale, plan, { prepared: true });
    const c = s.ctx.window.AppUpdateI18n.catalogs[locale];
    const button = s.created[0];
    assert.strictEqual(button.hidden, false, `${locale}: incremental button hidden`);
    assert.strictEqual(s.intro.textContent, c.intro, `${locale}: intro render`);
    assert.strictEqual(button.textContent, c.applyUpdate, `${locale}: action render`);
    assert.strictEqual(s.elements['app-update-status'].textContent, interpolate(c.availableIncremental), `${locale}: status render`);
    await button.listeners.click();
    assert.strictEqual(s.confirmations[0].title, interpolate(c.confirmTitle), `${locale}: confirm title`);
    assert.strictEqual(s.confirmations[0].summary, c.confirmSummary, `${locale}: confirm summary`);
    assert.strictEqual(s.confirmations[0].impact, c.confirmImpact, `${locale}: confirm warning`);
    assert.strictEqual(s.confirmations[0].confirmLabel, c.applyUpdate, `${locale}: confirm action`);
    assert.strictEqual(s.calls[1].url, '/api/app-update/apply');
    assert.strictEqual(s.elements['app-update-status'].textContent, c.prepared, `${locale}: prepared render`);
    [s.intro.textContent, button.textContent, s.elements['app-update-status'].textContent, ...Object.values(s.confirmations[0])].filter((v) => typeof v === 'string').forEach((v, i) => clean(v, `${locale}.runtime.${i}`));

    const f = await scenario(locale, { enabled: true, currentVersion: '0.9.9.6', hasUpdate: true, latestVersion: '1.0.0', canIncremental: false, downloadUrl: 'https://example.invalid/installer', reason: '此版本需要完整 Installer。' });
    const fc = f.ctx.window.AppUpdateI18n.catalogs[locale];
    assert.strictEqual(f.created[0].hidden, true, `${locale}: fallback shows incremental button`);
    assert.strictEqual(f.elements['app-update-status'].textContent, interpolate(fc.availableInstaller, '1.0.0'), `${locale}: localized fallback render`);
    if (locale !== 'zh-TW') assert.ok(!f.elements['app-update-status'].textContent.includes('此版本需要完整'), `${locale}: Traditional-Chinese backend reason leaked`);
    clean(f.elements['app-update-status'].textContent, `${locale}.fallback`);
  }

  const sw = await scenario('zh-TW', plan);
  for (const locale of LOCALES) {
    sw.setLocale(locale);
    const c = sw.ctx.window.AppUpdateI18n.catalogs[locale];
    assert.strictEqual(sw.intro.textContent, c.intro, `${locale}: live-switch intro`);
    assert.strictEqual(sw.created[0].textContent, c.applyUpdate, `${locale}: live-switch action`);
    assert.strictEqual(sw.elements['app-update-status'].textContent, interpolate(c.availableIncremental), `${locale}: live-switch status`);
    clean(sw.elements['app-update-status'].textContent, `${locale}.switch`);
  }
  console.log('app-update i18n round 3/3 passed: runtime render/switch/apply/fallback clean in all five locales');
  console.log('app-update-i18n: all tests passed');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
