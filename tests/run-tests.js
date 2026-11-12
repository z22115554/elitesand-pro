/**
 * Elitesand Pro 自動化測試套件（核心回歸測試入口）
 * 執行：npm test
 *
 * 測試依功能區分在 tests/core-NN-*.js，共用的隔離環境與 test／ok／eq 工具在 tests/core-harness.js。
 * 這裡只負責照順序載入，最後統一印出結果。新增測試請加到對應功能區的檔案。
 */
const harness = require('./core-harness');

require('./core-01-core');
require('./core-02-xieyin-romanizer');
require('./core-03-time-lrc-deck');
require('./core-04-lyrics-cache-decoders');
require('./core-05-updates');
require('./core-06-config-state');
require('./core-07-lyrics-settings');
require('./core-08-lyrics-cleaner-import');
require('./core-09-security-boundary');
require('./core-10-security-boundary-2');
require('./core-11-security-boundary-3');
require('./core-12-youtube-flow');
require('./core-13-playback-sync');
require('./core-14-playback-sync-2');
require('./core-15-playback-sync-3');
require('./core-16-eula');
require('./core-17-i18n');
require('./core-18-packaging-templates');
require('./core-19-templates-overlay');
require('./core-20-alert-show');

harness.finishAll();
