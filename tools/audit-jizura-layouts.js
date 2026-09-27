#!/usr/bin/env electron
/**
 * 文字PV（JIZURA）版面稽核：升級引擎後必跑，結果用來更新 lyric-template-jizura.js 的
 * SAFE／HEAVY 版面清單。
 *
 *   npx electron tools/audit-jizura-layouts.js [--center-free] [--out 報告.json]
 *
 * 用 Electron 離屏視窗（跟 OBS 瀏覽器來源同樣是 Chromium 離屏渲染）載入 vendored 引擎，
 * 每個 layout 各自規劃一段固定歌詞（12 個中文字，實機回報掉幀的那種長度），在透明模式、
 * 1920×1080 下量：
 *   - coverage：整個 cut 期間取樣，不透明像素（alpha > 30）最多佔畫面多少。鐵則 #11：
 *     疊加層不可大面積蓋住直播畫面，模板只收 ≤25% 的版面。
 *   - p95Ms：每幀 renderer.frame() 加上 1px getImageData（強迫 GPU 把這幀做完）的耗時 p95。
 *     瓶頸常在 GPU（一幀上百次文字繪製、發光陰影），只量 JS 會漏掉文字雲這種版面。
 * 量測受機器影響，重要的是版面之間的相對排名；門檻見 HEAVY_P95_MS。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

// JIZURA_ENGINE：指定另一份引擎檔（例如升級前的舊版），用來跟新版比對、校準門檻
const ENGINE = process.env.JIZURA_ENGINE || path.join(__dirname, '..', 'public', 'vendor', 'jizura', 'jizura-engine.js');
const COVERAGE_LIMIT = 0.25;
const HEAVY_P95_MS = 20; // 60fps 的一幀是 16.7ms；p95 超過 20ms 在 OBS 裡會明顯掉幀

const args = process.argv.slice(2);
const centerFree = args.includes('--center-free');
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
  const lyric = '我們在夜空下唱著最初那首歌';
  const lines = [];
  for (let i = 0; i < 4; i++) lines.push('[00:' + String(2 + i * 4).padStart(2, '0') + '.00]' + lyric);
  const results = [];
  for (const layout of J.order('layout')) {
    const project = Object.assign(J.defaultProject(), {
      lyrics: lines.join('\\n'), seed: 7, extra: true, wa: true, lang: 'zh-Hant', aspect: '16:9',
      centerFree: ${opts.centerFree ? 'true' : 'false'},
      colors: { enabled: true, bg: '#101014', fg: '#ffffff', accentOn: true, accent: '#ffd6a5' },
    });
    project.fx = Object.assign(J.defaultProject().fx, { hud: 'off', flash: false, bgSwitch: 0, koma: 30, onTwos: false, motion: 0.6, decor: 0.5, density: 0.5 });
    project.enabled = {
      layout: Object.fromEntries(J.order('layout').map((k) => [k, k === layout])),
      bg: Object.fromEntries(J.order('bg').map((k) => [k, k === 'none'])),
      trans: Object.fromEntries(J.order('trans').map((k) => [k, false])),
    };
    let plan;
    try { plan = J.plan(project, null); } catch (e) { results.push({ layout, error: String(e && e.message || e) }); continue; }
    const cuts = plan.cuts.filter((c) => c.line >= 0 && c.layout === layout);
    if (!cuts.length) { results.push({ layout, skipped: 'not planned (fits() refused this lyric)' }); continue; }
    const c = cuts[1] || cuts[0];
    // 覆蓋率：cut 期間均勻取 8 個時間點，用 1/4 解析度量
    let coverage = 0;
    for (let k = 1; k <= 8; k++) {
      const t = c.start + (c.end - c.start) * (k / 9);
      pctx.clearRect(0, 0, 480, 270);
      renderer.frame(pctx, plan, t, { scale: 480 / plan.W, transparent: true, noHud: true, noTrans: true });
      const d = pctx.getImageData(0, 0, 480, 270).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 30) n++;
      coverage = Math.max(coverage, n / (480 * 270));
    }
    // 成本：全解析度連畫 90 幀（跨整個 cut），每幀後讀 1px 強迫 GPU 完成
    const times = [];
    for (let f = 0; f < 90; f++) {
      const t = c.start + (c.end - c.start) * (f / 90);
      const t0 = performance.now();
      ctx.clearRect(0, 0, W, H);
      renderer.frame(ctx, plan, t, { scale: W / plan.W, transparent: true, noHud: true, noTrans: true });
      ctx.getImageData(0, 0, 1, 1);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    results.push({ layout, coverage: +coverage.toFixed(3), p50Ms: +times[45].toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2) });
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
    results = await win.webContents.executeJavaScript(PAGE_SCRIPT({ centerFree }));
  } catch (e) {
    console.error('稽核失敗：', e);
    app.exit(1);
    return;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
  }
  const report = {
    engine: header ? { commit: header[1], date: header[2] } : null,
    centerFree, coverageLimit: COVERAGE_LIMIT, heavyP95Ms: HEAVY_P95_MS,
    measuredAt: new Date().toISOString(), results,
  };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  const ok = results.filter((r) => r.coverage != null);
  const safe = ok.filter((r) => r.coverage <= COVERAGE_LIMIT).map((r) => r.layout);
  const heavy = ok.filter((r) => r.p95Ms > HEAVY_P95_MS).map((r) => r.layout);
  console.log(`引擎 ${report.engine ? report.engine.commit : '?'}　centerFree=${centerFree}　版面 ${results.length} 個（可量 ${ok.length}）`);
  console.log(`覆蓋率 ≤${COVERAGE_LIMIT * 100}%：${safe.length} 個`);
  console.log(`p95 > ${HEAVY_P95_MS}ms（太重）：${heavy.join(', ') || '（無）'}`);
  const top = [...ok].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 15);
  console.log('最重的 15 個：' + top.map((r) => `${r.layout} ${r.p95Ms}ms`).join('、'));
  const skipped = results.filter((r) => r.coverage == null);
  if (skipped.length) console.log('未量到：' + skipped.map((r) => `${r.layout}(${r.error || r.skipped})`).join('、'));
  app.exit(0);
});
