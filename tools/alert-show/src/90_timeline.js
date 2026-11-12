
// ======================= 時間軸與輸出 =======================
const SCN = { teaser: sceneTeaser, black: sceneBlack, burst: sceneBurst, montage: sceneMontage, laser: sceneLaser, ink: sceneInk, main: sceneMain, exit: sceneExit };
function drawFull(t) {
  let acc = 0;
  for (let i = 0; i < CFG.segs.length; i++) {
    const [fn, s0, s1] = CFG.segs[i]; const d = s1 - s0;
    if (t < acc + d || i === CFG.segs.length - 1) {
      const src = Math.min(s1 - 1e-6, s0 + (t - acc));
      if (fn === 'teaser' && CFG.teaserHue) { bctx.setTransform(1, 0, 0, 1, 0, 0); sceneTeaser(bctx, src); g.filter = `hue-rotate(${(src * 520) % 360}deg) saturate(1.5)`; g.drawImage(buf, 0, 0); g.filter = 'none'; }
      else SCN[fn](g, src);
      return;
    }
    acc += d;
  }
}
const lay = mk(), lctx = lay.getContext('2d');
let NOISE = null; const nz = mk(), nzc = nz.getContext('2d');
function makeNoise() {   // 每像素 RGB 各加 0～3 階的隨機值，打散 8-bit 漸層的色階
  NOISE = mk(W + 256, H + 256); const x = NOISE.getContext('2d'); const id = x.createImageData(NOISE.width, NOISE.height), d = id.data;
  let s = 0x9e3779b9; const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let z = Math.imul(s ^ (s >>> 15), 1 | s); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };   // mulberry32：沒有 LCG 那種網格紋
  for (let i = 0; i < d.length; i += 4) { const A = window.__amp || 6; d[i] = rnd() * A | 0; d[i + 1] = rnd() * A | 0; d[i + 2] = rnd() * A | 0; d[i + 3] = 255; }
  x.putImageData(id, 0, 0);
}
function dither(t) {
  if (!NOISE) makeNoise(); const f = Math.floor(t * 60), ox = (f * 97) % 256, oy = (f * 61) % 256;
  nzc.globalCompositeOperation = 'source-over'; nzc.clearRect(0, 0, W, H); nzc.drawImage(NOISE, -ox, -oy);
  nzc.globalCompositeOperation = 'destination-in'; nzc.drawImage(cv, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'lighter'; g.drawImage(nz, 0, 0); g.globalCompositeOperation = 'source-over';
}
function drawBackdrop(ctx) {   // 模擬直播畫面（只給示範影片用）
  const gr = ctx.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1d2a44'); gr.addColorStop(1, '#3a2148');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 18; i++) { ctx.fillStyle = `hsla(${200 + R(i, 1) * 120},70%,70%,0.07)`; ctx.beginPath(); ctx.arc(R(i, 2) * W, R(i, 3) * H, 60 + R(i, 4) * 200, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(1440, 80, 400, 640);
  ctx.font = "900 30px 'Noto Sans TC'"; ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.textAlign = 'center'; ctx.fillText('（直播畫面示意）', CX, CY);
  ctx.textAlign = 'start';
}
window.draw = function (t) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.clearRect(0, 0, W, H);
  if (CFG.kind === 'card') sceneCard(g, t);
  else if (CFG.kind === 'panel') scenePanel(g, t);
  else if (CFG.kind === 'full') drawFull(t);
  else HI[CFG.kind](g, t);
  if (P.bg === '1') { lctx.clearRect(0, 0, W, H); lctx.drawImage(cv, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; drawBackdrop(g); g.drawImage(lay, 0, 0); }
  if (P.dither !== '0') dither(t);
};
window.setGirl = function (gi) {
  GIRL = trimmed(gi); GIRL_SIL = GIRL;
  GIRL_BW = variant(GIRL, (L) => (L > 0.52 ? 255 : 0));
  GIRL_INV = variant(GIRL, (L) => (L > 0.52 ? 0 : 255));
  GIRL_CY = tinted(GIRL_BW, '#3fe0ff'); GIRL_GD = tinted(GIRL_BW, '#ffb43a');
};
window.setMascot = function (ma) { if (ma) { MASCOT = trimmed(ma); MASCOT_SIL = MASCOT; } else { MASCOT = MASCOT_SIL = null; } };
window.ready = (async () => {
  const all = Object.values(TIERS).map((x) => x.title).join('') + '×0123456789 CHANCE PREMIUM 神降臨★';
  await document.fonts.load("200px 'Dela Gothic One'", all);
  await document.fonts.load("900 46px 'Noto Sans TC'", all + P.name + '送出了份訂閱直播畫面示意（）謝謝的！TO：');
  try { await document.fonts.load("700 76px 'LXGW WenKai TC'", all + P.name + '送出了份訂閱謝謝你的'); } catch (e) {}
  const gi = await load(P.girl || window.DEFAULT_GIRL || '../assets/girl.png'); if (gi) setGirl(gi);
  const ma = await load(P.mascot || window.DEFAULT_MASCOT || '../assets/mascot.png'); setMascot(ma);
  if (window.loadVarAssets) await window.loadVarAssets();
  try { await document.fonts.load("400 44px 'LXGW WenKai TC'", P.name + '送出了份訂閱'); } catch (e) {}
  setTier(P.tier); draw(0); return true;
})();
