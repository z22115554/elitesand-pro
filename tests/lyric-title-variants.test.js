'use strict';
// 歌名查詢候選：原文＋英文並列的標題要能拆出只含原文／只含英文的候選。
const test = require('node:test');
const assert = require('node:assert/strict');
const { lyricTitleVariants } = require('../server/services/lyrics-engine');

test('原標題永遠是第一個候選，單語標題不多產生候選', () => {
  assert.deepEqual(lyricTitleVariants('夜に駆ける'), ['夜に駆ける']);
  assert.deepEqual(lyricTitleVariants('KICK BACK'), ['KICK BACK']);
  assert.deepEqual(lyricTitleVariants(''), []);
});

test('中文歌名後面帶英文名', () => {
  assert.deepEqual(lyricTitleVariants('與浪之間 Waves'), ['與浪之間 Waves', '與浪之間', 'Waves']);
});

test('日文、韓文歌名後面帶英文名', () => {
  assert.deepEqual(lyricTitleVariants('アイドル Idol'), ['アイドル Idol', 'アイドル', 'Idol']);
  assert.deepEqual(lyricTitleVariants('밤편지 Through the Night'), ['밤편지 Through the Night', '밤편지', 'Through the Night']);
});

test('原文與英文之間沒有空白', () => {
  assert.deepEqual(lyricTitleVariants('告白氣球Love Confession'), ['告白氣球Love Confession', '告白氣球', 'Love Confession']);
});

test('用分隔符號隔開，英文在前或在後都行', () => {
  assert.deepEqual(lyricTitleVariants('怪獣の花唄 - Kaiju no Hanauta'), ['怪獣の花唄 - Kaiju no Hanauta', '怪獣の花唄', 'Kaiju no Hanauta']);
  assert.deepEqual(lyricTitleVariants('Lemon／檸檬'), ['Lemon／檸檬', '檸檬', 'Lemon']);
  assert.deepEqual(lyricTitleVariants('Butterfly 蝴蝶'), ['Butterfly 蝴蝶', '蝴蝶', 'Butterfly']);
});

test('簡體標題多一個繁體候選，總數有上限', () => {
  const variants = lyricTitleVariants('后来 Later');
  assert.equal(variants[0], '后来 Later');
  assert.ok(variants.includes('後來'));
  assert.ok(variants.length <= 4);
});

test('太短的英文尾巴不拆，也不單獨拿來查', () => {
  assert.deepEqual(lyricTitleVariants('カブトムシ A'), ['カブトムシ A']);
  assert.deepEqual(lyricTitleVariants('愛 Ai'), ['愛 Ai', '愛']);
});

test('英文夾在原文中間的標題不拆', () => {
  assert.deepEqual(lyricTitleVariants('君の Heart に火をつけて'), ['君の Heart に火をつけて']);
});

const { lyricQueryVariants } = require('../server/services/lyric-query-variants');
const pairs = (artist, title) => lyricQueryVariants(artist, title).map((item) => `${item.artist} | ${item.title}`);

test('日文歌名不做簡轉繁', () => {
  assert.deepEqual(lyricTitleVariants('踊り子'), ['踊り子']);
  assert.deepEqual(pairs('tuki.', '孤独の鯨 - The Lonely Whale'), [
    'tuki. | 孤独の鯨 - The Lonely Whale', 'tuki. | 孤独の鯨', 'tuki. | The Lonely Whale',
  ]);
});

test('歌手欄並列的英文名也去掉，原樣那組永遠先試', () => {
  assert.deepEqual(pairs('蔡依林 Jolin Tsai', '愛的天使 Angel of Love'), [
    '蔡依林 Jolin Tsai | 愛的天使 Angel of Love', '蔡依林 | 愛的天使', '蔡依林 | Angel of Love',
  ]);
  assert.deepEqual(pairs('鄭秀文Sammi Cheng', '值得'), ['鄭秀文Sammi Cheng | 值得', '鄭秀文 | 值得']);
});

test('多位歌手：先試全部歌手的原文名，再試第一位', () => {
  assert.deepEqual(pairs('周華健 Wakin Chau & 齊豫 Chyi Yu', '天下有情人'), [
    '周華健 Wakin Chau & 齊豫 Chyi Yu | 天下有情人', '周華健 齊豫 | 天下有情人', '周華健 | 天下有情人',
  ]);
});

test('單語的歌手與歌名只有一組，候選總數不超過 4', () => {
  assert.deepEqual(pairs('KANA-BOON', 'Silhouette'), ['KANA-BOON | Silhouette']);
  assert.ok(pairs('周杰倫Jay Chou X aMEI', "不該 Shouldn't Be").length <= 4);
  assert.deepEqual(pairs('誰', ''), []);
});

const { titleMatches, artistMatches } = require('../server/services/lyric-query-variants');

test('搜尋結果的歌名對不上就不收（簡繁、括號、標點不影響）', () => {
  assert.equal(titleMatches("不該 Shouldn't Be", '发如雪'), false);
  assert.equal(titleMatches("不該 Shouldn't Be", '不该 (with aMEI)'), true);
  assert.equal(titleMatches('氧氣', '雪人'), false);
  assert.equal(titleMatches('喘氣且悲傷  (官方完整版MV)', '喘气且悲伤'), true);
  assert.equal(titleMatches('孤独の鯨 - The Lonely Whale', '孤独の鯨'), true);
  assert.equal(titleMatches('姜育恆 李翊君 愛我你怕了嗎', '爱我你怕了吗'), true);
});

test('4 個字以上只差一個字算同一首，短歌名不放寬', () => {
  assert.equal(titleMatches('或許你是對的', '或许妳是对的'), true);
  assert.equal(titleMatches('喘氣且悲傷', '喘气也悲伤 (原版伴奏)'), true);
  assert.equal(titleMatches('小半', '大半'), false);
  assert.equal(titleMatches('愛', '愛情'), false);
});

test('並列的英文名不拿來認歌，歌名本身是英文時照常比', () => {
  assert.equal(titleMatches('愛,很簡單 I Love You', 'I Love You'), false);
  assert.equal(titleMatches('愛,很簡單 I Love You', '爱很简单'), true);
  assert.equal(titleMatches('I Love You', 'I Love You'), true);
  assert.equal(titleMatches('Halo', 'Halo (Live)'), true);
});

test('結果沒有歌名時無從判斷，放行', () => {
  assert.equal(titleMatches('糸', ''), true);
  assert.equal(titleMatches('糸', undefined), true);
});

test('歌手比對：並列英文名、合唱、簡繁都認得', () => {
  assert.equal(artistMatches('周杰倫Jay Chou X aMEI', '周杰伦、张惠妹'), true);
  assert.equal(artistMatches('范瑋琪 Christine Fan', '范玮琪'), true);
  assert.equal(artistMatches('蔡依林 Jolin Tsai', '王若琳'), false);
  assert.equal(artistMatches('', '誰'), false);
});
