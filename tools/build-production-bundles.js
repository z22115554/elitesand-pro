#!/usr/bin/env node
/**
 * Release-only production bundling.
 *
 * 只在 build-portable.ps1 / build-installer.ps1 呼叫，對「已複製到 staging 的副本」動手，
 * 絕不能碰 repo 裡的 server/、public/ 原始碼——npm start、npm test 和 tests/run-tests.js
 * 裡幾十個 require('../server/xxx') 都必須繼續吃到未打包的原始檔案。
 *
 * 策略（見 CLOSED_SOURCE_MIGRATION_PLAN.md 批次 B-1）：
 * - server/**、electron/*.js：逐檔 minify，保留原本目錄結構與檔名。
 *   不合併成單一檔案——server 內部有多處靠 __dirname 相對路徑找同層檔案
 *   （Electron 直接 require server/utils/parent-shutdown.js、app-updater.js
 *   複製 app-updater-runner.js 當獨立子行程），合併會打斷這些路徑假設。
 * - public/js/*.js：依每個 HTML 頁面原本 <script src> 的順序，把該頁引用的
 *   本機腳本各自 minify 後串接成一個 bundle，取代原本一串 <script> 標籤。
 *   （HTML 頁面本身就是這些腳本共享全域作用域的唯一依賴來源，串接不改變執行順序，
 *   等於今天分開的 <script> 標籤本來就共享同一個全域環境。）
 * - vendor/（gsap.min.js、soundtouch*.js、Tone.js、opencc-cn2t.js）完全不碰。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

// 這些 public/js/*.js 檔案是「同構模組」：瀏覽器端用 <script src> 載入，
// server 端也直接 require() 同一份檔案（設定驗證邏輯共用一份，避免前後端分岔）。
// 合併進頁面 bundle 之後絕對不能刪除原始檔，否則 server 啟動時 require 會直接炸掉。
// 找到方式：grep server/ 底下 require('../../public/js/...') 的完整清單。
const SERVER_REQUIRED_PUBLIC_JS = [
  'setlist-style-schema.js',
  'twitch-reply-settings.js',
  'twitch-request-settings.js',
  'twitch-reward-settings.js',
];

// 批次 C-1：自訂歌詞模板改成加密封裝，不再是安裝目錄裡具名可讀的 .js 檔。
// 清單必須跟 server/services/template-delivery.js 的 TEMPLATE_IDS 一致。
const TEMPLATE_IDS = ['pulse', 'facet', 'drift', 'aura', 'ktv', 'columnflow'];
const TEMPLATE_IV_LENGTH = 12;

function packTemplates(stagingRoot, { sourcemapOut } = {}) {
  const publicJsDir = path.join(stagingRoot, 'public', 'js');
  const storeDir = path.join(stagingRoot, 'server', 'template-store');
  const keyModulePath = path.join(stagingRoot, 'server', 'services', 'template-key.generated.js');

  fs.mkdirSync(storeDir, { recursive: true });
  const key = require('crypto').randomBytes(32);

  let packedCount = 0;
  for (const id of TEMPLATE_IDS) {
    const srcFile = path.join(publicJsDir, `lyric-template-${id}.js`);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`Missing template source for packing: ${srcFile}`);
    }
    const relPath = `public/js/lyric-template-${id}.js`;
    const source = fs.readFileSync(srcFile, 'utf8');
    const result = esbuild.transformSync(source, {
      loader: 'js',
      minify: true,
      legalComments: 'none',
      sourcemap: sourcemapOut ? 'external' : false,
      sourcefile: relPath,
    });
    if (sourcemapOut && result.map) saveSourcemap(sourcemapOut, relPath, result.map);

    const iv = require('crypto').randomBytes(TEMPLATE_IV_LENGTH);
    const cipher = require('crypto').createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(result.code, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, authTag, ciphertext]);
    fs.writeFileSync(path.join(storeDir, `${id}.eltpl`), blob);

    fs.unlinkSync(srcFile);
    packedCount++;
  }

  const keyModuleSource = `module.exports = { key: '${key.toString('hex')}' };\n`;
  fs.writeFileSync(keyModulePath, keyModuleSource);

  return packedCount;
}

const SOUNDTOUCH_FINGERPRINTS = [
  'FifoSampleBuffer',
  'RateTransposer',
  'SimpleFilter',
  'sourcePosition',
  'putSamples',
];

function parseArgs(argv) {
  const args = { stagingRoot: null, sourcemapOut: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sourcemap-out') {
      args.sourcemapOut = argv[++i];
    } else {
      rest.push(argv[i]);
    }
  }
  args.stagingRoot = rest[0];
  return args;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function saveSourcemap(sourcemapOut, relPath, map) {
  if (!sourcemapOut || !map) return;
  const dest = path.join(sourcemapOut, `${relPath}.map`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, map);
}

/** 逐檔 minify，保留檔名與目錄結構。回傳處理檔數。 */
function minifyInPlace(files, { rootForRelPath, sourcemapOut }) {
  let count = 0;
  for (const file of files) {
    const relPath = path.relative(rootForRelPath, file);
    const source = fs.readFileSync(file, 'utf8');
    const result = esbuild.transformSync(source, {
      loader: 'js',
      minify: true,
      legalComments: 'none',
      sourcemap: sourcemapOut ? 'external' : false,
      sourcefile: relPath,
    });
    fs.writeFileSync(file, result.code);
    if (sourcemapOut && result.map) saveSourcemap(sourcemapOut, relPath, result.map);
    count++;
  }
  return count;
}

