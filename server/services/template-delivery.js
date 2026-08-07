/**
 * 歌詞模板遞送（CLOSED_SOURCE_MIGRATION_PLAN.md 批次 C-1）
 *
 * 目標：付費／自訂歌詞模板不再是安裝目錄裡具名可讀的 .js 檔，而是由本機 server
 * 決定要不要送、送什麼。瀏覽器收到的仍是普通的 `Content-Type: application/javascript`
 * 回應（不碰 CSP、不用 eval），OBS Browser Source 零風險。
 *
 * 兩種模式，由 server/template-store/ 是否存在自動判斷：
 * - 開發模式（沒有 template-store/）：直接讀 public/js/lyric-template-<id>.js 原始碼，
 *   跟今天的行為一致，改完存檔照樣 Ctrl+F5 就看得到，不需要額外的 pack 步驟。
 * - production build（tools/build-production-bundles.js 執行過 packTemplates 之後）：
 *   從 server/template-store/<id>.eltpl 讀 AES-256-GCM 加密 blob，用同一份 build
 *   產生的金鑰解密。金鑰就在本機這台跑 server 的機器上，這不是「無法破解」，只是把
 *   取得成本從「開資料夾複製」提高到「逆向 bundle 過的 server 挖金鑰」。
 *
 * 批次 C-2 補充：id 不是內建六個之一時，會再查已安裝的付費模板（見
 * template-package-install.js）——那邊的模板是使用者透過簽章驗證過的模板包
 * 主動安裝的，本檔案不做「有沒有買」的判斷，只負責「送不送得出來」。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { projectRoot } = require('../utils/app-paths');
const { BUILTIN_TEMPLATE_IDS: TEMPLATE_IDS } = require('./template-ids');

const STORE_DIR = path.join(projectRoot, 'server', 'template-store');
const DEV_SOURCE_DIR = path.join(projectRoot, 'public', 'js');
const KEY_MODULE_PATH = path.join(projectRoot, 'server', 'services', 'template-key.generated.js');

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function isPacked() {
  return fs.existsSync(STORE_DIR);
}

let cachedKey;
function loadKey() {
  if (cachedKey !== undefined) return cachedKey;
  if (!fs.existsSync(KEY_MODULE_PATH)) {
    cachedKey = null;
    return cachedKey;
  }
  const mod = require(KEY_MODULE_PATH);
  cachedKey = Buffer.from(mod.key, 'hex');
  return cachedKey;
}

function decryptBlob(blob, key) {
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const sourceCache = new Map();

/** 回傳模板的 JS 原始碼字串；id 不存在或找不到對應檔案回傳 null。 */
function getTemplateSource(id) {
  if (!TEMPLATE_IDS.has(id)) {
    // 不是內建模板 → 查已安裝的付費模板（批次 C-2）。這裡不快取：付費模板可能
    // 被使用者移除／更新，快取內建模板是因為那些檔案在同一個 server 行程生命週期
    // 內不會變，但已安裝模板的儲存位置是可變的使用者資料，每次都該讀最新狀態。
    // eslint-disable-next-line global-require
    const { getInstalledTemplateSource } = require('./template-package-install');
    return getInstalledTemplateSource(id);
  }
  // 開發模式故意不查、不寫快取：packed 版的加密 blob 在同一個 server 行程生命週期內
  // 不會變，快取是單純的效能優化；但 dev 模式讀的是開發者正在編輯的原始檔案，
  // 快取住會讓「改完存檔、Ctrl+F5 就看得到」這個 dev workflow 直接失效——
  // 這正是批次 C-1 一開始漏掉、之後才發現的真 bug。
  if (isPacked() && sourceCache.has(id)) return sourceCache.get(id);

  let code;
  if (isPacked()) {
    const key = loadKey();
    if (!key) throw new Error('模板已封裝但找不到解密金鑰（template-key.generated.js 缺失）');
    const blobPath = path.join(STORE_DIR, `${id}.eltpl`);
    if (!fs.existsSync(blobPath)) return null;
    code = decryptBlob(fs.readFileSync(blobPath), key);
  } else {
    const filePath = path.join(DEV_SOURCE_DIR, `lyric-template-${id}.js`);
    if (!fs.existsSync(filePath)) return null;
    code = fs.readFileSync(filePath, 'utf8');
  }
  if (isPacked()) sourceCache.set(id, code);
  return code;
}

/** 給 display-runtime-build.js 的快取指紋用：這個模板目前的內容雜湊。 */
function getTemplateFingerprint(id) {
  const code = getTemplateSource(id);
  if (code == null) return null;
  return crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
}

module.exports = {
  TEMPLATE_IDS,
  isPacked,
  getTemplateSource,
  getTemplateFingerprint,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
};
