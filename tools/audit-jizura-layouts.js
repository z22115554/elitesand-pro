#!/usr/bin/env electron
/**
 * 文字PV（JIZURA）版面稽核：升級引擎後必跑，結果用來更新 lyric-template-jizura.js 的
 * SAFE／HEAVY 版面清單。
 *
 *   npx electron tools/audit-jizura-layouts.js [--center-free] [--layouts center,gloss] [--with-effects] [--fail-fast] [--out 報告.json]
 *
 * 用 Electron 離屏視窗（跟 OBS 瀏覽器來源同樣是 Chromium 離屏渲染）載入 vendored 引擎，
 * 每個 layout 用中日英韓、中文短句／長句，搭配兩個 seed 分別規劃，在透明模式、
 * 1920×1080 下量：
 *   - coverage：整個 cut 期間取樣，不透明像素（alpha > 30）最多佔畫面多少。鐵則 #11：
 *     疊加層不可大面積蓋住直播畫面；2026-10-31 適度放寬至 ≤35%。
 *   - centralCoverage：兩側模式下，中央保留區的不透明比例（≤2%）。
 *   - p95Ms：每幀 renderer.frame() 加上 1px getImageData（強迫 GPU 把這幀做完）的耗時 p95。
 *     瓶頸常在 GPU（一幀上百次文字繪製、發光陰影），只量 JS 會漏掉文字雲這種版面。
 * 量測受機器影響，重要的是版面之間的相對排名；門檻見 HEAVY_P95_MS。
 * 預設固定進退場、停留及文字特效，關閉裝飾／後製，避免把其他部件的成本誤判成版面成本。
 * 保留正式可用的非強烈鏡頭；耗時是這個受控組合的成本，不是單獨 layout.draw 的成本。
 * --with-effects 再測實際搭配；兩側模式跟正式播放一樣關閉殘影。
 * --fail-fast：同版面有一組超過耗時門檻就停止測其餘歌詞（仍會繼續下一個版面）。
 * 稽核產生候選清單，不會自動更動正式白名單，也不是 OBS 端到端 FPS 保證。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

// JIZURA_ENGINE：指定另一份引擎檔（例如升級前的舊版），用來跟新版比對、校準門檻
const ENGINE = process.env.JIZURA_ENGINE || path.join(__dirname, '..', 'public', 'vendor', 'jizura', 'jizura-engine.js');
const COVERAGE_LIMIT = 0.35;
const CENTRAL_COVERAGE_LIMIT = 0.02;
const HEAVY_P95_MS = 25; // 以 30fps 的 33.3ms 預算保留餘裕；仍需 Windows／OBS 實機驗證
const FIXTURES = [
  { lang: 'zh-Hant', text: '一起唱歌' },
  { lang: 'zh-Hant', text: '我們在夜空下唱著最初那首歌' },
  { lang: 'zh-Hant', text: '當我們穿過城市夜空看見那些燈火依然照亮回家的方向' },
  { lang: 'ja', text: '君がくれた光を覚えている' },
  { lang: 'en', text: 'We sing together under the stars tonight' },
  { lang: 'ko', text: '너와 함께 노래하고 싶어' },
];

const args = process.argv.slice(2);
const centerFree = args.includes('--center-free');
const isolated = !args.includes('--with-effects');
const failFast = args.includes('--fail-fast');
const layoutsIdx = args.indexOf('--layouts');
const layouts = layoutsIdx >= 0 ? (args[layoutsIdx + 1] || '').split(',').filter(Boolean) : null;
if (layouts && !layouts.length) throw new Error('--layouts 需要至少一個版面 ID');
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

const PAGE_SCRIPT = (opts) => `
(async () => {
  const W = 1920, H = 1080;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const probe = document.createElement('canvas'); probe.width = 480; probe.height = 270;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  const renderer = new J.Renderer();
  const fixtures = ${JSON.stringify(FIXTURES)};
  const isolated = ${opts.isolated ? 'true' : 'false'};
  const layouts = ${JSON.stringify(opts.layouts)} || J.order('layout');
  for (const layout of layouts) if (!J.LAYOUTS[layout]) throw new Error('Unknown layout: ' + layout);
  const results = [];
  for (const layout of layouts) {
    const cases = [];
    fixtureLoop: for (const fixture of fixtures) for (const seed of [7, 29]) {
      const lines = [2, 6, 10, 14].map(s => '[00:' + String(s).padStart(2, '0') + '.00]' + fixture.text);
      const info = { lang: fixture.lang, text: fixture.text, seed };
      const project = Object.assign(J.defaultProject(), {
        lyrics: lines.join('\\n'), seed, style: 'noir', extra: true, wa: true, lang: fixture.lang, aspect: '16:9',
        centerFree: ${opts.centerFree ? 'true' : 'false'},
        colors: { enabled: true, bg: '#101014', fg: '#ffffff', accentOn: true, accent: '#ffd6a5' },
      });
      project.fx = Object.assign(J.defaultProject().fx, { hud: 'off', flash: false, bgSwitch: 0, koma: 30, onTwos: false, motion: 0.6, decor: 0.5, density: 0.5 });
      project.enabled = {
        layout: Object.fromEntries(J.order('layout').map((k) => [k, k === layout])),
        bg: Object.fromEntries(J.order('bg').map((k) => [k, k === 'none'])),
        trans: Object.fromEntries(J.order('trans').map((k) => [k, false])),
        cam: Object.fromEntries(J.order('cam').map((k) => [k, !(J.CAMERA[k] && J.CAMERA[k].strong)])),
      };
      if (isolated) for (const [group, selected] of [['enter', 'cut'], ['exit', 'cut'], ['hold', 'still'], ['treat', 'none'], ['decor', null]]) {
        project.enabled[group] = Object.fromEntries(J.order(group).map(k => [k, k === selected]));
      }
      let plan;
      try { plan = J.plan(project, null); } catch (e) { cases.push({ ...info, error: String(e && e.message || e) }); continue; }
      const cuts = plan.cuts.filter((c) => c.line >= 0 && c.layout === layout);
      if (!cuts.length) { cases.push({ ...info, skipped: 'not planned (fits() refused this lyric)' }); continue; }
      const c = cuts[1] || cuts[0];
      const renderOptions = { transparent: true, noHud: true, noTrans: true, noGhost: isolated || ${opts.centerFree ? 'true' : 'false'}, noPost: isolated };
      const render = (target, t, scale) => renderer.frame(target, plan, t, { ...renderOptions, scale });
      // 覆蓋率：cut 期間均勻取 8 個時間點，用 1/4 解析度量
      let coverage = 0, centralCoverage = 0;
      for (let k = 1; k <= 8; k++) {
        const t = c.start + (c.end - c.start) * (k / 9);
        pctx.clearRect(0, 0, 480, 270);
        render(pctx, t, 480 / plan.W);
        const d = pctx.getImageData(0, 0, 480, 270).data;
        let n = 0, central = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 30) {
          n++; const x = ((i - 3) / 4) % 480;
          if (x >= 173 && x < 307) central++;
        }
        coverage = Math.max(coverage, n / (480 * 270));
        centralCoverage = Math.max(centralCoverage, central / (134 * 270));
      }
      // 成本：全解析度連畫 90 幀（跨整個 cut），每幀後讀 1px 強迫 GPU 完成
      const times = [];
      for (let f = -3; f < 90; f++) {
        const t = c.start + (c.end - c.start) * ((f + 3) % 90 / 90);
        const t0 = performance.now();
        ctx.clearRect(0, 0, W, H);
        render(ctx, t, W / plan.W);
        ctx.getImageData(0, 0, 1, 1);
        if (f >= 0) times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      cases.push({ ...info, coverage: +coverage.toFixed(4), centralCoverage: +centralCoverage.toFixed(4), p50Ms: +times[45].toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2) });
      if (${opts.failFast ? 'true' : 'false'} && times[Math.floor(times.length * 0.95)] > ${HEAVY_P95_MS}) break fixtureLoop;
    }
    const measured = cases.filter(c => c.coverage != null);
    results.push({ layout, cases, testedCases: cases.length, totalCases: fixtures.length * 2, measuredCases: measured.length,
      ...(measured.length ? {
        coverage: Math.max(...measured.map(c => c.coverage)),
        centralCoverage: Math.max(...measured.map(c => c.centralCoverage)),
        p95Ms: Math.max(...measured.map(c => c.p95Ms)),
      } : { skipped: 'No fixture fitted this layout' }),
    });
  }
  return results;
})()
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1920, height: 1080,
    webPreferences: { offscreen: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  const engineUrl = 'file:///' + ENGINE.replace(/\\/g, '/');
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent"><script src="${engineUrl}"></script></body>`;
  const tmp = path.join(app.getPath('temp'), `jizura-audit-${process.pid}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  await win.loadFile(tmp);
  const header = fs.readFileSync(ENGINE, 'utf8').slice(0, 400).match(/commit (\w+), ([\d-]+)/);
  let results;
  try {
    results = await win.webContents.executeJavaScript(PAGE_SCRIPT({ centerFree, isolated, layouts, failFast }));
  } catch (e) {
    console.error('稽核失敗：', e);
    app.exit(1);
    return;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
  }
  const report = {
    engine: header ? { commit: header[1], date: header[2] } : null,
    centerFree, isolated, failFast, coverageLimit: COVERAGE_LIMIT, centralCoverageLimit: CENTRAL_COVERAGE_LIMIT, heavyP95Ms: HEAVY_P95_MS,
    measuredAt: new Date().toISOString(), results,
  };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  const ok = results.filter((r) => r.coverage != null);
  const safe = ok.filter((r) => r.coverage > 0 && r.coverage <= COVERAGE_LIMIT && r.p95Ms <= HEAVY_P95_MS
    && (!centerFree || r.centralCoverage <= CENTRAL_COVERAGE_LIMIT) && !r.cases.some(c => c.error)).map((r) => r.layout);
  const heavy = ok.filter((r) => r.p95Ms > HEAVY_P95_MS).map((r) => r.layout);
  console.log(`引擎 ${report.engine ? report.engine.commit : '?'}　centerFree=${centerFree}　版面 ${results.length} 個（可量 ${ok.length}）`);
  console.log(`符合覆蓋率／耗時門檻的候選：${safe.length} 個（仍需目視檢查）：${safe.join(', ')}`);
  console.log(`p95 > ${HEAVY_P95_MS}ms（太重）：${heavy.join(', ') || '（無）'}`);
  const top = [...ok].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 15);
  console.log('最重的 15 個：' + top.map((r) => `${r.layout} ${r.p95Ms}ms`).join('、'));
  const skipped = results.filter((r) => r.coverage == null);
  if (skipped.length) console.log('未量到：' + skipped.map((r) => `${r.layout}(${r.error || r.skipped})`).join('、'));
  app.exit(0);
});
