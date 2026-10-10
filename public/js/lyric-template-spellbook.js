/**
 * Elitesand Pro 排版模板：萬聖咒字（Halloween Spellbook）
 *
 * 一個模板、七種萬聖節逐字效果（加上「每句輪替」），由 spellbookEffect 選：
 *   rune     魔法陣：每字先展開小魔法陣，字在唱的那格從陣中彈出
 *   ouija    通靈板：指示器在字間滑行，滑到哪格、哪個字就在圓窗裡浮現
 *   bats     蝙蝠聚字：蝙蝠從四周聚到字的位置變成字，唱完再炸開飛走
 *   drip     滴落：字加速掉下、落地壓扁彈回，下緣慢慢垂出黏液，唱完融化
 *   talisman 符札：和紙符先展開，字逐一蓋上，唱完符撕成兩半掉落
 *   moon     月影：一輪小月亮當錨點，字先是逆光剪影，唱到才被月光照亮
 *   thread   蛛絲：句子掛在垂下的蛛絲上擺盪，唱完絲斷、句子掉出畫面
 *   cycle    每句輪替：上面七種依序輪流
 *
 * 通用設定全部照吃：字型／字級／字重／字距（--display-*、--lyric-letter-spacing）、
 * 文字色（--lyric-color）、唱中色（--lyric-color-active）、左右位置（lyricPosition：
 * 置中／偏左／偏右／左右分散）、位置微調（offsetX/Y）、左右邊距（paddingX）、動畫強度。
 * 上下位置是本模板自己的 spellbookPosition（下方／中央／上方）。
 *
 * 動態規則（逐格研究職業文字 PV 的結論）：
 *   - 字比唱出來早 2～3 格開始進場，唱的那格剛好到位；進場前 2～4 格完成七成（指數 ease-out）。
 *   - 停著的時候不凍結（漂移、擺盪、緩轉、微抖），出場加速、在最快處切掉。
 *   - 裝飾一律綁在字上，字走它就走，不放滿天粒子搶主播的戲。
 *
 * 完全時間驅動：每一幀只依 adjustedTimeMs 算出畫面，倒帶／大跳轉／暫停重建天然正確。
 * 一張全畫面 canvas，只重畫「目前句＋前後各一句」；每句的字寬量測有快取。
 */
