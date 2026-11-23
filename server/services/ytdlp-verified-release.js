'use strict';

// Download official yt-dlp nightly as data, not by executing an outdated self-updater.
// Fail closed if release metadata, digest, version, or download differs.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fetch = require('node-fetch');
const { githubJsonHeaders } = require('../utils/app-version');
const { verifySignedChecksums } = require('./ytdlp-signature-trust');
const { ytdlpReleaseAssetName } = require('../utils/platform-binaries');

const execFileAsync = promisify(execFile);
const LATEST_API = 'https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest';
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
const MAX_BINARY_BYTES = 80 * 1024 * 1024;
const HEADERS = githubJsonHeaders('yt-dlp-updater');
const MIN_RELEASE_AGE_MS = 6 * 60 * 60 * 1000;

// macOS 用官方 Universal 執行檔 yt-dlp_macos；其餘維持 yt-dlp.exe。
function parseRelease(release, { now = Date.now(), minAgeMs = MIN_RELEASE_AGE_MS, assetName = ytdlpReleaseAssetName() } = {}) {
  const version = String(release?.tag_name || '');
  if (!VERSION_RE.test(version)) throw new Error('yt-dlp nightly release tag is invalid');
  const published = Date.parse(release?.published_at || '');
  if (!Number.isFinite(published) || now - published < minAgeMs) throw new Error('yt-dlp nightly release has not passed its six-hour adoption delay');
  const asset = release?.assets?.find(item => item.name === assetName);
  const url = `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${version}/${assetName}`;
  const digest = String(asset?.digest || '').match(/^sha256:([a-fA-F0-9]{64})$/);
  if (!asset || asset.browser_download_url !== url || !digest ||
      !Number.isSafeInteger(asset.size) || asset.size < 100000 || asset.size > MAX_BINARY_BYTES) {
    throw new Error('yt-dlp nightly binary metadata or digest is invalid');
  }
  return { version, url, assetName, digest: digest[1].toLowerCase(), size: asset.size, publishedAt: published };
}

async function latestRelease(fetchImpl = fetch) {
  const bytes = await fetchBytes(LATEST_API, fetchImpl, 512 * 1024, 12000);
  return parseRelease(JSON.parse(bytes.toString('utf8')));
}

async function fetchBytes(url, fetchImpl, maxBytes, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: HEADERS, size: maxBytes, signal: controller.signal });
    if (!response.ok) throw new Error(`yt-dlp release download failed (HTTP ${response.status})`);
    const bytes = await response.buffer();
    if (bytes.length > maxBytes) throw new Error('yt-dlp signed checksum exceeds its size limit');
    return bytes;
  } finally { clearTimeout(timer); }
}

async function stageVerifiedRelease(target, release, {
  fetchImpl = fetch,
  execImpl = execFileAsync,
  verifyChecksumsImpl = verifySignedChecksums,
  assetName = release?.assetName || ytdlpReleaseAssetName(),
  platform = process.platform,
} = {}) {
  const staging = `${target}.${process.pid}.verified-next${platform === 'darwin' ? '' : '.exe'}`;
  if (fs.existsSync(staging)) throw new Error('yt-dlp staged update already exists');
  const controller = new AbortController();
  // Keep the deadline active through the full response body, not just headers.
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const base = `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${release.version}/`;
    if (!VERSION_RE.test(release.version) || release.url !== `${base}${assetName}`) throw new Error('Invalid official yt-dlp release URL');
    if (!Number.isFinite(release.publishedAt) || Date.now() - release.publishedAt < MIN_RELEASE_AGE_MS) {
      throw new Error('yt-dlp release has not passed its six-hour adoption delay');
    }
    const [checksums, signature] = await Promise.all([
      fetchBytes(`${base}SHA2-256SUMS`, fetchImpl, 65536),
      fetchBytes(`${base}SHA2-256SUMS.sig`, fetchImpl, 16384),
    ]);
    const signedDigest = await verifyChecksumsImpl(checksums, signature, { assetName });
    if (signedDigest !== release.digest) throw new Error('Signed yt-dlp SHA-256 differs from release metadata');
    const response = await fetchImpl(release.url, { headers: HEADERS, size: MAX_BINARY_BYTES, signal: controller.signal });
    if (!response.ok) throw new Error(`yt-dlp binary download failed (HTTP ${response.status})`);
    // The response must be fully received before any trusted executable is replaced.
    const binary = await response.buffer();
    if (binary.length !== release.size) throw new Error('yt-dlp downloaded binary size mismatch');
    const digest = crypto.createHash('sha256').update(binary).digest('hex');
    if (digest !== release.digest) throw new Error('yt-dlp downloaded binary SHA-256 mismatch');
    fs.writeFileSync(staging, binary, { flag: 'wx', mode: 0o755 });
    if (platform === 'darwin') fs.chmodSync(staging, 0o755);
    const { stdout } = await execImpl(staging, ['--version'], { timeout: 10000, windowsHide: true });
    if (String(stdout).trim() !== release.version) throw new Error('yt-dlp executable version differs from release tag');
    return staging;
  } catch (error) {
    try { fs.unlinkSync(staging); } catch (_) { /* nothing to clean */ }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function installStagedRelease(target, staging, validateInstalled) {
  if (!path.isAbsolute(target) || !fs.existsSync(target)) throw new Error('yt-dlp update target is not an existing absolute file');
  const previous = `${target}.${process.pid}.before-update.bak`;
  if (fs.existsSync(previous)) throw new Error('yt-dlp previous-update backup already exists');
  let moved = false;
  try {
    fs.renameSync(target, previous);
    moved = true;
    fs.renameSync(staging, target);
    validateInstalled();
  } catch (error) {
    if (moved) {
      try { fs.unlinkSync(target); } catch (_) { /* new binary may not exist */ }
      fs.renameSync(previous, target);
    }
    throw error;
  } finally {
    try { fs.unlinkSync(staging); } catch (_) { /* staging already renamed */ }
  }
  // Failure to delete a backup must not roll back a verified, committed update.
  try { fs.unlinkSync(previous); } catch (_) { /* retained recovery backup */ }
}

module.exports = { LATEST_API, MIN_RELEASE_AGE_MS, parseRelease, latestRelease, stageVerifiedRelease, installStagedRelease };
