#!/usr/bin/env node
/**
 * 重建 public/vendor/jizura/jizura-engine.js（文字PV 模板用的 JIZURA 引擎）。
 *
 *   node tools/vendor-jizura.js <JIZURA 上游 checkout 路徑>
 *
 * 做的事：
 *   1. 依檔名順序串接上游 src/*.js，排除 11_export.js（MP4/PNG 匯出，需要 mp4-muxer）
 *      與 12_ui.js（上游編輯器 UI）——跟過去手動 vendor 的規則相同。
 *   2. 套上 Elitesand Pro 自己的效能修補（下面的 PATCHES，全部標記「Elitesand Pro:」）。
 *      每個修補的原文必須在上游剛好出現一次；上游改寫了那一段就直接失敗，要人工重看，
 *      不會默默產出一份少了修補的引擎。
 *   3. 複製上游 LICENSE（MIT 要求跟著散布）。
 *
 * 升級引擎之後還要：重跑覆蓋率／掉幀稽核（tools/audit-jizura-layouts.js），
 * 必要時更新 lyric-template-jizura.js 的版面清單。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EXCLUDE = new Set(['11_export.js', '12_ui.js']);
const OUT_DIR = path.join(__dirname, '..', 'public', 'vendor', 'jizura');

// ─── Elitesand Pro 的效能修補 ───
// 字級吸附：canvas 每遇到沒見過的 px 字級就要重新解析整組字型（fallback 鏈、字形快取），
// 動畫中逐幀變化的字級每次 fillText 要 3–8ms（實測），重複字級只要 ~0.005ms。
// 畫字時把字級吸附到 1/24 八度的階梯（誤差 ≤1.5%），剩下的差距用縮放補回來。
const FONT_PX_DEF = `/* Elitesand Pro: canvas re-resolves the whole font (fallback chain, glyph strike) for every px size it has not seen,
   so a size animated frame by frame costs 3-8 ms per fillText (measured) against ~0.005 ms for a repeated size.
   Draw calls snap the font to a 1/24-octave ladder (at most 1.5% off) and make up the rest with a scale transform. */
J.fontPx = px => (px > 0 ? Math.pow(2, Math.round(Math.log2(px) * 24) / 24) : px);
`;

// Cache only immutable input runs, not the returned layout/glyph objects: animations may edit those.
// Exact font metrics are retained; changing size, tracking or alignment still uses the original arithmetic.
const TEXT_RUNS_DEF = `/* Elitesand Pro: reuse script classification and advance widths across frames. Returned layouts remain fresh.
   Bound both entry and glyph counts; font/language changes invalidate through J.metrics.clear(). */
const textRuns = new Map();
let textRunGlyphs = 0;
J.clearTextLayouts = () => { textRuns.clear(); textRunGlyphs = 0; };
function textRunsOf(text, font, vertical) {
  const key = JSON.stringify([text, font, !!J.TYPESET, vertical]);
  const hit = textRuns.get(key);
  if (hit) return hit;
  const runs = text.split('\\n').map(line => {
    const arr = [...line], ts = J.typesetLine(arr);
    arr.forEach((ch, i) => { ts[i].em = vertical && !/[A-Za-z0-9]/.test(ch) ? 1 : J.metrics.adv(font, ch); });
    return { arr, ts };
  });
  const count = runs.reduce((n, r) => n + r.arr.length, 0);
  if (count <= 512) {
    while (textRuns.size >= 256 || textRunGlyphs + count > 8192) {
      const oldest = textRuns.keys().next().value, removed = textRuns.get(oldest);
      textRunGlyphs -= removed.reduce((n, r) => n + r.arr.length, 0);
      textRuns.delete(oldest);
    }
    textRuns.set(key, runs); textRunGlyphs += count;
  }
  return runs;
}
`;

const EVENT_WINDOW_DEF = `/* Elitesand Pro: plans are immutable while rendering. Index sorted events once, retaining long overlapping
   effects and original draw order; rebuild for a replaced/resized event array or a changed frame rate. */
