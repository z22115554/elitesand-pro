'use strict';
// TTML 對唱歌詞的聲部代號：ttml-parser 寫成「\x01a\x01」，舊版存檔時 \x01 被當控制字元洗掉，
// 重解析存檔的歌詞就把代號當成正文（「a好啊好啊」「both無言的結局」）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { LyricsEngine } = require('../server/services/lyrics-engine');
const { sanitizeTrack, sanitizeManualLyrics } = require('../server/utils/track-schema');

test('存檔保留歌詞裡的 \\x01，其他控制字元照樣洗掉', () => {
  const lyrics = '[00:01.00]<500>\x01a\x01好<0,500>\x02\x7f';
  assert.equal(sanitizeTrack({ id: 'x', title: 't', lyrics, lyricsType: 'krc' }).lyrics, '[00:01.00]<500>\x01a\x01好<0,500>');
  assert.equal(sanitizeManualLyrics({ lyrics, lyricsType: 'krc' }).lyrics, '[00:01.00]<500>\x01a\x01好<0,500>');
  assert.equal(sanitizeTrack({ id: 'x', title: 'a\x01b', lyricsType: 'krc' }).title, 'ab', '其他欄位不受影響');
});

test('舊存檔：\\x01 已被洗掉的聲部代號照樣剝成 line.singer', () => {
  const raw = ['[00:02.56]<2096>a好啊好啊<0,2096>', '[00:04.85]<2050>both有空整理<0,2050>', '[00:06.17]<2184>a那你<0,1000>現在<1000,1184>']
    .join('\n');
  const out = LyricsEngine.parseKrc(raw);
  assert.deepEqual(out.map((l) => [l.text, l.singer]), [['好啊好啊', 'a'], ['有空整理', 'both'], ['那你現在', 'a']]);
  assert.equal(out[2].words[0].text, '那你', '逐字也不能帶著代號');
});

test('一般英文歌詞開頭的 a／about／dance 不會被誤剝', () => {
  const raw = ['[00:01.00]<900>about<0,400> love<400,500>', '[00:02.00]<900>dance<0,900>', '[00:03.00]<900>a<0,100> song<100,800>',
    '[00:04.00]<900>both<0,300> of<300,300> us<600,300>'].join('\n');
  assert.deepEqual(LyricsEngine.parseKrc(raw).map((l) => [l.text, l.singer]),
    [['about love', undefined], ['dance', undefined], ['a song', undefined], ['both of us', undefined]]);
});

test('新存檔：有 \\x01 的走原本路徑', () => {
  const raw = ['[00:01.00]<900>\x01a\x01about<0,900>', '[00:02.00]<900>\x01b\x01dance<0,900>'].join('\n');
  assert.deepEqual(LyricsEngine.parseKrc(raw).map((l) => [l.text, l.singer]), [['about', 'a'], ['dance', 'b']]);
});
