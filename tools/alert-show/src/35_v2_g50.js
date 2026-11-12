
// ======================= V2 超大（g50）：保留變化＋機關合體／擲骰／流星墜落／演唱會轉播 =======================

// ---------------- 超大 1：保留變化＋機關合體 ----------------
const GM2 = { hold: 0.3, chg: [0.75, 1.25, 1.75, 2.25, 2.85], fly: 3.3, gattai: 3.85, labels: ['', 'チャンス', 'チャンス!', '激アツ!!', '超激アツ!!', '虹保留!!!'], bgc: ['#2a2a4a', '#123a7a', '#0e5a2e', '#7a0a1e', '#7a4a00', '#5a1a7a'] };
function crestV2(ctx, cx, cy, cw, e = 1) {   // e：四塊合體進度（0 = 在畫面外）
  const ch = cw * CREST.height / CREST.width;
  for (const [sx, sy, sw, sh, dx, dy] of [[0, 0, 0.34, 1, -1300, 0], [0.66, 0, 0.34, 1, 1300, 0], [0.34, 0, 0.32, 0.5, 0, -900], [0.34, 0.5, 0.32, 0.5, 0, 900]])
    ctx.drawImage(CREST, sx * CREST.width, sy * CREST.height, sw * CREST.width, sh * CREST.height, cx - cw / 2 + sx * cw + dx * (1 - e), cy - ch / 2 + sy * ch + dy * (1 - e), sw * cw + 1, sh * ch + 1);
}
function v2GimmickPre(ctx, t) {
  const T = GM2, app = eo(lin(t, 0, 0.3)); let lv = 0; for (const c of T.chg) if (t >= c) lv++;
  const lc = lv ? T.chg[lv - 1] : -9, q = t - lc, hits = T.chg.map((c, i) => [c, 0.45 + i * 0.14]), pk = decay(t, hits, 10), fly = lin(t, T.fly, T.gattai);
  ctx.save(); camV2(ctx, 960, 560, 1.014 + pk * 0.06 + lv * 0.012); shakeAt(ctx, t, pk * 26 + lv * 1.2);
  ctx.save(); ctx.globalAlpha = app; const gr = ctx.createRadialGradient(960, 560, 0, 960, 560, 1300); gr.addColorStop(0, T.bgc[lv]); gr.addColorStop(1, '#05030c'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (lv >= 2) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + lv * 0.09; speedLines(ctx, 960, 560, 60, 330, lv >= 5 ? `hsla(${(t * 300) % 360},100%,70%,0.5)` : 'rgba(255,255,255,0.3)', Math.floor(t * 20), 0, 1); ctx.restore(); }
  ctx.restore();
  // 中央的大保留玉：每變一次色就脹大一圈；起飛時炸成光
  const orbA = 1 - fly;
  if (orbA > 0) {
    const r = (150 + lv * 22) * (1 + (lv && q < 0.25 ? 0.5 * Math.sin(q / 0.25 * Math.PI) : 0)) * (lv >= 5 ? 1 + 0.05 * Math.sin(t * 14) : 1) * eback(lin(t, T.hold - 0.2, T.hold + 0.2), 1.6) * (1 + fly * 2);
    ctx.save(); ctx.globalAlpha = orbA; ctx.globalCompositeOperation = 'lighter'; const gl = ctx.createRadialGradient(960, 540, r * 0.6, 960, 540, r * 2.4); gl.addColorStop(0, lv >= 5 ? `hsla(${(t * 300) % 360},100%,70%,0.6)` : HOLD_COL[Math.min(4, lv)][0] + '99'); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gl; ctx.fillRect(960 - r * 2.4, 540 - r * 2.4, r * 4.8, r * 4.8); ctx.restore();
    ctx.save(); ctx.globalAlpha = orbA; holdIcon(ctx, 960, 540 + Math.sin(t * 3) * 8, r, lv, t); ctx.restore();
    if (lv) { ringBurst(ctx, 960, 540, q, { r0: r, r1: 1100, dur: 0.4, sq: 1, w: 24 }); sparkBurst(ctx, 960, 540, q, 14 + lv * 3, 1.6 + lv * 0.4, lv >= 5 ? '#fff' : HOLD_COL[Math.min(4, lv)][0]); }
    // 下方排隊的保留（3 顆白的）
    ctx.save(); ctx.globalAlpha = orbA * app; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(700, 900, 520, 116, 58); ctx.fill(); for (let i = 0; i < 3; i++) holdIcon(ctx, 800 + i * 160, 958, 40, 0, t); ctx.restore();
  }
  // 機關四塊從四個方向撞進來
  if (t >= T.fly) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 40; crestV2(ctx, 960, 540, 1500, fly * fly); ctx.restore(); }
  ctx.restore();
  if (lv && t < T.fly) { const colr = lv >= 5 ? rainbowFill(ctx, -70, 70, t) : lv >= 3 ? '#ff3a4a' : lv === 2 ? '#5cff70' : '#8fe0ff';
    wordV2(ctx, T.labels[lv], 960, 215, lin(q, 0, 0.12), { s: 0.95 + lv * 0.13, fill: colr, rot: -0.04, beat: Math.sin(t * 22) * 0.02 * lv, stroke: lv >= 3 ? '#3a0010' : '#0a1450' }); }
  if (t >= T.fly) wordV2(ctx, '合体!!', 960, 930, lin(t, T.fly + 0.1, T.fly + 0.25), { s: 1.2, fill: '#ffd21a', rot: -0.04, stroke: '#3a1400', beat: Math.sin(t * 30) * 0.03 });
  for (const c of T.chg) if (t >= c && t < c + 0.1) flash(ctx, (1 - (t - c) / 0.1) * 0.28, '#fff');
}
function v2GimmickFin(ctx, m, t) {
  finaleV2(ctx, m, t, { lay: 'C', tGirl: 0.3, tTitle: 0.75, bgC: [960, 470], title: { y: 640 }, plate: { y: 832 }, mascot: { y: 800 },
    back: (c, mm, tt, pk) => { c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 960, 470, 16, 'rgba(255,255,255,0.22)', tt * 0.6, 1900, 0.4, 16); c.filter = 'blur(40px)'; c.fillStyle = `hsla(${(tt * 200) % 360},100%,70%,0.45)`; c.beginPath(); c.ellipse(960, 470, 700, 400, 0, 0, 7); c.fill(); c.restore();
      for (let i = 0; i < 3; i++) ringBurst(c, 960, 470, mm - i * 0.08, { r1: 1500, dur: 0.7, sq: 1, w: 26 });
      c.save(); c.shadowColor = 'rgba(40,0,60,0.5)'; c.shadowBlur = 40; crestV2(c, 960, 470 + Math.sin(tt * 1.5) * 8, 1500 * (1 + pk * 0.03 + Math.exp(-mm * 9) * 0.08)); c.restore(); coinFountain(c, mm, 0, 3.2, 160); } });
}
function v2Gimmick(ctx, t) { if (!CREST) return; runV2(ctx, t, { T: GM2.gattai, exitKind: 'smear', pre: v2GimmickPre, fin: v2GimmickFin }); }

