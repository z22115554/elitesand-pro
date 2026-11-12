
// ======================= 高階演出（×25 金扉／×50 拉霸／×100 神降臨） =======================
function shakeAt(ctx, t, amt) { const f = Math.floor(t * 60); ctx.translate((R(f, 11) - 0.5) * amt, (R(f, 12) - 0.5) * amt); }
function decay(t, list, k = 12) { let s = 0; for (const [ti, a] of list) if (t >= ti) s += a * Math.exp(-(t - ti) * k); return s; }
function godRays(ctx, cx, cy, n, col, rot, len = 2600, wfrac = 0.5, blur = 18) {
  ctx.save(); ctx.fillStyle = col; if (blur) ctx.filter = `blur(${blur}px)`; ctx.beginPath();
  for (let i = 0; i < n; i++) { const a0 = rot + i / n * Math.PI * 2, a1 = a0 + Math.PI * 2 / n * wfrac;
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * len, cy + Math.sin(a0) * len); ctx.lineTo(cx + Math.cos(a1) * len, cy + Math.sin(a1) * len); }
  ctx.fill(); ctx.restore();
}
function confetti(ctx, t, t0, n, cols, seed = 1) {
  const lt = t - t0; if (lt < 0) return;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const st = R(i, seed) * 2.2, l = lt - st; if (l < 0) continue;
    const x = R(i, seed + 1) * (W + 200) - 100 + Math.sin(l * (1.5 + R(i, seed + 2) * 2) + i) * 60;
    const y = -40 + l * (260 + R(i, seed + 3) * 260); if (y > H + 40) continue;
    const fl = Math.cos(l * (6 + R(i, seed + 4) * 8) + i);
    ctx.save(); ctx.translate(x, y); ctx.rotate(l * (2 + R(i, seed + 5) * 3) + i); ctx.scale(1, fl);
    ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(-9, -5, 18, 10); ctx.restore();
  }
  ctx.restore();
}
function coinFountain(ctx, t, t0, t1, n) {
  const lt = t - t0; if (lt < 0) return;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const st = R(i, 31) * (t1 - t0), l = lt - st; if (l < 0 || l > 1.8) continue;
    const vx = (R(i, 32) - 0.5) * 1400, vy = -1500 - R(i, 33) * 900;
    const x = CX + (R(i, 34) - 0.5) * 200 + vx * l, y = H + 40 + vy * l + 1500 * l * l; if (y > H + 60) continue;
    const s = 16 + R(i, 35) * 12, sp = Math.cos(l * 18 + i);
    const gg = ctx.createLinearGradient(x - s, y - s, x + s, y + s); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffbf1a'); gg.addColorStop(1, '#a86400');
    ctx.fillStyle = gg; ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, s * Math.abs(sp) + 2, s, 0, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function title3D(ctx, t, x, y, s, rot, depth, col) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = "200px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let i = depth; i >= 1; i--) { ctx.strokeStyle = col[i % 2]; ctx.lineWidth = 56; ctx.strokeText(CFG.title, i * 1.4, i * 2.2); }
  ctx.restore();
  titleText(ctx, t, x, y, s, rot);
}
function ledFrameHue(ctx, t, hueFn) {
  const per = 2 * (W + H), n = 96, sp = 46;
  ctx.save(); ctx.fillStyle = 'rgba(20,6,0,0.85)';
  ctx.fillRect(0, 0, W, sp); ctx.fillRect(0, H - sp, W, sp); ctx.fillRect(0, 0, sp, H); ctx.fillRect(W - sp, 0, sp, H);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per; let x, y;
    if (d < W) { x = d; y = sp / 2; } else if ((d -= W) < H) { x = W - sp / 2; y = d; } else if ((d -= H) < W) { x = W - d; y = H - sp / 2; } else { d -= W; x = sp / 2; y = H - d; }
    const on = ((i - t * 40) % 8 + 8) % 8 < 3 ? 1 : 0.25, hue = hueFn(i);
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 26); gr.addColorStop(0, `hsla(${hue},100%,${on > 0.5 ? 88 : 60}%,${on})`); gr.addColorStop(1, `hsla(${hue},100%,50%,0)`);
    ctx.fillStyle = gr; ctx.fillRect(x - 26, y - 26, 52, 52);
  }
  ctx.restore();
}
function girlAt(ctx, gx, gy, gh, t, outline = true, alpha = 1) {
  if (!GIRL) return; if (outline) neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, 0.03); drawImg(ctx, GIRL, gx, gy, gh, 0.03, alpha);
}
function mascotAt(ctx, t, k, x = 245, y = 850, h = 470) {
  if (!MASCOT || k <= 0) return; const s = eback(k, 2.6); const bob = Math.abs(Math.sin(t * 15.7)) * -26, mr = -0.1 + Math.sin(t * 15.7) * 0.08;
  neonOutline(ctx, MASCOT_SIL, x, y + bob, h * s, t + 0.3, mr); drawImg(ctx, MASCOT, x, y + bob, h * s, mr);
}
function exitSmear(ctx, k, f, render) {   // 錄影帶式拉絲退場，k:0→1
  bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.globalCompositeOperation = 'source-over'; bctx.clearRect(0, 0, W, H); render(bctx);
  ctx.clearRect(0, 0, W, H);
  let y = 0, i = 0; ctx.globalAlpha = 1 - ei(lin(k, 0.5, 1));
  while (y < H) { const hh = 6 + R(f + i, 1) * 50; const smear = ei(k) * (300 + R(f + i, 2) * 1500) * (R(f + i, 3) < 0.6 ? 1 : 0.2);
    ctx.drawImage(buf, 0, y, W, hh, (R(f + i, 4) - 0.5) * 400 * k - smear * 0.5, y, W + smear, hh); y += hh; i++; }
  ctx.globalAlpha = 1;
  if (k > 0.1) { const tmp = mk(); tmp.getContext('2d').drawImage(cv, 0, 0); ctx.clearRect(0, 0, W, H); rgbSplit(ctx, tmp, 10 + k * 40); }
}

