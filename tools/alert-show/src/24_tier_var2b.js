
// ---------------- 中量 3：小彈珠台 ----------------
function celBall(ctx, x, y, r, a = 1) {   // 平塗風鋼珠：底色＋暗面＋白色高光塊＋深色描線
  ctx.save(); ctx.globalAlpha *= a;
  ctx.fillStyle = '#c8cedb'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.save(); ctx.clip(); ctx.fillStyle = '#8f97aa'; ctx.beginPath(); ctx.arc(x + r * 0.35, y + r * 0.4, r * 0.95, 0, 7); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.38, r * 0.32, r * 0.22, -0.6, 0, 7); ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.16); ctx.strokeStyle = '#2b2442'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
  ctx.restore();
}
// 盤面座標（原圖 646x887）：軌道圓心與半徑、釘子落點、入賞口燈泡，全部照圖量
const PIN_RAIL = { cx: 322.5, cy: 568, r: 368, a0: -2.12, a1: -1.08 };
const PIN_HITS = [[490, 259], [456, 309], [423, 358], [389, 408], [356, 456], [322, 494]];
const PIN_POCKET = [322, 652], PIN_BULBS = [[222, 650], [237, 603], [270, 566], [322, 553], [375, 566], [408, 603], [422, 650]];
const PIN_T = { rail0: 0.45, rail1: 1.0, first: 1.12, step: 0.15, hit: 2.32 };
function pinBallPos(t) {   // 回傳盤面座標的球心，或 null
  const T = PIN_T;
  if (t < 0.25) return null;
  if (t < T.rail0) { const a = PIN_RAIL.a0; return [PIN_RAIL.cx + Math.cos(a) * PIN_RAIL.r, PIN_RAIL.cy + Math.sin(a) * PIN_RAIL.r + (1 - lin(t, 0.25, T.rail0)) * 60]; }
  if (t < T.rail1) { const u = eo(lin(t, T.rail0, T.rail1)), a = PIN_RAIL.a0 + (PIN_RAIL.a1 - PIN_RAIL.a0) * u; return [PIN_RAIL.cx + Math.cos(a) * PIN_RAIL.r, PIN_RAIL.cy + Math.sin(a) * PIN_RAIL.r]; }
  const re = [PIN_RAIL.cx + Math.cos(PIN_RAIL.a1) * PIN_RAIL.r, PIN_RAIL.cy + Math.sin(PIN_RAIL.a1) * PIN_RAIL.r];
  if (t < T.first) { const u = lin(t, T.rail1, T.first); return [re[0] + (PIN_HITS[0][0] - re[0]) * u, re[1] + (PIN_HITS[0][1] - re[1]) * u * u]; }
  const k = Math.floor((t - T.first) / T.step);
  if (k < PIN_HITS.length - 1) { const u = (t - T.first - k * T.step) / T.step, a = PIN_HITS[k], b = PIN_HITS[k + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - 20 * 4 * u * (1 - u)]; }
  const last = PIN_HITS[PIN_HITS.length - 1], t5 = T.first + (PIN_HITS.length - 1) * T.step;
  if (t < T.hit) { const u = lin(t, t5, T.hit); return [last[0] + Math.sin(u * Math.PI * 3) * 6 * (1 - u), last[1] - 14 * Math.sin(Math.min(1, u * 3) * Math.PI) + (PIN_POCKET[1] - last[1]) * Math.pow(u, 2.2)]; }
  return null;
}
function vPinball(ctx, t) {
  if (!PIN_BOARD) return;
  const D = CFG.dur, T = PIN_T, HIT = T.hit, out = ei(lin(t, D - 0.5, D - 0.05)), dim = eo(lin(t, 0, 0.3)) * (1 - lin(t, D - 0.35, D)), pal = PAL[CFG.pal];
  ctx.save(); ctx.fillStyle = `rgba(4,4,14,${0.45 * dim})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  const t5 = T.first + (PIN_HITS.length - 1) * T.step, reach = t > t5 && t < HIT;
  const zoom = 1 + 0.06 * ((u) => u * u * (3 - 2 * u))(lin(t, t5, HIT)) * (1 - eo(lin(t, HIT + 0.1, HIT + 0.6)));   // 最後一顆釘子到入賞口：慢慢推近
  const bh = 780, s = bh / PIN_BOARD.height, bw = PIN_BOARD.width * s, bx = CX - 330, by = 540 + (1 - eback(lin(t, 0, 0.4), 1.4)) * 700 + out * 700;
  const toS = (p) => [bx - bw / 2 + p[0] * s, by - bh / 2 + p[1] * s];
  const pp = toS(PIN_POCKET), px = pp[0], py = pp[1];
  const pk = t >= HIT ? Math.exp(-(t - HIT) * 9) : 0, sh = pk * 9;
  ctx.save();
  ctx.translate(px, py); ctx.scale(zoom, zoom); ctx.translate(-px, -py);
  ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * sh, (R(Math.floor(t * 60), 2) - 0.5) * sh);
  ctx.drawImage(PIN_BOARD, bx - bw / 2, by - bh / 2, bw, bh);
  const BR = 18 * s;
  // 撞釘：釘子亮一下＋白色圓圈擴散
  for (let i = 0; i < PIN_HITS.length; i++) {
    const th = T.first + i * T.step, l = t - th; if (l < 0 || l > 0.3) continue;
    const p = toS([PIN_HITS[i][0], PIN_HITS[i][1] + 26]), q = l / 0.3;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 26); g.addColorStop(0, `rgba(255,250,210,${0.9 * (1 - q)})`); g.addColorStop(1, 'rgba(255,230,120,0)'); ctx.fillStyle = g; ctx.fillRect(p[0] - 26, p[1] - 26, 52, 52); ctx.restore();
    ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${1 - q})`; ctx.lineWidth = 4 * (1 - q) + 1; ctx.beginPath(); ctx.arc(p[0], p[1], 10 + 30 * eo(q), 0, 7); ctx.stroke(); ctx.restore();
  }
  // 入賞口燈泡：最後一段依序跑燈（リーチ感），入賞後全亮交替閃
  for (let i = 0; i < PIN_BULBS.length; i++) {
    let on = 0;
    if (reach) on = Math.floor((t - t5) * 22) % PIN_BULBS.length === i ? 1 : 0.15;
    else if (t >= HIT) on = (Math.floor((t - HIT) * 12) + i) % 2 ? 1 : 0.45;
    if (!on) continue;
    const b = toS(PIN_BULBS[i]); ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], 30); g.addColorStop(0, `rgba(255,248,200,${on})`); g.addColorStop(0.4, `rgba(255,200,120,${0.6 * on})`); g.addColorStop(1, 'rgba(255,160,80,0)'); ctx.fillStyle = g; ctx.fillRect(b[0] - 30, b[1] - 30, 60, 60); ctx.restore();
  }
  // 球：軌道上滑、撞釘、掉進入賞口（帶殘影）
  for (let k = 3; k >= 0; k--) { const bp = pinBallPos(t - k * 0.018); if (!bp) continue; const p = toS(bp); celBall(ctx, p[0], p[1], BR, k ? 0.18 * (4 - k) / 3 : 1); }
  // 入賞後：光柱、派彩鋼珠從入賞口噴出落進下方球盤
  if (t >= HIT) {
    const l = t - HIT;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(14px)';
    const bm = ctx.createLinearGradient(0, py, 0, py - 620); bm.addColorStop(0, `rgba(255,236,170,${0.5 * Math.min(1, l * 5) * (1 - lin(l, 1.0, 2.0))})`); bm.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = bm; ctx.fillRect(px - 60, py - 620, 120, 620); ctx.restore();
    const lip = toS([0, 724])[1], tl = toS([95, 0])[0], tr = toS([550, 0])[0];
    ctx.save(); ctx.beginPath(); ctx.rect(bx - bw, by - bh, bw * 2, lip - (by - bh)); ctx.clip();
    for (let i = 0; i < 30; i++) {
      const st = 0.05 + R(i, 3) * 1.1, q = l - st; if (q < 0 || q > 0.8) continue;
      const vx = (R(i, 5) - 0.5) * 520, x = px + vx * q, y = py + 30 - 260 * q + 1500 * q * q;
      celBall(ctx, Math.max(tl, Math.min(tr, x)), y, BR * 0.9);
    }
    ctx.restore();
    const pile = Math.min(18, Math.floor(l * 14));   // 球盤滿出來
    for (let i = 0; i < pile; i++) { const x = tl + 20 + R(i, 8) * (tr - tl - 40), y = lip - BR * 0.6 - (i > 9 ? BR * 1.4 : 0); celBall(ctx, x, y, BR * 0.9); }
  }
  ctx.restore();
  if (reach) { const k = lin(t, t5, t5 + 0.15); ctx.save(); ctx.globalAlpha = k; ctx.translate(px, py - 330); smallTitle(ctx, t, 'チャンス!', 0, 0, 54, PAL.red, 'center'); ctx.restore(); }
  if (t >= HIT) {
    const l = t - HIT;
    if (l < 0.6) { const k = lin(l, 0, 0.15); ctx.save(); ctx.translate(px, py - 190); ctx.rotate(-0.08); const ss = k < 1 ? 2 - eback(k, 1.6) : 1; ctx.scale(ss, ss); ctx.globalAlpha = 1 - lin(l, 0.45, 0.6); smallTitle(ctx, t, '入賞!', 0, 0, 96, PAL.gold, 'center'); ctx.restore(); }
    const rk = lin(l, 0.45, 0.8); if (rk > 0) { ctx.save(); ctx.globalAlpha = 1 - out; const s2 = 0.4 + 0.6 * eback(rk, 2); ctx.translate(px, py - 60 - 220 * eo(rk)); ctx.scale(s2, s2); drawBust(ctx, 0, 0, 96, t); ctx.restore(); }
    sparkBurst(ctx, px, py - 40, l, 16, 1.4, '#fff6c0');
    const tk = lin(l, 0.6, 0.8); if (tk > 0) { const ss = tk < 1 ? 1.7 - 0.7 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(CX + 300, 470); ctx.rotate(-0.05); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 100, pal, 'center'); ctx.restore(); }
    const nk = eo(lin(l, 0.8, 1.0)); if (nk > 0) { ctx.save(); ctx.globalAlpha = (1 - out) * nk; ctx.font = "900 44px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0c0820'; ctx.lineWidth = 10; ctx.strokeText(nameLine(), CX + 300, 575); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), CX + 300, 575); ctx.restore(); }
    flash(ctx, (1 - lin(t, HIT, HIT + 0.1)) * 0.25, '#fff6c0');
  }
}

