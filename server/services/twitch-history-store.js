'use strict';

const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir } = require('../utils/app-paths');

const log = createLogger('TwitchHistory');
const STORE_FILE = path.join(dataDir, 'twitch-history.json');

const diskStore = createJsonStore({
  file: STORE_FILE,
  label: 'Twitch 點歌歷史',
  defaultValue: () => [],
  migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, entries: Array.isArray(legacy) ? legacy : [] })]]),
  serialize: (entries) => ({ entries }),
  deserialize: (document) => document.entries,
  validate: (document) => Array.isArray(document.entries),
  logger: log,
});

function load() { return diskStore.load(); }
function save(entries) { return diskStore.save(entries); }
function clear() { return diskStore.remove(); }

module.exports = { load, save, clear, STORE_FILE };
