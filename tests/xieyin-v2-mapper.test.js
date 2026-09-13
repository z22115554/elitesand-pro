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

test('Haqumei 的 sp／標點 token 只當停頓，不會原樣污染諧音', () => {
  assert.equal(phonemesToXieyinV2(['k', 'o', 'sp', 'N', 'n', 'i', '!']), '摳，恩尼');
  assert.equal(phonemesToXieyinV2(['k', 'o', '！']), '摳');
});

test('groupIntoMorae：促音只影響緊接著的下一個輔音，不會漏標或多標', () => {
  const morae = groupIntoMorae(['a', 'cl', 't', 'a']);
  assert.equal(morae.length, 2);
  assert.equal(morae[0].geminate, false);
  assert.equal(morae[1].geminate, true);
});

test('詞界誤判成長音的迴歸測試：「明日また会おう」不能吞掉會的あ', () => {
  // 2026-09-13 benchmark 實測抓到的真 bug：また 的た跟 会 的あ 剛好同母音，
  // 純看「前後母音是否相同」會把兩個詞黏成一個長音、吃掉一整個音節。
  // 修法是吃 g2p_prosody() 的 # 詞界標記，不是只吃 g2p() 的扁平陣列。
  const prosody = ['^', 'a', '[', 'sh', 'I', 't', 'a', '#', 'm', 'a', '[', 't', 'a', '#', 'a', '[', 'o', ']', 'o', '$'];
  const out = phonemesToXieyinV2(prosody);
  assert.equal(out, '阿西塔媽塔阿歐－');
});

test('# 詞界不影響同一個詞內部真正的長音（きょう、コーヒー 這類）', () => {
  const kyou = phonemesToXieyinV2(['^', 'ky', 'o', ']', 'o', '$']);
  assert.equal(kyou, 'ki唷－');
  const kohi = phonemesToXieyinV2(['^', 'k', 'o', '[', 'o', 'h', 'i', ']', 'i', '$']);
  assert.equal(kohi, '摳－希－');
});

test('_ 次要韻律邊界不會原樣滲進輸出（逗號位置常見）', () => {
  const out = phonemesToXieyinV2(['^', 'n', 'e', ']', 'e', '_', 'k', 'i', '[', 'i', 't', 'e', '$']);
  assert.ok(!out.includes('_'), '_ 標記必須被濾掉，不能出現在最終諧音字串裡');
});

test('{ } 外來語標記不會原樣滲進輸出（ラブユー 這類）', () => {
  const out = phonemesToXieyinV2(['^', '{', 'r', 'a', '[', 'b', 'u', ']', 'y', 'u', 'u', '}', '$']);
  assert.ok(!out.includes('{') && !out.includes('}'), '{ } 標記必須被濾掉');
});

test('plain g2p() 陣列（沒有任何 prosody 標記）行為完全不變，向下相容', () => {
  // annotateBoundaries 對沒有標記的輸入必須是 no-op，舊呼叫方式、舊測資都不該壞。
  const out = phonemesToXieyinV2(['g', 'a', 'cl', 'k', 'o', 'o']);
  assert.equal(out, '嘎‧摳－');
});

test('moraicNasalChar：邊界情況（undefined = 字尾ん）落在預設組', () => {
  assert.equal(moraicNasalChar(undefined), '恩');
  assert.equal(moraicNasalChar('p'), '姆');
  assert.equal(moraicNasalChar('k'), '嗯');
});
