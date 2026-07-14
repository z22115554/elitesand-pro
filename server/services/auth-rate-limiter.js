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

function reset(key) {
  attempts.delete(String(key || 'unknown'));
}

function resetAll() {
  attempts.clear();
}

module.exports = { status, recordFailure, reset, resetAll, WINDOW_MS, MAX_FAILURES };
