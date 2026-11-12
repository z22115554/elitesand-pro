
// ======================= 即時播放的效能 =======================
// 這些演出原本是離線逐格算成影片的，沒有即時播放的負擔。做進程式後要在 OBS 裡照實際時間播，
// 量到的瓶頸集中在「每一格都重畫粗描邊的大字」：200px 的中文字用 56px 線寬描 16 層立體厚度，
// 顯示卡每格都要重新鋪一次，會把結尾段拖到每秒 20 格以下。
// 做法：不會動的描邊疊層（立體厚度、深色外框＋光暈、金邊、白邊）先畫成一張圖，之後每格只貼圖；
// 會隨時間變化的字面（漸層、上半高光、掃光）照舊每格畫。量測工具在 tools/alert-show/。
const _titleLayers = new Map();
try { document.fonts.addEventListener('loadingdone', () => _titleLayers.clear()); } catch (e) { /* 沒有 Font Loading API：字型都在開場前載好 */ }
function titleLayer(depth, col) {
  const txt = CFG.title, font = titleFont(txt), pal = PAL[CFG.pal] || PAL.gold;
  const key = [txt, font, depth, depth ? col[0] : '', depth ? col[1] : '', pal.glow].join('|');
  const hit = _titleLayers.get(key); if (hit) return hit;
  if (_titleLayers.size > 8) _titleLayers.clear();
  const K = 1.25, w = titleW(txt) + 330, h = 560, ox = w / 2 - 12, oy = h / 2 - 18;   /* 立體厚度往右下長，原點稍微偏左上 */
  const cvs = mk(Math.ceil(w * K), Math.ceil(h * K)), x = cvs.getContext('2d');
  x.scale(K, K); x.translate(ox, oy);
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  for (let i = depth; i >= 1; i--) { x.strokeStyle = col[i % 2]; x.lineWidth = 56; x.strokeText(txt, i * 1.4, i * 2.2); }
  x.shadowColor = pal.glow; x.shadowBlur = 40 * K; x.strokeStyle = '#1a0838'; x.lineWidth = 56; x.strokeText(txt, 0, 0); x.shadowBlur = 0;
  const gold = x.createLinearGradient(0, -110, 0, 110); gold.addColorStop(0, '#fff6c0'); gold.addColorStop(0.45, '#ffb21a'); gold.addColorStop(0.55, '#c76a00'); gold.addColorStop(1, '#ffe27a');
  x.strokeStyle = gold; x.lineWidth = 34; x.strokeText(txt, 0, 0); x.strokeStyle = '#fff'; x.lineWidth = 10; x.strokeText(txt, 0, 0);
  const layer = { cvs, ox, oy, K };
  _titleLayers.set(key, layer); return layer;
}
function titleLayerDraw(ctx, x, y, s, rot, depth, col) {
  const L = titleLayer(depth, col);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s / L.K, s / L.K); ctx.drawImage(L.cvs, -L.ox * L.K, -L.oy * L.K); ctx.restore();
}
function titleFace(ctx, t, x, y, s, rot) {   // 字面：漸層、上半高光、掃光（每格都會變，不能快取）
  const txt = CFG.title, pal = PAL[CFG.pal];
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = titleFont(txt); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.fillStyle = palFill(ctx, -95, 95, t, pal); ctx.fillText(txt, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-2000, -120, 4000, 95); ctx.clip(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillText(txt, 0, 0); ctx.restore();
  const sw = ((t - 4.0) * 0.9) % 1.6; if (sw > 0 && sw < 1) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; const gx = -900 + sw * 1800, gr = ctx.createLinearGradient(gx - 120, 0, gx + 120, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillText(txt, 0, 0); ctx.restore(); }
  ctx.restore();
}
function titleText(ctx, t, x, y, s, rot) {   // 覆寫：外框用快取的圖
  s *= titleFit(x);
  titleLayerDraw(ctx, x, y, s, rot, 0, null); titleFace(ctx, t, x, y, s, rot);
}
function title3D(ctx, t, x, y, s, rot, depth, col) {   // 覆寫：立體厚度＋外框是一張圖
  s *= titleFit(x);
  titleLayerDraw(ctx, x, y, s, rot, depth, col); titleFace(ctx, t, x, y, s, rot);
}

// 直書大字、演出中的大字、巨大數字也是同樣的畫法（粗描邊疊出立體厚度），一樣先畫成圖。
const _strokeLayers = new Map(), _strokeSeen = new Map();
try { document.fonts.addEventListener('loadingdone', () => { _strokeLayers.clear(); _strokeSeen.clear(); }); } catch (e) { /* 同上 */ }
function strokeLayer(key, w, h, K, paint) {   // paint(x)：原點在圖的中心偏左上（立體厚度往右下長）
  const hit = _strokeLayers.get(key); if (hit) return hit;
  // 文字每格都在變（數字往上數的那一小段）就不值得快取：同一個內容出現第二次才建圖。
  if (!_strokeSeen.has(key)) { if (_strokeSeen.size > 200) _strokeSeen.clear(); _strokeSeen.set(key, 1); return null; }
  if (_strokeLayers.size > 24) _strokeLayers.clear();
  const ox = w / 2 - 12, oy = h / 2 - 18, cvs = mk(Math.ceil(w * K), Math.ceil(h * K)), x = cvs.getContext('2d');
  x.scale(K, K); x.translate(ox, oy); x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  paint(x);
  const layer = { cvs, ox, oy, K }; _strokeLayers.set(key, layer); return layer;
}
function strokeLayerDraw(ctx, L) { ctx.save(); ctx.scale(1 / L.K, 1 / L.K); ctx.drawImage(L.cvs, -L.ox * L.K, -L.oy * L.K); ctx.restore(); }

function vGlyph(ctx, t, ch, x, y, s, rot, depth) {   // 覆寫：直書用的單字
  const pal = PAL[CFG.pal] || PAL.gold, ext = EXT[CFG.pal] || EXT.gold, font = titleFont(CFG.title);
  const strokes = (c) => {
    c.font = font;
    for (let i = depth; i >= 1; i--) { c.strokeStyle = ext[i % 2]; c.lineWidth = 56; c.strokeText(ch, i * 1.4, i * 2.2); }
    c.shadowColor = pal.glow; c.shadowBlur = 40 * (c === ctx ? 1 : 1.1); c.strokeStyle = '#1a0838'; c.lineWidth = 56; c.strokeText(ch, 0, 0); c.shadowBlur = 0;
    const gold = c.createLinearGradient(0, -110, 0, 110); gold.addColorStop(0, '#fff6c0'); gold.addColorStop(0.45, '#ffb21a'); gold.addColorStop(0.55, '#c76a00'); gold.addColorStop(1, '#ffe27a');
    c.strokeStyle = gold; c.lineWidth = 34; c.strokeText(ch, 0, 0); c.strokeStyle = '#fff'; c.lineWidth = 10; c.strokeText(ch, 0, 0);
  };
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const L = strokeLayer(['vg', ch, font, depth, ext[0], ext[1], pal.glow].join('|'), ctx.measureText(ch).width + 330, 560, 1.1, strokes);
  if (L) strokeLayerDraw(ctx, L); else strokes(ctx);
  ctx.font = font; ctx.fillStyle = palFill(ctx, -95, 95, t, pal); ctx.fillText(ch, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-300, -120, 600, 95); ctx.clip(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillText(ch, 0, 0); ctx.restore();
  ctx.restore();
}

function wordV2(ctx, txt, x, y, k, o = {}) {   // 覆寫：演出中的大字與巨大數字
  if (k <= 0) return; const s = (o.s ?? 1) * (o.pop === false ? 1 : slamK(k, o.big ?? 2.2, 1.6)) * (1 + (o.beat ?? 0));
  const font = o.font || (curLang() === 'zh-TW' && DELA_MISSING.test(txt) ? "900 150px 'Noto Sans TC'" : "150px 'Dela Gothic One', 'Noto Sans TC'"), depth = o.depth ?? 8, stroke = o.stroke || '#1a0838';
  ctx.save(); ctx.globalAlpha *= o.a ?? 1; ctx.translate(x, y); ctx.rotate(o.rot ?? -0.05); ctx.scale(s, s);
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const tw = ctx.measureText(txt).width; let fit = 1;
  if (o.maxW) { fit = Math.min(1, o.maxW / ((tw + 50) * (o.s ?? 1))); ctx.scale(fit, fit); }   /* 翻譯後變長就縮到放得下 */
  const strokes = (c) => {
    c.font = font;
    for (let i = depth; i >= 1; i--) { c.strokeStyle = stroke; c.lineWidth = 40; c.strokeText(txt, i * 1.3, i * 2); }
    c.strokeStyle = stroke; c.lineWidth = 40; c.strokeText(txt, 0, 0); c.strokeStyle = '#fff'; c.lineWidth = 12; c.strokeText(txt, 0, 0);
  };
  const K = Math.min(3, Math.max(1, (o.s ?? 1) * fit)) * 1.1;   /* 依停下來時的大小決定解析度，放大的數字才不會糊 */
  const L = tw * K < 3600 ? strokeLayer(['w', txt, font, depth, stroke, K.toFixed(2)].join('|'), tw + 190, 380, K, strokes) : null;
  if (L) strokeLayerDraw(ctx, L); else strokes(ctx);
  ctx.font = font; ctx.fillStyle = o.fill || '#ffe14a'; ctx.fillText(txt, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-2000, -95, 4000, 80); ctx.clip(); ctx.globalAlpha *= 0.3; ctx.fillStyle = '#fff'; ctx.fillText(txt, 0, 0); ctx.restore();
  if (k >= 1 && o.box !== false) { const w = tw + 50; dbgBox(ctx, 'text', 'word:' + txt, -w / 2, -95, w / 2, 95); }
  ctx.restore();
}

// 彩虹放射背景：原本 36 道光芒每一道各自套一次 blur(18px)，等於每格整張畫面模糊 36 次。
// 改成光芒先畫在一張圖上，整張只模糊一次再疊上去（光芒之間有空隙，合併後再模糊，看起來一樣）。
let _raysCanvas = null;
function rainbowBG2(ctx, t, cx = 560, cy = 470) {
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1700);
  bg.addColorStop(0, '#fffbe0'); bg.addColorStop(0.12, '#ffe14a'); bg.addColorStop(0.35, '#ff5aa5'); bg.addColorStop(0.62, '#7a3cff'); bg.addColorStop(1, '#10073a');
  ctx.fillStyle = bg; ctx.fillRect(-80, -80, W + 160, H + 160);
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  if (!_raysCanvas || _raysCanvas.width !== cw || _raysCanvas.height !== ch) _raysCanvas = mk(cw, ch);
  const x = _raysCanvas.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cw, ch); x.setTransform(ctx.getTransform());
  const n = 36, rot = t * 0.35;
  for (let i = 0; i < n; i++) { x.fillStyle = `hsla(${(i * 360 / n + t * 120) % 360},100%,62%,${i % 2 ? 0.75 : 0.3})`; const a0 = rot + i / n * Math.PI * 2, a1 = a0 + Math.PI / n;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a0) * 3200, cy + Math.sin(a0) * 3200); x.lineTo(cx + Math.cos(a1) * 3200, cy + Math.sin(a1) * 3200); x.fill(); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'overlay'; ctx.filter = 'blur(18px)'; ctx.drawImage(_raysCanvas, 0, 0); ctx.restore();
  speedLines(ctx, cx, cy, 90, 520, 'rgba(255,255,255,0.55)', Math.floor(t * 30), 0, 0.7);
}

