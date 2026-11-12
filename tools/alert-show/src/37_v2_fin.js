
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
