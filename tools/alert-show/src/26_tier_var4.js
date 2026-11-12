
// ======================= 第四批：贈訂特大（g25） =======================
let CHEST_BODY = null, CHEST_LID = null, ROCKET = null;
const CHEST_GEO = { lidDY: 0.43 };   // 蓋子蓋上時，蓋子底緣在箱身頂端往下多少（箱身高比例）
const _lvaBase5 = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaBase5();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  CHEST_BODY = await L2('DEF_CHEST_BODY', 'chest_body.png'); CHEST_LID = await L2('DEF_CHEST_LID', 'chest_lid.png'); ROCKET = await L2('DEF_ROCKET', 'rocket.png');
};
function bigCount(ctx, t, x, y, size, k) {   // 「×N」大字，k = 進場進度
  if (k <= 0) return; const s = k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1 + Math.sin(t * 6) * 0.015;
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.06); ctx.scale(s, s); smallTitle(ctx, t, '×' + CFG.n, 0, 0, size, PAL.gold, 'center'); ctx.restore();
}
function nameAt(ctx, x, y, a, size = 48, stroke = '#3a1400') {
  if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.font = `900 ${size}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke; ctx.lineWidth = size * 0.25; ctx.strokeText(nameLine(), x, y); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), x, y); ctx.restore();
}

// ---------------- 特大 1：寶箱 ----------------
const CH_T = { drop: 0.2, land: 0.55, r1: 1.0, r2: 1.55, r3: 2.0, open: 2.45 };
function vChest(ctx, t) {
  if (!CHEST_BODY) return;
  const D = CFG.dur, T = CH_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), opened = t >= T.open;
  ctx.save(); ctx.globalAlpha = app * (1 - out); palBG(ctx, t, PAL.gold, 960, 620); ctx.fillStyle = `rgba(40,16,0,${opened ? 0.1 : 0.45})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  const bw = 560, sc = bw / CHEST_BODY.width, bh = CHEST_BODY.height * sc, lw = CHEST_LID.width * sc, lh = CHEST_LID.height * sc, cx = 960, base = 1010;
  // 落下＋三次搖晃（一次比一次大），每次蓋縫漏光
  let y = base, jx = 0, rot = 0, lift = 0, leak = 0;
  if (t < T.land) { const u = lin(t, T.drop, T.land); y = -200 + (base + 200) * u * u; }
  const sq = t >= T.land ? Math.exp(-(t - T.land) * 12) * Math.sin((t - T.land) * 40) : 0;
  [[T.r1, 0.5], [T.r2, 0.75], [T.r3, 1]].forEach(([rt, p]) => { const l = t - rt; if (l > 0 && l < 0.35) { const k = Math.sin(l / 0.35 * Math.PI); y -= 40 * p * k; jx += Math.sin(l * 70) * 10 * p; rot += Math.sin(l * 50) * 0.05 * p; lift += 26 * p * k; } if (l > 0) leak = Math.max(leak, p * Math.exp(-l * 1.5)); });
  if (t > T.r3) leak = Math.max(leak, lin(t, T.r3 + 0.2, T.open));
  const pk = t >= T.land && t < T.land + 0.3 ? 1 - (t - T.land) / 0.3 : opened ? Math.exp(-(t - T.open) * 7) : 0;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * pk * 20, (R(Math.floor(t * 60), 2) - 0.5) * pk * 20);
  // 開箱：光柱、角色從箱子裡升起（箱身前緣蓋住下半）
  if (opened) { const l = t - T.open;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(20px)'; const gp = ctx.createLinearGradient(0, base - bh, 0, -100); gp.addColorStop(0, `rgba(255,245,200,${0.95 * Math.min(1, l * 4)})`); gp.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = gp; ctx.beginPath(); ctx.moveTo(cx - bw * 0.4, base - bh * 0.6); ctx.lineTo(cx + bw * 0.4, base - bh * 0.6); ctx.lineTo(cx + bw * 0.9, -100); ctx.lineTo(cx - bw * 0.9, -100); ctx.fill(); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, cx, base - bh * 0.6, 16, `rgba(255,240,180,${0.25 * Math.min(1, l * 3)})`, l * 0.5, 1800, 0.4, 16); ctx.restore();
    coinFountain(ctx, t, T.open, T.open + 2.0, 110);   // 金幣在角色後面噴
    const gk = eo(lin(l, 0.15, 0.85)); if (GIRL && gk > 0) { const gh = 820, gy = base - bh * 0.4 + gh / 2 - (gh * 0.95) * gk; ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, base - bh * 0.55); ctx.clip(); neonOutline(ctx, GIRL_SIL, cx, gy, gh, t, 0); drawImg(ctx, GIRL, cx, gy, gh, 0); ctx.restore(); }
  }
  ctx.save(); ctx.translate(cx + jx, y); ctx.rotate(rot); ctx.scale(1 + sq * 0.06, 1 - sq * 0.06);
  if (leak > 0 && !opened) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)'; ctx.fillStyle = `rgba(255,240,170,${leak})`; ctx.fillRect(-bw * 0.46, -bh + bh * CHEST_GEO.lidDY - 14 - lift, bw * 0.92, 18 + lift); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(12px)'; for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i - 3.5) * 0.18; ctx.strokeStyle = `rgba(255,240,180,${0.4 * leak})`; ctx.lineWidth = 26; ctx.beginPath(); ctx.moveTo(0, -bh + bh * CHEST_GEO.lidDY - lift); ctx.lineTo(Math.cos(a) * 900 * leak, -bh + Math.sin(a) * 900 * leak); ctx.stroke(); } ctx.restore(); }
  ctx.drawImage(CHEST_BODY, -bw / 2, -bh, bw, bh);
  if (!opened) ctx.drawImage(CHEST_LID, -lw / 2, -bh + bh * CHEST_GEO.lidDY - lh - lift, lw, lh);
  ctx.restore();
  if (opened) { const l = t - T.open, ly = y - bh + bh * CHEST_GEO.lidDY - lh / 2 - 2600 * l + 2400 * l * l; if (ly > -400) { ctx.save(); ctx.translate(cx + l * 700, ly); ctx.rotate(l * 9); ctx.drawImage(CHEST_LID, -lw / 2, -lh / 2, lw, lh); ctx.restore(); } }
  ctx.restore();
  if (t >= T.land && t < T.land + 0.6) for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const l = (t - T.land) / 0.6; ctx.save(); ctx.globalAlpha = 0.5 * (1 - l); ctx.fillStyle = '#fff3d8'; ctx.beginPath(); ctx.arc(cx + sx * (bw * 0.45 + l * 220 + i * 30), base - 10 - i * 12 - l * 30, 22 + l * 40 - i * 4, 0, 7); ctx.fill(); ctx.restore(); }
  if (opened) {
    const l = t - T.open;
    confetti(ctx, t, T.open + 0.1, 80, ['#ffd24a', '#ff5a6a', '#ffffff', '#ffb000'], 31);
    const tk = lin(l, 0.6, 0.8); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(420, 330); ctx.rotate(-0.07); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 120, PAL.gold, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1500, 380, 220, lin(l, 0.75, 0.95)); ctx.restore();
    nameAt(ctx, 420, 450, eo(lin(l, 0.85, 1.05)) * (1 - out));
    flash(ctx, (1 - lin(t, T.open, T.open + 0.15)) * 0.7, '#fff6d0');
  }
}