// 觀眾的螢光棒：原本每一根都套一次 blur(4px)（一排三十幾根），改成每種顏色先畫好一張模糊過的小圖再貼。
const _stickSprites = new Map();
function stickSprite(hue, sc) {
  const key = hue + '|' + sc.toFixed(3);
  const hit = _stickSprites.get(key); if (hit) return hit;
  const pad = 12, sw = 16 * sc, sh = 150 * sc, c = mk(Math.ceil(sw) + pad * 2, Math.ceil(sh) + pad * 2), x = c.getContext('2d');
  x.filter = 'blur(4px)'; x.fillStyle = `hsl(${hue},100%,65%)`; x.fillRect(pad, pad, sw, sh);
  const sprite = { c, pad }; _stickSprites.set(key, sprite); return sprite;
}
function crowdV2(ctx, t, y0, sc = 1, rows = 1) {   // 覆寫：觀眾剪影＋螢光棒（畫法同原版，螢光棒改貼圖）
  for (let rw = rows - 1; rw >= 0; rw--) { const n = Math.round(30 / sc) + rw * 3;
    for (let i = 0; i < n; i++) { const x = (i + 0.5 + (rw % 2) * 0.5) * W / n + (R(i, 1 + rw) - 0.5) * 30, y = y0 - rw * 90 * sc + R(i, 2 + rw) * 50 * sc, hr = (42 + R(i, 3) * 10) * sc, wave = Math.sin(t * 7 + i * 0.6 + rw) * 0.5, hue = [330, 200, 50, 280][Math.floor(t * 1.5 + i + rw) % 4];
      const sp = stickSprite(hue, sc);
      ctx.save(); ctx.translate(x + 44 * sc, y + 10 * sc); ctx.rotate(wave); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(sp.c, -8 * sc - sp.pad, -150 * sc - sp.pad); ctx.restore();
      ctx.fillStyle = rw ? '#150826' : '#0a0414'; ctx.beginPath(); ctx.arc(x, y + hr, hr, 0, 7); ctx.fill(); ctx.fillRect(x - hr * 1.3, y + hr * 1.6, hr * 2.6, 400); } }
}

