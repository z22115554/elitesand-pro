'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');

function load() {
  const makeCanvas = () => {
    const canvas = { width: 2, height: 2 };
    const ctx = new Proxy({ canvas, measureText: () => ({ width: 50 }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    }, { get: (o, k) => k in o ? o[k] : () => {} });
    canvas.getContext = () => ctx; return canvas;
  };
  const c = { window: {}, console, Intl, document: { createElement: makeCanvas, body: { dataset: {} }, documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), LyricTemplates: { register() {} } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/vendor/jizura/jizura-engine.js'), 'utf8'), c);
  c.J = c.window.J;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/lyric-template-jizura.js'), 'utf8')
    .replace('  LyricTemplates.register({', '  window.audit={buildPlan,COMPOSITION_OPTIONS,COMPONENT_POOLS};\n  LyricTemplates.register({'), c);
  return { c, J: c.J, ...c.window.audit };
}

function project(J, options, seed = 7) {
  const p = Object.assign(J.defaultProject(), { extra: true, wa: true, unify: true, typeset: true, lang: 'en', seed,
    lyrics: Array.from({ length: 60 }, (_, i) => {
      const sec = 1 + i * 2;
      return '[' + String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0') + '.00]Singing line ' + String.fromCharCode(65 + i % 26) + i;
    }).join('\n') });
  if (options !== undefined) p.unifyOptions = options;
  p.enabled.layout = Object.fromEntries(J.order('layout').map(k => [k,
    ['center', 'mixed', 'vcols', 'type', 'diag', 'labels', 'lowerThird', 'quote', 'footnote', 'headlineDeck', 'genkou', 'corners', 'staircase', 'elastic', 'ruler'].includes(k)]));
  return p;
}
function fingerprint(p) { return crypto.createHash('sha256').update(JSON.stringify(p,
  (_, v) => typeof v === 'number' ? Number(v.toFixed(8)) : v)).digest('hex'); }
const signature = c => [c.layout, c.enter, c.exit, c.hold, c.cam, c.treat, (c.decor || []).map(d => d.id).join(',')].join('|');

test('projects without options retain the pinned legacy plan', () => {
  const { J } = load();
  const p = project(J);
  // 2026-11-10 引擎 8bd7abc → v0.13.0（4c8278c）：上游 v0.8 起文字PV系／キネティック部件預設開啟、重複句沿用第一次的
  // つなぎ（不再重抽），所以上游預設設定下的規劃換了；Elitesand 的修補仍不改上游的亂數順序（下一行的 {} 比對）。
  assert.equal(fingerprint(J.plan(p, null)), '1329ad2cf78292ee83c621ad8d16f9dc2613488e4eb32a4ef103cd62f370fb3f');
  assert.equal(fingerprint(J.plan({ ...p, unifyOptions: {} }, null)), fingerprint(J.plan(p, null)));
});

test('composition remains deterministic and does not change timings or allowed layouts', () => {
  const { J, COMPOSITION_OPTIONS } = load();
  const p = project(J, COMPOSITION_OPTIONS.normal);
  const a = J.plan(p, null), b = J.plan(p, null);
  assert.equal(fingerprint(a), fingerprint(b));
  for (const c of a.cuts.filter(c => c.line >= 0)) {
    assert.equal(p.enabled.layout[c.layout], true);
    assert(c.end > c.start && c.inDur + c.outDur <= c.dur * 0.92 + 1e-8);
  }
  assert.deepEqual(Array.from(a.lines, l => l.start), Array.from(J.plan(project(J), null).lines, l => l.start));
});

test('long unsectioned songs rotate palettes and reduce dominance by three layouts', () => {
  const { J, COMPOSITION_OPTIONS } = load();
  const stats = options => {
    let sum = 0, unique = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const cuts = J.plan(project(J, options, seed), null).cuts.filter(c => c.line >= 0);
      const counts = new Map(); for (const c of cuts) counts.set(c.layout, (counts.get(c.layout) || 0) + 1);
      sum += [...counts.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) / cuts.length;
      unique += counts.size;
    }
    return { share: sum / 12, unique: unique / 12 };
  };
  const before = stats(undefined), after = stats(COMPOSITION_OPTIONS.normal);
  assert(after.share < before.share * 0.7, JSON.stringify({ before, after }));
  assert(after.unique > before.unique, JSON.stringify({ before, after }));
});

test('repeated lyrics keep their layout and geometry while varying motion', () => {
  const { J, COMPOSITION_OPTIONS } = load();
  const p = project(J, COMPOSITION_OPTIONS.normal);
  p.lyrics = Array.from({ length: 16 }, (_, i) => '[00:' + String(1 + i * 2).padStart(2, '0') + '.00]Together').join('\n');
  const cuts = J.plan(p, null).cuts.filter(c => c.line >= 0);
  assert.equal(cuts.length, 16);
  assert.equal(new Set(cuts.map(c => c.layout)).size, 1);
  assert.equal(new Set(cuts.map(c => JSON.stringify(c.params))).size, 1);
  assert(new Set(cuts.map(signature)).size >= 12);
  for (let i = 1; i < cuts.length; i++) assert.notEqual(signature(cuts[i]), signature(cuts[i - 1]));
});

test('palette rollover does not create extra kime accents', () => {
  const { J, COMPOSITION_OPTIONS } = load();
  const p = project(J, COMPOSITION_OPTIONS.normal);
  p.lyrics = p.lyrics.replace('Singing line A0', 'Singing line A0!');
  const cuts = J.plan(p, null).cuts.filter(c => c.kime);
  assert(cuts.length > 0); assert(cuts.every(c => c.line === 0));
});

