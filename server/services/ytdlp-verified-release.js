'use strict';

// Download official yt-dlp nightly as data, not by executing an outdated self-updater.
// Fail closed if release metadata, digest, version, or download differs.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fetch = require('node-fetch');
const { fetchWithTimeout } = require('../utils/helpers');
const { githubJsonHeaders } = require('../utils/app-version');

const execFileAsync = promisify(execFile);
const LATEST_API = 'https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest';
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
const MAX_BINARY_BYTES = 80 * 1024 * 1024;
const HEADERS = githubJsonHeaders('yt-dlp-updater');

function parseRelease(release) {
  const version = String(release?.tag_name || '');
  if (!VERSION_RE.test(version)) throw new Error('yt-dlp nightly release tag is invalid');
  const asset = release?.assets?.find(item => item.name === 'yt-dlp.exe');
  const url = `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${version}/yt-dlp.exe`;
  const digest = String(asset?.digest || '').match(/^sha256:([a-fA-F0-9]{64})$/);
  if (!asset || asset.browser_download_url !== url || !digest ||
      !Number.isSafeInteger(asset.size) || asset.size < 100000 || asset.size > MAX_BINARY_BYTES) {
    throw new Error('yt-dlp nightly binary metadata or digest is invalid');
  }
  return { version, url, digest: digest[1].toLowerCase(), size: asset.size };
}

async function latestRelease(fetchImpl = fetchWithTimeout) {
  const response = await fetchImpl(LATEST_API, { headers: HEADERS }, 12000);
  if (!response.ok) throw new Error(`yt-dlp nightly release lookup failed (HTTP ${response.status})`);
  return parseRelease(await response.json());
}

async function stageVerifiedRelease(target, release, { fetchImpl = fetch, execImpl = execFileAsync } = {}) {
  const staging = `${target}.${process.pid}.verified-next.exe`;
  if (fs.existsSync(staging)) throw new Error('yt-dlp staged update already exists');
  const controller = new AbortController();
  // Keep the deadline active through the full response body, not just headers.
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetchImpl(release.url, { headers: HEADERS, size: MAX_BINARY_BYTES, signal: controller.signal });
    if (!response.ok) throw new Error(`yt-dlp binary download failed (HTTP ${response.status})`);
    // The response must be fully received before any trusted executable is replaced.
    const binary = await response.buffer();
    if (binary.length !== release.size) throw new Error('yt-dlp downloaded binary size mismatch');
    const digest = crypto.createHash('sha256').update(binary).digest('hex');
    if (digest !== release.digest) throw new Error('yt-dlp downloaded binary SHA-256 mismatch');
    fs.writeFileSync(staging, binary, { flag: 'wx' });
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

module.exports = { LATEST_API, parseRelease, latestRelease, stageVerifiedRelease, installStagedRelease };
