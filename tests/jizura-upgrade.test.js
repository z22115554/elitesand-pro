'use strict';
// JIZURA v0.13.0 升級：部件註冊、「標準」模式不變、「擴充」模式只用稽核過的部件、缺件可追蹤。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const AUDIT = require('./fixtures/jizura-v0.13.0-audit.json');

function load() {
  const makeCanvas = () => {
    const canvas = { width: 2, height: 2 };
    const ctx = new Proxy({ canvas, measureText: (s) => ({ width: 50 * [...String(s)].length }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
    canvas.getContext = () => ctx; return canvas;
  };
  const warnings = [];
  const c = { window: {}, console: { ...console, warn: (...a) => warnings.push(a.join(' ')) }, Intl,
    document: { createElement: makeCanvas, body: { dataset: {} }, documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), LyricTemplates: { register(def) { c.def = def; } } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/vendor/jizura/jizura-engine.js'), 'utf8'), c);
  c.J = c.window.J;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/lyric-template-jizura.js'), 'utf8')
    .replace('  LyricTemplates.register({', '  window.audit={buildPlan,COMPONENT_POOLS,EXTENDED_POOLS,SAFE_LAYOUTS_LANDSCAPE,CENTER_FREE_LAYOUTS,'
      + 'EXT_SAFE_LAYOUTS,EXT_CENTER_FREE_LAYOUTS,EXT_QUIET_LAYOUTS,QUIET_LAYOUTS,HEAVY_LAYOUTS,BUSY_LAYOUTS,noteMissing,missingParts,OPTIN_PARTS,OPTIN_LAYOUTS};\n  LyricTemplates.register({'), c);
  return { c, J: c.J, warnings, ...c.window.audit };
}

const TEXTS = ['我們在夜空下唱著最初那首歌', '一起唱歌', '君がくれた光を覚えている', '「またね」って笑った', 'We sing together under the stars tonight', '너와 함께 노래하고 싶어'];
const LINES = Array.from({ length: 36 }, (_, i) => ({ time: 1000 + i * 3600, text: TEXTS[i % TEXTS.length] }));
const SECTIONS = [{ start: 0, end: 30, label: 'verse' }, { start: 30, end: 45, label: 'pre_chorus' }, { start: 45, end: 80, label: 'chorus' }, { start: 80, end: 200, label: 'verse' }];
const sig = (p) => p.cuts.map((c) => [c.line, c.text, c.layout, c.enter, c.exit, c.hold, c.cam, c.treat, (c.decor || []).map((d) => d.id).join(','),
  c.start.toFixed(3), c.end.toFixed(3), c.companion ? c.companion.text : ''].join('|'));
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function plans(env, parts) {
  const out = {};
  for (const placement of ['sides', 'full', 'right']) for (const mode of ['calm', 'normal', 'chaotic']) for (const secs of [0, 1]) {
    env.c.document.body.dataset = { jizuraPlacement: placement, lyricIntensity: mode, ...(parts ? { jizuraParts: parts } : {}) };
    out[[placement, mode, secs].join('/')] = env.buildPlan(LINES, { id: 'upgrade-song', sections: secs ? SECTIONS : undefined });
  }
  return out;
}

test('v0.13.0 registers the full upstream part catalogue (1,715 parts)', () => {
  const { J } = load();
  const counts = Object.fromEntries(['layout', 'enter', 'hold', 'exit', 'decor', 'treat', 'bg', 'cam', 'fx', 'trans'].map((g) => [g, J.order(g).length]));
  assert.deepEqual(counts, { layout: 364, enter: 251, hold: 102, exit: 221, decor: 260, treat: 122, bg: 130, cam: 71, fx: 138, trans: 56 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 1715);
  for (const [g, keys] of Object.entries(counts)) for (const k of J.order(g)) assert(J.registry(g)[k], g + '.' + k);
  assert.equal(J.SETS.extra2.on, false, '上游「追加分2」預設關閉');
});

test('standard parts mode never uses set-gated styles or parts outside the audited base lists', () => {
  const env = load();
  const { J, COMPONENT_POOLS, SAFE_LAYOUTS_LANDSCAPE, CENTER_FREE_LAYOUTS } = env;
  for (const [key, p] of Object.entries(plans(env))) {
    assert(!J.STYLES[p.styleKey].set, key + ' style ' + p.styleKey);
    const layouts = new Set(key.startsWith('sides') ? CENTER_FREE_LAYOUTS : SAFE_LAYOUTS_LANDSCAPE);
    const pool = COMPONENT_POOLS[key.includes('/chaotic/') ? 'chaotic' : key.includes('/calm/') ? 'quiet' : 'normal'];
    for (const c of p.cuts.filter((c) => c.line >= 0 && c.layout !== 'interlude')) {
      assert(layouts.has(c.layout), key + ' layout ' + c.layout);
      for (const cut of [c, c.companion].filter(Boolean)) {
        for (const g of ['enter', 'exit', 'hold', 'cam', 'treat']) assert(COMPONENT_POOLS.chaotic[g].includes(cut[g]) || cut[g] === 'none', key + ' ' + g + ':' + cut[g]);
        for (const d of cut.decor) assert(COMPONENT_POOLS.chaotic.decor.includes(d.id), key + ' decor ' + d.id);
        const def = (g) => J.registry(g)[cut[g]] || {};
        for (const g of ['enter', 'exit', 'hold', 'cam']) assert(!def(g).x2 && !def(g).set, key + ' new part leaked in standard mode: ' + g + '.' + cut[g]);
      }
    }
    for (const e of p.events) assert(pool.fx.includes(e.type) || COMPONENT_POOLS.chaotic.fx.includes(e.type), key + ' fx ' + e.type);
  }
});

test('standard parts mode output is pinned (engine upgrades must not reshuffle it silently)', () => {
  const env = load();
  const all = Object.fromEntries(Object.entries(plans(env)).map(([k, p]) => [k, sig(p)]));
  // 重新產生：node -e "…" 印出 hash；只有在刻意接受新的搭配結果時才更新（並在 PR 說明原因）。
  assert.equal(hash(all), PINNED_STANDARD, '標準模式的規劃結果改變了；如果是刻意的，更新 PINNED_STANDARD 並在 PR 說明');
  // 「base」與未設定完全相同
  const explicit = Object.fromEntries(Object.entries(plans(env, 'base')).map(([k, p]) => [k, sig(p)]));
  assert.equal(hash(explicit), hash(all));
});
const PINNED_STANDARD = '012dd54467165a69cc066091b2777ad63b3f85e62b81beae867463e471bd55c1';

test('extended parts mode only uses parts that passed the recorded v0.13.0 audit', () => {
  const env = load();
  const { J, EXTENDED_POOLS, EXT_SAFE_LAYOUTS, EXT_CENTER_FREE_LAYOUTS, SAFE_LAYOUTS_LANDSCAPE, CENTER_FREE_LAYOUTS } = env;
  const accepted = new Set(AUDIT.parts.filter((r) => r.accepted).map((r) => r.group + '.' + r.key));
  const layoutsOk = (mode) => new Set(AUDIT.layouts.filter((r) => r.accepted && (mode === 'sides' ? r.sidesOk : true)).map((r) => r.key));
  for (const [tier, pool] of Object.entries(EXTENDED_POOLS)) {
    for (const [g, keys] of Object.entries(pool)) {
      assert.equal(new Set(keys).size, keys.length, tier + '.' + g + ' duplicates');
      for (const k of keys) {
        const d = J.registry(g)[k]; assert(d, g + '.' + k);
        if (d.set || d.x2) {
          assert(accepted.has(g + '.' + k), 'not audited: ' + g + '.' + k);
          assert.notEqual(d.set, 'horror'); assert(!d.pieces, 'pieces: ' + k); if (g === 'cam') assert(!d.strong, 'strong cam: ' + k);
        }
      }
    }
    assert.deepEqual(Array.from(pool.fx), Array.from(env.COMPONENT_POOLS[tier].fx), '擴充不加新的全畫面特效');
    assert.deepEqual(Array.from(pool.treat.filter((k) => !env.COMPONENT_POOLS[tier].treat.includes(k))).length === 0, tier === 'quiet');
  }
  for (const k of EXT_SAFE_LAYOUTS) { assert(J.LAYOUTS[k], k); assert(layoutsOk('full').has(k), 'layout not audited: ' + k); assert(!SAFE_LAYOUTS_LANDSCAPE.includes(k)); }
  for (const k of EXT_CENTER_FREE_LAYOUTS) { assert(J.LAYOUTS[k], k); assert(layoutsOk('sides').has(k), 'side layout not audited: ' + k); assert(!CENTER_FREE_LAYOUTS.includes(k)); }

  const ps = plans(env, 'extended');
  let newParts = 0;
  for (const [key, p] of Object.entries(ps)) {
    const tier = key.includes('/chaotic/') ? 'chaotic' : 'normal';
    const layouts = new Set(key.startsWith('sides') ? CENTER_FREE_LAYOUTS.concat(EXT_CENTER_FREE_LAYOUTS) : SAFE_LAYOUTS_LANDSCAPE.concat(EXT_SAFE_LAYOUTS));
    for (const c of p.cuts.filter((c) => c.line >= 0 && c.layout !== 'interlude')) {
      assert(layouts.has(c.layout), key + ' layout ' + c.layout);
      for (const cut of [c, c.companion].filter(Boolean)) {
        for (const g of ['enter', 'exit', 'hold', 'cam', 'treat']) {
          assert(EXTENDED_POOLS.chaotic[g].includes(cut[g]), key + ' ' + g + ':' + cut[g]);
          const d = J.registry(g)[cut[g]] || {};
          if (d.set || d.x2) newParts++;
          assert.notEqual(d.set, 'horror');
        }
        assert(cut.decor.length <= 1);
      }
      if (key.includes('/calm/')) for (const g of ['enter', 'exit', 'hold', 'cam']) assert(EXTENDED_POOLS.quiet[g].includes(c[g]), key + ' calm ' + g + ':' + c[g]);
      if (!key.includes('/calm/')) assert(EXTENDED_POOLS[tier].enter.includes(c.enter) || EXTENDED_POOLS.quiet.enter.includes(c.enter));
    }
    assert(!p.style.set && !J.STYLES[p.styleKey].set);
  }
  assert(newParts > 200, 'extended mode should actually use the new parts: ' + newParts);
  // 決定性
  const again = plans(env, 'extended');
  for (const k of Object.keys(ps)) assert.equal(hash(sig(again[k])), hash(sig(ps[k])), k);
});

test('missing parts are dropped with a traceable warning instead of silently falling back', () => {
  const env = load();
  env.noteMissing({ enter: ['cut', 'definitelyNotAPart'] }, ['center', 'noSuchLayout']);
  assert(env.missingParts.has('enter.definitelyNotAPart') && env.missingParts.has('layout.noSuchLayout'));
  assert(env.warnings.some((w) => w.includes('enter.definitelyNotAPart')));
  // 正式清單本身不能缺件
  const fresh = load();
  fresh.c.document.body.dataset = { jizuraPlacement: 'full', lyricIntensity: 'chaotic', jizuraParts: 'extended' };
  fresh.buildPlan(LINES, { id: 'x' });
  fresh.c.document.body.dataset = { jizuraPlacement: 'sides', lyricIntensity: 'calm' };
  fresh.buildPlan(LINES, { id: 'x' });
  assert.equal(fresh.missingParts.size, 0, [...fresh.missingParts].join(','));
});

test('renderer survives unknown part ids and plans for both modes render every frame without throwing', () => {
  const env = load();
  for (const parts of ['base', 'extended']) for (const placement of ['sides', 'full']) {
    env.c.document.body.dataset = { jizuraPlacement: placement, lyricIntensity: 'chaotic', jizuraParts: parts };
    const p = env.buildPlan(LINES.slice(0, 12), { id: 'render', sections: SECTIONS });
    const ctx = env.c.document.createElement('canvas').getContext('2d');
    const r = new env.J.Renderer();
    for (let t = 0; t < 46; t += 0.37) r.frame(ctx, p, t, { scale: 0.25, transparent: true, noHud: true, noTrans: true, noGhost: true });
  }
  env.c.document.body.dataset = { jizuraPlacement: 'full', lyricIntensity: 'normal' };
  const p = env.buildPlan(LINES.slice(0, 3), { id: 'bogus' });
  for (const c of p.cuts) { c.layout = 'noSuchLayout'; c.enter = 'noSuchEnter'; c.cam = 'noSuchCam'; c.decor = [{ id: 'noSuchDecor' }]; }
  const r = new env.J.Renderer();
  const ctx = env.c.document.createElement('canvas').getContext('2d');
  for (let t = 0; t < 10; t += 0.5) r.frame(ctx, p, t, { scale: 0.25, transparent: true, noHud: true, noTrans: true });
});

test('jizuraParts is a validated, persisted template setting defaulting to standard', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'public/js/lyric-template-jizura.js'), 'utf8');
  assert(tpl.includes("{ type: 'enum', key: 'jizuraParts', target: 'data:jizuraParts', values: ['base', 'extended'], default: 'base' }"));
  const extras = fs.readFileSync(path.join(ROOT, 'public/js/lyric-extras.js'), 'utf8');
  assert(extras.includes("const JIZURA_PARTS = ['base', 'extended'];") && extras.includes("jizuraParts: 'base'"));
  assert(fs.readFileSync(path.join(ROOT, 'server/routes/handlers/lyrics.js'), 'utf8').includes("['base', 'extended'].includes(out[id].jizuraParts)"));
  assert(fs.readFileSync(path.join(ROOT, 'server/state/app-state.js'), 'utf8').includes("jizuraMotion: 'smooth', jizuraParts: 'base'"));
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert(html.includes('class="style-thumb active" data-jizura-parts="base"') && html.includes('data-jizura-parts="extended"'));
  const i18n = require('../public/js/i18n');
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) for (const k of ['partsLabel', 'partsBase', 'partsExtended', 'partsHint']) {
    assert(i18n.catalogs?.[locale]?.['jizura.' + k], locale + ' jizura.' + k);
  }
});

