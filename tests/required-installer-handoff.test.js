'use strict';

const assert = require('assert');
const test = require('node:test');
const { isRequiredInstallerHandoffPlan, runRequiredInstallerHandoff } = require('../electron/shell');

function installerPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    planId: 'stable-win32-x64-0.9.9.7-1.0.0-p8',
    keyId: 'test-key',
    channel: 'stable',
    platform: 'win32',
    arch: 'x64',
    fromVersion: '0.9.9.7',
    targetVersion: '1.0.0',
    delivery: 'installer',
    urgency: 'required',
    reasonCode: 'major-release',
    issuedAt: '2026-08-23T00:00:00.000Z',
    expiresAt: '2026-08-24T00:00:00.000Z',
    releaseNotesUrl: 'https://github.com/z22115554/elitesand-pro/releases/tag/v1.0.0',
    artifact: null,
    installer: {
      url: 'https://github.com/z22115554/elitesand-pro/releases/download/v1.0.0/Elitesand.Pro.Setup.1.0.0.exe',
      sha256: 'a'.repeat(64),
      size: 123456,
    },
    signatureAlgorithm: 'Ed25519',
    signature: '0'.repeat(128),
    ...overrides,
  };
}

test('required installer handoff only permits a complete, policy-shaped major or owner-forced plan', () => {
  assert.strictEqual(isRequiredInstallerHandoffPlan(installerPlan()), true);
  assert.strictEqual(isRequiredInstallerHandoffPlan(installerPlan({ urgency: 'optional' })), false);
  assert.strictEqual(isRequiredInstallerHandoffPlan(installerPlan({ reasonCode: 'hotfix' })), false);
  assert.strictEqual(isRequiredInstallerHandoffPlan(installerPlan({ installer: { ...installerPlan().installer, url: 'https://github.com/z22115554/elitesand-pro/releases/tag/v1.0.0' } })), false);
});

test('opening a required Installer never unlocks the app: it stays in native open-or-exit gate until the user exits', async () => {
  const urls = [];
  const prompts = [];
  const choices = ['open', 'exit'];
  const exited = await runRequiredInstallerHandoff({
    plan: installerPlan(),
    openExternal: async (url) => { urls.push(url); },
    prompt: async (state) => { prompts.push(state); return choices.shift(); },
  });
  assert.strictEqual(exited, true);
  assert.strictEqual(urls.length, 2, 'each explicit Open action launches only the signed Installer URL');
  assert.ok(prompts.every((state) => state.plan.delivery === 'installer'));

  const invalid = await runRequiredInstallerHandoff({
    plan: installerPlan({ urgency: 'optional' }),
    openExternal: async () => { throw new Error('must not open'); },
    prompt: async () => { throw new Error('must not prompt'); },
  });
  assert.strictEqual(invalid, false);
});

module.exports = { installerPlan };
