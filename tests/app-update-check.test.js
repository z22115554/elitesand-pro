'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-restart-update-check.js'), 'utf8');

function element(id) {
  return {
    id,
    hidden: id === 'app-update-restart-btn' || id === 'app-update-download-btn',
    disabled: false,
    textContent: '',
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
  };
}

function response(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    async json() { return body; },
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function createScenario(updateResult) {
  const elements = Object.fromEntries([
    'app-update-check-btn',
    'app-update-restart-btn',
    'app-update-download-btn',
    'app-version-current',
    'app-update-status',
  ].map((id) => [id, element(id)]));
  const calls = [];
  let openReleasePageCalls = [];
  const listeners = {};

  const context = {
    document: { getElementById(id) { return elements[id] || null; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/health') return response({ status: 'ok', version: '1.0.0' });
      if (url === '/api/update-check?force=1') return response(updateResult);
      throw new Error(`unexpected URL: ${url}`);
    },
    window: {
      ElitesandShell: {
        async restartForUpdateCheck() { throw new Error('restartForUpdateCheck 不該再被這個未簽章的 GitHub fallback 流程呼叫'); },
        async openGithubReleasePage(url) { openReleasePageCalls.push(url); return true; },
      },
      I18n: {
        t(key, vars) {
          const values = {
            'appUpdate.check': '檢查更新',
            'appUpdate.currentUnknown': '目前版本未知',
            'appUpdate.checking': '正在檢查更新…',
            'appUpdate.notChecked': '尚未檢查。',
            'appUpdate.latest': '已是最新版本。',
            'appUpdate.available': '發現新版本 {version}。',
            'appUpdate.restart': '重新啟動並更新',
            'appUpdate.openReleasePage': '前往下載頁',
            'appUpdate.restarting': '正在重新啟動並準備更新…',
            'appUpdate.checkFailed': '暫時無法檢查更新，請稍後再試。',
            'appUpdate.notConfigured': '更新來源尚未設定。',
          };
          return String(values[key] || key).replace('{version}', vars?.version || '');
        },
      },
      addEventListener(name, handler) { listeners[name] = handler; },
    },
    console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await flush();
  return { elements, calls, listeners, get openReleasePageCalls() { return openReleasePageCalls; } };
}

(async () => {
  const scenario = await createScenario({
    enabled: true,
    currentVersion: '1.0.0',
    hasUpdate: true,
    latestVersion: '1.0.1',
    releaseUrl: 'https://github.com/z22115554/elitesand-pro/releases/tag/v1.0.1',
    error: null,
  });

  assert.deepStrictEqual(scenario.calls.map((call) => call.url), ['/api/health'], '啟動時只能讀取目前版本，不可自動檢查更新');
  assert.strictEqual(scenario.elements['app-version-current'].textContent, 'v1.0.0');
  assert.strictEqual(scenario.elements['app-update-status'].textContent, '尚未檢查。');
  assert.strictEqual(scenario.elements['app-update-restart-btn'].hidden, true, '尚未檢查時不可顯示重新啟動');
  assert.strictEqual(scenario.elements['app-update-download-btn'].hidden, true, '尚未檢查時不可顯示前往下載頁');

  await scenario.elements['app-update-check-btn'].listeners.click();
  await flush();
  assert.strictEqual(scenario.calls[1].url, '/api/update-check?force=1');
  // GitHub fallback 查到的版本沒有 Cloudflare 簽章驗證，「重新啟動並更新」不能顯示——
  // 顯示了會誤導使用者以為按下去真的會更新，實際上只是單純重啟成同一個版本。
  assert.strictEqual(scenario.elements['app-update-restart-btn'].hidden, true, 'GitHub fallback 永遠不可顯示重新啟動（沒有簽章 plan 可套用）');
  assert.strictEqual(scenario.elements['app-update-download-btn'].hidden, false, '查到新版本後要顯示前往下載頁');
  assert.match(scenario.elements['app-update-status'].textContent, /v1\.0\.1/);

  await scenario.elements['app-update-download-btn'].listeners.click();
  await flush();
  assert.deepStrictEqual(scenario.openReleasePageCalls, ['https://github.com/z22115554/elitesand-pro/releases/tag/v1.0.1'], '按前往下載頁必須真的開啟該版本的 GitHub release 頁面');

  const latest = await createScenario({
    enabled: true,
    currentVersion: '1.0.0',
    hasUpdate: false,
    latestVersion: '1.0.0',
    error: null,
  });
  await latest.elements['app-update-check-btn'].listeners.click();
  await flush();
  assert.strictEqual(latest.elements['app-update-restart-btn'].hidden, true, '已是最新版時不可顯示重新啟動');
  assert.strictEqual(latest.elements['app-update-download-btn'].hidden, true, '已是最新版時不可顯示前往下載頁');
  assert.strictEqual(latest.elements['app-update-status'].textContent, '已是最新版本。');

  console.log('app-update-check: all tests passed');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
