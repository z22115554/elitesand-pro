'use strict';

const accessStore = require('../services/device-access-store');
const { getClientAddress, isLoopbackAddress } = require('../utils/pin-setup-policy');

function controllerTokenFrom(request) {
  const header = request?.headers?.['x-elitesand-controller'];
  if (typeof header === 'string' && header) return header;
  const authorization = String(request?.headers?.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match ? match[1].trim() : '';
}

function hasControlAccess(request) {
  return isLoopbackAddress(getClientAddress(request))
    || accessStore.verifyControllerToken(controllerTokenFrom(request));
}

function requireControlAccess(req, res, next) {
  if (hasControlAccess(req)) return next();
  return res.status(401).json({
    error: 'This controller has not been paired with the desktop app.',
    code: 'CONTROLLER_PAIRING_REQUIRED',
  });
}

module.exports = { controllerTokenFrom, hasControlAccess, requireControlAccess };
