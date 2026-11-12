
// ======================= V2 中量（g5）：抽卡翻牌／小彈珠台／衝線拍照／單發煙火 =======================
// 中量不整個蓋掉直播畫面：壓暗＋大道具在左、標題與名牌在右。

// ---------------- 中量 1：抽卡翻牌 ----------------
function v2CardsScene(ctx, t) {
  const F3 = 2.0, CH = 600, Y0 = 545, after = t - F3, charge = lin(t, 1.3, F3), app = eo(lin(t, 0, 0.3));
  const fe = eio(lin(after, 0.42, 0.95)), TT = F3 + 0.74;
  const pk = decay(t, [[0.8, 0.25], [1.05, 0.25], [F3, 1], [TT, 0.8]], 11);
  ctx.save();
  camV2(ctx, CX, Y0, 1.014 + 0.1 * sstep(charge) * (after < 0 ? 1 : 1 - eo(lin(after, 0, 0.3))) + pk * 0.03);
  shakeAt(ctx, t, pk * 18 + (after < 0 ? charge * 5 : 0));
  dimBG(ctx, app, [CX, Y0, 1000, 'rgba(110,120,255,0.3)']);
  const sx = mixv(CX, 540, fe), sy = mixv(Y0, 545, fe);
  // SSR 背後的虹光（蓄力時漸強，揭曉後留著當底）
  if (charge > 0) {
    const a = after < 0 ? charge : 0.75; ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let h = 0; h < 6; h++) godRays(ctx, sx, sy, 6, `hsla(${(h * 60 + t * 160) % 360},100%,60%,${0.11 * a})`, t * 0.7 + h * Math.PI / 18, 1700, 0.45, 14);
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, 520 + 240 * a); gr.addColorStop(0, `rgba(255,240,180,${0.5 * a})`); gr.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore();
  }
  const cards = [{ x: CX - 500, t0: 0.1, flip: 0.8, kind: 'r1', dir: -1 }, { x: CX + 500, t0: 0.19, flip: 1.05, kind: 'r2', dir: 1 }, { x: CX, t0: 0.28, flip: F3, kind: 'ssr', dir: 0 }];
  for (const c of cards) {
    const dk = lin(t, c.t0, c.t0 + 0.42); if (dk <= 0) continue; const k = eback(dk, 1.3);
    let x = CX + (c.x - CX) * k, y = 1500 - (1500 - Y0) * k, rot = (1 - k) * (c.dir || 0.4) * 0.7, s = 1, al = 1;
    const ssr = c.kind === 'ssr', fd = ssr ? 0.26 : 0.2, fk = lin(t, c.flip, c.flip + fd);
    if (ssr) {
      if (after >= 0) { const up = eback(lin(after, 0, 0.32), 1.8); s = 1 + 0.2 * up + (860 / CH - 1.2) * fe; x = sx; y = sy - 20 * up * (1 - fe) + Math.sin(t * 1.7) * 7 * fe; rot = -0.06 * fe + Math.sin(t * 1.3) * 0.012 * fe; }
      else if (charge > 0) { x += Math.sin(t * 60) * 7 * charge; rot += Math.sin(t * 47) * 0.035 * charge; s = 1 + 0.05 * charge; }
    } else {
      if (charge > 0 && after < 0) al = 1 - 0.45 * charge;   // 蓄力時兩張 R 卡退到暗處
      if (after >= 0) { const q = ei(lin(after, 0, 0.4)); x += c.dir * q * 1100; y -= q * 160; rot += c.dir * q * 1.6; al = 0.55 * (1 - q); }
    }
    const sq = Math.abs(Math.cos(Math.PI * fk)) || 0.001, lift = Math.sin(Math.PI * fk);
    ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y - lift * 30); ctx.rotate(rot); ctx.scale(s * sq * (1 + lift * 0.06), s * (1 + lift * 0.06));
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 16 + lift * 20;
    if (fk < 0.5) { const bw = CARD_BACK.width * CH / CARD_BACK.height; ctx.drawImage(CARD_BACK, -bw / 2, -CH / 2, bw, CH); }
    else {
      ctx.shadowColor = 'transparent'; const r = cardFace(ctx, ssr ? 'ssr' : 'r', CH, t, c.kind);
      if (ssr && r) { ctx.globalAlpha = al * lin(after, 0.3, 0.5); ctx.font = `900 ${Math.round(CH * 0.06)}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a3000'; ctx.fillText(P.name, 0, r.plateY, r.w * 0.56); }
    }
    ctx.restore();
    if (!ssr) sparkBurst(ctx, x, y, (t - c.flip) * 1.4, 10, 0.8, '#cfe8ff');
  }
  if (after >= 0) {
    ringBurst(ctx, CX, Y0, after, { r1: 1500, dur: 0.45 }); sparkBurst(ctx, CX, Y0 - 40, after, 22, 2.2, '#fff6c0');
    sparkleField(ctx, t, 26, sx - 420, sy - 480, sx + 420, sy + 480, Math.min(1, after * 3));
    if (t >= TT) { shardsV2(ctx, 1340, 370, t - TT); ringBurst(ctx, 1340, 370, t - TT, { r1: 1100 }); }
    heroTitle(ctx, t, 1340, 370, lin(t, TT, TT + 0.18), { maxW: 980, pk });
    plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 1350, 650, 1.0);
  }
  ctx.restore();
  if (after >= 0) confetti(ctx, t, F3 + 0.05, 60, ['#ffe27a', '#ff9ad0', '#8fd8ff', '#ffffff', '#c8a0ff'], 11);
  if (after >= 0) flash(ctx, (1 - lin(after, 0, 0.16)) * 0.6, '#fff3c0');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.25, '#eaffc0');
}
function v2Cards(ctx, t) { if (!CARD_BACK) return; runV2(ctx, t, { T: 1e9, exitKind: 'slice', pre: v2CardsScene }); }

// ---------------- 中量 2：小彈珠台 ----------------
function pinBoardV2(ctx, t, bx, by, bh) {   // 只畫盤面、球、燈、派彩（盤面座標照圖量），回傳入賞口的畫面座標
  const T = PIN_T, HIT = T.hit, s = bh / PIN_BOARD.height, bw = PIN_BOARD.width * s, t5 = T.first + (PIN_HITS.length - 1) * T.step, reach = t > t5 && t < HIT;
  const toS = (p) => [bx - bw / 2 + p[0] * s, by - bh / 2 + p[1] * s], [px, py] = toS(PIN_POCKET), BR = 18 * s;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; ctx.drawImage(PIN_BOARD, bx - bw / 2, by - bh / 2, bw, bh); ctx.restore();
  for (let i = 0; i < PIN_HITS.length; i++) {   // 撞釘：釘子亮一下＋白圈擴散
    const l = t - (T.first + i * T.step); if (l < 0 || l > 0.3) continue; const p = toS([PIN_HITS[i][0], PIN_HITS[i][1] + 26]), q = l / 0.3;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 34 * s * 1.6); gg.addColorStop(0, `rgba(255,250,210,${0.95 * (1 - q)})`); gg.addColorStop(1, 'rgba(255,230,120,0)'); ctx.fillStyle = gg; ctx.fillRect(p[0] - 80, p[1] - 80, 160, 160); ctx.restore();
    ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${1 - q})`; ctx.lineWidth = 5 * (1 - q) + 1; ctx.beginPath(); ctx.arc(p[0], p[1], (10 + 34 * eo(q)) * s * 1.3, 0, 7); ctx.stroke(); ctx.restore();
  }
  for (let i = 0; i < PIN_BULBS.length; i++) {   // 入賞口跑燈
    let on = 0; if (reach) on = Math.floor((t - t5) * 22) % PIN_BULBS.length === i ? 1 : 0.15; else if (t >= HIT) on = (Math.floor((t - HIT) * 12) + i) % 2 ? 1 : 0.45; if (!on) continue;
    const b = toS(PIN_BULBS[i]), r = 34 * s * 1.3; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], r); gg.addColorStop(0, `rgba(255,248,200,${on})`); gg.addColorStop(0.4, `rgba(255,200,120,${0.6 * on})`); gg.addColorStop(1, 'rgba(255,160,80,0)'); ctx.fillStyle = gg; ctx.fillRect(b[0] - r, b[1] - r, r * 2, r * 2); ctx.restore();
  }
  for (let k = 4; k >= 0; k--) { const bp = pinBallPos(t - k * 0.016); if (!bp) continue; const p = toS(bp); celBall(ctx, p[0], p[1], BR, k ? 0.16 * (5 - k) / 4 : 1); }
  if (t >= HIT) {
    const l = t - HIT;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(14px)'; const bm = ctx.createLinearGradient(0, py, 0, py - 760 * s); bm.addColorStop(0, `rgba(255,236,170,${0.55 * Math.min(1, l * 5) * (1 - lin(l, 1.2, 2.2))})`); bm.addColorStop(1, 'rgba(255,236,170,0)'); ctx.fillStyle = bm; ctx.fillRect(px - 70 * s, py - 760 * s, 140 * s, 760 * s); ctx.restore();
    const lip = toS([0, 724])[1], tl = toS([95, 0])[0], tr = toS([550, 0])[0];
    ctx.save(); ctx.beginPath(); ctx.rect(bx - bw, by - bh, bw * 2, lip - (by - bh)); ctx.clip();
    for (let i = 0; i < 40; i++) { const q = l - (0.05 + R(i, 3) * 1.4); if (q < 0 || q > 0.8) continue; const x = px + (R(i, 5) - 0.5) * 620 * s * q, y = py + 30 * s + (-300 * q + 1700 * q * q) * s; celBall(ctx, clamp(x, tl, tr), y, BR * 0.9); }
    ctx.restore();
    const pile = Math.min(20, Math.floor(l * 14)); for (let i = 0; i < pile; i++) celBall(ctx, tl + 20 * s + R(i, 8) * (tr - tl - 40 * s), lip - BR * 0.6 - (i > 10 ? BR * 1.4 : 0), BR * 0.9);
  }
  return [px, py, s, bw];
}
function v2PinballScene(ctx, t) {
  const T = PIN_T, HIT = T.hit, t5 = T.first + (PIN_HITS.length - 1) * T.step, app = eo(lin(t, 0, 0.3)), TF = HIT + 0.62, TT = TF + 0.3;
  const th = hitStop(t, [HIT], 0.07), l = t - HIT, fe = eio(lin(t, HIT + 0.3, TF + 0.25));
  const bh = 960, bx = mixv(CX, 500, fe), by = 548 + (1 - eback(lin(t, 0, 0.45), 1.3)) * 1100;
  const s = bh / PIN_BOARD.height, py0 = by - bh / 2 + PIN_POCKET[1] * s;
  const reachK = sstep(lin(t, t5, HIT)), z = 1.014 + 0.42 * reachK * (l < 0 ? 1 : 1 - eo(lin(l, 0.08, 0.5))) + (l >= 0 ? Math.exp(-l * 9) * 0.06 : 0);
  const pk = decay(t, [[HIT, 1], [TT, 0.8]], 10);
  ctx.save(); camV2(ctx, bx, mixv(by, py0 - 60, reachK * (l < 0 ? 1 : 1 - eo(lin(l, 0.08, 0.5)))), z); shakeAt(ctx, t, pk * 18);
  dimBG(ctx, app, [bx, by, 900, t >= HIT ? 'rgba(255,210,90,0.32)' : 'rgba(90,220,255,0.2)']);
  if (t >= HIT) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, bx, py0, 18, `rgba(255,190,50,${0.17 * Math.min(1, l * 4)})`, t * 0.4, 1700, 0.42, 16); ctx.restore(); }
  ctx.save(); ctx.translate(bx, by); ctx.rotate(-0.025 * fe + (t < 0.6 ? Math.sin(t * 30) * 0.01 * (1 - lin(t, 0.3, 0.6)) : 0)); ctx.translate(-bx, -by);
  const [px, py] = pinBoardV2(ctx, th, bx, by, bh);
  // 入賞後：頭像從入賞口上方彈出
  const rk = lin(l, 0.5, 0.85); if (rk > 0) { const s2 = popK(rk, 2.2), yy = py - 150 - 190 * eo(rk);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, px, yy, 14, 'rgba(255,240,170,0.28)', -t * 0.8, 260, 0.45, 6); ctx.restore();
    ctx.save(); ctx.translate(px, yy); ctx.scale(s2, s2); bustSafe(ctx, 0, 0, 128, t); ctx.restore(); }
  ctx.restore();
  if (t > t5 && l < 0) wordV2(ctx, 'チャンス!', bx + 420, py0 - 300, lin(t, t5, t5 + 0.14), { s: 0.56, fill: Math.floor(t * 12) % 2 ? '#ff3a4a' : '#ffe14a', beat: Math.sin(t * 26) * 0.03, rot: -0.1 });
  if (l >= 0 && l < 0.75) { ctx.save(); ctx.globalAlpha = 1 - lin(l, 0.55, 0.75); wordV2(ctx, '入賞!!', px + 20, py - 250, lin(l, 0, 0.14), { s: 1.05, fill: '#ffd21a', rot: -0.08 }); ctx.restore(); ringBurst(ctx, px, py, l, { r1: 1200, dur: 0.45 }); sparkBurst(ctx, px, py - 40, l, 20, 2, '#fff6c0'); }
  if (t >= TT) { shardsV2(ctx, 1350, 370, t - TT); ringBurst(ctx, 1350, 370, t - TT, { r1: 1100 }); }
  heroTitle(ctx, t, 1350, 370, lin(t, TT, TT + 0.18), { maxW: 980, pk });
  plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 1360, 650, 1.0);
  ctx.restore();
  if (l >= 0) flash(ctx, (1 - lin(l, 0, 0.14)) * 0.55, '#fff6c0');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.25, '#eaffc0');
}
function v2Pinball(ctx, t) { if (!PIN_BOARD) return; runV2(ctx, t, { T: 1e9, exitKind: 'whipL', pre: v2PinballScene }); }

