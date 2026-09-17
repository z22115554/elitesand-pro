'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const playbackPath = path.join(root, 'public', 'js', 'app-playback.js');
const testsPath = path.join(root, 'tests', 'run-tests.js');

function replaceExact(source, label, from, to) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`patch anchor missing: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`patch anchor duplicated: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

let playback = fs.readFileSync(playbackPath, 'utf8');

playback = replaceExact(
  playback,
  'dual routing state',
  `  let dualStreamMediaDest = null, dualStreamAudioEl = null;\n  let dualRoutingWired = false; // stGain/vocalsGain 目前是接到雙路節點還是直接接 stCtx.destination\n`,
  `  let dualStreamMediaDest = null, dualStreamAudioEl = null;\n  let dualRoutingWired = false; // stGain/vocalsGain 目前是接到雙路節點還是直接接 stCtx.destination\n  // 兩個實體輸出裝置的切換是非同步的。雙路模式啟用期間把輸出鏈保持 warm，並把\n  // setSinkId()/play() 串成單一序列：第一首歌會等裝置真正就緒才起播，快速換裝置時也\n  // 保證最後一次設定最後落地，不會被較慢完成的舊 Promise 蓋回去。\n  let dualSinkGeneration = 0;\n  let dualSinkApplyChain = Promise.resolve(false);\n  let dualSinkReadyPromise = null;\n  let dualSinkPendingKey = '';\n  let dualSinkAppliedKey = '';\n`,
);

playback = replaceExact(
  playback,
  'dual sink apply',
  `  /** 套用觀眾/耳機兩個裝置的 setSinkId；裝置可能已拔除或使用者還沒選，一律靜默失敗。 */\n  async function applyDualDeviceSinks() {\n    if (!stCtx) return;\n    if (dualHeadphoneDeviceId && typeof stCtx.setSinkId === 'function') {\n      try { await stCtx.setSinkId(dualHeadphoneDeviceId); } catch (e) { /* 靜默 */ }\n    }\n    if (dualStreamAudioEl) {\n      if (dualStreamDeviceId && dualStreamAudioEl.setSinkId) {\n        try { await dualStreamAudioEl.setSinkId(dualStreamDeviceId); } catch (e) { /* 靜默 */ }\n      }\n      try { await dualStreamAudioEl.play(); } catch (e) { /* 靜默：可能撞上 autoplay 限制 */ }\n    }\n  }\n`,
  `  function dualSinkKey() {\n    return JSON.stringify([dualHeadphoneDeviceId, dualStreamDeviceId]);\n  }\n\n  /** 真正套用一次兩個輸出裝置。呼叫端用 generation 保證舊請求不會覆蓋新裝置。 */\n  async function applyDualDeviceSinksNow(generation, key) {\n    if (!stCtx || !dualStreamAudioEl || generation !== dualSinkGeneration || !dualAudioModeEnabled) return false;\n    let ok = true;\n    try {\n      if (stCtx.state === 'suspended') await stCtx.resume();\n    } catch (e) { ok = false; }\n    if (generation !== dualSinkGeneration || !dualAudioModeEnabled) return false;\n\n    if (dualHeadphoneDeviceId && typeof stCtx.setSinkId === 'function') {\n      try { await stCtx.setSinkId(dualHeadphoneDeviceId); } catch (e) { ok = false; }\n    }\n    if (generation !== dualSinkGeneration || !dualAudioModeEnabled) return false;\n\n    if (dualStreamDeviceId && typeof dualStreamAudioEl.setSinkId === 'function') {\n      try { await dualStreamAudioEl.setSinkId(dualStreamDeviceId); } catch (e) { ok = false; }\n    }\n    if (generation !== dualSinkGeneration || !dualAudioModeEnabled) return false;\n\n    try { await dualStreamAudioEl.play(); } catch (e) { ok = false; }\n    const current = generation === dualSinkGeneration && dualAudioModeEnabled;\n    if (current && ok) dualSinkAppliedKey = key;\n    if (!current && !dualAudioModeEnabled && dualStreamAudioEl) {\n      try { dualStreamAudioEl.pause(); } catch (e) { /* 靜默 */ }\n    }\n    return current && ok;\n  }\n\n  /**\n   * 將裝置切換排進同一條 Promise chain。已經 warm 的相同裝置直接回傳；同一組正在\n   * 初始化的裝置也共用同一個 Promise，避免每次 playTrack 都重新 setSinkId。\n   */\n  function applyDualDeviceSinks({ force = false } = {}) {\n    if (!dualAudioModeEnabled) return Promise.resolve(false);\n    ensureDualAudioRouting();\n    if (!stCtx || !dualStreamAudioEl) return Promise.resolve(false);\n\n    const key = dualSinkKey();\n    if (!force && dualSinkAppliedKey === key && !dualStreamAudioEl.paused) return Promise.resolve(true);\n    if (!force && dualSinkReadyPromise && dualSinkPendingKey === key) return dualSinkReadyPromise;\n\n    const generation = ++dualSinkGeneration;\n    dualSinkPendingKey = key;\n    const run = dualSinkApplyChain\n      .catch(() => false)\n      .then(() => applyDualDeviceSinksNow(generation, key));\n    let tracked = null;\n    tracked = run.then(\n      (value) => {\n        if (dualSinkReadyPromise === tracked) {\n          dualSinkReadyPromise = null;\n          dualSinkPendingKey = '';\n        }\n        return value;\n      },\n      () => {\n        if (dualSinkReadyPromise === tracked) {\n          dualSinkReadyPromise = null;\n          dualSinkPendingKey = '';\n        }\n        return false;\n      },\n    );\n    dualSinkApplyChain = tracked;\n    dualSinkReadyPromise = tracked;\n    return tracked;\n  }\n\n  /** 雙路歌曲真正起播前的 readiness gate；已 warm 時同步進入 resolved Promise。 */\n  function ensureDualAudioReady(options = {}) {\n    if (!dualAudioModeEnabled) return Promise.resolve(true);\n    wireDualRouting(true);\n    return applyDualDeviceSinks(options);\n  }\n`,
);

