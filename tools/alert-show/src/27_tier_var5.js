
// ======================= 第五批：贈訂超大（g50） =======================
function inkText(ctx, txt, x, y, size, fill, stroke = '#1a0838', font = 'Noto Sans TC', w = 900) {
  ctx.save(); ctx.font = `${w} ${size}px '${font}'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke; ctx.lineWidth = size * 0.22; ctx.strokeText(txt, x, y); ctx.fillStyle = fill; ctx.fillText(txt, x, y); ctx.restore();
}
function endBlock(ctx, t, l, out, x, y, opts = {}) {   // 標題＋×N＋名字（共用收尾），opts.count 位置
  const tk = lin(l, 0, 0.2); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(x, y); ctx.rotate(opts.rot ?? -0.05); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, opts.size || 120, opts.pal || PAL.gold, 'center'); ctx.restore(); }
  const c = opts.count || [x, y + 190]; ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, c[0], c[1], opts.csize || 190, lin(l, 0.15, 0.35)); ctx.restore();
  const n = opts.name || [x, y + 330]; nameAt(ctx, n[0], n[1], eo(lin(l, 0.3, 0.5)) * (1 - out), 46, '#1a0838');
}

// ---------------- 超大 2：擲骰（ゾロ目） ----------------
const DICE_PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
function drawDie(ctx, x, y, s, rot, face, glow = 0) {   // 平塗骰子：正面＋上面＋側面
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  if (glow > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(30px)'; ctx.fillStyle = `hsla(${(Date.now ? 0 : 0) + 45},100%,70%,${glow})`; ctx.fillRect(-s * 0.8, -s * 0.9, s * 1.7, s * 1.7); ctx.restore(); }
  const d = s * 0.22;
  ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.045; ctx.strokeStyle = '#2b1a3a';
  ctx.fillStyle = '#e9e2f2'; ctx.beginPath(); ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(-s / 2 + d, -s / 2 - d); ctx.lineTo(s / 2 + d, -s / 2 - d); ctx.lineTo(s / 2, -s / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9bedb'; ctx.beginPath(); ctx.moveTo(s / 2, -s / 2); ctx.lineTo(s / 2 + d, -s / 2 - d); ctx.lineTo(s / 2 + d, s / 2 - d); ctx.lineTo(s / 2, s / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.16); ctx.fill(); ctx.stroke();
  const pc = face === 1 ? '#e8183a' : '#2b1a3a', pr = face === 1 ? s * 0.13 : s * 0.085;
  for (const [px, py] of DICE_PIPS[face]) { ctx.fillStyle = pc; ctx.beginPath(); ctx.arc(px * s * 0.26, py * s * 0.26, pr, 0, 7); ctx.fill(); }
  ctx.restore();
}
const DI_T = { drop: 0.3, land1: 1.35, land2: 1.55, teeter: 2.6, settle: 2.95 };
function vDice(ctx, t) {
  const D = CFG.dur, T = DI_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), won = t >= T.settle;
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  if (!won) { const g = ctx.createRadialGradient(960, 620, 0, 960, 620, 1100); g.addColorStop(0, '#1f8a5a'); g.addColorStop(1, '#063020'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#d8a83a'; ctx.lineWidth = 14; ctx.strokeRect(60, 60, W - 120, H - 120); ctx.strokeStyle = 'rgba(255,230,160,0.35)'; ctx.lineWidth = 4; ctx.strokeRect(84, 84, W - 168, H - 168); }
  else { palBG(ctx, t, PAL.rainbow, 960, 560); }
  ctx.restore();
  // 兩顆骰子：從上方甩進來翻滾；左邊先停 6，右邊在 5 跟 6 的邊上搖、最後倒向 6
  const s = 300, dice = [{ x0: 300, x1: 700, land: T.land1, seed: 1 }, { x0: 1700, x1: 1220, land: T.land2, seed: 2 }];
  dice.forEach((dd, i) => {
    const u = lin(t, T.drop, dd.land), x = dd.x0 + (dd.x1 - dd.x0) * eo(u), bounce = Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 380, y = 620 - bounce - (1 - u) * 300;
    let rot = (1 - eo(u)) * (i ? -14 : 12), face = 1 + Math.floor(R(Math.floor(t * 14), dd.seed) * 6), g = 0, yy = y;
    if (t >= dd.land) { face = 6; rot = 0; }
    if (i === 1 && t >= dd.land && t < T.settle) {   // 立在邊上搖
      const k = lin(t, dd.land, T.teeter), tilt = 0.75 * Math.sin(Math.PI * Math.min(1, k * 1.2));
      if (t < T.teeter) { rot = -tilt + Math.sin(t * 18) * 0.05 * k; face = 5; } else { const q = eo5(lin(t, T.teeter, T.settle)); rot = -0.75 * (1 - q) + 0.12 * Math.sin(q * Math.PI); face = q > 0.5 ? 6 : 5; }
      yy = 620 - Math.sin(Math.abs(rot)) * s * 0.2;
    }
    if (won) { g = 0.6 + 0.3 * Math.sin(t * 8); yy -= 40 * eo(lin(t, T.settle, T.settle + 0.4)); }
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, 620 + s * 0.52, s * 0.55 * (1 - bounce / 900), 26, 0, 0, 7); ctx.fill(); drawDie(ctx, x, yy, s, rot, face, g); ctx.restore();
  });
  if (t > T.land2 + 0.1 && t < T.settle) { ctx.save(); ctx.globalAlpha = Math.floor(t * 8) % 2 ? 1 : 0.55; ctx.translate(1220, 250); smallTitle(ctx, t, 'あと一歩…!?', 0, 0, 80, PAL.red, 'center'); ctx.restore(); }
  if (t > T.land1 && t < T.land1 + 0.4) sparkBurst(ctx, 700, 620, t - T.land1, 12, 1.2, '#fff6c0');
  if (won) {
    const l = t - T.settle;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960, 560, 16, 'rgba(255,255,255,0.18)', t * 0.5, 1800, 0.4, 16); ctx.restore();
    const zk = lin(l, 0, 0.18); if (zk > 0 && l < 1.0) { const sc = zk < 1 ? 3 - 2 * eo(zk) : 1 + Math.sin(t * 20) * 0.02; ctx.save(); ctx.globalAlpha = (1 - lin(l, 0.8, 1.0)) * (1 - out); ctx.translate(960, 300); ctx.rotate(-0.08); ctx.scale(sc, sc); smallTitle(ctx, t, 'ゾロ目!!', 0, 0, 200, PAL.red, 'center'); ctx.restore(); }
    coinFountain(ctx, t, T.settle, T.settle + 2.4, 140);
    const gk = lin(l, 0.7, 1.05); if (GIRL && gk > 0) { const k = eback(gk, 1.6); ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(960, 680); ctx.scale(k, k); neonOutline(ctx, GIRL_SIL, 0, 0, 840, t, 0); drawImg(ctx, GIRL, 0, 0, 840, 0); ctx.restore(); }
    if (l > 0.9) endBlock(ctx, t, l - 0.9, out, 960, 140, { size: 110, count: [1560, 300], name: [960, 1010], csize: 170 });
    flash(ctx, (1 - lin(t, T.settle, T.settle + 0.18)) * 0.75, '#fff');
  }
}

// ---------------- 超大 3：流星墜落 ----------------
const MT_T = { appear: 0.9, crash: 2.7, rise: 3.3 };
function starShape(ctx, x, y, r, rot, fill, stroke) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = r * 0.08; ctx.strokeStyle = stroke; ctx.stroke(); } ctx.restore(); }
function vMeteor(ctx, t) {
  const D = CFG.dur, T = MT_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), crashed = t >= T.crash;
  const pk = crashed ? Math.exp(-(t - T.crash) * 5) : t > T.appear ? lin(t, T.appear, T.crash) * 0.35 : 0;
  ctx.save(); ctx.globalAlpha = app * (1 - out); ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * pk * 30, (R(Math.floor(t * 60), 2) - 0.5) * pk * 30);
  if (!crashed) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a0828'); g.addColorStop(1, `rgb(${60 + 140 * lin(t, T.appear, T.crash) | 0},30,70)`); ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, H + 80); }
  else { palBG(ctx, t, PAL.rainbow, 960, 760); ctx.fillStyle = 'rgba(20,0,40,0.2)'; ctx.fillRect(-40, -40, W + 80, H + 80); }
  for (let i = 0; i < 120; i++) { ctx.fillStyle = `rgba(255,255,240,${0.3 + 0.6 * R(i, 3) * (0.6 + 0.4 * Math.sin(t * 4 + i))})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * 700, 3, 3); }
  // 小流星
  for (let i = 0; i < 8; i++) { const st = 0.2 + i * 0.32, q = (t - st) / 0.5; if (q < 0 || q > 1 || st > T.crash) continue; const x = 300 + R(i, 4) * 1400 + 600 * q, y = 80 + R(i, 5) * 300 + 300 * q; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createLinearGradient(x - 240, y - 120, x, y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,250,220,${1 - q})`); ctx.strokeStyle = g; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 240, y - 120); ctx.lineTo(x, y); ctx.stroke(); ctx.restore(); }
  // 地平線山丘
  ctx.fillStyle = crashed ? '#3a1a5a' : '#140a26'; ctx.beginPath(); ctx.moveTo(-40, H + 40); ctx.lineTo(-40, 880); for (let x = 0; x <= W + 40; x += 80) ctx.lineTo(x, 860 + Math.sin(x * 0.006) * 40 + Math.sin(x * 0.017) * 20); ctx.lineTo(W + 40, H + 40); ctx.fill();
  ctx.restore();
  // 大流星：從右上角越來越大、拖著火尾
  if (t > T.appear && !crashed) {
    const u = lin(t, T.appear, T.crash), e = u * u, x = 1800 - 840 * e, y = -120 + 900 * e, r = 30 + 170 * e;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)';
    for (let k = 0; k < 5; k++) { const tl = r * (3 + k * 1.2); const g = ctx.createLinearGradient(x + tl * 0.7, y - tl * 0.9, x, y); g.addColorStop(0, 'rgba(255,120,40,0)'); g.addColorStop(1, ['rgba(255,240,180,0.9)', 'rgba(255,190,80,0.7)', 'rgba(255,120,60,0.55)', 'rgba(255,80,120,0.4)', 'rgba(200,120,255,0.3)'][k]); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - r * 0.8, y - r * 0.2 + k * 6); ctx.lineTo(x + tl * 0.7, y - tl * 0.9); ctx.lineTo(x + r * 0.2, y + r * 0.8); ctx.fill(); }
    ctx.restore();
    ctx.save(); ctx.globalAlpha = 1 - out; starShape(ctx, x, y, r, t * 6, '#ffd84a', '#7a3a00'); starShape(ctx, x - r * 0.12, y - r * 0.12, r * 0.45, t * 6, '#fff6c0'); ctx.restore();
    if (u > 0.55) { ctx.save(); ctx.globalAlpha = Math.floor(t * 10) % 2 ? 1 : 0.5; ctx.translate(560, 260); ctx.rotate(-0.06); smallTitle(ctx, t, 'WARNING!!', 0, 0, 110, PAL.red, 'center'); ctx.restore(); }
  }
  if (crashed) {
    const l = t - T.crash;
    for (let i = 0; i < 3; i++) { const q = (l - i * 0.1) / 0.8; if (q < 0 || q > 1) continue; ctx.save(); ctx.globalAlpha = (1 - q) * (1 - out); ctx.strokeStyle = '#fff6d0'; ctx.lineWidth = 30 * (1 - q) + 4; ctx.beginPath(); ctx.ellipse(960, 820, 100 + 1300 * eo(q), 40 + 380 * eo(q), 0, 0, 7); ctx.stroke(); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(26px)'; const gp = ctx.createLinearGradient(0, 820, 0, -100); gp.addColorStop(0, `rgba(255,250,220,${Math.min(1, l * 4)})`); gp.addColorStop(1, 'rgba(255,200,255,0)'); ctx.fillStyle = gp; ctx.fillRect(960 - 220 - l * 40, -100, 440 + l * 80, 920); ctx.restore();
    // 落下的小星星雨
    for (let i = 0; i < 40; i++) { const st = R(i, 6) * 3, q = ((l - st) % 1.6) / 1.6; if (l < st) continue; starShape(ctx, R(i, 7) * W, -60 + q * 1200, 14 + R(i, 8) * 16, q * 6 + i, `hsl(${(i * 37) % 360},90%,75%)`, '#3a1a5a'); }
    const gk = lin(l, T.rise - T.crash, T.rise - T.crash + 0.5); if (GIRL && gk > 0) { const k = eo(gk); ctx.save(); ctx.globalAlpha = 1 - out; starShape(ctx, 960, 560, 470 * eback(gk, 1.5), t * 0.3, 'rgba(255,240,170,0.9)', '#c87a00'); const gy = 1100 - 500 * k; ctx.beginPath(); ctx.rect(0, 0, W, 900); ctx.clip(); neonOutline(ctx, GIRL_SIL, 960, gy, 860, t, 0); drawImg(ctx, GIRL, 960, gy, 860, 0); ctx.restore(); }
    if (l > 1.1) endBlock(ctx, t, l - 1.1, out, 420, 330, { size: 108, count: [1520, 380], name: [420, 470], csize: 180 });
    flash(ctx, (1 - lin(t, T.crash, T.crash + 0.25)) * 0.85, '#fff');
  }
}

// ---------------- 超大 4：演唱會轉播 ----------------
const CO_T = { cut1: 1.6, cut2: 2.6, cut3: 3.5 };
function concertStage(ctx, t, l, showCount, gx = 960) {   // 全景舞台
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#120828'); g.addColorStop(1, '#3a0a4a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 雷射
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 8; i++) { const a = Math.PI / 2 + Math.sin(t * 2 + i) * 0.7, x = 200 + i * 220; ctx.strokeStyle = `hsla(${(i * 45 + t * 60) % 360},100%,65%,0.5)`; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x + Math.cos(a) * 1400, 80 + Math.sin(a) * 1400); ctx.stroke(); } ctx.restore();
  // LED 大螢幕
  ctx.fillStyle = '#05030c'; ctx.fillRect(560, 110, 800, 450); ctx.save(); ctx.beginPath(); ctx.rect(576, 126, 768, 418); ctx.clip();
  if (showCount) { palBG(ctx, t, PAL.rainbow, 960, 335); smallTitle(ctx, t, '×' + CFG.n, 960, 340, 220, PAL.gold, 'center'); }
  else if (GIRL) { ctx.fillStyle = '#ffd6f0'; ctx.fillRect(576, 126, 768, 418); const gh = 900, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, 960 - FACE.x * gw, 335 - FACE.y * gh + 60, gw, gh); }
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 126; y < 544; y += 6) ctx.fillRect(576, y, 768, 2); ctx.restore();
  ctx.strokeStyle = '#6a5a8a'; ctx.lineWidth = 6; ctx.strokeRect(560, 110, 800, 450);
  // 舞台
  ctx.fillStyle = '#2a1640'; ctx.fillRect(0, 760, W, 320); ctx.fillStyle = '#ff5ab0'; ctx.fillRect(0, 760, W, 8);
  // 火柱
  if (l > 0) for (const x of [260, 660, 1260, 1660]) { const k = Math.max(0, Math.sin(Math.PI * lin(l, 0.05, 0.9))); if (k <= 0) continue; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(8px)'; for (const [c, w] of [['rgba(255,80,30,0.8)', 70], ['rgba(255,200,60,0.9)', 40], ['rgba(255,255,220,0.9)', 18]]) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - w, 760); ctx.quadraticCurveTo(x - w * 0.4, 760 - 500 * k, x, 760 - 620 * k); ctx.quadraticCurveTo(x + w * 0.4, 760 - 500 * k, x + w, 760); ctx.fill(); } ctx.restore(); }
  // 角色
  if (GIRL) { neonOutline(ctx, GIRL_SIL, gx, 560, 560, t, 0); drawImg(ctx, GIRL, gx, 560, 560, 0); }
  crowd(ctx, t, 1);
}
function crowd(ctx, t, sc) {   // 觀眾剪影＋螢光棒
  for (let i = 0; i < 34; i++) { const x = (i + 0.5) * W / 34 + (R(i, 1) - 0.5) * 30, y = 1000 + R(i, 2) * 60, hr = 38 * sc + R(i, 3) * 8, wave = Math.sin(t * 7 + i * 0.6) * 0.5;
    const hue = [330, 200, 50, 280][Math.floor(t * 1.5 + i) % 4];
    ctx.save(); ctx.translate(x + 40, y - 70); ctx.rotate(wave); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(4px)'; ctx.fillStyle = `hsl(${hue},100%,65%)`; ctx.fillRect(-7, -110, 14, 110); ctx.restore();
    ctx.fillStyle = '#0a0414'; ctx.beginPath(); ctx.arc(x, y - hr, hr, 0, 7); ctx.fill(); ctx.fillRect(x - hr * 1.3, y - 10, hr * 2.6, 200); }
}
function broadcastUI(ctx, t, label) {
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 5; const m = 50, L = 70;
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); }
  ctx.fillStyle = Math.floor(t * 2) % 2 ? '#ff2a3a' : '#a0101a'; ctx.beginPath(); ctx.arc(110, 110, 16, 0, 7); ctx.fill();
  hudText(ctx, 'LIVE', 140, 112, 36, '#ffffff'); hudText(ctx, label, W - 110, 112, 28, '#ffffff', 'right');
  const s = Math.floor(t * 30); hudText(ctx, `00:0${Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, '0')}:${String(s % 30).padStart(2, '0')}`, W - 110, H - 100, 26, '#ffffff', 'right');
  ctx.restore();
}
function vConcert(ctx, t) {
  const D = CFG.dur, T = CO_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3));
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  if (t < T.cut1) { concertStage(ctx, t, -1, false); broadcastUI(ctx, t, 'CAM 1  WIDE'); }
  else if (t < T.cut2) {   // 臉部特寫
    const l = t - T.cut1, z = 1 + 0.08 * l; ctx.fillStyle = '#ffd6f0'; ctx.fillRect(0, 0, W, H); palBG(ctx, t, PAL.rainbow, 960, 540); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, 0, W, H);
    if (GIRL) { const gh = 2600 * z, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, 1080 - FACE.x * gw, 520 - FACE.y * gh, gw, gh); }
    broadcastUI(ctx, t, 'CAM 3  CLOSE-UP');
    const k = eo5(lin(l, 0.15, 0.4)); ctx.save(); ctx.translate(-900 * (1 - k), 0); ctx.fillStyle = 'rgba(200,16,60,0.92)'; ctx.fillRect(0, 800, 900, 110); ctx.fillStyle = '#fff'; ctx.fillRect(0, 800, 900, 6); inkText(ctx, 'SPECIAL THANKS', 440, 830, 34, '#ffe08a', '#5a0018'); inkText(ctx, P.name, 440, 878, 44, '#ffffff', '#5a0018'); ctx.restore();
  } else if (t < T.cut3) {   // 觀眾席
    const l = t - T.cut2, g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a0a4a'); g.addColorStop(1, '#0a0418'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(960, 540); ctx.scale(1.9, 1.9); ctx.translate(-960, -760); crowd(ctx, t * 1.4, 1); ctx.restore();
    broadcastUI(ctx, t, 'CAM 5  AUDIENCE'); const k = lin(l, 0.05, 0.25); ctx.save(); ctx.globalAlpha = k; ctx.translate(960, 260); ctx.scale(1.4 - 0.4 * k, 1.4 - 0.4 * k); smallTitle(ctx, t, 'アンコール!!', 0, 0, 140, PAL.red, 'center'); ctx.restore();
  } else {   // 全景＋大螢幕顯示份數、火柱、彩帶
    const l = t - T.cut3; concertStage(ctx, t, l, true, 1460); confetti(ctx, t, T.cut3, 90, ['#ffd24a', '#ff5a8a', '#5fc8ff', '#ffffff'], 61); broadcastUI(ctx, t, 'CAM 1  WIDE');
    fireworksAt(ctx, t, [[T.cut3 + 0.1, 300, 220, 30], [T.cut3 + 0.3, 1620, 200, 200], [T.cut3 + 0.6, 260, 420, 300], [T.cut3 + 0.8, 1660, 420, 120]]);
    const tk = lin(l, 0.2, 0.4); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.translate(960, 660); ctx.rotate(-0.03); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 104, PAL.gold, 'center'); ctx.restore(); }
    nameAt(ctx, 960, 770, eo(lin(l, 0.4, 0.6)), 40, '#1a0838');
  }
  // 切鏡頭時白閃
  for (const ct of [T.cut1, T.cut2, T.cut3]) if (t >= ct && t < ct + 0.08) flash(ctx, (1 - (t - ct) / 0.08) * 0.6, '#fff');
  ctx.restore();
}
VARS.g50[2] = { name: '擲骰ゾロ目', fn: vDice, dur: 7.0 };
VARS.g50[3] = { name: '流星墜落', fn: vMeteor, dur: 7.0 };
VARS.g50[4] = { name: '演唱會轉播', fn: vConcert, dur: 7.0 };

// ---------------- 超大 1：保留變化＋機關合體 ----------------
let CREST = null;
const _lvaBase7 = window.loadVarAssets;
window.loadVarAssets = async function () { await _lvaBase7(); const im = await load(window.DEF_CREST || '../assets/crest.png'); CREST = im ? trimmed(im) : null; };
const GM_T = { hold: 0.3, chg: [0.75, 1.25, 1.75, 2.25, 2.85], fly: 3.3, gattai: 3.85, girl: 4.15 };
const HOLD_COL = [['#ffffff', '#c8c8d8'], ['#5fb0ff', '#1a5ad0'], ['#6aee6a', '#119a3a'], ['#ff4a5a', '#b0102a'], ['#ffd84a', '#c87a00']];
function holdIcon(ctx, x, y, r, lv, t) {   // 保留圖示：白→藍→綠→紅→金→虹
  ctx.save(); ctx.translate(x, y);
  if (lv >= 5) { const g = ctx.createLinearGradient(-r, -r, r, r); for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(i * 60 + t * 300) % 360},100%,60%)`); ctx.fillStyle = g; }
  else { const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r); g.addColorStop(0, HOLD_COL[lv][0]); g.addColorStop(1, HOLD_COL[lv][1]); ctx.fillStyle = g; }
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.lineWidth = r * 0.12; ctx.strokeStyle = '#2b1a3a'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.36, r * 0.3, r * 0.18, -0.6, 0, 7); ctx.fill();
  ctx.restore();
}
function vGimmick(ctx, t) {
  if (!CREST) return;
  const D = CFG.dur, T = GM_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), done = t >= T.gattai;
  let lv = 0; T.chg.forEach((c) => { if (t >= c) lv++; });
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  if (!done) { const g = ctx.createRadialGradient(960, 520, 0, 960, 520, 1200); g.addColorStop(0, ['#2a2a4a', '#123a7a', '#0e5a2e', '#7a0a1e', '#7a4a00', '#5a1a7a'][lv]); g.addColorStop(1, '#05030c'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (lv >= 3) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5; speedLines(ctx, 960, 900, 50, 300, lv >= 5 ? `hsla(${(t * 300) % 360},100%,70%,0.4)` : 'rgba(255,255,255,0.25)', Math.floor(t * 20), 0, 1); ctx.restore(); } }
  else { palBG(ctx, t, PAL.rainbow, 960, 470); }
  ctx.restore();
  // 保留圖示（下方 4 顆，最後一顆會變色）
  if (t < T.fly + 0.3) {
    const ha = (1 - lin(t, T.fly, T.fly + 0.3)) * app * (1 - out);
    ctx.save(); ctx.globalAlpha = ha; ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.roundRect(560, 860, 800, 130, 65); ctx.fill(); ctx.restore();
    for (let i = 0; i < 4; i++) { const x = 650 + i * 200, isLast = i === 3; let r = 46, l2 = 0;
      if (isLast) { const lc = T.chg[Math.max(0, lv - 1)], q = t - lc; l2 = lv; if (lv > 0 && q < 0.25) r *= 1 + 0.6 * Math.sin(q / 0.25 * Math.PI); r *= 1 + 0.12 * lv; if (lv >= 5) r *= 1 + 0.06 * Math.sin(t * 14); }
      ctx.save(); ctx.globalAlpha = ha; holdIcon(ctx, x, 925, r, l2, t); ctx.restore();
      if (isLast && lv > 0) { const q = t - T.chg[lv - 1]; if (q < 0.4) { ctx.save(); ctx.globalAlpha = ha; sparkBurst(ctx, x, 925, q, 12, 1 + lv * 0.3, lv >= 5 ? '#fff' : HOLD_COL[Math.min(4, lv)][0]); ctx.restore(); } } }
    // 變色時的文字
    const labels = ['', 'チャンス', 'チャンス!', '激アツ!!', '超激アツ!!', '虹保留!!!'];
    if (lv > 0 && t < T.fly) { const q = t - T.chg[lv - 1], k = lin(q, 0, 0.12); ctx.save(); ctx.globalAlpha = ha; ctx.translate(960, 420); const s = (k < 1 ? 2 - eo(k) : 1) * (0.8 + lv * 0.12); ctx.scale(s, s); smallTitle(ctx, t, labels[lv], 0, 0, 120, lv >= 3 ? PAL.red : lv === 2 ? PAL.green : PAL.sky, 'center'); ctx.restore(); }
    for (const c of T.chg) if (t >= c && t < c + 0.1) flash(ctx, (1 - (t - c) / 0.1) * 0.25, '#fff');
  }
  // 機關：四塊從四個方向撞進來合體
  if (t >= T.fly) {
    const cw = 1240, ch = cw * CREST.height / CREST.width, cx = 960, cy = 470, k = Math.min(1, lin(t, T.fly, T.gattai)), e = k * k;
    const pieces = [[0, 0, 0.34, 1, -760, 0], [0.66, 0, 0.34, 1, 760, 0], [0.34, 0, 0.32, 0.5, 0, -640], [0.34, 0.5, 0.32, 0.5, 0, 640]];
    const pk = done ? Math.exp(-(t - T.gattai) * 8) : 0;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * pk * 30, (R(Math.floor(t * 60), 2) - 0.5) * pk * 30);
    if (done) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, cx, cy, 16, 'rgba(255,255,255,0.22)', t * 0.6, 1800, 0.4, 16); ctx.filter = 'blur(40px)'; ctx.fillStyle = `hsla(${(t * 200) % 360},100%,70%,0.5)`; ctx.beginPath(); ctx.ellipse(cx, cy, cw * 0.45, ch * 0.5, 0, 0, 7); ctx.fill(); ctx.restore(); }
    for (const [sx, sy, sw, sh, dx, dy] of pieces) {
      const ox = dx * (1 - e), oy = dy * (1 - e), x0 = cx - cw / 2 + sx * cw, y0 = cy - ch / 2 + sy * ch;
      ctx.drawImage(CREST, sx * CREST.width, sy * CREST.height, sw * CREST.width, sh * CREST.height, x0 + ox, y0 + oy, sw * cw + 1, sh * ch + 1);
    }
    ctx.restore();
    if (!done) { ctx.save(); ctx.globalAlpha = lin(t, T.fly + 0.2, T.fly + 0.4); ctx.translate(1600, 960); smallTitle(ctx, t, '合体!!', 0, 0, 120, PAL.gold, 'center'); ctx.restore(); }
  }
  if (done) {
    const l = t - T.gattai;
    for (let i = 0; i < 3; i++) { const q = (l - i * 0.08) / 0.7; if (q < 0 || q > 1) continue; ctx.save(); ctx.globalAlpha = (1 - q) * (1 - out); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 26 * (1 - q) + 3; ctx.beginPath(); ctx.arc(960, 470, 200 + 1200 * eo(q), 0, 7); ctx.stroke(); ctx.restore(); }
    coinFountain(ctx, t, T.gattai, T.gattai + 2.4, 140);
    const gk = lin(t, T.girl, T.girl + 0.35); if (GIRL && gk > 0) { const k = eback(gk, 1.6); ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(960, 640); ctx.scale(k, k); neonOutline(ctx, GIRL_SIL, 0, 0, 820, t, 0); drawImg(ctx, GIRL, 0, 0, 820, 0); ctx.restore(); }
    if (l > 0.5) endBlock(ctx, t, l - 0.5, out, 400, 820, { size: 104, count: [1540, 820], name: [400, 940], csize: 180 });
    flash(ctx, (1 - lin(t, T.gattai, T.gattai + 0.2)) * 0.8, '#fff');
  }
}
VARS.g50[1] = { name: '保留變化＋機關合體', fn: vGimmick, dur: 7.0 };
