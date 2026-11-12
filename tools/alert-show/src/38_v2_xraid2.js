
// ======================= V2 揪團 第二組（每級第 2 種）：登船證蓋章／吉祥物遊行／擠爆滿員／傳送門艦隊 =======================
function mascotAt3(ctx, x, y, h, rot = 0, flip = false) {   // 白邊吉祥物
  const img = flip ? mascotFlip() : MASCOT; if (!img) return; outlineV2(ctx, img, x, y, h, rot, '#fff', Math.max(3, h * 0.02), 10); drawImg(ctx, img, x, y, h, rot);
}

// ---------------- 揪團 小 2：登船證蓋章 ----------------
function vRaid1B(ctx, t) {
  const D = CFG.dur, X0 = 76, Y0 = 772, TW = 940, TH = 252, SX = TW - 236, k = eback(lin(t, 0, 0.5), 1.25), out = ei(lin(t, D - 0.5, D - 0.05)), ST = 1.3, pal = PAL.sky, f = Math.floor(t * 60);
  const hit = decay(t, [[ST, 1]], 12);
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(-(1 - k) * 1200 - out * 1200 + (R(f, 1) - 0.5) * hit * 12, (R(f, 2) - 0.5) * hit * 12);
  ctx.translate(X0 + TW / 2, Y0 + TH / 2); ctx.rotate(-0.035 - (1 - k) * 0.2); ctx.translate(-TW / 2, -TH / 2);
  for (let i = 0; i < 3; i++) { const pk = popK(lin(t, 1.7 + i * 0.12, 2.0 + i * 0.12), 2.2); if (pk > 0) mascotAt3(ctx, 330 + i * 150, 8 - 78 * pk - Math.abs(Math.sin(t * 7 + i)) * 12, 170, Math.sin(t * 7 + i) * 0.08); }   // 從票後面探頭
  const body = () => { const r = 22; ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(SX - 18, 0); ctx.arc(SX, 0, 18, Math.PI, 0, true); ctx.lineTo(TW - r, 0); ctx.arcTo(TW, 0, TW, r, r); ctx.lineTo(TW, TH - r); ctx.arcTo(TW, TH, TW - r, TH, r); ctx.lineTo(SX + 18, TH); ctx.arc(SX, TH, 18, 0, Math.PI, true); ctx.lineTo(r, TH); ctx.arcTo(0, TH, 0, TH - r, r); ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r); ctx.closePath(); };
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12; body(); ctx.fillStyle = '#fffaf0'; ctx.fill(); ctx.restore();
  ctx.save(); body(); ctx.clip();
  const lg = ctx.createLinearGradient(0, 0, 0, TH); lg.addColorStop(0, '#3f9af0'); lg.addColorStop(1, '#1f5fd0'); ctx.fillStyle = lg; ctx.fillRect(0, 0, 156, TH);
  if (ANCHOR) { const ah = 130, aw = ANCHOR.width * ah / ANCHOR.height; ctx.drawImage(ANCHOR, 78 - aw / 2, TH / 2 - ah / 2, aw, ah); }
  ctx.fillStyle = '#1a3a8a'; ctx.fillRect(156, 0, SX - 156, 50);
  ctx.save(); ctx.font = "900 26px 'Noto Sans TC'"; ctx.letterSpacing = '4px'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff'; ctx.fillText('BOARDING PASS' + LX('pass'), 180, 26); ctx.restore();
  ctx.fillStyle = '#ffe9ee'; ctx.fillRect(SX, 0, TW - SX, TH);
  ctx.setLineDash([10, 9]); ctx.strokeStyle = '#1a3a8a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(SX, 22); ctx.lineTo(SX, TH - 22); ctx.stroke(); ctx.setLineDash([]);
  const cxs = (SX + TW) / 2;
  ctx.font = "30px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e8243c'; ctx.fillText('RAID', cxs, 34);
  fitText(ctx, String(CFG.n), cxs, 128, 196, "112px 'Dela Gothic One'", '#e8243c', null, 0, 'center');
  ctx.font = "900 34px 'Noto Sans TC'"; ctx.fillStyle = '#1a3a8a'; ctx.textAlign = 'center'; ctx.fillText(LX('unit'), cxs, 214);
  ctx.restore();
  ctx.save(); body(); ctx.lineWidth = 5; ctx.strokeStyle = '#1a3a8a'; ctx.stroke(); ctx.restore();
  const tk = lin(t, 0.5, 0.7); if (tk > 0) { ctx.save(); ctx.translate(182, 122); const s = slamK(tk, 1.7); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 74, pal, 'left', 350); ctx.restore(); }
  const nk = eo(lin(t, 0.75, 0.95)); if (nk > 0) { ctx.save(); ctx.globalAlpha *= nk; fitText(ctx, raidLine(), 184 + (1 - nk) * 24, 204, 352, "900 38px 'Noto Sans TC'", '#1a3a8a', null, 0, 'left'); ctx.restore(); }
  const sk = lin(t, ST, ST + 0.1);   // 紅色圓章「RAID」砸下
  if (sk > 0) { const s = 2.6 - 1.6 * eo(sk); ctx.save(); ctx.translate(SX - 80, 152); ctx.rotate(-0.28); ctx.scale(s * 0.86, s * 0.86); ctx.globalAlpha *= Math.min(1, sk * 2) * 0.88;
    ctx.strokeStyle = '#d0142c'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(0, 0, 84, 0, 7); ctx.stroke(); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 68, 0, 7); ctx.stroke();
    ctx.fillStyle = '#d0142c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = "46px 'Dela Gothic One'"; ctx.fillText('RAID', 0, 2); ctx.font = "900 15px 'Noto Sans TC'"; ctx.fillText('WELCOME', 0, -42); ctx.fillText('★ ★ ★', 0, 44); ctx.restore(); }
  ctx.restore();
  if (t >= ST) { ctx.save(); ctx.globalAlpha = 1 - out; sparkBurst(ctx, X0 + SX - 80, Y0 + 152, t - ST, 14, 1.2, '#ffd0d8'); ctx.restore(); }
}

