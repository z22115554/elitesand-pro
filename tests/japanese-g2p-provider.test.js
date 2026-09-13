'use strict';

/**
 * Japanese G2P provider 的失敗路徑（docs/JAPANESE-XIEYIN-V2-PLAN.md Phase 2/5：
 * 「G2P helper 異常時自動 fallback」的前提是 provider 要能明確回報壞掉，
 * 而不是讓呼叫端無限期卡住）。
 *
 * npm test 維持離線，不假設開發機裝了額外的 Python 套件；installer build
 * 另由 prepare-haqumei-runtime.ps1 下載固定雜湊的 Python／Haqumei，並在建置
 * 階段做真實 import probe。這裡鎖 provider 的失敗與環境變數路徑行為。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { JapaneseG2PProvider } = require('../server/services/japanese-g2p-provider');

test('haqumei 套件未安裝時，start() 明確拋出 ENGINE_UNAVAILABLE，不是無聲卡住', async () => {
  // 開發模式仍可能只有 ai/haqumei_sidecar.py 而沒有系統 haqumei。sidecar
  // 會 import 失敗、送出 {ready:false,...} 後 exit(1)——
  // provider 必須把這個狀態轉成明確的 rejected promise，呼叫端才有辦法照
  // 計畫書 Phase 5 的規矩 fallback 回舊版，而不是永遠等一個不會來的回應。
  const provider = new JapaneseG2PProvider('python');
  await assert.rejects(() => provider.start(), (err) => {
    assert.equal(err.code, 'ENGINE_UNAVAILABLE');
    return true;
  });
});

test('installer 提供的 ELITESAND_G2P_PYTHON 會優先於系統 python', () => {
  const original = process.env.ELITESAND_G2P_PYTHON;
  process.env.ELITESAND_G2P_PYTHON = 'C:\\Program Files\\Elitesand Pro\\resources\\tools\\g2p\\python.exe';
  try {
    const provider = new JapaneseG2PProvider();
    assert.equal(provider.pythonExecutable, process.env.ELITESAND_G2P_PYTHON);
  } finally {
    if (original === undefined) delete process.env.ELITESAND_G2P_PYTHON;
    else process.env.ELITESAND_G2P_PYTHON = original;
  }
});

test('resolveScriptDir 對指向錯誤目錄的環境變數會安全退回專案內建路徑', () => {
  const { resolveScriptDir } = require('../server/services/japanese-g2p-provider');
  const originalEnv = process.env.ELITESAND_AI_SCRIPT_DIR;
  process.env.ELITESAND_AI_SCRIPT_DIR = require('node:os').tmpdir();
  try {
    const dir = resolveScriptDir();
    assert.ok(require('node:fs').existsSync(require('node:path').join(dir, 'haqumei_sidecar.py')));
  } finally {
    if (originalEnv === undefined) delete process.env.ELITESAND_AI_SCRIPT_DIR;
    else process.env.ELITESAND_AI_SCRIPT_DIR = originalEnv;
  }
});

test('g2pBatch 對空輸入直接回傳空陣列，不啟動 sidecar', async () => {
  const provider = new JapaneseG2PProvider('python-should-never-be-spawned');
  const result = await provider.g2pBatch([]);
  assert.deepEqual(result, []);
  assert.equal(provider.isRunning(), false);
});

test('isRunning() 在從未啟動時回傳 false', () => {
  const provider = new JapaneseG2PProvider();
  assert.equal(provider.isRunning(), false);
});
