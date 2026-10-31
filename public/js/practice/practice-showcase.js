/** Small public recap shared by the panel and OBS. No history fetching or result animation. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PracticeShowcase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function describe(recap, t) {
    if (!recap || typeof recap !== 'object') return [];
    const rows = [];
    const number = (v) => Number.isFinite(v) && v >= 0 && v <= 100;
    const count = (v) => Number.isInteger(v) && v > 0 && v <= 1000000;
    function add(key, fallback, vars, kind) {
      const translated = typeof t === 'function' ? t(`practice.showcase.${key}`, vars) : '';
      rows.push({ text: translated && translated !== `practice.showcase.${key}` ? translated : fallback, kind: kind || '' });
    }
    if (recap.personalBest === true) add('personalBest', '刷新個人紀錄', {}, 'record');
    if (Number.isFinite(recap.previousDelta) && Math.abs(recap.previousDelta) <= 100) {
      const score = `${recap.previousDelta > 0 ? '+' : ''}${recap.previousDelta.toFixed(1)}`;
      add('previousDelta', `與上次差分 ${score}`, { score });
    }
    if (number(recap.bestScore)) {
      const score = recap.bestScore.toFixed(1);
      add('bestScore', `個人最佳 ${score}`, { score });
    }
    const c = recap.challenge;
    if (c && typeof c === 'object' && number(c.targetScore)) {
      if (c.achieved === true) add('challengeMet', '挑戰達標', {}, 'success');
      if (c.achieved === false) add('challengeMissed', '挑戰未達標', {}, 'missed');
      if (typeof c.requester === 'string' && c.requester) {
        const name = c.requester.slice(0, 80);
        add('requester', `點歌者 ${name}`, { name });
      }
      const score = c.targetScore.toFixed(1);
      add('targetScore', `目標分數 ${score}`, { score });
      if (count(c.rank)) add('rank', `本機挑戰排名 第 ${c.rank} 名`, { rank: c.rank });
      if (count(c.participationCount)) add('participationCount', `參與 ${c.participationCount} 次`, { count: c.participationCount });
    }
    return rows;
  }

  function render(element, recap, t) {
    if (!element) return;
    // Each string, including translations and requester names, is always assigned as text.
    element.textContent = '';
    const rows = describe(recap, t);
    element.hidden = rows.length === 0;
    for (const row of rows) {
      const item = element.ownerDocument.createElement('span');
      item.className = `practice-showcase-item${row.kind ? ` is-${row.kind}` : ''}`;
      item.textContent = row.text;
      element.appendChild(item);
    }
  }

  return { render, describe };
});
