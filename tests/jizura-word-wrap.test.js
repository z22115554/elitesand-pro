'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function engine(probe = false){
 const context={window:{},console,Intl,document:{createElement(){return{width:1,height:1,
  getContext(){return new Proxy({measureText:()=>({width:50})},{get:(o,k)=>k in o?o[k]:()=>{}});}};}}};
 vm.createContext(context);
 let source = fs.readFileSync(path.join(__dirname,'../public/vendor/jizura/jizura-engine.js'),'utf8');
 if (probe) {
  source = source.replace('const splitWordsUncached = (text, maxPer) => {', 'const splitWordsUncached = (text, maxPer) => { window.wrapComputations++;');
  source = source.replace('const LATINCH =', 'window.wrapComputations = 0; window.wrapCache = () => ({ size: wordSplits.size, units: wordSplitChars, keys: [...wordSplits.keys()], actualUnits: [...wordSplits].reduce((sum, [key, value]) => sum + key.length + value.length, 0) }); const LATINCH =');
 }
 vm.runInContext(source,context,{timeout:5000});
 return{J:context.window.J,context};
}

test('long Latin line splitting finishes within a bounded execution turn and preserves words',()=>{
 const {context}=engine();
 for(const count of [300,1000,6000]){
  context.text=Array.from({length:count},(_,i)=>'word'+i.toString(26).replace(/[0-9]/g,d=>String.fromCharCode(97+Number(d)))).join(' ');
  const out=vm.runInContext('window.J.splitLines(text,14)',context,{timeout:500});
  assert.deepEqual(out.split(/\s+/),context.text.split(' '));
  assert.equal(out.split('\n').length,Math.min(count,Math.ceil(context.text.length/14)));
 }
});

test('many one-character words never recurse through thousands of lines',()=>{
 const {context}=engine();context.text=Array(12000).fill('a').join(' ');
 const out=vm.runInContext('window.J.splitLines(text,1)',context,{timeout:500});
 assert.equal(out.split('\n').length,12000);
 assert.equal(out.replace(/\s/g,''),'a'.repeat(12000));
});

// Frozen pre-fix optimiser: the compatibility oracle keeps its original length arithmetic and tie order.
function originalSplitWords(text, maxPer) {
  const ws = text.trim().split(/\s+/), n = ws.length;
  const total = ws.reduce((a, w) => a + [...w].length, 0) + n - 1;
  const nLines = Math.min(n, Math.ceil(total / maxPer));
  if (nLines <= 1) return ws.join(' ');
  const len = (a, b) => ws.slice(a, b).reduce((s, w) => s + [...w].length, 0) + (b - a - 1);
  const ideal = total / nLines, memo = new Map();
  const best = (i, l) => {
    if (l === 1) { const d = len(i, n) - ideal; return { c: d * d, cuts: [] }; }
    const key = i + ',' + l; if (memo.has(key)) return memo.get(key);
    let r = { c: Infinity, cuts: [] };
    for (let j = i + 1; j <= n - l + 1; j++) {
      const d = len(i, j) - ideal, sub = best(j, l - 1), c = d * d + sub.c;
      if (c < r.c) r = { c, cuts: [j, ...sub.cuts] };
    }
    memo.set(key, r); return r;
  };
  const cuts = [0, ...best(0, nLines).cuts, n];
  return cuts.slice(0, -1).map((start, i) => ws.slice(start, cuts[i + 1]).join(' ')).join('\n');
}

test('ordinary balanced splits retain the original optimiser output including ties and Unicode words', () => {
  const { J } = engine();
  let checked = 0;
  for (const count of [2, 3, 8, 16, 32, 64]) {
    const text = Array.from({ length: count }, (_, i) => ['a', 'café', 'étoile', 'daylight', 'e\u0301', '𐐀ab'][i % 6]).join(' ');
    assert.equal(J.isLatinText(text), true);
    for (const lines of [2, 3, 8, 16, 32, 64]) {
      const width = Math.max(1, Math.ceil([...text].length / lines));
      assert.equal(J.splitLines(text, width), originalSplitWords(text, width));
      checked++;
    }
  }
  for (const text of ['aa aa aa aa aa', '  alpha\t beta   gamma\n delta  ', 'one supercalifragilisticexpialidocious word']) {
    for (const width of [1, 5, 11, 14, 40]) {
      const expected = [...text].length <= width ? text : originalSplitWords(text, width);
      assert.equal(J.splitLines(text, width), expected);
      checked++;
    }
  }
  assert.equal(checked, 51);
});

