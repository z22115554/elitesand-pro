/**
 * API 路由：系統字體清單與字體檔遞送
 * 由 server/routes/api.js 掛載在 /api 底下。
 */
const express = require('express');
const router = express.Router();
const { isDirectLoopback } = require('../../utils/direct-loopback');
const fs = require('fs');

const { createLogger } = require('../../utils/logger');
const log = createLogger('API');

// ─── 系統字體清單 ───
// 由伺服器直接掃描字體目錄（含使用者專屬字體），不受瀏覽器 Font Access API 的
// 權限/數量限制；?refresh=1 可重掃（新安裝字體後使用）。
router.get('/fonts', async (req, res) => {
  try {
    const { listSystemFonts } = require('../../services/font-scanner');
    const result = await listSystemFonts(req.query.refresh === '1');
    // assets 是不含本機路徑的 opaque ID。顯示端用它向下面的 loopback-only 路由取字型檔，
    // 不再賭 Chromium 是否剛好把 Windows 使用者字型註冊成可用 CSS family。
    res.json({ success: true, fonts: result.fonts, aliases: result.aliases, assets: result.assets, fileCount: result.fileCount });
  } catch (err) {
    log.error('掃描系統字體失敗', err);
    res.status(500).json({ success: false, error: '掃描系統字體失敗' });
  }
});

function requireLocalFontAsset(req, res, next) {
  // Server 本身會綁在 LAN；字型檔卻不應因而被 LAN/隧道來源下載。不要信任
  // X-Forwarded-For，只有 TCP 對端確實是 loopback 才可繼續。
  if (!isDirectLoopback(req)) return res.status(403).json({ success: false, error: '本機字型資源只限這台電腦的輸出頁使用' });
  next();
}

function safeAssetId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(value);
}

// 先給 FontFace 載入器一份已驗證的 face 描述；不暴露實體字型路徑。
router.get('/fonts/assets/:assetId', requireLocalFontAsset, async (req, res) => {
  if (!safeAssetId(req.params.assetId)) return res.status(400).json({ success: false, error: '無效的字型資源' });
  try {
    const { getFontAsset } = require('../../services/font-scanner');
    const asset = await getFontAsset(req.params.assetId);
    if (!asset) return res.status(404).json({ success: false, error: '字型資源已不存在，請重新選擇' });
    res.set({
      'Cache-Control': 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    // 集合字型（.ttc/.otc）不以 FontFace 遞送（font-scanner.js 說明）；只留單體 face。
    // 全部都是集合字型時直接 404，讓客戶端走系統字型名稱堆疊 fallback。
    const deliverableFaces = asset.faces.filter((face) => !face.isCollection);
    if (!deliverableFaces.length) {
      return res.status(404).json({ success: false, error: '此字型為集合字型，將以系統字型名稱套用' });
    }
    res.json({
      success: true,
      id: asset.id,
      family: `ElitesandLocalFont-${asset.id}`,
      faces: deliverableFaces.map((face) => ({
        id: face.id,
        weight: face.weight,
        style: face.style,
        format: face.format,
        url: `/api/fonts/assets/${asset.id}/${face.id}`,
      })),
    });
  } catch (err) {
    log.error('讀取本機字型資源資訊失敗', err);
    res.status(500).json({ success: false, error: '讀取本機字型資源失敗' });
  }
});

// 實際字型位元組只由掃描器已知的 opaque ID 對應；scanner 會再 realpath 驗證其仍位於
// Windows/macOS/Linux 受管字型目錄內，避免把此 API 變成任意檔案讀取器。
router.get('/fonts/assets/:assetId/:faceId', requireLocalFontAsset, async (req, res) => {
  if (!safeAssetId(req.params.assetId) || !safeAssetId(req.params.faceId)) {
    return res.status(400).json({ success: false, error: '無效的字型資源' });
  }
  try {
    const { resolveFontAssetFace } = require('../../services/font-scanner');
    const face = await resolveFontAssetFace(req.params.assetId, req.params.faceId);
    if (!face) return res.status(404).json({ success: false, error: '字型資源已不存在，請重新選擇' });
    const mime = face.format === 'opentype' ? 'font/otf' : 'font/ttf';
    res.set({
      'Cache-Control': 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(face.size),
    });
    res.type(mime);
    const stream = fs.createReadStream(face.file);
    stream.on('error', (err) => {
      log.warn(`讀取本機字型檔失敗: ${err.message}`);
      if (!res.headersSent) res.status(404).end();
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    log.error('傳送本機字型資源失敗', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: '傳送本機字型資源失敗' });
  }
});

module.exports = router;