playback = replaceExact(
  playback,
  'wire active sink fire and forget',
  `      applyDualDeviceSinks();\n    } else {\n      dualRoutingWired = false;\n      stopDualAudioClickTest(); // 雙路拆線後 click 只會到預設裝置，沒意義，一併停掉\n`,
  `    } else {\n      // 只有真的關閉雙路模式才拆輸出；一般歌曲播完會保留這條 routing，下一首直接沿用\n      // 已 warm 的裝置，不再讓 Windows/Chromium 每首歌重新建立兩條輸出時鐘。\n      ++dualSinkGeneration;\n      dualSinkAppliedKey = '';\n      dualSinkPendingKey = '';\n      dualSinkReadyPromise = null;\n      if (dualStreamAudioEl) { try { dualStreamAudioEl.pause(); } catch (e) { /* 靜默 */ } }\n      dualRoutingWired = false;\n      stopDualAudioClickTest(); // 雙路拆線後 click 只會到預設裝置，沒意義，一併停掉\n`,
);

playback = replaceExact(
  playback,
  'dual mode and devices',
  `  function setDualAudioMode(enabled) {\n    dualAudioModeEnabled = !!enabled;\n    try { localStorage.setItem('vk-dual-audio-mode', dualAudioModeEnabled ? '1' : '0'); } catch (e) { /* 靜默 */ }\n    if (state.currentTrackIndex !== -1) {\n      // 切換輸出路由時沿用既有「重新載入到目前位置」流程，讓接線立即生效。\n      playTrack(state.currentTrackIndex, isPlaying, { notifyServer: false, startTime: lastPlayTimeMs / 1000 });\n    } else {\n      wireDualRouting(false);\n      dualAudioActive = false;\n    }\n  }\n  function setDualAudioDevices({ streamDeviceId, headphoneDeviceId } = {}) {\n    if (typeof streamDeviceId === 'string') {\n      dualStreamDeviceId = streamDeviceId;\n      try { localStorage.setItem('vk-dual-audio-stream-device', dualStreamDeviceId); } catch (e) { /* 靜默 */ }\n    }\n    if (typeof headphoneDeviceId === 'string') {\n      dualHeadphoneDeviceId = headphoneDeviceId;\n      try { localStorage.setItem('vk-dual-audio-headphone-device', dualHeadphoneDeviceId); } catch (e) { /* 靜默 */ }\n    }\n    if (dualRoutingWired) applyDualDeviceSinks(); // 播放中換裝置，立刻套用\n  }\n`,
  `  function setDualAudioMode(enabled) {\n    dualAudioModeEnabled = !!enabled;\n    try { localStorage.setItem('vk-dual-audio-mode', dualAudioModeEnabled ? '1' : '0'); } catch (e) { /* 靜默 */ }\n    if (state.currentTrackIndex !== -1) {\n      // 切換輸出路由時沿用既有「重新載入到目前位置」流程，讓接線立即生效。\n      playTrack(state.currentTrackIndex, isPlaying, { notifyServer: false, startTime: lastPlayTimeMs / 1000 });\n      return;\n    }\n\n    dualAudioActive = false;\n    if (dualAudioModeEnabled) {\n      // 即使目前沒有歌曲也先打開兩個實體輸出，讓第一首播放前就完成裝置 warm-up。\n      wireDualRouting(true);\n      ensureDualAudioReady().catch(() => { /* readiness 失敗時播放流程仍會再重試 */ });\n    } else {\n      wireDualRouting(false);\n    }\n  }\n  function setDualAudioDevices({ streamDeviceId, headphoneDeviceId } = {}) {\n    if (typeof streamDeviceId === 'string') {\n      dualStreamDeviceId = streamDeviceId;\n      try { localStorage.setItem('vk-dual-audio-stream-device', dualStreamDeviceId); } catch (e) { /* 靜默 */ }\n    }\n    if (typeof headphoneDeviceId === 'string') {\n      dualHeadphoneDeviceId = headphoneDeviceId;\n      try { localStorage.setItem('vk-dual-audio-headphone-device', dualHeadphoneDeviceId); } catch (e) { /* 靜默 */ }\n    }\n    if (dualAudioModeEnabled) {\n      // idle 時換裝置也要立刻 warm；force 會排在任何尚未完成的舊 setSinkId 後面，\n      // 確保最後一次選擇最後落地。\n      wireDualRouting(true);\n      ensureDualAudioReady({ force: true }).catch(() => { /* 播放時仍會再重試 */ });\n    }\n  }\n`,
);

