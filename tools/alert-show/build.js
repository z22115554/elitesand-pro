'use strict';
/**
 * 訂閱／贈訂／揪團演出引擎的建置腳本。
 *
 *   node tools/alert-show/build.js          產生 public/alert-show/engine.js 與 catalog.json
 *   node tools/alert-show/build.js --check  只檢查成品是否跟原始檔一致（測試用）
 *
 * 原始檔在 tools/alert-show/src/，依檔名順序串接成單一檔；後面的同名 function 會覆寫前面的
 * （引擎刻意這樣疊加，順序不可改）。演出清單（等級、每種演出的秒數）抽成 catalog.json，
 * 伺服器排佇列、面板列出演出都讀這一份，不必載入整個引擎。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT_DIR = path.join(__dirname, '..', '..', 'public', 'alert-show');
const ENGINE = path.join(OUT_DIR, 'engine.js');
const CATALOG = path.join(OUT_DIR, 'catalog.json');

function buildEngine() {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  const body = files.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n')).join('');
  // 畫面上會用到的非 ASCII 字：開場先叫瀏覽器把字型分片抓回來，演出中才不會跳字型。
  const chars = [...new Set(Array.from(body).filter((ch) => ch.codePointAt(0) > 0x2000 && ch !== '\u2028' && ch !== '\u2029'))].sort().join('');
  return `window.__V2_TEXT = ${JSON.stringify(chars)};\n${body}`;
}

/** 在假的瀏覽器環境跑一次引擎，把演出登記表讀出來（只需要等級、順序、秒數）。 */
function readCatalog(engineSource) {
  const vm = require('vm');
  const noop = () => {};
  const ctx2d = new Proxy(function () {}, {
    get: (target, key) => {
      if (key === 'measureText') return () => ({ width: 100 });
      if (key === 'getImageData' || key === 'createImageData') return (a, b, w, h) => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (key === 'canvas') return { width: 1920, height: 1080 };
      return typeof key === 'string' && /^(create|get)/.test(key) ? () => ctx2d : (typeof key === 'symbol' ? undefined : ctx2d);
    },
    set: () => true,
    apply: () => ctx2d,
  });
  const canvas = () => ({ width: 1920, height: 1080, getContext: () => ctx2d, toDataURL: () => '' });
  const win = {
    location: { search: '' },
    document: { getElementById: canvas, createElement: canvas, fonts: { load: () => Promise.resolve([]) } },
    Image: function Image() {},
    CanvasRenderingContext2D: function CanvasRenderingContext2D() {},
    URLSearchParams, performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop },
    requestAnimationFrame: noop, setTimeout: noop, Math, JSON, Object, Array, Promise, Number, String, RegExp, Set, Map, Uint8ClampedArray,
  };
  win.window = win; win.globalThis = win; win.self = win;
  vm.createContext(win);
  vm.runInContext(`${engineSource}\n;window.__CAT = { VARS: Object.fromEntries(Object.keys(VARS).map((id) => [id, VARS[id].map((v, i) => ({ name: v.name, dur: setTier(id, i) }))])), TIER_MIN: window.TIER_MIN, RAID_MIN: window.RAID_MIN };`, win, { filename: 'engine.js' });
  if (win.ready && typeof win.ready.catch === 'function') win.ready.catch(noop);
  const { VARS, TIER_MIN, RAID_MIN } = win.__CAT;
  const order = ['sub', 'g1', 'g5', 'g10', 'g25', 'g50', 'g100', 'r1', 'r2', 'r3', 'r4'];
  const tiers = order.map((id) => {
    const list = VARS[id];
    if (!Array.isArray(list) || !list.length) throw new Error(`演出登記表缺少等級 ${id}`);
    return {
      id,
      group: id === 'sub' ? 'sub' : (id[0] === 'r' ? 'raid' : 'gift'),
      variants: list.map((v, index) => {
        if (!v || typeof v.dur !== 'number') throw new Error(`${id} 第 ${index} 種演出沒有秒數`);
        return { index, name: String(v.name || ''), dur: Math.round(v.dur * 100) / 100 };
      }),
    };
  });
  return { version: 1, giftMin: { ...TIER_MIN }, raidMin: { ...RAID_MIN }, tiers };
}

function main() {
  const engine = buildEngine();
  const catalog = `${JSON.stringify(readCatalog(engine), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const same = (file, text) => fs.existsSync(file) && fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') === text;
    if (!same(ENGINE, engine) || !same(CATALOG, catalog)) {
      console.error('public/alert-show 的成品跟 tools/alert-show/src 不一致，請執行 node tools/alert-show/build.js');
      process.exit(1);
    }
    console.log('alert-show 成品與原始檔一致');
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(ENGINE, engine);
  fs.writeFileSync(CATALOG, catalog);
  console.log(`engine.js ${engine.length} 字元；catalog.json ${JSON.parse(catalog).tiers.reduce((n, t) => n + t.variants.length, 0)} 種演出`);
}

if (require.main === module) main();
module.exports = { buildEngine, readCatalog };
