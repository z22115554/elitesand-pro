
// ======================= V2 頂級（g100）：時間逆轉／宇宙創世／巨大化／全回轉 =======================
// 頂級共用結尾：對稱構圖、光之翼、雙吉祥物、×N 徽章、PREMIUM 章、煙火、上下跑馬燈
function premiumFinV2(ctx, m, t, o = {}) {
  const st = !!o.style && o.style !== 'hero';   // 其他構圖：不套對稱版面的位置，也不放光之翼和左右吉祥物
  const base = { lay: 'C', tGirl: 0.1, tTitle: 0.62, bgC: [960, 420], confettiN: 210, mascot: false,
    girl: { x: 960, h: 1650, from: 'below' }, title: { x: 960, y: 640, maxW: 1500, s: 1.05, depth: 20 }, plate: { x: 960, y: 844, sc: 0.78 }, medal: { x: 320, y: 275, sc: 1.05 } };
  const merged = st ? Object.assign({ tGirl: 0.1, tTitle: 0.62, bgC: [960, 420], confettiN: 210, mascot: false }, o)
    : Object.assign({}, base, o, { girl: Object.assign({}, base.girl, o.girl), title: Object.assign({}, base.title, o.title), plate: Object.assign({}, base.plate, o.plate), medal: Object.assign({}, base.medal, o.medal) });
  const seal = o.seal || [1590, 268];
  finaleV2(ctx, m, t, Object.assign(merged, {
    back: (c, mm, tt, pk) => {
      if (o.back) o.back(c, mm, tt, pk);
      c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 960, 380, 18, 'rgba(255,255,255,0.2)', tt * 0.4, 2100, 0.4, 16); c.restore();
      fireworksAt(c, mm, [[0.4, 300, 250, 30], [0.7, 1620, 230, 200], [1.1, 620, 150, 300], [1.5, 1300, 160, 120], [1.9, 240, 520, 60], [2.3, 1680, 520, 260], [2.8, 960, 120, 180], [3.2, 420, 300, 330]]);
      if (!st && o.wings !== false) { c.save(); c.translate(960, (o.girl && o.girl.wy) || 450); c.scale(1.75, 1.75); wings(c, tt, 0, 0, eo(lin(mm, 0.15, 0.65)), 1); c.restore(); }
    },
    front: (c, mm, tt, pk) => {
      if (!st && o.twins !== false) { mascotV2(c, tt, lin(mm, 1.25, 1.55), 205, 810, 290); mascotV2(c, tt, lin(mm, 1.35, 1.65), 1715, 810, 290, true); }
      premiumSeal(c, tt, seal[0], seal[1], lin(mm, 1.45, 1.63), pk);
      if (o.front) o.front(c, mm, tt, pk);
    } }));
}

