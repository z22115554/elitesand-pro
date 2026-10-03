'use strict';
// Real Chromium + production HTML/CSS/scripts; deterministic Socket/API fixtures.
// No running server, network credentials, or user's media are needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:32777';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.otf': 'font/otf', '.ttf': 'font/ttf' };

async function fixture(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.fulfill({ status: 200, body: '', contentType: 'text/css' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, aliases: {} } });
    const name = url.pathname === '/panel' || url.pathname === '/setlist' ? file : url.pathname.slice(1);
    const target = path.resolve(root, 'public', name);
    assert.ok(target.startsWith(path.join(root, 'public') + path.sep));
    if (!fs.existsSync(target)) return route.fulfill({ status: 200, body: '' });
    let body = fs.readFileSync(target);
    if (name.endsWith('.html')) body = Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    return route.fulfill({ body, contentType: MIME[path.extname(target)] || 'application/octet-stream' });
  });
  await page.goto(origin + (file === 'index.html' ? '/panel' : '/setlist'));
  await page.evaluate(() => {
    window.listeners = {};
    window.emit = (name, payload) => (listeners[name] || []).forEach((fn) => fn(payload));
    window.SocketClient = { init() {}, on(name, fn) { (listeners[name] ||= []).push(fn); }, send() {}, sendWithCallback() {} };
    window.locale = 'zh-TW';
    window.I18n = { current: () => locale, t: (key) => key === 'prompter.noLyrics' ? `${locale}: no lyrics` : key, translate: (text) => text };
    window.StylePresets = { setStyle() {} };
  });
  await page.addScriptTag({ path: path.join(root, 'public/js/shared-utils.js') });
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.ELITESAND_TEST_BROWSER || undefined,
    args: process.env.ELITESAND_TEST_BROWSER ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  });
  try {
    const { page, errors } = await fixture(browser, 'index.html');
    for (const file of ['playlist-state.js', 'app-shared.js']) await page.addScriptTag({ path: path.join(root, 'public/js', file) });
    await page.evaluate(() => {
      Object.assign(AppShared, { renderPlaylist() {}, applyPitchAndSpeed() {}, updateOffsetDisplay() {}, showToast(message) { window.lastToast = message; } });
      window.finishS2T = null;
      AppShared.lyricS2T = { ensure: () => new Promise((resolve) => { finishS2T = resolve; }), convert: (text) => text };
    });
    for (const file of ['app.js', 'app-lyrics-timeline.js']) await page.addScriptTag({ path: path.join(root, 'public/js', file) });
    assert.match(await page.title(), /Elitesand/i);
    assert.ok((await page.locator('body').innerText()).length > 100);
    await page.evaluate(() => {
      const lines = Array.from({ length: 240 }, (_, i) => ({ time: i * 1000, text: `測試歌詞 ${i + 1}` }));
      AppShared.state.playlist = [
        { id: 'A', title: 'Song A', lyrics: '[00:00.00]測試歌詞', lyricsType: 'lrc', parsedLyrics: lines },
        { id: 'B', title: 'Song B', lyrics: '[00:00.00]另一首', lyricsType: 'lrc', parsedLyrics: [{ time: 0, text: '另一首' }] },
      ];
      AppShared.state.currentTrackIndex = 0;
      AppShared.state.lastPlayTimeMs = 23000; AppShared.state.currentOffsetMs = 100;
      window.applied = [];
      VKState.applyManualLyrics = (...args) => applied.push(args);
      AppShared.dom.btnLyricsTimeline.click();
    });
    const inputs = page.locator('.lt-time');
    assert.equal(await inputs.count(), 240);
    await inputs.nth(0).fill('0:12.34');
    // Resolving the lazy dictionary must preserve an uncommitted focused value.
    await page.evaluate(async () => { finishS2T(); await Promise.resolve(); });
    assert.equal(await inputs.nth(0).inputValue(), '0:12.34');
    assert.equal(await inputs.nth(0).evaluate((el) => document.activeElement === el), true);
    await inputs.nth(0).dispatchEvent('change');
    const nudge = await page.locator('[data-lt-nudge="100"][data-idx="0"]').elementHandle();
    await nudge.click();
    assert.equal(await inputs.nth(0).inputValue(), '0:12.44');
    assert.equal(await nudge.evaluate((el) => el.isConnected && document.activeElement === el), true);
    if (process.env.ELITESAND_TEST_SCREENSHOTS) {
      fs.mkdirSync(process.env.ELITESAND_TEST_SCREENSHOTS, { recursive: true });
      await page.addStyleTag({ content: '@font-face { font-family: AuditCJK; src: url("/assets/fonts/kongyuan/Kongyuan-Sans-L.otf"); } body, input, button { font-family: AuditCJK, sans-serif !important; }' });
      await page.evaluate(() => document.fonts.load('16px AuditCJK'));
      await page.screenshot({ path: path.join(process.env.ELITESAND_TEST_SCREENSHOTS, 'lyrics-timeline.png') });
    }
    // Only the chosen input changes; no row nodes are removed over 100 edits.
    const timelineMutations = await page.evaluate(async () => {
      const observer = new MutationObserver(() => {});
      observer.observe(AppShared.dom.ltRows, { childList: true, subtree: true });
      for (let i = 0; i < 100; i++) AppShared.dom.ltRows.querySelector('[data-lt-nudge="100"]').click();
      const count = observer.takeRecords().length; observer.disconnect(); return count;
    });
    assert.equal(timelineMutations, 0);
    await page.evaluate(() => {
      // A real state sync hydrates only B; A loses its raw lyric fields.
      emit('state:sync', {
        playlist: AppShared.state.playlist.map(({ lyrics, parsedLyrics, ...summary }) => summary),
        currentTrack: AppShared.state.playlist[1],
      });
      if ('lyrics' in AppShared.state.playlist[0]) throw new Error('A must be a summary after switching to B');
      AppShared.dom.ltRows.querySelector('[data-lt-tap="0"]').click();
    });
    assert.equal(await inputs.nth(0).inputValue(), '0:22.44');
    assert.match(await page.evaluate(() => lastToast), /Song A/);
    await page.evaluate(() => AppShared.dom.ltApply.click());
    assert.equal(await page.evaluate(() => applied[0][0]), 'A');
    assert.equal(await page.evaluate(() => applied[0][1]), '[00:00.00]測試歌詞');
    assert.equal(await page.evaluate(() => applied[0][2]), 'lrc');
    assert.equal(await page.evaluate(() => applied[0][3].find((line) => line.text === '測試歌詞 1').time), 22440);
    // Removed source track: do not write the editor data into whichever song is playing.
    await page.evaluate(() => {
      AppShared.state.currentTrackIndex = 1; AppShared.dom.btnLyricsTimeline.click();
      AppShared.state.playlist = [AppShared.state.playlist[0]];
      AppShared.dom.ltApply.click();
    });
    assert.equal(await page.evaluate(() => applied.length), 1);
    const previewMutations = await page.evaluate(() => {
      const track = { id: 'sync-track', title: 'Sync track', lyrics: '[00:00.00]測試歌詞' };
      const payload = { playlist: [track], currentTrack: track };
      emit('state:sync', payload);
      const observer = new MutationObserver(() => {});
      observer.observe(AppShared.dom.lyricsPreview, { childList: true, subtree: true });
      for (let i = 0; i < 100; i++) emit('state:sync', payload);
      const count = observer.takeRecords().length; observer.disconnect(); return count;
    });
    assert.equal(previewMutations, 0);
    await page.evaluate(() => AppShared.renderLyricsPreview(null));
    assert.match(await page.locator('#lyrics-preview').innerText(), /zh-TW: no lyrics/);
    await page.evaluate(() => { AppShared.state.playlist = []; locale = 'en'; window.dispatchEvent(new Event('i18n:change')); });
    assert.match(await page.locator('#lyrics-preview').innerText(), /en: no lyrics/);
    await page.evaluate(() => AppShared.renderLyricsPreview('[00:00.00]<script>alert(1)</script>'));
    assert.equal(await page.locator('#lyrics-preview script').count(), 0);
    assert.match(await page.locator('#lyrics-preview').innerText(), /<script>/);
    assert.deepEqual(errors, []);
    console.log('PASS panel: lazy text update/focus, targeted nudge, original-track apply, removed-track guard, preview cache, locale, escaping');
    console.log(JSON.stringify({ timelineEdits: 100, timelineChildListMutations: timelineMutations, repeatedPreviews: 100, previewChildListMutations: previewMutations }));
    await page.close();

    const setlist = await fixture(browser, 'setlist.html');
    await setlist.page.addScriptTag({ path: path.join(root, 'public/js/setlist-style-schema.js') });
    await setlist.page.addScriptTag({ path: path.join(root, 'public/js/setlist.js') });
    await setlist.page.evaluate(() => {
      emit('setlist:layout', { layout: 'terminal' });
      emit('setlist:update', { active: true, past: [], current: { title: 'Song A', artist: 'Artist' }, upcoming: [{ title: 'Song B', artist: 'Artist' }] });
      emit('state:sync', { lyricSettings: { convertTraditional: false } });
    });
    assert.match(await setlist.page.locator('#setlist-root').innerText(), /Song A/);
    const setlistMutations = await setlist.page.evaluate(() => {
      const observer = new MutationObserver(() => {}); observer.observe(document.getElementById('setlist-root'), { childList: true, subtree: true });
      for (let i = 0; i < 100; i++) emit('state:sync', { lyricSettings: { convertTraditional: false } });
      const count = observer.takeRecords().length; observer.disconnect(); return count;
    });
    assert.equal(setlistMutations, 0);
    const changed = await setlist.page.evaluate(() => {
      const first = document.querySelector('#term-list').firstChild;
      emit('state:sync', { lyricSettings: { convertTraditional: true } });
      return first !== document.querySelector('#term-list').firstChild;
    });
    assert.equal(changed, true);
    assert.deepEqual(setlist.errors, []);
    console.log('PASS setlist: repeated sync preserves nodes; conversion change still redraws');
    console.log(JSON.stringify({ repeatedStateSyncs: 100, setlistChildListMutations: setlistMutations }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
