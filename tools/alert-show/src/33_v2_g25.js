
// ======================= V2 特大（g25）：寶箱／火箭／舞台大幕／十連抽 =======================
function goldBG(ctx, t, cx, cy, dark = 0) {
  ctx.save(); ctx.translate(-40, -30); ctx.scale(1.045, 1.06); palBG(ctx, t, PAL.gold, cx, cy); ctx.restore();
  if (dark > 0) { ctx.fillStyle = `rgba(40,16,0,${dark})`; ctx.fillRect(-80, -80, W + 160, H + 160); }
}
function coinsFrom(ctx, x, y, t, t0, t1, n) { ctx.save(); ctx.translate(x - CX, y - (H + 40)); coinFountain(ctx, t, t0, t1, n); ctx.restore(); }
function lightPillar(ctx, x, y, w, a) {   // 從 (x,y) 往上的光柱
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(22px)'; const gp = ctx.createLinearGradient(0, y, 0, -160); gp.addColorStop(0, `rgba(255,245,200,${0.95 * a})`); gp.addColorStop(1, 'rgba(255,220,120,0)');
  ctx.fillStyle = gp; ctx.beginPath(); ctx.moveTo(x - w * 0.4, y); ctx.lineTo(x + w * 0.4, y); ctx.lineTo(x + w * 0.95, -160); ctx.lineTo(x - w * 0.95, -160); ctx.fill(); ctx.restore();
}

