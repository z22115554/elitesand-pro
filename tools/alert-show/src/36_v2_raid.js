
// ======================= V2 揪團（Raid）：四級，從角落小卡到全畫面 =======================
// 主題：別台的船隊開進港。r1 角落明信片／r2 下方海面橫帶／r3 全畫面「警報→雷達→大浪」／r4 全畫面最華麗「望遠鏡→漫畫分格→海嘯」
// 人數門檻可自訂（RAID_MIN）；顯示的人數＝實際人數（P.n）。
const RAID = {
  r1: { label: '揪團 小', title: '揪團來了!', n: 5, pal: 'sky', dur: 4.4, power: 0.4 },
  r2: { label: '揪團 中', title: '揪團來襲!', n: 24, pal: 'blue', dur: 5.6, power: 0.6 },
  r3: { label: '揪團 大', title: '揪團來襲!!', n: 120, pal: 'blue', dur: 7.2, power: 0.9, hi: true },
  r4: { label: '揪團 特大', title: '大揪團來襲!!', n: 500, pal: 'rainbow', dur: 9.6, power: 1.15, hi: true, tick: true, ticker: 'RAID ★ 大艦隊來襲 ★' },
};
for (const [id, r] of Object.entries(RAID)) TIERS[id] = Object.assign({ kind: 'card', coins: 90 }, r);
window.RAID = RAID; window.RAID_MIN = { r1: 1, r2: 10, r3: 50, r4: 200 };
window.raidFor = function (n, mins = window.RAID_MIN) { let best = 'r1', bm = -1; for (const [k, m] of Object.entries(mins)) if (n >= m && m > bm) { best = k; bm = m; } return best; };
const _setTierRaid = window.setTier;
window.setTier = function (id, v) {
  const d = _setTierRaid(id, v); CFG.medalText = null;
  if (RAID[id]) { CFG.n = Math.max(1, Math.round(Number(P.n) || RAID[id].n)); CFG.title = RAID[id].title; CFG.sub1 = `${P.name} 帶著`; CFG.sub2 = `${CFG.n} 位夥伴來了`; CFG.medalText = CFG.n + '人'; }
  return d;
};
const raidLine = () => raidLineL();

