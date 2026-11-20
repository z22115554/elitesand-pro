'use strict';
// 歌詞來源：BetterLyrics 與 Apple Music 同時問，順位不變。
const test = require('node:test');
const assert = require('node:assert/strict');
const { LyricsEngine } = require('../server/services/lyrics-engine');

const KRC = '[00:01.00]<900>第一句<0,900>\n[00:02.00]<900>第二句<0,900>\n[00:03.00]<900>第三句<0,900>\n[00:04.00]<900>第四句<0,900>';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stubSources(t, { better, apple }) {
  const calls = [];
  const fakes = {
    searchBetterLyrics: async () => { calls.push('betterlyrics'); await sleep(300); return better; },
    searchPaxsenix: async () => { calls.push('paxsenix'); await sleep(300); return apple; },
    searchKugou: async () => { calls.push('kugou'); return null; },
    searchQQMusic: async () => { calls.push('qqmusic'); return null; },
    searchLrclib: async () => { calls.push('lrclib'); return null; },
    searchNetease: async () => { calls.push('netease'); return null; },
  };
  for (const [name, fn] of Object.entries(fakes)) t.mock.method(LyricsEngine, name, fn);
  LyricsEngine.resetProviderHealth();
  return calls;
}

const search = (title) => LyricsEngine._searchUncached('某歌手', title, 0, false, `某歌手 ${title}`, `prefetch-test-${title}-${Math.random()}`, -1);

test('BetterLyrics 沒有時，不用排隊等它：Apple Music 同時開始問', async (t) => {
  const calls = stubSources(t, { better: null, apple: { lyrics: KRC, type: 'krc', source: 'paxsenix' } });
  const started = Date.now();
  const result = await search('同时问');
  const elapsed = Date.now() - started;
  assert.equal(result.source, 'paxsenix');
  assert.deepEqual(calls.slice(0, 2), ['betterlyrics', 'paxsenix']);
  assert.ok(elapsed < 500, `兩個各 300ms 的來源應該重疊，實際 ${elapsed}ms`);
  assert.ok(!calls.includes('kugou'), 'Apple Music 有結果就不往下問');
});

test('BetterLyrics 有結果時照樣優先用它', async (t) => {
  stubSources(t, {
    better: { lyrics: KRC.replace(/第/g, '甲'), type: 'krc', source: 'betterlyrics' },
    apple: { lyrics: KRC, type: 'krc', source: 'paxsenix' },
  });
  const result = await search('优先');
  assert.equal(result.source, 'betterlyrics');
  assert.equal(result.parsedLyrics[0].text, '甲一句');
});

test('兩個都沒有時照原順序往下問', async (t) => {
  const calls = stubSources(t, { better: null, apple: null });
  assert.equal(await search('都没有'), null);
  assert.deepEqual(calls.filter((c, i) => calls.indexOf(c) === i).slice(0, 4), ['betterlyrics', 'paxsenix', 'kugou', 'qqmusic']);
});
