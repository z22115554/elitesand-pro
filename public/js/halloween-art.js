/**
 * 萬聖節美術素材插槽（public/assets/halloween/<slot>.webp）。
 *
 * 每個畫面元素都先用 CSS／SVG 畫一個保底版本；素材檔放進資料夾後自動換成美術圖，
 * 不用改程式。做法：先跟 server 要一次「資料夾裡有哪些插槽」的清單，清單上有的才載圖；
 * 載得到就在 <html> 加上 art-<slot> class，並把網址寫進 CSS 變數 --art-<slot>。
 * CSS 只在有 class 時才改用圖片，所以素材缺幾張都不會壞，缺的也不會去打 404。
 *
 * 只探測呼叫端要用的插槽，而且每個插槽整個頁面只探測一次（結果快取）。
 */
(function (root) {
  'use strict';

  const BASE = '/assets/halloween/';
  const cache = new Map();
  let manifest = null;

  function available() {
    if (!manifest) {
      manifest = fetch(`${BASE}manifest.json`, { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : { slots: [] }))
        .then((body) => new Set(Array.isArray(body && body.slots) ? body.slots : []))
        .catch(() => new Set());
    }
    return manifest;
  }

  function loadImage(slot) {
    const url = `${BASE}${slot}.webp`;
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const html = document.documentElement;
        html.style.setProperty(`--art-${slot}`, `url("${url}")`);
        html.classList.add(`art-${slot}`);
        resolve(url);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function probe(slot) {
    if (cache.has(slot)) return cache.get(slot);
    const job = available().then((slots) => (slots.has(slot) ? loadImage(slot) : null));
    cache.set(slot, job);
    return job;
  }

  /** 探測多個插槽；回傳 { slot: url|null }。 */
  function load(slots) {
    return Promise.all(slots.map((slot) => probe(slot).then((url) => [slot, url])))
      .then((pairs) => Object.fromEntries(pairs));
  }

  root.HalloweenArt = { load, probe, BASE };
})(window);
