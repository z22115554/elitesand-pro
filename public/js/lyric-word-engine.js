/**
 * Elitesand Pro 墨字引擎（v6，2026-07 全面重寫）
 *
 * Pulse / Facet 共用的「詞」動畫核心。2026-07-11 AGPL 稽核後整組重新設計：
 * 視覺概念（詞的三相生命週期＋逐字光帶）保留，但 DOM 結構、動畫語彙、
 * 曲線與所有常數皆為原創——與任何參考實作無共同表達。
 *
 * 每個 display word 是兩層 DOM：
 *   .gw-word（定位層：transform 位移/縮放/傾斜）
 *     └ .gw-ink（墨字層：逐字素 span，顏色與光暈直接動在字素上——
 *                不再用「透明複本疊層」，少一層合成、字素即光帶的最小單位）
 *
 * 三相：pending（未唱：沉在下方、透明）→ live（唱到：浮起・染色・光帶掃過）
 *      → done（唱過：退溫、緩慢漂移到 cfg.drift 指定的終點）。
 * 節奏由 kernel 的 lineTempo 連續模型驅動（snapReveal 時整詞瞬間點亮）。
 *
 * 效能約定沿用專案既有紀律：狀態切換時一次排好 GSAP 動畫、不逐幀手算；
 * 全程不用 filter:blur（OBS 軟體合成的殺手）；引擎不跑 rAF，
 * 由模板的 onFrame 呼叫 updateWordStates(timeMs) 驅動。
 */