// ---------------- 特大 2：火箭 ----------------
const RK_T = { ign: 0.35, lift: 1.25, space: 2.2, loop0: 2.45, loop1: 3.55, exit: 3.85 };
const RK_LOOP = { cx: 960, cy: 470, r: 330 };
function rocketPos(t) {   // 回傳 [x, y, 角度]（畫面座標，已含鏡頭）
  const T = RK_T, L = RK_LOOP;
  if (t < T.lift) return [960, 820, 0];
  if (t < T.space) { const u = lin(t, T.lift, T.space); return [960, 820 - 1300 * u * u, 0]; }   // 衝出畫面（鏡頭追上）
  if (t < T.loop0) { const u = eo(lin(t, T.space, T.loop0)); return [960 - L.r * u * 0.0, 1300 - (1300 - (L.cy + L.r)) * u, -Math.PI / 2 + Math.PI / 2]; }
  if (t < T.loop1) { const u = lin(t, T.loop0, T.loop1), a = Math.PI / 2 - u * Math.PI * 2; return [L.cx + Math.cos(a) * L.r, L.cy + Math.sin(a) * L.r, a - Math.PI]; }
  const u = lin(t, T.loop1, T.exit + 0.6); return [L.cx + 700 * u * u * 1.2, L.cy + L.r - 1400 * u * u, 0.6];
}
function rocketFlame(ctx, x, y, s, t, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); const f = 1 + Math.sin(t * 60) * 0.12 + R(Math.floor(t * 30), 3) * 0.15;
  for (const [col, w, h] of [['#ff4a2a', 0.42, 1.25], ['#ffb020', 0.3, 0.95], ['#fff6c0', 0.16, 0.6]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-s * w, 0); ctx.quadraticCurveTo(-s * w * 0.6, s * h * f * 0.6, 0, s * h * f); ctx.quadraticCurveTo(s * w * 0.6, s * h * f * 0.6, s * w, 0); ctx.closePath(); ctx.fill(); }
  ctx.lineWidth = 4; ctx.strokeStyle = '#3a1400'; ctx.beginPath(); ctx.moveTo(-s * 0.42, 0); ctx.quadraticCurveTo(-s * 0.25, s * 1.25 * f * 0.6, 0, s * 1.25 * f); ctx.quadraticCurveTo(s * 0.25, s * 1.25 * f * 0.6, s * 0.42, 0); ctx.stroke();
  ctx.restore();
}
function vRocket(ctx, t) {
  if (!ROCKET) return;
  const D = CFG.dur, T = RK_T, L = RK_LOOP, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3));
  const cam = eio2(lin(t, T.lift + 0.3, T.space + 0.3));   // 0 = 地面，1 = 太空
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  const sky = ctx.createLinearGradient(0, 0, 0, H); const mixc = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * cam));
  const top = mixc([90, 170, 255], [16, 10, 50]), bot = mixc([200, 235, 255], [60, 20, 90]); sky.addColorStop(0, `rgb(${top})`); sky.addColorStop(1, `rgb(${bot})`); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // 星星（太空才出現）
  if (cam > 0) for (let i = 0; i < 90; i++) { const x = R(i, 1) * W, y = ((R(i, 2) * H + t * 120 * (1 - lin(t, T.space, T.loop0))) % H); ctx.fillStyle = `rgba(255,255,240,${cam * (0.4 + 0.6 * R(i, 3)) * (0.6 + 0.4 * Math.sin(t * 5 + i))})`; ctx.fillRect(x, y, 3, 3); }
  // 雲：鏡頭往上時往下掉
  for (let i = 0; i < 7; i++) { const cy0 = 120 + i * 150 + cam * 1600 + (t > T.lift ? (t - T.lift) * 200 : 0), cx0 = (R(i, 4) * W + i * 300) % W; if (cy0 > H + 200) continue;
    ctx.fillStyle = '#ffffff'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(cx0 + k * 70 - 100, cy0 - (k % 2) * 30, 60 - (k % 2) * 8, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(170,200,240,0.6)'; ctx.beginPath(); ctx.ellipse(cx0 + 5, cy0 + 34, 170, 26, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(cx0 + 5, cy0 + 22, 168, 26, 0, 0, 7); ctx.fill(); }
  // 地面與發射台
  const gy = 960 + cam * 1400;
  if (gy < H + 300) { ctx.fillStyle = '#6ad06a'; ctx.fillRect(0, gy, W, H); ctx.fillStyle = '#4a4a5a'; ctx.fillRect(820, gy - 40, 280, 44); ctx.strokeStyle = '#2a2440'; ctx.lineWidth = 5; ctx.strokeRect(820, gy - 40, 280, 44); }
  ctx.restore();
  // 煙：點火後在發射台堆起，升空後留在地面
  if (t > T.ign) for (let i = 0; i < 26; i++) { const st = T.ign + R(i, 5) * 1.2, l = t - st; if (l < 0) continue; const side = R(i, 6) - 0.5, x = 960 + side * (200 + l * 700), y = gy - 30 - l * 60 * R(i, 7) + cam * 0, r = 50 + l * 90;
    ctx.save(); ctx.globalAlpha = (1 - out) * Math.max(0, 0.95 - l * 0.35); ctx.fillStyle = '#d8d4dc'; ctx.beginPath(); ctx.arc(x + r * 0.12, y + r * 0.15, r, 0, 7); ctx.fill(); ctx.fillStyle = '#f7f5f2'; ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, 7); ctx.fill(); ctx.restore(); }
  // 繞圈的光跡
  if (t > T.loop0) { const u1 = Math.min(1, lin(t, T.loop0, T.loop1)); ctx.save(); ctx.globalAlpha = 1 - out; ctx.lineCap = 'round';
    for (const [w, c] of [[44, 'rgba(255,190,80,0.35)'], [22, 'rgba(255,230,150,0.9)'], [8, '#ffffff']]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(L.cx, L.cy, L.r, Math.PI / 2, Math.PI / 2 - u1 * Math.PI * 2 - 0.0001, true); ctx.stroke(); } ctx.restore(); }
  // 火箭
  const [rx, ry, ra] = rocketPos(t), shake = t > T.ign && t < T.lift ? (R(Math.floor(t * 60), 8) - 0.5) * 10 : 0, rh = t < T.space ? 360 : 230;
  if (rx > -300 && rx < W + 300 && ry > -400 && ry < H + 400) {
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(rx + shake, ry); ctx.rotate(ra);
    if (t > T.ign) rocketFlame(ctx, 0, rh * 0.46, rh * 0.32 * (t > T.lift ? 1.3 : 0.7 + 0.3 * lin(t, T.ign, T.lift)), t, 0);
    ctx.drawImage(ROCKET, -ROCKET.width * rh / ROCKET.height / 2, -rh / 2, ROCKET.width * rh / ROCKET.height, rh); ctx.restore();
  }
  // 倒數
  if (t < T.lift + 0.1) { const n = t < 0.65 ? '3' : t < 0.95 ? '2' : '1', st = t < 0.65 ? 0.35 : t < 0.95 ? 0.65 : 0.95, k = lin(t, st, st + 0.12); if (t > 0.35) { ctx.save(); ctx.translate(1420, 420); const s = 1.8 - 0.8 * eo(k); ctx.scale(s, s); ctx.globalAlpha = 1 - lin(t - st, 0.2, 0.3); smallTitle(ctx, t, n, 0, 0, 200, PAL.red, 'center'); ctx.restore(); } }
  if (t >= T.lift && t < T.lift + 0.5) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.lift + 0.3, T.lift + 0.5); ctx.translate(1420, 420); smallTitle(ctx, t, 'LIFT OFF!', 0, 0, 120, PAL.red, 'center'); ctx.restore(); }
  // 圈圈完成：光環裡出現角色，煙火
  if (t > T.loop1) { const l = t - T.loop1, k = eback(lin(l, 0.05, 0.4), 1.6);
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; godRays(ctx, L.cx, L.cy, 14, `rgba(255,230,160,${0.25 * Math.min(1, l * 3)})`, l * 0.4, 1600, 0.4, 16); ctx.restore();
    if (k > 0) { ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(L.cx, L.cy); ctx.scale(k, k); drawBust(ctx, 0, 0, L.r - 40, t); ctx.restore(); }
    fireworksAt(ctx, t, [[T.loop1 + 0.15, 380, 260, 40], [T.loop1 + 0.35, 1540, 230, 200], [T.loop1 + 0.6, 1600, 560, 320], [T.loop1 + 0.8, 320, 600, 120]]);
    const tk = lin(l, 0.35, 0.55); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(L.cx, L.cy + L.r + 110); ctx.rotate(-0.03); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 110, PAL.gold, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1530, 470, 190, lin(l, 0.5, 0.7)); ctx.restore();
    nameAt(ctx, L.cx, L.cy + L.r + 210, eo(lin(l, 0.6, 0.8)) * (1 - out), 46, '#1a0838');
    flash(ctx, (1 - lin(t, T.loop1, T.loop1 + 0.15)) * 0.6, '#fff6d0');
  }
}
VARS.g25[1] = { name: '寶箱', fn: vChest, dur: 6.0 };
VARS.g25[2] = { name: '火箭', fn: vRocket, dur: 6.0 };

