/**
 * yt-dlp 版本檢查與自我更新
 *
 * yt-dlp 版本號是日期格式（YYYY.MM.DD[.build]），可直接字串比較新舊。
 * 一律走 nightly 通道：穩定版跟不上 YouTube 的改動，匯入失敗頻率太高（2026-09 使用者決定）。
 * - checkUpdate()：讀本機 `yt-dlp --version`，比對 yt-dlp-nightly-builds 最新 release tag。
 *   純唯讀，任何失敗都靜默回 available:false / hasUpdate:false，不影響其他功能。
 * - runUpdate()：執行 `yt-dlp --update-to nightly`（官方自我更新，會核對官方檢查碼；
 *   pip 版會回訊息叫你用 pip）。會改動檔案，屬受保護操作，路由層須掛 requirePin。
 * - ensureNightlyChannel()：啟動時若 Installer 的可寫副本還是穩定版，就換成 nightly 一次。
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const execFileAsync = promisify(execFile);
const { fetchWithTimeout } = require('../utils/helpers');
const { createLogger } = require('../utils/logger');
const { githubJsonHeaders } = require('../utils/app-version');
const { getYtdlpCommand } = require('../utils/ytdlp-command');
const {
  normalizeHash,
  normalizeVersion,
  hashFileSync,
  readTrustState,
  writeTrustStateAtomic,
} = require('../utils/ytdlp-runtime-trust');

const log = createLogger('YtdlpUpdater');

const YTDLP_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const LATEST_API = 'https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest';
const YTDLP_COMMAND = getYtdlpCommand();

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
    const { stdout } = await execFileAsync(YTDLP_COMMAND, ['--version'], {
      timeout: 4000, windowsHide: true, maxBuffer: 64 * 1024, env: YTDLP_ENV,
    });
    return parseVersion(stdout);
  } catch (_) {
    return null;
  }
}

function packagedTrustEnvironment() {
  if (process.env.ELITESAND_PACKAGED !== '1' || process.env.ELITESAND_YTDLP_MUTABLE !== '1') return null;
  const statePath = process.env.ELITESAND_YTDLP_STATE_PATH;
  const seedPath = process.env.ELITESAND_YTDLP_SEED_PATH;
  const seedHash = normalizeHash(process.env.ELITESAND_YTDLP_SEED_HASH);
  const seedVersion = process.env.ELITESAND_YTDLP_SEED_VERSION
    ? normalizeVersion(process.env.ELITESAND_YTDLP_SEED_VERSION)
    : null;
  if (!path.isAbsolute(YTDLP_COMMAND) || !path.isAbsolute(statePath || '') || !path.isAbsolute(seedPath || '') || !seedHash) {
    throw new Error('yt-dlp runtime trust environment is incomplete');
  }
  if (path.dirname(path.resolve(statePath)) !== path.dirname(path.resolve(YTDLP_COMMAND))) {
    throw new Error('yt-dlp trust state must stay beside the runtime binary');
  }
  return { statePath: path.resolve(statePath), seedPath: path.resolve(seedPath), seedHash, seedVersion };
}

function writeApprovedRuntimeTrust(currentVersion) {
  const trust = packagedTrustEnvironment();
  if (!trust) return;
  const runtimeVersion = normalizeVersion(currentVersion);
  if (!runtimeVersion) throw new Error('updated yt-dlp did not report a valid version');
  const actualSeedHash = hashFileSync(trust.seedPath);
  if (actualSeedHash !== trust.seedHash) throw new Error('packaged yt-dlp seed hash changed unexpectedly');
  const runtimeHash = hashFileSync(YTDLP_COMMAND);
  writeTrustStateAtomic(trust.statePath, {
    runtimeHash,
    runtimeVersion,
    seedHash: trust.seedHash,
    seedVersion: trust.seedVersion,
    provenance: 'official-update',
  });
}

function restoreTrustedSeedRuntime() {
  const trust = packagedTrustEnvironment();
  if (!trust) return false;
  const actualSeedHash = hashFileSync(trust.seedPath);
  if (actualSeedHash !== trust.seedHash) throw new Error('cannot restore yt-dlp because packaged seed integrity changed');
  const target = path.resolve(YTDLP_COMMAND);
  const temporary = `${target}.recovery.tmp`;
  try { fs.unlinkSync(temporary); } catch (_) { /* stale app-owned staging */ }
  fs.copyFileSync(trust.seedPath, temporary);
  if (hashFileSync(temporary) !== trust.seedHash) throw new Error('yt-dlp seed recovery copy hash mismatch');
  try { fs.unlinkSync(target); } catch (_) { /* updater may already have removed/replaced it */ }
  fs.renameSync(temporary, target);
  writeTrustStateAtomic(trust.statePath, {
    runtimeHash: trust.seedHash,
    runtimeVersion: trust.seedVersion,
    seedHash: trust.seedHash,
    seedVersion: trust.seedVersion,
    provenance: 'seed',
  });
  return true;
}

