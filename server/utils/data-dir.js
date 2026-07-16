'use strict';

// Compatibility export for modules added before app-paths.js. New code should
// import from app-paths directly so every writable location has one authority.
const { dataDir, projectRoot } = require('./app-paths');

module.exports = { dataDir, projectRoot };
