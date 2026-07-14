/**
 * yt-dlp 版本檢查與自我更新
 *
 * yt-dlp 版本號是日期格式（YYYY.MM.DD[.build]），可直接字串比較新舊。
 * - checkUpdate()：讀本機 `yt-dlp --version`，比對 GitHub 最新 release tag，回報是否可更新。
 *   純唯讀，任何失敗都靜默回 available:false / hasUpdate:false，不影響其他功能。
 * - runUpdate()：執行 `yt-dlp -U`（官方自我更新；binary 版直接就地更新，
 *   pip 版會回訊息叫你用 pip）。會改動檔案，屬受保護操作，路由層須掛 requirePin。
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { fetchWithTimeout } = require('../utils/helpers');
const { createLogger } = require('../utils/logger');

const log = createLogger('YtdlpUpdater');

const YTDLP_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const LATEST_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

let _cache = null; // { payload, at }

/** 只取版本號本身（去掉可能的附註），yt-dlp --version 通常單行就是版本。 */
function parseVersion(text) {
  const m = String(text || '').trim().match(/\d{4}\.\d{2}\.\d{2}(?:\.\d+)?/);
  return m ? m[0] : (String(text || '').trim().split(/\s+/)[0] || null);
}

/** 日期版本字串比較：a 是否比 b 新。無法解析時回 false（保守：不亂報有更新）。 */
function isNewer(a, b) {
  if (!a || !b) return false;
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function localVersion() {
  try {
    const { stdout } = await execFileAsync('yt-dlp', ['--version'], {
      timeout: 4000, windowsHide: true, maxBuffer: 64 * 1024, env: YTDLP_ENV,
    });
    return parseVersion(stdout);
  } catch (_) {
    return null;
  }
}

/**
 * @param {boolean} force 忽略 10 分鐘快取，強制重打 GitHub
 * @returns {Promise<{available:boolean,currentVersion:string|null,latestVersion:string|null,hasUpdate:boolean,checkedAt:number}>}
 */
async function checkUpdate(force = false) {
  if (!force && _cache && Date.now() - _cache.at < 10 * 60 * 1000) return _cache.payload;

  const currentVersion = await localVersion();
  const payload = {
    available: !!currentVersion,
    currentVersion,
    latestVersion: null,
    hasUpdate: false,
    checkedAt: Date.now(),
  };

  if (currentVersion) {
    try {
      const res = await fetchWithTimeout(LATEST_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Elitesand-Pro' },
      }, 8000);
      if (res.ok) {
        const data = await res.json();
        payload.latestVersion = parseVersion(data.tag_name) || null;
        payload.hasUpdate = isNewer(payload.latestVersion, currentVersion);
      }
    } catch (e) {
      log.warn(`檢查 yt-dlp 最新版失敗: ${e.message}`);
    }
  }

  _cache = { payload, at: Date.now() };
  return payload;
}

/**
 * 執行 yt-dlp 自我更新。回傳 { ok, message, currentVersion }。
 * timeout 拉長到 60s（要下載新 binary）；成功後清掉檢查快取。
 */
async function runUpdate() {
  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', ['-U'], {
      timeout: 60000, windowsHide: true, maxBuffer: 512 * 1024, env: YTDLP_ENV,
    });
    _cache = null;
    const out = `${stdout || ''}${stderr || ''}`.trim();
    // 擷取有意義的最後幾行給前端顯示（不含本機路徑細節）
    const lastLines = out.split(/\r?\n/).filter(Boolean).slice(-4).join('\n');
    const currentVersion = await localVersion();
    log.info(`yt-dlp 自我更新完成，目前版本 ${currentVersion}`);
    return { ok: true, message: lastLines || '已是最新版本', currentVersion };
  } catch (e) {
    log.warn(`yt-dlp 自我更新失敗: ${e.message}`);
    return { ok: false, message: '更新失敗：可能是以 pip 安裝（請改用 pip 更新），或沒有寫入權限。' };
  }
}

module.exports = { checkUpdate, runUpdate, isNewer, parseVersion };
