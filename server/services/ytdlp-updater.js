/**
 * yt-dlp 版本檢查與官方 Nightly 驗證更新
 *
 * yt-dlp 版本號是日期格式（YYYY.MM.DD[.build]），可直接字串比較新舊。
 * 一律走 nightly 通道：穩定版跟不上 YouTube 的改動，匯入失敗頻率太高（2026-09 使用者決定）。
 * - checkUpdate()：讀本機 `yt-dlp --version`，比對 yt-dlp-nightly-builds 最新 release tag。
 *   純唯讀，任何失敗都靜默回 available:false / hasUpdate:false，不影響其他功能。
 * - runUpdate()：使用 GitHub 官方 Nightly 資產的 SHA-256 驗證、版本驗證後才替換執行檔。
 *   Installer 只更新 userData 可信副本，保持受保護 seed 不變；路由層須掛 requirePin。
 * - ensureNightlyChannel()：Installer 啟動時檢查並更新過舊 Nightly 或穩定版。
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const execFileAsync = promisify(execFile);
const { createLogger } = require('../utils/logger');
const { getYtdlpCommand } = require('../utils/ytdlp-command');
const nightlyRelease = require('./ytdlp-verified-release');
const {
  normalizeHash,
  normalizeVersion,
  hashFileSync,
  readTrustState,
  writeTrustStateAtomic,
} = require('../utils/ytdlp-runtime-trust');

const log = createLogger('YtdlpUpdater');

const YTDLP_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const YTDLP_COMMAND = getYtdlpCommand();

let _cache = null; // { payload, at }
let _inflightUpdate = null;

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
    checkError: null,
    checkedAt: Date.now(),
  };

  if (currentVersion) {
    try {
      const release = await nightlyRelease.latestRelease();
      payload.latestVersion = release.version;
      payload.hasUpdate = isNewer(release.version, currentVersion);
    } catch (e) {
      log.warn(`檢查 yt-dlp 最新版失敗: ${e.message}`);
      payload.checkError = '無法連線取得官方 Nightly 版本，請檢查網路後重試。';
    }
  }

  _cache = { payload, at: Date.now() };
  return payload;
}

/**
 * 從 GitHub 官方 Nightly 下載並驗證再替換。回傳 { ok, message, currentVersion }。
 * 更新期間不可修改 Installer seed，失敗要保留目前可信的執行檔。
 */
async function performVerifiedUpdate() {
  if (process.env.ELITESAND_PACKAGED === '1' && process.env.ELITESAND_YTDLP_MUTABLE !== '1') {
    return { ok: false, message: '目前無法建立可寫入的 yt-dlp 更新副本；已保留內建版本，不會修改受保護的程式檔案。' };
  }
  try {
    // A packaged build must never replace its protected seed or an untrusted runtime.
    if (process.env.ELITESAND_PACKAGED === '1' && !runtimeMatchesRecordedTrust()) {
      throw new Error('yt-dlp runtime trust state is invalid; restart to recover the packaged seed');
    }
    const resolved = path.isAbsolute(YTDLP_COMMAND) ? YTDLP_COMMAND :
      String((await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', ['yt-dlp'],
        { timeout: 5000, windowsHide: true })).stdout).split(/\r?\n/).find(Boolean)?.trim();
    if (!resolved || !path.isAbsolute(resolved) || !/^yt-dlp(?:\.exe)?$/i.test(path.basename(resolved))) {
      throw new Error('yt-dlp executable update path could not be resolved');
    }
    const release = await nightlyRelease.latestRelease();
    const current = await localVersion();
    if (current === release.version) return { ok: true, message: '已是最新 Nightly 版本', currentVersion: current };
    if (current && isNewer(current, release.version)) {
      return { ok: true, message: '目前版本比官方最新 Nightly 更新，未進行降級', currentVersion: current };
    }
    const staging = await nightlyRelease.stageVerifiedRelease(resolved, release);
    nightlyRelease.installStagedRelease(resolved, staging, () => {
      if (process.env.ELITESAND_PACKAGED === '1') writeApprovedRuntimeTrust(release.version);
    });
    _cache = null;
    const currentVersion = await localVersion();
    if (currentVersion !== release.version) throw new Error('yt-dlp version mismatch after installation');
    log.info(`yt-dlp 官方 Nightly 驗證更新完成，目前版本 ${currentVersion}`);
    return { ok: true, message: `官方 Nightly ${currentVersion} 已完成 SHA-256 驗證並安裝`, currentVersion };
  } catch (e) {
    log.warn(`yt-dlp 官方 Nightly 更新失敗: ${e.message}`);
    return { ok: false, message: `更新失敗：${e.message}` };
  }
}

function runUpdate() {
  if (_inflightUpdate) return _inflightUpdate;
  _inflightUpdate = performVerifiedUpdate().finally(() => { _inflightUpdate = null; });
  return _inflightUpdate;
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

  _nightlyFallbackPromise = runUpdate().then(result => {
    if (!result.ok) {
      // A failed network or permission attempt must not permanently disable recovery.
      _nightlyFallbackPromise = null;
    }
    return { ...result, skipped: false };
  });

  return _nightlyFallbackPromise;
}

/** nightly 版號多一段建置編號（YYYY.MM.DD.HHMMSS），穩定版只有三段。 */
function isNightlyVersion(version) {
  return /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(String(version || '').trim());
}

/**
 * Installer 啟動時確認 Nightly 最新版本（含已經是舊 Nightly）。只動可信可寫副本
 * （同 runNightlyFallback 的限制），開發環境／portable 不碰。背景執行，失敗不影響啟動。
 */
async function ensureNightlyChannel() {
  if (process.env.ELITESAND_PACKAGED !== '1' || process.env.ELITESAND_YTDLP_MUTABLE !== '1') return { ok: false, skipped: true };
  const current = await localVersion();
  const status = await checkUpdate();
  if (!status.latestVersion) return { ok: false, skipped: true, message: '無法查詢官方 Nightly 版本' };
  if (!current || !isNewer(status.latestVersion, current)) return { ok: true, skipped: true, currentVersion: current };
  log.info(`yt-dlp ${current} 有更新的 Nightly ${status.latestVersion}，準備安全更新`);
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
