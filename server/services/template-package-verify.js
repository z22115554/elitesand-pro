/**
 * 付費模板包驗證（CLOSED_SOURCE_MIGRATION_PLAN.md 批次 C-2）
 *
 * 驗證一個「模板包」是否真的由官方簽發、內容未被竄改、跟目前引擎版本相容。
 * 只做驗證，不做「有沒有買」的判斷（那是商城/帳號系統的事，本階段不實作）。
 *
 * 模板包格式（單一目錄）：
 *   manifest.json   - 見 validateManifestShape() 的欄位需求
 *   <assets 內列出的檔案，通常是一個 template.js>
 *
 * 簽章對象是 manifest 扣掉 signature 欄位後的 canonical JSON（鍵值依字母排序，
 * 序列化結果固定），用 Ed25519 對這段 bytes 簽章。
 *
 * 誠實聲明：這一層防的是「模板包被竄改」與「不是官方簽發的假模板」，
 * 不是「無法被逆向」——瀏覽器最終還是會執行這段 JS，執行期本身天生可被檢視。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compareVersions } = require('../utils/version-compare');
const { APP_VERSION } = require('../utils/app-version');
const { TEMPLATE_PUBLIC_KEY_HEX } = require('./template-public-key');

const SCHEMA_VERSION = 1;
const TEMPLATE_ID_RE = /^[a-z0-9-]{1,64}$/;
const MAX_ASSETS = 8;
const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5MB／檔，模板不該比這大

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalManifestBytes(manifest) {
  const { signature, ...rest } = manifest;
  return Buffer.from(canonicalize(rest), 'utf8');
}

function loadPublicKey(publicKeyHex) {
  const der = Buffer.from(publicKeyHex, 'hex');
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function fail(reason) {
  return { ok: false, reason };
}

function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object') return '缺少 manifest';
  if (manifest.schemaVersion !== SCHEMA_VERSION) return `不支援的 schemaVersion: ${manifest.schemaVersion}`;
  if (typeof manifest.templateId !== 'string' || !TEMPLATE_ID_RE.test(manifest.templateId)) return 'templateId 格式不合法';
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) return '缺少 version';
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) return '缺少 assets';
  if (manifest.assets.length > MAX_ASSETS) return `assets 數量超過上限 ${MAX_ASSETS}`;
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.path !== 'string') return 'asset 缺少 path';
    // 只允許單層檔名：擋掉 '../' 路徑穿越與絕對路徑
    if (asset.path.includes('/') || asset.path.includes('\\') || asset.path.includes('..')) {
      return `asset path 不合法（不得含路徑分隔符）: ${asset.path}`;
    }
    if (!/^[a-zA-Z0-9_.-]+\.js$/.test(asset.path)) return `asset 必須是 .js 檔: ${asset.path}`;
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) return `asset sha256 格式不合法: ${asset.path}`;
  }
  if (typeof manifest.signature !== 'string' || !/^[a-f0-9]+$/.test(manifest.signature)) return '缺少或格式不合法的 signature';
  if (manifest.minEngineVersion !== undefined && typeof manifest.minEngineVersion !== 'string') return 'minEngineVersion 格式不合法';
  if (manifest.maxEngineVersion !== undefined && typeof manifest.maxEngineVersion !== 'string') return 'maxEngineVersion 格式不合法';
  return null;
}

function checkEngineCompatibility(manifest, engineVersion) {
  if (manifest.minEngineVersion && compareVersions(engineVersion, manifest.minEngineVersion) < 0) {
    return `需要引擎版本 >= ${manifest.minEngineVersion}，目前是 ${engineVersion}`;
  }
  if (manifest.maxEngineVersion && compareVersions(engineVersion, manifest.maxEngineVersion) > 0) {
    return `需要引擎版本 <= ${manifest.maxEngineVersion}，目前是 ${engineVersion}`;
  }
  return null;
}

/**
 * 驗證一個模板包目錄。回傳 { ok: true, manifest, assetContents } 或 { ok: false, reason }。
 * assetContents 是 { [assetPath]: Buffer }，方便呼叫端不用再讀第二次。
 *
 * publicKeyHex 只給測試／開發用：不傳就一定是真正發布用的公鑰（TEMPLATE_PUBLIC_KEY_HEX）。
 * production 程式碼路徑（template-package-install.js、server/index.js）絕不可傳這個參數，
 * 否則等於讓測試金鑰簽的模板包在正式環境也能通過驗證。
 */
function verifyTemplatePackageDir(packageDir, { engineVersion = APP_VERSION, publicKeyHex = TEMPLATE_PUBLIC_KEY_HEX } = {}) {
  const manifestPath = path.join(packageDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return fail('找不到 manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return fail(`manifest.json 不是合法 JSON: ${err.message}`);
  }

  const shapeError = validateManifestShape(manifest);
  if (shapeError) return fail(shapeError);

  const engineError = checkEngineCompatibility(manifest, engineVersion);
  if (engineError) return fail(engineError);

  // 簽章驗證：任何一個位元被改過都必須失敗
  let signatureValid = false;
  try {
    const publicKey = loadPublicKey(publicKeyHex);
    const signature = Buffer.from(manifest.signature, 'hex');
    const message = canonicalManifestBytes(manifest);
    signatureValid = crypto.verify(null, message, publicKey, signature);
  } catch (_) {
    signatureValid = false;
  }
  if (!signatureValid) return fail('簽章驗證失敗（模板包可能被竄改，或不是官方簽發）');

  // 資產雜湊驗證：manifest 宣稱的雜湊必須跟實際檔案內容一致
  const assetContents = {};
  for (const asset of manifest.assets) {
    const assetPath = path.join(packageDir, asset.path);
    if (!fs.existsSync(assetPath)) return fail(`缺少宣告的資產: ${asset.path}`);
    const stat = fs.statSync(assetPath);
    if (stat.size > MAX_ASSET_BYTES) return fail(`資產超過大小上限: ${asset.path}`);
    const content = fs.readFileSync(assetPath);
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    if (actualHash !== asset.sha256) return fail(`資產雜湊不符（可能被竄改）: ${asset.path}`);
    assetContents[asset.path] = content;
  }

  return { ok: true, manifest, assetContents };
}

module.exports = {
  SCHEMA_VERSION,
  TEMPLATE_ID_RE,
  canonicalize,
  canonicalManifestBytes,
  validateManifestShape,
  checkEngineCompatibility,
  verifyTemplatePackageDir,
};
