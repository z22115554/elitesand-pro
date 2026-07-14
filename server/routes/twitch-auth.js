/** Twitch Device Code 路由：開始授權與查看代碼都需 PIN。 */
const express = require('express');
const requirePin = require('../middleware/require-pin');
const { createLogger } = require('../utils/logger');

const log = createLogger('TwitchAuth');

module.exports = function createTwitchAuthRouter(twitch) {
  const router = express.Router();

  router.get('/api/twitch/status', requirePin, (_req, res) => {
    res.json(twitch.status());
  });

  router.get('/api/twitch/authorize', requirePin, (_req, res) => {
    Promise.resolve(twitch.beginAuthorization()).then((deviceAuthorization) => {
      res.json(deviceAuthorization);
    }).catch((err) => {
      res.status(400).json({ error: err.message });
    });
  });

  // Console 仍可保留這個 redirect URL；公開用戶端真正走的是 Device Code Flow，不會呼叫它。
  router.get('/auth/twitch/callback', (_req, res) => {
    log.info('收到未使用的 Twitch redirect callback，導回控制面板');
    res.redirect('/panel?twitch=device-code');
  });

  return router;
};