// 巨大化的近景大樓：四塊看板各畫一次彩虹背景。改成每格只在一張小圖上畫一次，四塊看板共用。
let _boardTex = null, _boardTexT = -1;
function boardTexture(t) {
  const BW = 200, BH = 88, M = 40;
  if (!_boardTex) _boardTex = mk(BW + M * 2, BH + M * 2);
  if (_boardTexT !== t) {
    const x = _boardTex.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, _boardTex.width, _boardTex.height);
    x.translate(M, M);
    rainbowBG2(x, t * 2.2, BW / 2, 44);
    smallTitle(x, t, '×' + CFG.n, BW / 2, 46, 46, PAL.gold, 'center');
    _boardTexT = t;
  }
  return { c: _boardTex, BW, M };
}
function cityNear(ctx, t, lit) {   // 覆寫：看板另外畫（共用同一張），其餘跟原版一樣
  const o = { seed: 7, n: 16, lit, line: '#0a0620', cols: ['#1e1846', '#241c50', '#1a1440', '#2a2058'], win: ['#ffe28a', '#ffb0e0', '#1a1240'],
    prof: (xc, i) => { const d = Math.min(1, Math.abs(xc - 960) / 760); return 120 + 40 * R(i, 9) + (300 + 240 * R(i, 10)) * Math.pow(d, 1.5); } };
  skylineV2(ctx, t, o);
  if (lit <= 0.5) return;
  const bw = (W + 200) / o.n;
  let tex = null;
  for (const i of [1, 3, 12, 14]) {
    const w = bw * (0.82 + R(i, o.seed + 1) * 0.3), x = -100 + i * bw + R(i, o.seed + 2) * 20, h = o.prof(x + w / 2, i), y = 1080 - h;
    if (h <= 260) continue;
    if (!tex) tex = boardTexture(t);
    ctx.fillStyle = '#05030c'; ctx.fillRect(x + 8, y + 30, w - 16, 96);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 12, y + 34, w - 24, 88); ctx.clip();
    ctx.drawImage(tex.c, x + w / 2 - tex.BW / 2 - tex.M, y + 34 - tex.M);
    ctx.restore();
  }
}
