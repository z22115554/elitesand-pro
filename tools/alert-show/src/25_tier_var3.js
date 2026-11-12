
// ======================= 第三批：贈訂大量（g10） =======================
const HUD_C = '#5ff2ff', HUD_R = '#ff3a5a';
function hudText(ctx, txt, x, y, size, col, align = 'left', a = 1) {
  ctx.save(); ctx.globalAlpha *= a; ctx.font = `700 ${size}px 'Noto Sans TC'`; ctx.letterSpacing = `${Math.round(size * 0.12)}px`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.fillStyle = col; ctx.fillText(txt, x, y); ctx.restore();
}
function brackets(ctx, x, y, w, h, len, col, lw = 4, a = 1) {   // 四角括弧框
  ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const cx = x + sx * w / 2, cy = y + sy * h / 2; ctx.moveTo(cx, cy - sy * len); ctx.lineTo(cx, cy); ctx.lineTo(cx - sx * len, cy); }
  ctx.stroke(); ctx.restore();
}
function girlGeo(gx, gy, gh) { const gw = GIRL.width * gh / GIRL.height; return { gw, fx: gx - gw / 2 + FACE.x * gw, fy: gy - gh / 2 + FACE.y * gh, fr: FACE.s * gh }; }

// ---------------- 大量 2：鎖定掃描 ----------------
function vScan(ctx, t) {
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), pal = PAL[CFG.pal];
  const SCAN0 = 0.35, SCAN1 = 1.5, SEEK = 1.5, LOCK = 2.05, DATA = 2.45;
  ctx.save(); ctx.globalAlpha = 1 - out;
  ctx.fillStyle = `rgba(2,8,18,${0.82 * app})`; ctx.fillRect(0, 0, W, H);
  // 格線與掃描線
  ctx.save(); ctx.globalAlpha *= 0.18 * app; ctx.strokeStyle = HUD_C; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = (t * 40) % 80; y <= H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
  const hot = eo(lin(t, LOCK + 0.05, LOCK + 0.4));
  if (hot > 0 && GIRL) { const G0 = girlGeo(1330, 560, 900); ctx.save(); ctx.globalAlpha *= hot; palBG(ctx, t, PAL.red, G0.fx, G0.fy); ctx.fillStyle = 'rgba(30,0,10,0.45)'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  // 角色：先是掃描中的藍色輪廓，掃描線經過的地方顯示本人
  const lockK = lin(t, LOCK, LOCK + 0.35), zoom = 1 + 0.18 * Math.sin(Math.PI * lockK);
  const gh = 900, gx = 1330, gy = 560, G = GIRL ? girlGeo(gx, gy, gh) : null;
  if (GIRL) {
    ctx.save(); if (G) { ctx.translate(G.fx, G.fy); ctx.scale(zoom, zoom); ctx.translate(-G.fx, -G.fy); }
    const scanY = -100 + (H + 200) * eio2(lin(t, SCAN0, SCAN1));
    drawImg(ctx, silhouette(GIRL_SIL, '#1d7fa0'), gx, gy, gh, 0, 0.55 * app);
    if (t >= LOCK) neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, 0);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, scanY); ctx.clip(); drawImg(ctx, GIRL, gx, gy, gh, 0, app); ctx.restore();
    if (t > SCAN0 && t < SCAN1 + 0.1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 6); g.addColorStop(0, 'rgba(95,242,255,0)'); g.addColorStop(1, 'rgba(95,242,255,0.7)'); ctx.fillStyle = g; ctx.fillRect(gx - 520, scanY - 60, 1040, 66); ctx.fillStyle = '#c8fbff'; ctx.fillRect(gx - 520, scanY, 1040, 3); ctx.restore(); }
    ctx.restore();
  }
  // 誘餌目標框（亂飄）→ 準星衝到臉上鎖定
  if (t > 0.5 && t < LOCK) for (let i = 0; i < 3; i++) {
    const ph = t * (1.3 + i * 0.4) + i * 2, x = 380 + i * 260 + Math.sin(ph) * 120, y = 300 + i * 170 + Math.cos(ph * 1.3) * 90, a = (1 - lin(t, SEEK, LOCK)) * lin(t, 0.5 + i * 0.2, 0.7 + i * 0.2);
    brackets(ctx, x, y, 110, 110, 22, HUD_C, 2, a); hudText(ctx, '?', x, y, 34, HUD_C, 'center', a * (Math.floor(t * 8 + i) % 2 ? 1 : 0.4));
  }
  if (G && t > SEEK - 0.4) {
    const k = eo5(lin(t, SEEK - 0.4, LOCK)), sx = 560 + (G.fx - 560) * k, sy = 760 + (G.fy - 760) * k, sz = 520 - (520 - G.fr * 2.6) * k;
    const locked = t >= LOCK, col = locked ? HUD_R : HUD_C, pop = locked ? 1 + 0.25 * Math.exp(-(t - LOCK) * 10) : 1;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate((1 - k) * 1.2 + (locked ? 0 : Math.sin(t * 9) * 0.04)); ctx.scale(pop, pop);
    brackets(ctx, 0, 0, sz, sz, sz * 0.22, col, 5);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(0, 0, sz * 0.62, 0, 7); ctx.moveTo(-sz * 0.75, 0); ctx.lineTo(-sz * 0.3, 0); ctx.moveTo(sz * 0.3, 0); ctx.lineTo(sz * 0.75, 0); ctx.moveTo(0, -sz * 0.75); ctx.lineTo(0, -sz * 0.3); ctx.moveTo(0, sz * 0.3); ctx.lineTo(0, sz * 0.75); ctx.stroke();
    ctx.restore();
    if (locked) { const l = t - LOCK;
      for (let i = 0; i < 3; i++) { const q = (l - i * 0.08) / 0.6; if (q < 0 || q > 1) continue; ctx.save(); ctx.strokeStyle = `rgba(255,${120 + i * 50},${120 + i * 40},${1 - q})`; ctx.lineWidth = 14 * (1 - q) + 2; ctx.beginPath(); ctx.arc(G.fx, G.fy, G.fr + 900 * eo(q), 0, 7); ctx.stroke(); ctx.restore(); }
      ctx.save(); ctx.translate(G.fx - G.fr * 1.5 - 300, G.fy - 20); ctx.rotate(-0.04); const s = l < 0.12 ? 2 - l / 0.12 : 1; ctx.scale(s, s); ctx.globalAlpha = Math.floor(l * 10) % 2 && l < 0.6 ? 0.6 : 1;
      ctx.fillStyle = HUD_R; ctx.fillRect(-190, -42, 380, 84); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(-190, -42, 380, 84); hudText(ctx, 'LOCK ON', 0, 3, 58, '#fff', 'center'); ctx.restore(); }
  }
  // 上方狀態列
  const st = t < SEEK ? 'SCANNING' : t < LOCK ? 'TARGET FOUND' : 'LOCKED';
  hudText(ctx, st + (t < LOCK && Math.floor(t * 4) % 2 ? ' ...' : ''), 90, 84, 44, t < LOCK ? HUD_C : HUD_R, 'left', app);
  ctx.save(); ctx.globalAlpha *= app; ctx.fillStyle = HUD_C; ctx.fillRect(90, 120, 520 * Math.min(1, t / LOCK), 6); ctx.restore();
  if (t >= LOCK && t < LOCK + 0.5) { const l = t - LOCK; ctx.save(); ctx.globalAlpha = 0.35 * (1 - l / 0.5) * (Math.floor(l * 16) % 2); ctx.fillStyle = HUD_R; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  // 資料面板（左）：一行一行打出來
  if (t >= DATA) {
    const l = t - DATA, px = 110, py = 300, pw = 820, ph = 500, op = eo5(lin(l, 0, 0.25));
    ctx.save(); ctx.translate(px, py); ctx.scale(1, op);
    ctx.fillStyle = 'rgba(4,20,34,0.85)'; ctx.fillRect(0, 0, pw, ph); ctx.strokeStyle = HUD_C; ctx.lineWidth = 2; ctx.strokeRect(0, 0, pw, ph);
    ctx.fillStyle = HUD_R; ctx.fillRect(0, 0, 12, ph); ctx.restore();
    const rows = [['GIFT FROM', P.name], ['SUBS', '×' + CFG.n], ['STATUS', 'MAX HAPPY']];
    rows.forEach((r, i) => { const k = l - 0.35 - i * 0.12; if (k < 0) return; const n = Math.ceil(r[1].length * Math.min(1, k / 0.2));
      hudText(ctx, r[0], px + 50, py + 260 + i * 72, 30, HUD_C); hudText(ctx, r[1].slice(0, n), px + 330, py + 260 + i * 72, 42, '#ffffff'); });
    const tk = lin(l, 0.2, 0.4); if (tk > 0) { const ss = tk < 1 ? 1.7 - 0.7 * eback(tk, 1.6) : 1; ctx.save(); ctx.translate(px + pw / 2, py + 110); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 124, pal, 'center'); ctx.restore(); }
  }
  ctx.restore();
}
function eio2(u) { return u * u * (3 - 2 * u); }
VARS.g10[2] = { name: '鎖定掃描', fn: vScan, dur: 5.0 };

