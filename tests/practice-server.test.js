'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const projectRoot = process.env.ELITESAND_PRACTICE_STAGING_PATH
  ? path.resolve(process.env.ELITESAND_PRACTICE_STAGING_PATH) : path.resolve(__dirname, '..');
const bootstrap = `
  const config = require('./server/utils/load-config');
  Object.assign(config, { updateCheckRepo:'', announcementUrl:'', anonymousUsageEnabled:false,
    usageEndpoint:'', usageDailyEndpoint:'', lyricOffsetSyncEnabled:false,
    lyricOffsetEndpoint:'', songRequestRelayEnabled:false, songRequestRelayUrl:'', twitchClientId:'' });
  const { server } = require('./server/index');
  // The managed test host exposes only loopback. Exercise real production LAN
  // authentication through the real HTTP server with a secret fixture marker;
  // no application route or authentication middleware is substituted.
  server.prependListener('request', request => {
    const address = request.headers['x-practice-test-identity'] === process.env.PRACTICE_TEST_IDENTITY
      ? '192.0.2.40' : '127.0.0.1';
    Object.defineProperty(request.socket, 'remoteAddress', { value:address, configurable:true });
  });
  server.once('listening', () => process.send({ type:'ready', port:server.address().port }));
`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'practice-server-'));
  const data = path.join(root, 'data'), downloads = path.join(root, 'downloads');
  await fs.mkdir(path.join(data, 'pitch-guides'), { recursive: true });
  await fs.mkdir(downloads);
  const trackId = 'server-practice', source = Buffer.from('isolated cached vocal fixture');
  const fingerprint = crypto.createHash('sha256').update(source).digest('hex');
  const guideId = crypto.createHash('sha256').update('server-guide').digest('hex');
  await fs.writeFile(path.join(downloads, 'vocal.wav'), source);
  await fs.writeFile(path.join(data, 'library.json'), JSON.stringify({ schemaVersion: 2, entries: {
    [trackId]: { id: trackId, title: 'Isolated practice', vocalsFile: 'vocal.wav', separationStatus: 'done' },
  } }));
  // 這首歌在媒體庫裡沒有歌詞、也沒有偏移：伺服器算出的歌詞指紋必須跟這份快取一致才會被採用
  const { lyricsKeyFor, sanitizeLyrics } = require(path.join(projectRoot, 'server/services/practice-guide-service'));
  const guide = { schemaVersion: 2, algorithmVersion: 'practice-pitch-2', algorithm: 'yin-cpu',
    requestedAlgorithm: 'auto', trackId, guideId, sourceFingerprint: fingerprint, lyricsKey: lyricsKeyFor(sanitizeLyrics({ lines: [], offsetMs: 0 })),
    duration: 2, hopSeconds: .01, contourSeconds: .02, sampleRate: 16000, tuning: 0, lyricOffsetMs: 0, voicedSeconds: 2,
    contour: Array.from({ length: 100 }, (_, i) => [Math.round(i * 2) / 100, 69]), lines: [],
    notes: [{ start: 0, end: 2, midi: 69, raw: 69, line: 0, word: 0, cont: false }], createdAt: new Date().toISOString() };
  await fs.writeFile(path.join(data, 'pitch-guides', crypto.createHash('sha256').update(trackId).digest('hex') + '.json'), JSON.stringify(guide));
  const identity = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, ['-e', bootstrap], { cwd: projectRoot,
    env: { ...process.env, PORT: '0', OPEN_BROWSER: '0', ELITESAND_DATA_DIR: data,
      ELITESAND_DOWNLOADS_DIR: downloads, ELITESAND_LOGS_DIR: path.join(root, 'logs'),
      ELITESAND_DISABLE_ANNOUNCEMENTS: '1', ELITESAND_INSTALL_ROOT: '', ELITESAND_PACKAGED: '0',
      ELITESAND_YTDLP_PATH: path.join(root, 'no-ytdlp'), ELITESAND_YTDLP_PROBE_URL: 'http://127.0.0.1:1/disabled',
      PRACTICE_TEST_IDENTITY: identity }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-40000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.send({ type: 'elitesand:shutdown' });
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 9000); timer.unref();
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start:\n' + output)), 15000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited ' + code + ':\n' + output)); });
    child.on('message', message => { if (message?.type === 'ready') { clearTimeout(timer); resolve(message.port); } });
  });
  const request = (route, { lan = false, method = 'GET', headers = {}, body } = {}) => fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers: { Connection: 'close', ...(lan ? { 'x-practice-test-identity': identity } : {}),
      ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  return { request, root, data, trackId, guideId };
}

