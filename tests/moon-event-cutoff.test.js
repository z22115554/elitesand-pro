'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EVENT_END = Date.parse('2026-10-01T00:00:00+08:00');
const root = path.join(__dirname, '..');
const parseResult = (stdout) => JSON.parse(stdout.slice(stdout.lastIndexOf('__RESULT__') + '__RESULT__'.length));

test('cutoff is fixed at 2026-10-01 00:00 Taiwan time', () => {
  const moon = require('../server/services/moon-event');
  assert.equal(moon.EVENT_END, EVENT_END);
  assert.equal(moon.isActiveAt(EVENT_END - 1), true);
  assert.equal(moon.isActiveAt(EVENT_END), false);
});

test('running past the cutoff keeps the event working until the next startup', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-moon-cutoff-live-'));
  const script = `
    const realNow = Date.now;
    Date.now = () => ${EVENT_END} - 60000;
    const moon = require('./server/services/moon-event');
    const register = require('./server/routes/handlers/moon-event');
    Date.now = () => ${EVENT_END} + 3600000;
    const handlers = {};
    register({ emit() {} }, { clientType: 'controller', on: (e, fn) => { handlers[e] = fn; } });
    handlers['moon:donate']({ name: '跨過午夜', amount: 100 }, (r) => {
      process.stdout.write('__RESULT__' + JSON.stringify({ active: moon.isActive(), ok: r.ok, count: r.state && r.state.donations.length }));
      moon.saveNow();
      Date.now = realNow;
    });
  `;
  try {
    const out = parseResult(execFileSync(process.execPath, ['-e', script], {
      cwd: root, env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8',
    }));
    assert.deepEqual(out, { active: true, ok: true, count: 1 });
  } finally {
    fs.rmSync(dataDir, { recursive: true });
  }
});

test('starting after the cutoff hides the event but keeps the saved donations', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-moon-cutoff-ended-'));
  const file = path.join(dataDir, 'moon-event.json');
  const saved = JSON.stringify({
    schemaVersion: 1,
    config: { title: '中秋', goal: 5000, base: 0 },
    donations: [{ id: 'aaaaaaaa', name: '留著', amount: 300, at: 1 }],
  });
  fs.writeFileSync(file, saved);
  const script = `
    Date.now = () => ${EVENT_END} + 1000;
    const moon = require('./server/services/moon-event');
    const register = require('./server/routes/handlers/moon-event');
    const handlers = {};
    const emitted = [];
    register({ emit: (e) => emitted.push(e) }, { clientType: 'controller', on: (e, fn) => { handlers[e] = fn; } });
    const results = {};
    handlers['moon:get'](null, (r) => { results.get = r; });
    handlers['moon:donate']({ name: 'x', amount: 1 }, (r) => { results.donate = r; });
    handlers['moon:clear'](null, (r) => { results.clear = r; });
    handlers['moon:credits'](null, (r) => { results.credits = r; });
    process.stdout.write('__RESULT__' + JSON.stringify({ active: moon.isActive(), results, emitted }));
  `;
  try {
    const out = parseResult(execFileSync(process.execPath, ['-e', script], {
      cwd: root, env: { ...process.env, ELITESAND_DATA_DIR: dataDir }, encoding: 'utf8',
    }));
    assert.equal(out.active, false);
    assert.deepEqual(out.results.get, { ok: false, inactive: true });
    for (const key of ['donate', 'clear', 'credits']) {
      assert.equal(out.results[key].ok, false);
      assert.equal(out.results[key].inactive, true);
    }
    assert.deepEqual(out.emitted, []);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
  } finally {
    fs.rmSync(dataDir, { recursive: true });
  }
});
