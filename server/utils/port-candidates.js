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

/**
 * 啟動頁要探的完整清單：目前 port 排第一，再來是「目前 port 自己的備援範圍」
 * （不是寫死的預設 port 備援範圍——使用者若把主要 port 設成非 3000，殼的備援會
 * 落在 current+1..current+10，這裡如果只探 3000 系列會永遠探不到，之前就是這樣壞的），
 * 最後才補預設 port 與它的備援，涵蓋「目前用預設 port，但殼備援跳到別的號碼」這種情況。
 */
function probePortsFor(current = DEFAULT_PORT) {
  const list = [];
  for (const candidate of [
    Number(current),
    ...fallbackPortsFor(current),
    DEFAULT_PORT,
    ...fallbackPortsFor(DEFAULT_PORT),
  ]) {
    if (Number.isInteger(candidate) && candidate > 0 && !list.includes(candidate)) list.push(candidate);
  }
  return list;
}

module.exports = { DEFAULT_PORT, PORT_FALLBACK_SPAN, fallbackPortsFor, probePortsFor };
