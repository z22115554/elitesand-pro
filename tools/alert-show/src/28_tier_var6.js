
// ======================= 第六批：贈訂頂級（g100） =======================
function bustSafe(ctx, x, y, r, t) {   // 彩虹／頂級配色沒有 drawBust 要的色票，畫頭像時暫借金色
  const keep = CFG.pal; if (!PAL[keep] || !PAL[keep].fill) CFG.pal = 'gold'; try { drawBust(ctx, x, y, r, t); } finally { CFG.pal = keep; }
}
function fakeNotice(ctx, t) {   // 開頭的「普通小通知」（之後被倒帶）
  const k = eo5(lin(t, 0, 0.3)); ctx.save(); ctx.translate(-700 * (1 - k), 0); ctx.fillStyle = 'rgba(20,16,36,0.92)'; ctx.beginPath(); ctx.roundRect(90, 790, 700, 170, 26); ctx.fill(); ctx.strokeStyle = '#8a7ad8'; ctx.lineWidth = 4; ctx.stroke();
  bustSafe(ctx, 190, 875, 62, t); ctx.font = "900 44px 'Noto Sans TC'"; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(P.name, 280, 850, 480); ctx.font = "700 32px 'Noto Sans TC'"; ctx.fillStyle = '#c8c0f0'; ctx.fillText(LX('notice1'), 280, 905, 480); ctx.restore();
}
let CLOCK_FACE = null, CLOCK_HOUR = null, CLOCK_MIN = null;
const CLOCK_GEO = { cx: 0.5, cy: 0.503, hour: [0.456, 0.864, 0.3], min: [0.46, 0.898, 0.42] };   // 鐘面中心；指針軸心位置與長度（鐘面高比例）
const _lvaBase8 = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaBase8();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  CLOCK_FACE = await L2('DEF_CLOCK_FACE', 'clock_face.png'); CLOCK_HOUR = await L2('DEF_CLOCK_HOUR', 'clock_hour.png'); CLOCK_MIN = await L2('DEF_CLOCK_MIN', 'clock_min.png');
};
function premiumEnd(ctx, t, l, out, girl = {}) {   // 頂級共用收尾：彩虹背景已畫好，這裡畫角色、翅膀、標題、份數、名字
  const gx = girl.x ?? 960, gy = girl.y ?? 600, gh = girl.h ?? 860;
  const gk = lin(l, 0.1, 0.55); if (GIRL && gk > 0) { const k = eback(gk, 1.4); ctx.save(); ctx.globalAlpha = 1 - out; wings(ctx, t, gx, gy - gh * 0.12, eo(gk), 1); ctx.translate(gx, gy); ctx.scale(k, k); neonOutline(ctx, GIRL_SIL, 0, 0, gh, t, 0); drawImg(ctx, GIRL, 0, 0, gh, 0); ctx.restore(); }
  const tk = lin(l, 0.5, 0.7); if (tk > 0) { const s = tk < 1 ? 2 - eback(tk, 1.6) : 1 + Math.sin(t * 5) * 0.02; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(girl.tx ?? 960, girl.ty ?? 930); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 150, PAL.gold, 'center'); ctx.restore(); }
  ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, girl.cx ?? 1560, girl.cy ?? 420, 210, lin(l, 0.7, 0.9)); ctx.restore();
  nameAt(ctx, girl.nx ?? 960, girl.ny ?? 1035, eo(lin(l, 0.85, 1.05)) * (1 - out), 42, '#1a0838');
}

