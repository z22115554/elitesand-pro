/**
 * Elitesand Pro 自動化測試套件
 * 執行：npm test
 *
 * 不需要安裝 kuromoji 等重型依賴也能跑核心測試
 * （romanizer 已支援安全降級），方便快速驗證改動是否破壞功能。
 */

const fs = require('fs');
const { readApiRoutesSource } = require('./api-routes-source');
const path = require('path');
const os = require('os');
const vm = require('vm');

// 回歸測試絕不可碰正式 data/downloads/logs；必須在載入任一 server 模組前
// 設定完整的隔離路徑，讓有 module-load side effect 的 store 也只寫測試暫存區。
const TEST_RUNTIME_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-test-runtime-'));
const TEST_RUNTIME_DIRS = {
  data: path.join(TEST_RUNTIME_ROOT, 'data'),
  downloads: path.join(TEST_RUNTIME_ROOT, 'downloads'),
  logs: path.join(TEST_RUNTIME_ROOT, 'logs'),
};
process.env.ELITESAND_DATA_DIR = TEST_RUNTIME_DIRS.data;
process.env.ELITESAND_DOWNLOADS_DIR = TEST_RUNTIME_DIRS.downloads;
process.env.ELITESAND_LOGS_DIR = TEST_RUNTIME_DIRS.logs;

let passed = 0;
let failed = 0;
const failures = [];
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

// 非同步測試：收集 Promise，於檔案末端統一等待後再印出結果摘要
const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push((async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      failures.push({ name, err });
      console.log(`  ✗ ${name}`);
      console.log(`    → ${err.message}`);
    }
  })());
}

function eq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label}預期 "${expected}"，實際 "${actual}"`);
  }
}

function ok(value, label = '') {
  if (!value) throw new Error(`${label}預期為真，實際 ${JSON.stringify(value)}`);
}

require('./spout-output-controller.test').register({ test, testAsync, eq, ok });
require('./spout-display-output.test').register({ test, testAsync, eq, ok });
require('./spout-settings.test').register({ test, testAsync, eq, ok });
require('./spout-issue-diagnostics.test').register({ test, testAsync, eq, ok });
require('./lyric-template-settings.test').register({ test, testAsync, eq, ok });
require('./production-bundles.test').register({ test, testAsync, eq, ok });
require('./spout-packaging.test').register({ test, testAsync, eq, ok });
require('./auto-sync.test').register({ test, testAsync, eq, ok });
require('./session-end-marker.test').register({ test, testAsync, eq, ok });
require('./new-badges.test').register({ test, testAsync, eq, ok });

function finishTests(exitCode) {
  try { fs.rmSync(TEST_RUNTIME_ROOT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  process.exit(exitCode);
}

async function finishAll() {
  await Promise.all(asyncTests);

  console.log('\n════════════════════════════');
  console.log(`測試結果: ${passed} 通過, ${failed} 失敗`);
  if (failed > 0) {
    console.log('\n失敗詳情:');
    for (const f of failures) {
      console.log(`  ✗ ${f.name}: ${f.err.message}`);
    }
    finishTests(1);
  }
  console.log('✅ 全部通過');
  finishTests(0);
}

// 跨檔共用、但不是單純 require 的東西（例如只能建立一次的假伺服器），由宣告它的檔案登記在這裡
const shared = {};

module.exports = {
  fs,
  readApiRoutesSource,
  path,
  os,
  vm,
  TEST_RUNTIME_ROOT,
  TEST_RUNTIME_DIRS,
  passed,
  failed,
  failures,
  cloneJson,
  test,
  asyncTests,
  testAsync,
  eq,
  ok,
  shared,
  finishAll,
};
