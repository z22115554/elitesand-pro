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
 * - public/js/*.js：依每個 HTML 頁面原本 <script src> 的順序，把「連續的一段」
 *   本機腳本各自 minify 後串接成 bundle。遇到 vendor、動態路由或 inline script
 *   就切成下一段，保留原本跨來源的執行順序，避免依賴尚未載入就先執行。
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
  const args = { stagingRoot: null, sourcemapOut: null, electronOnly: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sourcemap-out') {
      args.sourcemapOut = argv[++i];
    } else if (argv[i] === '--electron-only') {
      args.electronOnly = true;
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

const SCRIPT_TAG_RE = /<script\b[^>]*>[\s\S]*?<\/script>\s*\n?/gi;
const SCRIPT_SRC_RE = /\bsrc="([^"]+)"/i;
const LOCAL_SCRIPT_SRC_RE = /^\/js\/([^"?#]+?\.js)(?:[?#].*)?$/;

/**
 * 把頁面中的本機 /js/*.js 依原始執行順序分段 bundle。
 *
 * 不能把整頁所有本機腳本一口氣搬到第一個 /js/ 標籤的位置：display.html 的
 * JIZURA engine 在 /vendor/，index.html 也有 Tone.js。跨過這些邊界會讓後面的
 * 本機腳本在依賴尚未載入前先執行。任何非 mergeable script（vendor、動態路由、
 * inline script、skipMerge）都會切斷 segment。
 */
function bundlePage(htmlFile, publicJsDir, { bundleName, sourcemapOut, skipMerge, consumed }) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const skip = new Set(skipMerge || []);
  const scriptTags = [];
  let m;
  const re = new RegExp(SCRIPT_TAG_RE.source, 'gi');

  while ((m = re.exec(html))) {
    const full = m[0];
    const srcMatch = SCRIPT_SRC_RE.exec(full);
    const src = srcMatch ? srcMatch[1] : '';
    const localMatch = LOCAL_SCRIPT_SRC_RE.exec(src);
    const name = localMatch ? localMatch[1] : null;
    scriptTags.push({
      start: m.index,
      end: re.lastIndex,
      name,
      mergeable: !!name && !skip.has(name),
    });
  }

  const segments = [];
  let current = [];
  for (const tag of scriptTags) {
    if (tag.mergeable) {
      current.push(tag);
    } else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  if (segments.length === 0) return { html, mergedCount: 0 };

  const replacements = [];
  let mergedCount = 0;

  segments.forEach((segment, segmentIndex) => {
    const chunks = [];
    for (const tag of segment) {
      const file = path.join(publicJsDir, tag.name);
      const source = fs.readFileSync(file, 'utf8');
      const relPath = `public/js/${tag.name}`;
      const result = esbuild.transformSync(source, {
        loader: 'js',
        minify: true,
        legalComments: 'none',
        sourcemap: sourcemapOut ? 'external' : false,
        sourcefile: relPath,
      });
      if (sourcemapOut && result.map) saveSourcemap(sourcemapOut, relPath, result.map);
      chunks.push(`// --- ${tag.name} ---\n${result.code}`);
      consumed.add(tag.name);
      mergedCount++;
    }

    const suffix = segmentIndex === 0 ? '' : `-${segmentIndex + 1}`;
    const bundleFileName = `${bundleName}${suffix}.bundle.js`;
    fs.writeFileSync(path.join(publicJsDir, bundleFileName), chunks.join('\n'));

    segment.forEach((tag, index) => {
      replacements.push({
        start: tag.start,
        end: tag.end,
        text: index === 0 ? `<script src="/js/${bundleFileName}"></script>\n` : '',
      });
    });
  });

  // 由後往前改，避免前面的替換改變後面記錄好的字元位置。
  let newHtml = html;
  replacements.sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    newHtml = newHtml.slice(0, replacement.start) + replacement.text + newHtml.slice(replacement.end);
  }

  return { html: newHtml, mergedCount };
}