// ---------------- 特大 3：舞台大幕 ----------------
let CURT_L = null, CURT_R = null, CURT_TOP = null;
const _lvaBase6 = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaBase6();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  CURT_L = await L2('DEF_CURT_L', 'curtain_l.png'); CURT_R = await L2('DEF_CURT_R', 'curtain_r.png'); CURT_TOP = await L2('DEF_CURT_TOP', 'curtain_top.png');
};
const CU_T = { peek0: 1.25, peek1: 2.05, open: 2.35, opened: 3.0 };
function vCurtain(ctx, t) {
  if (!CURT_L) return;
  const D = CFG.dur, T = CU_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), pal = PAL[CFG.pal];
  const ok = eio2(lin(t, T.open, T.opened)), lit = lin(t, T.open + 0.2, T.open + 0.6);
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  // 舞台：開幕前很暗，開幕後金色＋光束
  ctx.fillStyle = '#1a0606'; ctx.fillRect(0, 0, W, H);
  if (lit > 0) { ctx.save(); ctx.globalAlpha *= lit; palBG(ctx, t, PAL.gold, 960, 460); ctx.restore(); }
  ctx.fillStyle = '#5a2a14'; ctx.beginPath(); ctx.ellipse(960, 1080, 1100, 170, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#7a3e1e'; ctx.beginPath(); ctx.ellipse(960, 1090, 1000, 140, 0, Math.PI, 0); ctx.fill();
  if (lit > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(18px)';
    [[300, '#ff6ab0', 0.4], [1620, '#5fc8ff', -0.4], [700, '#fff3c0', 0.15], [1220, '#fff3c0', -0.15]].forEach(([x, c, a], i) => { const sw = Math.sin(t * 1.6 + i) * 0.12; ctx.save(); ctx.translate(x, -40); ctx.rotate(a + sw); const g = ctx.createLinearGradient(0, 0, 0, 1200); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.45 * lit; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(30, 0); ctx.lineTo(260, 1200); ctx.lineTo(-260, 1200); ctx.fill(); ctx.restore(); });
    ctx.restore(); }
  // 角色：偷看時只露臉，開幕後全身
  if (GIRL) {
    const pk = t > T.peek0 && t < T.peek1 + 0.1 ? Math.sin(Math.PI * lin(t, T.peek0, T.peek1 + 0.1)) : 0;
    if (t < T.open && pk > 0) { const G = girlGeo(960, 0, 1100); const fx = 960 + 40, fy = 470; ctx.save(); ctx.translate(fx - (G.fx - 960) - 60 * (1 - pk), fy - G.fy); ctx.rotate(-0.12); drawImg(ctx, GIRL, 0, 0, 1100, 0); ctx.restore(); }
    if (t >= T.open) { const k = eback(lin(t, T.open + 0.25, T.opened + 0.1), 1.4); if (k > 0) { ctx.save(); ctx.translate(780, 700); ctx.scale(k, k); neonOutline(ctx, GIRL_SIL, 0, 0, 760, t, 0); drawImg(ctx, GIRL, 0, 0, 760, 0); ctx.restore(); } }
  }
  if (MASCOT && t > T.opened) { const k = eback(lin(t, T.opened, T.opened + 0.35), 1.6); drawImg(ctx, MASCOT, 520, 1100 - 200 * k, 340, -0.12); }
  // 布幕：關上時各蓋半邊，微微晃動；偷看時中間拉開一條縫；開幕時往兩側收攏
  const cH = 1180, sway = Math.sin(t * 2.2) * 6, peekGap = t > T.peek0 && t < T.open ? 70 * Math.sin(Math.PI * lin(t, T.peek0, T.peek1 + 0.1)) : 0;
  for (const side of [-1, 1]) {
    const img = side < 0 ? CURT_L : CURT_R, wClosed = 1010, w = wClosed * (1 - 0.62 * ok), xIn = 960 + side * (peekGap + 300 * 0) , edge = side < 0 ? 960 - peekGap - (960 - peekGap) * ok * 0 : 960 + peekGap;
    const x0 = side < 0 ? (edge - w) - ok * (960 - w) * 0 - ok * 0 : edge, xx = side < 0 ? -40 + (edge + 40 - w) * (1 - ok) + 0 : edge + (W + 40 - edge - w) * ok;
    const drawX = side < 0 ? (ok > 0 ? -40 : edge - w) : xx;
    ctx.save(); ctx.translate(sway * side * (1 - ok), 0); ctx.drawImage(img, drawX, -60, w, cH); ctx.restore();
  }
  // 帷頭
  const th = 290, tw = W + 80; ctx.drawImage(CURT_TOP, -40, -40, tw, th);
  ctx.restore();
  // 開幕前：聚光燈在布幕上掃
  if (t < T.open + 0.2) { const a = (1 - lin(t, T.open, T.open + 0.2)) * app; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(26px)';
    for (const [ph, sp] of [[0, 1.3], [2, 1.7]]) { const x = 960 + Math.sin(t * sp + ph) * 520 * (1 - lin(t, T.peek0 - 0.3, T.peek0)), y = 560 + Math.cos(t * sp * 0.7 + ph) * 120; const g = ctx.createRadialGradient(x, y, 0, x, y, 260); g.addColorStop(0, `rgba(255,245,210,${0.55 * a})`); g.addColorStop(1, 'rgba(255,230,160,0)'); ctx.fillStyle = g; ctx.fillRect(x - 260, y - 260, 520, 520); }
    ctx.restore(); }
  if (t > T.peek0 + 0.15 && t < T.peek1) { ctx.save(); ctx.globalAlpha = Math.min(1, (t - T.peek0 - 0.15) * 6) * (1 - lin(t, T.peek1 - 0.15, T.peek1)); ctx.translate(1300, 420); ctx.rotate(0.08); smallTitle(ctx, t, 'まもなく開演', 0, 0, 64, PAL.gold, 'center'); ctx.restore(); }
  if (t >= T.open) {
    const l = t - T.open;
    confetti(ctx, t, T.open + 0.3, 90, ['#ffd24a', '#ff5a8a', '#5fc8ff', '#ffffff', '#9dff8a'], 41);
    for (const sx of [-1, 1]) { const q = l - 0.35; if (q > 0 && q < 0.8) for (let i = 0; i < 24; i++) { const a = -Math.PI / 2 - sx * (0.35 + R(i, 1) * 0.5), v = 900 + R(i, 2) * 700, x = 960 + sx * 900 + Math.cos(a) * v * q, y = 1000 + Math.sin(a) * v * q + 900 * q * q; ctx.fillStyle = ['#ffd24a', '#ff5a8a', '#5fc8ff', '#fff'][i % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(q * 12 + i); ctx.fillRect(-8, -4, 16, 8); ctx.restore(); } }
    const tk = lin(l, 0.6, 0.8); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(1260, 420); ctx.rotate(-0.05); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 100, pal, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1270, 610, 180, lin(l, 0.75, 0.95)); ctx.restore();
    nameAt(ctx, 1260, 780, eo(lin(l, 0.85, 1.05)) * (1 - out), 40);
    flash(ctx, (1 - lin(t, T.open + 0.2, T.open + 0.35)) * 0.4 * (t > T.open + 0.2 ? 1 : 0), '#fff6d0');
  }
}
VARS.g25[3] = { name: '舞台大幕', fn: vCurtain, dur: 6.0 };

