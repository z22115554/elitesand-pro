
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