// ---------------- ×25 金扉 ----------------
let DOOR_TEX = null;
function makeDoor(side) {   // side -1 左門（內緣在右），1 右門（內緣在左）
  const DW = CX, c = mk(DW, H), x = c.getContext('2d'), ex = side < 0 ? DW : 0;
  let gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#6a4200'); gr.addColorStop(0.18, '#e0aa28'); gr.addColorStop(0.5, '#fff0a0'); gr.addColorStop(0.82, '#c88e12'); gr.addColorStop(1, '#5a3800');
  x.fillStyle = gr; x.fillRect(0, 0, DW, H);
  gr = x.createLinearGradient(0, 0, DW, 0); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
  x.fillStyle = gr; x.fillRect(0, 0, DW, H);
  const bevel = (rx, ry, rw, rh, d = 10) => { x.lineWidth = d; x.strokeStyle = 'rgba(60,30,0,0.65)'; x.beginPath(); x.moveTo(rx, ry + rh); x.lineTo(rx, ry); x.lineTo(rx + rw, ry); x.stroke();
    x.strokeStyle = 'rgba(255,250,210,0.8)'; x.beginPath(); x.moveTo(rx + rw, ry); x.lineTo(rx + rw, ry + rh); x.lineTo(rx, ry + rh); x.stroke(); };
  bevel(26, 26, DW - 52, H - 52, 12);
  for (const [py, ph] of [[110, 330], [640, 330]]) { bevel(90, py, DW - 180, ph, 10);
    x.save(); x.beginPath(); x.rect(100, py + 10, DW - 200, ph - 20); x.clip(); x.strokeStyle = 'rgba(120,70,0,0.35)'; x.lineWidth = 3;
    for (let k = -10; k < 20; k++) { x.beginPath(); x.moveTo(100 + k * 70, py); x.lineTo(100 + k * 70 + ph, py + ph); x.moveTo(100 + k * 70 + ph, py); x.lineTo(100 + k * 70, py + ph); x.stroke(); } x.restore(); }
  for (let i = 0; i < 15; i++) for (const sx of [56, DW - 56]) { const sy = 70 + i * 67; const sg = x.createRadialGradient(sx - 4, sy - 4, 1, sx, sy, 14); sg.addColorStop(0, '#fffbe0'); sg.addColorStop(1, '#8a5a00'); x.fillStyle = sg; x.beginPath(); x.arc(sx, sy, 12, 0, 7); x.fill(); }
  // 內緣紋章（兩扇門合起來是一個完整的圓）
  const eg = x.createRadialGradient(ex, CY - 40, 20, ex, CY, 230); eg.addColorStop(0, '#ff5a5a'); eg.addColorStop(0.7, '#a0001e'); eg.addColorStop(1, '#4a0010');
  x.fillStyle = eg; x.beginPath(); x.arc(ex, CY, 220, 0, 7); x.fill();
  x.lineWidth = 22; x.strokeStyle = '#ffe27a'; x.stroke(); x.lineWidth = 6; x.strokeStyle = '#7a4a00'; x.beginPath(); x.arc(ex, CY, 186, 0, 7); x.stroke();
  x.font = "220px 'Dela Gothic One'"; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  x.strokeStyle = '#3a1a00'; x.lineWidth = 26; x.strokeText(String(CFG.n), ex, CY + 8);
  const tg = x.createLinearGradient(0, CY - 90, 0, CY + 90); tg.addColorStop(0, '#fffbe0'); tg.addColorStop(0.5, '#ffc21a'); tg.addColorStop(1, '#c76a00');
  x.fillStyle = tg; x.fillText(String(CFG.n), ex, CY + 8);
  gr = x.createLinearGradient(side < 0 ? DW - 30 : 0, 0, side < 0 ? DW : 30, 0); gr.addColorStop(0, side < 0 ? 'rgba(0,0,0,0)' : 'rgba(40,20,0,0.7)'); gr.addColorStop(1, side < 0 ? 'rgba(40,20,0,0.7)' : 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(side < 0 ? DW - 30 : 0, 0, 30, H);
  return c;
}
function drawDoor(ctx, tex, side, th, slide = 0, alpha = 1) {
  const n = 64, DW = tex.width, f = 1700;
  ctx.save(); ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n, um = (u0 + u1) / 2;
    const proj = (u) => { const xw = -CX + u * CX * Math.cos(th), z = u * CX * Math.sin(th); const s = f / (f - z); return [CX + (side < 0 ? xw : -xw) * s, s]; };
    const [X0] = proj(u0), [X1] = proj(u1), [, s] = proj(um);
    const sx = side < 0 ? u0 * DW : DW - u1 * DW;
    const x0 = Math.min(X0, X1) + slide, wd = Math.abs(X1 - X0) + 1.2;
    ctx.drawImage(tex, sx, 0, DW / n + 0.5, H, x0, CY - H * s / 2, wd, H * s);
    const sh = Math.sin(th) * um * 0.55; if (sh > 0.01) { ctx.fillStyle = `rgba(0,0,0,${sh})`; ctx.fillRect(x0, CY - H * s / 2, wd, H * s); }
  }
  ctx.restore();
}
function gateMain(ctx, m, t) {   // 金色聚光主畫面，m＝開門後經過秒數
  const pal = PAL.gold, hits = [[0, 1], [0.35, 0.9], [0.62, 0.5]]; for (let b = 1.0; b < 3.4; b += 0.4) hits.push([b, 0.3]);
  const pk = decay(m, hits, 13);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.05, 1 + pk * 0.05); ctx.translate(-CX, -CY); shakeAt(ctx, t, 4 + pk * 26);
  const bg = ctx.createRadialGradient(1400, 300, 0, 1400, 300, 1700);
  bg.addColorStop(0, '#fffbe6'); bg.addColorStop(0.15, '#ffe27a'); bg.addColorStop(0.45, '#d08a00'); bg.addColorStop(0.8, '#5a2a00'); bg.addColorStop(1, '#1a0a00');
  ctx.fillStyle = bg; ctx.fillRect(-60, -60, W + 120, H + 120);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  godRays(ctx, 1400, -200, 26, 'rgba(255,240,170,0.12)', 1.2 + Math.sin(m * 0.8) * 0.15, 2600, 0.4);
  godRays(ctx, 730, 420, 40, 'rgba(255,255,220,0.10)', m * 0.6, 2600, 0.5);
  // 聚光燈柱
  const sp = ctx.createLinearGradient(1500, 0, 1500, H); sp.addColorStop(0, 'rgba(255,250,210,0.75)'); sp.addColorStop(1, 'rgba(255,220,120,0.1)');
  ctx.fillStyle = sp; ctx.beginPath(); ctx.moveTo(1380, -60); ctx.lineTo(1620, -60); ctx.lineTo(1900, H + 60); ctx.lineTo(1100, H + 60); ctx.fill();
  ctx.restore();
  const gk = lin(m, 0.12, 0.5); if (gk > 0) girlAt(ctx, 1500, 820 + (1 - eo5(gk)) * 700, 1700 + pk * 30, t);
  coins(ctx, m - 0.35 + T_HIT);
  const tk = lin(m, 0.35, 0.52);
  if (tk > 0) { const s = tk < 1 ? 2.8 - 1.8 * eback(tk, 1.4) : 1 + pk * 0.06;
    if (m > 0.6) { const bp = ((m - 0.35) % 0.2) / 0.2; ctx.save(); ctx.globalAlpha = (1 - bp) * 0.4; titleText(ctx, t, 730, 420, 1.3 * (1 + bp * 0.3), -0.08); ctx.restore(); }
    title3D(ctx, t, 730, 420, s * 1.3, -0.08, 16, ['#5a3000', '#7a4200']); }
  subLine(ctx, t, eo(lin(m, 0.7, 0.9)));
  mascotAt(ctx, t, lin(m, 0.62, 0.92));
  ctx.restore();
  confetti(ctx, m, 0.05, 160, ['#ffe27a', '#fff6c0', '#ffb21a', '#ffffff', '#ff5a5a'], 3);
  if (m > 0.6) { const e = 1 - eo5(lin(m, 0.6, 0.8)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  ledFrameHue(ctx, t, (i) => 38 + ((i * 7 + t * 80) % 20));
  if (m >= 0.35) flash(ctx, (1 - lin(m, 0.35, 0.45)) * 0.35, '#fff3b0');
}
function sceneGate(ctx, t) {
  if (!DOOR_TEX || DOOR_TEX.n !== CFG.n) DOOR_TEX = { L: makeDoor(-1), R: makeDoor(1), n: CFG.n };
  const D = CFG.dur, OPEN = 1.55, CLOSE = D - 0.75;
  const dim = eo(lin(t, 0, 0.3)) * (1 - lin(t, D - 0.3, D));
  // 門後：開門後才有主畫面
  if (t >= OPEN && t < CLOSE + 0.3) gateMain(ctx, t - OPEN, t);
  else if (t >= CLOSE + 0.3) { ctx.fillStyle = `rgba(0,0,0,${0.85 * dim})`; ctx.fillRect(0, 0, W, H); }
  else { ctx.fillStyle = `rgba(0,0,0,${0.85 * dim})`; ctx.fillRect(0, 0, W, H); }
  // 門
  let th = 0, slide = 0;
  if (t < 0.6) slide = (1 - ei(lin(t, 0.25, 0.6))) * CX * 1.05;
  else if (t < OPEN) th = 0;
  if (t >= OPEN) th = eo5(lin(t, OPEN, OPEN + 0.42)) * 1.42;
  if (t >= CLOSE) th = 1.42 * (1 - ei(lin(t, CLOSE, CLOSE + 0.3)));
  const doorA = t >= CLOSE + 0.3 ? 1 - lin(t, CLOSE + 0.35, D - 0.02) : 1;
  const beats = [[0.6, 1], [0.9, 0.5], [1.15, 0.7], [1.35, 0.9], [CLOSE + 0.3, 1]];
  const pk = decay(t, beats, 10);
  ctx.save(); shakeAt(ctx, t, pk * 30);
  if (t > 0.2 && th < 1.41) {
    // 門縫光（關著時）
    if (t >= 0.6 && t < OPEN + 0.1) { const pulse = 0.4 + decay(t, beats.slice(1, 4), 6) * 1.2 + lin(t, 1.35, OPEN) * 2;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(CX - 140 * pulse, 0, CX + 140 * pulse, 0);
      gr.addColorStop(0, 'rgba(255,220,120,0)'); gr.addColorStop(0.5, `rgba(255,250,220,${Math.min(1, 0.6 * pulse)})`); gr.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = gr; ctx.fillRect(CX - 300, 0, 600, H); ctx.restore(); }
    drawDoor(ctx, DOOR_TEX.L, -1, th, -slide, doorA);
    drawDoor(ctx, DOOR_TEX.R, 1, th, slide, doorA);
    if (t >= 0.6 && t < OPEN + 0.05) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const p = decay(t, beats.slice(1, 4), 5) + lin(t, 1.35, OPEN);
      ctx.fillStyle = `rgba(255,250,220,${Math.min(1, 0.5 + p)})`; ctx.fillRect(CX - 2 - p * 3, 0, 4 + p * 6, H); ctx.restore(); }
  }
  ctx.restore();
  // 關門火花
  for (const ts of [0.6, CLOSE + 0.3]) { const l = t - ts; if (l < 0 || l > 0.6) continue;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) { const y = R(i, ts) * H, a = (R(i, 2) < 0.5 ? Math.PI : 0) + (R(i, 3) - 0.5) * 1.2, v = 400 + R(i, 4) * 900;
      const x = CX + Math.cos(a) * v * l, yy = y + Math.sin(a) * v * l + 900 * l * l;
      ctx.strokeStyle = `rgba(255,${200 + R(i, 5) * 55 | 0},120,${1 - l / 0.6})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - Math.cos(a) * 30, yy - Math.sin(a) * 30); ctx.stroke(); }
    ctx.restore(); }
  // 開門的金光
  const ok = lin(t, OPEN - 0.05, OPEN + 0.5);
  if (ok > 0 && ok < 1) { ctx.save(); ctx.globalCompositeOperation = 'lighter';
    godRays(ctx, CX, CY, 30, `rgba(255,240,180,${0.5 * (1 - ok)})`, t * 0.5, 2600, 0.5);
    const gr = ctx.createRadialGradient(CX, CY, 0, CX, CY, 400 + ok * 1400); gr.addColorStop(0, `rgba(255,255,240,${1 - ok})`); gr.addColorStop(1, 'rgba(255,230,150,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  if (t >= OPEN) flash(ctx, (1 - lin(t, OPEN, OPEN + 0.14)) * 0.6, '#fff6d0');
  if (t >= D - 0.35) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${lin(t, D - 0.35, D - 0.02)})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

// ---------------- ×50 拉霸 777 ----------------
const STRIPS = [['star', 'girl', 'bar', 'mascot', 'girl', 'star', '7', 'bar'], ['mascot', 'bar', 'girl', 'star', 'girl', '7', 'star', 'bar'], ['girl', 'star', '7', 'mascot', 'bar', 'girl', 'star', 'bar']];
const CELL = 250, RX = [CX - 340, CX, CX + 340], RY = 590;
function reelPos(r, t) {
  const v = 14, t0 = 0.5, sp = (tt) => tt < t0 ? 0 : (tt - t0 < 0.25 ? v * Math.pow(tt - t0, 2) / 0.5 : v * (tt - t0 - 0.125));
  if (r === 0) { if (t < 1.4) return sp(t); const a = sp(1.4), b = 14; return a + (b - a) * eo(lin(t, 1.4, 1.6)) - 0.12 * Math.sin(lin(t, 1.6, 1.85) * Math.PI); }
  if (r === 1) { if (t < 1.9) return sp(t); const a = sp(1.9), b = 21; return a + (b - a) * eo(lin(t, 1.9, 2.1)) - 0.12 * Math.sin(lin(t, 2.1, 2.35) * Math.PI); }
  if (t < 1.9) return sp(t);
  const a = sp(1.9), b = 26.45;
  if (t < 3.4) return a + (b - a) * (1 - Math.pow(1 - lin(t, 1.9, 3.4), 1.4));
  if (t < 3.62) return b + Math.sin(t * 60) * 0.004;
  return b - 0.45 * eback(lin(t, 3.62, 3.8), 2.2);
}
function reelSpeed(r, t) { return Math.abs(reelPos(r, t + 0.01) - reelPos(r, t - 0.01)) / 0.02; }
function drawSymbol(ctx, sym, x, y, t) {
  ctx.save(); ctx.translate(x, y);
  if (sym === '7') {
    ctx.font = "230px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2a0008'; ctx.lineWidth = 30; ctx.strokeText('7', 0, 8);
    const gg = ctx.createLinearGradient(0, -90, 0, 90); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(1, '#c76a00'); ctx.strokeStyle = gg; ctx.lineWidth = 16; ctx.strokeText('7', 0, 8);
    const rg = ctx.createLinearGradient(0, -90, 0, 90); rg.addColorStop(0, '#ff8a8a'); rg.addColorStop(0.5, '#ff1a2a'); rg.addColorStop(1, '#8a0010'); ctx.fillStyle = rg; ctx.fillText('7', 0, 8);
  } else if (sym === 'bar') {
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#ffc21a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.roundRect(-110, -48, 220, 96, 14); ctx.fill(); ctx.stroke();
    ctx.font = "66px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('BAR', 0, 4);
  } else if (sym === 'star') {
    ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 42 : 100, a = i / 10 * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath();
    const sg = ctx.createRadialGradient(0, -20, 5, 0, 0, 100); sg.addColorStop(0, '#fffbe0'); sg.addColorStop(1, '#ffb000'); ctx.fillStyle = sg; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#8a5000'; ctx.stroke();
  } else if (sym === 'girl' && GIRL) {
    const r = 100; ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); const bg = ctx.createRadialGradient(0, -30, 0, 0, 0, r); bg.addColorStop(0, '#c8f0ff'); bg.addColorStop(1, '#3a7ae0'); ctx.fillStyle = bg; ctx.fill(); ctx.clip();
    const fx = FACE.x * GIRL.width, fy = FACE.y * GIRL.height, sz = FACE.s * GIRL.height * 1.9; ctx.drawImage(GIRL, fx - sz / 2, fy - sz * 0.42, sz, sz, -r, -r, r * 2, r * 2); ctx.restore();
    ctx.lineWidth = 8; ctx.strokeStyle = '#ff5aa5'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  } else if (sym === 'mascot' && MASCOT) { drawImg(ctx, MASCOT, 0, 0, 210); }
  else if (sym === 'mascot' || sym === 'girl') { ctx.fillStyle = '#ff5aa5'; ctx.beginPath(); ctx.arc(0, 0, 80, 0, 7); ctx.fill(); }
  ctx.restore();
}
function drawReel(ctx, r, t, glow) {
  const x = RX[r], p = reelPos(r, t), v = reelSpeed(r, t), strip = STRIPS[r], wW = 290, wH = 400;
  ctx.save(); ctx.beginPath(); ctx.roundRect(x - wW / 2, RY - wH / 2, wW, wH, 18); ctx.clip();
  const bg = ctx.createLinearGradient(0, RY - wH / 2, 0, RY + wH / 2); bg.addColorStop(0, '#cfd3dc'); bg.addColorStop(0.5, '#ffffff'); bg.addColorStop(1, '#cfd3dc');
  ctx.fillStyle = bg; ctx.fillRect(x - wW / 2, RY - wH / 2, wW, wH);
  if (glow > 0) { ctx.fillStyle = `hsla(${(t * 400 + r * 120) % 360},100%,70%,${glow * 0.5})`; ctx.fillRect(x - wW / 2, RY - wH / 2, wW, wH); }
  const k0 = Math.floor(p) - 2;
  for (let k = k0; k <= k0 + 4; k++) { const y = RY + (k - p) * CELL; const sym = strip[((k % 8) + 8) % 8];
    if (v > 5) { ctx.globalAlpha = 0.3; for (let j = -2; j <= 2; j++) drawSymbol(ctx, sym, x, y + j * Math.min(60, v * 2.5), t); ctx.globalAlpha = 1; }
    else drawSymbol(ctx, sym, x, y, t); }
  const sh = ctx.createLinearGradient(0, RY - wH / 2, 0, RY + wH / 2); sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(0.25, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = sh; ctx.fillRect(x - wW / 2, RY - wH / 2, wW, wH);
  ctx.restore();
  ctx.save(); ctx.lineWidth = 10; ctx.strokeStyle = glow > 0 ? `hsl(${(t * 600 + r * 120) % 360},100%,65%)` : '#3a3f4a'; if (glow > 0) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 30; }
  ctx.beginPath(); ctx.roundRect(x - wW / 2, RY - wH / 2, wW, wH, 18); ctx.stroke(); ctx.restore();
}
function drawMachine(ctx, t, reach, glow) {
  const mw = 1200, mh = 640, mx = CX - mw / 2, my = RY - mh / 2 + 10;
  // 霓虹外框
  ctx.save(); const hue = (t * 300) % 360; ctx.shadowColor = reach ? '#ff2a3a' : `hsl(${hue},100%,60%)`; ctx.shadowBlur = 40;
  ctx.strokeStyle = reach ? '#ff6a6a' : `hsl(${hue},100%,70%)`; ctx.lineWidth = 12; ctx.beginPath(); ctx.roundRect(mx - 22, my - 22, mw + 44, mh + 44, 46); ctx.stroke(); ctx.restore();
  const cg = ctx.createLinearGradient(0, my, 0, my + mh); cg.addColorStop(0, '#5a6070'); cg.addColorStop(0.08, '#e8ecf4'); cg.addColorStop(0.15, '#8a90a0'); cg.addColorStop(0.9, '#2a2e38'); cg.addColorStop(1, '#6a7080');
  ctx.fillStyle = cg; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, 36); ctx.fill();
  ctx.fillStyle = '#0c0d12'; ctx.beginPath(); ctx.roundRect(mx + 30, my + 90, mw - 60, mh - 130, 24); ctx.fill();
  // 上方招牌
  ctx.save(); ctx.font = "64px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffcf3a'; ctx.shadowBlur = 20; ctx.fillStyle = '#fff2a0'; ctx.fillText('★ JACKPOT ★', CX, my + 46); ctx.restore();
  // 燈泡
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) { for (const yy of [my + 92, my + mh - 30]) { const x = mx + 60 + i * (mw - 120) / 25; const on = ((i + Math.floor(t * 16)) % 3 === 0);
    const gr = ctx.createRadialGradient(x, yy, 0, x, yy, 16); gr.addColorStop(0, reach ? `rgba(255,${on ? 200 : 60},60,${on ? 1 : 0.4})` : `hsla(${(i * 20 + t * 300) % 360},100%,${on ? 85 : 55}%,${on ? 1 : 0.4})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - 16, yy - 16, 32, 32); } }
  ctx.restore();
  for (let r = 0; r < 3; r++) drawReel(ctx, r, t, glow);
  // 中獎線
  ctx.save(); ctx.strokeStyle = glow > 0 ? `hsl(${(t * 800) % 360},100%,65%)` : 'rgba(255,40,60,0.85)'; ctx.lineWidth = glow > 0 ? 10 : 5; if (glow > 0) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 30; }
  ctx.beginPath(); ctx.moveTo(mx + 40, RY); ctx.lineTo(mx + mw - 40, RY); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; for (const [ax, d] of [[mx + 40, 1], [mx + mw - 40, -1]]) { ctx.beginPath(); ctx.moveTo(ax, RY - 22); ctx.lineTo(ax + d * 30, RY); ctx.lineTo(ax, RY + 22); ctx.fill(); }
  ctx.restore();
}
function bigWord(ctx, txt, x, y, s, rot, fill, stroke = '#1a0838') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s); ctx.font = "150px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke; ctx.lineWidth = 40; ctx.strokeText(txt, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 12; ctx.strokeText(txt, 0, 0); ctx.fillStyle = fill; ctx.fillText(txt, 0, 0); ctx.restore();
}
function slotMain(ctx, m, t) {
  const hits = [[0, 1], [0.3, 0.8], [0.55, 0.5]]; for (let b = 0.8; b < 3.2; b += 0.4) hits.push([b, 0.35]);
  const pk = decay(m, hits, 13);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.06, 1 + pk * 0.06); ctx.translate(-CX, -CY); shakeAt(ctx, t, 4 + pk * 30);
  rainbowBG(ctx, t * 2.6);
  // 背後巨大 777
  ctx.save(); ctx.globalAlpha = 0.28; ctx.font = "620px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.translate(CX, CY + 20); ctx.scale(1 + pk * 0.08, 1 + pk * 0.08); ctx.fillStyle = '#fff'; ctx.fillText('777', 0, 0); ctx.restore();
  coinFountain(ctx, m, 0, 3.0, 220);
  const gk = lin(m, 0.12, 0.42); if (gk > 0) { if (gk < 1) for (let k = 1; k <= 4; k++) drawImg(ctx, silhouette(GIRL_SIL, `hsl(${k * 70},100%,60%)`), 1500 + (1 - eo5(gk)) * 900 + k * 90 * (1 - gk), 820, 1700, 0.03, 0.35);
    girlAt(ctx, 1500 + (1 - eo5(gk)) * 900, 820, 1700 + pk * 40, t); }
  const tk = lin(m, 0.3, 0.48);
  if (tk > 0) { const s = tk < 1 ? 2.6 - 1.6 * eback(tk, 1.4) : 1 + pk * 0.08;
    if (m > 0.55) { const bp = ((m - 0.3) % 0.2) / 0.2; ctx.save(); ctx.globalAlpha = (1 - bp) * 0.45; titleText(ctx, t, 730, 420, 1.3 * (1 + bp * 0.35), -0.08); ctx.restore(); }
    title3D(ctx, t, 730, 420, s * 1.3, -0.08, 18, ['#2a0a50', '#4a1080']); }
  subLine(ctx, t, eo(lin(m, 0.6, 0.8)));
  mascotAt(ctx, t, lin(m, 0.55, 0.85));
  ctx.restore();
  confetti(ctx, m, 0, 120, ['#ff5aa5', '#ffe14a', '#5ad8ff', '#7aff8a', '#fff'], 7);
  if (m > 0.5) { const e = 1 - eo5(lin(m, 0.5, 0.7)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  ledFrame(ctx, t);
  if (m >= 0.3) flash(ctx, (1 - lin(m, 0.3, 0.4)) * 0.4, '#fff');
}
function sceneSlot(ctx, t) {
  const D = CFG.dur, JP = 4.0, EX = D - 0.6;
  if (t >= EX) { const k = lin(t, EX, D - 0.02); exitSmear(ctx, k, Math.floor(t * 60), (c) => slotMain(c, t - JP, t)); return; }
  if (t >= JP) { slotMain(ctx, t - JP, t); flash(ctx, (1 - lin(t, JP, JP + 0.18)) * 0.85); return; }
  const reach = t >= 1.9 && t < 3.62, miss = t >= 3.4 && t < 3.62, win = t >= 3.8;
  const appear = eo5(lin(t, 0, 0.4));
  // 背景
  ctx.fillStyle = `rgba(0,0,0,${0.8 * appear})`; ctx.fillRect(0, 0, W, H);
  if (reach) { ctx.save(); ctx.globalAlpha = miss ? 0.35 : 0.65 + Math.sin(t * 25) * 0.15; palBG(ctx, t, PAL.red, CX + 340, RY); ctx.restore(); }
  if (t >= 3.62) { ctx.save(); ctx.globalAlpha = 0.8; rainbowBG(ctx, t * 3); ctx.restore(); }
  // 鏡頭推近第三輪
  const push = reach && !miss ? eo(lin(t, 2.3, 3.4)) * 0.45 : (miss ? 0.45 - 0.1 * eo(lin(t, 3.4, 3.62)) : 0);
  const pull = t >= 3.62 ? (1 - eo5(lin(t, 3.62, 3.78))) * 0.35 : 0;
  const z = 1 + push + pull, fx = CX + 340 * Math.min(1, (push + pull) / 0.45);
  const hitList = [[1.4, 0.6], [1.9, 0.8], [3.4, 0.5], [3.62, 1.2], [3.8, 0.9]];
  ctx.save(); shakeAt(ctx, t, decay(t, hitList, 10) * 26 + (reach && !miss ? 3 : 0));
  ctx.translate(fx, RY); ctx.scale(z, z); ctx.translate(-fx, -RY);
  ctx.translate(0, (1 - appear) * 900);
  drawMachine(ctx, t, reach, win ? 1 : 0);
  // 777 光柱
  if (win) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = lin(t, 3.8, 4.0);
    for (let r = 0; r < 3; r++) { const gr = ctx.createLinearGradient(0, RY, 0, -200); gr.addColorStop(0, `hsla(${(t * 600 + r * 120) % 360},100%,70%,0.9)`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(RX[r] - 90 * k, -200, 180 * k, RY + 200); } ctx.restore(); }
  ctx.restore();
  if (miss) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H); }
  // 字卡
  if (reach && !miss) { const k = lin(t, 1.92, 2.08); const s = k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1 + Math.sin(t * 20) * 0.03;
    const col = Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a'; bigWord(ctx, 'REACH!!', CX, 175, s * 1.05, -0.05, col); }
  if (t >= 3.62 && t < 4.0) { const k = lin(t, 3.62, 3.74); bigWord(ctx, '復活!!', CX - 560, 880, (k < 1 ? 2.4 - 1.4 * eback(k, 1.6) : 1) * 1.1, -0.18, rainbowFill(ctx, -60, 60, t)); }
  if (win) { const k = lin(t, 3.82, 3.95); bigWord(ctx, 'JACKPOT!!', CX, 175, (k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1) * 1.1, -0.04, rainbowFill(ctx, -60, 60, t)); }
  if (t >= 3.62) flash(ctx, (1 - lin(t, 3.62, 3.74)) * 0.6, '#fff');
  for (const ts of [1.4, 1.9]) if (t >= ts) flash(ctx, (1 - lin(t, ts, ts + 0.08)) * 0.18, '#fff');
}