// ─── 自選部件（高耗能／大面積／恐怖風）───
const OPTIN_AUDIT = require('./fixtures/jizura-optin-audit.json');

test('optional parts: every opted-in part is in the recorded local audit and never a full-screen effect, background or transition', () => {
  const env = load();
  const { J, OPTIN_PARTS, OPTIN_LAYOUTS } = env;
  const evidence = new Map(OPTIN_AUDIT.evidence.map((e) => [e.id, e]));
  for (const [g, rows] of Object.entries(OPTIN_PARTS)) {
    assert(['enter', 'exit', 'hold', 'cam', 'treat', 'decor'].includes(g), 'group ' + g);
    for (const [k, needs, tier, sidesOk] of rows) {
      assert(J.registry(g)[k], g + '.' + k);
      assert(evidence.has(g + '.' + k), 'not in local audit: ' + g + '.' + k);
      assert(needs >= 1 && needs <= 7, g + '.' + k + ' needs');
      assert(['q', 'n', 'c'].includes(tier));
      assert(sidesOk === 0 || sidesOk === 1);
      assert.equal(!!(needs & 4), J.registry(g)[k].set === 'horror', 'horror bit must match the engine set: ' + k);
    }
  }
  for (const [k, needs, where] of OPTIN_LAYOUTS) {
    assert(J.LAYOUTS[k], 'layout ' + k);
    assert(evidence.has('layout.' + k), 'layout not in local audit: ' + k);
    assert(where >= 1 && where <= 3);
    assert.equal(!!(needs & 4), J.LAYOUTS[k].set === 'horror', 'horror bit: ' + k);
  }
  for (const x of OPTIN_AUDIT.excluded) {
    const [g, k] = x.id.split('.');
    if (g === 'layout') assert(!OPTIN_LAYOUTS.some(([key]) => key === k), 'excluded layout leaked: ' + k);
    else assert(!(OPTIN_PARTS[g] || []).some(([key]) => key === k), 'excluded part leaked: ' + x.id);
  }
});

