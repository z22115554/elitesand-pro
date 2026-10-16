'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { R2_NAMES, CHANNEL_KEYS, parseLocalR2Env, loadLocalEnvironment, main } = require('../renew-local');

const credentials = R2_NAMES.map((name, i) => `${name}=value-${i}`).join('\n');
function reader(file) {
  if (path.basename(file) === 'r2-beta-publisher.env') return credentials;
  return path.basename(file);
}

test('local credential parser only accepts the four R2 names and never evaluates shell syntax', () => {
  assert.deepEqual(parseLocalR2Env('\uFEFF# local\nELITESAND_R2_BUCKET="bucket-name"\nNODE_OPTIONS=--require=untrusted\nexport HOME=x\nELITESAND_R2_SECRET_ACCESS_KEY=literal$(command)`text`'), {
    ELITESAND_R2_BUCKET: 'bucket-name', ELITESAND_R2_SECRET_ACCESS_KEY: 'literal$(command)`text`',
  });
});

test('local renewal selects each channel original key and ignores other process secrets', () => {
  for (const channel of ['stable', 'beta']) {
    const result = loadLocalEnvironment(channel, { env: { ELITESAND_R2_BUCKET: 'override', UNRELATED_SECRET: 'private', ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64: 'wrong-channel' }, readFile: reader });
    assert.equal(result.ELITESAND_R2_BUCKET, 'override');
    assert.equal(result.ELITESAND_UPDATE_POLICY_KEY_ID, CHANNEL_KEYS[channel].id);
    assert.equal(Buffer.from(result.ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64, 'base64').toString(), CHANNEL_KEYS[channel].file);
    assert.equal(result.UNRELATED_SECRET, undefined);
    assert.deepEqual(Object.keys(result).sort(), [...R2_NAMES, 'ELITESAND_UPDATE_POLICY_KEY_ID', 'ELITESAND_UPDATE_POLICY_PRIVATE_KEY_B64'].sort());
  }
});

test('missing local files never echo file contents or raw read errors', () => {
  assert.throws(() => loadLocalEnvironment('stable', { readFile() { throw new Error('sensitive-value'); } }), e => !e.message.includes('sensitive-value') && /credentials/.test(e.message));
  assert.throws(() => loadLocalEnvironment('beta', { readFile(file) { if (file.endsWith('.pem')) throw new Error('sensitive-key'); return credentials; } }), e => !e.message.includes('sensitive-key') && /signing key/.test(e.message));
  assert.throws(() => loadLocalEnvironment('other'), /Unsupported/);
});

test('local command defaults to dry run and only forwards an explicit publish request', async () => {
  const calls = [];
  const runRenewal = async (argv, env) => { calls.push({ argv, env }); return { renewed: 2 }; };
  assert.deepEqual(await main([], { readFile: reader, env: {}, runRenewal }), { renewed: 2 });
  await main(['--channel', 'beta', '--publish'], { readFile: reader, env: {}, runRenewal });
  assert.deepEqual(calls[0].argv, []);
  assert.equal(calls[0].env.ELITESAND_UPDATE_POLICY_KEY_ID, CHANNEL_KEYS.stable.id);
  assert.deepEqual(calls[1].argv, ['--channel', 'beta', '--publish']);
  assert.equal(calls[1].env.ELITESAND_UPDATE_POLICY_KEY_ID, CHANNEL_KEYS.beta.id);
  await assert.rejects(main(['--channel', 'invalid'], { runRenewal }), /Usage/);
  assert.equal(calls.length, 2);
});