// ---------------- 中量 3：衝線拍照 ----------------
const FIN2 = { ARCX: 1250, ARCB: 1010, AH: 880, GH: 800 };
function finSceneV2(ctx, t, still = false) {   // 跑道、拱門、緞帶、衝刺中的角色（世界座標）
  const { ARCX, ARCB, AH, GH } = FIN2, aw = FIN_ARCH.width * AH / FIN_ARCH.height;
  const tr = ctx.createLinearGradient(0, ARCB - 80, 0, ARCB + 80); tr.addColorStop(0, '#d2583e'); tr.addColorStop(1, '#8a2a1e');
  ctx.fillStyle = tr; ctx.beginPath(); ctx.moveTo(-900, ARCB - 36); ctx.lineTo(W + 900, ARCB - 76); ctx.lineTo(W + 900, ARCB + 200); ctx.lineTo(-900, ARCB + 200); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 5; for (const yy of [ARCB - 8, ARCB + 46]) { ctx.beginPath(); ctx.moveTo(-900, yy + 30); ctx.lineTo(W + 900, yy - 12); ctx.stroke(); }
  ctx.drawImage(FIN_ARCH, ARCX - aw / 2, ARCB - AH, aw, AH);
  const ty = ARCB - AH * 0.45, x0 = ARCX - aw * 0.31, x1 = ARCX + aw * 0.31;
  ctx.save(); ctx.strokeStyle = '#ff2a4a'; ctx.lineWidth = 11; ctx.lineCap = 'round';
  if (t < FIN_BREAK) { const tens = lin(t, FIN_BREAK - 0.12, FIN_BREAK); ctx.beginPath(); ctx.moveTo(x0, ty); ctx.quadraticCurveTo(ARCX + 60 * tens, ty + 18 + 30 * tens, x1, ty); ctx.stroke(); }
  else { const l = t - FIN_BREAK; for (const sg of [-1, 1]) { const xa = sg < 0 ? x0 : x1; ctx.beginPath(); ctx.moveTo(xa, ty);
    for (let j = 1; j <= 12; j++) { const u = j / 12; ctx.lineTo(xa + (ARCX - xa) * u * (1 - Math.min(1, l * 2.2)) + sg * u * 46 * Math.min(1, l * 3), ty + u * u * 300 * Math.min(1, l * 2.5) + Math.sin(u * 8 + l * 14) * 12 * u); } ctx.stroke(); } }
  ctx.restore();
  const rk = lin(t, 0.4, FIN_BREAK), sm = sstep(rk), gx = -420 + (ARCX + 50 + 420) * sm + (t > FIN_BREAK ? (t - FIN_BREAK) * 160 : 0), gy = ARCB - GH / 2 + 30 - Math.abs(Math.sin(t * 24)) * 22, lean = 0.13;
  if (GIRL && rk > 0) {
    if (!still && t < FIN_BREAK + 0.1) {
      for (let k = 1; k <= 5; k++) drawImg(ctx, silC(GIRL_SIL, `hsl(${150 + k * 22},100%,70%)`), gx - k * 84, gy + k * 3, GH, lean, 0.26 * (1 - k / 6));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) { const yy = ARCB - GH + R(i, 1) * (GH - 40), len = 220 + R(i, 2) * 360; ctx.fillStyle = `rgba(255,255,255,${0.22 + R(i, 3) * 0.3})`; ctx.fillRect(gx - 300 - len - ((t * 3400 + R(i, 4) * 900) % 500), yy, len, 3 + R(i, 5) * 3); }
      ctx.restore();
    }
    ctx.save(); outlineV2(ctx, GIRL_SIL, gx, gy, GH, lean, '#22d36a', 9); outlineV2(ctx, GIRL_SIL, gx, gy, GH, lean, '#fff', 4, 10); drawImg(ctx, GIRL, gx, gy, GH, lean); ctx.restore();
    if (!still) for (let i = 0; i < 8; i++) { const l = (t * 4 + R(i, 7)) % 1; ctx.fillStyle = `rgba(255,240,220,${0.4 * (1 - l)})`; ctx.beginPath(); ctx.arc(gx - 90 - l * 220, ARCB + 24 - l * 40, 12 + l * 34, 0, 7); ctx.fill(); }
  }
}
let _finPhoto2 = null;
function v2FinishScene(ctx, t) {
  const { ARCX, ARCB, AH } = FIN2, app = eo5(lin(t, 0, 0.35));
  if (t < FIN_SNAP) {
    const th = hitStop(t, [FIN_BREAK], 0.06), pan = (1 - sstep(lin(t, 0.3, 1.42))) * 560, pk = decay(t, [[FIN_BREAK, 1]], 12);
    ctx.save(); dimBG(ctx, app, [ARCX - pan, 560, 1000, 'rgba(120,255,160,0.16)']);
    camV2(ctx, ARCX - 150, 640, 1.014 + 0.08 * sstep(lin(t, 0.9, FIN_BREAK)) + pk * 0.04); shakeAt(ctx, t, pk * 16);
    ctx.globalAlpha = app; ctx.translate(pan, (1 - app) * 320); finSceneV2(ctx, th); ctx.restore();
    const gk = lin(t, 0.14, 0.4); if (gk > 0 && t < 1.0) { ctx.save(); ctx.globalAlpha = 1 - lin(t, 0.8, 1.0); wordV2(ctx, 'GO!!', 420, 300, gk, { s: 1.35, fill: '#ff3a4a', rot: -0.1, beat: Math.sin(t * 22) * 0.02 }); ctx.restore(); }
    if (t >= FIN_BREAK) {
      for (const f of [[ARCX - 330, 400, 0.02], [ARCX + 280, 310, 0.05], [ARCX - 60, 240, 0.08]]) { const l = t - FIN_BREAK - f[2]; if (l > 0 && l < 0.1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; star4(ctx, f[0], f[1], 150 * (1 - l / 0.1), '#fff', 1); ctx.restore(); } }
      confetti(ctx, t, FIN_BREAK - 0.2, 70, ['#ffd24a', '#ff7aa8', '#7cc8ff', '#9dff8a', '#fff'], 9);
    }
    return;
  }
  // 快門白閃 → 畫面定格縮成一張拍立得（左），標題在右
  const key = P.name + '|' + CFG.n + '|' + (GIRL ? GIRL.width : 0);
  if (!_finPhoto2 || _finPhoto2.key !== key) {
    const c = mk(), x = c.getContext('2d'), sky = x.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#4a8fe0'); sky.addColorStop(0.7, '#bfe6ff'); sky.addColorStop(1, '#fff3c8'); x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.save(); x.globalCompositeOperation = 'lighter'; godRays(x, ARCX, 300, 16, 'rgba(255,255,255,0.16)', 0.2, 1800, 0.45, 12); x.restore();
    finSceneV2(x, FIN_BREAK + 0.07, true);
    const ph = mk(900, 620), px = ph.getContext('2d'); px.drawImage(c, ARCX - 640, ARCB - 850, 1290, 889, 0, 0, 900, 620); _finPhoto2 = { key, img: ph };
  }
  const l = t - FIN_SNAP, k = eo5(lin(l, 0.06, 0.52)), TT = FIN_SNAP + 0.62, pk = decay(t, [[FIN_SNAP, 0.6], [TT, 0.8]], 11);
  const pw = mixv(1500, 760, k), phh = pw * 620 / 900, pxc = mixv(CX, 500, k), pyc = mixv(CY - 20, 520, k), pad = pw * 0.035;
  ctx.save(); camV2(ctx, CX, CY, 1.014 + pk * 0.03); shakeAt(ctx, t, pk * 12);
  dimBG(ctx, 1, [1300, 500, 1000, 'rgba(120,255,160,0.2)']);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, pxc, pyc, 16, `rgba(190,255,200,${0.1 * k})`, t * 0.3, 1600, 0.4, 16); ctx.restore();
  ctx.save(); ctx.translate(pxc, pyc + Math.sin(t * 1.8) * 6 * k); ctx.rotate(-0.07 * k + Math.sin(t * 1.3) * 0.01 * k);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; ctx.fillStyle = '#fbfbf6'; ctx.fillRect(-pw / 2 - pad, -phh / 2 - pad, pw + pad * 2, phh + pad * 5.2); ctx.shadowColor = 'transparent';
  ctx.drawImage(_finPhoto2.img, -pw / 2, -phh / 2, pw, phh);
  ctx.font = `700 ${Math.round(pw * 0.06)}px ${HAND}`; ctx.fillStyle = '#334'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PHOTO FINISH!  ' + P.name, 0, phh / 2 + pad * 2.5, pw * 0.94);
  ctx.restore();
  sparkleField(ctx, t, 18, pxc - 480, pyc - 380, pxc + 480, pyc + 420, k);
  if (t >= TT) { shardsV2(ctx, 1420, 360, t - TT); ringBurst(ctx, 1420, 360, t - TT, { r1: 1100 }); }
  heroTitle(ctx, t, 1420, 360, lin(t, TT, TT + 0.18), { maxW: 900, pk });
  plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 1430, 640, 0.94);
  ctx.restore();
  confetti(ctx, t, FIN_BREAK - 0.2, 70, ['#ffd24a', '#ff7aa8', '#7cc8ff', '#9dff8a', '#fff'], 9);
  if (l < 0.2) flash(ctx, (1 - l / 0.2) * 0.9, '#fff');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.25, '#eaffc0');
}
function v2Finish(ctx, t) { if (!FIN_ARCH) return; runV2(ctx, t, { T: 1e9, exitKind: 'smear', pre: v2FinishScene }); }