function optinPlans(env, flags) {
  const out = {};
  for (const placement of ['sides', 'full']) for (const mode of ['calm', 'normal', 'chaotic']) {
    env.c.document.body.dataset = { jizuraPlacement: placement, lyricIntensity: mode, jizuraParts: 'extended', ...flags };
    out[placement + '/' + mode] = env.buildPlan(LINES, { id: 'optin-song', sections: SECTIONS });
  }
  return out;
}

test('optional parts: each switch only adds parts whose requirements it covers, and switching off restores the old plans', () => {
  const env = load();
  const { J, OPTIN_PARTS, OPTIN_LAYOUTS, EXTENDED_POOLS } = env;
  const needsOf = new Map();
  for (const [g, rows] of Object.entries(OPTIN_PARTS)) for (const [k, needs] of rows) needsOf.set(g + '.' + k, needs);
  for (const [k, needs] of OPTIN_LAYOUTS) needsOf.set('layout.' + k, needs);
  const off = Object.fromEntries(Object.entries(optinPlans(env, {})).map(([k, p]) => [k, sig(p)]));
  const combos = [[{ jizuraHeavy: '1' }, 1], [{ jizuraLarge: '1' }, 2], [{ jizuraHorror: '1' }, 4], [{ jizuraHeavy: '1', jizuraLarge: '1', jizuraHorror: '1' }, 7]];
  for (const [flags, bits] of combos) {
    let added = 0;
    for (const [key, p] of Object.entries(optinPlans(env, flags))) {
      assert(!J.STYLES[p.styleKey].set, key + ' style ' + p.styleKey);
      for (const c of p.cuts.filter((c) => c.line >= 0 && c.layout !== 'interlude')) {
        const used = [['layout', c.layout]];
        for (const cut of [c, c.companion].filter(Boolean)) {
          for (const g of ['enter', 'exit', 'hold', 'cam', 'treat']) used.push([g, cut[g]]);
          for (const d of cut.decor) used.push(['decor', d.id]);
        }
        for (const [g, k] of used) {
          const needs = needsOf.get(g + '.' + k);
          if (needs === undefined) {
            if (g !== 'layout') assert(EXTENDED_POOLS.chaotic[g].includes(k) || k === 'none', key + ' unknown ' + g + '.' + k);
            continue;
          }
          assert.equal(needs & bits, needs, `${key} ${g}.${k} needs ${needs} but only ${bits} is on`);
          added++;
        }
      }
      for (const e of p.events) assert(EXTENDED_POOLS.chaotic.fx.includes(e.type), key + ' fx ' + e.type);
    }
    assert(added > 0, 'switch ' + JSON.stringify(flags) + ' should actually use opted-in parts');
  }
  const again = Object.fromEntries(Object.entries(optinPlans(env, {})).map(([k, p]) => [k, sig(p)]));
  assert.deepEqual(again, off, '全部關掉要回到原本的規劃');
});

