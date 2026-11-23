'use strict';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 10;
const attempts = new Map();

function clean(now = Date.now()) {
  for (const [key, value] of attempts) {
    if (now - value.startedAt >= WINDOW_MS) attempts.delete(key);
  }
}

function status(key, now = Date.now()) {
  clean(now);
  const entry = attempts.get(String(key || 'unknown'));
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    return { allowed: true, remaining: MAX_FAILURES, retryAfterMs: 0 };
  }
  return {
    allowed: entry.count < MAX_FAILURES,
    remaining: Math.max(0, MAX_FAILURES - entry.count),
    retryAfterMs: Math.max(0, WINDOW_MS - (now - entry.startedAt)),
  };
}

function recordFailure(key, now = Date.now()) {
  const id = String(key || 'unknown');
  const current = attempts.get(id);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    attempts.set(id, { count: 1, startedAt: now });
  } else {
    current.count += 1;
  }
  return status(id, now);
}

/**
 * 同一台裝置不管從哪個入口猜 PIN（/api/auth、受保護的 HTTP 路由、Socket.io 握手）都算同一組次數。
 * 舊版三個入口各用各的 key，等於每 5 分鐘可以猜 30 次而不是 10 次。
 * IPv4-mapped IPv6（::ffff:192.168.1.5）跟純 IPv4 視為同一個位址。
 */
function keyForAddress(address) {
  const value = String(address || 'unknown').trim().toLowerCase();
  return `pin:${value.startsWith('::ffff:') ? value.slice(7) : value}`;
}

function reset(key) {
  attempts.delete(String(key || 'unknown'));
}

function resetAll() {
  attempts.clear();
}

module.exports = { status, recordFailure, reset, resetAll, keyForAddress, WINDOW_MS, MAX_FAILURES };
