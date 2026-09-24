/**
 * 中秋募資活動面板：手動輸入斗內、設定目標、預覽 /moon 疊加層。
 * 真實資料在 server 端（server/services/moon-event.js），這裡只顯示 moon:update 的結果。
 */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat('zh-TW');
  const toast = (message, type) => window.AppShared?.showToast?.(message, type);
  let state = null;
  let configDirty = false;
  let receivedAt = 0;
  let statusTimer = 0;

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

  function renderConfig() {
    if (configDirty) return;
    el('moon-config-title-input').value = state.title;
    el('moon-config-done-text').value = state.doneText;
    el('moon-config-goal').value = state.goal;
    el('moon-config-base').value = state.base;
    el('moon-schedule-enabled').checked = !!(state.startAt && state.endAt);
    el('moon-schedule-start').value = toLocalInput(state.startAt);
    el('moon-schedule-end').value = toLocalInput(state.endAt);
    syncScheduleInputs();
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function syncScheduleInputs() {
    const enabled = el('moon-schedule-enabled').checked;
    for (const id of ['moon-schedule-start', 'moon-schedule-end']) {
      el(id).disabled = !enabled;
      el(id).required = enabled;
    }
  }

  function syncFeatureAvailability(now) {
    const end = state.endAt ? Date.parse(state.endAt) : null;
    const expired = state.expired === true || (Number.isFinite(end) && now >= end);
    const nav = document.querySelector('.nav-item[data-nav="moon"]');
    const view = document.querySelector('.view[data-view="moon"]');
    if (!nav || !view) return;
    nav.hidden = expired;
    view.hidden = expired;
    if (expired && (nav.classList.contains('active') || view.classList.contains('is-active'))) {
      document.querySelector('.nav-item[data-nav="karaoke"]')?.click();
    }
  }

  function renderScheduleStatus() {
    clearTimeout(statusTimer);
    if (!state) return;
    const status = el('moon-schedule-status');
    const start = state.startAt ? Date.parse(state.startAt) : null;
    const end = state.endAt ? Date.parse(state.endAt) : null;
    const now = (Number.isFinite(state.serverNow) ? state.serverNow : Date.now()) + performance.now() - receivedAt;
    syncFeatureAvailability(now);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      status.textContent = '目前不限時，OBS 持續顯示。';
      return;
    }
    let next;
    if (now < start) {
      status.textContent = `尚未開始，將於 ${new Date(start).toLocaleString('zh-TW')} 自動顯示。`;
      next = start;
    } else if (now < end) {
      status.textContent = `活動進行中，將於 ${new Date(end).toLocaleString('zh-TW')} 自動隱藏。`;
      next = end;
    } else {
      status.textContent = '活動已結束，OBS 已自動隱藏；斗內紀錄仍保留。';
    }
    if (next) statusTimer = setTimeout(renderScheduleStatus, Math.max(1, Math.min(next - now + 20, 60000)));
  }

  function renderList() {
    const list = el('moon-donation-list');
    const items = state.donations.slice().reverse();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'bgm-track-empty';
      empty.textContent = '還沒有斗內紀錄';
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
      const time = document.createElement('span');
      time.className = 'sub';
      time.textContent = new Date(d.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-sm btn-ghost';
      remove.textContent = '刪除';
      remove.addEventListener('click', () => removeDonation(d));
      meta.append(amount, time, remove);
      li.append(label, meta);
      return li;
    }));
  }

  function apply(next) {
    if (!next) return;
    state = next;
    receivedAt = performance.now();
    renderSummary();
    renderConfig();
    renderScheduleStatus();
    renderList();
  }

  function send(event, data, onOk) {
    SocketClient.sendWithCallback(event, data, (result) => {
      if (!result) return;
      if (!result.ok) { toast(result.error || '操作失敗', 'error'); return; }
      apply(result.state);
      onOk?.();
    });
  }

  function removeDonation(d) {
    window.DangerConfirm.request({
      requirePhrase: false,
      tone: 'neutral',
      title: '刪除這筆斗內？',
      summary: `${d.name}　NT$${nf.format(d.amount)}`,
      impact: '燈籠會從 OBS 畫面拿掉，月亮進度也會扣回去。',
      confirmLabel: '刪除',
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
      if (!name || !(amount > 0)) { toast('請填寫名字與大於 0 的金額', 'error'); return; }
      send('moon:donate', { name, amount }, () => {
        el('moon-add-name').value = '';
        el('moon-add-amount').value = '';
        el('moon-add-name').focus();
      });
    });

    const configForm = el('moon-config-form');
    configForm.addEventListener('input', () => { configDirty = true; syncScheduleInputs(); });
    configForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const scheduled = el('moon-schedule-enabled').checked;
      const start = scheduled ? new Date(el('moon-schedule-start').value) : null;
      const end = scheduled ? new Date(el('moon-schedule-end').value) : null;
      if (scheduled && (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)) {
        toast('請設定有效的開始與結束時間，結束須晚於開始', 'error');
        return;
      }
      configDirty = false;
      send('moon:config', {
        title: el('moon-config-title-input').value,
        doneText: el('moon-config-done-text').value,
        goal: Number(el('moon-config-goal').value),
        base: Number(el('moon-config-base').value),
        startAt: scheduled ? start.toISOString() : null,
        endAt: scheduled ? end.toISOString() : null,
      }, () => toast('活動設定已儲存', 'success'));
    });

    el('moon-clear').addEventListener('click', () => {
      window.DangerConfirm.request({
        title: '清除全部斗內紀錄？',
        summary: 'OBS 上的燈籠會全部拿掉，月亮回到起始金額。',
        impact: '這個動作無法復原；活動設定（標題、目標、起始金額）會保留。',
        phrase: '清除',
      }).then((ok) => { if (ok) send('moon:clear'); });
    });

    document.querySelectorAll('[data-moon-url]').forEach((node) => {
      node.textContent = moonUrl(node.dataset.moonUrl);
    });
    document.querySelectorAll('[data-moon-copy]').forEach((button) => {
      button.addEventListener('click', () => {
        navigator.clipboard.writeText(moonUrl(button.dataset.moonCopy))
          .then(() => toast('已複製網址', 'success'))
          .catch(() => toast('複製失敗，請手動選取網址', 'error'));
      });
    });

    // 父層 color-scheme 不會傳進 iframe；兩邊不一致時 iframe 會畫出白色畫布蓋掉預覽底色。
    const iframe = el('moon-preview-iframe');
    iframe.addEventListener('load', () => {
      const doc = iframe.contentDocument;
      if (doc) doc.documentElement.style.colorScheme = getComputedStyle(document.documentElement).colorScheme || 'normal';
    });
    iframe.src = '/moon';
    const frame = document.querySelector('.moon-preview-frame');
    if (frame && 'ResizeObserver' in window) new ResizeObserver(fitPreview).observe(frame);
  }

  SocketClient.on('moon:update', apply);
  document.addEventListener('visibilitychange', renderScheduleStatus);
  SocketClient.on('connection-change', (connected) => {
    if (connected) SocketClient.sendWithCallback('moon:get', null, (result) => apply(result?.state));
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi);
  else wireUi();
})();
