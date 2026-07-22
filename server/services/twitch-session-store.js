'use strict';

const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir } = require('../utils/app-paths');

const log = createLogger('TwitchSession');
const STORE_FILE = path.join(dataDir, 'twitch-session.json');

function emptyState() {
  return {
    online: false,
    session: {
      startedAt: null,
      acceptedCount: 0,
      byUser: {},
      lastRequesterId: '',
      lastRequesterName: '',
    },
    recent: [],
  };
}

const diskStore = createJsonStore({
  file: STORE_FILE,
  label: 'Twitch 點歌場次',
  defaultValue: emptyState,
  migrations: new Map([[0, () => ({ schemaVersion: 1, ...emptyState() })]]),
  serialize: (state) => state,
  deserialize: (document) => ({ online: !!document.online, session: document.session, recent: document.recent }),
  validate: (document) => !!document.session && typeof document.session === 'object' && !Array.isArray(document.session)
    && Array.isArray(document.recent),
  logger: log,
});

function load() { return diskStore.load(); }
function save(state) { return diskStore.save(state); }
function clear() { return diskStore.remove(); }

module.exports = { load, save, clear, STORE_FILE, emptyState };
