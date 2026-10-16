'use strict';

const policy = require('../../../server/services/update-policy');
const {
  UPDATE_POLICY_PUBLIC_KEYS, getUpdatePolicyPublicKey, isUpdatePolicyKeyAllowedForChannel,
} = require('../../../server/services/update-policy-public-keys');
const { controlKey, planKey, parseControl, makePlanId } = require('./publish-hotfix');

const PLAN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const RENEW_BEFORE_MS = 3 * 24 * 60 * 60 * 1000;
const JSON_OPTIONS = Object.freeze({ contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' });

// Only renew plans referenced by the CURRENT control pointer. Never scan old
// plans or rebuild a support list: that would revive withdrawn releases.
async function renewActivePlans({
  channel = 'stable', store, privateKey, keyId, workerProbe,
  now = () => new Date(), dryRun = true, allowTestKey = false,
} = {}) {
  if (channel !== 'stable' && channel !== 'beta') throw new Error('unsupported renewal channel');
  if (!store || typeof store.get !== 'function' || typeof store.putImmutable !== 'function' || typeof store.putControlIfMatch !== 'function') {
    throw new TypeError('renewal requires a conditional R2 store');
  }
  const pointerKey = controlKey(channel);
  const previous = await store.get(pointerKey);
  if (!previous && channel === 'beta') return { channel, dryRun, renewed: 0, skipped: 'not-configured' };
  if (!previous?.etag) throw new Error('renewal requires an existing control pointer with an ETag');
  const control = parseControl(previous.body);
  if (control.disabled) return { channel, dryRun, renewed: 0, skipped: 'disabled' };
  if (!Object.keys(control.plans).length) return { channel, dryRun, renewed: 0, skipped: 'empty' };

  if (!privateKey || !keyId) throw new Error(`active ${channel} plans require update-policy signing secrets`);
  const signerPublicKey = policy.publicKeyHexFromPrivateKey(privateKey);
  if (!allowTestKey && (getUpdatePolicyPublicKey(keyId, UPDATE_POLICY_PUBLIC_KEYS) !== signerPublicKey
    || !isUpdatePolicyKeyAllowedForChannel(keyId, channel))) {
    throw new Error('renewal signing key is not an embedded production key allowed for this channel');
  }
  const publicKeys = allowTestKey ? { [keyId]: signerPublicKey } : undefined;
  const nowMs = now().getTime();
  if (!Number.isFinite(nowMs)) throw new Error('renewal time is invalid');
  const issuedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + PLAN_LIFETIME_MS).toISOString();
  const replacements = [];

  for (const [version, currentKey] of Object.entries(control.plans)) {
    // Validate the pointer before reading anything it names.
    const prefix = `plans/${channel}/win32-x64/${version}/`;
    if (!/^\d+(?:\.\d+){2,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
      || typeof currentKey !== 'string' || currentKey.includes('..') || !currentKey.startsWith(prefix)
      || !/^[a-z0-9][a-z0-9._-]{0,159}\.json$/.test(currentKey.slice(prefix.length))) {
      throw new Error('active plan pointer is unsafe');
    }
    const current = await store.get(currentKey);
    if (!current) throw new Error(`active plan is missing for ${version}`);
    let plan;
    try { plan = JSON.parse(Buffer.from(current.body).toString('utf8')); }
    catch (_) { throw new Error(`active plan is not valid JSON for ${version}`); }
    if (currentKey !== planKey(channel, version, plan?.planId)) throw new Error('active plan pointer does not match its signed plan ID');

    const originalIssuedMs = Date.parse(plan?.issuedAt);
    // An expired plan may be renewed, but only after authenticating its
    // original signature AND its original bounded lifetime. No expired-plan
    // exception is added to the desktop verifier.
    const verified = policy.verifyUpdatePlan(plan, {
      currentVersion: version, channel, platform: 'win32', arch: 'x64', publicKeys,
      nowMs: originalIssuedMs,
    });
    if (!verified.ok || !Number.isFinite(originalIssuedMs) || originalIssuedMs > nowMs) {
      throw new Error(`active plan failed renewal verification for ${version}`);
    }
    if (Date.parse(plan.expiresAt) - nowMs > RENEW_BEFORE_MS) continue;
    if (originalIssuedMs >= nowMs) throw new Error('renewal must advance the signed issue time');
    const renewed = policy.signUpdatePlan({
      ...plan,
      planId: makePlanId(channel, version, plan.targetVersion, issuedAt),
      issuedAt, expiresAt,
    }, privateKey, { keyId });
    const fresh = policy.verifyUpdatePlan(renewed, {
      currentVersion: version, channel, platform: 'win32', arch: 'x64', publicKeys, nowMs,
    });
    if (!fresh.ok) throw new Error(`renewed plan failed verification for ${version}`);
    replacements.push({ version, key: planKey(channel, version, renewed.planId), plan: renewed, bytes: Buffer.from(JSON.stringify(renewed), 'utf8') });
  }

  if (dryRun || !replacements.length) return { channel, dryRun, renewed: replacements.length };
  if (typeof workerProbe !== 'function') throw new TypeError('renewal requires a Worker probe before switching control');
  for (const entry of replacements) {
    await store.putImmutable(entry.key, entry.bytes, JSON_OPTIONS);
    const stored = await store.get(entry.key);
    if (!stored || !Buffer.from(stored.body).equals(entry.bytes)) throw new Error('renewed plan read-back mismatch');
  }
  const nextControl = {
    ...control,
    plans: { ...control.plans, ...Object.fromEntries(replacements.map((entry) => [entry.version, entry.key])) },
  };
  const switched = await store.putControlIfMatch(pointerKey, Buffer.from(JSON.stringify(nextControl), 'utf8'), previous.etag, JSON_OPTIONS);
  if (!switched?.etag) throw new Error('renewal control changed concurrently; retry from the current pointer');
  try {
    for (const entry of replacements) {
      const received = await workerProbe({ version: entry.version, platform: 'win32', arch: 'x64', channel });
      if (!Buffer.from(received).equals(entry.bytes)) throw new Error('renewed Worker plan read-back mismatch');
    }
  } catch (error) {
    const restored = await store.putControlIfMatch(pointerKey, previous.body, switched.etag, JSON_OPTIONS);
    if (!restored?.etag) throw new Error('renewal probe failed; control changed concurrently and was not overwritten');
    throw error;
  }
  return { channel, dryRun: false, renewed: replacements.length };
}

module.exports = { PLAN_LIFETIME_MS, RENEW_BEFORE_MS, renewActivePlans };
