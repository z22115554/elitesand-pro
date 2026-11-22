'use strict';
// 歌曲庫「升級逐字歌詞」：伺服器每首要把歌詞來源問一輪（實測 8～12 秒），
// 用 sendWithCallback 預設的 8 秒會每首都跳「伺服器回應逾時」並提早送出下一首。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../public/js/media-library.js'), 'utf8');

test('批次升級逐字歌詞的等待上限遠大於一輪來源查詢', () => {
  const call = source.match(/sendWithCallback\('library:upgrade-word-lyrics'[\s\S]*?\);/);
  assert.ok(call, '找得到升級逐字的呼叫');
  assert.match(call[0], /timeoutMs: WORD_UPGRADE_TIMEOUT_MS/);
  const limit = Number(source.match(/const WORD_UPGRADE_TIMEOUT_MS = (\d+)/)[1]);
  assert.ok(limit >= 60000, `至少一分鐘，實際 ${limit}`);
});

test('sendWithCallback 有吃 timeoutMs（不然上面的設定沒有用）', () => {
  const client = fs.readFileSync(path.join(__dirname, '../public/js/socket-client.js'), 'utf8');
  assert.match(client, /function sendWithCallback\(event, data, callback, \{ timeoutMs = 8000 \} = \{\}\)/);
});
