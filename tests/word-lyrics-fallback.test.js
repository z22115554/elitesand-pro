'use strict';

// QQ 音樂（QRC）與網易雲（YRC）逐字歌詞：解密、格式轉換、拿不到時退回逐句。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { decryptQrc, decryptQrcBytes } = require('../server/services/qrc-decoder');
const engineModule = require('../server/services/lyrics-engine.js');
const L = engineModule.LyricsEngine || engineModule;

test('QRC 解密：對真實服務回應的開頭兩個區塊解出 zlib 標頭（已知答案）', () => {
  const plain = decryptQrcBytes(Buffer.from('172519F79CD153B1F9BB8F74B1B961A7', 'hex'));
  assert.equal(plain.toString('hex'), '789c655b5baf56d7757df7af403ced23');
});

test('QRC 解密：格式不對或解不開一律回 null，不丟例外', () => {
  assert.equal(decryptQrc(''), null);
  assert.equal(decryptQrc(null), null);
  assert.equal(decryptQrc('zz'.repeat(8)), null, '不是十六進位');
  assert.equal(decryptQrc('00'.repeat(7)), null, '長度不是 8 位元組的倍數');
  assert.equal(decryptQrc('00'.repeat(16)), null, '解出來不是 zlib');
  assert.equal(decryptQrc('0'.repeat(2 * 1024 * 1024 + 16)), null, '過大的回應不處理');
});

test('QRC → KRC：絕對時間換成相對行首、標頭行略過、文字裡的括號不會被當成時間', () => {
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos>\n<LyricInfo LyricCount="1">\n<Lyric_1 LyricType="1" LyricContent="[ti:測試]\n[offset:0]\n'
    + '[742,2503]無(742,175)敵(917,316)の(1233,170)\n'
    + '[5000,900]Hi (5000,300)(you)(5300,600)\n'
    + '[7000,500]a&amp;b(7000,500)\n'
    + '"/>\n</LyricInfo>\n</QrcInfos>';
  const krc = L.qrcToKrc(xml).split('\n');
  assert.equal(krc[0], '[00:00.74]<2503>無<0,175>敵<175,316>の<491,170>');
  assert.equal(krc[1], '[00:05.00]<900>Hi <0,300>(you)<300,600>');
  assert.equal(krc.length, 3);
  const parsed = L.parseKrc(krc.join('\n'));
  assert.equal(parsed[0].text, '無敵の');
  assert.equal(parsed[0].words.length, 3);
  assert.equal(parsed[2].text, 'a&b', 'XML 跳脫字元交給既有的 KRC 解析還原');
  assert.equal(L.qrcToKrc(null), null);
  assert.equal(L.qrcToKrc('<QrcInfos></QrcInfos>'), null);
  assert.equal(L.qrcToKrc('<Lyric_1 LyricContent="[ti:x]\n"/>'), null, '沒有任何逐字行');
});

test('YRC → KRC：時間在字前面、JSON 製作名單行略過、KRC 語法字元換成全形', () => {
  const yrc = '{"t":0,"c":[{"tx":"作词: "},{"tx":"某人"}]}\n'
    + '[13240,5720](13240,770,0)哪(14010,500,0)里(14510,270,0)有\n'
    + '[20000,1000](20000,400,0)a<b (20400,600,0)[c]\n';
  const krc = L.yrcToKrc(yrc).split('\n');
  assert.equal(krc.length, 2);
  assert.equal(krc[0], '[00:13.24]<5720>哪<0,770>里<770,500>有<1270,270>');
  assert.equal(krc[1], '[00:20.00]<1000>a＜b <0,400>［c］<400,600>');
  assert.equal(L.yrcToKrc(''), null);
  assert.equal(L.yrcToKrc('[00:01.00]只有逐句'), null);
});

test('逐字拿不到時，QQ 與網易雲都退回原本的逐句流程；來源名稱與順位不變', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/services/lyrics-engine.js'), 'utf8');
  const qq = source.slice(source.indexOf('static async searchQQMusic('), source.indexOf('static async searchQQMusic(') + 4000);
  assert.ok(qq.indexOf('this.fetchQqQrc(matchedSong.songid)') > 0 && qq.indexOf('this.fetchQqQrc(') < qq.indexOf('fcg_query_lyric_new.fcg'), 'QQ 先試逐字，再走逐句');
  assert.ok(qq.includes("type: 'krc', source: 'qqmusic'") && qq.includes("type: 'lrc', source: 'qqmusic'"));
  const ncm = source.slice(source.indexOf('static async searchNetease('), source.indexOf('static async searchNetease(') + 3000);
  assert.ok(ncm.indexOf('this.fetchNeteaseYrc(matchedSong.id)') > 0 && ncm.indexOf('this.fetchNeteaseYrc(') < ncm.indexOf('api/song/lyric?id='), '網易雲先試逐字，再走逐句');
  assert.ok(ncm.includes("type: 'krc', source: 'netease'") && ncm.includes("type: 'lrc', source: 'netease'"));
});

test('不合法的歌曲編號不發請求，直接回 null', async () => {
  for (const bad of ['abc', -1, 0, 1.5, null, undefined]) {
    assert.equal(await L.fetchQqQrc(bad), null);
    assert.equal(await L.fetchNeteaseYrc(bad), null);
  }
});