test('optional parts: horror parts only appear with the horror switch and plans still render every frame', () => {
  const env = load();
  let horror = 0;
  for (const [key, p] of Object.entries(optinPlans(env, { jizuraHeavy: '1', jizuraLarge: '1' }))) {
    for (const c of p.cuts) for (const g of ['enter', 'exit', 'hold', 'cam', 'treat']) assert.notEqual((env.J.registry(g)[c[g]] || {}).set, 'horror', key + ' ' + c[g]);
  }
  const ps = optinPlans(env, { jizuraHorror: '1' });
  const r = new env.J.Renderer();
  const ctx = env.c.document.createElement('canvas').getContext('2d');
  for (const p of Object.values(ps)) {
    for (const c of p.cuts) for (const g of ['enter', 'exit', 'hold', 'cam', 'treat']) if ((env.J.registry(g)[c[g]] || {}).set === 'horror') horror++;
    // noPost：假畫布的原型沒有 drawImage，後製（既有的 slice／block）在這裡畫不了；後製另在真瀏覽器實測。
    for (let t = 0; t < 40; t += 0.25) r.frame(ctx, p, t, { scale: 0.25, transparent: true, noHud: true, noTrans: true, noPost: true });
  }
  assert(horror > 0, 'horror switch should use horror parts');
});

