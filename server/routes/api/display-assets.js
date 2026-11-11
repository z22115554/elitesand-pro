/**
 * API 路由：OBS 顯示端素材：自訂背景圖、對話氣泡間奏貼圖
 * 由 server/routes/api.js 掛載在 /api 底下。
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { dataDir, downloadsDir } = require('../../utils/app-paths');
const fs = require('fs');

const { createLogger } = require('../../utils/logger');
const log = createLogger('API');
// PIN 存取控制（選用）：只套在會觸發下載/處理的路由，唯讀端點（cover/fonts/health）不套，
// 見 server/middleware/require-pin.js 開頭說明。
const requirePin = require('../../middleware/require-pin');

// ─── Multer 設定（Phase 4：OBS 顯示端自訂背景圖）───
const BACKGROUNDS_DIR = path.join(dataDir, 'backgrounds');
const STICKERS_DIR = path.join(dataDir, 'typewriter-stickers');
const STICKERS_HIDDEN_FILE = path.join(dataDir, 'typewriter-stickers-hidden.json');
const STICKER_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const STICKER_MAX = 24; // 自訂貼圖數量上限（不含內建三張）
const BUILTIN_STICKERS_DIR = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'typewriter-stickers');
const bgStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(BACKGROUNDS_DIR)) fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
    cb(null, BACKGROUNDS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const bgUpload = multer({
  storage: bgStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      const err = new Error(`不支援的圖片格式: ${ext}，僅支援 ${allowed.join(', ')}`);
      err.status = 400;
      cb(err);
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB 上限
});

// 對話氣泡間奏貼圖：透明 PNG／GIF 直接用（不做去背），每張 8MB、一次最多 24 張
const stickerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(STICKERS_DIR)) fs.mkdirSync(STICKERS_DIR, { recursive: true });
    cb(null, STICKERS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${STICKER_EXT.includes(ext) ? ext : '.png'}`);
  },
});
const stickerUpload = multer({
  storage: stickerStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (STICKER_EXT.includes(ext)) return cb(null, true);
    const err = new Error(`不支援的貼圖格式: ${ext}，僅支援 ${STICKER_EXT.join(', ')}`);
    err.status = 400;
    cb(err);
  },
  limits: { fileSize: 8 * 1024 * 1024, files: STICKER_MAX },
});

// 內建貼圖不能真的刪（檔案在 repo assets 裡），改記一份「已隱藏」清單在 dataDir，
// reset 就是清空這份清單。清單只存內建檔名。
function builtinStickerFilenames() {
  try {
    return fs.readdirSync(BUILTIN_STICKERS_DIR)
      .filter((n) => STICKER_EXT.includes(path.extname(n).toLowerCase()))
      .sort();
  } catch (_) { return []; }
}
function readHiddenBuiltinStickers() {
  try {
    const raw = JSON.parse(fs.readFileSync(STICKERS_HIDDEN_FILE, 'utf8'));
    return Array.isArray(raw) ? raw.filter((n) => typeof n === 'string') : [];
  } catch (_) { return []; }
}
function writeHiddenBuiltinStickers(list) {
  const valid = builtinStickerFilenames();
  const clean = [...new Set((list || []).filter((n) => valid.includes(n)))];
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(STICKERS_HIDDEN_FILE, JSON.stringify(clean), 'utf8');
  } catch (err) { log.error('隱藏內建貼圖清單寫入失敗', err); }
  return clean;
}
function listBuiltinStickers() {
  const hidden = new Set(readHiddenBuiltinStickers());
  return builtinStickerFilenames()
    .filter((n) => !hidden.has(n))
    .map((n) => ({ id: n, url: `/assets/typewriter-stickers/${n}`, builtin: true }));
}
function listCustomStickers() {
  try {
    return fs.readdirSync(STICKERS_DIR)
      .filter((n) => STICKER_EXT.includes(path.extname(n).toLowerCase()))
      .sort()
      .map((n) => ({ id: n, url: `/typewriter-sticker/${n}` }));
  } catch (_) { return []; }
}
function stickerListPayload() {
  const hiddenCount = readHiddenBuiltinStickers().length;
  return {
    success: true,
    builtin: listBuiltinStickers(),
    custom: listCustomStickers(),
    builtinTotal: builtinStickerFilenames().length,
    builtinHiddenCount: hiddenCount,
  };
}

// ─── OBS 顯示端自訂背景（Phase 4）───
// 單一背景：上傳新圖前先清掉舊檔，避免 data/backgrounds/ 累積垃圾。
router.post('/background', requirePin, bgUpload.single('background'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未收到圖片檔案' });
  }
  try {
    const keepName = req.file.filename;
    const existing = fs.readdirSync(BACKGROUNDS_DIR);
    for (const name of existing) {
      if (name !== keepName) {
        try { fs.unlinkSync(path.join(BACKGROUNDS_DIR, name)); } catch (e) { /* 靜默 */ }
      }
    }
    res.json({ success: true, filename: keepName });
  } catch (err) {
    log.error('背景圖清理舊檔失敗', err);
    res.status(500).json({ error: '背景圖處理失敗' });
  }
});