const LyricWordEngine = (() => {
  if (typeof LyricMotion === 'undefined') {
    console.warn('[WordEngine] LyricMotion 未載入');
  }

  const INK_SPAN_LIMIT = 36; // 超長詞不逐字素做光帶（退化為整詞一次），防 DOM 爆量

  // GSAP 對 textShadow 插值需要「數字個數對稱」的字串，隱藏態用零尺寸光暈而非 'none'
  const dimGlow = (color) => `0 0 0px ${color}`;
  const glowAt = (color, px) => `0 0 ${px}px ${color}`;

  // ─── 詞的建立 ───

  /**
   * 建立一個 display word 的兩層 DOM 與狀態物件。
   * @param {object} dw - kernel buildDisplayWords 的輸出項 {text,startMs,endMs,graphemes}
   * @param {object} cfg - 佈局配置 {dx,dy,tiltDeg,scaleBase,drift:{x,y,spinDeg},gapPx,riseFrom}
   * @param {object} opts - {baseColor, activeColor, tempo}（tempo = kernel lineTempo 的輸出）
   * @returns {object} wordState
   */
  function createWord(dw, cfg, opts) {
    const el = document.createElement('div');
    el.className = 'gw-word';
    if (cfg.gapPx) el.style.marginRight = `${cfg.gapPx}px`;

    const inkEl = document.createElement('span');
    inkEl.className = 'gw-ink';

    // 逐字素 span：光帶與染色的最小單位；超長詞退化為單一 span
    const inkSpans = [];
    const graphemes = dw.graphemes || [];
    if (graphemes.length > 1 && graphemes.length <= INK_SPAN_LIMIT) {
      for (const g of graphemes) {
        const s = document.createElement('span');
        s.textContent = g.char;
        inkEl.appendChild(s);
        inkSpans.push({ el: s, startMs: g.startMs, endMs: g.endMs });
      }
    } else {
      const s = document.createElement('span');
      s.textContent = dw.text;
      inkEl.appendChild(s);
      inkSpans.push({ el: s, startMs: dw.startMs, endMs: dw.endMs });
    }
    el.appendChild(inkEl);

    const state = {
      el, inkEl, inkSpans,
      dw, cfg,
      baseColor: opts.baseColor,
      activeColor: opts.activeColor,
      tempo: opts.tempo,
      phase: null,
      tweens: [],
    };

    enterPending(state, true);
    state.phase = 'pending';
    return state;
  }

  function killTweens(state) {
    for (const t of state.tweens) t.kill();
    state.tweens = [];
  }

  // ─── 三相視覺 ───

  // pending：沉在基準位下方一小段、微傾、透明。
  // 下沉量與詞自身的水平偏移弱相關（畫面左右兩側的詞起身方向略有差異，成群時像潮水）。
  function pendingPose(cfg) {
    return {
      x: cfg.dx * 0.7,
      y: cfg.dy + (cfg.riseFrom != null ? cfg.riseFrom : 16) + cfg.dx * 0.05,
      rotation: cfg.tiltDeg * 0.4,
      scale: Math.max(cfg.scaleBase * 0.88, 0.6),
      opacity: 0,
    };
  }

  function enterPending(state, immediate) {
    const pose = pendingPose(state.cfg);
    killTweens(state);
    if (immediate || typeof gsap === 'undefined') {
      gsap.set(state.el, pose);
      gsap.set(state.inkEl, { color: state.baseColor });
      for (const s of state.inkSpans) gsap.set(s.el, { textShadow: dimGlow(state.activeColor) });
    } else {
      state.tweens.push(gsap.to(state.el, { ...pose, duration: 0.32, ease: 'power1.in' }));
      state.tweens.push(gsap.to(state.inkEl, { color: state.baseColor, duration: 0.32 }));
    }
  }

  // live：浮起到定位（帶一次輕微越頂再回落的「浮出水面」手感）＋逐字素染色與光帶
  function enterLive(state) {
    const { cfg, dw, tempo } = state;
    killTweens(state);

    const singDurS = Math.max((dw.endMs - dw.startMs) / 1000, 0.09);
    const snap = tempo.snapReveal;
    const riseDurS = snap ? 0.1 : 0.24 + 0.18 * tempo.pace;

    // 定位層：浮起。keyframes 自製「越頂 6% 再回落」，不用現成 back ease
    state.tweens.push(gsap.to(state.el, {
      keyframes: [
        { y: cfg.dy - (snap ? 0 : 4), scale: cfg.scaleBase * (snap ? 1 : 1.06), opacity: 1, duration: riseDurS * 0.62, ease: 'power3.out' },
        { y: cfg.dy, scale: cfg.scaleBase, duration: riseDurS * 0.38, ease: 'sine.inOut' },
      ],
      x: cfg.dx,
      rotation: cfg.tiltDeg,
    }));

    // 墨字層：光帶亮度以字級為尺度（不是固定 px 表）
    const fontPx = parseFloat(getComputedStyle(state.el).fontSize) || 42;
    const peakPx = LyricMotion.clamp(Math.round(fontPx * 0.42), 9, 24);

    if (snap || state.inkSpans.length <= 1) {
      // 整詞一次：染色走完演唱時長，光帶脈衝一次
      state.tweens.push(gsap.to(state.inkEl, { color: state.activeColor, duration: snap ? 0.08 : singDurS, ease: 'none' }));
      const pulseS = snap ? 0.14 : Math.min(Math.max(singDurS, 0.2), 0.6);
      const tl = gsap.timeline();
      tl.to(state.inkSpans.map((s) => s.el), {
        textShadow: glowAt(state.activeColor, peakPx),
        duration: pulseS * 0.35, ease: 'sine.out',
      }).to(state.inkSpans.map((s) => s.el), {
        textShadow: dimGlow(state.activeColor),
        duration: pulseS * 0.65, ease: 'sine.in',
      });
      state.tweens.push(tl);
    } else {
      // 逐字素光帶：每個字素在自己的時間點染色＋亮起，殘光拖出連續帶狀
      const tl = gsap.timeline();
      for (const s of state.inkSpans) {
        const delayS = Math.max(0, (s.startMs - dw.startMs) / 1000);
        const charS = Math.max((s.endMs - s.startMs) / 1000, 0.02);
        const tailS = LyricMotion.clamp(charS * 4, 0.18, 0.9); // 殘光長度：字素時長×4
        tl.to(s.el, { color: state.activeColor, duration: Math.max(charS, 0.05), ease: 'none' }, delayS);
        tl.to(s.el, {
          keyframes: [
            { textShadow: glowAt(state.activeColor, peakPx), duration: tailS * 0.28, ease: 'sine.out' },
            { textShadow: dimGlow(state.activeColor), duration: tailS * 0.72, ease: 'power1.in' },
          ],
        }, delayS);
      }
      state.tweens.push(tl);
    }
  }

  // done：退溫——透明度落到餘暉層、緩慢漂到 drift 終點、墨色退回底色
  function enterDone(state) {
    const { cfg, tempo } = state;
    killTweens(state);
    const drift = cfg.drift || { x: 0, y: 0, spinDeg: 0 };
    const coolS = tempo.snapReveal ? 0.15 : 0.45 + 0.35 * tempo.pace;

    state.tweens.push(gsap.to(state.el, {
      opacity: 0.7,
      scale: cfg.scaleBase * 0.97,
      x: cfg.dx + drift.x,
      y: cfg.dy + drift.y,
      rotation: cfg.tiltDeg + (drift.spinDeg || 0),
      duration: 3.2, ease: 'sine.out',
    }));
    state.tweens.push(gsap.to(state.inkEl, { color: state.baseColor, duration: coolS, ease: 'sine.inOut' }));
    state.tweens.push(gsap.to(state.inkSpans.map((s) => s.el), {
      color: state.baseColor,
      textShadow: dimGlow(state.activeColor),
      duration: coolS, ease: 'sine.out',
      onComplete: () => { for (const s of state.inkSpans) s.el.style.textShadow = 'none'; },
    }));
  }

  /**
   * 相位推進：模板每幀呼叫一次。只有相位真的變了才觸發動畫（diff 驅動，零常態開銷）。
   * @param {Array} wordStates - createWord 的輸出陣列
   * @param {number} timeMs - 目前歌曲時間（已含 offset）
   * @param {number} lineWindowEndMs - 行的餘暉窗終點（snapReveal 時詞唱到行尾才算過）
   */
  function updateWordStates(wordStates, timeMs, lineWindowEndMs) {
    for (const state of wordStates) {
      const { dw, tempo } = state;
      const liveEndMs = tempo.snapReveal ? lineWindowEndMs : dw.endMs;
      const next = LyricMotion.phaseOf(timeMs, dw.startMs, liveEndMs, tempo.revealLeadMs);
      if (next !== state.phase) {
        state.phase = next;
        if (next === 'live') enterLive(state);
        else if (next === 'done') enterDone(state);
        else enterPending(state, false);
      }
    }
  }

  /** 快速模式（拖曳進度條）：全部詞直接落到目標相位，不播動畫。*/
  function snapWordStates(wordStates, timeMs) {
    for (const state of wordStates) {
      const { dw, cfg } = state;
      const next = LyricMotion.phaseOf(timeMs, dw.startMs, dw.endMs);
      if (next === state.phase) continue;
      state.phase = next;
      killTweens(state);
      if (next === 'pending') {
        enterPending(state, true);
      } else {
        const drift = (next === 'done' && cfg.drift) ? cfg.drift : { x: 0, y: 0, spinDeg: 0 };
        gsap.set(state.el, {
          opacity: next === 'live' ? 1 : 0.7,
          scale: next === 'live' ? cfg.scaleBase : cfg.scaleBase * 0.97,
          x: cfg.dx + (next === 'done' ? drift.x : 0),
          y: cfg.dy + (next === 'done' ? drift.y : 0),
          rotation: cfg.tiltDeg + (next === 'done' ? (drift.spinDeg || 0) : 0),
        });
        gsap.set(state.inkEl, { color: next === 'live' ? state.activeColor : state.baseColor });
        for (const s of state.inkSpans) {
          gsap.set(s.el, { color: next === 'live' ? state.activeColor : state.baseColor, textShadow: 'none' });
        }
      }
    }
  }

  function destroyWords(wordStates) {
    for (const state of wordStates) {
      killTweens(state);
      if (state.el.parentNode) state.el.parentNode.removeChild(state.el);
    }
  }

  // ─── 行容器進退場 ───
  // 不用 blur：進場＝自下而上浮現，退場＝向上散去。時長由 lineTempo 連續給值。

  function animateLineEnter(el, tempo) {
    if (!tempo.softEntry) {
      gsap.fromTo(el, { opacity: 0.5, y: 6 }, {
        opacity: 1, y: 0, duration: Math.max(tempo.entryMs, 40) / 1000, ease: 'power1.out',
      });
      return;
    }
    gsap.fromTo(el, { opacity: 0, y: 18, scale: 0.965 }, {
      opacity: 1, y: 0, scale: 1,
      duration: tempo.entryMs / 1000, ease: 'power3.out',
    });
  }

  /** 舊行退場：與新行進場同時進行；動畫完自毀節點。*/
  function animateLineExit(el, tempo, onDone) {
    gsap.killTweensOf(el);
    gsap.to(el, {
      opacity: 0, y: -14, scale: 1.035,
      duration: Math.max(tempo ? tempo.exitMs : 200, 60) / 1000, ease: 'power1.in',
      onComplete: () => {
        gsap.killTweensOf(el.querySelectorAll('*'));
        if (el.parentNode) el.parentNode.removeChild(el);
        if (onDone) onDone();
      },
    });
  }

  // ─── 整體呼吸浮動 ───
  // 單一 sine 往復（yoyo），振幅/週期依動態強度連續取值。

  const BREATH_AMP = { calm: 5, normal: 9, chaotic: 13 };
  const BREATH_SEC = { calm: 4.6, normal: 3.8, chaotic: 3.1 };

  /** 對容器啟動無限呼吸浮動；回傳 tween（模板 destroy 時 kill）。*/
  function startBreathing(el, intensity) {
    if (typeof gsap === 'undefined') return null;
    const amp = BREATH_AMP[intensity] != null ? BREATH_AMP[intensity] : BREATH_AMP.normal;
    const half = (BREATH_SEC[intensity] != null ? BREATH_SEC[intensity] : BREATH_SEC.normal);
    return gsap.fromTo(el, { y: amp * 0.5 }, {
      y: -amp * 0.5, duration: half, ease: 'sine.inOut', yoyo: true, repeat: -1,
    });
  }

  return {
    createWord,
    updateWordStates,
    snapWordStates,
    destroyWords,
    animateLineEnter,
    animateLineExit,
    startBreathing,
    INK_SPAN_LIMIT,
  };
})();