// ---------------- 特大 1：寶箱 ----------------
function chestV2(ctx, cx, y, bw, o = {}) {   // y = 箱底；o: lid, lift, leak, rot, sq, jx
  const sc = bw / CHEST_BODY.width, bh = CHEST_BODY.height * sc, lw = CHEST_LID.width * sc, lh = CHEST_LID.height * sc, seam = -bh + bh * CHEST_GEO.lidDY, lift = o.lift || 0, leak = o.leak || 0, sq = o.sq || 0;
  ctx.save(); ctx.translate(cx + (o.jx || 0), y); ctx.rotate(o.rot || 0); ctx.scale(1 + sq * 0.06, 1 - sq * 0.06);
  if (leak > 0 && o.lid !== false) {   // 蓋縫漏光
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(12px)'; ctx.fillStyle = `rgba(255,240,170,${leak})`; ctx.fillRect(-bw * 0.46, seam - 16 - lift, bw * 0.92, 22 + lift);
    for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.17; ctx.strokeStyle = `rgba(255,240,180,${0.4 * leak})`; ctx.lineWidth = 34; ctx.beginPath(); ctx.moveTo(0, seam - lift); ctx.lineTo(Math.cos(a) * 1300 * leak, seam + Math.sin(a) * 1300 * leak); ctx.stroke(); } ctx.restore();
  }
  ctx.drawImage(CHEST_BODY, -bw / 2, -bh, bw, bh);
  if (o.lid !== false) ctx.drawImage(CHEST_LID, -lw / 2, seam - lh - lift, lw, lh);
  ctx.restore(); return { bh, lw, lh, seam };
}
function v2ChestPre(ctx, t) {
  const T = CH_T, app = eo(lin(t, 0, 0.3)), opened = t >= T.open, l = t - T.open, mv = eio(lin(t, T.open + 0.12, T.open + 0.52));
  const bw = mixv(900, 740, mv), cx = mixv(960, 1440, mv), base = mixv(1010, 1170, mv);
  let y = base, jx = 0, rot = 0, lift = 0, leak = 0, zz = 0;
  if (t < T.land) { const u = lin(t, T.drop, T.land); y = -360 + (base + 360) * u * u; }
  const sq = t >= T.land ? Math.exp(-(t - T.land) * 12) * Math.sin((t - T.land) * 40) : 0;
  for (const [rt, p] of [[T.r1, 0.5], [T.r2, 0.75], [T.r3, 1]]) { const q = t - rt; if (q > 0 && q < 0.35) { const k = Math.sin(q / 0.35 * Math.PI); y -= 54 * p * k; jx += Math.sin(q * 70) * 15 * p; rot += Math.sin(q * 50) * 0.05 * p; lift += 40 * p * k; } if (q > 0) { leak = Math.max(leak, p * Math.exp(-q * 1.5)); zz = Math.max(zz, p); } }
  if (t > T.r3) leak = Math.max(leak, lin(t, T.r3 + 0.2, T.open));
  const pk = decay(t, [[T.land, 0.8], [T.r1, 0.25], [T.r2, 0.4], [T.r3, 0.55], [T.open, 1]], 9);
  ctx.save(); camV2(ctx, 960, 640, 1.014 + (opened ? (1 - eo(lin(l, 0, 0.3))) * 0.08 : zz * 0.08) + pk * 0.035); shakeAt(ctx, t, pk * 26);
  ctx.save(); ctx.globalAlpha = app; goldBG(ctx, t, mixv(960, 1400, mv), mixv(560, 480, mv), opened ? 0.5 * (1 - eo(lin(l, 0, 0.25))) : 0.5); ctx.restore();
  const g0 = chestV2(ctx, -9999, 0, bw);   // 只取尺寸
  if (opened) { lightPillar(ctx, cx, base - g0.bh * 0.6, bw, Math.min(1, l * 5)); ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, cx, base - g0.bh * 0.6, 16, `rgba(255,240,180,${0.26 * Math.min(1, l * 3)})`, l * 0.5, 1900, 0.4, 16); ctx.restore(); coinsFrom(ctx, cx, base - g0.bh * 0.55, t, T.open, T.open + 3, 150); }
  ctx.save(); ctx.shadowColor = 'rgba(40,10,0,0.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16; chestV2(ctx, cx, y, bw, { lid: !opened, lift, leak, rot, sq, jx }); ctx.restore();
  if (opened) { const ly = base + g0.seam - g0.lh / 2 - 3000 * l + 2400 * l * l; if (ly > -500) { ctx.save(); ctx.translate(960 + l * 500, ly); ctx.rotate(l * 9); ctx.drawImage(CHEST_LID, -g0.lw / 2, -g0.lh / 2, g0.lw, g0.lh); ctx.restore(); } ringBurst(ctx, 960, base - g0.bh * 0.6, l, { r1: 1500, dur: 0.45 }); }
  if (t >= T.land && t < T.land + 0.6) for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) { const q = (t - T.land) / 0.6; ctx.save(); ctx.globalAlpha = 0.55 * (1 - q); ctx.fillStyle = '#fff3d8'; ctx.beginPath(); ctx.arc(960 + sx * (bw * 0.46 + q * 300 + i * 40), base - 10 - i * 14 - q * 40, 30 + q * 56 - i * 5, 0, 7); ctx.fill(); ctx.restore(); }
  ctx.restore();
  if (t > T.r3 + 0.15 && !opened) wordV2(ctx, '開くぞ…!!', 960, 190, lin(t, T.r3 + 0.15, T.r3 + 0.3), { s: 0.78, fill: '#fff2a0', stroke: '#5a3000', beat: Math.sin(t * 30) * 0.03 });
  if (opened) flash(ctx, (1 - lin(l, 0, 0.16)) * 0.8, '#fff6d0');
}
function v2ChestFin(ctx, m, t) {   // 結尾：直書大字
  finaleV2(ctx, m, t, { style: 'vertical', tGirl: 0, tTitle: 0.5, girl: { x: 1400, from: 'below' }, plate: { x: 840, y: 902 }, bg: (c) => goldBG(c, t, 1400, 480),
    back: (c, mm) => { const g0 = chestV2(c, -9999, 0, 740); lightPillar(c, 1440, 1170 - g0.bh * 0.6, 740, 0.8); c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 1400, 600, 16, 'rgba(255,240,180,0.2)', t * 0.4, 1900, 0.4, 16); c.restore(); coinsFrom(c, 1440, 1170 - g0.bh * 0.55, t, CH_T.open, CH_T.open + 3.4, 150); },
    mid: (c, mm, tt, pk) => { c.save(); c.shadowColor = 'rgba(40,10,0,0.5)'; c.shadowBlur = 40; c.shadowOffsetY = 16; chestV2(c, 1440, 1170 + pk * 10, 740, { lid: false }); c.restore(); sparkleField(c, tt, 16, 1000, 560, 1800, 1000, 1); } });
}
function v2Chest(ctx, t) { if (!CHEST_BODY) return; runV2(ctx, t, { T: CH_T.open + 0.52, cut: false, exitKind: 'slice', pre: v2ChestPre, fin: v2ChestFin }); }

