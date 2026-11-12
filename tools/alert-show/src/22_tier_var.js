
// ======================= 第四輪：每級 5 種演出（變體）＋份數自訂 =======================
const HAND = "'LXGW WenKai TC', 'Noto Sans TC'";
function heartPath(ctx, x, y, s) { ctx.beginPath(); ctx.moveTo(x, y + s * 0.9); ctx.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.7, y - s * 1.3, x, y - s * 0.4); ctx.bezierCurveTo(x + s * 0.7, y - s * 1.3, x + s * 1.6, y - s * 0.1, x, y + s * 0.9); }
function smallTitle(ctx, t, text, x, y, size, pal, align = 'left', maxW = 0) {   // 小卡用的描邊標題；maxW：超過就縮小
  if (maxW) { ctx.save(); ctx.font = /[揪閱號]/.test(text) ? `900 ${size}px 'Noto Sans TC'` : `${size}px 'Dela Gothic One', 'Noto Sans TC'`; const _w = ctx.measureText(text).width; ctx.restore(); if (_w > maxW) size *= maxW / _w; }
  const k = size / 84;
  ctx.save(); ctx.font = /[揪閱號]/.test(text) ? `900 ${size}px 'Noto Sans TC'` : `${size}px 'Dela Gothic One', 'Noto Sans TC'`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0c0820'; ctx.lineWidth = 22 * k; ctx.strokeText(text, x, y);
  ctx.strokeStyle = pal.edge[1]; ctx.lineWidth = 12 * k; ctx.strokeText(text, x, y);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * k; ctx.strokeText(text, x, y);
  ctx.fillStyle = palFill(ctx, y - size / 2, y + size / 2, t, pal); ctx.fillText(text, x, y); ctx.restore();
}
function nameLine() { return CFG.n ? `${P.name} 送出了 ${CFG.n} 份訂閱` : `${P.name} 訂閱了`; }
function sparkBurst(ctx, x, y, l, n = 10, spread = 1, col = '#fff') {
  if (l < 0 || l > 0.6) return; ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) { const a = R(i, 3) * Math.PI * 2, d = (60 + l * 420) * spread; star4(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, 16 * (1 - l / 0.6), col, 1 - l / 0.6); }
  ctx.restore();
}
function textBox(ctx, lines, x, y, pad = 34) {   // 量好寬度再畫底，避免字超出框
  let w = 0; for (const [txt, font] of lines) { ctx.font = font; w = Math.max(w, ctx.measureText(txt).width); } return w + pad * 2;
}

// ---------------- 訂閱 2：和紙便條 ----------------
function vMemo(ctx, t) {
  const D = CFG.dur, cx = 380, cy = 845, w = 600, h = 280;
  const fall = lin(t, 0, 0.38), land = t - 0.38;
  let y = cy - (1 - ei(fall)) * 760, rot = -0.05 + (1 - fall) * 0.3 * Math.sin(t * 9), sx = 1, sy = 1;
  if (land >= 0) { const b = Math.exp(-land * 9) * Math.sin(land * 30); sy = 1 - b * 0.12; sx = 1 + b * 0.08; rot = -0.05 + b * 0.04; }
  const out = ei(lin(t, D - 0.5, D - 0.05)); y -= out * 320; rot -= out * 0.7;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(cx - out * 520, y); ctx.rotate(rot); ctx.scale(sx, sy);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 12; ctx.fillStyle = '#fffaf0'; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  ctx.strokeStyle = 'rgba(120,160,220,0.35)'; ctx.lineWidth = 2;
  for (let ly = -h / 2 + 74; ly < h / 2; ly += 48) { ctx.beginPath(); ctx.moveTo(-w / 2 + 20, ly); ctx.lineTo(w / 2 - 20, ly); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(230,90,110,0.5)'; ctx.beginPath(); ctx.moveTo(-w / 2 + 128, -h / 2); ctx.lineTo(-w / 2 + 128, h / 2); ctx.stroke();
  const bk = lin(t, 0.45, 0.7); if (bk > 0) { ctx.save(); ctx.translate(-w / 2 + 66, -h / 2 + 78); ctx.rotate(-0.15); const s = eback(bk, 2); ctx.scale(s, s); drawBust(ctx, 0, 0, 62, t); ctx.restore(); }
  const tw = lin(t, 0.6, 1.15);
  if (tw > 0) { ctx.save(); ctx.font = `700 76px ${HAND}`; ctx.textBaseline = 'middle'; const W2 = ctx.measureText(CFG.title).width;
    ctx.beginPath(); ctx.rect(-w / 2 + 140, -h / 2, W2 * tw + 12, h); ctx.clip(); ctx.fillStyle = '#2a2a40'; ctx.fillText(CFG.title, -w / 2 + 146, -h / 2 + 96); ctx.restore(); }
  const nw = lin(t, 1.05, 1.5);
  if (nw > 0) { ctx.save(); ctx.font = `700 42px ${HAND}`; ctx.textBaseline = 'middle'; const txt = nameLine(); { const _w = ctx.measureText(txt).width, _av = w - 196; if (_w > _av) ctx.font = `700 ${Math.floor(42 * _av / _w)}px ${HAND}`; } const W2 = ctx.measureText(txt).width;
    ctx.beginPath(); ctx.rect(-w / 2 + 140, -10, W2 * nw + 12, 120); ctx.clip(); ctx.fillStyle = '#d04a6a'; ctx.fillText(txt, -w / 2 + 146, 50); ctx.restore(); }
  const hk = lin(t, 1.45, 1.85); if (hk > 0) { heartPath(ctx, w / 2 - 64, h / 2 - 64, 30); ctx.setLineDash([400]); ctx.lineDashOffset = 400 * (1 - hk); ctx.strokeStyle = '#e8506a'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.stroke(); ctx.setLineDash([]); }
  for (const [tx, ty, tr, k0, col] of [[-w / 2 + 34, -h / 2 - 4, -0.6, 0.42, '#ffb3c7'], [w / 2 - 34, -h / 2 - 4, 0.6, 0.5, '#a8e0ff']]) {
    const k = lin(t, k0, k0 + 0.12); if (k <= 0) continue;
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(tr); const s = 1.4 - 0.4 * eo(k); ctx.scale(s, s); ctx.globalAlpha = (1 - out) * k * 0.92;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-62, -18); for (let i = 0; i <= 6; i++) ctx.lineTo(-62 + i * 20.6, -18 + (i % 2 ? 3 : 0)); ctx.lineTo(62, 18); for (let i = 6; i >= 0; i--) ctx.lineTo(-62 + i * 20.6, 18 - (i % 2 ? 3 : 0)); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; for (let i = -48; i < 60; i += 20) { ctx.beginPath(); ctx.arc(i, 0, 4, 0, 7); ctx.fill(); } ctx.restore(); }
  ctx.restore();
  sparkBurst(ctx, cx, cy + h / 2 - 20, land, 10, 1.2);
}

