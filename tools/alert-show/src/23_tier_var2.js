
// ======================= 第四輪 第二批：贈訂中量（抽卡翻牌／小彈珠台／衝線／單發煙火） =======================
let _txtPts = { key: '', pts: [] };
function textPoints(text, font, step = 7) {   // 把文字取樣成點，給煙火粒子當目標
  const key = text + font; if (_txtPts.key === key) return _txtPts.pts;
  const c = mk(1400, 420), x = c.getContext('2d'); x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText(text, 700, 210);
  const d = x.getImageData(0, 0, 1400, 420).data, pts = [];
  for (let yy = 0; yy < 420; yy += step) for (let xx = 0; xx < 1400; xx += step) if (d[(yy * 1400 + xx) * 4 + 3] > 128) pts.push([xx - 700, yy - 210]);
  _txtPts = { key, pts }; return pts;
}
function vFirework(ctx, t) {
  const D = CFG.dur, BURST = 1.0, FALL = D - 1.2, out = lin(t, D - 0.45, D - 0.05), pal = PAL[CFG.pal];
  const sky = eo(lin(t, 0, 0.35)) * (1 - out);
  ctx.save(); ctx.globalAlpha = sky;
  const g2 = ctx.createRadialGradient(CX, 420, 100, CX, 520, 1100); g2.addColorStop(0, 'rgba(10,8,40,0.85)'); g2.addColorStop(1, 'rgba(4,2,16,0.55)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) { const tw = 0.5 + 0.5 * Math.sin(t * (2 + R(i, 3) * 4) + i); ctx.fillStyle = `rgba(255,255,255,${0.5 * tw})`; ctx.beginPath(); ctx.arc(R(i, 1) * W, R(i, 2) * 650, 1 + R(i, 4) * 1.5, 0, 7); ctx.fill(); }
  ctx.restore();
  const TX = CX, TY = 400;
  // 火箭上升
  if (t < BURST) { const k = eo(lin(t, 0.25, BURST)), y = 1120 - (1120 - TY) * k, x = TX + Math.sin(t * 9) * 6 * (1 - k);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++) { const tt2 = t - i * 0.012; if (tt2 < 0.25) break; const kk = eo(lin(tt2, 0.25, BURST)), yy = 1120 - (1120 - TY) * kk + R(i, 7) * 10; ctx.fillStyle = `rgba(255,${190 + R(i, 1) * 60 | 0},120,${(1 - i / 40) * 0.8})`; ctx.beginPath(); ctx.arc(TX + (R(i, 2) - 0.5) * 12, yy, 3.5 * (1 - i / 40) + 0.5, 0, 7); ctx.fill(); }
    star4(ctx, x, y, 22, '#fff8d0', 1); ctx.restore(); }
  else {
    const l = t - BURST, pts = textPoints('×' + CFG.n, "300px 'Dela Gothic One'", 6);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (l < 0.5) { const gr = ctx.createRadialGradient(TX, TY, 0, TX, TY, 300 + l * 900); gr.addColorStop(0, `rgba(255,250,220,${0.9 * (1 - l / 0.5)})`); gr.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
    // 外圈散射
    for (let i = 0; i < 140; i++) { const a = R(i, 11) * Math.PI * 2, v = 500 + R(i, 12) * 600, q = Math.min(l, 1.6);
      const x = TX + Math.cos(a) * v * q * (1 - q * 0.3), y = TY + Math.sin(a) * v * q * (1 - q * 0.3) + 260 * q * q, al = 1 - q / 1.6;
      if (al <= 0) continue; ctx.fillStyle = `hsla(${(R(i, 13) * 60 + 30) % 360},100%,${70 + R(i, 14) * 20}%,${al})`; ctx.beginPath(); ctx.arc(x, y, 2.5 + R(i, 15) * 2, 0, 7); ctx.fill(); }
    // 粒子組成「×N」
    const fall = lin(t, FALL, D - 0.1);
    for (let i = 0; i < pts.length; i++) { const [px, py] = pts[i], k = eo5(lin(l, 0.05 + R(i, 21) * 0.15, 0.5 + R(i, 21) * 0.15));
      const sx = TX + px * k + (1 - k) * Math.cos(i) * 40, sy = TY + py * k + (1 - k) * Math.sin(i) * 40;
      const fy = fall > 0 ? fall * fall * (500 + R(i, 22) * 300) : 0, fx = fall > 0 ? (R(i, 23) - 0.5) * 80 * fall : 0;
      const tw = 0.65 + 0.35 * Math.sin(t * 14 + i * 1.7), al = Math.min(1, k * 1.5) * (1 - fall) * tw;
      if (al <= 0.02) continue; const hue = 40 + 20 * Math.sin(i * 0.05 + t * 2);
      ctx.fillStyle = `hsla(${hue},100%,${55 + 20 * tw}%,${al})`; ctx.beginPath(); ctx.arc(sx + fx, sy + fy, 4.6, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,250,220,${al * 0.8})`; ctx.beginPath(); ctx.arc(sx + fx, sy + fy, 1.8, 0, 7); ctx.fill(); }
    // 次發煙火
    for (const [bt, bx, by, hue] of [[1.8, CX - 560, 300, 320], [2.25, CX + 560, 330, 190], [2.7, CX - 300, 220, 120]]) { const q = t - bt; if (q < 0 || q > 1.3) continue;
      for (let i = 0; i < 70; i++) { const a = i / 70 * Math.PI * 2 + bt, r = eo(q / 1.3) * (180 + R(i, bt) * 60), al = 1 - q / 1.3;
        ctx.strokeStyle = `hsla(${hue + i * 2},100%,72%,${al})`; ctx.lineWidth = 3; const x = bx + Math.cos(a) * r, y = by + Math.sin(a) * r + 120 * q * q;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * 22 * (1 - q), y - Math.sin(a) * 22 * (1 - q)); ctx.stroke(); } }
    ctx.restore();
    // 標籤、頭像、名字
    const lk = lin(t, BURST + 0.35, BURST + 0.55), fade = 1 - out;
    if (lk > 0) { ctx.save(); ctx.globalAlpha = fade; const s = lk < 1 ? 1.5 - 0.5 * eback(lk, 1.6) : 1; ctx.translate(TX, TY - 190); ctx.scale(s, s); smallTitle(ctx, t, '贈訂', 0, 0, 72, pal, 'center'); ctx.restore(); }
    const bk = lin(t, BURST + 0.45, BURST + 0.75);
    if (bk > 0) { ctx.save(); ctx.globalAlpha = fade; ctx.translate(TX - 330, 700); const s = eback(bk, 2); ctx.scale(s, s); drawBust(ctx, 0, 0, 92, t); ctx.restore();
      ctx.save(); ctx.globalAlpha = fade * eo(bk); ctx.font = "900 46px 'Noto Sans TC'"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0c0820'; ctx.lineWidth = 10; ctx.strokeText(nameLine(), TX - 210, 700); ctx.fillStyle = '#fff6d0'; ctx.fillText(nameLine(), TX - 210, 700); ctx.restore(); }
  }
}

// ---------------- 中量 2：抽卡翻牌 ----------------
let CARD_BACK = null, CARD_SSR = null, CARD_R = null, PIN_BOARD = null, FIN_ARCH = null;
const CARD_WIN = { ssr: [0.122, 0.156, 0.88, 0.785], r: [0.097, 0.141, 0.898, 0.884] };   // 卡框中央白色區（比例）
const _lvaBase = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaBase();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  CARD_BACK = await L2('DEF_CARD_BACK', 'card_back.png'); CARD_SSR = await L2('DEF_CARD_SSR', 'card_ssr.png'); CARD_R = await L2('DEF_CARD_R', 'card_r.png');
  PIN_BOARD = await L2('DEF_PIN_BOARD', 'pin_board.png'); FIN_ARCH = await L2('DEF_FIN_ARCH', 'fin_arch.png');
};
function cardFace(ctx, kind, h, t, sub) {   // 以卡片中心為原點畫正面
  const img = kind === 'ssr' ? CARD_SSR : CARD_R; if (!img) return;
  const hh = h * img.height / CARD_BACK.height, w = img.width * hh / img.height, [x0, y0, x1, y1] = CARD_WIN[kind];
  ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
  const wx = -w / 2 + x0 * w, wy = -hh / 2 + y0 * hh, ww = (x1 - x0) * w, wh = (y1 - y0) * hh;
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
  const bg = ctx.createLinearGradient(0, wy, 0, wy + wh);
  if (kind === 'ssr') { bg.addColorStop(0, '#fff6d0'); bg.addColorStop(0.5, '#ffd36a'); bg.addColorStop(1, '#ff9ad0'); } else { bg.addColorStop(0, '#e8f6ff'); bg.addColorStop(1, '#8fc8ff'); }
  ctx.fillStyle = bg; ctx.fillRect(wx, wy, ww, wh);
  if (kind === 'ssr') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 0, wy + wh * 0.3, 18, 'rgba(255,255,255,0.25)', t * 0.6, 900, 0.4, 6); ctx.restore();
    if (GIRL) { const gh = wh * 2.3, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, -gw / 2 + (0.5 - FACE.x) * gw * 0.6, wy - FACE.y * gh + wh * 0.32, gw, gh); } }
  else if (sub === 'r1' && MASCOT) { const mh = wh * 0.8; drawImg(ctx, MASCOT, 0, wy + wh * 0.52, mh, -0.05); }
  else { ctx.font = "900 " + Math.round(ww * 0.2) + "px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#2a6ad0'; ctx.fillText('THANK', 0, wy + wh * 0.42); ctx.fillText('YOU', 0, wy + wh * 0.6); }
  ctx.restore();
  return { plateY: kind === 'ssr' ? hh * 0.343 : null, w };
}
function vCards(ctx, t) {
  if (!CARD_BACK) return;
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), dim = eo(lin(t, 0, 0.3)) * (1 - lin(t, D - 0.35, D)), pal = PAL[CFG.pal];
  ctx.save(); ctx.fillStyle = `rgba(4,4,14,${0.5 * dim})`; ctx.fillRect(0, 0, W, H);
  const sp = ctx.createRadialGradient(CX, 520, 0, CX, 520, 700); sp.addColorStop(0, `rgba(120,140,255,${0.25 * dim})`); sp.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sp; ctx.fillRect(0, 0, W, H); ctx.restore();
  const CH = 430, F3 = 2.0, cards = [{ x: CX - 420, t0: 0.12, flip: 0.8, kind: 'r1' }, { x: CX + 420, t0: 0.2, flip: 1.05, kind: 'r2' }, { x: CX, t0: 0.28, flip: F3, kind: 'ssr' }];
  // SSR 揭曉前的蓄力光
  const charge = lin(t, 1.3, F3), after = t - F3;
  if (charge > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const a = after < 0 ? charge : Math.max(0, 1 - after * 0.8);
    for (let h = 0; h < 6; h++) godRays(ctx, CX, 520, 6, `hsla(${(h * 60 + t * 160) % 360},100%,60%,${0.1 * a})`, t * 0.8 + h * Math.PI / 18, 1400, 0.45, 14);
    const gr = ctx.createRadialGradient(CX, 520, 0, CX, 520, 420 + 200 * a); gr.addColorStop(0, `rgba(255,240,180,${0.45 * a})`); gr.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  cards.forEach((c, i) => {
    const k = eback(lin(t, c.t0, c.t0 + 0.4), 1.4); if (k <= 0) return;
    let x = CX + (c.x - CX) * k, y = 1250 - (1250 - 520) * k, rot = (1 - k) * (i - 1) * 0.6, s = 1, al = 1 - out;
    if (c.kind === 'ssr') { if (after > 0) { const up = eback(lin(after, 0, 0.35), 1.6); s = 1 + 0.28 * up; y -= 30 * up; } else if (charge > 0) { x += Math.sin(t * 60) * 6 * charge; rot += Math.sin(t * 47) * 0.03 * charge; s = 1 + 0.04 * charge; } }
    else if (after > 0) { const q = ei(lin(after, 0.05, 0.45)); y += q * 500; al *= 1 - q; }
    if (out > 0) { y -= out * 500; rot += out * 3 * (i - 1 || 1); }
    const fk = lin(t, c.flip, c.flip + (c.kind === 'ssr' ? 0.25 : 0.2)), sx = Math.abs(Math.cos(Math.PI * fk)) || 0.001;
    ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * sx, s);
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
    if (fk < 0.5) { const bw = CARD_BACK.width * CH / CARD_BACK.height; ctx.drawImage(CARD_BACK, -bw / 2, -CH / 2, bw, CH); }
    else { ctx.shadowColor = 'transparent'; const r = cardFace(ctx, c.kind === 'ssr' ? 'ssr' : 'r', CH, t, c.kind);
      if (c.kind === 'ssr' && r) { const nk = lin(t, F3 + 0.45, F3 + 0.7); if (nk > 0) { ctx.globalAlpha = al * nk; ctx.font = "900 26px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a3000'; ctx.fillText(P.name, 0, r.plateY); } } }
    ctx.restore();
    if (fk > 0 && fk < 1 && c.kind !== 'ssr') sparkBurst(ctx, x, y, (t - c.flip) * 1.5, 8, 0.6, '#cfe8ff');
  });
  if (after > 0 && after < 0.2) flash(ctx, (1 - after / 0.2) * 0.45, '#fff3c0');
  sparkBurst(ctx, CX, 480, after, 18, 1.6, '#fff6c0');
  if (after > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 26; i++) { const ph = (t * (0.6 + R(i, 1)) + R(i, 2)) % 1; star4(ctx, CX + (R(i, 3) - 0.5) * 900, 820 - ph * 600, 14 * Math.sin(ph * Math.PI), i % 2 ? '#fff' : '#ffe9a0', (1 - out) * Math.sin(ph * Math.PI)); } ctx.restore(); }
  const tk = lin(t, F3 + 0.35, F3 + 0.55);
  if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(CX - 640, 470); ctx.rotate(-0.06); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 96, pal, 'center'); ctx.restore(); }
  const nk = eo(lin(t, F3 + 0.55, F3 + 0.75));
  if (nk > 0) { ctx.save(); ctx.globalAlpha = (1 - out) * nk; ctx.font = "900 44px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0c0820'; ctx.lineWidth = 10; ctx.strokeText(nameLine(), CX - 640, 570); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), CX - 640, 570); ctx.restore(); }
}

VARS.g5[1] = { name: '抽卡翻牌', fn: vCards, dur: 4.6 };
VARS.g5[4] = { name: '單發煙火', fn: vFirework, dur: 4.4 };
