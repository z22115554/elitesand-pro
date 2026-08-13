'use strict';

const assert = require('assert');
const {
  DEFAULTS,
  validateOptions,
  createSpoutOutputController,
} = require('../electron/spout-output-controller');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function register({ test, testAsync, eq, ok }) {
  test('Spout CP02：設定限制拒絕非法尺寸與 sender name', () => {
    assert.throws(() => validateOptions({ width: 639 }), (error) => error.code === 'INVALID_SPOUT_DIMENSIONS');
    assert.throws(() => validateOptions({ senderName: '歌詞' }), (error) => error.code === 'INVALID_SPOUT_SENDER_NAME');
    const options = validateOptions({});
    eq(options.width, DEFAULTS.width);
    eq(options.height, DEFAULTS.height);
    eq(options.fps, 30, '跨 GPU 的安全預設必須是 30 FPS: ');
  });

  testAsync('Spout CP02：同時 start 只能建立一個 native sender', async () => {
    const gate = deferred();
    let creates = 0;
    const addon = {
      create: async () => { creates++; await gate.promise; },
      stop() {},
      getStatus: () => ({ state: creates ? 'running' : 'idle' }),
    };
    const controller = createSpoutOutputController({ loadAddon: () => addon });
    const first = controller.start();
    const second = controller.start();
    eq(first, second, '重複 start 必須共享同一個 pending operation: ');
    gate.resolve();
    await Promise.all([first, second]);
    eq(creates, 1, '不得建立第二個 sender: ');
    eq(controller.getStatus().state, 'running');
  });

  testAsync('Spout CP02：stop 可重複呼叫且會回到 idle', async () => {
    let stops = 0;
    const addon = {
      create() {},
      stop() { stops++; },
      getStatus: () => ({ state: stops ? 'idle' : 'running' }),
    };
    const controller = createSpoutOutputController({ loadAddon: () => addon });
    await controller.start();
    await controller.stop();
    await controller.stop();
    eq(stops, 1, 'idle 後 stop 必須是 idempotent: ');
    eq(controller.getStatus().state, 'idle');
  });

  testAsync('Spout CP02：native 建立失敗要保留可理解錯誤，不能假裝 running', async () => {
    const nativeError = Object.assign(new Error('D3D unavailable'), { code: 'D3D11_DEVICE_CREATE_FAILED' });
    const addon = {
      create() { throw nativeError; },
      stop() {},
      getStatus: () => ({ state: 'idle' }),
    };
    const controller = createSpoutOutputController({ loadAddon: () => addon });
    await assert.rejects(() => controller.start(), (error) => error === nativeError);
    const status = controller.getStatus();
    eq(status.state, 'error');
    eq(status.lastError.code, 'D3D11_DEVICE_CREATE_FAILED');
    ok(status.native && status.native.state === 'idle');
  });
}

module.exports = { register };