(function () {
  if (typeof LyricTemplates === 'undefined') return;

  const EFFECTS = ['rune', 'ouija', 'bats', 'drip', 'talisman', 'moon', 'thread'];
  const F = 1 / 30;               // 一「格」= 1/30 秒，所有節奏參數以格為單位
  const OUTLINE = '#15101c';       // 深色描邊：任何遊戲背景上都讀得到
  const PAPER = '#efe4cc';
  const PAPER_INK = '#1d1410';

  let rootEl = null, canvas = null, g = null;
  let cssW = 0, cssH = 0, dpr = 1;
  let style = null;               // 從 CSS 變數讀到的通用外觀
  let cfg = { lyricPosition: 'center', offsetX: 0, offsetY: 0, paddingX: 60, animationIntensity: 'normal' };
  let linesRef = null, lines = [];
  let layoutCache = new Map();
  let styleGen = 0;
  let lastT = 0;
  let resizeObs = null;

  // ───────── 小工具 ─────────
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const eo = (t, t0, tau) => (t < t0 ? 0 : 1 - Math.exp(-(t - t0) / tau));           // 指數 ease-out
  const ei = (t, t0, d, p = 3) => (t <= t0 ? 0 : t >= t0 + d ? 1 : Math.pow((t - t0) / d, p)); // 加速
  const pop = (t, t0, from, tau = 1.3 * F) => (t < t0 ? from : 1 + (from - 1) * Math.exp(-(t - t0) / tau));
  const sstep = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));
  const frame = (t) => Math.floor(t * 30 + 1e-6);
  const hsh = (a, b) => {
    let h = (a * 374761393 + b * 668265263) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  function flag(key, fallback) {
    const v = document.body.dataset[key];
    return v === undefined ? fallback : v;
  }
  function intensity() {
    const v = document.body.dataset.lyricIntensity || cfg.animationIntensity || 'normal';
    return v === 'calm' ? 0.6 : v === 'chaotic' ? 1.45 : 1;
  }

  // 顏色：把任意 CSS 色正規化成 [r,g,b,a]，用來做「唱中色 → 文字色」漸變
  const colorCache = new Map();
  function rgba(c) {
    if (colorCache.has(c)) return colorCache.get(c);
    let out = [244, 234, 214, 1];
    try {
      const probe = document.createElement('canvas').getContext('2d');
      probe.fillStyle = '#000';
      probe.fillStyle = c;
      const s = probe.fillStyle;
      if (s[0] === '#') out = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
      else {
        const m = s.match(/[\d.]+/g);
        if (m) out = [+m[0], +m[1], +m[2], m[3] !== undefined ? +m[3] : 1];
      }
    } catch (_) { /* 保持預設 */ }
    colorCache.set(c, out);
    return out;
  }
  function mix(a, b, k) {
    const A = rgba(a), B = rgba(b);
    const r = Math.round(A[0] + (B[0] - A[0]) * k), gg = Math.round(A[1] + (B[1] - A[1]) * k), bb = Math.round(A[2] + (B[2] - A[2]) * k);
    return `rgba(${r},${gg},${bb},${(A[3] + (B[3] - A[3]) * k).toFixed(3)})`;
  }
  // 唱到的字先用唱中色出現，0.4 秒內回到文字色（唱中色因此只閃一下，維持稀有）
  function sungColor(t, ts) {
    const k = clamp((t - ts) / 0.4, 0, 1);
    return mix(style.active, style.color, sstep(k));
  }

  // ───────── 通用外觀（CSS 變數）─────────
  function readStyle() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
    const size = parseFloat(v('--display-font-size', '60')) || 60;
    style = {
      family: v('--display-font-family', "'Noto Sans TC', sans-serif"),
      weight: v('--display-font-weight', '900'),
      size: clamp(size, 16, 220),
      spacing: parseFloat(v('--lyric-letter-spacing', '1')) || 0,
      color: v('--lyric-color', '#f4ead6'),
      active: v('--lyric-color-active', '#ff9a3c'),
    };
    styleGen += 1;
    layoutCache = new Map();
  }
  function font(px) { return `${style.weight} ${Math.round(px)}px ${style.family}`; }

  // ───────── 歌詞與逐字時間 ─────────
  function visibleLines(ctx) {
    const list = ctx && typeof ctx.getLyrics === 'function' ? ctx.getLyrics() : [];
    return Array.isArray(list) ? list.filter((l) => l && typeof l.time === 'number' && l.text) : [];
  }
  function estimatedEnd(src, i) {
    const L = src[i];
    if (typeof L.endTime === 'number' && L.endTime > L.time) return L.endTime;
    if (typeof L.duration === 'number' && L.duration > 0) return L.time + L.duration;
    const n = Array.from(String(L.text || '')).length || 1;
    const est = L.time + Math.max(700, n * 300);
    const next = src[i + 1];
    return next && next.time > L.time ? Math.min(next.time, est) : est;
  }
  function graphemeTimes(line, src, idx, kernel) {
    const cs = Array.from(String(line.text || ''));
    if (Array.isArray(line.words) && line.words.length && kernel
      && typeof kernel.ensureWordTimings === 'function' && typeof kernel.buildGraphemeTimings === 'function') {
      const starts = [];
      let end = line.time;
      try {
        for (const w of kernel.ensureWordTimings(line, src, idx)) {
          for (const gr of kernel.buildGraphemeTimings(w)) {
            starts.push(Number(gr.startMs) || line.time);
            end = Math.max(end, Number(gr.endMs) || 0);
          }
        }
      } catch (_) { starts.length = 0; }
      if (starts.length === cs.length) return { cs, starts, end };
    }
    const end = estimatedEnd(src, idx);
    const per = (end - line.time) / Math.max(1, cs.length);
    return { cs, starts: cs.map((_, i) => line.time + per * i), end };
  }
  function ensureLines(ctx) {
    const src = visibleLines(ctx);
    if (src === linesRef && lines.length === src.length) return;
    linesRef = src;
    const kernel = ctx && ctx.kernel;
    lines = src.map((L, i) => {
      const gt = graphemeTimes(L, src, i, kernel);
      return { i, t: L.time / 1000, end: gt.end / 1000, cs: gt.cs, starts: gt.starts.map((s) => s / 1000) };
    });
    lines.forEach((L, i) => { L.next = lines[i + 1] ? lines[i + 1].t : Infinity; });
    layoutCache = new Map();
  }
  function lineIndexAt(t) {
    let lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= t + 0.6) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // ───────── 版面 ─────────
  const EXTRA = {   // 每種效果的字距加成（×字級）、句子前後要預留的寬度（×字級）
    rune: { gap: 0.5, pre: 0.5, post: 0.5 },
    ouija: { gap: 0.18, pre: 0.4, post: 0.6 },
    bats: { gap: 0.1, pre: 0.2, post: 0.2 },
    drip: { gap: 0.06, pre: 0.2, post: 0.2 },
    talisman: { gap: 0.16, pre: 1.15, post: 1.15 },
    moon: { gap: 0.1, pre: 2.9, post: 0.4 },
    thread: { gap: 0.08, pre: 0.2, post: 0.2 },
  };
  function effectOf(L) {
    const e = flag('spellbookEffect', 'rune');
    if (e === 'cycle') return EFFECTS[L.i % EFFECTS.length];
    return EFFECTS.includes(e) ? e : 'rune';
  }
  function sideOf(L) {
    const p = cfg.lyricPosition;
    if (p === 'left' || p === 'right') return p;
    if (p === 'split') return L.i % 2 === 0 ? 'left' : 'right';
    return 'center';
  }
  function layout(L) {
    const eff = effectOf(L);
    const key = `${L.i}|${eff}|${styleGen}|${cfg.lyricPosition}|${cfg.paddingX}|${cssW}|${cssH}|${flag('spellbookPosition', 'bottom')}|${cfg.offsetX}|${cfg.offsetY}`;
    const hit = layoutCache.get(key);
    if (hit) return hit;
    const ex = EXTRA[eff];
    let S = style.size;
    const side = sideOf(L);
    const padX = clamp(Number(cfg.paddingX) || 60, 0, cssW * 0.3);
    const avail = side === 'center' ? cssW - padX * 2 : cssW * 0.5 - padX;
    const measure = (size) => {
      g.font = font(size);
      let x = 0;
      const chars = L.cs.map((c, k) => {
        const w = c === ' ' || c === '　' ? size * 0.4 : g.measureText(c).width;
        const o = { c, x, w, t: L.starts[k], blank: /\s/.test(c) };
        x += w + style.spacing + size * ex.gap;
        return o;
      });
      const textW = Math.max(0, x - style.spacing - size * ex.gap);
      return { chars, textW, blockW: textW + size * (ex.pre + ex.post) };
    };
    let m = measure(S);
    if (m.blockW > avail && m.blockW > 0) {   // 太長就整句縮小，最小到原字級的 45%
      S = Math.max(style.size * 0.45, S * avail / m.blockW);
      m = measure(S);
    }
    let blockX;
    if (side === 'left') blockX = padX;
    else if (side === 'right') blockX = cssW - padX - m.blockW;
    else blockX = (cssW - m.blockW) / 2;
    const vpos = flag('spellbookPosition', 'bottom');
    let y = vpos === 'top' ? cssH * 0.2 : vpos === 'middle' ? cssH * 0.5 : cssH * 0.82;
    // 位置微調：使用者調的是意圖，實際收緊在畫面內
    const ox = clamp(Number(cfg.offsetX) || 0, -blockX + 8, cssW - 8 - (blockX + m.blockW));
    const oy = clamp(Number(cfg.offsetY) || 0, -y + S * 1.2, cssH - y - S * 0.9);
    blockX += ox; y += oy;
    const x0 = blockX + S * ex.pre;
    m.chars.forEach((c) => { c.cx = x0 + c.x + c.w / 2; });
    const out = { eff, S, u: S / 64, x0, y, textW: m.textW, blockX, blockW: m.blockW, side, chars: m.chars.filter((c) => !c.blank) };
    layoutCache.set(key, out);
    return out;
  }
  // 這句什麼時候開始退場：下一句前留足夠時間給新句進場，最晚唱完 1.2 秒
  function exitAt(L, lead) { return Math.min(L.next - lead, L.end + 1.2); }

  // ───────── 共用繪圖 ─────────
  function drawChar(c, x, y, sx, sy, fill, alpha, opts) {
    g.save();
    g.translate(x, y);
    if (opts && opts.rot) g.rotate(opts.rot);
    g.scale(sx, sy);
    g.globalAlpha = clamp(alpha, 0, 1);
    if (opts && opts.glow) { g.shadowColor = opts.glow; g.shadowBlur = opts.glowBlur || 16; }
    g.lineJoin = 'round';
    g.lineWidth = (opts && opts.outlineW) || Math.max(3, style.size * 0.13);
    g.strokeStyle = (opts && opts.outline) || OUTLINE;
    if (!(opts && opts.noOutline)) g.strokeText(c, 0, 0);
    g.fillStyle = fill;
    g.fillText(c, 0, 0);
    g.restore();
  }
  function bat(x, y, s, up, alpha) {
    g.save(); g.translate(x, y); g.scale(s, s); g.globalAlpha = alpha == null ? 1 : alpha;
    g.fillStyle = '#120d18'; g.strokeStyle = 'rgba(243,234,214,.85)'; g.lineWidth = 2;
    const w = up ? -14 : 8;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-18, w, -34, w - 4); g.quadraticCurveTo(-24, 4, -14, 8); g.quadraticCurveTo(-6, 4, 0, 10);
    g.quadraticCurveTo(6, 4, 14, 8); g.quadraticCurveTo(24, 4, 34, w - 4); g.quadraticCurveTo(18, w, 0, 0);
    g.fill(); g.stroke(); g.restore();
  }

  // ───────── 效果：魔法陣 ─────────
  function rune(x, y, r, rot, a, col) {
    g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha = clamp(a, 0, 1);
    g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 10;
    g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, r * 0.82, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 24; k++) {
      const an = k * Math.PI / 12, l = k % 3 ? r * 0.08 : r * 0.18;
      g.beginPath(); g.moveTo(Math.cos(an) * r * 0.82, Math.sin(an) * r * 0.82); g.lineTo(Math.cos(an) * (r * 0.82 + l), Math.sin(an) * (r * 0.82 + l)); g.stroke();
    }
    g.lineWidth = 1.4; g.beginPath();
    for (let k = 0; k <= 5; k++) { const an = -Math.PI / 2 + k * Math.PI * 4 / 5; const px = Math.cos(an) * r * 0.8, py = Math.sin(an) * r * 0.8; if (k) g.lineTo(px, py); else g.moveTo(px, py); }
    g.stroke(); g.restore();
  }
  function drawRune(L, t) {
    const lay = layout(L), S = lay.S, ex = exitAt(L, 0.25), ta = L.t - 8 * F;
    if (t < ta || t > ex + 10 * F) return;
    const out = t >= ex ? ei(t, ex, 8 * F, 2) : 0, grow = 0.3 + 0.7 * eo(t, ta, 3 * F);
    g.save(); g.globalAlpha = 0.55 * (1 - out); g.fillStyle = style.active;
    g.fillRect(lay.x0 - S * 0.6, lay.y + S * 0.72, (lay.textW + S * 1.2) * grow, Math.max(1.5, S * 0.03)); g.restore();
    g.font = font(S); g.textAlign = 'center'; g.textBaseline = 'middle';
    const R = S * 0.78;
    lay.chars.forEach((c, j) => {
      const tr = c.t - 6 * F; if (t < tr) return;
      let r = Math.min(R, 2 * Math.pow(2, (t - tr) / F));            // 每格放大 2 倍
      const settle = t >= c.t ? eo(t, c.t + 4 * F, 0.5) : 0;
      r *= 1 - 0.25 * settle;
      let ra = 1 - 0.6 * settle, a = 1, up = 0;
      const rot = (t - tr) * (1.8 - 1.2 * settle) + j;
      if (t >= ex) { const q = ei(t, ex + (j % 4) * F, 8 * F, 2.2); r *= 1 + 2.5 * q; ra *= 1 - q; a = 1 - q; up = -S * 0.8 * q; }
      rune(c.cx, lay.y + S * 0.05, r, rot, ra, style.active);
      const ts = c.t - 2 * F;
      if (t >= ts) {
        const s = pop(t, ts, 1 + 0.6 * intensity());
        drawChar(c.c, c.cx, lay.y + up + Math.sin(t * 2 + j) * S * 0.03, s, s, sungColor(t, ts), a, { glow: style.active, glowBlur: 14 });
      }
    });
  }

  // ───────── 效果：通靈板 ─────────
  function planchette(x, y, s, rot) {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
    g.beginPath(); g.moveTo(0, -92); g.bezierCurveTo(62, -80, 78, 10, 0, 74); g.bezierCurveTo(-78, 10, -62, -80, 0, -92); g.closePath();
    g.moveTo(36, -6); g.arc(0, -6, 36, 0, Math.PI * 2, true);
    g.fillStyle = 'rgba(236,222,196,.93)'; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 14; g.shadowOffsetY = 5; g.fill('evenodd');
    g.shadowColor = 'transparent'; g.strokeStyle = '#3a2416'; g.lineWidth = 3; g.stroke();
    g.beginPath(); g.arc(0, -6, 42, 0, Math.PI * 2); g.strokeStyle = '#8a5a2b'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#3a2416'; [[-20, 41], [20, 41], [0, -38]].forEach(([a, b]) => { g.beginPath(); g.arc(a, b, 4, 0, Math.PI * 2); g.fill(); });
    g.restore();
  }
  function drawOuija(L, t) {
    const lay = layout(L), S = lay.S, ex = exitAt(L, 0.3), ta = L.t - 12 * F;
    if (t < ta || t > ex + 12 * F || !lay.chars.length) return;
    const cs = lay.chars, sc = S / 52, y = lay.y;
    const enterX = lay.side === 'right' ? cssW + S * 3 : lay.blockX - S * 3;
    let k = -1;
    for (let j = 0; j < cs.length; j++) if (t >= cs[j].t - 9 * F) k = j;
    let px = enterX, py = y + 6 * sc, rot = -0.2;
    if (k >= 0) {
      const c = cs[k], arr = c.t - 2 * F, dep = Math.max(arr - 0.22, k ? cs[k - 1].t - 2 * F : ta);
      const from = k ? cs[k - 1].cx : enterX;
      const p = sstep((t - dep) / Math.max(1e-3, arr - dep));
      px = from + (c.cx - from) * p; py = y + 6 * sc - Math.sin(p * Math.PI) * S * 0.45 * intensity();
      rot = Math.sign(c.cx - from) * 0.12 * Math.sin(p * Math.PI);
    }
    if (t >= ex) { const q = ei(t, ex, 10 * F, 2.4); px += (lay.side === 'right' ? -1 : 1) * cssW * 0.75 * q; py -= S * 1.6 * q; rot += 0.5 * q; }
    px += Math.sin(t * 9) * 1.5; py += Math.cos(t * 7) * 1.5;   // 停著也會微微抖
    g.font = font(S); g.textAlign = 'center'; g.textBaseline = 'middle';
    cs.forEach((c, j) => {
      const ts = c.t - 2 * F; if (t < ts) return;
      const s = pop(t, ts, 1 + 0.35 * intensity(), 1.4 * F);
      let a = j === k ? 1 : 0.85, dy = 0;
      if (t >= ex) { const q = ei(t, ex + j * 0.6 * F, 8 * F, 2.2); a *= 1 - q; dy = -S * 0.9 * q; }
      drawChar(c.c, c.cx, y + dy, s, s, sungColor(t, ts), a);
    });
    planchette(px, py, sc, rot);
  }

  // ───────── 效果：蝙蝠聚字 ─────────
  function drawBats(L, t) {
    const lay = layout(L), S = lay.S, ex = exitAt(L, 0.25), ta = L.t - 12 * F;
    if (t < ta || t > ex + 14 * F) return;
    const y = lay.y, n = Math.round(3 + 2 * intensity()), bs = S / 45;
    g.font = font(S); g.textAlign = 'center'; g.textBaseline = 'middle';
    lay.chars.forEach((c, j) => {
      const tm = c.t - F, tb = tm - 9 * F; if (t < tb) return;
      if (t < tm) {          // 蝙蝠以「越近越慢」的指數曲線聚攏
        const p = eo(t, tb, 2.2 * F);
        for (let b = 0; b < n; b++) {
          const an = hsh(j * 7 + b, L.i) * Math.PI * 2, r = S * (3.4 + 2.5 * hsh(b, j));
          bat(c.cx + Math.cos(an) * r * (1 - p), y + Math.sin(an) * r * 0.6 * (1 - p) - S * 0.3, bs * (1 - p * 0.55), frame(t + b * F) % 2 === 0);
        }
        return;
      }
      const s = pop(t, tm, 1 + 0.45 * intensity(), 1.5 * F);
      let a = 1;
      if (t >= ex) {
        const q = ei(t, ex + (j % 4) * F, 10 * F, 2);
        a = 1 - Math.min(1, q * 3);
        for (let b = 0; b < n; b++) {
          const an = hsh(j * 7 + b, L.i + 9) * Math.PI * 2, d = cssW * 0.5 * q;
          bat(c.cx + Math.cos(an) * d, y + Math.sin(an) * d * 0.6 - q * S * 3, bs * (0.75 + q * 0.9), frame(t + b * F) % 2 === 0);
        }
      }
      if (a > 0) drawChar(c.c, c.cx, y + Math.sin((t - tm) * 2.2 + j) * S * 0.04, s, s, sungColor(t, tm), a);
    });
  }

  // ───────── 效果：滴落 ─────────
  function drawDrip(L, t) {
    const lay = layout(L), S = lay.S, ex = exitAt(L, 0.2), ta = L.t - 8 * F;
    if (t < ta || t > ex + 12 * F) return;
    const y = lay.y, k = intensity();
    g.font = font(S); g.textAlign = 'center'; g.textBaseline = 'middle';
    lay.chars.forEach((c, j) => {
      const tl = c.t - 2 * F, tf = tl - 6 * F; if (t < tf) return;
      let dy = t < tl ? -S * 3.6 * k * (1 - Math.pow((t - tf) / (6 * F), 2)) : 0, sx = 0.88, sy = 1.16;   // 加速掉落，唱的那格落地
      if (t >= tl) { const d = (t - tl) / F, w = Math.exp(-d / 2) * Math.cos(d * 1.1); sx = 1 + 0.28 * k * w; sy = 1 - 0.3 * k * w; }
      let a = 1, melt = 0;
      if (t >= ex) { melt = ei(t, ex + (j % 5) * F, 9 * F, 2.2); a = 1 - ei(t, ex + (j % 5) * F + 5 * F, 4 * F, 1); }
      drawChar(c.c, c.cx, y + dy + melt * S * 2, sx * (1 - melt * 0.25), sy * (1 + melt * 1.4), sungColor(t, tl), a);
      if (t >= tl && hsh(L.i * 31 + j, 7) < 0.45) {   // 部分字垂出黏液，越垂越慢
        const gg = eo(t, tl + 3 * F, 0.7), len = S * (0.55 + 1.1 * hsh(j, L.i)) * gg * (1 - melt), dx = c.cx - S * 0.15 + S * 0.3 * hsh(j, 3), top = y + S * 0.46;
        g.save(); g.globalAlpha = clamp(a, 0, 1); g.fillStyle = style.active; g.strokeStyle = OUTLINE; g.lineWidth = Math.max(2, S * 0.04);
        g.beginPath(); g.moveTo(dx - S * 0.16, top - S * 0.06); g.quadraticCurveTo(dx - S * 0.1, top + S * 0.06, dx - S * 0.1, top + len);
        g.arc(dx, top + len, S * (0.1 + 0.07 * gg), Math.PI, 0, true); g.quadraticCurveTo(dx + S * 0.1, top + S * 0.06, dx + S * 0.16, top - S * 0.06); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(dx - S * 0.03, top + len - S * 0.03, S * 0.03, 0, Math.PI * 2); g.fill(); g.restore();
      }
    });
  }

  // ───────── 效果：符札 ─────────
  function drawTalisman(L, t, exiting) {
    const lay = layout(L), S = lay.S, ta = L.t - 8 * F, tearT = exitAt(L, 0.15);
    if (t < ta || t > tearT + 8 * F) return;
    if (!!exiting !== (t >= tearT)) return;     // 退場中的符畫在新符上面
    const sw = lay.blockW, sh = S * 1.8, x0 = lay.blockX, y = lay.y;
    const gw = 0.3 + 0.7 * eo(t, ta, 3 * F), drift = t - ta, rot = (-1.4 + 0.18 * drift) * Math.PI / 180, dy = -S * 0.07 * drift;
    const tear = ei(t, tearT, 8 * F, 2.4);
    const halves = t >= tearT ? [0, 1] : [-1];
    const sealIdx = L.i % 4 === 3 ? lay.chars.length - 1 : -1;   // 每四句只蓋一次朱印
    for (const half of halves) {
      g.save(); g.translate(x0, y + dy); g.rotate(rot);
      if (half >= 0) {
        g.translate(half ? S * 0.6 * tear : -S * 0.45 * tear, S * 7.5 * tear); g.rotate((half ? 9 : -7) * tear * Math.PI / 180);
        const seam = sw * 0.52; g.beginPath();
        if (half === 0) { g.moveTo(-10, -sh); for (let k = 0; k <= 8; k++) g.lineTo(seam + (k % 2 ? 14 : -14), -sh / 2 + k * sh / 8); g.lineTo(-10, sh); }
        else { g.moveTo(sw + 10, -sh); for (let k = 0; k <= 8; k++) g.lineTo(seam + (k % 2 ? 14 : -14), -sh / 2 + k * sh / 8); g.lineTo(sw + 10, sh); }
        g.closePath(); g.clip();
      }
      const w = sw * gw;
      g.fillStyle = PAPER; g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 18; g.shadowOffsetY = 6; g.fillRect(0, -sh / 2, w, sh); g.shadowColor = 'transparent';
      g.strokeStyle = '#b8322a'; g.lineWidth = 3; g.strokeRect(10, -sh / 2 + 10, Math.max(0, w - 20), sh - 20);
      g.lineWidth = 1.2; g.strokeRect(18, -sh / 2 + 18, Math.max(0, w - 36), sh - 36);
      g.fillStyle = 'rgba(120,90,50,.10)'; for (let k = 0; k < 26; k++) g.fillRect((k * 97) % Math.max(1, w), -sh / 2 + ((k * 53) % sh), 18, 1.5);
      g.font = font(S); g.textAlign = 'center'; g.textBaseline = 'middle';
      lay.chars.forEach((c, j) => {
        const ts = c.t - 3 * F; if (t < ts) return;
        const cx = c.cx - x0; if (cx > w - 20) return;
        const s = pop(t, ts, 1 + 0.22 * intensity());
        drawChar(c.c, cx, S * 0.05, s, s, PAPER_INK, 1, { noOutline: true });
        if (j === sealIdx && t >= c.t + 2 * F) {
          const s2 = pop(t, c.t + 2 * F, 1.9, 1.4 * F), R = S * 0.5;
          g.save(); g.translate(cx + c.w / 2 + R * 0.9, -S * 0.42); g.rotate(-0.14); g.scale(s2, s2);
          g.strokeStyle = style.active; g.lineWidth = Math.max(3, S * 0.07); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
          g.fillStyle = style.active; g.font = `700 ${Math.round(R)}px ${style.family}`; g.fillText('呪', 0, 2); g.restore();
        }
      });
      g.restore();
    }
  }

  // ───────── 效果：月影 ─────────
  function moonAnchor(L) {
    const lay = layout(L);
    return { x: lay.blockX + lay.S * 1.35, y: lay.y, R: lay.S * 1.3 };
  }
  function drawMoonDisc(x, y, r) {
    g.save(); g.translate(x, y);
    const mg = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r); mg.addColorStop(0, '#fffaf0'); mg.addColorStop(1, '#e9dcc0');
    g.shadowColor = 'rgba(255,240,210,.55)'; g.shadowBlur = 40; g.fillStyle = mg; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    g.fillStyle = 'rgba(167,123,255,.16)';
    [[-0.3, 0.2, 0.22], [0.35, -0.25, 0.16], [0.15, 0.45, 0.12], [-0.45, -0.35, 0.1]].forEach(([a, b, c]) => { g.beginPath(); g.arc(a * r, b * r, c * r, 0, Math.PI * 2); g.fill(); });
    g.restore();
  }
  function drawMoon(L, t, persistent) {
    const lay = layout(L), S = lay.S, ex = Math.min(L.next - 0.42, L.end + 1.2), ta = L.t - 8 * F;
    if (t < ta || t > ex + 8 * F) return;
    const m = moonAnchor(L), x0 = lay.x0, y = lay.y;
    const gw = 0.3 + 0.7 * eo(t, ta, 3 * F), out = ei(t, ex, 8 * F, 2.2);
    const bw = (x0 + lay.textW + S * 1.8 - m.x) * gw;
    const lg = g.createLinearGradient(m.x, 0, m.x + Math.max(1, bw), 0);
    lg.addColorStop(0, 'rgba(243,234,214,.42)'); lg.addColorStop(1, 'rgba(243,234,214,0)');
    g.save(); g.globalAlpha = 1 - out; g.fillStyle = lg; g.fillRect(m.x, y - S * 0.9, bw, S * 1.8); g.restore();
    g.font = font(S); g.textAlign = 'center'; g.textBaseline = 'middle';
    const sway = Math.sin((t - ta) * 1.3) * S * 0.03;
    lay.chars.forEach((c, j) => {
      const ts = ta + j * 2 * F; if (t < ts) return;
      const lit = t >= c.t - 2 * F;
      const s = lit ? pop(t, c.t - 2 * F, 1 + 0.12 * intensity()) : pop(t, ts, 1.25, 1.5 * F);
      const cx = c.cx + cssW * 0.45 * out * (0.6 + j * 0.03), cy = y + sway - S * 2.5 * out * (0.5 + j * 0.03);
      if (lit) drawChar(c.c, cx, cy, s, s, style.color, 1 - out * 0.6, { outline: 'rgba(243,234,214,.75)', outlineW: Math.max(2, S * 0.05), glow: style.active, glowBlur: 18 });
      else drawChar(c.c, cx, cy, s, s, '#16101f', 1 - out * 0.6, { outline: 'rgba(243,234,214,.75)', outlineW: Math.max(2, S * 0.05) });
    });
    if (t >= ex - 2 * F) {      // 蝙蝠從月亮飛出，帶走這句
      const p = ei(t, ex - 2 * F, 12 * F, 2.2);
      if (p < 1) [[0, -1.1, 1], [0.4, -0.7, 0.8], [-0.3, -1.4, 0.7], [0.8, -1.0, 0.9], [0.2, -1.6, 0.6]].forEach(([bx, by, bs], j) => {
        const d = cssW * 0.65 * p * (0.8 + j * 0.1);
        bat(m.x + bx * d + d * 0.9, m.y - S * 0.4 + by * d * 0.55, (S / 40) * (bs + 0.5 * p), frame(t) % 2 === 0);
      });
    }
    if (!persistent) {          // 每句輪替時月亮跟著這句進出
      const k = (t - (L.t - 10 * F)) / F;
      const r = Math.min(m.R, 1.5 * Math.pow(2, Math.max(0, k))) * (1 - out);
      if (r > 0.5) drawMoonDisc(m.x, m.y, r);
    }
  }
  // 固定月影：整首歌一輪月亮（第一句前從一點每格放大 2 倍到位，每換一句輕跳一下）
  function drawPersistentMoon(t, idx) {
    const first = lines[0], last = lines[lines.length - 1];
    if (!first) return;
    const tm = first.t - 10 * F; if (t < tm) return;
    // 跟著目前句的位置走：換句時從上一句的錨點以 ease-out 滑過去，不瞬移
    let ci = 0;
    for (let i = 0; i < lines.length; i++) { if (lines[i].t - 10 * F <= t) ci = i; else break; }
    const cur = moonAnchor(lines[ci]), prev = ci > 0 ? moonAnchor(lines[ci - 1]) : cur;
    const p = eo(t, lines[ci].t - 10 * F, 3 * F);
    const m = { x: prev.x + (cur.x - prev.x) * p, y: prev.y + (cur.y - prev.y) * p, R: prev.R + (cur.R - prev.R) * p };
    const gone = ei(t, last.end + 2, 8 * F, 2.2);
    if (gone >= 1) return;
    let r = Math.min(m.R, 1.5 * Math.pow(2, (t - tm) / F)) * (1 - gone);
    let bump = 1;
    for (const L of lines) { if (L.t - 6 * F > t) break; bump = 1 + 0.07 * Math.exp(-(t - (L.t - 6 * F)) / (2 * F)); }
    r *= bump * (1 + 0.012 * Math.sin(t * 1.7));
    drawMoonDisc(m.x, m.y, r);
  }

  // ───────── 效果：蛛絲 ─────────
  function spider(x, y, s, leg) {
    g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = '#0d0a12'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
      const a = (-0.6 + i * 0.4) + (i % 2 ? leg : -leg) * 0.12;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(sd * 14, -10 + i * 6, sd * (24 + i * 2), (i - 1.5) * 10 + 8 * Math.sin(a)); g.stroke();
    }
    g.fillStyle = '#0d0a12'; g.beginPath(); g.ellipse(0, 4, 10, 13, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(0, -9, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,246,232,.7)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(0, 4, 10, 13, 0, 0, Math.PI * 2); g.stroke(); g.restore();
  }
  function web(corner, t, s) {
    g.save(); g.translate(corner === 'right' ? cssW : 0, 0); if (corner === 'right') g.scale(-1, 1);
    g.rotate(Math.sin(t * 0.9) * 0.006); g.strokeStyle = 'rgba(255,246,232,.22)'; g.lineWidth = 1.5;
    const R = 300 * s;
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 10; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.stroke(); }
    for (let r = R * 0.2; r <= R * 0.94; r += R * 0.18) {
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 10, rr = r * (i % 2 ? 0.93 : 1); if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.stroke();
    }
    g.restore();
  }
  function drawThread(L, t) {
    const lay = layout(L), S = lay.S, ex = exitAt(L, 0.15), ta = L.t - 10 * F;
    if (t < ta || t > ex + 12 * F) return;
    const ax = lay.x0 + lay.textW / 2, len = Math.max(S, lay.y - S * 1.1);
    const drop = 0.3 + 0.7 * eo(t, ta, 3 * F), snap = t >= ex, fall = snap ? ei(t, ex, 10 * F, 2) : 0;
    const st = t - ta, k = intensity();
    const th = (5 * k * Math.exp(-st / 1.1) * Math.sin(st * 2 * Math.PI / 1.5) + 0.5 * Math.sin(st * 1.4)) * Math.PI / 180 * Math.min(1, 300 / len);
    g.save(); g.translate(ax, 0); g.rotate(th);
    const tl = len * drop;
    g.strokeStyle = 'rgba(255,246,232,.75)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, snap ? tl * (1 - ei(t, ex, 4 * F, 1)) : tl); g.stroke();
    if (!snap) spider(0, tl - S * 0.1, S / 42, Math.sin(t * 14));
    g.translate(0, tl + S * 1.1 + fall * cssH); g.rotate(fall * 0.5);
    g.fillStyle = 'rgba(255,246,232,.8)'; g.beginPath(); g.arc(0, -S * 0.75, 4, 0, Math.PI * 2); g.fill();
    g.font = font(S); g.textAlign = 'center'; g.textBaseline = 'middle';
    lay.chars.forEach((c) => {
      const ts = c.t - 3 * F; if (t < ts) return;
      const s = pop(t, ts, 1 + 0.18 * k);
      drawChar(c.c, c.cx - ax, 0, s, s, sungColor(t, ts), 1);
    });
    g.restore();
  }

  // ───────── 每幀 ─────────
  const DRAW = { rune: drawRune, ouija: drawOuija, bats: drawBats, drip: drawDrip, moon: drawMoon, thread: drawThread };
  function render(ctx, timeMs) {
    if (!g || !style) return;
    ensureLines(ctx);
    const t = timeMs / 1000;
    lastT = t;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    if (!lines.length) return;
    const idx = lineIndexAt(t);
    const cand = [];
    for (let i = Math.max(0, idx - 1); i <= Math.min(lines.length - 1, idx + 1); i++) cand.push(lines[i]);
    const effMode = flag('spellbookEffect', 'rune');
    if (effMode === 'thread' || (effMode === 'cycle' && cand.some((L) => effectOf(L) === 'thread'))) {
      const anyThread = cand.find((L) => effectOf(L) === 'thread');
      if (anyThread) web(layout(anyThread).x0 + layout(anyThread).textW / 2 > cssW / 2 ? 'right' : 'left', t, style.size / 64);
    }
    // 符札：退場中的畫在最上面
    for (const L of cand) if (effectOf(L) === 'talisman') drawTalisman(L, t, false);
    for (const L of cand) if (effectOf(L) === 'talisman') drawTalisman(L, t, true);
    for (const L of cand) {
      const eff = effectOf(L);
      if (eff === 'talisman') continue;
      if (eff === 'moon') drawMoon(L, t, effMode === 'moon');
      else DRAW[eff](L, t);
    }
    if (effMode === 'moon') {
      drawPersistentMoon(t, idx);
    }
  }

  function resize() {
    if (!canvas || !rootEl) return;
    const w = rootEl.clientWidth || window.innerWidth, h = rootEl.clientHeight || window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === cssW && h === cssH && canvas.width === Math.round(w * dpr)) return;
    cssW = w; cssH = h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    layoutCache = new Map();
  }

  LyricTemplates.register({
    id: 'spellbook',
    label: '萬聖咒字',

    settings: [
      { key: 'spellbookEffect', type: 'enum', values: ['rune', 'ouija', 'bats', 'drip', 'talisman', 'moon', 'thread', 'cycle'], default: 'rune', target: 'data:spellbookEffect' },
      { key: 'spellbookPosition', type: 'enum', values: ['bottom', 'middle', 'top'], default: 'bottom', target: 'data:spellbookPosition' },
    ],

    mount(container) {
      rootEl = document.createElement('div');
      rootEl.id = 'spellbook-root';
      canvas = document.createElement('canvas');
      canvas.className = 'sb-canvas';
      // 尺寸不靠外部 CSS：容器一定撐滿、canvas 一定跟容器同大（display.css 只是同一份保險）
      rootEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
      rootEl.appendChild(canvas);
      container.appendChild(rootEl);
      g = canvas.getContext('2d');
      cssW = cssH = 0;
      resize();
      readStyle();
      linesRef = null; lines = [];
      if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(() => { resize(); });
        resizeObs.observe(rootEl);
      }
    },

    destroy() {
      if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = canvas = g = null;
      linesRef = null; lines = []; layoutCache = new Map();
    },

    onLyricsLoaded() {
      linesRef = null; lines = []; layoutCache = new Map();
      if (g) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); }
    },

    onSettings(settings, ctx) {
      if (settings && typeof settings === 'object') {
        cfg = {
          lyricPosition: ['left', 'right', 'center', 'split'].includes(settings.lyricPosition) ? settings.lyricPosition : 'center',
          offsetX: Number(settings.offsetX) || 0,
          offsetY: Number(settings.offsetY) || 0,
          paddingX: Number.isFinite(Number(settings.paddingX)) ? Number(settings.paddingX) : 60,
          animationIntensity: settings.animationIntensity || 'normal',
        };
      }
      // 字型可能剛載入完成：下一幀重量一次字寬
      readStyle();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (g) readStyle(); });
      if (ctx && typeof ctx.getCurrentTimeMs === 'function') render(ctx, ctx.getCurrentTimeMs());
    },

    onSeek(timeMs, ctx) { render(ctx, timeMs); },
    onFrame(timeMs, ctx) { render(ctx, timeMs); },
  });
})();
