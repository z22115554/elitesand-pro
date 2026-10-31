'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test, expect } = require('@playwright/test');

// Browser extension JS is unavailable in this environment; cloud-browser localhost
// navigation was refused. Run through the repository's existing test:visual workflow.
// The component scenarios mount the production practice HTML/CSS/scripts, real engine
// and real app-practice controller. Only audio/playback and API responses are fixtures.
const panelHtml = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const practiceStart = panelHtml.indexOf('<section id="view-practice"');
const practiceEnd = panelHtml.indexOf('<div class="view" data-view="settings">', practiceStart);
if (practiceStart < 0 || practiceEnd < 0) throw new Error('Practice panel markup boundaries changed');
const practiceHtml = panelHtml.slice(practiceStart, practiceEnd).replace('class="view practice-view"', 'class="view practice-view is-active"');
const cssLinks = [...panelHtml.matchAll(/<link rel="stylesheet"[^>]+>/g)].map(match => match[0]).join('\n');
const scripts = ['i18n-auto', 'i18n', 'practice-clock', 'practice/practice-scoring', 'practice/practice-calibration', 'practice/practice-fx',
  'practice/practice-engine', 'practice/practice-showcase', 'practice/practice-feedback-controller'];
const TRACK = 'qa-practice-song';
const guide = { guideId: 'qa-guide', duration: 12, algorithm: 'qa-fixture', exclusions: [],
  lines: [{ start: 1, end: 4, text: '第一句需要再練習', words: [] }, { start: 5, end: 9, text: '第二句穩定唱完', words: [] }],
  notes: [{ start: 1, end: 4, midi: 60, line: 0, word: -1 }, { start: 5, end: 9, midi: 64, line: 1, word: -1 }] };
function makeTake(id = 'previous-take', score = 72) {
  return { id, clientTakeId: id, trackId: TRACK, guideId: guide.guideId, scoreVersion: 'source-time-v2',
    key: 0, tempo: 1, allowOctave: true, mixedContext: false, comparable: true, contextFingerprint: 'qa-context',
    scope: { type: 'full', start: 0, end: 12 }, duration: 12, score, source: 'mic', completed: true, valid: true,
    observedSeconds: 8, requiredSeconds: 7, voicedSeconds: 6, createdAt: '2026-10-30T12:00:00.000Z',
    lineFeedback: [{ line: 0, start: 1, end: 4, text: guide.lines[0].text, score: 48, observedSeconds: 3,
      requiredSeconds: 3, voicedSeconds: 2, signedCents: 48, absoluteCents: 48, onsetMs: 150 },
    { line: 1, start: 5, end: 9, text: guide.lines[1].text, score: 90, observedSeconds: 4,
      requiredSeconds: 4, voicedSeconds: 4, signedCents: -10, absoluteCents: 10, onsetMs: 25 }],
    pitchTrace: [{ t: 1, midi: 60 }, { t: 2, midi: 60.5 }, { t: 3, gap: true }, { t: 5, midi: 64 }] };
}

