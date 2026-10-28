'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../tools/audit-release.js'), 'utf8');
const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };

function run(reports) {
  let status = 0, calls = 0;
  const output = [];
  try {
    vm.runInNewContext(source, {
      require(name) {
        assert.equal(name, 'child_process');
        return { execSync() {
          const report = reports[Math.min(calls++, reports.length - 1)];
          if (report.fail) throw Object.assign(new Error('npm exited nonzero'), { status: report.status || 1, stdout: report.stdout });
          return typeof report === 'string' ? report : JSON.stringify(report);
        } };
      },
      process: { exit(code) { status = code; throw new Error('EXIT'); } },
      console: { log: (...args) => output.push(args.join(' ')), error: (...args) => output.push(args.join(' ')) },
    });
  } catch (error) { if (error.message !== 'EXIT') throw error; }
  return { status, output: output.join('\n'), calls };
}

test('valid empty production and Electron reports pass', () => {
  assert.equal(run([clean]).status, 0);
});

test('npm registry errors must never be reported as zero advisories', () => {
  const error = { fail: true, stdout: JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'registry unavailable' } }) };
  for (const reports of [[error], [clean, error]]) {
    const result = run(reports);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.output, /audit 通過/);
  }
});

test('missing, malformed and unsupported reports fail closed', () => {
  for (const report of [{}, null, [], { ...clean, vulnerabilities: [] }, { ...clean, auditReportVersion: 1 }, 'not json']) {
    assert.equal(run([report]).status, 1, JSON.stringify(report));
  }
});

test('a real nonzero advisory report still blocks the release', () => {
  const report = { ...clean, vulnerabilities: { qs: { severity: 'moderate', via: [{ url: 'https://github.com/advisories/GHSA-test', severity: 'moderate', title: 'Fixture' }] } } };
  const result = run([{ fail: true, stdout: JSON.stringify(report) }]);
  assert.equal(result.status, 1);
  assert.match(result.output, /GHSA-test/);
});