test('CJK, Hangul, emoji and mixed-script line breaks retain pre-fix snapshots', () => {
  const { J } = engine();
  for (const [text, width, expected] of [
    ['春天來了「你好世界」再見。', 5, '春天來了\n「你好世界」\n再見。'],
    ['𠮷野家😀與家人一起唱歌', 4, '𠮷野家😀\n與家人\n一起唱歌'],
    ['你好 e\u0301 emoji 👩‍👩‍👧‍👧 世界', 6, '你好 e\u0301\nemoji\n👩‍👩‍👧‍👧\n世界'],
    ['あしたはきっと、いい日になる。', 5, 'あしたはきっと、\nいい\n日になる。'],
    ['한글 노래 가사 함께 불러요', 6, '한글 노래\n가사\n함께 불러요'],
  ]) assert.equal(J.splitLines(text, width), expected);
});

test('long words remain whole, and the iterative path preserves every word on both limit boundaries', () => {
  const { context, J } = engine();
  const word = 'supercalifragilisticexpialidocious'.repeat(100);
  assert.equal(J.splitLines(word, 5), word);
  for (const count of [64, 65, 300]) {
    context.text = Array.from({ length: count }, (_, i) => ['a', 'longerword', word][i % 3]).join(' ');
    for (const width of [5, 14, 100]) {
      context.width = width;
      const out = vm.runInContext('window.J.splitLines(text, width)', context, { timeout: 500 });
      assert.equal(out.split(/\s+/).join(' '), context.text);
      assert.ok(out.split('\n').every(line => line.trim().length > 0));
      assert.equal(out.split('\n').length, Math.min(count, Math.ceil([...context.text].length / width)));
    }
  }
});

test('word-split cache reuses frame results while separating width and retaining no huge inputs', () => {
  const { J, context } = engine(true);
  const text = 'alpha beta gamma delta';
  const first = J.splitLines(text, 8);
  assert.equal(context.window.wrapComputations, 1);
  for (let i = 0; i < 60; i++) assert.equal(J.splitLines(text, 8), first);
  assert.equal(context.window.wrapComputations, 1);
  J.splitLines(text, 7);
  assert.equal(context.window.wrapComputations, 2);
  J.setLang('zh-Hant'); J.setTypeset(true);
  assert.equal(J.splitLines(text, 8), first, 'line splits do not depend on font or typesetting state');
  assert.equal(context.window.wrapComputations, 2);
  const huge = 'example '.repeat(300).trim(), before = context.window.wrapCache();
  J.splitLines(huge, 14); J.splitLines(huge, 14);
  assert.equal(context.window.wrapComputations, 4);
  assert.equal(context.window.wrapCache().size, before.size);
  assert.equal(context.window.wrapCache().units, before.units);
});

test('word-split cache enforces entry and total-character budgets and evicts the least recent result', () => {
  const { J, context } = engine(true);
  const old = 'old words here', hot = 'hot words here';
  J.splitLines(old, 5); J.splitLines(hot, 5);
  for (let i = 0; i < 127; i++) { J.splitLines('cache words entry' + i, 5); J.splitLines(hot, 5); }
  const before = context.window.wrapComputations;
  J.splitLines(hot, 5);
  assert.equal(context.window.wrapComputations, before);
  J.splitLines(old, 5);
  assert.equal(context.window.wrapComputations, before + 1);
  assert.equal(context.window.wrapCache().size, 128);
  for (let i = 0; i < 20; i++) J.splitLines('example '.repeat(240) + 'end' + i, 14);
  const stats = context.window.wrapCache();
  assert.ok(stats.size < 128, 'character budget evicts before entry budget');
  assert.ok(stats.units <= 32768);
  assert.equal(stats.units, stats.actualUnits);
});

test('invalid widths cannot hang either branch and fractional widths are bounded to one character', () => {
  const { context } = engine();
  for (const text of ['alpha beta', '中文歌詞']) {
    context.text = text;
    for (const width of [0, -1, NaN, Infinity, -Infinity, undefined, '14']) {
      context.width = width;
      assert.equal(vm.runInContext('window.J.splitLines(text, width)', context, { timeout: 500 }), text);
    }
    context.width = Number.MIN_VALUE;
    const out = vm.runInContext('window.J.splitLines(text, width)', context, { timeout: 500 });
    assert.equal(out, vm.runInContext('window.J.splitLines(text, 1)', context, { timeout: 500 }));
  }
});

test('center layout reaches the fixed splitter with untruncated long lyric input', () => {
  const { J, context } = engine();
  context.text = Array(1000).fill('example').join(' ');
  context.env = { W: 1920, H: 1080, sc: { fg: '#fff' }, cut: {
    text: context.text, params: { font: 'gothic_bold', sx: 1, track: 0, ox: 0, oy: 0 },
  } };
  J.fitSize = () => 50;
  J.mainDraw = (_env, item) => { context.drawn = item.text; return null; };
  vm.runInContext('window.J.LAYOUTS.center.render(env)', context, { timeout: 500 });
  assert.equal(context.drawn.replace(/\n/g, ' '), context.text);
  assert.equal(context.drawn.split('\n').length, Math.ceil(context.text.length / 11));
});
