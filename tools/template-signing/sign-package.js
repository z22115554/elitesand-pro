#!/usr/bin/env node
/**
 * 簽發一個付費模板包（CLOSED_SOURCE_MIGRATION_PLAN.md 批次 C-2）。
 *
 * 這是發布端工具，只在有私鑰的機器上跑（.local/template-signing/，不進 git，
 * 不會隨 app 發布）。跟 server/services/template-package-verify.js 是一組的：
 * 這裡簽、那裡驗，兩邊對 canonical JSON 的算法必須一致（用同一套 canonicalize()）。
 *
 * 用法：
 *   node tools/template-signing/sign-package.js <packageDir>
 *
 * <packageDir> 底下要有：
 *   template.config.json  - { templateId, version, displayName, minEngineVersion?, maxEngineVersion? }
 *   template.js            - 模板原始碼
 *
 * 跑完會在同一個目錄產生 manifest.json，整個目錄就是一個可驗證、可安裝的模板包。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonicalize } = require('../../server/services/template-package-verify');

const ROOT = path.join(__dirname, '..', '..');
const PRIVATE_KEY_PATH = path.join(ROOT, '.local', 'template-signing', 'template-signing-private-key.pem');

function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    throw new Error(`找不到簽章私鑰：${PRIVATE_KEY_PATH}\n先跑 node tools/template-signing/generate-keys.js`);
  }
  return crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'));
}

function main() {
  const packageDir = process.argv[2];
  if (!packageDir) {
    console.error('用法: node tools/template-signing/sign-package.js <packageDir>');
    process.exit(1);
  }
  const resolvedDir = path.resolve(packageDir);
  const configPath = path.join(resolvedDir, 'template.config.json');
  const assetPath = path.join(resolvedDir, 'template.js');

  if (!fs.existsSync(configPath)) throw new Error(`缺少 ${configPath}`);
  if (!fs.existsSync(assetPath)) throw new Error(`缺少 ${assetPath}`);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.templateId || !/^[a-z0-9-]{1,64}$/.test(config.templateId)) {
    throw new Error('template.config.json 的 templateId 必須是 a-z0-9- 組成');
  }
  if (!config.version) throw new Error('template.config.json 缺少 version');

  const assetContent = fs.readFileSync(assetPath);
  const assetHash = crypto.createHash('sha256').update(assetContent).digest('hex');

  const manifest = {
    schemaVersion: 1,
    templateId: config.templateId,
    version: config.version,
    displayName: config.displayName || { 'zh-TW': config.templateId, en: config.templateId },
    assets: [{ path: 'template.js', sha256: assetHash }],
  };
  if (config.minEngineVersion) manifest.minEngineVersion = config.minEngineVersion;
  if (config.maxEngineVersion) manifest.maxEngineVersion = config.maxEngineVersion;

  const privateKey = loadPrivateKey();
  const message = Buffer.from(canonicalize(manifest), 'utf8');
  const signature = crypto.sign(null, message, privateKey);
  manifest.signature = signature.toString('hex');

  const manifestPath = path.join(resolvedDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`已簽發模板包: ${resolvedDir}`);
  console.log(`  templateId: ${manifest.templateId}`);
  console.log(`  version: ${manifest.version}`);
  console.log(`  manifest.json 已寫入`);
}

main();
