'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseNetstatListeningPid,
  parseProcessInfoJson,
  isRecoverablePackagedUtility,
  createRecoveringHealthProbe,
} = require('../electron/port-occupancy-recovery');

test('parseNetstatListeningPid finds the LISTENING owner for the requested port', () => {
  const output = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING       8888',
  ].join('\r\n');
  assert.equal(parseNetstatListeningPid(output, 3000), 4242);
  assert.equal(parseNetstatListeningPid(output, 3001), 8888);
  assert.equal(parseNetstatListeningPid(output, 3999), null);
});

test('parseProcessInfoJson normalizes PowerShell process metadata', () => {
  assert.deepEqual(parseProcessInfoJson(JSON.stringify({
    ProcessId: 42,
    ParentProcessId: 21,
    ExecutablePath: 'C:\\Apps\\Elitesand Pro\\Elitesand Pro.exe',
    CommandLine: '"C:\\Apps\\Elitesand Pro\\Elitesand Pro.exe" --type=utility --utility-sub-type=node.mojom.NodeService',
  })), {
    pid: 42,
    parentPid: 21,
    executablePath: 'C:\\Apps\\Elitesand Pro\\Elitesand Pro.exe',
    commandLine: '"C:\\Apps\\Elitesand Pro\\Elitesand Pro.exe" --type=utility --utility-sub-type=node.mojom.NodeService',
  });
});

test('only the same packaged Electron utility process is recoverable', () => {
  const executable = 'C:\\Program Files\\Elitesand Pro\\Elitesand Pro.exe';
  const utility = {
    executablePath: executable,
    commandLine: `"${executable}" --type=utility --utility-sub-type=node.mojom.NodeService`,
  };
  assert.equal(isRecoverablePackagedUtility(utility, executable), true);
  assert.equal(isRecoverablePackagedUtility({
    ...utility,
    executablePath: 'C:\\Windows\\System32\\node.exe',
  }, executable), false);
  assert.equal(isRecoverablePackagedUtility({
    executablePath: executable,
    commandLine: `"${executable}" --type=renderer`,
  }, executable), false);
});

test('recovering probe kills one stale packaged utility and retries until the port is free', async () => {
  const calls = [];
  const states = [{ state: 'occupied' }, { state: 'occupied' }, { state: 'free' }];
  const baseProbe = async () => states.shift() || { state: 'free' };
  const probe = createRecoveringHealthProbe({
    baseProbe,
    isPackaged: true,
    platform: 'win32',
    currentExecutablePath: 'C:\\Apps\\Elitesand Pro.exe',
    findListeningPidImpl: async (port) => { calls.push(['find', port]); return 4321; },
    readProcessInfoImpl: async (pid) => ({
      pid,
      executablePath: 'C:\\Apps\\Elitesand Pro.exe',
      commandLine: '"C:\\Apps\\Elitesand Pro.exe" --type=utility --utility-sub-type=node.mojom.NodeService',
    }),
    terminateProcessImpl: async (pid) => { calls.push(['kill', pid]); },
    delay: async () => {},
    retryCount: 4,
    logger: { warn() {} },
  });

  assert.deepEqual(await probe(3000), { state: 'free' });
  assert.deepEqual(calls, [['find', 3000], ['kill', 4321]]);
});

test('recovering probe never kills the server this host just forked (same exe, same utility command line)', async () => {
  const executable = 'C:\Apps\Elitesand Pro.exe';
  const utilityCommandLine = `"${executable}" --type=utility --utility-sub-type=node.mojom.NodeService`;
  assert.equal(isRecoverablePackagedUtility({ executablePath: executable, commandLine: utilityCommandLine, parentPid: 777 }, executable, { hostPid: 777 }), false);
  assert.equal(isRecoverablePackagedUtility({ executablePath: executable, commandLine: utilityCommandLine, parentPid: 1 }, executable, { hostPid: 777 }), true);
  assert.equal(isRecoverablePackagedUtility({ executablePath: executable, commandLine: utilityCommandLine }, executable, { hostPid: 777 }), true, 'parentPid 讀不到時維持原判斷: ');

  let killed = false;
  const probe = createRecoveringHealthProbe({
    baseProbe: async () => ({ state: 'occupied' }),
    isPackaged: true,
    platform: 'win32',
    currentExecutablePath: executable,
    hostPid: 777,
    findListeningPidImpl: async () => 4321,
    readProcessInfoImpl: async (pid) => ({ pid, parentPid: 777, executablePath: executable, commandLine: utilityCommandLine }),
    terminateProcessImpl: async () => { killed = true; },
    delay: async () => {},
  });
  assert.deepEqual(await probe(3000), { state: 'occupied' });
  assert.equal(killed, false);
});

test('recovering probe never kills an unrelated process', async () => {
  let killed = false;
  const probe = createRecoveringHealthProbe({
    baseProbe: async () => ({ state: 'occupied' }),
    isPackaged: true,
    platform: 'win32',
    currentExecutablePath: 'C:\\Apps\\Elitesand Pro.exe',
    findListeningPidImpl: async () => 9999,
    readProcessInfoImpl: async () => ({
      executablePath: 'C:\\Program Files\\Other App\\other.exe',
      commandLine: 'other.exe --type=utility --utility-sub-type=node.mojom.NodeService',
    }),
    terminateProcessImpl: async () => { killed = true; },
  });

  assert.deepEqual(await probe(3000), { state: 'occupied' });
  assert.equal(killed, false);
});

test('recovering probe is disabled for development and non-Windows runs', async () => {
  for (const options of [
    { isPackaged: false, platform: 'win32' },
    { isPackaged: true, platform: 'linux' },
  ]) {
    let inspected = false;
    const probe = createRecoveringHealthProbe({
      baseProbe: async () => ({ state: 'occupied' }),
      currentExecutablePath: 'C:\\Apps\\Elitesand Pro.exe',
      findListeningPidImpl: async () => { inspected = true; return 1; },
      ...options,
    });
    assert.deepEqual(await probe(3000), { state: 'occupied' });
    assert.equal(inspected, false);
  }
});
