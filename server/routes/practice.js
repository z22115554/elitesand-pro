'use strict';

const { createPracticeGuideService, PracticeGuideError } = require('../services/practice-guide-service');

function createPracticeRouter(options = {}) {
  const express = options.express || require('express');
  const router = express.Router();
  const service = options.service || createPracticeGuideService(options);
  const requirePin = options.requirePin || require('../middleware/require-pin');
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  // A guide is private source-derived data. Even GET requires controller+PIN;
  // OBS/read-only output must use a separate, sanitized score-only channel.
  const handle = (operation) => async (req, res) => {
    try {
      const result = await operation(req);
      const status = result.status;
      if (status === 'missing') return res.status(404).json({ ok: false, code: 'GUIDE_NOT_FOUND', error: '尚未建立這首歌的練唱音高。' });
      return res.status(['queued', 'processing', 'cancelling'].includes(status) ? 202 : 200).json({ ok: true, ...result });
    } catch (error) {
      const known = error instanceof PracticeGuideError;
      return res.status(known ? error.status : 500).json({ ok: false,
        code: known ? error.code : 'PRACTICE_REQUEST_FAILED',
        error: known ? error.message : '練唱處理失敗，請稍後再試。' });
    }
  };
  router.get('/guides/:trackId', requirePin, handle((req) => service.get(req.params.trackId)));
  router.post('/guides/:trackId', requirePin, handle((req) => service.start(req.params.trackId, {
    force: req.body?.force === true, algorithm: req.body?.algorithm || 'auto',
  })));
  router.post('/guides/:trackId/cancel', requirePin, handle((req) => service.cancel(req.params.trackId)));
  // 高精度音高元件（torchcrepe）：沒裝也能練唱（YIN），按了才補裝。安裝會下載套件，所以同樣要 PIN（鐵則 15）。
  const runtime = options.runtime || require('../services/ai-runtime-provider');
  router.get('/pitch-model', requirePin, (_req, res) => res.json({ ok: true,
    aiRuntime: runtime.isAvailable(), installed: runtime.isPracticePitchModelAvailable() }));
  router.post('/pitch-model/install', requirePin, async (_req, res) => {
    try {
      const result = await runtime.installPracticePitchModel();
      res.json({ ok: true, installed: true, alreadyAvailable: !!result.alreadyAvailable });
    } catch (error) {
      const status = error.code === 'AI_RUNTIME_REQUIRED' ? 409 : 500;
      res.status(status).json({ ok: false, code: error.code || 'PRACTICE_MODEL_INSTALL_FAILED',
        error: status === 409 ? error.message : '練唱音高元件安裝失敗，請檢查網路後再試。' });
    }
  });
  router.practiceService = service;
  return router;
}

module.exports = { createPracticeRouter };
