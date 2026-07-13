/**
 * 後端工具函數
 * （已移除全專案未使用的 sanitizeFilename 與 fetchWithRetry）
 */

const fetch = require('node-fetch');

/**
 * 延遲函數
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 帶 timeout 的 fetch（node-fetch v2 不支援 timeout 選項，使用 AbortController）
 * @param {string} url - 請求 URL
 * @param {Object} options - fetch 選項
 * @param {number} timeout - 超時時間（毫秒），預設 10000
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // 移除 node-fetch v2 不支援的 timeout 選項，改用 AbortController
    const { timeout: _ignored, signal: _externalSignal, ...fetchOptions } = options;
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (externalSignal?.aborted) throw err;
      throw new Error(`network timeout at: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

module.exports = {
  delay,
  fetchWithTimeout,
};
