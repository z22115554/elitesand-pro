'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { libraryFixture, romanizerFixture, plain } = require('./helpers/cpu-perf-fixtures');

function entry(id, artist = 'Artist', title = 'Song') { return { id, artist, title, playCount: 0, lastPlayed: 0 }; }

test('library lookup caches only entry normalization; NFKC matching and first-match exclusion stay intact', () => {
  const { store, normalizations } = libraryFixture({ first: entry('first', 'Ａｒｔｉｓｔ', 'Ｓｏｎｇ！'), second: entry('second', 'Artist', 'Song') });
  assert.equal(store.findByIdentity('artist', 'song').id, 'first');
  assert.equal(normalizations.count, 4);
  normalizations.count = 0;
  assert.equal(store.findByIdentity('ARTIST', 'Song').id, 'first');
  assert.equal(normalizations.count, 2, 'unchanged entries avoid repeated NFKC work');
  assert.equal(store.findByIdentity('Artist', 'Song', 'first').id, 'second');
  assert.equal(store.findByIdentity('Artist', 'Song', 'second').id, 'first');
  assert.equal(store.findByIdentity('Artist', '!!!'), null);
});

test('library identity changes through live entry references invalidate cached normalization immediately', () => {
  const { store } = libraryFixture({ a: entry('a') });
  const live = store.findByIdentity('Artist', 'Song');
  live.title = 'New Song'; live.artist = 'New Artist';
  assert.equal(store.findByIdentity('Artist', 'Song'), null);
  assert.equal(store.findByIdentity('new artist', 'new-song'), live);
  live.title = ''; assert.equal(store.findByIdentity('new artist', 'new-song'), null);
  live.title = 'Again'; assert.equal(store.findByIdentity('new artist', 'again'), live);
});

test('library updateMeta, reimport, recordPlay, removal, and clearing never reuse stale identities', () => {
  const { store } = libraryFixture({ a: entry('a') });
  store.findByIdentity('Artist', 'Song');
  store.updateMeta('a', { title: 'Updated' });
  assert.equal(store.findByIdentity('Artist', 'Song'), null); assert.equal(store.findByIdentity('Artist', 'Updated').id, 'a');
  store.rememberImport({ id: 'a', artist: 'Imported', title: 'New Import' });
  assert.equal(store.findByIdentity('Artist', 'Updated'), null); assert.equal(store.findByIdentity('Imported', 'New Import').id, 'a');
  store.recordPlay({ id: 'a', artist: 'Played', title: 'Now Playing' });
  assert.equal(store.findByIdentity('Imported', 'New Import'), null); assert.equal(store.findByIdentity('Played', 'Now Playing').id, 'a');
  assert.equal(store.remove('a'), true); assert.equal(store.findByIdentity('Played', 'Now Playing'), null);
  store.rememberImport({ id: 'a', artist: 'Restored', title: 'Restored' });
  assert.equal(store.findByIdentity('Restored', 'Restored').id, 'a');
  assert.equal(store.clear(), true); assert.equal(store.findByIdentity('Restored', 'Restored'), null);
});

test('library cached lookup preserves numeric-key ordering, artist requirements and Unicode punctuation rules', () => {
  const { store } = libraryFixture({ '20': entry('20', '周杰倫', '夜 曲'), '3': entry('3', '周杰倫', '夜曲'), other: entry('other', '', '夜曲') });
  assert.equal(store.findByIdentity('周杰倫', '夜——曲').id, '3');
  assert.equal(store.findByIdentity('周杰倫', '夜曲', 3).id, '20');
  assert.equal(store.findByIdentity('', '夜曲').id, 'other');
  assert.equal(store.findByIdentity('Unknown', '夜曲'), null);
  assert.equal(store.findByIdentity('周杰倫', ''), null);
});

test('library lookup preserves coercion and observes changes to a non-string value serialization', () => {
  const { store } = libraryFixture({ a: entry('a') });
  let current = 'Artist'; store.peekEntry('a').artist = { toString: () => current };
  assert.equal(store.findByIdentity('Artist', 'Song').id, 'a'); current = 'Other';
  assert.equal(store.findByIdentity('Artist', 'Song'), null); assert.equal(store.findByIdentity('Other', 'Song').id, 'a');
});