// ---------------- 揪團 中 2：吉祥物遊行 ----------------
function vRaid2BScene(ctx, t) {
  const GY = 940, app = eo(lin(t, 0, 0.3)), rise = (1 - eback(lin(t, 0, 0.5), 1.2)) * 320, TT = 1.75, pk = decay(t, [[TT, 1]], 11), N = 9, l = t - TT;
  ctx.save(); camV2(ctx, 960, 900, 1.012 + pk * 0.03); shakeAt(ctx, t, pk * 16);
  dimBG(ctx, app * 0.6, [960, 560, 1000, 'rgba(90,170,255,0.3)']);
  ctx.save(); ctx.translate(0, rise);
  const cg = ctx.createLinearGradient(0, GY, 0, GY + 200); cg.addColorStop(0, '#2a86f0'); cg.addColorStop(1, '#144ab8'); ctx.fillStyle = cg; ctx.fillRect(-100, GY, W + 200, 300);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-100, GY - 5, W + 200, 10); ctx.fillStyle = '#ffe14a'; ctx.fillRect(-100, GY + 14, W + 200, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; for (let x = -120 - ((t * 260) % 120); x < W + 120; x += 120) { ctx.beginPath(); ctx.moveTo(x, GY + 78); ctx.lineTo(x + 30, GY + 52); ctx.lineTo(x + 60, GY + 78); ctx.lineTo(x + 30, GY + 104); ctx.fill(); }   // 往後流動的菱形，看起來在前進
  ctx.restore();
  for (let i = 0; i < N; i++) {   // 一隻一隻跳進來排成一排；標題砸下時一起跳
    const e = eo5(lin(t, 0.2 + (N - 1 - i) * 0.08, 1.15 + (N - 1 - i) * 0.08)), x = mixv(-260 - (N - 1 - i) * 40, 150 + i * 202, e), ph = t * 8.5 - i * 0.7, jump = l >= 0 && l < 0.5 ? Math.sin(l / 0.5 * Math.PI) * 170 * (1 - (i % 3) * 0.12) : 0, y = GY - 104 - Math.abs(Math.sin(ph)) * (e < 1 ? 40 : 20) - jump + rise;
    if (i % 2 === 0) { const fc = ['#ff5a8c', '#ffe14a', '#7dff9a', '#8fd8ff', '#c8a0ff'][(i / 2) % 5]; ctx.save(); ctx.translate(x + 62, y - 30); ctx.rotate(0.16 + Math.sin(ph) * 0.08); ctx.strokeStyle = '#fff2c0'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 60); ctx.lineTo(0, -150); ctx.stroke();
      ctx.fillStyle = fc; ctx.strokeStyle = '#2b1a3a'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(0, -150); ctx.quadraticCurveTo(50, -140 + Math.sin(t * 9 + i) * 10, 96, -118); ctx.quadraticCurveTo(50, -100 + Math.sin(t * 9 + i) * 10, 0, -90); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
    mascotAt3(ctx, x, y, 236, Math.sin(ph) * 0.08);
  }
  if (l >= 0) { shardsV2(ctx, 960, 350, l, 36, ['#ffffff', '#bff0ff', '#fff2a8']); ringBurst(ctx, 960, 350, l, { r1: 1300, col: 'rgba(200,240,255,1)' });
    for (const sx of [-1, 1]) { const q = l - 0.05; if (q > 0 && q < 0.9) for (let i = 0; i < 30; i++) { const a = -Math.PI / 2 - sx * (0.25 + R(i, 1) * 0.55), v = 1000 + R(i, 2) * 800, x = 960 + sx * 900 + Math.cos(a) * v * q, y = 1000 + Math.sin(a) * v * q + 900 * q * q; ctx.fillStyle = ['#ffd24a', '#ff5a8a', '#5fc8ff', '#fff'][i % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(q * 12 + i); ctx.fillRect(-10, -5, 20, 10); ctx.restore(); } } }
  heroTitle(ctx, t, 960, 350, lin(t, TT, TT + 0.18), { maxW: 1320, pk, rot: -0.03 });
  plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 960, 585, 0.92);
  ctx.restore();
  if (l >= 0) confetti(ctx, t, TT, 70, ['#ffffff', '#8fd8ff', '#ffe27a', '#ff7aa8'], 73);
  if (l >= 0) flash(ctx, (1 - lin(l, 0, 0.1)) * 0.22, '#dff4ff');
}
function vRaid2B(ctx, t) { if (!MASCOT) return vRaid2(ctx, t); runV2(ctx, t, { T: 1e9, exitKind: 'slice', pre: vRaid2BScene }); }

