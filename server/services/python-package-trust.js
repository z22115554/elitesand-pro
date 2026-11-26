'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeRemove } = require('../utils/safe-remove');
const { atomicWriteRaw } = require('./atomic-store-file');
const manifest = require('./python-locks/manifest.json');
const bootstrapWheels = require('./python-locks/bootstrap-wheels.json');

function readLock(name, readFile = fs.readFileSync) {
  const entry = Object.hasOwn(manifest.locks, name) ? manifest.locks[name] : null;
  if (!entry || !/^[a-z-]+-(?:win-py311|mac-arm64-py312)\.lock$/.test(entry.file)) throw new Error('Unknown Python requirement lock');
  const bytes = readFile(path.join(__dirname, 'python-locks', entry.file));
  if (!Buffer.isBuffer(bytes) || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`Python requirement lock SHA-256 verification failed: ${name}`);
  }
  return bytes;
}

function materializeLock(name, directory) {
  const bytes = readLock(name);
  const file = path.join(directory, `requirements-${name}.txt`);
  atomicWriteRaw(file, bytes);
  return file;
}

async function bootstrapPackages(directory, fetchBytes, run, { abortSignal } = {}) {
  const lock = readLock('bootstrap').toString('utf8');
  fs.mkdirSync(directory, { recursive: true });
  const wheelhouse = fs.mkdtempSync(path.join(directory, '.pip-bootstrap-'));
  try {
    for (const wheel of bootstrapWheels) {
      if (abortSignal?.aborted) throw Object.assign(new Error('安裝已取消'), { code: 'CANCELLED' });
      if (!/^[a-zA-Z0-9_.+-]+\.whl$/.test(wheel.file)
        || new URL(wheel.url).origin !== 'https://files.pythonhosted.org'
        || !lock.includes(`--hash=sha256:${wheel.sha256}`)) throw new Error('Invalid bootstrap wheel trust root');
      const bytes = await fetchBytes(wheel.url, { maxBytes: 20 * 1024 * 1024 });
      if (!Buffer.isBuffer(bytes) || bytes.length !== wheel.size
        || crypto.createHash('sha256').update(bytes).digest('hex') !== wheel.sha256) {
        throw new Error(`Bootstrap wheel SHA-256 verification failed: ${wheel.name}`);
      }
      atomicWriteRaw(path.join(wheelhouse, wheel.file), bytes);
    }
    if (abortSignal?.aborted) throw Object.assign(new Error('安裝已取消'), { code: 'CANCELLED' });
    // get-pip implicitly adds an unpinned pip request, incompatible with hashed
    // -r files. Only our independently verified, offline wheels may satisfy it.
    return await run(['get-pip.py', '--no-setuptools', '--no-wheel', '--isolated', '--no-index',
      '--find-links', wheelhouse, '--no-deps', '--only-binary=:all:', '--disable-pip-version-check',
      '--no-warn-script-location', ...bootstrapWheels.map(wheel => `${wheel.name}==${wheel.version}`)]);
  } finally {
    try { safeRemove(wheelhouse); } catch (_) { /* cleanup must not undo a verified install */ }
  }
}

function installArgs(name, directory, { noDeps = false, forceReinstall = false } = {}) {
  return ['-m', 'pip', '--isolated', 'install', '--require-hashes', '--no-build-isolation', '--prefer-binary',
    '--disable-pip-version-check', '--no-warn-script-location', '--progress-bar', 'on',
    '--index-url', 'https://pypi.org/simple', '--extra-index-url', 'https://download.pytorch.org/whl/cu124',
    ...(noDeps ? ['--no-deps'] : []), ...(forceReinstall ? ['--force-reinstall'] : []),
    '-r', materializeLock(name, directory)];
}

/**
 * macOS（Apple Silicon）：只從 PyPI 安裝、只收 wheel（Mac 使用者多半沒有編譯器）、
 * --no-deps（鎖定清單本身就是完整的相依閉包；刻意排除的 diffq 不能被 pip 補回來）。
 */
function macInstallArgs(name, directory, { forceReinstall = false } = {}) {
  return ['-m', 'pip', '--isolated', 'install', '--require-hashes', '--no-deps', '--only-binary=:all:',
    '--disable-pip-version-check', '--no-warn-script-location', '--progress-bar', 'on',
    '--index-url', 'https://pypi.org/simple',
    ...(forceReinstall ? ['--force-reinstall'] : []),
    '-r', materializeLock(name, directory)];
}

function installLocalArgs(directory) {
  // MuQ's source archive is separately pinned. Its runtime and build
  // dependencies have already been installed from the packaged hash locks.
  return ['-m', 'pip', '--isolated', 'install', '--no-deps', '--no-build-isolation', '--no-index',
    '--disable-pip-version-check', '--no-warn-script-location', directory];
}

module.exports = { readLock, materializeLock, bootstrapPackages, installArgs, macInstallArgs, installLocalArgs };
