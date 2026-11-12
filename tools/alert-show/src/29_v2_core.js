
// ======================= V2 共用核心：結尾版面／退場／鏡頭／版面偵錯 =======================
// 規則（2026-11-11 重製）：
//   1. 主角（道具或角色）至少佔畫面高度六成；角色結尾一律半身大圖，不放小小一隻全身。
//   2. 大標題一律用 heroTitle（跟原始版同一套立體字），名字與份數用 plateV2（深色底帶）。
//   3. 疊層順序固定：背景 → 遠景道具 → 角色 → 近景道具 → 標題 → 名牌 → 粒子 → 外框 → 閃光。
//   4. 退場一律把整個畫面畫進緩衝再做轉場（exitV2），不可以各元素自己淡出。
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const sstep = (x) => x * x * (3 - 2 * x);
const slamK = (k, big = 2.6, s = 1.5) => (k < 1 ? big - (big - 1) * eback(k, s) : 1);   // 由大砸到 1
const popK = (k, s = 2) => (k <= 0 ? 0 : k < 1 ? eback(k, s) : 1);                      // 由 0 彈到 1
const hitStop = (t, hits, d = 0.07) => { for (const h of hits) if (t >= h && t < h + d) return h; return t; };
const mixv = (a, b, k) => a + (b - a) * k;

// ---------- 版面偵錯：畫的時候順手登記「臉」和「字」的外框，檢查工具用來抓字壓臉、字出框 ----------
const DBG = { on: false, boxes: [] };
function dbgBox(ctx, kind, name, x0, y0, x1, y1) {
  if (!DBG.on || ctx.globalAlpha < 0.5) return;
  const m = ctx.getTransform(); let X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const px = m.a * x + m.c * y + m.e, py = m.b * x + m.d * y + m.f;
    X0 = Math.min(X0, px); X1 = Math.max(X1, px); Y0 = Math.min(Y0, py); Y1 = Math.max(Y1, py);
  }
  DBG.boxes.push({ kind, name, x0: X0, y0: Y0, x1: X1, y1: Y1 });
}
function dbgBoxC(ctx, kind, name, cx, cy, w, h, rot = 0) {   // 以中心點、寬高、旋轉登記
  if (!DBG.on) return; ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); dbgBox(ctx, kind, name, -w / 2, -h / 2, w / 2, h / 2); ctx.restore();
}
window.__dbgFrame = function (t) { DBG.on = true; DBG.boxes = []; try { draw(t); } finally { DBG.on = false; } return DBG.boxes; };

// ---------- 角色 ----------
const _silCache = new Map();
function silC(img, col) { let m = _silCache.get(img); if (!m) { m = {}; _silCache.set(img, m); } return m[col] || (m[col] = silhouette(img, col)); }
function outlineV2(ctx, img, cx, cy, h, rot, col, w = 12, n = 16) {
  const s = silC(img, col); for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; drawImg(ctx, s, cx + Math.cos(a) * w, cy + Math.sin(a) * w, h, rot); }
}
function girlV2(ctx, gx, gy, gh, t, o = {}) {   // o: rot, alpha, outline(false 關閉), neon(強制彩虹描邊)
  if (!GIRL) return; const rot = o.rot ?? 0.02, pal = PAL[CFG.pal] || PAL.gold;
  if (o.outline !== false) {
    if (o.neon ?? pal.rainbow) neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, rot);
    else { outlineV2(ctx, GIRL_SIL, gx, gy, gh, rot, o.col || pal.edge[1], Math.max(8, gh * 0.008)); outlineV2(ctx, GIRL_SIL, gx, gy, gh, rot, '#fff', Math.max(4, gh * 0.0035), 10); }
  }
  drawImg(ctx, GIRL, gx, gy, gh, rot, o.alpha ?? 1);
  if (DBG.on) { const w = GIRL.width * gh / GIRL.height, fx = gx - w / 2 + FACE.x * w, fy = gy - gh / 2 + FACE.y * gh, r = FACE.s * gh * 0.5; dbgBox(ctx, 'face', 'girl', fx - r, fy - r * 0.85, fx + r, fy + r * 1.05); }
}
function facePos(gx, gy, gh) { const w = GIRL ? GIRL.width * gh / GIRL.height : gh * 0.66; return [gx - w / 2 + FACE.x * w, gy - gh / 2 + FACE.y * gh]; }
function mascotV2(ctx, t, k, x, y, h, flip = false) {
  const img = flip ? mascotFlip() : MASCOT; if (!img || k <= 0) return;
  const s = popK(k, 2.6), bob = Math.abs(Math.sin(t * 9 + (flip ? 1 : 0))) * -22, mr = (flip ? 0.1 : -0.1) + Math.sin(t * 9) * 0.07, pal = PAL[CFG.pal] || PAL.gold;
  if (pal.rainbow) neonOutline(ctx, img, x, y + bob, h * s, t + 0.3, mr); else { outlineV2(ctx, img, x, y + bob, h * s, mr, pal.edge[1], 9); outlineV2(ctx, img, x, y + bob, h * s, mr, '#fff', 4, 10); }
  drawImg(ctx, img, x, y + bob, h * s, mr);
}

