'use strict';

/**
 * OBS 啟動頁（🔬 原型）：讓 OBS 瀏覽器來源不必綁死 port。
 *
 * 伺服器啟動後在 data/obs-sources/ 寫兩個靜態 HTML（歌詞／歌單）。使用者把檔案拖進 OBS
 * （或以「本機檔案」建立瀏覽器來源）後，這頁自己探測 127.0.0.1 上哪個 port 有 Elitesand Pro
 * 的 /api/health，找到就 location.replace 到真正的 /display 或 /setlist。主程式之後不管
 * 跑在哪個 port，OBS 那邊都不用改。
 *
 * 設計約束：
 * - 頁面底色必須透明、不可畫任何可見元素（鐵則 11：OBS 疊加層不可蓋掉直播畫面），
 *   找不到伺服器時就是空白，持續重試。
 * - 探測靠 /api/health 的 CORS 標頭（file:// 來源送的是 Origin: null，用 * 放行）。
 * - 同機 loopback 不需要 Source Token（require-source-access.js），所以檔案裡不帶任何秘密。
 * - 這裡只負責產檔；port 探測清單把「產檔當下的 port」放最前面，正常情況第一發就中。
 */
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../utils/app-paths');
const { APP_VERSION } = require('../utils/app-version');
const { DEFAULT_PORT, probePortsFor } = require('../utils/port-candidates');

const LAUNCHER_DIR = path.join(dataDir, 'obs-sources');
// 檔名刻意用 ASCII：OBS 用檔名當來源名稱，且原型階段先排除任何編碼變數。
const LAUNCHERS = Object.freeze({
  lyrics: Object.freeze({ file: 'Elitesand-Pro-Lyrics.html', target: '/display', title: 'Elitesand Pro 歌詞' }),
  setlist: Object.freeze({ file: 'Elitesand-Pro-Setlist.html', target: '/setlist', title: 'Elitesand Pro 歌單' }),
});
// 探測清單與桌面殼的 port 備援共用 server/utils/port-candidates.js，殼可能挑到的 port 啟動頁一定探得到。
const CANDIDATE_PORTS = Object.freeze(probePortsFor(DEFAULT_PORT));

function candidatePortsFor(port) {
  return probePortsFor(port);
}

function buildLauncherHtml({ kind, port }) {
  const spec = LAUNCHERS[kind];
  if (!spec) throw new Error(`unknown OBS launcher kind: ${kind}`);
  const ports = candidatePortsFor(port);
  // 不引用外部資源、不放可見內容；所有邏輯 inline，讓這個檔在 file:// 下完全自足。
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${spec.title}</title>
<meta name="generator" content="Elitesand Pro ${APP_VERSION}">
<style>html,body{margin:0;padding:0;background:transparent!important;overflow:hidden}</style>
</head>
<body>
<script>
(function () {
  'use strict';
  var TARGET = ${JSON.stringify(spec.target)};
  var PORTS = ${JSON.stringify(ports)};
  var PROBE_TIMEOUT_MS = 800;
  var RETRY_MS = 1500;
  var stopped = false;

  function probe(port) {
    return new Promise(function (resolve) {
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (controller) controller.abort(); resolve(null); }, PROBE_TIMEOUT_MS);
      fetch('http://127.0.0.1:' + port + '/api/health', { cache: 'no-store', mode: 'cors', signal: controller ? controller.signal : undefined })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) { clearTimeout(timer); resolve(body && body.status === 'ok' ? port : null); })
        .catch(function () { clearTimeout(timer); resolve(null); });
    });
  }

  function go(port) {
    if (stopped) return;
    stopped = true;
    // 保留 OBS 那邊加在檔案 URL 後面的查詢字串（例如 ?lang=ja），原樣帶到真正的頁面。
    var search = window.location.search || '';
    window.location.replace('http://127.0.0.1:' + port + TARGET + search);
  }

  function round() {
    if (stopped) return;
    // 產檔當下的 port 先單獨探一次（正常情況一發就中），其餘候選再一起探。
    probe(PORTS[0]).then(function (hit) {
      if (hit) return go(hit);
      return Promise.all(PORTS.slice(1).map(probe)).then(function (results) {
        for (var i = 0; i < results.length; i++) if (results[i]) return go(results[i]);
        setTimeout(round, RETRY_MS);
      });
    });
  }

  round();
})();
</script>
</body>
</html>
`;
}

function launcherPath(kind) {
  const spec = LAUNCHERS[kind];
  if (!spec) throw new Error(`unknown OBS launcher kind: ${kind}`);
  return path.join(LAUNCHER_DIR, spec.file);
}

/**
 * 寫出（或更新）兩個啟動頁。內容相同就不重寫，避免每次啟動都動到檔案時間戳。
 * @returns {{ dir: string, port: number, files: Record<string, string> }}
 */
function writeLaunchers({ port, fsImpl = fs } = {}) {
  fsImpl.mkdirSync(LAUNCHER_DIR, { recursive: true });
  const files = {};
  for (const kind of Object.keys(LAUNCHERS)) {
    const target = launcherPath(kind);
    const html = buildLauncherHtml({ kind, port });
    let existing = null;
    try { existing = fsImpl.readFileSync(target, 'utf8'); } catch (_) { /* 首次產檔 */ }
    if (existing !== html) {
      const temporary = `${target}.tmp`;
      fsImpl.writeFileSync(temporary, html, 'utf8');
      fsImpl.renameSync(temporary, target);
    }
    files[kind] = target;
  }
  return { dir: LAUNCHER_DIR, port: Number(port), files };
}

function describe({ port } = {}) {
  return {
    dir: LAUNCHER_DIR,
    port: Number(port),
    files: Object.fromEntries(Object.keys(LAUNCHERS).map((kind) => [kind, launcherPath(kind)])),
  };
}

module.exports = {
  LAUNCHER_DIR,
  LAUNCHERS,
  CANDIDATE_PORTS,
  candidatePortsFor,
  buildLauncherHtml,
  launcherPath,
  writeLaunchers,
  describe,
};
