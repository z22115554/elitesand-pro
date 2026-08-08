/**
 * 付費模板簽章驗證用的公鑰（Ed25519，SPKI DER，hex 編碼）。
 * 這不是秘密——client 端本來就要內建它才能驗證模板包簽章。
 * 對應的私鑰只存在 .local/template-signing/（本機、不進 git），
 * 由 tools/template-signing/generate-keys.js 產生，
 * 由 tools/template-signing/sign-package.js 用來簽發模板包。
 *
 * 產生時間：2026-08-07T12:36:05.257Z
 * 若要輪替：對舊私鑰簽過的模板包會全部失效，需重新簽發後隨新版 app 一起發布。
 */
'use strict';

module.exports = {
  TEMPLATE_PUBLIC_KEY_HEX: '302a300506032b6570032100dad352de2c314e1e2c6c57cb96e3b612e89eb15ab8c9240b1e64adeeecfb16ba',
};