// ---------------- 超大 2：擲骰（ゾロ目） ----------------
// ---------- 立體骰子（正交投影）：三個可見面、照實際朝向畫點數；平塗兩階明暗＋深色描線 ----------
const m3mul = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
const m3v = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const rotX3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const DIE_VIEW = m3mul(rotX3(0.62), rotY3(-0.5));   // 鏡頭：往下看 35 度、偏一點側面，同時看得到上、前、右三面
const DIE_FACES = [   // 法線、面上的兩個軸、點數（對面相加為 7）：上 6、下 1、左 5、右 2、前 3、後 4
  [[0, 1, 0], [1, 0, 0], [0, 0, 1], 6], [[0, -1, 0], [1, 0, 0], [0, 0, -1], 1], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], 5],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0], 2], [[0, 0, 1], [1, 0, 0], [0, 1, 0], 3], [[0, 0, -1], [-1, 0, 0], [0, 1, 0], 4]];
function dieRest(M) { let lo = 1e9; for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) lo = Math.min(lo, m3v(M, [sx, sy, sz])[1]); return -lo; }   // 目前朝向下，骰子中心離桌面的高度（邊長為 1）
function die3D(ctx, x, y, s, M, o = {}) {   // (x,y) = 桌面上的接觸點；o.px 中心的水平位移（邊長倍數）、o.lift 離桌高度（像素）、o.glow
  const h = dieRest(M), P = m3v(DIE_VIEW, [o.px || 0, h, 0]), cx = x + P[0] * s, cy = y - P[1] * s - (o.lift || 0);
  const sh = m3v(DIE_VIEW, [o.px || 0, 0, 0]), ls = 1 / (1 + (o.lift || 0) / 500);
  ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.32 * ls})`; ctx.beginPath(); ctx.ellipse(x + sh[0] * s, y - sh[1] * s + s * 0.06, s * 0.78 * ls, s * 0.4 * ls, 0, 0, 7); ctx.fill(); ctx.restore();
  const VM = m3mul(DIE_VIEW, M);
  ctx.save(); ctx.translate(cx, cy); ctx.lineJoin = 'round';
  if (o.glow > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(30px)'; ctx.fillStyle = `rgba(255,220,120,${o.glow})`; ctx.beginPath(); ctx.arc(0, 0, s * 0.95, 0, 7); ctx.fill(); ctx.restore(); }
  // 深色底（八個頂點的外框），圓角之間的縫才不會透出背景
  const pts = []; for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) { const p = m3v(VM, [sx, sy, sz]); pts.push([p[0] * s, -p[1] * s]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o2, a, b) => (a[0] - o2[0]) * (b[1] - o2[1]) - (a[1] - o2[1]) * (b[0] - o2[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  ctx.fillStyle = '#2b1a3a'; ctx.strokeStyle = '#2b1a3a'; ctx.lineWidth = s * 0.05; ctx.beginPath(); hull.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const [n, u, v, num] of DIE_FACES) {
    const nv = m3v(VM, n); if (nv[2] <= 0.015) continue;   // 背對鏡頭的面不畫
    const C = m3v(VM, [n[0] * 0.5, n[1] * 0.5, n[2] * 0.5]), U = m3v(VM, u), Vv = m3v(VM, v), wn = m3v(M, n);
    const lit = wn[1] * 0.75 + wn[2] * 0.45 - wn[0] * 0.3;   // 光從左上前方來
    ctx.save(); ctx.transform(U[0] * s, -U[1] * s, Vv[0] * s, -Vv[1] * s, C[0] * s, -C[1] * s);
    ctx.fillStyle = lit > 0.55 ? '#ffffff' : lit > 0.1 ? '#e6def2' : '#c4b8d8'; ctx.beginPath(); ctx.roundRect(-0.47, -0.47, 0.94, 0.94, 0.13); ctx.fill();
    const pc = num === 1 ? '#e8183a' : '#2b1a3a', pr = num === 1 ? 0.14 : 0.088; ctx.fillStyle = pc;
    for (const [px, py] of DICE_PIPS[num]) { ctx.beginPath(); ctx.arc(px * 0.27, -py * 0.27, pr, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  ctx.restore();
}

function v2DicePre(ctx, t) {
  const T = DI_T, app = eo(lin(t, 0, 0.3)), won = t >= T.settle, l = t - T.settle, th = hitStop(t, [T.settle], 0.07);
  const zk = sstep(lin(t, T.land2 + 0.15, T.teeter)) * (won ? 1 - eo(lin(l, 0.02, 0.3)) : 1), pk = decay(t, [[T.land1, 0.5], [T.land2, 0.5], [T.settle, 1]], 10);
  ctx.save(); camV2(ctx, mixv(960, 1290, zk), mixv(540, 620, zk), 1.014 + 0.5 * zk + pk * 0.05); shakeAt(ctx, t, pk * 24 + (t > T.land2 && !won ? 3 : 0));
  ctx.save(); ctx.globalAlpha = app;
  if (!won) { const gg = ctx.createRadialGradient(960, 640, 0, 960, 640, 1200); gg.addColorStop(0, '#229a64'); gg.addColorStop(1, '#052a1c'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160);
    ctx.strokeStyle = '#d8a83a'; ctx.lineWidth = 16; ctx.strokeRect(54, 54, W - 108, H - 108); ctx.strokeStyle = 'rgba(255,230,160,0.35)'; ctx.lineWidth = 4; ctx.strokeRect(80, 80, W - 160, H - 160);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const sp = ctx.createRadialGradient(960, 640, 0, 960, 640, 700); sp.addColorStop(0, 'rgba(255,255,220,0.16)'); sp.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sp; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  else { rainbowBG2(ctx, t * 2.2, 960, 600); ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960, 600, 16, 'rgba(255,255,255,0.2)', t * 0.5, 1900, 0.4, 16); ctx.restore(); }
  ctx.restore();
  const s = 236, TY = 700;
  {   // 左骰：翻滾落下，停在 6
    const u = lin(th, T.drop, T.land1), e = eo(u), x = mixv(180, 700, e), lift = Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 430 + (1 - u) * 300;
    const M = u < 1 ? m3mul(rotX3((1 - e) * 13), rotZ3((1 - e) * -9)) : rotY3(0);
    die3D(ctx, x, TY, s, M, { lift: lift + (won ? 40 * eo(lin(l, 0, 0.4)) + Math.sin(t * 5) * 8 : 0), glow: won ? 0.5 + 0.25 * Math.sin(t * 8) : 0 });
    if (t >= T.land1) sparkBurst(ctx, 700, TY - 60, t - T.land1, 12, 1.4, '#fff6c0');
  }
  {   // 右骰：落在 5 和 6 之間的稜上，搖了幾下才倒向 6（以著地的那條稜為支點）
    const u = lin(th, T.drop, T.land2), e = eo(u), E = -Math.PI / 4; let a = E, lift = 0, x = 1330;
    if (u < 1) { lift = Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 430 + (1 - u) * 300; x = mixv(1900, 1330, e); }
    else if (th < T.teeter) { const k = lin(th, T.land2, T.teeter); a = E - 0.3 * Math.sin(k * Math.PI * 3.5) * (1 - 0.35 * k) - 0.06 * Math.sin(th * 21) * k; }   // 往 5 那邊晃得比較多
    else { const q = lin(th, T.teeter, T.settle); a = E * (1 - eo5(q)) + 0.07 * Math.sin(q * Math.PI) * (1 - q); }
    const M = u < 1 ? m3mul(m3mul(rotX3((1 - e) * -12), rotY3((1 - e) * 5)), rotZ3(E)) : rotZ3(a);
    const px = u < 1 ? 0 : -(0.5 * Math.cos(a) + 0.5 * Math.sin(a));   // 支點固定在桌面，中心跟著移動
    die3D(ctx, x, TY, s, M, { px, lift: lift + (won ? 40 * eo(lin(l, 0, 0.4)) + Math.sin(t * 5 + 1) * 8 : 0), glow: won ? 0.5 + 0.25 * Math.sin(t * 8) : 0 });
    if (t >= T.land2) sparkBurst(ctx, 1330, TY - 60, t - T.land2, 12, 1.4, '#fff6c0');
  }
  if (won) { ringBurst(ctx, 1000, 620, l, { r1: 1500, dur: 0.45 }); coinFountain(ctx, t, T.settle, T.settle + 1.2, 80); }
  ctx.restore();
  if (t > T.land2 + 0.1 && !won) wordV2(ctx, 'あと一歩…!?', 560, 230, lin(t, T.land2 + 0.1, T.land2 + 0.24), { s: 0.95, fill: Math.floor(t * 8) % 2 ? '#ff3a4a' : '#ffe14a', rot: -0.06, stroke: '#2a0010', beat: Math.sin(t * 24) * 0.03 });
  if (won) { wordV2(ctx, 'ゾロ目!!', 960, 250, lin(l, 0, 0.16), { s: 1.8, big: 3, fill: rainbowFill(ctx, -70, 70, t), rot: -0.07, beat: Math.sin(t * 20) * 0.02, depth: 12 }); flash(ctx, (1 - lin(l, 0, 0.18)) * 0.8, '#fff'); }
}
function v2DiceFin(ctx, m, t) {   // 結尾：巨大數字（兩顆 6 在數字兩旁）
  finaleV2(ctx, m, t, { style: 'count', mascot: false,
    front: (c, mm, tt, pk) => { const k = eo5(lin(mm, 0.75, 1.15)); if (k <= 0) return;
      [[985, 905, 0.35, 0], [1660, 905, -0.3, 1]].forEach(([x, y, yaw, i]) => die3D(c, x, y, 118, m3mul(rotY3(yaw + (1 - k) * 4), rotX3((1 - k) * 6)), { lift: (1 - k) * 500 + Math.abs(Math.sin(tt * 4 + i)) * 10, glow: 0.4 + 0.25 * Math.sin(tt * 8) })); },
    back: (c, mm) => coinFountain(c, mm, 0, 3.4, 170) });
}
function v2Dice(ctx, t) { runV2(ctx, t, { T: DI_T.settle + 0.95, exitKind: 'slice', pre: v2DicePre, fin: v2DiceFin }); }

// ---------------- 超大 3：流星墜落 ----------------
function hillsV2(ctx, col, y0 = 880) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-80, H + 80); ctx.lineTo(-80, y0 + 20); for (let x = -80; x <= W + 80; x += 80) ctx.lineTo(x, y0 + Math.sin(x * 0.006) * 46 + Math.sin(x * 0.017) * 22); ctx.lineTo(W + 80, H + 80); ctx.fill(); }
function v2MeteorPre(ctx, t) {
  const T = MT_T, app = eo(lin(t, 0, 0.3)), crashed = t >= T.crash, l = t - T.crash, u = lin(t, T.appear, T.crash), e = u * u;
  const pk = crashed ? Math.exp(-l * 4) : u * 0.3;
  ctx.save(); camV2(ctx, 960, 620, 1.02 + pk * 0.05 + (crashed ? 0 : 0.05 * e)); shakeAt(ctx, t, pk * 40);
  ctx.save(); ctx.globalAlpha = app;
  if (!crashed) { const gg = ctx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#0a0828'); gg.addColorStop(1, `rgb(${60 + 150 * u | 0},${30 + 20 * u | 0},70)`); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160); }
  else rainbowBG2(ctx, t * 2.2, 960, 820);
  for (let i = 0; i < 130; i++) { const tw = 0.6 + 0.4 * Math.sin(t * 4 + i); if (i % 10 === 0) star4(ctx, R(i, 1) * W, R(i, 2) * 760, 10 + 10 * tw, '#fff', 0.8 * tw); else { ctx.fillStyle = `rgba(255,255,240,${0.3 + 0.6 * R(i, 3) * tw})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * 760, 3, 3); } }
  for (let i = 0; i < 9; i++) { const st = 0.15 + i * 0.3, q = (t - st) / 0.5; if (q < 0 || q > 1 || st > T.crash) continue; const x = 200 + R(i, 4) * 1500 + 700 * q, y = 60 + R(i, 5) * 320 + 340 * q;   // 小流星
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createLinearGradient(x - 300, y - 150, x, y); gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(1, `rgba(255,250,220,${1 - q})`); ctx.strokeStyle = gg; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 300, y - 150); ctx.lineTo(x, y); ctx.stroke(); ctx.restore(); }
  if (!crashed && u > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gl = ctx.createRadialGradient(960, 900, 0, 960, 900, 1100); gl.addColorStop(0, `rgba(255,120,60,${0.45 * e})`); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gl; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore(); }
  hillsV2(ctx, crashed ? '#3a1a5a' : '#120822');
  ctx.restore();
  if (t > T.appear && !crashed) {   // 大流星：越來越大，拖著火尾
    const x = 1880 - 920 * e, y = -160 + 1000 * e, r = 40 + 260 * e;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(12px)';
    for (let k = 0; k < 5; k++) { const tl = r * (3 + k * 1.2), gg = ctx.createLinearGradient(x + tl * 0.7, y - tl * 0.9, x, y); gg.addColorStop(0, 'rgba(255,120,40,0)'); gg.addColorStop(1, ['rgba(255,240,180,0.9)', 'rgba(255,190,80,0.7)', 'rgba(255,120,60,0.55)', 'rgba(255,80,120,0.4)', 'rgba(200,120,255,0.3)'][k]); ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(x - r * 0.8, y - r * 0.2 + k * 6); ctx.lineTo(x + tl * 0.7, y - tl * 0.9); ctx.lineTo(x + r * 0.2, y + r * 0.8); ctx.fill(); }
    ctx.restore();
    for (let i = 0; i < 12; i++) { const q = (t * 3 + R(i, 9)) % 1; ctx.save(); ctx.globalCompositeOperation = 'lighter'; star4(ctx, x + q * r * 3 * (0.6 + R(i, 10) * 0.6) + (R(i, 11) - 0.5) * r, y - q * r * 3.6 + (R(i, 12) - 0.5) * r, (26 + r * 0.12) * (1 - q), '#fff2a8', 1 - q); ctx.restore(); }
    starShape(ctx, x, y, r, t * 6, '#ffd84a', '#7a3a00'); starShape(ctx, x - r * 0.12, y - r * 0.12, r * 0.45, t * 6, '#fff6c0');
  }
  if (crashed) {
    for (let i = 0; i < 3; i++) { const q = (l - i * 0.1) / 0.8; if (q < 0 || q > 1) continue; ctx.save(); ctx.globalAlpha = 1 - q; ctx.strokeStyle = '#fff6d0'; ctx.lineWidth = 34 * (1 - q) + 4; ctx.beginPath(); ctx.ellipse(960, 860, 100 + 1500 * eo(q), 40 + 420 * eo(q), 0, 0, 7); ctx.stroke(); ctx.restore(); }
    lightPillar(ctx, 960, 880, 620 + l * 200, Math.min(1, l * 4));
  }
  ctx.restore();
  if (u > 0.4 && !crashed) {   // 警告：上下黃黑警示帶＋紅色大字
    const a = eo(lin(u, 0.4, 0.5)); hazard(ctx, -70 + 70 * a, 70, t * 300); hazard(ctx, H - 70 * a, 70, -t * 300);
    ctx.save(); ctx.globalAlpha = 0.14 * a * (Math.floor(t * 8) % 2); ctx.fillStyle = '#ff2a3a'; ctx.fillRect(0, 0, W, H); ctx.restore();
    wordV2(ctx, 'WARNING!!', 720, 300, lin(u, 0.4, 0.48), { s: 1.1, fill: Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a', rot: -0.06, stroke: '#1a0008', beat: Math.sin(t * 30) * 0.03 });
  }
  if (crashed) flash(ctx, (1 - lin(l, 0, 0.3)) * 0.9, '#fff');
}
function v2MeteorFin(ctx, m, t) {
  finaleV2(ctx, m, t, { style: 'vertical', tGirl: 0.02, tTitle: 0.5, girl: { x: 1400, from: 'below' }, bgC: [1400, 520],   // 結尾：直書大字
    back: (c, mm, tt, pk) => { const k = eback(lin(mm, 0, 0.45), 1.5);
      for (let i = 0; i < 46; i++) { const q = ((tt * 0.55 + R(i, 6)) % 1); starShape(c, R(i, 7) * W, -80 + q * 1300, 16 + R(i, 8) * 20, q * 6 + i, `hsl(${(i * 37) % 360},90%,75%)`, '#3a1a5a'); }   // 星星雨
      c.save(); c.shadowColor = 'rgba(255,240,170,0.9)'; c.shadowBlur = 60; starShape(c, 1400, 540, 640 * k * (1 + pk * 0.03), tt * 0.25, 'rgba(255,240,170,0.95)', '#c87a00'); c.restore();
      c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 1400, 540, 10, 'rgba(255,255,255,0.2)', -tt * 0.3, 1900, 0.3, 16); c.restore(); } });
}
function v2Meteor(ctx, t) { runV2(ctx, t, { T: MT_T.crash + 0.5, cutA: 0.6, exitKind: 'crt', pre: v2MeteorPre, fin: v2MeteorFin }); }

