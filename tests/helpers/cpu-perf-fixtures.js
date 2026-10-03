'use strict';
// Run real service modules with isolated persistence and optional language fakes.
// Shared by regression tests and the CPU benchmark; no production data is read/written.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const silentLog = new Proxy({}, { get: () => () => {} });
function loadModule(relative, { source, overrides = {}, initialize } = {}) {
  const filename = path.join(root, relative);
  const realRequire = createRequire(filename);
  const isolatedRequire = id => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id);
  isolatedRequire.resolve = realRequire.resolve;
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, require: isolatedRequire,
    __filename: filename, __dirname: path.dirname(filename),
    Buffer, console, URL, URLSearchParams, queueMicrotask,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    process: { env: process.env, platform: process.platform, on() {} },
  });
  if (initialize) initialize(context);
  vm.runInContext(source ?? fs.readFileSync(filename, 'utf8'), context, { filename });
  return module.exports;
}
function libraryFixture(entries = {}, source, { instrument = true } = {}) {
  const normalizations = { count: 0 };
  const store = loadModule('server/services/library-store.js', {
    source,
    overrides: {
      fs: { existsSync: () => false, mkdirSync() {}, readdirSync: () => [], unlinkSync() {} },
      '../utils/logger': { createLogger: () => silentLog },
      '../utils/app-paths': { dataDir: '/virtual/data', downloadsDir: '/virtual/downloads' },
      './json-store': { createJsonStore: () => ({ load: () => structuredClone(entries), save: () => true }), atomicWrite() {} },
    },
    initialize(context) {
      if (!instrument) return;
      context.normalizations = normalizations;
      vm.runInContext(`const originalNormalize = String.prototype.normalize;
        String.prototype.normalize = function (...args) {
          normalizations.count++;
          return originalNormalize.apply(this, args);
        };`, context);
    },
  });
  return { store, normalizations };
}
function romanizerFixture({ source, tokenizer, pinyin, g2p, mapper, unavailable = false } = {}) {
  const overrides = {
    '../utils/logger': { createLogger: () => silentLog },
    './japanese-g2p-provider': { JapaneseG2PProvider: class {
      async g2pBatch(texts, options) { return g2p ? g2p(texts, options) : texts.map(() => ({ phonemes: [] })); }
    } },
  };
  if (tokenizer) overrides.kuromoji = { builder: () => ({ build: callback => queueMicrotask(() => callback(null, tokenizer)) }) };
  if (unavailable) overrides.kuromoji = null;
  if (pinyin) overrides['pinyin-pro'] = { pinyin };
  if (mapper) overrides['./xieyin-v2-mapper'] = { phonemesToXieyinV2: mapper };
  return loadModule('server/services/romanizer.js', { source, overrides });
}
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { root, libraryFixture, romanizerFixture, plain };
