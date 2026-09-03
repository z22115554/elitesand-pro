'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { visualLyrics, visualFrames } = require('../fixtures/visual-lyrics.fixture');

// 單一來源：從 public/js/ 底下的 lyric-template-*.js 檔名推導模板 id 清單，
// 不再手寫第二份清單。排除 registry/settings 這類非模板檔。
const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'public', 'js');
const NON_TEMPLATE_FILES = new Set(['lyric-template-registry.js', 'lyric-template-settings.js']);

const CUSTOM_TEMPLATE_IDS = fs.readdirSync(TEMPLATE_DIR)
  .filter((name) => name.startsWith('lyric-template-') && name.endsWith('.js'))
  .filter((name) => !NON_TEMPLATE_FILES.has(name))
  .map((name) => name.slice('lyric-template-'.length, -'.js'.length))
  .sort();

async function waitForTemplateRuntime(page) {
  // 等 runtime registry 載入完成且與檔案系統推導出的清單一致。用 toEqual 比對
  // 排序後的兩份清單，而不是硬寫一份跟 runtime 分開維護、容易漂移的陣列——
  // 這樣漏掉註冊的模板檔仍會被抓到（清單不一致），但清單本身只有一個來源。
  await expect.poll(async () => page.evaluate(() => {
    if (typeof LyricTemplates === 'undefined' || typeof KaraokeEngine === 'undefined') return null;
    return LyricTemplates.list()
      .map((template) => template.id)
      .filter((id) => id !== 'classic')
      .sort();
  })).toEqual(CUSTOM_TEMPLATE_IDS);
}

async function renderVisualFrame(page, templateId, frame) {
  await page.evaluate(({ id, timeMs, lyrics }) => {
    const updateAt = window.__visualUpdateAt || KaraokeEngine.update;
    const timeline = typeof gsap !== 'undefined' ? gsap.globalTimeline : null;
    if (timeline) timeline.clear().pause(0);

    KaraokeEngine.setFastMode(true);
    KaraokeEngine.setTemplate(id);
    KaraokeEngine.loadLyrics('', 'lrc', lyrics);
    updateAt(timeMs);

    // 固定 GSAP 時間軸，讓快照只反映指定歌詞時間點，而非截圖機器的當下時鐘。
    if (timeline) timeline.totalTime(2, false).pause();
  }, { id: templateId, timeMs: frame.timeMs, lyrics: visualLyrics });

  // A template switch can schedule its own preview frame.  Drive the fixture
  // time through two compositor frames so the snapshot cannot capture that
  // stale preview state or a half-applied transform.
  await page.evaluate((timeMs) => new Promise((resolve) => {
    requestAnimationFrame(() => {
      window.__visualUpdateAt(timeMs);
      requestAnimationFrame(() => {
        window.__visualUpdateAt(timeMs);
        resolve();
      });
    });
  }), frame.timeMs);
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
      // display.js drives KaraokeEngine from its live playback loop.  During a
      // visual fixture that loop would race the explicit fixed time below, so
      // retain a private test driver and make incidental live ticks no-ops.
      window.__visualUpdateAt = KaraokeEngine.update.bind(KaraokeEngine);
      KaraokeEngine.update = () => {};
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
