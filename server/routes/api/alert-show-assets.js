/**
 * API 路由：訂閱／贈訂／揪團演出的自訂角色圖（角色、吉祥物各一張）。
 * 由 server/routes/api.js 掛載在 /api 底下；讀圖的唯讀路由 /alert-show/custom/:kind 在 server/index.js。
 *
 * - 上傳與刪除都掛 requirePin（鐵則 15）。
 * - 面板會先把圖縮到合理大小並轉成 WebP 再送來；這裡只收 PNG／WebP（要有透明背景），
 *   用檔頭判斷格式，不信任副檔名，也檢查長寬，避免巨圖讓 OBS 解碼卡住。
 * - 這支只負責存檔，回傳 rev（存檔時間）。要不要用自訂圖、臉的位置，由面板透過
 *   overlay-show:settings:update 存進設定（設定以伺服器為準，鐵則 4）。
 * - 錯誤回應都帶 code，面板照 code 顯示各語言的說明（error 只是給 log 看的中文）。
 */
'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { dataDir } = require('../../utils/app-paths');
const { createLogger } = require('../../utils/logger');
const requirePin = require('../../middleware/require-pin');

const router = express.Router();
const log = createLogger('AlertShow');

const CHARACTER_DIR = path.join(dataDir, 'alert-show');
const KINDS = Object.freeze(['girl', 'mascot']);
const EXTS = Object.freeze(['.webp', '.png']);
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_SIDE = 4096;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

/** 從檔頭認格式並讀長寬；不是 PNG／WebP 就回 null。 */
function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { ext: '.png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { ext: '.webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return { ext: '.webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      return { ext: '.webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
  }
  return null;
}

function filesFor(kind) {
  return EXTS.map((ext) => path.join(CHARACTER_DIR, `${kind}${ext}`));
}

/** 目前這個種類存在的檔案（只會有一張；兩種副檔名都找）。 */
function findCharacterFile(kind) {
  if (!KINDS.includes(kind)) return null;
  return filesFor(kind).find((file) => fs.existsSync(file)) || null;
}

function removeCharacter(kind) {
  for (const file of filesFor(kind)) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (err) { log.warn(`刪除角色圖失敗：${err.message}`); }
  }
}

router.post('/alert-show/character/:kind', requirePin, (req, res) => {
  const kind = String(req.params.kind || '');
  if (!KINDS.includes(kind)) return res.status(400).json({ error: '不認得的圖片種類', code: 'bad-kind' });
  upload.single('image')(req, res, (uploadErr) => {
    if (uploadErr) {
      const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? '圖片太大（上限 12MB）' : '圖片上傳失敗', code: tooBig ? 'too-big' : 'upload-failed' });
    }
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: '未收到圖片檔案', code: 'no-file' });
    const info = sniffImage(req.file.buffer);
    if (!info) return res.status(400).json({ error: '只支援去背的 PNG 或 WebP 圖片', code: 'bad-type' });
    if (!info.width || !info.height || info.width > MAX_SIDE || info.height > MAX_SIDE) {
      return res.status(400).json({ error: `圖片長寬要在 ${MAX_SIDE} 像素以內`, code: 'too-large' });
    }
    try {
      fs.mkdirSync(CHARACTER_DIR, { recursive: true });
      const target = path.join(CHARACTER_DIR, `${kind}${info.ext}`);
      const temp = `${target}.uploading`;
      fs.writeFileSync(temp, req.file.buffer);
      for (const other of filesFor(kind)) {
        if (other !== target && fs.existsSync(other)) fs.unlinkSync(other);
      }
      fs.renameSync(temp, target); // 先寫暫存再換名，OBS 不會讀到寫一半的圖
      res.json({ success: true, kind, rev: Date.now(), width: info.width, height: info.height });
    } catch (err) {
      log.error('角色圖存檔失敗', err);
      res.status(500).json({ error: '角色圖存檔失敗', code: 'save-failed' });
    }
  });
});

router.delete('/alert-show/character/:kind', requirePin, (req, res) => {
  const kind = String(req.params.kind || '');
  if (!KINDS.includes(kind)) return res.status(400).json({ error: '不認得的圖片種類', code: 'bad-kind' });
  removeCharacter(kind);
  res.json({ success: true, kind });
});

module.exports = router;
module.exports.findCharacterFile = findCharacterFile;
module.exports.sniffImage = sniffImage;
module.exports.CHARACTER_KINDS = KINDS;
