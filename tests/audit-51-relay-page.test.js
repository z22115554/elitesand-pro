'use strict';
// 公開點歌頁（Cloudflare Worker 內嵌的 HTML）：取自 #51 的搜尋／限流修正，加上改用直播控台設計系統。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function loadPage() {
  const source = fs.readFileSync(path.join(__dirname, '../cloud/song-request-relay/src/public-page/page.js'), 'utf8');
  // 跟 Worker 一樣把模板字串求值，拿到真正送給瀏覽器的 HTML
  const html = new Function(`return ${source.slice(source.indexOf('`'), source.lastIndexOf('`') + 1)};`)();
  const js = html.split('<script>')[1].split('</script>')[0];
  return { html, js };
}

test('#93 公開點歌頁：搜尋忽略全形／大小寫／空白', () => {
  const { js } = loadPage();
  new Function(js); // 語法要對
  const foldSrc = js.match(/function fold[\s\S]*?\n  }\n/);
  assert.ok(foldSrc, '要有 fold()');
  const fold = new Function(`${foldSrc[0]}; return fold;`)();
  assert.equal(fold('ＹＯＡＳＯＢＩ'), 'yoasobi');
  assert.equal(fold('夜に　駆ける'), '夜に駆ける');
  assert.equal(fold('Shape of You'), 'shapeofyou');
  assert.equal(fold(null), '');
  assert.match(js, /fold\(track\.title\)\.indexOf\(q\)/);
});

test('#93 公開點歌頁：歌單被限流（429）時不說「連結失效」，送出被限流時說要等幾秒', () => {
  const { js } = loadPage();
  assert.match(js, /error\.message === 'http_429'/);
  assert.match(js, /請稍等一分鐘再重新整理/);
  assert.match(js, /retryAfterSeconds \+ ' 秒後再試/);
});

test('公開點歌頁改用直播控台設計：琥珀強調、3px 圓角、跟隨深淺色，不再是紫色毛玻璃', () => {
  const { html } = loadPage();
  assert.match(html, /--accent: #E9B949/);
  assert.match(html, /prefers-color-scheme: light/);
  assert.match(html, /--r: 3px/);
  assert.doesNotMatch(html, /#7c6cff|backdrop-filter: blur\(14px\)/i);
  // 頁面上的 JS 依賴的元素都還在
  for (const id of ['list', 'page-sub', 'search', 'live-pill', 'live-pill-text', 'request-dialog', 'dialog-title', 'display-name', 'note', 'dialog-submit', 'dialog-cancel', 'count']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // 高密度：頂部固定、桌面多欄
  assert.match(html, /\.top \{ position: sticky/);
  assert.match(html, /repeat\(auto-fill, minmax\(330px, 1fr\)\)/);
  // 擴充位：工具列、側欄預設隱藏；歌曲標籤只接受字串並跳脫
  assert.match(html, /<div class="tools" id="tools" hidden><\/div>/);
  assert.match(html, /<aside class="side" id="side" hidden><\/aside>/);
  // 程式內不放 emoji
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test('公開點歌頁：歌曲標籤擴充點只畫字串、最多兩個、一律跳脫', () => {
  const { js } = loadPage();
  const esc = js.match(/function escapeHtml[\s\S]*?\n  }\n/)[0];
  const badges = js.match(/function trackBadges[\s\S]*?\n  }\n/)[0];
  const trackBadges = new Function(`${esc}${badges}; return trackBadges;`)();
  assert.equal(trackBadges({}), '');
  assert.equal(trackBadges({ badges: ['熱門', '<b>x</b>', '第三個'] }),
    '<span class="badge">熱門</span><span class="badge">&lt;b&gt;x&lt;/b&gt;</span>');
  assert.equal(trackBadges({ badges: [1, null, '新歌'] }), '<span class="badge">新歌</span>');
});
