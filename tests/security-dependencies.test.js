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

  test('build glob preprocessing cannot exhaust a bounded child (GHSA-g3hv-75wg-m249)', () => {
    const { spawnSync } = require('node:child_process');
    const probe = `
      const { Minimatch } = require('minimatch');
      const matcher = new Minimatch('x/**/../'.repeat(20) + 'target', { optimizationLevel: 2 });
      if (matcher.match('not-selected')) process.exit(2);
      process.stdout.write('completed');
    `;
    const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', probe], {
      cwd: require('node:path').join(__dirname, '..'),
      timeout: 5000, encoding: 'utf8', maxBuffer: 256 * 1024, windowsHide: true,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `Glob probe exited with ${result.signal}: ${result.stderr}`);
    assert.equal(result.stdout, 'completed');
  });

  test('patched build globs preserve application inclusion and exclusions', () => {
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
    const config = require('../package.json').build;
    const root = path.resolve('包裝驗證');
    const [matcher] = getMainFileMatchers(root, path.join(root, 'dist', 'app'), value => value, {}, {
      info: { projectDir: root, config, buildResourcesDir: 'build', debugLogger: { isEnabled: false } },
    }, path.join(root, 'dist'), false);
    const filter = matcher.createFilter();
    for (const [relative, directory, expected] of [
      ['server/index.js', false, true], ['electron/main.js', false, true],
      ['public/歌詞.png', false, true], ['assets/icon.png', false, true],
      ['ai/private.py', false, false], ['dist/old-app/index.js', false, false],
      ['.git', true, false], ['.DS_Store', false, false], ['src/._metadata', false, false],
    ]) {
      assert.equal(filter(path.join(root, relative), { isDirectory: () => directory }), expected, relative);
    }
    // The other affected consumer uses the named function and matchBase option.
    const universalRequire = createRequire(require.resolve('@electron/universal'));
    const { minimatch } = universalRequire('minimatch');
    assert.equal(minimatch('Contents/MacOS/app', 'app', { matchBase: true }), true);
    assert.equal(minimatch('Contents/Info.plist', '*.{plist,json}', { matchBase: true }), true);
    assert.equal(minimatch('Contents/Info.plist', '*.node', { matchBase: true }), false);
  });

  test('valid uploads still succeed after rejected uploads', async () => {
    const form = new FormData(); form.append('files', new Blob(['audio']), 'accepted.wav');
    const response = await fetch(`${base}/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { files: 1 });
    await assertAlive();
  });
}

