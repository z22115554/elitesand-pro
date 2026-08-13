'use strict';

const { isAllowedHttpHost } = require('../utils/socket-origin');

/**
 * DNS rebinding 防護：本機伺服器只接受 loopback、機器名稱或私網 IP 的 Host。
 * 放在所有 body parser / 靜態檔 / API 路由之前，避免不可信 Host 觸及任何應用程式資料。
 */
function hostGuard(req, res, next) {
  if (isAllowedHttpHost(req?.headers?.host)) return next();
  return res.status(421).json({
    error: '要求的 Host 不受信任',
    code: 'HOST_NOT_ALLOWED',
  });
}

module.exports = { hostGuard };