async function mountPractice(page) {
  const pageErrors = [], consoleErrors = [], writes = [], challengeReads = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  let takes = [makeTake()], active = null, viewerRequestsEnabled = false;
  await page.route('**/api/practice/**', async route => {
    const request = route.request(), target = new URL(request.url());
    const endpoint = target.pathname.replace('/api/practice', '');
    const method = request.method();
    if (method !== 'GET') writes.push({ endpoint, method, body: request.postDataJSON() });
    let body;
    if (endpoint === `/guides/${TRACK}`) body = { status: 'ready', guide };
    else if (endpoint === '/pitch-model') body = { installed: true, aiRuntime: true };
    else if (endpoint === '/takes' && method === 'GET') body = { takes };
    else if (endpoint === '/takes' && method === 'POST') {
      const take = { ...request.postDataJSON(), id: `saved-${takes.length}`, createdAt: '2026-10-30T12:01:00.000Z', contextFingerprint: 'qa-context' };
      const previous = takes[0]; takes = [take, ...takes];
      body = { take, comparison: { comparable: true, previous, best: previous, delta: take.score - previous.score,
        usualKey: 0, isPersonalBest: true, improvedLines: [{ text: guide.lines[0].text, delta: 10 }] }, challengeResult: null };
    } else if (endpoint.startsWith('/takes/') && method === 'GET') body = { take: takes.find(take => take.id === decodeURIComponent(endpoint.slice(7))) };
    else if (endpoint.startsWith('/takes/') && method === 'DELETE') {
      takes = takes.filter(take => take.id !== decodeURIComponent(endpoint.slice(7))); body = { deleted: true };
    } else if (endpoint === '/challenge-settings') {
      if (method === 'PATCH') viewerRequestsEnabled = request.postDataJSON().viewerRequestsEnabled;
      body = { viewerRequestsEnabled };
    } else if (endpoint === '/challenges') {
      if (method === 'POST') active = { ...request.postDataJSON(), id: 'qa-challenge', entries: [] };
      if (method === 'GET') challengeReads.push(target.searchParams.get('trackId'));
      body = { challenge: method === 'GET' && active?.trackId !== target.searchParams.get('trackId') ? null : active, localOnly: true };
    } else if (endpoint.startsWith('/challenges/') && method === 'DELETE') { active = null; body = { deleted: true }; }
    else throw new Error(`Unexpected practice API: ${method} ${endpoint}`);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/panel?practice-feedback-test=1', route => route.fulfill({ contentType: 'text/html', body:
    `<!doctype html><html lang="zh-TW" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>練唱回饋測試 — 聲嶼控制面板</title>${cssLinks}</head>
    <body><main class="main" style="height:100dvh"><div class="content">${practiceHtml}</div></main>
    ${scripts.map(script => `<script src="/js/${script}.js"></script>`).join('\n')}
    <script>
      window.PinAuth = { fetchWithPin: (...args) => fetch(...args) };
      window.__practiceQA = { seeks: [], playback: null, snapshot: null, overlays: [] };
      window.SocketClient = { connected: () => false, on() {}, send: (event, value) => window.__practiceQA.overlays.push({ event, value }) };
      window.AppShared = {
        getPitchShift: () => 0, stepPitch() {},
        subscribePracticePlayback: callback => { window.__practiceQA.playback = callback; },
        subscribePracticePlaybackBoundary: callback => { window.__practiceQA.boundary = callback; },
        seekPracticeTo: (seconds, options) => {
          const qa = window.__practiceQA; qa.seeks.push({ seconds, options });
          qa.snapshot = { ...qa.snapshot, sourceTime: seconds, generation: qa.snapshot.generation + 1 };
          queueMicrotask(() => qa.playback(qa.snapshot)); return true;
        }
      };
      const createEngine = PracticeEngine.createPracticeEngine;
      PracticeEngine.createPracticeEngine = options => {
        const engine = createEngine(options); window.__practiceQA.engine = engine;
        window.__practiceQA.finish = options.onFinish; return engine;
      };
    </script><script src="/js/app-practice.js"></script></body></html>` }));
  await page.goto('/panel?practice-feedback-test=1', { waitUntil: 'load' });
  await page.addStyleTag({ content: '@font-face { font-family: AuditCJK; src: url("/assets/fonts/kongyuan/Kongyuan-Sans-L.otf"); } body, input, select, button { font-family: AuditCJK, sans-serif !important; }' });
  await page.evaluate(() => document.fonts.load('16px AuditCJK'));
  await expect(page).toHaveTitle(/練唱回饋測試/);
  await expect(page.locator('#practice-tab-input')).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(track => {
    const qa = window.__practiceQA;
    qa.snapshot = { valid: true, track: { id: track, title: '回饋測試歌曲', artist: '測試演唱者' },
      durationSeconds: 12, sourceTime: 0, contextTime: 0, audioContext: { currentTime: 0 },
      pitchShift: 0, playbackRate: 1, generation: 1, playing: false };
    qa.playback(qa.snapshot);
  }, TRACK);
  await expect(page.locator('#practice-heading')).toContainText('回饋測試歌曲');
  await expect.poll(() => page.evaluate(() => window.__practiceQA.engine.getGuide()?.guideId)).toBe(guide.guideId);
  await expect(page.locator('#practice-history option')).toHaveCount(2);
  return { pageErrors, consoleErrors, writes, challengeReads };
}

