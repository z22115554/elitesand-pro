/**
 * Elitesand Pro — interactive onboarding tour.
 *
 * Keeps business state in the existing app modules. This file only navigates,
 * positions the spotlight, and listens for visible completion signals.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'elite-interactive-tour-v3';
  const LEGACY_COMPLETE_KEYS = ['elite-guide-completed-v2', 'elite-guide-completed-v1'];
  const LEGACY_POSTPONED_KEY = 'elite-guide-postponed-v2';
  const TOUR_VERSION = 3;
  const HOLE_PADDING = 9;
  const VIEWPORT_MARGIN = 10;
  const CARD_GAP = 30;

  const STEPS = [
    {
      id: 'navigation',
      view: 'karaoke',
      target: '.sidebar',
      mobileTarget: '.nav-item[data-nav="karaoke"]',
      title: 'tour.step.navigation.title',
      body: 'tour.step.navigation.body',
      hint: 'tour.step.navigation.hint',
    },
    {
      id: 'source',
      view: 'karaoke',
      target: '#music-source-card',
      mobileTarget: '#tab-youtube',
      title: 'tour.step.source.title',
      body: 'tour.step.source.body',
      mobileBody: 'tour.step.source.mobileBody',
      hint: 'tour.step.source.hint',
      action: 'sample',
      requiresSource: true,
    },
    {
      id: 'playlist',
      view: 'karaoke',
      target: '.playlist-card',
      mobileTarget: '.playlist-head',
      title: 'tour.step.playlist.title',
      body: 'tour.step.playlist.body',
      hint: 'tour.step.playlist.hint',
    },
    {
      id: 'player',
      view: 'karaoke',
      target: '.now-playing-hero',
      mobileTarget: '.np-controls',
      title: 'tour.step.player.title',
      body: 'tour.step.player.body',
      hint: 'tour.step.player.hint',
    },
    {
      id: 'preview',
      view: 'karaoke',
      target: '#lyrics-preview-card',
      mobileTarget: '.lyrics-preview-controls',
      title: 'tour.step.preview.title',
      body: 'tour.step.preview.body',
      hint: 'tour.step.preview.hint',
    },
    {
      id: 'style',
      view: 'settings',
      target: '#template-buttons',
      mobileTarget: '.lyric-template-card.active',
      title: 'tour.step.style.title',
      body: 'tour.step.style.body',
      hint: 'tour.step.style.hint',
      action: 'cycleStyle',
    },
    {
      id: 'obs',
      view: 'general',
      target: '#obs-url-card',
      mobileTarget: '#copy-obs-url',
      title: 'tour.step.obs.title',
      body: 'tour.step.obs.body',
      hint: 'tour.step.obs.hint',
      action: 'copyObs',
    },
  ];

  const dom = {};
  let state = loadState();
  let activeTarget = null;
  let active = false;
  let debugBypassRequirements = false;
  let deferredWelcomeTimer = null;
  let placementFrame = 0;
  let renderToken = 0;
  let renderPending = false;
  let suspendedByModal = false;
  let initialized = false;
  let playlistObserver = null;
  let modalObserver = null;
  let returnFocus = null;
  let compactViewport = Number(root.innerWidth) <= 760;

  function t(key, vars) {
    return root.I18n ? root.I18n.t(key, vars) : key;
  }

  function defaultState() {
    return {
      version: TOUR_VERSION,
      status: 'not_started',
      currentStep: 0,
      path: null,
      completedAt: null,
      postponedAt: null,
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== TOUR_VERSION) return defaultState();
      return { ...defaultState(), ...parsed };
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* device-local best effort */ }
  }

  function cacheDom() {
    dom.welcome = document.getElementById('tour-welcome');
    dom.welcomeStart = document.getElementById('tour-welcome-start');
    dom.welcomeHelp = document.getElementById('tour-welcome-help');
    dom.welcomeLater = document.getElementById('tour-welcome-later');
    dom.root = document.getElementById('tour-root');
    dom.card = document.getElementById('tour-card');
    dom.highlight = document.getElementById('tour-highlight');
    dom.connector = document.getElementById('tour-connector');
    dom.masks = Object.fromEntries(Array.from(document.querySelectorAll('[data-tour-mask]')).map((el) => [el.dataset.tourMask, el]));
    dom.progress = document.getElementById('tour-progress');
    dom.title = document.getElementById('tour-title');
    dom.body = document.getElementById('tour-body');
    dom.hint = document.getElementById('tour-hint');
    dom.status = document.getElementById('tour-status');
    dom.action = document.getElementById('tour-action');
    dom.back = document.getElementById('tour-back');
    dom.next = document.getElementById('tour-next');
    dom.close = document.getElementById('tour-close');
    dom.leaveConfirm = document.getElementById('tour-leave-confirm');
    dom.leaveResume = document.getElementById('tour-leave-resume');
    dom.leaveButton = document.getElementById('tour-leave-confirm-button');
    dom.complete = document.getElementById('tour-complete');
    dom.completeUse = document.getElementById('tour-complete-use');
    dom.completeHelp = document.getElementById('tour-complete-help');
  }

  function init() {
    if (initialized) return;
    cacheDom();
    if (!dom.root || !dom.welcome || !dom.card) return;
    initialized = true;

    dom.welcomeStart?.addEventListener('click', () => start({ resume: state.status === 'in_progress' }));
    dom.welcomeHelp?.addEventListener('click', () => openFullGuide(dom.welcome));
    dom.welcomeLater?.addEventListener('click', postponeWelcome);
    dom.back?.addEventListener('click', previous);
    dom.next?.addEventListener('click', next);
    dom.close?.addEventListener('click', requestLeave);
    dom.leaveResume?.addEventListener('click', resumeAfterLeavePrompt);
    dom.leaveButton?.addEventListener('click', leave);
    dom.action?.addEventListener('click', runStepAction);
    dom.completeUse?.addEventListener('click', closeCompletion);
    dom.completeHelp?.addEventListener('click', () => openFullGuide(dom.complete));

    root.addEventListener('resize', handleResize, { passive: true });
    document.addEventListener('scroll', schedulePlacement, true);
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('i18n:change', refreshTranslation);
    document.addEventListener('view:change', () => {
      if (active) root.setTimeout(() => renderStep({ skipNavigation: true }), 0);
    });

    const playlist = document.getElementById('playlist');
    if (playlist && typeof MutationObserver !== 'undefined') {
      playlistObserver = new MutationObserver(updateRequirementState);
      playlistObserver.observe(playlist, { childList: true, subtree: true, attributes: true });
    }
    if (document.body && typeof MutationObserver !== 'undefined') {
      modalObserver = new MutationObserver(handleBlockingModalChange);
      modalObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'class', 'aria-hidden'],
      });
    }
  }

  function migrateLegacy(options = {}) {
    let completed = !!options.legacyCompleted;
    let postponed = !!options.legacyPostponed;
    try {
      completed = completed || LEGACY_COMPLETE_KEYS.some((key) => root.localStorage.getItem(key) === '1');
      postponed = postponed || root.localStorage.getItem(LEGACY_POSTPONED_KEY) === '1';
    } catch (_) { /* use provided values */ }

    if (state.status === 'not_started' && completed) {
      state.status = 'completed';
      state.currentStep = STEPS.length - 1;
      state.completedAt = new Date().toISOString();
      saveState();
    } else if (state.status === 'not_started' && postponed) {
      state.status = 'postponed';
      state.postponedAt = new Date().toISOString();
      saveState();
    }
  }

  function maybeShowWelcome(options = {}) {
    init();
    migrateLegacy(options);
    if (!initialized || state.status === 'completed' || state.status === 'postponed') return false;
    if (!isSafeToInterrupt()) {
      root.clearTimeout(deferredWelcomeTimer);
      deferredWelcomeTimer = root.setTimeout(() => maybeShowWelcome(options), 2500);
      return false;
    }
    const hint = document.getElementById('onboard-hint');
    if (hint) hint.hidden = true;
    rememberFocus();
    dom.welcomeStart.textContent = state.status === 'in_progress' ? t('tour.welcome.resume') : t('tour.welcome.start');
    dom.welcome.hidden = false;
    dom.welcomeStart.focus();
    return true;
  }

  function isSafeToInterrupt() {
    const audio = document.getElementById('audio-player');
    if (audio && !audio.paused && !audio.ended) return false;
    const blocking = Array.from(document.querySelectorAll('[aria-modal="true"]:not([hidden])'))
      .some((el) => !el.closest('#tour-welcome, #tour-root, #tour-complete'));
    return !blocking;
  }

  function postponeWelcome() {
    state.status = 'postponed';
    state.postponedAt = new Date().toISOString();
    saveState();
    dom.welcome.hidden = true;
    const hint = document.getElementById('onboard-hint');
    if (hint) hint.hidden = false;
    restoreFocus();
  }

  function start(options = {}) {
    init();
    if (!initialized) return false;
    const force = !!options.force;
    const resume = !!options.resume;
    if (force || !resume || state.status === 'completed' || state.status === 'postponed') {
      state = { ...defaultState(), status: 'in_progress' };
    } else {
      state.status = 'in_progress';
      state.currentStep = clampStep(state.currentStep);
    }
    saveState();
    dom.welcome.hidden = true;
    dom.complete.hidden = true;
    dom.root.hidden = false;
    dom.leaveConfirm.hidden = true;
    active = true;
    suspendedByModal = false;
    renderToken += 1;
    renderPending = true;
    dom.next.disabled = true;
    document.body.classList.add('tour-active');
    renderStep();
    document.dispatchEvent(new CustomEvent('onboarding:started', { detail: { step: state.currentStep } }));
    return true;
  }

  function clampStep(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(STEPS.length - 1, Math.max(0, Math.floor(number)));
  }

  async function renderStep(options = {}) {
    if (!active || suspendedByModal || !dom.root || dom.root.hidden) return;
    const token = ++renderToken;
    renderPending = true;
    dom.next.disabled = true;
    const step = STEPS[clampStep(state.currentStep)];
    state.currentStep = STEPS.indexOf(step);
    saveState();

    if (!options.skipNavigation) switchView(step.view);
    const resolvedTarget = await resolveTarget(step);
    if (token !== renderToken || !active) return;
    activeTarget = resolvedTarget;
    updateCard(step);
    await nextFrame();
    if (token !== renderToken || !active) return;
    place(activeTarget);
    renderPending = false;
    updateRequirementState();
    focusPrimary(step);
    document.dispatchEvent(new CustomEvent('onboarding:step', { detail: { id: step.id, index: state.currentStep } }));
  }

  function switchView(view) {
    const current = document.querySelector('.view.is-active[data-view]')?.dataset.view;
    if (current === view) return;
    document.querySelector(`.nav-item[data-nav="${view}"]`)?.click();
  }

  async function resolveTarget(step) {
    const selector = root.innerWidth <= 760 && step.mobileTarget ? step.mobileTarget : step.target;
    for (let attempt = 0; attempt < 10; attempt++) {
      const target = document.querySelector(selector);
      if (target) openAncestors(target);
      if (target && !target.hidden && target.getClientRects().length) {
        target.scrollIntoView({
          behavior: root.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: root.innerWidth <= 760 ? 'start' : 'center',
          inline: 'center',
        });
        await delay(attempt === 0 ? 220 : 60);
        return target;
      }
      await delay(60);
    }
    return null;
  }

  function openAncestors(target) {
    let parent = target.parentElement;
    while (parent) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
  }

  function updateCard(step) {
    dom.progress.textContent = t('tour.progress', { current: state.currentStep + 1, total: STEPS.length });
    dom.title.textContent = t(step.title);
    dom.body.textContent = t(root.innerWidth <= 760 && step.mobileBody ? step.mobileBody : step.body);
    dom.hint.textContent = t(step.hint);
    dom.back.disabled = state.currentStep === 0;
    dom.next.textContent = state.currentStep === STEPS.length - 1 ? t('tour.finish') : t('tour.next');
    dom.close.textContent = t('tour.leave.label');
    dom.close.setAttribute('aria-label', t('tour.leave.label'));
    dom.status.hidden = true;
    dom.status.textContent = '';
    configureAction(step);
    if (!activeTarget) showStatus(t('tour.targetUnavailable'), 'error');
  }

  function configureAction(step) {
    dom.action.hidden = !step.action;
    if (!step.action) return;
    if (step.action === 'sample') dom.action.textContent = t('tour.action.sample');
    if (step.action === 'cycleStyle') dom.action.textContent = t('tour.action.nextStyle');
    if (step.action === 'copyObs') dom.action.textContent = t('tour.action.copyObs');
  }

  function updateRequirementState() {
    if (!active || suspendedByModal || renderPending) return;
    const step = STEPS[state.currentStep];
    if (!step) return;
    const sourceReady = debugBypassRequirements || state.path === 'sample' || hasPlaylistTrack();
    if (step.requiresSource) {
      dom.next.disabled = !sourceReady;
      if (sourceReady) showStatus(t(state.path === 'sample' ? 'tour.status.sampleReady' : 'tour.status.songReady'));
      else {
        dom.status.hidden = false;
        dom.status.classList.remove('is-error');
        dom.status.textContent = t('tour.status.waitingSource');
      }
    } else {
      dom.next.disabled = false;
    }
  }

  function hasPlaylistTrack() {
    const playlist = document.getElementById('playlist');
    if (!playlist) return false;
    if (playlist.querySelector('.playlist-item, .pi-item, [data-track-id], [data-entry-id]')) return true;
    return Array.from(playlist.children).some((child) => !child.classList.contains('playlist-empty'));
  }

  async function runStepAction() {
    const step = STEPS[state.currentStep];
    if (!step) return;
    if (step.action === 'sample') {
      const button = document.getElementById('btn-preview-sample-lyrics');
      if (!button || button.disabled) {
        showStatus(t('tour.targetUnavailable'), 'error');
        return;
      }
      dom.action.disabled = true;
      const frames = await waitForPreviewFrames();
      if (!frames.length || !active || STEPS[state.currentStep]?.id !== 'source') {
        dom.action.disabled = false;
        showStatus(t('tour.status.sampleUnavailable'), 'error');
        return;
      }
      const acknowledgment = waitForSampleAcknowledgment(frames);
      try {
        button.click();
      } catch (_) {
        dom.action.disabled = false;
        showStatus(t('tour.targetUnavailable'), 'error');
        return;
      }
      const ready = await acknowledgment;
      dom.action.disabled = false;
      if (!ready || !active || STEPS[state.currentStep]?.id !== 'source') {
        showStatus(t('tour.status.sampleUnavailable'), 'error');
        return;
      }
      state.path = 'sample';
      saveState();
      showStatus(t('tour.status.sampleReady'));
      updateRequirementState();
      return;
    }
    if (step.action === 'copyObs') {
      const button = document.getElementById('copy-obs-url');
      if (!button || button.disabled) {
        showStatus(t('tour.targetUnavailable'), 'error');
        return;
      }
      try { button.click(); } catch (_) {
        showStatus(t('tour.targetUnavailable'), 'error');
        return;
      }
      showStatus(t('tour.status.obsCopied'));
      return;
    }
    if (step.action === 'cycleStyle') {
      const styles = Array.from(document.querySelectorAll('#template-buttons .lyric-template-card:not([hidden])'))
        .filter((button) => !button.disabled);
      const current = styles.findIndex((button) => button.classList.contains('active'));
      const button = styles[(current + 1 + styles.length) % styles.length];
      if (!button) {
        showStatus(t('tour.targetUnavailable'), 'error');
        return;
      }
      try { button.click(); } catch (_) {
        showStatus(t('tour.targetUnavailable'), 'error');
        return;
      }
      showStatus(t('tour.status.styleChanged'));
      if (root.innerWidth <= 760) root.setTimeout(() => renderStep({ skipNavigation: true }), 0);
    }
  }

  function showStatus(message, kind = 'ok') {
    dom.status.hidden = false;
    dom.status.textContent = message;
    dom.status.classList.toggle('is-error', kind === 'error');
  }

  async function waitForPreviewFrames(timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;
    do {
      const frames = Array.from(document.querySelectorAll('iframe.obs-preview')).filter((frame) => {
        if (!frame.contentWindow || !frame.getAttribute('src')) return false;
        try { return frame.contentDocument?.readyState === 'complete'; } catch (_) { return true; }
      });
      if (frames.length) return frames;
      await delay(100);
    } while (Date.now() < deadline && active);
    return [];
  }

  function waitForSampleAcknowledgment(frames, timeoutMs = 2000) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        root.removeEventListener('message', onMessage);
        root.clearTimeout(timer);
        resolve(value);
      };
      const onMessage = (event) => {
        if (event.data?.type !== 'lyrics-preview:sample-ready') return;
        if (!frames.some((frame) => frame.contentWindow === event.source)) return;
        finish(true);
      };
      const timer = root.setTimeout(() => finish(false), timeoutMs);
      root.addEventListener('message', onMessage);
    });
  }

  function next() {
    if (renderPending || dom.next.disabled) return;
    if (state.currentStep >= STEPS.length - 1) {
      complete();
      return;
    }
    dom.next.disabled = true;
    state.currentStep += 1;
    saveState();
    renderStep();
  }

  function previous() {
    if (renderPending || state.currentStep <= 0) return;
    dom.next.disabled = true;
    state.currentStep -= 1;
    saveState();
    renderStep();
  }

  function complete() {
    state.status = 'completed';
    state.currentStep = STEPS.length - 1;
    state.completedAt = new Date().toISOString();
    saveState();
    active = false;
    renderPending = false;
    suspendedByModal = false;
    renderToken += 1;
    activeTarget = null;
    dom.root.hidden = true;
    dom.leaveConfirm.hidden = true;
    document.body.classList.remove('tour-active');
    dom.complete.hidden = false;
    dom.completeUse.focus();
    document.dispatchEvent(new CustomEvent('onboarding:completed'));
  }

  function closeCompletion() {
    dom.complete.hidden = true;
    (document.querySelector('.nav-item.active') || document.getElementById('btn-open-help'))?.focus({ preventScroll: true });
  }

  function requestLeave() {
    dom.leaveConfirm.hidden = false;
    dom.leaveResume.focus();
  }

  function resumeAfterLeavePrompt() {
    dom.leaveConfirm.hidden = true;
    dom.close.focus();
  }

  function leave() {
    state.status = 'in_progress';
    saveState();
    active = false;
    renderPending = false;
    suspendedByModal = false;
    renderToken += 1;
    activeTarget = null;
    dom.leaveConfirm.hidden = true;
    dom.root.hidden = true;
    document.body.classList.remove('tour-active');
    document.getElementById('btn-open-help')?.focus();
    document.dispatchEvent(new CustomEvent('onboarding:paused', { detail: { step: state.currentStep } }));
  }

  function openFullGuide(layer) {
    if (layer) layer.hidden = true;
    if (active) {
      active = false;
      renderPending = false;
      suspendedByModal = false;
      renderToken += 1;
      dom.root.hidden = true;
      document.body.classList.remove('tour-active');
    }
    document.dispatchEvent(new CustomEvent('onboarding:open-full-guide'));
  }

  function refreshTranslation() {
    if (dom.welcome && !dom.welcome.hidden) {
      dom.welcomeStart.textContent = state.status === 'in_progress' ? t('tour.welcome.resume') : t('tour.welcome.start');
    }
    if (active) renderStep({ skipNavigation: true });
  }

  function schedulePlacement() {
    if (!active || suspendedByModal || renderPending) return;
    root.cancelAnimationFrame(placementFrame);
    placementFrame = root.requestAnimationFrame(() => {
      if (activeTarget && (!activeTarget.isConnected || !activeTarget.getClientRects().length)) {
        activeTarget = null;
        showStatus(t('tour.targetUnavailable'), 'error');
      }
      place(activeTarget);
    });
  }

  function handleResize() {
    const nextCompactViewport = root.innerWidth <= 760;
    if (nextCompactViewport !== compactViewport) {
      compactViewport = nextCompactViewport;
      if (active && !suspendedByModal) renderStep({ skipNavigation: true });
      return;
    }
    schedulePlacement();
  }

  function place(target) {
    const viewportWidth = root.innerWidth;
    const viewportHeight = root.innerHeight;
    if (!target || !target.getClientRects().length) {
      setMask(dom.masks.top, 0, 0, viewportWidth, viewportHeight);
      setMask(dom.masks.right, 0, 0, 0, 0);
      setMask(dom.masks.bottom, 0, 0, 0, 0);
      setMask(dom.masks.left, 0, 0, 0, 0);
      setBox(dom.highlight, -20, -20, 0, 0);
      dom.connector.hidden = true;
      centerCard();
      return;
    }

    const rect = target.getBoundingClientRect();
    const hole = {
      left: clamp(rect.left - HOLE_PADDING, VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN),
      top: clamp(rect.top - HOLE_PADDING, VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN),
      right: clamp(rect.right + HOLE_PADDING, VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN),
      bottom: clamp(rect.bottom + HOLE_PADDING, VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN),
    };
    hole.width = Math.max(1, hole.right - hole.left);
    hole.height = Math.max(1, hole.bottom - hole.top);

    setMask(dom.masks.top, 0, 0, viewportWidth, hole.top);
    setMask(dom.masks.bottom, 0, hole.bottom, viewportWidth, Math.max(0, viewportHeight - hole.bottom));
    setMask(dom.masks.left, 0, hole.top, hole.left, hole.height);
    setMask(dom.masks.right, hole.right, hole.top, Math.max(0, viewportWidth - hole.right), hole.height);
    setBox(dom.highlight, hole.left, hole.top, hole.width, hole.height);
    placeCard(hole, viewportWidth, viewportHeight);
  }

  function setMask(element, left, top, width, height) {
    if (!element) return;
    setBox(element, left, top, width, height);
  }

  function setBox(element, left, top, width, height) {
    if (!element) return;
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
    element.style.width = `${Math.max(0, Math.round(width))}px`;
    element.style.height = `${Math.max(0, Math.round(height))}px`;
  }

  function placeCard(hole, viewportWidth, viewportHeight) {
    const cardRect = dom.card.getBoundingClientRect();
    const cardWidth = cardRect.width || Math.min(370, viewportWidth - 24);
    const cardHeight = cardRect.height || 280;
    const placement = calculateCardPlacement(hole, viewportWidth, viewportHeight, cardWidth, cardHeight);
    dom.card.style.left = `${Math.round(placement.left)}px`;
    dom.card.style.top = `${Math.round(placement.top)}px`;
    placeConnector(hole, { left: placement.left, top: placement.top, width: cardWidth, height: cardHeight }, placement.side);
  }

  function calculateCardPlacement(hole, viewportWidth, viewportHeight, cardWidth, cardHeight) {
    const available = {
      right: viewportWidth - hole.right,
      left: hole.left,
      bottom: viewportHeight - hole.bottom,
      top: hole.top,
    };
    let side = ['right', 'left', 'bottom', 'top'].find((name) => (
      available[name] >= ((name === 'right' || name === 'left') ? cardWidth : cardHeight) + CARD_GAP
    ));
    if (!side) side = Object.entries(available).sort((a, b) => b[1] - a[1])[0][0];

    let left;
    let top;
    if (side === 'right') {
      left = hole.right + CARD_GAP;
      top = hole.top + (hole.height - cardHeight) / 2;
    } else if (side === 'left') {
      left = hole.left - cardWidth - CARD_GAP;
      top = hole.top + (hole.height - cardHeight) / 2;
    } else if (side === 'bottom') {
      left = hole.left + (hole.width - cardWidth) / 2;
      top = hole.bottom + CARD_GAP;
    } else {
      left = hole.left + (hole.width - cardWidth) / 2;
      top = hole.top - cardHeight - CARD_GAP;
    }

    left = clamp(left, VIEWPORT_MARGIN, viewportWidth - cardWidth - VIEWPORT_MARGIN);
    top = clamp(top, VIEWPORT_MARGIN, viewportHeight - cardHeight - VIEWPORT_MARGIN);
    return { left, top, side };
  }

  function placeConnector(hole, card, side) {
    if (!dom.connector || root.innerWidth <= 760) {
      if (dom.connector) dom.connector.hidden = true;
      return;
    }
    const holeCenter = { x: hole.left + hole.width / 2, y: hole.top + hole.height / 2 };
    const cardCenter = { x: card.left + card.width / 2, y: card.top + card.height / 2 };
    let from;
    let to;
    if (side === 'right') {
      from = { x: hole.right, y: holeCenter.y };
      to = { x: card.left, y: cardCenter.y };
    } else if (side === 'left') {
      from = { x: card.left + card.width, y: cardCenter.y };
      to = { x: hole.left, y: holeCenter.y };
    } else if (side === 'bottom') {
      from = { x: holeCenter.x, y: hole.bottom };
      to = { x: cardCenter.x, y: card.top };
    } else {
      from = { x: cardCenter.x, y: card.top + card.height };
      to = { x: holeCenter.x, y: hole.top };
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 18) {
      dom.connector.hidden = true;
      return;
    }
    dom.connector.hidden = false;
    dom.connector.style.left = `${Math.round(from.x)}px`;
    dom.connector.style.top = `${Math.round(from.y)}px`;
    dom.connector.style.width = `${Math.round(length)}px`;
    dom.connector.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }

  function centerCard() {
    const rect = dom.card.getBoundingClientRect();
    dom.card.style.left = `${Math.max(10, (root.innerWidth - rect.width) / 2)}px`;
    dom.card.style.top = `${Math.max(10, (root.innerHeight - rect.height) / 2)}px`;
  }

  function focusPrimary(step) {
    focusTourElement(step.requiresSource && !dom.action.hidden ? dom.action : dom.next);
  }

  function onKeyDown(event) {
    if (dom.welcome && !dom.welcome.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        postponeWelcome();
      } else if (event.key === 'Tab') {
        trapSurfaceFocus(event, dom.welcome);
      }
      return;
    }
    if (dom.complete && !dom.complete.hidden) {
      if (event.key === 'Tab') trapSurfaceFocus(event, dom.complete);
      return;
    }
    if (suspendedByModal) return;
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (dom.leaveConfirm.hidden) requestLeave();
      else resumeAfterLeavePrompt();
      return;
    }
    if (!dom.leaveConfirm.hidden) {
      if (event.key === 'Tab') trapSurfaceFocus(event, dom.leaveConfirm);
      return;
    }
    if (event.key === 'ArrowRight' && !isTextEntry(event.target)) {
      event.preventDefault();
      next();
      return;
    }
    if (event.key === 'ArrowLeft' && !isTextEntry(event.target)) {
      event.preventDefault();
      previous();
      return;
    }
    if (event.key === 'Tab') trapFocus(event);
  }

  function trapFocus(event) {
    const cardFocusables = Array.from(dom.card.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
    const targetFocusables = activeTarget
      ? Array.from(activeTarget.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))
      : [];
    if (activeTarget?.matches('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')) targetFocusables.unshift(activeTarget);
    const focusables = cardFocusables.concat(targetFocusables).filter((el) => el.getClientRects().length);
    if (!focusables.length) return;
    const current = focusables.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (current <= 0 ? focusables.length - 1 : current - 1)
      : (current < 0 || current === focusables.length - 1 ? 0 : current + 1);
    event.preventDefault();
    focusTourElement(focusables[nextIndex]);
  }

  function trapSurfaceFocus(event, surface) {
    const focusables = Array.from(surface.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((el) => el.getClientRects().length);
    if (!focusables.length) return;
    const current = focusables.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (current <= 0 ? focusables.length - 1 : current - 1)
      : (current < 0 || current === focusables.length - 1 ? 0 : current + 1);
    event.preventDefault();
    focusTourElement(focusables[nextIndex]);
  }

  function focusTourElement(element) {
    if (!element) return;
    element.focus({ preventScroll: true });
    if (element.closest('#tour-card')) element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  }

  function findBlockingModal() {
    return Array.from(document.querySelectorAll('[aria-modal="true"]')).find((element) => (
      !element.closest('#tour-welcome, #tour-root, #tour-complete')
      && !element.hidden
      && element.getClientRects().length
    )) || null;
  }

  function handleBlockingModalChange() {
    if (!active) return;
    const blocker = findBlockingModal();
    if (blocker && !suspendedByModal) {
      suspendedByModal = true;
      renderPending = false;
      renderToken += 1;
      dom.root.hidden = true;
      document.body.classList.remove('tour-active');
      return;
    }
    if (!blocker && suspendedByModal) {
      suspendedByModal = false;
      dom.root.hidden = false;
      document.body.classList.add('tour-active');
      renderStep();
    }
  }

  function rememberFocus() {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnFocus = document.activeElement;
    }
  }

  function restoreFocus() {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function isTextEntry(element) {
    return !!element?.matches?.('input, textarea, select, [contenteditable="true"]');
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function delay(ms) {
    return new Promise((resolve) => root.setTimeout(resolve, ms));
  }

  function nextFrame() {
    return new Promise((resolve) => root.requestAnimationFrame(() => root.requestAnimationFrame(resolve)));
  }

  function isComplete() {
    return state.status === 'completed';
  }

  // Used by automated visual QA. It does not persist bypass state.
  function debugStart(step = 0, options = {}) {
    debugBypassRequirements = options.bypassRequirements !== false;
    state = { ...defaultState(), status: 'in_progress', currentStep: clampStep(step), path: options.sample === false ? null : 'sample' };
    saveState();
    start({ resume: true });
  }

  root.OnboardingTour = {
    init,
    start,
    maybeShowWelcome,
    isComplete,
    openWelcome() {
      init();
      rememberFocus();
      dom.welcomeStart.textContent = state.status === 'in_progress' ? t('tour.welcome.resume') : t('tour.welcome.start');
      dom.welcome.hidden = false;
      dom.welcomeStart.focus();
    },
    getState() { return { ...state }; },
    debugStart,
    debugGoTo(step) {
      state.currentStep = clampStep(step);
      if (!active) start({ resume: true });
      else renderStep();
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      TOUR_VERSION,
      STEPS: STEPS.map((step) => ({ ...step })),
      clamp,
      clampStep,
      calculateCardPlacement,
    };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
