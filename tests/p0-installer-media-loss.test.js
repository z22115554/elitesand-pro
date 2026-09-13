'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MEDIA_MARKER_NAME,
  RECOVERY_REFERENCE_NAME,
  getPreferredSiblingMediaDir,
  getVulnerableInstallMediaDir,
  preparePackagedMediaStorage,
} = require('../electron/packaged-media-storage');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-p0-media-'));
  const userData = path.join(root, 'user-data');
  const appsRoot = path.join(root, 'apps');
  const installRoot = path.join(appsRoot, 'Elitesand Pro');
  const executablePath = path.join(installRoot, 'Elitesand Pro.exe');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(executablePath, 'fixture', 'utf8');
  return { root, userData, appsRoot, installRoot, executablePath };
}

function writeConfig(userData, mediaDir) {
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'media-storage.json'), `${JSON.stringify({ version: 1, mediaDir }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(userData, 'media-storage.ini'), `[media]\npath=${mediaDir}\n`, 'utf8');
}

function writeRecoveryReference(userData, mediaDir) {
  fs.writeFileSync(path.join(userData, RECOVERY_REFERENCE_NAME), `[media]\npath=${mediaDir}\n`, 'utf8');
}

function readConfiguredPath(userData) {
  return JSON.parse(fs.readFileSync(path.join(userData, 'data', 'media-storage.json'), 'utf8')).mediaDir;
}

function writeLegacyLibrary(fixture) {
  const legacy = getVulnerableInstallMediaDir(fixture.executablePath);
  fs.mkdirSync(path.join(legacy, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(legacy, MEDIA_MARKER_NAME), 'managed\n', 'utf8');
  fs.writeFileSync(path.join(legacy, 'song-a.webm'), Buffer.from('audio-a'));
  fs.writeFileSync(path.join(legacy, 'nested', 'song-b.m4a'), Buffer.from('audio-b'));
  writeConfig(fixture.userData, legacy);
  return legacy;
}

function runRound(round) {
  const fresh = makeFixture();
  const freshResult = preparePackagedMediaStorage({ userDataPath: fresh.userData, executablePath: fresh.executablePath });
  const expected = getPreferredSiblingMediaDir(fresh.executablePath);
  assert.strictEqual(freshResult.action, 'initialized-sibling-default');
  assert.strictEqual(path.resolve(freshResult.mediaDir), path.resolve(expected));
  assert.strictEqual(path.resolve(readConfiguredPath(fresh.userData)), path.resolve(expected));
  assert.ok(fs.existsSync(path.join(expected, MEDIA_MARKER_NAME)));
  assert.ok(!path.resolve(expected).startsWith(`${path.resolve(fresh.installRoot)}${path.sep}`));
  assert.ok(!path.resolve(expected).startsWith(`${path.resolve(fresh.userData)}${path.sep}`));
  assert.strictEqual(path.dirname(path.resolve(expected)), path.dirname(path.resolve(fresh.installRoot)));

  const upgrade = makeFixture();
  const legacy = writeLegacyLibrary(upgrade);
  const upgradeResult = preparePackagedMediaStorage({ userDataPath: upgrade.userData, executablePath: upgrade.executablePath });
  assert.strictEqual(upgradeResult.action, 'copied-from-install-dir');
  assert.strictEqual(upgradeResult.copiedEntries, 2);
  assert.deepStrictEqual(fs.readFileSync(path.join(upgradeResult.mediaDir, 'song-a.webm')), Buffer.from('audio-a'));
  assert.deepStrictEqual(fs.readFileSync(path.join(upgradeResult.mediaDir, 'nested', 'song-b.m4a')), Buffer.from('audio-b'));
  assert.deepStrictEqual(fs.readFileSync(path.join(legacy, 'song-a.webm')), Buffer.from('audio-a'));
  assert.deepStrictEqual(fs.readFileSync(path.join(legacy, 'nested', 'song-b.m4a')), Buffer.from('audio-b'));
  assert.strictEqual(path.resolve(readConfiguredPath(upgrade.userData)), path.resolve(upgradeResult.mediaDir));

  const installerRecovery = makeFixture();
  const oldPath = getVulnerableInstallMediaDir(installerRecovery.executablePath);
  const preserved = getPreferredSiblingMediaDir(installerRecovery.executablePath);
  writeConfig(installerRecovery.userData, oldPath);
  fs.mkdirSync(preserved, { recursive: true });
  fs.writeFileSync(path.join(preserved, MEDIA_MARKER_NAME), 'managed\n', 'utf8');
  fs.writeFileSync(path.join(preserved, 'preserved-song.webm'), Buffer.from('preserved'));
  writeRecoveryReference(installerRecovery.userData, preserved);
  const recovered = preparePackagedMediaStorage({ userDataPath: installerRecovery.userData, executablePath: installerRecovery.executablePath });
  assert.strictEqual(recovered.action, 'recovered-installer-backup');
  assert.strictEqual(path.resolve(readConfiguredPath(installerRecovery.userData)), path.resolve(preserved));
  assert.deepStrictEqual(fs.readFileSync(path.join(preserved, 'preserved-song.webm')), Buffer.from('preserved'));

  console.log(`P0 preservation round ${round}/3 passed`);
}

for (let round = 1; round <= 3; round++) runRound(round);

(function customLocationRemainsAuthoritative() {
  const fixture = makeFixture();
  const custom = path.join(fixture.root, 'custom-media');
  writeConfig(fixture.userData, custom);
  const result = preparePackagedMediaStorage({ userDataPath: fixture.userData, executablePath: fixture.executablePath });
  assert.strictEqual(result.action, 'kept-configured');
  assert.strictEqual(path.resolve(result.mediaDir), path.resolve(custom));
  assert.strictEqual(path.resolve(readConfiguredPath(fixture.userData)), path.resolve(custom));
  assert.ok(!fs.existsSync(custom));
})();

(function occupiedSiblingGetsSeparateDestination() {
  const fixture = makeFixture();
  const preferred = getPreferredSiblingMediaDir(fixture.executablePath);
  fs.mkdirSync(preferred, { recursive: true });
  fs.writeFileSync(path.join(preferred, 'unrelated-user-file.txt'), 'keep-me', 'utf8');
  const legacy = writeLegacyLibrary(fixture);
  const result = preparePackagedMediaStorage({ userDataPath: fixture.userData, executablePath: fixture.executablePath });
  assert.strictEqual(result.action, 'copied-from-install-dir');
  assert.notStrictEqual(path.resolve(result.mediaDir), path.resolve(preferred));
  assert.strictEqual(fs.readFileSync(path.join(preferred, 'unrelated-user-file.txt'), 'utf8'), 'keep-me');
  assert.ok(fs.existsSync(path.join(legacy, 'song-a.webm')));
})();

(function untrustedRecoveryFailsClosed() {
  const fixture = makeFixture();
  const oldPath = getVulnerableInstallMediaDir(fixture.executablePath);
  const untrusted = path.join(fixture.appsRoot, 'random-folder');
  writeConfig(fixture.userData, oldPath);
  fs.mkdirSync(untrusted, { recursive: true });
  fs.writeFileSync(path.join(untrusted, 'song.webm'), 'not-marked', 'utf8');
  writeRecoveryReference(fixture.userData, untrusted);
  const result = preparePackagedMediaStorage({ userDataPath: fixture.userData, executablePath: fixture.executablePath });
  assert.strictEqual(result.action, 'vulnerable-source-missing');
  assert.strictEqual(path.resolve(readConfiguredPath(fixture.userData)), path.resolve(oldPath));
  assert.strictEqual(fs.readFileSync(path.join(untrusted, 'song.webm'), 'utf8'), 'not-marked');
})();

function executableNsi(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(';'))
    .join('\n');
}

(function releaseContracts() {
  const root = path.join(__dirname, '..');
  const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.ok(mainSource.includes('Reflect.get(target, prop, target)'));
  assert.ok(!mainSource.includes('Reflect.get(target, prop, receiver)'));

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(packageJson.build.nsis.include, 'electron/installer.nsh');

  const installerSource = fs.readFileSync(path.join(root, 'electron', 'installer.nsh'), 'utf8');
  const installerExecutable = executableNsi(installerSource);
  assert.ok(installerSource.includes('DATA-SAFETY CONTRACT'));
  assert.ok(installerExecutable.includes('Call EsPreserveVulnerableMedia'));
  assert.ok(installerExecutable.includes('robocopy.exe'));
  assert.ok(installerExecutable.includes('/L /E /COPY:DAT'));
  assert.ok(installerExecutable.includes('media-preserve.ini'));
  assert.ok(!installerExecutable.includes('EsRemoveAllData'));
  assert.ok(!installerExecutable.includes('EsCleanupDeleteAll'));
  assert.ok(!installerExecutable.includes('RMDir /r "$APPDATA\\Elitesand Pro"'));
  assert.ok(!/RMDir\s+\/r\s+"\$0"/i.test(installerExecutable));
  assert.ok(!installerExecutable.includes('$APPDATA\\Elitesand Pro\\downloads'));

  const updaterSource = fs.readFileSync(path.join(root, 'server', 'services', 'app-updater-runner-v2.js'), 'utf8');
  assert.ok(updaterSource.includes("normalized === 'Elitesand Pro.exe'"));
  assert.ok(updaterSource.includes("normalized === 'resources/app.asar'"));
})();

console.log('P0 installer/media protection suite passed');
