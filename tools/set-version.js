#!/usr/bin/env node
'use strict';
/**
 * 發版改版號的單一入口：一次改好 package.json、package-lock.json 與 README 裡所有顯示版號的地方。
 *
 *   npm run version:set -- 1.0.8     改成 1.0.8
 *   node tools/set-version.js --check  只檢查 README 是否跟 package.json 一致（npm test 會跑）
 *
 * 以前是手動改 package.json，README 的「最新版本」常常忘記改（停在舊版好幾版），
 * 公開倉首頁就一直顯示舊版號。README 同步到公開倉後使用者看的是這份，所以跟版號綁在一起改。
 * 只做字串替換、不重新序列化 JSON，保留原本的格式與鍵順序。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_RE = /^\d+\.\d+\.\d+$/;

// README 裡跟版號有關的地方：「最新版本」那一行，與五語安裝說明的 Get-FileHash 範例檔名。
// GitHub Release 上的資產名稱會把空格換成點（Elitesand.Pro.Setup.x.y.z.exe），範例要跟下載到的檔名一致。
const README_RULES = [
  { name: '最新版本', re: /(\*\*最新版本 \/ Latest：`v)(\d+\.\d+\.\d+)(`)/g, min: 1 },
  { name: 'Get-FileHash 範例', re: /(Get-FileHash -Algorithm SHA256 "Elitesand[ .]Pro[ .]Setup[ .])(\d+\.\d+\.\d+)(\.exe")/g, min: 1 },
];

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, text) { fs.writeFileSync(path.join(ROOT, rel), text, 'utf8'); }

function packageVersion() {
  const pkg = JSON.parse(read('package.json'));
  return String(pkg.elitesandPublicVersion || pkg.version || '').trim();
}

function readmeVersions(text) {
  const found = [];
  for (const rule of README_RULES) {
    const hits = [...text.matchAll(rule.re)];
    if (hits.length < rule.min) throw new Error(`README 找不到「${rule.name}」，版號規則需要更新`);
    hits.forEach((m) => found.push({ rule: rule.name, version: m[2] }));
  }
  return found;
}

function setReadme(text, version) {
  let out = text;
  for (const rule of README_RULES) {
    out = out.replace(rule.re, (_, a, _v, c) => `${a}${version}${c}`);
  }
  return out.replace(/Get-FileHash -Algorithm SHA256 "Elitesand[ .]Pro[ .]Setup[ .]/g, 'Get-FileHash -Algorithm SHA256 "Elitesand.Pro.Setup.');
}

function replaceOnce(text, re, replacement, label) {
  const count = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].length;
  if (count !== 1) throw new Error(`${label}：預期剛好 1 處，實際 ${count} 處`);
  return text.replace(re, replacement);
}

function setVersion(version) {
  if (!VERSION_RE.test(version)) throw new Error(`版號格式要是 x.y.z：${version}`);

  let pkg = read('package.json');
  pkg = replaceOnce(pkg, /^( {2}"version": ")[^"]+(",?)$/m, `$1${version}$2`, 'package.json version');
  pkg = replaceOnce(pkg, /^( {2}"elitesandPublicVersion": ")[^"]+(",?)$/m, `$1${version}$2`, 'package.json elitesandPublicVersion');

  let lock = read('package-lock.json');
  lock = replaceOnce(lock, /^( {2}"version": ")[^"]+(",)$/m, `$1${version}$2`, 'package-lock.json version');
  lock = replaceOnce(lock, /^( {4}"": \{\n {6}"name": "elitesand-pro",\n {6}"version": ")[^"]+(",)$/m, `$1${version}$2`, 'package-lock.json packages[""].version');

  const readme = setReadme(read('README.md'), version);

  // 全部算好才寫，任何一處對不上就整個不動
  write('package.json', pkg);
  write('package-lock.json', lock);
  write('README.md', readme);
  return readmeVersions(readme).length;
}

function check() {
  const version = packageVersion();
  const stale = readmeVersions(read('README.md')).filter((f) => f.version !== version);
  return { version, stale };
}

if (require.main === module) {
  const arg = process.argv[2];
  try {
    if (arg === '--check') {
      const { version, stale } = check();
      if (stale.length) {
        console.error(`README 版號與 package.json（${version}）不一致：${stale.map((s) => `${s.rule}=${s.version}`).join('、')}`);
        console.error('執行 npm run version:set -- <版號> 一次改好。');
        process.exit(1);
      }
      console.log(`README 版號與 package.json 一致（${version}）。`);
    } else if (arg) {
      const n = setVersion(arg);
      console.log(`已改為 ${arg}：package.json、package-lock.json、README（${n} 處）。`);
    } else {
      console.error('用法：npm run version:set -- <x.y.z>　或　node tools/set-version.js --check');
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { check, readmeVersions, setReadme, setVersion };