test('complete server applies microphone policy to panel only and protects both OBS aliases before static delivery', { timeout: 30000 }, async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/health')).status, 200);
  for (const route of ['/', '/panel', '/panel/', '/PANEL', '/index.html']) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('permissions-policy'), /microphone=\(self\)/, route);
    assert.match(await response.text(), /id="view-practice"/, route);
  }
  for (const route of ['/controller', '/display', '/setlist', '/practice-overlay', '/practice-overlay.html']) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('permissions-policy'), /microphone=\(\)/, route);
  }
  const status = await (await request('/api/access/status')).json();
  assert.ok(status.sourceToken);
  const sourceRoutes = ['/practice-overlay', '/practice-overlay.html', '/%70ractice-overlay.html', '/practice-overlay%2ehtml', '/%2fpractice-overlay.html', '/PRACTICE-OVERLAY'];
  const deniedStatuses = [];
  for (const route of sourceRoutes) {
    const denied = await request(route, { lan: true });
    deniedStatuses.push({ route, status: denied.status });
    if (denied.status === 401) assert.equal((await denied.json()).code, 'SOURCE_TOKEN_REQUIRED');
    const accepted = await request(route + '?source=' + encodeURIComponent(status.sourceToken), { lan: true });
    assert.equal(accepted.status, 200, route);
    assert.match(accepted.headers.get('permissions-policy'), /microphone=\(\)/);
    assert.match(await accepted.text(), /data-ps="canvas"/);
  }
  assert.deepEqual(deniedStatuses, sourceRoutes.map(route => ({ route, status: 401 })));
});

test('complete server mounts controller guide routes with real guide validation and PIN', { timeout: 30000 }, async t => {
  const { request, trackId, guideId } = await fixture(t);
  const status = await (await request('/api/access/status')).json();
  const sourceQuery = '?source=' + encodeURIComponent(status.sourceToken);
  const guide = await request('/api/practice/guides/' + trackId);
  const guideBody = await guide.json();
  assert.equal(guide.status, 200, JSON.stringify(guideBody)); assert.equal(guideBody.guide.guideId, guideId);
  assert.equal(guide.headers.get('cache-control'), 'private, no-store');
  const sourceRead = await request('/api/practice/guides/' + trackId + sourceQuery, { lan: true });
  assert.equal(sourceRead.status, 401); assert.equal((await sourceRead.json()).code, 'CONTROLLER_PAIRING_REQUIRED');
  const cached = await request('/api/practice/guides/' + trackId, { method: 'POST', body: { algorithm: 'auto' } });
  assert.equal(cached.status, 200); assert.equal((await cached.json()).cacheHit, true);
  assert.equal((await request('/api/practice/score' + sourceQuery, { lan: true })).status, 404, 'the old score endpoint is gone');
  const pin = await request('/api/auth/set', { method: 'POST', body: { newPin: '2468' } });
  assert.equal(pin.status, 200);
  const noPin = await request('/api/practice/guides/' + trackId);
  assert.equal(noPin.status, 401); assert.equal((await noPin.json()).code, 'PIN_REQUIRED');
  assert.equal((await request('/api/practice/guides/' + trackId, { headers: { 'x-pin': '2468' } })).status, 200);
  assert.equal((await request('/practice-overlay' + sourceQuery, { lan: true })).status, 200,
    'the OBS overlay must not become controller/PIN protected');
});
