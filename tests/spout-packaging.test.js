"use strict";

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

exports.register = ({ test, testAsync, eq, ok }) => {
  testAsync('ASAR package retains third-party notices and rejects an omitted license', async () => {
    const { createPackage, listPackage } = require('@electron/asar');
    const { REQUIRED_NOTICE_FILES, verifyBundledNotices } = require('../tools/verify-electron-package');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-notices-'));
    const stage = path.join(root, 'app');
    const archive = path.join(root, 'app.asar');
    const contents = () => listPackage(archive).map(file => file.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
    try {
      for (const file of REQUIRED_NOTICE_FILES) {
        const destination = path.join(stage, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(__dirname, '..', file), destination);
      }
      await createPackage(stage, archive);
      verifyBundledNotices(contents());
      fs.unlinkSync(path.join(stage, 'public/vendor/soundtouch-LGPL-2.1.txt'));
      // A second path avoids the ASAR reader's cache for the previous archive.
      const missingArchive = path.join(root, 'missing.asar');
      await createPackage(stage, missingArchive);
      const missing = listPackage(missingArchive).map(file => file.replace(/^[/\\]+/, '').replace(/\\/g, '/'));
      let error;
      try { verifyBundledNotices(missing); } catch (err) { error = err; }
      ok(error?.message.includes('soundtouch-LGPL-2.1.txt'), 'packaging must reject a missing LGPL text');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  // These build entry points require Windows PowerShell.
  if (process.platform !== 'win32') return;
  for (const script of ['build-portable.ps1', 'build-installer.ps1']) {
    for (const state of ['missing', 'empty', 'directory']) {
      test(`${script} rejects ${state} Spout before touching the build`, () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elitesand-spout-preflight-'));
        try {
          fs.mkdirSync(path.join(root, 'tools'));
          const target = path.join(root, 'tools', script);
          fs.copyFileSync(path.join(__dirname, '..', 'tools', script), target);
          const addon = path.join(root, '.local', 'spout-output-build', 'elitesand_spout_output.node');
          if (state !== 'missing') {
            fs.mkdirSync(path.dirname(addon), { recursive: true });
            if (state === 'empty') fs.writeFileSync(addon, '');
            else fs.mkdirSync(addon);
          }
          const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target], {
            encoding: 'utf8', timeout: 15000, windowsHide: true,
          });
          if (result.error) throw result.error;
          const output = result.stdout + result.stderr;
          eq(result.status, 1, output);
          ok(output.includes('Required Spout native addon is missing or empty'), output);
          ok(!output.includes('Running required test gate'), 'must fail before invoking npm');
          ok(!fs.existsSync(path.join(root, 'dist')), 'must not create or clear staging');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }
};