// ---------------- 中量 4：衝線（終點拍照） ----------------
let _finPhoto = null;
const FIN_BREAK = 1.5, FIN_SNAP = 1.62;
function finishScene(ctx, t, ARCX, ARCB, AH) {
  const aw = FIN_ARCH.width * AH / FIN_ARCH.height;
  // 跑道
  const tr = ctx.createLinearGradient(0, ARCB - 70, 0, ARCB + 60); tr.addColorStop(0, '#c8503a'); tr.addColorStop(1, '#8a2a1e');
  ctx.fillStyle = tr; ctx.beginPath(); ctx.moveTo(-50, ARCB - 40); ctx.lineTo(W + 50, ARCB - 70); ctx.lineTo(W + 50, ARCB + 130); ctx.lineTo(-50, ARCB + 130); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 4;
  for (const yy of [ARCB - 10, ARCB + 40]) { ctx.beginPath(); ctx.moveTo(-50, yy + 20); ctx.lineTo(W + 50, yy - 10); ctx.stroke(); }
  ctx.drawImage(FIN_ARCH, ARCX - aw / 2, ARCB - AH, aw, AH);
  // 終點線緞帶
  const ty = ARCB - AH * 0.45, x0 = ARCX - aw * 0.31, x1 = ARCX + aw * 0.31;
  ctx.strokeStyle = '#ff2a4a'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  if (t < FIN_BREAK) { ctx.beginPath(); ctx.moveTo(x0, ty); ctx.quadraticCurveTo(ARCX, ty + 18, x1, ty); ctx.stroke(); }
  else {
    const l = t - FIN_BREAK;
    for (const sg of [-1, 1]) {
      const xa = sg < 0 ? x0 : x1; ctx.beginPath(); ctx.moveTo(xa, ty);
      for (let j = 1; j <= 12; j++) { const u = j / 12, xx = xa + (ARCX - xa) * u * (1 - Math.min(1, l * 2.2)) + sg * u * 40 * Math.min(1, l * 3), yy = ty + u * u * 260 * Math.min(1, l * 2.5) + Math.sin(u * 8 + l * 14) * 10 * u; ctx.lineTo(xx, yy); }
      ctx.stroke();
    }
  }
  // 角色衝刺
  const rk = lin(t, 0.4, FIN_BREAK), sm = rk * rk * (3 - 2 * rk), gx = -260 + (ARCX + 40 + 260) * sm + (t > FIN_BREAK ? (t - FIN_BREAK) * 120 : 0), gh = 600, gy = ARCB - gh / 2 + 24 - Math.abs(Math.sin(t * 26)) * 16;
  if (GIRL && rk > 0) {
    if (t < FIN_BREAK + 0.1) {
      for (let k = 1; k <= 4; k++) drawImg(ctx, silhouette(GIRL_SIL, `hsl(${200 + k * 30},100%,70%)`), gx - k * 70, gy, gh, 0.12, 0.22 * (1 - k / 5));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) { const yy = ARCB - 600 + R(i, 1) * 560, len = 180 + R(i, 2) * 260; ctx.fillStyle = `rgba(255,255,255,${0.25 + R(i, 3) * 0.3})`; ctx.fillRect(gx - 260 - len - ((t * 3000 + R(i, 4) * 900) % 400), yy, len, 3); }
      ctx.restore();
    }
    neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, 0.12); drawImg(ctx, GIRL, gx, gy, gh, 0.12);
    for (let i = 0; i < 6; i++) { const l = (t * 4 + R(i, 7)) % 1; ctx.fillStyle = `rgba(255,240,220,${0.35 * (1 - l)})`; ctx.beginPath(); ctx.arc(gx - 60 - l * 160, ARCB + 20 - l * 30, 10 + l * 24, 0, 7); ctx.fill(); }
  }
}
function vFinish(ctx, t) {
  if (!FIN_ARCH) return;
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), pal = PAL[CFG.pal];
  const ARCX = 1240, ARCB = 960, AH = 800, app = eo5(lin(t, 0, 0.35));
  ctx.save(); ctx.fillStyle = `rgba(4,4,14,${0.4 * app * (1 - out)})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  if (t < FIN_SNAP) {
    ctx.save(); ctx.globalAlpha = app; ctx.translate(0, (1 - app) * 300); finishScene(ctx, t, ARCX, ARCB, AH); ctx.restore();
    const gk = lin(t, 0.15, 0.45);
    if (gk > 0 && t < 0.9) { ctx.save(); ctx.globalAlpha = 1 - lin(t, 0.7, 0.9); const s = gk < 1 ? 2.2 - 1.2 * eback(gk, 1.6) : 1; ctx.translate(560, 330); ctx.rotate(-0.1); ctx.scale(s, s); smallTitle(ctx, t, 'GO!', 0, 0, 130, PAL.red, 'center'); ctx.restore(); }
    if (t >= FIN_BREAK) {
      confetti(ctx, t, FIN_BREAK - 0.2, 60, ['#ffd24a', '#ff7aa8', '#7cc8ff', '#9dff8a', '#fff'], 9);
      for (const f of [[ARCX - 300, 380, FIN_BREAK + 0.02], [ARCX + 260, 300, FIN_BREAK + 0.06], [ARCX - 80, 250, FIN_BREAK + 0.1]]) { const l = t - f[2]; if (l > 0 && l < 0.12) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; star4(ctx, f[0], f[1], 110 * (1 - l / 0.12), '#fff', 1); ctx.restore(); } }
    }
    return;
  }
  // 拍照定格：快門白閃，畫面縮成一張拍立得
  const key = P.name + '|' + CFG.n + '|' + (GIRL ? GIRL.width : 0);
  if (!_finPhoto || _finPhoto.key !== key) {
    const c = mk(), x = c.getContext('2d'); x.fillStyle = '#1a1f3a'; x.fillRect(0, 0, W, H); finishScene(x, FIN_BREAK + 0.06, ARCX, ARCB, AH);
    const ph = mk(860, 560), px = ph.getContext('2d'); px.drawImage(c, ARCX - 600, ARCB - 830, 1180, 768, 0, 0, 860, 560); _finPhoto = { key, img: ph };
  }
  const l = t - FIN_SNAP, k = eo5(lin(l, 0.05, 0.5)), photoW = 860 - 280 * k, photoH = photoW * 560 / 860, pxc = CX + (620 - CX) * k, pyc = 520 - 20 * k;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(pxc - out * 600, pyc - out * 300); ctx.rotate(-0.07 * k - out * 1.2);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14; ctx.fillStyle = '#fbfbf6'; const pad = 22 * (photoW / 580);
  ctx.fillRect(-photoW / 2 - pad, -photoH / 2 - pad, photoW + pad * 2, photoH + pad * 5); ctx.shadowColor = 'transparent';
  ctx.drawImage(_finPhoto.img, -photoW / 2, -photoH / 2, photoW, photoH);
  ctx.font = `700 ${Math.round(34 * photoW / 580)}px ${HAND}`; ctx.fillStyle = '#334'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PHOTO FINISH  ' + P.name, 0, photoH / 2 + pad * 2.4);
  ctx.restore();
  if (l < 0.18) flash(ctx, (1 - l / 0.18) * 0.85, '#fff');
  const tk = lin(l, 0.45, 0.65);
  if (tk > 0) { const ss = tk < 1 ? 1.7 - 0.7 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(1340, 440); ctx.rotate(-0.05); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 100, pal, 'center'); ctx.restore(); }
  const nk = eo(lin(l, 0.65, 0.85));
  if (nk > 0) { ctx.save(); ctx.globalAlpha = (1 - out) * nk; ctx.font = "900 44px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0c0820'; ctx.lineWidth = 10; ctx.strokeText(nameLine(), 1340, 545); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), 1340, 545); ctx.restore(); }
  confetti(ctx, t, FIN_BREAK - 0.2, 60, ['#ffd24a', '#ff7aa8', '#7cc8ff', '#9dff8a', '#fff'], 9);
}
VARS.g5[2] = { name: '小彈珠台', fn: vPinball, dur: 4.6 };
VARS.g5[3] = { name: '衝線拍照', fn: vFinish, dur: 4.4 };
