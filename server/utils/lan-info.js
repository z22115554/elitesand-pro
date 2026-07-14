'use strict';

const os = require('os');
const { isPrivateAddress } = require('./socket-origin');

// 常見虛擬網卡名稱關鍵字：這些介面的 IP 對手機來說連不到，排在候選清單最後面。
const VIRTUAL_ADAPTER_HINTS = [
  'virtualbox', 'vmware', 'hyper-v', 'vethernet', 'docker', 'wsl',
  'loopback', 'tailscale', 'zerotier', 'tap-', 'tun-',
];

function isLikelyVirtual(name) {
  const n = String(name || '').toLowerCase();
  return VIRTUAL_ADAPTER_HINTS.some((hint) => n.includes(hint));
}

/**
 * 找出最適合給手機掃碼連線的區網 IPv4 位址。
 * 優先選非虛擬網卡的私有位址；找不到就退而求其次選第一個私有 IPv4；都沒有則回傳 null
 * （例如伺服器只有 loopback，或所有介面都被防毒/VPN 軟體標成虛擬）。
 */
function getLanIp() {
  const interfaces = os.networkInterfaces();
  let fallback = null;
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue;
      if (!isPrivateAddress(entry.address)) continue;
      if (!isLikelyVirtual(name)) return entry.address;
      if (!fallback) fallback = entry.address;
    }
  }
  return fallback;
}

module.exports = { getLanIp };
