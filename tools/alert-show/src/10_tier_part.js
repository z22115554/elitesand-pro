
// ======================= 分級設定 =======================
const PAL = {
  sky:   { bg: ['#ffffff', '#d8f4ff', '#7cc8ff', '#2a6ad0', '#0a1a50'], fill: ['#ffffff', '#eafaff', '#a8e0ff', '#5aa8ff'], glow: 'rgba(150,220,255,0.9)', edge: ['#ffffff', '#8fd8ff'] },
  blue:  { bg: ['#f0fbff', '#7fd8ff', '#1f7ae0', '#0a2a8a', '#020a30'], fill: ['#ffffff', '#bdf0ff', '#3fb8ff', '#1a5cff'], glow: 'rgba(80,200,255,0.9)', edge: ['#bff4ff', '#2a8cff'] },
  green: { bg: ['#f4fff0', '#a8ff7a', '#18c25a', '#0a6a3a', '#021f12'], fill: ['#ffffff', '#e0ffb8', '#5cff70', '#00b35a'], glow: 'rgba(120,255,140,0.9)', edge: ['#eaffc0', '#22d36a'] },
  red:   { bg: ['#fff4ec', '#ffb04a', '#ff3030', '#a0001e', '#2a0008'], fill: ['#ffffff', '#ffd8a8', '#ff5a40', '#d0002a'], glow: 'rgba(255,90,60,0.9)', edge: ['#ffd8a0', '#ff2a3a'] },
  gold:  { bg: ['#fffde8', '#ffe46a', '#ffb000', '#a05a00', '#2a1400'], fill: ['#ffffff', '#fff2a0', '#ffc21a', '#d07800'], glow: 'rgba(255,210,80,0.95)', edge: ['#fff6c0', '#ffb21a'] },
  rainbow: { rainbow: true, glow: 'rgba(255,200,60,0.9)', edge: ['#fff6c0', '#ff5aa5'] },
  premium: { rainbow: true, glow: 'rgba(255,230,120,1)', edge: ['#fff6c0', '#ffb21a'] },
};
function palFill(ctx, y0, y1, t, pal) {
  if (pal.rainbow) return rainbowFill(ctx, y0, y1, t);
  const gr = ctx.createLinearGradient(0, y0, 0, y1); pal.fill.forEach((c, i) => gr.addColorStop(i / (pal.fill.length - 1), c)); return gr;
}
function palBG(ctx, t, pal, cx = 730, cy = 420) {
  if (pal.rainbow) return rainbowBG(ctx, t * 2.2);
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1500);
  [0, 0.12, 0.38, 0.7, 1].forEach((p, i) => bg.addColorStop(p, pal.bg[i]));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.filter = 'blur(16px)'; const n = 32, rot = t * 0.5;
  for (let i = 0; i < n; i += 2) { ctx.fillStyle = 'rgba(255,255,255,0.16)'; const a0 = rot + i / n * Math.PI * 2, a1 = a0 + Math.PI / n;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * 2600, cy + Math.sin(a0) * 2600); ctx.lineTo(cx + Math.cos(a1) * 2600, cy + Math.sin(a1) * 2600); ctx.fill(); }
  ctx.restore();
  speedLines(ctx, cx, cy, 90, 500, 'rgba(255,255,255,0.5)', Math.floor(t * 30), 0, 0.7);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 36; i++) { const ph = (t * (1.2 + R(i, 1)) + R(i, 2)) % 1; const s = Math.sin(ph * Math.PI);
    star4(ctx, R(i, 3) * W, R(i, 4) * H, 10 + s * (14 + R(i, 5) * 30), '#fff', s * 0.85); }
  ctx.restore();
}

