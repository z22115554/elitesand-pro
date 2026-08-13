'use strict';

const accessStore = require('../services/device-access-store');
const { getClientAddress, isLoopbackAddress } = require('../utils/pin-setup-policy');

function sourceTokenFrom(request) {
  return String(request?.query?.source || request?.headers?.['x-elitesand-source'] || '');
}

function isLocalPreview(request) {
  // A local Browser Source is in the same desktop trust boundary.  LAN-facing
  // output always needs the separate Source Token, including non-preview URLs.
  return isLoopbackAddress(getClientAddress(request));
}

function requireSourceAccess(req, res, next) {
  if (isLocalPreview(req) || accessStore.verifySourceToken(sourceTokenFrom(req))) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(401).json({
    error: 'An OBS Source Token is required for this output.',
    code: 'SOURCE_TOKEN_REQUIRED',
  });
}

module.exports = { sourceTokenFrom, isLocalPreview, requireSourceAccess };
