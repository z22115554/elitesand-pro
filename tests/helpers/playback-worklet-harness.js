'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSignalsmith(scope, publicDir = path.join(__dirname, '../../public')) {
  Object.assign(scope, { console, atob, performance, setTimeout, clearTimeout });
  const read = name => fs.readFileSync(path.join(publicDir, 'vendor', name), 'utf8');
  // In Chromium these are module dependencies. The VM supplies the same
  // factory in the test's AudioWorkletGlobalScope.
  vm.runInContext(read('signalsmith-stretch.js').replace('export { SignalsmithStretch };', ''), scope);
  vm.runInContext(read('signalsmith-playback-worklet.js').replace(/^import .*;\r?\n/gm, ''), scope);
}

function preparePlayback(processor) {
  return new Promise(resolve => {
    const send = processor.port.postMessage;
    processor.port.postMessage = message => {
      if (message.type !== 'prepared') return send(message);
      processor.port.postMessage = send;
      resolve(message.backend);
    };
    processor.port.onmessage({ data: { type: 'prepare' } });
  });
}

module.exports = { loadSignalsmith, preparePlayback };
