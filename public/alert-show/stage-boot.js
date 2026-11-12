/**
 * 引擎載入前的準備：引擎開機時從網址讀參數，這裡固定成「透明背景、不畫模擬直播畫面」，
 * 並把自訂角色圖的網址（由外層頁面用 ?girl= ?mascot= 帶進來）限制在同源路徑。
 */
(function () {
  'use strict';
  var src = new URLSearchParams(location.search);
  var out = new URLSearchParams();
  out.set('bg', '0');
  out.set('tier', 'sub');
  // 即時播放不做抖色：那一步每格要多貼三次整張畫面，高等級演出會掉到 30fps 以下（只有離線算影片才需要）。
  out.set('dither', '0');
  ['girl', 'mascot'].forEach(function (key) {
    var value = src.get(key) || '';
    // 只收本機同源的絕對路徑（/alert-show/…），不讓網址參數把外部圖片帶進畫面。
    if (/^\/alert-show\/[\w\-./?=&]+$/.test(value) && value.indexOf('//') === -1 && value.indexOf('..') === -1) out.set(key, value);
  });
  if (src.get('mascot') === 'none') out.set('mascot', 'assets/none.webp'); // 載不到＝不使用吉祥物
  var keep = ['autoplay', 'n', 'name', 'lang', 'mute'];
  keep.forEach(function (key) { if (src.has(key)) out.set(key, src.get(key)); });
  history.replaceState(null, '', location.pathname + '?' + out.toString());

  // 字型：演出畫面固定會出現的字已經在本機（fonts.css）。觀眾名字可能是任何字，
  // 線上時再向 Google Fonts 補字。兩個重點：
  // - 不擋載入：網路不通或很慢時，樣式表若用一般 <link> 會卡住後面的引擎載入。
  // - 插在本機字型「前面」：同名字型後宣告的優先，這樣本機有的字永遠用本機的，不必等網路。
  var online = [
    'https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=LXGW+WenKai+TC:wght@400;700&family=Noto+Sans+TC:wght@900&display=swap',
    'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@900&family=Noto+Sans+KR:wght@900&family=Noto+Sans+SC:wght@900&family=Black+Han+Sans&family=Gaegu:wght@700&display=swap',
  ];
  var local = document.getElementById('stage-fonts');
  online.forEach(function (href) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.media = 'print';            // 先當成列印用的樣式，瀏覽器就不會為了它擋住頁面
    link.onload = function () { link.media = 'all'; };
    link.href = href;
    if (local && local.parentNode) local.parentNode.insertBefore(link, local); else document.head.appendChild(link);
  });
})();