// ---------------- 揪團 大 2：擠爆滿員 ----------------
const RF3 = { fill0: 0.45, full: 2.3, burst: 2.9, T: 3.25 };
function vRaid3BPre(ctx, t) {
  const T = RF3, app = eo(lin(t, 0, 0.25)), fk = lin(t, T.fill0, T.full), cnt = Math.max(1, Math.round(CFG.n * eo(fk))), full = t >= T.full, bl = t - T.burst, M = 84;
  const pk = decay(t, [[T.full, 0.8], [T.burst, 1]], 9);
  ctx.save(); camV2(ctx, 960, 560, 1.014 + 0.05 * sstep(fk) + pk * 0.05); shakeAt(ctx, t, pk * 24 + (full && bl < 0 ? 9 : fk * 3));
  const bg = ctx.createRadialGradient(960, 560, 0, 960, 560, 1300); bg.addColorStop(0, full ? '#7a1030' : '#1f4aa8'); bg.addColorStop(1, '#070a2a'); ctx.globalAlpha = app; ctx.fillStyle = bg; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.globalAlpha = 1;
  for (let j = M - 1; j >= 0; j--) {   // 由下往上一排一排塞滿（先畫上排，下排蓋在前面）
    const r = Math.floor(j / 12), c = j % 12, aj = T.fill0 + (j / M) * (T.full - T.fill0) * 0.96, pop = popK(lin(t, aj, aj + 0.22), 2.2); if (pop <= 0) continue;
    let x = (c + 0.5 + (r % 2) * 0.5) * 165 - 50 + (R(j, 5) - 0.5) * 40, y = 1000 - r * 150 + (R(j, 6) - 0.5) * 30, rot = (R(j, 7) - 0.5) * 0.5, a = 1, h = 236 * pop;
    if (full && bl < 0) { x += Math.sin(t * 46 + j) * 7; y += Math.cos(t * 39 + j * 1.7) * 7; h *= 1 + 0.03 * Math.sin(t * 30 + j); }
    if (bl >= 0) { const dx = x - 960, dy = y - 560, d = Math.hypot(dx, dy) + 1, v = bl * (1500 + R(j, 8) * 1500); x += dx / d * v; y += dy / d * v - 300 * bl; rot += bl * (R(j, 9) - 0.5) * 16; h *= 1 + bl * 1.2; a = 1 - lin(bl, 0.3, 0.6); }
    if (a <= 0) continue; ctx.save(); ctx.globalAlpha = a; mascotAt3(ctx, x, y, h, rot + Math.sin(t * 6 + j) * 0.06, R(j, 10) > 0.5); ctx.restore();
  }
  if (bl >= 0) for (let i = 0; i < 3; i++) ringBurst(ctx, 960, 560, bl - i * 0.07, { r1: 1600, dur: 0.5, sq: 1, w: 30 });
  if (bl < 0.1) {   // 中央人數牌
    ctx.save(); ctx.globalAlpha = (1 - lin(bl, 0, 0.1)) * eo(lin(t, T.fill0 - 0.1, T.fill0 + 0.15)); ctx.translate(960, 560); const s = 1 + (full ? Math.exp(-(t - T.full) * 8) * 0.25 : 0); ctx.scale(s, s);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.fillStyle = full ? '#c4002a' : '#12205a'; ctx.beginPath(); ctx.roundRect(-380, -150, 760, 300, 60); ctx.fill(); ctx.shadowBlur = 0; ctx.lineWidth = 12; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = '#ffe14a'; ctx.beginPath(); ctx.roundRect(-362, -132, 724, 264, 46); ctx.stroke();
    fitText(ctx, ppl(cnt), 0, 10, 640, "190px 'Dela Gothic One', 'Noto Sans TC'", full ? '#ffe14a' : '#ffffff', '#0a0420', 22, 'center'); ctx.restore();
  }
  ctx.restore();
  if (bl < 0.1) {   // 上方的乘載量表
    const a = app * (1 - lin(bl, 0, 0.1)); ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(420, 60, 1080, 60, 30); ctx.fill();
    const gc = fk < 0.6 ? '#5cff70' : fk < 0.9 ? '#ffe14a' : '#ff3a4a'; ctx.fillStyle = gc; ctx.beginPath(); ctx.roundRect(428, 68, Math.max(44, 1064 * fk), 44, 22); ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(420, 60, 1080, 60, 30); ctx.stroke(); ctx.restore();
    hudText(ctx, 'CAPACITY', 250, 92, 34, '#ffffff', 'center', a); hudText(ctx, full ? 'OVER!!' : Math.round(fk * 100) + '%', 1650, 92, 40, full ? (Math.floor(t * 10) % 2 ? '#ff3a4a' : '#ffe14a') : '#ffffff', 'center', a);
  }
  if (t > 1.1 && !full) wordV2(ctx, 'ぎゅうぎゅう…', 960, 262, lin(t, 1.1, 1.25), { s: 0.9, fill: '#ffffff', stroke: '#0a1450', rot: -0.04, beat: Math.sin(t * 24) * 0.03 });
  if (full && bl < 0) { const hz = eo5(lin(t, T.full, T.full + 0.2)); hazard(ctx, H - 74 * hz, 74, -t * 320); wordV2(ctx, '満員!!', 960, 262, lin(t, T.full, T.full + 0.14), { s: 1.6, big: 3, fill: Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a', stroke: '#1a0008', rot: -0.05, beat: Math.sin(t * 30) * 0.03, depth: 12 }); }
  if (bl >= 0 && t < T.T) wordV2(ctx, 'ドーン!!', 960, 540, lin(bl, 0, 0.12), { s: 2.0, big: 3, fill: '#ffffff', stroke: '#0a3a9a', rot: -0.06, depth: 14, box: false });
  if (full) flash(ctx, (1 - lin(t, T.full, T.full + 0.12)) * 0.4, '#ffd0d0');
  if (bl >= 0) flash(ctx, (1 - lin(bl, 0, 0.2)) * 0.8, '#fff');
}
function vRaid3BFin(ctx, m, t) {   // 結尾：轉播字幕條；後面還有吉祥物一直掉下來
  finaleV2(ctx, m, t, { style: 'lower', tag: 'RAID', tGirl: 0.05, tTitle: 0.42, mascot: false,
    bg: (c) => { c.save(); c.translate(-40, -30); c.scale(1.045, 1.06); palBG(c, t, PAL.blue, 1280, 380); c.restore(); },
    back: (c, mm, tt) => { for (let i = 0; i < 16; i++) { const q = (tt * (0.28 + R(i, 3) * 0.2) + R(i, 4)) % 1, x = 80 + R(i, 5) * 1000; c.save(); c.globalAlpha = 0.9; mascotAt3(c, x, -160 + q * 1400, 150 + R(i, 6) * 70, q * (R(i, 7) - 0.5) * 9, i % 2 === 0); c.restore(); } } });
}
function vRaid3B(ctx, t) { if (!MASCOT) return vRaid3(ctx, t); runV2(ctx, t, { T: RF3.T, cut: false, exitKind: 'whipR', pre: vRaid3BPre, fin: vRaid3BFin }); }

// ---------------- 揪團 特大 2：傳送門艦隊 ----------------
const RP4 = { c: [0.5, 0.95, 1.35], open: 1.75, flag: 3.5, hit: 4.15, T: 4.3 };
function portalV2(ctx, t, x, y, r, a = 1) {   // 彩虹隧道（圓形視窗）＋金色外環
  if (r < 2) return; ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  const bg = ctx.createRadialGradient(x, y, 0, x, y, r); bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.25, '#ffe9a0'); bg.addColorStop(0.6, '#b04aff'); bg.addColorStop(1, '#1a0a50'); ctx.fillStyle = bg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 16; i++) { const z = ((i / 16) + t * 1.2) % 1, rr = 24 * Math.pow(r / 18, z); ctx.strokeStyle = `hsla(${(i * 40 + t * 200) % 360},100%,65%,${Math.min(1, z * 1.6) * 0.8})`; ctx.lineWidth = 2 + z * 26; ctx.beginPath(); ctx.arc(x + Math.sin(t * 3 + i) * 12 * z, y + Math.cos(t * 2 + i) * 10 * z, rr, 0, 7); ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha *= a; ctx.lineWidth = 30; ctx.strokeStyle = '#2b1a3a'; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 7); ctx.stroke(); const gg = ctx.createLinearGradient(0, y - r, 0, y + r); gg.addColorStop(0, '#fff2a0'); gg.addColorStop(1, '#c87a00'); ctx.lineWidth = 18; ctx.strokeStyle = gg; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 7); ctx.stroke();
  ctx.translate(x, y); ctx.rotate(t * 0.8); ctx.fillStyle = '#fffbe0'; for (let i = 0; i < 12; i++) { const an = i / 12 * Math.PI * 2; ctx.save(); ctx.translate(Math.cos(an) * (r + 6), Math.sin(an) * (r + 6)); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(10, 0); ctx.lineTo(0, 16); ctx.lineTo(-10, 0); ctx.fill(); ctx.restore(); }
  ctx.restore();
}
function vRaid4BPre(ctx, t) {
  const T = RP4, app = eo(lin(t, 0, 0.25)), CXp = 960, CYp = 520; let lv = 0; for (const c of T.c) if (t >= c) lv++;
  const open = t >= T.open, ol = t - T.open, hits = [...T.c.map((c, i) => [c, 0.5 + 0.2 * i]), [T.open, 1], [T.flag, 0.6]], pk = decay(t, hits, 10), fu = lin(t, T.flag, T.hit);
  const cnt = Math.max(1, Math.round(CFG.n * Math.pow(lin(t, T.open + 0.25, T.flag + 0.2), 1.5)));
  ctx.save(); camV2(ctx, CXp, CYp, 1.014 + pk * 0.05 + lv * 0.015 + ei(fu) * 0.12); shakeAt(ctx, t, pk * 24 + lv * 2 + fu * 10);
  ctx.save(); ctx.globalAlpha = app; const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#080626'); sky.addColorStop(1, '#2a1260'); ctx.fillStyle = sky; ctx.fillRect(-80, -80, W + 160, H + 160);
  for (let i = 0; i < 110; i++) { const tw = 0.55 + 0.45 * Math.sin(t * (2 + R(i, 4) * 4) + i); if (i % 9 === 0) star4(ctx, R(i, 1) * W, R(i, 2) * H, 8 + 12 * tw, '#fff', 0.8 * tw); else { ctx.fillStyle = `rgba(255,255,240,${0.3 + 0.6 * R(i, 3) * tw})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * H, 3, 3); } }
  ctx.restore();
  if (!open && lv) {   // 天空裂開：三段，一次比一次大，裂縫漏出的光也升級
    const lc = T.c[lv - 1], grow = [0.22, 0.5, 0.85][lv - 1] * (0.75 + 0.25 * eo(lin(t, lc, lc + 0.15))), col = ['#ffffff', '#8fe0ff', '#ffd21a'][lv - 1];
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gl = ctx.createRadialGradient(CXp, CYp, 0, CXp, CYp, 260 + lv * 220); gl.addColorStop(0, col); gl.addColorStop(0.3, col + '88'); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.5 + 0.15 * Math.sin(t * 30); ctx.fillStyle = gl; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore();
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 24; cracks(ctx, 7, CXp, CYp, grow, col, 5 + lv * 2); ctx.restore(); cracks(ctx, 7, CXp, CYp, grow, '#ffffff', 2);
    ringBurst(ctx, CXp, CYp, t - lc, { r0: 40, r1: 700 + lv * 300, dur: 0.35, sq: 1, w: 16 });
  }
  if (open) {
    portalV2(ctx, t, CXp, CYp, 470 * eback(lin(ol, 0, 0.4), 1.5) * (1 + pk * 0.03));
    if (ol < 0.7) for (let i = 0; i < 26; i++) { const a = R(i, 21) * Math.PI * 2, d = 200 + ol * (900 + R(i, 22) * 1400), s = 30 + R(i, 23) * 70; ctx.save(); ctx.globalAlpha = 1 - ol / 0.7; ctx.translate(CXp + Math.cos(a) * d, CYp + Math.sin(a) * d * 0.8 + 600 * ol * ol); ctx.rotate(ol * 9 * (R(i, 24) - 0.5) + i); ctx.fillStyle = i % 2 ? 'rgba(200,220,255,0.85)' : 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s, -s * 0.7); ctx.lineTo(s * 0.3, s); ctx.closePath(); ctx.fill(); ctx.restore(); }   // 天空的碎片
    const ships = [];   // 船從門裡一艘接一艘衝出來，往四周飛過鏡頭
    for (let i = 0; i < 18; i++) { const u = (t - (T.open + 0.25 + i * 0.105)) / 1.15; if (u <= 0 || u >= 1) continue; ships.push([u, i]); }
    ships.sort((a, b) => a[0] - b[0]);
    for (const [u, i] of ships) { const a = (i * 2.4) + R(i, 31) * 0.8, e = Math.pow(u, 2.3), d = 40 + e * 1500, x = CXp + Math.cos(a) * d * 1.25, y = CYp + Math.sin(a) * d * 0.7 + e * 200, h = 40 + e * 760;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `hsla(${(i * 47) % 360},100%,70%,${0.5 * (1 - u)})`; ctx.lineWidth = 6 + e * 40; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(CXp, CYp); ctx.lineTo(x, y - h * 0.4); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha = Math.min(1, u * 5) * (1 - lin(u, 0.85, 1)); shipV2(ctx, x, y, h, t, { ph: i, flip: Math.cos(a) < 0, crew: h > 300 ? 1 : 0, rot: Math.cos(a) < 0 ? 0.08 : -0.08 }); ctx.restore(); }
    if (fu > 0) { const h = 160 + ei(fu) * 2900; shipV2(ctx, CXp - h * 0.06, CYp + h * 0.42, h, t, { crew: 2, ph: 0 }); }   // 旗艦正面衝過來
  }
  ctx.restore();
  if (!open && lv) wordV2(ctx, ['ピシッ', 'ピシピシ…!?', '来るぞ…!!'][lv - 1], 960, 170, lin(t, T.c[lv - 1], T.c[lv - 1] + 0.12), { s: 0.75 + lv * 0.12, fill: ['#ffffff', '#8fe0ff', '#ffd21a'][lv - 1], stroke: '#0a0420', rot: -0.04, beat: Math.sin(t * 24) * 0.02 * lv });
  if (open && t < T.hit) { const colr = t >= T.flag ? rainbowFill(ctx, -70, 70, t) : '#ffd21a';
    wordV2(ctx, ppl(cnt), 960, 975, 1, { pop: false, s: 0.8 + (t >= T.flag ? 0.12 : 0), fill: colr, stroke: '#0a0420', rot: -0.03, box: false });
    if (t >= T.flag) wordV2(ctx, '旗艦、突入!!', 960, 150, lin(t, T.flag, T.flag + 0.14), { s: 1.05, fill: '#ff3a4a', stroke: '#ffffff', rot: -0.04, beat: Math.sin(t * 28) * 0.03 }); }
  for (const c of T.c) if (t >= c && t < c + 0.1) flash(ctx, (1 - (t - c) / 0.1) * 0.25, '#fff');
  if (open) flash(ctx, (1 - lin(ol, 0, 0.2)) * 0.75, '#fff');
  if (t >= T.hit) { flash(ctx, lin(t, T.hit, T.hit + 0.08) * 0.95, '#fff'); cracks(ctx, 11, 960, 540, lin(t, T.hit, T.T) * 1.2, '#1a0838', 6); }
}
function vRaid4BFin(ctx, m, t) {   // 結尾：漫畫三分格
  finaleV2(ctx, m, t, { style: 'manga', tTitle: 0.62, confettiN: 220, mascot: {},
    bg: (c) => { rainbowBG2(c, t * 2.2, 960, 500); },
    front: (c, mm, tt, pk) => raidSeal(c, tt, 320, 846, lin(mm, 1.45, 1.63), pk) });
}
function vRaid4B(ctx, t) { if (!SHIP) return; runV2(ctx, t, { T: RP4.T, cutA: 0.9, exitKind: 'crt', pre: vRaid4BPre, fin: vRaid4BFin }); }

VARS.r1[1] = { name: '登船證蓋章', fn: vRaid1B, dur: 4.2 };
VARS.r2[1] = { name: '吉祥物遊行', fn: vRaid2B, dur: 5.6 };
VARS.r3[1] = { name: '擠爆滿員', fn: vRaid3B, dur: 7.4 };
VARS.r4[1] = { name: '傳送門艦隊', fn: vRaid4B, dur: 9.4 };
