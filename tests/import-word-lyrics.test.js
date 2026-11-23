'use strict';

// 匯入（上傳檔案／貼上）的逐字歌詞要保留逐字時間：酷狗 .krc、解密後的 KRC 文字、
// 內部 KRC 格式（含 [ti:] 這類開頭資訊）、增強 LRC。以前這些不是報「無法解析」，
// 就是被當成 LRC，把 <1200>星<0,300> 這種標記直接顯示在歌詞上。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { LyricsEngine } = require('../server/services/lyrics-engine');

// 跟 server/services/krc-decoder.js 同一把酷狗固定金鑰，用來做出測試用的加密 .krc
const KRC_KEY = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69];
const KUGOU_TEXT = '[ti:星]\n[ar:測試]\n[1200,1800]<0,300,0>星<300,500,0>星<800,1000,0>亮\n[3500,1000]<0,1000,0>晶';

function encryptKrc(text) {
  const deflated = zlib.deflateSync(Buffer.from(text, 'utf8'));
  const encrypted = Buffer.alloc(deflated.length);
  for (let i = 0; i < deflated.length; i++) encrypted[i] = deflated[i] ^ KRC_KEY[i % KRC_KEY.length];
  return Buffer.concat([Buffer.from('krc1'), encrypted]);
}

const summary = (lines) => lines.map((line) => [line.time, line.text, (line.words || []).map((w) => `${w.text.trim()}@${w.start}+${w.duration}`)]);
const STARS = [
  [1200, '星星亮', ['星@0+300', '星@300+500', '亮@800+1000']],
  [3500, '晶', ['晶@0+1000']],
];

function routeHandler(routePath) {
  const apiRouter = require('../server/routes/api');
  const flatten = (stack) => stack.flatMap((layer) => (layer.route ? [layer] : (layer.handle && layer.handle.stack ? flatten(layer.handle.stack) : [])));
  const layer = flatten(apiRouter.stack).find((l) => l.route && l.route.path === routePath && l.route.methods.post);
  assert.ok(layer, `POST ${routePath}`);
  return layer.route.stack.at(-1).handle;
}

function fakeRes() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

test('every word-level import format becomes internal KRC with per-word timing', () => {
  const binary = encryptKrc(KUGOU_TEXT);
  const cases = {
    '加密的酷狗 .krc 檔': LyricsEngine.normalizeImportedLyrics(binary.toString('latin1'), binary),
    '解密後的酷狗 KRC 文字': LyricsEngine.normalizeImportedLyrics(KUGOU_TEXT),
    '內部 KRC（前面有 [ti:]）': LyricsEngine.normalizeImportedLyrics('[ti:星]\n[ar:測試]\n[00:01.20]<1800>星<0,300>星<300,500>亮<800,1000>\n[00:03.50]<1000>晶<0,1000>'),
  };
  for (const [name, result] of Object.entries(cases)) {
    assert.equal(result && result.type, 'krc', name);
    assert.deepEqual(summary(result.lines), STARS, name);
    assert.ok(!/<\d/.test(result.lines.map((l) => l.text).join('')), `${name}：歌詞文字不可殘留標記`);
  }

  const elrc = LyricsEngine.normalizeImportedLyrics('[ti:x]\n[offset:500]\n[00:01.00]<00:01.00>Hel<00:01.50>lo <00:02.00>world<00:03.00>');
  assert.equal(elrc.type, 'krc', '增強 LRC 要轉成逐字');
  assert.equal(elrc.offset, 500, '增強 LRC 的 [offset:] 不能在轉換時丟掉');
  assert.deepEqual(summary(elrc.lines), [[1000, 'Hello world', ['Hel@0+500', 'lo@500+500', 'world@1000+1000']]]);
});

test('ordinary formats are left to the existing parser, and a damaged .krc reports a clear error', () => {
  for (const text of ['[00:01.00]hello\n[00:02.00]world', 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi', '1\n00:00:01,000 --> 00:00:02,000\nHi', '純文字歌詞\n第二句']) {
    assert.equal(LyricsEngine.normalizeImportedLyrics(text), null, text.slice(0, 20));
  }
  assert.deepEqual(LyricsEngine.normalizeImportedLyrics('', Buffer.from('krc1not-really-encrypted')), { error: 'KRC_DECODE_FAILED' });
});

test('pasting word-level lyrics returns KRC with word timing; plain LRC paste is unchanged', () => {
  const paste = routeHandler('/lyrics/paste');
  const res = fakeRes();
  paste({ body: { content: '[ti:星]\n[00:01.20]<1800>星<0,300>星<300,500>亮<800,1000>' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.lyricsType, 'krc');
  assert.equal(res.payload.parsedLyrics[0].text, '星星亮');
  assert.equal(res.payload.parsedLyrics[0].words.length, 3, '要保留逐字時間');

  const plain = fakeRes();
  paste({ body: { content: '[00:01.00]hello\n[00:02.00]world' } }, plain);
  assert.equal(plain.payload.lyricsType, 'lrc');
  assert.equal(plain.payload.lyrics, '[00:01.00]hello\n[00:02.00]world');
});

test('uploading an encrypted Kugou .krc file works, and a damaged one gives a readable error', () => {
  const upload = routeHandler('/lyrics/upload');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-krc-import-'));
  try {
    const good = path.join(dir, 'song.krc');
    fs.writeFileSync(good, encryptKrc(KUGOU_TEXT));
    const res = fakeRes();
    upload({ file: { path: good, originalname: 'song.krc' }, body: {} }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(res.payload.lyricsType, 'krc');
    assert.deepEqual(summary(res.payload.parsedLyrics), STARS);
    assert.ok(/^\[00:01\.20+\]<1800>星<0,300>/.test(res.payload.lyrics), '回傳的是解密後的內部 KRC，不是亂碼');
    assert.equal(fs.existsSync(good), false, '上傳的暫存檔要清掉');

    const bad = path.join(dir, 'broken.krc');
    fs.writeFileSync(bad, Buffer.from('krc1not-really-encrypted'));
    const badRes = fakeRes();
    upload({ file: { path: bad, originalname: 'broken.krc' }, body: {} }, badRes);
    assert.equal(badRes.statusCode, 400);
    assert.match(badRes.payload.error, /\.krc 檔無法解密/);
    assert.equal(fs.existsSync(bad), false, '失敗時暫存檔也要清掉');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('.krc is accepted by the upload filter, the file pickers and the panel validation, in five languages', () => {
  const root = path.join(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(read('server/routes/api.js').includes("const allowed = ['.lrc', '.srt', '.vtt', '.txt', '.krc'];"));
  assert.ok(read('public/js/error-handler.js').includes("const allowed = ['.lrc', '.srt', '.vtt', '.txt', '.krc'];"));
  for (const page of ['public/index.html', 'public/controller.html']) {
    assert.ok(read(page).includes('accept=".lrc,.srt,.vtt,.txt,.krc"'), page);
  }
  const auto = read('public/js/i18n-auto.js');
  for (const message of ['這個 .krc 檔無法解密，可能已損壞，或不是酷狗的歌詞檔', '不支援的歌詞格式: {0}，僅支援 .lrc / .srt / .vtt / .txt / .krc']) {
    const row = auto.match(new RegExp(`"${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}": (\\[[^\\n]+\\]),`));
    assert.ok(row, `i18n-auto 缺少：${message}`);
    assert.equal(JSON.parse(row[1]).length, 5);
  }
});
