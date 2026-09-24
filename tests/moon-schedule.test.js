'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-moon-schedule-'));
process.env.ELITESAND_DATA_DIR = dataDir;
const moon = require('../server/services/moon-event');

test('activity schedule is validated, preserved by older config updates, and saved with donations', async (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const startAt = new Date(Date.now() + 60000).toISOString();
  const endAt = new Date(Date.now() + 120000).toISOString();

  assert.equal(moon.setConfig({ startAt, endAt }).ok, true);
  assert.equal(moon.setConfig({ title: '新的活動標題' }).ok, true);
  assert.equal(moon.snapshot().startAt, startAt);
  assert.equal(moon.snapshot().endAt, endAt);
  assert.equal(moon.setConfig({ startAt: endAt, endAt: startAt }).ok, false);
  assert.equal(moon.snapshot().endAt, endAt);

  assert.equal(moon.addDonation({ name: '觀眾', amount: 100 }).ok, true);
  assert.equal(moon.saveNow(), true);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'moon-event.json'), 'utf8'));
  assert.equal(saved.config.startAt, startAt);
  assert.equal(saved.config.endAt, endAt);
  assert.equal(saved.donations.length, 1);

  assert.equal(moon.setConfig({ startAt: null, endAt: null }).ok, true);
  assert.equal(moon.snapshot().startAt, null);
  assert.equal(moon.snapshot().endAt, null);
  assert.equal(moon.snapshot().donations.length, 1);
  assert.equal(moon.saveNow(), true);

  const shortStart = new Date(Date.now() - 1000).toISOString();
  const shortEnd = new Date(Date.now() + 80).toISOString();
  assert.equal(moon.setConfig({ startAt: shortStart, endAt: shortEnd }).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(moon.isExpired(), true);
  assert.equal(moon.snapshot().expired, true);
  assert.equal(moon.setConfig({ startAt: null, endAt: null }).ok, false);
  assert.equal(moon.addDonation({ name: '太晚了', amount: 1 }).ok, false);
  assert.equal(moon.removeDonation(moon.snapshot().donations[0].id).ok, false);
  assert.equal(moon.clearDonations().ok, false);
  assert.equal(moon.snapshot().donations.length, 1);
  assert.equal(moon.saveNow(), true);
});
