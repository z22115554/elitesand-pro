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
 *     ≤25% 才收（16:9 與 9:16 各量一次，數值不同）。字幕帯／障子／便箋這類會整面蓋住
 *     主播的版面一律不用。新增引擎版本時要重跑稽核再更新這兩份清單。
 *   - 預設放在右側直欄（9:16 構圖），避開站在畫面中間的 VTuber；可改左側或全畫面。
 *   - 文字色／強調色吃面板設定（--lyric-color／--lyric-color-active），並關掉引擎的
 *     scheme 切換——引擎的配色是「底色＋字色」一組，透明疊加時底色不存在，淺底 scheme
 *     會變成深色字壓在直播畫面上。
 */
(function () {
  if (typeof LyricTemplates === 'undefined' || typeof J === 'undefined' || typeof J.plan !== 'function' || typeof J.Renderer !== 'function') {
    console.warn('[文字PV] JIZURA 引擎未載入，模板停用');
    return;
  }

  // 覆蓋率 ≤25% 的 layout（見檔頭）。橫式＝全畫面 16:9，直式＝側欄 9:16。
  // 影絵（shadowPlay）雖然過了覆蓋率門檻，本質是一塊不透明的深色幕布，縮進側欄後非常突兀，手動排除。
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
  const SAFE_LAYOUTS_PORTRAIT = [
    'center', 'mixed', 'vcols', 'marquee', 'scatter', 'ring', 'wave', 'huge', 'labels', 'condensed', 'type',
    'diag', 'circle', 'stack', 'pill', 'lowerThird', 'corners', 'staircase', 'zigzag', 'arcTop', 'spiral',
    'gridCells', 'dropCap', 'justified', 'frameBox', 'bubble', 'ticker', 'mirror', 'sideways', 'edgeFrame',
    'perspective', 'hanko', 'genkou', 'quote', 'ruler', 'searchBar', 'chat', 'notification', 'ticket', 'rain',
    'hanging', 'orbit', 'tunnel', 'wordCloud', 'bounceLine', 'elastic', 'crossBands', 'stickerBomb', 'neon',
    'bubbles', 'flipBoard', 'credits', 'splitHalves', 'columnsBig', 'circleWords', 'depthStack', 'typeSpecimen',
    'kanjiFocus', 'halfVertical', 'curtain', 'equalizer', 'headlineDeck', 'contents', 'footnote', 'proofread',
    'numbered', 'poster', 'swissGrid', 'dictionary', 'chochin', 'routeMap', 'cylinder', 'accordion', 'flag',
    'ribbon', 'pendulum', 'balloons', 'tiles', 'bulbs', 'ledScroll', 'puzzle', 'dominoes', 'burst',
    'fisheye', 'origami', 'sliceStack', 'maskReveal', 'halftoneBig', 'stencil',
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

  let rootEl = null;
  let canvas = null;
  let ctx2d = null;
  let renderer = null;
  let plan = null;
  let planKey = '';
  let fontsReadyFor = '';
  let lastStepKey = '';
  let resizeHandler = null;

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
    const portrait = placement() !== 'full';
    const safe = new Set(portrait ? SAFE_LAYOUTS_PORTRAIT : SAFE_LAYOUTS_LANDSCAPE);
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
        aspect: portrait ? '9:16' : '16:9',
        colors: { enabled: true, bg: '#101014', fg, accentOn: true, accent },
      });
      project.fx = Object.assign(J.defaultProject().fx, prof.fx, {
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
    return Object.assign({}, base, { cuts, events, hud: false, beats: [], energy: null });
  }

  function currentPlanKey(lines, meta) {
    const secs = meta && Array.isArray(meta.sections) ? meta.sections.length + ':' + (meta.sections[0] ? meta.sections[0].label : '') : '-';
    return [
      lines.length, lines[0] ? lines[0].time : 0, lines.length ? lines[lines.length - 1].time : 0,
      meta ? meta.id : '', secs, placement(), document.body.dataset.lyricIntensity || '',
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
    let w; let h; let x; let y;
    if (mode === 'full') {
      w = Math.min(vw, vh * 16 / 9); h = w * 9 / 16;
      x = (vw - w) / 2; y = (vh - h) / 2;
    } else {
      // 側欄：寬度不超過畫面 30%，高度不超過 94%，保持 9:16
      w = Math.min(vw * 0.3, vh * 0.94 * 9 / 16); h = w * 16 / 9;
      const margin = vw * 0.025;
      x = mode === 'left' ? margin : vw - w - margin;
      y = (vh - h) / 2;
    }
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
  }

  LyricTemplates.register({
    id: 'jizura',
    label: '文字PV',
    settings: [
      { type: 'enum', key: 'jizuraPlacement', target: 'data:jizuraPlacement', values: ['right', 'left', 'full'], default: 'right' },
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
    debugLayouts() {
      return plan ? { placement: placement(), aspect: plan.W > plan.H ? '16:9' : '9:16', layouts: [...new Set(plan.cuts.map((c) => c.layout))] } : null;
    },

    debugCutAt(tSec) {
      if (!plan) return null;
      const c = J.cutAt(plan, tSec);
      if (!c) return { cuts: plan.cuts.length, cut: null };
      return {
        cuts: plan.cuts.length, text: c.text, layout: c.layout, enter: c.enter, exit: c.exit, treat: c.treat,
        start: +c.start.toFixed(2), end: +c.end.toFixed(2), motion: c.fx && c.fx.motion, koma: c.fx && c.fx.koma,
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
