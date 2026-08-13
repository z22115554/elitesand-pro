'use strict';

const express = require('express');
const QRCode = require('qrcode');
const accessStore = require('../services/device-access-store');
const authStore = require('../services/auth-store');
const requirePin = require('../middleware/require-pin');
const { getLanIp } = require('../utils/lan-info');
const { getClientAddress, isLoopbackAddress } = require('../utils/pin-setup-policy');

const router = express.Router();

function localDesktopOnly(req, res, next) {
  if (isLoopbackAddress(getClientAddress(req))) return next();
  return res.status(403).json({ error: 'Pairing and token management are available from the desktop app only.', code: 'LOCAL_DESKTOP_REQUIRED' });
}

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0');
}

router.get('/status', localDesktopOnly, requirePin, (req, res) => {
  noStore(res);
  res.json({ hasPin: authStore.hasPin(), ...accessStore.getLocalStatus() });
});

router.post('/pairing/start', localDesktopOnly, requirePin, async (req, res) => {
  noStore(res);
  const ip = getLanIp();
  const port = req.socket.localPort;
  if (!ip || !port) return res.status(503).json({ error: 'A LAN address is not available for phone pairing.', code: 'LAN_ADDRESS_UNAVAILABLE' });
  const pairing = accessStore.createPairing();
  const controllerUrl = `http://${ip}:${port}/controller?pair=${encodeURIComponent(pairing.code)}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(controllerUrl, { margin: 1, width: 240 });
    res.json({ controllerUrl, qrDataUrl, expiresAt: pairing.expiresAt });
  } catch (error) {
    res.status(500).json({ error: `Unable to generate pairing QR code: ${error.message}` });
  }
});

router.post('/pairing/complete', (req, res) => {
  noStore(res);
  const controllerToken = accessStore.redeemPairing(req.body?.pair);
  if (!controllerToken) return res.status(401).json({ error: 'This pairing QR code is invalid or has expired.', code: 'PAIRING_INVALID' });
  res.json({ ok: true, controllerToken });
});

router.post('/controllers/revoke', localDesktopOnly, requirePin, (req, res) => {
  noStore(res);
  res.json({ ok: true, ...accessStore.revokeControllers() });
});

module.exports = router;
