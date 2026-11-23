'use strict';

// 2026-11-13 全面抓蟲稽核的回歸測試。每一個 test 對應 PR 說明裡的一個問題編號。
const test = require('node:test');
const assert = require('node:assert/strict');

function vm_get(context, name) { return require('vm').runInContext(name, context); }

test('#48 歌曲庫逐字升級：舊歌詞繁體、新逐字歌詞簡體（酷狗／QQ）時要認得是同一首，不可標成「歌詞可能不對」', () => {
  const { lyricsOverlapRatio } = require('../server/routes/handlers/lyrics');
  const old = ['故事的小黃花', '從出生那年就飄著', '童年的盪鞦韆', '隨記憶一直晃到現在', '刮風這天 我試過握著你手', '但偏偏 雨漸漸 大到我看你不見'].map((text) => ({ text }));
  const krc = ['故事的小黄花', '从出生那年就飘着', '童年的荡秋千', '随记忆一直晃到现在', '刮风这天 我试过握着你手', '但偏偏 雨渐渐 大到我看你不见'].map((text) => ({ text }));
  assert.equal(lyricsOverlapRatio(old, krc), 1);
  assert.equal(lyricsOverlapRatio(old, [{ text: '完全不同的一首歌' }, { text: '另一句' }]), 0);
});

test('#61 簡轉繁不可套在日文歌詞／歌名上（会いたい→會いたい、学校→學校、残響散歌→殘響散歌）', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const OpenCC = require('opencc-js');
  // karaoke.js：用真的 opencc 跑它的 s2tLine／isJapaneseSong
  const src = fs.readFileSync(path.join(__dirname, '../public/js/karaoke.js'), 'utf8');
  const start = src.indexOf('  let s2tEnabled = true;');
  const end = src.indexOf('  function setTraditional(');
  const snippet = src.slice(start, end);
  const ctx = { OpenCC, parsedLyrics: [] };
  vm.runInNewContext(`${snippet}\nthis.s2tLine = s2tLine; this.setLyrics = (l) => { parsedLyrics = l; };`, ctx);
  ctx.setLyrics([{ text: '会いたい' }, { text: '残響散歌' }, { text: '学校の帰り道' }]);
  assert.equal(ctx.s2tLine('会いたい', '会いたい'), '会いたい');
  assert.equal(ctx.s2tLine('残響散歌', '残響散歌'), '残響散歌', '日文歌裡沒有假名的句子也不轉');
  assert.equal(ctx.s2tLine('学校', '学校の帰り道'), '学校', '逐字 word 依整句判斷');
  ctx.setLyrics([{ text: '我们的爱' }, { text: '回不去了' }, { text: '还是会想你' }]);
  assert.equal(ctx.s2tLine('还是会想你', '还是会想你'), '還是會想你', '中文歌照常簡轉繁');
  ctx.setLyrics([{ text: '我们的爱' }, { text: '回不去了' }, { text: '还是会想你' }, { text: 'ありがとう' }]);
  assert.equal(ctx.s2tLine('还是会想你', '还是会想你'), '還是會想你', '中文歌夾一句日文：中文句照轉');
  // J-pop 大段英文副歌：英文句不算進分母，整首仍是日文歌，只有漢字的句子也不轉
  ctx.setLyrics([{ text: '会いたい' }, { text: 'I love you' }, { text: 'Baby baby' }, { text: 'Oh yeah' }, { text: 'Hold me tight' }, { text: '残響散歌' }]);
  assert.equal(ctx.s2tLine('残響散歌', '残響散歌'), '残響散歌');
  // 面板、歌單、跟唱視圖同一條規則
  assert.match(fs.readFileSync(path.join(__dirname, '../public/js/app-shared.js'), 'utf8'), /convert\(str, lineText\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/js/setlist.js'), 'utf8'), /日文歌名不轉/);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8'), /japaneseSong \|\| KANA_RE\.test/);
});

