'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const UPDATE_MODE = 'electron-asar-v1';
const UPDATE_WORK_DIR = 'Elitesand-Pro-updates-v2';
const UPDATE_LOCK_MAX_AGE_MS = 2 * 60 * 1000;

function samePath(a, b, platform = process.platform) {
  const left = path.resolve(String(a || ''));
  const right = path.resolve(String(b || ''));
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function inspectUpdateLock(executablePath, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const env = options.env || process.env;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const tempDir = options.tempDir || os.tmpdir();
  const platform = options.platform || process.platform;
  const installRoot = path.dirname(path.resolve(executablePath || process.execPath));
  const workBase = path.join(path.resolve(tempDir), UPDATE_WORK_DIR);

  if (String(env?.ELITESAND_UPDATE_CHILD || '') === '1') {
    return { active: false, bypass: true, installRoot, workBase };
  }

  let entries;
  try { entries = fsImpl.readdirSync(workBase, { withFileTypes: true }); }
  catch (_) { return { active: false, bypass: false, installRoot, workBase }; }

  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const workRoot = path.join(workBase, entry.name);
    const readyFile = path.join(workRoot, 'updater.ready');
    const planFile = path.join(workRoot, 'update-plan.json');
    let stat;
    let updaterPid;
    let plan;
    try {
      stat = fsImpl.statSync(readyFile);
      updaterPid = Number.parseInt(String(fsImpl.readFileSync(readyFile, 'ascii')).trim(), 10);
      plan = JSON.parse(fsImpl.readFileSync(planFile, 'utf8'));
    } catch (_) {
      continue;
    }

    const age = now() - Number(stat.mtimeMs || 0);
    const active = Number.isInteger(updaterPid)
      && updaterPid > 0
      && plan?.schemaVersion === 2
      && plan?.mode === UPDATE_MODE
      && path.isAbsolute(String(plan?.targetRoot || ''))
      && samePath(plan.targetRoot, installRoot, platform)
      && age >= 0
      && age <= UPDATE_LOCK_MAX_AGE_MS;

    if (active) {
      return {
        active: true,
        bypass: false,
        installRoot,
        workBase,
        workRoot,
        updaterPid,
        fromVersion: plan.fromVersion || null,
        toVersion: plan.toVersion || null,
      };
    }
  }

  return { active: false, bypass: false, installRoot, workBase };
}

module.exports = {
  UPDATE_MODE,
  UPDATE_WORK_DIR,
  UPDATE_LOCK_MAX_AGE_MS,
  samePath,
  inspectUpdateLock,
};
