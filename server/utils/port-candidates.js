'use strict';

/**
 * 主程式 port 候選清單，桌面殼（被佔用時往後找）與 OBS 啟動頁（探測）共用同一份，
 * 兩邊才不會各自表述：殼可能挑到的 port，啟動頁一定探得到。
 */
const DEFAULT_PORT = 3000;
const PORT_FALLBACK_SPAN = 10; // 3001..3010

function fallbackPortsFor(base = DEFAULT_PORT) {
  const start = Number(base);
  if (!Number.isInteger(start) || start <= 0) return [];
  const list = [];
  for (let i = 1; i <= PORT_FALLBACK_SPAN; i += 1) if (start + i <= 65535) list.push(start + i);
  return list;
}

/** 啟動頁要探的完整清單：目前 port 排第一，再預設 port 與其備援。 */
function probePortsFor(current = DEFAULT_PORT) {
  const list = [];
  for (const candidate of [Number(current), DEFAULT_PORT, ...fallbackPortsFor(DEFAULT_PORT)]) {
    if (Number.isInteger(candidate) && candidate > 0 && !list.includes(candidate)) list.push(candidate);
  }
  return list;
}

module.exports = { DEFAULT_PORT, PORT_FALLBACK_SPAN, fallbackPortsFor, probePortsFor };
