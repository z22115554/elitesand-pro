'use strict';

const { test, expect } = require('@playwright/test');
const fontLink = 'link[href*="family=Noto+Sans+SC"]';
const css = ':root { --audit-font-stylesheet: loaded; }';

test('a six-second font stylesheet does not block display scripts and applies under CSP', async ({ page }, testInfo) => {
  const violations = [];
  page.on('console', message => { if (/inline event handler|Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const timer = setTimeout(release, 6000);
  await page.route('https://fonts.googleapis.com/**', async route => {
    await pending;
    await route.fulfill({ contentType: 'text/css', body: css });
  });
  try {
    await page.goto('/display?preview=1', { waitUntil: 'domcontentloaded', timeout: 4000 });
    await expect(page).toHaveTitle(/Elitesand Pro/);
    expect(await page.evaluate(() => typeof KaraokeEngine.update)).toBe('function');
    expect(await page.locator(fontLink).getAttribute('media')).toBe('print');
    await page.waitForFunction(() => document.querySelector('link[href*="family=Noto+Sans+SC"]').sheet !== null);
    await expect(page.locator(fontLink), violations.join('\n')).toHaveAttribute('media', 'all', { timeout: 2000 });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--audit-font-stylesheet').trim())).toBe('loaded');
    expect(violations).toEqual([]);
    await page.evaluate(() => {
      KaraokeEngine.setTemplate('classic');
      KaraokeEngine.loadLyrics('', 'lrc', [{ time: 0, text: '字型載入檢查', words: [] }]);
      KaraokeEngine.update(1000);
    });
    await expect(page.locator('#karaoke-display')).toContainText('字型');
    await testInfo.attach('font-stylesheet-applied', { body: await page.screenshot(), contentType: 'image/png' });
  } finally { clearTimeout(timer); release(); }
});

test('cached font CSS also activates without an inline handler', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: css }));
  await page.goto('/display?preview=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(fontLink)).toHaveAttribute('media', 'all');
  expect(await page.locator(fontLink).getAttribute('onload')).toBe(null);
});

test('font CSS failure keeps the display runtime usable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.abort('failed'));
  await page.goto('/display?preview=1', { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => typeof KaraokeEngine.update)).toBe('function');
  await expect(page.locator('#karaoke-display')).toBeAttached();
  expect(errors).toEqual([]);
});
