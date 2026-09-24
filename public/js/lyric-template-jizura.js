/**
 * Elitesand Pro 排版模板：文字PV（引擎：JIZURA 字面，MIT，Copyright (c) 2026 hakoniwa）
 *
 * JIZURA 是整首歌「先規劃、再逐幀繪製」的文字 PV 引擎（public/vendor/jizura/）。這支檔案
 * 只做 Elitesand 這邊的轉接，不改引擎本身：
 *
 *   1. 歌詞 → LRC 文字 → J.plan()：整首歌一次規劃成一串 cut（版面／進場／退場／裝飾）。
 *   2. 段落分析（track.sections）→ 三種強度 profile（安靜／蓄力／高潮）。引擎的強度與
 *      可用部品是整首共用的，所以每種 profile 各規劃一次，再依「這句落在哪個段落」挑 cut
 *      合併成一份 plan；每個 cut 記著自己 profile 的 fx，繪製前換上。
 *   3. 每幀 J.Renderer#frame(ctx, plan, t, {transparent:true}) 畫進自己的 canvas。
 *
 * 直播疊加的限制（鐵則 #11、不可搶主播的戲）：
 *   - transparent 模式本來就不畫背景圖形（61 個 bg 自動排除）；HUD、轉場也關掉。
 *   - 只用白名單內的 layout：2026-09-24 逐一在透明模式畫一幀量不透明像素，覆蓋率
 *     ≤25% 才收（全畫面 16:9 量）。字幕帯／障子／便箋這類會整面蓋住主播的版面一律不用。
 *     新增引擎版本時要重跑稽核再更新清單。
 *   - 預設偏右：畫布仍是全畫面（裝飾照常鋪滿），只把每個 cut 的內容往右推到不超出畫面為止，
 *     避開站在畫面中間的 VTuber；可改偏左或置中（全畫面）。
 *   - 動作預設每幀更新（流暢）；可改回引擎原本的 2 コマ打ち（每秒 12 張的作畫感）。
 *   - 文字色／強調色吃面板設定（--lyric-color／--lyric-color-active），並關掉引擎的
 *     scheme 切換——引擎的配色是「底色＋字色」一組，透明疊加時底色不存在，淺底 scheme
 *     會變成深色字壓在直播畫面上。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof J === 'undefined' || typeof J.plan !== 'function' || typeof J.Renderer !== 'function') {
    console.warn('[文字PV] JIZURA 引擎未載入，模板停用');
    return;
  }

  // 覆蓋率 ≤25% 的 layout（見檔頭）。畫布一律全畫面 16:9（偏左／偏右只移動歌詞本身，見 cutOffset）。
  // 影絵（shadowPlay）雖然過了覆蓋率門檻，本質是一塊不透明的深色幕布，非常突兀，手動排除。
  const SAFE_LAYOUTS_LANDSCAPE = [
    'center', 'mixed', 'vcols', 'marquee', 'scatter', 'ring', 'wave', 'labels', 'condensed', 'type', 'diag',
    'circle', 'pill', 'lowerThird', 'corners', 'staircase', 'zigzag', 'arcTop', 'spiral', 'gridCells', 'dropCap',
    'justified', 'frameBox', 'bubble', 'ticker', 'mirror', 'sideways', 'edgeFrame', 'perspective', 'hanko',
    'genkou', 'quote', 'ruler', 'searchBar', 'chat', 'notification', 'ticket', 'rain', 'hanging', 'orbit',
    'tunnel', 'wordCloud', 'bounceLine', 'elastic', 'stickerBomb', 'neon', 'bubbles', 'slotMachine', 'flipBoard',
    'credits', 'splitHalves', 'columnsBig', 'circleWords', 'depthStack', 'typeSpecimen', 'kanjiFocus',
    'halfVertical', 'curtain', 'equalizer', 'tape', 'headlineDeck', 'contents', 'footnote', 'proofread',
    'numbered', 'poster', 'swissGrid', 'dictionary', 'routeMap', 'tanzaku', 'kakejiku', 'priceTag', 'cylinder',
    'ribbon', 'pendulum', 'balloons', 'fisheye', 'origami', 'sliceStack', 'maskReveal', 'stencil',
  ];
  // 安靜段落（主歌／前奏／尾奏）只用這幾個：字小、動作少、沒有貼紙或圖形板。
  // 縦倒し／大小縦組／大きな頭文字 實測字太大、太搶，不收。
  const QUIET_LAYOUTS = ['center', 'vcols', 'type', 'lowerThird', 'quote', 'footnote', 'headlineDeck',
    'halfVertical', 'typeSpecimen', 'credits', 'genkou'];

  // 段落標籤（track-schema 的 sanitizeSections 已轉小寫＋底線）→ profile
  const PROFILE_OF_SECTION = {
    intro: 'quiet', verse: 'quiet', outro: 'quiet', inst: 'quiet', silence: 'quiet', start: 'quiet', end: 'quiet',
    pre_chorus: 'build', bridge: 'build',
    chorus: 'loud', post_chorus: 'loud',
  };
  const PROFILES = {
    quiet: { fx: { motion: 0.35, glitch: 0.05, chroma: 0.25, decor: 0.2, density: 0.3, koma: 0 }, quietOnly: true },
    build: { fx: { motion: 0.6, glitch: 0.2, chroma: 0.5, decor: 0.45, density: 0.5, koma: 12 } },
    loud: { fx: { motion: 0.95, glitch: 0.35, chroma: 0.7, decor: 0.75, density: 0.75, koma: 12 }, impactFirst: true },
  };
  // 沒有段落分析的歌：整首用中間強度
  const DEFAULT_PROFILE = 'build';
  const INTENSITY_SCALE = { calm: 0.6, normal: 1, chaotic: 1.25 };
  const SMOOTH_KOMA = 30;

  let rootEl = null;
  let canvas = null;
  let ctx2d = null;
  let renderer = null;
  let plan = null;
  let planKey = '';
  let fontsReadyFor = '';
  let lastStepKey = '';
  let resizeHandler = null;
  let lastDrawn = null; // 除錯用：最後一次實際畫的 cut
  let lastDrawnT = 0;

  // ─── 小工具 ───

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_) { return fallback; }
  }

  // 面板的顏色可能是 #rgb／rgba()／色名；引擎的對比計算只吃 #rrggbb
  const colorProbe = document.createElement('canvas').getContext('2d');
  function toHex(color, fallback) {
    if (!colorProbe) return fallback;
    colorProbe.fillStyle = '#000000';
    colorProbe.fillStyle = color || fallback;
    const v = colorProbe.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    if (!m) return fallback;
    return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function placement() {
    const v = document.body.dataset.jizuraPlacement;
    return v === 'left' || v === 'full' ? v : 'right';
  }

  // ─── 偏左／偏右：畫布維持全畫面，只把「這個 cut 的內容」整組往側邊推 ───
  // 不縮小畫布：縮成窄欄時裝飾（光線、紙片、長線條）碰到畫布邊緣會被切出一條明顯的邊界
  // （實機回報）。改用引擎的鏡頭位移（cam.x）把版面連同它附帶的框線／貼紙一起平移，
  // 位移量逐 cut 決定：先在小畫布上畫一次量出內容實際的左右範圍，只推到不會超出畫面為止——
  // 窄的版面推滿，橫跨整個畫面的版面（跑馬燈之類）少推或不推。
  // 目標：內容中心對到畫面寬的 72%（偏右）／28%（偏左）。不是固定推 N%——版面本身可能就把字
  // 放在另一側（例如靠左的印章版面），固定位移推完還在錯的那一邊。
  const TARGET_CENTER = { 1: 0.72, '-1': 0.28 };
  const EDGE_MARGIN = 0.03;      // 推完之後離畫面邊緣至少留 3%
  let measuring = false;
  let measureCtx = null;
  let measureRenderer = null;

  function sideSign() {
    const m = placement();
    return m === 'right' ? 1 : m === 'left' ? -1 : 0;
  }

  // 內容在設計座標裡的左右範圍與中心（取「進場完成後」與「cut 中段」兩個時間點）。
  // 用每一欄的不透明像素量的分布來算（累積 3%～97% 當範圍、50% 當中心），不是最左／最右的
  // 那個像素：吊牌版面的吊線、角落的小編號只佔很少像素，卻會把範圍撐成全寬、讓整句推不動。
  function measureCutExtent(p, cut) {
    if (!measureCtx) {
      const c = document.createElement('canvas');
      c.width = 192; c.height = 108;
      measureCtx = c.getContext('2d', { willReadFrequently: true });
      measureRenderer = new J.Renderer();
    }
    const scale = 192 / p.W;
    // 進場完成後、還沒開始退場的那一刻量一次就夠（版面在停留期間不會大幅改變寬度）
    const times = [cut.start + Math.min((cut.inDur || 0.3) + 0.2, cut.dur * 0.55)];
    const mass = new Float64Array(192);
    const savedFx = p.fx;
    // 只量「版面＋歌詞」：裝飾常常橫跨大半個畫面，算進去幾乎每句都推不動。裝飾跟著鏡頭一起
    // 平移，出了畫面邊緣就自然出畫——畫布是全畫面，不會有被切掉的硬邊界。
    const savedDecor = cut.decor;
    measuring = true;
    try {
      cut.decor = [];
      if (cut.fx) p.fx = cut.fx;
      for (const t of times) {
        measureRenderer.frame(measureCtx, p, t, { scale, transparent: true, noHud: true, noTrans: true, noPost: true, noGhost: true, fast: true });
        const d = measureCtx.getImageData(0, 0, 192, 108).data;
        for (let x = 0; x < 192; x++) {
          for (let y = 0; y < 108; y++) if (d[(y * 192 + x) * 4 + 3] > 30) mass[x] += 1;
        }
      }
    } catch (e) {
      return null;
    } finally {
      measuring = false;
      p.fx = savedFx;
      cut.decor = savedDecor;
    }
    let total = 0;
    for (let x = 0; x < 192; x++) total += mass[x];
    if (!total) return null;
    const at = (q) => { let acc = 0; for (let x = 0; x < 192; x++) { acc += mass[x]; if (acc >= total * q) return x; } return 191; };
    return { x0: at(0.03) / scale, x1: (at(0.97) + 1) / scale, center: (at(0.5) + 0.5) / scale };
  }

  function cutOffset(p, cut) {
    const sign = sideSign();
    if (!cut || !sign || measuring) return 0;
    if (cut.__jzDx !== undefined) return cut.__jzDx;
    const ext = measureCutExtent(p, cut);
    let dx = 0;
    if (ext) {
      const center = ext.center;
      const target = p.W * TARGET_CENTER[sign];
      // 已經在目標那一側（比目標更靠邊）就不動，不往中間拉回
      const alreadyThere = sign > 0 ? center >= target : center <= target;
      if (!alreadyThere) {
        const lo = p.W * EDGE_MARGIN - ext.x0;          // 左邊不可超出
        const hi = p.W * (1 - EDGE_MARGIN) - ext.x1;    // 右邊不可超出
        dx = Math.max(lo, Math.min(hi, target - center));
        // 內容比可用寬度還寬時 lo > hi：往目標方向能推多少算多少，但不反向推
        if (sign > 0) dx = Math.max(0, dx); else dx = Math.min(0, dx);
      }
    }
    cut.__jzDx = dx;
    return dx;
  }

  // 量測排在瀏覽器的閒置時間做，不佔播放中的幀（實測在播放幀裡量，每換一個 cut 就頓一下）：
  // plan 建好就從目前播放位置開始，有空檔才量一個；播放追到還沒量的 cut 時才在當下補量。
  let measureJob = 0;
  function scheduleMeasure(p) {
    const job = ++measureJob;
    if (!sideSign() || !p) return;
    const startIdx = Math.max(0, p.cuts.findIndex((c) => c.end > lastDrawnT));
    const order = p.cuts.slice(startIdx).concat(p.cuts.slice(0, startIdx));
    let i = 0;
    const idle = (fn) => (typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(fn, { timeout: 1000 })
      : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: false }), 50));
    const step = (deadline) => {
      if (job !== measureJob || plan !== p) return;
      let did = 0;
      while (i < order.length && (did === 0 ? (deadline.didTimeout || deadline.timeRemaining() > 4) : deadline.timeRemaining() > 6)) {
        const c = order[i++];
        if (c.__jzDx === undefined) { cutOffset(p, c); did++; }
      }
      if (i < order.length) idle(step);
    };
    idle(step);
  }

  // 把位移接到引擎每個鏡頭的 get()（只包一次；只對帶 __jzOffset 的 plan 生效，引擎本身不改）
  (function wrapCameras() {
    for (const k of Object.keys(J.CAMERA)) {
      const def = J.CAMERA[k];
      if (!def || def.__jzWrapped) continue;
      const orig = def.get;
      def.get = function (env, P) {
        const c = (orig ? orig.call(this, env, P) : null) || {};
        const dx = env && env.plan && typeof env.plan.__jzOffset === 'function' ? env.plan.__jzOffset(env.cut) : 0;
        return dx ? Object.assign({}, c, { x: (c.x || 0) + dx }) : c;
      };
      def.__jzWrapped = true;
    }
  }());

  // 動作節奏：流暢＝每個顯示幀都更新動作；作畫感＝引擎原本的 2 コマ打ち（每秒 12 張），
  // 日系文字 PV 刻意的頓挫。直播疊加預設流暢——實機回報「有點卡」就是這個頓挫。
  function motionMode() {
    return document.body.dataset.jizuraMotion === 'koma' ? 'koma' : 'smooth';
  }

  function intensityScale() {
    return INTENSITY_SCALE[document.body.dataset.lyricIntensity] || 1;
  }

  // JIZURA 歌詞記法的保留字元（/ 切 cut、| 註解、* 強調、行尾 ! 衝擊、行首 # 註解）
  // 在一般歌詞裡是普通字，換成全形避免被當成指令。
  function escapeLyricText(text) {
    return String(text || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\//g, '／').replace(/\|/g, '｜').replace(/\*/g, '＊')
      .replace(/!+$/, (m) => '！'.repeat(m.length))
      .replace(/^#/, '＃').replace(/^\[/, '［')
      .trim();
  }

  function lrcTime(ms) {
    const t = Math.max(0, ms) / 1000;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
  }

  function isInterludeText(text) {
    const t = (text || '').trim();
    return !t || /^[\s.…·。♪〜~-]+$/.test(t);
  }

  function profileAt(sections, tSec) {
    if (!sections || !sections.length) return DEFAULT_PROFILE;
    let label = null;
    for (const s of sections) if (tSec >= s.start && tSec < s.end) { label = s.label; break; }
    if (label === null) label = tSec < sections[0].start ? sections[0].label : sections[sections.length - 1].label;
    return PROFILE_OF_SECTION[label] || DEFAULT_PROFILE;
  }

  // 引擎的 style 決定書體、裝飾偏好與次要色；字色另外覆寫。只挑深底的 style，
  // 讓引擎的對比計算（貼紙底色、殘影色）都以「亮字疊在暗處」為前提。
  function pickStyle(seed) {
    const dark = J.STYLE_ORDER.filter((k) => {
      const s = J.STYLES[k];
      return s && s.schemes && s.schemes[0] && J.lum(s.schemes[0].bg) < 0.3;
    });
    const pool = dark.length ? dark : J.STYLE_ORDER;
    return pool[seed % pool.length];
  }

  // ─── 規劃 ───

  function buildPlan(lines, meta) {
    const aspect = '16:9';
    const safe = new Set(SAFE_LAYOUTS_LANDSCAPE);
    const koma = motionMode() === 'koma';
    const sections = meta && Array.isArray(meta.sections) && meta.sections.length ? meta.sections : null;
    const seed = hashString((meta && meta.id) || (lines[0] && lines[0].text) || 'elitesand');
    const style = pickStyle(seed);
    const scale = intensityScale();
    const fg = toHex(cssVar('--lyric-color', '#ffffff'), '#ffffff');
    const accent = toHex(cssVar('--lyric-color-active', '#ffd6a5'), '#ffd6a5');

    const usable = lines
      .map((line) => ({ time: Number(line.time) || 0, text: escapeLyricText(line.text) }))
      .filter((line) => !isInterludeText(line.text));
    if (!usable.length) return null;

    // 用「這句前段」判斷段落，不是句首那一瞬間：歌詞時間與模型切的段落邊界常差個零點幾秒，
    // 副歌第一句的句首偶爾會落在前一段（主歌）的尾巴上。取句首到下一句之間的中點，最多 1.5 秒。
    const lineProfile = usable.map((line, i) => {
      const next = usable[i + 1] ? usable[i + 1].time : line.time + 3000;
      const probe = line.time + Math.min(1500, Math.max(0, next - line.time) / 2);
      return profileAt(sections, probe / 1000);
    });
    const used = [...new Set(lineProfile)];
    const cuts = [];
    const events = [];
    let base = null;

    for (const profileId of used) {
      const prof = PROFILES[profileId];
      const lrc = usable.map((line, i) => {
        // 高潮段落的第一句＝衝擊句（引擎會給大字、閃爍與震動）
        const impact = prof.impactFirst && lineProfile[i] === profileId && (i === 0 || lineProfile[i - 1] !== profileId);
        return lrcTime(line.time) + line.text + (impact ? '!' : '');
      }).join('\n');

      const project = Object.assign(J.defaultProject(), {
        lyrics: lrc,
        title: (meta && meta.title) || '',
        artist: (meta && meta.artist) || '',
        style,
        seed,
        extra: true,
        wa: true,
        lang: 'auto',
        aspect,
        colors: { enabled: true, bg: '#101014', fg, accentOn: true, accent },
      });
      project.fx = Object.assign(J.defaultProject().fx, prof.fx, {
        koma: koma ? (prof.fx.koma || 12) : SMOOTH_KOMA,
        onTwos: koma && !!prof.fx.koma,
        motion: Math.min(1, prof.fx.motion * scale),
        glitch: Math.min(1, prof.fx.glitch * scale),
        decor: Math.min(1, prof.fx.decor * scale),
        hud: 'off',
        flash: false,     // 全畫面閃白＝鐵則 #11 的全螢幕遮罩
        bgSwitch: 0,      // 不切 scheme：見檔頭「文字色」
      });
      const layoutPool = prof.quietOnly ? QUIET_LAYOUTS.filter((k) => safe.has(k)) : [...safe];
      // 安靜段的進場／退場／停留動作只用引擎標成「しっとり（calm）」的部品，文字特效全關
      const calmOnly = (group, always) => {
        const calm = new Set([...J.taggedWith(group, 'calm'), ...always]);
        return Object.fromEntries(J.order(group).map((k) => [k, !prof.quietOnly || calm.has(k)]));
      };
      project.enabled = {
        enter: calmOnly('enter', ['cut']),
        exit: calmOnly('exit', ['cut']),
        hold: calmOnly('hold', ['still']),
        treat: Object.fromEntries(J.order('treat').map((k) => [k, !prof.quietOnly || k === 'none'])),
        layout: Object.fromEntries(J.order('layout').map((k) => [k, layoutPool.includes(k)])),
        bg: Object.fromEntries(J.order('bg').map((k) => [k, k === 'none'])),
        trans: Object.fromEntries(J.order('trans').map((k) => [k, false])),
        cam: Object.fromEntries(J.order('cam').map((k) => [k, !(J.CAMERA[k] && J.CAMERA[k].strong)])),
      };

      const p = J.plan(project, null);
      if (!base) base = p;
      const fx = p.fx;
      for (const c of p.cuts) {
        // 歌詞 cut 看它那一句的段落；片頭歌名卡與間奏卡看 cut 開始時間
        const owner = c.line >= 0 && c.layout !== 'interlude' ? lineProfile[c.line] : profileAt(sections, c.start + 0.5);
        if (owner !== profileId) continue;
        c.fx = fx;
        cuts.push(c);
      }
      for (const e of p.events) {
        if (profileAt(sections, e.t) !== profileId) continue;
        if (prof.quietOnly && e.type !== 'chroma') continue;
        events.push(e);
      }
    }

    cuts.sort((a, b) => a.start - b.start);
    cuts.forEach((c, i) => { c.index = i; });
    events.sort((a, b) => a.t - b.t);
    const merged = Object.assign({}, base, { cuts, events, hud: false, beats: [], energy: null });
    merged.__jzOffset = (cut) => cutOffset(merged, cut);
    return merged;
  }

  function currentPlanKey(lines, meta) {
    const secs = meta && Array.isArray(meta.sections) ? meta.sections.length + ':' + (meta.sections[0] ? meta.sections[0].label : '') : '-';
    return [
      lines.length, lines[0] ? lines[0].time : 0, lines.length ? lines[lines.length - 1].time : 0,
      meta ? meta.id : '', secs, placement(), motionMode(), document.body.dataset.lyricIntensity || '',
      cssVar('--lyric-color', ''), cssVar('--lyric-color-active', ''),
    ].join('|');
  }

  // 每幀都會進來：歌詞陣列、歌曲資訊物件都沒換、設定也沒動時直接用現成的 plan，
  // 不重算 key（key 要串整首歌詞、讀 computed style，60fps 下不便宜）。
  let lastLinesRef = null;
  let lastMetaRef = null;
  let settingsDirty = true;

  function ensurePlan(tctx) {
    const lines = tctx && tctx.getLyrics ? tctx.getLyrics() : [];
    const meta = tctx && tctx.getTrackMeta ? tctx.getTrackMeta() : null;
    if (lines === lastLinesRef && meta === lastMetaRef && !settingsDirty) return plan;
    lastLinesRef = lines; lastMetaRef = meta; settingsDirty = false;
    const key = currentPlanKey(lines, meta) + '|' + (lines.length ? hashString(lines.map((l) => l.text).join('\n')) : 0);
    if (key === planKey) return plan;
    planKey = key;
    lastStepKey = '';
    try {
      plan = lines.length ? buildPlan(lines, meta) : null;
    } catch (e) {
      console.warn('[文字PV] 規劃失敗:', e);
      plan = null;
    }
    scheduleMeasure(plan);
    // 書體走 Google Fonts，只載入這首歌用到的字；載完重畫一次（載入前會先用系統字頂著）
    if (plan) {
      const text = lines.map((l) => l.text).join('') + ((meta && meta.title) || '') + '0123456789';
      if (fontsReadyFor !== planKey) {
        const forKey = planKey;
        J.ensureFonts(text, null).then(() => {
          if (planKey === forKey) { fontsReadyFor = forKey; lastStepKey = ''; }
        }).catch(() => {});
      }
    }
    return plan;
  }

  // ─── 版位與繪製 ───

  function layoutCanvas() {
    if (!canvas || !rootEl) return;
    const vw = rootEl.clientWidth || window.innerWidth || 1920;
    const vh = rootEl.clientHeight || window.innerHeight || 1080;
    const mode = placement();
    // 畫布一律全畫面 16:9（偏左／偏右靠 cutOffset 移動內容，不縮畫布）
    const w = Math.min(vw, vh * 16 / 9);
    const h = w * 9 / 16;
    const x = (vw - w) / 2;
    const y = (vh - h) / 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.left = `${x}px`;
    canvas.style.top = `${y}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const pw = Math.max(2, Math.round(w * dpr));
    const ph = Math.max(2, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    rootEl.dataset.placement = mode;
    lastStepKey = '';
  }

  function draw(timeMs, tctx, force) {
    if (!ctx2d) return;
    const p = ensurePlan(tctx);
    if (!p) { ctx2d.clearRect(0, 0, canvas.width, canvas.height); lastStepKey = ''; return; }
    const t = Math.max(0, timeMs / 1000);
    const cut = J.cutAt(p, t);
    // 每個 cut 用自己段落的 fx（動作強度、コマ打ち…）；renderer 從 plan.fx 讀
    if (cut && cut.fx) p.fx = cut.fx;
    // コマ打ち（12 張/秒）時同一格內畫面不變，不必每個 60fps 幀都重畫——OBS 裡省 GPU
    const stepDur = J.stepDur(p.fx, p.fps);
    const stepKey = `${cut ? cut.index : -1}:${Math.floor(t / stepDur + 1e-6)}:${canvas.width}`;
    if (!force && stepKey === lastStepKey && J.komaOf(p.fx) > 0) return;
    lastStepKey = stepKey;
    try {
      renderer.frame(ctx2d, p, t, { scale: canvas.width / p.W, transparent: true, noHud: true, noTrans: true });
    } catch (e) {
      console.warn('[文字PV] 繪製失敗:', e);
    }
    lastDrawn = cut;
    lastDrawnT = t;
  }

  LyricTemplates.register({
    id: 'jizura',
    label: '文字PV',
    settings: [
      { type: 'enum', key: 'jizuraPlacement', target: 'data:jizuraPlacement', values: ['right', 'left', 'full'], default: 'right' },
      { type: 'enum', key: 'jizuraMotion', target: 'data:jizuraMotion', values: ['smooth', 'koma'], default: 'smooth' },
    ],

    mount(container, tctx) {
      rootEl = document.createElement('div');
      rootEl.id = 'jizura-root';
      canvas = document.createElement('canvas');
      canvas.className = 'jizura-canvas';
      rootEl.appendChild(canvas);
      container.appendChild(rootEl);
      ctx2d = canvas.getContext('2d');
      renderer = renderer || new J.Renderer();
      plan = null; planKey = ''; lastStepKey = ''; settingsDirty = true;
      layoutCanvas();
      resizeHandler = () => { settingsDirty = true; layoutCanvas(); draw(tctx.getCurrentTimeMs ? tctx.getCurrentTimeMs() : 0, tctx, true); };
      window.addEventListener('resize', resizeHandler);
      draw(tctx.getCurrentTimeMs ? tctx.getCurrentTimeMs() : 0, tctx, true);
    },

    destroy() {
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
      if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      rootEl = null; canvas = null; ctx2d = null; plan = null; planKey = ''; lastStepKey = '';
    },

    onLyricsLoaded(parsedLyrics, tctx) {
      planKey = ''; settingsDirty = true;
      draw(tctx.getCurrentTimeMs ? tctx.getCurrentTimeMs() : 0, tctx, true);
    },

    onFrame(timeMs, tctx) { draw(timeMs, tctx, false); },

    onSeek(timeMs, tctx) { draw(timeMs, tctx, true); },

    // 除錯用（唯讀）：某時間點落在哪個 cut、用哪個 profile。開發時在 /display 的 console 呼叫
    // LyricTemplates.get('jizura').debugCutAt(秒)。
    debugLastDrawn() {
      const c = lastDrawn;
      return c ? { layout: c.layout, enter: c.enter, exit: c.exit, hold: c.hold, treat: c.treat, cam: c.cam, decor: (c.decor || []).map((d) => d.id), start: c.start } : null;
    },

    debugLayouts() {
      if (!plan) return null;
      const offs = plan.cuts.filter((c) => c.__jzDx !== undefined).map((c) => Math.round((c.__jzDx / plan.W) * 100));
      return { placement: placement(), motion: motionMode(), W: plan.W, H: plan.H, layouts: [...new Set(plan.cuts.map((c) => c.layout))], offsetPercents: offs };
    },

    debugCutAt(tSec) {
      if (!plan) return null;
      const c = J.cutAt(plan, tSec);
      if (!c) return { cuts: plan.cuts.length, cut: null };
      return {
        cuts: plan.cuts.length, text: c.text, layout: c.layout, enter: c.enter, exit: c.exit, treat: c.treat,
        start: +c.start.toFixed(2), end: +c.end.toFixed(2), motion: c.fx && c.fx.motion, koma: c.fx && c.fx.koma,
        offsetPx: c.__jzDx === undefined ? null : Math.round(c.__jzDx),
      };
    },

    // 版位／顏色／強度改了：plan key 會變、自動重規劃；這裡只負責重排 canvas 並立刻重畫
    // （暫停時沒有後續 onFrame）。
    onSettings(settings, tctx) {
      settingsDirty = true;
      layoutCanvas();
      draw(tctx && tctx.getCurrentTimeMs ? tctx.getCurrentTimeMs() : 0, tctx, true);
    },
  });
}());
