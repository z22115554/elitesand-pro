/**
 * 動畫風格微調 — 控制面板側
 *
 * 讓使用者在選定的風格 preset 之上微調動畫參數（速度/高亮放大/入場位移/模糊/錯落），
 * 即時套用到本地預覽並透過 socket('style:override') 廣播到 OBS display。
 *
 * 設計：
 * - 微調值以「相對當前 preset base」計算後存成絕對覆蓋值（StylePresets.setOverrides 用絕對值）。
 * - 切換風格時自動重置回新 preset 的 base（伺服器也會清空 overrides）。
 * - 接收伺服器回推的 style:override（持久化還原 / 多控制端同步）時只更新 UI，不再廣播，避免迴圈。
 */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const speed = el('st-speed'), scale = el('st-scale'), yfrom = el('st-yfrom'), blur = el('st-blur'), stagger = el('st-stagger');
  if (!speed || typeof StylePresets === 'undefined') return;

  const valSpeed = el('st-speed-val'), valScale = el('st-scale-val'), valY = el('st-yfrom-val'), valBlur = el('st-blur-val'), valStagger = el('st-stagger-val');

  const particles = el('st-particles');
  function basePreset() {
    return StylePresets.presets[StylePresets.getStyle()] || StylePresets.presets.cute;
  }
  function baseAnim() { return basePreset().animation; }
  // 依「粒子效果」開關覆寫 effects/krcEffects（關閉＝從清單移除 'particle'）
  function effectsOverride() {
    if (!particles || particles.checked) return {}; // 開＝用 preset 預設，不覆寫
    const p = basePreset();
    return {
      effects: (p.effects || []).filter((e) => e !== 'particle'),
      krcEffects: (p.krcEffects || []).filter((e) => e !== 'particle'),
    };
  }

  function updateLabels() {
    valSpeed.textContent = parseFloat(speed.value).toFixed(1) + 'x';
    valScale.textContent = parseFloat(scale.value).toFixed(2) + 'x';
    valY.textContent = parseInt(yfrom.value, 10) + 'px';
    valBlur.textContent = parseInt(blur.value, 10) + 'px';
    valStagger.textContent = Math.round(parseFloat(stagger.value) * 1000) + 'ms';
  }

  function buildOverrides() {
    const b = baseAnim();
    const m = parseFloat(speed.value) || 1;
    return {
      animation: {
        lineEnter: {
          duration: +(b.lineEnter.duration / m).toFixed(3),
          yFrom: parseFloat(yfrom.value),
          blurFrom: parseFloat(blur.value),
          stagger: parseFloat(stagger.value),
        },
        wordActive: {
          duration: +(b.wordActive.duration / m).toFixed(3),
          scale: parseFloat(scale.value),
        },
      },
      ...effectsOverride(),
    };
  }

  // 使用者拖動 → 套用本地預覽 + 廣播
  function onInput() {
    const o = buildOverrides();
    StylePresets.setOverrides(o);
    SocketClient.send('style:override', o);
    updateLabels();
  }

  [speed, scale, yfrom, blur, stagger].forEach((s) => s.addEventListener('input', onInput));
  if (particles) particles.addEventListener('change', onInput);

  // 把滑桿重置為「當前 preset 的 base」並清空覆蓋
  function syncToPreset(broadcast) {
    const b = baseAnim();
    speed.value = 1;
    scale.value = b.wordActive.scale;
    yfrom.value = b.lineEnter.yFrom;
    blur.value = b.lineEnter.blurFrom;
    stagger.value = b.lineEnter.stagger;
    if (particles) particles.checked = true; // 預設粒子開
    updateLabels();
    StylePresets.setOverrides({});
    if (broadcast) SocketClient.send('style:override', {});
  }

  // 依伺服器推來的 overrides 反推滑桿位置（不再廣播）
  function adoptOverrides(o) {
    // 反推粒子開關：overrides 帶 effects 且不含 'particle' → 關
    if (particles) particles.checked = !(o && Array.isArray(o.effects) && !o.effects.includes('particle'));
    if (!o || !o.animation || (!o.animation.lineEnter && !o.animation.wordActive)) {
      // 沒有動畫覆寫但可能只有 effects 覆寫（純粒子開關）→ 仍套用
      if (o && o.effects) StylePresets.setOverrides(o);
      else syncToPreset(false);
      return;
    }
    const b = baseAnim();
    const le = o.animation.lineEnter || {};
    const wa = o.animation.wordActive || {};
    if (typeof le.duration === 'number' && le.duration > 0) {
      speed.value = Math.max(0.5, Math.min(2, b.lineEnter.duration / le.duration));
    }
    if (typeof wa.scale === 'number') scale.value = wa.scale;
    if (typeof le.yFrom === 'number') yfrom.value = le.yFrom;
    if (typeof le.blurFrom === 'number') blur.value = le.blurFrom;
    if (typeof le.stagger === 'number') stagger.value = le.stagger;
    updateLabels();
    StylePresets.setOverrides(o);
  }

  const resetBtn = el('st-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => syncToPreset(true));

  // 切換風格（自己或別的控制端）→ 重置微調到新 preset base
  SocketClient.on('style:change', () => setTimeout(() => syncToPreset(false), 0));
  // 伺服器回推覆蓋（持久化還原 / 多端同步）
  SocketClient.on('style:override', (o) => adoptOverrides(o));
  // 初次狀態同步：採用伺服器已保存的微調
  SocketClient.on('state:sync', (state) => {
    if (state && state.styleOverrides) adoptOverrides(state.styleOverrides);
  });

  // 初始標籤
  updateLabels();
})();
