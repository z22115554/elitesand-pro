'use strict';

const crypto = require('crypto');

function etag(bytes, revision) {
  return `"${crypto.createHash('sha256').update(bytes).update(String(revision)).digest('hex').slice(0, 24)}"`;
}

function createFakeR2Endpoint({ controlKey, control = { schemaVersion: 1, disabled: false, plans: {} }, fail = null } = {}) {
  const objects = new Map();
  const calls = [];
  let revision = 0;
  function save(key, body) {
    const bytes = Buffer.from(body);
    const value = { body: bytes, etag: etag(bytes, ++revision) };
    objects.set(key, value);
    return value;
  }
  if (controlKey) save(controlKey, Buffer.from(JSON.stringify(control), 'utf8'));
  return {
    calls,
    get(key) {
      calls.push(['get', key]);
      const value = objects.get(key);
      return value ? { body: Buffer.from(value.body), etag: value.etag } : null;
    },
    putImmutable(key, body) {
      calls.push(['putImmutable', key]);
      if (typeof fail === 'function') fail('putImmutable', key);
      if (objects.has(key)) throw new Error(`immutable R2 key already exists: ${key}`);
      return { etag: save(key, body).etag };
    },
    putControlIfMatch(key, body, ifMatch) {
      calls.push(['putControlIfMatch', key, ifMatch]);
      if (typeof fail === 'function') fail('putControlIfMatch', key);
      const current = objects.get(key);
      if (!current || current.etag !== ifMatch) return null;
      return { etag: save(key, body).etag };
    },
    object(key) {
      const value = objects.get(key);
      return value ? { body: Buffer.from(value.body), etag: value.etag } : null;
    },
  };
}

module.exports = { createFakeR2Endpoint };
