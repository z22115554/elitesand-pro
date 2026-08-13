'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-update-check.js'), 'utf8');

function element(id) {
  return {
    id,
    hidden: false,
    disabled: false,
    textContent: '',
    href: '',
    parentElement: null,
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function runScenario(plan, applyResponse = null, confirmResult = true) {
  const created = [];
  const row = { insertBefore(child) { created.push(child); } };
  const elements = {
    'app-version-current': element('app-version-current'),
    'app-update-status': element('app-update-status'),
    'app-update-check-btn': element('app-update-check-btn'),
    'app-update-link': element('app-update-link'),
  };
  elements['app-update-link'].parentElement = row;
  const intro = element('intro');
  const calls = [];
  const confirmations = [];
  const responses = [plan, applyResponse].filter((item) => item !== null);

  const document = {
    getElementById(id) { return elements[id] || null; },
    querySelector() { return intro; },
    createElement() { return element('dynamic'); },
  };
  async function request(url, opts = {}) {
    calls.push({ url, opts });
    const body = responses.shift();
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(body); },
    };
  }
  const context = {
    document,
    fetch: request,
    PinAuth: { fetchWithPin: request },
    window: {
      PanelConfirm: {
        async request(options) {
          confirmations.push(options);
          return confirmResult;
        },
      },
    },
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await flush();
  return { created, elements, calls, confirmations, context };
}

(async () => {
  const incremental = await runScenario({
    enabled: true,
    currentVersion: '1.0.0',
    hasUpdate: true,
    latestVersion: '1.0.1',
    canIncremental: true,
    downloadUrl: 'https://example.invalid/installer',
  }, {
    prepared: true,
    latestVersion: '1.0.1',
  });

  const applyButton = incremental.created[0];
  assert.ok(applyButton, 'incremental action button should be created');
  assert.strictEqual(applyButton.hidden, false, 'compatible update should show incremental action');
  assert.match(incremental.elements['app-update-status'].textContent, /可直接安裝/);
  await applyButton.listeners.click();
  assert.strictEqual(incremental.confirmations.length, 1, 'update should use the in-app confirmation modal');
  assert.match(incremental.confirmations[0].summary, /10～20 秒/);
  assert.match(incremental.confirmations[0].impact, /請勿手動重新開啟/);
  assert.strictEqual(incremental.confirmations[0].confirmLabel, '安裝更新');
  assert.strictEqual(incremental.calls[1].url, '/api/app-update/apply');
  assert.strictEqual(incremental.calls[1].opts.method, 'POST');
  assert.match(incremental.elements['app-update-status'].textContent, /自動重新啟動/);

  const cancelled = await runScenario({
    enabled: true,
    currentVersion: '1.0.0',
    hasUpdate: true,
    latestVersion: '1.0.1',
    canIncremental: true,
    downloadUrl: 'https://example.invalid/installer',
  }, null, false);
  await cancelled.created[0].listeners.click();
  assert.strictEqual(cancelled.confirmations.length, 1, 'cancel path should still use the in-app modal');
  assert.strictEqual(cancelled.calls.length, 1, 'cancelling confirmation must not POST the update');

  const fallback = await runScenario({
    enabled: true,
    currentVersion: '0.9.9.6',
    hasUpdate: true,
    latestVersion: '1.0.0',
    canIncremental: false,
    downloadUrl: 'https://example.invalid/installer',
    reason: '此版本需要完整 Installer。',
  });

  assert.strictEqual(fallback.created[0].hidden, true, 'incompatible update must hide incremental action');
  assert.strictEqual(fallback.elements['app-update-link'].hidden, false, 'Installer fallback must stay visible');
  assert.match(fallback.elements['app-update-status'].textContent, /完整 Installer/);

  console.log('app-update-check: all tests passed');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
