'use strict';

/**
 * 問題回報 — 送往中繼（Cloudflare Worker）的客戶端。
 *
 * 為什麼由 Node 端送、而不是瀏覽器直接送：
 * - 面板是 http://localhost:3000、手機遙控器是 http://192.168.x.x:3000，來源列不完，
 *   瀏覽器直送就得在中繼開一份永遠列不齊的 CORS 白名單。
 * - 手機遙控器可能只在區網、沒有外網；由伺服器送才有一致的網路路徑。
 *
 * 刻意不自動重試：重試會跟中繼的限流打架，也可能在使用者以為失敗時默默送出第二份。
 * 失敗就如實回報，讓使用者自己決定要不要再按一次（冪等鍵會擋掉重複建立 issue）。
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
const config = require('../utils/load-config');
const { appUserAgent } = require('../utils/app-version');
const { getInstallId } = require('./install-id');
const { createLogger } = require('../utils/logger');

const log = createLogger('Feedback');

const TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 256 * 1024;

// 中繼回傳的錯誤碼；面板用這些代碼挑 i18n 訊息，不直接顯示中繼的英文原文。
const ERROR_CODES = Object.freeze([
  'INVALID_REQUEST',
  'UNSUPPORTED_SCHEMA',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'BACKEND_UNAVAILABLE',
  'GITHUB_CREATE_FAILED',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
  'DISABLED',
]);

// 對外一律要求 HTTPS：回報內容雖然已清理，仍含使用者敘述與日誌，不能走明文。
// 唯一例外是本機中繼（wrangler dev），讓開發時可以真的把整條鏈路跑過一次。
function isEnabled() {
  const endpoint = String(config.feedbackEndpoint || '');
  if (!config.feedbackEnabled || !endpoint) return false;
  if (endpoint.startsWith('https://')) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(endpoint);
}

function newRequestId() {
  return crypto.randomUUID();
}

/**
 * @param {object} report buildReport() 產出的 report 物件
 * @param {string} requestId 冪等鍵；同一份報告重送要帶同一個值，中繼才不會開出第二張 issue
 */
async function submitReport(report, requestId, options = {}) {
  if (!isEnabled()) return { ok: false, code: 'DISABLED' };

  const payload = JSON.stringify({
    schemaVersion: report.schemaVersion,
    requestId,
    installId: getInstallId(),
    type: report.type,
    locale: report.locale,
    appVersion: report.appVersion,
    issueTitle: report.issueTitle,
    issueBody: report.issueBody,
    issueLabels: report.issueLabels,
  });

  if (Buffer.byteLength(payload, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl || fetch)(config.feedbackEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': appUserAgent('feedback'),
      },
      body: payload,
      signal: controller.signal,
    });

    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }

    if (response.ok && data && data.success && data.reportId) {
      log.info(`問題回報已送出：${data.reportId}`);
      return { ok: true, reportId: data.reportId, warnings: data.warnings || [] };
    }

    const code = data && data.error && ERROR_CODES.includes(data.error.code)
      ? data.error.code
      : (response.status === 429 ? 'RATE_LIMITED' : 'BACKEND_UNAVAILABLE');
    log.warn(`問題回報遭中繼拒絕：${code}（HTTP ${response.status}）`);
    return { ok: false, code };
  } catch (err) {
    // 逾時、DNS、離線都歸成同一類：使用者能做的處置都一樣（稍後再試或改用複製全文）。
    log.warn(`問題回報送出失敗：${err.name === 'AbortError' ? '逾時' : err.message}`);
    return { ok: false, code: 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isEnabled, newRequestId, submitReport, ERROR_CODES, MAX_BODY_BYTES };