// ---------------- 訂閱 3：泡泡 ----------------
function bubbleDraw(ctx, x, y, r, t, wob = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1 + Math.sin(t * 7) * 0.04 * wob, 1 - Math.sin(t * 7) * 0.04 * wob);
  const g2 = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r); g2.addColorStop(0, 'rgba(255,255,255,0.04)'); g2.addColorStop(0.85, 'rgba(200,230,255,0.12)'); g2.addColorStop(1, 'rgba(255,255,255,0.45)');
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  const rg = ctx.createLinearGradient(-r, -r, r, r); rg.addColorStop(0, 'rgba(255,120,200,0.75)'); rg.addColorStop(0.5, 'rgba(120,220,255,0.75)'); rg.addColorStop(1, 'rgba(255,230,120,0.75)');
  ctx.strokeStyle = rg; ctx.lineWidth = Math.max(2, r * 0.04); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-r * 0.4, -r * 0.45, r * 0.22, r * 0.1, -0.6, 0, 7); ctx.fill(); ctx.restore();
}
function vBubble(ctx, t) {
  const D = CFG.dur, bx = 300, POP = 1.05, by0 = 820;
  for (let i = 0; i < 24; i++) { const st = R(i, 1) * (D - 0.5), l = t - st; if (l < 0 || l > 2.2) continue;
    bubbleDraw(ctx, bx - 220 + R(i, 2) * 760 + Math.sin(l * 3 + i) * 20, 1110 - l * (220 + R(i, 3) * 200), 8 + R(i, 4) * 22, t + i, 0.5); }
  const out = ei(lin(t, D - 0.45, D - 0.05));
  if (t < POP) {
    const by = 1180 - (1180 - by0) * eo(lin(t, 0, 0.95)) + Math.sin(t * 4) * 8;
    ctx.save(); ctx.beginPath(); ctx.arc(bx, by, 118, 0, 7); ctx.clip(); drawBust(ctx, bx, by, 110, t); ctx.restore(); bubbleDraw(ctx, bx, by, 125, t);
    return;
  }
  const l = t - POP, s = eback(lin(t, POP, POP + 0.25), 2);
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(bx, by0 - out * 60); ctx.scale(s * (1 - out * 0.5), s * (1 - out * 0.5)); drawBust(ctx, 0, 0, 110, t); ctx.restore();
  if (l < 0.5) { const q = l / 0.5; ctx.save(); ctx.strokeStyle = `rgba(200,240,255,${1 - q})`; ctx.lineWidth = 6 * (1 - q); ctx.beginPath(); ctx.arc(bx, by0, 125 + l * 260, 0, 7); ctx.stroke();
    ctx.fillStyle = `rgba(220,245,255,${1 - q})`; for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, d = 130 + eo(q) * 170; ctx.beginPath(); ctx.arc(bx + Math.cos(a) * d, by0 + Math.sin(a) * d + l * l * 300, 6 * (1 - q) + 1, 0, 7); ctx.fill(); } ctx.restore(); }
  const pk = lin(t, POP + 0.05, POP + 0.3);
  if (pk > 0) {
    const f1 = "900 60px 'Noto Sans TC'", f2 = "900 34px 'Noto Sans TC'", pw = textBox(ctx, [[CFG.title, f1], [nameLine(), f2]], 0, 0, 40), ph = 156;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(bx + 150, by0 - 30 - out * 80); const ps = eback(pk, 1.8); ctx.scale(ps, ps);
    ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.strokeStyle = '#7cc8ff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.roundRect(0, -ph / 2, pw, ph, ph / 2); ctx.fill(); ctx.stroke();
    ctx.font = f1; ctx.textBaseline = 'middle'; let x = 40;
    Array.from(CFG.title).forEach((c, i) => { const k = lin(t, POP + 0.12 + i * 0.06, POP + 0.32 + i * 0.06); const cw = ctx.measureText(c).width; if (k > 0) { ctx.globalAlpha = (1 - out) * Math.min(1, k * 2); ctx.fillStyle = '#2a6ad0'; ctx.fillText(c, x, -24 - (1 - eback(k, 2.5)) * 40); } x += cw; });
    const nk = lin(t, POP + 0.5, POP + 0.75); if (nk > 0) { ctx.globalAlpha = (1 - out) * nk; ctx.font = f2; ctx.fillStyle = '#4a5878'; ctx.fillText(nameLine(), 40, 40); }
    ctx.restore();
  }
}

