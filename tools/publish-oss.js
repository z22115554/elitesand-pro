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
 * 兩種模式：
 *
 * 【sync】逐 commit 重放（預設用這個）
 *   node tools/publish-oss.js --target ../elitesand-pro-oss --sync [--dry-run]
 *
 *   把 main 上「還沒同步過」的 commit 一個一個重放到公開倉，訊息與作者日期照搬，
 *   commit 尾巴加一行 `Source: <sha>` 當同步位置的記號。下次執行時讀公開倉最新
 *   commit 的這行就知道從哪接下去——不需要額外的狀態檔。
 *
 *   注意：這不是 git push 鏡像。公開倉的樹是過濾過的（沒有 cloudflare/、
 *   config.js…），每個 commit 的 tree 都不同，hash 必然不同，所以只能重放。
 *   好處是支線永遠不會出現在公開倉——只有 main 會被重放。
 *
 * 【snapshot】單一快照
 *   node tools/publish-oss.js --target ../elitesand-pro-oss --commit
 *
 *   不管歷史，直接把目前工作目錄的狀態複製過去，commit 成 "release: v<version>"。
 *   首次建倉、或歷史斷掉要重來時用。
 *
 * --dry-run  只列出會做什麼，不動檔案
 * 兩種模式都不會 push；push 一律由使用者自己按。
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
  const args = { target: null, dryRun: false, commit: false, sync: false, branch: 'main' };
  for (let i = 2; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--target') args.target = argv[++i];
    else if (v === '--dry-run') args.dryRun = true;
    else if (v === '--commit') args.commit = true;
    else if (v === '--sync') args.sync = true;
    else if (v === '--branch') args.branch = argv[++i];
    else throw new Error(`Unknown argument: ${v}`);
  }
  if (!args.target) throw new Error('Usage: node tools/publish-oss.js --target <公開倉路徑> [--sync|--commit] [--dry-run] [--branch main]');
  return args;
}

const SOURCE_TRAILER = 'Source: ';

function git(cwd, gitArgs, opts = {}) {
  return execFileSync('git', ['-C', cwd, ...gitArgs], { encoding: 'utf8', ...opts });
}

/** 讀公開倉最新 commit 訊息裡的 `Source: <sha>`，作為上次同步到哪裡的記號。 */
function lastSyncedSha(target) {
  try {
    const msg = git(target, ['log', '-1', '--format=%B'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const m = msg.match(new RegExp('^' + SOURCE_TRAILER + '([0-9a-f]{7,40})\\s*$', 'm'));
    return m ? m[1] : null;
  } catch (_) {
    return null; // 空倉／還沒 git init
  }
}

/** 把某個 commit 的樹展開到暫存目錄，套用白名單後回傳 (相對路徑 -> 絕對來源路徑)。 */
function filesAtCommit(sha) {
  const listed = git(ROOT, ['ls-tree', '-r', '--name-only', sha], { stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  return listed.filter((rel) => {
    if (denied(rel)) return false;
    const top = rel.split('/')[0];
    return ALLOW_DIRS.includes(top) || ALLOW_FILES.includes(rel);
  });
}

function syncMode(args, target) {
  const branch = args.branch;
  const from = lastSyncedSha(target);
  const range = from ? `${from}..${branch}` : branch;
  const shas = git(ROOT, ['rev-list', '--reverse', '--no-merges', range], { stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((s) => s.trim()).filter(Boolean);

  console.log(`來源分支 : ${branch}`);
  console.log(`上次同步 : ${from || '(公開倉是空的，從頭開始)'}`);
  console.log(`待重放   : ${shas.length} 個 commit`);
  if (!shas.length) { console.log('\n已經是最新的，沒事可做。'); return; }

  for (const sha of shas.slice(0, 10)) {
    const subject = git(ROOT, ['log', '-1', '--format=%s', sha], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    console.log(`  ${sha.slice(0, 8)}  ${subject}`);
  }
  if (shas.length > 10) console.log(`  … 還有 ${shas.length - 10} 個`);

  if (args.dryRun) { console.log('\n--dry-run：沒有動任何東西。'); return; }

  let replayed = 0;
  for (const sha of shas) {
    const files = filesAtCommit(sha);
    // 這個 commit 完全沒動到公開範圍（例如只改了 cloudflare/ 或 docs/）就跳過，
    // 不要在公開倉留下一個空 commit。
    const tracked = targetTracked(target);
    const keep = new Set(files);

    for (const f of tracked) if (!keep.has(f)) {
      const p = path.join(target, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    for (const rel of files) {
      const dst = path.join(target, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      const blob = execFileSync('git', ['-C', ROOT, 'show', `${sha}:${rel}`], { maxBuffer: 256 * 1024 * 1024 });
      fs.writeFileSync(dst, blob);
    }

    git(target, ['add', '-A'], { stdio: 'ignore' });
    const staged = git(target, ['diff', '--cached', '--name-only'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!staged) continue; // 公開範圍沒變化，跳過

    const body = git(ROOT, ['log', '-1', '--format=%B', sha], { stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
    const authorDate = git(ROOT, ['log', '-1', '--format=%aI', sha], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const message = `${body}\n\n${SOURCE_TRAILER}${sha}\n`;
    const msgFile = path.join(target, '.oss-commit-msg.tmp');
    fs.writeFileSync(msgFile, message, 'utf8');
    try {
      git(target, ['commit', '-F', '.oss-commit-msg.tmp', '--date', authorDate], { stdio: 'ignore' });
      replayed += 1;
    } finally {
      fs.unlinkSync(msgFile);
    }
  }
  console.log(`\n重放完成：${replayed} 個 commit 進了公開倉（${shas.length - replayed} 個沒動到公開範圍，已跳過）。`);
  console.log('注意：本腳本不會 push。確認內容後自己推。');
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

  console.log(`來源  : ${ROOT}`);
  console.log(`目標  : ${target}`);
  if (args.sync) { syncMode(args, target); return; }

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
