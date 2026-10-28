'use strict';

// Vulnerability probes run only against a disposable loopback child process.
// A regression must fail this test, never terminate the main test runner.
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');

if (process.env.ELITESAND_SECURITY_FIXTURE_CHILD === '1') {
  const express = require('express');
  const multer = require('multer');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 200 }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/parse', (req, res) => res.json(req.body));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 4, fileSize: 16384 },
    fileFilter: (_req, file, cb) => {
      if (file.originalname === 'pending.wav') setTimeout(() => cb(null, true), 100);
      else if (file.originalname.endsWith('.wav')) cb(null, true);
      else cb(new Error('Rejected file'));
    },
  });
  app.post('/upload', upload.array('files'), (req, res) => res.json({ files: req.files.length }));
  // Exercise a parked file stream resuming after the parser's teardown.
  // Based on the upstream regression scenario, in a disposable child only:
  // https://github.com/expressjs/multer/commit/80a2d9d
  app.post('/late-filter', (_req, res) => {
    const { PassThrough } = require('node:stream');
    const input = new PassThrough();
    let parser, release, calls = 0;
    const boundary = 'SecurityRegressionBoundary';
    const body = ['pending.wav', 'rejected.exe'].map((name, i) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${i}"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\nx`
    ).join('\r\n'); // Deliberately missing the closing multipart boundary.
    const parse = multer({
      fileHwm: 1,
      streamHandler: (request, stream) => { parser = stream; request.pipe(stream); },
      fileFilter: (request, file, cb) => {
        if (file.originalname === 'pending.wav') release = cb;
        else request.once('end', () => setImmediate(() => cb(new Error('Rejected file'))));
      },
    }).any();
    input.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': Buffer.byteLength(body) };
    parse(input, null, error => {
      calls++;
      if (!error || !release) return res.status(500).end();
      setImmediate(() => {
        parser.once('close', () => res.json({ rejected: true, calls }));
        release(null, true);
      });
    });
    input.end(body);
  });
  app.use((_error, _req, res, _next) => res.status(400).json({ rejected: true }));
  const server = app.listen(0, '127.0.0.1', () => console.log(`SECURITY_FIXTURE_PORT=${server.address().port}`));
} else {
  const test = require('node:test');
  const { spawn } = require('node:child_process');
  let child, base, output = '';
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  test.before(async () => {
    child = spawn(process.execPath, [__filename], {
      env: { ...process.env, ELITESAND_SECURITY_FIXTURE_CHILD: '1' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    for (let i = 0; i < 100; i++) {
      const match = output.match(/SECURITY_FIXTURE_PORT=(\d+)/);
      if (match) { base = `http://127.0.0.1:${match[1]}`; return; }
      if (child.exitCode !== null) throw new Error(`Fixture exited: ${output}`);
      await delay(30);
    }
    throw new Error(`Fixture did not start: ${output}`);
  });
  test.after(() => { child?.kill(); });

  const assertAlive = async () => {
    await delay(200); // Exercise late callbacks and decompressor errors.
    assert.equal(child.exitCode, null, output);
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  };

  test('qs comma arrays tolerate non-callable own toString values (GHSA-6pq8-jhm2-2vcw)', () => {
    const qs = require('qs');
    for (const value of [null, false, 1, 'not callable', {}]) {
      assert.doesNotThrow(() => qs.stringify({ items: [{ toString: value }] }, { arrayFormat: 'comma' }));
    }
    assert.equal(qs.stringify({ items: ['a', 'b'] }, { arrayFormat: 'comma' }), 'items=a%2Cb');
  });

  test('valid JSON and form bodies still work, including compressed JSON', async () => {
    for (const [type, body] of [['application/json', '{"title":"歌曲"}'], ['application/x-www-form-urlencoded', 'title=song']]) {
      const response = await fetch(`${base}/parse`, { method: 'POST', headers: { 'Content-Type': type }, body });
      assert.equal(response.status, 200);
      assert.ok((await response.json()).title);
    }
    const response = await fetch(`${base}/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: zlib.gzipSync(Buffer.from('{"title":"compressed song"}')),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).title, 'compressed song');
  });

  test('trailing bytes after a compressed body cannot terminate the server (GHSA-27r3-jxmh-p828)', async () => {
    for (const [type, body] of [['application/json', '{"title":"song"}'], ['application/x-www-form-urlencoded', 'title=song']]) {
      await new Promise((resolve, reject) => {
        // A zero after the complete gzip frame makes the decoder finish early;
        // trailing data must arrive after raw-body removes its error listener.
        const payload = Buffer.concat([zlib.gzipSync(Buffer.from(body)), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
        const req = http.request(`${base}/parse`, {
          method: 'POST', headers: { 'Content-Type': type, 'Content-Encoding': 'gzip', 'Content-Length': payload.length },
        }, res => {
          res.resume();
          res.on('end', () => {
            if (![200, 400].includes(res.statusCode)) reject(new Error(`Unexpected status ${res.statusCode}`));
            else resolve();
          });
        });
        req.once('error', reject);
        req.setTimeout(3000, () => req.destroy(new Error('Compressed request timed out')));
        req.end(payload);
      });
      await assertAlive();
    }
  });

  test('rejecting an upload while an async filter is pending cannot crash the server (GHSA-q7qp-rjg7-q26m)', async () => {
    const response = await fetch(`${base}/late-filter`, { method: 'POST', signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { rejected: true, calls: 1 });
    await assertAlive();
  });

  test('valid uploads still succeed after rejected uploads', async () => {
    const form = new FormData(); form.append('files', new Blob(['audio']), 'accepted.wav');
    const response = await fetch(`${base}/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { files: 1 });
    await assertAlive();
  });
}