// ---------------- 特大 2：火箭 ----------------
const RK2 = { ign: 0.35, lift: 1.25, space: 2.2, loop0: 2.45, loop1: 3.55, cx: 1400, cy: 520, r: 400 };
function rk2Space(t) {   // 太空段的火箭位置 [x, y, 角度]
  const T = RK2;
  if (t < T.loop0) { const u = eo(lin(t, T.space, T.loop0)); return [mixv(560, T.cx, u), mixv(1500, T.cy + T.r, u), mixv(0.5, Math.PI / 2, u * u)]; }
  const a = Math.PI / 2 - (t < T.loop1 ? lin(t, T.loop0, T.loop1) * Math.PI * 2 : Math.PI * 2 + (t - T.loop1) * 1.3);
  return [T.cx + Math.cos(a) * T.r, T.cy + Math.sin(a) * T.r, a];
}
function rocketV2(ctx, x, y, rot, rh, t, flame = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); if (flame > 0) rocketFlame(ctx, 0, rh * 0.46, rh * 0.32 * flame, t, 0);
  const rw = ROCKET.width * rh / ROCKET.height; ctx.drawImage(ROCKET, -rw / 2, -rh / 2, rw, rh); ctx.restore();
}
function cloudV2(ctx, x, y, s, a = 1) {   // 平塗雲：白底＋淡藍陰影＋描線
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(x, y); ctx.scale(s, s);
  const blob = () => { ctx.beginPath(); for (const [bx, by, br] of [[-110, 10, 62], [-40, -28, 78], [48, -14, 70], [120, 14, 54]]) { ctx.moveTo(bx + br, by); ctx.arc(bx, by, br, 0, 7); } ctx.rect(-150, 14, 300, 50); };
  ctx.fillStyle = '#b9d8f6'; ctx.save(); ctx.translate(0, 12); blob(); ctx.fill(); ctx.restore(); ctx.fillStyle = '#ffffff'; blob(); ctx.fill(); ctx.restore();
}
function spaceBG(ctx, t, warp = 0) {
  const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0c0830'); gr.addColorStop(0.6, '#2a1260'); gr.addColorStop(1, '#5a1f7a'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160);
  const nb = ctx.createRadialGradient(RK2.cx, RK2.cy, 0, RK2.cx, RK2.cy, 1100); nb.addColorStop(0, 'rgba(255,170,90,0.28)'); nb.addColorStop(0.5, 'rgba(200,80,200,0.14)'); nb.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = nb; ctx.fillRect(-80, -80, W + 160, H + 160);
  for (let i = 0; i < 130; i++) { const x = R(i, 1) * W, y = (R(i, 2) * H + warp * (300 + R(i, 5) * 900)) % H, tw = 0.55 + 0.45 * Math.sin(t * (2 + R(i, 4) * 4) + i), s = 1.5 + R(i, 3) * 2.5;
    ctx.fillStyle = `rgba(255,255,240,${0.4 + 0.6 * R(i, 3) * tw})`; if (warp > 0.02) ctx.fillRect(x, y, s, s + warp * 60); else if (i % 9 === 0) star4(ctx, x, y, 6 + s * 3 * tw, '#fff', 0.9 * tw); else ctx.fillRect(x, y, s, s); }
}
function v2RocketPre(ctx, t) {
  const T = RK2, app = eo(lin(t, 0, 0.3)), cam = sstep(lin(t, T.lift + 0.12, T.space + 0.1)), camY = cam * 2600;
  const pk = decay(t, [[T.ign, 0.4], [T.lift, 1]], 6), rumble = t > T.ign && t < T.space ? 8 + 10 * lin(t, T.ign, T.lift) : 0;
  ctx.save(); camV2(ctx, 960, 620, 1.02 + pk * 0.03); shakeAt(ctx, t, pk * 18 + rumble);
  ctx.save(); ctx.globalAlpha = app;
  if (t < T.space + 0.12) {
    const mixc = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * cam)), sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgb(${mixc([58, 140, 255], [12, 8, 48])})`); sky.addColorStop(0.65, `rgb(${mixc([150, 215, 255], [42, 18, 96])})`); sky.addColorStop(1, `rgb(${mixc([255, 244, 200], [90, 31, 122])})`); ctx.fillStyle = sky; ctx.fillRect(-80, -80, W + 160, H + 160);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 1500, 160 + camY * 0.3, 14, `rgba(255,255,220,${0.12 * (1 - cam)})`, 0.3, 1900, 0.4, 14); ctx.restore();
    for (let i = 0; i < 9; i++) cloudV2(ctx, (R(i, 4) * 2200 + t * 14 * (1 + i % 3)) % 2300 - 190, 150 + i * 170 - 900 + camY * (0.35 + (i % 3) * 0.3) % 2600, 0.8 + (i % 3) * 0.45, 0.95);
    const gy = 940 + camY;
    if (gy < H + 400) {
      ctx.fillStyle = '#58b868'; ctx.beginPath(); ctx.moveTo(-80, gy - 40); ctx.quadraticCurveTo(500, gy - 130, 1000, gy - 50); ctx.quadraticCurveTo(1500, gy - 120, W + 80, gy - 30); ctx.lineTo(W + 80, gy + 400); ctx.lineTo(-80, gy + 400); ctx.fill();
      ctx.fillStyle = '#74d67a'; ctx.fillRect(-80, gy, W + 160, 500);
      ctx.fillStyle = '#5a5a6e'; ctx.strokeStyle = '#2a2440'; ctx.lineWidth = 6; ctx.beginPath(); ctx.rect(760, gy - 34, 400, 50); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 8; ctx.strokeStyle = '#c0392b'; ctx.beginPath(); for (let k = 0; k < 6; k++) { const y0 = gy - 34 - k * 90; ctx.moveTo(1180, y0); ctx.lineTo(1260, y0 - 90); ctx.moveTo(1260, y0); ctx.lineTo(1180, y0 - 90); } ctx.moveTo(1180, gy - 34); ctx.lineTo(1180, gy - 574); ctx.moveTo(1260, gy - 34); ctx.lineTo(1260, gy - 574); ctx.stroke();
    }
    // 發射煙
    if (t > T.ign) for (let i = 0; i < 34; i++) { const l = t - (T.ign + R(i, 5) * 1.3); if (l < 0) continue; const side = R(i, 6) - 0.5, x = 960 + side * (240 + l * 900), y = gy - 20 - l * 80 * R(i, 7), r = 60 + l * 120, a = Math.max(0, 0.95 - l * 0.3);
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#cfcbd6'; ctx.beginPath(); ctx.arc(x + r * 0.12, y + r * 0.16, r, 0, 7); ctx.fill(); ctx.fillStyle = '#f8f6f2'; ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, 7); ctx.fill(); ctx.restore(); }
    const u = lin(t, T.lift, T.space), ry = 690 - 300 * sstep(lin(u, 0, 0.7)) - 1500 * ei(lin(u, 0.55, 1));
    if (t > T.lift) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(14px)'; const tr = ctx.createLinearGradient(0, ry + 200, 0, ry + 1300); tr.addColorStop(0, 'rgba(255,220,150,0.7)'); tr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = tr; ctx.fillRect(900, ry + 200, 120, 1100); ctx.restore(); }
    rocketV2(ctx, 960, ry, Math.sin(t * 40) * 0.006 * rumble / 8, 560, t, t > T.ign ? (t > T.lift ? 1.5 : 0.6 + 0.5 * lin(t, T.ign, T.lift)) : 0);
  } else {
    spaceBG(ctx, t, 1 - eo(lin(t, T.space + 0.1, T.loop0 + 0.2)));
    const u1 = Math.min(1, lin(t, T.loop0, T.loop1));   // 繞圈的光跡
    if (t > T.loop0) { ctx.save(); ctx.lineCap = 'round'; for (const [w, c] of [[60, 'rgba(255,190,80,0.3)'], [28, 'rgba(255,230,150,0.9)'], [10, '#ffffff']]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(T.cx, T.cy, T.r, Math.PI / 2, Math.PI / 2 - u1 * Math.PI * 2 - 0.0001, true); ctx.stroke(); } ctx.restore(); }
    const [rx, ry, ra] = rk2Space(t); for (let i = 1; i <= 6; i++) { const [gx, gy] = rk2Space(t - i * 0.02); ctx.save(); ctx.globalCompositeOperation = 'lighter'; star4(ctx, gx + (R(i, Math.floor(t * 60)) - 0.5) * 30, gy + (R(i + 9, Math.floor(t * 60)) - 0.5) * 30, 40 - i * 5, '#fff2a8', 0.8 - i * 0.1); ctx.restore(); }
    rocketV2(ctx, rx, ry, ra, 300, t, 1.2);
  }
  ctx.restore(); ctx.restore();
  if (t > T.ign && t < T.lift + 0.05) { const n = t < 0.65 ? '3' : t < 0.95 ? '2' : '1', st = t < 0.65 ? 0.35 : t < 0.95 ? 0.65 : 0.95; ctx.save(); ctx.globalAlpha = 1 - lin(t - st, 0.2, 0.3); wordV2(ctx, n, 1470, 420, lin(t, st, st + 0.12), { s: 2.4, fill: '#ff3a4a', rot: -0.06, stroke: '#3a0010', box: false }); ctx.restore(); }
  if (t >= T.lift && t < T.lift + 0.7) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.lift + 0.5, T.lift + 0.7); wordV2(ctx, 'LIFT OFF!!', 500, 330, lin(t, T.lift, T.lift + 0.14), { s: 1.4, fill: '#ffd21a', stroke: '#3a0010', rot: -0.05, box: false }); ctx.restore(); flash(ctx, (1 - lin(t, T.lift, T.lift + 0.14)) * 0.5, '#fff3d0'); }
}
function v2RocketFin(ctx, m, t) {
  const T = RK2;
  finaleV2(ctx, m, t, { style: 'lower', tag: 'GIFT', tGirl: 0.02, tTitle: 0.42, girl: { x: 1400, from: 'below' },   // 結尾：轉播字幕條
    bg: (c) => { spaceBG(c, t, 0); c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, T.cx, T.cy, 16, 'rgba(255,220,140,0.2)', t * 0.35, 1900, 0.42, 16); c.restore(); },
    back: (c, mm, tt, pk) => { fireworksAt(c, tt, [[T.loop1 + 0.2, 380, 220, 40], [T.loop1 + 0.55, 900, 170, 200], [T.loop1 + 1.0, 250, 560, 320], [T.loop1 + 1.5, 760, 300, 120], [T.loop1 + 2.0, 420, 380, 30]]);
      c.save(); c.lineCap = 'round'; for (const [w, col] of [[60, 'rgba(255,190,80,0.3)'], [28, 'rgba(255,230,150,0.9)'], [10, '#ffffff']]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.arc(T.cx, T.cy, T.r * (1 + pk * 0.03), 0, 7); c.stroke(); } c.restore(); haloRing(c, tt, T.cx, T.cy, T.r * 0.86, 0.8, pk); const [rx, ry, ra] = rk2Space(tt); rocketV2(c, rx, ry, ra, 240, tt, 1); } });
}
function v2Rocket(ctx, t) { if (!ROCKET) return; runV2(ctx, t, { T: RK2.loop1, exitKind: 'whipL', pre: v2RocketPre, fin: v2RocketFin }); }

// ---------------- 特大 3：舞台大幕 ----------------
function stageV2(ctx, t, lit) {
  ctx.fillStyle = '#1a0606'; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (lit > 0) { ctx.save(); ctx.globalAlpha = lit; goldBG(ctx, t, 960, 420); ctx.restore(); }
  ctx.fillStyle = '#4a2010'; ctx.beginPath(); ctx.ellipse(960, 1110, 1300, 190, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#7a3e1e'; ctx.beginPath(); ctx.ellipse(960, 1120, 1200, 160, 0, Math.PI, 0); ctx.fill();
  if (lit > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(18px)';
    [[260, '#ff6ab0', 0.42], [1660, '#5fc8ff', -0.42], [680, '#fff3c0', 0.16], [1240, '#fff3c0', -0.16]].forEach(([x, col, a], i) => { ctx.save(); ctx.translate(x, -60); ctx.rotate(a + Math.sin(t * 1.6 + i) * 0.12); const gg = ctx.createLinearGradient(0, 0, 0, 1300); gg.addColorStop(0, col); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.5 * lit; ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(34, 0); ctx.lineTo(290, 1300); ctx.lineTo(-290, 1300); ctx.fill(); ctx.restore(); });
    ctx.restore(); }
}
function curtainsV2(ctx, t, ok, gap = 0) {   // ok：開幕進度；gap：偷看時中間的縫（半寬）
  const cH = 1200, w = (1000 - gap) * (1 - 0.74 * ok) + Math.sin(t * 2.2) * 5 * (1 - ok);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40;
  ctx.drawImage(CURT_L, -40, -60, w, cH); ctx.drawImage(CURT_R, W + 40 - w, -60, w, cH); ctx.restore();
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12; ctx.drawImage(CURT_TOP, -50, -46, W + 100, 250); ctx.restore();
}
function v2CurtainPre(ctx, t) {
  const T = CU_T, app = eo5(lin(t, 0, 0.4)), pkk = t > T.peek0 && t < T.peek1 + 0.1 ? Math.sin(Math.PI * lin(t, T.peek0, T.peek1 + 0.1)) : 0, gap = 96 * pkk;
  ctx.save(); camV2(ctx, 960, 520, 1.014 + 0.07 * sstep(lin(t, T.peek0 - 0.2, T.peek1))); ctx.translate(0, (1 - app) * -1200);
  stageV2(ctx, t, 0);
  if (GIRL && pkk > 0) {   // 縫裡露出半張臉
    const gh = 2500, [fx, fy] = facePos(0, 0, gh); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(20px)'; ctx.fillStyle = `rgba(255,236,190,${0.28 * pkk})`; ctx.fillRect(960 - gap - 30, 0, gap * 2 + 60, H); ctx.restore();
    drawImg(ctx, GIRL, 975 - fx - 70 * (1 - pkk), 540 - fy, gh, -0.06);
  }
  curtainsV2(ctx, t, 0, gap);
  // 聚光燈在布幕上掃
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(28px)';
  for (const [ph, sp] of [[0, 1.3], [2, 1.7]]) { const x = 960 + Math.sin(t * sp + ph) * 620 * (1 - lin(t, T.peek0 - 0.3, T.peek0)), y = 580 + Math.cos(t * sp * 0.7 + ph) * 130, gg = ctx.createRadialGradient(x, y, 0, x, y, 320); gg.addColorStop(0, `rgba(255,245,210,${0.55 * app})`); gg.addColorStop(1, 'rgba(255,230,160,0)'); ctx.fillStyle = gg; ctx.fillRect(x - 320, y - 320, 640, 640); }
  ctx.restore(); ctx.restore();
  if (t > T.peek0 + 0.15 && t < T.peek1 + 0.25) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.peek1 + 0.05, T.peek1 + 0.25); wordV2(ctx, 'まもなく開演!', 1400, 470, lin(t, T.peek0 + 0.15, T.peek0 + 0.3), { s: 0.62, fill: '#ffe14a', rot: 0.06, stroke: '#4a0010', beat: Math.sin(t * 16) * 0.02 }); ctx.restore(); }
}
function v2CurtainFin(ctx, m, t) {
  finaleV2(ctx, m, t, { lay: 'C', tGirl: -1, tTitle: 0.95, cam: [960, 520], girl: { x: 960, y: 990, h: 1620, from: 'none' }, title: { x: 960, y: 722, maxW: 1320 }, plate: { x: 960, y: 912, sc: 0.8 }, medal: { x: 470, y: 440, sc: 0.95 }, mascot: { x: 1510, y: 520, h: 270, flip: true },
    bg: (c, mm) => stageV2(c, t, lin(mm, 0.15, 0.6)),
    front: (c, mm) => { curtainsV2(c, t, eio(lin(mm, 0, 0.7)), 0);
      for (const sx of [-1, 1]) { const q = mm - 0.55; if (q > 0 && q < 0.9) for (let i = 0; i < 30; i++) { const a = -Math.PI / 2 - sx * (0.3 + R(i, 1) * 0.5), v = 1000 + R(i, 2) * 800, x = 960 + sx * 820 + Math.cos(a) * v * q, y = 1040 + Math.sin(a) * v * q + 900 * q * q; c.fillStyle = ['#ffd24a', '#ff5a8a', '#5fc8ff', '#fff'][i % 4]; c.save(); c.translate(x, y); c.rotate(q * 12 + i); c.fillRect(-10, -5, 20, 10); c.restore(); } } } });
  if (m >= 0.55) flash(ctx, (1 - lin(m, 0.55, 0.7)) * 0.4, '#fff6d0');
}
function v2Curtain(ctx, t) { if (!CURT_L) return; runV2(ctx, t, { T: CU_T.open, cut: false, exitKind: 'smear', pre: v2CurtainPre, fin: v2CurtainFin }); }

// ---------------- 特大 4：十連抽 ----------------
const TP2 = { deal: 0.3, flip0: 1.25, step: 0.14, conf: 2.55, fly: 3.35, flip: 3.7, CH: 380 };
function tp2Pos(i) { return [960 + (i % 5 - 2) * 300, i < 5 ? 315 : 745]; }
function cardV2(ctx, x, y, h, rot, fk, kind, t, o = {}) {   // fk：翻面進度 0（背面）→1（正面）
  const sq = Math.abs(Math.cos(Math.PI * fk)) || 0.001, lift = Math.sin(Math.PI * clamp(fk));
  ctx.save(); ctx.globalAlpha *= o.a ?? 1; ctx.translate(x, y - lift * h * 0.05); ctx.rotate(rot); ctx.scale(sq * (1 + lift * 0.06), 1 + lift * 0.06);
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 50; } else { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = h * 0.06; ctx.shadowOffsetY = h * 0.03; }
  if (fk < 0.5) { const bw = CARD_BACK.width * h / CARD_BACK.height; ctx.drawImage(CARD_BACK, -bw / 2, -h / 2, bw, h); }
  else { ctx.shadowColor = 'transparent'; const r = cardFace(ctx, kind === 'ssr' ? 'ssr' : 'r', h, t, kind);
    if (kind === 'ssr' && r && (o.name ?? 0) > 0) { ctx.globalAlpha *= o.name; ctx.font = `900 ${Math.round(h * 0.06)}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a3000'; ctx.fillText(P.name, 0, r.plateY, r.w * 0.56); } }
  ctx.restore();
}
function tp2Others(ctx, t, a, spread = 0) {   // 另外 9 張（結尾退到背景）
  const T = TP2;
  for (let i = 0; i < 9; i++) { const [tx, ty] = tp2Pos(i), dk = eback(lin(t, T.deal + i * 0.06, T.deal + i * 0.06 + 0.35), 1.3); if (dk <= 0) continue;
    const fk = lin(t, T.flip0 + i * T.step, T.flip0 + i * T.step + 0.2), x = 960 + (tx - 960) * dk * (1 + spread * 0.25), y = 1500 - (1500 - ty) * dk + (ty - 540) * spread * 0.2;
    cardV2(ctx, x, y, T.CH, (1 - dk) * (i % 2 ? 0.5 : -0.5) + spread * (i % 2 ? 0.08 : -0.08), fk, i % 2 ? 'r2' : 'r1', t, { a });
    if (fk > 0 && fk < 1) sparkBurst(ctx, x, y, (t - T.flip0 - i * T.step) * 1.5, 8, 0.7, '#cfe8ff'); }
}
function magicCircle(ctx, t, x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.42); ctx.rotate(t * 0.6); ctx.strokeStyle = `rgba(210,180,255,${a})`; ctx.lineWidth = 7; for (const r of [820, 760, 480]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i * Math.PI / 6); star4(ctx, 0, -790, 26, '#e8dcff', a); ctx.restore(); } ctx.restore();
}
function v2TenPre(ctx, t) {
  const T = TP2, app = eo(lin(t, 0, 0.3)), conf = lin(t, T.conf, T.fly), fly = eio(lin(t, T.fly, T.flip)), [lx, ly] = tp2Pos(9), l = t - T.flip;
  const pk = decay(t, [[T.conf, 0.5], [T.flip, 1]], 10), zk = sstep(conf) * (1 - fly);
  ctx.save(); camV2(ctx, mixv(960, lx, zk * 0.8), mixv(540, ly, zk * 0.8), 1.014 + 0.4 * zk + pk * 0.04); shakeAt(ctx, t, pk * 22 + conf * (1 - fly) * 6);
  ctx.save(); ctx.globalAlpha = app; const bg = ctx.createRadialGradient(960, 540, 0, 960, 540, 1300); bg.addColorStop(0, '#42207a'); bg.addColorStop(1, '#0a0420'); ctx.fillStyle = bg; ctx.fillRect(-80, -80, W + 160, H + 160); magicCircle(ctx, t, 960, 580, 0.45 + 0.4 * conf); ctx.restore();
  const sx = mixv(lx, 960, fly), sy = mixv(ly, 540, fly);
  if (conf > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(ctx, sx, sy, 6, `hsla(${(h * 60 + t * 200) % 360},100%,60%,${0.13 * conf})`, t * 1.2 + h * 0.5, 1900, 0.4, 14); ctx.restore(); }
  tp2Others(ctx, t, 1 - 0.6 * Math.max(conf * 0.6, fly), fly);
  const dk = eback(lin(t, T.deal + 0.54, T.deal + 0.89), 1.3);
  if (dk > 0) { const jit = conf * (1 - fly), fk = lin(t, T.flip, T.flip + 0.24);
    cardV2(ctx, 960 + (sx - 960) * dk + Math.sin(t * 60) * 7 * jit, 1500 - (1500 - sy) * dk, T.CH * (1 + 0.06 * jit + 0.7 * fly), (1 - dk) * 0.5 + Math.sin(t * 47) * 0.035 * jit, fk, 'ssr', t, { glow: conf > 0 ? `hsla(${(t * 300) % 360},100%,70%,${conf})` : null, name: lin(l, 0.2, 0.4) }); }
  if (l >= 0) { ringBurst(ctx, 960, 540, l, { r1: 1500, dur: 0.45 }); sparkBurst(ctx, 960, 500, l, 24, 2.4, '#fff6c0'); }
  ctx.restore();
  if (conf > 0 && t < T.flip) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.flip - 0.12, T.flip); wordV2(ctx, 'SSR 激アツ!!', 700, 180, lin(t, T.conf, T.conf + 0.15), { s: 1.0, fill: rainbowFill(ctx, -70, 70, t), rot: -0.05, beat: Math.sin(t * 24) * 0.03 }); ctx.restore(); }
  if (l >= 0) flash(ctx, (1 - lin(l, 0, 0.16)) * 0.75, '#fff3c0');
}
function v2TenFin(ctx, m, t) {
  const T = TP2;
  finaleV2(ctx, m, t, { lay: 'R', tTitle: 0.48, girl: { h: 0 }, title: { x: 1340, y: 310, maxW: 1020 }, plate: { x: 1350, y: 610, sc: 1.02 }, medal: { x: 1180, y: 880, sc: 0.9 }, mascot: false,
    bg: (c, mm) => { const bg0 = c.createRadialGradient(960, 540, 0, 960, 540, 1300); bg0.addColorStop(0, '#42207a'); bg0.addColorStop(1, '#0a0420'); c.fillStyle = bg0; c.fillRect(-80, -80, W + 160, H + 160); c.save(); c.globalAlpha = eo(lin(mm, 0, 0.4)); goldBG(c, t, 540, 540, 0.12); c.restore(); c.save(); c.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(c, 540, 545, 6, `hsla(${(h * 60 + t * 160) % 360},100%,60%,0.09)`, t * 0.7 + h * Math.PI / 18, 1900, 0.45, 14); c.restore(); },
    back: (c, mm) => { c.save(); c.translate((540 - 960) * eio(lin(mm, 0, 0.45)), 0); tp2Others(c, t, 0.4 * (1 - 0.6 * lin(mm, 0, 0.5)), 1 + eo(lin(mm, 0, 0.5)) * 0.6); c.restore(); },
    mid: (c, mm, tt, pk) => { const e = eio(lin(mm, 0, 0.45)); cardV2(c, mixv(960, 540, e), mixv(540, 548, e) + Math.sin(tt * 1.7) * 7, mixv(T.CH * 1.7, 900, e) * (1 + pk * 0.015), -0.06 * e + Math.sin(tt * 1.3) * 0.012, 1, 'ssr', tt, { name: 1 }); sparkleField(c, tt, 26, 120, 60, 960, 1030, 1); } });
}
function v2Ten(ctx, t) { if (!CARD_BACK) return; runV2(ctx, t, { T: TP2.flip + 0.42, cut: false, exitKind: 'slice', pre: v2TenPre, fin: v2TenFin }); }

VARS.g25[1] = { name: '寶箱', fn: v2Chest, dur: 6.6 };
VARS.g25[2] = { name: '火箭', fn: v2Rocket, dur: 7.0 };
VARS.g25[3] = { name: '舞台大幕', fn: v2Curtain, dur: 6.4 };
VARS.g25[4] = { name: '十連抽', fn: v2Ten, dur: 7.4 };