// ---------------- 頂級 1：時間逆轉 ----------------
function clockV2(ctx, cx, cy, size, spin, ghost = 0) {   // 鐘面＋時針分針（spin = 分針角度）
  const cw = CLOCK_FACE.width * size / CLOCK_FACE.height;
  ctx.save(); ctx.translate(cx, cy); ctx.drawImage(CLOCK_FACE, -cw * CLOCK_GEO.cx, -size * CLOCK_GEO.cy, cw, size);
  for (const [img, gq, mul, gh] of [[CLOCK_HOUR, CLOCK_GEO.hour, 1 / 12, 0], [CLOCK_MIN, CLOCK_GEO.min, 1, 1]]) {
    const hh = size * gq[2] / gq[1], hw = img.width * hh / img.height, n = gh ? ghost : 0;
    for (let k = n; k >= 0; k--) { ctx.save(); ctx.globalAlpha *= k ? 0.18 : 1; ctx.rotate(spin * mul + k * 0.12); ctx.drawImage(img, -hw * gq[0], -hh * gq[1], hw, hh); ctx.restore(); }
  }
  ctx.restore();
}
function v2RewindPre(ctx, t) {
  const T = TR_T, app = eo(lin(t, 0, 0.25)), rw = lin(t, T.rew, T.slow);
  let spin = 0; if (t > T.rew) { spin = -(rw * rw * 22 * Math.PI); if (t > T.slow) spin = -(22 * Math.PI) - eo5(lin(t, T.slow, T.stop)) * 2 * Math.PI; }
  const pk = decay(t, [[T.freeze, 0.5], [T.stop, 1]], 9);
  ctx.save(); camV2(ctx, 960, 560, 1.014 + 0.12 * sstep(rw) + pk * 0.04); shakeAt(ctx, t, pk * 18 + (t > T.rew && t < T.stop ? rw * 9 : 0));
  ctx.save(); ctx.globalAlpha = app;
  if (t < T.rew) { ctx.fillStyle = '#16122a'; ctx.fillRect(-80, -80, W + 160, H + 160); fakeNotice(ctx, Math.min(t, T.freeze)); if (t > T.freeze) { ctx.fillStyle = `rgba(20,10,40,${0.6 * lin(t, T.freeze, T.rew)})`; ctx.fillRect(-80, -80, W + 160, H + 160); } }
  else {
    const gg = ctx.createRadialGradient(960, 560, 0, 960, 560, 1300); gg.addColorStop(0, '#4a34a0'); gg.addColorStop(1, '#06031a'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 110; i++) { const a = R(i, 1) * 7 - t * (0.6 + R(i, 2)), q = (R(i, 3) + t * 0.6) % 1, r = 1200 * (1 - q); star4(ctx, 960 + Math.cos(a) * r, 560 + Math.sin(a) * r * 0.7, 6 + 14 * q, '#cfe0ff', 0.75 * q); } ctx.restore();   // 時間粒子往中心吸
    ctx.save(); ctx.translate(960, 560); ctx.rotate(-t * 1.4 * lin(t, T.rew, T.rew + 0.5)); ctx.font = "700 110px 'Noto Serif', serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(200,190,255,0.2)';
    ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((n, i) => { ctx.save(); ctx.rotate(i * Math.PI / 6); ctx.fillText(n, 0, -820); ctx.restore(); }); ctx.restore();
  }
  ctx.restore();
  if (t > T.rew - 0.1) { const ck = eback(lin(t, T.rew - 0.1, T.rew + 0.35), 1.4); ctx.save(); ctx.shadowColor = 'rgba(255,220,120,0.7)'; ctx.shadowBlur = 50 + 40 * rw; clockV2(ctx, 960, 560, 920 * ck, spin, t > T.rew + 0.5 && t < T.slow ? 4 : 0); ctx.restore();
    if (t >= T.stop) ringBurst(ctx, 960, 560, t - T.stop, { r0: 400, r1: 1100, dur: 0.4, sq: 1, w: 24 }); }
  ctx.restore();
  if (t > T.freeze) {   // 錄影帶倒帶介面
    const k = lin(t, T.freeze, T.freeze + 0.1); hudText(ctx, '◀◀ REWIND', 90, 96, 64, '#ffffff', 'left', k * (Math.floor(t * 3) % 2 ? 1 : 0.6));
    if (t < T.stop) { ctx.save(); ctx.globalAlpha = 0.5 * k; for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(0, (t * 900 + i * 300) % (H + 100) - 50, W, 12 + i * 6); } ctx.restore(); }
    const c = Math.max(0, Math.round(100 * (1 - lin(t, T.rew, T.stop)))); hudText(ctx, `-0${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`, W - 90, 96, 64, '#ffffff', 'right', k);
  }
  if (t >= T.stop) wordV2(ctx, '0:00', 960, 560, lin(t, T.stop, T.stop + 0.12), { s: 1.35, big: 3, fill: '#bff4ff', rot: -0.04, stroke: '#0a1450', depth: 12 });
}
function v2RewindFin(ctx, m, t) {
  premiumFinV2(ctx, m, t, { wings: false, back: (c, mm, tt, pk) => { const k = eo5(lin(mm, 0, 0.6)); c.save(); c.globalAlpha = 0.95; c.translate(960, mixv(560, 430, k)); c.rotate(tt * 0.15); c.shadowColor = 'rgba(255,230,140,0.9)'; c.shadowBlur = 70; const size = mixv(2400, 1260, k) * (1 + pk * 0.02), cw = CLOCK_FACE.width * size / CLOCK_FACE.height; c.drawImage(CLOCK_FACE, -cw / 2, -size / 2, cw, size); c.restore(); coinFountain(c, mm, 0, 3.4, 190); } });
}
function v2Rewind(ctx, t) { if (!CLOCK_FACE) return; runV2(ctx, t, { T: TR_T.burst, cutA: 0.95, exitKind: 'crt', pre: v2RewindPre, fin: v2RewindFin }); }

