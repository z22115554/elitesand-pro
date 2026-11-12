// 抖內「大物降臨」激熱演出：draw(t) 純函式逐格算圖，1920x1080
const W = 1920, H = 1080, CX = W / 2, CY = H / 2;
const cv = document.getElementById('c');
const g = cv.getContext('2d');
const P = Object.assign({ name: '星見ほたる', tier: 'g50', bg: '1' },
  Object.fromEntries(new URLSearchParams(location.search)));

// ---------- 工具 ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lin = (t, a, b) => clamp((t - a) / (b - a));
const eo = (x) => 1 - Math.pow(1 - x, 3);
const eo5 = (x) => 1 - Math.pow(1 - x, 5);
const ei = (x) => x * x * x;
const eback = (x, s = 1.9) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
const R = (i, k = 0) => hash(i * 13.37 + k * 71.13);
function mk(w = W, h = H) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const buf = mk(), bctx = buf.getContext('2d');
const buf2 = mk(), b2 = buf2.getContext('2d');

// ---------- 素材 ----------
function assetUrl(src) { const m = /^\.\.\/assets\/([\w-]+)\.png$/.exec(String(src)); return m ? `assets/${m[1]}.webp` : src; }   /* 內建道具圖放在同資料夾的 assets/，一律 WebP */
function load(src) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = assetUrl(src); }); }
let XS = 0;
let GIRL, GIRL_BW, GIRL_INV, GIRL_SIL, MASCOT, MASCOT_SIL;
const FACE = { x: 0.49, y: 0.15, s: 0.12 }; window.FACE = FACE;   // 臉在圖中的位置（比例），換圖後校正
function trimmed(img) {
  const c = mk(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y += 2) for (let xx = 0; xx < c.width; xx += 2) if (d[(y * c.width + xx) * 4 + 3] > 20) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const o = mk(x1 - x0 + 2, y1 - y0 + 2); o.getContext('2d').drawImage(c, -x0, -y0); return o;
}
function variant(src, fn) {
  const c = mk(src.width, src.height), x = c.getContext('2d'); x.drawImage(src, 0, 0);
  const id = x.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const L = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255; const v = fn(L); d[i] = d[i + 1] = d[i + 2] = v; }
  x.putImageData(id, 0, 0); return c;
}
function silhouette(src, col = '#fff') {
  const c = mk(src.width, src.height), x = c.getContext('2d'); x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); return c;
}
function tinted(src, col) {   // 黑白圖套色：白→col
  const c = mk(src.width, src.height), x = c.getContext('2d'); x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0); return c;
}
let GIRL_CY, GIRL_GD;

// ---------- 共用畫法 ----------
function drawImg(ctx, img, cx, cy, h, rot = 0, alpha = 1, flip = false) {
  if (!img) return;
  const w = img.width * h / img.height;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.rotate(rot); if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
}
// 以臉為中心的特寫：zoom = 臉寬佔畫面高的倍率
function drawFace(ctx, img, zoom, dx = 0, dy = 0, rot = 0) {
  const h = H * zoom / FACE.s; const w = img.width * h / img.height;
  ctx.save(); ctx.translate(CX + dx, CY + dy); ctx.rotate(rot);
  ctx.drawImage(img, -FACE.x * w, -FACE.y * h, w, h); ctx.restore();
}
function sliceShift(ctx, src, t, amt, seed, n = 14) {  // 水平切片錯位
  let y = 0, k = 0;
  while (y < H) {
    const hh = 12 + R(seed + k, 1) * 90; const on = R(seed + k, 2) < 0.55;
    const dx = on ? (R(seed + k, 3) - 0.5) * amt : 0;
    ctx.drawImage(src, 0, y, W, hh, dx, y, W, hh); y += hh; k++;
  }
}
function rgbSplit(ctx, src, off) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [col, dx] of [['#f00', -off], ['#0f0', 0], ['#00f', off]]) {
    b2.clearRect(0, 0, W, H); b2.globalCompositeOperation = 'source-over'; b2.drawImage(src, 0, 0);
    b2.globalCompositeOperation = 'multiply'; b2.fillStyle = col; b2.fillRect(0, 0, W, H);
    b2.globalCompositeOperation = 'destination-in'; b2.drawImage(src, 0, 0);
    ctx.drawImage(buf2, dx, 0);
  }
  ctx.restore();
}
function cracks(ctx, seed, cx, cy, grow, col = '#fff', lw = 3) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'miter';
  for (let i = 0; i < 11; i++) {
    let a = (i / 11) * Math.PI * 2 + R(seed, i) * 0.5, x = cx, y = cy, len = 0;
    const L = (500 + R(seed, i + 30) * 900) * grow;
    ctx.lineWidth = lw * (0.6 + R(seed, i + 9)); ctx.beginPath(); ctx.moveTo(x, y);
    let j = 0;
    while (len < L) { const s = 40 + R(seed + i, j) * 110; a += (R(seed + i, j + 50) - 0.5) * 0.7; x += Math.cos(a) * s; y += Math.sin(a) * s; len += s; ctx.lineTo(x, y); j++;
      if (R(seed + i, j + 90) < 0.25) { ctx.moveTo(x, y); const b = a + (R(seed, j) - 0.5) * 2; ctx.lineTo(x + Math.cos(b) * 80, y + Math.sin(b) * 80); ctx.moveTo(x, y); } }
    ctx.stroke();
  }
  // 同心環
  ctx.lineWidth = lw * 0.6; ctx.beginPath();
  for (let r = 1; r <= 3; r++) { const rr = r * 150 * grow; for (let k = 0; k <= 14; k++) { const a = k / 14 * Math.PI * 2; const q = rr * (0.85 + R(seed + r, k) * 0.3); k ? ctx.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q) : ctx.moveTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); } }
  ctx.stroke(); ctx.restore();
}
function speedLines(ctx, cx, cy, n, inner, col, seed, rot = 0, wmul = 1) {
  ctx.save(); ctx.fillStyle = col; ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i + R(seed, i) * 0.6) / n * Math.PI * 2; const w = (0.004 + R(seed, i + 300) * 0.012) * wmul;
    const r0 = inner * (0.7 + R(seed, i + 600) * 0.8), r1 = 2400;
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a - w) * r1, cy + Math.sin(a - w) * r1);
    ctx.lineTo(cx + Math.cos(a + w) * r1, cy + Math.sin(a + w) * r1);
  }
  ctx.fill(); ctx.restore();
}
function star4(ctx, x, y, r, col, a = 1) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = col; ctx.translate(x, y); ctx.beginPath();
  for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.16 : r; const an = i / 8 * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
  ctx.fill(); ctx.restore();
}
function flash(ctx, a, col = '#fff') { if (a <= 0) return; ctx.save(); ctx.globalAlpha = clamp(a); ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.restore(); }

