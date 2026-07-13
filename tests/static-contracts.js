'use strict';

const fs = require('fs');
const path = require('path');

const SOCKET_LIFECYCLE_EVENTS = new Set(['connect', 'connect_error', 'disconnect']);
const UNPROTECTED_ROUTE_ALLOWLIST = new Map([
  ['server/routes/auth.js:POST:/verify', 'PIN login must remain reachable before authentication'],
  ['server/routes/auth.js:POST:/set', 'initial PIN setup and current-PIN verification happen inside the handler'],
  ['server/routes/auth.js:POST:/clear', 'current-PIN verification happens inside the handler'],
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
  const forwarded = new Set();
  for (const match of stripComments(clientSource).matchAll(/\bsocket\.on\(\s*['"]([^'"]+)['"]/g)) {
    if (!SOCKET_LIFECYCLE_EVENTS.has(match[1])) forwarded.add(match[1]);
  }
  return {
    emitted: [...emitted].sort(),
    forwarded: [...forwarded].sort(),
    missing: [...emitted].filter((event) => !forwarded.has(event)).sort(),
  };
}

function routeContractReport(serverSources, allowlist = UNPROTECTED_ROUTE_ALLOWLIST) {
  const routes = [];
  for (const { file, source } of serverSources) {
    const relative = file.replace(/\\/g, '/');
    const clean = stripComments(source);
    for (const line of clean.split(/\r?\n/)) {
      const match = line.match(/\b(?:router|app)\.(post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,(.*)$/i);
      if (!match) continue;
      const method = match[1].toUpperCase();
      const route = match[2];
      const key = `${relative}:${method}:${route}`;
      routes.push({ file: relative, method, route, key, protected: /\brequirePin\b/.test(match[3]), allowed: allowlist.has(key) });
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
