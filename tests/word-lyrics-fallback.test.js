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

test('AMLL 逐字歌詞庫：排在網易雲逐字之後、逐句之前；翻譯與和聲欄位不會混進主歌詞', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/services/lyrics-engine.js'), 'utf8');
  const start = source.indexOf('static async searchNetease(');
  const ncm = source.slice(start, start + 3500);
  const yrcAt = ncm.indexOf('this.fetchNeteaseYrc(matchedSong.id)');
  const amllAt = ncm.indexOf('this.fetchAmllTtml(matchedSong.id)');
  const lrcAt = ncm.indexOf('api/song/lyric?id=');
  assert.ok(yrcAt > 0 && amllAt > yrcAt && lrcAt > amllAt, '順序必須是 網易雲逐字 → AMLL → 逐句');
  assert.ok(source.includes("raw.githubusercontent.com/Steve-xmh/amll-ttml-db/main'"), '只從固定的 GitHub 靜態位置讀取');
  for (const bad of ['abc', -1, 0, 1.5, null]) assert.equal(await L.fetchAmllTtml(bad), null, '不合法的歌曲編號不發請求');

  const { parseTTML } = require('../server/services/ttml-parser');
  const ttml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll">'
    + '<head><metadata xmlns=""><ttm:agent type="person" xml:id="v1"/><amll:meta key="ncmMusicId" value="1"/></metadata></head>'
    + '<body dur="00:05.000"><div xmlns="" begin="00:01.000" end="00:05.000">'
    + '<p begin="00:01.000" end="00:03.000" ttm:agent="v1"><span begin="00:01.000" end="00:02.000">測</span><span begin="00:02.000" end="00:03.000">試</span>'
    + '<span ttm:role="x-translation" xml:lang="en">translated line</span></p>'
    + '</div></body></tt>';
  const parsed = L.parseKrc(parseTTML(ttml));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].text, '測試');
  assert.equal(parsed[0].words.length, 2);
});

test('自動抓取：LRCLIB 之前先問網易雲這一格的逐字版，逐句版仍排最後', async () => {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-lyrics-order-'));
  const enginePath = path.join(__dirname, '..', 'server', 'services', 'lyrics-engine.js');
  const script = `
    const { LyricsEngine } = require(process.argv[1]);
    const order = [];
    const stub = (label, result) => async (...args) => { order.push(label + (args[3] && args[3].wordOnly ? ':word' : '')); return typeof result === 'function' ? result(args) : result; };
    LyricsEngine.searchBetterLyrics = stub('betterlyrics', null);
    LyricsEngine.searchPaxsenix = stub('paxsenix', null);
    LyricsEngine.searchKugou = stub('kugou', null);
    LyricsEngine.searchQQMusic = stub('qqmusic', null);
    LyricsEngine.searchLrclib = stub('lrclib', { lyrics: '[00:01.00]line', type: 'lrc', source: 'lrclib' });
    const mode = process.argv[2];
    LyricsEngine.searchNetease = stub('netease', (args) => (mode === 'word' && args[3] && args[3].wordOnly
      ? { lyrics: '[00:01.00]<1000>a<0,500>b<500,500>', type: 'krc', source: 'netease' } : null));
    (async () => {
      const result = await LyricsEngine.search('order-test-' + mode, 'song', 123, false);
      process.stdout.write('__RESULT__' + JSON.stringify({ order, source: result && result.source, type: result && result.type }));
      process.exit(0);
    })();
  `;
  try {
    const run = (mode) => {
      const result = spawnSync(process.execPath, ['-e', script, enginePath, mode], { encoding: 'utf8', env: { ...process.env, ELITESAND_DATA_DIR: tempData }, timeout: 15000 });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.split('__RESULT__')[1]);
    };
    const word = run('word');
    assert.deepEqual(word.order, ['betterlyrics', 'paxsenix', 'kugou', 'qqmusic', 'netease:word'], '有逐字就在 LRCLIB 之前停下');
    assert.equal(word.source, 'netease');
    assert.equal(word.type, 'krc');
    const none = run('none');
    assert.deepEqual(none.order, ['betterlyrics', 'paxsenix', 'kugou', 'qqmusic', 'netease:word', 'lrclib'], '沒有逐字才落到 LRCLIB 的逐句');
    assert.equal(none.source, 'lrclib');
  } finally {
    fs.rmSync(tempData, { recursive: true });
  }
});