// ---------------- 頂級 1：時間逆轉 ----------------
const TR_T = { freeze: 0.5, rew: 0.9, slow: 3.0, stop: 3.6, burst: 3.9 };
function vRewind(ctx, t) {
  if (!CLOCK_FACE) return;
  const D = CFG.dur, T = TR_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.25)), done = t >= T.burst;
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  if (!done) {
    // 先是一張普通的小卡通知，然後畫面凍結、倒帶
    if (t < T.rew) { ctx.fillStyle = '#16122a'; ctx.fillRect(0, 0, W, H); fakeNotice(ctx, Math.min(t, T.freeze)); if (t > T.freeze) { ctx.fillStyle = `rgba(20,10,40,${0.6 * lin(t, T.freeze, T.rew)})`; ctx.fillRect(0, 0, W, H); } }
    else { const g = ctx.createRadialGradient(960, 540, 0, 960, 540, 1200); g.addColorStop(0, '#3a2a7a'); g.addColorStop(1, '#06031a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // 時間粒子往中心吸
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 90; i++) { const a = R(i, 1) * 7 - t * (0.6 + R(i, 2)), q = (R(i, 3) + t * 0.6) % 1, r = 1100 * (1 - q); ctx.fillStyle = `rgba(200,220,255,${0.7 * q})`; ctx.fillRect(960 + Math.cos(a) * r, 540 + Math.sin(a) * r * 0.7, 4, 4); } ctx.restore();
      // 背景大羅馬數字環倒轉
      ctx.save(); ctx.translate(960, 540); ctx.rotate(-t * 1.4 * lin(t, T.rew, T.rew + 0.5)); ctx.font = "700 90px 'Noto Serif', serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(200,190,255,0.18)';
      ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((n, i) => { ctx.save(); ctx.rotate(i * Math.PI / 6); ctx.fillText(n, 0, -760); ctx.restore(); }); ctx.restore(); }
    // VHS 倒帶介面
    if (t > T.freeze) { const k = lin(t, T.freeze, T.freeze + 0.1); hudText(ctx, '◀◀ REWIND', 90, 90, 54, '#ffffff', 'left', k * (Math.floor(t * 3) % 2 ? 1 : 0.6));
      ctx.save(); ctx.globalAlpha = 0.5 * k; for (let i = 0; i < 3; i++) { const y = (t * 900 + i * 380) % (H + 100) - 50; ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, y, W, 14 + i * 6); } ctx.restore(); }
  } else { palBG(ctx, t, PAL.premium, 960, 500); }
  ctx.restore();
  // 大時鐘：倒轉越來越快，再急停在 XII
  if (t > T.rew - 0.1 && t < T.burst + 0.6) {
    const ck = eback(lin(t, T.rew - 0.1, T.rew + 0.35), 1.4), size = 760 * ck * (done ? 1 + 2.5 * eo(lin(t, T.burst, T.burst + 0.6)) : 1), ca = done ? 1 - lin(t, T.burst, T.burst + 0.6) : 1;
    const cw = CLOCK_FACE.width * size / CLOCK_FACE.height, cx = 960, cy = 540;
    let spin = 0; if (t > T.rew) { const u = lin(t, T.rew, T.slow); spin = -(u * u * 22 * Math.PI); if (t > T.slow) { const v = eo5(lin(t, T.slow, T.stop)); spin = -(22 * Math.PI) - v * 2 * Math.PI; } }
    const shake = t > T.rew && t < T.stop ? lin(t, T.rew, T.slow) * 8 : 0;
    ctx.save(); ctx.globalAlpha = ca * (1 - out); ctx.translate(cx + (R(Math.floor(t * 60), 4) - 0.5) * shake, cy + (R(Math.floor(t * 60), 5) - 0.5) * shake);
    ctx.drawImage(CLOCK_FACE, -cw * CLOCK_GEO.cx, -size * CLOCK_GEO.cy, cw, size);
    for (const [img, g, mul, ghost] of [[CLOCK_HOUR, CLOCK_GEO.hour, 1 / 12, 0], [CLOCK_MIN, CLOCK_GEO.min, 1, 1]]) {
      const hl = size * g[2] / (1 - (1 - g[1])), hh = size * g[2] / g[1] * 1, hw = img.width * hh / img.height;
      const n = ghost && t > T.rew + 0.5 && t < T.stop ? 4 : 0;
      for (let k = n; k >= 0; k--) { ctx.save(); ctx.globalAlpha *= k ? 0.18 : 1; ctx.rotate(spin * mul + k * 0.12 * (t < T.slow ? 1 : 0)); ctx.drawImage(img, -hw * g[0], -hh * g[1], hw, hh); ctx.restore(); }
    }
    ctx.restore();
    if (t >= T.stop && t < T.burst) { const k = lin(t, T.stop, T.stop + 0.1); ctx.save(); ctx.translate(960, 980); ctx.scale(1.6 - 0.6 * k, 1.6 - 0.6 * k); smallTitle(ctx, t, '0:00', 0, 0, 110, PAL.sky, 'center'); ctx.restore(); }
  }
  if (done) {
    const l = t - T.burst;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960, 500, 18, 'rgba(255,255,255,0.2)', t * 0.4, 2000, 0.4, 16); ctx.restore();
    // 時鐘變成角色背後的光環
    const hk = eo(lin(l, 0.3, 0.8)); if (hk > 0) { const size = 900 * hk, cw = CLOCK_FACE.width * size / CLOCK_FACE.height; ctx.save(); ctx.globalAlpha = 0.85 * (1 - out); ctx.translate(960, 420); ctx.rotate(t * 0.2); ctx.drawImage(CLOCK_FACE, -cw / 2, -size / 2, cw, size); ctx.restore(); }
    fireworksAt(ctx, t, [[T.burst + 0.4, 300, 240, 30], [T.burst + 0.7, 1620, 220, 200], [T.burst + 1.0, 260, 520, 300], [T.burst + 1.3, 1660, 560, 120], [T.burst + 1.7, 960, 160, 60]]);
    coinFountain(ctx, t, T.burst, T.burst + 3.0, 180);
    premiumEnd(ctx, t, l, out, { y: 520, h: 760, ty: 955, cx: 1580, cy: 760, nx: 960, ny: 1042 });
    flash(ctx, (1 - lin(t, T.burst, T.burst + 0.25)) * 0.9, '#fff');
  }
}