// ---------------- 頂級 2：宇宙創世 ----------------
function galaxyV2(ctx, t, l, sw, a = 1, cy = 540) {   // 爆炸粒子 → 捲成三條旋臂的星系
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const e = sstep(sw);
  for (let i = 0; i < 1300; i++) {
    const arm = i % 3, rr = Math.pow(R(i, 1), 0.7), a0 = R(i, 2) * Math.PI * 2, d0 = Math.min(1, l * 1.6) * 1300 * R(i, 3);
    const ga = arm * Math.PI * 2 / 3 + rr * 5.5 - t * 0.5 + (R(i, 4) - 0.5) * 0.6 * (1 - rr * 0.4), gd = 60 + rr * 720 + (R(i, 6) - 0.5) * 80;
    const x0 = 960 + Math.cos(a0) * d0, y0 = cy + Math.sin(a0) * d0 * 0.8, x1 = 960 + Math.cos(ga) * gd, y1 = cy + Math.sin(ga) * gd * 0.5;
    const s = 4 + 9 * R(i, 5) * (1 - rr * 0.5);
    ctx.fillStyle = `hsla(${(200 + arm * 70 + rr * 80 + t * 20) % 360},100%,${70 + 20 * (1 - rr)}%,${0.85 * a})`; ctx.fillRect(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, s, s);
  }
  if (sw > 0) { const gg = ctx.createRadialGradient(960, cy, 0, 960, cy, 380); gg.addColorStop(0, `rgba(255,250,230,${0.9 * sw * a})`); gg.addColorStop(1, 'rgba(255,200,255,0)'); ctx.fillStyle = gg; ctx.fillRect(580, cy - 380, 760, 760); }
  ctx.restore();
}
function planetsV2(ctx, t, k) {
  if (k <= 0) return;
  for (const [px, py, pr, hue, ring] of [[330, 250, 84, 20, 1], [1630, 290, 62, 200, 0], [1560, 830, 104, 300, 1], [280, 830, 54, 120, 0]]) {
    const r = pr * eback(k, 1.6); ctx.save(); ctx.translate(px, py + Math.sin(t * 1.5 + px) * 10);
    const rg = (a0, a1) => { ctx.strokeStyle = `hsl(${hue + 40},90%,75%)`; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.45, -0.3, a0, a1); ctx.stroke(); };
    if (ring) rg(Math.PI, 0);
    ctx.fillStyle = `hsl(${hue},85%,62%)`; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.save(); ctx.clip(); ctx.fillStyle = `hsl(${hue},80%,44%)`; ctx.beginPath(); ctx.arc(r * 0.35, r * 0.4, r * 0.95, 0, 7); ctx.fill(); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.26, r * 0.16, -0.6, 0, 7); ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#1a0838'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    if (ring) rg(0, Math.PI); ctx.restore(); }
}
function v2CosmosPre(ctx, t) {
  const T = CS_T, app = eo(lin(t, 0, 0.2)), banged = t >= T.bang, l = t - T.bang, pk = decay(t, [...T.beat.map((b, i) => [b, 0.25 + i * 0.15]), [T.bang, 1]], 7);
  ctx.save(); camV2(ctx, 960, 540, 1.02 + pk * 0.07 + (banged ? 0.1 * (1 - eo(lin(l, 0, 1.2))) : 0.12 * lin(t, 0, T.bang))); shakeAt(ctx, t, pk * 26);
  ctx.fillStyle = `rgba(0,0,5,${app})`; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (!banged) {   // 一個光點心跳三下，越跳越大
    let p = 0.3; T.beat.forEach((b, i) => { const q = t - b; if (q > 0) p += Math.exp(-q * 6) * (0.9 + i * 0.5); }); const r = 16 + 40 * p;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createRadialGradient(960, 540, 0, 960, 540, r * 6); gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(0.15, 'rgba(255,240,200,0.8)'); gg.addColorStop(1, 'rgba(120,80,255,0)'); ctx.fillStyle = gg; ctx.fillRect(960 - r * 6, 540 - r * 6, r * 12, r * 12); star4(ctx, 960, 540, r * 3, '#fff', 0.9); ctx.restore();
    T.beat.forEach((b) => ringBurst(ctx, 960, 540, t - b, { r0: 30, r1: 500, dur: 0.4, sq: 1, w: 8, col: 'rgba(200,190,255,1)' }));
  } else {
    galaxyV2(ctx, t, l, lin(t, T.galaxy, T.galaxy + 1.1));
    for (let i = 0; i < 3; i++) ringBurst(ctx, 960, 540, l - i * 0.12, { r0: 60, r1: 1700, dur: 1.0, sq: 1, w: 34, col: `hsl(${(i * 80 + 200) % 360},100%,80%)` });
    planetsV2(ctx, t, lin(t, T.galaxy + 0.6, T.galaxy + 1.2));
  }
  ctx.restore();
  if (t > T.galaxy && t < T.form) { ctx.save(); ctx.globalAlpha = lin(t, T.galaxy, T.galaxy + 0.3) * (1 - lin(t, T.form - 0.3, T.form)); inkText(ctx, '新しい宇宙が、生まれる——', 960, 965, 70, '#e8f4ff', '#0a1450'); ctx.restore(); }
  if (banged) flash(ctx, (1 - lin(l, 0, 0.35)) * 0.95, '#fff');
}
function v2CosmosFin(ctx, m, t) {   // 結尾：漫畫三分格
  premiumFinV2(ctx, m, t, { style: 'manga', seal: [330, 846], mascot: {},
    bg: (c, mm) => { c.fillStyle = '#05021a'; c.fillRect(-80, -80, W + 160, H + 160); galaxyV2(c, t, 9, 1, 0.9, 540); } });
}
function v2Cosmos(ctx, t) { runV2(ctx, t, { T: CS_T.form, cutA: 0.75, exitKind: 'iris', pre: v2CosmosPre, fin: v2CosmosFin }); }

