'use strict';

/**
 * upgradeJapaneseXieyinWithV2() 的逐字（KRC word）覆蓋範圍。
 *
 * 不依賴真的 haqumei runtime：直接把 getSharedG2PProvider() 拿到的共用
 * provider 的 g2pBatch 換成假實作，鎖住「整行文字＋所有逐字文字合成同一批
 * 送出、結果依同一個順序切回 line.xieyin／word.xieyin」這個索引對應關係——
 * 這是最容易因為重構而悄悄錯位、又不會讓測試直接爆炸（只會诸如把某個字的
 * 諧音套到另一個字上）的地方。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { upgradeJapaneseXieyinWithV2, getSharedG2PProvider } = require('../server/services/romanizer');

function fakePhonemesFor(text) {
  // 不需要真的語言學正確——只要每個輸入文字對應到獨一無二、看得出來源的
  // phoneme，就能驗證「有沒有送對批次順序」。
  return [...text].map((ch) => ch.charCodeAt(0).toString());
}

test('整行與逐字 word 合成同一批送出，結果依原順序正確切回各自的 xieyin', async (t) => {
  const provider = getSharedG2PProvider();
  const originalG2pBatch = provider.g2pBatch.bind(provider);
  const seenTexts = [];
  provider.g2pBatch = async (texts) => {
    seenTexts.push(...texts);
    return texts.map((text) => ({ phonemes: fakePhonemesFor(text), kana: text }));
  };
  t.after(() => { provider.g2pBatch = originalG2pBatch; });

  const results = [
    {
      text: 'アイウ',
      xieyin: 'legacy-line-1',
      words: [{ text: 'ア', xieyin: 'legacy-word-a' }, { text: 'イウ', xieyin: 'legacy-word-b' }],
    },
    {
      text: 'エオ',
      xieyin: 'legacy-line-2',
      words: [{ text: 'エ', xieyin: 'legacy-word-c' }],
    },
  ];

  await upgradeJapaneseXieyinWithV2(results);

  // 送出順序：先所有整行文字，再所有逐字 word 文字（依原本在 results 裡出現的順序）。
  assert.deepEqual(seenTexts, ['アイウ', 'エオ', 'ア', 'イウ', 'エ']);

  // 每一行/每一個字都拿到「自己那筆」算出來的結果，不是被鄰居的蓋掉。
  assert.equal(results[0].xieyin, fakePhonemesFor('アイウ').join(''));
  assert.equal(results[1].xieyin, fakePhonemesFor('エオ').join(''));
  assert.equal(results[0].words[0].xieyin, fakePhonemesFor('ア').join(''));
  assert.equal(results[0].words[1].xieyin, fakePhonemesFor('イウ').join(''));
  assert.equal(results[1].words[0].xieyin, fakePhonemesFor('エ').join(''));
});

test('G2P 失敗時，整行與逐字的舊版羅馬字諧音都完整保留', async (t) => {
  const provider = getSharedG2PProvider();
  const originalG2pBatch = provider.g2pBatch.bind(provider);
  provider.g2pBatch = async () => { throw Object.assign(new Error('boom'), { code: 'ENGINE_CRASHED' }); };
  t.after(() => { provider.g2pBatch = originalG2pBatch; });

  const results = [
    { text: 'アイウ', xieyin: 'legacy-line', words: [{ text: 'ア', xieyin: 'legacy-word' }] },
  ];
  await assert.doesNotReject(() => upgradeJapaneseXieyinWithV2(results));
  assert.equal(results[0].xieyin, 'legacy-line');
  assert.equal(results[0].words[0].xieyin, 'legacy-word');
});

test('沒有 words 陣列的行（一般 LRC）不受影響，只處理整行', async (t) => {
  const provider = getSharedG2PProvider();
  const originalG2pBatch = provider.g2pBatch.bind(provider);
  const seenTexts = [];
  provider.g2pBatch = async (texts) => {
    seenTexts.push(...texts);
    return texts.map((text) => ({ phonemes: fakePhonemesFor(text), kana: text }));
  };
  t.after(() => { provider.g2pBatch = originalG2pBatch; });

  const results = [{ text: 'アイウ', xieyin: 'legacy' }];
  await upgradeJapaneseXieyinWithV2(results);
  assert.deepEqual(seenTexts, ['アイウ']);
  assert.equal(results[0].xieyin, fakePhonemesFor('アイウ').join(''));
});

test('空字串的 word 不會被送進 G2P（跟整行的空字串過濾規則一致）', async (t) => {
  const provider = getSharedG2PProvider();
  const originalG2pBatch = provider.g2pBatch.bind(provider);
  const seenTexts = [];
  provider.g2pBatch = async (texts) => {
    seenTexts.push(...texts);
    return texts.map((text) => ({ phonemes: fakePhonemesFor(text), kana: text }));
  };
  t.after(() => { provider.g2pBatch = originalG2pBatch; });

  const results = [
    { text: 'アイ', xieyin: 'legacy', words: [{ text: 'ア' }, { text: '  ' }, { text: '' }, { text: 'イ' }] },
  ];
  await upgradeJapaneseXieyinWithV2(results);
  assert.deepEqual(seenTexts, ['アイ', 'ア', 'イ']);
});