// ---------- 素材 ----------
let SHIP = null, LAMP = null, ANCHOR = null, SHIP_FLIP = null;
const SHIP_GEO = { water: 0.925, deck: [[0, 0.83], [0.5, 0.83], [0.68, 0.805], [0.85, 0.775], [1, 0.775]], crew: [0.2, 0.63], mast: 0.33 };   // 照圖量：水線、船舷上緣（由左到右）、站人的位置、桅杆
const _lvaRaid = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaRaid();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  SHIP = await L2('DEF_SHIP', 'ship.png'); LAMP = await L2('DEF_LAMP', 'lamp.png'); ANCHOR = await L2('DEF_ANCHOR', 'anchor.png');
};
// 一艘船：(x, y) = 船中央的水線位置；h = 船圖高度；o.flip 船頭朝左、o.crew 幾隻吉祥物、o.ph 搖晃相位、o.wake 船尾浪花
function shipV2(ctx, x, y, h, t, o = {}) {
  if (!SHIP) return; const w = SHIP.width * h / SHIP.height, ph = o.ph || 0, G = SHIP_GEO;
  ctx.save(); ctx.translate(x, y + Math.sin(t * 2.2 + ph) * h * 0.018); ctx.rotate(Math.sin(t * 1.7 + ph) * 0.035 + (o.rot || 0)); if (o.flip) ctx.scale(-1, 1);
  const X = (u) => -w / 2 + u * w, Y = (v) => (v - G.water) * h;
  ctx.drawImage(SHIP, -w / 2, -G.water * h, w, h);
  const n = o.crew ?? 0;
  if (n && MASCOT) {   // 吉祥物站在甲板上：下半身用船舷的線裁掉，看起來是站在船裡面
    ctx.save(); ctx.beginPath(); ctx.moveTo(X(-0.1), Y(-0.2)); ctx.lineTo(X(1.1), Y(-0.2)); for (let i = G.deck.length - 1; i >= 0; i--) ctx.lineTo(X(G.deck[i][0] + (i === G.deck.length - 1 ? 0.1 : i === 0 ? -0.1 : 0)), Y(G.deck[i][1]) + h * 0.012); ctx.closePath(); ctx.clip();
    for (let i = 0; i < Math.min(n, G.crew.length); i++) { const mh = h * 0.3, bob = Math.abs(Math.sin(t * 7 + i * 1.3 + ph)) * -h * 0.03, mx = X(G.crew[i]), my = Y(0.83) - mh * 0.36 + bob;
      ctx.save(); if (o.flip) { ctx.translate(mx, 0); ctx.scale(-1, 1); ctx.translate(-mx, 0); } outlineV2(ctx, MASCOT, mx, my, mh, Math.sin(t * 7 + i) * 0.08, '#fff', Math.max(2, h * 0.008), 10); drawImg(ctx, MASCOT, mx, my, mh, Math.sin(t * 7 + i) * 0.08); ctx.restore(); }
    ctx.restore();
  }
  if (o.wake) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 5; i++) { const q = (t * 1.6 + i / 5) % 1; ctx.beginPath(); ctx.ellipse(X(0.02) - q * h * 0.35, Y(G.water) + 4, h * 0.05 * (1 - q) + 3, h * 0.022 * (1 - q) + 2, 0, 0, 7); ctx.fill(); } }
  ctx.restore();
}
// 一層海浪：上緣是正弦波，白色浪頭線，平塗兩色
function seaLayer(ctx, t, y, o = {}) {
  const x0 = o.x0 ?? -100, x1 = o.x1 ?? W + 100, amp = o.amp ?? 14, wl = o.wl ?? 190, sp = o.sp ?? 1.6, ph = o.ph ?? 0, bottom = o.bottom ?? H + 100;
  const yy = (x) => y + Math.sin(x / wl * Math.PI * 2 + t * sp + ph) * amp + Math.sin(x / (wl * 0.37) * Math.PI * 2 - t * sp * 1.3 + ph) * amp * 0.3;
  ctx.beginPath(); ctx.moveTo(x0, bottom); for (let x = x0; x <= x1 + 12; x += 12) ctx.lineTo(x, yy(x)); ctx.lineTo(x1, bottom); ctx.closePath(); ctx.fillStyle = o.col || '#3f9af0'; ctx.fill();
  ctx.save(); ctx.clip(); ctx.fillStyle = o.col2 || 'rgba(0,30,110,0.22)'; ctx.fillRect(x0, y + amp + (o.band ?? 46), x1 - x0, bottom - y); ctx.restore();
  ctx.beginPath(); for (let x = x0; x <= x1 + 12; x += 12) (x === x0 ? ctx.moveTo(x, yy(x)) : ctx.lineTo(x, yy(x))); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = o.lw ?? 7; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; for (let x = x0 + ((ph * 97) % wl); x < x1; x += wl) { ctx.beginPath(); ctx.ellipse(x + Math.sin(t * sp + x) * 10, yy(x) + amp + 16, wl * 0.11, 4, 0, 0, 7); ctx.fill(); }   // 浪面上的白色反光
}
const SEA_COL = [['#8fd6ff', 'rgba(20,90,200,0.2)'], ['#46a4f4', 'rgba(0,50,150,0.24)'], ['#1f74e0', 'rgba(0,20,100,0.3)']];
function seaBack(ctx, t, y, o = {}) { seaLayer(ctx, t, y - 34, Object.assign({ col: SEA_COL[0][0], col2: SEA_COL[0][1], amp: 10, wl: 230, sp: 1.1, ph: 1.7 }, o)); seaLayer(ctx, t, y - 12, Object.assign({ col: SEA_COL[1][0], col2: SEA_COL[1][1], amp: 13, wl: 200, sp: 1.5, ph: 0.6 }, o)); }
function seaFront(ctx, t, y, o = {}) { seaLayer(ctx, t, y + 14, Object.assign({ col: SEA_COL[2][0], col2: SEA_COL[2][1], amp: 16, wl: 170, sp: 2.0, ph: 2.9 }, o)); }
function gullV2(ctx, x, y, s, t) { const f = Math.sin(t * 9) * 0.5; ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [col, lw] of [['#2b1a3a', 9 * s], ['#ffffff', 5 * s]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(-34 * s, (-6 - 14 * f) * s); ctx.quadraticCurveTo(-16 * s, (-18 - 4 * f) * s, 0, 0); ctx.quadraticCurveTo(16 * s, (-18 - 4 * f) * s, 34 * s, (-6 - 14 * f) * s); ctx.stroke(); }
  ctx.restore(); }
