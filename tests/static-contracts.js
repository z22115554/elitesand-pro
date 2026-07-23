'use strict';

const fs = require('fs');
const path = require('path');

const SOCKET_LIFECYCLE_EVENTS = new Set(['connect', 'connect_error', 'disconnect']);
const UNPROTECTED_ROUTE_ALLOWLIST = new Map([
  ['server/routes/auth.js:POST:/verify', 'PIN login must remain reachable before authentication'],
  ['server/routes/auth.js:POST:/set', 'initial PIN setup and current-PIN verification happen inside the handler'],
  ['server/routes/auth.js:POST:/clear', 'current-PIN verification happens inside the handler'],
  ['server/routes/api.js:POST:/eula/accept', 'first-run EULA acceptance happens before PIN setup; the handler only records acceptance of the current EULA version'],
]);

function walkJavaScriptFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return walkJavaScriptFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.js') ? [absolute] : [];
  });
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function socketContractReport(serverSources, clientSource) {
  const emitted = new Set();
  for (const { source } of serverSources) {
    const clean = stripComments(source);
    for (const match of clean.matchAll(/\b(?:io|socket|target|_io)\.emit\(\s*['"]([^'"]+)['"]/g)) emitted.add(match[1]);
  }
  const cleanClient = stripComments(clientSource);
  const forwardsAllServerEvents = /\bsocket\.onAny\s*\(/.test(cleanClient);
  const forwarded = new Set();
  for (const match of cleanClient.matchAll(/\bsocket\.on\(\s*['"]([^'"]+)['"]/g)) {
    if (!SOCKET_LIFECYCLE_EVENTS.has(match[1])) forwarded.add(match[1]);
  }
  return {
    emitted: [...emitted].sort(),
    forwarded: [...forwarded].sort(),
    forwardsAllServerEvents,
    missing: forwardsAllServerEvents ? [] : [...emitted].filter((event) => !forwarded.has(event)).sort(),
  };
}

function routeContractReport(serverSources, allowlist = UNPROTECTED_ROUTE_ALLOWLIST) {
  const routes = [];
  for (const { file, source } of serverSources) {
    const relative = file.replace(/\\/g, '/');
    const clean = stripComments(source);
    // 整檔掃描（非逐行）：多行宣告的路由也能被看到。守衛視窗用 lookahead（不消耗字元，
    // 否則視窗會吃掉緊接的下一條路由宣告而漏掃），且在下一條路由宣告處截斷（否則會把
    // 下一條路由的 requirePin 誤算到這一條頭上）。GET 通常唯讀不納管，唯一例外是
    // Stream Deck 的 /api/deck（GET 也是寫入操作），漏掛 requirePin 必須被抓出來。
    const ROUTE_DECL = /\b(?:router|app)\.(?:get|post|put|patch|delete)\(/i;
    for (const match of clean.matchAll(/\b(?:router|app)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,(?=([\s\S]{0,160}))/gi)) {
      const method = match[1].toUpperCase();
      const route = match[2];
      if (method === 'GET' && !route.startsWith('/api/deck')) continue;
      let guardWindow = match[3];
      const nextDecl = guardWindow.search(ROUTE_DECL);
      if (nextDecl >= 0) guardWindow = guardWindow.slice(0, nextDecl);
      const key = `${relative}:${method}:${route}`;
      routes.push({ file: relative, method, route, key, protected: /\brequirePin\b/.test(guardWindow), allowed: allowlist.has(key) });
    }
  }
  return {
    routes,
    unprotected: routes.filter((item) => !item.protected && !item.allowed),
    staleAllowlist: [...allowlist.keys()].filter((key) => !routes.some((item) => item.key === key && !item.protected)),
  };
}

function loadRepositorySources(root) {
  const serverRoot = path.join(root, 'server');
  return walkJavaScriptFiles(serverRoot).map((absolute) => ({
    file: path.relative(root, absolute),
    source: fs.readFileSync(absolute, 'utf8'),
  }));
}

module.exports = {
  UNPROTECTED_ROUTE_ALLOWLIST,
  loadRepositorySources,
  routeContractReport,
  socketContractReport,
};
