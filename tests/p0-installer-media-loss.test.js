'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MEDIA_MARKER_NAME,
  getSafeMediaDir,
  getVulnerableInstallMediaDir,
  preparePackagedMediaStorage,
} = require('../electron/packaged-media-storage');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-p0-media-'));
  const userData = path.join(root, 'user-data');
  const installRoot = path.join(root, 'installed-app');
  const executablePath = path.join(installRoot, 'Elitesand Pro.exe');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(executablePath, 'fixture', 'utf8');
  return { root, userData, installRoot, executablePath };
}

function writeConfig(userData, mediaDir) {
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'media-storage.json'),
    `${JSON.stringify({ version: 1, mediaDir }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(userData, 'media-storage.ini'), `[media]\npath=${mediaDir}\n`, 'utf8');
}

function readConfiguredPath(userData) {
  return JSON.parse(fs.readFileSync(path.join(userData, 'data', 'media-storage.json'), 'utf8')).mediaDir;
}

(function testNewInstallUsesPersistentUserDataMedia() {
  const fixture = makeFixture();
  const result = preparePackagedMediaStorage({
    userDataPath: fixture.userData,
    executablePath: fixture.executablePath,
  });
  const expected = getSafeMediaDir(fixture.userData);
  assert.strictEqual(result.action, 'initialized-safe-default');
  assert.strictEqual(path.resolve(result.mediaDir), path.resolve(expected));
  assert.strictEqual(path.resolve(readConfiguredPath(fixture.userData)), path.resolve(expected));
  assert.ok(fs.existsSync(path.join(expected, MEDIA_MARKER_NAME)));
  assert.ok(!path.resolve(expected).startsWith(`${path.resolve(fixture.installRoot)}${path.sep}`));
})();

(function testCustomMediaLocationIsNeverRedirected() {
  const fixture = makeFixture();
  const custom = path.join(fixture.root, 'custom-media');
  fs.mkdirSync(custom, { recursive: true });
  fs.writeFileSync(path.join(custom, MEDIA_MARKER_NAME), 'managed\n', 'utf8');
  writeConfig(fixture.userData, custom);

  const result = preparePackagedMediaStorage({
    userDataPath: fixture.userData,
    executablePath: fixture.executablePath,
  });
  assert.strictEqual(result.action, 'kept-configured');
  assert.strictEqual(path.resolve(result.mediaDir), path.resolve(custom));
  assert.strictEqual(path.resolve(readConfiguredPath(fixture.userData)), path.resolve(custom));
})();

(function testExistingV0997MediaIsCopiedAndVerifiedWithoutDeletingSource() {
  const fixture = makeFixture();
  const vulnerable = getVulnerableInstallMediaDir(fixture.executablePath);
  fs.mkdirSync(path.join(vulnerable, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(vulnerable, MEDIA_MARKER_NAME), 'managed\n', 'utf8');
  fs.writeFileSync(path.join(vulnerable, 'song-a.webm'), Buffer.from('audio-a'));
  fs.writeFileSync(path.join(vulnerable, 'nested', 'song-b.m4a'), Buffer.from('audio-b'));
  writeConfig(fixture.userData, vulnerable);

  const result = preparePackagedMediaStorage({
    userDataPath: fixture.userData,
    executablePath: fixture.executablePath,
  });
  const safe = getSafeMediaDir(fixture.userData);
  assert.strictEqual(result.action, 'copied-from-install-dir');
  assert.strictEqual(result.copiedEntries, 2);
  assert.deepStrictEqual(fs.readFileSync(path.join(safe, 'song-a.webm')), Buffer.from('audio-a'));
  assert.deepStrictEqual(fs.readFileSync(path.join(safe, 'nested', 'song-b.m4a')), Buffer.from('audio-b'));
  assert.ok(fs.existsSync(path.join(vulnerable, 'song-a.webm')), 'source media must remain intact');
  assert.strictEqual(path.resolve(readConfiguredPath(fixture.userData)), path.resolve(safe));
})();

(function testInstallerBackupRecoversStaleV0997Reference() {
  const fixture = makeFixture();
  const vulnerable = getVulnerableInstallMediaDir(fixture.executablePath);
  const safe = getSafeMediaDir(fixture.userData);
  writeConfig(fixture.userData, vulnerable);
  fs.mkdirSync(safe, { recursive: true });
  fs.writeFileSync(path.join(safe, MEDIA_MARKER_NAME), 'managed\n', 'utf8');
  fs.writeFileSync(path.join(safe, 'preserved-song.webm'), Buffer.from('preserved'));

  const result = preparePackagedMediaStorage({
    userDataPath: fixture.userData,
    executablePath: fixture.executablePath,
  });
  assert.strictEqual(result.action, 'recovered-installer-backup');
  assert.strictEqual(path.resolve(readConfiguredPath(fixture.userData)), path.resolve(safe));
  assert.deepStrictEqual(fs.readFileSync(path.join(safe, 'preserved-song.webm')), Buffer.from('preserved'));
})();

(function testPidProxyAndInstallerPreflightContracts() {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.ok(mainSource.includes('Reflect.get(target, prop, target)'), 'UtilityProcess getters must use the real target as receiver');
  assert.ok(!mainSource.includes('Reflect.get(target, prop, receiver)'), 'the broken Proxy receiver pattern must not return');

  const installerSource = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'installer-p0-media-preserve.nsh'),
    'utf8',
  );
  assert.ok(installerSource.includes('Call EsPreserveVulnerableMedia'));
  assert.ok(installerSource.includes('robocopy.exe'));
  assert.ok(installerSource.includes('$APPDATA\\Elitesand Pro\\downloads'));
})();

console.log('P0 installer media-loss regression tests passed');
