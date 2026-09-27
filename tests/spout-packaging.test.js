"use strict";

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

exports.register = ({ test, eq, ok }) => {
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