const eventWindows = new WeakMap();
function activeEvents(plan, t) {
  const events = plan.events, fps = plan.fps;
  let index = eventWindows.get(events);
  if (!index || index.fps !== fps || index.ends.length !== events.length) {
    const ends = new Float64Array(events.length);
    let last = -Infinity, maxEnd = -Infinity, sorted = true;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!Number.isFinite(ev.t) || !Number.isFinite(ev.dur) || ev.t < last) sorted = false;
      last = ev.t; maxEnd = Math.max(maxEnd, ev.t + Math.max(ev.dur, 1 / fps)); ends[i] = maxEnd;
    }
    index = { fps, ends, sorted }; eventWindows.set(events, index);
  }
  if (!index.sorted) return events.filter(ev => t >= ev.t && t < ev.t + Math.max(ev.dur, 1 / fps));
  let lo = 0, hi = events.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (index.ends[m] <= t) lo = m + 1; else hi = m; }
  const out = [];
  for (let i = lo; i < events.length && events[i].t <= t; i++) {
    const ev = events[i]; if (t < ev.t + Math.max(ev.dur, 1 / fps)) out.push(ev);
  }
  return out;
}
`;

const PATCHES = [
  // 02_fonts：J.fontPx 定義，接在 J.fontCSS 之後
  { file: '02_fonts.js', insertAfterBlock: 'J.fontCSS = (key, px) => {', text: FONT_PX_DEF },
  {
    file: '02_fonts.js',
    find: '  clear() { this.m.clear(); },',
    replace: '  clear() { this.m.clear(); if (J.clearTextLayouts) J.clearTextLayouts(); }, // Elitesand Pro: invalidate text runs too',
  },

  { file: '03_text.js', find: 'J.layoutText = (it) => {', replace: TEXT_RUNS_DEF + 'J.layoutText = (it) => {' },
  ...[false, true].map((vertical) => ({
    file: '03_text.js',
    find: (vertical ? '  } else {\n' : '  if (!vertical) {\n')
      + "    const sets = lines.map(line => { const arr = [...line]; return { arr, ts: J.typesetLine(arr) }; });",
    replace: (vertical ? '  } else {\n' : '  if (!vertical) {\n')
      + `    const sets = textRunsOf(text, it.font, ${vertical});`,
  })),
  ...[
    ['J.metrics.adv(it.font, ch) * ts[i].adv', 'ts[i].em * ts[i].adv'],
    ['J.metrics.adv(it.font, ch) * size * t.adv', 't.em * size * t.adv'],
    ['vAdv(it.font, ch, size) * ts[i].adv', 'ts[i].em * size * ts[i].adv'],
    ['vAdv(it.font, ch, size) * t.adv', 't.em * size * t.adv'],
    ["function vAdv(font, ch, size) { return /[A-Za-z0-9]/.test(ch) ? J.metrics.adv(font, ch) * size : size; }\n", ''],
  ].map(([find, replace]) => ({ file: '03_text.js', find, replace })),

  { file: '09_render.js', find: 'class Renderer {', replace: EVENT_WINDOW_DEF + '\nclass Renderer {' },
  {
    file: '09_render.js',
    find: '    for (let i = 0; i < events.length; i++) {\n      const ev = events[i]; if (ev.t > t) break; const dt = (t - ev.t) * 24;',
    replace: '    // Elitesand Pro: expired camera impulses cannot contribute; seek directly into the time window.\n'
      + '    let eventLo = 0, eventHi = events.length;\n'
      + '    while (eventLo < eventHi) { const m = (eventLo + eventHi) >>> 1; if ((t - events[m].t) * 24 > 14) eventLo = m + 1; else eventHi = m; }\n'
      + '    for (let i = eventLo; i < events.length; i++) {\n      const ev = events[i]; if (ev.t > t) break; const dt = (t - ev.t) * 24;',
  },

  // 03_text：主繪字函式（drawItem）
  {
    file: '03_text.js',
    find: '  ctx.font = wg ? J.varFontCSS(it.font, size, wg) : J.fontCSS(it.font, size);',
    replace: '  const fq = J.fontPx(size), fk = size / fq;      // Elitesand Pro: snapped font size, fk = remaining scale\n'
      + '  ctx.font = wg ? J.varFontCSS(it.font, fq, wg) : J.fontCSS(it.font, fq);',
  },
  {
    file: '03_text.js',
    find: '    grad = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);',
    replace: '    grad = ctx.createLinearGradient(0, -size * 0.5 / fk, 0, size * 0.5 / fk);',
  },
  // モーフ（變形）記錄每個字的最終矩陣與字型：矩陣要含補償縮放、px 記吸附後的字級，重畫時大小才一致
  {
    file: '03_text.js',
    find: '      ctx.save(); ctx.translate(gx, gy); if (crot) ctx.rotate(crot * J.DEG); if (csx !== 1 || csy !== 1) ctx.scale(csx, csy);',
    replace: '      ctx.save(); ctx.translate(gx, gy); if (crot) ctx.rotate(crot * J.DEG); if (csx * fk !== 1 || csy * fk !== 1) ctx.scale(csx * fk, csy * fk);   // Elitesand Pro: fk',
  },
  {
    file: '03_text.js',
    find: "env.glyphLog.push({ ch, m: [T.a, T.b, T.c, T.d, T.e, T.f], font: ctx.font, px: size,",
    replace: "env.glyphLog.push({ ch, m: [T.a, T.b, T.c, T.d, T.e, T.f], font: ctx.font, px: fq,",
  },
  {
    file: '03_text.js',
    find: '    if (csx !== 1 || csy !== 1) ctx.scale(csx, csy);\n    if (c && (c.clipY || c.clipX)) {',
    replace: '    if (csx * fk !== 1 || csy * fk !== 1) ctx.scale(csx * fk, csy * fk);   // Elitesand Pro: fk\n    if (c && (c.clipY || c.clipX)) {',
  },
  {
    file: '03_text.js',
    find: '      ctx.beginPath(); ctx.rect(cx[0] * g.w, cy[0] * g.h, (cx[1] - cx[0]) * g.w, (cy[1] - cy[0]) * g.h); ctx.clip();',
    replace: '      ctx.beginPath(); ctx.rect(cx[0] * g.w / fk, cy[0] * g.h / fk, (cx[1] - cx[0]) * g.w / fk, (cy[1] - cy[0]) * g.h / fk); ctx.clip();',
  },
  {
    file: '03_text.js',
    find: 'ctx.fillText(ch, ext.dx * k / ext.n / csx, ext.dy * k / ext.n / csy);',
    replace: 'ctx.fillText(ch, ext.dx * k / ext.n / (csx * fk), ext.dy * k / ext.n / (csy * fk));',
  },
  {
    file: '03_text.js',
    find: '      ctx.lineWidth = (it.stroke > 0 ? it.stroke : Math.max(1, size * 0.02)) / Math.sqrt(Math.abs(csx * csy));',
    replace: '      ctx.lineWidth = (it.stroke > 0 ? it.stroke : Math.max(1, size * 0.02)) / (Math.sqrt(Math.abs(csx * csy)) * fk);',
  },
  {
    file: '03_text.js',
    find: '      if (dash != null) { const L = size * 3.2; ctx.setLineDash([Math.max(0.01, L * dash), L]); ctx.lineDashOffset = 0; }\n      else if (it.strokeDash) ctx.setLineDash(it.strokeDash);',
    replace: '      if (dash != null) { const L = size * 3.2 / fk; ctx.setLineDash([Math.max(0.01, L * dash), L]); ctx.lineDashOffset = 0; }\n'
      + '      else if (it.strokeDash) ctx.setLineDash(fk === 1 ? it.strokeDash : it.strokeDash.map(v => v / fk));',
  },

  // 09_render：透明模式下 chroma／shake 在 frame() 裡畫，這裡的後製不用處理它們——
  // 否則透明模式的 alpha 保護會為一個什麼都不畫的效果複製、重新遮罩整張畫布（3 次全畫面合成）
  {
    file: '09_render.js',
    find: '    const active = plan.events.filter(ev => t >= ev.t && t < ev.t + Math.max(ev.dur, 1 / plan.fps));',
    replace: '    // Elitesand Pro: chroma / shake are rendered in frame(), not here - skip them, otherwise the transparent-mode\n'
      + '    // alpha guard below copies and re-masks the whole frame (3 full-canvas composites) for an effect that draws nothing\n'
      + "    const POST_BUILTIN = ['slice', 'block', 'invert', 'flash', 'zoom', 'mosaic'];\n"
      + '    const active = activeEvents(plan, t).filter(ev => t >= ev.t && t < ev.t + Math.max(ev.dur, 1 / plan.fps)\n'
      + '      && (POST_BUILTIN.includes(ev.type) || (J.FXE[ev.type] && J.FXE[ev.type].draw)));',
  },
  {
    file: '09_render.js',
    find: '    const guard = opt.transparent ? this.alphaGuard(ctx, S, sc) : null;',
    replace: '    const guard = opt.transparent && active.length ? this.alphaGuard(ctx, S, sc) : null; // Elitesand Pro: no masks for an empty effect window',
  },

  // 11p_layoutsA／C：兩個版面各自的小型畫字函式
  ...['11p_layoutsA.js', '11p_layoutsC.js'].map((file) => ({
    file,
    find: "  ctx.font = J.fontCSS(font, size); ctx.letterSpacing = sp.toFixed(2) + 'px';\n",
    replace: '  const fq = J.fontPx(size), fk = size / fq;      // Elitesand Pro: snapped font size (see J.fontPx)\n'
      + "  ctx.font = J.fontCSS(font, fq); ctx.letterSpacing = (sp / fk).toFixed(2) + 'px';\n",
    // 同一個函式裡緊接著的 fillText
    then: {
      find: '  ctx.fillText(text, x, y);',
      replace: '  if (fk !== 1) { ctx.translate(x, y); ctx.scale(fk, fk); ctx.fillText(text, 0, 0); } else ctx.fillText(text, x, y);',
    },
  })),
];

function countOf(hay, needle) {
  let n = 0; let i = hay.indexOf(needle);
  while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

function applyPatches(sources) {
  for (const p of PATCHES) {
    const src = sources.get(p.file);
    if (src == null) throw new Error(`修補目標 ${p.file} 不存在於上游 src/`);
    let out;
    if (p.insertAfterBlock) {
      const at = src.indexOf(p.insertAfterBlock);
      if (at < 0 || countOf(src, p.insertAfterBlock) !== 1) throw new Error(`${p.file}：找不到唯一的「${p.insertAfterBlock}」`);
      const close = src.indexOf('\n};\n', at);
      if (close < 0) throw new Error(`${p.file}：「${p.insertAfterBlock}」後面找不到區塊結尾`);
      out = src.slice(0, close + 4) + p.text + src.slice(close + 4);
    } else {
      const n = countOf(src, p.find);
      if (n !== 1) throw new Error(`${p.file}：修補原文出現 ${n} 次（預期 1 次）——上游改寫了這一段，請人工重看：\n${p.find}`);
      const at = src.indexOf(p.find);
      out = src.slice(0, at) + p.replace + src.slice(at + p.find.length);
      if (p.then) {
        const from = at + p.replace.length;
        const j = out.indexOf(p.then.find, from);
        if (j < 0 || j - from > 400) throw new Error(`${p.file}：畫字函式後面找不到緊接的「${p.then.find}」`);
        out = out.slice(0, j) + p.then.replace + out.slice(j + p.then.find.length);
      }
    }
    sources.set(p.file, out);
  }
}

function main() {
  const upstream = process.argv[2];
  if (!upstream || !fs.existsSync(path.join(upstream, 'src'))) {
    console.error('用法：node tools/vendor-jizura.js <JIZURA 上游 checkout 路徑>');
    process.exit(2);
  }
  const git = (args) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8' }).trim();
  const commit = git(['rev-parse', '--short', 'HEAD']);
  const date = git(['log', '-1', '--format=%cs']);
  const dirty = git(['status', '--porcelain', '--', 'src', 'LICENSE']);
  if (dirty) throw new Error(`上游 checkout 的 src/ 有未提交的改動，請用乾淨的上游版本：\n${dirty}`);

  const names = fs.readdirSync(path.join(upstream, 'src')).filter((n) => n.endsWith('.js') && !EXCLUDE.has(n)).sort();
  const sources = new Map(names.map((n) => [n, fs.readFileSync(path.join(upstream, 'src', n), 'utf8').replace(/\r\n/g, '\n')]));
  applyPatches(sources);

  const header = `/*!
 * JIZURA 字面 — lyric motion engine (planner + renderer only)
 * https://github.com/852wa/JIZURA  (commit ${commit}, ${date})
 *
 * MIT License — Copyright (c) 2026 hakoniwa
 * Full license text: public/vendor/jizura/LICENSE (must ship with this file).
 *
 * Vendored for Elitesand Pro's 文字PV lyric template by tools/vendor-jizura.js. This file is the plain
 * concatenation of upstream src/*.js in filename order, EXCLUDING 11_export.js
 * (MP4/PNG export, needs mp4-muxer) and 12_ui.js (the upstream editor UI).
 * Upstream code is unmodified except for performance-only changes marked
 * "Elitesand Pro:"; Elitesand-specific behaviour lives in
 * public/js/lyric-template-jizura.js.
 */
`;
  const body = names.map((n) => `/* ---- src/${n} ---- */\n${sources.get(n).replace(/\n*$/, '\n')}`).join('\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'jizura-engine.js'), header + body, 'utf8');
  fs.copyFileSync(path.join(upstream, 'LICENSE'), path.join(OUT_DIR, 'LICENSE'));
  const patched = (header + body).split('Elitesand Pro:').length - 1;
  console.log(`已重建 jizura-engine.js：上游 ${commit}（${date}），${names.length} 個檔案，${PATCHES.length} 個修補（${patched} 處標記）`);
}

main();
