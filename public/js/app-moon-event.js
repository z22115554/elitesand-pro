/**
 * 中秋募資活動面板：手動輸入斗內、設定目標、預覽 /moon 疊加層。
 * 真實資料在 server 端（server/services/moon-event.js），這裡只顯示 moon:update 的結果。
 */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const locale = () => (window.I18n ? window.I18n.current() : 'zh-TW');
  const nf = { format: (n) => new Intl.NumberFormat(locale()).format(n) };
  const toast = (message, type) => window.AppShared?.showToast?.(message, type);
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const styleLabel = (style) => t(`moon.style.${style}`);
  let state = null;
  let configDirty = false;

  function moonUrl(suffix) {
    return `${location.origin}/moon${suffix || ''}`;
  }

  function renderSummary() {
    const goal = Math.max(state.goal || 1, 1);
    const percent = Math.min(Math.round((state.total / goal) * 100), 999);
    el('moon-summary-total').textContent = `NT$${nf.format(state.total)}`;
    el('moon-summary-goal').textContent = `/ NT$${nf.format(goal)}`;
    el('moon-summary-percent').textContent = `${percent}%`;
    el('moon-summary-fill').style.width = `${Math.min(percent, 100)}%`;
  }

  function renderEndNotice() {
    const end = new Date(state.endsAt);
    const box = el('moon-end-notice');
    if (!Number.isFinite(end.getTime())) { box.replaceChildren(); return; }
    const date = end.toLocaleString(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const [before, after = ''] = t('moon.endNotice').split('{date}');
    const strong = document.createElement('strong');
    strong.textContent = date;
    box.replaceChildren(before, strong, after);
  }

  function renderConfig() {
    if (configDirty) return;
    el('moon-config-title-input').value = state.title;
    el('moon-config-done-text').value = state.doneText;
    el('moon-config-goal').value = state.goal;
    el('moon-config-base').value = state.base;
    document.querySelectorAll('[data-moon-tier]').forEach((input) => {
      input.value = state.tiers?.[input.dataset.moonTier] ?? '';
    });
  }

  // 活動是否結束由伺服器啟動時決定；結束後這次執行期間分頁不出現，進行中也不會中途消失。
  function setAvailable(active) {
    const nav = document.querySelector('.nav-item[data-nav="moon"]');
    const view = document.querySelector('.view[data-view="moon"]');
    if (!nav || !view) return;
    nav.hidden = !active;
    view.hidden = !active;
    if (!active && (nav.classList.contains('active') || view.classList.contains('is-active'))) {
      document.querySelector('.nav-item[data-nav="karaoke"]')?.click();
    }
  }

  function renderList() {
    const list = el('moon-donation-list');
    const items = state.donations.slice().reverse();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'bgm-track-empty';
      empty.textContent = t('moon.empty');
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
      meta.className = 'moon-donation-meta';
      const amount = document.createElement('span');
      amount.textContent = `NT$${nf.format(d.amount)}`;
      const style = document.createElement('span');
      style.className = 'moon-style-chip';
      style.dataset.style = d.style;
      style.textContent = styleLabel(d.style);
      style.title = d.styleAuto ? t('moon.styleAuto') : t('moon.styleManual');
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
    renderConfig();
    renderList();
  }

  function send(event, data, onOk) {
    SocketClient.sendWithCallback(event, data, (result) => {
      if (!result) return;
      if (!result.ok) { toast(t(result.inactive ? 'moon.toast.ended' : 'moon.toast.failed'), 'error'); return; }
      apply(result.state);
      onOk?.();
    });
  }

  function removeDonation(d) {
    window.DangerConfirm.request({
      requirePhrase: false,
      tone: 'neutral',
      title: t('moon.confirmDelete.title'),
      summary: `${d.name}　NT$${nf.format(d.amount)}`,
      impact: t('moon.confirmDelete.impact'),
      confirmLabel: t('common.delete'),
    }).then((ok) => { if (ok) send('moon:remove', { id: d.id }); });
  }

  function fitPreview() {
    const frame = document.querySelector('.moon-preview-frame');
    const iframe = el('moon-preview-iframe');
    if (!frame || !iframe) return;
    iframe.style.transform = `scale(${frame.clientWidth / 1920})`;
  }

  function wireUi() {
    el('moon-add-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = el('moon-add-name').value.trim();
      const amount = Number(el('moon-add-amount').value);
      if (!name || !(amount > 0)) { toast(t('moon.toast.invalid'), 'error'); return; }
      send('moon:donate', { name, amount, style: el('moon-add-style').value || undefined }, () => {
        el('moon-add-name').value = '';
        el('moon-add-amount').value = '';
        el('moon-add-style').value = '';
        el('moon-add-name').focus();
      });
    });

    const configForm = el('moon-config-form');
    configForm.addEventListener('input', () => { configDirty = true; });
    configForm.addEventListener('submit', (event) => {
      event.preventDefault();
      configDirty = false;
      send('moon:config', {
        title: el('moon-config-title-input').value,
        doneText: el('moon-config-done-text').value,
        goal: Number(el('moon-config-goal').value),
        base: Number(el('moon-config-base').value),
        tiers: Object.fromEntries([...document.querySelectorAll('[data-moon-tier]')]
          .map((input) => [input.dataset.moonTier, Number(input.value)])),
      }, () => toast(t('moon.toast.saved'), 'success'));
    });

    el('moon-clear').addEventListener('click', () => {
      window.DangerConfirm.request({
        title: t('moon.confirmClear.title'),
        summary: t('moon.confirmClear.summary'),
        impact: t('moon.confirmClear.impact'),
        phrase: t('moon.confirmClear.phrase'),
      }).then((ok) => { if (ok) send('moon:clear'); });
    });

    document.querySelectorAll('[data-moon-url]').forEach((node) => {
      node.textContent = moonUrl(node.dataset.moonUrl);
    });
    document.querySelectorAll('[data-moon-copy]').forEach((button) => {
      button.addEventListener('click', () => {
        navigator.clipboard.writeText(moonUrl(button.dataset.moonCopy))
          .then(() => toast(t('moon.toast.copied'), 'success'))
          .catch(() => toast(t('moon.toast.copyFailed'), 'error'));
      });
    });

    // 父層 color-scheme 不會傳進 iframe；兩邊不一致時 iframe 會畫出白色畫布蓋掉預覽底色。
    const iframe = el('moon-preview-iframe');
    iframe.addEventListener('load', () => {
      const doc = iframe.contentDocument;
      if (doc) doc.documentElement.style.colorScheme = getComputedStyle(document.documentElement).colorScheme || 'normal';
    });
    iframe.src = '/moon';
    el('moon-preview-mode').addEventListener('change', (event) => {
      iframe.src = `/moon${event.target.value}`;
    });
    el('moon-play-celebrate').addEventListener('click', () => {
      SocketClient.sendWithCallback('moon:celebrate', null, (result) => {
        if (result?.ok) toast(t('moon.toast.celebrate'), 'success');
      });
    });
    el('moon-play-credits').addEventListener('click', () => {
      SocketClient.sendWithCallback('moon:credits', null, (result) => {
        if (result?.ok) toast(t('moon.toast.credits'), 'success');
      });
    });
    const frame = document.querySelector('.moon-preview-frame');
    if (frame && 'ResizeObserver' in window) new ResizeObserver(fitPreview).observe(frame);
  }

  SocketClient.on('moon:update', apply);
  window.addEventListener('i18n:change', () => { if (state) apply(state); });
  SocketClient.on('connection-change', (connected) => {
    if (!connected) return;
    SocketClient.sendWithCallback('moon:get', null, (result) => {
      if (result?.inactive) { setAvailable(false); return; }
      if (!result?.ok) return;
      setAvailable(true);
      apply(result.state);
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi);
  else wireUi();
})();
