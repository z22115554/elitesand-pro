'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

// Production markup, styles, engine and AudioWorklet; synthetic silent input avoids hardware permissions.
async function openPanel(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.fulfill({ body: '', contentType: 'text/css' });
    const target = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(target)) return route.fulfill({ status: 404, body: '' });
    let body = fs.readFileSync(target);
    if (url.pathname === '/') body = Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.otf': 'font/otf' };
    await route.fulfill({ body, contentType: types[path.extname(target)] || 'application/octet-stream' });
  });
  await page.goto('/');
  await page.evaluate((workletSource) => {
    localStorage.clear();
    const ctx = new AudioContext();
    const addModule = ctx.audioWorklet.addModule.bind(ctx.audioWorklet);
    ctx.audioWorklet.addModule = () => addModule(URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' })));
    window.testPlayback = { audioContext: ctx, valid: false, playing: false, outputSignature: '["speaker-a",false,"","",0]' };
    window.AppShared = {
      subscribePracticePlayback(fn) { window.testPlaybackChanged = fn; fn(testPlayback); },
      subscribePracticePlaybackBoundary() {}, showToast(message) { throw new Error(message); },
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = ctx.createMediaStreamDestination().stream;
      stream.getAudioTracks()[0].getSettings = () => ({ deviceId: 'mic-a', sampleRate: ctx.sampleRate });
      return stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: 'audioinput', deviceId: 'mic-a', label: 'Test microphone' },
      { kind: 'audiooutput', deviceId: 'speaker-a', label: 'Test speakers' },
    ];
  }, fs.readFileSync(path.join(root, 'public/js/practice/pitch-detector-worklet.js'), 'utf8'));
  for (const name of ['i18n.js', 'practice-clock.js', 'practice/practice-scoring.js', 'practice/practice-calibration.js',
    'practice/practice-fx.js', 'practice/practice-engine.js', 'app-practice.js']) {
    await page.addScriptTag({ path: path.join(root, 'public/js', name) });
  }
  await page.evaluate(() => {
    document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('is-active', el.id === 'view-practice'));
  });
  await page.addStyleTag({ content: '@font-face { font-family: AuditCJK; src: url("/assets/fonts/kongyuan/Kongyuan-Sans-L.otf"); } body, input, select, button { font-family: AuditCJK, sans-serif !important; }' });
  await page.evaluate(() => document.fonts.load('16px AuditCJK'));
  await expect(page).toHaveTitle(/Elitesand/i);
  await expect(page.locator('#view-practice')).toBeVisible();
  return errors;
}

for (const width of [1440, 390]) {
  test(`practice hardware profiles and calibration dialog at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = await openPanel(page);
    const source = page.locator('#practice-source');
    const slider = page.locator('#practice-latency');
    const status = page.locator('#practice-latency-status');
    await source.selectOption('mic');
    await expect(slider).toBeEnabled();
    await expect(status).toContainText('尚未校準');
    await expect(slider).toHaveValue('120');
    await slider.fill('200');
    await expect(status).toContainText('手動補償');
    await page.evaluate(() => {
      testPlayback.outputSignature = '["speaker-b",false,"","",0]'; testPlaybackChanged(testPlayback);
    });
    await expect(slider).toHaveValue('120');
    await page.evaluate(() => {
      testPlayback.outputSignature = '["speaker-a",false,"","",0]'; testPlaybackChanged(testPlayback);
    });
    await expect(slider).toHaveValue('200');
    await expect(status).toContainText('手動補償');
    const box = await status.boundingBox();
    expect(box.width).toBeGreaterThan(50);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    const screenshot = info.outputPath(`practice-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('practice panel', { path: screenshot, contentType: 'image/png' });
    await page.locator('#practice-calibrate').click();
    await expect(page.locator('#practice-calibration')).toBeVisible();
    await page.locator('#practice-calibration-start').click();
    await expect(page.locator('#practice-calibration-start')).toBeDisabled();
    await page.locator('#practice-calibration-close').click();
    await expect(page.locator('#practice-calibration')).not.toBeVisible();
    await expect(page.locator('#practice-calibration-start')).toBeEnabled();
    await source.selectOption('off');
    await expect(status).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}
