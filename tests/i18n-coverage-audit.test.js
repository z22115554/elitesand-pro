'use strict';

// 2026-11-13 i18n 稽核的回歸測試：控制面板會直接顯示的訊息（含伺服器回傳的錯誤）
// 要在五種語言都翻得出來；介面文字改字時，對應的長尾翻譯也要跟著改。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const i18n = require('../public/js/i18n');
const LOCALES = ['en', 'ja', 'ko', 'zh-CN'];

function assertTranslates(text) {
  for (const locale of LOCALES) {
    i18n.setLocale(locale, { persist: false, updateQuery: false });
    const translated = i18n.translate(text);
    assert.notEqual(translated, text, `${locale} 沒有翻譯：${text}`);
  }
  i18n.setLocale('zh-TW', { persist: false, updateQuery: false });
}

test('歌詞拖放提示改字後，翻譯要跟著對得上', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const hint = html.match(/<div class="sub m-0">(拖放 [^<]+覆蓋目前歌詞)<\/div>/);
  assert.ok(hint, 'index.html 找不到歌詞拖放提示');
  assertTranslates(hint[1]);
});

test('伺服器回給面板的常見錯誤訊息五種語言都有翻譯', () => {
  for (const text of [
    '請提供有效的 YouTube 連結',
    '請上傳至少一個音訊檔案',
    '無法解析歌詞內容，請確認格式正確',
    '播放清單已達 2000 首上限',
    '需要正確的 PIN 才能執行此操作',
    '這首歌已不在媒體庫裡，無法加入播放清單',
    '無法取得影片資訊。可能需要 cookies 認證，請參考 yt-dlp 文件設定 cookies。',
    '目前只在直播期間接受點歌',
    '磁碟空間不足：需要約 3GB，目前可用約 512MB。請清出空間後再試一次。',
  ]) assertTranslates(text);
});

test('控制面板動態訊息（含變數）五種語言都有翻譯', () => {
  for (const text of [
    '「Lemon」分離完成，已改用伴奏軌播放',
    '已加入 BGM 清單：Song A',
    '已驗證並套用「Noto Sans TC」本機字型',
    'OBS 正在推流；直播 Session 已自動同步（已開台 01:02:03）。',
    '要設定 PIN 嗎？',
    '已讀',
  ]) assertTranslates(text);
});