// ---------------- 訂閱 4：郵票蓋章 ----------------
const stC = mk(400, 480), stX = stC.getContext('2d');
function vStamp(ctx, t) {
  const D = CFG.dur, cx = 290, cy = 820, k = lin(t, 0, 0.28), land = t - 0.28, out = ei(lin(t, D - 0.45, D - 0.05));
  stX.setTransform(1, 0, 0, 1, 0, 0); stX.globalCompositeOperation = 'source-over'; stX.clearRect(0, 0, 400, 480); stX.save(); stX.translate(200, 240);
  stX.fillStyle = '#fffdf6'; stX.fillRect(-170, -210, 340, 420);
  const bg = stX.createLinearGradient(0, -185, 0, 115); bg.addColorStop(0, '#bfe6ff'); bg.addColorStop(1, '#6aa8f0'); stX.fillStyle = bg; stX.fillRect(-145, -185, 290, 300);
  stX.save(); stX.beginPath(); stX.rect(-145, -185, 290, 300); stX.clip();
  if (GIRL) { const fx = FACE.x * GIRL.width, fy = FACE.y * GIRL.height, sz = FACE.s * GIRL.height * 2.6; stX.drawImage(GIRL, fx - sz / 2, fy - sz * 0.32, sz, sz * 300 / 290, -145, -185, 290, 300); }
  stX.restore();
  stX.font = "36px 'Dela Gothic One'"; stX.fillStyle = '#d03050'; stX.textAlign = 'left'; stX.textBaseline = 'middle'; stX.fillText('SUB', -140, 160);
  stX.font = "900 26px 'Noto Sans TC'"; stX.fillStyle = '#334'; stX.textAlign = 'right'; stX.fillText('THANK YOU', 140, 162);
  stX.globalCompositeOperation = 'destination-out';
  for (let i = 0; i <= 17; i++) { const x = -170 + i * 20; stX.beginPath(); stX.arc(x, -210, 8, 0, 7); stX.fill(); stX.beginPath(); stX.arc(x, 210, 8, 0, 7); stX.fill(); }
  for (let i = 0; i <= 21; i++) { const y = -210 + i * 20; stX.beginPath(); stX.arc(-170, y, 8, 0, 7); stX.fill(); stX.beginPath(); stX.arc(170, y, 8, 0, 7); stX.fill(); }
  stX.restore();
  const s = k < 1 ? 2.4 - 1.4 * ei(k) : 1 + (land < 0.3 ? Math.exp(-land * 14) * Math.sin(land * 40) * 0.03 : 0);
  const ox = -out * 520;
  // 地址標籤（打字機）
  const lk = lin(t, 0.55, 0.75);
  if (lk > 0) {
    const f = "900 40px 'Noto Sans TC'", txt = 'TO：' + nameLine(), shown = Math.floor(lin(t, 0.75, 1.55) * Array.from(txt).length);
    const lw = textBox(ctx, [[txt, f]], 0, 0, 34);
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(cx + 150 + ox + (1 - eo5(lk)) * -120, cy + 60); ctx.rotate(0.02);
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6; ctx.fillStyle = '#ead4a6'; ctx.fillRect(0, -54, lw, 108); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(120,80,30,0.35)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.strokeRect(8, -46, lw - 16, 92); ctx.setLineDash([]);
    ctx.font = f; ctx.fillStyle = '#3a2a1a'; ctx.textBaseline = 'middle'; ctx.fillText(Array.from(txt).slice(0, shown).join(''), 34, 2);
    if (shown < Array.from(txt).length && Math.floor(t * 8) % 2) { ctx.fillRect(34 + ctx.measureText(Array.from(txt).slice(0, shown).join('')).width + 4, -20, 4, 44); }
    ctx.restore();
  }
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(cx + ox, cy); ctx.rotate(-0.08 - (1 - k) * 0.3); ctx.scale(s, s);
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8; ctx.drawImage(stC, -200, -240); ctx.shadowColor = 'transparent';
  const pm = lin(t, 0.5, 0.62);
  if (pm > 0) { ctx.save(); ctx.translate(182, -196); ctx.rotate(0.25); const ps = (1.4 - 0.4 * eo(pm)) * 0.8; ctx.scale(ps, ps);   // 郵戳蓋在右上角外緣，不壓到臉 ctx.globalAlpha = (1 - out) * Math.min(1, pm * 2) * 0.85;
    ctx.strokeStyle = '#c8102e'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(0, 0, 100, 0, 7); ctx.stroke(); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 78, 0, 7); ctx.stroke();
    ctx.fillStyle = '#c8102e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = "900 34px 'Noto Sans TC'"; ctx.fillText(CFG.title.replace(/!/g, ''), 0, 2);
    ctx.font = "700 17px 'Noto Sans TC'"; ctx.fillText('THANK YOU', 0, -46); const d = new Date(); ctx.fillText(`${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`, 0, 48);
    ctx.lineWidth = 4; for (let j = 0; j < 4; j++) { ctx.beginPath(); for (let x = 108; x < 320; x += 6) { const yy = -30 + j * 20 + Math.sin(x * 0.08) * 6; x === 108 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } ctx.stroke(); }
    ctx.restore(); }
  ctx.restore();
  if (land >= 0 && land < 0.35) { const q = land / 0.35; ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - q)})`; ctx.lineWidth = 10 * (1 - q); ctx.beginPath(); ctx.ellipse(cx, cy + 40, 200 + q * 220, 60 + q * 70, 0, 0, 7); ctx.stroke(); ctx.restore(); }
}

// ---------------- 訂閱 5：對話框 ----------------
function vSpeech(ctx, t) {
  const D = CFG.dur, gx = 1660, gh = 1500, rise = eback(lin(t, 0, 0.38), 1.6), out = ei(lin(t, D - 0.45, D - 0.05));
  const show = 440 * (rise - out * 1.15), gy = H + gh / 2 - show + Math.sin(t * 5) * 5;
  if (!GIRL) return;
  const tilt = Math.sin(t * 3) * 0.035 + (1 - lin(t, 0.3, 0.7)) * 0.12;
  ctx.save(); ctx.translate(gx, gy); ctx.rotate(tilt); ctx.translate(-gx, -gy);
  const sil = silhouette(GIRL_SIL, '#fff'); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; drawImg(ctx, sil, gx + Math.cos(a) * 7, gy + Math.sin(a) * 7, gh, 0); }
  drawImg(ctx, GIRL, gx, gy, gh, 0); ctx.restore();
  const [hx, hy] = headPos(gx, gy, gh);
  // 漫畫的驚喜線
  const ek = lin(t, 0.38, 0.5), eo2 = lin(t, 0.95, 1.2);
  if (ek > 0 && eo2 < 1) { ctx.save(); ctx.globalAlpha = 1 - eo2; ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) { const a = -2.0 + i * 0.35, r0 = 190, r1 = 190 + 60 * eo(ek); ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * r0, hy - 40 + Math.sin(a) * r0); ctx.lineTo(hx + Math.cos(a) * r1, hy - 40 + Math.sin(a) * r1); ctx.stroke(); } ctx.restore(); }
  const bk = lin(t, 0.38, 0.58), bo = lin(t, D - 0.62, D - 0.42);
  if (bk > 0 && bo < 1) {
    const txt = CFG.n ? LX('speechGift', P.name, CFG.n) : LX('speechSub', P.name), f = "900 52px 'Noto Sans TC'";
    const bw = Math.max(420, textBox(ctx, [[txt, f]], 0, 0, 50)), bh = 150, bxc = Math.min(hx - 260 - bw / 2, W - 60 - bw / 2), byc = hy - 230;
    const bs = eback(bk, 1.8) * (1 - ei(bo));
    ctx.save(); ctx.translate(hx - 170, hy - 140); ctx.scale(bs, bs); ctx.translate(-(hx - 170), -(hy - 140));
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = 8; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.ellipse(bxc, byc, bw / 2, bh / 2, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bxc + bw * 0.28, byc + bh * 0.3); ctx.lineTo(hx - 170, hy - 140); ctx.lineTo(bxc + bw * 0.38, byc + bh * 0.18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(bxc, byc, bw / 2 - 5, bh / 2 - 5, 0, 0, 7); ctx.fill();
    const chars = Array.from(txt), shown = Math.floor(lin(t, 0.58, 1.55) * chars.length);
    ctx.font = f; ctx.fillStyle = '#1a1a2a'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const full = ctx.measureText(txt).width; ctx.fillText(chars.slice(0, shown).join(''), bxc - full / 2, byc + 2);
    if (shown >= chars.length) { const hk = eback(lin(t, 1.6, 1.8), 2.4); if (hk > 0) { ctx.save(); ctx.translate(bxc + bw / 2 - 30, byc - bh / 2 + 10); ctx.scale(hk, hk); heartPath(ctx, 0, 0, 26); ctx.fillStyle = '#ff5a8c'; ctx.fill(); ctx.restore(); } }
    ctx.restore();
  }
}

// ---------------- 贈訂少量 2：禮盒開箱 ----------------
function giftBoxDraw(ctx, x, y, w, h, lx, ly, lr, la) {
  const d = w * 0.18;
  ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round';
  ctx.fillStyle = '#c23a6a'; ctx.beginPath(); ctx.moveTo(w / 2, -h); ctx.lineTo(w / 2 + d, -h - d * 0.7); ctx.lineTo(w / 2 + d, -d * 0.7); ctx.lineTo(w / 2, 0); ctx.fill();
  const fg = ctx.createLinearGradient(0, -h, 0, 0); fg.addColorStop(0, '#ff7aa8'); fg.addColorStop(1, '#e04a82'); ctx.fillStyle = fg; ctx.fillRect(-w / 2, -h, w, h);
  ctx.fillStyle = '#ffd24a'; ctx.fillRect(-w * 0.08, -h, w * 0.16, h); ctx.fillStyle = '#e8b020'; ctx.beginPath(); ctx.moveTo(w / 2, -h * 0.55); ctx.lineTo(w / 2 + d, -h * 0.55 - d * 0.7); ctx.lineTo(w / 2 + d, -h * 0.4 - d * 0.7); ctx.lineTo(w / 2, -h * 0.4); ctx.fill();
  ctx.strokeStyle = '#5a1030'; ctx.lineWidth = 4; ctx.strokeRect(-w / 2, -h, w, h);
  if (la > 0) {
    ctx.save(); ctx.globalAlpha = la; ctx.translate(lx, -h + ly); ctx.rotate(lr);
    const lh = h * 0.24;
    ctx.fillStyle = '#d24a7a'; ctx.beginPath(); ctx.moveTo(-w / 2 - 12, -lh); ctx.lineTo(-w / 2 - 12 + d, -lh - d * 0.7); ctx.lineTo(w / 2 + 12 + d, -lh - d * 0.7); ctx.lineTo(w / 2 + 12, -lh); ctx.fill();
    ctx.fillStyle = '#ff8ab4'; ctx.fillRect(-w / 2 - 12, -lh, w + 24, lh); ctx.fillStyle = '#ffd24a'; ctx.fillRect(-w * 0.08, -lh, w * 0.16, lh);
    ctx.strokeStyle = '#5a1030'; ctx.lineWidth = 4; ctx.strokeRect(-w / 2 - 12, -lh, w + 24, lh);
    ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = '#a87a00'; ctx.lineWidth = 3;
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sgn * 38, -lh - 30, 44, 26, sgn * 0.5, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(0, -lh - 18, 16, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}
let GIFT_BODY = null, GIFT_LID = null, GACHA_BODY = null, GACHA_HANDLE = null, CAP_TOP = null, CAP_BOT = null;
window.loadVarAssets = async function () {
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  GIFT_BODY = await L2('DEF_GIFT_BODY', 'gift_body.png'); GIFT_LID = await L2('DEF_GIFT_LID', 'gift_lid.png');
  GACHA_BODY = await L2('DEF_GACHA_BODY', 'gacha_body.png'); GACHA_HANDLE = await L2('DEF_GACHA_HANDLE', 'gacha_handle.png');
  CAP_TOP = await L2('DEF_CAP_TOP', 'cap_top.png'); CAP_BOT = await L2('DEF_CAP_BOT', 'cap_bot.png');
};
const GIFT_LID_DY = 0.36;
const GIFT_RIM = 0.432;   // 盒身前緣（開口下緣）在盒身圖上的高度比例，照圖量
function mixGift(a, b, k) { return a + (b - a) * k; }
const GACHA_GEO = { sx: 0.5, sy: 0.677, px: 0.5, hw: 0.36, chute: 0.88 };   // 機身圖上轉把插座中心、轉把軸心、轉把寬（機身寬比例）、出蛋口   // 蓋子蓋上時，蓋子底緣在盒身頂端往下多少（盒身高的比例）
function vGift(ctx, t) {
  if (!GIFT_BODY || !GIFT_LID) return;
  const D = CFG.dur, bx = 330, floor = 1018, OPEN = 1.05, pal = PAL[CFG.pal];
  const bw = 270, sc = bw / GIFT_BODY.width, bh = GIFT_BODY.height * sc, lw = GIFT_LID.width * sc, lh = GIFT_LID.height * sc;
  const k = lin(t, 0, 0.42), land = t - 0.42, out = ei(lin(t, D - 0.5, D - 0.05));
  const y = floor - (1 - ei(k)) * 1000 + out * 420, rot = (1 - k) * 0.22;
  let sx = 1, sy = 1; if (land >= 0 && land < 0.5) { const b = Math.exp(-land * 10) * Math.sin(land * 32); sy = 1 - b * 0.1; sx = 1 + b * 0.07; }
  const shk = (t > 0.5 && t < 0.66) || (t > 0.78 && t < 0.95), jx = shk ? Math.sin(t * 75) * 6 : 0, jr = shk ? Math.sin(t * 60) * 0.035 : 0, hop = shk ? Math.abs(Math.sin(t * 38)) * 16 : 0;
  ctx.save(); ctx.globalAlpha = 1 - out;
  ctx.fillStyle = `rgba(0,0,0,${0.3 * k})`; ctx.beginPath(); ctx.ellipse(bx, floor + 4, bw * 0.6 * (0.4 + 0.6 * k), 18, 0, 0, 7); ctx.fill();
  if (land > 0 && land < 0.6) { const q = land / 0.6; ctx.save(); ctx.filter = 'blur(8px)'; ctx.fillStyle = `rgba(255,255,255,${0.3 * (1 - q)})`;
    for (let i = 0; i < 10; i++) { const sd = i % 2 ? 1 : -1; ctx.beginPath(); ctx.arc(bx + sd * (bw * 0.45 + eo(q) * (60 + R(i, 1) * 90)), floor - 10 - eo(q) * R(i, 2) * 40, 18 + q * 34 * R(i, 3), 0, 7); ctx.fill(); } ctx.restore(); }
  // 光柱（開箱後）
  if (t >= OPEN) { const l = t - OPEN, a = Math.min(1, l * 5); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(14px)';
    const top = y - bh * 0.95, gr = ctx.createLinearGradient(0, top, 0, top - 640); gr.addColorStop(0, `rgba(255,236,170,${0.85 * a})`); gr.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(bx - bw * 0.42, top); ctx.lineTo(bx + bw * 0.42, top); ctx.lineTo(bx + bw * 0.95, top - 640); ctx.lineTo(bx - bw * 0.95, top - 640); ctx.fill();
    godRays(ctx, bx, top, 16, `rgba(255,240,190,${0.18 * a * (1 - lin(l, 0.6, 1.6))})`, l * 0.4, 700, 0.35, 12); ctx.restore(); }
  ctx.save(); ctx.translate(bx + jx, y); ctx.rotate(rot + jr); ctx.scale(sx, sy);
  ctx.drawImage(GIFT_BODY, -bw / 2, -bh, bw, bh);
  const lidY = -bh + bh * GIFT_LID_DY - lh;
  if (t < OPEN) {
    if (shk || (t > 0.95 && t < OPEN)) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(6px)'; ctx.fillStyle = `rgba(255,240,180,${0.5 + 0.5 * lin(t, 0.9, OPEN)})`; ctx.fillRect(-bw * 0.5, lidY + lh - 10 - hop, bw, 10 + hop); ctx.restore(); }
    ctx.drawImage(GIFT_LID, -lw / 2 + 4, lidY - hop, lw, lh);
  }
  ctx.restore();
  // 角色從盒子裡升起：畫在盒身之後（壓在盒內後壁上），再用前緣的高度裁掉下半，看起來才是「從盒子裡冒出來」而不是躲在盒子後面
  const rk = lin(t, OPEN + 0.05, OPEN + 0.45), rimY = y - bh + bh * GIFT_RIM;
  if (rk > 0) { ctx.save(); ctx.beginPath(); ctx.rect(bx - 400, rimY - 900, 800, 900 + 3); ctx.clip(); const s = eback(rk, 1.8);
    ctx.translate(bx, mixGift(y - bh * 0.3, rimY - 88, eo(rk))); ctx.scale(s, s); drawBust(ctx, 0, 0, 100, t); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(bx - bw / 2, rimY, bw, bh); ctx.clip(); ctx.translate(bx, y); ctx.drawImage(GIFT_BODY, -bw / 2, -bh, bw, bh); ctx.restore(); }   // 前壁再畫一次，蓋住頭像下緣
  if (t >= OPEN) { const l = t - OPEN, la = 1 - lin(l, 0.45, 0.75);
    for (let g2 = 3; g2 >= 0; g2--) { const ll = Math.max(0, l - g2 * 0.025); ctx.save(); ctx.globalAlpha = (1 - out) * la * (g2 ? 0.22 : 1);
      ctx.translate(bx + ll * 560, y - bh + bh * GIFT_LID_DY - lh / 2 - 1500 * ll + 2100 * ll * ll); ctx.rotate(ll * 7); ctx.drawImage(GIFT_LID, -lw / 2, -lh / 2, lw, lh); ctx.restore(); } }
  // 縫隙漏出的星點
  if (t > 0.5 && t < OPEN) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 7; i++) { const ph = (t * 3 + R(i, 1)) % 1; star4(ctx, bx - bw / 2 + R(i, 2) * bw, y - bh * 0.7 - ph * 90, 11 * (1 - ph), '#fff6c0', 1 - ph); } ctx.restore(); }
  // 開箱：彩紙、緞帶
  if (t >= OPEN && t < OPEN + 1.5) { const l = t - OPEN, top = y - bh * 0.7; ctx.save();
    for (let i = 0; i < 60; i++) { const a = -Math.PI / 2 + (R(i, 5) - 0.5) * 1.5, v = 650 + R(i, 6) * 750, px = bx + Math.cos(a) * v * l, py = top + Math.sin(a) * v * l + 1300 * l * l;
      ctx.save(); ctx.translate(px, py); ctx.rotate(l * 10 + i); ctx.scale(1, Math.cos(l * 14 + i)); ctx.fillStyle = ['#ffd24a', '#ff7aa8', '#7cc8ff', '#9dff8a', '#fff'][i % 5]; ctx.fillRect(-8, -4, 16, 8); ctx.restore(); }
    for (const sgn of [-1, 1]) { const gg = ctx.createLinearGradient(bx, top, bx + sgn * 300, top - 300); gg.addColorStop(0, '#fff2a0'); gg.addColorStop(1, '#e8a800');
      ctx.strokeStyle = gg; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath();
      for (let j2 = 0; j2 <= 24; j2++) { const u = j2 / 24, e = eo(Math.min(1, l * 2)), px = bx + sgn * (30 + u * 280 * e), py = top - u * 320 * e + Math.sin(u * 13 + l * 10) * 20 + l * l * 420; j2 ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
    ctx.restore(); }
  sparkBurst(ctx, bx, y - bh, t - OPEN, 14, 1.2, '#fff6c0');
  const tk = lin(t, OPEN + 0.2, OPEN + 0.4);
  if (tk > 0) { const s = tk < 1 ? 1.6 - 0.6 * eback(tk, 1.6) : 1; ctx.save(); ctx.translate(bx + 200, y - 270); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 80, pal, 'left', 760); ctx.restore(); }
  const nk = eo(lin(t, OPEN + 0.4, OPEN + 0.6));
  if (nk > 0) { ctx.save(); ctx.globalAlpha = (1 - out) * nk; ctx.font = "900 40px 'Noto Sans TC'"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0c0820'; ctx.lineWidth = 10; fitText(ctx, nameLine(), bx + 204 + (1 - nk) * 30, y - 190, 860, "900 40px 'Noto Sans TC'", '#fff', '#0c0820', 10, 'left'); ctx.restore(); }
  ctx.restore();
}

// ---------------- 贈訂少量 3：扭蛋機 ----------------
function capsuleImg(ctx, x, y, w, rot, top) {   // top = [dx, dy, 旋轉, 透明度]；原點在上下殼接縫
  if (!CAP_TOP || !CAP_BOT) return; const s = w / CAP_BOT.width, bw = CAP_BOT.width * s, bh = CAP_BOT.height * s, tw = CAP_TOP.width * s, th = CAP_TOP.height * s;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.drawImage(CAP_BOT, -bw / 2, -bh * 0.3, bw, bh);
  if (top[3] > 0) { ctx.save(); ctx.translate(top[0], top[1]); ctx.rotate(top[2]); ctx.globalAlpha *= top[3]; ctx.drawImage(CAP_TOP, -tw / 2, -th * 0.86, tw, th); ctx.restore(); }
  ctx.restore();
}
function vGacha(ctx, t) {
  if (!GACHA_BODY) return;
  const D = CFG.dur, mx = 270, base = 1052, pal = PAL[CFG.pal], app = eo5(lin(t, 0, 0.35)), out = ei(lin(t, D - 0.5, D - 0.05));
  const bodyH = 440, sc = bodyH / GACHA_BODY.height, bodyW = GACHA_BODY.width * sc;
  const ox = (1 - app) * -520 - out * 620;
  const CR0 = 0.45, CR1 = 1.1, crank = eo(lin(t, CR0, CR1)) * Math.PI * 2, cranking = t > CR0 && t < CR1 + 0.05;
  const jx = cranking ? Math.sin(t * 55) * 2.5 : 0, jr = cranking ? Math.sin(t * 43) * 0.006 : 0;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(ox, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(mx, base + 2, bodyW * 0.5, 16, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(mx + jx, base); ctx.rotate(jr); ctx.drawImage(GACHA_BODY, -bodyW / 2, -bodyH, bodyW, bodyH);
  if (GACHA_HANDLE) { const hw = GACHA_GEO.hw * bodyW, hh = GACHA_HANDLE.height * hw / GACHA_HANDLE.width;
    ctx.save(); ctx.translate((GACHA_GEO.sx - 0.5) * bodyW, -bodyH + GACHA_GEO.sy * bodyH); ctx.rotate(crank); ctx.drawImage(GACHA_HANDLE, -hw * GACHA_GEO.px, -hh * 0.5, hw, hh); ctx.restore(); }
  ctx.restore();
  // 膠囊從出貨口滾出來
  const DROP = 1.15, OPENC = 1.75, chuteX = mx, chuteY = base - bodyH + GACHA_GEO.chute * bodyH, capW = 96, floorY = base - 30;
  if (t >= DROP) {
    const l = t - DROP; let cx2, cy2, rot;
    const emerge = eo(lin(l, 0, 0.12));
    cx2 = chuteX + Math.min(l, 0.65) / 0.65 * 270 * eo(Math.min(1, l / 0.65));
    if (l < 0.12) cy2 = chuteY + 10; else { const b = l - 0.12; cy2 = floorY - Math.abs(Math.sin(b * 8.5 + 0.6)) * 80 * Math.exp(-b * 5.5); cy2 = Math.min(cy2, floorY); }
    rot = t < OPENC ? (cx2 - chuteX) / 48 : (270 / 48);
    let top = [0, 0, 0, 1];
    if (t >= OPENC) { const q = t - OPENC; top = [q * 160, -q * 640 + q * q * 950, -q * 7 - (270 / 48), 1 - lin(q, 0.5, 0.8)]; }
    const sz = capW * (0.5 + 0.5 * emerge);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(cx2, base - 8, sz * 0.45, 8, 0, 0, 7); ctx.fill();
    if (t >= OPENC) {
      const q = t - OPENC; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)';
      const gr = ctx.createRadialGradient(cx2, cy2 - 50, 0, cx2, cy2 - 50, 300); gr.addColorStop(0, `rgba(255,250,210,${0.9 * Math.max(0, 1 - q * 1.1)})`); gr.addColorStop(1, 'rgba(255,240,180,0)'); ctx.fillStyle = gr; ctx.fillRect(cx2 - 320, cy2 - 360, 640, 640);
      godRays(ctx, cx2, cy2 - 40, 14, `rgba(255,240,190,${0.22 * Math.max(0, 1 - q * 0.8)})`, q * 0.5, 500, 0.35, 10); ctx.restore();
      const s = eback(lin(t, OPENC, OPENC + 0.3), 2.2); ctx.save(); ctx.translate(cx2, cy2 - 150); ctx.scale(s, s); drawBust(ctx, 0, 0, 92, t); ctx.restore();
    }
    capsuleImg(ctx, cx2, cy2, sz, t < OPENC ? rot : 0, top);
    if (t >= OPENC) {
      const q = t - OPENC; sparkBurst(ctx, cx2, cy2 - 120, q, 14, 1.1, '#fff6c0');
      const tk = lin(t, OPENC + 0.15, OPENC + 0.35); if (tk > 0) { const ss = tk < 1 ? 1.6 - 0.6 * eback(tk, 1.6) : 1; ctx.save(); ctx.translate(cx2 + 120, cy2 - 205); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 76, pal); ctx.restore(); }
      const nk = eo(lin(t, OPENC + 0.35, OPENC + 0.55)); if (nk > 0) { ctx.save(); ctx.globalAlpha = (1 - out) * nk; ctx.font = "900 38px 'Noto Sans TC'"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0c0820'; ctx.lineWidth = 10; fitText(ctx, nameLine(), cx2 + 124, cy2 - 125, 1390 - (cx2 + 124), "900 38px 'Noto Sans TC'", '#fff', '#0c0820', 10, 'left'); ctx.restore(); }
    }
  }
  ctx.restore();
}

// ---------------- 贈訂少量 4：紙飛機 ----------------
function bez(P0, P1, P2, P3, u) { const v = 1 - u; return [v * v * v * P0[0] + 3 * v * v * u * P1[0] + 3 * v * u * u * P2[0] + u * u * u * P3[0], v * v * v * P0[1] + 3 * v * v * u * P1[1] + 3 * v * u * u * P2[1] + u * u * u * P3[1]]; }
function planeDraw(ctx, x, y, ang, s, roll) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s * (0.7 + 0.3 * Math.cos(roll)));
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#4a5a7a'; ctx.lineWidth = 2.5;
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(46, 0); ctx.lineTo(-34, -26); ctx.lineTo(-20, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#dfe8f6'; ctx.beginPath(); ctx.moveTo(46, 0); ctx.lineTo(-34, 24); ctx.lineTo(-20, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c4d2ea'; ctx.beginPath(); ctx.moveTo(46, 0); ctx.lineTo(-20, 0); ctx.lineTo(-30, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function vPlane(ctx, t) {
  const D = CFG.dur, P0 = [-200, 980], P1 = [760, 560], P2 = [980, 1040], P3 = [430, 820], FLY = 1.1, UNF = 1.45, FOLD = D - 0.85, pal = PAL[CFG.pal];
  const lx = 430, ly = 830, w = 560, h = 270;
  if (t < UNF) {
    const u = eo(lin(t, 0, FLY)), [x, y] = bez(P0, P1, P2, P3, u), [x2, y2] = bez(P0, P1, P2, P3, Math.min(1, u + 0.01));
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 4; ctx.setLineDash([14, 12]); ctx.beginPath();
    for (let j = 0; j <= 30; j++) { const uu = Math.max(0, u - 0.35 + j / 30 * 0.35); const [px, py] = bez(P0, P1, P2, P3, uu); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.globalAlpha = 1 - lin(t, FLY, UNF); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    const shrink = 1 - lin(t, FLY, FLY + 0.2);
    if (shrink > 0) planeDraw(ctx, x, y, Math.atan2(y2 - y, x2 - x), 1.7 * shrink, t * 6);
  }
  if (t >= FLY + 0.1) {
    const a = lin(t, FLY + 0.1, FLY + 0.3), b = lin(t, FLY + 0.25, UNF + 0.1), fa = lin(t, FOLD, FOLD + 0.25), fb = lin(t, FOLD + 0.15, FOLD + 0.4);
    const sx = eo(a) * (1 - ei(fb)), sy = (0.06 + 0.94 * eback(b, 1.4)) * (1 - ei(fa) * 0.94);
    if (sx > 0.01) {
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(-0.04); ctx.scale(sx, sy);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 10; ctx.fillStyle = '#fffdf7'; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2); ctx.stroke();
      ctx.strokeStyle = '#7cc8ff'; ctx.lineWidth = 6; ctx.strokeRect(-w / 2 + 14, -h / 2 + 14, w - 28, h - 28);
      const tw = lin(t, UNF + 0.05, UNF + 0.5);
      if (tw > 0) { ctx.save(); ctx.font = `700 72px ${HAND}`; ctx.textBaseline = 'middle'; const W2 = ctx.measureText(CFG.title).width; ctx.beginPath(); ctx.rect(-w / 2 + 40, -h / 2, W2 * tw + 10, h); ctx.clip(); ctx.fillStyle = '#2a4a8a'; ctx.fillText(CFG.title, -w / 2 + 44, -38); ctx.restore(); }
      const nw = lin(t, UNF + 0.4, UNF + 0.8);
      if (nw > 0) { ctx.save(); ctx.font = `700 38px ${HAND}`; ctx.textBaseline = 'middle'; { const _w = ctx.measureText(nameLine()).width, _av = w - 92; if (_w > _av) ctx.font = `700 ${Math.floor(38 * _av / _w)}px ${HAND}`; } const W2 = ctx.measureText(nameLine()).width; ctx.beginPath(); ctx.rect(-w / 2 + 40, 0, W2 * nw + 10, h); ctx.clip(); ctx.fillStyle = '#d04a6a'; ctx.fillText(nameLine(), -w / 2 + 44, 50); ctx.restore(); }
      const bk = lin(t, UNF + 0.15, UNF + 0.4); if (bk > 0) { ctx.save(); ctx.translate(w / 2 - 70, -h / 2 + 50); ctx.rotate(0.15 + Math.sin(t * 4) * 0.05); const s = eback(bk, 2.2); ctx.scale(s, s); drawBust(ctx, 0, 0, 66, t); ctx.restore(); }
      ctx.restore();
    }
  }
  if (t >= FOLD + 0.35) { const l = lin(t, FOLD + 0.35, D - 0.02), x = lx + eo(l) * 1700, y = ly - eo(l) * 900 + Math.sin(l * 6) * 40; planeDraw(ctx, x, y, -0.5, 1.7, t * 6); }
}

// ---------------- 贈訂少量 5：霓虹招牌 ----------------
function neonStroke(ctx, draw, col, on, t, id) {
  const hum = on ? 0.88 + 0.12 * Math.sin(t * 47 + id * 3) : 0;
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 8; draw('stroke');
  if (on) { ctx.globalAlpha = hum; ctx.shadowColor = col; ctx.shadowBlur = 34; ctx.strokeStyle = col; ctx.lineWidth = 8; draw('stroke'); ctx.shadowBlur = 12; draw('stroke');
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5; draw('stroke'); }
  ctx.restore();
}
function neonText(ctx, text, x, y, col, on, t, id) {
  ctx.save();
  if (!on) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillText(text, x, y); ctx.restore(); return; }
  ctx.globalAlpha = 0.9 + 0.1 * Math.sin(t * 47 + id * 3);
  ctx.shadowColor = col; ctx.shadowBlur = 22; ctx.fillStyle = col; ctx.globalAlpha *= 0.55; ctx.fillText(text, x, y);
  ctx.globalAlpha = 0.95; ctx.shadowBlur = 6; ctx.fillStyle = col; ctx.fillText(text, x, y);
  ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.fillText(text, x + 0.5, y - 0.5);
  ctx.restore();
}
function neonOn(t, t0, id, offAt) { if (t >= offAt) return R(Math.floor(t * 30), id + 50) > 0.5 && t < offAt + 0.25; if (t < t0 - 0.28) return false; if (t < t0) return R(Math.floor(t * 30), id) > 0.55; return true; }
function vNeon(ctx, t) {
  const fT = "500 74px 'Noto Sans TC'", fN = "500 64px 'Noto Sans TC'", fM = `400 44px ${HAND}`;
  ctx.letterSpacing = '10px'; ctx.font = fT; const tW0 = ctx.measureText(CFG.title).width; ctx.font = fN; const nW0 = ctx.measureText('×' + (CFG.n || 1)).width; ctx.letterSpacing = '5px'; ctx.font = fM; const mW0 = ctx.measureText(nameLine()).width; ctx.letterSpacing = '0px';
  const w = Math.max(640, 245 + Math.max(tW0 + 24 + nW0, mW0) + 50), h = 290, cx = 60 + w / 2, cy = 850;
  const D = CFG.dur, OFF = D - 0.45, app = eo5(lin(t, 0, 0.22)), fade = 1 - lin(t, D - 0.2, D - 0.02);
  ctx.save(); ctx.globalAlpha = app * fade; ctx.translate(cx, cy);
  const bg = ctx.createLinearGradient(0, -h / 2, 0, h / 2); bg.addColorStop(0, 'rgba(18,12,34,0.92)'); bg.addColorStop(1, 'rgba(8,6,18,0.92)');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 26); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; for (let i = -h / 2 + 24; i < h / 2; i += 24) { ctx.beginPath(); ctx.moveTo(-w / 2 + 10, i); ctx.lineTo(w / 2 - 10, i); ctx.stroke(); }
  ctx.fillStyle = '#555'; for (const [sx, sy] of [[-w / 2 + 18, -h / 2 + 18], [w / 2 - 18, -h / 2 + 18], [-w / 2 + 18, h / 2 - 18], [w / 2 - 18, h / 2 - 18]]) { ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 7); ctx.fill(); }
  const frameOn = neonOn(t, 0.3, 1, OFF), titleOn = neonOn(t, 0.55, 2, OFF), numOn = neonOn(t, 0.8, 3, OFF), nameOn = neonOn(t, 1.0, 4, OFF);
  // 頭像（燈亮才看得清楚）
  ctx.save(); ctx.globalAlpha = app * fade * (frameOn ? 1 : 0.25); drawBust(ctx, -w / 2 + 120, 0, 82, t); ctx.restore();
  neonStroke(ctx, (m) => { ctx.beginPath(); ctx.arc(-w / 2 + 120, 0, 96, 0, 7); ctx[m](); }, '#7cc8ff', frameOn, t, 1);
  ctx.textBaseline = 'middle'; const tx = -w / 2 + 245;
  ctx.letterSpacing = '10px'; ctx.font = fT; neonText(ctx, CFG.title, tx, -50, '#ff4ac0', titleOn, t, 2);
  const tW = ctx.measureText(CFG.title).width;
  ctx.font = fN; neonText(ctx, '×' + (CFG.n || 1), tx + tW + 24, -46, '#ffd400', numOn, t, 3);
  ctx.letterSpacing = '5px'; ctx.font = fM; neonText(ctx, nameLine(), tx, 54, '#5cff8a', nameOn, t, 4); ctx.letterSpacing = '0px';
  // 繞框跑的火花
  const sp = lin(t, 1.2, 1.7); if (sp > 0 && sp < 1) { const a = sp * Math.PI * 2 - Math.PI / 2; ctx.save(); ctx.globalCompositeOperation = 'lighter'; star4(ctx, -w / 2 + 120 + Math.cos(a) * 96, Math.sin(a) * 96, 26, '#fff', 1); ctx.restore(); }
  ctx.restore();
}

// ======================= 變體表＋份數自訂 =======================
const VARS = {
  sub: [{ name: '滑入卡片' }, { name: '和紙便條', fn: vMemo, dur: 3.4 }, { name: '泡泡', fn: vBubble, dur: 3.4 }, { name: '郵票蓋章', fn: vStamp, dur: 3.3 }, { name: '對話框', fn: vSpeech, dur: 3.6 }],
  g1: [{ name: '卡片禮物' }, { name: '禮盒開箱', fn: vGift, dur: 3.8 }, { name: '扭蛋機', fn: vGacha, dur: 4.0 }, { name: '紙飛機', fn: vPlane, dur: 4.0 }, { name: '霓虹招牌', fn: vNeon, dur: 3.6 }],
  g5: [{ name: '斜橫帶' }], g10: [{ name: 'PUSH 按鈕' }], g25: [{ name: '金扉' }], g50: [{ name: '拉霸 777' }], g100: [{ name: '神降臨' }],
};
window.VARS = VARS;
const TITLE_T = { g5: '贈訂 ×{n}!', g10: '贈訂 ×{n}!!' };
window.TIER_MIN = { g1: 1, g5: 5, g10: 10, g25: 25, g50: 50, g100: 100 };
window.tierFor = function (n, mins = window.TIER_MIN) { let best = 'g1', bm = -1; for (const [k, m] of Object.entries(mins)) if (n >= m && m > bm) { best = k; bm = m; } return best; };
const _setTierBase = window.setTier;
window.setTier = function (id, v) {
  const d = _setTierBase(id); CFG.id = id;
  if (P.n && id !== 'sub') { CFG.n = Math.max(1, Math.round(Number(P.n))); }
  if (TITLE_T[id]) CFG.title = TITLE_T[id].replace('{n}', CFG.n);
  if (CFG.n) { CFG.sub1 = `${P.name} 送出了`; CFG.sub2 = `${CFG.n} 份訂閱`; }
  v = Number(v ?? P.v ?? 0) || 0; CFG.v = v;
  const V = (VARS[id] || [])[v];
  if (V && V.fn) { CFG.kind = 'var'; CFG.varFn = V.fn; CFG.dur = V.dur; window.DUR = V.dur; }
  return window.DUR;
};
window.setName = (n) => { P.name = n; setTier(CFG.id, CFG.v); };
window.setCount = (n) => { P.n = n; setTier(CFG.id, CFG.v); };
HI.var = (ctx, t) => CFG.varFn(ctx, t);
