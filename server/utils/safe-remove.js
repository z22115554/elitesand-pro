'use strict';

/**
 * 中文路徑安全的刪除工具（本專案唯一該用的刪除方式）。
 *
 * 在含中文字元的路徑上，Node 的 `fs.rm*` 同步 API 只要真的執行到刪除動作，就會讓
 * 整個 Node process 無聲當掉：exit code 127、沒有 stderr、沒有 stack trace，
 * 連 `process.on('uncaughtException')` 都不會觸發，外層 try/catch 完全攔不到。
 *
 * 2026-09-22 在 Node v24.12.0／Windows 實測出來的安全邊界：
 *
 *   💀 會當掉                                    ✅ 安全
 *   ───────────────────────────────────────────  ──────────────────────────────────
 *   fs.rmSync(存在的檔案)          ← 連裸呼叫都死  fs.unlinkSync(檔案)
 *   fs.rmSync(dir, {recursive:true})             fs.rmdirSync(dir)   ← 非遞迴
 *   fs.rmdirSync(dir, {recursive:true})          fs.promises.rm(...) ← 非同步版
 *     ↑ 連「空目錄」都會死                        目標不存在時的任何呼叫
 *
 * 最後一項是過去兩次誤判的根源：目標不存在時 `fs.rmSync` 會在碰到真正的刪除邏輯
 * 之前就先丟出可捕捉的 ENOENT，看起來「安全」，於是留下「不帶 force 就沒事」的
 * 錯誤結論。實際上只要那個檔案真的存在、真的被刪，同一行就會殺掉整個伺服器。
 *
 * 因此這裡一律自己走訪目錄樹，只用 `unlinkSync` 和非遞迴的 `rmdirSync` 這兩個
 * 實測安全的原語，不碰 `fs.rm*` 家族。
 */

const fs = require('fs');
const path = require('path');

function removeRecursive(targetPath, fsImpl) {
  let stat;
  try {
    // lstat 而非 stat：symlink 要刪連結本身，不可以跟進去刪到目標。
    stat = fsImpl.lstatSync(targetPath);
  } catch (_) {
    return; // 本來就不存在
  }

  if (stat.isDirectory()) {
    let names = [];
    try { names = fsImpl.readdirSync(targetPath); } catch (_) { /* 讀不到就直接試著刪空目錄 */ }
    for (const name of names) removeRecursive(path.join(targetPath, name), fsImpl);
    try { fsImpl.rmdirSync(targetPath); } catch (_) { /* best effort */ }
  } else {
    try { fsImpl.unlinkSync(targetPath); } catch (_) { /* best effort */ }
  }
}

/**
 * 遞迴刪除檔案或目錄，best effort（不存在、刪不掉都不丟例外）。
 * @returns {boolean} 刪完之後目標是否真的不存在了
 */
function safeRemove(targetPath, { fsImpl = fs } = {}) {
  if (!targetPath) return true;
  removeRecursive(targetPath, fsImpl);
  try { return !fsImpl.existsSync(targetPath); } catch (_) { return false; }
}

module.exports = { safeRemove };
