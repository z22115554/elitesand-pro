'use strict';

/**
 * 這個請求是不是直接從本機連進來的（只看 TCP 連線的對端位址，不信任任何轉送標頭）。
 * 給「只准本機程式自己呼叫」的路由用：字體檔遞送、隱藏的分離引擎視窗回傳結果。
 */
function isDirectLoopback(req) {
  const address = req.socket && req.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

module.exports = { isDirectLoopback };