// ---------- 文字 ----------
const EXT = { sky: ['#0a2a6a', '#103a8a'], blue: ['#061a5a', '#0a2a8a'], green: ['#063a1a', '#0a5a2a'], red: ['#4a0010', '#7a0020'], gold: ['#5a3000', '#7a4200'], rainbow: ['#2a0a50', '#4a1080'], premium: ['#2a0a50', '#4a1080'] };
const _tw = {};
function titleW(txt) { if (_tw[txt]) return _tw[txt]; g.save(); g.font = titleFont(txt); const w = g.measureText(txt).width; g.restore(); return (_tw[txt] = w); }
function heroTitle(ctx, t, x, y, k, o = {}) {   // 大標題：k 進場進度；o.maxW 自動縮到放得下
  if (k <= 0) return; const w0 = titleW(CFG.title) + 70, fit = Math.min(o.s ?? 1.05, (o.maxW ?? 1100) / w0), rot = o.rot ?? -0.05;
  const s = fit * slamK(k, o.big ?? 2.6) * (1 + (o.pk ?? 0) * 0.06);
  _titleNoFit = true; try { title3D(ctx, t, x, y, s, rot, o.depth ?? 16, o.ext || EXT[CFG.pal] || EXT.gold); } finally { _titleNoFit = false; }
  if (k >= 1) dbgBoxC(ctx, 'text', 'title', x, y, w0 * fit, 215 * fit, rot);
}
function plateV2(ctx, t, a, x, y, sc = 1.1) {   // 名字＋份數的深色底帶
  if (a <= 0 || sc <= 0) return; subLine(ctx, t, a, x, y - (1 - a) * 30, sc);
  if (a >= 1) dbgBoxC(ctx, 'text', 'plate', x - 10 * sc, y, 950 * sc, 190 * sc, -0.06);
}
function wordV2(ctx, txt, x, y, k, o = {}) {   // 演出中的大字（チャンス、LOCK ON 之類）：白邊＋深色外框；o.font 可換字型（Dela 缺字時用）
  if (k <= 0) return; const s = (o.s ?? 1) * (o.pop === false ? 1 : slamK(k, o.big ?? 2.2, 1.6)) * (1 + (o.beat ?? 0));
  ctx.save(); ctx.globalAlpha *= o.a ?? 1; ctx.translate(x, y); ctx.rotate(o.rot ?? -0.05); ctx.scale(s, s);
  ctx.font = o.font || (curLang() === 'zh-TW' && DELA_MISSING.test(txt) ? "900 150px 'Noto Sans TC'" : "150px 'Dela Gothic One', 'Noto Sans TC'"); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (o.maxW) { const fit = Math.min(1, o.maxW / ((ctx.measureText(txt).width + 50) * (o.s ?? 1))); ctx.scale(fit, fit); }   /* 翻譯後變長就縮到放得下 */
  for (let i = o.depth ?? 8; i >= 1; i--) { ctx.strokeStyle = o.stroke || '#1a0838'; ctx.lineWidth = 40; ctx.strokeText(txt, i * 1.3, i * 2); }
  ctx.strokeStyle = o.stroke || '#1a0838'; ctx.lineWidth = 40; ctx.strokeText(txt, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 12; ctx.strokeText(txt, 0, 0);
  ctx.fillStyle = o.fill || '#ffe14a'; ctx.fillText(txt, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-2000, -95, 4000, 80); ctx.clip(); ctx.globalAlpha *= 0.3; ctx.fillStyle = '#fff'; ctx.fillText(txt, 0, 0); ctx.restore();
  if (k >= 1 && o.box !== false) { const w = ctx.measureText(txt).width + 50; dbgBox(ctx, 'text', 'word:' + txt, -w / 2, -95, w / 2, 95); }
  ctx.restore();
}
function medalV2(ctx, t, x, y, k, pk = 0, sc = 1) {   // 金色星芒徽章「×N」
  if (k <= 0) return; const s = sc * (k < 1 ? 3 - 2 * eback(k, 1.6) : 1 + pk * 0.08);
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.14 + Math.sin(t * 3) * 0.04); ctx.scale(s, s);
  ctx.save(); ctx.rotate(t * 1.2); ctx.beginPath();
  for (let i = 0; i < 48; i++) { const r = i % 2 ? 132 : 164, a = i / 48 * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); const gg = ctx.createRadialGradient(0, 0, 20, 0, 0, 164); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.7, '#ffb21a'); gg.addColorStop(1, '#c76a00');
  ctx.fillStyle = gg; ctx.shadowColor = 'rgba(255,220,100,0.9)'; ctx.shadowBlur = 36; ctx.fill(); ctx.shadowBlur = 0; ctx.lineWidth = 5; ctx.strokeStyle = '#7a4200'; ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#c4002a'; ctx.beginPath(); ctx.arc(0, 0, 116, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff2a0'; ctx.lineWidth = 8; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 100, 0, 7); ctx.stroke();
  const ns = CFG.medalText || ('×' + CFG.n), fs = ns.length <= 3 ? 104 : Math.round(104 * 3.2 / ns.length);
  ctx.font = `${fs}px 'Dela Gothic One'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#3a0010'; ctx.lineWidth = 16; ctx.strokeText(ns, 0, 6);
  const fg = ctx.createLinearGradient(0, -50, 0, 56); fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.45, '#fff2a0'); fg.addColorStop(1, '#ffb21a'); ctx.fillStyle = fg; ctx.fillText(ns, 0, 6);
  ctx.restore();
  if (k >= 1) dbgBoxC(ctx, 'text', 'medal', x, y, 250 * sc, 250 * sc);
}

// ---------- 鏡頭／特效 ----------
function camV2(ctx, cx, cy, z, rot = 0) { ctx.translate(cx, cy); ctx.scale(z, z); if (rot) ctx.rotate(rot); ctx.translate(-cx, -cy); }
function ringBurst(ctx, x, y, l, o = {}) {   // 衝擊波圓環
  const d = o.dur ?? 0.4; if (l < 0 || l > d) return; const p = l / d;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = o.col || `rgba(255,255,230,${(1 - p) * (o.a ?? 0.9)})`; ctx.globalAlpha = 1 - p; ctx.lineWidth = (o.w ?? 40) * (1 - p) + 2;
  ctx.beginPath(); ctx.ellipse(x, y, (o.r0 ?? 120) + eo(p) * (o.r1 ?? 1300), ((o.r0 ?? 120) + eo(p) * (o.r1 ?? 1300)) * (o.sq ?? 0.62), o.rot ?? -0.08, 0, 7); ctx.stroke(); ctx.restore();
}
function dimBG(ctx, a, glow) {   // 中量用：不整個蓋掉直播畫面，只壓暗＋一團色光
  ctx.save(); ctx.fillStyle = `rgba(6,5,18,${0.62 * a})`; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (glow) { const [x, y, r, col] = glow; const gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = a; ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160); }
  ctx.restore();
}
function sparkleField(ctx, t, n, x0, y0, x1, y1, a = 1, cols = ['#fff', '#fff2a8']) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) { const ph = (t * (0.7 + R(i, 1)) + R(i, 2)) % 1, s = Math.sin(ph * Math.PI); star4(ctx, x0 + R(i, 3) * (x1 - x0), y0 + R(i, 4) * (y1 - y0), 8 + s * (12 + R(i, 5) * 26), cols[i % cols.length], s * 0.9 * a); }
  ctx.restore();
}

function shardsV2(ctx, x, y, l, n = 28, cols = ['#fff6c0', '#ffd24a', '#ffffff']) {   // 暗底用的金色星屑（亮底用原本的 coins）
  if (l < 0 || l > 0.9) return; const p = l / 0.9;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) { const a = R(i, 41) * Math.PI * 2, v = 500 + R(i, 42) * 900;
    star4(ctx, x + Math.cos(a) * v * l * (1 - p * 0.35), y + Math.sin(a) * v * l * 0.75 * (1 - p * 0.35) + 700 * l * l, (10 + R(i, 43) * 24) * (1 - p), cols[i % cols.length], 1 - p); }
  ctx.restore();
}
function rainbowBG2(ctx, t, cx = 560, cy = 470) {   // 彩虹放射背景（可指定光心、帶出血）
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1700);
  bg.addColorStop(0, '#fffbe0'); bg.addColorStop(0.12, '#ffe14a'); bg.addColorStop(0.35, '#ff5aa5'); bg.addColorStop(0.62, '#7a3cff'); bg.addColorStop(1, '#10073a');
  ctx.fillStyle = bg; ctx.fillRect(-80, -80, W + 160, H + 160);
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.filter = 'blur(18px)'; const n = 36, rot = t * 0.35;
  for (let i = 0; i < n; i++) { ctx.fillStyle = `hsla(${(i * 360 / n + t * 120) % 360},100%,62%,${i % 2 ? 0.75 : 0.3})`; const a0 = rot + i / n * Math.PI * 2, a1 = a0 + Math.PI / n;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * 3200, cy + Math.sin(a0) * 3200); ctx.lineTo(cx + Math.cos(a1) * 3200, cy + Math.sin(a1) * 3200); ctx.fill(); }
  ctx.restore();
  speedLines(ctx, cx, cy, 90, 520, 'rgba(255,255,255,0.55)', Math.floor(t * 30), 0, 0.7);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) { const ph = (t * (1.2 + R(i, 1)) + R(i, 2)) % 1, s = Math.sin(ph * Math.PI); star4(ctx, R(i, 3) * W, R(i, 4) * H, 10 + s * (16 + R(i, 5) * 34), i % 3 ? '#fff' : '#fff2a8', s * 0.9); }
  ctx.restore();
}
// ---------- 退場：整個畫面一起收 ----------
function exitV2(ctx, k, f, render, kind = 'smear') {
  if (kind === 'smear') return exitSmear(ctx, k, f, render);
  bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.globalCompositeOperation = 'source-over'; bctx.filter = 'none'; bctx.clearRect(0, 0, W, H); render(bctx);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'; ctx.clearRect(0, 0, W, H);
  if (kind === 'slice') {   // 斜切成條，上下交錯滑出
    const n = 10, sw = (W + 400) / n;
    for (let i = 0; i < n; i++) { const kk = ei(clamp(k * 1.5 - i * 0.045)), dir = i % 2 ? 1 : -1, x0 = -200 + i * sw;
      ctx.save(); ctx.beginPath(); ctx.moveTo(x0 + 160, 0); ctx.lineTo(x0 + sw + 160.5, 0); ctx.lineTo(x0 + sw - 159.5, H); ctx.lineTo(x0 - 160, H); ctx.closePath(); ctx.clip();
      ctx.drawImage(buf, dir * kk * -320, dir * kk * 1250); ctx.restore(); }
  } else if (kind === 'crt') {   // 映像管關機：壓成一條亮線再縮成一點
    const a = eio(lin(k, 0, 0.5)), b = eio(lin(k, 0.45, 0.95)), sy = Math.max(0.006, 1 - a), sx = Math.max(0.004, 1 - b);
    ctx.translate(CX, CY); ctx.scale(sx, sy); ctx.drawImage(buf, -CX, -CY);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55 * a * (1 - lin(k, 0.9, 1)); ctx.fillStyle = '#fff'; ctx.fillRect(-CX, -CY, W, H);
  } else if (kind === 'iris') {   // 圓形光圈收到臉上
    const [ix, iy] = exitV2.center || [CX, CY], r = Math.max(0.5, (1 - eio(k)) * 2300);
    ctx.beginPath(); ctx.arc(ix, iy, r, 0, 7); ctx.clip(); ctx.drawImage(buf, 0, 0);
    ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(ix, iy, Math.max(0.5, r - 7), 0, 7); ctx.stroke();
  } else {   // 'whip'：整個畫面往一側甩出去，帶殘影
    const e = ei(k), dx = (kind === 'whipL' ? -1 : 1) * e * (W + 500);
    for (let i = 5; i >= 0; i--) { ctx.globalAlpha = i ? 0.16 : 1; ctx.drawImage(buf, dx - (kind === 'whipL' ? -1 : 1) * i * 70 * Math.min(1, k * 4), 0); }
  }
  ctx.restore();
}
// 一支演出的骨架：前戲 pre(c, t) → 結尾 fin(c, m, t) → 退場
function runV2(ctx, t, o) {
  const D = CFG.dur, EX = D - (o.exit ?? 0.55);
  const scene = (c, tt) => {
    if (tt < o.T) o.pre(c, tt);
    else { o.fin(c, tt - o.T, tt); if (o.cut !== false) flash(c, (1 - lin(tt, o.T, o.T + 0.16)) * (o.cutA ?? 0.8), o.cutCol || '#fff'); }
  };
  if (t >= EX) exitV2(ctx, lin(t, EX, D - 0.02), Math.floor(t * 60), (c) => scene(c, t), o.exitKind);
  else scene(ctx, t);
}

// ---------- 結尾共用版面 ----------
const LAYS = {
  R: { girl: { x: 1400, h: 1650, from: 'right', rot: 0.02 }, title: { x: 650, y: 330, maxW: 1080, rot: -0.05 }, plate: { x: 660, y: 650, sc: 1.1 }, medal: { x: 250, y: 900, sc: 0.85 }, mascot: { x: 770, y: 935, h: 290 } },
  L: { girl: { x: 500, h: 1650, from: 'left', rot: -0.02 }, title: { x: 1270, y: 310, maxW: 1150, rot: -0.06 }, plate: { x: 1290, y: 640, sc: 1.1 }, medal: { x: 1000, y: 905, sc: 0.85 }, mascot: { x: 1690, y: 935, h: 300, flip: true } },
  C: { girl: { x: 960, h: 1650, from: 'below', rot: 0 }, title: { x: 960, y: 745, maxW: 1500, rot: -0.03 }, plate: { x: 960, y: 965, sc: 0.85 }, medal: { x: 330, y: 270, sc: 1 }, mascot: { x: 1640, y: 890, h: 320, flip: true } },
};
function finaleHero(ctx, m, t, o = {}) {   // 原本的結尾構圖（大標題＋名牌＋徽章）；其他構圖在 v2_fin.js
  const L = LAYS[o.lay || 'R'], hi = CFG.id === 'g25' || CFG.id === 'g50' || CFG.id === 'g100' || !!CFG.hi;
  const G = Object.assign({}, L.girl, o.girl), TT = Object.assign({}, L.title, o.title), PL = Object.assign({}, L.plate, o.plate);
  const MD = o.medal === false || (!hi && !o.medal) ? null : Object.assign({}, L.medal, o.medal);
  const MS = o.mascot === false || (!hi && !o.mascot) ? null : Object.assign({}, L.mascot, o.mascot);
  const T0 = o.tTitle ?? 0.32, pw = CFG.power ?? 1, pal = PAL[CFG.pal] || PAL.gold;
  const tick = o.ticker ?? (CFG.id === 'g50' || CFG.id === 'g100' || !!CFG.tick);   // 有上下跑馬燈時，下方的徽章和吉祥物往上讓
  // 角色高度：頭頂要留在上方外框（燈框、跑馬燈）下面，不要頂到畫面上緣
  if (G.y === undefined && G.h) G.y = (tick ? 150 : (o.led ?? hi) ? 100 : 66) + G.h / 2;
  if (tick && MD && !(o.medal && o.medal.y !== undefined) && MD.y > 800) { MD.y -= 66; MD.sc *= 0.9; if (!(o.plate && o.plate.y !== undefined)) PL.y -= 30; if (!(o.title && o.title.y !== undefined)) TT.y -= 20; } if (tick && MS && !(o.mascot && o.mascot.y !== undefined) && MS.y > 800) MS.y -= 60;
  const hits = [[0, 1], [T0, 0.9]]; if (MD) hits.push([T0 + 0.5, 0.6]); for (let b = T0 + 0.9; b < 5; b += 0.4) hits.push([b, 0.26]);
  const pk = decay(m, hits, 13);
  ctx.save();
  camV2(ctx, o.cam ? o.cam[0] : CX, o.cam ? o.cam[1] : CY, 1.014 + pk * 0.045 + Math.min(m, 5) * 0.005); shakeAt(ctx, t, (2 + pk * 24) * pw);
  if (o.bg) o.bg(ctx, m, t, pk); else if (pal.rainbow) rainbowBG2(ctx, t * 2.2, o.bgC ? o.bgC[0] : G.x - 120, o.bgC ? o.bgC[1] : 380); else { ctx.save(); ctx.translate(-30, -20); ctx.scale(1.03, 1.04); palBG(ctx, t, pal, G.x - 120, 360); ctx.restore(); }
  if (o.back) o.back(ctx, m, t, pk);
  // 角色
  const gk = lin(m, o.tGirl ?? 0.08, (o.tGirl ?? 0.08) + 0.36);
  if (gk > 0 && G.h) {
    const e = eo5(gk), dir = G.from === 'right' ? 1 : G.from === 'left' ? -1 : 0, gh = G.h * (1 + pk * 0.018);
    const gx = G.x + dir * (1 - e) * 1000, gy = G.y + (G.from === 'below' ? (1 - e) * 950 : 0) + Math.sin(t * 2.1) * 6;
    if (gk < 1 && dir) for (let i = 1; i <= 4; i++) drawImg(ctx, silC(GIRL_SIL, `hsl(${i * 70},100%,62%)`), gx + dir * i * 90 * (1 - gk), gy, gh, G.rot, 0.35);
    girlV2(ctx, gx, gy, gh, t, { rot: G.rot });
  }
  if (o.mid) o.mid(ctx, m, t, pk);
  // 標題（砸下的瞬間噴碎片、衝擊波）
  const tk = lin(m, T0, T0 + 0.18);
  if (m >= T0) { ctx.save(); ctx.translate(TT.x - 730, TT.y - 420); coins(ctx, m - T0 + T_HIT); ctx.restore(); ringBurst(ctx, TT.x, TT.y, m - T0, { r1: 1500 }); }
  heroTitle(ctx, t, TT.x, TT.y, tk, { maxW: TT.maxW, rot: TT.rot, pk, s: TT.s, depth: TT.depth });
  plateV2(ctx, t, eo(lin(m, T0 + 0.28, T0 + 0.48)), PL.x, PL.y, PL.sc);
  if (MD) medalV2(ctx, t, MD.x, MD.y, lin(m, T0 + 0.5, T0 + 0.68), pk, MD.sc);
  if (MS) mascotV2(ctx, t, lin(m, T0 + 0.7, T0 + 1.0), MS.x, MS.y, MS.h, MS.flip);
  if (o.front) o.front(ctx, m, t, pk);
  ctx.restore();
  if (o.confetti !== false) confetti(ctx, m, 0.05, o.confettiN ?? (hi ? 150 : 70), o.confetti || ['#ffe27a', '#fff6c0', '#ffffff', pal.edge ? pal.edge[1] : '#ff5aa5', '#ff5a8c'], 5);
  if (tick) { const e = 1 - eo5(lin(m, T0 + 0.2, T0 + 0.45)); if (m > T0 + 0.2) { tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); } }
  if (o.led ?? hi) { ctx.save(); ctx.globalAlpha = lin(m, 0, 0.25); if (pal.rainbow) ledFrame(ctx, t); else ledFrameHue(ctx, t, (i) => ({ red: 0, blue: 205, sky: 200, green: 120 }[CFG.pal] ?? 38) + ((i * 7 + t * 80) % 20)); ctx.restore(); }
  if (m >= T0) flash(ctx, (1 - lin(m, T0, T0 + 0.1)) * 0.32, '#fff6d0');
}

// ---------- 字型預載：Google Fonts 的中日文字型是分片載入，第一次畫到才抓，會先用系統字型頂替（同一行兩種字體）。
// mkengine.py 會把所有原始檔裡出現過的字收進 window.__V2_TEXT，這裡一次載完。
const _lvaV2 = window.loadVarAssets;
window.loadVarAssets = async function () {
  if (_lvaV2) await _lvaV2();
  const s = (window.__V2_TEXT || '') + P.name;
  for (const f of ["150px 'Dela Gothic One'", "900 150px 'Noto Sans TC'", "700 40px 'Noto Sans TC'", "700 40px 'LXGW WenKai TC'"]) { try { await document.fonts.load(f, s); } catch (e) {} }
};

// 名字＋份數底帶（覆寫原版）：名字太長會自動縮字，不會衝出底帶
function subLine(ctx, t, a, X = 800, Y = 750, SC = 1.25) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(X, Y); ctx.rotate(-0.06); ctx.scale(SC, SC);
  ctx.fillStyle = '#1a0838'; ctx.beginPath(); ctx.moveTo(-470, -80); ctx.lineTo(470, -96); ctx.lineTo(450, 86); ctx.lineTo(-490, 98); ctx.fill();
  ctx.fillStyle = '#ffe14a'; ctx.fillRect(-470, 82, 920, 8);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.font = "900 46px 'Noto Sans TC'"; const w1 = ctx.measureText(CFG.sub1).width, f1 = Math.min(1, 840 / w1);
  ctx.save(); ctx.translate(0, -42); ctx.scale(f1, f1); ctx.fillStyle = '#fff'; ctx.fillText(CFG.sub1, 0, 0); ctx.restore();
  ctx.font = "900 80px 'Noto Sans TC'"; const w2 = ctx.measureText(CFG.sub2).width, f2 = Math.min(1, 820 / w2);
  ctx.save(); ctx.translate(0, 40); ctx.scale(f2, f2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 16; ctx.strokeText(CFG.sub2, 0, 0);
  const ag = ctx.createLinearGradient(0, -46, 0, 34); ag.addColorStop(0, '#fff3a0'); ag.addColorStop(0.5, '#ffb21a'); ag.addColorStop(0.52, '#ff7a00'); ag.addColorStop(1, '#ff3d8b');
  ctx.fillStyle = ag; ctx.fillText(CFG.sub2, 0, 0); ctx.restore();
  ctx.restore();
}

// ---------- 大標題字型：Dela Gothic One 缺的字（揪、閱、號…）整行改用 Noto Sans TC 900，不讓同一行出現兩種字體 ----------
const DELA_MISSING = /[揪閱號]/;
function titleFont(txt) { return DELA_MISSING.test(txt) ? "900 200px 'Noto Sans TC'" : "200px 'Dela Gothic One', 'Noto Sans TC'"; }
let _titleNoFit = false;   // heroTitle 自己會算縮放，不要再縮一次
function titleFit(x) { if (_titleNoFit) return 1; const av = 2 * Math.min(x - 40, W - 40 - x); return Math.min(1, av / ((titleW(CFG.title) + 70) * 1.08)); }
function titleText(ctx, t, x, y, s, rot) {   // 覆寫原版：字型依標題內容決定
  const txt = CFG.title, pal = PAL[CFG.pal]; s *= titleFit(x);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = titleFont(txt); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.shadowColor = pal.glow; ctx.shadowBlur = 40; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 56; ctx.strokeText(txt, 0, 0); ctx.shadowBlur = 0;
  const gold = ctx.createLinearGradient(0, -110, 0, 110); gold.addColorStop(0, '#fff6c0'); gold.addColorStop(0.45, '#ffb21a'); gold.addColorStop(0.55, '#c76a00'); gold.addColorStop(1, '#ffe27a');
  ctx.strokeStyle = gold; ctx.lineWidth = 34; ctx.strokeText(txt, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.strokeText(txt, 0, 0);
  ctx.fillStyle = palFill(ctx, -95, 95, t, pal); ctx.fillText(txt, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-2000, -120, 4000, 95); ctx.clip(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillText(txt, 0, 0); ctx.restore();
  const sw = ((t - 4.0) * 0.9) % 1.6; if (sw > 0 && sw < 1) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; const gx = -900 + sw * 1800, gr = ctx.createLinearGradient(gx - 120, 0, gx + 120, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillText(txt, 0, 0); ctx.restore(); }
  ctx.restore();
}
function title3D(ctx, t, x, y, s, rot, depth, col) {
  const f3 = titleFit(x);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * f3, s * f3);
  ctx.font = titleFont(CFG.title); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let i = depth; i >= 1; i--) { ctx.strokeStyle = col[i % 2]; ctx.lineWidth = 56; ctx.strokeText(CFG.title, i * 1.4, i * 2.2); }
  ctx.restore(); titleText(ctx, t, x, y, s, rot);
}