test('large unchanged libraries normalize just the query on repeated lookups, while miss/match behavior stays exact', () => {
  const entries = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`id${i}`, entry(`id${i}`, `Artist ${i}`, `Song ${i}`)]));
  const { store, normalizations } = libraryFixture(entries);
  assert.equal(store.findByIdentity('missing', 'missing'), null); assert.equal(normalizations.count, 4002);
  normalizations.count = 0;
  assert.equal(store.findByIdentity('Artist 1999', 'Song 1999').id, 'id1999'); assert.equal(normalizations.count, 2);
  normalizations.count = 0;
  store.peekEntry('id1000').title = 'Changed';
  assert.equal(store.findByIdentity('missing', 'missing'), null); assert.equal(normalizations.count, 4);
});

const repeatedChinese = () => [0, 1, 2].map(i => ({ time: i * 1000, text: '我愛你', singer: `s${i}`, words: [{ text: '我', time: i * 1000, duration: 100 }, { text: '愛', time: i * 1000 + 100, duration: 200 }, { text: '你', time: i * 1000 + 300, duration: 300 }, { text: '我', time: i * 1000 + 600, duration: 100 }] }));

test('async Chinese readings reuse exact line/word text, preserve timing and leave input untouched', async () => {
  const calls = []; const romanizer = romanizerFixture({ pinyin: text => { calls.push(text); return `pin:${text}`; } });
  const input = repeatedChinese(), original = structuredClone(input);
  const results = await romanizer.addRomanization(input);
  assert.deepEqual(calls, ['我愛你', '我', '愛', '你']);
  assert.deepEqual(input, original);
  assert.equal(results[2].time, 2000); assert.equal(results[2].singer, 's2'); assert.equal(results[2].phonetic, 'pin:我愛你');
  assert.deepEqual(Array.from(results[2].words, word => [word.time, word.duration, word.phonetic]), [[2000,100,'pin:我'],[2100,200,'pin:愛'],[2300,300,'pin:你'],[2600,100,'pin:我']]);
  assert.notEqual(results[0].words, results[1].words); assert.notEqual(results[0].words[0], results[1].words[0]);
});

test('sync readings also reuse exact text and discard cache between invocations', () => {
  const calls = []; const romanizer = romanizerFixture({ pinyin: text => { calls.push(text); return `pin:${text}`; } });
  const result = romanizer.addRomanizationSync(repeatedChinese()); assert.equal(calls.length, 4);
  assert.equal(result[1].words[3].phonetic, 'pin:我');
  romanizer.addRomanizationSync(repeatedChinese()); assert.equal(calls.length, 8);
});

test('async reading cache is limited to one song and does not normalize distinct text spellings together', async () => {
  const calls = []; const romanizer = romanizerFixture({ pinyin: text => { calls.push(text); return `pin:${text}`; } });
  const lines = [{ text: '我愛你' }, { text: '我 愛你' }, { text: '我愛你' }];
  await romanizer.addRomanization(lines); assert.deepEqual(calls, ['我愛你', '我 愛你']);
  await romanizer.addRomanization(lines); assert.equal(calls.length, 4);
});

test('a failed pinyin conversion is retried on the next invocation instead of staying cached', async () => {
  let available = false;
  const romanizer = romanizerFixture({ pinyin: text => { if (!available) throw new Error('temporarily unavailable'); return `pin:${text}`; } });
  const first = await romanizer.addRomanization(repeatedChinese());
  assert.equal(first[0].phonetic, '我愛你'); assert.equal(first[2].words[0].phonetic, '我');
  available = true;
  const second = await romanizer.addRomanization(repeatedChinese());
  assert.equal(second[0].phonetic, 'pin:我愛你'); assert.equal(second[2].words[0].phonetic, 'pin:我');
});

function japaneseFixture(options = {}) {
  const calls = [];
  const tokens = {
    '君に会いたい': [{ surface_form: '君', reading: 'キミ', pos: '名詞' }, { surface_form: 'に', reading: 'ニ', pos: '助詞' }, { surface_form: '会いたい', reading: 'アイタイ', pos: '動詞' }],
    '君': [{ surface_form: '君', reading: 'キミ', pos: '名詞' }],
    '会いたい': [{ surface_form: '会いたい', reading: 'アイタイ', pos: '動詞' }],
  };
  const tokenizer = { tokenize: text => { calls.push(text); return tokens[text] || [{ surface_form: text }]; } };
  return { romanizer: romanizerFixture({ tokenizer, ...options }), calls };
}
const japaneseLines = () => [0, 1].map(i => ({ time: i * 1000, text: '君に会いたい', words: [{ text: '君', time: i * 1000, duration: 200 }, { text: 'に', time: i * 1000 + 200, duration: 100 }, { text: '会いたい', time: i * 1000 + 300, duration: 700 }] }));

