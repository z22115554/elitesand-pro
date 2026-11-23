'use strict';
// 已分離歌曲：「音量」拉桿只管伴奏、人聲只看「人聲」拉桿（使用者 2026-11-23 確認），
// 唯一例外是靜音：按靜音時人聲一起關。拉桿手動拉到 0 是「關伴奏、留人聲」，不是靜音。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/app-playback.js'), 'utf8');

test('人聲總增益不跟伴奏音量走，只跟靜音狀態', () => {
  assert.doesNotMatch(src, /vocalsMasterGain\.gain\.value\s*=\s*vol\b/, '不可把伴奏音量套到人聲');
  assert.doesNotMatch(src, /vocalsMasterGain\.gain\.value\s*=\s*stGain/, '建立人聲鏈時也不可沿用伴奏音量');
  const assignments = src.match(/vocalsMasterGain\.gain\.value\s*=\s*[^;]+;/g) || [];
  assert.ok(assignments.length >= 2, '建立人聲鏈與調音量時都要設定');
  for (const a of assignments) assert.match(a, /isVolumeMuted\(\) \? 0 : 1/, a);
});

test('靜音的判斷：按過靜音且拉桿在 0；手動拖拉桿就解除', () => {
  const fn = src.match(/function isVolumeMuted\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, '要有 isVolumeMuted()');
  assert.match(fn[0], /volumeBeforeMute !== null/);
  assert.match(fn[0], /=== 0/);
  // 靜音先記住音量再歸零，input 事件裡 isVolumeMuted() 才會是 true
  const toggle = src.match(/function toggleMute\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(toggle.indexOf('volumeBeforeMute = current') < toggle.indexOf('setVolumeTransient(0)'));
  // 手動拖拉桿（非 setVolumeTransient）會清掉靜音狀態
  assert.match(src, /if \(!transientVolumeChange\) volumeBeforeMute = null;/);
});
