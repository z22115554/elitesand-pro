'use strict';

const assert = require('assert');
const { S3Client } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');
const test = require('node:test');
const {
  MAX_CONDITIONALLY_IMMUTABLE_PUT_BYTES,
  createR2S3Store,
} = require('../lib/r2-s3-store');

function createStore({ maxImmutablePutBytes, onSend = async () => ({ ETag: '"etag"' }) } = {}) {
  const commands = [];
  const store = createR2S3Store({
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
    bucket: 'elitesand-pro-updates',
    accessKeyId: 'release-access-key',
    secretAccessKey: 'release-secret-key',
    client: {
      async send(command) {
        commands.push(command);
        return onSend(command);
      },
    },
    ...(maxImmutablePutBytes == null ? {} : { maxImmutablePutBytes }),
  });
  return { commands, store };
}

test('immutable R2 upload always uses conditional PutObject, including bytes above the old multipart threshold', async () => {
  const { commands, store } = createStore();
  const body = Buffer.alloc(6 * 1024 * 1024, 0x61);
  const result = await store.putImmutable('artifacts/stable/0.9.9.7/0.9.9.8/update.zip', body, {
    contentType: 'application/zip',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  assert.deepStrictEqual(result, { etag: '"etag"' });
  assert.strictEqual(commands.length, 1);
  assert.strictEqual(commands[0].constructor.name, 'PutObjectCommand');
  assert.strictEqual(commands[0].input.IfNoneMatch, '*');
  assert.deepStrictEqual(commands[0].input.Body, body);
});

test('publisher fails closed rather than using multipart where R2 cannot honor an immutable precondition', async () => {
  const { commands, store } = createStore({ maxImmutablePutBytes: 10 });
  await assert.rejects(
    () => store.putImmutable('artifacts/stable/0.9.9.7/0.9.9.8/update.zip', Buffer.alloc(11)),
    /conditionally safe upload limit/,
  );
  assert.strictEqual(commands.length, 0);
  assert.strictEqual(MAX_CONDITIONALLY_IMMUTABLE_PUT_BYTES, 5 * 1024 * 1024 * 1024);
});

test('the S3 SDK serializes the immutable precondition onto the actual PUT request', async () => {
  let request = null;
  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
    forcePathStyle: true,
    credentials: { accessKeyId: 'release-access-key', secretAccessKey: 'release-secret-key' },
    requestHandler: {
      async handle(nextRequest) {
        request = nextRequest;
        return { response: { statusCode: 200, headers: { etag: '"etag"' }, body: Readable.from([]) } };
      },
    },
  });
  const serializedStore = createR2S3Store({
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
    bucket: 'elitesand-pro-updates',
    accessKeyId: 'release-access-key',
    secretAccessKey: 'release-secret-key',
    client,
  });
  await serializedStore.putImmutable('plans/stable/win32-x64/0.9.9.7/plan.json', Buffer.from('signed plan'));
  assert.ok(request);
  assert.strictEqual(request.method, 'PUT');
  assert.strictEqual(request.headers['if-none-match'], '*');
});

test('R2 precondition conflicts are reported as immutable-key failures', async () => {
  const { store } = createStore({
    onSend: async () => {
      const error = new Error('precondition failed');
      error.name = 'PreconditionFailed';
      error.$metadata = { httpStatusCode: 412 };
      throw error;
    },
  });
  await assert.rejects(
    () => store.putImmutable('artifacts/stable/0.9.9.7/0.9.9.8/update.zip', Buffer.from('zip')),
    /immutable R2 key already exists/,
  );
});

test('beta retention listing only uses the requested prefix and completes paginated R2 listings', async () => {
  const { commands, store } = createStore({
    onSend: async (command) => {
      assert.strictEqual(command.constructor.name, 'ListObjectsV2Command');
      if (!command.input.ContinuationToken) {
        return { Contents: [{ Key: 'artifacts/beta/0.9.9.7/0.9.9.8/update.zip' }], IsTruncated: true, NextContinuationToken: 'next' };
      }
      return { Contents: [{ Key: 'artifacts/beta/0.9.9.8/0.9.9.9/update.zip' }], IsTruncated: false };
    },
  });
  assert.deepStrictEqual(await store.listPrefix('artifacts/beta/'), [
    'artifacts/beta/0.9.9.7/0.9.9.8/update.zip',
    'artifacts/beta/0.9.9.8/0.9.9.9/update.zip',
  ]);
  assert.strictEqual(commands.length, 2);
  assert.strictEqual(commands[0].input.Prefix, 'artifacts/beta/');
  assert.strictEqual(commands[1].input.ContinuationToken, 'next');
});