// ---------------- 超大 4：演唱會轉播 ----------------
function lasersV2(ctx, t, n = 9, a = 0.5) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < n; i++) { const ang = Math.PI / 2 + Math.sin(t * 2 + i) * 0.7, x = 120 + i * (W - 240) / (n - 1); ctx.strokeStyle = `hsla(${(i * 45 + t * 60) % 360},100%,65%,${a})`; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x + Math.cos(ang) * 1600, 40 + Math.sin(ang) * 1600); ctx.stroke(); } ctx.restore(); }
function crowdV2(ctx, t, y0, sc = 1, rows = 1) {   // 觀眾剪影＋螢光棒；y0 = 頭頂大約高度
  for (let rw = rows - 1; rw >= 0; rw--) { const n = Math.round(30 / sc) + rw * 3;
    for (let i = 0; i < n; i++) { const x = (i + 0.5 + (rw % 2) * 0.5) * W / n + (R(i, 1 + rw) - 0.5) * 30, y = y0 - rw * 90 * sc + R(i, 2 + rw) * 50 * sc, hr = (42 + R(i, 3) * 10) * sc, wave = Math.sin(t * 7 + i * 0.6 + rw) * 0.5, hue = [330, 200, 50, 280][Math.floor(t * 1.5 + i + rw) % 4];
      ctx.save(); ctx.translate(x + 44 * sc, y + 10 * sc); ctx.rotate(wave); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(4px)'; ctx.fillStyle = `hsl(${hue},100%,65%)`; ctx.fillRect(-8 * sc, -150 * sc, 16 * sc, 150 * sc); ctx.restore();
      ctx.fillStyle = rw ? '#150826' : '#0a0414'; ctx.beginPath(); ctx.arc(x, y + hr, hr, 0, 7); ctx.fill(); ctx.fillRect(x - hr * 1.3, y + hr * 1.6, hr * 2.6, 400); } }
}
function fireJets(ctx, xs, y, k) { if (k <= 0) return; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(8px)'; for (const x of xs) for (const [col, w] of [['rgba(255,80,30,0.8)', 80], ['rgba(255,200,60,0.9)', 46], ['rgba(255,255,220,0.9)', 20]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.4, y - 560 * k, x, y - 700 * k); ctx.quadraticCurveTo(x + w * 0.4, y - 560 * k, x + w, y); ctx.fill(); } ctx.restore(); }
function stageWide(ctx, t) {   // 全景：大螢幕（臉部特寫）、舞台、角色、觀眾
  const gg = ctx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#120828'); gg.addColorStop(1, '#3a0a4a'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160); lasersV2(ctx, t);
  ctx.fillStyle = '#05030c'; ctx.fillRect(380, 70, 1160, 600); ctx.save(); ctx.beginPath(); ctx.rect(398, 88, 1124, 564); ctx.clip();
  ctx.fillStyle = '#ffd6f0'; ctx.fillRect(398, 88, 1124, 564); if (GIRL) { const gh = 2300, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, 960 - FACE.x * gw, 300 - FACE.y * gh, gw, gh); }
  ctx.fillStyle = 'rgba(0,0,0,0.16)'; for (let y = 88; y < 652; y += 6) ctx.fillRect(398, y, 1124, 2); ctx.restore(); ctx.strokeStyle = '#6a5a8a'; ctx.lineWidth = 7; ctx.strokeRect(380, 70, 1160, 600);
  ctx.fillStyle = '#2a1640'; ctx.fillRect(-80, 800, W + 160, 400); ctx.fillStyle = '#ff5ab0'; ctx.fillRect(-80, 800, W + 160, 9);
  if (GIRL) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(20px)'; ctx.fillStyle = 'rgba(255,240,200,0.35)'; ctx.beginPath(); ctx.moveTo(900, 60); ctx.lineTo(1020, 60); ctx.lineTo(1180, 810); ctx.lineTo(740, 810); ctx.fill(); ctx.restore(); outlineV2(ctx, GIRL_SIL, 960, 640, 340, 0, '#fff', 4); drawImg(ctx, GIRL, 960, 640, 340, 0); }
  crowdV2(ctx, t, 930, 1, 2);
}
function v2ConcertPre(ctx, t) {
  const T = CO_T, app = eo(lin(t, 0, 0.3));
  ctx.save(); ctx.globalAlpha = app;
  if (t < T.cut1) { ctx.save(); camV2(ctx, 960, 560, 1.02 + 0.06 * (t / T.cut1)); stageWide(ctx, t); ctx.restore(); broadcastUI(ctx, t, 'CAM 1  WIDE'); }
  else if (t < T.cut2) {   // 臉部特寫＋字幕條
    const l = t - T.cut1, z = 1 + 0.08 * l; rainbowBG2(ctx, t * 2.2, 960, 540); ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(0, 0, W, H);
    if (GIRL) { const gh = 2700 * z, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, 1100 - FACE.x * gw, 500 - FACE.y * gh, gw, gh); }
    broadcastUI(ctx, t, 'CAM 3  CLOSE-UP');
    const k = eo5(lin(l, 0.12, 0.38)); ctx.save(); ctx.translate(-1100 * (1 - k), 0); ctx.fillStyle = 'rgba(200,16,60,0.94)'; ctx.fillRect(0, 780, 1060, 170); ctx.fillStyle = '#fff'; ctx.fillRect(0, 780, 1060, 8); ctx.fillStyle = '#ffe14a'; ctx.fillRect(0, 942, 1060, 8);
    inkText(ctx, 'SPECIAL THANKS', 520, 826, 46, '#ffe08a', '#5a0018'); inkText(ctx, P.name, 520, 896, 72, '#ffffff', '#5a0018'); ctx.restore();
  } else {   // 觀眾席：螢光棒海
    const l = t - T.cut2, gg = ctx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#2a0a4a'); gg.addColorStop(1, '#0a0418'); ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H); lasersV2(ctx, t, 7, 0.35);
    ctx.save(); camV2(ctx, 960, 700, 1 + 0.06 * l); crowdV2(ctx, t * 1.4, 620, 1.9, 3); ctx.restore(); broadcastUI(ctx, t, 'CAM 5  AUDIENCE');
    wordV2(ctx, 'アンコール!!', 960, 250, lin(l, 0.05, 0.2), { s: 1.5, fill: '#ff3a8c', rot: -0.05, stroke: '#2a0030', beat: Math.sin(t * 16) * 0.03 });
  }
  ctx.restore();
  for (const ct of [T.cut1, T.cut2]) if (t >= ct && t < ct + 0.08) flash(ctx, (1 - (t - ct) / 0.08) * 0.6, '#fff');
}
function v2ConcertFin(ctx, m, t) {
  finaleV2(ctx, m, t, { style: 'lower', tag: 'LIVE', ticker: false, led: false, tTitle: 0.38, safe: { top: 70, bot: 972 }, title: { y: 290 },   // 結尾：轉播字幕條
    bg: (c) => { const gg = c.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#1a0a3a'); gg.addColorStop(1, '#5a1070'); c.fillStyle = gg; c.fillRect(-80, -80, W + 160, H + 160); c.save(); c.globalAlpha = 0.55; rainbowBG2(c, t * 2.2, 1400, 420); c.restore(); lasersV2(c, t, 9, 0.45); },
    back: (c, mm, tt) => { fireJets(c, [150, 620, 1090, 1790], 1080, Math.max(0, Math.sin(Math.PI * lin(mm, 0.05, 1.1)))); fireworksAt(c, tt, [[CO_T.cut3 + 0.15, 300, 200, 30], [CO_T.cut3 + 0.45, 900, 150, 200], [CO_T.cut3 + 0.9, 560, 420, 300], [CO_T.cut3 + 1.4, 240, 380, 120], [CO_T.cut3 + 1.9, 820, 260, 60]]); },
    front: (c, mm, tt) => { crowdV2(c, tt, 985, 0.9, 1); } });
  broadcastUI(ctx, t, 'CAM 1  WIDE');
}
function v2Concert(ctx, t) { runV2(ctx, t, { T: CO_T.cut3, cutA: 0.6, exitKind: 'whipR', pre: v2ConcertPre, fin: v2ConcertFin }); }

VARS.g50[1] = { name: '保留變化＋機關合體', fn: v2Gimmick, dur: 7.6 };
VARS.g50[2] = { name: '擲骰ゾロ目', fn: v2Dice, dur: 7.6 };
VARS.g50[3] = { name: '流星墜落', fn: v2Meteor, dur: 7.2 };
VARS.g50[4] = { name: '演唱會轉播', fn: v2Concert, dur: 7.4 };
