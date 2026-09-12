'use strict';

/**
 * Xieyin v2 mapper 單元測試（docs/JAPANESE-XIEYIN-V2-PLAN.md Phase 3）。
 *
 * 每筆 phoneme 陣列都是實際跑過 haqumei 0.12.0（Windows x64 wheel）驗證過的
 * 真實輸出，不是憑空編的假資料——見 2026-09-13 技術 spike 紀錄。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { phonemesToXieyinV2, groupIntoMorae, moraicNasalChar } = require('../server/services/xieyin-v2-mapper');

test('普通假名：こんにちは', () => {
  const out = phonemesToXieyinV2(['k', 'o', 'N', 'n', 'i', 'ch', 'i', 'w', 'a']);
  assert.equal(out, '摳恩尼七哇');
});

test('促音（っ）：がっこう 保留頓一下的語感，不直接吃掉重複子音', () => {
  const out = phonemesToXieyinV2(['g', 'a', 'cl', 'k', 'o', 'o']);
  assert.equal(out, '嘎‧摳－');
  assert.ok(out.includes('‧'), '促音必須留下標記，不能被靜默吃掉');
});

test('促音（っ）：ちょっと', () => {
  const out = phonemesToXieyinV2(['ch', 'o', 'cl', 't', 'o']);
  assert.equal(out, '秋‧托');
});

test('長音（ー）：おねえさん 保留延長資訊，不吞掉第二個母音', () => {
  const out = phonemesToXieyinV2(['o', 'n', 'e', 'e', 's', 'a', 'N']);
  assert.equal(out, '歐內－撒恩');
  assert.ok(out.includes('－'), '長音必須留下延長標記');
});

test('長音（ー）：コーヒー 片假名版', () => {
  const out = phonemesToXieyinV2(['k', 'o', 'o', 'h', 'i', 'i']);
  assert.equal(out, '摳－希－');
});

test('撥音（ん）+ 雙唇音（p/b/m）語境：さんぽ 用姆而非通用恩', () => {
  const out = phonemesToXieyinV2(['s', 'a', 'N', 'p', 'o']);
  assert.equal(out, '撒姆坡');
});

test('撥音（ん）+ 軟顎音（k/g）語境：げんき 用嗯而非通用恩', () => {
  const out = phonemesToXieyinV2(['g', 'e', 'N', 'k', 'i']);
  assert.equal(out, '葛嗯ki');
});

test('撥音（ん）+ 母音語境：れんあい 用預設恩', () => {
  const out = phonemesToXieyinV2(['r', 'e', 'N', 'a', 'i']);
  assert.equal(out, '勒恩阿伊');
});

test('拗音：きょう 以 mora 整體查表，不是兩個音節硬拼', () => {
  const out = phonemesToXieyinV2(['ky', 'o', 'o']);
  assert.equal(out, 'ki唷－');
});

test('助詞は 已由上游 G2P 正確讀成 wa：今日は晴れです', () => {
  // haqumei 對「今日は」給的是 kyoo-wa（哇），不是字面假名 ha（哈）——
  // 這正是整個 v2 計畫要解決的問題，這裡驗證 mapper 沒有把它拼錯。
  const out = phonemesToXieyinV2(['ky', 'o', 'o', 'w', 'a', 'h', 'a', 'r', 'e', 'd', 'e', 's', 'U']);
  assert.ok(out.includes('哇'), '助詞は必須讀成哇（wa），不能是哈（ha）');
});

test('清化母音 U／I 正規化：不會被當成未知音素原樣吐出羅馬字', () => {
  const out = phonemesToXieyinV2(['d', 'e', 's', 'U']);
  assert.ok(!/[a-zA-Z]/.test(out.replace(/ki|gi/g, '')), '清化母音不應以大寫字母殘留在輸出裡');
});

test('外來語：ヴァイオリン（v 音與 b 音要分開）', () => {
  const out = phonemesToXieyinV2(['v', 'a', 'i', 'o', 'r', 'i', 'N']);
  assert.ok(out.startsWith('哇'), 'ヴァ 應查到外來語專用的 va 條目');
});

test('未知輔音不吃掉整行：孤立輔音原樣輸出，不拋例外', () => {
  assert.doesNotThrow(() => phonemesToXieyinV2(['z', 'z']));
});

test('空輸入回傳空字串', () => {
  assert.equal(phonemesToXieyinV2([]), '');
  assert.equal(phonemesToXieyinV2(undefined), '');
});

test('pau 停頓不會在開頭／結尾殘留標點，連續 pau 收斂成一個', () => {
  const out = phonemesToXieyinV2(['pau', 'a', 'pau', 'pau', 'i', 'pau']);
  assert.equal(out, '阿，伊');
});

test('groupIntoMorae：促音只影響緊接著的下一個輔音，不會漏標或多標', () => {
  const morae = groupIntoMorae(['a', 'cl', 't', 'a']);
  assert.equal(morae.length, 2);
  assert.equal(morae[0].geminate, false);
  assert.equal(morae[1].geminate, true);
});

test('moraicNasalChar：邊界情況（undefined = 字尾ん）落在預設組', () => {
  assert.equal(moraicNasalChar(undefined), '恩');
  assert.equal(moraicNasalChar('p'), '姆');
  assert.equal(moraicNasalChar('k'), '嗯');
});