// ---------------- 中量 4：單發煙火 ----------------
function fwBurst(ctx, x, y, q, dur, n, r, hue, seed, lw = 4) {   // 菊花型煙火：帶尾巴的光條＋末端閃粉
  if (q < 0 || q > dur) return; const p = q / dur, e = eo(p);
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + R(i, seed) * 0.12, rr = e * r * (0.82 + R(i, seed + 1) * 0.3), xx = x + Math.cos(a) * rr, yy = y + Math.sin(a) * rr + 150 * p * p, tl = (1 - p) * r * 0.22 + 10;
    ctx.strokeStyle = `hsla(${(hue + R(i, seed + 2) * 40) % 360},100%,${72 + 18 * (1 - p)}%,${1 - p * p})`; ctx.lineWidth = lw * (1 - p * 0.6); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - Math.cos(a) * tl, yy - Math.sin(a) * tl - 20 * p); ctx.stroke();
    if (p > 0.45 && (i + Math.floor(q * 30)) % 3 === 0) { ctx.fillStyle = `rgba(255,250,220,${(1 - p) * 0.9})`; ctx.beginPath(); ctx.arc(xx + (R(i, seed + 3) - 0.5) * 16, yy + (R(i, seed + 4) - 0.5) * 16, 2.4, 0, 7); ctx.fill(); } }
}
function v2FireworkScene(ctx, t) {
  const D = CFG.dur, BURST = 1.0, l = t - BURST, app = eo(lin(t, 0, 0.35)), TX = 1070, TY = 372, TT = BURST + 0.62;
  const pts = textPoints('×' + CFG.n, "300px 'Dela Gothic One'", 6), mx = pts.reduce((a, p) => Math.max(a, Math.abs(p[0])), 1), SC = Math.min(1.42, 560 / mx), wide = mx * SC > 520;   // 位數多就縮小，標籤移到上面
  const pk = decay(t, [[BURST, 1], [TT, 0.7], [1.8, 0.3], [2.25, 0.3], [2.7, 0.3]], 9);
  ctx.save(); camV2(ctx, CX, 420, 1.014 + pk * 0.035 + lin(t, 0.25, BURST) * 0.03); shakeAt(ctx, t, pk * 14);
  ctx.save(); ctx.globalAlpha = app; const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, 'rgba(6,5,30,0.9)'); sky.addColorStop(0.75, 'rgba(14,10,46,0.78)'); sky.addColorStop(1, 'rgba(30,14,60,0.6)'); ctx.fillStyle = sky; ctx.fillRect(-80, -80, W + 160, H + 160);
  for (let i = 0; i < 90; i++) { const tw = 0.5 + 0.5 * Math.sin(t * (2 + R(i, 3) * 4) + i); ctx.fillStyle = `rgba(255,255,255,${0.55 * tw})`; ctx.beginPath(); ctx.arc(R(i, 1) * W, R(i, 2) * 760, 1 + R(i, 4) * 1.8, 0, 7); ctx.fill(); }
  ctx.restore();
  if (l >= 0) { const a = Math.exp(-l * 2.2); ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(TX, TY, 0, TX, TY, 1300); gr.addColorStop(0, `rgba(255,190,90,${0.42 * a})`); gr.addColorStop(0.35, `rgba(255,120,60,${0.16 * a})`); gr.addColorStop(1, 'rgba(120,40,80,0)'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (t < BURST) {   // 升空：咻一聲上去，尾巴搖晃
    const k = eo(lin(t, 0.22, BURST)), y = 1160 - (1160 - TY) * k, x = TX + Math.sin(t * 11) * 9 * (1 - k);
    for (let i = 0; i < 60; i++) { const t2 = t - i * 0.01; if (t2 < 0.22) break; const kk = eo(lin(t2, 0.22, BURST)); ctx.fillStyle = `rgba(255,${190 + R(i, 1) * 60 | 0},120,${(1 - i / 60) * 0.85})`; ctx.beginPath(); ctx.arc(TX + Math.sin(t2 * 11) * 9 * (1 - kk) + (R(i, 2) - 0.5) * 14 * (i / 60), 1160 - (1160 - TY) * kk + R(i, 7) * 12, 6 * (1 - i / 60) + 1, 0, 7); ctx.fill(); }
    star4(ctx, x, y, 34 + Math.sin(t * 50) * 8, '#fff8d0', 1);
  } else {
    fwBurst(ctx, TX, TY, l, 1.5, 96, 760, 38, 11, 6); fwBurst(ctx, TX, TY, l - 0.06, 1.3, 60, 430, 330, 17, 4);
    for (const [bt, bx, by, hue, r] of [[1.8, 330, 250, 320, 300], [2.25, 1640, 300, 190, 320], [2.7, 520, 190, 120, 260], [3.1, 1500, 210, 50, 280]]) fwBurst(ctx, bx, by, t - bt, 1.2, 64, r, hue, bt * 10, 4);
    // 粒子排成「×N」
    for (let i = 0; i < pts.length; i++) { const [px, py] = pts[i], k = eo5(lin(l, 0.04 + R(i, 21) * 0.16, 0.5 + R(i, 21) * 0.16)); if (k <= 0) continue;
      const a0 = R(i, 24) * Math.PI * 2, sx = TX + px * SC * k + (1 - k) * Math.cos(a0) * 520, sy = TY + py * SC * k + (1 - k) * Math.sin(a0) * 520;
      const tw = 0.62 + 0.38 * Math.sin(t * 14 + i * 1.7), al = Math.min(1, k * 1.6) * tw, hue = 42 + 16 * Math.sin(i * 0.05 + t * 2);
      ctx.fillStyle = `hsla(${hue},100%,${56 + 20 * tw}%,${al})`; ctx.beginPath(); ctx.arc(sx, sy, 6.2, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,252,230,${al * 0.85})`; ctx.beginPath(); ctx.arc(sx, sy, 2.4, 0, 7); ctx.fill();
      if ((i + Math.floor(t * 20)) % 23 === 0) { const d = ((t * 1.3 + R(i, 25)) % 1); ctx.fillStyle = `rgba(255,236,170,${0.7 * (1 - d)})`; ctx.beginPath(); ctx.arc(sx + (R(i, 26) - 0.5) * 20, sy + d * 150, 2.2, 0, 7); ctx.fill(); } }   // 往下飄的火星
    star4(ctx, TX, TY, 520 * Math.exp(-l * 7), '#fff', Math.min(1, Math.exp(-l * 5) * 1.4));
  }
  ctx.restore();
  if (l >= 0) {
    ringBurst(ctx, TX, TY, l, { r1: 1500, dur: 0.5, sq: 1 });
    wordV2(ctx, LX('gift'), 420, wide ? 168 : 300, lin(t, TT, TT + 0.16), { s: wide ? 1.0 : 1.45, maxW: 520, fill: palFill(ctx, -70, 70, t, PAL.green), rot: -0.08, stroke: '#063a1a' });
    if (t >= TT) ringBurst(ctx, 420, wide ? 168 : 300, t - TT, { r1: 800 });
    const bk = lin(t, TT + 0.2, TT + 0.5); if (bk > 0) { ctx.save(); ctx.translate(318, 742); const s = popK(bk, 2.2); ctx.scale(s, s); bustSafe(ctx, 0, 0, 122, t); ctx.restore(); }
    plateV2(ctx, t, eo(lin(t, TT + 0.3, TT + 0.5)), 1000, 750, 1.08);
  }
  ctx.restore();
  if (l >= 0) flash(ctx, (1 - lin(l, 0, 0.18)) * 0.6, '#fff3d0');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.22, '#eaffc0');
}
function v2Firework(ctx, t) { runV2(ctx, t, { T: 1e9, exitKind: 'crt', pre: v2FireworkScene }); }

VARS.g5[1] = { name: '抽卡翻牌', fn: v2Cards, dur: 4.8 };
VARS.g5[2] = { name: '小彈珠台', fn: v2Pinball, dur: 4.8 };
VARS.g5[3] = { name: '衝線拍照', fn: v2Finish, dur: 4.6 };
VARS.g5[4] = { name: '單發煙火', fn: v2Firework, dur: 4.6 };