// ---------- 場景 ----------
// A：預告（紅色海平線＋鏡頭光暈）
function sceneTeaser(ctx, t) {
  const k = lin(t, 0, 0.62);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#12020a'); bg.addColorStop(0.52, '#3a0613'); bg.addColorStop(0.56, '#200308'); bg.addColorStop(1, '#070003');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const hy = 590 - k * 30;
  // 水面反光條紋
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) { const y = hy + 12 + Math.pow(i / 26, 1.6) * 480; const w = 900 * (1 - i / 30) * (0.6 + R(i, 1) * 0.6);
    ctx.fillStyle = `rgba(255,${60 + R(i, 2) * 60 | 0},70,${0.18 * (1 - i / 26)})`; ctx.fillRect(CX - w / 2 + (R(i, 3) - 0.5) * 300 + Math.sin(t * 6 + i) * 20, y, w, 2 + i * 0.25); }
  // 地平線光
  let gr = ctx.createRadialGradient(CX, hy, 0, CX, hy, 900); gr.addColorStop(0, 'rgba(255,90,90,0.9)'); gr.addColorStop(0.15, 'rgba(255,40,60,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,200,190,0.95)'; ctx.fillRect(0, hy - 1.5, W, 3);
  // 橫向光暈
  const sx = CX + 220 - k * 160;
  gr = ctx.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(255,60,90,0)'); gr.addColorStop(sx / W, 'rgba(255,230,230,0.9)'); gr.addColorStop(1, 'rgba(255,60,90,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, hy - 5, W, 10);
  gr = ctx.createRadialGradient(sx, hy, 0, sx, hy, 160); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,150,170,0.5)'); gr.addColorStop(1, 'rgba(255,0,60,0)');
  ctx.fillStyle = gr; ctx.fillRect(sx - 160, hy - 160, 320, 320);
  for (let i = 0; i < 5; i++) { const gx = sx + (CX - sx) * (0.6 + i * 0.5), gy = hy + (i - 2) * 6; ctx.fillStyle = `rgba(255,${120 + i * 20},${150 + i * 10},0.08)`; ctx.beginPath(); ctx.arc(gx, gy, 20 + i * 14, 0, 7); ctx.fill(); }
  // 上升粒子
  for (let i = 0; i < 70; i++) { const life = (t * (0.4 + R(i, 4) * 0.5) + R(i, 5)) % 1; const x = R(i, 6) * W + Math.sin(life * 5 + i) * 30; const y = hy + 200 - life * 700 * (0.5 + R(i, 7));
    const a = Math.sin(life * Math.PI) * 0.8; ctx.fillStyle = `rgba(255,${150 + R(i, 8) * 100 | 0},160,${a})`; ctx.beginPath(); ctx.arc(x, y, 1 + R(i, 9) * 2.5, 0, 7); ctx.fill(); }
  ctx.restore();
  flash(ctx, (1 - lin(t, 0, 0.12)) * 0.75, '#ff5a8c');     // 開場粉紅一閃
  flash(ctx, ei(lin(t, 0.4, 0.66)), '#000');               // 淡出到黑
}
// B：全黑吊胃口，最後中央一點星光
function sceneBlack(ctx, t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const k = lin(t, 1.12, 1.3);
  if (k > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const r = 10 + ei(k) * 260; star4(ctx, CX, CY, r, '#bff6ff', 0.9); star4(ctx, CX, CY, r * 0.4, '#fff', 1);
    const gr = ctx.createRadialGradient(CX, CY, 0, CX, CY, r * 0.6); gr.addColorStop(0, 'rgba(160,240,255,0.8)'); gr.addColorStop(1, 'rgba(0,120,255,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}
// C：青色集中線爆發＋金色火花
function sceneBurst(ctx, t) {
  const k = lin(t, 1.3, 1.62);
  const bg = ctx.createRadialGradient(CX, CY, 0, CX, CY, 1200); bg.addColorStop(0, '#e8fdff'); bg.addColorStop(0.18, '#38d6ff'); bg.addColorStop(0.55, '#0750c8'); bg.addColorStop(1, '#020a3a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const f = Math.floor(t * 60 / 2);   // 每 2 格換一組線
  speedLines(ctx, CX, CY, 110, 140 + k * 120, 'rgba(255,255,255,0.9)', f, k * 0.3);
  speedLines(ctx, CX, CY, 60, 380, 'rgba(0,20,90,0.55)', f + 99, 0.05);
  // 金色火花劃過
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) { const s = lin(t, 1.38 + R(i, 1) * 0.12, 1.56 + R(i, 1) * 0.12); if (s <= 0 || s >= 1) continue;
    const a = -0.5 + R(i, 2) * 0.35, y0 = R(i, 3) * H; const x = -300 + eo(s) * (W + 600), y = y0 - Math.tan(a) * x * 0.4;
    const gr = ctx.createLinearGradient(x - 420, y, x, y); gr.addColorStop(0, 'rgba(255,170,40,0)'); gr.addColorStop(1, 'rgba(255,240,180,1)');
    ctx.strokeStyle = gr; ctx.lineWidth = 3 + R(i, 4) * 5; ctx.beginPath(); ctx.moveTo(x - 420, y + Math.tan(a) * 168); ctx.lineTo(x, y); ctx.stroke(); }
  ctx.restore();
  flash(ctx, (1 - lin(t, 1.3, 1.4)) * 0.8);
}
// D：角色登場蒙太奇（黑白高反差、切片、裂痕、套色）
const CUTS = [
  { t: 1.62, kind: 'full', img: 'bw', rot: -0.1, inv: false },
  { t: 1.76, kind: 'face', img: 'cyan', z: 1.25 },
  { t: 1.88, kind: 'full', img: 'inv', rot: 0.06, crack: true },
  { t: 2.0, kind: 'splash' },
  { t: 2.12, kind: 'face', img: 'gold', z: 0.75, rot: -0.12 },
  { t: 2.26, kind: 'full', img: 'bw', rot: 0.0, shards: true, z: 1.5 },
  { t: 2.42, kind: 'face', img: 'bw', z: 1.5, glitch: true },
  { t: 2.56, kind: 'full', img: 'color', rot: -0.05, rgb: true },
  { t: 2.7, kind: 'face', img: 'inv', z: 1.0, crack: true },
];
function sceneMontage(ctx, t) {
  let ci = 0; for (let i = 0; i < CUTS.length; i++) if (t >= CUTS[i].t) ci = i;
  const c = CUTS[ci], lt = t - c.t, f = Math.floor(t * 60);
  const pick = (k) => ({ bw: GIRL_BW, inv: GIRL_INV, cyan: GIRL_CY, gold: GIRL_GD, color: GIRL })[k];
  bctx.clearRect(0, 0, W, H);
  const dark = c.img !== 'inv';
  bctx.fillStyle = dark ? '#000' : '#fff'; bctx.fillRect(0, 0, W, H);
  if (c.kind === 'splash') {
    // 白色墨爆＋黑色剪影
    bctx.fillStyle = '#fff';
    for (let i = 0; i < 26; i++) { const a = R(i, 1) * 7, d = eo5(lin(lt, 0, 0.1)) * (150 + R(i, 2) * 650); const r = (30 + R(i, 3) * 110) * (1 - lin(lt, 0.05, 0.14) * 0.5);
      bctx.beginPath(); bctx.arc(CX + Math.cos(a) * d, CY + Math.sin(a) * d * 0.7, r, 0, 7); bctx.fill(); }
    bctx.beginPath(); bctx.arc(CX, CY, 260 + eo(lin(lt, 0, 0.12)) * 200, 0, 7); bctx.fill();
    drawImg(bctx, GIRL_SIL ? silhouette(GIRL_SIL, '#000') : null, CX, CY + 60, H * 1.25 + lt * 300, 0.04);
  } else if (c.kind === 'full') {
    const z = (c.z || 1.05) + lt * 0.6;
    drawImg(bctx, pick(c.img), CX + (c.z ? 0 : 160), CY + (c.z ? H * 0.3 : 40), H * z, c.rot + lt * 0.15);
    if (c.shards) { bctx.save(); bctx.fillStyle = '#fff'; bctx.globalCompositeOperation = 'difference';
      for (let i = 0; i < 6; i++) { const x = R(i, 1) * W, w = 40 + R(i, 2) * 200; bctx.beginPath(); bctx.moveTo(x, 0); bctx.lineTo(x + w, 0); bctx.lineTo(x + w - 600, H); bctx.lineTo(x - 600 + w * 0.3, H); bctx.fill(); }
      bctx.restore(); }
  } else {
    drawFace(bctx, pick(c.img), c.z + lt * 0.5, 0, 0, (c.rot || 0) + lt * 0.1);
  }
  if (c.crack) cracks(bctx, ci * 7, CX + 120, CY - 40, eo5(lin(lt, 0, 0.08)), dark ? '#fff' : '#000', 4);
  // 輸出到主畫面：切片位移／RGB 分離
  const amt = (c.glitch || c.rgb ? 220 : 70) * (1 - lin(lt, 0, 0.1) * 0.6);
  bctx.save(); ctx.drawImage(buf, 0, 0); bctx.restore();
  if (f % 3 !== 0 || c.glitch) { ctx.fillStyle = dark ? '#000' : '#fff'; ctx.fillRect(0, 0, W, H); sliceShift(ctx, buf, t, amt, f); }
  if (c.rgb || c.glitch) { const tmp = mk(); tmp.getContext('2d').drawImage(cv, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); rgbSplit(ctx, tmp, 14); }
  // 掃描線雜訊
  ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = dark ? '#fff' : '#000';
  for (let i = 0; i < 8; i++) ctx.fillRect(0, R(f, i) * H, W, 1 + R(f, i + 9) * 3); ctx.restore();
  // 切點的一格反白（低強度，避免頻閃）
  if (lt < 1 / 60 && (ci === 0 || ci === 6)) flash(ctx, 0.3, dark ? '#fff' : '#000');
  // 結尾白閃
  flash(ctx, eo(lin(t, 2.8, 2.88)) * 0.9);
}
// E：霓虹雷射（快速頻閃、每拍換色、快速掃動）
function sceneLaser(ctx, t) {
  const k = lin(t, 2.88, 3.55), beat = Math.floor((t - 2.88) / 0.0625);
  ctx.fillStyle = beat % 2 ? '#07001a' : '#100022'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const N = 26;
  for (let i = 0; i < N; i++) {
    if (R(Math.floor(t * 30), i + 5) < 0.35) continue;            // 每 2 格隨機熄燈＝頻閃
    const side = i % 3; const ox = side === 0 ? -200 : side === 1 ? W + 200 : CX + (R(i, 9) - 0.5) * 1400; const oy = side === 2 ? -150 : (R(i, 1) * 0.7 + 0.15) * H;
    const base = side === 0 ? 0 : side === 1 ? Math.PI : Math.PI / 2;
    const a = base + (R(i, 2) - 0.5) * 1.2 + Math.sin(t * (12 + R(i, 3) * 10) + i * 1.7) * 0.55;
    const hue = (i * 47 + beat * 97) % 360; const ex = ox + Math.cos(a) * 3200, ey = oy + Math.sin(a) * 3200;
    const on = eo5(lin(t, 2.88 + R(i, 4) * 0.18, 2.92 + R(i, 4) * 0.18));
    if (on <= 0) continue;
    const X1 = ox + (ex - ox) * on, Y1 = oy + (ey - oy) * on;
    for (const [dx, col, w] of [[-8, `hsla(${hue},100%,55%,0.55)`, 18], [8, `hsla(${(hue + 70) % 360},100%,55%,0.55)`, 18]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(ox + dx, oy); ctx.lineTo(X1 + dx, Y1); ctx.stroke(); }
    ctx.strokeStyle = `hsla(${hue},100%,94%,1)`; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(X1, Y1); ctx.stroke();
  }
  // 網格隨拍子往前衝
  ctx.strokeStyle = `hsla(${(beat * 60) % 360},100%,65%,0.5)`; ctx.lineWidth = 3;
  for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(CX + i * 40, 620); ctx.lineTo(CX + i * 460, H + 40); ctx.stroke(); }
  for (let j = 0; j < 10; j++) { const y = 620 + Math.pow(((j + t * 22) % 10) / 10, 2) * 500; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // 中央光核每拍脈衝
  const pulse = Math.exp(-((t - 2.88) % 0.125) * 30);
  let gr = ctx.createRadialGradient(CX, CY, 0, CX, CY, 260 + pulse * 260); gr.addColorStop(0, `rgba(255,255,255,${0.35 + pulse * 0.5})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  star4(ctx, CX, CY, 200 + pulse * 300, '#fff', 0.5 + pulse * 0.5);
  gr = ctx.createRadialGradient(CX, CY, 0, CX, CY, 700 + k * 900); gr.addColorStop(0, `rgba(255,255,255,${ei(k) * 0.9})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  ctx.restore();
  flash(ctx, (1 - lin(t, 2.88, 3.0)) * 0.85);
}
// F：墨爆（白底黑墨 → 白色爆光）
function sceneInk(ctx, t) {
  const k = lin(t, 3.55, 3.82);
  ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  for (let i = 0; i < 40; i++) { const a = R(i, 1) * 7; const d = eo5(k) * (100 + R(i, 2) * 1000); const r = (20 + R(i, 3) * 150) * (0.4 + eo(k));
    ctx.beginPath(); ctx.arc(CX + Math.cos(a) * d, CY + Math.sin(a) * d * 0.75, r, 0, 7); ctx.fill();
    ctx.lineWidth = 3 + R(i, 4) * 10; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(CX + Math.cos(a) * d * 1.3, CY + Math.sin(a) * d * 0.95); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(CX, CY, 120 + eo5(k) * 520, 0, 7); ctx.fill();
  if (GIRL_SIL) drawImg(ctx, silhouette(GIRL_SIL, '#fff'), CX + 40, CY + 140, H * (1.0 + k * 0.3), 0.05 - k * 0.05);
  const b = lin(t, 3.74, 3.86);
  if (b > 0) { const gr = ctx.createRadialGradient(CX, CY, 0, CX, CY, 100 + eo(b) * 1300); gr.addColorStop(0, '#fff'); gr.addColorStop(0.7, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
}
// G：主畫面（虹彩放射背景＋大字＋角色＋吉祥物）
function rainbowBG(ctx, t) {
  const bg = ctx.createRadialGradient(560, 470, 0, 560, 470, 1500);
  bg.addColorStop(0, '#fffbe0'); bg.addColorStop(0.12, '#ffe14a'); bg.addColorStop(0.35, '#ff5aa5'); bg.addColorStop(0.62, '#7a3cff'); bg.addColorStop(1, '#10073a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.filter = 'blur(18px)';
  const n = 36, rot = t * 0.35;
  for (let i = 0; i < n; i++) { ctx.fillStyle = `hsla(${(i * 360 / n + t * 120) % 360},100%,62%,${i % 2 ? 0.75 : 0.3})`;
    const a0 = rot + i / n * Math.PI * 2, a1 = a0 + Math.PI / n;
    ctx.beginPath(); ctx.moveTo(560, 470); ctx.lineTo(560 + Math.cos(a0) * 2600, 470 + Math.sin(a0) * 2600); ctx.lineTo(560 + Math.cos(a1) * 2600, 470 + Math.sin(a1) * 2600); ctx.fill(); }
  ctx.restore();
  speedLines(ctx, 560, 470, 90, 520, 'rgba(255,255,255,0.55)', Math.floor(t * 30), 0, 0.7);
  // 閃爍星點
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) { const ph = (t * (1.2 + R(i, 1)) + R(i, 2)) % 1; const s = Math.sin(ph * Math.PI);
    star4(ctx, R(i, 3) * W, R(i, 4) * H, 10 + s * (16 + R(i, 5) * 34), i % 3 ? '#fff' : '#fff2a8', s * 0.9); }
  ctx.restore();
}
function rainbowFill(ctx, y0, y1, t) {
  const gr = ctx.createLinearGradient(0, y0, 0, y1);
  const hs = [0, 35, 58, 130, 195, 270, 320]; const sh = t * 60;
  hs.forEach((h, i) => gr.addColorStop(i / (hs.length - 1), `hsl(${(h + sh) % 360},100%,${i === 2 ? 58 : 60}%)`));
  return gr;
}
function titleText(ctx, t, x, y, s, rot) {
  const txt = CFG.title; const pal = PAL[CFG.pal];
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = "200px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  // 外發光＋深色厚邊
  ctx.shadowColor = pal.glow; ctx.shadowBlur = 40;
  ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 56; ctx.strokeText(txt, 0, 0);
  ctx.shadowBlur = 0;
  // 金邊
  const gold = ctx.createLinearGradient(0, -110, 0, 110); gold.addColorStop(0, '#fff6c0'); gold.addColorStop(0.45, '#ffb21a'); gold.addColorStop(0.55, '#c76a00'); gold.addColorStop(1, '#ffe27a');
  ctx.strokeStyle = gold; ctx.lineWidth = 34; ctx.strokeText(txt, 0, 0);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.strokeText(txt, 0, 0);
  // 虹彩填色
  ctx.fillStyle = palFill(ctx, -95, 95, t, pal); ctx.fillText(txt, 0, 0);
  // 上半高光
  ctx.save(); ctx.beginPath(); ctx.rect(-2000, -120, 4000, 95); ctx.clip();
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillText(txt, 0, 0); ctx.restore();
  // 掃光
  const sw = ((t - 4.0) * 0.9) % 1.6; if (sw > 0 && sw < 1) { ctx.save(); ctx.globalCompositeOperation = 'source-atop';
    const gx = -900 + sw * 1800; const gr = ctx.createLinearGradient(gx - 120, 0, gx + 120, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillText(txt, 0, 0); ctx.restore(); }
  ctx.restore();
}
function subLine(ctx, t, a, X = 800, Y = 750, SC = 1.25) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(X, Y); ctx.rotate(-0.06); ctx.scale(SC, SC);
  // 底帶
  ctx.fillStyle = '#1a0838'; ctx.beginPath(); ctx.moveTo(-470, -80); ctx.lineTo(470, -96); ctx.lineTo(450, 86); ctx.lineTo(-490, 98); ctx.fill();
  ctx.fillStyle = '#ffe14a'; ctx.fillRect(-470, 82, 920, 8);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.font = "900 46px 'Noto Sans TC'"; ctx.fillStyle = '#fff'; ctx.fillText(CFG.sub1, 0, -42);
  ctx.font = "900 80px 'Noto Sans TC'"; ctx.strokeStyle = '#fff'; ctx.lineWidth = 16; ctx.strokeText(CFG.sub2, 0, 40);
  const ag = ctx.createLinearGradient(0, -6, 0, 74); ag.addColorStop(0, '#fff3a0'); ag.addColorStop(0.5, '#ffb21a'); ag.addColorStop(0.52, '#ff7a00'); ag.addColorStop(1, '#ff3d8b');
  ctx.fillStyle = ag; ctx.fillText(CFG.sub2, 0, 40);
  ctx.restore();
}
function neonOutline(ctx, img, cx, cy, h, t, rot = 0) {
  if (!img) return;
  const sil = silhouette(img, `hsl(${(t * 500) % 360},100%,60%)`);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; drawImg(ctx, sil, cx + Math.cos(a) * 12, cy + Math.sin(a) * 12, h, rot); }
  const sil2 = silhouette(img, '#fff');
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; drawImg(ctx, sil2, cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, h, rot); }
}
function slash(ctx, t) {   // 漫畫斬擊
  const k = lin(t, 3.9, 4.18); if (k <= 0 || k >= 1) return;
  ctx.save(); ctx.translate(730, 420); ctx.rotate(-0.35); ctx.scale(1.3, 1.3);
  const a1 = -Math.PI * 0.95 + eo5(k) * Math.PI * 1.15, a0 = a1 - 1.6 * (1 - ei(k));
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#ffb21a'; ctx.shadowBlur = 30; ctx.beginPath();
  ctx.ellipse(0, 0, 700, 240, 0, a0, a1); ctx.ellipse(0, 10, 640, 190, 0, a1, a0, true); ctx.fill();
  ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) { const a = a0 + (a1 - a0) * R(i, 1); const x = Math.cos(a) * 690, y = Math.sin(a) * 230; const d = 30 + R(i, 2) * 90 * k;
    ctx.strokeStyle = i % 2 ? '#ffd23a' : '#ff7a1a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a + 1.6) * d, y + Math.sin(a + 1.6) * d); ctx.stroke(); }
  ctx.restore();
}
// G 用：拍點／衝擊
const T_HIT = 3.86, BEAT = 0.2;
let IMPACTS = [];
function buildImpacts(end) { IMPACTS = [[3.86, 1], [4.42, 0.7]]; if (CFG.mascot) IMPACTS.push([4.85, 0.5]); for (let b = 5.06; b < end; b += 0.4) IMPACTS.push([b, 0.35 * CFG.power]); }
function punch(t) { let s = 0; for (const [ti, a] of IMPACTS) if (t >= ti) s += a * Math.exp(-(t - ti) * 14); return s; }
function hotBG(ctx, t) {   // 激熱紅金放射（跟虹彩每 0.4 秒交替）
  const bg = ctx.createRadialGradient(730, 420, 0, 730, 420, 1500);
  bg.addColorStop(0, '#fffde8'); bg.addColorStop(0.12, '#ffd21a'); bg.addColorStop(0.4, '#ff6a00'); bg.addColorStop(0.7, '#c4002a'); bg.addColorStop(1, '#3a0010');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.filter = 'blur(16px)'; const n = 28, rot = -t * 1.1;
  for (let i = 0; i < n; i += 2) { ctx.fillStyle = 'rgba(255,240,150,0.35)'; const a0 = rot + i / n * Math.PI * 2, a1 = a0 + Math.PI / n;
    ctx.beginPath(); ctx.moveTo(730, 420); ctx.lineTo(730 + Math.cos(a0) * 2600, 420 + Math.sin(a0) * 2600); ctx.lineTo(730 + Math.cos(a1) * 2600, 420 + Math.sin(a1) * 2600); ctx.fill(); }
  ctx.restore();
  speedLines(ctx, 730, 420, 100, 480, 'rgba(255,255,255,0.6)', Math.floor(t * 30), 0, 0.7);
}
function ledFrame(ctx, t) {   // 機台邊框跑馬燈
  const per = 2 * (W + H), n = 96, sp = 46;
  ctx.save();
  ctx.fillStyle = 'rgba(20,0,30,0.85)';
  ctx.fillRect(0, 0, W, sp); ctx.fillRect(0, H - sp, W, sp); ctx.fillRect(0, 0, sp, H); ctx.fillRect(W - sp, 0, sp, H);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per; let x, y;
    if (d < W) { x = d; y = sp / 2; } else if ((d -= W) < H) { x = W - sp / 2; y = d; } else if ((d -= H) < W) { x = W - d; y = H - sp / 2; } else { d -= W; x = sp / 2; y = H - d; }
    const chase = ((i - t * 40) % 8 + 8) % 8; const on = chase < 3 ? 1 : 0.25;
    const hue = (i * 15 + t * 600) % 360;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 26); gr.addColorStop(0, `hsla(${hue},100%,${on > 0.5 ? 90 : 60}%,${on})`); gr.addColorStop(1, `hsla(${hue},100%,50%,0)`);
    ctx.fillStyle = gr; ctx.fillRect(x - 26, y - 26, 52, 52);
  }
  ctx.restore();
}
function tickerBand(ctx, t, y, dir) {
  ctx.save(); ctx.translate(CX, y);
  const g2 = ctx.createLinearGradient(0, -40, 0, 40); g2.addColorStop(0, '#ff2a4a'); g2.addColorStop(0.5, '#b8001e'); g2.addColorStop(1, '#ff2a4a');
  if (CFG.pal === 'gold' || CFG.pal === 'premium') { g2.addColorStop(0, '#ffcf3a'); } ctx.fillStyle = g2; ctx.fillRect(-1400, -40, 2800, 80);
  ctx.fillStyle = '#ffe14a'; ctx.fillRect(-1400, -44, 2800, 5); ctx.fillRect(-1400, 39, 2800, 5);
  ctx.font = "50px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff6c0';
  const unit = ctx.measureText(CFG.ticker).width + 70, off = ((t * 900 * dir) % unit + unit) % unit;
  for (let x = -1400 - unit + off; x < 1400; x += unit) ctx.fillText(CFG.ticker, x, 3);
  ctx.restore();
}
function coins(ctx, t) {   // 衝擊時從大字噴出的金色碎片
  const lt = t - T_HIT; if (lt < 0 || lt > 1.6) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < CFG.coins; i++) { const a = R(i, 1) * Math.PI * 2, v = 900 + R(i, 2) * 1800;
    const x = 730 + Math.cos(a) * v * lt, y = 420 + Math.sin(a) * v * lt * 0.8 + 1400 * lt * lt;
    const s = 6 + R(i, 3) * 14, al = 1 - lt / 1.6, sp = Math.cos(lt * 20 + i);
    ctx.fillStyle = i % 3 ? `rgba(255,${200 + R(i, 4) * 55 | 0},60,${al})` : `rgba(255,255,255,${al})`;
    ctx.beginPath(); ctx.ellipse(x, y, s * Math.abs(sp) + 1, s, a, 0, 7); ctx.fill(); }
  ctx.restore();
}
function shockRings(ctx, t) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [ti, a] of IMPACTS) { const lt = t - ti; if (lt < 0 || lt > 0.35) continue; const p = lt / 0.35;
    ctx.strokeStyle = `rgba(255,255,220,${(1 - p) * a})`; ctx.lineWidth = 40 * (1 - p) + 2;
    ctx.beginPath(); ctx.ellipse(730, 420, 200 + eo(p) * 1400, 120 + eo(p) * 900, -0.08, 0, 7); ctx.stroke(); }
  ctx.restore();
}
function sceneMain(ctx, t) {
  const f = Math.floor(t * 60), pk = punch(t);
  const shake = (4 + pk * 34) * CFG.power;
  const jx = (R(f, 1) - 0.5) * shake, jy = (R(f, 2) - 0.5) * shake;
  ctx.save(); ctx.translate(CX + jx, CY + jy); const zs = 1 + pk * 0.07; ctx.scale(zs, zs); ctx.rotate((R(f, 3) - 0.5) * pk * 0.03); ctx.translate(-CX, -CY);
  const phase = Math.floor(Math.max(0, t - T_HIT) / 0.4) % 2;
  if (CFG.flip && phase === 1) hotBG(ctx, t); else palBG(ctx, t, PAL[CFG.pal]);
  shockRings(ctx, t);
  // 角色從右邊衝進來（帶彩色殘影）
  const gk = lin(t, 4.12, 4.42), gx = 1500 + (1 - eo5(gk)) * 900, gy = 820 + (1 - eo(gk)) * 60;
  const gh = 1700 + Math.sin(t * 3) * 12 + pk * 40;
  if (gk > 0) {
    if (CFG.power > 0.6 && gk < 1 && GIRL_SIL) for (let k = 1; k <= 4; k++) drawImg(ctx, silhouette(GIRL_SIL, `hsl(${k * 70},100%,60%)`), gx + k * 90 * (1 - gk), gy, gh, 0.04, 0.35);
    neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, 0.04); drawImg(ctx, GIRL, gx, gy, gh, 0.04); }
  coins(ctx, t);
  // 大字＋每拍殘影
  const tk = lin(t, 3.86, 4.06);
  if (tk > 0) {
    const s = tk < 1 ? 2.6 - 1.6 * eback(tk, 1.4) : 1 + pk * 0.08;
    if (CFG.echo && t > 4.06) { const bp = ((t - T_HIT) % BEAT) / BEAT; ctx.save(); ctx.globalAlpha = (1 - bp) * 0.45; titleText(ctx, t, 730, 420, 1.3 * (1 + bp * 0.35), -0.08); ctx.restore(); }
    titleText(ctx, t, 730, 420, s * 1.3, -0.08); }
  subLine(ctx, t, eo(lin(t, 4.35, 4.55)));
  const mk2 = lin(t, 4.55, 4.85);
  if (CFG.mascot && MASCOT && mk2 > 0) { const s = eback(mk2, 2.6) * (1 + pk * 0.06); const bob = Math.abs(Math.sin(t * 15.7)) * -26;
    const mr = -0.1 + Math.sin(t * 15.7) * 0.08;
    neonOutline(ctx, MASCOT_SIL, 245, 850 + bob, 470 * s, t + 0.3, mr); drawImg(ctx, MASCOT, 245, 850 + bob, 470 * s, mr); }
  if (CFG.slash) slash(ctx, t);
  if (CFG.extra) CFG.extra(ctx, t, pk);
  ctx.restore();
  if (CFG.ticker && t > 4.2) { const e = 1 - eo5(lin(t, 4.2, 4.4)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  if (CFG.led) ledFrame(ctx, t);
  flash(ctx, (1 - lin(t, 3.84, 3.98)) * 0.9);
  if (t >= 4.42) flash(ctx, (1 - lin(t, 4.42, 4.52)) * 0.4, '#ffe680');   // 角色落地的金色閃
  if (CFG.mascot && t >= 4.85) flash(ctx, (1 - lin(t, 4.85, 4.93)) * 0.3, '#ff9ad0');
}
// H：錄影帶式訊號崩壞退場
function sceneExit(ctx, t) {
  const k = lin(t, 6.05, 6.75);
  bctx.setTransform(1, 0, 0, 1, 0, 0); sceneMain(bctx, t + XS);
  ctx.clearRect(0, 0, W, H);
  const f = Math.floor(t * 60);
  let y = 0, i = 0;
  while (y < H) { const hh = 6 + R(f + i, 1) * 50; const smear = ei(k) * (300 + R(f + i, 2) * 1500) * (R(f + i, 3) < 0.6 ? 1 : 0.2);
    const sx = (R(f + i, 4) - 0.5) * 400 * k;
    ctx.globalAlpha = 1 - ei(lin(t, 6.4, 6.78));
    ctx.drawImage(buf, 0, y, W, hh, sx - smear * 0.5, y, W + smear, hh); y += hh; i++; }
  ctx.globalAlpha = 1;
  if (k > 0.1) { const tmp = mk(); tmp.getContext('2d').drawImage(cv, 0, 0); ctx.clearRect(0, 0, W, H); rgbSplit(ctx, tmp, 10 + k * 40); }
  ctx.save(); ctx.globalAlpha = 0.25 * k; ctx.fillStyle = '#fff';
  for (let j = 0; j < 30; j++) ctx.fillRect(R(f, j) * W, R(f, j + 40) * H, 40 + R(f, j + 80) * 300, 2); ctx.restore();
}

