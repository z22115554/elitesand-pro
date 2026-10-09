/**
 * 中秋活動疊加層（/moon）：月相進度條＋燈籠名牌。分頁、感謝提示、謝幕名單、示範模式與
 * socket 事件在 seasonal-overlay.js 共用核心；這裡只有中秋的畫面。
 * 網址參數見 seasonal-overlay.js；?part=moon|lanterns|credits。
 */
(function () {
  'use strict';

  const LANTERN_STYLES = ['paper', 'red', 'pomelo', 'palace', 'rabbit'];
  const DEMO_DONATIONS = [
    { id: 'demo-paper', name: '湯圓', amount: 50, style: 'paper' },
    { id: 'demo-red', name: '月餅好好吃', amount: 100, style: 'red' },
    { id: 'demo-pomelo', name: '柚子帽', amount: 300, style: 'pomelo' },
    { id: 'demo-palace', name: '賞月的人', amount: 500, style: 'palace' },
    { id: 'demo-rabbit', name: '月兔', amount: 1000, style: 'rabbit' },
  ];

  const litPath = document.getElementById('moon-lit-path');
  const burst = document.getElementById('moon-burst');
  const R = 90;
  const C = 100;

  function phasePath(p) {
    if (p <= 0.001) return 'M0 0';
    if (p >= 0.999) return `M${C} ${C - R} A${R} ${R} 0 1 1 ${C} ${C + R} A${R} ${R} 0 1 1 ${C} ${C - R} Z`;
    const rx = R * Math.abs(1 - 2 * p);
    const sweep = p > 0.5 ? 1 : 0;
    return `M${C} ${C - R} A${R} ${R} 0 0 1 ${C} ${C + R} A${rx.toFixed(2)} ${R} 0 0 ${sweep} ${C} ${C - R} Z`;
  }

  function buildLantern(donation, { isNew, money, div }) {
    const node = div(`lantern lantern--${donation.style}` + (isNew ? ' is-new' : ''));
    node.dataset.id = donation.id;
    const body = div('lantern-body');
    const name = div('lantern-name');
    name.textContent = donation.name;
    const amount = div('lantern-amount');
    amount.textContent = money(donation.amount);
    body.append(name, amount);
    node.append(div('lantern-cord'), div('lantern-top'), body, div('lantern-bottom'), div('lantern-tassel'));
    return node;
  }

  function sparkBurst(delay) {
    const ring = document.createElement('div');
    ring.className = 'moon-burst-ring';
    burst.append(ring);
    ring.animate(
      [{ transform: 'scale(0.9)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }],
      { duration: 1300, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' },
    ).onfinish = () => ring.remove();
    for (let i = 0; i < 18; i++) {
      const spark = document.createElement('span');
      spark.className = 'moon-spark';
      spark.textContent = i % 3 === 0 ? '✦' : '•';
      spark.style.fontSize = `${10 + Math.random() * 14}px`;
      burst.append(spark);
      const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 120 + Math.random() * 130;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      spark.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1)`, opacity: 1, offset: 0.7 },
          { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy * 1.1 + 30}px)) scale(0.8)`, opacity: 0 },
        ],
        { duration: 1500 + Math.random() * 700, delay: delay + Math.random() * 200, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'both' },
      ).onfinish = () => spark.remove();
    }
  }

  SeasonalOverlay.start({
    prefix: 'moon',
    parts: ['moon', 'lanterns'],
    styles: LANTERN_STYLES,
    fallbackStyle: 'red',
    demoDonations: DEMO_DONATIONS,
    ids: {
      panel: 'moon-panel', tagString: 'lantern-string', thanks: 'moon-thanks', total: 'moon-total',
      goal: 'moon-goal', title: 'moon-title', done: 'moon-done', creditsRoll: 'moon-credits-roll',
    },
    pageDotsClass: 'lantern-page-dots',
    tagBodyClass: 'lantern-body',
    // 每盞燈籠含間距約 118px，左右各留 40px。
    tagSlotPx: 118,
    tagEdgePx: 80,
    tagScaleKey: 'lanternScale',
    scaleVars: { lanternScale: '--lantern-scale', moonScale: '--moon-scale' },
    buildTag: buildLantern,
    setProgress: (p) => litPath.setAttribute('d', phasePath(p)),
    celebrate() {
      sparkBurst(150);
      sparkBurst(1050);
    },
  });
})();
