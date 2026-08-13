'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { createSpoutDisplayOutput } = require('../electron/spout-display-output');

function createFakeBrowserWindowFactory() {
  const instances = [];
  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.loadedUrl = null;
      this.position = null;
      this.contentSize = null;
      this.webContents = new EventEmitter();
      this.webContents.setFrameRate = (fps) => { this.frameRate = fps; };
    }

    setPosition(x, y) { this.position = [x, y]; }
    setContentSize(width, height) { this.contentSize = [width, height]; }
    async loadURL(url) { this.loadedUrl = url; }
    isDestroyed() { return this.destroyed; }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
  }
  function factory(options) {
    const instance = new FakeBrowserWindow(options);
    instances.push(instance);
    return instance;
  }
  factory.instances = instances;
  return factory;
}

function sharedTexture(width = 1920, height = 1080) {
  let releases = 0;
  return {
    textureInfo: {
      codedSize: { width, height },
      pixelFormat: 'bgra',
      handle: { ntHandle: Buffer.alloc(8) },
    },
    release() { releases += 1; },
    get releases() { return releases; },
  };
}

function register({ test, testAsync, eq, ok }) {
  testAsync('Spout CP04 uses one offscreen /display renderer and releases every sent texture', async () => {
    const BrowserWindow = createFakeBrowserWindowFactory();
    const created = [];
    const sent = [];
    let stopped = 0;
    const addon = {
      create(options) { created.push(options); return { state: 'running' }; },
      send(info) { sent.push(info); return { accepted: true }; },
      stop() { stopped += 1; return { state: 'idle' }; },
      getStatus() { return { state: created.length ? 'running' : 'idle' }; },
    };
    const output = createSpoutDisplayOutput({ BrowserWindow, addon, port: 3017 });
    await output.start();
    const window = BrowserWindow.instances[0];
    eq(window.loadedUrl, 'http://127.0.0.1:3017/display?output=spout');
    ok(window.options.webPreferences.offscreen.useSharedTexture);
    eq(window.options.webPreferences.contextIsolation, true);
    eq(window.options.webPreferences.nodeIntegration, false);
    eq(window.options.webPreferences.sandbox, true);
    eq(window.frameRate, 30);
    const texture = sharedTexture();
    window.webContents.emit('paint', { texture });
    eq(created.length, 1);
    eq(created[0].width, 1920);
    eq(created[0].adapterPreference, '');
    eq(sent.length, 1);
    eq(texture.releases, 1);
    eq(output.getStatus().state, 'running');
    eq(output.getStatus().framesReceived, output.getStatus().framesReleased);
    await output.stop();
    eq(stopped, 1);
    eq(output.getStatus().state, 'idle');
  });

  testAsync('Spout CP07 passes an explicit mixed-GPU preference only to the native sender', async () => {
    const BrowserWindow = createFakeBrowserWindowFactory();
    const created = [];
    const addon = {
      create(options) { created.push(options); return { state: 'running' }; },
      send() { return { accepted: true }; },
      stop() { return { state: 'idle' }; },
      getStatus() { return { state: 'running' }; },
    };
    const output = createSpoutDisplayOutput({ BrowserWindow, addon, port: 3021, nativeAdapterPreference: 'low-power' });
    await output.start();
    BrowserWindow.instances[0].webContents.emit('paint', { texture: sharedTexture() });
    eq(created[0].adapterPreference, 'low-power');
    await output.stop();
  });

  testAsync('Spout CP05 coalesces repeated starts and releases the sender on window close', async () => {
    const BrowserWindow = createFakeBrowserWindowFactory();
    let creates = 0;
    let stops = 0;
    const addon = {
      create() { creates += 1; return { state: 'running' }; },
      send() { return { accepted: true }; },
      stop() { stops += 1; return { state: 'idle' }; },
      getStatus() { return { state: creates > stops ? 'running' : 'idle' }; },
    };
    const output = createSpoutDisplayOutput({ BrowserWindow, addon, port: 3019 });
    const first = output.start();
    const second = output.start();
    await Promise.all([first, second]);
    eq(BrowserWindow.instances.length, 1);
    const texture = sharedTexture();
    BrowserWindow.instances[0].webContents.emit('paint', { texture });
    eq(creates, 1);
    BrowserWindow.instances[0].destroy();
    eq(stops, 1, 'closing the offscreen window must stop the native sender: ');
    eq(output.getStatus().state, 'idle');
  });

  testAsync('Spout CP04 rejects a wrong-sized output texture without leaking it', async () => {
    const BrowserWindow = createFakeBrowserWindowFactory();
    let sends = 0;
    const addon = {
      create() { throw new Error('must not create when the display size is wrong'); },
      send() { sends += 1; return { accepted: true }; },
      stop() {},
      getStatus() { return { state: 'idle' }; },
    };
    const output = createSpoutDisplayOutput({ BrowserWindow, addon, port: 3018 });
    await output.start();
    const texture = sharedTexture(1280, 720);
    BrowserWindow.instances[0].webContents.emit('paint', { texture });
    eq(texture.releases, 1);
    eq(sends, 0);
    eq(output.getStatus().state, 'error');
    eq(output.getStatus().lastError.code, 'SPOUT_TEXTURE_SIZE_MISMATCH');
    await output.stop();
  });
}

module.exports = { register };
