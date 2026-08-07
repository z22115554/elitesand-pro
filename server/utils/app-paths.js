'use strict';

// Keep all writable application paths in one place. The default layout stays
// exactly the same for the portable build; environment overrides are reserved
// for future desktop shells and isolated test runs.
const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');

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
