#!/usr/bin/env node
'use strict';

/**
 * 把本倉「允許公開」的檔案複製到公開倉工作目錄，跑一次禁止清單檢查，並（可選）
 * 提交成一個版本快照 commit。
 *
 * 這支腳本是 docs/OPEN-SOURCE-PLAN.md §3 雙 repo 方案的執行工具：
 * 私有倉（Elitesand-Pro-src）照舊開發，公開倉只在發版時收到一個快照。
 *
 * 設計上刻意是「白名單複製」而不是「黑名單刪除」——沒被 ALLOW 列到的東西
 * 物理上不會出現在公開倉，漏寫規則的後果是「少公開了東西」而不是「洩漏」。
 *
 * 用法：
 *   node tools/publish-oss.js --target ../elitesand-pro-oss --dry-run
 *   node tools/publish-oss.js --target ../elitesand-pro-oss
 *   node tools/publish-oss.js --target ../elitesand-pro-oss --commit
 *
 * --dry-run  只列出會複製什麼、會刪什麼，不動檔案
 * --commit   複製完後在目標倉 git add -A 並 commit 成 "release: v<version>"
 *            （不會 push；push 一律由使用者自己按）
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ─── 允許公開的路徑（docs/OPEN-SOURCE-PLAN.md §2）───
// 目錄會整棵複製（再套用下方 DENY 過濾）；檔案逐一列出。
const ALLOW_DIRS = ['server', 'public', 'electron', 'ai', 'native', 'tests', 'tools'];
const ALLOW_FILES = [
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'EULA.txt',
  'THIRD-PARTY-NOTICES.txt',
  '.gitignore',
];

// ─── 無論如何都不複製（第二道防線，就算 ALLOW 寫太寬也擋得住）───
// 比對的是相對於 repo root 的 POSIX 路徑。
const DENY_PATTERNS = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /^cloudflare(\/|$)/,            // 四支 Worker：伺服器端基礎設施，維持私有
  /^server\/config\.js$/,         // 本機設定：PIN／Twitch token
  /^(data|downloads|logs|dist|dist-release)(\/|$)/,
  /^data-preview-/,
  /^ai-experiments(\/|$)/,        // 曾夾帶螢幕錄影與 ffmpeg.dll
  /^(docs|\.claude|\.codex|\.local|\.tmp|\.playwright-cli|test-results)(\/|$)/,
  /^\.codex-remote-attachments(\/|$)/,
  /^\.update-(backup|tmp)(\/|$)/,
  /\.(bak|tmp|zip)$/,
  /^tests\/fixtures\/.*private.*\.pem$/, // 測試私鑰：非生產，但沒有公開的必要
];

// README.md 以外的 .md 一律不進 repo（CLAUDE.md 的鐵則）。
// cloudflare/ 底下那兩個 worker README 已被 DENY 的 cloudflare 規則擋掉。
function isForbiddenMarkdown(rel) {
  return rel.endsWith('.md') && rel !== 'README.md';
}

function parseArgs(argv) {
  const args = { target: null, dryRun: false, commit: false };
  for (let i = 2; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--target') args.target = argv[++i];
    else if (v === '--dry-run') args.dryRun = true;
    else if (v === '--commit') args.commit = true;
    else throw new Error(`Unknown argument: ${v}`);
  }
  if (!args.target) throw new Error('Usage: node tools/publish-oss.js --target <公開倉路徑> [--dry-run] [--commit]');
  return args;
}

function denied(rel) {
  return DENY_PATTERNS.some((re) => re.test(rel)) || isForbiddenMarkdown(rel);
}

/** 收集 ALLOW 範圍內、且沒被 DENY 擋掉的所有檔案（相對路徑，POSIX 分隔）。 */
function collect() {
  const out = [];
  const walk = (relDir) => {
    const abs = path.join(ROOT, relDir);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (denied(rel)) continue;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  for (const d of ALLOW_DIRS) walk(d);
  for (const f of ALLOW_FILES) {
    if (denied(f)) continue;
    if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  return out.sort();
}

/** 目標倉裡目前被 git 追蹤的檔案（用來算出這次要刪掉哪些）。 */
function targetTracked(target) {
  try {
    const out = execFileSync('git', ['-C', target, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_) {
    return []; // 還沒 git init，或是空倉
  }
}

function main() {
  const args = parseArgs(process.argv);
  const target = path.resolve(args.target);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

  if (path.resolve(target) === ROOT) throw new Error('--target 不可以是本倉自己');
  if (!args.dryRun && !fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

  const files = collect();
  const tracked = targetTracked(target);
  const keep = new Set(files);
  const toDelete = tracked.filter((f) => !keep.has(f));

  // 最後一道保險：任何一個要複製的檔案若命中 DENY，直接中止（理論上 collect 已擋掉）。
  const leaks = files.filter(denied);
  if (leaks.length) {
    console.error('拒絕發布：以下檔案同時出現在 ALLOW 與 DENY，規則有衝突：');
    leaks.forEach((f) => console.error('  ' + f));
    process.exit(1);
  }

  console.log(`來源  : ${ROOT}`);
  console.log(`目標  : ${target}`);
  console.log(`版本  : ${version}`);
  console.log(`複製  : ${files.length} 個檔案`);
  console.log(`刪除  : ${toDelete.length} 個（目標倉有、本次白名單沒有）`);
  const byTop = files.reduce((m, f) => { const k = f.split('/')[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
  Object.entries(byTop).sort().forEach(([k, n]) => console.log(`        ${k.padEnd(24)} ${n}`));
  if (toDelete.length) toDelete.slice(0, 20).forEach((f) => console.log(`  - ${f}`));

  if (args.dryRun) { console.log('\n--dry-run：沒有動任何檔案。'); return; }

  for (const f of toDelete) {
    const p = path.join(target, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  for (const rel of files) {
    const dst = path.join(target, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
  console.log('\n複製完成。');

  if (args.commit) {
    execFileSync('git', ['-C', target, 'add', '-A'], { stdio: 'inherit' });
    // 沒有變更時 commit 會失敗，這裡當成正常情況
    try {
      execFileSync('git', ['-C', target, 'commit', '-m', `release: v${version}`], { stdio: 'inherit' });
      console.log(`已在目標倉 commit：release: v${version}`);
    } catch (_) {
      console.log('目標倉沒有變更，略過 commit。');
    }
    console.log('注意：本腳本不會 push。確認內容後自己推。');
  }
}

main();
