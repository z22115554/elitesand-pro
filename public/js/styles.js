/**
 * Elitesand Pro 風格預設系統 v2
 * 
 * 三種風格 + 動畫效果組合：
 * 🌸 可愛彈跳 (cute) - 彈性曲線、俏皮 Stagger、粉紅光暈 + 波浪 + 粒子
 * 🎸 搖滾炸裂 (rock) - 爆發力道、震動效果、紅色烈焰 + 故障 + 粒子
 * 🌌 抒情柔美 (ballad) - 柔和漸變、長淡入、藍色月光 + 霓虹脈衝
 */
const StylePresets = (() => {
  const presets = {
    cute: {
      name: '可愛彈跳',
      description: '彈性曲線、俏皮 Stagger、粉紅光暈',
      // 啟用的效果組合
      // 註：移除 'wave'（逐幀搖動）——OBS 非聚焦時 rAF 被節流，逐幀 gsap.set 會變成抖動而非順暢搖擺。
      effects: ['stagger', 'particle'],
      krcEffects: ['ktv-fill', 'particle'],
      // GSAP 動畫參數
      // 特色輪廓：Q 彈——大幅回彈的 elastic、明顯逐字錯落，字像果凍一樣跳進來
      animation: {
        lineEnter: {
          duration: 0.85,
          ease: 'elastic.out(1.1, 0.42)',
          stagger: 0.05,
          yFrom: 46,
          scaleFrom: 0.65,
          blurFrom: 3,
        },
        wordActive: {
          duration: 0.14,
          ease: 'back.out(2.6)',
          scale: 1.24,
          color: '#ff6b9d',
          glow: '0 0 15px rgba(255,107,157,0.9), 0 0 30px rgba(255,107,157,0.5)',
        },
        lineExit: {
          duration: 0.5,
          ease: 'power2.inOut',
          scaleTo: 0.85,
          opacityTo: 0.3,
          yTo: -20,
        },
        lineRemove: {
          duration: 0.4,
          ease: 'power2.in',
          opacityTo: 0,
          yTo: -30,
        },
      },
      cssVars: {
        '--active-glow': 'rgba(255, 107, 157, 0.8)',
        '--active-color': '#ff6b9d',
      },
    },

    rock: {
      name: '搖滾炸裂',
      description: '爆發力道、震動效果、紅色烈焰',
      effects: ['stagger', 'glitch', 'particle'],
      krcEffects: ['ktv-fill', 'glitch', 'particle'],
      // 特色輪廓：砸落——整行從放大 1.6 倍猛力砸進定位、幾乎同時出現（stagger 極小），衝擊感
      animation: {
        lineEnter: {
          duration: 0.22,
          ease: 'back.out(4)',
          stagger: 0.012,
          yFrom: 72,
          scaleFrom: 1.6,
          blurFrom: 10,
        },
        wordActive: {
          duration: 0.08,
          ease: 'power4.out',
          scale: 1.35,
          color: '#ff3c3c',
          glow: '0 0 15px rgba(255,60,60,1), 0 0 30px rgba(255,60,60,0.7), 0 0 50px rgba(255,60,60,0.3)',
        },
        lineExit: {
          duration: 0.25,
          ease: 'power3.in',
          scaleTo: 0.7,
          opacityTo: 0.2,
          yTo: -46,
        },
        lineRemove: {
          duration: 0.2,
          ease: 'power3.in',
          opacityTo: 0,
          yTo: -56,
        },
      },
      cssVars: {
        '--active-glow': 'rgba(255, 60, 60, 0.9)',
        '--active-color': '#ff3c3c',
      },
    },

    ballad: {
      name: '抒情柔美',
      description: '柔和漸變、長淡入、藍色月光',
      effects: ['stagger', 'neon-pulse'],
      krcEffects: ['ktv-fill', 'neon-pulse'],
      // 特色輪廓：漂浮——很慢很長的淡入、逐字如水波般依序浮現，幾乎沒有縮放
      animation: {
        lineEnter: {
          duration: 1.7,
          ease: 'power1.out',
          stagger: 0.085,
          yFrom: 10,
          scaleFrom: 0.98,
          blurFrom: 8,
        },
        wordActive: {
          duration: 0.35,
          ease: 'power1.out',
          scale: 1.03,
          color: '#64b4ff',
          glow: '0 0 15px rgba(100,180,255,0.9), 0 0 30px rgba(100,180,255,0.5)',
        },
        lineExit: {
          duration: 1.4,
          ease: 'power1.inOut',
          scaleTo: 0.94,
          opacityTo: 0.25,
          yTo: -8,
        },
        lineRemove: {
          duration: 1.0,
          ease: 'power1.in',
          opacityTo: 0,
          yTo: -16,
        },
      },
      cssVars: {
        '--active-glow': 'rgba(100, 180, 255, 0.8)',
        '--active-color': '#64b4ff',
      },
    },

    sparkle: {
      name: '夢幻閃耀',
      description: '金粉光暈、輕盈彈入、粒子閃爍',
      effects: ['stagger', 'neon-pulse', 'particle'],
      krcEffects: ['ktv-fill', 'neon-pulse', 'particle'],
      // 特色輪廓：綻放——字從極小點「綻放」開來（scaleFrom 0.3）、逐字錯落大、金粉光暈
      animation: {
        lineEnter: {
          duration: 0.75, ease: 'back.out(2.4)', stagger: 0.065,
          yFrom: 6, scaleFrom: 0.3, blurFrom: 6,
        },
        wordActive: {
          duration: 0.18, ease: 'back.out(2)', scale: 1.26,
          color: '#ffd479',
          glow: '0 0 14px rgba(255,212,121,0.95), 0 0 28px rgba(255,170,90,0.55), 0 0 48px rgba(255,140,80,0.25)',
        },
        lineExit: { duration: 0.6, ease: 'power2.inOut', scaleTo: 0.88, opacityTo: 0.3, yTo: -18 },
        lineRemove: { duration: 0.45, ease: 'power2.in', opacityTo: 0, yTo: -28 },
      },
      cssVars: { '--active-glow': 'rgba(255, 212, 121, 0.85)', '--active-color': '#ffd479' },
    },

    dreamy: {
      name: '空靈柔光',
      description: '紫色月光、柔和淡入、緩慢呼吸',
      // 移除 'wave'（逐幀搖動）：OBS 端 rAF 節流會變抖動，故拿掉，保留柔和淡入。
      effects: ['stagger'],
      krcEffects: ['ktv-fill'],
      // 特色輪廓：鬼影——從放大 1.18 倍＋重模糊「聚焦」收攏成形（與其他風格全部相反的方向）
      animation: {
        lineEnter: {
          duration: 1.5, ease: 'power2.out', stagger: 0.09,
          yFrom: 0, scaleFrom: 1.18, blurFrom: 14,
        },
        wordActive: {
          duration: 0.35, ease: 'power1.out', scale: 1.06,
          color: '#c9a9ff',
          glow: '0 0 16px rgba(201,169,255,0.9), 0 0 34px rgba(170,130,255,0.5)',
        },
        lineExit: { duration: 1.2, ease: 'power1.inOut', scaleTo: 1.06, opacityTo: 0.22, yTo: -6 },
        lineRemove: { duration: 0.9, ease: 'power1.in', opacityTo: 0, yTo: -12 },
      },
      cssVars: { '--active-glow': 'rgba(201, 169, 255, 0.8)', '--active-color': '#c9a9ff' },
    },

    minimal: {
      name: '簡約純淨',
      description: '無粒子、乾淨淡入、適合字幕風',
      effects: ['stagger'],
      krcEffects: ['ktv-fill'],
      // 特色輪廓：字幕感——整行同時純淡入，零位移零縮放零模糊，最安靜的一款
      animation: {
        lineEnter: {
          duration: 0.32, ease: 'power2.out', stagger: 0,
          yFrom: 0, scaleFrom: 1, blurFrom: 0,
        },
        wordActive: {
          duration: 0.2, ease: 'power2.out', scale: 1.02,
          color: '#ffffff',
          glow: '0 0 8px rgba(255,255,255,0.6)',
        },
        lineExit: { duration: 0.35, ease: 'power1.inOut', scaleTo: 1, opacityTo: 0.3, yTo: 0 },
        lineRemove: { duration: 0.25, ease: 'power1.in', opacityTo: 0, yTo: 0 },
      },
      cssVars: { '--active-glow': 'rgba(255, 255, 255, 0.6)', '--active-color': '#ffffff' },
    },
  };

  let currentStyle = 'cute';
  let overrides = {};

  function getParams() {
    const base = presets[currentStyle];
    if (!base) return presets.cute;

    const merged = JSON.parse(JSON.stringify(base));
    if (overrides.animation) {
      for (const key of Object.keys(overrides.animation)) {
        if (merged.animation[key]) {
          Object.assign(merged.animation[key], overrides.animation[key]);
        } else {
          merged.animation[key] = overrides.animation[key];
        }
      }
    }
    if (overrides.effects) merged.effects = overrides.effects;
    if (overrides.krcEffects) merged.krcEffects = overrides.krcEffects;

    return merged;
  }

  function setStyle(styleName) {
    if (!presets[styleName]) {
      console.warn(`[Style] 未知風格: ${styleName}`);
      return;
    }
    currentStyle = styleName;
    applyCssVars();
  }

  function getStyle() { return currentStyle; }
  function getStyleNames() { return Object.keys(presets); }

  function setOverrides(params) { overrides = params; }

  function applyCssVars() {
    const preset = presets[currentStyle];
    if (!preset?.cssVars) return;

    for (const [key, value] of Object.entries(preset.cssVars)) {
      document.body.style.setProperty(key, value);
    }

    document.body.className = document.body.className
      .replace(/style-\w+/g, '')
      .trim();
    document.body.classList.add(`style-${currentStyle}`);
  }

  function init() {
    setStyle('cute');
  }

  return {
    init,
    getParams,
    setStyle,
    getStyle,
    getStyleNames,
    setOverrides,
    applyCssVars,
    presets,
  };
})();
