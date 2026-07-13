'use strict';

const path = require('path');
const { createLogger } = require('../utils/logger');
const { createJsonStore } = require('./json-store');
const { dataDir } = require('../utils/data-dir');

const log = createLogger('TwitchRequests');
const STORE_FILE = path.join(dataDir, 'twitch-requests.json');

const diskStore = createJsonStore({
  file: STORE_FILE,
  label: 'Twitch 待確認點歌',
  defaultValue: () => [],
  migrations: new Map([[0, (legacy) => ({ schemaVersion: 1, requests: Array.isArray(legacy) ? legacy : [] })]]),
  serialize: (requests) => ({ requests }),
  deserialize: (document) => document.requests,
  validate: (document) => Array.isArray(document.requests),
  logger: log,
});

function load() { return diskStore.load(); }
function save(requests) { return diskStore.save(requests); }
function clear() { return diskStore.remove(); }

module.exports = { load, save, clear, STORE_FILE };
