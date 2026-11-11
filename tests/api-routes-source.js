'use strict';

// /api 路由依功能分成 server/routes/api.js 與 server/routes/api/*.js。
// 用原始碼字串做檢查的守衛測試一律讀這裡回傳的「全部合併」內容，
// 路由搬到哪個子檔都照樣檢查得到，不會因為分檔而漏看。
const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', 'server', 'routes');

function apiRouteFiles() {
  const subDir = path.join(ROUTES_DIR, 'api');
  const subFiles = fs.existsSync(subDir)
    ? fs.readdirSync(subDir).filter((name) => name.endsWith('.js')).sort().map((name) => path.join(subDir, name))
    : [];
  return [path.join(ROUTES_DIR, 'api.js'), ...subFiles];
}

function readApiRoutesSource() {
  return apiRouteFiles().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

module.exports = { apiRouteFiles, readApiRoutesSource };
