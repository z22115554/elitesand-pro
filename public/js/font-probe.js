/*
 * 字型解析探針（診斷用，heuristic）。
 *
 * 集合字型（.ttc）不再以 FontFace binary 遞送，改靠系統字型「名稱解析」。名稱解析
 * 失敗時沒有任何錯誤訊號——畫面會靜默用備援字，使用者只能用眼睛發現。這個模組用
 * FontFaceObserver 的經典手法補上一個「可能沒解析到」的提示：
 *
 *   對每個 generic（serif / sans-serif / monospace）各測一組：
 *     measure(`候選字型堆疊, <generic>`)  vs  measure(`<generic>`)
 *   - 任一組有明顯差異 → 至少有候選字型成功介入 → resolved
 *   - 三組全部與各自 baseline 一致 → 候選字型全都沒解析到（塌回 generic）→ 未解析
 *
 * 微軟正黑體即使剛好等於 Windows 的 sans-serif，對 serif / monospace 仍會有差，不會誤報。
 * 不存在的字型三組都會塌回 generic，判定未解析。
 *
 * 重要：這只是提示，**不參與任何字型載入決策**（不因它決定要不要請 blob）。
 */
(function initElitesandFontProbe() {
  'use strict';

  const GENERICS = ['serif', 'sans-serif', 'monospace'];
  // 高頻漢字：幾乎每個 CJK 字型都有，避免生僻字缺 glyph 造成額外 fallback 干擾探針。
  const PROBE_TEXT = '永東國語愛萬水心';
  const PROBE_PX = 96;
  const DIFF_PX = 1.0;    // 寬度／bounding box：差 > 1px 視為不同
  const DIFF_INK = 0.02;  // canvas alpha ink count：相對差 > 2% 視為不同

  const GENERIC_NAMES = new Set([
    'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif',
    'ui-serif', 'ui-monospace', 'cursive', 'fantasy', 'math', 'emoji',
  ]);

  // 去掉尾端的 generic / Noto fallback，只留真正的候選家族名。
  function candidateNames(names) {
    const list = Array.isArray(names) ? names : [names];
    return list
      .map((n) => String(n || '').trim().replace(/^['"]|['"]$/g, '').trim())
      .filter((bare) => {
        if (!bare) return false;
        if (GENERIC_NAMES.has(bare.toLowerCase())) return false;
        if (/^noto\s/i.test(bare)) return false;
        return true;
      });
  }

  function quote(name) {
    return /[,'"]/.test(name) ? name : `'${name}'`;
  }

  function measure(ctx, family) {
    const font = `${PROBE_PX}px ${family}`;
    ctx.font = font;
    const m = ctx.measureText(PROBE_TEXT);
    const width = m.width;
    const bbox = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0)
      + (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0);
    const w = Math.max(1, Math.min(ctx.canvas.width, Math.ceil(width) + 12));
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, ctx.canvas.width, h);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.font = font;
    ctx.fillText(PROBE_TEXT, 4, 4);
    const data = ctx.getImageData(0, 0, w, h).data;
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 16) ink += 1;
    return { width, bbox, ink };
  }

  function differs(a, b) {
    if (Math.abs(a.width - b.width) > DIFF_PX) return true;
    if (Math.abs(a.bbox - b.bbox) > DIFF_PX) return true;
    const denom = Math.max(a.ink, b.ink, 1);
    if (Math.abs(a.ink - b.ink) / denom > DIFF_INK) return true;
    return false;
  }

  /**
   * @param {string[]|string} names 候選家族名（可帶引號；會自動去掉 generic/Noto 尾巴）
   * @returns {Promise<{resolved:boolean, reason?:string, stack?:string, groups?:Array}>}
   *   resolved:false 代表「探不到任何候選字型介入」——提示用，非確定。
   */
  async function check(names) {
    const cands = candidateNames(names);
    if (!cands.length) return { resolved: false, reason: 'no-candidates' };

    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) { /* ignore */ }
    await new Promise((r) => requestAnimationFrame(() => r()));

    let ctx;
    try {
      const cv = document.createElement('canvas');
      cv.width = 1400;
      cv.height = PROBE_PX * 2;
      ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { reason: 'no-2d-context', resolved: true };
    } catch (_) {
      return { reason: 'canvas-unavailable', resolved: true };
    }

    const stack = cands.map(quote).join(', ');
    const groups = GENERICS.map((g) => {
      const base = measure(ctx, g);
      const test = measure(ctx, `${stack}, ${g}`);
      return { generic: g, differs: differs(base, test) };
    });
    return { resolved: groups.some((x) => x.differs), stack, groups };
  }

  window.ElitesandFontProbe = { check, candidateNames };
})();
