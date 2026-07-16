'use strict';

const { isNewerVersion } = require('../utils/version-compare');

const UPDATE_ZIP_NAME = 'update.zip';
const UPDATE_HASH_NAME = 'update.zip.sha256';
const PORTABLE_ASSET_PATTERN = /^Elitesand-Pro-v?[0-9][^/]*-portable\.zip$/i;

// One shared interpretation of GitHub Releases. Notification-only and
// installation flows must choose the same version and recognise the same files.
function selectLatestRelease(releases) {
  if (!Array.isArray(releases)) return null;
  return releases
    .filter((release) => release && !release.draft && release.tag_name)
    .reduce((latest, release) => (
      !latest || isNewerVersion(String(release.tag_name), String(latest.tag_name)) ? release : latest
    ), null);
}

function findPortableAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => PORTABLE_ASSET_PATTERN.test(asset?.name || '')) || null;
}

function findVerifiedUpdateAssets(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const zip = assets.find((asset) => asset?.name === UPDATE_ZIP_NAME);
  const checksum = assets.find((asset) => asset?.name === UPDATE_HASH_NAME);
  return zip && checksum ? { zip, checksum } : null;
}

module.exports = {
  UPDATE_ZIP_NAME,
  UPDATE_HASH_NAME,
  PORTABLE_ASSET_PATTERN,
  selectLatestRelease,
  findPortableAsset,
  findVerifiedUpdateAssets,
};
