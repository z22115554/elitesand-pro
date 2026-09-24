'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-moon-lanterns-'));
process.env.ELITESAND_DATA_DIR = dataDir;
fs.writeFileSync(path.join(dataDir, 'moon-event.json'), JSON.stringify({
  schemaVersion: 1,
  config: { title: '舊存檔', goal: 5000, base: 0 },
  donations: [{ id: 'aaaaaaaa', name: '舊資料', amount: 600, at: 1 }],
}));
const moon = require('../server/services/moon-event');

test('lantern style follows amount tiers, honors manual picks, and survives old saves', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const legacy = moon.snapshot();
  assert.deepEqual(legacy.tiers, moon.DEFAULT_TIERS);
  assert.equal(legacy.donations[0].style, 'palace');
  assert.equal(legacy.donations[0].styleAuto, true);

  const styleOf = (amount, style) => moon.addDonation({ name: 'x', amount, style }).state.donations.at(-1);
  assert.equal(styleOf(50).style, 'paper');
  assert.equal(styleOf(100).style, 'red');
  assert.equal(styleOf(999).style, 'palace');
  assert.equal(styleOf(1000).style, 'rabbit');

  const manual = styleOf(10, 'rabbit');
  assert.equal(manual.style, 'rabbit');
  assert.equal(manual.styleAuto, false);
  assert.equal(styleOf(10, 'not-a-style').style, 'paper');

  assert.equal(moon.setConfig({ tiers: { rabbit: 50, red: -5 } }).ok, true);
  assert.equal(moon.snapshot().tiers.rabbit, 50);
  assert.equal(moon.snapshot().tiers.red, 100);
  assert.equal(styleOf(60).style, 'rabbit');

  assert.equal(moon.setConfig({ title: '只改標題' }).ok, true);
  assert.equal(moon.snapshot().tiers.rabbit, 50);

  assert.equal(moon.saveNow(), true);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'moon-event.json'), 'utf8'));
  assert.equal(saved.donations.find((d) => d.name === '舊資料').style, undefined);
  assert.equal(saved.config.tiers.rabbit, 50);
});
