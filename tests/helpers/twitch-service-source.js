'use strict';

// Source contracts cover the implementation after responsibility extraction;
// behavioral tests continue to exercise the public TwitchService instance.
const fs = require('fs');
const path = require('path');

module.exports = function twitchServiceSource() {
  const services = path.join(__dirname, '../../server/services');
  const modules = path.join(services, 'twitch-service');
  return [
    fs.readFileSync(path.join(services, 'twitch-service.js'), 'utf8'),
    ...fs.readdirSync(modules).filter(name => name.endsWith('.js')).sort()
      .map(name => fs.readFileSync(path.join(modules, name), 'utf8')),
  ].join('\n');
};
