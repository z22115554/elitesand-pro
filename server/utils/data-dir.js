'use strict';
const path = require('path');
const projectRoot = path.join(__dirname, '..', '..');
const dataDir = process.env.ELITESAND_DATA_DIR
  ? path.resolve(process.env.ELITESAND_DATA_DIR)
  : path.join(projectRoot, 'data');
module.exports = { dataDir, projectRoot };