playback = replaceExact(
  playback,
  'playTrack readiness promise',
  `    if (wantSeparation) ensureVocalsChain();\n    wireDualRouting(wantDualAudio);\n    updateSeparationUiForTrack();\n`,
  `    if (wantSeparation) ensureVocalsChain();\n    wireDualRouting(wantDualAudio);\n    // sink 切換與 stem decode 平行進行，但真正 SoundTouch.play() 會等兩邊都 settled。\n    const dualReadyPromise = wantDualAudio ? ensureDualAudioReady() : Promise.resolve(true);\n    updateSeparationUiForTrack();\n`,
);

playback = replaceExact(
  playback,
  'autoplay load promises',
  `          const loadPromises = [stLoadCurrent(masterFilename)];\n          if (wantSeparation) {\n            loadPromises.push(loadVocalsFor(track));\n          }\n          Promise.all(loadPromises).then(([result, vocalsOk]) => {\n`,
  `          const masterLoadPromise = stLoadCurrent(masterFilename);\n          const vocalsPromise = wantSeparation ? loadVocalsFor(track) : Promise.resolve(false);\n          Promise.all([masterLoadPromise, vocalsPromise, dualReadyPromise]).then(([result, vocalsOk]) => {\n`,
);

playback = replaceExact(
  playback,
  'standby load promises',
  `          const loadPromises = [stLoadCurrent(masterFilename)];\n          if (wantSeparation) {\n            loadPromises.push(loadVocalsFor(track));\n          }\n          Promise.all(loadPromises).then(([result]) => {\n`,
  `          const masterLoadPromise = stLoadCurrent(masterFilename);\n          const vocalsPromise = wantSeparation ? loadVocalsFor(track) : Promise.resolve(false);\n          Promise.all([masterLoadPromise, vocalsPromise, dualReadyPromise]).then(([result]) => {\n`,
);