const BASE = { power: 1, coins: 90, led: false, echo: false, mascot: false, slash: false, flip: false, ticker: '', extra: null, teaserHue: false };
const TIERS = {
  sub:  { label: '訂閱', kind: 'card', dur: 3.2, pal: 'sky', title: '感謝訂閱!', n: 0 },
  g1:   { label: '贈訂 ×1', kind: 'card', dur: 3.6, pal: 'blue', title: '贈送訂閱!', n: 1 },
  g5:   { label: '贈訂 ×5', kind: 'panel', dur: 4.0, pal: 'green', title: '贈訂 ×5!', n: 5, coins: 34, power: 0.4 },
  g10:  { label: '贈訂 ×10', kind: 'full', pal: 'red', title: '贈訂 ×10!!', n: 10, coins: 50, power: 0.6, ticker: 'CHANCE ★',
          segs: [['black', 1.08, 1.3], ['burst', 1.3, 1.62], ['main', 3.84, 6.0], ['exit', 6.05, 6.8]] },
  g25:  { label: '贈訂 ×25', kind: 'full', pal: 'gold', title: '大量贈訂!!', n: 25, coins: 70, power: 0.85, led: true, echo: true, mascot: true, slash: true, flip: true, ticker: 'BIG CHANCE ★',
          segs: [['black', 0.95, 1.3], ['burst', 1.3, 1.62], ['montage', 1.62, 2.12], ['ink', 3.55, 3.84], ['main', 3.84, 6.3], ['exit', 6.05, 6.8]] },
  g50:  { label: '贈訂 ×50', kind: 'full', pal: 'rainbow', title: '大物降臨!!', n: 50, led: true, echo: true, mascot: true, slash: true, flip: true, ticker: 'BIG CHANCE ★',
          segs: [['teaser', 0, 0.66], ['black', 0.66, 1.3], ['burst', 1.3, 1.62], ['montage', 1.62, 2.88], ['laser', 2.88, 3.55], ['ink', 3.55, 3.84], ['main', 3.84, 6.05], ['exit', 6.05, 6.8]] },
  g100: { label: '贈訂 ×100', kind: 'full', pal: 'premium', title: '神降臨!!', n: 100, coins: 160, power: 1.15, led: true, echo: true, mascot: true, slash: true, flip: true, teaserHue: true,
          ticker: 'PREMIUM ★ 神降臨 ★', extra: premiumExtra,
          segs: [['teaser', 0, 0.66], ['black', 0.66, 1.3], ['burst', 1.3, 1.62], ['montage', 1.62, 2.88], ['laser', 2.88, 3.55], ['ink', 3.55, 3.84], ['main', 3.84, 7.1], ['exit', 6.05, 6.8]] },
};
let CFG = Object.assign({}, BASE, TIERS.g50);
window.TIERS = TIERS;
window.setTier = function (id) {
  CFG = Object.assign({}, BASE, TIERS[id]); CFG.id = id;
  CFG.sub1 = CFG.n ? `${P.name} 送出了` : `${P.name}`;
  CFG.sub2 = CFG.n ? `${CFG.n} 份訂閱` : '訂閱了!';
  if (CFG.kind === 'full') {
    CFG.dur = CFG.segs.reduce((a, s) => a + s[2] - s[1], 0);
    const m = CFG.segs.find((s) => s[0] === 'main'); XS = m[2] - 6.05; buildImpacts(m[2]);
  } else { buildImpacts(6.0); }
  window.DUR = CFG.dur; return CFG.dur;
};
window.setName = (n) => { P.name = n; setTier(CFG.id); };

