'use strict';

// Keep all writable application paths in one place. The default layout stays
// exactly the same for the portable build; environment overrides are reserved
// for future desktop shells and isolated test runs.
const fs = require('fs');
const path = require('path');

// 找 package.json 所在目錄，而不是硬編碼 __dirname 的相對層數：
// production build 會把 server/**/*.js 打包成單一檔案，屆時 __dirname
// 是輸出檔自己的位置，不再是這個原始檔案在 repo 裡的位置，寫死 '..','..'
// 會算出錯的路徑。往上找 package.json 在 bundle 前後都正確。
function findProjectRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const projectRoot = findProjectRoot(__dirname);

function resolveFromEnv(name, fallback) {
  const value = process.env[name];
  return value && String(value).trim() ? path.resolve(value) : fallback;
}

const dataDir = resolveFromEnv('ELITESAND_DATA_DIR', path.join(projectRoot, 'data'));
const downloadsDir = resolveFromEnv('ELITESAND_DOWNLOADS_DIR', path.join(projectRoot, 'downloads'));
const logsDir = resolveFromEnv('ELITESAND_LOGS_DIR', path.join(projectRoot, 'logs'));
const configPath = path.join(projectRoot, 'server', 'config.js');

module.exports = {
  projectRoot,
  dataDir,
  downloadsDir,
  logsDir,
  configPath,
};
