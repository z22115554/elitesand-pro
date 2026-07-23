/**
 * EULA 首次同意閘門（僅桌面控制面板載入）
 *
 * - 伺服器 /api/eula 回報 required=true 才顯示（首次啟動或條款版本變更）
 * - 必須捲動到條款最底部才能勾選同意，勾選後才能按「同意並開始使用」
 * - 同意紀錄由伺服器寫入 data 目錄（伺服器為真實來源，不用 localStorage）
 * - /display、/setlist、/controller 不載入本檔，OBS 來源完全不受影響
 */
(() => {
  'use strict';

  const STYLE = `
    .eula-gate {
      position: fixed; inset: 0; z-index: 12000;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .eula-gate__card {
      display: flex; flex-direction: column;
      width: min(720px, 100%); height: min(82vh, 760px);
      background: var(--bg-base, #121317);
      border: 1px solid var(--border-strong, rgba(255,255,255,0.18));
      border-radius: var(--r-lg, 14px);
      box-shadow: var(--shadow-lg, 0 24px 70px rgba(0,0,0,0.45));
      overflow: hidden;
    }
    .eula-gate__head { padding: 20px 24px 14px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.12)); }
    .eula-gate__title { margin: 0; font-size: 16px; font-weight: 700; color: var(--text, #f2f3f5); }
    .eula-gate__sub { margin: 6px 0 0; font-size: 12.5px; color: var(--text-dim, rgba(255,255,255,0.62)); }
    .eula-gate__text {
      flex: 1; min-height: 0; overflow-y: auto;
      margin: 0; padding: 18px 24px;
      font-size: 12.5px; line-height: 1.75;
      white-space: pre-wrap; word-break: break-word;
      color: var(--text-dim, rgba(255,255,255,0.62));
      background: var(--bg-surface, rgba(255,255,255,0.05));
    }
    .eula-gate__foot { padding: 14px 24px 18px; border-top: 1px solid var(--border, rgba(255,255,255,0.12)); }
    .eula-gate__check {
      display: flex; align-items: flex-start; gap: 9px;
      font-size: 13px; color: var(--text, #f2f3f5); cursor: pointer;
    }
    .eula-gate__check input { margin-top: 2px; accent-color: var(--accent, #7c6cff); }
    .eula-gate__check input:disabled { cursor: not-allowed; }
    .eula-gate--locked .eula-gate__check { color: var(--text-faint, rgba(255,255,255,0.38)); cursor: not-allowed; }
    .eula-gate__hint { margin: 8px 0 0; font-size: 12px; color: var(--text-faint, rgba(255,255,255,0.38)); }
    .eula-gate__hint--error { color: var(--danger, #fb7185); }
    .eula-gate__actions { display: flex; justify-content: flex-end; margin-top: 12px; }
    .eula-gate__accept {
      padding: 8px 20px; border: none; border-radius: var(--r-sm, 6px);
      font: inherit; font-size: 13px; font-weight: 700;
      background: var(--accent, #7c6cff); color: var(--accent-text, #fff);
      cursor: pointer; transition: background 0.15s ease, opacity 0.15s ease;
    }
    .eula-gate__accept:hover:not(:disabled) { background: var(--accent-hover, #9d8bff); }
    .eula-gate__accept:disabled { opacity: 0.35; cursor: not-allowed; }
  `;

  function show(status) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'eula-gate eula-gate--locked';
    overlay.innerHTML = `
      <div class="eula-gate__card" role="dialog" aria-modal="true" aria-labelledby="eulaGateTitle">
        <div class="eula-gate__head">
          <h2 class="eula-gate__title" id="eulaGateTitle">使用前請先閱讀授權條款</h2>
          <p class="eula-gate__sub">Elitesand Pro 最終使用者授權暨免責聲明（EULA）v${status.version} — 請完整捲動至最底部後勾選同意</p>
        </div>
        <pre class="eula-gate__text" tabindex="0"></pre>
        <div class="eula-gate__foot">
          <label class="eula-gate__check">
            <input type="checkbox" disabled>
            <span>我已完整閱讀並同意上述最終使用者授權暨免責聲明（EULA）與隨附的 LICENSE 授權條款</span>
          </label>
          <p class="eula-gate__hint">請先將條款捲動到最底部，才能勾選同意。</p>
          <div class="eula-gate__actions">
            <button type="button" class="eula-gate__accept" disabled>同意並開始使用</button>
          </div>
        </div>
      </div>
    `;
    overlay.querySelector('.eula-gate__text').textContent = status.text;
    document.body.appendChild(overlay);

    const textBox = overlay.querySelector('.eula-gate__text');
    const checkbox = overlay.querySelector('input[type="checkbox"]');
    const hint = overlay.querySelector('.eula-gate__hint');
    const acceptBtn = overlay.querySelector('.eula-gate__accept');

    const atBottom = () => textBox.scrollTop + textBox.clientHeight >= textBox.scrollHeight - 16;
    const unlockIfScrolled = () => {
      if (checkbox.disabled && atBottom()) {
        checkbox.disabled = false;
        overlay.classList.remove('eula-gate--locked');
        hint.textContent = '已捲動到最底部，可勾選同意。';
      }
    };
    textBox.addEventListener('scroll', unlockIfScrolled, { passive: true });
    window.addEventListener('resize', unlockIfScrolled);
    unlockIfScrolled(); // 極端情況：視窗夠高、內容不需捲動

    checkbox.addEventListener('change', () => { acceptBtn.disabled = !checkbox.checked; });

    acceptBtn.addEventListener('click', async () => {
      acceptBtn.disabled = true;
      try {
        const res = await fetch('/api/eula/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: status.version }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error((body && body.error) || `HTTP ${res.status}`);
        }
        window.removeEventListener('resize', unlockIfScrolled);
        overlay.remove();
        style.remove();
      } catch (err) {
        acceptBtn.disabled = false;
        hint.textContent = `同意紀錄儲存失敗：${err.message}`;
        hint.classList.add('eula-gate__hint--error');
      }
    });
  }

  async function init() {
    let status;
    try {
      const res = await fetch('/api/eula');
      if (!res.ok) return;
      status = await res.json();
    } catch {
      return; // 查詢失敗不鎖面板；下次載入會再檢查
    }
    if (!status || !status.required || !status.text || !status.version) return;
    show(status);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