// ---------------- 頂級 2：宇宙創世 ----------------
const CS_T = { beat: [0.5, 1.0, 1.4], bang: 1.75, galaxy: 2.4, form: 4.3 };
function vCosmos(ctx, t) {
  const D = CFG.dur, T = CS_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.2)), banged = t >= T.bang, formed = t >= T.form;
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  ctx.fillStyle = '#000005'; ctx.fillRect(0, 0, W, H);
  if (formed) { ctx.save(); ctx.globalAlpha *= lin(t, T.form, T.form + 0.5); palBG(ctx, t, PAL.premium, 960, 500); ctx.fillStyle = 'rgba(10,0,40,0.35)'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  // 創世前：一個光點心跳三下
  if (!banged) { let p = 0.3; T.beat.forEach((b) => { const l = t - b; if (l > 0) p += Math.exp(-l * 6) * 0.9; }); const r = 12 + 30 * p; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(960, 540, 0, 960, 540, r * 6); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,240,200,0.8)'); g.addColorStop(1, 'rgba(120,80,255,0)'); ctx.fillStyle = g; ctx.fillRect(960 - r * 6, 540 - r * 6, r * 12, r * 12); ctx.restore(); }
  ctx.restore();
  if (banged) {
    const l = t - T.bang;
    // 爆炸粒子 → 漸漸被捲成螺旋星系
    const sw = lin(t, T.galaxy, T.galaxy + 1.1);
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 1100; i++) {
      const arm = i % 3, rr = Math.pow(R(i, 1), 0.7), a0 = R(i, 2) * Math.PI * 2, d0 = Math.min(1, l * 1.6) * 1100 * R(i, 3);
      const ga = arm * Math.PI * 2 / 3 + rr * 5.5 - t * 0.5 + (R(i, 4) - 0.5) * 0.6 * (1 - rr * 0.4), gd = 50 + rr * 560 + (R(i, 6) - 0.5) * 70;
      const x0 = 960 + Math.cos(a0) * d0, y0 = 540 + Math.sin(a0) * d0 * 0.8, x1 = 960 + Math.cos(ga) * gd, y1 = 520 + Math.sin(ga) * gd * 0.45;
      const x = x0 + (x1 - x0) * eio2(sw), y = y0 + (y1 - y0) * eio2(sw), hue = (200 + arm * 70 + rr * 80 + t * 20) % 360, s = 3 + 5 * R(i, 5) * (1 - rr * 0.5);
      ctx.fillStyle = `hsla(${hue},100%,${70 + 20 * (1 - rr)}%,${0.85 * (formed ? 1 - 0.5 * lin(t, T.form, T.form + 1) : 1)})`; ctx.fillRect(x, y, s, s);
    }
    if (sw > 0) { const g = ctx.createRadialGradient(960, 520, 0, 960, 520, 300); g.addColorStop(0, `rgba(255,250,230,${0.9 * sw})`); g.addColorStop(1, 'rgba(255,200,255,0)'); ctx.fillStyle = g; ctx.fillRect(660, 220, 600, 600); }
    ctx.restore();
    // 衝擊波
    for (let i = 0; i < 3; i++) { const q = (l - i * 0.12) / 1.0; if (q < 0 || q > 1) continue; ctx.save(); ctx.globalAlpha = (1 - q) * (1 - out); ctx.strokeStyle = `hsl(${(i * 80 + 200) % 360},100%,80%)`; ctx.lineWidth = 30 * (1 - q) + 3; ctx.beginPath(); ctx.arc(960, 540, 60 + 1500 * eo(q), 0, 7); ctx.stroke(); ctx.restore(); }
    // 誕生的行星
    const pk = lin(t, T.galaxy + 0.6, T.galaxy + 1.2);
    if (pk > 0) for (const [px, py, pr, hue, ring] of [[360, 260, 70, 20, 1], [1600, 300, 54, 200, 0], [1500, 820, 90, 300, 1], [300, 820, 46, 120, 0]]) { const k = eback(lin(pk, 0, 1), 1.6), r = pr * k; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(px, py + Math.sin(t * 1.5 + px) * 10);
      if (ring) { ctx.strokeStyle = `hsl(${hue + 40},90%,75%)`; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.45, -0.3, Math.PI, 0); ctx.stroke(); }
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r); g.addColorStop(0, `hsl(${hue},90%,78%)`); g.addColorStop(1, `hsl(${hue},80%,45%)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#1a0838'; ctx.stroke();
      if (ring) { ctx.strokeStyle = `hsl(${hue + 40},90%,75%)`; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.45, -0.3, 0, Math.PI); ctx.stroke(); } ctx.restore(); }
    if (t > T.galaxy && t < T.form) { ctx.save(); ctx.globalAlpha = lin(t, T.galaxy, T.galaxy + 0.3) * (1 - lin(t, T.form - 0.3, T.form)); ctx.translate(960, 960); smallTitle(ctx, t, '新しい宇宙が生まれる…', 0, 0, 64, PAL.sky, 'center'); ctx.restore(); }
    flash(ctx, (1 - lin(t, T.bang, T.bang + 0.3)) * 0.95, '#fff');
  }
  if (formed) { const l = t - T.form; premiumEnd(ctx, t, l, out, { y: 560, h: 820, ty: 950, cx: 1580, cy: 600, nx: 960, ny: 1040 }); flash(ctx, (1 - lin(t, T.form, T.form + 0.2)) * 0.7, '#fff'); }
}

// ---------------- 頂級 3：巨大化 ----------------
const GI_T = { appear: 0.5, grow0: 1.6, grow1: 3.4 };
function cityLayer(ctx, t, k, lit) {   // 夜景城市（平塗剪影＋窗戶）
  for (let i = 0; i < 16; i++) {
    const w = 110 + R(i, 1) * 90, x = i * 125 - 40 + R(i, 2) * 30, h = 260 + R(i, 3) * 380, y = 1080 - h;
    ctx.fillStyle = `rgb(${30 + i % 3 * 8},${24 + i % 2 * 6},${70 + i % 4 * 10})`; ctx.fillRect(x, y, w, h + 10); ctx.strokeStyle = '#0a0620'; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h + 10);
    for (let wy = y + 24; wy < 1060; wy += 40) for (let wx = x + 16; wx < x + w - 20; wx += 30) { const on = R(i * 97 + wx, wy) < 0.25 + 0.7 * lit; ctx.fillStyle = on ? (R(wx, wy + i) < 0.5 ? '#ffe28a' : '#ffb0e0') : '#1a1240'; ctx.fillRect(wx, wy, 16, 22); }
    if (i % 4 === 1 && lit > 0.5) { ctx.fillStyle = '#05030c'; ctx.fillRect(x + 8, y + 30, w - 16, 90); ctx.save(); ctx.beginPath(); ctx.rect(x + 12, y + 34, w - 24, 82); ctx.clip(); palBG(ctx, t, PAL.premium, x + w / 2, y + 75); smallTitle(ctx, t, '×' + CFG.n, x + w / 2, y + 76, 44, PAL.gold, 'center'); ctx.restore(); }
  }
}
function vGiant(ctx, t) {
  const D = CFG.dur, T = GI_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), gk = eio2(lin(t, T.grow0, T.grow1)), grown = t >= T.grow1;
  const sh = t > T.grow0 && t < T.grow1 + 0.4 ? 10 * (grown ? Math.exp(-(t - T.grow1) * 6) : 0.5 + 0.5 * gk) : 0;
  ctx.save(); ctx.globalAlpha = app * (1 - out); ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * sh, (R(Math.floor(t * 60), 2) - 0.5) * sh);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, grown ? '#4a1a8a' : '#0a0830'); g.addColorStop(1, grown ? '#ff7ab8' : '#3a1a5a'); ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, H + 80);
  if (grown) { ctx.save(); ctx.globalAlpha *= lin(t, T.grow1, T.grow1 + 0.5); palBG(ctx, t, PAL.premium, 960, 380); ctx.fillStyle = 'rgba(20,0,50,0.3)'; ctx.fillRect(-40, -40, W + 80, H + 80); ctx.restore(); }
  for (let i = 0; i < 80; i++) { ctx.fillStyle = `rgba(255,255,240,${0.5 * R(i, 3)})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * 500, 3, 3); }
  // 探照燈
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)'; for (let i = 0; i < 4; i++) { const x = 250 + i * 470, a = -Math.PI / 2 + Math.sin(t * 1.3 + i * 1.7) * 0.5 * (grown ? 0.4 : 1); ctx.save(); ctx.translate(x, 1080); ctx.rotate(a + Math.PI / 2); const lg = ctx.createLinearGradient(0, 0, 0, -1300); lg.addColorStop(0, `rgba(255,240,200,${0.35 + 0.2 * gk})`); lg.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.lineTo(160, -1300); ctx.lineTo(-160, -1300); ctx.fill(); ctx.restore(); } ctx.restore();
  // 角色：從街上小小的，到比大樓還高
  if (GIRL) { const h0 = 180, h1 = 1900, gh = h0 + (h1 - h0) * gk, gy = 1060 - gh / 2 + (300 - FACE.y * h1 + h1 - 1060) * gk, gx = 960;
    const ak = lin(t, T.appear, T.appear + 0.3); if (ak > 0) { ctx.save(); ctx.globalAlpha = ak * (1 - out); if (gk > 0) neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, 0); drawImg(ctx, GIRL, gx, gy, gh, 0); ctx.restore(); } }
  cityLayer(ctx, t, gk, lin(t, T.grow0, T.grow1));
  ctx.restore();
  if (t > T.grow0 && t < T.grow1) { ctx.save(); ctx.globalAlpha = Math.floor(t * 8) % 2 ? 1 : 0.55; ctx.translate(960, 180); const s = 0.8 + 0.4 * gk; ctx.scale(s, s); smallTitle(ctx, t, 'ゴゴゴゴ…', 0, 0, 110, PAL.red, 'center'); ctx.restore(); }
  if (t > T.appear + 0.2 && t < T.grow0) { ctx.save(); ctx.globalAlpha = lin(t, T.appear + 0.2, T.appear + 0.4); ctx.translate(1180, 760); ctx.rotate(0.05); smallTitle(ctx, t, '…あれ?', 0, 0, 60, PAL.sky, 'center'); ctx.restore(); }
  if (grown) { const l = t - T.grow1;
    fireworksAt(ctx, t, [[T.grow1 + 0.2, 300, 220, 30], [T.grow1 + 0.5, 1620, 200, 200], [T.grow1 + 0.9, 260, 480, 300], [T.grow1 + 1.2, 1660, 480, 120]]);
    const tk = lin(l, 0.3, 0.5); if (tk > 0) { const s = tk < 1 ? 2 - eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(430, 200); ctx.rotate(-0.06); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 130, PAL.gold, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1520, 220, 200, lin(l, 0.45, 0.65)); ctx.restore();
    nameAt(ctx, 430, 320, eo(lin(l, 0.6, 0.8)) * (1 - out), 42, '#1a0838');
    flash(ctx, (1 - lin(t, T.grow1, T.grow1 + 0.2)) * 0.7, '#fff'); }
}

