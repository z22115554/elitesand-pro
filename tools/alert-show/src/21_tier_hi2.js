
// ======================= 第三輪：×10 PUSH／各級獨立結尾構圖／×50 慢速復活／×100 加碼 =======================
// （同名 function 會覆寫 tier_hi.js 的版本）
function glyph(ctx, t, ch, x, y, s, rot, pal, depth = 0, ext = ['#3a1a00', '#7a4a00']) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = "200px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let i = depth; i >= 1; i--) { ctx.strokeStyle = ext[i % 2]; ctx.lineWidth = 56; ctx.strokeText(ch, i * 1.4, i * 2.2); }
  ctx.shadowColor = pal.glow; ctx.shadowBlur = 40; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 56; ctx.strokeText(ch, 0, 0); ctx.shadowBlur = 0;
  const gold = ctx.createLinearGradient(0, -110, 0, 110); gold.addColorStop(0, '#fff6c0'); gold.addColorStop(0.45, '#ffb21a'); gold.addColorStop(0.55, '#c76a00'); gold.addColorStop(1, '#ffe27a');
  ctx.strokeStyle = gold; ctx.lineWidth = 34; ctx.strokeText(ch, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.strokeText(ch, 0, 0);
  ctx.fillStyle = palFill(ctx, -95, 95, t, pal); ctx.fillText(ch, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-300, -120, 600, 95); ctx.clip(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillText(ch, 0, 0); ctx.restore();
  ctx.restore();
}
function splitTitle(txt) { const out = []; for (const ch of Array.from(txt)) { if (ch === '!' && out.length && /^!+$/.test(out[out.length - 1])) out[out.length - 1] += ch; else if (ch !== ' ') out.push(ch); } return out; }
let MASCOT_FLIP = null;
function mascotFlip() { if (!MASCOT) return null; if (!MASCOT_FLIP || MASCOT_FLIP.src !== MASCOT) { const c = mk(MASCOT.width, MASCOT.height), x = c.getContext('2d'); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(MASCOT, 0, 0); MASCOT_FLIP = { c, src: MASCOT }; } return MASCOT_FLIP.c; }
function mascotAt2(ctx, t, k, x, y, h, flip = false) {
  const img = flip ? mascotFlip() : MASCOT; if (!img || k <= 0) return;
  const s = eback(k, 2.6), bob = Math.abs(Math.sin(t * 15.7 + (flip ? 1 : 0))) * -26, mr = (flip ? 0.1 : -0.1) + Math.sin(t * 15.7) * 0.08;
  neonOutline(ctx, img, x, y + bob, h * s, t + 0.3, mr); drawImg(ctx, img, x, y + bob, h * s, mr);
}

// ---------------- ×25 結尾：直書大字（左）＋聚光角色（中右） ----------------
function gateMain(ctx, m, t) {
  const pal = PAL.gold, chars = splitTitle(CFG.title);
  const hits = [[0, 1]]; chars.forEach((c, i) => hits.push([0.35 + i * 0.1, 0.55])); for (let b = 1.2; b < 3.4; b += 0.4) hits.push([b, 0.3]);
  const pk = decay(m, hits, 13);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.04, 1 + pk * 0.04); ctx.translate(-CX, -CY); shakeAt(ctx, t, 4 + pk * 22);
  const bg = ctx.createRadialGradient(1250, 200, 0, 1250, 200, 1700);
  bg.addColorStop(0, '#fffbe6'); bg.addColorStop(0.15, '#ffe27a'); bg.addColorStop(0.45, '#d08a00'); bg.addColorStop(0.8, '#5a2a00'); bg.addColorStop(1, '#1a0a00');
  ctx.fillStyle = bg; ctx.fillRect(-60, -60, W + 120, H + 120);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  godRays(ctx, 1250, -300, 22, 'rgba(255,240,170,0.13)', 1.1 + Math.sin(m * 0.8) * 0.12, 2600, 0.4);
  const sp = ctx.createLinearGradient(1250, 0, 1250, H); sp.addColorStop(0, 'rgba(255,250,210,0.8)'); sp.addColorStop(1, 'rgba(255,220,120,0.12)');
  ctx.fillStyle = sp; ctx.beginPath(); ctx.moveTo(1120, -60); ctx.lineTo(1380, -60); ctx.lineTo(1700, H + 60); ctx.lineTo(800, H + 60); ctx.fill();
  const fl = ctx.createRadialGradient(1250, 1010, 0, 1250, 1010, 520); fl.addColorStop(0, 'rgba(255,250,220,0.6)'); fl.addColorStop(1, 'rgba(255,220,120,0)');
  ctx.fillStyle = fl; ctx.save(); ctx.translate(0, 1010); ctx.scale(1, 0.22); ctx.translate(0, -1010); ctx.fillRect(600, 400, 1300, 1300); ctx.restore();
  ctx.restore();
  const gk = lin(m, 0.1, 0.5); if (gk > 0) girlAt(ctx, 1250, 840 + (1 - eo5(gk)) * 700, 1720 + pk * 30, t);
  // 直書大字（逐字砸下）
  const n = chars.length, step = Math.min(200, 960 / n), y0 = CY - step * (n - 1) / 2;
  if (isLatinTitle()) heroTitle(ctx, t, 300, CY, lin(m, 0.35, 0.53), { maxW: 900, rot: -Math.PI / 2, pk });   /* 英文標題不逐字直排，整行轉 90 度 */
  else chars.forEach((c, i) => { const k = lin(m, 0.35 + i * 0.1, 0.5 + i * 0.1); if (k <= 0) return;
    const s = k < 1 ? 2.6 - 1.65 * eback(k, 1.5) : 0.95 + decay(m, [[0.35 + i * 0.1, 1]], 10) * 0.06;
    glyph(ctx, t, c, 300 + (i % 2 ? 14 : -14), y0 + i * step, s * (c.length > 1 ? 0.9 : 1), (i % 2 ? 0.05 : -0.05), pal, 12, ['#5a3000', '#7a4200']); });
  for (let i = 0; i < n; i++) coins(ctx, m - 0.35 - i * 0.1 + T_HIT);
  subLine(ctx, t, eo(lin(m, 0.95, 1.15)), 1300, 955, 1.0);
  mascotAt2(ctx, t, lin(m, 1.05, 1.35), 690, 900, 380);
  ctx.restore();
  confetti(ctx, m, 0.05, 170, ['#ffe27a', '#fff6c0', '#ffb21a', '#ffffff', '#ff5a5a'], 3);
  ledFrameHue(ctx, t, (i) => 38 + ((i * 7 + t * 80) % 20));
  if (m >= 0.35) flash(ctx, (1 - lin(m, 0.35, 0.45)) * 0.3, '#fff3b0');
}

