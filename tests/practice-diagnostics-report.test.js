'use strict';

// 問題回報的練唱診斷：只收數字與封閉值，其他類型不帶，關掉診斷就不帶。
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-practice-report-'));
process.env.ELITESAND_DATA_DIR = path.join(root, 'data');
process.env.ELITESAND_DOWNLOADS_DIR = path.join(root, 'downloads');
process.env.ELITESAND_LOGS_DIR = path.join(root, 'logs');
const report = require('../server/services/feedback-report');
const telemetry = require('../server/services/telemetry-fields');

const form = (extra) => ({ schemaVersion: 1, type: 'practice', title: '練唱判定不準', description: '副歌明明有唱，畫面卻一直沒有線',
  steps: ['唱副歌'], actual: '沒線', expected: '', contact: '', includeDiagnostics: true, locale: 'zh-TW', ...extra });
const row = [12.34, 440.04, 0.991, 0.95, 0.01234, 0.00123, 69.01, 69.12];
const data = { rows: [row], scoreMode: 'strict', allowOctave: true, key: 2, tuning: 0.12, score: 81.26, algorithm: 'torchcrepe-tiny-cuda',
  algorithmVersion: 'practice-pitch-8', sampleRate: 48000, gainDb: 6, echoCancel: false, calibrationMs: 120 };

test('practice report carries rebuilt numeric rows', () => {
  const built = report.buildReport(form({ practiceDiagnostics: data }));
  assert.equal(built.ok, true);
  assert.match(built.report.issueBody, /## 練唱診斷資料/);
  assert.match(built.report.issueBody, /12\.34,440,0\.99,0\.95,0\.0123,0\.0012,69\.01,69\.12/);
  assert.match(built.report.issueBody, /評分模式：strict/);
  assert.ok(built.report.issueLabels.includes('type:bug'), 'the relay only accepts labels it already knows');
});

test('anything that is not a number or a closed value never reaches the issue', () => {
  const clean = report.sanitizePracticeDiagnostics({ ...data, title: 'secret song', algorithm: 'C:/Users/name',
    rows: [row, ['x', 1, 1, 1, 1, 1, 1, 1], [1, 2], [1, 99999, 1, 1, 1, 1, 1, 1], [NaN, 1, 1, 1, 1, 1, 1, 1]] });
  assert.equal(clean.rows.length, 1);
  assert.equal(clean.algorithm, '');
  assert.equal(clean.title, undefined);
  assert.equal(report.sanitizePracticeDiagnostics({ rows: 'x' }), null);
  const tooMany = report.sanitizePracticeDiagnostics({ rows: Array.from({ length: 1000 }, () => row) });
  assert.equal(tooMany.rows.length, 300);
});

test('other report types and opting out of diagnostics carry nothing', () => {
  const other = report.buildReport(form({ type: 'other', practiceDiagnostics: data }));
  assert.doesNotMatch(other.report.issueBody, /練唱診斷資料/);
  const off = report.buildReport(form({ includeDiagnostics: false, practiceDiagnostics: data }));
  assert.doesNotMatch(off.report.issueBody, /練唱診斷資料/);
  const empty = report.buildReport(form());
  assert.match(empty.report.issueBody, /沒有可附上的麥克風演唱資料/);
});

test('verdict and strict score keys need the 2.2.0 disclosure and match the EULA', () => {
  assert.equal(telemetry.disclosedSince('practice.verdict.strict.inaccurate'), '2.2.0');
  assert.equal(telemetry.disclosedSince('practice.strict.score.85-90'), '2.2.0');
  assert.equal(telemetry.disclosedSince('practice.score.85-90'), '2.1.0');
  for (const key of ['practice.verdict.relaxed.accurate', 'practice.verdict.strict.inaccurate', 'practice.strict.score.ge99']) assert.ok(telemetry.ALLOWED_KEYS.includes(key), key);
  assert.equal(telemetry.isDailyBooleanKey('practice.verdict.relaxed.accurate'), false);
  const eula = fs.readFileSync(path.join(__dirname, '..', 'EULA.txt'), 'utf8');
  assert.match(eula, /^Version: 2\.2\.0/m);
  assert.ok(eula.includes('(h) 自本版（2.2.0）起') && eula.includes('(h) From this version (2.2.0)'));
  assert.ok(eula.includes('練唱判定問題') && eula.includes('practice judging problem'));
});
