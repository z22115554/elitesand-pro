'use strict';

const { test, expect } = require('@playwright/test');
const { visualLyrics, visualFrames } = require('../fixtures/visual-lyrics.fixture');

const CUSTOM_TEMPLATE_IDS = [
  'pulse',
  'facet',
  'drift',
  'aura',
  'ktv',
  'columnflow',
  'paperstrip',
  'mirror',
];

async function waitForTemplateRuntime(page) {
  await expect.poll(async () => page.evaluate(() => {
    if (typeof LyricTemplates === 'undefined' || typeof KaraokeEngine === 'undefined') return null;
    return LyricTemplates.list()
      .map((template) => template.id)
      .filter((id) => id !== 'classic');
  })).toEqual(CUSTOM_TEMPLATE_IDS);
}

async function renderVisualFrame(page, templateId, frame) {
  await page.evaluate(({ id, timeMs, lyrics }) => {
    const timeline = typeof gsap !== 'undefined' ? gsap.globalTimeline : null;
    if (timeline) timeline.clear().pause(0);

    KaraokeEngine.setFastMode(true);
    KaraokeEngine.setTemplate(id);
    KaraokeEngine.loadLyrics('', 'lrc', lyrics);
    KaraokeEngine.update(timeMs);

    // 固定 GSAP 時間軸，讓快照只反映指定歌詞時間點，而非截圖機器的當下時鐘。
    if (timeline) timeline.totalTime(2, false).pause();
  }, { id: templateId, timeMs: frame.timeMs, lyrics: visualLyrics });

  // A template change first renders the built-in preview before this fixture takes over.
  // Drive the requested fixture time across two compositor frames so a screenshot never
  // observes that stale preview state or a half-applied transform.
  await page.evaluate((timeMs) => new Promise((resolve) => {
    requestAnimationFrame(() => {
      KaraokeEngine.update(timeMs);
      requestAnimationFrame(() => {
        KaraokeEngine.update(timeMs);
        resolve();
      });
    });
  }), frame.timeMs);
  // KTV／Columnflow 會在換行後完成一次內部排版；固定等候讓快照落在同一個穩定 frame。
}





test.describe('OBS lyric template visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/socket.io/socket.io.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `window.io = () => ({
        id: 'visual-test',
        auth: {},
        on() { return this; },
        onAny() { return this; },
        emit() { return true; },
        disconnect() { return this; },
        connect() { return this; }
      });`,
    }));
    await page.addInitScript(() => {
      let seed = 0x5eed1234;
      Math.random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0x100000000;
      };
      const fixedEpochMs = 1700000000000;
      Date.now = () => fixedEpochMs;
      try {
        Object.defineProperty(performance, 'now', {
          configurable: true,
          value: () => 1000,
        });
      } catch (_) {
        // Chromium 的 performance 物件若不可覆寫，測試仍以固定輸入時間繼續。
      }
    });

    await page.goto('/display?preview=1', { waitUntil: 'domcontentloaded' });
    await waitForTemplateRuntime(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
      const style = document.createElement('style');
      style.textContent = `
        html, body, #karaoke-display {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: #151923 !important;
        }
        #connection-banner, #intro-metronome, #obs-progress-bar {
          display: none !important;
        }
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
      `;
      document.head.appendChild(style);
    });
  });

  for (const templateId of CUSTOM_TEMPLATE_IDS) {
    test(`${templateId} renders every fixed lyric frame`, async ({ page }) => {
      for (const frame of visualFrames) {
        await renderVisualFrame(page, templateId, frame);
        const screenshot = await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
        });
        expect(screenshot).toMatchSnapshot(`${templateId}-${frame.name}.png`, {
          maxDiffPixelRatio: 0.001,
        });
      }
    });
  }
});
