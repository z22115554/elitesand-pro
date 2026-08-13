'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('../electron/spout-settings');

function register({ test, eq }) {
  test('Spout CP05 saves output settings only under the supplied Electron userData directory', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-spout-settings-'));
    try {
      const saved = settings.save(userData, { senderName: 'Elitesand Test', width: 1280, height: 720, fps: 60 });
      eq(saved.width, 1280);
      eq(saved.height, 720);
      eq(settings.settingsPath(userData), path.join(userData, settings.SETTINGS_FILE));
      const loaded = settings.load(userData);
      eq(loaded.senderName, 'Elitesand Test');
      eq(loaded.fps, 60);
      assert.throws(() => settings.save(userData, { width: 1 }), (error) => error.code === 'INVALID_SPOUT_DIMENSIONS');
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
}

module.exports = { register };
