'use strict';

const { isNewerVersion } = require('../utils/version-compare');
const { findInstallerAsset, findVerifiedUpdateAssets } = require('./release-client');

/**
 * Update discovery boundary.
 *
 * Providers may return normalized metadata only.  They must never return ZIP
 * bytes, stream handles, runner callbacks, or an unfiltered third-party
 * release object.  Download/apply remains behind the cold-start gate.
 */
function createNoUpdatePlan({ repo = null, currentVersion, reason }) {
  return {
    source: 'github-release',
    enabled: !!repo,
    repo: repo || null,
    currentVersion,
    latestVersion: null,
    hasUpdate: false,
    canIncremental: false,
    needsFull: false,
    reason: reason || (repo ? null : '未設定更新來源'),
    releaseUrl: null,
    downloadUrl: null,
  };
}

function normalizeGitHubRelease(release, { currentVersion, canIncremental }) {
  const latestVersion = String(release?.tag_name || '').replace(/^[vV]/, '');
  const plan = createNoUpdatePlan({ repo: 'configured', currentVersion });
  plan.latestVersion = latestVersion || null;
  plan.releaseUrl = typeof release?.html_url === 'string' ? release.html_url : null;
  const installer = findInstallerAsset(release);
  plan.downloadUrl = installer?.browser_download_url || plan.releaseUrl;
  plan.hasUpdate = !!latestVersion && isNewerVersion(latestVersion, currentVersion);
  if (!plan.hasUpdate) {
    plan.reason = '已是最新版本';
    return plan;
  }

  const verifiedAssets = findVerifiedUpdateAssets(release);
  const capable = !!canIncremental();
  plan.canIncremental = !!verifiedAssets && capable;
  plan.needsFull = !plan.canIncremental;
  if (!capable) plan.reason = '目前安裝版本尚未具備安全增量更新執行環境，請使用完整 Windows Installer。';
  else if (!verifiedAssets) plan.reason = '新版未提供安全增量更新包，請使用完整 Windows Installer。';
  return plan;
}

function createGitHubReleaseProvider({ repo, currentVersion, fetchLatestRelease, canIncremental = () => false }) {
  if (typeof fetchLatestRelease !== 'function') throw new TypeError('GitHub update provider requires fetchLatestRelease');
  if (typeof canIncremental !== 'function') throw new TypeError('GitHub update provider requires canIncremental');
  const repository = typeof repo === 'string' && repo.trim() ? repo.trim() : null;

  return Object.freeze({
    id: 'github-release',
    async getPlan() {
      const base = createNoUpdatePlan({ repo: repository, currentVersion });
      if (!repository) return base;
      try {
        const release = await fetchLatestRelease(repository);
        const normalized = normalizeGitHubRelease(release, { currentVersion, canIncremental });
        return { ...normalized, repo: repository };
      } catch (error) {
        return {
          ...base,
          reason: error?.status === 404 ? '更新來源尚未公開或尚未發布 Release' : `檢查失敗：${error?.message || 'unknown error'}`,
        };
      }
    },
  });
}

function assertNormalizedUpdatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('update provider must return a normalized plan object');
  const forbidden = ['assets', 'zipBuffer', 'stream', 'runner', 'prepareUpdate', 'download'];
  if (forbidden.some((key) => Object.prototype.hasOwnProperty.call(plan, key))) {
    throw new TypeError('update provider returned a forbidden transport or execution field');
  }
  return plan;
}

module.exports = {
  createNoUpdatePlan,
  normalizeGitHubRelease,
  createGitHubReleaseProvider,
  assertNormalizedUpdatePlan,
};
