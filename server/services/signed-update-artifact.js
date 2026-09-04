'use strict';

// The outer policy authenticates *where* and *which* artifact is allowed;
// this module authenticates the bytes before they are ever handed to the
// updater.  It intentionally has no retry or alternate source: a failed
// cold-start attempt leaves the current app running unchanged.
const crypto = require('crypto');
const { appUserAgent } = require('../utils/app-version');
const { MAX_UPDATE_ZIP_BYTES, isExactIncrementalArtifactUrl } = require('./update-policy');

const ARTIFACT_TIMEOUT_MS = 120000;

function assertIncrementalArtifactPlan(plan) {
  if (!plan || typeof plan !== 'object' || plan.delivery !== 'incremental') {
    throw new TypeError('signed incremental update plan is required');
  }
  const artifact = plan.artifact;
  if (!artifact || typeof artifact !== 'object' || !isExactIncrementalArtifactUrl(artifact.url, plan)) {
    throw new Error('signed update artifact URL is invalid');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ''))) throw new Error('signed update artifact SHA-256 is invalid');
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_UPDATE_ZIP_BYTES) {
    throw new Error('signed update artifact size is invalid');
  }
  return Object.freeze({
    url: artifact.url,
    sha256: artifact.sha256.toLowerCase(),
    size: artifact.size,
  });
}

// onProgress(loadedBytes, totalBytes) 只是給 UI 用的即時進度，節流到最多每 200ms 一次，
// 避免上百 MB 的下載對每個小 chunk 都觸發一次 setProgress／IPC 廣播。呼叫失敗絕不可讓下載
// 本身中斷，所以外層包一層防呆。
function throttledProgress(onProgress, minIntervalMs = 200) {
  if (typeof onProgress !== 'function') return () => {};
  let lastCallAt = 0;
  return (loaded, total) => {
    const now = Date.now();
    if (loaded !== total && now - lastCallAt < minIntervalMs) return;
    lastCallAt = now;
    try { onProgress(loaded, total); } catch (_) { /* UI 進度回報失敗不可讓下載中斷 */ }
  };
}

async function readExactBytes(response, expectedSize, onProgress) {
  const declared = response.headers?.get?.('content-length');
  if (declared != null && declared !== '') {
    const size = Number.parseInt(declared, 10);
    if (!Number.isSafeInteger(size) || size !== expectedSize) throw new Error('update artifact Content-Length does not match signed policy');
  }
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') throw new Error('update artifact response is not a readable stream');
  const reader = body.getReader();
  const reportProgress = throttledProgress(onProgress);
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > expectedSize) throw new Error('update artifact exceeds signed size');
      chunks.push(chunk);
      reportProgress(total, expectedSize);
    }
  } finally {
    if (total !== expectedSize) {
      try { await reader.cancel(); } catch (_) { /* best effort */ }
    }
  }
  if (total !== expectedSize) throw new Error('update artifact size does not match signed policy');
  reportProgress(total, expectedSize);
  return Buffer.concat(chunks, total);
}

async function downloadSignedIncrementalArtifact(plan, {
  fetchImpl = globalThis.fetch,
  timeoutMs = ARTIFACT_TIMEOUT_MS,
  onProgress,
} = {}) {
  const artifact = assertIncrementalArtifactPlan(plan);
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 180000) throw new TypeError('invalid update artifact timeout');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('update artifact timeout')), timeoutMs);
  try {
    const response = await fetchImpl(artifact.url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/zip', 'User-Agent': appUserAgent('signed-update-artifact') },
    });
    if (!response || response.status !== 200) throw new Error(`update artifact HTTP ${response?.status || 'failure'}`);
    const buffer = await readExactBytes(response, artifact.size, onProgress);
    const actual = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actual !== artifact.sha256) throw new Error('update artifact SHA-256 does not match signed policy');
    return Object.freeze({ buffer, sha256: actual, size: buffer.length, url: artifact.url });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('update artifact download timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  ARTIFACT_TIMEOUT_MS,
  assertIncrementalArtifactPlan,
  downloadSignedIncrementalArtifact,
  readExactBytes,
};
