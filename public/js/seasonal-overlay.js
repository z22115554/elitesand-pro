/**
 * 限時節慶活動疊加層的共用核心（/moon、/halloween）。資料全部來自 server 的 <prefix>:update。
 *
 * 主題只提供畫面：元素 id、名牌長相、進度視覺（月相／南瓜燈火）與慶祝特效；分頁輪播、
 * 感謝提示排隊、謝幕名單、金額漸進、達標偵測、示範模式與 socket 事件都在這裡。
 *
 * 網址參數：?part=<主題定義的區塊>|credits（只顯示其中一塊）、?max=每頁名牌數（預設 12）、
 * ?rotate=超過一頁時幾秒換頁（預設 12，0＝不輪播）、?autoplay=1（credits 載入即播）、
 * ?demo=1（面板預覽用：名牌換成每種樣式各一的示範）、
 * ?demo=celebrate（同上，且進度滿格、每隔幾秒重播一次達標慶祝）。
 */
(function (root) {
  'use strict';

  function start(theme) {
    const { prefix, styles, ids } = theme;
    const params = new URLSearchParams(location.search);
    const part = params.get('part');
    if (theme.parts.includes(part) || part === 'credits') document.body.dataset.part = part;
    const maxTags = Math.min(Math.max(parseInt(params.get('max'), 10) || 12, 1), 40);
    const rotateParam = parseInt(params.get('rotate'), 10);
    const rotateMs = (Number.isFinite(rotateParam) ? Math.min(Math.max(rotateParam, 0), 600) : 12) * 1000;
    const demoCelebrate = params.get('demo') === 'celebrate';
    const demo = params.get('demo') === '1' || demoCelebrate;

    const t = (key, vars) => (root.I18n ? root.I18n.t(key, vars) : key);
    const styleLabel = (style) => (styles.includes(style) ? t(`${prefix}.style.${style}`) : t(`${prefix}.style.fallback`));
    const nf = new Intl.NumberFormat('zh-TW');
    const money = (amount) => `NT$${nf.format(amount)}`;

    const el = (id) => document.getElementById(id);
    const panel = el(ids.panel);
    const tagString = el(ids.tagString);
    const div = (className) => {
      const node = document.createElement('div');
      node.className = className;
      return node;
    };

    // ─── 進度與金額漸進 ───
    let shownProgress = 0;
    let shownTotal = 0;
    let animFrame = 0;
    let settleTimer = 0;

    function setShown(progress, total) {
      shownProgress = progress;
      shownTotal = total;
      theme.setProgress(progress);
      el(ids.total).textContent = nf.format(Math.round(total));
    }

    function animateTo(progress, total) {
      cancelAnimationFrame(animFrame);
      clearTimeout(settleTimer);
      // rAF 在來源被節流（背景分頁、OBS 隱藏來源）時會暫停；到時間一定落在最終值。
      settleTimer = setTimeout(() => { cancelAnimationFrame(animFrame); setShown(progress, total); }, 1600);
      const fromP = shownProgress;
      const fromT = shownTotal;
      const begin = performance.now();
      const duration = 1400;
      const step = (now) => {
        const k = Math.min((now - begin) / duration, 1);
        const e = 1 - Math.pow(1 - k, 3);
        setShown(fromP + (progress - fromP) * e, fromT + (total - fromT) * e);
        if (k < 1) animFrame = requestAnimationFrame(step);
      };
      animFrame = requestAnimationFrame(step);
    }

    // ─── 名牌分頁輪播：第 0 頁＝最新的 max 個，往後每頁往更早的斗內翻；有新斗內立刻回第 0 頁 ───
    let firstRender = true;
    let lastProgress = 0;
    let knownIds = new Set();
    let allTags = [];
    let page = 0;
    let rotateTimer = 0;
    let swapTimer = 0;
    let tagScale = 1;

    // 放大名牌時一排放不下 ?max= 個，改以畫面實際放得下的數量分頁。
    function perPage() {
      // tagSlotPx 可以是函式：換成美術素材後名牌尺寸會變。
      const slotPx = typeof theme.tagSlotPx === 'function' ? theme.tagSlotPx() : theme.tagSlotPx;
      const fit = Math.floor((window.innerWidth - theme.tagEdgePx * tagScale) / (slotPx * tagScale));
      return Math.max(1, Math.min(maxTags, fit));
    }

    function pageCount() {
      return Math.max(1, Math.ceil(allTags.length / perPage()));
    }

    function pageSlice(index) {
      const size = perPage();
      const end = allTags.length - index * size;
      return allTags.slice(Math.max(0, end - size), end);
    }

    function drawPage(newIds) {
      const nodes = pageSlice(page).map((d) => {
        const style = styles.includes(d.style) ? d.style : theme.fallbackStyle;
        return theme.buildTag({ ...d, style }, { isNew: newIds.has(d.id), money, div });
      });
      const pages = pageCount();
      if (pages > 1) {
        const dots = div(theme.pageDotsClass);
        for (let i = pages - 1; i >= 0; i--) {
          const dot = document.createElement('span');
          if (i === page) dot.className = 'is-current';
          dots.append(dot);
        }
        nodes.push(dots);
      }
      tagString.replaceChildren(...nodes);
    }

    function scheduleRotation() {
      clearTimeout(rotateTimer);
      rotateTimer = 0;
      if (!rotateMs || demo || pageCount() <= 1) return;
      rotateTimer = setTimeout(() => {
        tagString.classList.add('is-swapping');
        swapTimer = setTimeout(() => {
          page = (page + 1) % pageCount();
          drawPage(new Set());
          tagString.classList.remove('is-swapping');
          scheduleRotation();
        }, 600);
      }, rotateMs);
    }

    function renderTags(donations, hasNew) {
      const newIds = new Set(firstRender ? [] : donations.filter((d) => !knownIds.has(d.id)).map((d) => d.id));
      knownIds = new Set(donations.map((d) => d.id));
      allTags = donations;
      if (hasNew || page >= pageCount()) {
        clearTimeout(swapTimer);
        tagString.classList.remove('is-swapping');
        page = 0;
      }
      drawPage(page === 0 ? newIds : new Set());
      if (hasNew || firstRender || !rotateTimer) scheduleRotation();
    }

    // ─── 達標慶祝 ───
    let celebrateTimer = 0;

    function celebrate() {
      if (root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      clearTimeout(celebrateTimer);
      panel.classList.remove('is-celebrating');
      tagString.classList.remove('is-celebrating');
      void panel.offsetWidth;
      tagString.querySelectorAll(`.${theme.tagBodyClass}`).forEach((body, i) => {
        body.style.setProperty('--cheer-delay', `${i * 90}ms`);
      });
      panel.classList.add('is-celebrating');
      tagString.classList.add('is-celebrating');
      theme.celebrate();
      celebrateTimer = setTimeout(() => {
        panel.classList.remove('is-celebrating');
        tagString.classList.remove('is-celebrating');
      }, theme.celebrateMs || 6200);
    }

    // ─── 謝幕名單：依每個人最高的那一級分組，由高到低 ───
    const styleRank = [...styles].reverse();
    const creditsRoll = el(ids.creditsRoll);
    let creditsState = null;
    let creditsAnimation = null;

    function buildCredits(state) {
      const byName = new Map();
      for (const d of state.donations || []) {
        const rank = styleRank.indexOf(d.style);
        const prev = byName.get(d.name);
        if (prev === undefined || (rank >= 0 && rank < prev)) byName.set(d.name, rank >= 0 ? rank : styleRank.length - 1);
      }
      const heading = div('credits-heading');
      heading.textContent = t(`${prefix}.credits.heading`);
      const title = div('credits-title');
      title.textContent = state.title || '';
      const blocks = [heading, title];
      styleRank.forEach((style, rank) => {
        const names = [...byName].filter(([, r]) => r === rank).map(([name]) => name);
        if (!names.length) return;
        const group = div('credits-group');
        group.dataset.style = style;
        const label = div('credits-group-label');
        label.textContent = styleLabel(style);
        const list = div('credits-names');
        for (const name of names) {
          const span = document.createElement('span');
          span.textContent = name;
          list.append(span);
        }
        group.append(label, list);
        blocks.push(group);
      });
      // 主題可以在結尾前加自己的段落（例如萬聖節的「糖果王」）。
      if (theme.creditsExtra) blocks.push(...theme.creditsExtra(state, { div, t }));
      const closing = div('credits-closing');
      closing.textContent = t(`${prefix}.credits.closing`);
      const sub = div('credits-closing-sub');
      sub.textContent = t(`${prefix}.credits.summary`, { total: nf.format(Math.max(Number(state.total) || 0, 0)), count: byName.size });
      blocks.push(closing, sub);
      creditsRoll.replaceChildren(...blocks);
    }

    function playCredits() {
      if (document.body.dataset.part !== 'credits' || !creditsState) return;
      creditsAnimation?.cancel();
      buildCredits(creditsState);
      const distance = root.innerHeight + creditsRoll.offsetHeight;
      const duration = Math.max(12000, (distance / 70) * 1000);
      creditsRoll.classList.add('is-rolling');
      creditsAnimation = creditsRoll.animate(
        [{ transform: 'translate(-50%, 0)' }, { transform: `translate(-50%, ${-distance}px)` }],
        { duration, easing: 'linear', fill: 'forwards' },
      );
      creditsAnimation.onfinish = () => {
        creditsRoll.classList.remove('is-rolling');
        creditsAnimation = null;
      };
    }

    // ─── 感謝提示：連續幾筆斗內時排隊逐一顯示，不互相蓋掉 ───
    const thanksEl = el(ids.thanks);
    const thanksQueue = [];
    let thanksBusy = false;

    function showNextThanks() {
      const donation = thanksQueue.shift();
      if (!donation) { thanksBusy = false; return; }
      thanksBusy = true;
      const who = document.createElement('b');
      who.textContent = donation.name;
      const [before, after = ''] = t(`${prefix}.overlay.thanks`, { style: styleLabel(donation.style) }).split('{name}');
      thanksEl.replaceChildren(before, who, after);
      thanksEl.classList.add('is-shown');
      setTimeout(() => {
        thanksEl.classList.remove('is-shown');
        setTimeout(showNextThanks, 600);
      }, 4500);
    }

    function queueThanks(donation) {
      if (!donation) return;
      thanksQueue.push(donation);
      if (thanksQueue.length > 5) thanksQueue.shift();
      if (!thanksBusy) showNextThanks();
    }

    // ─── 主渲染 ───
    let ended = false;

    function render(state) {
      if (!state || typeof state !== 'object') return;
      if (ended) return;
      document.body.dataset.activity = 'open';
      const goal = Math.max(Number(state.goal) || 1, 1);
      const total = demoCelebrate ? goal : Math.max(Number(state.total) || 0, 0);
      const progress = Math.min(total / goal, 1);
      const crossedGoal = !firstRender && lastProgress < 1 && progress >= 1;
      lastProgress = progress;

      tagScale = Number(state[theme.tagScaleKey]) || 1;
      for (const [key, cssVar] of Object.entries(theme.scaleVars)) {
        document.documentElement.style.setProperty(cssVar, String(Number(state[key]) || 1));
      }
      el(ids.title).textContent = state.title || '';
      el(ids.goal).textContent = nf.format(goal);
      el(ids.done).textContent = state.doneText || '';
      el(ids.done).hidden = progress < 1;
      panel.classList.toggle('is-full', progress >= 1);

      if (firstRender) setShown(progress, total);
      else animateTo(progress, total);

      if (!firstRender && state.latestId) {
        panel.classList.remove('is-bump');
        void panel.offsetWidth;
        panel.classList.add('is-bump');
      }

      const donations = Array.isArray(state.donations) ? state.donations : [];
      if (!firstRender && state.latestId && !demo) queueThanks(donations.find((d) => d.id === state.latestId));
      renderTags(demo ? theme.demoDonations : donations, !firstRender && !!state.latestId);
      const autoplayCredits = firstRender && params.get('autoplay') === '1';
      creditsState = state;
      const startDemoLoop = firstRender && demoCelebrate;
      firstRender = false;
      if (autoplayCredits) playCredits();
      // 等數字與進度漸進走完再放，視覺上是「剛好填滿」的那一刻。
      if (crossedGoal) setTimeout(celebrate, 1300);
      if (startDemoLoop) {
        setTimeout(celebrate, 600);
        setInterval(celebrate, 8000);
      }
    }

    SocketClient.on(`${prefix}:celebrate`, celebrate);
    SocketClient.on(`${prefix}:credits`, playCredits);
    SocketClient.on(`${prefix}:update`, render);
    // 活動已結束（伺服器啟動時判斷）：重連上新伺服器的舊來源整個藏起來。
    SocketClient.on(`${prefix}:ended`, () => {
      ended = true;
      document.body.dataset.activity = 'hidden';
    });
    SocketClient.init(prefix);
    return { t, styleLabel, isDemo: demo };
  }

  root.SeasonalOverlay = { start };
})(window);
