/**
 * GitHub Releases 更新檢查
 *
 * 設計原則：
 * - 未設定 updateCheckRepo 時完全不發送網路請求（零成本停用）
 * - 任何錯誤（離線、repo 不存在、無 Release）都靜默處理，絕不影響伺服器啟動或運作
 * - 結果快取在記憶體中，依設定的間隔才重新檢查，避免頻繁打 GitHub API
 */

const { fetchWithTimeout } = require('../utils/helpers');
const { isNewerVersion } = require('../utils/version-compare');
const { createLogger } = require('../utils/logger');
const pkg = require('../../package.json');
const config = require('../utils/load-config');

const log = createLogger('UpdateChecker');

let _cache = null;       // { result, timestamp }
let _inFlight = null;    // 避免同時觸發多個請求

function selectLatestRelease(releases) {
  if (!Array.isArray(releases)) return null;
  return releases
    .filter((release) => release && !release.draft && release.tag_name)
    .reduce((latest, release) => {
      if (!latest || isNewerVersion(String(release.tag_name), String(latest.tag_name))) return release;
      return latest;
    }, null);
}

/**
 * 取得目前版本可更新狀態
 * @returns {Promise<object>} {
 *   enabled: boolean,
 *   hasUpdate: boolean,
 *   currentVersion: string,
 *   latestVersion: string|null,
 *   releaseUrl: string|null,
 *   releaseNotes: string|null,
 *   downloadUrl: string|null,
 *   checkedAt: number|null,
 *   error: string|null
 * }
 */
async function checkForUpdate({ force = false } = {}) {
  const currentVersion = pkg.version || '0.0.0';

  // 未設定 repo：直接回傳停用狀態，零網路請求
  if (!config.updateCheckRepo || typeof config.updateCheckRepo !== 'string' || !config.updateCheckRepo.includes('/')) {
    return {
      enabled: false,
      hasUpdate: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      releaseNotes: null,
      downloadUrl: null,
      checkedAt: null,
      error: null,
    };
  }

  const interval = config.updateCheckIntervalMs || 6 * 60 * 60 * 1000;

  // 快取仍有效：直接回傳
  if (!force && _cache && Date.now() - _cache.timestamp < interval) {
    return _cache.result;
  }

  // 已有請求正在進行：等它完成，避免重複打 API
  if (_inFlight) {
    return _inFlight;
  }

  _inFlight = (async () => {
    const base = {
      enabled: true,
      hasUpdate: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      releaseNotes: null,
      downloadUrl: null,
      checkedAt: Date.now(),
      error: null,
    };

    try {
      // 讀 releases 清單而非 /latest：公開測試版通常標成 prerelease，/latest 會刻意忽略。
      const url = `https://api.github.com/repos/${config.updateCheckRepo}/releases?per_page=20`;
      const res = await fetchWithTimeout(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ElitesandPro-UpdateChecker',
        },
      }, 8000);

      if (!res.ok) {
        // GitHub 對 private repo 和不存在 repo 都回 404；不能假裝「已是最新版」，
        // 否則前端會露出沒有有效下載目標的假按鈕。
        if (res.status === 404) {
          base.error = '更新來源尚未公開，或尚未發布 Release';
        } else {
          base.error = `GitHub API 回應 ${res.status}`;
        }
        _cache = { result: base, timestamp: Date.now() };
        return base;
      }

      const releases = await res.json();
      const data = selectLatestRelease(releases);
      if (!data) {
        _cache = { result: base, timestamp: Date.now() };
        return base;
      }
      const latestVersion = (data.tag_name || '').replace(/^[vV]/, '');

      base.latestVersion = latestVersion || null;
      base.releaseUrl = data.html_url || null;
      // release notes 截斷，避免面板顯示過長內容
      base.releaseNotes = typeof data.body === 'string' ? data.body.slice(0, 500) : null;
      const portable = Array.isArray(data.assets)
        ? data.assets.find((asset) => /Elitesand-Pro.*portable.*\.zip$/i.test(asset.name || ''))
        : null;
      base.downloadUrl = portable ? portable.browser_download_url : null;
      base.hasUpdate = latestVersion ? isNewerVersion(latestVersion, currentVersion) : false;

      if (base.hasUpdate) {
        log.info(`發現新版本: ${currentVersion} → ${latestVersion}`);
      }

      _cache = { result: base, timestamp: Date.now() };
      return base;
    } catch (err) {
      // 離線、DNS 失敗、timeout 等：靜默記錄，不拋出
      base.error = err.message;
      log.warn(`更新檢查失敗（不影響程式運作）: ${err.message}`);
      // 失敗結果也快取，但縮短有效期為 5 分鐘，避免離線時持續重試拖慢面板載入
      _cache = { result: base, timestamp: Date.now() - interval + 5 * 60 * 1000 };
      return base;
    }
  })();

  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}

module.exports = { checkForUpdate, selectLatestRelease };
