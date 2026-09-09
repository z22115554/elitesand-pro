#!/usr/bin/env node
'use strict';

/**
 * 發版用的 npm audit 閘門。
 *
 * 原本是 `npm audit --omit=dev --audit-level=low`，門檻是「零漏洞」。問題在於
 * 偶爾會出現「advisory 對我們的用法不成立、但上游還沒有修好的版本」的情況：
 * 這時 npm audit 只看版本號，不知道我們已經在程式層繞開了。把 --audit-level
 * 調鬆會連帶放行所有同等級的真漏洞，等於廢掉這道閘門；讓它永遠是紅的則會被
 * 習慣性忽略，一樣廢掉。
 *
 * 所以改成「白名單例外」：預設仍是零容忍，只有寫進 ACKNOWLEDGED 的 advisory
 * 才放行，而且必須寫清楚為什麼不成立、以及下次要複查的日期。不在名單上的
 * 一律 fail——fail-closed。
 */

const { execSync } = require('child_process');

// 單一字串交給 shell，而不是 execFileSync + args 陣列：Windows 上 npm 是 .cmd，
// 不透過 shell 會 EINVAL；但 execFileSync 搭 shell:true 又會觸發 DEP0190
// （參數不跳脫）。這裡沒有任何外來輸入拼進命令，用固定字串最單純。
const AUDIT_COMMAND = 'npm audit --omit=dev --json';

/**
 * 已評估、確認對本專案不成立的 advisory。
 * key 是 GHSA 編號；每一筆都要有 package / why / reviewOn。
 */
const ACKNOWLEDGED = {
  'GHSA-vwc7-r8mq-g2x9': {
    package: 'adm-zip',
    why:
      'extractAllTo 解壓時跟隨目的地既有 symlink。本專案已無任何 extractAllTo 呼叫：'
      + 'ai-runtime-provider.js 改用自寫的 safeExtractAll（擋 .. 逃逸／絕對路徑／'
      + 'symlink entry／目的地既有 symlink，並有單元測試）；app-updater、'
      + 'app-updater-v2、ffmpeg-provider 都是「讀 entry 資料再寫到程式自己決定的'
      + '路徑」，zip 內路徑不決定寫入位置，結構上免疫；diagnostic-bundle 只建立'
      + ' zip 不解壓。上游 0.6.0（目前最新）仍在 advisory 範圍內，沒有修好的版本，'
      + '而降版到 0.5.8 是 semver-major、會退掉八個版本的修正，更新器與 FFmpeg '
      + '供應都依賴它，不值得為此冒險。',
    acknowledgedOn: '2026-09-10',
    reviewOn: '2026-12-10', // adm-zip 一出修好的版本就該升上去並刪掉這筆
  },
};

function main() {
  let raw;
  try {
    raw = execSync(AUDIT_COMMAND, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    // 有漏洞時 npm audit 會以非 0 結束，但 stdout 仍是完整 JSON
    raw = error.stdout || '';
    if (!raw.trim()) {
      console.error('npm audit 沒有輸出可解析的 JSON：', error.message);
      process.exit(1);
    }
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch (error) {
    console.error('無法解析 npm audit 的 JSON 輸出：', error.message);
    process.exit(1);
  }

  const blocking = [];
  const waived = [];

  for (const [name, vuln] of Object.entries(report.vulnerabilities || {})) {
    const via = Array.isArray(vuln.via) ? vuln.via : [vuln.via];
    for (const item of via) {
      if (!item || typeof item !== 'object' || !item.url) continue; // 字串 = 間接相依，源頭會另外列出
      const id = String(item.url).split('/').pop();
      const entry = { id, name, severity: item.severity || vuln.severity, title: item.title };
      if (ACKNOWLEDGED[id]) waived.push(entry); else blocking.push(entry);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const [id, ack] of Object.entries(ACKNOWLEDGED)) {
    if (ack.reviewOn && today > ack.reviewOn) {
      console.error(`例外 ${id}（${ack.package}）已過複查日 ${ack.reviewOn}，請重新評估或升級後移除。`);
      process.exit(1);
    }
  }

  if (waived.length) {
    console.log('已評估、放行的 advisory：');
    for (const w of waived) {
      const ack = ACKNOWLEDGED[w.id];
      console.log(`  ${w.severity.toUpperCase()}  ${w.name}  ${w.id}`);
      console.log(`      ${w.title}`);
      console.log(`      理由：${ack.why}`);
      console.log(`      複查日：${ack.reviewOn}`);
    }
    console.log('');
  }

  if (blocking.length) {
    console.error('發版被擋下——以下 advisory 尚未評估：');
    for (const b of blocking) {
      console.error(`  ${String(b.severity).toUpperCase()}  ${b.name}  ${b.id}  ${b.title}`);
    }
    console.error('\n請修復、升級，或在 tools/audit-release.js 的 ACKNOWLEDGED 中');
    console.error('寫明為什麼對本專案不成立（含複查日）後再發版。');
    process.exit(1);
  }

  console.log(`audit 通過：0 個待處理 advisory${waived.length ? `（${waived.length} 個已評估放行）` : ''}。`);
}

main();
