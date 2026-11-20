'use strict';
// 歌詞清洗：國際發行的英文製作名單（Digital Edited by／Mixed in Dolby Atmos by／Publishers）。
// 實例是「还痛吗 (Gone (Chinese ver.))」的 KRC：中間一行沒認出來，首段清洗就停手，
// 後面的「Bass：」「Piano：」被合唱聲部當成演唱者，正文整首掛上 Piano 聲部。
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanLyrics, isCreditLine } = require('../server/services/lyrics-cleaner');
const { LyricsEngine } = require('../server/services/lyrics-engine');

test('英文製作名單：剪輯、杜比全景聲混音、發行商都算製作資訊', () => {
  for (const text of [
    'Digital Edited by：강동호/강로이 @Cube Studio',
    'Mixed in Dolby Atmos by：김용운 (goodear) @SOUNDRAGON',
    "Original Publishers：CUBE ENTERTAINMENT, INC. for 우기/TME Producers' Studio",
    'Sub-Publishers：Peermusic (Worldwide) for 우기',
    'Editor: X',
    'Mixed: Y',
  ]) {
    assert.equal(isCreditLine({ text }), true, text);
  }
  // 詞邊界照舊：含這些字母但不是角色的正文不算
  for (const text of ['Credit: where it is due', 'Mixtape: one more song', 'Remastered love: tonight', 'Pedit: no']) {
    assert.equal(isCreditLine({ text }), false, text);
  }
});

test('还痛吗 KRC：首段 21 行名單整段清掉，正文不掛樂器聲部', () => {
  const roles = [
    'Lyrics by：우기/우석', 'Composed by：우기/우석/Siixk Jun', 'Arranged by：Siixk Jun',
    'Background Vocal：우기/우석/진혁', 'Bass：Cheatkey', 'Guitar：노경환/Krap', 'Drum Programming：Siixk Jun',
    'Piano：Siixk Jun', 'Recorded by：강로이 @Cube Studio', 'Digital Edited by：강동호/강로이 @Cube Studio',
    'Vocal Mixed by：강로이 @Cube Studio', 'Mastered by：Chris Godbey @Furndware Studio',
    'Mixed in Dolby Atmos by：김용운 (goodear) @SOUNDRAGON', 'Original Publishers：CUBE ENTERTAINMENT, INC. for 우기',
    'Sub-Publishers：Peermusic (Worldwide) for 우기', 'Bass：Cheatkey', 'Guitar：Alex Noh/Krap', 'Piano：Siixk Jun',
  ];
  const ts = (ms) => `[${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000 / 10)).padStart(2, '0')}]`;
  const krcLine = (ms, text) => `${ts(ms)}<500>${text.split(' ').map((w, i, a) => `${w}${i < a.length - 1 ? ' ' : ''}<${i * 60},60>`).join('')}`;
  const body = ['还痛吗', '回忆太锋利总不听话咽不下', '是雨吗泪吗算了吧', '还会痛吗'];
  const raw = [
    krcLine(0, '还痛吗 (Gone (Chinese ver.)) - 宋雨琦 (YUQI)'),
    ...roles.map((text, i) => krcLine(800 + i * 400, text)),
    ...body.map((text, i) => krcLine(16000 + i * 5000, text)),
  ].join('\n');
  const out = LyricsEngine.parseKrc(raw);
  assert.deepEqual(out.map((l) => l.text), body);
  assert.ok(out.every((l) => !l.singerLabel), '正文不可掛上 Bass／Piano 之類的聲部');
});

test('中文名單：樂器（大提琴／口琴／烏克麗麗）、指導、專輯、表演者、人名@工作室、假冒號、ISRC', () => {
  for (const text of [
    '大提琴：张平', '口琴 : 姜育恒', '乌克丽丽：JerryC', '艺术指导：程楚楚', '专辑：君再来', '表演者：周笔畅',
    '白话字：阿仁A-jîn', 'cello：颜群桀', '王禹茨@维伴音乐', 'PGM：王禹茨@维伴音乐', '作词∶梁弘志作曲∶梁弘志', 'G00302102',
  ]) {
    assert.equal(isCreditLine({ text }), true, text);
  }
  for (const text of ['我在琴房等你', '大提琴的声音', '2001', 'I miss you missing me', '豫&秦:连就连']) {
    assert.equal(isCreditLine({ text }), false, text);
  }
});

test('凝眸：名單中段的「大提琴」不再讓清洗停手', () => {
  const texts = ['凝眸 (《永夜星河》影视剧惊喜曲) - 丁禹兮', '词：陈可心', '曲：胡宸@U.M.C', '钢琴演奏：李方睿@U.M.C',
    '弦乐：国际首席爱乐乐团', '大提琴：张平', '吉他/贝斯：刘苏毅@U.M.C', '和声：海青', '监制：王一栩/张宇成',
    '说不清缘故', '我 为何只顾着', '将你拥住'];
  const lines = texts.map((text, i) => ({ time: i < 9 ? i * 900 : 16000 + i * 2000, text }));
  assert.deepEqual(cleanLyrics(lines).map((l) => l.text), ['说不清缘故', '我 为何只顾着', '将你拥住']);
});

test('不在第 0 行、沒有破折號的標題，緊接名單時一起清掉；正文開頭不受影響', () => {
  const run = (texts) => cleanLyrics(texts.map((text, i) => ({ time: 3000 + i * 4000, text }))).map((l) => l.text);
  assert.deepEqual(run(['默契', '词：王伯君曲：萧蔓萱', '发行：广东飞碟文化传播有限公司', '脱下外衣', '我关在车门里', '你说']),
    ['脱下外衣', '我关在车门里', '你说']);
  assert.deepEqual(run(['我只能相信你', '------熊天平 阮丹青', '作词 作曲:陈晓娟', '我知道她跟你还有联系', '第二句', '第三句']),
    ['我知道她跟你还有联系', '第二句', '第三句']);
  // 只有「兩句＋結尾名單」：前兩句是正文，不是標題
  assert.deepEqual(run(['第一句', '第二句', '作词：某人', '作曲：某人']), ['第一句', '第二句']);
  // 只有一行名單、前面又不像標題：寧可留著，不砍正文
  assert.deepEqual(run(['第一句歌词', '作词：某人', '第二句歌词', '第三句']), ['第一句歌词', '作词：某人', '第二句歌词', '第三句']);
});

test('結尾名單後面的 ISRC 編號一起清掉', () => {
  const texts = ['最后一句', '混音师 : 张永夫', 'OP : Munbo Int\'l Corp', 'SP : Universal Music Publishing Ltd. Taiwan', 'G00302102'];
  assert.deepEqual(cleanLyrics(texts.map((text, i) => ({ time: 200000 + i * 800, text }))).map((l) => l.text), ['最后一句']);
});

test('正文開頭碰巧有冒號的句子不受影響', () => {
  const lines = ['Edited out of the picture', 'line two', 'line three'].map((text, i) => ({ time: 5000 + i * 3000, text }));
  assert.deepEqual(cleanLyrics(lines).map((l) => l.text), ['Edited out of the picture', 'line two', 'line three']);
});
