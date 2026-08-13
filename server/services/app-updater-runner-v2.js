'use strict';

/**
 * Electron/ASAR incremental updater runner (schema v2).
 *
 * Copied to an OS temporary directory and executed by the integrity-protected
 * resources/tools/updater-node.exe helper. It waits for the Electron host to
 * exit, re-verifies the immutable runtime baseline, then atomically replaces
 * only the matched EXE/app.asar/tool/licence payload.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const UPDATE_MODE = 'electron-asar-v1';
const PROTECTED_UPDATER_RUNTIME = 'resources/tools/updater-node.exe';

function appendLog(file, message) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function normalizeRelative(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\')) return null;
  if (rel.startsWith('/') || rel.startsWith('//') || /^[a-zA-Z]:/.test(rel)) return null;
  if (rel.split('/').some((part) => part === '..' || part === '.' || !part)) return null;
  const normalized = path.posix.normalize(rel);
  return normalized === rel ? normalized : null;
}

function isUpdateOwnedPath(rel) {
  const normalized = normalizeRelative(rel);
  if (!normalized || normalized === PROTECTED_UPDATER_RUNTIME) return false;
  if (normalized === 'Elitesand Pro.exe' || normalized === 'resources/app.asar') return true;
  return normalized.startsWith('resources/tools/') || normalized.startsWith('resources/licenses/');
}

function validRelativeFile(rel) { return isUpdateOwnedPath(rel); }

function validImmutableFile(rel) {
  const normalized = normalizeRelative(rel);
  return !!normalized && !isUpdateOwnedPath(normalized);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function canonicalBaselineFingerprint(files) {
  const text = files
    .map((item) => `${item.path}\t${item.size}\t${item.sha256}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function unlinkIfExists(target) {
  try { fs.unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function removeTreeInside(target, parent) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (!inside(resolvedTarget, resolvedParent)) throw new Error(`Refusing to clean outside update workspace: ${resolvedTarget}`);
  let stat;
  try { stat = fs.lstatSync(resolvedTarget); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) { unlinkIfExists(resolvedTarget); return; }
  for (const name of fs.readdirSync(resolvedTarget)) removeTreeInside(path.join(resolvedTarget, name), resolvedTarget);
  fs.rmdirSync(resolvedTarget);
}

function validatePlan(plan) {
  if (!plan || plan.schemaVersion !== 2 || plan.mode !== UPDATE_MODE) throw new Error('Invalid update-v2 plan.');
  for (const key of ['targetRoot', 'stagingRoot', 'backupRoot', 'workRoot', 'readyFile', 'logFile']) {
    if (typeof plan[key] !== 'string' || !path.isAbsolute(plan[key])) throw new Error(`Missing safe absolute path: ${key}`);
  }
  if (!inside(plan.stagingRoot, plan.workRoot) || !inside(plan.backupRoot, plan.workRoot) || !inside(plan.readyFile, plan.workRoot)) {
    throw new Error('Update staging/backup/ready path escaped the work directory.');
  }
  if (!Array.isArray(plan.files) || plan.files.length < 2) throw new Error('Update-v2 file list is empty.');
  const seen = new Set();
  let hasExe = false;
  let hasAsar = false;
  for (const item of plan.files) {
    const rel = item?.path;
    if (!validRelativeFile(rel)) throw new Error(`Update plan contains a forbidden path: ${rel}`);
    if (seen.has(rel)) throw new Error(`Update plan contains a duplicate path: ${rel}`);
    seen.add(rel);
    if (!/^[a-f0-9]{64}$/i.test(String(item.sha256 || ''))) throw new Error(`Update plan has an invalid SHA-256: ${rel}`);
    if (!Number.isSafeInteger(item.size) || item.size < 0) throw new Error(`Update plan has an invalid size: ${rel}`);
    const source = path.join(plan.stagingRoot, ...rel.split('/'));
    const destination = path.join(plan.targetRoot, ...rel.split('/'));
    if (!inside(source, plan.stagingRoot) || !inside(destination, plan.targetRoot)) throw new Error(`Update path escaped root: ${rel}`);
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size !== item.size || sha256File(source) !== item.sha256.toLowerCase()) {
      throw new Error(`Staged update file failed integrity verification: ${rel}`);
    }
    if (rel === 'Elitesand Pro.exe') hasExe = true;
    if (rel === 'resources/app.asar') hasAsar = true;
  }
  if (!hasExe || !hasAsar) throw new Error('Update-v2 must replace Elitesand Pro.exe and resources/app.asar together.');

  if (!Array.isArray(plan.baselineImmutableFiles) || plan.baselineImmutableFiles.length === 0) {
    throw new Error('Update-v2 plan has no immutable runtime baseline.');
  }
  const baselineSeen = new Set();
  const normalizedBaseline = [];
  for (const item of plan.baselineImmutableFiles) {
    const rel = item?.path;
    if (!validImmutableFile(rel)) throw new Error(`Immutable baseline contains an invalid path: ${rel}`);
    if (baselineSeen.has(rel)) throw new Error(`Immutable baseline contains a duplicate path: ${rel}`);
    baselineSeen.add(rel);
    if (!Number.isSafeInteger(item.size) || item.size < 0 || !/^[a-f0-9]{64}$/i.test(String(item.sha256 || ''))) {
      throw new Error(`Immutable baseline has invalid metadata: ${rel}`);
    }
    normalizedBaseline.push({ path: rel, size: item.size, sha256: item.sha256.toLowerCase() });
  }
  if (!baselineSeen.has(PROTECTED_UPDATER_RUNTIME)) throw new Error('Immutable baseline does not protect updater-node.exe.');
  const fingerprint = String(plan.baselineRuntimeFingerprint || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || canonicalBaselineFingerprint(normalizedBaseline) !== fingerprint) {
    throw new Error('Immutable baseline fingerprint is invalid.');
  }
  plan.baselineImmutableFiles = normalizedBaseline;
  plan.baselineRuntimeFingerprint = fingerprint;
  return plan;
}

function verifyImmutableRuntime(plan) {
  for (const item of plan.baselineImmutableFiles) {
    const target = path.join(plan.targetRoot, ...item.path.split('/'));
    if (!inside(target, plan.targetRoot)) return { ok: false, reason: `Runtime path escaped install root: ${item.path}` };
    let stat;
    try { stat = fs.statSync(target); } catch (_) { return { ok: false, reason: `Runtime file is missing: ${item.path}` }; }
    if (!stat.isFile() || stat.size !== item.size) return { ok: false, reason: `Runtime file size changed: ${item.path}` };
    if (sha256File(target) !== item.sha256) return { ok: false, reason: `Runtime file hash changed: ${item.path}` };
  }
  return { ok: true };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

async function waitForExit(pid, timeoutMs) {
  const started = Date.now();
  while (isProcessAlive(pid)) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the Electron host to exit; update was not installed.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function backupFiles(plan) {
  removeTreeInside(plan.backupRoot, plan.workRoot);
  fs.mkdirSync(plan.backupRoot, { recursive: true });
  const records = [];
  for (const item of plan.files) {
    const rel = item.path;
    const destination = path.join(plan.targetRoot, ...rel.split('/'));
    const backup = path.join(plan.backupRoot, ...rel.split('/'));
    const existed = fs.existsSync(destination);
    if (existed) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(destination, backup);
    }
    records.push({ rel, existed });
  }
  fs.writeFileSync(path.join(plan.backupRoot, 'backup-records.json'), JSON.stringify(records), 'utf8');
  return records;
}

function installFiles(plan, options = {}) {
  let count = 0;
  for (const item of plan.files) {
    if (options.failAfter === count) throw new Error('Injected update-v2 install failure.');
    const rel = item.path;
    const source = path.join(plan.stagingRoot, ...rel.split('/'));
    const destination = path.join(plan.targetRoot, ...rel.split('/'));
    const temporary = `${destination}.update-new-${process.pid}`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, temporary);
    if (fs.statSync(temporary).size !== item.size || sha256File(temporary) !== item.sha256.toLowerCase()) {
      unlinkIfExists(temporary);
      throw new Error(`Temporary copy failed integrity verification: ${rel}`);
    }
    unlinkIfExists(destination);
    fs.renameSync(temporary, destination);
    count++;
  }
  return count;
}

function rollback(plan, records) {
  const errors = [];
  for (const record of [...records].reverse()) {
    const destination = path.join(plan.targetRoot, ...record.rel.split('/'));
    const backup = path.join(plan.backupRoot, ...record.rel.split('/'));
    try {
      if (record.existed) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(backup, destination);
      } else {
        unlinkIfExists(destination);
      }
    } catch (error) {
      errors.push(`${record.rel}: ${error.message}`);
    }
  }
  if (errors.length) {
    fs.writeFileSync(plan.rollbackErrorLog, errors.join('\n'), 'utf8');
    throw new Error(`Rollback failed for ${errors.length} file(s).`);
  }
}

function spawnRestart(restart) {
  return new Promise((resolve, reject) => {
    if (!restart || restart.type !== 'electron-app' || !path.isAbsolute(restart.command)) {
      reject(new Error('Update-v2 requires an absolute Electron restart command.'));
      return;
    }
    const env = { ...process.env, ELITESAND_UPDATE_CHILD: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(restart.command, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      cwd: path.dirname(restart.command),
      env,
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child.pid); });
  });
}

async function applyStagedUpdate(plan, options = {}) {
  validatePlan(plan);
  let records = [];
  try {
    appendLog(plan.logFile, `Applying secure desktop update ${plan.fromVersion || '?'} -> ${plan.toVersion || '?'}`);
    records = backupFiles(plan);
    const count = installFiles(plan, options);
    appendLog(plan.logFile, `Replaced ${count} integrity-verified desktop payload file(s).`);
    if (!options.skipRestart) {
      await spawnRestart(plan.restart);
      appendLog(plan.logFile, 'Restarted the updated Electron application.');
    }
    removeTreeInside(plan.stagingRoot, plan.workRoot);
    removeTreeInside(plan.backupRoot, plan.workRoot);
    return { ok: true, updatedCount: count };
  } catch (error) {
    appendLog(plan.logFile, `Install failed: ${error.message}; starting rollback.`);
    if (records.length) {
      try { rollback(plan, records); appendLog(plan.logFile, 'Rollback completed.'); }
      catch (rollbackError) { appendLog(plan.logFile, `CRITICAL rollback failure: ${rollbackError.message}`); }
    }
    if (!options.skipRestart) {
      try { await spawnRestart(plan.restart); appendLog(plan.logFile, 'Restarted the rolled-back application.'); }
      catch (restartError) { appendLog(plan.logFile, `Rollback restart failed: ${restartError.message}`); }
    }
    return { ok: false, error: error.message };
  }
}

async function runFromPlanFile(planPath) {
  const plan = validatePlan(JSON.parse(fs.readFileSync(planPath, 'utf8')));
  appendLog(plan.logFile, `Updater-v2 ready; waiting for Electron host PID ${plan.parentPid}.`);
  fs.writeFileSync(plan.readyFile, String(process.pid), 'ascii');
  await waitForExit(Number(plan.parentPid), Number(plan.waitTimeoutMs) || 600000);
  appendLog(plan.logFile, 'Electron host fully exited; re-verifying immutable runtime.');
  const runtimeCheck = verifyImmutableRuntime(plan);
  if (!runtimeCheck.ok) {
    appendLog(plan.logFile, `Runtime baseline changed after handoff: ${runtimeCheck.reason}; update aborted.`);
    try { await spawnRestart(plan.restart); appendLog(plan.logFile, 'Restarted the unchanged application after baseline rejection.'); }
    catch (restartError) { appendLog(plan.logFile, `Failed to restart after baseline rejection: ${restartError.message}`); }
    return { ok: false, error: runtimeCheck.reason };
  }
  appendLog(plan.logFile, 'Immutable runtime baseline verified; beginning replacement.');
  return applyStagedUpdate(plan);
}

if (require.main === module) {
  const planPath = process.argv[2];
  runFromPlanFile(planPath).then((result) => { process.exitCode = result.ok ? 0 : 1; }).catch((error) => {
    try { appendLog(path.join(path.dirname(planPath || __filename), 'updater-v2-fatal.log'), error.stack || error.message); } catch (_) {}
    process.exitCode = 1;
  });
}

module.exports = {
  UPDATE_MODE,
  PROTECTED_UPDATER_RUNTIME,
  validRelativeFile,
  validImmutableFile,
  canonicalBaselineFingerprint,
  verifyImmutableRuntime,
  validatePlan,
  waitForExit,
  backupFiles,
  installFiles,
  rollback,
  applyStagedUpdate,
  runFromPlanFile,
  sha256File,
};