// ======================= 贈訂 ×100 專屬 =======================
function premiumExtra(ctx, t, pk) {
  const k = lin(t, 4.62, 4.8);
  if (k > 0) {
    const s = k < 1 ? 3 - 2 * eback(k, 1.6) : 1 + pk * 0.1;
    ctx.save(); ctx.translate(300, 240); ctx.rotate(-0.2 + Math.sin(t * 4) * 0.05); ctx.scale(s, s);
    ctx.save(); ctx.rotate(t * 1.5); ctx.beginPath();
    for (let i = 0; i < 48; i++) { const r = i % 2 ? 128 : 160, a = i / 48 * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    const gg = ctx.createRadialGradient(0, 0, 20, 0, 0, 160); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.7, '#ffb21a'); gg.addColorStop(1, '#c76a00');
    ctx.fillStyle = gg; ctx.shadowColor = 'rgba(255,220,100,1)'; ctx.shadowBlur = 40; ctx.fill(); ctx.restore();
    ctx.fillStyle = '#c4002a'; ctx.beginPath(); ctx.arc(0, 0, 112, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff2a0'; ctx.lineWidth = 8; ctx.stroke();
    ctx.font = "92px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const ns = String(CFG.n); if (ns.length > 3) ctx.font = `${Math.round(92 * 3 / ns.length)}px 'Dela Gothic One'`; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 14; ctx.strokeText(ns, 0, 6);
    ctx.fillStyle = rainbowFill(ctx, -40, 50, t); ctx.fillText(ns, 0, 6);
    ctx.restore();
  }
  // 煙火
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [ft, fx, fy, hue] of [[4.95, 430, 230, 50], [5.35, 1250, 180, 300], [5.8, 880, 130, 180], [6.25, 330, 330, 10], [6.6, 1450, 260, 120], [6.85, 700, 200, 260]]) {
    const lt = t - ft; if (lt < 0 || lt > 1) continue; const p = lt;
    for (let i = 0; i < 56; i++) { const a = i / 56 * Math.PI * 2 + R(i, ft); const r = eo(p) * (230 + R(i, 7) * 80);
      const x = fx + Math.cos(a) * r, y = fy + Math.sin(a) * r + 160 * p * p;
      ctx.strokeStyle = `hsla(${(hue + i * 4) % 360},100%,${70 + 20 * (1 - p)}%,${1 - p})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * 30 * (1 - p), y - Math.sin(a) * 30 * (1 - p)); ctx.stroke(); }
    star4(ctx, fx, fy, 120 * (1 - p), '#fff', 1 - p);
  }
  ctx.restore();
}

// ======================= 訂閱／贈訂 ×1：左下角卡片 =======================
function drawBust(ctx, cx, cy, r, t) {
  const pal = PAL[CFG.pal];
  const bg = ctx.createRadialGradient(cx, cy - r * 0.3, 0, cx, cy, r); bg.addColorStop(0, pal.bg[1]); bg.addColorStop(1, pal.bg[3]);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = bg; ctx.fill(); ctx.clip();
  speedLines(ctx, cx, cy, 30, r * 0.5, 'rgba(255,255,255,0.35)', Math.floor(t * 20), t * 0.5);
  if (GIRL) { const fx = FACE.x * GIRL.width, fy = FACE.y * GIRL.height, sz = FACE.s * GIRL.height * 1.9;
    ctx.drawImage(GIRL, fx - sz / 2, fy - sz * 0.42, sz, sz, cx - r, cy - r, r * 2, r * 2); }
  ctx.restore();
  ctx.save(); ctx.lineWidth = 10; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
  ctx.lineWidth = 5; ctx.strokeStyle = pal.edge[1]; ctx.beginPath(); ctx.arc(cx, cy, r + 7, 0, 7); ctx.stroke(); ctx.restore();
}
function giftBox(ctx, x, y, s, col) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = col; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.rect(-36, -10, 72, 50); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.rect(-42, -26, 84, 18); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffe14a'; ctx.fillRect(-7, -26, 14, 66); ctx.strokeRect(-7, -26, 14, 66);
  ctx.beginPath(); ctx.ellipse(-16, -34, 16, 10, -0.5, 0, 7); ctx.ellipse(16, -34, 16, 10, 0.5, 0, 7); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function sceneCard(ctx, t) {
  const big = CFG.n > 0, D = CFG.dur, pal = PAL[CFG.pal];
  const inK = lin(t, 0, 0.42), outK = ei(lin(t, D - 0.45, D - 0.05));
  const sc = big ? 1.15 : 1;
  const x0 = 60 + (1 - eback(inK, 1.2)) * -1100 - outK * 1100, y0 = 860;
  ctx.save(); ctx.translate(x0, y0); ctx.scale(sc, sc);
  // 卡片本體
  const path = () => { ctx.beginPath(); ctx.moveTo(40, -92); ctx.lineTo(900, -92); ctx.lineTo(866, 92); ctx.lineTo(6, 92); ctx.closePath(); };
  ctx.save(); ctx.shadowColor = pal.glow; ctx.shadowBlur = 30; path();
  const bd = ctx.createLinearGradient(0, -92, 0, 92); bd.addColorStop(0, '#22184a'); bd.addColorStop(1, '#0c0820'); ctx.fillStyle = bd; ctx.fill(); ctx.restore();
  ctx.save(); path(); ctx.clip();
  if (big) { ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) { const yy = -92 + R(i, 1) * 184, len = 120 + R(i, 2) * 300, x = ((R(i, 3) * 1400 - t * (900 + R(i, 4) * 900)) % 1400 + 1400) % 1400 - 200;
      ctx.fillStyle = `rgba(150,220,255,${0.12 + R(i, 5) * 0.2})`; ctx.fillRect(x, yy, len, 2 + R(i, 6) * 3); }
    ctx.globalCompositeOperation = 'source-over'; }
  const sw = lin(t, 0.45, 0.95);
  if (sw > 0 && sw < 1) { const gx = -200 + sw * 1300; const gr = ctx.createLinearGradient(gx - 140, 0, gx + 140, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(-100, -100, 1100, 200); }
  ctx.restore();
  // 邊框
  ctx.save(); path(); const eg = ctx.createLinearGradient(0, 0, 900, 0); eg.addColorStop(0, pal.edge[0]); eg.addColorStop(1, pal.edge[1]);
  ctx.strokeStyle = eg; ctx.lineWidth = 6; ctx.stroke(); ctx.restore();
  // 頭像（彈出）
  const bk = lin(t, 0.18, 0.46); if (bk > 0) { ctx.save(); ctx.translate(140, -40); const bs = eback(bk, 2.2); ctx.scale(bs, bs); drawBust(ctx, 0, 0, 118, t); ctx.restore(); }
  // 標題
  const tk = lin(t, 0.28, 0.5);
  if (tk > 0) { ctx.save(); ctx.translate(290, -18); const ts = tk < 1 ? 1.6 - 0.6 * eback(tk, 1.6) : 1; ctx.scale(ts, ts);
    ctx.font = /[閱]/.test(CFG.title) ? "900 84px 'Noto Sans TC'" : "84px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; { const _w = ctx.measureText(CFG.title).width; if (_w > 540) ctx.scale(540 / _w, 540 / _w); }
    ctx.strokeStyle = '#0c0820'; ctx.lineWidth = 22; ctx.strokeText(CFG.title, 0, 0);
    ctx.strokeStyle = pal.edge[1]; ctx.lineWidth = 12; ctx.strokeText(CFG.title, 0, 0);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeText(CFG.title, 0, 0);
    ctx.fillStyle = palFill(ctx, -40, 40, t, pal); ctx.fillText(CFG.title, 0, 0); ctx.restore(); }
  // 名字
  const nk = eo(lin(t, 0.45, 0.65));
  if (nk > 0) { ctx.save(); ctx.globalAlpha = nk; ctx.translate(292 + (1 - nk) * 40, 52);
    ctx.font = "900 40px 'Noto Sans TC'"; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    fitText(ctx, nameLine(), 0, 0, 545, "900 40px 'Noto Sans TC'", '#fff', null, 0, 'left'); ctx.restore(); }
  // 贈禮徽章
  if (big) { const gk = lin(t, 0.5, 0.75); if (gk > 0) { const s = eback(gk, 2.4) * (1 + Math.sin(t * 12) * 0.04); giftBox(ctx, 840, -98, s, '#ff5a8c');
    ctx.save(); ctx.translate(840, -98); ctx.scale(s, s); ctx.font = "44px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 10; ctx.strokeText('×' + CFG.n, 62, 30); ctx.fillStyle = '#ffe14a'; ctx.fillText('×' + CFG.n, 62, 30); ctx.restore(); } }
  ctx.restore();
  // 星芒
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const n = big ? 14 : 8;
  for (let i = 0; i < n; i++) { const p = lin(t, 0.3 + R(i, 1) * 0.3, 0.8 + R(i, 1) * 0.3); if (p <= 0 || p >= 1) continue;
    const a = R(i, 2) * Math.PI * 2, d = 80 + eo(p) * (120 + R(i, 3) * 140);
    star4(ctx, x0 + 140 * sc + Math.cos(a) * d, y0 - 40 * sc + Math.sin(a) * d, (16 + R(i, 4) * 22) * Math.sin(p * Math.PI), i % 2 ? '#fff' : '#bff0ff', 1); }
  ctx.restore();
}

// ======================= 贈訂 ×5：中央橫帶 =======================
function scenePanel(ctx, t) {
  const D = CFG.dur, pal = PAL[CFG.pal];
  const open = eo5(lin(t, 0.04, 0.3)), close = ei(lin(t, D - 0.42, D - 0.1)), vis = open * (1 - close);
  if (vis <= 0) return;
  const hh = 270 * vis, sl = 46;
  const f = Math.floor(t * 60), pk = Math.exp(-Math.max(0, t - 0.42) * 12) * (t >= 0.42 ? 1 : 0);
  ctx.save(); ctx.translate((R(f, 1) - 0.5) * pk * 16, (R(f, 2) - 0.5) * pk * 16);
  ctx.fillStyle = `rgba(0,0,0,${0.35 * vis})`; ctx.fillRect(-20, -20, W + 40, H + 40);
  const band = () => { ctx.beginPath(); ctx.moveTo(-20, CY - hh + sl); ctx.lineTo(W + 20, CY - hh - sl); ctx.lineTo(W + 20, CY + hh - sl); ctx.lineTo(-20, CY + hh + sl); ctx.closePath(); };
  ctx.save(); band(); ctx.clip(); palBG(ctx, t + 4, pal, 720, CY); coins(ctx, t - 0.42 + T_HIT); ctx.restore();
  // 上邊線（畫在人物下層，人物探出時不會被切過）
  ctx.save(); ctx.lineWidth = 8; ctx.strokeStyle = pal.edge[0]; ctx.shadowColor = pal.glow; ctx.shadowBlur = 24;
  ctx.beginPath(); ctx.moveTo(-20, CY - hh + sl); ctx.lineTo(W + 20, CY - hh - sl); ctx.stroke(); ctx.restore();
  // 角色：從帶子上緣探出，下緣切齊
  const gk = lin(t, 0.36, 0.62);
  if (gk > 0) { ctx.save(); ctx.beginPath(); ctx.moveTo(-20, -20); ctx.lineTo(W + 20, -20); ctx.lineTo(W + 20, CY + hh - sl); ctx.lineTo(-20, CY + hh + sl); ctx.closePath(); ctx.clip();
    const gx = 1490 + (1 - eo5(gk)) * 800, gy = 900, gh = 1600 + Math.sin(t * 3) * 10;
    ctx.globalAlpha = 1 - close; neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, 0.03); drawImg(ctx, GIRL, gx, gy, gh, 0.03, 1 - close); ctx.restore(); }
  // 下邊線（畫在人物上層，當作人物的下緣切線）
  ctx.save(); ctx.lineWidth = 8; ctx.strokeStyle = pal.edge[0]; ctx.shadowColor = pal.glow; ctx.shadowBlur = 24;
  ctx.beginPath(); ctx.moveTo(-20, CY + hh + sl); ctx.lineTo(W + 20, CY + hh - sl); ctx.stroke(); ctx.restore();
  // 大字
  const tk = lin(t, 0.26, 0.44);
  if (tk > 0) { const s = tk < 1 ? 2.4 - 1.4 * eback(tk, 1.4) : 1 + pk * 0.06; ctx.save(); ctx.globalAlpha = 1 - close; titleText(ctx, t + 3.6, 690, CY - 60, s * 1.05, -0.05); ctx.restore(); }
  subLine(ctx, t, eo(lin(t, 0.55, 0.75)) * (1 - close), 700, CY + 150, 1.05);
  ctx.restore();
  if (t < 0.16) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,255,${1 - t / 0.16})`; ctx.fillRect(0, CY - 6 - 30 * t / 0.16, W, 12 + 60 * t / 0.16); ctx.restore(); }
  if (t >= 0.42) flash(ctx, (1 - lin(t, 0.42, 0.52)) * 0.3, '#eaffc0');
}

