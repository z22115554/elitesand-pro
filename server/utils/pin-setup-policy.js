'use strict';

/**
 * PIN 首次設定政策。
 *
 * 伺服器會對區網開放，未設定 PIN 的期間不能讓第一個遠端連線者
 * 直接把控制權鎖走。因此首次設定只接受本機 loopback 連線；
 * 已有 PIN 後，原本的 currentPin 驗證仍允許使用者從已授權的遙控器
 * 變更或停用 PIN。
 */

function getClientAddress(req) {
  // 以 TCP socket 為準，不信任可由 client 偽造的轉送標頭。
  return String(
    req?.socket?.remoteAddress
    || req?.connection?.remoteAddress
    || req?.ip
    || '',
  ).trim().toLowerCase();
}

function isLoopbackAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  if (!address) return false;
  if (address === '::1' || address === 'localhost') return true;

  // Node 在 Windows/dual-stack 環境可能回傳 IPv4-mapped IPv6。
  const mapped = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  const parts = mapped.split('.');
  if (parts.length !== 4) return false;
  return Number(parts[0]) === 127
    && parts.slice(1).every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function canSetFirstPin({ hasPin, address }) {
  return Boolean(hasPin) || isLoopbackAddress(address);
}

module.exports = { getClientAddress, isLoopbackAddress, canSetFirstPin };
