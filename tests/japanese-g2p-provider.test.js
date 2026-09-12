'use strict';

/**
 * Japanese G2P provider 的失敗路徑（docs/JAPANESE-XIEYIN-V2-PLAN.md Phase 2/5：
 * 「G2P helper 異常時自動 fallback」的前提是 provider 要能明確回報壞掉，
 * 而不是讓呼叫端無限期卡住）。
 *
 * 不含真的呼叫 haqumei 的整合測試：haqumei 尚未被打包進本專案任何一個
 * runtime（見 japanese-g2p-provider.js 開頭註解，這是還沒做的 Phase 2
 * 打包決策），npm test 維持離線、不假設開發機裝了額外的 Python 套件。
 * 2026-09-13 已用一支獨立 venv 手動驗證過 ai/haqumei_sidecar.py 的 NDJSON
 * 協定本身可以正常運作（見該次 session 紀錄），這裡只鎖「sidecar 不存在時
 * provider 的行為」這個正式環境一定會先踩到的路徑。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { JapaneseG2PProvider } = require('../server/services/japanese-g2p-provider');

test('haqumei 套件未安裝時（目前所有環境都是如此——尚未打包/佈署），start() 明確拋出 ENGINE_UNAVAILABLE，不是無聲卡住', async () => {
  // 這是本專案現在唯一會踩到的失敗模式：ai/haqumei_sidecar.py 本身一定存在
  // （checked into repo），但系統 python 沒有裝 haqumei（Phase 2 打包決策
  // 還沒做）。sidecar 會 import 失敗、送出 {ready:false,...} 後 exit(1)——
  // provider 必須把這個狀態轉成明確的 rejected promise，呼叫端才有辦法照
  // 計畫書 Phase 5 的規矩 fallback 回舊版，而不是永遠等一個不會來的回應。
  const provider = new JapaneseG2PProvider('python');
  await assert.rejects(() => provider.start(), (err) => {
    assert.equal(err.code, 'ENGINE_UNAVAILABLE');
    return true;
  });
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
