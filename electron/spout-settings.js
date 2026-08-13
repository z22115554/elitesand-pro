'use strict';

const fs = require('fs');
const path = require('path');
const { validateOptions } = require('./spout-output-controller');

const SETTINGS_FILE = 'spout-output.json';

function defaults() {
  return { senderName: 'Elitesand Pro Lyrics', width: 1920, height: 1080, fps: 30 };
}

function settingsPath(userDataPath) {
  return path.join(path.resolve(userDataPath), SETTINGS_FILE);
}

function normalize(value = {}) {
  return validateOptions({ ...defaults(), ...(value && typeof value === 'object' ? value : {}) });
}

function load(userDataPath, fsImpl = fs) {
  try {
    return normalize(JSON.parse(fsImpl.readFileSync(settingsPath(userDataPath), 'utf8')));
  } catch (_) {
    return normalize();
  }
}

function save(userDataPath, value, fsImpl = fs) {
  const normalized = normalize(value);
  const file = settingsPath(userDataPath);
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fsImpl.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fsImpl.renameSync(temp, file);
  return normalized;
}

module.exports = { SETTINGS_FILE, defaults, settingsPath, normalize, load, save };
