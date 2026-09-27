'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  bundlePage,
  assertLocalScriptReferencesExist,
  PAGE_BUNDLES,
} = require('../tools/build-production-bundles');

function register({ test, eq, ok }) {
  test('production bundler：vendor 邊界前後的本機腳本不可被搬到同一個 bundle', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-bundle-order-'));
    const publicDir = path.join(root, 'public');
    const jsDir = path.join(publicDir, 'js');
    fs.mkdirSync(jsDir, { recursive: true });

    try {
      fs.writeFileSync(path.join(jsDir, 'before.js'), 'globalThis.beforeLoaded = true;\n');
      fs.writeFileSync(path.join(jsDir, 'after-a.js'), 'globalThis.afterA = true;\n');
      fs.writeFileSync(path.join(jsDir, 'after-b.js'), 'globalThis.afterB = true;\n');

      const htmlFile = path.join(publicDir, 'display.html');
      fs.writeFileSync(htmlFile, [
        '<script src="/js/before.js"></script>',
        '<script src="/vendor/jizura/jizura-engine.js"></script>',
        '<script src="/js/after-a.js"></script>',
        '<script src="/js/after-b.js"></script>',
      ].join('\n'));

      const consumed = new Set();
      const result = bundlePage(htmlFile, jsDir, {
        bundleName: 'display',
        consumed,
      });

      eq(result.mergedCount, 3);
      const firstBundle = result.html.indexOf('/js/display.bundle.js');
      const vendor = result.html.indexOf('/vendor/jizura/jizura-engine.js');
      const secondBundle = result.html.indexOf('/js/display-2.bundle.js');
      ok(firstBundle >= 0 && vendor > firstBundle && secondBundle > vendor,
        'JIZURA vendor engine 必須維持在前後兩段 bundle 之間：');
      ok(fs.existsSync(path.join(jsDir, 'display.bundle.js'))
        && fs.existsSync(path.join(jsDir, 'display-2.bundle.js')),
      '跨 vendor 邊界必須產生兩段 bundle：');
      ok(consumed.has('before.js') && consumed.has('after-a.js') && consumed.has('after-b.js'),
        '所有被合併的本機腳本仍要列入 consumed：');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('production bundler：中秋 /moon 頁必須納入 release bundle', () => {
    ok(PAGE_BUNDLES.some((page) => page.html === 'moon.html' && page.bundleName === 'moon'),
      'moon.html 不可漏出 production bundler 頁面清單：');
  });

  test('production bundler：WebGPU 隱藏頁要保留 socket client 並通過成品引用檢查', () => {
    ok(PAGE_BUNDLES.some((page) => page.html === 'webgpu-separation-worker.html'),
      'WebGPU 隱藏頁必須納入 production bundler：');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-bundle-webgpu-'));
    const publicDir = path.join(root, 'public');
    const jsDir = path.join(publicDir, 'js');
    fs.mkdirSync(jsDir, { recursive: true });
    try {
      const htmlFile = path.join(publicDir, 'webgpu-separation-worker.html');
      fs.copyFileSync(path.join(__dirname, '..', 'public', 'webgpu-separation-worker.html'), htmlFile);
      fs.writeFileSync(path.join(jsDir, 'socket-client.js'), 'globalThis.SocketClient = {};\n');
      const result = bundlePage(htmlFile, jsDir, {
        bundleName: 'webgpu-separation-worker',
        consumed: new Set(),
      });
      fs.writeFileSync(htmlFile, result.html);
      fs.unlinkSync(path.join(jsDir, 'socket-client.js'));
      eq(result.mergedCount, 1);
      ok(result.html.indexOf('/js/webgpu-separation-worker.bundle.js')
        < result.html.indexOf('/js/webgpu-separation-worker.mjs'),
      'socket client bundle 必須在 WebGPU module 前載入：');
      assertLocalScriptReferencesExist(publicDir, jsDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('production bundler：成品 HTML 指到已刪除的本機 JS 時直接擋下 release', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-bundle-guard-'));
    const publicDir = path.join(root, 'public');
    const jsDir = path.join(publicDir, 'js');
    fs.mkdirSync(jsDir, { recursive: true });

    try {
      fs.writeFileSync(path.join(publicDir, 'moon.html'), '<script src="/js/missing-shared.js"></script>\n');
      let error = null;
      try {
        assertLocalScriptReferencesExist(publicDir, jsDir);
      } catch (err) {
        error = err;
      }
      ok(error && /moon\.html: \/js\/missing-shared\.js/.test(error.message),
        '缺檔引用必須讓 production build 失敗並指出頁面與腳本：');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

module.exports = { register };