function assertLocalScriptReferencesExist(publicDir, publicJsDir) {
  const pages = fs.readdirSync(publicDir).filter((name) => name.endsWith('.html'));
  const missing = [];

  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    const re = new RegExp(SCRIPT_TAG_RE.source, 'gi');
    let m;
    while ((m = re.exec(html))) {
      const srcMatch = SCRIPT_SRC_RE.exec(m[0]);
      if (!srcMatch) continue;
      const localMatch = LOCAL_SCRIPT_SRC_RE.exec(srcMatch[1]);
      if (!localMatch) continue;
      const name = localMatch[1];
      if (!fs.existsSync(path.join(publicJsDir, name))) missing.push(`${page}: /js/${name}`);
    }
  }

  if (missing.length) {
    throw new Error(`Production HTML references missing local scripts:\n${missing.map((item) => `  ${item}`).join('\n')}`);
  }
}

const PAGE_BUNDLES = [
  { html: 'index.html', bundleName: 'panel', skipMerge: ['electron-shell-chrome.js'] },
  { html: 'controller.html', bundleName: 'controller' },
  { html: 'prompter.html', bundleName: 'prompter' },
  { html: 'setlist.html', bundleName: 'setlist' },
  { html: 'display.html', bundleName: 'display' },
  { html: 'moon.html', bundleName: 'moon' },
  { html: 'webgpu-separation-worker.html', bundleName: 'webgpu-separation-worker' },
];

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
  const { stagingRoot, sourcemapOut, electronOnly } = parseArgs(process.argv.slice(2));
  if (!stagingRoot || !fs.existsSync(stagingRoot)) {
    console.error('用法: node build-production-bundles.js <stagingRoot> [--sourcemap-out <dir>]');
    process.exit(1);
  }
  const serverDir = path.join(stagingRoot, 'server');
  const publicDir = path.join(stagingRoot, 'public');
  const publicJsDir = path.join(publicDir, 'js');

  if (electronOnly) {
    const electronDir = path.join(stagingRoot, 'electron');
    if (!fs.existsSync(electronDir)) throw new Error(`Missing staged Electron directory: ${electronDir}`);
    const electronCount = minifyInPlace(walk(electronDir), { rootForRelPath: stagingRoot, sourcemapOut });
    console.log(`[production-bundles] Electron shell: ${electronCount} files minified`);
    return;
  }

  if (!fs.existsSync(serverDir)) throw new Error(`Missing staged server dir: ${serverDir}`);
  if (!fs.existsSync(publicJsDir)) throw new Error(`Missing staged public/js dir: ${publicJsDir}`);

  // 1) server/**：逐檔 minify，保留結構
  const serverFiles = walk(serverDir);
  const serverCount = minifyInPlace(serverFiles, { rootForRelPath: stagingRoot, sourcemapOut });
  console.log(`[production-bundles] server: ${serverCount} 檔逐一 minify（結構不變）`);

  // 2) public/*.html：合併每頁的本機 /js/*.js
  const consumed = new Set();
  let totalMerged = 0;
  for (const page of PAGE_BUNDLES) {
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

  // 3.6) 最後再驗一次所有 HTML 的本機腳本引用。新增頁面忘記納入 bundler 時，
  // 若共用腳本已被其他頁面消耗並刪除，這裡直接讓 release build 失敗，不能把 404 帶出去。
  assertLocalScriptReferencesExist(publicDir, publicJsDir);

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

  console.log(`[production-bundles] 完成。server ${serverCount} 檔 minify，前端 ${totalMerged} 個腳本併入 ${PAGE_BUNDLES.length} 個頁面 bundle，${packedCount} 個模板加密封裝。`);
}

if (require.main === module) {
  main();
}

module.exports = {
  SERVER_REQUIRED_PUBLIC_JS,
  scanForSoundTouchFingerprint,
  SOUNDTOUCH_FINGERPRINTS,
  minifyInPlace,
  bundlePage,
  assertLocalScriptReferencesExist,
  PAGE_BUNDLES,
  packTemplates,
  TEMPLATE_IDS,
};