// ─── 對話氣泡間奏貼圖 ───
router.get('/typewriter-stickers', (req, res) => {
  res.json(stickerListPayload());
});

router.post('/typewriter-stickers', requirePin, stickerUpload.array('stickers', STICKER_MAX), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '未收到貼圖檔案' });
  }
  try {
    // 超過上限時砍最舊的自訂貼圖
    let files = fs.readdirSync(STICKERS_DIR)
      .filter((n) => STICKER_EXT.includes(path.extname(n).toLowerCase()))
      .sort();
    while (files.length > STICKER_MAX) {
      const drop = files.shift();
      try { fs.unlinkSync(path.join(STICKERS_DIR, drop)); } catch (e) { /* 靜默 */ }
    }
    res.json(stickerListPayload());
  } catch (err) {
    log.error('間奏貼圖處理失敗', err);
    res.status(500).json({ error: '貼圖處理失敗' });
  }
});

// 把被隱藏的內建貼圖全部找回來（reset）
router.post('/typewriter-stickers/reset-builtin', requirePin, (req, res) => {
  try {
    writeHiddenBuiltinStickers([]);
    res.json(stickerListPayload());
  } catch (err) {
    log.error('內建貼圖 reset 失敗', err);
    res.status(500).json({ error: '內建貼圖 reset 失敗' });
  }
});

router.delete('/typewriter-stickers/:id', requirePin, (req, res) => {
  const safeName = path.basename(req.params.id || '');
  if (!safeName) return res.status(400).json({ error: '無效的貼圖名稱' });

  // 內建貼圖：不刪檔案，只加進「已隱藏」清單（reset-builtin 可全部找回）
  if (builtinStickerFilenames().includes(safeName)) {
    try {
      writeHiddenBuiltinStickers([...readHiddenBuiltinStickers(), safeName]);
      return res.json(stickerListPayload());
    } catch (err) {
      log.error('內建貼圖隱藏失敗', err);
      return res.status(500).json({ error: '內建貼圖隱藏失敗' });
    }
  }

  const target = path.resolve(STICKERS_DIR, safeName);
  if (!target.startsWith(STICKERS_DIR + path.sep)) {
    return res.status(400).json({ error: '無效的貼圖名稱' });
  }
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    res.json(stickerListPayload());
  } catch (err) {
    log.error('間奏貼圖刪除失敗', err);
    res.status(500).json({ error: '貼圖刪除失敗' });
  }
});

router.delete('/background', requirePin, (req, res) => {
  try {
    if (fs.existsSync(BACKGROUNDS_DIR)) {
      for (const name of fs.readdirSync(BACKGROUNDS_DIR)) {
        try { fs.unlinkSync(path.join(BACKGROUNDS_DIR, name)); } catch (e) { /* 靜默 */ }
      }
    }
    res.json({ success: true });
  } catch (err) {
    log.error('背景圖刪除失敗', err);
    res.status(500).json({ error: '背景圖刪除失敗' });
  }
});

module.exports = router;