function splashV2(ctx, x, y, l, s = 1) {   // 水花：白色水滴往上噴再落下
  if (l < 0 || l > 0.7) return; const p = l / 0.7;
  for (let i = 0; i < 16; i++) { const a = -Math.PI / 2 + (R(i, 61) - 0.5) * 2.2, v = (260 + R(i, 62) * 420) * s, px = x + Math.cos(a) * v * l, py = y + Math.sin(a) * v * l + 900 * s * l * l, r = (7 + R(i, 63) * 10) * s * (1 - p * 0.6);
    ctx.fillStyle = i % 3 ? '#ffffff' : '#bfe8ff'; ctx.strokeStyle = '#2b6ad0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); ctx.stroke(); }
}
function lampV2(ctx, x, y, h, t, a = 1) {   // 旋轉警示燈：燈本體＋兩道掃動的紅光
  if (!LAMP) return; const w = LAMP.width * h / LAMP.height, sw = Math.sin(t * 9);
  ctx.save(); ctx.globalAlpha *= a; ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(14px)';
  for (const d of [-1, 1]) { const len = 900 * Math.abs(sw) + 120; const gr = ctx.createLinearGradient(x, y, x + d * len, y); gr.addColorStop(0, 'rgba(255,60,60,0.75)'); gr.addColorStop(1, 'rgba(255,60,60,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x, y - h * 0.18); ctx.lineTo(x + d * len, y - h * 0.9); ctx.lineTo(x + d * len, y + h * 0.9); ctx.lineTo(x, y + h * 0.18); ctx.fill(); }
  const gl = ctx.createRadialGradient(x, y, 0, x, y, h * 1.3); gl.addColorStop(0, `rgba(255,80,80,${0.5 + 0.3 * Math.abs(sw)})`); gl.addColorStop(1, 'rgba(255,60,60,0)'); ctx.fillStyle = gl; ctx.fillRect(x - h * 1.3, y - h * 1.3, h * 2.6, h * 2.6);
  ctx.restore();
  ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(LAMP, x - w / 2, y - h / 2, w, h); ctx.restore();
}
function fitText(ctx, txt, x, y, maxW, font, fill, stroke, lw, align = 'left') {
  ctx.save(); ctx.font = font; const w = ctx.measureText(txt).width, f = Math.min(1, maxW / w); ctx.translate(x, y); ctx.scale(f, f); ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeText(txt, 0, 0); } ctx.fillStyle = fill; ctx.fillText(txt, 0, 0); ctx.restore();
}

// ---------------- 揪團 小：角落明信片（船開進窗景，桅杆探出框外） ----------------
function vRaid1(ctx, t) {
  if (!SHIP) return;
  const D = CFG.dur, X0 = 70, Y0 = 740, CW = 1000, CH = 292, k = eback(lin(t, 0, 0.45), 1.3), out = ei(lin(t, D - 0.5, D - 0.05)), STOP = 1.5, pal = PAL.sky;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(0, (1 - k) * 460 + out * 460);
  const hit = decay(t, [[STOP, 1], [1.62, 0.7]], 12); ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * hit * 8, (R(Math.floor(t * 60), 2) - 0.5) * hit * 8);
  const frame = () => { ctx.beginPath(); ctx.roundRect(X0, Y0, CW, CH, 30); };
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12; frame(); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.restore();
  // 窗景：天空、太陽光、雲、後面的海
  const inner = () => { ctx.beginPath(); ctx.roundRect(X0 + 12, Y0 + 12, CW - 24, CH - 24, 20); };
  ctx.save(); inner(); ctx.clip();
  const sky = ctx.createLinearGradient(0, Y0, 0, Y0 + CH); sky.addColorStop(0, '#5fb6ff'); sky.addColorStop(0.7, '#c8f0ff'); sky.addColorStop(1, '#f2fbff'); ctx.fillStyle = sky; ctx.fillRect(X0, Y0, CW, CH);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, X0 + CW - 120, Y0 + 40, 14, 'rgba(255,255,255,0.22)', t * 0.25, 1300, 0.4, 8); ctx.restore();
  cloudV2(ctx, X0 + 700 - t * 16, Y0 + 70, 0.5, 0.95); cloudV2(ctx, X0 + 960 - t * 10, Y0 + 130, 0.36, 0.9);
  seaBack(ctx, t, Y0 + CH - 62, { x0: X0, x1: X0 + CW, bottom: Y0 + CH, amp: 7, wl: 150, lw: 5, band: 30 });
  ctx.restore();
  // 船：畫在「窗內＋窗框上方」的範圍，桅杆和旗子會探出框外
  const sx = mixv(X0 - 300, X0 + 232, eo5(lin(t, 0.3, STOP))), sh = 372, sy = Y0 + CH - 52;
  ctx.save(); ctx.beginPath(); ctx.roundRect(X0 + 12, Y0 + 12, CW - 24, CH - 24, 20); ctx.rect(X0 + 12, Y0 - 400, CW - 24, 430); ctx.clip();
  shipV2(ctx, sx, sy, sh, t, { crew: 2, wake: t < STOP + 0.2, rot: t < STOP ? -0.03 : 0 }); ctx.restore();
  ctx.save(); inner(); ctx.clip(); seaFront(ctx, t, Y0 + CH - 52, { x0: X0, x1: X0 + CW, bottom: Y0 + CH, amp: 9, wl: 130, lw: 5, band: 26 }); splashV2(ctx, X0 + 400, Y0 + CH - 50, t - STOP, 0.7); ctx.restore();
  // 白框描邊
  ctx.save(); frame(); ctx.lineWidth = 12; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = '#1a4a9a'; ctx.beginPath(); ctx.roundRect(X0 - 5, Y0 - 5, CW + 10, CH + 10, 34); ctx.stroke(); ctx.restore();
  // 文字（右側）
  const tk = lin(t, STOP + 0.08, STOP + 0.26); if (tk > 0) { const s = slamK(tk, 1.9); ctx.save(); ctx.translate(X0 + 716, Y0 + 104); ctx.rotate(-0.04); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 104, pal, 'center', 500); ctx.restore(); }
  const nk = eo(lin(t, STOP + 0.36, STOP + 0.58)); if (nk > 0) { ctx.save(); ctx.globalAlpha *= nk; ctx.translate((1 - nk) * 30, 0);
    ctx.fillStyle = '#1a3a8a'; ctx.beginPath(); ctx.roundRect(X0 + 456, Y0 + 176, 520, 76, 38); ctx.fill(); fitText(ctx, raidLine(), X0 + 716, Y0 + 216, 470, "900 42px 'Noto Sans TC'", '#ffffff', null, 0, 'center'); ctx.restore(); }
  // RAID 小旗標
  const rk = lin(t, STOP + 0.5, STOP + 0.7); if (rk > 0) { const s = popK(rk, 2.4); ctx.save(); ctx.translate(X0 + CW - 76, Y0 + 8); ctx.rotate(0.12); ctx.scale(s, s); ctx.fillStyle = '#e8243c'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(-78, -30, 156, 60, 12); ctx.fill(); ctx.stroke(); ctx.font = "34px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('RAID', 0, 3); ctx.restore(); }
  gullV2(ctx, X0 + 560 + Math.sin(t * 0.9) * 60, Y0 - 60 + Math.cos(t * 1.4) * 14, 0.9, t); gullV2(ctx, X0 + 880 - t * 22, Y0 - 108 + Math.sin(t * 1.1) * 12, 0.7, t + 0.4);
  sparkBurst(ctx, X0 + 716, Y0 + 104, t - STOP - 0.1, 12, 1.1, '#fff6c0');
  ctx.restore();
}

