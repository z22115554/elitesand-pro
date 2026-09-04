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

/**
 * 兩個都不是純數字的 identifier（例如 "test9" 對 "test10"）用純字串比較會讓
 * "test10" < "test9"（單、雙位數交界的經典錯誤）。改成把字母／數字分段後逐段比較，
 * 數字段落用數值比、其餘段落維持字串比，數字段落之間仍照 semver 規則排在字母段落之後。
 */
function naturalCompare(a, b) {
  const runs = (value) => value.match(/\d+|\D+/g) || [];
  const partsA = runs(a);
  const partsB = runs(b);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const partA = partsA[i];
    const partB = partsB[i];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    if (partA === partB) continue;
    const numA = /^\d+$/.test(partA);
    const numB = /^\d+$/.test(partB);
    if (numA && numB) {
      const diff = Number(partA) - Number(partB);
      if (diff !== 0) return diff > 0 ? 1 : -1;
      continue;
    }
    return partA > partB ? 1 : -1;
  }
  return 0;
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
  return a === b ? 0 : naturalCompare(a, b);
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
