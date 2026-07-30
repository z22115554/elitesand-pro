/*
 * Shared settings-workspace navigation.
 *
 * The lyric and setlist editors keep their own controls, persistence, and
 * search vocabulary.  This small layer only gives both surfaces the same
 * intent-based navigation and makes their current filtered state visible.
 */
(function () {
  'use strict';

  const splitGroups = (value) => String(value || '').trim().split(/\s+/).filter(Boolean);
  let workspaceSequence = 0;

  function create(root, options = {}) {
    if (!root || root.dataset.settingsWorkspaceReady === 'true') return null;

    const tabs = Array.from(root.querySelectorAll('[data-settings-workspace-tab]'));
    const sections = Array.from(root.querySelectorAll('[data-settings-workspace-group]'));
    if (!tabs.length || !sections.length) return null;

    const nav = root.querySelector('.settings-workspace__nav');
    const panel = root.querySelector('.mw-settings');
    const workspaceId = root.id || `settings-workspace-${++workspaceSequence}`;
    if (!root.id) root.id = workspaceId;
    if (nav) nav.setAttribute('role', 'tablist');
    if (panel) {
      if (!panel.id) panel.id = `${workspaceId}-panel`;
      panel.setAttribute('role', 'tabpanel');
    }
    tabs.forEach((tab) => {
      const group = tab.dataset.settingsWorkspaceTab;
      if (!tab.id) tab.id = `${workspaceId}-tab-${group}`;
      tab.setAttribute('role', 'tab');
      if (panel) tab.setAttribute('aria-controls', panel.id);
    });

    let active = options.initial || tabs.find((tab) => tab.dataset.settingsWorkspaceDefault === 'true')?.dataset.settingsWorkspaceTab || tabs[0].dataset.settingsWorkspaceTab;
    let searching = false;

    const isAvailable = (section) => !section.hidden && !section.classList.contains('is-search-hidden');
    const sectionMatches = (section, group) => splitGroups(section.dataset.settingsWorkspaceGroup).includes(group);

    function update() {
      const availableGroups = tabs.filter((tab) => sections.some((section) => (
        sectionMatches(section, tab.dataset.settingsWorkspaceTab) && isAvailable(section)
      )));
      if (!searching && availableGroups.length && !availableGroups.some((tab) => tab.dataset.settingsWorkspaceTab === active)) {
        active = availableGroups[0].dataset.settingsWorkspaceTab;
      }
      root.dataset.settingsWorkspaceActive = active;
      root.classList.toggle('settings-workspace--searching', searching);

      tabs.forEach((tab) => {
        const group = tab.dataset.settingsWorkspaceTab;
        const selected = group === active;
        const hasVisibleSection = availableGroups.includes(tab);
        tab.classList.toggle('is-active', selected);
        tab.setAttribute('aria-pressed', String(selected));
        tab.setAttribute('aria-selected', String(selected));
        tab.setAttribute('aria-disabled', String(!hasVisibleSection));
        tab.tabIndex = selected && hasVisibleSection ? 0 : -1;
      });

      if (panel) {
        const activeTab = tabs.find((tab) => tab.dataset.settingsWorkspaceTab === active);
        if (activeTab) panel.setAttribute('aria-labelledby', activeTab.id);
      }

      sections.forEach((section) => {
        const groupMatch = sectionMatches(section, active);
        const searchMatch = isAvailable(section);
        const hidden = searching ? !searchMatch : !groupMatch;
        section.classList.toggle('settings-workspace__section-hidden', hidden);
      });
    }

    function select(group, { focus = false } = {}) {
      const target = tabs.find((tab) => tab.dataset.settingsWorkspaceTab === group);
      if (!target || target.getAttribute('aria-disabled') === 'true') return;
      options.onSelect?.(group);
      active = group;
      searching = false;
      update();
      if (focus) target.focus();
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => select(tab.dataset.settingsWorkspaceTab));
      tab.addEventListener('keydown', (event) => {
        const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const enabled = tabs.filter((item) => item.getAttribute('aria-disabled') !== 'true');
        if (!enabled.length) return;
        const currentIndex = enabled.indexOf(tab);
        let next = tab;
        if (event.key === 'Home') next = enabled[0];
        else if (event.key === 'End') next = enabled[enabled.length - 1];
        else {
          const delta = (event.key === 'ArrowUp' || event.key === 'ArrowLeft') ? -1 : 1;
          next = enabled[(currentIndex + delta + enabled.length) % enabled.length];
        }
        select(next.dataset.settingsWorkspaceTab, { focus: true });
      });
    });

    root.dataset.settingsWorkspaceReady = 'true';
    update();

    return {
      select,
      sync() { update(); },
      setSearching(value) {
        searching = !!value;
        update();
      },
      getActive() { return active; },
    };
  }

  window.SettingsWorkspace = Object.freeze({ create });
})();
