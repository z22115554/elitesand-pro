'use strict';

const os = require('os');

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateAddress(hostname) {
  const host = normalizeHost(hostname);
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const m = /^172\.(\d{1,3})\./.exec(host);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^169\.254\./.test(host) || /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(host)) return true;
  return false;
}

function localHostnames() {
  const names = new Set(['localhost', '127.0.0.1', '::1']);
  const hostname = normalizeHost(os.hostname());
  if (hostname) {
    names.add(hostname);
    names.add(`${hostname}.local`);
  }
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry && entry.address) names.add(normalizeHost(entry.address));
    }
  }
  return names;
}

const LOCAL_HOSTS = localHostnames();

function parseHostHeader(hostHeader) {
  const raw = String(hostHeader || '').trim();
  // Host 標頭只能是 hostname[:port] 或 [IPv6]:port；拒絕 userinfo/path/query，
  // 避免 URL parser 把「evil@example」之類的輸入誤解成一個可信 hostname。
  if (!raw || /[\s/@\\?#]/.test(raw)) return '';
  try {
    const url = new URL(`http://${raw}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
    return normalizeHost(url.hostname);
  } catch (_) {
    return '';
  }
}

function isTrustedHostname(hostname) {
  const host = normalizeHost(hostname);
  return LOCAL_HOSTS.has(host) || isPrivateAddress(host);
}

function isAllowedHttpHost(hostHeader) {
  const hostname = parseHostHeader(hostHeader);
  return !!hostname && isTrustedHostname(hostname);
}

/**
 * Socket.io 的 CORS 設定只保護 HTTP polling，WebSocket 仍需 allowRequest。
 * 接受：沒有 Origin 的 OBS/CLI，或 Origin 與實際 Host 完全同源且 Host 為本機/私有網段。
 */
function isAllowedSocketRequest(req) {
  const headers = (req && req.headers) || {};
  const origin = headers.origin;
  // Upgrade 請求不會經過 Express middleware；即使沒有 Origin 的 OBS/CLI，
  // 仍必須帶本機或私網 Host，否則 DNS rebinding 可直接打到 Socket.io。
  const requestHostname = parseHostHeader(headers.host);
  if (!requestHostname || !isTrustedHostname(requestHostname)) return false;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    return originUrl.host.toLowerCase() === String(headers.host || '').trim().toLowerCase()
      && isTrustedHostname(originUrl.hostname);
  } catch (_) {
    return false;
  }
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  try {
    return isTrustedHostname(new URL(origin).hostname);
  } catch (_) {
    return false;
  }
}

module.exports = {
  isAllowedSocketRequest,
  isAllowedCorsOrigin,
  isAllowedHttpHost,
  isPrivateAddress,
  isTrustedHostname,
  parseHostHeader,
};
