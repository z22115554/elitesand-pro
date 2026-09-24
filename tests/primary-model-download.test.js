'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const pmd = require('../server/services/primary-model-download');

const PAYLOAD = crypto.randomBytes(256 * 1024);
const SHA = crypto.createHash('sha256').update(PAYLOAD).digest('hex');

function startServer(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => { requests.push({ url: req.url, range: req.headers.range }); handler(req, res); });
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function serveRange(req, res, body = PAYLOAD) {
  const match = /bytes=(\d+)-/.exec(req.headers.range || '');
  if (!match) { res.writeHead(200, { 'Content-Length': body.length }); res.end(body); return; }
  const start = Number(match[1]);
  res.writeHead(206, { 'Content-Length': body.length - start, 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` });
  res.end(body.subarray(start));
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-pmd-'));
}

function spec(sources, overrides = {}) {
  return { filename: 'model.ckpt', size: PAYLOAD.length, sha256: SHA, sources, ...overrides };
}

test('embedded yaml is byte-identical to the pinned upstream file', () => {
  assert.equal(crypto.createHash('sha256').update(pmd.YAML_TEXT, 'utf8').digest('hex'), pmd.YAML_SHA256);
});

test('support files are written once and never overwrite existing ones', () => {
  const dir = tmpDir();
  try {
    pmd.ensureSupportFiles(dir);
    const checks = JSON.parse(fs.readFileSync(path.join(dir, pmd.DOWNLOAD_CHECKS_FILENAME), 'utf8'));
    assert.deepEqual(Object.keys(checks).sort(), [...pmd.DOWNLOAD_CHECKS_KEYS].sort());
    assert.ok(Object.values(checks).every((v) => JSON.stringify(v) === '{}'));
    fs.writeFileSync(path.join(dir, pmd.DOWNLOAD_CHECKS_FILENAME), '{"real":true}');
    pmd.ensureSupportFiles(dir);
    assert.equal(fs.readFileSync(path.join(dir, pmd.DOWNLOAD_CHECKS_FILENAME), 'utf8'), '{"real":true}');
    assert.equal(fs.readFileSync(path.join(dir, pmd.YAML_FILENAME), 'utf8'), pmd.YAML_TEXT);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('resumes from an existing partial file and follows redirects with Range intact', async () => {
  const { server, requests, base } = await startServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/file' }); res.end(); return; }
    serveRange(req, res);
  });
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'model.ckpt' + pmd.RESUME_SUFFIX), PAYLOAD.subarray(0, 100000));
    const result = await pmd.downloadPrimaryModelFile(dir, { file: spec([{ label: 'A', url: `${base}/redirect` }]), httpsGet: http.get });
    assert.equal(result.source, 'A');
    assert.deepEqual(requests.map((r) => r.range), ['bytes=100000-', 'bytes=100000-']);
    assert.ok(fs.readFileSync(path.join(dir, 'model.ckpt')).equals(PAYLOAD));
    assert.equal(fs.existsSync(path.join(dir, 'model.ckpt' + pmd.RESUME_SUFFIX)), false);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('falls back to the next source when one fails, and rewrites when Range is ignored', async () => {
  const { server, base } = await startServer((req, res) => {
    if (req.url === '/broken') { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { 'Content-Length': PAYLOAD.length });
    res.end(PAYLOAD);
  });
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'model.ckpt' + pmd.RESUME_SUFFIX), Buffer.alloc(5000, 7));
    const result = await pmd.downloadPrimaryModelFile(dir, {
      file: spec([{ label: 'Broken', url: `${base}/broken` }, { label: 'Good', url: `${base}/file` }]),
      httpsGet: http.get,
    });
    assert.equal(result.source, 'Good');
    assert.ok(fs.readFileSync(path.join(dir, 'model.ckpt')).equals(PAYLOAD));
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('a hash mismatch never becomes the real model', async () => {
  const wrong = Buffer.alloc(PAYLOAD.length, 1);
  const { server, base } = await startServer((req, res) => serveRange(req, res, wrong));
  const dir = tmpDir();
  try {
    await assert.rejects(
      pmd.downloadPrimaryModelFile(dir, { file: spec([{ label: 'Evil', url: `${base}/file` }]), httpsGet: http.get }),
      (error) => error.code === 'ALL_SOURCES_FAILED' && /SHA-256/.test(error.message),
    );
    assert.equal(fs.existsSync(path.join(dir, 'model.ckpt')), false);
    assert.equal(fs.existsSync(path.join(dir, 'model.ckpt' + pmd.RESUME_SUFFIX)), false);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test('cancelling keeps the partial file for the next attempt', async () => {
  const controller = new AbortController();
  const { server, base } = await startServer((req, res) => {
    res.writeHead(206, { 'Content-Length': PAYLOAD.length - 40000, 'Content-Range': `bytes 40000-${PAYLOAD.length - 1}/${PAYLOAD.length}` });
    res.write(PAYLOAD.subarray(40000, 60000), () => setTimeout(() => controller.abort(), 50));
  });
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'model.ckpt' + pmd.RESUME_SUFFIX), PAYLOAD.subarray(0, 40000));
    await assert.rejects(
      pmd.downloadPrimaryModelFile(dir, { file: spec([{ label: 'A', url: `${base}/file` }]), httpsGet: http.get, abortSignal: controller.signal }),
      (error) => error.code === 'CANCELLED',
    );
    assert.equal(fs.existsSync(path.join(dir, 'model.ckpt')), false);
    const kept = fs.readFileSync(path.join(dir, 'model.ckpt' + pmd.RESUME_SUFFIX));
    assert.ok(kept.length >= 40000);
    assert.ok(kept.equals(PAYLOAD.subarray(0, kept.length)));
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true });
  }
});
