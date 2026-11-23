'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [mode, prefix] = process.argv.slice(2);
if (mode === 'leaf') {
  fs.writeFileSync(prefix + '.pid', String(process.pid));
  fs.appendFileSync(prefix + '.ticks', '.');
  setInterval(() => fs.appendFileSync(prefix + '.ticks', '.'), 15);
} else if (mode === 'parent') {
  const leaf = spawn(process.execPath, [__filename, 'leaf', prefix], {
    stdio: 'ignore', windowsHide: true,
  });
  const timer = setInterval(() => {
    if (!fs.existsSync(prefix + '.pid')) return;
    clearInterval(timer);
    process.stdout.write(JSON.stringify({ parent: process.pid, leaf: leaf.pid }) + '\n');
  }, 10);
  setInterval(() => {}, 10000);
}