// ---------------- 頂級 3：巨大化 ----------------
function searchlights(ctx, t, a, swing = 1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)'; for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(250 + i * 470, 1090); ctx.rotate(Math.sin(t * 1.3 + i * 1.7) * 0.5 * swing); const lg = ctx.createLinearGradient(0, 0, 0, -1400); lg.addColorStop(0, `rgba(255,240,200,${a})`); lg.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.lineTo(170, -1400); ctx.lineTo(-170, -1400); ctx.fill(); ctx.restore(); } ctx.restore(); }
function skylineV2(ctx, t, o) {   // o: seed, n, prof(xc)→高度, cols, lit, boards, win
  const n = o.n, bw = (W + 200) / n;
  for (let i = 0; i < n; i++) {
    const w = bw * (0.82 + R(i, o.seed + 1) * 0.3), x = -100 + i * bw + R(i, o.seed + 2) * 20, h = o.prof(x + w / 2, i), y = 1080 - h;
    ctx.fillStyle = o.cols[i % o.cols.length]; ctx.fillRect(x, y, w, h + 20); ctx.strokeStyle = o.line; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h + 20);
    if (o.win) for (let wy = y + 22; wy < 1066; wy += 40) for (let wx = x + 16; wx < x + w - 22; wx += 30) { const on = R(i * 97 + Math.round(wx), Math.round(wy) + o.seed) < 0.25 + 0.7 * o.lit; ctx.fillStyle = on ? (R(Math.round(wx), Math.round(wy) + i) < 0.5 ? o.win[0] : o.win[1]) : o.win[2]; ctx.fillRect(wx, wy, 16, 22); }
    if (o.boards && o.boards.includes(i) && o.lit > 0.5 && h > 260) { ctx.fillStyle = '#05030c'; ctx.fillRect(x + 8, y + 30, w - 16, 96); ctx.save(); ctx.beginPath(); ctx.rect(x + 12, y + 34, w - 24, 88); ctx.clip(); rainbowBG2(ctx, t * 2.2, x + w / 2, y + 78); smallTitle(ctx, t, '×' + CFG.n, x + w / 2, y + 80, 46, PAL.gold, 'center'); ctx.restore(); }
  }
  ctx.fillStyle = o.line; ctx.fillRect(-100, 1072, W + 200, 100);
}
function cityFar(ctx, t, lit) {   // 角色後面：比較淡、比較高的一排
  skylineV2(ctx, t, { seed: 40, n: 19, lit: lit * 0.6, line: '#1a1446', cols: ['#2c2468', '#342a74', '#28205e'], win: ['#c9b46a', '#b98ac0', '#221a58'], prof: (xc, i) => 330 + R(i, 43) * 330 });
  ctx.fillStyle = 'rgba(60,40,120,0.35)'; ctx.fillRect(-100, 380, W + 200, 800);   // 空氣感：遠景壓淡
}
function cityNear(ctx, t, lit) {   // 角色前面：中間矮（一開始看得到角色）、兩側高
  skylineV2(ctx, t, { seed: 7, n: 16, lit, boards: [1, 3, 12, 14], line: '#0a0620', cols: ['#1e1846', '#241c50', '#1a1440', '#2a2058'], win: ['#ffe28a', '#ffb0e0', '#1a1240'],
    prof: (xc, i) => { const d = Math.min(1, Math.abs(xc - 960) / 760); return 120 + 40 * R(i, 9) + (300 + 240 * R(i, 10)) * Math.pow(d, 1.5); } });
}
const GI2 = { h0: 300, h1: 2050, faceY: 420 };
function giantGeo(gk) { const gh = GI2.h0 + (GI2.h1 - GI2.h0) * gk, gy = 1062 - gh / 2 + (GI2.faceY - FACE.y * GI2.h1 + GI2.h1 - 1062) * gk; return [gh, gy]; }
function v2GiantPre(ctx, t) {
  const T = GI_T, app = eo(lin(t, 0, 0.3)), gk = sstep(lin(t, T.grow0, T.grow1)), growing = t > T.grow0;
  ctx.save(); camV2(ctx, 960, 860, 1.03 + (1 - gk) * 0.3 * sstep(lin(t, 0.2, T.grow0))); shakeAt(ctx, t, growing ? 6 + 16 * gk : 0);
  ctx.save(); ctx.globalAlpha = app; const gg = ctx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#0a0830'); gg.addColorStop(1, '#3a1a5a'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160);
  for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(255,255,240,${0.5 * R(i, 3)})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * 560, 3, 3); }
  cityFar(ctx, t, lin(t, T.grow0, T.grow1)); searchlights(ctx, t, 0.35 + 0.2 * gk);
  if (GIRL) { const [gh, gy] = giantGeo(gk), ak = eback(lin(t, T.appear, T.appear + 0.3), 1.6); if (ak > 0) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const sp = ctx.createRadialGradient(960, gy, 0, 960, gy, gh * 0.9); sp.addColorStop(0, `rgba(255,245,200,${0.4 * (1 - gk)})`); sp.addColorStop(1, 'rgba(255,245,200,0)'); ctx.fillStyle = sp; ctx.fillRect(960 - gh, gy - gh, gh * 2, gh * 2); ctx.restore();
    const hh = gh * ak, yy = 1062 - (1062 - gy) * ak; if (gk > 0) neonOutline(ctx, GIRL_SIL, 960, yy, hh, t, 0); else outlineV2(ctx, GIRL_SIL, 960, yy, hh, 0, '#fff', 4, 12); drawImg(ctx, GIRL, 960, yy, hh, 0); } }
  cityNear(ctx, t, lin(t, T.grow0, T.grow1));
  ctx.restore(); ctx.restore();
  if (t > T.appear + 0.2 && !growing) wordV2(ctx, '…あれ?', 1290, 760, lin(t, T.appear + 0.2, T.appear + 0.36), { s: 0.55, fill: '#bff4ff', rot: 0.05, stroke: '#0a1450' });
  if (growing) wordV2(ctx, 'ゴゴゴゴ…', 960, 170, lin(t, T.grow0, T.grow0 + 0.15), { s: 0.9 + 0.5 * gk, fill: Math.floor(t * 8) % 2 ? '#ff3a4a' : '#ffb21a', rot: -0.04 + Math.sin(t * 40) * 0.01, stroke: '#2a0010', beat: Math.sin(t * 30) * 0.03 });
}
function v2GiantFin(ctx, m, t) {
  const [gh, gy] = giantGeo(1);
  premiumFinV2(ctx, m, t, { tGirl: -1, tTitle: 0.45, twins: false, cam: [960, 420], girl: { x: 960, y: gy, h: gh, from: 'none', wy: 520 }, title: { y: 676, s: 0.95 }, plate: { y: 0, sc: 0 }, medal: { x: 300, y: 275 }, bgC: [960, 400],
    bg: (c, mm) => { const gg = c.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#4a1a8a'); gg.addColorStop(1, '#ff7ab8'); c.fillStyle = gg; c.fillRect(-80, -80, W + 160, H + 160); c.save(); c.globalAlpha = lin(mm, 0, 0.5); rainbowBG2(c, t * 2.2, 960, 400); c.fillStyle = 'rgba(20,0,50,0.22)'; c.fillRect(-80, -80, W + 160, H + 160); c.restore(); cityFar(c, t, 1); searchlights(c, t, 0.4, 0.4); },
    mid: (c, mm, tt) => { cityNear(c, tt, 1); const gr = c.createLinearGradient(0, 600, 0, 1080); gr.addColorStop(0, 'rgba(10,0,40,0)'); gr.addColorStop(1, 'rgba(10,0,40,0.5)'); c.fillStyle = gr; c.fillRect(-80, 600, W + 160, 600); },
    front: (c, mm, tt) => plateV2(c, tt, eo(lin(mm, 0.75, 0.95)), 960, 848, 0.68) });
}
function v2Giant(ctx, t) { runV2(ctx, t, { T: GI_T.grow1, cutA: 0.7, exitKind: 'slice', pre: v2GiantPre, fin: v2GiantFin }); }

// ---------------- 頂級 4：全回轉 ----------------
function reelsV2(ctx, t, fx, fy, o = {}) {   // 三個捲軸，全部都是同一個角色圖案在轉
  const T = ZK_T, rw = 330, rh = 660, gap = 36, sym = 220;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 50; ctx.fillStyle = '#1a0828'; ctx.beginPath(); ctx.roundRect(fx - 610, fy - 395, 1220, 790, 44); ctx.fill(); ctx.restore();
  ctx.lineWidth = 16; const fg = ctx.createLinearGradient(0, fy - 395, 0, fy + 395); fg.addColorStop(0, '#ffe08a'); fg.addColorStop(1, '#c87a00'); ctx.strokeStyle = fg; ctx.beginPath(); ctx.roundRect(fx - 610, fy - 395, 1220, 790, 44); ctx.stroke();
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 44; i++) { const u = i / 44, per = 2 * (1220 + 790), d = u * per; let x, y; if (d < 1220) { x = fx - 610 + d; y = fy - 395; } else if (d < 2010) { x = fx + 610; y = fy - 395 + d - 1220; } else if (d < 3230) { x = fx + 610 - (d - 2010); y = fy + 395; } else { x = fx - 610; y = fy + 395 - (d - 3230); }
    const on = ((i - Math.floor(t * 24)) % 4 + 4) % 4 < 2 ? 1 : 0.25, gr = ctx.createRadialGradient(x, y, 0, x, y, 22); gr.addColorStop(0, `hsla(${(i * 12 + t * 400) % 360},100%,85%,${on})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(x - 22, y - 22, 44, 44); } ctx.restore();
  for (let r = 0; r < 3; r++) {
    const x = fx + (r - 1) * (rw + gap), stopT = T.stop[r]; let pos;
    if (t < T.spin) pos = 0; else if (t < stopT) { const u = t - T.spin; pos = u * 9 + u * u * 4; } else { const ps = Math.ceil((stopT - T.spin) * 9 + Math.pow(stopT - T.spin, 2) * 4); pos = ps - (1 - eback(lin(t, stopT, stopT + 0.28), 2.4)) * 0.35; }
    const spinning = t > T.spin && t < stopT, fr = ((pos % 1) + 1) % 1;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x - rw / 2, fy - rh / 2, rw, rh, 20); ctx.clip(); ctx.fillStyle = '#fff6fb'; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh);
    for (let k = -3; k <= 2; k++) { const y = fy + (k + fr) * sym * 1.25; ctx.save(); ctx.globalAlpha = spinning ? 0.75 : 1; ctx.translate(x, y); if (spinning) ctx.scale(1, 1.3); ctx.drawImage(zkFace(), -sym / 2, -sym / 2, sym, sym); ctx.restore(); }
    const sh = ctx.createLinearGradient(0, fy - rh / 2, 0, fy + rh / 2); sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(0.25, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.5)'); ctx.fillStyle = sh; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh);
    ctx.restore();
    if (t >= stopT && t < stopT + 0.3) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,220,${0.6 * (1 - (t - stopT) / 0.3)})`; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh); ctx.restore(); }
  }
  if (t >= T.stop[2]) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `hsla(${(t * 400) % 360},100%,70%,0.9)`; ctx.lineWidth = 10; ctx.shadowColor = '#fff'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.moveTo(fx - 560, fy); ctx.lineTo(fx + 560, fy); ctx.stroke(); ctx.restore(); }
}
function v2ZenPre(ctx, t) {
  const T = ZK_T, app = eo(lin(t, 0, 0.3)), all = t >= T.all, l = t - T.all;
  const pk = decay(t, [[T.spin, 0.5], [T.stop[0], 0.5], [T.stop[1], 0.65], [T.stop[2], 0.8], [T.all, 1]], 10), zk = sstep(lin(t, T.spin + 0.6, T.stop[2])) * (all ? 1 - eo(lin(l, 0, 0.3)) : 1);
  ctx.save(); camV2(ctx, 960, 520, 1.014 + 0.14 * zk + pk * 0.045); shakeAt(ctx, t, pk * 22 + (t > T.spin && !all ? 3 + 5 * zk : 0));
  ctx.save(); ctx.globalAlpha = app;
  if (!all) { const gg = ctx.createRadialGradient(960, 520, 0, 960, 520, 1300); gg.addColorStop(0, '#6a0a44'); gg.addColorStop(1, '#0a0210'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160);
    if (t > T.spin) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(ctx, 960, 520, 6, `hsla(${(h * 60 + t * 240) % 360},100%,60%,0.11)`, t * 1.5 + h * 0.5, 1900, 0.35, 14); ctx.restore(); } }
  else rainbowBG2(ctx, t * 2.2, 960, 520);
  ctx.restore();
  ctx.save(); ctx.translate(0, (1 - eback(lin(t, 0, 0.45), 1.3)) * 1200); reelsV2(ctx, t, 960, 520); ctx.restore();
  if (all) { ringBurst(ctx, 960, 520, l, { r1: 1600, dur: 0.5 }); coinFountain(ctx, t, T.all, T.all + 1.4, 110); }
  ctx.restore();
  if (t > T.spin && !all) wordV2(ctx, t < T.stop[0] ? 'プレミアム…!?' : '全部そろう…!?', 960, 985, 1, { s: 0.62, pop: false, fill: Math.floor(t * 10) % 2 ? '#ff3a8c' : '#ffe14a', rot: -0.02, stroke: '#2a0030', beat: Math.sin(t * 26) * 0.03 });
  if (all) { const gg = ctx.createLinearGradient(0, -80, 0, 80); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffc21a'); gg.addColorStop(1, '#e07800');
    wordV2(ctx, '全回転!!', 960, 520, lin(l, 0, 0.16), { s: 2.3, big: 3.2, fill: gg, rot: -0.07, stroke: '#3a1400', depth: 16, beat: Math.sin(t * 20) * 0.02 }); flash(ctx, (1 - lin(l, 0, 0.2)) * 0.85, '#fff'); }
}
function v2ZenFin(ctx, m, t) {   // 結尾：巨大數字
  premiumFinV2(ctx, m, t, { style: 'count', seal: [330, 840], mascot: {}, back: (c, mm, tt) => { c.save(); c.globalAlpha = 0.4 * (1 - 0.5 * lin(mm, 0, 0.6)); camV2(c, 960, 520, 1.25); reelsV2(c, tt, 960, 480); c.restore(); c.fillStyle = 'rgba(30,0,60,0.12)'; c.fillRect(-80, -80, W + 160, H + 160); coinFountain(c, mm, 0, 3.4, 220); } });
}
function v2Zen(ctx, t) { runV2(ctx, t, { T: ZK_T.all + 1.0, exitKind: 'smear', pre: v2ZenPre, fin: v2ZenFin }); }

VARS.g100[1] = { name: '時間逆轉', fn: v2Rewind, dur: 8.6 };
VARS.g100[2] = { name: '宇宙創世', fn: v2Cosmos, dur: 9.0 };
VARS.g100[3] = { name: '巨大化', fn: v2Giant, dur: 8.2 };
VARS.g100[4] = { name: '全回轉', fn: v2Zen, dur: 9.4 };
