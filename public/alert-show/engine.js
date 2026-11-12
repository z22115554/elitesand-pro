window.__V2_TEXT = "—…→◀★、。「」぀あいうえかがぎくさしそぞたっでとなのほまもゅらりるれろんアイギクコゴサザシスゾチッツトドパピフブプミムャリルレロン・ーヿ㐀一七三上下不世丘中临主之乗乘也亂了二五些交亮人介他代以任份众伙伴位低住体佔何作你佬併來例依便保信個倍倒候借值偏做停側偵偷備傳傾像元先光免入內全兩八六共其具再冒凍出函分切列別利到制券刺刻則前剪副創劃力加動勝化區十升半卡印即厚原去參反取口句另只叫召可台右号各合吉吊同名向含吸告员周和咻員哥哪唱喚喜單嘯器噴囊四回固圈國圍圓圖團在地址型城執堆報場塊塗塞填墜墨壁壓壞外多夜夥大天太央夾奇套好始子字宇完宙定容實寫寬寶寸射專對小少就尺尾局屑層屬山峙崩嶼工左巨差己已巴市布带席帶帷幕幣平幸幾序底度座廓建式弦弧張強彈当形彩影往很律後徑得從復微徽心快急意感態慢懂成戒或截戲戳戶所扇扉手才打扭批把抓投抖抽拆拉拍拖招括拱拿指按捲掃掉排探接推描插換揪揭搖撐撞撥播擊擔擠擬擲擴擺攏支收改放效散整數文料斜斬新斷方於旁旋旗日昇明星映是時晃普景暈暗暫曉書替最會有望朝期末本杆材束来板析果架柏柔查柱校核根格桅框案桌條棒楚構樓標模樣機橫檔檢檻次止正歩死殘段殼殿母每比毛氣水決沒法泡波洞活派流浪海淡深清測港満準滑滴滾滿漏演漫漸激瀏火炸為然煙照熄熱燈爆爍爬片版牌物特狀獎獨率玉玻珠現球璃環瓶生用甩由甲界留畫當疊痕登發白的盒盤目直相看眼眾着睛瞬知矮砸碎確碼示神祥票禮秒移程稍稜種稱空突窗立站章端符第筆等算管箭箱範簡籤粉粒粗糊系約紅紋純紙級素終組結給統絲經綠網線緞緣緩縫縮繁繞缺置羅羽翅翻翼者而聚聲聴胃背胜能脈脹膀膠臂臉臨自至致與舊舞舰舷船艘艦色芒花英菊華菱落著蒙蓄蓋藍處號虹蛋螢螺血行街衝表被袭裁裂補裡製襲要覆見規視覽觀观角解觸言訂計訊記設話該誕誘語謝證警譯讀變讓订证谢負貨貼資賞贈赠起超越跑跟跡路跳身躲軌転軸較載輪輸轉近追退送逆透逐這通速連進遇遊運過道達遠避還邊那部郵都配重野量金釘針鈕鋪鋸鋼錄錨錯録鎖鏡鐘長門閃閉開間閱關阅队降限陣陰陽隊階隙際隧隨隻集雙雜離雨雲雷電需霓露霸青靜靠面韓音頂順預頭頸頻顆題顏類顯風飄飛餌餘馬驚驾骨骰體高麗黃黑點齊齐齒鿿가감강개격과구권께니님다대도독드량레리림명물사선손습승시신어외요원이자전집착청초큰함합했형호힯！（）＋，／：；＝～";
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


// ======================= 高階演出（×25 金扉／×50 拉霸／×100 神降臨） =======================
function shakeAt(ctx, t, amt) { const f = Math.floor(t * 60); ctx.translate((R(f, 11) - 0.5) * amt, (R(f, 12) - 0.5) * amt); }
function decay(t, list, k = 12) { let s = 0; for (const [ti, a] of list) if (t >= ti) s += a * Math.exp(-(t - ti) * k); return s; }
function godRays(ctx, cx, cy, n, col, rot, len = 2600, wfrac = 0.5, blur = 18) {
  ctx.save(); ctx.fillStyle = col; if (blur) ctx.filter = `blur(${blur}px)`; ctx.beginPath();
  for (let i = 0; i < n; i++) { const a0 = rot + i / n * Math.PI * 2, a1 = a0 + Math.PI * 2 / n * wfrac;
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * len, cy + Math.sin(a0) * len); ctx.lineTo(cx + Math.cos(a1) * len, cy + Math.sin(a1) * len); }
  ctx.fill(); ctx.restore();
}
function confetti(ctx, t, t0, n, cols, seed = 1) {
  const lt = t - t0; if (lt < 0) return;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const st = R(i, seed) * 2.2, l = lt - st; if (l < 0) continue;
    const x = R(i, seed + 1) * (W + 200) - 100 + Math.sin(l * (1.5 + R(i, seed + 2) * 2) + i) * 60;
    const y = -40 + l * (260 + R(i, seed + 3) * 260); if (y > H + 40) continue;
    const fl = Math.cos(l * (6 + R(i, seed + 4) * 8) + i);
    ctx.save(); ctx.translate(x, y); ctx.rotate(l * (2 + R(i, seed + 5) * 3) + i); ctx.scale(1, fl);
    ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(-9, -5, 18, 10); ctx.restore();
  }
  ctx.restore();
}
function coinFountain(ctx, t, t0, t1, n) {
  const lt = t - t0; if (lt < 0) return;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const st = R(i, 31) * (t1 - t0), l = lt - st; if (l < 0 || l > 1.8) continue;
    const vx = (R(i, 32) - 0.5) * 1400, vy = -1500 - R(i, 33) * 900;
    const x = CX + (R(i, 34) - 0.5) * 200 + vx * l, y = H + 40 + vy * l + 1500 * l * l; if (y > H + 60) continue;
    const s = 16 + R(i, 35) * 12, sp = Math.cos(l * 18 + i);
    const gg = ctx.createLinearGradient(x - s, y - s, x + s, y + s); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffbf1a'); gg.addColorStop(1, '#a86400');
    ctx.fillStyle = gg; ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, s * Math.abs(sp) + 2, s, 0, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function title3D(ctx, t, x, y, s, rot, depth, col) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = "200px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let i = depth; i >= 1; i--) { ctx.strokeStyle = col[i % 2]; ctx.lineWidth = 56; ctx.strokeText(CFG.title, i * 1.4, i * 2.2); }
  ctx.restore();
  titleText(ctx, t, x, y, s, rot);
}
function ledFrameHue(ctx, t, hueFn) {
  const per = 2 * (W + H), n = 96, sp = 46;
  ctx.save(); ctx.fillStyle = 'rgba(20,6,0,0.85)';
  ctx.fillRect(0, 0, W, sp); ctx.fillRect(0, H - sp, W, sp); ctx.fillRect(0, 0, sp, H); ctx.fillRect(W - sp, 0, sp, H);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per; let x, y;
    if (d < W) { x = d; y = sp / 2; } else if ((d -= W) < H) { x = W - sp / 2; y = d; } else if ((d -= H) < W) { x = W - d; y = H - sp / 2; } else { d -= W; x = sp / 2; y = H - d; }
    const on = ((i - t * 40) % 8 + 8) % 8 < 3 ? 1 : 0.25, hue = hueFn(i);
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 26); gr.addColorStop(0, `hsla(${hue},100%,${on > 0.5 ? 88 : 60}%,${on})`); gr.addColorStop(1, `hsla(${hue},100%,50%,0)`);
    ctx.fillStyle = gr; ctx.fillRect(x - 26, y - 26, 52, 52);
  }
  ctx.restore();
}
function girlAt(ctx, gx, gy, gh, t, outline = true, alpha = 1) {
  if (!GIRL) return; if (outline) neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, 0.03); drawImg(ctx, GIRL, gx, gy, gh, 0.03, alpha);
}
function mascotAt(ctx, t, k, x = 245, y = 850, h = 470) {
  if (!MASCOT || k <= 0) return; const s = eback(k, 2.6); const bob = Math.abs(Math.sin(t * 15.7)) * -26, mr = -0.1 + Math.sin(t * 15.7) * 0.08;
  neonOutline(ctx, MASCOT_SIL, x, y + bob, h * s, t + 0.3, mr); drawImg(ctx, MASCOT, x, y + bob, h * s, mr);
}
function exitSmear(ctx, k, f, render) {   // 錄影帶式拉絲退場，k:0→1
  bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.globalCompositeOperation = 'source-over'; bctx.clearRect(0, 0, W, H); render(bctx);
  ctx.clearRect(0, 0, W, H);
  let y = 0, i = 0; ctx.globalAlpha = 1 - ei(lin(k, 0.5, 1));
  while (y < H) { const hh = 6 + R(f + i, 1) * 50; const smear = ei(k) * (300 + R(f + i, 2) * 1500) * (R(f + i, 3) < 0.6 ? 1 : 0.2);
    ctx.drawImage(buf, 0, y, W, hh, (R(f + i, 4) - 0.5) * 400 * k - smear * 0.5, y, W + smear, hh); y += hh; i++; }
  ctx.globalAlpha = 1;
  if (k > 0.1) { const tmp = mk(); tmp.getContext('2d').drawImage(cv, 0, 0); ctx.clearRect(0, 0, W, H); rgbSplit(ctx, tmp, 10 + k * 40); }
}

// ---------------- ×25 金扉 ----------------
let DOOR_TEX = null;
function makeDoor(side) {   // side -1 左門（內緣在右），1 右門（內緣在左）
  const DW = CX, c = mk(DW, H), x = c.getContext('2d'), ex = side < 0 ? DW : 0;
  let gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#6a4200'); gr.addColorStop(0.18, '#e0aa28'); gr.addColorStop(0.5, '#fff0a0'); gr.addColorStop(0.82, '#c88e12'); gr.addColorStop(1, '#5a3800');
  x.fillStyle = gr; x.fillRect(0, 0, DW, H);
  gr = x.createLinearGradient(0, 0, DW, 0); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
  x.fillStyle = gr; x.fillRect(0, 0, DW, H);
  const bevel = (rx, ry, rw, rh, d = 10) => { x.lineWidth = d; x.strokeStyle = 'rgba(60,30,0,0.65)'; x.beginPath(); x.moveTo(rx, ry + rh); x.lineTo(rx, ry); x.lineTo(rx + rw, ry); x.stroke();
    x.strokeStyle = 'rgba(255,250,210,0.8)'; x.beginPath(); x.moveTo(rx + rw, ry); x.lineTo(rx + rw, ry + rh); x.lineTo(rx, ry + rh); x.stroke(); };
  bevel(26, 26, DW - 52, H - 52, 12);
  for (const [py, ph] of [[110, 330], [640, 330]]) { bevel(90, py, DW - 180, ph, 10);
    x.save(); x.beginPath(); x.rect(100, py + 10, DW - 200, ph - 20); x.clip(); x.strokeStyle = 'rgba(120,70,0,0.35)'; x.lineWidth = 3;
    for (let k = -10; k < 20; k++) { x.beginPath(); x.moveTo(100 + k * 70, py); x.lineTo(100 + k * 70 + ph, py + ph); x.moveTo(100 + k * 70 + ph, py); x.lineTo(100 + k * 70, py + ph); x.stroke(); } x.restore(); }
  for (let i = 0; i < 15; i++) for (const sx of [56, DW - 56]) { const sy = 70 + i * 67; const sg = x.createRadialGradient(sx - 4, sy - 4, 1, sx, sy, 14); sg.addColorStop(0, '#fffbe0'); sg.addColorStop(1, '#8a5a00'); x.fillStyle = sg; x.beginPath(); x.arc(sx, sy, 12, 0, 7); x.fill(); }
  // 內緣紋章（兩扇門合起來是一個完整的圓）
  const eg = x.createRadialGradient(ex, CY - 40, 20, ex, CY, 230); eg.addColorStop(0, '#ff5a5a'); eg.addColorStop(0.7, '#a0001e'); eg.addColorStop(1, '#4a0010');
  x.fillStyle = eg; x.beginPath(); x.arc(ex, CY, 220, 0, 7); x.fill();
  x.lineWidth = 22; x.strokeStyle = '#ffe27a'; x.stroke(); x.lineWidth = 6; x.strokeStyle = '#7a4a00'; x.beginPath(); x.arc(ex, CY, 186, 0, 7); x.stroke();
  x.font = "220px 'Dela Gothic One'"; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  x.strokeStyle = '#3a1a00'; x.lineWidth = 26; x.strokeText(String(CFG.n), ex, CY + 8);
  const tg = x.createLinearGradient(0, CY - 90, 0, CY + 90); tg.addColorStop(0, '#fffbe0'); tg.addColorStop(0.5, '#ffc21a'); tg.addColorStop(1, '#c76a00');
  x.fillStyle = tg; x.fillText(String(CFG.n), ex, CY + 8);
  gr = x.createLinearGradient(side < 0 ? DW - 30 : 0, 0, side < 0 ? DW : 30, 0); gr.addColorStop(0, side < 0 ? 'rgba(0,0,0,0)' : 'rgba(40,20,0,0.7)'); gr.addColorStop(1, side < 0 ? 'rgba(40,20,0,0.7)' : 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(side < 0 ? DW - 30 : 0, 0, 30, H);
  return c;
}
function drawDoor(ctx, tex, side, th, slide = 0, alpha = 1) {
  const n = 64, DW = tex.width, f = 1700;
  ctx.save(); ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n, um = (u0 + u1) / 2;
    const proj = (u) => { const xw = -CX + u * CX * Math.cos(th), z = u * CX * Math.sin(th); const s = f / (f - z); return [CX + (side < 0 ? xw : -xw) * s, s]; };
    const [X0] = proj(u0), [X1] = proj(u1), [, s] = proj(um);
    const sx = side < 0 ? u0 * DW : DW - u1 * DW;
    const x0 = Math.min(X0, X1) + slide, wd = Math.abs(X1 - X0) + 1.2;
    ctx.drawImage(tex, sx, 0, DW / n + 0.5, H, x0, CY - H * s / 2, wd, H * s);
    const sh = Math.sin(th) * um * 0.55; if (sh > 0.01) { ctx.fillStyle = `rgba(0,0,0,${sh})`; ctx.fillRect(x0, CY - H * s / 2, wd, H * s); }
  }
  ctx.restore();
}
function gateMain(ctx, m, t) {   // 金色聚光主畫面，m＝開門後經過秒數
  const pal = PAL.gold, hits = [[0, 1], [0.35, 0.9], [0.62, 0.5]]; for (let b = 1.0; b < 3.4; b += 0.4) hits.push([b, 0.3]);
  const pk = decay(m, hits, 13);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.05, 1 + pk * 0.05); ctx.translate(-CX, -CY); shakeAt(ctx, t, 4 + pk * 26);
  const bg = ctx.createRadialGradient(1400, 300, 0, 1400, 300, 1700);
  bg.addColorStop(0, '#fffbe6'); bg.addColorStop(0.15, '#ffe27a'); bg.addColorStop(0.45, '#d08a00'); bg.addColorStop(0.8, '#5a2a00'); bg.addColorStop(1, '#1a0a00');
  ctx.fillStyle = bg; ctx.fillRect(-60, -60, W + 120, H + 120);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  godRays(ctx, 1400, -200, 26, 'rgba(255,240,170,0.12)', 1.2 + Math.sin(m * 0.8) * 0.15, 2600, 0.4);
  godRays(ctx, 730, 420, 40, 'rgba(255,255,220,0.10)', m * 0.6, 2600, 0.5);
  // 聚光燈柱
  const sp = ctx.createLinearGradient(1500, 0, 1500, H); sp.addColorStop(0, 'rgba(255,250,210,0.75)'); sp.addColorStop(1, 'rgba(255,220,120,0.1)');
  ctx.fillStyle = sp; ctx.beginPath(); ctx.moveTo(1380, -60); ctx.lineTo(1620, -60); ctx.lineTo(1900, H + 60); ctx.lineTo(1100, H + 60); ctx.fill();
  ctx.restore();
  const gk = lin(m, 0.12, 0.5); if (gk > 0) girlAt(ctx, 1500, 820 + (1 - eo5(gk)) * 700, 1700 + pk * 30, t);
  coins(ctx, m - 0.35 + T_HIT);
  const tk = lin(m, 0.35, 0.52);
  if (tk > 0) { const s = tk < 1 ? 2.8 - 1.8 * eback(tk, 1.4) : 1 + pk * 0.06;
    if (m > 0.6) { const bp = ((m - 0.35) % 0.2) / 0.2; ctx.save(); ctx.globalAlpha = (1 - bp) * 0.4; titleText(ctx, t, 730, 420, 1.3 * (1 + bp * 0.3), -0.08); ctx.restore(); }
    title3D(ctx, t, 730, 420, s * 1.3, -0.08, 16, ['#5a3000', '#7a4200']); }
  subLine(ctx, t, eo(lin(m, 0.7, 0.9)));
  mascotAt(ctx, t, lin(m, 0.62, 0.92));
  ctx.restore();
  confetti(ctx, m, 0.05, 160, ['#ffe27a', '#fff6c0', '#ffb21a', '#ffffff', '#ff5a5a'], 3);
  if (m > 0.6) { const e = 1 - eo5(lin(m, 0.6, 0.8)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  ledFrameHue(ctx, t, (i) => 38 + ((i * 7 + t * 80) % 20));
  if (m >= 0.35) flash(ctx, (1 - lin(m, 0.35, 0.45)) * 0.35, '#fff3b0');
}
function sceneGate(ctx, t) {
  if (!DOOR_TEX || DOOR_TEX.n !== CFG.n) DOOR_TEX = { L: makeDoor(-1), R: makeDoor(1), n: CFG.n };
  const D = CFG.dur, OPEN = 1.55, CLOSE = D - 0.75;
  const dim = eo(lin(t, 0, 0.3)) * (1 - lin(t, D - 0.3, D));
  // 門後：開門後才有主畫面
  if (t >= OPEN && t < CLOSE + 0.3) gateMain(ctx, t - OPEN, t);
  else if (t >= CLOSE + 0.3) { ctx.fillStyle = `rgba(0,0,0,${0.85 * dim})`; ctx.fillRect(0, 0, W, H); }
  else { ctx.fillStyle = `rgba(0,0,0,${0.85 * dim})`; ctx.fillRect(0, 0, W, H); }
  // 門
  let th = 0, slide = 0;
  if (t < 0.6) slide = (1 - ei(lin(t, 0.25, 0.6))) * CX * 1.05;
  else if (t < OPEN) th = 0;
  if (t >= OPEN) th = eo5(lin(t, OPEN, OPEN + 0.42)) * 1.42;
  if (t >= CLOSE) th = 1.42 * (1 - ei(lin(t, CLOSE, CLOSE + 0.3)));
  const doorA = t >= CLOSE + 0.3 ? 1 - lin(t, CLOSE + 0.35, D - 0.02) : 1;
  const beats = [[0.6, 1], [0.9, 0.5], [1.15, 0.7], [1.35, 0.9], [CLOSE + 0.3, 1]];
  const pk = decay(t, beats, 10);
  ctx.save(); shakeAt(ctx, t, pk * 30);
  if (t > 0.2 && th < 1.41) {
    // 門縫光（關著時）
    if (t >= 0.6 && t < OPEN + 0.1) { const pulse = 0.4 + decay(t, beats.slice(1, 4), 6) * 1.2 + lin(t, 1.35, OPEN) * 2;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(CX - 140 * pulse, 0, CX + 140 * pulse, 0);
      gr.addColorStop(0, 'rgba(255,220,120,0)'); gr.addColorStop(0.5, `rgba(255,250,220,${Math.min(1, 0.6 * pulse)})`); gr.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = gr; ctx.fillRect(CX - 300, 0, 600, H); ctx.restore(); }
    drawDoor(ctx, DOOR_TEX.L, -1, th, -slide, doorA);
    drawDoor(ctx, DOOR_TEX.R, 1, th, slide, doorA);
    if (t >= 0.6 && t < OPEN + 0.05) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const p = decay(t, beats.slice(1, 4), 5) + lin(t, 1.35, OPEN);
      ctx.fillStyle = `rgba(255,250,220,${Math.min(1, 0.5 + p)})`; ctx.fillRect(CX - 2 - p * 3, 0, 4 + p * 6, H); ctx.restore(); }
  }
  ctx.restore();
  // 關門火花
  for (const ts of [0.6, CLOSE + 0.3]) { const l = t - ts; if (l < 0 || l > 0.6) continue;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) { const y = R(i, ts) * H, a = (R(i, 2) < 0.5 ? Math.PI : 0) + (R(i, 3) - 0.5) * 1.2, v = 400 + R(i, 4) * 900;
      const x = CX + Math.cos(a) * v * l, yy = y + Math.sin(a) * v * l + 900 * l * l;
      ctx.strokeStyle = `rgba(255,${200 + R(i, 5) * 55 | 0},120,${1 - l / 0.6})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - Math.cos(a) * 30, yy - Math.sin(a) * 30); ctx.stroke(); }
    ctx.restore(); }
  // 開門的金光
  const ok = lin(t, OPEN - 0.05, OPEN + 0.5);
  if (ok > 0 && ok < 1) { ctx.save(); ctx.globalCompositeOperation = 'lighter';
    godRays(ctx, CX, CY, 30, `rgba(255,240,180,${0.5 * (1 - ok)})`, t * 0.5, 2600, 0.5);
    const gr = ctx.createRadialGradient(CX, CY, 0, CX, CY, 400 + ok * 1400); gr.addColorStop(0, `rgba(255,255,240,${1 - ok})`); gr.addColorStop(1, 'rgba(255,230,150,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  if (t >= OPEN) flash(ctx, (1 - lin(t, OPEN, OPEN + 0.14)) * 0.6, '#fff6d0');
  if (t >= D - 0.35) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${lin(t, D - 0.35, D - 0.02)})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

// ---------------- ×50 拉霸 777 ----------------
const STRIPS = [['star', 'girl', 'bar', 'mascot', 'girl', 'star', '7', 'bar'], ['mascot', 'bar', 'girl', 'star', 'girl', '7', 'star', 'bar'], ['girl', 'star', '7', 'mascot', 'bar', 'girl', 'star', 'bar']];
const CELL = 250, RX = [CX - 340, CX, CX + 340], RY = 590;
function reelPos(r, t) {
  const v = 14, t0 = 0.5, sp = (tt) => tt < t0 ? 0 : (tt - t0 < 0.25 ? v * Math.pow(tt - t0, 2) / 0.5 : v * (tt - t0 - 0.125));
  if (r === 0) { if (t < 1.4) return sp(t); const a = sp(1.4), b = 14; return a + (b - a) * eo(lin(t, 1.4, 1.6)) - 0.12 * Math.sin(lin(t, 1.6, 1.85) * Math.PI); }
  if (r === 1) { if (t < 1.9) return sp(t); const a = sp(1.9), b = 21; return a + (b - a) * eo(lin(t, 1.9, 2.1)) - 0.12 * Math.sin(lin(t, 2.1, 2.35) * Math.PI); }
  if (t < 1.9) return sp(t);
  const a = sp(1.9), b = 26.45;
  if (t < 3.4) return a + (b - a) * (1 - Math.pow(1 - lin(t, 1.9, 3.4), 1.4));
  if (t < 3.62) return b + Math.sin(t * 60) * 0.004;
  return b - 0.45 * eback(lin(t, 3.62, 3.8), 2.2);
}
function reelSpeed(r, t) { return Math.abs(reelPos(r, t + 0.01) - reelPos(r, t - 0.01)) / 0.02; }
function drawSymbol(ctx, sym, x, y, t) {
  ctx.save(); ctx.translate(x, y);
  if (sym === '7') {
    ctx.font = "230px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2a0008'; ctx.lineWidth = 30; ctx.strokeText('7', 0, 8);
    const gg = ctx.createLinearGradient(0, -90, 0, 90); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(1, '#c76a00'); ctx.strokeStyle = gg; ctx.lineWidth = 16; ctx.strokeText('7', 0, 8);
    const rg = ctx.createLinearGradient(0, -90, 0, 90); rg.addColorStop(0, '#ff8a8a'); rg.addColorStop(0.5, '#ff1a2a'); rg.addColorStop(1, '#8a0010'); ctx.fillStyle = rg; ctx.fillText('7', 0, 8);
  } else if (sym === 'bar') {
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#ffc21a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.roundRect(-110, -48, 220, 96, 14); ctx.fill(); ctx.stroke();
    ctx.font = "66px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('BAR', 0, 4);
  } else if (sym === 'star') {
    ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 42 : 100, a = i / 10 * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath();
    const sg = ctx.createRadialGradient(0, -20, 5, 0, 0, 100); sg.addColorStop(0, '#fffbe0'); sg.addColorStop(1, '#ffb000'); ctx.fillStyle = sg; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#8a5000'; ctx.stroke();
  } else if (sym === 'girl' && GIRL) {
    const r = 100; ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); const bg = ctx.createRadialGradient(0, -30, 0, 0, 0, r); bg.addColorStop(0, '#c8f0ff'); bg.addColorStop(1, '#3a7ae0'); ctx.fillStyle = bg; ctx.fill(); ctx.clip();
    const fx = FACE.x * GIRL.width, fy = FACE.y * GIRL.height, sz = FACE.s * GIRL.height * 1.9; ctx.drawImage(GIRL, fx - sz / 2, fy - sz * 0.42, sz, sz, -r, -r, r * 2, r * 2); ctx.restore();
    ctx.lineWidth = 8; ctx.strokeStyle = '#ff5aa5'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  } else if (sym === 'mascot' && MASCOT) { drawImg(ctx, MASCOT, 0, 0, 210); }
  else if (sym === 'mascot' || sym === 'girl') { ctx.fillStyle = '#ff5aa5'; ctx.beginPath(); ctx.arc(0, 0, 80, 0, 7); ctx.fill(); }
  ctx.restore();
}
function drawReel(ctx, r, t, glow) {
  const x = RX[r], p = reelPos(r, t), v = reelSpeed(r, t), strip = STRIPS[r], wW = 290, wH = 400;
  ctx.save(); ctx.beginPath(); ctx.roundRect(x - wW / 2, RY - wH / 2, wW, wH, 18); ctx.clip();
  const bg = ctx.createLinearGradient(0, RY - wH / 2, 0, RY + wH / 2); bg.addColorStop(0, '#cfd3dc'); bg.addColorStop(0.5, '#ffffff'); bg.addColorStop(1, '#cfd3dc');
  ctx.fillStyle = bg; ctx.fillRect(x - wW / 2, RY - wH / 2, wW, wH);
  if (glow > 0) { ctx.fillStyle = `hsla(${(t * 400 + r * 120) % 360},100%,70%,${glow * 0.5})`; ctx.fillRect(x - wW / 2, RY - wH / 2, wW, wH); }
  const k0 = Math.floor(p) - 2;
  for (let k = k0; k <= k0 + 4; k++) { const y = RY + (k - p) * CELL; const sym = strip[((k % 8) + 8) % 8];
    if (v > 5) { ctx.globalAlpha = 0.3; for (let j = -2; j <= 2; j++) drawSymbol(ctx, sym, x, y + j * Math.min(60, v * 2.5), t); ctx.globalAlpha = 1; }
    else drawSymbol(ctx, sym, x, y, t); }
  const sh = ctx.createLinearGradient(0, RY - wH / 2, 0, RY + wH / 2); sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(0.25, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = sh; ctx.fillRect(x - wW / 2, RY - wH / 2, wW, wH);
  ctx.restore();
  ctx.save(); ctx.lineWidth = 10; ctx.strokeStyle = glow > 0 ? `hsl(${(t * 600 + r * 120) % 360},100%,65%)` : '#3a3f4a'; if (glow > 0) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 30; }
  ctx.beginPath(); ctx.roundRect(x - wW / 2, RY - wH / 2, wW, wH, 18); ctx.stroke(); ctx.restore();
}
function drawMachine(ctx, t, reach, glow) {
  const mw = 1200, mh = 640, mx = CX - mw / 2, my = RY - mh / 2 + 10;
  // 霓虹外框
  ctx.save(); const hue = (t * 300) % 360; ctx.shadowColor = reach ? '#ff2a3a' : `hsl(${hue},100%,60%)`; ctx.shadowBlur = 40;
  ctx.strokeStyle = reach ? '#ff6a6a' : `hsl(${hue},100%,70%)`; ctx.lineWidth = 12; ctx.beginPath(); ctx.roundRect(mx - 22, my - 22, mw + 44, mh + 44, 46); ctx.stroke(); ctx.restore();
  const cg = ctx.createLinearGradient(0, my, 0, my + mh); cg.addColorStop(0, '#5a6070'); cg.addColorStop(0.08, '#e8ecf4'); cg.addColorStop(0.15, '#8a90a0'); cg.addColorStop(0.9, '#2a2e38'); cg.addColorStop(1, '#6a7080');
  ctx.fillStyle = cg; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, 36); ctx.fill();
  ctx.fillStyle = '#0c0d12'; ctx.beginPath(); ctx.roundRect(mx + 30, my + 90, mw - 60, mh - 130, 24); ctx.fill();
  // 上方招牌
  ctx.save(); ctx.font = "64px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffcf3a'; ctx.shadowBlur = 20; ctx.fillStyle = '#fff2a0'; ctx.fillText('★ JACKPOT ★', CX, my + 46); ctx.restore();
  // 燈泡
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) { for (const yy of [my + 92, my + mh - 30]) { const x = mx + 60 + i * (mw - 120) / 25; const on = ((i + Math.floor(t * 16)) % 3 === 0);
    const gr = ctx.createRadialGradient(x, yy, 0, x, yy, 16); gr.addColorStop(0, reach ? `rgba(255,${on ? 200 : 60},60,${on ? 1 : 0.4})` : `hsla(${(i * 20 + t * 300) % 360},100%,${on ? 85 : 55}%,${on ? 1 : 0.4})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - 16, yy - 16, 32, 32); } }
  ctx.restore();
  for (let r = 0; r < 3; r++) drawReel(ctx, r, t, glow);
  // 中獎線
  ctx.save(); ctx.strokeStyle = glow > 0 ? `hsl(${(t * 800) % 360},100%,65%)` : 'rgba(255,40,60,0.85)'; ctx.lineWidth = glow > 0 ? 10 : 5; if (glow > 0) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 30; }
  ctx.beginPath(); ctx.moveTo(mx + 40, RY); ctx.lineTo(mx + mw - 40, RY); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; for (const [ax, d] of [[mx + 40, 1], [mx + mw - 40, -1]]) { ctx.beginPath(); ctx.moveTo(ax, RY - 22); ctx.lineTo(ax + d * 30, RY); ctx.lineTo(ax, RY + 22); ctx.fill(); }
  ctx.restore();
}
function bigWord(ctx, txt, x, y, s, rot, fill, stroke = '#1a0838') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s); ctx.font = "150px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke; ctx.lineWidth = 40; ctx.strokeText(txt, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 12; ctx.strokeText(txt, 0, 0); ctx.fillStyle = fill; ctx.fillText(txt, 0, 0); ctx.restore();
}
function slotMain(ctx, m, t) {
  const hits = [[0, 1], [0.3, 0.8], [0.55, 0.5]]; for (let b = 0.8; b < 3.2; b += 0.4) hits.push([b, 0.35]);
  const pk = decay(m, hits, 13);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.06, 1 + pk * 0.06); ctx.translate(-CX, -CY); shakeAt(ctx, t, 4 + pk * 30);
  rainbowBG(ctx, t * 2.6);
  // 背後巨大 777
  ctx.save(); ctx.globalAlpha = 0.28; ctx.font = "620px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.translate(CX, CY + 20); ctx.scale(1 + pk * 0.08, 1 + pk * 0.08); ctx.fillStyle = '#fff'; ctx.fillText('777', 0, 0); ctx.restore();
  coinFountain(ctx, m, 0, 3.0, 220);
  const gk = lin(m, 0.12, 0.42); if (gk > 0) { if (gk < 1) for (let k = 1; k <= 4; k++) drawImg(ctx, silhouette(GIRL_SIL, `hsl(${k * 70},100%,60%)`), 1500 + (1 - eo5(gk)) * 900 + k * 90 * (1 - gk), 820, 1700, 0.03, 0.35);
    girlAt(ctx, 1500 + (1 - eo5(gk)) * 900, 820, 1700 + pk * 40, t); }
  const tk = lin(m, 0.3, 0.48);
  if (tk > 0) { const s = tk < 1 ? 2.6 - 1.6 * eback(tk, 1.4) : 1 + pk * 0.08;
    if (m > 0.55) { const bp = ((m - 0.3) % 0.2) / 0.2; ctx.save(); ctx.globalAlpha = (1 - bp) * 0.45; titleText(ctx, t, 730, 420, 1.3 * (1 + bp * 0.35), -0.08); ctx.restore(); }
    title3D(ctx, t, 730, 420, s * 1.3, -0.08, 18, ['#2a0a50', '#4a1080']); }
  subLine(ctx, t, eo(lin(m, 0.6, 0.8)));
  mascotAt(ctx, t, lin(m, 0.55, 0.85));
  ctx.restore();
  confetti(ctx, m, 0, 120, ['#ff5aa5', '#ffe14a', '#5ad8ff', '#7aff8a', '#fff'], 7);
  if (m > 0.5) { const e = 1 - eo5(lin(m, 0.5, 0.7)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  ledFrame(ctx, t);
  if (m >= 0.3) flash(ctx, (1 - lin(m, 0.3, 0.4)) * 0.4, '#fff');
}
function sceneSlot(ctx, t) {
  const D = CFG.dur, JP = 4.0, EX = D - 0.6;
  if (t >= EX) { const k = lin(t, EX, D - 0.02); exitSmear(ctx, k, Math.floor(t * 60), (c) => slotMain(c, t - JP, t)); return; }
  if (t >= JP) { slotMain(ctx, t - JP, t); flash(ctx, (1 - lin(t, JP, JP + 0.18)) * 0.85); return; }
  const reach = t >= 1.9 && t < 3.62, miss = t >= 3.4 && t < 3.62, win = t >= 3.8;
  const appear = eo5(lin(t, 0, 0.4));
  // 背景
  ctx.fillStyle = `rgba(0,0,0,${0.8 * appear})`; ctx.fillRect(0, 0, W, H);
  if (reach) { ctx.save(); ctx.globalAlpha = miss ? 0.35 : 0.65 + Math.sin(t * 25) * 0.15; palBG(ctx, t, PAL.red, CX + 340, RY); ctx.restore(); }
  if (t >= 3.62) { ctx.save(); ctx.globalAlpha = 0.8; rainbowBG(ctx, t * 3); ctx.restore(); }
  // 鏡頭推近第三輪
  const push = reach && !miss ? eo(lin(t, 2.3, 3.4)) * 0.45 : (miss ? 0.45 - 0.1 * eo(lin(t, 3.4, 3.62)) : 0);
  const pull = t >= 3.62 ? (1 - eo5(lin(t, 3.62, 3.78))) * 0.35 : 0;
  const z = 1 + push + pull, fx = CX + 340 * Math.min(1, (push + pull) / 0.45);
  const hitList = [[1.4, 0.6], [1.9, 0.8], [3.4, 0.5], [3.62, 1.2], [3.8, 0.9]];
  ctx.save(); shakeAt(ctx, t, decay(t, hitList, 10) * 26 + (reach && !miss ? 3 : 0));
  ctx.translate(fx, RY); ctx.scale(z, z); ctx.translate(-fx, -RY);
  ctx.translate(0, (1 - appear) * 900);
  drawMachine(ctx, t, reach, win ? 1 : 0);
  // 777 光柱
  if (win) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = lin(t, 3.8, 4.0);
    for (let r = 0; r < 3; r++) { const gr = ctx.createLinearGradient(0, RY, 0, -200); gr.addColorStop(0, `hsla(${(t * 600 + r * 120) % 360},100%,70%,0.9)`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(RX[r] - 90 * k, -200, 180 * k, RY + 200); } ctx.restore(); }
  ctx.restore();
  if (miss) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H); }
  // 字卡
  if (reach && !miss) { const k = lin(t, 1.92, 2.08); const s = k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1 + Math.sin(t * 20) * 0.03;
    const col = Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a'; bigWord(ctx, 'REACH!!', CX, 175, s * 1.05, -0.05, col); }
  if (t >= 3.62 && t < 4.0) { const k = lin(t, 3.62, 3.74); bigWord(ctx, '復活!!', CX - 560, 880, (k < 1 ? 2.4 - 1.4 * eback(k, 1.6) : 1) * 1.1, -0.18, rainbowFill(ctx, -60, 60, t)); }
  if (win) { const k = lin(t, 3.82, 3.95); bigWord(ctx, 'JACKPOT!!', CX, 175, (k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1) * 1.1, -0.04, rainbowFill(ctx, -60, 60, t)); }
  if (t >= 3.62) flash(ctx, (1 - lin(t, 3.62, 3.74)) * 0.6, '#fff');
  for (const ts of [1.4, 1.9]) if (t >= ts) flash(ctx, (1 - lin(t, ts, ts + 0.08)) * 0.18, '#fff');
}

// ---------------- ×100 神降臨 ----------------
let SHARDS = null;
function makeShards() {
  const cols = 9, rows = 6, P = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const edge = i === 0 || j === 0 || i === cols || j === rows;
    P.push([i / cols * W + (edge ? 0 : (R(i + j * 20, 1) - 0.5) * W / cols * 0.8), j / rows * H + (edge ? 0 : (R(i + j * 20, 2) - 0.5) * H / rows * 0.8)]); }
  const S = [], id = (i, j) => j * (cols + 1) + i;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = P[id(i, j)], b = P[id(i + 1, j)], c = P[id(i + 1, j + 1)], d = P[id(i, j + 1)];
    for (const tri of (R(i, j) < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]])) { const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3; S.push({ tri, cx, cy, k: S.length }); } }
  return S;
}
function cosmos(ctx, t, warp) {
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#020010'); bg.addColorStop(0.6, '#0e0630'); bg.addColorStop(1, '#2a0a3a');
  ctx.fillStyle = bg; ctx.fillRect(-60, -60, W + 120, H + 120);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) { const hue = (i * 52 + t * 40) % 360; const x = CX + Math.cos(i * 1.7 + t * 0.15) * 700, y = CY + Math.sin(i * 2.3 + t * 0.12) * 380;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 650); gr.addColorStop(0, `hsla(${hue},90%,55%,0.28)`); gr.addColorStop(1, `hsla(${hue},90%,40%,0)`); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
  for (let i = 0; i < 220; i++) { const a = R(i, 41) * Math.PI * 2, d = ((R(i, 42) + t * (0.08 + warp * 0.9)) % 1); const r = d * d * 1500;
    const x = 1350 + Math.cos(a) * r, y = 380 + Math.sin(a) * r, len = 2 + warp * r * 0.25;
    ctx.strokeStyle = `rgba(255,255,255,${0.3 + d * 0.7})`; ctx.lineWidth = 1 + d * 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * len, y - Math.sin(a) * len); ctx.stroke(); }
  ctx.restore();
}
function haloRing(ctx, t, x, y, r, a, pulse) {
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = 'rgba(255,220,120,1)'; ctx.shadowBlur = 40 + pulse * 40;
  ctx.strokeStyle = `rgba(255,236,160,${0.9})`; ctx.lineWidth = 14 + pulse * 10; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, 7); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.save(); ctx.rotate(t * 0.4); ctx.strokeStyle = 'rgba(255,240,190,0.9)'; ctx.lineWidth = 5;
  for (let i = 0; i < 48; i++) { const an = i / 48 * Math.PI * 2, l = i % 4 ? 16 : 40; ctx.beginPath(); ctx.moveTo(Math.cos(an) * r * 1.12, Math.sin(an) * r * 1.12); ctx.lineTo(Math.cos(an) * (r * 1.12 + l), Math.sin(an) * (r * 1.12 + l)); ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.rotate(-t * 0.7); ctx.fillStyle = 'rgba(255,250,220,0.95)';
  for (let i = 0; i < 12; i++) { const an = i / 12 * Math.PI * 2; ctx.save(); ctx.translate(Math.cos(an) * r * 0.91, Math.sin(an) * r * 0.91); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 0); ctx.lineTo(0, 14); ctx.lineTo(-9, 0); ctx.fill(); ctx.restore(); }
  ctx.strokeStyle = 'rgba(255,230,160,0.35)'; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i <= 12; i++) { const an = i * 5 / 12 * Math.PI * 2; i ? ctx.lineTo(Math.cos(an) * r * 0.8, Math.sin(an) * r * 0.8) : ctx.moveTo(Math.cos(an) * r * 0.8, Math.sin(an) * r * 0.8); } ctx.stroke();
  ctx.restore(); ctx.restore();
}
function fireworksAt(ctx, t, list) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [ft, fx, fy, hue] of list) { const p = t - ft; if (p < 0 || p > 1.1) continue;
    for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2 + R(i, ft); const r = eo(p / 1.1) * (260 + R(i, 7) * 90);
      const x = fx + Math.cos(a) * r, y = fy + Math.sin(a) * r + 170 * p * p, q = p / 1.1;
      ctx.strokeStyle = `hsla(${(hue + i * 5) % 360},100%,${70 + 20 * (1 - q)}%,${1 - q})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * 34 * (1 - q), y - Math.sin(a) * 34 * (1 - q)); ctx.stroke(); }
    star4(ctx, fx, fy, 140 * (1 - p / 1.1), '#fff', 1 - p / 1.1); }
  ctx.restore();
}
function headPos(gx, gy, gh) { const w = GIRL.width * gh / GIRL.height; return [gx - w / 2 + FACE.x * w, gy - gh / 2 + FACE.y * gh]; }
function godMain(ctx, t) {   // t：本級時間（2.9 之後）
  const LAND = 4.1, TT = 4.35, hits = [[LAND, 1], [TT, 1.2], [4.85, 0.8]]; for (let b = 5.15; b < CFG.dur - 0.8; b += 0.4) hits.push([b, 0.4]);
  const pk = decay(t, hits, 12);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.06, 1 + pk * 0.06); ctx.translate(-CX, -CY); shakeAt(ctx, t, 3 + pk * 34);
  const warp = t < 3.7 ? 1 - lin(t, 2.9, 3.7) * 0.85 : 0.15;
  cosmos(ctx, t, warp);
  const gx = 1360, gh = 1700, gyF = 820;
  const dk = lin(t, 3.05, LAND), gy = gyF - (1 - eo(dk)) * 1900;
  // 光柱
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const pa = lin(t, 2.9, 3.2) * (0.7 + pk * 0.3);
  let gr = ctx.createLinearGradient(gx - 300, 0, gx + 300, 0); gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, `rgba(255,250,230,${0.55 * pa})`); gr.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = gr; ctx.fillRect(gx - 300, -60, 600, H + 120);
  gr = ctx.createLinearGradient(gx - 70, 0, gx + 70, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${0.8 * pa})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(gx - 70, -60, 140, H + 120);
  if (t > LAND) godRays(ctx, gx, 300, 36, `rgba(255,240,190,${0.1 + pk * 0.15})`, t * 0.3, 2600, 0.45);
  if (t > LAND) for (let h = 0; h < 6; h++) godRays(ctx, gx, 300, 6, `hsla(${(h * 60 + t * 90) % 360},100%,60%,${0.16 * lin(t, LAND, LAND + 0.4)})`, -t * 0.25 + h * Math.PI / 18, 2600, 0.5);
  ctx.restore();
  // 光環（跟著頭）
  if (GIRL) { const [hx, hy] = headPos(gx, gy, gh); haloRing(ctx, t, hx, hy - 20, 330 + pk * 30, lin(t, 3.4, 4.0), decay(t, hits, 8)); }
  // 羽毛
  ctx.save(); for (let i = 0; i < 50; i++) { const st = 2.9 + R(i, 51) * 4, l = t - st; if (l < 0) continue; const y = -40 + l * (90 + R(i, 52) * 120); if (y > H + 40) continue;
    const x = gx + (R(i, 53) - 0.5) * 1500 + Math.sin(l * 2 + i) * 80; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(l * 2.5 + i) * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 22, 0, 0, 7); ctx.fill(); ctx.restore(); } ctx.restore();
  // 角色降臨：先是白色光影，著地後轉成彩色
  if (GIRL && dk > 0) { const wk = lin(t, 3.6, LAND + 0.1);
    neonOutline(ctx, GIRL_SIL, gx, gy, gh + pk * 40, t, 0.03);
    drawImg(ctx, GIRL, gx, gy, gh + pk * 40, 0.03, wk);
    if (wk < 1) drawImg(ctx, silhouette(GIRL_SIL, '#fffbe8'), gx, gy, gh + pk * 40, 0.03, 1 - wk); }
  coins(ctx, t - TT + T_HIT); coins(ctx, t - 4.85 + T_HIT);
  const tk = lin(t, TT, TT + 0.2);
  if (tk > 0) { const s = tk < 1 ? 3.2 - 2.2 * eback(tk, 1.4) : 1 + pk * 0.08;
    if (t > TT + 0.25) { const bp = ((t - TT) % 0.2) / 0.2; ctx.save(); ctx.globalAlpha = (1 - bp) * 0.5; titleText(ctx, t, 640, 420, 1.45 * (1 + bp * 0.4), -0.08); ctx.restore(); }
    title3D(ctx, t, 640, 420, s * 1.45, -0.08, 22, ['#3a1a00', '#7a4a00']); }
  premiumExtra(ctx, t - 0.23, pk);   // ×100 徽章（4.85 砸下）
  subLine(ctx, t, eo(lin(t, 4.95, 5.15)), 760, 760, 1.25);
  mascotAt(ctx, t, lin(t, 5.05, 5.35), 230, 870, 470);
  fireworksAt(ctx, t, [[5.3, 420, 220, 50], [5.65, 1100, 160, 300], [6.0, 760, 120, 180], [6.35, 260, 360, 10], [6.7, 1550, 220, 120], [7.05, 980, 260, 260], [7.4, 420, 160, 330], [7.75, 1300, 140, 60], [8.1, 700, 220, 200]]);
  ctx.restore();
  confetti(ctx, t, 4.35, 200, ['#ffe27a', '#fff6c0', '#ff5aa5', '#5ad8ff', '#ffffff'], 5);
  if (t > 4.6) { const e = 1 - eo5(lin(t, 4.6, 4.8)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  if (t > 4.4) ledFrame(ctx, t);
  if (t >= LAND) flash(ctx, (1 - lin(t, LAND, LAND + 0.12)) * 0.55, '#fff3c8');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.12)) * 0.75, '#fff');
}
function sceneGod(ctx, t) {
  const D = CFG.dur, SH = 2.9, EX = D - 0.8;
  if (!SHARDS) SHARDS = makeShards();
  if (t < 0.5) { sceneTeaser(bctx, t * 0.8); ctx.filter = `hue-rotate(${(t * 700) % 360}deg) saturate(1.6)`; ctx.drawImage(buf, 0, 0); ctx.filter = 'none'; return; }
  if (t < 1.1) {   // 凍結：畫面卡住＋訊號崩壞
    const f = Math.floor(t * 60), stut = Math.floor(t * 20) % 3;
    bctx.setTransform(1, 0, 0, 1, 0, 0); sceneTeaser(bctx, 0.4 - stut * 0.004);
    ctx.filter = 'hue-rotate(200deg) saturate(1.6)'; ctx.drawImage(buf, 0, 0); ctx.filter = 'none';
    const tmp = mk(); tmp.getContext('2d').drawImage(cv, 0, 0); ctx.clearRect(0, 0, W, H); sliceShift(ctx, tmp, t, 260 * lin(t, 0.5, 1.1) + 40, f);
    ctx.save(); for (let i = 0; i < 14; i++) { ctx.fillStyle = `hsla(${R(f, i) * 360},100%,60%,0.75)`; ctx.fillRect(R(f, i + 20) * W, R(f, i + 40) * H, 40 + R(f, i + 60) * 420, 8 + R(f, i + 80) * 50); } ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.18; for (let y = 0; y < H; y += 4) { ctx.fillStyle = R(f, y) < 0.5 ? '#000' : '#fff'; ctx.fillRect(0, y, W, 2); } ctx.restore();
    if (t > 1.0) flash(ctx, lin(t, 1.0, 1.1), '#000');
    return;
  }
  if (t < SH) {   // 全黑 → 裂痕
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const steps = [[2.0, 0.28], [2.3, 0.55], [2.6, 0.85]]; let gro = 0; for (const [ts, gv] of steps) if (t >= ts) gro = gv * (0.85 + 0.15 * eo5(lin(t, ts, ts + 0.08)));
    if (gro > 0) { ctx.save(); shakeAt(ctx, t, decay(t, steps.map(([a]) => [a, 1]), 14) * 22);
      ctx.save(); ctx.shadowColor = `hsl(${(t * 400) % 360},100%,60%)`; ctx.shadowBlur = 30; cracks(ctx, 77, CX + 60, CY - 30, gro, `hsl(${(t * 400) % 360},100%,75%)`, 9); ctx.restore();
      cracks(ctx, 77, CX + 60, CY - 30, gro, '#fff', 3);
      const gl = ctx.createRadialGradient(CX + 60, CY - 30, 0, CX + 60, CY - 30, 120 + gro * 300); gl.addColorStop(0, `rgba(255,255,255,${0.5 * gro})`); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    if (t > 2.65) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,255,${ei(lin(t, 2.65, SH)) * 0.35})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    return;
  }
  if (t >= EX) {   // 昇天退場：白光上升後淡出
    const k = lin(t, EX, D - 0.02);
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.clearRect(0, 0, W, H); godMain(bctx, t);
    ctx.save(); ctx.globalAlpha = 1 - ei(lin(k, 0.35, 1)); ctx.translate(CX, CY); ctx.scale(1 + k * 0.08, 1 + k * 0.08); ctx.translate(-CX, -CY - k * 120); ctx.drawImage(buf, 0, 0); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(0, H, 0, H - 1600 * eo(k)); gr.addColorStop(0, `rgba(255,250,230,${Math.sin(k * Math.PI) * 0.9})`); gr.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${ei(lin(k, 0.6, 1))})`; ctx.fillRect(0, 0, W, H); ctx.restore();
    return;
  }
  godMain(ctx, t);
  // 玻璃碎片往鏡頭飛
  const k = lin(t, SH, SH + 0.75);
  if (k < 1) { ctx.save();
    for (const s of SHARDS) { const q = eo(Math.min(1, k * (0.8 + R(s.k, 1) * 0.6))); const dx = s.cx - CX, dy = s.cy - CY;
      const sc = 1 + q * (1.5 + R(s.k, 2) * 2); const nx = CX + dx * (1 + q * 2.2), ny = CY + dy * (1 + q * 2.2) + q * q * 300;
      ctx.save(); ctx.globalAlpha = 1 - ei(q); ctx.translate(nx, ny); ctx.rotate((R(s.k, 3) - 0.5) * 5 * q); ctx.scale(sc, sc);
      ctx.beginPath(); ctx.moveTo(s.tri[0][0] - s.cx, s.tri[0][1] - s.cy); ctx.lineTo(s.tri[1][0] - s.cx, s.tri[1][1] - s.cy); ctx.lineTo(s.tri[2][0] - s.cx, s.tri[2][1] - s.cy); ctx.closePath();
      ctx.fillStyle = '#05050a'; ctx.fill(); ctx.strokeStyle = `hsla(${(s.k * 37 + t * 300) % 360},100%,80%,0.9)`; ctx.lineWidth = 3 / sc; ctx.stroke(); ctx.restore(); }
    ctx.restore(); }
  if (t < SH + 0.15) flash(ctx, (1 - lin(t, SH, SH + 0.15)) * 0.7, '#fff');
}

// 覆寫高階等級
Object.assign(TIERS.g25, { kind: 'gate', dur: 5.6, pal: 'gold', title: '大量贈訂!!', ticker: 'GOLDEN ★ BIG CHANCE ★', mascot: true, coins: 80 });
Object.assign(TIERS.g50, { kind: 'slot', dur: 7.6, pal: 'rainbow', title: '大物降臨!!', ticker: 'JACKPOT ★ 777 ★', mascot: true, coins: 90 });
Object.assign(TIERS.g100, { kind: 'god', dur: 9.4, pal: 'premium', title: '神降臨!!', ticker: 'PREMIUM ★ 神降臨 ★', mascot: true, coins: 120 });
const HI = { gate: sceneGate, slot: sceneSlot, god: sceneGod };

// ======================= 第三輪：×10 PUSH／各級獨立結尾構圖／×50 慢速復活／×100 加碼 =======================
// （同名 function 會覆寫 tier_hi.js 的版本）
function glyph(ctx, t, ch, x, y, s, rot, pal, depth = 0, ext = ['#3a1a00', '#7a4a00']) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = "200px 'Dela Gothic One', 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let i = depth; i >= 1; i--) { ctx.strokeStyle = ext[i % 2]; ctx.lineWidth = 56; ctx.strokeText(ch, i * 1.4, i * 2.2); }
  ctx.shadowColor = pal.glow; ctx.shadowBlur = 40; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 56; ctx.strokeText(ch, 0, 0); ctx.shadowBlur = 0;
  const gold = ctx.createLinearGradient(0, -110, 0, 110); gold.addColorStop(0, '#fff6c0'); gold.addColorStop(0.45, '#ffb21a'); gold.addColorStop(0.55, '#c76a00'); gold.addColorStop(1, '#ffe27a');
  ctx.strokeStyle = gold; ctx.lineWidth = 34; ctx.strokeText(ch, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.strokeText(ch, 0, 0);
  ctx.fillStyle = palFill(ctx, -95, 95, t, pal); ctx.fillText(ch, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-300, -120, 600, 95); ctx.clip(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillText(ch, 0, 0); ctx.restore();
  ctx.restore();
}
function splitTitle(txt) { const out = []; for (const ch of Array.from(txt)) { if (ch === '!' && out.length && /^!+$/.test(out[out.length - 1])) out[out.length - 1] += ch; else if (ch !== ' ') out.push(ch); } return out; }
let MASCOT_FLIP = null;
function mascotFlip() { if (!MASCOT) return null; if (!MASCOT_FLIP || MASCOT_FLIP.src !== MASCOT) { const c = mk(MASCOT.width, MASCOT.height), x = c.getContext('2d'); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(MASCOT, 0, 0); MASCOT_FLIP = { c, src: MASCOT }; } return MASCOT_FLIP.c; }
function mascotAt2(ctx, t, k, x, y, h, flip = false) {
  const img = flip ? mascotFlip() : MASCOT; if (!img || k <= 0) return;
  const s = eback(k, 2.6), bob = Math.abs(Math.sin(t * 15.7 + (flip ? 1 : 0))) * -26, mr = (flip ? 0.1 : -0.1) + Math.sin(t * 15.7) * 0.08;
  neonOutline(ctx, img, x, y + bob, h * s, t + 0.3, mr); drawImg(ctx, img, x, y + bob, h * s, mr);
}

// ---------------- ×25 結尾：直書大字（左）＋聚光角色（中右） ----------------
function gateMain(ctx, m, t) {
  const pal = PAL.gold, chars = splitTitle(CFG.title);
  const hits = [[0, 1]]; chars.forEach((c, i) => hits.push([0.35 + i * 0.1, 0.55])); for (let b = 1.2; b < 3.4; b += 0.4) hits.push([b, 0.3]);
  const pk = decay(m, hits, 13);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.04, 1 + pk * 0.04); ctx.translate(-CX, -CY); shakeAt(ctx, t, 4 + pk * 22);
  const bg = ctx.createRadialGradient(1250, 200, 0, 1250, 200, 1700);
  bg.addColorStop(0, '#fffbe6'); bg.addColorStop(0.15, '#ffe27a'); bg.addColorStop(0.45, '#d08a00'); bg.addColorStop(0.8, '#5a2a00'); bg.addColorStop(1, '#1a0a00');
  ctx.fillStyle = bg; ctx.fillRect(-60, -60, W + 120, H + 120);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  godRays(ctx, 1250, -300, 22, 'rgba(255,240,170,0.13)', 1.1 + Math.sin(m * 0.8) * 0.12, 2600, 0.4);
  const sp = ctx.createLinearGradient(1250, 0, 1250, H); sp.addColorStop(0, 'rgba(255,250,210,0.8)'); sp.addColorStop(1, 'rgba(255,220,120,0.12)');
  ctx.fillStyle = sp; ctx.beginPath(); ctx.moveTo(1120, -60); ctx.lineTo(1380, -60); ctx.lineTo(1700, H + 60); ctx.lineTo(800, H + 60); ctx.fill();
  const fl = ctx.createRadialGradient(1250, 1010, 0, 1250, 1010, 520); fl.addColorStop(0, 'rgba(255,250,220,0.6)'); fl.addColorStop(1, 'rgba(255,220,120,0)');
  ctx.fillStyle = fl; ctx.save(); ctx.translate(0, 1010); ctx.scale(1, 0.22); ctx.translate(0, -1010); ctx.fillRect(600, 400, 1300, 1300); ctx.restore();
  ctx.restore();
  const gk = lin(m, 0.1, 0.5); if (gk > 0) girlAt(ctx, 1250, 840 + (1 - eo5(gk)) * 700, 1720 + pk * 30, t);
  // 直書大字（逐字砸下）
  const n = chars.length, step = Math.min(200, 960 / n), y0 = CY - step * (n - 1) / 2;
  if (isLatinTitle()) heroTitle(ctx, t, 300, CY, lin(m, 0.35, 0.53), { maxW: 900, rot: -Math.PI / 2, pk });   /* 英文標題不逐字直排，整行轉 90 度 */
  else chars.forEach((c, i) => { const k = lin(m, 0.35 + i * 0.1, 0.5 + i * 0.1); if (k <= 0) return;
    const s = k < 1 ? 2.6 - 1.65 * eback(k, 1.5) : 0.95 + decay(m, [[0.35 + i * 0.1, 1]], 10) * 0.06;
    glyph(ctx, t, c, 300 + (i % 2 ? 14 : -14), y0 + i * step, s * (c.length > 1 ? 0.9 : 1), (i % 2 ? 0.05 : -0.05), pal, 12, ['#5a3000', '#7a4200']); });
  for (let i = 0; i < n; i++) coins(ctx, m - 0.35 - i * 0.1 + T_HIT);
  subLine(ctx, t, eo(lin(m, 0.95, 1.15)), 1300, 955, 1.0);
  mascotAt2(ctx, t, lin(m, 1.05, 1.35), 690, 900, 380);
  ctx.restore();
  confetti(ctx, m, 0.05, 170, ['#ffe27a', '#fff6c0', '#ffb21a', '#ffffff', '#ff5a5a'], 3);
  ledFrameHue(ctx, t, (i) => 38 + ((i * 7 + t * 80) % 20));
  if (m >= 0.35) flash(ctx, (1 - lin(m, 0.35, 0.45)) * 0.3, '#fff3b0');
}

// ---------------- ×50：慢速差一格 → 靜止 → 倒退復活 ----------------
const SL = { STOP: 4.35, REV: 5.0, LOCK: 5.42, JP: 5.68 };
function reelPos(r, t) {
  const v = 14, t0 = 0.5, sp = (tt) => tt < t0 ? 0 : (tt - t0 < 0.25 ? v * Math.pow(tt - t0, 2) / 0.5 : v * (tt - t0 - 0.125));
  if (r === 0) { if (t < 1.4) return sp(t); const a = sp(1.4), b = 14; return a + (b - a) * eo(lin(t, 1.4, 1.6)) - 0.12 * Math.sin(lin(t, 1.6, 1.85) * Math.PI); }
  if (r === 1) { if (t < 1.9) return sp(t); const a = sp(1.9), b = 21; return a + (b - a) * eo(lin(t, 1.9, 2.1)) - 0.12 * Math.sin(lin(t, 2.1, 2.35) * Math.PI); }
  if (t < 1.9) return sp(t);
  const a = sp(1.9), K = 1.6, A = (26.5 - a) / (1 - Math.exp(-K * (SL.STOP - 1.9)));
  if (t < SL.STOP) return a + A * (1 - Math.exp(-K * (t - 1.9)));
  if (t < SL.REV) { const tw = lin(t, 4.68, 4.84); return 26.5 - (tw > 0 && tw < 1 ? Math.sin(tw * Math.PI * 3) * 0.04 : 0); }
  return 26.5 - 0.5 * eback(lin(t, SL.REV, SL.LOCK), 1.8);
}
function odometer(ctx, x, y, val, t) {   // 兩位數滾輪計數器
  const digits = [Math.floor(val / 10) + Math.max(0, (val % 10) - 9), val % 10];
  digits.forEach((dv, j) => { const cx = x + j * 170, wW = 150, wH = 210;
    ctx.save(); ctx.beginPath(); ctx.roundRect(cx - wW / 2, y - wH / 2, wW, wH, 16); const bg = ctx.createLinearGradient(0, y - wH / 2, 0, y + wH / 2); bg.addColorStop(0, '#3a0010'); bg.addColorStop(0.5, '#8a0020'); bg.addColorStop(1, '#3a0010');
    ctx.fillStyle = bg; ctx.fill(); ctx.clip();
    ctx.font = "170px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = Math.floor(dv) - 1; k <= Math.floor(dv) + 2; k++) { const yy = y + (k - dv) * -wH + 8; const d = ((k % 10) + 10) % 10;
      const gg = ctx.createLinearGradient(0, yy - 70, 0, yy + 70); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(1, '#ffb000'); ctx.fillStyle = gg; ctx.fillText(String(d), cx, yy); }
    const sh = ctx.createLinearGradient(0, y - wH / 2, 0, y + wH / 2); sh.addColorStop(0, 'rgba(0,0,0,0.6)'); sh.addColorStop(0.3, 'rgba(0,0,0,0)'); sh.addColorStop(0.7, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = sh; ctx.fillRect(cx - wW / 2, y - wH / 2, wW, wH); ctx.restore();
    ctx.save(); ctx.lineWidth = 8; ctx.strokeStyle = `hsl(${(t * 400 + j * 90) % 360},100%,65%)`; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 20; ctx.beginPath(); ctx.roundRect(cx - wW / 2, y - wH / 2, wW, wH, 16); ctx.stroke(); ctx.restore(); });
}
function slotMain(ctx, m, t) {   // 結尾：角色在左指向右邊的大字＋計數器
  const done = 1.7, hits = [[0, 1], [0.3, 0.8], [done, 0.9]]; for (let b = 2.1; b < 3.4; b += 0.4) hits.push([b, 0.35]);
  const pk = decay(m, hits, 13);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.05, 1 + pk * 0.05); ctx.translate(-CX, -CY); shakeAt(ctx, t, 4 + pk * 28);
  rainbowBG(ctx, t * 2.6);
  ctx.save(); ctx.globalAlpha = 0.25; ctx.font = "560px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.translate(1250, 560); ctx.rotate(-0.06); ctx.scale(1 + pk * 0.08, 1 + pk * 0.08); ctx.fillStyle = '#fff'; ctx.fillText('777', 0, 0); ctx.restore();
  coinFountain(ctx, m, 0, 3.2, 240);
  const gk = lin(m, 0.1, 0.4);
  if (gk > 0) { const gx = 470 - (1 - eo5(gk)) * 900; if (gk < 1) for (let k = 1; k <= 4; k++) drawImg(ctx, silhouette(GIRL_SIL, `hsl(${k * 70},100%,60%)`), gx - k * 90 * (1 - gk), 830, 1700, -0.02, 0.35);
    neonOutline(ctx, GIRL_SIL, gx, 830, 1700 + pk * 40, t, -0.02); drawImg(ctx, GIRL, gx, 830, 1700 + pk * 40, -0.02); }
  const tk = lin(m, 0.3, 0.48);
  if (tk > 0) { const s = tk < 1 ? 2.6 - 1.6 * eback(tk, 1.4) : 1 + pk * 0.06;
    title3D(ctx, t, 1250, 290, s * 1.05, -0.06, 18, ['#2a0a50', '#4a1080']); }
  // 名字＋計數器
  const nk = eo(lin(m, 0.5, 0.7));
  if (nk > 0) { ctx.save(); ctx.globalAlpha = nk;
    ctx.fillStyle = 'rgba(20,6,40,0.85)'; ctx.beginPath(); ctx.moveTo(840, 480); ctx.lineTo(1780, 460); ctx.lineTo(1760, 800); ctx.lineTo(860, 815); ctx.fill();
    ctx.font = "900 54px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 12; fitText(ctx, CFG.sub1, 1300, 530, 860, "900 54px 'Noto Sans TC'", '#fff', '#1a0838', 12, 'center');
    const c = CFG.n * eo(lin(m, 0.6, done));
    odometer(ctx, 1060, 660, c, t);
    const ds = m >= done ? 1 + decay(m, [[done, 1]], 8) * 0.25 : 1;
    ctx.save(); ctx.translate(1530, 665); ctx.scale(ds, ds); ctx.font = "900 92px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 16; ctx.strokeText(LX('lblGift0'), 0, 0, 400); const ag = ctx.createLinearGradient(0, -46, 0, 46); ag.addColorStop(0, '#fff3a0'); ag.addColorStop(1, '#ff7a00'); ctx.fillStyle = ag; ctx.fillText(LX('lblGift0'), 0, 0, 400); ctx.restore();
    ctx.restore(); }
  mascotAt2(ctx, t, lin(m, 0.8, 1.1), 1690, 935, 300, true);
  ctx.restore();
  confetti(ctx, m, 0, 130, ['#ff5aa5', '#ffe14a', '#5ad8ff', '#7aff8a', '#fff'], 7);
  if (m > 0.5) { const e = 1 - eo5(lin(m, 0.5, 0.7)); tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); }
  ledFrame(ctx, t);
  if (m >= 0.3) flash(ctx, (1 - lin(m, 0.3, 0.4)) * 0.4, '#fff');
  if (m >= done) flash(ctx, (1 - lin(m, done, done + 0.1)) * 0.3, '#ffe680');
}
function sceneSlot(ctx, t) {
  const D = CFG.dur, JP = SL.JP, EX = D - 0.6;
  if (t >= EX) { const k = lin(t, EX, D - 0.02); exitSmear(ctx, k, Math.floor(t * 60), (c) => slotMain(c, t - JP, t)); return; }
  if (t >= JP) { slotMain(ctx, t - JP, t); flash(ctx, (1 - lin(t, JP, JP + 0.18)) * 0.85); return; }
  const reach = t >= 1.9 && t < SL.STOP, miss = t >= SL.STOP && t < SL.REV, rev = t >= SL.REV, win = t >= SL.LOCK;
  const appear = eo5(lin(t, 0, 0.4));
  ctx.fillStyle = `rgba(0,0,0,${0.8 * appear})`; ctx.fillRect(0, 0, W, H);
  if (reach) { ctx.save(); ctx.globalAlpha = 0.65 + Math.sin(t * (18 + (t - 1.9) * 10)) * 0.15; palBG(ctx, t, PAL.red, CX + 340, RY); ctx.restore(); }
  if (miss) { ctx.save(); ctx.globalAlpha = 0.3 * (1 - lin(t, SL.STOP, SL.STOP + 0.3)); palBG(ctx, t, PAL.red, CX + 340, RY); ctx.restore(); }
  if (rev) { ctx.save(); ctx.globalAlpha = 0.85; rainbowBG(ctx, t * 3); ctx.restore(); }
  // 鏡頭：REACH 慢慢推近第三輪；差一格時停在近景；復活時拉回
  let z = 1;
  if (reach) z = 1 + eo(lin(t, 2.2, SL.STOP)) * 0.62;
  else if (miss) z = 1.62 + lin(t, SL.STOP, SL.REV) * 0.08;
  else if (rev) z = 1 + (1 - eo5(lin(t, SL.REV + 0.05, SL.REV + 0.4))) * 0.7;
  const fx = CX + 340 * Math.min(1, (z - 1) / 0.6);
  const hitList = [[1.4, 0.6], [1.9, 0.8], [SL.STOP, 0.5], [SL.REV, 1.3], [SL.LOCK, 0.9]];
  ctx.save(); shakeAt(ctx, t, decay(t, hitList, 10) * 26 + (reach ? 2 + lin(t, 3.2, SL.STOP) * 6 : 0));
  ctx.translate(fx, RY); ctx.scale(z, z); ctx.translate(-fx, -RY);
  ctx.translate(0, (1 - appear) * 900);
  drawMachine(ctx, t, reach || miss, win ? 1 : 0);
  if (win) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = lin(t, SL.LOCK, SL.LOCK + 0.2);
    for (let r = 0; r < 3; r++) { const gr = ctx.createLinearGradient(0, RY, 0, -200); gr.addColorStop(0, `hsla(${(t * 600 + r * 120) % 360},100%,70%,0.9)`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(RX[r] - 90 * k, -200, 180 * k, RY + 200); } ctx.restore(); }
  ctx.restore();
  if (miss) { ctx.fillStyle = `rgba(0,0,0,${0.45 * lin(t, SL.STOP, SL.STOP + 0.25)})`; ctx.fillRect(0, 0, W, H); }
  if (reach) { const k = lin(t, 1.92, 2.08); const s = k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1 + Math.sin(t * 20) * 0.03;
    const col = Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a'; bigWord(ctx, 'REACH!!', CX, 175, s * 1.05, -0.05, col); }
  if (rev && t < JP) { const k = lin(t, SL.REV, SL.REV + 0.14); bigWord(ctx, '復活!!', CX - 520, 860, (k < 1 ? 2.6 - 1.6 * eback(k, 1.6) : 1 + Math.sin(t * 16) * 0.03) * 1.25, -0.16, rainbowFill(ctx, -60, 60, t)); }
  if (win) { const k = lin(t, SL.LOCK + 0.02, SL.LOCK + 0.15); bigWord(ctx, 'JACKPOT!!', CX, 175, (k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1) * 1.1, -0.04, rainbowFill(ctx, -60, 60, t)); }
  if (t >= SL.REV) flash(ctx, (1 - lin(t, SL.REV, SL.REV + 0.14)) * 0.6, '#fff');
  for (const ts of [1.4, 1.9]) if (t >= ts) flash(ctx, (1 - lin(t, ts, ts + 0.08)) * 0.18, '#fff');
}

// ---------------- ×10 PUSH 按鈕 → 漫畫分格 ----------------
function hazard(ctx, y, h, off) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip(); ctx.fillStyle = '#ffd21a'; ctx.fillRect(0, y, W, h); ctx.fillStyle = '#111';
  for (let x = -200 + (off % 120); x < W + 200; x += 120) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y); ctx.lineTo(x + 60 - h, y + h); ctx.lineTo(x - h, y + h); ctx.fill(); }
  ctx.restore();
}
function pushButton(ctx, x, y, s, press, glow, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (glow > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(0, -40, 0, 0, -40, 420); gr.addColorStop(0, `rgba(255,60,60,${0.6 * glow})`); gr.addColorStop(1, 'rgba(255,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(-500, -500, 1000, 900); ctx.restore(); }
  const base = ctx.createLinearGradient(0, 40, 0, 170); base.addColorStop(0, '#d8dce6'); base.addColorStop(1, '#3a3f4a');
  ctx.fillStyle = base; ctx.beginPath(); ctx.ellipse(0, 90, 330, 120, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#16181e'; ctx.beginPath(); ctx.ellipse(0, 70, 270, 92, 0, 0, 7); ctx.fill();
  const hgt = 190 * (1 - press * 0.6);
  const dome = ctx.createRadialGradient(-70, 70 - hgt * 0.8, 10, 0, 70 - hgt * 0.4, 300); dome.addColorStop(0, '#ffb0b0'); dome.addColorStop(0.35, '#ff2a2a'); dome.addColorStop(1, '#6a0008');
  ctx.fillStyle = dome; ctx.beginPath(); ctx.ellipse(0, 70, 240, 82, 0, 0, Math.PI); ctx.ellipse(0, 70, 240, hgt, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-80, 70 - hgt * 0.62, 70, 26 * (1 - press * 0.5), -0.3, 0, 7); ctx.fill();
  ctx.font = "84px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,240,240,0.9)'; ctx.fillText('PUSH', 0, 70 - hgt * 0.35);
  ctx.restore();
}
function mangaPanel(ctx, poly, dx, dy, alpha, draw) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(dx, dy);
  const path = () => { ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  ctx.save(); path(); ctx.clip(); draw(); ctx.restore();
  path(); ctx.lineJoin = 'miter'; ctx.strokeStyle = '#111'; ctx.lineWidth = 22; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.stroke();
  ctx.restore();
}
function halftone(ctx, x0, y0, x1, y1, col, t) {
  ctx.fillStyle = col;
  for (let y = y0; y < y1; y += 26) for (let x = x0 + ((y / 26) % 2) * 13; x < x1; x += 26) { const r = 2 + 9 * Math.max(0, Math.sin((x + y) * 0.004 + t * 2)); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
}
const PA = [[30, 50], [1080, 50], [900, 1030], [30, 1030]], PB = [[1120, 50], [1890, 50], [1890, 520], [1036, 520]], PC = [[1028, 562], [1890, 562], [1890, 1030], [944, 1030]];
function tenMain(ctx, m, t, outK) {
  const hits = [[0, 1], [0.14, 0.8], [0.28, 0.8]]; for (let b = 0.7; b < 3.0; b += 0.4) hits.push([b, 0.3]);
  const pk = decay(m, hits, 13);
  ctx.save(); shakeAt(ctx, t, 3 + pk * 26);
  palBG(ctx, t, PAL.red, CX, CY);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
  // A：大字＋名字
  const ka = lin(m, 0, 0.16), kb = lin(m, 0.14, 0.3), kc = lin(m, 0.28, 0.44);
  if (ka > 0) mangaPanel(ctx, PA, -(1 - eo5(ka)) * 1200 - ei(outK) * 1300, 0, 1, () => {
    palBG(ctx, t, PAL.red, 470, 480); speedLines(ctx, 470, 480, 70, 300, 'rgba(255,255,255,0.35)', Math.floor(t * 30));
    titleText(ctx, t, 480, 420, (1 + pk * 0.05) * 0.82, -0.05); coins(ctx, m - 0.1 + T_HIT);
    subLine(ctx, t, eo(lin(m, 0.45, 0.65)), 470, 760, 0.82); });
  // B：眼睛大特寫
  if (kb > 0 && GIRL) mangaPanel(ctx, PB, (1 - eo5(kb)) * 1000 + ei(outK) * 1100, 0, 1, () => {
    palBG(ctx, t, PAL.blue, 1460, 290); speedLines(ctx, 1460, 290, 60, 200, 'rgba(255,255,255,0.4)', Math.floor(t * 30));
    const z = 1 + m * 0.04, gh = 900 / FACE.s * z, w = GIRL.width * gh / GIRL.height;
    ctx.drawImage(GIRL, 1460 - FACE.x * w, 330 - (FACE.y - FACE.s * 0.05) * gh, w, gh); });
  // C：上半身＋網點
  if (kc > 0 && GIRL) mangaPanel(ctx, PC, 0, (1 - eo5(kc)) * 700 + ei(outK) * 800, 1, () => {
    ctx.fillStyle = '#ffe14a'; ctx.fillRect(900, 540, 1000, 520); halftone(ctx, 900, 540, 1900, 1060, 'rgba(255,140,0,0.55)', t);
    girlAt(ctx, 1440, 1330 - m * 20, 1700 + pk * 30, t); });
  ctx.restore();
  ledFrameHue(ctx, t, (i) => (i * 5 + t * 200) % 60);
  for (const [ts, a] of [[0, 0.5], [0.14, 0.3], [0.28, 0.3]]) if (m >= ts) flash(ctx, (1 - lin(m, ts, ts + 0.07)) * a, '#fff');
}
function sceneTen(ctx, t) {
  const D = CFG.dur, PRESS = 2.0, EXIT = D - 0.55;
  if (t >= PRESS + 0.06) { const outK = lin(t, EXIT, D - 0.05); tenMain(ctx, t - PRESS - 0.06, t, outK);
    if (outK > 0) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${ei(outK)})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    return; }
  const appear = eo(lin(t, 0, 0.3)), beats = [[0.8, 1], [1.2, 1], [1.6, 1], [PRESS, 1.6]], pk = decay(t, beats, 9);
  ctx.fillStyle = `rgba(0,0,0,${0.85 * appear})`; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const vg = ctx.createRadialGradient(CX, CY, 300, CX, CY, 1100); vg.addColorStop(0, 'rgba(255,0,0,0)'); vg.addColorStop(1, `rgba(255,30,30,${0.15 + pk * 0.4})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.restore();
  const hz = eo5(lin(t, 0.1, 0.35)); hazard(ctx, -70 + hz * 70, 70, t * 300); hazard(ctx, H - hz * 70, 70, -t * 300);
  ctx.save(); shakeAt(ctx, t, pk * 18);
  const bk = lin(t, 0.3, 0.62), press = t >= PRESS ? 1 - eo(lin(t, PRESS + 0.02, PRESS + 0.06)) * 0 : 0;
  if (bk > 0) pushButton(ctx, CX, 780 + (1 - eback(bk, 1.6)) * 600, 1 + pk * 0.06, t >= PRESS ? 1 : 0, 0.3 + pk, t);
  // 倒數
  const cd = [['3', 0.8], ['2', 1.2], ['1', 1.6]];
  for (const [d, ts] of cd) { const l = t - ts; if (l < 0 || l >= 0.4) continue; const s = l < 0.12 ? 2.2 - 1.2 * eback(l / 0.12, 1.6) : 1 + (l - 0.12) * 0.15;
    ctx.save(); ctx.globalAlpha = 1 - lin(l, 0.3, 0.4); ctx.lineWidth = 14; ctx.strokeStyle = '#ffe14a'; ctx.shadowColor = '#ff2a2a'; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.arc(CX, 400, 150 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - l / 0.4)); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.globalAlpha = 1 - lin(l, 0.3, 0.4); bigWord(ctx, d, CX, 405, s * 1.3, 0, '#ffe14a', '#5a0008'); ctx.restore(); }
  if (t > 0.5 && t < 0.8) { const k = lin(t, 0.5, 0.62); bigWord(ctx, 'PUSH!!', CX, 400, (k < 1 ? 2 - eback(k, 1.6) : 1), -0.04, Math.floor(t * 12) % 2 ? '#ff2a3a' : '#ffe14a'); }
  ctx.restore();
  if (t >= PRESS) { const l = t - PRESS;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; speedLines(ctx, CX, 760, 120, 120 + l * 4000, 'rgba(255,200,120,0.9)', 7);
    const gr = ctx.createRadialGradient(CX, 760, 0, CX, 760, 300 + l * 9000); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

// ---------------- ×100：彩虹隧道 → 光之翼降臨 → 對稱神殿構圖 ----------------
const GD = { SH: 2.9, DESC: 3.8, LAND: 4.9, T0: 5.2, MEDAL: 6.25 };
function wings(ctx, t, x, y, open, glow) {
  if (open <= 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 10; i++) {
    const th = 0.25 + i * 0.17 + Math.sin(t * 2.6) * 0.07 * (1 - i / 12), L = (620 - i * 30) * open * (layer ? 0.75 : 1);
    const dx = side * Math.sin(th), dy = -Math.cos(th); const cx = x + side * 70 + dx * L / 2, cy = y + dy * L / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(dy, dx));
    const gr = ctx.createLinearGradient(-L / 2, 0, L / 2, 0); gr.addColorStop(0, `rgba(255,250,230,${0.55 + glow * 0.3})`); gr.addColorStop(1, `hsla(${(i * 30 + t * 80) % 360},100%,75%,0.05)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, 0, L / 2, (layer ? 26 : 44), 0, 0, 7); ctx.fill(); ctx.restore(); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = Math.min(1, open);
  for (const side of [-1, 1]) for (let i = 0; i < 10; i++) {
    const th = 0.25 + i * 0.17 + Math.sin(t * 2.6) * 0.07 * (1 - i / 12), L = (620 - i * 30) * open;
    const dx = side * Math.sin(th), dy = -Math.cos(th); ctx.save(); ctx.translate(x + side * 70 + dx * L / 2, y + dy * L / 2); ctx.rotate(Math.atan2(dy, dx));
    const g2 = ctx.createLinearGradient(-L / 2, 0, L / 2, 0); g2.addColorStop(0, 'rgba(255,255,255,0.95)'); g2.addColorStop(0.7, 'rgba(255,246,210,0.8)'); g2.addColorStop(1, 'rgba(255,220,140,0.2)');
    ctx.fillStyle = g2; ctx.strokeStyle = 'rgba(200,150,40,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, L / 2, 30, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }
  ctx.restore();
}
function warpTunnel(ctx, t, k) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) { const z = ((i / 18) + (t - GD.SH) * 1.6) % 1; const r = 30 * Math.pow(40, z);
    ctx.strokeStyle = `hsla(${(i * 40 + t * 200) % 360},100%,65%,${Math.min(1, z * 1.5) * (1 - k * 0.8)})`; ctx.lineWidth = 2 + z * 30;
    ctx.beginPath(); ctx.ellipse(CX + Math.sin(t * 3 + i) * 30 * z, CY + Math.cos(t * 2 + i) * 20 * z, r * 1.25, r, 0, 0, 7); ctx.stroke(); }
  ctx.restore();
}
function premiumSeal(ctx, t, x, y, k, pk) {
  if (k <= 0) return; const s = (k < 1 ? 3 - 2 * eback(k, 1.6) : 1) * (1 + pk * 0.08);
  ctx.save(); ctx.translate(x, y); ctx.rotate(0.12 + Math.sin(t * 4) * 0.04); ctx.scale(s, s);
  const gg = ctx.createLinearGradient(0, -70, 0, 70); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffb21a'); gg.addColorStop(1, '#a86400');
  ctx.shadowColor = 'rgba(255,220,100,1)'; ctx.shadowBlur = 40; ctx.fillStyle = gg; ctx.beginPath(); ctx.roundRect(-230, -66, 460, 132, 30); ctx.fill(); ctx.shadowBlur = 0;
  ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#1a0838'; ctx.beginPath(); ctx.roundRect(-206, -44, 412, 88, 20); ctx.fill();
  ctx.font = "64px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = rainbowFill(ctx, -30, 30, t); ctx.fillText('PREMIUM', 0, 4);
  ctx.restore();
}
function godMain(ctx, t) {
  const chars = splitTitle(CFG.title), n = chars.length;
  const hits = [[GD.LAND, 1.2]]; chars.forEach((c, i) => hits.push([GD.T0 + i * Math.min(0.25, 0.9 / Math.max(1, splitTitle(CFG.title).length - 1)), 1.1])); hits.push([GD.MEDAL, 0.9]);
  for (let b = GD.MEDAL + 0.4; b < CFG.dur - 0.8; b += 0.4) hits.push([b, 0.45]);
  const pk = decay(t, hits, 12);
  ctx.save(); ctx.translate(CX, CY); ctx.scale(1 + pk * 0.05, 1 + pk * 0.05); ctx.translate(-CX, -CY); shakeAt(ctx, t, 3 + pk * 34);
  const warp = t < GD.DESC ? 1 : (t < GD.LAND ? 1 - lin(t, GD.DESC, GD.LAND) * 0.85 : 0.15);
  cosmos(ctx, t, warp);
  if (t < GD.DESC + 0.4) warpTunnel(ctx, t, lin(t, GD.DESC - 0.1, GD.DESC + 0.4));
  const gx = CX, gh = 1650, gyF = 860, dk = lin(t, GD.DESC, GD.LAND), gy = gyF - (1 - eo(dk)) * 1900;
  // 角色背後的柔和光暈（原本是巨大「神」字，低透明度時筆畫像一塊塊方塊，已拿掉）
  const kk = lin(t, GD.LAND, GD.LAND + 0.3);
  if (kk > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const r = (500 + eo5(kk) * 300) * (1 + pk * 0.08);
    const bl = ctx.createRadialGradient(CX, 430, 0, CX, 430, r); bl.addColorStop(0, `rgba(255,246,210,${0.45 * kk})`); bl.addColorStop(0.45, `rgba(255,200,120,${0.18 * kk})`); bl.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = bl; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  // 光柱與彩虹光芒
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const pa = dk > 0 ? 0.8 + pk * 0.2 : 0;
  let gr = ctx.createLinearGradient(gx - 320, 0, gx + 320, 0); gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, `rgba(255,250,230,${0.55 * pa})`); gr.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = gr; ctx.fillRect(gx - 320, -60, 640, H + 120);
  if (t > GD.LAND) { godRays(ctx, gx, 300, 36, `rgba(255,240,190,${0.05 + pk * 0.1})`, t * 0.3, 2600, 0.45);
    for (let h = 0; h < 6; h++) godRays(ctx, gx, 300, 6, `hsla(${(h * 60 + t * 90) % 360},100%,60%,${0.085 * lin(t, GD.LAND, GD.LAND + 0.4)})`, -t * 0.25 + h * Math.PI / 18, 2600, 0.5); }
  ctx.restore();
  // 每拍從角色擴散的光環
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [ti, a] of hits) { const l = t - ti; if (l < 0 || l > 0.5) continue; const p = l / 0.5;
    ctx.strokeStyle = `hsla(${(ti * 300) % 360},100%,80%,${(1 - p) * Math.min(1, a)})`; ctx.lineWidth = 30 * (1 - p) + 2; ctx.beginPath(); ctx.ellipse(gx, 420, 150 + eo(p) * 1300, 100 + eo(p) * 800, 0, 0, 7); ctx.stroke(); }
  ctx.restore();
  if (GIRL && dk > 0) { const [hx, hy] = headPos(gx, gy, gh);
    wings(ctx, t, gx, gy - gh * 0.12, eback(lin(t, GD.LAND, GD.LAND + 0.45), 1.6), pk);
    haloRing(ctx, t, hx, hy - 30, 300 + pk * 30, lin(t, GD.DESC + 0.3, GD.LAND), decay(t, hits, 8)); }
  // 羽毛
  ctx.save(); for (let i = 0; i < 70; i++) { const st = GD.DESC + R(i, 51) * 6, l = t - st; if (l < 0) continue; const y = -40 + l * (90 + R(i, 52) * 120); if (y > H + 40) continue;
    const x = (R(i, 53)) * W + Math.sin(l * 2 + i) * 80; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(l * 2.5 + i) * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 22, 0, 0, 7); ctx.fill(); ctx.restore(); } ctx.restore();
  if (GIRL && dk > 0) { const wk = lin(t, GD.LAND - 0.3, GD.LAND + 0.1), hh = gh + pk * 40;
    neonOutline(ctx, GIRL_SIL, gx, gy, hh, t, 0); drawImg(ctx, GIRL, gx, gy, hh, 0, wk);
    if (wk < 1) drawImg(ctx, silhouette(GIRL_SIL, '#fffbe8'), gx, gy, hh, 0, 1 - wk); }
  // 大字：一字一字砸下（下方置中）
  const gf = Math.min(1, 1560 / (270 * n)), sp = 270 * gf, x0 = CX - sp * (n - 1) / 2;
  chars.forEach((c, i) => { const ts = GD.T0 + i * Math.min(0.25, 0.9 / Math.max(1, splitTitle(CFG.title).length - 1)), k = lin(t, ts, ts + 0.16); if (k <= 0) return;
    const s = k < 1 ? 3.4 - 2.15 * eback(k, 1.5) : 1.25 + decay(t, [[ts, 1]], 9) * 0.1 + pk * 0.03;
    glyph(ctx, t, c, x0 + i * sp, 790 + (i % 2 ? 10 : -10), s * gf * (c.length > 1 ? 0.85 : 1), (i % 2 ? 0.06 : -0.06), PAL.premium, 18); coins(ctx, t - ts + T_HIT); });
  subLine(ctx, t, eo(lin(t, GD.T0 + n * 0.25 + 0.2, GD.T0 + n * 0.25 + 0.4)), CX, 968, 0.8);
  premiumExtra(ctx, t - (GD.MEDAL - 4.62), pk);
  premiumSeal(ctx, t, 1640, 240, lin(t, GD.MEDAL + 0.12, GD.MEDAL + 0.3), pk);
  mascotAt2(ctx, t, lin(t, GD.MEDAL + 0.25, GD.MEDAL + 0.55), 200, 640, 360, false);
  mascotAt2(ctx, t, lin(t, GD.MEDAL + 0.3, GD.MEDAL + 0.6), 1720, 640, 360, true);
  fireworksAt(ctx, t, [[6.4, 420, 200, 50], [6.7, 1500, 160, 300], [7.0, 760, 120, 180], [7.3, 260, 360, 10], [7.6, 1650, 380, 120], [7.9, 980, 200, 260], [8.2, 420, 160, 330], [8.5, 1300, 140, 60], [8.8, 700, 220, 200], [9.1, 1550, 200, 30], [9.4, 300, 280, 280], [9.7, 1100, 150, 150]]);
  ctx.restore();
  confetti(ctx, t, GD.T0, 220, ['#ffe27a', '#fff6c0', '#ff5aa5', '#5ad8ff', '#ffffff'], 5);
  if (t > GD.MEDAL) { const e = 1 - eo5(lin(t, GD.MEDAL, GD.MEDAL + 0.2)); tickerBand(ctx, t, 92 - e * 180, -1); }
  if (t > GD.LAND) ledFrame(ctx, t);
  if (t >= GD.LAND) flash(ctx, (1 - lin(t, GD.LAND, GD.LAND + 0.14)) * 0.6, '#fff3c8');
  chars.forEach((c, i) => { const ts = GD.T0 + i * Math.min(0.25, 0.9 / Math.max(1, splitTitle(CFG.title).length - 1)); if (t >= ts) flash(ctx, (1 - lin(t, ts, ts + 0.06)) * 0.22, '#fff'); });
}
function sceneGod(ctx, t) {
  const D = CFG.dur, SH = GD.SH, EX = D - 0.8;
  if (!SHARDS) SHARDS = makeShards();
  if (t < 0.5) { bctx.setTransform(1, 0, 0, 1, 0, 0); sceneTeaser(bctx, t * 0.8); ctx.filter = `hue-rotate(${(t * 700) % 360}deg) saturate(1.6)`; ctx.drawImage(buf, 0, 0); ctx.filter = 'none'; return; }
  if (t < 1.1) {
    const f = Math.floor(t * 60), stut = Math.floor(t * 20) % 3;
    bctx.setTransform(1, 0, 0, 1, 0, 0); sceneTeaser(bctx, 0.4 - stut * 0.004);
    ctx.filter = 'hue-rotate(200deg) saturate(1.6)'; ctx.drawImage(buf, 0, 0); ctx.filter = 'none';
    const tmp = mk(); tmp.getContext('2d').drawImage(cv, 0, 0); ctx.clearRect(0, 0, W, H); sliceShift(ctx, tmp, t, 260 * lin(t, 0.5, 1.1) + 40, f);
    ctx.save(); for (let i = 0; i < 14; i++) { ctx.fillStyle = `hsla(${R(f, i) * 360},100%,60%,0.75)`; ctx.fillRect(R(f, i + 20) * W, R(f, i + 40) * H, 40 + R(f, i + 60) * 420, 8 + R(f, i + 80) * 50); } ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.18; for (let y = 0; y < H; y += 4) { ctx.fillStyle = R(f, y) < 0.5 ? '#000' : '#fff'; ctx.fillRect(0, y, W, 2); } ctx.restore();
    if (t > 1.0) flash(ctx, lin(t, 1.0, 1.1), '#000');
    return;
  }
  if (t < SH) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const steps = [[2.0, 0.28], [2.3, 0.55], [2.6, 0.85]]; let gro = 0; for (const [ts, gv] of steps) if (t >= ts) gro = gv * (0.85 + 0.15 * eo5(lin(t, ts, ts + 0.08)));
    if (gro > 0) { ctx.save(); shakeAt(ctx, t, decay(t, steps.map(([a]) => [a, 1]), 14) * 22);
      ctx.save(); ctx.shadowColor = `hsl(${(t * 400) % 360},100%,60%)`; ctx.shadowBlur = 30; cracks(ctx, 77, CX + 60, CY - 30, gro, `hsl(${(t * 400) % 360},100%,75%)`, 9); ctx.restore();
      cracks(ctx, 77, CX + 60, CY - 30, gro, '#fff', 3);
      const gl = ctx.createRadialGradient(CX + 60, CY - 30, 0, CX + 60, CY - 30, 120 + gro * 300); gl.addColorStop(0, `rgba(255,255,255,${0.5 * gro})`); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    if (t > 2.65) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,255,${ei(lin(t, 2.65, SH)) * 0.35})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    return;
  }
  if (t >= EX) {
    const k = lin(t, EX, D - 0.02);
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.clearRect(0, 0, W, H); godMain(bctx, t);
    ctx.save(); ctx.globalAlpha = 1 - ei(lin(k, 0.35, 1)); ctx.translate(CX, CY); ctx.scale(1 + k * 0.08, 1 + k * 0.08); ctx.translate(-CX, -CY - k * 120); ctx.drawImage(buf, 0, 0); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(0, H, 0, H - 1600 * eo(k)); gr.addColorStop(0, `rgba(255,250,230,${Math.sin(k * Math.PI) * 0.9})`); gr.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${ei(lin(k, 0.6, 1))})`; ctx.fillRect(0, 0, W, H); ctx.restore();
    return;
  }
  godMain(ctx, t);
  const k = lin(t, SH, SH + 0.75);
  if (k < 1) { ctx.save();
    for (const s of SHARDS) { const q = eo(Math.min(1, k * (0.8 + R(s.k, 1) * 0.6))); const dx = s.cx - CX, dy = s.cy - CY;
      const sc = 1 + q * (1.5 + R(s.k, 2) * 2); const nx = CX + dx * (1 + q * 2.2), ny = CY + dy * (1 + q * 2.2) + q * q * 300;
      ctx.save(); ctx.globalAlpha = 1 - ei(q); ctx.translate(nx, ny); ctx.rotate((R(s.k, 3) - 0.5) * 5 * q); ctx.scale(sc, sc);
      ctx.beginPath(); ctx.moveTo(s.tri[0][0] - s.cx, s.tri[0][1] - s.cy); ctx.lineTo(s.tri[1][0] - s.cx, s.tri[1][1] - s.cy); ctx.lineTo(s.tri[2][0] - s.cx, s.tri[2][1] - s.cy); ctx.closePath();
      ctx.fillStyle = '#05050a'; ctx.fill(); ctx.strokeStyle = `hsla(${(s.k * 37 + t * 300) % 360},100%,80%,0.9)`; ctx.lineWidth = 3 / sc; ctx.stroke(); ctx.restore(); }
    ctx.restore(); }
  if (t < SH + 0.15) flash(ctx, (1 - lin(t, SH, SH + 0.15)) * 0.7, '#fff');
}

Object.assign(TIERS.g10, { kind: 'ten', dur: 5.3, pal: 'red', title: '贈訂 ×10!!' });
Object.assign(TIERS.g50, { dur: 9.25 });
Object.assign(TIERS.g100, { dur: 11.2 });
HI.ten = sceneTen;

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

// ======================= 第三批：贈訂大量（g10） =======================
const HUD_C = '#5ff2ff', HUD_R = '#ff3a5a';
function hudText(ctx, txt, x, y, size, col, align = 'left', a = 1) {
  ctx.save(); ctx.globalAlpha *= a; ctx.font = `700 ${size}px 'Noto Sans TC'`; ctx.letterSpacing = `${Math.round(size * 0.12)}px`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.fillStyle = col; ctx.fillText(txt, x, y); ctx.restore();
}
function brackets(ctx, x, y, w, h, len, col, lw = 4, a = 1) {   // 四角括弧框
  ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const cx = x + sx * w / 2, cy = y + sy * h / 2; ctx.moveTo(cx, cy - sy * len); ctx.lineTo(cx, cy); ctx.lineTo(cx - sx * len, cy); }
  ctx.stroke(); ctx.restore();
}
function girlGeo(gx, gy, gh) { const gw = GIRL.width * gh / GIRL.height; return { gw, fx: gx - gw / 2 + FACE.x * gw, fy: gy - gh / 2 + FACE.y * gh, fr: FACE.s * gh }; }

// ---------------- 大量 2：鎖定掃描 ----------------
function vScan(ctx, t) {
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), pal = PAL[CFG.pal];
  const SCAN0 = 0.35, SCAN1 = 1.5, SEEK = 1.5, LOCK = 2.05, DATA = 2.45;
  ctx.save(); ctx.globalAlpha = 1 - out;
  ctx.fillStyle = `rgba(2,8,18,${0.82 * app})`; ctx.fillRect(0, 0, W, H);
  // 格線與掃描線
  ctx.save(); ctx.globalAlpha *= 0.18 * app; ctx.strokeStyle = HUD_C; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = (t * 40) % 80; y <= H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
  const hot = eo(lin(t, LOCK + 0.05, LOCK + 0.4));
  if (hot > 0 && GIRL) { const G0 = girlGeo(1330, 560, 900); ctx.save(); ctx.globalAlpha *= hot; palBG(ctx, t, PAL.red, G0.fx, G0.fy); ctx.fillStyle = 'rgba(30,0,10,0.45)'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  // 角色：先是掃描中的藍色輪廓，掃描線經過的地方顯示本人
  const lockK = lin(t, LOCK, LOCK + 0.35), zoom = 1 + 0.18 * Math.sin(Math.PI * lockK);
  const gh = 900, gx = 1330, gy = 560, G = GIRL ? girlGeo(gx, gy, gh) : null;
  if (GIRL) {
    ctx.save(); if (G) { ctx.translate(G.fx, G.fy); ctx.scale(zoom, zoom); ctx.translate(-G.fx, -G.fy); }
    const scanY = -100 + (H + 200) * eio2(lin(t, SCAN0, SCAN1));
    drawImg(ctx, silhouette(GIRL_SIL, '#1d7fa0'), gx, gy, gh, 0, 0.55 * app);
    if (t >= LOCK) neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, 0);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, scanY); ctx.clip(); drawImg(ctx, GIRL, gx, gy, gh, 0, app); ctx.restore();
    if (t > SCAN0 && t < SCAN1 + 0.1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 6); g.addColorStop(0, 'rgba(95,242,255,0)'); g.addColorStop(1, 'rgba(95,242,255,0.7)'); ctx.fillStyle = g; ctx.fillRect(gx - 520, scanY - 60, 1040, 66); ctx.fillStyle = '#c8fbff'; ctx.fillRect(gx - 520, scanY, 1040, 3); ctx.restore(); }
    ctx.restore();
  }
  // 誘餌目標框（亂飄）→ 準星衝到臉上鎖定
  if (t > 0.5 && t < LOCK) for (let i = 0; i < 3; i++) {
    const ph = t * (1.3 + i * 0.4) + i * 2, x = 380 + i * 260 + Math.sin(ph) * 120, y = 300 + i * 170 + Math.cos(ph * 1.3) * 90, a = (1 - lin(t, SEEK, LOCK)) * lin(t, 0.5 + i * 0.2, 0.7 + i * 0.2);
    brackets(ctx, x, y, 110, 110, 22, HUD_C, 2, a); hudText(ctx, '?', x, y, 34, HUD_C, 'center', a * (Math.floor(t * 8 + i) % 2 ? 1 : 0.4));
  }
  if (G && t > SEEK - 0.4) {
    const k = eo5(lin(t, SEEK - 0.4, LOCK)), sx = 560 + (G.fx - 560) * k, sy = 760 + (G.fy - 760) * k, sz = 520 - (520 - G.fr * 2.6) * k;
    const locked = t >= LOCK, col = locked ? HUD_R : HUD_C, pop = locked ? 1 + 0.25 * Math.exp(-(t - LOCK) * 10) : 1;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate((1 - k) * 1.2 + (locked ? 0 : Math.sin(t * 9) * 0.04)); ctx.scale(pop, pop);
    brackets(ctx, 0, 0, sz, sz, sz * 0.22, col, 5);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(0, 0, sz * 0.62, 0, 7); ctx.moveTo(-sz * 0.75, 0); ctx.lineTo(-sz * 0.3, 0); ctx.moveTo(sz * 0.3, 0); ctx.lineTo(sz * 0.75, 0); ctx.moveTo(0, -sz * 0.75); ctx.lineTo(0, -sz * 0.3); ctx.moveTo(0, sz * 0.3); ctx.lineTo(0, sz * 0.75); ctx.stroke();
    ctx.restore();
    if (locked) { const l = t - LOCK;
      for (let i = 0; i < 3; i++) { const q = (l - i * 0.08) / 0.6; if (q < 0 || q > 1) continue; ctx.save(); ctx.strokeStyle = `rgba(255,${120 + i * 50},${120 + i * 40},${1 - q})`; ctx.lineWidth = 14 * (1 - q) + 2; ctx.beginPath(); ctx.arc(G.fx, G.fy, G.fr + 900 * eo(q), 0, 7); ctx.stroke(); ctx.restore(); }
      ctx.save(); ctx.translate(G.fx - G.fr * 1.5 - 300, G.fy - 20); ctx.rotate(-0.04); const s = l < 0.12 ? 2 - l / 0.12 : 1; ctx.scale(s, s); ctx.globalAlpha = Math.floor(l * 10) % 2 && l < 0.6 ? 0.6 : 1;
      ctx.fillStyle = HUD_R; ctx.fillRect(-190, -42, 380, 84); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(-190, -42, 380, 84); hudText(ctx, 'LOCK ON', 0, 3, 58, '#fff', 'center'); ctx.restore(); }
  }
  // 上方狀態列
  const st = t < SEEK ? 'SCANNING' : t < LOCK ? 'TARGET FOUND' : 'LOCKED';
  hudText(ctx, st + (t < LOCK && Math.floor(t * 4) % 2 ? ' ...' : ''), 90, 84, 44, t < LOCK ? HUD_C : HUD_R, 'left', app);
  ctx.save(); ctx.globalAlpha *= app; ctx.fillStyle = HUD_C; ctx.fillRect(90, 120, 520 * Math.min(1, t / LOCK), 6); ctx.restore();
  if (t >= LOCK && t < LOCK + 0.5) { const l = t - LOCK; ctx.save(); ctx.globalAlpha = 0.35 * (1 - l / 0.5) * (Math.floor(l * 16) % 2); ctx.fillStyle = HUD_R; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  // 資料面板（左）：一行一行打出來
  if (t >= DATA) {
    const l = t - DATA, px = 110, py = 300, pw = 820, ph = 500, op = eo5(lin(l, 0, 0.25));
    ctx.save(); ctx.translate(px, py); ctx.scale(1, op);
    ctx.fillStyle = 'rgba(4,20,34,0.85)'; ctx.fillRect(0, 0, pw, ph); ctx.strokeStyle = HUD_C; ctx.lineWidth = 2; ctx.strokeRect(0, 0, pw, ph);
    ctx.fillStyle = HUD_R; ctx.fillRect(0, 0, 12, ph); ctx.restore();
    const rows = [['GIFT FROM', P.name], ['SUBS', '×' + CFG.n], ['STATUS', 'MAX HAPPY']];
    rows.forEach((r, i) => { const k = l - 0.35 - i * 0.12; if (k < 0) return; const n = Math.ceil(r[1].length * Math.min(1, k / 0.2));
      hudText(ctx, r[0], px + 50, py + 260 + i * 72, 30, HUD_C); hudText(ctx, r[1].slice(0, n), px + 330, py + 260 + i * 72, 42, '#ffffff'); });
    const tk = lin(l, 0.2, 0.4); if (tk > 0) { const ss = tk < 1 ? 1.7 - 0.7 * eback(tk, 1.6) : 1; ctx.save(); ctx.translate(px + pw / 2, py + 110); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 124, pal, 'center'); ctx.restore(); }
  }
  ctx.restore();
}
function eio2(u) { return u * u * (3 - 2 * u); }
VARS.g10[2] = { name: '鎖定掃描', fn: vScan, dur: 5.0 };

// ---------------- 大量 1：幸運大轉盤 ----------------
let WHEEL_DISC = null, WHEEL_PTR = null, WHEEL_STAND = null;
const WHEEL_GEO = { hubY: 0.123, bulbR: 0.465, nB: 32, seg: 8, winA: -67.5 };   // 底座軸心高度、燈泡半徑（盤寬比例）、金色格中心角（圖上角度）
const _lvaBase3 = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaBase3();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  WHEEL_DISC = await L2('DEF_WHEEL_DISC', 'wheel_disc.png'); WHEEL_PTR = await L2('DEF_WHEEL_PTR', 'wheel_pointer.png'); WHEEL_STAND = await L2('DEF_WHEEL_STAND', 'wheel_stand.png');
};
const WH_T = { in: 0.45, slow: 2.5, hold: 2.95, stop: 3.25 };
function wheelAngle(t) {   // 度數；最後一段先停在金色格前一格，撐住，再爬過界線
  const fin = -90 - WHEEL_GEO.winA, pre = fin - 28 + 360 * 7;
  if (t < WH_T.in) return 0;
  if (t < WH_T.slow) { const u = lin(t, WH_T.in, WH_T.slow); return pre * (1 - Math.pow(1 - u, 3)); }
  if (t < WH_T.hold) return pre + Math.sin((t - WH_T.slow) * 30) * 0.6;
  const u = lin(t, WH_T.hold, WH_T.stop); return pre + 28 * (u < 1 ? u * u * (3 - 2 * u) : 1) + 360 * 0 - (pre + 28 - fin - 360 * 7) * 0;
}
function vRoulette(ctx, t) {
  if (!WHEEL_DISC) return;
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), pal = PAL[CFG.pal], STOP = WH_T.stop, won = t >= STOP;
  ctx.save(); ctx.globalAlpha = app * (1 - out); palBG(ctx, t, PAL.red, 960, 540); ctx.fillStyle = `rgba(30,0,8,${won ? 0.15 : 0.4})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  if (won) { ctx.save(); ctx.globalAlpha = (1 - out) * eo(lin(t, STOP, STOP + 0.3)); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960 - 330 * eo5(lin(t, STOP + 0.15, STOP + 0.6)), 610, 14, 'rgba(255,230,150,0.22)', t * 0.4, 1800, 0.45, 16); ctx.restore(); }
  const ent = eback(lin(t, 0.05, 0.5), 1.5), mv = eo5(lin(t, STOP + 0.15, STOP + 0.6)), dia = 640, wx = 960 - 330 * mv - out * 900, wy = 540 + 70 * mv + (1 - ent) * 900;
  const stH = dia * 0.93, stW = WHEEL_STAND.width * stH / WHEEL_STAND.height;
  const pk = won ? Math.exp(-(t - STOP) * 8) : 0;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * pk * 14, (R(Math.floor(t * 60), 2) - 0.5) * pk * 14);
  ctx.drawImage(WHEEL_STAND, wx - stW / 2, wy - stH * WHEEL_GEO.hubY, stW, stH);
  // 盤面（高速時畫殘影）
  const ang = wheelAngle(t), om = Math.abs(wheelAngle(t) - wheelAngle(t - 1 / 60)) * 60;
  const ghosts = om > 200 ? 4 : 0;
  for (let g = ghosts; g >= 0; g--) { ctx.save(); ctx.globalAlpha *= g ? 0.22 : 1; ctx.translate(wx, wy); ctx.rotate((ang - g * om / 60 / (ghosts + 1)) * Math.PI / 180); ctx.drawImage(WHEEL_DISC, -dia / 2, -dia / 2, dia, dia); ctx.restore(); }
  // 外圈燈泡：跑燈，越慢越亮；中獎後全部交替閃
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < WHEEL_GEO.nB; i++) {
    const a = (i / WHEEL_GEO.nB) * Math.PI * 2 + ang * Math.PI / 180 - Math.PI / 2, bx = wx + Math.cos(a) * dia * WHEEL_GEO.bulbR, by = wy + Math.sin(a) * dia * WHEEL_GEO.bulbR;
    const on = won ? ((Math.floor((t - STOP) * 10) + i) % 2 ? 1 : 0.3) : (Math.floor(t * 18) - i) % 4 === 0 ? 0.9 : 0;
    if (!on) continue; const g = ctx.createRadialGradient(bx, by, 0, bx, by, 22); g.addColorStop(0, `rgba(255,250,210,${on})`); g.addColorStop(1, 'rgba(255,190,80,0)'); ctx.fillStyle = g; ctx.fillRect(bx - 22, by - 22, 44, 44);
  }
  ctx.restore();
  // 中獎格閃白
  if (won) { const l = t - STOP, a = (Math.floor(l * 8) % 2 ? 0.55 : 0.2) * (1 - lin(l, 1.2, 1.8));
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,250,220,${a})`; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.arc(wx, wy, dia * 0.43, -Math.PI / 2 - Math.PI / 8, -Math.PI / 2 + Math.PI / 8); ctx.fill(); ctx.restore(); }
  // 指針：每過一格被撥一下
  const f = (((ang + 90 + WHEEL_GEO.winA) % 45) + 45) % 45 / 45, flap = om > 900 ? Math.sin(t * 90) * 0.15 : -0.45 * Math.max(0, 1 - f * 5);
  const pw = 92, ph = WHEEL_PTR.height * pw / WHEEL_PTR.width;
  ctx.save(); ctx.translate(wx, wy - dia / 2 - ph * 0.35); ctx.rotate(flap); ctx.drawImage(WHEEL_PTR, -pw / 2, -ph * 0.3, pw, ph); ctx.restore();
  // 軸心上的份數
  if (won) { const k = lin(t, STOP + 0.15, STOP + 0.4); if (k > 0) { const s = k < 1 ? 2 - eback(k, 1.6) : 1; ctx.save(); ctx.translate(wx, wy); ctx.scale(s, s); ctx.beginPath(); ctx.arc(0, 0, 112, 0, 7); ctx.fillStyle = '#c8102e'; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#ffd34a'; ctx.stroke(); smallTitle(ctx, t, '×' + CFG.n, 0, 4, 92, PAL.gold, 'center'); ctx.restore(); } }
  ctx.restore();
  // 撐住的那一刻：CHANCE 閃字
  if (t > WH_T.slow + 0.05 && t < WH_T.stop) { ctx.save(); ctx.globalAlpha = Math.floor(t * 8) % 2 ? 1 : 0.5; ctx.translate(960, 1010); smallTitle(ctx, t, 'CHANCE!', 0, 0, 80, PAL.gold, 'center'); ctx.restore(); }
  if (won) {
    const l = t - STOP;
    coinFountain(ctx, t, STOP, STOP + 1.4, 40);
    const gk = lin(l, 0.2, 0.55); if (gk > 0 && GIRL) { ctx.save(); ctx.globalAlpha = 1 - out; const gx = 1520 + (1 - eback(gk, 1.6)) * 700 + out * 700; neonOutline(ctx, GIRL_SIL, gx, 650, 860, t, 0.04); drawImg(ctx, GIRL, gx, 650, 860, 0.04); ctx.restore(); }
    const tk = lin(l, 0.35, 0.55); if (tk > 0) { const ss = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(900, 110); ctx.rotate(-0.03); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 120, pal, 'center'); ctx.restore(); }
    const nk = eo(lin(l, 0.55, 0.75)); if (nk > 0) { ctx.save(); ctx.globalAlpha = (1 - out) * nk; ctx.font = "900 48px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2a0008'; ctx.lineWidth = 12; ctx.strokeText(nameLine(), 900, 210); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), 900, 210); ctx.restore(); }
    flash(ctx, (1 - lin(t, STOP, STOP + 0.12)) * 0.5, '#fff3c0');
  }
}
VARS.g10[1] = { name: '幸運大轉盤', fn: vRoulette, dur: 5.3 };

// ---------------- 大量 4：號外 ----------------
let NEWS_PAPER = null;
const NEWS_GEO = { banner: [0.041, 0.04, 0.776, 0.151], stamp: [0.875, 0.1, 0.084], photo: [0.218, 0.187, 0.781, 0.556], band: 0.585 };   // 版面位置（報紙寬高比例）
const _lvaBase4 = window.loadVarAssets;
window.loadVarAssets = async function () { await _lvaBase4(); const im = await load(window.DEF_NEWS_PAPER || '../assets/news_paper.png'); NEWS_PAPER = im ? trimmed(im) : null; };
function drawPaper(ctx, PW, PH, t, l) {   // 以報紙中心為原點；l = 落地後經過秒數（<0 表示還沒落地，只畫空報紙）
  const G = NEWS_GEO, X = (u) => -PW / 2 + u * PW, Y = (v) => -PH / 2 + v * PH;
  ctx.drawImage(NEWS_PAPER, -PW / 2, -PH / 2, PW, PH);
  const [px0, py0, px1, py1] = G.photo, rx = X(px0), ry = Y(py0), rw = (px1 - px0) * PW, rh = (py1 - py0) * PH;
  ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip(); ctx.fillStyle = '#f6efe2'; ctx.fillRect(rx, ry, rw, rh);
  if (l >= 0.05 && GIRL) { const gh = rh * 2.3, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, rx + rw / 2 - FACE.x * gw, ry + rh * 0.4 - FACE.y * gh, gw, gh);
    if (l < 0.25) { ctx.fillStyle = `rgba(255,255,255,${1 - l / 0.25})`; ctx.fillRect(rx, ry, rw, rh); } }
  ctx.restore(); ctx.strokeStyle = '#2a2420'; ctx.lineWidth = Math.max(3, PW * 0.006); ctx.strokeRect(rx, ry, rw, rh);
  if (l < 0) return;
  // 標題橫帶：黑底白字砸進來
  const [bx0, by0, bx1, by1] = G.banner, hk = lin(l, 0.15, 0.3);
  if (hk > 0) { ctx.save(); ctx.fillStyle = '#1a1414'; ctx.fillRect(X(bx0), Y(by0), (bx1 - bx0) * PW, (by1 - by0) * PH);
    const fs = (by1 - by0) * PH * 0.7, s = hk < 1 ? 1.6 - 0.6 * eback(hk, 1.5) : 1; ctx.translate(X((bx0 + bx1) / 2), Y((by0 + by1) / 2)); ctx.scale(s, s);
    ctx.font = `${fs}px 'Dela Gothic One', 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    const tw = ctx.measureText(CFG.title).width, sc = Math.min(1, (bx1 - bx0) * PW * 0.92 / tw); ctx.scale(sc, sc); ctx.fillText(CFG.title, 0, fs * 0.05); ctx.restore(); }
  // 紅色印章「號外」
  const sk = lin(l, 0.35, 0.47);
  if (sk > 0) { const [sx, sy, sr] = G.stamp, s = sk < 1 ? 2.4 - 1.4 * sk : 1; ctx.save(); ctx.translate(X(sx), Y(sy)); ctx.rotate(-0.18); ctx.scale(s, s); ctx.globalAlpha = Math.min(1, sk * 2);
    ctx.fillStyle = '#d0142c'; ctx.beginPath(); ctx.arc(0, 0, sr * PW * 0.92, 0, 7); ctx.fill();
    ctx.font = `900 ${sr * PW * 0.62}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff6e8'; ctx.fillText(LX('ex1'), 0, -sr * PW * 0.33, sr * PW * 1.5); ctx.fillText(LX('ex2'), 0, sr * PW * 0.36, sr * PW * 1.5); ctx.restore(); }
  // 紅色副標帶：名字與份數
  const nk = eo(lin(l, 0.55, 0.8));
  if (nk > 0) { const by = Y(G.band), bh = PH * 0.06; ctx.save(); ctx.fillStyle = '#c8102e'; ctx.fillRect(X(0.03), by - bh / 2, PW * 0.94 * nk, bh);
    ctx.beginPath(); ctx.rect(X(0.03), by - bh / 2, PW * 0.94 * nk, bh); ctx.clip();
    ctx.font = `900 ${bh * 0.56}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), 0, by + 2); ctx.restore(); }
}
let _newsSmall = null;
function newsSmall() {   // 背景小報紙：照片框先塗滿，避免露出透明洞
  if (_newsSmall) return _newsSmall; const w = 300, h = Math.round(w * NEWS_PAPER.height / NEWS_PAPER.width), c = mk(w, h), x = c.getContext('2d'), [a, b, cc, d] = NEWS_GEO.photo;
  x.fillStyle = '#e9e0cf'; x.fillRect(a * w, b * h, (cc - a) * w, (d - b) * h); x.drawImage(NEWS_PAPER, 0, 0, w, h); _newsSmall = c; return c;
}
function vExtra(ctx, t) {
  if (!NEWS_PAPER) return;
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.25)), pal = PAL[CFG.pal], LAND = 1.25, MOVE = 2.7;
  ctx.save(); ctx.globalAlpha = app * (1 - out); palBG(ctx, t, PAL.red, 960, 540); ctx.fillStyle = 'rgba(20,4,8,0.35)'; ctx.fillRect(0, 0, W, H);
  if (t > LAND) halftone(ctx, 0, 0, W, H, 'rgba(255,220,200,0.12)', t);
  ctx.restore();
  // 背景飛過的小報紙
  if (t > LAND) for (let i = 0; i < 12; i++) { const st = LAND + R(i, 1) * 1.6, q = (t - st) / 1.6; if (q < 0 || q > 1) continue;
    const ph = 150 + R(i, 2) * 120, pw = ph * NEWS_PAPER.width / NEWS_PAPER.height, x = -200 + (W + 400) * q * (0.7 + R(i, 3) * 0.6), y = 120 + R(i, 4) * 840 - Math.sin(q * 3) * 80;
    ctx.save(); ctx.globalAlpha = (1 - out) * 0.9; ctx.translate(R(i, 5) > 0.5 ? x : W - x, y); ctx.rotate(q * (R(i, 6) - 0.5) * 9); ctx.drawImage(newsSmall(), -pw / 2, -ph / 2, pw, ph); ctx.restore(); }
  // 主報紙：旋轉飛進來→落地→往左推、微傾
  const PH = 980, PW = PH * NEWS_PAPER.width / NEWS_PAPER.height, k = eo(lin(t, 0.15, LAND)), mv = eo5(lin(t, MOVE, MOVE + 0.45));
  const sc = (0.04 + 0.96 * k) * (1 - 0.12 * mv), rot = (1 - k) * Math.PI * 7 - 0.07 * mv, x = 960 - 420 * mv - out * 1300, y = 540 + 10 * mv;
  const pk = t >= LAND ? Math.exp(-(t - LAND) * 10) : 0;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(x + (R(Math.floor(t * 60), 3) - 0.5) * pk * 24, y + (R(Math.floor(t * 60), 4) - 0.5) * pk * 24); ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; ctx.fillStyle = '#000'; ctx.fillRect(-PW / 2 + 6, -PH / 2 + 6, PW - 12, PH - 12); ctx.shadowColor = 'transparent';
  drawPaper(ctx, PW, PH, t, t >= LAND ? t - LAND : -1);
  ctx.restore();
  if (t >= LAND) flash(ctx, (1 - lin(t, LAND, LAND + 0.12)) * 0.5, '#fff');
  if (t >= LAND && t < LAND + 0.5) { ctx.save(); ctx.globalAlpha = 1 - (t - LAND) / 0.5; speedLines(ctx, 960, 540, 60, 560, 'rgba(255,255,255,0.8)', 7, 0, 1); ctx.restore(); }
  // 落地後：右側大字
  const l = t - MOVE;
  if (l > 0) {
    const gk = lin(l, 0.2, 0.5); if (gk > 0 && GIRL) { ctx.save(); ctx.globalAlpha = 1 - out; const gx = 1450 + (1 - eback(gk, 1.6)) * 600 + out * 700; neonOutline(ctx, GIRL_SIL, gx, 640, 860, t, -0.04); drawImg(ctx, GIRL, gx, 640, 860, -0.04); ctx.restore(); }
    const tk = lin(l, 0.4, 0.6); if (tk > 0) { const ss = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(1450, 110); ctx.rotate(-0.05); ctx.scale(ss, ss); smallTitle(ctx, t, '號外! 號外!', 0, 0, 84, PAL.gold, 'center'); ctx.restore(); }
  }
}
VARS.g10[4] = { name: '號外', fn: vExtra, dur: 5.2 };

// ---------------- 大量 3：VS 對決 ----------------
function bolt(ctx, x0, y0, x1, y1, seed, w, col) {   // 鋸齒閃電
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'miter'; ctx.shadowColor = col; ctx.shadowBlur = 20; ctx.beginPath(); ctx.moveTo(x0, y0);
  for (let i = 1; i < 8; i++) { const u = i / 8; ctx.lineTo(x0 + (x1 - x0) * u + (R(seed, i) - 0.5) * 70, y0 + (y1 - y0) * u + (R(seed, i + 9) - 0.5) * 70); }
  ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
}
function vVersus(ctx, t) {
  const D = CFG.dur, out = ei(lin(t, D - 0.5, D - 0.05)), pal = PAL[CFG.pal];
  const IN = 0.15, VS = 0.6, CLASH = 0.95, PUSH = 2.35, WIN = 2.6;
  const ink = eo5(lin(t, IN, IN + 0.35));
  // 分界線位置：對峙時左右推擠，最後藍方一口氣推過去
  let cx = 960 + Math.sin(Math.max(0, t - CLASH) * 9) * 40 * lin(t, CLASH, PUSH) + Math.sin(Math.max(0, t - CLASH) * 23) * 12 * lin(t, CLASH, PUSH);
  if (t > PUSH) cx += (W + 700 - cx) * ei(lin(t, PUSH, WIN));
  const won = t >= WIN, edge = (y) => cx + (y - 540) * 0.32;
  ctx.save(); ctx.globalAlpha = 1 - out;
  if (!won) {
    // 右（紅）
    ctx.save(); ctx.globalAlpha *= ink; const gr = ctx.createLinearGradient(W, 0, 960, H); gr.addColorStop(0, '#ff3a4a'); gr.addColorStop(1, '#4a0010'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    speedLines(ctx, 1500, 540, 40, 380, 'rgba(255,220,220,0.25)', Math.floor(t * 20), 0, 1); ctx.restore();
    if (GIRL) { const gx = 1440 + (1 - ink) * 900 + Math.max(0, cx - 960) * 0.4; ctx.save(); ctx.globalAlpha *= ink; neonOutline(ctx, GIRL_SIL, gx, 600, 900, t, -0.06); drawImg(ctx, GIRL, gx, 600, 900, -0.06); ctx.restore(); }
    // 左（藍）：用分界線裁切
    ctx.save(); ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(edge(-10), -10); ctx.lineTo(edge(H + 10), H + 10); ctx.lineTo(-10, H + 10); ctx.closePath(); ctx.clip();
    ctx.globalAlpha *= ink; const gl = ctx.createLinearGradient(0, 0, 960, H); gl.addColorStop(0, '#3a8aff'); gl.addColorStop(1, '#0a1450'); ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
    speedLines(ctx, 420, 540, 40, 380, 'rgba(210,230,255,0.25)', Math.floor(t * 20) + 50, 0, 1);
    const mx = 470 - (1 - ink) * 900 + Math.min(0, cx - 960) * 0.4 + (t > PUSH ? (cx - 960) * 0.5 : 0);
    if (MASCOT) drawImg(ctx, MASCOT, mx, 600, 640, 0.08);
    ctx.restore();
    // 分界線：白色粗線＋火花
    ctx.save(); ctx.globalAlpha *= ink; ctx.strokeStyle = '#fff'; ctx.lineWidth = 14; ctx.shadowColor = '#fff'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.moveTo(edge(-20), -20); ctx.lineTo(edge(H + 20), H + 20); ctx.stroke(); ctx.restore();
    if (t > CLASH) for (let i = 0; i < 4; i++) { const y = 120 + ((t * 700 + i * 260) % 840); sparkBurst(ctx, edge(y), y, (t * 3 + i * 0.25) % 0.6, 8, 1.2, i % 2 ? '#bfe0ff' : '#ffd0c8'); }
    // 名牌
    const pk = eo5(lin(t, IN + 0.2, IN + 0.5));
    if (pk > 0) { ctx.save(); ctx.translate(-600 * (1 - pk), 0); ctx.fillStyle = 'rgba(5,10,40,0.85)'; ctx.beginPath(); ctx.moveTo(60, 860); ctx.lineTo(720, 860); ctx.lineTo(680, 960); ctx.lineTo(20, 960); ctx.fill();
      hudText(ctx, 'GIFTER', 90, 840, 26, '#8fc4ff'); ctx.font = "900 54px 'Noto Sans TC'"; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(P.name, 80, 912); ctx.restore(); }
    // 集氣條：份數一路數上去
    if (t > CLASH) { const g = lin(t, CLASH, PUSH), n = Math.max(1, Math.round(CFG.n * eo(g)));
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(80, 70, 700, 40); const bar = ctx.createLinearGradient(80, 0, 780, 0); bar.addColorStop(0, '#5fd0ff'); bar.addColorStop(1, '#ffffff'); ctx.fillStyle = bar; ctx.fillRect(84, 74, 692 * eo(g), 32);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(80, 70, 700, 40); ctx.restore();
      hudText(ctx, 'GIFT POWER', 84, 140, 26, '#bfe0ff'); smallTitle(ctx, t, '×' + n, 820, 92, 70, PAL.sky, 'left'); }
    // VS 大字
    const vk = lin(t, VS, VS + 0.18);
    if (vk > 0) { const s = vk < 1 ? 3.2 - 2.2 * eo(vk) : 1 + Math.sin(t * 30) * 0.02 * lin(t, CLASH, PUSH); ctx.save(); ctx.translate(edge(470), 470); ctx.rotate(-0.12); ctx.scale(s, s);
      smallTitle(ctx, t, 'VS', 0, 0, 260, PAL.gold, 'center'); ctx.restore();
      if (t < VS + 0.5) for (let i = 0; i < 4; i++) bolt(ctx, edge(470), 470, edge(470) + Math.cos(i * 1.7 + 0.4) * 520, 470 + Math.sin(i * 1.7 + 0.4) * 380, i + Math.floor(t * 30), 6, '#fff6c0');
      if (t >= VS) flash(ctx, (1 - lin(t, VS, VS + 0.12)) * 0.45, '#fff'); }
  } else {
    // 勝負揭曉：金色背景，大勝利
    const l = t - WIN;
    palBG(ctx, t, PAL.gold, 960, 520); ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960, 520, 14, 'rgba(255,240,180,0.2)', t * 0.4, 1800, 0.45, 16); ctx.restore();
    confetti(ctx, t, WIN, 70, ['#ffd24a', '#ff5a6a', '#5fb8ff', '#ffffff'], 21);
    const gk = lin(l, 0.1, 0.4); if (GIRL && gk > 0) { const s = eback(gk, 1.6); ctx.save(); ctx.translate(820, 620); ctx.scale(s, s); neonOutline(ctx, GIRL_SIL, 0, 0, 900, t, 0.03); drawImg(ctx, GIRL, 0, 0, 900, 0.03); ctx.restore(); }
    const mk2 = lin(l, 0.25, 0.5); if (MASCOT && mk2 > 0) drawImg(ctx, MASCOT, 300, 760 + (1 - eback(mk2, 1.6)) * 500, 440, -0.1);
    const wk = lin(l, 0.05, 0.22); if (wk > 0) { const s = wk < 1 ? 2.6 - 1.6 * eo(wk) : 1; ctx.save(); ctx.translate(1430, 300); ctx.rotate(-0.08); ctx.scale(s, s); smallTitle(ctx, t, '大勝利!', 0, 0, 150, PAL.red, 'center'); ctx.restore(); }
    const tk = lin(l, 0.45, 0.65); if (tk > 0) { const ss = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.translate(1430, 560); ctx.rotate(-0.05); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 110, pal, 'center'); ctx.restore(); }
    const nk = eo(lin(l, 0.65, 0.85)); if (nk > 0) { ctx.save(); ctx.globalAlpha *= nk; ctx.font = "900 48px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#3a1400'; ctx.lineWidth = 12; ctx.strokeText(nameLine(), 1430, 670); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), 1430, 670); ctx.restore(); }
    flash(ctx, (1 - lin(t, WIN, WIN + 0.15)) * 0.7, '#fff');
  }
  ctx.restore();
}
VARS.g10[3] = { name: 'VS 對決', fn: vVersus, dur: 5.2 };

// ======================= 第四批：贈訂特大（g25） =======================
let CHEST_BODY = null, CHEST_LID = null, ROCKET = null;
const CHEST_GEO = { lidDY: 0.43 };   // 蓋子蓋上時，蓋子底緣在箱身頂端往下多少（箱身高比例）
const _lvaBase5 = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaBase5();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  CHEST_BODY = await L2('DEF_CHEST_BODY', 'chest_body.png'); CHEST_LID = await L2('DEF_CHEST_LID', 'chest_lid.png'); ROCKET = await L2('DEF_ROCKET', 'rocket.png');
};
function bigCount(ctx, t, x, y, size, k) {   // 「×N」大字，k = 進場進度
  if (k <= 0) return; const s = k < 1 ? 2.2 - 1.2 * eback(k, 1.6) : 1 + Math.sin(t * 6) * 0.015;
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.06); ctx.scale(s, s); smallTitle(ctx, t, '×' + CFG.n, 0, 0, size, PAL.gold, 'center'); ctx.restore();
}
function nameAt(ctx, x, y, a, size = 48, stroke = '#3a1400') {
  if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.font = `900 ${size}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke; ctx.lineWidth = size * 0.25; ctx.strokeText(nameLine(), x, y); ctx.fillStyle = '#fff'; ctx.fillText(nameLine(), x, y); ctx.restore();
}

// ---------------- 特大 1：寶箱 ----------------
const CH_T = { drop: 0.2, land: 0.55, r1: 1.0, r2: 1.55, r3: 2.0, open: 2.45 };
function vChest(ctx, t) {
  if (!CHEST_BODY) return;
  const D = CFG.dur, T = CH_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), opened = t >= T.open;
  ctx.save(); ctx.globalAlpha = app * (1 - out); palBG(ctx, t, PAL.gold, 960, 620); ctx.fillStyle = `rgba(40,16,0,${opened ? 0.1 : 0.45})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  const bw = 560, sc = bw / CHEST_BODY.width, bh = CHEST_BODY.height * sc, lw = CHEST_LID.width * sc, lh = CHEST_LID.height * sc, cx = 960, base = 1010;
  // 落下＋三次搖晃（一次比一次大），每次蓋縫漏光
  let y = base, jx = 0, rot = 0, lift = 0, leak = 0;
  if (t < T.land) { const u = lin(t, T.drop, T.land); y = -200 + (base + 200) * u * u; }
  const sq = t >= T.land ? Math.exp(-(t - T.land) * 12) * Math.sin((t - T.land) * 40) : 0;
  [[T.r1, 0.5], [T.r2, 0.75], [T.r3, 1]].forEach(([rt, p]) => { const l = t - rt; if (l > 0 && l < 0.35) { const k = Math.sin(l / 0.35 * Math.PI); y -= 40 * p * k; jx += Math.sin(l * 70) * 10 * p; rot += Math.sin(l * 50) * 0.05 * p; lift += 26 * p * k; } if (l > 0) leak = Math.max(leak, p * Math.exp(-l * 1.5)); });
  if (t > T.r3) leak = Math.max(leak, lin(t, T.r3 + 0.2, T.open));
  const pk = t >= T.land && t < T.land + 0.3 ? 1 - (t - T.land) / 0.3 : opened ? Math.exp(-(t - T.open) * 7) : 0;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * pk * 20, (R(Math.floor(t * 60), 2) - 0.5) * pk * 20);
  // 開箱：光柱、角色從箱子裡升起（箱身前緣蓋住下半）
  if (opened) { const l = t - T.open;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(20px)'; const gp = ctx.createLinearGradient(0, base - bh, 0, -100); gp.addColorStop(0, `rgba(255,245,200,${0.95 * Math.min(1, l * 4)})`); gp.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = gp; ctx.beginPath(); ctx.moveTo(cx - bw * 0.4, base - bh * 0.6); ctx.lineTo(cx + bw * 0.4, base - bh * 0.6); ctx.lineTo(cx + bw * 0.9, -100); ctx.lineTo(cx - bw * 0.9, -100); ctx.fill(); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, cx, base - bh * 0.6, 16, `rgba(255,240,180,${0.25 * Math.min(1, l * 3)})`, l * 0.5, 1800, 0.4, 16); ctx.restore();
    coinFountain(ctx, t, T.open, T.open + 2.0, 110);   // 金幣在角色後面噴
    const gk = eo(lin(l, 0.15, 0.85)); if (GIRL && gk > 0) { const gh = 820, gy = base - bh * 0.4 + gh / 2 - (gh * 0.95) * gk; ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, base - bh * 0.55); ctx.clip(); neonOutline(ctx, GIRL_SIL, cx, gy, gh, t, 0); drawImg(ctx, GIRL, cx, gy, gh, 0); ctx.restore(); }
  }
  ctx.save(); ctx.translate(cx + jx, y); ctx.rotate(rot); ctx.scale(1 + sq * 0.06, 1 - sq * 0.06);
  if (leak > 0 && !opened) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)'; ctx.fillStyle = `rgba(255,240,170,${leak})`; ctx.fillRect(-bw * 0.46, -bh + bh * CHEST_GEO.lidDY - 14 - lift, bw * 0.92, 18 + lift); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(12px)'; for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i - 3.5) * 0.18; ctx.strokeStyle = `rgba(255,240,180,${0.4 * leak})`; ctx.lineWidth = 26; ctx.beginPath(); ctx.moveTo(0, -bh + bh * CHEST_GEO.lidDY - lift); ctx.lineTo(Math.cos(a) * 900 * leak, -bh + Math.sin(a) * 900 * leak); ctx.stroke(); } ctx.restore(); }
  ctx.drawImage(CHEST_BODY, -bw / 2, -bh, bw, bh);
  if (!opened) ctx.drawImage(CHEST_LID, -lw / 2, -bh + bh * CHEST_GEO.lidDY - lh - lift, lw, lh);
  ctx.restore();
  if (opened) { const l = t - T.open, ly = y - bh + bh * CHEST_GEO.lidDY - lh / 2 - 2600 * l + 2400 * l * l; if (ly > -400) { ctx.save(); ctx.translate(cx + l * 700, ly); ctx.rotate(l * 9); ctx.drawImage(CHEST_LID, -lw / 2, -lh / 2, lw, lh); ctx.restore(); } }
  ctx.restore();
  if (t >= T.land && t < T.land + 0.6) for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const l = (t - T.land) / 0.6; ctx.save(); ctx.globalAlpha = 0.5 * (1 - l); ctx.fillStyle = '#fff3d8'; ctx.beginPath(); ctx.arc(cx + sx * (bw * 0.45 + l * 220 + i * 30), base - 10 - i * 12 - l * 30, 22 + l * 40 - i * 4, 0, 7); ctx.fill(); ctx.restore(); }
  if (opened) {
    const l = t - T.open;
    confetti(ctx, t, T.open + 0.1, 80, ['#ffd24a', '#ff5a6a', '#ffffff', '#ffb000'], 31);
    const tk = lin(l, 0.6, 0.8); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(420, 330); ctx.rotate(-0.07); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 120, PAL.gold, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1500, 380, 220, lin(l, 0.75, 0.95)); ctx.restore();
    nameAt(ctx, 420, 450, eo(lin(l, 0.85, 1.05)) * (1 - out));
    flash(ctx, (1 - lin(t, T.open, T.open + 0.15)) * 0.7, '#fff6d0');
  }
}

// ---------------- 特大 2：火箭 ----------------
const RK_T = { ign: 0.35, lift: 1.25, space: 2.2, loop0: 2.45, loop1: 3.55, exit: 3.85 };
const RK_LOOP = { cx: 960, cy: 470, r: 330 };
function rocketPos(t) {   // 回傳 [x, y, 角度]（畫面座標，已含鏡頭）
  const T = RK_T, L = RK_LOOP;
  if (t < T.lift) return [960, 820, 0];
  if (t < T.space) { const u = lin(t, T.lift, T.space); return [960, 820 - 1300 * u * u, 0]; }   // 衝出畫面（鏡頭追上）
  if (t < T.loop0) { const u = eo(lin(t, T.space, T.loop0)); return [960 - L.r * u * 0.0, 1300 - (1300 - (L.cy + L.r)) * u, -Math.PI / 2 + Math.PI / 2]; }
  if (t < T.loop1) { const u = lin(t, T.loop0, T.loop1), a = Math.PI / 2 - u * Math.PI * 2; return [L.cx + Math.cos(a) * L.r, L.cy + Math.sin(a) * L.r, a - Math.PI]; }
  const u = lin(t, T.loop1, T.exit + 0.6); return [L.cx + 700 * u * u * 1.2, L.cy + L.r - 1400 * u * u, 0.6];
}
function rocketFlame(ctx, x, y, s, t, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); const f = 1 + Math.sin(t * 60) * 0.12 + R(Math.floor(t * 30), 3) * 0.15;
  for (const [col, w, h] of [['#ff4a2a', 0.42, 1.25], ['#ffb020', 0.3, 0.95], ['#fff6c0', 0.16, 0.6]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-s * w, 0); ctx.quadraticCurveTo(-s * w * 0.6, s * h * f * 0.6, 0, s * h * f); ctx.quadraticCurveTo(s * w * 0.6, s * h * f * 0.6, s * w, 0); ctx.closePath(); ctx.fill(); }
  ctx.lineWidth = 4; ctx.strokeStyle = '#3a1400'; ctx.beginPath(); ctx.moveTo(-s * 0.42, 0); ctx.quadraticCurveTo(-s * 0.25, s * 1.25 * f * 0.6, 0, s * 1.25 * f); ctx.quadraticCurveTo(s * 0.25, s * 1.25 * f * 0.6, s * 0.42, 0); ctx.stroke();
  ctx.restore();
}
function vRocket(ctx, t) {
  if (!ROCKET) return;
  const D = CFG.dur, T = RK_T, L = RK_LOOP, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3));
  const cam = eio2(lin(t, T.lift + 0.3, T.space + 0.3));   // 0 = 地面，1 = 太空
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  const sky = ctx.createLinearGradient(0, 0, 0, H); const mixc = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * cam));
  const top = mixc([90, 170, 255], [16, 10, 50]), bot = mixc([200, 235, 255], [60, 20, 90]); sky.addColorStop(0, `rgb(${top})`); sky.addColorStop(1, `rgb(${bot})`); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // 星星（太空才出現）
  if (cam > 0) for (let i = 0; i < 90; i++) { const x = R(i, 1) * W, y = ((R(i, 2) * H + t * 120 * (1 - lin(t, T.space, T.loop0))) % H); ctx.fillStyle = `rgba(255,255,240,${cam * (0.4 + 0.6 * R(i, 3)) * (0.6 + 0.4 * Math.sin(t * 5 + i))})`; ctx.fillRect(x, y, 3, 3); }
  // 雲：鏡頭往上時往下掉
  for (let i = 0; i < 7; i++) { const cy0 = 120 + i * 150 + cam * 1600 + (t > T.lift ? (t - T.lift) * 200 : 0), cx0 = (R(i, 4) * W + i * 300) % W; if (cy0 > H + 200) continue;
    ctx.fillStyle = '#ffffff'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(cx0 + k * 70 - 100, cy0 - (k % 2) * 30, 60 - (k % 2) * 8, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(170,200,240,0.6)'; ctx.beginPath(); ctx.ellipse(cx0 + 5, cy0 + 34, 170, 26, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(cx0 + 5, cy0 + 22, 168, 26, 0, 0, 7); ctx.fill(); }
  // 地面與發射台
  const gy = 960 + cam * 1400;
  if (gy < H + 300) { ctx.fillStyle = '#6ad06a'; ctx.fillRect(0, gy, W, H); ctx.fillStyle = '#4a4a5a'; ctx.fillRect(820, gy - 40, 280, 44); ctx.strokeStyle = '#2a2440'; ctx.lineWidth = 5; ctx.strokeRect(820, gy - 40, 280, 44); }
  ctx.restore();
  // 煙：點火後在發射台堆起，升空後留在地面
  if (t > T.ign) for (let i = 0; i < 26; i++) { const st = T.ign + R(i, 5) * 1.2, l = t - st; if (l < 0) continue; const side = R(i, 6) - 0.5, x = 960 + side * (200 + l * 700), y = gy - 30 - l * 60 * R(i, 7) + cam * 0, r = 50 + l * 90;
    ctx.save(); ctx.globalAlpha = (1 - out) * Math.max(0, 0.95 - l * 0.35); ctx.fillStyle = '#d8d4dc'; ctx.beginPath(); ctx.arc(x + r * 0.12, y + r * 0.15, r, 0, 7); ctx.fill(); ctx.fillStyle = '#f7f5f2'; ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, 7); ctx.fill(); ctx.restore(); }
  // 繞圈的光跡
  if (t > T.loop0) { const u1 = Math.min(1, lin(t, T.loop0, T.loop1)); ctx.save(); ctx.globalAlpha = 1 - out; ctx.lineCap = 'round';
    for (const [w, c] of [[44, 'rgba(255,190,80,0.35)'], [22, 'rgba(255,230,150,0.9)'], [8, '#ffffff']]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(L.cx, L.cy, L.r, Math.PI / 2, Math.PI / 2 - u1 * Math.PI * 2 - 0.0001, true); ctx.stroke(); } ctx.restore(); }
  // 火箭
  const [rx, ry, ra] = rocketPos(t), shake = t > T.ign && t < T.lift ? (R(Math.floor(t * 60), 8) - 0.5) * 10 : 0, rh = t < T.space ? 360 : 230;
  if (rx > -300 && rx < W + 300 && ry > -400 && ry < H + 400) {
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(rx + shake, ry); ctx.rotate(ra);
    if (t > T.ign) rocketFlame(ctx, 0, rh * 0.46, rh * 0.32 * (t > T.lift ? 1.3 : 0.7 + 0.3 * lin(t, T.ign, T.lift)), t, 0);
    ctx.drawImage(ROCKET, -ROCKET.width * rh / ROCKET.height / 2, -rh / 2, ROCKET.width * rh / ROCKET.height, rh); ctx.restore();
  }
  // 倒數
  if (t < T.lift + 0.1) { const n = t < 0.65 ? '3' : t < 0.95 ? '2' : '1', st = t < 0.65 ? 0.35 : t < 0.95 ? 0.65 : 0.95, k = lin(t, st, st + 0.12); if (t > 0.35) { ctx.save(); ctx.translate(1420, 420); const s = 1.8 - 0.8 * eo(k); ctx.scale(s, s); ctx.globalAlpha = 1 - lin(t - st, 0.2, 0.3); smallTitle(ctx, t, n, 0, 0, 200, PAL.red, 'center'); ctx.restore(); } }
  if (t >= T.lift && t < T.lift + 0.5) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.lift + 0.3, T.lift + 0.5); ctx.translate(1420, 420); smallTitle(ctx, t, 'LIFT OFF!', 0, 0, 120, PAL.red, 'center'); ctx.restore(); }
  // 圈圈完成：光環裡出現角色，煙火
  if (t > T.loop1) { const l = t - T.loop1, k = eback(lin(l, 0.05, 0.4), 1.6);
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; godRays(ctx, L.cx, L.cy, 14, `rgba(255,230,160,${0.25 * Math.min(1, l * 3)})`, l * 0.4, 1600, 0.4, 16); ctx.restore();
    if (k > 0) { ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(L.cx, L.cy); ctx.scale(k, k); drawBust(ctx, 0, 0, L.r - 40, t); ctx.restore(); }
    fireworksAt(ctx, t, [[T.loop1 + 0.15, 380, 260, 40], [T.loop1 + 0.35, 1540, 230, 200], [T.loop1 + 0.6, 1600, 560, 320], [T.loop1 + 0.8, 320, 600, 120]]);
    const tk = lin(l, 0.35, 0.55); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(L.cx, L.cy + L.r + 110); ctx.rotate(-0.03); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 110, PAL.gold, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1530, 470, 190, lin(l, 0.5, 0.7)); ctx.restore();
    nameAt(ctx, L.cx, L.cy + L.r + 210, eo(lin(l, 0.6, 0.8)) * (1 - out), 46, '#1a0838');
    flash(ctx, (1 - lin(t, T.loop1, T.loop1 + 0.15)) * 0.6, '#fff6d0');
  }
}
VARS.g25[1] = { name: '寶箱', fn: vChest, dur: 6.0 };
VARS.g25[2] = { name: '火箭', fn: vRocket, dur: 6.0 };

// ---------------- 特大 3：舞台大幕 ----------------
let CURT_L = null, CURT_R = null, CURT_TOP = null;
const _lvaBase6 = window.loadVarAssets;
window.loadVarAssets = async function () {
  await _lvaBase6();
  const L2 = async (k, f) => { const im = await load(window[k] || ('../assets/' + f)); return im ? trimmed(im) : null; };
  CURT_L = await L2('DEF_CURT_L', 'curtain_l.png'); CURT_R = await L2('DEF_CURT_R', 'curtain_r.png'); CURT_TOP = await L2('DEF_CURT_TOP', 'curtain_top.png');
};
const CU_T = { peek0: 1.25, peek1: 2.05, open: 2.35, opened: 3.0 };
function vCurtain(ctx, t) {
  if (!CURT_L) return;
  const D = CFG.dur, T = CU_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), pal = PAL[CFG.pal];
  const ok = eio2(lin(t, T.open, T.opened)), lit = lin(t, T.open + 0.2, T.open + 0.6);
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  // 舞台：開幕前很暗，開幕後金色＋光束
  ctx.fillStyle = '#1a0606'; ctx.fillRect(0, 0, W, H);
  if (lit > 0) { ctx.save(); ctx.globalAlpha *= lit; palBG(ctx, t, PAL.gold, 960, 460); ctx.restore(); }
  ctx.fillStyle = '#5a2a14'; ctx.beginPath(); ctx.ellipse(960, 1080, 1100, 170, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#7a3e1e'; ctx.beginPath(); ctx.ellipse(960, 1090, 1000, 140, 0, Math.PI, 0); ctx.fill();
  if (lit > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(18px)';
    [[300, '#ff6ab0', 0.4], [1620, '#5fc8ff', -0.4], [700, '#fff3c0', 0.15], [1220, '#fff3c0', -0.15]].forEach(([x, c, a], i) => { const sw = Math.sin(t * 1.6 + i) * 0.12; ctx.save(); ctx.translate(x, -40); ctx.rotate(a + sw); const g = ctx.createLinearGradient(0, 0, 0, 1200); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.45 * lit; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(30, 0); ctx.lineTo(260, 1200); ctx.lineTo(-260, 1200); ctx.fill(); ctx.restore(); });
    ctx.restore(); }
  // 角色：偷看時只露臉，開幕後全身
  if (GIRL) {
    const pk = t > T.peek0 && t < T.peek1 + 0.1 ? Math.sin(Math.PI * lin(t, T.peek0, T.peek1 + 0.1)) : 0;
    if (t < T.open && pk > 0) { const G = girlGeo(960, 0, 1100); const fx = 960 + 40, fy = 470; ctx.save(); ctx.translate(fx - (G.fx - 960) - 60 * (1 - pk), fy - G.fy); ctx.rotate(-0.12); drawImg(ctx, GIRL, 0, 0, 1100, 0); ctx.restore(); }
    if (t >= T.open) { const k = eback(lin(t, T.open + 0.25, T.opened + 0.1), 1.4); if (k > 0) { ctx.save(); ctx.translate(780, 700); ctx.scale(k, k); neonOutline(ctx, GIRL_SIL, 0, 0, 760, t, 0); drawImg(ctx, GIRL, 0, 0, 760, 0); ctx.restore(); } }
  }
  if (MASCOT && t > T.opened) { const k = eback(lin(t, T.opened, T.opened + 0.35), 1.6); drawImg(ctx, MASCOT, 520, 1100 - 200 * k, 340, -0.12); }
  // 布幕：關上時各蓋半邊，微微晃動；偷看時中間拉開一條縫；開幕時往兩側收攏
  const cH = 1180, sway = Math.sin(t * 2.2) * 6, peekGap = t > T.peek0 && t < T.open ? 70 * Math.sin(Math.PI * lin(t, T.peek0, T.peek1 + 0.1)) : 0;
  for (const side of [-1, 1]) {
    const img = side < 0 ? CURT_L : CURT_R, wClosed = 1010, w = wClosed * (1 - 0.62 * ok), xIn = 960 + side * (peekGap + 300 * 0) , edge = side < 0 ? 960 - peekGap - (960 - peekGap) * ok * 0 : 960 + peekGap;
    const x0 = side < 0 ? (edge - w) - ok * (960 - w) * 0 - ok * 0 : edge, xx = side < 0 ? -40 + (edge + 40 - w) * (1 - ok) + 0 : edge + (W + 40 - edge - w) * ok;
    const drawX = side < 0 ? (ok > 0 ? -40 : edge - w) : xx;
    ctx.save(); ctx.translate(sway * side * (1 - ok), 0); ctx.drawImage(img, drawX, -60, w, cH); ctx.restore();
  }
  // 帷頭
  const th = 290, tw = W + 80; ctx.drawImage(CURT_TOP, -40, -40, tw, th);
  ctx.restore();
  // 開幕前：聚光燈在布幕上掃
  if (t < T.open + 0.2) { const a = (1 - lin(t, T.open, T.open + 0.2)) * app; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(26px)';
    for (const [ph, sp] of [[0, 1.3], [2, 1.7]]) { const x = 960 + Math.sin(t * sp + ph) * 520 * (1 - lin(t, T.peek0 - 0.3, T.peek0)), y = 560 + Math.cos(t * sp * 0.7 + ph) * 120; const g = ctx.createRadialGradient(x, y, 0, x, y, 260); g.addColorStop(0, `rgba(255,245,210,${0.55 * a})`); g.addColorStop(1, 'rgba(255,230,160,0)'); ctx.fillStyle = g; ctx.fillRect(x - 260, y - 260, 520, 520); }
    ctx.restore(); }
  if (t > T.peek0 + 0.15 && t < T.peek1) { ctx.save(); ctx.globalAlpha = Math.min(1, (t - T.peek0 - 0.15) * 6) * (1 - lin(t, T.peek1 - 0.15, T.peek1)); ctx.translate(1300, 420); ctx.rotate(0.08); smallTitle(ctx, t, 'まもなく開演', 0, 0, 64, PAL.gold, 'center'); ctx.restore(); }
  if (t >= T.open) {
    const l = t - T.open;
    confetti(ctx, t, T.open + 0.3, 90, ['#ffd24a', '#ff5a8a', '#5fc8ff', '#ffffff', '#9dff8a'], 41);
    for (const sx of [-1, 1]) { const q = l - 0.35; if (q > 0 && q < 0.8) for (let i = 0; i < 24; i++) { const a = -Math.PI / 2 - sx * (0.35 + R(i, 1) * 0.5), v = 900 + R(i, 2) * 700, x = 960 + sx * 900 + Math.cos(a) * v * q, y = 1000 + Math.sin(a) * v * q + 900 * q * q; ctx.fillStyle = ['#ffd24a', '#ff5a8a', '#5fc8ff', '#fff'][i % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(q * 12 + i); ctx.fillRect(-8, -4, 16, 8); ctx.restore(); } }
    const tk = lin(l, 0.6, 0.8); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(1260, 420); ctx.rotate(-0.05); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 100, pal, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1270, 610, 180, lin(l, 0.75, 0.95)); ctx.restore();
    nameAt(ctx, 1260, 780, eo(lin(l, 0.85, 1.05)) * (1 - out), 40);
    flash(ctx, (1 - lin(t, T.open + 0.2, T.open + 0.35)) * 0.4 * (t > T.open + 0.2 ? 1 : 0), '#fff6d0');
  }
}
VARS.g25[3] = { name: '舞台大幕', fn: vCurtain, dur: 6.0 };

// ---------------- 特大 4：十連抽 ----------------
const TP_T = { deal: 0.3, flip0: 1.25, step: 0.14, conf: 2.55, fly: 3.35, flip: 3.7 };
function tenCardPos(i) { return [960 + (i % 5 - 2) * 236, i < 5 ? 330 : 690]; }
function vTenPull(ctx, t) {
  if (!CARD_BACK) return;
  const D = CFG.dur, T = TP_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), pal = PAL[CFG.pal], CH = 300;
  const conf = lin(t, T.conf, T.fly), won = t >= T.flip;
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  const bg = ctx.createRadialGradient(960, 540, 0, 960, 540, 1200); bg.addColorStop(0, '#3a1a6a'); bg.addColorStop(1, '#0a0420'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (conf > 0 && !won) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(ctx, 960, 540, 6, `hsla(${(h * 60 + t * 200) % 360},100%,60%,${0.12 * conf})`, t * 1.2 + h * 0.5, 1600, 0.4, 14); ctx.restore(); }
  if (won) { palBG(ctx, t, PAL.rainbow, 960, 520); ctx.fillStyle = 'rgba(20,0,40,0.25)'; ctx.fillRect(0, 0, W, H); }
  // 召喚陣
  ctx.save(); ctx.translate(960, 560); ctx.scale(1, 0.42); ctx.rotate(t * 0.6); ctx.strokeStyle = `rgba(200,170,255,${0.5 + 0.4 * conf})`; ctx.lineWidth = 6; for (const r of [520, 470, 300]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i * Math.PI / 6); star4(ctx, 0, -495, 18, '#e8dcff', 0.8); ctx.restore(); } ctx.restore();
  ctx.restore();
  // 10 張卡
  const kinds = ['r1', 'r2', 'r1', 'r2', 'r1', 'r2', 'r1', 'r2', 'r1', 'ssr'];
  for (let i = 0; i < 10; i++) {
    const [tx, ty] = tenCardPos(i), dk = eback(lin(t, T.deal + i * 0.06, T.deal + i * 0.06 + 0.35), 1.4); if (dk <= 0) continue;
    let x = 960 + (tx - 960) * dk, y = 1300 + (ty - 1300) * dk, s = 1, rot = (1 - dk) * (i - 4.5) * 0.1, al = 1 - out;
    let fk = i < 9 ? lin(t, T.flip0 + i * T.step, T.flip0 + i * T.step + 0.16) : lin(t, T.flip, T.flip + 0.3);
    if (i === 9) { if (t > T.conf && t < T.fly) { x += Math.sin(t * 70) * 6 * conf; rot += Math.sin(t * 53) * 0.04 * conf; }
      const fl = eo5(lin(t, T.fly, T.fly + 0.35)); x += (960 - x) * fl; y += (520 - y) * fl; s = 1 + 0.75 * fl; }
    else if (t > T.conf) al *= 1 - 0.55 * lin(t, T.conf, T.conf + 0.4);
    if (i === 9 && won) { const up = eback(lin(t, T.flip + 0.15, T.flip + 0.5), 1.6); s *= 1 + 0.12 * up; }
    ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * (Math.abs(Math.cos(Math.PI * fk)) || 0.001), s);
    if (i === 9 && t > T.conf && !won) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(20px)'; ctx.fillStyle = `hsla(${(t * 400) % 360},100%,65%,${0.9 * conf})`; ctx.fillRect(-CH * 0.42, -CH * 0.58, CH * 0.84, CH * 1.16); ctx.restore(); }
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
    if (fk < 0.5) { const bw = CARD_BACK.width * CH / CARD_BACK.height; ctx.drawImage(CARD_BACK, -bw / 2, -CH / 2, bw, CH); }
    else { ctx.shadowColor = 'transparent'; const r = cardFace(ctx, kinds[i] === 'ssr' ? 'ssr' : 'r', CH, t, kinds[i]);
      if (kinds[i] === 'ssr' && r) { const nk = lin(t, T.flip + 0.4, T.flip + 0.6); if (nk > 0) { ctx.globalAlpha = al * nk; ctx.font = "900 22px 'Noto Sans TC'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a3000'; ctx.fillText(P.name, 0, r.plateY); } } }
    ctx.restore();
    if (i < 9 && fk > 0 && fk < 1) sparkBurst(ctx, x, y, (t - T.flip0 - i * T.step) * 1.5, 6, 0.5, '#d8c8ff');
  }
  if (t > T.conf + 0.1 && t < T.flip) { ctx.save(); ctx.globalAlpha = Math.floor(t * 8) % 2 ? 1 : 0.6; ctx.translate(960, 950); smallTitle(ctx, t, 'SSR 確定!?', 0, 0, 90, PAL.rainbow.rainbow ? PAL.gold : PAL.gold, 'center'); ctx.restore(); }
  if (won) {
    const l = t - T.flip;
    sparkBurst(ctx, 960, 480, l, 24, 2.2, '#fff6c0');
    confetti(ctx, t, T.flip, 80, ['#ffd24a', '#ff7ab8', '#7ad8ff', '#ffffff', '#b89aff'], 51);
    const tk = lin(l, 0.4, 0.6); if (tk > 0) { const ss = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(420, 420); ctx.rotate(-0.07); ctx.scale(ss, ss); smallTitle(ctx, t, CFG.title, 0, 0, 104, PAL.gold, 'center'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, 1500, 500, 200, lin(l, 0.55, 0.75)); ctx.restore();
    nameAt(ctx, 420, 530, eo(lin(l, 0.65, 0.85)) * (1 - out), 40, '#1a0838');
    flash(ctx, (1 - lin(t, T.flip, T.flip + 0.15)) * 0.6, '#fff');
  }
}
VARS.g25[4] = { name: '十連抽', fn: vTenPull, dur: 6.0 };

// ======================= 第五批：贈訂超大（g50） =======================
function inkText(ctx, txt, x, y, size, fill, stroke = '#1a0838', font = 'Noto Sans TC', w = 900) {
  ctx.save(); ctx.font = `${w} ${size}px '${font}'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke; ctx.lineWidth = size * 0.22; ctx.strokeText(txt, x, y); ctx.fillStyle = fill; ctx.fillText(txt, x, y); ctx.restore();
}
function endBlock(ctx, t, l, out, x, y, opts = {}) {   // 標題＋×N＋名字（共用收尾），opts.count 位置
  const tk = lin(l, 0, 0.2); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(x, y); ctx.rotate(opts.rot ?? -0.05); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, opts.size || 120, opts.pal || PAL.gold, 'center'); ctx.restore(); }
  const c = opts.count || [x, y + 190]; ctx.save(); ctx.globalAlpha = 1 - out; bigCount(ctx, t, c[0], c[1], opts.csize || 190, lin(l, 0.15, 0.35)); ctx.restore();
  const n = opts.name || [x, y + 330]; nameAt(ctx, n[0], n[1], eo(lin(l, 0.3, 0.5)) * (1 - out), 46, '#1a0838');
}

// ---------------- 超大 2：擲骰（ゾロ目） ----------------
const DICE_PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
function drawDie(ctx, x, y, s, rot, face, glow = 0) {   // 平塗骰子：正面＋上面＋側面
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  if (glow > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(30px)'; ctx.fillStyle = `hsla(${(Date.now ? 0 : 0) + 45},100%,70%,${glow})`; ctx.fillRect(-s * 0.8, -s * 0.9, s * 1.7, s * 1.7); ctx.restore(); }
  const d = s * 0.22;
  ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.045; ctx.strokeStyle = '#2b1a3a';
  ctx.fillStyle = '#e9e2f2'; ctx.beginPath(); ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(-s / 2 + d, -s / 2 - d); ctx.lineTo(s / 2 + d, -s / 2 - d); ctx.lineTo(s / 2, -s / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9bedb'; ctx.beginPath(); ctx.moveTo(s / 2, -s / 2); ctx.lineTo(s / 2 + d, -s / 2 - d); ctx.lineTo(s / 2 + d, s / 2 - d); ctx.lineTo(s / 2, s / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.16); ctx.fill(); ctx.stroke();
  const pc = face === 1 ? '#e8183a' : '#2b1a3a', pr = face === 1 ? s * 0.13 : s * 0.085;
  for (const [px, py] of DICE_PIPS[face]) { ctx.fillStyle = pc; ctx.beginPath(); ctx.arc(px * s * 0.26, py * s * 0.26, pr, 0, 7); ctx.fill(); }
  ctx.restore();
}
const DI_T = { drop: 0.3, land1: 1.35, land2: 1.55, teeter: 2.6, settle: 2.95 };
function vDice(ctx, t) {
  const D = CFG.dur, T = DI_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), won = t >= T.settle;
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  if (!won) { const g = ctx.createRadialGradient(960, 620, 0, 960, 620, 1100); g.addColorStop(0, '#1f8a5a'); g.addColorStop(1, '#063020'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#d8a83a'; ctx.lineWidth = 14; ctx.strokeRect(60, 60, W - 120, H - 120); ctx.strokeStyle = 'rgba(255,230,160,0.35)'; ctx.lineWidth = 4; ctx.strokeRect(84, 84, W - 168, H - 168); }
  else { palBG(ctx, t, PAL.rainbow, 960, 560); }
  ctx.restore();
  // 兩顆骰子：從上方甩進來翻滾；左邊先停 6，右邊在 5 跟 6 的邊上搖、最後倒向 6
  const s = 300, dice = [{ x0: 300, x1: 700, land: T.land1, seed: 1 }, { x0: 1700, x1: 1220, land: T.land2, seed: 2 }];
  dice.forEach((dd, i) => {
    const u = lin(t, T.drop, dd.land), x = dd.x0 + (dd.x1 - dd.x0) * eo(u), bounce = Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 380, y = 620 - bounce - (1 - u) * 300;
    let rot = (1 - eo(u)) * (i ? -14 : 12), face = 1 + Math.floor(R(Math.floor(t * 14), dd.seed) * 6), g = 0, yy = y;
    if (t >= dd.land) { face = 6; rot = 0; }
    if (i === 1 && t >= dd.land && t < T.settle) {   // 立在邊上搖
      const k = lin(t, dd.land, T.teeter), tilt = 0.75 * Math.sin(Math.PI * Math.min(1, k * 1.2));
      if (t < T.teeter) { rot = -tilt + Math.sin(t * 18) * 0.05 * k; face = 5; } else { const q = eo5(lin(t, T.teeter, T.settle)); rot = -0.75 * (1 - q) + 0.12 * Math.sin(q * Math.PI); face = q > 0.5 ? 6 : 5; }
      yy = 620 - Math.sin(Math.abs(rot)) * s * 0.2;
    }
    if (won) { g = 0.6 + 0.3 * Math.sin(t * 8); yy -= 40 * eo(lin(t, T.settle, T.settle + 0.4)); }
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, 620 + s * 0.52, s * 0.55 * (1 - bounce / 900), 26, 0, 0, 7); ctx.fill(); drawDie(ctx, x, yy, s, rot, face, g); ctx.restore();
  });
  if (t > T.land2 + 0.1 && t < T.settle) { ctx.save(); ctx.globalAlpha = Math.floor(t * 8) % 2 ? 1 : 0.55; ctx.translate(1220, 250); smallTitle(ctx, t, 'あと一歩…!?', 0, 0, 80, PAL.red, 'center'); ctx.restore(); }
  if (t > T.land1 && t < T.land1 + 0.4) sparkBurst(ctx, 700, 620, t - T.land1, 12, 1.2, '#fff6c0');
  if (won) {
    const l = t - T.settle;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960, 560, 16, 'rgba(255,255,255,0.18)', t * 0.5, 1800, 0.4, 16); ctx.restore();
    const zk = lin(l, 0, 0.18); if (zk > 0 && l < 1.0) { const sc = zk < 1 ? 3 - 2 * eo(zk) : 1 + Math.sin(t * 20) * 0.02; ctx.save(); ctx.globalAlpha = (1 - lin(l, 0.8, 1.0)) * (1 - out); ctx.translate(960, 300); ctx.rotate(-0.08); ctx.scale(sc, sc); smallTitle(ctx, t, 'ゾロ目!!', 0, 0, 200, PAL.red, 'center'); ctx.restore(); }
    coinFountain(ctx, t, T.settle, T.settle + 2.4, 140);
    const gk = lin(l, 0.7, 1.05); if (GIRL && gk > 0) { const k = eback(gk, 1.6); ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(960, 680); ctx.scale(k, k); neonOutline(ctx, GIRL_SIL, 0, 0, 840, t, 0); drawImg(ctx, GIRL, 0, 0, 840, 0); ctx.restore(); }
    if (l > 0.9) endBlock(ctx, t, l - 0.9, out, 960, 140, { size: 110, count: [1560, 300], name: [960, 1010], csize: 170 });
    flash(ctx, (1 - lin(t, T.settle, T.settle + 0.18)) * 0.75, '#fff');
  }
}

// ---------------- 超大 3：流星墜落 ----------------
const MT_T = { appear: 0.9, crash: 2.7, rise: 3.3 };
function starShape(ctx, x, y, r, rot, fill, stroke) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = r * 0.08; ctx.strokeStyle = stroke; ctx.stroke(); } ctx.restore(); }
function vMeteor(ctx, t) {
  const D = CFG.dur, T = MT_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), crashed = t >= T.crash;
  const pk = crashed ? Math.exp(-(t - T.crash) * 5) : t > T.appear ? lin(t, T.appear, T.crash) * 0.35 : 0;
  ctx.save(); ctx.globalAlpha = app * (1 - out); ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * pk * 30, (R(Math.floor(t * 60), 2) - 0.5) * pk * 30);
  if (!crashed) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a0828'); g.addColorStop(1, `rgb(${60 + 140 * lin(t, T.appear, T.crash) | 0},30,70)`); ctx.fillStyle = g; ctx.fillRect(-40, -40, W + 80, H + 80); }
  else { palBG(ctx, t, PAL.rainbow, 960, 760); ctx.fillStyle = 'rgba(20,0,40,0.2)'; ctx.fillRect(-40, -40, W + 80, H + 80); }
  for (let i = 0; i < 120; i++) { ctx.fillStyle = `rgba(255,255,240,${0.3 + 0.6 * R(i, 3) * (0.6 + 0.4 * Math.sin(t * 4 + i))})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * 700, 3, 3); }
  // 小流星
  for (let i = 0; i < 8; i++) { const st = 0.2 + i * 0.32, q = (t - st) / 0.5; if (q < 0 || q > 1 || st > T.crash) continue; const x = 300 + R(i, 4) * 1400 + 600 * q, y = 80 + R(i, 5) * 300 + 300 * q; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createLinearGradient(x - 240, y - 120, x, y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,250,220,${1 - q})`); ctx.strokeStyle = g; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 240, y - 120); ctx.lineTo(x, y); ctx.stroke(); ctx.restore(); }
  // 地平線山丘
  ctx.fillStyle = crashed ? '#3a1a5a' : '#140a26'; ctx.beginPath(); ctx.moveTo(-40, H + 40); ctx.lineTo(-40, 880); for (let x = 0; x <= W + 40; x += 80) ctx.lineTo(x, 860 + Math.sin(x * 0.006) * 40 + Math.sin(x * 0.017) * 20); ctx.lineTo(W + 40, H + 40); ctx.fill();
  ctx.restore();
  // 大流星：從右上角越來越大、拖著火尾
  if (t > T.appear && !crashed) {
    const u = lin(t, T.appear, T.crash), e = u * u, x = 1800 - 840 * e, y = -120 + 900 * e, r = 30 + 170 * e;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)';
    for (let k = 0; k < 5; k++) { const tl = r * (3 + k * 1.2); const g = ctx.createLinearGradient(x + tl * 0.7, y - tl * 0.9, x, y); g.addColorStop(0, 'rgba(255,120,40,0)'); g.addColorStop(1, ['rgba(255,240,180,0.9)', 'rgba(255,190,80,0.7)', 'rgba(255,120,60,0.55)', 'rgba(255,80,120,0.4)', 'rgba(200,120,255,0.3)'][k]); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - r * 0.8, y - r * 0.2 + k * 6); ctx.lineTo(x + tl * 0.7, y - tl * 0.9); ctx.lineTo(x + r * 0.2, y + r * 0.8); ctx.fill(); }
    ctx.restore();
    ctx.save(); ctx.globalAlpha = 1 - out; starShape(ctx, x, y, r, t * 6, '#ffd84a', '#7a3a00'); starShape(ctx, x - r * 0.12, y - r * 0.12, r * 0.45, t * 6, '#fff6c0'); ctx.restore();
    if (u > 0.55) { ctx.save(); ctx.globalAlpha = Math.floor(t * 10) % 2 ? 1 : 0.5; ctx.translate(560, 260); ctx.rotate(-0.06); smallTitle(ctx, t, 'WARNING!!', 0, 0, 110, PAL.red, 'center'); ctx.restore(); }
  }
  if (crashed) {
    const l = t - T.crash;
    for (let i = 0; i < 3; i++) { const q = (l - i * 0.1) / 0.8; if (q < 0 || q > 1) continue; ctx.save(); ctx.globalAlpha = (1 - q) * (1 - out); ctx.strokeStyle = '#fff6d0'; ctx.lineWidth = 30 * (1 - q) + 4; ctx.beginPath(); ctx.ellipse(960, 820, 100 + 1300 * eo(q), 40 + 380 * eo(q), 0, 0, 7); ctx.stroke(); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(26px)'; const gp = ctx.createLinearGradient(0, 820, 0, -100); gp.addColorStop(0, `rgba(255,250,220,${Math.min(1, l * 4)})`); gp.addColorStop(1, 'rgba(255,200,255,0)'); ctx.fillStyle = gp; ctx.fillRect(960 - 220 - l * 40, -100, 440 + l * 80, 920); ctx.restore();
    // 落下的小星星雨
    for (let i = 0; i < 40; i++) { const st = R(i, 6) * 3, q = ((l - st) % 1.6) / 1.6; if (l < st) continue; starShape(ctx, R(i, 7) * W, -60 + q * 1200, 14 + R(i, 8) * 16, q * 6 + i, `hsl(${(i * 37) % 360},90%,75%)`, '#3a1a5a'); }
    const gk = lin(l, T.rise - T.crash, T.rise - T.crash + 0.5); if (GIRL && gk > 0) { const k = eo(gk); ctx.save(); ctx.globalAlpha = 1 - out; starShape(ctx, 960, 560, 470 * eback(gk, 1.5), t * 0.3, 'rgba(255,240,170,0.9)', '#c87a00'); const gy = 1100 - 500 * k; ctx.beginPath(); ctx.rect(0, 0, W, 900); ctx.clip(); neonOutline(ctx, GIRL_SIL, 960, gy, 860, t, 0); drawImg(ctx, GIRL, 960, gy, 860, 0); ctx.restore(); }
    if (l > 1.1) endBlock(ctx, t, l - 1.1, out, 420, 330, { size: 108, count: [1520, 380], name: [420, 470], csize: 180 });
    flash(ctx, (1 - lin(t, T.crash, T.crash + 0.25)) * 0.85, '#fff');
  }
}

// ---------------- 超大 4：演唱會轉播 ----------------
const CO_T = { cut1: 1.6, cut2: 2.6, cut3: 3.5 };
function concertStage(ctx, t, l, showCount, gx = 960) {   // 全景舞台
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#120828'); g.addColorStop(1, '#3a0a4a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 雷射
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 8; i++) { const a = Math.PI / 2 + Math.sin(t * 2 + i) * 0.7, x = 200 + i * 220; ctx.strokeStyle = `hsla(${(i * 45 + t * 60) % 360},100%,65%,0.5)`; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x + Math.cos(a) * 1400, 80 + Math.sin(a) * 1400); ctx.stroke(); } ctx.restore();
  // LED 大螢幕
  ctx.fillStyle = '#05030c'; ctx.fillRect(560, 110, 800, 450); ctx.save(); ctx.beginPath(); ctx.rect(576, 126, 768, 418); ctx.clip();
  if (showCount) { palBG(ctx, t, PAL.rainbow, 960, 335); smallTitle(ctx, t, '×' + CFG.n, 960, 340, 220, PAL.gold, 'center'); }
  else if (GIRL) { ctx.fillStyle = '#ffd6f0'; ctx.fillRect(576, 126, 768, 418); const gh = 900, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, 960 - FACE.x * gw, 335 - FACE.y * gh + 60, gw, gh); }
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 126; y < 544; y += 6) ctx.fillRect(576, y, 768, 2); ctx.restore();
  ctx.strokeStyle = '#6a5a8a'; ctx.lineWidth = 6; ctx.strokeRect(560, 110, 800, 450);
  // 舞台
  ctx.fillStyle = '#2a1640'; ctx.fillRect(0, 760, W, 320); ctx.fillStyle = '#ff5ab0'; ctx.fillRect(0, 760, W, 8);
  // 火柱
  if (l > 0) for (const x of [260, 660, 1260, 1660]) { const k = Math.max(0, Math.sin(Math.PI * lin(l, 0.05, 0.9))); if (k <= 0) continue; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(8px)'; for (const [c, w] of [['rgba(255,80,30,0.8)', 70], ['rgba(255,200,60,0.9)', 40], ['rgba(255,255,220,0.9)', 18]]) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - w, 760); ctx.quadraticCurveTo(x - w * 0.4, 760 - 500 * k, x, 760 - 620 * k); ctx.quadraticCurveTo(x + w * 0.4, 760 - 500 * k, x + w, 760); ctx.fill(); } ctx.restore(); }
  // 角色
  if (GIRL) { neonOutline(ctx, GIRL_SIL, gx, 560, 560, t, 0); drawImg(ctx, GIRL, gx, 560, 560, 0); }
  crowd(ctx, t, 1);
}
function crowd(ctx, t, sc) {   // 觀眾剪影＋螢光棒
  for (let i = 0; i < 34; i++) { const x = (i + 0.5) * W / 34 + (R(i, 1) - 0.5) * 30, y = 1000 + R(i, 2) * 60, hr = 38 * sc + R(i, 3) * 8, wave = Math.sin(t * 7 + i * 0.6) * 0.5;
    const hue = [330, 200, 50, 280][Math.floor(t * 1.5 + i) % 4];
    ctx.save(); ctx.translate(x + 40, y - 70); ctx.rotate(wave); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(4px)'; ctx.fillStyle = `hsl(${hue},100%,65%)`; ctx.fillRect(-7, -110, 14, 110); ctx.restore();
    ctx.fillStyle = '#0a0414'; ctx.beginPath(); ctx.arc(x, y - hr, hr, 0, 7); ctx.fill(); ctx.fillRect(x - hr * 1.3, y - 10, hr * 2.6, 200); }
}
function broadcastUI(ctx, t, label) {
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 5; const m = 50, L = 70;
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); }
  ctx.fillStyle = Math.floor(t * 2) % 2 ? '#ff2a3a' : '#a0101a'; ctx.beginPath(); ctx.arc(110, 110, 16, 0, 7); ctx.fill();
  hudText(ctx, 'LIVE', 140, 112, 36, '#ffffff'); hudText(ctx, label, W - 110, 112, 28, '#ffffff', 'right');
  const s = Math.floor(t * 30); hudText(ctx, `00:0${Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, '0')}:${String(s % 30).padStart(2, '0')}`, W - 110, H - 100, 26, '#ffffff', 'right');
  ctx.restore();
}
function vConcert(ctx, t) {
  const D = CFG.dur, T = CO_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3));
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  if (t < T.cut1) { concertStage(ctx, t, -1, false); broadcastUI(ctx, t, 'CAM 1  WIDE'); }
  else if (t < T.cut2) {   // 臉部特寫
    const l = t - T.cut1, z = 1 + 0.08 * l; ctx.fillStyle = '#ffd6f0'; ctx.fillRect(0, 0, W, H); palBG(ctx, t, PAL.rainbow, 960, 540); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, 0, W, H);
    if (GIRL) { const gh = 2600 * z, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, 1080 - FACE.x * gw, 520 - FACE.y * gh, gw, gh); }
    broadcastUI(ctx, t, 'CAM 3  CLOSE-UP');
    const k = eo5(lin(l, 0.15, 0.4)); ctx.save(); ctx.translate(-900 * (1 - k), 0); ctx.fillStyle = 'rgba(200,16,60,0.92)'; ctx.fillRect(0, 800, 900, 110); ctx.fillStyle = '#fff'; ctx.fillRect(0, 800, 900, 6); inkText(ctx, 'SPECIAL THANKS', 440, 830, 34, '#ffe08a', '#5a0018'); inkText(ctx, P.name, 440, 878, 44, '#ffffff', '#5a0018'); ctx.restore();
  } else if (t < T.cut3) {   // 觀眾席
    const l = t - T.cut2, g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a0a4a'); g.addColorStop(1, '#0a0418'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(960, 540); ctx.scale(1.9, 1.9); ctx.translate(-960, -760); crowd(ctx, t * 1.4, 1); ctx.restore();
    broadcastUI(ctx, t, 'CAM 5  AUDIENCE'); const k = lin(l, 0.05, 0.25); ctx.save(); ctx.globalAlpha = k; ctx.translate(960, 260); ctx.scale(1.4 - 0.4 * k, 1.4 - 0.4 * k); smallTitle(ctx, t, 'アンコール!!', 0, 0, 140, PAL.red, 'center'); ctx.restore();
  } else {   // 全景＋大螢幕顯示份數、火柱、彩帶
    const l = t - T.cut3; concertStage(ctx, t, l, true, 1460); confetti(ctx, t, T.cut3, 90, ['#ffd24a', '#ff5a8a', '#5fc8ff', '#ffffff'], 61); broadcastUI(ctx, t, 'CAM 1  WIDE');
    fireworksAt(ctx, t, [[T.cut3 + 0.1, 300, 220, 30], [T.cut3 + 0.3, 1620, 200, 200], [T.cut3 + 0.6, 260, 420, 300], [T.cut3 + 0.8, 1660, 420, 120]]);
    const tk = lin(l, 0.2, 0.4); if (tk > 0) { const s = tk < 1 ? 1.8 - 0.8 * eback(tk, 1.6) : 1; ctx.save(); ctx.translate(960, 660); ctx.rotate(-0.03); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 104, PAL.gold, 'center'); ctx.restore(); }
    nameAt(ctx, 960, 770, eo(lin(l, 0.4, 0.6)), 40, '#1a0838');
  }
  // 切鏡頭時白閃
  for (const ct of [T.cut1, T.cut2, T.cut3]) if (t >= ct && t < ct + 0.08) flash(ctx, (1 - (t - ct) / 0.08) * 0.6, '#fff');
  ctx.restore();
}
VARS.g50[2] = { name: '擲骰ゾロ目', fn: vDice, dur: 7.0 };
VARS.g50[3] = { name: '流星墜落', fn: vMeteor, dur: 7.0 };
VARS.g50[4] = { name: '演唱會轉播', fn: vConcert, dur: 7.0 };

// ---------------- 超大 1：保留變化＋機關合體 ----------------
let CREST = null;
const _lvaBase7 = window.loadVarAssets;
window.loadVarAssets = async function () { await _lvaBase7(); const im = await load(window.DEF_CREST || '../assets/crest.png'); CREST = im ? trimmed(im) : null; };
const GM_T = { hold: 0.3, chg: [0.75, 1.25, 1.75, 2.25, 2.85], fly: 3.3, gattai: 3.85, girl: 4.15 };
const HOLD_COL = [['#ffffff', '#c8c8d8'], ['#5fb0ff', '#1a5ad0'], ['#6aee6a', '#119a3a'], ['#ff4a5a', '#b0102a'], ['#ffd84a', '#c87a00']];
function holdIcon(ctx, x, y, r, lv, t) {   // 保留圖示：白→藍→綠→紅→金→虹
  ctx.save(); ctx.translate(x, y);
  if (lv >= 5) { const g = ctx.createLinearGradient(-r, -r, r, r); for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(i * 60 + t * 300) % 360},100%,60%)`); ctx.fillStyle = g; }
  else { const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r); g.addColorStop(0, HOLD_COL[lv][0]); g.addColorStop(1, HOLD_COL[lv][1]); ctx.fillStyle = g; }
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.lineWidth = r * 0.12; ctx.strokeStyle = '#2b1a3a'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.36, r * 0.3, r * 0.18, -0.6, 0, 7); ctx.fill();
  ctx.restore();
}
function vGimmick(ctx, t) {
  if (!CREST) return;
  const D = CFG.dur, T = GM_T, out = ei(lin(t, D - 0.5, D - 0.05)), app = eo(lin(t, 0, 0.3)), done = t >= T.gattai;
  let lv = 0; T.chg.forEach((c) => { if (t >= c) lv++; });
  ctx.save(); ctx.globalAlpha = app * (1 - out);
  if (!done) { const g = ctx.createRadialGradient(960, 520, 0, 960, 520, 1200); g.addColorStop(0, ['#2a2a4a', '#123a7a', '#0e5a2e', '#7a0a1e', '#7a4a00', '#5a1a7a'][lv]); g.addColorStop(1, '#05030c'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (lv >= 3) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5; speedLines(ctx, 960, 900, 50, 300, lv >= 5 ? `hsla(${(t * 300) % 360},100%,70%,0.4)` : 'rgba(255,255,255,0.25)', Math.floor(t * 20), 0, 1); ctx.restore(); } }
  else { palBG(ctx, t, PAL.rainbow, 960, 470); }
  ctx.restore();
  // 保留圖示（下方 4 顆，最後一顆會變色）
  if (t < T.fly + 0.3) {
    const ha = (1 - lin(t, T.fly, T.fly + 0.3)) * app * (1 - out);
    ctx.save(); ctx.globalAlpha = ha; ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.roundRect(560, 860, 800, 130, 65); ctx.fill(); ctx.restore();
    for (let i = 0; i < 4; i++) { const x = 650 + i * 200, isLast = i === 3; let r = 46, l2 = 0;
      if (isLast) { const lc = T.chg[Math.max(0, lv - 1)], q = t - lc; l2 = lv; if (lv > 0 && q < 0.25) r *= 1 + 0.6 * Math.sin(q / 0.25 * Math.PI); r *= 1 + 0.12 * lv; if (lv >= 5) r *= 1 + 0.06 * Math.sin(t * 14); }
      ctx.save(); ctx.globalAlpha = ha; holdIcon(ctx, x, 925, r, l2, t); ctx.restore();
      if (isLast && lv > 0) { const q = t - T.chg[lv - 1]; if (q < 0.4) { ctx.save(); ctx.globalAlpha = ha; sparkBurst(ctx, x, 925, q, 12, 1 + lv * 0.3, lv >= 5 ? '#fff' : HOLD_COL[Math.min(4, lv)][0]); ctx.restore(); } } }
    // 變色時的文字
    const labels = ['', 'チャンス', 'チャンス!', '激アツ!!', '超激アツ!!', '虹保留!!!'];
    if (lv > 0 && t < T.fly) { const q = t - T.chg[lv - 1], k = lin(q, 0, 0.12); ctx.save(); ctx.globalAlpha = ha; ctx.translate(960, 420); const s = (k < 1 ? 2 - eo(k) : 1) * (0.8 + lv * 0.12); ctx.scale(s, s); smallTitle(ctx, t, labels[lv], 0, 0, 120, lv >= 3 ? PAL.red : lv === 2 ? PAL.green : PAL.sky, 'center'); ctx.restore(); }
    for (const c of T.chg) if (t >= c && t < c + 0.1) flash(ctx, (1 - (t - c) / 0.1) * 0.25, '#fff');
  }
  // 機關：四塊從四個方向撞進來合體
  if (t >= T.fly) {
    const cw = 1240, ch = cw * CREST.height / CREST.width, cx = 960, cy = 470, k = Math.min(1, lin(t, T.fly, T.gattai)), e = k * k;
    const pieces = [[0, 0, 0.34, 1, -760, 0], [0.66, 0, 0.34, 1, 760, 0], [0.34, 0, 0.32, 0.5, 0, -640], [0.34, 0.5, 0.32, 0.5, 0, 640]];
    const pk = done ? Math.exp(-(t - T.gattai) * 8) : 0;
    ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate((R(Math.floor(t * 60), 1) - 0.5) * pk * 30, (R(Math.floor(t * 60), 2) - 0.5) * pk * 30);
    if (done) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, cx, cy, 16, 'rgba(255,255,255,0.22)', t * 0.6, 1800, 0.4, 16); ctx.filter = 'blur(40px)'; ctx.fillStyle = `hsla(${(t * 200) % 360},100%,70%,0.5)`; ctx.beginPath(); ctx.ellipse(cx, cy, cw * 0.45, ch * 0.5, 0, 0, 7); ctx.fill(); ctx.restore(); }
    for (const [sx, sy, sw, sh, dx, dy] of pieces) {
      const ox = dx * (1 - e), oy = dy * (1 - e), x0 = cx - cw / 2 + sx * cw, y0 = cy - ch / 2 + sy * ch;
      ctx.drawImage(CREST, sx * CREST.width, sy * CREST.height, sw * CREST.width, sh * CREST.height, x0 + ox, y0 + oy, sw * cw + 1, sh * ch + 1);
    }
    ctx.restore();
    if (!done) { ctx.save(); ctx.globalAlpha = lin(t, T.fly + 0.2, T.fly + 0.4); ctx.translate(1600, 960); smallTitle(ctx, t, '合体!!', 0, 0, 120, PAL.gold, 'center'); ctx.restore(); }
  }
  if (done) {
    const l = t - T.gattai;
    for (let i = 0; i < 3; i++) { const q = (l - i * 0.08) / 0.7; if (q < 0 || q > 1) continue; ctx.save(); ctx.globalAlpha = (1 - q) * (1 - out); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 26 * (1 - q) + 3; ctx.beginPath(); ctx.arc(960, 470, 200 + 1200 * eo(q), 0, 7); ctx.stroke(); ctx.restore(); }
    coinFountain(ctx, t, T.gattai, T.gattai + 2.4, 140);
    const gk = lin(t, T.girl, T.girl + 0.35); if (GIRL && gk > 0) { const k = eback(gk, 1.6); ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(960, 640); ctx.scale(k, k); neonOutline(ctx, GIRL_SIL, 0, 0, 820, t, 0); drawImg(ctx, GIRL, 0, 0, 820, 0); ctx.restore(); }
    if (l > 0.5) endBlock(ctx, t, l - 0.5, out, 400, 820, { size: 104, count: [1540, 820], name: [400, 940], csize: 180 });
    flash(ctx, (1 - lin(t, T.gattai, T.gattai + 0.2)) * 0.8, '#fff');
  }
}
VARS.g50[1] = { name: '保留變化＋機關合體', fn: vGimmick, dur: 7.0 };

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

// ======================= V2 共用核心：結尾版面／退場／鏡頭／版面偵錯 =======================
// 規則（2026-11-11 重製）：
//   1. 主角（道具或角色）至少佔畫面高度六成；角色結尾一律半身大圖，不放小小一隻全身。
//   2. 大標題一律用 heroTitle（跟原始版同一套立體字），名字與份數用 plateV2（深色底帶）。
//   3. 疊層順序固定：背景 → 遠景道具 → 角色 → 近景道具 → 標題 → 名牌 → 粒子 → 外框 → 閃光。
//   4. 退場一律把整個畫面畫進緩衝再做轉場（exitV2），不可以各元素自己淡出。
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const sstep = (x) => x * x * (3 - 2 * x);
const slamK = (k, big = 2.6, s = 1.5) => (k < 1 ? big - (big - 1) * eback(k, s) : 1);   // 由大砸到 1
const popK = (k, s = 2) => (k <= 0 ? 0 : k < 1 ? eback(k, s) : 1);                      // 由 0 彈到 1
const hitStop = (t, hits, d = 0.07) => { for (const h of hits) if (t >= h && t < h + d) return h; return t; };
const mixv = (a, b, k) => a + (b - a) * k;

// ---------- 版面偵錯：畫的時候順手登記「臉」和「字」的外框，檢查工具用來抓字壓臉、字出框 ----------
const DBG = { on: false, boxes: [] };
function dbgBox(ctx, kind, name, x0, y0, x1, y1) {
  if (!DBG.on || ctx.globalAlpha < 0.5) return;
  const m = ctx.getTransform(); let X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const px = m.a * x + m.c * y + m.e, py = m.b * x + m.d * y + m.f;
    X0 = Math.min(X0, px); X1 = Math.max(X1, px); Y0 = Math.min(Y0, py); Y1 = Math.max(Y1, py);
  }
  DBG.boxes.push({ kind, name, x0: X0, y0: Y0, x1: X1, y1: Y1 });
}
function dbgBoxC(ctx, kind, name, cx, cy, w, h, rot = 0) {   // 以中心點、寬高、旋轉登記
  if (!DBG.on) return; ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); dbgBox(ctx, kind, name, -w / 2, -h / 2, w / 2, h / 2); ctx.restore();
}
window.__dbgFrame = function (t) { DBG.on = true; DBG.boxes = []; try { draw(t); } finally { DBG.on = false; } return DBG.boxes; };

// ---------- 角色 ----------
const _silCache = new Map();
function silC(img, col) { let m = _silCache.get(img); if (!m) { m = {}; _silCache.set(img, m); } return m[col] || (m[col] = silhouette(img, col)); }
function outlineV2(ctx, img, cx, cy, h, rot, col, w = 12, n = 16) {
  const s = silC(img, col); for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; drawImg(ctx, s, cx + Math.cos(a) * w, cy + Math.sin(a) * w, h, rot); }
}
function girlV2(ctx, gx, gy, gh, t, o = {}) {   // o: rot, alpha, outline(false 關閉), neon(強制彩虹描邊)
  if (!GIRL) return; const rot = o.rot ?? 0.02, pal = PAL[CFG.pal] || PAL.gold;
  if (o.outline !== false) {
    if (o.neon ?? pal.rainbow) neonOutline(ctx, GIRL_SIL, gx, gy, gh, t, rot);
    else { outlineV2(ctx, GIRL_SIL, gx, gy, gh, rot, o.col || pal.edge[1], Math.max(8, gh * 0.008)); outlineV2(ctx, GIRL_SIL, gx, gy, gh, rot, '#fff', Math.max(4, gh * 0.0035), 10); }
  }
  drawImg(ctx, GIRL, gx, gy, gh, rot, o.alpha ?? 1);
  if (DBG.on) { const w = GIRL.width * gh / GIRL.height, fx = gx - w / 2 + FACE.x * w, fy = gy - gh / 2 + FACE.y * gh, r = FACE.s * gh * 0.5; dbgBox(ctx, 'face', 'girl', fx - r, fy - r * 0.85, fx + r, fy + r * 1.05); }
}
function facePos(gx, gy, gh) { const w = GIRL ? GIRL.width * gh / GIRL.height : gh * 0.66; return [gx - w / 2 + FACE.x * w, gy - gh / 2 + FACE.y * gh]; }
function mascotV2(ctx, t, k, x, y, h, flip = false) {
  const img = flip ? mascotFlip() : MASCOT; if (!img || k <= 0) return;
  const s = popK(k, 2.6), bob = Math.abs(Math.sin(t * 9 + (flip ? 1 : 0))) * -22, mr = (flip ? 0.1 : -0.1) + Math.sin(t * 9) * 0.07, pal = PAL[CFG.pal] || PAL.gold;
  if (pal.rainbow) neonOutline(ctx, img, x, y + bob, h * s, t + 0.3, mr); else { outlineV2(ctx, img, x, y + bob, h * s, mr, pal.edge[1], 9); outlineV2(ctx, img, x, y + bob, h * s, mr, '#fff', 4, 10); }
  drawImg(ctx, img, x, y + bob, h * s, mr);
}

// ---------- 文字 ----------
const EXT = { sky: ['#0a2a6a', '#103a8a'], blue: ['#061a5a', '#0a2a8a'], green: ['#063a1a', '#0a5a2a'], red: ['#4a0010', '#7a0020'], gold: ['#5a3000', '#7a4200'], rainbow: ['#2a0a50', '#4a1080'], premium: ['#2a0a50', '#4a1080'] };
const _tw = {};
function titleW(txt) { if (_tw[txt]) return _tw[txt]; g.save(); g.font = titleFont(txt); const w = g.measureText(txt).width; g.restore(); return (_tw[txt] = w); }
function heroTitle(ctx, t, x, y, k, o = {}) {   // 大標題：k 進場進度；o.maxW 自動縮到放得下
  if (k <= 0) return; const w0 = titleW(CFG.title) + 70, fit = Math.min(o.s ?? 1.05, (o.maxW ?? 1100) / w0), rot = o.rot ?? -0.05;
  const s = fit * slamK(k, o.big ?? 2.6) * (1 + (o.pk ?? 0) * 0.06);
  _titleNoFit = true; try { title3D(ctx, t, x, y, s, rot, o.depth ?? 16, o.ext || EXT[CFG.pal] || EXT.gold); } finally { _titleNoFit = false; }
  if (k >= 1) dbgBoxC(ctx, 'text', 'title', x, y, w0 * fit, 215 * fit, rot);
}
function plateV2(ctx, t, a, x, y, sc = 1.1) {   // 名字＋份數的深色底帶
  if (a <= 0 || sc <= 0) return; subLine(ctx, t, a, x, y - (1 - a) * 30, sc);
  if (a >= 1) dbgBoxC(ctx, 'text', 'plate', x - 10 * sc, y, 950 * sc, 190 * sc, -0.06);
}
function wordV2(ctx, txt, x, y, k, o = {}) {   // 演出中的大字（チャンス、LOCK ON 之類）：白邊＋深色外框；o.font 可換字型（Dela 缺字時用）
  if (k <= 0) return; const s = (o.s ?? 1) * (o.pop === false ? 1 : slamK(k, o.big ?? 2.2, 1.6)) * (1 + (o.beat ?? 0));
  ctx.save(); ctx.globalAlpha *= o.a ?? 1; ctx.translate(x, y); ctx.rotate(o.rot ?? -0.05); ctx.scale(s, s);
  ctx.font = o.font || (curLang() === 'zh-TW' && DELA_MISSING.test(txt) ? "900 150px 'Noto Sans TC'" : "150px 'Dela Gothic One', 'Noto Sans TC'"); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (o.maxW) { const fit = Math.min(1, o.maxW / ((ctx.measureText(txt).width + 50) * (o.s ?? 1))); ctx.scale(fit, fit); }   /* 翻譯後變長就縮到放得下 */
  for (let i = o.depth ?? 8; i >= 1; i--) { ctx.strokeStyle = o.stroke || '#1a0838'; ctx.lineWidth = 40; ctx.strokeText(txt, i * 1.3, i * 2); }
  ctx.strokeStyle = o.stroke || '#1a0838'; ctx.lineWidth = 40; ctx.strokeText(txt, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 12; ctx.strokeText(txt, 0, 0);
  ctx.fillStyle = o.fill || '#ffe14a'; ctx.fillText(txt, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-2000, -95, 4000, 80); ctx.clip(); ctx.globalAlpha *= 0.3; ctx.fillStyle = '#fff'; ctx.fillText(txt, 0, 0); ctx.restore();
  if (k >= 1 && o.box !== false) { const w = ctx.measureText(txt).width + 50; dbgBox(ctx, 'text', 'word:' + txt, -w / 2, -95, w / 2, 95); }
  ctx.restore();
}
function medalV2(ctx, t, x, y, k, pk = 0, sc = 1) {   // 金色星芒徽章「×N」
  if (k <= 0) return; const s = sc * (k < 1 ? 3 - 2 * eback(k, 1.6) : 1 + pk * 0.08);
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.14 + Math.sin(t * 3) * 0.04); ctx.scale(s, s);
  ctx.save(); ctx.rotate(t * 1.2); ctx.beginPath();
  for (let i = 0; i < 48; i++) { const r = i % 2 ? 132 : 164, a = i / 48 * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); const gg = ctx.createRadialGradient(0, 0, 20, 0, 0, 164); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.7, '#ffb21a'); gg.addColorStop(1, '#c76a00');
  ctx.fillStyle = gg; ctx.shadowColor = 'rgba(255,220,100,0.9)'; ctx.shadowBlur = 36; ctx.fill(); ctx.shadowBlur = 0; ctx.lineWidth = 5; ctx.strokeStyle = '#7a4200'; ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#c4002a'; ctx.beginPath(); ctx.arc(0, 0, 116, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff2a0'; ctx.lineWidth = 8; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 100, 0, 7); ctx.stroke();
  const ns = CFG.medalText || ('×' + CFG.n), fs = ns.length <= 3 ? 104 : Math.round(104 * 3.2 / ns.length);
  ctx.font = `${fs}px 'Dela Gothic One'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#3a0010'; ctx.lineWidth = 16; ctx.strokeText(ns, 0, 6);
  const fg = ctx.createLinearGradient(0, -50, 0, 56); fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.45, '#fff2a0'); fg.addColorStop(1, '#ffb21a'); ctx.fillStyle = fg; ctx.fillText(ns, 0, 6);
  ctx.restore();
  if (k >= 1) dbgBoxC(ctx, 'text', 'medal', x, y, 250 * sc, 250 * sc);
}

// ---------- 鏡頭／特效 ----------
function camV2(ctx, cx, cy, z, rot = 0) { ctx.translate(cx, cy); ctx.scale(z, z); if (rot) ctx.rotate(rot); ctx.translate(-cx, -cy); }
function ringBurst(ctx, x, y, l, o = {}) {   // 衝擊波圓環
  const d = o.dur ?? 0.4; if (l < 0 || l > d) return; const p = l / d;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = o.col || `rgba(255,255,230,${(1 - p) * (o.a ?? 0.9)})`; ctx.globalAlpha = 1 - p; ctx.lineWidth = (o.w ?? 40) * (1 - p) + 2;
  ctx.beginPath(); ctx.ellipse(x, y, (o.r0 ?? 120) + eo(p) * (o.r1 ?? 1300), ((o.r0 ?? 120) + eo(p) * (o.r1 ?? 1300)) * (o.sq ?? 0.62), o.rot ?? -0.08, 0, 7); ctx.stroke(); ctx.restore();
}
function dimBG(ctx, a, glow) {   // 中量用：不整個蓋掉直播畫面，只壓暗＋一團色光
  ctx.save(); ctx.fillStyle = `rgba(6,5,18,${0.62 * a})`; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (glow) { const [x, y, r, col] = glow; const gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = a; ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160); }
  ctx.restore();
}
function sparkleField(ctx, t, n, x0, y0, x1, y1, a = 1, cols = ['#fff', '#fff2a8']) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) { const ph = (t * (0.7 + R(i, 1)) + R(i, 2)) % 1, s = Math.sin(ph * Math.PI); star4(ctx, x0 + R(i, 3) * (x1 - x0), y0 + R(i, 4) * (y1 - y0), 8 + s * (12 + R(i, 5) * 26), cols[i % cols.length], s * 0.9 * a); }
  ctx.restore();
}

function shardsV2(ctx, x, y, l, n = 28, cols = ['#fff6c0', '#ffd24a', '#ffffff']) {   // 暗底用的金色星屑（亮底用原本的 coins）
  if (l < 0 || l > 0.9) return; const p = l / 0.9;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) { const a = R(i, 41) * Math.PI * 2, v = 500 + R(i, 42) * 900;
    star4(ctx, x + Math.cos(a) * v * l * (1 - p * 0.35), y + Math.sin(a) * v * l * 0.75 * (1 - p * 0.35) + 700 * l * l, (10 + R(i, 43) * 24) * (1 - p), cols[i % cols.length], 1 - p); }
  ctx.restore();
}
function rainbowBG2(ctx, t, cx = 560, cy = 470) {   // 彩虹放射背景（可指定光心、帶出血）
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1700);
  bg.addColorStop(0, '#fffbe0'); bg.addColorStop(0.12, '#ffe14a'); bg.addColorStop(0.35, '#ff5aa5'); bg.addColorStop(0.62, '#7a3cff'); bg.addColorStop(1, '#10073a');
  ctx.fillStyle = bg; ctx.fillRect(-80, -80, W + 160, H + 160);
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.filter = 'blur(18px)'; const n = 36, rot = t * 0.35;
  for (let i = 0; i < n; i++) { ctx.fillStyle = `hsla(${(i * 360 / n + t * 120) % 360},100%,62%,${i % 2 ? 0.75 : 0.3})`; const a0 = rot + i / n * Math.PI * 2, a1 = a0 + Math.PI / n;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * 3200, cy + Math.sin(a0) * 3200); ctx.lineTo(cx + Math.cos(a1) * 3200, cy + Math.sin(a1) * 3200); ctx.fill(); }
  ctx.restore();
  speedLines(ctx, cx, cy, 90, 520, 'rgba(255,255,255,0.55)', Math.floor(t * 30), 0, 0.7);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) { const ph = (t * (1.2 + R(i, 1)) + R(i, 2)) % 1, s = Math.sin(ph * Math.PI); star4(ctx, R(i, 3) * W, R(i, 4) * H, 10 + s * (16 + R(i, 5) * 34), i % 3 ? '#fff' : '#fff2a8', s * 0.9); }
  ctx.restore();
}
// ---------- 退場：整個畫面一起收 ----------
function exitV2(ctx, k, f, render, kind = 'smear') {
  if (kind === 'smear') return exitSmear(ctx, k, f, render);
  bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.globalCompositeOperation = 'source-over'; bctx.filter = 'none'; bctx.clearRect(0, 0, W, H); render(bctx);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'; ctx.clearRect(0, 0, W, H);
  if (kind === 'slice') {   // 斜切成條，上下交錯滑出
    const n = 10, sw = (W + 400) / n;
    for (let i = 0; i < n; i++) { const kk = ei(clamp(k * 1.5 - i * 0.045)), dir = i % 2 ? 1 : -1, x0 = -200 + i * sw;
      ctx.save(); ctx.beginPath(); ctx.moveTo(x0 + 160, 0); ctx.lineTo(x0 + sw + 160.5, 0); ctx.lineTo(x0 + sw - 159.5, H); ctx.lineTo(x0 - 160, H); ctx.closePath(); ctx.clip();
      ctx.drawImage(buf, dir * kk * -320, dir * kk * 1250); ctx.restore(); }
  } else if (kind === 'crt') {   // 映像管關機：壓成一條亮線再縮成一點
    const a = eio(lin(k, 0, 0.5)), b = eio(lin(k, 0.45, 0.95)), sy = Math.max(0.006, 1 - a), sx = Math.max(0.004, 1 - b);
    ctx.translate(CX, CY); ctx.scale(sx, sy); ctx.drawImage(buf, -CX, -CY);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55 * a * (1 - lin(k, 0.9, 1)); ctx.fillStyle = '#fff'; ctx.fillRect(-CX, -CY, W, H);
  } else if (kind === 'iris') {   // 圓形光圈收到臉上
    const [ix, iy] = exitV2.center || [CX, CY], r = Math.max(0.5, (1 - eio(k)) * 2300);
    ctx.beginPath(); ctx.arc(ix, iy, r, 0, 7); ctx.clip(); ctx.drawImage(buf, 0, 0);
    ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(ix, iy, Math.max(0.5, r - 7), 0, 7); ctx.stroke();
  } else {   // 'whip'：整個畫面往一側甩出去，帶殘影
    const e = ei(k), dx = (kind === 'whipL' ? -1 : 1) * e * (W + 500);
    for (let i = 5; i >= 0; i--) { ctx.globalAlpha = i ? 0.16 : 1; ctx.drawImage(buf, dx - (kind === 'whipL' ? -1 : 1) * i * 70 * Math.min(1, k * 4), 0); }
  }
  ctx.restore();
}
// 一支演出的骨架：前戲 pre(c, t) → 結尾 fin(c, m, t) → 退場
function runV2(ctx, t, o) {
  const D = CFG.dur, EX = D - (o.exit ?? 0.55);
  const scene = (c, tt) => {
    if (tt < o.T) o.pre(c, tt);
    else { o.fin(c, tt - o.T, tt); if (o.cut !== false) flash(c, (1 - lin(tt, o.T, o.T + 0.16)) * (o.cutA ?? 0.8), o.cutCol || '#fff'); }
  };
  if (t >= EX) exitV2(ctx, lin(t, EX, D - 0.02), Math.floor(t * 60), (c) => scene(c, t), o.exitKind);
  else scene(ctx, t);
}

// ---------- 結尾共用版面 ----------
const LAYS = {
  R: { girl: { x: 1400, h: 1650, from: 'right', rot: 0.02 }, title: { x: 650, y: 330, maxW: 1080, rot: -0.05 }, plate: { x: 660, y: 650, sc: 1.1 }, medal: { x: 250, y: 900, sc: 0.85 }, mascot: { x: 770, y: 935, h: 290 } },
  L: { girl: { x: 500, h: 1650, from: 'left', rot: -0.02 }, title: { x: 1270, y: 310, maxW: 1150, rot: -0.06 }, plate: { x: 1290, y: 640, sc: 1.1 }, medal: { x: 1000, y: 905, sc: 0.85 }, mascot: { x: 1690, y: 935, h: 300, flip: true } },
  C: { girl: { x: 960, h: 1650, from: 'below', rot: 0 }, title: { x: 960, y: 745, maxW: 1500, rot: -0.03 }, plate: { x: 960, y: 965, sc: 0.85 }, medal: { x: 330, y: 270, sc: 1 }, mascot: { x: 1640, y: 890, h: 320, flip: true } },
};
function finaleHero(ctx, m, t, o = {}) {   // 原本的結尾構圖（大標題＋名牌＋徽章）；其他構圖在 v2_fin.js
  const L = LAYS[o.lay || 'R'], hi = CFG.id === 'g25' || CFG.id === 'g50' || CFG.id === 'g100' || !!CFG.hi;
  const G = Object.assign({}, L.girl, o.girl), TT = Object.assign({}, L.title, o.title), PL = Object.assign({}, L.plate, o.plate);
  const MD = o.medal === false || (!hi && !o.medal) ? null : Object.assign({}, L.medal, o.medal);
  const MS = o.mascot === false || (!hi && !o.mascot) ? null : Object.assign({}, L.mascot, o.mascot);
  const T0 = o.tTitle ?? 0.32, pw = CFG.power ?? 1, pal = PAL[CFG.pal] || PAL.gold;
  const tick = o.ticker ?? (CFG.id === 'g50' || CFG.id === 'g100' || !!CFG.tick);   // 有上下跑馬燈時，下方的徽章和吉祥物往上讓
  // 角色高度：頭頂要留在上方外框（燈框、跑馬燈）下面，不要頂到畫面上緣
  if (G.y === undefined && G.h) G.y = (tick ? 150 : (o.led ?? hi) ? 100 : 66) + G.h / 2;
  if (tick && MD && !(o.medal && o.medal.y !== undefined) && MD.y > 800) { MD.y -= 66; MD.sc *= 0.9; if (!(o.plate && o.plate.y !== undefined)) PL.y -= 30; if (!(o.title && o.title.y !== undefined)) TT.y -= 20; } if (tick && MS && !(o.mascot && o.mascot.y !== undefined) && MS.y > 800) MS.y -= 60;
  const hits = [[0, 1], [T0, 0.9]]; if (MD) hits.push([T0 + 0.5, 0.6]); for (let b = T0 + 0.9; b < 5; b += 0.4) hits.push([b, 0.26]);
  const pk = decay(m, hits, 13);
  ctx.save();
  camV2(ctx, o.cam ? o.cam[0] : CX, o.cam ? o.cam[1] : CY, 1.014 + pk * 0.045 + Math.min(m, 5) * 0.005); shakeAt(ctx, t, (2 + pk * 24) * pw);
  if (o.bg) o.bg(ctx, m, t, pk); else if (pal.rainbow) rainbowBG2(ctx, t * 2.2, o.bgC ? o.bgC[0] : G.x - 120, o.bgC ? o.bgC[1] : 380); else { ctx.save(); ctx.translate(-30, -20); ctx.scale(1.03, 1.04); palBG(ctx, t, pal, G.x - 120, 360); ctx.restore(); }
  if (o.back) o.back(ctx, m, t, pk);
  // 角色
  const gk = lin(m, o.tGirl ?? 0.08, (o.tGirl ?? 0.08) + 0.36);
  if (gk > 0 && G.h) {
    const e = eo5(gk), dir = G.from === 'right' ? 1 : G.from === 'left' ? -1 : 0, gh = G.h * (1 + pk * 0.018);
    const gx = G.x + dir * (1 - e) * 1000, gy = G.y + (G.from === 'below' ? (1 - e) * 950 : 0) + Math.sin(t * 2.1) * 6;
    if (gk < 1 && dir) for (let i = 1; i <= 4; i++) drawImg(ctx, silC(GIRL_SIL, `hsl(${i * 70},100%,62%)`), gx + dir * i * 90 * (1 - gk), gy, gh, G.rot, 0.35);
    girlV2(ctx, gx, gy, gh, t, { rot: G.rot });
  }
  if (o.mid) o.mid(ctx, m, t, pk);
  // 標題（砸下的瞬間噴碎片、衝擊波）
  const tk = lin(m, T0, T0 + 0.18);
  if (m >= T0) { ctx.save(); ctx.translate(TT.x - 730, TT.y - 420); coins(ctx, m - T0 + T_HIT); ctx.restore(); ringBurst(ctx, TT.x, TT.y, m - T0, { r1: 1500 }); }
  heroTitle(ctx, t, TT.x, TT.y, tk, { maxW: TT.maxW, rot: TT.rot, pk, s: TT.s, depth: TT.depth });
  plateV2(ctx, t, eo(lin(m, T0 + 0.28, T0 + 0.48)), PL.x, PL.y, PL.sc);
  if (MD) medalV2(ctx, t, MD.x, MD.y, lin(m, T0 + 0.5, T0 + 0.68), pk, MD.sc);
  if (MS) mascotV2(ctx, t, lin(m, T0 + 0.7, T0 + 1.0), MS.x, MS.y, MS.h, MS.flip);
  if (o.front) o.front(ctx, m, t, pk);
  ctx.restore();
  if (o.confetti !== false) confetti(ctx, m, 0.05, o.confettiN ?? (hi ? 150 : 70), o.confetti || ['#ffe27a', '#fff6c0', '#ffffff', pal.edge ? pal.edge[1] : '#ff5aa5', '#ff5a8c'], 5);
  if (tick) { const e = 1 - eo5(lin(m, T0 + 0.2, T0 + 0.45)); if (m > T0 + 0.2) { tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); } }
  if (o.led ?? hi) { ctx.save(); ctx.globalAlpha = lin(m, 0, 0.25); if (pal.rainbow) ledFrame(ctx, t); else ledFrameHue(ctx, t, (i) => ({ red: 0, blue: 205, sky: 200, green: 120 }[CFG.pal] ?? 38) + ((i * 7 + t * 80) % 20)); ctx.restore(); }
  if (m >= T0) flash(ctx, (1 - lin(m, T0, T0 + 0.1)) * 0.32, '#fff6d0');
}

// ---------- 字型預載：Google Fonts 的中日文字型是分片載入，第一次畫到才抓，會先用系統字型頂替（同一行兩種字體）。
// mkengine.py 會把所有原始檔裡出現過的字收進 window.__V2_TEXT，這裡一次載完。
const _lvaV2 = window.loadVarAssets;
window.loadVarAssets = async function () {
  if (_lvaV2) await _lvaV2();
  const s = (window.__V2_TEXT || '') + P.name;
  for (const f of ["150px 'Dela Gothic One'", "900 150px 'Noto Sans TC'", "700 40px 'Noto Sans TC'", "700 40px 'LXGW WenKai TC'"]) { try { await document.fonts.load(f, s); } catch (e) {} }
};

// 名字＋份數底帶（覆寫原版）：名字太長會自動縮字，不會衝出底帶
function subLine(ctx, t, a, X = 800, Y = 750, SC = 1.25) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(X, Y); ctx.rotate(-0.06); ctx.scale(SC, SC);
  ctx.fillStyle = '#1a0838'; ctx.beginPath(); ctx.moveTo(-470, -80); ctx.lineTo(470, -96); ctx.lineTo(450, 86); ctx.lineTo(-490, 98); ctx.fill();
  ctx.fillStyle = '#ffe14a'; ctx.fillRect(-470, 82, 920, 8);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.font = "900 46px 'Noto Sans TC'"; const w1 = ctx.measureText(CFG.sub1).width, f1 = Math.min(1, 840 / w1);
  ctx.save(); ctx.translate(0, -42); ctx.scale(f1, f1); ctx.fillStyle = '#fff'; ctx.fillText(CFG.sub1, 0, 0); ctx.restore();
  ctx.font = "900 80px 'Noto Sans TC'"; const w2 = ctx.measureText(CFG.sub2).width, f2 = Math.min(1, 820 / w2);
  ctx.save(); ctx.translate(0, 40); ctx.scale(f2, f2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 16; ctx.strokeText(CFG.sub2, 0, 0);
  const ag = ctx.createLinearGradient(0, -46, 0, 34); ag.addColorStop(0, '#fff3a0'); ag.addColorStop(0.5, '#ffb21a'); ag.addColorStop(0.52, '#ff7a00'); ag.addColorStop(1, '#ff3d8b');
  ctx.fillStyle = ag; ctx.fillText(CFG.sub2, 0, 0); ctx.restore();
  ctx.restore();
}

// ---------- 大標題字型：Dela Gothic One 缺的字（揪、閱、號…）整行改用 Noto Sans TC 900，不讓同一行出現兩種字體 ----------
const DELA_MISSING = /[揪閱號]/;
function titleFont(txt) { return DELA_MISSING.test(txt) ? "900 200px 'Noto Sans TC'" : "200px 'Dela Gothic One', 'Noto Sans TC'"; }
let _titleNoFit = false;   // heroTitle 自己會算縮放，不要再縮一次
function titleFit(x) { if (_titleNoFit) return 1; const av = 2 * Math.min(x - 40, W - 40 - x); return Math.min(1, av / ((titleW(CFG.title) + 70) * 1.08)); }
function titleText(ctx, t, x, y, s, rot) {   // 覆寫原版：字型依標題內容決定
  const txt = CFG.title, pal = PAL[CFG.pal]; s *= titleFit(x);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = titleFont(txt); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.shadowColor = pal.glow; ctx.shadowBlur = 40; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 56; ctx.strokeText(txt, 0, 0); ctx.shadowBlur = 0;
  const gold = ctx.createLinearGradient(0, -110, 0, 110); gold.addColorStop(0, '#fff6c0'); gold.addColorStop(0.45, '#ffb21a'); gold.addColorStop(0.55, '#c76a00'); gold.addColorStop(1, '#ffe27a');
  ctx.strokeStyle = gold; ctx.lineWidth = 34; ctx.strokeText(txt, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.strokeText(txt, 0, 0);
  ctx.fillStyle = palFill(ctx, -95, 95, t, pal); ctx.fillText(txt, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-2000, -120, 4000, 95); ctx.clip(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillText(txt, 0, 0); ctx.restore();
  const sw = ((t - 4.0) * 0.9) % 1.6; if (sw > 0 && sw < 1) { ctx.save(); ctx.globalCompositeOperation = 'source-atop'; const gx = -900 + sw * 1800, gr = ctx.createLinearGradient(gx - 120, 0, gx + 120, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillText(txt, 0, 0); ctx.restore(); }
  ctx.restore();
}
function title3D(ctx, t, x, y, s, rot, depth, col) {
  const f3 = titleFit(x);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * f3, s * f3);
  ctx.font = titleFont(CFG.title); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let i = depth; i >= 1; i--) { ctx.strokeStyle = col[i % 2]; ctx.lineWidth = 56; ctx.strokeText(CFG.title, i * 1.4, i * 2.2); }
  ctx.restore(); titleText(ctx, t, x, y, s, rot);
}

// ======================= V2 訂閱／少量：小卡整體放大（原本字太小，直播畫面上讀不清楚） =======================
function scaledVar(fn, ax, ay, s0) { return (ctx, t) => { const s = typeof s0 === 'function' ? s0() : s0; ctx.save(); ctx.translate(ax, ay); ctx.scale(s, s); ctx.translate(-ax, -ay); fn(ctx, t); ctx.restore(); }; }
const nameUnits = () => Array.from(P.name).reduce((a, ch) => a + (ch.codePointAt(0) > 0x2E80 ? 1 : 0.55), 0);
for (const i of [1, 2, 3]) VARS.sub[i].fn = scaledVar(VARS.sub[i].fn, 0, H, 1.32);
VARS.sub[4].fn = scaledVar(VARS.sub[4].fn, W, H, () => (nameUnits() > 9 ? 1.0 : 1.18));   // 對話框往左長，名字太長就不放大，免得超出畫面
for (const i of [1, 2, 3, 4]) VARS.g1[i].fn = scaledVar(VARS.g1[i].fn, 0, H, 1.32);

// ======================= V2 大量（g10）：幸運大轉盤／鎖定掃描／VS 對決／號外 =======================
function redBG(ctx, t, cx, cy, dark = 0.15) {   // 紅色放射背景（帶出血，鏡頭晃動不露邊）
  ctx.save(); ctx.translate(-40, -30); ctx.scale(1.045, 1.06); palBG(ctx, t, PAL.red, cx, cy); ctx.restore();
  if (dark > 0) { ctx.fillStyle = `rgba(30,0,8,${dark})`; ctx.fillRect(-80, -80, W + 160, H + 160); }
}

// ---------------- 大量 1：幸運大轉盤 ----------------
function wheelV2(ctx, t, wx, wy, dia, o = {}) {   // o.ang 指定角度（結尾當背景慢轉）、o.stand/o.pointer 可關
  const STOP = WH_T.stop, won = t >= STOP, k = dia / 640;
  const ang = o.ang ?? wheelAngle(t), om = o.ang !== undefined ? 0 : Math.abs(wheelAngle(t) - wheelAngle(t - 1 / 60)) * 60;
  if (o.stand !== false) { const stH = dia * 0.93, stW = WHEEL_STAND.width * stH / WHEEL_STAND.height; ctx.drawImage(WHEEL_STAND, wx - stW / 2, wy - stH * WHEEL_GEO.hubY, stW, stH); }
  const ghosts = om > 200 ? 5 : 0;
  for (let q = ghosts; q >= 0; q--) { ctx.save(); ctx.globalAlpha *= q ? 0.2 : 1; ctx.translate(wx, wy); ctx.rotate((ang - q * om / 60 / (ghosts + 1)) * Math.PI / 180); ctx.drawImage(WHEEL_DISC, -dia / 2, -dia / 2, dia, dia); ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < WHEEL_GEO.nB; i++) {   // 外圈跑燈；中獎後全部交替閃
    const a = (i / WHEEL_GEO.nB) * Math.PI * 2 + ang * Math.PI / 180 - Math.PI / 2, bx = wx + Math.cos(a) * dia * WHEEL_GEO.bulbR, by = wy + Math.sin(a) * dia * WHEEL_GEO.bulbR;
    const on = won ? ((Math.floor((t - STOP) * 10) + i) % 2 ? 1 : 0.3) : (Math.floor(t * 18) - i) % 4 === 0 ? 0.9 : 0; if (!on) continue;
    const r = 24 * k, gg = ctx.createRadialGradient(bx, by, 0, bx, by, r); gg.addColorStop(0, `rgba(255,250,210,${on})`); gg.addColorStop(1, 'rgba(255,190,80,0)'); ctx.fillStyle = gg; ctx.fillRect(bx - r, by - r, r * 2, r * 2);
  }
  ctx.restore();
  if (won && o.ang === undefined) { const l = t - STOP, a = (Math.floor(l * 8) % 2 ? 0.55 : 0.2) * (1 - lin(l, 1.2, 1.8));   // 中獎格閃白
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,250,220,${a})`; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.arc(wx, wy, dia * 0.43, -Math.PI / 2 - Math.PI / 8, -Math.PI / 2 + Math.PI / 8); ctx.fill(); ctx.restore(); }
  if (o.pointer !== false) { const f = (((ang + 90 + WHEEL_GEO.winA) % 45) + 45) % 45 / 45, flap = om > 900 ? Math.sin(t * 90) * 0.15 : -0.45 * Math.max(0, 1 - f * 5), pw = 96 * k, ph = WHEEL_PTR.height * pw / WHEEL_PTR.width;
    ctx.save(); ctx.translate(wx, wy - dia / 2 - ph * 0.35); ctx.rotate(flap); ctx.drawImage(WHEEL_PTR, -pw / 2, -ph * 0.3, pw, ph); ctx.restore(); }
  if (won) { const hk = lin(t, STOP + 0.12, STOP + 0.34); if (hk > 0) { const s = k * (hk < 1 ? 2 - eback(hk, 1.6) : 1); ctx.save(); ctx.translate(wx, wy); ctx.scale(s, s); ctx.beginPath(); ctx.arc(0, 0, 112, 0, 7); ctx.fillStyle = '#c8102e'; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#ffd34a'; ctx.stroke(); smallTitle(ctx, t, '×' + CFG.n, 0, 4, 92, PAL.gold, 'center'); ctx.restore(); } }
}
function v2RoulettePre(ctx, t) {
  const STOP = WH_T.stop, won = t >= STOP, app = eo(lin(t, 0, 0.3)), dia = 820, wx = 960, wy = 575 + (1 - eback(lin(t, 0.05, 0.5), 1.3)) * 1300;
  const zk = sstep(lin(t, 1.85, WH_T.slow + 0.2)) * (won ? 1 - eo(lin(t, STOP + 0.02, STOP + 0.25)) : 1), pk = decay(t, [[0.5, 0.5], [STOP, 1]], 9);
  ctx.save(); camV2(ctx, 960, mixv(540, wy - dia * 0.4, zk), 1.014 + 0.6 * zk + pk * 0.05); shakeAt(ctx, t, pk * 22 + (t > WH_T.slow && !won ? 3 : 0));
  ctx.save(); ctx.globalAlpha = app; redBG(ctx, t, 960, 540, won ? 0.12 : 0.42); ctx.restore();
  if (won) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, wx, wy, 16, `rgba(255,230,150,${0.24 * eo(lin(t, STOP, STOP + 0.3))})`, t * 0.5, 1900, 0.45, 16); ctx.restore(); }
  ctx.save(); ctx.shadowColor = 'rgba(40,0,10,0.5)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; wheelV2(ctx, t, wx, wy, dia); ctx.restore();
  ctx.restore();
  if (t > WH_T.slow + 0.05 && !won) wordV2(ctx, 'CHANCE!!', 960, 930, lin(t, WH_T.slow + 0.05, WH_T.slow + 0.2), { s: 1.0, fill: Math.floor(t * 10) % 2 ? '#ffe14a' : '#ffffff', beat: Math.sin(t * 28) * 0.03, rot: -0.04, stroke: '#4a0010' });
  if (won) { const l = t - STOP; ringBurst(ctx, wx, wy - dia * 0.4, l, { r1: 1500, dur: 0.45 }); coinFountain(ctx, t, STOP, STOP + 1.2, 70);
    wordV2(ctx, '大当り!!', 960, 900, lin(l, 0.02, 0.16), { s: 1.25, fill: '#ffd21a', rot: -0.05, stroke: '#4a0010' }); flash(ctx, (1 - lin(l, 0, 0.14)) * 0.6, '#fff3c0'); }
}
function v2RouletteFin(ctx, m, t) {   // 結尾：巨大數字（轉盤在角色背後）
  finaleV2(ctx, m, t, { style: 'count', bg: (c) => redBG(c, t, 500, 520, 0.05),
    back: (c, mm, tt, pk) => { const k = eo5(lin(mm, 0, 0.5)), fin = -90 - WHEEL_GEO.winA; c.save(); c.globalAlpha = 0.92; wheelV2(c, tt, 500 - (1 - k) * 300, 560, 1180 * (0.7 + 0.3 * k) * (1 + pk * 0.02), { ang: fin + mm * 16, stand: false, pointer: false }); c.restore();
      c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 500, 560, 16, 'rgba(255,236,170,0.16)', tt * 0.3, 1900, 0.4, 16); c.restore(); },
    mid: (c, mm) => coinFountain(c, mm, 0, 2.6, 110) });
}
function v2Roulette(ctx, t) { if (!WHEEL_DISC) return; runV2(ctx, t, { T: WH_T.stop + 0.5, exitKind: 'slice', pre: v2RoulettePre, fin: v2RouletteFin }); }

// ---------------- 大量 2：鎖定掃描 ----------------
const SC2 = { s0: 0.35, s1: 1.5, seek: 1.5, lock: 2.05, gx: 1380, gy: 895, gh: 1650 };
function hudGrid(ctx, t, a) {
  ctx.save(); ctx.fillStyle = `rgba(2,8,18,${0.86 * a})`; ctx.fillRect(-80, -80, W + 160, H + 160);
  ctx.globalAlpha = 0.16 * a; ctx.strokeStyle = HUD_C; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= W; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } for (let y = (t * 40) % 80; y <= H; y += 80) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke(); ctx.restore();
}
function reticleV2(ctx, x, y, sz, col, rot = 0, cross = true) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); brackets(ctx, 0, 0, sz, sz, sz * 0.22, col, 6);
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.globalAlpha *= 0.85; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(0, 0, sz * 0.64, 0, 7);
  if (cross) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(dx * sz * 0.52, dy * sz * 0.52); ctx.lineTo(dx * sz * 0.8, dy * sz * 0.8); }
  ctx.stroke(); ctx.setLineDash([10, 16]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, sz * 0.74, 0, 7); ctx.stroke(); ctx.restore();
}
function hudStatus(ctx, t, txt, col, prog, a = 1) {
  hudText(ctx, txt, 90, 92, 50, col, 'left', a);
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = 'rgba(95,242,255,0.2)'; ctx.fillRect(90, 132, 560, 8); ctx.fillStyle = col; ctx.fillRect(90, 132, 560 * prog, 8); ctx.restore();
  for (let i = 0; i < 5; i++) hudText(ctx, ('0000' + Math.floor(R(i, Math.floor(t * 12)) * 65535).toString(16)).slice(-4).toUpperCase() + '  ' + (R(i + 9, Math.floor(t * 6)) * 99).toFixed(2), 90, 930 + i * 26 - 104, 20, col, 'left', 0.5 * a);
}
function v2ScanPre(ctx, t) {
  const S = SC2, app = eo(lin(t, 0, 0.3)), gy = S.gy + Math.sin(t * 2.1) * 6, G = girlGeo(S.gx, gy, S.gh);
  ctx.save(); camV2(ctx, G.fx, G.fy, 1.014 + 0.06 * sstep(lin(t, S.seek - 0.2, S.lock)));
  hudGrid(ctx, t, app);
  if (GIRL) {
    const scanY = -120 + (H + 240) * sstep(lin(t, S.s0, S.s1));
    drawImg(ctx, silC(GIRL_SIL, '#1d7fa0'), S.gx, gy, S.gh, 0, 0.6 * app);
    ctx.save(); ctx.beginPath(); ctx.rect(-80, -80, W + 160, scanY + 80); ctx.clip(); drawImg(ctx, GIRL, S.gx, gy, S.gh, 0, app); ctx.restore();
    if (t > S.s0 && t < S.s1 + 0.1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createLinearGradient(0, scanY - 110, 0, scanY + 6); gg.addColorStop(0, 'rgba(95,242,255,0)'); gg.addColorStop(1, 'rgba(95,242,255,0.75)'); ctx.fillStyle = gg; ctx.fillRect(S.gx - 620, scanY - 110, 1240, 116); ctx.fillStyle = '#d8fdff'; ctx.fillRect(S.gx - 620, scanY, 1240, 4); ctx.restore(); }
  }
  ctx.restore();
  if (t > 0.5) for (let i = 0; i < 3; i++) {   // 誘餌目標框
    const ph = t * (1.3 + i * 0.4) + i * 2, x = 300 + i * 250 + Math.sin(ph) * 130, y = 330 + i * 190 + Math.cos(ph * 1.3) * 90, a = (1 - lin(t, S.seek, S.lock - 0.2)) * lin(t, 0.5 + i * 0.2, 0.7 + i * 0.2);
    brackets(ctx, x, y, 150, 150, 30, HUD_C, 3, a); hudText(ctx, '?', x, y, 46, HUD_C, 'center', a * (Math.floor(t * 8 + i) % 2 ? 1 : 0.4));
  }
  if (G && t > S.seek - 0.45) {   // 準星衝向臉
    const k = eo5(lin(t, S.seek - 0.45, S.lock)), sz = mixv(680, G.fr * 2.0, k);
    reticleV2(ctx, mixv(520, G.fx, k), mixv(780, G.fy, k), sz, HUD_C, (1 - k) * 1.4 + Math.sin(t * 9) * 0.04 * (1 - k));
  }
  hudStatus(ctx, t, (t < S.seek ? 'SCANNING' : 'TARGET FOUND') + (Math.floor(t * 4) % 2 ? ' ...' : ''), HUD_C, Math.min(1, t / S.lock), app);
}
function v2ScanFin(ctx, m, t) {   // 結尾：轉播字幕條（HUD 資料列）
  const S = SC2, G = girlGeo(S.gx, S.gy, S.gh);
  finaleV2(ctx, m, t, { style: 'lower', tag: 'LOCK', cam: [G.fx, G.fy], tGirl: -1, tTitle: 0.42, confetti: false, girl: { x: S.gx, y: S.gy, h: S.gh, from: 'none', rot: 0 }, title: { x: 640, y: 250, maxW: 1060 },
    bg: (c, mm) => { redBG(c, t, G.fx, G.fy, 0.3); c.save(); c.globalAlpha = 0.5 * (1 - lin(mm, 0.1, 0.6)); hudGrid(c, t, 1); c.restore(); },
    back: (c, mm) => { for (let i = 0; i < 3; i++) ringBurst(c, G.fx, G.fy, mm - i * 0.08, { r1: 1500, dur: 0.6, sq: 1, w: 18, col: `rgba(255,${130 + i * 50},${130 + i * 40},1)` }); },
    front: (c, mm, tt, pk) => {
      const gyb = Math.sin(tt * 2.1) * 6; reticleV2(c, G.fx, G.fy + gyb, G.fr * 2.0 * (1 + 0.25 * Math.exp(-mm * 10)), HUD_R, 0, false);
      const lk = lin(mm, 0, 0.12); c.save(); c.translate(G.fx - 500, G.fy + 190); c.rotate(-0.04); c.scale(slamK(lk, 2.2), slamK(lk, 2.2)); c.globalAlpha = Math.floor(mm * 10) % 2 && mm < 0.6 ? 0.6 : 1;
      c.fillStyle = HUD_R; c.fillRect(-210, -48, 420, 96); c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(-210, -48, 420, 96); hudText(c, 'LOCK ON', 0, 4, 66, '#fff', 'center'); c.restore();
      brackets(c, 640, 250, 1160, 300, 50, 'rgba(255,255,255,0.75)', 4, eo(lin(mm, 0.5, 0.8))); } });
  if (m < 0.5) { ctx.save(); ctx.globalAlpha = 0.3 * (1 - m / 0.5) * (Math.floor(m * 16) % 2); ctx.fillStyle = HUD_R; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}
function v2Scan(ctx, t) { runV2(ctx, t, { T: SC2.lock, exitKind: 'crt', cutA: 0.55, cutCol: '#ffd0d0', pre: v2ScanPre, fin: v2ScanFin }); }

// ---------------- 大量 3：VS 對決 ----------------
const VS2 = { in: 0.15, vs: 0.6, clash: 0.95, push: 2.35, win: 2.6 };
function v2VersusPre(ctx, t) {
  const T = VS2, ink = eo5(lin(t, T.in, T.in + 0.35)), ten = lin(t, T.clash, T.push);
  let cx = 960 + Math.sin(Math.max(0, t - T.clash) * 9) * 46 * ten + Math.sin(Math.max(0, t - T.clash) * 23) * 14 * ten;
  if (t > T.push) cx += (W + 900 - cx) * ei(lin(t, T.push, T.win));
  const edge = (y) => cx + (y - 540) * 0.32, pk = decay(t, [[T.vs, 1], [T.clash, 0.5], [T.push, 0.8]], 10);
  ctx.save(); camV2(ctx, CX, CY, 1.02 + pk * 0.04 + ten * 0.03); shakeAt(ctx, t, pk * 22 + ten * 7);
  // 右（紅）：主播
  ctx.save(); ctx.globalAlpha = ink; const gr = ctx.createLinearGradient(W, 0, 960, H); gr.addColorStop(0, '#ff3a4a'); gr.addColorStop(1, '#4a0010'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160);
  speedLines(ctx, 1500, 420, 50, 420, 'rgba(255,220,220,0.28)', Math.floor(t * 20), 0, 1);
  if (GIRL) { const gx = 1500 + (1 - ink) * 1100 + Math.max(0, cx - 960) * 0.5; outlineV2(ctx, GIRL_SIL, gx, 880, 1560, -0.04, '#fff', 8); drawImg(ctx, GIRL, gx, 880, 1560, -0.04); }
  ctx.restore();
  // 左（藍）：贈訂者，用分界線裁切
  ctx.save(); ctx.beginPath(); ctx.moveTo(-90, -90); ctx.lineTo(edge(-90), -90); ctx.lineTo(edge(H + 90), H + 90); ctx.lineTo(-90, H + 90); ctx.closePath(); ctx.clip();
  ctx.globalAlpha = ink; const gl = ctx.createLinearGradient(0, 0, 960, H); gl.addColorStop(0, '#3a8aff'); gl.addColorStop(1, '#0a1450'); ctx.fillStyle = gl; ctx.fillRect(-80, -80, W + 160, H + 160);
  speedLines(ctx, 420, 480, 50, 420, 'rgba(210,230,255,0.28)', Math.floor(t * 20) + 50, 0, 1);
  if (MASCOT) { const mx = 450 - (1 - ink) * 1100 + Math.min(0, cx - 960) * 0.4 + (t > T.push ? (cx - 960) * 0.55 : 0), my = 560 + Math.abs(Math.sin(t * 10)) * -18 * ten; outlineV2(ctx, MASCOT, mx, my, 900, 0.08, '#fff', 8); drawImg(ctx, MASCOT, mx, my, 900, 0.08); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = ink; ctx.strokeStyle = '#fff'; ctx.lineWidth = 18; ctx.shadowColor = '#fff'; ctx.shadowBlur = 36; ctx.beginPath(); ctx.moveTo(edge(-90), -90); ctx.lineTo(edge(H + 90), H + 90); ctx.stroke(); ctx.restore();
  if (t > T.clash) for (let i = 0; i < 5; i++) { const y = 100 + ((t * 700 + i * 210) % 880); sparkBurst(ctx, edge(y), y, (t * 3 + i * 0.25) % 0.6, 9, 1.4, i % 2 ? '#bfe0ff' : '#ffd0c8'); }
  // 名牌（左下）
  const nk = eo5(lin(t, T.in + 0.2, T.in + 0.5));
  if (nk > 0) { ctx.save(); ctx.translate(-760 * (1 - nk), 0); ctx.fillStyle = 'rgba(5,10,40,0.88)'; ctx.beginPath(); ctx.moveTo(50, 880); ctx.lineTo(800, 880); ctx.lineTo(752, 1010); ctx.lineTo(2, 1010); ctx.fill(); ctx.fillStyle = '#5fd0ff'; ctx.fillRect(40, 1002, 720, 8);
    hudText(ctx, 'GIFTER', 96, 860, 30, '#8fc4ff'); ctx.font = "900 70px 'Noto Sans TC'"; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(P.name, 84, 946, 650); ctx.restore(); }
  // 集氣條＋份數
  if (t > T.clash) { const q = eo(ten), n = Math.max(1, Math.round(CFG.n * q)), a = eo(lin(t, T.clash, T.clash + 0.2));
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(70, 62, 780, 56); const bar = ctx.createLinearGradient(70, 0, 850, 0); bar.addColorStop(0, '#5fd0ff'); bar.addColorStop(1, '#ffffff'); ctx.fillStyle = bar; ctx.fillRect(76, 68, 768 * q, 44);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(70, 62, 780, 56); ctx.restore(); hudText(ctx, 'GIFT POWER', 76, 150, 30, '#bfe0ff', 'left', a);
    wordV2(ctx, '×' + n, 1010, 100, a, { s: 0.72, pop: false, fill: '#8fe0ff', rot: -0.04, beat: Math.sin(t * 30) * 0.03, stroke: '#061a5a', box: false }); }
  const vk = lin(t, T.vs, T.vs + 0.18);
  if (vk > 0) { const gg = ctx.createLinearGradient(0, -80, 0, 80); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffc21a'); gg.addColorStop(1, '#e07800');
    wordV2(ctx, 'VS', edge(520) - 10, 520, vk, { s: 2.5, big: 3, fill: gg, rot: -0.12, beat: Math.sin(t * 30) * 0.02 * ten, stroke: '#3a1400', depth: 14, box: false });
    if (t < T.vs + 0.5) for (let i = 0; i < 5; i++) bolt(ctx, edge(520), 520, edge(520) + Math.cos(i * 1.4 + 0.4) * 640, 520 + Math.sin(i * 1.4 + 0.4) * 440, i + Math.floor(t * 30), 7, '#fff6c0'); }
  ctx.restore();
  if (t >= T.vs) flash(ctx, (1 - lin(t, T.vs, T.vs + 0.12)) * 0.5, '#fff');
}
function v2VersusFin(ctx, m, t) {   // 結尾：漫畫三分格（勝利特寫）
  finaleV2(ctx, m, t, { style: 'manga', mascot: {},
    bg: (c) => { c.save(); c.translate(-40, -30); c.scale(1.045, 1.06); palBG(c, t, PAL.gold, 960, 400); c.restore(); },
    panelBg: (c, tt) => { c.save(); c.translate(-40, -30); c.scale(1.045, 1.06); palBG(c, tt, PAL.gold, 430, 380); c.restore(); },
    front: (c, mm) => wordV2(c, LX('victory'), 420, 930, lin(mm, 0.12, 0.27), { s: 0.9, maxW: 700, big: 2.8, fill: '#ff3a4a', rot: -0.07, stroke: '#3a0010' }) });
}
function v2Versus(ctx, t) { runV2(ctx, t, { T: VS2.win, exitKind: 'whipR', pre: v2VersusPre, fin: v2VersusFin }); }

// ---------------- 大量 4：號外 ----------------
const NW2 = { land: 1.25, move: 2.7, PH: 1010 };
function newsMainV2(ctx, t, x, y, sc, rot) {
  const PH = NW2.PH, PW = PH * NEWS_PAPER.width / NEWS_PAPER.height;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 46; ctx.shadowOffsetY = 20; ctx.fillStyle = '#000'; ctx.fillRect(-PW / 2 + 6, -PH / 2 + 6, PW - 12, PH - 12); ctx.shadowColor = 'transparent';
  drawPaper(ctx, PW, PH, t, t >= NW2.land ? t - NW2.land : -1); ctx.restore();
}
function newsFlyV2(ctx, t) {   // 背景飛過的小報紙
  for (let i = 0; i < 14; i++) { const st = NW2.land + R(i, 1) * 3.2, q = (t - st) / 1.7; if (q < 0 || q > 1) continue;
    const ph = 190 + R(i, 2) * 170, pw = ph * NEWS_PAPER.width / NEWS_PAPER.height, x = -220 + (W + 440) * q * (0.7 + R(i, 3) * 0.6), y = 100 + R(i, 4) * 880 - Math.sin(q * 3) * 90;
    ctx.save(); ctx.globalAlpha = 0.85; ctx.translate(R(i, 5) > 0.5 ? x : W - x, y); ctx.rotate(q * (R(i, 6) - 0.5) * 9); ctx.drawImage(newsSmall(), -pw / 2, -ph / 2, pw, ph); ctx.restore(); }
}
function v2ExtraPre(ctx, t) {
  const T = NW2, app = eo(lin(t, 0, 0.25)), k = eo(lin(t, 0.15, T.land)), pk = decay(t, [[T.land, 1], [T.land + 0.35, 0.5]], 10);
  ctx.save(); camV2(ctx, CX, CY, 1.014 + pk * 0.05); shakeAt(ctx, t, pk * 26);
  ctx.save(); ctx.globalAlpha = app; redBG(ctx, t, 960, 540, 0.34); if (t > T.land) halftone(ctx, 0, 0, W, H, 'rgba(255,220,200,0.12)', t); ctx.restore();
  if (t > T.land) newsFlyV2(ctx, t);
  if (t < T.land) { ctx.save(); ctx.globalAlpha = 0.5 * k; speedLines(ctx, 960, 540, 70, 300 + 400 * k, 'rgba(255,255,255,0.7)', Math.floor(t * 30), 0, 1); ctx.restore(); }
  newsMainV2(ctx, t, 960, 540 + Math.sin(t * 1.6) * 5, 0.04 + 0.96 * k, (1 - k) * Math.PI * 7);
  ringBurst(ctx, 960, 540, t - T.land, { r1: 1500, dur: 0.45 });
  ctx.restore();
  if (t >= T.land) flash(ctx, (1 - lin(t, T.land, T.land + 0.12)) * 0.55, '#fff');
}
function v2ExtraFin(ctx, m, t) {
  finaleV2(ctx, m, t, { lay: 'R', tGirl: 0.12, tTitle: 0.5, girl: { x: 1320 }, title: { x: 1210, y: 735, maxW: 1180, rot: -0.04 }, plate: { x: 1230, y: 945, sc: 0.8 },
    bg: (c, mm) => { const e = eo5(lin(mm, 0, 0.45)); redBG(c, t, mixv(960, 1320, e), mixv(540, 420, e), mixv(0.34, 0.22, e)); halftone(c, 0, 0, W, H, 'rgba(255,220,200,0.12)', t); },
    back: (c) => newsFlyV2(c, t),
    mid: (c, mm) => { const e = eo5(lin(mm, 0, 0.45)); newsMainV2(c, t, mixv(960, 440, e), 540 + Math.sin(t * 1.6) * 5, 1 - 0.1 * e, -0.07 * e + Math.sin(t * 1.2) * 0.008); },
    front: (c, mm) => wordV2(c, LX('extra'), 1610, 175, lin(mm, 0.3, 0.44), { s: 0.82, maxW: 430, big: 2.6, fill: '#ffd21a', rot: 0.06, stroke: '#4a0010' }) });
}
function v2Extra(ctx, t) { if (!NEWS_PAPER) return; runV2(ctx, t, { T: NW2.move, cut: false, exitKind: 'smear', pre: v2ExtraPre, fin: v2ExtraFin }); }

VARS.g10[1] = { name: '幸運大轉盤', fn: v2Roulette, dur: 6.1 };
VARS.g10[2] = { name: '鎖定掃描', fn: v2Scan, dur: 5.4 };
VARS.g10[3] = { name: 'VS 對決', fn: v2Versus, dur: 5.6 };
VARS.g10[4] = { name: '號外', fn: v2Extra, dur: 5.8 };

// ======================= V2 頂級（g100）：時間逆轉／宇宙創世／巨大化／全回轉 =======================
// 頂級共用結尾：對稱構圖、光之翼、雙吉祥物、×N 徽章、PREMIUM 章、煙火、上下跑馬燈
function premiumFinV2(ctx, m, t, o = {}) {
  const st = !!o.style && o.style !== 'hero';   // 其他構圖：不套對稱版面的位置，也不放光之翼和左右吉祥物
  const base = { lay: 'C', tGirl: 0.1, tTitle: 0.62, bgC: [960, 420], confettiN: 210, mascot: false,
    girl: { x: 960, h: 1650, from: 'below' }, title: { x: 960, y: 640, maxW: 1500, s: 1.05, depth: 20 }, plate: { x: 960, y: 844, sc: 0.78 }, medal: { x: 320, y: 275, sc: 1.05 } };
  const merged = st ? Object.assign({ tGirl: 0.1, tTitle: 0.62, bgC: [960, 420], confettiN: 210, mascot: false }, o)
    : Object.assign({}, base, o, { girl: Object.assign({}, base.girl, o.girl), title: Object.assign({}, base.title, o.title), plate: Object.assign({}, base.plate, o.plate), medal: Object.assign({}, base.medal, o.medal) });
  const seal = o.seal || [1590, 268];
  finaleV2(ctx, m, t, Object.assign(merged, {
    back: (c, mm, tt, pk) => {
      if (o.back) o.back(c, mm, tt, pk);
      c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 960, 380, 18, 'rgba(255,255,255,0.2)', tt * 0.4, 2100, 0.4, 16); c.restore();
      fireworksAt(c, mm, [[0.4, 300, 250, 30], [0.7, 1620, 230, 200], [1.1, 620, 150, 300], [1.5, 1300, 160, 120], [1.9, 240, 520, 60], [2.3, 1680, 520, 260], [2.8, 960, 120, 180], [3.2, 420, 300, 330]]);
      if (!st && o.wings !== false) { c.save(); c.translate(960, (o.girl && o.girl.wy) || 450); c.scale(1.75, 1.75); wings(c, tt, 0, 0, eo(lin(mm, 0.15, 0.65)), 1); c.restore(); }
    },
    front: (c, mm, tt, pk) => {
      if (!st && o.twins !== false) { mascotV2(c, tt, lin(mm, 1.25, 1.55), 205, 810, 290); mascotV2(c, tt, lin(mm, 1.35, 1.65), 1715, 810, 290, true); }
      premiumSeal(c, tt, seal[0], seal[1], lin(mm, 1.45, 1.63), pk);
      if (o.front) o.front(c, mm, tt, pk);
    } }));
}

// ---------------- 頂級 1：時間逆轉 ----------------
function clockV2(ctx, cx, cy, size, spin, ghost = 0) {   // 鐘面＋時針分針（spin = 分針角度）
  const cw = CLOCK_FACE.width * size / CLOCK_FACE.height;
  ctx.save(); ctx.translate(cx, cy); ctx.drawImage(CLOCK_FACE, -cw * CLOCK_GEO.cx, -size * CLOCK_GEO.cy, cw, size);
  for (const [img, gq, mul, gh] of [[CLOCK_HOUR, CLOCK_GEO.hour, 1 / 12, 0], [CLOCK_MIN, CLOCK_GEO.min, 1, 1]]) {
    const hh = size * gq[2] / gq[1], hw = img.width * hh / img.height, n = gh ? ghost : 0;
    for (let k = n; k >= 0; k--) { ctx.save(); ctx.globalAlpha *= k ? 0.18 : 1; ctx.rotate(spin * mul + k * 0.12); ctx.drawImage(img, -hw * gq[0], -hh * gq[1], hw, hh); ctx.restore(); }
  }
  ctx.restore();
}
function v2RewindPre(ctx, t) {
  const T = TR_T, app = eo(lin(t, 0, 0.25)), rw = lin(t, T.rew, T.slow);
  let spin = 0; if (t > T.rew) { spin = -(rw * rw * 22 * Math.PI); if (t > T.slow) spin = -(22 * Math.PI) - eo5(lin(t, T.slow, T.stop)) * 2 * Math.PI; }
  const pk = decay(t, [[T.freeze, 0.5], [T.stop, 1]], 9);
  ctx.save(); camV2(ctx, 960, 560, 1.014 + 0.12 * sstep(rw) + pk * 0.04); shakeAt(ctx, t, pk * 18 + (t > T.rew && t < T.stop ? rw * 9 : 0));
  ctx.save(); ctx.globalAlpha = app;
  if (t < T.rew) { ctx.fillStyle = '#16122a'; ctx.fillRect(-80, -80, W + 160, H + 160); fakeNotice(ctx, Math.min(t, T.freeze)); if (t > T.freeze) { ctx.fillStyle = `rgba(20,10,40,${0.6 * lin(t, T.freeze, T.rew)})`; ctx.fillRect(-80, -80, W + 160, H + 160); } }
  else {
    const gg = ctx.createRadialGradient(960, 560, 0, 960, 560, 1300); gg.addColorStop(0, '#4a34a0'); gg.addColorStop(1, '#06031a'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 110; i++) { const a = R(i, 1) * 7 - t * (0.6 + R(i, 2)), q = (R(i, 3) + t * 0.6) % 1, r = 1200 * (1 - q); star4(ctx, 960 + Math.cos(a) * r, 560 + Math.sin(a) * r * 0.7, 6 + 14 * q, '#cfe0ff', 0.75 * q); } ctx.restore();   // 時間粒子往中心吸
    ctx.save(); ctx.translate(960, 560); ctx.rotate(-t * 1.4 * lin(t, T.rew, T.rew + 0.5)); ctx.font = "700 110px 'Noto Serif', serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(200,190,255,0.2)';
    ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((n, i) => { ctx.save(); ctx.rotate(i * Math.PI / 6); ctx.fillText(n, 0, -820); ctx.restore(); }); ctx.restore();
  }
  ctx.restore();
  if (t > T.rew - 0.1) { const ck = eback(lin(t, T.rew - 0.1, T.rew + 0.35), 1.4); ctx.save(); ctx.shadowColor = 'rgba(255,220,120,0.7)'; ctx.shadowBlur = 50 + 40 * rw; clockV2(ctx, 960, 560, 920 * ck, spin, t > T.rew + 0.5 && t < T.slow ? 4 : 0); ctx.restore();
    if (t >= T.stop) ringBurst(ctx, 960, 560, t - T.stop, { r0: 400, r1: 1100, dur: 0.4, sq: 1, w: 24 }); }
  ctx.restore();
  if (t > T.freeze) {   // 錄影帶倒帶介面
    const k = lin(t, T.freeze, T.freeze + 0.1); hudText(ctx, '◀◀ REWIND', 90, 96, 64, '#ffffff', 'left', k * (Math.floor(t * 3) % 2 ? 1 : 0.6));
    if (t < T.stop) { ctx.save(); ctx.globalAlpha = 0.5 * k; for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(0, (t * 900 + i * 300) % (H + 100) - 50, W, 12 + i * 6); } ctx.restore(); }
    const c = Math.max(0, Math.round(100 * (1 - lin(t, T.rew, T.stop)))); hudText(ctx, `-0${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`, W - 90, 96, 64, '#ffffff', 'right', k);
  }
  if (t >= T.stop) wordV2(ctx, '0:00', 960, 560, lin(t, T.stop, T.stop + 0.12), { s: 1.35, big: 3, fill: '#bff4ff', rot: -0.04, stroke: '#0a1450', depth: 12 });
}
function v2RewindFin(ctx, m, t) {
  premiumFinV2(ctx, m, t, { wings: false, back: (c, mm, tt, pk) => { const k = eo5(lin(mm, 0, 0.6)); c.save(); c.globalAlpha = 0.95; c.translate(960, mixv(560, 430, k)); c.rotate(tt * 0.15); c.shadowColor = 'rgba(255,230,140,0.9)'; c.shadowBlur = 70; const size = mixv(2400, 1260, k) * (1 + pk * 0.02), cw = CLOCK_FACE.width * size / CLOCK_FACE.height; c.drawImage(CLOCK_FACE, -cw / 2, -size / 2, cw, size); c.restore(); coinFountain(c, mm, 0, 3.4, 190); } });
}
function v2Rewind(ctx, t) { if (!CLOCK_FACE) return; runV2(ctx, t, { T: TR_T.burst, cutA: 0.95, exitKind: 'crt', pre: v2RewindPre, fin: v2RewindFin }); }

// ---------------- 頂級 2：宇宙創世 ----------------
function galaxyV2(ctx, t, l, sw, a = 1, cy = 540) {   // 爆炸粒子 → 捲成三條旋臂的星系
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const e = sstep(sw);
  for (let i = 0; i < 1300; i++) {
    const arm = i % 3, rr = Math.pow(R(i, 1), 0.7), a0 = R(i, 2) * Math.PI * 2, d0 = Math.min(1, l * 1.6) * 1300 * R(i, 3);
    const ga = arm * Math.PI * 2 / 3 + rr * 5.5 - t * 0.5 + (R(i, 4) - 0.5) * 0.6 * (1 - rr * 0.4), gd = 60 + rr * 720 + (R(i, 6) - 0.5) * 80;
    const x0 = 960 + Math.cos(a0) * d0, y0 = cy + Math.sin(a0) * d0 * 0.8, x1 = 960 + Math.cos(ga) * gd, y1 = cy + Math.sin(ga) * gd * 0.5;
    const s = 4 + 9 * R(i, 5) * (1 - rr * 0.5);
    ctx.fillStyle = `hsla(${(200 + arm * 70 + rr * 80 + t * 20) % 360},100%,${70 + 20 * (1 - rr)}%,${0.85 * a})`; ctx.fillRect(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, s, s);
  }
  if (sw > 0) { const gg = ctx.createRadialGradient(960, cy, 0, 960, cy, 380); gg.addColorStop(0, `rgba(255,250,230,${0.9 * sw * a})`); gg.addColorStop(1, 'rgba(255,200,255,0)'); ctx.fillStyle = gg; ctx.fillRect(580, cy - 380, 760, 760); }
  ctx.restore();
}
function planetsV2(ctx, t, k) {
  if (k <= 0) return;
  for (const [px, py, pr, hue, ring] of [[330, 250, 84, 20, 1], [1630, 290, 62, 200, 0], [1560, 830, 104, 300, 1], [280, 830, 54, 120, 0]]) {
    const r = pr * eback(k, 1.6); ctx.save(); ctx.translate(px, py + Math.sin(t * 1.5 + px) * 10);
    const rg = (a0, a1) => { ctx.strokeStyle = `hsl(${hue + 40},90%,75%)`; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.45, -0.3, a0, a1); ctx.stroke(); };
    if (ring) rg(Math.PI, 0);
    ctx.fillStyle = `hsl(${hue},85%,62%)`; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.save(); ctx.clip(); ctx.fillStyle = `hsl(${hue},80%,44%)`; ctx.beginPath(); ctx.arc(r * 0.35, r * 0.4, r * 0.95, 0, 7); ctx.fill(); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.26, r * 0.16, -0.6, 0, 7); ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#1a0838'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    if (ring) rg(0, Math.PI); ctx.restore(); }
}
function v2CosmosPre(ctx, t) {
  const T = CS_T, app = eo(lin(t, 0, 0.2)), banged = t >= T.bang, l = t - T.bang, pk = decay(t, [...T.beat.map((b, i) => [b, 0.25 + i * 0.15]), [T.bang, 1]], 7);
  ctx.save(); camV2(ctx, 960, 540, 1.02 + pk * 0.07 + (banged ? 0.1 * (1 - eo(lin(l, 0, 1.2))) : 0.12 * lin(t, 0, T.bang))); shakeAt(ctx, t, pk * 26);
  ctx.fillStyle = `rgba(0,0,5,${app})`; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (!banged) {   // 一個光點心跳三下，越跳越大
    let p = 0.3; T.beat.forEach((b, i) => { const q = t - b; if (q > 0) p += Math.exp(-q * 6) * (0.9 + i * 0.5); }); const r = 16 + 40 * p;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createRadialGradient(960, 540, 0, 960, 540, r * 6); gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(0.15, 'rgba(255,240,200,0.8)'); gg.addColorStop(1, 'rgba(120,80,255,0)'); ctx.fillStyle = gg; ctx.fillRect(960 - r * 6, 540 - r * 6, r * 12, r * 12); star4(ctx, 960, 540, r * 3, '#fff', 0.9); ctx.restore();
    T.beat.forEach((b) => ringBurst(ctx, 960, 540, t - b, { r0: 30, r1: 500, dur: 0.4, sq: 1, w: 8, col: 'rgba(200,190,255,1)' }));
  } else {
    galaxyV2(ctx, t, l, lin(t, T.galaxy, T.galaxy + 1.1));
    for (let i = 0; i < 3; i++) ringBurst(ctx, 960, 540, l - i * 0.12, { r0: 60, r1: 1700, dur: 1.0, sq: 1, w: 34, col: `hsl(${(i * 80 + 200) % 360},100%,80%)` });
    planetsV2(ctx, t, lin(t, T.galaxy + 0.6, T.galaxy + 1.2));
  }
  ctx.restore();
  if (t > T.galaxy && t < T.form) { ctx.save(); ctx.globalAlpha = lin(t, T.galaxy, T.galaxy + 0.3) * (1 - lin(t, T.form - 0.3, T.form)); inkText(ctx, '新しい宇宙が、生まれる——', 960, 965, 70, '#e8f4ff', '#0a1450'); ctx.restore(); }
  if (banged) flash(ctx, (1 - lin(l, 0, 0.35)) * 0.95, '#fff');
}
function v2CosmosFin(ctx, m, t) {   // 結尾：漫畫三分格
  premiumFinV2(ctx, m, t, { style: 'manga', seal: [330, 846], mascot: {},
    bg: (c, mm) => { c.fillStyle = '#05021a'; c.fillRect(-80, -80, W + 160, H + 160); galaxyV2(c, t, 9, 1, 0.9, 540); } });
}
function v2Cosmos(ctx, t) { runV2(ctx, t, { T: CS_T.form, cutA: 0.75, exitKind: 'iris', pre: v2CosmosPre, fin: v2CosmosFin }); }

// ---------------- 頂級 3：巨大化 ----------------
function searchlights(ctx, t, a, swing = 1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)'; for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(250 + i * 470, 1090); ctx.rotate(Math.sin(t * 1.3 + i * 1.7) * 0.5 * swing); const lg = ctx.createLinearGradient(0, 0, 0, -1400); lg.addColorStop(0, `rgba(255,240,200,${a})`); lg.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(20, 0); ctx.lineTo(170, -1400); ctx.lineTo(-170, -1400); ctx.fill(); ctx.restore(); } ctx.restore(); }
function skylineV2(ctx, t, o) {   // o: seed, n, prof(xc)→高度, cols, lit, boards, win
  const n = o.n, bw = (W + 200) / n;
  for (let i = 0; i < n; i++) {
    const w = bw * (0.82 + R(i, o.seed + 1) * 0.3), x = -100 + i * bw + R(i, o.seed + 2) * 20, h = o.prof(x + w / 2, i), y = 1080 - h;
    ctx.fillStyle = o.cols[i % o.cols.length]; ctx.fillRect(x, y, w, h + 20); ctx.strokeStyle = o.line; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h + 20);
    if (o.win) for (let wy = y + 22; wy < 1066; wy += 40) for (let wx = x + 16; wx < x + w - 22; wx += 30) { const on = R(i * 97 + Math.round(wx), Math.round(wy) + o.seed) < 0.25 + 0.7 * o.lit; ctx.fillStyle = on ? (R(Math.round(wx), Math.round(wy) + i) < 0.5 ? o.win[0] : o.win[1]) : o.win[2]; ctx.fillRect(wx, wy, 16, 22); }
    if (o.boards && o.boards.includes(i) && o.lit > 0.5 && h > 260) { ctx.fillStyle = '#05030c'; ctx.fillRect(x + 8, y + 30, w - 16, 96); ctx.save(); ctx.beginPath(); ctx.rect(x + 12, y + 34, w - 24, 88); ctx.clip(); rainbowBG2(ctx, t * 2.2, x + w / 2, y + 78); smallTitle(ctx, t, '×' + CFG.n, x + w / 2, y + 80, 46, PAL.gold, 'center'); ctx.restore(); }
  }
  ctx.fillStyle = o.line; ctx.fillRect(-100, 1072, W + 200, 100);
}
function cityFar(ctx, t, lit) {   // 角色後面：比較淡、比較高的一排
  skylineV2(ctx, t, { seed: 40, n: 19, lit: lit * 0.6, line: '#1a1446', cols: ['#2c2468', '#342a74', '#28205e'], win: ['#c9b46a', '#b98ac0', '#221a58'], prof: (xc, i) => 330 + R(i, 43) * 330 });
  ctx.fillStyle = 'rgba(60,40,120,0.35)'; ctx.fillRect(-100, 380, W + 200, 800);   // 空氣感：遠景壓淡
}
function cityNear(ctx, t, lit) {   // 角色前面：中間矮（一開始看得到角色）、兩側高
  skylineV2(ctx, t, { seed: 7, n: 16, lit, boards: [1, 3, 12, 14], line: '#0a0620', cols: ['#1e1846', '#241c50', '#1a1440', '#2a2058'], win: ['#ffe28a', '#ffb0e0', '#1a1240'],
    prof: (xc, i) => { const d = Math.min(1, Math.abs(xc - 960) / 760); return 120 + 40 * R(i, 9) + (300 + 240 * R(i, 10)) * Math.pow(d, 1.5); } });
}
const GI2 = { h0: 300, h1: 2050, faceY: 420 };
function giantGeo(gk) { const gh = GI2.h0 + (GI2.h1 - GI2.h0) * gk, gy = 1062 - gh / 2 + (GI2.faceY - FACE.y * GI2.h1 + GI2.h1 - 1062) * gk; return [gh, gy]; }
function v2GiantPre(ctx, t) {
  const T = GI_T, app = eo(lin(t, 0, 0.3)), gk = sstep(lin(t, T.grow0, T.grow1)), growing = t > T.grow0;
  ctx.save(); camV2(ctx, 960, 860, 1.03 + (1 - gk) * 0.3 * sstep(lin(t, 0.2, T.grow0))); shakeAt(ctx, t, growing ? 6 + 16 * gk : 0);
  ctx.save(); ctx.globalAlpha = app; const gg = ctx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#0a0830'); gg.addColorStop(1, '#3a1a5a'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160);
  for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(255,255,240,${0.5 * R(i, 3)})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * 560, 3, 3); }
  cityFar(ctx, t, lin(t, T.grow0, T.grow1)); searchlights(ctx, t, 0.35 + 0.2 * gk);
  if (GIRL) { const [gh, gy] = giantGeo(gk), ak = eback(lin(t, T.appear, T.appear + 0.3), 1.6); if (ak > 0) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const sp = ctx.createRadialGradient(960, gy, 0, 960, gy, gh * 0.9); sp.addColorStop(0, `rgba(255,245,200,${0.4 * (1 - gk)})`); sp.addColorStop(1, 'rgba(255,245,200,0)'); ctx.fillStyle = sp; ctx.fillRect(960 - gh, gy - gh, gh * 2, gh * 2); ctx.restore();
    const hh = gh * ak, yy = 1062 - (1062 - gy) * ak; if (gk > 0) neonOutline(ctx, GIRL_SIL, 960, yy, hh, t, 0); else outlineV2(ctx, GIRL_SIL, 960, yy, hh, 0, '#fff', 4, 12); drawImg(ctx, GIRL, 960, yy, hh, 0); } }
  cityNear(ctx, t, lin(t, T.grow0, T.grow1));
  ctx.restore(); ctx.restore();
  if (t > T.appear + 0.2 && !growing) wordV2(ctx, '…あれ?', 1290, 760, lin(t, T.appear + 0.2, T.appear + 0.36), { s: 0.55, fill: '#bff4ff', rot: 0.05, stroke: '#0a1450' });
  if (growing) wordV2(ctx, 'ゴゴゴゴ…', 960, 170, lin(t, T.grow0, T.grow0 + 0.15), { s: 0.9 + 0.5 * gk, fill: Math.floor(t * 8) % 2 ? '#ff3a4a' : '#ffb21a', rot: -0.04 + Math.sin(t * 40) * 0.01, stroke: '#2a0010', beat: Math.sin(t * 30) * 0.03 });
}
function v2GiantFin(ctx, m, t) {
  const [gh, gy] = giantGeo(1);
  premiumFinV2(ctx, m, t, { tGirl: -1, tTitle: 0.45, twins: false, cam: [960, 420], girl: { x: 960, y: gy, h: gh, from: 'none', wy: 520 }, title: { y: 676, s: 0.95 }, plate: { y: 0, sc: 0 }, medal: { x: 300, y: 275 }, bgC: [960, 400],
    bg: (c, mm) => { const gg = c.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#4a1a8a'); gg.addColorStop(1, '#ff7ab8'); c.fillStyle = gg; c.fillRect(-80, -80, W + 160, H + 160); c.save(); c.globalAlpha = lin(mm, 0, 0.5); rainbowBG2(c, t * 2.2, 960, 400); c.fillStyle = 'rgba(20,0,50,0.22)'; c.fillRect(-80, -80, W + 160, H + 160); c.restore(); cityFar(c, t, 1); searchlights(c, t, 0.4, 0.4); },
    mid: (c, mm, tt) => { cityNear(c, tt, 1); const gr = c.createLinearGradient(0, 600, 0, 1080); gr.addColorStop(0, 'rgba(10,0,40,0)'); gr.addColorStop(1, 'rgba(10,0,40,0.5)'); c.fillStyle = gr; c.fillRect(-80, 600, W + 160, 600); },
    front: (c, mm, tt) => plateV2(c, tt, eo(lin(mm, 0.75, 0.95)), 960, 848, 0.68) });
}
function v2Giant(ctx, t) { runV2(ctx, t, { T: GI_T.grow1, cutA: 0.7, exitKind: 'slice', pre: v2GiantPre, fin: v2GiantFin }); }

// ---------------- 頂級 4：全回轉 ----------------
function reelsV2(ctx, t, fx, fy, o = {}) {   // 三個捲軸，全部都是同一個角色圖案在轉
  const T = ZK_T, rw = 330, rh = 660, gap = 36, sym = 220;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 50; ctx.fillStyle = '#1a0828'; ctx.beginPath(); ctx.roundRect(fx - 610, fy - 395, 1220, 790, 44); ctx.fill(); ctx.restore();
  ctx.lineWidth = 16; const fg = ctx.createLinearGradient(0, fy - 395, 0, fy + 395); fg.addColorStop(0, '#ffe08a'); fg.addColorStop(1, '#c87a00'); ctx.strokeStyle = fg; ctx.beginPath(); ctx.roundRect(fx - 610, fy - 395, 1220, 790, 44); ctx.stroke();
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 44; i++) { const u = i / 44, per = 2 * (1220 + 790), d = u * per; let x, y; if (d < 1220) { x = fx - 610 + d; y = fy - 395; } else if (d < 2010) { x = fx + 610; y = fy - 395 + d - 1220; } else if (d < 3230) { x = fx + 610 - (d - 2010); y = fy + 395; } else { x = fx - 610; y = fy + 395 - (d - 3230); }
    const on = ((i - Math.floor(t * 24)) % 4 + 4) % 4 < 2 ? 1 : 0.25, gr = ctx.createRadialGradient(x, y, 0, x, y, 22); gr.addColorStop(0, `hsla(${(i * 12 + t * 400) % 360},100%,85%,${on})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(x - 22, y - 22, 44, 44); } ctx.restore();
  for (let r = 0; r < 3; r++) {
    const x = fx + (r - 1) * (rw + gap), stopT = T.stop[r]; let pos;
    if (t < T.spin) pos = 0; else if (t < stopT) { const u = t - T.spin; pos = u * 9 + u * u * 4; } else { const ps = Math.ceil((stopT - T.spin) * 9 + Math.pow(stopT - T.spin, 2) * 4); pos = ps - (1 - eback(lin(t, stopT, stopT + 0.28), 2.4)) * 0.35; }
    const spinning = t > T.spin && t < stopT, fr = ((pos % 1) + 1) % 1;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x - rw / 2, fy - rh / 2, rw, rh, 20); ctx.clip(); ctx.fillStyle = '#fff6fb'; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh);
    for (let k = -3; k <= 2; k++) { const y = fy + (k + fr) * sym * 1.25; ctx.save(); ctx.globalAlpha = spinning ? 0.75 : 1; ctx.translate(x, y); if (spinning) ctx.scale(1, 1.3); ctx.drawImage(zkFace(), -sym / 2, -sym / 2, sym, sym); ctx.restore(); }
    const sh = ctx.createLinearGradient(0, fy - rh / 2, 0, fy + rh / 2); sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(0.25, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.5)'); ctx.fillStyle = sh; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh);
    ctx.restore();
    if (t >= stopT && t < stopT + 0.3) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,220,${0.6 * (1 - (t - stopT) / 0.3)})`; ctx.fillRect(x - rw / 2, fy - rh / 2, rw, rh); ctx.restore(); }
  }
  if (t >= T.stop[2]) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `hsla(${(t * 400) % 360},100%,70%,0.9)`; ctx.lineWidth = 10; ctx.shadowColor = '#fff'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.moveTo(fx - 560, fy); ctx.lineTo(fx + 560, fy); ctx.stroke(); ctx.restore(); }
}
function v2ZenPre(ctx, t) {
  const T = ZK_T, app = eo(lin(t, 0, 0.3)), all = t >= T.all, l = t - T.all;
  const pk = decay(t, [[T.spin, 0.5], [T.stop[0], 0.5], [T.stop[1], 0.65], [T.stop[2], 0.8], [T.all, 1]], 10), zk = sstep(lin(t, T.spin + 0.6, T.stop[2])) * (all ? 1 - eo(lin(l, 0, 0.3)) : 1);
  ctx.save(); camV2(ctx, 960, 520, 1.014 + 0.14 * zk + pk * 0.045); shakeAt(ctx, t, pk * 22 + (t > T.spin && !all ? 3 + 5 * zk : 0));
  ctx.save(); ctx.globalAlpha = app;
  if (!all) { const gg = ctx.createRadialGradient(960, 520, 0, 960, 520, 1300); gg.addColorStop(0, '#6a0a44'); gg.addColorStop(1, '#0a0210'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160);
    if (t > T.spin) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(ctx, 960, 520, 6, `hsla(${(h * 60 + t * 240) % 360},100%,60%,0.11)`, t * 1.5 + h * 0.5, 1900, 0.35, 14); ctx.restore(); } }
  else rainbowBG2(ctx, t * 2.2, 960, 520);
  ctx.restore();
  ctx.save(); ctx.translate(0, (1 - eback(lin(t, 0, 0.45), 1.3)) * 1200); reelsV2(ctx, t, 960, 520); ctx.restore();
  if (all) { ringBurst(ctx, 960, 520, l, { r1: 1600, dur: 0.5 }); coinFountain(ctx, t, T.all, T.all + 1.4, 110); }
  ctx.restore();
  if (t > T.spin && !all) wordV2(ctx, t < T.stop[0] ? 'プレミアム…!?' : '全部そろう…!?', 960, 985, 1, { s: 0.62, pop: false, fill: Math.floor(t * 10) % 2 ? '#ff3a8c' : '#ffe14a', rot: -0.02, stroke: '#2a0030', beat: Math.sin(t * 26) * 0.03 });
  if (all) { const gg = ctx.createLinearGradient(0, -80, 0, 80); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(0.5, '#ffc21a'); gg.addColorStop(1, '#e07800');
    wordV2(ctx, '全回転!!', 960, 520, lin(l, 0, 0.16), { s: 2.3, big: 3.2, fill: gg, rot: -0.07, stroke: '#3a1400', depth: 16, beat: Math.sin(t * 20) * 0.02 }); flash(ctx, (1 - lin(l, 0, 0.2)) * 0.85, '#fff'); }
}
function v2ZenFin(ctx, m, t) {   // 結尾：巨大數字
  premiumFinV2(ctx, m, t, { style: 'count', seal: [330, 840], mascot: {}, back: (c, mm, tt) => { c.save(); c.globalAlpha = 0.4 * (1 - 0.5 * lin(mm, 0, 0.6)); camV2(c, 960, 520, 1.25); reelsV2(c, tt, 960, 480); c.restore(); c.fillStyle = 'rgba(30,0,60,0.12)'; c.fillRect(-80, -80, W + 160, H + 160); coinFountain(c, mm, 0, 3.4, 220); } });
}
function v2Zen(ctx, t) { runV2(ctx, t, { T: ZK_T.all + 1.0, exitKind: 'smear', pre: v2ZenPre, fin: v2ZenFin }); }

VARS.g100[1] = { name: '時間逆轉', fn: v2Rewind, dur: 8.6 };
VARS.g100[2] = { name: '宇宙創世', fn: v2Cosmos, dur: 9.0 };
VARS.g100[3] = { name: '巨大化', fn: v2Giant, dur: 8.2 };
VARS.g100[4] = { name: '全回轉', fn: v2Zen, dur: 9.4 };

// ======================= V2 特大（g25）：寶箱／火箭／舞台大幕／十連抽 =======================
function goldBG(ctx, t, cx, cy, dark = 0) {
  ctx.save(); ctx.translate(-40, -30); ctx.scale(1.045, 1.06); palBG(ctx, t, PAL.gold, cx, cy); ctx.restore();
  if (dark > 0) { ctx.fillStyle = `rgba(40,16,0,${dark})`; ctx.fillRect(-80, -80, W + 160, H + 160); }
}
function coinsFrom(ctx, x, y, t, t0, t1, n) { ctx.save(); ctx.translate(x - CX, y - (H + 40)); coinFountain(ctx, t, t0, t1, n); ctx.restore(); }
function lightPillar(ctx, x, y, w, a) {   // 從 (x,y) 往上的光柱
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(22px)'; const gp = ctx.createLinearGradient(0, y, 0, -160); gp.addColorStop(0, `rgba(255,245,200,${0.95 * a})`); gp.addColorStop(1, 'rgba(255,220,120,0)');
  ctx.fillStyle = gp; ctx.beginPath(); ctx.moveTo(x - w * 0.4, y); ctx.lineTo(x + w * 0.4, y); ctx.lineTo(x + w * 0.95, -160); ctx.lineTo(x - w * 0.95, -160); ctx.fill(); ctx.restore();
}

// ---------------- 特大 1：寶箱 ----------------
function chestV2(ctx, cx, y, bw, o = {}) {   // y = 箱底；o: lid, lift, leak, rot, sq, jx
  const sc = bw / CHEST_BODY.width, bh = CHEST_BODY.height * sc, lw = CHEST_LID.width * sc, lh = CHEST_LID.height * sc, seam = -bh + bh * CHEST_GEO.lidDY, lift = o.lift || 0, leak = o.leak || 0, sq = o.sq || 0;
  ctx.save(); ctx.translate(cx + (o.jx || 0), y); ctx.rotate(o.rot || 0); ctx.scale(1 + sq * 0.06, 1 - sq * 0.06);
  if (leak > 0 && o.lid !== false) {   // 蓋縫漏光
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(12px)'; ctx.fillStyle = `rgba(255,240,170,${leak})`; ctx.fillRect(-bw * 0.46, seam - 16 - lift, bw * 0.92, 22 + lift);
    for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.17; ctx.strokeStyle = `rgba(255,240,180,${0.4 * leak})`; ctx.lineWidth = 34; ctx.beginPath(); ctx.moveTo(0, seam - lift); ctx.lineTo(Math.cos(a) * 1300 * leak, seam + Math.sin(a) * 1300 * leak); ctx.stroke(); } ctx.restore();
  }
  ctx.drawImage(CHEST_BODY, -bw / 2, -bh, bw, bh);
  if (o.lid !== false) ctx.drawImage(CHEST_LID, -lw / 2, seam - lh - lift, lw, lh);
  ctx.restore(); return { bh, lw, lh, seam };
}
function v2ChestPre(ctx, t) {
  const T = CH_T, app = eo(lin(t, 0, 0.3)), opened = t >= T.open, l = t - T.open, mv = eio(lin(t, T.open + 0.12, T.open + 0.52));
  const bw = mixv(900, 740, mv), cx = mixv(960, 1440, mv), base = mixv(1010, 1170, mv);
  let y = base, jx = 0, rot = 0, lift = 0, leak = 0, zz = 0;
  if (t < T.land) { const u = lin(t, T.drop, T.land); y = -360 + (base + 360) * u * u; }
  const sq = t >= T.land ? Math.exp(-(t - T.land) * 12) * Math.sin((t - T.land) * 40) : 0;
  for (const [rt, p] of [[T.r1, 0.5], [T.r2, 0.75], [T.r3, 1]]) { const q = t - rt; if (q > 0 && q < 0.35) { const k = Math.sin(q / 0.35 * Math.PI); y -= 54 * p * k; jx += Math.sin(q * 70) * 15 * p; rot += Math.sin(q * 50) * 0.05 * p; lift += 40 * p * k; } if (q > 0) { leak = Math.max(leak, p * Math.exp(-q * 1.5)); zz = Math.max(zz, p); } }
  if (t > T.r3) leak = Math.max(leak, lin(t, T.r3 + 0.2, T.open));
  const pk = decay(t, [[T.land, 0.8], [T.r1, 0.25], [T.r2, 0.4], [T.r3, 0.55], [T.open, 1]], 9);
  ctx.save(); camV2(ctx, 960, 640, 1.014 + (opened ? (1 - eo(lin(l, 0, 0.3))) * 0.08 : zz * 0.08) + pk * 0.035); shakeAt(ctx, t, pk * 26);
  ctx.save(); ctx.globalAlpha = app; goldBG(ctx, t, mixv(960, 1400, mv), mixv(560, 480, mv), opened ? 0.5 * (1 - eo(lin(l, 0, 0.25))) : 0.5); ctx.restore();
  const g0 = chestV2(ctx, -9999, 0, bw);   // 只取尺寸
  if (opened) { lightPillar(ctx, cx, base - g0.bh * 0.6, bw, Math.min(1, l * 5)); ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, cx, base - g0.bh * 0.6, 16, `rgba(255,240,180,${0.26 * Math.min(1, l * 3)})`, l * 0.5, 1900, 0.4, 16); ctx.restore(); coinsFrom(ctx, cx, base - g0.bh * 0.55, t, T.open, T.open + 3, 150); }
  ctx.save(); ctx.shadowColor = 'rgba(40,10,0,0.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16; chestV2(ctx, cx, y, bw, { lid: !opened, lift, leak, rot, sq, jx }); ctx.restore();
  if (opened) { const ly = base + g0.seam - g0.lh / 2 - 3000 * l + 2400 * l * l; if (ly > -500) { ctx.save(); ctx.translate(960 + l * 500, ly); ctx.rotate(l * 9); ctx.drawImage(CHEST_LID, -g0.lw / 2, -g0.lh / 2, g0.lw, g0.lh); ctx.restore(); } ringBurst(ctx, 960, base - g0.bh * 0.6, l, { r1: 1500, dur: 0.45 }); }
  if (t >= T.land && t < T.land + 0.6) for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) { const q = (t - T.land) / 0.6; ctx.save(); ctx.globalAlpha = 0.55 * (1 - q); ctx.fillStyle = '#fff3d8'; ctx.beginPath(); ctx.arc(960 + sx * (bw * 0.46 + q * 300 + i * 40), base - 10 - i * 14 - q * 40, 30 + q * 56 - i * 5, 0, 7); ctx.fill(); ctx.restore(); }
  ctx.restore();
  if (t > T.r3 + 0.15 && !opened) wordV2(ctx, '開くぞ…!!', 960, 190, lin(t, T.r3 + 0.15, T.r3 + 0.3), { s: 0.78, fill: '#fff2a0', stroke: '#5a3000', beat: Math.sin(t * 30) * 0.03 });
  if (opened) flash(ctx, (1 - lin(l, 0, 0.16)) * 0.8, '#fff6d0');
}
function v2ChestFin(ctx, m, t) {   // 結尾：直書大字
  finaleV2(ctx, m, t, { style: 'vertical', tGirl: 0, tTitle: 0.5, girl: { x: 1400, from: 'below' }, plate: { x: 840, y: 902 }, bg: (c) => goldBG(c, t, 1400, 480),
    back: (c, mm) => { const g0 = chestV2(c, -9999, 0, 740); lightPillar(c, 1440, 1170 - g0.bh * 0.6, 740, 0.8); c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 1400, 600, 16, 'rgba(255,240,180,0.2)', t * 0.4, 1900, 0.4, 16); c.restore(); coinsFrom(c, 1440, 1170 - g0.bh * 0.55, t, CH_T.open, CH_T.open + 3.4, 150); },
    mid: (c, mm, tt, pk) => { c.save(); c.shadowColor = 'rgba(40,10,0,0.5)'; c.shadowBlur = 40; c.shadowOffsetY = 16; chestV2(c, 1440, 1170 + pk * 10, 740, { lid: false }); c.restore(); sparkleField(c, tt, 16, 1000, 560, 1800, 1000, 1); } });
}
function v2Chest(ctx, t) { if (!CHEST_BODY) return; runV2(ctx, t, { T: CH_T.open + 0.52, cut: false, exitKind: 'slice', pre: v2ChestPre, fin: v2ChestFin }); }

// ---------------- 特大 2：火箭 ----------------
const RK2 = { ign: 0.35, lift: 1.25, space: 2.2, loop0: 2.45, loop1: 3.55, cx: 1400, cy: 520, r: 400 };
function rk2Space(t) {   // 太空段的火箭位置 [x, y, 角度]
  const T = RK2;
  if (t < T.loop0) { const u = eo(lin(t, T.space, T.loop0)); return [mixv(560, T.cx, u), mixv(1500, T.cy + T.r, u), mixv(0.5, Math.PI / 2, u * u)]; }
  const a = Math.PI / 2 - (t < T.loop1 ? lin(t, T.loop0, T.loop1) * Math.PI * 2 : Math.PI * 2 + (t - T.loop1) * 1.3);
  return [T.cx + Math.cos(a) * T.r, T.cy + Math.sin(a) * T.r, a];
}
function rocketV2(ctx, x, y, rot, rh, t, flame = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); if (flame > 0) rocketFlame(ctx, 0, rh * 0.46, rh * 0.32 * flame, t, 0);
  const rw = ROCKET.width * rh / ROCKET.height; ctx.drawImage(ROCKET, -rw / 2, -rh / 2, rw, rh); ctx.restore();
}
function cloudV2(ctx, x, y, s, a = 1) {   // 平塗雲：白底＋淡藍陰影＋描線
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(x, y); ctx.scale(s, s);
  const blob = () => { ctx.beginPath(); for (const [bx, by, br] of [[-110, 10, 62], [-40, -28, 78], [48, -14, 70], [120, 14, 54]]) { ctx.moveTo(bx + br, by); ctx.arc(bx, by, br, 0, 7); } ctx.rect(-150, 14, 300, 50); };
  ctx.fillStyle = '#b9d8f6'; ctx.save(); ctx.translate(0, 12); blob(); ctx.fill(); ctx.restore(); ctx.fillStyle = '#ffffff'; blob(); ctx.fill(); ctx.restore();
}
function spaceBG(ctx, t, warp = 0) {
  const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0c0830'); gr.addColorStop(0.6, '#2a1260'); gr.addColorStop(1, '#5a1f7a'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160);
  const nb = ctx.createRadialGradient(RK2.cx, RK2.cy, 0, RK2.cx, RK2.cy, 1100); nb.addColorStop(0, 'rgba(255,170,90,0.28)'); nb.addColorStop(0.5, 'rgba(200,80,200,0.14)'); nb.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = nb; ctx.fillRect(-80, -80, W + 160, H + 160);
  for (let i = 0; i < 130; i++) { const x = R(i, 1) * W, y = (R(i, 2) * H + warp * (300 + R(i, 5) * 900)) % H, tw = 0.55 + 0.45 * Math.sin(t * (2 + R(i, 4) * 4) + i), s = 1.5 + R(i, 3) * 2.5;
    ctx.fillStyle = `rgba(255,255,240,${0.4 + 0.6 * R(i, 3) * tw})`; if (warp > 0.02) ctx.fillRect(x, y, s, s + warp * 60); else if (i % 9 === 0) star4(ctx, x, y, 6 + s * 3 * tw, '#fff', 0.9 * tw); else ctx.fillRect(x, y, s, s); }
}
function v2RocketPre(ctx, t) {
  const T = RK2, app = eo(lin(t, 0, 0.3)), cam = sstep(lin(t, T.lift + 0.12, T.space + 0.1)), camY = cam * 2600;
  const pk = decay(t, [[T.ign, 0.4], [T.lift, 1]], 6), rumble = t > T.ign && t < T.space ? 8 + 10 * lin(t, T.ign, T.lift) : 0;
  ctx.save(); camV2(ctx, 960, 620, 1.02 + pk * 0.03); shakeAt(ctx, t, pk * 18 + rumble);
  ctx.save(); ctx.globalAlpha = app;
  if (t < T.space + 0.12) {
    const mixc = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * cam)), sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgb(${mixc([58, 140, 255], [12, 8, 48])})`); sky.addColorStop(0.65, `rgb(${mixc([150, 215, 255], [42, 18, 96])})`); sky.addColorStop(1, `rgb(${mixc([255, 244, 200], [90, 31, 122])})`); ctx.fillStyle = sky; ctx.fillRect(-80, -80, W + 160, H + 160);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 1500, 160 + camY * 0.3, 14, `rgba(255,255,220,${0.12 * (1 - cam)})`, 0.3, 1900, 0.4, 14); ctx.restore();
    for (let i = 0; i < 9; i++) cloudV2(ctx, (R(i, 4) * 2200 + t * 14 * (1 + i % 3)) % 2300 - 190, 150 + i * 170 - 900 + camY * (0.35 + (i % 3) * 0.3) % 2600, 0.8 + (i % 3) * 0.45, 0.95);
    const gy = 940 + camY;
    if (gy < H + 400) {
      ctx.fillStyle = '#58b868'; ctx.beginPath(); ctx.moveTo(-80, gy - 40); ctx.quadraticCurveTo(500, gy - 130, 1000, gy - 50); ctx.quadraticCurveTo(1500, gy - 120, W + 80, gy - 30); ctx.lineTo(W + 80, gy + 400); ctx.lineTo(-80, gy + 400); ctx.fill();
      ctx.fillStyle = '#74d67a'; ctx.fillRect(-80, gy, W + 160, 500);
      ctx.fillStyle = '#5a5a6e'; ctx.strokeStyle = '#2a2440'; ctx.lineWidth = 6; ctx.beginPath(); ctx.rect(760, gy - 34, 400, 50); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 8; ctx.strokeStyle = '#c0392b'; ctx.beginPath(); for (let k = 0; k < 6; k++) { const y0 = gy - 34 - k * 90; ctx.moveTo(1180, y0); ctx.lineTo(1260, y0 - 90); ctx.moveTo(1260, y0); ctx.lineTo(1180, y0 - 90); } ctx.moveTo(1180, gy - 34); ctx.lineTo(1180, gy - 574); ctx.moveTo(1260, gy - 34); ctx.lineTo(1260, gy - 574); ctx.stroke();
    }
    // 發射煙
    if (t > T.ign) for (let i = 0; i < 34; i++) { const l = t - (T.ign + R(i, 5) * 1.3); if (l < 0) continue; const side = R(i, 6) - 0.5, x = 960 + side * (240 + l * 900), y = gy - 20 - l * 80 * R(i, 7), r = 60 + l * 120, a = Math.max(0, 0.95 - l * 0.3);
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#cfcbd6'; ctx.beginPath(); ctx.arc(x + r * 0.12, y + r * 0.16, r, 0, 7); ctx.fill(); ctx.fillStyle = '#f8f6f2'; ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, 7); ctx.fill(); ctx.restore(); }
    const u = lin(t, T.lift, T.space), ry = 690 - 300 * sstep(lin(u, 0, 0.7)) - 1500 * ei(lin(u, 0.55, 1));
    if (t > T.lift) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(14px)'; const tr = ctx.createLinearGradient(0, ry + 200, 0, ry + 1300); tr.addColorStop(0, 'rgba(255,220,150,0.7)'); tr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = tr; ctx.fillRect(900, ry + 200, 120, 1100); ctx.restore(); }
    rocketV2(ctx, 960, ry, Math.sin(t * 40) * 0.006 * rumble / 8, 560, t, t > T.ign ? (t > T.lift ? 1.5 : 0.6 + 0.5 * lin(t, T.ign, T.lift)) : 0);
  } else {
    spaceBG(ctx, t, 1 - eo(lin(t, T.space + 0.1, T.loop0 + 0.2)));
    const u1 = Math.min(1, lin(t, T.loop0, T.loop1));   // 繞圈的光跡
    if (t > T.loop0) { ctx.save(); ctx.lineCap = 'round'; for (const [w, c] of [[60, 'rgba(255,190,80,0.3)'], [28, 'rgba(255,230,150,0.9)'], [10, '#ffffff']]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(T.cx, T.cy, T.r, Math.PI / 2, Math.PI / 2 - u1 * Math.PI * 2 - 0.0001, true); ctx.stroke(); } ctx.restore(); }
    const [rx, ry, ra] = rk2Space(t); for (let i = 1; i <= 6; i++) { const [gx, gy] = rk2Space(t - i * 0.02); ctx.save(); ctx.globalCompositeOperation = 'lighter'; star4(ctx, gx + (R(i, Math.floor(t * 60)) - 0.5) * 30, gy + (R(i + 9, Math.floor(t * 60)) - 0.5) * 30, 40 - i * 5, '#fff2a8', 0.8 - i * 0.1); ctx.restore(); }
    rocketV2(ctx, rx, ry, ra, 300, t, 1.2);
  }
  ctx.restore(); ctx.restore();
  if (t > T.ign && t < T.lift + 0.05) { const n = t < 0.65 ? '3' : t < 0.95 ? '2' : '1', st = t < 0.65 ? 0.35 : t < 0.95 ? 0.65 : 0.95; ctx.save(); ctx.globalAlpha = 1 - lin(t - st, 0.2, 0.3); wordV2(ctx, n, 1470, 420, lin(t, st, st + 0.12), { s: 2.4, fill: '#ff3a4a', rot: -0.06, stroke: '#3a0010', box: false }); ctx.restore(); }
  if (t >= T.lift && t < T.lift + 0.7) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.lift + 0.5, T.lift + 0.7); wordV2(ctx, 'LIFT OFF!!', 500, 330, lin(t, T.lift, T.lift + 0.14), { s: 1.4, fill: '#ffd21a', stroke: '#3a0010', rot: -0.05, box: false }); ctx.restore(); flash(ctx, (1 - lin(t, T.lift, T.lift + 0.14)) * 0.5, '#fff3d0'); }
}
function v2RocketFin(ctx, m, t) {
  const T = RK2;
  finaleV2(ctx, m, t, { style: 'lower', tag: 'GIFT', tGirl: 0.02, tTitle: 0.42, girl: { x: 1400, from: 'below' },   // 結尾：轉播字幕條
    bg: (c) => { spaceBG(c, t, 0); c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, T.cx, T.cy, 16, 'rgba(255,220,140,0.2)', t * 0.35, 1900, 0.42, 16); c.restore(); },
    back: (c, mm, tt, pk) => { fireworksAt(c, tt, [[T.loop1 + 0.2, 380, 220, 40], [T.loop1 + 0.55, 900, 170, 200], [T.loop1 + 1.0, 250, 560, 320], [T.loop1 + 1.5, 760, 300, 120], [T.loop1 + 2.0, 420, 380, 30]]);
      c.save(); c.lineCap = 'round'; for (const [w, col] of [[60, 'rgba(255,190,80,0.3)'], [28, 'rgba(255,230,150,0.9)'], [10, '#ffffff']]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.arc(T.cx, T.cy, T.r * (1 + pk * 0.03), 0, 7); c.stroke(); } c.restore(); haloRing(c, tt, T.cx, T.cy, T.r * 0.86, 0.8, pk); const [rx, ry, ra] = rk2Space(tt); rocketV2(c, rx, ry, ra, 240, tt, 1); } });
}
function v2Rocket(ctx, t) { if (!ROCKET) return; runV2(ctx, t, { T: RK2.loop1, exitKind: 'whipL', pre: v2RocketPre, fin: v2RocketFin }); }

// ---------------- 特大 3：舞台大幕 ----------------
function stageV2(ctx, t, lit) {
  ctx.fillStyle = '#1a0606'; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (lit > 0) { ctx.save(); ctx.globalAlpha = lit; goldBG(ctx, t, 960, 420); ctx.restore(); }
  ctx.fillStyle = '#4a2010'; ctx.beginPath(); ctx.ellipse(960, 1110, 1300, 190, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#7a3e1e'; ctx.beginPath(); ctx.ellipse(960, 1120, 1200, 160, 0, Math.PI, 0); ctx.fill();
  if (lit > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(18px)';
    [[260, '#ff6ab0', 0.42], [1660, '#5fc8ff', -0.42], [680, '#fff3c0', 0.16], [1240, '#fff3c0', -0.16]].forEach(([x, col, a], i) => { ctx.save(); ctx.translate(x, -60); ctx.rotate(a + Math.sin(t * 1.6 + i) * 0.12); const gg = ctx.createLinearGradient(0, 0, 0, 1300); gg.addColorStop(0, col); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.5 * lit; ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(34, 0); ctx.lineTo(290, 1300); ctx.lineTo(-290, 1300); ctx.fill(); ctx.restore(); });
    ctx.restore(); }
}
function curtainsV2(ctx, t, ok, gap = 0) {   // ok：開幕進度；gap：偷看時中間的縫（半寬）
  const cH = 1200, w = (1000 - gap) * (1 - 0.74 * ok) + Math.sin(t * 2.2) * 5 * (1 - ok);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40;
  ctx.drawImage(CURT_L, -40, -60, w, cH); ctx.drawImage(CURT_R, W + 40 - w, -60, w, cH); ctx.restore();
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12; ctx.drawImage(CURT_TOP, -50, -46, W + 100, 250); ctx.restore();
}
function v2CurtainPre(ctx, t) {
  const T = CU_T, app = eo5(lin(t, 0, 0.4)), pkk = t > T.peek0 && t < T.peek1 + 0.1 ? Math.sin(Math.PI * lin(t, T.peek0, T.peek1 + 0.1)) : 0, gap = 96 * pkk;
  ctx.save(); camV2(ctx, 960, 520, 1.014 + 0.07 * sstep(lin(t, T.peek0 - 0.2, T.peek1))); ctx.translate(0, (1 - app) * -1200);
  stageV2(ctx, t, 0);
  if (GIRL && pkk > 0) {   // 縫裡露出半張臉
    const gh = 2500, [fx, fy] = facePos(0, 0, gh); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(20px)'; ctx.fillStyle = `rgba(255,236,190,${0.28 * pkk})`; ctx.fillRect(960 - gap - 30, 0, gap * 2 + 60, H); ctx.restore();
    drawImg(ctx, GIRL, 975 - fx - 70 * (1 - pkk), 540 - fy, gh, -0.06);
  }
  curtainsV2(ctx, t, 0, gap);
  // 聚光燈在布幕上掃
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(28px)';
  for (const [ph, sp] of [[0, 1.3], [2, 1.7]]) { const x = 960 + Math.sin(t * sp + ph) * 620 * (1 - lin(t, T.peek0 - 0.3, T.peek0)), y = 580 + Math.cos(t * sp * 0.7 + ph) * 130, gg = ctx.createRadialGradient(x, y, 0, x, y, 320); gg.addColorStop(0, `rgba(255,245,210,${0.55 * app})`); gg.addColorStop(1, 'rgba(255,230,160,0)'); ctx.fillStyle = gg; ctx.fillRect(x - 320, y - 320, 640, 640); }
  ctx.restore(); ctx.restore();
  if (t > T.peek0 + 0.15 && t < T.peek1 + 0.25) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.peek1 + 0.05, T.peek1 + 0.25); wordV2(ctx, 'まもなく開演!', 1400, 470, lin(t, T.peek0 + 0.15, T.peek0 + 0.3), { s: 0.62, fill: '#ffe14a', rot: 0.06, stroke: '#4a0010', beat: Math.sin(t * 16) * 0.02 }); ctx.restore(); }
}
function v2CurtainFin(ctx, m, t) {
  finaleV2(ctx, m, t, { lay: 'C', tGirl: -1, tTitle: 0.95, cam: [960, 520], girl: { x: 960, y: 990, h: 1620, from: 'none' }, title: { x: 960, y: 722, maxW: 1320 }, plate: { x: 960, y: 912, sc: 0.8 }, medal: { x: 470, y: 440, sc: 0.95 }, mascot: { x: 1510, y: 520, h: 270, flip: true },
    bg: (c, mm) => stageV2(c, t, lin(mm, 0.15, 0.6)),
    front: (c, mm) => { curtainsV2(c, t, eio(lin(mm, 0, 0.7)), 0);
      for (const sx of [-1, 1]) { const q = mm - 0.55; if (q > 0 && q < 0.9) for (let i = 0; i < 30; i++) { const a = -Math.PI / 2 - sx * (0.3 + R(i, 1) * 0.5), v = 1000 + R(i, 2) * 800, x = 960 + sx * 820 + Math.cos(a) * v * q, y = 1040 + Math.sin(a) * v * q + 900 * q * q; c.fillStyle = ['#ffd24a', '#ff5a8a', '#5fc8ff', '#fff'][i % 4]; c.save(); c.translate(x, y); c.rotate(q * 12 + i); c.fillRect(-10, -5, 20, 10); c.restore(); } } } });
  if (m >= 0.55) flash(ctx, (1 - lin(m, 0.55, 0.7)) * 0.4, '#fff6d0');
}
function v2Curtain(ctx, t) { if (!CURT_L) return; runV2(ctx, t, { T: CU_T.open, cut: false, exitKind: 'smear', pre: v2CurtainPre, fin: v2CurtainFin }); }

// ---------------- 特大 4：十連抽 ----------------
const TP2 = { deal: 0.3, flip0: 1.25, step: 0.14, conf: 2.55, fly: 3.35, flip: 3.7, CH: 380 };
function tp2Pos(i) { return [960 + (i % 5 - 2) * 300, i < 5 ? 315 : 745]; }
function cardV2(ctx, x, y, h, rot, fk, kind, t, o = {}) {   // fk：翻面進度 0（背面）→1（正面）
  const sq = Math.abs(Math.cos(Math.PI * fk)) || 0.001, lift = Math.sin(Math.PI * clamp(fk));
  ctx.save(); ctx.globalAlpha *= o.a ?? 1; ctx.translate(x, y - lift * h * 0.05); ctx.rotate(rot); ctx.scale(sq * (1 + lift * 0.06), 1 + lift * 0.06);
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 50; } else { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = h * 0.06; ctx.shadowOffsetY = h * 0.03; }
  if (fk < 0.5) { const bw = CARD_BACK.width * h / CARD_BACK.height; ctx.drawImage(CARD_BACK, -bw / 2, -h / 2, bw, h); }
  else { ctx.shadowColor = 'transparent'; const r = cardFace(ctx, kind === 'ssr' ? 'ssr' : 'r', h, t, kind);
    if (kind === 'ssr' && r && (o.name ?? 0) > 0) { ctx.globalAlpha *= o.name; ctx.font = `900 ${Math.round(h * 0.06)}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a3000'; ctx.fillText(P.name, 0, r.plateY, r.w * 0.56); } }
  ctx.restore();
}
function tp2Others(ctx, t, a, spread = 0) {   // 另外 9 張（結尾退到背景）
  const T = TP2;
  for (let i = 0; i < 9; i++) { const [tx, ty] = tp2Pos(i), dk = eback(lin(t, T.deal + i * 0.06, T.deal + i * 0.06 + 0.35), 1.3); if (dk <= 0) continue;
    const fk = lin(t, T.flip0 + i * T.step, T.flip0 + i * T.step + 0.2), x = 960 + (tx - 960) * dk * (1 + spread * 0.25), y = 1500 - (1500 - ty) * dk + (ty - 540) * spread * 0.2;
    cardV2(ctx, x, y, T.CH, (1 - dk) * (i % 2 ? 0.5 : -0.5) + spread * (i % 2 ? 0.08 : -0.08), fk, i % 2 ? 'r2' : 'r1', t, { a });
    if (fk > 0 && fk < 1) sparkBurst(ctx, x, y, (t - T.flip0 - i * T.step) * 1.5, 8, 0.7, '#cfe8ff'); }
}
function magicCircle(ctx, t, x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.42); ctx.rotate(t * 0.6); ctx.strokeStyle = `rgba(210,180,255,${a})`; ctx.lineWidth = 7; for (const r of [820, 760, 480]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i * Math.PI / 6); star4(ctx, 0, -790, 26, '#e8dcff', a); ctx.restore(); } ctx.restore();
}
function v2TenPre(ctx, t) {
  const T = TP2, app = eo(lin(t, 0, 0.3)), conf = lin(t, T.conf, T.fly), fly = eio(lin(t, T.fly, T.flip)), [lx, ly] = tp2Pos(9), l = t - T.flip;
  const pk = decay(t, [[T.conf, 0.5], [T.flip, 1]], 10), zk = sstep(conf) * (1 - fly);
  ctx.save(); camV2(ctx, mixv(960, lx, zk * 0.8), mixv(540, ly, zk * 0.8), 1.014 + 0.4 * zk + pk * 0.04); shakeAt(ctx, t, pk * 22 + conf * (1 - fly) * 6);
  ctx.save(); ctx.globalAlpha = app; const bg = ctx.createRadialGradient(960, 540, 0, 960, 540, 1300); bg.addColorStop(0, '#42207a'); bg.addColorStop(1, '#0a0420'); ctx.fillStyle = bg; ctx.fillRect(-80, -80, W + 160, H + 160); magicCircle(ctx, t, 960, 580, 0.45 + 0.4 * conf); ctx.restore();
  const sx = mixv(lx, 960, fly), sy = mixv(ly, 540, fly);
  if (conf > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(ctx, sx, sy, 6, `hsla(${(h * 60 + t * 200) % 360},100%,60%,${0.13 * conf})`, t * 1.2 + h * 0.5, 1900, 0.4, 14); ctx.restore(); }
  tp2Others(ctx, t, 1 - 0.6 * Math.max(conf * 0.6, fly), fly);
  const dk = eback(lin(t, T.deal + 0.54, T.deal + 0.89), 1.3);
  if (dk > 0) { const jit = conf * (1 - fly), fk = lin(t, T.flip, T.flip + 0.24);
    cardV2(ctx, 960 + (sx - 960) * dk + Math.sin(t * 60) * 7 * jit, 1500 - (1500 - sy) * dk, T.CH * (1 + 0.06 * jit + 0.7 * fly), (1 - dk) * 0.5 + Math.sin(t * 47) * 0.035 * jit, fk, 'ssr', t, { glow: conf > 0 ? `hsla(${(t * 300) % 360},100%,70%,${conf})` : null, name: lin(l, 0.2, 0.4) }); }
  if (l >= 0) { ringBurst(ctx, 960, 540, l, { r1: 1500, dur: 0.45 }); sparkBurst(ctx, 960, 500, l, 24, 2.4, '#fff6c0'); }
  ctx.restore();
  if (conf > 0 && t < T.flip) { ctx.save(); ctx.globalAlpha = 1 - lin(t, T.flip - 0.12, T.flip); wordV2(ctx, 'SSR 激アツ!!', 700, 180, lin(t, T.conf, T.conf + 0.15), { s: 1.0, fill: rainbowFill(ctx, -70, 70, t), rot: -0.05, beat: Math.sin(t * 24) * 0.03 }); ctx.restore(); }
  if (l >= 0) flash(ctx, (1 - lin(l, 0, 0.16)) * 0.75, '#fff3c0');
}
function v2TenFin(ctx, m, t) {
  const T = TP2;
  finaleV2(ctx, m, t, { lay: 'R', tTitle: 0.48, girl: { h: 0 }, title: { x: 1340, y: 310, maxW: 1020 }, plate: { x: 1350, y: 610, sc: 1.02 }, medal: { x: 1180, y: 880, sc: 0.9 }, mascot: false,
    bg: (c, mm) => { const bg0 = c.createRadialGradient(960, 540, 0, 960, 540, 1300); bg0.addColorStop(0, '#42207a'); bg0.addColorStop(1, '#0a0420'); c.fillStyle = bg0; c.fillRect(-80, -80, W + 160, H + 160); c.save(); c.globalAlpha = eo(lin(mm, 0, 0.4)); goldBG(c, t, 540, 540, 0.12); c.restore(); c.save(); c.globalCompositeOperation = 'lighter'; for (let h = 0; h < 6; h++) godRays(c, 540, 545, 6, `hsla(${(h * 60 + t * 160) % 360},100%,60%,0.09)`, t * 0.7 + h * Math.PI / 18, 1900, 0.45, 14); c.restore(); },
    back: (c, mm) => { c.save(); c.translate((540 - 960) * eio(lin(mm, 0, 0.45)), 0); tp2Others(c, t, 0.4 * (1 - 0.6 * lin(mm, 0, 0.5)), 1 + eo(lin(mm, 0, 0.5)) * 0.6); c.restore(); },
    mid: (c, mm, tt, pk) => { const e = eio(lin(mm, 0, 0.45)); cardV2(c, mixv(960, 540, e), mixv(540, 548, e) + Math.sin(tt * 1.7) * 7, mixv(T.CH * 1.7, 900, e) * (1 + pk * 0.015), -0.06 * e + Math.sin(tt * 1.3) * 0.012, 1, 'ssr', tt, { name: 1 }); sparkleField(c, tt, 26, 120, 60, 960, 1030, 1); } });
}
function v2Ten(ctx, t) { if (!CARD_BACK) return; runV2(ctx, t, { T: TP2.flip + 0.42, cut: false, exitKind: 'slice', pre: v2TenPre, fin: v2TenFin }); }

VARS.g25[1] = { name: '寶箱', fn: v2Chest, dur: 6.6 };
VARS.g25[2] = { name: '火箭', fn: v2Rocket, dur: 7.0 };
VARS.g25[3] = { name: '舞台大幕', fn: v2Curtain, dur: 6.4 };
VARS.g25[4] = { name: '十連抽', fn: v2Ten, dur: 7.4 };

// ======================= V2 中量（g5）：抽卡翻牌／小彈珠台／衝線拍照／單發煙火 =======================
// 中量不整個蓋掉直播畫面：壓暗＋大道具在左、標題與名牌在右。

// ---------------- 中量 1：抽卡翻牌 ----------------
function v2CardsScene(ctx, t) {
  const F3 = 2.0, CH = 600, Y0 = 545, after = t - F3, charge = lin(t, 1.3, F3), app = eo(lin(t, 0, 0.3));
  const fe = eio(lin(after, 0.42, 0.95)), TT = F3 + 0.74;
  const pk = decay(t, [[0.8, 0.25], [1.05, 0.25], [F3, 1], [TT, 0.8]], 11);
  ctx.save();
  camV2(ctx, CX, Y0, 1.014 + 0.1 * sstep(charge) * (after < 0 ? 1 : 1 - eo(lin(after, 0, 0.3))) + pk * 0.03);
  shakeAt(ctx, t, pk * 18 + (after < 0 ? charge * 5 : 0));
  dimBG(ctx, app, [CX, Y0, 1000, 'rgba(110,120,255,0.3)']);
  const sx = mixv(CX, 540, fe), sy = mixv(Y0, 545, fe);
  // SSR 背後的虹光（蓄力時漸強，揭曉後留著當底）
  if (charge > 0) {
    const a = after < 0 ? charge : 0.75; ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let h = 0; h < 6; h++) godRays(ctx, sx, sy, 6, `hsla(${(h * 60 + t * 160) % 360},100%,60%,${0.11 * a})`, t * 0.7 + h * Math.PI / 18, 1700, 0.45, 14);
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, 520 + 240 * a); gr.addColorStop(0, `rgba(255,240,180,${0.5 * a})`); gr.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore();
  }
  const cards = [{ x: CX - 500, t0: 0.1, flip: 0.8, kind: 'r1', dir: -1 }, { x: CX + 500, t0: 0.19, flip: 1.05, kind: 'r2', dir: 1 }, { x: CX, t0: 0.28, flip: F3, kind: 'ssr', dir: 0 }];
  for (const c of cards) {
    const dk = lin(t, c.t0, c.t0 + 0.42); if (dk <= 0) continue; const k = eback(dk, 1.3);
    let x = CX + (c.x - CX) * k, y = 1500 - (1500 - Y0) * k, rot = (1 - k) * (c.dir || 0.4) * 0.7, s = 1, al = 1;
    const ssr = c.kind === 'ssr', fd = ssr ? 0.26 : 0.2, fk = lin(t, c.flip, c.flip + fd);
    if (ssr) {
      if (after >= 0) { const up = eback(lin(after, 0, 0.32), 1.8); s = 1 + 0.2 * up + (860 / CH - 1.2) * fe; x = sx; y = sy - 20 * up * (1 - fe) + Math.sin(t * 1.7) * 7 * fe; rot = -0.06 * fe + Math.sin(t * 1.3) * 0.012 * fe; }
      else if (charge > 0) { x += Math.sin(t * 60) * 7 * charge; rot += Math.sin(t * 47) * 0.035 * charge; s = 1 + 0.05 * charge; }
    } else {
      if (charge > 0 && after < 0) al = 1 - 0.45 * charge;   // 蓄力時兩張 R 卡退到暗處
      if (after >= 0) { const q = ei(lin(after, 0, 0.4)); x += c.dir * q * 1100; y -= q * 160; rot += c.dir * q * 1.6; al = 0.55 * (1 - q); }
    }
    const sq = Math.abs(Math.cos(Math.PI * fk)) || 0.001, lift = Math.sin(Math.PI * fk);
    ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y - lift * 30); ctx.rotate(rot); ctx.scale(s * sq * (1 + lift * 0.06), s * (1 + lift * 0.06));
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 16 + lift * 20;
    if (fk < 0.5) { const bw = CARD_BACK.width * CH / CARD_BACK.height; ctx.drawImage(CARD_BACK, -bw / 2, -CH / 2, bw, CH); }
    else {
      ctx.shadowColor = 'transparent'; const r = cardFace(ctx, ssr ? 'ssr' : 'r', CH, t, c.kind);
      if (ssr && r) { ctx.globalAlpha = al * lin(after, 0.3, 0.5); ctx.font = `900 ${Math.round(CH * 0.06)}px 'Noto Sans TC'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a3000'; ctx.fillText(P.name, 0, r.plateY, r.w * 0.56); }
    }
    ctx.restore();
    if (!ssr) sparkBurst(ctx, x, y, (t - c.flip) * 1.4, 10, 0.8, '#cfe8ff');
  }
  if (after >= 0) {
    ringBurst(ctx, CX, Y0, after, { r1: 1500, dur: 0.45 }); sparkBurst(ctx, CX, Y0 - 40, after, 22, 2.2, '#fff6c0');
    sparkleField(ctx, t, 26, sx - 420, sy - 480, sx + 420, sy + 480, Math.min(1, after * 3));
    if (t >= TT) { shardsV2(ctx, 1340, 370, t - TT); ringBurst(ctx, 1340, 370, t - TT, { r1: 1100 }); }
    heroTitle(ctx, t, 1340, 370, lin(t, TT, TT + 0.18), { maxW: 980, pk });
    plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 1350, 650, 1.0);
  }
  ctx.restore();
  if (after >= 0) confetti(ctx, t, F3 + 0.05, 60, ['#ffe27a', '#ff9ad0', '#8fd8ff', '#ffffff', '#c8a0ff'], 11);
  if (after >= 0) flash(ctx, (1 - lin(after, 0, 0.16)) * 0.6, '#fff3c0');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.25, '#eaffc0');
}
function v2Cards(ctx, t) { if (!CARD_BACK) return; runV2(ctx, t, { T: 1e9, exitKind: 'slice', pre: v2CardsScene }); }

// ---------------- 中量 2：小彈珠台 ----------------
function pinBoardV2(ctx, t, bx, by, bh) {   // 只畫盤面、球、燈、派彩（盤面座標照圖量），回傳入賞口的畫面座標
  const T = PIN_T, HIT = T.hit, s = bh / PIN_BOARD.height, bw = PIN_BOARD.width * s, t5 = T.first + (PIN_HITS.length - 1) * T.step, reach = t > t5 && t < HIT;
  const toS = (p) => [bx - bw / 2 + p[0] * s, by - bh / 2 + p[1] * s], [px, py] = toS(PIN_POCKET), BR = 18 * s;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; ctx.drawImage(PIN_BOARD, bx - bw / 2, by - bh / 2, bw, bh); ctx.restore();
  for (let i = 0; i < PIN_HITS.length; i++) {   // 撞釘：釘子亮一下＋白圈擴散
    const l = t - (T.first + i * T.step); if (l < 0 || l > 0.3) continue; const p = toS([PIN_HITS[i][0], PIN_HITS[i][1] + 26]), q = l / 0.3;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 34 * s * 1.6); gg.addColorStop(0, `rgba(255,250,210,${0.95 * (1 - q)})`); gg.addColorStop(1, 'rgba(255,230,120,0)'); ctx.fillStyle = gg; ctx.fillRect(p[0] - 80, p[1] - 80, 160, 160); ctx.restore();
    ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${1 - q})`; ctx.lineWidth = 5 * (1 - q) + 1; ctx.beginPath(); ctx.arc(p[0], p[1], (10 + 34 * eo(q)) * s * 1.3, 0, 7); ctx.stroke(); ctx.restore();
  }
  for (let i = 0; i < PIN_BULBS.length; i++) {   // 入賞口跑燈
    let on = 0; if (reach) on = Math.floor((t - t5) * 22) % PIN_BULBS.length === i ? 1 : 0.15; else if (t >= HIT) on = (Math.floor((t - HIT) * 12) + i) % 2 ? 1 : 0.45; if (!on) continue;
    const b = toS(PIN_BULBS[i]), r = 34 * s * 1.3; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], r); gg.addColorStop(0, `rgba(255,248,200,${on})`); gg.addColorStop(0.4, `rgba(255,200,120,${0.6 * on})`); gg.addColorStop(1, 'rgba(255,160,80,0)'); ctx.fillStyle = gg; ctx.fillRect(b[0] - r, b[1] - r, r * 2, r * 2); ctx.restore();
  }
  for (let k = 4; k >= 0; k--) { const bp = pinBallPos(t - k * 0.016); if (!bp) continue; const p = toS(bp); celBall(ctx, p[0], p[1], BR, k ? 0.16 * (5 - k) / 4 : 1); }
  if (t >= HIT) {
    const l = t - HIT;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(14px)'; const bm = ctx.createLinearGradient(0, py, 0, py - 760 * s); bm.addColorStop(0, `rgba(255,236,170,${0.55 * Math.min(1, l * 5) * (1 - lin(l, 1.2, 2.2))})`); bm.addColorStop(1, 'rgba(255,236,170,0)'); ctx.fillStyle = bm; ctx.fillRect(px - 70 * s, py - 760 * s, 140 * s, 760 * s); ctx.restore();
    const lip = toS([0, 724])[1], tl = toS([95, 0])[0], tr = toS([550, 0])[0];
    ctx.save(); ctx.beginPath(); ctx.rect(bx - bw, by - bh, bw * 2, lip - (by - bh)); ctx.clip();
    for (let i = 0; i < 40; i++) { const q = l - (0.05 + R(i, 3) * 1.4); if (q < 0 || q > 0.8) continue; const x = px + (R(i, 5) - 0.5) * 620 * s * q, y = py + 30 * s + (-300 * q + 1700 * q * q) * s; celBall(ctx, clamp(x, tl, tr), y, BR * 0.9); }
    ctx.restore();
    const pile = Math.min(20, Math.floor(l * 14)); for (let i = 0; i < pile; i++) celBall(ctx, tl + 20 * s + R(i, 8) * (tr - tl - 40 * s), lip - BR * 0.6 - (i > 10 ? BR * 1.4 : 0), BR * 0.9);
  }
  return [px, py, s, bw];
}
function v2PinballScene(ctx, t) {
  const T = PIN_T, HIT = T.hit, t5 = T.first + (PIN_HITS.length - 1) * T.step, app = eo(lin(t, 0, 0.3)), TF = HIT + 0.62, TT = TF + 0.3;
  const th = hitStop(t, [HIT], 0.07), l = t - HIT, fe = eio(lin(t, HIT + 0.3, TF + 0.25));
  const bh = 960, bx = mixv(CX, 500, fe), by = 548 + (1 - eback(lin(t, 0, 0.45), 1.3)) * 1100;
  const s = bh / PIN_BOARD.height, py0 = by - bh / 2 + PIN_POCKET[1] * s;
  const reachK = sstep(lin(t, t5, HIT)), z = 1.014 + 0.42 * reachK * (l < 0 ? 1 : 1 - eo(lin(l, 0.08, 0.5))) + (l >= 0 ? Math.exp(-l * 9) * 0.06 : 0);
  const pk = decay(t, [[HIT, 1], [TT, 0.8]], 10);
  ctx.save(); camV2(ctx, bx, mixv(by, py0 - 60, reachK * (l < 0 ? 1 : 1 - eo(lin(l, 0.08, 0.5)))), z); shakeAt(ctx, t, pk * 18);
  dimBG(ctx, app, [bx, by, 900, t >= HIT ? 'rgba(255,210,90,0.32)' : 'rgba(90,220,255,0.2)']);
  if (t >= HIT) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, bx, py0, 18, `rgba(255,190,50,${0.17 * Math.min(1, l * 4)})`, t * 0.4, 1700, 0.42, 16); ctx.restore(); }
  ctx.save(); ctx.translate(bx, by); ctx.rotate(-0.025 * fe + (t < 0.6 ? Math.sin(t * 30) * 0.01 * (1 - lin(t, 0.3, 0.6)) : 0)); ctx.translate(-bx, -by);
  const [px, py] = pinBoardV2(ctx, th, bx, by, bh);
  // 入賞後：頭像從入賞口上方彈出
  const rk = lin(l, 0.5, 0.85); if (rk > 0) { const s2 = popK(rk, 2.2), yy = py - 150 - 190 * eo(rk);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, px, yy, 14, 'rgba(255,240,170,0.28)', -t * 0.8, 260, 0.45, 6); ctx.restore();
    ctx.save(); ctx.translate(px, yy); ctx.scale(s2, s2); bustSafe(ctx, 0, 0, 128, t); ctx.restore(); }
  ctx.restore();
  if (t > t5 && l < 0) wordV2(ctx, 'チャンス!', bx + 420, py0 - 300, lin(t, t5, t5 + 0.14), { s: 0.56, fill: Math.floor(t * 12) % 2 ? '#ff3a4a' : '#ffe14a', beat: Math.sin(t * 26) * 0.03, rot: -0.1 });
  if (l >= 0 && l < 0.75) { ctx.save(); ctx.globalAlpha = 1 - lin(l, 0.55, 0.75); wordV2(ctx, '入賞!!', px + 20, py - 250, lin(l, 0, 0.14), { s: 1.05, fill: '#ffd21a', rot: -0.08 }); ctx.restore(); ringBurst(ctx, px, py, l, { r1: 1200, dur: 0.45 }); sparkBurst(ctx, px, py - 40, l, 20, 2, '#fff6c0'); }
  if (t >= TT) { shardsV2(ctx, 1350, 370, t - TT); ringBurst(ctx, 1350, 370, t - TT, { r1: 1100 }); }
  heroTitle(ctx, t, 1350, 370, lin(t, TT, TT + 0.18), { maxW: 980, pk });
  plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 1360, 650, 1.0);
  ctx.restore();
  if (l >= 0) flash(ctx, (1 - lin(l, 0, 0.14)) * 0.55, '#fff6c0');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.25, '#eaffc0');
}
function v2Pinball(ctx, t) { if (!PIN_BOARD) return; runV2(ctx, t, { T: 1e9, exitKind: 'whipL', pre: v2PinballScene }); }

// ---------------- 中量 3：衝線拍照 ----------------
const FIN2 = { ARCX: 1250, ARCB: 1010, AH: 880, GH: 800 };
function finSceneV2(ctx, t, still = false) {   // 跑道、拱門、緞帶、衝刺中的角色（世界座標）
  const { ARCX, ARCB, AH, GH } = FIN2, aw = FIN_ARCH.width * AH / FIN_ARCH.height;
  const tr = ctx.createLinearGradient(0, ARCB - 80, 0, ARCB + 80); tr.addColorStop(0, '#d2583e'); tr.addColorStop(1, '#8a2a1e');
  ctx.fillStyle = tr; ctx.beginPath(); ctx.moveTo(-900, ARCB - 36); ctx.lineTo(W + 900, ARCB - 76); ctx.lineTo(W + 900, ARCB + 200); ctx.lineTo(-900, ARCB + 200); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 5; for (const yy of [ARCB - 8, ARCB + 46]) { ctx.beginPath(); ctx.moveTo(-900, yy + 30); ctx.lineTo(W + 900, yy - 12); ctx.stroke(); }
  ctx.drawImage(FIN_ARCH, ARCX - aw / 2, ARCB - AH, aw, AH);
  const ty = ARCB - AH * 0.45, x0 = ARCX - aw * 0.31, x1 = ARCX + aw * 0.31;
  ctx.save(); ctx.strokeStyle = '#ff2a4a'; ctx.lineWidth = 11; ctx.lineCap = 'round';
  if (t < FIN_BREAK) { const tens = lin(t, FIN_BREAK - 0.12, FIN_BREAK); ctx.beginPath(); ctx.moveTo(x0, ty); ctx.quadraticCurveTo(ARCX + 60 * tens, ty + 18 + 30 * tens, x1, ty); ctx.stroke(); }
  else { const l = t - FIN_BREAK; for (const sg of [-1, 1]) { const xa = sg < 0 ? x0 : x1; ctx.beginPath(); ctx.moveTo(xa, ty);
    for (let j = 1; j <= 12; j++) { const u = j / 12; ctx.lineTo(xa + (ARCX - xa) * u * (1 - Math.min(1, l * 2.2)) + sg * u * 46 * Math.min(1, l * 3), ty + u * u * 300 * Math.min(1, l * 2.5) + Math.sin(u * 8 + l * 14) * 12 * u); } ctx.stroke(); } }
  ctx.restore();
  const rk = lin(t, 0.4, FIN_BREAK), sm = sstep(rk), gx = -420 + (ARCX + 50 + 420) * sm + (t > FIN_BREAK ? (t - FIN_BREAK) * 160 : 0), gy = ARCB - GH / 2 + 30 - Math.abs(Math.sin(t * 24)) * 22, lean = 0.13;
  if (GIRL && rk > 0) {
    if (!still && t < FIN_BREAK + 0.1) {
      for (let k = 1; k <= 5; k++) drawImg(ctx, silC(GIRL_SIL, `hsl(${150 + k * 22},100%,70%)`), gx - k * 84, gy + k * 3, GH, lean, 0.26 * (1 - k / 6));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) { const yy = ARCB - GH + R(i, 1) * (GH - 40), len = 220 + R(i, 2) * 360; ctx.fillStyle = `rgba(255,255,255,${0.22 + R(i, 3) * 0.3})`; ctx.fillRect(gx - 300 - len - ((t * 3400 + R(i, 4) * 900) % 500), yy, len, 3 + R(i, 5) * 3); }
      ctx.restore();
    }
    ctx.save(); outlineV2(ctx, GIRL_SIL, gx, gy, GH, lean, '#22d36a', 9); outlineV2(ctx, GIRL_SIL, gx, gy, GH, lean, '#fff', 4, 10); drawImg(ctx, GIRL, gx, gy, GH, lean); ctx.restore();
    if (!still) for (let i = 0; i < 8; i++) { const l = (t * 4 + R(i, 7)) % 1; ctx.fillStyle = `rgba(255,240,220,${0.4 * (1 - l)})`; ctx.beginPath(); ctx.arc(gx - 90 - l * 220, ARCB + 24 - l * 40, 12 + l * 34, 0, 7); ctx.fill(); }
  }
}
let _finPhoto2 = null;
function v2FinishScene(ctx, t) {
  const { ARCX, ARCB, AH } = FIN2, app = eo5(lin(t, 0, 0.35));
  if (t < FIN_SNAP) {
    const th = hitStop(t, [FIN_BREAK], 0.06), pan = (1 - sstep(lin(t, 0.3, 1.42))) * 560, pk = decay(t, [[FIN_BREAK, 1]], 12);
    ctx.save(); dimBG(ctx, app, [ARCX - pan, 560, 1000, 'rgba(120,255,160,0.16)']);
    camV2(ctx, ARCX - 150, 640, 1.014 + 0.08 * sstep(lin(t, 0.9, FIN_BREAK)) + pk * 0.04); shakeAt(ctx, t, pk * 16);
    ctx.globalAlpha = app; ctx.translate(pan, (1 - app) * 320); finSceneV2(ctx, th); ctx.restore();
    const gk = lin(t, 0.14, 0.4); if (gk > 0 && t < 1.0) { ctx.save(); ctx.globalAlpha = 1 - lin(t, 0.8, 1.0); wordV2(ctx, 'GO!!', 420, 300, gk, { s: 1.35, fill: '#ff3a4a', rot: -0.1, beat: Math.sin(t * 22) * 0.02 }); ctx.restore(); }
    if (t >= FIN_BREAK) {
      for (const f of [[ARCX - 330, 400, 0.02], [ARCX + 280, 310, 0.05], [ARCX - 60, 240, 0.08]]) { const l = t - FIN_BREAK - f[2]; if (l > 0 && l < 0.1) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; star4(ctx, f[0], f[1], 150 * (1 - l / 0.1), '#fff', 1); ctx.restore(); } }
      confetti(ctx, t, FIN_BREAK - 0.2, 70, ['#ffd24a', '#ff7aa8', '#7cc8ff', '#9dff8a', '#fff'], 9);
    }
    return;
  }
  // 快門白閃 → 畫面定格縮成一張拍立得（左），標題在右
  const key = P.name + '|' + CFG.n + '|' + (GIRL ? GIRL.width : 0);
  if (!_finPhoto2 || _finPhoto2.key !== key) {
    const c = mk(), x = c.getContext('2d'), sky = x.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#4a8fe0'); sky.addColorStop(0.7, '#bfe6ff'); sky.addColorStop(1, '#fff3c8'); x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.save(); x.globalCompositeOperation = 'lighter'; godRays(x, ARCX, 300, 16, 'rgba(255,255,255,0.16)', 0.2, 1800, 0.45, 12); x.restore();
    finSceneV2(x, FIN_BREAK + 0.07, true);
    const ph = mk(900, 620), px = ph.getContext('2d'); px.drawImage(c, ARCX - 640, ARCB - 850, 1290, 889, 0, 0, 900, 620); _finPhoto2 = { key, img: ph };
  }
  const l = t - FIN_SNAP, k = eo5(lin(l, 0.06, 0.52)), TT = FIN_SNAP + 0.62, pk = decay(t, [[FIN_SNAP, 0.6], [TT, 0.8]], 11);
  const pw = mixv(1500, 760, k), phh = pw * 620 / 900, pxc = mixv(CX, 500, k), pyc = mixv(CY - 20, 520, k), pad = pw * 0.035;
  ctx.save(); camV2(ctx, CX, CY, 1.014 + pk * 0.03); shakeAt(ctx, t, pk * 12);
  dimBG(ctx, 1, [1300, 500, 1000, 'rgba(120,255,160,0.2)']);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, pxc, pyc, 16, `rgba(190,255,200,${0.1 * k})`, t * 0.3, 1600, 0.4, 16); ctx.restore();
  ctx.save(); ctx.translate(pxc, pyc + Math.sin(t * 1.8) * 6 * k); ctx.rotate(-0.07 * k + Math.sin(t * 1.3) * 0.01 * k);
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; ctx.fillStyle = '#fbfbf6'; ctx.fillRect(-pw / 2 - pad, -phh / 2 - pad, pw + pad * 2, phh + pad * 5.2); ctx.shadowColor = 'transparent';
  ctx.drawImage(_finPhoto2.img, -pw / 2, -phh / 2, pw, phh);
  ctx.font = `700 ${Math.round(pw * 0.06)}px ${HAND}`; ctx.fillStyle = '#334'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PHOTO FINISH!  ' + P.name, 0, phh / 2 + pad * 2.5, pw * 0.94);
  ctx.restore();
  sparkleField(ctx, t, 18, pxc - 480, pyc - 380, pxc + 480, pyc + 420, k);
  if (t >= TT) { shardsV2(ctx, 1420, 360, t - TT); ringBurst(ctx, 1420, 360, t - TT, { r1: 1100 }); }
  heroTitle(ctx, t, 1420, 360, lin(t, TT, TT + 0.18), { maxW: 900, pk });
  plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 1430, 640, 0.94);
  ctx.restore();
  confetti(ctx, t, FIN_BREAK - 0.2, 70, ['#ffd24a', '#ff7aa8', '#7cc8ff', '#9dff8a', '#fff'], 9);
  if (l < 0.2) flash(ctx, (1 - l / 0.2) * 0.9, '#fff');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.25, '#eaffc0');
}
function v2Finish(ctx, t) { if (!FIN_ARCH) return; runV2(ctx, t, { T: 1e9, exitKind: 'smear', pre: v2FinishScene }); }

// ---------------- 中量 4：單發煙火 ----------------
function fwBurst(ctx, x, y, q, dur, n, r, hue, seed, lw = 4) {   // 菊花型煙火：帶尾巴的光條＋末端閃粉
  if (q < 0 || q > dur) return; const p = q / dur, e = eo(p);
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + R(i, seed) * 0.12, rr = e * r * (0.82 + R(i, seed + 1) * 0.3), xx = x + Math.cos(a) * rr, yy = y + Math.sin(a) * rr + 150 * p * p, tl = (1 - p) * r * 0.22 + 10;
    ctx.strokeStyle = `hsla(${(hue + R(i, seed + 2) * 40) % 360},100%,${72 + 18 * (1 - p)}%,${1 - p * p})`; ctx.lineWidth = lw * (1 - p * 0.6); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - Math.cos(a) * tl, yy - Math.sin(a) * tl - 20 * p); ctx.stroke();
    if (p > 0.45 && (i + Math.floor(q * 30)) % 3 === 0) { ctx.fillStyle = `rgba(255,250,220,${(1 - p) * 0.9})`; ctx.beginPath(); ctx.arc(xx + (R(i, seed + 3) - 0.5) * 16, yy + (R(i, seed + 4) - 0.5) * 16, 2.4, 0, 7); ctx.fill(); } }
}
function v2FireworkScene(ctx, t) {
  const D = CFG.dur, BURST = 1.0, l = t - BURST, app = eo(lin(t, 0, 0.35)), TX = 1070, TY = 372, TT = BURST + 0.62;
  const pts = textPoints('×' + CFG.n, "300px 'Dela Gothic One'", 6), mx = pts.reduce((a, p) => Math.max(a, Math.abs(p[0])), 1), SC = Math.min(1.42, 560 / mx), wide = mx * SC > 520;   // 位數多就縮小，標籤移到上面
  const pk = decay(t, [[BURST, 1], [TT, 0.7], [1.8, 0.3], [2.25, 0.3], [2.7, 0.3]], 9);
  ctx.save(); camV2(ctx, CX, 420, 1.014 + pk * 0.035 + lin(t, 0.25, BURST) * 0.03); shakeAt(ctx, t, pk * 14);
  ctx.save(); ctx.globalAlpha = app; const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, 'rgba(6,5,30,0.9)'); sky.addColorStop(0.75, 'rgba(14,10,46,0.78)'); sky.addColorStop(1, 'rgba(30,14,60,0.6)'); ctx.fillStyle = sky; ctx.fillRect(-80, -80, W + 160, H + 160);
  for (let i = 0; i < 90; i++) { const tw = 0.5 + 0.5 * Math.sin(t * (2 + R(i, 3) * 4) + i); ctx.fillStyle = `rgba(255,255,255,${0.55 * tw})`; ctx.beginPath(); ctx.arc(R(i, 1) * W, R(i, 2) * 760, 1 + R(i, 4) * 1.8, 0, 7); ctx.fill(); }
  ctx.restore();
  if (l >= 0) { const a = Math.exp(-l * 2.2); ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(TX, TY, 0, TX, TY, 1300); gr.addColorStop(0, `rgba(255,190,90,${0.42 * a})`); gr.addColorStop(0.35, `rgba(255,120,60,${0.16 * a})`); gr.addColorStop(1, 'rgba(120,40,80,0)'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (t < BURST) {   // 升空：咻一聲上去，尾巴搖晃
    const k = eo(lin(t, 0.22, BURST)), y = 1160 - (1160 - TY) * k, x = TX + Math.sin(t * 11) * 9 * (1 - k);
    for (let i = 0; i < 60; i++) { const t2 = t - i * 0.01; if (t2 < 0.22) break; const kk = eo(lin(t2, 0.22, BURST)); ctx.fillStyle = `rgba(255,${190 + R(i, 1) * 60 | 0},120,${(1 - i / 60) * 0.85})`; ctx.beginPath(); ctx.arc(TX + Math.sin(t2 * 11) * 9 * (1 - kk) + (R(i, 2) - 0.5) * 14 * (i / 60), 1160 - (1160 - TY) * kk + R(i, 7) * 12, 6 * (1 - i / 60) + 1, 0, 7); ctx.fill(); }
    star4(ctx, x, y, 34 + Math.sin(t * 50) * 8, '#fff8d0', 1);
  } else {
    fwBurst(ctx, TX, TY, l, 1.5, 96, 760, 38, 11, 6); fwBurst(ctx, TX, TY, l - 0.06, 1.3, 60, 430, 330, 17, 4);
    for (const [bt, bx, by, hue, r] of [[1.8, 330, 250, 320, 300], [2.25, 1640, 300, 190, 320], [2.7, 520, 190, 120, 260], [3.1, 1500, 210, 50, 280]]) fwBurst(ctx, bx, by, t - bt, 1.2, 64, r, hue, bt * 10, 4);
    // 粒子排成「×N」
    for (let i = 0; i < pts.length; i++) { const [px, py] = pts[i], k = eo5(lin(l, 0.04 + R(i, 21) * 0.16, 0.5 + R(i, 21) * 0.16)); if (k <= 0) continue;
      const a0 = R(i, 24) * Math.PI * 2, sx = TX + px * SC * k + (1 - k) * Math.cos(a0) * 520, sy = TY + py * SC * k + (1 - k) * Math.sin(a0) * 520;
      const tw = 0.62 + 0.38 * Math.sin(t * 14 + i * 1.7), al = Math.min(1, k * 1.6) * tw, hue = 42 + 16 * Math.sin(i * 0.05 + t * 2);
      ctx.fillStyle = `hsla(${hue},100%,${56 + 20 * tw}%,${al})`; ctx.beginPath(); ctx.arc(sx, sy, 6.2, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,252,230,${al * 0.85})`; ctx.beginPath(); ctx.arc(sx, sy, 2.4, 0, 7); ctx.fill();
      if ((i + Math.floor(t * 20)) % 23 === 0) { const d = ((t * 1.3 + R(i, 25)) % 1); ctx.fillStyle = `rgba(255,236,170,${0.7 * (1 - d)})`; ctx.beginPath(); ctx.arc(sx + (R(i, 26) - 0.5) * 20, sy + d * 150, 2.2, 0, 7); ctx.fill(); } }   // 往下飄的火星
    star4(ctx, TX, TY, 520 * Math.exp(-l * 7), '#fff', Math.min(1, Math.exp(-l * 5) * 1.4));
  }
  ctx.restore();
  if (l >= 0) {
    ringBurst(ctx, TX, TY, l, { r1: 1500, dur: 0.5, sq: 1 });
    wordV2(ctx, LX('gift'), 420, wide ? 168 : 300, lin(t, TT, TT + 0.16), { s: wide ? 1.0 : 1.45, maxW: 520, fill: palFill(ctx, -70, 70, t, PAL.green), rot: -0.08, stroke: '#063a1a' });
    if (t >= TT) ringBurst(ctx, 420, wide ? 168 : 300, t - TT, { r1: 800 });
    const bk = lin(t, TT + 0.2, TT + 0.5); if (bk > 0) { ctx.save(); ctx.translate(318, 742); const s = popK(bk, 2.2); ctx.scale(s, s); bustSafe(ctx, 0, 0, 122, t); ctx.restore(); }
    plateV2(ctx, t, eo(lin(t, TT + 0.3, TT + 0.5)), 1000, 750, 1.08);
  }
  ctx.restore();
  if (l >= 0) flash(ctx, (1 - lin(l, 0, 0.18)) * 0.6, '#fff3d0');
  if (t >= TT) flash(ctx, (1 - lin(t, TT, TT + 0.1)) * 0.22, '#eaffc0');
}
function v2Firework(ctx, t) { runV2(ctx, t, { T: 1e9, exitKind: 'crt', pre: v2FireworkScene }); }

VARS.g5[1] = { name: '抽卡翻牌', fn: v2Cards, dur: 4.8 };
VARS.g5[2] = { name: '小彈珠台', fn: v2Pinball, dur: 4.8 };
VARS.g5[3] = { name: '衝線拍照', fn: v2Finish, dur: 4.6 };
VARS.g5[4] = { name: '單發煙火', fn: v2Firework, dur: 4.6 };

// ======================= V2 超大（g50）：保留變化＋機關合體／擲骰／流星墜落／演唱會轉播 =======================

// ---------------- 超大 1：保留變化＋機關合體 ----------------
const GM2 = { hold: 0.3, chg: [0.75, 1.25, 1.75, 2.25, 2.85], fly: 3.3, gattai: 3.85, labels: ['', 'チャンス', 'チャンス!', '激アツ!!', '超激アツ!!', '虹保留!!!'], bgc: ['#2a2a4a', '#123a7a', '#0e5a2e', '#7a0a1e', '#7a4a00', '#5a1a7a'] };
function crestV2(ctx, cx, cy, cw, e = 1) {   // e：四塊合體進度（0 = 在畫面外）
  const ch = cw * CREST.height / CREST.width;
  for (const [sx, sy, sw, sh, dx, dy] of [[0, 0, 0.34, 1, -1300, 0], [0.66, 0, 0.34, 1, 1300, 0], [0.34, 0, 0.32, 0.5, 0, -900], [0.34, 0.5, 0.32, 0.5, 0, 900]])
    ctx.drawImage(CREST, sx * CREST.width, sy * CREST.height, sw * CREST.width, sh * CREST.height, cx - cw / 2 + sx * cw + dx * (1 - e), cy - ch / 2 + sy * ch + dy * (1 - e), sw * cw + 1, sh * ch + 1);
}
function v2GimmickPre(ctx, t) {
  const T = GM2, app = eo(lin(t, 0, 0.3)); let lv = 0; for (const c of T.chg) if (t >= c) lv++;
  const lc = lv ? T.chg[lv - 1] : -9, q = t - lc, hits = T.chg.map((c, i) => [c, 0.45 + i * 0.14]), pk = decay(t, hits, 10), fly = lin(t, T.fly, T.gattai);
  ctx.save(); camV2(ctx, 960, 560, 1.014 + pk * 0.06 + lv * 0.012); shakeAt(ctx, t, pk * 26 + lv * 1.2);
  ctx.save(); ctx.globalAlpha = app; const gr = ctx.createRadialGradient(960, 560, 0, 960, 560, 1300); gr.addColorStop(0, T.bgc[lv]); gr.addColorStop(1, '#05030c'); ctx.fillStyle = gr; ctx.fillRect(-80, -80, W + 160, H + 160);
  if (lv >= 2) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + lv * 0.09; speedLines(ctx, 960, 560, 60, 330, lv >= 5 ? `hsla(${(t * 300) % 360},100%,70%,0.5)` : 'rgba(255,255,255,0.3)', Math.floor(t * 20), 0, 1); ctx.restore(); }
  ctx.restore();
  // 中央的大保留玉：每變一次色就脹大一圈；起飛時炸成光
  const orbA = 1 - fly;
  if (orbA > 0) {
    const r = (150 + lv * 22) * (1 + (lv && q < 0.25 ? 0.5 * Math.sin(q / 0.25 * Math.PI) : 0)) * (lv >= 5 ? 1 + 0.05 * Math.sin(t * 14) : 1) * eback(lin(t, T.hold - 0.2, T.hold + 0.2), 1.6) * (1 + fly * 2);
    ctx.save(); ctx.globalAlpha = orbA; ctx.globalCompositeOperation = 'lighter'; const gl = ctx.createRadialGradient(960, 540, r * 0.6, 960, 540, r * 2.4); gl.addColorStop(0, lv >= 5 ? `hsla(${(t * 300) % 360},100%,70%,0.6)` : HOLD_COL[Math.min(4, lv)][0] + '99'); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gl; ctx.fillRect(960 - r * 2.4, 540 - r * 2.4, r * 4.8, r * 4.8); ctx.restore();
    ctx.save(); ctx.globalAlpha = orbA; holdIcon(ctx, 960, 540 + Math.sin(t * 3) * 8, r, lv, t); ctx.restore();
    if (lv) { ringBurst(ctx, 960, 540, q, { r0: r, r1: 1100, dur: 0.4, sq: 1, w: 24 }); sparkBurst(ctx, 960, 540, q, 14 + lv * 3, 1.6 + lv * 0.4, lv >= 5 ? '#fff' : HOLD_COL[Math.min(4, lv)][0]); }
    // 下方排隊的保留（3 顆白的）
    ctx.save(); ctx.globalAlpha = orbA * app; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(700, 900, 520, 116, 58); ctx.fill(); for (let i = 0; i < 3; i++) holdIcon(ctx, 800 + i * 160, 958, 40, 0, t); ctx.restore();
  }
  // 機關四塊從四個方向撞進來
  if (t >= T.fly) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 40; crestV2(ctx, 960, 540, 1500, fly * fly); ctx.restore(); }
  ctx.restore();
  if (lv && t < T.fly) { const colr = lv >= 5 ? rainbowFill(ctx, -70, 70, t) : lv >= 3 ? '#ff3a4a' : lv === 2 ? '#5cff70' : '#8fe0ff';
    wordV2(ctx, T.labels[lv], 960, 215, lin(q, 0, 0.12), { s: 0.95 + lv * 0.13, fill: colr, rot: -0.04, beat: Math.sin(t * 22) * 0.02 * lv, stroke: lv >= 3 ? '#3a0010' : '#0a1450' }); }
  if (t >= T.fly) wordV2(ctx, '合体!!', 960, 930, lin(t, T.fly + 0.1, T.fly + 0.25), { s: 1.2, fill: '#ffd21a', rot: -0.04, stroke: '#3a1400', beat: Math.sin(t * 30) * 0.03 });
  for (const c of T.chg) if (t >= c && t < c + 0.1) flash(ctx, (1 - (t - c) / 0.1) * 0.28, '#fff');
}
function v2GimmickFin(ctx, m, t) {
  finaleV2(ctx, m, t, { lay: 'C', tGirl: 0.3, tTitle: 0.75, bgC: [960, 470], title: { y: 640 }, plate: { y: 832 }, mascot: { y: 800 },
    back: (c, mm, tt, pk) => { c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 960, 470, 16, 'rgba(255,255,255,0.22)', tt * 0.6, 1900, 0.4, 16); c.filter = 'blur(40px)'; c.fillStyle = `hsla(${(tt * 200) % 360},100%,70%,0.45)`; c.beginPath(); c.ellipse(960, 470, 700, 400, 0, 0, 7); c.fill(); c.restore();
      for (let i = 0; i < 3; i++) ringBurst(c, 960, 470, mm - i * 0.08, { r1: 1500, dur: 0.7, sq: 1, w: 26 });
      c.save(); c.shadowColor = 'rgba(40,0,60,0.5)'; c.shadowBlur = 40; crestV2(c, 960, 470 + Math.sin(tt * 1.5) * 8, 1500 * (1 + pk * 0.03 + Math.exp(-mm * 9) * 0.08)); c.restore(); coinFountain(c, mm, 0, 3.2, 160); } });
}
function v2Gimmick(ctx, t) { if (!CREST) return; runV2(ctx, t, { T: GM2.gattai, exitKind: 'smear', pre: v2GimmickPre, fin: v2GimmickFin }); }

// ---------------- 超大 2：擲骰（ゾロ目） ----------------
// ---------- 立體骰子（正交投影）：三個可見面、照實際朝向畫點數；平塗兩階明暗＋深色描線 ----------
const m3mul = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
const m3v = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const rotX3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const DIE_VIEW = m3mul(rotX3(0.62), rotY3(-0.5));   // 鏡頭：往下看 35 度、偏一點側面，同時看得到上、前、右三面
const DIE_FACES = [   // 法線、面上的兩個軸、點數（對面相加為 7）：上 6、下 1、左 5、右 2、前 3、後 4
  [[0, 1, 0], [1, 0, 0], [0, 0, 1], 6], [[0, -1, 0], [1, 0, 0], [0, 0, -1], 1], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], 5],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0], 2], [[0, 0, 1], [1, 0, 0], [0, 1, 0], 3], [[0, 0, -1], [-1, 0, 0], [0, 1, 0], 4]];
function dieRest(M) { let lo = 1e9; for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) lo = Math.min(lo, m3v(M, [sx, sy, sz])[1]); return -lo; }   // 目前朝向下，骰子中心離桌面的高度（邊長為 1）
function die3D(ctx, x, y, s, M, o = {}) {   // (x,y) = 桌面上的接觸點；o.px 中心的水平位移（邊長倍數）、o.lift 離桌高度（像素）、o.glow
  const h = dieRest(M), P = m3v(DIE_VIEW, [o.px || 0, h, 0]), cx = x + P[0] * s, cy = y - P[1] * s - (o.lift || 0);
  const sh = m3v(DIE_VIEW, [o.px || 0, 0, 0]), ls = 1 / (1 + (o.lift || 0) / 500);
  ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.32 * ls})`; ctx.beginPath(); ctx.ellipse(x + sh[0] * s, y - sh[1] * s + s * 0.06, s * 0.78 * ls, s * 0.4 * ls, 0, 0, 7); ctx.fill(); ctx.restore();
  const VM = m3mul(DIE_VIEW, M);
  ctx.save(); ctx.translate(cx, cy); ctx.lineJoin = 'round';
  if (o.glow > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(30px)'; ctx.fillStyle = `rgba(255,220,120,${o.glow})`; ctx.beginPath(); ctx.arc(0, 0, s * 0.95, 0, 7); ctx.fill(); ctx.restore(); }
  // 深色底（八個頂點的外框），圓角之間的縫才不會透出背景
  const pts = []; for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) { const p = m3v(VM, [sx, sy, sz]); pts.push([p[0] * s, -p[1] * s]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o2, a, b) => (a[0] - o2[0]) * (b[1] - o2[1]) - (a[1] - o2[1]) * (b[0] - o2[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  ctx.fillStyle = '#2b1a3a'; ctx.strokeStyle = '#2b1a3a'; ctx.lineWidth = s * 0.05; ctx.beginPath(); hull.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const [n, u, v, num] of DIE_FACES) {
    const nv = m3v(VM, n); if (nv[2] <= 0.015) continue;   // 背對鏡頭的面不畫
    const C = m3v(VM, [n[0] * 0.5, n[1] * 0.5, n[2] * 0.5]), U = m3v(VM, u), Vv = m3v(VM, v), wn = m3v(M, n);
    const lit = wn[1] * 0.75 + wn[2] * 0.45 - wn[0] * 0.3;   // 光從左上前方來
    ctx.save(); ctx.transform(U[0] * s, -U[1] * s, Vv[0] * s, -Vv[1] * s, C[0] * s, -C[1] * s);
    ctx.fillStyle = lit > 0.55 ? '#ffffff' : lit > 0.1 ? '#e6def2' : '#c4b8d8'; ctx.beginPath(); ctx.roundRect(-0.47, -0.47, 0.94, 0.94, 0.13); ctx.fill();
    const pc = num === 1 ? '#e8183a' : '#2b1a3a', pr = num === 1 ? 0.14 : 0.088; ctx.fillStyle = pc;
    for (const [px, py] of DICE_PIPS[num]) { ctx.beginPath(); ctx.arc(px * 0.27, -py * 0.27, pr, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  ctx.restore();
}

function v2DicePre(ctx, t) {
  const T = DI_T, app = eo(lin(t, 0, 0.3)), won = t >= T.settle, l = t - T.settle, th = hitStop(t, [T.settle], 0.07);
  const zk = sstep(lin(t, T.land2 + 0.15, T.teeter)) * (won ? 1 - eo(lin(l, 0.02, 0.3)) : 1), pk = decay(t, [[T.land1, 0.5], [T.land2, 0.5], [T.settle, 1]], 10);
  ctx.save(); camV2(ctx, mixv(960, 1290, zk), mixv(540, 620, zk), 1.014 + 0.5 * zk + pk * 0.05); shakeAt(ctx, t, pk * 24 + (t > T.land2 && !won ? 3 : 0));
  ctx.save(); ctx.globalAlpha = app;
  if (!won) { const gg = ctx.createRadialGradient(960, 640, 0, 960, 640, 1200); gg.addColorStop(0, '#229a64'); gg.addColorStop(1, '#052a1c'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160);
    ctx.strokeStyle = '#d8a83a'; ctx.lineWidth = 16; ctx.strokeRect(54, 54, W - 108, H - 108); ctx.strokeStyle = 'rgba(255,230,160,0.35)'; ctx.lineWidth = 4; ctx.strokeRect(80, 80, W - 160, H - 160);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const sp = ctx.createRadialGradient(960, 640, 0, 960, 640, 700); sp.addColorStop(0, 'rgba(255,255,220,0.16)'); sp.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sp; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  else { rainbowBG2(ctx, t * 2.2, 960, 600); ctx.save(); ctx.globalCompositeOperation = 'lighter'; godRays(ctx, 960, 600, 16, 'rgba(255,255,255,0.2)', t * 0.5, 1900, 0.4, 16); ctx.restore(); }
  ctx.restore();
  const s = 236, TY = 700;
  {   // 左骰：翻滾落下，停在 6
    const u = lin(th, T.drop, T.land1), e = eo(u), x = mixv(180, 700, e), lift = Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 430 + (1 - u) * 300;
    const M = u < 1 ? m3mul(rotX3((1 - e) * 13), rotZ3((1 - e) * -9)) : rotY3(0);
    die3D(ctx, x, TY, s, M, { lift: lift + (won ? 40 * eo(lin(l, 0, 0.4)) + Math.sin(t * 5) * 8 : 0), glow: won ? 0.5 + 0.25 * Math.sin(t * 8) : 0 });
    if (t >= T.land1) sparkBurst(ctx, 700, TY - 60, t - T.land1, 12, 1.4, '#fff6c0');
  }
  {   // 右骰：落在 5 和 6 之間的稜上，搖了幾下才倒向 6（以著地的那條稜為支點）
    const u = lin(th, T.drop, T.land2), e = eo(u), E = -Math.PI / 4; let a = E, lift = 0, x = 1330;
    if (u < 1) { lift = Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 430 + (1 - u) * 300; x = mixv(1900, 1330, e); }
    else if (th < T.teeter) { const k = lin(th, T.land2, T.teeter); a = E - 0.3 * Math.sin(k * Math.PI * 3.5) * (1 - 0.35 * k) - 0.06 * Math.sin(th * 21) * k; }   // 往 5 那邊晃得比較多
    else { const q = lin(th, T.teeter, T.settle); a = E * (1 - eo5(q)) + 0.07 * Math.sin(q * Math.PI) * (1 - q); }
    const M = u < 1 ? m3mul(m3mul(rotX3((1 - e) * -12), rotY3((1 - e) * 5)), rotZ3(E)) : rotZ3(a);
    const px = u < 1 ? 0 : -(0.5 * Math.cos(a) + 0.5 * Math.sin(a));   // 支點固定在桌面，中心跟著移動
    die3D(ctx, x, TY, s, M, { px, lift: lift + (won ? 40 * eo(lin(l, 0, 0.4)) + Math.sin(t * 5 + 1) * 8 : 0), glow: won ? 0.5 + 0.25 * Math.sin(t * 8) : 0 });
    if (t >= T.land2) sparkBurst(ctx, 1330, TY - 60, t - T.land2, 12, 1.4, '#fff6c0');
  }
  if (won) { ringBurst(ctx, 1000, 620, l, { r1: 1500, dur: 0.45 }); coinFountain(ctx, t, T.settle, T.settle + 1.2, 80); }
  ctx.restore();
  if (t > T.land2 + 0.1 && !won) wordV2(ctx, 'あと一歩…!?', 560, 230, lin(t, T.land2 + 0.1, T.land2 + 0.24), { s: 0.95, fill: Math.floor(t * 8) % 2 ? '#ff3a4a' : '#ffe14a', rot: -0.06, stroke: '#2a0010', beat: Math.sin(t * 24) * 0.03 });
  if (won) { wordV2(ctx, 'ゾロ目!!', 960, 250, lin(l, 0, 0.16), { s: 1.8, big: 3, fill: rainbowFill(ctx, -70, 70, t), rot: -0.07, beat: Math.sin(t * 20) * 0.02, depth: 12 }); flash(ctx, (1 - lin(l, 0, 0.18)) * 0.8, '#fff'); }
}
function v2DiceFin(ctx, m, t) {   // 結尾：巨大數字（兩顆 6 在數字兩旁）
  finaleV2(ctx, m, t, { style: 'count', mascot: false,
    front: (c, mm, tt, pk) => { const k = eo5(lin(mm, 0.75, 1.15)); if (k <= 0) return;
      [[985, 905, 0.35, 0], [1660, 905, -0.3, 1]].forEach(([x, y, yaw, i]) => die3D(c, x, y, 118, m3mul(rotY3(yaw + (1 - k) * 4), rotX3((1 - k) * 6)), { lift: (1 - k) * 500 + Math.abs(Math.sin(tt * 4 + i)) * 10, glow: 0.4 + 0.25 * Math.sin(tt * 8) })); },
    back: (c, mm) => coinFountain(c, mm, 0, 3.4, 170) });
}
function v2Dice(ctx, t) { runV2(ctx, t, { T: DI_T.settle + 0.95, exitKind: 'slice', pre: v2DicePre, fin: v2DiceFin }); }

// ---------------- 超大 3：流星墜落 ----------------
function hillsV2(ctx, col, y0 = 880) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-80, H + 80); ctx.lineTo(-80, y0 + 20); for (let x = -80; x <= W + 80; x += 80) ctx.lineTo(x, y0 + Math.sin(x * 0.006) * 46 + Math.sin(x * 0.017) * 22); ctx.lineTo(W + 80, H + 80); ctx.fill(); }
function v2MeteorPre(ctx, t) {
  const T = MT_T, app = eo(lin(t, 0, 0.3)), crashed = t >= T.crash, l = t - T.crash, u = lin(t, T.appear, T.crash), e = u * u;
  const pk = crashed ? Math.exp(-l * 4) : u * 0.3;
  ctx.save(); camV2(ctx, 960, 620, 1.02 + pk * 0.05 + (crashed ? 0 : 0.05 * e)); shakeAt(ctx, t, pk * 40);
  ctx.save(); ctx.globalAlpha = app;
  if (!crashed) { const gg = ctx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#0a0828'); gg.addColorStop(1, `rgb(${60 + 150 * u | 0},${30 + 20 * u | 0},70)`); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160); }
  else rainbowBG2(ctx, t * 2.2, 960, 820);
  for (let i = 0; i < 130; i++) { const tw = 0.6 + 0.4 * Math.sin(t * 4 + i); if (i % 10 === 0) star4(ctx, R(i, 1) * W, R(i, 2) * 760, 10 + 10 * tw, '#fff', 0.8 * tw); else { ctx.fillStyle = `rgba(255,255,240,${0.3 + 0.6 * R(i, 3) * tw})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * 760, 3, 3); } }
  for (let i = 0; i < 9; i++) { const st = 0.15 + i * 0.3, q = (t - st) / 0.5; if (q < 0 || q > 1 || st > T.crash) continue; const x = 200 + R(i, 4) * 1500 + 700 * q, y = 60 + R(i, 5) * 320 + 340 * q;   // 小流星
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gg = ctx.createLinearGradient(x - 300, y - 150, x, y); gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(1, `rgba(255,250,220,${1 - q})`); ctx.strokeStyle = gg; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 300, y - 150); ctx.lineTo(x, y); ctx.stroke(); ctx.restore(); }
  if (!crashed && u > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gl = ctx.createRadialGradient(960, 900, 0, 960, 900, 1100); gl.addColorStop(0, `rgba(255,120,60,${0.45 * e})`); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gl; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore(); }
  hillsV2(ctx, crashed ? '#3a1a5a' : '#120822');
  ctx.restore();
  if (t > T.appear && !crashed) {   // 大流星：越來越大，拖著火尾
    const x = 1880 - 920 * e, y = -160 + 1000 * e, r = 40 + 260 * e;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(12px)';
    for (let k = 0; k < 5; k++) { const tl = r * (3 + k * 1.2), gg = ctx.createLinearGradient(x + tl * 0.7, y - tl * 0.9, x, y); gg.addColorStop(0, 'rgba(255,120,40,0)'); gg.addColorStop(1, ['rgba(255,240,180,0.9)', 'rgba(255,190,80,0.7)', 'rgba(255,120,60,0.55)', 'rgba(255,80,120,0.4)', 'rgba(200,120,255,0.3)'][k]); ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(x - r * 0.8, y - r * 0.2 + k * 6); ctx.lineTo(x + tl * 0.7, y - tl * 0.9); ctx.lineTo(x + r * 0.2, y + r * 0.8); ctx.fill(); }
    ctx.restore();
    for (let i = 0; i < 12; i++) { const q = (t * 3 + R(i, 9)) % 1; ctx.save(); ctx.globalCompositeOperation = 'lighter'; star4(ctx, x + q * r * 3 * (0.6 + R(i, 10) * 0.6) + (R(i, 11) - 0.5) * r, y - q * r * 3.6 + (R(i, 12) - 0.5) * r, (26 + r * 0.12) * (1 - q), '#fff2a8', 1 - q); ctx.restore(); }
    starShape(ctx, x, y, r, t * 6, '#ffd84a', '#7a3a00'); starShape(ctx, x - r * 0.12, y - r * 0.12, r * 0.45, t * 6, '#fff6c0');
  }
  if (crashed) {
    for (let i = 0; i < 3; i++) { const q = (l - i * 0.1) / 0.8; if (q < 0 || q > 1) continue; ctx.save(); ctx.globalAlpha = 1 - q; ctx.strokeStyle = '#fff6d0'; ctx.lineWidth = 34 * (1 - q) + 4; ctx.beginPath(); ctx.ellipse(960, 860, 100 + 1500 * eo(q), 40 + 420 * eo(q), 0, 0, 7); ctx.stroke(); ctx.restore(); }
    lightPillar(ctx, 960, 880, 620 + l * 200, Math.min(1, l * 4));
  }
  ctx.restore();
  if (u > 0.4 && !crashed) {   // 警告：上下黃黑警示帶＋紅色大字
    const a = eo(lin(u, 0.4, 0.5)); hazard(ctx, -70 + 70 * a, 70, t * 300); hazard(ctx, H - 70 * a, 70, -t * 300);
    ctx.save(); ctx.globalAlpha = 0.14 * a * (Math.floor(t * 8) % 2); ctx.fillStyle = '#ff2a3a'; ctx.fillRect(0, 0, W, H); ctx.restore();
    wordV2(ctx, 'WARNING!!', 720, 300, lin(u, 0.4, 0.48), { s: 1.1, fill: Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a', rot: -0.06, stroke: '#1a0008', beat: Math.sin(t * 30) * 0.03 });
  }
  if (crashed) flash(ctx, (1 - lin(l, 0, 0.3)) * 0.9, '#fff');
}
function v2MeteorFin(ctx, m, t) {
  finaleV2(ctx, m, t, { style: 'vertical', tGirl: 0.02, tTitle: 0.5, girl: { x: 1400, from: 'below' }, bgC: [1400, 520],   // 結尾：直書大字
    back: (c, mm, tt, pk) => { const k = eback(lin(mm, 0, 0.45), 1.5);
      for (let i = 0; i < 46; i++) { const q = ((tt * 0.55 + R(i, 6)) % 1); starShape(c, R(i, 7) * W, -80 + q * 1300, 16 + R(i, 8) * 20, q * 6 + i, `hsl(${(i * 37) % 360},90%,75%)`, '#3a1a5a'); }   // 星星雨
      c.save(); c.shadowColor = 'rgba(255,240,170,0.9)'; c.shadowBlur = 60; starShape(c, 1400, 540, 640 * k * (1 + pk * 0.03), tt * 0.25, 'rgba(255,240,170,0.95)', '#c87a00'); c.restore();
      c.save(); c.globalCompositeOperation = 'lighter'; godRays(c, 1400, 540, 10, 'rgba(255,255,255,0.2)', -tt * 0.3, 1900, 0.3, 16); c.restore(); } });
}
function v2Meteor(ctx, t) { runV2(ctx, t, { T: MT_T.crash + 0.5, cutA: 0.6, exitKind: 'crt', pre: v2MeteorPre, fin: v2MeteorFin }); }

// ---------------- 超大 4：演唱會轉播 ----------------
function lasersV2(ctx, t, n = 9, a = 0.5) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < n; i++) { const ang = Math.PI / 2 + Math.sin(t * 2 + i) * 0.7, x = 120 + i * (W - 240) / (n - 1); ctx.strokeStyle = `hsla(${(i * 45 + t * 60) % 360},100%,65%,${a})`; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x + Math.cos(ang) * 1600, 40 + Math.sin(ang) * 1600); ctx.stroke(); } ctx.restore(); }
function crowdV2(ctx, t, y0, sc = 1, rows = 1) {   // 觀眾剪影＋螢光棒；y0 = 頭頂大約高度
  for (let rw = rows - 1; rw >= 0; rw--) { const n = Math.round(30 / sc) + rw * 3;
    for (let i = 0; i < n; i++) { const x = (i + 0.5 + (rw % 2) * 0.5) * W / n + (R(i, 1 + rw) - 0.5) * 30, y = y0 - rw * 90 * sc + R(i, 2 + rw) * 50 * sc, hr = (42 + R(i, 3) * 10) * sc, wave = Math.sin(t * 7 + i * 0.6 + rw) * 0.5, hue = [330, 200, 50, 280][Math.floor(t * 1.5 + i + rw) % 4];
      ctx.save(); ctx.translate(x + 44 * sc, y + 10 * sc); ctx.rotate(wave); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(4px)'; ctx.fillStyle = `hsl(${hue},100%,65%)`; ctx.fillRect(-8 * sc, -150 * sc, 16 * sc, 150 * sc); ctx.restore();
      ctx.fillStyle = rw ? '#150826' : '#0a0414'; ctx.beginPath(); ctx.arc(x, y + hr, hr, 0, 7); ctx.fill(); ctx.fillRect(x - hr * 1.3, y + hr * 1.6, hr * 2.6, 400); } }
}
function fireJets(ctx, xs, y, k) { if (k <= 0) return; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(8px)'; for (const x of xs) for (const [col, w] of [['rgba(255,80,30,0.8)', 80], ['rgba(255,200,60,0.9)', 46], ['rgba(255,255,220,0.9)', 20]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.4, y - 560 * k, x, y - 700 * k); ctx.quadraticCurveTo(x + w * 0.4, y - 560 * k, x + w, y); ctx.fill(); } ctx.restore(); }
function stageWide(ctx, t) {   // 全景：大螢幕（臉部特寫）、舞台、角色、觀眾
  const gg = ctx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#120828'); gg.addColorStop(1, '#3a0a4a'); ctx.fillStyle = gg; ctx.fillRect(-80, -80, W + 160, H + 160); lasersV2(ctx, t);
  ctx.fillStyle = '#05030c'; ctx.fillRect(380, 70, 1160, 600); ctx.save(); ctx.beginPath(); ctx.rect(398, 88, 1124, 564); ctx.clip();
  ctx.fillStyle = '#ffd6f0'; ctx.fillRect(398, 88, 1124, 564); if (GIRL) { const gh = 2300, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, 960 - FACE.x * gw, 300 - FACE.y * gh, gw, gh); }
  ctx.fillStyle = 'rgba(0,0,0,0.16)'; for (let y = 88; y < 652; y += 6) ctx.fillRect(398, y, 1124, 2); ctx.restore(); ctx.strokeStyle = '#6a5a8a'; ctx.lineWidth = 7; ctx.strokeRect(380, 70, 1160, 600);
  ctx.fillStyle = '#2a1640'; ctx.fillRect(-80, 800, W + 160, 400); ctx.fillStyle = '#ff5ab0'; ctx.fillRect(-80, 800, W + 160, 9);
  if (GIRL) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(20px)'; ctx.fillStyle = 'rgba(255,240,200,0.35)'; ctx.beginPath(); ctx.moveTo(900, 60); ctx.lineTo(1020, 60); ctx.lineTo(1180, 810); ctx.lineTo(740, 810); ctx.fill(); ctx.restore(); outlineV2(ctx, GIRL_SIL, 960, 640, 340, 0, '#fff', 4); drawImg(ctx, GIRL, 960, 640, 340, 0); }
  crowdV2(ctx, t, 930, 1, 2);
}
function v2ConcertPre(ctx, t) {
  const T = CO_T, app = eo(lin(t, 0, 0.3));
  ctx.save(); ctx.globalAlpha = app;
  if (t < T.cut1) { ctx.save(); camV2(ctx, 960, 560, 1.02 + 0.06 * (t / T.cut1)); stageWide(ctx, t); ctx.restore(); broadcastUI(ctx, t, 'CAM 1  WIDE'); }
  else if (t < T.cut2) {   // 臉部特寫＋字幕條
    const l = t - T.cut1, z = 1 + 0.08 * l; rainbowBG2(ctx, t * 2.2, 960, 540); ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(0, 0, W, H);
    if (GIRL) { const gh = 2700 * z, gw = GIRL.width * gh / GIRL.height; ctx.drawImage(GIRL, 1100 - FACE.x * gw, 500 - FACE.y * gh, gw, gh); }
    broadcastUI(ctx, t, 'CAM 3  CLOSE-UP');
    const k = eo5(lin(l, 0.12, 0.38)); ctx.save(); ctx.translate(-1100 * (1 - k), 0); ctx.fillStyle = 'rgba(200,16,60,0.94)'; ctx.fillRect(0, 780, 1060, 170); ctx.fillStyle = '#fff'; ctx.fillRect(0, 780, 1060, 8); ctx.fillStyle = '#ffe14a'; ctx.fillRect(0, 942, 1060, 8);
    inkText(ctx, 'SPECIAL THANKS', 520, 826, 46, '#ffe08a', '#5a0018'); inkText(ctx, P.name, 520, 896, 72, '#ffffff', '#5a0018'); ctx.restore();
  } else {   // 觀眾席：螢光棒海
    const l = t - T.cut2, gg = ctx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#2a0a4a'); gg.addColorStop(1, '#0a0418'); ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H); lasersV2(ctx, t, 7, 0.35);
    ctx.save(); camV2(ctx, 960, 700, 1 + 0.06 * l); crowdV2(ctx, t * 1.4, 620, 1.9, 3); ctx.restore(); broadcastUI(ctx, t, 'CAM 5  AUDIENCE');
    wordV2(ctx, 'アンコール!!', 960, 250, lin(l, 0.05, 0.2), { s: 1.5, fill: '#ff3a8c', rot: -0.05, stroke: '#2a0030', beat: Math.sin(t * 16) * 0.03 });
  }
  ctx.restore();
  for (const ct of [T.cut1, T.cut2]) if (t >= ct && t < ct + 0.08) flash(ctx, (1 - (t - ct) / 0.08) * 0.6, '#fff');
}
function v2ConcertFin(ctx, m, t) {
  finaleV2(ctx, m, t, { style: 'lower', tag: 'LIVE', ticker: false, led: false, tTitle: 0.38, safe: { top: 70, bot: 972 }, title: { y: 290 },   // 結尾：轉播字幕條
    bg: (c) => { const gg = c.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, '#1a0a3a'); gg.addColorStop(1, '#5a1070'); c.fillStyle = gg; c.fillRect(-80, -80, W + 160, H + 160); c.save(); c.globalAlpha = 0.55; rainbowBG2(c, t * 2.2, 1400, 420); c.restore(); lasersV2(c, t, 9, 0.45); },
    back: (c, mm, tt) => { fireJets(c, [150, 620, 1090, 1790], 1080, Math.max(0, Math.sin(Math.PI * lin(mm, 0.05, 1.1)))); fireworksAt(c, tt, [[CO_T.cut3 + 0.15, 300, 200, 30], [CO_T.cut3 + 0.45, 900, 150, 200], [CO_T.cut3 + 0.9, 560, 420, 300], [CO_T.cut3 + 1.4, 240, 380, 120], [CO_T.cut3 + 1.9, 820, 260, 60]]); },
    front: (c, mm, tt) => { crowdV2(c, tt, 985, 0.9, 1); } });
  broadcastUI(ctx, t, 'CAM 1  WIDE');
}
function v2Concert(ctx, t) { runV2(ctx, t, { T: CO_T.cut3, cutA: 0.6, exitKind: 'whipR', pre: v2ConcertPre, fin: v2ConcertFin }); }

VARS.g50[1] = { name: '保留變化＋機關合體', fn: v2Gimmick, dur: 7.6 };
VARS.g50[2] = { name: '擲骰ゾロ目', fn: v2Dice, dur: 7.6 };
VARS.g50[3] = { name: '流星墜落', fn: v2Meteor, dur: 7.2 };
VARS.g50[4] = { name: '演唱會轉播', fn: v2Concert, dur: 7.4 };

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

// ======================= V2 結尾構圖變體（第七輪：結尾不能每支都長一樣） =======================
// finaleV2(ctx, m, t, { style })：
//   hero（預設）  大標題＋名牌＋徽章（原本那一種，另有 R／L／C 三種擺法）
//   vertical      直書大字逐字砸下（在角色對側），名牌橫放在下方
//   count         份數／人數變成主角：巨大數字一路數上去，標題縮小放上面
//   lower         轉播字幕條：標題在上，下方一條「下三分之一」字幕條放名字和份數
//   manga         漫畫三分格：角色特寫／標題／名字與份數
// 各種構圖的時間點一致（標題 T0、名牌 T0+0.28、徽章或數字定格 T0+0.5），音效不用跟著改。
const FIN_LAY = {
  vertical: { girl: { x: 1300, h: 1650, from: 'below', rot: 0 } },
  count: { girl: { x: 500, h: 1650, from: 'left', rot: -0.02 } },
  lower: { girl: { x: 1400, h: 1650, from: 'right', rot: 0.02 } },
  manga: { girl: { h: 0 } },
};
const isRaid = () => !!(window.RAID && window.RAID[CFG.id]);
const goldFill = (ctx, h = 80) => { const gg = ctx.createLinearGradient(0, -h, 0, h); gg.addColorStop(0, '#fffbe0'); gg.addColorStop(0.45, '#ffd21a'); gg.addColorStop(1, '#ff8a00'); return gg; };
function vGlyph(ctx, t, ch, x, y, s, rot, depth) {   // 直書用的單字（字型跟大標題同一套規則）
  const pal = PAL[CFG.pal] || PAL.gold, ext = EXT[CFG.pal] || EXT.gold;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.font = titleFont(CFG.title); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (let i = depth; i >= 1; i--) { ctx.strokeStyle = ext[i % 2]; ctx.lineWidth = 56; ctx.strokeText(ch, i * 1.4, i * 2.2); }
  ctx.shadowColor = pal.glow; ctx.shadowBlur = 40; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 56; ctx.strokeText(ch, 0, 0); ctx.shadowBlur = 0;
  const gold = ctx.createLinearGradient(0, -110, 0, 110); gold.addColorStop(0, '#fff6c0'); gold.addColorStop(0.45, '#ffb21a'); gold.addColorStop(0.55, '#c76a00'); gold.addColorStop(1, '#ffe27a');
  ctx.strokeStyle = gold; ctx.lineWidth = 34; ctx.strokeText(ch, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; ctx.strokeText(ch, 0, 0);
  ctx.fillStyle = palFill(ctx, -95, 95, t, pal); ctx.fillText(ch, 0, 0);
  ctx.save(); ctx.beginPath(); ctx.rect(-300, -120, 600, 95); ctx.clip(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillText(ch, 0, 0); ctx.restore();
  ctx.restore();
}
function slamFx(ctx, x, y, l) { if (l < 0) return; ctx.save(); ctx.translate(x - 730, y - 420); coins(ctx, l + T_HIT); ctx.restore(); ringBurst(ctx, x, y, l, { r1: 1500 }); }

// ---------- vertical：直書大字 ----------
function finVertical(ctx, m, t, pk, T0, q) {
  const { sa, o, hi } = q, R = o.side === 'R', latin = isLatinTitle(), chars = latin ? [] : splitTitle(CFG.title), n = chars.length || 1, top = sa.top + 24, bot = sa.bot - 24, step = Math.min(205, (bot - top) / n), sc = step / 205, x = R ? W - 290 : 290, y0 = (top + bot) / 2 - step * (n - 1) / 2;
  slamFx(ctx, x, latin ? (top + bot) / 2 : y0, m - T0);
  if (latin) heroTitle(ctx, t, x, (top + bot) / 2, lin(m, T0, T0 + 0.18), { maxW: bot - top - 40, s: 0.95, rot: R ? Math.PI / 2 : -Math.PI / 2, pk });   /* 英文：整行轉 90 度 */
  chars.forEach((c, i) => { const ti = T0 + i * 0.08, k = lin(m, ti, ti + 0.15); if (k <= 0) return; const yy = y0 + i * step;
    ringBurst(ctx, x, yy, m - ti, { r0: 60, r1: 620, dur: 0.3, w: 18 });
    vGlyph(ctx, t, c, x + (i % 2 ? 12 : -12), yy, sc * 0.96 * (k < 1 ? 2.6 - 1.6 * eback(k, 1.5) : 1 + decay(m, [[ti, 1]], 10) * 0.06) * (c.length > 1 ? 0.88 : 1), i % 2 ? 0.05 : -0.05, 12); });
  if (!latin && m >= T0 + n * 0.08 + 0.15) dbgBoxC(ctx, 'text', 'title', x, (top + bot) / 2, 215 * sc + 20, step * n - 20, 0);
  const P = Object.assign({ x: CX + (R ? -340 : 340), y: sa.bot - 132, sc: 0.95 }, o.plate);
  plateV2(ctx, t, eo(lin(m, T0 + 0.28, T0 + 0.48)), P.x, P.y, P.sc);
  if ((hi || o.medal) && o.medal !== false) { const M = Object.assign({ x: R ? 250 : W - 240, y: sa.top + 150, sc: 0.9 }, o.medal); medalV2(ctx, t, M.x, M.y, lin(m, T0 + 0.5, T0 + 0.68), pk, M.sc); }
  if ((hi || o.mascot) && o.mascot !== false) { const S = Object.assign({ x: P.x + (R ? 300 : -300), y: P.y - 205, h: 250 }, o.mascot); /* 站在名牌上 */ mascotV2(ctx, t, lin(m, T0 + 0.7, T0 + 1.0), S.x, S.y, S.h, R); }
}

// ---------- count：巨大數字 ----------
function finCount(ctx, m, t, pk, T0, q) {
  const { sa, o, hi } = q, raid = isRaid(), x = o.side === 'L' ? 600 : 1320, av = sa.bot - sa.top, Y = (f) => sa.top + av * f;
  slamFx(ctx, x, Y(0.13), m - T0);
  heroTitle(ctx, t, x, Y(0.13), lin(m, T0, T0 + 0.18), { maxW: 940, s: 0.6, rot: -0.03, pk, depth: 12 });
  const a1 = eo(lin(m, T0 + 0.28, T0 + 0.48));
  if (a1 > 0) { ctx.save(); ctx.globalAlpha *= a1; ctx.translate(x + (1 - a1) * 60, Y(0.305)); ctx.rotate(-0.03);
    ctx.fillStyle = '#1a0838'; ctx.beginPath(); ctx.moveTo(-430, -44); ctx.lineTo(440, -52); ctx.lineTo(424, 46); ctx.lineTo(-446, 52); ctx.fill(); ctx.fillStyle = '#ffe14a'; ctx.fillRect(-438, 44, 860, 6);
    fitText(ctx, CFG.sub1, 0, 0, 800, "900 56px 'Noto Sans TC'", '#fff', null, 0, 'center'); ctx.restore();
    if (a1 >= 1) dbgBoxC(ctx, 'text', 'plate', x, Y(0.305), 880, 100, -0.03); }
  const ck = lin(m, T0 + 0.12, T0 + 0.5), l2 = m - T0 - 0.5;
  if (ck > 0) { const pre = raid ? '' : '×', full = pre + CFG.n, txt = pre + Math.max(1, Math.round(CFG.n * eo(ck)));
    ctx.save(); ctx.font = "150px 'Dela Gothic One'"; const w = ctx.measureText(full).width + 60; ctx.restore();
    const s0 = Math.min(av / 365, 900 / w), s = s0 * (l2 >= 0 ? 1 + Math.exp(-l2 * 9) * 0.28 + pk * 0.03 : 0.9);
    if (l2 >= 0) ringBurst(ctx, x, Y(0.59), l2, { r1: 1200, dur: 0.4 });
    wordV2(ctx, txt, x, Y(0.59), 1, { pop: false, s, fill: goldFill(ctx), stroke: '#3a1400', rot: -0.04, depth: 14, box: false, font: "150px 'Dela Gothic One'" });
    if (l2 >= 0.3) dbgBoxC(ctx, 'text', 'count', x, Y(0.59), w * s0 * 0.94, 132 * s0, -0.04); }
  const a2 = eo(lin(m, T0 + 0.5, T0 + 0.7));
  if (a2 > 0) { const fs = Math.round(84 * Math.min(1, av / 900)); ctx.save(); ctx.globalAlpha *= a2; inkText(ctx, LX(raid ? 'lblRaid' : 'lblGift'), x, Y(0.88) + (1 - a2) * 30, fs, '#ffe14a', '#1a0838'); ctx.restore();
    if (a2 >= 1) dbgBoxC(ctx, 'text', 'label', x, Y(0.88), fs * 5.4, fs * 1.2, 0); }
  if ((hi || o.mascot) && o.mascot !== false) { const S = Object.assign({ x: o.side === 'L' ? 150 : W - 150, y: sa.bot - 130, h: 240 }, o.mascot); mascotV2(ctx, t, lin(m, T0 + 0.7, T0 + 1.0), S.x, S.y, S.h, o.side !== 'L'); }
}

// ---------- lower：轉播字幕條 ----------
function finLower(ctx, m, t, pk, T0, q) {
  const { sa, o, hi, pal } = q, TT = Object.assign({ x: 650, y: sa.top + 200, maxW: 1080 }, o.title);
  slamFx(ctx, TT.x, TT.y, m - T0);
  heroTitle(ctx, t, TT.x, TT.y, lin(m, T0, T0 + 0.18), { maxW: TT.maxW, pk });
  const a = eo5(lin(m, T0 + 0.28, T0 + 0.56)), bh = 200, by = sa.bot - 36 - bh / 2, bw = 1210, x0 = sa.l, ac = pal.rainbow ? '#ff3d8b' : pal.edge[1];
  if (a > 0) { ctx.save(); ctx.translate(-(1 - a) * 1500, 0);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.fillStyle = 'rgba(20,10,48,0.94)'; ctx.beginPath(); ctx.moveTo(x0, by - bh / 2); ctx.lineTo(x0 + bw, by - bh / 2); ctx.lineTo(x0 + bw - 70, by + bh / 2); ctx.lineTo(x0, by + bh / 2); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.fillStyle = ac; ctx.beginPath(); ctx.moveTo(x0, by - bh / 2); ctx.lineTo(x0 + 290, by - bh / 2); ctx.lineTo(x0 + 240, by + bh / 2); ctx.lineTo(x0, by + bh / 2); ctx.fill();
    ctx.fillStyle = '#ffe14a'; ctx.fillRect(x0, by - bh / 2 - 8, bw, 8);
    fitText(ctx, o.tag || (isRaid() ? 'RAID' : 'GIFT'), x0 + 150, by + 2, 170, "56px 'Dela Gothic One'", '#ffffff', 'rgba(20,10,48,0.55)', 8, 'center');
    fitText(ctx, CFG.sub1, x0 + 320, by - 50, 790, "900 54px 'Noto Sans TC'", '#ffffff', null, 0, 'left');
    fitText(ctx, CFG.sub2, x0 + 320, by + 40, 790, "900 90px 'Noto Sans TC'", goldFill(ctx, 46), '#ffffff', 14, 'left');
    ctx.restore(); if (a >= 1) dbgBox(ctx, 'text', 'plate', x0 + 300, by - bh / 2 + 14, x0 + 1120, by + bh / 2 - 8); }
  if ((hi || o.medal) && o.medal !== false) { const M = Object.assign({ x: x0 + bw + 40, y: by - bh / 2 - 36, sc: 0.78 }, o.medal); medalV2(ctx, t, M.x, M.y, lin(m, T0 + 0.5, T0 + 0.68), pk, M.sc); }
  if ((hi || o.mascot) && o.mascot !== false) { const S = Object.assign({ x: x0 + 400, y: by - bh / 2 - 112, h: 250 }, o.mascot); mascotV2(ctx, t, lin(m, T0 + 0.7, T0 + 1.0), S.x, S.y, S.h); }
}

// ---------- manga：漫畫三分格 ----------
function finManga(ctx, m, t, pk, T0, q) {
  const { sa, o, hi, pal } = q, top = sa.top + 16, bot = sa.bot - 16, L0 = sa.l + 24, R0 = sa.r - 24, mid = (top + bot) / 2 - 20, ex = (y) => 930 - 170 * (y - top) / (bot - top);
  const PA = [[L0, top], [ex(top) - 36, top], [ex(bot) - 36, bot], [L0, bot]], PB = [[ex(top), top], [R0, top], [R0, mid - 34], [ex(mid + 26), mid + 26]], PC = [[ex(mid + 62), mid + 62], [R0, mid + 2], [R0, bot], [ex(bot), bot]];
  const a = eo5(lin(m, 0.04, 0.3)), b = eo5(lin(m, T0 - 0.02, T0 + 0.14)), c = eo5(lin(m, T0 + 0.26, T0 + 0.46));
  if (a > 0) mangaPanel(ctx, PA, (1 - a) * -1000, 0, 1, () => {   // 角色特寫
    if (o.panelBg) o.panelBg(ctx, t); else if (pal.rainbow) rainbowBG2(ctx, t * 2.2, 430, 380); else { ctx.save(); ctx.translate(-40, -30); ctx.scale(1.045, 1.06); palBG(ctx, t, pal, 430, 380); ctx.restore(); }
    if (GIRL) { const gh = 1750 * (1 + pk * 0.02), [fx, fy] = facePos(0, 0, gh); girlV2(ctx, 440 - fx, top + (bot - top) * 0.34 - fy + Math.sin(t * 2.1) * 6, gh, t, { rot: 0 }); } });
  if (m >= T0 - 0.02) mangaPanel(ctx, PB, 0, (1 - b) * -700, 1, () => {   // 標題
    const bx = (ex(top) + R0) / 2 + 24, by = (top + mid) / 2 - 4; ctx.fillStyle = '#160a3a'; ctx.fillRect(600, -100, 1500, 1300);
    speedLines(ctx, bx, by, 60, 300, pal.rainbow ? `hsla(${(t * 300) % 360},100%,70%,0.35)` : 'rgba(255,255,255,0.22)', Math.floor(t * 20), 0, 1);
    if (m >= T0) ringBurst(ctx, bx, by, m - T0, { r1: 900 });
    heroTitle(ctx, t, bx, by, lin(m, T0, T0 + 0.18), { maxW: R0 - ex(top) - 150, pk, rot: -0.03 }); });
  if (c > 0) mangaPanel(ctx, PC, (1 - c) * 1300, 0, 1, () => {   // 名字＋份數
    const ms = (hi || o.mascot) && o.mascot !== false, cx = (ex(bot) + R0 - (ms ? 250 : 0)) / 2 + 24, cy = (mid + 40 + bot) / 2 + 4, mw = R0 - ex(bot) - (ms ? 470 : 240), gr = ctx.createLinearGradient(0, mid, 0, bot); gr.addColorStop(0, '#fff6c0'); gr.addColorStop(1, '#ffc21a');
    ctx.fillStyle = gr; ctx.fillRect(500, mid - 80, 1500, 800); halftone(ctx, 600, mid - 60, 1940, bot + 30, 'rgba(255,110,0,0.18)', t);
    fitText(ctx, CFG.sub1, cx, cy - 82, mw, "900 62px 'Noto Sans TC'", '#1a0838', null, 0, 'center');
    fitText(ctx, CFG.sub2, cx, cy + 36, mw, "900 128px 'Noto Sans TC'", '#ffffff', '#1a0838', 26, 'center');
    if (c >= 1) dbgBoxC(ctx, 'text', 'plate', cx, cy - 10, mw, 250, 0); });
  if ((hi || o.medal) && o.medal !== false) { const M = Object.assign({ x: ex(mid + 44) + 6, y: mid + 44, sc: 0.78 }, o.medal); medalV2(ctx, t, M.x, M.y, lin(m, T0 + 0.5, T0 + 0.68), pk, M.sc); }
  if ((hi || o.mascot) && o.mascot !== false) { const S = Object.assign({ x: R0 - 150, y: bot - 128, h: 250 }, o.mascot); mascotV2(ctx, t, lin(m, T0 + 0.7, T0 + 1.0), S.x, S.y, S.h, true); }
}
const FIN_TEXT = { vertical: finVertical, count: finCount, lower: finLower, manga: finManga };

function finaleV2(ctx, m, t, o = {}) {
  const style = o.style || 'hero'; if (style === 'hero') return finaleHero(ctx, m, t, o);
  const hi = CFG.id === 'g25' || CFG.id === 'g50' || CFG.id === 'g100' || !!CFG.hi, tick = o.ticker ?? (CFG.id === 'g50' || CFG.id === 'g100' || !!CFG.tick), led = o.led ?? hi;
  const pal = PAL[CFG.pal] || PAL.gold, pw = CFG.power ?? 1, T0 = o.tTitle ?? 0.32;
  const sa = Object.assign({ top: tick ? 132 : led ? 46 : 8, bot: tick ? 950 : led ? 1034 : 1072, l: led ? 46 : 0, r: W - (led ? 46 : 0) }, o.safe);   // 外框以內可以放字的範圍
  const G = Object.assign({}, FIN_LAY[style].girl, o.girl); if (G.y === undefined && G.h) G.y = (tick ? 150 : led ? 100 : 66) + G.h / 2;
  const hits = [[0, 1], [T0, 0.9], [T0 + 0.5, 0.6]]; for (let b = T0 + 0.9; b < 5; b += 0.4) hits.push([b, 0.26]);
  const pk = decay(m, hits, 13), bx = o.bgC ? o.bgC[0] : (G.x ?? 960) - 120, by = o.bgC ? o.bgC[1] : 380;
  ctx.save();
  camV2(ctx, o.cam ? o.cam[0] : CX, o.cam ? o.cam[1] : CY, 1.014 + pk * 0.045 + Math.min(m, 5) * 0.005); shakeAt(ctx, t, (2 + pk * 24) * pw);
  if (o.bg) o.bg(ctx, m, t, pk); else if (pal.rainbow) rainbowBG2(ctx, t * 2.2, bx, by); else { ctx.save(); ctx.translate(-30, -20); ctx.scale(1.03, 1.04); palBG(ctx, t, pal, bx, by - 20); ctx.restore(); }
  if (o.back) o.back(ctx, m, t, pk);
  const gk = lin(m, o.tGirl ?? 0.08, (o.tGirl ?? 0.08) + 0.36);
  if (gk > 0 && G.h) { const e = eo5(gk), dir = G.from === 'right' ? 1 : G.from === 'left' ? -1 : 0, gh = G.h * (1 + pk * 0.018), gx = G.x + dir * (1 - e) * 1000, gy = G.y + (G.from === 'below' ? (1 - e) * 950 : 0) + Math.sin(t * 2.1) * 6;
    if (gk < 1 && dir) for (let i = 1; i <= 4; i++) drawImg(ctx, silC(GIRL_SIL, `hsl(${i * 70},100%,62%)`), gx + dir * i * 90 * (1 - gk), gy, gh, G.rot, 0.35);
    girlV2(ctx, gx, gy, gh, t, { rot: G.rot }); }
  if (o.mid) o.mid(ctx, m, t, pk);
  FIN_TEXT[style](ctx, m, t, pk, T0, { sa, o, hi, pal, G });
  if (o.front) o.front(ctx, m, t, pk);
  ctx.restore();
  if (o.confetti !== false) confetti(ctx, m, 0.05, o.confettiN ?? (hi ? 150 : 70), o.confetti || ['#ffe27a', '#fff6c0', '#ffffff', pal.edge ? pal.edge[1] : '#ff5aa5', '#ff5a8c'], 5);
  if (tick) { const e = 1 - eo5(lin(m, T0 + 0.2, T0 + 0.45)); if (m > T0 + 0.2) { tickerBand(ctx, t, 92 - e * 180, -1); tickerBand(ctx, t, H - 92 + e * 180, 1); } }
  if (led) { ctx.save(); ctx.globalAlpha = lin(m, 0, 0.25); if (pal.rainbow) ledFrame(ctx, t); else ledFrameHue(ctx, t, (i) => ({ red: 0, blue: 205, sky: 200, green: 120 }[CFG.pal] ?? 38) + ((i * 7 + t * 80) % 20)); ctx.restore(); }
  if (m >= T0) flash(ctx, (1 - lin(m, T0, T0 + 0.1)) * 0.32, '#fff6d0');
}

// ---------- 滾輪計數器（覆寫原版）：原本只能兩位數，份數自訂後要能顯示任意位數 ----------
function odometer(ctx, x, y, val, t) {
  const nd = Math.max(2, String(Math.round(CFG.n)).length), pitch = 340 / nd, wW = pitch - 20 * Math.min(1, 2 / nd), wH = 210, left = x - 85, fs = Math.round(170 * Math.min(1, wW / 150));
  for (let j = 0; j < nd; j++) { const p = Math.pow(10, nd - 1 - j), dv = p === 1 ? val % 10 : Math.floor(val / p) % 10 + Math.max(0, ((val % p) / p) * 10 - 9), cx = left + pitch * (j + 0.5);
    ctx.save(); ctx.beginPath(); ctx.roundRect(cx - wW / 2, y - wH / 2, wW, wH, 16); const bg = ctx.createLinearGradient(0, y - wH / 2, 0, y + wH / 2); bg.addColorStop(0, '#3a0010'); bg.addColorStop(0.5, '#8a0020'); bg.addColorStop(1, '#3a0010'); ctx.fillStyle = bg; ctx.fill(); ctx.clip();
    ctx.font = `${fs}px 'Dela Gothic One'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = Math.floor(dv) - 1; k <= Math.floor(dv) + 2; k++) { const yy = y + (k - dv) * -wH + 8, d = ((k % 10) + 10) % 10, gg = ctx.createLinearGradient(0, yy - 70, 0, yy + 70); gg.addColorStop(0, '#fff6c0'); gg.addColorStop(1, '#ffb000'); ctx.fillStyle = gg; ctx.fillText(String(d), cx, yy); }
    const sh = ctx.createLinearGradient(0, y - wH / 2, 0, y + wH / 2); sh.addColorStop(0, 'rgba(0,0,0,0.6)'); sh.addColorStop(0.3, 'rgba(0,0,0,0)'); sh.addColorStop(0.7, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.6)'); ctx.fillStyle = sh; ctx.fillRect(cx - wW / 2, y - wH / 2, wW, wH); ctx.restore();
    ctx.save(); ctx.lineWidth = 8; ctx.strokeStyle = `hsl(${(t * 400 + j * 90) % 360},100%,65%)`; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 20; ctx.beginPath(); ctx.roundRect(cx - wW / 2, y - wH / 2, wW, wH, 16); ctx.stroke(); ctx.restore(); }
}

// ---------- 名字長度：超過上限就截斷加「…」（全形字算 1、半形字算 0.55；預設 14，相當於 25 個英文字母） ----------
window.NAME_MAX_UNITS = 14;
function clipName(n) {
  const cs = Array.from(String(n ?? '').trim() || LX('viewer')), U = (ch) => (ch.codePointAt(0) > 0x2E80 ? 1 : 0.55), max = window.NAME_MAX_UNITS;
  if (cs.reduce((a, ch) => a + U(ch), 0) <= max) return cs.join('');
  let u = 0, out = ''; for (const ch of cs) { if (u + U(ch) > max - 1) break; u += U(ch); out += ch; } return out + '…';
}
const _setTierClip = window.setTier;
window.setTier = function (id, v) { P.name = clipName(P.name); return _setTierClip(id, v); };
window.setName = (n) => { P.name = clipName(n); setTier(CFG.id, CFG.v); };

// ======================= V2 揪團 第二組（每級第 2 種）：登船證蓋章／吉祥物遊行／擠爆滿員／傳送門艦隊 =======================
function mascotAt3(ctx, x, y, h, rot = 0, flip = false) {   // 白邊吉祥物
  const img = flip ? mascotFlip() : MASCOT; if (!img) return; outlineV2(ctx, img, x, y, h, rot, '#fff', Math.max(3, h * 0.02), 10); drawImg(ctx, img, x, y, h, rot);
}

// ---------------- 揪團 小 2：登船證蓋章 ----------------
function vRaid1B(ctx, t) {
  const D = CFG.dur, X0 = 76, Y0 = 772, TW = 940, TH = 252, SX = TW - 236, k = eback(lin(t, 0, 0.5), 1.25), out = ei(lin(t, D - 0.5, D - 0.05)), ST = 1.3, pal = PAL.sky, f = Math.floor(t * 60);
  const hit = decay(t, [[ST, 1]], 12);
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(-(1 - k) * 1200 - out * 1200 + (R(f, 1) - 0.5) * hit * 12, (R(f, 2) - 0.5) * hit * 12);
  ctx.translate(X0 + TW / 2, Y0 + TH / 2); ctx.rotate(-0.035 - (1 - k) * 0.2); ctx.translate(-TW / 2, -TH / 2);
  for (let i = 0; i < 3; i++) { const pk = popK(lin(t, 1.7 + i * 0.12, 2.0 + i * 0.12), 2.2); if (pk > 0) mascotAt3(ctx, 330 + i * 150, 8 - 78 * pk - Math.abs(Math.sin(t * 7 + i)) * 12, 170, Math.sin(t * 7 + i) * 0.08); }   // 從票後面探頭
  const body = () => { const r = 22; ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(SX - 18, 0); ctx.arc(SX, 0, 18, Math.PI, 0, true); ctx.lineTo(TW - r, 0); ctx.arcTo(TW, 0, TW, r, r); ctx.lineTo(TW, TH - r); ctx.arcTo(TW, TH, TW - r, TH, r); ctx.lineTo(SX + 18, TH); ctx.arc(SX, TH, 18, 0, Math.PI, true); ctx.lineTo(r, TH); ctx.arcTo(0, TH, 0, TH - r, r); ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r); ctx.closePath(); };
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12; body(); ctx.fillStyle = '#fffaf0'; ctx.fill(); ctx.restore();
  ctx.save(); body(); ctx.clip();
  const lg = ctx.createLinearGradient(0, 0, 0, TH); lg.addColorStop(0, '#3f9af0'); lg.addColorStop(1, '#1f5fd0'); ctx.fillStyle = lg; ctx.fillRect(0, 0, 156, TH);
  if (ANCHOR) { const ah = 130, aw = ANCHOR.width * ah / ANCHOR.height; ctx.drawImage(ANCHOR, 78 - aw / 2, TH / 2 - ah / 2, aw, ah); }
  ctx.fillStyle = '#1a3a8a'; ctx.fillRect(156, 0, SX - 156, 50);
  ctx.save(); ctx.font = "900 26px 'Noto Sans TC'"; ctx.letterSpacing = '4px'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff'; ctx.fillText('BOARDING PASS' + LX('pass'), 180, 26); ctx.restore();
  ctx.fillStyle = '#ffe9ee'; ctx.fillRect(SX, 0, TW - SX, TH);
  ctx.setLineDash([10, 9]); ctx.strokeStyle = '#1a3a8a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(SX, 22); ctx.lineTo(SX, TH - 22); ctx.stroke(); ctx.setLineDash([]);
  const cxs = (SX + TW) / 2;
  ctx.font = "30px 'Dela Gothic One'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e8243c'; ctx.fillText('RAID', cxs, 34);
  fitText(ctx, String(CFG.n), cxs, 128, 196, "112px 'Dela Gothic One'", '#e8243c', null, 0, 'center');
  ctx.font = "900 34px 'Noto Sans TC'"; ctx.fillStyle = '#1a3a8a'; ctx.textAlign = 'center'; ctx.fillText(LX('unit'), cxs, 214);
  ctx.restore();
  ctx.save(); body(); ctx.lineWidth = 5; ctx.strokeStyle = '#1a3a8a'; ctx.stroke(); ctx.restore();
  const tk = lin(t, 0.5, 0.7); if (tk > 0) { ctx.save(); ctx.translate(182, 122); const s = slamK(tk, 1.7); ctx.scale(s, s); smallTitle(ctx, t, CFG.title, 0, 0, 74, pal, 'left', 350); ctx.restore(); }
  const nk = eo(lin(t, 0.75, 0.95)); if (nk > 0) { ctx.save(); ctx.globalAlpha *= nk; fitText(ctx, raidLine(), 184 + (1 - nk) * 24, 204, 352, "900 38px 'Noto Sans TC'", '#1a3a8a', null, 0, 'left'); ctx.restore(); }
  const sk = lin(t, ST, ST + 0.1);   // 紅色圓章「RAID」砸下
  if (sk > 0) { const s = 2.6 - 1.6 * eo(sk); ctx.save(); ctx.translate(SX - 80, 152); ctx.rotate(-0.28); ctx.scale(s * 0.86, s * 0.86); ctx.globalAlpha *= Math.min(1, sk * 2) * 0.88;
    ctx.strokeStyle = '#d0142c'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(0, 0, 84, 0, 7); ctx.stroke(); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 68, 0, 7); ctx.stroke();
    ctx.fillStyle = '#d0142c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = "46px 'Dela Gothic One'"; ctx.fillText('RAID', 0, 2); ctx.font = "900 15px 'Noto Sans TC'"; ctx.fillText('WELCOME', 0, -42); ctx.fillText('★ ★ ★', 0, 44); ctx.restore(); }
  ctx.restore();
  if (t >= ST) { ctx.save(); ctx.globalAlpha = 1 - out; sparkBurst(ctx, X0 + SX - 80, Y0 + 152, t - ST, 14, 1.2, '#ffd0d8'); ctx.restore(); }
}

// ---------------- 揪團 中 2：吉祥物遊行 ----------------
function vRaid2BScene(ctx, t) {
  const GY = 940, app = eo(lin(t, 0, 0.3)), rise = (1 - eback(lin(t, 0, 0.5), 1.2)) * 320, TT = 1.75, pk = decay(t, [[TT, 1]], 11), N = 9, l = t - TT;
  ctx.save(); camV2(ctx, 960, 900, 1.012 + pk * 0.03); shakeAt(ctx, t, pk * 16);
  dimBG(ctx, app * 0.6, [960, 560, 1000, 'rgba(90,170,255,0.3)']);
  ctx.save(); ctx.translate(0, rise);
  const cg = ctx.createLinearGradient(0, GY, 0, GY + 200); cg.addColorStop(0, '#2a86f0'); cg.addColorStop(1, '#144ab8'); ctx.fillStyle = cg; ctx.fillRect(-100, GY, W + 200, 300);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-100, GY - 5, W + 200, 10); ctx.fillStyle = '#ffe14a'; ctx.fillRect(-100, GY + 14, W + 200, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; for (let x = -120 - ((t * 260) % 120); x < W + 120; x += 120) { ctx.beginPath(); ctx.moveTo(x, GY + 78); ctx.lineTo(x + 30, GY + 52); ctx.lineTo(x + 60, GY + 78); ctx.lineTo(x + 30, GY + 104); ctx.fill(); }   // 往後流動的菱形，看起來在前進
  ctx.restore();
  for (let i = 0; i < N; i++) {   // 一隻一隻跳進來排成一排；標題砸下時一起跳
    const e = eo5(lin(t, 0.2 + (N - 1 - i) * 0.08, 1.15 + (N - 1 - i) * 0.08)), x = mixv(-260 - (N - 1 - i) * 40, 150 + i * 202, e), ph = t * 8.5 - i * 0.7, jump = l >= 0 && l < 0.5 ? Math.sin(l / 0.5 * Math.PI) * 170 * (1 - (i % 3) * 0.12) : 0, y = GY - 104 - Math.abs(Math.sin(ph)) * (e < 1 ? 40 : 20) - jump + rise;
    if (i % 2 === 0) { const fc = ['#ff5a8c', '#ffe14a', '#7dff9a', '#8fd8ff', '#c8a0ff'][(i / 2) % 5]; ctx.save(); ctx.translate(x + 62, y - 30); ctx.rotate(0.16 + Math.sin(ph) * 0.08); ctx.strokeStyle = '#fff2c0'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 60); ctx.lineTo(0, -150); ctx.stroke();
      ctx.fillStyle = fc; ctx.strokeStyle = '#2b1a3a'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(0, -150); ctx.quadraticCurveTo(50, -140 + Math.sin(t * 9 + i) * 10, 96, -118); ctx.quadraticCurveTo(50, -100 + Math.sin(t * 9 + i) * 10, 0, -90); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
    mascotAt3(ctx, x, y, 236, Math.sin(ph) * 0.08);
  }
  if (l >= 0) { shardsV2(ctx, 960, 350, l, 36, ['#ffffff', '#bff0ff', '#fff2a8']); ringBurst(ctx, 960, 350, l, { r1: 1300, col: 'rgba(200,240,255,1)' });
    for (const sx of [-1, 1]) { const q = l - 0.05; if (q > 0 && q < 0.9) for (let i = 0; i < 30; i++) { const a = -Math.PI / 2 - sx * (0.25 + R(i, 1) * 0.55), v = 1000 + R(i, 2) * 800, x = 960 + sx * 900 + Math.cos(a) * v * q, y = 1000 + Math.sin(a) * v * q + 900 * q * q; ctx.fillStyle = ['#ffd24a', '#ff5a8a', '#5fc8ff', '#fff'][i % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(q * 12 + i); ctx.fillRect(-10, -5, 20, 10); ctx.restore(); } } }
  heroTitle(ctx, t, 960, 350, lin(t, TT, TT + 0.18), { maxW: 1320, pk, rot: -0.03 });
  plateV2(ctx, t, eo(lin(t, TT + 0.28, TT + 0.48)), 960, 585, 0.92);
  ctx.restore();
  if (l >= 0) confetti(ctx, t, TT, 70, ['#ffffff', '#8fd8ff', '#ffe27a', '#ff7aa8'], 73);
  if (l >= 0) flash(ctx, (1 - lin(l, 0, 0.1)) * 0.22, '#dff4ff');
}
function vRaid2B(ctx, t) { if (!MASCOT) return vRaid2(ctx, t); runV2(ctx, t, { T: 1e9, exitKind: 'slice', pre: vRaid2BScene }); }

// ---------------- 揪團 大 2：擠爆滿員 ----------------
const RF3 = { fill0: 0.45, full: 2.3, burst: 2.9, T: 3.25 };
function vRaid3BPre(ctx, t) {
  const T = RF3, app = eo(lin(t, 0, 0.25)), fk = lin(t, T.fill0, T.full), cnt = Math.max(1, Math.round(CFG.n * eo(fk))), full = t >= T.full, bl = t - T.burst, M = 84;
  const pk = decay(t, [[T.full, 0.8], [T.burst, 1]], 9);
  ctx.save(); camV2(ctx, 960, 560, 1.014 + 0.05 * sstep(fk) + pk * 0.05); shakeAt(ctx, t, pk * 24 + (full && bl < 0 ? 9 : fk * 3));
  const bg = ctx.createRadialGradient(960, 560, 0, 960, 560, 1300); bg.addColorStop(0, full ? '#7a1030' : '#1f4aa8'); bg.addColorStop(1, '#070a2a'); ctx.globalAlpha = app; ctx.fillStyle = bg; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.globalAlpha = 1;
  for (let j = M - 1; j >= 0; j--) {   // 由下往上一排一排塞滿（先畫上排，下排蓋在前面）
    const r = Math.floor(j / 12), c = j % 12, aj = T.fill0 + (j / M) * (T.full - T.fill0) * 0.96, pop = popK(lin(t, aj, aj + 0.22), 2.2); if (pop <= 0) continue;
    let x = (c + 0.5 + (r % 2) * 0.5) * 165 - 50 + (R(j, 5) - 0.5) * 40, y = 1000 - r * 150 + (R(j, 6) - 0.5) * 30, rot = (R(j, 7) - 0.5) * 0.5, a = 1, h = 236 * pop;
    if (full && bl < 0) { x += Math.sin(t * 46 + j) * 7; y += Math.cos(t * 39 + j * 1.7) * 7; h *= 1 + 0.03 * Math.sin(t * 30 + j); }
    if (bl >= 0) { const dx = x - 960, dy = y - 560, d = Math.hypot(dx, dy) + 1, v = bl * (1500 + R(j, 8) * 1500); x += dx / d * v; y += dy / d * v - 300 * bl; rot += bl * (R(j, 9) - 0.5) * 16; h *= 1 + bl * 1.2; a = 1 - lin(bl, 0.3, 0.6); }
    if (a <= 0) continue; ctx.save(); ctx.globalAlpha = a; mascotAt3(ctx, x, y, h, rot + Math.sin(t * 6 + j) * 0.06, R(j, 10) > 0.5); ctx.restore();
  }
  if (bl >= 0) for (let i = 0; i < 3; i++) ringBurst(ctx, 960, 560, bl - i * 0.07, { r1: 1600, dur: 0.5, sq: 1, w: 30 });
  if (bl < 0.1) {   // 中央人數牌
    ctx.save(); ctx.globalAlpha = (1 - lin(bl, 0, 0.1)) * eo(lin(t, T.fill0 - 0.1, T.fill0 + 0.15)); ctx.translate(960, 560); const s = 1 + (full ? Math.exp(-(t - T.full) * 8) * 0.25 : 0); ctx.scale(s, s);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.fillStyle = full ? '#c4002a' : '#12205a'; ctx.beginPath(); ctx.roundRect(-380, -150, 760, 300, 60); ctx.fill(); ctx.shadowBlur = 0; ctx.lineWidth = 12; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = '#ffe14a'; ctx.beginPath(); ctx.roundRect(-362, -132, 724, 264, 46); ctx.stroke();
    fitText(ctx, ppl(cnt), 0, 10, 640, "190px 'Dela Gothic One', 'Noto Sans TC'", full ? '#ffe14a' : '#ffffff', '#0a0420', 22, 'center'); ctx.restore();
  }
  ctx.restore();
  if (bl < 0.1) {   // 上方的乘載量表
    const a = app * (1 - lin(bl, 0, 0.1)); ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(420, 60, 1080, 60, 30); ctx.fill();
    const gc = fk < 0.6 ? '#5cff70' : fk < 0.9 ? '#ffe14a' : '#ff3a4a'; ctx.fillStyle = gc; ctx.beginPath(); ctx.roundRect(428, 68, Math.max(44, 1064 * fk), 44, 22); ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(420, 60, 1080, 60, 30); ctx.stroke(); ctx.restore();
    hudText(ctx, 'CAPACITY', 250, 92, 34, '#ffffff', 'center', a); hudText(ctx, full ? 'OVER!!' : Math.round(fk * 100) + '%', 1650, 92, 40, full ? (Math.floor(t * 10) % 2 ? '#ff3a4a' : '#ffe14a') : '#ffffff', 'center', a);
  }
  if (t > 1.1 && !full) wordV2(ctx, 'ぎゅうぎゅう…', 960, 262, lin(t, 1.1, 1.25), { s: 0.9, fill: '#ffffff', stroke: '#0a1450', rot: -0.04, beat: Math.sin(t * 24) * 0.03 });
  if (full && bl < 0) { const hz = eo5(lin(t, T.full, T.full + 0.2)); hazard(ctx, H - 74 * hz, 74, -t * 320); wordV2(ctx, '満員!!', 960, 262, lin(t, T.full, T.full + 0.14), { s: 1.6, big: 3, fill: Math.floor(t * 10) % 2 ? '#ff2a3a' : '#ffe14a', stroke: '#1a0008', rot: -0.05, beat: Math.sin(t * 30) * 0.03, depth: 12 }); }
  if (bl >= 0 && t < T.T) wordV2(ctx, 'ドーン!!', 960, 540, lin(bl, 0, 0.12), { s: 2.0, big: 3, fill: '#ffffff', stroke: '#0a3a9a', rot: -0.06, depth: 14, box: false });
  if (full) flash(ctx, (1 - lin(t, T.full, T.full + 0.12)) * 0.4, '#ffd0d0');
  if (bl >= 0) flash(ctx, (1 - lin(bl, 0, 0.2)) * 0.8, '#fff');
}
function vRaid3BFin(ctx, m, t) {   // 結尾：轉播字幕條；後面還有吉祥物一直掉下來
  finaleV2(ctx, m, t, { style: 'lower', tag: 'RAID', tGirl: 0.05, tTitle: 0.42, mascot: false,
    bg: (c) => { c.save(); c.translate(-40, -30); c.scale(1.045, 1.06); palBG(c, t, PAL.blue, 1280, 380); c.restore(); },
    back: (c, mm, tt) => { for (let i = 0; i < 16; i++) { const q = (tt * (0.28 + R(i, 3) * 0.2) + R(i, 4)) % 1, x = 80 + R(i, 5) * 1000; c.save(); c.globalAlpha = 0.9; mascotAt3(c, x, -160 + q * 1400, 150 + R(i, 6) * 70, q * (R(i, 7) - 0.5) * 9, i % 2 === 0); c.restore(); } } });
}
function vRaid3B(ctx, t) { if (!MASCOT) return vRaid3(ctx, t); runV2(ctx, t, { T: RF3.T, cut: false, exitKind: 'whipR', pre: vRaid3BPre, fin: vRaid3BFin }); }

// ---------------- 揪團 特大 2：傳送門艦隊 ----------------
const RP4 = { c: [0.5, 0.95, 1.35], open: 1.75, flag: 3.5, hit: 4.15, T: 4.3 };
function portalV2(ctx, t, x, y, r, a = 1) {   // 彩虹隧道（圓形視窗）＋金色外環
  if (r < 2) return; ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  const bg = ctx.createRadialGradient(x, y, 0, x, y, r); bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.25, '#ffe9a0'); bg.addColorStop(0.6, '#b04aff'); bg.addColorStop(1, '#1a0a50'); ctx.fillStyle = bg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 16; i++) { const z = ((i / 16) + t * 1.2) % 1, rr = 24 * Math.pow(r / 18, z); ctx.strokeStyle = `hsla(${(i * 40 + t * 200) % 360},100%,65%,${Math.min(1, z * 1.6) * 0.8})`; ctx.lineWidth = 2 + z * 26; ctx.beginPath(); ctx.arc(x + Math.sin(t * 3 + i) * 12 * z, y + Math.cos(t * 2 + i) * 10 * z, rr, 0, 7); ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha *= a; ctx.lineWidth = 30; ctx.strokeStyle = '#2b1a3a'; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 7); ctx.stroke(); const gg = ctx.createLinearGradient(0, y - r, 0, y + r); gg.addColorStop(0, '#fff2a0'); gg.addColorStop(1, '#c87a00'); ctx.lineWidth = 18; ctx.strokeStyle = gg; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 7); ctx.stroke();
  ctx.translate(x, y); ctx.rotate(t * 0.8); ctx.fillStyle = '#fffbe0'; for (let i = 0; i < 12; i++) { const an = i / 12 * Math.PI * 2; ctx.save(); ctx.translate(Math.cos(an) * (r + 6), Math.sin(an) * (r + 6)); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(10, 0); ctx.lineTo(0, 16); ctx.lineTo(-10, 0); ctx.fill(); ctx.restore(); }
  ctx.restore();
}
function vRaid4BPre(ctx, t) {
  const T = RP4, app = eo(lin(t, 0, 0.25)), CXp = 960, CYp = 520; let lv = 0; for (const c of T.c) if (t >= c) lv++;
  const open = t >= T.open, ol = t - T.open, hits = [...T.c.map((c, i) => [c, 0.5 + 0.2 * i]), [T.open, 1], [T.flag, 0.6]], pk = decay(t, hits, 10), fu = lin(t, T.flag, T.hit);
  const cnt = Math.max(1, Math.round(CFG.n * Math.pow(lin(t, T.open + 0.25, T.flag + 0.2), 1.5)));
  ctx.save(); camV2(ctx, CXp, CYp, 1.014 + pk * 0.05 + lv * 0.015 + ei(fu) * 0.12); shakeAt(ctx, t, pk * 24 + lv * 2 + fu * 10);
  ctx.save(); ctx.globalAlpha = app; const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#080626'); sky.addColorStop(1, '#2a1260'); ctx.fillStyle = sky; ctx.fillRect(-80, -80, W + 160, H + 160);
  for (let i = 0; i < 110; i++) { const tw = 0.55 + 0.45 * Math.sin(t * (2 + R(i, 4) * 4) + i); if (i % 9 === 0) star4(ctx, R(i, 1) * W, R(i, 2) * H, 8 + 12 * tw, '#fff', 0.8 * tw); else { ctx.fillStyle = `rgba(255,255,240,${0.3 + 0.6 * R(i, 3) * tw})`; ctx.fillRect(R(i, 1) * W, R(i, 2) * H, 3, 3); } }
  ctx.restore();
  if (!open && lv) {   // 天空裂開：三段，一次比一次大，裂縫漏出的光也升級
    const lc = T.c[lv - 1], grow = [0.22, 0.5, 0.85][lv - 1] * (0.75 + 0.25 * eo(lin(t, lc, lc + 0.15))), col = ['#ffffff', '#8fe0ff', '#ffd21a'][lv - 1];
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gl = ctx.createRadialGradient(CXp, CYp, 0, CXp, CYp, 260 + lv * 220); gl.addColorStop(0, col); gl.addColorStop(0.3, col + '88'); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.5 + 0.15 * Math.sin(t * 30); ctx.fillStyle = gl; ctx.fillRect(-80, -80, W + 160, H + 160); ctx.restore();
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 24; cracks(ctx, 7, CXp, CYp, grow, col, 5 + lv * 2); ctx.restore(); cracks(ctx, 7, CXp, CYp, grow, '#ffffff', 2);
    ringBurst(ctx, CXp, CYp, t - lc, { r0: 40, r1: 700 + lv * 300, dur: 0.35, sq: 1, w: 16 });
  }
  if (open) {
    portalV2(ctx, t, CXp, CYp, 470 * eback(lin(ol, 0, 0.4), 1.5) * (1 + pk * 0.03));
    if (ol < 0.7) for (let i = 0; i < 26; i++) { const a = R(i, 21) * Math.PI * 2, d = 200 + ol * (900 + R(i, 22) * 1400), s = 30 + R(i, 23) * 70; ctx.save(); ctx.globalAlpha = 1 - ol / 0.7; ctx.translate(CXp + Math.cos(a) * d, CYp + Math.sin(a) * d * 0.8 + 600 * ol * ol); ctx.rotate(ol * 9 * (R(i, 24) - 0.5) + i); ctx.fillStyle = i % 2 ? 'rgba(200,220,255,0.85)' : 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s, -s * 0.7); ctx.lineTo(s * 0.3, s); ctx.closePath(); ctx.fill(); ctx.restore(); }   // 天空的碎片
    const ships = [];   // 船從門裡一艘接一艘衝出來，往四周飛過鏡頭
    for (let i = 0; i < 18; i++) { const u = (t - (T.open + 0.25 + i * 0.105)) / 1.15; if (u <= 0 || u >= 1) continue; ships.push([u, i]); }
    ships.sort((a, b) => a[0] - b[0]);
    for (const [u, i] of ships) { const a = (i * 2.4) + R(i, 31) * 0.8, e = Math.pow(u, 2.3), d = 40 + e * 1500, x = CXp + Math.cos(a) * d * 1.25, y = CYp + Math.sin(a) * d * 0.7 + e * 200, h = 40 + e * 760;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `hsla(${(i * 47) % 360},100%,70%,${0.5 * (1 - u)})`; ctx.lineWidth = 6 + e * 40; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(CXp, CYp); ctx.lineTo(x, y - h * 0.4); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha = Math.min(1, u * 5) * (1 - lin(u, 0.85, 1)); shipV2(ctx, x, y, h, t, { ph: i, flip: Math.cos(a) < 0, crew: h > 300 ? 1 : 0, rot: Math.cos(a) < 0 ? 0.08 : -0.08 }); ctx.restore(); }
    if (fu > 0) { const h = 160 + ei(fu) * 2900; shipV2(ctx, CXp - h * 0.06, CYp + h * 0.42, h, t, { crew: 2, ph: 0 }); }   // 旗艦正面衝過來
  }
  ctx.restore();
  if (!open && lv) wordV2(ctx, ['ピシッ', 'ピシピシ…!?', '来るぞ…!!'][lv - 1], 960, 170, lin(t, T.c[lv - 1], T.c[lv - 1] + 0.12), { s: 0.75 + lv * 0.12, fill: ['#ffffff', '#8fe0ff', '#ffd21a'][lv - 1], stroke: '#0a0420', rot: -0.04, beat: Math.sin(t * 24) * 0.02 * lv });
  if (open && t < T.hit) { const colr = t >= T.flag ? rainbowFill(ctx, -70, 70, t) : '#ffd21a';
    wordV2(ctx, ppl(cnt), 960, 975, 1, { pop: false, s: 0.8 + (t >= T.flag ? 0.12 : 0), fill: colr, stroke: '#0a0420', rot: -0.03, box: false });
    if (t >= T.flag) wordV2(ctx, '旗艦、突入!!', 960, 150, lin(t, T.flag, T.flag + 0.14), { s: 1.05, fill: '#ff3a4a', stroke: '#ffffff', rot: -0.04, beat: Math.sin(t * 28) * 0.03 }); }
  for (const c of T.c) if (t >= c && t < c + 0.1) flash(ctx, (1 - (t - c) / 0.1) * 0.25, '#fff');
  if (open) flash(ctx, (1 - lin(ol, 0, 0.2)) * 0.75, '#fff');
  if (t >= T.hit) { flash(ctx, lin(t, T.hit, T.hit + 0.08) * 0.95, '#fff'); cracks(ctx, 11, 960, 540, lin(t, T.hit, T.T) * 1.2, '#1a0838', 6); }
}
function vRaid4BFin(ctx, m, t) {   // 結尾：漫畫三分格
  finaleV2(ctx, m, t, { style: 'manga', tTitle: 0.62, confettiN: 220, mascot: {},
    bg: (c) => { rainbowBG2(c, t * 2.2, 960, 500); },
    front: (c, mm, tt, pk) => raidSeal(c, tt, 320, 846, lin(mm, 1.45, 1.63), pk) });
}
function vRaid4B(ctx, t) { if (!SHIP) return; runV2(ctx, t, { T: RP4.T, cutA: 0.9, exitKind: 'crt', pre: vRaid4BPre, fin: vRaid4BFin }); }

VARS.r1[1] = { name: '登船證蓋章', fn: vRaid1B, dur: 4.2 };
VARS.r2[1] = { name: '吉祥物遊行', fn: vRaid2B, dur: 5.6 };
VARS.r3[1] = { name: '擠爆滿員', fn: vRaid3B, dur: 7.4 };
VARS.r4[1] = { name: '傳送門艦隊', fn: vRaid4B, dur: 9.4 };

// ======================= V2 五語（zh-TW／en／ja／ko／zh-CN）=======================
// 用法：網址參數 ?lang=en，或執行期 setLang('ja')。語言代碼跟聲嶼的 i18n.js 一致。
// 原則：
//   1. 只翻「觀眾要看懂」的字：標題、名字與份數的句型、少數標籤。柏青哥風的日文效果字（チャンス、激アツ、ゾロ目…）和英文標籤（LOCK ON、RAID…）五個語言都保留原樣，那是風格的一部分。
//   2. 每個語言各有自己的標題字型，同一行不可以出現兩種字體（見 titleFont 與下面的字型設定）。
//   3. 語序不同，所以「名字／份數」兩行是各語言各自的句型，不是把中文拆開翻。
const LANGS = ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'];
const subsEn = (n) => (Number(n) === 1 ? '1 sub' : `${n} subs`);
const L10N = {
  'zh-TW': {
    title: { sub: '感謝訂閱!', g1: '贈送訂閱!', g5: '贈訂 ×{n}!', g10: '贈訂 ×{n}!!', g25: '大量贈訂!!', g50: '大物降臨!!', g100: '神降臨!!', r1: '揪團來了!', r2: '揪團來襲!', r3: '揪團來襲!!', r4: '大揪團來襲!!' },
    sub1Gift: (name) => `${name} 送出了`, sub2Gift: (n) => `${n} 份訂閱`, sub1Sub: (name) => `${name}`, sub2Sub: '訂閱了!', sub1Raid: (name) => `${name} 帶著`, sub2Raid: (n) => `${n} 位夥伴來了`,
    nameGift: (name, n) => `${name} 送出了 ${n} 份訂閱`, nameSub: (name) => `${name} 訂閱了`, raidLine: (name, n) => `${name} 帶著 ${n} 位夥伴`,
    speechSub: (name) => `謝謝 ${name} 的訂閱！`, speechGift: (name, n) => `謝謝 ${name} 送的 ${n} 份訂閱！`,
    lblGift: '份訂閱!', lblRaid: '位夥伴來了!', lblGift0: '份訂閱', unit: '人', ppl: (n) => `${n} 人`, medal: (n) => `${n}人`,
    gift: '贈訂', victory: '大勝利!!', extra: '號外!!', ex1: '號', ex2: '外', fleet: '艦隊，全員到齊！', pass: ' ・ 登船證', notice1: '送出了 1 份訂閱', tickerR: 'RAID ★ 大艦隊來襲 ★', viewer: '觀眾' },
  'zh-CN': {
    title: { sub: '感谢订阅!', g1: '赠送订阅!', g5: '赠订 ×{n}!', g10: '赠订 ×{n}!!', g25: '大量赠订!!', g50: '大佬降临!!', g100: '神降临!!', r1: '突袭来了!', r2: '突袭驾到!', r3: '突袭驾到!!', r4: '超大突袭!!' },
    sub1Gift: (name) => `${name} 送出了`, sub2Gift: (n) => `${n} 份订阅`, sub1Sub: (name) => `${name}`, sub2Sub: '订阅了!', sub1Raid: (name) => `${name} 带着`, sub2Raid: (n) => `${n} 位伙伴来了`,
    nameGift: (name, n) => `${name} 送出了 ${n} 份订阅`, nameSub: (name) => `${name} 订阅了`, raidLine: (name, n) => `${name} 带着 ${n} 位伙伴`,
    speechSub: (name) => `谢谢 ${name} 的订阅！`, speechGift: (name, n) => `谢谢 ${name} 送的 ${n} 份订阅！`,
    lblGift: '份订阅!', lblRaid: '位伙伴来了!', lblGift0: '份订阅', unit: '人', ppl: (n) => `${n} 人`, medal: (n) => `${n}人`,
    gift: '赠订', victory: '大胜利!!', extra: '号外!!', ex1: '号', ex2: '外', fleet: '舰队，全员到齐！', pass: ' ・ 登船证', notice1: '送出了 1 份订阅', tickerR: 'RAID ★ 大舰队来袭 ★', viewer: '观众' },
  ja: {
    title: { sub: 'サブスク感謝!', g1: 'サブギフ!', g5: 'ギフト ×{n}!', g10: 'ギフト ×{n}!!', g25: '大量ギフト!!', g50: '大物降臨!!', g100: '神降臨!!', r1: 'レイド来た!', r2: 'レイド襲来!', r3: 'レイド襲来!!', r4: '大レイド襲来!!' },
    sub1Gift: (name) => `${name} さんから`, sub2Gift: (n) => `${n} 個のサブギフト`, sub1Sub: (name) => `${name} さん`, sub2Sub: 'サブスク登録!', sub1Raid: (name) => `${name} さんが`, sub2Raid: (n) => `${n} 人でレイド!`,
    nameGift: (name, n) => `${name} さんから ${n} 個のサブギフト`, nameSub: (name) => `${name} さんがサブスク登録`, raidLine: (name, n) => `${name} さんが ${n} 人とレイド`,
    speechSub: (name) => `${name} さん、サブスクありがとう！`, speechGift: (name, n) => `${name} さん、${n} 個のギフトありがとう！`,
    lblGift: 'サブギフト!', lblRaid: '人でレイド!', lblGift0: '個ギフト', unit: '人', ppl: (n) => `${n} 人`, medal: (n) => `${n}人`,
    gift: 'ギフト', victory: '大勝利!!', extra: '号外!!', ex1: '号', ex2: '外', fleet: '艦隊、全員集合！', pass: ' ・ 乗船券', notice1: '1 個のサブギフト', tickerR: 'RAID ★ 大艦隊襲来 ★', viewer: '視聴者' },
  ko: {
    title: { sub: '구독 감사!', g1: '구독 선물!', g5: '선물 ×{n}!', g10: '선물 ×{n}!!', g25: '대량 선물!!', g50: '큰손 강림!!', g100: '신 강림!!', r1: '레이드 도착!', r2: '레이드 습격!', r3: '레이드 습격!!', r4: '초대형 레이드!!' },
    sub1Gift: (name) => `${name} 님이`, sub2Gift: (n) => `구독 ${n}개 선물`, sub1Sub: (name) => `${name} 님`, sub2Sub: '구독했어요!', sub1Raid: (name) => `${name} 님이`, sub2Raid: (n) => `${n}명과 레이드!`,
    nameGift: (name, n) => `${name} 님이 구독 ${n}개 선물`, nameSub: (name) => `${name} 님이 구독`, raidLine: (name, n) => `${name} 님이 ${n}명과 함께`,
    speechSub: (name) => `${name} 님, 구독 감사합니다!`, speechGift: (name, n) => `${name} 님, 구독 ${n}개 감사합니다!`,
    lblGift: '구독 선물!', lblRaid: '명과 레이드!', lblGift0: '개 선물', unit: '명', ppl: (n) => `${n}명`, medal: (n) => `${n}명`,
    gift: '선물', victory: '대승리!!', extra: '호외!!', ex1: '호', ex2: '외', fleet: '함대, 전원 집합!', pass: ' ・ 승선권', notice1: '구독 1개 선물', tickerR: 'RAID ★ 대함대 습격 ★', viewer: '시청자' },
  en: {
    title: { sub: 'NEW SUB!', g1: 'GIFT SUB!', g5: 'GIFT ×{n}!', g10: 'GIFT ×{n}!!', g25: 'MEGA GIFT!!', g50: 'LEGENDARY!!', g100: 'GODLIKE!!', r1: 'RAID!', r2: 'RAID INCOMING!', r3: 'RAID ALERT!!', r4: 'MEGA RAID!!' },
    sub1Gift: (name) => `${name} gifted`, sub2Gift: (n) => subsEn(n), sub1Sub: (name) => `${name}`, sub2Sub: 'subscribed!', sub1Raid: (name) => `${name} is raiding`, sub2Raid: (n) => `with ${n} viewers`,
    nameGift: (name, n) => `${name} gifted ${subsEn(n)}`, nameSub: (name) => `${name} subscribed`, raidLine: (name, n) => `${name} raids with ${n}`,
    speechSub: (name) => `Thanks for the sub, ${name}!`, speechGift: (name, n) => `Thanks for ${subsEn(n)}, ${name}!`,
    lblGift: 'GIFT SUBS!', lblRaid: 'RAIDERS!', lblGift0: 'SUBS', unit: '', ppl: (n) => `×${n}`, medal: (n) => `×${n}`,
    gift: 'GIFT', victory: 'VICTORY!!', extra: 'EXTRA!!', ex1: 'EX', ex2: 'TRA', fleet: 'THE FLEET HAS ARRIVED!', pass: '', notice1: 'gifted 1 sub', tickerR: 'RAID ★ MEGA RAID ★', viewer: 'Viewer' },
};
const curLang = () => (L10N[P.lang] ? P.lang : 'zh-TW');
function LX(key, ...a) { const v = L10N[curLang()][key] ?? L10N['zh-TW'][key]; return typeof v === 'function' ? v(...a) : v; }
const ppl = (n) => LX('ppl', n);
const isLatinTitle = () => !/[぀-ヿ㐀-鿿가-힯]/.test(CFG.title);   // 英文標題：直書構圖改成整行轉 90 度

// ---------- 句型（覆寫原本寫死中文的版本） ----------
function nameLine() { return CFG.n ? LX('nameGift', P.name, CFG.n) : LX('nameSub', P.name); }
const raidLineL = () => LX('raidLine', P.name, CFG.n);
const _setTierL = window.setTier;
window.setTier = function (id, v) {
  if (!P.name || P.name === '觀眾') P.name = LX('viewer');
  const d = _setTierL(id, v), raid = !!(window.RAID && RAID[id]), tt = L10N[curLang()].title[id] ?? L10N['zh-TW'].title[id];
  if (tt) CFG.title = tt.replace('{n}', CFG.n);
  if (raid) { CFG.sub1 = LX('sub1Raid', P.name); CFG.sub2 = LX('sub2Raid', CFG.n); CFG.medalText = LX('medal', CFG.n); CFG.ticker = LX('tickerR'); }
  else if (CFG.n) { CFG.sub1 = LX('sub1Gift', P.name); CFG.sub2 = LX('sub2Gift', CFG.n); CFG.medalText = null; }
  else { CFG.sub1 = LX('sub1Sub', P.name); CFG.sub2 = LX('sub2Sub'); }
  if (id === 'g100') CFG.ticker = `PREMIUM ★ ${CFG.title.replace(/!+$/, '')} ★`;
  return d;
};
window.setLang = function (l) { P.lang = LANGS.includes(l) ? l : 'zh-TW'; for (const k of Object.keys(_tw)) delete _tw[k]; setTier(CFG.id, CFG.v); fontsForName(); };
window.LANGS = LANGS;

// ---------- 字型 ----------
// 標題字型：日文、英文用 Dela Gothic One；繁中遇到 Dela 沒有的字整行換 Noto Sans TC；韓文用 Black Han Sans；簡中用 Noto Sans SC。
function titleFont(txt) {
  const l = curLang();
  if (l === 'ko') return "200px 'Black Han Sans', 'Noto Sans KR'";
  if (l === 'zh-CN') return "900 200px 'Noto Sans SC'";
  if (l === 'zh-TW' && DELA_MISSING.test(txt)) return "900 200px 'Noto Sans TC'";
  return "200px 'Dela Gothic One', 'Noto Sans TC'";
}
function titleW(txt) { const k = curLang() + '|' + txt; if (_tw[k]) return _tw[k]; g.save(); g.font = titleFont(txt); const w = g.measureText(txt).width; g.restore(); return (_tw[k] = w); }
// 內文字型：程式裡到處寫死 'Noto Sans TC'／'Dela Gothic One'，這裡在「設定字型」的時候統一改寫，不用每個地方都改：
//   ・韓文、簡中：把 Dela Gothic One 換成該語言的標題字型（Dela 是日文字型，沒有韓文、簡體字也不全）
//   ・所有語言：Noto Sans TC 後面補上日、韓、簡的 Noto 當備用，觀眾名字是哪一國文字都有粗體可用
(function patchCanvasFont() {
  const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font'); if (!d || d.__v2) return;
  const cache = new Map();
  const rewrite = (v) => {
    const l = curLang(), key = l + '|' + v; let out = cache.get(key); if (out) return out;
    out = v;
    if (l === 'ko') out = out.replace(/'Dela Gothic One'/, "'Black Han Sans', 'Noto Sans KR'").replace(/'LXGW WenKai TC'/, "'Gaegu', 'LXGW WenKai TC'");
    else if (l === 'zh-CN') out = out.replace(/^(?:(?:\d{3}|bold)\s+)?(\d+(?:\.\d+)?px)\s+'Dela Gothic One'/, "900 $1 'Noto Sans SC'");
    const first = { ja: "'Noto Sans JP', 'Noto Sans TC'", ko: "'Noto Sans KR', 'Noto Sans TC'", 'zh-CN': "'Noto Sans SC', 'Noto Sans TC'" }[l] || "'Noto Sans TC'";
    if (/'Noto Sans TC'/.test(out)) out = out.replace(/'Noto Sans TC'/, first) + ", 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC'";
    else out += ", 'Noto Sans TC', 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC'";
    if (cache.size > 600) cache.clear(); cache.set(key, out); return out;
  };
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, typeof v === 'string' ? rewrite(v) : v); } });
})();
const FONT_FAMS = ["150px 'Dela Gothic One'", "900 150px 'Noto Sans TC'", "900 150px 'Noto Sans JP'", "900 150px 'Noto Sans KR'", "900 150px 'Noto Sans SC'", "150px 'Black Han Sans'", "700 40px 'LXGW WenKai TC'", "700 40px 'Gaegu'"];
function fontsForName() { for (const f of FONT_FAMS) { try { document.fonts.load(f, P.name); } catch (e) {} } }   // 名字可能是任何語言：先叫瀏覽器把需要的字型分片抓回來
const _lvaL = window.loadVarAssets;
window.loadVarAssets = async function () {
  if (_lvaL) await _lvaL();
  const s = (window.__V2_TEXT || '') + P.name + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789×!?★…';
  for (const f of FONT_FAMS) { try { await document.fonts.load(f, s); } catch (e) {} }
};
const _setNameL = window.setName;
window.setName = (n) => { _setNameL(n); fontsForName(); };

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
