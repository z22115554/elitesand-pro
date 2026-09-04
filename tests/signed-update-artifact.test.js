'use strict';

const assert = require('assert');
const crypto = require('crypto');
const test = require('node:test');
const {
  assertIncrementalArtifactPlan,
  downloadSignedIncrementalArtifact,
} = require('../server/services/signed-update-artifact');
const { UPDATE_ARTIFACT_ORIGIN } = require('../server/services/update-policy');

function makePlan(bytes, overrides = {}) {
  return {
    channel: 'stable',
    fromVersion: '0.9.9.7',
    targetVersion: '0.9.9.8',
    delivery: 'incremental',
    artifact: {
      url: `${UPDATE_ARTIFACT_ORIGIN}/artifacts/stable/0.9.9.7/0.9.9.8/update.zip`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    },
    ...overrides,
  };
}

function response(bytes, { status = 200, contentLength = bytes.length } = {}) {
  return {
    status,
    headers: { get: (name) => String(name).toLowerCase() === 'content-length' && contentLength != null ? String(contentLength) : null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, Math.ceil(bytes.length / 2)));
        controller.enqueue(bytes.subarray(Math.ceil(bytes.length / 2)));
        controller.close();
      },
    }),
  };
}

test('signed incremental artifact downloads exactly one policy-bound stream and verifies its bytes', async () => {
  const bytes = Buffer.from('zip payload from trusted signed policy');
  let call = null;
  const artifact = await downloadSignedIncrementalArtifact(makePlan(bytes), {
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(bytes);
    },
  });
  assert.strictEqual(artifact.buffer.compare(bytes), 0);
  assert.strictEqual(artifact.size, bytes.length);
  assert.strictEqual(call.url, `${UPDATE_ARTIFACT_ORIGIN}/artifacts/stable/0.9.9.7/0.9.9.8/update.zip`);
  assert.strictEqual(call.options.method, 'GET');
  assert.strictEqual(call.options.redirect, 'error');
});

test('artifact transport fails closed on origin, status, length, truncation, or hash mismatch', async () => {
  const bytes = Buffer.from('signed bytes');
  const goodPlan = makePlan(bytes);
  assert.throws(() => assertIncrementalArtifactPlan(makePlan(bytes, {
    artifact: { ...goodPlan.artifact, url: 'https://evil.example/update.zip' },
  })), /URL is invalid/);
  await assert.rejects(() => downloadSignedIncrementalArtifact(goodPlan, { fetchImpl: async () => response(bytes, { status: 302 }) }), /HTTP 302/);
  await assert.rejects(() => downloadSignedIncrementalArtifact(goodPlan, { fetchImpl: async () => response(bytes, { contentLength: bytes.length + 1 }) }), /Content-Length/);
  await assert.rejects(() => downloadSignedIncrementalArtifact(makePlan(Buffer.concat([bytes, Buffer.from('x')])), {
    fetchImpl: async () => response(bytes, { contentLength: null }),
  }), /size does not match/);
  await assert.rejects(() => downloadSignedIncrementalArtifact(makePlan(bytes, {
    artifact: { ...goodPlan.artifact, sha256: '0'.repeat(64) },
  }), { fetchImpl: async () => response(bytes) }), /SHA-256/);
});
