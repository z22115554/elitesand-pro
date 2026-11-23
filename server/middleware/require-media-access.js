'use strict';
const accessStore = require('../services/device-access-store');
const { getClientAddress, isLoopbackAddress } = require('../utils/pin-setup-policy');
const SOURCE_COOKIE = 'elitesand-media-source';
const CONTROL_COOKIE = 'elitesand-media-controller';
function cookie(req, name) {
  for (const part of String(req?.headers?.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { return ''; }
    }
  }
  return '';
}
function rememberMediaCredential(req, res, name, value) {
  if (value && cookie(req, name) !== value) res.cookie?.(name, value, {
    httpOnly: true, sameSite: 'strict', path: '/', secure: req.secure === true,
  });
}
function requireMediaAccess(req, res, next) {
  if (isLoopbackAddress(getClientAddress(req))) return next();
  const source = String(req.query?.source || req.headers?.['x-elitesand-source'] || cookie(req, SOURCE_COOKIE));
  const controller = String(req.headers?.['x-elitesand-controller'] || cookie(req, CONTROL_COOKIE));
  if (accessStore.verifySourceToken(source) || accessStore.verifyControllerToken(controller)) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(401).json({ code: 'MEDIA_ACCESS_REQUIRED', error: '請先配對控制裝置，或使用有效的 OBS 來源連結。' });
}
module.exports = { requireMediaAccess, rememberMediaCredential, SOURCE_COOKIE, CONTROL_COOKIE };
