'use strict';
/**
 * 由欄位登錄表產生 docs/DATA-FIELDS.md。
 * 改了 server/services/telemetry-fields.js 之後執行：
 *   node tools/gen-data-fields.js
 * 別手改 docs/DATA-FIELDS.md——那是產物，不是事實來源。
 */
const fs = require('fs');
const path = require('path');
const f = require('../server/services/telemetry-fields');
const t = require('../server/services/usage-telemetry');

const out = [];
const w = (s) => out.push(s);
w('# 遙測欄位表（自動產生，請勿手改）');
w('');
w('由 `node tools/gen-data-fields.js` 從 `server/services/telemetry-fields.js` 產生。');
w('這份表是寫 EULA 條文時的依據；`tests/telemetry-daily.test.js` 會確保用戶端與');
w('接收端（`cloudflare/usage-worker/src/index.ts`）的白名單逐字一致。');
w('');
w(`- 揭露版本門檻：**EULA ${t.DAILY_DISCLOSED_EULA_VERSION}**（同意版本低於此值時一個位元組都不送）`);
w(`- 欄位總數：**${f.ALLOWED_KEYS.length}**`);
w(`- 單一計數上限：${f.MAX_COUNTER_VALUE}`);
w('');
w('## 絕不蒐集');
w('');
w('歌名、歌詞內容、播放清單、YouTube 影片 ID、檔名、檔案路徑、網址、');
w('錯誤訊息原文、堆疊、帳號憑證、電腦名稱、精確 GPU 型號、精確秒數、事件時間戳。');
w('');

const groups = [
  ['當日是否使用過某功能', f.FEATURES.map((n) => `feature.${n}`)],
  ['成功／失敗率（attempt 是分母）', f.OUTCOME_FAMILIES.flatMap((fam) => [
    `${fam}.attempt`, `${fam}.ok`, ...f.ERROR_CODES[fam].map((c) => `${fam}.fail.${c}`),
  ])],
  ['歌詞來源命中率', [
    ...f.LYRIC_SOURCES.flatMap((s) => [`lyrics.source.${s}.hit`, `lyrics.source.${s}.miss`]),
    'lyrics.auto_result_edited',
  ]],
  ['直播期間高風險事件', [
    ...f.INCIDENTS.map((n) => `incident.${n}`),
    ...f.COUNT_BUCKETS.map((b) => `incident.socket_reconnect.${b}`),
  ]],
  ['依賴與更新健康度', [
    ...f.DEPENDENCIES.flatMap((d) => [`dep.${d}_ok`, `dep.${d}_missing`]),
    'update.ok', 'update.failed',
  ]],
  ['AI 分離（硬體一律分桶）', [
    ...f.AI_BACKENDS.map((b) => `ai.backend.${b}`),
    ...f.GPU_VENDORS.map((v) => `ai.gpu.${v}`),
    ...f.VRAM_BUCKETS.map((v) => `ai.vram.${v}`),
    ...f.RTF_BUCKETS.map((v) => `ai.rtf.${v}`),
    ...f.DURATION_BUCKETS.map((v) => `ai.duration.${v}`),
    'ai.fallback_to_cpu',
  ]],
];

let total = 0;
for (const [title, keys] of groups) {
  w(`## ${title}（${keys.length}）`);
  w('');
  for (const key of keys) w(`- \`${key}\``);
  w('');
  total += keys.length;
}
w('---');
w('');
w(total === f.ALLOWED_KEYS.length
  ? `分組合計 ${total} 項，與登錄表一致。`
  : `分組合計 ${total} 項，**與登錄表 ${f.ALLOWED_KEYS.length} 項不符，請檢查**。`);

const target = path.join(__dirname, '..', 'docs', 'DATA-FIELDS.md');
fs.writeFileSync(target, `${out.join('\n')}\n`, 'utf8');
console.log(`已產生 ${target}（${f.ALLOWED_KEYS.length} 個欄位）`);

// 順便把 worker 的封閉白名單也同步——這是唯一事實來源該做的事：
// 改 telemetry-fields.js 之後跑這一個指令，docs 與 worker 就不會漂移。
const workerPath = path.join(__dirname, '..', 'cloudflare', 'usage-worker', 'src', 'index.ts');
let workerSource = fs.readFileSync(workerPath, 'utf8');
const keyLiteral = f.ALLOWED_KEYS.map((k) => JSON.stringify(k)).join(',\n  ');
const keysPattern = /(ALLOWED_COUNTER_KEYS[^=]*=\s*new Set\(\s*\[)[\s\S]*?(\]\s*\))/;
if (!keysPattern.test(workerSource)) {
  throw new Error('在 worker 找不到 ALLOWED_COUNTER_KEYS，無法同步——請確認 index.ts 結構沒變');
}
workerSource = workerSource.replace(keysPattern, `$1\n  ${keyLiteral}\n$2`);
workerSource = workerSource.replace(/MAX_COUNTER_VALUE = \d+;/, `MAX_COUNTER_VALUE = ${f.MAX_COUNTER_VALUE};`);
fs.writeFileSync(workerPath, workerSource, 'utf8');
console.log(`已同步 ${workerPath} 的白名單（${f.ALLOWED_KEYS.length} 個欄位）`);
