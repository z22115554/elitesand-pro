'use strict';

/**
 * 日文 xieyin v2 Phase 1 A/B benchmark。
 *
 * 預設只輸出 JSON，不寫入 repo；Haqumei runtime 用 ELITESAND_G2P_PYTHON
 * 指定。provider 不可用時回傳明確的 unavailable 報告並以 exit 2 結束，
 * 讓 CI／人工驗收不會把「沒有跑到 G2P」誤認成通過。
 */
const fs = require('fs');
const path = require('path');
const { JapaneseG2PProvider } = require('../server/services/japanese-g2p-provider');
const { japaneseReadingAnalysis } = require('../server/services/romanizer');
const { romajiToXieyin } = require('../server/services/xieyin');
const { phonemesToXieyinV2 } = require('../server/services/xieyin-v2-mapper');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'japanese-xieyin-v2-benchmark.json');

function parseArgs(argv) {
  const out = { timeoutMs: 30000, outputPath: '' };
  for (const arg of argv) {
    if (arg.startsWith('--timeout-ms=')) out.timeoutMs = Math.max(1000, Number.parseInt(arg.slice(13), 10) || out.timeoutMs);
    if (arg.startsWith('--output=')) out.outputPath = arg.slice(9);
  }
  return out;
}

function writeReport(report, outputPath) {
  const text = JSON.stringify(report, null, 2) + '\n';
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), text, 'utf8');
  else process.stdout.write(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const provider = new JapaneseG2PProvider();
  let g2pRows;
  try {
    g2pRows = await provider.g2pBatch(fixture.cases.map((item) => item.text), { timeoutMs: args.timeoutMs });
  } catch (error) {
    writeReport({
      schemaVersion: 1,
      status: 'unavailable',
      provider: fixture.provider,
      providerVersion: fixture.providerVersion,
      expectedStatus: fixture.expectedStatus,
      error: { code: error.code || 'ENGINE_ERROR', message: error.message },
      cases: [],
    }, args.outputPath);
    process.exitCode = 2;
    return;
  } finally {
    await provider.stop();
  }

  const rows = [];
  for (let i = 0; i < fixture.cases.length; i += 1) {
    const item = fixture.cases[i];
    const legacy = await japaneseReadingAnalysis(item.text);
    const legacyXieyin = romajiToXieyin(legacy.phonetic);
    const g2p = g2pRows[i] || { phonemes: [], kana: '' };
    const v2Xieyin = phonemesToXieyinV2(g2p.phonemes);
    const expected = item.expectedXieyin;
    let classification = 'needs-human-review';
    if (expected === null) {
      classification = v2Xieyin === legacyXieyin ? 'safety-preserved' : 'safety-gate-required';
    } else if (v2Xieyin === expected) {
      classification = legacyXieyin === expected ? 'same-as-legacy' : 'candidate-match';
    } else {
      classification = 'candidate-mismatch';
    }
    rows.push({
      id: item.id,
      text: item.text,
      tags: item.tags,
      expectedKana: item.expectedKana,
      actualKana: g2p.kana,
      expectedXieyin: expected,
      legacyPhonetic: legacy.phonetic,
      legacyXieyin,
      phonemes: g2p.phonemes,
      v2Xieyin,
      classification,
      notes: item.notes || '',
    });
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.classification] = (acc[row.classification] || 0) + 1;
    return acc;
  }, {});
  writeReport({
    schemaVersion: 1,
    status: 'complete',
    provider: fixture.provider,
    providerVersion: fixture.providerVersion,
    expectedStatus: fixture.expectedStatus,
    generatedAt: new Date().toISOString(),
    summary: { total: rows.length, classifications: counts },
    cases: rows,
  }, args.outputPath);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
