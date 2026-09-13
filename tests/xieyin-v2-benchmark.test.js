'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const fixturePath = path.join(__dirname, 'fixtures', 'japanese-xieyin-v2-benchmark.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('日文 xieyin v2 benchmark fixture 具備可重跑的高風險案例覆蓋', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.provider, 'haqumei');
  assert.equal(fixture.providerVersion, '0.12.0');
  assert.equal(fixture.expectedStatus, 'provisional-maintainer-candidate');
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length >= 20);

  const ids = new Set();
  const tags = new Set();
  for (const item of fixture.cases) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(item.id), `benchmark id 不可重複: ${item.id}`);
    ids.add(item.id);
    assert.ok(typeof item.text === 'string' && item.text.length > 0);
    assert.ok(Array.isArray(item.tags) && item.tags.length > 0);
    item.tags.forEach((tag) => tags.add(tag));
    assert.ok(Object.prototype.hasOwnProperty.call(item, 'expectedXieyin'));
    if (item.expectedXieyin !== null) assert.ok(item.expectedXieyin.length > 0);
  }

  for (const required of ['basic', 'kanji', 'katakana', 'particle', 'geminate', 'long-vowel', 'nasal', 'palatalized', 'foreign', 'word-boundary', 'punctuation', 'mixed-english', 'numeric', 'safety-gate']) {
    assert.ok(tags.has(required), `benchmark 缺少分類: ${required}`);
  }
});
