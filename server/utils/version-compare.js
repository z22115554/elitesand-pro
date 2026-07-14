/**
 * 輕量版本號比對
 * 支援 "1.2.3"、"v1.2.3"、"1.2" 與 prerelease，不需要完整 semver 套件。
 * 同一個 core version 下，正式版必須高於 prerelease（SemVer 規則）。
 */

/**
 * 解析版本字串為數字陣列，移除前綴的 'v'/'V'
 * @param {string} version
 * @returns {number[]}
 */
function parseVersion(version) {
  if (!version || typeof version !== 'string') return [0];
  const cleaned = version.trim().replace(/^[vV]/, '').split('+', 1)[0].split('-', 1)[0];
  return cleaned.split('.').map(part => {
    const n = parseInt(part, 10);
    return isNaN(n) ? 0 : n;
  });
}

function parsePrerelease(version) {
  if (!version || typeof version !== 'string') return [];
  const cleaned = version.trim().replace(/^[vV]/, '').split('+', 1)[0];
  const separator = cleaned.indexOf('-');
  return separator === -1 ? [] : cleaned.slice(separator + 1).split('.').filter(Boolean);
}

function comparePrereleaseIdentifier(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) {
    const na = Number(a);
    const nb = Number(b);
    return na === nb ? 0 : (na > nb ? 1 : -1);
  }
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a === b ? 0 : (a > b ? 1 : -1);
}

/**
 * 比較兩個版本號
 * @param {string} a
 * @param {string} b
 * @returns {number} a>b 回傳 1，a<b 回傳 -1，相等回傳 0
 */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }

  const preA = parsePrerelease(a);
  const preB = parsePrerelease(b);
  if (!preA.length && !preB.length) return 0;
  if (!preA.length) return 1;
  if (!preB.length) return -1;
  const preLen = Math.max(preA.length, preB.length);
  for (let i = 0; i < preLen; i++) {
    if (preA[i] === undefined) return -1;
    if (preB[i] === undefined) return 1;
    const compared = comparePrereleaseIdentifier(preA[i], preB[i]);
    if (compared !== 0) return compared;
  }
  return 0;
}

/**
 * 判斷 latest 是否比 current 新
 */
function isNewerVersion(latest, current) {
  return compareVersions(latest, current) > 0;
}

module.exports = { parseVersion, parsePrerelease, compareVersions, isNewerVersion };