// ---------------- ×100 神降臨 ----------------
let SHARDS = null;
function makeShards() {
  const cols = 9, rows = 6, P = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const edge = i === 0 || j === 0 || i === cols || j === rows;
    P.push([i / cols * W + (edge ? 0 : (R(i + j * 20, 1) - 0.5) * W / cols * 0.8), j / rows * H + (edge ? 0 : (R(i + j * 20, 2) - 0.5) * H / rows * 0.8)]); }
  const S = [], id = (i, j) => j * (cols + 1) + i;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = P[id(i, j)], b = P[id(i + 1, j)], c = P[id(i + 1, j + 1)], d = P[id(i, j + 1)];
    for (const tri of (R(i, j) < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]])) { const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3; S.push({ tri, cx, cy, k: S.length }); } }
  return S;
}
function cosmos(ctx, t, warp) {
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#020010'); bg.addColorStop(0.6, '#0e0630'); bg.addColorStop(1, '#2a0a3a');
  ctx.fillStyle = bg; ctx.fillRect(-60, -60, W + 120, H + 120);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) { const hue = (i * 52 + t * 40) % 360; const x = CX + Math.cos(i * 1.7 + t * 0.15) * 700, y = CY + Math.sin(i * 2.3 + t * 0.12) * 380;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 650); gr.addColorStop(0, `hsla(${hue},90%,55%,0.28)`); gr.addColorStop(1, `hsla(${hue},90%,40%,0)`); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
  for (let i = 0; i < 220; i++) { const a = R(i, 41) * Math.PI * 2, d = ((R(i, 42) + t * (0.08 + warp * 0.9)) % 1); const r = d * d * 1500;
    const x = 1350 + Math.cos(a) * r, y = 380 + Math.sin(a) * r, len = 2 + warp * r * 0.25;
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + d * 0.7})`; ctx.lineWidth = 1 + d * 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * len, y - Math.sin(a) * len); ctx.stroke(); }
  ctx.restore();
}
function haloRing(ctx, t, x, y, r, a, pulse) {
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = 'rgba(255,220,120,1)'; ctx.shadowBlur = 40 + pulse * 40;
  ctx.strokeStyle = `rgba(255,236,160,${0.9})`; ctx.lineWidth = 14 + pulse * 10; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, 7); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.save(); ctx.rotate(t * 0.4); ctx.strokeStyle = 'rgba(255,240,190,0.9)'; ctx.lineWidth = 5;
  for (let i = 0; i < 48; i++) { const an = i / 48 * Math.PI * 2, l = i % 4 ? 16 : 40; ctx.beginPath(); ctx.moveTo(Math.cos(an) * r * 1.12, Math.sin(an) * r * 1.12); ctx.lineTo(Math.cos(an) * (r * 1.12 + l), Math.sin(an) * (r * 1.12 + l)); ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.rotate(-t * 0.7); ctx.fillStyle = 'rgba(255,250,220,0.95)';
  for (let i = 0; i < 12; i++) { const an = i / 12 * Math.PI * 2; ctx.save(); ctx.translate(Math.cos(an) * r * 0.91, Math.sin(an) * r * 0.91); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 0); ctx.lineTo(0, 14); ctx.lineTo(-9, 0); ctx.fill(); ctx.restore(); }
  ctx.strokeStyle = 'rgba(255,230,160,0.35)'; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i <= 12; i++) { const an = i * 5 / 12 * Math.PI * 2; i ? ctx.lineTo(Math.cos(an) * r * 0.8, Math.sin(an) * r * 0.8) : ctx.moveTo(Math.cos(an) * r * 0.8, Math.sin(an) * r * 0.8); } ctx.stroke();
  ctx.restore(); ctx.restore();
}
function fireworksAt(ctx, t, list) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [ft, fx, fy, hue] of list) { const p = t - ft; if (p < 0 || p > 1.1) continue;
    for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2 + R(i, ft); const r = eo(p / 1.1) * (260 + R(i, 7) * 90);
      const x = fx + Math.cos(a) * r, y = fy + Math.sin(a) * r + 170 * p * p, q = p / 1.1;
      ctx.strokeStyle = `hsla(${(hue + i * 5) % 360},100%,${70 + 20 * (1 - q)}%,${1 - q})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * 34 * (1 - q), y - Math.sin(a) * 34 * (1 - q)); ctx.stroke(); }
    star4(ctx, fx, fy, 140 * (1 - p / 1.1), '#fff', 1 - p / 1.1); }
  ctx.restore();
}
function headPos(gx, gy, gh) { const w = GIRL.width * gh / GIRL.height; return [gx - w / 2 + FACE.x * w, gy - gh / 2 + FACE.y * gh]; }
function godMain(ctx, t) {   // t：本級時間（2.9 之後）
  const LAND = 4.1, TT = 4.35, hits = [[LAND, 1], [TT, 1.2], [4.85, 0.8]]; for (let b = 5.15; b < CFG.dur - 0.8; b += 0.4) hits.push([b, 0.4]);
  const pk = decay(t, hits, 12);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.06, 1 + pk * 0.06); ctx.translate(-CX, -CY); shakeAt(ctx, t, 3 + pk * 34);
  const warp = t < 3.7 ? 1 - lin(t, 2.9, 3.7) * 0.85 : 0.15;
  cosmos(ctx, t, warp);
  const gx = 1360, gh = 1700, gyF = 820;
  const dk = lin(t, 3.05, LAND), gy = gyF - (1 - eo(dk)) * 1900;
  // 光柱
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const pa = lin(t, 2.9, 3.2) * (0.7 + pk * 0.3);
  let gr = ctx.createLinearGradient(gx - 300, 0, gx + 300, 0); gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, `rgba(255,250,230,${0.55 * pa})`); gr.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = gr; ctx.fillRect(gx - 300, -60, 600, H + 120);
  gr = ctx.createLinearGradient(gx - 70, 0, gx + 70, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${0.8 * pa})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(gx - 70, -60, 140, H + 120);
  if (t > LAND) godRays(ctx, gx, 300, 36, `rgba(255,240,190,${0.1 + pk * 0.15})`, t * 0.3, 2600, 0.45);
  if (t > LAND) for (let h = 0; h < 6; h++) godRays(ctx, gx, 300, 6, `hsla(${(h * 60 + t * 90) % 360},100%,60%,${0.16 * lin(t, LAND, LAND + 0.4)})`, -t * 0.25 + h * Math.PI / 18, 2600, 0.5);
  ctx.restore();
  // 光環（跟著頭）
  if (GIRL) { const [hx, hy] = headPos(gx, gy, gh); haloRing(ctx, t, hx, hy - 20, 330 + pk * 30, lin(t, 3.4, 4.0), decay(t, hits, 8)); }
  // 羽毛
  ctx.save(); for (let i = 0; i < 50; i++) { const st = 2.9 + R(i, 51) * 4, l = t - st; if (l < 0) continue; const y = -40 + l * (90 + R(i, 52) * 120); if (y > H + 40) continue;
    const x = gx + (R(i, 53) - 0.5) * 1500 + Math.sin(l * 2 + i) * 80; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(l * 2.5 + i) * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 22, 0, 0, 7); ctx.fill(); ctx.restore(); } ctx.restore();
  // 角色降臨：先是白色光影，著地後轉成彩色
  if (GIRL && dk > 0) { const wk = lin(t, 3.6, LAND + 0.1);
    neonOutline(ctx, GIRL_SIL, gx, gy, gh + pk * 40, t, 0.03);
    drawImg(ctx, GIRL, gx, gy, gh + pk * 40, 0.03, wk);
    if (wk < 1) drawImg(ctx, silhouette(GIRL_SIL, '#fffbe8'), gx, gy, gh + pk * 40, 0.03, 1 - wk); }
  coins(ctx, t - TT + T_HIT); coins(ctx, t - 4.85 + T_HIT);
  const tk = lin(t, TT, TT + 0.2);
  if (tk > 0) { const s = tk < 1 ? 3.2 - 2.2 * eback(tk, 1.4) : 1 + pk * 0.08;
    if (t > TT + 0.25) { const bp = ((t - TT) % 0.2) / 0.2; ctx.save(); ctx.globalAlpha = (1 - bp) * 0.5; titleText(ctx, t, 640, 420, 1.45 * (1 + bp * 0.4), -0.08); ctx.restore(); }
    title3D(ctx, t, 640, 420, s * 1.45, -0.08, 22, ['#3a1a00', '#7a4a00']); }
  premiumExtra(ctx, t - 0.23, pk);   // ×100 徽章（4.85 砸下）
  subLine(ctx, t, eo(lin(t, 4.95, 5.15)), 760, 760, 1.25);
  mascotAt(ctx, t, lin(t, 5.05, 5.35), 230, 870, 470);
  fireworksAt(ctx, t, [[5.3, 420, 220, 50], [5.65, 1100, 160, 300], [6.0, 760, 120, 180], [6.35, 260, 360, 10], [6.7, 1550, 220, 120], [7.05, 980, 260, 260], [7.4, 420, 160, 330], [7.75, 1300, 140, 60], [8.1, 700, 220, 200]]);
  ctx.restore();
  confetti(ctx, t, 4.35, 200, ['#ffe27a', '#fff6c0', '#ff5aa5', '#5ad8ff', '#ffffff'], 5);
  if (t > 4.6) { const e = 1 - eo5(lin(t, 4.6, 4.8)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  if (t > 4.4) ledFrame(ctx, t);
  if (t >= LAND) flash(ctx, (1 - lin(t, LAND, LAND + 0.12)) * 0.55, '#fff3c8');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.12)) * 0.75, '#fff');
}
function sceneGod(ctx, t) {
  const D = CFG.dur, SH = 2.9, EX = D - 0.8;
  if (!SHARDS) SHARDS = makeShards();
  if (t < 0.5) { sceneTeaser(bctx, t * 0.8); ctx.filter = `hue-rotate(${(t * 700) % 360}deg) saturate(1.6)`; ctx.drawImage(buf, 0, 0); ctx.filter = 'none'; return; }
  if (t < 1.1) {   // 凍結：畫面卡住＋訊號崩壞
    const f = Math.floor(t * 60), stut = Math.floor(t * 20) % 3;
    bctx.setTransform(1, 0, 0, 1, 0, 0); sceneTeaser(bctx, 0.4 - stut * 0.004);
    ctx.filter = 'hue-rotate(200deg) saturate(1.6)'; ctx.drawImage(buf, 0, 0); ctx.filter = 'none';
    const tmp = mk(); tmp.getContext('2d').drawImage(cv, 0, 0); ctx.clearRect(0, 0, W, H); sliceShift(ctx, tmp, t, 260 * lin(t, 0.5, 1.1) + 40, f);
    ctx.save(); for (let i = 0; i < 14; i++) { ctx.fillStyle = `hsla(${R(f, i) * 360},100%,60%,0.75)`; ctx.fillRect(R(f, i + 20) * W, R(f, i + 40) * H, 40 + R(f, i + 60) * 420, 8 + R(f, i + 80) * 50); } ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.18; for (let y = 0; y < H; y += 4) { ctx.fillStyle = R(f, y) < 0.5 ? '#000' : '#fff'; ctx.fillRect(0, y, W, 2); } ctx.restore();
    if (t > 1.0) flash(ctx, lin(t, 1.0, 1.1), '#000');
    return;
  }
  if (t < SH) {   // 全黑 → 裂痕
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const steps = [[2.0, 0.28], [2.3, 0.55], [2.6, 0.85]]; let gro = 0; for (const [ts, gv] of steps) if (t >= ts) gro = gv * (0.85 + 0.15 * eo5(lin(t, ts, ts + 0.08)));
    if (gro > 0) { ctx.save(); shakeAt(ctx, t, decay(t, steps.map(([a]) => [a, 1]), 14) * 22);
      ctx.save(); ctx.shadowColor = `hsl(${(t * 400) % 360},100%,60%)`; ctx.shadowBlur = 30; cracks(ctx, 77, CX + 60, CY - 30, gro, `hsl(${(t * 400) % 360},100%,75%)`, 9); ctx.restore();
      cracks(ctx, 77, CX + 60, CY - 30, gro, '#fff', 3);
      const gl = ctx.createRadialGradient(CX + 60, CY - 30, 0, CX + 60, CY - 30, 120 + gro * 300); gl.addColorStop(0, `rgba(255,255,255,${0.5 * gro})`); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    if (t > 2.65) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,255,${ei(lin(t, 2.65, SH)) * 0.35})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    return;
  }
  if (t >= EX) {   // 昇天退場：白光上升後淡出
    const k = lin(t, EX, D - 0.02);
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.clearRect(0, 0, W, H); godMain(bctx, t);
    ctx.save(); ctx.globalAlpha = 1 - ei(lin(k, 0.35, 1)); ctx.translate(CX, CY); ctx.scale(1 + k * 0.08, 1 + k * 0.08); ctx.translate(-CX, -CY - k * 120); ctx.drawImage(buf, 0, 0); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(0, H, 0, H - 1600 * eo(k)); gr.addColorStop(0, `rgba(255,250,230,${Math.sin(k * Math.PI) * 0.9})`); gr.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${ei(lin(k, 0.6, 1))})`; ctx.fillRect(0, 0, W, H); ctx.restore();
    return;
  }
  godMain(ctx, t);
  // 玻璃碎片往鏡頭飛
  const k = lin(t, SH, SH + 0.75);
  if (k < 1) { ctx.save();
    for (const s of SHARDS) { const q = eo(Math.min(1, k * (0.8 + R(s.k, 1) * 0.6))); const dx = s.cx - CX, dy = s.cy - CY;
      const sc = 1 + q * (1.5 + R(s.k, 2) * 2); const nx = CX + dx * (1 + q * 2.2), ny = CY + dy * (1 + q * 2.2) + q * q * 300;
      ctx.save(); ctx.globalAlpha = 1 - ei(q); ctx.translate(nx, ny); ctx.rotate((R(s.k, 3) - 0.5) * 5 * q); ctx.scale(sc, sc);
      ctx.beginPath(); ctx.moveTo(s.tri[0][0] - s.cx, s.tri[0][1] - s.cy); ctx.lineTo(s.tri[1][0] - s.cx, s.tri[1][1] - s.cy); ctx.lineTo(s.tri[2][0] - s.cx, s.tri[2][1] - s.cy); ctx.closePath();
      ctx.fillStyle = '#05050a'; ctx.fill(); ctx.strokeStyle = `hsla(${(s.k * 37 + t * 300) % 360},100%,80%,0.9)`; ctx.lineWidth = 3 / sc; ctx.stroke(); ctx.restore(); }
    ctx.restore(); }
  if (t < SH + 0.15) flash(ctx, (1 - lin(t, SH, SH + 0.15)) * 0.7, '#fff');
}

// 覆寫高階等級
Object.assign(TIERS.g25, { kind: 'gate', dur: 5.6, pal: 'gold', title: '大量贈訂!!', ticker: 'GOLDEN ★ BIG CHANCE ★', mascot: true, coins: 80 });
Object.assign(TIERS.g50, { kind: 'slot', dur: 7.6, pal: 'rainbow', title: '大物降臨!!', ticker: 'JACKPOT ★ 777 ★', mascot: true, coins: 90 });
Object.assign(TIERS.g100, { kind: 'god', dur: 9.4, pal: 'premium', title: '神降臨!!', ticker: 'PREMIUM ★ 神降臨 ★', mascot: true, coins: 120 });
const HI = { gate: sceneGate, slot: sceneSlot, god: sceneGod };
