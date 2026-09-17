'use strict';

/**
 * upgradeJapaneseXieyinWithV2() 的逐字（KRC word）覆蓋範圍。
 *
 * 不依賴真的 haqumei runtime：直接把 getSharedG2PProvider() 拿到的共用
 * provider 的 g2pBatch 換成假實作，鎖住「整句連同 wordLengths 一起送、
 * 回應的 words 陣列依序切回每個 word.xieyin」這個索引對應關係——這是最
 * 容易因為重構而悄悄錯位、又不會讓測試直接爆炸（只會把某個字的諧音套到
 * 另一個字上）的地方。
 *
 * 2026-09 改版：逐字改成「整句一起做，伺服端依字元數切回逐字」（見
 * romanizer.js 的函式註解），不再是每個 word 各自獨立呼叫 g2pBatch——
 * 這裡的假 provider 模擬的正是 ai/haqumei_sidecar.py 的 wordLengths 協定。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { upgradeJapaneseXieyinWithV2, getSharedG2PProvider } = require('../server/services/romanizer');

function withFakeProvider(t, impl) {
  const provider = getSharedG2PProvider();
  const original = provider.g2pBatch.bind(provider);
  provider.g2pBatch = impl;
  t.after(() => { provider.g2pBatch = original; });
  return provider;
}

test('整句文字連同 wordLengths 一起送出，只呼叫一次 g2pBatch', async (t) => {
  const calls = [];
  withFakeProvider(t, async (texts, opts) => {
    calls.push({ texts, wordLengths: opts && opts.wordLengths });
    return texts.map(() => ({ phonemes: [], kana: '' }));
  });

  const results = [
    { text: 'アイウ', xieyin: 'legacy-line-1', words: [{ text: 'ア' }, { text: 'イウ' }] },
    { text: 'エオ', xieyin: 'legacy-line-2' }, // 一般 LRC 行，沒有 words
  ];
  await upgradeJapaneseXieyinWithV2(results);

  assert.equal(calls.length, 1, '整首歌只能發一次 IPC，不能逐句/逐字各發一次');
  assert.deepEqual(calls[0].texts, ['アイウ', 'エオ']);
  assert.deepEqual(calls[0].wordLengths, [[1, 2], null]);
});

test('回應的 words 陣列依序切回每個 word.xieyin，line.xieyin 也正確更新', async (t) => {
  withFakeProvider(t, async (texts) => texts.map((text) => ({
    phonemes: [`line:${text}`],
    kana: text,
    words: text === 'アイウ' ? [['w:ア'], ['w:イウ']] : undefined,
  })));

  const results = [
    { text: 'アイウ', xieyin: 'legacy-line', words: [{ text: 'ア', xieyin: 'legacy-a' }, { text: 'イウ', xieyin: 'legacy-b' }] },
  ];
  await upgradeJapaneseXieyinWithV2(results);

  assert.equal(results[0].xieyin, 'line:アイウ');
  assert.equal(results[0].words[0].xieyin, 'w:ア');
  assert.equal(results[0].words[1].xieyin, 'w:イウ');
});

test('某個 word 分到空 phoneme 陣列時（KRC 邊界切在 Haqumei 詞中間的已知取捨），保留舊版諧音、不覆蓋成空字串', async (t) => {
  withFakeProvider(t, async (texts) => texts.map(() => ({
    phonemes: ['x'],
    kana: '',
    words: [['w:ok'], []], // 第二個 word 沒分到任何 phoneme
  })));

  const results = [
    { text: 'アイ', xieyin: 'legacy-line', words: [{ text: 'ア', xieyin: 'legacy-a' }, { text: 'イ', xieyin: 'legacy-b' }] },
  ];
  await upgradeJapaneseXieyinWithV2(results);

  assert.equal(results[0].words[0].xieyin, 'w:ok');
  assert.equal(results[0].words[1].xieyin, 'legacy-b', '空結果不能把既有的羅馬字諧音蓋成空白');
});

test('G2P 失敗時，整行與逐字的舊版羅馬字諧音都完整保留', async (t) => {
  withFakeProvider(t, async () => { throw Object.assign(new Error('boom'), { code: 'ENGINE_CRASHED' }); });

  const results = [
    { text: 'アイウ', xieyin: 'legacy-line', words: [{ text: 'ア', xieyin: 'legacy-word' }] },
  ];
  await assert.doesNotReject(() => upgradeJapaneseXieyinWithV2(results));
  assert.equal(results[0].xieyin, 'legacy-line');
  assert.equal(results[0].words[0].xieyin, 'legacy-word');
});

test('沒有任何日文行時完全不呼叫 g2pBatch', async (t) => {
  let called = false;
  withFakeProvider(t, async () => { called = true; return []; });
  await upgradeJapaneseXieyinWithV2([{ text: '' }, { text: '   ' }]);
  assert.equal(called, false);
});
