'use strict';

class ProviderHealthRegistry {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.cooldownMs = options.cooldownMs || 5 * 60 * 1000;
    this.timeoutMs = options.timeoutMs || 7000;
    this.now = options.now || (() => Date.now());
    this.providers = new Map();
  }

  _entry(name) {
    if (!this.providers.has(name)) {
      this.providers.set(name, {
        attempts: 0, successes: 0, misses: 0, failures: 0, timeouts: 0, skipped: 0,
        consecutiveFailures: 0, totalDurationMs: 0, lastDurationMs: 0,
        lastAttemptAt: 0, lastSuccessAt: 0, lastFailureAt: 0,
        lastError: '', openUntil: 0,
      });
    }
    return this.providers.get(name);
  }

  async execute(name, task) {
    const entry = this._entry(name);
    if (entry.openUntil > this.now()) {
      entry.skipped += 1;
      return { status: 'skipped', result: null, durationMs: 0 };
    }
    if (entry.openUntil) {
      entry.openUntil = 0;
      entry.consecutiveFailures = 0;
    }

    const startedAt = this.now();
    entry.attempts += 1;
    entry.lastAttemptAt = startedAt;
    let timer;
    try {
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`歌詞來源 ${name} 超過 ${this.timeoutMs}ms 未回應`);
          error.code = 'PROVIDER_TIMEOUT';
          reject(error);
        }, this.timeoutMs);
      });
      const result = await Promise.race([Promise.resolve().then(task), timeout]);
      const durationMs = Math.max(0, this.now() - startedAt);
      entry.totalDurationMs += durationMs;
      entry.lastDurationMs = durationMs;
      entry.consecutiveFailures = 0;
      entry.lastError = '';
      if (result && result.lyrics) {
        entry.successes += 1;
        entry.lastSuccessAt = this.now();
        return { status: 'success', result, durationMs };
      }
      entry.misses += 1;
      return { status: 'miss', result: null, durationMs };
    } catch (error) {
      const durationMs = Math.max(0, this.now() - startedAt);
      entry.totalDurationMs += durationMs;
      entry.lastDurationMs = durationMs;
      entry.failures += 1;
      entry.consecutiveFailures += 1;
      entry.lastFailureAt = this.now();
      entry.lastError = String(error && error.message || error || '未知錯誤').slice(0, 240);
      if (error && error.code === 'PROVIDER_TIMEOUT') entry.timeouts += 1;
      if (entry.consecutiveFailures >= this.failureThreshold) entry.openUntil = this.now() + this.cooldownMs;
      return { status: error && error.code === 'PROVIDER_TIMEOUT' ? 'timeout' : 'failure', result: null, durationMs, error };
    } finally {
      clearTimeout(timer);
    }
  }

  snapshot(names = [...this.providers.keys()]) {
    const now = this.now();
    return names.map((name) => {
      const entry = this._entry(name);
      const open = entry.openUntil > now;
      return {
        name, state: open ? 'paused' : 'available', attempts: entry.attempts,
        successes: entry.successes, misses: entry.misses, failures: entry.failures,
        timeouts: entry.timeouts, skipped: entry.skipped,
        consecutiveFailures: entry.consecutiveFailures,
        averageDurationMs: entry.attempts ? Math.round(entry.totalDurationMs / entry.attempts) : 0,
        lastDurationMs: entry.lastDurationMs, lastAttemptAt: entry.lastAttemptAt,
        lastSuccessAt: entry.lastSuccessAt, lastFailureAt: entry.lastFailureAt,
        lastError: entry.lastError, retryAt: open ? entry.openUntil : 0,
      };
    });
  }

  reset() { this.providers.clear(); }
}

module.exports = { ProviderHealthRegistry };