// ---------------- 揪團 中：下方海面橫帶（三艘船開進來，標題砸在海上） ----------------
function vRaid2Scene(ctx, t) {
  const SEA = 850, rise = (1 - eback(lin(t, 0, 0.5), 1.2)) * 460, TT = 1.75, pk = decay(t, [[1.45, 0.5], [TT, 1]], 11);
  ctx.save(); camV2(ctx, 960, 900, 1.012 + pk * 0.03); shakeAt(ctx, t, pk * 16); ctx.translate(0, rise);
  // 海面上方一點水氣光，讓船和標題跟直播畫面分開
  const hz = ctx.createLinearGradient(0, SEA - 420, 0, SEA); hz.addColorStop(0, 'rgba(120,200,255,0)'); hz.addColorStop(1, 'rgba(120,200,255,0.4)'); ctx.fillStyle = hz; ctx.fillRect(-100, SEA - 420, W + 200, 420);
  seaBack(ctx, t, SEA);
  const e1 = eo5(lin(t, 0.25, 1.45)), e2 = eo5(lin(t, 0.6, 1.9)), e3 = eo5(lin(t, 0.85, 2.15));
  shipV2(ctx, mixv(-300, 112, e2), SEA - 26, 330, t, { crew: 1, ph: 1.3, wake: e2 < 0.98 });
  shipV2(ctx, mixv(-420, 812, e3), SEA - 30, 215, t, { crew: 1, ph: 2.6, wake: e3 < 0.98 });
  seaLayer(ctx, t, SEA - 6, { col: SEA_COL[1][0], col2: SEA_COL[1][1], amp: 12, wl: 210, sp: 1.7, ph: 4.2 });
  shipV2(ctx, mixv(-520, 480, e1), SEA + 12, 620, t, { crew: 2, ph: 0, wake: e1 < 0.98, rot: e1 < 1 ? -0.035 * (1 - e1) : 0 });
  seaFront(ctx, t, SEA + 6);
  splashV2(ctx, 760, SEA + 10, t - 1.42, 1.2);
  for (let i = 0; i < 3; i++) gullV2(ctx, 300 + i * 420 + Math.sin(t * 0.8 + i) * 80, 300 + i * 60 + Math.cos(t * 1.3 + i * 2) * 20 - rise, 1.2 - i * 0.15, t + i * 0.3);
  if (t >= TT) { shardsV2(ctx, 1400, 590, t - TT, 34, ['#ffffff', '#bff0ff', '#fff2a8']); ringBurst(ctx, 1400, 590, t - TT, { r1: 1100, col: 'rgba(200,240,255,1)' }); }
  heroTitle(ctx, t, 1400, 590, lin(t, TT, TT + 0.18), { maxW: 930, pk });
  plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 1408, 876, 0.94);
  ctx.restore();
  if (t >= TT) confetti(ctx, t, TT, 60, ['#ffffff', '#8fd8ff', '#ffe27a', '#ff7aa8'], 71);
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.22, '#dff4ff');
}
function vRaid2(ctx, t) { if (!SHIP) return; runV2(ctx, t, { T: 1e9, exitKind: 'whipL', pre: vRaid2Scene }); }