const LOCAL_SCRIPT_RE = /<script\s+src="(\/js\/([^"?#]+?\.js))"><\/script>\s*\n?/g;

/**
 * 把一個 HTML 頁面裡「本機 /js/*.js」的 <script> 標籤依序抓出來、逐檔 minify、
 * 串接成一個 bundle，並改寫 HTML 換成單一 <script> 參照。
 * electron-shell-chrome.js 是唯一例外：它在 index.html 的 <head> 裡搶在 body 之前執行，
 * 跟其他頁面腳本不共享位置語意，保留原檔名獨立 minify、不併入 bundle。
 */
function bundlePage(htmlFile, publicJsDir, { bundleName, sourcemapOut, skipMerge, consumed }) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const matches = [];
  let m;
  const re = new RegExp(LOCAL_SCRIPT_RE.source, 'g');
  while ((m = re.exec(html))) {
    const name = m[2];
    if (skipMerge && skipMerge.includes(name)) continue;
    matches.push({ full: m[0], name });
  }
  if (matches.length === 0) return { html, mergedCount: 0 };

  const chunks = [];
  for (const { name } of matches) {
    const file = path.join(publicJsDir, name);
    const source = fs.readFileSync(file, 'utf8');
    const relPath = `public/js/${name}`;
    const result = esbuild.transformSync(source, {
      loader: 'js',
      minify: true,
      legalComments: 'none',
      sourcemap: sourcemapOut ? 'external' : false,
      sourcefile: relPath,
    });
    if (sourcemapOut && result.map) saveSourcemap(sourcemapOut, relPath, result.map);
    chunks.push(`// --- ${name} ---\n${result.code}`);
    consumed.add(name);
  }

  const bundleFileName = `${bundleName}.bundle.js`;
  fs.writeFileSync(path.join(publicJsDir, bundleFileName), chunks.join('\n'));

  let replaced = false;
  let newHtml = html.replace(new RegExp(LOCAL_SCRIPT_RE.source, 'g'), (full, _srcAttr, name) => {
    if (skipMerge && skipMerge.includes(name)) return full;
    if (!replaced) {
      replaced = true;
      return `<script src="/js/${bundleFileName}"></script>\n`;
    }
    return '';
  });

  return { html: newHtml, mergedCount: matches.length };
}

function scanForSoundTouchFingerprint(files) {
  const hits = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const fp of SOUNDTOUCH_FINGERPRINTS) {
      if (content.includes(fp)) {
        hits.push({ file, fingerprint: fp });
        break;
      }
    }
  }
  return hits;
}

