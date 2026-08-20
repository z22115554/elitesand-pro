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
const templateDelivery = require('./template-delivery');

const LOCAL_ASSET_RE = /(?:src|href)="(\/(?:js|css)\/[^"?#]+)"/g;
// 批次 C-1：/js/t/<id> 是動態遞送的加密模板，不是 public/ 底下的實體檔案，
// 指紋要改問 template-delivery 拿內容雜湊，不能直接找檔案（會一律變成 MISSING，
// 導致模板換版後 OBS 快取指紋沒變、疊層還是舊碼）。
const TEMPLATE_ROUTE_RE = /^\/js\/t\/([a-z0-9-]+)$/;

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

// 指紋計算要同步讀 display.html ＋ 它引用的每一個本機資產（目前 21 個引用、
// 實測約 535KB）再全部 sha256。這本身沒問題，問題是呼叫點：socket-handler 的
// getClientCounts() 在每次連線／斷線／client:build／Twitch 狀態變更都會叫它，
// 而面板一開就是 6 個 socket（主面板＋3 個 display 預覽＋2 個 setlist 預覽），
// 一次 Ctrl+F5 就是十幾次全量讀檔＋雜湊卡在事件迴圈上——同一條事件迴圈同時要送
// lyrics:sync 與 broadcastState，直接反映成 OBS 歌詞抖動。
//
// 快取鍵刻意用「每個來源檔的 mtimeMs+size」而不是時間或單一旗標：production 要的
// 是省掉重複雜湊，dev 要的是「改完存檔、Ctrl+F5 就看得到」。用 mtime 當鍵兩者同時成立，
// 不可退回成全域快取或 TTL——那會讓 dev workflow 失效（批次 C-1 踩過同一個坑）。
let cachedBuild = null;

function assetStamp(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (_) {
    return 'MISSING';
  }
}

function computeCacheKey(publicDir, displayFile, assets) {
  const parts = [assetStamp(displayFile)];
  for (const asset of assets) {
    const templateMatch = asset.match(TEMPLATE_ROUTE_RE);
    // 模板走 template-delivery（packed 時是加密 blob、dev 時是原始檔），沒有單一
    // 可 stat 的路徑，因此用它的指紋本身當戳記——那個呼叫遠比讀 500KB 便宜。
    parts.push(templateMatch
      ? `t:${templateDelivery.getTemplateFingerprint(templateMatch[1]) || 'MISSING'}`
      : assetStamp(fileForAsset(publicDir, asset)));
  }
  return parts.join('|');
}

function getDisplayRuntimeBuild(publicDir) {
  const displayFile = path.join(publicDir, 'display.html');
  const html = fs.readFileSync(displayFile, 'utf8');
  const assets = getLocalAssets(html);
  const cacheKey = `${path.resolve(publicDir)}\0${computeCacheKey(publicDir, displayFile, assets)}`;
  if (cachedBuild && cachedBuild.key === cacheKey) {
    return { build: cachedBuild.build, html, assets };
  }
  const hash = crypto.createHash('sha256');
  hash.update('display.html\0').update(html);
  for (const asset of assets) {
    hash.update(`\0${asset}\0`);
    const templateMatch = asset.match(TEMPLATE_ROUTE_RE);
    if (templateMatch) {
      const fingerprint = templateDelivery.getTemplateFingerprint(templateMatch[1]);
      hash.update(fingerprint || 'MISSING');
      continue;
    }
    const file = fileForAsset(publicDir, asset);
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
    else hash.update('MISSING');
  }
  const build = hash.digest('hex').slice(0, 16);
  cachedBuild = { key: cacheKey, build };
  return { build, html, assets };
}

function resetDisplayRuntimeBuildCache() { cachedBuild = null; }

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

module.exports = { getDisplayRuntimeBuild, renderDisplayRuntimePage, resetDisplayRuntimeBuildCache };
