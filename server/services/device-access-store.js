'use strict';

// Device-scoped access material.  Controller secrets are never written to disk:
// only their SHA-256 hashes are retained so a copied data directory does not
// become a list of usable phone credentials.
const crypto = require('crypto');
const path = require('path');
const { dataDir } = require('../utils/app-paths');
const { createJsonStore } = require('./json-store');
const { createLogger } = require('../utils/logger');

const log = createLogger('DeviceAccess');
const ACCESS_FILE = path.join(dataDir, 'device-access.json');
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_CONTROLLERS = 32;

const diskStore = createJsonStore({
  file: ACCESS_FILE,
  label: 'device access credentials',
  defaultValue: null,
  mode: 0o600,
  pretty: true,
  serialize: (value) => ({ credentials: value }),
  deserialize: (document) => document.credentials,
  validate: (document) => {
    const value = document.credentials;
    return !!value && typeof value === 'object'
      && typeof value.deviceKey === 'string'
      && typeof value.sourceToken === 'string'
      && Number.isInteger(value.deviceKeyVersion)
      && Array.isArray(value.controllers);
  },
  logger: log,
});

let credentials = null;
let loaded = false;
const pendingPairings = new Map();

function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest();
}

function equalHash(expected, actual) {
  if (!expected || typeof actual !== 'string' || !actual) return false;
  const a = Buffer.from(expected, 'hex');
  const b = hash(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function freshCredentials() {
  return {
    deviceKey: token(),
    deviceKeyVersion: 1,
    sourceToken: token(),
    controllers: [],
  };
}

function ensureLoaded() {
  if (loaded) return;
  credentials = diskStore.load();
  if (!credentials) {
    credentials = freshCredentials();
    if (!diskStore.save(credentials)) throw new Error('Unable to create device access credentials');
    log.info('Generated device access credentials');
  }
  loaded = true;
}

function persist() {
  if (!diskStore.save(credentials)) throw new Error('Unable to save device access credentials');
}

function cleanupPending(now = Date.now()) {
  for (const [id, pairing] of pendingPairings) {
    if (pairing.expiresAt <= now) pendingPairings.delete(id);
  }
}

function initialize() {
  ensureLoaded();
}

function createPairing() {
  ensureLoaded();
  cleanupPending();
  const id = token(12);
  const secret = token(24);
  pendingPairings.set(id, { secretHash: hash(secret).toString('hex'), expiresAt: Date.now() + PAIRING_TTL_MS });
  return { code: `${id}.${secret}`, expiresAt: Date.now() + PAIRING_TTL_MS };
}

function redeemPairing(code) {
  ensureLoaded();
  cleanupPending();
  const [id, secret, ...extra] = String(code || '').split('.');
  if (!id || !secret || extra.length || !/^[A-Za-z0-9_-]{8,}$/.test(id)) return null;
  const pairing = pendingPairings.get(id);
  // Consume before issuing a credential: concurrent submissions cannot both win.
  pendingPairings.delete(id);
  if (!pairing || pairing.expiresAt <= Date.now() || !equalHash(pairing.secretHash, secret)) return null;

  const controllerToken = token();
  credentials.controllers.push({
    id: token(10),
    tokenHash: hash(controllerToken).toString('hex'),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  });
  if (credentials.controllers.length > MAX_CONTROLLERS) {
    credentials.controllers.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
    credentials.controllers.length = MAX_CONTROLLERS;
  }
  persist();
  return controllerToken;
}

function verifyControllerToken(value) {
  ensureLoaded();
  const record = credentials.controllers.find((item) => equalHash(item.tokenHash, value));
  if (!record) return false;
  // Avoid a disk write for every slider event, while retaining useful revoke/audit metadata.
  if (!record.lastUsedAt || Date.now() - record.lastUsedAt > 60 * 60 * 1000) {
    record.lastUsedAt = Date.now();
    try { persist(); } catch (error) { log.warn(`Unable to update controller last-used time: ${error.message}`); }
  }
  return true;
}

function verifySourceToken(value) {
  ensureLoaded();
  return typeof value === 'string' && value.length >= 24
    && crypto.timingSafeEqual(hash(credentials.sourceToken), hash(value));
}

function revokeControllers() {
  ensureLoaded();
  const revoked = credentials.controllers.length;
  // Regenerate the private device key as well as deleting every token hash.
  credentials.deviceKey = token();
  credentials.deviceKeyVersion += 1;
  credentials.controllers = [];
  pendingPairings.clear();
  persist();
  log.info(`Revoked ${revoked} paired controller(s)`);
  return { revoked, deviceKeyVersion: credentials.deviceKeyVersion };
}

function getLocalStatus() {
  ensureLoaded();
  cleanupPending();
  return {
    controllerCount: credentials.controllers.length,
    deviceKeyVersion: credentials.deviceKeyVersion,
    sourceToken: credentials.sourceToken,
  };
}

module.exports = {
  PAIRING_TTL_MS,
  initialize,
  createPairing,
  redeemPairing,
  verifyControllerToken,
  verifySourceToken,
  revokeControllers,
  getLocalStatus,
  _resetForTests() { credentials = null; loaded = false; pendingPairings.clear(); },
};