test('Japanese repeated line/word readings share tokenization but each line owns its ruby segments', async () => {
  const { romanizer, calls } = japaneseFixture(); const input = japaneseLines();
  const result = await romanizer.addRomanization(input);
  assert.deepEqual(calls, ['君に会いたい', '君', '会いたい']);
  assert.equal(result[0].words[0].phonetic, 'kimi');
  assert.deepEqual(plain(result[0].furigana), [{ text: '君', reading: 'きみ' }, { text: 'に' }, { text: '会', reading: 'あ' }, { text: 'いたい' }]);
  assert.deepEqual(plain(result[0].furigana), plain(result[1].furigana));
  assert.notEqual(result[0].furigana, result[1].furigana); assert.notEqual(result[0].furigana[0], result[1].furigana[0]);
  result[0].furigana[0].reading = 'manual'; assert.equal(result[1].furigana[0].reading, 'きみ');
  assert.equal(input[0].furigana, undefined); assert.equal(result[1].words[2].time, 1300);
});

test('Japanese G2P retains every whole-line occurrence and its original word boundaries', async () => {
  let request;
  const { romanizer } = japaneseFixture({
    g2p: async (texts, options) => { request = { texts: Array.from(texts), lengths: plain(options.wordLengths) }; return texts.map((text, i) => ({ phonemes: [`line${i}`], words: options.wordLengths[i].map((_, j) => [`word${i}${j}`]) })); },
    mapper: phonemes => phonemes.join(''),
  });
  const input = japaneseLines(); input[0].xieyin = '整句手動'; input[0].xieyinManual = true;
  input[1].words[1].xieyin = '逐字手動'; input[1].words[1].xieyinManual = true;
  const result = await romanizer.addRomanization(input);
  assert.deepEqual(request, { texts: ['君に会いたい','君に会いたい'], lengths: [[1,1,4],[1,1,4]] });
  assert.equal(result[0].xieyin, '整句手動'); assert.equal(result[1].xieyin, 'line1');
  assert.equal(result[1].words[1].xieyin, '逐字手動'); assert.equal(result[1].words[2].xieyin, 'word12');
});

test('missing Japanese engines retain fallback output and retry G2P on the next invocation', async () => {
  let calls = 0;
  const romanizer = romanizerFixture({ unavailable: true, g2p: async () => { calls++; throw new Error('unavailable'); } });
  const input = japaneseLines(); const first = await romanizer.addRomanization(input); const second = await romanizer.addRomanization(input);
  assert.deepEqual(plain(first), plain(second)); assert.equal(calls, 2);
  assert.equal(first[0].furigana, undefined); assert.ok(first[0].words[0].phonetic); assert.ok(first[0].xieyin);
});

test('concurrent song invocations keep separate reading results and mutable output objects', async () => {
  const { romanizer, calls } = japaneseFixture();
  const [a, b] = await Promise.all([romanizer.addRomanization(japaneseLines()), romanizer.addRomanization(japaneseLines())]);
  assert.equal(calls.length, 6); assert.deepEqual(plain(a), plain(b));
  a[0].words[0].phonetic = 'changed'; assert.equal(b[0].words[0].phonetic, 'kimi');
});

test('empty, Korean and Latin lyrics retain existing output behavior', async () => {
  const romanizer = romanizerFixture({ unavailable: true });
  assert.deepEqual(plain(await romanizer.addRomanization(null)), []);
  const lines = [{ time: 1, text: '안녕', words: [{ text: '안녕', duration: 2 }] }, { time: 3, text: '안녕' }];
  const result = await romanizer.addRomanization(lines);
  assert.equal(result[0].phonetic, romanizer.koreanToRomaja('안녕')); assert.equal(result[1].phonetic, result[0].phonetic); assert.ok(result[0].xieyin);
  const latin = [{ time: 1, text: 'Hello', words: [{ text: 'Hello', duration: 2 }] }, { time: 3, text: '' }];
  assert.deepEqual(plain(await romanizer.addRomanization(latin)), [{ ...latin[0], phonetic: 'Hello', words: [{ ...latin[0].words[0], phonetic: 'Hello' }] }, { ...latin[1], phonetic: '' }]);
});
