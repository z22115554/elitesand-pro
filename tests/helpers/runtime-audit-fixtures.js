'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const noop = () => {};

function loadState(source = fs.readFileSync(path.join(root, 'server/state/app-state.js'), 'utf8')) {
  const filename = path.join(root, 'server/state/app-state.js');
  const realRequire = createRequire(filename);
  const emitted = [];
  let audioCalls = 0;
  const library = {
    setProtectedEntryIdsProvider: noop, setDurabilityListener: noop, setBeforeRemovalListener: noop,
    getAudioExistsLookup: () => () => true,
    audioStatus: () => { audioCalls++; return { audioAvailable: true, audioMissing: false }; },
  };
  const sandbox = {
    module: { exports: {} }, Buffer, console, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return 100000; } },
    require(name) {
      if (name === '../services/state-store') return { loadState: () => null };
      if (name === '../services/library-store') return library;
      if (name === '../utils/logger') return { createLogger: () => ({ info: noop, warn: noop }) };
      return realRequire(name);
    },
  };
  vm.runInNewContext(source, sandbox, { filename });
  const state = sandbox.module.exports.createAppState({
    to: room => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  });
  return { state, emitted, audioCalls: () => audioCalls, resetAudioCalls: () => { audioCalls = 0; } };
}

function makeNode() {
  const classes = new Set();
  const node = {
    dataset: {}, style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '' },
    children: [], hidden: false, textContent: '', disabled: false, value: '',
    classList: { add: v => classes.add(v), remove: v => classes.delete(v),
      contains: v => classes.has(v), toggle(v, on) { if (on) classes.add(v); else classes.delete(v); } },
    addEventListener: noop, setAttribute: noop, querySelector: () => null, querySelectorAll: () => [],
    appendChild(child) { this.children.push(child); },
    replaceChild(child, old) { this.children[this.children.indexOf(old)] = child; },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
    get lastChild() { return this.children.at(-1); },
    focus: noop,
  };
  Object.defineProperty(node, 'innerHTML', { get() { return this._html || ''; },
    set(value) { this._html = value; this.children = []; } });
  return node;
}

function loadDisplay(source = fs.readFileSync(path.join(root, 'public/js/display.js'), 'utf8')) {
  let now = 0;
  const handlers = {};
  const nodes = new Map();
  const document = {
    documentElement: makeNode(), body: makeNode(),
    getElementById(id) {
      if (id === 'display-background') return null;
      if (!nodes.has(id)) nodes.set(id, makeNode());
      return nodes.get(id);
    },
    querySelector: () => null, querySelectorAll: () => [], createElement: makeNode,
  };
  const sandbox = {
    document, location: { search: '' }, URLSearchParams, performance: { now: () => now },
    Date: class extends Date { static now() { return 100000; } },
    console: { log: noop, warn: noop },
    SocketClient: { init: noop, on(event, callback) { (handlers[event] ||= []).push(callback); },
      connected: () => false, send: noop },
    KaraokeEngine: new Proxy({}, { get: () => noop }),
    setTimeout: noop, clearTimeout: noop, requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
    addEventListener: noop,
  };
  sandbox.window = sandbox;
  const instrumented = source.replace(/\}\)\(\);\s*$/, 'globalThis.__clock = getCurrentTimeMs;\n})();');
  vm.runInNewContext(instrumented, sandbox, { filename: 'display.js' });
  return { advance: ms => { now += ms; }, clock: () => sandbox.__clock(),
    emit: (event, payload) => handlers[event].forEach(callback => callback(payload)) };
}

function loadPlaylist(source = fs.readFileSync(path.join(root, 'public/js/app-playlist.js'), 'utf8')) {
  const dom = Object.fromEntries(['playlist', 'playlistEmpty', 'playlistFilterResult', 'playlistFilterEmpty',
    'btnPlaylistFilterClear', 'btnPlaylistSelect', 'playlistSelectionToolbar', 'playlistSelectionCount',
    'btnPlaylistSelectVisible', 'btnPlaylistSelectionRemove'].map(key => [key, makeNode()]));
  const state = { playlist: [], currentTrackIndex: -1, playedEntryIds: new Set() };
  const sandbox = {
    Set,
    AppShared: { dom, state },
    SharedUtils: { formatTime: String, escapeHtml: String, safeHttpUrl: () => '', attachRowDragReorder: noop },
    SocketClient: { sendWithCallback: noop },
    document: { getElementById: () => null, createElement: makeNode },
    requestAnimationFrame: () => 1, addEventListener: noop,
    I18n: { t: (key, vars) => JSON.stringify({ key, ...vars }) },
  };
  sandbox.window = sandbox;
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    globalThis.__playlist = {
      renderPlaylist, setSelectionMode, toggleTrackSelection, getSelectionKey,
      toggleVisibleTrackSelection,
      filter(query, mode = 'all') { playlistFilterQuery = query; playlistFilterMode = mode; renderPlaylist(); },
    };
  })();`);
  vm.runInNewContext(instrumented, sandbox, { filename: 'app-playlist.js' });
  return { state, dom, ...sandbox.__playlist };
}

module.exports = { loadState, loadDisplay, loadPlaylist };