// ---------------- 頂級 4：全回轉 ----------------
const ZK_T = { spin: 0.9, stop: [3.0, 3.35, 3.7], all: 3.9 };
let _zkFace = null;
function zkFace() {   // 拉霸符號：角色大頭圓章
  const key = (GIRL ? GIRL.width : 0) + '|' + FACE.x + '|' + FACE.y; if (_zkFace && _zkFace.key === key) return _zkFace.c;
  const c = mk(260, 260), x = c.getContext('2d'); x.translate(130, 130); bustSafe(x, 0, 0, 115, 0); _zkFace = { key, c }; return c;
}
function vZenkaiten(ctx, t) {
  const D = CFG.dur, T = ZK_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), all = t >= T.all;
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  if (!all) { const g = ctx.createRadialGradient(960, 520, 0, 960, 520, 1200); g.addColorStop(0, '#5a0a3a'); g.addColorStop(1, '#0a0210'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (t > T.spin) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(ctx, 960, 500, 6, `hsla(${(h * 60 + t * 240) % 360},100%,60%,0.1)`, t * 1.5 + h * 0.5, 1800, 0.35, 14); ctx.restore(); } }
  else palBG(ctx, t, PAL.premium, 960, 500);
  ctx.restore();
  // 機台框＋三個捲軸，全部都是同一個角色圖案在轉
  const fx = 960, fy = 470, rw = 300, rh = 600, gap = 34, sym = 200;
  ctx.save(); ctx.globalAlpha = 1 - out;
  ctx.fillStyle = '#1a0828'; ctx.beginPath(); ctx.roundRect(fx - 560, fy - 360, 1120, 720, 40); ctx.fill();
  ledFrameHue(ctx, t, (i) => (i * 12 + t * 400) % 360);
  ctx.lineWidth = 14; const fg = ctx.createLinearGradient(0, fy - 360, 0, fy + 360); fg.addColorStop(0, '#ffe08a'); fg.addColorStop(1, '#c87a00'); ctx.strokeStyle = fg; ctx.beginPath(); ctx.roundRect(fx - 560, fy - 360, 1120, 720, 40); ctx.stroke();
  for (let r = 0; r < 3; r++) {
    const x = fx + (r - 1) * (rw + gap), stopT = T.stop[r];
    let pos; if (t < T.spin) pos = 0; else if (t < stopT) { const u = t - T.spin; pos = u * 9 + u * u * 4; } else { const ps = (stopT - T.spin) * 9 + Math.pow(stopT - T.spin, 2) * 4; pos = Math.ceil(ps) + eback(lin(t, stopT, stopT + 0.25), 1.8) * 0 - (1 - eo(lin(t, stopT, stopT + 0.25))) * 0.3; if (t >= stopT + 0.25) pos = Math.ceil(ps); }
    ctx.save(); ctx.beginPath(); ctx.roundRect(x - rw / 2, fy - rh / 2, rw, rh, 18); ctx.clip(); ctx.fillStyle = '#fff6fb'; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh);
    const spinning = t > T.spin && t < stopT, fr = pos % 1;
    for (let k = -2; k <= 2; k++) { const y = fy + (k + fr) * sym * 1.25; ctx.save(); ctx.globalAlpha = spinning ? 0.75 : 1; if (spinning) { ctx.translate(x, y); ctx.scale(1, 1.25); ctx.drawImage(zkFace(), -sym / 2, -sym / 2, sym, sym); } else ctx.drawImage(zkFace(), x - sym / 2, y - sym / 2, sym, sym); ctx.restore(); }
    const sh = ctx.createLinearGradient(0, fy - rh / 2, 0, fy + rh / 2); sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(0.25, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.45)'); ctx.fillStyle = sh; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh);
    ctx.restore();
    if (t >= stopT && t < stopT + 0.3) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,220,${0.6 * (1 - (t - stopT) / 0.3)})`; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh); ctx.restore(); }
  }
  ctx.restore();
  if (t > T.spin && t < T.all) { ctx.save(); ctx.globalAlpha = Math.floor(t * 10) % 2 ? 1 : 0.6; ctx.translate(960, 950); smallTitle(ctx, t, t < T.stop[0] ? 'プレミアム…!?' : '全部そろう…!?', 0, 0, 90, PAL.red, 'center'); ctx.restore(); }
  if (all) {
    const l = t - T.all, zk = lin(l, 0, 0.15);
    if (l < 1.3) { const s = zk < 1 ? 3 - 2 * eo(zk) : 1 + Math.sin(t * 20) * 0.02; ctx.save(); ctx.globalAlpha = (1 - lin(l, 1.0, 1.3)) * (1 - out); ctx.translate(960, 470); ctx.rotate(-0.08); ctx.scale(s, s); smallTitle(ctx, t, '全回転!!', 0, 0, 260, PAL.gold, 'center'); ctx.restore(); }
    coinFountain(ctx, t, T.all, T.all + 3.0, 200);
    if (l > 1.1) { ctx.save(); ctx.globalAlpha = 1 - out; ctx.fillStyle = 'rgba(20,0,40,0.35)'; ctx.fillRect(0, 0, W, H); ctx.restore(); premiumEnd(ctx, t, l - 1.1, out, { y: 560, h: 820, ty: 950, cx: 1580, cy: 560, nx: 960, ny: 1040 }); }
    flash(ctx, (1 - lin(t, T.all, T.all + 0.2)) * 0.85, '#fff');
  }
}
VARS.g100[1] = { name: '時間逆轉', fn: vRewind, dur: 8.0 };
VARS.g100[2] = { name: '宇宙創世', fn: vCosmos, dur: 8.0 };
VARS.g100[3] = { name: '巨大化', fn: vGiant, dur: 8.0 };
VARS.g100[4] = { name: '全回轉', fn: vZenkaiten, dur: 8.0 };
