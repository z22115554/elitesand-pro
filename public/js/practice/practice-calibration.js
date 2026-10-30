/** Local hardware latency profiles; no audio, server state, or legacy global migration. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PracticeCalibration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'elitesand-practice-latency-profiles-v1';
  const DEFAULT_MS = 120;
  const MAX_PROFILES = 32;
  const validRate = (n) => Number.isInteger(n) && n >= 8000 && n <= 384000;
  const identity = (s) => typeof s === 'string' && s.length > 0 && s.length <= 2048 && s !== 'default' && s !== 'communications';
  const validMs = (n) => Number.isFinite(n) && n >= 0 && n <= 400 && n % 10 === 0;

  function resolveDeviceId(id, kind, devices) {
    if (identity(id)) return id;
    const list = Array.isArray(devices) ? devices : [];
    const alias = list.find((d) => d.kind === kind && d.deviceId === (id || 'default'));
    if (!alias || !alias.groupId) return null;
    const matches = list.filter((d) => d.kind === kind && identity(d.deviceId) && d.groupId === alias.groupId);
    return matches.length === 1 ? matches[0].deviceId : null;
  }

  // Output signature comes from the playback graph, including both dual routes.
  // An unresolved system default stays session-only: an empty sinkId is not hardware identity.
  function outputIdentity(signature, devices) {
    try {
      const a = JSON.parse(signature);
      if (!Array.isArray(a) || a.length !== 5 || typeof a[1] !== 'boolean' || !Number.isFinite(a[4]) || a[4] < 0) return null;
      const main = resolveDeviceId(a[0], 'audiooutput', devices);
      const headphone = a[1] ? resolveDeviceId(a[2], 'audiooutput', devices) : '';
      const stream = a[1] ? resolveDeviceId(a[3], 'audiooutput', devices) : '';
      if (!main || (a[1] && (!headphone || !stream))) return null;
      return JSON.stringify([main, a[1], headphone, stream, a[4]]);
    } catch (_) { return null; }
  }

  function profileKey(environment) {
    const e = environment || {};
    if (!identity(e.micId) || !identity(e.outputId) || !validRate(e.sampleRate) || !validRate(e.contextSampleRate)) return null;
    return JSON.stringify([e.micId, e.outputId, e.sampleRate, e.contextSampleRate]);
  }

  function validKey(key) {
    if (typeof key !== 'string' || key.length > 8192) return false;
    try {
      const a = JSON.parse(key);
      return Array.isArray(a) && a.length === 4 && profileKey({ micId: a[0], outputId: a[1], sampleRate: a[2], contextSampleRate: a[3] }) === key;
    } catch (_) { return false; }
  }

  function sanitize(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.profiles)) return [];
    const profiles = new Map();
    // Bound work as well as storage when localStorage has been edited or corrupted.
    for (const p of data.profiles.slice(-MAX_PROFILES * 4)) {
      if (!p || !validKey(p.key) || !validMs(p.ms) || !['manual', 'acoustic'].includes(p.method)
        || !Number.isSafeInteger(p.updatedAt) || p.updatedAt < 0) continue;
      const previous = profiles.get(p.key);
      if (!previous || previous.updatedAt <= p.updatedAt) profiles.set(p.key, { key: p.key, ms: p.ms, method: p.method, updatedAt: p.updatedAt });
    }
    return [...profiles.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(-MAX_PROFILES);
  }

  function createProfiles(options) {
    const o = options || {};
    let profiles = sanitize(o.data), revision = 0, signature = '', key = null;
    let current = { ms: DEFAULT_MS, method: null, persistent: false };
    const state = () => ({ ...current, key, revision });
    function select(environment, force) {
      const e = environment || {};
      const nextSignature = JSON.stringify([e.micId || null, e.outputId || null, e.sampleRate || null, e.contextSampleRate || null, e.route || null]);
      if (!force && signature === nextSignature) return false;
      signature = nextSignature; key = profileKey(e); revision++;
      const found = key && profiles.find((p) => p.key === key);
      current = found ? { ms: found.ms, method: found.method, persistent: true } : { ms: DEFAULT_MS, method: null, persistent: false };
      return true;
    }
    function remember(ms, method, token) {
      if (!validMs(ms) || !['manual', 'acoustic'].includes(method) || (token && token.revision !== revision)) return false;
      current = { ms, method, persistent: !!key };
      if (key) {
        const now = o.now ? o.now() : Date.now();
        const updatedAt = Number.isSafeInteger(now) && now >= 0 ? now : 0;
        profiles = profiles.filter((p) => p.key !== key).concat({ key, ms, method, updatedAt }).slice(-MAX_PROFILES);
        if (o.save) o.save({ version: 1, profiles });
      }
      return true;
    }
    return { select, state, remember, token: () => ({ revision }), isCurrent: (token) => !!token && token.revision === revision };
  }

  return { STORAGE_KEY, DEFAULT_MS, MAX_PROFILES, resolveDeviceId, outputIdentity, profileKey, sanitize, createProfiles };
});