// ---------------- 揪團 大：警報 → 雷達偵測人數 → 大浪把船隊送進來 ----------------
const RD3 = { word: 0.35, radar: 0.6, lock: 2.0, wave: 2.1, T: 3.0 };
function radarV2(ctx, t, x, y, r, n, a = 1) {
  ctx.save(); ctx.globalAlpha *= a; ctx.shadowColor = 'rgba(44,255,154,0.6)'; ctx.shadowBlur = 40; ctx.fillStyle = '#062a1e'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  ctx.strokeStyle = 'rgba(44,255,154,0.45)'; ctx.lineWidth = 3; for (const q of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(x, y, r * q, 0, 7); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
  const sw = t * 4.2; for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(44,255,154,${0.5 * (1 - i / 40)})`; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, sw - i * 0.03 - 0.03, sw - i * 0.03); ctx.fill(); }   // 掃描扇形
  for (let i = 0; i < n; i++) { const an = R(i, 81) * Math.PI * 2, rr = r * (0.15 + 0.8 * Math.sqrt(R(i, 82))), d = ((sw - an) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), br = Math.max(0.35, 1 - d / 5);
    ctx.fillStyle = `rgba(255,${90 + 140 * br | 0},90,${br})`; ctx.beginPath(); ctx.arc(x + Math.cos(an) * rr, y + Math.sin(an) * rr, 7 + 6 * br, 0, 7); ctx.fill(); }
  ctx.restore();
  ctx.lineWidth = 14; ctx.strokeStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7); ctx.stroke(); ctx.lineWidth = 5; ctx.strokeStyle = '#2b1a3a'; ctx.beginPath(); ctx.arc(x, y, r + 13, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, r - 3, 0, 7); ctx.stroke();
  ctx.restore();
}
function bigWaveV2(ctx, t, top) {   // 整片大浪往上蓋（top = 浪頂高度）
  seaLayer(ctx, t, top + 90, { col: SEA_COL[0][0], col2: SEA_COL[0][1], amp: 46, wl: 520, sp: 5, ph: 1.2, lw: 12, band: 120 });
  seaLayer(ctx, t, top + 190, { col: SEA_COL[1][0], col2: SEA_COL[1][1], amp: 54, wl: 460, sp: 6, ph: 0.3, lw: 12, band: 140 });
}
function vRaid3Pre(ctx, t) {
  const T = RD3, app = eo(lin(t, 0, 0.25)), cnt = Math.max(1, Math.round(CFG.n * eo(lin(t, T.radar + 0.2, T.lock)))), nb = Math.round(46 * eo(lin(t, T.radar + 0.1, T.lock)));
  const pk = decay(t, [[T.word, 1], [T.lock, 1]], 10), wv = eio(lin(t, T.wave, T.T - 0.08));
  ctx.save(); camV2(ctx, 960, 560, 1.014 + pk * 0.045 + 0.05 * sstep(lin(t, T.radar, T.lock))); shakeAt(ctx, t, pk * 22 + (t > T.radar && t < T.lock ? 3 : 0) + wv * 14);
  ctx.fillStyle = `rgba(6,10,36,${0.9 * app})`; ctx.fillRect(-80, -80, W + 160, H + 160);
  ctx.save(); ctx.globalAlpha = app * (0.1 + 0.08 * Math.sin(t * 18)); ctx.fillStyle = '#ff2a3a'; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore();   // 紅色警戒脈動（局部閃，不是全白）
  if (t > T.radar - 0.1) { const rk = eback(lin(t, T.radar - 0.1, T.radar + 0.3), 1.5); ctx.save(); ctx.translate(960, 600); ctx.scale(rk, rk); radarV2(ctx, t, 0, 0, 300, nb); ctx.restore(); }
  lampV2(ctx, 200, 190, 210, t, app); lampV2(ctx, W - 200, 190, 210, t + 0.35, app);
  if (wv > 0) {   // 大浪從下面蓋上來，三艘船跟著浪頂衝上來
    const top = mixv(1250, -260, wv); bigWaveV2(ctx, t, top);
    shipV2(ctx, 520, top + 150, 420, t, { crew: 1, ph: 1, rot: -0.18 }); shipV2(ctx, 1460, top + 190, 380, t, { crew: 1, ph: 2.2, rot: -0.14, flip: true });
    seaLayer(ctx, t, top + 290, { col: SEA_COL[2][0], col2: SEA_COL[2][1], amp: 60, wl: 420, sp: 7, ph: 2.2, lw: 14, band: 160 });
    shipV2(ctx, 960, top + 330, 640, t, { crew: 2, ph: 0, rot: -0.1 });
    seaLayer(ctx, t, top + 480, { col: '#1558c0', col2: 'rgba(0,10,80,0.35)', amp: 50, wl: 380, sp: 8, ph: 3.3, lw: 14, band: 200 });
  }
  ctx.restore();
  const hz = eo5(lin(t, 0.05, 0.3)) * (1 - eo(lin(t, T.wave + 0.15, T.wave + 0.5))); if (hz > 0) { hazard(ctx, -74 + 74 * hz, 74, t * 320); hazard(ctx, H - 74 * hz, 74, -t * 320); }
  if (t < T.wave + 0.25) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.wave, T.wave + 0.25);
    wordV2(ctx, 'RAID!!', 960, 212, lin(t, T.word, T.word + 0.14), { s: 1.25, big: 3, fill: Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a', stroke: '#1a0008', rot: -0.04, beat: Math.sin(t * 28) * 0.03, depth: 12 });
    if (t > T.radar + 0.2) { hudText(ctx, 'RAID DETECTED', 960, 946, 34, '#7dffc0', 'center', eo(lin(t, T.radar + 0.2, T.radar + 0.4)));
      wordV2(ctx, ppl(cnt), 960, 600, 1, { pop: false, s: 0.9 + (t >= T.lock ? Math.exp(-(t - T.lock) * 8) * 0.5 : 0), font: "150px 'Dela Gothic One', 'Noto Sans TC'", fill: t >= T.lock ? '#ffe14a' : '#ffffff', stroke: '#04160f', rot: -0.03, box: false }); }
    ctx.restore(); }
  if (t >= T.lock) flash(ctx, (1 - lin(t, T.lock, T.lock + 0.12)) * 0.45, '#ffd0d0');
}
function raidSeaBack(c, t, y, ships) {   // 結尾共用：後面的海和船（船上有吉祥物）
  seaBack(c, t, y); for (const [x, h, o] of ships) shipV2(c, x, y - 10 + (o.dy || 0), h, t, o); seaFront(c, t, y + 4);
}
function vRaid3Fin(ctx, m, t) {   // 結尾：直書大字
  finaleV2(ctx, m, t, { style: 'vertical', tGirl: 0.05, tTitle: 0.42, mascot: false, girl: { x: 1400, from: 'right', rot: 0.02 }, plate: { x: 890, y: 560, sc: 0.9 },
    bg: (c, mm) => { c.save(); c.translate(-40, -30); c.scale(1.045, 1.06); palBG(c, t, PAL.blue, 1280, 380); c.restore(); },
    back: (c, mm, tt) => { const e = eo5(lin(mm, 0, 0.6)); c.save(); c.translate(0, (1 - e) * 420); raidSeaBack(c, tt, 905, [[1000, 215, { crew: 1, ph: 2 }], [680, 280, { crew: 2, ph: 0.4 }]]); c.restore(); splashV2(c, 820, 900, mm - 0.5, 1.2); },
    front: (c, mm, tt) => { for (let i = 0; i < 2; i++) gullV2(c, 560 + i * 380 + Math.sin(tt * 0.8 + i) * 70, 150 + i * 40 + Math.cos(tt * 1.3 + i) * 14, 1.1, tt + i * 0.3); } });
}
function vRaid3(ctx, t) { if (!SHIP) return; runV2(ctx, t, { T: RD3.T, cutA: 0.7, cutCol: '#e8f6ff', exitKind: 'slice', pre: vRaid3Pre, fin: vRaid3Fin }); }

// ---------------- 揪團 特大：望遠鏡看到船越來越多 → 漫畫分格 → 海嘯橫掃 → 彩虹大結尾 ----------------
const RD4 = { scope: 0.5, steps: [0.95, 1.35, 1.7, 2.0, 2.25], panel: [2.5, 2.85, 3.2], wave: 3.7, T: 4.5 };
function raidSeal(ctx, t, x, y, k, pk) {   // 金牌「RAID」
  if (k <= 0) return; const s = (k < 1 ? 3 - 2 * eback(k, 1.6) : 1) * (1 + pk * 0.08);
  ctx.save(); ctx.translate(x, y); ctx.rotate(0.12 + Math.sin(t * 4) * 0.04); ctx.scale(s, s);
  const gg = ctx.createLinearGradient(0, -70, 0, 70); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffb21a'); gg.addColorStop(1, '#a86400');
  ctx.shadowColor = 'rgba(255,220,100,1)'; ctx.shadowBlur = 40; ctx.fillStyle = gg; ctx.beginPath(); ctx.roundRect(-190, -66, 380, 132, 30); ctx.fill(); ctx.shadowBlur = 0;
  ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#1a0838'; ctx.beginPath(); ctx.roundRect(-166, -44, 332, 88, 20); ctx.fill();
  ctx.font = "70px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = rainbowFill(ctx, -30, 30, t); ctx.fillText('RAID', 0, 4); ctx.restore();
  if (k >= 1) dbgBoxC(ctx, 'text', 'seal', x, y, 400, 150, 0.12);
}
function vRaid4Pre(ctx, t) {
  const T = RD4, app = eo(lin(t, 0, 0.2)); let lv = 0; for (const s of T.steps) if (t >= s) lv++;
  const hits = [[0.12, 0.6], ...T.steps.map((s, i) => [s, 0.4 + 0.14 * i]), ...T.panel.map((p) => [p, 0.9])], pk = decay(t, hits, 11), wv = eio(lin(t, T.wave, T.T - 0.06));
  const cnt = Math.max(1, Math.round(CFG.n * Math.pow(lin(t, T.scope + 0.3, T.steps[4]), 1.6)));
  ctx.save(); camV2(ctx, 960, 540, 1.014 + pk * 0.05 + lv * 0.012); shakeAt(ctx, t, pk * 24 + lv * 1.5 + wv * 16);
  ctx.fillStyle = `rgba(4,4,16,${0.95 * app})`; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (t < T.panel[0] + 0.1) {
    // 望遠鏡：圓形視野裡的海平線，船越冒越多
    const r = 400 * eback(lin(t, T.scope - 0.1, T.scope + 0.3), 1.4), cx = 960 + Math.sin(t * 2.3) * 14, cy = 560 + Math.cos(t * 1.9) * 10;
    if (r > 2) { ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
      const sky = ctx.createLinearGradient(0, cy - r, 0, cy + r); sky.addColorStop(0, '#3a8ae8'); sky.addColorStop(0.55, '#c8f0ff'); ctx.fillStyle = sky; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, cx, cy - 60, 14, 'rgba(255,255,255,0.18)', t * 0.3, 900, 0.4, 8); ctx.restore();
      cloudV2(ctx, cx - 190 + t * 12, cy - 210, 0.6, 0.95); cloudV2(ctx, cx + 220 - t * 9, cy - 120, 0.42, 0.9);
      seaLayer(ctx, t, cy + 40, { col: SEA_COL[0][0], col2: SEA_COL[0][1], amp: 5, wl: 130, sp: 1.2, lw: 4, band: 22, x0: cx - r, x1: cx + r });
      const ns = Math.round(mixv(1, 26, Math.pow(lin(t, T.scope + 0.3, T.steps[4]), 1.4)));   // 海平線上的船：先一艘，然後一排、兩排
      for (let i = ns - 1; i >= 0; i--) { const row = i < 5 ? 0 : i < 13 ? 1 : 2, kk = row === 0 ? i : row === 1 ? i - 5 : i - 13, nn = [5, 8, 13][row], hh = [150, 92, 56][row];
        shipV2(ctx, cx + (kk - (nn - 1) / 2) * (r * 1.7 / nn) + (row % 2) * 20, cy + 50 + [70, 22, -6][row], hh * popK(lin(t, T.scope + 0.3 + i * 0.065, T.scope + 0.5 + i * 0.065), 2.2), t, { ph: i * 1.7, flip: true }); }
      seaLayer(ctx, t, cy + 150, { col: SEA_COL[1][0], col2: SEA_COL[1][1], amp: 9, wl: 150, sp: 1.8, lw: 5, band: 30, x0: cx - r, x1: cx + r });
      ctx.restore();
      ctx.save(); ctx.lineWidth = 34; ctx.strokeStyle = '#2b1a3a'; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, 7); ctx.stroke(); ctx.lineWidth = 20; const gg = ctx.createLinearGradient(0, cy - r, 0, cy + r); gg.addColorStop(0, '#fff2a0'); gg.addColorStop(1, '#c87a00'); ctx.strokeStyle = gg; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,10,40,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r + 70, cy); ctx.moveTo(cx + r - 70, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r + 70); ctx.moveTo(cx, cy + r - 70); ctx.lineTo(cx, cy + r); ctx.stroke(); ctx.restore(); }
    if (t < T.scope) wordV2(ctx, '!', 960, 540, lin(t, 0.1, 0.22), { s: 2.4, fill: '#ff3a4a', stroke: '#ffffff', rot: 0, box: false });
  } else if (t < T.T) {
    // 漫畫三分格：船頭特寫／角色特寫／艦隊名
    rainbowBG2(ctx, t * 2.2, 960, 540); ctx.fillStyle = 'rgba(10,0,40,0.35)'; ctx.fillRect(-80, -80, W + 160, H + 160);
    const P1 = [[40, 40], [760, 40], [600, 1040], [40, 1040]], P2 = [[800, 40], [1880, 40], [1880, 560], [716, 560]], P3 = [[708, 610], [1880, 610], [1880, 1040], [640, 1040]];
    const pin = (i) => eo5(lin(t, T.panel[i], T.panel[i] + 0.22));
    if (t >= T.panel[0]) mangaPanel(ctx, P1, (1 - pin(0)) * -900, 0, 1, () => { const sk = ctx.createLinearGradient(0, 0, 0, H); sk.addColorStop(0, '#3a8ae8'); sk.addColorStop(1, '#c8f0ff'); ctx.fillStyle = sk; ctx.fillRect(0, 0, 800, H); speedLines(ctx, 380, 620, 40, 300, 'rgba(255,255,255,0.5)', Math.floor(t * 20), 0, 1); seaBack(ctx, t, 900); shipV2(ctx, 330 + (t - T.panel[0]) * 40, 930, 900, t, { crew: 2, rot: -0.05 }); seaFront(ctx, t, 930); });
    if (t >= T.panel[1]) mangaPanel(ctx, P2, 0, (1 - pin(1)) * -700, 1, () => { ctx.save(); ctx.translate(-40, -30); ctx.scale(1.045, 1.06); palBG(ctx, t, PAL.gold, 1300, 300); ctx.restore(); if (GIRL) { const gh = 2300, [fx, fy] = facePos(0, 0, gh); drawImg(ctx, GIRL, 1330 - fx, 320 - fy, gh, 0); } wordV2(ctx, 'えっ!?', 1610, 150, lin(t, T.panel[1] + 0.1, T.panel[1] + 0.22), { s: 0.7, fill: '#ffffff', stroke: '#1a0838', rot: 0.08, box: false }); });
    if (t >= T.panel[2]) mangaPanel(ctx, P3, (1 - pin(2)) * 1300, 0, 1, () => { ctx.fillStyle = '#12084a'; ctx.fillRect(600, 600, 1300, 460); speedLines(ctx, 1280, 830, 50, 260, `hsla(${(t * 300) % 360},100%,70%,0.4)`, Math.floor(t * 20), 0, 1);
      fitText(ctx, P.name, 1290, 760, 1000, "150px 'Dela Gothic One', 'Noto Sans TC'", '#ffffff', '#1a0838', 30, 'center'); fitText(ctx, LX('fleet'), 1290, 930, 1000, "900 96px 'Noto Sans TC'", '#ffe14a', '#1a0838', 22, 'center'); });
    for (const p of T.panel) if (t >= p) ringBurst(ctx, 960, 540, t - p, { r1: 1400, dur: 0.35, w: 20 });
  }
  if (wv > 0) {   // 海嘯由右往左掃過整個畫面（轉 90 度的大浪），船在浪頭上
    const edge = mixv(W + 500, -700, wv);
    ctx.save(); ctx.translate(edge, 0); ctx.rotate(Math.PI / 2); ctx.translate(0, -2600); bigWaveV2(ctx, t, 2600 - 260); ctx.restore();
    ctx.fillStyle = SEA_COL[2][0]; ctx.fillRect(edge + 330, -100, W + 1400, H + 200);
    for (let i = 0; i < 5; i++) shipV2(ctx, edge + 300 + (i % 2) * 190, 150 + i * 195, 330 - (i % 2) * 60, t, { crew: 1, ph: i, flip: true, rot: -0.2 });
    ctx.save(); ctx.beginPath(); ctx.rect(edge + 330, -100, W + 1400, H + 200); ctx.clip(); for (let i = 0; i < 22; i++) { const len = 260 + R(i, 93) * 420, x = edge + 380 + ((R(i, 94) * 2400 + t * 2600) % 2400); ctx.fillStyle = `rgba(255,255,255,${0.25 + R(i, 95) * 0.4})`; ctx.beginPath(); ctx.roundRect(x, 30 + R(i, 96) * (H - 60), len, 5 + R(i, 97) * 7, 6); ctx.fill(); } ctx.restore();
    for (let i = 0; i < 26; i++) { const q = (t * 2.2 + R(i, 91)) % 1; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(edge - 40 - q * 260, R(i, 92) * H, 20 * (1 - q) + 4, 0, 7); ctx.fill(); }
  }
  ctx.restore();
  if (wv > 0.28 && t < T.T) wordV2(ctx, 'ザッパーン!!', 960, 540, lin(wv, 0.28, 0.42), { s: 1.5, big: 3, fill: '#ffffff', stroke: '#0a3a9a', rot: -0.06, beat: Math.sin(t * 30) * 0.03, depth: 12, box: false });
  if (t >= T.scope + 0.3 && t < T.panel[0] + 0.1) {   // 人數一路往上跳，字的顏色跟著升級
    const colr = lv >= 5 ? rainbowFill(ctx, -70, 70, t) : ['#ffffff', '#8fe0ff', '#7dff9a', '#ff5a6a', '#ffd21a'][lv];
    wordV2(ctx, ppl(cnt), 960, 965, 1, { pop: false, s: 0.78 + lv * 0.06 + (lv ? Math.exp(-(t - T.steps[lv - 1]) * 9) * 0.3 : 0), fill: colr, stroke: '#0a0420', rot: -0.03, box: false });
    const lab = ['', '船影…?', '艦隊!?', '激アツ!!', '超激アツ!!', '大艦隊!!!'][lv]; if (lv) wordV2(ctx, lab, 960, 110, lin(t, T.steps[lv - 1], T.steps[lv - 1] + 0.12), { s: 0.7 + lv * 0.09, fill: colr, stroke: lv >= 3 ? '#3a0010' : '#0a1450', rot: -0.04, beat: Math.sin(t * 22) * 0.02 * lv, box: false });
  }
  for (const s of T.steps) if (t >= s && t < s + 0.1) flash(ctx, (1 - (t - s) / 0.1) * 0.22, '#fff');
  if (t >= T.panel[0] && t < T.panel[0] + 0.14) flash(ctx, (1 - (t - T.panel[0]) / 0.14) * 0.6, '#fff');
}
function vRaid4Fin(ctx, m, t) {   // 結尾：巨大人數（船錨徽章在角色背後）
  finaleV2(ctx, m, t, { style: 'count', tGirl: 0.12, tTitle: 0.62, bgC: [500, 400], confettiN: 220, mascot: false,
    back: (c, mm, tt, pk) => {
      c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 500, 380, 18, 'rgba(255,255,255,0.2)', tt * 0.4, 2100, 0.4, 16); c.restore();
      fireworksAt(c, mm, [[0.4, 1000, 230, 30], [0.7, 1700, 250, 200], [1.1, 1300, 170, 300], [1.5, 880, 420, 120], [1.9, 1760, 520, 60], [2.3, 1100, 300, 260], [2.8, 1500, 200, 180], [3.3, 920, 260, 330], [3.8, 1650, 380, 90]]);
      if (ANCHOR) { const k = eback(lin(mm, 0.05, 0.5), 1.5), ah = 1100 * k * (1 + pk * 0.02), aw = ANCHOR.width * ah / ANCHOR.height; c.save(); c.globalAlpha = 0.95; c.shadowColor = 'rgba(255,230,140,0.9)'; c.shadowBlur = 60; c.drawImage(ANCHOR, 500 - aw / 2, 480 - ah / 2 + Math.sin(tt * 1.5) * 8, aw, ah); c.restore(); }
      const e = eo5(lin(mm, 0.1, 0.7)); c.save(); c.translate(0, (1 - e) * 500); raidSeaBack(c, tt, 860, [[1010, 190, { crew: 1, ph: 0.5, flip: true }], [1700, 210, { crew: 1, ph: 2.1, flip: true }]]); c.restore();
      coinFountain(c, mm, 0.2, 3.6, 170); },
    front: (c, mm, tt, pk) => raidSeal(c, tt, 300, 836, lin(mm, 1.45, 1.63), pk) });
}
function vRaid4(ctx, t) { if (!SHIP) return; runV2(ctx, t, { T: RD4.T, cutA: 0.8, exitKind: 'smear', pre: vRaid4Pre, fin: vRaid4Fin }); }

VARS.r1 = [{ name: '小船靠港', fn: vRaid1, dur: 4.4 }];
VARS.r2 = [{ name: '船隊進港', fn: vRaid2, dur: 5.6 }];
VARS.r3 = [{ name: '警報・雷達・大浪', fn: vRaid3, dur: 7.2 }];
VARS.r4 = [{ name: '大艦隊來襲', fn: vRaid4, dur: 9.6 }];
