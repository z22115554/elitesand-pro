'use strict';
const hooks = new Set();
let registered = false;
let running = false;
function flushExitHooks() {
  if (running) return;
  running = true;
  try {
    for (const hook of hooks) { try { hook(); } catch (_) { /* isolate failures */ } }
  } finally { running = false; }
}
function onExit(hook) {
  if (typeof hook !== 'function') throw new TypeError('exit hook must be a function');
  hooks.add(hook);
  if (!registered) { process.once('exit', flushExitHooks); registered = true; }
  return () => hooks.delete(hook);
}
module.exports = { onExit, flushExitHooks };
