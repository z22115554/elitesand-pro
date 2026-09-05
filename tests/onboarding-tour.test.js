/**
 * Focused contract and extreme geometry tests for the interactive onboarding tour.
 * Run directly with: node tests/onboarding-tour.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const tour = require(path.join(root, 'public/js/onboarding-tour.js'));
const I18n = require(path.join(root, 'public/js/i18n.js'));
// Normalize CRLF so multi-line string/regex checks below don't depend on
// whether the working tree currently has Windows line endings checked out.
const readNormalized = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const page = readNormalized(path.join(root, 'public/index.html'));
const css = readNormalized(path.join(root, 'public/css/onboarding-tour.css'));
const source = readNormalized(path.join(root, 'public/js/onboarding-tour.js'));
const nav = readNormalized(path.join(root, 'public/js/nav.js'));
const youtubeImport = readNormalized(path.join(root, 'public/js/app-youtube-import.js'));
const displayPath = path.join(root, 'public/js/display.js');
const display = fs.existsSync(displayPath) ? readNormalized(displayPath) : null;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    → ${error.message}`);
  }
}

function ok(value, message) {
  if (!value) throw new Error(message || `Expected truthy value, got ${JSON.stringify(value)}`);
}

function eq(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message || 'Values differ'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function attrKeys(attribute) {
  return Array.from(page.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g')), (match) => match[1]);
}

console.log('\n🧭 Interactive onboarding tour');

test('core tour remains exactly seven focused steps', () => {
  eq(tour.STEPS.length, 7);
  eq(tour.STEPS.map((step) => step.id).join(','), 'navigation,source,playlist,player,preview,style,obs');
});

test('advanced tour is split into independent lyrics, OBS, and live-operations chapters', () => {
  eq(tour.ADVANCED_LYRICS_STEPS.length, 4);
  eq(tour.ADVANCED_OBS_STEPS.length, 7);
  eq(tour.ADVANCED_LIVE_STEPS.length, 4);
  eq(tour.ADVANCED_LYRICS_STEPS.map((step) => step.id).join(','), 'lyrics-source,lyrics-align,lyrics-nudge,lyrics-timeline');
  eq(tour.ADVANCED_OBS_STEPS.map((step) => step.id).join(','), 'obs-copy,obs-add,obs-status,obs-websocket,obs-create,obs-ai-separation,obs-dual-audio');
  eq(tour.ADVANCED_LIVE_STEPS.map((step) => step.id).join(','), 'live-setlist,live-delete-played,live-session,live-twitch');
  ok(page.includes('id="guide-start-lyrics"'), 'Lyrics chapter entry missing');
  ok(page.includes('id="guide-start-obs"'), 'OBS chapter entry missing');
  ok(page.includes('id="guide-start-live"'), 'Live-operations chapter entry missing');
  ok(nav.includes("startAdvancedChapter('lyrics')") && nav.includes("startAdvancedChapter('obs')") && nav.includes("startAdvancedChapter('live')"), 'Chapter entries are not wired independently');
});

test('completed users can replay the beginner tour from Help', () => {
  ok(page.includes('id="guide-start-interactive"'), 'Beginner replay button missing from Help');
  ok(nav.includes("tourCompleted ? 'tour.guide.review' : 'tour.welcome.start'"), 'Help entry does not switch to replay copy after completion');
  ok(nav.includes('if (route) route.hidden = false'), 'Completed quick-start state still hides the whole beginner section');
  ok(nav.includes('window.OnboardingTour?.start({ force: true })'), 'Beginner replay does not force-restart the tour');
});

test('every advanced desktop and mobile spotlight selector exists', () => {
  const selectors = new Set(tour.ADVANCED_STEPS.flatMap((step) => [step.target, step.mobileTarget]));
  selectors.forEach((selector) => {
    if (selector.startsWith('#')) ok(page.includes(`id="${selector.slice(1)}"`), `Missing ${selector}`);
    else if (selector.startsWith('.')) ok(new RegExp(`class="[^"]*${selector.slice(1)}`).test(page), `Missing ${selector}`);
    else throw new Error(`Unsupported advanced selector: ${selector}`);
  });
});

test('advanced progress is stable by step id and isolated from the basic tour', () => {
  ok(source.includes("elite-advanced-lyrics-tour-v1"), 'Lyrics storage key missing');
  ok(source.includes("elite-advanced-obs-tour-v1"), 'OBS storage key missing');
  ok(source.includes("elite-advanced-live-tour-v1"), 'Live-operations storage key missing');
  ok(source.includes('state.stepId = currentSteps()[state.currentStep]?.id'), 'Stable step-id persistence missing');
  ok(source.includes('steps.findIndex((step) => step.id === parsed.stepId)'), 'Step-id restoration missing');
  ok(source.includes('return basicState.status === \'completed\''), 'Basic completion semantics changed');
  ok(/getAdvancedState\(\)[\s\S]*?lyrics:[\s\S]*?obs:[\s\S]*?live:/.test(source), 'Independent chapter states are not exposed');
});

test('malformed saved progress cannot crash tour initialization', () => {
  const modulePath = path.join(root, 'public/js/onboarding-tour.js');
  execFileSync(process.execPath, ['-e', `
    global.localStorage = {
      getItem() { return '{not-valid-json'; },
      setItem() {},
    };
    require(${JSON.stringify(modulePath)});
  `], { stdio: 'pipe' });
});

test('all advanced copy resolves in all five locales', () => {
  const keys = new Set([
    'tour.complete.advanced',
    'tour.advanced.entry.kicker',
    'tour.advanced.entry.title',
    'tour.advanced.entry.body',
    'tour.advanced.entry.badge',
    'tour.advanced.entry.lyrics',
    'tour.advanced.entry.obs',
    'tour.advanced.entry.live',
    'tour.advanced.lyricsComplete.kicker',
    'tour.advanced.lyricsComplete.title',
    'tour.advanced.lyricsComplete.body',
    'tour.advanced.obsComplete.kicker',
    'tour.advanced.obsComplete.title',
    'tour.advanced.obsComplete.body',
    'tour.advanced.liveComplete.kicker',
    'tour.advanced.liveComplete.title',
    'tour.advanced.liveComplete.body',
    'tour.advanced.complete.nextObs',
    ...tour.ADVANCED_STEPS.flatMap((step) => [step.title, step.body, step.hint]),
  ]);
  for (const locale of I18n.LOCALES) {
    I18n.setLocale(locale, { persist: false, updateQuery: false });
    keys.forEach((key) => {
      const rendered = I18n.t(key, { current: 1, total: 4 });
      ok(rendered && rendered !== key, `${locale} is missing ${key}`);
      ok(!/\{(?:current|total)\}/.test(rendered), `${locale}:${key} left interpolation tokens behind`);
    });
  }
});

test('every spotlight selector exists in the panel HTML', () => {
  tour.STEPS.forEach((step) => {
    const selector = step.target;
    if (selector.startsWith('#')) ok(page.includes(`id="${selector.slice(1)}"`), `Missing ${selector}`);
    else if (selector.startsWith('.')) ok(page.includes(selector.slice(1)), `Missing ${selector}`);
    else throw new Error(`Unsupported selector in contract test: ${selector}`);
  });
});

test('tour assets load after base panel CSS and after i18n', () => {
  const baseIndex = page.indexOf('/css/panel.css');
  const tourCssIndex = page.indexOf('/css/onboarding-tour.css');
  const i18nIndex = page.indexOf('/js/i18n.js');
  const tourIndex = page.indexOf('/js/onboarding-tour.js');
  const navIndex = page.indexOf('/js/nav.js');
  ok(baseIndex >= 0 && tourCssIndex > baseIndex, 'Tour CSS must follow panel CSS');
  ok(i18nIndex >= 0 && tourIndex > i18nIndex, 'Tour JS must follow i18n');
  ok(navIndex > tourIndex, 'Tour JS must be available when nav initializes first-run flow');
});

test('all explicit tour i18n keys resolve in all five locales', () => {
  const keys = new Set([
    ...attrKeys('data-i18n'),
    ...attrKeys('data-i18n-title'),
    ...attrKeys('data-i18n-aria-label'),
    ...Array.from(source.matchAll(/(?:title|body|mobileBody|hint):\s*'(tour\.[^']+)'/g), (match) => match[1]),
    ...Array.from(source.matchAll(/t\('(tour\.[^']+)'/g), (match) => match[1]),
  ]);
  const tourKeys = Array.from(keys).filter((key) => key.startsWith('tour.'));
  ok(tourKeys.length >= 50, `Expected at least 50 tour keys, got ${tourKeys.length}`);
  for (const locale of I18n.LOCALES) {
    I18n.setLocale(locale, { persist: false, updateQuery: false });
    for (const key of tourKeys) {
      const rendered = I18n.t(key, { current: 1, total: 7 });
      ok(rendered && rendered !== key, `${locale} is missing ${key}`);
      ok(!/\{(?:current|total)\}/.test(rendered), `${locale}:${key} left interpolation tokens behind`);
    }
  }
});

test('FFmpeg readiness flow is fully localized in all five locales', () => {
  const keys = [
    'guide.ffmpegDownload',
    'guide.ffmpegRecheck',
    'guide.ffmpegChecking',
    'guide.ffmpegDownloadingButton',
    'guide.ffmpegDownloading',
    'guide.ffmpegDownloadFailed',
    'guide.ffmpegDownloadFailedWithError',
    'guide.downloadFailed',
  ];
  for (const locale of I18n.LOCALES) {
    I18n.setLocale(locale, { persist: false, updateQuery: false });
    keys.forEach((key) => {
      const rendered = I18n.t(key, { error: 'E_TEST' });
      ok(rendered && rendered !== key, `${locale} is missing ${key}`);
      ok(!rendered.includes('{error}'), `${locale}:${key} left interpolation tokens behind`);
    });
  }
  ok(page.includes('data-i18n="guide.ffmpegDownload"'), 'FFmpeg download button is not declaratively localized');
  ok(page.includes('id="ffmpeg-check-btn"') && page.includes('data-i18n="guide.ffmpegRecheck"'), 'Settings FFmpeg recheck button is missing or not localized');
  ok(!nav.includes("ffmpegDownloadBtn.textContent = '下載"), 'FFmpeg button contains a hard-coded Traditional Chinese state');
  ok(nav.includes("updateFfmpegButtonText();\n      updateChecklist()") || nav.includes("refreshReadiness();\n      updateFfmpegButtonText();"), 'FFmpeg button must refresh after a locale change');
  ok(nav.includes("event.detail?.view === 'general'") && nav.includes('forceRefreshFfmpegReadiness()'), 'Opening Connection & System must force-refresh FFmpeg readiness');
  ok(nav.includes("window.addEventListener('elitesand:ffmpeg-invalidated'"), 'FFmpeg invalidation event must refresh readiness immediately');
  ok(youtubeImport.includes("code === 'FFMPEG_MISSING'") && youtubeImport.includes("new CustomEvent('elitesand:ffmpeg-invalidated')"), 'YouTube import must invalidate FFmpeg readiness after a runtime missing-FFmpeg error');
});

test('welcome, spotlight, leave confirmation, and completion surfaces are accessible dialogs', () => {
  ok(/id="tour-welcome"[^>]+role="dialog"[^>]+aria-modal="true"/.test(page), 'Welcome dialog semantics missing');
  ok(/id="tour-card"[^>]+role="dialog"/.test(page), 'Step card dialog semantics missing');
  ok(!/id="tour-card"[^>]+aria-modal="true"/.test(page), 'Spotlight must keep the real highlighted target available to assistive technology');
  ok(/id="tour-leave-confirm"[^>]+role="alertdialog"/.test(page), 'Leave confirmation semantics missing');
  ok(/id="tour-viewport-warning"[^>]+role="dialog"[^>]+aria-modal="true"/.test(page), 'Small-viewport warning dialog semantics missing');
  ok(/id="tour-complete"[^>]+role="dialog"[^>]+aria-modal="true"/.test(page), 'Completion dialog semantics missing');
  ok(source.includes("event.key === 'Escape'") && source.includes("event.key === 'Tab'"), 'Keyboard close/focus trap missing');
  ok(source.includes('trapSurfaceFocus(event, dom.welcome)'), 'Welcome dialog focus trap missing');
  ok(source.includes('trapSurfaceFocus(event, dom.leaveConfirm)'), 'Leave confirmation focus trap missing');
  ok(source.includes('trapSurfaceFocus(event, dom.viewportWarning)'), 'Small-viewport warning focus trap missing');
  ok(source.includes('trapSurfaceFocus(event, dom.complete)'), 'Completion dialog focus trap missing');
});

test('tour pauses below a 640 x 480 safe viewport and resumes without resetting progress', () => {
  eq(tour.MIN_TOUR_VIEWPORT_WIDTH, 640);
  eq(tour.MIN_TOUR_VIEWPORT_HEIGHT, 480);
  ok(tour.isViewportSafe(640, 480), 'Exact minimum viewport should be accepted');
  ok(!tour.isViewportSafe(639, 480), 'Width below minimum should be rejected');
  ok(!tour.isViewportSafe(640, 479), 'Height below minimum should be rejected');
  ok(!tour.isViewportSafe(NaN, 480), 'Invalid viewport dimensions should be rejected');
  ok(page.includes('id="tour-viewport-warning"'), 'Small-viewport warning surface missing');
  ok(page.includes('id="tour-viewport-warning-current"'), 'Current viewport dimensions are not exposed');
  ok(page.includes('導覽至少需要 640 × 480') && !page.includes('導覽至少需要 1024 × 720'), 'Static warning fallback must match the current safe viewport');
  ok(source.includes("showViewportWarning('size')"), 'Resize guard does not pause the tour');
  ok(/active && viewportBlocked[\s\S]*?hideViewportWarning\(\)[\s\S]*?renderStep\(\{ skipNavigation: true, retryViewport: true \}\)/.test(source),
    'Returning to a safe viewport must render the existing step again');
  ok(!/showViewportWarning[\s\S]{0,600}state\.currentStep\s*=/.test(source), 'Viewport warning must not reset the current step');
});

test('stale async positioning cannot overwrite a newer rapidly selected step', () => {
  ok(source.includes('const token = ++renderToken'), 'Each async render needs a generation token');
  ok((source.match(/token !== renderToken \|\| !active/g) || []).length >= 2, 'Async render must abort after each awaited boundary');
  ok(source.includes('dom.next.disabled = true'), 'Navigation must be locked until the first step is ready');
  ok(/function next\(\)[\s\S]*?dom\.next\.disabled = true;[\s\S]*?state\.currentStep \+= 1/.test(source), 'Next must lock synchronously before async navigation');
  ok(/const resolvedTarget = await resolveTarget\(step\);[\s\S]*?token !== renderToken[\s\S]*?activeTarget = resolvedTarget/.test(source), 'A stale render must not overwrite the global active target');
  ok(source.includes('if (!active || suspendedByModal || renderPending) return;'), 'Mutation-driven requirement updates must stay locked during a render');
});

test('a deferred first-run welcome cannot replace an active advanced chapter', () => {
  ok(/function maybeShowWelcome\(options = \{\}\) \{[\s\S]*?init\(\);\s*if \(active\) return false;\s*selectTour\('basic'\)/.test(source),
    'Welcome guard must run before switching the shared tour state back to basic');
  ok(/function start\(options = \{\}\) \{[\s\S]*?root\.clearTimeout\(deferredWelcomeTimer\);[\s\S]*?deferredWelcomeTimer = null;[\s\S]*?selectTour\(options\.kind\)/.test(source),
    'Starting any tour must cancel the pending first-run welcome retry');
});

test('external confirmation dialogs suspend the tour and release keyboard handling', () => {
  ok(source.includes("document.querySelectorAll('[aria-modal=\"true\"]')"), 'External modal detection missing');
  ok(source.includes('modalObserver = new MutationObserver(handleBlockingModalChange)'), 'External modal visibility is not observed');
  ok(source.includes('if (suspendedByModal) return;'), 'Keyboard capture must be released while an external modal is open');
  ok(/blocker && !suspendedByModal[\s\S]*?dom\.root\.hidden = true/.test(source), 'Tour layer must hide behind an external modal');
  ok(/!blocker && suspendedByModal[\s\S]*?dom\.root\.hidden = false[\s\S]*?renderStep\(\)/.test(source), 'Tour must resume the same step after the external modal closes');
});

test('four-pane mask blocks outside clicks while the real target hole stays interactive', () => {
  ['top', 'right', 'bottom', 'left'].forEach((side) => ok(page.includes(`data-tour-mask="${side}"`), `Missing ${side} mask`));
  ok(/\.tour-root\s*\{[^}]*pointer-events:\s*none/s.test(css), 'Root should not block the target hole');
  ok(/\.tour-mask\s*\{[^}]*pointer-events:\s*auto/s.test(css), 'Mask panes must block outside clicks');
  ok(/\.tour-highlight\s*\{[^}]*pointer-events:\s*none/s.test(css), 'Highlight ring must not block the target');
});

test('source step cannot advance until a song or sample lyrics are ready', () => {
  ok(tour.STEPS.find((step) => step.id === 'source').requiresSource, 'Source gate missing');
  ok(source.includes("state.path === 'sample' || hasPlaylistTrack()"), 'Song/sample completion gate missing');
  ok(source.includes("dom.next.disabled = !sourceReady"), 'Next button is not connected to completion gate');
  ok(source.includes('if (!button || button.disabled)'), 'Missing or disabled sample action must not unlock the source gate');
  ok(source.indexOf('await acknowledgment') < source.indexOf("state.path = 'sample'"), 'Sample path must unlock only after the preview acknowledges rendering');
  ok(source.includes("event.data?.type !== 'lyrics-preview:sample-ready'"), 'Sample action needs a preview acknowledgment message');
  if (display !== null) ok(display.includes("{ type: 'lyrics-preview:sample-ready' }"), 'The real preview must acknowledge rendered sample lyrics');
});

test('legacy guide state no longer blocks new users, and upgraders still see the new tour once', () => {
  ok(source.includes('elite-guide-completed-v2') && source.includes('elite-guide-completed-v1'), 'Legacy completion keys missing');
  ok(source.includes('elite-guide-postponed-v2'), 'Legacy postponed key missing');
  ok(nav.includes('OnboardingTour.maybeShowWelcome'), 'Nav does not hand first-run entry to the interactive tour');
  ok(nav.includes('else if (!guideCompleted && !guidePostponed)'), 'Fallback full guide path missing');

  const migrateBody = source.match(/function migrateLegacy\([^)]*\) \{([\s\S]*?)\n  \}/);
  ok(migrateBody, 'migrateLegacy function not found');
  ok(!migrateBody[1].includes("state.status = 'completed'"), 'Finishing the old guide must not auto-complete the new tour for upgraders');
  ok(!migrateBody[1].includes("state.status = 'postponed'"), 'Postponing the old guide must not auto-postpone the new tour for upgraders');
});

test('isSafeToInterrupt checks actual visibility, not just the element\'s own hidden attribute', () => {
  const body = source.match(/function isSafeToInterrupt\(\) \{([\s\S]*?)\n  \}/);
  ok(body, 'isSafeToInterrupt function not found');
  ok(body[1].includes('getClientRects().length'), 'Must confirm the modal is actually rendered, not just self-hidden, or dormant modal templates permanently block the welcome prompt');
});

test('target failure degrades to a skippable explanation instead of crashing the panel', () => {
  ok(source.includes("showStatus(t('tour.targetUnavailable'), 'error')"), 'Missing unavailable-target explanation');
  ok(source.includes('for (let attempt = 0; attempt < 10; attempt++)'), 'Missing bounded target retry');
  ok(!source.includes('while (true)'), 'Tour must not contain an unbounded retry loop');
});

const geometryCases = [
  {
    name: 'wide desktop, left target',
    viewport: [1920, 1080], card: [370, 300],
    hole: { left: 80, top: 160, right: 520, bottom: 720, width: 440, height: 560 },
    expectedSide: 'right',
  },
  {
    name: 'wide desktop, right target',
    viewport: [1920, 1080], card: [370, 300],
    hole: { left: 1420, top: 180, right: 1880, bottom: 760, width: 460, height: 580 },
    expectedSide: 'left',
  },
  {
    name: 'top banner target',
    viewport: [1280, 720], card: [370, 260],
    hole: { left: 340, top: 10, right: 940, bottom: 120, width: 600, height: 110 },
    expectedSide: 'bottom',
  },
  {
    name: 'bottom target',
    viewport: [1280, 720], card: [370, 260],
    hole: { left: 340, top: 600, right: 940, bottom: 710, width: 600, height: 110 },
    expectedSide: 'top',
  },
];

geometryCases.forEach((fixture) => {
  test(`placement: ${fixture.name}`, () => {
    const [vw, vh] = fixture.viewport;
    const [cw, ch] = fixture.card;
    const result = tour.calculateCardPlacement(fixture.hole, vw, vh, cw, ch);
    eq(result.side, fixture.expectedSide);
    ok(result.fits, 'Expected fixture to have a non-overlapping placement');
    ok(result.left >= 10 && result.top >= 10, 'Card escaped top/left viewport');
    ok(result.left + cw <= vw - 10 + 0.01, 'Card escaped right viewport');
    ok(result.top + ch <= vh - 10 + 0.01, 'Card escaped bottom viewport');
    ok(!tour.rectanglesIntersect({
      left: result.left,
      top: result.top,
      right: result.left + cw,
      bottom: result.top + ch,
    }, fixture.hole), 'Card intersects the highlighted target');
  });
});

test('impossible compact placement is marked unsafe instead of overlapping the target', () => {
  const result = tour.calculateCardPlacement(
    { left: 10, top: 10, right: 510, bottom: 310, width: 500, height: 300 },
    520, 320, 370, 280,
  );
  ok(Number.isFinite(result.left) && Number.isFinite(result.top), 'Placement returned NaN/Infinity');
  ok(!result.fits, 'Impossible placement must be rejected');
  ok(result.left >= 10 && result.left + 370 <= 510.01, 'Horizontal clamp failed');
  ok(result.top >= 10 && result.top + 280 <= 310.01, 'Vertical clamp failed');
});

test('reported OBS-status screenshot geometry keeps the card away from the spotlight', () => {
  const hole = { left: 850, top: 10, right: 1053, bottom: 116, width: 203, height: 106 };
  const result = tour.calculateCardPlacement(hole, 1363, 936, 370, 282);
  ok(result.fits, 'OBS status step should fit at the captured desktop viewport');
  const card = {
    left: result.left,
    top: result.top,
    right: result.left + 370,
    bottom: result.top + 282,
  };
  ok(!tour.rectanglesIntersect(card, hole), 'OBS status card overlaps its highlighted status target');
});

test('10,000 adversarial geometry samples never place the card outside the viewport', () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < 10000; index += 1) {
    const vw = 520 + Math.floor(random() * 2040);
    const vh = 320 + Math.floor(random() * 1120);
    const cw = Math.min(370, vw - 20);
    const ch = Math.min(420, vh - 20);
    const left = 10 + random() * Math.max(1, vw - 40);
    const top = 10 + random() * Math.max(1, vh - 40);
    const right = Math.min(vw - 10, left + 1 + random() * Math.max(1, vw - left - 10));
    const bottom = Math.min(vh - 10, top + 1 + random() * Math.max(1, vh - top - 10));
    const hole = { left, top, right, bottom, width: right - left, height: bottom - top };
    const result = tour.calculateCardPlacement(hole, vw, vh, cw, ch);
    ok(Number.isFinite(result.left) && Number.isFinite(result.top), `Non-finite result at sample ${index}`);
    ok(result.left >= 10 - 0.01, `Left overflow at sample ${index}`);
    ok(result.top >= 10 - 0.01, `Top overflow at sample ${index}`);
    ok(result.left + cw <= vw - 10 + 0.01, `Right overflow at sample ${index}`);
    ok(result.top + ch <= vh - 10 + 0.01, `Bottom overflow at sample ${index}`);
    if (result.fits) {
      ok(!tour.rectanglesIntersect({
        left: result.left,
        top: result.top,
        right: result.left + cw,
        bottom: result.top + ch,
      }, hole), `Card/spotlight overlap at sample ${index}`);
    }
  }
});

test('10,000 compact and ultrawide placements remain finite and inside the viewport', () => {
  let seed = 0xa11ce55;
  const random = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < 10000; index += 1) {
    const compact = index % 2 === 0;
    const vw = compact ? 320 + Math.floor(random() * 441) : 1920 + Math.floor(random() * 1521);
    const vh = compact ? 480 + Math.floor(random() * 241) : 300 + Math.floor(random() * 1141);
    const cw = Math.min(370, vw - 20);
    const ch = Math.min(compact ? Math.max(120, Math.floor(vh * 0.46)) : 420, vh - 20);
    const left = 10 + random() * Math.max(1, vw - 30);
    const top = 10 + random() * Math.max(1, vh - 30);
    const right = Math.min(vw - 10, left + 1 + random() * Math.max(1, vw - left - 10));
    const bottom = Math.min(vh - 10, top + 1 + random() * Math.max(1, vh - top - 10));
    const hole = { left, top, right, bottom, width: right - left, height: bottom - top };
    const result = tour.calculateCardPlacement(hole, vw, vh, cw, ch);
    ok(Number.isFinite(result.left) && Number.isFinite(result.top), `Non-finite compact result at ${index}`);
    ok(result.left >= 10 - 0.01 && result.left + cw <= vw - 10 + 0.01, `Horizontal compact overflow at ${index}`);
    ok(result.top >= 10 - 0.01 && result.top + ch <= vh - 10 + 0.01, `Vertical compact overflow at ${index}`);
    if (result.fits) {
      ok(!tour.rectanglesIntersect({
        left: result.left,
        top: result.top,
        right: result.left + cw,
        bottom: result.top + ch,
      }, hole), `Compact card/spotlight overlap at ${index}`);
    }
    if (vw < tour.MIN_TOUR_VIEWPORT_WIDTH || vh < tour.MIN_TOUR_VIEWPORT_HEIGHT) {
      ok(!tour.isViewportSafe(vw, vh), `Unsafe viewport was accepted at ${index}`);
    }
  }
});

test('responsive and reduced-motion fallbacks are present', () => {
  ok(css.includes('@media (max-width: 760px)'), 'Narrow layout fallback missing');
  ok(css.includes('@media (max-height: 620px)'), 'Short viewport fallback missing');
  ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion fallback missing');
  ok(tour.STEPS[0].mobileTarget === '.nav-item[data-nav="karaoke"]', 'Mobile navigation spotlight must use a compact real target');
  ok(tour.STEPS.every((step) => step.mobileTarget), 'Every mobile step needs a compact spotlight target');
  ok(source.includes("behavior: compact || reduceMotion ? 'auto' : 'smooth'"), 'Compact viewports must settle immediately before measuring placement');
  ok(source.includes("block: compact ? 'start' : 'center'"), 'Mobile targets should be scrolled toward the top to leave room for the guide card');
  ok(source.includes("scrollIntoView({ block: 'nearest'"), 'Focused controls inside a short scrollable tour card must remain visible');
  ok(tour.STEPS.find((step) => step.id === 'source').mobileTarget === '#tab-youtube', 'Mobile source spotlight must keep the URL input and import button interactive');
  ok(tour.STEPS.find((step) => step.id === 'source').mobileBody === 'tour.step.source.mobileBody', 'Mobile source instructions must match the controls available inside the spotlight');
  ok(tour.STEPS.find((step) => step.id === 'style').mobileTarget === '.lyric-template-card.active', 'Mobile style spotlight must stay compact');
  ok(tour.STEPS.find((step) => step.id === 'style').action === 'cycleStyle', 'Compact mobile style step still needs a real style-changing action');
  ok(source.includes("root.addEventListener('resize', handleResize"), 'Resize must detect mobile breakpoint changes');
  ok(source.includes("showViewportWarning('placement')"), 'A no-space placement must fall back to the resize warning');
  ok(/\.tour-viewport-warning\s*\{[^}]*pointer-events:\s*auto/s.test(css), 'Viewport warning must remain interactive above the mask');
  ok(/nextCompactViewport !== compactViewport[\s\S]*?renderStep\(\{ skipNavigation: true \}\)/.test(source), 'Crossing 760px must resolve the correct desktop/mobile target again');
  ok(/\.tour-close\s*\{[^}]*color:\s*var\(--text-dim\)[^}]*font-size:\s*12px/s.test(css), 'Small close label needs readable size and contrast');
  ok(/\.tour-card \.tour-hint\s*\{[^}]*color:\s*var\(--text-dim\)/s.test(css), 'Core tour hints need the readable text token');
  ok(/@media \(max-width: 760px\) and \(max-height: 620px\)[\s\S]*?max-height:\s*min\(46vh, calc\(100vh - 16px\)\)/.test(css), 'Short mobile viewports must preserve the 46vh card cap');
});

test('advanced targets survive modal pauses and dynamic DOM replacement', () => {
  ok(source.includes('targetObserver = new MutationObserver'), 'Active target replacement is not observed');
  ok(source.includes("attributeFilter: ['hidden', 'class', 'aria-hidden', 'open']"), 'Target visibility changes are not fully observed');
  ok(/!activeTarget\.isConnected[\s\S]*?renderStep\(\{ skipNavigation: true \}\)/.test(source), 'Removed targets are not re-resolved');
  ok(source.includes('modalObserver = new MutationObserver(handleBlockingModalChange)'), 'Existing dialog suspension contract changed');
  ok(tour.ADVANCED_LYRICS_STEPS.every((step) => !step.action), 'Lyrics chapter must not submit or mutate real lyrics operations');
  ok(tour.ADVANCED_OBS_STEPS.every((step) => !step.action), 'OBS chapter must not fake copy/connect/create success');
  ok(tour.ADVANCED_LIVE_STEPS.every((step) => !step.action), 'Live-operations chapter must not trigger a real new-session, delete, or Twitch connect');
});

test('tour failure is isolated from playback, OBS, and Twitch business logic', () => {
  ok(!/SocketClient\.send|ObsWs\.(?:connect|disconnect)|PinAuth\.fetchWithPin|fetch\(/.test(source), 'Tour must not mutate or call backend business flows');
  ok(source.includes("document.getElementById('copy-obs-url')"), 'OBS action should delegate to the existing copy button');
  ok(/step\.action === 'copyObs'[\s\S]*?if \(!button \|\| button\.disabled\)/.test(source), 'Missing or disabled OBS copy action must not report success');
  ok(source.includes("document.getElementById('btn-preview-sample-lyrics')"), 'Sample action should delegate to the existing preview button');
});

console.log(`\nTour test result: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