test('adapter component pools are valid, piece-free and avoid blurred/strong cameras', () => {
  const { J, COMPONENT_POOLS } = load();
  for (const pool of Object.values(COMPONENT_POOLS)) for (const [group, names] of Object.entries(pool)) {
    assert.equal(new Set(names).size, names.length);
    for (const k of names) {
      const def = J.registry(group)[k]; assert(def, group + '.' + k);
      assert(!def.pieces, group + '.' + k); if (group === 'cam') assert(!def.strong);
    }
  }
  assert.deepEqual(Array.from(COMPONENT_POOLS.quiet.treat), ['none']);
  assert.deepEqual(Array.from(COMPONENT_POOLS.quiet.fx), ['chroma']);
});

test('both halves obey the component pools and a single foreground effect budget', () => {
  const { c, J, buildPlan, COMPONENT_POOLS } = load();
  const lines = Array.from({ length: 30 }, (_, i) => ({ time: 1000 + i * 4000, text: '我們在夜空下唱著最初那首歌' + i }));
  for (const mode of ['calm', 'normal', 'chaotic']) {
    c.document.body.dataset = { jizuraPlacement: 'sides', lyricIntensity: mode };
    const p = buildPlan(lines, { id: 'budget-test' });
    const pool = COMPONENT_POOLS[mode === 'calm' ? 'quiet' : mode];
    for (const main of p.cuts.filter(c => c.line >= 0 && c.layout !== 'interlude')) {
      for (const cut of [main, main.companion].filter(Boolean)) {
        for (const group of ['enter', 'exit', 'hold', 'treat', 'cam']) assert(pool[group].includes(cut[group]), group + ':' + cut[group]);
        assert(cut.decor.length <= 1);
        assert(cut.decor.every(d => pool.decor.includes(d.id)));
        if (cut.decor.length) assert.equal(cut.treat, 'none');
        assert(cut.inDur + cut.outDur <= cut.dur * 0.92 + 1e-8);
      }
    }
    assert(p.events.every(e => pool.fx.includes(e.type)));
    assert.equal(p.style.schemes.length, 1);
    assert.equal(p.style.schemes[0].fg, '#ffffff');
  }
});

test('fixed overlay colours are opt-in and leave the generic engine palette unchanged', () => {
  const { J } = load();
  const before = J.resolveStyle({ style: 'noir', colors: { enabled: true, bg: '#101014', fg: '#123456' } });
  const after = J.resolveStyle({ style: 'noir', colors: { enabled: true, lockSchemes: true, bg: '#101014', fg: '#123456' } });
  assert(before.schemes.length > 1);
  assert.equal(after.schemes.length, 1); assert.equal(after.schemes[0].fg, '#123456');
});

test('word timings survive composition and delayed companion entrance', () => {
  const { c, buildPlan } = load(); c.document.body.dataset = { jizuraPlacement: 'sides', lyricIntensity: 'normal' };
  const lines = [0, 1, 2].map(i => ({ time: 1000 + i * 5000, text: '我們一起唱歌', words: Array.from('我們一起唱歌', (text, n) => ({ text, start: n * 500, duration: 500 })) }));
  const a = buildPlan(lines, { id: 'word-timing' });
  for (const cut of a.cuts.filter(c => c.line >= 0 && c.companion)) {
    assert(cut.start >= 0 && cut.end > cut.start);
    assert(cut.companion.start >= cut.start && cut.companion.start < cut.end);
    assert.equal(cut.companion.end, cut.end);
    const at = lines[cut.line].text.indexOf(cut.companion.text, cut.text.length);
    assert(at >= 0);
    assert(cut.companion.start >= (lines[cut.line].time + at * 500) / 1000 - 1e-8);
  }
});

test('extra ghost passes are reserved for expressive full-frame non-quiet sections', () => {
  const { c, buildPlan } = load();
  const lines = Array.from({ length: 12 }, (_, i) => ({ time: 1000 + i * 4000, text: '我們一起唱歌' + i }));
  const meta = { id: 'ghost-budget', sections: [{ start: 0, end: 25, label: 'verse' }, { start: 25, end: 60, label: 'chorus' }] };
  for (const placement of ['sides', 'full']) for (const mode of ['calm', 'normal', 'chaotic']) {
    c.document.body.dataset = { jizuraPlacement: placement, lyricIntensity: mode };
    const p = buildPlan(lines, meta);
    for (const cut of p.cuts.filter(cut => cut.line >= 0 && cut.layout !== 'interlude')) {
      assert.equal(cut.__jzNoGhost, placement === 'sides' || mode !== 'chaotic' || cut.line < 6);
    }
  }
});

test('title and instrumental cards cannot bypass the lightweight motion policy', () => {
  const { c, buildPlan, COMPONENT_POOLS } = load();
  c.document.body.dataset = { jizuraPlacement: 'sides', lyricIntensity: 'normal' };
  const p = buildPlan([{ time: 5000, text: '我們一起唱歌' }, { time: 20000, text: '我們唱到天亮' }], { id: 'cards', title: '片頭歌名' });
  const cards = p.cuts.filter(cut => cut.line < 0 || cut.layout === 'interlude');
  assert(cards.some(cut => cut.layout === 'title'));
  assert(cards.some(cut => cut.layout === 'interlude'));
  for (const cut of cards) {
    for (const group of ['enter', 'exit', 'hold', 'cam', 'treat']) assert(COMPONENT_POOLS.normal[group].includes(cut[group]));
    assert(cut.inDur + cut.outDur <= cut.dur * 0.92 + 1e-8);
  }
});
