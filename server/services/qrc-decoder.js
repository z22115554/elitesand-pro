'use strict';

/**
 * QQ 音樂逐字歌詞（QRC）解碼。
 *
 * QRC 的內容是「三重 DES（解密－加密－解密）＋ zlib」，但它用的 DES 跟標準不一樣：
 *   1. 資料與金鑰都以 4 個位元組為一組、組內位元組順序顛倒後才進演算法，輸出也一樣顛倒回來；
 *   2. S 盒有兩格跟標準不同（第 2 盒第 2 列第 8 格是 15、第 4 盒第 4 列第 6 格是 10）；
 *   3. 產生回合金鑰時，後半 28 位取的位置比規格往後一格。
 * 所以不能直接用 Node 內建的 des-ede3。這裡照 DES 規格（FIPS 46-3 的置換表）自己實作，
 * 再套上上述兩點差異；一張歌詞不到一千個區塊，用位元陣列寫就夠快。
 */

const zlib = require('zlib');

const QRC_KEY = Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL', 'ascii');

// ── DES 規格的置換表（編號從 1 開始，照規格書原樣）──
const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];
const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];
const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11,
  12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21,
  22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];
const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];
const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];
const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

// 標準 S 盒；下面再改掉 QRC 不同的那兩格
const SBOX = [
  [
    [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
    [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
    [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
    [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  ],
  [
    [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
    [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
    [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
    [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  ],
  [
    [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
    [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
    [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
    [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  ],
  [
    [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
    [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
    [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
    [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  ],
  [
    [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
    [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
    [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
    [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  ],
  [
    [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
    [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
    [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
    [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  ],
  [
    [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
    [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
    [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
    [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  ],
  [
    [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
    [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
    [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
    [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
  ],
];
SBOX[1][1][7] = 15; // 標準是 14
SBOX[3][3][5] = 10; // 標準是 1

/** 8 個位元組 → 64 個位元；每 4 個位元組一組、組內順序顛倒（QRC 的特殊排法） */
function toBits(bytes, offset) {
  const bits = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    const value = bytes[offset + (i - (i % 4)) + (3 - (i % 4))];
    for (let b = 0; b < 8; b++) bits[i * 8 + b] = (value >> (7 - b)) & 1;
  }
  return bits;
}

function fromBits(bits, out, offset) {
  for (let i = 0; i < 8; i++) {
    let value = 0;
    for (let b = 0; b < 8; b++) value = (value << 1) | bits[i * 8 + b];
    out[offset + (i - (i % 4)) + (3 - (i % 4))] = value;
  }
}

function permute(bits, table) {
  const out = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) out[i] = bits[table[i] - 1];
  return out;
}

/** 一把 8 位元組金鑰 → 16 把 48 位元的回合金鑰 */
function roundKeys(key, offset) {
  const cd = permute(toBits(key, offset), PC1);
  let c = Array.from(cd.subarray(0, 28));
  let d = Array.from(cd.subarray(28));
  const keys = [];
  for (const shift of SHIFTS) {
    c = c.slice(shift).concat(c.slice(0, shift));
    d = d.slice(shift).concat(d.slice(0, shift));
    // 第三點差異：後半（D）取的位置比規格往後一格，超出 28 位的那一格當 0
    const key = new Uint8Array(48);
    for (let i = 0; i < 24; i++) key[i] = c[PC2[i] - 1];
    for (let i = 24; i < 48; i++) key[i] = d[PC2[i] - 28] || 0;
    keys.push(key);
  }
  return keys;
}

function feistel(right, key) {
  const expanded = permute(right, E);
  const out = new Uint8Array(32);
  for (let box = 0; box < 8; box++) {
    const o = box * 6;
    const b = (i) => expanded[o + i] ^ key[o + i];
    const row = (b(0) << 1) | b(5);
    const col = (b(1) << 3) | (b(2) << 2) | (b(3) << 1) | b(4);
    const value = SBOX[box][row][col];
    for (let i = 0; i < 4; i++) out[box * 4 + i] = (value >> (3 - i)) & 1;
  }
  return permute(out, P);
}

/** 單一區塊的 DES：keys 照使用順序給（解密時是反過來的 16 把） */
function desBlock(bits, keys) {
  const block = permute(bits, IP);
  let left = block.subarray(0, 32);
  let right = block.subarray(32);
  for (let round = 0; round < 16; round++) {
    const f = feistel(right, keys[round]);
    const next = new Uint8Array(32);
    for (let i = 0; i < 32; i++) next[i] = left[i] ^ f[i];
    left = right;
    right = next;
  }
  const pre = new Uint8Array(64);
  pre.set(right, 0);
  pre.set(left, 32);
  return permute(pre, FP);
}

/** 三重 DES 解密（解密－加密－解密）。長度必須是 8 的倍數。 */
function decryptQrcBytes(data) {
  const k1 = roundKeys(QRC_KEY, 0);
  const k2 = roundKeys(QRC_KEY, 8);
  const k3 = roundKeys(QRC_KEY, 16);
  const d1 = k1.slice().reverse();
  const d3 = k3.slice().reverse();
  const out = Buffer.alloc(data.length);
  for (let offset = 0; offset + 8 <= data.length; offset += 8) {
    let bits = toBits(data, offset);
    bits = desBlock(bits, d3);
    bits = desBlock(bits, k2);
    bits = desBlock(bits, d1);
    fromBits(bits, out, offset);
  }
  return out;
}

// 正常一首歌的密文是一兩萬個十六進位字元；超過這個長度的回應直接不處理
const MAX_HEX_LENGTH = 2 * 1024 * 1024;

/**
 * @param {string} hex 伺服器回傳的十六進位字串
 * @returns {string|null} 解出來的 QRC XML；格式不對或解不開回 null
 */
function decryptQrc(hex) {
  if (typeof hex !== 'string' || hex.length < 16 || hex.length > MAX_HEX_LENGTH || hex.length % 16 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  try {
    // 解壓上限 4MB：正常歌詞解開只有幾十 KB，擋掉異常回應把記憶體吃光
    const text = zlib.inflateSync(decryptQrcBytes(Buffer.from(hex, 'hex')), { maxOutputLength: 4 * 1024 * 1024 }).toString('utf8');
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  } catch {
    return null;
  }
}

module.exports = { decryptQrc, decryptQrcBytes };
