'use strict';

const { server } = require('../../server/index');
server.once('listening', () => process.send({
  port: server.address().port,
  retainedShellKey: Object.hasOwn(process.env, 'ELITESAND_SHELL_HEALTH_KEY'),
}));