function runtimeMatchesRecordedTrust() {
  const trust = packagedTrustEnvironment();
  if (!trust) return true;
  const recorded = readTrustState(trust.statePath);
  if (!recorded) return false;
  try {
    return hashFileSync(YTDLP_COMMAND) === recorded.runtimeHash;
  } catch (_) {
    return false;
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
        headers: githubJsonHeaders('yt-dlp-updater'),
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
  if (process.env.ELITESAND_PACKAGED === '1' && process.env.ELITESAND_YTDLP_MUTABLE !== '1') {
    return { ok: false, message: '目前無法建立可寫入的 yt-dlp 更新副本；已保留內建版本，不會修改受保護的程式檔案。' };
  }
  try {
    const { stdout, stderr } = await execFileAsync(YTDLP_COMMAND, ['--update-to', 'nightly'], {
      timeout: 60000, windowsHide: true, maxBuffer: 512 * 1024, env: YTDLP_ENV,
    });
    _cache = null;
    const out = `${stdout || ''}${stderr || ''}`.trim();
    // 擷取有意義的最後幾行給前端顯示（不含本機路徑細節）
    const lastLines = out.split(/\r?\n/).filter(Boolean).slice(-4).join('\n');
    const currentVersion = await localVersion();
    if (process.env.ELITESAND_PACKAGED === '1') writeApprovedRuntimeTrust(currentVersion);
    log.info(`yt-dlp 自我更新完成，目前版本 ${currentVersion}`);
    return { ok: true, message: lastLines || '已是最新版本', currentVersion };
  } catch (e) {
    log.warn(`yt-dlp 自我更新失敗: ${e.message}`);
    if (process.env.ELITESAND_PACKAGED === '1' && process.env.ELITESAND_YTDLP_MUTABLE === '1') {
      try {
        if (!runtimeMatchesRecordedTrust() && restoreTrustedSeedRuntime()) {
          log.warn('yt-dlp 更新後驗證失敗，且 runtime 已偏離可信 hash；已恢復 Installer 內建可信 seed。');
        }
      } catch (restoreError) {
        log.error(`yt-dlp 更新失敗且無法恢復可信 seed: ${restoreError.message}`);
      }
    }
    return { ok: false, message: '更新失敗：可能是以 pip 安裝（請改用 pip 更新），或沒有寫入權限。' };
  }
}


let _nightlyFallbackPromise = null;

/**
 * YouTube extractor 相容性救援：只有 Installer 打包版的「可寫工作副本」可以自動
 * 切到 nightly。開發環境／portable 不碰使用者 PATH 或安裝目錄中的 yt-dlp，
 * 避免一次匯入默默修改全域工具。
 *
 * 同一輪 app 只做一次，避免 YouTube 故障時每首歌都打 updater。
 */
async function runNightlyFallback() {
  if (_nightlyFallbackPromise) return _nightlyFallbackPromise;
  if (process.env.ELITESAND_PACKAGED !== '1') {
    return { ok: false, skipped: true, message: '非 Installer 打包環境，不自動修改 yt-dlp。' };
  }
  if (process.env.ELITESAND_YTDLP_MUTABLE !== '1') {
    return { ok: false, skipped: true, message: 'yt-dlp 工作副本不可寫，略過 nightly fallback。' };
  }

  _nightlyFallbackPromise = (async () => {
    try {
      const { stdout, stderr } = await execFileAsync(YTDLP_COMMAND, ['--update-to', 'nightly'], {
        timeout: 60000, windowsHide: true, maxBuffer: 512 * 1024, env: YTDLP_ENV,
      });
      _cache = null;
      const currentVersion = await localVersion();
      writeApprovedRuntimeTrust(currentVersion);
      const out = `${stdout || ''}${stderr || ''}`.trim();
      const lastLines = out.split(/\r?\n/).filter(Boolean).slice(-4).join('\n');
      log.info(`YouTube 相容性救援已切換/確認 nightly，版本 ${currentVersion}`);
      return { ok: true, skipped: false, message: lastLines || 'nightly 已可用', currentVersion };
    } catch (e) {
      log.warn(`yt-dlp nightly fallback 失敗: ${e.message}`);
      try {
        if (!runtimeMatchesRecordedTrust() && restoreTrustedSeedRuntime()) {
          log.warn('nightly fallback 後 runtime 驗證失敗；已恢復 Installer 內建可信 seed。');
        }
      } catch (restoreError) {
        log.error(`nightly fallback 失敗且無法恢復可信 seed: ${restoreError.message}`);
      }
      return { ok: false, skipped: false, message: 'nightly fallback 失敗；保留既有可信 yt-dlp。' };
    }
  })();

  return _nightlyFallbackPromise;
}

/** nightly 版號多一段建置編號（YYYY.MM.DD.HHMMSS），穩定版只有三段。 */
function isNightlyVersion(version) {
  return /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(String(version || '').trim());
}

/**
 * 既有安裝還停在穩定版時，啟動後換成 nightly 一次。只動 Installer 的可信可寫副本
 * （同 runNightlyFallback 的限制），開發環境／portable 不碰。背景執行，失敗不影響啟動。
 */
async function ensureNightlyChannel() {
  if (process.env.ELITESAND_PACKAGED !== '1' || process.env.ELITESAND_YTDLP_MUTABLE !== '1') return { ok: false, skipped: true };
  const current = await localVersion();
  if (!current || isNightlyVersion(current)) return { ok: true, skipped: true, currentVersion: current };
  log.info(`yt-dlp 目前是穩定版 ${current}，切換到 nightly`);
  return runNightlyFallback();
}

module.exports = {
  checkUpdate,
  ensureNightlyChannel,
  isNightlyVersion,
  runUpdate,
  runNightlyFallback,
  isNewer,
  parseVersion,
  packagedTrustEnvironment,
  writeApprovedRuntimeTrust,
  restoreTrustedSeedRuntime,
  runtimeMatchesRecordedTrust,
};
