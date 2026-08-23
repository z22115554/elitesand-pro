'use strict';

const { Readable } = require('stream');

const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;

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

function createR2S3Store({ endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto', client = null } = {}) {
  if (!isR2Endpoint(endpoint)) throw new Error('R2 endpoint must be the exact HTTPS account endpoint');
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/i.test(String(bucket || ''))) throw new Error('R2 bucket name is invalid');
  if (!String(accessKeyId || '').trim() || !String(secretAccessKey || '').trim()) throw new Error('release-only R2 credentials are required');
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

  async function putMultipartImmutable(key, bytes, options) {
    let uploadId = null;
    try {
      const started = await s3Client.send(new s3.CreateMultipartUploadCommand({
        Bucket: bucket, Key: key, IfNoneMatch: '*', ContentType: options.contentType, CacheControl: options.cacheControl,
      }));
      uploadId = started.UploadId;
      if (!uploadId) throw new Error('R2 multipart upload did not return an upload id');
      const parts = [];
      for (let offset = 0, partNumber = 1; offset < bytes.length; offset += MULTIPART_PART_SIZE, partNumber++) {
        const Body = bytes.subarray(offset, Math.min(offset + MULTIPART_PART_SIZE, bytes.length));
        const result = await s3Client.send(new s3.UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body }));
        if (!result.ETag) throw new Error(`R2 multipart upload did not return an ETag for part ${partNumber}`);
        parts.push({ ETag: result.ETag, PartNumber: partNumber });
      }
      const completed = await s3Client.send(new s3.CompleteMultipartUploadCommand({
        Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts },
      }));
      return { etag: completed.ETag || null };
    } catch (error) {
      if (uploadId) {
        try { await s3Client.send(new s3.AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })); } catch (_) { /* preserve original failure */ }
      }
      if (isPrecondition(error)) throw new Error(`immutable R2 key already exists: ${key}`);
      throw error;
    }
  }

  async function putImmutable(key, body, options = {}) {
    const bytes = Buffer.from(body);
    if (!bytes.length) throw new Error(`refusing to upload an empty immutable object: ${key}`);
    if (bytes.length >= MULTIPART_THRESHOLD) return putMultipartImmutable(key, bytes, options);
    try {
      const result = await s3Client.send(new s3.PutObjectCommand({
        Bucket: bucket, Key: key, Body: Readable.from(bytes), IfNoneMatch: '*', ContentType: options.contentType, CacheControl: options.cacheControl,
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

module.exports = { MULTIPART_PART_SIZE, MULTIPART_THRESHOLD, createR2S3Store, isR2Endpoint };
