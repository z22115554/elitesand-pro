'use strict';

/**
 * NEW 標記（public/js/new-badges.js）：每個 data-new-feature 的代號都要在 FEATURES 登記上線日期，
 * 否則標記永遠不會出現（新功能會被漏標）。
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

function register({ test, ok }) {
  test('NEW 標記：用到的功能代號都已在 new-badges.js 登記日期', () => {
    const registry = fs.readFileSync(path.join(PUBLIC, 'js', 'new-badges.js'), 'utf8');
    const block = registry.slice(registry.indexOf('const FEATURES = {'), registry.indexOf('};', registry.indexOf('const FEATURES = {')));
    const registered = new Set([...block.matchAll(/'([a-z0-9-]+)':\s*'\d{4}-\d{2}-\d{2}'/g)].map((m) => m[1]));
    const sources = [path.join(PUBLIC, 'index.html'), ...fs.readdirSync(path.join(PUBLIC, 'js')).map((f) => path.join(PUBLIC, 'js', f))]
      .filter((f) => /\.(html|js)$/.test(f) && !f.endsWith('new-badges.js'));
    const used = new Set();
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/data-new-feature="([a-z0-9-]+)"/g)) used.add(m[1]);
      for (const m of text.matchAll(/dataset\.newFeature\s*=\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
    }
    ok(used.size > 0, '應找得到使用 NEW 標記的元素');
    const missing = [...used].filter((id) => !registered.has(id));
    ok(!missing.length, `沒有登記上線日期的功能代號：${missing.join(', ')}`);
  });
}

module.exports = { register };
