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

// ─── 2026-11-21：50 首中國熱門歌 × 6 個來源實測補上的規則 ───
const timed = (rows) => rows.map(([time, duration, text]) => ({ time, duration, text }));
const sung = (from, n = 4) => Array.from({ length: n }, (_, i) => [from + i * 5000, 4000, `第${i + 1}句正文歌词`]);

test('Apple Music 系：角色名被拿掉、只剩人名的名單，靠前奏裡的短時長認出來', () => {
  // 光年之外：標題＋三行人名（每行不到 1 秒）＋正文
  const a = timed([[0, 5791, '光年之外 (《太空旅客》电影中国区主题曲) - G.E.M.邓紫棋'], [8590, 381, 'Lupo Groinig'],
    [9140, 717, '蜂鸟音乐'], [10050, 869, '百纳娱乐'], ...sung(12540)]);
  assert.deepEqual(cleanLyrics(a).map((l) => l.text), sung(12540).map((r) => r[2]));
  // 善变：只有歌名、接著人名與夾雜的確定名單
  const b = timed([[0, 928, '善变'], [2160, 462, '米嘉郁'], [3550, 462, '孙大雄'], [6960, 1251, '和声Backing Vocals: 王韩一淋'],
    [9140, 396, '老田'], [9740, 1260, '配唱制作人Vocal Producer: 杨沛'], ...sung(18000)]);
  assert.deepEqual(cleanLyrics(b).map((l) => l.text), sung(18000).map((r) => r[2]));
  // 我曾：0 秒的緊湊標題後面全是人名（沒有角色名）
  const c = timed([[0, 130, '我曾-隔壁老樊'], [710, 63, '祁大为'], [850, 52, '韩阳'], [1470, 90, '北京好听音乐录音棚'], ...sung(1820)]);
  assert.deepEqual(cleanLyrics(c).map((l) => l.text), sung(1820).map((r) => r[2]));
});

test('時長規則不吃正文：饒舌快句、口白、名單後第一句唱得快的歌詞都留著', () => {
  const rap = timed([[25030, 1373, "The dance floor's tempo's hot as sauna"], [26420, 1156, "So I'm gonna freak up on ya"],
    [27610, 879, 'Do it how we did it'], ...sung(30000)]);
  assert.equal(cleanLyrics(rap).length, rap.length, '沒有標題／名單佐證的快句不動');
  const talk = timed([[10, 120, '那个'], [130, 710, '一一一一一个'], [1130, 560, '大家好'], ...sung(5000)]);
  assert.equal(cleanLyrics(talk).length, talk.length);
  const afterCredits = timed([[100, 100, '复刻回忆 - 薛凯琪/方大同'], [200, 100, '词：易家扬'], [300, 100, '曲：桑田佳佑'],
    [28640, 1120, '女：你还好吗'], [30640, 1180, '好久不见'], ...sung(33000)]);
  assert.equal(cleanLyrics(afterCredits)[0].text, '女：你还好吗');
  const fastFirst = timed([[0, 5580, '扛坝子 - 草屯囝仔'], [5580, 5590, '词：陈枢育'], [11170, 5590, '曲：陈枢育'],
    [27940, 1398, '是啥时有咚咚猜'], ...sung(29340)]);
  assert.equal(cleanLyrics(fastFirst)[0].text, '是啥时有咚咚猜');
});

test('夾在兩行名單中間的陌生角色、超長名單、各種標題行與聲明', () => {
  const run = (texts, step = 1000) => cleanLyrics(texts.map((text, i) => ({ time: 300 + i * step, text }))).map((l) => l.text);
  const body = ['还记得 妈妈说', '青春来做赌注', '我要听着亲戚们的闲话'];
  assert.deepEqual(run(['从前说', '词：刘通', '和声：赫拉Hera', '合唱：一寸光年团队', '艺人统筹：YY 音乐@云云、君君',
    '【未经著作权人许可不得翻唱翻录或使用】', ...body]), body);
  // 名單超過 50 行（紀錄片主題曲）
  const long = Array.from({ length: 60 }, (_, i) => `制作人：某人${i}`);
  assert.deepEqual(run([...long, ...body]), body);
  // 網易雲：詞曲、標題、再一次詞曲
  assert.deepEqual(run([' 作词 : 樊冲', ' 作曲 : 樊冲', '我要你 - 任素汐', '词：樊冲', '曲：樊冲', ...body]), body);
  // 長篇 AI 訓練條款聲明、以「出品」收尾的結尾行、多角色合寫的長標籤
  assert.equal(isCreditLine({ text: '【未经著作权人许可，不得翻唱翻录重制或任何形式的使用，禁止用于任何人工智能(AI)的训练、模仿、学习、生成等相关活动】' }), true);
  assert.equal(isCreditLine({ text: '网易云音乐特别企划“回声不息”出品' }), true);
  assert.equal(isCreditLine({ text: 'Programing / Guitars / Keyboards &Sythn : 朴树' }), true);
  assert.equal(isCreditLine({ text: '汝文博@SBMS Beijing' }), true);
  assert.equal(isCreditLine({ text: '这首歌我们一起出品' }), true, '以出品收尾的短句當名單（已知取捨）');
  assert.equal(isCreditLine({ text: '我们出品，你来唱' }), false, '有標點的句子不算');
});

test('0 秒的標題行：有空白的破折號、或緊湊寫法帶括號', () => {
  const run = (head) => cleanLyrics([{ time: 0, text: head }, ...['一', '二', '三', '四'].map((t, i) => ({ time: 19000 + i * 4000, text: `第${t}句` }))])
    .map((l) => l.text)[0];
  assert.equal(run('岁月神偷(Demo)-金玟岐(Vanessa)'), '第一句');
  assert.equal(run('那些年 - 胡夏'), '第一句');
  assert.equal(run('Oh-oh'), 'Oh-oh', '沒括號的緊湊連字號不算標題');
});

test('正文開頭碰巧有冒號的句子不受影響', () => {
  const lines = ['Edited out of the picture', 'line two', 'line three'].map((text, i) => ({ time: 5000 + i * 3000, text }));
  assert.deepEqual(cleanLyrics(lines).map((l) => l.text), ['Edited out of the picture', 'line two', 'line three']);
});
