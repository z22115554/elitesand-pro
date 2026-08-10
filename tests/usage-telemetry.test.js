'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function mockProjectDependencies(request, parent, isMain) {
  if (request === 'node-fetch') return async () => ({ ok: true, status: 202 });
  if (request === '../utils/load-config') return {};
  if (request === '../utils/app-paths') return { dataDir: os.tmpdir() };
  if (request === '../utils/app-version') return { APP_VERSION: 'test', appUserAgent: () => 'test' };
  if (request === './eula-store') return { getStatus: () => ({ required: false }) };
  if (request === '../utils/logger') return { createLogger: () => ({ warn() {} }) };
  return originalLoad(request, parent, isMain);
};
const { createUsageTelemetry, deriveId, utcPeriods } = require('../server/services/usage-telemetry');
Module._load = originalLoad;

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-usage-test-'));
  const requests = [];
  const fixedNow = new Date('2026-08-10T12:00:00.000Z');
  const telemetry = createUsageTelemetry({
    config: { anonymousUsageEnabled: true, usageEndpoint: 'https://usage.example.test/api/v1/usage' },
    dataDir: dir,
    now: () => fixedNow,
    randomBytes: () => Buffer.alloc(32, 7),
    appVersion: '0.9.9.1',
    eulaAccepted: () => true,
    log: { warn() {} },
    fetch: async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) });
      return { ok: true, status: 202 };
    },
  });

  assert.deepStrictEqual(utcPeriods(fixedNow), { day: '2026-08-10', week: '2026-W32', month: '2026-08' });
  assert.strictEqual(deriveId('07'.repeat(32), 'day', '2026-08-10').length, 43);
  await telemetry.start();
  await telemetry.start();
  await telemetry.markCoreUsed();
  await telemetry.markCoreUsed();
  assert.strictEqual(requests.length, 2, 'startup is once per process and core use is once per UTC day');
  assert.deepStrictEqual(requests.map((entry) => entry.payload.event), ['startup', 'core_use']);
  assert.ok(!JSON.stringify(requests).includes('installId'));

  telemetry.setEnabled(false);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'usage-telemetry.json'), 'utf8'));
  assert.strictEqual(persisted.localSecret, null, 'disabling erases the local correlation secret');
  await telemetry.markCoreUsed();
  assert.strictEqual(requests.length, 2, 'disabled telemetry sends nothing');

  const disabledReload = createUsageTelemetry({
    config: { anonymousUsageEnabled: true, usageEndpoint: 'https://usage.example.test/api/v1/usage' },
    dataDir: dir,
    randomBytes: () => { throw new Error('disabled reload must not create a secret'); },
  });
  assert.strictEqual(disabledReload.getSettings().enabled, false);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('usage-telemetry tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
