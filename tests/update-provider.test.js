'use strict';

const assert = require('assert');
const {
  createGitHubReleaseProvider,
  assertNormalizedUpdatePlan,
} = require('../server/services/update-provider');

let passed = 0;
function testAsync(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

const release = {
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/z22115554/elitesand-pro/releases/tag/v1.0.0',
  assets: [
    { name: 'Elitesand Pro Setup 1.0.0.exe', browser_download_url: 'https://github.com/z22115554/elitesand-pro/releases/download/v1.0.0/Elitesand%20Pro%20Setup%201.0.0.exe' },
    { name: 'update.zip', browser_download_url: 'https://example.invalid/update.zip' },
    { name: 'update.zip.sha256', browser_download_url: 'https://example.invalid/update.zip.sha256' },
  ],
};

(async () => {
  console.log('\n[update-provider]');

  await testAsync('GitHub provider 只回傳正規化 metadata，絕不帶 ZIP 或 runner', async () => {
    const provider = createGitHubReleaseProvider({
      repo: 'z22115554/elitesand-pro',
      currentVersion: '0.9.9.7',
      fetchLatestRelease: async () => release,
      canIncremental: () => true,
    });
    const plan = await provider.getPlan();
    assert.equal(provider.id, 'github-release');
    assert.equal(plan.hasUpdate, true);
    assert.equal(plan.canIncremental, true);
    assert.equal(plan.latestVersion, '1.0.0');
    assert.equal(plan.downloadUrl, release.assets[0].browser_download_url);
    assert.doesNotThrow(() => assertNormalizedUpdatePlan(plan));
    assert.ok(!Object.prototype.hasOwnProperty.call(plan, 'assets'));
  });

  await testAsync('無更新、無來源及 404 皆保留既有安全語意', async () => {
    const noSource = createGitHubReleaseProvider({ repo: '', currentVersion: '0.9.9.7', fetchLatestRelease: async () => release });
    assert.match((await noSource.getPlan()).reason, /未設定/);
    const current = createGitHubReleaseProvider({ repo: 'owner/repo', currentVersion: '1.0.0', fetchLatestRelease: async () => release });
    assert.equal((await current.getPlan()).reason, '已是最新版本');
    const missing = createGitHubReleaseProvider({ repo: 'owner/repo', currentVersion: '0.9.9.7', fetchLatestRelease: async () => { const error = new Error('missing'); error.status = 404; throw error; } });
    assert.match((await missing.getPlan()).reason, /尚未公開/);
  });

  await testAsync('contract guard 拒絕 provider 偷帶下載 bytes 或執行能力', async () => {
    assert.throws(() => assertNormalizedUpdatePlan({ zipBuffer: Buffer.from('bad') }), /forbidden/);
    assert.throws(() => assertNormalizedUpdatePlan({ runner: () => {} }), /forbidden/);
  });

  console.log(`[update-provider] ${passed} tests passed.`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
