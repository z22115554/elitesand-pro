#!/usr/bin/env electron
/**
 * 文字PV（JIZURA）動作／裝飾部件稽核：引擎升級後，用來決定哪些新部件可以進入
 * lyric-template-jizura.js 的「擴充部件」搭配池（版面另用 tools/audit-jizura-layouts.js）。
 *
 *   npx electron tools/audit-jizura-parts.js [--groups enter,exit] [--keys a,b] [--new-since <舊引擎.js>] [--center-free] [--out 報告.json]
 *
 * 每個部件：版面固定為 center（兩側模式為引擎的 centerFree），只有受測的那一組換成該部件，
 * 其餘固定（cut／still／none／push、無裝飾、無後製），在透明模式 1920×1080 下量：
 *   - planned：引擎是否真的把它排進 cut（minDur、字數上限等可能拒絕）
 *   - errors：繪製中拋出的例外（不可有）
 *   - visible：停留中段是否有畫出東西（避免空白）
 *   - coverage／centralCoverage：同 layout 稽核（≤35%／兩側中央 ≤2%）
 *   - p95Ms：每幀 frame()＋1px getImageData 的 p95（門檻 25ms，跟 layout 稽核一致）
 * --new-since：只測「舊引擎沒有的部件」。結果只產生候選清單，不會自動改正式池；
 * 也不是 Windows／OBS 端到端 FPS 保證。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { app, BrowserWindow } = require('electron');

const ENGINE = process.env.JIZURA_ENGINE || path.join(__dirname, '..', 'public', 'vendor', 'jizura', 'jizura-engine.js');
const COVERAGE_LIMIT = 0.35;
const CENTRAL_COVERAGE_LIMIT = 0.02;
const HEAVY_P95_MS = 25;
const FIXTURES = [
  { lang: 'zh-Hant', text: '一起唱歌' },
  { lang: 'zh-Hant', text: '當我們穿過城市夜空看見那些燈火依然照亮回家的方向' },
  { lang: 'ja', text: '君がくれた光を覚えている' },
  { lang: 'en', text: 'We sing together under the stars tonight' },
  { lang: 'ko', text: '너와 함께 노래하고 싶어' },
];
const GROUPS = ['enter', 'exit', 'hold', 'cam', 'treat', 'decor'];
const FIXED = { enter: 'cut', exit: 'cut', hold: 'still', cam: 'push', treat: 'none', decor: null };

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const groups = (arg('--groups') || GROUPS.join(',')).split(',').filter(Boolean);
for (const g of groups) if (!GROUPS.includes(g)) throw new Error('未知的組別：' + g);
const keysFilter = arg('--keys') ? arg('--keys').split(',').filter(Boolean) : null;
const centerFree = args.includes('--center-free');
const outFile = arg('--out');
const since = arg('--new-since');

// 舊引擎的部件清單（只在 Node 端讀名單，不在稽核頁面載入）
function oldKeys(file) {
  const mk = () => { const cv = { width: 2, height: 2 }; const ctx = new Proxy({ canvas: cv, measureText: () => ({ width: 50 }) }, { get: (o, k) => (k in o ? o[k] : () => {}) }); cv.getContext = () => ctx; return cv; };
  const c = { window: {}, console: { log() {}, warn() {} }, Intl, document: { createElement: mk, body: { dataset: {} }, documentElement: {} } };
  vm.createContext(c); vm.runInContext(fs.readFileSync(file, 'utf8'), c);
  return Object.fromEntries(GROUPS.map((g) => [g, c.window.J.order(g)]));
}

const PAGE_SCRIPT = (opts) => `
(async () => {
  const W = 1920, H = 1080;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const probe = document.createElement('canvas'); probe.width = 480; probe.height = 270;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  const renderer = new J.Renderer();
  const fixtures = ${JSON.stringify(FIXTURES)};
  const FIXED = ${JSON.stringify(FIXED)};
  const old = ${JSON.stringify(opts.old)};
  const results = [];
  for (const group of ${JSON.stringify(opts.groups)}) {
    let keys = J.order(group).filter(k => !(old && old[group] && old[group].includes(k)));
    if (${JSON.stringify(opts.keys)}) keys = keys.filter(k => ${JSON.stringify(opts.keys)}.includes(k));
    for (const key of keys) {
      const def = J.registry(group)[key] || {};
      const row = { group, key, set: def.set || null, x2: !!def.x2, tags: def.tags || [], pieces: !!def.pieces, strong: !!def.strong,
        safe: !!def.safe, subtle: !!def.subtle, layer: def.layer || null, cases: [] };
      for (const [fi, fixture] of fixtures.entries()) {
        const seed = 7 + fi;
        const lines = [2, 6, 10, 14].map(s => '[00:' + String(s).padStart(2, '0') + '.00]' + fixture.text);
        const info = { lang: fixture.lang, text: fixture.text };
        const project = Object.assign(J.defaultProject(), {
          lyrics: lines.join('\\n'), seed, style: 'noir', extra: true, wa: true, typo: true, kinetic: true, horror: true, extra2: true,
          lang: fixture.lang, aspect: '16:9', centerFree: ${opts.centerFree ? 'true' : 'false'}, typeset: true,
          colors: { enabled: true, bg: '#101014', fg: '#ffffff', accentOn: true, accent: '#ffd6a5' },
        });
        project.fx = Object.assign(J.defaultProject().fx, { hud: 'off', flash: false, bgSwitch: 0, koma: 30, onTwos: false, motion: 0.6, decor: 1, density: 0.5, glitch: 0, chroma: 0 });
        project.enabled = {
          layout: Object.fromEntries(J.order('layout').map(k => [k, k === 'center'])),
          bg: Object.fromEntries(J.order('bg').map(k => [k, k === 'none'])),
          trans: Object.fromEntries(J.order('trans').map(k => [k, false])),
          fx: Object.fromEntries(J.order('fx').map(k => [k, false])),
        };
        for (const g of Object.keys(FIXED)) project.enabled[g] = Object.fromEntries(J.order(g).map(k => [k, g === group ? k === key : k === FIXED[g]]));
        let plan;
        try { plan = J.plan(project, null); } catch (e) { row.cases.push({ ...info, error: 'plan: ' + (e && e.message || e) }); continue; }
        const uses = c => group === 'decor' ? (c.decor || []).some(d => d.id === key) : c[group] === key;
        const cuts = plan.cuts.filter(c => c.line >= 0 && uses(c));
        if (!cuts.length) { row.cases.push({ ...info, skipped: 'not planned' }); continue; }
        const c = cuts[1] || cuts[0];
        const ro = { transparent: true, noHud: true, noTrans: true, noGhost: true, noPost: true };
        const errors = [];
        const origWarn = console.warn, origErr = console.error;
        console.warn = console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 160)); };
        const render = (target, t, scale) => { try { renderer.frame(target, plan, t, { ...ro, scale }); } catch (e) { errors.push(String(e && e.message || e)); } };
        let coverage = 0, central = 0, visible = false;
        for (let k = 1; k <= 10; k++) {
          const t = c.start + (c.end - c.start) * (k / 11);
          pctx.clearRect(0, 0, 480, 270); render(pctx, t, 480 / plan.W);
          const d = pctx.getImageData(0, 0, 480, 270).data;
          let n = 0, cn = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 30) { n++; const x = ((i - 3) / 4) % 480; if (x >= 173 && x < 307) cn++; }
          coverage = Math.max(coverage, n / (480 * 270)); central = Math.max(central, cn / (134 * 270));
          if (k >= 4 && k <= 7 && n > 30) visible = true;
        }
        let p95Ms = null;
        if (fi < 4) {
          const times = [];
          for (let f = -3; f < 48; f++) {
            const t = c.start + (c.end - c.start) * (((f + 3) % 48) / 48);
            const t0 = performance.now(); ctx.clearRect(0, 0, W, H); render(ctx, t, W / plan.W); ctx.getImageData(0, 0, 1, 1);
            if (f >= 0) times.push(performance.now() - t0);
          }
          times.sort((a, b) => a - b); p95Ms = +times[Math.floor(times.length * 0.95)].toFixed(2);
        }
        console.warn = origWarn; console.error = origErr;
        row.cases.push({ ...info, coverage: +coverage.toFixed(4), centralCoverage: +central.toFixed(4), visible, p95Ms, errors: [...new Set(errors)].slice(0, 3) });
      }
      const m = row.cases.filter(x => x.coverage != null);
      row.planned = m.length; row.errors = row.cases.flatMap(x => x.error ? [x.error] : (x.errors || []));
      row.coverage = m.length ? Math.max(...m.map(x => x.coverage)) : null;
      row.centralCoverage = m.length ? Math.max(...m.map(x => x.centralCoverage)) : null;
      row.visible = m.filter(x => x.visible).length;
      const ps = m.map(x => x.p95Ms).filter(v => v != null);
      row.p95Ms = ps.length ? Math.max(...ps) : null;
      results.push(row);
    }
  }
  return results;
})()
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1920, height: 1080,
    webPreferences: { offscreen: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  const tmp = path.join(app.getPath('temp'), `jizura-parts-audit-${process.pid}.html`);
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent"><script src="file:///${ENGINE.replace(/\\/g, '/')}"></script></body>`, 'utf8');
  await win.loadFile(tmp);
  let results;
  try {
    results = await win.webContents.executeJavaScript(PAGE_SCRIPT({ groups, keys: keysFilter, centerFree, old: since ? oldKeys(since) : null }));
  } catch (e) {
    console.error('稽核失敗：', e); app.exit(1); return;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
  }
  const pass = (r) => r.planned >= 3 && !r.errors.length && r.visible >= Math.min(3, r.planned)
    && r.coverage <= COVERAGE_LIMIT && (r.p95Ms == null || r.p95Ms <= HEAVY_P95_MS)
    && (!centerFree || r.centralCoverage <= CENTRAL_COVERAGE_LIMIT);
  for (const r of results) r.pass = pass(r);
  const header = fs.readFileSync(ENGINE, 'utf8').slice(0, 400).match(/commit (\w+), ([\d-]+)/);
  const report = { engine: header ? { commit: header[1], date: header[2] } : null, centerFree, limits: { COVERAGE_LIMIT, CENTRAL_COVERAGE_LIMIT, HEAVY_P95_MS },
    measuredAt: new Date().toISOString(), results };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  for (const g of groups) {
    const rs = results.filter(r => r.group === g);
    console.log(`${g}：${rs.length} 個，通過 ${rs.filter(r => r.pass).length}`);
  }
  app.exit(0);
});