function main() {
  const { stagingRoot, sourcemapOut } = parseArgs(process.argv.slice(2));
  if (!stagingRoot || !fs.existsSync(stagingRoot)) {
    console.error('用法: node build-production-bundles.js <stagingRoot> [--sourcemap-out <dir>]');
    process.exit(1);
  }
  const serverDir = path.join(stagingRoot, 'server');
  const publicDir = path.join(stagingRoot, 'public');
  const publicJsDir = path.join(publicDir, 'js');

  if (!fs.existsSync(serverDir)) throw new Error(`Missing staged server dir: ${serverDir}`);
  if (!fs.existsSync(publicJsDir)) throw new Error(`Missing staged public/js dir: ${publicJsDir}`);

  // 1) server/**：逐檔 minify，保留結構
  const serverFiles = walk(serverDir);
  const serverCount = minifyInPlace(serverFiles, { rootForRelPath: stagingRoot, sourcemapOut });
  console.log(`[production-bundles] server: ${serverCount} 檔逐一 minify（結構不變）`);

  // 2) public/*.html：合併每頁的本機 /js/*.js
  const pages = [
    { html: 'index.html', bundleName: 'panel', skipMerge: ['electron-shell-chrome.js'] },
    { html: 'controller.html', bundleName: 'controller' },
    { html: 'prompter.html', bundleName: 'prompter' },
    { html: 'setlist.html', bundleName: 'setlist' },
    { html: 'display.html', bundleName: 'display' },
  ];

  const consumed = new Set();
  let totalMerged = 0;
  for (const page of pages) {
    const htmlFile = path.join(publicDir, page.html);
    if (!fs.existsSync(htmlFile)) throw new Error(`Missing staged page: ${htmlFile}`);
    const { html, mergedCount } = bundlePage(htmlFile, publicJsDir, {
      bundleName: page.bundleName,
      sourcemapOut,
      skipMerge: page.skipMerge,
      consumed,
    });
    fs.writeFileSync(htmlFile, html);
    totalMerged += mergedCount;
    console.log(`[production-bundles] ${page.html}: ${mergedCount} 個腳本併入 ${page.bundleName}.bundle.js`);
  }

  // electron-shell-chrome.js：獨立 minify，不併入任何 bundle
  const chromeShellFile = path.join(publicJsDir, 'electron-shell-chrome.js');
  if (fs.existsSync(chromeShellFile)) {
    minifyInPlace([chromeShellFile], { rootForRelPath: stagingRoot, sourcemapOut });
    console.log('[production-bundles] electron-shell-chrome.js: 獨立 minify（不併入 bundle，位置不變）');
  }

  // 3) 刪除已經被併入某個 bundle 的原始檔（不留具名可讀的原始檔案在 staging）。
  // 例外：SERVER_REQUIRED_PUBLIC_JS 清單裡的檔案 server 端會直接 require()，
  // 不能刪，改成逐檔 minify 後保留在原路徑。
  let deletedCount = 0;
  let keptForServerCount = 0;
  for (const name of consumed) {
    const file = path.join(publicJsDir, name);
    if (!fs.existsSync(file)) continue;
    if (SERVER_REQUIRED_PUBLIC_JS.includes(name)) {
      minifyInPlace([file], { rootForRelPath: stagingRoot, sourcemapOut });
      keptForServerCount++;
    } else {
      fs.unlinkSync(file);
      deletedCount++;
    }
  }
  console.log(`[production-bundles] 刪除 ${deletedCount} 個已併入 bundle 的原始檔；保留 ${keptForServerCount} 個 server 端仍需 require() 的同構模組（已 minify）`);

  // 3.5) 批次 C-1：自訂模板加密封裝（AES-256-GCM），原始 .js 檔案封裝後即刪除
  const packedCount = packTemplates(stagingRoot, { sourcemapOut });
  console.log(`[production-bundles] 模板加密封裝：${packedCount} 個模板已封裝進 server/template-store/，原始檔已刪除`);

  // 4) SoundTouch LGPL 守衛：掃描所有輸出，不得出現在任何專有 bundle
  const outputFiles = [
    ...walk(serverDir),
    ...fs.readdirSync(publicJsDir).filter((f) => f.endsWith('.js')).map((f) => path.join(publicJsDir, f)),
  ];
  const hits = scanForSoundTouchFingerprint(outputFiles);
  if (hits.length > 0) {
    console.error('[production-bundles] 偵測到 SoundTouch LGPL 特徵字串混進專有 bundle：');
    for (const hit of hits) console.error(`  ${hit.file} (${hit.fingerprint})`);
    throw new Error('SoundTouch guard failed: LGPL fingerprint found in proprietary bundle output.');
  }
  console.log(`[production-bundles] SoundTouch 守衛通過：掃描 ${outputFiles.length} 個輸出檔，無 LGPL 特徵字串`);

  console.log(`[production-bundles] 完成。server ${serverCount} 檔 minify，前端 ${totalMerged} 個腳本併入 ${pages.length} 個頁面 bundle，${packedCount} 個模板加密封裝。`);
}

if (require.main === module) {
  main();
}

module.exports = {
  scanForSoundTouchFingerprint,
  SOUNDTOUCH_FINGERPRINTS,
  minifyInPlace,
  bundlePage,
  packTemplates,
  TEMPLATE_IDS,
};
