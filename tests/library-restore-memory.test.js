'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-library-restore-'));
process.env.ELITESAND_DATA_DIR = path.join(root, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(root, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(root, 'logs');
const { loadState } = require('./helpers/runtime-audit-fixtures');
const { ONE_TIME_FIX_NAMES } = require('../server/services/state-migrations');
const { sanitizeParsedLyrics } = require('../server/utils/track-schema');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture({ saved = {}, rawLyrics = '[00:01]夢', durable = true } = {}) {
  const parsedLyrics = [{ time: 1000, text: '夢\u0000', words: [{ text: '夢', start: 0, duration: 300 }] }];
  return loadState(undefined, {
    savedState: { schemaVersion: 3, oneTimeFixes: Object.fromEntries(ONE_TIME_FIX_NAMES.map(name => [name, true])),
      playlist: [{ id: 'song', entryId: 'entry', title: 'Song', ...saved }] },
    libraryEntries: { song: { id: 'song', title: 'Song', lyrics: rawLyrics, lyricsType: 'krc', parsedLyrics } },
    durable,
  });
}

test('WP-23: summaries and compact persistence preserve lyrics availability without reading word data again', () => {
  const f = fixture({ rawLyrics: '' });
  const before = f.libraryReads();
  assert.equal(f.state.getPublicPlaylist()[0].hasLyrics, true);
  f.state.getPublicState(); f.state.persistState();
  const saved = f.persistedSnapshot();
  assert.equal(Object.hasOwn(saved.playlist[0], 'parsedLyrics'), false);
  assert.equal(f.libraryReads(), before);
  f.state.playState.currentTrack = f.state.playState.playlist[0];
  const current = f.state.getPublicState().currentTrack;
  assert.equal(current.parsedLyrics[0].text, '夢');
  assert.equal(current.parsedLyrics[0].words[0].duration, 300);
  assert.equal(f.libraryReads(), before + 1);
});

test('WP-23: once selected, word arrays retain ordinary mutable track semantics', () => {
  const f = fixture(), track = f.state.playState.playlist[0];
  const words = track.parsedLyrics;
  words[0].text = '編輯後';
  assert.strictEqual(track.parsedLyrics, words);
  assert.equal(track.parsedLyrics[0].text, '編輯後');
  const reads = f.libraryReads();
  track.parsedLyrics = null;
  assert.equal(track.parsedLyrics, null); assert.equal(f.libraryReads(), reads);
});

test('WP-23: an explicit saved value or explicit null takes priority over library word data', () => {
  for (const parsedLyrics of [null, [{ time: 2000, text: '自訂' }]]) {
    const f = fixture({ saved: { parsedLyrics } }), before = f.libraryReads();
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.playState.playlist[0].parsedLyrics)), sanitizeParsedLyrics(parsedLyrics));
    assert.equal(f.libraryReads(), before);
  }
});

test('WP-23: summary reorder, rename and export preserve complete deferred word data', () => {
  const f = fixture(), state = f.state;
  const originalReads = f.libraryReads();
  const handlers = new Map(), io = { emit() {}, to: () => ({ emit() {} }) };
  // The separate legacy-payload diagnostic deliberately samples up to eight
  // complete songs. Isolate the reorder contract from that bounded diagnostic.
  require('../server/routes/handlers/playlist')(io, { on: (event, fn) => handlers.set(event, fn) }, {
    ...state, broadcastState() {}, emitSetlist() {},
  });
  let result;
  handlers.get('playlist:update')([{ ...state.getPublicPlaylist()[0], title: 'Renamed' }], r => { result = r; });
  assert.equal(result.ok, true); assert.equal(f.libraryReads(), originalReads);
  assert.equal(state.playState.playlist[0].title, 'Renamed');
  const exported = JSON.parse(JSON.stringify(state.playState.playlist));
  assert.equal(exported[0].parsedLyrics[0].text, '夢');
  assert.equal(exported[0].lyrics, '[00:01]夢');
});

test('WP-23: a non-durable library entry keeps complete in-memory fallback data', () => {
  const f = fixture({ durable: false }), before = f.libraryReads();
  f.state.persistState();
  const saved = JSON.parse(JSON.stringify(f.persistedSnapshot()));
  assert.equal(saved.playlist[0].parsedLyrics[0].text, '夢');
  assert.equal(f.libraryReads(), before);
});
