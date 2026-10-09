/**
 * 限時節慶募資活動面板（中秋、萬聖節）：手動輸入斗內、設定目標、預覽疊加層。
 * 真實資料在 server 端（server/services/seasonal-event.js），這裡只顯示 <prefix>:update 的結果。
 *
 * 每個活動一個分頁（.view[data-view=<prefix>]），元素 id 都以 <prefix>- 開頭，翻譯鍵以
 * <prefix>. 開頭；門檻輸入、網址與複製按鈕用 data-tier／data-overlay-url／data-overlay-copy，
 * 只在自己的分頁裡找。
 */
(function () {
  'use strict';

  const locale = () => (window.I18n ? window.I18n.current() : 'zh-TW');
  const nf = { format: (n) => new Intl.NumberFormat(locale()).format(n) };
  const toast = (message, type) => window.AppShared?.showToast?.(message, type);
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);

  function createPanel({ prefix, scaleFields }) {
    const el = (suffix) => document.getElementById(`${prefix}-${suffix}`);
    const view = () => document.querySelector(`.view[data-view="${prefix}"]`);
    const inView = (selector) => [...(view()?.querySelectorAll(selector) || [])];
    const styleLabel = (style) => t(`${prefix}.style.${style}`);
    const overlayUrl = (suffix) => `${location.origin}/${prefix}${suffix || ''}`;
    let state = null;
    let configDirty = false;
    let scaleTimer = 0;
    let scaleDragging = false;

    function renderSummary() {
      const goal = Math.max(state.goal || 1, 1);
      const percent = Math.min(Math.round((state.total / goal) * 100), 999);
      el('summary-total').textContent = `NT$${nf.format(state.total)}`;
      el('summary-goal').textContent = `/ NT$${nf.format(goal)}`;
      el('summary-percent').textContent = `${percent}%`;
      el('summary-fill').style.width = `${Math.min(percent, 100)}%`;
    }

    function renderEndNotice() {
      const end = new Date(state.endsAt);
      const box = el('end-notice');
      if (!Number.isFinite(end.getTime())) { box.replaceChildren(); return; }
      const date = end.toLocaleString(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const [before, after = ''] = t(`${prefix}.endNotice`).split('{date}');
      const strong = document.createElement('strong');
      strong.textContent = date;
      box.replaceChildren(before, strong, after);
    }

    function renderScales() {
      for (const [suffix, key] of scaleFields) {
        const percent = Math.round((Number(state[key]) || 1) * 100);
        if (!scaleDragging) el(suffix).value = percent;
        el(`${suffix}-val`).textContent = `${scaleDragging ? el(suffix).value : percent}%`;
      }
    }

    function renderConfig() {
      if (configDirty) return;
      el('config-title-input').value = state.title;
      el('config-done-text').value = state.doneText;
      el('config-goal').value = state.goal;
      el('config-base').value = state.base;
      inView('[data-tier]').forEach((input) => {
        input.value = state.tiers?.[input.dataset.tier] ?? '';
      });
    }

    // 活動是否結束由伺服器啟動時決定；結束後這次執行期間分頁不出現，進行中也不會中途消失。
    function setAvailable(active) {
      const nav = document.querySelector(`.nav-item[data-nav="${prefix}"]`);
      const viewNode = view();
      if (!nav || !viewNode) return;
      nav.hidden = !active;
      viewNode.hidden = !active;
      if (!active && (nav.classList.contains('active') || viewNode.classList.contains('is-active'))) {
        document.querySelector('.nav-item[data-nav="karaoke"]')?.click();
      }
    }

    function renderList() {
      const list = el('donation-list');
      const items = state.donations.slice().reverse();
      if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'bgm-track-empty';
        empty.textContent = t(`${prefix}.empty`);
        list.replaceChildren(empty);
        return;
      }
      list.replaceChildren(...items.map((d) => {
        const li = document.createElement('li');
        li.className = 'bgm-track-item';
        const label = document.createElement('span');
        label.className = 'bgm-track-title';
        label.textContent = d.name;
        const meta = document.createElement('span');
        meta.className = 'seasonal-donation-meta';
        const amount = document.createElement('span');
        amount.textContent = `NT$${nf.format(d.amount)}`;
        const style = document.createElement('span');
        style.className = 'seasonal-style-chip';
        style.dataset.style = d.style;
        style.textContent = styleLabel(d.style);
        style.title = d.styleAuto ? t(`${prefix}.styleAuto`) : t(`${prefix}.styleManual`);
        const time = document.createElement('span');
        time.className = 'sub';
        time.textContent = new Date(d.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-sm btn-ghost';
        remove.textContent = t('common.delete');
        remove.addEventListener('click', () => removeDonation(d));
        meta.append(style, amount, time, remove);
        li.append(label, meta);
        return li;
      }));
    }

    function apply(next) {
      if (!next) return;
      state = next;
      renderSummary();
      renderEndNotice();
      renderScales();
      renderConfig();
      renderList();
    }

    function send(event, data, onOk) {
      SocketClient.sendWithCallback(`${prefix}:${event}`, data, (result) => {
        if (!result) return;
        if (!result.ok) { toast(t(result.inactive ? `${prefix}.toast.ended` : `${prefix}.toast.failed`), 'error'); return; }
        apply(result.state);
        onOk?.();
      });
    }

    function removeDonation(d) {
      window.DangerConfirm.request({
        requirePhrase: false,
        tone: 'neutral',
        title: t(`${prefix}.confirmDelete.title`),
        summary: `${d.name}　NT$${nf.format(d.amount)}`,
        impact: t(`${prefix}.confirmDelete.impact`),
        confirmLabel: t('common.delete'),
      }).then((ok) => { if (ok) send('remove', { id: d.id }); });
    }

    function fitPreview() {
      const frame = view()?.querySelector('.seasonal-preview-frame');
      const iframe = el('preview-iframe');
      if (!frame || !iframe) return;
      iframe.style.transform = `scale(${frame.clientWidth / 1920})`;
    }

    function wireUi() {
      el('add-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const name = el('add-name').value.trim();
        const amount = Number(el('add-amount').value);
        if (!name || !(amount > 0)) { toast(t(`${prefix}.toast.invalid`), 'error'); return; }
        send('donate', { name, amount, style: el('add-style').value || undefined }, () => {
          el('add-name').value = '';
          el('add-amount').value = '';
          el('add-style').value = '';
          el('add-name').focus();
        });
      });

      const configForm = el('config-form');
      configForm.addEventListener('input', () => { configDirty = true; });
      configForm.addEventListener('submit', (event) => {
        event.preventDefault();
        configDirty = false;
        send('config', {
          title: el('config-title-input').value,
          doneText: el('config-done-text').value,
          goal: Number(el('config-goal').value),
          base: Number(el('config-base').value),
          tiers: Object.fromEntries(inView('[data-tier]').map((input) => [input.dataset.tier, Number(input.value)])),
        }, () => toast(t(`${prefix}.toast.saved`), 'success'));
      });

      // 大小滑桿即時生效，不經過「儲存設定」；只送這個鍵，其他設定維持伺服器上的值。
      for (const [suffix, key] of scaleFields) {
        const input = el(suffix);
        input.addEventListener('input', () => {
          scaleDragging = true;
          el(`${suffix}-val`).textContent = `${input.value}%`;
          clearTimeout(scaleTimer);
          scaleTimer = setTimeout(() => send('config', { [key]: Number(input.value) / 100 }), 120);
        });
        input.addEventListener('change', () => { scaleDragging = false; });
      }

      el('clear').addEventListener('click', () => {
        window.DangerConfirm.request({
          title: t(`${prefix}.confirmClear.title`),
          summary: t(`${prefix}.confirmClear.summary`),
          impact: t(`${prefix}.confirmClear.impact`),
          phrase: t(`${prefix}.confirmClear.phrase`),
        }).then((ok) => { if (ok) send('clear'); });
      });

      inView('[data-overlay-url]').forEach((node) => {
        node.textContent = overlayUrl(node.dataset.overlayUrl);
      });
      inView('[data-overlay-copy]').forEach((button) => {
        button.addEventListener('click', () => {
          navigator.clipboard.writeText(overlayUrl(button.dataset.overlayCopy))
            .then(() => toast(t(`${prefix}.toast.copied`), 'success'))
            .catch(() => toast(t(`${prefix}.toast.copyFailed`), 'error'));
        });
      });

      // 父層 color-scheme 不會傳進 iframe；兩邊不一致時 iframe 會畫出白色畫布蓋掉預覽底色。
      const iframe = el('preview-iframe');
      iframe.addEventListener('load', () => {
        const doc = iframe.contentDocument;
        if (doc) doc.documentElement.style.colorScheme = getComputedStyle(document.documentElement).colorScheme || 'normal';
      });
      iframe.src = `/${prefix}`;
      el('preview-mode').addEventListener('change', (event) => {
        iframe.src = `/${prefix}${event.target.value}`;
      });
      el('play-celebrate').addEventListener('click', () => {
        SocketClient.sendWithCallback(`${prefix}:celebrate`, null, (result) => {
          if (result?.ok) toast(t(`${prefix}.toast.celebrate`), 'success');
        });
      });
      el('play-credits').addEventListener('click', () => {
        SocketClient.sendWithCallback(`${prefix}:credits`, null, (result) => {
          if (result?.ok) toast(t(`${prefix}.toast.credits`), 'success');
        });
      });
      const frame = view()?.querySelector('.seasonal-preview-frame');
      if (frame && 'ResizeObserver' in window) new ResizeObserver(fitPreview).observe(frame);
    }

    SocketClient.on(`${prefix}:update`, apply);
    window.addEventListener('i18n:change', () => { if (state) apply(state); });
    SocketClient.on('connection-change', (connected) => {
      if (!connected) return;
      SocketClient.sendWithCallback(`${prefix}:get`, null, (result) => {
        if (result?.inactive) { setAvailable(false); return; }
        if (!result?.ok) return;
        setAvailable(true);
        apply(result.state);
      });
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi);
    else wireUi();
  }

  createPanel({ prefix: 'moon', scaleFields: [['lantern-scale', 'lanternScale'], ['moon-scale', 'moonScale']] });
  createPanel({ prefix: 'halloween', scaleFields: [['treat-scale', 'treatScale'], ['pumpkin-scale', 'pumpkinScale']] });
})();