test('雙語 LRC：同時間的譯文收進前一行的 translation，原文仍是要唱的那一行', () => {
  const lrc = L.mergeBilingualLrc('[00:01.00]こんにちは\n[00:03.00]さようなら\n[00:05.00]ありがとう', '[00:01.00]你好\n[00:03.00]再見');
  const parsed = L.parseLrc(lrc);
  assert.deepEqual(parsed.map((l) => [l.time, l.text, l.translation]), [
    [1000, 'こんにちは', '你好'],
    [3000, 'さようなら', '再見'],
    [5000, 'ありがとう', ''],
  ]);
  const folded = L.foldTranslationLines([{ time: 0, text: 'a', translation: '' }, { time: 0, text: 'b' }, { time: 0, text: 'c' }]);
  assert.deepEqual(folded.map((l) => l.text), ['a', 'c'], '每行只收一句譯文，第三行同時間的保留成獨立一行');
});

test('QQ 逐字補回翻譯：譯文接在 KRC 後面、依時間收進對應行；「//」佔位與空行略過', () => {
  const krc = '[00:00.74]<2503>無<0,175>敵<175,316>\n[00:03.61]<2000>知<0,196>り<196,153>';
  const withTrans = L.appendTranslationLines(krc, '[ti:x]\n[00:00.74]媒体<为>\n[00:03.61]//\n[00:05.00]');
  assert.equal(withTrans, krc + '\n[00:00.74]媒体＜为>');
  const parsed = L.parseKrc(withTrans);
  assert.equal(parsed.length, 2, '譯文行不能變成要唱的行');
  assert.equal(parsed[0].text, '無敵');
  assert.equal(parsed[0].translation, '媒体＜为>');
  assert.ok(!parsed[1].translation);
  assert.equal(L.appendTranslationLines(krc, ''), krc);
  assert.equal(L.appendTranslationLines(krc, null), krc);
  const source = fs.readFileSync(path.join(__dirname, '../server/services/lyrics-engine.js'), 'utf8');
  assert.ok(source.includes('trans: 1, trans_t: 0'), 'QQ 逐字請求要一起要翻譯');
});

test('網易雲同一次搜尋問兩次時，搜尋與逐字查詢不重打網路', () => {
  // 伺服器端用 node-fetch，要在子程序裡先把它換成假的，才不會真的連外。
  const os = require('os');
  const { spawnSync } = require('child_process');
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-ncm-memo-'));
  const enginePath = path.join(__dirname, '..', 'server', 'services', 'lyrics-engine.js');
  const script = `
    const calls = [];
    const fakeFetch = async (url) => {
      url = String(url);
      calls.push(url.replace(/\\?.*/, ''));
      const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      if (url.includes('/api/search/get/web')) return json({ result: { songs: [{ id: 42, name: 'Song', artists: [{ name: 'Artist' }], duration: 120000 }] } });
      if (url.includes('/api/song/lyric/v1')) return json({});
      if (url.includes('/api/song/lyric?')) return json({ lrc: { lyric: '[00:01.00]line' } });
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };
    require.cache[require.resolve('node-fetch', { paths: [require('path').dirname(process.argv[1])] })] = { exports: fakeFetch, loaded: true };
    const { LyricsEngine } = require(process.argv[1]);
    (async () => {
      const word = await LyricsEngine.searchNetease('Artist', 'Song', 120, { wordOnly: true });
      const before = calls.length;
      const full = await LyricsEngine.searchNetease('Artist', 'Song', 120);
      process.stdout.write('__RESULT__' + JSON.stringify({ word, fullType: full && full.type, first: calls.slice(0, before), second: calls.slice(before) }));
      process.exit(0);
    })();
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script, enginePath], { encoding: 'utf8', env: { ...process.env, ELITESAND_DATA_DIR: tempData }, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.split('__RESULT__')[1]);
    assert.equal(payload.word, null);
    assert.equal(payload.fullType, 'lrc');
    assert.ok(payload.first.some((u) => u.includes('/api/search/get/web')) && payload.first.some((u) => u.includes('amll-ttml-db')), '第一次要真的搜尋、問逐字與 AMLL');
    assert.deepEqual(payload.second, ['https://music.163.com/api/song/lyric'], '第二次只該多打逐句歌詞那一個請求');
  } finally {
    fs.rmSync(tempData, { recursive: true });
  }
});
