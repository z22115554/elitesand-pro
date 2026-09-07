#!/usr/bin/env node
'use strict';

/**
 * 對外檔案同步檢查（發版前 gate，需要網路）
 *
 * 私人原始碼倉與公開發行倉各有一份對外檔案，兩邊會默默漂開：2026-09-08 發 1.0.0 時
 * 就踩到兩次——公開倉的 README 完全沒有 1.0.0 的內容（使用者被強制更新卻查不到新功能），
 * 公開倉的 EULA 還停在 1.3.0 而程式強制同意的是 1.8.0（同意的與公開展示的不是同一份）。
 *
 * 刻意不放進 npm test：測試套件目前完全離線，而 package:installer 內部也會跑它。
 * 這支要網路，屬於「上傳前最終 gate」（PACKAGING.md §6）。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const PUBLIC_REPO = 'z22115554/elitesand-pro';
// 公開倉對外展示、且以本機這份為準的檔案。README 連到的檔案都必須列在這裡
// （tests/run-tests.js 有一條離線測試會反向核對，漏列會被抓到）。
const FILES = ['README.md', 'EULA.txt', 'LICENSE', 'THIRD-PARTY-NOTICES.txt'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readRemote(file) {
  const raw = childProcess.execFileSync(
    'gh',
    ['api', `repos/${PUBLIC_REPO}/contents/${file}`, '--jq', '.content'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return Buffer.from(raw.replace(/\s/g, ''), 'base64');
}

function main() {
  const root = path.join(__dirname, '..');
  let drift = 0;
  for (const file of FILES) {
    const localPath = path.join(root, file);
    if (!fs.existsSync(localPath)) {
      console.log(`  ?  ${file.padEnd(26)} 本機不存在`);
      drift += 1;
      continue;
    }
    const local = fs.readFileSync(localPath);
    let remote;
    try {
      remote = readRemote(file);
    } catch (error) {
      console.log(`  ?  ${file.padEnd(26)} 讀不到公開倉版本：${error.message.split('\n')[0]}`);
      drift += 1;
      continue;
    }
    if (sha256(local) === sha256(remote)) {
      console.log(`  OK ${file.padEnd(26)} 一致 (${local.length} bytes)`);
    } else {
      console.log(`  X  ${file.padEnd(26)} 不一致：本機 ${local.length} bytes / 公開倉 ${remote.length} bytes`);
      drift += 1;
    }
  }
  if (drift > 0) {
    console.error(`\n${drift} 個對外檔案與公開倉 ${PUBLIC_REPO} 不同步。發版前必須先同步，使用者看到的是公開倉那份。`);
    process.exit(1);
  }
  console.log(`\n對外檔案與 ${PUBLIC_REPO} 全部同步。`);
}

if (require.main === module) main();
module.exports = { FILES, PUBLIC_REPO };
