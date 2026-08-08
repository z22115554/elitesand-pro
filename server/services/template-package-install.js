/**
 * 已驗證模板包的本機安裝與儲存（CLOSED_SOURCE_MIGRATION_PLAN.md 批次 C-2／C-3）。
 *
 * 跟 6 個內建模板（server/template-store/，build 時封裝、隨 app 一起發布）是兩套
 * 分開的儲存：付費模板不預裝（C-3），這裡的目錄在使用者實際安裝一個模板包之前
 * 完全是空的。安裝金鑰是「第一次安裝時在本機產生、持久保存」，不是 build-time key，
 * 因此在 dev 模式與 production build 行為一致，不需要額外的封裝步驟。
 *
 * 資料放 dataDir（跟 data/downloads/logs 同一層，走 ELITESAND_DATA_DIR override），
 * 不是 projectRoot——更新器/解除安裝要保留使用者資料的規則本來就適用這裡。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('../utils/app-paths');
const { verifyTemplatePackageDir } = require('./template-package-verify');
const { BUILTIN_TEMPLATE_IDS } = require('./template-ids');

const STORE_DIR = path.join(dataDir, 'template-store');
const LOCAL_KEY_PATH = path.join(STORE_DIR, 'local-key.bin');
const MANIFEST_PATH = path.join(STORE_DIR, 'installed.json');
const IV_LENGTH = 12;

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function loadOrCreateLocalKey() {
  ensureStoreDir();
  if (fs.existsSync(LOCAL_KEY_PATH)) return fs.readFileSync(LOCAL_KEY_PATH);
  const key = crypto.randomBytes(32);
  fs.writeFileSync(LOCAL_KEY_PATH, key, { mode: 0o600 });
  return key;
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeManifest(manifest) {
  ensureStoreDir();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function encrypt(content, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decrypt(blob, key) {
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = blob.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * 把「已經驗證過」的 manifest + 資產內容寫進本機儲存。跟 verifyTemplatePackageDir
 * 分開，方便測試 ID 衝突／覆蓋等安裝邏輯本身，不必每個案例都重新走一次簽章驗證。
 * 正式路徑一律透過 installTemplatePackage()，不會有人跳過驗證直接呼叫這個。
 */
function installVerifiedTemplate(manifest, assetContents) {
  if (BUILTIN_TEMPLATE_IDS.has(manifest.templateId)) {
    return { ok: false, reason: `templateId 跟內建模板衝突: ${manifest.templateId}` };
  }

  const primaryAsset = manifest.assets[0];
  const content = assetContents[primaryAsset.path];
  const key = loadOrCreateLocalKey();
  const blob = encrypt(content, key);

  ensureStoreDir();
  fs.writeFileSync(path.join(STORE_DIR, `${manifest.templateId}.eltpl`), blob);

  const installed = readManifest();
  installed[manifest.templateId] = {
    version: manifest.version,
    displayName: manifest.displayName,
    installedAt: new Date().toISOString(),
  };
  writeManifest(installed);

  return { ok: true, templateId: manifest.templateId, version: manifest.version };
}

/**
 * 驗證並安裝一個模板包目錄。回傳 { ok, reason?, templateId?, version? }。
 * 不覆蓋既有安裝的舊版本判斷：目前策略是「後裝的版本直接取代」，
 * 沒有版本比較——安裝本來就是使用者主動觸發的行為。
 */
function installTemplatePackage(packageDir, { engineVersion } = {}) {
  const result = verifyTemplatePackageDir(packageDir, engineVersion ? { engineVersion } : {});
  if (!result.ok) return { ok: false, reason: result.reason };
  return installVerifiedTemplate(result.manifest, result.assetContents);
}

function listInstalledTemplates() {
  return readManifest();
}

function isInstalled(id) {
  return Object.prototype.hasOwnProperty.call(readManifest(), id);
}

/** 取得已安裝模板的解密內容；未安裝回傳 null。 */
function getInstalledTemplateSource(id) {
  if (!isInstalled(id)) return null;
  const blobPath = path.join(STORE_DIR, `${id}.eltpl`);
  if (!fs.existsSync(blobPath)) return null;
  const key = loadOrCreateLocalKey();
  return decrypt(fs.readFileSync(blobPath), key).toString('utf8');
}

/** 移除一個已安裝模板（使用者主動操作；更新器不會呼叫這個）。 */
function removeInstalledTemplate(id) {
  const installed = readManifest();
  if (!Object.prototype.hasOwnProperty.call(installed, id)) return false;
  delete installed[id];
  writeManifest(installed);
  const blobPath = path.join(STORE_DIR, `${id}.eltpl`);
  if (fs.existsSync(blobPath)) fs.unlinkSync(blobPath);
  return true;
}

module.exports = {
  installTemplatePackage,
  installVerifiedTemplate,
  listInstalledTemplates,
  isInstalled,
  getInstalledTemplateSource,
  removeInstalledTemplate,
  STORE_DIR,
};