playback = replaceExact(
  playback,
  'requestPlayback readiness gate',
  `      const startST = () => {\n        const sep = separationActive && !!vocalsSTEngine;\n        // 續播時主引擎是暫停狀態，getProjectedTime() 回凍結的位置；分離時把「同一個位置 +\n        // 同一個排程 frame」給伴奏/人聲兩軌，起點才 sample 對齊。非分離時 pos/wf 皆 undefined\n        // → 等同舊的 SoundTouchEngine.play()（從自己凍結位置立即續播），行為不變。\n        const wf = sep ? sepSharedFrame(0.09) : undefined;\n        const pos = (sep && SoundTouchEngine.getProjectedTime) ? SoundTouchEngine.getProjectedTime() : undefined;\n        SoundTouchEngine.setPitch(currentPitchShift);\n        SoundTouchEngine.setTempo(currentPlaybackRate);\n        SoundTouchEngine.play(pos, wf);\n        startVocalsWhenReady(wf, pos);\n        updatePlayButton(); SocketClient.send('play:toggle', true);\n      };\n`,
  `      const startST = () => {\n        const requestedEntryId = loadedTrackEntryId;\n        const startSTAfterOutputsReady = () => {\n          // sink readiness 等待期間可能被暫停或切歌；舊的等待結果不可把新狀態重新啟播。\n          if (!isPlaying || loadedTrackEntryId !== requestedEntryId) return;\n          const sep = separationActive && !!vocalsSTEngine;\n          // 續播時主引擎是暫停狀態，getProjectedTime() 回凍結的位置；分離時把「同一個位置 +\n          // 同一個排程 frame」給伴奏/人聲兩軌，起點才 sample 對齊。非分離時 pos/wf 皆 undefined\n          // → 等同舊的 SoundTouchEngine.play()（從自己凍結位置立即續播），行為不變。\n          const wf = sep ? sepSharedFrame(0.09) : undefined;\n          const pos = (sep && SoundTouchEngine.getProjectedTime) ? SoundTouchEngine.getProjectedTime() : undefined;\n          SoundTouchEngine.setPitch(currentPitchShift);\n          SoundTouchEngine.setTempo(currentPlaybackRate);\n          SoundTouchEngine.play(pos, wf);\n          startVocalsWhenReady(wf, pos);\n          updatePlayButton(); SocketClient.send('play:toggle', true);\n        };\n        if (dualAudioModeEnabled) ensureDualAudioReady().then(startSTAfterOutputsReady);\n        else startSTAfterOutputsReady();\n      };\n`,
);

playback = replaceExact(
  playback,
  'stopPlayback keeps warm route',
  `    stopDualAudioClickTest();\n    wireDualRouting(false);\n    dualAudioActive = false;\n`,
  `    stopDualAudioClickTest();\n    // 歌曲結束只釋放歌曲 buffer；雙路模式仍開著時保留 routing/sink，避免下一首重新 cold-start。\n    if (!dualAudioModeEnabled) wireDualRouting(false);\n    dualAudioActive = false;\n`,
);

fs.writeFileSync(playbackPath, playback, 'utf8');

let tests = fs.readFileSync(testsPath, 'utf8');
const testAnchor = `test('雙路路由已接上時才建立的人聲鏈，不可繞過耳機路的同步偏移', () => {`;
if (!tests.includes(testAnchor)) throw new Error('test insertion anchor missing');
if (tests.includes("test('雙路輸出保持 warm，播放前等待 sink 就緒'")) throw new Error('warmup test already inserted');
const warmupTest = `test('雙路輸出保持 warm，播放前等待 sink 就緒', () => {\n  const playback = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-playback.js'), 'utf8').replace(/\\r\\n/g, '\\n');\n  ok(playback.includes('let dualSinkApplyChain = Promise.resolve(false);')\n    && playback.includes('function ensureDualAudioReady(options = {})'),\n  '雙路輸出要有可重用的 readiness gate 與序列化 sink queue：');\n  ok(playback.includes('const dualReadyPromise = wantDualAudio ? ensureDualAudioReady() : Promise.resolve(true);')\n    && playback.includes('Promise.all([masterLoadPromise, vocalsPromise, dualReadyPromise])'),\n  '新歌起播必須把 sink readiness 跟 decode 一起等待：');\n  ok(playback.includes('if (dualAudioModeEnabled) ensureDualAudioReady().then(startSTAfterOutputsReady);'),\n    '暫停後續播也必須等雙路輸出 ready：');\n  ok(/function stopPlayback\\(\\)[\\s\\S]{0,1800}if \\(!dualAudioModeEnabled\\) wireDualRouting\\(false\\);/.test(playback),\n    '一般歌曲停止不可拆掉仍啟用中的雙路 routing：');\n  ok(/function setDualAudioMode\\(enabled\\)[\\s\\S]{0,1000}if \\(dualAudioModeEnabled\\)[\\s\\S]{0,500}ensureDualAudioReady\\(\\)/.test(playback),\n    'idle 時開啟雙路模式要先 warm 兩個輸出：');\n  ok(/function setDualAudioDevices[\\s\\S]{0,1200}ensureDualAudioReady\\(\\{ force: true \\}\\)/.test(playback),\n    '換裝置時要強制排入最後一次 sink 設定：');\n  ok(playback.includes('const generation = ++dualSinkGeneration;')\n    && playback.includes('dualSinkApplyChain = tracked;'),\n  '快速換裝置必須序列化，避免較慢完成的舊 setSinkId 蓋回去：');\n});\n\n`;
tests = tests.replace(testAnchor, warmupTest + testAnchor);
fs.writeFileSync(testsPath, tests, 'utf8');

console.log('dual audio warmup patch applied');
