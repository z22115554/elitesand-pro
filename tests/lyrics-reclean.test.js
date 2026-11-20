'use strict';
// 歌曲庫歌詞重洗：舊歌照新清洗規則重解析，只接受「純刪名單行」，保住羅馬化與手動修改。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planReclean, recleanLibrary, RECLEAN_VERSION } = require('../server/services/lyrics-reclean');

const line = (time, text, extra = {}) => ({ time, text, ...extra });
// 假解析器：把原始文字一行一行轉成 { time, text }，去掉「作曲：」開頭的行
const parse = (raw) => raw.split('\n').map((s, i) => line(i * 1000, s)).filter((l) => !l.text.startsWith('作曲：'));
const raw = (...rows) => rows.join('\n');

test('只刪名單行：留下的行沿用原本物件（拼音不丟）', () => {
  const stored = [line(0, '作曲：某人', { phonetic: 'zuo qu' }), line(1000, '第一句', { phonetic: 'di yi ju' }),
    line(2000, '第二句', { phonetic: 'di er ju' }), line(3000, '第三句', { phonetic: 'di san ju' })];
  const lines = planReclean(stored, raw('作曲：某人', '第一句', '第二句', '第三句'), 'krc', parse);
  assert.deepEqual(lines.map((l) => l.text), ['第一句', '第二句', '第三句']);
  assert.equal(lines[0], stored[1]);
});

test('結果相同、手動諧音、格式不支援、異常大砍、變多、對不上：一律不動', () => {
  const same = [line(0, 'a'), line(1000, 'b'), line(2000, 'c')];
  assert.equal(planReclean(same, raw('a', 'b', 'c'), 'lrc', parse), null);
  const manual = [line(0, '作曲：x'), line(1000, 'a', { xieyinManual: true }), line(2000, 'b'), line(3000, 'c')];
  assert.equal(planReclean(manual, raw('作曲：x', 'a', 'b', 'c'), 'krc', parse), null);
  assert.equal(planReclean([line(0, '作曲：x'), line(1000, 'a')], raw('作曲：x', 'a'), 'txt', parse), null);
  const many = Array.from({ length: 20 }, (_, i) => line(i * 1000, `l${i}`));
  assert.equal(planReclean(many, raw('only', 'one'), 'krc', parse), null, '砍掉超過七成視為異常');
  assert.equal(planReclean(same.slice(0, 2), raw('a', 'b', 'c'), 'krc', parse), null, '新結果比原本多就不套用');
  // 重解析跟原本對不上（實例：TTML 聲部代號 a 黏在句首）：整首不碰
  const drift = [line(0, '作曲：x'), line(1000, '好啊'), line(2000, 'b'), line(3000, 'c')];
  assert.equal(planReclean(drift, raw('作曲：x', 'a好啊', 'b', 'c'), 'krc', parse), null);
});

test('聲部以新解析為準：舊的「Piano」聲部從正文拿掉', () => {
  const stored = [line(0, '作曲：x'), line(1000, '还痛吗', { singer: 'Piano', singerLabel: 'Piano', phonetic: 'hai tong ma' }),
    line(2000, 'b'), line(3000, 'c')];
  const lines = planReclean(stored, raw('作曲：x', '还痛吗', 'b', 'c'), 'krc', parse);
  assert.equal(lines[0].singerLabel, undefined);
  assert.equal(lines[0].phonetic, 'hai tong ma');
});

test('整個歌曲庫跑一次：只改純刪行的歌、同步播放清單、寫標記後不再跑', async () => {
  const entries = {
    a: { id: 'a', title: 'A', lyricsType: 'krc', lyrics: raw('作曲：x', '第一句', '第二句', '第三句'),
      parsedLyrics: [line(0, '作曲：x', { phonetic: 'p' }), line(1000, '第一句', { phonetic: 'p1' }), line(2000, '第二句', { phonetic: 'p2' }), line(3000, '第三句', { phonetic: 'p3' })] },
    b: { id: 'b', title: 'B', lyricsType: 'krc', lyrics: raw('x', 'y', 'z'), parsedLyrics: [line(0, 'x'), line(1000, 'y'), line(2000, 'z')] },
    m: { id: 'm', title: 'M', lyricsType: 'krc', lyrics: raw('作曲：x', '1', '2', '3'), manualLyrics: { lyrics: 'k' },
      parsedLyrics: [line(0, '作曲：x'), line(1000, '1'), line(2000, '2'), line(3000, '3')] },
    n: { id: 'n', title: 'N', lyricsType: 'krc', lyrics: raw('作曲：x', '新句', '第二句', '第三句'),
      parsedLyrics: [line(0, '作曲：x'), line(1000, '舊句'), line(2000, '第二句'), line(3000, '第三句')] },
  };
  const writes = [];
  const libraryStore = {
    getLibrary: () => Object.values(entries),
    getEntry: (id) => entries[id],
    updateMeta: (id, partial) => { writes.push(id); entries[id] = { ...entries[id], ...partial }; },
  };
  const synced = [];
  const markerFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reclean-')), 'lyrics-reclean.json');
  const opts = { libraryStore, parse, onUpdated: (id) => synced.push(id), markerFile };

  assert.deepEqual(await recleanLibrary(opts), ['a']);
  assert.deepEqual(writes, ['a']);
  assert.deepEqual(synced, ['a']);
  assert.deepEqual(entries.a.parsedLyrics.map((l) => l.phonetic), ['p1', 'p2', 'p3']);
  assert.equal(entries.m.parsedLyrics.length, 4, '手動指定歌詞的歌不碰');
  assert.equal(entries.n.parsedLyrics.length, 4, '有一行對不上就整首不碰');
  assert.equal(JSON.parse(fs.readFileSync(markerFile, 'utf8')).version, RECLEAN_VERSION);

  writes.length = 0;
  assert.deepEqual(await recleanLibrary(opts), []);
  assert.equal(writes.length, 0, '有標記就不再跑');
});

test('啟動流程有接上重洗，播放清單副本也會同步', () => {
  const index = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.match(index, /lyrics-reclean'\)\.recleanLibrary\(/);
  assert.match(index, /onUpdated: \(id, lines\) => socketApi\.replaceTrackParsedLyrics\(id, lines\)/);
  const socket = fs.readFileSync(path.join(__dirname, '../server/routes/socket-handler.js'), 'utf8');
  assert.match(socket, /replaceTrackParsedLyrics\(trackId, parsedLyrics\)/);
});
