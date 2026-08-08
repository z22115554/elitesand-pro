#!/usr/bin/env node
/**
 * 產生付費模板簽章用的 Ed25519 金鑰對（CLOSED_SOURCE_MIGRATION_PLAN.md 批次 C-2）。
 *
 * 只需要執行一次（或決定輪替公鑰時再執行）。私鑰只寫進 .local/（不進 git），
 * 公鑰寫進 server/services/template-public-key.js（這支檔案本來就該進 git——
 * 公鑰不是秘密，client 端本來就要內建它才能驗證）。
 *
 * 用法：node tools/template-signing/generate-keys.js
 * 若目的地已存在金鑰，預設拒絕覆蓋（避免手滑輪替公鑰讓舊模板包全部失效），
 * 要輪替請加 --force 並清楚知道後果：所有已用舊私鑰簽過的模板包都會驗證失敗。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const PRIVATE_KEY_PATH = path.join(ROOT, '.local', 'template-signing', 'template-signing-private-key.pem');
const PUBLIC_KEY_MODULE_PATH = path.join(ROOT, 'server', 'services', 'template-public-key.js');

function main() {
  const force = process.argv.includes('--force');
  if (!force && (fs.existsSync(PRIVATE_KEY_PATH) || fs.existsSync(PUBLIC_KEY_MODULE_PATH))) {
    console.error('簽章金鑰已存在。加 --force 才會覆蓋——這會讓所有用舊私鑰簽過的模板包全部驗證失敗。');
    process.exit(1);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' });
  // SPKI DER 的最後 32 bytes 是 Ed25519 的原始公鑰；直接存這 32 bytes 的 hex，
  // 驗證端用 crypto.createPublicKey({ key, format:'der', type:'spki' }) 讀回。
  const publicKeyHex = publicKeyRaw.toString('hex');

  fs.mkdirSync(path.dirname(PRIVATE_KEY_PATH), { recursive: true });
  fs.writeFileSync(PRIVATE_KEY_PATH, privatePem, { mode: 0o600 });

  const moduleSource = `/**
 * 付費模板簽章驗證用的公鑰（Ed25519，SPKI DER，hex 編碼）。
 * 這不是秘密——client 端本來就要內建它才能驗證模板包簽章。
 * 對應的私鑰只存在 .local/template-signing/（本機、不進 git），
 * 由 tools/template-signing/generate-keys.js 產生，
 * 由 tools/template-signing/sign-package.js 用來簽發模板包。
 *
 * 產生時間：${new Date().toISOString()}
 * 若要輪替：對舊私鑰簽過的模板包會全部失效，需重新簽發後隨新版 app 一起發布。
 */
'use strict';

module.exports = {
  TEMPLATE_PUBLIC_KEY_HEX: '${publicKeyHex}',
};
`;
  fs.writeFileSync(PUBLIC_KEY_MODULE_PATH, moduleSource);

  console.log('已產生金鑰對：');
  console.log('  私鑰（本機、不進 git）：', PRIVATE_KEY_PATH);
  console.log('  公鑰（進 git、隨 app 發布）：', PUBLIC_KEY_MODULE_PATH);
}

main();
