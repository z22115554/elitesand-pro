'use strict';

// package.json 是產品版本的唯一來源。所有對外顯示、健康檢查、診斷與應用程式自己的
// User-Agent 都從這裡取得，避免發布時某一個模組仍帶著舊版本或舊品牌字串。
const packageJson = require('../../package.json');

const APP_VERSION = typeof packageJson.version === 'string' && packageJson.version.trim()
  ? packageJson.version.trim()
  : '0.0.0';

function appUserAgent(component = '') {
  const suffix = String(component || '').trim();
  return suffix ? `ElitesandPro/${APP_VERSION} (${suffix})` : `ElitesandPro/${APP_VERSION}`;
}

function githubJsonHeaders(component = '') {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': appUserAgent(component),
  };
}

module.exports = { APP_PACKAGE: packageJson, APP_VERSION, appUserAgent, githubJsonHeaders };
