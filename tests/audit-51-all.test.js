'use strict';

// 取自 #51（2026-11-13 全面抓蟲）的回歸測試分成好幾個 PR 送，每個 PR 放一個
// tests/audit-51-<主題>.test.js。這裡自動載入全部，各 PR 不必各自改 package.json 而互相衝突。
const fs = require('fs');
const path = require('path');

for (const name of fs.readdirSync(__dirname).sort()) {
  if (/^audit-51-.+\.test\.js$/.test(name) && name !== path.basename(__filename)) {
    require(path.join(__dirname, name));
  }
}
