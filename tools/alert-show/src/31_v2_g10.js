
// ======================= V2 大量（g10）：幸運大轉盤／鎖定掃描／VS 對決／號外 =======================
function redBG(ctx, t, cx, cy, dark = 0.15) {   // 紅色放射背景（帶出血，鏡頭晃動不露邊）
  ctx.save(); ctx.translate(-40, -30); ctx.scale(1.045, 1.06); palBG(ctx, t, PAL.red, cx, cy); ctx.restore();
  if (dark > 0) { ctx.fillStyle = `rgba(30,0,8,${dark})`; ctx.fillRect(-80, -80, W + 160, H + 160); }
}

// ---------------- 大量 1：幸運大轉盤 ----------------
function wheelV2(ctx, t, wx, wy, dia, o = {}) {   // o.ang 指定角度（結尾當背景慢轉）、o.stand/o.pointer 可關
  const STOP = WH_T.stop, won = t >= STOP, k = dia / 640;
  const ang = o.ang ?? wheelAngle(t), om = o.ang !== undefined ? 0 : Math.abs(wheelAngle(t) - wheelAngle(t - 1 / 60)) * 60;
  if (o.stand !== false) { const stH = dia * 0.93, stW = WHEEL_STAND.width * stH / WHEEL_STAND.height; ctx.drawImage(WHEEL_STAND, wx - stW / 2, wy - stH * WHEEL_GEO.hubY, stW, stH); }
  const ghosts = om > 200 ? 5 : 0;
  for (let q = ghosts; q >= 0; q--) { ctx.save(); ctx.globalAlpha *= q ? 0.2 : 1; ctx.translate(wx, wy); ctx.rotate((ang - q * om / 60 / (ghosts + 1)) * Math.PI / 180); ctx.drawImage(WHEEL_DISC, -dia / 2, -dia / 2, dia, dia); ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < WHEEL_GEO.nB; i++) {   // 外圈跑燈；中獎後全部交替閃
    const a = (i / WHEEL_GEO.nB) * Math.PI * 2 + ang * Math.PI / 180 - Math.PI / 2, bx = wx + Math.cos(a) * dia * WHEEL_GEO.bulbR, by = wy + Math.sin(a) * dia * WHEEL_GEO.bulbR;
    const on = won ? ((Math.floor((t - STOP) * 10) + i) % 2 ? 1 : 0.3) : (Math.floor(t * 18) - i) % 4 === 0 ? 0.9 : 0; if (!on) continue;
    const r = 24 * k, gg = ctx.createRadialGradient(bx, by, 0, bx, by, r); gg.addColorStop(0, `rgba(255,250,210,${on})`); gg.addColorStop(1, 'rgba(255,190,80,0)'); ctx.fillStyle = gg; ctx.fillRect(bx - r, by - r, r * 2, r * 2);
  }
  ctx.restore();
  if (won && o.ang === undefined) { const l = t - STOP, a = (Math.floor(l * 8) % 2 ? 0.55 : 0.2) * (1 - lin(l, 1.2, 1.8));   // 中獎格閃白
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,250,220,${a})`; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.arc(wx, wy, dia * 0.43, -Math.PI / 2 - Math.PI / 8, -Math.PI / 2 + Math.PI / 8); ctx.fill(); ctx.restore(); }
  if (o.pointer !== false) { const f = (((ang + 90 + WHEEL_GEO.winA) % 45) + 45) % 45 / 45, flap = om > 900 ? Math.sin(t * 90) * 0.15 : -0.45 * Math.max(0, 1 - f * 5), pw = 96 * k, ph = WHEEL_PTR.height * pw / WHEEL_PTR.width;
    ctx.save(); ctx.translate(wx, wy - dia / 2 - ph * 0.35); ctx.rotate(flap); ctx.drawImage(WHEEL_PTR, -pw / 2, -ph * 0.3, pw, ph); ctx.restore(); }
  if (won) { const hk = lin(t, STOP + 0.12, STOP + 0.34); if (hk > 0) { const s = k * (hk < 1 ? 2 - eback(hk, 1.6) : 1); ctx.save(); ctx.translate(wx, wy); ctx.scale(s, s); ctx.beginPath(); ctx.arc(0, 0, 112, 0, 7); ctx.fillStyle = '#c8102e'; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#ffd34a'; ctx.stroke(); smallTitle(ctx, t, '×' + CFG.n, 0, 4, 92, PAL.gold, 'center'); ctx.restore(); } }
}
function v2RoulettePre(ctx, t) {
  const STOP = WH_T.stop, won = t >= STOP, app = eo(lin(t, 0, 0.3)), dia = 820, wx = 960, wy = 575 + (1 - eback(lin(t, 0.05, 0.5), 1.3)) * 1300;
  const zk = sstep(lin(t, 1.85, WH_T.slow + 0.2)) * (won ? 1 - eo(lin(t, STOP + 0.02, STOP + 0.25)) : 1), pk = decay(t, [[0.5, 0.5], [STOP, 1]], 9);
  ctx.save(); camV2(ctx, 960, mixv(540, wy - dia * 0.4, zk), 1.014 + 0.6 * zk + pk * 0.05); shakeAt(ctx, t, pk * 22 + (t > WH_T.slow && !won ? 3 : 0));
  ctx.save(); ctx.globalAlpha = app; redBG(ctx, t, 960, 540, won ? 0.12 : 0.42); ctx.restore();
  if (won) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, wx, wy, 16, `rgba(255,230,150,${0.24 * eo(lin(t, STOP, STOP + 0.3))})`, t * 0.5, 1900, 0.45, 16); ctx.restore(); }
  ctx.save(); ctx.shadowColor = 'rgba(40,0,10,0.5)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; wheelV2(ctx, t, wx, wy, dia); ctx.restore();
  ctx.restore();
  if (t > WH_T.slow + 0.05 && !won) wordV2(ctx, 'CHANCE!!', 960, 930, lin(t, WH_T.slow + 0.05, WH_T.slow + 0.2), { s: 1.0, fill: Math.floor(t * 10) % 2 ? '#ffe14a' : '#ffffff', beat: Math.sin(t * 28) * 0.03, rot: -0.04, stroke: '#4a0010' });
  if (won) { const l = t - STOP; ringBurst(ctx, wx, wy - dia * 0.4, l, { r1: 1500, dur: 0.45 }); coinFountain(ctx, t, STOP, STOP + 1.2, 70);
    wordV2(ctx, '大当り!!', 960, 900, lin(l, 0.02, 0.16), { s: 1.25, fill: '#ffd21a', rot: -0.05, stroke: '#4a0010' }); flash(ctx, (1 - lin(l, 0, 0.14)) * 0.6, '#fff3c0'); }
}
function v2RouletteFin(ctx, m, t) {   // 結尾：巨大數字（轉盤在角色背後）
  finaleV2(ctx, m, t, { style: 'count', bg: (c) => redBG(c, t, 500, 520, 0.05),
    back: (c, mm, tt, pk) => { const k = eo5(lin(mm, 0, 0.5)), fin = -90 - WHEEL_GEO.winA; c.save(); c.globalAlpha = 0.92; wheelV2(c, tt, 500 - (1 - k) * 300, 560, 1180 * (0.7 + 0.3 * k) * (1 + pk * 0.02), { ang: fin + mm * 16, stand: false, pointer: false }); c.restore();
      c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 500, 560, 16, 'rgba(255,236,170,0.16)', tt * 0.3, 1900, 0.4, 16); c.restore(); },
    mid: (c, mm) => coinFountain(c, mm, 0, 2.6, 110) });
}
function v2Roulette(ctx, t) { if (!WHEEL_DISC) return; runV2(ctx, t, { T: WH_T.stop + 0.5, exitKind: 'slice', pre: v2RoulettePre, fin: v2RouletteFin }); }

// ---------------- 大量 2：鎖定掃描 ----------------
const SC2 = { s0: 0.35, s1: 1.5, seek: 1.5, lock: 2.05, gx: 1380, gy: 895, gh: 1650 };
function hudGrid(ctx, t, a) {
  ctx.save(); ctx.fillStyle = `rgba(2,8,18,${0.86 * a})`; ctx.fillRect(-80, -80, W + 160, H + 160);
  ctx.globalAlpha = 0.16 * a; ctx.strokeStyle = HUD_C; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= W; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } for (let y = (t * 40) % 80; y <= H; y += 80) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke(); ctx.restore();
}
function reticleV2(ctx, x, y, sz, col, rot = 0, cross = true) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); brackets(ctx, 0, 0, sz, sz, sz * 0.22, col, 6);
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.globalAlpha *= 0.85; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(0, 0, sz * 0.64, 0, 7);
  if (cross) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(dx * sz * 0.52, dy * sz * 0.52); ctx.lineTo(dx * sz * 0.8, dy * sz * 0.8); }
  ctx.stroke(); ctx.setLineDash([10, 16]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, sz * 0.74, 0, 7); ctx.stroke(); ctx.restore();
}
function hudStatus(ctx, t, txt, col, prog, a = 1) {
  hudText(ctx, txt, 90, 92, 50, col, 'left', a);
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = 'rgba(95,242,255,0.2)'; ctx.fillRect(90, 132, 560, 8); ctx.fillStyle = col; ctx.fillRect(90, 132, 560 * prog, 8); ctx.restore();
  for (let i = 0; i < 5; i++) hudText(ctx, ('0000' + Math.floor(R(i, Math.floor(t * 12)) * 65535).toString(16)).slice(-4).toUpperCase() + '  ' + (R(i + 9, Math.floor(t * 6)) * 99).toFixed(2), 90, 930 + i * 26 - 104, 20, col, 'left', 0.5 * a);
}
function v2ScanPre(ctx, t) {
  const S = SC2, app = eo(lin(t, 0, 0.3)), gy = S.gy + Math.sin(t * 2.1) * 6, G = girlGeo(S.gx, gy, S.gh);
  ctx.save(); camV2(ctx, G.fx, G.fy, 1.014 + 0.06 * sstep(lin(t, S.seek - 0.2, S.lock)));
  hudGrid(ctx, t, app);
  if (GIRL) {
    const scanY = -120 + (H + 240) * sstep(lin(t, S.s0, S.s1));
    drawImg(ctx, silC(GIRL_SIL, '#1d7fa0'), S.gx, gy, S.gh, 0, 0.6 * app);
    ctx.save(); ctx.beginPath(); ctx.rect(-80, -80, W + 160, scanY + 80); ctx.clip(); drawImg(ctx, GIRL, S.gx, gy, S.gh, 0, app); ctx.restore();
    if (t > S.s0 && t < S.s1 + 0.1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createLinearGradient(0, scanY - 110, 0, scanY + 6); gg.addColorStop(0, 'rgba(95,242,255,0)'); gg.addColorStop(1, 'rgba(95,242,255,0.75)'); ctx.fillStyle = gg; ctx.fillRect(S.gx - 620, scanY - 110, 1240, 116); ctx.fillStyle = '#d8fdff'; ctx.fillRect(S.gx - 620, scanY, 1240, 4); ctx.restore(); }
  }
  ctx.restore();
  if (t > 0.5) for (let i = 0; i < 3; i++) {   // 誘餌目標框
    const ph = t * (1.3 + i * 0.4) + i * 2, x = 300 + i * 250 + Math.sin(ph) * 130, y = 330 + i * 190 + Math.cos(ph * 1.3) * 90, a = (1 - lin(t, S.seek, S.lock - 0.2)) * lin(t, 0.5 + i * 0.2, 0.7 + i * 0.2);
    brackets(ctx, x, y, 150, 150, 30, HUD_C, 3, a); hudText(ctx, '?', x, y, 46, HUD_C, 'center', a * (Math.floor(t * 8 + i) % 2 ? 1 : 0.4));
  }
  if (G && t > S.seek - 0.45) {   // 準星衝向臉
    const k = eo5(lin(t, S.seek - 0.45, S.lock)), sz = mixv(680, G.fr * 2.0, k);
    reticleV2(ctx, mixv(520, G.fx, k), mixv(780, G.fy, k), sz, HUD_C, (1 - k) * 1.4 + Math.sin(t * 9) * 0.04 * (1 - k));
  }
  hudStatus(ctx, t, (t < S.seek ? 'SCANNING' : 'TARGET FOUND') + (Math.floor(t * 4) % 2 ? ' ...' : ''), HUD_C, Math.min(1, t / S.lock), app);
}
function v2ScanFin(ctx, m, t) {   // 結尾：轉播字幕條（HUD 資料列）
  const S = SC2, G = girlGeo(S.gx, S.gy, S.gh);
  finaleV2(ctx, m, t, { style: 'lower', tag: 'LOCK', cam: [G.fx, G.fy], tGirl: -1, tTitle: 0.42, confetti: false, girl: { x: S.gx, y: S.gy, h: S.gh, from: 'none', rot: 0 }, title: { x: 640, y: 250, maxW: 1060 },
    bg: (c, mm) => { redBG(c, t, G.fx, G.fy, 0.3); c.save(); c.globalAlpha = 0.5 * (1 - lin(mm, 0.1, 0.6)); hudGrid(c, t, 1); c.restore(); },
    back: (c, mm) => { for (let i = 0; i < 3; i++) ringBurst(c, G.fx, G.fy, mm - i * 0.08, { r1: 1500, dur: 0.6, sq: 1, w: 18, col: `rgba(255,${130 + i * 50},${130 + i * 40},1)` }); },
    front: (c, mm, tt, pk) => {
      const gyb = Math.sin(tt * 2.1) * 6; reticleV2(c, G.fx, G.fy + gyb, G.fr * 2.0 * (1 + 0.25 * Math.exp(-mm * 10)), HUD_R, 0, false);
      const lk = lin(mm, 0, 0.12); c.save(); c.translate(G.fx - 500, G.fy + 190); c.rotate(-0.04); c.scale(slamK(lk, 2.2), slamK(lk, 2.2)); c.globalAlpha = Math.floor(mm * 10) % 2 && mm < 0.6 ? 0.6 : 1;
      c.fillStyle = HUD_R; c.fillRect(-210, -48, 420, 96); c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(-210, -48, 420, 96); hudText(c, 'LOCK ON', 0, 4, 66, '#fff', 'center'); c.restore();
      brackets(c, 640, 250, 1160, 300, 50, 'rgba(255,255,255,0.75)', 4, eo(lin(mm, 0.5, 0.8))); } });
  if (m < 0.5) { ctx.save(); ctx.globalAlpha = 0.3 * (1 - m / 0.5) * (Math.floor(m * 16) % 2); ctx.fillStyle = HUD_R; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}
function v2Scan(ctx, t) { runV2(ctx, t, { T: SC2.lock, exitKind: 'crt', cutA: 0.55, cutCol: '#ffd0d0', pre: v2ScanPre, fin: v2ScanFin }); }

// ---------------- 大量 3：VS 對決 ----------------
const VS2 = { in: 0.15, vs: 0.6, clash: 0.95, push: 2.35, win: 2.6 };
function v2VersusPre(ctx, t) {
  const T = VS2, ink = eo5(lin(t, T.in, T.in + 0.35)), ten = lin(t, T.clash, T.push);
  let cx = 960 + Math.sin(Math.max(0, t - T.clash) * 9) * 46 * ten + Math.sin(Math.max(0, t - T.clash) * 23) * 14 * ten;
  if (t > T.push) cx += (W + 900 - cx) * ei(lin(t, T.push, T.win));
  const edge = (y) => cx + (y - 540) * 0.32, pk = decay(t, [[T.vs, 1], [T.clash, 0.5], [T.push, 0.8]], 10);
  ctx.save(); camV2(ctx, CX, CY, 1.02 + pk * 0.04 + ten * 0.03); shakeAt(ctx, t, pk * 22 + ten * 7);
  // 右（紅）：主播
  ctx.save(); ctx.globalAlpha = ink; const gr = ctx.createLinearGradient(W, 0, 960, H); gr.addColorStop(0, '#ff3a4a'); gr.addColorStop(1, '#4a0010'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160);
  speedLines(ctx, 1500, 420, 50, 420, 'rgba(255,220,220,0.28)', Math.floor(t * 20), 0, 1);
  if (GIRL) { const gx = 1500 + (1 - ink) * 1100 + Math.max(0, cx - 960) * 0.5; outlineV2(ctx, GIRL_SIL, gx, 880, 1560, -0.04, '#fff', 8); drawImg(ctx, GIRL, gx, 880, 1560, -0.04); }
  ctx.restore();
  // 左（藍）：贈訂者，用分界線裁切
  ctx.save(); ctx.beginPath(); ctx.moveTo(-90, -90); ctx.lineTo(edge(-90), -90); ctx.lineTo(edge(H + 90), H + 90); ctx.lineTo(-90, H + 90); ctx.closePath(); ctx.clip();
  ctx.globalAlpha = ink; const gl = ctx.createLinearGradient(0, 0, 960, H); gl.addColorStop(0, '#3a8aff'); gl.addColorStop(1, '#0a1450'); ctx.fillStyle = gl; ctx.fillRect(-80, -80, W + 160, H + 160);
  speedLines(ctx, 420, 480, 50, 420, 'rgba(210,230,255,0.28)', Math.floor(t * 20) + 50, 0, 1);
  if (MASCOT) { const mx = 450 - (1 - ink) * 1100 + Math.min(0, cx - 960) * 0.4 + (t > T.push ? (cx - 960) * 0.55 : 0), my = 560 + Math.abs(Math.sin(t * 10)) * -18 * ten; outlineV2(ctx, MASCOT, mx, my, 900, 0.08, '#fff', 8); drawImg(ctx, MASCOT, mx, my, 900, 0.08); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = ink; ctx.strokeStyle = '#fff'; ctx.lineWidth = 18; ctx.shadowColor = '#fff'; ctx.shadowBlur = 36; ctx.beginPath(); ctx.moveTo(edge(-90), -90); ctx.lineTo(edge(H + 90), H + 90); ctx.stroke(); ctx.restore();
  if (t > T.clash) for (let i = 0; i < 5; i++) { const y = 100 + ((t * 700 + i * 210) % 880); sparkBurst(ctx, edge(y), y, (t * 3 + i * 0.25) % 0.6, 9, 1.4, i % 2 ? '#bfe0ff' : '#ffd0c8'); }
  // 名牌（左下）
  const nk = eo5(lin(t, T.in + 0.2, T.in + 0.5));
  if (nk > 0) { ctx.save(); ctx.translate(-760 * (1 - nk), 0); ctx.fillStyle = 'rgba(5,10,40,0.88)'; ctx.beginPath(); ctx.moveTo(50, 880); ctx.lineTo(800, 880); ctx.lineTo(752, 1010); ctx.lineTo(2, 1010); ctx.fill(); ctx.fillStyle = '#5fd0ff'; ctx.fillRect(40, 1002, 720, 8);
    hudText(ctx, 'GIFTER', 96, 860, 30, '#8fc4ff'); ctx.font = "900 70px 'Noto Sans TC'"; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(P.name, 84, 946, 650); ctx.restore(); }
  // 集氣條＋份數
  if (t > T.clash) { const q = eo(ten), n = Math.max(1, Math.round(CFG.n * q)), a = eo(lin(t, T.clash, T.clash + 0.2));
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(70, 62, 780, 56); const bar = ctx.createLinearGradient(70, 0, 850, 0); bar.addColorStop(0, '#5fd0ff'); bar.addColorStop(1, '#ffffff'); ctx.fillStyle = bar; ctx.fillRect(76, 68, 768 * q, 44);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(70, 62, 780, 56); ctx.restore(); hudText(ctx, 'GIFT POWER', 76, 150, 30, '#bfe0ff', 'left', a);
    wordV2(ctx, '×' + n, 1010, 100, a, { s: 0.72, pop: false, fill: '#8fe0ff', rot: -0.04, beat: Math.sin(t * 30) * 0.03, stroke: '#061a5a', box: false }); }
  const vk = lin(t, T.vs, T.vs + 0.18);
  if (vk > 0) { const gg = ctx.createLinearGradient(0, -80, 0, 80); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffc21a'); gg.addColorStop(1, '#e07800');
    wordV2(ctx, 'VS', edge(520) - 10, 520, vk, { s: 2.5, big: 3, fill: gg, rot: -0.12, beat: Math.sin(t * 30) * 0.02 * ten, stroke: '#3a1400', depth: 14, box: false });
    if (t < T.vs + 0.5) for (let i = 0; i < 5; i++) bolt(ctx, edge(520), 520, edge(520) + Math.cos(i * 1.4 + 0.4) * 640, 520 + Math.sin(i * 1.4 + 0.4) * 440, i + Math.floor(t * 30), 7, '#fff6c0'); }
  ctx.restore();
  if (t >= T.vs) flash(ctx, (1 - lin(t, T.vs, T.vs + 0.12)) * 0.5, '#fff');
}
function v2VersusFin(ctx, m, t) {   // 結尾：漫畫三分格（勝利特寫）
  finaleV2(ctx, m, t, { style: 'manga', mascot: {},
    bg: (c) => { c.save(); c.translate(-40, -30); c.scale(1.045, 1.06); palBG(c, t, PAL.gold, 960, 400); c.restore(); },
    panelBg: (c, tt) => { c.save(); c.translate(-40, -30); c.scale(1.045, 1.06); palBG(c, tt, PAL.gold, 430, 380); c.restore(); },
    front: (c, mm) => wordV2(c, LX('victory'), 420, 930, lin(mm, 0.12, 0.27), { s: 0.9, maxW: 700, big: 2.8, fill: '#ff3a4a', rot: -0.07, stroke: '#3a0010' }) });
}
function v2Versus(ctx, t) { runV2(ctx, t, { T: VS2.win, exitKind: 'whipR', pre: v2VersusPre, fin: v2VersusFin }); }

// ---------------- 大量 4：號外 ----------------
const NW2 = { land: 1.25, move: 2.7, PH: 1010 };
function newsMainV2(ctx, t, x, y, sc, rot) {
  const PH = NW2.PH, PW = PH * NEWS_PAPER.width / NEWS_PAPER.height;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 46; ctx.shadowOffsetY = 20; ctx.fillStyle = '#000'; ctx.fillRect(-PW / 2 + 6, -PH / 2 + 6, PW - 12, PH - 12); ctx.shadowColor = 'transparent';
  drawPaper(ctx, PW, PH, t, t >= NW2.land ? t - NW2.land : -1); ctx.restore();
}
function newsFlyV2(ctx, t) {   // 背景飛過的小報紙
  for (let i = 0; i < 14; i++) { const st = NW2.land + R(i, 1) * 3.2, q = (t - st) / 1.7; if (q < 0 || q > 1) continue;
    const ph = 190 + R(i, 2) * 170, pw = ph * NEWS_PAPER.width / NEWS_PAPER.height, x = -220 + (W + 440) * q * (0.7 + R(i, 3) * 0.6), y = 100 + R(i, 4) * 880 - Math.sin(q * 3) * 90;
    ctx.save(); ctx.globalAlpha = 0.85; ctx.translate(R(i, 5) > 0.5 ? x : W - x, y); ctx.rotate(q * (R(i, 6) - 0.5) * 9); ctx.drawImage(newsSmall(), -pw / 2, -ph / 2, pw, ph); ctx.restore(); }
}
function v2ExtraPre(ctx, t) {
  const T = NW2, app = eo(lin(t, 0, 0.25)), k = eo(lin(t, 0.15, T.land)), pk = decay(t, [[T.land, 1], [T.land + 0.35, 0.5]], 10);
  ctx.save(); camV2(ctx, CX, CY, 1.014 + pk * 0.05); shakeAt(ctx, t, pk * 26);
  ctx.save(); ctx.globalAlpha = app; redBG(ctx, t, 960, 540, 0.34); if (t > T.land) halftone(ctx, 0, 0, W, H, 'rgba(255,220,200,0.12)', t); ctx.restore();
  if (t > T.land) newsFlyV2(ctx, t);
  if (t < T.land) { ctx.save(); ctx.globalAlpha = 0.5 * k; speedLines(ctx, 960, 540, 70, 300 + 400 * k, 'rgba(255,255,255,0.7)', Math.floor(t * 30), 0, 1); ctx.restore(); }
  newsMainV2(ctx, t, 960, 540 + Math.sin(t * 1.6) * 5, 0.04 + 0.96 * k, (1 - k) * Math.PI * 7);
  ringBurst(ctx, 960, 540, t - T.land, { r1: 1500, dur: 0.45 });
  ctx.restore();
  if (t >= T.land) flash(ctx, (1 - lin(t, T.land, T.land + 0.12)) * 0.55, '#fff');
}
function v2ExtraFin(ctx, m, t) {
  finaleV2(ctx, m, t, { lay: 'R', tGirl: 0.12, tTitle: 0.5, girl: { x: 1320 }, title: { x: 1210, y: 735, maxW: 1180, rot: -0.04 }, plate: { x: 1230, y: 945, sc: 0.8 },
    bg: (c, mm) => { const e = eo5(lin(mm, 0, 0.45)); redBG(c, t, mixv(960, 1320, e), mixv(540, 420, e), mixv(0.34, 0.22, e)); halftone(c, 0, 0, W, H, 'rgba(255,220,200,0.12)', t); },
    back: (c) => newsFlyV2(c, t),
    mid: (c, mm) => { const e = eo5(lin(mm, 0, 0.45)); newsMainV2(c, t, mixv(960, 440, e), 540 + Math.sin(t * 1.6) * 5, 1 - 0.1 * e, -0.07 * e + Math.sin(t * 1.2) * 0.008); },
    front: (c, mm) => wordV2(c, LX('extra'), 1610, 175, lin(mm, 0.3, 0.44), { s: 0.82, maxW: 430, big: 2.6, fill: '#ffd21a', rot: 0.06, stroke: '#4a0010' }) });
}
function v2Extra(ctx, t) { if (!NEWS_PAPER) return; runV2(ctx, t, { T: NW2.move, cut: false, exitKind: 'smear', pre: v2ExtraPre, fin: v2ExtraFin }); }

VARS.g10[1] = { name: '幸運大轉盤', fn: v2Roulette, dur: 6.1 };
VARS.g10[2] = { name: '鎖定掃描', fn: v2Scan, dur: 5.4 };
VARS.g10[3] = { name: 'VS 對決', fn: v2Versus, dur: 5.6 };
VARS.g10[4] = { name: '號外', fn: v2Extra, dur: 5.8 };
