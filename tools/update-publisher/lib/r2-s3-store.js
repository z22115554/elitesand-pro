'use strict';

// R2's S3-compatible PutObject supports If-None-Match, but its documented
// multipart create/complete operations do not.  The signed app policy caps an
// incremental ZIP at 384 MiB, far below this 5 GiB single-PUT boundary.  Keep
// the release transaction on the conditional operation so an immutable key
// can never be overwritten; fail closed rather than silently losing that
// guarantee to multipart's unsupported precondition.
const MAX_CONDITIONALLY_IMMUTABLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;

function loadS3() {
  // This dependency is local to the release tool, never the packaged app.
  return require('@aws-sdk/client-s3');
}

function isR2Endpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /\.r2\.cloudflarestorage\.com$/i.test(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch (_) {
    return false;
  }
}

async function streamToBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function isMissing(error) {
  return error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
}

function isPrecondition(error) {
  return error?.name === 'PreconditionFailed' || error?.$metadata?.httpStatusCode === 412;
}

function createR2S3Store({
  endpoint,
  bucket,
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  client = null,
  maxImmutablePutBytes = MAX_CONDITIONALLY_IMMUTABLE_PUT_BYTES,
} = {}) {
  if (!isR2Endpoint(endpoint)) throw new Error('R2 endpoint must be the exact HTTPS account endpoint');
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/i.test(String(bucket || ''))) throw new Error('R2 bucket name is invalid');
  if (!String(accessKeyId || '').trim() || !String(secretAccessKey || '').trim()) throw new Error('release-only R2 credentials are required');
  if (!Number.isSafeInteger(maxImmutablePutBytes) || maxImmutablePutBytes < 1 || maxImmutablePutBytes > MAX_CONDITIONALLY_IMMUTABLE_PUT_BYTES) {
    throw new Error('max immutable object size is invalid');
  }
  const s3 = loadS3();
  const s3Client = client || new s3.S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  async function get(key) {
    try {
      const result = await s3Client.send(new s3.GetObjectCommand({ Bucket: bucket, Key: key }));
      return { body: await streamToBuffer(result.Body), etag: result.ETag || null };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async function putImmutable(key, body, options = {}) {
    const bytes = Buffer.from(body);
    if (!bytes.length) throw new Error(`refusing to upload an empty immutable object: ${key}`);
    if (bytes.length > maxImmutablePutBytes) {
      throw new Error(`immutable R2 object exceeds the conditionally safe upload limit: ${key}`);
    }
    try {
      const result = await s3Client.send(new s3.PutObjectCommand({
        Bucket: bucket, Key: key, Body: bytes, IfNoneMatch: '*', ContentType: options.contentType, CacheControl: options.cacheControl,
      }));
      return { etag: result.ETag || null };
    } catch (error) {
      if (isPrecondition(error)) throw new Error(`immutable R2 key already exists: ${key}`);
      throw error;
    }
  }

  async function putControlIfMatch(key, body, etag, options = {}) {
    if (!etag) throw new Error('an existing control ETag is required');
    try {
      const result = await s3Client.send(new s3.PutObjectCommand({
        Bucket: bucket, Key: key, Body: Buffer.from(body), IfMatch: etag, ContentType: options.contentType, CacheControl: options.cacheControl,
      }));
      return { etag: result.ETag || null };
    } catch (error) {
      if (isPrecondition(error)) return null;
      throw error;
    }
  }

  return Object.freeze({ get, putImmutable, putControlIfMatch });
}

module.exports = { MAX_CONDITIONALLY_IMMUTABLE_PUT_BYTES, createR2S3Store, isR2Endpoint };
