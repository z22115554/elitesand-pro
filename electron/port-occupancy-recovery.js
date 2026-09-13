'use strict';

const path = require('path');
const { execFile } = require('child_process');

function execFileText(file, args, { execFileImpl = execFile, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (error, stdout = '') => {
      if (error) return reject(error);
      resolve(String(stdout));
    });
  });
}

function parseNetstatListeningPid(output, port) {
  const expectedPort = Number(port);
  if (!Number.isInteger(expectedPort) || expectedPort <= 0) return null;
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const columns = rawLine.trim().split(/\s+/);
    if (columns.length < 5 || String(columns[0]).toUpperCase() !== 'TCP') continue;
    const localEndpoint = columns[1];
    const state = String(columns[columns.length - 2] || '').toUpperCase();
    const pid = Number.parseInt(columns[columns.length - 1], 10);
    const portMatch = String(localEndpoint || '').match(/:(\d+)$/);
    if (!portMatch || Number(portMatch[1]) !== expectedPort || state !== 'LISTENING') continue;
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

async function findListeningPid(port, { execFileImpl = execFile } = {}) {
  const output = await execFileText('netstat.exe', ['-ano', '-p', 'tcp'], { execFileImpl });
  return parseNetstatListeningPid(output, port);
}

function parseProcessInfoJson(raw) {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    if (!parsed || Array.isArray(parsed)) return null;
    return {
      pid: Number.parseInt(parsed.ProcessId, 10) || null,
      parentPid: Number.parseInt(parsed.ParentProcessId, 10) || null,
      executablePath: typeof parsed.ExecutablePath === 'string' ? parsed.ExecutablePath : '',
      commandLine: typeof parsed.CommandLine === 'string' ? parsed.CommandLine : '',
    };
  } catch (_) {
    return null;
  }
}

async function readWindowsProcessInfo(pid, { execFileImpl = execFile } = {}) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  const command = [
    `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${Number(pid)}\";`,
    'if ($null -eq $p) { exit 3 };',
    '$p | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
  ].join(' ');
  try {
    const output = await execFileText('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { execFileImpl });
    return parseProcessInfoJson(output);
  } catch (_) {
    return null;
  }
}

function normalizeExecutable(value) {
  if (!value) return '';
  try { return path.resolve(String(value)).replace(/\\/g, '/').toLowerCase(); } catch (_) { return ''; }
}

function isRecoverablePackagedUtility(processInfo, currentExecutablePath) {
  if (!processInfo || !currentExecutablePath) return false;
  const ownerExecutable = normalizeExecutable(processInfo.executablePath);
  const currentExecutable = normalizeExecutable(currentExecutablePath);
  if (!ownerExecutable || ownerExecutable !== currentExecutable) return false;
  const commandLine = String(processInfo.commandLine || '').toLowerCase();
  return commandLine.includes('--type=utility')
    && (commandLine.includes('node.mojom.nodeservice') || commandLine.includes('node_service'));
}

async function terminateProcess(pid, { killImpl = process.kill } = {}) {
  killImpl(Number(pid));
}

function createRecoveringHealthProbe({
  baseProbe,
  isPackaged,
  platform = process.platform,
  currentExecutablePath = process.execPath,
  findListeningPidImpl = findListeningPid,
  readProcessInfoImpl = readWindowsProcessInfo,
  terminateProcessImpl = terminateProcess,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  retryDelayMs = 150,
  retryCount = 12,
  logger = console,
} = {}) {
  if (typeof baseProbe !== 'function') throw new TypeError('createRecoveringHealthProbe requires baseProbe');
  let recoveryAttempted = false;

  return async function recoveringHealthProbe(port, options) {
    const initial = await baseProbe(port, options);
    if (initial?.state !== 'occupied' || recoveryAttempted || !isPackaged || platform !== 'win32') return initial;
    recoveryAttempted = true;

    let ownerPid = null;
    try { ownerPid = await findListeningPidImpl(port); } catch (_) { return initial; }
    if (!Number.isInteger(Number(ownerPid)) || Number(ownerPid) <= 0 || Number(ownerPid) === process.pid) return initial;

    let processInfo = null;
    try { processInfo = await readProcessInfoImpl(Number(ownerPid)); } catch (_) { return initial; }
    if (!isRecoverablePackagedUtility(processInfo, currentExecutablePath)) return initial;

    try {
      await terminateProcessImpl(Number(ownerPid));
      logger?.warn?.(`[Elitesand Pro Electron] Recovered stale server process ${ownerPid} holding port ${port}.`);
    } catch (_) {
      return initial;
    }

    let latest = initial;
    for (let attempt = 0; attempt < retryCount; attempt += 1) {
      await delay(retryDelayMs);
      latest = await baseProbe(port, options);
      if (latest?.state !== 'occupied') return latest;
    }
    return latest;
  };
}

module.exports = {
  execFileText,
  parseNetstatListeningPid,
  findListeningPid,
  parseProcessInfoJson,
  readWindowsProcessInfo,
  isRecoverablePackagedUtility,
  terminateProcess,
  createRecoveringHealthProbe,
};
