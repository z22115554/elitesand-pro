'use strict';

/**
 * Windows 關機／重開／登出時的「上次未正常關閉」誤報（electron/shell.js settleSessionMarkerSync）。
 *
 * Electron 在系統結束工作階段時不觸發 before-quit，自己啟動的伺服器會被直接終止。
 * 殼在 session-end 同步等伺服器寫完乾淨標記，逾時才代寫；代寫的標記必須讓下次啟動判定為乾淨。
 */

const path = require('path');
const { settleSessionMarkerSync } = require('../electron/shell');
const sessionMarker = require('../server/services/session-marker');

function fakeFs(initial) {
  const files = new Map(Object.entries(initial || {}));
  return {
    files,
    readFileSync: (file) => { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); },
    writeFileSync: (file, data) => { files.set(file, String(data)); },
    mkdirSync: () => {},
  };
}

function clock() {
  let t = 1000;
  return { now: () => t, sleepSync: (ms) => { t += ms; } };
}

function register({ test, eq, ok }) {
  const marker = path.join('data', '.session-marker');

  test('系統結束工作階段：伺服器已寫好乾淨標記就不代寫', () => {
    const fsImpl = fakeFs({ [marker]: JSON.stringify({ clean: true, reason: 'parent-message' }) });
    const c = clock();
    eq(settleSessionMarkerSync(marker, { fsImpl, ...c }), 'server');
    eq(JSON.parse(fsImpl.files.get(marker)).reason, 'parent-message');
  });

  test('系統結束工作階段：等到伺服器在期限內寫完就用它的標記', () => {
    const fsImpl = fakeFs({ [marker]: JSON.stringify({ clean: false, startedAt: 5 }) });
    const c = clock();
    let polls = 0;
    const sleepSync = (ms) => { c.sleepSync(ms); if (++polls === 3) fsImpl.writeFileSync(marker, JSON.stringify({ clean: true, reason: 'parent-message' })); };
    eq(settleSessionMarkerSync(marker, { fsImpl, now: c.now, sleepSync }), 'server');
    eq(polls, 3);
  });

  test('系統結束工作階段：伺服器來不及回應時殼代寫，下次啟動不當成當機', () => {
    const fsImpl = fakeFs({ [marker]: JSON.stringify({ clean: false, startedAt: 5, version: '1.1.1' }) });
    const c = clock();
    eq(settleSessionMarkerSync(marker, { fsImpl, timeoutMs: 2000, ...c }), 'shell');
    const written = JSON.parse(fsImpl.files.get(marker));
    eq(written.clean, true);
    eq(written.reason, 'os-session-end');
    eq(written.startedAt, 5, '保留原本的啟動時間，診斷時看得出是哪一輪');
    ok(c.now() - 1000 >= 2000 && c.now() - 1000 < 2100, '等滿期限才代寫');

    // 下次啟動讀到這個標記 → 判定乾淨關閉
    sessionMarker._resetForTests();
    const state = sessionMarker.markStarted({ fs: fakeFs({ [marker]: fsImpl.files.get(marker) }), file: marker, now: () => 9999 });
    if (!state.disabled) {
      eq(state.wasClean, true);
      eq(state.previousReason, 'os-session-end');
    }
    sessionMarker._resetForTests();
  });
}

module.exports = { register };