test('#62 跟唱視圖的逐句筆記：歌詞換成簡體版（繁體逐句 → 酷狗／QQ 逐字）後仍對得回同一句', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const OpenCC = require('opencc-js');
  const src = fs.readFileSync(path.join(__dirname, '../public/js/prompter.js'), 'utf8').replace(/\r\n/g, '\n');
  const conv = src.slice(src.indexOf('  let _s2tConv = null;'), src.indexOf('  function s2t(str) {'));
  const match = src.slice(src.indexOf('  const normLine = '), src.indexOf('  function lineNoteHtml('));
  const ctx = { OpenCC, notes: { lines: [] }, parsedLines: [] };
  vm.runInNewContext(`let notes = this.notes; let parsedLines = this.parsedLines;\n${conv}\n${match}\nthis.matchLineNotes = matchLineNotes;`, ctx);
  ctx.notes.lines.push({ time: 1000, text: '故事的小黃花', note: '這句要輕' });
  ctx.parsedLines.push({ time: 1100, text: '故事的小黄花' }, { time: 5000, text: '从出生那年就飘着' });
  const result = ctx.matchLineNotes();
  assert.equal(result.orphans.length, 0);
  assert.equal(result.byIndex.get(0).note, '這句要輕');
});

test('#64 匯入去重：同一首的繁體與簡體上傳（周杰倫 告白氣球／周杰伦 告白气球）要認得是同一首', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-audit-identity-'));
  try {
    const script = [
      "const store=require(process.argv[1]);",
      "store.rememberImport({id:'aaaaaaaaaaa',title:'告白氣球',artist:'周杰倫',filename:'a.m4a',url:'https://www.youtube.com/watch?v=aaaaaaaaaaa'});",
      "const hit=store.findByIdentity('周杰伦','告白气球','bbbbbbbbbbb');",
      "const miss=store.findByIdentity('周杰伦','晴天','bbbbbbbbbbb');",
      "process.stdout.write('__R__'+JSON.stringify({hit:hit&&hit.id,miss:miss&&miss.id})+'\\n'); process.exit(0);",
    ].join('\n');
    const child = spawnSync(process.execPath, ['-e', script, path.join(__dirname, '..', 'server', 'services', 'library-store.js')], {
      env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr);
    const out = JSON.parse(child.stdout.slice(child.stdout.lastIndexOf('__R__') + 5).trim().split(/\r?\n/, 1)[0]);
    assert.equal(out.hit, 'aaaaaaaaaaa');
    assert.equal(out.miss, null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('#66 歌曲庫搜尋：全形半形、簡體繁體都要找得到（告白气球 → 告白氣球、ＹＯＡＳＯＢＩ → YOASOBI）', () => {
  const fs = require('fs');
  const path = require('path');
  const OpenCC = require('opencc-js');
  const src = fs.readFileSync(path.join(__dirname, '../public/js/media-library.js'), 'utf8');
  const body = src.slice(src.indexOf('  function applyView() {'), src.indexOf('    renderFilterCounts(view);'));
  const conv = OpenCC.Converter({ from: 'cn', to: 'tw' });
  const AppShared = { lyricS2T: { ready: () => true, fold: (t) => conv(t), ensure: async () => conv } };
  const cache = [{ title: '告白氣球', artist: '周杰倫' }, { title: '夜に駆ける', artist: 'YOASOBI' }, { title: '晴天', artist: '周杰倫' }];
  const run = (query) => new Function('window', 'AppShared', 'cache', 'searchQuery', 'foldedSearchText',
    `${body.replace('  function applyView() {', '')}\nreturn view.map((it) => it.title);`)({ AppShared }, AppShared, cache, query, new WeakMap());
  assert.deepEqual(run('告白气球'), ['告白氣球']);
  assert.deepEqual(run('ＹＯＡＳＯＢＩ'), ['夜に駆ける']);
  assert.deepEqual(run('周杰伦'), ['告白氣球', '晴天']);
});

test('#71 翻唱找原唱：三個來源一繁兩簡（周杰倫／周杰伦／周杰伦）要算同一個人，名字用繁體', async () => {
  const { LyricsEngine } = require('../server/services/lyrics-engine');
  const one = await LyricsEngine.resolveOriginalArtist('晴天', 0, [async () => '周杰倫', async () => '周杰伦', async () => '某翻唱']);
  assert.equal(one.artist, '周杰倫');
  assert.ok(one.confidence >= 0.8);
  const all = await LyricsEngine.resolveOriginalArtist('晴天', 0, [async () => '周杰伦', async () => '周杰倫', async () => '周杰伦']);
  assert.equal(all.artist, '周杰倫');
  assert.equal(all.confidence, 0.95);
});