// ---------------- 大量 1：幸運大轉盤 ----------------
let WHEEL_DISC = null, WHEEL_PTR = null, WHEEL_STAND = null;
const WHEEL_GEO = { hubY: 0.123, bulbR: 0.465, nB: 32, seg: 8, winA: -67.5 };   // 底座軸心高度、燈泡半徑（盤寬比例）、金色格中心角（圖上角度）
const _lvaBase3 = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaBase3();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  WHEEL_DISC = await L2('DEF_WHEEL_DISC', 'wheel_disc.png'); WHEEL_PTR = await L2('DEF_WHEEL_PTR', 'wheel_pointer.png'); WHEEL_STAND = await L2('DEF_WHEEL_STAND', 'wheel_stand.png');
};
const WH_T = { in: 0.45, slow: 2.5, hold: 2.95, stop: 3.25 };
function wheelAngle(t) {   // 度數；最後一段先停在金色格前一格，撐住，再爬過界線
  const fin = -90 - WHEEL_GEO.winA, pre = fin - 28 + 360 * 7;
  if (t < WH_T.in) return 0;
  if (t < WH_T.slow) { const u = lin(t, WH_T.in, WH_T.slow); return pre * (1 - Math.pow(1 - u, 3)); }
  if (t < WH_T.hold) return pre + Math.sin((t - WH_T.slow) * 30) * 0.6;
  const u = lin(t, WH_T.hold, WH_T.stop); return pre + 28 * (u < 1 ? u * u * (3 - 2 * u) : 1) + 360 * 0 - (pre + 28 - fin - 360 * 7) * 0;
}
function vRoulette(ctx, t) {
  if (!WHEEL_DISC) return;
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), pal = PAL[CFG.pal], STOP = WH_T.stop, won = t >= STOP;
  ctx.save(); ctx.globalAlpha = app * (1 - out); palBG(ctx, t, PAL.red, 960, 540); ctx.fillStyle = `rgba(30,0,8,${won ? 0.15 : 0.4})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  if (won) { ctx.save(); ctx.globalAlpha = (1 - out) * eo(lin(t, STOP, STOP + 0.3)); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960 - 330 * eo5(lin(t, STOP + 0.15, STOP + 0.6)), 610, 14, 'rgba(255,230,150,0.22)', t * 0.4, 1800, 0.45, 16); ctx.restore(); }
  const ent = eback(lin(t, 0.05, 0.5), 1.5), mv = eo5(lin(t, STOP + 0.15, STOP + 0.6)), dia = 640, wx = 960 - 330 * mv - out * 900, wy = 540 + 70 * mv + (1 - ent) * 900;
  const stH = dia * 0.93, stW = WHEEL_STAND.width * stH / WHEEL_STAND.height;
  const pk = won ? Math.exp(-(t - STOP) * 8) : 0;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * pk * 14, (R(Math.floor(t * 60), 2) - 0.5) * pk * 14);
  ctx.drawImage(WHEEL_STAND, wx - stW / 2, wy - stH * WHEEL_GEO.hubY, stW, stH);
  // 盤面（高速時畫殘影）
  const ang = wheelAngle(t), om = Math.abs(wheelAngle(t) - wheelAngle(t - 1 / 60)) * 60;
  const ghosts = om > 200 ? 4 : 0;
  for (let g = ghosts; g >= 0; g--) { ctx.save(); ctx.globalAlpha *= g ? 0.22 : 1; ctx.translate(wx, wy); ctx.rotate((ang - g * om / 60 / (ghosts + 1)) * Math.PI / 180); ctx.drawImage(WHEEL_DISC, -dia / 2, -dia / 2, dia, dia); ctx.restore(); }
  // 外圈燈泡：跑燈，越慢越亮；中獎後全部交替閃
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < WHEEL_GEO.nB; i++) {
    const a = (i / WHEEL_GEO.nB) * Math.PI * 2 + ang * Math.PI / 180 - Math.PI / 2, bx = wx + Math.cos(a) * dia * WHEEL_GEO.bulbR, by = wy + Math.sin(a) * dia * WHEEL_GEO.bulbR;
    const on = won ? ((Math.floor((t - STOP) * 10) + i) % 2 ? 1 : 0.3) : (Math.floor(t * 18) - i) % 4 === 0 ? 0.9 : 0;
    if (!on) continue; const g = ctx.createRadialGradient(bx, by, 0, bx, by, 22); g.addColorStop(0, `rgba(255,250,210,${on})`); g.addColorStop(1, 'rgba(255,190,80,0)'); ctx.fillStyle = g; ctx.fillRect(bx - 22, by - 22, 44, 44);
  }
  ctx.restore();
  // 中獎格閃白
  if (won) { const l = t - STOP, a = (Math.floor(l * 8) % 2 ? 0.55 : 0.2) * (1 - lin(l, 1.2, 1.8));
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,250,220,${a})`; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.arc(wx, wy, dia * 0.43, -Math.PI / 2 - Math.PI / 8, -Math.PI / 2 + Math.PI / 8); ctx.fill(); ctx.restore(); }
  // 指針：每過一格被撥一下
  const f = (((ang + 90 + WHEEL_GEO.winA) % 45) + 45) % 45 / 45, flap = om > 900 ? Math.sin(t * 90) * 0.15 : -0.45 * Math.max(0, 1 - f * 5);
  const pw = 92, ph = WHEEL_PTR.height * pw / WHEEL_PTR.width;
  ctx.save(); ctx.translate(wx, wy - dia / 2 - ph * 0.35); ctx.rotate(flap); ctx.drawImage(WHEEL_PTR, -pw / 2, -ph * 0.3, pw, ph); ctx.restore();
  // 軸心上的份數
  if (won) { const k = lin(t, STOP + 0.15, STOP + 0.4); if (k > 0) { const s = k < 1 ? 2 - eback(k, 1.6) : 1; ctx.save(); ctx.translate(wx, wy); ctx.scale(s, s); ctx.beginPath(); ctx.arc(0, 0, 112, 0, 7); ctx.fillStyle = '#c8102e'; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#ffd34a'; ctx.stroke(); smallTitle(ctx, t, '×' + CFG.n, 0, 4, 92, PAL.gold, 'center'); ctx.restore(); } }
  ctx.restore();
  // 撐住的那一刻：CHANCE 閃字
  if (t > WH_T.slow + 0.05 && t < WH_T.stop) { ctx.save(); ctx.globalAlpha = Math.floor(t * 8) % 2 ? 1 : 0.5; ctx.translate(960, 1010); smallTitle(ctx, t, 'CHANCE!', 0, 0, 80, PAL.gold, 'center'); ctx.restore(); }
  if (won) {
    const l = t - STOP;
    coinFountain(ctx, t, STOP, STOP + 1.4, 40);
    const gk = lin(l, 0.2, 0.55); if (gk > 0 && GIRL) { ctx.save(); ctx.globalAlpha = 1 - out; const gx = 1520 + (1 - eback(gk, 1.6)) * 700 + out * 700; neonOutline(ctx, GIRL_SIL, gx, 650, 860, t, 0.04); drawImg(ctx, GIRL, gx, 650, 860, 0.04); ctx.restore(); }
    const tk = lin(l, 0.35, 0.55); if (tk > 0) { const ss = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(900, 110); ctx.rotate(-0.03); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 120, pal, 'center'); ctx.restore(); }
    const nk = eo(lin(l, 0.55, 0.75)); if (nk > 0) { ctx.save(); ctx.globalAlpha = (1 - out) * nk; ctx.font = "900 48px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2a0008'; ctx.lineWidth = 12; ctx.strokeText(nameLine(), 900, 210); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), 900, 210); ctx.restore(); }
    flash(ctx, (1 - lin(t, STOP, STOP + 0.12)) * 0.5, '#fff3c0');
  }
}
VARS.g10[1] = { name: '幸運大轉盤', fn: vRoulette, dur: 5.3 };

// ---------------- 大量 4：號外 ----------------
let NEWS_PAPER = null;
const NEWS_GEO = { banner: [0.041, 0.04, 0.776, 0.151], stamp: [0.875, 0.1, 0.084], photo: [0.218, 0.187, 0.781, 0.556], band: 0.585 };   // 版面位置（報紙寬高比例）
const _lvaBase4 = window.loadVarAssets;
window.loadVarAssets = async function () { await _lvaBase4(); const im = await load(window.DEF_NEWS_PAPER || '../assets/news_paper.png'); NEWS_PAPER = im ? trimmed(im) : null; };
function drawPaper(ctx, PW, PH, t, l) {   // 以報紙中心為原點；l = 落地後經過秒數（<0 表示還沒落地，只畫空報紙）
  const G = NEWS_GEO, X = (u) => -PW / 2 + u * PW, Y = (v) => -PH / 2 + v * PH;
  ctx.drawImage(NEWS_PAPER, -PW / 2, -PH / 2, PW, PH);
  const [px0, py0, px1, py1] = G.photo, rx = X(px0), ry = Y(py0), rw = (px1 - px0) * PW, rh = (py1 - py0) * PH;
  ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip(); ctx.fillStyle = '#f6efe2'; ctx.fillRect(rx, ry, rw, rh);
  if (l >= 0.05 && GIRL) { const gh = rh * 2.3, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, rx + rw / 2 - FACE.x * gw, ry + rh * 0.4 - FACE.y * gh, gw, gh);
    if (l < 0.25) { ctx.fillStyle = `rgba(255,255,255,${1 - l / 0.25})`; ctx.fillRect(rx, ry, rw, rh); } }
  ctx.restore(); ctx.strokeStyle = '#2a2420'; ctx.lineWidth = Math.max(3, PW * 0.006); ctx.strokeRect(rx, ry, rw, rh);
  if (l < 0) return;
  // 標題橫帶：黑底白字砸進來
  const [bx0, by0, bx1, by1] = G.banner, hk = lin(l, 0.15, 0.3);
  if (hk > 0) { ctx.save(); ctx.fillStyle = '#1a1414'; ctx.fillRect(X(bx0), Y(by0), (bx1 - bx0) * PW, (by1 - by0) * PH);
    const fs = (by1 - by0) * PH * 0.7, s = hk < 1 ? 1.6 - 0.6 * eback(hk, 1.5) : 1; ctx.translate(X((bx0 + bx1) / 2), Y((by0 + by1) / 2)); ctx.scale(s, s);
    ctx.font = `${fs}px 'Dela Gothic One', 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    const tw = ctx.measureText(CFG.title).width, sc = Math.min(1, (bx1 - bx0) * PW * 0.92 / tw); ctx.scale(sc, sc); ctx.fillText(CFG.title, 0, fs * 0.05); ctx.restore(); }
  // 紅色印章「號外」
  const sk = lin(l, 0.35, 0.47);
  if (sk > 0) { const [sx, sy, sr] = G.stamp, s = sk < 1 ? 2.4 - 1.4 * sk : 1; ctx.save(); ctx.translate(X(sx), Y(sy)); ctx.rotate(-0.18); ctx.scale(s, s); ctx.globalAlpha = Math.min(1, sk * 2);
    ctx.fillStyle = '#d0142c'; ctx.beginPath(); ctx.arc(0, 0, sr * PW * 0.92, 0, 7); ctx.fill();
    ctx.font = `900 ${sr * PW * 0.62}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff6e8'; ctx.fillText(LX('ex1'), 0, -sr * PW * 0.33, sr * PW * 1.5); ctx.fillText(LX('ex2'), 0, sr * PW * 0.36, sr * PW * 1.5); ctx.restore(); }
  // 紅色副標帶：名字與份數
  const nk = eo(lin(l, 0.55, 0.8));
  if (nk > 0) { const by = Y(G.band), bh = PH * 0.06; ctx.save(); ctx.fillStyle = '#c8102e'; ctx.fillRect(X(0.03), by - bh / 2, PW * 0.94 * nk, bh);
    ctx.beginPath(); ctx.rect(X(0.03), by - bh / 2, PW * 0.94 * nk, bh); ctx.clip();
    ctx.font = `900 ${bh * 0.56}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), 0, by + 2); ctx.restore(); }
}
let _newsSmall = null;
function newsSmall() {   // 背景小報紙：照片框先塗滿，避免露出透明洞
  if (_newsSmall) return _newsSmall; const w = 300, h = Math.round(w * NEWS_PAPER.height / NEWS_PAPER.width), c = mk(w, h), x = c.getContext('2d'), [a, b, cc, d] = NEWS_GEO.photo;
  x.fillStyle = '#e9e0cf'; x.fillRect(a * w, b * h, (cc - a) * w, (d - b) * h); x.drawImage(NEWS_PAPER, 0, 0, w, h); _newsSmall = c; return c;
}
function vExtra(ctx, t) {
  if (!NEWS_PAPER) return;
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.25)), pal = PAL[CFG.pal], LAND = 1.25, MOVE = 2.7;
  ctx.save(); ctx.globalAlpha = app * (1 - out); palBG(ctx, t, PAL.red, 960, 540); ctx.fillStyle = 'rgba(20,4,8,0.35)'; ctx.fillRect(0, 0, W, H);
  if (t > LAND) halftone(ctx, 0, 0, W, H, 'rgba(255,220,200,0.12)', t);
  ctx.restore();
  // 背景飛過的小報紙
  if (t > LAND) for (let i = 0; i < 12; i++) { const st = LAND + R(i, 1) * 1.6, q = (t - st) / 1.6; if (q < 0 || q > 1) continue;
    const ph = 150 + R(i, 2) * 120, pw = ph * NEWS_PAPER.width / NEWS_PAPER.height, x = -200 + (W + 400) * q * (0.7 + R(i, 3) * 0.6), y = 120 + R(i, 4) * 840 - Math.sin(q * 3) * 80;
    ctx.save(); ctx.globalAlpha = (1 - out) * 0.9; ctx.translate(R(i, 5) > 0.5 ? x : W - x, y); ctx.rotate(q * (R(i, 6) - 0.5) * 9); ctx.drawImage(newsSmall(), -pw / 2, -ph / 2, pw, ph); ctx.restore(); }
  // 主報紙：旋轉飛進來→落地→往左推、微傾
  const PH = 980, PW = PH * NEWS_PAPER.width / NEWS_PAPER.height, k = eo(lin(t, 0.15, LAND)), mv = eo5(lin(t, MOVE, MOVE + 0.45));
  const sc = (0.04 + 0.96 * k) * (1 - 0.12 * mv), rot = (1 - k) * Math.PI * 7 - 0.07 * mv, x = 960 - 420 * mv - out * 1300, y = 540 + 10 * mv;
  const pk = t >= LAND ? Math.exp(-(t - LAND) * 10) : 0;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(x + (R(Math.floor(t * 60), 3) - 0.5) * pk * 24, y + (R(Math.floor(t * 60), 4) - 0.5) * pk * 24); ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; ctx.fillStyle = '#000'; ctx.fillRect(-PW / 2 + 6, -PH / 2 + 6, PW - 12, PH - 12); ctx.shadowColor = 'transparent';
  drawPaper(ctx, PW, PH, t, t >= LAND ? t - LAND : -1);
  ctx.restore();
  if (t >= LAND) flash(ctx, (1 - lin(t, LAND, LAND + 0.12)) * 0.5, '#fff');
  if (t >= LAND && t < LAND + 0.5) { ctx.save(); ctx.globalAlpha = 1 - (t - LAND) / 0.5; speedLines(ctx, 960, 540, 60, 560, 'rgba(255,255,255,0.8)', 7, 0, 1); ctx.restore(); }
  // 落地後：右側大字
  const l = t - MOVE;
  if (l > 0) {
    const gk = lin(l, 0.2, 0.5); if (gk > 0 && GIRL) { ctx.save(); ctx.globalAlpha = 1 - out; const gx = 1450 + (1 - eback(gk, 1.6)) * 600 + out * 700; neonOutline(ctx, GIRL_SIL, gx, 640, 860, t, -0.04); drawImg(ctx, GIRL, gx, 640, 860, -0.04); ctx.restore(); }
    const tk = lin(l, 0.4, 0.6); if (tk > 0) { const ss = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(1450, 110); ctx.rotate(-0.05); ctx.scale(ss, ss); smallTitle(ctx, t, '號外! 號外!', 0, 0, 84, PAL.gold, 'center'); ctx.restore(); }
  }
}
VARS.g10[4] = { name: '號外', fn: vExtra, dur: 5.2 };

// ---------------- 大量 3：VS 對決 ----------------
function bolt(ctx, x0, y0, x1, y1, seed, w, col) {   // 鋸齒閃電
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'miter'; ctx.shadowColor = col; ctx.shadowBlur = 20; ctx.beginPath(); ctx.moveTo(x0, y0);
  for (let i = 1; i < 8; i++) { const u = i / 8; ctx.lineTo(x0 + (x1 - x0) * u + (R(seed, i) - 0.5) * 70, y0 + (y1 - y0) * u + (R(seed, i + 9) - 0.5) * 70); }
  ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
}
function vVersus(ctx, t) {
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), pal = PAL[CFG.pal];
  const IN = 0.15, VS = 0.6, CLASH = 0.95, PUSH = 2.35, WIN = 2.6;
  const ink = eo5(lin(t, IN, IN + 0.35));
  // 分界線位置：對峙時左右推擠，最後藍方一口氣推過去
  let cx = 960 + Math.sin(Math.max(0, t - CLASH) * 9) * 40 * lin(t, CLASH, PUSH) + Math.sin(Math.max(0, t - CLASH) * 23) * 12 * lin(t, CLASH, PUSH);
  if (t > PUSH) cx += (W + 700 - cx) * ei(lin(t, PUSH, WIN));
  const won = t >= WIN, edge = (y) => cx + (y - 540) * 0.32;
  ctx.save(); ctx.globalAlpha = 1 - out;
  if (!won) {
    // 右（紅）
    ctx.save(); ctx.globalAlpha *= ink; const gr = ctx.createLinearGradient(W, 0, 960, H); gr.addColorStop(0, '#ff3a4a'); gr.addColorStop(1, '#4a0010'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    speedLines(ctx, 1500, 540, 40, 380, 'rgba(255,220,220,0.25)', Math.floor(t * 20), 0, 1); ctx.restore();
    if (GIRL) { const gx = 1440 + (1 - ink) * 900 + Math.max(0, cx - 960) * 0.4; ctx.save(); ctx.globalAlpha *= ink; neonOutline(ctx, GIRL_SIL, gx, 600, 900, t, -0.06); drawImg(ctx, GIRL, gx, 600, 900, -0.06); ctx.restore(); }
    // 左（藍）：用分界線裁切
    ctx.save(); ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(edge(-10), -10); ctx.lineTo(edge(H + 10), H + 10); ctx.lineTo(-10, H + 10); ctx.closePath(); ctx.clip();
    ctx.globalAlpha *= ink; const gl = ctx.createLinearGradient(0, 0, 960, H); gl.addColorStop(0, '#3a8aff'); gl.addColorStop(1, '#0a1450'); ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
    speedLines(ctx, 420, 540, 40, 380, 'rgba(210,230,255,0.25)', Math.floor(t * 20) + 50, 0, 1);
    const mx = 470 - (1 - ink) * 900 + Math.min(0, cx - 960) * 0.4 + (t > PUSH ? (cx - 960) * 0.5 : 0);
    if (MASCOT) drawImg(ctx, MASCOT, mx, 600, 640, 0.08);
    ctx.restore();
    // 分界線：白色粗線＋火花
    ctx.save(); ctx.globalAlpha *= ink; ctx.strokeStyle = '#fff'; ctx.lineWidth = 14; ctx.shadowColor = '#fff'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.moveTo(edge(-20), -20); ctx.lineTo(edge(H + 20), H + 20); ctx.stroke(); ctx.restore();
    if (t > CLASH) for (let i = 0; i < 4; i++) { const y = 120 + ((t * 700 + i * 260) % 840); sparkBurst(ctx, edge(y), y, (t * 3 + i * 0.25) % 0.6, 8, 1.2, i % 2 ? '#bfe0ff' : '#ffd0c8'); }
    // 名牌
    const pk = eo5(lin(t, IN + 0.2, IN + 0.5));
    if (pk > 0) { ctx.save(); ctx.translate(-600 * (1 - pk), 0); ctx.fillStyle = 'rgba(5,10,40,0.85)'; ctx.beginPath(); ctx.moveTo(60, 860); ctx.lineTo(720, 860); ctx.lineTo(680, 960); ctx.lineTo(20, 960); ctx.fill();
      hudText(ctx, 'GIFTER', 90, 840, 26, '#8fc4ff'); ctx.font = "900 54px 'Noto Sans TC'"; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(P.name, 80, 912); ctx.restore(); }
    // 集氣條：份數一路數上去
    if (t > CLASH) { const g = lin(t, CLASH, PUSH), n = Math.max(1, Math.round(CFG.n * eo(g)));
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(80, 70, 700, 40); const bar = ctx.createLinearGradient(80, 0, 780, 0); bar.addColorStop(0, '#5fd0ff'); bar.addColorStop(1, '#ffffff'); ctx.fillStyle = bar; ctx.fillRect(84, 74, 692 * eo(g), 32);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(80, 70, 700, 40); ctx.restore();
      hudText(ctx, 'GIFT POWER', 84, 140, 26, '#bfe0ff'); smallTitle(ctx, t, '×' + n, 820, 92, 70, PAL.sky, 'left'); }
    // VS 大字
    const vk = lin(t, VS, VS + 0.18);
    if (vk > 0) { const s = vk < 1 ? 3.2 - 2.2 * eo(vk) : 1 + Math.sin(t * 30) * 0.02 * lin(t, CLASH, PUSH); ctx.save(); ctx.translate(edge(470), 470); ctx.rotate(-0.12); ctx.scale(s, s);
      smallTitle(ctx, t, 'VS', 0, 0, 260, PAL.gold, 'center'); ctx.restore();
      if (t < VS + 0.5) for (let i = 0; i < 4; i++) bolt(ctx, edge(470), 470, edge(470) + Math.cos(i * 1.7 + 0.4) * 520, 470 + Math.sin(i * 1.7 + 0.4) * 380, i + Math.floor(t * 30), 6, '#fff6c0');
      if (t >= VS) flash(ctx, (1 - lin(t, VS, VS + 0.12)) * 0.45, '#fff'); }
  } else {
    // 勝負揭曉：金色背景，大勝利
    const l = t - WIN;
    palBG(ctx, t, PAL.gold, 960, 520); ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960, 520, 14, 'rgba(255,240,180,0.2)', t * 0.4, 1800, 0.45, 16); ctx.restore();
    confetti(ctx, t, WIN, 70, ['#ffd24a', '#ff5a6a', '#5fb8ff', '#ffffff'], 21);
    const gk = lin(l, 0.1, 0.4); if (GIRL && gk > 0) { const s = eback(gk, 1.6); ctx.save(); ctx.translate(820, 620); ctx.scale(s, s); neonOutline(ctx, GIRL_SIL, 0, 0, 900, t, 0.03); drawImg(ctx, GIRL, 0, 0, 900, 0.03); ctx.restore(); }
    const mk2 = lin(l, 0.25, 0.5); if (MASCOT && mk2 > 0) drawImg(ctx, MASCOT, 300, 760 + (1 - eback(mk2, 1.6)) * 500, 440, -0.1);
    const wk = lin(l, 0.05, 0.22); if (wk > 0) { const s = wk < 1 ? 2.6 - 1.6 * eo(wk) : 1; ctx.save(); ctx.translate(1430, 300); ctx.rotate(-0.08); ctx.scale(s, s); smallTitle(ctx, t, '大勝利!', 0, 0, 150, PAL.red, 'center'); ctx.restore(); }
    const tk = lin(l, 0.45, 0.65); if (tk > 0) { const ss = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.translate(1430, 560); ctx.rotate(-0.05); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 110, pal, 'center'); ctx.restore(); }
    const nk = eo(lin(l, 0.65, 0.85)); if (nk > 0) { ctx.save(); ctx.globalAlpha *= nk; ctx.font = "900 48px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#3a1400'; ctx.lineWidth = 12; ctx.strokeText(nameLine(), 1430, 670); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), 1430, 670); ctx.restore(); }
    flash(ctx, (1 - lin(t, WIN, WIN + 0.15)) * 0.7, '#fff');
  }
  ctx.restore();
}
VARS.g10[3] = { name: 'VS 對決', fn: vVersus, dur: 5.2 };
