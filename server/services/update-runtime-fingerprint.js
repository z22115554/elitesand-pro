'use strict';

// A cold-start update query may describe the installed runtime, but must never
// identify a particular person or machine.  This value is derived only from
// the shared, integrity-protected app.asar bytes and the public app version.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { APP_VERSION } = require('../utils/app-version');

// Electron's normal `fs` module treats `resources/app.asar` as a virtual
// archive path.  The update selector needs the physical archive bytes
// themselves, so use Electron's ASAR-bypassing filesystem when available.
// Plain Node tests and the development server do not expose `original-fs`;
// they continue to use the normal filesystem without any special setup.
let physicalFs = fs;
try { physicalFs = require('original-fs'); } catch (_) { /* Plain Node runtime. */ }

const SHA256_RE = /^[a-f0-9]{64}$/i;
const cache = new Map();

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function runtimeFingerprintFromAsarHash({ version = APP_VERSION, asarSha256 } = {}) {
  if (typeof version !== 'string' || !version.trim() || !SHA256_RE.test(String(asarSha256 || ''))) return null;
  return sha256Text(`elitesand-runtime-fingerprint-v1\n${version.trim()}\n${String(asarSha256).toLowerCase()}`);
}

function hashFile(file, createReadStream = fs.createReadStream) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let stream;
    try { stream = createReadStream(file); } catch (error) { reject(error); return; }
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function getInstalledRuntimeFingerprint({
  installRoot = process.env.ELITESAND_INSTALL_ROOT,
  version = APP_VERSION,
  stat = physicalFs.promises.stat,
  createReadStream = physicalFs.createReadStream,
} = {}) {
  if (typeof installRoot !== 'string' || !path.isAbsolute(installRoot)) return null;
  const appAsar = path.join(path.resolve(installRoot), 'resources', 'app.asar');
  try {
    const info = await stat(appAsar);
    if (!info?.isFile?.() || !Number.isSafeInteger(info.size) || info.size <= 0) return null;
    const cacheKey = `${appAsar}\n${info.size}\n${info.mtimeMs}\n${version}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const asarSha256 = await hashFile(appAsar, createReadStream);
    const fingerprint = runtimeFingerprintFromAsarHash({ version, asarSha256 });
    if (!fingerprint) return null;
    cache.clear();
    cache.set(cacheKey, fingerprint);
    return fingerprint;
  } catch (_) {
    return null;
  }
}

function _resetForTests() { cache.clear(); }

module.exports = {
  getInstalledRuntimeFingerprint,
  hashFile,
  runtimeFingerprintFromAsarHash,
  _resetForTests,
};