test('optional parts switches are validated, persisted, default off and labelled in five languages', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'public/js/lyric-template-jizura.js'), 'utf8');
  for (const k of ['jizuraHeavy', 'jizuraLarge', 'jizuraHorror']) {
    assert(tpl.includes(`{ type: 'bool01', key: '${k}', target: 'data:${k}', default: false }`), k);
    assert(fs.readFileSync(path.join(ROOT, 'public/js/lyric-extras.js'), 'utf8').includes(`${k}: false`), 'panel default ' + k);
    assert(fs.readFileSync(path.join(ROOT, 'server/state/app-state.js'), 'utf8').includes(`${k}: false`), 'server default ' + k);
  }
  assert(fs.readFileSync(path.join(ROOT, 'server/routes/handlers/lyrics.js'), 'utf8').includes("for (const key of ['jizuraHeavy', 'jizuraLarge', 'jizuraHorror'])"));
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  for (const id of ['ls-jizura-heavy', 'ls-jizura-large', 'ls-jizura-horror']) assert(html.includes(`id="${id}"`), id);
  assert(/id="jizura-optin-field"[\s\S]{0,200}data-new-feature="jizura-optin"/.test(html), 'NEW badge');
  assert(fs.readFileSync(path.join(ROOT, 'public/js/new-badges.js'), 'utf8').includes("'jizura-optin':"));
  const i18n = require('../public/js/i18n');
  for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'zh-CN']) for (const k of ['optinLabel', 'heavyLabel', 'heavyHint', 'largeLabel', 'largeHint', 'horrorLabel', 'horrorHint']) {
    assert(i18n.catalogs?.[locale]?.['jizura.' + k], locale + ' jizura.' + k);
  }
});
