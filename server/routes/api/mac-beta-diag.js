'use strict';

// Mac 內測版診斷回報的面板端點（services/mac-beta-diagnostics.js）。
// 非 Mac 內測版時 status 一律回 macBeta:false，其餘端點什麼都不做。
const express = require('express');
const { requireControlAccess } = require('../../middleware/require-control-access');
const requirePin = require('../../middleware/require-pin');
const { isDirectLoopback } = require('../../utils/direct-loopback');
const macBetaDiagnostics = require('../../services/mac-beta-diagnostics');

const router = express.Router();

router.get('/mac-beta-diag/status', requireControlAccess, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...macBetaDiagnostics.getStatus(), local: isDirectLoopback(req) });
});

// 使用者在一次性告知按「知道了」。會寫本機設定，依鐵則 15 掛 requirePin。
router.post('/mac-beta-diag/ack', requirePin, (req, res) => {
  res.json({ ok: true, ...macBetaDiagnostics.acknowledgeNotice() });
});

const MIC_STATES = new Set(['granted', 'denied', 'prompt', 'unsupported']);

// 面板（渲染程序）探測到的顯示卡能力與麥克風權限狀態。只收本機 Electron 視窗送來的：
// 手機遙控或區網瀏覽器的顯示卡跟這台 Mac 無關，混進來會讓資料失真。
router.post('/mac-beta-diag/client', requirePin, (req, res) => {
  if (!isDirectLoopback(req)) return res.status(403).json({ ok: false, error: 'LOCAL_ONLY' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.gpu && typeof body.gpu === 'object') {
    macBetaDiagnostics.gpu({
      api: body.gpu.api === true,
      adapter: body.gpu.adapter === true,
      shaderF16: body.gpu.shaderF16 === true,
      // 原始字串只在這裡分類成 apple／intel／amd／other，不會被轉送
      vendor: typeof body.gpu.vendor === 'string' ? body.gpu.vendor.slice(0, 64) : '',
    });
  }
  if (typeof body.mic === 'string' && MIC_STATES.has(body.mic)) macBetaDiagnostics.milestone('mic_permission', body.mic);
  res.json({ ok: true });
});

module.exports = router;
