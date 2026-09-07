/* Local font catalogue + bounded, searchable list. No lyric settings are persisted here. */
(function () {
  'use strict';
  const CACHE_KEY = 'elitesand-font-catalog-v1';
  let catalog = null, pending = null, checked = false;
  const listeners = new Set();
  const t = (key, params) => window.I18n?.t(`fonts.${key}`, params) || key;

  function clean(data) {
    if (!data || !Array.isArray(data.fonts) || data.fonts.length > 20000) return null;
    const fonts = [...new Set(data.fonts.filter(name => typeof name === 'string' && name.length > 0 && name.length <= 256))];
    const aliases = Object.create(null), assets = Object.create(null);
    for (const name of fonts) {
      const names = data.aliases?.[name];
      if (Array.isArray(names)) aliases[name] = names.filter(n => typeof n === 'string' && n.length <= 256).slice(0, 32);
      const id = data.assets?.[name]?.id;
      if (typeof id === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(id)) assets[name] = { id };
    }
    return { fonts, aliases, assets };
  }

  function read() {
    if (catalog) return catalog;
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (saved?.version === 1) catalog = clean(saved);
    } catch (_) { /* Invalid/unavailable storage is a cache miss. */ }
    return catalog;
  }

  async function refresh(force = false) {
    if (pending) return pending;
    pending = (async () => {
      const response = await fetch(force ? '/api/fonts?refresh=1' : '/api/fonts');
      const data = await response.json();
      const next = response.ok && data.success ? clean(data) : null;
      if (!next) throw new Error('Font catalogue unavailable');
      // Server scanning includes per-user fonts; no second Font Access enumeration/prompt.
      const changed = JSON.stringify(next) !== JSON.stringify(catalog);
      catalog = next;
      checked = true;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, ...next })); } catch (_) { /* Memory cache still works. */ }
      if (changed) listeners.forEach(listener => listener(next));
      return next;
    })();
    try { return await pending; } finally { pending = null; }
  }

  function get() {
    const saved = read();
    if (saved) {
      // Stale-while-revalidate once per page. Reopening the menu never rescans.
      if (!checked && !pending) refresh(true).catch(() => {});
      return Promise.resolve(saved);
    }
    return refresh();
  }

  function attach(select, placeholderKey, onRefresh, onOpen) {
    const ROW = 40, OVERSCAN = 3;
    let names = [], matches = [], active = 0, open = false, lastStart = -1;
    const wrapper = document.createElement('div');
    wrapper.className = 'font-picker flex-grow';
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'input font-picker-trigger';
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    const popup = document.createElement('div');
    popup.className = 'font-picker-popup'; popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    const toolbar = document.createElement('div'); toolbar.className = 'font-picker-toolbar';
    const search = document.createElement('input'); search.type = 'search'; search.className = 'input';
    search.setAttribute('role', 'combobox'); search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'false');
    const refreshButton = document.createElement('button'); refreshButton.type = 'button'; refreshButton.className = 'btn btn-sm';
    const viewport = document.createElement('div'); viewport.className = 'font-picker-list';
    viewport.id = `${select.id}-list`; viewport.setAttribute('role', 'listbox');
    search.setAttribute('aria-controls', viewport.id);
    const space = document.createElement('div'); space.className = 'font-picker-space';
    const status = document.createElement('div'); status.className = 'font-picker-status'; status.setAttribute('role', 'status');
    toolbar.append(search, refreshButton); viewport.append(space); popup.append(toolbar, viewport, status);
    wrapper.append(trigger, popup); select.after(wrapper); select.hidden = true;
    // The original select remains a tiny backing control for existing change handlers.
    const label = document.querySelector(`label[for="${select.id}"]`);
    if (label) label.htmlFor = trigger.id;

    function sync(value = select.value) {
      const option = document.createElement('option'); option.value = value; option.textContent = value || t(placeholderKey);
      select.replaceChildren(option); select.value = value;
      trigger.textContent = value || t(placeholderKey);
    }
    function choose(index) {
      const value = matches[index]; if (value === undefined) return;
      sync(value); close(); trigger.focus();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function render(force = false) {
      const start = Math.max(0, Math.floor(viewport.scrollTop / ROW) - OVERSCAN);
      if (!force && start === lastStart) return;
      lastStart = start;
      const count = Math.ceil((viewport.clientHeight || 240) / ROW) + 2 * OVERSCAN;
      const fragment = document.createDocumentFragment();
      for (let i = start; i < Math.min(matches.length, start + count); i++) {
        const family = matches[i];
        const option = document.createElement('div');
        option.className = 'font-picker-option'; option.id = `${select.id}-option-${i}`;
        option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(i === active));
        option.setAttribute('aria-posinset', String(i + 1)); option.setAttribute('aria-setsize', String(matches.length));
        option.dataset.index = i; option.style.top = `${i * ROW}px`;
        option.textContent = family || t(placeholderKey);
        option.setAttribute('data-i18n-skip', '');
        if (family) option.style.fontFamily = `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        fragment.append(option);
      }
      space.replaceChildren(fragment); space.style.height = `${matches.length * ROW}px`;
      const activeId = `${select.id}-option-${active}`;
      if (document.getElementById(activeId)) search.setAttribute('aria-activedescendant', activeId);
      else search.removeAttribute('aria-activedescendant');
    }
    function filter() {
      const query = search.value.trim().toLocaleLowerCase();
      matches = query ? names.filter(name => name.toLocaleLowerCase().includes(query)) : ['', ...names];
      active = Math.max(0, matches.indexOf(select.value));
      viewport.scrollTop = 0; lastStart = -1;
      status.textContent = matches.length ? t('count', { count: query ? matches.length : names.length }) : t('empty');
      render(true);
    }
    function show() {
      if (open) { search.focus(); return; }
      open = true; popup.hidden = false; trigger.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-expanded', 'true');
      search.value = ''; filter(); search.focus();
      if (!names.length) status.textContent = t('loading');
      onOpen?.().then(() => { if (open) filter(); }).catch(() => { if (open) status.textContent = t('failed'); });
    }
    function close() {
      open = false; popup.hidden = true; trigger.setAttribute('aria-expanded', 'false'); search.setAttribute('aria-expanded', 'false');
    }
    trigger.addEventListener('click', () => open ? close() : show());
    trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); } });
    search.addEventListener('input', filter);
    search.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); choose(active); return; }
      const delta = { ArrowDown: 1, ArrowUp: -1, PageDown: 6, PageUp: -6 }[event.key];
      if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      active = Math.max(0, Math.min(matches.length - 1, event.key === 'Home' ? 0 : event.key === 'End' ? matches.length - 1 : active + delta));
      if (active * ROW < viewport.scrollTop) viewport.scrollTop = active * ROW;
      else if ((active + 1) * ROW > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = (active + 1) * ROW - viewport.clientHeight;
      render(true);
    });
    popup.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); } });
    viewport.addEventListener('scroll', () => render(), { passive: true });
    viewport.addEventListener('pointerdown', event => { if (event.target.closest('[data-index]')) event.preventDefault(); });
    viewport.addEventListener('click', event => { const option = event.target.closest('[data-index]'); if (option) choose(Number(option.dataset.index)); });
    document.addEventListener('pointerdown', event => { if (open && !wrapper.contains(event.target)) close(); });
    wrapper.addEventListener('focusout', event => {
      if (wrapper.contains(event.relatedTarget)) return;
      // focusout can run before the new element becomes active; wait for the focus sequence.
      setTimeout(() => { if (!wrapper.contains(document.activeElement)) close(); }, 0);
    });
    refreshButton.addEventListener('click', async () => {
      search.focus(); // Disabling the focused button must not dismiss the popup.
      refreshButton.disabled = true; status.textContent = t('loading');
      try { await onRefresh(); filter(); } catch (_) { status.textContent = t('failed'); }
      finally { refreshButton.disabled = false; }
    });
    function translate() {
      search.placeholder = t('search'); search.setAttribute('aria-label', t('search'));
      popup.setAttribute('aria-label', t('browse')); refreshButton.textContent = t('refresh'); sync(); if (open) filter();
    }
    window.addEventListener('i18n:change', translate); translate();
    return { show, sync, setFonts(next) { if (names === next) return; names = next; if (open) filter(); } };
  }
  window.ElitesandFontPicker = { get, refresh, attach, subscribe(listener) { listeners.add(listener); } };
})();