// ---------------- 特大 4：十連抽 ----------------
const TP_T = { deal: 0.3, flip0: 1.25, step: 0.14, conf: 2.55, fly: 3.35, flip: 3.7 };
function tenCardPos(i) { return [960 + (i % 5 - 2) * 236, i < 5 ? 330 : 690]; }
function vTenPull(ctx, t) {
  if (!CARD_BACK) return;
  const D = CFG.dur, T = TP_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), pal = PAL[CFG.pal], CH = 300;
  const conf = lin(t, T.conf, T.fly), won = t >= T.flip;
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  const bg = ctx.createRadialGradient(960, 540, 0, 960, 540, 1200); bg.addColorStop(0, '#3a1a6a'); bg.addColorStop(1, '#0a0420'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (conf > 0 && !won) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(ctx, 960, 540, 6, `hsla(${(h * 60 + t * 200) % 360},100%,60%,${0.12 * conf})`, t * 1.2 + h * 0.5, 1600, 0.4, 14); ctx.restore(); }
  if (won) { palBG(ctx, t, PAL.rainbow, 960, 520); ctx.fillStyle = 'rgba(20,0,40,0.25)'; ctx.fillRect(0, 0, W, H); }
  // 召喚陣
  ctx.save(); ctx.translate(960, 560); ctx.scale(1, 0.42); ctx.rotate(t * 0.6); ctx.strokeStyle = `rgba(200,170,255,${0.5 + 0.4 * conf})`; ctx.lineWidth = 6; for (const r of [520, 470, 300]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i * Math.PI / 6); star4(ctx, 0, -495, 18, '#e8dcff', 0.8); ctx.restore(); } ctx.restore();
  ctx.restore();
  // 10 張卡
  const kinds = ['r1', 'r2', 'r1', 'r2', 'r1', 'r2', 'r1', 'r2', 'r1', 'ssr'];
  for (let i = 0; i < 10; i++) {
    const [tx, ty] = tenCardPos(i), dk = eback(lin(t, T.deal + i * 0.06, T.deal + i * 0.06 + 0.35), 1.4); if (dk <= 0) continue;
    let x = 960 + (tx - 960) * dk, y = 1300 + (ty - 1300) * dk, s = 1, rot = (1 - dk) * (i - 4.5) * 0.1, al = 1 - out;
    let fk = i < 9 ? lin(t, T.flip0 + i * T.step, T.flip0 + i * T.step + 0.16) : lin(t, T.flip, T.flip + 0.3);
    if (i === 9) { if (t > T.conf && t < T.fly) { x += Math.sin(t * 70) * 6 * conf; rot += Math.sin(t * 53) * 0.04 * conf; }
      const fl = eo5(lin(t, T.fly, T.fly + 0.35)); x += (960 - x) * fl; y += (520 - y) * fl; s = 1 + 0.75 * fl; }
    else if (t > T.conf) al *= 1 - 0.55 * lin(t, T.conf, T.conf + 0.4);
    if (i === 9 && won) { const up = eback(lin(t, T.flip + 0.15, T.flip + 0.5), 1.6); s *= 1 + 0.12 * up; }
    ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * (Math.abs(Math.cos(Math.PI * fk)) || 0.001), s);
    if (i === 9 && t > T.conf && !won) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(20px)'; ctx.fillStyle = `hsla(${(t * 400) % 360},100%,65%,${0.9 * conf})`; ctx.fillRect(-CH * 0.42, -CH * 0.58, CH * 0.84, CH * 1.16); ctx.restore(); }
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
    if (fk < 0.5) { const bw = CARD_BACK.width * CH / CARD_BACK.height; ctx.drawImage(CARD_BACK, -bw / 2, -CH / 2, bw, CH); }
    else { ctx.shadowColor = 'transparent'; const r = cardFace(ctx, kinds[i] === 'ssr' ? 'ssr' : 'r', CH, t, kinds[i]);
      if (kinds[i] === 'ssr' && r) { const nk = lin(t, T.flip + 0.4, T.flip + 0.6); if (nk > 0) { ctx.globalAlpha = al * nk; ctx.font = "900 22px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a3000'; ctx.fillText(P.name, 0, r.plateY); } } }
    ctx.restore();
    if (i < 9 && fk > 0 && fk < 1) sparkBurst(ctx, x, y, (t - T.flip0 - i * T.step) * 1.5, 6, 0.5, '#d8c8ff');
  }
  if (t > T.conf + 0.1 && t < T.flip) { ctx.save(); ctx.globalAlpha = Math.floor(t * 8) % 2 ? 1 : 0.6; ctx.translate(960, 950); smallTitle(ctx, t, 'SSR 確定!?', 0, 0, 90, PAL.rainbow.rainbow ? PAL.gold : PAL.gold, 'center'); ctx.restore(); }
  if (won) {
    const l = t - T.flip;
    sparkBurst(ctx, 960, 480, l, 24, 2.2, '#fff6c0');
    confetti(ctx, t, T.flip, 80, ['#ffd24a', '#ff7ab8', '#7ad8ff', '#ffffff', '#b89aff'], 51);
    const tk = lin(l, 0.4, 0.6); if (tk > 0) { const ss = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(420, 420); ctx.rotate(-0.07); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 104, PAL.gold, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1500, 500, 200, lin(l, 0.55, 0.75)); ctx.restore();
    nameAt(ctx, 420, 530, eo(lin(l, 0.65, 0.85)) * (1 - out), 40, '#1a0838');
    flash(ctx, (1 - lin(t, T.flip, T.flip + 0.15)) * 0.6, '#fff');
  }
}
VARS.g25[4] = { name: '十連抽', fn: vTenPull, dur: 6.0 };