// ---------------- ×50：慢速差一格 → 靜止 → 倒退復活 ----------------
const SL = { STOP: 4.35, REV: 5.0, LOCK: 5.42, JP: 5.68 };
function reelPos(r, t) {
  const v = 14, t0 = 0.5, sp = (tt) => tt < t0 ? 0 : (tt - t0 < 0.25 ? v * Math.pow(tt - t0, 2) / 0.5 : v * (tt - t0 - 0.125));
  if (r === 0) { if (t < 1.4) return sp(t); const a = sp(1.4), b = 14; return a + (b - a) * eo(lin(t, 1.4, 1.6)) - 0.12 * Math.sin(lin(t, 1.6, 1.85) * Math.PI); }
  if (r === 1) { if (t < 1.9) return sp(t); const a = sp(1.9), b = 21; return a + (b - a) * eo(lin(t, 1.9, 2.1)) - 0.12 * Math.sin(lin(t, 2.1, 2.35) * Math.PI); }
  if (t < 1.9) return sp(t);
  const a = sp(1.9), K = 1.6, A = (26.5 - a) / (1 - Math.exp(-K * (SL.STOP - 1.9)));
  if (t < SL.STOP) return a + A * (1 - Math.exp(-K * (t - 1.9)));
  if (t < SL.REV) { const tw = lin(t, 4.68, 4.84); return 26.5 - (tw > 0 && tw < 1 ? Math.sin(tw * Math.PI * 3) * 0.04 : 0); }
  return 26.5 - 0.5 * eback(lin(t, SL.REV, SL.LOCK), 1.8);
}
function odometer(ctx, x, y, val, t) {   // 兩位數滾輪計數器
  const digits = [Math.floor(val / 10) + Math.max(0, (val % 10) - 9), val % 10];
  digits.forEach((dv, j) => { const cx = x + j * 170, wW = 150, wH = 210;
    ctx.save(); ctx.beginPath(); ctx.roundRect(cx - wW / 2, y - wH / 2, wW, wH, 16); const bg = ctx.createLinearGradient(0, y - wH / 2, 0, y + wH / 2); bg.addColorStop(0, '#3a0010'); bg.addColorStop(0.5, '#8a0020'); bg.addColorStop(1, '#3a0010');
    ctx.fillStyle = bg; ctx.fill(); ctx.clip();
    ctx.font = "170px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = Math.floor(dv) - 1; k <= Math.floor(dv) + 2; k++) { const yy = y + (k - dv) * -wH + 8; const d = ((k % 10) + 10) % 10;
      const gg = ctx.createLinearGradient(0, yy - 70, 0, yy + 70); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(1, '#ffb000'); ctx.fillStyle = gg; ctx.fillText(String(d), cx, yy); }
    const sh = ctx.createLinearGradient(0, y - wH / 2, 0, y + wH / 2); sh.addColorStop(0, 'rgba(0,0,0,0.6)'); sh.addColorStop(0.3, 'rgba(0,0,0,0)'); sh.addColorStop(0.7, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = sh; ctx.fillRect(cx - wW / 2, y - wH / 2, wW, wH); ctx.restore();
    ctx.save(); ctx.lineWidth = 8; ctx.strokeStyle = `hsl(${(t * 400 + j * 90) % 360},100%,65%)`; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 20; ctx.beginPath(); ctx.roundRect(cx - wW / 2, y - wH / 2, wW, wH, 16); ctx.stroke(); ctx.restore(); });
}
function slotMain(ctx, m, t) {   // 結尾：角色在左指向右邊的大字＋計數器
  const done = 1.7, hits = [[0, 1], [0.3, 0.8], [done, 0.9]]; for (let b = 2.1; b < 3.4; b += 0.4) hits.push([b, 0.35]);
  const pk = decay(m, hits, 13);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.05, 1 + pk * 0.05); ctx.translate(-CX, -CY); shakeAt(ctx, t, 4 + pk * 28);
  rainbowBG(ctx, t * 2.6);
  ctx.save(); ctx.globalAlpha = 0.25; ctx.font = "560px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.translate(1250, 560); ctx.rotate(-0.06); ctx.scale(1 + pk * 0.08, 1 + pk * 0.08); ctx.fillStyle = '#fff'; ctx.fillText('777', 0, 0); ctx.restore();
  coinFountain(ctx, m, 0, 3.2, 240);
  const gk = lin(m, 0.1, 0.4);
  if (gk > 0) { const gx = 470 - (1 - eo5(gk)) * 900; if (gk < 1) for (let k = 1; k <= 4; k++) drawImg(ctx, silhouette(GIRL_SIL, `hsl(${k * 70},100%,60%)`), gx - k * 90 * (1 - gk), 830, 1700, -0.02, 0.35);
    neonOutline(ctx, GIRL_SIL, gx, 830, 1700 + pk * 40, t, -0.02); drawImg(ctx, GIRL, gx, 830, 1700 + pk * 40, -0.02); }
  const tk = lin(m, 0.3, 0.48);
  if (tk > 0) { const s = tk < 1 ? 2.6 - 1.6 * eback(tk, 1.4) : 1 + pk * 0.06;
    title3D(ctx, t, 1250, 290, s * 1.05, -0.06, 18, ['#2a0a50', '#4a1080']); }
  // 名字＋計數器
  const nk = eo(lin(m, 0.5, 0.7));
  if (nk > 0) { ctx.save(); ctx.globalAlpha = nk;
    ctx.fillStyle = 'rgba(20,6,40,0.85)'; ctx.beginPath(); ctx.moveTo(840, 480); ctx.lineTo(1780, 460); ctx.lineTo(1760, 800); ctx.lineTo(860, 815); ctx.fill();
    ctx.font = "900 54px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 12; fitText(ctx, CFG.sub1, 1300, 530, 860, "900 54px 'Noto Sans TC'", '#fff', '#1a0838', 12, 'center');
    const c = CFG.n * eo(lin(m, 0.6, done));
    odometer(ctx, 1060, 660, c, t);
    const ds = m >= done ? 1 + decay(m, [[done, 1]], 8) * 0.25 : 1;
    ctx.save(); ctx.translate(1530, 665); ctx.scale(ds, ds); ctx.font = "900 92px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 16; ctx.strokeText(LX('lblGift0'), 0, 0, 400); const ag = ctx.createLinearGradient(0, -46, 0, 46); ag.addColorStop(0, '#fff3a0'); ag.addColorStop(1, '#ff7a00'); ctx.fillStyle = ag; ctx.fillText(LX('lblGift0'), 0, 0, 400); ctx.restore();
    ctx.restore(); }
  mascotAt2(ctx, t, lin(m, 0.8, 1.1), 1690, 935, 300, true);
  ctx.restore();
  confetti(ctx, m, 0, 130, ['#ff5aa5', '#ffe14a', '#5ad8ff', '#7aff8a', '#fff'], 7);
  if (m > 0.5) { const e = 1 - eo5(lin(m, 0.5, 0.7)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  ledFrame(ctx, t);
  if (m >= 0.3) flash(ctx, (1 - lin(m, 0.3, 0.4)) * 0.4, '#fff');
  if (m >= done) flash(ctx, (1 - lin(m, done, done + 0.1)) * 0.3, '#ffe680');
}
function sceneSlot(ctx, t) {
  const D = CFG.dur, JP = SL.JP, EX = D - 0.6;
  if (t >= EX) { const k = lin(t, EX, D - 0.02); exitSmear(ctx, k, Math.floor(t * 60), (c) => slotMain(c, t - JP, t)); return; }
  if (t >= JP) { slotMain(ctx, t - JP, t); flash(ctx, (1 - lin(t, JP, JP + 0.18)) * 0.85); return; }
  const reach = t >= 1.9 && t < SL.STOP, miss = t >= SL.STOP && t < SL.REV, rev = t >= SL.REV, win = t >= SL.LOCK;
  const appear = eo5(lin(t, 0, 0.4));
  ctx.fillStyle = `rgba(0,0,0,${0.8 * appear})`; ctx.fillRect(0, 0, W, H);
  if (reach) { ctx.save(); ctx.globalAlpha = 0.65 + Math.sin(t * (18 + (t - 1.9) * 10)) * 0.15; palBG(ctx, t, PAL.red, CX + 340, RY); ctx.restore(); }
  if (miss) { ctx.save(); ctx.globalAlpha = 0.3 * (1 - lin(t, SL.STOP, SL.STOP + 0.3)); palBG(ctx, t, PAL.red, CX + 340, RY); ctx.restore(); }
  if (rev) { ctx.save(); ctx.globalAlpha = 0.85; rainbowBG(ctx, t * 3); ctx.restore(); }
  // 鏡頭：REACH 慢慢推近第三輪；差一格時停在近景；復活時拉回
  let z = 1;
  if (reach) z = 1 + eo(lin(t, 2.2, SL.STOP)) * 0.62;
  else if (miss) z = 1.62 + lin(t, SL.STOP, SL.REV) * 0.08;
  else if (rev) z = 1 + (1 - eo5(lin(t, SL.REV + 0.05, SL.REV + 0.4))) * 0.7;
  const fx = CX + 340 * Math.min(1, (z - 1) / 0.6);
  const hitList = [[1.4, 0.6], [1.9, 0.8], [SL.STOP, 0.5], [SL.REV, 1.3], [SL.LOCK, 0.9]];
  ctx.save(); shakeAt(ctx, t, decay(t, hitList, 10) * 26 + (reach ? 2 + lin(t, 3.2, SL.STOP) * 6 : 0));
  ctx.translate(fx, RY); ctx.scale(z, z); ctx.translate(-fx, -RY);
  ctx.translate(0, (1 - appear) * 900);
  drawMachine(ctx, t, reach || miss, win ? 1 : 0);
  if (win) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = lin(t, SL.LOCK, SL.LOCK + 0.2);
    for (let r = 0; r < 3; r++) { const gr = ctx.createLinearGradient(0, RY, 0, -200); gr.addColorStop(0, `hsla(${(t * 600 + r * 120) % 360},100%,70%,0.9)`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(RX[r] - 90 * k, -200, 180 * k, RY + 200); } ctx.restore(); }
  ctx.restore();
  if (miss) { ctx.fillStyle = `rgba(0,0,0,${0.45 * lin(t, SL.STOP, SL.STOP + 0.25)})`; ctx.fillRect(0, 0, W, H); }
  if (reach) { const k = lin(t, 1.92, 2.08); const s = k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1 + Math.sin(t * 20) * 0.03;
    const col = Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a'; bigWord(ctx, 'REACH!!', CX, 175, s * 1.05, -0.05, col); }
  if (rev && t < JP) { const k = lin(t, SL.REV, SL.REV + 0.14); bigWord(ctx, '復活!!', CX - 520, 860, (k < 1 ? 2.6 - 1.6 * eback(k, 1.6) : 1 + Math.sin(t * 16) * 0.03) * 1.25, -0.16, rainbowFill(ctx, -60, 60, t)); }
  if (win) { const k = lin(t, SL.LOCK + 0.02, SL.LOCK + 0.15); bigWord(ctx, 'JACKPOT!!', CX, 175, (k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1) * 1.1, -0.04, rainbowFill(ctx, -60, 60, t)); }
  if (t >= SL.REV) flash(ctx, (1 - lin(t, SL.REV, SL.REV + 0.14)) * 0.6, '#fff');
  for (const ts of [1.4, 1.9]) if (t >= ts) flash(ctx, (1 - lin(t, ts, ts + 0.08)) * 0.18, '#fff');
}

// ---------------- ×10 PUSH 按鈕 → 漫畫分格 ----------------
function hazard(ctx, y, h, off) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip(); ctx.fillStyle = '#ffd21a'; ctx.fillRect(0, y, W, h); ctx.fillStyle = '#111';
  for (let x = -200 + (off % 120); x < W + 200; x += 120) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y); ctx.lineTo(x + 60 - h, y + h); ctx.lineTo(x - h, y + h); ctx.fill(); }
  ctx.restore();
}
function pushButton(ctx, x, y, s, press, glow, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (glow > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(0, -40, 0, 0, -40, 420); gr.addColorStop(0, `rgba(255,60,60,${0.6 * glow})`); gr.addColorStop(1, 'rgba(255,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(-500, -500, 1000, 900); ctx.restore(); }
  const base = ctx.createLinearGradient(0, 40, 0, 170); base.addColorStop(0, '#d8dce6'); base.addColorStop(1, '#3a3f4a');
  ctx.fillStyle = base; ctx.beginPath(); ctx.ellipse(0, 90, 330, 120, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#16181e'; ctx.beginPath(); ctx.ellipse(0, 70, 270, 92, 0, 0, 7); ctx.fill();
  const hgt = 190 * (1 - press * 0.6);
  const dome = ctx.createRadialGradient(-70, 70 - hgt * 0.8, 10, 0, 70 - hgt * 0.4, 300); dome.addColorStop(0, '#ffb0b0'); dome.addColorStop(0.35, '#ff2a2a'); dome.addColorStop(1, '#6a0008');
  ctx.fillStyle = dome; ctx.beginPath(); ctx.ellipse(0, 70, 240, 82, 0, 0, Math.PI); ctx.ellipse(0, 70, 240, hgt, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-80, 70 - hgt * 0.62, 70, 26 * (1 - press * 0.5), -0.3, 0, 7); ctx.fill();
  ctx.font = "84px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,240,240,0.9)'; ctx.fillText('PUSH', 0, 70 - hgt * 0.35);
  ctx.restore();
}
function mangaPanel(ctx, poly, dx, dy, alpha, draw) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(dx, dy);
  const path = () => { ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  ctx.save(); path(); ctx.clip(); draw(); ctx.restore();
  path(); ctx.lineJoin = 'miter'; ctx.strokeStyle = '#111'; ctx.lineWidth = 22; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.stroke();
  ctx.restore();
}
function halftone(ctx, x0, y0, x1, y1, col, t) {
  ctx.fillStyle = col;
  for (let y = y0; y < y1; y += 26) for (let x = x0 + ((y / 26) % 2) * 13; x < x1; x += 26) { const r = 2 + 9 * Math.max(0, Math.sin((x + y) * 0.004 + t * 2)); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
}
const PA = [[30, 50], [1080, 50], [900, 1030], [30, 1030]], PB = [[1120, 50], [1890, 50], [1890, 520], [1036, 520]], PC = [[1028, 562], [1890, 562], [1890, 1030], [944, 1030]];
function tenMain(ctx, m, t, outK) {
  const hits = [[0, 1], [0.14, 0.8], [0.28, 0.8]]; for (let b = 0.7; b < 3.0; b += 0.4) hits.push([b, 0.3]);
  const pk = decay(m, hits, 13);
  ctx.save(); shakeAt(ctx, t, 3 + pk * 26);
  palBG(ctx, t, PAL.red, CX, CY);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
  // A：大字＋名字
  const ka = lin(m, 0, 0.16), kb = lin(m, 0.14, 0.3), kc = lin(m, 0.28, 0.44);
  if (ka > 0) mangaPanel(ctx, PA, -(1 - eo5(ka)) * 1200 - ei(outK) * 1300, 0, 1, () => {
    palBG(ctx, t, PAL.red, 470, 480); speedLines(ctx, 470, 480, 70, 300, 'rgba(255,255,255,0.35)', Math.floor(t * 30));
    titleText(ctx, t, 480, 420, (1 + pk * 0.05) * 0.82, -0.05); coins(ctx, m - 0.1 + T_HIT);
    subLine(ctx, t, eo(lin(m, 0.45, 0.65)), 470, 760, 0.82); });
  // B：眼睛大特寫
  if (kb > 0 && GIRL) mangaPanel(ctx, PB, (1 - eo5(kb)) * 1000 + ei(outK) * 1100, 0, 1, () => {
    palBG(ctx, t, PAL.blue, 1460, 290); speedLines(ctx, 1460, 290, 60, 200, 'rgba(255,255,255,0.4)', Math.floor(t * 30));
    const z = 1 + m * 0.04, gh = 900 / FACE.s * z, w = GIRL.width * gh / GIRL.height;
    ctx.drawImage(GIRL, 1460 - FACE.x * w, 330 - (FACE.y - FACE.s * 0.05) * gh, w, gh); });
  // C：上半身＋網點
  if (kc > 0 && GIRL) mangaPanel(ctx, PC, 0, (1 - eo5(kc)) * 700 + ei(outK) * 800, 1, () => {
    ctx.fillStyle = '#ffe14a'; ctx.fillRect(900, 540, 1000, 520); halftone(ctx, 900, 540, 1900, 1060, 'rgba(255,140,0,0.55)', t);
    girlAt(ctx, 1440, 1330 - m * 20, 1700 + pk * 30, t); });
  ctx.restore();
  ledFrameHue(ctx, t, (i) => (i * 5 + t * 200) % 60);
  for (const [ts, a] of [[0, 0.5], [0.14, 0.3], [0.28, 0.3]]) if (m >= ts) flash(ctx, (1 - lin(m, ts, ts + 0.07)) * a, '#fff');
}
function sceneTen(ctx, t) {
  const D = CFG.dur, PRESS = 2.0, EXIT = D - 0.55;
  if (t >= PRESS + 0.06) { const outK = lin(t, EXIT, D - 0.05); tenMain(ctx, t - PRESS - 0.06, t, outK);
    if (outK > 0) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${ei(outK)})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    return; }
  const appear = eo(lin(t, 0, 0.3)), beats = [[0.8, 1], [1.2, 1], [1.6, 1], [PRESS, 1.6]], pk = decay(t, beats, 9);
  ctx.fillStyle = `rgba(0,0,0,${0.85 * appear})`; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const vg = ctx.createRadialGradient(CX, CY, 300, CX, CY, 1100); vg.addColorStop(0, 'rgba(255,0,0,0)'); vg.addColorStop(1, `rgba(255,30,30,${0.15 + pk * 0.4})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.restore();
  const hz = eo5(lin(t, 0.1, 0.35)); hazard(ctx, -70 + hz * 70, 70, t * 300); hazard(ctx, H - hz * 70, 70, -t * 300);
  ctx.save(); shakeAt(ctx, t, pk * 18);
  const bk = lin(t, 0.3, 0.62), press = t >= PRESS ? 1 - eo(lin(t, PRESS + 0.02, PRESS + 0.06)) * 0 : 0;
  if (bk > 0) pushButton(ctx, CX, 780 + (1 - eback(bk, 1.6)) * 600, 1 + pk * 0.06, t >= PRESS ? 1 : 0, 0.3 + pk, t);
  // 倒數
  const cd = [['3', 0.8], ['2', 1.2], ['1', 1.6]];
  for (const [d, ts] of cd) { const l = t - ts; if (l < 0 || l >= 0.4) continue; const s = l < 0.12 ? 2.2 - 1.2 * eback(l / 0.12, 1.6) : 1 + (l - 0.12) * 0.15;
    ctx.save(); ctx.globalAlpha = 1 - lin(l, 0.3, 0.4); ctx.lineWidth = 14; ctx.strokeStyle = '#ffe14a'; ctx.shadowColor = '#ff2a2a'; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.arc(CX, 400, 150 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - l / 0.4)); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.globalAlpha = 1 - lin(l, 0.3, 0.4); bigWord(ctx, d, CX, 405, s * 1.3, 0, '#ffe14a', '#5a0008'); ctx.restore(); }
  if (t > 0.5 && t < 0.8) { const k = lin(t, 0.5, 0.62); bigWord(ctx, 'PUSH!!', CX, 400, (k < 1 ? 2 - eback(k, 1.6) : 1), -0.04, Math.floor(t * 12) % 2 ? '#ff2a3a' : '#ffe14a'); }
  ctx.restore();
  if (t >= PRESS) { const l = t - PRESS;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; speedLines(ctx, CX, 760, 120, 120 + l * 4000, 'rgba(255,200,120,0.9)', 7);
    const gr = ctx.createRadialGradient(CX, 760, 0, CX, 760, 300 + l * 9000); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

// ---------------- ×100：彩虹隧道 → 光之翼降臨 → 對稱神殿構圖 ----------------
const GD = { SH: 2.9, DESC: 3.8, LAND: 4.9, T0: 5.2, MEDAL: 6.25 };
function wings(ctx, t, x, y, open, glow) {
  if (open <= 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 10; i++) {
    const th = 0.25 + i * 0.17 + Math.sin(t * 2.6) * 0.07 * (1 - i / 12), L = (620 - i * 30) * open * (layer ? 0.75 : 1);
    const dx = side * Math.sin(th), dy = -Math.cos(th); const cx = x + side * 70 + dx * L / 2, cy = y + dy * L / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(dy, dx));
    const gr = ctx.createLinearGradient(-L / 2, 0, L / 2, 0); gr.addColorStop(0, `rgba(255,250,230,${0.55 + glow * 0.3})`); gr.addColorStop(1, `hsla(${(i * 30 + t * 80) % 360},100%,75%,0.05)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, 0, L / 2, (layer ? 26 : 44), 0, 0, 7); ctx.fill(); ctx.restore(); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = Math.min(1, open);
  for (const side of [-1, 1]) for (let i = 0; i < 10; i++) {
    const th = 0.25 + i * 0.17 + Math.sin(t * 2.6) * 0.07 * (1 - i / 12), L = (620 - i * 30) * open;
    const dx = side * Math.sin(th), dy = -Math.cos(th); ctx.save(); ctx.translate(x + side * 70 + dx * L / 2, y + dy * L / 2); ctx.rotate(Math.atan2(dy, dx));
    const g2 = ctx.createLinearGradient(-L / 2, 0, L / 2, 0); g2.addColorStop(0, 'rgba(255,255,255,0.95)'); g2.addColorStop(0.7, 'rgba(255,246,210,0.8)'); g2.addColorStop(1, 'rgba(255,220,140,0.2)');
    ctx.fillStyle = g2; ctx.strokeStyle = 'rgba(200,150,40,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, L / 2, 30, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }
  ctx.restore();
}
function warpTunnel(ctx, t, k) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) { const z = ((i / 18) + (t - GD.SH) * 1.6) % 1; const r = 30 * Math.pow(40, z);
    ctx.strokeStyle = `hsla(${(i * 40 + t * 200) % 360},100%,65%,${Math.min(1, z * 1.5) * (1 - k * 0.8)})`; ctx.lineWidth = 2 + z * 30;
    ctx.beginPath(); ctx.ellipse(CX + Math.sin(t * 3 + i) * 30 * z, CY + Math.cos(t * 2 + i) * 20 * z, r * 1.25, r, 0, 0, 7); ctx.stroke(); }
  ctx.restore();
}
function premiumSeal(ctx, t, x, y, k, pk) {
  if (k <= 0) return; const s = (k < 1 ? 3 - 2 * eback(k, 1.6) : 1) * (1 + pk * 0.08);
  ctx.save(); ctx.translate(x, y); ctx.rotate(0.12 + Math.sin(t * 4) * 0.04); ctx.scale(s, s);
  const gg = ctx.createLinearGradient(0, -70, 0, 70); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffb21a'); gg.addColorStop(1, '#a86400');
  ctx.shadowColor = 'rgba(255,220,100,1)'; ctx.shadowBlur = 40; ctx.fillStyle = gg; ctx.beginPath(); ctx.roundRect(-230, -66, 460, 132, 30); ctx.fill(); ctx.shadowBlur = 0;
  ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#1a0838'; ctx.beginPath(); ctx.roundRect(-206, -44, 412, 88, 20); ctx.fill();
  ctx.font = "64px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = rainbowFill(ctx, -30, 30, t); ctx.fillText('PREMIUM', 0, 4);
  ctx.restore();
}
function godMain(ctx, t) {
  const chars = splitTitle(CFG.title), n = chars.length;
  const hits = [[GD.LAND, 1.2]]; chars.forEach((c, i) => hits.push([GD.T0 + i * Math.min(0.25, 0.9 / Math.max(1, splitTitle(CFG.title).length - 1)), 1.1])); hits.push([GD.MEDAL, 0.9]);
  for (let b = GD.MEDAL + 0.4; b < CFG.dur - 0.8; b += 0.4) hits.push([b, 0.45]);
  const pk = decay(t, hits, 12);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.05, 1 + pk * 0.05); ctx.translate(-CX, -CY); shakeAt(ctx, t, 3 + pk * 34);
  const warp = t < GD.DESC ? 1 : (t < GD.LAND ? 1 - lin(t, GD.DESC, GD.LAND) * 0.85 : 0.15);
  cosmos(ctx, t, warp);
  if (t < GD.DESC + 0.4) warpTunnel(ctx, t, lin(t, GD.DESC - 0.1, GD.DESC + 0.4));
  const gx = CX, gh = 1650, gyF = 860, dk = lin(t, GD.DESC, GD.LAND), gy = gyF - (1 - eo(dk)) * 1900;
  // 角色背後的柔和光暈（原本是巨大「神」字，低透明度時筆畫像一塊塊方塊，已拿掉）
  const kk = lin(t, GD.LAND, GD.LAND + 0.3);
  if (kk > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const r = (500 + eo5(kk) * 300) * (1 + pk * 0.08);
    const bl = ctx.createRadialGradient(CX, 430, 0, CX, 430, r); bl.addColorStop(0, `rgba(255,246,210,${0.45 * kk})`); bl.addColorStop(0.45, `rgba(255,200,120,${0.18 * kk})`); bl.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = bl; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  // 光柱與彩虹光芒
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const pa = dk > 0 ? 0.8 + pk * 0.2 : 0;
  let gr = ctx.createLinearGradient(gx - 320, 0, gx + 320, 0); gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, `rgba(255,250,230,${0.55 * pa})`); gr.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = gr; ctx.fillRect(gx - 320, -60, 640, H + 120);
  if (t > GD.LAND) { godRays(ctx, gx, 300, 36, `rgba(255,240,190,${0.05 + pk * 0.1})`, t * 0.3, 2600, 0.45);
    for (let h = 0; h < 6; h++) godRays(ctx, gx, 300, 6, `hsla(${(h * 60 + t * 90) % 360},100%,60%,${0.085 * lin(t, GD.LAND, GD.LAND + 0.4)})`, -t * 0.25 + h * Math.PI / 18, 2600, 0.5); }
  ctx.restore();
  // 每拍從角色擴散的光環
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [ti, a] of hits) { const l = t - ti; if (l < 0 || l > 0.5) continue; const p = l / 0.5;
    ctx.strokeStyle = `hsla(${(ti * 300) % 360},100%,80%,${(1 - p) * Math.min(1, a)})`; ctx.lineWidth = 30 * (1 - p) + 2; ctx.beginPath(); ctx.ellipse(gx, 420, 150 + eo(p) * 1300, 100 + eo(p) * 800, 0, 0, 7); ctx.stroke(); }
  ctx.restore();
  if (GIRL && dk > 0) { const [hx, hy] = headPos(gx, gy, gh);
    wings(ctx, t, gx, gy - gh * 0.12, eback(lin(t, GD.LAND, GD.LAND + 0.45), 1.6), pk);
    haloRing(ctx, t, hx, hy - 30, 300 + pk * 30, lin(t, GD.DESC + 0.3, GD.LAND), decay(t, hits, 8)); }
  // 羽毛
  ctx.save(); for (let i = 0; i < 70; i++) { const st = GD.DESC + R(i, 51) * 6, l = t - st; if (l < 0) continue; const y = -40 + l * (90 + R(i, 52) * 120); if (y > H + 40) continue;
    const x = (R(i, 53)) * W + Math.sin(l * 2 + i) * 80; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(l * 2.5 + i) * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 22, 0, 0, 7); ctx.fill(); ctx.restore(); } ctx.restore();
  if (GIRL && dk > 0) { const wk = lin(t, GD.LAND - 0.3, GD.LAND + 0.1), hh = gh + pk * 40;
    neonOutline(ctx, GIRL_SIL, gx, gy, hh, t, 0); drawImg(ctx, GIRL, gx, gy, hh, 0, wk);
    if (wk < 1) drawImg(ctx, silhouette(GIRL_SIL, '#fffbe8'), gx, gy, hh, 0, 1 - wk); }
  // 大字：一字一字砸下（下方置中）
  const gf = Math.min(1, 1560 / (270 * n)), sp = 270 * gf, x0 = CX - sp * (n - 1) / 2;
  chars.forEach((c, i) => { const ts = GD.T0 + i * Math.min(0.25, 0.9 / Math.max(1, splitTitle(CFG.title).length - 1)), k = lin(t, ts, ts + 0.16); if (k <= 0) return;
    const s = k < 1 ? 3.4 - 2.15 * eback(k, 1.5) : 1.25 + decay(t, [[ts, 1]], 9) * 0.1 + pk * 0.03;
    glyph(ctx, t, c, x0 + i * sp, 790 + (i % 2 ? 10 : -10), s * gf * (c.length > 1 ? 0.85 : 1), (i % 2 ? 0.06 : -0.06), PAL.premium, 18); coins(ctx, t - ts + T_HIT); });
  subLine(ctx, t, eo(lin(t, GD.T0 + n * 0.25 + 0.2, GD.T0 + n * 0.25 + 0.4)), CX, 968, 0.8);
  premiumExtra(ctx, t - (GD.MEDAL - 4.62), pk);
  premiumSeal(ctx, t, 1640, 240, lin(t, GD.MEDAL + 0.12, GD.MEDAL + 0.3), pk);
  mascotAt2(ctx, t, lin(t, GD.MEDAL + 0.25, GD.MEDAL + 0.55), 200, 640, 360, false);
  mascotAt2(ctx, t, lin(t, GD.MEDAL + 0.3, GD.MEDAL + 0.6), 1720, 640, 360, true);
  fireworksAt(ctx, t, [[6.4, 420, 200, 50], [6.7, 1500, 160, 300], [7.0, 760, 120, 180], [7.3, 260, 360, 10], [7.6, 1650, 380, 120], [7.9, 980, 200, 260], [8.2, 420, 160, 330], [8.5, 1300, 140, 60], [8.8, 700, 220, 200], [9.1, 1550, 200, 30], [9.4, 300, 280, 280], [9.7, 1100, 150, 150]]);
  ctx.restore();
  confetti(ctx, t, GD.T0, 220, ['#ffe27a', '#fff6c0', '#ff5aa5', '#5ad8ff', '#ffffff'], 5);
  if (t > GD.MEDAL) { const e = 1 - eo5(lin(t, GD.MEDAL, GD.MEDAL + 0.2)); tickerBand(ctx, t, 92 - e * 180, -1); }
  if (t > GD.LAND) ledFrame(ctx, t);
  if (t >= GD.LAND) flash(ctx, (1 - lin(t, GD.LAND, GD.LAND + 0.14)) * 0.6, '#fff3c8');
  chars.forEach((c, i) => { const ts = GD.T0 + i * Math.min(0.25, 0.9 / Math.max(1, splitTitle(CFG.title).length - 1)); if (t >= ts) flash(ctx, (1 - lin(t, ts, ts + 0.06)) * 0.22, '#fff'); });
}
function sceneGod(ctx, t) {
  const D = CFG.dur, SH = GD.SH, EX = D - 0.8;
  if (!SHARDS) SHARDS = makeShards();
  if (t < 0.5) { bctx.setTransform(1, 0, 0, 1, 0, 0); sceneTeaser(bctx, t * 0.8); ctx.filter = `hue-rotate(${(t * 700) % 360}deg) saturate(1.6)`; ctx.drawImage(buf, 0, 0); ctx.filter = 'none'; return; }
  if (t < 1.1) {
    const f = Math.floor(t * 60), stut = Math.floor(t * 20) % 3;
    bctx.setTransform(1, 0, 0, 1, 0, 0); sceneTeaser(bctx, 0.4 - stut * 0.004);
    ctx.filter = 'hue-rotate(200deg) saturate(1.6)'; ctx.drawImage(buf, 0, 0); ctx.filter = 'none';
    const tmp = mk(); tmp.getContext('2d').drawImage(cv, 0, 0); ctx.clearRect(0, 0, W, H); sliceShift(ctx, tmp, t, 260 * lin(t, 0.5, 1.1) + 40, f);
    ctx.save(); for (let i = 0; i < 14; i++) { ctx.fillStyle = `hsla(${R(f, i) * 360},100%,60%,0.75)`; ctx.fillRect(R(f, i + 20) * W, R(f, i + 40) * H, 40 + R(f, i + 60) * 420, 8 + R(f, i + 80) * 50); } ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.18; for (let y = 0; y < H; y += 4) { ctx.fillStyle = R(f, y) < 0.5 ? '#000' : '#fff'; ctx.fillRect(0, y, W, 2); } ctx.restore();
    if (t > 1.0) flash(ctx, lin(t, 1.0, 1.1), '#000');
    return;
  }
  if (t < SH) {
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
  if (t >= EX) {
    const k = lin(t, EX, D - 0.02);
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.clearRect(0, 0, W, H); godMain(bctx, t);
    ctx.save(); ctx.globalAlpha = 1 - ei(lin(k, 0.35, 1)); ctx.translate(CX, CY); ctx.scale(1 + k * 0.08, 1 + k * 0.08); ctx.translate(-CX, -CY - k * 120); ctx.drawImage(buf, 0, 0); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(0, H, 0, H - 1600 * eo(k)); gr.addColorStop(0, `rgba(255,250,230,${Math.sin(k * Math.PI) * 0.9})`); gr.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${ei(lin(k, 0.6, 1))})`; ctx.fillRect(0, 0, W, H); ctx.restore();
    return;
  }
  godMain(ctx, t);
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

Object.assign(TIERS.g10, { kind: 'ten', dur: 5.3, pal: 'red', title: '贈訂 ×10!!' });
Object.assign(TIERS.g50, { dur: 9.25 });
Object.assign(TIERS.g100, { dur: 11.2 });
HI.ten = sceneTen;
