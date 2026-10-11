/**
 * 萬聖節「魔女的大鍋」面板（設計：docs/HALLOWEEN-CAULDRON.md）。
 *
 * 直播中分頁的「魔女的大鍋」卡：材料怎麼來（頻道點數＋斗內／純斗內）、各材料比例、熬煮。
 * 活動設定分頁的「藥水菜單」卡：每種材料的藥水與企劃、頻道點數兌換設定。
 * 比例來自 halloween:update 的 cauldron 欄位（伺服器算好）；設定與熬煮狀態來自 halloween:cauldron:*。
 * 斗內本身（新增、改材料、刪除）仍由 app-seasonal-event.js 處理。
 */
(function () {
  'use strict';

  const INGREDIENTS = ['candy', 'ghost', 'bat', 'pumpkin', 'witch'];
  const t = (key, vars) => (window.I18n ? window.I18n.t(key, vars) : key);
  const toast = (message, type) => window.AppShared?.showToast?.(message, type);
  const locale = () => (window.I18n ? window.I18n.current() : 'zh-TW');
  const nf = (n) => new Intl.NumberFormat(locale()).format(n);
  const el = (suffix) => document.getElementById(`halloween-${suffix}`);

  let control = null;   // halloween:cauldron:* 的狀態（設定、兌換項目、熬煮）
  let event = null;     // halloween:update 的快照（比例）
  let formDirty = false;

  function send(name, data, onOk) {
    SocketClient.sendWithCallback(`halloween:cauldron:${name}`, data, (result) => {
      if (!result) return;
      if (result.state) applyControl(result.state);
      if (!result.ok) { toast(result.error || t('halloween.toast.failed'), 'error'); return; }
      if (result.syncError) toast(t('halloween.cauldron.rewardsError', { error: result.syncError }), 'error');
      onOk?.(result);
    });
  }

  function potionName(key) {
    return control?.settings?.potions?.[key]?.name || event?.cauldron?.potions?.[key]?.name || t(`halloween.style.${key}`);
  }

  function renderMode() {
    const mode = control?.settings?.mode || event?.cauldron?.mode || 'points';
    document.querySelectorAll('[data-view="halloween"] [data-mode]').forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    el('cauldron-mode-hint').textContent = mode === 'points'
      ? t('halloween.cauldron.modeHintPoints', { per: control?.settings?.donationPerShare ?? 10 })
      : t('halloween.cauldron.modeHintDonation');

    const status = el('cauldron-reward-status');
    status.replaceChildren();
    const rs = control?.rewardStatus;
    if (!control || (mode !== 'points' && !control.rewards.some((r) => r.created))) return;
    if (rs?.ok === false) {
      status.classList.add('is-error');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-sm btn-ghost';
      retry.textContent = t('halloween.cauldron.sync');
      retry.addEventListener('click', () => send('sync'));
      status.append(t('halloween.cauldron.rewardsError', { error: rs.error }), ' ', retry);
      return;
    }
    status.classList.remove('is-error');
    // 點數模式但 Twitch 上還沒有兌換項目（剛開活動、或還沒連 Twitch）：主播要知道「還沒在運作」。
    if (mode === 'points' && !control.rewards.some((r) => r.created)) {
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'btn btn-sm btn-ghost';
      create.textContent = t('halloween.cauldron.createRewards');
      create.addEventListener('click', () => send('sync'));
      status.append(t('halloween.cauldron.rewardsNone'), ' ', create);
      return;
    }
    const live = mode === 'points' && !control.brew;
    const count = INGREDIENTS.filter((key) => control.settings.potions[key].enabled).length;
    if (rs?.ok) status.textContent = live ? t('halloween.cauldron.rewardsLive', { count }) : t('halloween.cauldron.rewardsPaused');
  }

  function renderShares() {
    const cauldron = event?.cauldron;
    const list = el('cauldron-shares');
    if (!cauldron) { list.replaceChildren(); return; }
    const anyVotes = INGREDIENTS.some((key) => cauldron.shares[key] > 0);
    if (!anyVotes) {
      const empty = document.createElement('li');
      empty.className = 'cauldron-share-empty sub';
      empty.textContent = t('halloween.cauldron.empty');
      list.replaceChildren(empty);
    } else {
      list.replaceChildren(...INGREDIENTS.slice().sort((a, b) => cauldron.shares[b] - cauldron.shares[a]).map((key) => {
        const li = document.createElement('li');
        li.className = 'cauldron-share-row';
        li.classList.toggle('is-off', !cauldron.potions[key]?.enabled);
        const dot = document.createElement('span');
        dot.className = 'potion-dot';
        dot.dataset.ingredient = key;
        const name = document.createElement('span');
        name.className = 'cauldron-share-name';
        name.textContent = `${t(`halloween.style.${key}`)}・${potionName(key)}`;
        const bar = document.createElement('span');
        bar.className = 'cauldron-share-bar';
        const fill = document.createElement('span');
        fill.dataset.ingredient = key;
        fill.style.width = `${Math.round(cauldron.shares[key] * 100)}%`;
        bar.append(fill);
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = t('halloween.cauldron.shareRow', { share: Math.round(cauldron.shares[key] * 100), amount: nf(Math.round(cauldron.amounts?.[key] || 0)) });
        li.append(dot, name, bar, val);
        return li;
      }));
    }
    el('cauldron-totals').textContent = t(cauldron.mode === 'points' ? 'halloween.cauldron.totals' : 'halloween.cauldron.totalsDonation', {
      total: nf(cauldron.totalShares || 0), plain: nf(cauldron.plainShares || 0), voters: nf(cauldron.voters || 0),
    });

    const brew = cauldron.brew;
    const brewed = el('cauldron-brewed');
    brewed.hidden = !brew;
    if (brew) {
      const names = (brew.tie || [brew.winner]).map(potionName).join(' × ');
      brewed.textContent = t('halloween.cauldron.brewed', { potion: brew.reachedGoal ? `${t('halloween.cauldron.bonus')} ${names}` : names });
    }
    const brewBtn = el('cauldron-brew');
    brewBtn.hidden = !!brew;
    brewBtn.disabled = !anyVotes;
    brewBtn.title = anyVotes ? '' : t('halloween.cauldron.empty');
    const potionBtn = el('cauldron-potion');
    potionBtn.hidden = !brew;
    potionBtn.textContent = t(brew?.hidden ? 'halloween.cauldron.showPotion' : 'halloween.cauldron.hidePotion');
    el('cauldron-reset').hidden = !brew;
  }

  function renderForm() {
    if (formDirty || !control) return;
    const s = control.settings;
    document.querySelectorAll('#halloween-potions-form [data-potion]').forEach((row) => {
      const potion = s.potions[row.dataset.potion];
      row.querySelector('[data-field="enabled"]').checked = potion.enabled;
      row.querySelector('[data-field="name"]').value = potion.name;
      row.querySelector('[data-field="reward"]').value = potion.reward;
      row.classList.toggle('is-off', !potion.enabled);
    });
    el('potions-bonus').value = s.bonusReward;
    el('potions-cost').value = s.rewardCost;
    el('potions-max').value = s.maxPerStream;
    el('potions-cooldown').value = s.cooldownSeconds;
    el('potions-per-share').value = s.donationPerShare;
    el('potions-goal').value = s.goalShares;
  }

  function applyControl(next) {
    if (!next) return;
    control = next;
    renderMode();
    renderForm();
    renderShares();
  }

  function applyEvent(next) {
    if (!next) return;
    event = next;
    renderMode();
    renderShares();
  }

  function askFirst(options) {
    return window.DangerConfirm.request({ requirePhrase: false, tone: 'neutral', ...options });
  }

  function wireUi() {
    document.querySelectorAll('[data-view="halloween"] [data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (control?.settings?.mode === btn.dataset.mode) return;
        send('settings', { mode: btn.dataset.mode }, () => toast(t('halloween.cauldron.toast.saved'), 'success'));
      });
    });

    el('cauldron-brew').addEventListener('click', () => {
      askFirst({
        title: t('halloween.cauldron.brewConfirmTitle'),
        summary: t('halloween.cauldron.brewConfirmSummary'),
        impact: t('halloween.cauldron.brewConfirmImpact'),
        confirmLabel: t('halloween.cauldron.brew'),
      }).then((ok) => { if (ok) send('brew', null, () => toast(t('halloween.cauldron.toast.brewing'), 'success')); });
    });
    el('cauldron-potion').addEventListener('click', () => {
      send('potion', { hidden: !event?.cauldron?.brew?.hidden });
    });
    el('cauldron-reset').addEventListener('click', () => {
      askFirst({
        title: t('halloween.cauldron.resetConfirmTitle'),
        impact: t('halloween.cauldron.resetConfirmImpact'),
        confirmLabel: t('halloween.cauldron.reset'),
      }).then((ok) => { if (ok) send('reset'); });
    });

    const form = el('potions-form');
    form.addEventListener('input', () => { formDirty = true; });
    form.addEventListener('change', (e) => {
      const row = e.target.closest('[data-potion]');
      if (row && e.target.dataset.field === 'enabled') row.classList.toggle('is-off', !e.target.checked);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      formDirty = false;
      const potions = {};
      form.querySelectorAll('[data-potion]').forEach((row) => {
        potions[row.dataset.potion] = {
          enabled: row.querySelector('[data-field="enabled"]').checked,
          name: row.querySelector('[data-field="name"]').value,
          reward: row.querySelector('[data-field="reward"]').value,
        };
      });
      send('settings', {
        potions,
        bonusReward: el('potions-bonus').value,
        rewardCost: Number(el('potions-cost').value),
        maxPerStream: Number(el('potions-max').value),
        cooldownSeconds: Number(el('potions-cooldown').value),
        donationPerShare: Number(el('potions-per-share').value),
        goalShares: Number(el('potions-goal').value),
      }, () => toast(t('halloween.cauldron.toast.saved'), 'success'));
    });
    el('potions-clear-votes').addEventListener('click', () => {
      askFirst({
        title: t('halloween.potions.clearVotesTitle'),
        impact: t('halloween.potions.clearVotesImpact'),
        confirmLabel: t('halloween.potions.clearVotes'),
      }).then((ok) => { if (ok) send('clear-votes'); });
    });
    el('potions-remove-rewards').addEventListener('click', () => {
      askFirst({
        title: t('halloween.potions.removeRewardsTitle'),
        impact: t('halloween.potions.removeRewardsImpact'),
        confirmLabel: t('common.delete'),
      }).then((ok) => { if (ok) send('remove-rewards'); });
    });
  }

  SocketClient.on('halloween:update', applyEvent);
  SocketClient.on('halloween:cauldron:update', applyControl);
  window.addEventListener('i18n:change', () => { if (control) applyControl(control); if (event) applyEvent(event); });
  SocketClient.on('connection-change', (connected) => {
    if (!connected) return;
    SocketClient.sendWithCallback('halloween:cauldron:get', null, (result) => { if (result?.ok) applyControl(result.state); });
    SocketClient.sendWithCallback('halloween:get', null, (result) => { if (result?.ok) applyEvent(result.state); });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi);
  else wireUi();
})();
