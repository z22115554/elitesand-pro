'use strict';
const childProcess = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

// Only processes created by this manager can be terminated. No API accepts
// an arbitrary PID, process name, URL or shell command.
function createOwnedProcessManager({
  spawnImpl = childProcess.spawn, execFileImpl = childProcess.execFile,
  killImpl = process.kill, platform = process.platform, environment = process.env,
  terminationTimeoutMs = 2000,
} = {}) {
  const active = new Set(), records = new WeakMap();
  let closing = false;
  const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR', killed: true });

  function terminate(child) {
    const record = child && records.get(child);
    if (!record) return Promise.resolve({ ok: false, reason: 'not-owned' });
    if (record.termination) return record.termination;
    if (record.closed) return Promise.resolve({ ok: true, reason: 'already-closed' });
    const pid = child.pid;
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      return Promise.resolve({ ok: false, reason: 'invalid-pid' });
    }
    if (platform !== 'win32') {
      try {
        killImpl(-pid, 'SIGKILL');
        record.termination = Promise.resolve({ ok: true, method: 'owned-process-group' });
      } catch (error) {
        record.termination = Promise.resolve({ ok: error.code === 'ESRCH', reason: error.code });
      }
      return record.termination;
    }
    record.termination = new Promise((resolve) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true; clearTimeout(deadline);
        // Direct-handle fallback is not reported as successful tree cleanup.
        if (error && !record.closed) { try { child.kill(); } catch (_) {} }
        resolve(error ? { ok: false, reason: error.code || 'tree-kill-failed' } : { ok: true, method: 'taskkill-tree' });
      };
      const deadline = setTimeout(() => finish(Object.assign(new Error('Tree termination timed out'), { code: 'ETIMEDOUT' })), terminationTimeoutMs + 100);
      try {
        const executable = path.win32.join(environment.SystemRoot || environment.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe');
        execFileImpl(executable, ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true, timeout: terminationTimeoutMs, encoding: 'utf8',
        }, finish);
      } catch (error) { finish(error); }
    });
    return record.termination;
  }

  function spawn(file, args, options = {}) {
    if (closing) throw Object.assign(new Error('Import processes are shutting down'), { code: 'IMPORT_CANCELLED' });
    const { signal, ...spawnOptions } = options;
    if (signal?.aborted) throw abortError();
    const child = spawnImpl(file, args, { ...spawnOptions, detached: platform !== 'win32' });
    const record = { child, closed: false, termination: null };
    records.set(child, record); active.add(record);
    const onAbort = () => { void terminate(child); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once('close', () => {
      record.closed = true;
      if (record.termination) record.termination.then(() => active.delete(record));
      else active.delete(record);
      signal?.removeEventListener('abort', onAbort);
    });
    if (signal?.aborted) onAbort();
    return child;
  }

  // execFile does not forward detached to spawn. Buffer metadata through the
  // same owned group as downloads; retain streaming stdout and bounded output.
  function execFile(file, args, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    options ||= {};
    const { signal, timeout = 0, maxBuffer = 1024 * 1024, encoding = 'utf8', ...spawnOptions } = options;
    if (signal?.aborted) throw abortError();
    const child = spawn(file, args, { ...spawnOptions, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0 };
    let error = null, timer = null, completed = false;
    const stop = (reason) => { error ||= reason; void terminate(child); };
    const onAbort = () => stop(abortError());
    const collect = (stream, chunk) => {
      if (error) return;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxBuffer - sizes[stream]);
      chunks[stream].push(data.subarray(0, remaining));
      sizes[stream] += Math.min(data.length, remaining);
      if (data.length > remaining) stop(Object.assign(new RangeError(stream + ' maxBuffer length exceeded'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true,
      }));
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.once('error', failure => { error ||= failure; });
    child.once('close', async (code, exitSignal) => {
      if (completed) return;
      completed = true; clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      await waitForTermination(child);
      const output = stream => {
        const buffer = Buffer.concat(chunks[stream]);
        return encoding === null || encoding === 'buffer' ? buffer : buffer.toString(encoding);
      };
      const stdout = output('stdout'), stderr = output('stderr');
      if (!error && code !== 0) error = Object.assign(new Error(path.basename(file) + ' exited with code ' + code), {
        code, signal: exitSignal, killed: !!records.get(child)?.termination,
      });
      if (error) Object.assign(error, { stdout, stderr });
      callback?.(error, stdout, stderr);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeout > 0) timer = setTimeout(() => stop(Object.assign(new Error('Command timed out'), { code: 'ETIMEDOUT', killed: true })), timeout);
    if (signal?.aborted) onAbort();
    return child;
  }
  execFile[promisify.custom] = (file, args, options) => {
    let child;
    const promise = new Promise((resolve, reject) => {
      child = execFile(file, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
    });
    promise.child = child;
    return promise;
  };
  function waitForTermination(child) { return records.get(child)?.termination || Promise.resolve(); }
  async function stopAll() { return Promise.all([...active].map(record => terminate(record.child))); }
  async function shutdown() { closing = true; return stopAll(); }
  return { spawn, execFile, terminate, waitForTermination, stopAll, shutdown, activeCount: () => active.size };
}

module.exports = { createOwnedProcessManager, ...createOwnedProcessManager() };