for (const viewport of [{ name: 'desktop', width: 1920, height: 1080 }, { name: 'mobile', width: 390, height: 844 }]) {
  test.describe(`practice feedback ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test('review, history ghost, weak-line loop and viewer challenge controls', async ({ page }) => {
      const qa = await mountPractice(page);
      await page.locator('#practice-tab-review').click();
      await expect(page.locator('#practice-pane-review')).toBeVisible();
      await expect(page.locator('#practice-pane-input')).toBeHidden();
      await page.locator('#practice-history').selectOption('previous-take');
      await expect(page.locator('#practice-weak-lines button')).toHaveCount(2);
      await expect(page.locator('#practice-weak-lines button').first()).toContainText('第一句需要再練習');
      await page.locator('#practice-ghost').check();
      await expect.poll(() => page.evaluate(() => window.__practiceQA.engine._state.ghost.length)).toBe(4);
      await page.locator('#practice-weak-lines button').first().click();
      await expect(page.locator('#practice-loop-stop')).toBeEnabled();
      await expect(page.locator('#practice-loop-status')).toContainText('第一句需要再練習');
      await expect.poll(() => page.evaluate(() => window.__practiceQA.seeks[0]?.seconds)).toBeCloseTo(0.4);
      expect(await page.evaluate(() => window.__practiceQA.engine.getRange())).toMatchObject({ start: 0.4, end: 4.3 });
      await page.locator('#practice-loop-stop').click();
      await expect(page.locator('#practice-loop-stop')).toBeDisabled();
      expect(await page.evaluate(() => window.__practiceQA.engine.getRange())).toBeNull();
      await page.evaluate(take => window.__practiceQA.finish(take), makeTake('current-take', 82));
      await expect(page.locator('#practice-comparison')).toContainText('+10.0');
      await expect(page.locator('#practice-improved-lines')).toContainText('第一句需要再練習');
      await expect(page.locator('#practice-history option')).toHaveCount(3);
      const screenshotDir = process.env.PRACTICE_QA_SCREENSHOT_DIR || path.join(os.tmpdir(), 'elitesand-feedback-qa', 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.locator('#practice-pane-review').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshotDir, `practice-review-${viewport.name}.png`), fullPage: false });
      await page.locator('#practice-tab-challenge').click();
      await expect(page.locator('#practice-pane-challenge')).toBeVisible();
      await expect(page.locator('#practice-viewer-challenges')).not.toBeChecked();
      await page.locator('#practice-viewer-challenges').check();
      await expect.poll(() => qa.writes.some(write => write.endpoint === '/challenge-settings' && write.body.viewerRequestsEnabled === true)).toBe(true);
      await page.locator('#practice-challenge-target').fill('90');
      await page.locator('#practice-challenge-create').click();
      await expect(page.locator('#practice-challenge-status')).toContainText('90.0');
      await expect(page.locator('#practice-challenge-clear')).toBeEnabled();
      await page.screenshot({ path: path.join(screenshotDir, `practice-challenge-${viewport.name}.png`), fullPage: false });
      await page.locator('#practice-challenge-clear').click();
      await expect(page.locator('#practice-challenge-clear')).toBeDisabled();
      await page.locator('#practice-viewer-challenges').uncheck();
      await expect.poll(() => qa.writes.some(write => write.endpoint === '/challenge-settings' && write.body.viewerRequestsEnabled === false)).toBe(true);
      expect(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(qa.challengeReads.length).toBeGreaterThan(0);
      expect(qa.challengeReads.every(trackId => trackId === TRACK)).toBe(true);
      expect(qa.pageErrors).toEqual([]);
      expect(qa.consoleErrors).toEqual([]);
      await expect(page.locator('vite-error-overlay, nextjs-portal')).toHaveCount(0);
    });
    test('demo feedback never saves a personal take', async ({ page }) => {
      const qa = await mountPractice(page);
      await page.locator('#practice-tab-review').click();
      await page.evaluate(take => window.__practiceQA.finish(take), { ...makeTake('demo-take', 96), source: 'demo' });
      await expect(page.locator('#practice-review-status')).toContainText('示範');
      await expect(page.locator('#practice-weak-lines button')).toHaveCount(2);
      expect(qa.writes.filter(write => write.endpoint === '/takes')).toEqual([]);
      expect(qa.pageErrors).toEqual([]);
    });
  });
}
