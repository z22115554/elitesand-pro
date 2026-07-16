/**
 * OBS 歌詞顯示頁的執行版本指紋。
 *
 * OBS 的 Chromium 有時會忽略 no-cache，繼續執行舊的 display.js。這裡將 display.html
 * 與它載入的本機 JS/CSS 內容一起雜湊，並把結果放進 HTML 與每個本機資源 URL。只要任一
 * 顯示端資產改動，下一次 /display 載入就會得到不同 URL；display.js 再把同一指紋回報給
 * Socket server，面板才能區分「已連線」和「其實仍是舊程式」。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCAL_ASSET_RE = /(?:src|href)="(\/(?:js|css)\/[^"?#]+)"/g;

function getLocalAssets(html) {
  const assets = new Set();
  let match;
  while ((match = LOCAL_ASSET_RE.exec(html))) assets.add(match[1]);
  return [...assets].sort();
}

function fileForAsset(publicDir, assetUrl) {
  const root = path.resolve(publicDir);
  const file = path.resolve(root, `.${assetUrl}`);
  if (!file.startsWith(root + path.sep)) throw new Error(`無效的 display 資源路徑: ${assetUrl}`);
  return file;
}

function getDisplayRuntimeBuild(publicDir) {
  const displayFile = path.join(publicDir, 'display.html');
  const html = fs.readFileSync(displayFile, 'utf8');
  const assets = getLocalAssets(html);
  const hash = crypto.createHash('sha256');
  hash.update('display.html\0').update(html);
  for (const asset of assets) {
    hash.update(`\0${asset}\0`);
    const file = fileForAsset(publicDir, asset);
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
    else hash.update('MISSING');
  }
  return { build: hash.digest('hex').slice(0, 16), html, assets };
}

function renderDisplayRuntimePage(publicDir) {
  const runtime = getDisplayRuntimeBuild(publicDir);
  const withBuildAttribute = runtime.html.replace(
    /<html\b([^>]*)>/i,
    `<html$1 data-elitesand-display-build="${runtime.build}">`
  );
  const html = withBuildAttribute.replace(
    /((?:src|href)=")(\/(?:js|css)\/[^"?#]+)(")/g,
    `$1$2?v=${runtime.build}$3`
  );
  return { ...runtime, html };
}

module.exports = { getDisplayRuntimeBuild, renderDisplayRuntimePage };
