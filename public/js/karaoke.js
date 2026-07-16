/**
 * Elitesand Pro GSAP 歌詞動畫引擎 v3 (Phase 4)
 * 
 * ═══ 架構設計 ═══
 * 
 * 插件式動畫系統，支援高度擴展：
 * 
 * RenderingPipeline:
 *   parse → prepareDOM → applyEffect → updateFrame → transitionOut
 * 
 * Phase 4 增強：
 * - 雙語渲染模式：原文 / 羅馬拼音 / 原文+拼音
 * - KRC KTV 逐字模式也支援雙語（原文+拼音同時高亮）
 * - 羅馬拼音行 .phonetic-line 獨立 DOM 元素，方便未來擴展
 * - 每個 char 對應一個 .phonetic-char，形成映射關係
 * 
 * AnimationEffect 介面:
 *   name         - 效果名稱
 *   onLineEnter  - 行入場動畫
 *   onWordActive - 逐字高亮動畫（KRC 模式）
 *   onLineExit   - 行退場動畫
 *   onFrame      - 每幀更新（用於持續性效果）
 *   onDestroy    - 清理資源
 */
const KaraokeEngine = (() => {
  // ─── 狀態 ───
  let parsedLyrics = [];
  let lyricsType = 'lrc';
  let currentLineIndex = -1;
  let maxHistoryLines = 4;
  let romanizationMode = 'original'; // 'original' | 'romanized' | 'both' | 'xieyin' | 'full'

  // 逐字(KRC) KTV 模式：預設關閉（走逐句，拼音/諧音正確）。
  // 使用者可開啟：逐字以 1~2 字為單位，羅馬拼音缺上下文→諧音錯誤，故逐字模式不顯示拼音/諧音。
  let wordByWord = false;
  function setWordByWord(b) { wordByWord = !!b; }
  function isWordMode() { return wordByWord && lyricsType === 'krc'; }

  // ─── 簡轉繁（opencc-js cn→tw，詞組級）。只轉「原文 Han 字」，不動拼音/諧音 ───
  let s2tEnabled = true; // 預設開啟簡轉繁；實際值仍以伺服器同步的 lyricSettings.convertTraditional 為準
  let _s2tConv = null;
  function getS2T() {
    if (_s2tConv) return _s2tConv;
    try {
      if (typeof OpenCC !== 'undefined' && OpenCC.Converter) _s2tConv = OpenCC.Converter({ from: 'cn', to: 'tw' });
    } catch (e) { _s2tConv = null; }
    return _s2tConv;
  }
  function s2t(str) {
    if (!s2tEnabled || !str) return str;
    const conv = getS2T();
    if (!conv) return str;
    try { return conv(str); } catch (e) { return str; }
  }
  // 切換簡轉繁：重渲染當前行立即生效（歷史行下次推移時自然更新）
  function setTraditional(b) {
    const nb = !!b;
    if (nb === s2tEnabled) return;
    s2tEnabled = nb;
    if (currentLineIndex >= 0 && previousLineEl) previousLineEl = renderLine(currentLineIndex);
  }

  // 快速模式：拖曳進度條/連續跳轉時開啟，跳過入場動畫、粒子、歷史動畫與逐幀效果，
  // 只做必要的 DOM 更新，避免渲染卡死。
  let fastMode = false;
  function setFastMode(b) { fastMode = !!b; }

  // 各模式要顯示哪些行（逐字 KTV 模式不顯示拼音/諧音）
  function showsRomaji() { return !isWordMode() && (romanizationMode === 'romanized' || romanizationMode === 'both' || romanizationMode === 'full'); }
  function showsXieyin() { return !isWordMode() && (romanizationMode === 'xieyin' || romanizationMode === 'full'); }
  // 逐字高亮顏色：優先用使用者設定的「高亮顏色」(--lyric-color-active)，否則用風格預設色
  function activeColor(fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--lyric-color-active').trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  // 逐字高亮發光：優先用使用者在「當前行發光」設定的 --lyric-active-glow（glowStrength>0 時
  // buildGlow() 會產生非透明值），否則退回動畫風格自帶的發光（anim.glow）。過去這裡固定套用
  // 風格的 glow，使用者調整「發光」設定對逐字 KTV 模式完全無效——這裡讓使用者設定優先生效。
  function activeGlow(fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--lyric-active-glow').trim();
      if (v && v !== '0 0 0 transparent') return v;
    } catch (e) { /* 靜默 */ }
    return fallback;
  }
  let isRunning = false;
  let previousLineEl = null;
  let activeEffects = [];
  // Phase 5: 時間偏移（毫秒），正數=歌詞提前，負數=歌詞延後
  let timeOffsetMs = 0;

  // ─── 排版模板（v4）───
  // 'classic' 走既有的疊層渲染管線（renderLine/pushToHistory/updateWords/runFrameEffects），
  // 其他模板（例如 Pulse 流光）由 LyricTemplates registry 提供、透過生命週期方法接管渲染。
  let templateId = 'classic';
  let activeTemplateObj = null;
  let lastAdjustedTimeMs = 0;

  // ─── DOM 引用 ───
  let containerEl = null;
  let historyEl = null;
  let activeEl = null;

  // ═══════════════════════════════════════════
  // 效果註冊表（插件系統核心）
  // ═══════════════════════════════════════════

  const effectRegistry = new Map();

  function registerEffect(effect) {
    if (!effect?.name) {
      console.warn('[Karaoke] 註冊效果缺少 name');
      return;
    }
    effectRegistry.set(effect.name, effect);
    console.log(`[Karaoke] 註冊效果: ${effect.name}`);
  }

  function getEffect(name) {
    return effectRegistry.get(name);
  }

  // ═══════════════════════════════════════════
  // 內建效果實作
  // ═══════════════════════════════════════════

  // ─── stagger: LRC 逐字彈入 ───
  registerEffect({
    name: 'stagger',
    onLineEnter(lineEl, line, params) {
      const anim = params.animation.lineEnter;
      const charEls = lineEl.querySelectorAll('.char');
      if (charEls.length === 0) return;

      const nextLine = parsedLyrics[currentLineIndex + 1];
      const lineDuration = nextLine ? (nextLine.time - line.time) / 1000 : 3;
      const staggerTime = Math.min(anim.stagger, (lineDuration * 0.5) / charEls.length);

      gsap.fromTo(charEls,
        { opacity: 0, y: anim.yFrom, scale: anim.scaleFrom, filter: `blur(${anim.blurFrom}px)` },
        { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: anim.duration, ease: anim.ease, stagger: staggerTime }
      );

      // 雙語：拼音/諧音行「幾乎與原文同時」出現——固定極短淡入(≤0.12s)、無延遲，
      // 不再用 anim.duration*0.5（抒情風 0.6s 會明顯比原文慢半拍）。
      const phLines = lineEl.querySelectorAll('.phonetic-line');
      if (phLines.length > 0) {
        gsap.fromTo(phLines,
          { opacity: 0, y: 3 },
          { opacity: 1, y: 0, duration: Math.min(anim.duration * 0.4, 0.12), ease: 'power2.out' }
        );
      }
    },
    onWordActive() {},
    onLineExit() {},
    onFrame() {},
    onDestroy() {},
  });

  // ─── ktv-fill: KRC 逐字 KTV 填充 ───
  registerEffect({
    name: 'ktv-fill',
    onLineEnter(lineEl, line, params) {
      const anim = params.animation.lineEnter;
      gsap.fromTo(lineEl,
        { opacity: 0, y: anim.yFrom * 0.5, filter: `blur(${anim.blurFrom * 0.5}px)` },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: anim.duration * 0.6, ease: 'power2.out' }
      );
    },
    onWordActive(charEl, params) {
      const anim = params.animation.wordActive;
      gsap.to(charEl, {
        scale: anim.scale,
        duration: anim.duration,
        ease: anim.ease,
        color: activeColor(anim.color),
        textShadow: activeGlow(anim.glow),
      });

      // 雙語 KTV：同步高亮對應的 phonetic char
      const phoneticChar = charEl.parentElement.querySelector(`.phonetic-char[data-word-index="${charEl.dataset.wordIndex}"][data-char-in-word="${charEl.dataset.charInWord}"]`);
      if (phoneticChar) {
        gsap.to(phoneticChar, {
          scale: 1.05,
          duration: anim.duration,
          ease: anim.ease,
          color: activeColor(anim.color),
          textShadow: activeGlow(anim.glow),
          opacity: 1,
        });
      }
    },
    onLineExit() {},
    onFrame() {},
    onDestroy() {},
  });

  // ─── wave: 波浪扭曲 ───
  registerEffect({
    name: 'wave',
    _waveOffset: 0,
    onLineEnter(lineEl, line, params) {
      const charEls = lineEl.querySelectorAll('.char');
      charEls.forEach((el) => {
        el.style.transformOrigin = 'center bottom';
      });
    },
    onWordActive(charEl, params) {
      const anim = params.animation.wordActive;
      gsap.to(charEl, {
        scale: anim.scale * 1.05,
        duration: anim.duration,
        ease: anim.ease,
        color: activeColor(anim.color),
        textShadow: activeGlow(anim.glow),
      });
    },
    onFrame(lineEl, timeMs, params) {
      if (!lineEl) return;
      const charEls = lineEl.querySelectorAll('.text-line .char');
      charEls.forEach((el, i) => {
        const wave = Math.sin((this._waveOffset + i) * 0.5) * 3;
        const currentScale = el.classList.contains('active') ? 1.15 : 1;
        gsap.set(el, { y: wave, scaleY: currentScale });
      });
      this._waveOffset += 0.05;
    },
    onLineExit() {},
    onDestroy() {},
  });

  // ─── neon-pulse: 霓虹脈衝 ───
  registerEffect({
    name: 'neon-pulse',
    _pulsePhase: 0,
    onLineEnter(lineEl, line, params) {
      const anim = params.animation.lineEnter;
      gsap.fromTo(lineEl,
        { opacity: 0, y: anim.yFrom * 0.3 },
        { opacity: 1, y: 0, duration: anim.duration * 0.8, ease: 'power2.out' }
      );
    },
    onWordActive(charEl, params) {
      const anim = params.animation.wordActive;
      gsap.timeline()
        .to(charEl, { scale: anim.scale * 1.3, duration: 0.05, ease: 'power4.out' })
        .to(charEl, { scale: anim.scale, color: activeColor(anim.color), textShadow: activeGlow(anim.glow), duration: anim.duration, ease: 'elastic.out(1, 0.6)' });
    },
    onFrame(lineEl, timeMs, params) {
      if (!lineEl) return;
      const charEls = lineEl.querySelectorAll('.text-line .char.active');
      if (charEls.length === 0) return;
      const pulse = 0.9 + Math.sin(this._pulsePhase) * 0.1;
      charEls.forEach(el => {
        gsap.set(el, { opacity: pulse });
      });
      this._pulsePhase += 0.08;
    },
    onLineExit() {},
    onDestroy() {},
  });

  // ─── particle: 粒子爆發 ───
  registerEffect({
    name: 'particle',
    _particles: [],
    onLineEnter(lineEl, line, params) {
      const anim = params.animation.lineEnter;
      const charEls = lineEl.querySelectorAll('.text-line .char');
      if (charEls.length === 0) {
        gsap.fromTo(lineEl, { opacity: 0, y: anim.yFrom * 0.5 }, { opacity: 1, y: 0, duration: anim.duration * 0.5, ease: 'power2.out' });
        return;
      }
      const nextLine = parsedLyrics[currentLineIndex + 1];
      const lineDuration = nextLine ? (nextLine.time - line.time) / 1000 : 3;
      const stagger = Math.min(anim.stagger || 0.045, (lineDuration * 0.4) / charEls.length);
      // 逐字入場
      gsap.fromTo(charEls,
        { opacity: 0, y: anim.yFrom, scale: anim.scaleFrom, filter: `blur(${anim.blurFrom}px)` },
        { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: anim.duration, ease: anim.ease, stagger }
      );
      // 每個字出現的瞬間噴一點粒子（逐句也有逐字的粒子效果）
      charEls.forEach((el, i) => {
        gsap.delayedCall(i * stagger, () => { try { this._spawnParticles(el, params); } catch (e) { /* 靜默 */ } });
      });
      // 拼音 / 諧音行：整行同時淡入（與原文幾乎同步出現，不要逐字延遲）
      const phLines = lineEl.querySelectorAll('.phonetic-line');
      if (phLines.length) {
        gsap.fromTo(phLines, { opacity: 0, y: 3 }, { opacity: 1, y: 0, duration: Math.min(anim.duration * 0.4, 0.12), ease: 'power2.out' });
      }
    },
    onWordActive(charEl, params) {
      const anim = params.animation.wordActive;
      gsap.to(charEl, {
        scale: anim.scale,
        duration: anim.duration,
        ease: anim.ease,
        color: activeColor(anim.color),
        textShadow: activeGlow(anim.glow),
      });
      this._spawnParticles(charEl, params);
    },
    _spawnParticles(charEl, params) {
      // 上限保護：避免快歌/長時間直播粒子累積拖垮渲染（超量就不再生成）
      if (containerEl.querySelectorAll('.karaoke-particle').length > 120) return;
      const rect = charEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      const cx = rect.left - containerRect.left + rect.width / 2;
      const cy = rect.top - containerRect.top + rect.height / 2;
      const anim = params.animation.wordActive;

      for (let i = 0; i < 3; i++) {
        const particle = document.createElement('div');
        particle.className = 'karaoke-particle';
        particle.style.left = cx + 'px';
        particle.style.top = cy + 'px';
        particle.style.backgroundColor = activeColor(anim.color || '#ff6b9d');
        containerEl.appendChild(particle);

        const angle = Math.random() * Math.PI * 2;
        const distance = 30 + Math.random() * 60;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;

        gsap.timeline()
          .fromTo(particle, { scale: 0, opacity: 1 }, { scale: 1, duration: 0.1 })
          .to(particle, { x: dx, y: dy, opacity: 0, scale: 0, duration: 0.6 + Math.random() * 0.4, ease: 'power2.out',
            onComplete: () => { if (particle.parentNode) particle.parentNode.removeChild(particle); }
          });
      }
    },
    onLineExit() {},
    onFrame() {},
    onDestroy() {
      containerEl.querySelectorAll('.karaoke-particle').forEach(p => p.remove());
    },
  });

  // ─── glitch: 數位故障 ───
  registerEffect({
    name: 'glitch',
    onLineEnter(lineEl, line, params) {
      const tl = gsap.timeline();
      tl.fromTo(lineEl, { opacity: 0, x: -10 }, { opacity: 1, x: 10, duration: 0.05 })
        .to(lineEl, { x: -8, duration: 0.05 })
        .to(lineEl, { x: 4, duration: 0.05 })
        .to(lineEl, { x: 0, duration: 0.1, ease: 'power2.out' });
    },
    onWordActive(charEl, params) {
      const anim = params.animation.wordActive;
      gsap.timeline()
        .to(charEl, { x: -3, duration: 0.03 })
        .to(charEl, { x: 3, duration: 0.03 })
        .to(charEl, { x: 0, scale: anim.scale, color: activeColor(anim.color), textShadow: activeGlow(anim.glow), duration: anim.duration, ease: 'power2.out' });
    },
    onLineExit() {},
    onFrame() {},
    onDestroy() {},
  });

  // ═══════════════════════════════════════════
  // 引擎核心
  // ═══════════════════════════════════════════

  function init(options = {}) {
    containerEl = options.container || document.getElementById('lyrics-container');
    historyEl = options.history || document.getElementById('lyrics-history');
    activeEl = options.active || document.getElementById('lyrics-active');

    maxHistoryLines = options.maxHistoryLines || 4;
    romanizationMode = options.romanizationMode || 'original';

    StylePresets.init();
  }

  /**
   * 載入歌詞
   * @param {string} lyricsText - 歌詞原文
   * @param {string} type - 'lrc' | 'krc' | 'txt'
   * @param {Array} [preRomanizedLines] - 預先羅馬化的歌詞行（可選）
   */
  function loadLyrics(lyricsText, type, preRomanizedLines) {
    lyricsType = type;
    parsedLyrics = [];

    // 伺服器若提供了完整解析結果（含 time+text），直接採用為唯一真實來源。
    // 原因：前後端的 LRC/KRC 解析（尤其製作資訊行過濾）並不一致，
    // 若各自解析再用「索引」合併羅馬化，逐句(LRC)歌詞會錯位 → 拼音/諧音不顯示。
    const hasServerParse = Array.isArray(preRomanizedLines) && preRomanizedLines.length > 0
      && preRomanizedLines.every(l => l && typeof l.time === 'number' && typeof l.text === 'string');

    if (hasServerParse) {
      parsedLyrics = preRomanizedLines.map(l => ({
        ...l,
        words: Array.isArray(l.words) ? l.words.map(w => ({ ...w })) : [],
      }));
    } else if (!lyricsText) {
      clearDisplay();
      return;
    } else if (type === 'krc') {
      parsedLyrics = parseKrcLyrics(lyricsText);
    } else if (type === 'lrc') {
      parsedLyrics = parseLrcLyrics(lyricsText);
    } else {
      const lines = lyricsText.split('\n').filter(l => l.trim());
      parsedLyrics = lines.map((text, i) => ({ time: i * 5000, text, phonetic: '', words: [] }));
    }

    currentLineIndex = -1;
    previousLineEl = null;
    clearDisplay();
    if (templateId !== 'classic' && activeTemplateObj && activeTemplateObj.onLyricsLoaded) {
      try { activeTemplateObj.onLyricsLoaded(parsedLyrics, buildTemplateContext()); } catch (e) { console.warn('[Karaoke] 模板 onLyricsLoaded 錯誤:', e); }
    }
    isRunning = true;
  }

  /**
   * 更新羅馬拼音（從後台羅馬化完成後推送）
   * @param {Array} romanizedLines - 含 phonetic 的歌詞行
   */
  function updateRomanization(romanizedLines) {
    if (!romanizedLines || !Array.isArray(romanizedLines)) return;

    // 以「時間」對齊，而非索引：伺服器過濾製作資訊行後行數可能與本地不同，
    // 用索引會錯位導致逐句歌詞拼音/諧音貼到錯誤的行（或不顯示）。
    const byTime = new Map();
    for (const rl of romanizedLines) {
      if (rl && typeof rl.time === 'number') byTime.set(rl.time, rl);
    }

    for (const line of parsedLyrics) {
      const rl = byTime.get(line.time);
      if (!rl) continue;
      if (rl.phonetic) line.phonetic = rl.phonetic;
      if (rl.xieyin) line.xieyin = rl.xieyin;
      if (line.words && rl.words) {
        for (let j = 0; j < line.words.length && j < rl.words.length; j++) {
          if (rl.words[j] && rl.words[j].phonetic) line.words[j].phonetic = rl.words[j].phonetic;
          if (rl.words[j] && rl.words[j].xieyin) line.words[j].xieyin = rl.words[j].xieyin;
        }
      }
    }

    // 如果當前正在顯示某行，更新其羅馬拼音 DOM
    if (currentLineIndex >= 0 && previousLineEl) {
      const line = parsedLyrics[currentLineIndex];
      if (line) {
        // 羅馬拼音行
        const existingRomaji = previousLineEl.querySelector('.phonetic-line:not(.xieyin-line)');
        if (existingRomaji) {
          updatePhoneticLineDOM(existingRomaji, line, 'phonetic');
        } else if (line.phonetic && showsRomaji()) {
          previousLineEl.appendChild(createPhoneticLine(line, 'phonetic'));
        }
        // 諧音行
        const existingXieyin = previousLineEl.querySelector('.xieyin-line');
        if (existingXieyin) {
          updatePhoneticLineDOM(existingXieyin, line, 'xieyin');
        } else if (line.xieyin && showsXieyin()) {
          previousLineEl.appendChild(createPhoneticLine(line, 'xieyin'));
        }
      }
    }
  }

  /**
   * Phase 5: 設定時間偏移
   * @param {number} offsetMs - 偏移毫秒數（正數=提前，負數=延後）
   */
  function setOffset(offsetMs) {
    timeOffsetMs = offsetMs || 0;
  }

  /**
   * Phase 5: 取得當前偏移
   */
  function getOffset() {
    return timeOffsetMs;
  }

  // 時間訊號抖動容忍（毫秒）：rAF 插值與 lyrics:sync 重設併行時，時間可能非單調地
  // 略微倒退（音訊位置回報有領先/跳動）。若「倒退剛好一行、且只略低於目前行起點」就換行，
  // 會造成「前進→倒退→再前進」的雙重跳動（歌詞切換越快越明顯）。在此容忍範圍內忽略倒退。
  const BACKWARD_JITTER_MS = 500;

  function update(currentTimeMs) {
    if (!isRunning || parsedLyrics.length === 0) return;

    // Phase 5: 套用時間偏移
    const adjustedTimeMs = currentTimeMs + timeOffsetMs;
    lastAdjustedTimeMs = adjustedTimeMs;

    const isClassic = templateId === 'classic';
    const newLineIndex = findCurrentLine(adjustedTimeMs);

    if (newLineIndex !== currentLineIndex) {
      if (newLineIndex < currentLineIndex) {
        // ── 倒退 ──
        // 區分「真正的倒帶(seek)」與「時間訊號抖動」：
        // 抖動＝只退一行、且時間僅略低於目前行起點 → 忽略，避免雙重跳動。
        const curLine = parsedLyrics[currentLineIndex];
        const curStart = curLine ? curLine.time : 0;
        const isJitter = newLineIndex === currentLineIndex - 1
          && (curStart - adjustedTimeMs) < BACKWARD_JITTER_MS;
        if (!isJitter) {
          const prevIndex = currentLineIndex;
          if (isClassic) {
            // 真正倒帶：清空畫面重新開始，避免把「未來的歌詞」留在歷史區造成錯亂
            clearDisplay();
            currentLineIndex = newLineIndex;
            previousLineEl = newLineIndex >= 0 ? renderLine(newLineIndex) : null;
          } else {
            currentLineIndex = newLineIndex;
            if (activeTemplateObj && activeTemplateObj.onSeek) {
              try { activeTemplateObj.onSeek(adjustedTimeMs, buildTemplateContext()); } catch (e) { console.warn(`[Karaoke] 模板 ${templateId} onSeek 錯誤:`, e); }
            } else if (activeTemplateObj && activeTemplateObj.onLineChange) {
              try { activeTemplateObj.onLineChange(prevIndex, newLineIndex, buildTemplateContext()); } catch (e) { console.warn(`[Karaoke] 模板 ${templateId} onLineChange 錯誤:`, e); }
            }
          }
        }
        // isJitter：維持現狀，不換行、不動畫
      } else {
        // ── 前進 ──
        const prevIndex = currentLineIndex;
        if (isClassic) {
          if (currentLineIndex >= 0 && previousLineEl) {
            pushToHistory(previousLineEl);
          }
          currentLineIndex = newLineIndex;
          previousLineEl = newLineIndex >= 0 ? renderLine(newLineIndex) : null;
        } else {
          currentLineIndex = newLineIndex;
          if (activeTemplateObj && activeTemplateObj.onLineChange) {
            try { activeTemplateObj.onLineChange(prevIndex, newLineIndex, buildTemplateContext()); } catch (e) { console.warn(`[Karaoke] 模板 ${templateId} onLineChange 錯誤:`, e); }
          }
        }
      }
    }

    if (isClassic) {
      if (currentLineIndex >= 0) {
        updateWords(adjustedTimeMs);
        runFrameEffects(adjustedTimeMs);
      }
    } else if (activeTemplateObj && activeTemplateObj.onFrame) {
      try { activeTemplateObj.onFrame(adjustedTimeMs, buildTemplateContext()); } catch (e) { console.warn(`[Karaoke] 模板 ${templateId} onFrame 錯誤:`, e); }
    }
  }

  /**
   * 找出當前時間對應的歌詞行
   * 效能優化：60fps 下每幀都會呼叫，先用快取索引做 O(1) 快速路徑
   * （絕大多數幀都停留在同一行或剛好進入下一行），
   * 只有跳轉/拖曳進度時才退回二分搜尋 O(log n)
   */
  function findCurrentLine(timeMs) {
    const n = parsedLyrics.length;
    if (n === 0) return -1;

    // 快速路徑 1：還在當前行
    if (currentLineIndex >= 0 && currentLineIndex < n) {
      const cur = parsedLyrics[currentLineIndex];
      const next = parsedLyrics[currentLineIndex + 1];
      if (timeMs >= cur.time && (!next || timeMs < next.time)) {
        return currentLineIndex;
      }
      // 快速路徑 2：剛好進入下一行
      if (next && timeMs >= next.time) {
        const afterNext = parsedLyrics[currentLineIndex + 2];
        if (!afterNext || timeMs < afterNext.time) {
          return currentLineIndex + 1;
        }
      }
    }

    // 一般路徑：二分搜尋「最後一個 time <= timeMs 的行」
    if (timeMs < parsedLyrics[0].time) return -1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (parsedLyrics[mid].time <= timeMs) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // ═══════════════════════════════════════════
  // 渲染管線
  // ═══════════════════════════════════════════

  /**
   * 渲染一行歌詞（雙語模式支援）
   */
  function renderLine(lineIndex) {
    const line = parsedLyrics[lineIndex];
    if (!line) return null;

    const style = StylePresets.getParams();

    activeEl.innerHTML = '';

    const lineEl = document.createElement('div');
    lineEl.className = `lyrics-active-line ${isWordMode() ? 'krc-mode' : 'lrc-mode'}`;
    lineEl.dataset.lineIndex = lineIndex;

    // ─── 原文行 ───
    const textLine = document.createElement('div');
    textLine.className = 'text-line';

    if (isWordMode() && line.words) {
      line.words.forEach((word, i) => {
        // \u7C21\u8F49\u7E41\u4EE5\u300C\u6574\u500B word \u5B57\u4E32\u300D\u8F49\u63DB\uFF08\u8A5E\u7D44\u7D1A\u8F03\u6E96\uFF09\uFF1B\u9010\u5B57\u9AD8\u4EAE\u4EE5 word \u70BA\u55AE\u4F4D\uFF0Cchar \u6578\u4E0D\u5F71\u97FF\u6642\u9593\u5C0D\u9F4A
        s2t(word.text).split('').forEach((char, j) => {
          const span = document.createElement('span');
          span.className = 'char';
          span.textContent = char === ' ' ? '\u00A0' : char;
          span.dataset.wordIndex = i;
          span.dataset.charInWord = j;
          span.dataset.wordStart = word.start;
          span.dataset.wordDuration = word.duration;
          textLine.appendChild(span);
        });
      });
    } else {
      // \u9010\u53E5\uFF1A\u6574\u884C\u8F49\u63DB\uFF08\u8A5E\u7D44\u7D1A\u6700\u6E96\uFF09\uFF0C\u518D\u5207\u5B57
      s2t(line.text).split('').forEach((char, i) => {
        const span = document.createElement('span');
        span.className = 'char';
        span.textContent = char === ' ' ? '\u00A0' : char;
        span.dataset.charIndex = i;
        textLine.appendChild(span);
      });
    }

    lineEl.appendChild(textLine);

    // ─── 羅馬拼音行 ───
    if (line.phonetic && showsRomaji()) {
      lineEl.appendChild(createPhoneticLine(line, 'phonetic'));
    }

    // ─── 中文諧音行 ───
    if (line.xieyin && showsXieyin()) {
      lineEl.appendChild(createPhoneticLine(line, 'xieyin'));
    }

    // ─── 根據顯示模式調整可見性 ───
    textLine.hidden = romanizationMode === 'romanized';

    activeEl.appendChild(lineEl);

    // 觸發效果：onLineEnter。快速模式（拖曳進度條/連續跳轉）時跳過入場動畫與粒子，
    // 避免每次 seek 都重跑大量 gsap/粒子 → 渲染卡死（OBS 拖曳時歌詞卡住需重整的主因）。
    if (!fastMode) {
      const effects = getActiveEffects();
      for (const effect of effects) {
        if (effect.onLineEnter) {
          try { effect.onLineEnter(lineEl, line, style); } catch (e) { console.warn(`[Karaoke] 效果 ${effect.name} onLineEnter 錯誤:`, e); }
        }
      }
    }

    return lineEl;
  }

  /**
   * 建立羅馬拼音行 / 諧音行 DOM
   * @param {object} line - 歌詞行
   * @param {string} kind - 'phonetic'（羅馬拼音）或 'xieyin'（中文諧音）
   */
  function createPhoneticLine(line, kind = 'phonetic') {
    const phLine = document.createElement('div');
    phLine.className = kind === 'xieyin' ? 'phonetic-line xieyin-line' : 'phonetic-line';

    if (isWordMode() && line.words) {
      // KRC: 逐字對應
      line.words.forEach((word, i) => {
        const wordPhonetic = word[kind] || '';
        if (wordPhonetic) {
          wordPhonetic.split('').forEach((char, j) => {
            const span = document.createElement('span');
            span.className = 'phonetic-char';
            span.textContent = char === ' ' ? '\u00A0' : char;
            span.dataset.wordIndex = i;
            span.dataset.charInWord = j;
            phLine.appendChild(span);
          });
        }
        // word 間加空格
        if (i < line.words.length - 1) {
          const space = document.createElement('span');
          space.className = 'phonetic-char';
          space.textContent = '\u00A0';
          space.dataset.wordIndex = i;
          space.dataset.charInWord = 'space';
          phLine.appendChild(space);
        }
      });
    } else {
      // LRC: 整行
      (line[kind] || '').split('').forEach((char, i) => {
        const span = document.createElement('span');
        span.className = 'phonetic-char';
        span.textContent = char === ' ' ? '\u00A0' : char;
        span.dataset.charIndex = i;
        phLine.appendChild(span);
      });
    }

    return phLine;
  }

  /**
   * 更新現有 phonetic-line 的內容
   */
  function updatePhoneticLineDOM(phLine, line, kind = 'phonetic') {
    phLine.innerHTML = '';

    if (isWordMode() && line.words) {
      line.words.forEach((word, i) => {
        const wordPhonetic = word[kind] || '';
        if (wordPhonetic) {
          wordPhonetic.split('').forEach((char, j) => {
            const span = document.createElement('span');
            span.className = 'phonetic-char';
            span.textContent = char === ' ' ? '\u00A0' : char;
            span.dataset.wordIndex = i;
            span.dataset.charInWord = j;
            phLine.appendChild(span);
          });
        }
        if (i < line.words.length - 1) {
          const space = document.createElement('span');
          space.className = 'phonetic-char';
          space.textContent = '\u00A0';
          phLine.appendChild(space);
        }
      });
    } else {
      (line[kind] || '').split('').forEach((char, i) => {
        const span = document.createElement('span');
        span.className = 'phonetic-char';
        span.textContent = char === ' ' ? '\u00A0' : char;
        span.dataset.charIndex = i;
        phLine.appendChild(span);
      });
    }
  }

  /**
   * 更新逐字高亮（含雙語 KTV 同步）
   */
  function updateWords(timeMs) {
    if (!isWordMode() || currentLineIndex < 0) return;

    const line = parsedLyrics[currentLineIndex];
    if (!line?.words) return;

    const style = StylePresets.getParams();
    const lineStartTime = line.time;
    const effects = getActiveEffects();

    line.words.forEach((word, wordIdx) => {
      const wordStartTime = lineStartTime + word.start;
      // 「開始時間一過就點亮並保持」而非只在 [start,end) 時間窗內才亮：
      // 否則兩幀之間若整個跳過某字的時間窗（短字／掉幀／OBS 節流），那個字會永遠不亮。
      // 已唱過的字本來就該維持高亮直到整行降為歷史，用 >= start 同時修好「跳過漏亮」與「保持」。
      if (timeMs < wordStartTime) return;

      const wordChars = activeEl.querySelectorAll(`.text-line .char[data-word-index="${wordIdx}"]`);
      wordChars.forEach(charEl => {
        if (charEl.classList.contains('active')) return;

        charEl.classList.add('active');

        for (const effect of effects) {
          if (effect.onWordActive) {
            try { effect.onWordActive(charEl, style); } catch (e) { console.warn(`[Karaoke] 效果 ${effect.name} onWordActive 錯誤:`, e); }
          }
        }
      });

      // 雙語 KTV：對應的羅馬拼音字元也標記為 active
      if (romanizationMode !== 'original') {
        const phoneticChars = activeEl.querySelectorAll(`.phonetic-line .phonetic-char[data-word-index="${wordIdx}"]`);
        phoneticChars.forEach(phChar => {
          if (phChar.classList.contains('active')) return;
          phChar.classList.add('active');
        });
      }
    });
  }

  function runFrameEffects(timeMs) {
    if (fastMode || !previousLineEl) return;
    const style = StylePresets.getParams();
    const effects = getActiveEffects();

    for (const effect of effects) {
      if (effect.onFrame) {
        try { effect.onFrame(previousLineEl, timeMs, style); } catch (e) { /* 靜默處理幀效果錯誤 */ }
      }
    }
  }

  function getActiveEffects() {
    const style = StylePresets.getParams();
    const isKrc = isWordMode(); // 逐字停用後一律走逐句效果（stagger 等），讓逐句也有逐字入場動畫
    const effectNames = style.effects || (isKrc ? ['ktv-fill'] : ['stagger']);

    // KRC 模式使用 krcEffects
    if (isKrc && style.krcEffects) {
      return resolveEffects(style.krcEffects, 'ktv-fill');
    }

    return resolveEffects(effectNames, isKrc ? 'ktv-fill' : 'stagger');
  }

  function resolveEffects(names, fallbackName) {
    const effects = [];
    for (const name of names) {
      const effect = effectRegistry.get(name);
      if (effect) effects.push(effect);
    }

    // 始終包含基礎效果
    if (!effects.find(e => e.name === fallbackName)) {
      const fallback = effectRegistry.get(fallbackName);
      if (fallback) effects.unshift(fallback);
    }

    return effects;
  }

  // ═══════════════════════════════════════════
  // 歷史歌詞推移
  // ═══════════════════════════════════════════

  function pushToHistory(lineEl) {
    if (!lineEl) return;

    // 先讓「即將降為歷史」的這行完成入場：停掉未跑完的逐字淡入/位移並設為最終狀態。
    // 否則兩句間隔很近時，A 還在淡入(opacity<1、位移中)就被換掉，歷史複本卻從 opacity:1、
    // 最終位置起跳 → 視覺上「跳一下前一句」。先收尾再降級，過渡才連續。
    if (typeof gsap !== 'undefined') {
      const srcChars = lineEl.querySelectorAll('.char');
      const srcPhChars = lineEl.querySelectorAll('.phonetic-char');
      const srcPhLines = lineEl.querySelectorAll('.phonetic-line');
      gsap.killTweensOf(srcChars); gsap.killTweensOf(srcPhChars); gsap.killTweensOf(srcPhLines);
      gsap.set(srcChars, { opacity: 1, scale: 1, x: 0, y: 0, filter: 'none' });
      gsap.set(srcPhLines, { opacity: 1, y: 0 });
    }

    const style = StylePresets.getParams();
    const exitAnim = style.animation.lineExit;
    const removeAnim = style.animation.lineRemove;

    // 先記錄「舊 active 行」的螢幕位置與字級 → 新歷史行從這個大小/位置平滑縮小上移，
    // 避免複製成歷史(小字)時瞬間縮小造成「跳一下」。
    const oldRect = lineEl.getBoundingClientRect();
    const oldFont = parseFloat(getComputedStyle(lineEl).fontSize) || 60;

    const historyLine = document.createElement('div');
    historyLine.className = 'lyrics-history-line';
    historyLine.innerHTML = lineEl.innerHTML;

    // 清除 KRC active 樣式
    historyLine.querySelectorAll('.char.active').forEach(el => {
      el.classList.remove('active');
      gsap.set(el, { scale: 1, color: 'rgba(255,255,255,0.3)', textShadow: 'none', x: 0, y: 0 });
    });

    historyLine.querySelectorAll('.char').forEach(el => {
      gsap.set(el, { opacity: 1, scale: 1, filter: 'none', x: 0, y: 0 });
    });

    historyLine.querySelectorAll('.phonetic-char.active').forEach(el => {
      el.classList.remove('active');
      gsap.set(el, { scale: 1, opacity: 0.5, color: 'rgba(255,255,255,0.3)', textShadow: 'none' });
    });

    if (fastMode) {
      // 快速模式（拖曳/跳轉）：不做位移與縮放動畫，直接設成歷史樣式
      historyEl.appendChild(historyLine);
      historyLine.style.opacity = String(exitAnim.opacityTo != null ? exitAnim.opacityTo : 0.3);
    } else {
      // FLIP：記錄既有歷史行 append 前的位置，稍後補償位移 → 平滑上移而非瞬間跳動
      const existing = Array.from(historyEl.querySelectorAll('.lyrics-history-line'));
      const beforeTops = existing.map(el => el.getBoundingClientRect().top);

      historyEl.appendChild(historyLine);

      // 既有歷史行：從舊位置平滑滑到新位置
      existing.forEach((el, i) => {
        const dy = beforeTops[i] - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 0.5) {
          gsap.fromTo(el, { y: `+=${dy}` }, { y: 0, duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
        }
      });

      const effects = getActiveEffects();
      for (const effect of effects) {
        if (effect.onLineExit) {
          try { effect.onLineExit(historyLine, style); } catch (e) { /* 靜默 */ }
        }
      }

      // 新進歷史行：從「舊 active 的位置與大小」平滑縮小 + 上移到歷史位置（不瞬間縮小、不跳動）
      const newRect = historyLine.getBoundingClientRect();
      const newFont = parseFloat(getComputedStyle(historyLine).fontSize) || 36;
      const dy = oldRect.top - newRect.top;              // 從舊 active 位置滑來
      const startScale = Math.max(1, oldFont / newFont); // 從舊 active 大小縮來（約 1.5~1.8）
      gsap.fromTo(historyLine,
        { y: dy, scale: startScale, opacity: 1, transformOrigin: 'center top' },
        {
          y: 0, scale: 1, opacity: exitAnim.opacityTo, duration: 0.5, ease: 'power3.out',
        }
      );
    }

    const historyLines = historyEl.querySelectorAll('.lyrics-history-line');
    if (historyLines.length > maxHistoryLines) {
      const oldestLine = historyLines[0];
      gsap.to(oldestLine, {
        opacity: 0,
        y: removeAnim.yTo,
        scale: removeAnim.scaleTo || 0.7,
        duration: removeAnim.duration,
        ease: removeAnim.ease,
        onComplete: () => {
          // 銷毀前先終止該節點與其子節點上殘留的 tween，
          // 釋放 GSAP 對 DOM 的引用，防止長時間直播記憶體累積
          gsap.killTweensOf(oldestLine);
          gsap.killTweensOf(oldestLine.querySelectorAll('*'));
          if (oldestLine.parentNode) oldestLine.parentNode.removeChild(oldestLine);
        },
      });
    }

    // 保險絲：歷史區若異常累積（例如動畫被中斷導致 onComplete 未觸發），
    // 超過上限 2 行以上時直接硬移除，確保 DOM 永遠有界
    if (historyLines.length > maxHistoryLines + 2) {
      for (let i = 0; i < historyLines.length - maxHistoryLines; i++) {
        const el = historyLines[i];
        gsap.killTweensOf(el);
        gsap.killTweensOf(el.querySelectorAll('*'));
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    }
  }

  // ═══════════════════════════════════════════
  // 歌詞解析
  // ═══════════════════════════════════════════

  function parseLrcLyrics(lrcText) {
    const lines = lrcText.split('\n');
    const parsed = [];

    for (const line of lines) {
      const regex = /\[(\d{2}:\d{2}(?:\.\d{2,3})?)\]/g;
      const timestamps = [];
      let match;
      while ((match = regex.exec(line)) !== null) timestamps.push(parseLrcTimestamp(match[1]));

      const text = line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
      if (timestamps.length > 0 && text) {
        for (const time of timestamps) parsed.push({ time, text, phonetic: '', words: [] });
      }
    }

    parsed.sort((a, b) => a.time - b.time);
    return parsed;
  }

  function parseKrcLyrics(krcText) {
    const lines = krcText.split('\n');
    const parsed = [];

    const metadataPatterns = [
      /^(.+ - .+)\s*\(.*\)$/, /^词[：:]/, /^曲[：:]/, /^编曲[：:]/, /^制作/, /^合声/,
      /^录音/, /^混音/, /^母带/, /^鼓[：:]/, /^吉他[：:]/, /^贝斯[：:]/, /^键盘[：:]/, /^弦乐[：:]/, /^和声/,
    ];

    for (const line of lines) {
      const lineMatch = line.match(/^\[(\d{2}:\d{2}\.\d{2,3})\]<(\d+)>(.*)/);
      if (!lineMatch) continue;

      const lineTime = parseLrcTimestamp(lineMatch[1]);
      const lineDuration = parseInt(lineMatch[2], 10);
      const content = lineMatch[3];

      const words = [];
      const wordRegex = /([^<]+)(?:<(\d+),(\d+)>)/g;
      let wordMatch;
      let fullText = '';

      while ((wordMatch = wordRegex.exec(content)) !== null) {
        let wordText = wordMatch[1];
        // 清理混入文字的數字計時殘留
        wordText = wordText.replace(/\d+\.?\d*,\d+\.?\d*>?/g, '').replace(/>\s*$/g, '');
        if (!wordText.trim()) continue;
        fullText += wordText;
        words.push({ text: wordText, start: parseInt(wordMatch[2], 10), duration: parseInt(wordMatch[3], 10), phonetic: '' });
      }

      if (words.length > 0) {
        const trimmedText = fullText.trim();
        const isMetadata = metadataPatterns.some(p => p.test(trimmedText));
        const isEarlyLine = lineTime < 15000 && (trimmedText.includes('：') || trimmedText.includes(':') || trimmedText.includes(' - '));

        if (!isMetadata && !isEarlyLine) {
          parsed.push({ time: lineTime, duration: lineDuration, text: fullText, words, phonetic: '' });
        }
      }
    }

    parsed.sort((a, b) => a.time - b.time);
    return parsed;
  }

  function parseLrcTimestamp(tag) {
    const match = String(tag).match(/(\d+):(\d+)\.(\d+)/);
    if (!match) return 0;
    const padThird = match[3].length === 2 ? match[3] + '0' : match[3];
    return (parseInt(match[1], 10) * 60 + parseInt(match[2], 10)) * 1000 + parseInt(padThird, 10);
  }

  // ═══════════════════════════════════════════
  // 公開介面
  // ═══════════════════════════════════════════

  function clearDisplay() {
    for (const [, effect] of effectRegistry) {
      if (effect.onDestroy) {
        try { effect.onDestroy(); } catch (e) { /* 靜默 */ }
      }
    }
    // 清空前先終止所有殘留 tween，釋放 GSAP 引用
    if (typeof gsap !== 'undefined') {
      if (historyEl) gsap.killTweensOf(historyEl.querySelectorAll('*'));
      if (activeEl) gsap.killTweensOf(activeEl.querySelectorAll('*'));
    }
    if (historyEl) historyEl.innerHTML = '';
    if (activeEl) activeEl.innerHTML = '';
    currentLineIndex = -1;
    previousLineEl = null;
    // 注意：不要在這裡設 isRunning=false。clearDisplay 也用於「往回跳轉時重置畫面」，
    // 若設 false 會讓之後所有 update() 直接 return → 拖曳進度條往回拉後歌詞卡死、需重整 OBS。
    // 真正停止由 stop() 處理；無歌詞時 update() 會因 parsedLyrics 為空而自然 return。
  }

  function setRomanizationMode(mode) {
    // 模式沒變就不要重渲染：renderLine 會重跑入場動畫+粒子。
    // 否則每次 state:sync（即使只是改了字級/顏色等其他設定）都會用相同模式呼叫這裡 → 動畫白重跑。
    if (mode === romanizationMode) return;
    romanizationMode = mode;
    // 如果正在顯示歌詞，重新渲染當前行
    if (currentLineIndex >= 0 && previousLineEl) {
      previousLineEl = renderLine(currentLineIndex);
    }
  }

  function setMaxHistoryLines(count) { maxHistoryLines = count; }
  function setWordModeAndRerender(b) {
    setWordByWord(b);
    if (currentLineIndex >= 0 && previousLineEl) previousLineEl = renderLine(currentLineIndex);
  }
  function getLyrics() { return parsedLyrics; }
  function getCurrentLineIndex() { return currentLineIndex; }
  function stop() { isRunning = false; }

  /**
   * Phase 7: 取得第一句歌詞的開始時間（毫秒）
   * 用於前奏倒數提示（視覺節拍器）
   * @returns {number} 第一句歌詞的 startTime，若無歌詞則返回 -1
   */
  function getFirstLineTime() {
    if (!parsedLyrics || parsedLyrics.length === 0) return -1;
    // 找到第一個有文字內容的歌詞行（跳過空白行）
    for (let i = 0; i < parsedLyrics.length; i++) {
      const line = parsedLyrics[i];
      if (line.text && line.text.trim()) {
        return line.time;
      }
    }
    return -1;
  }

  /**
   * Phase 7: 取得歌詞總時長（最後一行結束時間）
   * @returns {number} 估計的歌詞結束時間（毫秒），若無歌詞則返回 0
   */
  function getLyricsEndTime() {
    if (!parsedLyrics || parsedLyrics.length === 0) return 0;
    const lastLine = parsedLyrics[parsedLyrics.length - 1];
    if (lastLine.duration) {
      return lastLine.time + lastLine.duration;
    }
    // 沒有 duration 資訊，估計最後一行持續 5 秒
    return lastLine.time + 5000;
  }

  function setEffects(names) {
    const style = StylePresets.getParams();
    if (!style.effects) style.effects = [];
    style.effects = names.filter(n => effectRegistry.has(n));
  }

  function getAvailableEffects() {
    return Array.from(effectRegistry.keys());
  }

  // ═══════════════════════════════════════════
  // 排版模板（v4）
  // ═══════════════════════════════════════════

  // ─── 排版模板用的簡轉繁歌詞快取 ───
  // 「經典疊層」自己在 renderLine 內逐字呼叫 s2t()，不受影響。但 v5 起的排版模板
  // （Pulse/Facet/Drift/Aura/KTV）都是透過 ctx.getLyrics() 拿原始資料自己組字，
  // 從未呼叫過 s2t()——簡轉繁對它們形同虛設。這裡在唯一的取用點做一次性轉換：
  // 用 (parsedLyrics 參照, s2tEnabled 旗標) 做記憶化，兩者都沒變就直接回傳快取，
  // 不會每幀重新跑 OpenCC；任一個變了就重建（新物件參照），下游各模板既有的
  // 「lines 參照沒變就不重建」快取（例如 KTV 的 ensureUnits）會自然偵測到並跟著更新。
  let convertedLyricsCache = null;
  let convertedLyricsSourceRef = null;
  let convertedLyricsS2tFlag = null;
  function getTemplateLyrics() {
    if (convertedLyricsCache && convertedLyricsSourceRef === parsedLyrics && convertedLyricsS2tFlag === s2tEnabled) {
      return convertedLyricsCache;
    }
    convertedLyricsCache = !s2tEnabled ? parsedLyrics : parsedLyrics.map((line) => {
      const converted = { ...line, text: s2t(line.text) };
      if (Array.isArray(line.words) && line.words.length > 0) {
        converted.words = line.words.map((w) => ({ ...w, text: s2t(w.text) }));
      }
      return converted;
    });
    convertedLyricsSourceRef = parsedLyrics;
    convertedLyricsS2tFlag = s2tEnabled;
    return convertedLyricsCache;
  }

  /**
   * 提供給模板生命週期方法的唯讀上下文。模板不應直接碰 karaoke.js 的內部狀態，
   * 一律透過這裡的存取函式，維持 karaoke.js 對外的封裝邊界。
   */
  function buildTemplateContext() {
    return {
      getLyrics: () => getTemplateLyrics(),
      getLineIndex: () => currentLineIndex,
      isWordMode,
      showsRomaji,
      showsXieyin,
      s2t,
      isFastMode: () => fastMode,
      getOffset,
      activeColor,
      activeGlow,
      StylePresets: (typeof StylePresets !== 'undefined') ? StylePresets : null,
      kernel: (typeof LyricMotion !== 'undefined') ? LyricMotion : null,
    };
  }

  /**
   * 切換排版模板。id 未註冊時退回 'classic'；同 id 早退（避免高頻 lyric-settings 重送時反覆重建）。
   */
  function setTemplate(id) {
    const hasRegistry = typeof LyricTemplates !== 'undefined';
    const nextId = (hasRegistry && LyricTemplates.has(id)) ? id : 'classic';
    if (nextId === templateId) return;

    if (templateId !== 'classic' && activeTemplateObj && activeTemplateObj.destroy) {
      try { activeTemplateObj.destroy(); } catch (e) { console.warn(`[Karaoke] 模板 ${templateId} 卸載錯誤:`, e); }
    }

    templateId = nextId;
    activeTemplateObj = (nextId !== 'classic' && hasRegistry) ? LyricTemplates.get(nextId) : null;

    // CSS hook：body.template-<id> 讓各模板調整可視區高度等版面（classic 不加 class）
    document.body.className = document.body.className.replace(/\btemplate-[\w-]+\b/g, '').trim();

    if (nextId === 'classic') {
      // 切回經典：還原疊層容器顯示，依目前行重繪
      if (historyEl) historyEl.hidden = false;
      if (activeEl) activeEl.hidden = false;
      previousLineEl = (currentLineIndex >= 0) ? renderLine(currentLineIndex) : null;
    } else {
      // 切到自訂模板：隱藏經典疊層容器，清空殘留內容，掛載新模板
      if (historyEl) { historyEl.hidden = true; historyEl.innerHTML = ''; }
      if (activeEl) { activeEl.hidden = true; activeEl.innerHTML = ''; }
      document.body.classList.add(`template-${nextId}`);
      previousLineEl = null;
      if (activeTemplateObj && activeTemplateObj.mount) {
        try { activeTemplateObj.mount(containerEl, buildTemplateContext()); } catch (e) { console.warn(`[Karaoke] 模板 ${nextId} 掛載錯誤:`, e); }
      }
      if (parsedLyrics.length > 0 && activeTemplateObj && activeTemplateObj.onLyricsLoaded) {
        try { activeTemplateObj.onLyricsLoaded(parsedLyrics, buildTemplateContext()); } catch (e) { /* 靜默 */ }
      }
      if (activeTemplateObj && activeTemplateObj.onSeek) {
        try { activeTemplateObj.onSeek(lastAdjustedTimeMs, buildTemplateContext()); } catch (e) { /* 靜默 */ }
      }
    }
  }

  function getTemplate() { return templateId; }

  if (typeof LyricTemplates !== 'undefined') {
    // 純標記用：classic 走內建管線、不透過 registry 分派，這裡註冊只是讓它出現在 list() 裡。
    LyricTemplates.register({ id: 'classic', label: '經典疊層' });
  }

  return {
    init,
    loadLyrics,
    update,
    clearDisplay,
    setRomanizationMode,
    setMaxHistoryLines,
    setWordByWord: setWordModeAndRerender,
    setTraditional,
    setFastMode,
    getLyrics,
    getCurrentLineIndex,
    stop,
    setEffects,
    getAvailableEffects,
    registerEffect,
    getEffect,
    updateRomanization,
    setOffset,
    getOffset,
    getFirstLineTime,
    getLyricsEndTime,
    setTemplate,
    getTemplate,
  };
})();
