'use strict';

/**
 * 外部 updater。這個檔案啟動前會被複製到 OS 暫存目錄，且只使用 Node 內建模組；
 * 因此主程式退出後替換 app/server/ 時，不會覆蓋正在執行的 updater 本身。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ALLOWED_DIRS = new Set(['server', 'public']);
const ALLOWED_FILES = new Set(['package.json', 'package-lock.json']);
const PROTECTED = ['data/', 'downloads/', 'logs/', 'node_modules/', '.git/'];

function appendLog(file, message) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function unlinkIfExists(target) {
  try {
    fs.unlinkSync(target);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function removeTreeInside(target, parent) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (!inside(resolvedTarget, resolvedParent)) throw new Error(`拒絕清理暫存目錄外的路徑：${resolvedTarget}`);

  let stat;
  try {
    stat = fs.lstatSync(resolvedTarget);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    unlinkIfExists(resolvedTarget);
    return;
  }
  for (const name of fs.readdirSync(resolvedTarget)) {
    removeTreeInside(path.join(resolvedTarget, name), resolvedTarget);
  }
  fs.rmdirSync(resolvedTarget);
}

function validRelativeFile(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false;
  if (rel.split('/').some((part) => part === '..' || part === '.')) return false;
  const lower = rel.toLowerCase();
  if (PROTECTED.some((prefix) => lower === prefix.slice(0, -1) || lower.startsWith(prefix))) return false;
  if (ALLOWED_FILES.has(rel)) return true;
  const top = rel.split('/')[0];
  return ALLOWED_DIRS.has(top) && rel.includes('/');
}

function validatePlan(plan) {
  if (!plan || plan.schemaVersion !== 1) throw new Error('更新計畫格式無效');
  for (const key of ['targetRoot', 'stagingRoot', 'backupRoot', 'workRoot', 'readyFile', 'logFile']) {
    if (typeof plan[key] !== 'string' || !path.isAbsolute(plan[key])) throw new Error(`更新計畫缺少安全路徑：${key}`);
  }
  if (!inside(plan.stagingRoot, plan.workRoot) || !inside(plan.backupRoot, plan.workRoot) || !inside(plan.readyFile, plan.workRoot)) {
    throw new Error('staging、backup 或 ready file 不在更新暫存目錄內');
  }
  if (!Array.isArray(plan.files) || !plan.files.length || new Set(plan.files).size !== plan.files.length) throw new Error('更新檔案清單無效');
  for (const rel of plan.files) {
    if (!validRelativeFile(rel)) throw new Error(`更新計畫含未允許路徑：${rel}`);
    const source = path.join(plan.stagingRoot, ...rel.split('/'));
    const destination = path.join(plan.targetRoot, ...rel.split('/'));
    if (!inside(source, plan.stagingRoot) || !inside(destination, plan.targetRoot) || !fs.statSync(source).isFile()) {
      throw new Error(`更新來源檔案無效：${rel}`);
    }
  }
  return plan;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

async function waitForExit(pid, timeoutMs) {
  const started = Date.now();
  while (isProcessAlive(pid)) {
    if (Date.now() - started > timeoutMs) throw new Error('等待主程序結束逾時，未安裝更新');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function backupFiles(plan) {
  removeTreeInside(plan.backupRoot, plan.workRoot);
  fs.mkdirSync(plan.backupRoot, { recursive: true });
  const records = [];
  for (const rel of plan.files) {
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
  for (const rel of plan.files) {
    if (options.failAfter === count) throw new Error('測試注入：模擬覆蓋失敗');
    const source = path.join(plan.stagingRoot, ...rel.split('/'));
    const destination = path.join(plan.targetRoot, ...rel.split('/'));
    const temporary = `${destination}.update-new-${process.pid}`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, temporary);
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
    } catch (err) {
      errors.push(`${record.rel}: ${err.message}`);
    }
  }
  if (errors.length) {
    fs.writeFileSync(plan.rollbackErrorLog, errors.join('\n'), 'utf8');
    throw new Error(`回滾有 ${errors.length} 個檔案失敗`);
  }
}

function spawnRestart(restart) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      if (restart?.type === 'launcher') {
        child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', restart.launcher], {
          detached: true, stdio: 'ignore', windowsHide: false, cwd: path.dirname(restart.launcher),
        });
      } else if (restart?.type === 'node') {
        child = spawn(restart.command, restart.args || [], {
          detached: true, stdio: 'ignore', windowsHide: true, cwd: restart.cwd,
          env: { ...process.env, ELITESAND_UPDATE_CHILD: '1' },
        });
      } else {
        throw new Error('缺少重啟方式');
      }
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(child.pid); });
    } catch (err) { reject(err); }
  });
}

async function applyStagedUpdate(plan, options = {}) {
  validatePlan(plan);
  let records = [];
  try {
    appendLog(plan.logFile, `開始安裝 v${plan.fromVersion || '?'} -> v${plan.toVersion || '?'}`);
    records = backupFiles(plan);
    const count = installFiles(plan, options);
    appendLog(plan.logFile, `已覆蓋 ${count} 個白名單程式檔；使用者資料目錄未觸碰`);
    if (!options.skipRestart) {
      await spawnRestart(plan.restart);
      appendLog(plan.logFile, '新版本重啟命令已成功建立');
    }
    removeTreeInside(plan.stagingRoot, plan.workRoot);
    removeTreeInside(plan.backupRoot, plan.workRoot);
    return { ok: true, updatedCount: count };
  } catch (err) {
    appendLog(plan.logFile, `安裝失敗：${err.message}；開始回滾`);
    if (records.length) {
      try {
        rollback(plan, records);
        appendLog(plan.logFile, '回滾完成');
      } catch (rollbackError) {
        appendLog(plan.logFile, `嚴重：${rollbackError.message}`);
      }
    }
    if (!options.skipRestart) {
      try { await spawnRestart(plan.restart); appendLog(plan.logFile, '已嘗試重啟回滾後的舊版本'); } catch (restartError) {
        appendLog(plan.logFile, `回滾後重啟失敗：${restartError.message}`);
      }
    }
    return { ok: false, error: err.message };
  }
}

async function runFromPlanFile(planPath) {
  const plan = validatePlan(JSON.parse(fs.readFileSync(planPath, 'utf8')));
  appendLog(plan.logFile, `外部 updater 已啟動，等待主 PID ${plan.parentPid} 結束`);
  fs.writeFileSync(plan.readyFile, String(process.pid), 'ascii');
  await waitForExit(Number(plan.parentPid), Number(plan.waitTimeoutMs) || 600000);
  appendLog(plan.logFile, '主程序已完全退出，開始安全替換');
  return applyStagedUpdate(plan);
}

if (require.main === module) {
  const planPath = process.argv[2];
  runFromPlanFile(planPath).then((result) => {
    process.exitCode = result.ok ? 0 : 1;
  }).catch((err) => {
    try {
      const fallback = path.join(path.dirname(planPath || __filename), 'updater-fatal.log');
      appendLog(fallback, err.stack || err.message);
    } catch (_) { /* no safe log target */ }
    process.exitCode = 1;
  });
}

module.exports = {
  validRelativeFile,
  validatePlan,
  waitForExit,
  unlinkIfExists,
  removeTreeInside,
  backupFiles,
  installFiles,
  rollback,
  applyStagedUpdate,
  runFromPlanFile,
};
